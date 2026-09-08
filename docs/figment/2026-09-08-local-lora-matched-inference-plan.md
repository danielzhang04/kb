# Matched local LoRA inference plan

## Decision and boundary

This is an implementation plan for a later, separately admitted **local-only**
quality observation. It does not start ComfyUI, train an adapter, load a model,
create images, export a LoRA, or select a checkpoint. It uses neither g01 nor
an older LoRA as inference conditioning, and it does not call a provider.

The current-caption comparison begins after its fresh quality training run
completes under the closed `local_quality.toml` recipe. The concise branch
follows the current branch's image reviews:

1. `current`: one original g01 observation, current frozen caption, 100 steps.
2. `concise`: the existing concise-caption branch, the same source and the same
   100-step recipe.

Each training run remains non-promotable. The completed ten-step fit probe is
only a local-format and availability observation. Its receipt records one
170,540,916-byte checkpoint with hash
`032123a1bc31b8e6dab3c8d00f961189ff3e0ddda2d051bd587a5de879afd135`.
Its safetensors **header only** was inspected: 309,704 header bytes, 2,166
tensor entries, `ss_steps: "10"`, `ss_network_module: "networks.lora"`,
SDXL-LoRA architecture metadata, and the pinned RealVisXL base hash. That is
not a 20/50/100 quality arm and cannot be substituted for one.

No IP-Adapter, CLIP-vision encoder, input image, crop, or reference image is in
the first causal base-versus-LoRA graph. IP-Adapter would inject g01 reference
conditioning and confound the only intended difference: applying the named
locally trained LoRA. A later IP-Adapter study would need a separate question
and an explicitly matched control.

## Fixed matrix: ten-image maximum

Use exactly these two seeds: `481516234` and `90210`. Reuse one hash-matched
base image per seed. Completing every planned comparison produces ten PNGs;
the stop conditions can end the experiment earlier.

| Cell | Adapter selected | Training schedule it represents | Images |
| --- | --- | --- | --- |
| base | none | not applicable | 2 |
| current-20 | current checkpoint at step 20 | current run has the closed 100-step horizon | 2 |
| current-50 | current checkpoint at step 50 | current run has the closed 100-step horizon | 2 |
| current-final100 | terminal current checkpoint with header `ss_steps: "100"` | current run has the closed 100-step horizon | 2 |
| concise-50 | concise checkpoint at step 50 | concise run has the same closed 100-step horizon | 2 |

The current checkpoints are the exact expected names from the frozen quality
plan: `figmentlocalg01quality-current-100-step00000020.safetensors`,
`figmentlocalg01quality-current-100-step00000050.safetensors`, and the
terminal current artifact named by that completed run. The concise arm uses
`figmentlocalg01quality-concise-100-step00000050.safetensors`. A completed
training receipt must bind each selected file to its current/concise plan,
the same source, `max_train_steps: 100`, and the closed scheduler before it can
be staged. Do not treat a second 50-step training job as the concise arm.

For each seed, the base PNG is created once, hash-recorded, and referenced by
the four LoRA rows for that seed. It is not regenerated between comparisons.
The ten rows are a maximum, not a batch to submit at once. Run only ordered
two-image batches: base pair; current-20 pair and review; current-50 pair and
review; current-final100 pair and review; then, only after separately completed
concise 100-step training, concise-50 pair and review. Every later pair has a
fresh manifest and receipt that records the preceding root and independent
visual diagnostic observations. Those observations are not a QA stamp, human
approval, automated reviewer, or production decision.
Each LoRA row records its own PNG hash, the base comparator PNG hash, arm,
checkpoint SHA-256, checkpoint header fields, source/plan/receipt hashes, and
the exact shared runtime and graph hashes.

## Matched prompt and graph

Normalize the existing one-source quality evaluation prompt's whitespace once,
hash the result, and use its exact words without adding persona features:

```text
Photographic waist-up portrait of a fictional adult woman around twenty-one,
turned slightly toward her own right with eyes to camera, wearing a plain opaque
black top, in soft daylight against a plain warm off-white wall,
figmentlocalg01probe.
```

