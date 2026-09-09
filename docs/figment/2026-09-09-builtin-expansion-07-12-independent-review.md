# Built-in expansion 07–12 independent review

**Date:** 2026-09-09

**Scope:** whole-original visual review of slots 07–12 against the sole `g01` anchor

**Decision boundary:** research-candidate disposition only; no dataset admission, training eligibility, promotion, publication, or production approval

## Verdict

**Mixed, continue the bounded expansion.** Slots 07, 08, 09, and 11 are credible research candidates. Hold slots 10 and 12 outside the prospective trainer set because the generated compositions conceal hands that their prompts required to show. I saw no batch-level identity, apparent-age, clothing, or severe anatomy failure that calls for stopping later slots.

Across the six originals, the subject is consistently recognizable as the same fictional person depicted by `g01`: long center-parted black hair, eye and eyelid shape, straight brows, rounded nose tip, full lips, cheek and jaw proportions, and overall facial spacing remain coherent. The images also agree with each other. All depict a clearly adult person with a plausible early-twenties appearance; exact age cannot be established visually. Clothing is opaque and ordinary throughout. Skin, hair, fabric, furniture, and outdoor depth generally read as photographic, although the faces retain a mild polished/generated smoothness and repeated makeup and jewelry.

## Per-slot observations

### 07 — kitchen three-quarter left — retain as research candidate

- Identity is close to the anchor, with coherent eyes, nose, lips, cheek fullness, jaw, hairline, and center part. Adult appearance is clear.
- The cream crew-neck knit and dark jeans are opaque. Both elbows and hands are visible; counter contact and fingers look plausible.
- The bright kitchen, morning window light, headroom, and head-through-upper-thigh framing follow the prompt.
- The torso turns only mildly and the face remains near frontal, so the requested roughly 40-degree turn toward image-left is underdelivered. Direct gaze and neutral mouth are correct.
- **Disposition:** retain for setting, clothing, and mild-pose diversity; annotate the weaker-than-requested turn.

### 08 — bookshelf three-quarter right — retain as research candidate

- The face remains strongly consistent with both `g01` and slot 07. The subject reads as an adult in the intended age range.
- Olive overshirt, white crew-neck T-shirt, and dark jeans are opaque. Both hands are visible in a plausible loose clasp, and both elbows remain in frame.
- The bookshelf is unobtrusive; no readable title is evident. Daylight and upper-thigh framing are credible.
- Torso and face form a modest three-quarter pose, though the requested 40-degree turn toward image-right is somewhat mild.
- **Disposition:** retain; the small turn shortfall does not erase its useful opposite-side pose and wardrobe variation.

### 09 — window thoughtful angle — retain as research candidate

- This is the strongest angle change in the batch, and identity remains recognizable through the turned face and off-camera gaze. Nose, lips, chin, eye shape, and hairline remain compatible with the anchor.
- The burgundy crew-neck sweater and charcoal trousers are opaque. Both arms and hands are visible; the wrist hold looks anatomically coherent.
- Window placement, cool indirect light, thoughtful closed-mouth expression, and gaze direction follow the prompt.
- The face reads as a strong three-quarter view rather than a full approximately 60-degree near-profile. The composition reaches at least the knees closely enough for the requested standing study.
- **Disposition:** retain because it adds the batch's most useful non-frontal identity evidence; annotate the lesser angle.

### 10 — park denim jacket — hold outside prospective trainer set

- Facial identity remains coherent with the anchor and the other outputs. The person is clearly adult; expression and direct gaze are plausible.
- Denim jacket, gray crew-neck T-shirt, and black jeans are opaque and correctly rendered. The park path and overcast light look natural, and no other person is visible.
- The visible right hand and fingers are plausible, but the left hand is hidden in a trouser pocket. This materially misses the explicit requirement that both hands be visible and prevents hand-anatomy review on one side.
- **Disposition:** hold. The image is usable as research evidence, but it should not occupy one of the planned trainer slots unless the hand-visibility requirement is deliberately relaxed and recorded.

### 11 — desk seated neutral — retain as research candidate

- Identity is close to `g01` and consistent with the batch. Adult appearance is unambiguous.
- Navy cardigan, gray crew-neck top, and dark trousers are opaque. The seated pose, crossed legs, chair contact, desk contact, wrists, and fingers appear coherent.
- Both hands rest visibly on the desk; both elbows are in frame. The near-frontal face, direct gaze, neutral mouth, soft side light, and head-through-knees composition follow the prompt.
- The facial rendering is mildly polished but retains enough natural texture to remain photographic at whole-original review.
- **Disposition:** retain; it adds seated-pose and contact diversity without a material safety or anatomy defect.

### 12 — walking camel coat — hold outside prospective trainer set

- The face remains recognizable and pair-consistent, although it is slightly smoother and narrower-looking than `g01`. The person is clearly adult.
- The camel coat, black crew-neck top, dark jeans, and flat shoes are opaque. The full body, both legs, and both shoes are in frame, and the mid-step pose is plausible without obvious limb distortion.
- Both hands are concealed in coat pockets. This contradicts the prompt's requirement to include both hands and prevents direct inspection of their anatomy. The black shoulder bag is an unrequested but harmless addition.
- **Disposition:** hold. Keep it as provenance-preserved research evidence, but replace it for the intended trainer slot with a full-body walking image where both hands are actually visible.

## Evidence

The sole reference is `orgs/figment/personas/creator-001/anchors/g01.jpg`, 737366 bytes, SHA-256 `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`.

The copied workspace originals and `receipts/07.json` through `receipts/12.json` agree on filename, byte count, SHA-256, source SHA, and 1086×1448 decoding:

| Slot | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| 07 | `07-kitchen-three-quarter-left.png` | 2109459 | `bd54bb7820dcface27fefdd7a04a184f4394c23ed94c6fe6c3d5535dd1d2a19f` |
| 08 | `08-bookshelf-three-quarter-right.png` | 2061577 | `596583cfbc5c6dd9e0b8faec610487ca915af6f5e4f64a5272a93673d173d942` |
| 09 | `09-window-standing-thoughtful.png` | 2007338 | `224efd214b2383a021d993c07369cd2fd6762e192ba9b29990a664631738ab27` |
| 10 | `10-park-denim-jacket.png` | 2335169 | `b484cf50e59fff6e1b2627ede73a0a9b56fa9bf7521362409113bca1c87f756d` |
| 11 | `11-desk-seated-neutral.png` | 2041425 | `87a3282409757b37dc666f3ed7f7d5520f27bb04b2047a613a7dc5fa4b07302e` |
| 12 | `12-walking-candid-coat.png` | 2195894 | `df8472c809034070bce143deadf70aee730d4a54812304718814b73329ee7757` |

Visual review cannot prove exact age or identity, and one anchor cannot independently establish identity generalization. These six images also do not cover steep opposing profiles, broad expression variation, or independent reference conditions. The conclusions apply only to these exact originals.
