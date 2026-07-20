---
id: ledger-roundtrip
capability: ledger-shard
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  mode: roundtrip
  kind: dispatch
  agent: worker-desktop
  record:
    card_id: c-300
    event: claimed
    role: work
expected:
  ok: true
---

# Canary: a ledger append round-trips through read_day

A row appended to a `dispatch` shard must be readable back the same day via
`ledger.read_day`. Guards the sharded git-native ledger's append/read contract.
