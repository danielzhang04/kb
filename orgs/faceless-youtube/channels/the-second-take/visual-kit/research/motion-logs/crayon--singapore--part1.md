# Motion+audio teardown — Crayon Capital, "The Man Who Built Singapore in One Generation" (part 1 of 2)

- **Video:** Crayon Capital — "The Man Who Built Singapore in One Generation"
- **URL:** https://www.youtube.com/watch?v=y51JjcymEAY (968s, 854×480 source, 30fps)
- **Range covered:** 0s–484s (first half; seam sample to ~497s not needed — all events land inside range)
- **Part:** 1 of 2 · **Date:** 2026-07-08
- **Method note:** the video-vision MCP server died mid-run (its cache labels were also ~15s off — verified and discarded). All observations below are from direct ffmpeg burst extraction (3–10 fps) of the plugin's cached source file, cross-checked against the caption timeline via a stamped 1fps survey sheet. Frame evidence lives in `frames/crayon--singapore--part1/` (contact sheets stamped with window-relative timestamps; per-frame JPGs in same-named subfolders). Audio evidence = full-track RMS/spectrogram + 9 per-event spectrogram windows.

## Events (13)

Timestamps are absolute video time. Sheet tile stamps are relative to each window's start (window start given per event). "% fw" = percent of frame width.

### Hard cuts (3)

| # | Time | Narration beat | What changes across the cut | Cut energy | SFX at cut | Frames (window start) |
|---|---|---|---|---|---|---|
| E01 | 37.75 | "That's impossible. **So**, how did they pull this off?" | Dark-red cabinet meeting (full set, 3 characters, map prop) → flat WHITE VOID with a single new narrator character already in frame, mid-talk-cycle. Max value+palette contrast; no transition device. | High (dark→white flip) | Music bed **thins to near-dry** for the void aside (dark band ~37.7–38.5 in `sfx-cut-void.png`), resumes ~38.8 | `e01-cut1-void.png` (36.0) |
| E02 | 103.75 | "…hundreds of thousands. / Singapore became one of Britain's **crown jewels**" | White pictogram diagram (population grid) → BLACK spotlight scene; crowned colonial-flag ball centered, neighbors fade in from black over ~1s, sparkle pops at 104.5/104.75, slight zoom-out 105.0+ | High (white→black flip) | Accent hit at cut; sparkle-register music | `e02-cut2-crownjewel.png` (102.0) |
| E03 | 319.0 | "But here's where things get complicated. Singapore was **tiny**…" | White typed text-card → dark retro-videogame scene (googly-eyed countryball + character-select stat panel). Panel then builds via fade+type (see transitions). | High (white→dark flip) | Chiptune-style blips at 319.1 + 319.7 (`sfx-game-panel.png`) | `e03-cut3-complicated.png` (317.0) |

Pattern: the highest-energy cuts flip background VALUE (dark↔white). Cuts land on the first word of the new sentence. Across all 13 windows every scene change was a hard cut — zero fades/wipes/dissolves at scene seams.

### Element entrances (3)

| # | Time | Narration beat | Mover | Direction+magnitude | Easing | Duration | Entrance style | On word? | SFX | Text treatment | Idle vs active | Frames |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E04 | 51.25–53.5 | "a British guy named Stamford Raffles **showed up**" | Element (tall ship) | Right→left slide-in, ~25–30% fw/s, steady | LINEAR (boat glide, no decel) | ~2.5s+ | slide | Ship visible by "showed up" | Bright chime/pop accents at ~51.8 and ~52.5 (no long whoosh) | — | Fisherman net-dump plays in fg (fish clump falls ~25%/s); water/bg static; head-turn reaction at ~51.5 | `e04-entrance-raffles.png` (49.5) |
| E05 | 123–128 | "We have the big guns… I'm talking **massive**, 15-inch naval guns" | Element (gun art inside thought bubble) + camera | Bubble + gun art SWELL as the boast escalates (gun redrawn bigger ~125.3); simultaneous slow camera push-in ~5–8% scale/s across 5s | Linear grow | ~5s total | grow | Bubble swell lands around "massive" | None isolated (music bed only) | Caption line above: white marker-script, sentence case, swaps instantly per VO line | Talk-cycle (mouth pops each 0.25s), bubble-tail puffs wiggle; bg static | `e05-entrance-gun.png` (123.0) |
| E06 | 15.25 + 14.75 | "We just got **kicked out** of Malaysia!" | Element (newspaper prop; speech-bubble text) | Newspaper swings up from lower right ~40°→0°, WITH real motion blur on the fast frames; ~30% fw travel in ~0.5s. Bubble text: pops on fully formed WITH the cut, swaps instantly per line (no per-word animation) | Prop: fast-in, decel into hold (no overshoot visible at 4fps). Text: snap pop | Prop ~0.5–0.75s; text 1 frame | prop=slide/swing, text=pop | Paper up-beat lands on "kicked out"; text present from line start | Music bed only in window | White handwritten-marker script, no box, small tick toward speaker; sentence case + exclamation | Speaker sweat-drop + mouth cycle active; second character, table, map prop static | `e06-entrance-bubble.png` (14.0) |

