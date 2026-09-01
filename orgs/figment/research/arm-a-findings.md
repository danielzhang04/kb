# Arm A findings — our own stack (ComfyUI + SDXL RealVisXL)

Trial character trial-01, local RTX 4070 8 GB, zero cost. Verified by the boss
session viewing outputs directly, not just agent report.

## Realism: PASS, strongly

Outputs read as real camera photos — visible pores and skin-texture variation,
natural flyaway hair, believable window light and fabric drape, no plastic gloss.
This is the bar the whole project exists to clear, and stock SDXL + RealVisXL clears
it on consumer hardware for free. Realism did NOT degrade under IP-Adapter
conditioning (a real risk — conditioning often smooths toward gloss).

## Identity: PARTIAL — improved, not locked

- **Unconditioned** (28 images, one prompt, varied seeds): same *type*, different
  *person*. Face gestalt and hair roughly held; nose, lips, bone structure, even eye
  colour drifted. The deliberate fine marker (mole below left mouth corner) migrated,
  doubled, or vanished.
- **IP-Adapter Plus-Face @ weight 0.35** (20 images, conditioned on `anchor.png`):
  clearly better gestalt — consistent hair, eyes, face shape, build. But the mole
  appears in only ~12-14/20 and drifts to mid-cheek. Side-by-side, some images read
  "same woman, different day", others read "her sister".
- Root cause is architectural: CLIP-vision conditioning is *semantic* ("a woman who
  looks like this"), not *geometric* like FaceID. The clean fix is a trained LoRA,
  which is the next step — IP-Adapter was always a bridge, not the destination.

## Licence: CLEAN

`ip-adapter-plus-face_sdxl_vit-h` and `ip-adapter-plus_sdxl_vit-h` are CLIP-vision
variants (Apache-2.0). No InsightFace package, no antelopev2/buffalo_l on the machine,
no INSIGHTFACE node input used. **Commercially usable** — the FaceID/InstantID
non-commercial trap was avoided.

## Framing: FAIL — the real blocker

- **Full body: 0/5** achieved head-to-feet. All collapsed to chest-up, even at
  832x1216 portrait aspect with explicit framing language that worked in isolated
  pre-tests.
- **Profile: 0/6** reached even three-quarter, let alone true profile. WORSE than the
  unconditioned pass — conditioning on a frontal anchor appears to pull every
  generation back toward frontal.
- Close-up / bust / mid framing works fine.

Consequence: the current reference set cannot train a production LoRA — it would bake
"always tight frontal crop" into the identity itself. Fixing framing is the gating
task before any LoRA training.

## Other defects

- **Wardrobe bleed**: the anchor's grey t-shirt recurs in nearly every conditioned
  image regardless of prompt. Environment bleed was also observed at higher weights
  (0.5+), which is why 0.35 was chosen.
- **Lighting adherence weakened**: "night" prompts returned flat daylight in several
  conditioned images; the unconditioned pass handled lighting better.
- Setup defect found: the pre-installed CLIP-ViT-H vision model was truncated
  (1.03 GB vs 2.53 GB) and had to be re-downloaded — it had been reported as verified.

## Verdict

Realism is solved. Identity is 70% solved and has a known path (LoRA). **Framing is
unsolved and blocks LoRA training.** Next: force composition with ControlNet
(OpenPose/depth) to obtain genuine full-body and profile coverage, then train.
