# Layered Motion System — design spec (2026-07-12)

Status: **DRAFT — awaiting user review.** Supersedes the deferred "Phase-2/3 layered-scene / cutout
compositing" language in `universal.md §13a`, `motion-schema.md` (T3), and CLAUDE.md.

## 1. Problem & goal

Today every shot renders as **one flat baked image**; the Remotion engine can only move the *whole
frame* (a locked camera + idle bob) and draw code overlays on top (the T2 device kit). Nothing *inside*
a shot can move relative to anything else, because the character and background are the same pixels.
The spike (2026-07-11/12) proved we can do better with **zero AI-video and zero watermark**: cut a
clean transparent cutout (rembg + threshold — MacGregor's 4-digit hand survived), composite it over a
generated background *plate*, and animate it deterministically in Remotion (slide-in proven; ship
riding a drawn route proven; both over real generated backgrounds, incl. a busy/dark one).

**Goal:** build the *automation* that chains these already-proven capabilities together, so a shot can
declare a background plate plus animated element-layers, and the pipeline produces and renders them
end-to-end. The individual capabilities are proven; the unbuilt thing is the connective tissue.

## 2. Non-goals / explicitly deferred

- **No AI-video generators.** Off the table (rig drift, non-determinism, breaks audio sync, "uncanny
  middle" doctrine violation). All motion is Remotion.
- **No articulation of generated figures** (limb-bend, head-turn, handshake *motion*). Remotion cannot
  synthesize it from a still. Needs sprites (deferred) or Lottie/Rive (a different pipeline — out of
  scope). `sprite-walk` is designed into the menu but **not built** in this project.
- **No seamless-additive decomposition.** Integrated environment accretion (city→+bank→+cathedral that
  nestle into one illustration) is *not* peeled into layers — it stays a baked **delta-chain** (see §8).
  Decomposing a seamless composite (segment + inpaint) is out of scope; the delta-chain already does it.
- **No audio rework in this project.** Audio authoring is already mostly separate (`audio-cue-writer`,
  `music-cue-writer`). The audio consolidation + pause/timeline rehome + camera-planning skill are a
  **loosely-sketched Step 2** (§13), brainstormed and built *after* this lands. This project makes only
  the *minimal forced* `beat_type` decoupling: delete `beat_type→camera` derivation (§9).

## 3. The core model — one unified layer mechanism

The central discipline: **one generic layer mechanism parameterized by a small animation menu — not N
bespoke features.** Adding a new motion is one menu entry + one small renderer, never a new subsystem.

- **Camera is locked.** Motion is element-only. (The engine keeps its camera primitive for rare manual
  use; we stop auto-deriving it — §9.)
- **A shot = a `plate` (or a `delta-chain`) + an ordered `layers[]` list.**
- **A layer exists only because it does something.** Anything static is baked into the plate; there is
  no "in-plate layer."
- **Every layer is the same shape**, discriminated by `source`:
  - `source: "cutout"` — a generated image asset (character/discrete object), composited over the plate.
    **Family A — the new build.**
  - `source: "engine"` — a code-drawn element (text, card, counter, meter, reveal, draw-on line). No gen;
    Remotion draws it from data. **Family B — already built** (the current `overlays[]` + device kit).
- **Each layer carries one optional `animation`** from the closed menu (§5); absent = static placement.

This unifies the existing engine-drawn `overlays[]` and the new cutout layers into **one `layers[]`
list, one authoring shape, one build path, one engine dispatch.**

## 4. Pipeline & the new `motion-planner` skill

The animation-selection logic (which shots get Family A, and how) is **taste-driven, iterable, and
load-bearing**. It must not balloon VPW and must not be a black-box guess. So it lives in its own stage.

```
long-form-writer → script.md
        │
visual-prompt-writer → shots.json          (VISUAL truth — unchanged authoring surface)
        │
motion-planner  → shots.motion.json        (NEW: the enriched production spec: plate + layers[])
        │                                    [HUMAN GATE: review the motion plan before gen tokens]
        ├── image-generation → plates + cutouts   (reads shots.motion.json)
        └── voiceover → vo.mp3 + word-timings
                 │
        build_motion → motion.json          (gains layers[] emission; loses camera_from_beat_type; audio/breath parts unchanged)
                 │
        Remotion engine → final.mp4         (a dumb renderer: composites plate + layers + VO + audio)
```

**`motion-planner` (new skill)** reads `shots.json` and emits `shots.motion.json`:
- Applies the **animation ruleset** (authored data, iterable) to decide per shot: stays baked? becomes
  `plate` + cutout layer(s) with an animation? which text becomes an engine-drawn layer?
- **Decomposes by subtraction, not re-authoring:** for a layered shot it derives `plate` = the
  `still_prompt` *minus* the cutout/text elements, and `cutout` = the element alone on a clean plate.
- Emits the unified `layers[]` per shot, picking animations **only from the menu** (§5).
- **Near-passthrough for simple shots** (~90%): `plate` = the shot's image, `layers: []`. So downstream
  always reads one contract (`shots.motion.json`) and simple videos cost the planner nothing.
- **Gated:** emits a human-reviewable plan; the user approves *which shots got Family A* before image-gen
  spends a token. A **fresh-eyes critic** checks the decomposition (esp. a plate prompt that still
  implies a removed element — the one real risk).

**Why a separate skill (not VPW):** VPW stays a visual/content author (zero new burden); all the
iterable animation logic sits in one place; the human gets a gate to control it. This is *simpler* per
component than smearing the logic across VPW + image-gen + engine.

## 5. The animation menu — the shared contract

**The single seam that prevents "VPW/planner assumes something the engine can't do."** It is a closed,
capability-proven vocabulary; the planner may only pick from it. Each entry is defined **once** as a
triple — *(author params × required asset × Remotion impl)* — and every stage reads that one definition.

### Family A — generated-image layers (`source: cutout`)
| animation | author params | asset image-gen must produce | Remotion impl | status |
| --- | --- | --- | --- | --- |
| `appear` | `at_s`, style (`pop`/`fade`/`slam`) | one cutout | spring/opacity at t | ✅ proven |
| `bob` | `amp`, `period` | one cutout | sine translate in place | ✅ trivial |
| `slide` | `from` edge, `to` rest, `dur_s`, easing | one cutout | ease-out translate | ✅ proven (MacGregor) |
| `path` | control points, `dur_s`, optional `draw` line | one cutout (line = engine-drawn) | bezier sample + optional draw-on | ✅ proven (ship) |
| `sprite-walk` | direction, `dur_s` | **N pose-frame cutouts** | frame-cycle + translate | ⚠️ designed, NOT built |

### Family B — engine-drawn layers (`source: engine`) — already implemented
`text` (incl. **diegetic in-scene** — §7), `stat-card`, `counter`, `chapter-card`, `meter`,
`definition-card`, `progressive-reveal`, and a `draw-line` primitive (used by `path`). These need
**data** (text/number/label), not a gen asset. Already wired VPW→build_motion→engine as `overlays[]`;
this project **generalizes that list into `layers[]`**, it does not rebuild it.

**Extending the menu is deliberate:** prove a new animation in Remotion → add its triple to the menu →
only then may the planner author it. Never author-first. (This is the discipline that prevents the
`motion_prompt`/`within_shot_motion` failure — fields authored but never renderable, since deleted.)

## 6. `shots.motion.json` schema (the enriched production spec)

`shots.json` stays VPW's source of truth. `shots.motion.json` is the **derived** production spec the
planner emits; image-gen and build_motion consume it. Per long-form shot:

```json
{
  "id": "L03",
  "vo_ref": "and sailed across the Atlantic to go live",
  "background": { "mode": "plate", "plate_prompt": "…scene MINUS the ship and route…" },
  "layers": [
    { "id": "ship", "source": "cutout", "cutout_prompt": "a single tall-masted ship, side profile, bow LEFT, on a plain plate",
      "animation": { "type": "path", "points": [[0.83,0.24],[0.52,0.14],[0.12,0.72]], "dur_s": 4.0, "draw_line": true } },
    { "id": "acres", "source": "engine", "kind": "text", "content": "8,000,000 acres",
      "at_scene": { "x": 0.5, "y": 0.42 }, "animation": { "type": "type-on", "at_s": 1.1, "dur_s": 1.2 } }
  ]
}
```

- `background.mode`: `plate` (one baked image) | `delta-chain` (§8; the existing `stage`/`stage_role`
  chain, passed through untouched).
- A layer's `source` ∈ {`cutout`, `engine`}. Cutout layers carry a `cutout_prompt` (derived by
  subtraction) → image-gen. Engine layers carry `kind` + `content` (+ `at_scene` for diegetic text).
- `animation` = a menu entry with its params, or absent (static).
- **Simple shot** = `{ background: {mode: "plate", plate: "scenes/L01.png"}, layers: [] }` — passthrough.

Exact field names finalized during planning; the shape above is the contract.

## 7. Diegetic text — engine-drawn, plate leaves a clean spot

Generalized rule: **diegetic text/data** (the "8M acres" on the king's map, a banknote value, a
"POP. 20,000" sign) is an **engine-drawn `text` layer**, never baked by image-gen (gen text garbles;
engine text stays legible and can animate/type-on). This forces the three-way coordination:
- The planner marks the text as an `engine`/`text` layer with an `at_scene` position.
- The plate prompt is authored to **leave that region visually clean** (a blank banner/sign/space).
- The engine draws real type there at the position.

New vs. today: the engine already draws `text`, but in **screen-space** (bottom-third/corners). This
adds **in-scene positioning** (`at_scene`). **In v1** — it reuses the same subtraction mechanism (the
text is "subtracted" from the plate like any layer element) plus a small engine change to draw at an
authored `at_scene` x,y. Alignment between the plate's blank region and the drawn text is **authored +
human-gated**, not auto-detected (auto blank-region detection is a possible v2 refinement).

## 8. Delta-chain preservation (first-class, undisrupted)

The seamless integrated accretion (city→+bank→+cathedral) **stays a baked delta-chain** exactly as
today (`stage`/`stage_role`/`changed_elements`; `image-generation`'s seeded delta-chain technique;
`forge.py diff` held-set gate). The planner recognizes `background.mode: "delta-chain"` and passes it
through — **it is never decomposed into layers.** A delta-chain shot can still carry discrete cutout /
engine layers on top (the prince cutout, the FICTION stamp overlay) without touching the chain.

This honors the seamless↔separable tension: the *more* integrated an element, the *harder* to peel —
so integrated environment stays baked; only discrete objects/characters/overlays become layers.

## 9. `beat_type` / camera decoupling (the one forced beat_type change)

- **Delete `beat_type → camera` in `build_motion.py`** (`camera_from_beat_type` + the entrance whip).
  Camera-from-beat_type was near-vestigial anyway (only `gravity`/`escalation` pushed) and the channel
  wants a locked camera. Update `motion-schema.md` §2, `shots-schema.md`, and `universal.md §13a-iii`.
- **Keep the engine's camera primitive** (`CameraStage` can still push/pan if a motion.json shot
  explicitly says so) — the capability is preserved for rare manual use or a future camera-planning
  skill (Step 2). We stop *auto-deriving* it; we do not remove it.
