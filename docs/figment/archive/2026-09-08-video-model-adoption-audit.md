# Wan2.2 TI2V-5B small I2V adoption audit

_Research date: 2026-09-08. Status: candidate only; not adopted, downloaded, or runnable._

The existing Figment mandate names Wan 2.2 TI2V-5B. The official Wan-AI card says that
TI2V-5B supports both text-to-video and image-to-video, and documents a single-GPU
image-conditioned path. It also documents a 24 GB minimum for its 720p reference
command with offloading. The project L40S has 48 GB VRAM, so a deliberately smaller
native-Comfy proof is technically plausible; this is an inference from the published
minimum, not a performance guarantee. [Wan-AI model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)

The official ComfyUI Wan2.2 guide is the controlling integration source. It calls the
5B model suitable for native offloading, names the three required model files, and
shows I2V through a start-image input plus the Wan 2.2 image-to-video latent node.
[ComfyUI Wan2.2 guide](https://docs.comfy.org/tutorials/video/wan/wan2_2)

## Candidate safe-file set

All values below were read from public Hugging Face metadata, not by downloading a
model. `sha256` is the repository's LFS object digest. The selected assets all end in
`.safetensors`; the `.pth` files in the upstream Wan-AI repository are deliberately
outside this candidate.

| Role | Official repository and immutable revision | File | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| Diffusion model | [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/5ca2dfecf59320b1d4605b5802e64f77a8676afe), `5ca2dfecf59320b1d4605b5802e64f77a8676afe` | `split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors` | 9,999,658,848 | `456f901338bd9eadbded3828b819109a9b68e8a525ca5cf8d0049a69fcfeca1e` |
| VAE | same Comfy-Org revision | `split_files/vae/wan2.2_vae.safetensors` | 1,409,400,960 | `e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156` |
| Text encoder | [Comfy-Org/Wan_2.1_ComfyUI_repackaged](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/tree/617a7633e636506f850e043bc4605f290a466a8e), `617a7633e636506f850e043bc4605f290a466a8e` | `split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` | 6,735,906,897 | `c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68` |

The total is 18,144,966,705 bytes (about 16.9 GiB) before ComfyUI, outputs, and
runtime overhead. The current L40S profile reserves 80 GB container disk and 120 GB
volume, so storage appears sufficient, subject to an actual manifest's checked
preflight. Its stated rate is $1.30/hour in
[`tensor-pins.yaml`](../../orgs/figment/pipeline/train/tensor-pins.yaml).

The Wan-AI and Comfy-Org cards list Apache-2.0. That establishes a licence candidate,
not adoption approval. The full model/adoption review must preserve the licence text,
re-fetch the three metadata records at their pinned revisions, and verify all three
hashes after download before a runner sees them.

## Native ComfyUI shape

The proof should use the official native template rather than a custom node. The guide
requires the diffusion loader, `CLIPLoader` configured for Wan, VAE loader, positive and
negative `CLIPTextEncode`, `LoadImage`, `Wan22ImageToVideoLatent`, sampling,
`VAEDecode`, and an installed video writer. The input image connects to the latent
node's `start_image`; it is an image-conditioner, not a replacement for the text
prompt. [Native Wan22ImageToVideoLatent inputs](https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/Wan22ImageToVideoLatent/en.md)

The current official documentation says to update ComfyUI to the latest build and
warns that these core nodes may be absent from a stable release. Figment currently pins
ComfyUI `v0.34.0`; this audit has not established that it contains the template or
required nodes. Adoption therefore needs a source-pinned ComfyUI revision and a
workflow JSON SHA whose node inventory is tested against that revision. No custom node,
un-pinned package, frame interpolator, audio model, or `.pth` asset belongs in the
first proof.

## Proposed bounded proof, pending review

This is a proposed one-clip diagnostic envelope, not a runnable manifest:

- one locally supplied, visually checked adult-and-clothed first frame; batch size one.
  It is diagnostic input only and does not need production approval while every output
  remains unpromotable;
- 512 x 288 pixels, 81 frames, 16 fps; its frame-span convention is five seconds,
  and the written output duration must be probe-verified before it is recorded;
- no audio, continuation, interpolation, LoRA, or control model;
- a planning hypothesis of 40 minutes readiness, 30 minutes render, and five minutes
  teardown: `max_minutes: 75`. At the existing $1.30/hour L40S reference rate, that
  ceiling is about $1.625. The last known cold start took about 25 minutes before
  rendering, so this is a conservative envelope rather than a measured render-time
  guarantee; the manifest's actual rate and spend guard remain authoritative;
- retain only the first, midpoint, and final frames after a real extractor proves
  their indices, plus the output-file SHA-256 and media probe record. A caller-supplied
  image must never be labelled an extracted frame.

`Wan22ImageToVideoLatent` requires dimensions divisible by 16 and calculates temporal
latent length from the configured frame count. The proposed 512 x 288 inputs satisfy
that dimensional constraint. [Node reference](https://docs.comfy.org/built-in-nodes/WanImageToVideo)

## Gates before any model download or pod

1. Root and manager04 review the concrete model admission. Standing async authority
   already covers a pinned, licensed adoption and a paid proof within the $50 cap, but
   root must still verify the artifact licences and native-node pins before admitting it.
2. Add a dedicated video tensor-pins profile containing only the three files above,
   their revisions, SHA-256 values, destinations, licence evidence, and a source-pinned
   native workflow. Existing image profiles are not permission to reuse their manifest.
3. Verify the native node inventory on the pinned ComfyUI commit without a provider
   call. If the required node is absent, stop; do not add a community replacement.
4. Reuse the existing pod harness and its artifact-download mode. Add an adapter only
   where the video extension contract requires one; do not create a second runner or
   alter spend-control paths. The adapter must add path-safe input/output handling,
   real media probing and extraction, byte/count caps, and ordinary lease/teardown
   evidence.
5. The proof is diagnostic and non-promotable; it does not authorise publication or a
   production video path. A later production path must require the existing real
   approval lineage, not a diagnostic first-frame input.

The 14B I2V repository's `.pth` assets are not a universal Wan2.2 blocker, but they
remain excluded here. This candidate uses the official 5B native-Comfy safetensors
workflow and remains blocked until every gate above is complete.
