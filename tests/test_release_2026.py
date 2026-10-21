"""Security boundary tests: private release, UTC cutoff, asset integrity, no leaks."""
import copy
from datetime import timedelta
from email.utils import format_datetime
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_2026", ROOT / "scripts/release_2026.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
M = r.load_manifest()
DEADLINE = r.timestamp(M["release_at"])


def release_fixture(draft=True):
    return {"id": 123, "tag_name": M["tag"], "draft": draft, "prerelease": False,
            "published_at": None if draft else M["release_at"],
            "assets": [{"id": i, "name": doc["filename"], "size": doc["size"],
                        "state": "uploaded", "digest": "sha256:" + doc["sha256"]}
                       for i, doc in enumerate(M["documents"], 10)]}


class FakeClock:
    def __init__(self, start):
        self.value = start
        self.sleeps = []

    def now(self):
        return self.value

    def sleep(self, seconds):
        assert seconds >= 0
        self.sleeps.append(seconds)
        self.value += timedelta(seconds=seconds)


class FakeGitHub:
    def __init__(self, clock, release=None, server_offset=0, missing_date=False):
        self.clock = clock
        self.release = release or release_fixture()
        self.server_offset = server_offset
        self.missing_date = missing_date
        self.reads = 0
        self.writes = []

    def find_release(self, tag):
        self.reads += 1
        server = None if self.missing_date else self.clock.now() + timedelta(seconds=self.server_offset)
        return copy.deepcopy(self.release), server

    def request(self, path, method, payload):
        self.writes.append((self.clock.now(), path, method, payload))
        result = copy.deepcopy(self.release)
        result.update(draft=False, published_at=self.clock.now().isoformat())
        self.release = result
        return result, self.clock.now()


class PublicationTests(unittest.TestCase):
    def test_exact_timezone_conversion_and_requested_order(self):
        from zoneinfo import ZoneInfo
        self.assertEqual(DEADLINE.astimezone(ZoneInfo("Australia/Perth")).isoformat(), "2026-10-26T07:55:00+08:00")
        self.assertEqual(DEADLINE.astimezone(ZoneInfo("Europe/London")).isoformat(), "2026-10-25T23:55:00+00:00")
        self.assertEqual([d["id"] for d in M["documents"]], ["annual-2026", "assurance-2026", "methodology-2026"])

    def test_manual_run_days_early_cannot_arm_or_publish(self):
        clock = FakeClock(DEADLINE - timedelta(days=1))
        client = FakeGitHub(clock)
        with self.assertRaises(r.ReleaseError):
            r.publish(client, M, now=clock.now, sleep=clock.sleep)
        self.assertEqual(client.writes, [])

    def test_one_millisecond_early_waits_without_writing_then_publishes(self):
        clock = FakeClock(DEADLINE - timedelta(milliseconds=1))
        client = FakeGitHub(clock)
        def guarded_sleep(seconds):
            self.assertEqual(client.writes, [])
            clock.sleep(seconds)
        r.publish(client, M, now=clock.now, sleep=guarded_sleep)
        self.assertEqual(len(client.writes), 1)
        self.assertGreaterEqual(client.writes[0][0], DEADLINE)
        self.assertGreaterEqual(client.reads, 2)

    def test_exact_deadline_and_late_runner_both_publish(self):
        for offset in (0, 600):
            with self.subTest(offset=offset):
                clock = FakeClock(DEADLINE + timedelta(seconds=offset))
                client = FakeGitHub(clock)
                self.assertTrue(r.publish(client, M, now=clock.now, sleep=clock.sleep))
                self.assertEqual(client.writes[0][3], {"draft": False, "make_latest": "false"})

    def test_server_clock_must_also_reach_deadline(self):
        clock = FakeClock(DEADLINE)
        client = FakeGitHub(clock, server_offset=-4)
        r.publish(client, M, now=clock.now, sleep=clock.sleep)
        self.assertEqual(client.writes[0][0], DEADLINE + timedelta(seconds=4))

    def test_missing_server_date_fails_closed(self):
        clock = FakeClock(DEADLINE)
        client = FakeGitHub(clock, missing_date=True)
        with self.assertRaises(r.ReleaseError):
            r.publish(client, M, now=clock.now, sleep=clock.sleep)
        self.assertEqual(client.writes, [])

    def test_missing_extra_corrupt_unuploaded_assets_all_fail_closed(self):
        cases = []
        for prop, value in (("size", 7), ("digest", "sha256:wrong"), ("state", "starter"), ("name", "wrong.pdf")):
            release = release_fixture()
            release["assets"][0][prop] = value
            cases.append(release)
        release = release_fixture(); release["assets"].pop(); cases.append(release)
        release = release_fixture(); release["assets"].append(copy.deepcopy(release["assets"][0])); cases.append(release)
        for release in cases:
            clock = FakeClock(DEADLINE)
            client = FakeGitHub(clock, release)
            with self.assertRaises(r.ReleaseError):
                r.publish(client, M, now=clock.now, sleep=clock.sleep)
            self.assertEqual(client.writes, [])

    def test_assets_rechecked_after_waiting(self):
        clock = FakeClock(DEADLINE - timedelta(seconds=30))
        client = FakeGitHub(clock)
        def corrupt_during_wait(seconds):
            clock.sleep(seconds)
            client.release["assets"][0]["digest"] = "sha256:changed"
        with self.assertRaises(r.ReleaseError):
            r.publish(client, M, now=clock.now, sleep=corrupt_during_wait)
        self.assertGreaterEqual(client.reads, 2)
        self.assertEqual(client.writes, [])

    def test_already_published_is_idempotent_but_early_publication_is_rejected(self):
        clock = FakeClock(DEADLINE + timedelta(seconds=5))
        client = FakeGitHub(clock, release_fixture(False))
        self.assertFalse(r.publish(client, M, now=clock.now, sleep=clock.sleep))
        self.assertEqual(client.writes, [])
        client.release["published_at"] = (DEADLINE - timedelta(seconds=1)).isoformat()
        with self.assertRaises(r.ReleaseError):
            r.publish(client, M, now=clock.now, sleep=clock.sleep)

    def test_network_failure_cannot_publish(self):
        clock = FakeClock(DEADLINE)
        client = FakeGitHub(clock)
        with patch.object(client, 'find_release', side_effect=r.URLError('unavailable')):
            with self.assertRaises(r.URLError):
                r.publish(client, M, now=clock.now, sleep=clock.sleep)
        self.assertEqual(client.writes, [])

    def test_anonymous_redirect_success_or_error_never_passes_as_private(self):
        for code in (200, 302, 403, 404):
            with self.subTest(code=code):
                opener = MagicMock()
                if code != 200:
                    opener.open.side_effect = r.HTTPError('https://example.test', code, 'status', {}, None)
                with patch.object(r, 'build_opener', return_value=opener):
                    if code == 404:
                        r.assert_anonymous_404('https://example.test', 'application/octet-stream')
                    else:
                        with self.assertRaises(r.ReleaseError):
                            r.assert_anonymous_404('https://example.test', 'application/octet-stream')

    def test_credentialed_json_request_does_not_follow_redirect(self):
        redirect = r.NoRedirect()
        request = r.Request('https://api.github.com/example', headers={'Authorization': 'Bearer secret'})
        self.assertIsNone(redirect.redirect_request(request, None, 302, 'Found', {}, 'https://other.test/file'))


