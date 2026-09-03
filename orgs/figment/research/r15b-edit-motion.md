# r15b — 10sorLabs edit + motion modules (watched)

Source: purchased 10sorLabs package, local `.mp4` lessons (gitignored) under
`orgs/figment/research/10sorlabs-package/<module>/`. Watched via claude-video-vision
(`video_info` → `video_analyze` transcription/scene_changes → targeted `video_watch` at
r14's chapter timecodes). Licensed content: notes and derived settings only — no verbatim
transcript dumps beyond the short operator copy-blocks already in r14; the 4 licensed
pre-prompt bodies stay at r14's structural description (they're also on disk verbatim in the
sibling JSON, cited by node id, not retyped). Reconciliation rule: where JSON default and
spoken/on-screen value differ, both are recorded and flagged.

**Update (2026-09-03):** cross-checked modules 07 and 08 against the independent faster-whisper
`transcript.txt` files that now sit beside each `lesson.mp4` (a separate pass from the
claude-video-vision transcription used originally). The two agree closely — this report's original
audio-sourced rows all held up — with two additions folded in below: a "start low, refine up" frame
budget tip and a two-location `force_rate` sync note for module 08. See "From the narration" and
"Claim-check" sections.

---

## 07 — Editing images (07:12) · Flux2Edit workflow

**Procedure as taught:** deploy the RunPod image-edit template, or install locally via
`image_edit_models.bat` (text-read only — pulls FLUX.2-klein-9B + a face-swap LoRA from HF,
needs an HF token pasted into the console, sets ComfyUI Manager `security_level = weak`).
Load `10sorlabs_image_edit_workflow.json`, fix the one custom-node error by deleting the
buggy `ComfyUI_LayerStyle` folder and reinstalling via Manager, then drive two edit modes
from one graph: **clothing swap** (target outfit as figure 2, LoRA off) and **face/head
swap** (LoRA on, strength 1.0). Terminate the pod when done.

