# SDXL LoRA training — trial-01 persona ("tr1al01woman")

Status: **installed, configured, dataset-validated. Training NOT started** (explicit
scope of this task — install + config + dry-run only, zero GPU spend).

Hardware: RTX 4070 Laptop, 8 GB VRAM (`nvidia-smi` reports 8188 MiB total), driver
595.79 / CUDA 13.2 capable. Another agent's ComfyUI process was observed holding
7081/8188 MiB during this work — confirmed live, not hypothetical: this GPU has near-zero
free VRAM most of the time, and any real training run needs exclusive access negotiated
first.

## 1. Trainer chosen: kohya-ss/sd-scripts

Cloned at `main` @ `37a1cbb` (2026-07-23), the current upstream `sdxl_train_network.py`
LoRA entry point. Chosen over `ostris/ai-toolkit` because sd-scripts is the trainer with
actual, current, verifiable low-VRAM SDXL machinery in its source — not just claims:

- Every lever in the brief (`cache_latents_to_disk`, `cache_text_encoder_outputs`,
  `network_train_unet_only`, `gradient_checkpointing`, `fp8_base`, `sdpa`, AdamW8bit
  via bundled `bitsandbytes`, adafactor via `pytorch-optimizer`) is a real, present
  argparse flag in this checkout (`library/args.py`, `train_network.py`) — verified by
  reading the source directly, not by trusting a README claim.
- `bitsandbytes` installed as a plain Windows wheel (`bitsandbytes==0.50.2`, from
  `sd-scripts/requirements.txt`) with **no fork or custom build needed** — this used to
  be a real Windows pain point for 8-bit optimizers and no longer is.
- ai-toolkit's current focus and best-documented low-VRAM path is Flux, not SDXL; its
  SDXL VRAM guidance is thinner and less battle-tested at the 8 GB floor than
  sd-scripts', which has years of community low-VRAM SDXL runs behind it.
- sd-scripts is CLI/config-driven (TOML + argparse), matching the "write a ready-to-run
  config" ask directly, with no GUI layer to install on top.

## 2. Install (self-contained, own venv, ComfyUI untouched)

```
C:\Users\danie\tools\lora-trainer\
  venv\                          Python 3.12.8, isolated site-packages
  sd-scripts\                    git clone of kohya-ss/sd-scripts (main @ 37a1cbb)
  configs\tr1al01woman_sdxl_lora.toml   training hyperparameters (below)
  accelerate_config.yaml         single-GPU bf16 accelerate config, self-contained
  scripts\prepare_dataset.py     regenerates dataset\ from the live lora-set\ every run
  scripts\validate_dataset.py    headless, CUDA-free config+dataset validator
  dataset\10_tr1al01woman\       hardlink staging dir (regenerated, not committed)
  output\                        LoRA checkpoints land here (empty — no run yet)
  logs\                          tensorboard logs + validation run logs
```

Nothing was installed to the system Python (`C:\Program Files\Python312`) or touched in
`C:\Users\danie\tools\ComfyUI\venv`. The ComfyUI venv was only ever read (`pip list`,
`torch.__version__`) to confirm the CUDA build to match, never written to.

Key installed versions (`venv\Scripts\python.exe -m pip list`):

| package | version | note |
|---|---|---|
| torch / torchvision | 2.11.0+cu128 / 0.26.0+cu128 | matches ComfyUI's proven build exactly |
| accelerate | 1.6.0 | pinned by sd-scripts requirements.txt |
| transformers | 4.54.1 | pinned |
| diffusers | 0.32.1 | pinned |
| bitsandbytes | 0.50.2 | native Windows wheel, 8-bit optimizer support |
| xformers | 0.0.35 | installed as fallback attention backend; `sdpa` is the default (see below) |
| safetensors | 0.4.5 | pinned |

Install had two transient `WinError 32` (file-in-use) failures on the first attempt of
each `pip install` — resolved on immediate retry, consistent with antivirus/Defender
scanning newly-written `.py`/`.dll` files under `AppData`/`site-packages` mid-install,
not a real conflict. Not GPU-related, not ComfyUI-related.

