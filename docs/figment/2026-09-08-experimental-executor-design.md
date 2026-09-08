# Experimental training executor design — 2026-09-08

## Decision and boundary

`experimental_train.py` at accepted revision `f6b5096d` can compile a private
`figment/experimental-train-plan@1` after it has bound a single-g01 curation
record, retained dataset lineage, an agent observation record, the current g01
hash, and the current pinned training recipe.  Its plan deliberately sets
`not_promotable: true` and `provider_start_allowed: false`; it does not start a
runner or manufacture a production acceptance.

The smallest useful next unit is a separate **experimental executor**, not a
flag on `figment_train.py run`, `accept-dataset`, or `apply-rulings`.  It would
prepare one fresh, private, hash-bound RunPod training manifest from that plan
and call the existing `pod/runpod_run.py` harness only after execution-time
revalidation.  Live invocation remains subject to the existing Figment pod
admission and harness cost controls.  This design neither authorizes a run nor
turns the current four refused candidates into inputs.

The executor is diagnostic-only.  It must never write a `dataset-approval.json`,
an approval lineage, a QA stamp, an accepted-checkpoint record, a production
plan, or persona training settings.  A successful harness download says that
the bounded run and teardown completed; it does not establish image quality,
identity, production acceptance, or a human ruling.

## Exact reuse points

| Need | Existing reusable boundary | Executor use |
| --- | --- | --- |
| Parse and verify the experimental plan's evidence | `train/experimental_train.py`: `_load_current_subject`, `_validate_review`, `_recipe`, `_validate_creator_seed_and_trigger`, `_canonical`, `_sha256` | Extract a narrow shared `revalidate_experimental_plan()` used by both compiler and executor. It checks the plan digest, the retained dataset subject/curation bytes, review bytes, current g01, persona, tensor pins, template, trigger, and rendered config against the frozen plan. |
| Retained numbered media/caption lineage | `lineage.dataset_subject()` and the single-seed curation record | Stage only current verified numbered **train** PNG/caption pairs from the retained dataset. Do not call `build_training_set` against external request staging; eval snapshots never become trainer media. |
| Rendered trainer recipe | `figment_train._render_training_config()` and `render_aitoolkit_config.validate_rendered_pod_paths()` | Re-render from the current pinned recipe, require exact equality to `training_recipe.rendered_training_config`, then write one staged `training.json`. |
| Trainer runtime and artifact names | `figment_train._training_runtime()`, `_checkpoint_steps()`, `_checkpoint_name()`, `train/runs/start-training-aitoolkit.sh.template` | Reuse the existing AI Toolkit pinned runtime, completion/failure markers, checkpoint naming, and bounded artifact list. Copy a hash-bound rendered launcher beside the new manifest. |
| Pod profile and budget calculation | `figment_train._pod_base()` and `_apply_train_budget()` | Derive the `train` profile and its runtime ceiling from the same tensor pins and recipe. The executor accepts no GPU, image, model, command, price, or timeout fields from the experimental plan or caller. |
| Live cost, one-attempt lifecycle, ledger and verified teardown | `pod/runpod_run.py`: `require_manifest()`, `minimum_runtime_minutes()`, `run_harness()` | Invoke the existing harness with its generated manifest, fixed `--max-minutes`, computed ceiling `--max-usd`, configured ledger/arc inputs, and a fresh owned output. Do not copy or modify harness spending, credential, lease, or recovery code. |

`figment_train._load_plan()` must continue to reject
`figment/experimental-train-plan@1`.  The executor is the only proposed consumer
of that schema; production stage, grading, checkpoint-selection, and generation
paths remain separate.

## Proposed implementation shape

Add `pipeline/train/experimental_execute.py` and
`pipeline/train/tests/test_experimental_execute.py`.  The first implementation
has one callable operation and a CLI with an explicit `--execute` opt-in:

```text
experimental_execute.py --plan <experimental-plan.json> --out <fresh-private-relative> [--dry-run | --execute]
```

There are no client-selected dataset paths, prompts, commands, model revisions,
GPU types, artifact names, prices, timeouts, ledgers, or checkpoint paths.  The
plan's dataset locator is read only to revalidate the compiler-bound retained
dataset.  `--dry-run` exercises local staging and `run_harness(..., dry_run=True)`.
`--execute` remains a live pod action, so its surrounding card/admission supplies
the existing harness's allowed ledger and cap context; it cannot be enabled by
putting a field in a plan or review document.

The output must be a fresh direct child below the known Figment private root,
with reparse-point and ancestor containment checks before every read, copy,
manifest write, harness call, and cleanup.  It uses a temporary sibling and
atomic publish for local immutable records.  A run identifier is the plan's
`frozen_sha256` plus a fresh safe nonce, so a second attempt cannot overwrite or
silently reuse another attempt's staging/output.  A live execution accepts a
plan only from the configured private `experimental-train-plans/<run-id>/`
root and reads a separate `figment/experimental-train-admission@1` record only
from `experimental-train-admissions/<plan-sha256>.json`.  That record binds the
plan hash, generated manifest/launcher/config/staging-inventory hashes, one
derived `train` profile's maximum cost/minutes, and the exact configured Ops
ledger directory, its bounded snapshot hash/current arc amount, the studio
daily-budget file/hash/current daily amount, arc cap, and ledger glob.  This is a local trusted
filesystem boundary, not cryptographic proof of an operator or a human dataset
or checkpoint approval; the executor never writes the record.

