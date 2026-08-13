# W3 - hr-officer canonical re-run

- Date: 2026-08-13
- Result: `OK` (one live provider call; 39.9 seconds)
- Forge route: `forge.py gen --kit channels/the-second-take/visual-kit --mode new_character --aspect 2:3 --name w3-hr-officer-rerun --character hr-officer --seed refs/base/base.png --delta <below>`
- Forge output renamed without modification from `_staging/w3-hr-officer-rerun.png` to `_staging/hr-officer-w3-rerun-candidate.png`.
- SHA-256: `c99e4915f0ffa5b3dd80d0a45445b03b4b66fdc3c0384cd67c6009e102f383e8`
- Spend: `$0.039` (one 1K `gemini-3-pro-image` call; forge default). Cap remaining: `$0.061`.
- Deviations: none. The T16 hr-officer delta was reused byte-for-byte; only forge's output name was W3-specific before the requested rename. No verification, promotion, stamping, registry write, or canonical-ref write.

## Exact delta passed to forge

```text
A full-body standing character reference sheet of ONE cast member, the HR officer, a woman. IDENTITY: dark hair pinned up, slight build, flat head tone #e0b48d; costume is a rust-red knitted cardigan over a cream blouse, a long tweed skirt and flat shoes, with reading spectacles hanging on a chain at the chest. The long tweed skirt is one single flat solid colour fill in flat cel shading - no fabric texture, no weave, no stitching, no quilting lines, no herringbone, no mottling; the only shading is the style's simple two-tone cel shadow.  CRITICAL FACE RULE, overriding anything the costume suggests: this character has NO EARS AT ALL and NO NOSE AT ALL. Draw NO ear on either side of the head - not under the headwear, not beside the hair, not in front of it. The sides of the head are smooth bare skin running unbroken down to the jawline, with no ear shape, no ear outline and no inner-ear line anywhere. Draw NO nose - no nose shape, no bridge, no nostril line, no shading where a nose would be. The face carries ONLY eyes, brows and a mouth. Flat stylized cartoon skull - no jaw, no cheekbones, no realistic face structure. RESTING FACE (copy EXACTLY from the reference image, the bald template): heavy lowered upper eyelids covering the top of each eye, small pupils set high against the upper lid, thin level gently-arched brows, and a small closed mouth with the faintest upturn at its corners. Eyes look straight out at the viewer, level and symmetric, not sideways, not up, not down. RESTING STANCE (copy EXACTLY from the reference image): standing straight and frontal, facing the viewer square-on, both shoulders level, both arms hanging straight down at the sides, both hands open, relaxed and EMPTY, feet flat and evenly planted. Carries NOTHING and touches nothing. No emotion of any kind, completely neutral and at rest. Plain flat light-grey studio background, no horizon line, no floor line, no props, no text.
```
