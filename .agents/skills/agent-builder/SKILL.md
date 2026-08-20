---
name: agent-builder
description: Create or iterate on a kb agent declaration and its draft eval suite. Use when a terminal is asked to create a new agent, define an agent role, revise an existing agent, add agent permissions or loop bounds, or draft evaluation cards for an agent.
---

# agent-builder

Build a bounded, reviewable agent instead of turning its definition into a second
constitution.

Runtime scope: desktop authoring only. This skill changes `agents/`, `skills/`, or
`evals/`, which are not VM outbox coordination paths and cannot be published by the
hardened VM. A VM worker may inspect the skill but must not invoke its authoring flow.
The command examples remain platform-resolved so deterministic review works in any
trusted authoring environment.

## Inheritance map

- **Kit** is shared doctrine.
- **`_fleet` evals** are the shared evaluation floor.
- **Factory** is the canonical declaration, memory, and suite shape.

Put anything agent-general in one of those three layers, never in one agent definition.
The definition carries only that agent's job-specific behavior. Read
`references/guidelines.md` before choosing a mandate, bounds, or evals.

## Eval-authoring gate

Before any eval-related step, check `governance/agent-rules.md` §8. Under the
current rule (agents never touch `evals/`), STOP at a proposal listing the
draft cards for a human to author/apply. Only if the governed-eval-authoring
rewrite (`docs/proposals/rule8-governed-eval-authoring.md`) has been **APPLIED**
may this skill draft eval files directly; they remain unblessed, and new suites
still use the factory path. The factory's `new` command writes `evals/` as part
of its scaffold, so it is covered by whichever §8 text is in force.

## Elicit before editing

Get concrete answers for each item. Do not invent authority when one is missing.

1. Job/mandate and explicit non-goals.
2. Read surfaces and write/proposal surfaces; what remains human-only.
3. Loop bounds: maximum cycles, per-fire item/draft/tool caps, decidable done state,
   retry/no-progress stop, and escalation target.
4. Delegation: whether it may dispatch, which named workers/roles it may use, and the
   maximum fan-out. Default to no delegation.
5. Never-do list: prohibited files, actions, and authority transfers.
6. Failure modes. Turn every identified failure mode into a **suggested** eval-card
   draft; do not silently treat a proposed card as golden.

If the request asks for a cadence, scheduling, or arming, stop at a draft for a human:
scheduling and arming are not this skill's authority.

## Create

1. Follow the kit's `context-refresh` block; additionally read the target
   project's `contract.md`.
2. Choose a unique lowercase hyphenated agent id; never use reserved `eval-suite` or
   `canary-suite`.
3. Before running the factory, read `governance/model-routing.yaml`: `role` is
   the routing class. Choose `--grader` and/or `--needs-routing-override` on
   the **initial** command when its human-owned governance draft is genuinely
   needed; the scaffold is non-overwritable, so a wrong first run cannot be
   rerun. Then run the factory, not a hand-written scaffold:

   Use `python3` on a trusted POSIX/Linux authoring host and `py -3` on Windows;
   `<python>` below means that platform-resolved desktop-authoring command.

   ```
   <python> -m scripts.agent_factory new <agent-id> --role <role> [--runtime <runtime>] [--model <model>] [--project <project>]
   ```
   Resolve a routing-policy warning before relying on the agent for execution.
4. Make targeted edits to the generated definition: mandate, bounded operating loop,
   surfaces, delegation, non-goals, and stops. Keep generated frontmatter canonical;
   do not paste the kit into the body.
5. Keep the factory-created memory shard. Add no live cadence, registration, or arming.

## Iterate

Read the existing definition, its memory shard, its own suite, and relevant `_fleet`
cards first. Follow the kit's `file-editing` block. The agent-builder-specific
decision is the owning layer: a cross-agent rule belongs in the appropriate kit,
fleet, factory, or role-policy proposal, not copied into definitions.

## Draft evals

Before the first drafting action, apply the eval-authoring gate above. If the
actor is the agent being edited, STOP: an independent author must draft its
evals, because no agent authors or edits an eval that judges itself.

Read `evals/agents/README.md`, then draft cards under
`evals/agents/<agent-id>/` using its card contract. Prefer deterministic `file-exists`,
`output-contains`, or `pytest` judges. A model judge is opt-in and never substitutes
for a deterministic safety check. Cover the mandate and each meaningful failure mode;
write the judge so it could fail for the intended defect.

Leave `MANIFEST.sha256` unblessed. Do not run `--update-manifest`: review and a human
bless step are required before cards can become golden. Record that decision as a
separate human action, not as an agent result.

## Verify and stop

When the eval-authoring gate permits drafted cards, first parse them without
changing the manifest:

```
<python> -c "from pathlib import Path; import sys; sys.path.insert(0, 'scripts'); import agent_evals; print([c.id for c in agent_evals.load_cards(Path('evals/agents/<agent-id>'))])"
```

Then independently execute every deterministic draft judge, never the refused
unblessed suite: for `file-exists`, run `Test-Path -LiteralPath <input.path>`;
for `output-contains`, replace `{python}` with the platform-resolved Python
command and invoke the card's argv without a shell, then check combined output
for `input.contains`, or for emptiness when `input.expect_empty: true`;
for `pytest`, run:

```
<python> -m pytest <input.test_file> -q -p no:cacheprovider
```

Run the factory output's relevant deterministic checks. For declaration shape, run:

```
<python> -m pytest evals/agents/_fleet/test_def_parses_in_roster_shape.py -q
```

Do not use an unblessed per-agent suite as evidence of success; its refusal is expected.

STOP and create only a draft card when the requested change belongs in governance.
A human alone decides whether to bless manifests, schedule or arm a cadence, approve
governance, or accept the agent's result.
