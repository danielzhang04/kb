---
id: routing-card-precedence
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
  meta: {id: r4, owner: worker-desktop, runtime: claude, model: claude-opus-4-8}
  policy:
    runtimes:
      claude:
        aliases: {sonnet: claude-sonnet-5, opus: claude-opus-4-8}
        known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
    policy:
      work:
        T1: {runtime: claude, model: sonnet}
expected:
  runtime: claude
  model: claude-opus-4-8
  source_runtime: card
  source_model: card
---

# Canary: card frontmatter outranks policy

A card that pins `runtime`/`model` wins over the policy table (a human pinned
this card). Even though `work / T1` policy says sonnet, the card's opus wins and
both fields are sourced from `card`. Guards the precedence chain rung 1.
