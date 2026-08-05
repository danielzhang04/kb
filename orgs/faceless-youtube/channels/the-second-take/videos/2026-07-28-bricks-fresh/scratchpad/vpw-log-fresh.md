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
