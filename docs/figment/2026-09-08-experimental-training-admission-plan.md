# Experimental training admission boundary — 2026-09-08

## Decision

Do not use `figment_train.py accept-dataset` for an agent-authored diagnostic
dataset review. That command explicitly records an operator acceptance with a
`decision: "verified"`, `decided_by`, and `decided_at`
([figment_train.py:1611](../../orgs/figment/pipeline/figment_train.py:1611)).
`train-first` then requires that current operator record before it copies a
dataset ([figment_train.py:1638](../../orgs/figment/pipeline/figment_train.py:1638),
[figment_train.py:1750](../../orgs/figment/pipeline/figment_train.py:1750)).
Filling those fields from an agent would misstate an operator decision.

The current four inputs are not ready for either production or an experimental
train-first run. They are below the existing 20-image minimum
([figment_train.py:1625](../../orgs/figment/pipeline/figment_train.py:1625)),
and their records are experimental observations, not training decisions. In
particular, the small head-turn record says `training-ineligible`
([input and book review](2026-09-08-input-and-book-review.md#small-head-turn--charcoal-tee-candidate)),
and the E01 review says it does not establish suitability for later use
([same review](2026-09-08-input-and-book-review.md#e01-shoulders-up--original-strapped-top-candidate)).
The visually rejected frontal input remains excluded. No score, raw observer
value, or descriptive review changes that conclusion.

## What an experimental dataset must actually contain

Before a separately bounded diagnostic can be planned, prepare an immutable
inventory of at least 20 reviewed training rows. This retains the existing
minimum rather than creating a smaller untested threshold. It must include:

1. Canonical `g01` plus at least 19 distinct first-generation candidates.
   Each candidate must name `anchors/g01.jpg` as its sole source; no generated
   candidate may become another candidate's input.
2. Per-row source and retained-output SHA-256, byte count, decoded image
   dimensions, exact caption, split, and the first-generation provenance
   record. The existing curated-dataset verifier already binds g01, source
   snapshots, first-generation provenance, exact numbered media/caption
   mapping, and train/eval leakage checks
   ([lineage.py:244](../../orgs/figment/pipeline/lineage.py:244),
   [lineage.py:396](../../orgs/figment/pipeline/lineage.py:396)).
3. An original-resolution visual observation for every proposed training row:
   resemblance notes, unambiguous adult presentation, intact opaque clothing,
   real-person-likeness concern, image defects, and caption accuracy. A
   `rejected` or otherwise ineligible source must fail closed. This is evidence
   collection, not a numerical quality gate.
4. At least one held-out row, if an evaluation split is used. Because every
   input shares g01, that split is a within-identity diagnostic, never
   independent reference validation
   ([single-seed expansion plan](2026-09-08-single-seed-expansion-plan.md#evaluation-rubric)).

This minimum says nothing about whether a resulting LoRA is good enough for
future media. Actual exports still need their applicable full-resolution visual
review and existing production gates.

## Honest diagnostic record

The smallest missing artifact is a new, separately named
`figment/experimental-dataset-review@1` record. It contains the bounded `rows`
above and, for each row, an `evidence_assertion: true` only to mean
that the named reviewer observed and recorded the supplied bytes. It must not
mean authentication, operator approval, acceptance, safety clearance, or a
promotion decision. Suggested required top-level fields are:

```json
{
  "schema": "figment/experimental-dataset-review@1",
  "creator": "creator-001",
  "purpose": "single-g01-training-diagnostic",
  "not_promotable": true,
  "reviewer": {"kind": "agent", "id": "..."},
  "dataset_subject_sha256": "...",
  "rows": []
}
```

These are the complete top-level fields. Each row must identify its evidence state explicitly: `observed`, `excluded`,
or `unavailable`. It must not use `verified`, `approved`, `decided_by`,
`decided_at`, `dataset-approval.json`, or an operator-looking identity. An
agent-authored observation may preserve an uncertainty or exclusion; it cannot
convert either into a pass.

For an observed row, the record must also preserve an unresolved resemblance
observation, an image-defect observation, and a caption-accuracy observation.
Those describe the reviewer’s evidence only. They do not establish identity,
make a dataset good, or turn the row into an approved training input.

## Minimal bounded workflow to build later

Implement a distinct `experimental-train-first` compiler, rather than adding a
flag to `accept-dataset` or weakening `_validated_train_first_dataset`. It
should:

1. Require the experimental-review schema and a single-seed curation record,
   then revalidate the complete current inventory with the existing
   `lineage.dataset_subject` checks ([lineage.py:428](../../orgs/figment/pipeline/lineage.py:428)).
2. Require the 20-row minimum and reject all excluded, unavailable, stale,
   missing, altered, chained, cross-split-leaking, non-adult, clothing-failure,
   or real-person-likeness-concern rows. These are input refusals, not newly
   calibrated scoring thresholds.
3. Emit a separate plan and run namespace labelled `experimental`, with
   `not_promotable: true` bound into both the plan and completed receipt. It
   must use a separately admitted spend bound and the existing one-attempt
   harness controls. The offline plan retains the parsed review, current
   dataset subject, and curation record with their raw hashes, plus a local
   dataset locator marked for revalidation before any future execution. It
   does not copy media because the curated dataset already retains that media.
4. Rely on the existing stage-aware production plan loaders' rejection of the
   unknown experimental schema, and add explicit refusal at the checkpoint
   selection or promotion boundaries that can otherwise consume a checkpoint.
   This is bounded enforcement for Figment's known paths; it does not claim to
   taint-track arbitrary copied bytes or generic harness invocations. The
   compiler must never write `dataset-approval.json`, an accepted-checkpoint
   record, or a human approval lineage.
5. Add fixtures proving: an agent review cannot call the production path; a
   changed image/caption/provenance invalidates the plan; an excluded row fails;
   fewer than 20 rows fail; and an experimental checkpoint cannot reach a
   production generator.

The existing training builder already copies only the approval inventory into a
train-first plan ([figment_train.py:1803](../../orgs/figment/pipeline/figment_train.py:1803)).
The new compiler can reuse that bounded copying and lineage validation, but it
must keep its schema, plan namespace, and downstream refusal separate. No
production approval, QA-stamp change, threshold change, or media export follows
from creating this diagnostic path.
