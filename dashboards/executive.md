# Executive Dashboard
_Generated: 2026-07-22 06:08 UTC by dispatcher-cloud_

## Action required
Six cards await Daniel (all filed to `kb-ops`, none actionable by the fleet):
| id | project | action | risk-tier |
|----|---------|--------|-----------|
| 6a5d6b23-12ddfee2 | kb-ops | approve:oauth-gate-g1 | T3 |
| 6a5d6b23-05204b15 | kb-ops | approve:oauth-gate-g2 | T3 |
| 6a5d6b23-4c98aec0 | kb-ops | approve:oauth-gate-g3 | T3 |
| 6a5d6b23-17e8d1be | kb-ops | approve:oauth-gate-g4 | T3 |
| 6a5e482a-3b8707b5 | kb-ops | decide:budget-gate-measures-nothing | T3 |
| 6a5c7274-635d84bf | kb-ops | flip delivery-gate warn->block after clean soak | T2 |

The four `oauth-gate` cards (workflow `ws2-oauth-gates`) and the `budget-gate` decision
(workflow `fleet-arc-wave-a`) are owned by `human-operator`. The delivery-gate flip
(workflow `ecc-import-w2`) is BLOCKED until Daniel's wave-1 checkpoint.

## Queue
| state | count |
|-------|-------|
| inbox | 6 |
| working | 1 |
| done | 62 |
| approvals | 0 |

(working = tonight's nightly-review card, in-flight. done = 60 in queue/done/ + 2
nightly cards still sitting in queue/inbox/ at state:done — see Anomalies.)

## Last 24h
- Cadence: `cadence:nightly-review` dispatched and executed by dispatcher-cloud (this run).
  Prior nightly (6a5f0cef) completed 2026-07-21 06:09 UTC.
- Cost: $0.00 API-billed spent today vs $5.00/day cap → $5.00 remaining. All steps ran on
  subscription billing (logged 0.0). Yesterday: $0.00 billed, 2 activity rows.
- Notable: preamble OK; `sync_skills --check` clean; `sync_daemon_dirs --check` reports
  content drift on `orgs/kb-ops/workflows/self-lint-report.md` (main vs ops) — a desktop
  `--sync` is owed (wake-me card filed). The `sync_daemon_dirs.py` script is present on
  main but absent from ops.

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21): all three gates passed at the desk;
  PR #44 MERGED + prod rolled out, Atlas view LIVE on 127.0.0.1:5317 with live worker
  passthrough. V2 "Trust" planning awaits Daniel's go/no-go.
- **faceless-youtube** — PR #41 open (post-render tail + run-001 gate fixes + fyt-runner),
  reviewed READY TO MERGE; must merge with claude/fyt-video-run-test. Poyais parked at
  GATE 3 awaiting Daniel (thumbnail, L17, publish approval). fyt-run-001 parked.
- **kb-ops** — Wave A COMPLETE (2026-07-21): governed executor proven live (self-lint-report
  run-7b0b8de8, all 4 checks). Daemon inert; daily cadence DORMANT (no scheduler; launches
  manual via dashboard Workflows UI in a watched session).

## Anomalies
- **Daemon-dir drift:** `sync_daemon_dirs --check` flags `orgs/kb-ops/workflows/self-lint-report.md`
  content-differs between main and ops; a desktop `python scripts/sync_daemon_dirs.py --sync`
  (from the dashboard-ops worktree) is owed. Wake-me card filed to queue/inbox/.
- **Missing script on ops:** `scripts/sync_daemon_dirs.py` exists on main but not on the ops
  branch, so the routine's literal step-2b invocation fails file-not-found on ops; ran from a
  main copy this run. Flagged in the same wake-me card.
- **Stale done-in-inbox:** nightly cards 6a5dbb3e-295a9d2b and 6a5f0cef-53d31df4 sit in
  queue/inbox/ at state:done, never moved to queue/done/ (carried from prior runs).
- No stale cards in queue/working/ (empty at scan). No preamble failures.
