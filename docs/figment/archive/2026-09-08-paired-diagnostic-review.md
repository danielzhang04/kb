# Paired diagnostic visual and causal review

## Scope and evidence

This is an independent, descriptive visual audit of the ten PNGs in
`C:/Users/danie/kb/_private/figment-single-seed-experiment-20260908/live-combined-v1/`.
They are all 1448×2176 PNGs. I inspected the originals, the frozen
`held-out-diagnostic-protocol.json` (SHA-256
`9c5d998c158ba366e7ba8e8643fb6b4975f8e11961587439c7df2bc191fef071`),
the combined manifest (SHA-256
`7bad70d7dd3d024eadb4b78dd63fa9c4b92277d707a772089274212428ed903f`),
and the local run receipt (SHA-256
`2ad823ca8db9a377013be75572ee3baf3129900da2f6e665392ff0eb49f86638`).

The receipt names ten completed files, five seeds in each arm, an estimated
actual cost of `$0.239368`, `790.572` elapsed seconds, and verified
termination. It is still a held-out diagnostic: the protocol's promotion flag
is false and every image in `manifest.json` remains `unreviewed`. This document
does not alter those fields, create an approval, score a threshold, or promote
an output.

Parent comparison differs from this independent review: the parent sees strong
within-arm consistency and a clear LoRA-conditioned identity change, but considers
g01 resemblance insufficient and the intended about21 appearance unestablished.
The independent observations below remain intact; this disagreement is unresolved,
not a consensus pass. Seed1595 was used historically and g01 may be represented in
training, so “held-out” names do not imply every seed or reference is unseen.

Comparison anchor: `orgs/figment/personas/creator-001/anchors/g01.jpg`,
1408×768, 737,366 bytes, SHA-256
`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`.
The protocol also records `g02.jpg` and `g07.jpg` as context, but g01 is the
selected comparison anchor for this review.

## Paired outputs: observations, not grades

All ten pictures are close portraits or upper-body portraits in a black,
opaque crew-neck top. Their faces, necks, arms, and clothing read as adult and
clothed. Apparent age cannot establish an exact age. The candidate pictures
visually read as adult and broadly compatible with the stated early-twenties
target; the control pictures also read as adult but generally present as a more
mature, different subject. No image is treated as evidence of an exact age.

| Arm and exact file | SHA-256 | Observed realism and within-arm identity | Comparison with g01 |
| --- | --- | --- | --- |
| Candidate, `c001-heldout-candidate-seed-1595.png` | `04f07f6682077fec1f82d329dcf5ce44241e9b3c7ccf455bee8ed71295f915b3` | Plausible close portrait; same black hair, eye makeup, face proportions, and black top as the other candidate files. Some isolated flyaway hairs read synthetic. | Resembles the g01 subject in hair colour, eye/brow treatment, face shape, and overall presentation, despite the different crop and outfit. |
| Candidate, `c001-heldout-candidate-seed-481516234.png` | `0c2bbfa5538ec45d4b85b39bfc278489ebb0ba683a424efb1d7520cf6acb1f06` | Plausible full upper-body studio-style portrait; coherent with the remaining candidate face. | Same visual identity cues as above; not a direct reproduction of g01. |
| Candidate, `c001-heldout-candidate-seed-90210.png` | `c52c2a749df8e4ad5a0bb2fa97c57847136517f07483e71a587fcb51a098b5e9` | Plausible three-quarter upper-body portrait; coherent with the candidate group. | Same visual identity cues as g01, with a different camera angle. |
| Candidate, `c001-heldout-candidate-seed-314159.png` | `6f2cb703719da7170b4ccd42d72b3c2fb7ed6922650edf3b45c2b905d9a163bc` | Plausible frontal upper-body portrait; coherent with the candidate group. | Same visual identity cues as g01, with a simpler background and cropped hair. |
| Candidate, `c001-heldout-candidate-seed-271828.png` | `ed6de8381f84bd9c776e96123d31b7a08e9b87a0af0c3266b9d0d48e7bdadaa2` | Plausible three-quarter upper-body portrait; coherent with the candidate group. | Same visual identity cues as g01, though the generated jaw and hair length vary. |
| Control, `c001-heldout-control-seed-1595.png` | `f06039e1116d96f2ae1790ac40a28446d83f0242cd8f7084a71cedbcafa8e19b` | Soft-focus but plausible portrait; shares the control group's face, light eyes, and brown/dark-brown hair. | Does not resemble g01's black-haired subject or her face proportions. |
| Control, `c001-heldout-control-seed-481516234.png` | `39887df2d28bb44748e254b4b0b8886266f19b72fca0cd459b748af19a1fe294` | Plausible portrait; coherent with other controls despite hairstyle variation. | Does not resemble g01. |
| Control, `c001-heldout-control-seed-90210.png` | `1e706a527720b2c3255fd375b7f8c84f1e6af1c67a28f7ac1dd31ee83fc34d45` | Plausible portrait; coherent with other controls. | Does not resemble g01. |
| Control, `c001-heldout-control-seed-314159.png` | `86468b1f9393402fc809cd9b50bd86d3fa435ce411cf0052e56009f35bd02ea0` | Plausible portrait; coherent with other controls. | Does not resemble g01. |
| Control, `c001-heldout-control-seed-271828.png` | `620e1b7e842bc2b190357bc25b67f01227a15c8b76b16f99d17a0c6352a07392` | Plausible portrait; coherent with other controls, with longer hair visible. | Does not resemble g01. |

