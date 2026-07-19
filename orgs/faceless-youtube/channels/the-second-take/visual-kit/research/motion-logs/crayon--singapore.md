# Motion+audio teardown — Crayon Capital, "The Man Who Built Singapore in One Generation" (MERGED)

- **Video:** Crayon Capital — "The Man Who Built Singapore in One Generation"
- **URL:** https://www.youtube.com/watch?v=y51JjcymEAY
- **Duration:** 968s (854×480 source, 30fps)
- **Merged from:** `crayon--singapore--part1.md` (0–484s) + `crayon--singapore--part2.md` (484–968s) · **Date:** 2026-07-08
- **Method:** all observations from direct ffmpeg burst extraction (3–10 fps) of the plugin's cached MP4 (`C:\Users\danie\.claude-video-vision\downloads\1f83919ef07c-y51JjcymEAY.mp4`), timestamps ground-truthed against the caption track. (The video-vision MCP tool's cache labels were ~15s off and were discarded; direct ffmpeg pulls have no offset.) Frame evidence: part 1 in `frames/crayon--singapore--part1/`, part 2 in `_frames/crayon-singapore-p2/`, spot-check in `frames/crayon--singapore--spotcheck/`.
- **Seam dedupe:** none needed — the last part-1 event ends at 441.7s and the first part-2 event starts at 493.2s; no two events within ~15s of the 484s seam describe the same moment. All 26 events kept.
- **Event IDs:** part-1 events prefixed `P1-`, part-2 events prefixed `P2-` (original numbering preserved).

## Events (26 = 13 + 13)

Timestamps are absolute video time. "% fw" = percent of frame width. The two halves were logged with slightly different table schemas; each is preserved intact below.

### Hard cuts (6)

**Part 1 (0–484s):**

| # | Time | Narration beat | What changes across the cut | Cut energy | SFX at cut | Frames (window start) |
|---|---|---|---|---|---|---|
| P1-E01 | 37.75 | "That's impossible. **So**, how did they pull this off?" | Dark-red cabinet meeting (full set, 3 characters, map prop) → flat WHITE VOID with a single new narrator character already in frame, mid-talk-cycle. Max value+palette contrast; no transition device. | High (dark→white flip) | Music bed **thins to near-dry** for the void aside (dark band ~37.7–38.5 in `sfx-cut-void.png`), resumes ~38.8 | `e01-cut1-void.png` (36.0) |
| P1-E02 | 103.75 | "…hundreds of thousands. / Singapore became one of Britain's **crown jewels**" | White pictogram diagram (population grid) → BLACK spotlight scene; crowned colonial-flag ball centered, neighbors fade in from black over ~1s, sparkle pops at 104.5/104.75, slight zoom-out 105.0+ | High (white→black flip) | Accent hit at cut; sparkle-register music | `e02-cut2-crownjewel.png` (102.0) |
| P1-E03 | 319.0 | "But here's where things get complicated. Singapore was **tiny**…" | White typed text-card → dark retro-videogame scene (googly-eyed countryball + character-select stat panel). Panel then builds via fade+type (see transitions). | High (white→dark flip) | Chiptune-style blips at 319.1 + 319.7 (`sfx-game-panel.png`) | `e03-cut3-complicated.png` (317.0) — **spot-checked PASS, see Spot-check** |

**Part 2 (484–968s):**

| # | t (s) | Narration context | What changes across the cut | Cut energy | Lands on word? | SFX (measured) | Frames cited (fps) |
|---|---|---|---|---|---|---|---|
| P2-E1 | 759.1±0.15 (12:39) | "…they worked. Really, really worked." → (pause) → "By the 1970s…" | Warm busy classroom (2 characters, blackboard checklist ECONOMY/HOUSING/EDUCATION/DEFENSE, speech bubble "They worked!") → pure black chapter card, white script "The Rapid Transformation: From Third World to First". Card holds static ~1.5s (759.25–760.75), then second hard cut into the 1970s sunset scene. | Maximum contrast: luminance (warm → black) + density (busy slate → single line of type). | Cut lands in the VO pause after "really, really worked" (RMS −52 dB at 758.0 = speech gap); the card exits on "By the 1970s". | None. No transient at either cut; music bed continuous (−20/−21 dB). | e01_cut_t758.0_f01,03,05,06,07,11,12 (4fps). Classroom last seen f05 (759.0), card first seen f06 (759.25). |
| P2-E2 | 850.5±0.25 (14:10) | "Singapore went from third world to first world in a single generation." → "By the 1990s, Singapore's GDP per capita exceeded Britain's" | Black card (the sentence handwriting itself on, finishes 849.5, holds ~1s) → sky-blue GDP bar-chart scene (UK/SG ball-flag characters on green bars) with "1990s" already handwriting on. Strongest cut in the half (scdet 68.9). | Black → pastel; type slate → animated chart. Era-jump idiom: date label writes on immediately after the cut. | Yes — cut + "1990s" draw-on land on the spoken "By the 1990s". | None. Bed continuous (−20/−23 dB), no transient at 850.5. | e02_cut_t848.0_f01,04,06,07,08,10,12,14,16 (4fps). Card last f10 (850.25), chart first f12 (850.75). |
| P2-E3 | 650.5±0.25 (10:50) | "…Everyone had retirement savings. It was genius." → "By the 1980s…" | 3-panel pastel triptych (citizens+key / money→HDB→house flow diagram / grandma+piggy bank), which held near-frozen for ≥1.75s → flat dark-navy slate, "By" handwriting on center. Another era-jump into a typographic beat. | Busy tri-split pastel → near-empty dark field with one word. | Yes — "By" is being written as "By the 1980s" is spoken. | None measurable; bed steady (−21/−23 dB). | e03_cut_t648.5_f01,04,06,07,08,10,12,14 (4fps). Triptych last f08 (650.25), dark slate first f10 (650.75). |

