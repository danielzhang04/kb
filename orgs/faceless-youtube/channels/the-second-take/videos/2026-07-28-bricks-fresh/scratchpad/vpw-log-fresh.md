# VPW authoring log — FRESH RUN under the 2026-08-04 doctrine reset

Video: `2026-07-28-bricks-fresh` · authored 2026-08-04 · $0 (no generation, no provider call).
**Fresh-authoring law observed:** the shot list was derived from `script.md` alone. No archived/quarantined
`shots.json`, no `assets/_archive-pre-reset/`, no git history of the old file, and no prior `vpw-log.md` was
read at any point. The stale `shots.json` on disk was deleted unread and replaced.

Read set (SKILL step 1): `script.md` · `visual-kit/visual-grammar.md` · `example-shots.md` · `dna.md` ·
`visual-kit/registry/registry.json` · `references/shots-schema.md` · `research.md` ·
`assets/library/manifest.json` (cast vocabulary only) · `scripts/lint_shots.py`. No `shorts/` folder exists,
so `shorts: []`.

## Scope

**Fifth 1 of 5 — act 1, script paragraphs P01–P06, 293 of 1,632 words (18.0%).** The 20% mark falls inside
P07 (the Hambrecht & Quist / Q.T. Wiles arrival, which runs to 25.0%), and P07 is one continuous act beat
that would have to be split mid-stage. The fifth therefore ends at the **last complete stage before the 20%
mark**: L41, "and Terry Johnson was out the door." That is also the story's own act seam — the setup ends
with the founder leaving, and the turnaround man arrives on the next line.

41 shots, Σ `duration_s` = 100.5 s (the covered span at the header's 175 wpm). Whole-file plan (all five
fifths, ~208 shots / 559.5 s) is recorded in `vpw-fresh-skeleton.md`.

## Declared cast (this video, complete — never re-declared per fifth)

`pc-boxy` · `terry-johnson` · `miniscribe-rep` · `ibm-suit` · `hq-banker` · `qt-wiles` · `brick-foreman` ·
`auditor-rep`, plus `rifenburgh-ceo` to be minted at the Pass-1 gate for act 4. Act 1 uses four of them.
No cast was invented mid-pass; Compaq, Maxtor, the Colorado Brick Company and the Denver papers are staged
as objects/places rather than personified, so no slug is minted for a one-line mention.

## Places

| place | plate | owner decision | shots in act 1 |
| --- | --- | --- | --- |
| `brick-warehouse` | L03 (cast-free, no chain parent) | `owner_ambiguity: true` | L03, L21, L22, L23 |
| `miniscribe-plant` | L26 (cast-free, no chain parent) | `place_owner: "MINISCRIBE"`, quoted on the plate | L26–L29, L32, L38, L40, L41 |

12 of 41 shots declare a `place`. `place` is declared only for sets the FILE revisits; a one-visit set runs
as a `stage` chain instead (the conditional plate law says a single-use place needs no plate, so minting one
would be waste). Place-exempt classes declare none.

## Act-1 self-audit (SKILL step 3c)

**Non-literal share:** 33 of 41 shots (80%) are non-literal; the 8 `literal` frames are concrete physical
objects or actions the line actually describes (the drive on the bench, the seated drive in an open case, the
bricks in the carton, the plant floor). No shot merely draws its line's words.
**Class variety:** literal 8 · symbolic-stand-in-object 6 · ironic-counterpoint 5 · crowd-multiplication 4 ·
idiom-pun 4 · diegetic-device 3 · staged-interaction 3 · personified-character 2 · number-glued-to-object 2 ·
map-plan-view 1 · physicalized-imbalance 1 · register-shift-infographic 1 · aftermath-palette-turn 1. Thirteen
of the fourteen classes used in one act; the only reflex risk was `symbolic-stand-in-object`, which is four
consecutive frames because L11–L14 are one delta chain (the vault) rather than four separate choices.
**Red-ink count: DRIFT CAUGHT AND FIXED HERE.** The first pass put a red accent in 29 of 41 frames — one per
frame, but at that density red stops being the semantic ink and becomes a house habit. Nineteen decorative
accents were removed (cable, till pull, tape, chair, lamp shade, drive face, strap, rope, fire point,
connector, door stripe, banding ×3, ribbon, forklift mast, ramp lip, switch, clamp). Red now appears in 10
frames and every one of them is alarm / ownership / the punch element: the vault wheel, the scuff arc, the
fake tally card, the shipping arrows, the dossier cord, the peak stack's banding, the chart rule, the torn
calendar edge, the cut IBM banding, the torn strap on the scree — plus the clay brick, which is red in itself.
**Human use:** people carry the person/decision/relationship beats (Terry's reveal and exit, the IBM
handshake, the company personified, the buying crowds, the packers leaving). The mechanism beats (what a
drive is, the picks-and-shovels position, the shipping map, the money comparison) are objects and places,
which is what those beats are about. No story-bearing individual was replaced by an object to dodge a figure,
and no anonymous foreground human exists: every human in frame is named cast or declared crowd.
**Cadence vs the 3a budget:** target 41 shots / 100.5 s → authored 41 / 100.5 s. Holds run 1.9–3.0 s except
the L26 plate at 3.5 s (an establishing hold that every later in-place shot seeds from). Every delta is
shorter than its base and under 3.5 s.

## Lint

`py -3 .claude/skills/visual-prompt-writer/scripts/lint_shots.py <shots.json>` → **2 HARD, 1 heads-up, both
HARD findings pure partial-coverage artifacts** (duration sum and shot floor are measured against the WHOLE
9:20 runtime; this file covers 18% of it). Every other check passed on the first run: anchors matched
verbatim and in order against the real VO word-stream, place/plate/owner laws, two-cast presence,
seat/support, action-chain, semantic-cast, text-supply, lettering caps, carried literals, crowd tiering,
delta feasibility, suffix one-voice.

`--write` was deliberately NOT run: it refuses while any HARD remains, and the two artifacts cannot clear
until the remaining four fifths are authored. `vo_text` will be derived then.

