# Single-g01 expansion plan

## Status and purpose

This is a seven-input planning slate. It does not generate media, change the
persona, amend an anchor, alter a gate, or create a training or approval claim.
Every proposed input uses the original `creator-001/anchors/g01.jpg` as its
sole reference. None may use a prior generated candidate as an input, even if a
candidate is visually promising.

The purpose is to add small, reviewable coverage across pose, crop, background,
and lighting while keeping each proposal close enough to g01 for an independent
identity-fidelity review. The first task is not to maximize variation. This is
a multi-factor coverage slate, not a causal prompt experiment or a matched
baseline: each row's listed combination is the proposed condition.

## Evidence synthesis

| Source | Planning implication |
| --- | --- |
| [Input and book review](2026-09-08-input-and-book-review.md) | The frontal black-tee input remains visually rejected for changed eye/brow, nose, jaw, and overly smooth geometry. Do not make it an anchor or a reference chain. The wardrobe-only and small-turn inputs give useful experimental clues but retain distinct experimental status. |
| [Paired diagnostic review](2026-09-08-paired-diagnostic-review.md) | Candidate images have broad visual cues compatible with g01 but varying jaw and hair; the parent still finds g01 resemblance insufficient. The original 23-image set is narrow in location, black wardrobe, makeup, jewellery, and lighting. Add coverage without treating the paired result as a general identity proof. |
| [Training / inference conditioning audit](2026-09-08-training-inference-conditioning-audit.md) | The paired LoRA/control result isolates that condition for one corrected prompt and seed set, not background, pose, or age wording. New input planning must not claim to explain its result. |
| [Raw reference observations](2026-09-08-raw-reference-observations.md) | The reviewed fixed640 run made all planned comparison inputs detector-available. Its raw values remain uncalibrated and cannot select a candidate, replace visual review, or establish all references as the same or different identity. |
| [Identity and data](../../orgs/figment/research/book/identity-and-data.md) | g01 remains the sole canonical input for this experiment; g02 and g07 are contextual comparators. Keep adult presentation and clothing review separate from identity review. |

## Prompt contract

For each row below, send **exactly** the common text followed by its exact scene
suffix as one prompt, with only the original g01 image attached:

> Create one photographic image from the single supplied reference `g01.jpg` of a fictional, AI-generated adult woman. Preserve the reference subject's distinctive narrow eyelids and lifted asymmetry, dark arched brows, nose bridge and nostril relationship, lip shape, jaw taper, long center-parted jet-black hair, small earrings, natural skin texture, and youthful adult appearance around age twenty-one. This is the same fictional adult, not a new person. Keep her clearly adult and fully clothed in an intact, fully opaque top. Keep realistic pores, ordinary flyaway hairs, and unretouched skin. Do not make the face more symmetric, enlarge the eyes, broaden the jaw, narrow the nose, smooth the cheeks, change the hair colour or center part, add text or watermark, or use beauty-filter smoothing. Use one stationary phone-camera photograph with natural perspective.

The common prompt is held fixed. Each suffix is the complete planned
multi-factor coverage condition for that row; it must not be combined with
another row or silently varied at execution. A result remains an
`experimental-unreviewed` candidate pending independent review.

