# Prompt-diff analysis — fresh VPW vs v2-era vs liked-era

Date: 2026-08-19  
Task: 15  
Scope: long-form `still_prompt` records only, plus the named critic, implementation, and git-generation evidence. No image generation was run.

## Executive verdict

**Verdict — the doctrine reset fixed v2's visible templates, but the fresh file still does not reproduce the liked-era author-to-engine register.** The strongest still-untested delta is not another version of “make figures smaller.” It is **provider-tail ownership**: the actual liked full-generation forge path (`309b341b`) did not append `global_prompt_suffix`; it put the authored shot before any applicable figure/rig clauses and otherwise let the scene payload close the assembled prompt. Current forge appends an 80-word house-style suffix after every scene payload. The file-level delta points the same way: liked prompts spend more words on an explicit camera and complete world, while fresh spends far more of the file inside held parent chains and often leaves the camera implicit.

**Register delta — doctrine-ready paragraph.** LIKED-era prompts are not terse or vague: their median is 73 words overall and 87 words on non-deltas, 71% name an explicit camera/vantage, 45% say `wide`, and 17% use a close/detail register. Their extra words normally specify a recognizable world, one readable arrangement, and the camera; 70% begin with `A`/`An`/`The` scene framing and only 29% begin with a cast slug. FRESH is shorter (61-word median), more cast/chain-led (37% slug-first; 109/245 prompts are deltas), and delegates the camera more often (63/245 explicit; only 6/69 in A4). At dispatch, FRESH then places an 80-word style recipe after the authored scene, whereas the actual liked-run forge path appended no suffix at all. A doctrine could act on this as **scene-and-camera first, payload last**: spend specificity on concrete world objects plus one decisive camera/scale relation, keep authoring rationale out of pixel prose, and reserve the final provider-weighted position for the shot's visual payload rather than the house-style recipe.

### Top five findings

1. **The actual liked dispatch did not use the stored suffix.** The liked corpus stores a 35-word/251-character suffix, but `forge.py` at the full liked generation commit (`309b341b`) had no suffix parameter and incorrectly claimed it was baked into `still_prompt`; inspection of the prompts shows it was not. Current forge appends an 80-word/535-character suffix after the payload. This is a large, clean, never-isolated engine-input difference.
2. **Fresh overcorrected v2's standalone churn into a held-chain majority.** Fresh has 109 deltas and 29 standalone shots; liked has 73 deltas and 74 standalones; v2 has 44 deltas and 131 standalones. In A2 specifically, fresh has only 2 standalones versus liked's 9 and v2's 25. Better continuity is real, but the engine gets fewer independent compositional resets.
3. **The depiction vocabulary shifted away from the liked corpus.** Liked has only 6 literal shots, versus fresh's 43, and carries 32 `symbolic-stand-in-object`, 24 `reaction-shot`, and 15 `number-glued-to-object` shots, versus fresh's 4, 6, and 5. Fresh instead concentrates 59 `ironic-counterpoint` shots. This is a new axis, not a restatement of small-figure doctrine.
4. **V2's major file-level defects genuinely converged.** Current versus v2: figureless 22.4% versus 10.2%; crowd shots 55 versus 72; `cropped` 2 versus 197; `foreground` 7 versus 203; row/lane/aisle wording 0 versus 45; cream 51% versus 96% of prompts. Current lint has 6 real-hold outliers versus critic round 1's 115. These are meaningful improvements, just not proof of liked output.
5. **Fresh still leaves a large liked-era camera and palette gap, especially in A4.** Explicit-vantage prompts are 63/245 fresh, 107/246 v2, and 152/214 liked. A4 is 6/69 fresh versus 39/57 liked. Fresh also repeats `cream` in 126/245 and `charcoal` in 58/245, while liked spreads its leading palette words across grey 87, warm 62, amber 43, green 41, cold 36, red 35, white 34, cream 33, and brown 32. The reset removed a template but did not recover the liked distribution.

## Sources, definitions, and limits

### Compared corpora

| Label | Source | Long-form shots | Act starts used |
| --- | --- | ---: | --- |
| FRESH | current `shots.json` | 245 | A2 L66, A3 L112, A4 L177 |
| V2-ERA | `scratchpad/vpw2/shots.v2-era.json` | 246 | A2 L67, A3 L110, A4 L176 |
| LIKED-ERA | `git show 30d2b7e8:.../shots.json` | 214 | A2 L60, A3 L100, A4 L159 |

Act starts were aligned by the same narration beats—“Wiles ran MiniScribe with fear,” “So the managers put their heads together,” and “The papers ran it”—rather than by assuming IDs stayed aligned.

### Counting rules

- A **named stage** is a nonempty `stage` value.
- A **multi-shot chain** is a named stage containing at least two shots. `base`, `delta`, and standalone counts use `stage_role`; records without a named stage are standalone.
- **Figure-bearing** follows the current forge semantics: a declared crowd/anonymous figure, a registry-resolved named cast token/asset, or positive figure language detected by forge's figure vocabulary. **Crowd** is narrower and uses `figures.crowd: true`, which exists in all three corpora.
- Prompt-word counts use `\b[\w'-]+\b`; phrase and palette numbers are shot-presence counts, not raw term frequency. Categories can overlap.
- Vantage counts are lexical evidence that a camera choice was authored. They do not prove the render obeyed it.
- Palette counts describe prompt vocabulary, not pixel HSV.

### Limits a decision must keep visible

1. The LIKED file requested by the brief is the 214-shot snapshot at `30d2b7e8`; the actual full image run was committed at `309b341b` from the preceding 215-shot corpus. The requested file is therefore the comparison authority, while `309b341b` is the best available dispatch-code authority. Do not claim every later-edited liked prompt byte generated its corresponding loved frame.
2. Prompt comparison cannot decide taste-ground-truth axes 2 or 4: painterly/atmospheric render texture and delivered figure/open-space ratios require pixels. The report ranks an A/B that isolates them instead of pretending prose settles them.
3. Shot-class labels are useful structural evidence, but the visual result still depends on the prompt and engine; no class quota is recommended.

## 1. Whole-file structure

### Shots, named stages, and chains per act

`B/D/S` means named-stage bases / deltas / unstaged standalones.

| Era | Act | Shots | Named stages | Multi-shot chains | B/D/S |
| --- | ---: | ---: | ---: | ---: | ---: |
| FRESH | A1 | 65 | 28 | 19 | 28 / 31 / 6 |
| FRESH | A2 | 46 | 20 | 16 | 20 / 24 / 2 |
| FRESH | A3 | 65 | 29 | 19 | 29 / 29 / 7 |
| FRESH | A4 | 69 | 30 | 17 | 30 / 25 / 14 |
| **FRESH total** |  | **245** | **107** | **71** | **107 / 109 / 29** |
| V2-ERA | A1 | 66 | 19 | 9 | 19 / 12 / 35 |
| V2-ERA | A2 | 43 | 13 | 5 | 13 / 5 / 25 |
| V2-ERA | A3 | 66 | 21 | 11 | 21 / 12 / 33 |
| V2-ERA | A4 | 71 | 18 | 13 | 18 / 15 / 38 |
| **V2-ERA total** |  | **246** | **71** | **38** | **71 / 44 / 131** |
| LIKED-ERA | A1 | 58 | 15 | 10 | 15 / 19 / 24 |
| LIKED-ERA | A2 | 40 | 20 | 8 | 20 / 11 / 9 |
| LIKED-ERA | A3 | 59 | 16 | 14 | 16 / 24 / 19 |
| LIKED-ERA | A4 | 57 | 16 | 12 | 16 / 19 / 22 |
| **LIKED-ERA total** |  | **214** | **67** | **44** | **67 / 73 / 74** |

