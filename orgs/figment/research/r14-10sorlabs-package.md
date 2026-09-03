# r14 — 10sorLabs AI Suite (purchased package) — module map

Source: https://webpanel.10sorlabs.com/ ("10sorLabs AI Suite"), operator's account, read-only in
his live Chrome. Read 2026-09-03. Licensed course content: this file is **notes and derived
structure only** — no verbatim redistribution of lesson video content or the 38-prompt library.
Prompts are described structurally; only the short operator-facing template blocks the panel
itself exposes as "copy blocks" are quoted where the exact wording is the artefact.

Panel structure: a single-page app. All lesson metadata ships in one inline `const MODULES = [...]`
array (19 entries: 1 landing page, 1 hidden intro, 17 numbered modules). Each entry carries
`title`, `description`, `duration`, `chapters` (timecoded), `links`, `downloads`
(`/download/<module>/<n>`), `copy_blocks`, `notes`. Every teaching lesson is **video-only** —
there are no written lesson bodies, no transcripts, and no captions in the DOM. The chapter
lists below are therefore the highest-resolution content signal available without watching.

---

## 0. Landing / bonus

| id | title | type |
|---|---|---|
| `discover` | Discover | landing page, `page_type: landing`, public |
| `00_start` | "The map is not the territory." | hidden bonus video, YouTube id `k0qmkQGqpM8` |

`discover` sells two 10sorLabs side products (both public, no login):
- **img2prompt** — Chrome extension, €5/month. "Paste a reference image and get a structured,
  editable prompt for ComfyUI or any other AI workflow." https://10sorlabs.com/pages/img2prompt
- **RapidCache** — €8.99/month, "Built for RunPod". Pre-baked model cache claiming "up to 20×"
  faster pod setup. https://10sorlabs.com/pages/rapidcache

---

## Module map

### 00 — Welcome · 01:58 · video-only
Orientation: what the toolkit contains and the intended order through the modules.
Artefacts: none. Links: none. Chapters: none.

### 01 — How to install ComfyUI · 01:23 · video-only
Install ComfyUI locally before the workflow lessons.
Chapters: 0s Intro · 11s Downloading ComfyUI.
Links: ComfyUI — https://comfy.org (official desktop/installer site).
Artefacts: none downloadable.

### 02 — ComfyUI Basics · 17:56 · video-only · **the conceptual spine**
Core ComfyUI mental model: the three model types, prompting, KSampler, LoRAs, model install
paths, and the two errors that break every workflow (missing models, missing custom nodes).
Chapters: 0s Intro · 16s Cooking analogy · 27s **The 3 main models** · 40s Prompts ·
132s What is a KSampler · 214s Using models · 251s Real-time generation preview ·
290s What (Stable) Diffusion really is · **312s KSampler settings** · 591s What is a LoRA ·
663s Applications of LoRA · **821s Stacking (multiple) LoRAs** · 861s How to install models ·
919s Common errors: Missing models · 1034s Common errors: Missing custom nodes.
Links: RunPod referral $5 credit — https://runpod.io?ref=xpje72wd · CivitAI (LoRAs and models) —
https://civitai.com/ · Hugging Face (official model repos) — https://huggingface.co/.
Note: concrete KSampler numeric values live only in the 312s–591s video segment; not in page text.

### 03 — Generating your character · 05:12 · video-only
Produce the "character passport" image — one clean front-facing studio portrait that becomes the
identity source for everything downstream. This is 10sorLabs' equivalent of our **anchor** stage,
except they *generate* the anchor instead of receiving it.
Chapters: 0s Intro · 15s RunPod setup · 57s Local setup · 102s Finding your ComfyUI directory ·
147s Installing the models · 232s Using the workflow.
Links: **Launch Workflow (RunPod)** — https://console.runpod.io/deploy?template=paqyqvi7d0&ref=xpje72wd
(a pre-built RunPod template; deploying it costs money — not deployed).
Downloads (not fetched): `Model installer (.bat)` `/download/03_generating_your_character/0`;
`Image generator workflow` (ComfyUI workflow JSON) `/download/03_generating_your_character/1`.
**UNVERIFIED — the `.bat` model installer is an unexamined Windows batch script that pulls model
weights from unknown hosts. Not downloaded, not run. Same flag applies to every `.bat` below.**

