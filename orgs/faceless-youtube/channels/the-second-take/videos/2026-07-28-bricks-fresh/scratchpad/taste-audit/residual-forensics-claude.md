# Residual forensics — image-vs-doctrine mechanism analysis (R1–R4)

Worker: Claude (image/mechanism angle). Sibling worker owns pure text/commit archaeology.
All claims below are grounded in a viewed image, a measured number (script + method stated), or a cited
file:line. Anything else is labelled HYPOTHESIS.

Scope note: the three audit files named in the brief exist as two here
(`composition-crowd.md`, `rig-script-lettering.md`); `metrics-summary.md` is absent from this clone, so
colour numbers below are re-derived independently rather than quoted.

## 0. Beat mapping (the archive is NOT index-aligned to the new set)

The pre-reset set has 214 shots, the new set 246, and the VO was re-split. Matching by `vo_text`:

| beat | ERA (archive) | NEW |
|---|---|---|
| "big hair, Pac-Man" | L02 | L02 |
| "They were all the craze" | **L07** | L06 |
| "Anybody with money was buying one" | **L08** | L07 |
| "flying off the shelves" | L09 | L08 |
| "picks and shovels in the gold rush" | **L20** (one shot) | L20 + L21 |
| "red clay bricks into little boxes labelled hard drive" | **L23** | L24 + L25 |

Every archive citation below uses ERA numbering. This mapping matters: the earlier audit's
"archive L06-07 = crowd through window" is off by one — archive L06 is the figureless shop interior,
and the crowd beats are archive L07/L08.

Second global observation, measured: **new scenes are 1376x768; every archive scene is 2752x1536**
(exactly 2x). The liked set went through an upscale stage the new set did not. This does not cause any
of R1–R4 (all four are composition/colour, not resolution) but it is a real pipeline difference and is
flagged here so it is not rediscovered as a mystery.

---

## 1. R1 — wall-of-heads crowds

### What the liked frame does that the new one doesn't

Viewed: `_archive-pre-reset/scenes/L07.png` + `L08.png` vs `scenes/L06.png` + `scenes/L07.png` + `scenes/L02.png`.

ERA L07/L08 put the crowd **outside the shop window, behind glass, in the upper-middle band of a frame
whose composition was already committed to the room**. The crowd is a small, partly-occluded,
daylight-washed background layer; heads read ~5% of frame height. The bottom ~35% of the frame is
terrazzo floor doing nothing but breathing. The foreground anchor (counter, "1983" card, floppy stack)
is untouched between the two shots. ERA L08's answer to "anybody with money was buying one" is **one
named customer with a handbag** at the counter — the crowd stays outside the glass.

NEW L06/L07 put the crowd at 55–65% frame height, co-planar, pressed to camera, with open mouths and
reaching arms. NEW L07's answer to the same beat is a **wall of reaching fists holding banknotes**.

### Proportion — the measurement, and the trap

Method: background-difference mask → per-figure bounding box for total height; flat head-tone fill
extent along the figure's central 40% for face height; ratio = total ÷ face-only (the poyais
"face-only, never hair-inflated" convention).

| exemplar | measured TOTAL/FACE |
|---|---|
| `refs/base/base.png` (full rig) | **3.13** |
| `refs/base/crowd-exemplar.png` (channel, poyais-era) | **2.71** and **2.65** (the two bald end figures) |
| `videos/2026-07-28-bricks-fresh/assets/library/crowd-exemplar.png` (THIS video's own) | **4.49, 4.34, 4.34, 4.50** |

Method validation: base.png returns 3.13 against the known 3.14 standard, and the channel crowd
exemplar returns 2.71/2.65 against the known ~2.7 standard — so the method is sound. (In both
exemplars the middle figures return junk values, 1.9–2.2 and 87, because white shawls / cream bonnets /
a grey suit match the head-tone fill; the bald figures are the clean reads. This is the same
"hair-inflated head box" trap the poyais ruling warns about, one layer over.)

**This video's own minted crowd exemplar sits at ~4.4 face-heights — lankier than the full base rig
(3.13) and nowhere near the 2.7 standard it is supposed to embody.**

### Is the ~2.7 standard reachable from these prompts?

**No. It is unreachable doc prose.** Traced through the dispatch path:

- `style-bible.md` §2d blockquote (lines 78–91) is the text forge injects. It says the crowd holds
  *"the **EXACT same squat head-to-body proportion as the crowd exemplar seed**"* — a **pointer to an
  image**, with no number.
- The number lives one line **outside** the blockquote, at `style-bible.md:93`: *"proportion is
  IDENTICAL to the crowd exemplar's (squat, ~2.7 head-heights face-only; poyais-era standard, ruling
  2026-08-17)"*.