### Camera behaviors during held scenes (2)

| # | Time | Narration beat | Behavior | Magnitude + easing | Frames |
|---|---|---|---|---|---|
| E07 | 76–83.7 | "southern tip of the Malay Peninsula… control trade between the Indian Ocean and the South China Sea" | ONE long continuous ZOOM-OUT (~5s) from island-scale to region-scale on a full-screen stylized map; then camera holds while elements animate (route draw-on, ships) | Smooth exponential-feel zoom, no steps, no spring; scale ~2× every ~1.5s early, easing off at the wide end | `e07-camera1-maphold.png` (76.0), `micro-pindrop-75.6-77.2.png` |
| E08 | 437.3–441.7 | "Let's review Singapore's situation in 1965. No natural resources, no oil…" | Slow PUSH-IN on an opened book page (~10%/s for ~2s), then dead-still hold while the page content types on | Linear push, imperceptible ease-out into hold | `e08-camera2-review.png` (434.0) |

Also observed (logged under other events): slow push-in during the officer boast (E05); slow push-in on LKY-at-podium from behind (E13, ~2.5%/s); slight zoom-out during the crown-jewel light-up (E02). Camera never moves fast; every observed camera move is a single-direction crawl ≤10%/s across the hold. Whip/shake not observed in sampled windows (one blurred pose-frame at 0:34 was element blur, not camera).

### Chart/diagram appearance (1)

| # | Time | Narration beat | Behavior | Frames |
|---|---|---|---|---|
| E09 | 65.25–66.75 | "Plus, look at this location. Right between India and China." | Chart-as-PROP: a scroll map (SE Asia + red X on Singapore) is SWUNG up into the character's hand fully rendered — motion-blurred mid-swing at 65.25, settled by 65.75, held ~1.25s, swung out at 66.75. No draw-on, no growing bars — static artwork, animated arrival. | `e09-chart-map.png` (62.0) |

Contrast — the FULL-SCREEN map scene (E07 window) does the opposite: pin DROPS in (2-frame fall with smear, snap landing + tiny settle at 76.2–76.3), labels FADE/TYPE on as zoom reveals them ("INDIAN OCEAN"/"SOUTH CHINA SEA" type on letter-by-letter ~10 chars/s at 79.3–80.7), red dashed trade route DRAWS ON left→right ~40% fw/s (81.0–82.3), then ship icons pop on and crawl along the route ~2–3% fw per 0.33s (83.0+). The population pictogram (E02 window, 102.0–103.5) grows by POPPING one figure per ~0.25s, left→right, row by row, caption typing simultaneously. So: diegetic charts = static props; full-screen diagrams = draw-on/type-on/pop-per-unit.

### Emphasis beat (1)

| # | Time | Narration beat | What sells it | Frames |
|---|---|---|---|---|
| E10 | 8.5–9.75 | "The average person there is wealthier than the average **American**" | Split-screen comparison: US-flag panel WIPES in right→left covering ~50% fw in ~0.75s (~65% fw/s), fast-in with decel landing; American character then slides UP from the panel bottom (~0.5s). SG side keeps its idle loop (money bills tossed, falling ~5–10% frame-height per 0.25s) the whole time. Panel lands as "average American" is spoken. | `e10-emphasis-flags.png` (6.0) |

SFX: vertical burst at ~8.3 + noise wash/riser into the next cut (~10.1–10.5) in `sfx-us-wipe.png` — wipe carries a whoosh; the following hard cut carries an impact accent.

### Scene-to-scene transition idiom (1)

| # | Time | Narration beat | Device | Frames |
|---|---|---|---|---|
| E11 | 256–261.75 | ad end → "Now, where were we? During the Japanese occupation…" | HARD CUT out of the sponsor endcard (which idles with a ±5% breathing pulse on the starburst) → white-void narrator as a 2s palate-cleanser seam → HARD CUT into the story scene (marching soldiers, bob-cycle ~2–3% frame-height per 0.25s). No fade even at the sponsor boundary. | `e11-transition-adreturn.png` (256.0) |

