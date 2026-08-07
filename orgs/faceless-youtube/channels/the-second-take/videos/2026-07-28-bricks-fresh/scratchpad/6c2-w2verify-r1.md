# 6c2 wave-2 retry, round 1 — fresh-eyes verification log

Verification only. Nothing here is a verdict write; `stamp_review.py` remains the sole writer.
Ink measured with `scratchpad/p6b_ink.py` (darkest-3% circular-mean hue + mean R−B; warm target
~19° / +18; R−B ≤ 0 is a hard cool-inversion fail). Prose authority = `shots.json` still_prompt
with the `6c2-w2retry.overlay.json` span substituted. L49-fix is judged against the EDITED
shots.json prose (navy → brown).

Judging order: **L33-fix first**, because it is the chain parent of L34 and a blocked mint sits
behind it.

---

## L33-fix — PASS. **L34 may proceed.**

The r1 failure was three identity features moving at once on miniscribe-rep: hair went jet
black, the head outline changed to a rounder mass over the ear, and expr-delighted turned into
an open laughing mouth with the tongue showing. All three are gone.

The hair is warm dark brown again — patch mean RGB (110, 65, 41) against the canonical's
(91, 66, 53) and the delighted card's (90, 65, 51). Same family; r1 measured as a near-black
mass and read that way at full frame. It is side-parted and swept off the brow with the side of
the head left clear. The mouth is a closed-corner teeth grin under closed-arc eyes — the card's
expr-delighted register, pixel-for-intent. No tongue, no inner-mouth pink.

Collateral swept fresh, and it is clean. ibm-suit is untouched: dark brown skin, grey temples,
navy chalk-stripe three-piece, blue tie, white pocket square, black oxfords, expr-smug held.
The interaction template still holds — one clasp, one ground plane, eye lines within a few
pixels, head scales level, no spare hands. Every visible hand carries three fingers and a thumb
and the pair on each figure match in size. Place geometry registers against L28 down to the
tray shelves and the cropped bench end.

And one thing got **better**: the MINISCRIBE fascia board, absent in r1 and flagged then as a
continuity note, is back over the entrance — correctly spelled, marker-italic red on cream, on
the authored surface, the only lettering in the frame.

Two things worth writing down, neither of them grounds to fail:

- The quiff is drawn taller than the sheet draws it — more pompadour than side-sweep. That came
  from the overlay's own word ("side-parted into a quiff"), not from the generator wandering.
  Colour, part, silhouette family and head outline all read as the same man.
- The roller door at the back is drawn **shut**, slats and drum fully rendered. L33's own line
  says "the roller door up on flat grey daylight". The fix obeyed the L28 place seed, which
  authors the door shut, over its own prose. r1 put a flat grey panel there that could read as
  open. This is a seed-vs-prose conflict in the spec, not a generator miss — the stamping pass
  should know which authority it wants to win.

Ink: hue 100.8°, R−B **+2.1**, essentially unchanged from r1's +2.5. Positive, no inversion,
122° off the cool pole. Same green-neutral register as the whole L28 family — see the ink
section at the end of this log.

---

## L27-fix — PASS

The mitten is gone. Both hands are now closed fists on the sheet's leading edge, each with a
thumb wrapped over the top and three finger segments below — four digits apiece, checked at 6x.
They measure 45x46 and 43x42 pixels, inside 5% of each other, and both wrists end in a drawn
brown coat cuff. Neither reads as laid flat on the sheet; both are gripping and pulling.

This retry re-rolled the whole composition rather than just the hand, so I swept every axis
fresh. It came back clean, and mostly better than r1: the camera moved in, the stack now
genuinely towers over him, the wrap reads in flat planes where the sheet has come away, half the
sheet still lies over the top, the shuttered door and its warm bulb sit stage-right, the cold
skylight shaft drops from above, and the lower-left forklift tine is now drawn as grey steel
instead of r1's timber-coloured fork.

Identity holds against the l27 card — bald dome, no ears, heavy-lidded deadpan, flat line mouth,
brown patch-pocket coat over the grey-olive tee. Worth stating explicitly because it looks like a
miss at a glance: **there is no nose**. The pale rounded shape under the mouth is the card's own
lower-lip/chin highlight, and it is drawn identically on the card itself.

Only nit: faint vertical grime streaks on the left wall where the prose says "its walls bare".
Texture, not an object.