### Prepare and revalidate

1. Bounded-read and schema-check the plan.  Recompute its canonical
   `frozen_sha256`; require `not_promotable: true` and all three false execution
   flags from the compiler.  Refuse a missing, unknown, or production schema.
2. Immediately re-run the shared experimental validation against the live
   retained dataset, review, persona, g01, pins, template, and rendered config.
   Compare every resulting hash/value with the plan's `inputs`, `frozen_inputs`,
   and `training_recipe`.  This makes a changed review, curation snapshot,
   numbered media/caption, current g01, persona, pin, template, or trigger fail
   before staging.  The current `@1` plan stores parsed review JSON but only a
   hash of the original raw review; it cannot honestly rehash that raw document
   because no review locator or byte snapshot is retained.  Before an executor
   can consume newly compiled plans, extend the compiler to retain one bounded
   base64 review-byte snapshot plus its SHA-256 in `frozen_inputs`.  The executor
   decodes it under `MAX_REVIEW_BYTES`, verifies the stored digest against the
   exact decoded bytes and `inputs.review_sha256`, then validates the parsed
   snapshot.  Legacy `@1` plans without this snapshot are planning evidence only
   and must refuse execution.  This additive field may retain `@1` only with a
   focused legacy-plan refusal regression; otherwise version it explicitly.
3. Copy only verified train files in curation order into a new staging directory,
   with bounded regular-file reads and a hash/byte check on each copy.  Include
   the curation record, retained snapshot inventory, and an ordered staging
   inventory; do not include eval media, external request paths, arbitrary side
   files, or an approval file.
4. Revalidate the source subject again immediately before the immutable staged
   manifest is published and again before `run_harness` is entered.  Rehash every
   published staged PNG/TXT, the empty ready marker, config, launcher, manifest,
   and inventory; require the staging directory to contain exactly that bounded
   inventory and no subdirectories or extra media; a mutation in either interval
   refuses before the harness call.

### Generated harness manifest

The executor derives, rather than accepts, one manifest with these properties:

- The existing `train` pod profile, Krea RAW safetensors pin, no custom nodes,
  pinned AI Toolkit launcher, `caption_mode: provided`, and a one-node seed
  sentinel required by the harness.
- Uploads are exactly the staged numbered `*.png`, `*.txt`, and `training.json`
  under the pinned trigger subfolder, followed by `_dataset.ready` as the final
  upload.  The executor enforces its own exact inventory, image/caption file
  types, per-file/aggregate byte ceilings, regular-file/reparse checks, and
  hashes before it builds that list.  `expand_manifest_uploads` has broader
  local-upload surface and is not the executor's type or aggregate-security
  boundary; its marker ordering and path checks are only defense in depth.
- Artifact mode polls the existing `_training.complete` marker and fails on
  `_training.failed`.  Its artifact list is derived from the frozen
  `steps/save_every` cadence: each intermediate `<trigger>_<step>.safetensors`,
  final `<trigger>.safetensors`.  This is exactly the existing full
  `_train_manifest(..., smoke=False)` artifact inventory; the smoke-only log
  and undeclared checkpoint index remain outside this unit.  Do not invent an
  artifact filename outside the current wrapper/harness contract.
- The generated manifest and every executor record carry an explicit
  `not_promotable: true` label.  The generic harness `run.json` records runner
  state and does not make a promotion decision.  `diagnostic_non_commercial` is
  unnecessary here because the existing train model pin is safetensors, not a
  pickle-format exception.
- It binds hashes for: plan bytes, revalidated evidence subject/review/curation,
  persona, pins, template, rendered config, staged inventory, launcher bytes,
  generated manifest bytes, and its exact computed price/time ceiling.

The runner manifest is an execution artifact, not an authorization token.  It
contains no human name, `qa_stamp`, `review_status`, `decision`,
`accepted-checkpoint`, or mutable production path.

### Execution and receipt

Before a live call, the executor writes a durable private `prepared` journal
binding the hashes above, its generated manifest, `not_promotable: true`, and
the requested dry-run/live mode.  It then invokes only the existing
`run_harness()` with the generated manifest.  It does not make provider requests
itself and it does not retry a live attempt.  After all local preconditions and
the prepared journal succeed, but before entering the harness, it atomically
creates a fixed private dispatch marker keyed by the exact plan hash and stable
admission identifier, while recording raw and canonical admission hashes,
outside the nonce output directory.  A pre-existing marker refuses a second
manifest/output attempt under the same admission even if its JSON whitespace is
rewritten, including after an ambiguous harness failure.  A prerequisite failure before
marker creation does not consume the admission.  The existing harness may still
perform its own bounded placement recreations inside that single admitted call;
the executor does not add another retry layer.  Harness recovery/teardown stays
the owner of a stopped or uncertain pod.