Non-cut devices found in range (all still bounded by hard cuts): (a) typed WHITE TEXT-CARD interstitial — "But here's where things get complicated." types on at ~20 chars/s, holds ~1s, cuts (E03, 317.0–319.0); (b) BLACK chapter card with white script title (434.0, "The Island With No Resources… and All the Problems"); (c) match-style handoff where the held PROP map fills frame and becomes the live full-screen map (75.6–75.9, scroll border slides out of frame during the zoom).

### Held-set evolution (1)

| # | Time | Narration beat | Behavior | Frames |
|---|---|---|---|---|
| E12 | 0.0–6.3 | "Singapore went from a tiny island with zero resources to one of the **richest countries on Earth**" | THE SET IS HELD AND ELEMENTS ARE ADDED LIVE — no cut to a changed state. Night island (2 palms) holds ~2.3s with only idle water lines; sky/lighting crossfades to day (~2.3–4.0); bg skyline silhouettes FADE in (~0.3s); then landmark props POP in fully formed, one every ~0.3–0.4s, each arriving within ≤0.1s (verified at 10fps: MBS+supertrees 4.2→4.3, Flyer wheel 4.5→4.6, ArtScience 4.8→4.9, bg tower 5.1, Merlion 5.6→5.7). No grow, no overshoot — snap pops on the held camera. Build lands across "richest countries on Earth." Hard cut out at 6.7. | `e12-heldset-island.png` (0.0), `micro-island-4.0-6.0.png` (4.0) |

SFX: bright pop/hit transients above the VO band at ~4.0–4.4, ~5.3–5.5, ~6.1 in `sfx-island-pops.png` — the pops are scored. Same live-add grammar recurs at the crisis meeting (14.75–34: one held boardroom, speech bubbles + props swap per VO line, characters never re-blocked) and the crown-jewel scene (104–105.25: neighbors fade in around the held hero ball).

### Free pick (1)

| # | Time | Narration beat | Why it's distinctive | Frames |
|---|---|---|---|---|
| E13 | 419–424.75 | "went on television and **cried actual tears**" | The register-drop beat. Behind-the-podium shot with the ONLY slow push-in in the sequence (~2.5%/s, 2s+); hard cut to front; speech bubble GROWS in with motion blur (~15%→100% in ~0.25–0.5s, decel, no overshoot); then tears animate as a PROGRESSIVE REVEAL — a drop appears at 422.5, enlarges frame-by-frame into streams over ~2.5s while everything else holds; final cut to the wide symmetric flag shot with heavier tears. Audio goes SOFT: the sparsest spectrogram of all 9 windows (`sfx-bubble-cry.png`), no comedy SFX, thin somber notes. Comedy motion vocabulary is withheld, not replaced. | `e13-free-crying.png` (419.0) |

## Per-chunk rollup (0–484s)

- **Median hold length:** 5.0s (85 detected cuts at scdet score ≥8 in range; mean 5.6s; max hold 17s; 8 holds >10s). Dialogue scenes re-cut faster (2–4s between closeups); diagram/map scenes hold longest.
- **% of sampled holds with camera motion:** ~38% (5 of 13 windows: E02, E05, E07, E08, E13) — always a single-direction crawl (push-in ~2.5–10%/s or one long zoom-out), never a shake/whip in sampled windows.
- **% of sampled holds with element motion:** 100%. Nothing is ever a freeze-frame: minimum idle = talk-cycle (mouth pose swap every 0.25s + blinks + sweat-drop), water lines, bubble-tail wiggle, falling money, marching bob, starburst breathing pulse.
- **Entrance-vocabulary counts (across the 13 windows):** pop/snap ×8 (island landmarks ×5-plus, bubble text, pictogram figures, sparkles, ship icons) · swing/slide-with-motion-blur ×3 (newspaper, scroll map, cry-bubble grow) · linear glide ×2 (ship, US wipe panel) · grow ×2 (gun-in-bubble swell, cry bubble) · type-on ×4 (captions, white card, game panel, book page) · draw-on ×1 (trade route) · fade ×4 (bg silhouettes, map labels, neighbor balls, panel) · drop ×1 (map pin) · stamp ×1 (red X on book, 438.33, one-frame land + swoop SFX). Fastest arrivals are ≤0.1s (10fps-verified); prop swings ~0.5s; nothing eases longer than ~0.75s except camera crawls.
- **Transition inventory:** hard cut (universal, incl. sponsor boundaries) · typed white text-card interstitial · black chapter card · narrator-on-white-void as seam/aside · prop-map→fullscreen-map handoff. Zero fades/wipes/dissolves between scenes.
- **Chart/map behavior:** diegetic chart = static art on a swung-in prop; full-screen map = pin-drop + label type-on + dashed-route draw-on + crawling ship icons over one continuous zoom; quantity = one popped pictogram unit per beat; book-page stat list = types on in sync with the spoken litany, one item per VO item.
- **Type observations:** one dialogue/caption face — white handwritten-marker script with dark edge (dark charcoal on white cards), sentence case, no boxes (either floating with a tick-line or a classic white outlined bubble). Diegetic all-caps only on props (newspaper headline, map labels serif-ish caps, "1965" book). One deliberate contrast face: amber PIXEL font, all-caps, in the videogame stat-panel device. Text never animates per-word except type-on; lines swap atomically with the VO.
- **3 most re-usable motion mechanics (tied to beat type):**
  1. **Held-set live build** (transformation/montage beat): lock camera + set, snap-pop one fully-formed element every ~0.3–0.4s synced to the VO list, each pop scored with a small hit — dead frames never occur because an idle loop underlies the pops. (E12; also crisis meeting, pictogram.)
  2. **Prop-swing insert with motion blur** (evidence/exhibit beat): any chart, headline, or map arrives as a physical prop swung into the held character shot in ~0.5s with real smear frames, decel into a ~1–2s hold, then swings out — sells materiality without cutting away. (E06, E09.)
  3. **Split-screen wipe-in comparison** (stat/comparison emphasis): keep the subject's idle loop running, wipe a second panel in at ~65% fw/s with a whoosh so the comparator lands exactly on the spoken comparative word, then let a character rise up inside the panel as a second beat. (E10.)