## 3. The 8 GB recipe — every lever and its trade-off

All flags below are live in `configs/tr1al01woman_sdxl_lora.toml`, confirmed present in
this sd-scripts checkout by reading `library/args.py` / `train_network.py` directly.

| lever | flag(s) | why it saves VRAM | trade-off |
|---|---|---|---|
| bf16 compute | `mixed_precision = "bf16"` | halves activation/gradient memory vs fp32 | none on Ada (4070 has native bf16 tensor cores); more stable than fp16, avoids the known SDXL-VAE fp16 NaN issue so `--no_half_vae` isn't needed |
| gradient checkpointing | `gradient_checkpointing = true` | recomputes activations in backward instead of storing them — the single biggest activation-memory cut | ~20–30% slower per step; mandatory at 8 GB, not optional |
| cache latents | `cache_latents = true`, `cache_latents_to_disk = true` | VAE encodes every image to latents **once**, then the VAE and raw images never sit in VRAM during the training loop | disables per-step image augmentation (`color_aug`/`random_crop`); fine for a small, already-curated 40-image set |
| cache text-encoder outputs | `cache_text_encoder_outputs = true` + `_to_disk` | caption embeddings computed once; both CLIP text encoders unload from VRAM after that one pass | only valid combined with `network_train_unet_only` (below); caption-level randomization is limited, but captions are already fixed-order (no `shuffle_caption`) |
| train UNet only | `network_train_unet_only = true` | skips gradients/optimizer state for ~900M combined text-encoder params, and is the precondition for caching text-encoder outputs at all | trigger-token association leans entirely on UNet cross-attention conditioning, not fine-tuned text embeddings — standard for character LoRAs |
| 8-bit optimizer | `optimizer_type = "AdamW8bit"` | cuts Adam's optimizer-state memory to ~1/4 of full-precision Adam | marginally noisier updates, imperceptible at LoRA scale; `adafactor` is the documented next-lower fallback (zero momentum buffer) if this still doesn't fit |
| batch size floor | `train_batch_size = 1`, `gradient_accumulation_steps = 1` | batch size is the largest single activation-memory knob | none needed here — a 40-image character LoRA doesn't need a large effective batch |
| reduced resolution + bucketing | `resolution = "768,768"`, `enable_bucket = true`, `bucket_no_upscale = true`, `min/max_bucket_reso = 512/1024` | 768² is ~56% the pixels of 1024², a quadratic activation-memory saving | somewhat softer fine detail (e.g. the mole marker `NOTES.md` calls out) than training at native 1024; 768 is the standard low-VRAM SDXL compromise |
| efficient attention | `sdpa = true` | PyTorch-native memory-efficient attention kernel | chosen over `xformers` (also installed) specifically because `sdpa` ships inside the already-matched torch 2.11.0+cu128 build and can't drift out of version-lockstep the way a separately-versioned xformers wheel can; `--xformers` is a documented one-flag fallback if `sdpa` underperforms |
| loader/caching batch size | `vae_batch_size = 1`, `max_data_loader_n_workers = 0` | keeps the one-time latent-caching pass and data loading light on host RAM/CPU copies | negligible cost; irrelevant to VRAM once caching finishes |
| loss stabilizer (not a VRAM lever) | `min_snr_gamma = 5.0` | free convergence-quality improvement, zero memory cost | none |

**Not enabled, kept in reserve as escalation if the above still OOMs:**
- `--fp8_base` — stores the frozen UNet's base weights in fp8 instead of bf16. This is
  the single most impactful remaining lever (see VRAM math below: base UNet weights
  dominate the budget), bigger than dropping resolution further. Not enabled by default
  because it costs more numeric stability than everything above and the recipe above
  should reach 8 GB on its own — but it's the first thing to flip on if a real run OOMs.
- `--full_bf16` — stores LoRA master weights in bf16 too (vs the default fp32 master
  copy). Small additional saving, slight additional risk to convergence precision.
