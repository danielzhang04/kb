# Local OmniGen2 feasibility plan — 2026-09-08

## Decision

Use the installed ComfyUI core for one bounded, non-promotable OmniGen2
single-reference probe. This is the shortest local path because commit
`95d755cd8107a72258d452b5d3657273d571f07d` already contains native OmniGen2
model detection, its Qwen 2.5 VL tokenizer, `ReferenceLatent`, and the standard
loader, guider, scheduler, sampler, and VAE nodes. The official image-edit
template uses those core nodes and exactly three weight files. No custom node or
new Python environment is needed. [Official ComfyUI tutorial](https://docs.comfy.org/tutorials/image/omnigen/omnigen2)
[Official edit workflow](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_omnigen2_image_edit.json)

This is a feasibility test, not evidence of identity quality or of fit on an
8 GB GPU. OmniGen2's own documented sequential-offload result below 3 GB VRAM
belongs to its Diffusers implementation. The installed ComfyUI path instead uses
Comfy model management and dynamic weight loading; its peak VRAM, resident RAM,
paging, and latency on this host are unmeasured. [OmniGen2 usage and resource notes](https://huggingface.co/OmniGen2/OmniGen2)

## Immutable inputs and licence boundary

Download only these paths, from one immutable revision, into a new private
models root. Start each request at the pinned `huggingface.co` resolve URL and
accept HTTPS redirects only to `huggingface.co`, `cdn-lfs.huggingface.co`,
`cdn-lfs-us-1.hf.co`, `cdn-lfs-eu-1.hf.co`, or
`cas-bridge.xethub.hf.co`. A signed CDN URL need not repeat the repository name.
Record the repository, revision, path, and final hostname, but do not persist a
signed URL or its query string. Reject any other host, a size mismatch, a fourth
file, or a SHA-256 mismatch.

| Role and target | Immutable source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Diffusion model, `diffusion_models/omnigen2_fp16.safetensors` | [`split_files/diffusion_models/omnigen2_fp16.safetensors@4876f222`](https://huggingface.co/Comfy-Org/Omnigen2_ComfyUI_repackaged/blob/4876f2222e35e269029e8d72aaff5b2aaaf73e1b/split_files/diffusion_models/omnigen2_fp16.safetensors) | 7,934,384,176 | `60dbde45107762d164bac463e1cf365e074b377fa843dc90cb2985fb211cd4de` |
| Text/vision encoder, `text_encoders/qwen_2.5_vl_fp16.safetensors` | [`split_files/text_encoders/qwen_2.5_vl_fp16.safetensors@4876f222`](https://huggingface.co/Comfy-Org/Omnigen2_ComfyUI_repackaged/blob/4876f2222e35e269029e8d72aaff5b2aaaf73e1b/split_files/text_encoders/qwen_2.5_vl_fp16.safetensors); its parent commit records the [exact LFS pointer](https://huggingface.co/Comfy-Org/Omnigen2_ComfyUI_repackaged/commit/5c9d710be8de914e707c76dba1b1af5dd5a5aee9) | 7,509,337,224 | `ba05dd266ad6a6aa90f7b2936e4e775d801fb233540585b43933647f8bc4fbc3` |
| FLUX 16-channel VAE, `vae/ae.safetensors` | [`split_files/vae/ae.safetensors@4876f222`](https://huggingface.co/Comfy-Org/Omnigen2_ComfyUI_repackaged/blob/4876f2222e35e269029e8d72aaff5b2aaaf73e1b/split_files/vae/ae.safetensors); the same parent commit records its addition | 335,304,388 | `afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38` |

The exact payload is **15,779,025,788 bytes (14.69 GiB)**, rather than the
31.3 GB full Diffusers repository. Both Comfy-Org repositories and OmniGen2's
code/model card declare Apache-2.0. The VAE lineage is FLUX: Lumina loads the
FLUX.1 VAE, and Black Forest Labs separately states that its autoencoder weights
are Apache-2.0 even though the FLUX.1-dev transformer has a different licence.
[Lumina VAE provenance](https://github.com/Alpha-VLLM/Lumina-Image-2.0/blob/main/demo.py)
[BFL component licence statement](https://github.com/black-forest-labs/flux/blob/main/README.md)

Commercial deployment is **not cleared by this research record**. OmniGen2 says
it inherits Qwen-VL-2.5, while the current upstream
`Qwen/Qwen2.5-VL-3B-Instruct` licence grants use only for non-commercial
purposes and requires a separate commercial licence. The Comfy repack and
OmniGen2 card do not explain how their Apache declaration resolves that upstream
encoder restriction. The local probe is viable as evaluation; commercial use
requires a rights-holder clarification or replacement encoder with a clear
chain. [Qwen 2.5 VL 3B licence](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE)
ComfyUI core is GPL-3.0; local execution is allowed, while redistribution of a
modified runtime would carry GPL obligations. No InsightFace or separate face
weights appear in this graph.

## Observed host and preflight

At observation time the host had 29.71 GiB physical RAM with 13.65 GiB
available, a 93.71 GiB commit limit with 67.25 GiB available, and 300.62 GiB
free disk. The RTX 4070 Laptop GPU reported 8,188 MiB total, 0 MiB used, and 0%
utilization. The Comfy venv contains Python 3.13.7, torch 2.11.0+cu128,
transformers 5.16.1, safetensors 0.8.0, and Pillow 12.3.0. The three target model
directories are presently empty. The tracked Comfy commit matches the pin and
has no tracked changes. Four existing untracked root files (`gen_history.json`,
`gen_start_ts.txt`, `server.pid`, `torch_install.pid`) must be inventoried in the
admission and left untouched; they are not evidence of an active process. The
probe owns only its isolated models, input, output, temp, and user roots.

Download sequentially to a `.part` file while hashing, then atomically rename.
Require at least **35 GiB free disk before download** and **20 GiB throughout**;
cap accepted model payload bytes at exactly 15,779,025,788. Before launching,
require at least **12.0 GiB available physical RAM**, **32.0 GiB available
commit**, 7,500 MiB free VRAM, the pinned Comfy commit and critical-file hashes,
an unused loopback port, and no other GPU process.

## Fixed two-image probe

Copy and hash only canonical g01 (`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`,
1408×768) into a fresh private input root. Start ComfyUI with
`--models-directory`, `--input-directory`, `--output-directory`,
`--temp-directory`, and `--user-directory` pointing at owned isolated roots,
plus an in-memory database; bind only `127.0.0.1`; disable API nodes, custom
nodes, and browser launch; and set `--reserve-vram 1.0`. Do not claim that
`--lowvram` reproduces Diffusers
sequential offload: the installed CLI says it has no effect while dynamic VRAM
is enabled.

Freeze the official one-reference edit graph with these changes only:

- Reference path: `LoadImage` → `ImageScaleToTotalPixels(area, 1.0)` →
  `VAEEncode` → one active `ReferenceLatent` chain. Disable the second reference.
- Output: `EmptySD3LatentImage`, 768×768, batch 1; do not inherit g01's aspect
  ratio through `GetImageSize`.
- Sampling: Euler, `simple` scheduler, 20 steps, denoise 1.0, regular
  `DualCFGGuider`, text guidance 5.0, image guidance 2.5. The 2.5 value is the
  lower edge of OmniGen2's documented in-context range and is not a sweep.
- Seeds: `481516234` and `90210`, sequentially in one owned process, exactly one
  PNG per seed.
- Positive prompt: `Using the woman in image 1 as the identity reference, create
  a waist-up photograph of the same fictional adult woman around twenty-one.
  Frame from the top of her head to below her waist, with both elbows visible and
  space above her head. Her torso and head turn slightly toward her own right
  (image-left) while her eyes look directly into the camera. She wears a plain
  opaque black crew-neck T-shirt in soft daylight against a plain warm off-white
  wall. Preserve her facial structure, eyelids, brows, nose, lips, jaw, hairline,
  and long center-parted jet-black hair; do not copy the source pose, crop,
  background, lighting, or clothing.`
- Negative prompt: `child, minor, nude, lingerie, explicit, extra person,
  duplicate person, deformed, blurry, bad anatomy, distorted face, extra limb,
  fused fingers, text, watermark, censor bar`.

The manifest must store the exact API graph, its canonical SHA-256, the official
template snapshot hash, all code/weight/input hashes, and the two seeds. Verify
each PNG's embedded prompt graph against the admitted graph and keep an exact
two-PNG output inventory.

## Runtime stops and evidence

Sample the owned process tree and system once per second with
`GlobalMemoryStatusEx`, `GetProcessMemoryInfo`, and `nvidia-smi`. Collect the
Windows `Memory\\Page Reads/sec` counter when available, but treat it as
descriptive telemetry: demand paging of memory-mapped weights can be healthy and
is not by itself a stall or stop condition. Stop the owned process tree, write a
failed receipt, and do not dispatch another row when any condition occurs:

- available physical RAM below **3.0 GiB** twice consecutively;
- available commit below **16.0 GiB** twice consecutively;
- owned-tree private bytes above **24.0 GiB** twice consecutively;
- GPU memory used above **7,500 MiB** for three consecutive samples;
- listener readiness exceeds **180 seconds**, either queued row exceeds **45
  minutes**, total process time exceeds **100 minutes**, the stderr journal
  exceeds 16 MiB, an unexpected file appears, or teardown cannot be verified
  within **30 seconds**.

The receipt records one-second time series, peaks, per-row load/render duration,
all hashes, output dimensions, embedded graphs, stderr hash, teardown, and raw
page-read observations or an unavailable reason. Memory and elapsed-time limits,
rather than page reads alone, decide whether a heavily paging run must stop.
After both outputs, root and independent visual reviews separately record resemblance
to g01's visible features, pose, background, apparent adulthood and qualitative
age fit, clothing, realism, and defects at original resolution.

Optionally run the already admitted `fixed-max-edge-640@1` YuNet/SFace observer
against each PNG and g01. Persist raw cosines or an unavailable reason only; no
threshold, pass field, ranking, or automatic decision is permitted. This adds no
new model or package. [Observer evidence and limits](2026-09-08-raw-reference-observations.md)

The study ends after two successful PNGs and reviews, or at the first runtime
stop. It does not rewrite the prompt, retry a seed, download a quantization, start
OmniGen v1, train anything, or promote an output. Any fallback needs its own
design and admission.
