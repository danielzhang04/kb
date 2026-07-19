# Motion teardown — Crayon Capital, "Palantir Technologies Explained Like You're 5" (part 2 of 2)

- **Video:** Crayon Capital — "Palantir Technologies Explained Like You're 5" (BASE channel, franchise/EXPLAINER format — data feeds the explainer-vs-story motion-delta question)
- **Source:** local file `GSkySDNmjV8.mp4` (918.15s, 854×480, 30fps)
- **Range covered:** 459.0s–918.15s (second half, 00:07:39–15:18)
- **Part:** 2 of 2 · **Date:** 2026-07-08 · **AUDIO_ROLLUP:** not assigned (part-1 agent covers it; per-event SFX filled from spectrogram/loudness evidence where checked)
- **Method note:** the claude-video-vision MCP tools were not loadable in this session (same failure the Singapore part-1 agent hit). All data below is direct ffmpeg extraction from the local file: scdet scene detection (threshold 8), silencedetect + per-second RMS, timestamped frame bursts (1.5–10 fps), per-event spectrograms. Transcript = YouTube auto-captions (deduped; timing good to ~±1s, no word-level precision). Frame evidence in `frames/crayon-capital--palantir--part2/` (contact sheets stamped with window-relative time; per-frame JPGs in same-named subfolders; `sfx-*.png` spectrograms).

## Cut statistics (MEASURED, 459.0–918.15s)

| Metric | Value |
|---|---|
| Cuts detected (scdet ≥8) | 115 |
| Holds | 116 · median **3.33s** · mean 3.96s |
| p25 / p75 | 2.49s / 4.68s |
| min / max | 0.23s / 15.75s (max = outro tail 902.4→end) |
| Holds >8s | 7 (490.1→503.1 · 539.8→551.3 · 656.8→665.8 · 706.4→716.6 · 845.5→856.5 · 902.4→end · 561.8→569.8 boundary-adjacent) |
| Known scdet misses | ≥3 verified in frames: ~849.6 (constellation→risk dashboard, dark→dark), ~855.0 (dashboard→Foundry logo card), ~659.0 (NYSE within-set reframe). True cut count is higher; true median slightly lower. |

Full cut-timestamp list in the appendix table.

## Events (13)

Timestamps absolute. Sheet tile stamps are relative to each window's start (given per event). "% fw" = percent of frame width.

### Hard cuts (3)

| # | Time | Narration beat | What changes across the cut | Cut energy | SFX | Frames (window start) |
|---|---|---|---|---|---|---|
| E01 | 503.13 | "…and it was just **getting warmed up**." → [act boundary] | Full war-room set (soldier at laptop, suit+general handshake, crystal-ball hologram) → PURE BLACK for ~0.1–0.2s → white-script chapter title "Going Corporate: Surveillance for Hire" POPS fully formed 503.2→503.3 (≤0.1s, 10fps-verified), dead-still hold ~2.3s, hard cut out at 505.5. | Max (scene→black flip; VO stops) | Mix drops with the cut; low-band drone/riser swells under the card 503.3–505.4, music re-enters at the cut out (`sfx-chapter1-card.png`, MED — title sting subtle if present) | `e01-cut-chapter1-sheet.png` (502.0), `micro-e01-chaptertype.png` (502.9) |
| E02 | 656.83 | typed card "And now, it was finally time to go public." → NYSE floor | Black typed text-card (white marker script, still typing at 655.8: "…to go pub"→"public." across ~0.25s) → trading floor: PLTR ticker boards, two suited characters + gray silhouette extras. All idle life = talk-cycle mouth swaps every ~0.25s, blinks, head tilts. Within-set reframe cut at ~659.0 (missed by scdet) as "Wait," pops above a pointing character. | High (black→lit set) | unchecked (`sfx-ipo-card-cut.png` extracted, not analyzed in depth); captions tag [music] at 659.9 | `e02-cut-ipo-sheet.png` (655.8) |
| E03 | 736.30 | "They were the military's **mind**. In 2022, when Russia invaded Ukraine…" | Dark command-room (glowing BRAIN on main screen wired to two analyst heads, BOMB DATA monitors; brain glow pulses as idle) → daylight battlefield: tank crawling, twin smoke plumes drifting, soldier group right. One-frame orange muzzle-flash burst pops at 736.8 and again on a rifle at 738.3 (each visible ≤0.25s). Second hard cut 737.83 to soldier closeup — action beats re-cut every ~1.5s. | High (dark interior→light exterior) | unchecked; caption tags [music] at 742.7 | `e03-cut-ukraine-sheet.png` (735.3) |

