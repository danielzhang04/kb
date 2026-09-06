# identity_gate calibration -- creator-001

generated: 2026-09-06T23:16:46.322642+00:00
own anchor: `g01`

## Anchor pairwise identity

- `g01:g02`: 0.9138
- `g01:g07`: 0.9262
- `g02:g07`: 0.8860

## Per-set distributions

### anchors (n=3, pass under gate.yaml preview: 0)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| identity_own | 3 | 0.9138 | 0.9150 | 0.9262 | 0.9926 | 1.0000 |
| identity_max | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| age_value | 3 | 29.8124 | 29.8192 | 29.8806 | 30.3232 | 30.3723 |
| age_delta | 3 | -0.2094 | -0.2026 | -0.1412 | 0.3014 | 0.3506 |
| gloss | 3 | 0.0000 | 0.0000 | 0.0005 | 0.0070 | 0.0078 |
| niqe | 3 | 0.4781 | 0.4895 | 0.5916 | 0.6041 | 0.6055 |
| laplacian_variance | 3 | 328.0772 | 333.4982 | 382.2873 | 383.2903 | 383.4018 |
| face_px | 3 | 115 | 117.3000 | 138.0000 | 154.2000 | 156 |

### track1-dataset (n=31, pass under gate.yaml preview: 0)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| identity_own | 30 | 0.7380 | 0.7556 | 0.9233 | 0.9547 | 0.9589 |
| identity_max | 30 | 0.7380 | 0.7556 | 0.9256 | 0.9547 | 0.9589 |
| age_value | 30 | 19.6274 | 20.4455 | 23.0207 | 30.6982 | 31.3586 |
| age_delta | 30 | -10.3944 | -9.5762 | -7.0011 | 0.6765 | 1.3369 |
| gloss | 30 | 0.0000 | 0.0001 | 0.0004 | 0.0015 | 0.0028 |
| niqe | 30 | 2.2301 | 2.2434 | 2.7678 | 4.8329 | 5.3376 |
| laplacian_variance | 30 | 101.3006 | 109.5315 | 152.1472 | 306.5428 | 357.3105 |
| face_px | 30 | 251 | 291.9000 | 1046.5000 | 1466.2000 | 1494 |

### lora-tester (n=8, pass under gate.yaml preview: 1)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| identity_own | 8 | 0.2644 | 0.4392 | 0.8335 | 0.8889 | 0.8938 |
| identity_max | 8 | 0.2644 | 0.4392 | 0.8335 | 0.8889 | 0.8938 |
| age_value | 8 | 21.4030 | 21.4473 | 23.4383 | 27.1526 | 27.7567 |
| age_delta | 8 | -8.6187 | -8.5745 | -6.5835 | -2.8692 | -2.2651 |
| gloss | 8 | 0.0000 | 0.0000 | 0.0000 | 0.0001 | 0.0001 |
| niqe | 8 | 4.5129 | 4.5906 | 5.0117 | 5.7804 | 5.9499 |
| laplacian_variance | 8 | 80.1483 | 108.3441 | 189.5348 | 247.9083 | 256.2938 |
| face_px | 8 | 735 | 743.0500 | 797.0000 | 854.6000 | 870 |

### qwen-anchor-edits (n=6, pass under gate.yaml preview: 0)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| identity_own | 6 | 0.8287 | 0.8465 | 0.9236 | 0.9469 | 0.9498 |
| identity_max | 6 | 0.8287 | 0.8465 | 0.9236 | 0.9469 | 0.9498 |
| age_value | 6 | 22.3457 | 22.3485 | 23.1875 | 25.4242 | 25.7486 |
| age_delta | 6 | -7.6761 | -7.6733 | -6.8343 | -4.5976 | -4.2731 |
| gloss | 6 | 0.0000 | 0.0000 | 0.0002 | 0.0004 | 0.0005 |
| niqe | 6 | 3.3944 | 3.4315 | 3.5658 | 4.1232 | 4.1713 |
| laplacian_variance | 6 | 133.8428 | 137.9413 | 186.3264 | 251.9457 | 266.0128 |
| face_px | 6 | 509 | 545.5000 | 804.5000 | 971.5000 | 984 |

