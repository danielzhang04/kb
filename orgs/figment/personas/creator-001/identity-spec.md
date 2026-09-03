# creator-001 — identity spec (operator, 2026-09-03)

Source batch: `personas/anchors/gemini-batch-01/g01..g08.jpg` (untracked image bulk; board built
2026-09-03). Register: ABG glam per `pipeline/look-spec-v2.md` §0 operator taste anchor.

## Face (the identity the LoRA locks)

- Anchor candidates: **g01, g04, g06, g07** (cluster A). Lean **slightly sharper than round**:
  g04/g01 side of the cluster rather than g06.
- Keep across the set: jet-black hair, winged liner, defined lash, groomed straight brows,
  glossy pink-nude full lips (natural fullness), fair luminous skin with fine texture, small
  chin, apparent age about 21 (adult-coded, cull floor unchanged).
- Do not import faces from g02/g03/g05/g08 into the identity set.

## Body (a curation target, not an identity)

- Upper body and bust: as in **g01, g02, g06, g08** (they agree).
- Hips and lower body: between **g02 and g07** — slim, strong waist-to-hip ratio, visibly toned,
  thighs pressing at the hem of shorts, not the fuller build of g03/g05.
- g08 reads slightly too athletic; it is NOT a body reference.
- Mechanism: expansion set generated from the face anchors with the build described in the
  prompt; cells curated to this target. Drift risk is the model's own fuller-body prior
  (observed on both bases 2026-09-02), not the rejected candidates, which are never fed in.
  If a composite anchor is ever needed: face g04 + body g07 (g07 is also a face anchor, so
  one frame carries both) or body g02.

## Composite findings (2026-09-03, klein 4B Base multi-reference, runs composite-01/02/03)

- **Reference order = canvas.** Faces first → the first face image's whole scene/body is kept
  (composite-01: perfect g04 face, g04's scene and slim build, body ref ignored). Body frame
  first → body, pose, outfit, room kept and the face replaced (composite-02/03).
- **Face-swap quality depends on face pixel density.** On full-body frames (g02, g07 bodies)
  the swapped face comes out mask-like with a literal white/black wing artifact, with OR
  without makeup words in the prompt (composite-03 identity-only prompt did not fix it). On
  the half-body frame (g06 body, face large in frame) the swap is CLEAN: natural liner, the
  cluster-A face, g06's body.
- **Rule for expansion:** generate the identity set at half-body/close framing where the
  face is large (clean identity), and get full-body cells via a second pass (face-crop edit
  or face detailer on the full-body render) rather than a single full-frame swap.
- Identity across seeds is stable (composite-01 ×3, composite-02 g06 ×2): the klein
  reference path holds the face; the LoRA will have consistent material.

## Reference set of record (operator pick, 2026-09-03 07:05)

To the model every reference is simply "her"; there is no anchor/composite distinction. The
set is the images that read as one woman, used together (klein takes up to four):

1. `personas/anchors/gemini-batch-01/g01.jpg`
2. `personas/anchors/gemini-batch-01/g02.jpg` (carries the body target; its slightly wider
   face shifts the averaged identity a touch toward g02 — accepted by the operator)
3. `personas/anchors/gemini-batch-01/g07.jpg`
4. `personas/creator-001/composite-03/c001-comp03-body-g06-seed-200002.png` (C5, clean
   sharper-face confirmation; optional)

Every other composite cell is rejected (mask-like face, drifted identity, makeup artifacts) and
must not be used as a reference. Body exemplars for prompt wording: g02, g07, and
`composite-03/c001-comp03-body-g02-seed-200002.png` (C2).

**Ordering (operator ruling):** creator 001 is the first influencer AND the pipeline proof, like
FYT's first channel. Research, infrastructure, tests, audits and reviews come first, in order;
the expansion and LoRA for her run through the finished pipeline, never ahead of it.

## Next

1. Identity expansion on FLUX.2 klein 4B Base: 3 face refs (g04, g01, g07) → balanced multi-view
   set (angles × distances × lighting × wardrobe families incl. swimwear/lingerie tier), scored
   by `pipeline/train/identity_check.py`, operator eye-gate on the grid.
2. Persona LoRA (diffusion-pipe) on the curated set; held-out identity test.
3. Voice: see MANDATE §Voice.