- `forge.py:323` reads `self.desc_crowdrig = blockquote_after(md, "CROWD-RIG clause")`, and
  `blockquote_after` (verified in source) captures **only** consecutive `>` lines, stopping at the
  first blank line after them. Line 93 is prose and is therefore **never injected**.
- `forge.py:1460` sets the seed's role prose to *"the crowd exemplar — use its anonymous crowd
  proportion, face tier and the bounded 2-3 flat head-tone set it repeats"* — again pointing at the
  image.
- `forge.py:2119-2120` resolves the exemplar to **this video's** `assets/library/crowd-exemplar.png`
  first, channel fallback second (the P4 per-video minting change, commented at `forge.py:2110`).

So the operative standard is *whatever this video's exemplar happens to be*, and that is 4.4. The
engine obeyed doctrine faithfully and reproduced a wrong standard. `image-generation/SKILL.md:142`
states this explicitly: the per-video exemplar "is what pins crowd proportion".

### Staging — where the authoring actually broke

`visual-grammar.md:185-187` already contains exactly the right rule, and it is not new:

> Crowd belongs in a positive rear zone in the PRIMARY scene clause — far side of the real
> table/shelving, behind a divider, through a doorway — never a co-planar gathering renamed
> "background-scale" later.

Checked against the authored prompts:

- **NEW L02** — *"midground the skaters' shoulders and grinning faces turned up… background their
  teased blonde and copper hairdos stacked so high they fill the entire upper third of the frame like a
  hedge"*. Crowd authored into the **midground**, and the frame-filling is explicitly requested.
  **Violates the rear-zone clause. AUTHORED.**
- **NEW L07** — *"midground fistfuls of banknotes thrust across the counter from customers crowded
  three deep against it"*. Crowd authored into the **midground**, against the counter.
  **Violates the rear-zone clause. AUTHORED.**
- **NEW L06** — *"background beyond the glass a packed crowd pressing shoulder to shoulder with palms
  flat on the pane"*. This **obeys** the clause: positive rear zone, behind glass. The render still
  produced a 65%-height co-planar wall. **RENDER drift**, aggravated by the 4.4 exemplar and by the
  prompt stating no figure scale.

### Why the lint didn't catch the two authored ones

`lint_shots.py:1312-1323` implements the rear-zone rule — but the gate at line 1319 is
`if _BACKGROUND_CROWD.search(prompt) and not _REAR_ZONE.search(prompt)`, and `_BACKGROUND_CROWD`
(lines 1287-1290) only matches prose that *already calls the crowd* "background-scale" / "background
crowd" / "crowd … farther back / clearly smaller / small and distant".

**The check therefore fires only on crowds the author already described as distant — the ones least
likely to be wrong — and is structurally blind to a crowd authored into the midground or foreground,
which is the entire observed failure mode.** L02 and L07 say "midground", match nothing in
`_BACKGROUND_CROWD`, and sail through. This is an in-place logic inversion, not a missing rule.

---

## 2. R2 — lost wide-shot scale contrast

Viewed: `_archive-pre-reset/scenes/L20.png` vs `scenes/L20.png`.

