# Measured audio grammar — 8 reference videos (SYNTHESIS GATE)

Reliable = load-bearing (sets dials). Directional = low-confidence, never a dial.
Target bands EXCLUDE Kurzgesagt (the restrained wall-to-wall-bed floor). Ducking is dropped for
near-continuous-VO videos (gap_frac < 0.12) where the gap sample is too thin to trust.

## Per-video

| video | ch | LUFS | LRA | TP | wpm | gap | music% | dip dB | duck dB (trust) | sustain pause | dip·punch% |
|---|---|---|---|---|---|---|---|---|---|---|---|
| crayon-palantir | crayon | -18.5 | 3.5 | 1.5 | 193.0 | 0.5 | 71.7 | 16.22 | 3.1 (Y) | 0.421@0.8s | 36.4 |
| crayon-rockefeller | crayon | -18.4 | 3.7 | 0.0 | 196.8 | 0.5 | 84.9 | 17.89 | 1.58 (Y) | 0.455@0.55s | 36.3 |
| crayon-singapore | crayon | -17.9 | 3.4 | 0.5 | 199.8 | 0.5 | 78.8 | 16.08 | 2.22 (Y) | 0.292@0.8s | 20.6 |
| heyhistorically-disappeared | heyhistorically | -14.9 | 3.3 | 1.0 | 170.0 | 0.3 | 84.9 | 19.29 | 2.84 (n/gap=0.039) | 0.2@0.4s | 38.9 |
| oversimplified-prohibition | oversimplified | -21.5 | 4.6 | -0.2 | 210.0 | 0.3 | 61.5 | 22.81 | 1.59 (n/gap=0.103) | 0.136@0.6s | 39.5 |
| kurzgesagt-scariest | kurzgesagt·floor | -15.2 | 2.8 | -2.3 | 164.1 | 0.6 | 93.7 | 16.98 | 0.91 (Y) | 0.113@0.55s | 12.5 |
| oversimplified-ww2-p1 | oversimplified | -14.3 | 4.1 | 1.3 | 236.7 | 0.4 | 80.8 | 19.68 | -4.1 (n/gap=0.088) | 0.091@0.3s | 37.3 |
| oversimplified-coldwar-p1 | oversimplified | -20.4 | 4.6 | 0.6 | 236.5 | 0.4 | 62.3 | 26.21 | -1.58 (Y) | 0.111@0.3s | 32.4 |

## Cross-video bands (target set, floor excluded)

- **loudness_lufs**: median **-18.4** (range -21.5–-14.3, n=7)
- **lra**: median **3.7** (range 3.3–4.6, n=7)
- **true_peak**: median **0.6** (range -0.2–1.5, n=7)
- **wpm**: median **199.8** (range 170.0–236.7, n=7)
- **speech_gap_med_s**: median **0.4** (range 0.3–0.5, n=7)
- **music_presence_pct**: median **78.8** (range 61.5–84.9, n=7)
- **dip_depth_db**: median **19.29** (range 16.08–26.21, n=7)
- **ducking_db_trusted**: median **1.9** (range -1.58–3.1, n=4)
- **breath_sustained_pause_s**: median **0.55** (range 0.3–0.8, n=7)
- **breath_sustained_rate**: median **0.2** (range 0.09–0.46, n=7)
- **breath_percussive_pause_s**: median **0.6** (range 0.3–1.2, n=7)
- **onset_density_min_DIRECTIONAL**: median **24.77** (range 17.88–40.72, n=7)
- **dip_on_punchline_pct_DIRECTIONAL**: median **36.4** (range 20.6–39.5, n=7)