The negative prompt excludes `child, minor, nude, lingerie, explicit, extra
person, duplicate person, distorted face`. It is a diagnostic prompt, not an
age classifier. Both prompts are byte-hashed and identical in all ten cells.

Use the pinned RealVisXL checkpoint, one width/height, KSampler parameters
(`steps`, `cfg`, `sampler_name`, `scheduler`, and `denoise`), VAE decode, and
SaveImage node unchanged across every cell. The implementation must choose and
freeze those sampler values once in the manifest; it may not tune an arm while
observing earlier images. Each graph has batch size one and one explicit seed,
so a result cannot hide different random states within a batch.

The base graph is core-only:

```text
CheckpointLoaderSimple -> CLIPTextEncode positive/negative -> KSampler -> VAEDecode -> SaveImage
```

Each LoRA graph inserts exactly one core `LoraLoader` between the checkpoint
loader and both consumers. The installed Comfy source (`nodes.py`, lines
709–754) supports these required inputs exactly: `model`, `clip`, `lora_name`,
`strength_model`, and `strength_clip`; it returns a `MODEL` and `CLIP`.
`comfy/sd.py` maps the loader through `load_lora_for_models`. Because the
quality recipe is U-Net-only (`network_train_unet_only = true`), use
`strength_model: 1.0` and `strength_clip: 0.0`, retaining the unmodified base
text encoder. The base row has no `LoraLoader` node at all. Do not replace this
with guessed SDXL node keys or use an old exported LoRA.

Keep SaveImage at output node `11` so the established owned-output validator
can continue to demand exactly one root PNG per prompt. The inferred difference
between any base/LoRA pair is therefore only the staged adapter selection;
prompt, seed, sampler, base checkpoint, dimensions, and core graph remain
identical.

## Checkpoint and runtime safety

The inference planner accepts no caller-provided paths. It reads only the four
fixed selected checkpoint slots below the configured quality-run roots and
copies them into a fresh run-owned `output/loras/` directory using exclusive
creates. The installed Comfy `main.py` adds `output/loras` to the `loras` model
folder list, so this avoids changing the shared Comfy models tree or needing an
extra model-path configuration. `lora_name` is the exact staged basename; path
separators and additional files are refused.

For each source and staged adapter, the planner must:

1. refuse reparse points and non-regular files, verify the expected basename,
   and apply the existing quality cap of 256 MiB per checkpoint;
2. read the little-endian safetensors header length, require 2 through 1 MiB
   and less than the file length, decode only that bounded JSON header, and
   require a metadata dictionary, one or more well-shaped contiguous tensor
   ranges, `networks.lora`, the pinned base hash, and the selected 20/50/100
   step value;
3. stream SHA-256 with a pre/post size and mtime check, then make the staged
   copy, rehash it, and verify its header again; and
4. record bytes, source and staged hashes, selected step, header-only
   assertions, and the producer plan/CPU receipt/admission/quality receipt
   hashes. It never loads tensors through torch for validation.

Before launch, repeat the accepted immutable checks for the RealVisXL base
checkpoint, installed Comfy code pin, `nodes.py` and `comfy/sd.py` bytes,
Python interpreter, graph template, and every staged LoRA. The run directory is
a fresh fixed private child with owned input/output/temp/user/home/cache paths,
an unused loopback port, no browser launch, no API nodes, and all custom nodes
disabled. The core `LoraLoader` requires no custom-node allowlist.

Header metadata alone is not proof that Comfy will apply a useful patch. The
installed `comfy/lora.py` maps every loaded U-Net `diffusion_model.*.weight`
key to a `lora_unet_...` name, and its `load_lora` path warns for every adapter
key left unloaded. The actual ten-step header has 2,166 tensor entries, all
with the `lora_unet_` prefix, but that is only a format candidate. The later
runtime must capture a bounded count of header adapter keys and Comfy-recognized
U-Net patch keys, retain a bounded missing-key count/log classification, and
fail a selected LoRA when recognized keys are zero or any adapter key is
unmatched. It must record those counts per staged hash before rendering; this
is an applicability check, not a quality score.

