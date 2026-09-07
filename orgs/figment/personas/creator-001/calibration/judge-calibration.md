# vlm_judge calibration -- creator-001

generated: 2026-09-07T00:50:16.878187+00:00
model: `sonnet` · prompt version: `v1`
total images judged: 95 · wall time: 8707.9s · reported cost: $15.4863

## Per-set distributions

### anchors (n=3, pass under proposed thresholds: 3/3 = 100%)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| same_person | 3 | 78.0000 | 79.0000 | 88.0000 | 88.0000 | 88.0000 |
| apparent_age_reference | 3 | 22.0000 | 22.0000 | 22.0000 | 22.9000 | 23.0000 |
| apparent_age_candidate | 3 | 22.0000 | 22.0000 | 22.0000 | 22.0000 | 22.0000 |
| age_delta | 3 | -1.0000 | -0.9000 | 0.0000 | 0.0000 | 0.0000 |
| skin_realism | 3 | 35.0000 | 37.0000 | 55.0000 | 55.0000 | 55.0000 |
| gloss | 3 | 30.0000 | 31.0000 | 40.0000 | 44.5000 | 45.0000 |
| artifacts | 3 | 20.0000 | 20.0000 | 20.0000 | 29.0000 | 30.0000 |

### track1-dataset (n=31, pass under proposed thresholds: 22/31 = 71%)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| same_person | 31 | 55.0000 | 61.0000 | 78.0000 | 88.0000 | 88.0000 |
| apparent_age_reference | 31 | 21.0000 | 22.0000 | 23.0000 | 23.0000 | 23.0000 |
| apparent_age_candidate | 31 | 21.0000 | 22.0000 | 23.0000 | 24.0000 | 25.0000 |
| age_delta | 31 | -1.0000 | -1.0000 | 0.0000 | 1.5000 | 2.0000 |
| skin_realism | 31 | 25.0000 | 25.0000 | 45.0000 | 66.5000 | 78.0000 |
| gloss | 31 | 25.0000 | 30.0000 | 55.0000 | 65.0000 | 68.0000 |
| artifacts | 31 | 15.0000 | 20.0000 | 22.0000 | 45.0000 | 45.0000 |

### lora-tester (n=8, pass under proposed thresholds: 0/8 = 0%)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| same_person | 8 | 8.0000 | 15.7000 | 45.0000 | 62.0000 | 62.0000 |
| apparent_age_reference | 8 | 21.0000 | 21.0000 | 23.0000 | 23.0000 | 23.0000 |
| apparent_age_candidate | 8 | 25.0000 | 25.3500 | 28.0000 | 36.2500 | 38.0000 |
| age_delta | 8 | 2.0000 | 2.3500 | 5.0000 | 15.2500 | 17.0000 |
| skin_realism | 8 | 30.0000 | 30.0000 | 50.0000 | 81.7000 | 88.0000 |
| gloss | 8 | 15.0000 | 16.7500 | 32.5000 | 58.2500 | 60.0000 |
| artifacts | 8 | 10.0000 | 11.7500 | 32.5000 | 40.0000 | 40.0000 |

### qwen-anchor-edits (n=6, pass under proposed thresholds: 4/6 = 67%)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| same_person | 6 | 72.0000 | 72.0000 | 77.0000 | 84.2500 | 85.0000 |
| apparent_age_reference | 6 | 23.0000 | 23.0000 | 23.0000 | 24.0000 | 24.0000 |
| apparent_age_candidate | 6 | 24.0000 | 24.0000 | 24.0000 | 25.0000 | 25.0000 |
| age_delta | 6 | 0.0000 | 0.2500 | 1.0000 | 1.7500 | 2.0000 |
| skin_realism | 6 | 30.0000 | 32.5000 | 47.5000 | 61.0000 | 63.0000 |
| gloss | 6 | 30.0000 | 30.0000 | 37.5000 | 55.0000 | 55.0000 |
| artifacts | 6 | 20.0000 | 20.0000 | 25.0000 | 36.2500 | 40.0000 |

