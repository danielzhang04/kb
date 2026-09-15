# Public-base control independent local review — 2026-09-10

## Scope and evidence

This is an independent, original-resolution local visual comparison of three
fictional clothed-adult images. It is a diagnostic observation only. It does
not select a checkpoint, score an acceptance gate, create a production ruling,
or authorize any further run.

The public-base control completed at 00:43:41 UTC after the root-recorded
00:30:40 UTC launch: one image, `uploads: []`, verified teardown, and a
$0.236303 READY-rate estimate. Its declared comparison condition is the same generic
tester text, seed 1595, 1448x2176 resolution, four steps, CFG 1, and
`res_2s`/`beta` settings as the already-local final tester; the intended
inference difference is public base without a LoRA versus the final tester's
LoRA strength 1.0. The executions were separate, so this single seed does not
eliminate ordinary run-to-run variation.

All three originals were inspected locally with native `view_image` at their
original resolution. No image was copied, exported, sent to a service, or used
for automated grading.

| Local evidence label | SHA-256 |
| --- | --- |
| Public-base control original, seed 1595 | `890ab7c7ef7dde623e76b27c70e58f1fea8d42ff8377e389818efb2d76bb674d` |
| Final-LoRA tester original, seed 1595 | `c9ac839c4816279e20424dec5b62ccc0eb3502f799c6298b5e4fd1882a180a6a` |
| `creator-001` anchor `g01` | `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed` |

## Observations

Both tester outputs show an adult-presenting, clothed subject. The final-LoRA
tester and `g01` read as young adults, while exact age, including whether a
subject is about 21, cannot be established from these images. The public-base
subject also appears adult; that is not an exact-age finding.

The public-base image frames the head, shoulders, and substantial torso, with
hands out of frame. It is somewhat tighter on the face than the final-LoRA
tester, but it still does not meet a narrow shoulders-up reading. The
final-LoRA tester shows more torso and waist, also with hands out of frame, so
it likewise misses that requested framing.

The public-base face differs materially from `g01`: its facial silhouette,
eyes, nose, hair arrangement, and restrained styling do not visibly track the
anchor beyond generic dark hair and a black top. The final-LoRA tester visibly
tracks several `g01` cues, including long center-parted black hair, dark
almond-shaped eyes with eyeliner, arched brows, fuller lips, and an oval/tapered
face. It is still a separate rendered face under a different crop and lighting,
so this is resemblance evidence for one seed only, not identity proof.

Both generated images are photographic at normal viewing size. The base image
has plausible skin texture and a coherent opaque black shirt, with a restrained
portrait finish. The final-LoRA image is also photorealistic and has coherent
opaque clothing; stray flyaway hair and its highly controlled portrait finish
remain visible stylistic artifacts. Neither image has an obvious garment or
anatomy-integrity failure in the visible region.

## Narrow hypothesis and limits

At this seed, the final-LoRA condition is visibly closer to `g01` than the
public-base control, while both conditions remain wider than shoulders-up. A
later matched multi-seed LoRA/base comparison could test whether the adapter or
its training conditioning consistently changes identity resemblance and shifts
framing; the one separately executed pair cannot establish either cause.

The earlier C3 base calibration does not resolve whether a minimal-text
intervention would change this control's framing. C3 used RealVisXL at
1024x1024, 24 steps and CFG 6 with a head-to-below-waist plus turn target;
this control uses Krea2 Turbo at 1448x2176, four steps and CFG 1 with a
shoulders-up target. Its prior failure to remove that different base-composition
confound therefore cannot settle this condition; see the
[C3 runtime audit](2026-09-08-local-profile-base-runtime-audit.md). If exact
private-checkpoint transfer consent is later granted, the already-scoped
five-seed held-out comparison could test the LoRA/base distinction. Until then,
the V3 private route remains blocked, and this review creates no new execution,
acceptance, or promotion.
