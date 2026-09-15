# Qwen reference preparation review — 2026-09-09

## Verdict

**READY for root's offline-to-cloud launch decision.** The prepared graph matches
the pinned native ComfyUI source, uses one logical g01 reference, preserves the
official reference assembly, and stays within the declared 60-minute and $1.30
limits. This is readiness to run a research experiment, not evidence of identity
quality or production fitness.

The manifest's `export_authorized: false` and documentation saying that spend is
not approved are stale relative to the session's existing authorization for the
same g01 transfer, provider, and bounded $1.30/60-minute variation. They must not
create a new user gate. Root's live rate, ledger, and launch review remain normal
operational checks.

## Pinned evidence

- ComfyUI commit: `95d755cd8107a72258d452b5d3657273d571f07d`.
- Official workflow: `image_qwen_image_edit_2511.json`, commit
  `a861fcde234d5cda3095087c509858fb001a6093`, 59,130 bytes, SHA-256
  `d561a38c15bd7d08758a5e6773d467142244d5b83fc5d3aecdf6d8df9fe881b6`.
- Edit UNET: revision `4c7c4ea236326cbae56d403d22a03c6cd86ad9a0`,
  20,533,762,817 bytes, SHA-256
  `c9fdc158e46d3b61ef75f21ae866ca2fe808bf4a53643120d1c1e87c19280a4e`.
- Qwen 2.5 VL encoder: revision
  `25608066f9bf5cdc28020836ce9549587053f346`, 9,384,670,680 bytes,
  SHA-256 `cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4`.
- Qwen VAE: revision `dfe60a0d63f0b946628080f070978594983b8b6e`,
  253,806,246 bytes, SHA-256
  `a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f`.
- Staged g01: 737,366 bytes, SHA-256
  `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`.

## Native graph and dimensions

The compact graph has 15 nodes. A single `LoadImage` output enters
`FluxKontextImageScale`; the scaled image enters `image1` on both positive and
negative `TextEncodeQwenImageEditPlus` nodes and also enters the external
`VAEEncode` used as `KSampler.latent_image`. Optional `image2` and `image3` are
omitted. This matters because the pinned encoder implementation adds one vision
token group and one VAE reference latent for every non-null image input; repeating
g01 as `image2` would double-condition it.

Both conditioning branches pass through
`FluxKontextMultiReferenceLatentMethod` with the required
`reference_latents_method: index_timestep_zero`. The model path is
`UNETLoader` → `ModelSamplingAuraFlow(shift=3.1)` →
`CFGNorm(strength=1.0, pre_cfg=false)`. Sampling uses the two fixed seeds, 40
steps, CFG 4, Euler/simple, and denoise 1.0. There is no Lightning or skin LoRA.

At the pinned commit, `FluxKontextImageScale` chooses the preferred resolution
whose aspect ratio is closest to the source and calls the Lanczos scaler with
centre handling. For the 1408×768 g01, the exact selected canvas is **1392×752**.
Both dimensions are divisible by the Qwen VAE's spatial factor, so the external
encode and final decode preserve that canvas. The result is not 768×768.

The required inputs and return types of `TextEncodeQwenImageEditPlus`,
`FluxKontextMultiReferenceLatentMethod`, `FluxKontextImageScale`, `VAEEncode`,
`ModelSamplingAuraFlow`, `CFGNorm`, `KSampler`, and the three loaders were checked
directly against the pinned source. No missing required field equivalent to the
earlier Omni `resolution_steps` failure was found.

## Verification and limits

- Independent focused test rerun: **5 passed**. The first run produced two pytest
  setup errors because the default Windows temp root was inaccessible; rerunning
  with a fresh workspace-local `--basetemp` passed all five tests.
- The staged manifest contains 15 nodes, one g01 input, two seed jobs, the expected
  1392×752 dimensions, and the exact staged g01 digest and byte count.
- The runtime arithmetic is exact: 2,340 seconds readiness + two 480-second jobs
  + five minutes teardown = 60 minutes.
- The preparer's isolated CLI, fresh staging operation, existing-harness dry run,
  `py_compile`, and `git diff --check` passed in the implementation review.

This review did not start ComfyUI, load a model, contact a provider, upload an
asset, or obtain a live `/object_info` response. Compatibility is proven from the
pinned source and offline graph checks; it is not a live runtime attestation.