The candidate arm has a strong within-arm visual resemblance, and the control
arm has a separate strong within-arm resemblance. The visible difference is
primarily the subject identity, not clothing: both arms follow the black-top
portion of the prompt. Candidate realism is limited by repeated studio-like
lighting, near-identical framing, and stray hair artifacts; these observations
are not a photographic-authenticity determination.

## Training-image audit

I also inspected each original in
`C:/Users/danie/kb-worktrees/figment/orgs/figment/runs/c001-tf2/train/runs/creator-001-tensor-dataset-train-first/`.
`dataset_manifest.json` records 23 files with `caption_mode: provided`; each
matching `.txt` caption contains exactly `creator001krea2 woman`. Its published
manifest hash is
`b897c3e61c8a6ec1a522c973d757fe91de21848ba713aa924f6fb40897ea9fc5`.

| Exact files inspected | Visible source set and observations |
| --- | --- |
| `01.png`, `02.png`, `03.png`, `04.png`, `05.png` | Bedroom portraits and full-body views. They consistently show the same black-haired adult subject and wardrobe/setting family as g01. `01.png` is especially close in pose and setting to g01. |
| `06.png`, `07.png`, `08.png`, `09.png`, `10.png` | The same subject in the bedroom across darker exposure, profile, and phone-held views. `06.png` is severely underexposed, which weakens facial-reference utility; the remaining files retain the same face/hair cues. |
| `11.png`, `12.png`, `13.png`, `14.png`, `15.png` | The same subject in a cardigan, corset-and-shorts, bodysuit, and warm-light variants. They remain visually coherent with g01; the set is varied in framing but remains narrow in location and styling. |
| `16.png`, `17.png`, `18.png`, `19.png` | High-resolution studio/white-wall portraits of the same subject. The face, black hair, eyebrows, eye makeup, and jewellery remain consistent with g01 and the earlier files. |
| `20.png`, `21.png`, `22.png`, `23.png` | Extreme close-up, side, three-quarter, and moving full-body studio views of the same subject. `20.png` is useful for facial texture but has an unusually tight crop; `23.png` has visible motion blur at the raised foot. Both still track the same face/hair presentation. |

On visual inspection, the 23-image training set tracks the chosen g01 visual
identity rather than showing a second identity drift. This is a descriptive
comparison, not a biometric verification, and it cannot establish the origin
or provenance of any image. The set is much more repetitive in subject,
location, black wardrobe, makeup, and jewellery than it is varied in identity.

## What the pair can and cannot say

The frozen manifest holds the base model, prompt text, resolution, sampler
settings, and five seeds fixed between arms. Its candidate graphs keep node 4
(`LoraLoader`) on the output path; its controls rewire the text encoder and
sampler to base nodes, leaving node 4 unreachable. Subject to the recorded
manifest matching the executed graphs, this paired design isolates the current
candidate-LoRA-versus-no-LoRA condition for this one prompt and seed set.

The observed candidate/control identity split is compatible with the LoRA
condition producing the split under that corrected prompt. It does not show
that the age wording caused any change: both arms use the same wording, there
is no old-versus-new wording factor, and there is only one prompt family. It
also cannot establish exact age, durable generalization, identity-scoring
performance, a production-quality threshold, or a promotion decision.