Pattern: the highest-energy cuts flip background VALUE (dark↔white/black↔pastel). Part-1 cuts land on the first word of the new sentence; part-2 era-jump cuts land on VO pauses with NO SFX hit. Across all 26 sampled windows every scene change was a hard cut — zero fades/wipes/dissolves at scene seams.

### Element entrances (6)

**Part 1:**

| # | Time | Narration beat | Mover | Direction+magnitude | Easing | Duration | Entrance style | On word? | SFX | Text treatment | Idle vs active | Frames |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1-E04 | 51.25–53.5 | "a British guy named Stamford Raffles **showed up**" | Element (tall ship) | Right→left slide-in, ~25–30% fw/s, steady | LINEAR (boat glide, no decel) | ~2.5s+ | slide | Ship visible by "showed up" | Bright chime/pop accents at ~51.8 and ~52.5 (no long whoosh) | — | Fisherman net-dump plays in fg (fish clump falls ~25%/s); water/bg static; head-turn reaction at ~51.5 | `e04-entrance-raffles.png` (49.5) |
| P1-E05 | 123–128 | "We have the big guns… I'm talking **massive**, 15-inch naval guns" | Element (gun art inside thought bubble) + camera | Bubble + gun art SWELL as the boast escalates (gun redrawn bigger ~125.3); simultaneous slow camera push-in ~5–8% scale/s across 5s | Linear grow | ~5s total | grow | Bubble swell lands around "massive" | None isolated (music bed only) | Caption line above: white marker-script, sentence case, swaps instantly per VO line | Talk-cycle (mouth pops each 0.25s), bubble-tail puffs wiggle; bg static | `e05-entrance-gun.png` (123.0) |
| P1-E06 | 15.25 + 14.75 | "We just got **kicked out** of Malaysia!" | Element (newspaper prop; speech-bubble text) | Newspaper swings up from lower right ~40°→0°, WITH real motion blur on the fast frames; ~30% fw travel in ~0.5s. Bubble text: pops on fully formed WITH the cut, swaps instantly per line (no per-word animation) | Prop: fast-in, decel into hold (no overshoot visible at 4fps). Text: snap pop | Prop ~0.5–0.75s; text 1 frame | prop=slide/swing, text=pop | Paper up-beat lands on "kicked out"; text present from line start | Music bed only in window | White handwritten-marker script, no box, small tick toward speaker; sentence case + exclamation | Speaker sweat-drop + mouth cycle active; second character, table, map prop static | `e06-entrance-bubble.png` (14.0) |

**Part 2:**