The liked frame is **not** simply "wider". It contains a **scale ladder inside one frame**: a large
foreground tool-seller (head ~22% of frame height) on the right, then the creek with ~20 prospectors
receding from ~8% down to ~3% frame height, then canvas tents stepping back over two ridgelines, then
sky. Foreground figure to furthest figure is roughly a 7:1 height ratio in a single image.

NEW L20 has **no ladder**: the stall-keeper and the queueing prospectors are all at roughly the same
figure height at essentially one depth, against a flat gradient sky and a bare gradient hillside with
zero background figures, zero tents, no recession.

### Mechanism, in the authored text

ERA L20's prompt (archive `shots.pre-reset.json`) ends:

> Wide three-quarter framing holds the stall and creek activity as **one full scene**; depth reads tool
> rack foreground, merchants and cash box mid-ground, **prospectors and hillside background**.

— and earlier: *"Across the creek, prospectors work their pans among canvas tents, wheelbarrows and
muddy spoil heaps."* The **background plane is given its own populated activity**: a second locus of
action in depth.

NEW L20's prompt: *"foreground a water butt cropped at the lower-left, midground the counter with
drive-maker and the reaching prospectors, background a canvas awning overhead, barrels and coils of
rope stacked behind him, a bare brown hillside beyond."*

Same three plane labels — but **every human is assigned to the midground, and the background plane
receives only inert scenery**. The ladder cannot form because nothing populated was authored into depth.

### Where that convention came from

Two changes, both dated to the 2026-08-18 reset, push exactly this shape:

1. **VPW SKILL rule 4 was rewritten.** Era text (deleted) required the prompt to state
   *"…**framing + scale**, the committed scene palette, light/atmosphere, and **depth
   (fore/mid/background, filled edge-to-edge)**"*. Current text drops "framing + scale" as a
   standalone required scene fact and replaces the depth requirement with a
   *"payload-driven THREE-PLANE read — what occupies the foreground, the mid, and the background of
   THIS beat, at what scale, and from where the camera sees them, **the payload owning the plane that
   carries it**"*.
   The new **"payload owning the plane that carries it"** clause is the active ingredient: when the
   payload is people (a crowd, a transaction), the people take the plane — and VPW resolves that to the
   midground, where they read biggest. Scale survives only as a subordinate phrase inside that clause.

2. **The `global_prompt_suffix` gained an environment recipe that did not exist in the liked era.**
   Verified by `git show 30d2b7e8:…/shots.json` — the ERA suffix is purely style/line:
   *"clean flat cel-shaded cartoon style, an even medium-thick dark warm brown-black #241a12 outline on
   everything, flat colours with gentle soft cel shading, rounded friendly shapes, no realistic detail,
   hand-lettered marker capitals for any in-world text"* — **no environment clause, no palette clause,
   no accent clause at all**.
   The current suffix adds: *"built-but-flat environment (**flat gradient sky/ground + minimal geometry
   + one foreground depth prop**)"*. That is a near-literal description of what NEW L20 rendered — flat
   gradient sky, flat gradient ground, one tent and two barrels, one cropped foreground prop. It sits
   on **every** gen in the video.

Note on a clause I deliberately do **not** blame: `style-bible.md` §5 "Environments … composed
edge-to-edge with a fore/mid/background depth read … **Rich, not sparse:** name the real furniture of
the place; no dead air" is **byte-identical in the era baseline** (`git show
30d2b7e8:…/style-bible.md`, lines 135-138). It was live when the liked frames were made, so it is not
the regression and must not be "fixed".

Combined reading (HYPOTHESIS, but consistent with every frame examined): §5 still demands an
edge-to-edge, richly furnished frame, while the new suffix strips the environment to flat gradients and
minimal geometry. Something must still fill the frame — and the only remaining material is figures,
enlarged and brought forward. That single tension produces both R1's wall-of-heads and R2's collapsed
ladder.

---

## 3. R3 / R4 — where the saturation sits, and what carried the accent

Method: all images downsampled to 344x192, HSV computed directly. "Liked" = archive L07, L08, L09, L11,
L19, L20, L21, L23, L24, L25 (the beats named as liked). "New" = L01–L25.

| measure | LIKED | NEW |
|---|---|---|
| mean S | 0.32 | 0.40 |
| median S | 0.305 | 0.402 |
| area at S>0.45 | 0.288 | 0.434 |
| **warm-light share** — of the saturated pixels, the fraction that are warm-hue AND bright (V>0.80), i.e. saturation carried by *light* rather than *fill* | **0.276** | **0.091** |
| cool-hue saturated area (hue 150–300°, S>0.45) | **0.0001** | **0.0511** |
| **loud hue bins** — 30° hue bins holding >1% of the frame at S>0.45 | **1.40** | **2.08** |
| tight accent-red area (RGB distance <60 from `#d7402b`) | 0.0012 | 0.0032 |