- Dropping `resolution` to `512,512` — last-resort fallback, meaningfully softer output.

## 4. Config file

`C:\Users\danie\tools\lora-trainer\configs\tr1al01woman_sdxl_lora.toml` (full contents):

```toml
mixed_precision = "bf16"
save_precision = "fp16"
gradient_checkpointing = true
sdpa = true
cache_latents = true
cache_latents_to_disk = true
cache_text_encoder_outputs = true
cache_text_encoder_outputs_to_disk = true
network_train_unet_only = true
max_data_loader_n_workers = 0
persistent_data_loader_workers = false
vae_batch_size = 1

enable_bucket = true
resolution = "768,768"
min_bucket_reso = 512
max_bucket_reso = 1024
bucket_reso_steps = 64
bucket_no_upscale = true

train_batch_size = 1
gradient_accumulation_steps = 1
max_train_epochs = 7
seed = 42

network_module = "networks.lora"
network_dim = 32
network_alpha = 16

optimizer_type = "AdamW8bit"
learning_rate = 1e-4
lr_scheduler = "cosine"
lr_warmup_steps = 100

caption_extension = ".txt"
shuffle_caption = false
keep_tokens = 1
max_token_length = 225
clip_skip = 2

min_snr_gamma = 5.0

save_model_as = "safetensors"
save_every_n_epochs = 1
save_state = false

sample_every_n_steps = 0
log_with = "tensorboard"
```

Per-run paths (`pretrained_model_name_or_path`, `train_data_dir`, `output_dir`,
`output_name`, `logging_dir`) are **not** in this file — they're passed on the command
line, matching this sd-scripts checkout's own convention (see
`sd-scripts/tests/sdxl_inpainting_test_lora.toml`'s header comment). This keeps the
config reusable across runs/personas without editing it.

**Hyperparameter reasoning:**
- `network_dim=32` / `network_alpha=16` (alpha = dim/2, a standard ratio): enough
  capacity for one consistent character's face/hair/build across 12 wardrobe items and
  6 settings without the dim being so large it start absorbing background/lighting
  noise as "identity." A 40-image single-character set doesn't need dim 64+.
- `learning_rate=1e-4` with `cosine` schedule + 100-step warmup: the standard starting
  LR for SDXL UNet-only LoRA training; cosine decay avoids the abrupt end-of-training
  jump a constant LR gives on a short run.
- `max_train_epochs=7` × `num_repeats=10` × 40 images = **2800 steps** at batch 1. This
  sits in the commonly-cited 1500–3000-step sweet spot for a 30–50 image character LoRA
  — enough passes to converge without so many that a 40-image set starts overfitting.
- `save_every_n_epochs=1` (7 checkpoints total): cheap disk cost, gives real
  intermediate checkpoints to A/B for overfitting before committing to the final epoch.
- `keep_tokens=1` + `shuffle_caption=false`: captions are written
  `tr1al01woman, <everything else>` (see `lora-set/NOTES.md`) specifically so the
  trigger token anchors identity and the rest describes variables (pose, wardrobe,
  lighting) — keeping order fixed preserves that split instead of shuffling the trigger
  token out of its anchor position.

## 5. Dataset — read live at run time, not baked in

