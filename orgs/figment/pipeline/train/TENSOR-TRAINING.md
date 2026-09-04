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
| ComfyUI-Impact-Pack / -Subpack | `FaceDetailer`, `UltralyticsDetectorProvider` | GPL-3.0 (Ultralytics weights are AGPL-3.0) | — | Same reasoning; not redistributed |
| `Bingsu/adetailer` → `face_yolov8s.pt` | face bbox detector | Apache-2.0 | No | **Deviation:** they use `face_yolov8m.pt`; the `m` weight is not in this repo |
| `JCTN/UPSCALER_JCTN` → `4xNMKDSuperscale_4xNMKDSuperscale.pt` | mid-chain upscaler | unstated on the mirror | No | Flagged: re-host or swap before anything ships publicly |

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
| module 09 | base 4-step → NMKD ×4 → ×0.25 → re-encode → 4-step @ 0.35 → FaceDetailer @ 0.15 | identical | style LoRAs dropped |

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

1. Dataset stage (module-10 replication) produces `runs/creator-001-tensor-dataset/` —
   images + same-basename `.txt`, then `_dataset.ready` written last.
2. `py -3 render_aitoolkit_config.py --template ai-toolkit-krea2.yaml.template --trigger
   creator001krea2 --dataset-dir /workspace/ComfyUI/input/creator001krea2 --out
   runs/creator-001-tensor-dataset/training.json`. It refuses to write a config that has
   drifted off the module-11 numbers (`--allow-drift` to override, deliberately loud).
3. `runs/creator-001-tensor-train.yaml` — bootstrap pulls the base; the start script installs
   ai-toolkit at the pin, pre-warms the encoder/VAE, starts ComfyUI; the harness uploads the
   dataset; the script captions, runs `run.py training.json`, copies the newest checkpoint to
   `/workspace/output/<trigger>.safetensors` and a `_checkpoints.json` index, touches
   `_training.complete`. All 12 saves stay on the network volume at `/workspace/train-output/`.
4. `runs/creator-001-tensor-tester.yaml` — mounts the same volume, symlinks
   `models/loras` → the checkpoint dir, renders the same prompt/seed/sampler/resolution 12
   times with only `lora_name` varying. Operator eye-picks the winner (theirs was step 1250).
5. Copy the winner into `runs/creator-001-tensor-winner/`, then
   `runs/creator-001-tensor-gen.yaml` — 6 prompts × 2 seeds of angles and scenes the dataset
   never contained, identity LoRA at 0.80.
6. Grade: `identity_check.py` own-anchor cosine over the 12 outputs **and** a full-resolution
   operator pass. Module 11's rule stands — the checkpoint is chosen by eye on a fixed grid,
   the cosine only vetoes.

## Cost and time per stage

| Stage | GPU | readiness / job ceiling | `max_minutes` | preflight estimate | expected actual |
|---|---|---|---|---|---|
| train | L40S | 3600 s / 10800 s | 245 | **$3.63** | 45–60 min setup + unmeasured train |
| tester | L40S | 2400 s / 300 s × 12 | 105 | **$1.56** | ~15 min setup + ~5 min render |
| gen | L40S | 2400 s / 600 s × 12 | 165 | **$2.45** | ~15 min setup + ~20 min render |

All three are `--dry-run` green and network-free. Run each with `--max-usd` at roughly the
estimate. `governance/budget.yaml` caps the day at **$10.00** and `figment-2026-09-03.tsv`
already holds **$4.89**, so the training run cannot start today — it needs a fresh day, and
train + tester + gen ($7.64) will not fit in one day either.

## Deviations, and why

1. **One artifact, not twelve.** `minimum_runtime_minutes` reserves `job_timeout ×
   artifact_count`, so a 3-hour marker wait and a 12-checkpoint ladder cannot both fit under
   `DEFAULT_MAX_MINUTES` (840). The training run returns only the final LoRA; the ladder
   lives on the network volume. See the addendum in `HARNESS-CHANGES.md`.
2. **Tester is 12 jobs, not 12 graph branches.** The dry-run client returns exactly one image
   per job, so `expected_images > 1` can never be dry-run green. Twelve one-image jobs keep
   every variable except the checkpoint fixed, which is the whole point of §3g.
3. **Module 09's three `SaveImage` nodes collapse to one** (the FaceDetailer output), same
   one-image rule. Re-adding `image_base` and `image_upscaled` is two nodes plus
   `expected_images: 3`, once the harness honours the declared count in dry-run.
4. **No style LoRAs.** Their final stack adds `RealisticSnapshotKrea2` 1.5 and `pawg_krea2`
   0.65 — third-party assets, one of them explicitly adult-tier. Out of bounds (GUARDRAIL 3).
5. **`face_yolov8s.pt`, not `face_yolov8m.pt`**, and **no SAM**: the `m` weight is not in the
   Apache-2.0 repo, and `sam_model_opt` is optional, so the detailer runs bbox-only.
6. **Their fixed test prompt and their 12-branch graph are not reproduced** — licensed course
   content. Our ranking prompt holds the same variables fixed and is our own text.
7. **ComfyUI `v0.34.0`, not the repo's usual `v0.20.1`** — `comfy/ldm/krea2` did not exist yet.
8. **Start-script templates live in `runs/`** beside their manifests: the harness resolves
   `training.start_script_file` relative to the manifest directory and rejects `..`.

## What blocks a live run

1. **`network_volume_id`** is the literal `REPLACE-WITH-RUNPOD-NETWORK-VOLUME-ID` in the train
   and tester manifests. Without a volume the 12 checkpoints die with the pod and the tester
   has nothing to rank. This is a recurring RunPod charge — operator decision.
2. **Daily budget.** $4.89 of $10.00 is spent today; the training estimate is $3.63.
3. **torch/CUDA pin.** Upstream installs `torch==2.13.0+cu130`; our proven image is
   cuda 12.8.1. `reinstall_torch` is `"0"` (use the image's torch) and that combination is
   untested against ai-toolkit's requirements. One install-only probe pod settles it.
4. **State-dict key compatibility.** ai-toolkit derives Krea-2's MMDiT keys from
   `krea/Krea-2-Raw`'s `raw.safetensors`; the Comfy-Org bf16 repackage is assumed key-for-key
   identical and has not been checked. Cheap to check: read the safetensors header only.
5. **Third-party node input names** (`FaceDetailer`, `UltralyticsDetectorProvider`, `res_2s`)
   are transcribed from the package graph and are not validated by dry-run.
6. **Throughput on 48 GB is unmeasured.** Their 77 min was a 96 GB Blackwell. If the L40S runs
   past the 10800 s marker deadline the run fails closed with nothing to show; a 500-step
   smoke run at the same settings is the honest way to buy that number first.
