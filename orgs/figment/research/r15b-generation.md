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
| KSampler demo steps | 2 (blur) → 20 → 30 → 40 | 05:12–09:50 | UI |
| KSampler demo cfg | 5.0–7.0 | 05:12–09:50 | UI |
| sampler_name / scheduler | euler / simple | 05:12–09:50 | UI |
| denoise (effect demo) | 1.00 base; 0.10 and 0.50 shown as low-denoise examples | 05:44, 09:10, 09:30 | UI |
| LoRA stack, node 1 | `SDXL\StudioGhibli.Redmond-S...`, strength_model 0.6–1.00 | 13:35 | UI |
| LoRA stack, node 2 | `SDXL\CLAYMATE_V2.03_safet...`, strength_model 1.00 | 17:55 | UI |
| Common error (wrong-arch LoRA stacked) | `RuntimeError: Given groups=1, weight of size [512,16,3,3], expected input[1,4,128,128] to have 16 channels, but got 4 channels` | 16:29 | UI |
| Model install path | `models\loras\`, subfoldered by the operator's own convention (`IL_STYLE`, `10sorLabs Image Loras`, `IL`, `ZIT`, `QWEN`, `SDXL`, …) | 15:01 | UI |

## 09 — Generating Images (KREA2) (06:32)

**Procedure as taught:** single workflow — Diffusion Model + CLIP + VAE loaders → 3-slot Power
LoRA Loader → base KSampler pass (turbo-style: 4 steps, cfg 1) → model upscale → scale-down
normalize → second low-denoise KSampler pass → FaceDetailer → A/B compare.

| Setting | Value | Timecode | Source |
|---|---|---|---|
| Diffusion model | `krea2_turbo_fp8_scaled.safetensors` | 04:00 | JSON+UI |
| Text encoder | `qwen3vl_4b_fp8_scaled.safetensors`, type `krea2` | 04:00 | JSON+UI |
| VAE | `qwen_image_vae.safetensors` | — | JSON |
| LoRA stack (3 slots) | MysticXXX_KREA2_v1 off/0.90 · RealisticSnapshotKrea2 on/1.50 · pawg_krea2 on/0.65 | 04:00 | JSON+UI |
| Empty latent | 1448×2176, batch 1 | 04:00 | JSON+UI |
| Base KSampler | steps 4, cfg 1.0, sampler `res_2s`, scheduler `beta`, denoise 1.00, seed increment | 04:00 | JSON+UI |
| Upscale model | `4xNMKDSuperscale_4xNMKDSuperscale.pt` | 04:00 | JSON+UI |
| Post-upscale normalize | `ImageScaleBy` nearest-exact, scale_by 0.25 | — | JSON |
| Refine-pass KSampler | steps 4, cfg 1.0, sampler `euler_ancestral`, scheduler `simple`, denoise 0.35, seed 40 fixed | — | JSON |
| FaceDetailer | guide_size 512 (bbox), max_size 1024, steps 4, cfg 1.0, sampler `euler`, scheduler `normal`, denoise 0.15, feather 5, bbox_threshold 0.40, bbox_dilation 10, bbox_crop_factor 3.0, sam_detection_hint `center-1`, sam_threshold 0.80 | 04:00 | JSON+UI |
| Face/seg models | bbox `face_yolov8m.pt`, SAM `sam_vit_b_01ec64.pth` (Prefer GPU) | — | JSON |
| Model sources (`.bat`, text-read only) | base/text-enc/vae/upscaler → `huggingface.co/Comfy-Org/Krea-2`; 3 LoRAs → `huggingface.co/gravedigga/loras`; bbox → `Bingsu/adetailer`; sam → `Gourieff/ReActor` dataset | — | `.bat` |

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
| ClownsharKSampler | eta 0.45, sampler_name `exponential/res_8s`, scheduler `simple`, steps 8, steps_to_run −1, denoise 0.95, cfg 1.00, seed 149 (fixed for prompt demo / increment for variety runs), sampler_mode `standard`, bongmath on | 03:30, 04:33, 10:12 | JSON node 47 + UI (exact match) |
| Negative prompt (artefact, structural) | an explicit **anti-"AI look" list** — rejects perfect symmetry, studio/flawless lighting, airbrushed/polished-beauty-shot, editorial/glamour style, ultra-clean edges, "commercial beauty standards", "overly refined rendering" | — | JSON node 5 |
| FaceDetailer ("fixing rough face") | guide_size 1024 (bbox), max_size 1024, steps 8, cfg 1.0, sampler `dpmpp_2m`, scheduler `simple`, denoise 0.23–0.27, feather 5, bbox_threshold 0.40–0.50, bbox_dilation 10, bbox_crop_factor 3.0, sam_detection_hint `center-1`, sam_threshold 0.93 | 08:17 | JSON nodes 30/66 + UI |
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
