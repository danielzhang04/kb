# Variant-D genlog — L01–L12 doctrine trial

- Date: `2026-08-21`
- Branch: `claude/bricks-variant-vd`
- Video: `2026-07-28-bricks-fresh`
- Requested model: `gemini-3-pro-image`
- Responding model: recorded per call
- Image size: `1K`
- Aspect: `16:9`
- Conservative rate: `$0.134/call`
- Provider-table comparator: `$0.039/call`
- Base allowance: `12`
- Retry allowance: `12`
- Maximum calls: `24`
- Conservative ceiling: `$3.216` (`$3.22` rounded)
- Provider comparator ceiling: `$0.936`
- Wave cap: `$5`
- Spend gate: PASSED — Daniel approved the 24-call / $3.216 ceiling on `2026-08-21`.
- Upstream lint/critic: final `--fragment` zero HARD at 293/1628 covered words; one independent critic cycle completed; every finding disposed; final L01–L45 authored no-growth review 45/45 PASS with zero positive deltas.

## Calls

| call | shot | base/retry/parent-regen | spec | seed roles | requested model | responding model | $0.134 cost | $0.039 comparator | output | fresh-eyes verdict | retry cause/park reason |
| ---: | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| 1 | L01 | base | `spec-vd-wave1.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L01.png` | verified clean | — |
| 2 | L02 | base | `spec-vd-wave1.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L02.png` | verified clean | — |
| 3 | L03 | base | `spec-vd-wave1.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L03.png` | defect: object-shape fidelity | red corner rendered as a round bulb |
| 4 | L04 | base | `spec-vd-wave1.json` | canonical=`pc-boxy`; expression=`expr-skeptical` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L04.png` | defect: composition | pc-boxy rendered foreground-dominant rather than middle-distance |
| 5 | L05 | base | `spec-vd-wave1.json` | lettering=`lettering-marker-italic`; style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L05.png` | verified clean; promoted parent | — |
| 6 | L07 | base | `spec-vd-wave1.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L07.png` | verified clean; promoted parent | — |
| 7 | L10 | base | `spec-vd-wave1.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L10.png` | defect: unrequested text | gibberish storefront text |
| 8 | L11 | base | `spec-vd-wave1.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L11.png` | defect: object silhouette | hard drive read as a safe/toaster |
| 9 | L12 | base | `spec-vd-wave1.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L12.png` | verified clean | — |
| 10 | L03 | retry | `spec-vd-retry-L03.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L03-vd-retry1.png` | verified targeted repair | round bulb replaced by rigid rectangular corner / straight-edged seam mechanism |
| 11 | L04 | retry | `spec-vd-retry-L04.json` | canonical=`pc-boxy`; expression=`expr-skeptical` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L04-vd-retry1.png` | verified targeted repair | foreground dominance replaced by explicit middle-distance occupancy mechanism |
| 12 | L10 | retry | `spec-vd-retry-L10.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L10-vd-retry1.png` | verified targeted repair | gibberish storefront text replaced by plain doorway / unmarked glass composition |
| 13 | L11 | retry | `spec-vd-retry-L11.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L11-vd-retry1.png` | verified targeted repair | safe/toaster silhouette replaced by exposed chassis / platter / connector mechanism |
| 14 | L06 | parent-regen | `spec-vd-L06.json` | parent=`assets/scenes/L05.png` sha256=`dca7190c…061b`; lettering; style-anchor | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L06.png` | verified clean | changed: computer now half-unpacked in a straw-lined shipping crate |
| 15 | L08 | parent-regen | `spec-vd-L08.json` | parent=`assets/scenes/L07.png` sha256=`6a0617b8…3bff`; crowd-exemplar; Forge §2d appended | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L08.png` | defect: fidelity/crowd HIGH | Victorian top hats, bonnets, and long dresses despite 1980s scene |
| 16 | L08 | retry | `spec-vd-retry-L08.json` | parent=`assets/scenes/L07.png` sha256=`6a0617b8…3bff`; crowd-exemplar; Forge §2d appended | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L08-vd-retry1.png` | verified targeted repair; promoted parent | generic crowd replaced by positive 1980s knit-top / jeans mechanism |
| 17 | L09 | parent-regen | `spec-vd-L09.json` | parent=`assets/scenes/L08.png` sha256=`3c3fa9ae…93ae`; crowd-exemplar; Forge §2d appended | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L09.png` | verified clean | changed: once-full shelf wall now mostly bare; crowd geometry/camera held |

## Closure

### Final assembled prompt word counts

Counts are from `forge.py gen --dry-run` assembled provider prompts after every Forge-appended block.

| shot | selected spec | assembled words | Forge §2d crowd block |
| --- | --- | ---: | --- |
| L01 | `spec-vd-wave1.json` | 179 | no |
| L02 | `spec-vd-wave1.json` | 177 | no |
| L03 | `spec-vd-retry-L03.json` | 180 | no |
| L04 | `spec-vd-retry-L04.json` | 294 | no |
| L05 | `spec-vd-wave1.json` | 313 | no |
| L06 | `spec-vd-L06.json` | 371 | no |
| L07 | `spec-vd-wave1.json` | 176 | no |
| L08 | `spec-vd-retry-L08.json` | 375 | yes |
| L09 | `spec-vd-L09.json` | 378 | yes |
| L10 | `spec-vd-retry-L10.json` | 181 | no |
| L11 | `spec-vd-retry-L11.json` | 300 | no |
| L12 | `spec-vd-wave1.json` | 179 | no |

Retry prompts also retained authored no-growth against vb: L03 `37≤39`, L04 `40≤61`, L08 `29≤30`, L10 `38≤46`, L11 `33≤36`.

- Calls: 17 total = 9 initial base calls + 5 retries + 3 delta/parent-regens; 7 approved calls unused.
- Outcome: 12 verified, 0 parked, 0 blocked.
- Cost: `$2.278` at the conservative `$0.134/call`; `$0.663` at the provider-table `$0.039/call` comparator.
- Final review: `assets/_review/scene-board.html` rebuilt for L01-L12; all 12 palette-basis and advisory rows read; advisory metrics did not gate; `stamp_review.py` reported 25 verified / 0 parked overall.
- Ops cost row to send: `Variant D doctrine trial: 17 calls, 12/12 verified, 0/12 parked; 12 base allowance + at most one retry each; conservative $0.134/call, provider-table $0.039/call; genlog scratchpad/vpw-var/genlog-vd.md on claude/bricks-variant-vd.`
- Exact five-field TSV payload: `Variant D doctrine trial: 17 calls, 12/12 verified, 0/12 parked; 12 base allowance + at most one retry each; conservative $0.134/call, provider-table $0.039/call; genlog scratchpad/vpw-var/genlog-vd.md on claude/bricks-variant-vd.	gemini-3-pro-image	gemini-3-pro-image	bricks variant D trial 12 shots	2.278`

## Boss grading note (2026-08-21)

- Independent Claude vision check (claude-sonnet, read-only, pixels only) concurred with 11/12 `verified` rulings: no gibberish/unrequested text, no unrequested humans, L05→L06 and L07→L08→L09 hold set+camera with exactly one visible change each, L08/L09 crowd bounded beyond the rail with the near lane empty and 1980s dress, L11 reads as a drive, L03 corner rectangular, L10 doorway unmarked.
- Dissent on **L04**: after its single retry the `pc-boxy` figure still reads foreground-dominant (left-foreground, large) rather than the authored middle-distance/secondary placement; face and identity correct. Retry allowance consumed, so no further call; status left as the fresh-eyes ruling with this dissent recorded for the blind review and the human board decision.

## Wave 2 (L13–L25)

- Date: `2026-08-21`
- Branch: `claude/bricks-variant-vd`
- Video: `2026-07-28-bricks-fresh`
- Requested model: `gemini-3-pro-image`
- Responding model: recorded per call
- Image size: `1K`
- Aspect: `16:9`
- Conservative rate: `$0.134/call`
- Provider-table comparator: `$0.039/call`
- Base allowance: `13`
- Retry allowance: `13` (one re-authored retry per failing shot)
- STEP-1 figure-card allowance: up to `2`
- Maximum calls: `28`
- Conservative ceiling: `$3.752`
- Provider comparator ceiling: `$1.092`
- Spend gate: PASSED — Daniel approved this wave on `2026-08-21`.
- Upstream authority: `shots.json` at HEAD is the critic-passed D fragment; L13–L25 only; no crowd shots.

### Wave 2 calls

| call | shot | base/retry/parent-regen | spec | seed roles | requested model | responding model | $0.134 cost | $0.039 comparator | output | fresh-eyes verdict | retry cause/park reason |
| ---: | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| 18 | L13 | base | `spec-vd-wave2.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L13.png` | defect: unrequested lettering | product-packed shelves introduced small invented labels |
| 19 | L15 | base | `spec-vd-wave2.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L15.png` | defect: causal topology | three copper paths merged into one common trunk |
| 20 | L16 | base | `spec-vd-wave2.json` | canonical=`pc-boxy`; canonical=`rival-pc` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L16.png` | defect: occupancy | both figures were foreground-dominant rather than small within the larger market world |
| 21 | L17 | base | `spec-vd-wave2.json` | canonical=`pc-boxy`; canonical=`rival-pc`; expression=`expr-annoyed` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L17.png` | defect: acting/occupancy | rival-pc smiled while pc-boxy alone carried annoyance; both figures dominated the world |
| 22 | L18 figure card | base | `spec-vd-wave2.json` | canonical=`drive-maker`; STEP-1=`fig-drive-maker--d6de7980` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-drive-maker--d6de7980.png` | verified figure card | required seed card for L18; initial L18 scene dispatch correctly skipped pending P3 review |
| 23 | L21 | base | `spec-vd-wave2.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L21.png` | verified clean | — |
| 24 | L22 | base | `spec-vd-wave2.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L22.png` | verified clean | — |
| 25 | L23 | base | `spec-vd-wave2.json` | canonical=`pc-boxy`; expression=`expr-skeptical` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L23.png` | verified clean | — |
| 26 | L24 | base | `spec-vd-wave2.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L24.png` | verified clean | — |
| 27 | L25 | base | `spec-vd-wave2.json` | lettering=`lettering-marker-italic`; style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L25.png` | verified clean | `HARD DRIVE` exact and marker-family clean |
| 28 | L13 | retry | `spec-vd-retry-L13.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L13-vd-retry1.png` | verified targeted repair | invented product lettering replaced by a sparse built-in shelf / bare-workbench composition |
| 29 | L15 | retry | `spec-vd-retry-L15.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L15-vd-retry1.png` | verified targeted repair | shared copper trunk replaced by three isolated bay-and-loop mechanisms |
| 30 | L16 | retry | `spec-vd-retry-L16.json` | canonical=`pc-boxy`; canonical=`rival-pc` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L16-vd-retry1.png` | verified targeted repair | foreground dominance replaced by small mid-aisle shelf-landings inside a larger store |
| 31 | L17 | retry | `spec-vd-retry-L17.json` | canonical=`pc-boxy`; canonical=`rival-pc`; expression=`expr-annoyed` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L17-vd-retry1.png` | verified targeted repair | both figures read annoyed and small beneath taller shelf rows; registered expression route held unchanged |
| 32 | L18 | base | `spec-vd-L18.json` | STEP-1=`fig-drive-maker--d6de7980` (reviewed canonical-derived figure) | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L18.png` | defect: expression drift | reviewed card's half-smile became a downcast face in the composed scene |
| 33 | L18 figure card | retry | `spec-vd-retry-L18.json` | canonical=`drive-maker`; expression=`expr-smug`; STEP-1=`fig-drive-maker--expr-smug--84b1254d` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-drive-maker--expr-smug--84b1254d.png` | verified figure card | L18 scene changed the reviewed card's half-smile into a downcast face; re-authored to a registered smug-expression card |
| 34 | L18 | retry | `spec-vd-retry-L18-scene.json` | STEP-1=`fig-drive-maker--expr-smug--84b1254d` (reviewed) | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L18.png` | verified targeted repair; promoted parent | downcast scene face replaced by an explicit registered smug-expression STEP-1 mechanism |
| 35 | L14 | parent-regen | `spec-vd-L14.json` | parent=`assets/scenes/L13.png` sha256=`69f9795d…c10ae7`; style-anchor | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L14.png` | verified clean | changed: closed shell now open with three stored-content compartments |
| 36 | L19 | parent-regen | `spec-vd-L19.json` | parent=`assets/scenes/L18.png` sha256=`47f28726…df91`; canonical=`drive-maker` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L19.png` | verified clean; promoted parent | changed: one open brass cashbox now sits beside the drive |
| 37 | L20 | parent-regen | `spec-vd-L20.json` | parent=`assets/scenes/L19.png` sha256=`b8549e07…e08c4`; canonical=`drive-maker` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L20.png` | verified clean | changed: hard drive now displayed in a miner's pick-shaped holder |

