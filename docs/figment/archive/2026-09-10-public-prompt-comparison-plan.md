# Public Krea 2 prompt comparison: decision and source check

Root decision, 2026-09-10. The completed public control and final trained tester both show substantial torso despite the requested shoulders-up framing. Root and independent review find more g01 resemblance in the trained condition. This supports further controlled inference diagnosis; it does not support blindly retraining or treating the public image as an identity candidate.

The earlier C3 experiment is relevant history but a different test: its design used RealVisXL at 1024 square, 24 steps/CFG6 and requested head-to-below-waist framing plus a turn. It failed with tighter framing. The current Krea 2 Turbo portrait test requests a tight crop and produces a wider one. C3 does not establish that current Krea 2 wording cannot improve the current crop. See [C3 design](2026-09-08-matched20-next-experiment-design.md).

## Primary-source check

The [official Krea 2 repository](https://github.com/krea-ai/krea-2/blob/main/README.md), read September10, recommends training LoRAs on Raw and applying them to Turbo. The current architecture follows that recommendation; the Raw/Turbo difference alone is therefore not an implementation defect. The developer's example uses eight Turbo steps with guidance disabled in its own inference implementation. Those settings are not automatically numerically equivalent to ComfyUI's current RES4LYF sampler and guidance semantics, so this is not evidence that the existing four-step graph is wrong.

The [official prompting guide](https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md), read September10, supports natural-language descriptions and both detailed and simple prompts. It does not guarantee identity retention, framing, or an about-21 appearance for Figment. A whole-text intervention tests the wording package, not a causal claim about prompt length or any single phrase.

## Next bounded preparation

Prepare two public-base-only cells at seed1595 under the same public pins, dimensions1448x2176, steps4, CFG1, res_2s/beta and native harness. The first repeats the exact completed control prompt; the second changes only the positive text. No private image, checkpoint, identity-feature extraction, LoRA node or secret forwarding is involved. Preserve the prior completed run. Target one placement and at most$1.30/60minutes; use native minimum-runtime and budget checks, and do not silently increase either cap if invalid. Root reviews the prepared manifest and actual dry-run before launch.

The comparison text is frozen here:

> creator001krea2 woman, Close-up head-and-shoulders photograph of a fictional adult woman aged 21. Her entire head and shoulders fill the image, with the bottom edge at her upper chest. She wears an opaque black crew-neck T-shirt. She looks into the camera against a plain off-white wall in soft window daylight. Natural skin texture and an unretouched phone-camera appearance.

Record actual graph parity, baseline reproducibility, framing, adult appearance, realism and clothing. Hands remain outside the requested crop and are not tested. Do not claim exact age, multi-seed identity consistency, checkpoint acceptance or a better trained model. If the new wording still misses framing, stop this wording branch and record that result; do not launch an open-ended prompt search. Exact private-checkpoint transfer remains separately blocked pending consent.
