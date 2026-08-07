# Phase 6c-slice-2 genlog — bricks-fresh SECOND tenth

Worker: phase-6c-slice-2 image-generation worker. Repo `C:/Users/danie/kb` (main checkout, NO git writes).
Started 2026-08-06. Engine default 1K (~$0.039/call). **HARD spend ceiling $5.00.**
Kit: `C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit`.
shots.json: the FULLY RE-AUTHORED file (246 shots, commit d680fda, 2026-08-06).

## STEP A — clean slate (done)

`assets/scenes/` held 24 PNGs + `manifest.json` from the SUPERSEDED old shots.json.
All 25 entries MOVED to `assets/_archive-pre-regen-2026-08-06/`. Fresh empty
`assets/scenes/` created with `manifest.json == {"shots": []}`.
Binding law honoured: nothing in any `_archive-*` directory seeds anything, and no
old-file frame can now collide with a new-file shot id.

## STEP B — slice bounds

**Slice: L26 – L50 (25 shots).** 246 shots total; 25/246 = 10.2% — the second tenth.

Boundary snap (outward to stage boundaries; a held stage never splits):

| shot | stage | role | boundary verdict |
| --- | --- | --- | --- |
| L25 | packing-trestle | delta | last beat of the previous tenth's chain — slice STARTS after it |
| **L26** | (none) | — | unstaged → is its own boundary; **slice start** |
| L49 | bank-office | base | single-shot stage, closed at L49 |
| **L50** | (none) | — | unstaged → is its own boundary; **slice end** |
| L51 | (none) | — | outside |

Naive second tenth = L26–L50; both endpoints already fall on stage boundaries, so the
outward snap is a no-op and no chain is split. Chains fully contained: `floor-reveal`
(L29), `founding-unit` (L30–L31), `ibm-deal` (L33–L34), `growth-stack` (L35),
`inflation-beam` (L40–L42), `order-cut` (L44), `layoff-line` (L46), `johnson-exit`
(L47), `trouble-floor` (L48), `bank-office` (L49).

## STEP C — prerequisite closure

**Place plates.** One place in the slice: `miniscribe-floor` (L28, L29, L33, L34, L44,
L46, L47, L48). Its place-FIRST shot in the new file is **L28** — which is IN the slice
(no shot before L26 declares any `place`). So the plate is minted by this slice from its
own shots.json entry; no first-tenth plate import is needed, and the empty
`assets/scenes/` is not a blocker (contrast p6b, which blocked 9 shots on exactly this).
Generation order therefore puts L28 before every other `miniscribe-floor` shot.

**Named cast needed:** `miniscribe-rep`, `terry-johnson`, `ibm-suit`, `hq-banker`.
All four resolve — the first three from `visual-kit/registry/registry.json`, `hq-banker`
from the video's own `assets/library/manifest.json` (`kind: identity`). Registry cards
exist from prior runs: REUSED, never re-minted.

**Seeded performers (`base`):** L27, L32, L38, L43, L46 — at most one per shot
(L38 pairs `base` with named `miniscribe-rep`, which is legal; L46 pairs `base` with a
declared crowd). Cards are minted by forge's STEP-1 route, keyed place+dress-hash.

**Primitives / anchors:** all 24 pose/expression/action names plus `prop-drive`,
`handshake` (interaction), `crowd-exemplar`, `lettering-marker-italic` and
`scene-style-tile` resolve against the registry + video library. Zero unresolved tokens.

**Human-gate items:** `brick-co-seller` does NOT appear anywhere in L26–L50 (checked by
backtick extraction over all 25 still_prompts). L239 is far outside the slice. So no
slice shot is blocked on a Pass-1 human gate.

## Call log

### Slate build ($0)

`forge.py batch --shots L26..L50` → `scratchpad/6c2-slate.json`:
**25 scenes + 19 STEP-1 figure gens, 0 not generated, 0 refusals.**
(33 seeding-law violations remain OUTSIDE the scope — they are later-tenth shots, untouched.)
1 figure card REUSED under the C-6 gate: `fig-terry-johnson--carry-by-handle--expr-crestfallen`
(all-pass, digest-current review record from a prior run). Split into
`6c2-wave1-figs.json` (19 cards) and `6c2-wave2-scenes.json` (25 scenes) so every performer card
is rig-verified BEFORE a scene spends on it.

Pre-run housekeeping: `_staging/` held **66 stale L26–L50 scene frames** from the SUPERSEDED
shots.json (incl. `L28.png`, which forge would have silently seeded as the `miniscribe-floor`
place plate for L29/L33/L44/L46/L47/L48). All 66 MOVED to
`_staging/_pre-6c2-archive-2026-08-06/`. Nothing outside the slice range was touched.

Dry-run `6c2-dryrun-wave1.txt`: 19/19 assembled clean, `aspect=2:3 size=1K`, truthful ordinal
seed-role prose, era §2b descriptor at HEAD. Seeded-performer cards carry their costume clause
derived from the minting shot's own prose (L27 "brown warehouse coat", L32 "white lab coat and
quilted oven gloves", L46 "miniscribe-floor" dress-hash).

### Wave 1 attempt 1 — ABORTED on a provider-wide outage

| # | card | status | cost |
| --- | --- | --- | --- |
| 1 | fig-base--hold-one-hand--expr-deadpan--l27-d4b1f2ce | **ERR HTTP 503** high demand | $0 (no image) |
| 2 | fig-miniscribe-rep--action-powerstance--expr-delighted | **ERR HTTP 503** | $0 |
| 3 | fig-terry-johnson--action-armscrossed--expr-thinking | **ERR HTTP 503** | $0 |
| 4 | fig-base--action-recoil--expr-shock--l32-36f3a4e9 | **ERR HTTP 503** | $0 |
| 5 | fig-ibm-suit--expr-smug | **ERR read timeout** | $0 |
| 6 | fig-miniscribe-rep--expr-delighted | killed mid-call | $0 |