### Wave 2 close

- Calls: 20 total = 13 shot calls + 5 one-shot retries + 2 STEP-1 figure-card calls; 8 approved calls unused.
- Outcome: L13-L25 all verified; 13 verified, 0 parked, 0 blocked.
- Retry causes: L13 invented product labels; L15 merged copper topology; L16 foreground-dominant cast; L17 wrong rival acting plus dominant cast; L18 scene expression drift from its reviewed figure card. Each received exactly one re-authored shot retry.
- Delta order: L14 followed verified/promoted L13; L19 followed verified/promoted L18; L20 followed verified/promoted L19.
- Provenance: 13 final scene bytes copied to `scratchpad/variant-frames/vd/L13.png` through `L25.png`; every copied SHA-256 matches its D-called scene and manifest row.
- Cost: `$2.680` at the conservative `$0.134/call`; `$0.780` at the provider-table `$0.039/call` comparator.
- Final review: `assets/_review/scene-board.html` rebuilt for L13-L25; scene rows were ruled from pixels and palette rows were advisory only; `stamp_review.py` reported 25 verified / 0 parked overall.
- Ops cost row to send: `Variant D doctrine trial wave 2: 20 calls, 13/13 verified, 0/13 parked; 13 base allowance + at most one retry each + up to 2 STEP-1 figure cards; conservative $0.134/call, provider-table $0.039/call; genlog scratchpad/vpw-var/genlog-vd.md on claude/bricks-variant-vd.`
- Exact five-field TSV payload: `Variant D doctrine trial wave 2: 20 calls, 13/13 verified, 0/13 parked; 13 base allowance + at most one retry each + up to 2 STEP-1 figure cards; conservative $0.134/call, provider-table $0.039/call; genlog scratchpad/vpw-var/genlog-vd.md on claude/bricks-variant-vd.	gemini-3-pro-image	gemini-3-pro-image	bricks variant D trial wave 2 13 shots	2.680`