Copy block — **"Passport photo prompt"** (the one artefact worth lifting structurally). Its shape,
in order, is: [1] format + subject + hair (braced slot) · [2] pose and camera-facing discipline
("perfectly front-facing upper body and shoulders", "only a very subtle natural neck tilt") ·
[3] face inventory (eye colour slot, lashes, brows, nose, cheekbones, lips, jawline) ·
[4] **a skin-realism clause** — "visible pores, fine vellus hairs, realistic skin texture, subtle
natural translucency, soft complexion variations, and a healthy luminous glow without appearing
overly retouched" · [5] figure · [6] wardrobe with fabric-texture detail (grey heather crewneck) ·
[7] environment (seamless plain white studio) · [8] lighting (soft even diffused studio) ·
[9] **a camera clause** — "Shot on iPhone 15 Pro, handheld portrait perspective, camera directly
in front at eye level, 24mm equivalent, f/1.8, ... **zero film grain**" · [10] a quality tail
("8k, max details, ultra fine details, smooth realistic skin, cinematic lighting").
Braced slots are `{hair}` and `{eye colour}` only — everything else is fixed.
Note the internal tension our stage 5 resolves the other way: the prompt asks for pores **and**
"smooth realistic skin" + "zero film grain".

### 04 — Generating a dataset · 05:11 · video-only
Fan the passport image out into a LoRA training set, then prepare it (crop/caption/foldering).
Chapters: 0s Intro · 21s RunPod setup · 104s Local setup · 184s Using the workflow ·
**247s Preparing the dataset** (the dataset-prep rules live in this 60s segment, video-only).
Links: RunPod dataset template — https://console.runpod.io/deploy?template=j324v7d7ha&ref=xpje72wd
Downloads (not fetched): `Dataset workflow` (JSON) `/download/04_generating_a_dataset/0`;
`Dataset model installer (.bat)` `/1` — **UNVERIFIED**; `LoRA trainer folder` `/2` (an archive
containing a trainer config layout).

### 05 — Training a LoRA · 03:08 · video-only
Run the training job on RunPod against the module-04 dataset and pull the LoRA back.
Chapters: 0s Intro · 8s RunPod setup · 56s Uploading dataset · 100s Creating training job ·
142s Starting training · 157s Sample images · 169s Downloading the LoRA.
Links: RunPod referral — https://runpod.io?ref=xpje72wd
Artefacts: none downloadable. No hyperparameters exposed in page text (superseded by module 11).

### 06 — Generating images · 08:31 · video-only
Load the trained LoRA into the generation workflow, compare LoRA checkpoints against each other,
write prompts, and repair a bad face.
Chapters: 0s Intro · 9s RunPod setup · 49s Importing LoRA (RunPod) · 101s Local setup ·
122s Importing LoRA (Local) · 153s Using the workflow · **215s Comparing the LoRAs** ·
**296s Writing prompts** · **472s Fixing rough face** (their face-detailer equivalent).
Links: RunPod referral · RunPod image workflow template (`paqyqvi7d0`, same as module 03) ·
img2prompt Chrome extension —
https://chromewebstore.google.com/detail/img2prompt/edehmemaekkbgmdmogfmlagbjpnpbnoh
Downloads (not fetched): `Image generation model installer (.bat)` — **UNVERIFIED**;
`Image generation workflow` (JSON).

