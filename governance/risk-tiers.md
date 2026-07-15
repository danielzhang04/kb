# Risk tiers

Autonomy is earned per task-type × tier (ledgers/grades/). Wording is binding.

| Tier | Examples | Promotion bar | Demotion floor |
|---|---|---|---|
| T1 | wiki updates, lint fixes, reports, dashboard regen | 10 passes ≥ 90% | < 80% |
| T2 | code on branches, research deliverables | 20 passes ≥ 95% | < 90% |
| T3 | merge to main, external publishing, deploys | 40 passes ≥ 98% → fast-lane approval only; NEVER executes without a human approval token (v1) | any failure |
| T4 | credentials-as-objects, real money | never unattended, never carded | — |

v1: ALL task types start supervised (queues-for-me) regardless of tier.
