# Visual-pipeline consistency + motion-mechanism overhaul — plan

**Date:** 2026-07-13 · **Status:** plan, awaiting approval
**Origin:** the first full act-1 render (VPW → motion-planner → image-gen → render, autonomous) exposed a
batch of consistency + mechanism defects. This plan extracts the **generalizable logic learnings** (not
Poyais-specific fixes) and lands each as a *logic change* across the right files, cross-file-consistent.

## The unifying principle: CONSISTENCY THROUGH REUSE + REGISTER-APPROPRIATE RENDER

Every defect is a variation of three ideas:
1. **Lock an identity once, reuse it** — characters (done), named groups (done, other terminal), and now
   **anonymous crowds** (a rig tier) and **recurring props** (a per-video lock).
2. **Layer changes onto reused backgrounds** — don't regenerate a scene to add an element; matte the
   element and composite it on the *same* plate (extend the hybrid beyond stamps).
3. **Render at the beat's register, on the right word** — expressions scale to topic gravity (not always
   "extreme"); animated elements land on their VO word (cutouts gain the anchor device cards already have);
   a stamp presses down.

## Current state (from research, 2026-07-13) — what exists / what's missing

- **Rig:** monolithic full rig (round head / no nose / no ears / 4-digit hands / `#241a12` / flat cel) via
  style-bible §1/§2/§2c, force-applied to EVERY figure. **No crowd/small-figure spec** — only a soft §8
  "detail may drop, smaller/vaguer faces." The other terminal's **groups** concept = NAMED recurring groups
  only; anonymous crowds explicitly excluded (free-composed prose).
- **Expressions:** a seeded merge takes the eye/brow/mouth SHAPE from an `expr-*.png` frame (18 frames).
  **Exaggeration is structural** — source frames authored "extreme," guidance says "push mouth extremity
  harder" (§6/§7), and §3 review is *forbidden* to flag it. Register is chosen by *which* frame, never *how
  strong*.
- **Casting:** VPW already casts every named figure (other terminal); **not lint-enforced**.
- **Recurring props:** **no mechanism.** Composed per-scene → drift. Registry supports `kind:environment`
  but is unused for props.
- **Layer reuse:** hybrid (discrete overlay on a shared-`stage` delta-chain) reuses the prior scene as the
  plate + gens only the cutout. Integrated accretions stay baked. **Off-`stage` additive elements have no
  reuse path.** "Discrete overlay" is documented with stamp/badge examples, not characters.
- **Cutout timing:** shot-relative, hard-wired (`slide`/`path` start at frame 4; `appear` at shot-relative
  `at_s`). **Cutouts cannot VO-anchor** — only device cards do (`render.anchor_time`).
- **`appear`:** fades (opacity 0→1) + pops (scale 0.8→1). `a.style` ("slam") is **never read** → a
  stamp-press is unbuildable today.
- **`path`/`draw-line`:** `path` cutout moves along a **3-point** bezier; `draw_line` trails hardcoded-brown
  dots behind it. A standalone `draw-line` engine layer is **designed but unwired**.
- **Lint:** validates animation **type** only, **never params** — a scalar `slide.to`, a 2-point `path`, a
  missing `dur_s` all pass lint and break/misbehave at render (the "center" crash).
- **Manifest seam:** image-gen writes `{flagged:false}`; render-builder's gate requires
  `verified:{scene:true,rig:true}` → every real scene was rejected until hand-stamped.
- **Device-card background:** a card-only shot's subtracted plate lands in `plates/<id>.png`, but the
  renderer resolves a card shot's background from `scenes/<id>.png`.

## The plan — phased, each step a logic change

### PHASE A — Consistency subsystems (the highest-leverage; ~half the feedback)

