# Wave-2 partial character-seed report

Machine-tier outcome: **7/10 verified, 3/10 parked**. The human ruling remains pending on the board skeleton; no review record was stamped or promoted.

| Shot | Card | Attempts | Machine verdict | Failed axes |
| --- | --- | ---: | --- | --- |
| L18 | drive-maker / carry-by-handle / deadpan | 2 | PARKED | pose |
| L19 | drive-maker / hold-both-hands / greedy | 2 | VERIFIED | — |
| L20 | drive-maker / action-present / smug | 1 | VERIFIED | — |
| L22 | brick-foreman / back-to-viewer | 1 | VERIFIED | — |
| L23 | brick-foreman / action-shrug / deadpan | 1 | VERIFIED | — |
| L24 | brick-foreman / hold-one-hand / deadpan | 2 | PARKED | clean_card (box prop) |
| L27 | brick-foreman / hold-one-hand / deadpan | 2 | PARKED | pose |
| L30 | terry-johnson / action-armscrossed / thinking | 1 | VERIFIED | — |
| L32 | miniscribe-rep / action-recoil / surprised | 1 | VERIFIED | — |
| L35 | miniscribe-rep / action-celebrate / delighted | 1 | VERIFIED | — |

Spend: 14 returned generations × $0.134 = **$1.876** (below the $2.68 ceiling). Cost to machine-verified card: **$0.268**. There were no provider refusals, errors, or stalls. Forge held the ten downstream scenes for their missing human review records, as required.

## Mechanism diagnosis: objects leak from the beat clause

Both clean-card failures were generated from Forge's own retry slate with no human-authored prompt addition. Their assembled prompts retain Forge's mutually conflicting card fence ("empty-handed and alone, the object or person it acts on left out. Draw none of its setting, props, lettering or other people. Flat solid pale-grey studio backdrop, no scenery, no props, no furniture.") and the following exact Forge-derived beat clauses:

> L19: "The scene this card is minted for reads: planted centre frame with both hands on the shaft of a long garden rake, dragging a knee-deep drift of loose banknotes in toward himself into a growing heap at his boots."

> L24: "The scene this card is minted for reads: stage-left, lowering one red clay brick in one hand toward an open flat carton set square on the trestle in front of him."

Attempt 1 of L19 rendered the rake and banknotes; L24 rendered a brick. L24 retry rendered a grey box. The object-bearing phrase in each Forge-derived beat clause overrode the later clean-card fence. No prompt was edited; the complete Forge request objects, including the seed-role header and payload, are preserved in `step1-builder.json` and `retry-builder.json`.

The following three blocks are the complete final L24 assembled prompt, in Forge's actual order. The first two fixed headers were printed by Forge's `gen --dry-run`; the final `delta` is verbatim from `retry-builder.json`:

```text
Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, flat colours laid down at FULL cel strength — every fill a real colour, and any grey or neutral clearly TINTED warm or cool, so a cold scene reads COLD-COLOURED and never drains to greyscale — with gentle soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.

Every FOREGROUND / named / seeded cartoon figure in this image keeps the shared FAMILY RIG exactly as the reference(s): SAME round near-circle head (only slightly taller than wide, NOT an egg/oval), SAME eye style/size/position, NO nose, NO ears, SAME classic cartoon hands — exactly THREE fingers plus ONE thumb (four digits total, Mickey / Simpsons style, NEVER four fingers, NEVER five digits), SAME even medium-thick dark warm brown-black (#241a12) outline, SAME clean FLAT cel render. Anonymous background / crowd figures instead follow the §2d CROWD-RIG clause when the prompt states it (simplified: dot eyes, one simple mouth) — do NOT force this full rig onto them. Hold ONLY this form — costume, pose, expression, head tone, build, and framing are set by the generation delta, not here, except when THIS generation is itself a new-character canonical mint, where the resting expression and resting stance are invariants inherited from the base (§1).

SEED ROLES. The FIRST image is `brick-foreman`'s character canonical — identity, head tone, hair, the pinned costume unless this beat authors a change, and the face's RENDER REGISTER: how eyes, brows and mouth are DRAWN, never which shape they take where another seed carries it. Never the pose. The SECOND image is the `expr-deadpan` expression reference for `brick-foreman` — copy only eye/brow/mouth shape; ignore identity, head tone and hairline; this shape replaces the expression `brick-foreman` holds in the parent scene, and no other figure's. The THIRD image is the `hold-one-hand` pose reference for `brick-foreman` — copy only body pose, hands and limb placement; ignore identity and costume.

The whole figure is in frame head to feet, standing or seated exactly as the pose reference shows, on a thin visible ground line with one soft contact shadow directly beneath it. The scene this card is minted for reads: stage-left, lowering one red clay brick in one hand toward an open flat carton set square on the trestle in front of him. Where that description AUTHORS clothing — garments, headwear, footwear — dress the figure in it for that era, work and setting; where it authors none, the costume the canonical seed pins governs unchanged, and never the rig template's default hoodie; and the bodily ACT it gives this figure — draw the figure performing that act WITHIN the stance the pose reference holds, empty-handed and alone, the object or person it acts on left out. Draw none of its setting, props, lettering or other people. Flat solid pale-grey studio backdrop, no scenery, no props, no furniture. This is a reference sheet: the character alone, fully resolved, ready to be placed into a separate scene.
```

## Deliverables

- Machine verdicts: `verdicts.json`
- Blank human-review skeleton: `figure-verdicts-skeleton.json`
- Review board: `w2-partial-board.html`
- Generation log: `genlog.md`

Deviation: Forge's STEP-1 retry overlay permits only `expression`, `rig`, or `pose` defects. It has no `clean_card` value, so L19 and L24 used its required `rig` route with no instruction solely to obtain the sanctioned re-mint; their actual judged defect remains `clean_card`.
