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

**Update (2026-09-03):** faster-whisper transcripts for all four module folders now exist
(`transcript.txt` beside each `lesson.mp4`), independent of the video-vision MCP path above. They
have been checked claim-by-claim against this report — see "From the narration" and "Claim-check"
sections below. Spoken values win over inferred/UI-only ones per the checking brief; several
settings-table rows were corrected as a result, most notably module 05's GPU and step count.

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
| EMA / regularization toggles | Use EMA / Unload TE / Differential Output Preservation / Blank Prompt Preservation / Contrastive Guidance Loss off; **Cache Text Embeddings ON** — spoken twice, once inline ("just toggle the cache text embeddings," 4:01) and again in the closing recap ("choose your model, put this to 15, then select cache text embeddings, and disable sampling — that's all you have to do," 4:30–4:39). **Correction:** the original UI-only read had this toggle in the "all off" group; audio wins. | 4:01, 4:30–4:39 (audio) | UI + audio — corrected |
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
| Target type / Linear rank | LoRA / **16** (half of module 11's 32) | 1:55; confirmed 1:56 audio ("linear rank to 16") | UI + audio |
| Quantization (transformer / text encoder) | **none / none** — explicitly spoken ("put transformer and text encoder quantization to none," 1:53), vs. module 11's qfloat8/qfloat8. Missing from the original table. | 1:53 | audio |
| Save data type | **FP32** — spoken ("for the data type change it to FP32," 1:59), vs. module 11's BF16. Missing from the original table. | 1:59 | audio |
| Optimizer / LR / weight decay | AdamW8Bit / **0.00025** (2.5× module 11's) / 0.0001 | 2:01; LR confirmed 2:02 audio ("learning rate change it to 0.00025") | UI + audio |
| Timestep type / bias | Weighted / Balanced | 1:48–2:01 | UI |
| Steps | **Correction — spoken value is 5000, not a typo.** The original read treated an on-screen "5000" as a mid-edit slip auto-resolved to the completed job's "3000/3000" log. Audio says otherwise, deliberately and unambiguously: "Then put the steps to 5000" (2:07). Module 06's transcript then independently confirms this was the *intended* value, not an error: "I trained these LoRa's to 3000 steps but in my tutorial I'm saying 5000 steps, so this is why my numbers are different — but the **5000 step training gives better results**" (4:26–4:40, `06_generating_images/transcript.txt`). Read together: the operator taught 5000 as the recommended step count, but the specific run captured on screen for this lesson only completed 3000 (a cheaper/faster demo run) — both numbers are real, they are not the same run, and 5000 is the better-results recommendation, not a typo. | 2:07 (audio) vs. 2:48 (UI job log, this run) / cross-confirmed 4:26–4:40 in 06's audio | audio wins — corrected |
| Resolution buckets | **512 only** — single-resolution training, no 768/1024 buckets; confirmed by audio ("untick 768 and 1024 resolutions, only 512" — transcript renders these as "7,6,8 and 10,24" / "5,12", a whisper number-parsing artefact) | 2:08–2:15; audio 2:09–2:14 | UI + audio |
| Save every / max saves to keep | 250 / **4** (kept at default — NOT bumped, so older checkpoints get pruned) | 3:27 (m11 default) / job log | UI + log |
| Sample: sampler / guidance / steps | FlowMatch / **1** / **8** | 2:15 | UI |
| Sample prompts | **Conflict — spoken instruction differs from what's on screen.** Audio: "for the sample section just remove everything but two samples and put in whatever you want, it doesn't really matter" (2:14–2:22) — i.e. cut to **2** arbitrary prompts. On-screen (original read): 3 generic Ostris toolkit defaults kept as-is. Both recorded; the spoken instruction is the taught procedure, the UI capture may reflect a different pass. | 2:14–2:22 (audio) vs. 2:15 (UI) | audio + UI — conflict, both recorded |
| Training GPU | **Correction — WRONG in the original table.** Audio: "go with an **L40S**" (0:17–0:18), not an A100. No A100 is mentioned anywhere in this lesson's transcript. Strike "NVIDIA A100 80GB PCIe + AMD EPYC 7763"; the taught GPU tier is an **L40S**, still cheaper/more available than module 11's Blackwell Pro 6000. | 0:17–0:18 (audio) | audio — corrected, was WRONG |
| Volume disk | **250GB** — spoken, missing from the original table ("increase this volume to 250GB and deploy," 0:29–0:36) | 0:29–0:36 | audio |
| Training time estimate (spoken) | **"gonna take like 40 minutes, maybe quicker if you got a faster GPU"** — missing from the original table; no iter/sec or duration was captured from audio for the specific completed run cited in "Result" below (that figure remains UI-only) | 2:30–2:34 | audio |
| Result | completed 3000/3000 steps at **1.20 iter/sec**, final loss **≈3.113e-01**; log shows old checkpoints (1500, 1750) actively pruned as newer ones save, leaving only the last 4 + final | 2:48 | UI (job console log) |
| Ranking step | **Correction — not "none".** There is no dedicated dataset-tester harness in this module, but a real manual ranking step happens one module later: `06_generating_images/transcript.txt` shows the operator loading all 5 saved checkpoints (normal/final, 2000, 2250, 2500, 2750 steps), running each on a fixed seed with everything else disabled, and picking a winner by eye — "we don't know which one is gonna render us the best results... 2250, I like it... this is probably the best LoRa" (2:34–4:25). Reclassify as: informal cross-checkpoint comparison in the following lesson, not a formal harness, not absent. | 2:34–4:25, `06_generating_images/transcript.txt` (audio) | audio — corrected |

**Maps onto our stack:** this is a useful low-cost baseline recipe (rank 16, single resolution,
A100 tier, no ranking step) — a fallback config for quick iteration before committing to the
full multi-checkpoint-ranked run from module 11. **Does not map:** Z-Image Turbo + training-adapter
architecture is package-specific tooling with no direct analogue; the concept (a distilled turbo
base needing a separate small adapter to train against) is the transferable idea.

**Evidence honesty:** no audio; steps field showed "5000" mid-typing before settling at 3000 — flagged
as a possible operator typo/correction rather than a real value, resolved against the completed job's
"Step 3000 of 3000" log.

---

## From the narration (faster-whisper, 2026-09-03)

Spoken content the original UI/JSON-only pass missed or under-recorded, by module. Timecodes are
from each module's `transcript.txt` (mm:ss, converted from the file's seconds).

**Module 11 (`11_lora_training_krea`)**
- **Warning: do not use the turbo model with the training adapter for this path.** "For the model
  we're gonna use Krea 2 raw — do not use the turbo with the training adapter, don't do it, because
  the results are way worse. So choose the raw." (3:30–3:41)
- **Why disable sampling — real time saved.** "This drastically improves the training time — like
  normally it takes over two hours, but if we disable the samples we can cut it down to like 70 to
  80 minutes." (4:15–4:30)
- **Actual training time for this run: 1 hour 17 minutes**, "pretty decent" per the operator.
  (4:50–5:02)
- **Captioning time on a Pro 6000: about 2 minutes.** (2:35–2:40)
- **Old single-word "woman" captioning is explicitly retired**: "I used to have like a [caption
  method] that put the caption 'woman' on every one of the images — that's no longer necessary."
  (2:11–2:18) — direct spoken confirmation that module 11's Qwen3-VL captioner supersedes module
  04/05's single-word approach.
