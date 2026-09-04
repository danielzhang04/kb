# T1-R — adversarial review of the Track-1 replication

Reviewed branch `claude/figment` at `e629617e` against commits `e629617e`, `fda03ba2`,
`52ab87db`, and `b2c679b9`. The package installers were read as text and were never
executed. No live API call or paid action was made. This review is the only tracked file
written, and it is not committed.

## Verdict

**Do not start shard-01.** All four paid stages are currently **LIVE-SAFE: NO**. The core
dataset graph is a close, auditable port and the module-11 numeric training recipe is
faithful, but the live path has independent blockers in budget authority, provenance,
prompt safety, dataset handoff, artifact publication, checkpoint transport, and generation
weights.

Finding counts: **11 blocker, 6 high, 2 med, 2 low (21 total)**.

## Verification performed

| Check | Result |
| --- | --- |
| Required preamble | `PREAMBLE OK` |
| Focused Track-1 tests | `219 passed in 10.72s` |
| Full pod + train + expand suites | `343 passed in 15.82s` |
| Required pytest temp root | `PYTEST_DEBUG_TEMPROOT=C:/Users/danie/AppData/Local/Temp/kbfp-t1r`; it was absent before the run |
| Six manifest dry-runs | all exited 0; three dataset estimates `$2.708333`, train `$4.153333`, tester `$1.557500`, gen `$2.447500` |
| Patch hygiene | `git diff --check b2c679b9^..e629617e` clean |
| Merge simulation | no conflict markers from `git merge-tree` against `origin/claude/figment` |
| Live/network activity | none |

The passing tests and dry-runs do not overturn the findings below: dry-run synthesizes
training artifacts, does not install remote dependencies, does not load model state dicts,
does not exercise real RunPod placement/pricing, and does not reconcile the live ledgers.

## Findings

