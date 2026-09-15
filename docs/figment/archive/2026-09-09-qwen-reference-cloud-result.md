# Qwen reference cloud result — 2026-09-09

## Execution and receipt

The explicitly approved one-reference, two-seed Qwen experiment launched at
`2026-09-09T16:19:29.652043Z`. ComfyUI became ready at
`2026-09-09T16:44:23.992Z`, after 1,491.9 seconds. The harness uploaded the exact
737,366-byte g01 input and completed both jobs:

| Seed | Job time | Output | Bytes | Dimensions | SHA-256 |
| --- | ---: | --- | ---: | --- | --- |
| `481516234` | 134.416 s | `qwen-g01-seed-481516234.png` | 939,396 | 1392×752 | `c067f72399e134fb60d424372434d01c5529dd1713156477cc22a14c532ab546` |
| `90210` | 122.856 s | `qwen-g01-seed-90210.png` | 699,656 | 1392×752 | `ce538d79365d9d1ace62ba69028c13d403b06e7d54347174f11a0ee78de3c5e5` |

The final receipt is MAIN
`_private/figment-qwen-reference-run-20260909-v1/run.json`. It records termination
at `2026-09-09T16:48:42Z`, verified termination, 1,752.644 seconds total elapsed,
and an estimated actual cost of $0.530662 on the measured ready rate. Root's separate
read-only inventory at `2026-09-09T16:50:06Z` returned zero pods. The reconciled
Figment arc is $38.778929/$50, leaving $11.221071; the September 9 provider estimate
is $0.978544.

The verification record is MAIN
`_private/figment-qwen-reference-v1-output-verification.json`. Both original PNGs
remain untouched in the run root; the harness output index still records them as unreviewed. Their
embedded graphs match the submitted graph after only the known server-added
`LoadImage.is_changed` field is normalized, and that value equals the g01 SHA-256.
This metadata is not cryptographic remote-input attestation, and the remote input was
not independently read.

## Root original-resolution review

Root's disposition is **STOP before the six-row pilot**. Both images improve on the
Omni pair in clothing and setting: each is fully clothed in an opaque crew-neck top
against a plain warm wall. Both present as clearly adult and plausibly early twenties,
without exact-age proof or a clothing-quarantine failure.

- Seed `481516234` uses an upper-body crop that misses the waist and elbows. The head
  turns toward image-right, opposite the requested image-left direction. Skin remains
  smoother and glossier than g01, and the face is narrower and longer.
- Seed `90210` is closer to g01 in face appearance, but remains front-on rather than
  delivering the requested turn. It reaches roughly waist/hip level with both elbow
  areas visible; the requested below-waist extent is less clear. Skin is softened,
  and face geometry differs from both g01 and the other seed.

The major stop reasons are identity geometry, skin realism, and the missed turn. The
pair is not dataset-eligible and does not approve a LoRA, checkpoint, or production
identity. The separately authored [independent review](2026-09-09-qwen-reference-pair-independent-review.md)
also recommends STOP. It gives seed 90210 more credit for framing; both reviews
agree on the identity, realism and turn failures.
