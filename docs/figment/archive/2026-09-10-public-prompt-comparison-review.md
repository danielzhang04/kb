# Public prompt comparison independent review — 2026-09-10

## Scope and evidence

This is an independent original-resolution local review of two fictional,
clothed-adult public-base images. It is a one-seed prompt observation only. It
does not select a checkpoint, make an identity finding, accept an image, score
a quality gate, authorize a further experiment, or reopen the blocked private
checkpoint route.

Both originals were viewed locally with native `view_image` at 1448x2176. No
image was copied, exported, sent to a service, or used for automated grading.

| Image | SHA-256 | Recorded RGB SHA-256 |
| --- | --- | --- |
| Baseline, seed 1595 | `8b67e4938d76e747b4f321724dfc041c72f30dca8787f2aebe65edba29f413b8` | `abc6e6b6233ddabd3e76523bfa8f83ed6568b05be4af651a1d2f80a8720fab3c` |
| Frozen adult-21 wording, seed 1595 | `605c622d1e466150319f4856709a13a8ab4fa34d9a513f23a9f1565da98e1052` | `5e21da760cac7c9b9da891921e7c22b3ed84ba6e3f343f6a93a7172d3ec0c282` |

The local final verification binds manifest
`ba498949298f12d9dea9320c514de0a75e9a3aa7010403dc2ad4b408c6af5fba`
and reports that the actual graphs match it, the baseline RGB is identical to
the prior completed public control, and the only graph differences are positive
text and output prefix. It reports zero private uploads, verified termination,
and no quality acceptance. These are metadata checks, not visual findings.

## Observations

The baseline frames the head, shoulders, and substantial torso, with hands out
of frame. It remains wider than a narrow shoulders-up crop. The frozen
adult-21 wording produces a much tighter head-and-shoulders image, with hands
outside the crop. It is relatively closer to the requested framing at this
seed, but it still fails the frozen literal target: the top of the hair/head is
cut by the upper edge and the lower edge extends below the requested upper-chest
boundary.

Both images are photographic at normal viewing size and show an opaque black
crew-neck garment without a visible garment or anatomy-integrity defect. The
adult-21 wording has especially visible skin texture, forehead lines, and
flyaway hair. Those features support a mature photographic rendering, but the
subject reads as a mature adult rather than visibly about 21. Exact age cannot
be determined from either image.

The two images differ in more than crop and apparent age because the complete
positive text changed. This single matched seed supports the narrow observation
that this text package changed framing under the recorded public-base graph. It
does not identify a causal phrase, establish a general prompt effect across
seeds or scenes, show identity consistency, or establish a better model. Since
the literal framing requirement still misses, it supplies no basis to continue
this wording branch.

## Limits

Only one seed and one public-base execution per text were reviewed. There is no
reference-image or LoRA condition in this comparison, and no inference about a
checkpoint follows. The result records evidence for root review; it creates no
automatic prompt search, launch, acceptance, or promotion.
