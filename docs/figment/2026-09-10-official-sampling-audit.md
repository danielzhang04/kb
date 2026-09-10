# Official Comfy Krea-2 Turbo sampling audit

This tracked note copies the read-only findings from the local
[audit record](../../_private/figment-official-sampling-audit-20260910-v1/official-sampling-parity-audit.md).
It did not download models, run a workflow, or make a provider request.

## Pinned evidence

The official `Comfy-Org/workflow_templates` source was pinned at commit
`cce0b679980e4215000f67fe7b12c3a1982310ea`; its local verbatim copy is
[image_krea2_turbo_t2i.cce0b679.json](../../_private/figment-official-sampling-audit-20260910-v1/image_krea2_turbo_t2i.cce0b679.json)
with SHA-256 `d04b37d8345b1bf6aa247ef182a4454e0221730cf353379af27b20e932e9f11f`.
The reviewed public prompt-comparison manifest has SHA-256
`ba498949298f12d9dea9320c514de0a75e9a3aa7010403dc2ad4b408c6af5fba`.

Primary sources are the pinned
[official workflow template](https://raw.githubusercontent.com/Comfy-Org/workflow_templates/cce0b679980e4215000f67fe7b12c3a1982310ea/templates/image_krea2_turbo_t2i.json),
[ComfyUI v0.34.0 nodes](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/v0.34.0/nodes.py),
and the [Krea 2 README](https://raw.githubusercontent.com/krea-ai/krea-2/main/README.md).

## Findings

The public graph and the official template share the direct base path: Krea-2 Turbo
FP8 U-Net, Qwen3VL `krea2` text loader, Qwen Image VAE, direct text conditioning,
zeroed negative conditioning, empty latent, KSampler, and VAE decode. ComfyUI
`v0.34.0` declares support for the `krea2` text-loader type and these core nodes.

The official template has an optional style-LoRA branch, but its model switch is
false by default. There is no `ModelSampling*` node in that template's base path.
The local public graph likewise has no LoRA loader.

The sampler packages differ materially: the local public comparison uses 4 steps,
CFG 1, `res_2s`, and `beta`; the official Comfy template uses 8 steps, CFG 1,
`euler`, and `simple`. Both use denoise 1. The official template also enables a
prompt-refinement branch by default. That branch changes positive conditioning and
must be disabled in a text-matched sampler comparison.

Krea's standalone Turbo example recommends 8 steps with CLI CFG 0, while Comfy's
official template explicitly uses KSampler CFG 1. The sources do not establish an
equivalence between those interfaces or a defect in either one. The named model
components also match, but the template's moving `main` download URLs do not prove
byte identity with the individually pinned public files.

The audit supports, at most, one paired sampler-package comparison that holds the
frozen text, seed, direct text path, base model, and 1448x2176 resolution constant.
It cannot establish a preferred setting, validate framing, or prove a sampling bug.