**0/6 produced an image.** Five consecutive 503s naming the SAME cause
("This model is currently experiencing high demand") is a provider-wide outage, not the per-call
flake Daniel's one-re-issue law is written for — so the batch was KILLED at item 6 rather than
walked into the wall for all 19 slots. Orphan lock
`fig-miniscribe-rep--expr-delighted.png.lock` removed (owner PID dead).
Spend so far: **$0.00** — no provider call returned an image, so nothing is billable.

### Wave 1 attempts 2–5 — 19/19 STEP-1 cards minted through a flapping provider

The outage was intermittent, not total: a single canary landed, a serial batch then 503'd
wall-to-wall, and repeated passes over ONLY the still-missing items walked it home. Driver:
`scratchpad/6c2_drive.py` (re-issues just the items with no frame on disk, stops on a pass that
produces nothing). A 503 returns no image and is billed nothing, so it is a TRANSPORT failure and
not the content failure the one-retry law governs — no content retry was consumed by any of them.

| attempt | spec | minted | transport failures |
| --- | --- | --- | --- |
| canary | 6c2-canary.json | 1 | 0 |
| 1b | 6c2-wave1-rest.json (18) | 2 | 16 |
| 1c | 6c2-wave1-miss.json (16) | 4 | 12 |
| drive pass 1 | 12 | 8 | 4 |
| drive pass 2 | 4 | 3 | 1 |
| drive pass 3 | 1 | 0 | 1 (stopped, provider down) |
| probe (post-restore) | 6c2-probe.json (1) | 1 | 0 |

**19/19 minted. Billable gens: 19 × $0.039 = $0.741. Running total $0.741 / $5.00.**
Every card 848×1264 (2:3 @ 1K), as the reference-sheet law requires.

### Ink measurement — all 19 STEP-1 cards

`p6b_ink.py`: **19/19 WARM, zero cool inversions.** ink_hue 10.6°–17.1° for 17 cards; the two
`ibm-suit` cards sit at 352.6°/355.7° — the warm-RED side of the 0/360 wrap, not a cool
inversion (R-B +19.5 and +20.9, both positive). R-B range **+19.5 … +50.3** (target ~+18, so
every card is at or above the warm target). Median saturation ~0.028–0.039 is expected and NOT a
defect on these frames: a STEP-1 card is a figure on a flat pale-grey studio backdrop, so the
frame-wide median samples backdrop, not scene palette. Scene saturation is judged on wave 2.

### Wave 1 rig review — 16 pass / 3 fail

Fresh-eyes per-invariant review of all 19 STEP-1 cards (opus subagent acd947d0e2acccb63).
16 all-pass. Three parked:

| card | axis | defect |
| --- | --- | --- |
| fig-base--action-recoil--expr-shock--l32-36f3a4e9 | rig | crosshatch quilting lattice on both oven gloves, 1-3px vs a 6-7px rig outline |
| fig-base--hold-both-hands--expr-crestfallen--miniscribe-floor-4bd17718 | rig | five hairline ruling strokes on the carried sheet + pen-clip line + leaf veins, all under outline weight |
| fig-hq-banker--action-armscrossed--expr-skeptical | expression-register | face read identical to this character's own deadpan card |

Rejected originals archived READ-ONLY at `_staging/_rejected-6c2/`.

### STEP-1 retry mint — 3 cards, 23:06

`6c2-step1-retry.overlay.json` + `6c2-step1-retry.spec.json`: one corrective clause per card,
appended at the tail of an otherwise byte-identical payload (changed_spans=1 each).
3 gens landed first attempt, 848x1264 as required.
**Billable: 3 x $0.039 = $0.117. Running total $0.741 + $0.117 = $0.858 / $5.00.**

### Retry verification — 2 pass / 1 fail (fresh-eyes, opus subagent a7788b30)

All three retries re-ruled on the FULL rubric, not only the corrected axis, and each compared
against its rejected original in `_rejected-6c2/` to confirm the defect actually moved.
Verdicts written to all three stores (`_staging/review.json` C-6 record, `6c2-figure-rulings.json`,
`assets/_review/figure-verdicts.json`); each record's `canonical_sha256` re-read from the retry
bytes, so the stores no longer describe the rejected files. Nothing moved on disk.

**`fig-base--action-recoil--expr-shock--l32-36f3a4e9` — FAIL (rig), same axis, defect unchanged
in kind.** Both oven mitts are still filled edge-to-edge with a repeating diamond quilting
lattice. Measured on the frame's own pixels: mitt rig outline 6-7px at luminance 23-40, interior
lattice strokes 2-4px at luminance 68-92 — thinner AND lighter than the outline, exactly the
hairline micro-pattern the checklist forbids and exactly what "ONE FLAT UNIFORM colour fill / NO
quilting, NO crosshatch, NO diamond lattice" was written to remove. The gen changed the glove
FORM (five-digit gloves -> closed thumb-and-body mitts) but not the fill; with closed mitts the
4-digit hand invariant is now fully occluded and unverifiable on this card. Every other axis
passes. Left in place at `_staging/`, unparked, for the boss's call.

**`fig-base--hold-both-hands--expr-crestfallen--miniscribe-floor-4bd17718` — PASS (all axes).**
Box, ruled sheet, pen and clip line, and the veined plant are simply not drawn — the hands are
empty, so the hairline strokes have nothing to sit on. Every remaining line scanned at 4-7px /
luminance 14-39: one uniform rig register, coat outline through lapel, placket, both patch
pockets, cuffs, trouser seams and shoes. Costume, crestfallen register, flat cel, head tone,
proportion, ground line + single contact shadow and text-free all hold; no unauthored duplicate
element appeared. Two observations for the boss, neither a rig defect: the pose drifted from a
chest-height carry to arms hanging at the sides (the gen resolved "empty two-handed hold" as arms
down), so the card no longer reads as a carrying posture for L46; and the left hand is partly
occluded by the coat's front edge (right hand is a clean matching 4-digit rig hand).
Checked and dismissed: the faint pale arcs beside the inner brow and eye are the shared base-rig
template's construction wisps, present identically on the three PASSING wave-1 `base` cards.