| # | severity | file:line | defect | concrete fix |
| --- | --- | --- | --- | --- |
| 1 | blocker | `pod/runpod_run.py:68,1711-1719,1782-1811`; `MANDATE.md:155-156` | The default ledger root is the ops worktree whenever that directory merely exists. It exists and contains 98 files but **zero** `figment-*.tsv`; the current Figment spend is instead in three untracked files under this worktree. A live command that omits `--ledger-dir` therefore sees arc spend `$0`, not the recorded Figment spend, and writes the next provisional row to the wrong baseline. | Reconcile every Figment row and its `run.json` to the canonical ops ledger first. Make the harness refuse a missing expected arc-ledger baseline rather than silently treating it as zero. Pass the reconciled canonical ops directory explicitly on every command. |
| 2 | blocker | `pod/runpod_run.py:1733,2821,2862`; `ledgers/cost/figment-2026-09-03.tsv:14`; `ledgers/cost/figment-2026-09-04.tsv:2` | “Today” is UTC, while the operating day and brief are America/New_York. After 20:00 EDT, the daily guard rolls over early. The same pod `nc27uic26ifb2s` is also present as a `$1.093333` provisional row on Sep 3 and a `$0.382293` settled row on Sep 4, proving that recomputing the filename at teardown double-counts the arc. The three local ledgers sum `$7.748120`, which disagrees with `STATE.md`'s `$8.74`; the authoritative current spend is unknown. | Define the governance day explicitly (America/New_York unless the human rules UTC), use that day consistently, and capture one ledger path at acquisition for settlement. Reconcile/deduplicate the existing rows against `run.json` before any create. Add boundary tests at 19:59/20:01 EDT and across UTC midnight. |
| 3 | blocker | `contract.md:19-20,57`; `MANDATE.md:150-156`; `STATE.md:116` | The binding contract and mandate say a **$50 total** creator-001 cap, while `STATE.md` and prior run instructions use `$52.85`. A state note cannot widen the contract. Using `$52.85` without a contract-level human ruling breaches the authorization ceiling. | Use `--arc-cap-usd 50.00` now. If `$52.85` is truly intended, record the human ruling in the governing contract/mandate before any live run. |
| 4 | blocker | `look-spec-v2.md:301-317`; `expand/templates/tensor-dataset-prompts.yaml:33`; `expand/workflows/tensor_dataset_v2_api.json:57`; `expand/tests/test_tensor_dataset.py:274-290` | Section 4c says never write `small`, but the shipped body identity says `small frame` and `small cross pendant`. The test imports only the section-4a list, so it passes. The unsafe prompt is in the API graph submitted even for shard-01. This violates the brief's no age-ambiguous-token condition. | Rewrite the body identity without any section-4c token and update the baked graph plus shard prompts. Build the prompt guard from all applicable look-spec bans (including whole-word `small`, `little`, `cute`, etc.), not the older section-4a mirror. |
| 5 | blocker | `pod/runpod_run.py:1615-1623,2192-2211`; `research/10sorlabs-package/10_dataset_generator_v2/dataset_generator_model_installer.bat:30-44,113-154` | Every model download resolves mutable Hugging Face `main` and accepts any positive-size body; no revision or digest is declared or verified. The source installer verifies SHA-256 for every weight. This loses provenance and violates `contract.md:23`'s pinned file-revision gate for newly promoted models. Safetensors prevents pickle execution, not silent weight drift. | Extend the model schema with immutable `revision` and required `sha256`, build revisioned URLs, verify the digest before `mv`, and populate trusted digests for every dataset/train/tester/gen model. |
| 6 | blocker | `expand/runs/creator-001-tensor-dataset-shard-01.yaml:4,31-36`; `train/runs/creator-001-tensor-tester.yaml:39-43`; `train/runs/creator-001-tensor-gen.yaml:48-57`; `pod/runpod_run.py:2216-2228` | Dataset manifests record installer SHAs but the harness ignores `installer_pin` and clones depth-1 default branches. Tester/gen do not record pins at all. Remote code and `requirements.txt` therefore drift at pod start and run as root. This also violates the pinned-node gate in `contract.md:23`. | Validate and enforce a 40-hex `git_ref`/`installer_pin`: fetch that object, checkout detached, verify `HEAD`, then install requirements. Add the package pins to tester/gen (RES4LYF `e716cd1…`, Impact-Pack `429d015…`, Subpack `50c7b71…`) and pin every other promoted node. |
| 7 | blocker | `pod/runpod_run.py:1409-1413,2986,3041-3144`; `expand/runs/creator-001-tensor-dataset-shard-01.yaml:12` | `max_placement_attempts` defaults to 4. Because shard-01 has an avoided host, one invocation may automatically terminate and create up to four billable pods. That contradicts the brief's “nothing retries live automatically.” The whole-run failure is not retried, but paid placement is. | Put `"max_placement_attempts": 1` in every live manifest for this brief, or change the harness default to 1. Any retry must be a new human-approved invocation/card. Internal same-pod bounded transport retries may remain if the governing card permits them. |
| 8 | high | `expand/TENSOR-REPLICATION.md:110-122`; `expand/runs/creator-001-tensor-dataset-shard-01.yaml:31-36` | Dataset dependency closure is explicitly unproved: FaceAnalysis's insightface/dlib install can fail fatally, `buffalo_l` is fetched at runtime outside the model manifest, and RealPLKSR/spandrel compatibility has not been loaded. KJNodes is correctly included for `ImageResizeKJv2`, but its recorded pin is not enforced (finding 6). `/system_stats` readiness alone does not prove these workflow classes/models can execute. | Before a 125-minute shard, run the exact image and pinned nodes in an approved install/import probe or reproducible local container. Declare and hash the insightface pack; query `/object_info` for every required class; add a tiny model-load/workflow smoke. Keep the documented core scaler fallback for RealPLKSR failure. |
| 9 | blocker | `train/TENSOR-TRAINING.md:55-76`; `train/runs/creator-001-tensor-train.yaml:42-60,69`; `train/runs/start-training-aitoolkit.sh.template:72-83` | The dataset-to-training bridge does not exist. The dataset runs return PNGs only; no implemented step gathers approved images, generates same-basename descriptive `.txt` files, writes `_dataset.ready` last, or places `training.json` under `train/runs/creator-001-tensor-dataset/` (that directory is absent). Yet training defaults to `caption_mode: provided`, and live preflight currently fails on the missing upload globs. This is also the material fidelity gap from module 11's Qwen3-VL auto-captioning. | Implement one owned assembly step: gather only human-approved images, generate module-11-equivalent descriptive captions (Qwen3-VL 8B, float8, max-res 512, 128 tokens, low-VRAM) or explicitly approve an offline equivalent, render/validate `training.json`, verify every image/sidecar pair, and write `_dataset.ready` last. Do not use `single_word`. |
| 10 | blocker | `train/runs/creator-001-tensor-train.yaml:92-164`; `train/runs/start-training-aitoolkit.sh.template:138-148` | The manifest declares 12 downloadable checkpoints, but the start script copies only the newest file to `/workspace/output/creator001krea2.safetensors`; the eleven numbered artifacts remain under `/workspace/train-output`. After `_training.complete`, the first `/view` request for `_000000250.safetensors` returns 404 and the paid run fails. Dry-run fabricates all 12, so tests miss this. | Verify the exact 11 cadence names plus final, copy/hardlink all 12 into `/workspace/output`, then write the index and completion marker. Fail before the marker if any expected file is absent or empty; do not infer “final” from mtime. |
| 11 | high | `pod/runpod_run.py:1491-1515,3228-3266`; `train/runs/creator-001-tensor-train.yaml:13-15` | Preflight reserves one 10,800-second marker/job window plus only 11×180 seconds, but runtime gives the **first download a fresh 10,800-second timeout after** the marker wait. Thus the stated `3600 + 10800 + 11×180 + 300 = 16680s` floor does not bound the implemented runtime. The global 280-minute watchdog can kill the first download with only two minutes of slack. | Make the first artifact share the remaining marker deadline, matching the documented formula, or reserve an explicit download allowance for all 12 artifacts and raise `max_minutes`/`--max-usd`. Add a test where the marker consumes nearly the full shared deadline. |
| 12 | blocker | `train/runs/creator-001-tensor-train.yaml:9-11`; `train/runs/creator-001-tensor-tester.yaml:9-12,165`; `train/TENSOR-TRAINING.md:73-80,123-127` | Tester names a literal `REPLACE-WITH-RUNPOD-NETWORK-VOLUME-ID` and reads `/workspace/train-output/creator001krea2`, but training creates only an ephemeral 200-GB volume and declares no network volume. Even after finding 10 is fixed, tester cannot see the checkpoints. The doc incorrectly says both manifests share a volume. | Prefer the non-recurring design: download all 12 safe tensors from training, upload them to tester input, point `lora_source_dir` there, and remove the placeholder. If a network volume is chosen instead, it requires a separate recurring-cost human approval and the same real ID in both manifests. |
| 13 | high | `train/runs/creator-001-tensor-train.yaml:12,74-77`; `train/runs/start-training-aitoolkit.sh.template:33-58`; `train/TENSOR-TRAINING.md:129-131` | `reinstall_torch: 0` leaves image torch/CUDA 12.8 in place, then blindly installs the pinned ai-toolkit requirements. Compatibility with the upstream cu130 expectation is explicitly untested; dependency resolution may still replace torch. A failure can consume the full readiness window. | Lock the resolved Python environment at the ai-toolkit commit and prove install + `torch.cuda` + trainer import against the exact RunPod image before training. Abort if requirements change torch unexpectedly. Record the probe result and package lock. |
| 14 | high | `train/runs/creator-001-tensor-train.yaml:22-27`; `train/TENSOR-TRAINING.md:132-134` | The ungated `Comfy-Org/Krea-2` raw BF16 repackage is assumed key-for-key compatible with ai-toolkit's gated `krea/Krea-2-Raw/raw.safetensors`; it has not been checked. Licence/gating rationale is written and acceptable, but file-format compatibility is a live blocker condition. | Read and compare safetensors headers/state-dict keys and required tensor shapes before spend. If they differ, use the original gated file through the HF secret-reference path after human licence acceptance, without exposing the token value. |
| 15 | high | `train/runs/creator-001-tensor-train.yaml:7-8`; `train/runs/creator-001-tensor-tester.yaml:7-8`; `train/runs/creator-001-tensor-gen.yaml:7-8`; `expand/TENSOR-REPLICATION.md:90-97`; `train/TENSOR-TRAINING.md:88-99` | Train/tester/gen assume `$0.89/h`, while the dataset port uses `$1.30/h` as the conservative L40S SECURE rate and the training doc itself says the tier was unverified. READY-price recheck prevents work over `--max-usd`, but pre-READY failure is settled using the underdeclared manifest rate. The doc is also arithmetically stale: train is now 280, not 245 minutes, and `$4.89 + $3.63` does not exceed the `$10` daily limit. Current L40S availability/price was not independently queried in this read-only/no-network review. | Until a current live quote is recorded, use `$1.30/h` in all L40S manifests: train `$6.0667`, tester `$2.2750`, gen `$3.5750`. Keep the READY-rate fail-closed check and update the daily schedule/docs from generated arithmetic. |
| 16 | blocker | `train/runs/creator-001-tensor-gen.yaml:37-45,167,250`; `train/TENSOR-TRAINING.md:20-22,110-116` | Generation downloads and loads `4xNMKDSuperscale…pt` and `face_yolov8s.pt`. The brief forbids any `.pt`/`.pth` pickle entering a pod. The NMKD mirror also has no stated licence. Omitting SAM is correct, but these two files independently fail the same safety boundary. | Replace the upscaler with the already-approved RealPLKSR safetensors. Use a compatible non-pickle detector (for example a reviewed ONNX path) or remove FaceDetailer until one exists. Reject `.pt`/`.pth` in model-manifest validation. |
| 17 | med | `train/TENSOR-TRAINING.md:52-53,101-118`; `train/runs/creator-001-tensor-tester.yaml:167-313`; `train/runs/creator-001-tensor-gen.yaml:315,345-607`; `research/10sorlabs-package/11_lora_training_krea/10sorlabs_dataset_tester.json:1`; `research/10sorlabs-package/09_krea2_image/10sorlabs_krea2_image.json:1` | Tester is 12 sequential one-image jobs instead of the source's one 12-branch graph, and generation emits only the final FaceDetailer image instead of base/upscaled/final. Those deviations were justified by old dry-run limitations, but commit `fda03ba2` added multi-image dry-run support. Tester remains semantically close (same fixed variables), while generation loses two diagnostically useful outputs. | Restore tester's 12-output graph with `expected_images: 12`, or document a current non-simulator reason for sequential jobs. Restore module-09's three `SaveImage` nodes and use `expected_images: 3`. Keep the justified style-LoRA and SAM omissions. |
| 18 | high | `pod/runpod_run.py:1441-1488,1890-1894,2192-2228` | The HF-token path itself is disciplined: only a RunPod reference literal reaches the payload, curl expands `$HF_TOKEN` without echo/xtrace, and it is unset before nodes/Comfy. But the public schema accepts **any** environment variable while bootstrap unsets only `HF_TOKEN`. A different referenced secret remains inherited by cloned custom code, pip, the trainer, and ComfyUI and can reach their logs; the advertised generic guarantee is false. | Restrict `env_secret_refs` to the sole supported `HF_TOKEN` mapping, or generate cleanup for every configured secret before any untrusted child process. Keep a narrow allowlist of downloader consumers and test that every declared secret variable is absent from node/trainer/Comfy environments. |
| 19 | low | `train/ai-toolkit-krea2.yaml.template:15-63`; `train/render_aitoolkit_config.py:73-100` | The rendered values currently match module 11, including `lr` as a float, but repeats=1 is only asserted in prose and is absent from the config. The drift checker also omits `linear_alpha`, weight decay, caption extension, repeats, TE quantization/qtype, layer offloading, and loss/content settings. A future edit can silently break fidelity while the renderer stays green. | Encode the ai-toolkit repeat field explicitly (or pin/prove its default) and add every declared module-11 invariant to `check_module_11` and its tests. |
| 20 | low | `pod/runpod_run.py:392,3080-3085,3390-3415` | Ordinary create/readiness/upload/job/artifact/error/watchdog exits retain terminate-and-verify, but the pre-existing narrow interrupt window remains: `placement_needs_close` becomes true only after `lease.__enter__` returns. An interrupt after acquisition but before line 3085 relies on `atexit`, not the primary verified-finally path, so “verified on every exit” is not literally proved. | Arm the finalizer before entering/acquiring, and add an injected interrupt at that boundary that asserts synchronous termination plus `termination_verified: true`. |
| 21 | med | `train/TENSOR-TRAINING.md:14,73-80,88-112,123-139` | The operator document contradicts the current code in several spend-relevant places: it says the harness will never send an HF token, describes one artifact and a shared network volume, lists 245 training minutes, says multi-image dry-run is unsupported, and gives stale costs. Following it can select the wrong storage and ceilings. | Regenerate the document from the settled design after findings 9-18 are fixed; add a test that its stage table agrees with manifest `max_minutes`, rate, artifact count, and storage mode. |

