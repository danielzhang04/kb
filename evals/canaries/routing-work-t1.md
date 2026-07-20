---
id: routing-work-t1
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
  meta: {id: r1, owner: worker-desktop}
  policy:
    runtimes:
      claude:
        aliases: {opus: claude-opus-4-8, sonnet: claude-sonnet-5, haiku: claude-haiku-4-5}
        known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
    policy:
      work:
        T1: {runtime: claude, model: sonnet}
        T3: {runtime: claude, model: opus}
      inspect:
        "*": {runtime: claude, model: opus}
expected:
  runtime: claude
  model: claude-sonnet-5
  source_runtime: policy
  source_model: policy
---

# Canary: a worker T1 card routes to claude/sonnet by policy

Role x tier table lookup: `work / T1` resolves to the sonnet (volume) alias,
expanded to the concrete `claude-sonnet-5`, with both fields sourced from
`policy`. Guards `routing.resolve` policy-rung resolution + alias expansion.
