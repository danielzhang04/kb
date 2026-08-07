# 6c2 wave-2 retry, round 2 — fresh-eyes verification log

Verification only. Nothing here is a verdict write; `stamp_review.py` remains the sole writer, and
nothing was promoted, moved or minted. Ink measured with `scratchpad/p6b_ink.py` (darkest-3%
circular-mean hue + mean R−B; warm target ~19° / +18; R−B ≤ 0 is a hard cool-inversion fail; the
p6b batch ceiling for R−B was +31.3). Prose authority = `shots.json` `still_prompt` with the
`6c2-w2retry.overlay.json` span substituted for L39 and L45; L34 is judged against
`6c2-w2retry-l34.spec.json` and its promoted parent `assets/scenes/L33.png`.

Four frames, minted 03:17–03:21. Two pass, two fail.

---

## L34 — FAIL. The delta is correct and the face is not.

Start with what went right, because it is most of the frame. The authored change landed and landed
well: the roller door is rolled up on its drum and a queue of loaded, shrink-strapped pallets runs
nose to tail out through it into the yard against flat blue sky, drawn in house ink and the scene's
own palette. Behind that, the place seed is not merely held, it is untouched — measured against the
parent, the tote rack stage-left moved 0.01% of its pixels, the cropped bench end lower-right 0.00%,
the MINISCRIBE fascia 0.00%, the strip-light row 0.11%. The handshake reads as a 10% change only
because the background swapped behind it; the clasp itself, both cuffs and both hands are
pixel-identical at 5x.

`ibm-suit` is likewise untouched. Head and hair core: **0.00% changed**. Suit core: 0.60%. The
heavy-lidded closed smirk of `expr-smug`, the grey temples, the navy chalk-stripe three-piece, the
blue tie, the pocket square, the black oxfords — all of it carried straight through.

And then `miniscribe-rep`'s head was replaced. Hair core **37.58% changed**, face interior **29.79%
changed**, while his blazer, legs and shoes measure 0.00–0.01%. Nothing but the head moved. Two
register features go at once:

- **Expression.** The parent draws `expr-delighted` — closed happy-arc eyes over a wide open teeth
  grin. L34 draws wide open round eyes with small pupils and a small closed line-smile.
- **Hair silhouette.** The parent's tall swept quiff is gone, replaced by a low close-cropped cap.

Total changes = 1 authored + 2 unauthored = **3 against a cap of 2**. And the legibility cost is the
real argument: across a hard cut on a held handshake, between two adjacent VO lines, the man goes
from beaming to blank while the other man's face does not move a pixel.

**The diagnosis is worth more than the verdict.** Both of those unauthored features are exactly what
the *canonical* sheet draws. I pulled the canonical up: `miniscribe-rep.png` is a low-cap hairline,
wide round eyes and a small closed smile — L34's face, feature for feature. So the canonical seed
leaked its expression into a delta that never asked for one. What makes this diagnosable rather than
a lottery is that **the same spec, with the same seed roles, did the opposite on `ibm-suit`**: the
ibm canonical is flat-mouthed deadpan, and the frame renders the parent's smirk instead. One figure
took identity+costume from the canonical and expression from the parent; the other took the whole
head from the canonical. The `seed_roles` preamble never says which authority owns expression, so
the model decided per figure.

Next move: not a fresh roll. Place, `ibm-suit` and the pallet delta are all correct and a re-roll
puts all three back in play. Narrow the canonical's authority for `miniscribe-rep` in the delta
preamble — identity, head tone, hair *colour* and costume from the canonical; expression, hair
*silhouette* and head outline from the parent, with the parent's mid-laugh face described in words.

One thing logged and dismissed: the cartons in the pallet queue carry printed label blobs. At 8x
they are illegible marks, not letterforms, and at play scale they are invisible. Not a lettering
violation.

Ink: hue 123.5°, R−B **+0.6**, ink_lum 4.9, median_sat 0.1294 — identical to the parent's 0.1294.
That +0.6 is the thinnest positive margin in the whole slice, and it wants the same caveat the r1
log gave it: this is the green-neutral register the entire L28/L33 interior family measures at,
where the darkest 3% is structural steel mass rather than outline. Sign correct, 99.5° clear of the
cool pole, frame not inverted.

---

## L38 — PASS

A fresh root, and the first time it has been verified — L38 sat in the gap between the L26–L37 and
L39–L50 slices, so there is no prior to compare against. Swept every axis cold.

The shot's argument is scale and the frame makes it. The giant occupies x~530–1376, 61% of the
width, seated square on a plain concrete block with his head cropped away above the border — the
crop is the joke and the prose says so. `miniscribe-rep` stands at the lower-left on the same
ground plane holding a flat carton out toward him, eyes rolled hard up so the sightline clears the
frame top. Flat cream ground and backdrop, even frontal light, and a giant-scale dark shoe on a teal
trouser leg cropped into the lower-left corner as the near-camera depth prop. `expr-pleading` is
exact to the card: raised inner brows, big up-rolled eyes, small downturned mouth.