| # | t (s) | Narration context | Mover | Direction + magnitude | Easing | Duration | Entrance style | Lands on word? | SFX (measured) | Text treatment | Idle vs active | Frames cited (fps) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P2-E4 | 493.2–494.5 (08:13) | "Problem number one, water." | Both — camera whip-zooms into one pinned note on the dark "PROBLEMS" pin-board; note lights from dim gray to full color; label appears during the move | Zoom + pan up-left toward the note; note grows from ~10% to ~45% frame width in ~1s (≈35%/s at peak); heavy motion blur mid-move (f09), zero blur at settle | Fast-in, decelerate to hard settle (snap-out of a whip) | ~1.2–1.5s move, then ≥1.25s hold | Light-up (desaturated → color) + whip-zoom reveal; label "PROBLEM #1:" slides/writes in with the camera move, "WATER" completes at settle | Yes — settles as "water" is spoken (~494.3–494.5) | No distinct transient in RMS (−19/−22 dB bed; any whoosh is below bed level) | "PROBLEMS" / "PROBLEM #1: WATER" — handwritten marker ALL-CAPS, white, no outline, over dark board | Other 4 pinned notes stay dim/idle; only the tap-note + label + camera active | e04_ent_t492.0_f01,03,05,07,09,11,13,16 (4fps) — **spot-checked PASS, see Spot-check** |
| P2-E5 | 630.8–632.8 (10:30) | "…the Central Provident Fund, basically forced savings." | Elements (camera locked on flat green bg + CPF crest) | Piggy bank DROPS from top edge, falls ~60% frame height in ~0.4s; chain-flails swing in from lower corners ~30% frame width per 0.25-frame step; money bag pops in behind | Piggy: fast fall, hard landing with cartoon impact ticks (snap + accent). Chains: arc swing-in, blurred mid-swing (fast linear). Bag: instant pop | Piggy ~0.5s; chains ~0.5s each wave; whole build ~2s | Drop-in (piggy), swing-in (chains ×2 then ×4), pop (money bag); background darkens with a vignette blob as menace builds | Yes — piggy lands on "Fund/basically", chains arrive on "forced savings" | No distinct transient (−17→−20 dB smooth) | CPF crest is a drawn seal (circular lockup, dark green on white); no live type | Crest stays fixed (slight slow drift ≤2%/s before the gag); pig/chains/bag active | e05_ent_t629.0_f01,03,05,07,09,11,13,16 (4fps) |
| P2-E6 | 796.3–800.8 (13:16) | "…strict laws, like really strict: chewing gum banned; littering, heavy fines" | Elements + whip-pan camera between vignettes | Cop WALKS IN from frame-left (~25% frame width/s, leg-cycle blur); banana peel tossed in an arc ~20% width in 0.25s; "FINE $$$" paper handed over | Walk-in: linear; peel toss: ballistic arc; whip pans between gags: extreme-blur fast linear | Each vignette ~1.5–2s; walk-ins ~1s | Walk-on (cop ×2), thrown prop (peel), handed prop (fine paper); vignette 1 sign "NO NONSENSE…$$$ FINE" is already standing when the scene arrives | Yes — one vignette per spoken law item, gag beats hit on "banned"/"fines" | Measured hit at 796.5: −40→−23 dB in 0.2s (music/whistle accent as vignette 1 activates) | Sign: red marker ALL-CAPS "NO NONSENSE / FAILURE TO COMPLY = $$$ FINE", red border, red ⃠ icon; fine slip: red "FINE $$$" | Wall/bricks idle; characters + props active; camera only moves during the whip pans | e06_ent_t796.0_f01,04,06,08,10,12,14,16,18,20 (4fps) |

### Camera behaviors during held scenes (4)

**Part 1:**

| # | Time | Narration beat | Behavior | Magnitude + easing | Frames |
|---|---|---|---|---|---|
| P1-E07 | 76–83.7 | "southern tip of the Malay Peninsula… control trade between the Indian Ocean and the South China Sea" | ONE long continuous ZOOM-OUT (~5s) from island-scale to region-scale on a full-screen stylized map; then camera holds while elements animate (route draw-on, ships) | Smooth exponential-feel zoom, no steps, no spring; scale ~2× every ~1.5s early, easing off at the wide end | `e07-camera1-maphold.png` (76.0), `micro-pindrop-75.6-77.2.png` |
| P1-E08 | 437.3–441.7 | "Let's review Singapore's situation in 1965. No natural resources, no oil…" | Slow PUSH-IN on an opened book page (~10%/s for ~2s), then dead-still hold while the page content types on | Linear push, imperceptible ease-out into hold | `e08-camera2-review.png` (434.0) |

Also observed in part 1 (logged under other events): slow push-in during the officer boast (P1-E05); slow push-in on LKY-at-podium from behind (P1-E13, ~2.5%/s); slight zoom-out during the crown-jewel light-up (P1-E02). Camera never moves fast in part 1's sampled windows; every observed camera move there is a single-direction crawl ≤10%/s across the hold. (Part 2 adds the fast register: whip-zoom P2-E4 + whip pans inside the P2-E6 montage.)

**Part 2:**

| # | t (s) | Narration context | Mover | Direction + magnitude | Easing | Duration | Lands on word? | SFX (measured) | What stays idle vs active | Frames cited (fps) |
|---|---|---|---|---|---|---|---|---|---|---|
| P2-E7 | 564.0–566.5 (09:24) | "We're going to become the most business-friendly place on Earth." — "How?" | Camera LOCKED (0 measurable drift across 2.5s); all life = element swaps | No camera translation; dialogue text block swaps in place; LKY expression swaps (smile → confident-neutral) with a ✦ glint tick popping beside his face | Text/expression changes are instant swaps (snap); glint is a 1–2 frame accent | Scene holds ≥2.5s before cutting to the list staging | Yes — "How?" text appears as the aide says it | None (−17/−20 dB bed) | Everything idle except: text line, face, glint. Desk, map, files static | e07_cam_t564.0_f01,04,07 (3fps) |
| P2-E8 | 724.0–726.0 (12:04) | "How can we defend ourselves?" — "We make ourselves poisonous to swallow." | Camera slow zoom-OUT, ~1–2% scale per second (micro-drift); elements swap on top | Widening reveals desk paper "DEFENSE"; dialogue text swaps in place; LKY expression open-mouth → determined frown with glint tick | Drift: linear, near-imperceptible; swaps: snap | ~3s hold, then hard cut to over-shoulder close-up (727.0) where the character raises/moves the PROFILE + soldier-card props by hand | Yes — text swap lands on "poisonous to swallow" | None | Map + room idle; text, faces, then hand-held props active. Never a dead frame: something swaps every ~1s | e08_cam_t724.0_f01,04,07,10,13,16,18 (3fps) |