- **Winning checkpoint for this demo run: step 1250**, picked by eye across all 12 saved
  checkpoints in the dataset-tester grid ("this is 1250, this is good, so we're just gonna go with
  1250," 10:08–10:12).
- **Identity LoRA strength was tuned live at inference**, separate from the fixed style-LoRA
  strengths already in the table: tried 1.2 ("way more consistent"), then reduced back toward 1.0
  because "the plastic skin texture from our dataset bleeds through into our regular image" at
  higher strength (11:38–12:04). The plastic-skin artefact is called out twice as a known limitation
  of the small demo dataset, not the method.
- Results disclaimer up front: this LoRA isn't "exceptionally good" because it's trained on the
  small demo dataset from module 10, not a custom one — "if you can use your own dataset, use it."
  (0:13–0:31)

**Module 10 (`10_dataset_generator_v2`)**
- **Prompt-matching rule (missed procedural claim):** the stock face/body prompts ship with
  mismatched attributes (e.g. "black hair and blonde highlights" for a blonde subject) — "it's just
  important that you match the prompts to your input images." (3:59–4:21)
- **Curation step is missing from the report entirely.** Not every generated image is usable —
  "this makes no sense, if we train this it's gonna show this kind of behavior, we obviously don't
  want that, so we're gonna remove that from the dataset." (4:45–4:57)
- **ComfyUI download bug**: outputs can only be downloaded in **batches of 10**, not all at once —
  "you cannot download them all at once, it's like some stupid ComfyUI bug." (5:40–5:48)
- RunPod template download size: **~44GB**. (0:45–0:52)

**Module 04 (`04_generating_a_dataset`)**
- **Local VRAM minimum: 16GB** — "you're gonna need a good GPU, like at least 16 gigabytes,
  anything under, don't bother." (1:46–1:53)
- Same **10-image download batch limit** as module 10, independently restated: "you cannot download
  all of these 40 images at once for some reason, so you're gonna have to do it in batches of 10."
  (3:33–3:44)
- Single-word "woman" captioning confirmed verbatim, with the operator's own rationale: "they all
  have the same single word, just 'woman,' but trust me it's better this way." (4:22–4:33) — module
  11 later calls this same approach "no longer necessary"; not a contradiction, an explicit
  supersession.

**Module 05 (`05_training_a_lora`) — see corrected settings-table rows above for the GPU, step-count,
quantization, data-type and sample-prompt corrections. Additional narration-only points:**
- **Single-word captioning rationale, stated more fully than in module 04**: "we don't want a LoRA
  that is very precise for prompting... we're not gonna prompt too much because we make it very hard
  to get the right results... this way we make it not lean so much towards certain prompts and
  structures." (1:20–1:35)
- In-training sample grid is described as genuinely informative here: "you can really see how the
  model forms — at the beginning she doesn't look like a girl at all, and once we scroll down she
  really starts to resemble her." (2:36–2:49)

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
10. GPU tiering: they deliberately run cheap baseline experiments on L40S/A100-class hardware and only
    pay for RTX PRO 6000 Blackwell (96GB) once a recipe is locked — worth mirroring as a cost gate.
    (Module 05's baseline GPU corrected to L40S below — text above already said "cheaper tier," the
    specific GPU name was wrong.)

## Claim-check (2026-09-03, sonnet)

Checked all 51 pre-existing settings-table rows across modules 11, 10, 04, 05 against faster-whisper
transcripts (`transcript.txt` beside each `lesson.mp4`), reconciling against the sibling JSON/`.bat`
files where transcript and JSON disagreed. 4 new rows added to module 05's table (quantization,
save data type, volume disk, training-time estimate) are spoken facts absent from the original
table and are counted separately, in "narration-only additions" below, not in this verdict table.

