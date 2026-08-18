# $0 engine-routing A/B round-3 frozen driver report

## Frozen selection

| cell | id | source | cast | rationale |
|---|---|---|---|---|
| `char-seed` | `fig-brick-foreman--back-to-viewer--7a3b93be` | L22 | brick-foreman | Builder-emitted STEP-1 card; canonical + pose = the required two-seed arm. |
| `char-seed` | `fig-drive-maker--carry-by-handle--expr-deadpan--f1c1d333` | L18 | drive-maker | Builder-emitted STEP-1 card with canonical, expression, and pose. |
| `char-seed` | `fig-rifenburgh-ceo--action-armscrossed--expr-thinking--15c18100` | L179 | rifenburgh-ceo | Builder-emitted STEP-1 card with canonical, expression, and pose. |
| `env-plate` | `L65` | L65 | cast-free | Pure wiles-office place-first plate; `PLATE_COMPOSITION` and the scene-style tile only. |
| `env-plate` | `L84` | L84 | cast-free | Pure audit-room place-first plate; `PLATE_COMPOSITION` and the scene-style tile only. |
| `env-plate` | `L114` | L114 | cast-free | Colorado brick-yard cast-free place-first composition; lettering and style anchors preserve its literal payload. |
| `scene` | `L112-rebase` | L112 | cast-free | Promoted rented-warehouse plate re-gen, seeded by that plate plus the style tile. |
| `scene` | `L65-rebase` | L65 | cast-free | Promoted wiles-office plate re-gen, seeded by that plate plus the style tile. |
| `scene` | `L170-rebase` | L170 | crowd | Fresh Christmas-cut continuation, re-based on promoted L28 plus the crowd exemplar; the only crowd item in this cell. |
| `char-env` | `L29` | L29 | miniscribe-rep | Named cast canonical + promoted L28 environment plate. |
| `char-env` | `L66` | L66 | qt-wiles | Named cast canonical + promoted L65 environment plate. |
| `char-env` | `L98` | L98 | brick-foreman | Named cast canonical + promoted L84 environment plate. |

`ab3-test-items.json` contains exactly 12 items: three per cell. Every `output_name` starts with `ab3-`, uses `1K`, enables both AB2 engines/rates, and has `hard_cap_usd: 3.0`.

The character cards use three distinct casts, none in AB2's five (`terry-johnson`, `hq-banker`, `qt-wiles`, `tv-chef`, `auditor-rep`), with seed counts 2/3/3. The scene cell has no `figure` or `canonical` seed role and every item has a promoted place seed; only L170 declares crowd. Every char-env item has a cast canonical and a promoted place plate.

## Selection deviations

- L230 was considered for the crowd scene but excluded at $0: its otherwise on-disk L198 plate is currently review-gated with `act_text` failed. Freezing it would create a known dead live route.
- The two cast-free scene arms are re-gen specs of verified L112 and L65 place payloads, rather than the AB2 L96/L232 variants. This keeps their scene seeds on disk and avoids AB2 source picks.
- The char-env cell uses cast canonicals rather than newly minted STEP-1 cards. This is the allowed `STEP-1 card (or cast canonical)` branch and avoids staging-only dependencies.

## $0 verification

The sanctioned dry builder ran without a credential or network capability:

```text
py -3 g4_dry.py batch ../../shots.json C:\Users\danie\AppData\Local\Temp\ab3-base-candidates2.json L18,L22,L179,L65,L84,L114,L170
== batch: 7 scene(s) + 3 STEP-1 figure gen(s), 0 not generated ==
```

Fresh Forge reassembly rebuilt all stored provider prompts from that dry slate and the documented direct rebase routes. UTF-8 prompt bytes were identical:

```text
PASS prompts_byte_identical=12 utf8_sha256=feb1ecb0a42c2ab526f4152fbee14a044d2d7b021db76e0052965e99cec432cf
PASS items=12 cells=3/3/3/3 char_seed_counts=2/3/3 scene_crowd=1
PASS seeds=24 exist=24 sha256_match=24 staging_seeds=0
```

Both arm drivers were run with `--dry-run`; both returned before the cap/live branch and `.env` key lookup. Recursive `ab-out/` SHA snapshots and the `ab-genlog.md` SHA were identical before and after both runs:

```text
py -3 ab_gen.py --spec ab3-test-items.json --model gemini-3-pro-image --dry-run
py -3 ab_gen.py --spec ab3-test-items.json --model gemini-2.5-flash-image --dry-run
PRO_EXIT=0
FLASH_EXIT=0
AB_OUT_UNCHANGED=True
AB_GENLOG_UNCHANGED=True
```

No provider call, key resolution, `ab-out/` write, or `ab-genlog.md` write occurred.

## Nominal arm costs

- Gemini 3 Pro Image: 12 × $0.134 = **$1.608**, below the $3.00 cap.
- Gemini 2.5 Flash Image: 12 × $0.039 = **$0.468**, below the $3.00 cap.

## Boss live commands

Run from this `taste-forensics` directory:

```text
py -3 ab_gen.py --spec ab3-test-items.json --model gemini-3-pro-image
py -3 ab_gen.py --spec ab3-test-items.json --model gemini-2.5-flash-image
```
