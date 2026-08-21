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
