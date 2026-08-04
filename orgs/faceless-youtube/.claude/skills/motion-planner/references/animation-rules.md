# Animation rules — which shots get a cutout layer, and how (iterable; human-tuned)

BAKED ONLY WHEN NOTHING MOVES: a shot stays baked (`layers: []`) only when nothing enters, moves, or
accretes in it. The moment a beat has a MOTIVATED element — a character entering, an object travelling,
a stamp landing, a discrete prop added to a held set, a chain accreting — that element gets its layer.
Add slides / paths / hybrids / appears wherever the logic below supports one; do not hold back out of
habit. This posture is about ELEMENT LAYERS first — the camera stays restrained, an optional stage-start
`push`/`pull` punctuation only; no rule here creates a camera quota.

## When to add a cutout layer

**Precondition — the two-test boundary.** DELTA-CHAIN an INTEGRATIVE change (the element fuses into the
scene's architecture: a city grows a bank, gold threads the streets) — regenerate seeded off the prior
frame; it stays baked, costs fewer gens than a plate + N cutouts, and trades away the pop-on (the element
arrives on a hard cut). LAYER a DISCRETE change (the element sits on the scene without fusing: a character
enters the foreground, a stamp slams onto a page) — keep the plate, composite an animated cutout. A cutout
layer needs BOTH tests to pass: **DISCRETE** and **SEEDABLE** — seed every cutout from its character/prop
canonical, or from the plate it lands on, for CONTINUITY: the plate carries place/set continuity only —
it is not a style anchor, and no cross-video `refs/env/` style-anchor plate exists (fix 2). Style comes
from the hardened bible descriptor (`style-bible.md` §2b), never from a seed, on every gen alike — since
an unseeded cutout invents its own register and lands off-style against a flat-cel plate (forge
hard-errors an unseeded environment/style gen). Full law, incl. the ≤3-delta cap and the same-location
re-base:
`knowledge/research/niche-playbooks/universal.md` §13a-ii.

- **Character enters / is revealed** (a `personified-character` intro, "it started with…") → OPTIONAL
  `slide` (a glide-in reveal). Default OFF unless the beat is a deliberate entrance; a discovered-already-
  placed character stays baked (a hard cut is on-grammar).
- **A discrete object travels a route** → `path` + `draw_line`. **A `map-plan-view` (or any map/chart)
  shot whose content names a travelling object — a ship, an arrow, a marching line, a spreading tint —
  PROMOTES to a `path` cutout of that object on the baked map plate, with `draw_line: true` trailing its
  route.** Do not bake a map that has a mover in it: the map is the plate, the mover is the layer. This is
  a strong signal — the reference-channel map idiom. Author the `path` `anchor` on the VO words that name
  the journey.
- **ARROWS, routes, and PROGRESSIVE REVEALS are MOTION — NEVER baked into the still.** An arrow pointing
  to / travelling to a place is a `path` cutout with `draw_line` (the engine draws its line), never a
  static arrow painted into the plate. A **progressive reveal** — elements appearing ONE AT A TIME as the
  VO names them (borders drawing on in spoken order, a crown breaking and STAYING broken, regions tinting
  in sequence) — is authored as **sequenced layers**: each revealed element its own cutout
  `appear`/`draw_line`/`path` with its own `anchor` on the triggering VO word, so they land in order
  rather than all at once. A reveal whose END STATE must persist uses `static: true` so the cutout
  arrives and holds. The plate carries the BEFORE state; the reveals are the layers.
- **A single foreground prop has a live "vibe"** (a book/hands on a desk) → `bob` (in place). Sparing.
- **A discrete overlay is added to a held scene** → layer it as a **hybrid** (reuse the prior scene as
  the plate). A "discrete overlay" is any cleanly-mattable addition — a **stamp / seal / "SOLD" mark /
  brand / badge / label** (→ `appear`, and **stamp/seal/mark overlay cutouts DEFAULT to `style:"slam"`**,
  the stamp-down entrance where the mark presses onto the surface with impact; reserve `pop`/`fade` for
  NON-stamp pops — an icon, a prop, a bubble appearing), a **CHARACTER entering** a set we already
  established (→ `slide`, anchored to the naming/entry word), or a **discrete PROP** placed into the scene
  (→ `appear`/`slide`). The plate REUSES the prior in-stage scene (`background.plate: scenes/<prior-id>.png`,
  no new plate gen) and only the added element's `cutout_prompt` is authored. This fires on a delta-chain
  delta AND on any shot that builds on an already-materialized scene. **A hybrid produces no baked
  composite**, so nothing downstream may chain off it: a BAKED delta that FOLLOWS a hybrid seeds the
  hybrid's own plate (the prior REAL scene the overlay sat on), or the chain re-bases there — never
  `scenes/<hybrid-id>.png`, which is never generated. `lint_motion_plan.py` hard-errors the latter.
- **A recurring FIGURE across a held sequence is ONE reused cutout — never re-genned per shot.** When
  the same figure (a character, a ship) persists across consecutive shots on ONE stage — marching, then
  standing, then addressed — author the cutout ONCE and point every later shot's layer at it with the
  **`reuse`** field (a path to the already-materialized cutout PNG; schema: render-builder
  `references/shots-motion-schema.md`). image-gen generates NO new PNG for a `reuse` layer, so there is
  no separately-generated second copy to drift: per-shot regens of one figure produce visible IDENTITY
  DRIFT, one cutout re-composited holds it. Its per-shot motion still varies — animate the shared cutout
  across with `draw_line` on the travelling shot, then park it with `static: true` so the route persists
  across the following cuts.

**Anchor every timed cutout to its word.** A `slide`/`path`/`appear` cutout SHOULD carry an **`anchor`**
(verbatim VO words the element lands on — the first 4 words are matched to the VO word-stream, same
convention as a `vo_ref`), so the element enters ON the word instead of at the shot cut. Pick the phrase
where the narration actually introduces the element (a character's name, "the ship set out", the beat the
stamp punctuates). No `anchor` → the element enters at the cut (a frame-4 lead-in).

### Vertical ANCHOR ORIGIN — state it when it matters
The engine anchors each animation type at a DIFFERENT vertical origin, and `[x,y]` positions
(`at`/`to`/`points`) are read against THAT origin:

| type | default vertical origin | so the authored y means… |
| --- | --- | --- |
| `appear` (pop/fade/slam) | **CENTER** | the element's vertical **center** |
| `path` | **CENTER** | the cutout's vertical **center** |
| `slide` | **BOTTOM** | the element's **bottom edge** (feet-on-ground) |
| `bob` | **BOTTOM** | the element's **bottom edge** |

This mixed origin is the root of the "elements sit too high" bug. An author who picks a y meaning
"center of the element" gets `appear`/`path` right, but a `bob`/`slide` layer renders shifted UP by half
its height (its bottom lands at that y). The bottom default is CORRECT for a standing FIGURE (feet on
the ground) — leave figure slides alone. It is WRONG for a centered non-figure on a `bob`/`slide` (a
floating book, an arrow gliding to mid-frame): those want their CENTER at the y.

**Two ways to place such a layer correctly** — pick one, don't do both:
- **State the origin:** add **`anchor_origin: "center"`** to the animation → the authored y is the
  element's center (an arrow sliding to a true mid-frame: `to:[0.5,0.5]` + `anchor_origin:"center"`).
- **Compensate the y** for the default bottom origin: set y ≈ desired-center + height_frac/2 (a
  height_frac-0.42 book centered at 0.50 needs `at.y ≈ 0.71`).

`anchor_origin` is `"center"` | `"bottom"`, optional, valid on every cutout type; unset = the type
default above. It is DISTINCT from `anchor` (verbatim VO words). Prefer stating `anchor_origin` over
hand-computed y offsets when a non-figure bob/slide must read centered.

### Route dot density — `dot_count` / `dot_r` (dotted vs solid)
`draw_line` renders the route as a row of circles. The default (44 dots, radius 5) reads SOLID on a
short path — the dots overlap into a bead. For a clearly DOTTED read set **`dot_count`** lower and/or
**`dot_r`** smaller on the `path` animation (both require `draw_line:true`). These are per-layer, so one
route can be dotted without touching the ship/campaign trails.

## All in-video text is DIEGETIC (no device cards or engine text)
ALL in-video text is diegetic — designed into the scene and baked into the generated image. The engine
draws exactly one thing: the **route line** (`draw_line` on a cutout `path`). A payoff number, a headline
sum, a section title, a defined term, a debunk-list, a ratio — every one is **composed into the still by
VPW and baked by image-gen**. Author cutout layers only; `source:"engine"` is an INVALID layer source. A
number-heavy sentence with its payload baked into the still is the CORRECT outcome, not a miss. The
Artifact review is the human gate before image-gen.

## Deferred — actively scan for a SHARED base (raise the reuse rate)
NOT YET ACTIVE; the rules above govern. The pinned next iteration: reuse a shared base and
spawn/stamp/reveal elements onto it rather than cutting to a brand-new independent gen each beat — it
reads as continuous and costs far less generation. It is **bounded by the two-test boundary**: a
DISCRETE addition onto the base reuses it as a cutout layer; an INTEGRATIVE change must reuse it as a
held delta-chain and stays baked. So the lean raises the reuse rate against *independent gens*, not
against delta-chains, and independent scenes stay correct for a genuinely NEW setting. Not yet plannable.

## Stays baked (not a layer)
- An **INTEGRATIVE** change — a new element that fuses into the scene's architecture
  (city→+bank→+cathedral, a farm bursting, gold rivers threading the streets) → plan it as a baked
  `delta-chain`. (A *discrete overlay* added to a chain is the hybrid above — that one DOES layer.)
- All in-video text — payoff figures, titles, defined terms, debunk-lists, ratios → bake it diegetic
  into the still. Optional plan-level opaque chapter cards are separate full-screen pauses, not in-scene
  text or layers: they stay static and require their co-located audio pause.
- A shot with no motivated motion → bake it as a passthrough.

## Decomposition (by subtraction)
- `plate_prompt` = the shot's `still_prompt` MINUS the cutout elements — but the plate must still read as a
  **complete, natural** scene/object: state what fills the region instead, never leave a conspicuous blank
  slot ("…the map with the coastline unbroken and no route drawn", not "…a blank space where the line
  was"). (In-video text is NOT subtracted — it stays baked diegetic in the plate.)
- `cutout_prompt` = **THE OBJECT ONLY** — the single element, described as itself and nothing else. Write
  no background, field, ground, backdrop, plate or surrounding-scene language at all (not even "on a plain
  field"): `image-generation` gens every cutout on its own solid magenta chroma field and keys it out, so
  any scene the prompt describes is either keyed away or fringes the matte. Frame it whole, with air.
- **Hybrid (a discrete overlay on a delta-chain):** there is **no `plate_prompt`** — the plate is the
  prior in-stage scene, reused (`background.plate: scenes/<prior-in-stage-id>.png`). Author only the
  `cutout_prompt` (the overlay alone).
