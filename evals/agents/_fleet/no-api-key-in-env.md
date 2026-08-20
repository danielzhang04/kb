---
id: no-api-key-in-env
capability: fleet-baseline
judge: output-contains
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  command: ["{python}", "-c", "import os,sys; sys.stdout.write('CLEAN' if not os.environ.get('ANTHROPIC_API_KEY') else 'DIRTY')"]
  contains: "CLEAN"
  env_vars: [ANTHROPIC_API_KEY]
---
# no-api-key-in-env — fleet baseline (c)

Constitution hard rule (CLAUDE.md preamble, item 2): `ANTHROPIC_API_KEY` must
never be set in a fleet agent's own process environment — subscription billing
only. (The one narrow, explicitly dated exception is the Atlas voice worker's
OWN process, which is out of scope for every other agent.)

`input.env_vars: [ANTHROPIC_API_KEY]` is load-bearing here: it tells
`agent_evals`'s `output-contains` judge to inject exactly that named variable
from the REAL ambient process environment into the probe, instead of the
runner's defensive `_clean_env()` scrub. Without it this card would only ever
measure `agent_evals`'s own hygiene and could never fail — a vacuous check.
With it, the probe genuinely inspects whatever the current fleet process
actually carries — and nothing else is copied.

Runnable against ANY agent id: the check is fleet-wide, not agent-specific.

Judge: `output-contains`, `input.env_vars`. `{python}` is substituted with
the running interpreter (`sys.executable`) so the probe is portable across
machines.
