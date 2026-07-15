# T2 device-card producer — design (2026-07-12)

## Problem

The **T2 device kit** — engine-drawn cards that render *real, crisp type* over a scene (stat-card,
counter, meter, chapter-card, definition-card, progressive-reveal) — is **built in the engine and
declared in the schema, but nothing authors it.** It has never rendered in the pipeline.

Concretely, three facts hold today:
- The engine `OverlayView` (`render-builder/engine/src/components.tsx`) already renders all six device
  types, positioned from tokens, clamped to the safe area, self-animating (spring-pop / digit ramp /
  bar fill / staggered reveal).
- `shots.motion.json`'s engine-layer `kind` enum **already lists all six** (`shots-motion-schema.md`):
  `text | stat-card | counter | meter | chapter-card | definition-card | reveal`. The layered system
  was designed to carry device cards as `source:"engine"` layers.
- **But** `build_motion.apply_motion_plan` keeps only `source:"cutout"` layers and **silently drops
  every engine layer**, and `motion-planner`'s `animation-rules.md` has no rule that authors a device
  card. So the surface exists end-to-end except for the authoring rule and the routing.

There is also **stale double-path documentation**: `render-builder/SKILL.md` (~L70-72) and
`motion-schema.md` (L8, L87) describe a *never-implemented* path where a human hand-augments
`motion.json` `overlays` after the dry-run "wherever a shot's `on_screen_text` calls for one." That
path was never real and now conflicts with this design; it must be **replaced**, not left beside it.

This is a finance/explainer channel: numbers, terms, and lists are its native vocabulary. The device
kit is the highest-value visual capability currently dark. And the pipeline is *already designed
around it* (image-gen deliberately omits legible on-screen numbers because the engine is meant to draw
them), so leaving it dark also produces silent gaps.

## Decision (approved architecture)

**motion-planner authors device cards as `source:"engine"` layers in `shots.motion.json`;
`build_motion` routes engine device-layers into `motion.json` `overlays[]`; `OverlayView` renders them
unchanged.** No new skill, no new file format, no engine code — we *activate* a schema surface that
already exists.

Rationale:
- **Ownership is correct.** VPW owns what the *image* shows (stills/plates); motion-planner owns what
  the *engine draws on top* (layers). Device cards are engine-drawn animated elements → motion-planner.
- **It reuses existing infra.** Device kinds are already valid engine-layer kinds; motion-planner
  already emits engine layers (the diegetic-text case); `OverlayView` already renders all six.
- **It solves the duplication conflict** the owner raised (a still baking "8M acres" *and* a card
  popping "8M acres") via the **subtraction rule** motion-planner already applies to cutouts.

### Scope: A now, neutralize B
- **A — screen-space device cards (this build):** the six card types above, rendered as `overlays[]`.
- **B — diegetic in-scene text (`at_scene`, deferred):** engine text positioned at scene coordinates
  to fill a plate hole. It needs `OverlayView` positioning that does not exist yet. This build
  **neutralizes** it: the diegetic-text rule in `animation-rules.md` is disabled so image-gen stops
  leaving unfilled holes. `kind:"text"` + `at_scene` stays in the schema, marked deferred; nothing
  authors it until a later at_scene iteration.

## Data contract

### 1. In `shots.motion.json` — a device engine-layer (what motion-planner authors)

An engine device-layer is a layer with `source:"engine"`, a device `kind`, and a `content` object.
**It omits `animation`** — a device card self-animates by kind (the menu's engine `appear`/`count`/
`fill`/`reveal` animations are baked into the `OverlayView` component; `kind` implies the motion).
`kind` (the device type) and `animation.type` (the menu motion) are **different axes**; device layers
set `kind`, not `animation`.

```json
{ "id": "acres-stat", "source": "engine", "kind": "counter",
  "content": { "from": 0, "to": 8000000, "suffix": " acres", "duration_s": 1.6 } }
```

`content` shape per kind (fields mirror the `OverlayView` component props exactly):

