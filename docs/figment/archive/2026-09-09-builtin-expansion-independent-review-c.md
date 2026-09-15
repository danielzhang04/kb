# Built-in expansion 19–21 independent review

**Date:** 2026-09-09

**Scope:** whole-original visual review of slots 19–21 against the sole `g01` anchor

**Decision boundary:** research-candidate disposition only; no dataset admission, training eligibility, promotion, publication, or production approval

## Verdict

**Retain all three as research candidates.** The originals preserve a coherent identity across strong directional light, an upward off-camera gaze, and a low-ponytail hairstyle. All three depict a clearly adult person with a plausible early-twenties appearance; exact age cannot be established visually. Clothing is opaque, anatomy is coherent at whole-original review, and the images remain photographic despite mild polished/generated smoothing.

Slot 19 misses two prompt details, but those misses do not create an image defect: the strongest light arrives from image-left rather than image-right, and one hand rests naturally in a pocket instead of remaining visible. That distinction should be preserved in its eventual factual caption. Natural hand occlusion alone does not make this identity-training candidate unusable.

## Per-slot observations

### 19 — covered porch breeze — retain with compliance notes

- The eyes, brows, nose, lips, cheek fullness, jaw, hairline, and center part remain close to `g01` and consistent with the expansion set. The subject is clearly adult.
- The white long-sleeve crew-neck shirt and blue jeans are opaque. The visible hand and fingers are plausible; the other hand is naturally concealed in a pocket, so its anatomy cannot be inspected.
- The covered porch, direct late-afternoon light, distinct shadows, upper-thigh framing, subtle moved hair, direct gaze, and neutral mouth are present.
- The dominant illumination reaches the subject from image-left, opposite the prompt's image-right direction. The face is near frontal with only a slight chin turn.
- **Disposition:** retain for useful hard-light identity variation. Caption the actual light direction and pocketed hand; do not claim exact prompt compliance.

### 20 — library upward gaze — retain

- Identity remains recognizable through the upward viewing angle and off-camera gaze. Facial spacing, rounded nose tip, lips, cheek and jaw proportions, and long center-parted hair remain compatible with the anchor.
- The dark-red cardigan, beige crew-neck top, and charcoal trousers are opaque. Both hands and elbows are visible; the raised hand's contact with the shelf edge/books is plausible.
- The library aisle, head-through-knees framing, raised gaze, slightly raised brows, and mild attentive closed-mouth expression follow the requested study. No other person or clearly readable book title is evident at whole-original review.
- The body angle is mild, and a black shoulder bag is an unrequested but harmless addition.
- **Disposition:** retain; it contributes useful upward-gaze and reach/contact variation without a visible identity, clothing, or anatomy defect.

### 21 — low ponytail workshop — retain

- The low ponytail visibly changes the hairstyle while preserving the center part, hairline, face shape, eyes, brows, nose, and lips. Identity remains coherent with `g01` and slots 19–20.
- The cobalt crew-neck sweatshirt and black jeans are opaque. Both elbows and hands are visible at the subject's sides, with plausible wrists and fingers.
- The daylight workshop, uncluttered depth, direct gaze, neutral closed mouth, headroom, and upper-thigh framing follow the prompt. No readable text is evident.
- The torso turn is modest rather than a strong 35 degrees, but the face-back-to-camera relationship and hairstyle change still add useful variation.
- **Disposition:** retain as a hairstyle and modest-pose identity candidate.

## Evidence

The sole reference is `orgs/figment/personas/creator-001/anchors/g01.jpg`, SHA-256 `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`.

The workspace originals fully decode at 1086×1448. Their bytes and SHA-256 values agree with `receipts/19.json` through `receipts/21.json`; each receipt records `production_approved: false` and `review: not-recorded`:

| Slot | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| 19 | `19-covered-porch-breeze.png` | 2360397 | `9febcc6e6013943935968735628e1a280d4b9dfb57600d01a7f8c77b60522477` |
| 20 | `20-library-standing-soft-expression.png` | 2117741 | `1326b1f82346db4302f5caa8d04864bdc995532f848c84cca31fba59cf73d638` |
| 21 | `21-low-ponytail-workshop.png` | 1919479 | `008e78095bff876ef7b26bc434682836c8aa605b965219cebc0898af97f72ef3` |
