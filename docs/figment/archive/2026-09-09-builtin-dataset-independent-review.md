# Built-in dataset independent review

**Date:** 2026-09-09

**Draft:** `_private/figment-builtin-dataset-20260909-v1/caption-draft.json`

**Draft SHA-256:** `670e87a4a162f8e32344dec728ee19e777326a5996808dd11f234020b0b8de9b`

## Verdict

**READY for a separate root research-dataset decision.** The 20 train rows form a coherent and meaningfully varied identity set suitable for a bounded LoRA experiment. The two eval rows are correctly excluded from train and can support narrow within-identity checks. This review does not admit the dataset, mark any image training-eligible, approve training, or establish production identity quality.

Across the anchor and 21 generated originals, the same fictional adult identity remains recognizable. The stable features include eye and eyelid shape, straight brows, rounded nose tip, full lips, cheek and jaw proportions, hairline, and black hair. All images plausibly depict an adult around the intended early-twenties range, though exact age cannot be proven visually. Clothing is opaque throughout. I found no severe anatomy, extra-person, clothing, or realism defect that would make a visible original unsuitable for this bounded research purpose.

The train set varies framing, standing and seated poses, mild and stronger face angles, direct and off-camera gaze, neutral and smiling expressions, indoor and outdoor settings, soft and directional light, clothing layers, hand interactions, a walking pose, and a low ponytail. That is enough diversity to test a finite identity-training hypothesis. Most faces remain near frontal or three-quarter, the makeup and jewelry recur, and each condition has only one generated sample. Those limits should shape interpretation of results rather than be treated as coverage of broad identity generalization.

## Previously held prompt misses

Slots 10 and 12 can remain in this research draft. Their whole originals contain no visible hand or limb defect: slot 10 shows one hand naturally in a trouser pocket, and slot 12 shows both hands naturally in coat pockets during a full-body walking pose. Their captions state those visible facts and do not repeat the original prompts' hand-visibility requests. The earlier hold was valid as strict prompt-compliance feedback; it is not a blocker for an identity-training set whose captions describe the actual images. The same treatment applies to slot 19's single pocketed hand and actual late-afternoon light.

## Unseen-batch visual check: slots 13–18

- **13:** The open smile preserves the identity; visible upper teeth, both hands, railing contact, sweatshirt, and terrace scene are coherent. The caption matches the original.
- **14:** Warm lamp light changes the environment without changing the face. Both hands, chair contact, opaque rust top, and dark jeans are intact; the caption is factual.
- **15:** Crossed arms and overlapping hands are anatomically plausible. The pale-blue shirt is opaque and the near-frontal serious portrait remains identity-consistent.
- **16:** The rain jacket, wet pavement, brick wall, wind-moved hair, and both hands render coherently. The face remains recognizable under overcast outdoor light.
- **17:** The seated side-on pose, direct gaze, cup contact, fingers, chair, and table are plausible. Identity holds through the stronger torso angle; the caption accurately describes the visible scene.
- **18:** Both hands rest naturally in front pockets with thumbs and finger areas visible. Clothing folds and anatomy are coherent, and the caption records the actual pocket pose.

## Structural verification

- The draft contains 22 unique IDs, 22 unique paths, and 22 unique image hashes.
- Exactly 20 rows are `train`. Only `pilot-03` and `pilot-06` are `eval`.
- Train and eval contain no overlapping ID, path, or SHA-256. All declared paths exist, and reading every file produced its declared SHA-256.
- The anchor and every PNG opened successfully at original resolution. The generated originals are 1086×1448; the anchor remains its original 1408×768 JPEG.
- Every caption begins with `creator001krea2 `, is one line with no NUL, and is 130–192 UTF-8 bytes, below the existing 320-byte curation bound.

The draft itself is a selection and caption packet; it is not an approval or complete accepted-dataset record. Existing receipt and inventory evidence must remain bound when the separate curation decision materializes any dataset.

## Evaluation limits

Pilot 03 is a front-facing full-body view and pilot 06 is a close direct-gaze view. Keeping their unique hashes out of train gives a useful narrow framing check. Both were generated directly from the same single anchor and each represents one output seed. They cannot measure identity against an independent reference, disentangle seed effects, or establish generalization to steep profiles, unseen expressions, or new capture domains.

## Decision

I found no research-relevant blocker in the 22 selected originals or their factual captions. Root can make the separately attributed dataset decision using this exact hash-bound draft and the existing provenance evidence. Any later byte, caption, split, or lineage change should require a fresh review rather than inheriting this READY verdict.