### Chart/diagram appearances (2)

**Part 1:**

| # | Time | Narration beat | Behavior | Frames |
|---|---|---|---|---|
| P1-E09 | 65.25–66.75 | "Plus, look at this location. Right between India and China." | Chart-as-PROP: a scroll map (SE Asia + red X on Singapore) is SWUNG up into the character's hand fully rendered — motion-blurred mid-swing at 65.25, settled by 65.75, held ~1.25s, swung out at 66.75. No draw-on, no growing bars — static artwork, animated arrival. | `e09-chart-map.png` (62.0) |

Contrast — the FULL-SCREEN map scene (P1-E07 window) does the opposite: pin DROPS in (2-frame fall with smear, snap landing + tiny settle at 76.2–76.3), labels FADE/TYPE on as zoom reveals them ("INDIAN OCEAN"/"SOUTH CHINA SEA" type on letter-by-letter ~10 chars/s at 79.3–80.7), red dashed trade route DRAWS ON left→right ~40% fw/s (81.0–82.3), then ship icons pop on and crawl along the route ~2–3% fw per 0.33s (83.0+). The population pictogram (P1-E02 window, 102.0–103.5) grows by POPPING one figure per ~0.25s, left→right, row by row, caption typing simultaneously. So: diegetic charts = static props; full-screen diagrams = draw-on/type-on/pop-per-unit.

**Part 2:**

| # | t (s) | Narration context | Behavior | Direction + magnitude | Easing | Duration | Lands on word? | SFX (measured) | Text treatment | Frames cited (fps) |
|---|---|---|---|---|---|---|---|---|---|---|
| P2-E9 | 850.75–857.3 (14:10–14:17) | "Singapore's GDP per capita exceeded Britain's… Let that sink in." | Bars GROW live with ball-flag characters riding the bar tops; SG bar overtakes UK and shoots off-frame; camera then zooms OUT to reframe; giant label handwrites on; then a hard cut to a re-staged close-up of the same set for the "sink in" beat | SG bar top rises ~40–50% frame height in ~0.5s at peak (motion blur on the ball); zoom-out ≈2× scale over ~2.5s | Bar growth: accelerating then hard stop; zoom-out: decelerates into settle by 854.7 | Growth ~1.5s; zoom-out ~2.5s; close-up hold ~2s+ | Yes — SG bar passes UK on "exceeded Britain's"; the cut to the close-up lands on "Let that sink in" | None at the cut; bed −18/−20 dB | Giant background caption "GDP PER CAPITA" hand-drawn dark-teal caps at ~full-frame scale BEHIND the bars, drawn on stroke-by-stroke; date "1990s" white script | e02_cut_t848.0_f12,14,16 + e09_chart_t852.0_f01,03,05,07,09,11,13,15,17 (3–4fps) |

### Emphasis beats (2)

**Part 1:**

| # | Time | Narration beat | What sells it | Frames |
|---|---|---|---|---|
| P1-E10 | 8.5–9.75 | "The average person there is wealthier than the average **American**" | Split-screen comparison: US-flag panel WIPES in right→left covering ~50% fw in ~0.75s (~65% fw/s), fast-in with decel landing; American character then slides UP from the panel bottom (~0.5s). SG side keeps its idle loop (money bills tossed, falling ~5–10% frame-height per 0.25s) the whole time. Panel lands as "average American" is spoken. | `e10-emphasis-flags.png` (6.0) |

SFX: vertical burst at ~8.3 + noise wash/riser into the next cut (~10.1–10.5) in `sfx-us-wipe.png` — wipe carries a whoosh; the following hard cut carries an impact accent.

**Part 2:**

