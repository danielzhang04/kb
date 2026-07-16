# Risk tiers

Autonomy is earned per task-type × tier (ledgers/grades/). Wording is binding.

| Tier | Examples | Promotion bar | Demotion floor |
|---|---|---|---|
| T1 | wiki updates, lint fixes, reports, dashboard regen | 10 passes ≥ 90% | < 80% |
| T2 | code on branches, research deliverables | 20 passes ≥ 95% | < 90% |
| T3 | merge to main, external publishing, deploys | 40 passes ≥ 98% → fast-lane approval only; NEVER executes without a human approval token (v1) | any failure |
| T4 | credentials-as-objects, real money | never unattended, never carded | — |

v1: AGENT-GENERATED task types start supervised (queues-for-me) regardless of tier.
Standing authorization (decided 2026-07-15): a cadence a human authored and committed to a
HEARTBEAT.md on protected `main` is pre-approved at its declared risk tier — the human
approved it by authoring it. Earned per-task-type autonomy (the grade ledger) governs
everything agents generate themselves.
Carve-out — `cadence:nightly-review` (added 2026-07-16): the human-authored `nightly-review`
cadence (declared `risk-tier: T1` in the root `HEARTBEAT.md` on protected `main`) is authorized to
**act alone at T1 for any trigger** — scheduled or manual Run-now — with its writes limited to the
following enumerated allow-list. It does NOT queue-for-me while every write stays inside this list:
- `dashboards/**`
- the agent's own memory shard `memory/<agent-id>.md`
- `ledgers/dispatch/**` (the cadence's own dispatch rows only)
`ledgers/cost/**` (the cadence's own cost rows only — a non-integrity ledger)
- the cadence's **own** card `queue/` state transition — moving *its own* card to `queue/done/`
  with a `## Result` — and emitting **wake-me cards into `queue/inbox/`** (this is queueing work
  for a human/dispatcher, not acting on it)

Excluded from the carve-out (verbatim): `ledgers/grades/**` and `ledgers/activity/**` (integrity
streams), any **other** agent's memory shard, `governance/**`, `orgs/*/contract.md`, and any project
work tree. Any write outside the enumerated allow-list — including any of the excluded paths — voids
the carve-out for that run, which reverts to queues-for-me (the card goes to `queue/approvals/`).
This carve-out names `nightly-review` only; no other cadence inherits it.