# Executive Dashboard
_Generated: 2026-08-07 06:11 UTC by dispatcher-cloud_

## Action required
- **wake-daniel-2026-07-22-engagement-fold** (faceless-youtube, wake:human-decision, T2) —
  engagement doctrine fold STAGED; governed-worker leg parked on an infra gap. Pick option
  1/2/3 in the card.
- **6a5e482a-3b8707b5** (kb-ops, decide:budget-gate-measures-nothing, T3) — human decision owed.
- **6a5c7274-635d84bf** (kb-ops, flip delivery-gate warn→block after clean soak, T2) — unowned;
  awaiting go-ahead.
- Standing wake-me cards (all T1, owner human-operator, daemon-dir sync owed on desktop):
  `6a605ebb` (sync_daemon_dirs.py missing on ops), `6a6c3d8e` (daemon-dir drift 07-31),
  `6a718533` (drift grew 08-04). Drift set unchanged since 08-04.

No cards in `queue/approvals/`.

## Queue
| state | count |
|-------|-------|
| inbox | 17 |
| working | 2 |
| approvals | 0 |
| done | 285 |
| archived | 1 |

_working/: `6a75768f` (this nightly-review card, active) and `6a6bc3dd` (halted — codex
resume defect, resolved by operator via PR #103; record-only, no rerun)._

## Last 24h
- Cadence: nightly-review dispatched + executed (card `6a75768f`, this run). Yesterday's
  nightly-review card `6a74262f` completed.
- Cost vs budget ($30.00/day API-billed): **today ≈ $0.00** (5 codex-direct runs, all
  subscription-billed $0). **Yesterday ≈ $0.05** — one Gemini image call (root, bricks-fresh
  R1 style fix) + 21 codex-direct subscription runs ($0) + 4 dispatcher-cloud steps ($0).
  Well under budget.
- Health: preamble OK; pyyaml OK; sync_skills --check clean. sync_daemon_dirs.py absent on ops
  (known — card `6a605ebb`); ran the origin/main copy in refs-fallback: 10 daemon-read files
  drifted (5 main-only, 5 content-differs), **identical to the 08-04 report** — no new card filed.

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21): all three gates passed, PR #44 merged
  (aa35b00), prod rolled out and LIVE on 127.0.0.1:5317 with live worker passthrough. V2
  "Trust" planning awaits Daniel's go/no-go.
- **faceless-youtube** — Active run **bricks-fresh** (`claude/bricks-doctrine-reset`, dd22f97);
  era doctrine + R1 saturation fix live. Phase 6B first tenth: 18/25 slots verified, PAUSED at
  the P1–P5 human gate. Resume via `handoffs/2026-08-06-fyt-bricks-p6b-gate.md`. Poyais
  published; wells-fargo parked.
- **kb-ops** — Wave A COMPLETE (2026-07-21): governed executor proven live (run-7b0b8de8, all 4
  runbook checks). Daemon inert; gate off outside watched sessions. Daily `self-lint-report`
  cadence exists but DORMANT (no scheduler; manual launch via dashboard Workflows UI).

## Anomalies
- **sync_daemon_dirs.py missing on ops branch** (present on origin/main) — recurring; tracked by
  standing card `6a605ebb`. Root cause: dark desktop `daemon-dirs-sync` cadence. Cloud routine
  reports, cannot fix.
- **main→ops daemon-dir drift**: 10 files out of sync (unchanged since 08-04). Owed: desktop
  `python scripts/sync_daemon_dirs.py --sync` from the dashboard-ops worktree.
- `6a6bc3dd` sits in working/ as `halted` — terminal/resolved (PR #103), not a live stall.
