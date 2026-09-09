# Built-in train-first plan: independent review

Reviewed 2026-09-09 against the materialized plan at
`C:/Users/danie/kb/_private/figment-builtin-train-first-20260909-v1/plan.json`.
This is a plan/bootstrap review, not evidence that a training pod has run or that a
checkpoint or identity result is accepted.

## Verdict

**READY for the separately authorized live-preflight decision.** No concrete blocking
plan or bootstrap defect was found in this bounded review.

## Bound dataset and budget

- The plan is `train-first`, names the canonical OPS ledger
  `.../figment-analysis-ops-2026-09-07/ledgers/cost`, has arc cap `$50.00`, and binds
  `dataset-v1/dataset-approval.json` SHA-256
  `96b2c5b470aab05af35dbc189cf8db666e9e205f24bb757816991c20b71a2505`.
- The staged training directory contains exactly 20 PNGs and 20 matching TXT captions;
  all 88 source files shared with `dataset-v1` are byte-identical. Its only added file
  is the rendered `training.json`; `_dataset.ready` and the approval are present.
- One L40S train run is bound to 1,250 DOP-enabled steps at 9 seconds/step. Its frozen
  budget is `$7.61`, 351 minutes, and one placement attempt. It carries checkpoint
  artifacts at steps 250, 500, 750, 1000, and final 1250.

## Pin and bootstrap inspection

- Train uses the pinned Krea-2 raw BF16 model revision
  `5ea0b6cb7e43749e5202aed076e8ecbe04d2deee`, SHA-256
  `f99bb0ff8e362b77342bc4994e0c50906fe7ef7074864b181b7d48d2fa6d03d7`.
  The earlier exact Studio HEAD preflight is recorded in
  `_private/figment-builtin-dataset-20260909-v1/pin-preflight.json`.
- The train manifest has no custom-node clone. The tester manifest’s RES4LYF node has
  a 40-character `git_ref`; the current harness clones, fetches that commit when needed,
  checks out the commit, and verifies `HEAD`, rather than treating a commit as a branch.
- The train manifest’s ComfyUI ref is `v0.20.1`; its rendered training start template
  points to the pinned ai-toolkit commit `b36bb3998ae596a566d85513299696a3a78f0dcb`.
  Model pin revisions are regular Hugging Face revision paths, not clone references.

## Local harness exercise

The unchanged harness completed this command with exit 0:

```powershell
python runpod_run.py run --manifest creator-001-tensor-train-first.yaml --out <fresh review out> --dry-run --max-usd 7.61 --max-minutes 351 --ledger-dir <canonical OPS ledger> --arc-cap-usd 50.00 --arc-ledger-glob figment-*.tsv
```

It used only its dry-run API and isolated dry-run ledger, preflighted 42 relative upload
files (20 PNGs, 20 captions, `training.json`, and `_dataset.ready`; 42,036,431 bytes),
accepted all five declared artifacts, and recorded termination of `dry-run-pod`. The
review output is `_private/figment-builtin-train-first-dryrun-review-20260909-v1/`.
No provider request, model download, asset export, real ledger write, or training run occurred.

## Remaining gates outside this review

Current live ledger/rate/cap preflight and the separate authorization are still required
before any paid run. A completed run would still require tester, held-out still, and
quality review; this review does not supply them.
