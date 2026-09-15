# Wan 2.2 TI2V-5B diagnostic: visual audit

**Result: reject for production quality.** This was a completed, non-promotable diagnostic, not a checkpoint or operator approval.

## Evidence inspected

- The completed receipt records 81 PNGs, a 363-second readiness phase, 427.463 seconds elapsed, `estimated_actual_usd` $0.129426, and verified termination. Its `pod_id` is historical evidence only.
- I inspected all 81 ordered PNGs in `live-v1` and the assembled MP4 plus extracted first, middle, and last frames. The private contact sheet is `assembled-v1/all-81-contact-sheet.png`.
- Frame 1 is coherent and keeps the supplied scene. Small color/edge artifacts are visible early; the middle frame has broad translucent distortion and color streaks; later frames develop strong vertical rainbow bands, warped room geometry, and a blurred or obscured face. The final frames are unsuitable for identity or apparent-age assessment. The diagnostic does not support a production-quality result.

## Graph and source comparison

The frozen run manifest hashes the native API graph `d1020d3af19…` and uses the reviewed 5B diffusion model, Wan 2.2 VAE, and UMT5 text encoder. Its native nodes, VAE/model connections, `shift: 8`, 20 steps, CFG 5, `uni_pc`, and `simple` match the corresponding choices in the [official template at the reviewed revision](https://github.com/Comfy-Org/workflow_templates/blob/8f712b99e950a22cd60a04a73683c4fd370a6996/templates/video_wan2_2_5B_ti2v.json). The [pinned native node implementation](https://github.com/Comfy-Org/ComfyUI/blob/12d5279438bfefc058a269eae805ceab6047777f/comfy_extras/nodes_wan.py) defines the `Wan22ImageToVideoLatent` inputs used here. No mismatch was identified in these inspected wiring and settings; this does not exclude other implementation causes.

The run intentionally differs from the template's currently published 1280×704, 121-frame presentation: it uses 512×288 and 81 frames. The pinned ComfyUI implementation shows that `Wan22ImageToVideoLatent` receives only the start image and masks that initial input; it does not provide a continuing driver or later reference image. That makes long-horizon drift a plausible explanation, but does not prove it. The lower spatial budget is also a plausible contributor to the visible artifacts. The evidence does not establish a model, VAE, sampler, or prompt-causation defect.

## Controlled repair options

The parent selected a resolution-only test first: change only `Wan22ImageToVideoLatent.width` and `.height` from 512×288 to the official template's 1280×704 while retaining all 81 frames. That keeps the early and middle artifacts in the observed window instead of potentially hiding them by shortening the clip.

The earlier length-only alternative remains useful after that comparison: change only `Wan22ImageToVideoLatent.length` from 81 to 41, retaining the exact source image hash, graph/model pins, 512×288 resolution, seed, prompt, sampler settings, output naming discipline, and review rules. It tests temporal-horizon drift, not production readiness.

## Boundaries

No rerun, model download, production approval, or account action was performed in this audit.
