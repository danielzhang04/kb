---
name: analytics-reporter
description: >-
  Closes the faceless-YouTube learning loop for this project: pulls READ-ONLY YouTube Analytics for a
  channel's published videos, keeps the numbers in files, rebuilds a self-contained dashboard, and
  appends a dated digest to the channel's performance.md (which idea-generator reads to learn what
  worked — nothing else ever writes to it). Use this whenever the user wants to pull analytics, refresh
  the metrics/dashboard, "run the analytics cycle", update performance.md, or report on how published
  videos are doing — for ANY channel. Three deterministic engines: pull_analytics.py (the only network
  step — read-only Analytics API v2 + a single OAuth token refresh), build_dashboard.py (files → one
  offline HTML artifact), append_digest.py (rollup → dated performance.md block). Read-only over
  YouTube; never uploads, never changes a video. Do NOT use it to pick ideas (idea-generator), publish
  a video (publish-queue), or write scripts — it only measures what is already live.
---

# analytics-reporter

The read side of the pipeline's designed learning loop. `idea-generator` reads each channel's
`performance.md` to learn what worked; **this skill is the only thing that ever writes real numbers
toward it.** It measures videos that are already live — it never uploads, never changes a video, and
never makes any write to YouTube.

Data lives in **files**, not in the conversation: `analytics/<channel>/raw/<date>.json` (the archived
pull) and `analytics/<channel>/rollup.json` (the merged running record). The dashboard HTML is
**rebuilt from those files** and is disposable; the rollups are the durable artifact.

## Three engines

| Script | Role | Network? |
| --- | --- | --- |
| `scripts/pull_analytics.py` | Pull one channel's metrics → archive raw + merge into `rollup.json` | **YES** — read-only Analytics API v2 + one OAuth token refresh. The only networked step. |
| `scripts/build_dashboard.py` | All channels' `rollup.json` → one self-contained `dashboard.html` | No |
| `scripts/append_digest.py` | A channel's `rollup.json` → dated block appended to `performance.md` | No |

Metrics per video: **views, watch time** (estimatedMinutesWatched), **avg view duration**,
**retention curve** (audienceWatchRatio over elapsedVideoTimeRatio), **impressions CTR**, **subscribers
gained**.

## Run procedure

Dates are **caller-supplied** (`--date YYYY-MM-DD`) — never an ambient clock — so every run is
reproducible and archives land under a deterministic filename.

```bash
# 1. Pull (needs the three OAuth env vars — see Credentials). Read-only.
py -3 scripts/pull_analytics.py --channel the-second-take --date 2026-07-20

# 2. Rebuild the dashboard from every channel's rollup.
py -3 scripts/build_dashboard.py -o analytics/dashboard.html

# 3. Append the dated digest to the channel's performance.md (idempotent per date).
py -3 scripts/append_digest.py --channel the-second-take --date 2026-07-20
```

Video discovery is automatic: `pull_analytics.py` scans
`channels/<channel>/videos/*/publish-record.json` (the Task-9 upload record) and pulls only videos
that were actually published. `--video <slug>` limits a pull to one video.

## Freshness caveat (documented as correct fidelity)

YouTube Analytics **lags ~24-48h**. "Freshness" here is therefore *the last run's `--date`* — that IS
the correct fidelity, not a bug. The dashboard says so on its face; digests footnote it. Do not read a
stale-looking number as an error; read it as "as of the last pull".

## Failure = keep last-good

`build_dashboard.py` **refuses to write** when no channel has any video data (all rollups missing or
empty) — it returns non-zero and leaves the existing `dashboard.html` untouched. A failed pull can
never blank out the last good dashboard. Likewise `append_digest.py` is idempotent per date:
re-running the same `--date` **replaces** that day's block (fenced by `<!-- digest:<date> START/END -->`
markers), never duplicating it.

## Artifact republish (one stable URL)

The dashboard is ONE Claude artifact with a **stable URL kept in `DASHBOARD.md`** (org root). This
skill only writes the HTML file; the **orchestrator republishes** it to the same artifact URL after
each rebuild (pass that URL to the Artifact tool so it updates in place — do not mint a new one). The
HTML is fully self-contained (embedded CSS, inline SVG, no external scripts/styles/fonts/images), so it
publishes cleanly under the artifact CSP.

## Credentials (constitution-bound — the strictest part of this skill)

The three OAuth env vars — `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`,
`YOUTUBE_OAUTH_REFRESH_TOKEN` (from `.env`) — are read at **runtime only**, inside the single function
`_access_token()` in `pull_analytics.py`. That function is the ONLY place their names appear and the
ONLY token-minting network call. The minted access token flows only into `_fetch_report` (which owns
the `Authorization: Bearer` header); no parser, rollup, discovery, or file-writing function ever
receives it. urllib exception chains are scrubbed (`from None`) and error messages carry only an HTTP
status code — a token can never reach a log, a file, or a raised message. `test_no_secret_leak`
(`scripts/test_analytics.py`) enforces this by grepping the source; keep it green.

## Tests

```bash
cd scripts && py -3 -m unittest test_analytics -v
```

Network-free: the two networked functions (`_access_token`, `_fetch_report`) are never called by any
test. Coverage: `parse_report`/`retention_curve`/`video_metrics` against canned Analytics API v2
`resultTable` fixtures; `rollup` merge (later pull wins per video+date, no mutation);
`discover_videos`; dashboard render marks + self-containment + refuse-to-write-when-empty; digest
idempotency; and the secret-leak grep.
