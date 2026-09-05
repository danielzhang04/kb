# figment Track-1 — LoRA test grid ready; operator checkpoint ruling — 2026-09-04

**Topic:** faithful replication of the 10sorlabs pipeline (module-10 dataset → module-11 Krea-2 LoRA via ai-toolkit →
dataset tester) ran end to end on the pod harness; the first LoRA that holds creator-001's identity exists; the chain is
now driven by one persona-derived command. Parked at the operator's grade of the test grid.

### What WORKED (with evidence)
- **Dataset stage** — 31 cells (smoke + shards 01-03, $1.07 total); operator: "a lot closer", glossy, zoomed.
- **Training stage** — smoke #5 (100 steps) then the full 2000-step run: pod igvqxqcrmltsig, 99 min, $1.80, 8 checkpoints
  verified + downloaded (`orgs/figment/pipeline/train/runs/out/creator-001-tensor-train/`, run.json termination_verified).
- **Tester stage** — pod iw12lyi84um2b9, 8/8 jobs, $0.33; images + `grade/board.html` under
  `orgs/figment/pipeline/train/runs/out/creator-001-tensor-tester/`.
- **Identity** — facenet cosine to g01 (floor 0.836 = the anchors' own pairwise min): 1500 → 0.894, 1750 → 0.877,
  final → 0.880; 250 → 0.26 (unlearned). `orgs/figment/personas/creator-001/batches/tensor-tester-01/scores.json`.
- **Generalised command** — `orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage all --out <empty dir>`
  reproduces every manifest byte-for-byte; `grade --stage tester --plan <dir>/plan.json` built tonight's board (proof it
  reads real run outputs). 453 pod+train+pipeline tests green at 483b97eb.
- **Harness hardening from live evidence** — health window bounded by readiness timeout; full `_bootstrap.log`/`_comfy.log`
  saved on failure; dependency failures never learn a bad host (`status --forget-bad-host`); chunked uploads with
  per-part timeouts + on-pod sha assembly; per-job `wait_for`.

### What Did NOT Work (and why)
- **Full-run attempt on host v95p8r6160oe** — failed because the in-pod ComfyUI health loop was a fixed 240 s while the
  trainer wrapper installs ai-toolkit BEFORE exec'ing ComfyUI; a 1 MB/s host blew the window ($0.72). Fixed dfe18b83.
- **Tester attempt 1** — failed because the launcher did `rmdir models/loras`; ComfyUI ships `put_loras_here` there, so it
  is never empty ($0.10). Fixed d602cfe5 (moved aside to `.stock`).
- **Tester attempt 2** — failed because each 228 MB checkpoint POST died at the harness's fixed 30 s request timeout
  (RunPod proxy ceiling is 100 s) ($0.19). Fixed 483b97eb (16 MiB parts, size-scaled timeouts, `_loras.assembled` gate).
- **`figment_train.py plan` into the live pipeline dir** — refuses a non-empty out dir by design; plan into a fresh dir and
  copy/point run outputs in (what the boss did for the board). Migration of the hand-run layout is still owed.
- **`pytest orgs/figment/pipeline`** — 1 pre-existing failure + 2 errors in `calibrate/tests/test_grid_run.py` (stale
  grid-01 manifest vs the newer max_minutes preflight rule) and an ACL-locked stray `pod/pytest-of-danie` dir (pass
  `--ignore=orgs/figment/pipeline/pod/pytest-of-danie`). Neither touches the Track-1 path.

### What Has NOT Been Tried Yet
- Module-09 generation pass with the chosen checkpoint (`train/runs/creator-001-tensor-gen.yaml`, 12 jobs, ≈ $4 ceiling,
  185 min), then the package's stage-5 realism passes (tester faces are flat-lit and read older than the anchors).
- 3000-step run (module 11's number) on a fresh daily budget; captions via the qwen3vl hook instead of class "woman".
- creator-002 fixture through `figment_train.py run --stage all` — the pipeline acceptance test (persona 002 = synthetic).
- Retire `scratchpad/run_track1_night.py` and the hand-written manifests; merge `training.yaml` into `persona.yaml`.
- `.pt/.pth` general rejection in the harness; REVIEW-e lows 18/19/21; opus P0R of the training path (sonnet did it).

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/figment/pipeline/pod/runpod_run.py` | DONE | dfe18b83 + 483b97eb hardening, 257 tests |
| `orgs/figment/pipeline/train/runs/start-comfy-lorapath.sh.template` | DONE | move-aside + chunk assembler, bash-executed tests |
| `orgs/figment/pipeline/train/runs/creator-001-tensor-{train,tester,gen}.yaml` | DONE | live-proven (train, tester); gen dry-run only |
| `orgs/figment/pipeline/figment_train.py` (+ `training_config.py`, `train/tensor-pins.yaml`) | DONE | review folded c8c7d49e; `run` stage not yet exercised live |
| `orgs/figment/pipeline/train/runs/out/creator-001-tensor-train/` | DONE | 8 checkpoints (uncommitted, 1.8 GB) |
| `orgs/figment/pipeline/train/runs/out/creator-001-tensor-tester/` | DONE | 8 images + grade/board.html (uncommitted) |
| `orgs/figment/STATE.md` | DONE | 23:55 section |
| `ledgers/cost/figment-2026-09-04.tsv` | DONE | $6.32 today; published on ops |

### Exact Next Step
Daniel opens `C:/Users/danie/kb-worktrees/figment/orgs/figment/pipeline/train/runs/out/creator-001-tensor-tester/grade/board.html`,
rules identity/age/realism per checkpoint and names the winner (boss recommends 1500 or 1750). Then the boss runs
`creator-001-tensor-gen.yaml` with that checkpoint (`--max-usd 4.05 --max-minutes 185`; needs ≥ $4.05 daily headroom).

### Load list
- `orgs/figment/STATE.md` (23:55 section), `orgs/figment/MANDATE.md`, `orgs/figment/pipeline/GUARDRAILS.md`
- `orgs/figment/pipeline/train/FIGMENT-TRAIN.md`, `TENSOR-TRAINING.md`, `TENSOR-REPLICATION.md`
- `orgs/figment/pipeline/pod/README.md` (chunked uploads, bad-host classes)
- ops card `queue/working/d126c410-9bc54280.md`
- memory rule: figment deliverable = pipeline + tests, creator-001 is the fixture
