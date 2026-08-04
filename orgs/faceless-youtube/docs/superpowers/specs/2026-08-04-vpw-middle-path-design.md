# VPW middle-path doctrine — design (2026-08-04)

Daniel-approved design closing the rounds-2/3 visual regression (empty shots, grayscale drift,
forced perspective, off-style renders) by walking back four rework-era changes and adding five
slim clauses + one asset. Era analysis: codex-deep session 019fcb40-3685-7aa2-a20c-c4af1546e6ba
(card 6a717c54). Structural rework machinery is KEPT: two-tier ≤2-named-cast law, place_anchor
chain integrity, digest pins, lint hard checks, builder-owned slates, single-writer three-state
review stamps, scoped retry overlays, no-invented-text law.

## End state (Daniel's rulings)
- ≤2 named cast per frame; every other human is crowd-rigged, generally background; no barrier
  rule, no population quotas.
- Scenes rich/full/representative; symbolic ("less literal") shots stay FULL — never a scene
  minus its people.
- Color: per-scene committed palettes, free within ONE channel color family (no out-of-family
  hues); neutral-grey-only is not a palette. No video-wide palette lock.
- Camera: normal, eye-level default; forced-perspective/tiny-figure pressure removed; no new
  camera doctrine.
- Art style mechanically anchored by ONE content-free channel style card (Daniel's topology
  pick); full rendered rooms never serve as style references again (the Poyais-bleed lesson:
  scene anchors carry content inseparably from style).

## Walk back (deletions)
1. Unseeded first-place exception: image-generation/SKILL.md "except the video's own FIRST frame
   for a place" + forge.py `plate:true → []` seed exception + root-shot auto-plate marking.
   Every environment/style gen requires a real style or continuity seed again (era-A hard rule).
2. Video-wide palette register: VPW SKILL.md "colour style, declared once" + Step-3c
   "colour-style departures"; style-bible "consistent with the video's declared colour style" →
   era-A "committed scene palette"; delete "locked 2–3 colour palette" (§5).
3. Scale pressure: visual-grammar "tiny figure under a dominant labelled mass" + "one figure
   dwarfing another" + "reach past the eye-level medium" bullets; forge `_SCALE_ANCHORS`/
   `scale_anchor()` + "true human scale measured against…"/ground-plane/occlusion/re-lit
   injection. Forced-perspective recipe stays reverted.
4. Restore era-A flat-cel wording in style-bible §2c (even medium-thick outline, clean FLAT cel).

## Add (slim)
5. Channel style card: one human-approved composition-free card (outline weight/color, shape
   language, flat fills, cel-shadow treatment, broad approved color family — no rooms, no
   furniture, no characters, no lettering). Registered as a STYLE asset. forge auto-seeds it on
   any scene with no chain parent and no place_anchor; $0 hard-fail if unavailable. Card is
   approved by Daniel against known-good era-A frames before becoming mandatory.
6. Finish two-tier migration: remove the dead `anon_foreground` tier from VPW SKILL, shots-schema,
   lint, forge normalization, style-bible §2e (forge already hard-rejects it — the contradiction
   closes). Tests updated.
7. visual-grammar, one sentence: "Non-literal changes the depiction, not the scene's occupancy:
   symbolic, physicalized-imbalance and ironic-counterpoint shots remain full representative
   scenes, never the same scene with its people removed."
8. style-bible §4 opening, one sentence: "Character colors, outline, and semantic red stay
   locked; scene/background/prop palettes are free per scene within the channel color family.
   Neutral-grey-only is not a palette."
9. shots-schema lettering escape narrowed: "Blank or omit only the unsupported glyph field;
   retain the diegetic object and the surrounding full set." Delete "an empty surface is a
   legitimate composition and reads as intentional."
10. Stale-reference cleanup: stamp_review "three concurrent mandate agents"; review prose asking
    for §2e anonymous-foreground judgments.

## Execution
Phase B1: two parallel build workers (forge/image-gen TDD; VPW/visual-kit docs+lint TDD).
Phase B2: mint 2–3 style-card candidates (~$0.4) → Daniel approves one → register + wire.
Phase B3: VPW re-authors the damaged cohort (empty-tableau ids, scaffold ids, grey place heads)
under restored doctrine; lint + dry-run gates.
Phase B4: regen lanes → full three-axis fresh-eyes review (rig+fidelity+style, N/N coverage,
stamps via orchestrator) → board republish.
Budget: wave cap raised to $30 (Daniel 2026-08-04); $19.21 spent at design time.
