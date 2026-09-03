# creator-001 identity expansion 01

This is a 24-cell, one-seed identity-expansion run for FLUX.2 klein 4B Base. It uses three fictional, operator-owned face anchors (`g04`, `g01`, `g07`) and produces clothed or swimwear-ceiling phone-photo images for an operator eye-gate. It does not launch a pod by itself.

## Run shape and budget

- GPU: one secure `NVIDIA GeForce RTX 4090`, with a manifest price ceiling of `$0.80/hour`.
- Wall clock: `30` minutes = 6 bootstrap minutes + 24 × 50 seconds, rounded up from 26 minutes to retain teardown margin.
- Readiness: `1200` seconds. The harness requires `max_minutes` to cover readiness plus five teardown minutes, so 30 minutes passes its 25-minute minimum.
- Placement denylist: `qvf79yutw3t2`.
- Seed: every cell uses `100001`; `seed_fields: [noise_seed]` updates `RandomNoise` node 22.
- Output: close and half-body cells are 1024×1280; full-body cells are 896×1536. Every cell expects exactly one image.

The repository's `build_identity_set.py` was not used because it hard-codes a different 40-cell design (5 angles × 4 lights × 2 distances), derives its prompt from a prior candidate arm, emits caption sidecars, and uses varying seeds. This run needs the specified 18-cell angle/distance cross-product plus six named half-body variants at one fixed seed, so the jobs are written explicitly.

## Workflow and source verification

The API workflow is [`../workflows/klein4b_multiref_api.json`](../workflows/klein4b_multiref_api.json). Its topology follows Comfy-Org's official [`image_flux2_klein_image_edit_4b_base.json`](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_flux2_klein_image_edit_4b_base.json): each input follows `LoadImage` → `ImageScaleToTotalPixels` → `VAEEncode`, and `ReferenceLatent` is chained onto both prompt conditionings before Base sampling. The shipped template demonstrates the multi-input branch with two references; core [`ReferenceLatent`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_edit_model.py) explicitly supports chaining, so this graph extends the same chain to the third anchor.