Ink improved in both directions that matter. R−B fell from +37.9 — above the p6b batch ceiling of
+31.3 — to +27.7, and ink_lum halved from 42.5 to 22.5, so the frame has real dark linework now
instead of low-contrast brown on brown.

---

## L32-fix — PASS

"FIRE" is gone. The bucket is completely blank, and a full-frame sweep finds no lettering
anywhere — the peg rail's tools are unlabelled, the drive casing is bare, bench and walls clean.
That closes the text-law failure that sank r1.

Collateral is clean. Both oven gloves draw thumb-plus-three-fingers, same size, quilted cuffs —
checked at 4x, because gloves are exactly where a re-roll likes to add a fifth digit. expr-shock
and action-recoil both hold. And the background changed for the better: r1 drew a full pegboard,
the fix draws the peg *rail* the prose actually asks for.

Two things the retry did not deliver, neither fatal:

- The overlay asked for the bucket "kept small and muted" so the drive stays the single dominant
  red. It didn't happen. Saturated-red pixel area went 9,720 → 9,186 on the bucket (−5.5%) and
  28,519 → 28,523 on the drive (unchanged), and the bucket's mean red saturation went *up*,
  0.65 → 0.71. The drive is ~3.1x the bucket in both frames, so the gag still reads — but the
  r1 minor is unresolved, not fixed. Useful signal: **content instructions ("draw it blank")
  land; chroma-and-scale instructions ("smaller, muted") do not.**
- The stool at lower-left is again a complete backless stool where the prose says "a cropped
  stool back". Carried over from r1 unchanged.

One collateral drift: median_sat fell 0.0745 → 0.0431, the lowest reading anywhere in the slice
and about a quarter of the ~0.19 era prior. The retry swapped r1's cream walls for a big flat
mid-grey field, so the authored "grey-cream-red" lost most of its cream. Defensible per-frame,
but it deepens the act-level flatness logged as S3 in round 1.

---

## L44-fix — PASS (ink clause flagged)

Two of three correctives landed, and the two that landed are the ones that carried the beat.

The rack is right. Cropped side by side against the L28 seed at 3x: the seed carries bins on all
three rows, L44-fix strips the top row to bare metal and leaves bins on the middle and bottom
only. Half empty, unmistakably different from the seed, exactly as authored. The MINISCRIBE
board is back over the entrance at the seed's position in the seed's letterform.

Collateral clean. ibm-suit is untouched on identity, costume, rig and expression; the carton, the
shut roller door, the cropped bench end and the place geometry all hold. And the retry quietly
improved the r1 "far end unlit" minor without being asked: rear-central lit-pixel area fell
5,290 to 3,119 and that band's mean luminance fell 98.5 to 80.7 (the seed reads 13,604 / 144.6).

The ink clause did nothing. R−B moved **+0.1 → +1.1** against a +18 target, hue stayed
green-neutral at 117°. See the ink section below — this is not a L44 problem.

The palette-cooling miss from r1 also stands: median_sat is 0.1255 in both frames, identical to
four decimal places, so no cooling delta was applied either time. The overlay never addressed it.

---

## L46-fix — PASS (ink clause flagged)

The travel vector is fixed outright. He is drawn from behind, back three-quarters to camera,
walking straight down the floor's axis with the roller door ahead of him. r1's lateral
cross-frame walk with the door behind his back is gone, and with it the inverted beat. The
MINISCRIBE board is restored.

The crowd came through the re-roll intact — around eleven base figures, bald domes, no nose, no
ears, sad angled brows over flat downturned mouths, arms down, four-digit hands, varied garment
colour, correct scale and baseline for depth. The card's own arms-at-sides drift is again not
inherited: the scene stages the two-handed carry the prose asks for, with the far arm occluded by
the torso as a rear view requires.

Three things did not move:

- **Placement.** The overlay asked for the stage-LEFT side of the floor. His centre of mass sits
  at x≈580 against a frame centre of 688 — 8% of frame width left of centre. He reads near-centre.
  The direction half of the corrective landed; the placement half barely did.
- **Ceiling drain.** Side-ceiling lit-pixel area: 8,297 in r1, 8,312 in the fix, against 55,135 in
  the seed. Unchanged. The prose wants every fourth fitting dark; the frame darkens most of them.
- **Crowd depth.** Still ranked along the stage-right aisle rather than beyond the deepest bench.

Ink: **+1.0 → +2.1**. No-op.

---

## L47-fix — PASS. The strongest retry of the eight.

