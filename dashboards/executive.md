# Executive Dashboard
_Generated: 2026-08-09 06:11 UTC by dispatcher-cloud_

## Action required
No `approvals/` cards pending. However, five human-owned cards sit in `queue/inbox/` awaiting Daniel:
- `6a5e482a` — kb-ops — decide:budget-gate-measures-nothing (T1)
- `6a605ebb` — kb-ops — wake-me:daemon-dir-drift-and-missing-sync-script (T1)
- `6a6c3d8e` — kb-ops — wake-me:daemon-dir-drift-fyt-2026-07-31 (T1)
- `6a718533` — kb-ops — wake-me:daemon-dir-drift-grew-thin-slice-2026-08-04 (T1)
- `wake-daniel-2026-07-22-engagement-fold` — faceless-youtube — wake:human-decision

## Queue
| state | count |
|-------|-------|
| inbox | 18 |
| working | 2 |
| done | 289 |
| approvals | 0 |
| blocked | 0 |
| rejected | 0 |
| approved | 0 |

## Last 24h
- Cadences: nightly-review dispatched today (card `6a7819b3`, this run); yesterday (08-08) ran nightly-review + weekly-audit.
- Cost: $0.00 today, $0.00 on 08-08 — all steps subscription-billed (logged 0.0). Budget $30.00/day; remaining $30.00.
- Working cards (2): `6a6bc3dd` iter-smoke-t2 (codex-worker, kb-ops, started 06:09) and `6a7819b3` this nightly-review (dispatcher-cloud). Neither stale.
- Notable inbox backlog: 3 weekly-audit findings cards (kb, unassigned), 6 faceless-youtube engagement-fold draft cards + 2 self-lint reports + 1 slice-dossier (worker-desktop/dashboard-engine owned).

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21), all three gates passed; PR #44 merged + prod rolled out, Atlas view live on 127.0.0.1:5317. V2 "Trust" = Daniel's go/no-go.
- **faceless-youtube** — Active run bricks-fresh on `claude/bricks-doctrine-reset`; Phase 6B first tenth 18/25 slots verified, PAUSED at the P1-P5 human gate. Poyais published; wells-fargo parked.
- **kb-ops** — Wave A complete (governed executor proven live). Daily self-lint-report cadence exists but is DORMANT (no scheduler; manual launches only while the gate is held in a watched session).

## Anomalies
- **Daemon-dir drift (standing):** main→ops mirror check reports 10 out-of-sync daemon-read files (5 main-only, 5 content-differs) — unchanged from the 2026-08-04 report already tracked by card `6a718533`. No new wake-me card filed. A desktop `python scripts/sync_daemon_dirs.py --sync` from the dashboard-ops worktree is owed.
- **Missing script on ops (standing):** `scripts/sync_daemon_dirs.py` exists on `origin/main` but not on `ops`; the literal step-2b check fails file-not-found. This run worked around it by running the `origin/main` copy. Tracked by card `6a605ebb`.
- Stale working/ cards: None (both working cards started today).
- Preamble: PASSED. sync_skills --check: in sync.