The dataset lives at
`C:\Users\danie\kb-worktrees\figment\personas\trial-01\lora-set\` (images) +
`...\lora-set\captions\` (matching `.txt`), and **is still being topped up by another
agent** — it grew from 30 to 40 images during this session, mid-task.

sd-scripts' DreamBooth-style loader expects each caption `.txt` to sit *next to* its
image inside a `<repeats>_<token>` folder — it has no native "separate caption
directory" option. To satisfy "read the directory at run time, don't bake in a file
list" against that constraint, `scripts/prepare_dataset.py`:
1. Re-scans `lora-set/` and `lora-set/captions/` fresh on every invocation (no cached
   file list anywhere).
2. Reports any image with no caption, any caption with no image, any empty caption
   file, and any caption missing the `tr1al01woman` trigger token.
3. Rebuilds `dataset/10_tr1al01woman/` from scratch and hardlinks (not copies — same
   NTFS volume, zero extra disk, always reflects current file content) each
   image+caption pair into it.

Run it immediately before every training invocation — it picks up whatever the other
agent has added since the last run automatically, no config edits required.

## 6. Validation performed (no GPU, no CUDA, no model load)

**First attempt — sd-scripts' own `--debug_dataset` flag hit a real upstream bug.**
Traced through `train_network.py`: `--debug_dataset` returns at line 981, *before*
`accelerator_setup.prepare_accelerator()` (line 1001) and `load_target_model()` (line
1009) — confirmed by reading the source, so it's genuinely GPU-safe by construction.
It printed the full correct dataset info (40 images, bucket assignment, captions) and
then crashed:
```
File "library\dataset.py", line 1413, in debug_dataset
    cond_img = example["conditioning_images"][j] if "conditioning_images" in example else example["masked_images"][j]
TypeError: 'NoneType' object is not subscriptable
```
This is a bug in this checkout's image-*preview* code (`"masked_images" in example` is
true but the value is `None` for a non-inpainting dataset) — unrelated to our config,
and that code path also calls Windows-blocking `cv2.imshow`/`cv2.waitKey()`, which isn't
appropriate for unattended validation anyway.

**Actual validation** — `scripts/validate_dataset.py` reuses the identical code path
sd-scripts' own trainer uses (`sdxl_train_network.setup_parser()` →
`args_util.read_config_from_file()` → `accelerator_setup.prepare_dataset_args()` →
`BlueprintGenerator`/`ConfigSanitizer` → `generate_dataset_group_by_blueprint()`) but
skips the buggy preview step, importing nothing from `torch.cuda` and never
constructing an `Accelerator`. Result, full run:

```
Dataset parsed OK. Total (image x repeats) count: 400

Dataset 0: target_resolution=(768, 768), batch_size=1, enable_bucket=True
  actual bucket(s) assigned: [(576, 832)]

Sample of parsed items (first 3 and last 3):
  total unique source images: 40
  - front_ambient_bust_BU02.png: size=(832, 1216), caption="tr1al01woman, facing camera, chest-up framing, wearing a burgundy knit sweater, standing o..."
  - front_ambient_bust_BU05.png: size=(832, 1216), caption="tr1al01woman, facing camera, seated with hands resting in lap, chest-up framing, wearing a..."
  - front_ambient_close_CU02.png: size=(832, 1216), caption="tr1al01woman, facing camera, close-up framing of face and shoulders, wearing a cream cable..."
  - threequarter_window_bust_BU07.png: size=(832, 1216), caption="tr1al01woman, head and shoulders turned about 45 degrees from camera, chest-up framing, we..."
  - threequarter_window_close_CU06.png: size=(832, 1216), caption="tr1al01woman, head turned sharply to the side in a strong three-quarter angle, one ear vis..."
  - threequarter_window_mid_MD11.png: size=(832, 1216), caption="tr1al01woman, head and shoulders turned about 45 degrees from camera, looking off to the s..."

OK: trigger token 'tr1al01woman' present in every parsed caption.

