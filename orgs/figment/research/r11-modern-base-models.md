# R11 — modern open-weight image bases and the “Eromify layer”

Research date: 2026-09-02. This was a read-only public-source review: no models downloaded, no account/login, and no pod. The binding boundary remains that agents work only at the clothed Instagram register and explicit work is the operator’s on operator-controlled hardware ([GUARDRAILS](../pipeline/GUARDRAILS.md)).

## 1. Summary and two-arm shortlist

The target is an adult, round/soft-faced Asian-American woman in close/mid phone-camera bedroom/window light: warm visible pores and texture, soft-glam makeup, dark hair, and film-grain snapshot rather than studio/editorial finish ([target register](../pipeline/aesthetic-recipe.md#1-the-register-spec-phase-1--derived-from-reference-accounts)). Local calibration says a demographic noun in the main prompt can cause wardrobe/scene drift; keep any heritage term trailing and low weight ([lever result](../pipeline/lever-table.md#1-headline-finding-the-demographic-noun-cascade-effect--confirmed)).

| Arm | base and training form | public evidence |
|---|---|---|
| A | Tongyi-MAI/Z-Image Base plus owned persona LoRA | 6B Apache-2.0; Base is nondistilled and intended for fine-tuning; official ComfyUI and Union-ControlNet workflow. [model](https://huggingface.co/Tongyi-MAI/Z-Image/blob/main/README.md) [workflow](https://docs.comfy.org/tutorials/image/z-image/z-image) |
| B | FLUX.2 klein 4B Base plus owned persona LoRA | BFL marks 4B and 4B Base Apache-2.0 and calls 4B Base the fine-tuning/customization variant; native ComfyUI reference-image graph. [BFL table](https://github.com/black-forest-labs/flux2) [workflow](https://comfyanonymous.github.io/ComfyUI_examples/flux2/) |

These arms pass the stated licence/ownership/ComfyUI screen; this is not a claim that either will win a visual-quality test. Qwen-Image is an Apache-2.0 20B control (corrected 2026-09-02, see §9 — was misstated as 11B), but current native-node/pose evidence was not retrieved. [Qwen card](https://huggingface.co/Qwen/Qwen-Image)

FLUX.2 dev, FLUX.2 klein 9B, FLUX.1 dev, and FLUX.1 Kontext dev are non-commercial weights. HiDream’s transformer is MIT but its shipped Llama encoder has separate terms. Wan 2.2 is a video family, not a 1024px still base. [BFL licences](https://github.com/black-forest-labs/flux2/tree/main/model_licenses) [HiDream](https://huggingface.co/HiDream-ai/HiDream-I1-Full) [Wan](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B)

## 2. Comparison table

Parameters are not 1024px runtime-VRAM measurements. ESTIMATE below means raw bf16 weights only (parameters × 2 bytes), excluding encoders, VAE, activations and overhead.

| candidate | licence, commercial and adult terms | parameters / memory | ComfyUI and LoRA training | pose / identity / realism |
|---|---|---|---|---|
| Z-Image Base/Turbo | Apache-2.0: commercial derivatives allowed; no model-specific adult clause. [model](https://huggingface.co/Tongyi-MAI/Z-Image) [licence](https://www.apache.org/licenses/LICENSE-2.0) | 6B; bf16 ESTIMATE 12GB. Official guide says Turbo fits 16GB, not Base at 1024. [guide](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo) | Core support v0.3.75; v0.3.76 adds Z-Image LoRA support. Diffusers has 1024px LoRA example; diffusion-pipe supports ComfyUI-format output. [changelog](https://docs.comfy.org/changelog) [trainer](https://github.com/huggingface/diffusers/blob/main/examples/dreambooth/README_z_image.md) | Corrected 2026-09-02 (see §9): the Turbo Fun Union ControlNet is multi-control — "Canny, HED, Depth, Pose, and MLSD" — so pose conditioning exists for Z-Image Turbo; Base compatibility and an identity adapter remain unverified. Publisher calls it photorealistic; no controlled third-party AI-look test retrieved. [ControlNet repo](https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union) [guide](https://docs.comfy.org/tutorials/image/z-image/z-image) |
| Qwen-Image/Edit | Apache-2.0; no adult clause retrieved. [Image](https://huggingface.co/Qwen/Qwen-Image) [Edit](https://huggingface.co/Qwen/Qwen-Image-Edit) | 20B (corrected 2026-09-02, see §9 — was misstated as 11B); bf16 ESTIMATE 40GB. Diffusers 4-bit example reports 14.93GB, not 1024px ComfyUI VRAM. [example](https://huggingface.co/docs/diffusers/v0.40.0/quicktour) | ai-toolkit includes Image/Edit; diffusion-pipe documents a 24GB 640px swapping recipe, not 1024. [registry](https://github.com/ostris/ai-toolkit/blob/main/extensions_built_in/diffusion_models/__init__.py) [pipe](https://github.com/tdrussell/diffusion-pipe/blob/main/docs/supported_models.md) | Pose, ID adapter, native node/version, independent comparison not verified. |
| FLUX.2 klein 4B/9B/dev | 4B and 4B Base Apache. 9B/9B KV/9B Base/dev non-commercial (confirmed 2026-09-02: the BFL table lists six variants, including a "9B KV" row not previously named here — all non-Apache rows share one licence file): “You may only access, use, Distribute, or create Derivatives ... for Non-Commercial Purposes.” [table](https://github.com/black-forest-labs/flux2) [licence](https://github.com/black-forest-labs/flux2/blob/main/model_licenses/LICENSE-FLUX-DEV) | 4B/9B/32B; bf16 ESTIMATE 8/18/64GB. BFL calls dev H100-equivalent; no 1024 matrix. [repo](https://github.com/black-forest-labs/flux2) | Native support v0.3.72 and optional multi-reference graph. ai-toolkit/diffusion-pipe list support; no stable 1024 persona config retrieved (confirmed 2026-09-02: no config/examples/*.yaml exists for klein in ai-toolkit — issue #543 closed "not planned", see §10). [changelog](https://docs.comfy.org/changelog/index) [workflow](https://comfyanonymous.github.io/ComfyUI_examples/flux2/) | Multi-reference edit native; pose and commercial ID adapter not verified for 4B specifically (see §10 gap 3 — pose LoRAs found target the 9B variant). BFL realism example is not an independent test. |
| FLUX.1 dev/Kontext | FLUX.1 dev non-commercial. Corrected 2026-09-02 (see §9): the “To create non-consensual nudity or illegal pornographic content” line is from the model card’s Out-of-Scope Use section, not LICENSE.md. LICENSE.md’s own content restriction (§vii) instead reads “to generate unlawful content, including child sexual abuse material, or non-consensual intimate images.” Commercial fine-tuning is excluded from non-commercial purpose — LICENSE.md §1.c: “(c) to train, fine tune or distill other models for commercial use” (verified). [licence](https://huggingface.co/black-forest-labs/FLUX.1-dev/blob/main/LICENSE.md) [model card](https://github.com/black-forest-labs/flux/blob/main/model_cards/FLUX.1-dev.md) [Kontext](https://github.com/black-forest-labs/flux/blob/main/model_cards/FLUX.1-kontext-dev.md) | 12B; bf16 ESTIMATE 24GB; no primary 1024 fp8/GGUF number. | ComfyUI/reference-edit support exists, but commercial LoRA is blocked by licence. | No commercial-clean ID adapter or controlled comparison retrieved. |
| HiDream-I1 Full | Transformer MIT; Llama 3.1 encoder has Llama Community Licence. Content condition: “Do not create illegal content, harmful material, personal information that could harm others, false information, or content targeting vulnerable groups.” No adult-specific clause retrieved. [card](https://huggingface.co/HiDream-ai/HiDream-I1-Full) | 17B; bf16 ESTIMATE 34GB; ai-toolkit says ~35.2GB training. [config](https://github.com/ostris/ai-toolkit/blob/main/config/examples/train_lora_hidream_48.yaml) | Official ComfyUI graph; experimental 512/768/1024, 3,000-step ai-toolkit config. [workflow](https://comfyanonymous.github.io/ComfyUI_examples/hidream/) | Pose/ID adapter not verified; publisher quality claim only. |
| Wan 2.2 as T2I | Apache-2.0 metadata; no adult clause retrieved. [card](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B) | 14B T2V/I2V and 5B TI2V video models; no comparable 1024 still base. | Native package and training-family support, not proof of still persona LoRA. [package](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged) | Video evidence is not comparable to T2I portrait realism. |
| Extra 2026: ERNIE-Image | Apache-2.0; no adult clause retrieved. [card](https://huggingface.co/baidu/ERNIE-Image) | 8B; bf16 ESTIMATE 16GB; no 1024 measurement. | Diffusers only; no adequate ComfyUI/LoRA/pose/ID source retrieved. | Publisher claims realistic photography; independent test not retrieved. |

InsightFace is a separate commercial blocker: FaceID’s card says its face component is InsightFace-derived/non-commercial, and InstantID’s discussion has the same antelopev2 caveat. [FaceID](https://huggingface.co/h94/IP-Adapter-FaceID) [InstantID](https://huggingface.co/InstantX/InstantID/discussions/2)

## 3. Candidate detail

### Z-Image

The official card describes Base as the nondistilled foundation model; Turbo is speed-distilled. The official ComfyUI guide identifies a 6B single-stream DiT, component locations, and a starter workflow. [card](https://huggingface.co/Tongyi-MAI/Z-Image/blob/main/README.md) [guide](https://docs.comfy.org/tutorials/image/z-image/z-image) Diffusers publishes a 1024px LoRA starter: bf16, batch 1, checkpointing, cached latents, 500 steps and 1e-4 LR. It is a recipe, not a time/VRAM benchmark. [trainer](https://github.com/huggingface/diffusers/blob/main/examples/dreambooth/README_z_image.md) diffusion-pipe documents its matching Z-Image configuration and ComfyUI LoRA output. [pipe](https://github.com/tdrussell/diffusion-pipe/blob/main/docs/supported_models.md)

### Qwen-Image / Edit

Both public cards use Apache-2.0. ai-toolkit registers Image, Edit and Edit Plus. diffusion-pipe says a 24GB Qwen LoRA uses block swapping at 640px and says it does not know if Edit fits 24GB. [Image](https://huggingface.co/Qwen/Qwen-Image) [registry](https://github.com/ostris/ai-toolkit/blob/main/extensions_built_in/diffusion_models/__init__.py) [pipe](https://github.com/tdrussell/diffusion-pipe/blob/main/docs/supported_models.md)

### FLUX.2, FLUX.1 and Kontext

BFL’s table is the licence source: only klein 4B/4B Base are Apache among those FLUX.2 variants. [BFL](https://github.com/black-forest-labs/flux2) The official ComfyUI FLUX.2 workflow proves a graph and optional references but names dev FP8 assets, so it is not a verified klein file list. [workflow](https://comfyanonymous.github.io/ComfyUI_examples/flux2/) FLUX.1 dev and Kontext dev remain research/evaluation options only under their released non-commercial licences. [FLUX.1](https://huggingface.co/black-forest-labs/FLUX.1-dev) [Kontext](https://github.com/black-forest-labs/flux/blob/main/model_cards/FLUX.1-kontext-dev.md)

### HiDream, Wan, ERNIE

HiDream has native ComfyUI assets plus a 48GB-oriented experimental ai-toolkit config; the source says about 35.2GB training VRAM. [workflow](https://comfyanonymous.github.io/ComfyUI_examples/hidream/) [config](https://github.com/ostris/ai-toolkit/blob/main/config/examples/train_lora_hidream_48.yaml) Its model-card licence stack is mixed. Wan is a video follow-on, not a still base. [Wan](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B) ERNIE is recorded because it is a 2026 8B Apache T2I base, but the requested support evidence was not found. [ERNIE](https://huggingface.co/baidu/ERNIE-Image)

## 4. Aesthetic-layer inventory

This is an inventory, not a quality endorsement. “HF public” means its public page was accessible without a login in this pass.

| arm/job | asset | filename / size / licence | trigger / starting weight / gate |
|---|---|---|---|
| A texture | lastremorse/z-image-Realistic-Skin-Texture-style-lora | skin texture v2.1.safetensors; repository 170MB; licence not displayed | trigger/weight not displayed; HF public. [files](https://huggingface.co/lastremorse/z-image-Realistic-Skin-Texture-style-lora/tree/main) |
| A skin/instagirl | kayte0342/z_image_loras | filenames/sizes/licence not exposed | creator says skin is reversed −0.5 to −1; instagirl full, 0.2–0.4 with character; HF public, low-evidence. [card](https://huggingface.co/kayte0342/z_image_loras) |
| A phone snapshot | rahul7star/ZImageLora, Galaxy_Ace_real_photo_ZIT | size/licence not exposed | 1.20, no trigger stated; Z-Image-Turbo specific, HF public. [info](https://huggingface.co/rahul7star/ZImageLora/blob/main/Realistic_Photo/Galaxy_Ace_real_photo_ZIT/info.txt) |
| A/B grain | FastFilmGrain post-process seen in a workflow | provenance shown as vrgamegirl19/comfyui-vrgamedevgirl; licence/repo not audited | example .018 intensity/.18 saturation; do not install before audit. [workflow](https://huggingface.co/9r4n4y/adonis_flux2klein_backup/blob/main/Adonis_Workflow.json) |
| B specific layer | no licence-verified FLUX.2-klein HF skin/grain/phone asset found | — | gap |
| A/B Asian-American register | no compatible licence-verified public LoRA found | — | use owned synthetic persona LoRA and the local trailing-low-weight prompt result; never a real likeness. [guardrail](../pipeline/GUARDRAILS.md) |

For reference, Qwen has a public Apache grain LoRA, artificialguybr/FILMGRAIN-REDMOND-QWENIMAGE, with trigger FILMGRAIN.FilmGrainAF.; its public card did not expose size. [card](https://huggingface.co/artificialguybr/FILMGRAIN-REDMOND-QWENIMAGE) Existing SDXL LoRAs are not plug-compatible. Local research says Skin Realism/FameGrid are CivitAI login-gated and Instagram Selfie SDXL smoothed texture. [existing inventory](../pipeline/aesthetic-recipe.md#2-model-search-phase-2--civitai--huggingface-sdxl-compatible-freelocal) [calibration](../pipeline/lever-table.md#2-skin-finish-axis-a)

## 5. Eromify inference

Public facts: Eromify says identity lock stores core visual DNA and supports portrait/lifestyle content. [influencer page](https://www.eromify.in/ai-influencer-maker) Its current catalogue names FLUX.2 Klein 4B, FLUX.1 Kontext, and Wan/Veo/Seedance video families. [home](https://www.eromify.in/)

| inference | confidence | boundary |
|---|---|---|
| Some present still jobs can route to FLUX.2 Klein 4B. | High | It is listed publicly; that does not prove a specific marketing image used it. [home](https://www.eromify.in/) |
| Identity lock is a persistent representation/workflow that might use fine-tuning, references, embedding or a mix. | Low | Eromify discloses no architecture, weights, training set or export. [page](https://www.eromify.in/ai-influencer-maker) |
| Modern DiT plus grain/colour layer is plausible for the requested finish. | Low | Product marketing names modern models/natural texture, but no graph, LoRA, EXIF, preset or post pipeline is public. [home](https://www.eromify.in/) |
| Grain could be post-process instead of LoRA. | Medium as feasibility, not evidence of Eromify implementation | A ComfyUI graph can contain a final grain node. [workflow](https://huggingface.co/9r4n4y/adonis_flux2klein_backup/blob/main/Adonis_Workflow.json) |

No public metadata or documentation retrieved identifies Eromify’s sampler, checkpoint for a particular image, LoRA, ControlNet, face adapter, denoise setting or colour transform.

## 6. RunPod notes

Network Volumes persist independently of compute; documented price is $0.07/GB-month for the first TB and $0.05 above it. [Network Volumes](https://docs.runpod.io/storage/network-volumes) This is the documented way to retain model weights/datasets after a pod is terminated.

Live Pod rates vary by availability, location and cloud type. RunPod exposes live pricing through an authenticated GraphQL query, while static documentation only has sample values. [price query](https://docs.runpod.io/sdks/graphql/manage-pods) Therefore no truthful sourced current community-vs-secure 24GB/48GB/80GB Pod $/hr table can be supplied without login/API credential, which this brief does not handle. Serverless per-second pricing is a different product. [Serverless](https://docs.runpod.io/serverless/pricing)

Documented templates: official ComfyUI for standard GPUs; ComfyUI Blackwell Edition for Blackwell. It preinstalls ComfyUI and Manager, not models. [RunPod ComfyUI](https://docs.runpod.io/tutorials/pods/comfyui) The Wan guide names One Click ComfyUI - Wan 2.1 / Wan 2.2 (CUDA 12.8), by HearmemanAI, and WAN 2.2 AI Influencer, by aiorbust. [Wan templates](https://www.runpod.io/articles/guides/comfyui-wan-2-2)

## 7. Per-arm bill of materials

### Arm A — Z-Image Base

| item | exact repo / filename / known size |
|---|---|
| base | Tongyi-MAI/Z-Image; 6B; exact file size on the base (non-repackaged) repo still not retrieved — see §10 gap 2. [card](https://huggingface.co/Tongyi-MAI/Z-Image/blob/main/README.md) |
| Comfy model | Comfy-Org/z_image / split_files/diffusion_models/z_image_bf16.safetensors; 12.3GB (confirmed 2026-09-02). [package](https://huggingface.co/Comfy-Org/z_image) |
| encoder | Comfy-Org/z_image / split_files/text_encoders/qwen_3_4b.safetensors; 8.04GB (confirmed 2026-09-02). [package](https://huggingface.co/Comfy-Org/z_image) |
| VAE | Comfy-Org/z_image / split_files/vae/ae.safetensors; 335MB (confirmed 2026-09-02). [package](https://huggingface.co/Comfy-Org/z_image) |
| control start | alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union.safetensors (also v2.0/v2.1); corrected 2026-09-02 — multi-control (Canny, HED, Depth, Pose, MLSD), not Canny-only; Turbo evidence only, validate Base compatibility. [repo](https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union) [guide](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo) |
| starter workflow | official Z-Image text-to-image workflow JSON. [guide](https://docs.comfy.org/tutorials/image/z-image/z-image) |
| trainer | Diffusers examples/dreambooth/train_dreambooth_lora_z_image.py, or diffusion-pipe Z-Image config section. [Diffusers](https://github.com/huggingface/diffusers/blob/main/examples/dreambooth/README_z_image.md) [pipe](https://github.com/tdrussell/diffusion-pipe/blob/main/docs/supported_models.md) |

No custom node is needed for the official Base starter graph.

### Arm B — FLUX.2 klein 4B Base

| item | exact repo / filename / known size |
|---|---|
| training base | black-forest-labs/FLUX.2-klein-base-4B (Apache-2.0); flux-2-klein-base-4b.safetensors ≈7.75GB (7,751,105,712 bytes) — filled 2026-09-02, see §10 gap 1. [repo](https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4B) |
| serving control | black-forest-labs/FLUX.2-klein-4B (Apache-2.0, distilled); flux-2-klein-4b.safetensors ≈7.75GB (7,751,105,712 bytes) — same size as Base, filled 2026-09-02; validate adapter format compatibility. [repo](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) |
| text encoder | shared by both klein-4B and klein-base-4B: text_encoder/model-00001-of-00002.safetensors ≈4.97GB + model-00002-of-00002.safetensors ≈3.08GB — filled 2026-09-02. [repo](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) |
| VAE | vae/diffusion_pytorch_model.safetensors ≈168MB (168,120,878 bytes) — filled 2026-09-02. [repo](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) |
| Comfy-Org repackage | Comfy-Org/flux2-klein-4B; split_files/diffusion_models/flux-2-klein-4b.safetensors and flux-2-klein-base-4b.safetensors ≈7.75GB each; split_files/text_encoders/qwen_3_4b.safetensors ≈8.04GB (fp4 variant qwen_3_4b_fp4_flux2.safetensors ≈3.85GB); split_files/vae/flux2-vae.safetensors ≈336MB — filled 2026-09-02. Note the repackage's text encoder is Qwen3-4B, distinct from the official diffusers-format text_encoder shards above; not reconciled in this pass. [repo](https://huggingface.co/Comfy-Org/flux2-klein-4B) |
| starter graph | official Flux 2 Basic Example Workflow; it names dev FP8 assets and is graph reference, not klein asset list. [ComfyUI](https://comfyanonymous.github.io/ComfyUI_examples/flux2/) |
| trainer path | ai-toolkit registers a Flux2Klein4BModel class (confirmed 2026-09-02); diffusion-pipe lists Flux 2/klein, noting "for Klein, use the base model — the distilled version will not train well." No stable official persona YAML path exists: confirmed 2026-09-02 that no config/examples/*.yaml for klein exists in ai-toolkit (see §10 gap 4). [registry](https://github.com/ostris/ai-toolkit/blob/main/extensions_built_in/diffusion_models/__init__.py) [pipe](https://github.com/tdrussell/diffusion-pipe) |
| aesthetic/custom nodes | none licence-verified in this pass. |

Use only a synthetic, clearly adult fictional-persona dataset, never a real-person likeness. [GUARDRAILS](../pipeline/GUARDRAILS.md)

## 8. Honest gaps

1. No primary 1024px bf16/fp8/GGUF Q4–Q8 VRAM matrix was located. The only sourced figures are Z-Turbo 16GB, Qwen 4-bit 14.93GB, HiDream LoRA 35.2GB, and FLUX.2 dev H100-equivalent. [Z](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo) [Qwen](https://huggingface.co/docs/diffusers/v0.40.0/quicktour) [HiDream](https://github.com/ostris/ai-toolkit/blob/main/config/examples/train_lora_hidream_48.yaml) [BFL](https://github.com/black-forest-labs/flux2)
2. No primary persona-LoRA time result at 1024px on 4090/A6000/H100 was found. Measure it in a bounded trial and terminate/verify pod shutdown on every exit path.
3. Pose/identity is incomplete: updated 2026-09-02 — Z-Turbo Union is verified multi-control (Canny/HED/Depth/Pose/MLSD, not Canny-only), but Base compatibility is unverified and no FLUX.2 klein-4B-specific pose artifact was found (only 9B-targeted community LoRAs; see §10 gap 3); InsightFace-derived FaceID/InstantID are non-commercial.
4. The public aesthetic inventory is thin and incompletely licensed; no verified Asian-American base LoRA exists.
5. Eromify public evidence identifies its current catalogue/product claims, not a reproducible internal image stack.
6. Constitution-required orgs/figment/_index.md, STATE.md and contract.md are absent in this worktree, so they could not be read or substituted.

## 9. Claim-check (2026-09-02, sonnet)

Adversarial re-fetch of every URL-carrying factual claim in §1–8, read-only (no downloads, no login, no accounts, no spend, no pod). 42 claim-check items checked: 37 VERIFIED, 3 REFUTED, 2 UNVERIFIABLE. Fixes are folded inline above; this table is the audit record.

| claim | verdict | source | correction |
|---|---|---|---|
| Z-Image Base = nondistilled, intended for fine-tuning; Apache-2.0; 6B, single-stream DiT | VERIFIED | [README](https://huggingface.co/Tongyi-MAI/Z-Image/blob/main/README.md) | none — "As a non-distilled base model, Z-Image preserves the complete training signal" (Base) vs Turbo "built for speed"; licence tag apache-2.0; card sidebar states 6B |
| Official ComfyUI Z-Image guide has component locations + starter workflow | VERIFIED | [guide](https://docs.comfy.org/tutorials/image/z-image/z-image) | none |
| Z-Image-Turbo fits 16GB VRAM | VERIFIED | [guide](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo) | none — "fits within 16GB VRAM consumer devices" verbatim |
| Base's 1024px VRAM figure | UNVERIFIABLE | [guide](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo) | not stated on this or any page found; §8 gap 1 stands |
| Turbo Fun Union ControlNet is Canny only | **REFUTED** | [repo](https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union) | it is multi-control: "Canny, HED, Depth, Pose, and MLSD" — pose conditioning exists. Corrected in §2, §7, §8 |
| ComfyUI 0.3.75 = Z-Image core support, 0.3.76 = Z-Image LoRA support | VERIFIED | [changelog](https://docs.comfy.org/changelog) | none — 0.3.75 "Added Z Image model..."; 0.3.76 "Support z-image LoRA formats" / "Support Z-Image LoRA training" |
| ComfyUI 0.3.72 = native FLUX.2 support | VERIFIED (substance) | [changelog](https://docs.comfy.org/changelog/index) | entry reads "Added comprehensive Flux 2 model support"; word "native" is our paraphrase, not a misquote |
| Qwen-Image: Apache-2.0, no adult clause | VERIFIED | [card](https://huggingface.co/Qwen/Qwen-Image) | none |
| Qwen-Image is 11B | **REFUTED** | [card](https://huggingface.co/Qwen/Qwen-Image) | card states "Model size: 20B params." Corrected to 20B / bf16 ESTIMATE 40GB throughout §1 and §2 |
| Qwen-Image text encoder identity | UNVERIFIABLE | [card](https://huggingface.co/Qwen/Qwen-Image) | not named on the card page fetched |
| Qwen-Image-Edit Apache-2.0 | VERIFIED | [card](https://huggingface.co/Qwen/Qwen-Image-Edit) | none |
| Z-Image diffusers LoRA recipe (1024px, bf16, batch1, checkpointing, cached latents, 500 steps, 1e-4 LR) | VERIFIED | [trainer](https://github.com/huggingface/diffusers/blob/main/examples/dreambooth/README_z_image.md) | none — exact flags confirmed in the raw file |
| Qwen-Image 4-bit example uses 14.93GB | VERIFIED | [example](https://huggingface.co/docs/diffusers/v0.40.0/quicktour) | none — "only uses 14.93GB of memory" against `Qwen/Qwen-Image` |
| ai-toolkit registers Qwen Image/Edit/Edit Plus and Flux2Klein4BModel | VERIFIED | [registry](https://github.com/ostris/ai-toolkit/blob/main/extensions_built_in/diffusion_models/__init__.py) | none — `QwenImageModel`, `QwenImageEditModel`, `QwenImageEditPlusModel`, `Flux2Klein4BModel`, `Flux2Model`, `Flux2Klein9BModel`, `ZImageModel` all present |
| diffusion-pipe: Z-Image ComfyUI-format LoRA output; Qwen 24GB needs block swap at 640px; Edit-24GB uncertain; FLUX.2/klein listed | VERIFIED | [pipe](https://github.com/tdrussell/diffusion-pipe/blob/main/docs/supported_models.md) | none — also notes "for Klein, use the base model... distilled version will not train well," folded into §2/§7 |
| Comfy-Org/z_image filenames (z_image_bf16, qwen_3_4b, ae) exist, sizes not retrieved | VERIFIED then filled | [package](https://huggingface.co/Comfy-Org/z_image) | sizes now known: 12.3GB / 8.04GB / 335MB — see §10 gap 2 |
| BFL table: klein 4B/4B Base Apache-2.0; 9B/9B Base/dev non-commercial | VERIFIED (minor gap) | [BFL](https://github.com/black-forest-labs/flux2) | table actually lists six rows including a "9B KV" variant, also non-commercial, not named in the original text. Added in §2 |
| LICENSE-FLUX-DEV contains "You may only access, use, Distribute, or create Derivatives ... for Non-Commercial Purposes" and covers FLUX.2 dev | VERIFIED | [licence](https://github.com/black-forest-labs/flux2/blob/main/model_licenses/LICENSE-FLUX-DEV) | none — file's "Models" definition explicitly names FLUX.2 [dev] |
| ComfyUI FLUX.2 workflow names dev FP8 assets, not klein | VERIFIED | [workflow](https://comfyanonymous.github.io/ComfyUI_examples/flux2/) | none — `flux2_dev_fp8mixed.safetensors`, `mistral_3_small_flux2_fp8.safetensors`, `flux2-vae.safetensors`; multi-reference-image input confirmed |
| FLUX.1-dev LICENSE.md contains "To create non-consensual nudity or illegal pornographic content" | **REFUTED** | [LICENSE.md](https://huggingface.co/black-forest-labs/FLUX.1-dev/blob/main/LICENSE.md) / [model card](https://github.com/black-forest-labs/flux/blob/main/model_cards/FLUX.1-dev.md) | that sentence is in the model card's Out-of-Scope Use section, not the licence. LICENSE.md's own content restriction (§vii) reads "to generate unlawful content, including child sexual abuse material, or non-consensual intimate images." Corrected in §2 with both citations |
| FLUX.1-dev: commercial fine-tuning excluded from non-commercial purpose | VERIFIED | [licence text, mirrored](https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-dev) | §1.c: "(c) to train, fine tune or distill other models for commercial use" — HF copy is access-gated, content verified via the canonical GitHub mirror of the identical licence text |
| FLUX.1 Kontext dev is non-commercial | VERIFIED | [model card](https://github.com/black-forest-labs/flux/blob/main/model_cards/FLUX.1-kontext-dev.md) | none — "This model falls under the FLUX.1 [dev] Non-Commercial License" |
| HiDream transformer MIT, Llama encoder separate licence, content-condition quote, 17B | VERIFIED | [card](https://huggingface.co/HiDream-ai/HiDream-I1-Full) | none |
| ai-toolkit HiDream config ≈35.2GB, 3,000 steps, 512/768/1024 | VERIFIED | [config](https://github.com/ostris/ai-toolkit/blob/main/config/examples/train_lora_hidream_48.yaml) | none |
| Official ComfyUI HiDream workflow exists | VERIFIED | [workflow](https://comfyanonymous.github.io/ComfyUI_examples/hidream/) | none |
| Wan2.2-Animate-14B Apache-2.0, no adult clause, video not still | VERIFIED | [card](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B) | none |
| Comfy-Org Wan 2.2 repackage exists | VERIFIED | [package](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged) | none |
| baidu/ERNIE-Image exists, Apache-2.0, 8B, realistic-photography claim | VERIFIED | [card](https://huggingface.co/baidu/ERNIE-Image) | none — repo genuinely exists at this path |
| FaceID card: InsightFace-derived, non-commercial | VERIFIED | [card](https://huggingface.co/h94/IP-Adapter-FaceID) | none |
| InstantID discussion has same antelopev2 caveat | VERIFIED | [discussion](https://huggingface.co/InstantX/InstantID/discussions/2) | none — InstantX team responds "We agree, we plan to train on other face encoders that support commercial license" |
| lastremorse skin LoRA: filename, 170MB, no licence | VERIFIED | [files](https://huggingface.co/lastremorse/z-image-Realistic-Skin-Texture-style-lora/tree/main) | none |
| kayte0342 card: skin reversed −0.5 to −1, instagirl 0.2–0.4 with character; files/sizes/licence not exposed | VERIFIED | [card](https://huggingface.co/kayte0342/z_image_loras) | none |
| rahul7star info.txt: weight 1.20, no trigger, Turbo-specific | VERIFIED | [info](https://huggingface.co/rahul7star/ZImageLora/blob/main/Realistic_Photo/Galaxy_Ace_real_photo_ZIT/info.txt) | none |
| Adonis workflow: FastFilmGrain, provenance vrgamegirl19/comfyui-vrgamedevgirl, .018/.18 | VERIFIED | [workflow](https://huggingface.co/9r4n4y/adonis_flux2klein_backup/blob/main/Adonis_Workflow.json) | none — `aux_id: "vrgamegirl19/comfyui-vrgamedevgirl"`, intensity 0.018, saturation 0.18 |
| artificialguybr Qwen grain LoRA: Apache, trigger FILMGRAIN.FilmGrainAF., no size shown | VERIFIED | [card](https://huggingface.co/artificialguybr/FILMGRAIN-REDMOND-QWENIMAGE) | none |
| Eromify influencer page: identity lock stores core visual DNA, portrait/lifestyle | VERIFIED | [page](https://www.eromify.in/ai-influencer-maker) | none |
| Eromify home names FLUX.2 Klein 4B, FLUX.1 Kontext, Wan/Veo/Seedance | VERIFIED | [home](https://www.eromify.in/) | none — also names Wan 2.7/2.6, Veo 3.1 Fast, Seedance 2.0 specifically |
| RunPod Network Volumes $0.07/GB-mo first TB, $0.05 above | VERIFIED | [page](https://docs.runpod.io/storage/network-volumes) | none |
| Live Pod pricing only via authenticated GraphQL, static docs have no real numbers | VERIFIED | [page](https://docs.runpod.io/sdks/graphql/manage-pods) | none — `lowestPrice`/`stockStatus` fields confirmed as the live mechanism |
| RunPod Serverless is per-second, distinct product | VERIFIED | [page](https://docs.runpod.io/serverless/pricing) | none |
| RunPod official ComfyUI + Blackwell Edition templates, preinstall Comfy+Manager not models | VERIFIED | [page](https://docs.runpod.io/tutorials/pods/comfyui) | none |
| Wan templates: HearmemanAI "One Click ComfyUI - Wan 2.1/2.2", aiorbust "WAN 2.2 AI Influencer" | VERIFIED | [guide](https://www.runpod.io/articles/guides/comfyui-wan-2-2) | none |

## 10. Gap-fill (2026-09-02, sonnet)

1. **FLUX.2 klein 4B exact repo/filenames/sizes** — FOUND. `black-forest-labs/FLUX.2-klein-4B` (Apache-2.0): `flux-2-klein-4b.safetensors` ≈7.75GB (7,751,105,712 bytes); diffusers `transformer/diffusion_pytorch_model.safetensors` same size; `text_encoder/model-00001-of-00002.safetensors` ≈4.97GB + `model-00002-of-00002.safetensors` ≈3.08GB; `vae/diffusion_pytorch_model.safetensors` ≈168MB. `black-forest-labs/FLUX.2-klein-base-4B` (Apache-2.0): `flux-2-klein-base-4b.safetensors` ≈7.75GB, same encoder/VAE. Comfy-Org repackage: `Comfy-Org/flux2-klein-4B` — `split_files/diffusion_models/flux-2-klein-4b.safetensors` and `flux-2-klein-base-4b.safetensors` ≈7.75GB each; `split_files/text_encoders/qwen_3_4b.safetensors` ≈8.04GB (fp4 variant `qwen_3_4b_fp4_flux2.safetensors` ≈3.85GB); `split_files/vae/flux2-vae.safetensors` ≈336MB. Sizes confirmed via HF's own tree API, not scraped HTML. Folded into §7 Arm B.

2. **Comfy-Org/z_image and Tongyi-MAI/Z-Image Base sizes** — PARTIAL. Comfy-Org/z_image FOUND: `z_image_bf16.safetensors` 12.3GB, `qwen_3_4b.safetensors` 8.04GB, `ae.safetensors` 335MB (repo also carries `z_image_int8_convrot.safetensors` 6.2GB and fp4/fp8 Qwen3-4B variants). The base, non-repackaged `Tongyi-MAI/Z-Image` repo's own file size was NOT retrieved in this pass — UNVERIFIED, remains a gap.

3. **Pose conditioning for Z-Image and FLUX.2 klein 4B** — MIXED. Z-Image: pose IS supported via `alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union` (Canny/HED/Depth/Pose/MLSD union model) — this refutes the prior "Canny only" claim (see §9). FLUX.2 klein 4B: no dedicated pose artifact found for the 4B size specifically. Pose-adjacent tools exist only for the 9B variant — `thedeoxen/refcontrol-FLUX.2-klein-9B-reference-pose-lora` and `nhathoangfoto/Flux.2-Klein-9B-MatchingPose` — plus a general union ControlNet, `alibaba-pai/FLUX.2-dev-Fun-Controlnet-Union`, published for dev rather than klein. UNVERIFIED for klein 4B specifically.

4. **ai-toolkit config example paths for Z-Image and FLUX.2 klein 4B, plus documented VRAM** — REFUTED absence, confirmed via GitHub API listing of `config/examples/`: no `train_lora_z_image_*.yaml` and no `flux2`/`klein` config file exists in the repo. GitHub issue #543, "Need a config example file for Z-image lora training," was closed "not planned." So there is no canonical config for either Z-Image or FLUX.2 klein 4B in ai-toolkit as of this fetch. The only VRAM figures found are unofficial, third-party (RunComfy guide content, not ai-toolkit's own docs): FLUX.2 klein 9B suggested ≥32GB (48GB to avoid OOM); klein-4B described as viable on 12–16GB consumer GPUs. Treat these as soft/secondary, not primary-sourced.

5. **RunPod public GPU pricing (RTX 4090 24GB, A6000/6000 Ada 48GB, A100/H100 80GB, community vs secure, $/hr)** — fetched 2026-09-02 from per-GPU marketing pages (`runpod.io/gpu-models/<gpu>`), NOT the live console — treat as "starting from" marketing figures subject to drift, not the authoritative current rate (§6 already establishes only the authenticated GraphQL query gives current truth):
   - RTX 4090 24GB: Community $0.34/hr, Secure $0.74/hr
   - RTX A6000 48GB: Community $0.33/hr, Secure $0.53/hr
   - A100 80GB PCIe: Community $1.19/hr, Secure $1.39/hr
   - H100 80GB PCIe: Community $1.99/hr, Secure $2.39/hr (one page banner inconsistently showed $2.89/hr Secure elsewhere on the same site — flagged as internally inconsistent, not resolved)
   Note: the top-level `www.runpod.io/pricing` page initially returned identical Community/Secure numbers on fetch, which is almost certainly a summarization artifact of the fetch tool rather than real data — that number was discarded in favor of the per-GPU pages above.

6. **Independent (non-publisher) realism comparison of Z-Image vs FLUX.2 klein vs Qwen-Image, 2025-2026** — FOUND. Independent blog "Diffusion Doodles" (Chris Green, not affiliated with Tongyi/Alibaba, BFL, or Eromify) published "Flux.2 Klein — Shrinking Flux.2 Dev" with a companion YouTube comparison video. Verdict in two sentences: FLUX.2 Klein (9B and 4B) showed the strongest general prompt adherence and "realistic feel and good face detail," edging out Z-Image Turbo, which needed more sampler/iteration tuning to hit comparable realism; but in one specific test case, Qwen-Image (2512) actually produced the single most realistic/detailed image despite ranking last on prompt adherence overall, so there is no clean single winner — the comparison shows case-by-case variance rather than a consistent ranking. [Substack](https://diffusiondoodles.substack.com/p/flux2-klein-shrinking-flux2-dev) [Medium mirror](https://medium.com/diffusion-doodles/flux-2-klein-shrinking-flux-2-dev-2258b1078e75) [YouTube](https://www.youtube.com/watch?v=XISimTgRNrg)

