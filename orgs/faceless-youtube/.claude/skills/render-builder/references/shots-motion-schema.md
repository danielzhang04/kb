# shots.motion.json — the derived production spec

A derived file (`videos/<slug>/shots.motion.json`) the `motion-planner` emits from `shots.json`.
`shots.json` stays VPW's pristine visual truth; this is the machine-planned layer spec that
image-generation and build_motion consume. Validated by `scripts/motion_plan.py::validate_plan`.

**The boundary this spec serves:** DELTA-CHAIN an INTEGRATIVE change (the element becomes part of the
scene's architecture) — regenerate seeded off the prior frame; LAYER a DISCRETE change (the element
sits on the scene without fusing into it) — keep the plate, composite a seeded animated cutout. Full
law, including the ≤3-delta cap and the same-location re-base:
`knowledge/research/niche-playbooks/universal.md` §13a-ii.

## Animation vocabulary

The closed vocabulary is DATA — `animation-menu.json`, loaded and validated by `scripts/menu.py`; edit
the JSON, never a prose copy. `source: "cutout"` (generated image layers) is the only authorable family:
rigid transforms + reveals, no articulation (`appear`/`bob`/`slide`/`path`), each animation declaring
the asset image-gen must produce. The engine's ONE drawn element is the **`draw_line`** param on `path`
(route dots trailed along the cutout's bezier); everything else in a layer is the generated image. VPW
and the motion-planner author ONLY menu animations, and extending the menu is deliberate: prove it in
Remotion, add its triple (params × asset × engine) to the JSON, then it is authorable — which is what
prevents authoring a motion the engine cannot render.

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
  - `id` (str), `source`: **`"cutout"` only** — `motion_plan.py::validate_plan` rejects any other value.
  - cutout: `cutout_prompt` (str) + `animation`. The `animation` MAY carry an **`anchor`** (verbatim VO
    words the element lands on). `build_motion.apply_motion_plan` resolves it (via `render.anchor_time`)
    to a **shot-relative `start_s`** written into the animation, and the engine `LayerView` starts the
    slide/path/appear window there instead of the default frame-4 lead-in. No `anchor` → the element
    enters at the shot cut (frame 4).
  - **`reuse`** (str, optional) — a path to an already-materialized cutout PNG. image-gen generates NO
    new PNG for it, and `build_motion.apply_motion_plan` composites that exact file instead of the
    derived `cutouts/<shot-id>-<layer-id>.png`. Use it to hold ONE cutout across several shots (the
    same figure marching, then standing, across one map stage) so separately-generated versions cannot
    drift apart. A `reuse` layer carries no `cutout_prompt` (lint exempts it).
  - `animation` (object, required; cutout only): `{ "type": <cutout-menu entry>, ...params }` — the
    `type` must be on the cutout family in `animation-menu.json` (`appear`/`bob`/`slide`/`path`).
    Optional **`anchor_origin`** (`"center"`|`"bottom"`, any type) overrides the engine's per-type
    vertical transform origin — appear/path default CENTER, bob/slide default BOTTOM (feet-on-ground).
    Set `"center"` to place a non-figure bob/slide (a floating book, a gliding arrow) by its center
    instead of its bottom edge. DISTINCT from `anchor` (VO words).
    On a `path` with `draw_line`, **`dot_count`** (int > 0, default 44) and **`dot_r`** (px > 0,
    default 5) tune the route's dot density — LOWER both for a clearly DOTTED read (the 44/5 default
    reads solid on a short path). Both require `draw_line:true`.
    On a `path`, optional **`static: true`** gives **completed-route persistence**: a delta-chain shot
    re-declares an earlier route (SAME `points`) so the drawn line survives the hard cut — it draws the
    whole line from frame 0 and parks the cutout at the route end, pixel-aligned with the animating
    shot's final frame (same `bez`/dot params). Otherwise the line unmounts with its live `path` layer.
  - `camera` (optional): only on a standalone or stage-start/base shot. `{ "move": "push" | "pull",
    "pan": null | "left" | "right" | "top" | "bottom", "intensity": >0 and <=1 }`. `push` maps to
    engine `push-in`; legacy `pull` maps to `pull-back`. A later delta is rejected because `CameraStage`
    reads the stage's first camera only.

