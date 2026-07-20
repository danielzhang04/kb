---
id: promotion-frozen
capability: promotion-decide
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  mode: frozen
  worker: worker-desktop
  project: kb
  task_type: report
  tier: T1
  rows: []
expected:
  verdict: queues-for-me
---

# Canary: a FROZEN sentinel fails closed

When `ledgers/grades/FROZEN` exists, the promotion loop is frozen: `is_frozen`
is true and `promotion.status` must return `queues-for-me` regardless of history.
Guards the integrity-freeze fail-closed path.
