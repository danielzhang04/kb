# Tensor track — 10sorLabs module 11 on our harness

Faithful replication of the package's current training path (Ostris AI Toolkit + Krea-2 Raw),
its checkpoint-ranking harness (module 11's dataset tester), and its generation pass
(module 09), ported to `pipeline/pod/runpod_run.py`. Nothing here has been run on a GPU:
every number below is either read off their UI/JSON, read out of upstream source, or a
declared ceiling. Sources: `research/r15b-training.md` (module 11), `research/r15-10sorlabs-artefacts.md`
§3e and §3g, and the two package JSONs.

## Model and licence

| Thing | What it is | Licence | Gated | Verdict |
|---|---|---|---|---|
| `krea/Krea-2-Raw` | 12–13 B MMDiT, `raw.safetensors`; the model module 11 selects | Krea 2 Community License | **Yes** — access request + AUP | Not usable: the harness sends no HF token and never will (GUARDRAIL 5) |
| `Comfy-Org/Krea-2` → `diffusion_models/krea2_raw_bf16.safetensors` | Same weights, repackaged | Same Krea 2 Community License (`LICENSE.pdf` in repo) | **No** (`"gated": false`) | **Track 1 base.** Same model, no credential |
| `Comfy-Org/Krea-2` → `krea2_turbo_fp8_scaled` / `qwen3vl_4b_fp8_scaled` / `qwen_image_vae` | Inference trio for tester + module 09 | as above | No | Used as-is |
| `Qwen/Qwen3-VL-4B-Instruct`, `Qwen/Qwen-Image` (vae) | ai-toolkit's hardcoded text encoder and VAE for `arch: krea2` | Apache-2.0 | No | Pre-warmed in the readiness window |
| ostris/ai-toolkit | the trainer | MIT | — | Pinned at `b36bb399…` (v0.13.5, 2026-09-03) |
| RES4LYF | supplies the `res_2s` sampler; **not** ComfyUI core | AGPL-3.0 + no-commercial-image-service rider | — | Fine for our own generation; do not build a hosted generator on it. Core `res_multistep` is the AGPL-free fallback |
| `Phips/4xNomosWebPhoto_RealPLKSR` → `4xNomosWebPhoto_RealPLKSR.safetensors` | mid-chain upscaler | CC-BY-4.0 | No | Track-1 review finding 16: replaces `JCTN/UPSCALER_JCTN` → `4xNMKDSuperscale_4xNMKDSuperscale.pt` (unstated licence, `.pt` pickle) — the same substitute already used by the module-10 dataset port |

**FaceDetailer removed (finding 16).** `face_yolov8s.pt` (`Bingsu/adetailer`, Apache-2.0) is a
`.pt` pickle, which the brief forbids in any pod regardless of source licence. No verifiable
Apache/MIT **non-pickle** face detector was found to replace it: `ComfyUI-Impact-Subpack`'s
`ONNXDetectorProvider` node exists, but `Bingsu/adetailer` ships only `.pt` weights, and the one
ONNX face-detector repo found (`deepghs/yolo-face`) is under a custom
"model-distribution-disclaimer-license", not Apache/MIT. Per the brief's fallback, the
`UltralyticsDetectorProvider`/`FaceDetailer` branch (module 09 nodes 1631/1611) is dropped from
`creator-001-tensor-gen.yaml` entirely, and `ComfyUI-Impact-Pack`/`-Subpack` are no longer a
generation-stage dependency. Re-adding it needs a human-sourced, licence-verified ONNX (or other
non-pickle) face bbox detector — an open item, not resolved here.

Krea 2 Community License obligations that bind us: commercial use is free under **$1 M
trailing-12-month revenue and 50 seats**; a **content filter is mandatory** (our mandatory
visual QA, GUARDRAIL 4, is that filter — say so); a **redistributed** derivative model must
be named starting with "Krea" (we do not redistribute); AI disclosure where law or platform
requires it (the persona already carries it). The AUP bans CSAM, NCII/deepfakes of real
people, impersonation, publicity-right violations, and passing output off as human-made —
all already inside GUARDRAILS 1–3. Track 2, if the licence ever becomes unworkable:
`Qwen/Qwen-Image` (Apache-2.0, `arch: qwen_image`) — same lineage, since Krea-2 borrows
Qwen-Image's VAE and a Qwen3-VL encoder. Z-Image Base / klein 4B Base remain the cheap arms.

## Settings — theirs → ours

| Module 11 | Theirs | Ours | Note |
|---|---|---|---|
| model | Krea 2 (raw), gated repo | `krea2_raw_bf16.safetensors` from the ungated repackage | same weights |
| "do not use the turbo with the training adapter" | raw only | raw only | turbo is inference-only for us too |
| target / rank | LoRA / 32 | `network.linear: 32`, `linear_alpha: 32` | |
| optimizer / lr / weight decay | AdamW8Bit / 1e-4 / 1e-4 | `adamw8bit` / `1.0e-4` / `optimizer_params.weight_decay` | `1e-4` unquoted is a YAML *string*; must be `1.0e-4` |
| steps / batch / grad accum | 3000 / 1 / 1 | identical | |
| save dtype / every / keep | BF16 / 250 / 15 | identical | 15 is what makes all 12 rankable |
| quantize transformer / TE | qfloat8 / qfloat8, Low VRAM on, offload off | identical | |
| timestep / bias / loss | Linear / Balanced / MSE | identical | |
| cache text embeddings | ON | ON | |
| sampling | disabled (2 h → 70–80 min) | `disable_sampling: true` | |
| resolution buckets | 512 / 768 / 1024 | identical | |
| caption dropout / ext / repeats | 0.05 / txt / 1 | identical | |
| captions | Qwen3-VL auto-caption in the toolkit UI | `caption_mode` = `provided` (default) / `auto` / `single_word` | see below |
| GPU / wall clock | RTX PRO 6000 Blackwell 96 GB, 1 h 17 m | L40S 48 GB, **unmeasured** | the one number we cannot inherit |
| tester | 12 branches, one graph, seed 1595, 4 steps, cfg 1, res_2s/beta, 1448×2176, LoRA 1.0/1.0 | 12 **jobs**, one graph, all of the above identical | harness counts images per job |
| module 09 | base 4-step → NMKD ×4 → ×0.25 → re-encode → 4-step @ 0.35 → FaceDetailer @ 0.15 | base 4-step → RealPLKSR ×4 → ×0.25 → re-encode → 4-step @ 0.35 | style LoRAs and FaceDetailer dropped (finding 16 — see the model/licence table) |

Captioning: their captioner is `Qwen/Qwen3-VL-8B-Instruct` (float8, max res 512, 128 new
tokens) driven from the toolkit's web UI, which we do not run. **Structural constraint:** the
harness uploads the dataset *after* ComfyUI readiness, so on-pod captioning cannot happen in
the readiness window — it would run inside the training job window and cost the model
download plus ~2 min. Default is therefore `provided`: captions come off the module-10
dataset stage as `.txt` sidecars and upload with the images. `auto` implements their step on
the pod (transformers + their caption instruction) and is **unverified — no pod has run it**.
`single_word` writes module 04/05's legacy `woman`; module 11 explicitly retired it, so it is
a fallback for a caption-free dataset only.

## Step order

1. Dataset stage (module-10 replication, `expand/`) produces shard PNGs. The operator grades
   them per `expand/TENSOR-REPLICATION.md`'s grading protocol and records the approved subset
   as `[{"image": ..., "caption": ...}]` (or leaves them for `--mode class`).
2. `py -3 build_training_set.py --approved-cells <operator-graded.json> --out
   runs/creator-001-tensor-dataset` (or `--source-dir <dir> --mode class`) — the dataset-to-
   training bridge (Track-1 review finding 9). Writes `NN.png` + same-basename `.txt` captions,
   `dataset_manifest.json` (count, per-file sha256, caption mode; **not** `training.json` — see
   below), verifies every image/sidecar pair is on disk, then `_dataset.ready` last.
   `caption_mode`: `provided` (from the JSON, the default here), `class` (the single word
   `woman`), or `qwen3vl` (documented hook for module 11's auto-captioner — **not implemented**,
   raises rather than silently writing garbage captions).
3. `py -3 render_aitoolkit_config.py --template ai-toolkit-krea2.yaml.template --trigger
   creator001krea2 --dataset-dir /workspace/ComfyUI/input/creator001krea2 --out
   runs/creator-001-tensor-dataset/training.json`. This is the only writer of `training.json`
   in this directory — the ai-toolkit trainer config, uploaded and read by the pod as
   `training.config_name`. It refuses to write a config that has drifted off the module-11
   numbers (`--allow-drift` to override, deliberately loud).
4. `runs/creator-001-tensor-train.yaml` — bootstrap pulls the base; the start script installs
   ai-toolkit at the pin, pre-warms the encoder/VAE, starts ComfyUI; the harness uploads the
   dataset (`NN.png`/`NN.txt`/`training.json`, then `_dataset.ready`); the script captions
   (module 04/05 `single_word` fallback only — `provided` is the default and already captioned
   by step 2), runs `run.py training.json`, then verifies and copies **all 12** declared
   checkpoints (the 11 save-every-250 steps plus the exact step-3000 final, never an
   mtime-sorted guess) into `/workspace/output/`, writes a `_checkpoints.json` index, and only
   then touches `_training.complete` — failing closed with `_training.failed` if any of the 12
   is missing or empty (finding 10).
5. `runs/creator-001-tensor-tester.yaml` — no network volume. It uploads the 12 checkpoints the
   training run downloaded locally (`uploads` glob on `out/creator-001-tensor-train/*.safetensors`,
   same shape as the dataset upload) into `ComfyUI/input/creator001krea2`, and the launcher
   symlinks that directory to `models/loras` (finding 12). Renders the same
   prompt/seed/sampler/resolution 12 times with only `lora_name` varying. Operator eye-picks
   the winner (theirs was step 1250).
6. Copy the winner into `runs/creator-001-tensor-winner/`, then
   `runs/creator-001-tensor-gen.yaml` — 6 prompts × 2 seeds of angles and scenes the dataset
   never contained, identity LoRA at 0.80. Two `SaveImage` outputs per job (base, refined) —
   the FaceDetailer "final" branch is gone (finding 16); see the model/licence table.
7. Grade: `identity_check.py` own-anchor cosine over the 12 outputs **and** a full-resolution
   operator pass. Module 11's rule stands — the checkpoint is chosen by eye on a fixed grid,
   the cosine only vetoes.

## Cost and time per stage

| Stage | GPU | readiness / job ceiling | `max_minutes` | rate | preflight estimate | expected actual |
|---|---|---|---|---|---|---|
| train | L40S | 3600 s / 10800 s + 11 × 180 s artifact allowance | 280 | $1.30/h | **$6.0667** | 45–60 min setup + unmeasured train |
| tester | L40S | 2400 s / 300 s × 12 | 105 | $1.30/h | **$2.2750** | ~15 min setup + ~5 min render |
| gen | L40S | 2400 s / 600 s × 12 | 165 | $1.30/h | **$3.5750** | ~15 min setup + ~20 min render |

Rate is Track-1 review finding 15: `$0.89/h` was an underdeclared, unverified L40S price; use the
conservative `$1.30/h` the dataset port already uses everywhere until a live quote is recorded.
`max_minutes` for train is **280**, not the stale 245 (`readiness 3600 + job_timeout 10800 + 11 ×
artifact_download_seconds 180 + teardown 300 = 16680 s = 278 min` floor; see `HARNESS-CHANGES.md`
and `pod/runpod_run.py::minimum_runtime_minutes` — one shared job-timeout budget for the
completion marker, not `job_timeout × 12`). Ceiling = rate × `max_minutes` / 60 for each stage.
All three are `--dry-run` green and network-free, and all three (plus the dataset shards) now
also set `max_placement_attempts: 1` (finding 15 — no automatic multi-pod retry on a live run).
Run each with `--max-usd` at roughly the estimate. `governance/budget.yaml` caps the day at
**$10.00**; train ($6.07) and tester ($2.28) together are $8.34, so gen must run on its own day
(or a day where nothing else has spent yet), and the ledger reconciliation review findings 1-2
flag must be resolved before trusting any daily total — not addressed by this pass, see
`REVIEW-2026-09-03-track1.md`.

## Deviations, and why

1. **All twelve artifacts publish, no network volume (findings 10, 12).**
   `minimum_runtime_minutes` reserves one shared `job_timeout_seconds` budget for the
   completion-marker wait plus `artifact_download_seconds` (180 s) for each further artifact,
   not `job_timeout × artifact_count` — see `HARNESS-CHANGES.md`'s addendum. The start script
   verifies and copies the 11 save-every-250 checkpoints plus the exact step-3000 final into
   `/workspace/output/` (never an mtime-sorted guess) and fails closed before touching
   `_training.complete` if any is missing. The tester then uploads those 12 files from the
   harness's own local download directory — no recurring network-volume charge, no
   `REPLACE-WITH-RUNPOD-NETWORK-VOLUME-ID` sentinel.
2. **Tester is 12 jobs, not 12 graph branches.** The dry-run client returns exactly one image
   per job, so `expected_images > 1` can never be dry-run green. Twelve one-image jobs keep
   every variable except the checkpoint fixed, which is the whole point of §3g.
3. **Generation has two `SaveImage` outputs (base, refined), not the package's three
   (finding 16).** `expected_images: 2` is dry-run green now that multi-image dry-run support
   exists (commit `fda03ba2`). The third output — the package's FaceDetailer "final" — has no
   surviving branch: see the model/licence table above for why FaceDetailer was removed
   outright rather than kept with a `.pt` pickle.
4. **No style LoRAs.** Their final stack adds `RealisticSnapshotKrea2` 1.5 and `pawg_krea2`
   0.65 — third-party assets, one of them explicitly adult-tier. Out of bounds (GUARDRAIL 3).
5. **No FaceDetailer, no SAM (finding 16).** `face_yolov8s.pt` was a `.pt` pickle regardless of
   its Apache-2.0 licence; no verifiable Apache/MIT non-pickle replacement was found. `sam_model_opt`
   was already optional and dropped before this pass.
6. **Their fixed test prompt and their 12-branch graph are not reproduced** — licensed course
   content. Our ranking prompt holds the same variables fixed and is our own text.
7. **ComfyUI `v0.34.0`, not the repo's usual `v0.20.1`** — `comfy/ldm/krea2` did not exist yet.
8. **Start-script templates live in `runs/`** beside their manifests: the harness resolves
   `training.start_script_file` relative to the manifest directory and rejects `..`.

## What blocks a live run

1. **Dataset dependency closure is unproved (review finding 8).** Before shard-01 spends its
   full ceiling, `expand/runs/creator-001-tensor-smoke.yaml` — same custom nodes, models, and
   ComfyUI as the shards, one real job on the anchor pair — must show every
   `STEP node-deps-* rc=0` in `_bootstrap.log`, the model sha checks passing, and the job
   succeeding. See `expand/TENSOR-REPLICATION.md`.
2. **Daily budget.** `governance/budget.yaml` caps the day at $10.00; the ledger reconciliation
   review findings 1-2 flag (canonical ops ledger vs. this worktree's untracked rows, UTC vs.
   America/New_York day boundary) is unresolved and out of this pass's scope — do not trust a
   daily total from either ledger location until it lands.
3. **torch/CUDA pin.** Upstream installs `torch==2.13.0+cu130`; our proven image is
   cuda 12.8.1. `reinstall_torch` is `"0"` (use the image's torch) and that combination is
   untested against ai-toolkit's requirements. One install-only probe pod settles it.
4. **State-dict key compatibility.** ai-toolkit derives Krea-2's MMDiT keys from
   `krea/Krea-2-Raw`'s `raw.safetensors`; the Comfy-Org bf16 repackage is assumed key-for-key
   identical and has not been checked. Cheap to check: read the safetensors header only.
5. **Third-party node input names** (`res_2s`) are transcribed from the package graph and are
   not validated by dry-run.
6. **Throughput on 48 GB is unmeasured.** Their 77 min was a 96 GB Blackwell. If the L40S runs
   past the 10800 s marker deadline the run fails closed with nothing to show; a training-side
   smoke at reduced steps is the honest way to buy that number first — separate from, and
   still owed beyond, the dependency smoke in item 1.
7. **Model provenance is unpinned (review finding 5).** Downloads resolve mutable `main` with
   no `revision`/`sha256` verification on the model schema. Out of this pass's scope
   (`pod/runpod_run.py` model-download validation); manifests here declare no `revision`/`sha256`
   fields pending that harness change.
