# Executive Dashboard
_Generated: 2026-08-10 06:29 UTC by dispatcher-cloud_

## Action required
None — 0 cards in `queue/approvals/`.

## Queue
| state | count |
|-------|-------|
| inbox | 18 |
| working | 2 |
| approvals | 0 |
| done | 290 |

## Last 24h
- Cadences dispatched: nightly-review (today, card `6a796f91-0539653e`, running now); 1 dispatch yesterday (`6a7819b3-2ca13954`).
- Cost: $0.00 spent today (subscription-billed steps log 0.0) against the $30.00/day ceiling — full budget remaining.
- Health: preamble OK; `sync_skills --check` in sync; `sync_daemon_dirs --check` (run from the `origin/main` copy, refs-fallback mode) reports the standing 10-file drift, unchanged (see Anomalies).
- Notable results: no new work-product cards completed; queue steady.

## Projects
- **atlas** — V1 "HANDS" wave complete (2026-07-21), all three gates passed, PR #44 merged and rolled to prod; Atlas view live on 127.0.0.1:5317. V2 "Trust" awaits Daniel's go/no-go.
- **faceless-youtube** — Active run *bricks-fresh* on `claude/bricks-doctrine-reset`; Phase 6B first tenth (18/25 slots verified) PAUSED at the P1–P5 human gate. Poyais published; wells-fargo parked.
- **kb-ops** — Wave A complete; governed executor proven live. Daily `self-lint-report` cadence exists but is DORMANT (manual launch only; gate off outside watched sessions).

## Anomalies
- **Daemon-dir drift (standing, unchanged):** `sync_daemon_dirs --check` reports 10 files out of main→ops sync — 5 main-only (`agents/fyt-audio-render.md`, `agents/fyt-publish.md`, `agents/fyt-story.md`, `agents/fyt-visuals.md`, `orgs/faceless-youtube/workflows/thin-slice-run.md`) and 5 content-differ (`agents/fyt-checker.md`, `agents/fyt-preproduction.md`, `agents/fyt-production.md`, `agents/fyt-runner.md`, `orgs/faceless-youtube/workflows/video-run.md`). Identical to prior runs; a desktop `sync_daemon_dirs.py --sync` from the dashboard-ops worktree is owed. Already covered by standing wake-me cards `6a605ebb`, `6a6c3d8e`, `6a718533` — no new card filed (dedupe).
- **`sync_daemon_dirs.py` absent on `ops`:** the script lives on `origin/main`/desktop only and is not on the `ops` branch; the cloud run executes the `origin/main` copy in refs-fallback mode. Recurring; covered by the standing cards above.
- **Halted card in working/:** `6a6bc3dd-5494006b` (kb-ops, `iter-smoke-t2`, owner codex-worker) sits in `queue/working/` at terminal state `halted`.
- No preamble failures; no drift from `sync_skills`.
