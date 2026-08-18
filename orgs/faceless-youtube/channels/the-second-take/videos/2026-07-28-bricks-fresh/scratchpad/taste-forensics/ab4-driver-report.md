# $0 engine-routing A/B round-4 frozen driver report

## Frozen selection

This round isolates the `char-seed` cell: exactly 10 builder-emitted STEP-1 figure cards, all `2:3` at `1K`. Every output name begins `ab4-`; both established engines/rates are enabled with `hard_cap_usd: 2.5`.

| id | source | cast | pose | expression | seeds |
|---|---:|---|---|---|---:|
| `fig-drive-maker--hold-both-hands--expr-greedy--12637e2e` | L19 | drive-maker | hold-both-hands | greedy | 3 |
| `fig-brick-foreman--action-shrug--expr-deadpan--1a78cea1` | L23 | brick-foreman | action-shrug | deadpan | 3 |
| `fig-miniscribe-rep--action-celebrate--expr-delighted--d0a1613b` | L35 | miniscribe-rep | action-celebrate | delighted | 3 |
| `fig-terry-johnson--carry-by-handle--expr-crestfallen--c5210e60` | L47 | terry-johnson | carry-by-handle | crestfallen | 3 |
| `fig-tv-chef--hold-both-hands--expr-worried--56a59b22` | L60 | tv-chef | hold-both-hands | worried | 3 |
| `fig-qt-wiles--expr-smug--5d92f2c3` | L69 | qt-wiles | resting/no pose seed | smug | 2 |
| `fig-auditor-rep--action-thumbsup--expr-deadpan--6c7b996d` | L100 | auditor-rep | action-thumbsup | deadpan | 3 |
| `fig-line-worker--hold-one-hand--expr-annoyed--39be0ae6` | L173 | line-worker | hold-one-hand | annoyed | 3 |
| `fig-rifenburgh-ceo--hold-one-hand--expr-thinking--49deb800` | L180 | rifenburgh-ceo | hold-one-hand | thinking | 3 |
| `fig-hq-banker--expr-deadpan--55bd2c0a` | L213 | hq-banker | resting/no pose seed | deadpan | 2 |

Coverage is 10/10 distinct casts, eight 3-seed cards (canonical + expression + pose) and two naturally emitted 2-seed cards (canonical + expression). There are no duplicate casts inside ab4; unavoidable overlap: none.

## Selection deviations

- None of the listed ab2/ab3 IDs is reused. Where a prior-round cast returns, the selected card changes its pose and/or expression: drive-maker is now hold-both-hands/greedy, brick-foreman action-shrug/deadpan, terry carry-by-handle/crestfallen, qt-wiles resting/smug, tv-chef hold-both-hands/worried, auditor-rep action-thumbsup/deadpan, rifenburgh-ceo hold-one-hand/thinking, and hq-banker resting/deadpan.
- The two two-seed cards are not hand-normalized to three seeds: the builder emits them without a pose seed, so their resting stance is retained exactly as its STEP-1 payload specifies.
- No `_staging` seed is used. All 28 seed paths resolve on disk and their recorded SHA-256 values match.

## $0 verification

The sanctioned dry builder was scoped over `../../shots.json` and returned zero:

```text
py -3 g4_dry.py batch ../../shots.json C:\Users\danie\AppData\Local\Temp\ab4-final-builder-slate.json L19,L23,L35,L47,L60,L69,L100,L173,L180,L213
== batch: 10 scene(s) + 12 STEP-1 figure gen(s), 0 not generated ==
BUILDER_EXIT=0
```

Its dry `gen` pass assembled 22 prompts from that slate (the ten selected cards plus their dependent scene requests) with zero API calls and zero files written. Fresh reassembly of each selected card produced byte-identical UTF-8 provider prompt text:

```text
SPEC_SHA256=f5cc5482c39375641bdb914c55b04d9f22375b6f457724b28336816c2d2c3edc
PROMPTS_UTF8_SHA256=e61ea6fecab86e0a2f5095e1bc6fea107d3f26eb179cb6036256872ba3db7f6e
REASSEMBLY=PASS items=10
SEEDS=PASS total=28 sha256_match=28 staging=0
```

Both A/B driver dry runs returned before the live branch. In `ab_gen.py`, that branch returns immediately after validation and before `load_env`, so neither command resolves a key. Recursive `ab-out/` SHA snapshots and the `ab-genlog.md` SHA were unchanged before and after both commands:

```text
py -3 ab_gen.py --spec ab4-test-items.json --model gemini-3-pro-image --dry-run
py -3 ab_gen.py --spec ab4-test-items.json --model gemini-2.5-flash-image --dry-run
DRY_RUNS=[["gemini-3-pro-image", 0, 10, ""], ["gemini-2.5-flash-image", 0, 10, ""]]
AB_OUT_UNCHANGED=True
AB_GENLOG_UNCHANGED=True
```

No provider call, key lookup, output write, or generation-log write occurred.

## Nominal arm costs

- Gemini 3 Pro Image: 10 x $0.134 = **$1.340**, below the $2.50 cap.
- Gemini 2.5 Flash Image: 10 x $0.039 = **$0.390**, below the $2.50 cap.

## Boss live commands

Run from this `taste-forensics` directory:

```text
py -3 ab_gen.py --spec ab4-test-items.json --model gemini-3-pro-image
py -3 ab_gen.py --spec ab4-test-items.json --model gemini-2.5-flash-image
```
