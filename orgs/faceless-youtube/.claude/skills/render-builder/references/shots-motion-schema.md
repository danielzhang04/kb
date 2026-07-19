# shots.motion.json — the derived production spec

A NEW derived file (`videos/<slug>/shots.motion.json`) the `motion-planner` emits from `shots.json`.
`shots.json` stays VPW's pristine visual truth; this is the machine-planned layer spec that
image-generation and build_motion consume. Validated by `scripts/motion_plan.py::validate_plan`.

**The delta-chain / layer boundary** (the canon this spec serves): DELTA-CHAIN when the change is
INTEGRATIVE — the new element becomes part of the scene's architecture. LAYER when the change is
DISCRETE — the added element sits on the scene without fusing into its architecture: keep the plate,
composite an animated cutout. Every cutout is SEEDED — from its character/prop canonical, or from the
plate it lands on plus a style anchor. **A re-base inside the SAME location seeds the prior stage's
BASE frame** (not the last delta, whose ≤3-delta cap can throw the set away).

## Per long-form shot
- `id` (str, required) — matches the `shots.json` shot id.
- `background` (object, required):
  - `mode`: `"plate"` | `"delta-chain"`.
  - `plate` (str) — the baked scene path, OR `plate_prompt` (str) when image-gen must generate a plate
    that omits the layer elements. `delta-chain` mode (an INTEGRATIVE change) carries the existing stage
    fields, passed through; a re-base inside the same location seeds the prior stage's BASE frame.
  - **Hybrid** — a `delta-chain` shot MAY also carry a cutout `layers[]` (a DISCRETE overlay on the held
    set, e.g. a FICTION stamp). Then `background.plate` = `scenes/<prior-in-stage-id>.png` (the prior
    frame, **reused** — image-gen generates no new plate); only the overlay's `cutout_prompt` is authored.
- `layers` (array, required; `[]` for a simple/passthrough shot):
  - `id` (str), `source`: **`"cutout"` only.** `"engine"` is INVALID — `motion_plan.py::validate_plan`
    rejects any layer whose `source != "cutout"`. (The old engine device-card/text layers are retired;
    in-video text is now baked into the generated images — see the schema note at the foot of this doc.)
  - cutout: `cutout_prompt` (str) + `animation`. The `animation` MAY carry an **`anchor`** (verbatim VO
    words the element lands on). `build_motion.apply_motion_plan` resolves it (via `render.anchor_time`)
    to a **shot-relative `start_s`** written into the animation, and the engine `LayerView` starts the
    slide/path/appear window there instead of the default frame-4 lead-in. No `anchor` → the element
    enters at the shot cut (frame 4).
  - **`reuse`** (str, optional) — a path to an already-materialized cutout PNG (e.g.
    `cutouts/L17-macgregor.png`). image-gen generates NO new PNG for a `reuse` layer, and
    `build_motion.apply_motion_plan` composites that exact file instead of the derived
    `cutouts/<shot-id>-<layer-id>.png`. Use it to hold ONE cutout across several shots (the same
    MacGregor figure marching then standing across the L15→L16→L17 map stage) so there is no identity
    drift between separately-generated versions. A `reuse` layer carries no `cutout_prompt` (lint exempts it).
  - `animation` (object, required; cutout only): `{ "type": <cutout-menu entry>, ...params }` — the
    `type` must be on the cutout family in `animation-menu.json` (`appear`/`bob`/`slide`/`path`).
    Optional **`anchor_origin`** (`"center"`|`"bottom"`, any type) overrides the engine's per-type
    vertical transform origin — appear/path default CENTER, bob/slide default BOTTOM (feet-on-ground).
    Set `"center"` to place a non-figure bob/slide (a floating book, a gliding arrow) by its center
    instead of its bottom edge (the M16 "sits too high" fix). DISTINCT from `anchor` (VO words).
    On a `path` with `draw_line`, **`dot_count`** (int > 0, default 44) and **`dot_r`** (px > 0,
    default 5) tune the route's dot density — LOWER both for a clearly DOTTED read (the 44/5 default
    reads solid on a short path). Both require `draw_line:true`.
    On a `path`, the optional **`static: true`** param gives **completed-route persistence**: a
    delta-chain shot re-declares an earlier shot's route (SAME `points`) so the engine-drawn line
    survives the hard cut — static draws the whole line from frame 0 and parks the cutout at the route
    end, pixel-aligned with the animating shot's final frame (same `bez`/dot params). (Fixes the
    vanishing-route-line gap: an engine-drawn line otherwise exists only while its live `path` layer is
    on screen and unmounts at the shot cut.)

## Rules
- Every layer's `source` MUST be `"cutout"` and its `animation.type` MUST be on the cutout menu
  (`motion_plan.py::validate_plan` → `menu.py::valid_animation`; `source:"engine"` is rejected).