| kind | required content | optional content |
| --- | --- | --- |
| `stat-card` | `text` | `sub` |
| `counter` | `from`, `to` | `prefix`, `suffix`, `duration_s` (default 1.5) |
| `meter` | `label`, `fraction` (0–1) | — |
| `chapter-card` | `text` | — |
| `definition-card` | `term`, `def` | — |
| `progressive-reveal` | `items` (array of `{text}`) | `mark` (`"x"`\|`"pop"`, default `"pop"`) |

### 2. In `motion.json` — the emitted overlay (what build_motion writes)

`build_motion` maps each device engine-layer to an `overlays[]` entry on its shot, adding `at_s`
(and per-item `at_s` for reveals). The overlay shapes are the **existing** `motion-schema.md §3`
types — no schema change to `motion.json`. Example emit for the counter above, on a shot starting at
88.2 s: `{ "type": "counter", "from": 0, "to": 8000000, "suffix": " acres", "duration_s": 1.6,
"at_s": 88.2 }`.

## Timing model

A card pops at **its shot's `start_s`** — the cut already lands on the correct VO word via `vo_ref`,
so the card appears exactly when the narration reaches it. **No VO-manifest dependency at plan time**
(motion-planner runs before voiceover; it only names the shot, build_motion supplies `start_s` at
emit). Internal device timing is derived, not authored:
- `counter.duration_s` — the ramp length (authored or default 1.5 s), clamped to the shot duration.
- `progressive-reveal` items — **staggered evenly across the shot duration** (`item i` at
  `start_s + i·dur/N`). This is a v1 simplification; finer within-shot word-anchoring is deferred
  (would need the VO manifest at emit and a per-item anchor phrase). Recorded as a known limitation.

Multiple cards on one shot stack via the existing `OverlayView` `stackIndex` collision offset.

## The one real code change — `build_motion.apply_motion_plan`

Today it filters to cutouts and drops the rest. Change it to **route by `source`**:
- `source:"cutout"` → `shot["layers"]` (LayerView), **unchanged**.
- `source:"engine"` and `kind` ∈ {the six device kinds} → **append a mapped overlay** to
  `shot["overlays"]` (OverlayView), `at_s = shot start_s`, per-kind content mapping + reveal
  item-stagger as above.
- `source:"engine"` and `kind == "text"` (diegetic/`at_scene`) → **ignored with a one-line warning**
  ("diegetic at_scene text deferred"), never a hole and never a crash. (Belt-and-suspenders; the
  authoring rule is also disabled, so this should not appear.)

`apply_motion_plan` runs on the derived motion shots, which already carry `overlays` (from
`on_screen_text`) and `start_s` — so it appends cleanly. No other build_motion change.

## Authoring rules — `motion-planner/references/animation-rules.md`

Add a **"When to add a device card"** section (timid by default — most shots get none):
- Script states a **hard number/amount** the still does not legibly show → `stat-card` (static figure)
  or `counter` (a value that escalates / is dramatized by climbing).
- Script introduces a **term the viewer needs defined** → `definition-card` (sparing).
- Script **enumerates** a list (esp. one being debunked/checked-off) → `progressive-reveal`
  (`mark:"x"` for a struck-through debunk, `"pop"` for a plain build).
- A **section turn** in the script → `chapter-card`.
- A **proportion / ratio / share** ("50 of 250 survived") → `meter`.

**Subtraction / conflict rule (hard):** never author a device card whose number/term/text is already
depicted inside the shot's `still_prompt`. The card is for data the still deliberately omits or cannot
render legibly (the general case — image-gen renders text poorly). This mirrors the existing cutout
subtraction rule.

**Remove** the "When to make text engine-drawn (diegetic)" section (that is B / `at_scene`, deferred).
Replace it with a one-line **Deferred** note so a future reader knows the `at_scene` path is
intentionally parked, not forgotten.

## Validation — `motion_plan.py` (+ `lint_motion_plan.py`)

Extend `validate_plan` so an engine layer whose `kind` is a device kind must carry the required
`content` fields for that kind (per the table above); a missing/typo'd field is a hard lint error, not
a silent no-op at render. `kind:"text"` remains schema-valid but is flagged **deferred** (warn). Add a
unit test per device kind (valid + each missing-field case), plus a routing test in
`test_build_motion.py` (an engine device-layer produces the right `overlays[]` entry; a cutout is
untouched; a `text` layer is skipped-with-warning).