## Fidelity conclusions

### Dataset graph

The package UI graph has 70 nodes; the API port has 55. I compared retained node IDs,
widgets, and connections. Apart from the documented loader/LoRA substitutions and the output
multiplexer, retained edges and settings match. In particular:

- Qwen edit samplers remain 4 steps, cfg 1, `linear/euler` + `beta57`, eta 0.31/0.30,
  denoise 1, with the same fixed seeds and detail-boost windows.
- Face crop padding 15, 1680 resize, 1024×1440 latent, 1 MP → 4× → 0.5 geometry,
  and the 4-step cfg-1 euler/beta refine at denoise 0.23 are preserved.
- Replacing the unaudited NSFW AIO and gravedigga LoRAs with official Qwen split weights +
  Lightning, replacing gated/non-commercial klein 9B with Apache-2.0 klein 4B, replacing
  `zit_upscaler` with CC-BY-4.0 RealPLKSR, and omitting the unused SAM pickle are the closest
  faithful safe substitutions and are adequately reasoned.
- The shipped graph/templates/manifests contain none of `qwen-rapid-aio`,
  `CheckpointLoaderSimple`, `bfs_head_v5`, `qwen2512_`, `zit_upscaler`, `sam_vit_b`,
  `remove the clothes`, or `fully naked`. The removal branch does not survive.