- A simple shot = `{ "background": {"mode":"plate","plate":"scenes/L01.png"}, "layers": [] }` (passthrough).
- A hybrid overlay = `{ "background": {"mode":"delta-chain","plate":"scenes/L06.png"}, "layers": [{"id":"stamp","source":"cutout","cutout_prompt":"a red FICTION marker stamp alone on a plain plate","animation":{"type":"appear"}}] }` (the plate reuses the prior in-stage scene).

## Chapter cards (plan-level `cards`) — re-enabled 2026-07-17

A motion plan MAY carry a TOP-LEVEL `cards` array — full-frame, **FULLY OPAQUE** near-black chapter
beats (the re-enabled `ChapterCard`: dedicated ground `#151310`, cream centered text = `palette.card_bg`,
Ink Free, no card chrome, quick ~0.15s fade in/out). They read as their OWN scenes — nothing of the
underlying footage is visible while a card is up. `build_motion.apply_cards` resolves each card to a
`chapter-card` overlay and attaches it to the shot whose span contains the resolved time, so a card
rides on the overlay layer and shifts NO downstream cut (unlike an inserted card SHOT). Long-form only.

**Opaque ⇒ card-on-silence.** An opaque in-video card must never cover VO-speaking time, so each is
AUTO-ALIGNED to a co-located spliced pause SILENCE: the `audio-director` authors a `pause` cue on each
in-video card anchor, and `apply_cards` fills exactly that silence block — `[render_anchor − gap_dur,
render_anchor]` (silence is spliced BEFORE the anchor word) — so the card is up only while nothing is
spoken. **The card anchor MUST equal the pause cue's anchor.** No co-located pause → `apply_cards` warns
loudly and falls back to a fixed `hold_s` ending on the anchor word.

- `cards[]` — each: `text` (str, required — the copy), `anchor` (str, required for a normal card —
  verbatim VO words = the co-located pause anchor, resolved via `render.anchor_time`; ANCHOR-based only,
  never an absolute second, so a VO re-synth can't break it), `hold_s` (number > 0 — FALLBACK width if
  the pause gap is absent; the real width comes from the gap), `fade_s` (number > 0, default 0.15),
  `end_card` (bool).
- The **end card** (`end_card: true`) is EXEMPT from gap-alignment — it is opaque over the closing VO
  line + the `post_vo_hold_s` tail, running from its anchor to the last shot's end. It may omit `anchor`
  (falls back to the last shot's start). Pair it with the plan-level `post_vo_hold_s`.
- `post_vo_hold_s` (plan-level, number > 0) — seconds the last shot holds PAST the last VO word. It
  extends the last shot's `duration_s` (the one shot retime does not clamp downstream); `Root.tsx`'s
  total-duration `max()` and the music lane's `piece_end` both pick up the longer end automatically, so
  the end card holds and the last bed rides through the tail.
- Validated by `motion_plan.py::_card_errors` (folded into `validate_plan`).

Example:
```json
"post_vo_hold_s": 4.0,
"cards": [
  {"text": "How to Invent a Country", "anchor": "So what happened", "hold_s": 2.0, "fade_s": 0.15},
  {"text": "Thanks for Watching", "anchor": "Thanks for watching", "end_card": true, "fade_s": 0.2}
]
```

## Materialized assets (the layout image-gen writes and the engine reads)
image-generation materializes a layered shot into a fixed layout under `videos/<slug>/assets/`:
- **plate:** `plates/<shot-id>.png` — the background (opaque). `forge gen` from `background.plate_prompt`.
- **cutout layers:** `cutouts/<shot-id>-<layer-id>.png` — transparent RGBA. `forge gen` the `cutout_prompt`
  on a plain plate, then `forge cutout` (rembg → alpha-harden → trim). Human-gated on the hand-QC crop.
A simple/passthrough shot keeps using the existing `scenes/<shot-id>.png`; `plates/`+`cutouts/` are the
layered-shot addition. A **hybrid overlay** shot generates **no `plates/<id>.png`** — it reuses the prior
in-stage `scenes/<prior-id>.png` as its plate and adds only its `cutouts/<id>-<layer>.png`. (Phase-2
fixture: `videos/2026-07-04-poyais/` L13 + L03 are materialized here.)

## Retired: engine device-card / text layers (chapter cards EXCEPTED)
The `source:"engine"` device cards (stat/counter/meter/definition/reveal) and diegetic `at_scene` text
are **retired from the flow (2026-07-15)** — nothing authors them as layers and lint rejects
`source != "cutout"`. In-video text (stats, labels, definitions, enumerations) is now baked into the
generated scene/plate images by image-generation. Those Remotion components remain parked in
`engine/src/components.tsx` (see `motion-schema.md` §3) if ever revived.
**Chapter cards are the exception:** re-enabled 2026-07-17 via the plan-level `cards` array above (NOT
a `source:"engine"` layer) — they render through the live `ChapterCard`/`OverlayView` path.