Rig checks came back clean. No nose. **No ears** — and this one is worth stating because it looks
like a miss at a glance: there is a flesh-coloured notch in his hair at the left of his head that
reads as an ear at low zoom. At native pixels it has no helix, no cartilage and no separate outline;
it is a hair-lock cut-out, and the card's own hair silhouette draws the same shape. Hands are
4-digit where visible: miniscribe's near hand under the carton is thumb + three fingers; the giant's
visible crossed hand shows three finger lobes with the thumb tucked behind the arm. The other two
hands are occluded, not malformed. Flat cel throughout, no lettering anywhere, no duplicates, and
the single red accent correctly goes unused — nothing in this shot is semantically red.

Three things short of perfect, none of them grounds to fail:

- The base card draws a warm charcoal-**brown** three-piece with a near-**black** tie; the frame
  renders slate grey-green with a **teal** tie. The scene palette is charcoal-cream-teal, so this
  reads as the palette pulling the costume rather than a re-invention — cut, waistcoat, button
  count, shirt, shoe colour and pale skin all carry from the card.
- "Knee-high to him" measures 1.32x the giant's knee height, so he tops out at mid-thigh. The figure
  is internally consistent (shoe-length ratio 3.9x matches the height ratio), so this is prose
  approximation, not a broken figure — and the imbalance still lands hard.
- The carton is held level at his chest rather than *up* toward the giant.

Ink is the best in the round and close to dead-on target: hue **15.9°**, R−B **+24.7**, ink_lum
17.1. It is also the only frame here whose median_sat (0.1922) sits on the ~0.19 era prior.

---

## L39-fix — FAIL. Three correctives landed; the retry broke two rig axes that were already clean.

The staging fixes all took:

- **'600 MILLION' on the rear door panel, and nowhere else.** The truck is now drawn from the rear
  three-quarter and the stencil sits on the left leaf of the twin rear doors, hinge straps and door
  window visible. Side panel bare. Roof bare. No other lettering in the frame. One nuance for the
  stamping pass: the overlay said "the very panel his hands are pressed against", and his hands are
  on the *right* leaf. Same rear door pair, other leaf — and `shots.json`'s own wording ("Across the
  truck's rear panel") is satisfied either way. I am not failing it on that.
- **Notes out of the load bed, between the doors.** A wall of banded, strapped note bricks bulges
  out of the bed in the gap between the doors, forced against his hands. The prior's loose bills
  heaped on the roof are gone, and these read as banded bricks rather than scattered currency.
- **Roof bare.** Completely.

The prior's door-seam-drawn-across-the-wrist layering error is also gone, and both hands verified
4-digit at native zoom, same size as each other.

What sank it is the face, in three places:

- **A nose.** Bridge line off the inner eye corner, hooked nostril, nasolabial fold. The rig law is
  no nose, and neither the STEP-1 card nor the canonical draws one.
- **An ear.** With an inner helix curl, outlined against the hair on the right of his head. The rig
  law is no ears.
- **The expression, again.** This was corrective item 4 and it did not land. The card's `expr-greedy`
  is a closed-mouth smirk under half-lidded angled eyes. The prior failed with a wide teeth-bared
  grin; this retry gives a clenched teeth-bared effort grimace with hard angry brows. A different
  wrong answer, still off-card.

The nose and the ear are the part that should worry the wave, because I checked the rejected prior
and **it had neither** — its r1 record explicitly logged "no nose/no ears" as held. The re-roll
introduced both. A corrective that names only the staging defect leaves the rest of the frame free
to drift.

Next move: emphatically not a whole-frame re-roll. Three of four correctives landed and the staging
is now exactly what the shot wants; rolling again puts the stencil surface and the bare roof back at
risk to buy a face. Restate the current staging prose verbatim and append the rig law explicitly —
no nose, no ear, mouth closed in a small smirk with no teeth, half-lidded angled eyes. If a third
attempt drifts the same way, the finding is not about this frame: `expr-greedy` has now been pulled
open twice by a physical-effort action, and that belongs in the figure card or the critic layer.

Ink: hue 31.6°, R−B +16.8, ink_lum 19.8 — on target and slightly warmer-lit than the prior
(22.5° / +19.9 / 16.0). Nothing to flag.

---

## L45-fix — PASS

Both named correctives landed.

**Hands.** Checked at native pixels rather than by eye, because this is precisely where the prior
lied at low zoom. The raised hand has four protrusions — thumb plus three fingers — and no fifth.
The chest hand has thumb plus three curled fingers. The two are within about 10% of each other in
bounding size. The prior's five-digit raised hand is gone.

**The tableau.** No part of him hangs over open air, both feet are down, and he reads as a man
recoiling at the lip rather than a freeze-frame of a fall — which is what the shot note asked for
and what the prior contradicted.

