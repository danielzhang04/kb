# Input and book review — 2026-09-08

## Scope

Independent read-only comparison of `creator-001/anchors/g01.jpg` and the supplied
`g01-frontal-black-tee-v1.png`, both viewed at original resolution. This is an
experimental observation, not a training decision, operator ruling, or approval.

## Single-seed image observation

The supplied image is a useful controlled frontal reference experiment because it removes
the original room scene and changes the wardrobe/crop while keeping the broad black-hair,
frontal-portrait condition. It is not close enough to `g01` to support a resemblance pass.

- **Eyes and brows:** the new image has rounder, more open eyes, a heavier/straighter brow
  treatment, and a more symmetric eyeliner shape. `g01` reads with narrower eyes and a more
  lifted, asymmetric expression.
- **Nose and jaw:** the new nose bridge and tip read narrower and more centrally symmetric;
  its lower face is broader and more oval. The reference has a narrower jaw taper and a
  different nose-tip/nostril relationship.
- **Realism:** the new image has credible hair flyaways, pores, shirt texture, and ordinary
  indoor lighting. Its near-symmetry, uniformly soft cheek/forehead texture, and smooth
  transitions around the nose and lips still give it a rendered/retouched quality beside the
  reference. This is an observation about this image, not a score.
- **Adult presentation and clothing:** it presents an adult woman. The black crew-neck shirt
  is opaque and intact; no exact age inference is made from either image.

The next controlled comparison can use this image as a separately labeled candidate input,
but should retain `g01` as the comparator and record the facial-geometry disagreement above.
It should not replace the reference or be treated as a promotion result from one image.

## Wardrobe-only image observation

Viewed `g01-wardrobe-only-black-tee-v1.png` at original resolution (SHA-256
`e33f2d0c396e4e0f7eed49240271d972d36bdafa2a6f27ef04dcfaaf3cf6f6a2`) against the
canonical `g01.jpg`. This is a separate visual observation, not a training decision or
approval.

- **Resemblance:** the images have strong visual overlap in the hairline and center part,
  brow and eye shape, nose bridge and tip, lip shape, jaw taper, jewelry, and room setting.
  The black-tee image has a more centered, closer framing and a different hair lay, so this
  review cannot establish identity from a single comparison. It is suitable as a
  wardrobe-only experimental input only if retained as distinct from the canonical anchor.
- **Adult presentation and clothing:** the person presents as an adult; no exact age is
  inferred. The plain black crew-neck tee is opaque and intact, covering the torso and
  shoulders. No clothing failure is visible in this image.

## Research-book source check

Read all seven book chapters against the named local reports, the current train/recovery code,
and `r15` section 5. The book correctly states that the two growth SOP PDFs were read and
summarized in r15; it does not repeat r14's earlier unavailable-source claim. Its repeated
distinction between diagnostic mechanics and promotion/quality proof is supported by the
current driver lineage checks and the live-tester report.

One wording correction is warranted in `architecture-and-operations.md`: “The completed
diagnostic demonstrated this sequence after the timestamp correction” compresses two separate
facts. The completed diagnostic followed the timestamp repair, and its live-tester report
records the durable acquired pod ID and verified absence. If the book is revised, distinguish
that live lifecycle evidence from the parser's regression-test coverage rather than treating
either as a quality or promotion proof. No other concrete book error was found in this read-only
check.

## Small head-turn / charcoal-tee candidate

Viewed the canonical `creator-001/anchors/g01.jpg` and
`C:/Users/danie/kb/_private/figment-single-seed-20260908/g01-small-head-turn-charcoal-tee-v1.png`
at original resolution. The candidate's SHA-256 recomputed to
`55e60a741ff1e4be78cccde7a807ca8ff9e261cd4b3ab1131bb3060b38961dcb`, which matches the adjacent
`g01-small-head-turn-charcoal-tee-v1.provenance.json`. That record names `anchors/g01.jpg` as the
sole source, records its source hash, and records an experimental-unreviewed, training-ineligible
status. This observation neither accepts nor rejects the candidate for training.

- **Identity geometry:** the long center-parted dark hair, brow/eyelid treatment, nose bridge,
  lips, jaw taper, earrings, and bedroom scene provide substantial resemblance cues. The candidate
  has a more squarely open eye expression, fuller lower cheeks, and a subtly broader jaw/lower-face
  read than the anchor. A single visual comparison cannot establish identity preservation.
- **Realism:** ordinary room geometry, fabric texture, flyaway hairs, pores, and directional
  daylight remain credible. The candidate has smoother cheek and under-eye transitions and a more
  uniformly polished face treatment than the anchor; that is a visual observation, not a quality
  score.
- **Adult presentation and clothing:** it presents as an adult woman, with no exact-age claim.
  The charcoal crew-neck T-shirt is opaque, intact, and covers the torso and shoulders.
- **Pose:** a small three-quarter head turn is visible while the shoulders remain near-square. The
  requested approximate angle and stated direction are not measured, so the comparison only
  confirms a visible small pose change.

The provenance prompt is therefore broadly reflected in the visible wardrobe and pose change, but
its self-described preservation outcome is not independently established by that prompt or record.