The graph therefore passes structural fidelity but fails live prompt/provenance safety in
findings 4-8.

### Training, tester, and generation

The rendered training recipe correctly uses Krea2 Raw, rank/alpha 32, AdamW8bit, LR
`1.0e-4` parsed as a float, weight decay `0.0001`, 3000 steps, batch/accumulation 1/1,
BF16 saves every 250 with keep=15, qfloat8 transformer and text encoder, low-VRAM on,
offload off, linear/balanced/MSE, cached text embeddings, no samples, and 512/768/1024
buckets. Finding 19 is about durability of that match, not a current numeric mismatch.

Tester preserves the important evaluation invariants: 12 checkpoints, seed 1595, 4 steps,
cfg 1, `res_2s`/`beta`, 1448×2176, and LoRA 1.0/1.0. Its own fixed prompt is a documented
copyright/provenance substitute. Generation preserves the base → ×4 → ×0.25 → re-encode →
4-step denoise-0.35 refine → 4-step denoise-0.15 face-detail chain. Dropping the adult-tier
style LoRAs and SAM is necessary. Findings 12, 16, and 17 are what prevent those graphs from
being runnable faithful stages today.

## Boundary arithmetic

| stage | preflight expression | floor | manifest max | manifest rate × max | result |
| --- | --- | ---: | ---: | ---: | --- |
| dataset shard-01/02/03 | `2700 + 10×450 + 300` | 125 min | 125 | `$2.708333` each | arithmetic passes exactly; no schedule slack |
| train | `3600 + 10800 + 11×180 + 300` | 278 min | 280 | `$4.153333` at `$0.89/h` | declared arithmetic passes; runtime mismatch in finding 11 |
| tester | `2400 + 12×300 + 300` | 105 min | 105 | `$1.557500` at `$0.89/h` | arithmetic passes exactly; no schedule slack |
| gen | `2400 + 12×600 + 300` | 165 min | 165 | `$2.447500` at `$0.89/h` | arithmetic passes exactly; no schedule slack |

