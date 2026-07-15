# Animation rules — which shots get Family A, and how (iterable; human-tuned)

BAKED ONLY WHEN NOTHING MOVES: a shot stays baked (`layers: []`) only when nothing enters, moves, or
accretes in it. The moment a beat has a MOTIVATED element — a character entering, an object travelling,
a stamp landing, a discrete prop added to a held set, a chain accreting — that element gets its layer.
Add slides / paths / hybrids / appears wherever the logic below supports one; do not hold back out of
habit. This posture is about ELEMENT LAYERS only — the CAMERA stays LOCKED (camera restraint is
deliberate and unchanged; no rule here derives a camera move).

## When to add a cutout layer (Family A)

**Precondition — layer only what has a CANONICAL to seed; delta-chain what has to be invented.** A cutout is
generated ALONE on a plain plate, blind to the scene it lands in, so nothing pins its style. An element with a
registry canonical (a cast character, a registered channel-signature prop/environment) is seeded off that
canonical and holds the register. An element being **invented for this video** (a ship, a building, a
banknote, a crowd, a stamp with no canonical) has no seed, so it invents its own register and lands off-style
against a flat-cel plate — wrong palette, wrong line weight, a different medium altogether. So: **no canonical
→ no cutout layer.** Plan those beats as a seeded `delta-chain` instead, where each frame seeds the prior
frame and therefore inherits its register. The chain is also **cheaper** (fewer gens than a plate + N
cutouts). Trade: a delta-chain loses the pop-on — the element arrives on a hard cut instead of animating in.
Measured: every canonical-seeded figure cutout in a full chunk passed review; every unseeded invented
environment cutout in the same chunk was flagged.

**Provisional — re-test once the channel's `refs/env/` canonicals are populated.** Part of the measured
mechanism is that an invented element had no canonical to seed *and* `mode=environment` seeds nothing by
default (deliberately — an auto-seeded base FACE would bleed into figure-free plates; an explicit `--seed`
IS honoured), while its style-only descriptor still cites "the reference image" that isn't there. So a
*properly seeded* environment cutout may yet hold, and the rule may relax to "no canonical" rather than "not
a character". Binding until that re-test says otherwise.

- **Character enters / is revealed** (a `personified-character` intro, "it started with…") → OPTIONAL
  `slide` (a glide-in reveal). Default OFF unless the beat is a deliberate entrance; a discovered-already-
  placed character stays baked (a hard cut is on-grammar).
- **A discrete object travels a route** → `path` + `draw_line`. **A `map-plan-view` (or any map/chart)
  shot whose content names a travelling object — a ship, an arrow, a marching line, a spreading tint —
  PROMOTES to a `path` cutout of that object on the baked map plate, with `draw_line: true` trailing its
  route.** Do not bake a map that has a mover in it: the map is the plate, the mover is the layer. This is
  a strong signal — the reference-channel map idiom. Author the `path` `anchor` on the VO words that name
  the journey.
- **A single foreground prop has a live "vibe"** (a book/hands on a desk) → `bob` (in place). Sparing.
- **A discrete overlay is added to a held scene** → layer it as a **hybrid** (reuse the prior scene as
  the plate). A "discrete overlay" is any cleanly-mattable addition — a **stamp / "SOLD" mark / badge / label**
  (→ `appear`, `style:"slam"` for a stamp pressing onto paper), a **CHARACTER entering** a set we already
  established (→ `slide`, anchored to the naming/entry word), or a **discrete PROP** placed into the scene
  (→ `appear`/`slide`). The plate REUSES the prior in-stage scene (`background.plate: scenes/<prior-id>.png`,
  no new plate gen) and only the added element's `cutout_prompt` is authored. This fires on a delta-chain
  delta AND on any shot that builds on an already-materialized scene. Only an element *fused into the
  scene's perspective/lighting* stays baked (the integrated accretion below).

