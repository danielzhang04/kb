# Local g01 full-frame versus face-crop conditioning protocol

## Status and question

This is a design for one later local diagnostic. It does not crop an image,
start ComfyUI, generate media, change the current canonical source, or create
an identity, quality, approval, or promotion claim. The baseline must first
finish and receive its ordinary original-resolution visual review. Only then
may a separately admitted execution decide whether the comparison is warranted.

The question is narrow: does replacing the full g01 pixel input with one
deterministic crop of the **same original g01** change the local IP-Adapter
conditioning result under otherwise identical settings? It is not a fair Krea
comparison and cannot establish an exact-identity pass.

## Frozen source and crop method

The sole source is the declared canonical
`orgs/figment/personas/creator-001/anchors/g01.jpg`, SHA-256
`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`,
decoded size 1408 x 768. It remains an original fictional, adult-presenting,
clothed reference; this procedure adds no person, reference chain, resynthesis,
or upscale.

The reviewed fixed640 V2 receipt mapped g01's one-face detector rectangle back
to original pixels as `(x=635.7533, y=118.0524, width=135.4918,
height=181.7831)`. That detector rectangle is a repeatable geometry input, not
an identity measurement or crop-quality decision. Its recorded provenance and
limits are in [raw reference observations](2026-09-08-raw-reference-observations.md)
and [canonical seed adequacy](2026-09-08-canonical-seed-adequacy.md).

The future crop is fixed as the integer Pillow box `(512, 17, 896, 401)`: a
384 x 384 square in g01's original coordinate system. It contains the mapped
detector rectangle with approximately 123.8 px left, 124.8 px right, 101.1 px
top, and 101.2 px bottom margin. Those vertical margins deliberately retain
forehead and chin context instead of making a tight detector-box crop. The box
is in bounds and has no scale operation.

If a later admitted compiler materializes it, it must:

1. Hash the original g01 bytes before and after its bounded read, require the
   SHA-256 and 1408 x 768 JPEG decode above, and refuse reparse paths.
2. Decode the original pixels once, crop exactly `(512, 17, 896, 401)`, and
   encode that 384 x 384 RGB pixel region as a new deterministic PNG named
   `g01-face384-crop-v1.png`. Record the Pillow version, PNG encoder settings,
   output byte SHA-256, dimensions, and parent g01 SHA-256.
3. Refuse an out-of-bounds box, source mutation, source-format mismatch,
   output collision, reparse output, or any resize, interpolation, face
   detection, or generated-image input. The PNG is a retained deterministic
   derivative of g01, not a new reference or a generated candidate.

No crop file or expected crop SHA exists yet. Its SHA becomes evidence only
after a future compiler produces and hashes it from the frozen source and
method.

## Why this is a plausible controlled input change

The installed, pinned non-FaceID IP-Adapter path sets `clipvision_size = 224`
in `ComfyUI_IPAdapter_plus/IPAdapterPlus.py` and calls
`encode_image_masked` with its default one tile. That helper invokes
`clip_preprocess(..., size=224)`. The pinned ComfyUI
`comfy/clip_model.py` implementation rescales by the short edge and then
center-crops a 224 x 224 square. These are local source observations at the
commits recorded by [the local capability note](2026-09-08-local-comfy-capability.md),
not model-quality evidence.

For full g01, this path scales by `224 / 768`, leaving a central roughly
768 x 768 original-pixel region. The mapped 135.4918 x 181.7831 detector
rectangle therefore occupies approximately 39.5 x 53.0 pixels in the CLIP
input. The proposed 384-square crop would be downsampled by `224 / 384`,
placing that same rectangle at about 79.0 x 106.0 pixels. This is a twofold
input-resolution change for the same detector rectangle; it neither proves
that face detail is retained nor predicts a better result.

## Future paired-manifest contract

Both conditions use the same local launcher and all of the following unchanged:

| Field | Frozen shared value |
| --- | --- |
| Pixel ancestry | Original g01 only; full condition uses `g01.jpg`, crop condition uses the deterministic child described above. |
| Model and code | The same hash-verified RealVisXL V5 fp16, IP-Adapter Plus-Face SDXL ViT-H through non-FaceID CLIP vision, CLIP ViT-H, ComfyUI commit, and IP-Adapter commit. |
| Text and generation | Same persona-derived rendered positive prompt, negative prompt, seed `481516234`, 1024 x 1024 output, 24 steps, DPM++ 2M, Karras, CFG 6.0, and IP-Adapter settings. |
| Runtime | Same local-only launcher, disabled API nodes, only the allowed IP-Adapter plugin, fresh private run root, one graph, and teardown evidence. |
| Review | The same original-resolution visual rubric: reference resemblance, adult presentation, intact opaque clothing, realism, and artifacts. Keep raw observer values separate and do not create a threshold. |

The API graphs must be structurally identical except node `2`
`LoadImage.inputs.image`: `g01.jpg` for full conditioning and
`g01-face384-crop-v1.png` for crop conditioning. The crop manifest must add its
derivation record, but may not add a second `LoadImage`, a FaceID/InsightFace
node, LoRA, ControlNet, custom node, model, prompt change, sampler change, or
extra output.

The controlled factor is **conditioning raster framing and face-pixel scale**.
It also removes full-scene context, so any visual difference cannot be assigned
to face scale alone. Results remain a local availability and conditioning
diagnostic, never an identity proof or a causal conclusion about Krea.

## Required tests before any future admission

1. Unit-test the source hash, JPEG decode dimensions, exact integer bounds, and
   the 384 x 384 crop dimensions; reject hash change, invalid box, resize, and
   reparse/symlink output paths.
2. Confirm output provenance binds the parent g01 hash, crop method/version,
   Pillow version and encoder settings, and child PNG hash without treating the
   child as a canonical reference.
3. Compare the two manifests structurally: only the documented reference
   derivation fields and node-2 `LoadImage` filename may differ. Assert every
   pinned model/code hash, prompt, seed, sampler, IP-Adapter input, graph node
   inventory, runtime flag, and single-output contract is equal.
4. Refuse crop execution unless the baseline has a completed teardown-backed
   receipt and a fresh independent visual review. Once the crop condition is
   complete, require fresh independent reviews of both conditions before
   drawing a comparison conclusion. No test may substitute a generated image
   or a numeric observer value for either review.