Two things got better than the correctives asked for. The "cropped rock spur at the lower-left" is
now an actual near-field boulder cropped by the left and bottom edges, replacing the prior's hazed
opposing plateau sitting in mid-ground. And the break edge now reads as one clean calved bite with a
few falling fragments, instead of the prior's ragged arch-and-hole.

Four residuals, all minor, none of them the prior defect returning:

- **The forward boot.** The corrective asked for both boots planted flat on solid rock *behind* the
  lip. The rear boot is flat on solid plateau. The forward boot has its heel on the plateau edge and
  its toe on a rock block that is itself visibly calving — outlined all round, with a gap and shadow
  separating it from the cliff — and it is angled toe-down rather than flat. So he is supported, but
  on the piece that is going. Softer than the prior's boot-over-void, and it does not read as
  falling; I am logging it, not failing on it.
- **Ink, carried.** R−B **+47.4** against the p6b batch ceiling of +31.3, and ink_lum **41.0** — the
  highest of any frame in this round, meaning there is still no true near-black linework and the
  outlines read as saturated rust-brown on ochre. Barely moved from the prior's +51.4 / 39.4. Warm,
  nowhere near inversion, but unfixed.
- **Saturation.** median_sat fell from 0.2588 to 0.1098, now well under the ~0.19 era prior. The sky
  went from warm cream with cloud forms to a near-white void and the far plateau was dropped. The
  prose does say "pale sky" and the style suffix does ask for a flat gradient sky plus minimal
  geometry, so this is compliance rather than wash — but it is the most bleached frame in the round.
- **Light.** "Hard high sun" is authored; the frame is evenly flat-lit with no cast shadow. Unchanged
  from the prior.

Everything else swept clean: no nose, no ears, uniform head tone, `expr-shock` exact to the card
(wide round eyes, open mouth, tongue), `action-recoil` body line held, identity and costume matching
card and canonical, ochre-grey-cream palette with grey strata in the cliff face, flat cel fills, no
text, no duplicates.

---

## Ink table

| frame | ink hue | R−B | ink_lum | median_sat | ° from cool pole | read |
| --- | --- | --- | --- | --- | --- | --- |
| L34 | 123.5° | **+0.6** | 4.9 | 0.1294 | 99.5° | warm, thinnest margin in the slice; steel-mass darkest-3%, same as the whole L28/L33 family |
| L38 | 15.9° | +24.7 | 17.1 | 0.1922 | 207.1° | best of the round, on target, era-correct saturation |
| L39-fix | 31.6° | +16.8 | 19.8 | 0.1176 | 191.4° | on target; slightly warmer than its prior (22.5° / +19.9) |
| L45-fix | 22.4° | **+47.4** | **41.0** | 0.1098 | 200.6° | warm but over the +31.3 batch ceiling, no near-black linework; carried from prior (+51.4 / 39.4) |

No cool inversion anywhere. All four positive.

---

## Collateral sweep

- **L39-fix — one real regression.** The re-roll fixed three staging defects and broke two rig axes
  (nose, ear) that the rejected prior held clean. This is the finding of the round.
- **L45-fix — clean.** Broke nothing, and improved the foreground prop and the break edge beyond
  what the corrective asked for.
- **L34 — clean outside the head.** Place, fascia, benches, tote rack, strip lights, bench end,
  `ibm-suit` and the handshake are all pixel-identical to the parent. The only thing that moved that
  should not have is `miniscribe-rep`'s face.
- **L38 — n/a**, fresh root with no prior.

## Systemic signals

1. **Place-not-face, now measured.** L34 holds the place to within 0.01–0.11% and loses one head at
   30–38%. Chain deltas in this pipeline hold geometry and lose faces.
2. **Canonical expression leak — a spec gap, not a lottery.** The same L34 spec resolved `ibm-suit`
   correctly (identity+costume from canonical, expression from parent, head core 0.00% changed) and
   `miniscribe-rep` wrongly (whole head from canonical). The `seed_roles` preamble never states which
   authority owns expression, so the model decides per figure. Fixable in the delta preamble.
3. **Re-roll collateral.** Corrective prose that names only the staging defect leaves the rest of the
   frame free to drift — L39 gained a nose and an ear on a face that was previously rig-clean.
   Targeted correctives should restate the rig law even when the rig was not the failure.
4. **Physical effort pulls closed-mouth expressions open.** `expr-greedy` on L39 has drifted twice in
   a row, both times toward an open mouth, under an action that is physical straining. A third drift
   makes it a card/critic-layer lesson, not a prose one.
5. **Ochre environments and ink.** L45 in both rolls is the only frame family above the batch R−B
   ceiling with no true near-black linework (ink_lum ~40 against 5–20 elsewhere). Warm ochre scenes
   appear to pull the darkest 3% into the rock rather than the outline. Batch-level question, not a
   per-frame retry.
