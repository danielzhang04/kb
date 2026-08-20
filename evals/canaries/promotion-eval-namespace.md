---
id: promotion-eval-namespace
capability: eval-namespace-isolation
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  agent_id: demo-agent
  card_id: smoke
  repeats: 40
  real_task_type: build
  real_tier: T2
expected:
  verdict: queues-for-me
---
# promotion-eval-namespace — the isolation guarantee, as a Proving Grounds regression

Seeds a hermetic per-agent eval suite (`evals/agents/<agent_id>/`) in a tmp
tree, blesses it, runs it 40 times with `record=True` (`worker=eval-suite`,
`task_type=eval:<agent_id>:<card_id>`), then asserts `promotion.status()` for
the agent's OWN real task type (`build`, T2) is byte-identical to the
zero-rows baseline — still `queues-for-me`. This is `scripts/agent_evals.py`'s
core guarantee (T5), pinned here as a permanent substrate canary so a future
refactor that lets eval rows leak into an agent's own promotion streak fails
loud in the Proving Grounds suite, not only in one module's unit tests.

Checker: `_check_eval_namespace_isolation` (new, additive) in `scripts/canary.py`.
