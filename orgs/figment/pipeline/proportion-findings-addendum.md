# Proportion / framing defect — empirical addendum (2026-09-01)

Companion to `aesthetic-recipe.md`. Written as a separate file because two agents were
working the same task concurrently on one shared ComfyUI instance; this one carries the
raw controlled-test evidence so it survives independently of edits to the main recipe.

Every test below was run production-exact against the live local ComfyUI
(`RealVisXL_V5.0_fp16` unless stated, IP-Adapter Plus-Face face-ref, two-pass upscale +
FaceDetailer, the real round-6 `person01` prompt extracted from the delivered PNG's
embedded workflow metadata) with a FIXED seed and exactly ONE variable changed per run.
Local, free, zero API spend.

## The tests and what each one actually showed

| # | Variable changed | Everything else held | Result |
|---|---|---|---|
| 1 | ControlNet strength 0.0 | seed 700001, `v6_pose_A_dramatic`, prod prompt | Full-body framing abandoned — seated mid-body crop. **ControlNet is load-bearing for framing.** |
| 2 | ControlNet strength 0.7 (production) | same | Full body, but **visibly compressed** — short legs vs torso, head small for shoulder width. The complaint, reproduced on demand. |
| 3 | ControlNet strength 1.0 | same | Compression **worse**, plus a silent clothing-render failure (topless) despite the full negative prompt. Local diagnostic only, never copied out. |
| 4 | Seed only (810001 vs 700001) | strength 0.7, same skeleton | Acceptably proportioned but leaning, feet cropped. **The defect is stochastic per seed, not deterministic.** |
| 5 | Skeleton: hand-drawn → real-geometry corrected | seed 810001, strength 0.7 | **No fix** — came back a seated thigh-crop, worse than the hand-drawn skeleton at that seed. |
| 6 | Checkpoint: RealVisXL → Juggernaut XL Ragnarok | seed 810001, corrected skeleton, strength 0.7 | **Same seated thigh-crop.** Checkpoint is not the driver. |

## Measured skeleton geometry (numbers, not eyeballing)

Real joint geometry extracted with `OpenposePreprocessor` + `SavePoseKpsAsJsonFile` over a
free-licence, fully-clothed, plain-background full-body studio photo (Pexels #6856000,
Pexels License — free commercial/personal use, no attribution required), saved locally as
`ComfyUI/input/refphoto_studio_dress.jpg`:

- **Real photo**: neck→mid-hip = 21.2% of frame height; mid-hip→ankle = 31.4%.
  **torso:leg = 1 : 1.48.**
- **Hand-drawn `v6` skeleton**: **torso:leg ≈ 1 : 1.30.**

So the hand-drawn skeletons genuinely are leg-short / torso-long relative to real adult
anatomy. They are all copies of the same fabricated geometry, which is why comparing them
against *each other* shows "near-identical spacing" and finds nothing — the comparison has
to be against real anatomy.

**But correcting the geometry did not fix the output (test 5).** Both facts are true at
once. That is the central finding of this addendum.

## Why correct geometry didn't help — the mechanism

The pipeline conditions on `t2i-adapter-openpose-sdxl-1.0`, a **T2I-Adapter, not a true
ControlNet**. T2I-Adapters are a deliberately lightweight mechanism that *hints* at
structure rather than enforcing it. That single fact reconciles every result above: weak
enforcement means the skeleton's geometry — right or wrong — is largely inert, so fixing it
changes little, toggling its strength changes little, and whatever else biases composition
wins by default.

The concurrent agent on this task isolated what that "whatever else" is, from the opposite
direction: holding prompt/ControlNet/seed fixed and adding **only IP-Adapter** (weight 0.65,
face-ref image being an extreme close-up crop) reproduced the compressed / cropped-high
framing on its own. **IP-Adapter compositional bleed is the dominant driver** — a tight
face-crop reference pulls the whole composition toward a tight crop — and the weak adapter
cannot push back against it. Prompt-budget imbalance (a ~2,300-character positive prompt
with three separate `:1.3`-weighted clothing clauses, while the framing instruction sits
unweighted at the front) stacks on top.

**Combined mechanism, in order of leverage:**
1. IP-Adapter compositional bleed from a tight face-crop reference (dominant).
2. Weak T2I-Adapter conditioning that cannot enforce framing against it.
3. Prompt-budget imbalance starving the unweighted framing instruction.
4. Skeleton geometry that is genuinely wrong but nearly inert given (2).
5. Seed variance modulating severity on top of all of the above.

## THE FIX — confirmed by test (this is the headline result)

**Replacing the T2I-Adapter with a real SDXL OpenPose ControlNet fixes it.**

