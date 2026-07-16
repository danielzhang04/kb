# Executive Dashboard
_Generated: 2026-07-16 19:45 UTC by dispatcher-cloud_

## Action required
- **Wake-me (T1) — governance/work-order mismatch:** the `nightly-review` work order
  and `routines/nightly.md` direct writes that fall **outside** the `cadence:nightly-review`
  carve-out allow-list added to `governance/risk-tiers.md` today: `memory/nightly-reviewer.md`
  (a role shard ≠ the acting agent's own `memory/dispatcher-cloud.md`) and `ledgers/cost/**`
  (only `ledgers/dispatch/**` is enumerated). See wake-me card in `queue/inbox/`. Human to
  reconcile: either broaden the carve-out or trim the work order/routine.
- No approvals cards pending.

## Queue
| state | count |
| --- | --- |
| inbox | 1 (wake-me, this run) |
| working | 0 |
| approvals | 0 |
| done | 2 |

## Last 24h
- Cadence **kb-nightly-review** — dispatched 2026-07-16 (card `6a593421-0a5a0c92`) and
  2026-07-15 (card `6a581e05-36cf29da`, executed via desktop fallback after human approval).
- Cost: **$0.00 of $5.00** daily limit used (all logged model steps subscription-billed, usd 0.0). Remaining $5.00.
- Health: `python scripts/preamble.py` -> PREAMBLE OK; `python scripts/sync_skills.py --check` -> exit 0, no drift.
- Notable: this run acted alone under the new nightly-review carve-out — regenerated both
  dashboards and wrote its own memory shard, staying strictly inside the allow-list; deferred
  the two out-of-list writes to a human via wake-me card rather than voiding the carve-out.

## Projects
- **faceless-youtube** — scaffolded 2026-07-15; STATE "Now" empty, nothing in flight yet.

## Anomalies
- Governance/work-order mismatch (see Action required) — recurs every nightly run until reconciled.
- No stale (>48h) `working/` cards, no skill-registry drift, preamble passing, budget well under ceiling.
