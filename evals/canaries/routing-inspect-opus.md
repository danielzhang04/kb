---
id: routing-inspect-opus
capability: routing-resolution
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  role: inspect
  tier: T2
  meta: {id: r2, owner: worker-desktop}
  policy:
    runtimes:
      claude:
        aliases: {opus: claude-opus-4-8, sonnet: claude-sonnet-5, haiku: claude-haiku-4-5}
        known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
    policy:
      work:
        T1: {runtime: claude, model: sonnet}
      inspect:
        "*": {runtime: claude, model: opus}
expected:
  runtime: claude
  model: claude-opus-4-8
  source_model: policy
---

# Canary: inspect routes to opus via the wildcard tier

Grading runs on the strongest tier. `inspect / T2` has no exact tier entry, so
the `"*"` wildcard supplies opus (`claude-opus-4-8`). Guards the wildcard
fall-through in `routing._policy_entry`.