**Settings table**

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Base model | `flux-2-klein-9b.safetensors` (UNETLoader, node 104) | 254s | JSON + on-screen |
| Text encoder | `qwen_3_8b_fp8mixed.safetensors`, type `flux2` (CLIPLoader, node 111) | 254s | JSON + on-screen |
| VAE | `flux2-vae.safetensors` (node 105) | 254s | JSON |
| Sampler | `euler_ancestral` (KSamplerSelect, node 100) | 254s | JSON |
| Guider | `CFGGuider` cfg = **1** (node 115) | 254s | JSON |
| Scheduler | `Flux2Scheduler` — guidance/width/height = **4 / 1024 / 1024** (node 116) | 254s | JSON |
| Latent size | `EmptyFlux2LatentImage` 1024×1024, batch 1 (node 107) | 254s | JSON |
| Image prep | `LayerUtility ImageScaleByAspectRatio V2`: aspect `original`, crop, `lanczos`, divisible-by-8, longest side **1024** (node 143) | 254s | JSON |
| Face/head-swap LoRA | JSON default node value: `breast_slider_9b_klein_20260118_210913.safetensors` strength **2** (node 164) · **live demo loads a different file**: `bfs_head_v1_flux-klein_9b_step3500_rank128.safetensors` (the `.bat`'s actual download, "Best-Face-Swap"), strength dragged to **1.0** on screen | 06:20–06:47 | JSON (default) vs. on-screen (live) — **conflict, on-screen wins** |
| LoRA strength guidance (spoken) | operator tries 0.6, judges it worse, reverts: **"keep it to one"** | 06:41–06:48 | audio |
| Clothing-swap prompt | node 170/126: *"The character in Figure 1 is wearing the clothes in Figure 2. Maintain realistic details."* | 254s+ | JSON, matches audio |
| Face/head-swap prompt | node 167 `head_swap`: use image 1 as base (env/lighting/framing), replace head with image 2's, match head size / face-to-body ratio / neck thickness / shoulder alignment / camera distance | 06:14–06:20 | JSON |
| Custom-node fix | delete `ComfyUI/custom_nodes/ComfyUI_LayerStyle` folder manually, restart, reinstall via Manager "install missing custom nodes", restart again | 193s (03:16–03:53 audio) | audio |
| Missing/unused image sockets | select the red (unconnected) `LoadImage` node, **Ctrl+B** (bypass) | 03:02–03:10 | audio |
| Quality note (spoken) | face-swap output still needs a face-detailer + skin pass downstream | 06:26–06:34 | audio |
| Reference-image discipline (spoken) | clothing-swap source image should show **only the garment** (no model, no background) — feeding a full outfit photo with a person/background in it measurably degrades output and can cause an identity-swap misfire instead of a clothing-swap | 04:57–06:07 | audio |

**Maps onto our stack:** the clothing/head-swap pattern (base + reference + one short
instruction, `ReferenceLatent`×4) is a **targeted-edit** primitive we lack — closer to
inpaint-by-instruction than our regenerate-and-cull loop. FLUX.2-klein-**9B** here is the
*editing* model (gated), distinct from our klein **4B Base** for identity — do not conflate.
`euler_ancestral` + cfg 1 + guidance 4 is a usable starting point for any Flux.2 edit node.
Does not map: KREA2/Ostris are absent; `security_level = weak` is a supply-chain loosening we
should never carry into our own installs.

**Evidence honesty:** `Flux2Scheduler` widget *names* are inferred from ComfyUI's Flux.2
convention, not a tooltip — treat 4/1024/1024 as high-confidence, not certified. The
0.6-then-revert LoRA test is one anecdotal A/B, not swept.

---

## 08 — Motion control (06:46) · Wan2.1 SCAIL2 + SAM3 I2V

**Procedure as taught:** two inputs — a **driving video** (motion source) and a **persona
image** (identity). Local install needs **24GB+ VRAM**; 16GB is flatly "impossible" — use
RunPod (Pro 6000 / 5090 / 4090 / L40S all confirmed) below that. Build the first frame first
(identity-swap the persona into a frame taken from the driving video, via Flux2Edit module 07
or ChatGPT), extract it with `extract_first_frame.bat` (ffmpeg, text-read only), load it as
`start_frame`, tune the driving-video load node (rate/frame count), keep the motion prompt
terse, run, terminate the pod.

**Settings table**

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Diffusion model | `wan2.1_14B_SCAIL_2_fp8_scaled.safetensors` (UNETLoader) | 184s | JSON + on-screen |
| Distill LoRA | `Wan21_I2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors`, strength **1.0** | 184s | JSON + on-screen |
| Text encoder | `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, type `wan` | 184s | JSON |
| VAE | `wan_2.1_vae.safetensors` | 184s | JSON |
| CLIP vision | `clip_vision_h.safetensors` | 184s | JSON |
| Segmentation checkpoint | `sam3.1_multiplex_fp16.safetensors` (drives 2× `SAM3_VideoTrack`, threshold 0.5, range 0–1 — masks subject in driving video + reference image) | 184s | JSON |
| KSampler | steps **6**, cfg **1**, `euler` / `simple`, denoise **1** | 184s | JSON |
| ModelSamplingSD3 shift | **5** | 184s | JSON |
| WanSCAILToVideo | width **512**, height **896**, length **81** frames, batch 1, pose_strength **1.0**, pose range 0–1, previous_frame_count **5** | 184s | JSON |
| Driving-video load node | `force_rate` **16**, `frame_load_cap` **81**, `skip_first_frames` 0, `select_every_nth` 1 (this is the production config used in the demo) | 03:47 | on-screen, matches JSON's 81-frame length |
| **Testing methodology (missing procedural claim)** | Start a new subject/clip at a **low frame rate and a low frame cap (~60 frames)** for fast iteration — "the longer the video, the higher the frame rate, the longer it's gonna take to generate, and so the longer it's gonna take to test, so it's best to test quickly and then once you find a good configuration, refine it." Only raise toward the 16fps ceiling (see Iteration guidance row below) once a working setup is found. | 03:50–04:20 | audio |
| **`force_rate` must be synced in two places (missing procedural claim)** | Setting `force_rate` on the driving-video load node requires making the matching change on the output node as well: "if you put the force rate to 12fps here, you're also gonna have to do it here, this output." | 04:20–04:26 | audio |
| Resize (driving video) | `scale total pixels` → **0.5** megapixels, `nearest-exact` | 184s / 03:44 | JSON + on-screen |
| Negative prompt | unmodified default Wan2.1 Chinese negative-prompt block (garish color, overexposed, static, blurred detail, subtitle/watermark, deformed limbs, fused fingers, cluttered background, walking backwards, etc.) | 184s | JSON |
| Positive/motion prompt discipline | **keep it to subject + outfit + action only** — e.g. "a blonde hair girl wearing a black dress dancing"; explicitly do NOT describe background, lighting, or expression, because the model will attend to whatever is described instead of the subject | 05:29–05:58 | audio |
| Good vs. bad driving clip | avoid clips with more than one person in frame (model can't tell which motion to transfer); natural, uncomplicated movement transfers reliably | 196s (03:16–03:37) | audio |
| Start-frame doctrine | "did you match the start frame" is the first troubleshooting question for any bad result — the workflow's `start_frame` must be the identity-swapped **first frame of the driving video itself**, not an arbitrary portrait | 268s (04:31–04:44) | audio |
| Iteration guidance | if output is close but imperfect: raise `frame_load_cap`/duration and/or push `force_rate` toward **16 FPS max** ("I wouldn't go higher"); beyond that, train a subject-specific LoRA, interpolate frames, upscale | 06:10–06:27 | audio |
| Cost/ops | always Stop + Terminate the RunPod pod after use | 06:33–06:44 | audio |

**Maps onto our stack:** closest thing in the package to our stage-6 motion pass — a real
self-hosted **Wan 2.1**-family I2V pipeline (we target **Wan 2.2**), with an explicit
SAM3-based subject/pose masking stage we lack (separates "what moves" from "who is moving").
The **6-step / cfg-1 / lightx2v-distill** sampler config is a fast-inference recipe worth
testing against Wan 2.2 if a compatible distill LoRA exists. The **prompt-terseness rule**
and **start-frame-must-match** doctrine are stack-agnostic — adopt as-is. Does not map:
`ModelSamplingSD3`/`WanSCAILToVideo` are Wan-2.1-specific node names.

**Evidence honesty:** TikTok clips scrubbed at 03:24–03:40 as good/bad examples are **not
described beyond "multi-person vs. single-person, busy vs. simple"** — someone else's social
content, not ours to catalogue. `WanSCAILToVideo`'s widget-to-name mapping was reconstructed
from `inputs[]` ordering — high-confidence, not tooltip-certified.

---

## 14 — Motion Control (Legacy, Kling 3.0) (03:21) · SaaS path

**Procedure as taught:** the non-self-hosted equivalent of module 08. Pick a driving clip,
screenshot its first frame (Shift+Alt+S), identity-swap the persona into that frame via
Higgsfield "Nana Banana," then feed {reference image, driving video} into Kling motion
control and generate.

**Settings table**

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Cost | **120 credits** per motion-control generation | 01:16–01:22 | audio |
| Output resolution used | **720p** (explicitly to save credits over higher tiers) | 02:14 | audio |
| Audio track | keep it on — same price either way | 02:17–02:24 | audio |
| First-frame doctrine | identical to module 08: screenshot the driving clip's first frame, identity-swap it, feed as reference image, "if we don't [match them], the quality is going to decrease" | 8s / 00:08–00:23 | audio |
| Good vs. bad driver (spoken) | natural, uncomplicated movement (left example) vs. "very busy," many-angle clips (right example) — same rubric as module 08, independently restated | 151s (02:44–03:16) | audio |
| Doctrine (spoken) | "don't try to force the model to do something it cannot do... work around the limits of the model" | 03:09–03:19 | audio |

**Maps onto our stack:** nothing — SaaS (Kling), paid, out of our explicit-tier hosting
constraint (r14 synthesis #12). Recorded because it independently confirms the start-frame
and good/bad-driver doctrine from module 08 with a second, unrelated tool — cross-tool
agreement is evidence the doctrine is a real constraint, not a SCAIL quirk. Evidence honesty:
none — fully transcribed, nothing withheld.

---

## 12 — Creating Your Model (Legacy) (02:22) · pre-ComfyUI identity path

**Procedure as taught:** fill the 6-slot `Model Identity Prompt.txt` template (ethnicity,
skin tone, hair color/style/length, eye color — r14 already documents the two-part
template+JSON-schema structure in full), paste into ChatGPT to expand into the structured
JSON prompt, paste into Higgsfield "Nano Banana," generate a reference portrait, generate
**12 angles** (one click: "angles" → generate → "12 best angles" → generate), download,
import into Higgsfield as category `character`, register.

**Settings table** — nothing beyond r14's structural read of the copy-block; the video adds
only the click-path (fill slots 140s → ChatGPT 40s → Nano Banana generate 61s → 12 angles
84s → import/category `character`/create 94s → use 119s), all matching r14's timecodes;
nothing recoverable beyond what page text already flagged as spoken-only.

**Maps onto our stack:** confirms r14's read — prompt-structure reference only, never an
identity source (our anchor stays operator-supplied, cull-checked). Evidence honesty: demo's
example slot-fills watched but not reproduced — arbitrary values, outside the brief's scope.

---

## 13 — Generating Content (Legacy) (04:12) · 2×2 grid batching + Image Toolkit

**Procedure as taught:** find a reference pose/pic (Pinterest), extract its prompt via the
"carousel-prompter" custom GPT, paste into Nano Banana **with the literal phrase "2x2 pic
grid"** included, generate at **4K**, download, split into 4 files with the bundled **Image
Toolkit** (local Flask app, `imgtoolkit_extracted/`).

**Settings table**

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Grid failure mode (spoken) | omitting the "2x2 pic grid" phrase from the prompt makes the model emit 4 image-IDs but render **only 1 actual picture** — the phrase is load-bearing, not decorative | 97s (01:42–02:07) | audio |
| Resolution choice | generate directly at **4K** rather than 2K+upscale — "pay a little more for a lot less work" | 02:08–02:17 | audio |
| Throughput claim | one 2×2-grid generation = 4 usable images at the cost/time of ~1 — "four times as fast and four times as cheap" | 0–28s | audio |
| Grid slicer — exact op | `imgtoolkit/app.py` `/api/chopper`: crops the uploaded image into **exact quadrants** (no overlap, no feathering) — `A1/A2/B1/B2` = `(0,0,w/2,h/2)`, `(w/2,0,w,h/2)`, `(0,h/2,w/2,h)`, `(w/2,h/2,w,h)` | — | JSON-equivalent (source: `app.py` code, read as text) |
| Grid slicer — dependency | needs FFmpeg only for the separate `/api/adjust` "Adjust" tool, not for the chopper/split itself | — | `README.md`, `HOW TO RUN.txt` |
| Adjust-tool defaults (the same toolkit's re-encode/"de-AI" pass — not used on camera in this lesson, but shipped with it) | `fps=22`, `noise=12` (film-grain-style luma noise), `saturation=0.65`, `contrast=1.15`, `brightness=-0.05`, `gamma_r=1.05` / `gamma_b=0.95`, output `bitrate=1800k`/`maxrate=1800k`, `libx264 preset=ultrafast crf=4`, plus an 8-level posterize LUT and a `vignette=PI/4`; audio re-encoded `aac 64k @ 22050Hz` | — | `app.py` source (read as text, not run) |
**Maps onto our stack:** the 2×2-grid trick is cheap to prototype against Z-Image Base /
FLUX.2 klein 4B if the model supports multi-subject grid composition — test the silent
1-of-4 collapse failure mode first. Chopper is worth porting as a ~40-line script (skip
Flask/PyInstaller). Adjust-tool params are a data point for a crude "less AI" pass, not
something to adopt outright: `crf=4`+`ultrafast` is inverted from normal practice (near-
lossless, huge files); posterize+vignette is stylistic, not de-artifacting.

**Evidence honesty:** `imgtoolkit.zip` read as text (`app.py`, `README.md`, `requirements.txt`,
`HOW TO RUN.txt`, `imgtoolkit.spec`; GUI shell skipped) — Flask app never run.

---

## 00 — Welcome (01:58) & 01 — How to install ComfyUI (01:23) · skimmed per brief

00 is pure orientation (module order, "don't skip to motion control before you have a
dataset," growth SOPs and prompt guide are bonus/legacy). 01 is a stock ComfyUI-desktop
installer walkthrough (comfy.org → download desktop → default path → agree to terms → name
install → GPU auto-detected → skip bundled models/workflows on first run). Neither adds a
setting or procedure beyond r14; both fully transcribed, nothing withheld.

---

## From the narration (faster-whisper, 2026-09-03)

This report's original claude-video-vision pass already recovered audio for modules 07 and 08, so
the independent faster-whisper transcripts mostly corroborate rather than add. Two genuinely missing
procedural rules were found and folded into module 08's table above (testing methodology: start at
~60 frames / low frame rate, refine up; `force_rate` must be set in two places). No further
narration-only items surfaced for modules 07 or 08 — every other spoken claim in the transcripts was
already captured, including exact-match quotes ("keep it to one," "did you match the start frame,"
the clothing-swap reference-image discipline, the anti-multi-person driving-clip rubric).

## What to adopt (10 lines)

1. Targeted-edit primitive (module 07: base + reference + one-sentence instruction, `ReferenceLatent`×4, euler_ancestral/cfg1/guidance4) as a Flux.2 "fix in place" pass.
2. Face/head-swap LoRA strength **1.0** — the operator's own 0.6-then-revert test converged there; the default to beat, not lower.
3. Reference-image discipline: swap-source crops should show **only** the target (no incidental body/background) or quality drops and intent can misfire.
4. SAM3-based subject/pose masking as a real I2V primitive to evaluate against Wan 2.2, not just prompt-only motion conditioning.
5. Motion-prompt terseness: name subject + outfit + action only; never describe background/lighting/expression in an I2V prompt.
6. Start-frame-must-match-the-driving-video doctrine — confirmed independently by two unrelated tools (module 08 self-hosted, 14 SaaS); a hard constraint.
7. Single-person, simple-motion driving-clip selection rubric — restated twice, same both times.
8. 2×2 grid batching for throughput, after confirming our model doesn't silently collapse to 1-of-4 without an explicit grid keyword.
9. Generate at target resolution directly when the cost delta to upscaling is small; don't default to upscale-after as a reflex.
10. Fast-inference recipe to test: 6-step/cfg-1/distill-LoRA sampling, if a Wan-2.2-compatible distill LoRA exists.

## Claim-check (2026-09-03, sonnet)

Checked all 33 pre-existing settings-table rows across modules 07 and 08 against faster-whisper
transcripts (`transcript.txt` beside each `lesson.mp4`). This report already had working audio from
its original claude-video-vision pass, and it held up under independent re-transcription — every row
checked out, including several exact-quote matches ("keep it to one," "did you match the start
frame," the anti-multi-person driving-clip rubric). 2 new rows were added to module 08 (the
"test low, refine up" frame-budget methodology and the two-location `force_rate` sync requirement)
and are counted separately, not in this verdict table.

| Module | Rows checked | VERIFIED | PARTLY | WRONG | UNVERIFIED |
|---|---|---|---|---|---|
| 07 — editing_images | 16 | 16 | 0 | 0 | 0 |
| 08 — motion_control | 17 | 17 | 0 | 0 | 0 |
| **Total** | **33** | **33** | **0** | **0** | **0** |

No WRONG or PARTLY rows. This is the strongest-sourced of the three reports — its original author
evidently did have working audio despite the sibling reports' whisper failures — and the faster-
whisper pass functioned mainly as independent confirmation plus 2 narration-only additions (both
folded into module 08's table above).
