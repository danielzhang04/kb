---
id: routing-unknown-model
capability: routing-resolution
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  role: work
  tier: T1
  meta: {id: r3, owner: worker-desktop, runtime: claude, model: gpt-9-nonexistent}
  policy:
    runtimes:
      claude:
        aliases: {sonnet: claude-sonnet-5}
        known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
    policy:
      work:
        T1: {runtime: claude, model: sonnet}
expected:
  raises: RoutingError
---

# Canary: an unknown model fails LOUD

A card pinning a model absent from the runtime's `known_models` must raise
`RoutingError` — never a silent substitution (ordering-law 3). Guards the
fail-loud unknown-model posture of `routing.resolve`.
