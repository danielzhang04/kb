---
id: preamble-api-key
capability: preamble-gate
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  stop_file: false
  env: {ANTHROPIC_API_KEY: sk-test-xxxx}
expected:
  has_problems: true
  problem_contains: ANTHROPIC_API_KEY
---

# Canary: a set ANTHROPIC_API_KEY fails the preamble

Subscription billing only. If `ANTHROPIC_API_KEY` is set, `preamble.check` must
flag it (a run would silently bill to the API). Guards the no-API-spend rule.
