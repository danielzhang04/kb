# Executive Dashboard
_Generated: 2026-08-15 06:11 UTC by dispatcher-cloud_

## Action required
None — `queue/approvals/` is empty.

## Queue
| state | count |
|-------|-------|
| inbox | 25 |
| working | 3 |
| done | 539 |
| approvals | 0 |

Inbox breakdown: 9 workflow (`wf-*`) cards, 6 staged `eng-fold-*` trigger cards, 1 human-decision wake card (engagement-fold), plus 9 other unowned/pending cards. Working: the 2 cadence cards this run just claimed (nightly-review, weekly-audit) plus 1 terminal `halted` record (`6a6bc3dd` kb-ops iter-smoke-t2) parked in `working/` since 2026-07-30.

## Last 24h
- **Cadences dispatched:** today — nightly-review (`6a8002dc-9cc4137d`), weekly-audit (`6a8002dc-99084e9a`), both cloud tier. Yesterday (08-14) — nightly-review ran.
- **Cost vs budget:** daily limit $30.00. Today: $0 API-billed so far (this run mid-flight; codex steps are subscription $0). Yesterday: ~$3.98 API-billed — gemini image work on bricks taste-forensics (rate correction +$2.945, engine A/B $1.038); ~33 codex `gpt-5.6-*` steps at $0 (subscription). Well under budget.
- **Notable:** bricks A/B duel recorded (gemini-3-pro-image 5/5 delivered vs gemini-2.5-flash-image 4/5); a rate-correction row fixed an under-billed gemini gen rate ($0.039→$0.134/gen).

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21), PR #44 merged + prod rolled out; Atlas view live on 127.0.0.1:5317. V2 "Trust" awaits Daniel's go/no-go.
- **faceless-youtube** — Active run **bricks-fresh** on `claude/bricks-doctrine-reset`; Phase 6B first tenth (18/25 slots verified), PAUSED at the P1–P5 human gate. wells-fargo parked; Poyais published.
- **kb-ops** — Wave A complete; governed executor proven live. Daily `self-lint-report` cadence is DORMANT (no scheduler; manual dashboard launch only, gate held in a watched session).

## Anomalies
- **Missing gate script:** `scripts/sync_daemon_dirs.py` (nightly routine step 2b) does not exist — the main→ops daemon-dir drift check could not run (exit 2, file not found). Reported via wake-me card; a desktop reconcile/restore is owed. Non-blocking (the gate reports, never blocks dispatch).
- Terminal `halted` card `6a6bc3dd` sits in `working/` (resolved codex-direct smoke record from 2026-07-30) — cosmetic; not a live stall.
- No cost/activity ledger rows yet today (expected mid-run).
