# Animation rules — which shots get Family A, and how (iterable; human-tuned)

BAKED ONLY WHEN NOTHING MOVES: a shot stays baked (`layers: []`) only when nothing enters, moves, or
accretes in it. The moment a beat has a MOTIVATED element — a character entering, an object travelling,
a stamp landing, a discrete prop added to a held set, a chain accreting — that element gets its layer.
Add slides / paths / hybrids / appears wherever the logic below supports one; do not hold back out of
habit. This posture is about ELEMENT LAYERS only — the CAMERA stays LOCKED (camera restraint is
deliberate and unchanged; no rule here derives a camera move).

## When to add a cutout layer (Family A)

**Precondition — the two-test boundary. A held scene evolves one of two ways.** **DELTA-CHAIN when the
change is INTEGRATIVE** — the new element becomes part of the scene's architecture (a city grows a bank;
gold threads the streets): regenerate the scene seeded off the prior frame (base + ≤3 deltas; a re-base
inside the SAME location seeds the prior stage's BASE frame, never a fresh canonical). **LAYER when the
change is DISCRETE** — the added element sits on the scene without fusing into its architecture (a
character enters the foreground; a stamp slams onto a page): keep the plate, composite an animated cutout.

So a cutout layer requires BOTH tests to pass: the change must be **DISCRETE** (not integrative) **AND**
the cutout must be **SEEDABLE**. Every cutout is SEEDED — from its character/prop canonical, or from the
plate it lands on plus a style anchor (`refs/env/`). An **unseeded** cutout invents its own register and
lands off-style against a flat-cel plate — wrong palette, wrong line weight, a different medium altogether
(chunk-1 evidence: every canonical-seeded figure cutout passed review; every unseeded invented environment
cutout in the same chunk was flagged). forge now **hard-errors** an unseeded environment/style gen and the
channel's `refs/env/` style anchors exist, so a DISCRETE invented element (a stamp, a prop with no
canonical) IS layerable — seed its cutout off the plate it lands on + a style anchor. An INTEGRATIVE change
is never a layer, seedable or not: plan it as a `delta-chain`, where each frame seeds the prior frame and
inherits its register (also **cheaper** — fewer gens than a plate + N cutouts). Trade: a delta-chain loses
the pop-on — the element arrives on a hard cut instead of animating in.

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
  to / travelling to a place is a `path` cutout with `draw_line` (the engine draws the arrow's line), never
  a static arrow painted into the plate. A **progressive reveal** — elements that appear ONE AT A TIME as
  the VO names them (country borders drawing on in the order they're spoken, a crown breaking and the
  broken state STAYING, regions tinting in sequence) — is authored as **sequenced layers**: each revealed
  element is its own cutout `appear`/`draw_line`/`path`, each with its own `anchor` on the VO word that
  triggers it, so they land in order rather than all at once in the baked still. A reveal whose END STATE
  must persist (the crown stays broken, the last border stays drawn) uses a cutout that arrives and holds
  (`static: true` after it lands, same as the parked-figure route persistence below). The plate carries the
  BEFORE state (the un-drawn map, the intact crown); the reveals are the layers.
- **A single foreground prop has a live "vibe"** (a book/hands on a desk) → `bob` (in place). Sparing.
- **A discrete overlay is added to a held scene** → layer it as a **hybrid** (reuse the prior scene as
  the plate). A "discrete overlay" is any cleanly-mattable addition — a **stamp / seal / "SOLD" mark /
  brand / badge / label** (→ `appear`, and **stamp/seal/mark overlay cutouts DEFAULT to `style:"slam"`**,
  the stamp-down entrance where the mark presses onto the surface with impact; reserve `pop`/`fade` for
  NON-stamp pops — an icon, a prop, a bubble appearing), a **CHARACTER entering** a set we already
  established (→ `slide`, anchored to the naming/entry word), or a **discrete PROP** placed into the scene
  (→ `appear`/`slide`). The plate REUSES the prior in-stage scene (`background.plate: scenes/<prior-id>.png`,
  no new plate gen) and only the added element's `cutout_prompt` is authored. This fires on a delta-chain
  delta AND on any shot that builds on an already-materialized scene. Only an INTEGRATIVE change — a new
  element that fuses into the scene's architecture (perspective/lighting) — stays baked as a delta-chain
  (below); a DISCRETE addition that sits on the scene layers.
- **A recurring FIGURE across a held sequence is ONE reused cutout — never re-genned per shot.** When
  the same figure (a character, a ship) persists across consecutive shots on ONE stage — marching, then
  standing, then addressed — author the cutout ONCE and point every later shot's layer at it with the
  **`reuse`** field (a path to the already-materialized cutout PNG; schema: render-builder
  `references/shots-motion-schema.md`). image-gen generates NO new PNG for a `reuse` layer, so there is
  no separately-generated second copy to drift. Per-shot regens of the same figure produce visible
  IDENTITY DRIFT (the L15/L16/L17 MacGregor march, human-caught) — one cutout, re-composited, holds it.
  (Its per-shot motion still varies: L15 animates the shared cutout across with `draw_line`; L16/L17
  park it with `static: true` so the route persists across the cuts.)

**Anchor every timed cutout to its word.** A `slide`/`path`/`appear` cutout SHOULD carry an **`anchor`**
(verbatim VO words the element lands on — the first 4 words are matched to the VO word-stream, same
convention as a `vo_ref`), so the element enters ON the word instead of at the shot cut. Pick the phrase
where the narration actually introduces the element (a character's name, "the ship set out", the beat the
stamp punctuates). No `anchor` → the element enters at the cut (a frame-4 lead-in).

### Vertical ANCHOR ORIGIN — state it when it matters (the M16 footgun)
The engine anchors each animation type at a DIFFERENT vertical origin, and `[x,y]` positions
(`at`/`to`/`points`) are read against THAT origin:

| type | default vertical origin | so the authored y means… |
| --- | --- | --- |
| `appear` (pop/fade/slam) | **CENTER** | the element's vertical **center** |
| `path` | **CENTER** | the cutout's vertical **center** |
| `slide` | **BOTTOM** | the element's **bottom edge** (feet-on-ground) |
| `bob` | **BOTTOM** | the element's **bottom edge** |

This mixed origin is the root of the "elements sit too high" bug (M16). An author who picks a y
meaning "center of the element" gets `appear`/`path` right, but a `bob`/`slide` layer renders shifted
UP by half its height (its bottom lands at that y, so its middle floats above). The bottom default is
CORRECT for a standing FIGURE (a character's feet belong on the ground) — leave figure slides alone.
It is WRONG for a centered non-figure on a `bob`/`slide` (a floating book, an arrow gliding to
mid-frame): those want their CENTER at the y.

**Two ways to place such a layer correctly** — pick one, don't do both:
- **State the origin:** add **`anchor_origin: "center"`** to the animation → the authored y is the
  element's center (e.g. the L59 arrow slides to a true mid-frame with `to:[0.5,0.5]` + `anchor_origin:"center"`).
- **Compensate the y** for the default bottom origin: set y ≈ desired-center + height_frac/2 (a
  hf-0.42 book centered at 0.50 needs `at.y ≈ 0.71`).

`anchor_origin` is `"center"` | `"bottom"`, optional, valid on every cutout type; unset = the type
default above (zero change to existing plans). It is DISTINCT from `anchor` (verbatim VO words). Prefer
stating `anchor_origin` over hand-computed y offsets when a non-figure bob/slide must read centered.

### Route dot density — `dot_count` / `dot_r` (dotted vs solid)
`draw_line` renders the route as a row of circles. The default (44 dots, radius 5) reads SOLID on a
short path — the dots overlap into a bead. For a clearly DOTTED read set **`dot_count`** lower and/or
**`dot_r`** smaller on the `path` animation (both require `draw_line:true`; defaults preserve the old
look). These are per-layer, so one route can be dotted without touching the ship/campaign trails.

## All in-video text is DIEGETIC (no cards, no engine text)
ALL in-video text is diegetic — designed into the scene and baked into the generated image. There are
**no device cards and no engine-drawn text.** The engine draws exactly one thing: the **route line**
(`draw_line` on a cutout `path`). So a payoff number, a headline sum, a section title, a defined term, a
debunk-list, a ratio — every one of them is **composed into the still by VPW and baked by image-gen**
(a capability probe confirmed letter-perfect baked text). Do NOT author `engine`/`text`/device layers;
`source:"engine"` is an INVALID layer source and the engine device family is gone. A number-heavy
sentence with its payload baked into the still is now the CORRECT outcome, not a miss. The Artifact review
is the human gate before image-gen.

## Deferred — actively scan for a SHARED base (raise the reuse rate)
NOT YET ACTIVE. The rules above still govern; this is their known next iteration, pinned during an edit
pass to revisit after that pass + image-gen ship. Do not plan against it yet.

The intended lean: **reuse a shared base and spawn/stamp/reveal elements onto it** instead of cutting to a
brand-new independent gen each beat — "same swamp → a character spawns in → a thought bubble pops". The first
full-video pass went the wrong way (110+ of 125 shots baked as independent stills, very few layers); the
user explicitly prefers the reuse pattern — it reads as continuous (the reference-channel feel) and costs
far less generation. When this lands, the planner must **ACTIVELY scan consecutive beats for ones that can
share a base** (same setting/subject) and reuse it, rather than defaulting each beat to an independent
scene. Independent scenes stay correct for a genuinely NEW setting — the goal is to raise the reuse RATE,
not to eliminate cuts.

**Bounded by the two-test boundary (above), which is the real limit on this lean.** Base reuse comes in two
forms and the change decides which: a **DISCRETE** addition that sits on the base (a character spawning in, a
stamp landing) reuses it as a **cutout layer** — seeded off its canonical, or off the base plate + a style
anchor; an **INTEGRATIVE** change that fuses into the base's architecture ("paradise base →
capital/bank/cathedral pop on", gold threading the streets) must reuse it as a **held delta-chain** and stays
baked — it cannot be promoted to a layer just to raise the reuse rate. Both are shared-base reuse; only the
discrete one animates on. So this iteration raises the reuse rate against *independent gens*, not against
delta-chains.

## Stays baked (not a layer)
- An **INTEGRATIVE** change — a new element that fuses into the scene's architecture
  (city→+bank→+cathedral, a farm bursting, gold rivers threading the streets) → stays a baked
  `delta-chain`. It cannot be cut as a clean independent layer. (A *discrete overlay* added to a chain is
  the hybrid above — that one DOES layer.)
- All in-video text — payoff figures, titles, defined terms, debunk-lists, ratios → **baked diegetic**
  into the still (no cards, no engine text; the route line is the engine's only drawn element).
- A shot with no motivated motion → baked passthrough.

## Decomposition (by subtraction)
- `plate_prompt` = the shot's `still_prompt` MINUS the cutout elements — but the plate must still read as a
  **complete, natural** scene/object: state what fills the region instead, never leave a conspicuous blank
  slot ("…the map with the coastline unbroken and no route drawn", not "…a blank space where the line
  was"). (In-video text is NOT subtracted — it stays baked diegetic in the plate.)
- `cutout_prompt` = the single element alone, on a plain plate, framed for a clean matte.
- **Hybrid (a discrete overlay on a delta-chain):** there is **no `plate_prompt`** — the plate is the
  prior in-stage scene, reused (`background.plate: scenes/<prior-in-stage-id>.png`). Author only the
  `cutout_prompt` (the overlay alone).
