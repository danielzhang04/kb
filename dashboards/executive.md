# Executive Dashboard
_Generated: 2026-08-14T06:53Z by dispatcher-cloud_

## Action required
- **Daemon-dir drift is standing (no new card filed).** The main→ops mirror is drifted, but the
  set is UNCHANGED from 2026-08-12 and is already covered by four standing inbox cards
  (`6a605ebb`, `6a6c3d8e`, `6a718533`, `6a7c0ebf`) — per the dedupe rule, no 5th card was filed.
  Owed at the desk: `python scripts/sync_daemon_dirs.py --sync` from the dashboard-ops worktree,
  plus a back-port-or-prune decision on the ops-only `orgs/kb-ops/workflows/acceptance-run.md`.
- No cards in `queue/approvals/`.

## Queue
| state | count |
|-------|-------|
| inbox | 25 |
| working | 2 (1 = this run's cadence card; 1 = halted/terminal record) |
| done | 520 |
| approvals | 0 |
| archived | 1 |

## Last 24h
- **Cadences run:** nightly-review dispatched today (card `6a7ebb0f-d6486103`, project kb) and
  yesterday (`6a7d5f9e-05862610`).
- **Cost vs budget:** structured cost ledger today = **$0.00 / $30.00** daily cap (14 rows, all
  subscription-billed codex steps: gpt-5.6-terra ×7, gpt-5.6-sol ×7). Yesterday: 85 rows, all
  subscription-billed in the usd column; a narrative row records ~**$1.05** of gemini-3-pro-image
  generation (bricks taste-forensics G4 slice, under its $5.00 slice cap — not charged to the
  daily USD guard).
- **Notable:** codex worker fleet active (sol/terra/luna models), all logged exit 0.

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21): all three gates passed, PR #44 merged
  (aa35b00), prod rolled out; Atlas view live on 127.0.0.1:5317. V2 "Trust" awaits Daniel's go/no-go.
- **faceless-youtube** — Active run **bricks-fresh** on `claude/bricks-doctrine-reset`; Phase 6B
  first tenth 18/25 slots verified, PAUSED at the P1–P5 human gate (shot board artifact).
  Poyais published; wells-fargo parked.
- **kb-ops** — Wave A complete; governed executor proven live. `self-lint-report` cadence exists
  but is DORMANT (no scheduler enabled; launches are manual via the dashboard Workflows UI while
  the gate is held in a watched session).

## Anomalies
- **Daemon-dir drift** (main→ops), standing/unchanged since 2026-08-12: 5 main-only files,
  5 content-differ, 1 ops-only extra. Reported, not auto-fixed (this gate never blocks dispatch);
  already tracked by standing cards `6a605ebb`/`6a6c3d8e`/`6a718533`/`6a7c0ebf`.
- **`scripts/sync_daemon_dirs.py` absent on `ops`** — routine step 2b fell back to main's copy
  (tracked by card `6a605ebb`).
- `queue/working/6a6bc3dd-5494006b.md` sits in working/ but is state `halted` (terminal, resolved
  by operator — known codex resume defect fixed in PR #103); not an active stall.
- preamble: OK. sync_skills --check: in sync (no drift).