## Documentation reconciliation (mind the traps — integrate, do not append)

One coherent story after this change: **`on_screen_text` (VPW) → a plain `text` overlay** (legacy,
still valid, a simple label); **motion-planner engine device-layers → the six device overlays**;
**diegetic `at_scene` text → deferred.** Every doc must tell exactly that, with the dead path removed:

- `render-builder/SKILL.md` (~L70-72) — **replace** the "after the dry-run you MAY augment
  `motion.json` `overlays` with T2 devices… wherever `on_screen_text` calls for one" step with a
  pointer: device cards are authored upstream by `motion-planner` as engine layers and routed by
  `build_motion`; render-builder does not hand-edit overlays. (Kill the never-built manual path.)
- `render-builder/references/motion-schema.md` — **L8** (drop "the thin judgment layer … augmenting
  `overlays`, documented in SKILL.md"); **L87 overlays row** (rewrite: device overlays come from
  motion-planner engine device-layers via `apply_motion_plan` routing, not a SKILL step). Keep §3
  overlay-type table as-is (it is correct).
- `render-builder/references/shots-motion-schema.md` — add the per-kind `content` shape; state device
  layers omit `animation` (self-animate by kind); state they route to `overlays[]`, not `layers[]`;
  mark `kind:"text"`/`at_scene` **deferred**.
- `render-builder/references/animation-menu.json` / `.md` — **no change needed** (the engine family's
  `appear`/`count`/`fill`/`reveal` already cover the device motions; `kind` ≠ `animation.type`). Add a
  one-line `_note` only if it prevents confusion; do not duplicate the schema.
- `motion-planner/SKILL.md` — reference the new device-card rule if the SKILL enumerates rule
  categories; do not restate the rules (they live in `animation-rules.md`).
- **CLAUDE.md status + `knowledge/decisions.md`** — a single integrated status update + one dated
  decision entry. **Caution:** `decisions.md` is currently unstaged parallel-terminal WIP; edit
  in-place and stage explicit paths only (never `git add -A`, never rewrite history).

Cross-file consistency check before done: `grep -rniE "augment.*overlays|on_screen_text calls for|hand-?edit.*overlays"` over `.claude/skills/render-builder` returns nothing implying a manual device path.

## Out of scope / deferred
- **B — diegetic `at_scene` text** (needs new `OverlayView` scene-coordinate positioning + plate-hole
  coordination). Neutralized here; its own future iteration.
- **Within-shot word-anchored device timing** (cards pop at shot start for now).
- **Device-card SFX** (stat/counter/meter → pop/riser/pluck): this lights up **automatically** once
  device overlays exist — `build_audio`'s overlay-SFX path already reserves device-card roles ("dormant
  until the producers"). No work here; expect it to start firing and ear-gate it in the Tier-1 render.
- The `appear` `style` enum (`fade`/`slam`) engine gap and `sprite-walk` — untouched (owner deprioritized).

## Testing
- Unit: `test_motion_plan.py` (device content validation per kind), `test_build_motion.py` (routing:
  device-layer→overlay, cutout untouched, text-layer skipped).
- Integration: exercised by the **Tier-1 mock render** (placeholder scenes, real VO) on a Poyais slice
  — device cards should appear as real type over the grey placeholder cards, correctly timed to VO.
  This is the first time T2 renders in the pipeline; human eye-gates card placement + the auto-fired
  device SFX.

## Files touched (summary)
- `.claude/skills/render-builder/scripts/build_motion.py` — `apply_motion_plan` routing (the code change).
- `.claude/skills/render-builder/scripts/motion_plan.py` — device `content` validation.
- `.claude/skills/render-builder/scripts/test_build_motion.py`, `test_motion_plan.py` — tests.
- `.claude/skills/motion-planner/references/animation-rules.md` — add device rule; remove/park diegetic.
- `.claude/skills/render-builder/references/{motion-schema.md, shots-motion-schema.md}` — reconcile.
- `.claude/skills/render-builder/SKILL.md`, `.claude/skills/motion-planner/SKILL.md` — reconcile pointers.
- `CLAUDE.md`, `knowledge/decisions.md` — status + decision log (careful staging).
```
