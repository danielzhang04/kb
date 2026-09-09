# Qwen reference pair independent visual review — 2026-09-09

## Evidence inspected

I inspected the original g01 and the two Qwen PNGs at their original resolution.
This review covers visible image evidence only; it makes no claim about the live
receipt, lifecycle, teardown, or cost.

| asset | bytes | SHA-256 |
| --- | ---: | --- |
| `g01.jpg` | 737,366 | `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed` |
| `qwen-g01-seed-481516234.png` | 939,396 | `c067f72399e134fb60d424372434d01c5529dd1713156477cc22a14c532ab546` |
| `qwen-g01-seed-90210.png` | 699,656 | `ce538d79365d9d1ace62ba69028c13d403b06e7d54347174f11a0ee78de3c5e5` |

The source is 1408×768 and each Qwen output is 1392×752.

## Visible observations

### Seed 481516234

The output keeps the reference's long centre-parted black hair, winged eyes,
straight brows, light-medium complexion, and broad face-family cues. Its face is
nevertheless narrower and more angular than g01, with a more projected nose,
thinner and differently shaped lips, and a sharper jaw. It does not establish a
stable match to the source.

The eyes look toward the camera, but the head turn reads ambiguous and likely in
the opposite image direction from the requested own-right/image-left turn. The
crop ends around the upper torso: it does not reach below the waist and neither
elbow is visible. Headroom is ample. The shirt is an opaque black crew-neck and
the plain warm off-white wall is on target.

Skin, hair, and facial shading are heavily airbrushed and illustration-like.
There is no convincing skin texture. No extra person, text, watermark, exposed
torso, or obvious gross anatomy defect is visible. The subject plausibly reads as
an adult around twenty-one, without proving an exact age.

### Seed 90210

This face is closer to g01 in its frontal eye shape, nose width, full lips, and
soft cheek contour. The jaw remains longer and narrower, and the eyes, mouth,
and overall facial proportions differ enough that identity is still uncertain.
It also does not match seed 481516234 consistently: the first result has a
sharper narrow face and different nose and mouth geometry.

The frame reaches approximately the hip/waist area with headroom, and both elbow
areas are within the frame, so it comes materially closer to the requested
composition. It remains almost fully frontal and does not visibly demonstrate
the requested body-and-head turn. Gaze is direct. The opaque black crew-neck,
soft light, and warm plain wall comply.

The skin is again smooth and synthetic, with softened facial and hair detail.
No extra person, text, watermark, exposed torso, or clear anatomy defect is
visible. The subject plausibly reads as an adult around twenty-one, without
proving an exact age.

## Recommendation

**STOP before the six-row pilot.** Qwen improves clothing and background control,
and seed 90210 improves framing compared with the rejected Omni pair. The two
Qwen results still do not show one consistent identity under variation, both
retain conspicuously smoothed synthetic rendering, and only one approaches the
requested body framing while neither clearly performs the specified turn.

Preserve the pair as rejected research evidence. This is not a production,
dataset, or promotion ruling.
