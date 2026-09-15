# Reference-model fallback readiness — 2026-09-09

## Decision

The initial review found no evidence-backed new live fallback among
Qwen-Image-Edit-2511 and FLUX.2 Klein 4B. The requested offline workflow diff then
found a material difference in the current official Qwen graph. Qwen therefore
remains an **offline graph-adapter candidate**, while Klein is closed. Neither is
ready for a paid run or an identity claim.

This correction does not overturn Figment's prior full-resolution failures. It
identifies an official reference-assembly path that those completed graphs did
not test. Its effect on creator-001 is unknown pending review of the completed
Omni pair and a separately bounded Qwen experiment.

| Candidate | Commercial-capable components | Reference input | Figment evidence | Readiness |
|---|---|---|---|---|
| Qwen-Image-Edit-2511 | Yes, with the established Apache-pinned encoder source described below | Native one-to-many image editing | Prior runs failed, but they did not use the official source-latent and dual-conditioning assembly | Offline graph-adapter candidate only |
| FLUX.2 Klein 4B / 4B Base | Yes; Apache-2.0 | Native single- and multi-reference editing | Distilled multi-reference and Base edit-as-canvas paths already failed creator-001 | Closed as a fallback; retain only as a historical control |

## Qwen-Image-Edit-2511 proof packet

