# Executive Dashboard
_Generated: 2026-08-16 06:10 UTC by dispatcher-cloud_

## Action required
None in `queue/approvals/` (empty). Note, though, that several **human-owned decision cards** are parked in `queue/inbox/` awaiting you:
- `6a5e482a` — decide:budget-gate-measures-nothing (**T3**, human-operator)
- `6a605ebb`, `6a6c3d8e`, `6a718533`, `6a7c0ebf` — four wake-me:daemon-dir-drift cards (T1, human-operator), accumulated across prior runs
- `wake-daniel-2026-08-15-sync-daemon-dirs-missing` (T1) and `wake-daniel-2026-07-22-engagement-fold` (T2)

## Queue
| state | count |
|-------|-------|
| inbox | 28 |
| working | 1 |
| done | 541 |
| approvals | 0 |

Inbox breakdown (28): this run's `nightly-review` card (`6a81540b`, currently *working*); 7 human-owned wake/decide cards (listed above); 4 unowned `audit:weekly-findings*` / `audit-gap` cards from prior weekly audits; 1 unowned `flip delivery-gate warn→block` card; 6 staged `eng-fold-*` trigger cards (faceless-youtube, `blocked`); 9 `wf-*` workflow cards (kb-ops/faceless, `worker-desktop`, mix of inbox/blocked). Working (1): the terminal `halted` record `6a6bc3dd` (kb-ops iter-smoke-t2), operator-resolved, parked in `working/` since 2026-07-30 — not a live stall.

## Last 24h
- **Cadences dispatched:** today (08-16) — `nightly-review` (`6a81540b-dbe16453`), cloud tier, 1 card. Weekly-audit was not due today. Yesterday (08-15) — nightly-review + weekly-audit both ran and have since completed (they account for the +2 in `done/`, now 541).
- **Cost vs budget:** daily limit $30.00. Today: $0 API-billed so far (this run mid-flight; steps are subscription $0). Yesterday (08-15): $0 API-billed — the 2 logged steps (nightly-review, weekly-audit) were subscription claude-opus-4-8 at $0. Comfortably under budget.
- **Notable:** clean night — preamble, pyyaml, and skill-sync all passed. The weekly audit that ran yesterday filed a fresh `audit-gap:desktop-cadences-dormant` card (`6a80039d`) into inbox.

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21), PR #44 merged + prod rolled out; Atlas view live on 127.0.0.1:5317. V2 "Trust" awaits Daniel's go/no-go.
- **faceless-youtube** — Active run **bricks-fresh** on `claude/bricks-doctrine-reset`; Phase 6B first tenth (18/25 slots verified), PAUSED at the P1–P5 human gate. wells-fargo parked; Poyais published.
- **kb-ops** — Wave A complete; governed executor proven live. Daily `self-lint-report` cadence is DORMANT (no scheduler; manual dashboard launch only, gate held in a watched session).

## Anomalies
- **Missing gate script (persisting):** `scripts/sync_daemon_dirs.py` (nightly routine step 2b) still does not exist — the main→ops daemon-dir drift check could not run (exit 2, file not found). A wake-me card for this (`wake-daniel-2026-08-15-sync-daemon-dirs-missing`) is already in `queue/inbox/` from the prior run, so **no duplicate was filed** this run. A desktop restore/reconcile is owed. Non-blocking (the gate reports, never blocks dispatch).
- **Daemon-dir wake cards accumulating:** four human-operator `wake-me:daemon-dir-drift` cards (`6a605ebb`, `6a6c3d8e`, `6a718533`, `6a7c0ebf`) plus the two `wake-daniel-*` cards are piling up in inbox — the recurring drift/missing-script issue has no owner picking it up. Worth a single desktop pass to clear.
- Terminal `halted` card `6a6bc3dd` sits in `working/` (operator-resolved codex smoke record, 2026-07-30) — cosmetic; not a live stall.
- No cost/activity ledger rows yet today (expected mid-run).
