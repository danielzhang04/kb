---
id: def-parses-in-roster-shape
capability: fleet-baseline
judge: pytest
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  test_file: evals/agents/_fleet/test_def_parses_in_roster_shape.py
---
# def-parses-in-roster-shape — fleet baseline (a)

Runnable against ANY agent id: this card is shared, not per-agent. Its judge is
a parameterized pytest test that walks every `agents/*.md` file in the repo and
asserts each one's frontmatter parses and carries the canonical roster-shape
field set (`id, role, runtime, model, default-profile, allowed-profiles,
projects, runner-bound, description` — the agent-infra plan's Task 4
interfaces). A `status: superseded` def is exempt from the full set but must
still parse and self-identify.

Judge: `pytest`, `input.test_file` = `evals/agents/_fleet/test_def_parses_in_roster_shape.py`.