## Baseline life (plan-level)

`"baseline_life": true` opts this plan into gentle life. `build_motion` then takes the nonzero values
from the channel's separate `visual-kit/motion-tokens.json` `baseline_life` block and applies them to both
scene-backed shots and plate-plus-cutout tableaux. Placeholders and opaque chapter cards remain static.
Absent or `false` preserves legacy derived motion JSON and frame behavior; it never silently changes an
existing video.

## Rules
Every layer's `source` MUST be `"cutout"` and its `animation.type` MUST be on the cutout menu
(`motion_plan.py::validate_plan` → `menu.py::valid_animation`). A passthrough shot is `mode:"plate"` on
its existing `scenes/<id>.png` with `layers: []`; a hybrid is `mode:"delta-chain"` whose `plate` reuses
the prior in-stage scene, plus one cutout layer carrying the overlay's `cutout_prompt` + `animation`.
Layer sources other than `cutout`: `docs/retired-features.md`.

## Chapter cards (plan-level `cards`)

A motion plan MAY carry a TOP-LEVEL `cards` array — full-frame, **FULLY OPAQUE** near-black chapter
beats (`ChapterCard`: ground `#151310`, cream centered `palette.card_bg` text, Ink Free, no chrome,
~0.15s fade in/out) that read as their OWN scenes; nothing of the footage shows while a card is up.
`build_motion.apply_cards` resolves each to a `chapter-card` overlay on the shot whose span contains
the resolved time, so a card shifts NO downstream cut (unlike an inserted card SHOT). Long-form only.

**Opaque ⇒ card-on-silence.** An opaque in-video card must never cover VO-speaking time, so each is
AUTO-ALIGNED to a co-located spliced pause SILENCE: the `audio-director` authors a `pause` cue on each
in-video card anchor, and `apply_cards` fills exactly that block — `[render_anchor − gap_dur,
render_anchor]` (silence splices BEFORE the anchor word). **The card anchor MUST equal the pause cue's
anchor.** No co-located pause is a hard failure — nothing can safely show an opaque card over narration.

- `cards[]` — each: `text` (str, required — the copy), `anchor` (str, required for a normal card —
  verbatim VO words = the co-located pause anchor, resolved via `render.anchor_time`; ANCHOR-based only,
  never an absolute second, so a VO re-synth can't break it), `hold_s` (number > 0 — compatibility field;
  real width always comes from the required pause gap), `fade_s` (number > 0, default 0.15),
  `end_card` (bool).
- The **end card** (`end_card: true`) is EXEMPT from gap-alignment — it is opaque over the closing VO
  line + the `post_vo_hold_s` tail, running from its anchor to the last shot's end. It may omit `anchor`
  (falls back to the last shot's start). Pair it with the plan-level `post_vo_hold_s`.
- `post_vo_hold_s` (plan-level, number > 0) — seconds the last shot holds PAST the last VO word. It
  extends the last shot's `duration_s` (the one shot retime does not clamp downstream); `Root.tsx`'s
  total-duration `max()` and the music lane's `piece_end` both pick up the longer end automatically, so
  the end card holds and the last bed rides through the tail.
- Validated by `motion_plan.py::_card_errors` (folded into `validate_plan`).

## Materialized assets (the layout image-gen writes and the engine reads)
image-generation materializes a layered shot into a fixed layout under `videos/<slug>/assets/`:
- **plate:** `plates/<shot-id>.png` — the background (opaque). `forge gen` from `background.plate_prompt`.
- **cutout layers:** `cutouts/<shot-id>-<layer-id>.png` — transparent RGBA. `forge gen` the `cutout_prompt`
  on a plain plate, then `forge cutout` (rembg → alpha-harden → trim). Human-gated on the hand-QC crop.
A simple/passthrough shot keeps using the existing `scenes/<shot-id>.png`; `plates/`+`cutouts/` are the
layered-shot addition. A **hybrid overlay** shot generates **no `plates/<id>.png`** — it reuses the prior
in-stage `scenes/<prior-id>.png` as its plate and adds only its `cutouts/<id>-<layer>.png`.