**`fig-hq-banker--action-armscrossed--expr-skeptical` — PASS (all axes).** Compared side by side
against the passing `fig-hq-banker--action-offering--expr-deadpan`. Brow ink centroid in a fixed
window above each eye: deadpan L=244.5 / R=243.8 (0.7px apart, level and symmetric), retry
L=267.5 / R=233.1 (34.4px apart, a clear asymmetric arch), with 25% more ink on the lowered brow
(573 vs 458px). Peak eye-white height 44->39px and 45->40px, the upper lid redrawn lower,
straighter and heavier — a squint, not the stock open half-lid. Mouth is a flat line pulled to
one side ending in a cheek crease, replacing the deadpan upcurve. Restrained, not a comedic peak.
No collateral drift: identity, swept grey hair, head tone, the pinned three-piece pinstripe suit,
tie and watch chain all hold, and the pinstripe register is byte-comparable to the passing
sibling (same trouser row: runs 3-8px, peaks 107-121, fill median 68/69 on both), so the retry
neither introduced nor escalated a hairline field.

**Verification spend: $0** (review only, no gens). Running total unchanged at $0.858 / $5.00.
**16 + 2 = 18/19 STEP-1 cards verified. One card, the L32 oven-mitt figure, is still unfit for
wave 2.**

### L32 mitt card — mechanism note, not a third prose retry

Two prose attempts have now told this gen, in escalating absolute terms, not to draw a quilting
lattice, and it drew one both times. The instruction is not being under-specified; it is being
overridden by the noun. "Quilted oven gloves" is the costume clause the seeded-performer route
derives from L32's own shot prose, and "quilted" carries the lattice as part of the object's
identity in the model's prior — a negative clause further down the payload cannot outweigh the
object name it is arguing with. A third prose retry is predicted to fail the same way and should
not be spent.

The mechanism fixes, cheapest first:
1. **Strip the texture adjective at derivation.** The costume clause is machine-derived from the
   shot's still_prompt, so the fix belongs in the derivation, not in a per-card retry: filter
   texture/pattern adjectives (`quilted`, `crosshatched`, `ribbed`, `pinstriped`, `woven`,
   `checked`, `herringbone`) out of the clause the STEP-1 card inherits, and let the scene, not
   the reference sheet, carry any texture. This is one change in the forge costume-derivation
   path and it retires the whole defect class, not this one card.
2. **Failing that, re-author L32's own prose** in shots.json from "quilted oven gloves" to
   "plain oven gloves" — but that edits shots.json, which is outside this slice's authority and
   is the boss's call.
3. Do NOT hand-park the card and let wave 2 seed it: L32 is a seeded-performer shot and the
   scene would inherit the lattice.


### Mechanism fix — micro-pattern texture adjectives stripped at derivation

Option 1 from the note above, built. `.claude/skills/image-generation/scripts/forge.py`:
`MICRO_PATTERN_TEXTURE_WORDS` (52 entries) + `strip_micro_pattern_texture()` added beside
`costume_clause`, and applied in `figure_card_payload` — the one point where a derived clause
becomes rig-register card text. The constant carries the constraint in a comment: rig-register
cards forbid sub-outline line fields (`line-register`, style-bible §rig invariants), so a card may
not be TOLD to draw one; the word goes rather than being argued with.

Two deliberate scope lines. The strip does NOT run in `costume_clause`, because that same string is
hashed into the seeded performer's costume KEY — stripping there would rename, and so silently
re-mint, every performer card already on disk. And it never reaches a named character: cast figures
pass no costume through this route at all, and the registry/library `costume` text is not rewritten,
so `fig-hq-banker`'s pinned pinstripe suit is byte-untouched and a re-mint of it still says
pinstripe. Verb-ambiguous forms (`hatched`, `spotted`, `studded`, bare `knit`) are deliberately
absent from the list — "hatched a plan" and "brow knit" would be corrupted by a strip.

Tests, TDD, both red before the change and green after:
`test_a_micro_pattern_texture_adjective_never_reaches_a_derived_rig_card` and
`test_the_micro_pattern_strip_never_touches_a_cast_characters_pinned_costume`, in
`test_forge_seed_requirement.py`. Forge suite 211 -> 213 passed, 0 failed.

Blast radius on this video, measured not guessed: 8 of 246 shots carry a performer costume clause
the strip touches — L03 and L200 (`pinstripe suit` -> `suit`), L32 (`quilted oven gloves` ->
`oven gloves`), L69/L70 (`corduroy jacket`, `knitted tie`), L171/L173/L243 (`knitted jumper`).
No card NAME changes (the key still hashes the prose as authored), so nothing already minted is
invalidated; only a future re-mint of those eight derives differently.

### L32 re-mint under the changed mechanism — 2026-08-06 23:39

Not a third prose retry: the same overlay entry, re-derived through the fixed derivation. Scoped
overlay `scratchpad/6c2-step1-retry-l32mech.overlay.json` (the L32 entry alone, instruction
unchanged) rebuilt into `scratchpad/6c2-step1-retry-l32mech.spec.json` via
`forge batch --retry`. The derived clause now reads "in a white lab coat and oven gloves" — the
adjective is gone from the payload and the card NAME is unchanged (`...--l32-36f3a4e9`), which is
the key-stability guarantee holding in practice. The twice-failed attempt-2 frame was moved to
`_staging/_rejected-6c2-r2/` (`_rejected-6c2/` untouched) before the mint.

One attempt, one pass, no 503:
`_staging/fig-base--action-recoil--expr-shock--l32-36f3a4e9.png`,
sha256 `57fe0ab97210577558ba2598dc6163201dcded68be96470d1ff4c37516fef91d`, 1,054,547 bytes.
Log `scratchpad/6c2-l32mech-pass1.log`.

**Spend: +$0.039 -> running total $0.897 / $5.00.** Verification is PENDING FRESH EYES — the hand
that minted this frame does not review it (fresh-eyes law), so 18/19 STEP-1 cards remain the
verified count until someone else rules on this one.

### L32 fresh-eyes verification of the mechanism re-mint — VERIFIED