The class names and sockets were also checked against ComfyUI source: [`EmptyFlux2LatentImage` and `Flux2Scheduler`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_flux.py), [`ImageScaleToTotalPixels`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_post_processing.py), [`RandomNoise`, `CFGGuider`, `KSamplerSelect`, and `SamplerCustomAdvanced`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_custom_sampler.py), and the core loader/encode/decode/image nodes in [`nodes.py`](https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py). The ComfyUI [klein guide](https://docs.comfy.org/tutorials/flux/flux-2-klein) confirms the Base image-edit workflow and model family. BFL's official [`FLUX2_MODEL_INFO`](https://github.com/black-forest-labs/flux2/blob/main/src/flux2/util.py) gives the non-distilled 4B Base defaults of guidance 4.0 and 50 steps; those are the values here.

| Node IDs | Class | Purpose |
|---|---|---|
| 1 | `UNETLoader` | Load `flux-2-klein-base-4b.safetensors`. |
| 2 | `CLIPLoader` | Load `qwen_3_4b.safetensors` as `flux2`. |
| 3 | `VAELoader` | Load `flux2-vae.safetensors`. |
| 4–5 | `CLIPTextEncode` | Positive generation instruction and safety/quality negative prompt. |
| 6–8 | `LoadImage` | Load `creator-001/g04.jpg`, `g01.jpg`, and `g07.jpg` from ComfyUI `input/`. |
| 9–11 | `ImageScaleToTotalPixels` | Independently scale each reference to 1 MP with `nearest-exact`. |
| 12–14 | `VAEEncode` | Encode each scaled reference with the FLUX.2 VAE. |
| 15–17 | `ReferenceLatent` | Chain all three reference latents onto positive conditioning. |
| 18–20 | `ReferenceLatent` | Chain the same three reference latents onto negative conditioning. |
| 21 | `EmptyFlux2LatentImage` | Create the requested portrait or full-body output canvas. |
| 22 | `RandomNoise` | Supply fixed seed 100001. |
| 23 | `CFGGuider` | Non-distilled Base guidance at 4.0. |
| 24 | `Flux2Scheduler` | Resolution-aware 50-step Base schedule. |
| 25–26 | `KSamplerSelect`, `SamplerCustomAdvanced` | Euler sampler and advanced sampling path used by the official graph. |
| 27–28 | `VAEDecode`, `SaveImage` | Decode one output and expose it through ComfyUI history/`/view`. |

Model download declarations are copied from `probe-b-klein4b.yaml`: all three files come from the public `Comfy-Org/flux2-klein-4B` repackage and land in the standard `diffusion_models`, `text_encoders`, and `vae` directories.

## Upload staging and harness schema gap

The source-of-record files are:

| Manifest upload | Source of record | ComfyUI destination |
|---|---|---|
| `_uploads/g04.jpg` | `personas/anchors/gemini-batch-01/g04.jpg` | `input/creator-001/g04.jpg` |
| `_uploads/g01.jpg` | `personas/anchors/gemini-batch-01/g01.jpg` | `input/creator-001/g01.jpg` |
| `_uploads/g07.jpg` | `personas/anchors/gemini-batch-01/g07.jpg` | `input/creator-001/g07.jpg` |

The harness resolves `uploads.files` relative to the manifest directory and rejects `..`, absolute paths, and any resolved path outside that directory. The required source files are at repository-root `personas/`, so the manifest cannot name them directly. Without changing the harness, stage temporary hard links under the manifest directory before preflight or a live run, then remove them afterward:

```powershell
$stage = 'orgs/figment/pipeline/train/runs/_uploads'
New-Item -ItemType Directory -Force $stage | Out-Null
New-Item -ItemType HardLink -Path "$stage/g04.jpg" -Target 'personas/anchors/gemini-batch-01/g04.jpg' | Out-Null
New-Item -ItemType HardLink -Path "$stage/g01.jpg" -Target 'personas/anchors/gemini-batch-01/g01.jpg' | Out-Null
New-Item -ItemType HardLink -Path "$stage/g07.jpg" -Target 'personas/anchors/gemini-batch-01/g07.jpg' | Out-Null
```

The `uploads:` group sends the three staged files in manifest order to subfolder `creator-001`, with `type: input` and `overwrite: false`. `_dataset.ready` is not included: the harness does not require it for generation or training; when present, it only enforces that the marker be the final expanded upload.

After the run or dry-run:

```powershell
Remove-Item -Recurse -Force -LiteralPath 'orgs/figment/pipeline/train/runs/_uploads'
```

## Exact prompts

Every positive prompt is exactly the following shared lead, one ASCII space, and the cell tail listed below. This split is only for readable review; node 4 receives the already-concatenated full string in the manifest.

> A candid-but-flattering phone photo of the same woman as the reference images: an unambiguously adult woman around twenty-one with a face slightly sharper than round, softly full cheeks tapering to a small chin, almond eyes framed by sharp winged black liner and long defined lashes, groomed straight brows, glossy pink-nude naturally full lips, fair luminous skin with fine visible texture, and jet-black hair. She has a slim adult build with a clearly defined waist and strong waist-to-hip curve, toned arms and legs, and firm thighs that press lightly at the hems of fitted shorts; keep her lean and toned, not fuller-bodied or heavily athletic.

| # | Output name | Size | Exact prompt tail |
|---:|---|---:|---|
| 1 | `c001-exp01-front-close-seed-100001` | 1024×1280 | At eye level she faces the camera squarely in a close portrait showing her face and shoulders, wearing a fully opaque black corset top and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 2 | `c001-exp01-front-half-body-seed-100001` | 1024×1280 | At eye level she faces the camera squarely in a half-body portrait, wearing a fitted black camisole, a short dark skirt, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 3 | `c001-exp01-front-full-body-seed-100001` | 896×1536 | At eye level she faces the camera squarely in a head-to-toe full-body frame, wearing a fitted charcoal baby tee, snug black shorts that visibly press at the upper-thigh hems, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 4 | `c001-exp01-three-quarter-left-close-seed-100001` | 1024×1280 | She turns about forty-five degrees to show her left three-quarter view in a close portrait of face and shoulders, wearing a fully opaque burgundy bustier and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 5 | `c001-exp01-three-quarter-left-half-body-seed-100001` | 1024×1280 | She turns about forty-five degrees to show her left three-quarter view in a half-body portrait, wearing a fitted ivory camisole, snug dark shorts, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 6 | `c001-exp01-three-quarter-left-full-body-seed-100001` | 896×1536 | She turns about forty-five degrees to show her left three-quarter view in a head-to-toe full-body frame, wearing a fitted black tee, snug denim shorts that visibly press at the upper-thigh hems, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 7 | `c001-exp01-three-quarter-right-close-seed-100001` | 1024×1280 | She turns about forty-five degrees to show her right three-quarter view in a close portrait of face and shoulders, wearing a fully opaque black lace-trim camisole and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 8 | `c001-exp01-three-quarter-right-half-body-seed-100001` | 1024×1280 | She turns about forty-five degrees to show her right three-quarter view in a half-body portrait, wearing a fitted charcoal baby tee, a short pleated black skirt, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 9 | `c001-exp01-three-quarter-right-full-body-seed-100001` | 896×1536 | She turns about forty-five degrees to show her right three-quarter view in a head-to-toe full-body frame, wearing a fitted wine-red corset top, snug black shorts that visibly press at the upper-thigh hems, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 10 | `c001-exp01-profile-left-close-seed-100001` | 1024×1280 | She is shown in a clean left profile with one ear visible in a close portrait of face and shoulders, wearing a fully opaque dark satin corset top and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 11 | `c001-exp01-profile-left-half-body-seed-100001` | 1024×1280 | She is shown in a clean left profile with one ear visible in a half-body portrait, wearing a fitted black camisole, snug faded-denim shorts, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 12 | `c001-exp01-profile-left-full-body-seed-100001` | 896×1536 | She is shown in a clean left profile with one ear visible in a head-to-toe full-body frame, wearing a fitted white baby tee, snug dark shorts that visibly press at the upper-thigh hems, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering but not polished or studio-made. |
| 13 | `c001-exp01-from-above-close-seed-100001` | 1024×1280 | The phone is held slightly above her eye line and angled down for a close portrait of face and shoulders, wearing a fully opaque black bustier and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering and anatomically natural without wide-angle distortion. |
| 14 | `c001-exp01-from-above-half-body-seed-100001` | 1024×1280 | The phone is held above her and angled down for a half-body portrait, wearing a fitted pale-grey camisole, snug black shorts, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering and anatomically natural without wide-angle distortion. |
| 15 | `c001-exp01-from-above-full-body-seed-100001` | 896×1536 | The phone is held above her and angled down while keeping her head-to-toe body in frame, wearing a fitted black cami, snug denim shorts that visibly press at the upper-thigh hems, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering and anatomically natural without wide-angle distortion. |
| 16 | `c001-exp01-from-below-close-seed-100001` | 1024×1280 | The phone sits slightly below her chin and angles gently upward for a close portrait of face and shoulders, wearing a fully opaque deep-red corset top and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering and anatomically natural without wide-angle distortion. |
| 17 | `c001-exp01-from-below-half-body-seed-100001` | 1024×1280 | The phone sits slightly below chest height and angles gently upward for a half-body portrait, wearing a fitted white baby tee, a short black skirt, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering and anatomically natural without wide-angle distortion. |
| 18 | `c001-exp01-from-below-full-body-seed-100001` | 896×1536 | The phone sits near hip height and angles gently upward while keeping her head-to-toe body in frame, wearing a fitted black baby tee, snug grey shorts that visibly press at the upper-thigh hems, and layered thin silver chains. Flat white bedroom light, relaxed pout, natural pores, subtle phone-camera grain, candid framing, flattering and anatomically natural without wide-angle distortion. |
| 19 | `c001-exp01-window-daylight-half-body-seed-100001` | 1024×1280 | In a three-quarter half-body view beside a bedroom window, she wears a fitted black camisole, snug faded-denim shorts, and layered thin silver chains. Soft natural window daylight rolls across her face, with a relaxed pout, natural pores, slight phone-camera grain, and casual arm's-length framing that feels candid, flattering, and unstaged. |
| 20 | `c001-exp01-lamp-night-half-body-seed-100001` | 1024×1280 | In a front half-body bedroom view at night, she wears a fully opaque burgundy corset top, a short black skirt, and layered thin silver chains. One shaded bedside lamp gives warm low light and honest shadow falloff, with a relaxed pout, natural pores, slight phone-camera grain, and casual handheld framing that feels candid, flattering, and unstaged. |
| 21 | `c001-exp01-on-camera-flash-half-body-seed-100001` | 1024×1280 | In a right three-quarter half-body party snapshot, she wears a fitted white baby tee, snug black shorts, and layered thin silver chains. Direct on-camera phone flash creates crisp falloff against a dim ordinary room while retaining fine skin texture, with a relaxed pout, slight sensor grain, spontaneous composition, and a candid flattering finish rather than a commercial studio look. |
| 22 | `c001-exp01-car-interior-half-body-seed-100001` | 1024×1280 | Seated in a parked car in a left three-quarter half-body view, she wears a fitted dark satin camisole, snug charcoal shorts, and layered thin silver chains. Mixed dashboard glow and soft street light shape the car interior, with a relaxed pout, natural pores, slight phone-camera grain, casual arm's-length framing, and a candid flattering late-night finish. |
| 23 | `c001-exp01-mirror-selfie-half-body-seed-100001` | 1024×1280 | In a bedroom mirror half-body selfie, she wears a fully opaque black corset top, a short pleated skirt, and layered thin silver chains, with the phone naturally visible in one hand. Flat white room light, relaxed pout, natural pores, slight phone-camera grain, an ordinary lived-in background, and an informal flattering composition that is candid rather than studio-polished. |
| 24 | `c001-exp01-bathroom-mirror-half-body-seed-100001` | 1024×1280 | In a bathroom mirror half-body selfie, she wears a fitted pale-pink camisole, snug black shorts, and layered thin silver chains, with the phone naturally visible in one hand. Plain overhead bathroom light reflects softly from tile without smoothing her skin, with a relaxed pout, natural pores, slight phone-camera grain, and an everyday flattering composition that feels candid and unretouched. |

The exact negative prompt in node 5 is:

> underage appearance, adolescent features, childlike proportions, nudity, exposed breasts, exposed genitals, transparent clothing, broken clothing, fuller heavy build, bodybuilding physique, plastic skin, heavy bronzer, facial contouring, augmented lips, studio glamour photograph

## Eye-gate

1. Confirm exactly 24 non-empty outputs exist and build a 6×4 review grid in manifest order. If ImageMagick is available:

   ```powershell
   magick montage '<output-dir>/c001-exp01-*.png' -tile 6x4 -geometry 224x336+6+6 '<output-dir>/creator-001-expansion-01-grid.jpg'
   ```

2. The operator views the full grid before accepting any cell. Hard-fail and quarantine any image that is not unambiguously adult; resembles a real person; departs from the g04/g01/g07 fictional identity; shifts rounder than the sharper-leaning face target; drifts toward a fuller or heavily athletic body; misses the slim, toned waist/hip target; contains broken or unexpectedly revealing clothing; has malformed anatomy; or has plastic skin, bronzer/contour, augmented-looking lips, or a commercial studio finish. A declared age never overrides a youthful visual read.

3. Score the output directory against g04 as the face anchor. `--out` is a report directory, not a JSON filename; the checker writes `identity_report.json` and `rulings.json` inside it and fails closed when embeddings or thresholds are unavailable.

   ```powershell
   py -3 orgs/figment/pipeline/train/identity_check.py --anchor personas/anchors/gemini-batch-01/g04.jpg --images '<output-dir>' --out '<output-dir>/identity-check'
   ```

4. Keep only cells that pass both the automated check and the operator's visual gate. Automation does not waive the adult-read, clothing-integrity, identity, body-target, or real-person-likeness checks.
