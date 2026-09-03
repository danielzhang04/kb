# r15b — 10sorLabs training modules: recovered settings (video + sibling artefacts)

Source: `orgs/figment/research/10sorlabs-package/{11_lora_training_krea,10_dataset_generator_v2,
04_generating_a_dataset,05_training_a_lora}/lesson.mp4` watched via claude-video-vision at the r14
chapter timecodes, plus the sibling workflow JSONs and `lora_trainer_extracted/` in the same
folders. Licensed content: notes and derived settings only — no transcript dumps, no prompt-library
reproduction; long prompt lists are described structurally with one short quoted clause only where
the exact wording is itself the artefact (a caption-instruction rule, an identity-lock clause).

**Method note:** whisper transcription crashed the video-vision MCP server twice on this machine
(CPU-only whisper-cli, no GPU backend, hung past the tool's connection timeout on the full-length
audio track; the server self-recovered each time after the stray process was killed). No spoken
audio was recovered as text. All settings below come from directly reading the on-screen UI at
1500–1600px and from the sibling JSON/txt files, which for a settings-panel lesson is strictly more
precise than a transcript would be (exact typed values vs. spoken approximations).

---

## Module 11 — `11_lora_training_krea` (12:44) — current training path, Ostris AI Toolkit + KREA2

**Procedure as taught:** open the Ostris AI Toolkit web UI (RunPod AI1 pod, port 3000), set HF token
and folder paths once in Settings, create a New Training Job against model `Krea 2 (raw)`, point it
at an already-uploaded dataset ("agata"), auto-caption the dataset with a local VLM, launch training,
then — the module's real payload — after training, upload every saved checkpoint to a private HF
repo, bulk-download all of them into ComfyUI's `loras/` folder via 10sorLabs' custom-model grabber,
and run a fixed-prompt test harness (`10sorlabs_dataset_tester.json`) across all checkpoints side by
side to pick the best one before using it to generate images.

**Settings table**

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Toolkit folder paths | output/datasets/models under `/app/ai-toolkit/` | 3:23 | UI |
| Model architecture | Krea 2 (raw), path `krea/Krea-2-Raw` (gated) | 3:33–3:41 | UI |
| Low VRAM | on; Layer Offloading off | 3:41 | UI |
| Quantize (transformer / text encoder) | qfloat8 (default) / qfloat8 (default) | 3:23 | UI |
| Target type / Linear rank | LoRA / **32** | 3:27 | UI |
| Save data type / Save every | BF16 / **every 250 steps** | 3:27 | UI |
| Max step saves to keep | 4 → bumped live to **15** (room for all 12 test checkpoints) | 3:45–3:51 | UI |
| Batch size / grad accum / steps | 1 / 1 / **3000** | 3:27–4:01 | UI |
| Optimizer / LR / weight decay | AdamW8Bit / **0.0001** / 0.0001 | 3:27–4:01 | UI |
| Timestep type / bias / loss | Sigmoid→**Linear** (on Krea2 select) / Balanced / MSE | 3:27–4:01 | UI |
| EMA / regularization toggles | all off (Use EMA, Unload TE, Cache Text Embeddings, Differential Output Preservation, Blank Prompt Preservation, Contrastive Guidance Loss) | 3:41 | UI |
| Dataset: caption dropout / ext / repeats | 0.05 / txt / 1 | 3:27 | UI |
| Resolution buckets | **512 / 768 / 1024** on; 256/1280/1328/1536/2048 off | 3:27–4:01 | UI |
| Captioner | **Qwen3-VL** (`Qwen/Qwen3-VL-8B-Instruct`), float8, max res 512, max new tokens 128, Low VRAM on | 2:28 | UI |
| Caption prompt (tool default) | "Caption this image as if you were going to try to generate it with an image generator. Be thorough... Do not say things like 'It appears that' or 'possibly'. Start out with things like 'A person on the beach'... No preamble." | 2:28 | UI |
| Resulting captions | full descriptive sentences (auto-generated), e.g. hair/pose/wardrobe described per image — **not** trigger-word-only | 2:51 | UI |
| Sample: every / sampler / guidance / steps | 250 / FlowMatch / 4 / 30 | 4:25 | UI |
| Sample width/height/seed | 1024 / 1024 / 42, Walk Seed on, **Disable Sampling on** for this demo run | 4:25 | UI |
| Training GPU | RunPod RTX PRO 6000 Blackwell Server Edition (96GB), AMD EPYC 9535 64-core, 1133GB RAM | 4:48 | UI |
| Checkpoint cadence produced | every 250 steps: 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750 + final = **12 checkpoints** | 6:10 (HF repo listing) | UI + JSON (`nikk_krea2_0000xxxxx.safetensors` in dataset_tester.json) |
| Checkpoint test harness | `10sorlabs_dataset_tester.json`: 12 parallel branches, one fixed fully-written test prompt, **seed 1595 fixed**, **steps 4, cfg 1, sampler res_2s, scheduler beta, denoise 1**, resolution **1448×2176** | n/a | JSON |
| Test-harness model stack | UNET `krea2_turbo_fp8_scaled.safetensors` + CLIP `qwen3vl_4b_fp8_scaled.safetensors` (krea2) + VAE `qwen_image_vae.safetensors` | n/a | JSON |
| Final generation LoRA stack (post-ranking) | Power Lora Loader (rgthree), 3 style LoRAs stacked: `RealisticSnapshotKrea2` 1.50, `pdxvg_krea2` 0.65, `MysticXXX_KREA2_v1` 0.90 (toggled off) on top of the trained identity LoRA; same KSampler recipe (steps 4/cfg 1/res_2s/beta/denoise 1), width 1448 height 2176 | 10:25–12:40 | UI (ComfyUI graph) |

