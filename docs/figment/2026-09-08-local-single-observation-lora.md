# One-observation local SDXL LoRA fit probe

## Scope

`pipeline/train/local_single_observation.py` is an offline-only planner for a
separate local diagnostic. It snapshots exactly the current
`personas/creator-001/anchors/g01.jpg` into a fresh Figment-private directory,
with a caption derived from the current persona's adult age and hair wording.
It never uses the existing trial-persona staging scripts or data.

The plan schema is `figment/local-single-observation-lora-plan@1`. It records
one original-pixel observation, zero independent additional views, and no crop
training view. A future face crop can be a second rendering of the same source,
not a second observation; it needs its own frozen plan and source-rectangle
provenance.

This is a diagnostic availability and memory-fit path. Its plan explicitly
sets `not_promotable: true`, disables GPU fitting, checkpoint acceptance, and
sample export, and does not create a QA stamp or an operator ruling. It cannot
enter the accepted 20-row experimental executor or any production route.

## Frozen local recipe

The planner copies `local_single_observation.toml` and binds its byte hash. The
template uses the existing local 8-GB SDXL controls: bf16, batch size one,
U-Net-only LoRA, SDPA, gradient checkpointing, disk latent/text caches,
768-pixel bucketing without upscale, rank 32/alpha 16, and `AdamW8bit`.

The first later GPU action is limited to `max_train_steps = 10`, has no sample
steps or image exports, and leaves epoch checkpointing unset so only the
trainer's terminal checkpoint can be written. Ten steps are a small local
availability and memory probe, not evidence of quality, identity retention, or
an adequate training schedule. The planner makes no memory-fit claim before a
separately admitted GPU result exists.

The fixed base is local RealVisXL V5 fp16:

- SHA-256 `6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80`
- 6,938,065,488 bytes
- OpenRAIL++, already evidenced in [the local capability record](2026-09-08-local-comfy-capability.md)

The planner also binds the installed clean `sd-scripts` commit
`37a1cbbc5725ed2a3575506e7bd2001c9908ac92`, its
`sdxl_train_network.py` bytes, and the configured local Python path. The local
repository is Apache-2.0; the base-model licence evidence remains the cited
RealVisXL record, rather than a claim that the trainer repository licenses the
weight.

## Planned sequence

After review, create only a fresh private plan, for example:

```powershell
C:\Users\danie\AppData\Local\Programs\Python\Python313\python.exe `
  orgs\figment\pipeline\train\local_single_observation.py `
  --out local-lora-single-observation-20260908-v1
```

That planner reads and validates a bounded JPEG, writes its fresh private
snapshot, and prints the frozen manifest hash. It does not import torch,
contact a service, or start a trainer/provider process. It does run fixed,
local Git metadata checks to bind the clean sd-scripts commit before it writes
the plan.

The next explicit, parent-run action is the CPU parser, using the pinned local
trainer environment and the emitted plan:

```powershell
C:\Users\danie\tools\lora-trainer\venv\Scripts\python.exe `
  orgs\figment\pipeline\train\local_single_observation_cpu_preflight.py `
  --plan <fresh-private-plan>\local-single-observation-plan.json
```

The parser sets `CUDA_VISIBLE_DEVICES` empty plus Hugging Face, Transformers,
and Diffusers offline flags, verifies the exact staged JPEG/caption/template
inventory and hashes, and asks the pinned sd-scripts DreamBooth parser to
resolve the one observation. `sdxl_train_network` does
transitively import torch, so this is not described as a torch-free action. It
asserts that CUDA was not initialized before or after parsing and does not load
model weights, construct an Accelerator, train, save a checkpoint, or export a
sample. Its JSON result reports the resolved one-image count, repeat count,
target resolution, actual bucket list, and caption.

A CPU parser pass proves only that the frozen local dataset/config layout is
parseable under those offline flags. It does not prove every tokenizer/cache
needed by a later GPU run is already local, and it does not itself prohibit a
future runtime from changing its environment. A later GPU fit probe still needs
a fresh bounded admission and must verify the base-weight bytes again. Any resulting LoRA remains a rejected
diagnostic artifact unless a different accepted path says otherwise.

The CPU parser verifies the frozen staged caption and the current g01 source;
it does not re-read the current persona to regenerate caption wording. The
planner has already bound the persona bytes that produced that caption. A later
GPU executor must revalidate the current persona and its rendered caption
before it can use the snapshot.

## Current limitations

The one image is a sole canonical source, not a dataset of varied observed
views. Crops or repeats do not create independent identity evidence. The
current generated derivatives remain separately rejected or ineligible and
are not silently substituted to reach twenty rows. This planner neither lowers
that current experimental-data contract nor treats one-observation output as a
comparison against the Krea pipeline.
