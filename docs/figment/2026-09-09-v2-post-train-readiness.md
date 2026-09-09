# Train-first v2 post-train readiness — 2026-09-09

Status update, 2026-09-09 22:42 UTC: train-first v2 completed at 22:37:53 UTC with its
receipt, five checkpoint hashes, and verified pod absence. The original tester CLI then
launched under the immutable v2 plan as PID `45324`, with one `$2.50`/115-minute placement
preflighted against the canonical ledger. Tester mechanics are active; there are no tester
originals, quality rulings, selected checkpoint, held-out still, or video result yet.

## Exact post-train order

1. Wait for the v2 train command to exit. Accept mechanical completion only from the
   plan-bound `run.json`, five expected checkpoint files and hashes, a final cost row, and
   teardown with pod absence verified. Never replay v1 or v2 to fill missing evidence.
2. Re-read the canonical ledger through the existing harness. The tester plan is capped at
   `$2.50` and 115 minutes, but the train and tester maximums together exceed the September 9
   `$10` daily limit. Run tester only if the fresh actual-spend check admits it. The immutable
   v2 command is:

   ```powershell
   & $py orgs/figment/pipeline/figment_train.py run `
     --creator creator-001 --stage tester `
     --plan 'C:/Users/danie/kb/_private/figment-builtin-train-first-20260909-v2/plan.json'
   ```

3. Require the tester receipt to contain five original PNGs, one for each of steps 250, 500,
   750, 1000, and final 1250, plus verified teardown and final cost. Completion does not rank
   or accept a checkpoint.
4. The reviewed local research-grade route prepares the plan-bound tester board without an
   external image judge or image export:

   ```powershell
   & $py orgs/figment/pipeline/figment_train.py grade `
     --creator creator-001 --stage tester `
     --plan 'C:/Users/danie/kb/_private/figment-builtin-train-first-20260909-v2/plan.json' `
     --judge-backend local-research
   ```

   It runs the existing stage-1 diagnostics and records every automatic result as failed
   `unavailable: judge`; it never reuses Sonnet thresholds or creates a pass. An actual local
   execution also depends on the existing scorer cache and offline environment: the legacy
   scorer can attempt its own network fetch when its model is absent, and `HF_HUB_OFFLINE`
   alone is not a global network block. Preserve unavailable diagnostics rather than changing
   the scorer stack. Do not substitute the default Claude backend or `--skip-judge`.

   Separately, the proposed 120-second Codex g01 self-comparison was rejected by approval
   review because its exact image transfer was not authorized. It remains pending and does
   not authorize tester or gen images, a complete Codex grade, or a reroute.
5. Review all five original tester PNGs against g01 for same-person identity, realistic skin
   and anatomy, clearly adult/about-21 presentation, clothing integrity, and pairwise
   consistency. Quality is not predictable from training completion or local tests. A kept
   checkpoint requires a complete attributed ruling and a concrete `gate_override`, then:

   ```powershell
   & $py orgs/figment/pipeline/figment_train.py apply-rulings `
     --creator creator-001 --stage tester `
     --plan 'C:/Users/danie/kb/_private/figment-builtin-train-first-20260909-v2/plan.json' `
     --rulings '<ACTUAL_TESTER_RULINGS_JSON>' --checkpoint-step <KEPT_STEP>
   ```

   The existing command verifies the current evaluation-subject hash, retained candidate,
   training and tester receipts, checkpoint bytes, and teardown before writing checkpoint
   lineage. No keep means no checkpoint selection.
6. Only a selected current checkpoint can produce a fresh `gen` plan. Use a new empty plan
   root and the canonical ledger; run, local-research grade, review originals, and apply
   rulings. The selected still must appear in the current `approved-list.json` before the
   approved-still video adapter can consume it. The blocked Codex transfer is separate and is
   not part of this local research path.

## Evidence already established

- V2 plan SHA-256 is
  `920125ce7e543c95b62d3d808675ebbc5b419fcb2da4e55d6f853518b8343ec3`.
  Its reviewed v1-to-v2 change is limited to fresh paths/timestamp/generator evidence and the
  failed-host exclusion on the train manifest.
- The train manifest selects exactly 42 files and 42,036,431 bytes: 20 PNGs, 20 captions,
  `training.json`, and `_dataset.ready`. Dataset and approval bytes match v1.
- Isolated Python 3.13 harness dry runs passed for the exact v2 train and tester manifests,
  including five fake checkpoints, five fake tester outputs, recovery journals, and verified
  fake teardown. This proves command shape and harness joins, not provider or model behavior.
- The Codex diagnostic integration received a 123-test independent pass. A focused current
  check of backend selection plus the real train-first-to-gen and approved-gen-to-video fixture
  joins passed four tests. These are offline fixture results; no live Codex diagnostic has run.

## Video compiler status after an approved still

The compiler previously emitted only 512×288, the spatial profile used by the visually
rejected historical V1 clip. A bounded local implementation now reuses the same pinned native
workflow and model pins with two finite profiles: receipt diagnostics retain their 512×288
default, while approved-gen manifests default to and require 1280×704. The profile,
dimensions, effective workflow digest, and output name are bound together. Twenty-four
focused tests and the 48-test full video suite passed, including the real approved-gen lineage
join and a native-profile harness dry run with 81 fake outputs and verified teardown.
Independent source review returned READY with no findings. This
local evidence does not establish video quality or authorize a video launch.

Mechanically, tonight can complete receipt verification, tester execution if the fresh budget
admits it, and preparation of original-resolution review material. Identity, age presentation,
realism, checkpoint selection, held-out still quality, and temporal quality remain empirical
results. No production LoRA, still, or video is claimed here.