**Verdict.** The doctrine reset did not merely “improve chaining”; it changed the dominant file shape. Deltas are 44.5% of fresh, 17.9% of v2, and 34.1% of liked. All fresh named stages cap at three shots (36 one-shot, 33 two-shot, 38 three-shot stages); liked still had six four-shot stages. This is safer continuity than v2, but it also means nearly half of fresh prompts are constrained to preserve an existing frame.

### Figure-bearing, figureless, and crowd ratios

| Era | Act | Figure-bearing | Figureless | Crowd-declared |
| --- | ---: | ---: | ---: | ---: |
| FRESH | A1 | 55/65 (84.6%) | 10/65 (15.4%) | 20/65 (30.8%) |
| FRESH | A2 | 36/46 (78.3%) | 10/46 (21.7%) | 13/46 (28.3%) |
| FRESH | A3 | 46/65 (70.8%) | 19/65 (29.2%) | 7/65 (10.8%) |
| FRESH | A4 | 53/69 (76.8%) | 16/69 (23.2%) | 15/69 (21.7%) |
| **FRESH total** |  | **190/245 (77.6%)** | **55/245 (22.4%)** | **55/245 (22.4%)** |
| V2-ERA | A1 | 61/66 (92.4%) | 5/66 (7.6%) | 17/66 (25.8%) |
| V2-ERA | A2 | 40/43 (93.0%) | 3/43 (7.0%) | 9/43 (20.9%) |
| V2-ERA | A3 | 56/66 (84.8%) | 10/66 (15.2%) | 23/66 (34.8%) |
| V2-ERA | A4 | 64/71 (90.1%) | 7/71 (9.9%) | 23/71 (32.4%) |
| **V2-ERA total** |  | **221/246 (89.8%)** | **25/246 (10.2%)** | **72/246 (29.3%)** |
| LIKED-ERA | A1 | 45/58 (77.6%) | 13/58 (22.4%) | 13/58 (22.4%) |
| LIKED-ERA | A2 | 31/40 (77.5%) | 9/40 (22.5%) | 14/40 (35.0%) |
| LIKED-ERA | A3 | 37/59 (62.7%) | 22/59 (37.3%) | 13/59 (22.0%) |
| LIKED-ERA | A4 | 35/57 (61.4%) | 22/57 (38.6%) | 16/57 (28.1%) |
| **LIKED-ERA total** |  | **148/214 (69.2%)** | **66/214 (30.8%)** | **56/214 (26.2%)** |

**Verdict.** Fresh meaningfully corrects v2's population pressure and lands exactly on liked's A2 figure ratio, but it is still 8.1 points more figure-heavy in A3 and 15.4 points more figure-heavy in A4. Crowd count itself is not the remaining difference: fresh has essentially the same absolute crowd count as liked (55 versus 56) across more shots.

### Crowd staging idioms

Counts below are among crowd-declared shots only.

| Idiom | FRESH (n=55) | V2-ERA (n=72) | LIKED-ERA (n=56) |
| --- | ---: | ---: | ---: |
| Foreground/crop entry | 0 | 55 | 13 |
| Rear/background/far wording | 5 | 47 | 25 |
| Row/lane/aisle | 0 | 20 | 11 |
| Recession verb | 0 | 4 | 1 |
| Behind real geometry | 12 | 39 | 14 |
| Queue/line | 8 | 20 | 9 |
| Group/cluster/huddle/ring | 19 | 6 | 3 |
| Explicit small-scale wording | 3 | 15 | 11 |

Representative contrast:

- V2 L110: “a tight ring of shirt-sleeved figures” plus “foreground depth from a cropped chair back.”
- Fresh L73: “a sunken conference chamber” with managers rising “in two worried arcs,” their heads “barely clearing the chair backs.”
- Fresh L201: accountants distributed across “two stair landings,” some braced on chairs and others “tucked under the balcony.”
- Liked L80: a “busy MiniScribe warehouse count floor” where named leads and a counting crowd share a working environment of racks, ladders, carts, rails, and lamps.

**Verdict.** Fresh replaces v2's repeated crop/rear-row grammar with architecture-specific formations. That is a genuine improvement. The risk is an overcorrection from explicit distance into implied distance: only 3/55 fresh crowd prompts use small-scale words versus 11/56 liked. Fresh often carries scale through chair backs, thresholds, railings, landings, and balcony depth instead; generation must verify that those structures actually make figures small.

### Vantage distribution

These are overlapping shot-presence categories.

| Vantage token | FRESH | V2-ERA | LIKED-ERA |
| --- | ---: | ---: | ---: |
| Any explicit camera/vantage | 63/245 (25.7%) | 107/246 (43.5%) | 152/214 (71.0%) |
| Wide/establishing | 9 (3.7%) | 27 (11.0%) | 96 (44.9%) |
| Eye-level/frontal | 0 | 38 (15.4%) | 49 (22.9%) |
| High/top-down/overhead | 24 (9.8%) | 46 (18.7%) | 38 (17.8%) |
| Low/ground-level | 12 (4.9%) | 3 (1.2%) | 4 (1.9%) |
| Oblique/three-quarter | 23 (9.4%) | 7 (2.8%) | 30 (14.0%) |
| Close/detail/tight | 9 (3.7%) | 6 (2.4%) | 37 (17.3%) |

Per act, any explicit vantage:

| Act | FRESH | V2-ERA | LIKED-ERA |
| --- | ---: | ---: | ---: |
| A1 | 15/65 | 37/66 | 42/58 |
| A2 | 13/46 | 15/43 | 32/40 |
| A3 | 29/65 | 26/66 | 39/59 |
| A4 | 6/69 | 29/71 | 39/57 |

**Verdict.** The fresh repair did diversify low and oblique constructions, and it improves on critic round 2's pre-repair count of only 22 explicit camera choices. It still does not resemble liked's camera register. A4 is the clearest unresolved risk: 8.7% explicit fresh versus 68.4% liked. Because Daniel already said the vantage-unlocked v2 renders missed majorly, this is not proposed as the sole cause; it is evidence that the final repair did not preserve the full liked-era camera distribution.

### Palette-word profile

Top shot-presence words:

| Rank | FRESH | V2-ERA | LIKED-ERA |
| ---: | --- | --- | --- |
| 1 | cream 126 (51.4%) | cream 235 (95.5%) | grey 87 (40.7%) |
| 2 | charcoal 58 (23.7%) | teal 127 (51.6%) | warm 62 (29.0%) |
| 3 | red 55 (22.4%) | charcoal 112 (45.5%) | amber 43 (20.1%) |
| 4 | muted 42 (17.1%) | grey 81 (32.9%) | green 41 (19.2%) |
| 5 | tobacco 33 (13.5%) | warm 48 (19.5%) | cold 36 (16.8%) |
| 6 | amber 27 (11.0%) | red 44 (17.9%) | red 35 (16.4%) |
| 7 | teal 27 (11.0%) | cool 38 (15.4%) | white 34 (15.9%) |
| 8 | warm 26 (10.6%) | cold 33 (13.4%) | cream 33 (15.4%) |
| 9 | clay 24 (9.8%) | amber 29 (11.8%) | brown 32 (15.0%) |
| 10 | brown 23 (9.4%) | green 22 (8.9%) | cool 28 (13.1%) |

**Verdict.** The reset breaks v2's cream/teal/charcoal near-lock and adds more object-motivated tobacco, clay, rust, ochre, and walnut. It still has a narrower repeated top than liked: half of fresh says `cream`, while liked's warmth is expressed through a broader object-color vocabulary and allows meaningful cold turns. “Warm-biased” has become less oppressive than v2, but it remains a global tail instruction in current dispatch and therefore cannot be treated as only a per-shot choice.

