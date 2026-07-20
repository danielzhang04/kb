---
id: ledger-cost-today
capability: ledger-shard
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  mode: cost_today
  agent: worker-desktop
  costs:
    - {card_id: c-301, usd: 0.12, model: claude-sonnet-5}
    - {card_id: c-302, usd: 0.08, model: claude-sonnet-5}
expected:
  total: 0.2
---

# Canary: cost_today sums the day's cost rows

Two cost rows (0.12 + 0.08) must sum to 0.20 via `ledger.cost_today`. Guards the
budget accounting the preamble's daily-limit gate depends on.