Frame confirmed before judging: `_staging/fig-base--action-recoil--expr-shock--l32-36f3a4e9.png`,
sha256 `57fe0ab9...ef91d`, 1,054,547 bytes, minted 23:39. Verdict **pass / pass / pass** on rig,
expression-register and flat-cel-hazard. The mechanism fix held: **the lattice is gone.**

Measured, not eyeballed, with the same discriminator that condemned both priors — a mask of
sub-outline pixels (luminance 60-140) restricted to glove INTERIOR, i.e. every pixel >=5px from any
outline pixel, so anti-aliasing along the outline cannot contribute:

| frame | interior sub-outline px | fraction of interior | components >=12px |
| --- | --- | --- | --- |
| attempt 1 (`_rejected-6c2/`) | 1015 | 0.070 | **14** (lattice fragments) |
| attempt 2 (`_rejected-6c2-r2/`) | 2399 | 0.135 | 1 mesh of 2131px + 2 |
| **this frame, L glove** | 682 | 0.043 | 3 (440/129/104) |
| **this frame, R glove** | 1149 | 0.078 | 3 (1058/42/33) |

The component COUNT is the tell, and rendering the masks settles what the pixels are. Attempt 2's
mask draws a literal diamond grid across the whole mitt. This frame's masks draw two short tapered
contour creases per glove (finger-base + palm) plus one shading wedge — the 1058px right-glove
component is not a stroke at all but the flat cel shadow along the lower palm, which is why it is
one big blob rather than a mesh.

Glove interior is ONE flat fill, measured on rows: right glove y=650, x=440-520 reads luminance
152-157 across 80px (spread 5 LSB); left glove y=640, x=215-270 reads 151-158. The second tone —
the cel shadow — sits at 123-131 and meets the base tone in a **hard step over ~4px** (x=500 -> 504:
127 -> 151), i.e. two-tone flat cel, not a gradient. Rig outline on the same rows measures **5-8px
wide at luminance 15-40** (`p6b_ink`-style row runs); the surviving interior creases measure **1-4px
at luminance 73-120**. Those creases ARE sub-outline, and they are allowed here: the same
measurement on the passing card `fig-base--hold-one-hand--expr-deadpan--l27-d4b1f2ce`'s hand returns
the identical tapered finger-separation strokes. The checklist forbids a sub-outline stroke FIELD,
and a field is what the two rejects had and this frame does not.

Rest of the rig, per axis. **4-digit hands: verified on BOTH hands**, not unverifiable as on attempt
2 — the mitts are gone, the gloves are open, and each reads three fingers plus one thumb (left-hand
top contour gives exactly four lobes separated by three valleys; right hand confirmed at 4.5x on the
torso crop). Both hands the same size: tan-fill area 12,529px left vs 13,365px right, within 6.7%.
Head form round and bald, no nose, no ears. Head tone one flat cream — luminance std 14.3 over the
head fill, against 12.6 (l27) and 14.0 (l43) on the passing base cards, so the warm right-edge
crescent is the established register, not new drift. Squat proportion held. Plain pale-grey backdrop,
single soft contact ellipse, text-free, exactly one figure, no duplicate or stray elements — the two
tapered strokes off the right wrist are the lab-coat cuff folds and measure 7-8px at luminance 25-31,
i.e. full outline register. Costume matches the derived clause: white lab coat, dark trousers, tan
shoes; identity (head form, eye style, brow, shoe shape) matches l27/l38/l43. Shock register reads
distinctly — wide round eyes with small pupils, high arched brows, open oval mouth with teeth and
tongue.

The negative enumeration in the payload ("draw NO quilting, NO crosshatch, NO diamond lattice")
survived into this mint and did NOT summon the pattern this time. That is worth stating precisely:
it is one observation, not a clearance. The variable that changed was the adjective leaving the
costume clause, and the frame came back clean; the negation is now unproven either way and remains a
cheap thing to cut on the next occasion.