### Prompt-length distributions

| Era | Unit | Min | P10 | P25 | Median | Mean | P75 | P90 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| FRESH | chars | 225 | 305 | 354 | 406 | 408 | 466 | 508 | 675 |
| V2-ERA | chars | 293 | 353 | 387 | 429 | 462 | 494 | 625 | 899 |
| LIKED-ERA | chars | 222 | 305 | 387 | 468 | 500 | 592 | 741 | 1064 |
| FRESH | words | 35 | 44 | 51 | 61 | 61.4 | 71 | 79 | 97 |
| V2-ERA | words | 42 | 55 | 60 | 69 | 73.0 | 79 | 102 | 150 |
| LIKED-ERA | words | 37 | 47 | 60 | 73 | 78.4 | 93 | 115 | 174 |

Per-act word median / mean:

| Era | A1 | A2 | A3 | A4 |
| --- | ---: | ---: | ---: | ---: |
| FRESH | 57 / 56.1 | 70 / 70.4 | 56 / 57.6 | 66 / 64.0 |
| V2-ERA | 76.5 / 84.5 | 71 / 73.4 | 67 / 68.8 | 63 / 66.1 |
| LIKED-ERA | 98 / 103.1 | 80 / 80.2 | 63 / 65.1 | 67 / 65.6 |

On the 202 fresh beats that align within three narration words to one prompt in both other eras, mean prompt length is 65.1 words fresh, 81.2 v2, and 84.5 liked; fresh is shorter than liked on 144/202 beats, equal on 4, and longer on 54. On non-deltas alone, medians are 73 fresh, 77 v2, and 87 liked.

**Verdict.** “Liked left more to the engine because it was shorter” is false. Liked is longest, especially in A1. The useful distinction is what its length buys: world inventory and a decisive frame description, not ratios or a repeated compliance recipe. A3/A4 length alone is almost converged, so length cannot be the doctrine rule by itself.

## 2. Prompt register — ten same-beat triplets

The triplets below start on the same script word in all three corpora. Length is `characters / words`; `S` means standalone.

### Triplet 1 — A1 era opening

| FRESH L01 — 432 / 67, base | V2 L01 — 696 / 109, base | LIKED L01 — 866 / 134, base |
| --- | --- | --- |
| A two-level suburban mall opens beneath a broad ribbed skylight, its cream terrazzo concourse bending past oak kiosks and a sunken planter court. Period shoppers occupy several distances between balcony rails and shop portals, with the nearest group below kiosk height and the far groups reduced by the architecture; mustard, rust, cream, and muted teal sit under amber fixtures while electronics windows supply the only cool light. | `pc-boxy`, `expr-delighted`, planted centre on a low walnut-veneer table, stubby arms out to the sides. Seen from shag-carpet level looking slightly up, so the machine reads enthroned over the room: foreground the thick mustard shag running to the frame edge with the near couch arm cropping the lower-left corner, midground the low table carrying pc-boxy flanked by a fat orange lava lamp stage-left and a chunky silver boombox stage-right, background a brown corduroy couch and the picture rail running along a wall left completely blank. Warm lamp amber from a domed table lamp pooling across the shag, mustard-brown-cream palette throughout, the single red accent on the machine's power stud. | `pc-boxy`, a personified beige boxy 1980s home computer with the cast's cartoon eyes and mouth set into its front panel and short stubby arms and legs, `expr-smug`, `action-powerstance`, planted centre frame on a laminate desk and facing the viewer. A 1980s suburban den in late-afternoon amber light: dark walnut-panelled walls, a burnt-orange shag rug across the whole floor, a chunky wood-veneer television standing on the rug mid-ground stage-right, a leaning stack of cassette tapes on the desk beside the machine, a net-curtained window behind. Mustard, walnut and burnt-orange scene palette. Wide eye-level framing with the desk raised so the small machine sits higher than every other object in the room; depth reads rug foreground, desk mid-ground, panelled wall and window background, filled edge to edge. Every surface in the room is blank and unlettered. |

**Liked-register read.** It is the longest and most explicit, but the instructions form one familiar den. Character, object inventory, palette, wide camera, scale relation, and depth order are given in that sequence. V2 invents a more novel low angle but spends its middle on plane labels and crop mechanics. Fresh leads with the world and concrete architecture, a real improvement, but omits a camera decision.

### Triplet 2 — A1 buying craze

| FRESH L06 — 271 / 37, delta | V2 L06 — 759 / 130, S | LIKED L07 — 562 / 89, delta |
| --- | --- | --- |
| `pc-boxy`, `expr-deadpan`, the demonstration bench, mezzanine stair, repair counter, and window bay hold their positions. Separated purchase gaps now break through the boxed beige stock on the back-wall shelving; only this changes; everything else exactly as established. | A `prop-beige-pc` unit alone on a lit turntable plinth, front panel to the viewer. Seen from just behind the plinth looking out, as if from the display's own vantage: foreground the plinth edge and warm display light pool around the unit; midground the full-height plate window, a broad pavement strip, a row of parked bicycles and a lamp post crossing it; background at the far side of that street geometry, a queue of hopeful buyers runs back along the shopfront and out of frame at the far end, each rank clearly smaller and more overlapped than the one before it, faces open and hungry. Cream-amber-warm-grey palette, the plinth light dominant, flat cool daylight confined to the street. Far more people out there than the one small machine on the plinth. | The same shop interior, same locked framing: the beige computer half-buried in its prised-open crate on the felt plinth with straw spilling over, pine shelving, the counter with coiled cables, terrazzo floor, '1983' lettered on the card propped square to camera on the counter. Only this changes: the street outside is now packed with a dense press of onlookers crowding the window from the pavement, shoulder to shoulder and three deep, palms and coat sleeves flattened against the pane, dimming the daylight behind them; everything else exactly as established. |

**Liked-register read.** Liked keeps the parent but restates the visible set with tactile nouns, then makes one concrete transformation—bodies and sleeves flattened against glass. V2 explains the scale argument correctly but builds it through a long authored camera proof. Fresh is much shorter and turns demand into “purchase gaps,” a visually readable abstraction but less human and less immediately spectacular.

### Triplet 3 — A1 125-million growth

| FRESH L36 — 391 / 59, delta | V2 L36 — 459 / 72, S | LIKED L32 — 422 / 66, delta |
| --- | --- | --- |
| `miniscribe-rep` and `ibm-suit` remain across the diagonal table on one plane, at one eye-line and matching head scale, with the low contract folder, winter window panes, teal chairs, oak panels, and four closed binders unchanged. A warm-gold revenue block now rises at the table's center bearing the supplied literal '125 MILLION'; only this changes; everything else exactly as established. | `miniscribe-rep`, `expr-greedy`, `action-powerstance`, planted on top of a banded bale of banknotes the size of a car that fills the centre of the frame. Two smaller bales sit stage-left and stage-right at half its height on a flat cream ground, charcoal-cream-green palette, even frontal light, foreground depth from a cropped bale corner across the bottom of the frame. The wide paper band strapping the big bale carries the stencilled figure '125 MILLION'. | The same plant-office floor, same locked framing: `miniscribe-rep` on top of the stack of four shrink-wrapped cash bales widening as it rises, grey office wall with its high window, the metal desk stage-left, cool daylight from stage-right, banknote green and warm tan against office grey. Only this changes: the plain paper band round the lowest bale is now lettered '125 MILLION'; everything else exactly as established. |

**Liked-register read.** Liked spends the frame on one object-scale idiom: a widening cash-bale stack in an ordinary plant office. Fresh preserves the contract scene and adds an abstract “revenue block,” so the amount is chained into continuity rather than earning its own instantly legible scale object. V2 is closest to liked's idiom here but removes the working world for a flat ground.

