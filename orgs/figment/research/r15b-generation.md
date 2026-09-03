# r15b — 10sorLabs package, generation part (video-recovered settings)

Source: watched (`claude-video-vision` MCP: `video_info` → `video_analyze` scene-detect → targeted
`video_detail`/`video_watch` frame pulls at r14's chapter timecodes) the four generation-part
lesson videos, plus the sidecar ComfyUI workflow JSONs and `.bat` installers read as **text only,
never executed**. Licensed content: notes and derived settings only — no verbatim prompt/negative
dumps beyond the exact numeric/name artefact; the module-03 passport prompt is not re-quoted here
(see r14 for its structure), only the on-screen camera-clause values already public in r14 are
reconfirmed.

**Audio note:** whisper transcription (`video_analyze`/`video_watch` with audio) crashed on all
three files it was tried on (`Connection closed` / non-zero exit after language auto-detect —
same failure signature every time, likely a whisper-cli/VAD issue with this codec, not a one-off).
No spoken narration was recovered for this part. Everything below is read from on-screen UI plus
the JSON/`.bat` sidecars — cross-checked against each other where both exist. One crashed
`video_watch` call also silently mis-cached frames under wrong timestamps for module 02 (13:41
showed 05:12's content); caught by re-extracting that segment fresh in an isolated call and
discarding the bad cache — flag this as a tool reliability caveat for future R15 sessions, always
verify a suspicious frame with a clean re-pull before trusting it.

**Update (2026-09-03):** faster-whisper transcripts now exist for modules 02, 06, and 09
(`transcript.txt` beside each `lesson.mp4`, produced outside the video-vision MCP path above).
Checked claim-by-claim below — see "From the narration" and "Claim-check" sections. Several rows
were wrong or missing real spoken guidance, notably module 02's cfg/steps demo sequences and its
mislabeled error-cause row, and module 06's missing checkpoint-comparison narrative. Module 03 has
no separate transcript in this pass and is unchanged.

---

## 02 — ComfyUI Basics (17:56)

**Procedure as taught:** generic loader → CLIP text encode (positive/negative) → KSampler → VAE
decode → Save Image loop, demonstrated on an "Efficiency Nodes" combined `KSampler (Efficient)`
panel so every field is visible at once. Steps is varied live (2 → 20 → 30 → 40) to show
under/over-sampling; denoise is varied (1.00 → 0.10 → 0.50) on the same seed to show its effect.
Then two `Load LoRA` nodes are chained off one Diffusion Model to demonstrate stacking, including
a deliberate error case, and the operator browses the live `models\loras\` folder to show install
paths.

| Setting | Value | Timecode | Source |
|---|---|---|---|
| KSampler demo steps | **Corrected sequence per audio** — the taught progression is 40 (baseline, seed fixed) → 5 ("very bad results... same as cooking a dish in two minutes") → 11 → 16 → 20 → direct 20-vs-40 comparison ("only this part really changed") → 30. The original "2 (blur)→20→30→40" is only a hypothetical example given earlier in the same explanation ("if we put it to two steps, for example, it's going to be very fast... very bad results," 5:34–5:46), not necessarily a demoed value on this exact sequence — recorded as illustrative, not confirmed as an on-screen step. | 05:34 (illustrative "2 steps"), 06:09–07:18 (actual demoed sequence) | audio — corrected |
| KSampler demo cfg | **Wrong in the original table.** Spoken/demoed sequence is **1 → 4 → 20 → ~5** ("cfg one we couldn't even make out a kraken, cfg four it starts to form... now we put the cfg to 20, this is normally something you will not put this high, I think it's worse... if we kept it at like five or something, this is definitely better"). "5.0–7.0" does not match; strike it. | 07:28–08:40 | audio — corrected, was WRONG |
| sampler_name / scheduler | euler / simple (on screen); spoken general recommendation for *any* workflow: "dpmpp is a good one, res is a good one" — a broader hint than the demo's specific pair | 05:12–09:50 (UI); 08:40–08:57 (audio, general advice) | UI + audio |
| denoise (effect demo) | 1.00 base; **0.10 → 0.20 → 0.50** shown as low-denoise examples (0.20 step missing from the original table — "if we put it up to 0.2, now we double it, still nothing is happening; let's put it to 0.5, see, now something is starting to form") | 09:05–09:35 | UI + audio |
| LoRA stack, node 1 | `SDXL\StudioGhibli.Redmond-S...`, strength_model 0.6–1.00; demo also runs it with no trigger word first to show it silently does nothing ("it doesn't really do anything... because we haven't used a trigger word") before cranking to the working config | 13:35 | UI + audio (11:29–11:58) |
| LoRA stack, node 2 | `SDXL\CLAYMATE_V2.03_safet...`, strength_model 1.00; range extends to **0.56** ("hybrid, probably will not look good") and **2.0** ("now it listens more to the LoRA than if you put it at one") in the live strength sweep — missing from the original single-value row | 17:55 | UI + audio (13:19–13:43) |
| Common error | **Mislabeled in the original table — this is a VAE-mismatch error, not a wrong-arch LoRA error.** The demoed failure is caused by swapping in an SDXL-incompatible VAE file (`ae.safetensors`), not by stacking a wrong-architecture LoRA: "it's because this AE safetensors is not made for SDXL, so we need to go back to the SDXL VAE." Exact `RuntimeError: Given groups=1, weight of size [512,16,3,3]...` text is UI-read (audio garbles it to "blah blah blah") and is unchanged — only the stated *cause* was wrong. | 16:29 (UI); 16:45–17:11 (audio, cause) | audio — corrected, cause was WRONG |
| Model install path | Applies to **all model types**, not just LoRAs as originally scoped: `models\diffusion_models\`, `models\vae\`, `models\text_encoders\`, `models\loras\` — each independently subfolderable by the operator's own convention (`IL_STYLE`, `10sorLabs Image Loras`, `IL`, `ZIT`, `QWEN`, `SDXL`, …) | 15:01 (UI); 14:24–15:17 (audio, general rule) | UI + audio — broadened |

## 09 — Generating Images (KREA2) (06:32)

**Procedure as taught:** single workflow — Diffusion Model + CLIP + VAE loaders → 3-slot Power
LoRA Loader → base KSampler pass (turbo-style: 4 steps, cfg 1) → model upscale → scale-down
normalize → second low-denoise KSampler pass → FaceDetailer → A/B compare.

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Diffusion model | `krea2_turbo_fp8_scaled.safetensors` | 04:00 | JSON+UI |
| Text encoder | `qwen3vl_4b_fp8_scaled.safetensors`, type `krea2` | 04:00 | JSON+UI |
| VAE | `qwen_image_vae.safetensors` | — | JSON |
| **Negative prompt** | **Not supported — Krea2 is positive-prompt-only.** "We only have a positive prompt, no negative prompt. Krea2 doesn't work with negative prompt." Missing from the original table entirely; a hard model limitation, not a workflow choice. | 03:40–03:48 | audio |
| LoRA stack (3 slots) | MysticXXX_KREA2_v1 off/0.90 · RealisticSnapshotKrea2 on/1.50 · pawg_krea2 on/0.65 | 04:00 | JSON+UI |
| Empty latent | 1448×2176, batch 1 | 04:00 | JSON+UI |
| Base KSampler | steps 4, cfg 1.0, sampler `res_2s`, scheduler `beta`, denoise 1.00, seed increment | 04:00 | JSON+UI |
| Custom-node fix for `res_2s` | If `res_2s` throws "value not in list": Manager → Custom Nodes Manager → search for the RES4LYF sampler pack ("REST for life" in the transcript — a whisper mis-hearing of RES4LYF/ResForLife) and install. Missing from the original table. | 01:30–01:46 | audio |
| Upscale model | `4xNMKDSuperscale_4xNMKDSuperscale.pt` | 04:00 | JSON+UI |
| **Upscaler rule of thumb (missing procedural claim)** | Skip the upscale pass on close-up face shots — "it's not specialized for the face, it's only gonna dilute the original image." Use it when the frame has background/props/wardrobe detail — "if you have a lot going on then you can see it absolutely generates better results" (background, jewelry, TV, poles all cited as improved). | 04:08–04:43, 05:13–05:53 | audio |
| Post-upscale normalize | `ImageScaleBy` nearest-exact, scale_by 0.25 | — | JSON |
| Refine-pass KSampler | steps 4, cfg 1.0, sampler `euler_ancestral`, scheduler `simple`, denoise 0.35, seed 40 fixed | — | JSON |
| FaceDetailer | guide_size 512 (bbox), max_size 1024, steps 4, cfg 1.0, sampler `euler`, scheduler `normal`, denoise 0.15, feather 5, bbox_threshold 0.40, bbox_dilation 10, bbox_crop_factor 3.0, sam_detection_hint `center-1`, sam_threshold 0.80 | 04:00 | JSON+UI |
| Face/seg models | bbox `face_yolov8m.pt`, SAM `sam_vit_b_01ec64.pth` (Prefer GPU) | — | JSON |
| **Seed discipline (missing rule)** | "Leave this to fixed or increment, do not put it to randomize or something, because you're gonna lose track of your generations." | 06:07–06:14 | audio |
| Model sources (`.bat`, text-read only) | base/text-enc/vae/upscaler → `huggingface.co/Comfy-Org/Krea-2`; 3 LoRAs → `huggingface.co/gravedigga/loras`; bbox → `Bingsu/adetailer`; sam → `Gourieff/ReActor` dataset | — | `.bat` |
| Production note (spoken) | At recording time the Krea2 base model was "currently pending approval" on HF; the demo substitutes Z-Image Turbo for the live run and notes a Krea2 checkpoint will exist by the time viewers watch. | 04:55–05:03 | audio |

## 06 — Generating Images (08:31)

**Procedure as taught:** load Z-Image Turbo + a persona LoRA stack, write a matched
positive/negative prompt pair, sample with `ClownsharKSampler` (RES4LYF custom sampler tuned for
turbo checkpoints), decode/save; compare 2+ candidate LoRA strengths side by side against
Instagram reference photos sourced via the `img2prompt` extension; finish with a FaceDetailer pass
as the "fix rough face" step.

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Diffusion model | `z_image_turbo_bf16.safetensors` | 03:30 | JSON+UI |
| Text encoder | `qwen_3_4b.safetensors`, type `lumina2` | 03:30 | JSON+UI |
| VAE | `ae.safetensors` | — | JSON |
| Empty latent | 1536×2048 (`EmptyFlux2LatentImage`) | — | JSON |
| Persona LoRA (comparison) | `realistic_snapshot_lora.safetensors`, strength varied 0.66–0.80 across the comparison; second slot `agata.safetensors` @1.00 or `AssSlider.safetensors` @1.6 (off) | 03:30–11:42 | JSON+UI |
| **Checkpoint-ranking step (entirely missing from the original table)** | This module opens with a manual comparison across **5 LoRA checkpoints saved from module 05's training run**: the final/"normal" LoRA plus steps 2000, 2250, 2500, 2750 — same seed, everything else in the graph disabled, one checkpoint swapped in at a time. Verdicts as spoken: 2000 = "I don't like this... her physical features are not there," 2250 = "I like it," 2500 = "no, man, it's weird," 2750 = "not too good either." **Winner: 2250 steps.** This is the informal counterpart to module 11's formal dataset-tester harness, and belongs alongside r15b-training.md's module 05 "Ranking step" row. | 02:34–04:25 | audio |
| **Step-count discrepancy (cross-confirms r15b-training.md's module 05 correction)** | "I trained these LoRa's to 3000 steps, but in my tutorial I'm saying 5000 steps, so this is why my numbers are different — but the 5000 step training gives better results." Independent confirmation that module 05's spoken "5000" was the deliberate recommendation, not a typo; the checkpoints compared above only reached 3000 because that was a cheaper demo run. | 04:26–04:40 | audio |
| ClownsharKSampler | eta 0.45, sampler_name `exponential/res_8s`, scheduler `simple`, steps 8, steps_to_run −1, denoise 0.95, cfg 1.00, seed 149 (fixed for prompt demo / increment for variety runs), sampler_mode `standard`, bongmath on; **seed is deliberately held fixed while checkpoint-swapping above, specifically so results are comparable** ("we are going to keep this seed fixed... you know it's configured correctly if you click run, like you can spam-click it and nothing changes") | 03:30, 04:33, 10:12 | JSON node 47 + UI (exact match) + audio (fixed-seed A/B method, 03:00–03:31) |
| Negative prompt (artefact, structural) | an explicit **anti-"AI look" list** — rejects perfect symmetry, studio/flawless lighting, airbrushed/polished-beauty-shot, editorial/glamour style, ultra-clean edges, "commercial beauty standards", "overly refined rendering" | — | JSON node 5 |
| **Prompt-and-LoRA-must-agree doctrine (missing procedural claim)** | A trained LoRA doesn't fully lock identity on its own: "our model had light gray eyes but we're getting like lightish brown eyes... people always think, okay, I already made a LoRA so I can just slap it on a workflow, prompt some stuff, and call it a day — but you need to do both prompting and LoRA, because if your LoRA's a blonde girl and you have a prompt with a brunette girl, it's not gonna work." Fixed by adding the missing trait ("light gray eyes") back into the prompt. | 05:55–06:17, fix at 06:24–06:31 | audio |
| FaceDetailer ("fixing rough face") | guide_size 1024 (bbox), max_size 1024, steps 8, cfg 1.0, sampler `dpmpp_2m`, scheduler `simple`, denoise 0.23–0.27, feather 5, bbox_threshold 0.40–0.50, bbox_dilation 10, bbox_crop_factor 3.0, sam_detection_hint `center-1`, sam_threshold 0.93; **spoken calibration note** — 0.23 is called out as "a good value," with a wider usable band "within like 0.15 and 0.3 at most" (the JSON's 0.23–0.27 falls inside that spoken band, both recorded); this must be tuned on **each of the two chained FaceDetailer nodes** ("you're gonna have to do it twice") | 08:17 | JSON nodes 30/66 + UI + audio (07:59–08:16) |
| Upscale | `UpscaleModelLoader` → `zit_upscaler.safetensors` + `ImageUpscaleWithModel` (not exercised on screen in the watched segments) | — | JSON only |
| Model sources (`.bat`, text-read only) | base/text-enc/vae → `huggingface.co/Comfy-Org/z_image_turbo`; LoRA + `zit_upscaler` → `huggingface.co/gravedigga/loras`; sam/bbox → `Gourieff/ReActor` dataset | — | `.bat` |

## 03 — Generating Your Character (05:12)

**Procedure as taught:** install ComfyUI via the official Comfy-Desktop installer (not a bare
git clone), run the model installer `.bat`, then open the **same workflow JSON module 06 uses**
(`10sorlabs_image_generator.json` is byte-identical between the two module folders) and load the
fixed "passport prompt" text file into the Positive Prompt node.

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Local ComfyUI path | `%LocalAppData%\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI` (app-managed install, not manual git/pip) | 02:20–02:53 | UI |
| Install log confirms | model installer also clones/installs **ComfyUI-Impact-Pack** (source of FaceDetailer/UltralyticsDetectorProvider/SAMLoader used everywhere above) | 03:26 | UI |
| Pipeline | identical to module 06's (z_image_turbo_bf16 + qwen_3_4b + ClownsharKSampler eta 0.45/`exponential/res_8s`/simple/8 steps/denoise 0.95/cfg 1.00/seed 149) | 04:33 | UI |
| LoRA slot here | `realistic_snapshot_lora` family @0.66; second slot off; `control_after_generate` = **increment** (exploring variety, vs. `fixed` in module 06's prompt-writing demo) | 04:33 | UI |
| Passport prompt camera clause | on-screen text reconfirms r14's transcription verbatim: iPhone 15 Pro, 24mm, f/1.8, "zero film grain" | 04:00 | UI (not re-quoted beyond r14) |
| RunPod pod observed (infra aside) | "1× RTX PRO 6000", 16 vCPU / 251GB RAM, template image `10sorlabs/comfyui-image:1.0`, on-demand **$2.09/hr**, secure-cloud US-NE-1 | 05:06 | UI |

---

## From the narration (faster-whisper, 2026-09-03)

Spoken content the original UI/JSON-only pass missed or under-recorded, beyond what's already
folded into the corrected settings-table rows above. Timecodes from each module's `transcript.txt`.

**Module 02 (`02_comfy_basics`)**
- Two-text-encoder note: SDXL needs two text encoders loaded together; "most of the time you're
  just simply... you choose one text encoder" for single-encoder architectures. (03:57–04:11)
- General missing-custom-node recovery path (not specific to this lesson's own workflow, which used
  no custom nodes): Manager/Extensions → see the missing-nodes list → Install → sometimes restart.
  (17:20–17:55)

**Module 09 (`09_krea2_image`)** — see corrected table rows above (no negative prompt, upscaler
rule of thumb, `res_2s` custom-node fix, seed discipline); no further narration-only items.

**Module 06 (`06_generating_images`)** — see corrected table rows above (checkpoint-ranking step,
step-count cross-confirmation, fixed-seed A/B method, prompt-and-LoRA doctrine, FaceDetailer
denoise band); no further narration-only items.

## What maps onto our stack / what doesn't

- **Z-Image Turbo = our "Z-Image Base."** Same HF org (`Comfy-Org/z_image_turbo`), same
  split-file loading pattern (UNETLoader + CLIPLoader(`lumina2`) + VAELoader instead of one
  checkpoint file). Adopt the loader pattern directly if our harness doesn't already use it.
- **cfg≈1.0 + 4–8 steps is a distilled/turbo-checkpoint signature**, not a stylistic choice —
  transferable to any turbo checkpoint we run (klein 4B Base if it ships a turbo variant), but
  never copy these step/cfg numbers onto a full-diffusion model.
- **Two-pass refine structure is directly reusable**: base pass at denoise 1.0 → model-upscale →
  scale-down normalize → second pass at denoise 0.15–0.35 for detail recovery, instead of
  one-shot generation.
- **FaceDetailer calibration band (denoise 0.15–0.27, bbox_threshold 0.40–0.50, sam_threshold
  0.80–0.93)** is a solid starting point for our own local face/detail-repair pass — this is
  their equivalent of stage 5's detailer.
- **The anti-"AI look" negative-prompt shape** (name and reject perfect symmetry / airbrushed /
  "commercial beauty standards" / "overly refined rendering") is the same direction as our
  stage-5 de-gloss pass — reword into our own template rather than reusing their wording verbatim
  (it's licensed text).
- **Power-Lora-Loader-style independent strength sliders** for stacked LoRAs (identity + style/
  skin) map onto how we should combine LoRAs; their persona-LoRA band is 0.65–0.80, style/detail
  LoRAs 0.65–1.50.
- **KREA2 has no counterpart in our stack** (klein 4B Base / Z-Image Base / diffusion-pipe / Wan
  2.2) — its sampler/scheduler pairs (`res_2s`/`beta`, `euler_ancestral`/`simple`) are
  KREA2-specific; do not adopt.
- **One workflow JSON serves both "generate the anchor" (03) and "generate general images" (06)**
  — confirms their anchor is just a first draw from the same pipeline, reinforcing r14's point
  that our anchor should stay operator-supplied/cull-checked rather than auto-drawn.

## Evidence honesty

- No spoken narration recovered anywhere in this part — whisper transcription failed identically
  on all three files tried (`Connection closed` after language auto-detect, no clean error
  surfaced). All numbers above are on-screen UI + JSON/`.bat` cross-checks, not audio.
- Module 02's upscale/detail second-KSampler segment (09:10–09:50) shows the *teaching* of
  denoise's effect, not necessarily 10sorLabs' recommended production value — treat 0.10/0.50
  there as illustrative, not a recipe.
- Module 06's upscale stage (`zit_upscaler.safetensors` + `ImageUpscaleWithModel`) exists in the
  JSON but was not seen executing on screen in the watched segments — settings for it (if any
  beyond the loader) are unconfirmed.
- One `video_watch` call on module 02 crashed and left a stale/mislabeled frame cache (13:41
  showing 05:12's content); caught and corrected by a clean re-pull. No other segment showed this
  symptom, but it means any *single* uncorroborated frame from a crashed call in this session
  should be treated as suspect until re-verified — none were used unconfirmed above.
- `.bat` installers were read as text only, per rule; SHA-256 hashes embedded in
  `krea2_model_installer.bat` were not independently verified against the HF repos.

## What to adopt (10 lines)

1. Split UNETLoader/CLIPLoader(`lumina2`)/VAELoader pattern for Z-Image Base, matching
   `Comfy-Org/z_image_turbo`'s own file layout.
2. cfg≈1.0 + 4–8 steps for any turbo/distilled checkpoint; never on a full-diffusion model.
3. Base pass (denoise 1.0) → model upscale → scale-down normalize → refine pass (denoise
   0.15–0.35) as the standard two-pass structure.
4. FaceDetailer calibration: denoise 0.15–0.27, bbox_threshold 0.40–0.50, sam_threshold 0.80–0.93.
5. Rewrite (don't copy) their anti-"AI look" negative-prompt shape into our own stage-5 template.
6. Independent per-LoRA strength sliders when stacking identity + style/skin LoRAs; persona band
   0.65–0.80, style/detail band 0.65–1.50.
7. Do not adopt KREA2 as a base model or its sampler pairings — no equivalent in our stack.
8. Do not pull Ostris/training numbers into the generation stage — that belongs in
   r15b-training.md.
9. Reuse the discipline of pinning exact HF source repos per model file in our own manifest, but
   re-verify hashes ourselves rather than trusting a third-party `.bat`'s embedded SHA-256 blind.
10. Keep anchor generation operator-supplied/cull-checked — 10sorLabs' own package reuses one
    generic workflow for both "anchor" and "any image," which is exactly the shortcut our
    doctrine (r14 synthesis #11) already rejects.

## Claim-check (2026-09-03, sonnet)

Checked all 30 pre-existing settings-table rows across modules 02, 09, 06 against faster-whisper
transcripts (`transcript.txt` beside each `lesson.mp4`), reconciling against the sibling JSON
where transcript and JSON disagreed. Module 03 has no transcript in this pass and is unchecked.
10 new rows (5 in module 09, 3 in module 06, 2 narration bullets in module 02) are spoken facts
absent from the original tables and are counted separately below, not in this verdict table.

| Module | Rows checked | VERIFIED | PARTLY | WRONG | UNVERIFIED |
|---|---|---|---|---|---|
| 02 — comfy_basics | 8 | 2 | 4 | 2 | 0 |
| 09 — krea2_image | 12 | 12 | 0 | 0 | 0 |
| 06 — generating_images | 10 | 9 | 1 | 0 | 0 |
| **Total** | **30** | **23** | **5** | **2** | **0** |

**The 2 WRONG rows, both corrected in place above:**
1. Module 02 — the cfg demo sequence was recorded as "5.0–7.0"; the actual demoed/spoken sequence
   is 1 → 4 → 20 → back to ~5 ("definitely better").
2. Module 02 — the runtime error demoed at 16:29 was labeled "wrong-arch LoRA stacked"; audio shows
   its real cause is an SDXL-incompatible VAE file swapped in, unrelated to any LoRA.

**5 PARTLY rows** (module 02's steps-demo sequence, denoise-demo missing its 0.2 step, LoRA2's
strength range needing its 0.56/2.0 extremes, the LoRA-folder install path needing to be broadened
to all model types, and module 06's FaceDetailer denoise being a spoken 0.15–0.3 band rather than
a fixed 0.23–0.27) are all corrected in place above rather than reproduced twice here.

**13 narration-only additions** (spoken settings/rules absent from the report entirely) were folded
in above: module 02's two-text-encoder note and general missing-custom-node recovery path (2);
module 09's Krea2 no-negative-prompt limitation, the `res_2s`/RES4LYF custom-node fix, the
close-up-vs-busy-scene upscaler rule of thumb, seed-discipline rule, and the Krea2-pending-approval
production note (5); module 06's checkpoint-ranking narrative (5 checkpoints, winner = 2250 steps),
the 3000-vs-5000-steps cross-confirmation (ties directly to r15b-training.md's module 05 correction),
and the prompt-and-LoRA-must-agree doctrine (3), plus module 06's fixed-seed A/B testing method,
folded into the existing ClownsharKSampler row rather than counted as a separate new row.

The single most consequential finding in this report is the module 06 checkpoint-ranking narrative
combined with the 3000-vs-5000 cross-confirmation — together they show module 05/06's "legacy"
training path has a real (if informal) checkpoint-selection step, and that its taught step count
(5000) was never a typo, contrary to the original r15b-training.md read.
