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
