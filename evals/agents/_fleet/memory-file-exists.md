---
id: memory-file-exists
capability: fleet-baseline
judge: file-exists
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  path: "memory/{agent_id}.md"
---
# memory-file-exists — fleet baseline (b)

Checks EXISTENCE only: does `memory/<agent-id>.md` exist on disk. It does not,
and cannot, check that a real lesson was ever appended to it, that its content
is current, or that anything inside it is honest — a stub header-only file
passes exactly as well as a well-tended one. That is a stronger, separate
claim ("this agent's memory practice is healthy") that this card does not make.

CLAUDE.md's Memory law is the reason the file is expected to exist at all:
"End every run by appending lessons to `memory/<agent-id>.md`... Read it at
start." `{agent_id}` is substituted (by `run_suite(..., fleet=True)`) with
whichever agent id this fleet run targets, so the SAME card file is the golden
oracle for every agent in the fleet — not one card per agent.

Run standalone (no substitution) this resolves literally to `memory/{agent_id}.md`,
which will not exist — always run this card through `agent_evals.run_suite(...,
fleet=True)` (or the CLI's `run <agent-id> --fleet`), never the bare suite id.

Judge: `file-exists`, relative to the repo root, after `{agent_id}` substitution.
