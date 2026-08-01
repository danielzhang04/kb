# Executive Dashboard
_Generated: 2026-08-01 06:12 UTC by dispatcher-cloud_

## Action required
No cards in `queue/approvals/`. Items addressed to / owned by a human that cannot move without Daniel:
| id | project | action | risk-tier |
|----|---------|--------|-----------|
| 6a5e482a-3b8707b5 | kb-ops | decide:budget-gate-measures-nothing | T3 |
| 6a605ebb-d86dff79 | kb-ops | wake-me:daemon-dir-drift-and-missing-sync-script | T1 |
| 6a6c3d8e-08b1da38 | kb-ops | wake-me:daemon-dir-drift-fyt-2026-07-31 | T1 |
| 6a5c7274-635d84bf | kb-ops | flip delivery-gate warn→block after clean soak | T2 |
| wake-daniel-2026-07-22-engagement-fold | faceless-youtube | wake:human-decision | T2 |

**New this run:** the weekly-audit (Saturday cadence) ran and found the **desktop scheduler is down** — all three desktop cadences (`grades-reconcile` weekly, `daemon-dirs-sync` daily, `self-lint-report` daily) produced nothing this week, and the daily `daemon-dirs-sync` not firing is exactly why the daemon-dir drift keeps re-appearing every night. Findings filed as unowned audit card `6a6d8e1e-ed8c8bdf`. No new wake-me was filed for the drift itself — tonight's `sync_daemon_dirs --check` is byte-identical to the 07-31 report already tracked by `6a6c3d8e`. Everything else awaiting Daniel is carried unchanged: budget-gate decision, delivery-gate flip, the two daemon-dir wakes, and the engagement-fold wake. Project gates also open: faceless-youtube PR #109 HELD (live 7/7 rerun after the Aug 1 9pm cap reset), the `claude/fyt-writer-grammar-slim` scripting-doctrine branch (UNMERGED, review-gated), Poyais GATE 3, and Atlas V2 "Trust" go/no-go.

## Queue
| state | count |
|-------|-------|
| inbox | 15 |
| working | 1 |
| halted | 1 |
| approvals | 0 |
| done | 135 |

(Counts are by card `state` field. `queue/inbox/` physically holds 19 files: 15 truly at `state:inbox` + 4 nightly cards at `state:done` stranded there — see Anomalies. `working` = tonight's in-flight `nightly-review` card; the `halted` card physically sits in `queue/working/`. `done` 135 = 131 in `queue/done/` + 4 stranded in `inbox/`.)

## Last 24h
- **Cadences:** `nightly-review` dispatched + self-executed tonight (2026-08-01, card `6a6d8ce3-05ec933a`); **`weekly-audit` dispatched + executed** tonight (Saturday cadence, card `6a6d8ce3-389fce18` → done, findings in `6a6d8e1e-ed8c8bdf`). Yesterday: `nightly-review` (2026-07-31, card `6a6c3cb8-f0d1ec65`).
- **Cost:** $0.00 API-billed vs **$5.00/day** cap → $5.00 remaining. The 28 steps logged on 07-31 (codex-worker executions) are all subscription-billed (`usd: 0.0`) — see the standing T3 card noting this gate measures nothing.
- **Health:** preamble OK; `sync_skills --check` clean; `sync_daemon_dirs --check` reports drift **unchanged from 07-31** (9 files, byte-identical; run from a `main` copy in refs-fallback — script still absent on ops).
- **Notable (weekly audit):** all CLOUD cadences healthy (`nightly-review` ran 7/7 days this week 07-26..08-01); all DESKTOP cadences dark since 2026-07-22. Grades + activity ledgers empty for the audit window (last rows 07-21) — nothing to reconcile, no orphans.

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21): all three gates passed at the desk; PR #44 MERGED + prod rolled out, Atlas view LIVE on 127.0.0.1:5317. V2 "Trust" planning awaits Daniel's go/no-go.
- **faceless-youtube** — Gated multi-agent pipeline SHIPPED to `main` (2026-07-31). PR #109 OPEN/HELD at `claude/fyt-full-run` `051de9e` (mechanical fixes + boot handshake; 88/88 tests, tsc clean, security APPROVED) — **only next action: live 7/7 rerun after the Aug 1 9pm weekly-cap reset; do not merge before Daniel's gate.** Scripting-doctrine branch `claude/fyt-writer-grammar-slim` UNMERGED, review-gated. Poyais parked at GATE 3 (thumbnail / L17 / publish). Engagement-fold staged (6 `eng-fold-*` cards) but PARKED on the queue-bridge decision.
- **kb-ops** — Wave A COMPLETE (2026-07-21): governed executor proven live. Daemon inert; daily `self-lint-report` cadence DORMANT (manual launch only via dashboard Workflows UI in a watched session).

## Anomalies
- **Desktop scheduler down (weekly-audit finding, WORSENED).** All three declared desktop cadences produced nothing this week: `grades-reconcile` (weekly), `daemon-dirs-sync` (daily), `self-lint-report` (daily, dormant-by-design). No desktop/`codex-worker` dispatch rows since 2026-07-22. Concrete harm: `daemon-dirs-sync` not firing means the main→ops daemon-dir drift is never auto-reconciled, so it re-reports every night. Tracked in audit card `6a6d8e1e-ed8c8bdf` (P1); decision is Daniel's (HEARTBEAT.md is human-edited only).
- **Daemon-dir drift (unchanged since 2026-07-31).** `sync_daemon_dirs.py --check` (main vs ops) reports the same 9 daemon-read files out of sync from the 07-31 fyt merge: 4 main-only (`agents/fyt-audio-render.md`, `agents/fyt-publish.md`, `agents/fyt-story.md`, `agents/fyt-visuals.md`) + 5 content-differs (`agents/fyt-checker.md`, `agents/fyt-preproduction.md`, `agents/fyt-production.md`, `agents/fyt-runner.md`, `orgs/faceless-youtube/workflows/video-run.md`). A desktop `sync_daemon_dirs.py --sync` from the dashboard-ops worktree is owed. Already tracked by wake card `6a6c3d8e-08b1da38`; no duplicate filed.
- **Missing script on ops.** `scripts/sync_daemon_dirs.py` exists on `origin/main` but not on `ops`, so the routine's literal step-2b invocation fails file-not-found; ran from a `main` copy this run. Tracked by standing wake card `6a605ebb-d86dff79`.
- **Stranded done-in-inbox (recurring, now 4).** `state:done` nightly cards physically in `queue/inbox/`: `6a5dbb3e-295a9d2b`, `6a5f0cef-53d31df4`, `6a605e40-ca81f0c8`, `6a65a3cd-dabf5d57`. Cosmetic; a one-time desk sweep clears it. Tracked in audit card P2.
- **Halted card in working/.** `6a6bc3dd-5494006b` (codex `iter-smoke-t2`, state:halted) parked in `queue/working/` since ~07-31 (STATE_DIR maps halted→working/). Confirm terminal + archive, or re-dispatch. Audit card P3.
- Preamble: PASS. No STOP file, no budget breach, no skill drift.
