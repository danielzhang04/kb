# Scene chaining (held evolving stages) — design spec

**Date:** 2026-07-08 · **Status:** approved, implementing.
**Goal:** give the visual pipeline *held evolving stages* — consecutive shots on one persistent
set where elements accrete — so it reads like Crayon/HeyHistorically (hard cuts between staged
scenes + intra-scene element change) instead of a new scene every cut. Validated by a drift test:
seeding each still off the *previous* still holds the set (held-set pixel-drift ~1.8–6.7 over 2
hops) vs. independent per-shot gen (~40–57). Board:
https://claude.ai/code/artifact/54cd3991-5a6c-43de-b42a-24e482b1b450

## The reframe
Chaining is the **still-era realization of `universal.md §13a-i`'s composed-slate / progressive
reveal.** A **STAGE** = one held setting: a **base** frame (seeds canonical/library refs — the
current way) + **≤3 delta** frames (each adds/moves ONE element), then re-base or hard-cut to a new
stage. It extends the existing classify→invent scene logic; it does not replace it.

## The load-bearing rule — INTENT vs MECHANISM
- **`visual-prompt-writer` + `shots.json` author INTENT only, executor-agnostic + ADDITIVE.** New
  fields:
  - `stage` — string id shared by consecutive shots on one persistent set (e.g. `"guidebook-desk"`).
    Absent/unique ⇒ a standalone shot (its own one-frame stage).
  - `stage_role` — `"base"` (establish; the set + subject arrive) | `"delta"` (a change on the same set).
  - `changed_elements` — on delta frames: an array of **world-change** strings vs the prior frame
    (`"+ golden city rises"`, `"+ cathedral spire"`, `"- ship"`, `"MacGregor gains epaulettes"`).
  - `still_prompt` stays = the full per-frame intent (target composition), unchanged in role.
  - **Forbidden in VPW/schema:** any *mechanism* — no `chain_from`, no "seed off previous frame", no
    generation params. The chain is *derivable* (the previous shot sharing the `stage` id). This same
    metadata drives a future Remotion layer-move executor unchanged.
- **`image-generation` OWNS the MECHANISM** — a new pass-2 technique **"seeded delta-chain"**: for a
  `delta` shot, seed off the PREVIOUS frame's *output* (`assets/scenes/<prev-in-stage>.png`), change
  ONLY the `changed_elements`, **≤3 hops** from the stage `base`, then re-base or hard-cut. Verify
  each frame with the rig gate + scene-taste gate **plus a held-set diff-gate** (mean pixel Δ vs the
  prior frame outside the changed region → retry or re-base if over threshold). This is the ONLY place
  the "seed off a derivative" exception lives, scoped to within-chain; a **new chain or stage always
  re-seeds canonical** (that is what contains drift).

## Timing
Delta frames fast (**1.5–3s**); base/hold frames **4–12s**; Σ ≈ VO runtime (rule unchanged). Each
frame — delta included — is **one timing unit with its own verbatim `vo_ref`** (the word its change
lands on). The `vo_ref`/narration-order contract and `lint_shots.py`'s matcher are **untouched**.

## Continuity model (executor-agnostic, `§13a`)
Cheapest-first: **(1) move a layer** (Remotion, Phase-2, zero-drift) → **(2) seeded delta-chain**
(now, the only mechanism until Remotion) → **(3) hard cut**. No fades ever (already law).

## File-by-file (split by owner)
- `universal.md §13a-i/§13a-ii`: add the executor-agnostic STAGE/continuity model + the 3-tool
  hierarchy; "one idea per FRAME, whole-swap only at stage change"; hard-cuts-only. Keep classify→invent.
- `visual-prompt-writer/SKILL.md` + `references/shots-schema.md`: the STAGING PASS after classify→invent
  (group consecutive same-set shots; base vs delta; author `changed_elements`); the additive fields;
  chain timing. Intent only.
- `image-generation/SKILL.md` + `scripts/forge.py`: the "seeded delta-chain" technique + the diff-gate.
- `style-bible.md §5`: the general "never seed off a derivative" rule stays; note the scoped
  within-chain exception lives in image-generation (§5 LOCKED → propose, don't self-apply).
- `lint_shots.py`: OPTIONALLY validate the stage fields (chain ≤3, delta frames shorter, stage
  contiguity); MUST NOT alter the `vo_ref` matcher. Re-run on Poyais as a regression check.
- `render-builder`: confirm no change (already hard-cuts / consumes `assets/scenes/` / times per `vo_ref`).

## Out of scope (Phase-2)
A Remotion assembler + element-cutout generation for layer-moves. The `changed_elements` schema
future-proofs the swap; a 1-gen cutout probe de-risks it when Remotion work starts.

## Proof
Author + regenerate one real Poyais stage as a chain end-to-end — the **guidebook stage** (book →
+ golden city → + cathedral → + red FICTION stamp) — via `image-generation`; publish an Artifact +
report drift.
