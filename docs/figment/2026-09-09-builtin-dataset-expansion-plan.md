# Built-in candidate dataset expansion plan — 2026-09-09

Root has authorized candidate expansion after the six-image direct-g01 pilot was
reviewed as promising. This plan does not accept a dataset or mark any ungenerated
image eligible. Every new slot uses the unchanged g01 bytes directly; generated
images must never be chained.

## Intended split

The prospective **train** split has 20 rows: canonical `g01.jpg`, pilot slots 01,
02, 04, and 05, plus new slots 07–21. Pilot slot 03 (full body) and slot 06
(close side light) are reserved as two **eval** rows outside trainer media. The
new prompts add stronger directional turns, different body poses, restrained
expressions, indoor and outdoor settings, casual opaque outfits, and daylight,
overcast, and practical-light conditions. They avoid repeating the pilot's
near-frontal black-shirt/warm-wall composition. The harder stressors include a
roughly 60-degree near-profile face and gaze, a natural open-mouth smile with
upper teeth, direct side sunlight with distinct shadows, and a slightly raised
head and gaze; independent review may reject any of these harder cases.

The exact generation requests are in MAIN
`_private/figment-builtin-dataset-20260909-v1/expansion-prompts.json`. Generation
is a candidate-producing step only. Review must inspect original pixels for
identity, clearly adult presentation, anatomy, clothing coverage, prompt fit,
and photographic texture before any row receives a training-eligibility ruling.

## Existing curation path

The existing entry point is:

```text
python orgs/figment/pipeline/train/curate_single_seed.py \
  --request <staging>/curation-request.json \
  --out <new-dataset-directory>
```

`curation-request.json` uses `figment/single-seed-curation-request@1`; its fixed
adjacent `sources/` directory contains each derivative and its matching
`*.provenance.json`. The request names `creator-001`, trigger
`creator001krea2`, canonical seed `anchors/g01.jpg` with SHA-256
`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`, and
unique entries with `kind`, `split`, a bounded `variation` object, and a
single-line caption of at most 320 bytes beginning `creator001krea2 `. The sole
seed row is `seed-g01`, `kind: seed`, `split: train`; derivatives name one staged
image and one staged provenance file.

For each derivative, the compiler requires a
`figment/generated-input-experiment@1` provenance document bound to creator-001,
the exact g01 hash, the exact output filename/hash, and first-generation wording.
It also requires the review to record `training_eligible: true`; a rejected row
cannot be made eligible by compilation. The compiler snapshots all train and
eval evidence, materializes only train rows as numbered PNG/caption pairs, and
writes `dataset_curation.json` plus `dataset_manifest.json`. It creates an
unapproved draft and never writes `dataset-approval.json`.

After originals exist and receive real rulings, the evidence preparer must create
the request and per-image provenance sidecars from those exact bytes and recorded
decisions. The preparer may identify root as the reviewer when root actually made
the ruling; it must not impersonate the user. There is no current built-in
inventory adapter for this preparation, but no compiler implementation gap is
proven: the existing request, sidecar, curation, and lineage contracts support
the intended split. A later operator action may run `figment_train.py
accept-dataset` only after the finalized 20-row train draft is inspected.
Nothing in this plan supplies that acceptance.