### R3 — the mechanism, confirmed

The residual note's hypothesis is correct and now measured: **warmth moved out of light and into fills.**
The new set has *more* saturated pixels overall, but only 9% of them are bright warm light versus 28%
in the liked set — a 3x collapse. Viewed confirmation: archive L09 (the gold-standard reference frame)
carries its entire saturation budget in a **shaft of sunlight across warm wood**, with everything else
desaturated cream and roughly 45% of the frame given to empty shelf and wall.

The cool-fill number is the sharpest single result: **the liked set has essentially zero
high-saturation non-warm pixels (0.0001) — the new set has 0.0511.** Driven by L12 (0.70), L11 (0.29),
L09 (0.17), L04 (0.083).

Text-layer cause, counted over the whole files:

| | ERA (214 shots) | NEW (246 shots) |
|---|---|---|
| shots naming a "palette" | 114 (53%) | **246 (100%)** |
| shots naming a cool colour | 28 (13%) | **142 (58%)** |
| shots naming **"teal"** | **2 (1%)** | **128 (52%)** |

The suffix's new *"locked 2-3 colour warm-biased scene palette"* clause turned "palette" into a
mandatory authored field on every shot, and VPW discharges it as a named colour **triple**
("Teal-pink-cream", "Cream-teal-amber", "Cream-brown-teal", "Umber-cream-teal" …). A named colour triple
is an instruction about **fills**. "Teal" satisfies "2-3 colour" while quietly breaking "warm-biased",
and it went from 1% to 52% of shots.

### R4 — the accent finding is NOT what it looks like

Measured tightly against the locked `#d7402b`, the new set has **more** accent red than the liked set
(0.0032 vs 0.0012; 9 of 25 new shots carry a real red mass versus 2 of 10 liked). **The locked red did
not disappear.** I tested and rejected a global saturation-contrast explanation too: p98-minus-median
"pop" is actually *higher* in the new set (0.304 vs 0.206).

What did change is **how many colours are shouting**. The liked frames average **1.40 loud hue bins** —
they are effectively monochrome-warm at high saturation, so any single saturated object is automatically
*the* accent. The new frames average **2.08**, routinely 3–4. An accent cannot read as an accent when
two or three other hues are equally loud.