**A1. Crowd / small-figure rig tier — a PROMPTED simplified rig, not a seed.** The learning behind ~10
feedback points (noses, mittens, mismatched crowd faces). *Decided: crowds are PROMPTED with a simplified
rig, never seeded off a canonical* — a crowd is anonymous (no shared identity to lock), and a **simpler**
rig (dot eyes, no fine features) is *easier* for the gen to hold on many tiny faces than the full detailed
rig (whose detail is exactly what drifts into noses). No crowd canonical asset is built.
- **style-bible §1 + §3:** add the **crowd-rig** as a real spec (replacing the soft §8 footnote): an
  anonymous/background/crowd figure holds the shared FORM (round head, same proportions, no nose, no ears,
  no teeth) but with **simplified features — dot eyes + one simple consistent mouth** (basic emotion only:
  neutral / smile / downturn). Same for every crowd figure, always.
- **style-bible new §2d CROWD-RIG clause** (parallel to §2c): the compact verbatim phrasing that goes INTO
  a crowd scene's prompt — "background / crowd figures on the crowd rig: round heads, dot eyes, one simple
  mouth, no noses, no ears, same proportions, varied era clothing." A foreground *named* character in the
  same shot still keeps its full rig (via its seed); the clause governs the anonymous figures only.
- **visual-prompt-writer step 4 + rule 5:** when a shot has an anonymous crowd, VPW writes the §2d
  crowd-rig clause into the `still_prompt` (the prompt forge sends must carry the actual words). Replace the
  current "crowds stated on the rig (round heads, no noses)" with the crowd-rig clause.
- **image-generation Pass 2 (crowd handling, §8):** rewrite the §8 "every figure is the §1 family / detail
  may drop" protocol → anonymous crowds render on the **crowd rig** (composed from the prompt, no seed); a
  seeded named character in the frame keeps its full rig. The review checks crowd figures against the
  crowd-rig, not the full rig.

**A2. Recurring-prop lock** (net-new subsystem, mirrors the character lock).
- **image-generation Pass 1:** extend "what earns a library slot" to a **recurring identifiable PROP** — a
  specific object appearing across multiple shots whose look must match (the guidebook, the banknote).
  Generate its canonical ONCE (`assets/library/prop-<name>.png`), seed/reuse into each appearance (a prop
  has no pose/expr → no merge; per-shot placement composed in Pass 2 off the seeded prop canonical). Mirror
  the group-lock wording so the doc stays parallel.
- **visual-prompt-writer step 4 + `references/shots-schema.md`:** a shot declares recurring props via a
  **`props` array** (registry/library prop names to seed) — parallel to `cast`. A recurring prop named in
  the prose but absent from `props` is an authoring gap (like an uncast figure).
- **style-bible §7/§9 + `registry.json`:** a per-video prop library slot; a `kind:prop` (or reuse
  `kind:environment`) registry entry when a prop recurs across videos. Keep the single §9 registry schema.

**A3. Casting lint enforcement.** VPW already casts every named figure; make it enforceable.
- **`visual-prompt-writer/scripts/lint_shots.py`:** add a check — a figure named in a `still_prompt` (a
  capitalized story-name, or a registry character name) that is absent from the shot's `cast` is flagged
  (mirrors the existing manual flag-back rule; derived check, not new authoring).

**A4. Expression rework — re-author the base frames + restrain the choice** (NOT a runtime scaling dial).
The exaggeration is baked into the source frames + the guidance that produced them; fix it at the source.
- **Expression assets (PRIMARY):** re-author the `expr-*.png` library (18 frames) to a **moderate
  baseline** register — the current frames are authored "extreme," and since the merge transfers the
  frame's eye/brow/mouth SHAPE directly, extreme frames → extreme faces. Moderate frames fix it at the
  root. *(Asset re-gen + human rig-gate — the single biggest asset task; can be staged.)*
- **style-bible §6/§7:** delete the "push mouth extremity **harder**" / "pushed to extremes" guidance that
  authored the extreme frames; replace with restrained-by-default (a legible expression, not a caricature).
