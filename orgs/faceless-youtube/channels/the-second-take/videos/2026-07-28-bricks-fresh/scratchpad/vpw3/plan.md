# VPW3 central plan lock

Status: **LEG 0 locked.** This is a fresh Step 3a plan only. It does not author a shot, a prompt, a thumbnail, or Shorts visuals, and it does not read or preserve the old `shots.json` / `scratchpad/vpw2` prompt plan.

## Governing inputs

- Script: `script.md`, 1,632 words at 175 wpm, estimated runtime 9:20 / 560 seconds. The draft floor is 140 shots; the locked working target is **204** (about 2.75 seconds per shot), with the opening 60 seconds denser than the remainder.
- Depiction law: `visual-kit/visual-grammar.md`, `example-shots.md`, and `references/shots-schema.md`.
- Binding taste evidence: `scratchpad/taste-audit/poyais-visual-audit.md`, `poyais-register-audit.md`, `taste-ground-truth.md`, and the poyais-revert summary in `revert-edit-notes.md`.
- Reuse inventory: the video `assets/library/manifest.json`, `assets/scenes/manifest.json`, and the live registry. Existing cast, approved environment plates, crowd exemplar, props, and primitive assets remain the only reuse inputs. Former shot prose, former stages, former IDs, and the current `shots.json` are not inputs.

## Lock decisions

1. **Four disjoint contiguous acts.** The cuts are story turns, not equal word slices. No stage crosses an act boundary.
2. **Standalone is the normal form, not the default answer to escalation.** There are sixteen provisional chains, forty-two connected frames total: only the repeated, same-composition transformations below. Every delta changes one large, legible material state that the narration needs the viewer to track; every world, subject, composition, or visual-argument change remains a hard-cut standalone. Any planned chain that cannot make its stated transformation unmistakable at scene scale is split into standalones, never saved with a cosmetic delta.
3. **Non-literal first.** Maps/plans, hero objects, physicalized imbalances, diegetic media, register-shift infographics, reactions, and empty-world aftermaths carry the explanation, comparison, accounting, and low-point beats. Literal depiction is confined to actual pack/ship/open/count actions and the legally consequential courtroom/prison facts.
4. **One seeded figure is the default human solution.** A line about Wiles, Johnson, Rifenburgh, an auditor, a worker, investor, customer, executive, family packer, judge, banker, or HR gets its story-bearing performer. Crowds are allowed only for the 1983 buying frenzy and the room-full-of-managers count pressure, where the visible mass is itself the claim; they remain rear-zone, small through intervening structure, with authored group attitude. There is no anonymous foreground human tier.
5. **Palette is a per-shot commitment.** Each later prompt states a locked 2-3-colour palette, not a generic cream/charcoal environment. The late-1984 collapse, audit shortfall, Christmas layoffs, restatement/bankruptcy, and HR aftermath receive deliberately cool or desaturated passages. Red is only brick material or a semantic correction, liability, prohibition, or final punch cue.
6. **Closed world.** Every seeded figure retains the registry-pinned costume and uses an existing primitive token. The two declared but unminted canonicals below are the only needs. No new cast, prop token, pose, expression, interaction, or costume is invented during authoring.

## Act partitions and density

