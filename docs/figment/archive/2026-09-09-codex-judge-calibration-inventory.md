# Codex judge calibration inventory — 2026-09-09

Status: evidence inventory only. No Codex judge call has run, and the existing Sonnet-derived thresholds are not validated for a Codex backend.

## What the current calibration proves

`orgs/figment/personas/creator-001/calibration/judge-calibration.json` contains 95 successful Sonnet judgements over six sets: three anchors, 31 Track-1 dataset cells, eight LoRA tester cells, six Qwen anchor edits, 12 passport candidates, and 35 expansion-03 cells. Its per-image scores, notes, pass previews, distributions, and proposed thresholds are model outputs. They are not historical human labels.

`pipeline/gate.yaml` copied those proposals into the active stage-2 gate. In particular, `same_person_min: 70.2` and `age_delta_max: 1.5` were separated by the Sonnet run; the skin, gloss, and artifact thresholds were explicitly non-separating. A Codex backend must therefore establish its own compatibility before these numbers can be used unchanged.

The current root research acceptance of the new built-in 20-train/2-eval dataset is a dataset eligibility decision. It is not calibration evidence for the historical vision judge and is excluded here.

## Genuine historical human evidence

The durable human evidence is coarse and set-level in `orgs/figment/STATE.md`; no reviewed per-image five-axis labels were found.

| Set | Historical human evidence | Limit |
|---|---|---|
| Legacy anchors `g01`, `g02`, `g07` | The persona file lists all three as identity references, but that historical configuration is not verified same-person ground truth. The user's current identity target is g01 alone, and the new dataset intentionally derives from g01 alone. | Only g01 can serve as a trivial self-consistency control. g02 and g07 are unlabeled legacy diagnostics and must not be treated as positive examples. |
| Track-1 dataset, 31 cells | Operator full-resolution ruling: “a lot closer,” identity not exact, faces glossy; allowed continuation to the LoRA tester. | Batch-level mixed finding, not a per-cell pass list. |
| LoRA tester, eight cells | Operator ruling: “kind of close, glossy, reads a lot older, some inconsistent.” | Batch-level negative quality finding; individual checkpoints were not assigned structured five-axis labels. |
| Passport candidates plus Qwen anchor edits, 18-cell board | Operator ruling on the board: “absolutely not even close”; the new-face route was shelved because creator-001 is g01. | One combined-board rejection, not separate per-image or per-branch labels. |
| expansion-03, 35 surviving cells | Operator full-resolution ruling: “mostly trash”; the earlier 24/35 thumbnail keep was explicitly withdrawn. | Whole-set rejection. The withdrawn thumbnail choices must not be reused as ground truth. |

Machine-selected files such as `creator-001-train-first-approved-cells.json`, calibration cache rows, Facenet scores, and Sonnet notes are not human labels.

## Local image availability

The Studio worktree contains the three anchors and all 31 Track-1 dataset cells. Its ignored historical output directories for the other four sets are absent.

Directories corresponding to all six calibration sets are currently readable under `C:/Users/danie/kb-worktrees/figment` at the absolute paths stored by the calibration run:

| Set | Directory | Images present |
|---|---|---:|
| anchors | `orgs/figment/personas/creator-001/anchors` | 3 |
| track1-dataset | `orgs/figment/pipeline/train/runs/creator-001-tensor-dataset` | 31 |
| lora-tester | `orgs/figment/pipeline/train/runs/out/creator-001-tensor-tester` | 8 |
| qwen-anchor-edits | `orgs/figment/runs/c001-t2/expand/runs/out/creator-001-anchor-edit` | 6 |
| passport-candidates | `orgs/figment/runs/c001-t2/expand/runs/out/creator-001-anchor-passport` | 12 |
| expansion-03 | `orgs/figment/personas/creator-001/batches/expansion-03/images` | 35 |

The historical calibration document records image IDs and old absolute source paths but does not bind candidate SHA-256 values. Present files at those paths cannot be claimed byte-identical to the 2026-09-07 calibration inputs solely from that artifact.

## Minimum first Codex compatibility probe

There is no small balanced positive/negative truth set in the historical material. Use six inputs only as a transport, schema, and directional sanity probe:

1. Self sanity: stage two byte-identical copies of g01 as candidate and reference. This should catch image attachment, schema, or gross judge-direction failures. It is a trivial same-file check, not evidence that Codex generalizes identity across pose or lighting.
2. Unlabeled legacy diagnostics: judge g02 and g07 individually against g01. Record the outputs, but do not count either as a positive or negative because the trio's same-person status is unverified.
3. Coarse negative controls: judge `c001-anchor-p01.png`, `c001-anchor-p06.png`, and `c001-anchor-p12.png` against g01. These are deterministic first/middle/last samples from the passport branch of the combined 18-cell board the operator rejected. The ruling is board-level, so these are diagnostic negative controls rather than per-image five-axis truth.

Record the exact input hashes, raw structured Codex outputs, backend/model identity, prompt version, and any unavailable result. The probe should test schema reliability and whether the g01 self-check is materially stronger than the coarse rejected-board controls. It is too small and too weakly labeled to establish numerical five-axis compatibility, recalibrate any threshold, or validate the existing Sonnet thresholds. Failure to distinguish even this coarse direction is evidence of incompatibility; apparent success is only enough to justify building a real human-labeled calibration set.

Current bytes for those six named inputs are below. These hashes were measured on 2026-09-09 from the readable historical checkout; the September 7 calibration artifact does not contain input hashes, so it cannot prove these are the exact bytes judged then.

| File | Bytes | SHA-256 |
|---|---:|---|
| `g01.jpg` | 737366 | `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed` |
| `g02.jpg` | 750657 | `d6ef8ec7a619162fb180727421b3c6f6ec05342544065c5f4a02e318ef4f12e6` |
| `g07.jpg` | 730186 | `f5457d845687aae1e23461560c2609a630b51bf2fc31cd21bc85ecbc7ed82d6a` |
| `c001-anchor-p01.png` | 990950 | `f6d3f4cb9b75aaf3328cce060254b5fd304719af96868debe10b07f28960c79e` |
| `c001-anchor-p06.png` | 896042 | `604c6bd3b5210492749a3306d852f2ca9d3620d51a5fedf2ff8d08e80ec7709a` |
| `c001-anchor-p12.png` | 927274 | `eaf48ae664759d09cb9fe25dc0ef77e991e6099439b3938840f0a1e40967fa1d` |

## Source inventory

| Source | SHA-256 |
|---|---|
| `orgs/figment/STATE.md` | `cb2d03b42d71714a638972e7282788e6eb3af6b7dae6a4d758ef383ad8545eef` |
| `orgs/figment/personas/creator-001/persona.yaml` | `9fdbb536a2e4c9895e332f13e1a4f11a41f938045a8b770d639b663c32be7492` |
| `orgs/figment/personas/creator-001/calibration/judge-calibration.json` | `1684020b20c48d85b11bf9777b919d5a6e683b9fa47975da73060f40b7b938e3` |
| `orgs/figment/personas/creator-001/calibration/judge-calibration.md` | `a4a5fd38e636164945e275445314252c0039169bc218f76d414305cd02b16edc` |
| `orgs/figment/pipeline/gate.yaml` | `3984619cdcca8cbd6a7ab82d0734117ceaf6de2a4cd894b74f5fdf0f0a64921b` |
| `orgs/figment/pipeline/vlm_judge.py` | `e6f33b22df5db9a066a448c77e2cafbd2a9d06b38c63211cf6229c7f08ff9220` |