`container_disk_gb: 100` is plausible for the documented ~47 GB dataset downloads plus
ComfyUI and dependencies, but that conclusion is only arithmetic; readiness has not measured
actual peak disk. L40S is the correct 48-GB class for the dataset stack. Availability is not
guaranteed; an unavailable exact type fails closed at create. The training-tier `$0.89/h`
assumption is not conservative (finding 15).

With a conservative `$1.30/h` rate, use ceilings of train `$6.10`, tester `$2.30`, and gen
`$3.60`. On a fresh reconciled governance day, the three dataset estimates total `$8.125`,
train + tester total `$8.342`, and generation must run on another day. The unsettled current
ledger state must be repaired before relying on either daily or arc arithmetic.

## Per-stage live verdicts

| stage | LIVE-SAFE | conditions required to flip to YES |
| --- | --- | --- |
| dataset shard-01 | **NO** | Fix 1-8: reconcile/use the canonical ledger, enforce the `$50` cap and one placement, remove section-4c tokens, hash/revision-pin every model, enforce node SHAs, and prove FaceAnalysis/insightface/KJNodes/RealPLKSR dependency closure. |
| training | **NO** | Dataset must pass and be human-curated; then fix 9-11, 13-15, 18-19. The exact 12 artifacts must survive locally, the raw state dict and pinned environment must be proved, the rate/day must be approved, and the L40S throughput should first be measured with a separately approved bounded smoke. |
| tester | **NO** | Training must pass; fix 6, 12, 15, 17-18. Upload the 12 downloaded safetensors (or obtain explicit recurring-volume approval), enforce node pins, and prove the RES4LYF node inputs at the pinned commit. |
| generation | **NO** | A checkpoint must win the human full-resolution ranking; fix 5-6 and 15-18. No `.pt`/`.pth` may enter the pod, all three diagnostic outputs must be restored, and node/model revisions must be pinned. |