### 07 — Editing images · 07:12 · video-only
Controlled edits to an existing image via a **Flux2Edit** workflow, keeping realism and identity.
Chapters: 0s Intro · 12s RunPod setup · 54s Local setup · **86s Huggingface token** ·
171s Importing workflow · **193s How to fix missing node** · 254s Using the workflow.
Links: RunPod image-edit template — https://console.runpod.io/deploy?template=2kwu0bijs6&ref=xpje72wd ·
**Agree Flux2 terms — https://huggingface.co/black-forest-labs/FLUX.2-klein-9B** (gated repo; the
lesson requires accepting the licence and supplying an HF token).
Downloads (not fetched): `Image edit model installer (.bat)` — **UNVERIFIED**; `Image edit workflow` (JSON).
Model of record here: **FLUX.2-klein-9B** (we chose klein **4B Base** for identity — different weight).

### 08 — Motion control · 06:46 · video-only
Image-to-video by transferring motion and composition from a driving reference video onto the
persona, and the rules for which driving clips work.
Chapters: 0s Intro · 15s RunPod setup · 93s Local setup · 184s Using the workflow ·
**196s Good vs. bad videos** · **268s The importance of the starting frame**.
Links: RunPod motion-control template — https://console.runpod.io/deploy?template=fxqm1pdcbs&ref=xpje72wd
Downloads (not fetched): `Motion control model installer (.bat)` — **UNVERIFIED**;
`Motion control workflow` (JSON); `Frame extractor (.bat)` — **UNVERIFIED**.
Copy block — "ChatGPT replacement prompt", verbatim (it is a 1-sentence operator instruction):
> replace the girl from the first image with the girl from the second image. keep everything
> consistent except for the subject. same lighting. same angle, same pose, same setting,
> everything is the same, except for the girl.
Doctrine in one line: **the start frame is the whole ballgame** — build the first frame by
identity-swapping the persona into a frame taken from the driving video, then animate.

### 09 — Generating images (KREA2) · 06:32 · video-only
The current-generation image workflow, on a **KREA2** base, plus an upscaler stage.
Chapters: 0s Intro · 11s RunPod setup · **64s How to fix node errors** · 136s Local setup ·
175s Using the workflow · **252s Upscaler explained**.
Links: RunPod referral · **RunPod AI1 (All-in-1) template** —
https://console.runpod.io/deploy?template=1xpt9ep344&ref=xpje72wd (the template modules 09–11 share) ·
img2prompt extension.
Downloads (not fetched): `KREA2 generation model installer (.bat)` — **UNVERIFIED**;
`KREA2 Image workflow` (JSON).

### 10 — Dataset generator 2.0 · 06:20 · video-only
The replacement for module 04: a single workflow that produces the whole training set.
Chapters: 0s Intro · 12s RunPod setup · **83s Fix missing nodes** · 108s Local setup ·
**147s Huggingface token** · 207s Using the workflow · 314s Downloading the results.
Links: RunPod referral · RunPod AI1 template (`1xpt9ep344`) · img2prompt extension.
Downloads (not fetched): `KREA2 generation model installer (.bat)` — **UNVERIFIED**;
`Dataset generator 2.0 workflow` (JSON).

### 11 — Training a LoRA (Krea2) · 12:44 · video-only · **the longest and densest lesson**
The current training path, end to end: **Ostris AI Toolkit** as the trainer, dataset load,
captioning, HF token, training configuration, then a **checkpoint-selection protocol** — train
multiple LoRA checkpoints, import them all, test them against a fixed prompt set, and pick the best.
Chapters: 0s Intro · 38s RunPod setup · **67s Ostris AI Toolkit** · 80s Loading the dataset ·
**130s Captioning the dataset** · 163s Huggingface token · **203s Training configuration** ·
290s Downloading the LoRAs · 330s Creating a LoRA repo · 370s Testing the LoRAs ·
413s Importing the LoRAs · **490s Finding the best LoRA** · 614s Using the LoRAs to generate images.
Links: RunPod referral · RunPod AI1 template (`1xpt9ep344`) · img2prompt extension.
Downloads (not fetched): `KREA2 generation model installer (.bat)` — **UNVERIFIED**;
`Dataset tester workflow` (JSON) — the fixed-prompt harness used to rank checkpoints.
The numeric training config (rank, LR, steps, batch, resolution) is **spoken only**, in the
203s–290s segment. It is not in any page text.