Pattern: high-energy cuts flip background value (dark↔light), same as part-1/Singapore. Every scene seam sampled is a hard cut — zero fades/wipes/dissolves.

### Element entrances (3)

| # | Time | Narration beat | Mover | Direction+magnitude | Easing | Duration | Entrance style | On word? | SFX | Text treatment | Idle vs active | Frames |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E04 (text) | 750.9–751.6 | "They branded it **AI for war fighting**." | Element (newspaper carrying the headline) | New paper lands atop a pile mid-frame, spinning/scaling in from small-rotated to full flat in ~2 frames @3fps (≤0.7s); ~35% fw final size | Fast-in, snap settle (classic newspaper-spin arrival) | ~0.7s | prop-lands-with-text (headline never animates independently) | Lands as the brand name is spoken | RMS dip at 752s = a beat of near-silence right after the settle, before the "Cool name, terrifying product" punchline (MED) | Serif ALL-CAPS headline, red for "AI FOR WARFIGHTING", black subhead, on white paper prop | Pile beneath static; before the cut, the Ukraine-map scene blinks blue arrows + X marks on/off per ~0.3s | `e04-text-aiwar-sheet.png` (748.6) |
| E05 (prop) | 572.5–573.1 | "Now I make them with this **magic rectangle**." | Element (FOUNDRY tablet) | Slides/swings up from off-frame lower-right into the character's hand; ~25% fw travel in ~0.5s | Fast-in, decel into hold; then a presentational WAGGLE (±5–10° tilt per 0.25s frame) through "magic rectangle" | ~0.5s in; waggle ~1.5s | slide | Arrives on "Now I make them", waggles on "magic rectangle" | unchecked (`sfx-tablet.png` extracted) | Caption above: white marker script, sentence case, swaps atomically per VO line; tablet label "FOUNDRY" + tiny green chart | Talk-cycle + blinks; dashboard monitors behind RE-COLOR their charts subtly between frames (screen idle) | `e05-prop-rectangle-sheet.png` (571.5) |
| E06 (character) | 539.8–541.7 | "…enter the pivot. Palantir launched a new product, **Foundry**." | Element (presenter character) + set | Hard cut to dark stage w/ curtains+spotlight; silver-haired bespectacled presenter peeks then walks out from behind the curtain (~1s, ~15% fw); presentation screen WIPES OPEN horizontally from a center slit to full width (~60% fw) in ~0.7s revealing a complete "PALANTIR FOUNDRY" architecture diagram (no draw-on — arrives whole) | Walk = even-paced; screen wipe = linear expand, snap stop | walk ~1s; wipe ~0.7s | walk-in + wipe-open | Screen opens across "newest product, Foundry" | unchecked | Speech bubble (classic white outlined bubble) TYPES ON ~15–20 chars/s: "Introduci…"→full line; bubble pops OFF atomically at 543.3 | Presenter talk-cycle + pointing-arm pose changes; diagram static once revealed | `e06-char-foundry-sheet.png` (539.0) |

### Camera behaviors during held scenes (2)

| # | Time | Narration beat | Behavior | Magnitude + easing | Frames |
|---|---|---|---|---|---|
| E07 | 716.6–723.6 | "Need to track tanks in Ukraine and simulate war outcomes in real time? **Ask Gotham.**" | CAMERA DEAD STATIC for the full ~7s hold on a full-frame tracking map. ALL life is element motion: Ukraine fill+red zone flip on at ~717.1; tank icons pop on in waves; sidebar counter ticks 13→46→78→111→143→176→208→230 (one step per ~0.5s, ~+32/step); dashed targeting rings pop around tanks ~720.6+; "GOTHAM" logo pops last ~722.1 as the answer to the spoken question | No camera motion at all (0%/s) | `e07-cam-gotham-sheet.png` (716.6), `sfx-gotham-counter.png` |
| E08 | 845.6–849.6 | "they called it **meta-constellation** because Skynet was taken" | The range's ONE clear camera move: slow PUSH-IN on a night-sky constellation (brain node + orbiting partner-logo nodes, dashed links, telescope crowd below): node field scales up ~25–30% over ~3.3s (~6–8%/s), ground silhouettes exit the bottom, "META-CONSTELLATION" label fades in mid-push, satellite icon pops top-right | Smooth continuous crawl, no spring, no steps; ends in a (scdet-missed) hard cut at ~849.6 to the risk dashboard | `probe-cam-metaconstellation-sheet.png` (845.6) |