## Exact CLI after the corresponding verdict becomes YES

These are **not authorization to run**. They are the exact commands for the repaired design.
They deliberately use the binding `$50.00` cap and the canonical ops ledger; do not run them
until that directory has been reconciled per findings 1-3. Each live invocation still needs
the T2 card and human approval required by `contract.md`.

Dataset shard-01:

```powershell
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/expand/runs/creator-001-tensor-dataset-shard-01.yaml --out orgs/figment/pipeline/expand/runs/out/creator-001-tensor-dataset-shard-01 --max-usd 2.75 --max-minutes 125 --ledger-dir C:/Users/danie/kb-worktrees/dashboard-ops/ledgers/cost --arc-cap-usd 50.00 --arc-ledger-glob 'figment-*.tsv'
```

Dataset shard-02 and shard-03, only after the shard-01 eye gate:

```powershell
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/expand/runs/creator-001-tensor-dataset-shard-02.yaml --out orgs/figment/pipeline/expand/runs/out/creator-001-tensor-dataset-shard-02 --max-usd 2.75 --max-minutes 125 --ledger-dir C:/Users/danie/kb-worktrees/dashboard-ops/ledgers/cost --arc-cap-usd 50.00 --arc-ledger-glob 'figment-*.tsv'
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/expand/runs/creator-001-tensor-dataset-shard-03.yaml --out orgs/figment/pipeline/expand/runs/out/creator-001-tensor-dataset-shard-03 --max-usd 2.75 --max-minutes 125 --ledger-dir C:/Users/danie/kb-worktrees/dashboard-ops/ledgers/cost --arc-cap-usd 50.00 --arc-ledger-glob 'figment-*.tsv'
```

