# Canonical seed adequacy audit

## Scope

This is a read-only comparison of the three declared `creator-001` reference
JPEGs. It does not change the current provisional `g01` canonical choice,
persona, source provenance, prompts, or any gate. It does not interpret a raw
cosine as identity proof or infer an exact age.

I inspected the original JPEGs and the already-frozen fixed640 V2 observer
receipt set, whose aggregate is recorded in [raw reference
observations](2026-09-08-raw-reference-observations.md). The observer's mapped
face rectangle is only a repeatable detector measurement; it is not a manual
face mask, quality score, or selection rule.

## Measured coverage

| Declared file | Original raster | SHA-256 | Fixed640 detector raster | Mapped detector rectangle in original pixels (x, y, width, height) | Rectangle area (original pixels) | Rectangle area / image | Rectangle width / image width | Rectangle height / image height |
| --- | ---: | --- | ---: | --- | ---: | ---: | ---: | ---: |
| `g01.jpg` | 1408 x 768 | `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed` | 640 x 349 | 635.8, 118.1, 135.5, 181.8 | 24,630.1 | 2.278% | 9.623% | 23.670% |
| `g02.jpg` | 768 x 1376 | `d6ef8ec7a619162fb180727421b3c6f6ec05342544065c5f4a02e318ef4f12e6` | 357 x 640 | 338.5, 293.2, 106.7, 147.8 | 15,777.5 | 1.493% | 13.899% | 10.742% |
| `g07.jpg` | 768 x 1376 | `f5457d845687aae1e23461560c2609a630b51bf2fc31cd21bc85ecbc7ed82d6a` | 357 x 640 | 308.8, 281.8, 145.6, 213.5 | 31,092.3 | 2.942% | 18.962% | 15.516% |

All three had one detected face under the same no-upscale,
aspect-preserving `fixed-max-edge-640@1` rule. The rectangles above are the
observer's coordinates mapped back to original pixels; the recognizer used the
original pixels after that mapping. They are therefore suitable for comparing
the available raster coverage, but do not establish resemblance, image quality,
or suitability for a production decision.

## Visual observations

The three originals show the declared fictional adult reference in complete,
opaque clothing within bedroom settings. `g01` is a landscape, upper-body
composition with more room and body context. `g02` is a tall full-body view;
its face is visually and numerically the smallest of the three detector
rectangles. `g07` is a tall, closer upper-body view with the largest detected
face rectangle and the clearest pixel reserve for small face-detail comparison.
Lighting, pose, framing, background, and styling differ across the three, so
these observations do not establish that any apparent difference is caused by
resolution alone.

The current historical-primary rationale for `g01` therefore does **not**
appear to sacrifice face-pixel coverage to `g02`: its mapped rectangle is about
56% larger in area than `g02`'s. It does sacrifice coverage to `g07`, whose
mapped rectangle has about 26% more original-pixel area than `g01`'s and is
about 17% taller.
`g01` still offers the widest scene and upper-body context, which may be useful
for composition continuity. Neither advantage selects an identity source.

For identity-preserving generation, a source with fewer face pixels gives a
model less directly visible detail for eyelids, brows, nose, lips, and skin
texture. In this set the concrete concern is `g01` versus `g07`, not a general
landscape-versus-portrait rule. The existing visual disagreement over g01
resemblance and the uncalibrated observer results mean this is a limitation to
test, not evidence that g07 would preserve identity better.

## Options and controlled next probe

1. Retain provisional `g01` unchanged while the current frozen request and
   diagnostics finish. This keeps the existing comparison lineage intact.
2. Treat `g07` as a candidate source only after a controlled source-selection
   diagnostic. Do not replace `g01` from this measurement alone. `g02` remains
   useful as a declared comparator and pose/context view, but its measured face
   coverage does not justify a resolution-based substitution.
3. Plan one non-production, three-condition source-selection probe: attach only
   `g01`, only `g02`, or only `g07` in the respective condition; hold the model
   pin, prompt text, sampler, seed list, output dimensions, and review rubric
   fixed. Preserve the original source hash and condition label on every
   output. Review outputs at original resolution for the listed facial
   structures, adult presentation, intact opaque clothing, and scene artifacts.
   Do not convert an observer value into a pass or select a source automatically.

That probe compares whole references, not resolution alone: crop, pose,
lighting, and background remain material confounders. A separate matched
resampling experiment would be needed to attribute an effect to face-pixel
coverage itself; none is proposed or run here.

Every condition would retain a common reference ancestry with the existing
materials. As the [single-g01 expansion plan](2026-09-08-single-seed-expansion-plan.md)
already notes for g01-derived entries, any resulting train/eval split is a
within-identity diagnostic, not independent reference validation or evidence of
generalization. The historical seed and training-overlap caveat remains in the
[paired diagnostic review](2026-09-08-paired-diagnostic-review.md).
