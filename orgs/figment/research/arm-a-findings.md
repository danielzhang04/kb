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

## Framing: FIXED (was the blocker)

- **Full body: 0/5** achieved head-to-feet. All collapsed to chest-up, even at
  832x1216 portrait aspect with explicit framing language that worked in isolated
  pre-tests.
- **Profile: 0/6** reached even three-quarter, let alone true profile. WORSE than the
  unconditioned pass — conditioning on a frontal anchor appears to pull every
  generation back toward frontal.
- Close-up / bust / mid framing works fine.

**Diagnosis (controlled, not assumed):** seed 502 produced a genuine full-body shot on
the BARE checkpoint; the identical seed through 4 different IP-Adapter configurations
(weights 0.2-0.8, start_at 0.0-0.75, incl. a composition-zeroed style/composition split)
failed all 4. 0/16 full-body successes across every weight/schedule variant. IP-Adapter
conditioning on a frontal tight-crop anchor was suppressing composition — not fixable by
tuning the knob.

**Full-body fix:** T2I-Adapter OpenPose SDXL (TencentARC, 316 MB, free) with a
programmatically synthesised standing skeleton at ControlNet strength 0.6-0.7 (0.9
distorted anatomy), layered with low-weight IP-Adapter (0.3) for identity. **10/10
genuine head-to-toe.**

**Profile fix:** no ControlNet needed — delay IP-Adapter `start_at` to 0.8-0.85 (weight
0.4-0.5) so early denoising sets head orientation before identity conditioning refines
detail. **6/6 true 90-degree profiles.**

**Cost:** peak ~6.8 GB VRAM of 8 GB with checkpoint + IP-Adapter + ControlNet loaded, no
OOM. 22-84 s/image. Residual defect: "three-quarter" still comes out as a mild head-turn
rather than a strong three-quarter — flagged, not solved.

## Other defects

- **Wardrobe bleed**: the anchor's grey t-shirt recurs in nearly every conditioned
  image regardless of prompt. Environment bleed was also observed at higher weights
  (0.5+), which is why 0.35 was chosen.
- **Lighting adherence weakened**: "night" prompts returned flat daylight in several
  conditioned images; the unconditioned pass handled lighting better.
- Setup defect found: the pre-installed CLIP-ViT-H vision model was truncated
  (1.03 GB vs 2.53 GB) and had to be re-downloaded — it had been reported as verified.

## Verdict

Realism solved. Framing solved. Identity ~70% and has a known path: train a character
LoRA on a reference set built with the fixed recipe. Nothing now blocks that.

Recipe of record for reference-set generation:
- full-body -> T2I-Adapter OpenPose skeleton @ 0.6-0.7 + IP-Adapter 0.3
- profile   -> no ControlNet, IP-Adapter weight 0.4-0.5 with start_at 0.8-0.85
- close/bust/mid -> IP-Adapter 0.35, no ControlNet (as before)