r1 staged an authored exterior entirely indoors — the p6b "authored outside, staged inside"
class, and it killed the beat. The fix reverses it completely. He is outside on tarmac with
painted parking bays, a parked car stage-right and open grey sky above, one pace clear of the
glass door. The assembly floor exists only through the glazing behind him. The two-zone lighting
finally reads: cool flat daylight outside against warm cream strip light inside. A real concrete
kerb is drawn at the tarmac edge, and the mis-inherited L28 workbench is gone. The departure
now lands as a threshold already past.

No collateral loss anywhere. terry-johnson's identity, expression and rig hold against the reused
card, hands are four-digit on both sides and the same size, and the interior visible through the
glass keeps the L28 palette and props.

Two things it fixed that nobody asked for: the **document case is now the card's grey hard case**
(r1 drew a brown leather satchel with a strap and buckle), and median_sat moved *toward* the era
prior, 0.0902 → 0.1098.

Nits: the kerb is the right object in the wrong corner — it runs across the lower-centre where
the overlay asked for the lower-left, which is occupied by the building's wall base. And ink
warmth slipped slightly, R−B 11.0 → 8.9, though this frame's overlay carried no ink clause so
nothing was promised. It is still the warmest of the four L28 children.

On the fascia board: not visible, and I do not count that as a defect here. The retry moved the
camera outside, and the board hangs high over the entrance, above the slice of interior the
glazing shows.

---

## L48-fix — PASS. **The mechanism fix is NOT needed.**

Taking the special case first, because it was the reason to look hard: **he is not upright.** The
card and the r1 frame both draw a bolt-upright stand — level shoulders, a visible neck gap,
symmetric arms. L48-fix draws a real slump. The head hangs forward and down until the jaw sits on
the collar with no neck showing, the shoulders are dropped and visibly asymmetric with the
viewer-right one sloping away, the back curves over, both arms hang loose. The figure is ~4%
shorter than r1 at the same distance (290px vs 303px), which is what a slumped stance does to a
silhouette. The card drift did not reassert. No third prose attempt, no mechanism change.

The tote racks are also fixed against the shot prose: both of them, far stage-left and far
stage-right, are stripped to bare metal with no bins at all — plainly different from the seed's
three full rows. (The overlay's stricter "no cartons on ANY rack" was not honoured; the two mid
tray racks keep their timber trays. The prose is the authority and the prose says tote racks.)

Two correctives did not land:

- **The cold shaft.** The overlay re-authored it with emphasis — "landing on the floor to one
  side of him and not on his body" — and it still lands on him. Measured floor luminance gives a
  bright pool at x≈480–900 (lum 185–209); his shoes sit at x640–733, dead in the middle of it.
  This is the round's cleanest example of a *spatial-relation* clause the generator will not
  honour even on a second, heavily emphasised pass.
- **Ink**, R−B +0.028 → +1.9. Off the exact boundary, nowhere near the target.

The fascia board is still absent. L48's overlay never carried the board clause — unlike L44's and
L46's, where it worked. Unfixed rather than regressed, and one clause away from closing.

---

## L49-fix — PASS. The blocker is dead.

Judged against the edited shots.json prose (navy to brown, made upstream before this mint) plus
the overlay's room-match span.

The suit is measured, not eyeballed. L49-fix torso reads RGB (94.0, 59.7, 42.1) and trouser
(110.0, 69.8, 45.9). L50's torso reads (93.1, 58.1, 40.3); the STEP-1 card (101.4, 66.3, 50.2);
the hq-banker canonical (92.8, 56.5, 41.6). r1 read (58.5, 54.4, 60.3) — navy, within noise of
the ibm-suit canonical (55.2, 54.8, 72.2). The fix lands on L50 within about one unit per
channel. Identity-by-costume between hq-banker and ibm-suit is restored, and the character's
introduction shot now agrees with his second appearance one VO line later.

Room match to L50, judged as a staging axis since L49 was not seedable on it: plain oak plank
floor with no carpet (r1 had green), oak raised-and-fielded paneling behind him (r1 had a wall of
cabinets), oak drawer cabinets standing against that paneling with L50's drawer-pull family, a
partners' desk with a plain oak top (r1 had a green leather inset), the same green shaded
banker's lamp, sash windows stage-left onto grey rooftops. It reads as the same room with room to
spare — the two frames could cut against each other.

Two more r1 minors closed as collateral: there is now exactly **one** cropped visitor chair at
the lower-right, and the **unauthored spiral desk calendar is gone** — the object family the p6b
"1983 tent card" bleed came from. No lettering anywhere, correctly.