Records written (all three, this frame's sha):
- `visual-kit/_staging/review.json` — via `stamp_review.py --figures` (the sole writer of that
  file), 19 merged, 71 entries, **0 fails**
- `assets/_review/figure-verdicts.json` — pass, `why` key dropped per the pass convention
- `scratchpad/6c2-figure-rulings.json` — pass, `why` set to `""`

**Verification spend $0** (no generation). Running total unchanged at $0.897 / $5.00.
**STEP-1 figure cards now 19/19 verified.**

## Wave 2 — 25 scene shots L26–L50

### Pre-flight (before any spend)

Checked every wave-2 item's `seed` entries in `scratchpad/6c2-wave2-scenes.json` against
`assets/scenes/` (still `{"shots": []}`, dir slate-wiped) and `visual-kit/_staging/`.

**Result: no wave-2 item depends on `assets/scenes/`.** Every `parent`/`place`-role seed that isn't a
`visual-kit/refs/*` canonical resolves to `_staging/L28.png`, `L30.png`, `L33.png`, `L40.png` or
`L41.png` — all five ARE wave-2 items themselves (L28, L30, L33, L40, L41), earlier in the same list,
so they mint within this wave before anything that depends on them. This matches the genlog's own
STEP-C finding (L28 is the place-FIRST `miniscribe-floor` shot and sits inside the slice) — confirmed
independently rather than assumed.

| item | parent/place dep | resolves from | figure/cast cards needed | in `_staging`? |
| --- | --- | --- | --- | --- |
| L26 | none | — | none (style tile only) | — |
| L27 | none | — | fig-base--hold-one-hand--expr-deadpan--l27-d4b1f2ce | yes |
| L28 | none (place-FIRST) | — | none | — |
| L29 | place=L28 | in-wave (L28, earlier) | fig-miniscribe-rep--action-powerstance--expr-delighted | yes |
| L30 | none | — | fig-terry-johnson--action-armscrossed--expr-thinking | yes |
| L31 | parent=L30 | in-wave (L30, earlier) | terry-johnson canonical + prop-drive canonical | yes (refs) |
| L32 | none | — | fig-base--action-recoil--expr-shock--l32-36f3a4e9 (mech re-mint) | yes |
| L33 | place=L28 | in-wave (L28, earlier) | fig-ibm-suit--expr-smug, fig-miniscribe-rep--expr-delighted | yes |
| L34 | parent=L33 | in-wave (L33, earlier) | ibm-suit + miniscribe-rep canonicals | yes (refs) |
| L35 | none | — | fig-miniscribe-rep--action-celebrate--expr-delighted | yes |
| L36 | none | — | fig-miniscribe-rep--action-powerstance--expr-greedy | yes |
| L37 | none | — | fig-miniscribe-rep--action-salute--expr-delighted | yes |
| L38 | none | — | fig-base--action-armscrossed--expr-deadpan--l38-3412012a, fig-miniscribe-rep--action-offering--expr-pleading | yes |
| L39 | none | — | fig-miniscribe-rep--hold-both-hands--expr-greedy | yes |
| L40 | none (chain base) | — | none (style tile only) | — |
| L41 | parent=L40 | in-wave (L40, earlier) | none | — |
| L42 | parent=L41 | in-wave (L41, earlier) | none | — |
| L43 | none | — | fig-base--point-at-thing--expr-deadpan--l43-30b903d1 | yes |
| L44 | place=L28 | in-wave (L28, earlier) | fig-ibm-suit--action-thumbsdown--expr-annoyed | yes |
| L45 | none | — | fig-miniscribe-rep--action-recoil--expr-shock | yes |
| L46 | place=L28 + crowd-exemplar | in-wave (L28, earlier) + refs | fig-base--hold-both-hands--expr-crestfallen--miniscribe-floor-4bd17718 | yes |
| L47 | place=L28 | in-wave (L28, earlier) | fig-terry-johnson--carry-by-handle--expr-crestfallen (REUSED, C-6 gate) | yes |
| L48 | place=L28 | in-wave (L28, earlier) | fig-miniscribe-rep--action-slump--expr-worried | yes |
| L49 | none | — | fig-hq-banker--action-armscrossed--expr-skeptical (retry-verified) | yes |
| L50 | none | — | fig-hq-banker--action-offering--expr-deadpan | yes |

All 20 distinct figure-card filenames referenced across the 25 items (19 minted this run + 1 REUSED)
confirmed present in `visual-kit/_staging/` by direct glob. All named-cast canonicals
(`terry-johnson`, `ibm-suit`, `miniscribe-rep`, `hq-banker`) and env refs (`scene-style-tile`,
`lettering-marker-italic`, `prop-drive`, `handshake`, `crowd-exemplar`) confirmed present in
`visual-kit/refs/`. **0 items blocked. No fail-loud base-guard trip expected** — proceeding to mint.

### Drive

`py -3 scratchpad/6c2_drive.py scratchpad/6c2-wave2-scenes.json 6c2-w2drive` — mirrors the wave-1
invocation shape exactly (spec, prefix, default max_passes=8); the driver hardcodes
`--kit .../visual-kit` itself, so no separate `--kit` flag applied on top.

**Pass 1:** 25 queued, 20 minted, 5 transport-failed. Billable: 20 x $0.039 = $0.78. Running total
$0.897 + $0.78 = **$1.677 / $5.00**.

**Pass 2:** 5 queued (re-issue of pass-1 misses), 2 minted, 3 transport-failed. Billable: 2 x $0.039 =
$0.078. Running total $1.677 + $0.078 = **$1.755 / $5.00**.

**Pass 3:** 3 queued (re-issue of pass-2 misses), 2 minted, 1 transport-failed. Billable: 2 x $0.039 =
$0.078. Running total $1.755 + $0.078 = **$1.833 / $5.00**.

**Pass 4:** 1 queued (L38, the last pass-3 miss), 0 minted, 1 transport-failed (4th consecutive HTTP
503 on this item alone). Driver declared "provider is down" and stopped (exit 1) — this is its
designed behavior on a zero-gain pass, not a crash. Billable: $0. Running total unchanged at
**$1.833 / $5.00**. 24/25 minted; only L38 remains. Well under the $4.50 soft-stop, and wave 1's own
history shows this exact outage pattern was intermittent rather than total (5 separate invocations
eventually cleared it) — re-invoking the driver once more on the same spec (`6c2-w2drive-retry`
prefix) for the single remaining item.

**Retry pass 1:** 1 queued (L38 alone), 0 minted, 1 transport-failed (5th consecutive HTTP 503 on
this single item, across pass 2/3/4 and this retry). Driver stopped again ("provider is down").
Billable: $0. Running total unchanged at **$1.833 / $5.00**.

**STOP — driver declares provider down, per the wave's stop conditions.** 24/25 minted. L38
(`One seeded performer, base, expr-deadpan, action-armscrossed` — giant-suit/tiny-miniscribe-rep
two-shot) is the sole unminted item, blocked purely on transport (HTTP 503 "experiencing high
demand"), not content or spec — nothing billable was lost, and no fail-loud guard tripped anywhere
in the wave. One bounded extra invocation (beyond the driver's own 8-pass ceiling) was tried, given
wave 1's precedent that this exact outage class cleared on a later attempt; it did not clear this
time. Handing back rather than looping further, per the "do not improvise, report" stop condition —
L38 is a clean natural re-issue candidate (missing from `_staging/`, nothing else touched) whenever
the provider clears, well inside the remaining $3.167 of headroom.

**Wave 2 final: 24/25 minted. Wave-2 spend added: 24 x $0.039 = $0.936. Running total
$0.897 + $0.936 = $1.833 / $5.00.**

## Wave-2 RETRY round 1 (`6c2-w2retry`) — 2026-08-07

Input: the two fresh-eyes verify records (`6c2-w2verify-a`, fails L27/L32/L33/L34; `6c2-w2verify-b`,
fails L39/L44/L45/L46/L47/L48/L49) plus L38, never minted (transport 503).

### STAGE 0 — one authoring fix in shots.json (boss-authorised, exact scope)

L49 `still_prompt`: `a navy chalk-stripe three-piece suit` -> `a brown chalk-stripe three-piece
suit`. ONE word, inside the phrase the shot note calls the pinned outfit; nothing else in L49 and no
other shot's prose touched. Authority: `refs/hq-banker/hq-banker.png` (read directly) draws a warm
BROWN chalk-stripe three-piece with a gold watch chain across the waistcoat, and the passing L50
frame renders that same brown suit; the authored navy sat inside noise of the `ibm-suit` canonical,
who appears at L44 in the same act. Logged to `knowledge/decisions.md` (2026-08-07 entry), and
FLAGGED for Daniel at the 6c2 gate because it edits authored shot prose.

**L49 place seed on L50: NOT EXPRESSIBLE, so the boss's stated fallback applied.** The
`forge batch --retry` seed/mechanism authority requires that an added seed either REPLACE a named
in-chain parent or REORDER existing provider seeds, and `_is_scene_seed()` recognises only
`assets/scenes/` paths. Every frame of this run still lives in `visual-kit/_staging/`, so there is no
scene-seed to replace and a bare addition is refused as additive. L49 was therefore retried UNSEEDED
with an explicit match-L50 room clause in prose (oak plank floor / raised-and-fielded oak paneling /
plain oak desk top — the three axes verify-b measured L49 and L50 disagreeing on).

### STAGE 1 — the overlay

`scratchpad/6c2-w2retry.overlay.json`, schema `forge-retry-overlay@2`.

**Mechanism finding that shaped every entry: a scene retry FORBIDS an additive `instruction`.**
`_retry_scene()` accepts exactly one surgical authority — one exact `replace {from,to}` whose `from`
occurs exactly once in the canonical payload, OR a seed/mechanism swap — and it hard-refuses
`instruction` outright. So each corrective is authored as ONE contiguous replaced span of the shot's
own prose, never an appended clause (appending is the STEP-1 route only). A second constraint rides
along: `_EXPRESSION_RETRY` refuses `expr`/`expression`/`facial`/`smile`/`grin`/`teeth`/`smug`/
`deadpan`/`worried`/`angry`/`sad`/`fear` anywhere in from+to, so no span may quote a backticked
`expr-*` token or name a mouth register by its own word — expression defects route to a STEP-1
re-mint by design. L33's mouth note is therefore carried as "his mouth closed with no tongue
showing", and the frame otherwise relies on its already-verified
`fig-miniscribe-rep--expr-delighted` card for the register.

Ten corrective entries, one `replace` each:

| id | the one corrective |
| --- | --- |
| L27 | BOTH hands closed on the sheet's leading edge, both full 4-digit rig hands at matched size, each wrist ending in a drawn cuff; no mitten, stub or fingerless shape |
| L32 | fire bucket completely BLANK — no stencil, no letter, no marking anywhere in frame — and small/muted in tone so the glowing drive stays the one dominant red mass |
| L33 | the man in the tan blazer drawn exactly as his reference sheet: warm dark BROWN hair never black, side-parted quiff with a visible sideburn, the same head outline, mouth closed |
| L39 | '600 MILLION' on the REAR DOOR PANEL his hands are on and nowhere else (no side, no roof); notes bulge OUT OF THE LOAD BED between those doors; roof bare |
| L44 | tote rack VISIBLY HALF EMPTY and plainly different from the plate (upper shelves stripped bare); MINISCRIBE fascia board still hanging per the plate; warm-ink clause |
| L45 | gap IN FRONT of the boots, both boots flat on solid rock behind the lip; both hands 4-digit and matched, never five digits |
| L46 | stage-LEFT and walking AWAY down the length of the floor toward the roller door (not lateral); box held chest-height in BOTH hands, arms bent; fascia board per plate; warm-ink clause |
| L47 | already OUTSIDE on the tarmac apron one pace clear of the glass door, exterior daylight/bays/sky around him, the floor visible only through the glass; foreground kerb is a real kerb stone, never a bench |
| L48 | slump EXECUTED — shoulders dropped, head hanging forward, back curved; racks stripped to bare metal; the cold shaft lands BESIDE him, not on him; warm-ink clause |
| L49 | room pinned to the L50 render: oak plank floor (no carpet), raised-and-fielded oak paneling behind, PLAIN OAK desk top (no green leather inset) |

Warm-ink clause on L44/L46/L48 as briefed — the three L28 children measured on the R−B zero line
(+0.13 / +0.97 / +0.03); the seed carries neutral ink, so the retry states the house ink explicitly.

L38 rides as a PLAIN RE-ISSUE of its untouched wave-2 request (no overlay; never minted, transport
only).

### STAGE 1c — L34 BLOCKED, not minted

L34 is a delta on L33 and must re-mint off the NEW L33. It cannot. The retry output name may not
equal the canonical shot id (`cmd_retry_batch` refuses `name == shot`), so the repaired frame is
`L33-fix.png`, while `cmd_batch` resolves a chain parent as `emitted[parent]` -> `_staging/L33.png`,
or failing that `assets/scenes/L33.png` — never the `-fix` name. The seed-swap authority built for
exactly this case (`_repaired_parent_matches` + `_derived_from`) is gated behind `_is_scene_seed`,
i.e. `assets/scenes/`, and nothing in this run is promoted. The sanctioned route is therefore the
designed one: fresh-eyes verify `L33-fix`, stamp it, promote it to `assets/scenes/L33.png` with
`review_status: verified`, and only then retry L34 — its parent then resolves from `assets/scenes/`
and passes the verified-parent check. Handed back rather than minting L34 off the black-haired
parent it would otherwise inherit.

### STAGE 1d — the L28 scope scaffold (a $0 workaround for a known fail-silent forge defect)

`cmd_retry_batch` rebuilds the canonical requests SCOPED to the shots named in the overlay. Five of
the failing shots (L33, L44, L46, L47, L48) are `miniscribe-floor` children whose place plate is
L28 — a PASSING frame, so not in the overlay — and a scoped rebuild resolves the plate as
`emitted[L28] or assets/scenes/L28.png`. With L28 out of scope and nothing promoted, both miss and
forge SILENTLY drops the place seed (decisions.md 2026-08-06 already logs this fail-silent
degradation class). Probed empirically before authoring anything: a single-entry L44 overlay built
with seeds `[fig-ibm-suit--action-thumbsdown--expr-annoyed]` and NO plate — that retry would have
re-invented the assembly floor and destroyed the continuity these frames actually got right.

Fix: one extra overlay entry for L28 (`L28-scope-scaffold`, a null-effect replace) purely to pull L28
into the rebuild scope. `emitted[L28]` is keyed on the CANONICAL id, so the five children get
`_staging/L28.png` — the existing, verified plate — exactly as the wave-2 build did. Verified
machine-side: all 11 built items seed-match their wave-2 originals filename-for-filename. The
scaffold item is then DROPPED from the drive spec (the same subsetting `6c2_drive.py` performs on
every pass) and is never generated: **$0 spent, no stray frame.**

### STAGE 2 — staging hygiene before the mint

`_staging/_rejected-6c2-w2r1/` created; the 10 superseded failing frames (L27, L32, L33, L39, L44,
L45, L46, L47, L48, L49) MOVED there. Confirmed machine-side first that no seed in the built spec
references any moved frame. The 13 passing frames and the L28 plate were not touched. Retries land
under the `<id>-fix` name — forge's own repaired-frame convention (`_derived_from`) — because the
builder refuses a retry output named for its canonical shot.

### STAGE 2 — the mint

Drive spec `scratchpad/6c2-w2retry.drive.json` = the 10 corrective retry requests emitted by
`forge batch --retry` (scaffold dropped) + L38's untouched wave-2 request. Driver:
`py -3 scratchpad/6c2_drive.py scratchpad/6c2-w2retry.drive.json 6c2-w2retry`.

| pass | queued | minted | transport-failed (HTTP 503) |
| --- | --- | --- | --- |
| 1 | 11 | 3 (L27-fix, L32-fix, L33-fix) | 8 |
| 2 | 8 | 4 (L44-fix, L46-fix, L48-fix, L49-fix) | 4 |
| 3 | 4 | 1 (L47-fix) | 3 |
| 4 | 3 | 0 | 3 — driver declared "provider is down", stopped (exit 1, designed behaviour) |
| re-invoke pass 1 (`6c2-w2retry-b`, bounded, wave-1 precedent) | 3 | 0 | 3 |

**8/11 minted.** Landed: `L27-fix`, `L32-fix`, `L33-fix`, `L44-fix`, `L46-fix`, `L47-fix`,
`L48-fix`, `L49-fix`. Still missing, transport ONLY (no content failure, no spec error, no fail-loud
guard trip anywhere in the wave): **`L39-fix`, `L45-fix`, `L38`** — all three 503 "experiencing high
demand". L38 has now taken 8 consecutive 503s across wave 2 and this retry wave without ever
returning an image; L39-fix and L45-fix took 5 each. One bounded extra driver invocation was spent on
them per the wave-1 precedent and did not clear it, so the wave stops here rather than looping.

**Spend: 8 x $0.039 = $0.312. Running total $1.833 + $0.312 = $2.145 / $5.00.** A 503 returns no
image and is billed nothing. The L28 scope scaffold was never generated and cost $0.

**NOT minted by design: L34** (see STAGE 1c — blocked on `L33-fix` being verified and promoted).

**Verification is PENDING FRESH EYES.** The hand that minted these eight does not review them; none
of the eight frames was opened by this worker. `_staging/` now holds `<id>-fix.png` for the eight,
the 13 passing wave-2 frames untouched, and the 10 superseded originals in
`_staging/_rejected-6c2-w2r1/` for side-by-side comparison.

### Observation for the boss — L48's corrective argues with its own seed-role prose

`L48-fix`'s seed-role header says "carry that figure's identity, costume, pose, hands and expression
exactly" of `fig-miniscribe-rep--action-slump--expr-worried` — and that card is precisely the one
verify-b caught carrying the drift (an upright arms-at-sides stand where a slump was ordered). So the
scene prose ("a real SLUMP that the drawing must execute, not an upright stand") is arguing against
the image the same payload tells it to copy exactly. The retry mechanism offers no cleaner lever:
`_retry_step1` accepts `defect: expression` or `rig` only, and a POSE/ACTION drift is neither, so the
card itself cannot be re-minted through the sanctioned retry path. If `L48-fix` comes back upright
again, the fix is a mechanism one (a pose defect class for STEP-1 retries), not a third prose attempt
— the same shape as the L32 quilting lattice finding.

## STAGE 3 — retry-round-1 verification (fresh eyes, `6c2-w2verify-r1.json`)

**8/8 pass, 0 fail.** All eight corrective retries — `L27-fix`, `L32-fix`, `L33-fix`, `L44-fix`,
`L46-fix`, `L47-fix`, `L48-fix`, `L49-fix` — landed clean on the exact defect each was cut for.
`L33-fix` gates `L34` (STAGE 1 below); `L48-fix`'s special-case ruling on the slump-vs-card
question (see the STAGE 2 observation above) came back **NOT TRIGGERED** — the drawing executes a
real slump, so no STEP-1 pose-defect mechanism is owed after all.

**Ink table headline (`R1`):** the warm-ink clause is a proven no-op on all three frames that
carried it (`L44-fix`, `L46-fix`, `L48-fix`) — R-B moved +0.1→+1.1, +1.0→+2.1, +0.03→+1.9 against
a +18 target, each still reading green-neutral. Every STEP-1 figure card feeding these frames
measures properly warm (+19.5 / +41.8 / +39.3); the `L28` place seed measures +3.0. The ink tracks
the **seed**, not the prose and not the cards — three frames is the verifier's own bar for "stop
trying the prose route." The fix belongs at `L28` (re-mint warm, re-seed its five children), not in
a ninth round of ink language on the children. Flagged, not actioned — outside this pass's scope.

**Content lands, chroma/scale/spatial-relation prose doesn't (`R4`):** every object-content
corrective landed (strip the rack, blank the bucket, hang the board, four digits, step outside,
dress him brown, match the room, execute the slump). Every tone/scale/relative-position corrective
did not (`L32`'s "kept small and muted" bucket, the ink language ×3, `L44`'s "gone colder," `L48`'s
"beside him, not on his body," `L46`'s "stage-LEFT"). Actionable for future authoring: express a
correction as an object and its state, never as tone/scale/relation — a relative position that IS
the beat needs a mechanism, not a stronger adjective.

**MINISCRIBE sign still flickers (`R5`):** present in 3/5 `L28` children now (`L33-fix`, `L44-fix`,
`L46-fix` — every overlay that carried the clause got it), absent in `L47-fix` (defensible — camera
moved outside, the sign hangs above the glazed slice shown) and `L48-fix` (not defensible — the
entrance is in frame, the overlay just never carried the clause). Flagged for the next pass, not
fixed here.

## STAGE 4 — stamping + promotion (this worker)

Single writer of `assets/scenes/`, `assets/scenes/manifest.json`, and
`assets/_review/merged.json` for this pass; no git, no image judgment — every verdict below is
copied from STAGE 3 and the round-1 verifiers (`6c2-w2verify-a.json`, `6c2-w2verify-b.json`),
never re-decided.

**21 promoted, sha256-verified match on every copy** (recomputed post-copy against the verifier's
own recorded hash — 21/21 match):
- 13 round-1 clean passes copied straight to their own name: `L26`, `L28`, `L29`, `L30`, `L31`,
  `L35`, `L36`, `L37`, `L40`, `L41`, `L42`, `L43`, `L50`.
- 8 retry-round-1 passes promoted from `<id>-fix.png` to the CANONICAL `assets/scenes/<id>.png` —
  `L27`, `L32`, `L33`, `L44`, `L46`, `L47`, `L48`, `L49` — per the chain-parent resolution law
  (forge reads a delta's parent at `_staging/<id>.png` OR `assets/scenes/<id>.png`; the canonical
  name is what the next chain link actually resolves against, so promoting under `<id>-fix.png`
  would leave every downstream delta blind to the fix). Copied, `_staging/` left intact.

`assets/_review/merged.json` built as 21 clean rulings (`worst: "clean"`), each citing its source
verify file; `stamp_review.py <video_dir>` (no flags) ran once and wrote `21 verified, 0 parked` —
matches exactly, no manual `review_status` edit anywhere.

**Manifest: 25 entries, 21 verified / 4 unreviewed, zero invented states.** The four open shots:
- **`L34`** — chain delta on the now-verified `L33`; its own prior mint (evidenced,
  `6c2-w2verify-a.json#L34`) failed because ITS parent was drifted, not itself. Stale frame
  discarded, never promoted. Left `unreviewed` (not `parked`) because the STAGE 1 re-mint below is
  new, unreviewed pixels — the old ruling doesn't transfer to a different frame.
- **`L38`** — never generated, 503 every attempt since wave 2. `unreviewed`, no ruling possible.
- **`L39`, `L45`** — DID get a full ruling (`6c2-w2verify-b.json`, both FAIL) but the reviewed
  files have since been deleted from `_staging/` pending their own `-fix` retries, which are
  currently blocked on the same outage (see below). Judged `unreviewed` rather than `parked` on
  the reasoning that `parked` describes a *file* the gate refuses to ship, and no file exists right
  now for that status to describe; the historical ruling is preserved in the manifest `notes` for
  context instead of being asserted as the live verdict.

**Sanity check: PASS.** `assets/scenes/` holds exactly 21 PNGs + `manifest.json` (22 items, no
stragglers). Every manifest `sha256` (in `notes`) re-verified against the on-disk file after the
copy — 21/21 match, 0 mismatches.

**Tool friction:** none worth logging. `stamp_review.py` ran with its documented single-arg form
(`<video_dir>`, reading `assets/_review/merged.json`) and no `--figures` path was needed this pass
(no STEP-1 figures were minted fresh here, all reused). The file-rename-on-promote step
(`<id>-fix.png` → canonical `assets/scenes/<id>.png`) has no dedicated forge subcommand — `place`
copies `<name>.png` → `<name>.png` only, no rename — so promotion used a direct verified copy
(sha256 before/after) rather than `forge.py place`, matching the "copy, don't move, staging stays
intact" convention; no parallel promotion path was invented, the destination and naming rule both
came straight from the chain-parent-resolution law already documented above.

## STAGE 5 — L34 re-mint attempt (this worker)

Stale `_staging/L34.png` (the pre-fix failure) deleted — never promoted, fully evidenced in
`6c2-w2verify-a.json`, and its name would otherwise shadow a fresh mint under `6c2_drive.py`'s
already-minted check. Batch spec rebuilt scoped to `L34` alone over the full `shots.json` (so
place/stage state resolves correctly): `forge.py batch --shots L34 --out
scratchpad/6c2-w2retry-l34.spec.json`. **Confirmed by dry-run before spending anything:** the
parent seed now resolves to `channels/.../assets/scenes/L33.png` — the just-promoted, verified
canonical — not the old `_staging/L33.png`. `lineage` also dropped 2→1 on the resolved item,
which is C-11's own confirmation: lineage resets to 1 under a **verified** parent.

Live mint: `py -3 scratchpad/6c2_drive.py scratchpad/6c2-w2retry-l34.spec.json 6c2-w2retry-l34 3`.
**Pass 1: HTTP 503 "experiencing high demand", 0 minted, driver stopped** (its own designed
behaviour on a zero-gain pass). Same outage the background `6c2-w2retry2` driver is already
chasing for `L38`/`L39-fix`/`L45-fix` — confirmed by reading (not touching) its logs:
`6c2-w2retry2-bg.log` shows three full passes, each `+0 minted, 3 still missing`, most recent at
02:52. **Reconciled: 0 additional mints from either driver, $0 spend from either.** `L34` remains
unminted; the fix is proven correct (dry-run) and ready to re-run once the provider recovers —
this worker did not loop retries against a live outage past the driver's own one-pass-then-stop
design, and did not touch the `L38`/`L39`/`L45` items or logs per scope.

## Spend — running total unchanged this pass

**$2.145 / $5.00.** No billable mint happened (L34's one attempt was a 503 — no image, no charge,
per provider billing on transport failures). Prior total from STAGE 2 above stands unmoved.
