---
id: smoke
capability: agent-baseline
judge: file-exists
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  path: CLAUDE.md
---
# smoke — demo-agent baseline

The first golden card of the per-agent eval layer. It asserts the floor every kb
agent stands on: the constitution is present in the tree the agent runs in, so
`spin-up`, branch rules, and the hard ceiling are loadable at all.

Deliberately deterministic and cheap: this suite is the tamper-anchored proof
that the runner, the manifest discipline, and the reserved grade namespace all
work end to end. Richer demo-agent cards (its own def, memory file, and a
model-judged task) land on top of this one — never in place of it.

Judge: `file-exists`, `input.path` relative to the repo root.
Grade row: `worker=eval-suite`, `task_type=eval:demo-agent:smoke` — a reserved
namespace that `promotion.status()` can never count toward demo-agent's own
autonomy.
