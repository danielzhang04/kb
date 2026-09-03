# r15 — 10sorLabs AI Suite: package artefacts (downloaded, audited, extracted)

Completes r14. Source: https://webpanel.10sorlabs.com/ (operator's account, his live Chrome, own tab,
read-only, closed at end). Downloaded 2026-09-03. Bulk lives in `orgs/figment/research/10sorlabs-package/`
(gitignored, 1029 MB, 168 files, `MANIFEST.tsv` carries module / label / source path / local file / bytes / sha256).

Licensed course content. **This file is notes and derived structure only.** No lesson video content is
transcribed, and none of the 38 prompt-library texts or the guides' example prompts are reproduced —
only structure, counts, and the numeric settings, where the number *is* the artefact.

Nothing downloaded was executed. No `.bat` was run, no `pip install`, no model weight fetched, no RunPod
template deployed, no Discord joined, no extension installed, no money spent, no account setting touched.

---

## 0. How the package is actually served (new, and it matters)

The panel is one page; `const MODULES = [...]` (19 entries) carries all metadata and is saved verbatim as
`10sorlabs-package/modules.json`. Both asset routes are **302 redirects into a public Cloudflare R2 bucket**:

| Panel route | Redirects to |
|---|---|
| `/video/<module-id>` | `https://pub-eca20e7f5f9d41e88108ad1935c6bc30.r2.dev/toolkit_v2/video_tutorials/<n>_compressed.mp4` (legacy modules 12–14: `/videos/<name>.mp4`) |
| `/prompt-assets/16_prompts/<n>.{png,txt}` | `…r2.dev/prompts/<n>.{png,txt}` |
| `/download/<module>/<n>` | served directly by the app, `Vary: Cookie` (session-gated) |

The webpanel routes require the session cookie; **the R2 bucket itself is open to the world with no auth**.
That is 10sorLabs' exposure, not ours, but it is why videos and prompt images could be fetched with plain
`curl` and no credentials once the object paths were known. Worth noting as a pattern to *not* copy if we
ever gate our own assets.

---

## 1. Inventory — what was fetched

Counts: **21 download-route artefacts** (19 distinct by sha256 — two files are served twice under
different modules), **15 lesson videos**, **38 prompt texts + 38 prompt images**, **2 archives extracted**,
**4 PDFs read**. Nothing on the panel was left unfetched.

### 1a. Download-route artefacts (21 routes → 19 distinct files)

| Module | Label | Route | Local file | Bytes |
|---|---|---|---|---|
| 03 | Model installer (.bat) | `/download/03_generating_your_character/0` | `03_generating_your_character/image_generation_models.bat` | 11 627 |
| 03 | Image generator workflow | `…/03…/1` | `03…/10sorlabs_image_generator.json` | 25 199 |
| 04 | Dataset workflow | `…/04_generating_a_dataset/0` | `04…/10sorlabs_dataset_generator.json` | 38 796 |
| 04 | Dataset model installer (.bat) | `…/04…/1` | `04…/dataset_models.bat` | 7 851 |
| 04 | LoRA trainer folder | `…/04…/2` | `04…/10sorlabs_lora_trainer.zip` | 9 176 |
| 06 | Image generation model installer (.bat) | `…/06_generating_images/0` | `06…/image_generation_models.bat` | 11 627 (**identical to 03/0**) |
| 06 | Image generation workflow | `…/06…/1` | `06…/10sorlabs_image_generator.json` | 25 199 (**identical to 03/1**) |
| 07 | Image edit model installer (.bat) | `…/07_editing_images/0` | `07…/image_edit_models.bat` | 6 263 |
| 07 | Image edit workflow | `…/07…/1` | `07…/10sorlabs_image_edit_workflow.json` | 29 632 |
| 08 | Motion control model installer (.bat) | `…/08_motion_control/0` | `08…/motion_control_models.bat` | 4 120 |
| 08 | Motion control workflow | `…/08…/1` | `08…/10sorlabs_motion_control.json` | 27 106 |
| 08 | Frame extractor (.bat) | `…/08…/2` | `08…/extract_first_frame.bat` | 608 |
| 09 | KREA2 generation model installer (.bat) | `…/09_krea2_image/0` | `09…/krea2_model_installer.bat` | 8 421 |
| 09 | KREA2 Image workflow | `…/09…/1` | `09…/10sorlabs_krea2_image.json` | 40 330 |
| 10 | KREA2 generation model installer (.bat) | `…/10_dataset_generator_v2/0` | `10…/dataset_generator_model_installer.bat` | 9 405 |
| 10 | Dataset generator 2.0 workflow | `…/10…/1` | `10…/10sorlabs_dataset_generator_v2.json` | 81 196 |
| 11 | KREA2 generation model installer (.bat) | `…/11_lora_training_krea/0` | `11…/dataset_generator_model_installer.bat` | 9 405 (**identical to 10/0**) |
| 11 | Dataset tester workflow | `…/11…/1` | `11…/10sorlabs_dataset_tester.json` | 106 775 |
| 13 | Image Toolkit | `…/13_generating_content/0` | `13…/imgtoolkit.zip` | 10 293 |
| 15 | Tiktok Growth SOP | `…/15_growth/0` | `15_growth/Tiktok Growth SOP.pdf` | 205 941 |
| 15 | Instagram Growth SOP | `…/15_growth/1` | `15_growth/Instagram Growth SOP.pdf` | 293 338 |
| 16 | Nano Banana Photorealistic Visuals | `…/16_prompts/0` | `16_prompts/A Practical Guide to Creating Photorealistic AI Visuals (1).docx.pdf` | 1 462 252 |
| 16 | Z-Image Turbo Prompt Guide | `…/16_prompts/1` | `16_prompts/HOW TO CRAFT GOOD PROMPTS FOR Z-IMAGE-TURBO (2).pdf` | 4 012 235 |

Correction to r14: the labels on modules 09/10/11 all read "KREA2 generation model installer", but
09 ships a **different** file (`krea2_model_installer.bat`) from 10/11 (`dataset_generator_model_installer.bat`).
r14's "7 distinct `.bat` labels" is right by label; by content there are **7 distinct `.bat` files across 9 copies**.

### 1b. Lesson videos (15 of 15, all MP4 files, no HLS/DASH — no `STREAMS.md` needed)

`<module-id>/lesson.mp4`, total 884 MB. Durations match the panel's stated durations.

