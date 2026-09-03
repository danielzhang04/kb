# creator-001 composite anchors 01

This is an eight-cell, four-reference composite run for FLUX.2 klein 4B Base. It combines the cluster-A face identity with selected body/scene frames before identity expansion and LoRA training. It does not launch a pod by itself.

## Reference-order mapping

The manifest embeds a four-input extension of the verified `klein4b_multiref_api.json` graph so the fourth reference can vary per cell without changing the shared workflow file.

| Reference position | Image | Intended control | Workflow path |
|---:|---|---|---|
| 1 | `g04.jpg` | Primary, sharper-leaning face; hair and makeup | `LoadImage` 6 → scale 9 → encode 12 → positive `ReferenceLatent` 15 / negative 18 |
| 2 | `g01.jpg` | Supporting face; hair and makeup | `LoadImage` 7 → scale 10 → encode 13 → positive `ReferenceLatent` 16 / negative 19 |
| 3 | `g07.jpg` | Supporting face; hair and makeup | `LoadImage` 8 → scale 11 → encode 14 → positive `ReferenceLatent` 17 / negative 20 |
| 4 | Per-cell `g02.jpg`, `g07.jpg`, or `g06.jpg` | Body, build, pose, outfit, room, and lighting | `LoadImage` 29 → scale 30 → encode 31 → final positive `ReferenceLatent` 32 / negative 33 |

The positive-conditioning chain is `4 → 15 → 16 → 17 → 32`; the matching negative-conditioning chain is `5 → 18 → 19 → 20 → 33`. `CFGGuider` node 23 consumes nodes 32 and 33, so the prose instruction's “first three” references are `g04`, `g01`, and `g07`, and its “fourth reference” is the body/scene frame selected at node 29. The face references remain first and the body/scene reference remains last in every job.

All five staged files are uploaded from `runs/anchors/` to ComfyUI `input/creator-001/`. `seed_fields: [noise_seed]` writes each job seed to `RandomNoise` node 22 exactly as in expansion-01. The Base model, Qwen encoder, VAE, 50-step Euler sampler, guidance 4.0, secure RTX 4090 placement, and `$0.80/hour` ceiling are retained. Readiness is bounded at 900 seconds so the requested 20-minute maximum still includes the harness's required five-minute teardown margin.

## Cells

Every cell expects one image and uses this exact prompt:

> The same woman as in the first three reference images — her face, hair, and makeup exactly — standing exactly as in the fourth reference image: keep the fourth image's body, build, pose, outfit, room, and lighting. Fair luminous skin with fine texture, winged black liner, glossy pink-nude lips, jet-black hair, layered silver chains with a small cross. A candid phone photo, no retouching.

| # | Body/scene reference | Seed | Resolution | Output name |
|---:|---|---:|---:|---|
| 1 | `g02` | 100001 | 896×1536 | `c001-comp01-body-g02-seed-100001` |
| 2 | `g02` | 200002 | 896×1536 | `c001-comp01-body-g02-seed-200002` |
| 3 | `g02` | 300003 | 896×1536 | `c001-comp01-body-g02-seed-300003` |
| 4 | `g07` | 100001 | 896×1536 | `c001-comp01-body-g07-seed-100001` |
| 5 | `g07` | 200002 | 896×1536 | `c001-comp01-body-g07-seed-200002` |
| 6 | `g07` | 300003 | 896×1536 | `c001-comp01-body-g07-seed-300003` |
| 7 | `g06` | 100001 | 1024×1280 | `c001-comp01-body-g06-seed-100001` |
| 8 | `g06` | 200002 | 1024×1280 | `c001-comp01-body-g06-seed-200002` |

## Operator pick

1. Review all eight outputs at full resolution. Reject any image that does not preserve the `g04`/`g01`/`g07` fictional face, hair, and makeup; shifts rounder than the sharper-leaning face target; fails to preserve the fourth frame's body, pose, outfit, room, or lighting; appears underage; resembles a real person; contains malformed anatomy or broken/revealing clothing; or looks retouched.
2. Compare the surviving bodies against the identity spec: the target lies between `g02` and `g07`—slim, toned, strong waist-to-hip ratio, with thighs pressing at the hem. Do not use `g08` as a body standard.
3. Pick the best 2–4 composites. Prefer a small set that holds one face identity while covering useful body/scene variation; do not pick extra near-duplicates merely to reach four.
4. Copy the selected output files, unchanged and with their output names intact, into `orgs/figment/personas/creator-001/anchors/`. Those copied images become the composite anchors for expansion-02. Do not start expansion-02 until the operator has recorded the picks.