Camera finding for the whole range: 2 of 14 sampled windows show camera motion (this push-in + E12's ~6s zoom-out) ≈ **~15% of sampled holds, vs ~38% in the Singapore story video** — in explainer mode the camera is close to nailed down; life comes from element pops, counters and type-on instead.

### Chart/diagram appearance (1)

| # | Time | Narration beat | Behavior | Frames |
|---|---|---|---|---|
| E09 | 676.7–681.0 | "Palantir was unprofitable. Growth was slow. **Margins were weird.**" | Metaphor-first, then chart: red declining line chart behind a worried investor (static art) → cut 676.73 to a suit WATERING a sapling in a "PALANTIR" pot — the plant visibly WILTS frame-to-frame over ~1s ("growth was slow" as literal droop) → a second panel WIPES IN from the right (~50% fw in ~0.3s) containing a "MARGIN" chart whose line DRAWS ON erratically (short squiggle → longer → a second crossing line) over ~1.5s, wiggle synced to "weird" → cut 680.77 to angry-investor crowd (fist-shake pose swaps per frame, "LIMITED ACCESS" sign, money bags). | `e09-chart-ipo-numbers-sheet.png` (676.0) |

Corroborating chart grammar in-range: the Gotham map (E07) = pop-per-unit + stepping counter; the GLOBAL RISK OVERVIEW dashboard (849.6–854.9, inside the E08 probe window) builds map-outline → filled map → one labeled sidebar item POPPING per spoken list item ("economic collapse / disease outbreaks / civil unrest" = ECONOMIC RISK / HEALTH CRISIS / SOCIAL UNREST); the Foundry directive UI (E13) TYPES its rows live. Charts are never static wallpaper — they build in sync with the VO's enumeration.

### Emphasis beat (1)

| # | Time | Narration beat | What sells it | Frames |
|---|---|---|---|---|
| E10 | 883.0–890.5 | "It was never just about software. It was about **power**." | Held dark set: one small cardboard box on a table. Green padlocked crates stamped "SECRET" RAIN IN physically — one drop per ~0.5s, каждая falling with mid-air tumble/rotation (~30° between frames), stacking into a pyramid over ~5s while the small box sits ignored. Then the reveal: a golden LIGHT BEAM bursts from the small box (~889.0) and a glowing script word "POWER" pops/floats above it at ~889.5 — landing on/just after the spoken word — and holds, pulsing, to the cut. Contrast structure: 10 heavy scored arrivals build pressure; the payoff is light + one word. | `e08-cam-incharge-sheet.png` (883.0), `sfx-power-reveal.png` |

SFX (HIGH confidence): crate-drop thud transients every ~0.5–0.7s under the VO across 883–888; bright burst at ~889.4 then a sustained harmonic shimmer/pad under the glowing POWER hold — the reveal is scored with glow, not a hit.

### Scene-to-scene transition idiom (1)

| # | Time | Narration beat | Device | Frames |
|---|---|---|---|---|
| E11 | 703.0–711.0 | "…and they wanted a piece." → [act boundary] → "By the 2020s, Palantir wasn't just a company. It was **infrastructure**." | Same idiom as E01, then a build: black chapter card "Empire, Ethics, and the Endgame" (white marker script, holds ~3.4s, hard cut both sides) → night isometric cityscape wide with "2020" label; building windows FLICKER as idle → "PALANTIR" boxed label POPS on the hero tower at ~708.3 while "2020" fades out → glowing data TENDRILS grow outward from the tower through the streets (draw-on spread ~10–15% fw over ~1.25s) landing under "infrastructure". No fade at any seam. | `e11-trans-chapter2-sheet.png` (705.5) |

Non-cut devices found in range (all still bounded by hard cuts): (a) black chapter card with popped script title (×2 — both act boundaries, E01 + E11); (b) typed white-script text-card interstitial (×2 — 655.0 "…time to go public.", 602.4 "During CO[VID-19]…", typing ~20–30 chars/s); (c) wiped-in split panel (E09, E10-adjacent); (d) screen-wipe-open reveal (E06). RMS confirms the cards are also AUDIO seams: 706s and 502s are among the quietest seconds of the whole range.

### Held-set evolution (1)

| # | Time | Narration beat | Behavior | Frames |
|---|---|---|---|---|
| E12 | 490.1–503.1 | "Palantir was no longer just a counterterrorism company… a **surveillance platform**, a **battlefield algorithm**, a **state-sponsored crystal ball**" | THE SET IS HELD AND GROWS LIVE for 13s (longest content hold in range), two mechanisms chained: (1) camera starts tight on a CRT dashboard and ZOOMS OUT continuously ~6s while the UI POPULATES item-by-item (1→6 photo thumbnails, red flags spreading, network graph filling, waveform drawing, a moving cursor arrow, a "Something New" button appearing) — the interface literally accretes scope as the camera reveals context; (2) at ~495.5 vertical PANELS SLIDE IN one per spoken list item, building a live TRIPTYCH (dark control room / desert soldier+laptop / suit-general handshake over a crystal ball) with no cut — each identity gets a panel as it's named. Triptych then holds ~7s on idle loops only: crystal ball pulses bright/dim on a ~1.3s cycle, soldier head-turns, laptop map redraws. Hard cut out = E01's chapter card. | `e12-heldset-survey-sheet.png` (490.0), `sfx-triptych.png` |

Direct evidence for the delta-chain/layer-move question: the channel MOVES/adds elements on the held set (panel slide-ins, UI item pops) rather than cutting to changed states — same verdict as part-1's island build, here sustained for 13s. SFX: wideband whoosh-ish transients align with each panel arrival (~494.5, ~496.7, ~498.6; MED-HIGH).

### Free pick (1)

| # | Time | Narration beat | Why it's distinctive | Frames |
|---|---|---|---|---|
| E13 | 596.0–603.0 | "Shut down Plant 3. Re-route shipments. Increase stockpile in region 7." — "But what if we—" — "**I said Plant 3.**" | The range's tightest motion-comedy machine, built entirely from UI text + reaction cuts: cut 596.4 to a FULL-SCREEN Foundry UI (dark navy, script-face directive rows in light-blue boxes) where the third directive TYPES ON LIVE with a visible cursor ("Incre_" mid-word at 596.8), one row per spoken command; cut 598.7 to a 3-face reaction closeup (screen-glow rim light; "But what if we-" pops above a head; expressions re-pose EVERY frame at 2.5fps — blink/mouth/eyebrow swaps); cut 600.8 back to the wide where the wall screen SNAP-SWAPS its whole list for one line: "I SAID PLANT 3." (atomic replace, no animation — the stillness IS the joke); cut 602.3 to a typed interstitial. Cut cadence ~2.1s, every cut on a dialogue turn. | `e13-free-commands-sheet.png` (596.0), `sfx-commands.png` (extracted) |

**Bonus observation (not counted in quota):** 774.4–777.5 ("one critic nicknamed it *the Oracle of Orwell*") — held CRITIC-at-desk scene, camera static, the quote pops above the character as a floating white-script caption WITH quotation marks exactly as the nickname is spoken; only idle life otherwise (mouth/eyebrow cycle, desk clutter static). Caption tags [music] at 774 — likely a sting (LOW, unverified).

## Per-chunk rollup (459–918s)

- **Median hold: 3.33s measured** (115 scdet cuts; true median a bit lower given ≥3 verified missed cuts). Faster than the Singapore story-video part-1 (5.0s). Dialogue/gag scenes re-cut ~2s; diagram/UI scenes carry the >8s holds — the explainer holds LONGER on full-screen interfaces/diagrams and SHORTER on story beats.
- **% sampled holds with camera motion: ~15%** (2 of 14: constellation push-in ~6–8%/s scale, CRT zoom-out ~6s continuous). Every other window dead-static camera. No whip, no shake, no pan anywhere sampled. (Story-video part-1: ~38%.)
- **% with element motion: 100%.** Minimum idle = talk-cycle (mouth swap ~0.25s) + blinks; environments idle too: city windows flicker, dashboard charts re-color, crystal ball pulses (~1.3s cycle), smoke drifts, brain glow breathes.
- **Entrance-vocabulary counts (14 windows):** pop/snap ×12+ (chapter title, PALANTIR label, GOTHAM logo, tank icons, targeting rings, dashboard sidebar items, POWER text, quote caption, speech texts, map arrows/X blink, muzzle flashes) · type-on ×5 (2 interstitial cards, Foundry directive rows, speech bubble, UI waveform/cursor build) · slide/swing ×3 (tablet up, triptych panels, newspaper spin-land) · physical drop w/ tumble ×1 class (SECRET crates, ~10 arrivals) · wipe-open/wipe-in ×2 (presentation screen, MARGIN split panel) · draw-on ×2 (MARGIN erratic line, city data tendrils) · counter tick-up ×1 (13→230 in ~32/0.5s steps) · fade ×2 (2020 label out, META-CONSTELLATION label in). Fastest arrivals ≤0.1s (10fps-verified); nothing eases longer than ~0.75s except the two camera crawls.
- **Transition inventory:** hard cut (universal) · black chapter card + popped white-script title + low drone, VO silent (~2.3–3.4s; BOTH act boundaries in range) · typed white-script text-card interstitial (×2) · panel wipe-in/split-build · screen-wipe-open reveal. Zero fades/dissolves at seams.
- **Chart/diagram behavior:** never static wallpaper — counters step up with scored ticks; units pop one per beat; dashboards add one labeled item per spoken list item; "weird" data = erratic line draw-on; full-screen UI mock is its own scene whose text types live; a metaphor prop (wilting plant) can replace the chart for a stat beat.
- **Type observations:** ONE white handwritten-marker script does captions, chapter titles, interstitials, quote pops, AND diegetic UI text (Foundry rows, dashboard labels, sidebar text) — the script face is the universal voice. Serif ALL-CAPS reserved for newspaper props; real-logo wordmarks (Palantir, FOUNDRY, GOTHAM) in their clean sans. Text never animates per-word except type-on; lines swap atomically with the VO.
- **3 most re-usable motion mechanics (tied to beat type):**
  1. **Counter + pop-per-unit diagram build** (scale/capability claim): hold a full-frame map/diagram with a DEAD camera, pop one icon per beat while a sidebar counter steps up (~2 steps/s) with tick transients, land the labeled logo/answer LAST on the spoken answer. (E07; risk dashboard.)
  2. **Additive panel build synced to a spoken enumeration** (list/identity beat): keep the set held and SLIDE IN one vertical panel (or pop one dashboard item) per named list item, then hold the finished composite on idle loops — the list becomes architecture instead of cuts. (E12 triptych; GLOBAL RISK sidebar; Foundry directive rows.)
  3. **Chapter-card seam: black card + popped script title + music drop to a low drone, VO silent ~2–3.5s** (act boundary): the only place the wall-to-wall pace fully exhales; both boundaries in range use it identically, and RMS confirms they're the quietest moments outside the outro. (E01, E11.)
  - (Runner-up: **physical-drop pile + glow reveal** for a climax emphasis — E10.)
- **Observed, NOT adoptable:** per-frame facial re-posing of multi-character reaction shots (E13's every-frame expression swaps are hand-animation density beyond our rig); physical tumble dynamics on the falling crates (real rotation arcs); the wilting-plant deformation (organic shape morph).

## Per-event SFX summary (rollup NOT assigned; checked fields only)

- **Checked (spectrogram):** E01 card = drone/riser swell, no VO (MED) · E07 = counter tick-train ~5–6/s + harmonic chime on the GOTHAM logo pop (HIGH) · E10 = crate thuds every ~0.5–0.7s + burst-then-shimmer pad under the POWER glow (HIGH) · E12 = whoosh-class transients on panel slide-ins (MED-HIGH) · E04 = near-silent beat at 752s right after the headline settles, pre-punchline (MED).
- **Unchecked:** E02, E03, E05, E06, E09, E11, E13 (spectrograms `sfx-ipo-card-cut/tablet/chapter3-city/commands/newspaper/constellation.png` extracted for the audio agent; auto-caption [music] tags cluster at 659.9, 711.99, 742.7, 774.2, 814.2, 851.8, 859.4, 897.9 — candidate stings/surges).
- Silence detector: only 2 true silences in range (639.4s, 907.7s, both ~0.4s) — the bed is effectively wall-to-wall, matching part-1.

## Honesty section

- **Tooling:** video-vision MCP tools unavailable this session → entire extraction via direct ffmpeg (documented in the method note). STEP-1 transcription = YouTube auto-captions, not a local ASR pass: word timings ±~1s, adequate for beat anchoring, NOT word-frame-exact; "lands on word" claims are therefore ±1 caption line.
- **Cut stats:** scdet ≥8 missed ≥3 frame-verified cuts (dark→dark and within-set reframes) — reported stats are a floor on cuts / ceiling on median.
- **Camera-behavior quota:** both pre-planned camera windows (E07, E10's set) turned out CAMERA-STATIC; one extra probe window (845.6s) found the range's only clear camera move, logged as E08. The static-hold finding is reported as data in E07, not hidden. No substitution needed — quota met with direct evidence for both.
- **Reassignments during extraction (all frame-driven):** the crates/POWER window planned as "camera" became the emphasis beat (E10); the Gotham map planned as "camera during held scene" doubles as the strongest counter evidence; the Oracle-of-Orwell window was extracted but demoted to a bonus observation (its motion content was a single caption pop). No quota category lacked a real event.
- **Frames:** ~246 extracted to disk (13 event bursts + 1 micro-burst + 1 probe), slightly over the ~150–200 guidance because two probe/micro passes were needed; only 16 composite sheets/stills were actually returned into context.
- **AUDIO_ROLLUP (STEP 5):** skipped per assignment (part-1 agent owns it). Per-event SFX fields filled only where spectrogram evidence exists; everything else marked unchecked rather than guessed.

## Appendix — raw cut timestamps (scdet ≥8, 459–918s)

| Cuts (s) |
|---|
| 459.93 · 463.67 · 465.70 · 468.67 · 473.97 · 477.37 · 481.73 · 484.20 · 485.13 · 486.10 · 487.00 · 490.07 · 503.13 · 505.50 · 509.37 · 512.43 · 515.70 · 518.53 · 521.13 · 524.40 · 529.80 · 533.63 · 539.80 · 551.33 · 557.10 · 561.80 · 565.27 · 569.77 · 575.57 · 581.33 · 584.50 · 586.97 · 593.60 · 596.40 · 598.70 · 600.83 · 602.33 · 604.80 · 607.20 · 609.87 · 611.93 · 613.77 · 617.60 · 619.50 · 623.50 · 630.00 · 639.50 · 642.30 · 646.57 · 649.77 · 653.80 · 656.83 · 665.80 · 672.70 · 676.73 · 680.77 · 685.27 · 689.13 · 696.07 · 698.97 · 703.00 · 706.40 · 716.63 · 723.60 · 728.83 · 731.83 · 733.77 · 736.30 · 737.83 · 740.27 · 742.70 · 744.57 · 749.60 · 753.57 · 756.73 · 760.47 · 763.30 · 766.43 · 769.00 · 773.17 · 777.80 · 780.63 · 783.83 · 786.80 · 790.30 · 793.53 · 797.43 · 802.43 · 802.70 · 803.23 · 803.70 · 805.30 · 807.80 · 808.03 · 812.60 · 813.73 · 815.50 · 818.00 · 822.27 · 825.13 · 827.87 · 832.67 · 835.80 · 840.87 · 845.53 · 856.50 · 861.57 · 863.97 · 867.77 · 872.00 · 876.43 · 883.10 · 890.77 · 896.60 · 902.40 |

Known missed cuts (frame-verified): ~659.0, ~849.6, ~855.0.