### 12 — Creating Your Model (Legacy) · 02:22 · video-only
`notes`: "Legacy module. This lesson is kept as bonus content from the earlier toolkit structure."
The pre-ComfyUI identity path: write a slot-filled identity prompt, expand it with ChatGPT,
generate a reference portrait and **12 angles**, then register the result as a Higgsfield character.
Chapters: 0s Intro · 20s Writing the identity prompt · 40s Replacing all tags in prompt (ChatGPT) ·
61s Generating reference pic · **84s Generating 12 angles** · 94s Creating the character in
Higgsfield · 119s Using the character.
Links: Higgsfield — Nano Banana Pro — https://higgsfield.ai/image/nano_banana_2 (paid SaaS) ·
Custom GPT "carousel-prompter" —
https://chatgpt.com/g/g-69c016cb2abc8191be603c7b8eae2ba7-carousel-prompter
Copy block — **"Model Identity Prompt"**: a two-part template. Part 1 is six slots the operator
fills (`ETHNICITY`, `SKIN TONE`, `HAIR COLOR`, `HAIR STYLE`, `HAIR LENGTH`, `EYE COLOR`). Part 2 is
a **structured JSON prompt schema** the model is told to emit exactly, with these top-level keys:
`observed` (`scene_type`, `environment`, `background_elements[]`, `subject{pose, expression,
facial_features{skin,eyes,eyebrows,lips,nose}}`, `identity{ethnicity,skin_tone}`, `hair{color,style}`,
`clothing{top}`, `lighting{type,direction,quality,color_temperature,highlights}`,
`camera{angle,framing,focus,depth_of_field,lens_characteristics}`, `color_palette[]`,
`image_quality{resolution,sharpness,noise,post_processing}`, `mood`), `inferred`
(`camera_device`, `focal_length_equivalent` 24–28mm, `aperture_equivalent` f/1.8–f/2.2, `iso` 50–100,
`shutter_speed` ≥1/200, `white_balance`, `editing_style`, `time_of_day`), `generation_prompt`
(the flattened render instruction plus an **`avoid[]` negative list**: background clutter, harsh
shadows, overexposed whites, unnatural skin tones, industrial elements), and `variants[]`
(named deltas — `cooler_studio`, `ultra_soft`).
The `image_quality.post_processing` default is **"light beauty enhancement, subtle skin smoothing"** —
this is the "skin enhancer" default the MANDATE says we turn off.

### 13 — Generating Content (Legacy) · 04:12 · video-only · `tag: generate`
`notes`: "Legacy module... If Higgsfield doesn't render 2x2 pic grids, don't forget to explicitly
mention it with the '2x2 pic grid' keyword at the top."
Volume content generation: find a reference photo, extract its prompt, generate **four images at
once as a 2×2 grid**, then slice the grid into four files.
Chapters: 0s Intro · 53s Finding a reference pic · 72s Getting the prompt ·
**97s Generating 4 images at once** · **178s Slicing the pic grid into 4**.
Links: Higgsfield — Nano Banana Pro · Custom GPT carousel-prompter (same two as module 12).
Downloads (not fetched): `Image Toolkit` `/download/13_generating_content/0` (the grid slicer).

### 14 — Motion Control (Legacy) · 03:21 · video-only
`notes`: "Legacy module..." The SaaS video path — **Kling 3.0** motion control.
Chapters: 0s Intro · **8s Getting a good reference** · 46s Generating a start image ·
65s Generating the video · 81s Result 1 · 100s Generating another video · 144s Result 2 ·
**151s How to get good results**.
Links: Kling AI — https://klingai.com (paid).
Copy block — "Character replace prompt": same first-frame swap pattern as module 08, but with the
persona's attributes restated inline as slots (`{hair length}`, `{hair style}`, `{hair color}`,
`{eye color}`, plus "long and dark" lashes) and an explicit "keep the background and lighting the
same. only change the subject."

