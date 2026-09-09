# Figment operator runbook: dataset to video

This is the current operator path for the existing CLI. It is a runbook for a
real, already-reviewed dataset; it does not create synthetic rulings, approve
images, launch a pod, or establish current production readiness. Use the full
Python 3.13 executable below. `run` is the only command here that can invoke
the existing pod harness.

## Preconditions

The path begins only when `<REVIEWED_DATASET_DIR>` contains the real, current
dataset files expected by `train-first`: image/caption pairs, `_dataset.ready`,
`dataset_manifest.json`, and the actual operator decision in
`dataset-approval.json`. `accept-dataset` validates and records a real decision;
it cannot infer one. The current repository has no accepted identity dataset,
accepted production LoRA, selected tester checkpoint, or approved `gen` still.
The commands below are fixture-tested contracts, not evidence those prerequisites
exist today.

Use a fresh empty `<PLAN_ROOT>` for the train-first plan. The planner copies the
approved dataset into its own `train/runs/creator-001-tensor-dataset-train-first`
area and records all later paths relative to `<PLAN_ROOT>/plan.json`. Never move
or hand-edit `plan.json`, receipts, manifests, grading records, or copied media.

```powershell
$py = 'C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe'
$creator = 'creator-001'
$dataset = '<REVIEWED_DATASET_DIR>'
$planRoot = '<PLAN_ROOT>'
$ledger = 'C:/Users/danie/kb/_private/codex-worktrees/figment-analysis-ops-2026-09-07/ledgers/cost'
```

## Dataset acceptance and train-first plan

Only after the genuine dataset decision is available, validate and record it
with the responsible operator’s real values. Do not substitute invented names,
times, or rulings.

```powershell
& $py orgs/figment/pipeline/figment_train.py accept-dataset `
  --creator $creator --dataset-dir $dataset `
  --decided-by '<ACTUAL_DECIDER>' --decided-at '<ACTUAL_ISO_8601_TIME>'

& $py orgs/figment/pipeline/figment_train.py train-first `
  --creator $creator --dataset-dir $dataset --out $planRoot --ledger-dir $ledger
```

Do not use `--skip-pin-verify` for a real path. Read the generated train budget
from the command output and `<PLAN_ROOT>/plan.json`; it is plan-derived, not a
fixed quoted price. The plan’s recorded harness argv supplies the actual
manifest paths, output paths, ledger directory, arc cap, and per-stage ceilings.
The planner resolves that directory to an absolute path and freezes it in the
plan and every harness argv. Use the reconciled canonical ledger above: the
managed OPS fallback currently has no Figment baseline, so a live harness
correctly fails closed there. Do not reset the arc or use an empty-ledger override.
Existing plans are not migrated; create a fresh plan with this explicit ledger
instead of hand-editing or replaying a plan bound to a stale worktree ledger.

## Training and tester selection

Each `run` uses the bounded argv embedded in the plan and does not retry. These
commands require the applicable current live authorization and preflight; this
runbook does not grant either.

```powershell
& $py orgs/figment/pipeline/figment_train.py run `
  --creator $creator --stage train --plan "$planRoot/plan.json"

& $py orgs/figment/pipeline/figment_train.py run `
  --creator $creator --stage tester --plan "$planRoot/plan.json"

& $py orgs/figment/pipeline/figment_train.py grade `
  --creator $creator --stage tester --plan "$planRoot/plan.json"
```

`grade` writes the board and a rulings template under
`<PLAN_ROOT>/grade/tester/`. A later `apply-rulings` consumes a real completed
review document. It can select only an actually kept tester candidate; use the
produced checkpoint step, not a placeholder:

```powershell
& $py orgs/figment/pipeline/figment_train.py apply-rulings `
  --creator $creator --stage tester --plan "$planRoot/plan.json" `
  --rulings '<ACTUAL_TESTER_RULINGS_JSON>' --checkpoint-step <KEPT_PRODUCED_STEP>

& $py orgs/figment/pipeline/figment_train.py gate `
  --creator $creator --stage tester --plan "$planRoot/plan.json"
```

The completed train receipt is under the plan-recorded run output, normally
`<PLAN_ROOT>/train/runs/out/creator-001-tensor-train-first/run.json`; tester
evidence is similarly under `.../creator-001-tensor-tester-first/`. Use those
plan-relative records, never a guessed global output folder.

## Fresh held-out `gen` plan

The tester `apply-rulings --checkpoint-step` command persists the selected
checkpoint digest and the path to its `accepted-checkpoint.json` in the
persona's training configuration. A **fresh empty** `<GEN_PLAN_ROOT>` can then
build `gen`: the planner follows that config-bound approval back to the external
train-first source plan, verifies the source plan, tester approval, current
training inputs, and checkpoint bytes, then copies the verified checkpoint into
the new gen plan. Do not copy any checkpoint, approval record, or manifest by
hand.

```powershell
$genRoot = '<FRESH_EMPTY_GEN_PLAN_ROOT>'

