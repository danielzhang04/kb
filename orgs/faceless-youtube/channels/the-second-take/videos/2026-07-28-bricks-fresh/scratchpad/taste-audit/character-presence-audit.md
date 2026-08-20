# Character-presence + delta-authoring audit — VPW3

## Verdict

**Yes: the new L01–L25 board has largely removed people, and the full file has materially reduced them.** The current file stages an actual human body in **48/204 shots (23.5%)**, versus **119/214 (55.6%)** in the liked-era bricks file and **174/246 (70.7%)** in yesterday's file. It is not a general shot-count effect: the new file has only ten fewer shots than liked-era, but 71 fewer human-body shots.

The non-literal vocabulary is an improvement. The failure is that object/map/document choices were used *instead of staging the people whose action, decision, or consequence the line is about*. That is contrary to the existing doctrine, not a necessary consequence of it.

## Method and corpus definitions

| Corpus | Source | Shots | Timed runtime |
| --- | --- | ---: | ---: |
| NEW | `shots.json` | 204 | 545.2s |
| POYAIS | `videos/2026-07-04-poyais/shots.json` | 117 | 535.5s |
| LIKED-era | `git show 30d2b7e8:orgs/faceless-youtube/.../shots.json` | 214 | 549.4s |
| YESTERDAY-era | `scratchpad/vpw2/shots.v2-era.json` | 246 | 540.4s |

`Any human` means a real human named-cast body or a declared/staged crowd; it deliberately excludes personified hardware/company characters (`pc-boxy`, `rival-pc`, `miniscribe-rep`, `ibm-suit`, `drive-maker`). `Named cast` includes those personified cast members, because they are still declared cast figures. `Single` and `multi` count one or two named seeded cast figures, not anonymous crowd bodies. A legacy Poyais crowd is detected from its explicit crowd-rig prose because that older schema did not consistently declare `figures.crowd`.

## 1. Human presence

### Headline totals

| Corpus | Any human | Named human | Named cast | Single | Multi | Crowd | Longest figureless run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| NEW | **48 / 204 (23.5%)** | 43 | 55 | 50 | 3 | 7 | L110–L118: 9 / 25.9s |
| POYAIS | 75 / 117 (64.1%) | 44 | 44 | 30 | 2 | 41 | L03–L10: 8 / 19.5s |
| LIKED-era | **119 / 214 (55.6%)** | 87 | 105 | 70 | 22 | 56 | L205–L215: 11 / 30.2s |
| YESTERDAY-era | 174 / 246 (70.7%) | 135 | 172 | 125 | 11 | 72 | L40–L43: 4 / 7.4s |

The current file's three longest story runs without any figure are L110–L118 (25.9s), L127–L135 (25.5s, as the R2 critic recorded), and L163–L170 (19.6s). The first two are in the brick operation itself: shipping/return, audit sampling, and the padding escalation. This is exactly where people make the fraud work.

### Per-act measurement

Bricks acts are aligned to the same script turns: A1 through Johnson's exit; A2 Wiles/falsification; A3 brick operation through press call; A4 discovery through HR. Poyais uses its stored story beats grouped into the corresponding four story turns. Entries are `any human / shots; named cast; single; multi; crowd`; the last field is the longest figureless run in that act.

| Corpus | A1 | A2 | A3 | A4 |
| --- | --- | --- | --- | --- |
| NEW | 3/45; 14; 12; 2; 1; L10–L15 13.4s | 19/51; 15; 13; 0; 6; L77–L83 20.3s | 14/51; 14; 13; 1; 0; L110–L118 25.9s | 12/57; 12; 12; 0; 0; L163–L170 19.6s |
| LIKED-era | 13/41; 17; 13; 4; 11; L11–L15 11.9s | 45/57; 39; 25; 13; 16; L94–L97 11.1s | 34/59; 32; 22; 3; 13; L111–L114 9.0s | 27/57; 17; 10; 2; 16; L205–L215 30.2s |
| YESTERDAY-era | 20/47; 32; 24; 5; 12; L40–L43 7.4s | 52/62; 47; 39; 2; 14; L96–L97 5.6s | 49/66; 44; 25; 3; 23; L116–L117 3.9s | 53/71; 49; 37; 1; 23; L176–L177 3.1s |
| POYAIS | 9/18; 7; 5; 1; 3; L03–L10 19.5s | 28/48; 19; 13; 1; 14; L46–L49 18.0s | 17/27; 5; 2; 0; 13; L82–L85 19.0s | 21/24; 13; 10; 0; 11; L124–L125 10.0s |