And the liked accent exemplar shows the effect was **explicitly authored, per beat**. ERA L23 (the red
brick — Daniel's cited accent exemplar) reads verbatim:

> A deserted packing station, **empty of people**. … one solid clay brick in **dense red #d7402b** …
> Cold grey-green industrial light on the bench, **the brick the only warm mass in the frame**. Tight
> straight-on medium close at bench height with the open carton filling the middle third and **bench air
> either side**. 

Three authored devices: a **figureless object-hero** staging, an explicit **"the only warm mass in the
frame"** clause, and a deliberately **cold ground** for the warm accent to sit against — plus explicit
negative space ("bench air either side"). None of these is a rule; all are per-beat authoring choices,
matching Daniel's decoded taste exactly ("accent-pop is a per-beat authoring option on object-hero
shots, never a rule").

Today's counterpart shots (NEW L24/L25) put `brick-foreman` in frame on an "umber-brown-cream palette"
with no temperature contrast and no "only warm mass" clause. The **idiom** was lost, not the pigment.

Working conclusion: **R3 and R4 are one mechanism, not two.** The ground stopped being a
low-saturation warm neutral. That simultaneously reads as over-saturation (R3) and destroys accent-pop
(R4). One fix addresses both.

---

## 4. The set-hold regression (mechanism behind R1's liked exemplars)

ERA L06/L07/L08 all carry `stage: 'pc-store-1983'`, `stage_role: 'delta'` — three consecutive beats on
**one held set**, authored as deltas:

> ERA L07: *"The same shop interior, **same locked framing**… **Only this changes:** the street outside
> is now packed with a dense press of onlookers crowding the window from the pavement…"*

The crowd could only land outside the window because the framing was already committed to the room by a
figureless establishing frame. The liked crowd staging is a **consequence of set-hold**, not of any
"small distant crowd" wording.

NEW L04, L05, L06, L07, L08 all carry **`stage: None`, `stage_role: None`** — every shop beat is a
fresh standalone staging that re-chooses its vantage around its own payload ("Seen from just behind the
plinth looking out…", "Seen from slightly above the counter…"). With no inherited framing, the crowd
defines the frame.

This is a prompt-layer regression, in Daniel's prime-suspect layer. It is not a lost clause — the chain
law and `stage`/`stage_role` still exist and NEW L20/L21 do use them — so it is an authoring miss on
these specific beats, correctable by re-authoring rather than by any doctrine edit.

## 5. Idiom check — did era prompts ask for tiny figures?

Counted over both full files:

| idiom family | ERA | NEW |
|---|---|---|
| small-figure ("tiny", "small in frame", "dwarfed", "specks") | 11 (5%) | **0 (0%)** |
| distance ("distant", "receding", "vanishing point", "horizon") | 20 (9%) | 15 (6%) |
| vastness ("vast", "sweeping", "expanse", "stretches away") | 6 (3%) | 11 (4%) |
| open space ("empty", "bare floor", "room around") | 45 (21%) | 50 (20%) |

Honest result, and it cuts against the obvious theory: **small-figure language went from rare (5%) to
absent (0%), but the liked beats themselves barely used it either.** ERA L07, L08, L20 and L23 contain
no small-figure or vastness idiom at all. The liked cinematic scale came from **set-hold + an authored
populated background plane + an absent environment-flattening suffix**, not from "tiny figures" wording.

Consequence for the fix list: the scale-ladder behaviour is a genuine **EMERGENT-LOSS** — it was never
codified as text anywhere, so it is the one place new wording is justified.

---

## 6. Attribution table

| class | attribution | evidence |
|---|---|---|
| **R1a** crowd staged co-planar / frame-filling (L02, L07) | **AUTHORED** | Prompts stage the crowd in the "midground" pressed to counter/camera, and L02 explicitly asks hair to "fill the entire upper third". Directly violates the pre-existing `visual-grammar.md:185-187` rear-zone clause, which is era text and still correct. |
| **R1b** same failure on a compliant prompt (L06) | **RENDER** | Prompt says "background beyond the glass a packed crowd … palms flat on the pane" — obeys the rear-zone clause; render still produced a 65%-height co-planar wall. Aggravated by R1c and by the prompt stating no figure scale. |
| **R1c** adult, not squat, crowd proportion (all three) | **DOCTRINE (unreachable standard)** | Injected §2d blockquote points at "the crowd exemplar seed" with no number; the "~2.7" sits at `style-bible.md:93`, **outside** the blockquote `forge.py:323`/`blockquote_after` captures, so it never reaches a prompt. `forge.py:2119` resolves to this video's own exemplar, **measured 4.34–4.50** vs channel 2.71/2.65 and base 3.13. Faithful execution of a wrong standard. |
| **R1d** rear-zone rule not enforced | **RENDER/logic (lint gate inverted)** | `lint_shots.py:1319` fires only when `_BACKGROUND_CROWD` (lines 1287-1290) matches prose already calling the crowd distant — structurally blind to a crowd authored into the midground. |
| **R2a** no scale ladder; all figures on one plane | **AUTHORED**, caused by **DOCTRINE** | ERA L20 authored "prospectors and hillside background" + "Across the creek, prospectors work their pans…" — a populated background plane. NEW L20 assigns all humans to midground, background gets awning/barrels/bare hillside. Traced to VPW SKILL rule 4's new **"the payload owning the plane that carries it"**, which replaced the era's standalone **"framing + scale … depth (fore/mid/background)"**. |
| **R2b** environment stripped to flat gradients | **DOCTRINE** | `global_prompt_suffix` gained *"built-but-flat environment (flat gradient sky/ground + minimal geometry + one foreground depth prop)"*; the ERA suffix (`git show 30d2b7e8`) had **no environment clause at all**. Describes NEW L20's render almost literally. Applies to every gen. |
| **R3** saturation in fills, not light; cool fills appear | **DOCTRINE → AUTHORED** | warm-light share of saturated pixels 0.276 → 0.091; cool saturated area 0.0001 → 0.0511. Suffix's new *"locked 2-3 colour warm-biased scene palette"* made "palette" mandatory on 100% of shots (era 53%); VPW discharges it as colour triples, and **"teal" went 1% → 52% of shots**. ERA suffix had no palette clause. |
| **R4** accent no longer pops | **EMERGENT-LOSS (idiom), not absence** | Locked red is *more* present now (0.0032 vs 0.0012 tight-matched area); global contrast is also higher, so both "it vanished" and "contrast fell" are **rejected**. Real difference: loud hue bins 1.40 → 2.08 — the liked ground was near-monochrome warm. ERA L23 authored the pop per-beat and explicitly: figureless object-hero, "dense red #d7402b", cold grey-green ground, **"the brick the only warm mass in the frame"**. The idiom was lost, not the pigment. |
| **(context)** shop beats lost their held set | **AUTHORED** | ERA L06/L07/L08 = `stage: pc-store-1983`, `stage_role: delta` ("same locked framing… Only this changes"). NEW L04–L08 = `stage: None`. Not a lost clause; the chain law still exists and NEW L20/L21 use it. |

---

## 7. Candidate fix list

Ordered per Daniel's steering: **RESTORE first** (era text back, citing both the era text and what
replaced it), **new wording last and only for the emergent loss**. All edits are in place; net length
across the list is approximately zero (four clause-for-clause swaps, two deletions, one gate condition,
one image re-mint, one new sentence).

### RESTORE items

**F1 — restore "framing + scale" and drop payload-plane-ownership.**
File `.claude/skills/visual-prompt-writer/SKILL.md`, rule 4 (scene facts).
Current text requires *"a payload-driven THREE-PLANE read — … the payload owning the plane that carries
it"*. Restore the era requirement it replaced: *"framing + scale, the committed scene palette,
light/atmosphere, and depth (fore/mid/background)"*, keeping scale as a **standalone** scene fact and
deleting the plane-ownership clause that pulls people to the midground.
Deliberately do **not** restore the era's trailing *"filled edge-to-edge"* — it works against the
generous negative space Daniel wants; this is the one place the revert is partial, and it is a deletion,
not an addition.
Fixes: R2a, contributes R1a. Blast radius: the scene-fact sentence of every future prompt. Net length: −.

**F2 — delete the environment recipe from the channel suffix.**
File `channels/the-second-take/videos/…/shots.json` `global_prompt_suffix` (and the channel source it is
generated from). Remove *"built-but-flat environment (flat gradient sky/ground + minimal geometry + one
foreground depth prop)"*, restoring the era suffix's silence on environment — the liked frames were made
with a suffix carrying no environment clause at all.
`style-bible.md` §5 already governs environments and is era-identical, so nothing is left ungoverned.
Fixes: R2b, contributes R1. Blast radius: **every gen** — and it requires updating the two tests that
assert the suffix verbatim (`visual-prompt-writer/scripts/test_doctrine_reset_guards.py:29-30`,
`image-generation/scripts/test_forge_style_tile.py:58-59`). Net length: −.