## Boss grading note — wave 2 (2026-08-21)

- Independent Claude vision check (claude-sonnet-5, read-only, pixels only) concurred with 13/13 `verified` rulings: L13→L14 holds with the opened shell as the only change; L18→L19→L20 holds with one change per step (cashbox, pick-holder) and a consistent `drive-maker` identity; L16/L17 show only the two personified computers, small and non-dominant; L15 three isolated pairs; L25 bakes exactly `HARD DRIVE`. No gibberish, no unrequested humans, no blue/orange-dominant field.
- Occupancy note: L18–L20 carry ~4 blurred background figures beyond the glass — authored ("competition blurs beyond glass"), so the drive-seller stage sits in the 4–6 bucket; the near counter zone stays a single figure.

## Wave 3A (regens L01/L03/L04/L06–L10/L17/L22/L25 + L26–L32)

- Date: `2026-08-21`
- Branch: `claude/bricks-variant-vd`
- Video: `2026-07-28-bricks-fresh`
- Requested model: `gemini-3-pro-image`
- Responding model: recorded per call
- Image size: `1K`
- Aspect: `16:9`
- Conservative rate: `$0.134/call`
- Provider-table comparator: `$0.039/call`
- Base allowance: `18`
- Retry allowance: `18` (one re-authored retry per failing shot)
- STEP-1 figure-card allowance: up to `5`
- Maximum calls: `41`
- Conservative ceiling: `$5.494`
- Provider comparator ceiling: `$1.599`
- Spend gate: PASSED — Daniel commissioned this wave on `2026-08-21`.
- Upstream authority: `shots.json` at HEAD is the lint-passed, critic-passed D fragment L01–L50; this window is 18 shots.
- Superseded regen bytes: L01, L03, L04, L06, L07, L08, L09, L10, L17, L22, L25.
- Holds: L05→L06; L07→L08→L09; L16→L17. Each delta waits for its verified parent.
- Pre-D archive rows: L26, L28, L29, L30, L31, L35, L36, L37, L40, L41, L42, L43, L50, L27, L32, L33, L44, L46, L47, L48, L49, L34, L38, L39, L45, L169, L84, L114, L198, L65, L112, L86.
- Pre-D archived PNGs: L26, L27, L28, L29, L30, L31, L32, L33, L35, L36, L37, L38, L40, L41, L42, L43, L44, L45, L46, L47, L48, L49, L50, L65, L84, L86, L112, L114, L169, L198. No matching non-D rows existed in `assets/_review/merged.json`.

