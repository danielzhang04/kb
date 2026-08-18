# Proposal: fleet-wide subagent governance

**Status:** PROPOSAL — requires human ratification; this document does not change live policy.
**Built:** 2026-08-18, Agent Platform Wave 1, unit U13.
**Ratification:** Open question for the human: should this become an extension to
`governance/agent-rules.md` or a standing standard under `docs/`? Committer: human.

## Purpose and scope

This proposal generalizes the boss-session dispatch discipline for every fleet orchestrator.
It governs how work is routed, bounded, reviewed, retried, and handed back. It complements the
editing rules in [file-editing guidelines](file-editing-guidelines.md); `CLAUDE.md`, project
contracts, and `governance/card-schema.md` remain authoritative for autonomy, branches, and task
cards.

## Route work through the owning policy

`governance/model-routing.yaml` is the human-edited routing policy. It maps role × risk tier to
a runtime and model; `scripts/routing.py` resolves that policy with this precedence: card
frontmatter, then `queue/routing-override.yaml`, then `model-routing.yaml`, then the built-in
default. This proposal does not duplicate that mapping in prose.

For a dispatch, stakes are only the orchestrator's judgment input when choosing a role and risk
tier. The routing subsystem then selects the runtime and model. Runtime verification likewise uses
the existing mechanism in `governance/agent-rules.md` §3: ledger the requested and responding
model IDs for every step, and file a wake-me card on a mismatch. At grading, verify the transcript
for an in-session subagent; do not treat the requested model alone as proof of what ran.

## Make every brief bounded and testable

Each worker brief states the exact files and functions in scope, the applicable local norms,
what the worker must not touch, and concrete acceptance criteria. The worker first restates the
acceptance and test list, but must not invent a looser acceptance bar. Supply the context needed
to work well, including established facts and the relevant tests, rather than asking a worker to
reconstruct them. For card-routed workers, encode the manager-authored work order and routing
metadata through the format in `governance/card-schema.md`.

### Commit, branch, and worktree lanes

- In the orchestrator-dispatched lane (Agent-tool and `dispatch-codex`), workers return their
  result and evidence and never commit. The orchestrator reviews the result and commits after the
  required review passes. A temporary worktree, if needed, is supplied and cleaned up by the
  orchestrator.
- In the card lane, `scripts/agent_runner.ps1` creates the per-run work branch and commits each
  card result on that agent branch. This is work-product handling under `CLAUDE.md` and
  `governance/agent-rules.md` §§2 and 7; the card-lane rules govern it rather than the
  orchestrator-dispatched rule above.

## Review independently before accepting

For a substantive unit, use two fresh-context reviews by agents other than the builder:

1. A deterministic acceptance review runs the tests and runnable demonstration, then checks the
   resulting diff adversarially.
2. A goal and coherence review asks whether the change serves the stated goal, fits existing
   patterns, avoids a bolt-on or duplicate subsystem, and integrates cleanly.

Both reviews inspect the actual output and verification evidence. A failure returns a specific
reason for bounded rework. These two fresh-context reviews are the build-time gate; the
inspector-card grade row in kb's standing inspector/grade/promotion trust loop is the platform's
durable trust record. They are complementary, not parallel. This review pattern relies on the
editing standards in [file-editing guidelines](file-editing-guidelines.md).

## Avoid spin and preserve responsiveness

The default cap is two review failures per unit, as set in the Wave-1 build plan. The dispatching
orchestrator may set a different cap only when it states that cap explicitly in the brief or card.
If the cap is reached, mark the unit BLOCKED, record the failure reason, and escalate rather than
repeatedly redispatching the same work. Use background dispatch for independent work so the
orchestrator remains available for human messages, monitoring, verification, and judgment while
workers run.

## Handle open judgment explicitly

When a consequential choice is not already decided by the task, use the safest reversible
default that remains within scope and leave a decision-note. Record decision-notes in the run's
report or card `Result`, following that run's convention. A decision-note is deferred judgment
surfaced to a human; it is not a work request. In contrast, following `CLAUDE.md`'s “when in
doubt, queue a card” rule, a card is the work request.

Do not guess on irreversible changes; block and escalate instead. Here, **BLOCKED** means the
unit has stopped after its stated cap or another stated blocker and its reason is recorded;
**escalate** means surface that recorded decision or blocker to the human with the action or
judgment needed to resume.

## Related sources

This proposal generalizes the per-unit pipeline in
`docs/plans/2026-08-18-agent-platform-w1-BUILD-PLAN.md` §2. Routing is owned by
`governance/model-routing.yaml` and `scripts/routing.py`; model-ledger verification is in
`governance/agent-rules.md` §3. The two lanes follow `CLAUDE.md`,
`governance/agent-rules.md` §§2 and 7, `scripts/agent_runner.ps1`, and
`skills/curated/dispatch-codex/SKILL.md`. It does not supersede any of them.