| # | t (s) | Narration context | What motion sells it | Direction + magnitude | Easing | Duration | Lands on word? | SFX (measured) | Text treatment | Idle vs active | Frames cited (fps) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P2-E10 | 651.5–655.8 (10:51–10:55) | "By the 1980s, over 80% of Singaporeans lived in public housing that they owned." | The stat handwrites itself word-by-word paced to the VO while HDB apartment blocks RISE from the bottom edge and fill the skyline — the literal subject grows under the number | Blocks rise ~10–15% frame height per second, continuous; text reveals ~1 word per 0.25–0.5s | Blocks: steady linear rise (no bounce); text: stroke-on | ~4.5s total build | Yes — "80%" is on screen as it's spoken (~652.3–653); first line "By the 1980s," is ERASED before the stat line writes (651.5→652.0) | None (−17/−19 dB continuous VO+bed) | White handwritten script, sentence case, thin dark shadow, centered over dark navy sky; two lines | Sky idle; every building column + the text active for the whole beat | e10_emph_t651.0_f03,05,07,09,11,13,15,17,20 (4fps) |

### Scene-to-scene transition idioms (2)

**Part 1:**

| # | Time | Narration beat | Device | Frames |
|---|---|---|---|---|
| P1-E11 | 256–261.75 | ad end → "Now, where were we? During the Japanese occupation…" | HARD CUT out of the sponsor endcard (which idles with a ±5% breathing pulse on the starburst) → white-void narrator as a 2s palate-cleanser seam → HARD CUT into the story scene (marching soldiers, bob-cycle ~2–3% frame-height per 0.25s). No fade even at the sponsor boundary. | `e11-transition-adreturn.png` (256.0) |

Non-cut devices found in part 1 (all still bounded by hard cuts): (a) typed WHITE TEXT-CARD interstitial — "But here's where things get complicated." types on at ~20 chars/s, holds ~1s, cuts (P1-E03, 317.0–319.0); (b) BLACK chapter card with white script title (434.0, "The Island With No Resources… and All the Problems"); (c) match-style handoff where the held PROP map fills frame and becomes the live full-screen map (75.6–75.9, scroll border slides out of frame during the zoom).

**Part 2:**

| # | t (s) | Narration context | Device | Direction + magnitude | Easing | Duration | Lands on word? | SFX (measured) | Text treatment | Frames cited (fps) |
|---|---|---|---|---|---|---|---|---|---|---|
| P2-E11 | 703.0–707.75 (11:43–11:47) | "…he was playing the long game. Lastly, defense." | Section seam = chain of HARD CUTS through a recurring chapter set: crowd scene → literal gag insert (LKY over a chessboard = "long game", slight push-in, smile widens) → cut to the dark PROBLEMS pin-board, the shield note LIGHTS UP from dim gray to color + "PROBLEM #5: DEFENSE" writes on → cut to map + giant SG ball-flag. NO fade/dissolve anywhere. (The only non-cut device found in this half: WHIP PANS inside the P2-E6 law-vignette montage, at 797.5 and 800.25, extreme-blur ~0.25s.) | Note light-up is a color-state swap; label writes on over ~1.25s | Light-up: snap; write-on: linear strokes | Chess insert ~2s; board beat ~2.25s | Yes — chess insert sits on "playing the long game"; "DEFENSE" completes as "defense" is spoken | MEASURED music sting at 703.3: −37→−19 dB in ~0.2s, synced to the cut into the chess gag | "PROBLEM #5: DEFENSE" white marker ALL-CAPS on dark board, same lockup as PROBLEM #1 (P2-E4) — numbered chapter idiom | e11_trans_t703.0_f01,03,05,07,09,11,13,16,20 (4fps) |

### Held-set evolutions (2)

**Part 1:**

| # | Time | Narration beat | Behavior | Frames |
|---|---|---|---|---|
| P1-E12 | 0.0–6.3 | "Singapore went from a tiny island with zero resources to one of the **richest countries on Earth**" | THE SET IS HELD AND ELEMENTS ARE ADDED LIVE — no cut to a changed state. Night island (2 palms) holds ~2.3s with only idle water lines; sky/lighting crossfades to day (~2.3–4.0); bg skyline silhouettes FADE in (~0.3s); then landmark props POP in fully formed, one every ~0.3–0.4s, each arriving within ≤0.1s (verified at 10fps: MBS+supertrees 4.2→4.3, Flyer wheel 4.5→4.6, ArtScience 4.8→4.9, bg tower 5.1, Merlion 5.6→5.7). No grow, no overshoot — snap pops on the held camera. Build lands across "richest countries on Earth." Hard cut out at 6.7. | `e12-heldset-island.png` (0.0), `micro-island-4.0-6.0.png` (4.0) |

SFX: bright pop/hit transients above the VO band at ~4.0–4.4, ~5.3–5.5, ~6.1 in `sfx-island-pops.png` — the pops are scored. Same live-add grammar recurs at the crisis meeting (14.75–34: one held boardroom, speech bubbles + props swap per VO line, characters never re-blocked) and the crown-jewel scene (104–105.25: neighbors fade in around the held hero ball).

**Part 2:**