### Triplet 4 — A2 fear regime

| FRESH L66 — 612 / 97, base | V2 L67 — 522 / 80, S | LIKED L60 — 683 / 101, base |
| --- | --- | --- |
| `qt-wiles`, `action-powerstance`, `expr-deadpan`, stands behind the far return of the honey-oak desk, facing front with the telephone below his shoulder and the empty upper pane of the far window surrounding his head. The established Los Angeles office turns around him through two tall window bays, a low credenza, the desk peninsula, and the palm-lined view beyond the glass; the window mullions rise well above him and late-afternoon light leaves most of the room under his gaze. Cream, oak, olive, and charcoal remain restrained. One man holding the remote office from its deepest corner is the fear payload. | `qt-wiles`, `expr-smug`, `action-armscrossed`, standing dominant and enormous across the left half of the frame, his shoulders leaving the top border. On the far side of a full-height glass partition behind him a small crowd of office figures stands frozen at their desks, shoulders pulled in, faces worried, every one of them a fraction of his height. Charcoal-teal-cream palette, one hard low light from stage-left throwing his shadow across the partition, foreground depth from a cropped desk corner at the lower-right. | `qt-wiles` (`expr-deadpan`, `action-powerstance`) stands at the head of a long walnut conference table facing `brick-foreman` (`expr-worried`, `sit`), who sits at the near end in clear three-quarter view with his face unobscured across the tabletop. The executive crowd occupies the rear zone beyond the table's far side, behind a glazed partition, visible between a credenza of binders and amber wall lamps. Framed audit charts, a coffee tray and oxblood leather chairs make the boardroom active. Palette is tobacco brown, oxblood leather, brass gold and hard lamp amber. Eye-level medium-wide framing holds Wiles, the foreman's visible face and the separated rear meeting together. |

**Liked-register read.** Liked puts fear into a relationship—Wiles, worried foreman, executive room—and closes on a medium-wide camera that contains all three tiers. Fresh has stronger architecture than v2 but ends with authorial interpretation (“is the fear payload”) instead of another visible fact. V2 makes the scale assertion literal but reduces the people and world to a glass-partition diagram.

### Triplet 5 — A2 warehouse count

| FRESH L85 — 424 / 61, delta | V2 L85 — 721 / 118, S | LIKED L78 — 761 / 120, base |
| --- | --- | --- |
| The forklift turning circle, personnel doorway, bridge crane, stocked portals, pallet stacks, and planted audit team hold their established positions beneath the clerestory light. A waist-high counting table now occupies the empty service bay beside the doorway, carrying a blank ledger, pencil cup, and adding machine with every glyph surface plain and unlettered; only this changes; everything else exactly as established. | `auditor-rep`, `expr-thinking`, `point-at-thing`, standing centre at body scale on a flat cream ground, pointing down at the open ledger stage-left with his eye line following his own arm to it. Stage-left beside him a lectern carries that ledger blown up to twice his height, its columns ruled but blank and unlettered; stage-right a shelf bay holds six identical sealed cartons at that same outsize scale, so paper and goods stand as two comparable masses either side of one man. A single taut charcoal cord runs level from the foot of the ledger's column across the frame to the front edge of the shelf. Charcoal-cream-teal palette, even frontal light, foreground depth from a cropped shelf upright at the lower-right. | The MiniScribe warehouse aisle holds a waist-high inspection cart between cold-grey steel racks, their plain boxed inventory receding softly behind it under fluorescent light. One `prop-drive` unit lies alone on the left half of the cart beside an open blank audit ledger on the right and a plain pencil between them. Palette is charcoal grey, dull steel, pale paper and cold blue-white light. Tight three-quarter framing at cart height, with the single drive and ledger equally dominant; depth reads cart foreground, near racks mid-ground, receding aisle background. The open ledger has exactly one short vertical ink tally stroke directly opposite the single drive; every other part of both pages, the cart surface and every rack label is bare and unlettered. |

**Liked-register read.** Liked is highly specified, but all specification serves a single cart-height comparison between one drive and one tally. Fresh has a stronger real warehouse than v2, yet as a delta its primary visual action is adding a generic counting station. V2 is longest and most diagrammatic, with scale, cord, stage labels, and a flat ground all proving the concept.

### Triplet 6 — A3 managers' plan

| FRESH L112 — 470 / 74, base | V2 L110 — 472 / 76, S | LIKED L100 — 606 / 89, base |
| --- | --- | --- |
| Viewed from the planning room's window gallery, a long diagonal table cuts across the parquet below while tall sash windows, file alcoves, and an untouched sweep of floor establish the Colorado office. Worried middle managers in late-1980s shirts and muted ties gather tightly at the table; smaller tense clusters hover under the windows and between chair backs. Every body angles toward one blank sheet at the table's center, making the collective decision the payload. | A tight ring of shirt-sleeved figures leaning in over a round table until their foreheads actually touch above the tabletop in one closed ring, eyes down, absorbed, shoulders hunched right around the table so no face is readable. A windowless back office behind them: stacked chairs stage-right, a dead pot plant in the corner. Cream-teal-charcoal palette, one low pendant hung directly over the ring of heads, foreground depth from a cropped chair back at the lower-left. | `brick-foreman` (`expr-worried`) and `qt-wiles` (`expr-smug`, `action-armscrossed`) lean across a walnut office table with their heads close over one blank sheet of paper, two cold coffee cups and two inward-angled pens. A crowd of late-1980s managers waits at the edge of the meeting, with filing cabinets, green banker lamps, open binders, a rolling chart stand and venetian-blind light filling the office. Palette is walnut brown, bottle green, cream and amber. Eye-level medium framing makes the two conspirators and their waiting management room legible. Paper and binder-label glyph fields are blank. |

**Liked-register read.** Fresh is the strongest current-world example: it invents gallery, diagonal, parquet, alcoves, clusters, and one shared sheet. Liked is less spatially spectacular but more specific about story-bearing relationships and the medium camera. V2's heads-touch gag is concrete but compresses the world to a ring, a plant, and a crop.

### Triplet 7 — A3 bricks into boxes

| FRESH L118 — 479 / 70, base | V2 L118 — 506 / 79, base | LIKED L107 — 651 / 99, base |
| --- | --- | --- |
| A body-scale side view crosses a packing bench beneath steel trusses, with an open carton fixed under a task lamp, finished cartons stacked in square wall cubbies, and a roller shutter beyond the benches. `brick-foreman`, `action-present`, `expr-worried`, stands three-quarter right against the pale shutter, presenting the open carton; a rust-red brick is already seated fully inside it, visible between the folded flaps. The completed brick-in-box state bears the packing beat. | `brick-foreman`, `expr-deadpan`, `hold-one-hand`, stage-left, lowering a red clay brick in one hand into an open carton on a long trestle bench. On the far side of that bench a working crowd of shirt-sleeved figures does the same down its whole length, heads bent, moving fast and cheerful. The rented unit behind them: bare concrete, corrugated walls, the roller shutter half up. Grey-red-cream palette, one daylight shaft from the shutter, foreground depth from a cropped carton stack at the lower-right. | `brick-foreman` (`expr-deadpan`, `hold-one-hand`) directs a busy late-1980s warehouse crew along a long packing bench in a rented warehouse. Three open cartons run along the bench, each with one red clay brick already seated in a drive-shaped foam recess, while workers fit foam and fold flaps nearby. Corrugated walls, stacked packing paper, a hand trolley, clipboards and amber work lamps give the line practical texture. Palette is terracotta red, corrugated tan, bottle green and warm bulb amber. Eye-level medium-wide side view keeps the foreman, carton row and active crew in one working scene. Carton-label and clipboard glyph fields are blank. |