**Maps onto our stack:** Ostris AI Toolkit's job form is a like-for-like match to our
diffusion-pipe training entry point (dataset path, rank, LR, steps, resolution buckets, save
cadence are the same concepts). KREA2 (Qwen-Image-based turbo model, UNET+CLIP+VAE trio) has no
direct counterpart — closest analogue in intent is our Z-Image Base / FLUX.2 klein 4B Base. The
**checkpoint-ranking harness** (12 parallel branches, one fixed prompt+seed, pick-the-best) is the
single most portable idea here and has no equivalent in our current pipeline. **Does not map:**
KREA2-specific node names (UNETLoader/qfloat8 quantization, `res_2s`/`beta` sampler-scheduler pair)
are turbo-model-specific and not meaningful against Wan 2.2 or our harness.

**Evidence honesty:** no audio recovered (see method note above); "Ostris AI Toolkit config" and
"captioning" chapters were fully recoverable from the visible form fields, so the r14 flag that
these numbers are "spoken only, unrecoverable" is now resolved. Not seen: the exact moment training
starts logging loss (frame density thinned after 8:11 by design, to conserve tokens, once the
checkpoint-ranking procedure was already confirmed via the HF repo + ComfyUI graph).

---

## Module 10 — `10_dataset_generator_v2` (6:20) — current dataset path, from 2 reference photos

**Procedure as taught:** load ComfyUI's "10sorlabs dataset generation" workflow, drop in exactly
**two** source photos (one face close-up, one body/outfit shot) each with a one-line hand-typed
description, run the workflow once; it produces a full multi-angle/multi-pose dataset by
identity-preserving *editing* of those two photos against fixed prompt templates, not by generating
from scratch.

**Settings table**

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Inputs required | 1 face reference photo + short prompt, 1 body reference photo + short prompt | 2:05–3:15 | UI |
| Face-branch model stack | UNET `flux-2-klein-9b-fp8.safetensors`, CLIP `qwen_3_8b_fp8mixed.safetensors` (lumina2), VAE `flux2-vae.safetensors`, ModelSamplingAuraFlow shift **3** | n/a | JSON |
| Face-branch style LoRAs | `bfs_head_v5_2511_merged...rank_16` **0.60**, `QWEN2512_Bigsloppytits_v1...000003000` **0.70** (body branch) | n/a | JSON |
| KSampler (edit pass) | seed fixed **1098688918602660**, steps **4**, cfg **1**, sampler **euler**, scheduler **beta**, denoise **0.23** (low = identity-preserving edit, not fresh gen) | n/a | JSON |
| Angle/pose prompt lists | 2× `CR Prompt List` nodes, **15 prompts each** (face-angle set, body-pose set); fixed template, base subject string prepended — structure only, not reproduced | n/a | JSON |
| Face isolation / upscale | FaceBoundingBox (padding 15) + FaceAnalysisModels (insightface, CPU) feeding an upscale pass, `zit_upscaler.safetensors`, ImageScaleBy 0.5 → ImageScaleToTotalPixels lanczos | n/a | JSON |
| Latent size | EmptyLatentImage **1024×1440**; ImageResizeKJv2 target **1680×1680** | n/a | JSON |
| Output | ~15 face-angle images + ~15 body-pose images = **~30-image raw dataset from 2 source photos** | 4:26–4:53 | UI (rendered grid) |

