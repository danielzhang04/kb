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
- Mechanism: expansion set generated from the face anchors with the build described in the
  prompt; cells curated to this target; optional composite anchor via a two-reference edit
  (face g04 + body g08) if the prompt route drifts.

## Next

1. Identity expansion on FLUX.2 klein 4B Base: 3 face refs (g04, g01, g07) → balanced multi-view
   set (angles × distances × lighting × wardrobe families incl. swimwear/lingerie tier), scored
   by `pipeline/train/identity_check.py`, operator eye-gate on the grid.
2. Persona LoRA (diffusion-pipe) on the curated set; held-out identity test.
3. Voice: see MANDATE §Voice.
