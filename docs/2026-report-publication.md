# 2026 report publication

The download cards are ordered **Annual Report → DNV Assessment → Methodology**.

The single machine-readable deadline is in `data/release2026.json`:

- 26 October 2026, **07:55 Australia/Perth (UTC+8)**.
- 25 October 2026, **23:55 UTC / Europe/London (GMT)**.

The UK date is 25 October. This deadline replaces the earlier 08:01 Perth announcement.

## Where the files live

The three original PDFs are stored as assets of the **unpublished draft** GitHub
Release tagged `2026-materials`. Only repository collaborators with sufficient
permissions can access that draft. The current public working tree contains first-page PNG
covers, filenames, sizes and SHA-256 checksums; the new PDF assets are not added
to that tree. This embargo cannot retract older drafts previously committed to
public Git history or copies held elsewhere.
Local originals are outside the Git checkout in `~/Desktop/LondonCO2-Embargo-2026/`.

Do not commit the PDFs, upload them to Actions artifacts/caches, attach them to a
public issue, or publish the draft manually before the deadline. Public Pages
builds are checked for the approved filenames and exact PDF payloads, including
renamed copies. This check is an extra guard, not a substitute for keeping source
PDFs out of the repository.

## Automated release

`.github/workflows/release-2026.yaml` starts at **23:10 UTC on 25 October** and
waits in its runner until 23:55 UTC. Additional attempts run at 23:40 and 23:55,
then 00:10, 00:25, 00:40 and 00:55 UTC on 26 October. The script ignores annual
cron recurrence outside the 2026 publication window. Its separate concurrency
group does not block the usual 15-minute website statistics builds.

Before publishing, `scripts/release_2026.py` requires:

1. Both runner UTC time and a freshly requested GitHub server Date to be at/after
   the deadline. There is no CLI option to override the current time.
2. Exactly the three approved PDF assets, fully uploaded with matching sizes
   and GitHub-provided SHA-256 digests. This is rechecked after waiting.
3. An expected draft/tag state; a retry can accept an already published release
   only when its assets match and its publication timestamp meets the deadline.

The workflow changes the draft to a public release, checks the public release,
and explicitly triggers the Pages workflow. It uses `contents: write` to publish
and `actions: write` to dispatch Pages. No private asset bytes enter the workflow.

The website points directly to stable public Release asset URLs, so downloads do
not depend on completion of the subsequent Pages deployment. Existing open tabs
check publication status around the deadline. Every later Pages build regenerates
public availability, preserving download links across statistics updates.

GitHub scheduled jobs may queue or be delayed. Starting early reduces delay; the
server checks prevent an early release. An API or runner outage can delay release.

## Verification and recovery

Run **Publish embargoed 2026 reports → Run workflow → validate** to verify draft
asset integrity and anonymous denial without publishing. This checks release
metadata, binary API endpoints and direct download URLs; all must return 404.

If a delayed or failed run needs manual recovery, choose **publish**. This mode
can only be armed within one hour of the deadline and still waits for both clocks.
After publication, retries verify the release and trigger another Pages refresh.
They do not replace assets or publish duplicate releases.

For local checks:

```sh
python3 -m unittest discover -s tests -p 'test_release_2026.py' -v
node --test tests/test_release_countdown.js tests/test_release_downloads.js
python3 scripts/release_2026.py status
hugo --gc --minify
python3 scripts/release_2026.py check-public --directory public
```

If PDFs must be replaced before release, update the **draft** assets and manifest
sizes/SHA-256 checksums together, regenerate their public covers as appropriate,
and rerun the validation workflow. Never paste tokens or private signed download
URLs into the repository, page content, or workflow logs.

References: [GitHub Releases API](https://docs.github.com/en/rest/releases/releases),
[asset downloads](https://docs.github.com/en/rest/releases/assets),
[scheduled workflow limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