On every return path, write an `experimental-execution.json` receipt with one of
`prepared`, `dispatched`, `dry-run-complete`, `failed`, or `harness-complete`
and preserve the runner `run.json` hash/location when a live harness returns.
It records `harness_invoked` separately from provider-call status: a live
harness exception is an unknown provider outcome unless its own receipt says
otherwise.  A `harness-complete` receipt
requires `dry_run: false`, no harness error, every expected artifact present and
positive, and `termination_verified: true` for the run and placements.  It
records downloaded artifact hashes computed locally after download.  It must say
that these hashes bind local downloaded files and runner status, not that they
prove acceptance or quality.

Any failure still records bounded error class and teardown evidence if available.
It does not delete a harness recovery journal, select a checkpoint, copy a LoRA
into persona/model directories, or export it.  A harness result with uncertain
teardown stays failed/pending recovery and is never marked complete.

## Gaps that must be resolved inside the bounded implementation

1. The compiler has no execution profile or runner-manifest hash because it is
   intentionally offline.  The executor must derive the profile exclusively
   from the revalidated existing tensor pins and reject drift, rather than adding
   mutable profile fields to the plan.  It also needs the bounded raw review
   snapshot described above before a later executor can truthfully revalidate
   `inputs.review_sha256`; parsed JSON plus an old raw hash is insufficient.
2. The executor intentionally uses only the existing full-run intermediate/final
   safetensors list.  `_checkpoints.json` and `_training.log` remain on-pod
   diagnostics outside this executor's download contract; adding either later
   needs a separate artifact/budget compatibility change, not a loose suffix
   allowance.
3. Cost is an execution-time property.  The executor records the derived
   `manifest_ceiling()` and, immediately before dispatch, recomputes the bounded
   canonical Ops-ledger snapshot, current arc total, and studio `$10.00` daily
   context against the admission.  A changed value requires a fresh admission;
   it is never silently ignored.  The unchanged harness then receives that
   canonical ledger root and repeats its ledger, daily/arc, READY-price, and
   teardown checks.  The executor does not introduce a second ledger or reserve
   funds.
4. An experimental output has no production export route by design.  Later
   inspection can consume a receipt only as diagnostic evidence.  Production
   acceptance still needs its existing distinct data, ruling, checkpoint, and
   gate lineage.

## Meaningful fixture tests

The executor suite should reuse `test_experimental_train.py`'s 20-row synthetic
curation/review fixture and inject the existing harness function.  It should
cover behavior rather than a duplicate of the implementation:

1. A valid fixture creates a fresh private staging tree and a harness manifest;
   dry-run invokes the injected harness once with the exact derived cap/time,
   stages only ordered train media/captions, and writes a non-promotable receipt.
   It verifies the original review-byte snapshot hash, while an old plan without
   that snapshot refuses before staging.
2. Existing production `_load_plan`, `run_planned_stage`, checkpoint selection,
   and acceptance writers reject or remain unreachable from the experimental
   result.  Assert no approval, QA stamp, accepted-checkpoint, or persona file
   exists/changes.
3. Mutating a retained image, caption, provenance snapshot, curation record,
   review, current g01, persona, tensor-pins file, template, staged copy, or by
   adding an unreviewed PNG/TXT beneath the staged upload glob refuses before the
   injected live harness is called.
4. A plan digest/schema/flag mismatch, fewer than 20 rows, an excluded review
   row, non-train/eval leakage, or a reparse/outside-private input/output refuses
   with no staging publish and no harness call.
5. The generated manifest passes the unchanged harness's
   `require_manifest()` and `run_harness(..., dry_run=True)` with fixture files;
   it has one final `_dataset.ready`, no unpinned/client-selected fields, and the
   minimum runtime fits the derived maximum.
6. A simulated complete harness record must have every expected artifact and
   verified termination before an executor `harness-complete` receipt is written.
   Missing artifact, error, `dry_run: true`, or false/missing termination writes
   a failed receipt only.  No receipt path claims a provider result is an
   approval.
7. A simulated exception after a live attempt preserves the harness recovery
   artifact and records a bounded failure state without retrying or cleaning up
   evidence needed for termination reconciliation.
8. Two fresh output directories with the same plan/admission fixture can invoke
   the harness only once.  A local preflight refusal creates no dispatch marker;
   an error after the marker remains non-retryable under that admission.  The
   test distinguishes this executor-level one-call rule from an unchanged,
   in-call harness placement retry.
9. An admission made against the configured Ops-ledger snapshot refuses before
   marker creation when that ledger changes.  The harness receives only that
   canonical ledger root and the fixed studio daily-budget context.

## Recommended next build unit

Implement only `experimental_execute.py` plus its focused tests and this
derived-manifest/staging contract.  Start with dry-run fixtures.  Do not add a
dashboard launch control, a model upload/export path, a generic RunPod adapter,
or a production-schema exception.  A separate review can then decide whether a
frozen executor is ready for an admitted diagnostic run when eligible input
evidence exists.