| Act | Script span | Story turn | Runtime / target | Density and visual reset intent |
| --- | --- | --- | --- | --- |
| A1 - Boom, boast, and the first crack | lines 11-21 | 1983 demand, what a drive is, the brick premise, MiniScribe's rise, then the 1984 collapse | ~110s / **47** shots; ~27 in the first 60s | Fastest section. Demand visibly drains a PC shelf, MiniScribe's revenue display rises, the carton becomes bricks, and IBM orders clear from the same dock. The opening peak remains the brick-box reveal; layoffs and Johnson's exit reset to new human compositions. |
| A2 - Doctor Fix It and the number that was not there | lines 23-31 | Wiles arrives, turns targets into fear, management invents inventory, audit exposes the gap, count sheets are changed | ~152s / **52** shots | Alternate solitary Wiles/control tableaux with quota and false-count chains, audit tools, and empty-inventory aftermaths. The paper fraud progresses from blank field to invented number, swapped sheet, then climbing fraudulent ledger; fear, firing, and the actual-shelf comparison remain distinct cuts. |
| A3 - The brick operation | lines 33-41 | Bricks bought and boxed, routed out and back, audit sampling bypassed, fraud grows, employees are fired and call the press | ~147s / **51** shots | Mid-video re-arm remains the pallet unmasking. Packing scales from loose bricks to a pallet, the same pallet travels out and back, a sample expands to an accepted warehouse, and scrap comes to dominate the inventory. Family packing, layoffs, and the phone call reset to their own human compositions. |
| A4 - Discovery, reversal, and the HR punchline | lines 43-55 | New management finds the fraud, books collapse, litigation wins then evaporates, Wiles is convicted, the company disappears, HR finally exposes the scheme | ~151s / **54** shots | The books deepen from reported to restated loss, the verdict converts to its real settlement, and Wiles's defense dossier turns into rebuttal evidence. Bankruptcy, prison, company aftermath, and the final worker-HR realization stay hard-cut consequence beats; the withheld peak remains HR, not the legal verdict. |

The partition target is 204 long-form shots. It preserves the required runtime coverage, clears the 140-shot floor, and deliberately reallocates the old file's excess delta density to independent, compositionally distinct shots.

## Three reserved peaks

1. **Opening (A1):** the story's impossible proposition, rendered as the readable transition from a drive carton to a repeated brick substitution, not a wall of shoppers.
2. **Mid-video re-arm (A3):** the entire pallet-face unmasking, after the plan and purchase are understood. It earns the strongest terracotta/clay contrast and the clearest material scale.
3. **Final 20% (A4):** the anti-climax that HR, not auditing or regulation, ends the scheme. The layoff/phone/newsroom causal line must feel colder and more human than the courtroom material.

## Places, plate variants, and environment reuse

All place IDs below map to literal script vocabulary. Reused scene plates are selected only from the verified video scene manifest and only where the plate's actual set matches the planned place and palette; an old frame never imports its old prompt, shot role, cast, or chain. The source manifest's verified scene inventory is retained for this purpose, including its approved plate candidates. A qualifying plate is cast-free, active at working occupancy, and carries its forced owner decision.

| Place | Runs / role | Owner decision | Plate variants locked for later authoring |
| --- | --- | --- | --- |
| `miniscribe-building` | Recurs from the boom through the collapse and fallout | `place_owner: "MiniScribe"` | production floor, executive/meeting zone, and loading-dock zone; reuse approved matching plates rather than recreating a new set per beat. |
| `office` | Wiles's Los Angeles control room, revisited for pressure and remote-rule beats | `owner_ambiguity: true` | windowed executive room and desk-side planning zone. |
| `warehouse` | Recurring rented inventory/audit/packing set | `owner_ambiguity: true` | loading threshold, full-rack interior, and audit/count zone. The pallet-reveal stage stays in one of these variants. |
| `colorado-brick-company` | Purchase and final ironic winner return | `place_owner: "Colorado Brick Company"` | clay yard/kiln zone and dispatch/loading zone. |
| `accountants-building` | Audit entry and evidence/statement beats | `owner_ambiguity: true` | count-room table and locked-box station. |
| `denver-newspapers` | The whistleblower call becomes public | `owner_ambiguity: true` | night phone desk and press/print zone. |
| `jury-judge` | Courtroom result and reversal, one legal run | `owner_ambiguity: true` | jury gallery and judge bench. |
| `prison` | Wiles's consequence | `owner_ambiguity: true` | gate/corridor aftermath only. |

Object, map, number, physicalized-imbalance, and register-shift frames declare no place and remain seedless roots. A single-visit unbranded set needs no wasteful dedicated plate. All plate variants will be matched to a concrete existing approved scene asset before `place_anchor` is authored; none is pre-bound merely because an old shot ID exists.