**Maps onto our stack:** this is the closest thing in the package to a **fan-out dataset generator**
— our anchor→dataset stage does something structurally similar (single anchor → variant set) but via
different tooling; the "2 photos in, ~30-image dataset out" ratio and the identity-lock prompt
pattern (a fixed angle/pose template with a low-denoise identity-preserving edit, not fresh
generation) is directly adoptable regardless of base model. **Does not map:** FLUX.2-klein-9B +
Qwen3-8B-lumina2 stack is KREA2-package-specific; our equivalent would substitute FLUX.2 klein 4B
Base or Z-Image Base at the same denoise/steps ratio.

**Evidence honesty:** no audio; the two prompt-list *contents* (structural angle/pose descriptions,
30 lines total) are licensed content and are summarized above rather than quoted.

---

## Module 04 — `04_generating_a_dataset` (5:11) — legacy dataset path, superseded by module 10

**Procedure as taught:** run a 40-shot fixed-angle ComfyUI workflow locally (not RunPod) against one
passport photo, producing 52 raw renders; cull/renumber to 40 with a `renamer.bat` helper script;
each image gets a **single-word** caption file. This is the older, cruder counterpart to module 10.

**Settings table**

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Prompt template | 40 fixed prompts (angle/framing/lighting/expression progression), each ending in an identity-lock clause ("do not alter facial features / skin tone / hair") — structure only, not reproduced | n/a | JSON (`10sorlabs_dataset_generator.json`) |
| Stage 1 (identity edit) | UNET `qwen_image_edit_2511_bf16.safetensors` + LoRA `Qwen-Image-Edit-2511-Lightning-4steps-V1.0` strength 1, CLIP `qwen_2.5_vl_7b_fp8_scaled.safetensors` (qwen_image), VAE `qwen_image_vae.safetensors`; KSampler steps **6**, cfg **1**, sampler euler, scheduler **simple**, denoise **0.28**, seed mode **increment** | n/a | JSON |
| Stage 2 (fresh render) | UNET `z_image_turbo_bf16.safetensors`, CLIP `qwen_3_4b.safetensors` (lumina2), VAE `ae.safetensors`, ModelSamplingAuraFlow shift 3; KSampler steps **6**, cfg **1**, sampler euler, scheduler **beta**, denoise **1**, seed mode **randomize** | n/a | JSON |
| Render resolution | EmptyLatentImage **768×768** | n/a | JSON |
| Raw output count | 52 PNGs (`ComfyUI_00001`–`00052`) | 4:00 | UI |
| Curation | culled/renumbered to **40** via `renamer.bat` (strips `ComfyUI_` prefix + leading zeros); text-read only, never executed | 4:06–4:26 | UI + `.bat` (text) |
| Final dataset artefact | `10sorlabs_lora_trainer.zip` → `LoRA Trainer/Dataset/{1..40}.png + {1..40}.txt` | 4:26–5:06 | UI + zip contents |
| Captions | **every caption is the single word "woman"** — no descriptive captioning at all | n/a | txt files (confirmed against `lora_trainer_extracted/`) |

**Maps onto our stack:** the two-stage identity-edit-then-render pattern (low-denoise edit pass
feeding a full-denoise render pass) reappears in module 10's newer workflow — module 04 is the
prototype of it. **Does not map / regressed:** single-word captioning is strictly worse than module
11's Qwen3-VL captioner and should not be adopted; it is included here only as the documented
baseline module 11 replaced.

**Evidence honesty:** no audio; the 40-prompt template contents are licensed and summarized rather
than quoted.

---

## Module 05 — `05_training_a_lora` (3:08) — legacy training path, superseded by module 11

**Procedure as taught:** same Ostris AI Toolkit UI as module 11, but a materially different, cheaper
recipe: Z-Image Turbo + a training adapter, half the rank, no checkpoint-ranking step, cheaper GPU.