### Wave 3A calls

| call | shot | base/retry/parent-regen | spec | seed roles | requested model | responding model | $0.134 cost | $0.039 comparator | output | fresh-eyes verdict | retry cause/park reason |
| ---: | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| 38 | L01 | base | `spec-vd-wave3A.json` | lettering=`lettering-marker-italic`; style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L01.png` | defect — calendar rendered `1980S` instead of authored `1980s` | — |
| 39 | L03 | base | `spec-vd-wave3A.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L03.png` | clean — trophy/ledger corporate-office mechanism foregrounds the joke | — |
| 40 | L04 | base | `spec-vd-wave3A.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L04.png` | clean — seal, contract and revealed cash compartment foreground the scam | — |
| 41 | L07 | base | `spec-vd-wave3A.json` | crowd-exemplar; Forge §2d appended | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L07.png` | defect — tall detailed shoppers occupy the foreground edge | — |
| 42 | L10 | base | `spec-vd-wave3A.json` | crowd-exemplar; Forge §2d appended | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L10.png` | defect — crowd is foreground-dominant and breaks the bounded rear geometry | — |
| 43 | L22 | base | `spec-vd-wave3A.json` | crowd-exemplar; lettering=`lettering-marker-italic`; Forge §2d appended | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L22.png` | clean — exact `26,000`, rear worker line and packing subject | — |
| 44 | L25 | base | `spec-vd-wave3A.json` | canonical=`pc-boxy`; expression=`expr-delighted`; lettering=`lettering-marker-italic` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L25.png` | clean — pc-boxy identity/delight and exact `HARD DRIVE` | — |
| 45 | L26 | base | `spec-vd-wave3A.json` | lettering=`lettering-marker-italic`; style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L26.png` | clean — world routes and three exact `HARD DRIVE` cartons | — |
| 46 | L27 | base | `spec-vd-wave3A.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L27.png` | clean — unnamed dark factory corridor and open carton | — |
| 47 | L28 figure card | base | `spec-vd-wave3A.json` | canonical=`miniscribe-rep`; pose=`action-present`; expression=`expr-deadpan`; STEP-1=`fig-miniscribe-rep--action-present--expr-deadpan--de7f3591` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-miniscribe-rep--action-present--expr-deadpan--de7f3591.png` | defect — identity/costume drift, elongated body and five-digit hand | L28 scene uncalled and parked; five-card allowance exhausted |
| 48 | L29 | base | `spec-vd-wave3A.json` | lettering=`lettering-marker-italic`; style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L29.png` | clean — Colorado relief, workshop pin and exact `1980` | — |
| 49 | L30 figure card | base | `spec-vd-wave3A.json` | canonical=`terry-johnson`; expression=`expr-thinking`; STEP-1=`fig-terry-johnson--expr-thinking--1bd7931d` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-terry-johnson--expr-thinking--1bd7931d.png` | clean STEP-1 card — Terry identity/costume/thinking register | card promoted; L30 scene generated at call 53 |
| 50 | L31 figure card | base | `spec-vd-wave3A.json` | canonical=`miniscribe-rep`; pose=`action-powerstance`; expression=`expr-delighted`; STEP-1=`fig-miniscribe-rep--action-powerstance--expr-delighted--a7f76f3b` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-miniscribe-rep--action-powerstance--expr-delighted--a7f76f3b.png` | clean STEP-1 card — miniscribe identity, power stance and delight | card promoted; L31 scene generated at call 54 |
| 51 | L32 ibm-suit figure card | base | `spec-vd-wave3A.json` | canonical=`ibm-suit`; STEP-1=`fig-ibm-suit--5ca0c6c1` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-ibm-suit--5ca0c6c1.png` | defect — IBM pinstripe suit replaced by teal work jacket and khakis | L32 scene uncalled and parked; five-card allowance exhausted |
| 52 | L32 miniscribe-rep figure card | base | `spec-vd-wave3A.json` | canonical=`miniscribe-rep`; STEP-1=`fig-miniscribe-rep--5ca0c6c1` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-miniscribe-rep--5ca0c6c1.png` | clean STEP-1 card — miniscribe identity and costume | card clean, but L32 remained blocked by the failed IBM card |
| 53 | L30 | base | `spec-vd-wave3A-resume.json` | STEP-1=`fig-terry-johnson--expr-thinking--1bd7931d` (reviewed canonical-derived figure) | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L30.png` | clean — Terry leads the repeating drive-assembly bays | — |
| 54 | L31 | base | `spec-vd-wave3A-resume.json` | STEP-1=`fig-miniscribe-rep--action-powerstance--expr-delighted--a7f76f3b` (reviewed canonical-derived figure) | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L31.png` | clean — delighted power stance carries the contained furnace-hot beat | — |
| 55 | L07 | retry | `spec-vd-retry-L07.json` | crowd-exemplar; Forge §2d appended | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L07-vd-retry1.png` | clean retry — compact far-rail crowd, approved rig and empty near aisle | foreground-edge tall human crowd replaced by a compact far-rail queue with an empty broad foreground aisle |
| 56 | L06 | parent-regen | `spec-vd-L06.json` | parent=`assets/scenes/L05.png` sha256=`dca7190c…061b`; lettering; style-anchor | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L06.png` | defect — drafting board displaced the held `1983` calendar | changed: inventor drafting board now shows the same computer as a rough exploded blueprint |
| 57 | L06 | retry | `spec-vd-retry-L06.json` | parent=`assets/scenes/L05.png` sha256=`dca7190c…061b`; lettering; style-anchor | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L06-vd-retry1.png` | clean retry — L05 holds and narrow back-wall exploded board is the sole delta | drafting board that displaced the `1983` calendar replaced by a narrow back-wall board with the held calendar explicit |
| 58 | L08 | parent-regen | `spec-vd-L08.json` | parent=`assets/scenes/L07.png` sha256=`5564d9ea…8d47`; crowd-exemplar; Forge §2d appended | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L08.png` | clean — L07 holds and the rear shoppers alone gain cartons | changed: the same rear shoppers now cradle newly purchased beige computer cartons |
| 59 | L09 | parent-regen | `spec-vd-L09.json` | parent=`assets/scenes/L08.png` sha256=`f3930737…b00e`; crowd-exemplar; Forge §2d appended | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L09.png` | clean — L08 holds and the shelf wall alone becomes mostly bare | changed: the once-full shelf wall is now mostly bare |
| 60 | L17 | parent-regen | `spec-vd-L17.json` | parent=`assets/scenes/L16.png` sha256=`28151c30…7c4a`; canonical=`pc-boxy`; canonical=`rival-pc` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L17.png` | clean — L16 holds and both face panels alone become annoyed | critic regen; changed: both computers' face panels now carry annoyance |
| 61 | L01 | retry | `spec-vd-retry-L01.json` | lettering=`lettering-marker-italic`; style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L01-vd-wave3A-retry1.png` | clean retry — text-free period-object mechanism foregrounds early eighties | case-mismatched decade lettering replaced by a text-free early-eighties object cluster |
| 62 | L10 | retry | `spec-vd-retry-L10.json` | crowd-exemplar; Forge §2d appended | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L10-vd-wave3A-retry1.png` | defect/park — Victorian dress breaks iPhone analogy; crowd bodies remain too tall | foreground-dominant launch crowd replaced by a compact queue beyond a deep doorway and empty oak floor |

