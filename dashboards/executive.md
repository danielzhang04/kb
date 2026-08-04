# Executive Dashboard
_Generated: 2026-08-04 06:21 UTC by dispatcher-cloud_

## Action required
No cards in `queue/approvals/` (0). Items owned by / addressed to a human that cannot move
without Daniel (currently parked in `queue/inbox/`):
| id | project | action | risk-tier |
|----|---------|--------|-----------|
| 6a5e482a-3b8707b5 | kb-ops | decide:budget-gate-measures-nothing | T3 |
| 6a605ebb-d86dff79 | kb-ops | wake-me:daemon-dir-drift-and-missing-sync-script | T1 |
| 6a6c3d8e-08b1da38 | kb-ops | wake-me:daemon-dir-drift-fyt-2026-07-31 | T1 |
| 6a5c7274-635d84bf | kb-ops | flip delivery-gate warn→block after clean soak | T2 |
| wake-daniel-2026-07-22-engagement-fold | faceless-youtube | wake:human-decision | T2 |

**Unowned audit findings still needing a decision:** `6a6d8e1e-ed8c8bdf` (weekly-audit
2026-08-01) and `6a645395-d5322124` (weekly-audit 2026-07-25). Root theme persists: the
**desktop scheduler is down** — the desktop cadences (`grades-reconcile`, `daemon-dirs-sync`,
`self-lint-report`) have produced nothing since 2026-07-22. The dark `daemon-dirs-sync` is the
root cause of the daemon-dir drift that re-reports every night. Fix is Daniel's (HEARTBEAT.md is
human-edited only). Project gates also open: faceless-youtube PR #109 HELD (live 7/7 rerun after
the Aug 1 cap reset), `claude/fyt-writer-grammar-slim` (UNMERGED, review-gated), PR #41 (READY,
must merge with its dashboard companion), Poyais GATE 3, and Atlas V2 "Trust" go/no-go.

## Queue
| state (by directory) | count |
|----------------------|-------|
| inbox | 15 |
| working | 2 |
| approvals | 0 |
| done | 224 |

(`queue/working/` holds two cards: `6a6bc3dd-5494006b` at `state:halted` — terminal, see
Anomalies — and this run's own nightly card `6a718488-42339b3e`, which completes to `queue/done/`
before this cycle ends, leaving working at one halted card.)

## Last 24h
- **Cadences:** `nightly-review` dispatched + self-executed tonight (2026-08-04, card
  `6a718488-42339b3e`, dispatcher-cloud). Prior run 2026-08-03: `nightly-review` (`6a703143-21e1b608`).
- **Cost:** $0.00 API-billed today vs **$30.00/day** limit → **$30.00 remaining**. 17 cost rows
  logged today, all subscription-billed at `usd: 0.0` (codex models gpt-5.6-terra / gpt-5.6-sol),
  every step `codex_exit: 0`. Yesterday: 70 rows, likewise $0.00.
- **Health:** preamble OK; `sync_skills --check` clean (exit 0); step-2b daemon-dir gate reports
  DRIFT (run from an `origin/main` copy in refs-fallback because `scripts/sync_daemon_dirs.py` is
  still absent on ops) — one NEW main-only file since 07-31 (see Anomalies).

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21): all three gates passed at the desk; PR #44
  MERGED + prod rolled out, Atlas view LIVE on 127.0.0.1:5317. V2 "Trust" planning awaits Daniel's
  go/no-go.
- **faceless-youtube** — Gated multi-agent pipeline SHIPPED to `main` (2026-07-31). PR #109
  OPEN/HELD at `claude/fyt-full-run` `051de9e` (mechanical fixes + boot handshake; 88/88 tests,
  tsc clean, security APPROVED) — **only next action: live 7/7 rerun after the Aug 1 9pm cap
  reset; do not merge before Daniel's gate.** Scripting-doctrine branch
  `claude/fyt-writer-grammar-slim` UNMERGED, review-gated. PR #41 (post-render tail) READY, must
  merge with its dashboard companion. Poyais parked at GATE 3 (thumbnail / L17 / publish).
- **kb-ops** — Wave A COMPLETE (2026-07-21): governed executor proven live. Daemon inert; daily
  `self-lint-report` cadence DORMANT (manual launch only via dashboard Workflows UI in a watched
  session).

## Anomalies
- **Desktop scheduler down (weekly-audit finding).** The declared desktop cadences have produced
  nothing since 2026-07-22 (no desktop/`worker-desktop` dispatch rows). Concrete harm:
  `daemon-dirs-sync` not firing means the main→ops daemon-dir drift is never auto-reconciled, so it
  re-reports every night. Tracked in audit cards `6a6d8e1e-ed8c8bdf` and `6a645395-d5322124`;
  decision is Daniel's (HEARTBEAT.md is human-edited only).
- **Daemon-dir drift — GREW this run.** `sync_daemon_dirs.py --check` (origin/main vs origin/ops)
  now reports 10 daemon-read files out of sync: **5 main-only** (`agents/fyt-audio-render.md`,
  `agents/fyt-publish.md`, `agents/fyt-story.md`, `agents/fyt-visuals.md`, and **NEW:**
  `orgs/faceless-youtube/workflows/thin-slice-run.md`) + **5 content-differs** (`agents/fyt-checker.md`,
  `agents/fyt-preproduction.md`, `agents/fyt-production.md`, `agents/fyt-runner.md`,
  `orgs/faceless-youtube/workflows/video-run.md`). The `thin-slice-run.md` entry is new vs the
  07-31 report; a fresh wake-me card was filed this run. A desktop `sync_daemon_dirs.py --sync`
  from the dashboard-ops worktree is owed. Also tracked by `6a6c3d8e` / `6a605ebb`.
- **Missing script on ops.** `scripts/sync_daemon_dirs.py` exists on `origin/main` but not on
  `ops`, so the routine's literal step-2b invocation fails file-not-found; ran from an `origin/main`
  copy this run. Tracked by standing wake card `6a605ebb-d86dff79`.
- **Halted card in working/.** `6a6bc3dd-5494006b` (codex `iter-smoke-t2`, state:halted) parked in
  `queue/working/` since ~07-30 (>48h). Terminal — its `## Result` shows it was resolved by the boss
  (known `codex exec resume --cd` defect, fixed in PR #103); confirm + archive on the desktop, no
  rerun needed. Tracked in audit card `6a6d8e1e-ed8c8bdf`. NOTE: cloud-checkout file mtimes read as
  fresh-clone time, so working-card staleness is judged by ULID/history, not mtime.
- Preamble: PASS. No STOP file, no budget breach, no skill drift. No other working card >48h.