## Smallest implementation change

Phase C1 adds only `train/local_lora_matched_inference.py`: pure graph,
ten-row-maximum matrix, selected-slot, and frozen-manifest functions. It does
not read weights, read producer receipts, stage files, start ComfyUI, render,
or decide whether a later batch may dispatch. Its producer-receipt validator
explicitly returns `not implemented` until the Phase B receipt interface is
defined and its actual plan hashes are available.
The accepted `expand/local_comfy_input.py` stays byte-for-byte unchanged while
the current CPU and upcoming GPU work bind hash
`2997BA3185AABFB146B13F38D18C854615A7190064D30F14037570398BEA7BAC`.

After that freeze and review, the smallest runtime reuse is an extraction of
only the existing post-staging owned lifecycle into a narrow helper such as
`_execute_owned_prompts(root, manifest, prompts)`. That later helper keeps the
accepted port refusal, isolated environment, retained `Popen` handle, Windows
PID-plus-creation-time checks, bounded loopback requests, and verified teardown;
the inference module supplies prevalidated ordered two-image batches. No
900-line lifecycle clone is proposed.

## Evidence and review

Store a machine-readable row for every PNG with the paired base hash and all
pins, then obtain separate root and independent visual diagnostic records that
keep these observations separate. They describe observations only and must not
pretend to be a human review, QA stamp, or approval:

| Dimension | Permitted record |
| --- | --- |
| Realism | plausible / artifact present, with concrete defect notes |
| Reference resemblance | tracks stated g01 cues / uncertain / drifts, with cue notes |
| Batch identity | consistent across the two seed outputs / uncertain / divergent |
| Apparent age | adult-presenting / uncertain; never an exact-age result |
| Clothing | specified opaque garment intact / missing or defective |

If the existing observer supplies a raw cosine, preserve it only as a finite
raw value tied to the observer revision and PNG hash. It is uncalibrated and
cannot rank arms, select a checkpoint, create an acceptance threshold, or
override the separate visual observations. This remains a one-source local
diagnostic, not production evidence, identity proof, a 20-row dataset, or a
checkpoint approval.

## Tests and stop conditions

Add focused unit tests without Comfy, torch, model reads, or generation:

- matrix expansion is exactly ten rows: two base, six current, two concise;
  base hashes are reused per seed and all seeds/prompt/sampler fields match;
- the base graph contains no LoRA/IP-Adapter/image-conditioning nodes, while
  every adapter graph contains one `LoraLoader` with only the supported keys,
  `strength_model=1.0`, and `strength_clip=0.0`;
- wrong checkpoint name, reparse point, size/header limit, malformed range,
  absent metadata, wrong base hash, wrong step, non-LoRA architecture, or
  changed post-copy hash is rejected;
- a concise candidate from a non-100-step schedule, a missing current 20/50/
  final receipt binding, or a duplicate/unexpected staged LoRA is rejected;
- the extracted lifecycle receives ten ordered core-only prompts, refuses a
  foreign listener/PID reuse, records one output per prompt, and always clears
  only owned processes; and
- production/checkpoint-selection boundaries refuse the resulting diagnostic
  schema and all absence/failure receipts.

Stop without retry if either quality training admission/receipt fails, a
checkpoint cannot pass bounded staging, the shared server cannot prove owned
listener/teardown, or an output loses its exact cell binding. The ladder's
visual stop applies when **both** matched-seed LoRA images have a material
defect, adult-presentation concern, clothing failure, duplicate subject, or
repeated prompt non-adherence. Quarantine any individual clothing-failure PNG
from user delivery and record it; one bad seed alone does not automatically
stop the later review batch. Do not tune or auto-rerun an arm.

## Read scope

This plan was based on the accepted `local_comfy_input.py`,
`local_quality_plan.py`, `local_quality.toml`, and one-source quality design.
The installed Comfy core loader source was read at the current local paths
`nodes.py` and `comfy/sd.py`; no Comfy process was started. The actual ten-step
checkpoint was read only through its bounded safetensors header, not torch or
model loading.