| Module | Bytes | Module | Bytes |
|---|---|---|---|
| 00_welcome | 9 846 429 | 08_motion_control | 39 505 802 |
| 01_how_to_install_comfyui | 3 945 078 | 09_krea2_image | 150 069 571 |
| 02_comfy_basics | 176 470 049 | 10_dataset_generator_v2 | 90 724 112 |
| 03_generating_your_character | 27 163 735 | 11_lora_training_krea | 210 949 170 |
| 04_generating_a_dataset | 25 880 388 | 12_creating_your_model | 11 807 836 |
| 05_training_a_lora | 13 144 184 | 13_generating_content | 26 925 650 |
| 06_generating_images | 68 340 898 | 14_kling_motion_control | 27 047 191 |
| 07_editing_images | 45 704 677 | | |

**The videos are now on disk.** Every "spoken only, not recoverable" gap r14 flagged is now watchable —
module 02 @312s (KSampler settings), module 04 @247s (dataset prep), module 09 @252s (upscaler),
module 11 @203s (training config) and @130s (captioning). Most of those numbers turned out to be
recoverable from the artefacts instead (§3, §4), so watching is now confirmation, not discovery.

### 1c. Prompt grid (module 16)

38/38 texts (`16_prompts/prompt_grid/NN.txt`, 62 213 bytes total) and 38/38 images
(`NN.png`, 134 MB, 1024×1616 to 3072×4096). Not reproduced here; structure in §6c.

### 1d. Not fetched, and why

| Item | Why |
|---|---|
| `00_start` hidden bonus video ("The map is not the territory.") | Not served by the package — it is a YouTube embed, id `k0qmkQGqpM8`. Outside the "package's own files" grant, so not downloaded. |
| Any model weight named by a `.bat` | Out of scope and out of policy: `.bat` files were read as text only. Registry existence was verified (§2) without downloading. |
| Any RunPod template | Deploying costs money. |

---

## 2. `.bat` audit — 7 distinct files, read as text, never executed

**Headline: no `curl | bash`, no `npx`, no `pip install <package>` of anything but a cloned repo's own
`requirements.txt`, no obfuscation, no persistence, no registry writes, no scheduled tasks, no telemetry.**
All 46 URLs across all 7 files resolve (verified by range-GET against the live registries, 2026-09-03).
The risk is not the scripts — it is *what* they pull.

### 2a. Behaviour common to all installers

- Preflight `where curl` / `where git` / (in the newer two) `where powershell`, then abort with an error.
- Locate ComfyUI's Python (`venv\Scripts\python.exe`, `python_embeded\python.exe`, …), falling back to `python`.
- `curl -L --fail -o <dest> <url>` per weight file, into `ComfyUI\models\{unet,vae,text_encoders,loras,upscale_models,…}`.
- `git clone <repo>` per custom-node pack, then `"%PYTHON%" -m pip install -r <cloned repo>\requirements.txt`.
- The two newer ones (`krea2_model_installer.bat`, `dataset_generator_model_installer.bat`) additionally
  **download to `<dest>.part` and verify a pinned SHA-256** via `powershell Get-FileHash` before renaming —
  9 and 8 pinned hashes respectively. That is genuinely good hygiene and the older files lack it.
- `dataset_generator_model_installer.bat` prompts interactively for a Hugging Face token
  (`set /p "HF_TOKEN="`), uses it only as a `-H "Authorization: Bearer …"` header, and clears the variable
  (`set "HF_TOKEN="`) on both exit paths. It is never written to disk. **Under our GUARDRAIL #5 we still do
  not run it** — but the handling itself is not the failure mode I expected.

### 2b. Per-file verdict

| File (sha256 prefix) | Used by | URLs | Registry check | Verdict |
|---|---|---|---|---|
| `image_generation_models.bat` `0278525…` | 03, 06 | 12 | 12/12 exist | **verified, no SHA pinning** |
| `dataset_models.bat` `f70102b…` | 04 | 9 | 9/9 exist | **verified, no SHA pinning** |
| `image_edit_models.bat` `458d176…` | 07 | 8 | 7 exist + 1 gated (401) | **verified**; the 401 is `black-forest-labs/FLUX.2-klein-9b-fp8`, correctly gated, matching the lesson's "accept the licence" step |
| `motion_control_models.bat` `3e423bc…` | 08 | 9 | 9/9 exist | **verified, no SHA pinning** |
| `extract_first_frame.bat` `cadac32…` | 08 | 0 | n/a | **verified benign** — 39 lines, prompts for a video path and runs `ffmpeg -y -i "%VIDEO%" -frames:v 1 "%OUTPUT%"`. Nothing else. |
| `krea2_model_installer.bat` `4e47ee8…` | 09 | 14 | 14/14 exist | **verified + 9 SHA-256 pins** |
| `dataset_generator_model_installer.bat` `f46cdb5…` | 10, 11 | 15 | 15/15 exist | **verified + 8 SHA-256 pins**, HF token prompt handled cleanly |

### 2c. Where the weights actually come from — the real finding

