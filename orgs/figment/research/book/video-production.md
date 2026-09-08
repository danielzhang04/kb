# Video production

Video starts with a reviewed image. The package's strongest video doctrine is to build the first frame from the persona and use a suitable driving clip; motion then follows that composition. This reduces the problem from “invent identity and motion at once” to “preserve a reviewed identity while transferring motion.” It remains a hypothesis until temporal identity is measured.

The production contract is: reviewed start frame, short driver with stable subject and camera, bounded image-to-video job, then frame-sampled review. Check face continuity, age presentation, clothing coverage, hands, background stability, and motion plausibility separately. Reject a clip when the start frame is weak, the driver changes identity cues, or temporal artifacts obscure review. Keep the driver hash and frame sampling plan in the receipt.

The recovered motion analysis records the operational rule “start frame must match,” a concise prompt style, and a Wan 2.1-family graph being evaluated against Wan 2.2. These are concrete package-derived implementation observations, not current Figment video results.

[Wan2.2's official generator](https://github.com/Wan-Video/Wan2.2/blob/main/generate.py) exposes text-to-video and image-to-video task modes and states that I2V output aspect ratio follows the input image. That is an implementation reference for task shape and metadata, not a recommendation to adopt Wan2.2. The current Figment live run produced still images only, so there is no live video proof.

| Evidence/status | What it establishes | Limitation |
|---|---|---|
| Package evidence | Start-frame discipline, driver rubric, and recovered graph analysis. | No measured temporal scores or current Figment video proof. |
| Primary documentation | Official I2V interfaces require explicit task and input handling. | Documentation does not establish identity retention. |
| Current code | Image manifest and provenance concepts can be extended to drivers. | No completed video path in this diagnostic. |
| Hypothesis | A strong start frame and constrained driver will reduce drift. | Needs a paired video comparison. |

Decisions: block production video proof until the image identity contract passes review, while continuing to build and test the video infrastructure. Next test: two drivers with the same reviewed start frame, matched duration and seed where supported, sampled at start/middle/end, with operator review of temporal identity and safety. No virality claim can be inferred from a successful clip.