- **`beat_type` stays a `shots.json` field authored by VPW** in this project; only its camera consumer
  is deleted. Its audio consumers (`build_audio`, breath, the cue-writers) are untouched. Fully rehoming
  `beat_type` out of VPW is Step 2.

## 10. Component / file-touch map (grounded in the current files)

| File | Today | Change |
| --- | --- | --- |
| **`motion-planner/` (NEW skill)** | — | reads `shots.json` → emits `shots.motion.json`; ruleset (data) + subtraction decomposition + fresh-eyes critic + human gate |
| `shots-schema.md` | shot has `stage/stage_role/changed_elements` (designed to "later drive a Remotion layer-move executor unchanged") | document `shots.motion.json` as the derived layer spec; note the layer-move executor is now live; retire `beat_type→camera` wording |
| `image-generation` (SKILL + `forge.py`) | one baked composite per scene (`environment`/`identity`/… modes) | consume `shots.motion.json`: **plate** gen (bg minus layer elements) + **cutout** gen (clean-plate) + rembg→threshold→**cutout QC gate** (hand-integrity; the spike's `export_cutout` is the seed) |
| `render-builder/references/motion-schema.md` | `image` + `overlays[]` + `transform_note:""` (reserved T3 hook) | `image`→`background`; generalize `overlays[]`→`layers[]` (Family A+B); promote T3 to the live layer system; retire `transform_note` |
| `build_motion.py` | derives camera/idle/overlays; `camera_from_beat_type` | emit `layers[]` (Family A cutout specs + animations) into motion.json; **delete `camera_from_beat_type`** |
| engine `components.tsx` / `Video.tsx` | plate = one `<Img>`; overlays on top | add Family-A layer renderers (`appear`/`bob`/`slide`/`path`) into ONE `renderLayer` dispatch that also handles the existing Family-B kinds (spike `SlideTest`/`MapTest` are the seed) |
| `visual-prompt-writer` | authors `still_prompt`, `beat_type`, `cast`, `on_screen_text` | **no new authoring burden**; only doc/lint updates for the `beat_type→camera` removal |
| `universal.md §13a` / `style-bible.md` / `motion-tokens.json` | continuity hierarchy names layer-move as deferred | make the layer-move + the "diegetic text is engine-drawn" law live; single-source the animation menu |

The important structural fact: **Family B already works end-to-end and the schema already reserved the
layer-move hook.** This is an extension along existing seams, not a teardown.

## 11. File-editing hygiene discipline (a named requirement, not an afterthought)

This touches ~8 docs + several scripts simultaneously — prime territory for append-drift and cross-file
drift. Mandatory, and a plan phase of its own:

- **Single source of truth for the animation menu.** One artifact (a data file + one doc section)
  defines each primitive's triple; every other file *references* it, never re-describes it. This is what
  structurally prevents the "author assumes X the engine can't do" bug.
- **Edit core logic in place; retire the obsolete.** Rewrite the T3/"Phase-2/3 deferred" language in
  `motion-schema.md`, `universal.md §13a`, and CLAUDE.md to describe the *live* system; delete
  `transform_note:""`. No dated "added 2026-07-12" append-blocks; no contradicting ghosts left below new
  text. (Operating rule 6 + the `keep-docs-structured` discipline.)
- **More do's than don'ts** in every touched skill doc.
- **Derived-not-authored preserved:** VPW authors intent; the planner *derives* the layer plan;
  build_motion *derives* motion.json. `shots.motion.json` is a derived artifact, re-runnable.
- **Final phase:** a cross-file consistency sweep + a `curate-doc` pass on each touched doc.

## 12. Testing & checkpoints

- **Test on real Poyais shots at every link** (not a separate slice phase — the capabilities are proven;
  we're testing the *automation*). Canonical cases: L13 (character `slide`), L03 (ship `path` + drawn
  route), a diegetic-text shot (`8M acres`), and a delta-chain passthrough (guidebook).
- **Checkpoints (human gates):** the motion-plan gate (before gen tokens); the cutout QC gate (hand
  integrity, via zoomed crops — never self-certified); a render review in the Windows player.
- Each pipeline link ships with its unit tests (mirroring the existing `test_build_motion` /
  `test_build_audio` pattern).

## 13. Step 2 — deferred audio + camera consolidation (loose sketch, brainstorm later)

Not built here; captured so the seams are left clean. Goal is **cleanliness**: get audio/structure work
out of the visual skill and reduce the number of things governing audio.

- **Rehome `beat_type`** fully out of VPW into a shared story-structure step (or derive from the script).
- **Consolidate audio authoring** — potentially merge `audio-cue-writer` + `music-cue-writer` + the
  mechanical `build_audio` derivation into one **audio-director** skill; it owns SFX + music + **pauses
  and therefore the final timeline** (rehome `breath.py`). The engine stays a dumb renderer consuming the
  final timeline + audioSpec.
- **A camera-planning path** for the rare deliberate camera move (manual, or a small skill), replacing
  the deleted `beat_type→camera` auto-derivation.
- **Guardrail:** the audio pipeline is freshly built (Phases 1–3B), works, and is ear-gated —
  refactoring it is risk for a cleanliness payoff, so it is sequenced *after* the animation work lands
  and brainstormed on its own.

## 14. Open questions / risks

1. **RESOLVED — `shots.motion.json` is a separate new file** (clean source→derived split; VPW's
   `shots.json` stays the pristine visual truth).
2. **RESOLVED — diegetic in-scene text is IN v1** — same subtraction mechanism + an authored `at_scene`
   engine-text position, human-gated for alignment; no auto blank-region detection (that's a possible v2
   refinement). See §7.
3. **The decomposition-by-subtraction risk** — a plate prompt that still implies a removed element. The
   fresh-eyes critic + human motion-plan gate contain it, but it is the single biggest quality risk.
4. **Cutout matte on *busy* backgrounds** — proven for characters/objects on clean/simple plates and
   composited over a busy plate; a character cut from a *busy* scene is *avoided by design* (we generate
   the plate empty + the cutout on a clean plate — never cut a figure out of a busy composite).

## 15. Build decomposition (feeds writing-plans)

Sequenced so each link is testable on Poyais data as it lands:

1. **Contract & schema** — the unified `layers[]` menu (single source of truth) + `shots.motion.json`
   schema + the `beat_type→camera` deletion (small, early, low-risk).
2. **image-gen layered output** — plate + cutout gen from a layer spec + the rembg→threshold→cutout QC
   gate.
3. **engine + build_motion** — the Family-A `renderLayer` dispatch (unified with Family-B) + `layers[]`
   emission.
4. **motion-planner skill** — the ruleset + subtraction decomposition + critic + human gate.
5. **Cross-file hygiene sweep + `curate-doc`** — retire T3/deferred ghosts, single-source the menu,
   update CLAUDE.md status.

(Step 2 audio/camera consolidation — §13 — is a separate later plan.)