**Liked-register read.** All three are concrete. Liked adds the highest practical work density—three countable cartons, foam, folding workers, paper, trolley, clipboards, lamps—and names a medium-wide side view. Fresh correctly closes the old cause/effect defect by showing the brick already seated, but makes the foreman present a single completed state; it is quieter and more posed. V2 freezes an in-progress lowering action and uses the familiar crop/rear-crowd chassis.

### Triplet 8 — A3 shipping sales

| FRESH L128 — 477 / 77, base | V2 L128 — 497 / 72, base | LIKED L116 — 432 / 69, base |
| --- | --- | --- |
| From the truck apron, a low diagonal view looks up a raised loading ramp toward six warehouse doors and a side mezzanine under open sky. One wrapped pallet waits at the ramp lip in the foreground while trucks occupy the farther doors. `qt-wiles`, `point-at-thing`, `expr-smug`, stands above on the mezzanine, three-quarter toward the camera against a pale wall, his held point targeting the pallet at the threshold. Ramp, door, and pallet turn shipment into a visible crossing. | `brick-foreman`, `expr-deadpan`, `point-at-thing`, stage-left at the open roller shutter, pointing a box truck back onto the loading edge. On the far side of the truck's raised tail a loading crowd walks wrapped pallets aboard, brisk and businesslike. The rented unit behind: bare concrete, corrugated walls, the long row of wrapped pallets waiting. Grey-cream-amber palette, hard daylight through the shutter against dim interior, foreground depth from a cropped pallet corner at the lower-right. | A flat top-down world plan on a parchment-cream background: warm ochre landmasses on pale blue water. One shrink-wrapped pallet icon sits parked inside a small warehouse-square icon on the North American west coast, the sea and land around it left plain and unmarked. Warm ochre, parchment cream and pale sea blue. Straight top-down framing with the plan filling the frame edge to edge. Every landmass is left completely unlabelled. |

**Liked-register read.** Liked takes the largest conceptual departure: it makes the sales premise a simple top-down map with one pallet icon and much plain space. Fresh invents a strong cinematic loading world and low diagonal camera, but it is another performed built-world scene. This triplet exposes the shot-class shift: liked uses a graphic symbolic reset where fresh maintains physical narrative continuity.

### Triplet 9 — A4 papers break the story

| FRESH L177 — 455 / 81, base | V2 L176 — 460 / 78, S | LIKED L159 — 513 / 79, base |
| --- | --- | --- |
| A narrow Denver breakfast room opens from a tall window at left to a scarred oak table at right, its chair backs and wall shelves giving the room clear depth. On the table, a spread newspaper sits in a pool of winter light beside a cooling coffee cup; its columns are short dark unreadable rules and its single large illustration shows a red clay brick inside a hard-drive carton. Newsprint cream, honey oak, clay red, and charcoal hold the exposure beat. | A running newspaper press seen from the floor of a press hall, its folded papers spilling down a chute in a blur of stacked paper, their front pages ruled into columns but completely blank and unlettered. Rollers and reels of newsprint run away behind it under a steel gantry, an ink-stained apron hung over a rail beside the chute. Charcoal-cream-teal palette, one hard work lamp over the chute, foreground depth from a cropped paper stack at the lower-right. | A deserted newspaper pressroom stands mid-run: a long printing press throws out a steady stream of folded papers onto a growing stack, each paper's masthead panel a plain uniform dark band. Industrial overhead light, ink-black rollers. Palette is newsprint grey, ink black and steel. Wide flat framing at press height with the stream of papers filling the lower half of frame; depth reads paper stack foreground, press rollers mid-ground, pressroom background. Every paper's own headline is left completely blank. |

**Liked-register read.** Fresh makes the news intimate and world-specific, with a breakfast room and a brick illustration. Liked is simpler, wider, and process-led: one press, one paper stream, one explicit press-height frame. V2 has nearly the same subject as liked but adds the habitual low-floor, cropped-foreground depth recipe.

### Triplet 10 — A4 judge reversal

| FRESH L207 — 447 / 68, base | V2 L207 — 669 / 101, base | LIKED L185 — 410 / 66, base |
| --- | --- | --- |
| `trial-judge`, `sit`, `expr-deadpan`, sits fully supported against a high-backed oak chair behind the bench, facing forward. A tall apse of pilasters and winter windows rises behind him, the chair back isolates his head from the clockwork above, and one cream verdict document rests upright within reach on the otherwise bare bench. Black-brown robe, dark oak, parchment, muted brass, and cool window light establish the judge before the reversal. | `trial-judge`, `expr-deadpan`, `hold-one-hand`, seated high behind the timber bench stage-right in a black judicial robe over a white wing collar, full-rim reading spectacles low on the nose, close-cropped white hair, jowly build, one hand resting flat on the bench top. Behind him the wastepaper basket stands overflowing with a thick tied bundle of papers rammed into it, loose sheets spilled across the floor around its foot. The courtroom as established: the empty jury box stage-left, counsel tables in the midground, gallery pews toward the viewer. Cream-oak-teal palette, cold daylight from stage-left, foreground depth from a cropped pew back across the bottom. | The same grand courtroom, now standing completely empty, the jury box bare, the bench empty, cold flat daylight through a high window replacing the earlier dark and shaft of light. A single wooden gavel rests still on the bench, undisturbed. Palette is cold pale daylight, bare wood and empty dark panelling. Wide symmetrical framing matching the earlier composition, the room now drained of its glow entirely. |

**Liked-register read.** Liked lets the empty world carry the reversal. It is the shortest prompt in the triplet, uses no figure, and spends its final sentence on wide symmetry and a palette-state turn. Fresh repairs support geometry and disclosure timing, but it is a judge-establishing base whose reversal arrives in later deltas. V2 over-specifies the judge and adds a paper-bin gag before the line completes.

### What the ten triplets establish

| Register question | Evidence-backed answer |
| --- | --- |
| Is liked shorter? | No. It is longer overall and longer on 144/202 aligned beats. |
| What leads? | Liked begins with scene articles on 150/214 shots (70.1%) and cast slugs on 62/214 (29.0%). Fresh is 112/245 (45.7%) and 91/245 (37.1%); v2 is 68/246 (27.6%) and 170/246 (69.1%). |
| What does liked specify? | Familiar setting objects, one clear action/object relation, palette, then camera/distance. It explicitly says `framing` on 165/214 shots. Fresh says it on 0/245; its camera appears through constructions such as “viewed from” but only 63 prompts meet the broader vantage test. |
| Does fresh lack concrete world objects? | Not relative to v2. A conservative 79-noun environment lexicon averages 4.13 unique matches per fresh prompt, 3.20 v2, and 3.60 liked; in A2/A3/A4 fresh is 4.17/3.72/4.57 versus v2's 3.58/2.80/3.03. Fresh's world-building is an improvement, not the remaining primary defect. |
| What scale idiom does liked use? | Camera-distance and a single object relation: “wide eye-level,” “tight three-quarter at cart height,” “medium-wide side view,” a raised desk, one drive opposite one tally, one map icon in open land/sea, an empty wide courtroom. It rarely uses numeric figure fractions. |
| What does fresh leave to the engine? | Less at the continuity level: 109/245 shots carry the exact one-change coda, versus 70/214 liked and 44/246 v2. More at the camera level: most fresh prompts do not state a camera. That is the inverse of liked's balance. |
| Is v2's problem just length? | No. V2 is nearly liked-length but leads with cast 69% of the time, uses spatial labels on 223/246 prompts, and repeatedly proves depth through crop/rear geometry. The organization of detail, not count alone, differs. |