### 15 — Social Media Growth SOPs · no video · `tag: growth`
Description: "How to realise systematic growth on TikTok en Instagram with AI-generated
Influencers/Models." The module body is **two downloadable SOP documents and nothing else**:
`Tiktok Growth SOP` `/download/15_growth/0` and `Instagram Growth SOP` `/download/15_growth/1`.
**Contents not read** — see Evidence honesty. This is the only posting/growth playbook in the
package, and it is entirely behind those two files.

### 16 — Prompt Guide · no video
Description: "With 2 highly detailed prompting guides and 36 real prompt examples, this module
serves as a report full of valuable prompt techniques and information."
Two parts:
1. **Two PDF guides** (downloads, not fetched by me): `Nano Banana Photorealistic Visuals`
   `/download/16_prompts/0` and `Z-Image Turbo Prompt Guide` `/download/16_prompts/1`.
2. **An in-page prompt grid**: `prompt_grid_count: 38`, `prompt_grid_version: 2026-06-30`, served
   as image + text pairs from `/prompt-assets/16_prompts/<n>.txt` (and matching images), each with
   a `[copy]` button. Read read-only; **not reproduced here**.
Links: img2prompt Chrome extension.

**Structure of the 38 prompt examples** (sampled 1, 5, 19, 38 — 1.5k–3.1k characters each, all
single-block natural-language English, no weights, no negative prompt, no `((emphasis))` syntax):
- Opening clause always fixes **format + candour register** — "Candid outdoor winter lifestyle
  photo of…", "Candid close-up social media selfie of…", "Full-body vertical photograph of…",
  "A high-quality Instagram-style smartphone portrait captures…".