**F3 — delete the palette clause from the channel suffix.**
Same file/field. Remove *"locked 2-3 colour warm-biased scene palette"*. The era suffix had no palette
clause and the era file named a palette in 53% of shots rather than 100%; the mandatory 2-3-colour
framing is what turned palette into a per-shot named triple and let "teal" reach 52% of shots.
`style-bible.md` §5's "committed warm scene palette" (era text, unchanged) remains the governing rule.
Fixes: R3, contributes R4. Blast radius: every gen; same two tests as F2. Net length: −.

**F4 — delete the accent-restriction clause from the channel suffix.**
Same file/field. Remove *"plus the single red accent #d7402b used only semantically (alarm / prohibition
/ ownership / the last punch element)"*. The era suffix carried no accent clause, and era L23 authored a
non-semantic decorative red brick as the frame's hero. Removing the restriction re-legalises accent-pop
as a **per-beat authoring option**, which is exactly Daniel's stated position; `style-bible.md` §4 still
pins the hex, so the locked red stays locked.
Fixes: R4. Blast radius: every gen; same two tests. Net length: −.

**F5 — re-mint this video's crowd exemplar to the channel standard.**
File `channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/library/crowd-exemplar.png`.
Not a text change — an exemplar change, which the brief explicitly allows. Re-mint (or, as an immediate
stopgap, delete so `forge.py:2119`'s fallback selects the channel exemplar) so the seed that **defines**
crowd proportion measures ~2.7 rather than the current 4.34–4.50.
This is the highest-leverage single fix for R1 and needs no doctrine edit at all, because the doctrine
already says "match the exemplar" — the exemplar was simply wrong.
Fixes: R1c. Blast radius: every crowd-bearing gen in this video (the frames would need regen to benefit).
Net length: 0.

**F6 — fix the inverted lint gate so the existing rear-zone clause bites.**
File `.claude/skills/visual-prompt-writer/scripts/lint_shots.py`, `spatial_tier_check`, line 1319.
Change the condition from *"prose already calls it a background crowd AND no rear zone"* to *"`figures.crowd`
is true AND no rear zone"* — i.e. drop the `_BACKGROUND_CROWD.search(prompt)` term, which today exempts
precisely the midground/foreground crowds that fail. This adds **no new rule**; it makes the era clause
at `visual-grammar.md:185-187` enforceable, and would have hard-failed NEW L02 and L07 at authoring time.
Fixes: R1a, R1d. Blast radius: any future shot declaring `figures.crowd: true` must name rear geometry;
expect it to fail some existing shots on first run, which is the point. Net length: −.

### NEW-WORDING item (emergent loss only)

**F7 — one general clause for the populated background plane.**
File `channels/the-second-take/visual-kit/visual-grammar.md` §3 (Composition), appended to the existing
"Negative space follows the payload" bullet — **one sentence, no numbers, no quota**:
approximately *"When a beat's argument is scale, the background plane carries its own activity — the
frame reads as one deep scene with people at more than one distance, not a single populated plane against
scenery."*
Justified as new wording because §5 measured this as genuinely uncodified: the liked frames' scale ladder
was never expressed in any era clause, and era prompts for those beats used no small-figure idiom (0–5%).
This is the single emergent loss; everything else above is a revert.
Fixes: R2a (the half F1 does not reach), contributes R1. Blast radius: composition guidance for all
future shots. Net length: +1 sentence.

**Explicitly NOT proposed** (so they are not re-litigated): touching `style-bible.md` §5
("Rich, not sparse / no dead air / edge-to-edge") — verified byte-identical in the era baseline and
therefore not the regression; any numeric figure-height quota; any per-class crowd rule; and anything
touching warmth-tail, vantage, chains or figure-bias, all of which the reset fixed and which measure clean.
