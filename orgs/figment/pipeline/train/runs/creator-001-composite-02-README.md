# creator-001 composite anchors 02

This is an eight-cell, no-launch composite run for FLUX.2 klein 4B Base. It tests the finding from composite-01 that the first `ReferenceLatent` image acts as the canvas: the body/scene frame is now first, followed by the two strongest face references. It does not launch a pod by itself.

## Reference-order rationale

Composite-01 ordered its active references `[g04, g01, g07, BODY]`. On the observed three-cell run, klein 4B Base preserved the first image's whole scene, skirt, and slimmer build while accepting `g04`'s identity, but ignored the fourth body/scene image. Composite-02 therefore reverses the controlling order and drops `g01` to reduce reference dilution: each treatment cell conditions `[BODY, g04, g07]`.

The embedded graph is the three-reference `klein4b_multiref_api.json` graph with its loaders ordered as node 6 = first reference/body, node 7 = `g04`, and node 8 = `g07`. Its positive chain is `4 → 15 → 16 → 17`, and its negative chain is `5 → 18 → 19 → 20`; node 23 consumes the final positive/negative pair. Thus the prose's “first reference” is the canvas and “second and third” are face references. The prompt is:

> Edit the first reference image: keep its body, build, pose, outfit, room, and lighting exactly, and replace the woman's face, hair, and makeup with the woman shown in the second and third reference images — her face exactly. Fair luminous skin with fine texture, winged black liner, glossy pink-nude lips, jet-black hair, layered silver chains with a small cross. A candid phone photo, no retouching.

The final control is genuinely two-reference conditioning `[g02, g04]`: its substitutions point node 23 to nodes 16 and 19, bypassing nodes 17 and 20. The third loader/encoder is consequently outside the executed path for that control.

All four staged files (`g02`, `g04`, `g06`, `g07`) upload from `runs/anchors/` to ComfyUI `input/creator-001/`. The run uses one SECURE RTX 4090 at a $0.80/hour ceiling, avoids `qvf79yutw3t2`, allows 1,200 seconds for readiness, and reserves 40 minutes (28 minutes measured-cell budget plus five-minute bootstrap allowance and headroom).

## Cells

| # | Conditioned references | Seed | Resolution | Output name |
|---:|---|---:|---:|---|
| 1 | `[g02, g04, g07]` | 100001 | 896×1536 | `c001-comp02-body-g02-seed-100001` |
| 2 | `[g02, g04, g07]` | 200002 | 896×1536 | `c001-comp02-body-g02-seed-200002` |
| 3 | `[g02, g04, g07]` | 300003 | 896×1536 | `c001-comp02-body-g02-seed-300003` |
| 4 | `[g07, g04, g07]` | 100001 | 896×1536 | `c001-comp02-body-g07-seed-100001` |
| 5 | `[g07, g04, g07]` | 200002 | 896×1536 | `c001-comp02-body-g07-seed-200002` |
| 6 | `[g06, g04, g07]` | 100001 | 1024×1280 | `c001-comp02-body-g06-seed-100001` |
| 7 | `[g06, g04, g07]` | 200002 | 1024×1280 | `c001-comp02-body-g06-seed-200002` |
| 8 | `[g02, g04]` (control) | 100001 | 896×1536 | `c001-comp02-ctrl-g02-g04-seed-100001` |

## Operator pick

1. Review all eight outputs at full resolution. Keep only results that preserve the first body's build, pose, outfit, room, and lighting while transferring the `g04`/`g07` identity: slightly sharper-than-round adult face, jet-black hair, winged liner, glossy pink-nude lips, fair textured skin, and layered silver chains.
2. Reject any output with face/body reference-order failure, a fuller/heavier or bodybuilding build, an underage appearance, a real-person resemblance, malformed anatomy, broken or revealing clothing, or retouched/plastic-looking skin.
3. Compare treatment cells against control 8. Prefer the smallest 2–4 set where the body-first treatment holds the intended first-reference canvas at least as well as the control while `g04`/`g07` identity is stable.
4. Copy selected files unchanged, retaining their output names, into `orgs/figment/personas/creator-001/anchors/`. Record the picks before any subsequent expansion run.
