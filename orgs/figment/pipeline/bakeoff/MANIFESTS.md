# Bake-off manifests

These files are JSON-form YAML: JSON is valid YAML 1.2, and it avoids block-scalar features that the harness's deliberately small YAML parser does not implement. Both full manifests contain the same 54 prompt/seed/output-name triples from `trial-03-brief.md`. S1 and S3 are 1024x1280; S2 is 896x1536.

## Pod and bootstrap behavior

The full arms request one NVIDIA GeForce RTX 4090 in COMMUNITY cloud at an operator-checked ceiling of $0.50/hour. The documented fallback is an NVIDIA RTX A6000 (48 GB), but the harness accepts only one `gpu.type`; fallback therefore requires an operator to change that field before a retry. Both manifests request 60 GB container disk and a 60 GB ordinary ephemeral volume, with no network volume. The smoke manifest uses an RTX 3090 as the cheaper 24 GB proof target for Arm B.

The stock RunPod PyTorch image does not provide a guaranteed `/workspace/ComfyUI` checkout, while `runpod_run.py` tests `comfyui.root` before it runs the manifest start command. The manifests therefore set the harness root to the existing `/workspace`, download models into `/workspace/ComfyUI/models/*`, and use the idempotent `start_command` to initialize/fetch/checkout ComfyUI tag [v0.20.1](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.20.1), install its requirements, and start it with `--output-directory /workspace/output`. That tag is later than the required 0.3.76 floor. This also keeps the harness's output downloader correct because it looks under `<comfyui.root>/output`. No custom nodes are needed by either graph.

The harness downloads public Hugging Face files with `curl`, reuses non-empty files, installs no custom-node requirements, starts ComfyUI on loopback, submits each API graph, downloads results through SCP, and verifies pod deletion. It does not verify a downloaded model checksum.

## Arm A — Z-Image Base

