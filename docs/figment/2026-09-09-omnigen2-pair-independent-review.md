# OmniGen2 V3 pair independent visual review

## Evidence viewed

I inspected the original g01 and only these two V3 PNGs at their supplied resolution:

| asset | SHA-256 |
| --- | --- |
| `g01.jpg` | `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed` |
| `omnigen2-g01-seed-481516234.png` | `3bff11b0dbd8bd14af971d8e16e5a230db2b718a58b4af9819ecd9dc05429edc` |
| `omnigen2-g01-seed-90210.png` | `be9f983de5a1318ebb680f856c925ef33a55d31afe235e32122685180568c3b0` |

The execution receipt is reported as successful with two images, completed 08:16:25 UTC,
estimated cost $0.325452, and verified termination. That proves bounded execution, not image
quality or a promotion decision.

## Visible observations

g01 shows a black-haired woman in a bedroom, wearing a structured black corset-style top and
dark skirt. Both outputs retain black straight hair, light-medium complexion, winged eye makeup,
pink blush/lips, small hoops, layered silver necklaces including a cross, and a dark top. Those
repeated features make the same fictional-identity hypothesis plausible, especially for seed
481516234.

The pair is not sufficiently consistent to establish identity under variation. Seed 481516234
has a narrower, more oval face and a more pronounced downward/neutral mouth. Seed 90210 has a
rounder face, broader nose and different smile/mouth geometry. Both are heavily smoothed,
illustrative beauty-render portraits rather than convincing full-resolution photographic skin;
the warm, nearly uniform background further reduces the reference scene match.

Both faces read as adult and plausibly early twenties, but an apparent-age estimate from these
images is not proof of an exact age. Clothing is present and covers the torso in both outputs.
Seed 90210 is closest to the requested plain black crew-neck top. Seed 481516234 instead has a
black low-cut camisole/corset-like neckline, so it misses that clothing specification. Neither
output visibly demonstrates the requested waist-up body turn to image-right/image-left; both are
largely frontal, tight portrait crops. The warm off-white/plain wall target is only partly met:
the background is plain but noticeably peach/orange.

## Recommendation

**Stop before the six-row pilot.** The pair is useful evidence that the adapter produced two
bounded reference-conditioned images, but it does not meet the frozen appearance and composition
target consistently enough to seed a diversity expansion. Preserve the receipt and both images as
rejected research evidence. A future bounded hypothesis should address one declared cause at a
time, including composition/clothing control or realism, before proposing a new pair.