- **visual-grammar §1 (the choice logic):** the register map picks *which* expression — restrain the
  DEFAULT so ordinary beats get calm expressions (deadpan / thinking / smug), and the big ones (laughing,
  shock, delighted) are reserved for genuine comedic peaks, not reached for by reflex.
- **style-bible §3 review:** REMOVE the blanket "never reject for exaggeration"; replace with "reject an
  expression that is over-the-top for its beat (a caricature face on an ordinary / sincere / grim beat is a
  defect)." Change the actual review rule.

### PHASE B — Layer / motion mechanism

**B0. Relax motion-planner's timidity — the posture change (ELEMENT motion only).** Today "timid by
default" fired 1 layer in 59 shots — too meek. Shift the posture: **add element-layer motion whenever a
beat has an entering, moving, or accreting element** (a character sliding in, an object pathing, a stamp
slamming, a prop/element appearing, a chain accreting) — more slides / paths / hybrids / chains / cards,
*more frequent, wherever the logic supports it*. **The CAMERA stays locked** — this posture change is about
element layers, NOT camera moves (camera timidity is deliberate and stays). Update `animation-rules.md`'s
"TIMID BY DEFAULT" framing → "baked is the default *only* when nothing enters/moves/accretes; a motivated
element gets its layer." This is the umbrella under which B1–B4 fire more often.

**B1. Layer-as-default for additive elements** (widen the hybrid beyond stamps + stage-adjacency).
- **motion-planner `animation-rules.md`:** broaden the "discrete element lands ON the frame → hybrid" rule
  so "discrete element" explicitly includes **a character entering a held scene** and **a discrete prop
  added to a held scene**, not just stamps/badges. The reuse-the-plate behavior applies whenever the added
  element is cleanly mattable AND the shot builds on an already-materialized scene (a shared `stage`, or an
  explicit `reuse_scene` reference). Only elements *fused into perspective/lighting* stay baked. Change the
  rule text; keep the discrete-vs-integrated test as the one criterion (it already lives here).
- **visual-prompt-writer:** author additive beats as **shared-`stage` hybrids** — when a beat adds a
  figure/prop to a scene we've established (MacGregor onto the swamp; a 5-STAR stamp on the guidebook),
  keep the same `stage` and author the addition as a layerable delta, do NOT re-describe the whole scene.
  (Guidance change in Step 2.5 / the delta-chain authoring section.)
- **image-generation:** the hybrid materialization already reuses the prior scene + gens only the cutout;
  extend the cutout to a **seeded posed-character** (MacGregor-on-swamp = swamp plate reused + MacGregor
  cutout seeded from the library). One clause in the layered-materialization section.

**B2. Per-element VO anchoring for cutouts** (each layered element lands on its word).
- **`shots-motion-schema.md` + `animation-menu.json` + `tokens.ts`:** add an optional **`anchor`** (verbatim
  VO words) to cutout animations — the same field device cards use.
- **`build_motion.apply_motion_plan` (cutout branch):** resolve the cutout `anchor` → a time via
  `render.anchor_time` (the device-card template), and pass the **shot-relative offset** (anchor_time −
  shot_start) into the animation so `LayerView` starts there instead of frame 4.
- **engine `LayerView`:** honor the resolved offset for `slide`/`path`/`appear` (start the `[off, off+dur]`
  window at the anchor, not a hardcoded frame 4).
- **motion-planner:** author the `anchor` per cutout layer (the VO words the element lands on).

**B3. Stamp press-down** (`appear` gains a real `slam`).
- **engine `LayerView` `appear`:** read `a.style`; add a **`slam`** branch — the element enters slightly
  large + above + settles DOWN onto the plane (Y-drop + scale past 1 → 1 overshoot, quick opacity), reading
  as a stamp pressed onto paper. Keep `pop`/`fade` as-is.
- **`animation-menu.json`:** document the `style` enum and that `slam` is now implemented.
- **motion-planner:** author `style:"slam"` for a stamp overlay.

