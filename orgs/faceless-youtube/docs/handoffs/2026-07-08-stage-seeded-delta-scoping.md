# Handoff: scoping for the stage/seeded-delta work (VPW + image-generation)

**To the terminal adding seeded-image logic to visual-prompt-writer + image-generation.**
Read this before making changes — it scopes your task per the Remotion decision made
2026-07-08 in the main terminal, so your changes survive the next phase instead of being
rewritten by it.

## Where the system is headed (decided, don't re-open)

A Remotion-based 2.5D motion engine (Phase 2, separate task) will eventually REPLACE
JSON2Video as the assembler. In that end state, scene continuity comes from three tools,
cheapest first:

1. **Move a layer** in Remotion (free, zero drift — position/depth/scale of cutout elements).
2. **Delta-chain a stage** via seeded generation (what you're building — validated to hold
   for ~3 chained hops before drift; so ≤3 deltas per chain, then hard cut).
3. **Hard cut** to a new stage.

Image-generation's long-term unit shifts toward reusable ELEMENTS (plates, character POSES,
props) that Remotion composites, with whole-scene seeded generation kept for
interaction-heavy shots (contact, held objects, scene lighting).

## The one binding rule — VPW authors INTENT, never MECHANISM

- VPW's new fields must express **stage semantics only**: a stage id (which consecutive
  shots share one persistent set), a base/delta role per shot, and a changed-elements list
  per delta ("+ cathedral rises", "- ship", "MacGregor slumps"). That metadata serves BOTH
  executions (seeded regeneration now, Remotion layer moves later) unchanged.
- Do NOT encode HOW a delta is realized into VPW or shots.json (no "seed off previous
  frame" instructions, no generation parameters in shot fields). The execution decision
  lives in **image-generation's pass-2 technique menu** — add "seeded delta-chain" there as
  a new technique: seed off the PREVIOUS frame in the chain, change ONLY the named
  elements, max ~3 hops from the stage's base frame, then a new base or a new stage. Chain
  frames are verified like any scene (rig gate on every figure + scene-taste gate).
- Keep all new fields **ADDITIVE** to the existing shots.json schema.

## Hard constraints

- Do not touch the `vo_ref` verbatim/narration-order anchor contract or `lint_shots.py`'s
  matcher (stage fields are extra metadata the lint may optionally validate).
- Hard cuts only, no fades (already law).
- One shot = one timing unit stays true (a delta frame is still a shot with its own vo_ref).
- In image-generation, chain seeds are an explicit exception to "never seed off a downstream
  derivative" — scope the exception to **within-chain frames only**; a NEW chain or stage
  always re-seeds from canonical library/base frames (this is what contains drift).
- Doc placement per the split-by-owner rule: staging semantics → visual-grammar / VPW SKILL
  + shots-schema; generation technique → image-generation SKILL; any LOCKED style-bible
  value stays verbatim (propose, don't self-apply).
- If you change the shots.json schema, re-run `lint_shots.py` on the Poyais shots.json as a
  regression check before finishing.

## Why

If VPW hard-wires "delta = regenerate," the Remotion layer phase rewrites your work. If it
authors "same stage + what changed," your schema becomes the permanent contract and only the
executor evolves underneath it.

*(If the seeded-chain test settles on a different max chain length than ~3, use the tested
number everywhere this doc says 3.)*
