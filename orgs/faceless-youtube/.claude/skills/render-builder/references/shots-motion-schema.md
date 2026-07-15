# shots.motion.json — the derived production spec

A NEW derived file (`videos/<slug>/shots.motion.json`) the `motion-planner` emits from `shots.json`.
`shots.json` stays VPW's pristine visual truth; this is the machine-planned layer spec that
image-generation and build_motion consume. Validated by `scripts/motion_plan.py::validate_plan`.

## Per long-form shot
- `id` (str, required) — matches the `shots.json` shot id.
- `background` (object, required):
  - `mode`: `"plate"` | `"delta-chain"`.
  - `plate` (str) — the baked scene path, OR `plate_prompt` (str) when image-gen must generate a plate
    that omits the layer elements. `delta-chain` mode carries the existing stage fields, passed through.
  - **Hybrid** — a `delta-chain` shot MAY also carry a cutout `layers[]` (a discrete overlay on the held
    set, e.g. a FICTION stamp). Then `background.plate` = `scenes/<prior-in-stage-id>.png` (the prior
    frame, **reused** — image-gen generates no new plate); only the overlay's `cutout_prompt` is authored.
- `layers` (array, required; `[]` for a simple/passthrough shot):
  - `id` (str), `source`: `"cutout"` | `"engine"`.
  - cutout: `cutout_prompt` (str) + `animation`. The `animation` MAY carry an **`anchor`** (verbatim VO
    words the element lands on) — the same convention device cards use. `build_motion.apply_motion_plan`
    resolves it (via `render.anchor_time`) to a **shot-relative `start_s`** written into the animation, and
    the engine `LayerView` starts the slide/path/appear window there instead of the default frame-4 lead-in.
    No `anchor` → the element enters at the shot cut (frame 4).
  - engine **device card** (`kind` ∈ stat-card | counter | meter | chapter-card | definition-card |
    reveal): a `content` object (fields below), **no `animation`** (self-animates by kind), plus an
    optional **`anchor`** (verbatim VO words where the carded content is spoken). Routed to
    `motion.json` `overlays[]` by `build_motion.apply_motion_plan`, which resolves `anchor` → `at_s`
    via the shared word-timing matcher (`render.anchor_time`); falls back to the shot's start if the
    `anchor` is absent or unmatched.
  - engine **diegetic text** (`kind: "text"` + `at_scene: {x, y}`): **DEFERRED** — needs OverlayView
    scene-coordinate positioning that does not exist yet; not authored today (build_motion skips it).
  - `animation` (object, optional; cutout only): `{ "type": <cutout-menu entry>, ...params }`.

## Rules
- Every layer's `animation.type` MUST be on the menu for its `source` (menu.py::valid_animation).
- A simple shot = `{ "background": {"mode":"plate","plate":"scenes/L01.png"}, "layers": [] }` (passthrough).
- A hybrid overlay = `{ "background": {"mode":"delta-chain","plate":"scenes/L06.png"}, "layers": [{"id":"stamp","source":"cutout","cutout_prompt":"a red FICTION marker stamp alone on a plain plate","animation":{"type":"appear"}}] }` (the plate reuses the prior in-stage scene).

## Device-card `content` (per `kind`)
| kind | required | optional |
| --- | --- | --- |
| stat-card | `text` | `sub` |
| counter | `from`, `to` | `prefix`, `suffix`, `duration_s` |
| meter | `label`, `fraction` (0–1) | — |
| chapter-card | `text` | — |
| definition-card | `term`, `def` | — |
| reveal | `items` (`[{text}]`) | `mark` (`x`\|`pop`) |

Fields mirror the engine `OverlayView` props; `motion_plan.py` enforces the required set.

## Materialized assets (the layout image-gen writes and the engine reads)
image-generation materializes a layered shot into a fixed layout under `videos/<slug>/assets/`:
- **plate:** `plates/<shot-id>.png` — the background (opaque). `forge gen` from `background.plate_prompt`.
- **cutout layers:** `cutouts/<shot-id>-<layer-id>.png` — transparent RGBA. `forge gen` the `cutout_prompt`
  on a plain plate, then `forge cutout` (rembg → alpha-harden → trim). Human-gated on the hand-QC crop.
- **engine layers** (`source: engine`) need NO asset — the engine draws them from `content`.
A simple/passthrough shot keeps using the existing `scenes/<shot-id>.png`; `plates/`+`cutouts/` are the
layered-shot addition. A **hybrid overlay** shot generates **no `plates/<id>.png`** — it reuses the prior
in-stage `scenes/<prior-id>.png` as its plate and adds only its `cutouts/<id>-<layer>.png`. (Phase-2
fixture: `videos/2026-07-04-poyais/` L13 + L03 are materialized here.)