**B4. Map path detection + draw-line polish.**
- **motion-planner:** the "discrete object travels a route → `path` + `draw_line`" rule EXISTS but didn't
  fire (the map baked). Sharpen the detection: a `map-plan-view` shot whose content has a **traveling
  object** (a ship/arrow crossing) → promote to a `path` cutout (the object) on the baked map plate +
  `draw_line`. Author guidance so it fires.
- **engine:** token-drive the `draw_line` dot colour (currently hardcoded `#3a2a1a`) from the channel
  accent/ink. *(Standalone `draw-line` engine layer — route drawn independent of a traveler — is noted as a
  future build, not in this pass.)*

### PHASE C — Robustness (seam bugs + lint) — quick, high-value

**C1. Manifest verified-schema alignment.** image-generation stamps `verified:{scene:true,rig:true}` on a
manifest entry when the batched review passes it (flagged frames stay unverified). One change to the
manifest-write step + the review, so render-builder's gate reads it directly (no hand-stamp).

**C2. Device-card background = a scene, not a plate.** A card-only shot's subtracted background is a normal
`scenes/<id>.png` (the scene with the number omitted); only cutout-bearing shots use `plates/`. Fix the
image-gen materialization rule + the schema wording so the renderer resolves it with no bridge.

**C3. Lint animation params.** `motion_plan.validate_plan` (+ `lint_motion_plan`) validate animation
PARAMS, not just type: `slide.to`/`bob.at`/`appear.at`/path anchor = 2-el numeric coord; `path.points` =
exactly three `[x,y]`; `dur_s` numeric > 0; `appear.at_s` present. This catches the "center" crash class
before render. **`animation-menu.json`:** document each param's *shape* (coord array, point count, honored
enums), since it's the single-source contract.

### PHASE D — Authoring conventions (generalizable from the Poyais notes)

**D1. Per-word delta granularity.** VPW splits a multi-element delta into **one element per delta**, each
shot anchored to its own word (bank on "bank", coin on "its own money") — no bundling two elements at one
cut. Guidance change in the delta-chain authoring section.

**D2. Reveal staging convention.** A character REVEAL: entrance anchored to the **naming moment** (the
character's name in the VO, via B2's cutout anchor), a **reveal staging** (spotlight/dramatic for a big
reveal — the gold stage exemplar), and the character's **canonical/default expression** unless the beat
authors otherwise. VPW + visual-grammar guidance.

## Cross-file discipline (the traps)

- **One home per concept, referenced elsewhere:** the crowd-rig spec lives once in style-bible §3;
  VPW/image-gen/§2d *reference* it. The layer-reuse test lives once in animation-rules. The anchor field is
  defined once in the schema; build_motion resolves, engine renders, motion-planner authors — one vocabulary
  ("anchor", "discrete overlay", "crowd rig").
- **Change logic, don't append lists** — each edit *replaces* the stale rule (the §8 "detail may drop"
  footnote becomes the crowd-rig reference; "push extremity harder" becomes "scale to register"; "never
  reject exaggeration" becomes "reject register mismatch").
- **Derived stays derived** — the lint checks are derived; shots.json/shots.motion.json stay authored.

## Asset builds + human gates (not just doc edits)

- **A1 crowd rig = NO asset build** (prompted, not seeded).
- The **recurring-prop canonicals** per video (A2) and the **re-authored expression library** (A4) are the
  real generations with human rig-gates — the expression re-author (18 frames) is the largest and can be
  staged/parallelized. Everything else is logic/doc/code edits.

## Recommended execution order

Phase **C** first (quick robustness — so the next render doesn't need hand-bridging), then **A** (the
consistency subsystems — the biggest visible win), then **B** (motion mechanism), then **D** (authoring
conventions). Re-run the pipeline on the act-1 slice → retry the render → gate.

## Out of scope (this pass)

The standalone `draw-line` engine primitive; `sprite-walk`; a channel-wide expression-register re-grade
beyond The Second Take; the full 125-shot video (act-1 slice remains the test bed).