### Wave 3A close

- Calls: 25 total — 16 base/parent-regens, 4 one-shot retries, 5 STEP-1 figure cards; 16/18 scene ids called and 2 scenes remained uncalled after card failures.
- Verified (15): L01, L03, L04, L06, L07, L08, L09, L17, L22, L25, L26, L27, L29, L30, L31.
- Parked (3): L10 — one retry fixed depth but rendered a Victorian queue and retained tall crowd bodies; L28 — uncalled because its only STEP-1 card lost miniscribe identity/costume and broke the hand/body rig; L32 — uncalled because the IBM card replaced the pinned navy pinstripe suit.
- Retry causes: L01 case-mismatched decade lettering; L06 held `1983` calendar displaced; L07 foreground-edge tall crowd; L10 foreground-dominant crowd, then retry defect above. Each used exactly one retry.
- Figure cards minted (5/5): L28 miniscribe-present-deadpan (defect); L30 Terry-thinking (clean); L31 miniscribe-powerstance-delighted (clean); L32 IBM neutral (defect); L32 miniscribe neutral (clean). No card retries remained.
- Frames: 15 verified D-called SHA-matched frames copied to `variant-frames/vd`; all 11 old regen bytes preserved in `_superseded` with their prior SHA-256, including parked L10; L28/L32 remain absent.
- Accounting: 25 × $0.134 = $3.350 conservative; 25 × $0.039 = $0.975 provider-table comparator. Cap intact: 16/41 calls unused (2 scene-base, 14 retry, 0 card allowance).
- Cumulative D manifest: 62 calls; $8.308 conservative; $2.418 provider-table; 29 verified / 3 parked across L01–L32.