**Register verdict.** Liked is a **directed scene brief**: high world specificity, one decisive graphic relationship, an explicit camera, and a scene/payload close. V2 is a **construction proof**: cast first, then authored plane/crop/recession mechanics. Fresh is a **continuity-safe world description**: better concrete places and positive geometry, but more shots subordinated to parent preservation, more literal/ironic built worlds, less camera closure, and—after file authoring—an appended generic style tail. The actionable delta is therefore not “write less”; it is **move specificity from compliance/continuity and into one complete scene-camera gestalt, then let that gestalt close the provider prompt**.

## 3. Acts 2–4 — fresh reset versus v2-era at scale

This is the territory Daniel explicitly requested: no L01–L25 hand-tuning history, and no inference that an opening-slice fix automatically transmits through the rest of the run.

### Quantitative comparison

| Act | Era | Shots | Stages / multi-shot chains / standalones | Figureless | Crowd | Explicit vantage | Median words | Mean distinct environment nouns |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| A2 | FRESH | 46 | 20 / 16 / 2 | 10 (21.7%) | 13 (28.3%) | 13 (28.3%) | 70 | 4.17 |
| A2 | V2 | 43 | 13 / 5 / 25 | 3 (7.0%) | 9 (20.9%) | 15 (34.9%) | 71 | 3.58 |
| A3 | FRESH | 65 | 29 / 19 / 7 | 19 (29.2%) | 7 (10.8%) | 29 (44.6%) | 56 | 3.72 |
| A3 | V2 | 66 | 21 / 11 / 33 | 10 (15.2%) | 23 (34.8%) | 26 (39.4%) | 67 | 2.80 |
| A4 | FRESH | 69 | 30 / 17 / 14 | 16 (23.2%) | 15 (21.7%) | 6 (8.7%) | 66 | 4.57 |
| A4 | V2 | 71 | 18 / 13 / 38 | 7 (9.9%) | 23 (32.4%) | 29 (40.8%) | 63 | 3.03 |

### Improvements the full rerun produced

1. **The reset transmitted chain coherence beyond A1.** A2–A4 named stages increase from 52 v2 to 79 fresh, multi-shot chains from 29 to 52, and standalones fall from 96 to 23. This directly addresses v2's reset-every-shot behavior. Representative fresh A2 L84–L85 holds one warehouse geometry across the planted audit team and the added counting station; v2 L85 rebuilds the concept from scratch on a flat cream ground.
2. **World concreteness improved at scale.** The conservative environment-noun mean rises in every act: A2 3.58→4.17, A3 2.80→3.72, A4 3.03→4.57. Fresh L170 uses mezzanine, exit ramp, doors, assembly bays, railings, and beam; v2 L169 uses benches, tote racks, an aisle, a hatch, and the repeated cropped bench end. The reset's “world with people in it” instruction did transmit.
3. **Population pressure fell toward the liked distribution.** Figureless share rises A2 7.0→21.7%, A3 15.2→29.2%, A4 9.9→23.2%. Fresh A2 now matches liked A2 almost exactly (21.7% versus 22.5%). V2's 90%+ figure rate in A2/A4 is gone.
4. **V2's repeated staging chassis was actually removed.** Across A2–A4, v2 uses `cropped` in 148 prompts and `foreground` in 148; fresh uses `cropped` in 2 and `foreground` in 7. V2 uses row/lane/aisle in 36; fresh uses it in 0. This is not a synonym swap: fresh substitutes chamber arcs, threshold portals, table diagonals, truss naves, landings, balconies, ramps, and apse/window structures.
5. **Palette pressure eased materially.** `cream` appears in 173/180 v2 A2–A4 prompts (96.1%) versus 92/180 fresh (51.1%). A2 changes from cream/teal/charcoal/grey dominance to cream/tobacco/charcoal with red/ochre tied to quotas and missing inventory; A3 introduces clay/rust and motivated cool; A4 uses courthouse oak/parchment/charcoal but with more zone-specific objects.
6. **Depiction-class variety shifted toward mechanisms and environments.** Fresh adds `register-shift-infographic` (12 versus v2 1), `map-plan-view` (7 versus 1), and `staged-interaction` (22 versus 11), while reducing reaction shots (6 versus 30) and personified-character shots (16 versus 25). This closes some v2 performative-cast overuse.

### Risks and gaps created or left by the reset

1. **Chain-as-default may have overshot.** Fresh A2 has only 2 independent standalones. Across A2–A4, 78/180 shots are deltas (43.3%) versus v2's 32/180 (17.8%) and liked's 54/156 (34.6%). A chain preserves continuity, but it also preserves the parent's camera, palette, and spatial premise; the file now has fewer opportunities for a graphic reset like liked L116's top-down pallet map or liked L185's empty wide courtroom.
2. **The liked depiction mix was not recovered.** Whole-file class counts:

   | Class | FRESH | V2 | LIKED |
   | --- | ---: | ---: | ---: |
   | `literal` | 43 | 35 | 6 |
   | `ironic-counterpoint` | 59 | 42 | 35 |
   | `symbolic-stand-in-object` | 4 | 10 | 32 |
   | `reaction-shot` | 6 | 30 | 24 |
   | `number-glued-to-object` | 5 | 8 | 15 |
   | `physicalized-imbalance` | 36 | 27 | 27 |

   Fresh A4 alone has 25 ironic-counterpoints (36.2%) and only 1 reaction shot. The reset produced more sophisticated worlds, but it also converged on a built-world ironic/literal register far from liked's symbolic/reaction/number counterweights.
3. **A4 loses authored cameras after the systemic repair.** Fresh A4 has 6/69 explicit-vantage prompts; v2 has 29/71 and liked 39/57. The absence is visible in the triplets: liked L159 ends “Wide flat framing at press height”; fresh L177 ends on color and “hold the exposure beat.” This is a post-reset coverage gap, not the old fixed claim that eye-level was locked.
4. **Some pixel prose now contains authoring interpretation.** Six fresh prompts say `payload`, two say `beat`, and eight say `supplied literal`; 16 prompts contain at least one of `payload|beat|registered|supplied|cited|literal`, versus 0 v2 and 5 liked. Examples include L66 “is the fear payload,” L112 “making the collective decision the payload,” and L118 “bears the packing beat.” Those words do not describe pixels and occupy the final sentence where the engine should receive the visible consequence.
5. **The palette is freer than v2, but still tokenized.** Half of fresh says `cream`, nearly a quarter `charcoal`, and A4 says cream 43/69 and charcoal 37/69. Liked is not palette-free; it simply distributes temperature and object colors more broadly. A doctrine follow-up should not add a new approved palette list.
6. **Fresh is closer to liked on people but still denser in A3/A4.** Figure-bearing remains 70.8% fresh versus 62.7% liked in A3, and 76.8% versus 61.4% in A4. This is not an instruction to remove people by quota; it identifies where the shot-class/chain audit should look for object, aftermath, map, or empty-world beats whose actual subject is not a person.

### Critic-round monotony and capped-loop story

