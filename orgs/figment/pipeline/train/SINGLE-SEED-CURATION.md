# Single-seed curation draft

`curate_single_seed.py` materializes a local, unapproved training dataset from
one fixed identity seed: `creator-001/anchors/g01.jpg`. The request is JSON next
to a fixed `sources/` directory; each derivative names only a plain staged image
and its adjacent provenance JSON. It accepts a derivative only when that
provenance binds its output hash to the full current g01 hash, states it is a
first-generation result rather than a chained generated input, and explicitly
sets `review.training_eligible: true`. It does not use an operator name or an
ad-hoc approval field as authority.

The output is an ordinary `build_training_set.py --mode provided` dataset with
numbered PNG/caption pairs, plus `dataset_curation.json`, a snapshot of the
request, and byte-hashed copies of every source and derivative provenance. The
curation record says that any eval derivatives share g01 ancestry: they are
within-identity diagnostics, never independent identity-reference validation.
The compiler rejects a derivative byte hash on both train and eval splits.

After materialization, later changes to the external request staging directory
do not rewrite the dataset. The retained snapshots are the evidence later
approval hashes; changing or removing one makes `lineage.dataset_subject` fail,
so an existing dataset approval becomes stale. The compiler writes no
`dataset-approval.json`, invokes no plan or runner, and remains below the
existing explicit `figment_train.py accept-dataset` boundary. The current three
experimental derivatives are refused because their provenance marks
`training_eligible: false`.

The existing builder consumes the retained source snapshots, never the mutable
staging paths after copying. `dataset_curation.json` records each train entry's
ordered numbered PNG and caption sidecar; eval entries are retained as evidence
but are never materialized as trainer media. Later train-first staging carries
that curation record and its exact snapshot inventory only after the separate
operator acceptance succeeds.

All request, persona, source, and output ancestors must be real directories,
not symlinks or Windows reparse points. A source image is capped at 16 MiB,
8,192 pixels per edge, and 16,777,216 decoded pixels; source inputs and the
materialized numbered PNGs each have a 128 MiB aggregate cap. JSON is read with
stable bounded reads. `--out` must be a fresh direct child of an existing safe
directory, so failed materialization leaves no partial output at that name.

```powershell
python orgs/figment/pipeline/train/curate_single_seed.py `
  --request C:\staging\request.json --out C:\staging\dataset-draft
```

The request must contain `schema: "figment/single-seed-curation-request@1"`,
`creator: "creator-001"`, the exact `canonical_seed` path/hash, one `seed-g01`
train entry, and at least one eligible first-generation train derivative. Each
caption begins with the declared trigger token and each entry carries a bounded
variation object. This is a curation draft, not training eligibility or a
production acceptance.

## Actual-data refusal probe (2026-09-08)

The private offline probe at
`C:\Users\danie\kb\_private\figment-curation-real-refusal-20260908\results.json`
copied the original g01 and all four current generated PNG/provenance pairs,
then invoked this compiler with a seed-plus-one-derivative request for each.
All four exited `2` and published no output, approval, or plan. Wardrobe-only,
small-head-turn, and E01 reached the explicit `training_eligible: false`
refusal. The frontal candidate also carries `training_eligible: false`, but its
older provenance role failed the earlier first-generation wording check, so the
recorded reason is that stricter refusal rather than an eligibility claim. The
probe creates no accepted data and does not modify any copied eligibility field.
