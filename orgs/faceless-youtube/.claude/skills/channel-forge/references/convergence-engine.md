# channel-forge — the convergence engine

The shared per-stage loop the conductor runs at every genesis stage, parameterized by that stage's recipe
(`references/recipes/<stage>.md`). It exists to make a stage return **converged, close-to-right options** so
the human iterates **~2× not 30×**. Design: `docs/superpowers/specs/2026-07-14-channel-forge-phase3-convergence-engine.md`.

## The loop

Steps 1–5 are **INTERNAL** — the human sees nothing until step 6 (Enforcement Contract clause E: converge
internally, THEN present).

1. **Gather inputs** — the prior locked stages + the recipe's declared research, scope-bounded (clause C — no
   massive workflow for a small ask).
2. **Reuse-first pass** — see below. Never generate fresh what already exists.
3. **Generate options** — produce N candidate options in the recipe's `option_shape`.
4. **Critic layer** — see below. Parallel adversarial critics score/refute each option.
5. **Converge** — fold critic findings into a refine pass; drop the losers; produce a tight ranked shortlist.
6. **Present** — the shortlist in the right medium (Artifact for visual/option boards; VS Code for text files).
7. **Human gate** — the human reacts; ≤2 iterations expected because the obvious misses were already caught.
   The human holds final say (clause H).
8. **File-trap lock-step** — see below. Only on human approval.

## The critic layer (step 4)

The mechanism that makes options close-to-right before the human sees them.

- **Parallel, fresh-context, independent, adversarial.** The conductor spins critics up as **parallel
  subagents** (the Agent/Task fan-out). Each is prompted to **find what is wrong**, not rubber-stamp. A
  **survive-threshold** (e.g., majority of critics must not reject) decides which options continue; the rest
  are dropped or refined. Fresh context = critics don't share the generator's blind spot
  (`fix-generation-not-prohibitions`).
- **Two tiers:**
  - **Universal** (every stage): Enforcement-Contract compliance + the **coherence / "step-back" lens**
    ("does this option cohere with the channel's stated goal and the earlier locks?").
  - **Stage-specific:** the bars in the recipe's `critic_checks`.
- **Right-sized (clause C):** scale the panel to the stage's stakes — a large diverse panel for
  high-stakes stages (e.g., `visual-style`), a lean one for a low-risk stage. Over-spinning is waste.

## Reuse-first pass (step 2)

Before generating anything fresh (clauses A + B + D): check what already exists — an existing skill, a
registry/asset entry, a Second Take exemplar — that could be **reused** or **adapted**. Propose
reuse/adapt/build with reasoning; only build fresh what genuinely doesn't exist. At the `capability-map`
stage this pass IS the whole job (the per-slot resolver); everywhere else it prevents redoing good work.

## File-trap lock-step (step 8)

On human approval, in order, as hard gates (clause F):

1. **Promote** the chosen artifact to its named home.
2. **`prune_workspace(channel_dir)`** — sweep the stage's `.workspace/` scratch.
3. **Commit with EXPLICIT paths** — never `git add -A`; parallel terminals share the tree. Docs are
   integrated-not-appended.
4. **`lock_stage(channel_dir, stage)`** — advances the walk (enforces order).

The purely-mechanical traps (block `git add -A`, enforce explicit paths) are hardened into **harness hooks in
Phase 4** — a hook is the only thing that can trap a bad `git add` outside the model's judgment. The
procedure encodes them now.

## Coherence critic (the "step-back")

The big-picture "state vs. goal" pass, at two checkpoints:
- **Stage-boundary (lightweight):** a universal critic lens (above) — "does what we just locked still cohere
  with the channel's stated goal and the earlier locks?"
- **Run-end (full):** "is this channel actually what we set out to build?" — its findings feed the Phase-4
  learning loop.