| # | t (s) | Narration context | CUT to changed state, or live evolution? | What changes | Easing / mechanism | Duration | Lands on word? | SFX (measured) | Idle vs active | Frames cited (fps) |
|---|---|---|---|---|---|---|---|---|---|---|
| P2-E12 | 506.0–515.3 (08:26–08:35) | "So we need our own water. Build reservoirs everywhere. I want this entire island covered in water catchment areas." — "But sir, we barely have any land!" | LIVE evolution on a held set, via an IN-WORLD AGENT — the blackboard set holds ~9s across 4 dialogue lines while its content changes on screen; the hard cut is saved for the next idea (roofs thought-bubble at 515.3) | (1) LKY walks in from frame-right (506–507.3); (2) he ERASES the board — "HOW TO GET WATER? / IMPORT FROM MALAYSIA" + peninsula map wiped with a visible eraser swipe (508.7, chalk streak + eraser in hand); (3) new diagram populates: Singapore island outline + 6 reservoir-tank icons appear over ~1.3s (508.7→510.0) while his body masks part of the board; (4) he steps aside to reveal it; (5) two more dialogue lines play over the finished board with only text + expression swaps | Erase: 1 fast swipe; icons: appear in quick succession (pop per icon); character motion: walk cycle | Whole evolution ~9s in one held framing | Yes — erase happens on "Build reservoirs. Everywhere."; the island fills during "entire island covered in water catchment areas" | None (−15→−20 dB) | Room, aide (mostly), board frame idle; character arm, board content, dialogue text active | e12_set_t506.0_f01,05,09,13,17,21,25,29,33 (3fps) |

### Free picks (2)

**Part 1:**

| # | Time | Narration beat | Why it's distinctive | Frames |
|---|---|---|---|---|
| P1-E13 | 419–424.75 | "went on television and **cried actual tears**" | The register-drop beat. Behind-the-podium shot with the ONLY slow push-in in the sequence (~2.5%/s, 2s+); hard cut to front; speech bubble GROWS in with motion blur (~15%→100% in ~0.25–0.5s, decel, no overshoot); then tears animate as a PROGRESSIVE REVEAL — a drop appears at 422.5, enlarges frame-by-frame into streams over ~2.5s while everything else holds; final cut to the wide symmetric flag shot with heavier tears. Audio goes SOFT: the sparsest spectrogram of all 9 windows (`sfx-bubble-cry.png`), no comedy SFX, thin somber notes. Comedy motion vocabulary is withheld, not replaced. | `e13-free-crying.png` (419.0) |

**Part 2:**

| # | t (s) | Narration context | Why distinctive | Direction + magnitude | Easing | Duration | Lands on word? | SFX (measured) | Text treatment | Frames cited (fps) |
|---|---|---|---|---|---|---|---|---|---|---|
| P2-E13 | 801.0–804.5 (13:21–13:24) | "…vandalism, you might get caned. [snorts] The government controlled the media…" | Two mechanics in 3s: (1) the graffiti line DRAWS ITSELF as the vandal sprays — a live-extending stroke (~15% frame width per 0.5s) — while a cop carrying a rattan cane walks in from frame-right; then the video CUTS AWAY at the exact punchline (802.75, before any caning is shown — implied off-screen violence as the joke). (2) In the next scene a "CENSORED!" black bar POPS onto the TV anchor's face and pops OFF again within ~0.75s (803.75→804.25 on, gone by 804.5) — a blink-length stamp gag; simultaneously two newspaper props pop onto the held dark set one after another (803.0→803.5) | Spray stroke: linear extension; CENSORED bar: instant on/off (stamp); newspapers: pop-in per item | Stroke: linear; stamps/pops: snap | Graffiti build ~2s; stamp ~0.75s | Yes — cut-away lands on "caned"; caption track logs a [snorts] SFX at 13:23 right at the cut | Onset 800.4–800.7: −30→−19 dB (spray/whistle accent); the snort itself not separable from bed in RMS | "CENSORED!" white caps in a black bar (stamp style); newspaper headlines in cartoon serif-ish caps ("PRESS GUIDELINES UPDATED") | e13_free_t800.0_f05,07,09,11,13,15,17,19,21,24 (4fps) |

## Combined rollup (full 968s)