The most diagnostic collapse is A1: the current board has only **3 human-body shots in 45**. L01–L25 is worse still: **one crowd shot (L09, 2.1s) and zero named human bodies** in 55.0 seconds. It does contain five named *character* shots, but all are personified hardware/company figures: L04, L16, L18, L20, and L23. The opening has character tokens; it does not have human story-bearers.

## 2. Named cast usage in NEW

### Use versus liked-era

| Cast member | NEW | LIKED-era | Change | Finding |
| --- | ---: | ---: | ---: | --- |
| `brick-foreman` | 7 | 39 | **-32** | Largest loss; the operational worker/manager almost disappears. |
| `qt-wiles` | 11 | 33 | **-22** | The main antagonist loses two-thirds of his screen presence. |
| `auditor-rep` | 5 | 21 | **-16** | The audit becomes documents and samples rather than an auditor's judgment. |
| `miniscribe-rep` | 5 | 17 | **-12** | Company-personality thread sharply reduced. |
| `hq-banker` | 1 | 7 | **-6** | Turnaround sponsor is nearly absent. |
| `pc-boxy` | 3 | 5 | -2 | Reduced but still used for opener/reveal reactions. |
| `terry-johnson` | 2 | 2 | 0 | No numerical loss, but two shots never made a substantial founder arc. |
| `ibm-suit` | 3 | 3 | 0 | Stable. |
| `packing-executive`, `family-packer` | 2 each | 0 | +2 each | Restored only after R1; both are still narrow A3 inserts. |

Newly declared but unused: `tv-chef`, `trial-judge`. Near-unused: `return-customer`, `hq-banker`, and `hr-officer` (one shot each). The central arc verdict is therefore mixed: **Wiles materially lost story presence (33 → 11); Terry did not fall numerically, but remains underused at two; the people who perform the fraud lost most sharply.**

## 3. Why this happened

### The doctrine itself is correctly balanced

The f1c3b1aa-era grammar is not the cause. It explicitly says:

> “Non-literal changes the depiction, not the scene's occupancy” (`visual-grammar.md` §1).

> “Use people for person, decision, relationship, action, or reaction beats” (§1).

> “A story-bearing individual must not be replaced with an empty object … to avoid a figure” (§2).

It also makes a figureless run past roughly ten seconds a self-audit flag. The current VPW skill repeats the right rule: “The beat's true subject bears the frame” and “Non-literal changes the DEPICTION, never the scene's occupancy.” The doctrine needs no reversal.

### The plan's emphasis created the wrong optimization target

VPW3's plan puts **“Non-literal first”** ahead of its correct but weaker adjacent line, **“One seeded figure is the default human solution.”** Its wording says maps, hero objects, physicalized imbalances, diegetic media, infographics, reactions, and empty aftermaths “carry the explanation, comparison, accounting, and low-point beats,” while literal depiction is “confined” to pack/ship/open/count actions. In each act's authoring map, “Non-literal lead” is the lead instruction; the human instruction is a cast inventory.

That invited this false inference: non-literal = object-only and literal = human. The result is not literalism; it is **empty non-literalism**. Examples include the A1 55-second opening, audit/count passages composed as papers and lockboxes, and the A4 legal/consequence stretch composed as chairs, gavel, briefcase, nameplate, and documents.

The same plan contains the corrective intent, which makes this an execution/priority failure rather than a doctrine failure: it says a line about “Wiles, Johnson, Rifenburgh, an auditor, a worker, investor, customer, executive, family packer, judge, banker, or HR gets its story-bearing performer,” and it explicitly reserves human resets at layoffs, packing, press call, bankruptcy/prison, and the HR payoff. The authored file did not consistently realize that map.

### Critic influence

R1 correctly caught the issue: it called L107–L118 and L127–L138 the two longest figureless runs, said they “hide story-bearing decisions and labor behind cartons, scales, and racks,” and ordered human bases at L107–L109 and L135–L140. That repair survives: the brick-packing chain now retains `brick-foreman`, and packing-executive/family-packer frames exist.

R2 then narrowed the check incorrectly. It accepted the class distribution as “broad and story-led” and concluded the 25.9s and 25.5s figureless runs were “primarily mechanism/scale passages,” so no figure finding was made. This judged class variety and crowd legality, but did not re-ask whether a person was the causal subject of each mechanism beat. It converted R1's semantic concern into a run-length exception.

## 4. Delta-authoring quality