## Lessons for the remaining fifths

1. In `miniscribe-plant`, the owner literal `MINISCRIBE` is a substring of the cast slug `miniscribe-rep`, so
   L-1's carry check fires on the SLUG. Naming that cast inside that place requires re-quoting `'MINISCRIBE'`
   within ~60 characters after the slug with no coordinator between, or the shot must not name it there.
2. Nothing enters frame before the VO says it — the plate of a branded place therefore cannot be authored
   before the naming line, which pushes the personified company's entrance one or two shots past its own
   naming moment.
3. Author the red accent LAST, per act, against a count. Written per shot it becomes a reflex clause.

---

# ROUND 2 — shot-repair leg (fix worker G2), 2026-08-05

SCOPED-REPAIR over the fresh fifth after G1's doctrine round landed (b6f16b0). Inputs: the adversarial
comparator's `fresh-fifth-adversarial.md` (14 named repairs + the shot-level majors), `fix-G1-report.md`,
`vpw-fresh-skeleton.md`, the CURRENT `shots.json`, `script.md`, and the real word timings in
`assets/voiceover.manifest.json`. The archived file was not read. $0, no provider call.

**41 → 47 shots. Σ `duration_s` 100.5 → 103.2 s.** Every `duration_s` is now the shot's MEASURED hold from
the VO word timings, not an estimate off the header's rate. Six shots were added by splitting anchors, and
four more breaches were closed by moving an anchor rather than adding a cut.

## Cadence — the 11 real-timing breaches, one line each

Real holds computed with the exact matcher `render-builder` cuts on. Every hold in the fifth is now inside
1.5–3.0 s; the earlier file had 11 of 41 outside it and three past the 4 s ceiling.

| draft breach | mechanism | result |
| --- | --- | --- |
| L01 1.45 s (below floor) | re-anchored L02 from "Home to big hair" to "to big hair, Pac-Man," | 1.69 / 1.69 |
| L03 4.00 s (ceiling) | SPLIT: new L04 anchors "that you've never heard of." | 1.76 / 2.24 |
| L10 3.12 s | re-anchored L09 to "like when Apple released the", L10 to "computers run on these things" | 2.26 / 2.92 / 2.84 |
| L20 3.10 s | re-anchored to "the people selling picks and shovels" | 2.48 / 2.85 |
| L23 3.55 s | SPLIT: new L25 anchors "labelled hard drive," | 1.67 / 1.88 |
| L26 4.36 s (ceiling) | SPLIT at the plate/reveal seam: new L29 anchors "a hard drive manufacturer" | 1.92 / 2.44 |
| L27 3.52 s | SPLIT: new L31 anchors "named Terry Johnson." | 1.61 / 1.92 |
| L31 4.96 s (worst) | SPLIT: new L36 anchors "million dollars a year." | 2.05 / 2.91 |
| L34 3.28 s | re-anchored to "over 600 million dollars a year." | 2.71 / 2.85 |
| L35 3.80 s | SPLIT: new L41 anchors "money as Reddit makes today." | 2.15 / 1.65 |
| L38 3.14 s | re-anchored to "1984, IBM slashed its orders," | 2.26 / 2.78 |

