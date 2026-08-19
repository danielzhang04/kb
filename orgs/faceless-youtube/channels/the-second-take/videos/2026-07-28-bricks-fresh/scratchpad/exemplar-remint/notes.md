# Crowd exemplar re-mint (V8) — measurement notes

Target: `assets/library/crowd-exemplar.png` re-minted to channel crowd-proportion
standard (squat ~2.7 head-heights, measured FACE-ONLY, hair/headwear excluded;
never the base rig's 3.14). Old file was already archived to
`scratchpad/exemplar-remint/old/crowd-exemplar.png` before any regen.

## Measurement method

Middle figure (3rd of 5, dark suit, afro hair — most consistently measurable
face across attempts). Robust pixel measurement per image:
- Total figure height = top-of-hair to bottom-of-feet, background-distance
  threshold with a >=5-px-per-row floor (drops single stray edge/compression
  pixels that otherwise blow the bbox out to the canvas edge).
- Face-only head height = vertical extent of visible flesh-tone pixels in a
  narrow central column band, from the topmost point where skin is visible
  between the hairline (NOT the outer hair silhouette) down to the chin,
  before the white shirt collar. This matches "face-only, hair excluded" per
  doctrine and reproduces the reported baseline range, confirming the method.
- ratio = total_height / face_only_head_height.

## Attempts

**Baseline (old file, `assets/library/crowd-exemplar.png` as it stood, now
archived to `old/crowd-exemplar.png`):**
total_h=526px, face_h=123px, **ratio = 4.28** (matches the reported 4.34–4.50
range — measurement method validated against the known-bad baseline).

**Attempt 1 (mint):** `forge.py gen --mode environment --character base
--aspect 4:3 --image-size 1K`, seeded on the old exemplar, delta asked for
squat ~2.7 face-only proportion, explicit hair-exclusion + explicit
"do not use the base rig's 3.14" language, preserved dress/head-tone/hair
instructions.
Result: near pixel-identical composition to the seed (same 5 figure-column
boundaries to the pixel). total_h=527, face_h=129 (width-based check) /
visual inspection confirmed unchanged proportion. Engine essentially
re-copied the seed's geometry despite the proportion delta.

**Attempt 2 (the one sanctioned retry):** same command, strengthened delta —
explicit "copy NOTHING of the seed's body proportion", chibi/toddler framing,
explicit unit-based build recipe (head-diameter unit U, total figure = 2.7 U,
torso+legs = ~1.7 U, shoulders almost under the chin, "the BODY shrinks to
match the head, not the other way round").
Result: total_h=526, face_h=121, **ratio = 4.35** — statistically unchanged
from baseline (within noise of the measurement method), confirmed visually:
attempt-2 crop is essentially the same drawing as attempt 1 and the seed.

## Verdict

Both attempts FAILED to correct the proportion. gemini-3-pro-image, seeded
strongly on the flawed exemplar via `forge.py`'s environment/style mode, does
not diverge from the seed's body geometry even under an explicit numeric
correction + an explicit "ignore the seed's proportion" instruction. The
retry budget (mint + one sanctioned retry) is exhausted per brief.

**Live file left UNCHANGED** — `assets/library/crowd-exemplar.png` still
holds the original (pre-existing, un-fixed, ratio ~4.28) file. Neither staged
attempt was placed over it, since placing a still-noncompliant asset would
misreport the fix as done. Both staged attempts remain in
`visual-kit/_staging/crowd-exemplar.png` (attempt 2 is the current contents,
attempt 1 was overwritten by attempt 2 via `--force` and not separately kept).

## Likely mechanism / next-step recommendation (not executed — outside this
brief's one-retry budget)

A same-subject image seed appears to anchor gemini-3-pro-image's body
geometry far more strongly than the text delta can override, even with
forceful, numeric, negative-instruction prompting. A follow-up attempt should
probably either (a) drop the image seed for geometry entirely and seed ONLY
a correctly-proportioned reference (e.g. a channel figure already close to
2.7, if one exists) while carrying dress/tone/hair in prose only, or (b) mint
fresh at `--mode new_character`-style base-proportion first, then re-dress,
rather than editing the flawed exemplar in place.

## Round 2 — coordinator correction: seed on the CHANNEL exemplar, not the old video file

Root cause identified by the coordinator: rounds above seeded on the OLD
(defective) video exemplar, so the engine reproduced ITS proportion — the
seed image carries the proportion, the text delta doesn't override it.
Corrected instruction: locate and measure the channel-level fallback exemplar
first (`visual-kit/refs/base/crowd-exemplar.png`, the file `forge.py`'s
crowd-exemplar resolution falls back to when a video hasn't minted its own —
confirmed via the `crowd_ex = on_disk(lib/crowd-exemplar.png) or
reg_assets['crowd-exemplar'].file` resolution order in `forge.py` around line
2119, and the P4 comment block above it), then mint seeded on THAT file
instead, with a fallback to copying it directly if minting still fails.

**Channel exemplar baseline measurement** (same face-only method, applied to
its two BALD figures — bald means no hair/hat to exclude, so the method is
unbiased for them, unlike a hatted figure):
- Figure 1 (leftmost, bald, vest): total_h=492, face_h=179, **ratio = 2.75**
- Figure 5 (rightmost, bald, jacket): total_h=492, face_h=178, **ratio = 2.76**
Both inside the 2.6–2.9 band — confirms the coordinator's claim; my earlier
"eyeballed" impression that this file looked similarly lanky was wrong, the
pixel measurement says otherwise. (Its own top-hat figure separately measured
an inflated 5.12 under this method — expected, since a tall hat adds pure
height to the numerator without adding to the visible-face denominator; the
bald figures are the fair read.)

**Attempt 1 (dual-seed mint):** seeded BOTH the channel exemplar (labelled in
the delta as PROPORTION AUTHORITY ONLY) and the old video exemplar (labelled
DRESS/PALETTE AUTHORITY ONLY, explicitly told its proportion is wrong and
must not be copied). `--mode environment --aspect 4:3 --image-size 1K
--force`, two `--seed` paths.
Result: clearly, visibly squatter — big heads, short bodies, obvious
improvement over every prior attempt. But the engine drew a staggered
5-figure PYRAMID instead of a row, used 5 DISTINCT hair/headwear silhouettes
(one each: bowler, bun/no-hat, bonnet, top hat, boater — busts the 2–3 cap),
and flattened skin tone to near-uniform pale tan (lost the old file's 3-tone
diversity incl. a dark-brown figure).
Measured (front-center top-hat figure, hat-top-to-feet / visible-face-below-
brim-to-chin, same method as the channel file's own hat-figure so the two are
comparable): total_h=529, face_h=105, ratio=5.04 — within noise of the
channel exemplar's OWN top-hat figure (5.12, known-good design measuring
inflated under this method purely from the hat). Front-right boater figure:
total_h=496, face_h=106, ratio=4.68 — same ballpark. No hatless/hairless
figure in this composition has an unoccluded full body (back-row figures are
leg-occluded by the pyramid), so a clean apples-to-apples full-body ratio like
the channel baseline's bald figures isn't available here; the hat-figure
cross-comparison is the best evidence and it says proportion looks fixed, but
the SILHOUETTE-COUNT and TONE-DIVERSITY misses are real doctrine violations
on their own axis, independent of proportion. Verdict: OFF (fails the
"2-3 silhouettes" / tone criteria), triggering the one sanctioned retry.

**Attempt 2 (the one sanctioned retry):** same two seeds, delta tightened to
also demand: single flat row layout (not pyramid), an explicit cap of "2 or
at most 3" hair/headwear silhouettes repeated across the group, and explicit
preservation of the second image's skin-tone diversity (named "pale, medium
tan, and a distinctly darker brown").
Result: reverted almost completely to the OLD video exemplar — identical
figure-column x-boundaries to the pixel, same 5 characters, same costumes,
same tones. Measured (middle afro-hair figure, same validated method as the
original baseline): total_h=527, face_h=122, **ratio = 4.32** — statistically
back to the original 4.28 defect, proportion fix lost. Asking for the SECOND
image's exact layout/silhouette-count/tones alongside its dress apparently
gave the engine license to just re-copy the second image wholesale, losing
the first image's proportion authority that attempt 1 had actually achieved.

Both authorized shots for this round (1 attempt + 1 sanctioned retry) are
now spent; retry made proportion worse, not better.

## Final decision: FALLBACK — copy the channel exemplar directly

Per the coordinator's explicit fallback instruction: copied
`visual-kit/refs/base/crowd-exemplar.png` byte-for-byte onto
`videos/2026-07-28-bricks-fresh/assets/library/crowd-exemplar.png` (verified
via md5 match). This is the doctrine-compliant path per style-bible §2d: a
crowd exemplar's PERIOD DRESS never propagates to scenes (each scene dresses
its own crowd for its own era/setting) — only proportion, face tier, and the
head-tone set seed through (`forge.py`'s `role == "crowd"` seed-role prose:
"use its anonymous crowd proportion, face tier and the bounded 2-3 flat
head-tone set it repeats; take nothing of its dress, period or setting").

**Ratio of the file now live at `assets/library/crowd-exemplar.png`: 2.75–2.76**
(the channel exemplar's own measured proportion, confirmed above) — inside
the 2.6–2.9 target band.

**Caveat worth a follow-up ruling:** the channel exemplar's own head-tone set
is effectively uniform pale cream across all 5 figures (no dark-brown/tan
diversity), unlike the old video file's 3-tone set. Since `forge.py`'s crowd
seed role grants "the bounded 2-3 flat head-tone set it repeats" verbatim
from whatever file sits at this path, every crowd-bearing scene in this video
will now draw from a single pale tone until/unless a future exemplar mint
also nails proportion AND carries a diverse tone set. Silhouette count is
fine (bald/bare, bonnet, top-hat = 3 repeating shapes, within cap). Flagging
this rather than deviating from the coordinator's explicit fallback
instruction.

## Spend

4 gemini-3-pro-image `1K` generations issued via `forge.py gen` total across
both rounds (round 1: mint + 1 retry seeded on the old file, both failed;
round 2: mint + 1 retry seeded on the channel file + old file, mint showed
real improvement, retry regressed). `forge.py` emits no per-call price; well
within the $1.00 cap on token-generation-cost grounds (4 single-image 1K
calls total).
