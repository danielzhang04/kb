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