### passport-candidates (n=12, pass under proposed thresholds: 0/12 = 0%)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| same_person | 12 | 2.0000 | 2.5500 | 15.0000 | 57.0000 | 68.0000 |
| apparent_age_reference | 12 | 21.0000 | 21.5500 | 22.0000 | 23.0000 | 23.0000 |
| apparent_age_candidate | 12 | 20.0000 | 20.5500 | 23.5000 | 26.4500 | 27.0000 |
| age_delta | 12 | -2.0000 | -1.4500 | 1.5000 | 4.4500 | 5.0000 |
| skin_realism | 12 | 35.0000 | 46.0000 | 61.0000 | 82.0000 | 82.0000 |
| gloss | 12 | 15.0000 | 17.7500 | 31.0000 | 49.5000 | 55.0000 |
| artifacts | 12 | 8.0000 | 8.0000 | 20.0000 | 35.0000 | 35.0000 |

### expansion-03 (n=35, pass under proposed thresholds: 23/35 = 66%)

| metric | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| same_person | 35 | 45.0000 | 58.5000 | 78.0000 | 88.0000 | 88.0000 |
| apparent_age_reference | 35 | 22.0000 | 22.0000 | 23.0000 | 23.0000 | 23.0000 |
| apparent_age_candidate | 35 | 20.0000 | 21.0000 | 22.0000 | 23.0000 | 24.0000 |
| age_delta | 35 | -2.0000 | -2.0000 | -1.0000 | 1.0000 | 1.0000 |
| skin_realism | 35 | 22.0000 | 34.1000 | 45.0000 | 55.9000 | 62.0000 |
| gloss | 35 | 25.0000 | 28.5000 | 35.0000 | 55.0000 | 58.0000 |
| artifacts | 35 | 15.0000 | 15.0000 | 25.0000 | 44.5000 | 62.0000 |

## Proposed thresholds

- `same_person_min`: 70.2
  - separability: anchor self-consistency min 78.0000 x0.9 buffer = 70.2000; track1-dataset median 78.0000 >= proposed floor (does NOT separate); lora-tester median 45.0000 < proposed floor (separates); qwen-anchor-edits median 77.0000 >= proposed floor (does NOT separate); passport-candidates median 15.0000 < proposed floor (separates); expansion-03 median 78.0000 >= proposed floor (does NOT separate)
- `age_delta_max`: 1.5
  - separability: anchor self-consistency max 1.0000 x1.5 buffer = 1.5000; track1-dataset median 1.0000 <= proposed ceiling (does NOT separate); lora-tester median 5.0000 > proposed ceiling (separates); qwen-anchor-edits median 1.0000 <= proposed ceiling (does NOT separate); passport-candidates median 2.0000 > proposed ceiling (separates); expansion-03 median 1.0000 <= proposed ceiling (does NOT separate)
- `skin_realism_min`: 31.5
  - separability: anchor self-consistency min 35.0000 x0.9 buffer = 31.5000; track1-dataset median 45.0000 >= proposed floor (does NOT separate); lora-tester median 50.0000 >= proposed floor (does NOT separate); qwen-anchor-edits median 47.5000 >= proposed floor (does NOT separate); passport-candidates median 61.0000 >= proposed floor (does NOT separate); expansion-03 median 45.0000 >= proposed floor (does NOT separate)
- `gloss_max`: 67.5
  - separability: anchor self-consistency max 45.0000 x1.5 buffer = 67.5000; track1-dataset median 55.0000 <= proposed ceiling (does NOT separate); lora-tester median 32.5000 <= proposed ceiling (does NOT separate); qwen-anchor-edits median 37.5000 <= proposed ceiling (does NOT separate); passport-candidates median 31.0000 <= proposed ceiling (does NOT separate); expansion-03 median 35.0000 <= proposed ceiling (does NOT separate)
- `artifacts_max`: 45.0
  - separability: anchor self-consistency max 30.0000 x1.5 buffer = 45.0000; track1-dataset median 22.0000 <= proposed ceiling (does NOT separate); lora-tester median 32.5000 <= proposed ceiling (does NOT separate); qwen-anchor-edits median 25.0000 <= proposed ceiling (does NOT separate); passport-candidates median 20.0000 <= proposed ceiling (does NOT separate); expansion-03 median 25.0000 <= proposed ceiling (does NOT separate)