| Metric | Combined finding | Part divergence (both reported — do not average) |
|---|---|---|
| Median hold length | ~5–7s; dialogue scenes re-cut faster (2–4s between closeups), diagram/map/dialogue scenes hold longest (max 16–17s) | Part 1: 5.0s median (85 cuts at scdet ≥8, mean 5.6s, max 17s, 8 holds >10s). Part 2: ~7s median (scdet ≥20 threshold; min ~1.5s chapter card, max ~16s). NOTE: the halves used different scdet thresholds (≥8 vs ≥20), so part of the gap is methodological; but part 2's dialogue-heavy back half plausibly does hold longer. |
| % holds with camera motion | Roughly 40% of sampled holds have a camera move; every slow move is a single-direction crawl (push-in ~1–10%/s or one long zoom-out) | Part 1: ~38% (5/13 windows), NO fast camera moves observed. Part 2: ~40% clear moves + ~20% micro-drift (≤2%/s) + ~40% fully locked — and part 2 adds a FAST register absent from part 1's samples: whip-zoom (P2-E4) and whip pans inside a list montage (P2-E6/E11, extreme-blur ~0.25s). |
| % holds with element motion | **100% in both halves.** Dead frames effectively do not exist. Minimum idle = talk-cycle (mouth swap ~0.25s) / blinks / water lines / bubble-tail wiggle / falling money / marching bob / breathing pulse / text or expression swap every ~1s | No divergence. |
| Entrance vocabulary (summed across 26 windows) | **pop/snap ×14** (landmarks, bubble text, pictogram figures, sparkles, ship icons, thought-bubble icons, money bag, newspapers, CENSORED bar) · **type-on/handwrite/draw-on ×11** (captions, white card, game panel, book page ×4 typed in P1; stat lines, chapter cards, labels ×6 handwritten in P2; trade route draw-on ×1) · **fade ×4** (P1 only: bg silhouettes, map labels, neighbor balls, panel) · **grow ×4** (gun-bubble swell, cry bubble, HDB blocks grow-from-edge, GDP bar-grow) · **swing/slide-with-motion-blur ×4** (newspaper, scroll map, cry-bubble, chains) · **walk-on ×3** (P2 only: cop ×2, LKY) · **linear glide ×2** (ship, US wipe panel) · **drop ×2** (map pin, piggy bank with impact ticks) · **light-up dim→color ×2** (P2 only: pin-board notes) · **stamp ×1** (red X on book) · **whip-zoom reveal ×1**. Fastest arrivals ≤0.1s (10fps-verified); prop swings ~0.5s; nothing eases longer than ~0.75s except camera crawls. | Vocab shift across halves: part 1 leans typed text + fades; part 2 leans stroke-by-stroke handwriting + walk-ons + light-ups (the pin-board chapter device lives in the back half). Pop/snap dominates both. |
| Transition inventory (union) | **Hard cut is universal** — every scene seam in all 26 windows, incl. the sponsor boundary and all 3 era jumps. Devices (all still bounded by hard cuts): typed white text-card interstitial (P1) · black typographic chapter card, cut–hold ~1.5s–cut (P1 ×1, P2 ×2) · narrator-on-white-void palate-cleanser seam (P1) · prop-map→fullscreen-map match handoff (P1) · recurring numbered pin-board chapter set with note light-up + label write-on (P2 ×2) · literal-gag insert scene at seams (P2, chessboard) · whip pans INSIDE rapid list montages only (P2 ×2). **Zero fades/wipes/dissolves between scenes in either half.** | Cut SFX diverges: part 1's high-energy cuts carry accents/risers; part 2's era-jump cuts carry NO hit and land on VO pauses instead — the sting is reserved for gag/seam cuts (703.3). |
| Chart/map behavior | Diegetic chart = static art on a swung-in prop (P1-E09). Full-screen map = pin-drop + label type-on + dashed-route draw-on + crawling ship icons over one continuous zoom (P1-E07). Quantity = one popped pictogram unit per beat (P1). Book-page stat list types on in sync with the spoken litany (P1-E08). Live bar chart = bars grow with characters riding them, overtake timed to the spoken comparison, camera zooms out to reframe, giant hand-drawn label writes on BEHIND the chart, then hard cut to a re-staged close-up for the reaction (P2-E9). Board diagrams are erased/redrawn live by an in-world agent (P2-E12) or accumulate as pop-in icons. | Part 1 splits static-prop vs draw-on-diagram; part 2 adds the performed chart (riding characters, in-world agent). |
| Type observations | ONE handwritten-marker family everywhere: white, sentence case, dark edge/outline, no boxes (floating with a tick-line or classic outlined bubble), placed near the speaker, swapped line-for-line with the VO — never per-word animation except type-on/stroke-on reveals. ALL-CAPS marker reserved for labels/props/warnings; red reserved for prohibition/fines (P2) + diegetic caps on props (newspaper headline, map labels, "1965" book — P1). One deliberate contrast face: amber PIXEL font, all-caps, in the videogame stat-panel device (P1-E03). One giant-scale background caption used as scenery ("GDP PER CAPITA", P2-E9). Chapter/stat beats: larger white script on black/dark fields, drawn stroke-by-stroke. | No contradiction — part 2 adds the giant-caption-as-scenery and red-for-prohibition observations. |

### Re-usable motion mechanics (union, tied to beat types)