**Anchor every timed cutout to its word.** A `slide`/`path`/`appear` cutout SHOULD carry an **`anchor`**
(verbatim VO words the element lands on — same convention as a device card's `anchor`), so the element
enters ON the word instead of at the shot cut. Pick the phrase where the narration actually introduces
the element (a character's name, "the ship set out", the beat the stamp punctuates). No `anchor` → the
element enters at the cut (a frame-4 lead-in).

## When to add a device card (Family B — engine-drawn, screen-space)
A device card renders REAL type over the scene (the engine draws it; image-gen can't render legible
text). **ASSERTIVE by default — the device layer is the PRIMARY source of on-brand motion for a
numbers-driven story, so PROMOTE it wherever the payload below warrants.** The restraint is on WHICH
content earns a card (payoff numbers / section-turns / debunk-lists — not every incidental figure), NOT
on using cards at all: a number-heavy sentence with its payload baked flat into the still is a MISS, not
restraint. Author as an `engine` layer with a device `kind` + `content` (no `animation` — it
self-animates), plus an **`anchor`**: the verbatim VO words where the carded content is actually spoken
(same convention as a `vo_ref` — the first 4 words are matched). The card pins to that word, NOT the shot
cut — a card whose number is spoken mid-shot would otherwise pop seconds early. Pick a distinctive phrase
(its first occurrence in the VO is used).

**Subtraction rule — promote-and-subtract is the DEFAULT for a payoff figure.** A **payoff/emphasis
number** — the payload quantity of the sentence the narration lands on (a headline sum like £200,000, a
shocking count like 8,000,000 acres or 500 signups) — **IS promoted** to a `stat-card`/`counter`, and
the figure is **subtracted from the plate** so it isn't double-drawn. This is the branch a numbers story
lives in — when VPW baked the figure into the still, that is exactly the signal to card+subtract (change
the image-gen prompt), NOT a reason to leave it baked. The subtracted plate must still render a
**complete, natural** object (a deed/map/ledger that reads as *whole*); the missing figure must **never
leave a blank slot** (no one holds a blank page — compose the region so the absence isn't a hole, and the
card supplies the real figure over it). **Two things stay diegetic/baked, never carded:** (1)
**incidental** in-art numbers (dates, page counts, scenery quantities — "350-page book", "Oct 1823"); and
(2) a **human-cost count** on a gravity beat (deaths, graves — the device register goes fully OFF on
human-cost, per the measured grammar; the crosses ARE the count). Expect **several cards per minute** on a
numbers-heavy stretch and none across a somber sequence — cadence follows the payload, not a fixed quota.
The Artifact review is the human gate before image-gen.
- A promoted **number/amount** → `stat-card` (a fixed figure) or `counter` (a value dramatized by climbing).
- A **term the viewer needs defined** → `definition-card` (sparing).
- An **enumerated list** (esp. one being debunked) OR a **set of discrete same-type elements appearing
  across the scene** (POYAIS-office pins popping up across a map, items accreting one by one) → `reveal`
  (`mark:"x"` = struck-through debunk, `"pop"` = a plain build; each element anchored to its word).
- A **section turn** (a title beat, a "so what happened?" pivot) → `chapter-card`. A **proportion/ratio**
  ("≤50 of 250 survived") → `meter`.

## Deferred — diegetic in-scene text (`at_scene`)
Text positioned ON an object (a map's "8M acres") is PARKED: it needs OverlayView scene-coordinate
positioning that isn't built. Do NOT author `kind:"text"`/`at_scene` layers — they'd leave an
unfilled plate hole (image-gen omits the text expecting a fill that never comes). Revisit when
at_scene lands.

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

**Bounded by the canonical precondition (above), which is the real limit on this lean.** Base reuse comes in
two forms and the element decides which: an element WITH a canonical (a character spawning in) can reuse the
base as a **cutout layer**; an element being invented ("paradise base → capital/bank/cathedral pop on") must
reuse it as a **held delta-chain** and stays baked — it cannot be promoted to a layer just to raise the reuse
rate. Both are shared-base reuse; only one of them animates on. So this iteration raises the reuse rate
against *independent gens*, not against delta-chains.

## Stays baked (not a layer)
- A seamless **integrated** accretion — a new element fused into the scene's perspective/lighting
  (city→+bank→+cathedral, a farm bursting, gold rivers threading the streets) → stays a baked
  `delta-chain`. It cannot be cut as a clean independent layer. (A *discrete overlay* added to a chain is
  the hybrid above — that one DOES layer.)
- A shot with no motivated motion → baked passthrough.

## Decomposition (by subtraction)
- `plate_prompt` = the shot's `still_prompt` MINUS the cutout elements and MINUS any subtracted text — but
  the plate must still read as a **complete, natural** scene/object: state what fills the region instead,
  never leave a conspicuous blank slot ("…the map with the coastline unbroken and no route drawn", not
  "…a blank space where the line was").
- `cutout_prompt` = the single element alone, on a plain plate, framed for a clean matte.
- **Hybrid (a discrete overlay on a delta-chain):** there is **no `plate_prompt`** — the plate is the
  prior in-stage scene, reused (`background.plate: scenes/<prior-in-stage-id>.png`). Author only the
  `cutout_prompt` (the overlay alone).