class PublicBuildTests(unittest.TestCase):
    def test_before_deadline_status_never_queries_private_or_public_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'data').mkdir(); (root / 'static').mkdir()
            with patch.object(r, 'ROOT', root), patch.object(r, 'utcnow', return_value=DEADLINE - timedelta(seconds=1)), patch.object(r, 'public_release') as api:
                r.write_status(M)
                api.assert_not_called()
            status = json.loads((root / 'data/release2026status.json').read_text())
            self.assertFalse(status['available'])
            self.assertEqual(len(status['documents']), 3)
            self.assertEqual((root / 'data/release2026status.json').read_bytes(), (root / 'static/release-2026-status.json').read_bytes())

    def test_after_deadline_status_requires_verified_public_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'data').mkdir(); (root / 'static').mkdir()
            for failure, expected in ((r.ReleaseError('missing'), False), (None, True)):
                with patch.object(r, 'ROOT', root), patch.object(r, 'utcnow', return_value=DEADLINE), patch.object(r, 'public_release', side_effect=failure):
                    r.write_status(M)
                self.assertIs(json.loads((root / 'data/release2026status.json').read_text())['available'], expected)

    def test_artifact_guard_rejects_known_pdf_name_and_renamed_pdf_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / M['documents'][0]['filename']
            path.write_bytes(b'anything')
            with self.assertRaises(r.ReleaseError): r.check_public(temp, M)
            path.unlink()
            payload = b'%PDF-1.7 secret unpublished payload'
            path = Path(temp) / 'renamed.bin'
            path.write_bytes(payload)
            manifest = copy.deepcopy(M)
            manifest['documents'][0]['sha256'] = r.hashlib.sha256(payload).hexdigest()
            with self.assertRaises(r.ReleaseError): r.check_public(temp, manifest)
            path.unlink()
            (Path(temp) / 'cover.png').write_bytes(b'PNG cover only')
            r.check_public(temp, M)


if __name__ == '__main__':
    unittest.main()