VALIDATION PASSED — config + dataset parse cleanly, no CUDA/model touched.
```

**Dataset problems found: none.** All 40 images have a matching non-empty caption, all
40 captions have a matching image, every caption contains the trigger token, and every
image shares the same native aspect ratio closely enough that sd-scripts' bucketing
collapsed them into a **single** bucket, `(576, 832)` — a mean aspect-ratio error of
0.0081 (dataset log: `mean ar error (without repeats): 0.0080971659919028`), i.e.
essentially no cropping/distortion from bucketing. `prepare_dataset.py`'s own
mismatch/trigger-token check also came back clean on the same 40 images.

`prepared_model_name_or_path` resolved to the existing ComfyUI checkpoint,
`RealVisXL_V5.0_fp16.safetensors` (6.94 GB on disk) — confirmed to exist, never opened
or loaded during any of this.

## 7. Estimate: wall-clock and peak VRAM

**Peak VRAM — reasoned estimate, not measured (no training run performed):**

- Frozen SDXL UNet (~2.6B params) resident in bf16: **~5.2 GB** just for weights. This
  dominates the budget — bigger than activations, optimizer state, or anything else.
- Activations for backward at 768×832, batch 1, with gradient checkpointing:
  roughly **0.5–1.5 GB** (checkpointing is specifically what keeps this small; without
  it this term alone would likely exceed the whole 8 GB budget at this resolution).
- LoRA trainable params (dim 32) + AdamW8bit optimizer state for them: **tens of MB**,
  effectively negligible next to the frozen UNet.
- CUDA/cuDNN context, kernel workspace, allocator fragmentation on Windows/WDDM:
  **~0.5–1 GB** typical overhead.
- VAE and both text encoders are **not** resident during the training loop at all
  (cached-then-unloaded) — they only touch VRAM briefly during the one-time caching
  pre-pass at the start of the run.

**Total: roughly 6.5–7.8 GB against an 8188 MiB (≈8.0 GB) card.** That is a real fit,
but a *tight* one with thin headroom — not a comfortable margin. Given this laptop's GPU
was independently observed holding 7081/8188 MiB from a concurrent ComfyUI process
during this session, "fits in 8 GB" here means *8 GB with nothing else running on it*,
not 8 GB shared with any other GPU workload.

**Honest verdict: marginal yes, with real OOM risk, not a confident yes.** If a real run
OOMs, the fix that preserves the most quality/speed is `--fp8_base` first (halves the
~5.2 GB frozen-UNet term to roughly ~2.6 GB, the single biggest lever left), before
falling back to `resolution=512,512`.

**Wall-clock — reasoned estimate, not measured:** 2800 total steps (7 epochs × 400
steps/epoch). Gradient checkpointing trades ~20–30% step-time for its memory savings, a
mobile 4070 is power/thermally capped well below its desktop namesake, and 8 GB leaves
no room for larger, faster batches. Comparable low-VRAM SDXL LoRA setups on 8 GB
mobile-class cards commonly land around 2.5–4.5 s/iteration at this resolution/config.
At that rate, 2800 steps ≈ **2–3.5 hours**, plus a one-time latent + text-encoder
caching pre-pass on 40 images that should take well under a minute.

*(These two numbers are the one part of this deliverable not backed by a measurement on
this machine — they're derived from the model's known parameter count, the mechanics of
each enabled lever, and this hardware's known compute class. Confirming them for real
requires an actual training run, which was explicitly out of scope for this task.)*

## 8. Exact command to launch training (NOT run — for the record only)

```bat
cd C:\Users\danie\tools\lora-trainer
venv\Scripts\python.exe scripts\prepare_dataset.py

set PYTHONIOENCODING=utf-8
venv\Scripts\accelerate.exe launch --config_file accelerate_config.yaml sd-scripts\sdxl_train_network.py ^
  --config_file configs\tr1al01woman_sdxl_lora.toml ^
  --pretrained_model_name_or_path "C:\Users\danie\tools\ComfyUI\models\checkpoints\RealVisXL_V5.0_fp16.safetensors" ^
  --train_data_dir "C:\Users\danie\tools\lora-trainer\dataset" ^
  --output_dir "C:\Users\danie\tools\lora-trainer\output" ^
  --output_name "tr1al01woman_v1" ^
  --logging_dir "C:\Users\danie\tools\lora-trainer\logs"
```

`PYTHONIOENCODING=utf-8` works around an unrelated Windows-console cp1252 crash in
`accelerate`'s own help/banner text (hit while sanity-checking `accelerate launch
--help`; cosmetic, not a training blocker, but cheap to set defensively).

Before running this for real: confirm the GPU is actually free (`nvidia-smi` — it was
NOT free for most of this session), and expect to need the `--fp8_base` escalation on
the first attempt if it OOMs.
