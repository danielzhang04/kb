# Independent public sampler-package comparison review

This local review inspected only the two original PNGs named below at original
resolution. It makes no acceptance, identity, age, promotion, or launch decision.

## Inputs

| Cell | Package | PNG SHA-256 |
| --- | --- | --- |
| Current | 4 steps / `res_2s` / `beta` | `0906c9f9ef6d6874f323bf3ac28123686baf7b1a2c8ecb0ad339f450735c03e9` |
| Official-template package | 8 steps / `euler` / `simple` | `41caf55ca0c8e689d09c9b4bd15639a9d944fe836664d5e8a2fd35ca0e7a8af2` |

The compiled manifest SHA-256 is
`4c5fb1c27d6ddbd21181adac46fc4c4cd0e0a64a468f37cf3b1d4a41af06fef9`.
The frozen plan fixes the same baseline text, seed 1595, public base model pins,
direct text conditioning, CFG 1, denoise 1, and 1448x2176 resolution. The only
image-producing delta is the three-setting sampler package above.

## Observations

Both outputs show a fictional clothed woman whose presentation reads clearly as an
adult. Neither supplies reliable evidence for an exact age such as 21; both read as
adult portraits without an ambiguous-child appearance.

Both retain the full head with space above the hairline. The official-template
package is modestly tighter around the head and upper torso, while the current
package leaves slightly more space and shows more of the torso. Neither is a strict
shoulders-up crop: the lower frame extends well below the shoulders into the torso,
despite the head-and-shoulders framing intent.

Both have coherent plain black crew-neck garments and intact shoulders, neck, and
hands-free framing. They read as plausible phone-portrait style images with soft
off-white backgrounds and generally natural facial texture. The package change
also changes facial appearance and small compositional details, so this pair is a
visible package comparison, not a stable identity comparison.

## Limit

This is one matched seed and one bundled sampler change: steps, sampler, and
scheduler changed together. It cannot attribute the visible differences to an
individual setting, demonstrate repeatability, establish a preferred sampler, or
support an age or identity conclusion. Since neither cell materially achieves the
strict shoulders-up framing target, this pair does not provide a clear useful
framing improvement for a follow-on sampler search; the plan's stop rule applies.