| ID | Coverage move | Exact suffix appended to the common prompt |
| --- | --- | --- |
| E01, recommended next | Framing-only shoulders-up coverage | `Frame from shoulders upward in the same ordinary bedroom as the reference, in soft natural window daylight from camera-left. Preserve the reference head pose, square shoulders, neutral gaze, neutral relaxed mouth, small earrings, and the intact fully opaque original black strapped top. Do not change the room, light direction, clothing, jewellery, or facial pose.` |
| E02 | Opposite three-quarter pose, shirt, and mid-chest framing coverage | `Frame from mid-chest upward in the same ordinary bedroom as the reference, in soft natural window daylight from camera-left. Turn her head gently about twenty degrees toward her own right while keeping her shoulders nearly square and eyes to camera. Wear a plain charcoal crew-neck short-sleeve T-shirt. Neutral relaxed mouth.` |
| E03 | Wider crop, standing pose, and long-sleeve wardrobe coverage | `Frame from waist upward in the same ordinary bedroom as the reference, in soft natural window daylight from camera-left. Stand facing the camera with a slight natural weight shift and both arms relaxed at her sides. Wear a plain fully opaque black crew-neck long-sleeve top. Neutral relaxed mouth.` |
| E04 | Seated pose, crop, torso angle, and wardrobe coverage | `Frame from waist upward in the same ordinary bedroom as the reference, in soft natural window daylight from camera-left. Sit naturally on the edge of the bed, torso turned about fifteen degrees toward her own left, with one hand resting loosely on her knee and eyes to camera. Wear a plain fully opaque charcoal crew-neck long-sleeve top. Neutral relaxed mouth.` |
| E05 | Background, head tilt, and wardrobe coverage | `Frame from mid-chest upward against a plain warm off-white wall, with the same soft natural window daylight from camera-left and no decorative objects. Face the camera with a relaxed slight head tilt toward her own right. Wear a plain fully opaque black crew-neck short-sleeve T-shirt. Neutral relaxed mouth.` |
| E06 | Lighting direction, pose, crop, and wardrobe coverage | `Frame from mid-chest upward in the same ordinary bedroom as the reference. Use soft overcast window daylight from camera-right, with the rest of the room naturally exposed. Turn her head about fifteen degrees toward her own left and keep eyes to camera. Wear a plain fully opaque black crew-neck short-sleeve T-shirt. Neutral relaxed mouth.` |
| E07 | Close crop, three-quarter pose, and wardrobe coverage | `Frame from shoulders upward in the same ordinary bedroom as the reference, in soft natural window daylight from camera-left. Turn her head about thirty-five degrees toward her own right while keeping both eyes visible. Wear a plain fully opaque charcoal crew-neck short-sleeve T-shirt. Neutral relaxed mouth.` |

E01 is the next one input because it isolates a shoulders-up framing change
while preserving g01's observed head pose, gaze, room, light direction, black
strapped top, and jewellery. It supplies framing coverage only; it is not an
identity, pose, or view experiment. E02 should follow only after E01 is
reviewed; the remaining rows are a slate, not a batch commitment.

## Independent review rubric

Review each output at original resolution against original g01 before it is used
as an input anywhere else. Record observations under these separate headings:

1. **Lineage and constraint:** g01 is the only attached input; record its hash,
   prompt ID, output hash, and that no generated image was supplied as a source.
2. **Reference identity:** compare eyelid asymmetry, brow treatment, nose and
   nostril relation, lips, jaw taper, center part, hairline, and earrings. Reject
   a candidate that repeats the known frontal failure: rounder/opened eyes,
   heavier symmetric brows, a changed nose, a broadened oval lower face, or
   smooth rendered facial planes.
3. **Adult presentation and clothing:** record whether the person presents as
   an adult and whether the intact opaque garment specified for that input is
   present. Do not infer an exact age from an image.
4. **Realism:** inspect skin transitions, flyaway hairs, hands, room geometry,
   fabric, lighting direction, and artifacts at original resolution. This is a
   visual observation, not a numeric score.
5. **Coverage value:** retain a candidate only if it realizes the full named
   coverage condition while preserving the contract; a near duplicate adds no
   coverage. Do not describe a multi-factor row as a clean causal variation.

All entries share g01 as a common ancestor. Any train/eval split made from this
slate is therefore a within-identity diagnostic, not independent reference
validation and not evidence of generalization.

No raw cosine, self-control, detector confidence, or one reviewer observation
is a replacement for this independent review. A useful candidate stays
experimental until a separately authorized data or training decision records
its role.