The requested premise needs one correction: **NEW contains 12 declared stages and 18 actual delta frames, not 26.** The plan reserved 16 bases + 26 deltas, but four planned three-frame chains were removed/rebased during repair (`pallet-unmasking`, `scrap-padding-dominates`, `verdict-reversal-settlement`, `wiles-defense-rebuttal`), taking eight deltas with them. The 12 extant stages below are the auditable set.

All twelve chains retain their authored palette/composition within the stated continuity convention. Ratings therefore focus on whether the visible change is large enough and whether the held composition bears the narrated story.

| Stage | Frames | Rating | Audit |
| --- | --- | --- | --- |
| `pc-shelf-drain` | L07–L08 | **Sound** | Full shelf → visibly bare backing is a single, legible depletion; stable beige/teal/tobacco shop composition. |
| `brick-box-reveal` | L24–L26 | **Sound** | Closed carton → one brick → repeated brick field is the opening proof and earns holding the pallet composition. |
| `miniscribe-revenue-rise` | L33–L34 | **Weak** | Partial outbound rack → full rack is visible, but it no longer carries the named $125m/$600m revenue progression; it is production scale, not the claimed revenue rise. |
| `ibm-order-collapse` | L43–L44 | **Sound** | Same dock/rack positions become empty while IBM remains in frame; one operational reversal, palette held. |
| `quota-ratchet` | L62–L64 | **Sound** | Low → higher → highest broad gauge is a readable ratchet; Wiles and the worried managers preserve the human pressure context. |
| `invented-count-entry` | L71–L72 | **Sound** | Whole blank field becomes one broad invented block, not an illegible pen change; the manager crowd remains consequential. |
| `count-sheet-substitution` | L82–L83 | **Sound** | A complete real sheet becomes a complete forged sheet in the same lockbox: visible, causal, and compositionally justified. |
| `fraud-ledger-escalation` | L91–L93 | **Weak** | Three added blocks do tell compounding, but their small same-column increments risk reading as repetitive bookkeeping rather than escalating consequence. |
| `brick-packing-scale` | L107–L109 | **Sound** | Open brick carton → sealed row → pallet tower is a large material escalation, and the foreman stays visible rather than being replaced by the result. |
| `pallet-return-loop` | L115–L117 | **Sound** | One clearly identified token moves Colorado → Singapore → MiniScribe on one fixed map; exactly the same-units argument. |
| `sample-pass-propagation` | L128–L129 | **Weak** | Sample → accepted field is conceptually right but can collapse to a broad status fill; it needs the visual distinction to read at scene scale, not as a pass-stamp substitute. |
| `restatement-loss-deepens` | L159–L161 | **Broken** | The first delta says a “central valuation plate turns” although the base establishes books, calculator, ruler, window, and files—not that plate. It adds a new load-bearing object while claiming continuity; the $88m-below-zero → bankruptcy causal sequence is good, but needs a base that already contains the plate. |

Summary: **8 sound, 3 weak, 1 broken.** The delta pattern itself is not the reason humans vanished. The successful chains prove that a non-literal transformation can retain a person (`quota-ratchet`, `brick-packing-scale`). The problem is using an object chain where a new actor/action base was required.

## 5. Smallest corrective change set

1. **Change the 3a plan artifact, not the class vocabulary.** For each VO beat whose truth depends on an actor's decision, labour, reaction, relationship, or consequence, record `story bearer → named cast → fresh/base shot` before selecting its non-literal class. The class is then chosen *around that performer* (for example, Wiles beside the escalating gauge; auditor with the sample field; family packer with the packing consequence), not instead of them. Do not assign counts or percentages.

2. **Rebalance one plan sentence.** Replace the plan-level emphasis “Non-literal first” with: **“Non-literal depiction first; actor occupancy first when a person makes the beat true.”** Keep the existing examples and literal limits. This is a priority clarification, not a return to literal reenactment.

3. **Give the critic one semantic question, not a quota.** After class-diversity review, ask: **“If this beat were frozen with every visible person removed, would the line's causal subject still be staged?”** If no, it needs a seeded performer or a fresh human base; an object/map may still be the payload. Do not waive the question because the passage is described as mechanism or scale.

4. **Apply the predicate to the current repair targets.** Rebase `restatement-loss-deepens` with its valuation plate already present. Re-stage the A3 shipping/return/sample/padding span and the A4 discovery/legal/HR span where the person performs, decides, suffers, or reveals; retain object, document, map, and palette turns for the mechanism that remains after the human subject is staged.

These changes preserve the non-literal win—objects, maps, documents, and physicalized arguments stay first-class—but stop them from becoming an automatic vacancy permit.