Official graph basis: [ComfyUI Z-Image guide](https://docs.comfy.org/tutorials/image/z-image/z-image) and its [workflow JSON](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_z_image.json). The template calls Base responsive to negative prompts and records an original recommendation of 30–50 steps and CFG 3–5; this manifest uses 40 steps, CFG 4, `res_multistep`, `simple`, and AuraFlow shift 3.

| id | class | purpose |
|---:|---|---|
| 1 | UNETLoader | Load the BF16 Z-Image Base diffusion model. |
| 2 | CLIPLoader | Load Qwen3-4B with type `lumina2`. |
| 3 | VAELoader | Load `ae.safetensors`. |
| 4 | CLIPTextEncode | Encode each job's positive prompt. |
| 5 | CLIPTextEncode | Encode the fixed short negative prompt. |
| 6 | EmptySD3LatentImage | Create the shot-specific portrait latent. |
| 7 | ModelSamplingAuraFlow | Apply the official shift of 3. |
| 8 | KSampler | Sample at 40 steps / CFG 4 / res_multistep / simple. |
| 9 | VAEDecode | Decode the latent. |
| 10 | SaveImage | Save under the job output name. |

| file | public repo path | published size |
|---|---|---:|
| Z-Image Base | [Comfy-Org/z_image: z_image_bf16.safetensors](https://huggingface.co/Comfy-Org/z_image/blob/main/split_files/diffusion_models/z_image_bf16.safetensors) | 12.3 GB |
| Qwen3-4B | [Comfy-Org/z_image: qwen_3_4b.safetensors](https://huggingface.co/Comfy-Org/z_image/blob/main/split_files/text_encoders/qwen_3_4b.safetensors) | 8.04 GB |
| VAE | [Comfy-Org/z_image: ae.safetensors](https://huggingface.co/Comfy-Org/z_image/blob/main/split_files/vae/ae.safetensors) | 0.335 GB |
| **Total download** | [HF tree API](https://huggingface.co/api/models/Comfy-Org/z_image/tree/main?recursive=true&expand=true) | **20.675 GB** |

Bootstrap time: **ESTIMATE 12–25 minutes** on a 200–400 Mbps pod connection, including ComfyUI dependency installation. Per image on RTX 4090: **ESTIMATE 35–60 seconds** at these resolutions. Total 54-job compute: **ESTIMATE $0.25–$0.50** at $0.34/hour, depending on download throughput and offloading; the manifest's fail-closed 60-minute ceiling estimate is $0.50.

## Arm B — FLUX.2 klein 4B Base

Official graph basis: the current [ComfyUI Klein guide](https://docs.comfy.org/tutorials/flux/flux-2-klein), its [text-to-image workflow JSON](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_flux2_klein_text_to_image.json), and BFL's [model defaults](https://github.com/black-forest-labs/flux2/blob/main/src/flux2/util.py#L51-L61). BFL defines Base defaults of 50 steps and guidance 4; the manifest uses those values, the template's Euler sampler, and the resolution-aware `Flux2Scheduler`. It uses the full `qwen_3_4b.safetensors`, not FP4.

| id | class | purpose |
|---:|---|---|
| 1 | UNETLoader | Load the non-distilled 4B Base diffusion model. |
| 2 | CLIPLoader | Load Qwen3-4B with type `flux2`. |
| 3 | VAELoader | Load the FLUX.2 VAE. |
| 4 | CLIPTextEncode | Encode each job's positive prompt. |
| 5 | CLIPTextEncode | Encode the fixed short negative prompt. |
| 6 | EmptyFlux2LatentImage | Create the native 128-channel FLUX.2 latent. |
| 7 | RandomNoise | Generate noise from the job seed. |
| 8 | CFGGuider | Apply Base CFG 4 to positive/negative conditioning. |
| 9 | Flux2Scheduler | Build the 50-step resolution-aware sigma schedule. |
| 10 | KSamplerSelect | Select Euler, matching the template. |
| 11 | SamplerCustomAdvanced | Run the official advanced sampling chain. |
| 12 | VAEDecode | Decode the latent. |
| 13 | SaveImage | Save under the job output name. |
| 99 | KSampler | Disconnected seed-carrier compatibility node; see gap below. |

| file | public repo path | published size |
|---|---|---:|
| FLUX.2 klein Base 4B | [Comfy-Org alias: flux-2-klein-base-4b.safetensors](https://huggingface.co/Comfy-Org/flux2-klein-4B/blob/main/split_files/diffusion_models/flux-2-klein-base-4b.safetensors) | 7.75 GB |
| Qwen3-4B | [Comfy-Org alias: qwen_3_4b.safetensors](https://huggingface.co/Comfy-Org/flux2-klein-4B/blob/main/split_files/text_encoders/qwen_3_4b.safetensors) | 8.04 GB |
| VAE | [Comfy-Org alias: flux2-vae.safetensors](https://huggingface.co/Comfy-Org/flux2-klein-4B/blob/main/split_files/vae/flux2-vae.safetensors) | 0.336 GB |
| **Total download** | [HF tree API](https://huggingface.co/api/models/Comfy-Org/flux2-klein-4B/tree/main?recursive=true&expand=true) | **16.126 GB** |

Hugging Face currently redirects the requested `Comfy-Org/flux2-klein-4B` alias to the canonical repository `Comfy-Org/vae-text-encorder-for-flux-klein-4b`; the alias's resolve URLs remain the manifest source. Bootstrap time: **ESTIMATE 10–20 minutes** on a 200–400 Mbps connection. Per image on RTX 4090: **ESTIMATE 25–40 seconds**; ComfyUI documents about 17 seconds for Base on an RTX 5090. Total 54-job compute: **ESTIMATE $0.18–$0.35** at $0.34/hour; the fail-closed 60-minute ceiling estimate is $0.50.

## Smoke manifest

`smoke.yaml` contains only `trial-03-c01-s1-seed-100001`, uses the Arm B graph/models, caps runtime at 8 minutes, and has a fail-closed ceiling estimate of $0.0667. Its intended assertion is create → bootstrap → generate → download → terminate → verify. **ESTIMATE:** a fully cold 16.126 GB download may exceed eight minutes on a slow pod; this budget is realistic only with roughly 300 Mbps or better effective model-download throughput plus a short dependency install.

## Node-name verification

- Core loaders, text encode, KSampler, VAE decode, and image save: [ComfyUI `nodes.py`](https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py).
- Z-Image latent: [`comfy_extras/nodes_sd3.py`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_sd3.py).
- AuraFlow sampling patch: [`comfy_extras/nodes_model_advanced.py`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_model_advanced.py).
- FLUX.2 latent and scheduler: [`comfy_extras/nodes_flux.py`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_flux.py).
- RandomNoise, CFGGuider, KSamplerSelect, and SamplerCustomAdvanced: [`comfy_extras/nodes_custom_sampler.py`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_custom_sampler.py).

## Verification gaps and operator checks

- No live pod, weights, or image generation was permitted, so runtime VRAM, per-image timing, visual quality, and the ComfyUI API's treatment of the disconnected node 99 remain unverified.
- The harness auto-replaces only fields literally named `inputs.seed`, but the official FLUX.2 graph's RandomNoise node uses `inputs.noise_seed`. Each job explicitly substitutes `7.noise_seed`; disconnected node 99 supplies the required `inputs.seed` field so harness validation succeeds without changing the sampled path. Before spend, validate this compatibility shim against a local/current ComfyUI API or update the harness to support `noise_seed`.
- The official ComfyUI Klein page now highlights separate FP8 Base weights, while its linked workflow metadata and this brief specify the full Comfy-Org Base file. This manifest follows the brief and BFL Base filename.
- The requested A6000 fallback cannot be encoded alongside the 4090 because the harness schema accepts a single GPU type.
- Re-check live RunPod COMMUNITY availability/rate, confirm the selected image exposes SSH, and keep the operator's `--max-usd` at or below the manifest estimate before any live run.