## Stage-chain lock

| Stage | Act | Parent composition | Legal progression | Story load | What cannot enter it |
| --- | --- | --- | --- | --- | --- |
| `pc-shelf-drain` | A1 | One fixed 1983 home-computer shop shelf, with the same foreground PC-box display | Fully stocked PC-box display -> most boxes have left, exposing the shelf's empty backing | Makes the buying frenzy a visible depletion rather than a generic shopper cut. | new shopper, price-label edit, camera/framing change |
| `miniscribe-revenue-rise` | A1 | One MiniScribe production-and-revenue display, with the same factory silhouette and counter | Annual-revenue counter at $125 million -> the single counter rises to the claimed $600 million peak | The boom needs the viewer to retain the scale change behind the later doubt. | a new company, a new chart type, a decorative crack or expression tweak |
| `brick-box-reveal` | A1 | One fixed foreground drive-carton and near-pallet composition | Closed drive carton -> one fully opened carton visibly contains a red clay brick -> full near pallet face opened with repeated bricks | Turns the title's substitution into a staged proof at material scale. | new figure, camera/framing change, label-only edit, extra decorative carton detail |
| `ibm-order-collapse` | A1 | One MiniScribe loading-dock bay, with the same IBM outbound-rack positions | Outbound racks fill the bay -> those same rack positions are entirely cleared | Lets the cut order visibly empty the operation before the separate layoff and Johnson consequences. | worker removal, a firing reaction, a new dock or framing |
| `quota-ratchet` | A2 | One Wiles target-board composition, with the same quota gauge and team-position markers | Baseline sales target -> the gauge ratchets higher -> it ratchets higher again | Makes the no-win quarterly escalation legible before the fraud response. | a figure entrance, bonus/firing reaction, a changed boardroom |
| `invented-count-entry` | A2 | One managers' quarterly-count form on the same count table | Required inventory-count field is blank -> the whole field is filled with an invented count | Shows the first paper falsification as a consequential document-state change, not a pen detail. | a pen/clip movement, a new manager, tiny handwriting-only edit |
| `count-sheet-substitution` | A2 | One accountants' locked count-box and document well | Real count sheet in the readable box -> the whole sheet is visibly replaced by a forged one | Tracks the physical substitution that converts the discovered gap into a clean audit. | paper clip, wrench, small tab, a changed expression, or unlegible tiny writing as the delta |
| `fraud-ledger-escalation` | A2 | One false-inventory ledger column, held in the same accounting composition | First fictitious inventory entry -> the column rises another quarter -> the false column rises again | The paper lie must visibly compound once the clean audit raises the next target. | a new document, a different accounting setting, a label-only change |
| `brick-packing-scale` | A3 | One warehouse packing bench with the same brick pile, carton row, and pallet position | Loose matched bricks beside open drive cartons -> the whole carton row has become sealed drive cartons -> that row has accumulated into a full pallet tower | Shows the scheme crossing from a purchased material into scaled inventory. | family/worker entrance, serial-label-only edit, shrink-wrap-only edit, new warehouse zone |
| `pallet-unmasking` | A3 | One fixed foreground shrink-wrapped pallet face | Wrapped pallet of closed cartons -> one whole front carton opened to a brick -> whole front pallet face opened, exposing a repeated brick field | Re-arms the story by proving the physical fraud at its full operational scale. | any person entrance, local trim, serial-label-only state, shipping-location change |
| `pallet-return-loop` | A3 | One fixed Colorado-Singapore-return route plan, with one pallet token and the same route | Pallet token at Colorado dispatch -> the same token reaches Singapore -> the same token returns to MiniScribe inventory | The viewer has to retain that these are the same units sold in one quarter and counted again in the next. | a second pallet, a new map, a new route, a customer entrance |
| `sample-pass-propagation` | A3 | One warehouse audit-count composition: foreground sampled carton, fixed surrounding rack field | One selected carton is the bounded test sample -> the surrounding rack field resolves as accepted inventory | Makes the sample-to-whole-warehouse audit blind spot visible without reducing it to a stamp landing. | a tick/stamp-only edit, auditor entrance, new warehouse framing |
| `scrap-padding-dominates` | A3 | One held inventory-rack composition, with brick cartons and a bounded scrap section | Brick cartons dominate with a small scrap section -> scrap-filled cartons integrate across the rack -> the scrap field visibly dwarfs the brick stock | Shows the fraud escalating beyond its brick icon into the larger junk-padding problem. | loose debris addition, exact measured ratio, a new warehouse zone |
| `restatement-loss-deepens` | A4 | One new-management accounting-table composition: 1986-88 book run and central loss counter | Reported books carry the $14 million loss -> the whole book run changes to restated entries -> the same loss counter deepens to $40 million | The discovery matters as an accumulating correction, not an isolated bad-quarter number. | Rifenburgh entrance, a new office, a label-only red accent |
| `verdict-reversal-settlement` | A4 | One court-clerk case-file composition, with the central disposition sheet filling the frame | $550 million jury disposition -> the whole disposition becomes an overturned judgment -> the same case file resolves to the $128 million settlement | Preserves the viewer's expectation and then reverses it into the actual recovery. | stamp-only landing, judge entrance, new courtroom framing |
| `wiles-defense-rebuttal` | A4 | One Wiles case dossier, with one full-page claim/rebuttal panel in the same folder | Wiles's ignorance defense page -> the full panel becomes the subordinates' rebuttal testimony -> the full panel becomes the pre-exposure share-sale record | The audience needs the cumulative case against his denial to build in one readable evidentiary object. | a single added sticky note, prison entrance, a new case setting |

