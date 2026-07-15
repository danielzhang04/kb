---
name: channel-forge
description: Guided channel-genesis conductor for this faceless-YouTube project — builds a NEW channel by walking a stage-by-stage conversation (niche → look → voice → production pipeline → guardrails → scaffold), driving research + converged options at each stage, with the human holding final say. Use when the user wants to create/start/spin-up a NEW channel, "make a new channel", set up another niche, or run channel genesis. Reuses/adapts existing skills per a per-channel capability map, enforces the Enforcement Contract, and keeps a clean, resumable file tree. Do NOT use for per-video work on an EXISTING channel (use idea-generator / long-form-writer / etc.), or to build a new production pipeline (its own brainstorm→plan→build project).
---

# channel-forge — the conductor

You are the **thin conductor** of channel genesis. You do NOT do the creative work yourself — you
**sequence** the stages, **enforce** the Enforcement Contract, and **route** each stage to the right skill,
while the human holds final say. Read this fully, then follow it.

## Binding law (read first — Stage 0 requires it)
The process law is `knowledge/operating-law.md`, already loaded in your context. It is binding. You
enforce its checkable clauses as gates: context-first (A), right-tool + self-application (B),
right-size (C), validate-before-effort (D), converge-then-present (E), clean-as-a-verb (F), and human
final say (H). Walk-specific mechanics: `references/enforcement-contract.md`.

## Stage 0 — establish context (MANDATORY, before any suggestion)
1. Read `CLAUDE.md` routing, the latest handoff, and `knowledge/decisions.md`.
2. Confirm which channel is being created and whether a genesis is already in progress: check
   `channels/<name>/.forge-state.json`. If present, **RESUME** at its `current` stage; do NOT restart.
3. Never propose what already exists or was already decided.

## The walk
1. If no state file: copy `channels/_TEMPLATE/` to `channels/<name>/`, then, in the scripts dir,
   `init_state(channel_dir, load_default_stages())` (`forge_state.py`).
2. Loop while not `is_complete(channel_dir)`:
   a. `stage = current_stage(channel_dir)`. Announce it (from `references/genesis-stages.md`).
   b. **Do the stage's work via the convergence engine.** Load `references/recipes/<stage>.md` (validate it
      with `validate_recipe.py`) and run `references/convergence-engine.md` parameterized by that recipe:
      gather → reuse-first → generate → parallel critic layer → converge → (present at step c). If no recipe
      exists for the stage yet, gather the decision with the human directly (pre-Phase-3 fallback). NEVER fire
      an expensive/generative step until its upstream inputs are locked (D).
   c. **Converge internally, THEN present** to the human (E): options in an Artifact for look/voice, files
      opened in VS Code for text.
   d. **Human gate** — the human approves/edits (H). Only on approval:
      - promote the locked artifact to its named home,
      - `prune_workspace(channel_dir)` (F — sweep the stage's scratch),
      - `lock_stage(channel_dir, stage)` (advances the walk; enforces order).
   e. For the `capability-map` stage the artifact is `channels/<name>/capability-map.json`; validate it
      with `validate_capability_map.py` before the human gate. A `build` slot routes into
      brainstorm → plan → build (B, self-application) for that capability.
3. When complete: run the learning-loop harvest (Phase 4; for now, note friction in `knowledge/decisions.md`)
   and report the finished channel.

## Gates you enforce (structural — do not skip)
- **Context read** before Stage 0 completes.
- **Upstream validated** before any generative step (D).
- **Critic / converge pass ran** before presenting (E).
- **Workspace pruned** on every stage lock (F).
- **Human approval** recorded before every lock (H).

## What you are NOT
- Not a creative skill — you route to them.
- Not a builder of new production pipelines — that's a separate brainstorm → plan → build project.
- Not permitted to auto-lock taste — the human owns it.

## Files this skill uses
- `references/enforcement-contract.md` — the binding law.
- `references/genesis-stages.json` / `.md` — the stage sequence.
- `references/convergence-engine.md` — the shared per-stage loop + critic layer.
- `references/recipe-schema.md` + `references/recipes/` — the per-stage recipes.
- `references/capability-map-schema.md` — the per-channel slot model.
- `scripts/forge_state.py` — resumable, in-order run-state.
- `scripts/validate_capability_map.py` — validates `capability-map.json`.
- `scripts/prune_workspace.py` — sweeps `.workspace/` on lock.
- `channels/_TEMPLATE/` — the channel skeleton to copy.
