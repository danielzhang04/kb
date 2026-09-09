# Built-in reference pilot: root review

Root inspected g01 and all six original generated images. The exact inventory,
dimensions, SHA-256 values, and prompts are retained in MAIN
`_private/figment-builtin-pilot-20260909-v1/{inventory.json,prompts.json}`.
Every output is 1086 by 1448 pixels and passed complete PNG decoding. Each tool
call used g01 directly; no generated image served as another call's reference.

**Disposition: promising for expansion into a reviewed candidate dataset.**
This is a research decision, not dataset acceptance, a selected LoRA, or production
approval. All six images read as the same fictional adult as g01 at visual review.
The person plausibly appears in the intended early-twenties range; exact age cannot
be established from these images.

| Image | Root observations |
| --- | --- |
| 01 turn left | Eye shape, full lips, cheeks, nose and jaw remain close to g01. Natural skin and stray hair; mild image-left turn, upper-thigh crop, elbows and hands visible. |
| 02 turn right | Opposite body turn with direct gaze. Face remains recognizable across the changed angle; lips and jaw vary plausibly with perspective. Clothing, hands and body proportions are coherent. |
| 03 full body | Recognizable face at a smaller scale; entire figure and both shoes are present. Natural stance and clothing folds. This wider view offers less facial detail than the portraits. |
| 04 outdoor hoodie | Identity holds through the gray hoodie and overcast outdoor setting. Hair, skin, garment texture and hands look photographic. The source necklaces remain visible; identity judgment does not depend on those accessories. |
| 05 seated smile | The small closed-mouth smile changes the cheeks and mouth without obvious face substitution. Both hands, elbows and seated legs are coherent. The image fulfills the seated expression variation. |
| 06 closer side light | The larger face retains the anchor's eye, nose, lip and cheek relationships. Skin texture is visible, with gentle light falloff rather than the earlier Qwen smoothing. Lighting variation is modest. |

No exposure, ambiguous-age presentation, gross anatomy defect, extra person,
watermark or collage was observed. All clothing is opaque. Compared with the
rejected Omni and Qwen samples, this set substantially improves visible identity,
skin and hair texture, and requested composition.

The scope remains small: mostly frontal faces, mild turns, one gentle smile, soft
light and one source identity. It does not prove profile, extreme expression,
motion, harsh lighting, or independent-reference consistency. Body details beyond
g01's frame are generated extrapolations, not known anatomy. The responding model,
seed controls and incremental tool billing were not exposed.

The next candidate set should vary clothing, setting, pose and light further, keep
the source and each derivative hash-bound, and reserve evaluation views outside
trainer media. Root and independent review must agree before any exact finalized
dataset receives a real acceptance decision. Existing identity thresholds and
production approval fields remain unchanged.
