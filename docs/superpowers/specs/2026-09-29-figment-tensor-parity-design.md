# figment — tensor parity design (creator-003)

Date: 2026-09-29. Status: design approved in conversation by the operator (Daniel) on 2026-09-29;
this file records it. Project: `orgs/figment`. Branch: `claude/figment-e2e`.
Source of truth for every recipe fact: `orgs/figment/research/10sorlabs-package/` (called "the
package" below). Citations name the package file; `node N` means the node id inside that file.

Terms used throughout:
- **Module**: one numbered lesson of the package (03, 10, 11, ...).
- **Recipe**: the models, LoRAs, custom nodes, graph wiring, sampler settings and prompt logic a module prescribes.
- **Tensor profile**: the new default recipe profile, a copy of the package recipe.
- **Clean profile**: our existing licence-clean substitutes, kept as a selectable fallback.
- **Harness**: `pipeline/pod/runpod_run.py` plus `pipeline/figment_train.py`, which rent a RunPod GPU, install ComfyUI, run API-format graphs and tear the pod down.
- **Eye gate**: an operator decision made by looking at full-resolution images; recorded through `apply-rulings`.
- **Automated gate**: `identity_gate.py` (stage 1) plus `vlm_judge.py` (stage 2).
- **Ledger**: the parity ledger in section 5.

## 1. Purpose and success condition

Build creator-003, a fully synthetic persona, by running the 10sorlabs pipeline as the package
teaches it. Parity is the plan: the earlier arc swapped components and rewrote prompts, and the
outputs drifted (they read mid-30s, and lips, brows and jaw moved away from the reference).

Done means all three of these hold:
1. The operator accepts the character by eye: a passport, a culled dataset, a chosen checkpoint and kept stills that read as one adult woman.
2. A real motion-controlled video exists: an operator-supplied driving clip transferred onto the character with module 08's graph, accepted by eye.
3. Every stage passes the four tests in section 2 on the tensor profile, and every remaining difference from the package appears in the ledger with a reason.

## 2. Design rule and the architecture bar

**Rule.** Copy the package exactly: same modules, graphs, components, settings, prompt and
description logic, training recipe and capabilities. A deviation needs a stated reason tied to a
goal. The one standing engineering deviation is the runtime. The package runs a desktop or
RunPod-template ComfyUI; we run the same graphs through the harness. Our graphs are API-format
exports of their editor-format files. The harness does the prompt and seed fan-out that their
`CR Prompt List` nodes and `control_after_generate: increment` do.

**Bar.** No stage counts as done until it passes all four tests:

| Test | Passes when |
|---|---|
| Recipe parity | The section 9 parity test is green for the stage. Every difference is a ledger row marked KEEP or OUT OF SCOPE. |
| Input parity | The stage consumes the same kind of input the lesson uses: a text prompt for the passport, one face and one faceless body photo for the dataset, and so on (section 3). |
| Dry-run proof | `figment_train.py plan` plus harness `--dry-run` are green, and pins verify against the installer sha256 values where the installer states one. |
| Eye gate | The operator ruled on the stage's board, and the ruling is recorded with `decided_by` and `decided_at`. |

## 3. Pipeline overview

The path is modules 03 → 10 → 11 → 09 (+16) → 07 → 08.

| # | Stage (driver id) | Module | Input | Output | Eye gate |
|---|---|---|---|---|---|
| 1 | passport (`anchor`) | 03 | passport prompt with hair and eye slots filled | 12 seeded passport candidates | operator picks one; it becomes the identity |
| 2 | dataset (`dataset`) | 10 | chosen passport (face) + one operator body photo with no face visible | 15 face + 15 body images | operator culls, viewing each image beside the passport |
| 3 | train (`smoke`, `train`) + tester (`tester`) | 11 | culled dataset with Qwen3-VL-8B captions | 12 LoRA checkpoints, 250 to 3000 steps; a 12-image ladder | operator picks the checkpoint |
| 4 | stills (`gen`) | 09 + 16 | chosen checkpoint + photo-derived prompts | base, upscaled and face-detailed stills | operator keeps or culls |
| 5 | edit (`edit`, new) | 07 | base image + head-source image + their head-swap prompt | edited image | operator accepts or rejects each edit |
| 6 | video (`video`) | 08 | driving clip + its first frame with the character swapped in | 16 fps mp4 | operator accepts the video |

The `detail` stage stays in the clean profile only. Module 09 runs its FaceDetailer inside the stills graph.

## 4. Per-stage specification

### 4.1 Passport — module 03

**What the package prescribes** (`03_generating_your_character/10sorlabs_image_generator.json`;
this file is byte-identical to `06_generating_images/`'s copy, sha256 `5b57403f…`. The package has
no transcript for module 03.)
- Models (`image_generation_models.bat`): `z_image_turbo_bf16`, `qwen_3_4b` (CLIPLoader type `lumina2`), `ae.safetensors`. LoRA via `Power Lora Loader (rgthree)` node 102: `realistic_snapshot_lora` **0.66**. A second slot in that loader is saved off and is out of scope.
- Base pass: `EmptyFlux2LatentImage` 1536×2048. `ClownsharKSampler_Beta` node 47: eta 0.45, `exponential/res_8s`, scheduler `simple`, 8 steps, denoise **0.95**, cfg 1, seed 148 `increment`, bongmath on.
- Chain: decode → save → `FaceDetailer` node 30 → save → `ImageUpscaleWithModel` (`zit_upscaler`) → `FaceDetailer` node 66 → save. Both detailers use `face_yolov8m.pt` (`UltralyticsDetectorProvider`) and `sam_vit_b_01ec64.pth` (`SAMLoader`).
- Detailer settings as saved: guide 1024, max 1024, 8 steps, cfg 1, `dpmpp_2m`/`simple`, denoise **0.4** (node 30) and **0.27** (node 66), feather 5 and 7, bbox threshold 0.5, dilation 10, crop 3, SAM threshold 0.93, noise-mask feather 20.
- The module 06 transcript (same graph, around 7:50) says 0.4 causes a rough face. The author's instruction is "a good value is like 0.23 … do it twice … stay within 0.15 and 0.3".
- Custom nodes: Impact-Pack, Impact-Subpack, RES4LYF, rgthree.
- Prompt: the module 03 copy block "Passport photo prompt" in `modules.json`. It describes a front-facing head-and-shoulders portrait on a plain white studio background, grey crewneck, iPhone 15 Pro at 24mm and f/1.8. It has two slots: `{long, straight platinum blonde hair}` and `{bright light blue-grey}` eyes. The subject term is "a stunning young woman".
- Negative prompt: node 5's anti-perfection list, starting "perfect symmetry, perfectly aligned face, flawless lighting, …".
- The graph's own node 4 text is a different, stale night-window scene.

**What we have today.** `expand/workflows/zimage_passport_api.json` builds its rows from graph node 4
plus `persona.identity.look` (`anchor-prompts.yaml`). It swaps the realism LoRA for Apache-2.0 suayptalha (D15). It drops the detailers and the upscaler (D17). It trims the camera clause (D20) and adds a framing prefix (D21). A klein-4B edit arm (`anchor_edit`) also runs, and nothing in the package prescribes it.

**What changes (tensor).**
- Use the copy-block passport prompt verbatim. Fill only its two slots from creator-003's `identity.look.hair` and `.eyes`.
- Reinstate the full node set: realism LoRA 0.66, both FaceDetailers with YOLO and SAM, `zit_upscaler`, and the negative prompt.
- Seeds 148–159, one job each. This is D19 fan-out.
- Detailer denoise is 0.23 on both passes, following the author's spoken correction for this exact graph. This is ledger row P3 and a ruling in section 12.
- No edit arm. The operator may use g01 only to choose the slot words; no image conditions the passport.

**Acceptance.**
- Parity test green.
- 12 candidates at the final (post-detailer-2) output, plus the automated gate with age hold (section 7).
- The operator picks one. It is written as `personas/creator-003/anchors/passport.png` and becomes `identity.references[0]`.

### 4.2 Dataset — module 10

**What the package prescribes** (`10_dataset_generator_v2/10sorlabs_dataset_generator_v2.json`, `dataset_generator_model_installer.bat`, transcript).

Inputs:
- Two `LoadImage` nodes: 836 (face) and 837 (body).
- The transcript at 3:38 says the body image is "best to use an image with no face visible". At 3:59 it says the prompts must match the input photos.

Stage A, Qwen edit:
- Model: `CheckpointLoaderSimple` `Qwen-Rapid-AIO-NSFW-v23` (out of scope, see decision 4). Then `LoraLoaderModelOnly` `bfs_head_v5_2511_merged_version_rank_16_fp16` **0.6** (node 89). Then node 723 (bypassed, mode 4, out of scope). Then `ModelSamplingAuraFlow` shift **3.1**.
- Face branch: 836 → `ImageResizeKJv2` 1680² → `FaceBoundingBox` padding 15 (insightface, CPU) → resize → `TextEncodeQwenImageEditPlus` image1.
- Body branch: 837 → resize → image1, with the face crop as image2.
- Latents: `EmptyLatentImage` **1024×1440**.
- Samplers: `ClownsharKSampler_Beta` eta 0.31 (face) / 0.30 (body), `linear/euler`, `beta57`, 4 steps, denoise 1, cfg 1, fixed seeds, bongmath on. `ClownOptions_DetailBoost_Beta` weight 1, windows 4→10 (face) and 2→4 (body). The negative is the positive passed through `ConditioningZeroOut`.

Stage B, refine (per image):
- Chain: `ImpactImageBatchToImageList` → `ImageScaleToTotalPixels` 1 MP lanczos → `ImageUpscaleWithModel` `zit_upscaler` → `ImageScaleBy` 0.5 lanczos → `VAEEncode` (`flux2-vae`).
- Sampling: `KSampler` 4 steps, cfg 1, `euler`/`beta`, denoise **0.23**, on `flux-2-klein-9b-fp8` with shift 3.
- Text: `CLIPLoader` `qwen_3_8b_fp8mixed` type **`lumina2`**, into `CLIPTextEncode` → `ReferenceLatent` (conditioning only), with an empty negative.

Prompts:
- `CR Prompt List` 179 (face) and 697 (body), 15 rows each, 30 outputs total.
- Their `prepend_text` inputs are linked from primitives. Face, node 761: `"long platinum blone hair, grey eyes, youthful young woman, "`. Body, node 760: "A youthful young woman with platinum blonde hair, no makeup. she has <body description>".
- The same strings are the refine prompts (nodes 800 and 780 via Get nodes).
- The widget text saved on 174/676 is a stale clothing-removal instruction, shadowed at runtime. It is out of scope.

Custom nodes and outputs:
- Installer nodes: Impact-Subpack, RES4LYF, rgthree, Impact-Pack, SeedVR2, Comfyroll, FaceAnalysis, each at a pinned SHA. The graph also needs KJNodes, which the installer omits.
- Output: 15 face and 15 body images. The transcript at 4:30 says to cull the ones that "make no sense".

**What we have today.** `tensor_dataset_v2_api.json` with D1, D3–D14 and D24–D26. Prompts are ours (`tensor-dataset-prompts.yaml`) and carry the full look clause and skin clause. The body input is g07, which shows a face. The build also has 3 shards plus a full-body manifest, `dataset_replicates: 2`, and a `klein-multiref` alternative source.

**What changes (tensor).**
- Base-model slot, the single recipe deviation (R1): module 04's stack from `04_generating_a_dataset/dataset_models.bat` and its graph nodes 1–4. That is `qwen_image_edit_2511_bf16` loaded as `fp8_e4m3fn`, plus the Lightning-4steps LoRA at 1.0, `qwen_2.5_vl_7b_fp8_scaled` (type `qwen_image`) and `qwen_image_vae`. It feeds `bfs_head_v5` 0.6 → shift 3.1 exactly as module 10 wires it.
- What R1 could affect: the AIO merge bakes in its own fine-tune, and we do not know its body or skin prior or whether Lightning is merged into it. Body shape, skin texture and prompt adherence may differ from their outputs. The 4-step and cfg-1 settings stay valid because Lightning-4steps supplies the distillation.
- Reinstate `bfs_head_v5` 0.6, klein 9B fp8 with `qwen_3_8b_fp8mixed`, and `zit_upscaler`.
- Keep the CLIP type at the package value `lumina2`. If the phase 6 smoke shows it fails to load, fall back to `flux2`, the package's own module 07 value for the same encoder, and record it (row D5).
- Prompts: their 30 rows verbatim. Prefixes use their two forms. Hair and eyes come from the chosen passport's slot words. The body description comes from `persona.body_target`, in their sentence form. The age term is "youthful young woman" as written (decision 6).
- The `identity.look` sentence and the skin clause are removed.
- The body input is the operator's faceless body photo (section 8).
- Harness fan-out stays; sharding is our call. The full-body repair tail is removed.

**Acceptance.**
- Parity test green.
- Dry run plans exactly 30 jobs.
- After the live run: the automated gate (with the age hold and the new axes) runs, then the operator culls each image beside the passport.
- The kept set moves on to training. Held and culled counts are stated in the report.

### 4.3 Train and tester — module 11

**What the package prescribes** (`11_lora_training_krea/transcript.txt`, `10sorlabs_dataset_tester.json`).

Stated in the package text:
- Trainer: Ostris AI Toolkit on an RTX Pro 6000, low VRAM on.
- Dataset: about 20 images is enough (1:45).
- Auto-caption with Qwen, "8 billion parameter model", "leave everything as is" (2:25).
- **No trigger words.** Model **Krea 2 raw**, "do not use the turbo with the training adapter" (3:33).
- "Leave this all as default, only change" max step saves to keep from 4 to **15**. Saves every **250** steps. **Cache text embeddings** on. **Sampling disabled** (training 2 h → 70–80 min).
- Run took 1 h 17 m and produced **12** LoRAs. The tester nodes load `_000000250` … `_000002750` plus the unsuffixed final, so the run is **3000 steps**.
- DOP (differential output preservation) is never mentioned, so it stays at the toolkit default of off.

Tester graph:
- 12 identical branches: `UNETLoader` `krea2_turbo_fp8_scaled`, `CLIPLoader` `qwen3vl_4b_fp8_scaled` type `krea2`, `qwen_image_vae`, `LoraLoader` **1.0/1.0**.
- `EmptyLatentImage` 1448×2176. `KSampler` seed 1595 fixed, 4 steps, cfg 1, `res_2s`/`beta`, denoise 1. Negative zeroed.
- One prompt (node 514) feeds all 12. The transcript says to generate it with image-to-prompt (9:00).
- The author picked step 1250 and also considered 750 (10:10).

Not in the package text (**UNKNOWN-IN-PACKAGE**):
- rank/alpha, learning rate, optimizer and weight decay, batch size, resolution buckets, quantization, timestep type, loss, caption dropout, the caption instruction string, and the caption max resolution and token count.
- Our current values: rank 32, LR 1e-4, AdamW8bit, wd 1e-4, batch 1, buckets 512/768/1024, qfloat8/qfloat8, linear/balanced/MSE, caption dropout 0.05, caption instruction, max res 512, 128 tokens.
- These came from `research/r15b-training.md`, which read them off the lesson video's UI frames at 3:23–4:01. They are toolkit defaults the author left untouched. The video is not in the package snapshot, so this file cannot re-verify them.
- Module 05's legacy Z-Image recipe (rank 16, LR 0.00025, 5000 steps, 512 only, single-word "woman" captions from the `LoRA Trainer/Dataset/*.txt` files) is superseded by module 11 and not used.

**What we have today.** `ai-toolkit-krea2.yaml.template` matches the above except for two things. `dop_enabled` is on for creator-001, and a `<trigger> <noun>` clause is prepended to every caption. The tester prompt is ours.

**What changes (tensor).**
- DOP off. No trigger clause in captions; the toolkit job name stays the persona id.
- Steps stay **3000**: this is theirs, not a deviation.
- The tester prompt is one module-16-structured prose prompt describing the passport character, with no trigger. It is produced by the section 8 photo-to-prompt path, or written by hand in the same structure.

**Acceptance.**
- Parity test green against the table above.
- 12 checkpoints saved and inventoried.
- A 12-image ladder rendered and gated.
- The operator picks a step, recorded through `apply-rulings --checkpoint-step`.

### 4.4 Stills — modules 09 and 16

**What the package prescribes** (`09_krea2_image/10sorlabs_krea2_image.json`, `krea2_model_installer.bat`, transcript).

Model and LoRAs:
- `krea2_turbo_fp8_scaled`, `qwen3vl_4b_fp8_scaled` (type `krea2`), `qwen_image_vae`.
- `Power Lora Loader` node 1633: `RealisticSnapshotKrea2` **1.5** on, `pawg_krea2` **0.65** on. A third slot is saved off and is out of scope.
- The character LoRA is added by the operator (transcript 3:27). The module 11 transcript at 11:40–12:00 tried 1.2, then settled on **1.0** as less plastic.

Chain:
- Base: `EmptyLatentImage` 1448×2176. `KSampler` seed 1594 `increment`, 4 steps, cfg 1, `res_2s`/`beta`, denoise 1. There is no negative prompt; "Krea 2 doesn't work with negative prompt" (3:40), so the positive is zeroed.
- Upscale: `4xNMKDSuperscale_4xNMKDSuperscale.pt` → `ImageScaleBy` **0.25** nearest-exact (net 1×) → `VAEEncode` → `KSampler` seed 40, 4 steps, cfg 1, `euler_ancestral`/`simple`, denoise **0.35**.
- Face: `FaceDetailer` node 1611, fed from the upscaled image. Settings: guide 512 (for bbox), max 1024, seed fixed, 4 steps, cfg 1, `euler`/`normal`, denoise **0.15**, feather 5, bbox threshold 0.4, dilation 10, crop 3, SAM threshold 0.8, noise-mask feather 100. Positive `"feminine, young woman,"`, negative zeroed. Detectors: `face_yolov8m.pt` (Bingsu/adetailer) and `sam_vit_b_01ec64.pth`.
- Saves: `image_base`, `image_upscaled`, `image_enhanced`.
- Rule of thumb (4:20–5:40): skip the upscaler for close-up faces, where it "dilutes" the image; use it for busy or wide shots.

Custom nodes: rgthree, Impact-Pack, Impact-Subpack, KJNodes, RES4LYF.

Prompt logic (modules 06, 09, 11 and 16):
- Operator finds a reference photo → image-to-prompt → paste. Then correct the traits that contradict the character: "our model had light gray eyes … we're just gonna say light gray eyes" (module 06, 6:10). "If you have a blonde model and … brunette reference image … you're gonna have to tweak the prompt" (module 11, 11:00).
- Module 16's Z-Image guide structure: [Shot & subject] + [Age & appearance] + [Clothing] + [Environment] + [Lighting] + [Mood] + [Style] + [Technical] + [Cleanup], 80–250 words, 300 maximum, camera terminology. `16_prompts/prompt_grid/` holds 38 long-form examples (`modules.json` says 36).
- The image-to-prompt tool is an external Chrome extension ("img2prompt", `modules.json` links). Its model and instructions are not in the package.

**What we have today.** `train/workflows/krea2_gen_api.json` has several substitutions:
- The upscaler is Nomos RealPLKSR.
- The FaceDetailer is replaced by a MediaPipe mask + `DetailerForEach` (D27).
- The style slot holds clean candidates or none (D28).
- Prompts carry the `identity.look` prefix (`gen-prompts.yaml`).
- Refine and detailer denoise are persona knobs. Run1 used refine 0 and detailer 0.20.

**What changes (tensor).**
- Reinstate NMKD, FaceDetailer with YOLO and SAM, and both on-by-default style LoRAs. Identity LoRA 1.0/1.0.
- The upscale+refine group runs only for stills whose prompt framing is not a close-up. The package's own rule of thumb says so, and it matches our run1 finding that refine hurt close faces.
- Prompts come from section 8 intake with the look prefix removed.

**Acceptance.**
- Parity test green.
- Each still's prompt text is shown to the operator before launch.
- Automated gate, then keep or cull by eye.

### 4.5 Edit — module 07

**What the package prescribes** (`07_editing_images/10sorlabs_image_edit_workflow.json`, `image_edit_models.bat`, transcript).

Models:
- The installer fetches `flux-2-klein-9b-fp8` (gated BFL repo), `qwen_3_8b_fp8mixed`, `flux2-vae`, and `bfs_head_v1_flux-klein_9b_step3500_rank128` (Alissonerdx/BFS-Best-Face-Swap).
- The graph instead names `flux-2-klein-9b.safetensors`. Its MarkdownNote points to the Kiro930 mirror.
- `CLIPLoader` type **`flux2`**.

Chain:
- `LoraLoaderModelOnly` node 164 → `CFGGuider` cfg 1 → `SamplerCustomAdvanced` with `KSamplerSelect` `euler_ancestral`, `Flux2Scheduler` 4 steps, `RandomNoise`.
- Latent size comes from `LayerUtility: ImageScaleByAspectRatio V2`, using the longest side and length 1536 (`easy int`).
- Two images, each VAE-encoded and chained through `ReferenceLatent` into both positive and negative: node 76 ("ref img", scaled) first, then node 169 ("input img", `FluxKontextImageScale`) second.

Prompts and LoRA:
- Notes carry two prompts. Clothing swap: "The character in Figure 1 is wearing the clothes in Figure 2. Maintain realistic details." Head swap: "head_swap: Use image 1 as the base image, preserving its environment, background, camera perspective, framing, exposure, contrast, and lighting. Remove the head from image 1 and seamlessly replace it with the head from image 2. Match the original head size, face-to-body ratio, neck thickness, shoulder alignment, and camera distance so proportions remain natural and unchanged."
- For the head swap, "enable this LoRA, put it to one" (6:20). He tried 0.6 and went back to 1.0.
- The saved node-164 value is an out-of-scope slider LoRA at 2.0.

Custom nodes: rgthree, ComfyUI-Easy-Use, ComfyUI_LayerStyle.

**What we have today.** No edit stage. `klein4b_anchor_variation_api.json` (clean profile) is unrelated.

**What changes (tensor).**
- New `edit` stage using the graph above, with `bfs_head_v1` klein at 1.0 in node 164 and the installer's official fp8 UNET.
- Two jobs types. Start-frame head swap: image 1 is the driving clip's first frame, image 2 is an accepted still or the passport. Still touch-up: module 06 at 6:30 sends stills here.

**Acceptance.**
- Parity test green.
- A dry run confirms which image slot is "image 1" (see section 12).
- The operator accepts or rejects each edit by eye, beside the passport.

### 4.6 Video — module 08

**What the package prescribes** (`08_motion_control/10sorlabs_motion_control.json`, `motion_control_models.bat`, `extract_first_frame.bat`, transcript).

Models (all safetensors):
- `wan2.1_14B_SCAIL_2_fp8_scaled` → `LoraLoaderModelOnly` `Wan21_I2V_14B_lightx2v_cfg_step_distill_lora_rank64` **1.0** → `ModelSamplingSD3` shift **5**.
- `umt5_xxl_fp8_e4m3fn_scaled` (type `wan`), `wan_2.1_vae`, `clip_vision_h`, `sam3.1_multiplex_fp16`.

Driving video:
- `VHS_LoadVideo` force_rate **16**, frame_load_cap **81**, skip 0.
- `SAM3_VideoTrack` with the text prompt `"human"`, threshold 0.5, run on the driving video and on the start frame.
- `SCAIL2ColoredMask` sort by `area`, replacement mode off.

Start frame:
- `LoadImage` → `ResizeImageMaskNode` scale to **0.5 MP** nearest-exact → multiple of **32** → `GetImageSize`, which sets width and height (overriding the saved 512×896). It also goes to `CLIPVisionEncode`.
- The start frame is the driving clip's first frame (ffmpeg `-frames:v 1`), with the character swapped in "either in the flux edit workflow or … chat gpt" (4:57). ChatGPT is out of scope; we use module 07.

Sampling:
- `WanSCAILToVideo`: length **81**, batch 1, pose strength 1, pose start 0, pose end 1, frame offset 0, previous-frame count 5.
- `KSampler` seed 123 fixed, **6** steps, cfg 1, `euler`/`simple`, denoise 1.

Output: `VHS_VideoCombine` **16 fps** h264 mp4, yuv420p, crf 19.

Prompts: "simple and concise", for example "blonde hair girl wearing a black dress dancing". Describe no background, expression or lighting (5:30). Leave the negative (the standard Wan negative) as is.

Rules from the transcript:
- One person in the driving clip.
- Test with a low frame cap (about 60) and a low frame rate, then raise them. Never above 16 fps.
- The frame rate must match in load and combine.
- "The start frame needs to match up with this drive video."

Custom nodes: ComfyUI-SAM3, ComfyUI-VideoHelperSuite, plus one more that the transcript installs through the manager and never names.

**What we have today.** Wan 2.2 TI2V 5B (`video/wan22_ti2v_5b_native_api.json`) renders 1280×704 landscape. Its pins sit outside `verify_pins.py`.

**What changes (tensor).**
- Module 08's graph replaces it. The Wan 2.2 stage stays in the clean profile.
- Resolution follows the start frame's aspect, so a vertical clip gives vertical video.
- Phase 6 runs at their saved cap of 81 frames at 16 fps, about 5 s.

**Acceptance.**
- Parity test green.
- Dry run proves the mp4 upload and the mp4 download (section 12).
- The operator accepts the video.

## 5. Parity ledger

Dispositions:
- REVERT: take theirs.
- KEEP: ours stays in the tensor profile, with the reason given.
- OUT OF SCOPE: not carried.

Unless a row says otherwise, "ours today" stays available in the clean profile.

| Id | Their component | Ours today | Disposition | Reason |
|---|---|---|---|---|
| D1 | AIO NSFW checkpoint (m10) | Qwen-Edit 2511 fp8mixed split stack | REVERT to module 04 stack (bf16 file, fp8_e4m3fn load); recorded as R1 | Decision 4: the NSFW merge is out of scope. Module 04's stack is the package's own audited substitute. fp8mixed differed from module 04's file. |
| D2 | clothing-removal widget text (m10) | removed | OUT OF SCOPE | present in package, out of scope for this spec |
| D3 | `bfs_head_v5` 0.6; bypassed body LoRA (m10) | both dropped | REVERT `bfs_head_v5`; bypassed LoRA OUT OF SCOPE | decision 3; the second LoRA is mode 4 in their file and out of scope |
| D4 | klein 9B fp8 (m10) | klein 4B | REVERT | decision 3; non-commercial licence recorded (section 12) |
| D5 | `qwen_3_8b_fp8mixed`, type `lumina2` (m10) | `qwen_3_4b`, `flux2` | REVERT encoder; type `lumina2` first, `flux2` only if the smoke fails | module 07 uses `flux2` for the same encoder |
| D6 | `zit_upscaler` (m03, m10) | RealPLKSR | REVERT | decision 3 |
| D7 | SAM weight installed, unused (m10) | not downloaded | KEEP | no m10 node loads it; output-neutral |
| D8 | `CR Prompt List` fan-out | harness fan-out | KEEP | standing harness deviation |
| D9 | installer node set | trimmed set + KJNodes | REVERT to "nodes the graph uses" per module, KJNodes included | decision 3 "as needed"; SeedVR2 and Comfyroll are unused once D8 applies |
| D10 | two SaveImage (m10) | one SaveImage per job | KEEP | harness output ordering |
| D11 | pinned node SHAs enforced | recorded, not enforced | KEEP | harness frozen (decision 13) |
| D12 | Preview and Note nodes | dropped | KEEP | UI-only |
| D13 | their prompt language (m10) | our register language | REVERT | decision 6 |
| D14 | faceless body photo (m10) | g07 shows a face | REVERT | decision 9; the lesson's own instruction |
| D15 | `realistic_snapshot_lora` 0.66 (m03) | suayptalha Apache LoRA | REVERT | decision 3 |
| D16 | Power Lora Loader (rgthree) | core `LoraLoader` chain | KEEP | same strength on model and clip; UI-only pack; the parity test checks equal strengths |
| D17 | 2× FaceDetailer + YOLO + SAM + upscaler (m03) | dropped | REVERT | decision 3; pickles admitted per section 6 |
| D18 | Image Comparer, group bypasser, extra saves | dropped | KEEP | UI-only; the board is our comparer |
| D19 | seed `increment` from 148 | 12 explicit seeds 148–159 | KEEP | harness fan-out; same seed sequence |
| D20 | full camera clause and quality tags | trimmed | REVERT | decision 6 |
| D21 | copy-block passport prompt | node-4 scene + our framing prefix | REVERT | our port used the stale graph text; the copy block is already a framed portrait |
| D22 | — (m03 has no edit arm) | anchor edit-arm prompt fix | OUT OF SCOPE for tensor (clean only) | module 03 is text-to-image only |
| D23/D24 | Impact-Subpack | removed | REVERT | `UltralyticsDetectorProvider` needs it (m03, m09) |
| D25 | — | full-body face-repair tail | REVERT (remove) | not in package |
| D26 | — | optional skin LoRA slot | REVERT (remove) | not in package |
| D27 | FaceDetailer + YOLO + SAM (m09) | MediaPipe + `DetailerForEach` | REVERT | decision 3 |
| D28 | `RealisticSnapshotKrea2` 1.5 + `pawg_krea2` 0.65; identity LoRA added by user | clean style slot or none | REVERT | decision 3 |
| D29 | — | detail-only re-detail workflow | KEEP as a clean-profile tool, not in the tensor path | diagnostic; no package equivalent |
| U1 | no trigger word (m11) | `<trigger> <noun>` caption prefix | REVERT | module 11 text |
| U2 | DOP not used (m11) | DOP on (creator-001) | REVERT | module 11 "leave all as default" |
| U3 | image-to-prompt prose, no look prefix (m06, m09, m11) | `identity.look` 8-field prefix in dataset, refine and gen | REVERT | decision 6; the cause of the drift |
| U4 | NMKD `.pt` upscaler (m09) | RealPLKSR | REVERT | decision 3 (called "finding 16" in TENSOR-TRAINING, not in the D-list) |
| U5 | refine 0.35 / detailer 0.15 always (m09 graph) | knobs; run1 used 0 / 0.20 | REVERT to 0.35/0.15, with the upscale group skipped for close-ups | the package's own rule of thumb (m09 4:20) |
| U6 | Qwen3-VL-8B float8 captioner (m11) | loads bf16 (no quantizer on pod) | KEEP | runtime difference only; captions equal up to quantization noise |
| U7 | 30 cells, 1 run (m10) | 3 shards + full-body manifest, replicates 2, klein-multiref option | REVERT to 30 cells, replicates 1; sharding KEEP | sharding is harness scheduling; the rest is not in the package |
| U8 | SCAIL-2 motion control (m08) | Wan 2.2 TI2V 5B | REVERT | decision 11 |
| U9 | no anchor edit arm (m03) | klein-4B anchor variations | OUT OF SCOPE for tensor | not in package |
| U10 | RTX Pro 6000 96 GB | L40S 48 GB | KEEP | cost and harness pins. The m08 transcript needs ≥24 GB. Training time is unmeasured at 3000 steps; the smoke measured 3.85 s/step. |
| U11 | gated Krea-2-Raw repo | ungated Comfy-Org repackage | KEEP | same weights, no token handling |
| U12 | m07 graph names the non-fp8 klein from a mirror | none | use the installer's official `flux-2-klein-9b-fp8` | the mirror is a licence-bypass re-upload (r15 §2c); the installer is the package's own choice |
| U13 | m07 LoRA slot saved with an out-of-scope file at 2.0 | none | slot holds `bfs_head_v1` klein at 1.0 | transcript 6:20; the saved value is out of scope |
| I1 | external img2prompt Chrome extension (m06/09/11) | none | KEEP a local `claude -p` equivalent built from module 16's structure (section 8) | the tool's internals are not in the package; it runs locally at no spend |
| R1 | — | — | the single recipe deviation (see D1) | decision 4 |
| P3 | m03 detailers saved at 0.4 / 0.27 | none (dropped) | use 0.23 / 0.23 | the author's spoken correction for this exact graph (m06 7:50); ruling in section 12 |

## 6. Recipe profiles

A profile is a named choice, made once per stage, of four things: a workflow file, a pin group,
a prompt template, and stage settings. It adds no separate driver, plan format or gate.

- **Where it lives.** `training.recipe_profile: tensor | clean` in `training.yaml`, with default `tensor`. It is added to `lineage.TRAIN_TIME_KEYS` because it decides pixels.
- **creator-001.** Its recorded plans and rulings are untouched. Any future re-plan must name `clean` explicitly, and the driver refuses a creator-001 plan with no profile.
- **Pins.** `train/tensor-pins.yaml` gains a top-level `profiles` map from stage id to pin-group name. `tensor` uses the new groups `passport_tensor`, `dataset_tensor`, `gen_tensor`, `edit_tensor` and `video_tensor`, plus the existing `train`, `tester` and `caption`. `clean` maps to today's groups unchanged.
- **Driver lookup.** `STAGE_PIN_PROFILES` in `figment_train.py` becomes a lookup through the active profile. The video pins move into `tensor-pins.yaml` under `video_tensor`, which brings video under `verify_pins.py`.
- **Tensor pin groups** carry each installer's file names and the sha256 the installer states. Modules 09, 10 and 11 state sha256 per file.
- **Workflows.** Tensor workflows live beside today's: `expand/workflows/tensor_passport_m03_api.json`, `tensor_dataset_m10_api.json`, `train/workflows/tensor_tester_m11_api.json`, `tensor_stills_m09_api.json`, `tensor_edit_m07_api.json`, and `video/tensor_motion_m08_api.json`. Each is exported from the package JSON and reviewed only against the ledger.
- **Knobs.** The existing per-persona knobs (`gen_prompt_style`, `gen_refine_denoise`, `gen_detailer_denoise`, `dataset_source`, `skin_lora`, `style_lora`, `dop_enabled`, trigger) are profile defaults. Under `tensor` they are fixed to the package values, and the driver refuses an override that has no ledger KEEP row. Under `clean` they behave exactly as today.
- **Pickles.** `face_yolov8m.pt`, `sam_vit_b_01ec64.pth` and `4xNMKDSuperscale….pt` load through the harness's existing escape hatch: manifest `diagnostic_non_commercial: true` plus a per-model `pickle_ack` reason. That needs no harness code change. It applies only to tensor manifests and only to disposable pods (decision 3). GUARDRAILS #7 describes the ban this hatch bypasses (ruling in section 12).
- **ComfyUI address.** The driver takes a ComfyUI server address setting, a decision 13 exception. Pod runs fill it from the pod as today. This is noted for future use and not designed further here (decision 14).

## 7. Gates

**Order, at every gradeable stage.**
1. The automated gate scores every image.
2. The board shows these groups: *passed*; *held for age*; *held unscorable* (a required metric could not be computed, such as a rear view with no face); *failed* (collapsed, with the failing metric, and openable).
3. The operator rules.

The automated gate only filters. It never keeps an image, and it never replaces the eye gate. Nothing is dropped without appearing on the board.

**Age hold.**
- Today's gate has no absolute age floor, only `age_delta` against the reference (`gate.yaml`: ViT `age_delta_max_years` 5.0, judge `age_delta_max` 1.5).
- Delta alone cannot protect a new identity whose reference is its own passport. Add `age_floor_years` to `gate.yaml`, applied to the judge's `apparent_age_candidate` and to the ViT age estimate. If either is under the floor, or either cannot be computed, the image goes to *held for age*.
- For each held image the board shows: the image at full resolution beside the passport, both age scores, the floor, and the reason.
- The operator rules `release` or `cull`, and the ruling is recorded in the `apply-rulings` lineage. Each ruling is also appended as a labelled example to `personas/<id>/calibration/age-holds.jsonl` (image sha256, both scores, ruling, `decided_by`, `decided_at`) for tuning the age judge.
- A stage cannot close while a held image has no ruling. Every stage report states the counts: passed, held (age), held (unscorable), failed, kept and culled.
- The floor value is a ruling (section 12). Precedent: TENSOR-REPLICATION's grading protocol culls "a face reading under twenty".

**New trait axes.**
- `vlm_judge.py` gains five 0–100 "matches the passport" scores: `lips` (fullness and shape), `brows` (shape, thickness, arch), `skin_pattern` (freckles, moles, marks, tone variation), `hair` (colour, length, parting, texture) and `jaw` (width and definition).
- The reference is the chosen passport. `identity_gate` facenet cosine is also scored against the passport.
- Until thresholds exist, the axes display and do not filter. Thresholds are fitted in phase 2 at no cost (the judge runs on subscription), using creator-001's already-ruled gen and dataset boards, where the lips and brows drift was observed. The operator then sets the thresholds (ruling).

**Eye gates** (decision 8): pick the passport; cull the dataset beside the passport; pick the checkpoint from the tester ladder; keep or cull stills; accept edits; accept the video.

## 8. Reference media intake

The operator supplies all media. Nothing is scraped or downloaded from other creators (contract T4).
The face never carries over from reference media: only the passport and the trained LoRA carry the face.

| Point | Stage | Format | Rule |
|---|---|---|---|
| Body reference | dataset (m10) | one JPG/PNG, face not visible | uploaded to the pod as image 837; its hair and body words go into the body prefix only after the operator confirms them |
| Scene photos | tester, stills (m09/16) | JPG/PNG, one per scene | Never uploaded to a pod. A local image-to-prompt step turns each photo into text. Then the text is corrected: the photo subject's face, hair, eye and skin descriptors are replaced with the passport's slot words, and no person's name appears (GUARDRAILS #1). The operator reads and approves each prompt before launch. |
| Driving clips | edit + video (m07/08) | mp4, one person, simple motion, portrait for reels | first frame extracted locally (`video/frame_extract.py`, equivalent to their ffmpeg `-frames:v 1`); head-swapped in the edit stage; the clip and the accepted start frame are uploaded to the video pod |

**Image-to-prompt.** The package tool is an external extension with undisclosed internals.
Our equivalent is a local `claude -p` call, subscription-billed with no API key. Its instruction is
module 16's structure: nine ordered parts, 80–250 words, camera terms, subject stated as a young
woman per decision 6, and only the reference aspects the operator chooses to reproduce. This is a
necessary deviation, ledger row I1: the tool itself is not in the package.

The harness upload allow-list has no `.mp4`. Adding it is a blocking fix under decision 13.

## 9. Parity test

`pipeline/tests/test_tensor_parity.py` runs offline at no cost, and runs again as a `plan` preflight
when `recipe_profile == tensor`. For each tensor stage it loads the package editor JSON and our API
JSON and compares them in four ways:

1. **Nodes.** Every package node that is not UI-only has a node with the same `class_type` and identical widget values in ours. UI-only means Note, MarkdownNote, PreviewImage, Image Comparer, Fast Groups Bypasser, Set/GetNode, primitives feeding text, `CR Prompt List`, and the rgthree Any Switch. The only exemptions are fields the harness substitutes per job (seed, prompt text, image filename, `filename_prefix`) and fields named in a ledger KEEP or REVERT row.
2. **Topology.** After collapsing Set/Get pairs and primitives, the edge list is equal.
3. **Models.** Each tensor pin's filename equals the package filename, or the ledger's mapped name. Its sha256 equals the installer's stated sha256 where one exists. Where none exists, the sha256 is resolved live at pin time as today.
4. **Prompts.** Each rendered job prompt equals the package template with only the named slots substituted. Any `identity.look` phrase appearing in it fails the test.

Training parity checks the rendered `training.json` against the section 4.3 table: DOP false, no trigger, 3000 steps, save 250, keep 15, cache text embeddings on, sampling off, raw base.

The test **fails** on any of these:
- an unlisted difference;
- a REVERT row still differing;
- a KEEP row with no reason;
- a hash mismatch;
- a look-prefix phrase in a prompt;
- a tensor manifest that sets the pickle hatch for a file not listed in section 6.

## 10. Phases (one task per phase)

The arc stands at about $54.3 of the $60 `ARC_CAP_USD`, leaving about $5.7. Every live pod run is T2: a card, an estimate and operator approval.

| Phase | The one task | Spend | Operator gate |
|---|---|---|---|
| 0 | Write this spec and the ledger. | $0 | approve the spec and rule on the section 12 items |
| 1 | Build the passport stage (tensor profile mechanism, m03 graph and pins, parity test for it), dry-run it, then run it live: 12 seeds on one L40S pod. | ≤ $2.00 ceiling (≈ 30 min readiness + 12 short jobs at $1.30/h) | approve the T2 card; pick the passport; creator-003 is created from it |
| 2 | Build the dataset stage with the age hold and the trait axes, including the train and tester reversion that consumes it (DOP off, no trigger, their tester prompt form). Calibrate the axes on creator-001's ruled boards. Dry-run only. | $0 | supply the body photo; set the axis thresholds and the age floor |
| 3 | Build the edit stage (m07 graph, pins, parity test). Dry-run only. | $0 | review the dry-run plan and the image-slot mapping |
| 4 | Build the video stage (m08 graph, pins, mp4 upload and download fix, parity test). Dry-run only. | $0 | supply one driving clip |
| 5 | Build photo-to-prompt intake and the m09 stills stage (FaceDetailer, style LoRAs, NMKD, close-up rule). Dry-run only. | $0 | supply scene photos; approve the generated prompts |
| 6 | Run once end to end, live: a dependency smoke per stage, then dataset → captions → train → tester → stills → edit → video, stopping at each eye gate. | est. $10–14 (dataset ≈ $2.5, captions $0.15, train ≈ $4.8, tester ≈ $1.2, stills ≈ $1.5, edit ≈ $0.8, video ≈ $1.5) | raise the arc cap first; approve each T2 card; all eye gates |

Phases 2–5 do not spend, so a failed build cannot burn cap. All major spend waits for one
end-to-end run the operator funds explicitly.

## 11. Out of scope

- Any NSFW or explicit tier, including the clothing-removal branch, the NSFW merge checkpoint, and the slider, anatomy and explicit-style LoRAs saved in module 03, 07, 09 and 10 graphs. The "more explicit prompts" the module 10 lesson mentions are also excluded. These are present in the package and out of scope for this spec.
- Module 15 (growth). Its detection-evasion tactics are contract T4 "never".
- The legacy modules 12, 13 and 14 (Higgsfield, ChatGPT and Kling services), and the ChatGPT start-frame option in module 08.
- Video interpolation and upscaling. The module 08 transcript mentions them but ships no graph.
- Operator-owned GPU host design, beyond the address setting.
- Resolving the klein 9B licence.
- Any re-run of creator-001.
- Posting.

## 12. Rulings owed and unknowns

**Rulings owed by the operator**
1. **Cap.** Raise `ARC_CAP_USD` for phase 6 (about $10–14 against about $5.7 remaining). Separately, `orgs/figment/_index.md` still says "$50 hard cap" while STATE records $60. GOAL.md is not present in this worktree; check it on `ops`.
2. **Age floor value and hold semantics.** GUARDRAILS #2 says "cull anything ambiguous", and TENSOR-REPLICATION's grading protocol culls under-twenty faces outright. Decision 7 lets the operator release a held image. Confirm that a release means the operator judged the image unambiguously adult by eye, and set the floor (precedent: 20).
3. **Age term.** Decision 6 adopts "youthful young woman" (m10) and "young woman" (m03, m09, m11). D13 recorded this wording as a GUARDRAILS #2 defect. The age hold is the mitigation. Confirm that GUARDRAILS needs no amendment.
4. **Pickle hatch as the default path.** The hatch flag is named `diagnostic_non_commercial`. Confirm using it for tensor manifests, or approve renaming it as a blocking fix.
5. **Provenance.** `realistic_snapshot_lora`, `zit_upscaler`, `bfs_head_v5`, `RealisticSnapshotKrea2`, `pawg_krea2` and the NMKD `.pt` come from an anonymous account with no licence (r20, r25). Decision 3 reinstates them. `pawg_krea2` is a body-shape LoRA whose effect on the clothed register is unaudited.
6. **Licence.** FLUX.2 klein 9B (dataset refine and edit) is non-commercial. It is usable for build and test, and must be resolved before any monetised output.
7. **P3.** Passport detailers at 0.23/0.23 (the spoken instruction) versus the saved 0.4/0.27.
8. **Phase mapping.** The approved phase list does not name train/tester or stills. This spec folds the train/tester reversion into phase 2 and stills into phase 5.
9. **Trait-axis thresholds**, after the phase 2 calibration.

**Unknowns (not verifiable from the package files)**
- **Module 11 settings.** rank, LR, optimizer, buckets, quantization, caption dropout, and the caption instruction string are absent from the package text. They come from r15b's reading of video frames, and the videos are not in the snapshot. Resolves by re-reading the lesson video or accepting the toolkit defaults.
- **Module 03** has no transcript. Its settings come from the graph and the copy block only.
- **`zit_upscaler` scale factor.** No package file states it. Resolves by reading the safetensors header at pin time; it sets the passport's final resolution.
- **`lumina2` vs `flux2`** for the klein 9B encoder in module 10. Resolves in the phase 6 smoke.
- **Module 07 image order.** The node titles ("ref img" = node 76 = first reference; "input img" = node 169 = second) conflict with the head-swap prompt's "image 1 = base". The spec assumes link order is authoritative. Resolves with a phase 3 dry run plus the first live edit.
- **Module 08 custom node.** The pack the transcript installs through the manager is unnamed. We do not know whether ComfyUI `v0.20.1` (our pin) provides `WanSCAILToVideo`, `SCAIL2ColoredMask` and `ResizeImageMaskNode`. Resolves with `/object_info` in the phase 6 smoke; a newer `git_ref` may be needed.
- **Harness mp4 handling.** Whether the harness can fetch an mp4 from `/view` is unverified. The upload side needs the fix noted in section 8.
- **Image-to-prompt internals.** The external tool is closed. Our local equivalent (row I1) cannot be proven identical.
- **AIO merge contents.** What the out-of-scope checkpoint adds over module 04's stack (row R1) is unknown.
- **L40S training time** for 3000 steps at full buckets. The estimate extrapolates 3.85 s/step from the smoke.