- Then, in a stable order: subject + hair → face/makeup (lashes, brows, lips are always named) →
  **a skin-realism clause** ("visible pores, subtle texture variations, natural micro-wrinkles,
  tiny imperfections, true-to-life skin tone…"; one prompt writes "healthy natural skin (NOT oily)")
  → figure → wardrobe with material detail → environment → camera position and distance →
  pose and gaze → expression → lighting.
- Camera framing is stated as a *relationship*, not a lens spec: "photographed from behind at
  full-body distance", "looking back towards the viewer over her shoulder".
- Register is explicitly thirst-trap ("seductive and playful expression", "thirst trap" used as a
  literal prompt token in #19). Wardrobe ceiling in the sample is bikini/crop-top — Instagram tier.
- Anti-gloss language appears in the prompt body rather than in a negative prompt or a later pass.

---

## Cross-cutting artefact inventory

**Workflow JSONs referenced (7):** image generator (03), dataset (04), image generation (06),
image edit / Flux2Edit (07), motion control (08), KREA2 image (09), dataset generator 2.0 (10),
dataset tester (11). All behind `/download/<module>/<n>` — **none downloaded**.

**`.bat` installers referenced (7 distinct labels):** model installer (03), dataset model
installer (04), image generation model installer (06), image edit model installer (07),
motion control model installer + frame extractor (08), KREA2 generation model installer (09/10/11).
**All UNVERIFIED — unexamined Windows batch scripts that fetch weights from unnamed hosts.
Not downloaded, not run. If any of these is ever opened it must be read as text first and every
URL and package it references verified on its registry (the `npx eromify-mcp` lesson).**
No `npx`, `pip`, or `curl | bash` command string appears anywhere in the panel's own page text —
they would be *inside* the `.bat` files, which is exactly why the files are flagged.

**Models / systems named:** ComfyUI · KREA2 (current image base) · FLUX.2-klein-9B (image editing,
gated on HF) · Ostris AI Toolkit (LoRA trainer) · Higgsfield "Nano Banana Pro" (legacy identity,
SaaS) · Kling 3.0 (legacy video, SaaS) · CivitAI + Hugging Face as weight sources.

**External links, complete list (URL → what it is):**
| URL | What |
|---|---|
| https://comfy.org | ComfyUI official site (installer) — not run |
| https://runpod.io?ref=xpje72wd | RunPod signup, 10sorLabs **referral** link, "$5 free credit" |
| https://console.runpod.io/deploy?template=paqyqvi7d0&ref=xpje72wd | RunPod template: image gen (03, 06) |
| https://console.runpod.io/deploy?template=j324v7d7ha&ref=xpje72wd | RunPod template: dataset (04) |
| https://console.runpod.io/deploy?template=2kwu0bijs6&ref=xpje72wd | RunPod template: image edit (07) |
| https://console.runpod.io/deploy?template=fxqm1pdcbs&ref=xpje72wd | RunPod template: motion control (08) |
| https://console.runpod.io/deploy?template=1xpt9ep344&ref=xpje72wd | RunPod template: AI1 all-in-one (09, 10, 11) |
| https://civitai.com/ | LoRA/model source |
| https://huggingface.co/ | Official model repos |
| https://huggingface.co/black-forest-labs/FLUX.2-klein-9B | Gated FLUX.2 klein 9B; licence acceptance + HF token required |
| https://chromewebstore.google.com/detail/img2prompt/edehmemaekkbgmdmogfmlagbjpnpbnoh | img2prompt Chrome extension (€5/mo) — **not installed** |
| https://higgsfield.ai/image/nano_banana_2 | Higgsfield Nano Banana Pro, paid SaaS (legacy modules) |
| https://chatgpt.com/g/g-69c016cb2abc8191be603c7b8eae2ba7-carousel-prompter | Custom GPT "carousel-prompter" |
| https://klingai.com | Kling AI, paid SaaS video (legacy module 14) |
| https://10sorlabs.com/pages/img2prompt | img2prompt product page |
| https://10sorlabs.com/pages/rapidcache | RapidCache product page (€8.99/mo RunPod cache) |
| https://discord.gg/9BCJrr4vNG | 10sorLabs Discord — **not joined** |
| YouTube `k0qmkQGqpM8` | Hidden bonus video "The map is not the territory." — not opened |

No money was spent, no template deployed, no file downloaded, no extension installed, no account
setting touched.

---

## Synthesis (≤15 lines)

1. Maps onto MANDATE 1–3: modules 03 (passport anchor) → 10 (dataset generator 2.0) → 11 (Ostris training + checkpoint ranking) are a complete, current anchor→dataset→LoRA chain, one lesson per stage.
2. Maps onto stage 5: module 09 is base render + upscaler; module 06 @472s "Fixing rough face" is their face-detailer; module 07 (Flux2Edit) is a targeted-edit pass we have no equivalent of.
3. Maps onto stage 6: module 08 is the self-hosted I2V motion-control path; module 14 is the SaaS (Kling) path — both reduce to the same doctrine, that the start frame decides the video.
4. Maps onto stage 8: module 15 is the only posting/growth material (two SOP PDFs, TikTok + Instagram) — and it is exactly the part I could not open.
5. Nothing in the package touches stages 4 (register lock), 7 (continuous research), or 9 (optimise), and there is no analytics, scheduling, dashboard, or paid-platform content at all.
6. What it teaches that we lack #1 — **checkpoint ranking as a formal step**: train many LoRA checkpoints, run a fixed `Dataset tester` prompt harness across all of them, pick the winner (module 11, 370s–614s). We currently pick a LoRA, not the best of N.
7. What it teaches that we lack #2 — **motion-control I2V driven by a real reference clip**, with a stated good/bad-driver rubric and an identity-swapped first frame, rather than text-prompted motion.
8. What it teaches that we lack #3 — **a targeted image-edit workflow** (Flux2Edit) to fix a finished image in place instead of regenerating it, which changes the economics of "perfect or culled."
9. What it teaches that we lack #4 — **grid batching** (2×2 generate + slice, module 13) as a throughput trick for content volume, and a structured JSON prompt schema with an `avoid[]` list and named `variants[]` (module 12) that is close to a manifest format we could adopt directly.
10. What we deliberately do differently #1 — **skin**: their module-12 default is `post_processing: "light beauty enhancement, subtle skin smoothing"` and their passport prompt asks for "zero film grain". Our stage 5 de-gloss pass is the inverse; we keep their pore/vellus/micro-imperfection *language* and drop the smoothing and the grain suppression.
11. What we deliberately do differently #2 — **the anchor**: they generate the identity from a slot template; ours is operator-supplied and cull-checked, so module 03 is a prompt-structure reference, never an identity source.
12. What we deliberately do differently #3 — **hosting the explicit tier**: every path here routes through RunPod referral templates and paid SaaS (Higgsfield, Kling), which our tier constraint forbids for unclothed work; and every `.bat` installer stays unopened.
13. What we deliberately do differently #4 — **no per-pass QA**: the package has no consistency scoring, no identity check against the anchor, and no quarantine/regenerate loop. Ours is mandatory.
14. Read first, in order: **module 11 (Training a LoRA — Krea2)**, the densest and only current training lesson; **module 08 (Motion control)**, the whole video doctrine; **module 16 (Prompt Guide)**, the 38-example grid that shows the prompt shape their outputs actually come from.
15. Runner-up if a fourth is wanted: module 02 @312s (KSampler settings) and @821s (stacking LoRAs) — the only place sampler and multi-LoRA values are taught.

---

## Evidence honesty — what I could not open

- **Every teaching lesson is video-only.** There are no transcripts and no captions anywhere in the
  panel DOM; the lesson bodies are `<video>` streams behind `/video/<id>`. I did not watch or
  transcribe any video. Everything above about lesson *content* is derived from the title,
  description, and the timecoded chapter labels the panel ships as data.
- **Consequence: no numeric settings were recoverable.** KSampler steps/cfg/sampler/scheduler
  (module 02 @312s), LoRA training rank/LR/steps/batch/resolution (module 11 @203s), dataset-prep
  rules (module 04 @247s), captioning rules (module 11 @130s), and upscaler settings (module 09
  @252s) all exist only as spoken content. **If the build terminal needs any of these numbers,
  the operator must watch those specific chapters — they cannot be read.**
- **No file was downloaded**, per brief. That means the actual contents of: 8 ComfyUI workflow
  JSONs, 7 `.bat` model installers, the `LoRA trainer folder`, the `Image Toolkit` grid slicer,
  the **TikTok Growth SOP**, the **Instagram Growth SOP**, and the two module-16 PDFs
  (`Nano Banana Photorealistic Visuals`, `Z-Image Turbo Prompt Guide`) are all unread. The growth
  playbook rules the brief asked for are entirely inside the two module-15 SOPs.
- I attempted only one file: the operator had **already** downloaded
  `HOW TO CRAFT GOOD PROMPTS FOR Z-IMAGE-TURBO (2).pdf` to `C:\Users\danie\Downloads\` at 05:35
  today (it is the module-16 `/download/16_prompts/1` guide). No PDF tooling is installed on this
  machine (`pypdf`/`PyPDF2` absent, `pdftoppm` absent) and a raw stream extraction returned only
  subset-font gibberish, so **its contents remain unread**. It is on disk and readable by any
  session with a PDF reader — the fastest single win available.
- The 38 prompt examples were read in-page but are **not reproduced**, per the licence rule; only
  their structure is described, from a 4-of-38 sample (#1, #5, #19, #38).
- The hidden bonus video (`00_start`, YouTube `k0qmkQGqpM8`) was not opened.
- No RunPod template was deployed, no Discord joined, no extension installed, nothing purchased.
