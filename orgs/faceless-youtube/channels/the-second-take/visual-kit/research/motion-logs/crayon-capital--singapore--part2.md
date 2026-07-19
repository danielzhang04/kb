# Motion teardown — Crayon Capital, "The Man Who Built Singapore in One Generation" (part 2 of 2)

- **Video:** Crayon Capital — "The Man Who Built Singapore in One Generation" (BASE channel — vocabulary measured, not sampled)
- **URL:** https://www.youtube.com/watch?v=y51JjcymEAY (968s, 854×480 source, 30fps)
- **Range covered:** 484s–968s (00:08:04–00:16:08, second half)
- **Part:** 2 of 2 · **Date:** 2026-07-08 · **Audio rollup:** not assigned (part 1 covers it); per-event SFX filled from RMS timeline + 6 event spectrograms
- **Method note:** the video-vision MCP tools were unavailable in this session (same server failure part 1 hit), so the whole extraction ran on direct ffmpeg work against the pre-downloaded local file — mirroring part 1's fallback. Scene changes measured with ffmpeg `select(scene>0.20)` from 480s; loudness = RMS per 0.5s window; silence = `silencedetect -38dB/0.5s`. Transcript taken from the video-vision cache's stored caption timeline and **spot-verified against burst frames** (on-screen caption text matches the transcript at 524s, 900.2s, 942.2s — no offset). Frame evidence: `frames/crayon-capital--singapore--part2/` (stamped contact sheets, **absolute** video-time stamps; per-frame JPGs in same-named subfolders; `survey-484-968.jpg` = the 43-tile planning survey). Audio evidence: `sfx-*.png` spectrograms.

## Cut statistics (measured, 484–968s)

| metric | value |
|---|---|
| cut count (scene score >0.20, doubles merged) | **82** (≈1 cut / 5.9s) |
| median hold | **5.40s** |
| p25 / p75 | 3.73s / 7.18s |
| min / max | 0.83s (callback montage) / 17.11s (end-card outro) |
| holds >8s | **17** |
| detected silences ≥0.5s @ −38dB | 1 (967.0–968.0, the very end) |

Caveats: one double-detection at 624.37/624.40 merged. **Fade seams do not register in scene detection** — two real scene boundaries in this range are fades (≈876.4–877.3 and ≈927.5–928.6, see E11) and are NOT in the 82-cut list; true scene-boundary count is 84. Raw list in the appendix.

## Events (13)

Timestamps are absolute video time. "% fw" = percent of frame width; "% fh" = percent of frame height. Contact sheets live in `frames/crayon-capital--singapore--part2/`.

### Hard cuts (3)

| # | Time | Narration beat | What changes across the cut | Cut energy | SFX at cut | Frames |
|---|---|---|---|---|---|---|
| E01 | 753.93 | "It'll cost them dearly… / **But here's the thing** about all these policies. They worked." (ACT BOUNDARY: problems → results) | Bright sunset-ray map scene (Singapore crest, jet + soldier speech bubbles) → DARK chalkboard checklist set ("PROBLEMS: WATER/ECONOMY/HOUSING/EDUCATION/DEFENSE", 2 characters). Value flip bright→dark. First checkmark already ticked at the first post-cut frame; the rest tick on live (see E12 note). | High (value+palette flip) | Rising harp/arpeggio gliss right at the cut (`sfx-e01-theyworked.png` ~2.2–2.5s into window); music dips to −40dB RMS in the 0.5s BEFORE the cut (beat of silence, then cut) | `e01-cut-theyworked.png` (752.40–756.65) |
| E02 | 793.63 | "This meant strict laws, like really strict. **Chewing gum, banned**" | Colorful 2-panel split (gavel/scales + puzzle-people) → near-monochrome grey wall with red-on-white "NO NONSENSE / FAILURE TO COMPLY = $$$ FINE" sign, sign fully formed with the cut; a gum-chewing character then WALKS through frame l→r (~15–20% fw/s, pink gum bubble as the gag) | High (saturated → drained grey) | Pre-cut RMS dip to −33dB at 792.5 (gap), accent unclear under VO (unchecked beyond RMS) | `e02-cut-strictlaws.png` (792.60–796.35) |
| E03 | 907.73 (+909.67, 911.20) | "Yet, Singapore still faces challenges. **The country is aging** rapidly. Birth rates are low. Housing is expensive." | Black typed card → elderly riders on train bench (907.73) → EMPTY playground, swing swaying alone (909.67) → dark room, phone with red housing prices + giant eye (911.20). A LIST delivered as a cut-run: one scene per item, holds 1.94s/1.53s/1.83s — 3× faster than the median cut | Medium-high ×3 (black→bright→bright→dark alternation) | No isolated hits found in RMS (music bed continuous, −18 to −22dB); unchecked finer than that | `e03-cut-challenges.png` (906.90–911.65) |