| Host / owner | What it is | Flag |
|---|---|---|
| `Comfy-Org/*` (z_image_turbo, Krea-2, Wan_2.1_ComfyUI_repackaged, SCAIL-2, flux2-dev, flux2-klein-9B, sam3.1, Qwen-Image*, HunyuanVideo_1.5, vae-text-encorder-for-flux-klein-9b) | official ComfyUI org repackages | **verified — official** |
| `black-forest-labs/FLUX.2-klein-9b-fp8` | official BFL, `gated: auto` | **verified — official, gated** |
| `lightx2v/*` (Qwen-Image-Edit-2511-Lightning, Wan2.1-I2V StepDistill) | the lightx2v team; **the two named repos differ sharply**: `Qwen-Image-Edit-2511-Lightning` is 344k downloads / 520 likes, but the module-08 repo actually pulled, `Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v`, is 0 downloads / 135 likes | **verified — established (Lightning repo); lighter signal on the I2V repo** |
| `Bingsu/adetailer`, `datasets/Gourieff/ReActor` | long-standing community detector/SAM mirrors | **verified — established**, but see pickle note below |
| `Alissonerdx/BFS-Best-Face-Swap` | 118k downloads, 826 likes | **verified — established community** |
| `Phr00t/Qwen-Image-Edit-Rapid-AIO` (`Qwen-Rapid-AIO-NSFW-v23`) | 2 448 likes, community NSFW merge | **verified — established community, unaudited merge** |
| **`gravedigga/loras`** — 8 files installed by the package: `realistic_snapshot_lora`, `RealisticSnapshotKrea2`, `MysticXXX_KREA2_v3`, `pawg_krea2`, `zit_upscaler`, `4xNMKDSuperscale_4xNMKDSuperscale.pt`, `QWEN2512_Bigsloppytits_v1_copy_000003000`, `bfs_head_v5_2511_merged_version_rank_16_fp16` | anonymous personal account, created 2026-06-22 (days before the toolkit's 2026-06-30 asset stamp), **0 downloads, 0 likes**, no model card. **The account actually hosts 30 files, not 8** — the other ~22 are more unaudited NSFW-adjacent LoRAs/mixes never named in this doc, and one of them is an unused, ungated copy of BFL's officially-gated `flux-2-klein-9b-fp8.safetensors` (no installer references it — the `.bat` files correctly pull that weight from the real `black-forest-labs` repo). | **SUSPICIOUS-BY-PROVENANCE.** Almost certainly 10sorLabs' own vendor bucket, but it is an unaudited single-owner account with zero community signal carrying the LoRAs that do the actual work in modules 03/09/10 — and a materially larger stash than this table lists. |
| GitHub custom-node packs: `rgthree/rgthree-comfy`, `ltdrdata/ComfyUI-Impact-Pack` + `-Subpack`, `ClownsharkBatwing/RES4LYF`, `kijai/ComfyUI-KJNodes`, `Suzie1/ComfyUI_Comfyroll_CustomNodes`, `cubiq/ComfyUI_FaceAnalysis`, `chflame163/ComfyUI_LayerStyle`, `yolain/ComfyUI-Easy-Use`, `Kosinkadink/ComfyUI-VideoHelperSuite`, `numz/ComfyUI-SeedVR2_VideoUpscaler`, `PozzettiAndrea/ComfyUI-SAM3` | all well-known ComfyUI ecosystem repos, cloned from `main` with **no pinned commit** | **verified — official upstream**, but unpinned: a clone today is not the clone the lesson was recorded against |

Two more repos appear **only inside a workflow's MarkdownNote**, not in any `.bat`, so they escape the
installer's SHA pinning entirely:

| URL | Repo signal | Flag |
|---|---|---|
| `Kiro930/flux-2-klein-9b` → `flux-2-klein-9b.safetensors` | 2 likes, 0 downloads, created 2026-02-03 | **SUSPICIOUS.** This is an **ungated re-upload of a model Black Forest Labs gates**. The module-07 workflow's own note points here, routing the user around the licence acceptance the module-07 *lesson* tells them to do. Licence-bypass mirror; do not use. |
| `zw2013/kleinbreasts` → `breast_slider_9b_klein_…safetensors` | 0 likes, 0 downloads, created 2026-06-07 | **SUSPICIOUS-BY-PROVENANCE** — anonymous, no card, no signal. Loaded at strength **2.0** by the module-07 workflow. |

### 2d. Security notes that carry to us

1. **Pickle files.** `face_yolov8m.pt`, `sam_vit_b_01ec64.pth` and `4xNMKDSuperscale_4xNMKDSuperscale.pt`
   are `.pt`/`.pth` — Python pickle, i.e. **arbitrary code execution on load**, unlike `.safetensors`.
   Three of those come from established repos; the NMKD upscaler comes from `gravedigga/loras`, a
   zero-signal account. If we ever adopt an upscaler, take NMKD from its own upstream, not from a mirror.
2. **Unpinned `git clone` + `pip install -r requirements.txt`** is the eromify-mcp shape at one remove:
   the script is clean, but it executes whatever `main` says today in eleven third-party repos.
   Any adoption pins a commit.
3. **No SHA pinning on the four older installers** (03/06, 04, 07, 08) — a mirror swap is undetectable there.
4. The 10sorLabs product links carry the vendor's **RunPod referral code** (`ref=xpje72wd`) on every
   template and signup URL. Following them earns them money and costs us; noted, not followed.

---

## 3. Workflow settings — the numbers r14 could not recover

All 8 workflow JSONs are ComfyUI **UI-format** graphs. Widget orders were resolved against the node
definitions in RES4LYF (`beta/samplers.py`, `beta/samplers_extensions.py`) and ComfyUI-Impact-Pack
(`modules/impact/impact_pack.py`), so the labels below are the node schemas' own, not guesses.

### 3a. Module 03 / 06 — image generator (identical file, "character passport" + generic gen)

20 nodes. Base **Z-Image Turbo**.

| Slot | Value |
|---|---|
| unet | `z_image_turbo_bf16.safetensors` |
| clip | `qwen_3_4b.safetensors` · vae `ae.safetensors` |
| latent | `EmptyFlux2LatentImage` **1536 × 2048** (3:4 vertical), batch 1 |
| sampler | `ClownsharKSampler_Beta` (RES4LYF): **eta 0.45 · sampler `exponential/res_8s` · scheduler `simple` · steps 8 · steps_to_run −1 · denoise 0.95 · cfg 1.0 · seed 148 (increment) · mode `standard` · bongmath on** |
| LoRA | `Power Lora Loader (rgthree)`: `realistic_snapshot_lora.safetensors` **@ 0.66** (on); `AssSlider.safetensors` @ 1.6 (off) |
| detail pass 1 | `FaceDetailer`: guide_size 1024 · guide_size_for false · max_size 1024 · **steps 8 · cfg 1.0 · dpmpp_2m / simple · denoise 0.40 · feather 5 · noise_mask on** |
| upscale | `ImageUpscaleWithModel` ← `UpscaleModelLoader` `zit_upscaler.safetensors` |
| detail pass 2 | `FaceDetailer`: same shape, **denoise 0.27 · feather 7** |
| detectors | `UltralyticsDetectorProvider` `bbox/face_yolov8m.pt` + `SAMLoader` `sam_vit_b_01ec64.pth` (Prefer GPU) |
| review | `Image Comparer (rgthree)`, 3 × `SaveImage`, `Fast Groups Bypasser` |

**The shape to steal: detail → upscale → detail again, with the second pass at a lower denoise (0.40 → 0.27).**
That is a two-stage face repair around the upscaler, not one detailer bolted on the end. Note `cfg 1.0`
everywhere — every workflow in this package is a distilled/turbo model running CFG 1.

### 3b. Module 04 — dataset generator v1 (legacy path)

24 nodes. Two models in one graph: Z-Image Turbo makes the base, Qwen-Image-Edit re-poses it.

| Slot | Value |
|---|---|
| unets | `z_image_turbo_bf16.safetensors` · `qwen_image_edit_2511_bf16.safetensors` |
| clips | `qwen_3_4b.safetensors` · `qwen_2.5_vl_7b_fp8_scaled.safetensors` |
| vaes | `ae.safetensors` · `qwen_image_vae.safetensors` |
| LoRA | `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` **@ 1.0** (model-only) |
| shift | `ModelSamplingAuraFlow` **3.0** |
| edit sampler | `KSampler` seed 1471 (increment) · **steps 6 · cfg 1.0 · euler / simple · denoise 0.28** |
| base sampler | `KSampler` random seed · **steps 6 · cfg 1.0 · euler / beta · denoise 1.0** |
| latent | `EmptyLatentImage` **768 × 768** |
| prompt driver | `CR Prompt List` — a numbered list of fixed angle instructions, each ending "Do not alter facial features, skin tone, eye color, hair color, or hair texture" |

**The identity-grid pattern**: one prompt per camera angle (frontal → left profile → right profile → …),
each on a seamless white background, each with an explicit *do-not-alter* clause on the identity
attributes. That "negative constraint inside a positive prompt" is directly reusable for our expansion stage.

### 3c. Module 07 — image edit (Flux2Edit)

32 nodes. Base **FLUX.2 klein 9B**.

| Slot | Value |
|---|---|
| unet | `flux-2-klein-9b.safetensors` (**note: the .bat installs the official gated `…-fp8`; the workflow's note points at the ungated `Kiro930` mirror — §2c**) |
| clip | `qwen_3_8b_fp8mixed.safetensors` · vae `flux2-vae.safetensors` |
| LoRA | `breast_slider_9b_klein_20260118_210913.safetensors` **@ 2.0** (anonymous repo, §2c) |
| noise/guider | `RandomNoise` · `CFGGuider` **cfg 1.0** · `KSamplerSelect` **euler_ancestral** |
| scheduler | `Flux2Scheduler` **steps 4**, 1024 × 1024 |
| latent | `EmptyFlux2LatentImage` **1024 × 1024**; input scaled to long edge **1536** (`easy int`) |
| structure | **4 × `ReferenceLatent`** — the edit is conditioned on multiple reference latents at once, which is how identity survives the edit |
| operator instructions (verbatim, they are one-line templates) | *"The character in Figure 1 is wearing the clothes in Figure 2. Maintain realistic details."* and a `head_swap` block: *"Use image 1 as the base image, preserving its environment, background, camera perspective, framing, exposure, contrast, and lighting. Remove the head from image 1 and seamlessly replace it with the head from image 2. Match the original head size, face-to-body ratio, neck thickness, shoulder alignment, and camera distance so proportions remain natural and unchanged."* |
| in-workflow procedure note | upload image → optional reference image → describe changes in the green prompt window → **do not touch the negative prompt** → generate |

**4 steps at cfg 1.0 with euler_ancestral** is the entire edit budget. This is cheap enough to run as a
repair pass rather than a regeneration, which is the economics argument r14 made abstractly.

### 3d. Module 08 — motion control (I2V)

28 nodes. Base **Wan 2.1 14B SCAIL-2**.

| Slot | Value |
|---|---|
| unet | `wan2.1_14B_SCAIL_2_fp8_scaled.safetensors` |
| clip | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` · clip-vision `clip_vision_h.safetensors` · vae `wan_2.1_vae.safetensors` |
| checkpoint | `sam3.1_multiplex_fp16.safetensors` (SAM 3.1, for subject tracking) |
| LoRA | `Wan21_I2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors` **@ 1.0** — this is what makes 6 steps at cfg 1.0 viable |
| sampler | `KSampler` seed 123 (**fixed**) · **steps 6 · cfg 1.0 · euler / simple · denoise 1.0** |
| shift | `ModelSamplingSD3` **5.0** |
| tracking | 2 × `SAM3_VideoTrack` **threshold 0.5**, → `SCAIL2ColoredMask` |
| video io | `VHS_LoadVideo` (driver clip) → `WanSCAILToVideo` → `VHS_VideoCombine` |
| in-workflow procedure note | upload the drive video (the movement to copy) → upload the image to transfer motion onto → **write a simple and concise prompt** → leave the negative prompt as is → generate |

The mask/track pair is the mechanism r14 could only infer: the driving clip is **segmented per-frame by
SAM 3.1**, coloured into a control mask, and that mask (not the raw video) drives the generation.

### 3e. Module 09 — KREA2 image (the current image path)

56 nodes (20 `GetNode` / 11 `SetNode` — heavily wire-routed). Base **Krea-2 turbo**.

| Slot | Value |
|---|---|
| unet | `krea2_turbo_fp8_scaled.safetensors` · clip `qwen3vl_4b_fp8_scaled.safetensors` · vae `qwen_image_vae.safetensors` |
| latent | `EmptyLatentImage` **1448 × 2176** (2:3 vertical) |
| base sampler | `KSampler` seed 1594 (increment) · **steps 4 · cfg 1.0 · `res_2s` / beta · denoise 1.0** |
| refine sampler | `KSampler` seed 40 (fixed) · **steps 4 · cfg 1.0 · euler_ancestral / simple · denoise 0.35** (runs on the re-encoded, upscaled image) |
| LoRA stack | `RealisticSnapshotKrea2.safetensors` **@ 1.5** (on) · `pawg_krea2.safetensors` **@ 0.65** (on) · `MysticXXX_KREA2_v1.safetensors` @ 0.9 (off) |
| upscaler | `4xNMKDSuperscale_4xNMKDSuperscale.pt` then `ImageScaleBy` |
| face pass | `FaceDetailer`: guide_size 512 · guide_size_for true · max_size 1024 · **steps 4 · cfg 1.0 · euler / normal · denoise 0.15** · feather 5 · force_inpaint on · bbox_threshold 0.40 · bbox_dilation 10 · **bbox_crop_factor 3** · sam hint `center-1` · sam_threshold 0.80 · drop_size 10 · cycle 1 · noise_mask_feather 100 |

**This is the answer to r14's "upscaler explained" gap**: base 4-step render → upscale ×4 with NMKD →
`ImageScaleBy` back down → VAE re-encode → **second 4-step sampler at denoise 0.35** → FaceDetailer at
denoise 0.15. The upscaler is not a final filter, it is a mid-chain resolution bump that a second
low-denoise sampler then re-renders detail into. Compare our stage 5.

Also note the **stacked-LoRA discipline r14 flagged from module 02 @821s**: identity LoRA above 1.0
(1.5), body/style LoRA well below (0.65). Not equal weights.

### 3f. Module 10 — dataset generator 2.0 (the current dataset path)

70 nodes, two mirrored branches. Base **FLUX.2 klein 9B fp8** + a **Qwen-Image-Edit-Rapid-AIO-NSFW** checkpoint.

| Slot | Value |
|---|---|
| unet | `flux-2-klein-9b-fp8.safetensors` · checkpoint `Qwen-Rapid-AIO-NSFW-v23.safetensors` |
| clip | `qwen_3_8b_fp8mixed.safetensors` · vae `flux2-vae.safetensors` |
| LoRAs | `bfs_head_v5_2511_merged_version_rank_16_fp16.safetensors` **@ 0.6** · `QWEN2512_Bigsloppytits_v1_copy_000003000.safetensors` **@ 0.7** |
| shift | `ModelSamplingAuraFlow` **3.1** and **3.0** |
| gen samplers | 2 × `ClownsharKSampler_Beta`: **eta 0.31 / 0.30 · sampler `linear/euler` · scheduler `beta57` · steps 4 · denoise 1.0 · cfg 1.0 · fixed seed · mode standard · bongmath on** |
| edit samplers | 2 × `KSampler`: **steps 4 · cfg 1.0 · euler / beta · denoise 0.23** |
| **detail boost** | 2 × `ClownOptions_DetailBoost_Beta`: **weight 1.0 · method `model` · mode `hard` · eta 0.5 · start_step 4 end_step 10**, and a second at **start_step 2 end_step 4** |
| latents | `EmptyLatentImage` **1024 × 1440** (×2) |
| resize | `ImageResizeKJv2` **1680 × 1680** nearest-exact, pad `0,0,0`, center, divisible-by 2 · `ImageScaleToTotalPixels` lanczos 1.0 MP · `ImageScaleBy` lanczos 0.5 |
| face | `FaceAnalysisModels` **insightface / CPU** + `FaceBoundingBox` padding 15 — an automated face crop for the dataset |
| upscaler | `zit_upscaler.safetensors` (×2) |
| prompt drivers | 2 × `CR Prompt List`: one face-angle list (frontal → three-quarter → profile L/R → over-shoulder → low angle → high angle → Rembrandt …, all "against a plain white wall"), one body/wardrobe list |

Two findings here that matter more than the numbers:

1. **`ClownOptions_DetailBoost_Beta` weight 1.0 IS the "skin enhancer" the MANDATE refers to.** The node's
   own tooltip: positive weight makes "a sharper, grittier, more detailed image"; negative softens. It is
   applied over a *step window* (4→10 and 2→4), not the whole schedule. So the operator's confirmation that
   the pass **adds** detail is correct, and it is a sampler-schedule option, not a post filter. That makes it
   directly portable to our stage 5, and it is orthogonal to a de-gloss step.
2. **This workflow contains a clothing-removal branch.** Two `TextEncodeQwenImageEditPlus` nodes carry the
   literal instruction *"Remove the clothes of the woman in the image. She is fully naked"*, feeding the
   NSFW AIO checkpoint. Recorded because it is what the artefact is; **this branch is out of bounds for
   agents under GUARDRAIL #3** (explicit-tier generation is the operator's). If we ever port module 10, we
   port the angle-list + FaceBoundingBox + DetailBoost half and leave that branch behind.
   Separately, the workflow's own prompt strings say *"youthful young woman"* — under GUARDRAIL #2 that
   phrasing is a defect, not a style, and does not come across.

### 3g. Module 11 — dataset tester (the checkpoint-ranking harness)

111 nodes, and the structure is the whole point: **12 fully parallel branches**, each with its own
`UNETLoader` + `CLIPLoader` + `VAELoader` + `LoraLoader` + `CLIPTextEncode` + `EmptyLatentImage` +
`KSampler` + `VAEDecode`, all joined by one `BatchImagesNode` into a single `PreviewImage`.

| Slot | Value |
|---|---|
| base | `krea2_turbo_fp8_scaled.safetensors` / `qwen3vl_4b_fp8_scaled.safetensors` / `qwen_image_vae.safetensors`, repeated 12× |
| LoRAs under test | `nikk_krea2_000000250` … `000002750` in **250-step increments (11 checkpoints)** plus the final `nikk_krea2.safetensors` |
| LoRA strength | **1.0 model / 1.0 clip** on every branch |
| sampler | identical on all 12: seed **1595 fixed** · **steps 4 · cfg 1.0 · `res_2s` / beta · denoise 1.0** |
| latent | `EmptyLatentImage` **1448 × 2176** on all 12 |
| prompt | one `PrimitiveStringMultiline`, the same string wired to all 12 |

So the ranking protocol is: **fixed seed, fixed prompt, fixed sampler, fixed resolution — the LoRA
checkpoint is the only free variable — render all 12 at once and eye-pick the winner.** The training run
therefore saves a checkpoint every 250 steps and runs to roughly 2 750–3 000 steps.

That is a clean, cheap, directly adoptable design for our identity-grid gate, and it is the single
strongest thing in the package.

---

## 4. Trainer config — `10sorlabs_lora_trainer.zip` (module 04)

The archive is 9 176 bytes and contains **no trainer config at all**. Contents:

```
LoRA Trainer/
  Dataset/1.txt … 40.txt      (40 files, 5 bytes each)
  renamer.bat                 (592 bytes)
```

- **All 40 caption files contain the single word `woman`.** Nothing else. That is the package's
  captioning doctrine, and it resolves r14's module-11 @130s gap: **class-token-only captioning, one
  generic noun, no per-image descriptions, no trigger word in the caption files.**
- **Dataset size is 40 images.** The folder is pre-built for exactly 40.
- `renamer.bat` renames ComfyUI's `ComfyUI_00001_.png` outputs to `1.png … 40.png` by stripping the
  8-character prefix and the trailing underscore and dropping leading zeros, skipping collisions. It runs
  `ren` only — no network, no deletion. Benign; read, not run.
- **No rank, learning rate, step count, batch size, resolution, or optimiser appears anywhere in the
  archive.** Module 11 teaches training inside **Ostris AI Toolkit's** own web UI (chapter @203s
  "Training configuration"), so those values are entered in that UI on the pod and never leave the video.

What *is* recoverable without watching: **checkpoint cadence 250 steps** and **total ≈2 750–3 000 steps**,
inferred from the 11 numbered checkpoints in the module-11 tester (§3g), plus **dataset = 40 images,
caption = `woman`**. Rank / LR / batch / resolution remain video-only — `11_lora_training_krea/lesson.mp4`
@203s–290s is on disk if the build terminal needs them.

### 4b. `imgtoolkit.zip` (module 13) — a small Flask app, read not run

`app.py` (6 011 B), `templates/index.html` (18 119 B), `requirements.txt` (`flask>=3.0.0`, `pillow>=10.0.0`,
`pyinstaller>=6.0.0`), a PyInstaller spec, and a Dutch build README. Two endpoints:

- **`/api/chopper`** — the 2×2 grid slicer from module 13. Pillow, `img.crop` at exact halves, writes
  `A1/A2/B1/B2` PNGs. Trivially re-implementable; no need to run their binary.
- **`/api/adjust`** — undocumented in the panel, and the more interesting one. An ffmpeg filter chain that
  **degrades a video to look phone-shot**:
  `fps=22, scale=720:-2, scale=1280:-2, noise=alls=12:allf=t+u, unsharp=5:5:-1.5:5:5:-1.5,
  eq=saturation=0.65:contrast=1.15:brightness=-0.05:gamma_r=1.05:gamma_b=0.95, format=rgb24,
  lut=(20-level posterise on r,g,b), format=yuv420p, vignette=PI/4`
  at `-b:v 1800k -maxrate 1800k -bufsize 1000k -c:v libx264 -preset ultrafast -crf 4 -c:a aac -b:a 64k -ar 22050`.
  Round-trip downscale to 720 and back to 1280, additive temporal+uniform noise, *negative* unsharp
  (i.e. blur), desaturation, banding via a 20-step LUT, vignette, and a deliberately low bitrate.
  This is a **de-AI-ification pass for video** — the moving-image counterpart of our de-gloss step, and the
  package's only anti-detection tooling. Worth reproducing natively; it is 12 filters, no dependency on
  their exe.
  The app shells out with `subprocess.run(cmd, …)` on a **list argv, no `shell=True`** — no injection
  surface. Uploads are saved under a uuid prefix and deleted in `finally`. Benign, but we would
  re-implement rather than run a third-party Flask server.

---

## 5. Module 15 — the two Growth SOPs, as derived rules

Both PDFs are internal VA (virtual assistant) operating manuals, headed "By 10sor.ai". Summarised as
rules, not copied. **Read the compliance verdict at the end of each before treating any of this as a plan.**

### 5a. TikTok Growth SOP (7 pages)

*Account model.* 3 accounts per phone, one niche per account, niche chosen up front (their examples: goth,
gym, golf). An account is "successful" once it gets views. Device is factory-reset before use, region set
to the target country (UK/US), a fresh Apple ID and a fresh Gmail per account, location services off,
apps installed in a fixed order (Gmail → Telegram → TikTok). Real 18+ date of birth. Keep TikTok's suggested
username. Profile picture must never have been used on TikTok before — reuse is called the top shadowban trigger.

*Shadowban test.* Let a new account sit **24 hours** before posting. Then post **4 videos at 5-minute
intervals** and check view counts after **1 hour**. Views → account is live; no views → treat as
shadowbanned, delete, reset, start over.

*Cadence.* On a working account: **5 posts/day, 5–10 minutes apart**, round-robin across the 3 accounts
(post to 1, 2, 3, back to 1…). The full daily cycle is stated as 2–3 hours of work.

*Formats that they claim perform.* Hook captions matched to the niche; outfit-transition videos
(ordinary → niche look); adapting trending formats and jumping viral challenges early; "wait for it"
teasers with cliffhanger endings and "part 2 on my IG" CTAs. Trending sounds are treated as the main
reach lever.

*Captions.* Niche-specific hook captions from a shared Airtable, plus generic engagement bait:
"comment if you agree", "which one, 1 or 2?", "I'll do it if this gets 1000 likes", "should I post more
like this?".

*Funnel.* TikTok is cold traffic only. Video → profile visit → bio hint → Instagram. The bio never says
"OnlyFans"; the only sanctioned pattern is a subtle CTA with the IG handle in the link field and curiosity
doing the work. Bio examples are casual and non-promotional ("come say hi :)", "my ig is better").

*Stated risk rules.* Never post explicit/nude; never use banned keywords (OF, OnlyFans, Fansly); no
external links in the first 48 h; no mass follow/unfollow; no sharing a device between accounts without a reset.
On age-restriction: don't delete, appeal if wrong, soften the next posts, change thumbnails, lean on
trending sounds.

*Metrics.* Views per video (**target 500+ in the first hour**), profile visits, IG link clicks, follower
growth, engagement rate.

**Compliance verdict.** Three things in this document are not adoptable and are recorded as rejected:
(a) the multi-account farm and the delete-and-recreate-on-shadowban loop are platform ban evasion;
(b) the device factory-reset / fresh-Apple-ID churn exists to defeat device fingerprinting;
(c) one of the four named content types is built around making the model "look cute and innocent" for a
"gooner/teen" audience — **that is a direct violation of GUARDRAIL #2 (unambiguously adult) and is
disqualifying on its own**. What survives for us: the cadence numbers, the 1-hour/500-view early signal,
the hook/teaser caption grammar, the two-hop funnel shape, and the keyword-avoidance list.

### 5b. Instagram Growth SOP (13 pages)

*Non-negotiables they state.* Mobile data only, never Wi-Fi (one exception: a single Wi-Fi session on a
factory-reset phone to download Instagram/Gmail/Drive/Telegram, then forget the network — Instagram must
not be opened during it). IP reset = airplane mode on for **3 minutes**. Max **3 accounts per device**.
iPhone 12+ preferred (X the floor). A second phone acts purely as a hotspot for day-1 IP control. New
US-region Apple ID per device; SMS verification via a disposable-number service.

*Warm-up schedule.*
- **Day 1** — create Gmail, create IG from it, change the username immediately to a simple natural handle,
  follow 5–10 approved creators slowly, scroll Reels 5–10 min training the algorithm (like US female
  creators in-niche, "Not interested" on everything else), follow 10 US male accounts from comment
  sections with **30-second gaps**, log out, airplane-mode reset, next account.
- **Day 2** — repeat, and add the bio and profile picture.
- **Days 3–6** — SIM active, mobile data only. Per day: **1 clean aesthetic feed photo**, repost it to
  Story (no links, no CTA), 5–10 min Reels training, follow 5–10 US male accounts and unfollow yesterday's
  batch, 3–5 minutes of light browsing. **Day 3 only**: switch to a Professional / Digital Creator account
  and enable Upload at Highest Quality.
- **Day 7 — activation.** Posting order: repost feed → Story, then feed post; **first Reel** (clean, no
  heavy CTA); repost the Reel → Story; a personal Story with no CTA; a soft-CTA Story that is **image only,
  no link**. Build three Highlights (Faves / Personal / CTA) and only now add the approved bio link. No
  arrow emoji, no spam.
- **Day 8+** — same order, plus **2 trial reels** once available. They rate Instagram's Trial Reels as the
  single biggest reach lever and say it usually unlocks after 1–2 weeks of posting.

*Hashtags.* Five, fixed, generic, on the Reel only: `#explore #reels #usa #flash #blonde`. No per-post
hashtag research at all — the hashtag set is a constant, and the last tag is the only one carrying any
persona signal. (Ours would swap `#blonde` for the persona's own attribute.)

*Daily session ritual.* Airplane mode 3 min → off → mobile data → open IG → Reels training 5–10 min →
feed browse 1–2 min, **max 2–3 likes** → follow 5–10, unfollow yesterday's → log out → swipe closed →
airplane mode 3 min. Behavioural rule throughout: slow, minimal, human-paced; never mass-follow, never
spam CTAs, never rapid-switch accounts, never reuse an IP.

*Paid amplification — and this is the part with real numbers.* Instagram's in-app **"Boost reel" only**,
never Ads Manager, to avoid ad-account risk. Eligibility: clean content, already posted organically, with
early saves/profile-visits/shares/comments, and only after day 7.
- **Test phase (day 8+)**: pick the 3 best organic posts, boost each at **$5/day for 3 days ($15 each)**.
- **Scale phase**: after reviewing 3–5 days, pick the single winner and boost it at **$10/day for 7 days ($70)**.
- Objective: **"Visit your profile"** only — never "Visit website", never "Message you", never a mix.
- Audience: **manual only** — Male, **25–65**, locations **US / AU / CA / DE / UK**, and explicitly
  **no** interests, behaviours, lookalikes or auto-audiences.
- All special-requirement toggles (financial, employment, social issues, politics) stay off.
- Never boost multiple posts at $10/day, never edit mid-boost, never switch objectives, never stack boosts
  without a review. Max 3 boosted at once in test, exactly 1 in scale.
- Review metrics: profile visits, follows gained, saves, shares, cost per result.

**Compliance verdict.** The same evasion spine runs through this one — hotspot IP rotation, airplane-mode
IP resets, disposable SMS verification, device resets, and multi-accounting are all anti-detection
measures, and we do not adopt them. What survives, and is genuinely useful: the **7-day warm-up
before any CTA**, the strict "no link until day 7" rule, the posting *order* within a day, the
feed→Story reposting habit, the Highlights structure, Trial Reels as the primary reach lever, the
constant 5-hashtag set, and the **entire boost ladder ($5×3 days ×3 posts → $10×7 days ×1 winner,
profile-visit objective, manual male 25–65 audience in 5 countries)** — which is the only concrete
paid-acquisition playbook the package contains and maps cleanly onto our stage 8 and stage 9.
Any spend there is the operator's decision under the spend law, not an agent's.

---

## 6. Module 16 — the two prompt guides, and the 38-prompt grid

### 6a. "PAPARAZZI CORE" (`A Practical Guide to Creating Photorealistic AI Visuals`, 10 pp)

Platform: Higgsfield + Nano Banana Pro (paid SaaS). The transferable content is a **10-layer prompt
architecture**, each layer with a stated job:

1. general command & aesthetics (quality, style, image type, comparison)
2. subjects & actions
3. scene & narrative (location, setting, feeling)
4. wardrobe & accessories
5. camera & optics (lens, shooting method, **frame defects**)
6. lighting (source, effect, what happens to the background)
7. atmosphere & textures (airborne particles, surface grime)
8. colour grading (scheme, tones, artifacts)
9. realism & prohibitions (skin requirements, banned elements)
10. mood (3–4 adjectives + a final comparison)

Its realism vocabulary, grouped as the guide groups it: skin (visible pores, fine lines, slightly oily
skin, natural sheen); imperfections in moderation (freckles, moles, subtle acne scars, uneven tone, bags
under eyes); body (natural proportions, slight asymmetry, natural body fat, subtle muscle definition);
pose (unposed, candid, mid-action, awkward, relaxed); optics (28/35 mm, subtle lens distortion, handheld
shake, motion blur, uneven focus, high-ISO noise, JPEG/compression artifacts, chromatic aberration);
environment (worn leather, fingerprints on glass, dust motes in the flash, clutter). Its key prohibition
string is the inverse of the module-12 default: *no perfect skin, no plastic skin, no airbrushed skin,
no CGI skin, no doll-like skin*, and its negative prompt bans "beautiful, perfect skin, photoshoot, studio
lighting, clean, symmetrical, professional model".

**This resolves the tension r14 spotted.** Module 03's passport prompt asks for pores *and* "smooth
realistic skin" + "zero film grain"; module 12's JSON default is "light beauty enhancement, subtle skin
smoothing"; this guide argues the exact opposite and supplies the anti-gloss vocabulary. The package is
internally inconsistent about skin, and **our de-gloss doctrine matches this guide, not the passport prompt.**

**Compliance verdict: the guide's own worked examples are deepfakes.** Every full example names real
public figures (a sitting/former president, named musicians, a named actor) and instructs "fully
recognizable, with realistic likeness". Layer 1's keyword set is "leaked photo, private archive". That is
**flatly against GUARDRAIL #1** and it is the guide's central technique, not an aside. We take the
10-layer skeleton and the texture vocabulary; the celebrity-likeness method is rejected outright and no
real name goes in any prompt of ours.

### 6b. "How to craft good prompts for Z-Image-Turbo" (9 pp) — the most directly useful document in the package

Prompt order it prescribes:
`[shot & subject] + [age & appearance] + [clothing & modesty] + [environment] + [lighting] + [mood] + [style/medium] + [technical notes] + [safety/cleanup constraints]`

Concrete rules:
- **Prompt cap 300 words; 80–250 is the stated sweet spot.** Long and precise good, long and poetic bad.
- **3–5 key visual concepts per prompt**, not an exhaustive inventory.
- Subject as **{role + 2–3 traits}**; be explicit about facial structure, hair/grooming, age and general
  appearance — the model holds consistency only as far as the prompt pins it.
- **Avoid stereotype tokens** ("CEO", "rockstar", "pornstar") — they overfit and drag in unrequested
  gender, body type, hair and props. Describe the thing instead.
- Clothing in **3–5 words**; do not over-describe fabric.
- **State the face angle explicitly** (front view, 45°, left-side half-face, profile, looking slightly
  up/down) or composition randomises.
- Camera type is called one of the strongest realism levers: "shot with a point-and-shoot camera" pushes
  toward authentic snapshots; "35mm film camera" gives grain and analog tone.
- Lighting is a first-class keyword slot (soft diffused daylight / cinematic warm key / cool ambient /
  noir high-contrast / studio portrait / rim / split / top-down spotlight); backgrounds work best simple.
- **Z-Image ignores negative prompts** — put exclusions in the positive prompt with "without"/"avoid",
  at the end (no text, no watermark, no logos; plain uncluttered background; correct human anatomy,
  natural hands and fingers; sharp focus).
- **LoRA strength guidance: 0.0–2.0 range, 0.5–1.0 typical, 0.7–1.0 the recommended start, >1.0 overpowers
  the base.** (Their own module-09 workflow runs the identity LoRA at 1.5, i.e. above their own advice.)
- Final polish: sharpness / saturation / noise, **5–10 % at most**.
- **Their stated best sampler config for Z-Image Turbo: `steps 10, sampler dpmpp_sde, scheduler ddim_uniform, cfg 1.0`.**
  Note this is *not* what their own module-03 workflow ships (RES4LYF `exponential/res_8s` + `simple`,
  8 steps, cfg 1.0) — two different recommendations from the same vendor; worth benchmarking both.
- Multi-subject: works if you specify two characters, equal framing, same lighting.
- Its long worked example is built as a **braced-alternatives template**
  (`{option A|option B|option C}` per slot: camera, angle, time of day, expression, pose, lighting, mood,
  wardrobe, colour, texture, atmosphere) — a combinatorial prompt generator, not a single prompt. That
  format is worth adopting directly for our expansion stage.

### 6c. The 38-prompt grid — structure only (not reproduced)

38 texts, 937–3 084 characters (median 1 524), 156–438 words (median 229) — inside the guide's own
80–250-word sweet spot at the median, over it at the top end. All single-block natural language, no
weights, no negative prompt, no emphasis syntax.

Frequency across the 38 (r14 sampled 4; this is all of them):

| Signal | Count |
|---|---|
| explicit texture language | 35 |
| "candid" in the opening clause | 29 |
| "iPhone" named as the camera | 26 |
| "shot on …" camera clause | 23 |
| selfie framing | 19 |
| "pores" | 18 |
| "natural skin" | 18 |
| "seductive" | 16 |
| full-body framing | 14 |
| vertical framing stated | 12 |
| "thirst" / "thirst trap" as a literal token | 11 |
| in-car setting | 9 |
| grain (any) | 9 · film grain specifically 3 |
| depth of field | 9 |
| mirror selfie | 7 |
| flash | 6 |
| "imperfection" | 6 · "micro-" 5 · "vellus" 3 |
| bikini 5 · crop top 3 · beach 3 · bedroom 3 · gym 2 | |
| `f/1.8` | 3 |

Openings cluster hard: `candid full-body lifestyle…` (5), `candid close-up social…` (4),
`candid outdoor…` (3), `a high-quality Instagram-style…` (3), `full-body vertical photograph…` (3),
`a close-up front-facing…` (3), plus mirror-selfie variants. **The first clause always fixes format +
candour register before naming the subject**, exactly as r14 inferred from its 4-sample.

Wardrobe ceiling across all 38 is bikini/crop-top — Instagram tier throughout, consistent with r14.
Register is explicitly thirst-trap in ~16/38. The realism vocabulary (pores, natural skin, texture,
micro-imperfections, vellus hair) appears in the prompt body rather than a negative prompt or a later
pass, again matching r14.

---

## 7. Evidence honesty — what remains unread

- **The 15 lesson videos are downloaded but not watched.** Nothing in §3–§6 is derived from video content;
  it all comes from JSON, `.bat`, archive and PDF artefacts. The numbers r14 listed as "spoken only" that
  I recovered were recovered from *files*, not from the audio. Still video-only and unverified:
  LoRA **rank, learning rate, batch size and training resolution** (module 11 @203s–290s), and the
  Ostris AI Toolkit UI walkthrough. `11_lora_training_krea/lesson.mp4` (211 MB, 12:44) is on disk and can
  be run through the claude-video-vision skill when those numbers are actually needed.
- **The 38 prompt texts and 4 PDFs were read in full but are not reproduced** — §6 is structure,
  frequencies and derived rules. The two short operator-facing template blocks quoted in §3c are quoted
  because the exact wording *is* the artefact and they are one-line instructions, not prompt library content.
- **The 38 prompt images were downloaded but not individually viewed.** Sizes and dimensions are recorded;
  their contents are not described, and no description of any depicted person appears in this file.
- **No model weight was downloaded and no `.bat` was executed**, so registry claims in §2 rest on
  HTTP existence checks and HF repo metadata (author, downloads, likes, creation date, gated flag), not on
  inspecting weight contents. `gravedigga/loras`, `Kiro930/flux-2-klein-9b` and `zw2013/kleinbreasts`
  are flagged on **provenance**, not on any evidence of malice — I did not and cannot audit the tensors.
- **The 11 GitHub custom-node repos were verified to exist, not reviewed.** Their `main` branches execute
  during `pip install -r requirements.txt`; that code is unread.
- **The `00_start` bonus video (YouTube `k0qmkQGqpM8`) was not opened**, and the Higgsfield / Kling / ChatGPT
  custom-GPT links were not followed — all are third-party SaaS outside the package's own files.
- **No RunPod template deployed, no extension installed, no Discord joined, no money spent, no account
  setting changed.** Browser work was in a single tab I opened and closed; the operator's tabs were not touched.
- One artefact was routed through the browser's download folder before the method changed to in-page
  fetch: `C:\Users\danie\Downloads\10sorlabs_image_generator.json` is a stray duplicate of
  `03_generating_your_character/10sorlabs_image_generator.json` and can be deleted.
- Chrome blocked bulk automatic downloads after the first file, so all 21 download-route artefacts were
  fetched in-page via authenticated `fetch()` and written from base64 — same bytes, verified by the
  sha256 column in `MANIFEST.tsv`, no reliance on the download manager.

---

## Claim-check (2026-09-03, sonnet)

Independent facts-only pass against public registries (HF/GitHub APIs) and the on-disk package —
47 claims/artefacts checked: **43 VERIFIED, 2 PARTLY (corrected in §2c above), 2 UNVERIFIED
(rest on convention/reconciled, not defects), 0 WRONG.** Full verdict table:
`claimcheck-r15.md` in the review scratchpad. Highlights: all 12 GitHub node-pack repos and all
sampled Comfy-Org/HF weight repos exist as claimed; the §3 module 09/10/11 workflow-JSON numbers
(samplers, LoRA strengths, DetailBoost windows, latents) match the on-disk JSON node-for-node; the
§4 trainer archive's 40×"woman" captions and §5's SOP cadence/boost-ladder numbers match the
extracted files exactly. The two corrections: `lightx2v/*` was one download/like figure for two
repos with very different signal (344k/520 vs. 0/135 on the module-08 repo), and `gravedigga/loras`
actually hosts 30 files, not the 8 named — including an unused, ungated mirror of BFL's gated
klein-9b-fp8 weight.