& $py orgs/figment/pipeline/figment_train.py plan `
  --creator $creator --stage gen --out $genRoot --ledger-dir $ledger

& $py orgs/figment/pipeline/figment_train.py run `
  --creator $creator --stage gen --plan "$genRoot/plan.json"

& $py orgs/figment/pipeline/figment_train.py grade `
  --creator $creator --stage gen --plan "$genRoot/plan.json"

& $py orgs/figment/pipeline/figment_train.py apply-rulings `
  --creator $creator --stage gen --plan "$genRoot/plan.json" `
  --rulings '<ACTUAL_GEN_RULINGS_JSON>'

& $py orgs/figment/pipeline/figment_train.py gate `
  --creator $creator --stage gen --plan "$genRoot/plan.json"
```

`grade` and `apply-rulings` use the actual current gen evidence. The selected
image ID appears in `<GEN_PLAN_ROOT>/grade/gen/approved-list.json`; the detailed
image for each multi-image gen job is the plan-recorded output, normally under
`<GEN_PLAN_ROOT>/train/runs/out/creator-001-tensor-gen/`. `held-out-diagnostic`
is a separate unscored protocol and does not replace this generation path.

## Video, after an approved `gen` still exists

The approved-still adapter consumes a current approved image from the fresh `gen`
plan. It reads existing lineage and writes a
fresh, non-promotable video manifest beside that selected image. All values below
are root-relative paths; `--out` must be in the approved image’s directory.

```powershell
& $py orgs/figment/pipeline/video/video_manifest.py `
  --root '<REPOSITORY_ROOT>' `
  --persona 'orgs/figment/personas/creator-001/persona.yaml' `
  --approved-gen-plan '<GEN_PLAN_ROOT_RELATIVE_TO_REPOSITORY_ROOT>/plan.json' `
  --approved-gen-image-id '<APPROVED_GEN_IMAGE_ID>' `
  --action '<SHORT_CLOTHED_MOTION_TEXT>' `
  --out '<APPROVED_GEN_IMAGE_DIRECTORY_RELATIVE_TO_REPOSITORY_ROOT>/video-manifest.json'
```

The compiler does not render a clip or create temporal acceptance. Its manifest
remains diagnostic and non-promotable pending the existing video execution,
receipt, and temporal review path. See [the adapter contract](../../orgs/figment/pipeline/video/APPROVED_GEN_ADAPTER.md).

## Video execution, only under its separate live authorization

The existing video manifest is a normal bounded pod-harness input. Read its
`gpu`, `price_usd_per_hour`, `max_minutes`, and `max_placement_attempts` before
the command and use those manifest values in the live bound. The current native
video compiler emits one L40S, one placement, 80 maximum minutes, and a
historical $1.30/hour manifest rate; its maximum estimate is therefore
`$1.30 * 80 / 60 = $1.733334`. Current provider rate, ledger total, and the
authorized dollar ceiling must be checked at execution time.

```powershell
& $py orgs/figment/pipeline/pod/runpod_run.py run `
  --manifest '<VIDEO_MANIFEST_ABSOLUTE_PATH>' `
  --out '<FRESH_VIDEO_RUN_OUTPUT_DIRECTORY>' `
  --max-usd <APPROVED_USD_BOUND_FROM_MANIFEST_AND_CURRENT_LEDGER> `
  --max-minutes 80 `
  --ledger-dir 'C:/Users/danie/kb/_private/codex-worktrees/figment-analysis-ops-2026-09-07/ledgers/cost' `
  --arc-cap-usd 50 --arc-ledger-glob 'figment-*.tsv'
```

Use a fresh output directory. The harness records the receipt and verified frame
files there. The current video documentation defines no standalone temporal-QA
acceptance command, so this runbook does not invent one. Frame extraction or
assembly evidence and any later temporal judgment remain non-promotable until a
documented review procedure records an actual result.

## Command-shape evidence

This runbook was checked against `figment_train.py --help`,
`train-first --help`, `apply-rulings --help`, and `video_manifest.py --help` on
2026-09-09. The focused
`test_train_first_tester_selection_stages_current_checkpoint_in_fresh_gen_plan`
test exercises an accepted 20-row fixture dataset through a real train-first
tester selection and a fresh external-source `gen` plan. Separate adapter tests
exercise approved-gen video compilation. These checks do not supply a current
accepted dataset or prove a live train, tester, gen, or video result.