Pattern (matches part 1): high-energy cuts flip background VALUE/palette; cuts land on the first word of the new sentence; enumerations become cut-runs when each item is a whole scene (vs pop-per-item when items are elements on a held set, E07/E12).

### Element entrances (3)

| # | Time | Beat | Mover | Direction + magnitude | Easing | Duration | Entrance style | On word? | SFX | Text treatment | Idle vs active | Frames |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E04 (text) | 900.73–903.0 | "**Not bad** for a country that was crying on TV in 1965." | Element (text only) | Typewriter on PURE BLACK: "Not"→ full 2-line sentence, ~12–13 chars/s, centered, wrapping live | Per-character snap (type-on) | ~2.2s to complete, then dead hold ~4.8s; text then SWAPS IN PLACE to "Yet, Singapore still faces challenges." (~904.5, no cut) | type-on | Type start lands on "Not bad" | RMS gap −31dB at 900.0–900.5 (breath before the button line), then bed resumes; per-char ticks not separable (unchecked) | White handwritten-marker script, sentence case, no box, centered | NOTHING else on frame — black void, zero idle; the dead-still hold IS the emphasis | `e04-text-cryingontv.png` (900.20–903.95) |
| E05 (prop) | 493.5–495.5 | "Problem number **one, water.**" (chapter card) | Element (paper prop + type) + camera | Corkboard "PROBLEMS" set held dark; camera pushes in (~5–8%/s); tap-icon paper LIGHTS + GROWS into place upper-left (small/dim → full size in ~0.5–0.75s) while "PROBLEM #1: WATER" types on beside it (~10–12 chars/s) | Grow with decel into hold, no overshoot at 4fps; type = per-char snap | Paper ~0.75s; type ~0.75s; hold ~1s; hard cut out at 495.53 | grow + type-on | Paper lands on "one", "WATER" completes on "water" | Low-mid pop/whoosh at ~493.6–493.7 + faint tick cluster during type-on (`sfx-e05-card.png` ~1.6–2.2s), MED confidence | White marker caps for the label ("PROBLEM #1: WATER"), no box, on the paper prop | Rest of corkboard stays dark/idle (spotlight vignette); only the new paper + type active | `e05-prop-problemcard.png` (492.50–496.25) |
| E06 (character) | 734.6–738.3 | "Singapore introduced **mandatory military service.**" | Element (costume pieces + background) on a held character | Cut (734.57) to civilian alone on green void. Helmet DROPS from above (~0.25–0.5s fall, motion smear at 735.50, seated by 735.75); uniform swaps on in ~2 stages (grey 736.25 → green w/ flag patch 736.75); then the barracks + other soldiers CROSS-FADE IN around him (ghost overlay 737.25–737.75, solid by 738.0) | Helmet: fast fall, snap landing; uniform: stage pops; background: ~0.75–1.0s linear fade | ~3.5s total transformation | drop-in + pop-swap + context fade-in | Helmet lands ≈ "mandatory" | TRUE audio hole −46dB at 734.5 (silence beat at the cut); low-mid thunk at helmet (~735.5); rising harmonic ladder (arpeggio) as barracks fade in (`sfx-e06-soldier.png` ~2.0s, ~3.9s), MED | — | Character holds center, eyes/mouth only; everything enters ON or AROUND him | `e06-entrance-soldier.png` (734.00–738.25) |

Note on E06: no clean walk-on character entrance occurred in the sampled windows — characters overwhelmingly arrive WITH the cut. The channel's "character entrance" is really *assembly in place* (props/costume land on a held character) — same grammar as prop entrances.