### Ops cost row (five tab-separated fields; boss writes ledger)

Variant D doctrine wave 3A: 25 calls, 15/18 verified, 3/18 parked; 16 base/parent-regen calls, 4 retries, 5 STEP-1 cards; conservative $0.134/call, provider-table $0.039/call; genlog scratchpad/vpw-var/genlog-vd.md on claude/bricks-variant-vd.	gemini-3-pro-image	gemini-3-pro-image	bricks variant D wave 3A 17 shots	3.350

## Wave 3B (L33–L50)

- Date: `2026-08-21`
- Branch: `claude/bricks-variant-vd`
- Video: `2026-07-28-bricks-fresh`
- Requested model: `gemini-3-pro-image`
- Responding model: recorded per call
- Image size: `1K`
- Aspect: `16:9`
- Conservative rate: `$0.134/call`
- Provider-table comparator: `$0.039/call`
- Base allowance: `18`
- Retry allowance: `18` (one re-authored retry per failing shot)
- STEP-1 figure-card allowance: up to `9`, only when demanded by the dry run
- Maximum calls: `45`
- Conservative ceiling: `$6.030`
- Provider comparator ceiling: `$1.755`
- Spend gate: PASSED — Daniel commissioned this wave on `2026-08-21`.
- Upstream authority: `shots.json` at HEAD is the lint-passed, critic-passed D fragment L01–L50; this window is L33–L50 only.
- Dry run: 13 non-delta scenes + 9 STEP-1 cards; zero `unregistered slug` lines; each figure card resolves from its registry canonical; 16:9/1K scenes and 2:3/1K cards; no API calls.
- Holds: revenue-comparison L37→L38→L39; founder-exit L44→L45; bank-rescue L47→L48→L49. Every child waits for its immediate verified/promoted parent; L45→L46 is a hard cut.

### Wave 3B calls

