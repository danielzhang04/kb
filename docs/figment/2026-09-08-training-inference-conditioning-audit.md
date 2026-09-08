# Training / inference conditioning audit — 2026-09-08

## Scope

This is a read-only comparison of the completed `creator-001-tensor-train-first` receipt/configuration and the completed paired diagnostic under `_private/figment-single-seed-experiment-20260908`. It did not launch a model, modify an artifact, or make an approval claim.

## Exact artifact lineage

| Phase | Recorded artifact | Immutable revision | SHA-256 |
| --- | --- | --- | --- |
| Training | `Comfy-Org/Krea-2` `diffusion_models/krea2_raw_bf16.safetensors`, mounted as `/workspace/models/krea2/krea2_raw_bf16.safetensors` | `5ea0b6cb7e43749e5202aed076e8ecbe04d2deee` | `f99bb0ff8e362b77342bc4994e0c50906fe7ef7074864b181b7d48d2fa6d03d7` |
| Diagnostic inference | `Comfy-Org/Krea-2` `diffusion_models/krea2_turbo_fp8_scaled.safetensors` | `3da2809e72fa04ba266e3b51c2a366fd04500b5a` | `eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1` |
| Adapter | `creator001krea2.safetensors` | completed training receipt | `e1da52fbec917794d5dfccc99dbd7bdc48921efd955e9f4be6da065df54596b0` |

The training config at `runs/creator-001-tensor-dataset-train-first/training.json` resolves `model.name_or_path` to the RAW path above, with `arch: krea2`, UNet training enabled and text-encoder training disabled. The completed train receipt is `runs/out/creator-001-tensor-train-first/run.json`. Its final adapter is 228,587,800 bytes. The diagnostic upload at `_private/figment-single-seed-experiment-20260908/checkpoints/creator001krea2.safetensors` has the same byte count and SHA-256, so the diagnostic used an exact copy of that completed adapter.

The completed `live-combined-v1` diagnostic used the pinned Turbo artifact, the copied adapter at model and CLIP strength 1.0, and the recorded 4-step Turbo sampler settings. It was a completed diagnostic receipt, not a production approval.

## Is RAW training versus Turbo inference a mismatch?

It is a different checkpoint artifact and hash, but not evidence of an unsupported training/inference combination. Krea’s official repository says RAW is the undistilled, fine-tunable base and Turbo is the fast distilled checkpoint; it specifically recommends training LoRAs on RAW and applying them to Turbo for inference. [Krea 2 official repository](https://github.com/krea-ai/krea-2) Comfy’s official Krea 2 guide repeats the same RAW-training/Turbo-inference workflow and labels the two variants as designed to work together. [Comfy Krea 2 guide](https://github.com/Comfy-Org/docs/blob/main/tutorials/image/krea/krea-2.mdx)

That primary documentation supports the architecture transition used here. It does **not** establish that the two pinned `Comfy-Org` repackaged safetensors are bit-equivalent to any separately hosted upstream RAW or Turbo file, nor that this particular adapter has good identity or prompt adherence. No local state-dict/header comparison against upstream weights was performed, so repackage equivalence remains unproven.

## Conditioning comparison

The completed diagnostic used `combined-candidate-control-v1.yaml`. Its candidate prompt contains the trigger, explicit adult/early-twenties language, a plain fitted black top, close-up framing, window light, and texture clauses. It does not include the detailed persona hair, eye, brow, and face descriptors.

`candidate-prompt-full-look-v1.yaml` keeps the same Turbo pin, adapter, strengths, resolution, and sampler family while adding those full-look descriptors. Its verification record points to `dry-run-prompt-full-look-v1/run.json`; the record is a dry run with placeholder jobs, so it supplies no generated comparison. The full-look condition therefore has not been tested against the completed age-only diagnostic.

## Bounded conclusion

The evidence does not support attributing the short-hair/older-looking diagnostic result to a RAW-versus-Turbo incompatibility: the observed pipeline follows the vendor-documented transfer path. It also does not prove that the adapter is healthy on Turbo.

The next single-factor hypothesis is a completed, fixed-seed diagnostic that changes only the recorded candidate prompt from the age-only version to the already pinned full-look version, while holding the same copied adapter hash, Turbo revision, strengths, resolution, seed, and sampler settings. This document does not authorize or run that experiment. It would remain diagnostic and non-promotable until existing acceptance and provenance gates are satisfied.

## Evidence paths

- `C:/Users/danie/kb-worktrees/figment/orgs/figment/runs/c001-tf2/train/runs/creator-001-tensor-dataset-train-first/training.json`
- `C:/Users/danie/kb-worktrees/figment/orgs/figment/runs/c001-tf2/train/runs/creator-001-tensor-train-first.yaml`
- `C:/Users/danie/kb-worktrees/figment/orgs/figment/runs/c001-tf2/train/runs/out/creator-001-tensor-train-first/run.json`
- `C:/Users/danie/kb/_private/figment-single-seed-experiment-20260908/combined-candidate-control-v1.yaml`
- `C:/Users/danie/kb/_private/figment-single-seed-experiment-20260908/live-combined-v1/run.json`
- `C:/Users/danie/kb/_private/figment-single-seed-experiment-20260908/candidate-prompt-full-look-v1.yaml`
- `C:/Users/danie/kb/_private/figment-single-seed-experiment-20260908/candidate-prompt-full-look-v1-verification.json`

## Sampler divergence from published Turbo defaults

The completed diagnostic graph records `steps: 4`, `cfg: 1.0`, `sampler_name: res_2s`, and
`scheduler: beta` for its KSampler. Krea's official inference README documents a Turbo example at
8 steps with CFG disabled and `mu 1.15`; Comfy's official Turbo workflow guide also states that its
image-generation subgraph samples at 8 steps. [Krea 2 official inference settings](https://github.com/krea-ai/krea-2) [Comfy Krea 2 Turbo workflow](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_krea2_turbo_t2i_int8.json)

This is an observed configuration difference, not proof that four steps caused the visual result.
`cfg: 1.0` may or may not have the same operational effect as CFG-disabled in this Comfy graph;
this audit did not establish that equivalence. A separate controlled diagnostic could hold the
pinned Turbo revision, copied adapter hash, prompt, seed, resolution, and all other graph values
fixed while changing only the sampler settings to the documented 8-step configuration. That is a
separate hypothesis from the already identified full-look prompt-only comparison; neither is run
or authorized by this audit.
