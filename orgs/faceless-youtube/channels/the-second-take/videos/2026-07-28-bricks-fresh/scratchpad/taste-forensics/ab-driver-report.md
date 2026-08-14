# $0 three-way A/B driver report

## Frozen Gemini spec

| id | kind | cast / source shot | seed count |
|---|---|---|---:|
| `fig-drive-maker--carry-by-handle--expr-deadpan--f1c1d333` | STEP-1 figure card | drive-maker / L18 | 3 |
| `fig-brick-foreman--back-to-viewer--7a3b93be` | STEP-1 figure card | brick-foreman / L22 | 2 |
| `fig-brick-foreman--hold-one-hand--expr-deadpan--ecc1ee75` | STEP-1 figure card | brick-foreman / L27 | 3 |
| `L06` | scene | pc-boxy + crowd / L06 | 3 |
| `L16` | multi-figure scene | pc-boxy, rival computer, + crowd / L16 | 3 |

`ab-test-items.json` freezes full assembled prompts, ordered absolute seed paths, and SHA-256 values. All 14 selected seed paths existed and matched their recorded digest at verification. Its image size is `1K`; the nominal five-item arm cost is $0.670 for Pro and $0.195 for Flash, each below the $1.50 hard cap.

## Deviations

- Act 1 has seven STEP-1 cards but only two available cast members: drive-maker (three cards) and brick-foreman (four). The three-card sample therefore covers the maximum available two distinct cast members, not three.
- L27 is emitted as a scene request, but it requires its freshly generated STEP-1 card under `_staging/`; that PNG is not on disk. To meet the required all-resolvable-seeds rule, the selected scenes are L06 and the explicitly multi-figure L16 instead.

## $0 verification

- `py -3 g4_dry.py batch ../../shots.json ab-dry-full.json L01,L02,L03,L04,L05,L06,L07,L08,L09,L10,L11,L12,L13,L14,L15,L16,L17,L18,L19,L20,L21,L22,L23,L24,L25,L26,L27` exited 0 and reported `27 scene(s) + 7 STEP-1 figure gen(s), 0 not generated` with no in-scope refusals.
- Both Gemini dry-runs exited 0, printed five requests, and neither resolved a key, created `ab-out/`, or wrote `ab-genlog.md`.
- An independent reassembly from `ab-dry-full.json` compared all five prompts byte-for-byte and rechecked all 14 seed SHA-256 values.

## Boss live commands

Run these from this `taste-forensics` directory. They generate only the Gemini arms; run the Codex arm separately against the same frozen spec.

```text
py -3 ab_gen.py --spec ab-test-items.json --model gemini-3-pro-image
py -3 ab_gen.py --spec ab-test-items.json --model gemini-2.5-flash-image
```

Outputs are isolated to `ab-out/<item>__pro.png` and `ab-out/<item>__flash.png`. The driver never retries, refuses pre-existing arm outputs, enforces the selected arm's hard cap before any request, and appends one secret-free result line per provider call to `ab-genlog.md`.