| call | shot | base/retry/parent-regen | spec | seed roles | requested model | responding model | $0.134 cost | $0.039 comparator | output | fresh-eyes verdict | retry cause/park reason |
| ---: | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| 63 | L33 figure card | base | `spec-vd-wave3B.json` | canonical=`miniscribe-rep`; STEP-1=`fig-miniscribe-rep--33e8c57f` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-miniscribe-rep--33e8c57f.png` | verified figure card | Miniscribe identity, costume, neutral acting and rig clean; L33 scene initially skipped pending P3 review |
| 64 | L34 | base | `spec-vd-wave3B.json` | lettering=`lettering-marker-italic`; style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L34.png` | verified | exact `125 MILLION`; clean balance causality |
| 65 | L35 figure card | base | `spec-vd-wave3B.json` | canonical=`miniscribe-rep`; pose=`action-powerstance`; expression=`expr-delighted`; STEP-1=`fig-miniscribe-rep--action-powerstance--expr-delighted--f0de2364` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-miniscribe-rep--action-powerstance--expr-delighted--f0de2364.png` | verified figure card | identity/costume, power stance, delighted register and rig clean; L35 scene initially skipped pending P3 review |
| 66 | L36 figure card | base | `spec-vd-wave3B.json` | canonical=`miniscribe-rep`; pose=`action-present`; expression=`expr-delighted`; STEP-1=`fig-miniscribe-rep--action-present--expr-delighted--0c18ff22` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-miniscribe-rep--action-present--expr-delighted--0c18ff22.png` | defect — three-arm anatomy | L36 scene uncalled and parked; nine-card allowance exhausted |
| 67 | L37 | base | `spec-vd-wave3B.json` | lettering=`lettering-marker-italic`; style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L37.png` | verified parent | exact `600 MILLION`; clean collapsed-bellows base |
| 68 | L40 | base | `spec-vd-wave3B.json` | lettering=`lettering-marker-italic`; style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L40.png` | failed; retried at call 83 | invented MiniScribe carton lettering |
| 69 | L41 figure card | base | `spec-vd-wave3B.json` | canonical=`ibm-suit`; pose=`action-armscrossed`; expression=`expr-deadpan`; STEP-1=`fig-ibm-suit--action-armscrossed--expr-deadpan--c258436d` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-ibm-suit--action-armscrossed--expr-deadpan--c258436d.png` | verified figure card | IBM identity, navy pinstripe suit, crossed arms, deadpan acting and rig clean |
| 70 | L42 | base | `spec-vd-wave3B.json` | style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L42.png` | verified | factory conveyor-to-cliff causality clean |
| 71 | L43 figure card | base | `spec-vd-wave3B.json` | canonical=`line-worker`; pose=`hold-paper-by-sides`; expression=`expr-crestfallen`; STEP-1=`fig-line-worker--hold-paper-by-sides--expr-crestfallen--9c2bfecf` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-line-worker--hold-paper-by-sides--expr-crestfallen--9c2bfecf.png` | verified figure card | identity/costume, paper hold, crestfallen acting and rig clean |
| 72 | L44 figure card | base | `spec-vd-wave3B.json` | canonical=`terry-johnson`; pose=`action-slump`; expression=`expr-crestfallen`; STEP-1=`fig-terry-johnson--action-slump--expr-crestfallen--c692247f` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-terry-johnson--action-slump--expr-crestfallen--c692247f.png` | verified figure card | Terry identity/costume, slumped shoulders, crestfallen acting and rig clean |
| 73 | L46 figure card | base | `spec-vd-wave3B.json` | canonical=`miniscribe-rep`; pose=`action-slump`; expression=`expr-worried`; STEP-1=`fig-miniscribe-rep--action-slump--expr-worried--307850b2` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-miniscribe-rep--action-slump--expr-worried--307850b2.png` | defect — pose fidelity | L46 scene uncalled and parked; upright body lost the registered slump; nine-card allowance exhausted |
| 74 | L47 figure card | base | `spec-vd-wave3B.json` | canonical=`hq-banker`; pose=`action-present`; expression=`expr-deadpan`; STEP-1=`fig-hq-banker--action-present--expr-deadpan--31d3064d` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-hq-banker--action-present--expr-deadpan--31d3064d.png` | verified figure card | HQ identity/costume, present gesture, restrained deadpan register and rig clean |
| 75 | L50 figure card | base | `spec-vd-wave3B.json` | canonical=`qt-wiles`; pose=`action-powerstance`; expression=`expr-smug`; STEP-1=`fig-qt-wiles--action-powerstance--expr-smug--56775123` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/fig-qt-wiles--action-powerstance--expr-smug--56775123.png` | verified figure card | Q.T. identity/costume, power stance, smug acting and rig clean |
| 76 | L33 | base | `spec-vd-wave3B-resume.json` | STEP-1=`fig-miniscribe-rep--33e8c57f` (reviewed) | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L33.png` | verified | scale-dominant cartons and identity clean |
| 77 | L35 | base | `spec-vd-wave3B-resume.json` | STEP-1=`fig-miniscribe-rep--action-powerstance--expr-delighted--f0de2364` (reviewed); lettering | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L35.png` | parked | undeclared detailed workers; re-authored retry blocked by STEP-1 remint after card cap |
| 78 | L41 | base | `spec-vd-wave3B-resume.json` | STEP-1=`fig-ibm-suit--action-armscrossed--expr-deadpan--c258436d` (reviewed) | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L41.png` | verified | IBM identity, crossed arms, deadpan register and empty racks clean |
| 79 | L43 | base | `spec-vd-wave3B-resume.json` | STEP-1=`fig-line-worker--hold-paper-by-sides--expr-crestfallen--9c2bfecf` (reviewed) | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L43.png` | parked | group/near-corridor geometry failed; re-authored retry blocked by STEP-1 remint after card cap |
| 80 | L44 | base | `spec-vd-wave3B-resume.json` | STEP-1=`fig-terry-johnson--action-slump--expr-crestfallen--c692247f` (reviewed) | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L44.png` | parked | invented EXIT sign; re-authored retry blocked by STEP-1 remint after card cap |
| 81 | L47 | base | `spec-vd-wave3B-resume.json` | STEP-1=`fig-hq-banker--action-present--expr-deadpan--31d3064d` (reviewed); lettering | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L47.png` | verified parent | exact `HAMBRECHT & QUIST`; set and acting clean |
| 82 | L50 | base | `spec-vd-wave3B-resume.json` | STEP-1=`fig-qt-wiles--action-powerstance--expr-smug--56775123` (reviewed) | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L50.png` | verified | Q.T. identity, power stance and smug acting clean |
| 83 | L40 | retry | `spec-vd-retry-L40.json` | lettering=`lettering-marker-italic`; style-anchor=`scene-style-tile` | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L40-vd-retry1.png` | verified | invented MiniScribe carton lettering replaced by solid-kraft outbound racks |
| 84 | L38 | parent-regen | `spec-vd-L38.json` | parent=`assets/scenes/L37.png` sha256=`eec76c0f…a8e90`; lettering; style-anchor | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L38.png` | failed; retried at call 85 | expansion remained too subtle |
| 85 | L38 | retry | `spec-vd-retry-L38.json` | parent=`assets/scenes/L37.png` sha256=`eec76c0f…a8e90`; lettering; style-anchor | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L38-vd-retry1.png` | parked | bellows still reads collapsed after the tall stretched-rib replacement |
| 86 | L48 | parent-regen | `spec-vd-L48.json` | parent=`assets/scenes/L47.png` sha256=`4e68a732…11ae3`; canonical=`hq-banker`; lettering | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L48.png` | verified parent | exact `20 MILLION` weight is the sole delta |
| 87 | L49 | parent-regen | `spec-vd-L49.json` | parent=`assets/scenes/L48.png` sha256=`cfe05fdc…f3735`; canonical=`hq-banker`; lettering | `gemini-3-pro-image` | `gemini-3-pro-image` | 0.134 | 0.039 | `visual-kit/_staging/L49.png` | verified | brass track is the sole delta; parent composition and lettering hold |

