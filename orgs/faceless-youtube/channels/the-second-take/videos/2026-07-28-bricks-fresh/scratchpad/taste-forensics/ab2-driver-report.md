# $0 three-way A/B round-2 frozen driver report

## Frozen selection

| id | kind | source | cast | pose / expression or plate |
|---|---|---|---|---|
| `fig-terry-johnson--action-armscrossed--expr-thinking--5ccd2153` | STEP-1 figure card | L30 | terry-johnson | armscrossed / thinking |
| `fig-hq-banker--action-offering--expr-deadpan--3890f623` | STEP-1 figure card | L50 | hq-banker | offering / deadpan |
| `fig-qt-wiles--action-powerstance--expr-smug--018b2602` | STEP-1 figure card | L54 | qt-wiles | powerstance / smug |
| `fig-tv-chef--action-accuse--expr-annoyed--3a5c707d` | STEP-1 figure card | L55 | tv-chef | accuse / annoyed |
| `fig-auditor-rep--action-slump--expr-crestfallen--f5da9312` | STEP-1 figure card | L242 | auditor-rep | slump / crestfallen |
| `L87` | scene | L87, audit setup | crowd | promoted cast-free `assets/scenes/L84.png` + crowd exemplar |
| `L96` | scene | L96, audit lockbox | cast-free | promoted cast-free `assets/scenes/L84.png` + style tile |
| `L169` | scene | L169, Christmas cut | crowd | promoted cast-free `assets/scenes/L28.png` + crowd exemplar |
| `L232` | scene | L232, stripped floor | cast-free | promoted cast-free `assets/scenes/L28.png` + style tile |
| `L244` | scene | L244, counterfactual floor | crowd | promoted cast-free `assets/scenes/L28.png` + crowd exemplar |

`ab2-test-items.json` has exactly ten items, `image_size: "1K"`, both engines, the round-1 rates, and `hard_cap_usd: 1.5`. Every output name begins `ab2-`; no round-1 id or output name is reused.

The cards cover five distinct cast members (the maximum selected here), none used in round 1, with five distinct pose/expression pairs. The five scenes span audit setup/lockbox, Christmas cut, stripped-floor aftermath, and counterfactual acts. All scene seeds include a promoted cast-free plate confirmed in `assets/scenes/manifest.json` and no seed uses `_staging/`.

## Selection deviation

The manifest has seven on-disk, promoted cast-free plates (`L28`, `L65`, `L84`, `L86`, `L112`, `L114`, `L198`). For scene candidates, the dry builder's current review gate accepted only the usable `L28` and `L84` plate paths in this scope. It refused `L86` and `L198` because their current review records fail `act_text`; using either would freeze a known dead live path. No all-resolvable, non-`_staging` scene requests seeded from the other plate places were available. The scene sample therefore has two distinct plates, rather than five, but distinct acts and compositions.

## $0 verification

Dry construction succeeded with no credential or network capability:

```text
py -3 g4_dry.py batch ../../shots.json C:\Users\danie\AppData\Local\Temp\ab2-candidate-five.json L30,L50,L54,L55,L242
== batch: 5 scene(s) + 5 STEP-1 figure gen(s), 0 not generated ==

py -3 g4_dry.py batch ../../shots.json C:\Users\danie\AppData\Local\Temp\ab2-scenes-cleared.json L87,L96,L169,L232,L244
== batch: 5 scene(s) + 0 STEP-1 figure gen(s), 0 not generated ==
```

Independent reassembly reconstructed every provider prompt from those dry slates and compared UTF-8 bytes against the frozen spec. It also rehashed every recorded absolute seed path:

```text
PASS parsed=10 figure_cards=5 scenes=5 distinct_figure_cast=5
PASS seeds=24 exist=24 sha256_match=24 staging_seeds=0
PASS prompts_byte_identical=10 scene_promoted_cast_free_plate=5
PASS nominal_pro=1.340 <= cap=1.500; nominal_flash=0.390 <= cap=1.500
```

Both driver preflights used `--dry-run`. In `ab_gen.py`, this returns immediately after item/seed validation and before both the cap/live branch and the `.env` key lookup. `ab-out/` and the pre-existing `ab-genlog.md` were snapshotted before and after: both were unchanged.

```text
py -3 ab_gen.py --spec ab2-test-items.json --model gemini-3-pro-image --dry-run
PRO_EXIT=0
AB_OUT_UNCHANGED=True
AB_GENLOG_UNCHANGED=True
```

Verbatim tail:

```text
DRY item=L169 prompt_chars=4128 seeds=2 aspect=16:9 output=C:\Users\danie\kb-worktrees\boss-taste-forensics\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh\scratchpad\taste-forensics\ab-out\ab2-L169__pro.png
DRY item=L232 prompt_chars=3127 seeds=2 aspect=16:9 output=C:\Users\danie\kb-worktrees\boss-taste-forensics\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh\scratchpad\taste-forensics\ab-out\ab2-L232__pro.png
DRY item=L244 prompt_chars=3926 seeds=2 aspect=16:9 output=C:\Users\danie\kb-worktrees\boss-taste-forensics\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh\scratchpad\taste-forensics\ab-out\ab2-L244__pro.png
```

```text
py -3 ab_gen.py --spec ab2-test-items.json --model gemini-2.5-flash-image --dry-run
FLASH_EXIT=0
AB_OUT_UNCHANGED=True
AB_GENLOG_UNCHANGED=True
```

Verbatim tail:

```text
DRY item=L169 prompt_chars=4128 seeds=2 aspect=16:9 output=C:\Users\danie\kb-worktrees\boss-taste-forensics\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh\scratchpad\taste-forensics\ab-out\ab2-L169__flash.png
DRY item=L232 prompt_chars=3127 seeds=2 aspect=16:9 output=C:\Users\danie\kb-worktrees\boss-taste-forensics\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh\scratchpad\taste-forensics\ab-out\ab2-L232__flash.png
DRY item=L244 prompt_chars=3926 seeds=2 aspect=16:9 output=C:\Users\danie\kb-worktrees\boss-taste-forensics\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh\scratchpad\taste-forensics\ab-out\ab2-L244__flash.png
```

No provider call, key resolution, `ab-out/` write, or `ab-genlog.md` write occurred.

## Nominal arm costs

- Gemini 3 Pro Image: 10 × $0.134 = **$1.340**, below the $1.50 cap.
- Gemini 2.5 Flash Image: 10 × $0.039 = **$0.390**, below the $1.50 cap.

## Boss live commands

Run from this `taste-forensics` directory:

```text
py -3 ab_gen.py --spec ab2-test-items.json --model gemini-3-pro-image
py -3 ab_gen.py --spec ab2-test-items.json --model gemini-2.5-flash-image
```