| Variant (all at seed 810001, same prompt, same IPAdapter @0.65 start_at 0.0) | Composition |
|---|---|
| RealVisXL + T2I-Adapter @0.7 + hand-drawn skeleton | seated / leaning, feet cropped |
| RealVisXL + T2I-Adapter @0.7 + corrected skeleton | seated thigh-crop |
| Juggernaut XL + T2I-Adapter @0.7 + corrected skeleton | seated thigh-crop |
| RealVisXL + T2I-Adapter @0.7 + corrected skeleton + IG-Selfie LoRA @0.6 | seated thigh-crop (worst, low-angle) |
| **RealVisXL + xinsir real ControlNet @0.8 + corrected skeleton** | **standing, upright, full body head-to-feet, FEET VISIBLE, correct proportions (long legs, normal torso, proportionate head), fully clothed, no clothing failure** |

Four-for-four seated/cropped failures with the adapter; the one variant that broke the
pattern was the real ControlNet — **at full IP-Adapter weight with no `start_at` delay, so
identity hold does not have to be traded away to get correct framing.** This is the
"models move what words cannot" lever the brief asked for: a different trained model moved
in one run what six rounds of prompt engineering could not.

**Exact working config:**
- `ControlNetLoader.control_net_name` = `xinsir_openpose_sdxl.safetensors`
- `ControlNetApplyAdvanced`: `strength 0.8`, `start_percent 0.0`, `end_percent 1.0`
  (a true ControlNet wants a different strength band than the adapter's 0.6-0.7)
- pose image: `figment_pose_corrected_v1.png`
- IP-Adapter unchanged: weight 0.65, `start_at 0.0`
- everything else identical to the v6 full-body graph

**Replication — 3/3 clean.** Because the defect is stochastic, the config was re-run on the
other known-bad seed and one fresh unseen seed:
- seed **810001** (the seed that produced seated thigh-crops on all four adapter variants):
  standing, full body, feet visible, correct proportions, fully clothed.
- seed **700001** (the seed that produced the clearest *compression* under the adapter):
  standing, full body head-to-feet, feet visible, correct proportions, fully clothed.
- seed **555001** (fresh, never previously used): standing, full body head-to-feet, feet
  visible in heels, arms relaxed at sides, correct proportions, fully clothed.

Three for three, including both seeds that previously failed in different ways. Combined
with four-for-four failures under the adapter at the same settings, this is a real fix, not
a lucky seed. It remains worth spot-checking at volume, and the clothing-failure mode
(GUARDRAILS #4) is NOT claimed to be solved by this — visual QA on every image still
stands.

## Fix candidates, ranked by expected leverage

1. **Use a real ControlNet instead of the adapter** — `xinsir/controlnet-openpose-sdxl-1.0`,
   Apache-2.0, ~110K downloads, free anonymous HuggingFace download, 2.4 GB vs the adapter's
   302 MB. Downloaded to `ComfyUI/models/controlnet/xinsir_openpose_sdxl.safetensors`. This
   attacks the problem at the enforcement layer, so identity weight can stay high. Note a
   true ControlNet wants a different strength band than the adapter (tested at 0.8).
2. **Fix the IP-Adapter reference image** — use a head-AND-shoulders reference, not an
   extreme close-up face crop, so the reference's own framing doesn't bleed a tight crop
   into the output. This is cheap and probably underrated.
3. **IP-Adapter `start_at` delay (~0.3)** — lets composition set before identity is applied.
   Works, but trades away identity hold, which is the whole point of IP-Adapter.
4. **Rebalance the prompt** — weight the framing instruction itself
   (`(full body head-to-toe, entire body visible from head to feet, standing:1.3)`) and stop
   stacking three `:1.3` clothing clauses.
5. **Corrected skeleton** — keep it as strictly-better practice, but it is not the fix.

## Skeleton-rebuild gotcha worth not rediscovering

OpenPose keypoints stop at the **eyes** (no crown) and the **ankles** (no feet). Scaling the
raw keypoint bounding box to fill the canvas therefore pushes the skull/hair off the top and
the feet off the bottom, and the render comes back cropped at the calves. Leave real
allowances — roughly 13% of canvas height above the eye line and 11% below the ankles — and
scale **uniformly**; never stretch to fit, since non-uniform scaling reintroduces exactly
the proportion distortion being fixed. Corrected file:
`ComfyUI/input/figment_pose_corrected_v1.png`.

## Asset-access note for future unattended runs

CivitAI returns `401 Unauthorized — "The creator of this asset requires you to be logged in
to download it"` for anonymous API downloads of many assets. Confirmed login-gated:
**Skin Realism (248951)**, **FameGrid (1368634)**, **Realism LoRA by Stable Yogi (1100721)**
— all untestable by an agent, and the operator's to fetch with his own account. Confirmed
anonymously downloadable and pulled locally: **Instagram Selfie SDXL (1001573)** and
**Juggernaut XL Ragnarok (133005)**. HuggingFace needs no login, which is why the real
ControlNet was obtainable where the CivitAI LoRAs were not — **prefer HuggingFace-hosted
resources for anything an agent must fetch unattended.**