### Camera behaviors during held scenes (2)

| # | Time | Beat | Behavior | Magnitude + easing | Frames |
|---|---|---|---|---|---|
| E07 | 566.8–577.8 (sampled 568–574.5) | "zero corruption, efficient government, low taxes, rule of law… invite every foreign company to set up shop here" | Camera DEAD STATIC for the whole 11s enumeration hold. All motion is element motion: thought bubbles POP in one per spoken item (no-corruption 568 → gears 568.5 → tax-doc 569.5 → scales 570.5–571 → globe grows from chest 572–573 → shop pops INSIDE the globe bubble 573.5), each bubble small→full in ~0.5s with slight overshoot; caption swaps per VO line; talk-cycle runs | Bubbles ~2 frames grow, spring-ish settle; camera 0%/s | `e07-camera-businesshold.png` (568.00–574.50) |
| E08 | 918.6–927.5 | "what happens to Singapore's unique model as the founding generation passes away?" | ONE continuous ~9s PULL-BACK/pan from a close-up of the empty parliament chair + "LEE KUAN YEW" nameplate, steadily widening to reveal rows of worried MPs who pop in with speech bubbles ("What are we gonna do?" 922.1 → text swaps in place to "What will happen to us?" 924.8); ends wide, bubbles gone, then FADES to the grey 1965 flashback (see E11) | Slow single-direction crawl (~3–5% scale/s), no steps, no spring; element pop-ins ride the move | `e08-camera-emptychair.png` (918.80–929.47) |

With part 1: camera vocabulary in held scenes = static (most common) or one single-direction crawl ≤10%/s held for the whole beat; the only fast camera behavior found anywhere is the functional zoom-out inside the chart (E09).

### Chart/diagram appearance (1)

| # | Time | Beat | Behavior | Frames |
|---|---|---|---|---|
| E09 | 850.6–857.4 | "By the 1990s, Singapore's GDP per capita **exceeded Britain's**… Let that sink in." | Full chart choreography: cut from black typed card → sky scene with UK-ball already on its green bar; "1990s" handwrites on top (~850.9–851.2); SG-ball BOUNCES in from the right (airborne 850.87, lands on its bar 851.2); SG bar GROWS ~1.5–2s carrying the ball up and OUT of frame; camera ZOOMS OUT (~852.2–852.9) to re-contain it while the bar keeps growing; giant teal "GDP" handwrite-fades in BEHIND the bars (853.2), then "PER" (853.9) and "CAPITA" (854.5) type on; CUT at 855.3 to a ground-level reframe — UK ball tiny at its bar's base looking up, SG ball smug on the tower — held ~2s with eye-dart idle only ("Let that sink in" = dead-hold reaction two-shot) | `e09-chart-gdpbars.png` (850.20–857.20) |

SFX: a clear RISING slide-whistle/riser glissando arcs up exactly under the bar growth (`sfx-e09-chart.png`, curved trace ~1.3–2.1s into the window = 851.3–852.1) — HIGH confidence, the cleanest motion-coupled SFX in the range. Chart grammar = grow the data mark live, let it break the frame, zoom out to chase it, label AFTERWARD, then cut to a character-scale reaction.

### Emphasis beat (1)

| # | Time | Beat | What sells it | Frames |
|---|---|---|---|---|
| E10 | 650.7–655.2 | "By the 1980s, **over 80%** of Singaporeans lived in public housing that they owned." | Hard cut (score 1.00) from the 3-panel CPF win-win-win montage → EMPTY night-navy card. "By the 1980s," typewrites (~651.0–651.7), clears, then the stat line types through "over 80% of Singaporeans lived in public housing that they owned." (~12 chars/s, finishing ON the spoken "owned") while a full HDB skyline RISES from the bottom edge under the words (~8–10% fh/s, continuous, ease-free crawl) — the number is sold by type-rhythm + a world literally building beneath it | `e10-emphasis-80pct.png` (650.20–654.95) |

Two-line white marker script, sentence case, centered upper-third; buildings colorful against navy. SFX: unchecked beyond RMS (bed continuous ~−19dB).

### Scene-to-scene transition idiom (1)

