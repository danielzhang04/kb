---
id: preamble-stop-file
capability: preamble-gate
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  stop_file: true
  env: {}
expected:
  has_problems: true
  problem_contains: STOP
---

# Canary: a STOP file freezes the preamble

STOP-file supremacy: with a `STOP` file present, `preamble.check` must report a
problem mentioning STOP so every actor halts. Guards the fleet-freeze chain the
whole constitution rests on.