1. **Held-set live build** (transformation/montage beat): lock camera + set, snap-pop one fully-formed element every ~0.3–0.4s synced to the VO list, each pop scored with a small hit — dead frames never occur because an idle loop underlies the pops. (P1-E12; also crisis meeting, pictogram.)
2. **Prop-swing insert with motion blur** (evidence/exhibit beat): any chart, headline, or map arrives as a physical prop swung into the held character shot in ~0.5s with real smear frames, decel into a ~1–2s hold, then swings out — sells materiality without cutting away. (P1-E06, P1-E09.)
3. **Split-screen wipe-in comparison** (stat/comparison emphasis): keep the subject's idle loop running, wipe a second panel in at ~65% fw/s with a whoosh so the comparator lands exactly on the spoken comparative word, then let a character rise up inside the panel as a second beat. (P1-E10.)
4. **Stat beat = handwrite the sentence word-by-word paced to the VO while the literal subject grows in from a frame edge** (P2-E10: "over 80%… public housing" writes on as HDB blocks rise and fill the skyline; P2-E9 variant: the bar physically overtakes on "exceeded"). The number is never popped as a card — it is written at speech pace and the scene *becomes* the statistic.
5. **Section/chapter seam = a recurring "board" set revisited per section: hard cut (or whip-zoom) to a dim pinned item, light it up to color, write its ALL-CAPS label on, with a measured music sting on the cut** (P2-E4 Problem #1, P2-E11 Problem #5). Cheap, structural, and it turns chapter navigation into a progress display.
6. **Held-set evolution by in-world agent, cut only on idea change** (P2-E12: the character erases and redraws the board live over a ~9s hold; P2-E7: element swaps one per spoken beat on a locked camera). Within a beat, elements move/pop ON the held set — the hard cut is reserved for the next idea, so continuity and cut-energy each do exactly one job. Register-drop variant: on the gravity beat the comedy vocabulary is WITHHELD, not replaced — only a slow push-in + one progressive reveal, audio thinned (P1-E13).

## AUDIO ROLLUP (full 968s track — part-1 agent deliverable, carried verbatim)

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

*Part-2 supplement (per-event RMS measurement, not a rollup):* most part-2 events ride the continuous bed with no separable transient (RMS flat ±1 dB). Measured hits: music sting at 703.3 (−37→−19 dB, seam cut), accent at 796.5 (−40→−23 dB, law-montage start), onset 800.4–800.7 (−30→−19 dB, spray vignette). The three era-jump cuts (P2-E1/E2/E3) carry NO hit — they land on VO pauses instead.

## Spot-check (merge-time verification, 2026-07-08)

Two events re-pulled at random (one per half) directly from the cached MP4 with ffmpeg (`fps=4,scale=480:-1`; frame time = burst start + (N−1)/4). Frames in `frames/crayon--singapore--spotcheck/`.

| Event | Burst | Logged claim checked | What the re-pulled frames show | Verdict |
|---|---|---|---|---|
| P1-E03 (hard cut @ 319.0) | `-ss 317`, 16 frames: `spot-p1-e03-01..16.jpg` | White typed text-card → dark retro-videogame scene; googly-eyed countryball + character-select stat panel building via fade+type; amber pixel font | f05 (~318.0): card mid-type "But here's where things / get compl"; f08 (~318.75): complete "…get complicated."; f09 (~319.0): HARD CUT — dark navy scene, countryball with googly eyes, panel corner fading in; f10 (~319.25): panel body in, amber pixel "SING" typing; f12 (~319.75): "SINGAPORE" + "Tin[y]" typing with cursor arrow; f16 (~320.75): "Tiny" + "Mostly Chinese" listed, slight reframe wider. Cut timing, value flip, mover, entrance style (fade + type-on), and pixel-font contrast face all match. | **PASS** |
| P2-E4 (whip-zoom entrance @ 493.2–494.5) | `-ss 492`, 12 frames: `spot-p2-e04-01..12.jpg` | Whip-zoom+pan up-left into one pinned note on the dark PROBLEMS board; note lights dim gray → full color; heavy blur mid-move, zero blur at settle; "PROBLEM #1:" during move, "WATER" complete at settle | f01–f06 (492.0–493.25): dark board, "PROBLEMS" white marker caps, 5 dim gray notes, character head bobbing idle (slight push-in already visible); f07 (~493.5): tap-note LIT to full color (white paper, colored faucet + blue drop), zoom accelerating toward it; f09 (~494.0): heavy motion blur mid-whip, "PROBLEM #1:" appearing, other notes dim; f12 (~494.75): settled sharp — note ~45% fw, "PROBLEM #1: WATER" complete, ALL-CAPS white marker. Mover, direction (up-left toward note), light-up, blur profile (blurred mid / sharp settle), and label timing all match. | **PASS** |

Result: 2/2 PASS — the merged log above is built on verified chunk logs.