### passport-candidates (n=12, pass under gate.yaml preview: 0)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| identity_own | 12 | -0.0012 | 0.0157 | 0.2333 | 0.6360 | 0.6955 |
| identity_max | 12 | 0.0235 | 0.0502 | 0.2333 | 0.6388 | 0.6955 |
| age_value | 12 | 21.1316 | 23.8484 | 27.9570 | 33.9924 | 35.0971 |
| age_delta | 12 | -8.8902 | -6.1734 | -2.0648 | 3.9706 | 5.0753 |
| gloss | 12 | 0.0000 | 0.0000 | 0.0000 | 0.0264 | 0.0583 |
| niqe | 12 | 2.0429 | 2.3805 | 3.3298 | 4.0497 | 4.3232 |
| laplacian_variance | 12 | 228.1724 | 229.5355 | 335.5429 | 552.3202 | 565.1740 |
| face_px | 12 | 191 | 191.5500 | 232.0000 | 314.7500 | 345 |

### expansion-03 (n=35, pass under gate.yaml preview: 0)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| identity_own | 35 | 0.6785 | 0.7148 | 0.8419 | 0.9081 | 0.9104 |
| identity_max | 35 | 0.7245 | 0.7313 | 0.8671 | 0.9255 | 0.9573 |
| age_value | 35 | 21.9081 | 23.4004 | 30.2068 | 32.2367 | 32.5535 |
| age_delta | 35 | -8.1137 | -6.6213 | 0.1850 | 2.2149 | 2.5317 |
| gloss | 35 | 0.0000 | 0.0000 | 0.0000 | 0.0036 | 0.0107 |
| niqe | 35 | 1.0049 | 1.0826 | 1.5187 | 2.8664 | 3.2742 |
| laplacian_variance | 35 | 56.1759 | 140.4110 | 284.1132 | 561.5156 | 626.7899 |
| face_px | 35 | 80 | 86.9000 | 134.0000 | 319.2000 | 379 |

## Proposed thresholds

- `identity_own_min`: 0.7907
  - separability: clean separation: every anchor-pair cosine (0.8860 min) exceeds every passport candidate's identity (0.6955 max); proposed floor sits at the midpoint
- `age_delta_max_years`: 0.5258
  - separability: anchor self-consistency max 0.3506 x1.5 buffer = 0.5258; track1-dataset median -7.0011 <= proposed ceiling (does NOT separate); lora-tester median -6.5835 <= proposed ceiling (does NOT separate); qwen-anchor-edits median -6.8343 <= proposed ceiling (does NOT separate); passport-candidates median -2.0648 <= proposed ceiling (does NOT separate); expansion-03 median 0.1850 <= proposed ceiling (does NOT separate)
- `gloss_max`: 0.0117
  - separability: anchor self-consistency max 0.0078 x1.5 buffer = 0.0117; track1-dataset median 0.0004 <= proposed ceiling (does NOT separate); lora-tester median 0.0000 <= proposed ceiling (does NOT separate); qwen-anchor-edits median 0.0002 <= proposed ceiling (does NOT separate); passport-candidates median 0.0000 <= proposed ceiling (does NOT separate); expansion-03 median 0.0000 <= proposed ceiling (does NOT separate)
- `niqe_max`: 0.9083
  - separability: anchor self-consistency max 0.6055 x1.5 buffer = 0.9083; track1-dataset median 2.7678 > proposed ceiling (separates); lora-tester median 5.0117 > proposed ceiling (separates); qwen-anchor-edits median 3.5658 > proposed ceiling (separates); passport-candidates median 3.3298 > proposed ceiling (separates); expansion-03 median 1.5187 > proposed ceiling (separates)
- `face_px_min`: 600
  - separability: carried forward from persona.identity.floor.min_face_px, not re-derived from these sets (see gate.yaml)