This reserves 16 bases and 26 material deltas. The other **162** frames are standalone. Deliberate standalone escalation beats: the A1 layoffs and Johnson exit, A2 fear/firing and shelf-gap comparison, A3 family packing/layoffs/press call, and A4 bankruptcy/prison/HR payoff each either changes the story-bearing subject or requires a new visual argument, so none is disguised as a continuity delta.

## Closed cast and primitive plan

The video cast is closed to the existing declared set:

`pc-boxy`, `rival-pc`, `miniscribe-rep`, `ibm-suit`, `terry-johnson`, `qt-wiles`, `hq-banker`, `brick-foreman`, `auditor-rep`, `line-worker`, `drive-maker`, `return-customer`, `brick-co-seller`, `rifenburgh-ceo`, `bond-investor`, `tv-chef`, `trial-judge`, `hr-officer`, `packing-executive`, and `family-packer`.

The first eighteen listed members are treated as live reusable canonicals from the registry plus video manifest. `packing-executive` and `family-packer` are already declared but are not minted canonicals, so their A3 shots are blocked until the standard Pass-1 canonical wave completes. No other character is added.

| Beat family | Cast route and closed primitive bindings |
| --- | --- |
| Early-PC, drive-maker, MiniScribe, IBM | Personified-object/company figures retain their special canonicals; use `expr-smug`, `expr-worried`, `expr-deadpan`, `hold-both-hands`, `action-offering`, or `action-recoil` only where each beat fits. No human-body pose is applied to the no-hands computer cast. |
| Johnson, Wiles, Rifenburgh, banker, auditor, foreman | Use existing `action-powerstance`, `action-armscrossed`, `action-accuse`, `action-present`, `hold-paper-by-sides`, `point-at-thing`, `sign-with-pen`, `carry-by-handle`, `hold-one-hand`, `hold-both-hands`, `action-slump`, or `action-walk`, paired only with the existing expression catalog. Two-person contact uses an existing interaction only on a fresh two-cast base. |
| Worker, investor, customer, seller, judge, HR | One named performer owns each personal consequence/decision beat. The planned actions conform to `hold-both-hands`, `hold-paper-by-sides`, `action-recoil`, `surrender`, `action-walk`, `action-present`, and the existing expression catalog; no prose pose substitutes for a missing primitive. |
| A3 family packing | `packing-executive` and `family-packer` each take one seeded role at a time, with `hold-both-hands` and a beat-fit existing expression. They are not a crowd and must not appear until their canonicals are minted and approved. |