| # | Time | Beat | Device | Frames |
|---|---|---|---|---|
| E11 | 876.3–878.0 | "And in 2015, **Lee Kuan Yew died** at age 91." | **FADE-TO-BLACK → FADE-UP — the only non-cut transition found in either half.** Asian-tiger flag scene dims at 876.33, FULL BLACK at 876.67 (~0.4s out), memorial scene fades up 877.0–878.0 (~1.0s in): grey/monochrome framed portrait "MR LEE KUAN YEW" + flowers, with "2015" typing on mid-fade (877.33 "201" → 877.67 "2015"). Music drops to −48dB RMS at 876.5 — the quietest moment in the half except the end credits — silence and fade land together | `e11-transition-death.png` (874.00–879.00), `sfx-e11-death.png` (dark column ~2.9–3.5s) |

A SECOND fade exists at 927.5–928.6 (parliament → grey "1965: A NATION ALONE" newspaper flashback, caught inside E08's sheet, mid-fade black frame at 928.13). Both fades are mortality/time-passage coded, and both bracket monochrome scenes. Everywhere else in 484 sampled seconds: hard cuts only. The fade is a MEANING device, not a convenience — and scene detection misses it (neither fade is in the 82-cut list).

### Held-set evolution (1)

| # | Time | Beat | Behavior | Frames |
|---|---|---|---|---|
| E12 | 760.7–772.0 | "By the 1970s, foreign companies were flooding in. The port was expanding. New industries were sprouting." | 11.3s with ZERO cuts, the set evolving live: "1970s" label fades out (~761.9); building 1 RISES from behind the hill (flag-first, ~40–50% fh/s, big first step then ease-out, full in ~0.75–1.0s); building 2 staggered ~0.5s later; building 3 infills (~763.65); then the camera PANS LEFT (~25–30% fw/s for ~1.5s, 764.2–765.5) across the SAME set to reveal the dock as a container ship glides r→l and crane/warehouse enter; factory + smokestacks pop in right (~766.8–767.8); smoke-puff idle starts; a character walks in bottom (~770.8). Hard cut out at 771.97. Every "expanding/sprouting" noun = one element arriving on the held set | `e12-heldset-port-survey.png` (1fps overview), `e12-heldset-port-rise.png` (761.40–764.15 @4fps), `e12-heldset-port-ext.png` (764.20–765.45) |

Direct answer to the delta-chain vs layer-move question: **the channel MOVES/pops elements live on a held set — it does not cut to changed states.** Corroborating second instance in E01's sheet: the five checklist checkmarks draw on one-by-one (~1 per 0.5s, chalk-hand visibly travelling box to box, 753.9–756.4) on a held set, camera holding. Background sky bands also palette-shift gradually across E12's montage (orange → magenta) — slow ambient color change as a time-passing cue.

### Free pick (1)

| # | Time | Beat | The moment | Frames |
|---|---|---|---|---|
| E13 | 939.4–943.5 | "…sheer will, smart policies, and a leader who **refused to accept failure.** — That's impossible! — Stop saying things are impossible!" | The climax runs the video's FASTEST cutting as a CALLBACK MONTAGE: modern-Singapore postcard (idle) → cut 940.03 to the PROBLEMS corkboard, mirror-flipped, problem-papers RIPPING OFF and flying (1 paper per ~0.25s, ~30–40% fw travel/frame, motion-smeared) → cut 941.27 to the checklist board, all 5 boxes checked + "They worked!" bubble → cut 942.10 to the grey slum street where the advisor's bubble swaps in place "That's impossible!" → "Stop saying things are impossible!" as Lee walks in from the right edge. Holds: 1.24s / 0.83s / 3.27s — each shot is a re-dressed earlier SET carrying a dialogue mirror. Emotional payoff = editing rhythm + set reuse, not new artwork | `e13-freepick-rapidcuts.png` (939.40–943.40), `sfx-e13-rapid.png` (broadband rip/whoosh columns at each cut + paper, ~1.0–1.4s, 2.1s, 3.1s into window, MED-HIGH) |

## Per-chunk rollup (484–968s)

- **Median hold (measured):** 5.40s (p25 3.73 / p75 7.18; 17 holds >8s; extremes: 0.83s callback-montage vs 17.1s end card).
- **% of sampled held scenes with camera motion:** ~38% (5/13: E05 push-in, E08 pull-back, E09 chart zoom-out, E12 pan, E01-window slight ray-drift). All crawls except the chart's functional zoom-out; **static camera is the default** during enumeration/dialogue holds.
- **% with element motion:** 100% — every sampled hold has talk-cycles, pops, rises, swings, or idle wobble; no dead frames except the two DELIBERATE dead-holds (E04 black card, E09 "let that sink in"), where stillness itself is the emphasis device.
- **Entrance vocabulary counts (across 13 events):** type-on ×6 (chapter card, stat card, black-card button lines ×2, GDP labels, "2015" date) · pop/snap ×5+ (thought bubbles, speech bubbles, flags, checkmarks, factory) · grow/rise ×3 (chapter paper, HDB skyline, port buildings) · slide/walk ×3 (ship, gum-chewer, Lee) · drop-in ×1 (helmet) · bounce-in ×1 (SG ball) · fade-in ×2 (barracks context, memorial scene) · wipe ×0 in this half.
- **Transition inventory:** 82 hard cuts; **2 fade-through-blacks, both mortality/time-coded** (death beat + 1965 flashback) — the fade is reserved grammar; zero wipes/dissolves elsewhere; cut-runs (1.5–2s holds) used for spoken lists and the callback climax.
- **Charts/diagrams:** bars grow live with a riser gliss, camera zooms out to chase, balls ride the data, labels handwrite AFTER growth, then cut to character-scale reaction (E09); stat lines are typed cards with a scene rising underneath (E10); full-screen boards accumulate marks live (E01/E12 checkmarks).
- **Type observations:** ONE typeface everywhere — white handwritten-marker script, sentence case for narration/captions, CAPS for labels ("PROBLEM #1: WATER", "NO NONSENSE"); no boxes/outlines; typewriter ~10–13 chars/s synced to end on the spoken word; text swaps IN PLACE per VO line (bubbles and cards both); display-scale words (GDP) render huge, palette-matched, behind the scene.
- **3 most reusable motion mechanics** (beat type → mechanic):
  1. **Button lines / payoffs → cut-to-black typed card:** kill the whole scene, typewrite the line at VO pace on black, dead-hold, swap text in place for the follow-up (E04, E10, and the "third-world to first-world" card before E09). Cheap, devastating, fully Remotion-implementable.
  2. **Enumerations → one element per spoken item on a held set** (bubbles pop, buildings rise, checkmarks tick — camera static or one crawl), and when items are whole scenes, a 1.5–2s cut-run instead (E07/E12/E01 vs E03). Direct template for our progressive-reveal device.
  3. **Death/time-passage → fade + silence + monochrome:** the only fades in 968s land on the two mortality beats, paired with a music dropout and grey palettes (E11) — register-OFF grammar for human cost, matching our doctrine.

## Honesty section

- **Tool failure:** video-vision MCP tools never loaded in this session (ToolSearch returned nothing for them); per part 1's precedent the whole run used direct ffmpeg extraction on the local file. No `video_analyze`/`video_detail` calls were possible; equivalents were measured manually (scene filter, silencedetect, RMS windows, spectrograms).
- **Transcription:** reused the caption timeline stored in the video-vision cache for this exact video (verified same file size as the assigned copy) — validated against on-screen caption text in 3 burst windows (524s, 900.2s, 942.2s); no drift found (part 1's "~15s off" issue was the cache's frame labels, not the captions).
- **Substitution/bending:** E06 "character entrance" is a character *assembled in place* (helmet/uniform/context onto a held figure) — no walk-on character entrance existed in sampled windows; characters otherwise enter WITH the cut. E03 logs a 3-cut run as one hard-cut event.
- **AUDIO_ROLLUP skipped as assigned.** Per-event SFX: 6 windows spectrogram-checked (labeled MED/HIGH above); the rest report RMS-only evidence or "unchecked" — VO+music bed masks small SFX in pure RMS.
- **Known misses:** scene detection cannot see fades — the 82-cut stats exclude the 2 fade seams; the E12 pan/zoom mechanics between 764.2–765.5 were characterized from a 4fps burst (fast pan value approximate); no failed extractions — all 13 events have cited multi-frame bursts.
- **Frame budget:** ~240 returned tiles including the 43-tile planning survey — modestly over the ~150–200 guidance; all 480p-derived 320px tiles.

## Appendix — raw cut list (scene score >0.20, merged; hold = time to next cut or end)

| cut t (s) | score | hold (s) | cut t (s) | score | hold (s) | cut t (s) | score | hold (s) | cut t (s) | score | hold (s) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 486.00 | 0.67 | 3.73 | 618.90 | 0.83 | 5.47 | 739.80 | 0.54 | 3.83 | 862.77 | 0.57 | 2.43 |
| 489.73 | 0.43 | 5.80 | 624.37 | 0.63 | 4.53 | 743.63 | 1.00 | 4.10 | 865.20 | 0.55 | 4.77 |
| 495.53 | 0.68 | 3.77 | 628.90 | 0.46 | 5.33 | 747.73 | 0.25 | 6.20 | 869.97 | 0.54 | 12.13 |
| 499.30 | 0.22 | 1.93 | 634.23 | 0.31 | 3.94 | 753.93 | 0.59 | 5.24 | 882.10 | 0.79 | 3.77 |
| 501.23 | 0.46 | 9.50 | 638.17 | 0.95 | 12.53 | 759.17 | 0.74 | 1.50 | 885.87 | 0.56 | 3.73 |
| 510.73 | 0.20 | 3.74 | 650.70 | 1.00 | 12.70 | 760.67 | 1.00 | 11.30 | 889.60 | 0.66 | 11.13 |
| 514.47 | 0.63 | 8.33 | 663.40 | 0.80 | 7.50 | 771.97 | 0.64 | 5.66 | 900.73 | 1.00 | 7.00 |
| 522.80 | 0.67 | 5.87 | 670.90 | 0.27 | 2.90 | 777.63 | 0.81 | 3.57 | 907.73 | 1.00 | 1.94 |
| 528.67 | 0.46 | 1.60 | 673.80 | 0.71 | 3.70 | 781.20 | 0.70 | 12.43 | 909.67 | 0.76 | 1.53 |
| 530.27 | 0.79 | 4.96 | 677.50 | 0.24 | 2.00 | 793.63 | 0.90 | 9.24 | 911.20 | 0.94 | 1.83 |
| 535.23 | 1.00 | 4.97 | 679.50 | 0.79 | 5.57 | 802.87 | 1.00 | 4.53 | 913.03 | 0.84 | 5.60 |
| 540.20 | 0.33 | 11.27 | 685.07 | 0.67 | 5.56 | 807.40 | 0.96 | 5.47 | 918.63 | 0.62 | 11.87 |
| 551.47 | 0.71 | 2.46 | 690.63 | 0.67 | 6.64 | 812.87 | 0.58 | 9.53 | 930.50 | 0.41 | 3.93 |
| 553.93 | 0.22 | 5.84 | 697.27 | 0.53 | 5.86 | 822.40 | 0.75 | 6.33 | 934.43 | 0.45 | 5.60 |
| 559.77 | 0.75 | 7.00 | 703.13 | 0.82 | 2.47 | 828.73 | 0.57 | 2.07 | 940.03 | 0.50 | 1.24 |
| 566.77 | 0.54 | 11.06 | 705.60 | 0.47 | 1.73 | 830.80 | 0.78 | 7.90 | 941.27 | 0.41 | 0.83 |
| 577.83 | 0.49 | 9.97 | 707.33 | 0.57 | 9.60 | 838.70 | 0.81 | 4.80 | 942.10 | 0.48 | 3.27 |
| 587.80 | 0.43 | 12.77 | 716.93 | 0.51 | 2.50 | 843.50 | 0.78 | 7.10 | 945.37 | 1.00 | 5.53 |
| 600.57 | 0.60 | 7.13 | 719.43 | 0.66 | 7.20 | 850.60 | 1.00 | 4.70 | 950.90 | 0.90 | 17.11 |
| 607.70 | 0.64 | 6.47 | 726.63 | 0.58 | 7.94 | 855.30 | 0.53 | 3.97 | | | |
| 614.17 | 0.89 | 4.73 | 734.57 | 0.67 | 5.23 | 859.27 | 0.71 | 3.50 | | | |