Every anchor is a verbatim span of `script.md` and every shot still matches the VO word-stream in strict
narration order (lint HARD check clean). Two anchors are 3 words ("labelled hard drive,", "named Terry
Johnson.") — the only interior split points in those spans that leave BOTH halves above the 1.5 s floor.

## Per-shot changes

- **L01/L02 (den).** Restaged for figure bias: the video's first frame now carries a household crowd on the
  far side of the room (was furniture only). The TV screen is authored DARK in the base so the arcade maze
  can be L02's single delta — which also fixes the draft's two MINORs, the maze appearing a line before the
  VO named it and the big-hair/Pac-Man pair running in reverse order. The wig-on-a-stand gag is gone with
  the shelf it invented, which closes the draft's feasibility-gate violation (the parent had no shelf).
- **L03.** Unchanged in substance — the `brick-warehouse` plate, cast-free, `owner_ambiguity` — but it no
  longer carries a 4 s hold, and its absence is now named as earned in `notes`.
- **L04 (new).** Newsstand counterpoint on "that you've never heard of", crowd streaming past, every cover
  blank and unlettered. Splits the opening peak and puts people in the opening's second beat.
- **L05–L10 (the 1983 shop).** Now declare `place: computer-shop` with L05 as its place-first frame and
  `owner_ambiguity: true`. This is the fix for G1's handed-over hole: the old L08/L09 left the stage chain
  and re-invented counter, shelving and door from text (`seeds=0` / `seeds=[crowd-exemplar]`). They now seed
  L05 — verified in the forge slate (`L09: [L05]`, `L10: [L05]`). The shop is one unbroken visit, so it does
  not QUALIFY under G1's recurrence rule and needs no dedicated plate frame; declaring the place costs zero
  extra generation and buys the anchor.
- **L11.** Unchanged apart from a fuller bench; `prop-drive` now resolves to its canonical instead of
  shipping as a bare control token (forge derivation, G1 item C).
- **L12–L15 (drive-vault).** The room is furnished — a wall of oak card-index drawers, a side table with a
  banker's lamp and ledgers, parquet — replacing "an empty grey room / the back wall stands smooth and
  empty", the sparse-environment regression. The decorative red on the vault wheel is dropped. L14 now
  lands BOTH nouns of its line (folders for "files", boxed program sleeves for "applications"); its 2.45 s
  span has no interior split point above the floor.
- **L16.** Exact count of twelve replaced with a completion state ("ranked the whole length of its run").
- **L17/L18 (shopfront brawl).** A crowd of passers-by now watches from the pavement beyond the plate glass.
  L18's phones no longer sit "dwarfed by" the cases inside the cases' shove — they stage their own mirrored
  shove at their own scale, so the analogy stops reading as the PCs crushing the phones.
- **L19/L20 (back room).** The manufacturers' crew is in the room, banding notes on the far side of the
  racks. The un-renderable "racket of the front room" (a sound) is cut.
- **L21 (gold rush).** Aproned sellers restored behind the trestle. This was the single clearest depopulation
  defect in the fifth: the line's subject is "the people selling" and the draft drew an unattended stall.
- **L22–L25 (brick tease).** L22 authors the front top carton UNWRAPPED so L23's flaps-open delta is
  physically possible on its own parent (the draft wrapped every pallet "hard in clear film" and then opened
  a carton through it). A packing crew works the far pallet — the VO narrates packing, which people do.
  The old L23 is split into L24 (the whole top row open on a brick each) and L25 (the 'HARD DRIVE'
  lettering), so the lettering lands on the words that name it.
- **L28/L29 (plate/reveal seam).** Implements G1's item J and the SKILL 3a worked example literally: L28 is
  the cast-free plate on the naming clause with 'MINISCRIBE' now in the FINAL clause, and L29 is the reveal
  on the sentence's tail. `miniscribe-rep` no longer enters two shots late.
- **L30 (new).** The founding year is DEPICTED — one lit bench in an unlit floor, '1980' chalked on a crate —
  instead of narrated past. Absence named as earned (the subject is the origin date; the founder lands on
  the very next cut).
- **L31.** `expr-thinking` to `expr-delighted`: a founder's introduction is a warm sell beat, not a
  deliberation one (register dial).
- **L32.** `figures.crowd: true` declared — a floor "at full tilt, every bench crowded" with no declaration
  invites un-rigged invented humans, a rig-drift entry point.
- **L33.** Kept `handshake`. G1's forge fix routes an `interaction` slug SCENE-level alongside both STEP-1
  cards instead of binding it to one figure's pose slot, so the comparator's B2 (a two-person clasp copied
  onto a solo identity card) is dead at the generator, not at the authoring layer. Verified in the slate:
  `L33: [fig-ibm-suit--expr-deadpan, fig-terry-johnson--expr-delighted, handshake, L28]`, 4 seeds, exactly
  at `SEED_CAP`.
- **L35 (new).** Four years of growth staged as four stacks stepping up on the plant apron with a loading
  crew — the shot that absorbs half the old 4.96 s hold.
- **L36 / L39 / L42.** "stencilled" to "lettered" on all three (a lettering-technique word contradicting the
  locked marker-capitals register, invisible to lint). All three literals moved to the final clause.
- **L38.** `'COMPAQ'` lettered on the receiving crate — legal `script_vocab`, spoken in this very line;
  unlettered the crate had no referent.
- **L40/L41.** The one explainer board is now a two-cut progressive reveal (1988 column, then TODAY topping
  it) instead of a 3.80 s hold, with the second baseline ruled empty in the base so the delta has space.
- **L42.** `miniscribe-rep` put back into "Or so they said" — the draft staged a boast with nobody making it.
- **L43.** "leaves torn backward" (a process) replaced with the visible STATE; decorative red dropped.
- **L44.** `ibm-suit` now stands on the apron with a shut order book, turned away from a stranded pallet,
  instead of physically blocking his own supplier's doorway — the draft's cause and effect ran backwards.
- **L47.** THE ENTRANCE. Re-authored from a `stage_role: delta` to a fresh stage BASE (`founder-exit`). A
  delta seeds [parent + canonical] only, so `expr-crestfallen` and `carry-by-handle` were prose against a
  frame that did not contain Terry Johnson at all, and the whole batch refused. As a base his STEP-1 card
  carries pose AND expression into the frame and the shot still seeds the place plate.
- **Thumbnail.** Challenger 2's faced clay brick is gone: it was an un-minted character with no slug or
  canonical, and its "round dot eyes" are the §2d CROWD rig written as prose into a prompt. Replaced with
  `terry-johnson`, `expr-caught`, `hold-one-hand` holding the brick, red circle on the anomaly. The
  primary's overlay changed from "Certified hard drive" to "Premium Colorado clay" so it stops competing
  with the baked 'HARD DRIVE' at 168 px, and its lettered clause moved last.

## Figure bias (Daniel's ruling) — measured

| | draft | now |
| --- | --- | --- |
| figure-bearing frames | 12 / 41 (29%) | **26 / 47 (55%)** |
| first figure on screen | t = 12.3 s (crowd); first human-scale cast t = 57 s | **t = 0.08 s** |
| longest figureless run | 19.6 s (L11 to L19) | **10.6 s (L12–L16)** |
| second-longest | 17.4 s | 9.4 s |

Only one run now exceeds the ~10 s self-audit flag: **L12–L16, 10.62 s** — the "what a hard drive is"
mechanism block, where the subject genuinely is the thing and not a person. It is named here and in each
shot's `notes`, per `visual-grammar.md §1`. Every other figureless frame states in `notes` what earned its
absence: the anonymous rented shell (L03), routing/territory (L26), the origin date with the founder on the
next cut (L30), the part going into the machine (L34), the size gap that is the whole picture (L38), the
number frames (L36/L39), the explainer board (L40/L41), the aftermath the gore policy forbids peopling
(L45). Nothing was populated to hit a share: the additions are all beats whose own line names people
(big hair, "never heard of", the manufacturers, "the people selling", packing, "they said", the growth of
a company) or rooms that plainly have staff.

## Red-ink count

Semantic red survives on 6 frames (L17 scuffed arc, L26 map arrows, L27 dossier cord, L44 cut banding,
L45 torn banding, plus the thumbnails' pointing ring/arrow). Four decorative uses were removed: L12's vault
spokes, L39's stack banding, L43's torn calendar edge, and the draft's L11 red.

## Lessons for the remaining fifths

4. **Size every act against the real word timings, not the header.** The header's 175 wpm is ~20 s wrong over
   the whole file; the manifest has forced-alignment timings for all 1,632 words and lint reads them. Author
   `duration_s` AS the measured hold.
5. **A breach is often an ANCHOR problem, not a shot-count problem.** Four of the eleven closed by moving one
   anchor a few words later; splitting was needed only where the span was genuinely two beats.
6. **A single-visit set can still declare `place`.** It does not qualify, so no dedicated plate frame is
   owed — but the declaration is what gives every later shot of the run a pixel anchor instead of a
   re-invention. Use it wherever a set is drawn by more than one shot, even inside one visit.
7. **Lesson 1 of round 1 is retired.** G1 fixed `carried_literal_check` to blank backticked spans, so
   `MINISCRIBE` inside `` `miniscribe-rep` `` no longer collides and no shot's payload gets pushed into the
   identity zone. Casting decisions are free of the lint again.
8. **The plate/reveal seam is two cuts, not a two-shot lag** (lesson 2 of round 1 is superseded by G1's item
   J): plate on the naming clause, reveal on the sentence's tail.
9. **Act 2 authoring is seed-cap-constrained before it starts** — see the arithmetic in `fix-G2-report.md`.
   A two-cast + crowd + branded-place beat that letters anything is at 5 seeds and survives only on the
   crowd-displacement rule; add an interaction template or a tagged prop and forge refuses.

---

# ROUND 3 — VPW SCOPED-REPAIR over the R14 critic's verdict (fix worker G4), 2026-08-05

SCOPED-REPAIR mode, caller-supplied target list: `critic-R14-fresh-fifth.md` (1 BLOCKING, 12 REVISE,
plus N-1's undeclared figureless run). Inputs read: the critic, the VPW SKILL, `shots-schema.md`,
`visual-grammar.md`, `example-shots.md`, `registry.json`, `script.md`, the real word timings in
`assets/voiceover.manifest.json`, `vpw-fresh-skeleton.md`, the CURRENT `shots.json`. No archived or
quarantined file was read at any point. $0, no provider call, nothing committed.

**47 shots throughout — no shot added or removed.** Sum of `duration_s` 103.2 → 103.3 s. 25 shots
touched: 20 named by the critic, 5 neighbours forced by a repaired chain (each logged below). Every
other shot, and the whole `thumbnail` block, is byte-identical.

## The one BLOCKING item — L24's delta unwrapped cartons its parent had sealed

The chain state is restaged across L22–L25 so the three states are physically consecutive:

| shot | state before | state now |
| --- | --- | --- |
| L22 (base) | film hard round the rear rows, cut back off **the front carton** only | film hard round the **lower courses**, cut back off **the whole top row** |
| L23 (delta) | that one carton's flaps open on a brick | the **front carton of that unwrapped row** opens — restatement updated |
| L24 (delta) | **every carton on the top row** opens — needed film-stripping its parent forbade | **every remaining carton on the unwrapped row** opens — one flap-fold, nothing to strip |
| L25 (delta) | 'HARD DRIVE' on every open carton | **byte-identical** — its carried restatement was already true |

The feasibility gate L22 installed is now wide enough to cover its own chain, which is what the round-2
note claimed it did.

## The money block (R-1) — one image four times, re-derived into four worlds

`L35` `L36` `L38` `L39` were all flat brown cartons on grey concrete under a pale sky, three of them
carrying a literally identical palette line, inside 12.6 s. Each is now re-derived from its OWN VO line,
keeping its declared class:

| shot | class (unchanged) | world now | figures |
| --- | --- | --- | --- |
| L35 "and within four years" | crowd-multiplication | **kept** — four stacks stepping up on the apron, loading crew | crowd |
| L36 "million dollars a year." | number-glued-to-object | adding machine, tape run out on the floorboards, '125 MILLION' on the tape end | none (earned) |
| L38 "giants like Compaq" | physicalized-imbalance | the customer's yard, pallet at the mouth of an articulated trailer, 'COMPAQ' on the flank | crowd |
| L39 "over 600 million a year." | number-glued-to-object | a banking hall, porter's trolley of banded notes, '600 MILLION' on the trolley board | crowd |

L35 keeps the carton vocabulary because it is the one of the four whose staging is an argument (four
years = four stacks) rather than a backdrop. L39's 125-vs-600 juxtaposition is dropped rather than
restaged: the VO compares nothing in that line, and the comparison the script DOES make is L40/L41's
board.

## Cadence — the base/delta hold inversions, closed against the real timings

No duration was invented; each was closed by moving ONE anchor to a verbatim later span of the same
sentence, and both halves stay inside the 1.5–3 s band.

| chain | anchor moved | before | after |
| --- | --- | --- | --- |
| opening peak | L04 to "never heard of." | L03 1.76 / L04 2.24 | **L03 2.37 / L04 1.63** |
| `drive-vault` | L13 to "things after you switch it off:" | L12 1.52 / L13 2.72 | **L12 2.09 / L13 2.15** |
| `shopfront-brawl` | L18 to "and Apple fight over the phone market," | L17 2.19 / L18 2.95 | **L17 2.96 / L18 2.18** |
| `backroom-take` | L20 to "raking it in." | L19 1.61 / L20 2.48 | **L19 2.40 / L20 1.69** |

`drive-vault` keeps 0.06 s of inversion: the next split point ("after you switch it off:") puts L13 at
1.45 s, under the floor. That is what the VO gives, and it is left visible rather than papered over.

## Per-shot changes (round 3)

- **L03 / L04 (opening peak).** L03 is the skeleton's designated opening peak and had 1.76 s on pallets
  authored "small in a large dark room", closing on `Palette:`. It now holds 2.37 s, brings the pallets
  near and high in frame, and closes on them. L04 re-anchored (the source of the 0.61 s) and reordered so
  it ends on "not one head is turned toward the racks", which is the whole irony of "never heard of".
- **L07 (R-7).** Re-authored from a `store-1983` delta to the BASE of a new `store-rush` chain. A
  room-filling crowd was arriving on a parent frame with no people in it — the dominant input contradicted
  the payload. It now seeds the L05 place-first frame, stages the queue as a positive arrangement in a
  stated zone, and stays on the house eye-level frontal. The window card is outside that
  framing, so no literal is carried and the payload slot stays with the crowd.
- **L08 (R-8).** Re-authored: the delta no longer DELETES the parent's dominant seeded mass (three bays
  of boxed machines). Its change is now an addition — every buyer carrying a boxed machine — which is also
  what its own line says ("Anybody with money was buying one"). The shelves running bare lands where the
  script puts it, on L09's "flying off the shelves", which is a fresh frame rather than a deletion delta.
- **L12 (R-6).** Scale pinned against two things already in frame (a waist-high plinth, four courses of
  the drawer wall), because L14 fills the interior with shelved folders and boxed sleeves and a
  desk-object-sized parent would make both payload nouns unreadable.
- **L18 (R-12).** The payload clause stated two incompatible contact geometries (faces butted AND edge to
  edge leaning). One geometry is authored now, the one the cases above already use.
- **L19 (R-2).** Re-staged out of the retailer's back room. "A plain back stockroom behind that display"
  anchored the money to L17's shop window, which paid the wrong party and inverted the picks-and-shovels
  thesis. It is now the drive maker's own back-of-house: its own dock, its own roll-up door, its own truck,
  its own finished units, no retail adjacency.
- **L21 (R-11).** Reordered: framing and palette before the payload, so it closes on the anachronistic
  drive standing on the gold-rush counter — the shot's declared joke, previously buried mid-prompt.
- **L28 / L29 / L30 (R-10).** Lettering-TECHNIQUE words removed: "Chalked across the end of the nearest
  crate" to "Across the plank end of the nearest crate" (L30), and "broad painted board" to "broad plank
  board" on both the plate and the frame that redraws it. The substrate is stated; the suffix owns the
  register.
- **L29 / L31 / L32 (R-4).** Three of the act's four figure reveals ran one face and one composition.
  Split across the dial and across scale: L29 `expr-deadpan`, medium, off-centre in the doorway (a flat
  identification beat); L31 keeps `expr-delighted` (the founder's warm intro — the beat that warrants it)
  but pushes in to a medium; L32 goes `expr-greedy` on a wide (the boom).
  STEP-1 card count is unchanged at 8.
- **L42 (R-3).** The carton is no longer empty. Three shots taught that these boxes hold one red clay
  brick filling the box exactly; an empty one reads as a continuity error, and it is the wrong fraud.
  The brick is in the box, in the reveal chain's own words, under the same '600 MILLION' lettering.
- **L16 (note only).** The round-2 claim that L12–L16 was "the act's one earned figureless run" is
  corrected to what is actually true and checkable: the one run past the ~10 s self-audit flag, with the
  shorter earned runs named.

## Neighbours touched (and why)

| shot | touch | forced by |
| --- | --- | --- |
| L22 | prompt (film state widened to the whole top row) | the L24 BLOCKING chain repair |
| L23 | prompt (carried restatement of L22's new state) | same chain |
| L13 | `vo_ref` + `duration_s` only, prose byte-identical | the L12 hold rebalance |
| L20 | carried restatement rewritten to match L19's re-staged base, plus its anchor | the L19 location repair |
| L28 | "painted board" to "plank board" | R-10's milder half; the place's sign must read identically wherever redrawn |

## Figure bias after round 3

Figureless runs: **L12–L16 10.6 s (the declared mechanism block)**, L26–L28 6.4 s, L05–L06 4.9 s,
L40–L41 3.8 s, L36 2.9 s, everything else at or under 2.4 s. The critic's undeclared 9.5 s L38–L41 run is
gone — L38 and L39 were re-derived into worlds that have people working in them, which is the restage
half of N-1's declare-or-restage. Figure-bearing frames 26 to 28 of 47 (60%).

## Acceptance

- **Lint: 2 HARD, 4 heads-up** (was 2 HARD, 6). Both HARDs are the partial-coverage artifacts (duration
  sum and shot floor measured against the whole 9:20 runtime by a file covering 18% of it). Of the 4
  heads-ups, L47's is the same artifact; L08/L13/L14 are real-timing artifacts of the legacy
  "delta not longer than its base" rule — each delta is inside the band and each base's line is simply
  spoken faster. The L15/L18/L20 instances cleared. Zero real-cadence heads-ups; zero payload-last,
  anchor, place, crowd, delta-feasibility, text-law or technique HARDs.
- **Forge whole-file dry-run: completes, exit 0, ZERO refusals**, no `SEEDING LAW` block, 47 scenes plus
  8 STEP-1 figure gens, all `fig-*` **GENERATE**, none REUSED, max 4 seeds on any request (L33).
  L07/L08 now seed as designed (`L07: [L05, crowd-exemplar]`, `L08: [L07, crowd-exemplar]`).

## Lessons for the remaining fifths

10. **A feasibility gate must be sized to the whole chain, not to the next shot.** L22 reserved exactly
    one carton because L23 needed exactly one; L24, two shots later, needed the row. Author the gate
    against the LAST delta of the chain.
11. **A hold inversion is usually an anchor problem** (all four closed by moving one anchor inside the
    same sentence). When it is not — when the next split point is under the floor — leave it and say so;
    the declared number must never disagree with the render.
12. **A repeated CLASS is not the monotony risk; a repeated WORLD is.** The money block's four shots
    carried four different `shot_class` values and still rendered as one image, because all four reached
    for the same nouns (cartons, apron, pale sky). Vary the WORLD per shot — the nouns, the set, the
    palette — not the vantage; the vantage is fixed house eye-level.

---

# FIFTH 2 — act 2 authored fresh (L48–L89), 2026-08-05

FRESH-AUTHORING over P07–P09, appended after the LOCKED L01–L47 (byte-identical, verified). Inputs:
the VPW SKILL, `vpw-fresh-skeleton.md`, this log, `script.md`, the real word timings in
`assets/voiceover.manifest.json`, `visual-grammar.md`, `example-shots.md`, `shots-schema.md`,
`registry.json`, `assets/library/manifest.json`, `research.md`, and the CURRENT `shots.json` for
lineage. No archived or quarantined file was read. $0, no provider call, nothing committed.

**42 shots, 101.86 s, avg 2.43 s.** New places `wiles-office` (plate L63) and `miniscribe-boardroom`
(plate L71), both `owner_ambiguity: true`; `miniscribe-plant` revisited off L28. 42 scenes + 16 STEP-1
figure gens. Lint: 2 HARD, both partial-coverage artifacts. Forge dry-run over L48–L89: zero refusals,
exit 0. Detail in `vpw-fifth2-report.md`.

## Lessons for the remaining fifths

13. **An expression-swap delta refuses at forge, even though the grammar sanctions it.** `visual-grammar.md`
    §2 says "a swap is a legitimate delta", but forge's seeding law rejects one: the delta slate is
    [parent + canonical] and an expression changed by prose alone reverts to the engine's prior. Clearing
    it needs `delta_primitives`, which is **image-generation's field, not VPW's** — the SKILL says it is
    declared only "after that exact route proved necessary". So when a beat wants a register change on a
    held figure, author the delta's one change as a **SCENE** change that carries the same meaning (L73:
    the whole table sitting bolt upright, not Wiles' face going smug), or open a fresh base. Caught at the
    dry-run, at $0, and it would have refused the whole batch at gen time.
14. **The semantic-cast law is a CASTING constraint, decided before the prose.** It fires on any shot whose
    own `vo_text` names a generic plural role while the named slug's tokens appear nowhere in the ±1 span
    window, and it compares SINGULARIZED forms only — it does not synonymize. So "bankers" justifies
    `hq-banker`, but **"accountants" does NOT justify `auditor-rep`**, and "managers" does not justify
    `brick-foreman`. Read the tiled span before choosing cast: four beats here (L71, L78, L81, L84) sit on
    plural-role spans and are staged as mass action with crowd only, with the named lead landing on the
    adjacent clean span (L72, L79, L82). That is also the better staging — those lines' subject is a room.
15. **Snap a fifth to the ACT boundary, not to the fraction.** Words and VO-time disagree by ~4 points on
    this file (P09's end is 34.1 % by words but 37.8 % by time). Both candidate boundaries sat within 2
    points of 2/5; the act seam broke the tie, and it is the only one of the two that does not stop one
    beat into the next act's escalation ladder.
16. **Let the VO's clause lengths set the shot count, not a target average.** A minimum-count DP over the
    forced-alignment timings (holds constrained to 1.5–3.0 s, cuts penalised off clause boundaries) returns
    the real floor for a span — 45 shots unconstrained, 47 with clause preference, 54 if every beat that
    "deserves" a frame gets one. Author from that number outward instead of dividing seconds by 2.6: it
    tells you which splits the VO forces and which are yours to spend.
17. **`forge.py batch --shots <range>` is the way to prove a partial file, and its place seeds look wrong
    if you misread it.** An in-place shot shows no place seed when its plate sits OUTSIDE the scoped set —
    fifth 1's own L33/L44/L47 behave identically. Re-probe with the plate id added to `--shots` before
    calling it a lineage defect (here: `L48: [fig-…, L28]` once L28 was in scope). Scoping is also how a
    partial file gets a clean run at all while an unrelated staged STEP-1 elsewhere in the file is refusing.

---

# FIFTH 3 - act 3 authored fresh (L090-L148), 2026-08-05

FRESH-AUTHORING over P10-P14, appended after the LOCKED L01-L89 (byte-identical, verified: the
first 125,436 bytes and the whole `thumbnail` tail are unchanged). Inputs: the VPW SKILL,
`vpw-fresh-skeleton.md`, this log (lessons 1-17), `vpw-fifth2-report.md`, `script.md`, the real
word timings in `assets/voiceover.manifest.json`, `visual-grammar.md`, `shots-schema.md`,
`registry.json` (worktree + the MAIN-checkout de-badged `miniscribe-rep`),
`assets/library/manifest.json`, and the CURRENT `shots.json` for lineage. No archived or
quarantined file was read. $0, no provider call, nothing committed.

**59 shots, 129.38 s, avg 2.19 s, every real hold inside 1.5-3.0 s.** New place
`brick-company-yard` (plate L113, `place_owner: "COLORADO BRICK"`); `brick-warehouse` (L03),
`miniscribe-plant` (L28), `wiles-office` (L63) and `miniscribe-boardroom` (L71) all revisited.
59 scenes + 10 STEP-1 figure gens (only 8 of them new to the file). Lint: **1 HARD**, the
duration-sum coverage artifact - the 140-shot floor HARD has CLEARED at 148 shots. Forge dry-run
over L090-L148: zero refusals, exit 0. Detail in `vpw-fifth3-report.md`.

## Lessons for the remaining fifths

18. **The semantic-cast law fires on a POSSESSIVE plural too, and the fix is a cast-free frame, not
    a reworded prompt.** L093's span is "The real sheets were locked in the accountants' own" - the
    plural names the boxes' OWNER, not the actors, and the check cannot tell the difference. The
    repair is structural: make that beat a cast-free frame of the object and open the chain one cut
    later, on the span whose own words are clean ("boxes, so they popped the boxes open with").
    Reading the tiled span BEFORE choosing cast (lesson 14) is what makes this a $0 decision instead
    of a re-author; check the possessive forms, not just the bare plurals.
19. **A place's owner literal is established for the WHOLE place, across stage runs - so plan the
    prose vocabulary of every in-place shot when you choose `place_owner`.** Declaring
    `place_owner: "COLORADO BRICK"` on L113 makes that string a carried literal for L114-L116 under
    L-1: any later yard shot writing "Colorado brick" in lowercase prose would HARD-fail. The
    working rule is to keep the sign out of frame on the follower shots and refer to the material
    ("red clay bricks", "the brick yard"), never to the branded phrase. This is a *drafting*
    constraint that comes with the decisive owner call, and it is cheap once it is decided up front.
20. **A branded place's plate is gated by DISCLOSURE, so the shot before it must decline the
    place.** The VO named "a local company" one cut before "the Colorado Brick Company", and setting
    that earlier shot in the yard would have made IT the plate - which then must quote the owner
    literal, putting the brand on screen a line before the narration says it. Authoring the earlier
    beat as a placeless one-frame world (an unbranded merchant counter) satisfies both laws at once.
    Same shape as the plate/reveal seam, one level up: the seam is plate-then-reveal, this is
    no-place-then-plate.
21. **Fix base/delta hold inversions and the >3 s holds in the SAME anchor pass, before writing a
    word of prose.** Five inversions and one 3.52 s hold in this fifth all closed by moving one
    anchor inside its own sentence; doing it on the timing table cost minutes, and doing it after
    the prose was written would have meant re-deriving every affected shot's payload. Build the cut
    list first, run it against the forced-alignment timings until every hold is in band AND no delta
    is longer than its base, and only then author.
22. **STEP-1 card reuse is a real budget lever and it is decided at casting, not at forge.** Eleven
    cast-bearing frames in this fifth cost 8 new cards, because three of them deliberately named a
    pose/expression pair fifth 2 already mints (`fig-qt-wiles--point-at-thing--expr-smug`,
    `fig-auditor-rep--hold-paper-by-sides--expr-deadpan`, `fig-brick-foreman--expr-worried`) and two
    more share a card minted inside the fifth. The name IS the reuse key, so reuse only where the
    register genuinely wants that face - but check the existing card list before minting a near-
    duplicate.
23. **The out-of-scope violation count in a scoped forge run is a scoping artifact of DELTAS whose
    parent sits outside `--shots`, and it grows as the file grows.** Fifth 3's run reports "5
    seeding-law violation(s) remain OUTSIDE the scope" - all five are fifth 2's deltas (L50, L51,
    L57, L73, L80) reporting "no in-chain parent frame in the slate" purely because L49/L56/L72/L79
    are not in scope. Prove it the same way lesson 17 proves the place seeds: re-run the earlier
    range in its own scope and confirm 0. Do not read a rising out-of-scope count as regression.

---

# FIFTH 4 - act 4 opening authored fresh (L149-L195), 2026-08-05

FRESH-AUTHORING over P15-P18, appended after the LOCKED L01-L148 (byte-identical, verified: the
first 201,779 bytes and the whole `thumbnail` tail are unchanged). Inputs: the VPW SKILL,
`vpw-fresh-skeleton.md`, this log (lessons 1-23), `vpw-fifth3-report.md`, `script.md`, the real
word timings in `assets/voiceover.manifest.json`, `visual-grammar.md`, `style-bible.md` (§1/§2/§2d),
`shots-schema.md`, `registry.json` (MAIN checkout), `assets/library/manifest.json`, `research.md`,
`lint_shots.py` + `forge.py`, and the CURRENT `shots.json` for lineage. No archived or quarantined
file was read. $0, no provider call, nothing committed.

**47 shots, 98.60 s, avg 2.10 s, every real hold inside 1.52-3.0 s.** New place `denver-newsroom`
(plate L172, `owner_ambiguity: true`); `brick-warehouse` (L03), `miniscribe-plant` (L28),
`wiles-office` (L63) and `miniscribe-boardroom` (L71) all revisited. 47 scenes + 11 STEP-1 figure
gens (only 8 of them new to the file). The fifth ends at **exactly 80.0 % of the VO** - the end of
P18, t = 432.060 s. Lint: **1 HARD**, the duration-sum coverage artifact. Forge dry-run over
L149-L195: zero refusals, exit 0. Detail in `vpw-fifth4-report.md`.

## Lessons for the final fifth

24. **A whole-file scoped run is the only clean proof that an "outside the scope" count is an
    artifact - and it costs one command.** Lesson 23 said to re-run the earlier range in its own
    scope; that shows the earlier fifth is clean but never proves nothing real is left anywhere.
    Scoping to ALL shots (here: the 194 that are not L29, whose `_staging/` refusal predates this
    run) reported `0 seeding-law violation(s) remain OUTSIDE the scope`, exit 0, which settles the
    whole file in one probe instead of one probe per fifth. Do that first; only bisect if it is
    non-zero.
25. **An un-minted cast slug ships as a BARE CONTROL TOKEN, and the dry-run says so silently.**
    `rifenburgh-ceo` is planned by the skeleton and legal to author (the Pass-1 gate exists exactly
    for it), but forge's `shot_cast` cannot resolve a name the registry and the video's Pass-1
    library both lack: it emits NO STEP-1 card and passes the backticked slug straight into the
    scene payload, with no refusal and no warning - the shot just reads `(no cast - the scene
    composes from the place)`. That is the `prop-drive` failure act 1 fixed, wearing a cast name.
    Author the slug, but read the dry-run's per-shot cast line to confirm what forge actually saw,
    and write the Pass-1 mint into the shot's own `notes` as a prerequisite.
26. **A near-miss on the POSE is a new STEP-1 card, whatever the expression says.** L168 wanted
    `miniscribe-rep` deadpan and act 1 already mints a deadpan card - but as
    `fig-miniscribe-rep--action-powerstance--expr-deadpan`. The card name is the reuse key and the
    pose is half of it, so "we already have that face" is not a budget saving unless the POSE also
    matches the beat. Check the pose before claiming reuse in a report; the dry-run's
    `GENERATE`/`shared` verdict is the arbiter.
27. **Watch the class that matches the ACT's shape, not just the class that repeats.** Act 4 is
    rooms full of people, so the first pass reached for `crowd-multiplication` on 30 % of the range
    - not by copying itself, but by answering "there are people in it" with the same class every
    time. The fix is to re-ask what each beat IS: a conspiracy huddle is `staged-interaction`, a
    found object is `literal`, a year on a ledger spine is `number-glued-to-object`. Lesson 12
    watches the repeated WORLD; this is its sibling - a repeated ANSWER to a repeated question.
28. **Fixing a hold inversion can pay a CONTENT dividend, so try the anchor move before accepting
    the flag.** `junk-padding`'s base was 1.56 s against a 2.34 s delta AND was showing empty
    cartons through a line already naming what went into them. Moving one anchor to
    `"and factory scrap, and whatever"` closed the inversion and handed the base the broken drives
    its own span names, leaving the delta the scrap its own span names. The cadence rule and the
    depiction rule wanted the same cut.
29. **The honest owner call gets easier, not harder, when the script names a CLASS.** "the Denver
    newspapers" is a plural class with no masthead anywhere in the script or the fact ledger, so
    `owner_ambiguity` is not the fallback - it is the only non-fabricating answer, and the unmarked
    newsroom is also the truer image (the tip went to the papers, so the room is any of them).
    Compare `brick-company-yard`, where the script names one business and puts a transaction through
    it: that is what a `place_owner` looks like.

---

# FIFTH 5 - the FINAL fifth authored fresh (L196-L248); THE FILE IS COMPLETE, 2026-08-05

FRESH-AUTHORING over P19-P23 to the END of the VO, appended after the LOCKED L01-L195
(byte-identical, verified: the first 263,545 bytes and the whole 2,431-byte `thumbnail` tail are
unchanged). Inputs: the VPW SKILL, `vpw-fresh-skeleton.md`, this log (lessons 1-29),
`vpw-fifth4-report.md`, `script.md`, the real word timings in `assets/voiceover.manifest.json`,
`visual-grammar.md`, `style-bible.md`, `shots-schema.md`, `registry.json` (MAIN checkout),
`assets/library/manifest.json`, `research.md`, `lint_shots.py` + `forge.py`, and the CURRENT
`shots.json` for lineage. No archived or quarantined file was read. $0, no provider call, nothing
committed.

**53 shots, 108.02 s, avg 2.04 s, every real hold inside 1.51-2.85 s, zero base/delta inversions.**
New place `jury-courtroom` (plate L196, `owner_ambiguity: true`, five non-contiguous runs);
`brick-warehouse` (L03), `miniscribe-plant` (L28) and `brick-company-yard` (L113) revisited. The
skeleton's withheld peak is SPENT here: L217 (the only floor-level look-up in 248 shots), L244 (the
tug-of-war over the audit) and L248 (the endless warehouse aisle, a bookend to the L03 hook).

**File total: 248 shots, 541.29 s. Lint: ZERO HARD - both partial-coverage HARDs cleared on measured
VO (541.29 s against a 474.45 s bar; 248 shots against a 140 floor), nothing padded. Whole-file forge
dry-run: exit 0, zero refusals, `0 seeding-law violation(s) remain OUTSIDE the scope`. 248 scenes + 48
STEP-1 cards + 8 plates.** Detail in `vpw-fifth5-report.md`.

## Lessons (the file is done; these are for the NEXT video)

30. **Two named cast must never share one expression slug in the same shot.** `forge.py` binds an
    expression token once per shot, so the second figure's STEP-1 card comes back with NO expression at
    all - L212's draft gave `hq-banker` and `auditor-rep` both `expr-deadpan` and minted
    `fig-auditor-rep--hold-paper-by-sides` (register-less) instead of reusing the deadpan card that
    already existed. The fix is a register decision, not a wording one: give each figure the expression
    its own half of the beat wants. Caught at the dry-run at $0; it would have generated a faceless
    reference card at gen time. Same family as lesson 13 - the seeding layer, not the grammar, decides
    what an authored token actually buys.
31. **An ampersand (or any punctuation-only token) inside a `vo_ref`'s first FOUR words makes the anchor
    un-matchable.** `render.py::match_shots_to_tokens` builds the needle from `vo_ref.split()` and DROPS
    empty-normalizing tokens, while the VO-timing stream lint feeds it KEEPS them - so `"Hambrecht &
    Quist got"` becomes the 3-token needle `[hambrecht, quist, got]` and can never match `hambrecht`,
    `""`, `quist`, `got` in the stream. P19's H&Q beat anchors on `"Quist got hit too,"` instead. Check
    the first four words of every anchor for `&`, dashes and bare numerals-with-symbols before authoring.
32. **A place's plate is proved by the SEEDS its followers get, not by forge's printed `PLATE` tag.**
    Forge tags the frame whose slate ended up EMPTY; a text-bearing plate carries the derived
    `lettering-marker-italic` seed, so L196 printed as a LETTERING row and not as `PLATE` while still
    being the place-first frame every courtroom shot seeds (`L197/L206/L216/L217/L218/L222/L226: [L196,
    ...]`). Read the followers' slates before concluding a plate did not take.
33. **Check the coverage arithmetic before densifying to clear the duration-sum HARD.** The bar is 85 %
    of `vo_words / header_wpm * 60`, and the fifths' MEASURED VO already overshot it here by 66.8 s
    (541.29 s against 474.45 s) - a file sized off forced-alignment timings clears the header-derived
    bar with room to spare, because the real voice runs faster than the header's rate. Densifying to
    "make the number" would have been padding a check that was already going to pass.
34. **An anonymous individual the beat seems to demand has a THIRD answer: draw the ACT, not the actor.**
    P20 puts a judge on screen and P19 a jury foreman, and both are individuals with a face requirement -
    which under the tier law means named cast or restage. With the video's planned cast closed four acts
    earlier, neither was minted: L206 draws the verdict card out on the corridor floor past an open side
    door, and L197 propped on the box rail. The rule of thumb - cast, mass action, or the RESIDUE of the
    act - keeps a late act from inventing a slug for one line.
35. **Build the last cut to the END of the audio, not to the last word's start.** `real_cadence_check`
    skips the final shot (no next anchor), so nothing will flag a closing hold sized wrong; the outro
    beat is the author's to size. L248 anchors at 537.160 s and is declared 2.92 s to the track's
    ~540.08 s end. Sizing it to the last word would have declared 0 s and left `render-builder` to
    stretch it.