| Module | Rows checked | VERIFIED | PARTLY | WRONG | UNVERIFIED |
|---|---|---|---|---|---|
| 11 — lora_training_krea | 23 | 21 | 1 | 1 | 0 |
| 10 — dataset_generator_v2 | 8 | 8 | 0 | 0 | 0 |
| 04 — generating_a_dataset | 8 | 8 | 0 | 0 | 0 |
| 05 — training_a_lora | 12 | 8 | 0 | 4 | 0 |
| **Total** | **51** | **45** | **1** | **5** | **0** |

**The 5 WRONG rows, all corrected in place above:**
1. Module 11 — "Cache Text Embeddings" was listed as off; spoken instruction (twice) turns it on.
2. Module 05 — training GPU was listed as an A100 80GB; spoken instruction is an L40S.
3. Module 05 — step count "5000" was dismissed as a mid-edit typo resolved to 3000; audio (cross-
   confirmed independently in module 06) shows 5000 was the deliberate taught value, and the
   completed 3000-step run was a separate, cheaper demo pass.
4. Module 05 — sample prompts were read as "3 generic defaults kept as-is"; spoken instruction says
   to cut to 2, contents arbitrary. Both values recorded as a conflict.
5. Module 05 — "no ranking step" is corrected: an informal 5-checkpoint visual ranking happens in the
   next lesson (`06_generating_images`), just not as a formal harness like module 11's.

**17 narration-only additions** (spoken settings/rules absent from the report entirely, none of them
contradicting anything already there) were folded into the new "From the narration" section above —
8 for module 11 (turbo+training-adapter warning, sampling-disabled time saving 2hr→70–80min, actual
training time 1h17m, winning checkpoint 1250, captioning duration ~2min, old single-word-caption
retirement quote, live LoRA-strength tuning + plastic-skin caveat, the results disclaimer), 4 for
module 10 (prompt-matching rule, dataset curation/culling step, the 10-image ComfyUI download-batch
bug, ~44GB template size), 3 for module 04 (16GB local VRAM floor, the same 10-image download-batch
bug independently restated, the single-word-captioning rationale quote), and 2 for module 05
(fuller single-word-captioning rationale, the in-training sample-grid narrative) — plus the 4 new
settings-table rows on module 05 counted separately above (quantization=none, data-type=FP32,
volume-disk=250GB, ~40-minute training-time estimate).
