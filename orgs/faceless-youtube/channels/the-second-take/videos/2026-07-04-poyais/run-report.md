# poyais — tail run report (fyt-runner arc live test, 2026-07-20)

First live exercise of the post-render tail on real artifacts. Runner: boss session (fyt-runner
agent def landed this arc; this run drove the tail CLIs directly as its acceptance test).

## Stage outcomes

| Stage | Result |
|---|---|
| thumbnail | **BLOCKED — no candidates.** No `assets/thumbs/` and no thumbnail files exist for poyais; generating one is a paid image call requiring explicit authorization at Gate 3. |
| compliance-check | Ran clean, verdict **FAIL 4/6** (honest): render manifest PASS (LUFS -14.24, splice green), metadata PASS, privacy+AI-disclosure PASS, licensing PASS (nothing licensed), thumbnail FAIL (missing), scene-review FAIL (1/119 not shippable: **L17**, gate/unreviewed — the layered shot with no manifest entry; render's compat carve-out passes it, the tail surfaces it). Report: `compliance-report.md`. |
| shot board | Built (5.59 MB, 117 shots · 116 verified · 0 parked · 1 unreviewed) and published as the per-video artifact: **https://claude.ai/code/artifact/95987ba7-d47c-4a68-9d2f-8c0cf4bf278f** (republish same path to keep URL). |
| publish-queue | Not run — Gate 3 not yet approved (correct behavior). Preflight will refuse until compliance passes. |
| analytics | Pending: channel OAuth refresh token not yet in `.env`; first pull after first publish. |

## Spend

$0 this run. No paid stage executed.

## Deviations / findings

- The two honest compliance FAILs are the expected pre-Gate-3 state, not defects: the thumbnail
  stage was never run for poyais (predates the tail), and L17 is the known carve-out shot.
- Gate-3 path to green: (1) authorize + generate thumbnail candidates (paid) or supply an image,
  then `finalize_thumbnail.py`; (2) either review L17 and stamp it via a ruling in `_review/` +
  `stamp_review.py`, or accept the carve-out and record the exception in the Gate-3 decision.

## Publish (2026-07-21)

Uploaded PRIVATE via youtube-uploader MCP: video id 8Rv5SwFiZ4Y, channel Second Takes (UCSiK6AWvPQJTl-jmD-6qVUQ). publish-record.json written; preflight now exits 2 (already published). Thumbnail A ("Trust me, it%s paradise") finalized pre-upload; compliance 6/6. Remaining manual: Daniel sets thumbnail in Studio + flips public. MCP OAuth bug found+worked around: exchange leg ignores the authorize redirect override (core/oauth.go copy bug) — authenticate with redirect_uri=http://localhost to match the client JSON default.