| State | Cadence | Dominant monotony | What else failed/passed |
| --- | --- | --- | --- |
| Critic r1, 243 shots | 115/243 real holds out of band: 73 below 1.5s, 21 over 3s, 21 over 4s; 27 deltas longer than bases; L243 8.88s | `cropped` 218, `foreground` 219, recession family 174, full crop+plane+recession chassis 114; warm 235, amber 167, `warm cream` 131; 72 declared `2.3s`, including 65 consecutive L112–L176 | REJECT. Wrong human subjects, early disclosures, broken chains, and missing family beat; two-figure topology passed. |
| Critic r2, 243 shots | Planned mean 2.23s; only L112/L113 over 4s by declared plan; assembly still measured L243 at 9.4s | Old crop/recession tic gone, but replaced by 73 scale-signature prompts, 55 `frame height`, 32 one-fifth variants, and aisle/lane/row in 125/243; only 22 explicit cameras, 0 close/detail | REJECT. Disclosure, human balance, semantic cast, and most chains converged; PLAN-01 systemic staging and L243 remained blockers, plus localized scene/chain defects. |
| Current capped repair, 245 shots | Read-only lint: 6 real-hold outliers (L36 3.10s, L38 1.31s, L112/L113 4.14s, L207 0.97s, L244 1.48s), 30 delta-longer-than-base notices, 3 seated-support review rows | `frame height` 0, fraction scale 0, recession 0, row/lane/aisle 0, `cropped` 2, `foreground` 7; explicit cameras recover to 63 | L243 is split across L243–L245; r2 localized items are visibly re-authored. No third independent critic was run because the loop was capped. |

**What converged.** Real cadence defects fell from 115 to 6; the 9.4-second final hold was split; disclosure order, two-figure topology, semantic cast, and the named broken action chains were repaired; the old and replacement monotony phrase families both went to approximately zero; v2's cream/teal/charcoal lock loosened; figure balance and world-object density moved toward liked.

**What the capped loop left.** The final two-shot addition and systemic prompt rewrites have no third fresh-context critic. Current A4 camera coverage, chain overuse, class mix, palette token concentration, and the 16 authoring-language prompts are therefore new unadjudicated surfaces. More importantly, neither critic rendered the fresh prompts: delivered ratio, painterly/atmospheric depth, and tail-order effects remain completely open. The capped loop is clean on its measured authoring targets; it is not a taste proof.

## 4. Image-generation pipeline changes across the arc

### The liked full run: what actually reached the engine

The full liked generation was committed at `309b341b` from the 215-shot corpus authored at `38e04261`; 42 slice frames were carried byte-identical. The run record says 354 generations, concurrency 4, 3 act batches, 187/215 verified, 109/120 retry flags fixed, 31 parked, and $47.44 spend.

Load-bearing code fact:

```text
309b341b assemble_prompt:
descriptor -> still_prompt/delta -> figures expansion -> RIG-HOLD
```

The function had no `suffix` parameter. Its comment claimed the shot's `global_prompt_suffix` “rides inside the still_prompt,” but the 215-shot prompts—including L01 inspected above—do not contain the stored suffix. Thus the stored 35-word suffix was not separately appended by this forge path. Figure-bearing shots could still end in the rig block; cast-free shots ended on the authored scene.

The liked generation also differed in these dispatch mechanics:

- Default request size was 2K. This is documented but not treated as a taste cause because Daniel explicitly ruled out resolution.
- The skill required a style anchor for environment/plate/composed-scene work, preferring the target/prior frame, then a register-matched `refs/env/` anchor, then an approved scene. There was no universal `scene-style-tile` role.
- Every crowd-bearing generation seeded `crowd-exemplar`; its job was anonymous crowd proportion and face tier.
- Review ran in three act batches with an escalation model: ordinary-viewing-scale judgment first, crop evidence only after a judge flagged a suspected rig defect. The full run used multiple review dispatches and one surgical retry wave.

### Post-liked changes and current state

| Point in arc | Suffix / prompt order | Tile and exemplar grant | Review and orchestration |
| --- | --- | --- | --- |
| LIKED full run (`309b341b`, 2026-07-30) | Stored 35-word suffix not appended by forge. Style descriptor at head; authored scene before figure/rig policies and payload-last on cast-free shots. | Contextual style anchors for composed scenes; crowd exemplar on crowd shots. Default 2K. | 3 act batches; concurrent generation; escalation review; crops only after suspicion; one retry wave. |
| `30d2b7e8` code snapshot (2026-08-04, after liked pixels) | Still no suffix slot. A `HARDENED_SCENE_STYLE` block followed the head descriptor; authored payload moved to the final assembled position. | Place/approved-scene anchors; crowd exemplar. | One fresh-eyes pass per act batch; ordinary-scale named-figure comparisons; crop battery retired in this later snapshot. |
| Era restoration `d1f771a7` (2026-08-05) | Deleted the hardened third voice; restored two voices: §2b at head and file suffix at tail. Default 2K→1K. | Registered `scene-style-tile`; it seeds cast-free scenes and is explicitly not a place/layout/content source. | Existing act-batch review retained. |
| Tile repair `ea71f99e`, then `33676421` | Tail kept. `33676421` also changed VPW doctrine toward chain default and unlocked vantage. | Tile grant changed from vague palette discipline to saturation (`ea71f99e`), then saturation **and temperature** (`33676421`). Figure-bearing scenes do not take the tile because cast seeds are supposed to carry register. Crowd exemplar remains. | `33676421` changes Pass 2 from sequential act batches to parallel disjoint partitions/waves, with chains kept whole and coordinator-only stamping after merge. |
| V2 residual cycle `f8aa5e52` + application notes | Current 80-word suffix removes `built-but-flat environment`, `minimal geometry + one foreground depth prop`, and `locked 2–3 colour`, but still closes every prompt with house style, warm bias, semantic red, negative exclusions, and 16:9. §2b restores “simple flat colours with gentle soft cel shading.” | Textual crowd exemplar is restaged with foreground geometry and overlapping groups. Tile still grants line weight, outline color, flat-cel render, saturation, and temperature—nothing about content/layout/camera. | Style/taste review distinguishes edge-to-edge environments from full-silhouette/air standalone props. A machine-emitted `lettering-register` row is added for every quoted-literal shot, separate from spelling DSG. |

### What the log after `33676421` actually exercised

| Commit | What ran | Relevance to A2–A4 |
| --- | --- | --- |
| `573414b7` | Re-authored A1 L01–L27 under the August 18 doctrine. | Prompt work only; no evidence about later acts. |
| `693b0fff` | Generated the complete L01–L25 slice; 25/25 verified, three parallel workers, chains kept whole, one new rival-PC canonical, about $2.8 estimated. | Proves the repaired run mechanics on the opening slice only. |
| `f8aa5e52` | Applied the residual doctrine cycle: suffix de-recipe, §2b era phrase, crowd exemplar/grammar repair, review-row changes, and nine prompt replacements. | Changes every future assembled prompt but still supplies no A2–A4 pixel result. |
| `712c8a4a` | Generated the ten-shot v2 comparison; 10/10 verified after L03/L07 engine-drift retries and a `drive-maker` Step-1 remint. | This is the run Daniel judged “a little better” but still majorly wrong; it proves the fixes were insufficient, not that they were ineffective. |
| `c094d26c` | Replaced the full file with the 245-shot clean VPW rerun after two critics and a capped repair loop. | Authoring evidence only. No fresh A2–A4 frames were generated by this commit. |

**Verdict.** Since the taste ruling, pixels have been tested only on the opening slice and the ten-shot v2 set. The new A2–A4 prompt behavior—where chaining, class mix, A4 camera omission, and new palette distribution are most visible—has never reached an image gate.

### Suffix comparison

| Era file | Stored suffix | Dispatch fact |
| --- | --- | --- |
| FRESH | 535 chars / 80 words | Appended after every scene payload by current forge. |
| V2-ERA | 535 chars / 80 words | Byte-identical to fresh in the archived file. |
| LIKED-ERA | 251 chars / 35 words | Present in the file, but the actual full-run forge code had no suffix slot and the prompt did not bake it in. |

Current tail:

> Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm brown-black (#241a12) outline on everything, flat cel colours with gentle soft shading, rounded friendly shapes, no realistic detail; any in-world lettering hand-lettered in the marker style, short and legible; warm-biased scene palette plus the single red accent #d7402b used only semantically (alarm / prohibition / ownership / the last punch element); no photorealism, no on-screen narrator or host face, no unrequested text, no logos; 16:9.

Liked stored suffix:

> clean flat cel-shaded cartoon style, an even medium-thick dark warm brown-black #241a12 outline on everything, flat colours with gentle soft cel shading, rounded friendly shapes, no realistic detail, hand-lettered marker capitals for any in-world text

**Pipeline verdict.** The implementation work removed several bad recipe clauses, repaired the tile's color grant, made crowd and lettering review more honest, and improved parallel throughput. It did **not** return bricks generation to the actual liked call shape. Current gives the last/provider-heavy position to a suffix more than twice the liked stored length; the liked full-run forge did not append even its shorter stored suffix. This is the cleanest remaining causal hypothesis because the current forge's own comment says the provider weights the last instruction hardest.

### Current machine-emitted review surface

Current review artifacts can emit applicable rows for support contact, two-cast relative scale, crowd rig, flat-cel hazard, line register, lettering register, cast-free insertability/working occupancy, and place-owner lettering. This is better coverage than the liked run's less formal review. It still cannot judge the binding taste gestalt automatically: none of these rows measures 10–30% rendered figure height, 30–50% open space, atmospheric/gradient depth, or whether a wide/detail cadence feels like the liked set. Those belong in the controlled image comparison below, not another row explosion.

## 5. Ranked next steps for Acts 2–4 generation

### 1. Isolate provider-tail ownership before any full A2–A4 wave

Use 6–9 **fresh root/base or standalone** prompts spanning A2–A4, with the exact same seeds, aspect, size, model, and shot prose. Include both cast-bearing and cast-free examples; recommended beats from the comparison set are L85, L112, L118, L128, L177, and L207.

Run in two single-axis rounds:

1. **Order test:** current 80-word suffix at tail versus the exact same suffix immediately before the authored payload, so content is constant and only provider recency changes.
2. **Content test, only if order does not settle it:** winning order with current suffix versus no appended suffix/head-only—the actual liked full-run shape.

Measure rendered figure-height/open-space ratios, depth/texture, palette HSV, and the human forced choice. **Evidence:** actual liked forge had no suffix slot; current does; current code itself asserts last-position overweighting. Do not spend an acts 2–4 wave before this is resolved.

### 2. Run a prompt-register A/B after dispatch order is locked

Keep the winning assembly fixed. For the same six beats compare:

- current `still_prompt`; and
- a liked-register rewrite that begins from the complete scene, names one decisive camera/distance, gives one readable scale/object relation, removes `payload`/`beat`/`supplied literal` authoring language, and ends on the visible consequence.

Do not change style words, seeds, or suffix in this test. **Evidence:** 202 aligned beats show liked longer and more camera-explicit, while fresh already exceeds v2 in world-object density. The test should target organization/order, not merely add nouns.

### 3. Audit chain and shot-class counterweights in A2–A4 before scaling

Review only transitions, not every line. Flag a fresh delta chain when the next beat changes the visual argument enough to earn an independent composition. Give particular attention to:

- A2's 2 standalones versus liked's 9;
- A4's 25 ironic-counterpoints and 6/69 camera choices;
- places where liked uses a symbolic/map/empty-world reset but fresh keeps a performed built world (shipping, verdict reversal, numeric outcomes).

Convert selected beats to fresh bases/standalones and restore symbolic-stand-in, reaction, or number-object counterweights **by beat judgment, never a class quota**. **Evidence:** fresh delta share is 43.3% in A2–A4 versus liked 34.6%; fresh/liked literal is 43/6 and symbolic stand-in 4/32.

### 4. Clear the concrete generation gates before Pass 2

- Mint and independently approve `packing-executive` and `family-packer`; current L160–L163 explicitly require both and their notes mark the Pass-1 gate.
- Decide whether the repeated shrink-wrapped brick pallet at L123–L125 and L137–L139 needs the existing flagged `prop-shrinkwrapped-brick-pallet` canonical. If exact out-and-back identity is load-bearing, mint it; repeated prose is not a seed guarantee.
- Dry-run the assembled slate after these assets exist and verify chain parents, crowd exemplar, style tile, and suffix placement per shot.

**Evidence:** r2 correctly changed the family beat from an empty proxy to two story-bearers; the repair is not generatable under the seeding law until their canonicals exist.

### 5. Make the image gate answer the remaining taste questions, not re-run author lint

For the winning A/B set, record per frame:

- tallest story figure as % of frame height;
- open air/space as % of frame area;
- mean HSV saturation and warm/cold balance;
- a simple depth/texture ruling: flat planar / atmospheric-gradient / terrain-material depth;
- Daniel's forced-choice winner and one short reason.

Use existing rig/fidelity rows unchanged. Add no permanent automated taste thresholds yet. **Evidence:** the prompt files prove what was asked, not what the engine delivered; Daniel's standing note says the prior prompts asserted scale but the images still missed majorly.

## 6. Doctrine follow-ups, conditional on the image gate

1. **If provider-tail order wins:** change forge assembly and its byte-level tests so scene payload owns the final provider position. Do not rewrite all prompts or add a new camera lint.
2. **If head-only/no-suffix wins:** treat the current tail as the causal defect for this engine and reconcile that against the poyais two-voice precedent with a second-video probe before making it channel-wide.
3. **If liked-register prompt variants win under identical dispatch:** update the positive exemplar and critic to teach scene/camera/payload ordering. Route the taste pattern to examples + critic, not word-count, vantage, or class quotas.
4. **If neither wins but texture/atmosphere remains the clear forced-choice axis:** test the style-bible render register directly—current flat-cel wording versus a controlled soft-cel/atmospheric variant—while holding prompt and dispatch fixed. This is ground-truth candidate axis 2 and has not been isolated.
5. **If no controlled variant wins:** stop authoring doctrine and inspect exact historical request logs/seeds for the loved frames. The 214-shot file and `309b341b` code snapshot are close but not byte-level per-call provenance.

## 7. Three-lens reconciliation

### Evidence integrator

The reset is not a wash: it improves cadence, figure balance, world nouns, chain continuity, crowd geometry, and palette breadth. The exact remaining differences cluster around provider-tail assembly, chain share, shot-class mix, explicit camera closure, and palette-token concentration. The liked corpus is more specified, not less.

### Skeptic

No prompt metric proves the loved pixels' causal feature. The requested liked snapshot postdates the actual 215-shot generation corpus by several edits, and current historical code can only approximate the exact call for any one loved frame. Camera counts and class labels also cannot substitute for render measurements. Therefore the report rejects a direct doctrine rewrite from corpus correlation alone.

### Generation planner

The smallest decision-capable experiment is a same-prompt/same-seed provider-order A/B on acts 2–4 roots, followed by a separate same-dispatch prompt-register A/B. Only the winning controlled axis earns a doctrine change. Full acts 2–4 generation before those two tests would spend at scale while the strongest historical dispatch difference remains uncontrolled.

## Final verdict lines

- **Fresh vs v2:** meaningful authoring improvement, especially outside L01–L25.
- **Fresh vs liked:** still structurally and operationally different; not ready to claim taste recovery.
- **Dominant next hypothesis:** scene-payload recency at provider tail, with chain/class register as the next authoring hypothesis.
- **Known generation blockers:** two new family-beat canonicals; probable recurring-pallet continuity asset.
- **Guardrail check:** all named sources were accessible; only this report was written; no image generation, spend, external action, or commit occurred. Render-register and delivered-ratio claims remain explicitly unverified.