## AUDIO ROLLUP (full 968s track — part-1 agent deliverable)

**Music.**
- Present effectively wall-to-wall: only ONE detected silence in 968s (0.64s at 16:07, the very tail). Full-track spectrogram shows a continuous bed under all VO.
- Level: barely-there-to-moderate and remarkably FLAT — mean −17.9 LUFS with a loudness range of just 3.4 LU; per-window RMS varies only ~1 dB across the entire video (hyper-compressed mix). Music never competes with the VO.
- Structure: it does NOT drop out at chapter boundaries; instead it **thins at register changes** — measurably sparser under the narrator-on-white asides (near-dry band right after the 37.75 cut) and at the LKY crying sequence (the quietest, most tonal window sampled: thin somber notes, no percussion, no comedy SFX). The 6:33–7:00 expulsion→tears stretch sits at the low end of the track's (tiny) level range. The videogame device (319+) brings a chiptune-flavored cue (harmonic blip stacks). Mood per act, as far as spectrogram texture supports: bouncy/percussive under farce and montage beats, sting-and-sparkle accents on reveals, sustained soft tones on the gravity beat — no hard genre flips detected at the three chapter marks; silence is NOT used as a device anywhere in the track.
- Sponsor segment (178–258): same continuous-bed approach; endcard adds no special music event; exit is a hard cut with no audio punctuation beyond the bed change.

**SFX.**
- Inventory identified in the 9 sampled event windows (spectrogram-verified transients): **pop/hit** (island landmark pops ~4.0–6.2; game-panel blips 319.1/319.7), **chime/sting** (ship reveal 51.8/52.5; crown-jewel sparkle 104.5+), **whoosh** (US-panel wipe ~8.3–9.3; map swing-up 65.1–65.4 ending in a slap/impact), **thunk/pop with settle** (map pin landing 76.2), **riser** (into the flag→newspaper cut 10.1–10.5; map zoom-out 76.7–76.9), **cartoon swoop/slide-whistle family** (double U-shaped pitch glides on the red-X stamp 438.3–438.9), and one VO-mouth snort in-track (13:23, caption-tagged). No record-scratch, no ambient beds detected in sampled windows.
- Density: in motion-dense story windows, ~1 scored transient every 1.5–2s (≈4–8 SFX/min extrapolated — estimate from 9 windows totaling ~19s, not a full-track count).
- What gets SFX vs stays silent: **element arrivals get scored** (pops, prop swings, stamps, wipes, pin drops — nearly every entrance in the samples had a transient); **camera crawls, talk-cycles, and idle loops are always silent**; the humanity beat (crying) is deliberately unscored.
- SFX without motion: not observed in the sampled windows — every detected transient co-occurred with an on-screen arrival/change (closest exception: the riser leading INTO a hard cut, which precedes the visible change by ~0.3s as an anticipation cue).

**Evidence files:** `frames/crayon--singapore--part1/audio-spec-full.png`, `audio-wave-full.png`, `rms-per-sec.txt`, `sfx-*.png` (9 windows), `sfxsheet-{1,2,3}.png`.
