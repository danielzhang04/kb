# Built-in candidate training readiness — 2026-09-09

## Status

Built-in candidate expansion slots 07–09 are in progress. There is no finalized
dataset, dataset approval, train-first plan, selected checkpoint, or training run.
This note traces the existing normal `train-first` route; it does not create a
plan or authorize a pod.

The completed six-image pilot supplies only candidate inventory: g01 and pilot
01, 02, 04, and 05 are initial train candidates; pilot 03 and 06 are reserved
evaluation candidates; fifteen further direct-g01 train candidates are planned.
The raw YuNet/SFace records remain unthresholded diagnostics, not a score-based
admission rule.

## Existing route and remote capability

`figment_train.py train-first` validates an already-built dataset directory,
copies only its approved bytes into a fresh plan root, and emits one train and
one tester manifest. The normal creator-001 configuration is Krea-2, 1,250
steps, saves at 250-step intervals, supplied captions, and DOP enabled. The
train manifest therefore expects four intermediate checkpoints plus the bare
final checkpoint; the tester renders one fixed job for each of those five files.

Both stages select one secure NVIDIA L40S in `tensor-pins.yaml`, at a pinned
ceiling of $1.30/hour. The train stage has 80 GB container disk, a 200 GB
workspace volume, a 3,600-second readiness allowance, and remote model download.
The tester has the same disk/volume class, 2,400-second readiness allowance, and
uploads the locally downloaded checkpoints. The manifest specifies remote GPU
class, not a local RAM or VRAM minimum. Thus the normal route moves model loading
and training off the local-fit process that encountered a local RAM constraint;
it does not prove any placement's RAM, VRAM, availability, or throughput before a
bounded run.

The source records historical L40S smoke evidence for torch/CUDA and Krea raw
state-dict loading. That supports this pinned route, but it is not a result for
the new candidate inventory.

## Deterministic current budget

I called the existing `_apply_train_budget` offline against the current
creator-001 training input and tensor pins. With 1,250 DOP steps at its
configured 9.0 seconds/step, 900-second warmup, and 1.35 margin, it returns a
16,403-second train job timeout. The shared harness
`minimum_runtime_minutes` calculation gives 350.383 minutes for the five
artifacts, rounded to a 351-minute manifest ceiling.

| stage | fixed work shape | effective maximum | plan ceiling |
| --- | --- | ---: | ---: |
| train | five checkpoint artifacts | 351 min | $7.61 |
| tester | five one-image checkpoint jobs; one marker wait | 115 min (88-min calculated floor) | $2.50 |
| combined | sequential train then tester | 466 min | $10.11 |

The unrounded harness estimates are $7.605 and $2.491667, or $10.096667 in
total. Against the stated arc of $38.778929/$50, the rounded combined ceiling
would leave $1.111071. This is an indicative ceiling calculation, not a cost
approval, invoice, or availability claim.

The exact Studio harness module resolves its budget path from its own source root:
`figment-studio-20260908/governance/budget.yaml`, whose current daily limit is
$10.00. This is branch-specific and does not come from the command working
directory or the ledger worktree; the plan freezes the canonical ledger path,
while its recorded harness argv selects the Studio runner and therefore this
budget file. Calling that module's `daily_budget_state` with the canonical OPS
ledger returned $0.978544 spent.

At that state, the $7.605 unrounded train preflight would total $8.583544 and
fit under the Studio daily cap. The combined unrounded ceiling would total
$11.075211, so train and tester cannot both be assumed to fit on the same ledger
day. They run as separate harness preflights, and the tester must read the
actual then-current canonical ledger. This note does not permit an empty, reset,
or worktree-local ledger.

## Pinned inputs and licence record

The train stage pins `Comfy-Org/Krea-2` Krea-2 Raw BF16 at revision
`5ea0b6cb7e43749e5202aed076e8ecbe04d2deee`, SHA-256
`f99bb0ff8e362b77342bc4994e0c50906fe7ef7074864b181b7d48d2fa6d03d7`.
The tester pins the Krea-2 Turbo FP8 UNet, Qwen3-VL 4B FP8 text encoder, and
Qwen Image VAE, plus the pinned RES4LYF node. Pins are committed with immutable
revisions and SHA-256 values in `pipeline/train/tensor-pins.yaml`; none were
downloaded or rechecked here.

The Krea weights carry the Krea 2 Community License in the existing training
record. AI Toolkit is recorded MIT. RES4LYF is recorded AGPL-3.0 with a
no-commercial-image-service rider. These records support the research route;
they are not a production licence clearance or an accepted-model decision.

## Preconditions still absent

1. Finish and individually review the planned candidate inventory, then retain
   exactly 20 captioned train candidates and two evaluation-only candidates.
2. Build the normal dataset directory with current image/caption hashes,
   `dataset_manifest.json`, `_dataset.ready`, and a real current
   `dataset-approval.json`; `train-first` rejects less.
3. Use a fresh output root and explicit canonical `--ledger-dir`. The plan freezes
   that resolved path into both harness argv records. Existing frozen plans are
   not migrated or hand-edited.
4. Perform the real pin preflight, which HEAD-checks the pinned Hugging Face
   revisions and digests. A live pod then requires its own authenticated harness
   environment, public remote downloads, bootstrap/package installation, a
   successful L40S placement, and current network readiness. None was checked
   here.
5. Reconcile the canonical provider ledger, daily budget, $50 arc, and exact
   per-stage ceilings at execution time; request the normal live-run authorization
   with the final manifest and bounds. The harness allows one placement attempt
   and does not add automatic retries.

Only a successful train receipt would produce checkpoint candidates. A successful
tester receipt and the existing review/approval lineage are still required before
any checkpoint selection, held-out still generation, or video input.