The valid crowd exception is limited to: (a) the consumer buying frenzy and (b) the room-full-of-managers pressure beat. In both, the crowd declares `"crowd": true`, is dressed/attituded in normal scene prose, sits behind structural depth, and never occupies the foreground as the default visual argument.

## Authoring map by act

### A1

- Non-literal lead: 1980s dateline/device hero, product-memory register shift, market scale comparison, and a picks-and-shovels physicalized hierarchy.
- Human/story-bearing beats: `pc-boxy`, `drive-maker`, `miniscribe-rep`, `ibm-suit`, and `terry-johnson`; the first 1983 demand crowd is a single explicit mass exception, not the default composition.
- Literal allowance: the carton/brick reveal only. The MiniScribe boom and 1984 drop should be number objects, business-world scale, and a cool empty-world aftermath rather than a generic re-enactment of success/firing.

### A2

- Non-literal lead: Wiles as a control/target mechanism, quota physicalization, count-plan infographic, document/media devices, and a visible absence in inventory.
- Human/story-bearing beats: `qt-wiles` owns the fear regime; `brick-foreman` owns the pressure to invent a number; `auditor-rep` owns the audit. The manager-room crowd is the sole A2 mass exception and must be spatially subordinate to the number problem.
- Literal allowance: the accounting box and full count-sheet substitution. The document chains use whole readable fields/pages; the tools themselves never earn a delta.

### A3

- Non-literal lead: a plan route from Colorado to Singapore/return, a balance-loop/return mechanism, test-count register shift, and a cold empty-workplace consequence.
- Human/story-bearing beats: `brick-foreman`, `brick-co-seller`, `return-customer`, `auditor-rep`, `line-worker`, then `packing-executive` and `family-packer` once unblocked. Their staging is one-at-a-time unless a fresh two-cast base genuinely needs a relationship.
- Literal allowance: clay selection, the packing-scale and pallet-unmasking chains, and completed shipping/return states. The family action is a held packing tableau, never a frozen mid-motion action.

### A4

- Non-literal lead: books becoming an abyss, a single investor against liability, verdict/reversal media, empty-company aftermath, and the final institutional irony.
- Human/story-bearing beats: `rifenburgh-ceo` on the new-management discovery, `bond-investor` on the loss, `trial-judge` on the reversal, `qt-wiles` on conviction, `brick-co-seller` for the dry final winner, and `hr-officer` / `line-worker` for the actual end of the fraud.
- Literal allowance: restrained courtroom/prison facts and the phone-to-press causal beat. The case-file reversal is a document-content chain; the legal, corporate, prison, and human consequences otherwise receive new compositions and their own cool/neutral palette states.

## Flagged needs and blocks

1. **`packing-executive` canonical mint required before A3 authoring.** It is the executive who brings family in at night; planned primitive is `hold-both-hands` with a suitable existing expression.
2. **`family-packer` canonical mint required before A3 authoring.** It is the story-bearing helper; planned primitive is `hold-both-hands` with a suitable existing expression.
3. There are no required new poses, expressions, interactions, costumes, props, or cast beyond those two declared canonicals. If any later line cannot be represented with the bindings above, it receives an explicit elevation flag and is blocked rather than improvised.
4. No `shorts/short-NN.md` files exist for this video at plan time. Shorts are out of this LEG 0 lock unless source files are supplied before their own Step 5 pass.

## Stop point

This is the central plan lock required by Step 3a. Do not write `shots.json`, do not lint it, do not run the critic, and do not spend generation tokens in this leg.
