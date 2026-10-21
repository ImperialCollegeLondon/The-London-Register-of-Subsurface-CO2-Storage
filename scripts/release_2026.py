#!/usr/bin/env python3
"""Validate and publish the embargoed release; never copy PDFs into Pages.

Only GitHub's draft-release permissions protect the PDFs. The website countdown
is presentation. Publication requires BOTH UTC runner time and a fresh GitHub
HTTP Date at/after the manifest's deadline. There is no time-override CLI flag.
"""
import argparse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, build_opener, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data/release2026.json"
UTC = timezone.utc


class ReleaseError(RuntimeError):
    pass


def utcnow():
    return datetime.now(UTC)


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ReleaseError("Timestamps must include a timezone")
    return parsed.astimezone(UTC)


def load_manifest():
    manifest = json.loads(MANIFEST.read_text())
    timestamp(manifest["release_at"])
    docs = manifest["documents"]
    if len(docs) != 3 or len({d["filename"] for d in docs}) != 3:
        raise ReleaseError("Exactly three distinct documents are required")
    return manifest


class NoRedirect(HTTPRedirectHandler):
    # JSON requests must stay on api.github.com; never forward credentials.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self, repository, token=None):
        self.base = "https://api.github.com/repos/" + repository
        self.token = token
        self.opener = build_opener(NoRedirect())

    def request(self, path, method="GET", payload=None):
        headers = {"Accept": "application/vnd.github+json",
                   "User-Agent": "LondonCO2-Embargo-Release",
                   "X-GitHub-Api-Version": "2022-11-28", "Cache-Control": "no-cache"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        body = None if payload is None else json.dumps(payload).encode()
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(self.base + path, data=body, headers=headers, method=method)
        with self.opener.open(request, timeout=30) as response:
            raw = response.read()
            date = response.headers.get("Date")
            server_time = parsedate_to_datetime(date).astimezone(UTC) if date else None
            return (json.loads(raw) if raw else None), server_time

    def find_release(self, tag):
        # The by-tag endpoint only guarantees published releases. List drafts
        # using the write-scoped token, with a unique query for a fresh Date.
        for page in range(1, 11):
            releases, server_time = self.request(
                f"/releases?per_page=100&page={page}&check={time.time_ns()}")
            matches = [release for release in releases if release["tag_name"] == tag]
            if len(matches) > 1:
                raise ReleaseError("Duplicate releases for the embargo tag")
            if matches:
                return matches[0], server_time
            if len(releases) < 100:
                break
        raise ReleaseError("The staged release was not found")


def verify_release(release, manifest, *, public=False):
    if release.get("tag_name") != manifest["tag"] or release.get("prerelease") is not False:
        raise ReleaseError("Unexpected release tag or prerelease state")
    expected = {doc["filename"]: doc for doc in manifest["documents"]}
    assets = release.get("assets", [])
    if len(assets) != len(expected) or {a.get("name") for a in assets} != set(expected):
        raise ReleaseError("Release must contain exactly the three approved PDFs")
    for asset in assets:
        doc = expected[asset["name"]]
        if (asset.get("state") != "uploaded" or asset.get("size") != doc["size"] or
                asset.get("digest") != "sha256:" + doc["sha256"]):
            raise ReleaseError("Asset integrity mismatch: " + asset["name"])
    if public:
        if release.get("draft") is not False or not release.get("published_at"):
            raise ReleaseError("Release is not published")
        if timestamp(release["published_at"]) < timestamp(manifest["release_at"]):
            raise ReleaseError("Release was published before the embargo deadline")
    elif release.get("draft") is not True:
        raise ReleaseError("Expected a private draft release")


def public_release(manifest):
    public = GitHub(manifest["github_repository"])
    release, _ = public.request("/releases/tags/" + quote(manifest["tag"], safe="") +
                                "?check=" + str(time.time_ns()))
    verify_release(release, manifest, public=True)
    return release


def assert_anonymous_404(url, accept="application/vnd.github+json"):
    request = Request(url, headers={"Accept": accept, "User-Agent": "LondonCO2-Embargo-PrivacyCheck"})
    try:
        with build_opener(NoRedirect()).open(request, timeout=30):
            pass
    except HTTPError as error:
        if error.code == 404:
            return
        raise ReleaseError("Anonymous privacy probe did not return 404") from None
    raise ReleaseError("Staged release or PDF is anonymously accessible")


def require_private(release, manifest):
    """Check metadata, binary API and each stable download URL without auth."""
    base = "https://api.github.com/repos/" + manifest["github_repository"]
    assert_anonymous_404(base + "/releases/" + str(release["id"]))
    assert_anonymous_404(base + "/releases/tags/" + quote(manifest["tag"], safe=""))
    for asset in release["assets"]:
        assert_anonymous_404(base + "/releases/assets/" + str(asset["id"]), "application/octet-stream")
        url = ("https://github.com/" + manifest["github_repository"] + "/releases/download/" +
               quote(manifest["tag"], safe="") + "/" + quote(asset["name"], safe=""))
        assert_anonymous_404(url, "application/octet-stream")


def validate(client, manifest):
    release, _ = client.find_release(manifest["tag"])
    if release.get("draft"):
        verify_release(release, manifest)
        require_private(release, manifest)
        print("Validated: three matching PDFs in a private draft; anonymous API access denied.")
    else:
        verify_release(release, manifest, public=True)
        public_release(manifest)
        print("Validated: matching public release published at/after the deadline.")


def publish(client, manifest, *, now=utcnow, sleep=time.sleep):
    deadline = timestamp(manifest["release_at"])
    remaining = (deadline - now()).total_seconds()
    if remaining > 3600:
        raise ReleaseError("Too early: publication can only be armed within one hour of the deadline")
    # Validate assets before spending runner time waiting.
    release, _ = client.find_release(manifest["tag"])
    verify_release(release, manifest, public=release.get("draft") is False)
    while now() < deadline:
        sleep(max(0, min(30, (deadline - now()).total_seconds())))
    # Re-fetch immediately before publication. If GitHub's clock is behind,
    # wait for it too. Missing Date or invalid assets fail closed.
    for attempt in range(10):
        release, server_time = client.find_release(manifest["tag"])
        verify_release(release, manifest, public=release.get("draft") is False)
        if server_time is None:
            raise ReleaseError("GitHub server Date is missing; refusing to publish")
        if server_time < deadline or now() < deadline:
            sleep(2)
            continue
        if release["draft"] is False:
            print("Release already public; verified idempotent retry.")
            return False
        published, _ = client.request("/releases/" + str(release["id"]), "PATCH",
                                      {"draft": False, "make_latest": "false"})
        verify_release(published, manifest, public=True)
        print("Release published after both UTC time checks passed.")
        return True
    raise ReleaseError("GitHub clock has not reached the deadline; refusing to publish")


def write_status(manifest):
    checked = utcnow()
    available = False
    if checked >= timestamp(manifest["release_at"]):
        try:
            public_release(manifest)
            available = True
        except (HTTPError, URLError, ReleaseError, ValueError, TimeoutError):
            print("Public release not yet verified; download cards remain locked.")
    status = {"available": available, "release_at": manifest["release_at"],
              "checked_at": checked.isoformat().replace("+00:00", "Z"),
              "documents": [{key: doc[key] for key in ("filename", "size", "sha256")}
                            for doc in manifest["documents"]]}
    for path in (ROOT / "data/release2026status.json", ROOT / "static/release-2026-status.json"):
        path.write_text(json.dumps(status, indent=2) + "\n")
    print("Public download availability:", available)


def check_public(directory, manifest):
    """These PDFs must ALWAYS be delivered from Releases, never Pages artifacts."""
    names = {doc["filename"] for doc in manifest["documents"]}
    hashes = {doc["sha256"] for doc in manifest["documents"]}
    for path in Path(directory).rglob("*"):
        if not path.is_file():
            continue
        if path.name in names:
            raise ReleaseError("Release PDF found in public build: " + path.name)
        # Check PDF magic as well as extension, catching renamed copies.
        with path.open("rb") as stream:
            prefix = stream.read(1024)
            if b"%PDF-" in prefix:
                digest = hashlib.sha256(prefix + stream.read()).hexdigest()
                if digest in hashes:
                    raise ReleaseError("Embargoed PDF bytes found in public build")
    print("Public build contains no embargoed PDF payloads.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("validate", "publish", "status", "check-public"))
    parser.add_argument("--scheduled", action="store_true")
    parser.add_argument("--directory", default="public")
    args = parser.parse_args()
    manifest = load_manifest()
    if args.command == "status":
        write_status(manifest)
        return
    if args.command == "check-public":
        check_public(args.directory, manifest)
        return
    deadline = timestamp(manifest["release_at"])
    if args.scheduled and not deadline - timedelta(hours=1) <= utcnow() <= deadline + timedelta(days=2):
        print("Outside the 2026 publication window; no action.")
        return
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise ReleaseError("GITHUB_TOKEN with contents:write is required")
    client = GitHub(manifest["github_repository"], token)
    if args.command == "validate":
        validate(client, manifest)
    else:
        publish(client, manifest)
        # Retry propagation, then explicitly dispatch Pages: GITHUB_TOKEN
        # release publication does not trigger another release-event workflow.
        for attempt in range(10):
            try:
                public_release(manifest)
                break
            except (HTTPError, URLError, ReleaseError, TimeoutError):
                if attempt == 9:
                    raise
                time.sleep(6)
        client.request("/actions/workflows/hugo.yaml/dispatches", "POST", {"ref": "main"})
        print("Public release verified; Pages refresh dispatched.")


if __name__ == "__main__":
    try:
        main()
    except (ReleaseError, HTTPError, URLError, TimeoutError, ValueError) as error:
        # Never print response bodies, credentials, or signed download URLs.
        detail = "HTTP " + str(error.code) if isinstance(error, HTTPError) else str(error)
        print("Release operation failed: " + detail, file=sys.stderr)
        sys.exit(1)