**Settings table**

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Model architecture | **Z-image Turbo (w/ Training Adapter)**, path `Tongyi-MAI/Z-Image-Turbo`, adapter `ostris/zimage_turbo_training_adapter/...` | 1:48 | UI |
| Target type / Linear rank | LoRA / **16** (half of module 11's 32) | 1:55 | UI |
| Optimizer / LR / weight decay | AdamW8Bit / **0.00025** (2.5× module 11's) / 0.0001 | 2:01 | UI |
| Timestep type / bias | Weighted / Balanced | 1:48–2:01 | UI |
| Steps | **3000** (job form briefly showed 5000 mid-edit, final run confirmed 3000/3000 in the completed job log) | 2:08, 2:48 | UI |
| Resolution buckets | **512 only** — single-resolution training, no 768/1024 buckets | 2:08–2:15 | UI |
| Save every / max saves to keep | 250 / **4** (kept at default — NOT bumped, so older checkpoints get pruned) | 3:27 (m11 default) / job log | UI + log |
| Sample: sampler / guidance / steps | FlowMatch / **1** / **8** | 2:15 | UI |
| Sample prompts | 3 generic Ostris toolkit defaults ("photo of a man...", "a man holding a sign...", "a bulldog..."), not dataset-specific | 2:15 | UI |
| Training GPU | RunPod **NVIDIA A100 80GB PCIe** + AMD EPYC 7763 64-core (cheaper tier than module 11's Blackwell Pro 6000) | 2:28 | UI |
| Result | completed 3000/3000 steps at **1.20 iter/sec**, final loss **≈3.113e-01**; log shows old checkpoints (1500, 1750) actively pruned as newer ones save, leaving only the last 4 + final | 2:48 | UI (job console log) |
| Ranking step | **none** — the in-training sample grid (fashion/lifestyle shots) is the only quality signal; no dataset-tester harness in this legacy module | 2:35–2:42 | UI |

**Maps onto our stack:** this is a useful low-cost baseline recipe (rank 16, single resolution,
A100 tier, no ranking step) — a fallback config for quick iteration before committing to the
full multi-checkpoint-ranked run from module 11. **Does not map:** Z-Image Turbo + training-adapter
architecture is package-specific tooling with no direct analogue; the concept (a distilled turbo
base needing a separate small adapter to train against) is the transferable idea.

**Evidence honesty:** no audio; steps field showed "5000" mid-typing before settling at 3000 — flagged
as a possible operator typo/correction rather than a real value, resolved against the completed job's
"Step 3000 of 3000" log.

---

## What to adopt (10 lines)

1. **Checkpoint-ranking as a formal step** (module 11): train N checkpoints on a fixed cadence, run one fixed prompt+seed across all of them in parallel ComfyUI branches, pick the winner — directly portable to diffusion-pipe + our harness.
2. **Two-photo fan-out dataset generation** (module 10): one face photo + one body photo, low-denoise (~0.23) identity-preserving edit against fixed angle/pose templates, ~15x fan-out per photo.
3. **Full-sentence auto-captioning via a local VLM** (module 11, Qwen3-VL) over single-word captions (module 04) — captioning quality visibly regressed then recovered across their own package; adopt the descriptive-caption approach.
4. **Bump "max step saves to keep" to cover every checkpoint you intend to rank** before training starts (module 11 did this live, from 4 to 15) — an easy operational miss.
5. **Multi-resolution bucket training (512/768/1024)** for the primary recipe; reserve single-resolution (512-only) for cheap/fast baseline runs (module 05's pattern).
6. Their **identity-lock prompt clause** ("do not alter facial features/skin tone/hair") appended to every dataset-generation prompt is a cheap, adoptable guard against drift during fan-out.
7. **Rank/LR pairing observed**: rank 32 paired with LR 0.0001 (Krea2, multi-res, full run) vs rank 16 paired with LR 0.00025 (Z-Image Turbo, single-res, cheap run) — lower rank ran a proportionally higher LR.
8. The **turbo-model inference recipe** (steps 4, cfg 1, denoise 1, sampler/scheduler pair) recurs identically across their dataset generation, training samples, and final generation — a single reusable fast-inference preset worth codifying once per base model.
9. Do **not** adopt single-word captioning (module 04) — it is their own documented legacy mistake.
10. GPU tiering: they deliberately run cheap baseline experiments on A100 80GB and only pay for RTX PRO 6000 Blackwell (96GB) once a recipe is locked — worth mirroring as a cost gate.