The [official Qwen card](https://huggingface.co/Qwen/Qwen-Image-Edit-2511)
declares Apache-2.0, identifies a 20B BF16 model, and demonstrates a list of input
images using `QwenImageEditPlusPipeline`. Its reference code uses 40 steps,
`true_cfg_scale=4.0`, and `guidance_scale=1.0`. The claimed improvement in
character consistency is publisher evidence, not a Figment result.

The [official ComfyUI guide](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511)
provides the native workflow and names four components: the BF16 diffusion model,
Qwen 2.5 VL 7B FP8 encoder, Qwen Image VAE, and an optional four-step Lightning
LoRA. The newer [INT8 workflow](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_edit_2511_int8.json)
substitutes `qwen_image_edit_2511_int8_convrot.safetensors`. Quantization alone is
not the reason to retest. The material delta was found in the primary official
2511 workflow described below.

### Components and size

| Component | Public source and licence status | Verified public size / digest |
|---|---|---|
| BF16 edit model | [Comfy-Org Qwen edit repackage](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/blob/main/split_files/diffusion_models/qwen_image_edit_2511_bf16.safetensors), Apache-2.0 metadata | 40.9 GB; SHA-256 `ae42d927b5fac4f278b9a894554c727e619727a63622976f2d95625be4bce08c` |
| INT8 ConvRot edit model | [Comfy-Org Qwen edit repackage](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/blob/main/split_files/diffusion_models/qwen_image_edit_2511_int8_convrot.safetensors), Apache-2.0 metadata | 20.5 GB; SHA-256 `11b5af5ac601821d73930c84846c9a158e67177356daf927ce1c8d10f3963829` |
| Qwen 2.5 VL 7B FP8 encoder | Upstream [Qwen2.5-VL-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct) is Apache-2.0. Use Figment's already verified `Comfy-Org/Qwen-Image_ComfyUI` revision `25608066f9bf5cdc28020836ce9549587053f346`, not the current template's Hunyuan-repository URL, whose repository-level licence metadata is different. | 9.38 GB; SHA-256 `cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4` |
| Qwen Image VAE | [Comfy-Org Qwen Image repackage](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/blob/main/split_files/vae/qwen_image_vae.safetensors), Apache-2.0 metadata | 253,806,246 bytes; SHA-256 `a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f` |
| Optional four-step Lightning LoRA | [lightx2v/Qwen-Image-Edit-2511-Lightning](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/tree/main), Apache-2.0 metadata | about 850 MB |
| Runtime | [ComfyUI](https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE), GPL-3.0 | Pin an exact commit before any manifest is built |

This is a component-licence inventory, not legal advice. Apache-2.0 and GPL-3.0
permit commercial use subject to their conditions. The current INT8 template's
encoder link points into `Comfy-Org/HunyuanVideo_1.5_repackaged`; using the
byte-identical, previously verified Qwen Image repackage pin avoids inheriting an
unclear repository-level provenance statement.

The BF16 file plus encoder and VAE total about 50.5 GB before runtime memory,
activations, and allocator overhead. The official Qwen card gives no 48 GB
end-to-end guarantee, so `pipeline.to("cuda")` must not be described as fitting an
L40S. The INT8 stack is about 30.1 GB of core weights, or roughly 31 GB with the
optional LoRA. Figment's prior FP8 mixed Qwen stack did execute on a 48 GB L40S;
that proves the prior stack's fit, not the newer INT8 workflow's peak memory.

Most importantly, this is not a new model test. Figment's
[`m1-RESULTS.md`](../../orgs/figment/pipeline/expand/bakeoff/m1-RESULTS.md)
records Qwen-Image-Edit-2511 at 26 steps across three references with and without
the skin LoRA. Median visual same-person scores were 59–61, and the skin LoRA
reduced the automated identity score. Earlier Lightning outputs reached a median
78 but were still rejected as sufficient identity evidence. INT8 or ConvRot may
change speed and quantization error; no primary source says it repairs this
identity failure.

## FLUX.2 Klein 4B control

BFL's [official model table](https://github.com/black-forest-labs/flux2) lists both
4B distilled and 4B Base as Apache-2.0 and supporting single- and multi-reference
editing. The [official ComfyUI guide](https://docs.comfy.org/tutorials/flux/flux-2-klein)
provides separate Base and distilled image-edit workflows and reports, on an RTX
5090, about 8.4 GB VRAM / 1.2 seconds for distilled and 9.2 GB / 17 seconds for
Base. Those figures establish runnable scale on that hardware, not identity
fidelity or L40S timing.

Figment already pinned and ran the Apache 4B family: approximately 7.75 GB for the
diffusion model, 8.04 GB for `qwen_3_4b.safetensors`, and 0.34 GB for the VAE.
Its free multi-reference and Base edit-as-canvas attempts lost the required
identity, age, or skin quality. The official workflow confirms that the method was
real; it supplies no new mechanism that warrants repeating those failed tests.
The 9B variants remain outside this commercial-capable shortlist under BFL's
non-commercial licence.

## Completed official-workflow semantic diff

The small official workflow was fetched without weights and pinned to
[`image_qwen_image_edit_2511.json` at commit
`a861fcde234d5cda3095087c509858fb001a6093`](https://github.com/Comfy-Org/workflow_templates/blob/a861fcde234d5cda3095087c509858fb001a6093/templates/image_qwen_image_edit_2511.json),
committed 2026-07-13. The file is 59,130 bytes with SHA-256
`d561a38c15bd7d08758a5e6773d467142244d5b83fc5d3aecdf6d8df9fe881b6`.
Its `Image Edit (Qwen-Image 2511)` subgraph is
`cdb2cf24-c432-439b-b5c8-5f69838580c9`.
The comparison targets were the completed
[`m1_api.json`](../../orgs/figment/pipeline/expand/bakeoff/m1_api.json),
[`tensor_dataset_v2_api.json`](../../orgs/figment/pipeline/expand/workflows/tensor_dataset_v2_api.json),
and
[`tensor_dataset_fullbody_api.json`](../../orgs/figment/pipeline/expand/workflows/tensor_dataset_fullbody_api.json)
graphs.

| Edge or node | Official pinned workflow | Completed M1 and Lightning graphs | Result |
|---|---|---|---|
| Reference encoding | Nodes 149 and 151 are separate `TextEncodeQwenImageEditPlus` encoders; both receive the reference images for negative and positive conditioning | References feed the positive encoder; negative is `ConditioningZeroOut` of positive | Materially different |
| Reference conditioning | Nodes 147 and 148 apply `FluxKontextMultiReferenceLatentMethod(index_timestep_zero)` to the two conditioning branches | No `FluxKontextMultiReferenceLatentMethod` | Materially different |
| Starting latent | Node 160 `FluxKontextImageScale` scales image 1, then node 156 `VAEEncode` supplies `KSampler.latent_image` | M1 and Lightning generation start from `EmptyLatentImage` | Materially different |
| Core model setup | `ModelSamplingAuraFlow` shift 3.1, Euler/simple, with switches for 40-step CFG 4 native or optional 4-step CFG 1 Lightning | Those model and sampling families were already exercised | Control, not the new hypothesis |

The full-body Lightning graph does VAE-encode an earlier generated image for a
low-denoise face-detail post-pass, but it does not use the official dual reference
conditioning or reference-method nodes for full-frame generation. That post-pass
is not equivalent to the official path above.

## Bounded build brief

Retain Qwen as one untested official-workflow hypothesis. A later offline adapter
may use the already pinned FP8 Qwen stack that previously fit the L40S and preserve
the official graph's combined change as a declared unit: reference images into
both positive and negative `TextEncodeQwenImageEditPlus` nodes, both branches
through `FluxKontextMultiReferenceLatentMethod(index_timestep_zero)`, and scaled
image 1 through `VAEEncode` as the sampler latent. Use the same approved g01
reference pair, two 768-pixel outputs, and fixed seeds so the comparison isolates
that official assembly. Pin the native ComfyUI node support, this source workflow
commit and digest, the existing Apache component revisions and digests, and pass
the existing harness dry-run before any provider action.

The existing FP8 source pins are: edit UNET revision
`4c7c4ea236326cbae56d403d22a03c6cd86ad9a0`, SHA-256
`c9fdc158e46d3b61ef75f21ae866ca2fe808bf4a53643120d1c1e87c19280a4e`;
encoder revision `25608066f9bf5cdc28020836ce9549587053f346`, SHA-256
`cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4`;
and VAE revision `dfe60a0d63f0b946628080f070978594983b8b6e`, 253,806,246 bytes,
SHA-256 `a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f`.
Local evidence records the UNET and encoder as approximately 20.5 GB and 9.38 GB;
an adapter manifest must take their exact byte counts from pinned repository
metadata rather than round those figures.

No graph, manifest, weights, or live request is created by this review. The
official workflow proves a different assembly, not better identity. Assess the
completed Omni pair first; whether this Qwen path improves identity remains the
next research hypothesis and is currently unknown. Klein remains closed because
its official workflow did not expose a corresponding untested mechanism.