After assembling/captioning the human-approved dataset and before training, render the config:

```powershell
py -3 orgs/figment/pipeline/train/render_aitoolkit_config.py --template orgs/figment/pipeline/train/ai-toolkit-krea2.yaml.template --trigger creator001krea2 --dataset-dir /workspace/ComfyUI/input/creator001krea2 --output-dir /workspace/train-output --base-model-path /workspace/models/krea2/krea2_raw_bf16.safetensors --out orgs/figment/pipeline/train/runs/creator-001-tensor-dataset/training.json
```

Training, after changing the manifest rate to `$1.30/h` and fixing artifact publication:

```powershell
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/train/runs/creator-001-tensor-train.yaml --out orgs/figment/pipeline/train/runs/out/creator-001-tensor-train --max-usd 6.10 --max-minutes 280 --ledger-dir C:/Users/danie/kb-worktrees/dashboard-ops/ledgers/cost --arc-cap-usd 50.00 --arc-ledger-glob 'figment-*.tsv'
```

Tester, after uploading the 12 returned checkpoints under the repaired manifest:

```powershell
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/train/runs/creator-001-tensor-tester.yaml --out orgs/figment/pipeline/train/runs/out/creator-001-tensor-tester --max-usd 2.30 --max-minutes 105 --ledger-dir C:/Users/danie/kb-worktrees/dashboard-ops/ledgers/cost --arc-cap-usd 50.00 --arc-ledger-glob 'figment-*.tsv'
```

Generation, after the human-selected winner is placed in
`train/runs/creator-001-tensor-winner/` and the pickle models are removed:

```powershell
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/train/runs/creator-001-tensor-gen.yaml --out orgs/figment/pipeline/train/runs/out/creator-001-tensor-gen --max-usd 3.60 --max-minutes 165 --ledger-dir C:/Users/danie/kb-worktrees/dashboard-ops/ledgers/cost --arc-cap-usd 50.00 --arc-ledger-glob 'figment-*.tsv'
```

## Must land before shard-01

1. Reconcile the Figment ledgers to `ops`, deduplicate the midnight pod, make the daily-day
   definition explicit, and prove the resulting daily/arc totals against every `run.json`.
2. Obey the binding `$50.00` cap (or obtain a contract-level human amendment), and set
   `max_placement_attempts: 1`.
3. Remove every section-4c age-ambiguous token from the API graph/templates/shards and extend
   the test to the full rule.
4. Add immutable revisions + SHA-256 verification for all model files and enforce detached
   custom-node SHAs.
5. Prove the exact pinned dataset dependency closure—FaceAnalysis/insightface model pack,
   KJNodes, spandrel, and RealPLKSR—before spending a full shard ceiling.

Until all five are evidenced, shard-01 remains **NO** even though its graph fidelity and
preflight arithmetic are otherwise sound.