### Wave 3B closure

- Calls: `25` total = `11` standalone/stage-base scene calls + `3` parent-regens + `2` one-shot retries + `9` demanded STEP-1 figure cards. Allowance unused: `20/45` total calls and `16/18` scene retries; the `9/9` card cap was used.
- Verified `10/18`: `L33`, `L34`, `L37`, `L40` (retry: invented carton lettering replaced by solid-kraft outbound racks), `L41`, `L42`, `L47`, `L48`, `L49`, `L50`.
- Parked `8/18`: `L35` undeclared workers (positive retry blocked by post-cap STEP-1 remint); `L36` uncalled, three-arm card; `L38` bellows still collapsed after its one retry; `L39` uncalled, parent L38 not verified; `L43` group/corridor geometry failed (positive retry blocked by post-cap STEP-1 remint); `L44` invented EXIT sign (positive retry blocked by post-cap STEP-1 remint); `L45` uncalled, parent L44 not verified; `L46` uncalled, slump card remained upright.
- Figure cards minted: `9`; clean `L33`, `L35`, `L41`, `L43`, `L44`, `L47`, `L50`; defective `L36` and `L46`.
- Copied comparison frames: `14` D-called bytes with matching scene-manifest path and SHA-256; uncalled `L36`, `L39`, `L45`, `L46` remain absent.
- Cost: `25 × $0.134 = $3.350`; provider-table comparator `25 × $0.039 = $0.975`; the `$6.030` conservative wave ceiling remained intact.
- Cumulative D manifest: `87` calls; `$11.658` conservative; `$3.393` provider-table; `39` verified / `11` parked across L01–L50.

### Ops cost row (five tab-separated fields; boss writes ledger)

Variant D doctrine wave 3B: 25 calls, 10/18 verified, 8/18 parked; 14 base/parent-regen calls, 2 retries, 9 STEP-1 cards; conservative $0.134/call, provider-table $0.039/call; genlog scratchpad/vpw-var/genlog-vd.md on claude/bricks-variant-vd.	gemini-3-pro-image	gemini-3-pro-image	bricks variant D wave 3B 18 shots	3.350

## Boss grading note — wave 3A (2026-08-21)

- Independent Claude vision check (claude-sonnet-5, read-only, pixels only) concurred with 12/15 `verified` rulings: no brick visible in L01/L03, no gibberish or unrequested humans, L05→L06 / L07→L08→L09 / L16→L17 each hold set+camera with exactly one visible change, L07–L09 crowd bounded beyond the rail with the near lane clear, identities correct for `pc-boxy`/`rival-pc`/`miniscribe-rep`, `HARD DRIVE` lettering exact on L25/L26.
- Dissents: **L22** — the near zone is boxed in by foreground carton stacks (narrow centre gap, not the clear lane the crowd rule requires); **L30** — `expr-thinking` reads as neutral/startled, no pose cue; **L03** — trophy-on-ledger reads as ironic but not legibly "funniest" in a 2 s cold read. L22 and L30 retain their unspent single retry → wave 3C; L03 stays verified as a taste call for the board.
