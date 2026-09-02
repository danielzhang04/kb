# P4 training scaffolding

This directory prepares, but does not launch, character-LoRA training. No model has been
downloaded and no GPU claim is made from a measured run here.

## Verified upstream shape

- diffusion-pipe's [README](https://github.com/tdrussell/diffusion-pipe#dataset-preparation)
  defines a dataset as image files with same-basename `.txt` captions in the same directory,
  and documents disk caching plus the `output_dir` run layout. Its
  [main TOML example](https://github.com/tdrussell/diffusion-pipe/blob/main/examples/main_example.toml)
  defines the top-level training keys, `[adapter]` LoRA rank, `[optimizer]`, activation
  checkpointing, and block swapping. The project example uses rank 32 and a conservative
  AdamW-family learning rate; the templates use rank 32, `5e-5`, and 1,600 steps as a Figment
  starting point for 40 images, with checkpoints every 200 steps. Upstream does not publish a
  model-specific 40-image character recipe, so those three values must be selected by held-out
  identity checks rather than treated as verified optima.
- The [supported-models document](https://github.com/tdrussell/diffusion-pipe/blob/main/docs/supported_models.md#z-image)
  defines `type='z_image'`, ComfyUI diffusion/VAE/Qwen3 paths, optional fp8, and states that
  Z-Image LoRAs are saved in ComfyUI rather than Diffusers format. Its
  [FLUX.2 section](https://github.com/tdrussell/diffusion-pipe/blob/main/docs/supported_models.md#flux-2)
  defines the klein 4B Base path, `type='flux2'`, Qwen3-4B encoder, `shift=3`, and explicitly
  says to train the nondistilled Base; its LoRAs are also saved in ComfyUI format. The output
  directory contains safetensors weights plus adapter JSON and a copy of the run config.
- diffusion-pipe provides no measured Z-Image Base or klein-4B LoRA matrix for 24 GB versus
  48 GB. The 48 GB path should start in bf16 with zero swapping. On 24 GB, Klein 4B should be
  measured first in bf16 with activation checkpointing; Z-Image starts with modest block
  swapping and may require fp8, whose upstream docs warn has a small quality cost. These are
  fail-closed trial settings, not verified fit claims. A measured OOM must stop the pod; it is
  not permission to expand time or spend.

## Transport and ordering

ComfyUI's current [`server.py`](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py#L358-L422)
shows that `POST /upload/image` reads multipart field `image`, defaults `type` to `input`,
accepts `subfolder`, rejects traversal outside the selected directory, writes the bytes, and
returns `{name, subfolder, type}`. The training template uses that endpoint for PNG, TXT,
rendered TOML, and a final `_dataset.ready` marker. The marker is uploaded last; the wrapper
script refuses any set other than 40 paired PNG/TXT files, trains only after the marker, copies
the newest LoRA to `/workspace/output/<trigger>.safetensors`, and exposes completion/failure
markers through `/view`. See `HARNESS-CHANGES.md` for the necessary harness implementation.

## Identity models and licenses

`identity_check.py` deliberately avoids InsightFace. Its face path uses
[facenet-pytorch](https://github.com/timesler/facenet-pytorch) under its
[MIT license](https://github.com/timesler/facenet-pytorch/blob/master/LICENSE.md); its scene/
appearance cohesion path uses Meta's DINOv2 code and standard weights, which the
[project README](https://github.com/facebookresearch/dinov2#license) and
[root license](https://github.com/facebookresearch/dinov2/blob/main/LICENSE) release under
Apache-2.0. Both are lazy-loaded only during a real CLI run. Tests inject mock embedders and
therefore download no weights.