Residuals, both inherited rather than introduced: median_sat 0.6392 (was 0.6235) is still ~3.4x
the era prior, but its sibling L50 sits at 0.6627 and passed, so this is a property of the
bank-office set rather than an L49 defect. And R−B rose 40.2 → 54.1, the highest reading in the
whole retry set and well above the p6b batch ceiling of +31.3 — warm to the point of rust. L50
reads +46.7, so L49-fix is in family but at its outer edge.

---

## Ink table — all eight, r1 to fix

| frame | hue r1 → fix | R−B r1 → fix | Δ R−B | ink clause? | read |
|---|---|---|---|---|---|
| L33-fix | 75.1° → 100.8° | +2.5 → **+2.1** | −0.4 | no | green-neutral, seed-inherited |
| L27-fix | 30.0° → 24.2° | +37.9 → **+27.7** | −10.2 | no | improved into batch range |
| L32-fix | 19.4° → 23.6° | +47.7 → **+36.3** | −11.4 | no | warm, still over ceiling |
| **L44-fix** | 122.0° → 117.4° | +0.1 → **+1.1** | **+1.0** | **yes** | **clause no-op** |
| **L46-fix** | 114.3° → 101.9° | +1.0 → **+2.1** | **+1.1** | **yes** | **clause no-op** |
| L47-fix | 47.7° → 59.4° | +11.0 → **+8.9** | −2.1 | no | warmest L28 child, slipped |
| **L48-fix** | 141.7° → 116.3° | +0.03 → **+1.9** | **+1.9** | **yes** | **clause no-op** |
| L49-fix | 13.4° → 16.0° | +40.2 → **+54.1** | +13.9 | no | over-warm, hue on target |

No cool inversion anywhere. R−B is positive on all eight; the closest approach to the 223° cool
pole is L44-fix at 105.6° away. Nothing trips the hard fail.

---

## What this round says

**The warm-ink clause does not work, and three frames is enough to stop trying it.** L44, L46 and
L48 all carried an emphatic instruction to draw every outline in warm brown-black. Measured
movement: +1.0, +1.1, +1.9 against a target of +18. That is noise. Every figure card feeding
those frames is properly warm (+19.5, +41.8, +39.3) and the L28 place seed measures +3.0 — the
children track the *seed*, not the cards and not the prose. Ink register is inherited through the
place-seed mechanism and prose cannot override it. **The fix is to re-mint L28 warm and re-seed
its five children.** More ink language will not do it.

**The p6b re-roll-collateral class did not recur: 0 of 8.** The stated risk going in was that
surgical retries break something that was passing — three of four did in the first p6b round. I
swept every axis fresh on all eight and not one previously-passing attribute regressed. Seed
preservation is working.

**Retries fixed things nobody asked them to.** L47 redrew the case as the card's grey hard case.
L49 dropped the extra chair and the unauthored calendar. L44 darkened the rear of the floor. L27
halved ink_lum. Re-rolling on a corrected span seems to re-resolve nearby small errors as a side
effect.

**The clean split of this round: content instructions land, tone/scale/position instructions do
not.** Landed, every one of them object-content: strip the rack to bare metal, draw the bucket
blank, hang the fascia board, draw four digits, put him outside on tarmac, dress him in brown,
match the room's surfaces, execute a slump. Did not land: "kept small and muted in tone" (L32's
bucket moved 5% in area and got *more* saturated), "warm dark brown house ink" (x3), "palette
gone colder" (L44, bit-identical), "the shaft BESIDE him, not on his body" (L48, he is dead
centre in the pool on a second emphasised attempt), "stage-LEFT" (L46, 8% off centre). Write
correctives as objects and their states. Where a relative position *is* the beat, it needs a
mechanism, not a stronger adjective.

**The fascia board is present in 3 of 5 L28 children.** It appeared every single time the clause
was asked for — including L33, where it was not the named corrective. Absent in L47 (defensible;
the camera went outside) and L48 (not defensible; the clause was simply never written). One more
clause on L48 closes the family.

**The act's saturation split widened.** Factory interiors 0.043-0.133 against a ~0.19 prior, with
L32-fix setting a new slice low at 0.0431; bank office 0.639 and 0.663. Each frame is compliant
with its own authored palette, but as a body the act now reads as two disconnected colour worlds.
Carried forward from r1's S3 observation, and measurably wider than it was.
