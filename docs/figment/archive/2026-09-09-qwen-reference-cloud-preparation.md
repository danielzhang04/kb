# Qwen reference-cloud preparation

`prepare_qwen_reference.py` is an offline manifest compiler for one Qwen-Image-
Edit-2511 reference experiment. It does not call a provider, download weights,
create a pod, submit a graph, or write an approval. Its default CLI prints JSON.
`--prepare` makes a fresh local review payload only and rejects existing or
reparse-point destinations.

The graph is a compact API adaptation of the official Qwen template at commit
`a861fcde234d5cda3095087c509858fb001a6093`, file size 59,130 bytes, SHA-256
`d561a38c15bd7d08758a5e6773d467142244d5b83fc5d3aecdf6d8df9fe881b6`, subgraph
`cdb2cf24-c432-439b-b5c8-5f69838580c9`. It has no Lightning or skin LoRA. It
uses one sole admitted `g01.jpg` byte stream (737,366 bytes, SHA-256
`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`): scaled
image1 goes to both Qwen encoders and `VAEEncode`; optional image2/image3 inputs
are omitted. Positive and negative conditionings each pass through
`FluxKontextMultiReferenceLatentMethod(index_timestep_zero)`; the scaled image1
VAE latent is the sampler initial latent. The two fixed seeds are
`481516234` and `90210`, at 40 steps, CFG 4, Euler/simple. The outputs are not a
768-square promise: the pinned `FluxKontextImageScale` picks the closest training
aspect ratio. For the 1408x768 g01 it is expected to choose 1392x752, with
Lanczos scaling and centre handling; no crop has been added.

The positive and negative text is reused unchanged from
`local_omnigen2_inference.py`; its recorded feasibility source digest is
`daf48e21a2eabd2b9f9d4e44f5ec464108a884a95cacc81bb12f952379823939`.

This is a composite official-conditioning hypothesis. Earlier M1 used three
references, 26 steps, and an empty latent. It is a cross-model comparator using
the same g01 and prompts, not a strict single-variable causal ablation. The prior
failed Omni review remains preserved and is not displaced.

The remote-only public model pins are the FP8-mixed Qwen edit UNET
`c9fdc158e46d3b61ef75f21ae866ca2fe808bf4a53643120d1c1e87c19280a4e`, Qwen 2.5
VL 7B FP8 encoder `cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4`,
and Qwen VAE `a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f`,
with immutable revisions and exact remote byte counts (20,533,762,817;
9,384,670,680; and 253,806,246) in the manifest. The count/digest/revision
triples were read from public Hugging Face response headers on 2026-09-09; no
weights were downloaded. No local model weights are staged or uploaded. Their
recorded component metadata is Apache-2.0; production licence clearance is still
not established.

The accepted session authorization covers the exact g01 transfer to the owned
RunPod, one placement, two images, and a maximum $1.30 / 60 minutes inside the
$50 arc. This compiler does not spend or launch anything, and it confers no
production approval. The rate is historical and current availability remains
unverified. Readiness is 39 minutes and each of two jobs has an 8-minute timeout:
`(2340 + 2 * 480) / 60 + 5 = 60` minutes. The recorded arc is $38.248267 of $50;
root rechecks the canonical ledger and current rate before the actual operation.

Focused tests validate the graph edges, native no-LoRA inventory, two seeds,
exclusive staging, default no-execution behavior, harness schema, and the exact
60-minute formula. An independent static review found the compact graph source-
compatible with the pinned native Comfy source; it did not make a remote
`/object_info` request. A local existing-harness dry run completed with one staged
737,366-byte upload, two one-file placeholder jobs, and isolated dry-run ledger
output at `_private/figment-qwen-reference-cloud-dry-run-20260909-v1`; it is not
remote proof. Before the actual operation, root rechecks the ledger and current
rate. The existing harness cannot attest a remote g01 hash after upload or a
submitted graph hash; those acceptance gaps remain.
