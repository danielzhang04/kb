# Motion log — Crayon Capital, "Rockefeller: The First Confirmed Billionaire" — PART 2 of 2

| | |
|---|---|
| Video | Rockefeller: The First Confirmed Billionaire (And How He Did It) |
| URL | https://www.youtube.com/watch?v=sMH8WchxQR8 |
| Range covered | 608s–1216s (10:08–20:16; seam sampled from ~09:53) |
| Part | 2 of 2 |
| Date | 2026-07-08 |
| Source video | 854x480, 30fps, 1215.75s (cached MP4) |

**Method note.** The claude-video-vision MCP server crashed mid-run (both calls failed); all bursts were extracted directly from the plugin's cached MP4 (`C:\Users\danie\.claude-video-vision\downloads\60dd9ed6e0e9-sMH8WchxQR8.mp4`) with ffmpeg at 3–4 fps, 480px. Timestamps were ground-truthed against the caption track: frame at 953s shows the "The Leak: The Empire Shatters" chapter card, matching the video's own 15:51 chapter mark and the caption line at 15:53 — **no offset** on direct extraction. All frames live in `frames/crayon-rockefeller-p2/` (same folder as this file); filenames encode `<event>_<startSec>s_<fps>fps_<NN>.jpg`, so frame NN sits at `start + (NN−1)/fps` seconds. Camera-drift calls were verified with pixel-difference images (`d_*.jpg`, `d2_*.jpg`, PSNR), not eyeballed. Per-event SFX was read from 3s audio spectrograms (`sfx_s01..s14.png`) of the music+VO mix — transients are attributable but not isolable, so SFX calls are best-effort spectrogram reads.

## Events (13)

Legend: magnitude = % of frame width (or height where noted) per second. "Lands on word" = whether the motion's arrival coincides with the matching spoken word (caption-track timing).

### Hard cuts (3)

| # | t | Narration beat | What changes across the cut | Cut energy | Mover | Easing | Lands on word | SFX (spectro) | Idle vs active after cut | Frames |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 664.25s (11:04) | "This was vertical integration." | Medium shot (Rockefeller grinning, holding scroll) → full-frame INSERT close-up of the same scroll; text becomes readable | Medium (same set, scale jump ~3x) | camera (cut-in) | snap (1-frame) | YES — lands on "vertical integration" | none distinct above VO/music | close-up drifts slowly (~1.4%/s, linear); no element motion | e01_662.5s_4fps_07→09.jpg (cut between 07 and 08), drift proof d_e01.jpg (09 vs 15) |
| 2 | 710.25s (11:50) | "Scorched earth. He bought strips of land across the pipeline's path" | Black type-on text card → parchment "PIPELINE OBSTRUCTION MAP" | High (black → full bright parchment; scdet 73.5, top score of the half) | n/a (cut) | snap | YES — map arrives on "He bought strips of land" | typewriter ticks before cut; soft stabs after | map immediately starts populating (see event 9) | e04_709s_4fps_05→06.jpg |
| 3 | 1073.25s (17:53) | "At 72 years old, the world believed Rockefeller had finally lost." | Bright cream diagram (Exxon/Mobil/Chevron circles) → very dark room, aged Rockefeller facing camera | High (extreme value flip bright→dark; scdet 69.4) | n/a (cut) | snap | YES — lands on "At 72 years old" | no hit; music bed continues | face idle (micro breath) ~1.2s, then speech bubble types on | e12b_1072.5s_4fps_03→04.jpg, bubble 09–10 |

### Element entrances (3)

| # | t | Narration beat | Element + entrance style | Direction + magnitude | Easing | Duration | Lands on word | SFX (spectro) | Text treatment | Idle vs active | Frames |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | 709.0–710.0s (11:49) | "Rockefeller's response? Scorched earth." | TEXT: white script line types onto pure black card (typewriter reveal), left→right | n/a (in-place typing, ~15 chars/s) | linear stepped | ~1.7s incl. hold | YES — types in sync with the same spoken sentence | faint tick transients per keystroke cluster | handwritten marker-script, white on black, sentence case, no outline | nothing else on screen — card is 100% type | e04_709s_4fps_01,02,03,04.jpg |
| 5 | 1109.3–1110.3s (18:29) | "…the world's first confirmed billionaire." | PROP: third newspaper ("NATIONAL NEWS / WORLD'S FIRST BILLIONAIRE") tossed onto empty wood table from bottom of frame, slight rotation as it lands | up ~80% of frame HEIGHT in ~1s | ease-out (big first step, settles; no overshoot visible at 3fps) | ~1.0s | YES — lands on "world's first" | broadband slap/whoosh burst at 1109.3 | hand-serif headline, all-caps, black on newsprint, red-free | table empty before; paper is sole mover; holds ~2.3s after | e15_1104s_3fps_16 (empty), 17, 18, 19, 20 (settled).jpg |
| 6 | 735.25–737.3s (12:15) | "From Cleveland to the Atlantic coast…" | DIAGRAM ELEMENTS: refinery icon pops at Cleveland; rail lines DRAW outward across map; "ATLANTIC" label typewriters; octopus fades in over network | draw-on travels ~60% frame width over ~1.5s (~40%/s tip speed) | linear (draw), snap (pop), fade (octopus ~0.7s) | ~2.3s total | YES — pop on "Cleveland", line reaches coast on "Atlantic coast" | thin rising riser under the draw-on | map labels: small script caps, dark ink on parchment | sea/ships static; only the drawing network + labels active | e05_734s_4fps_05 (empty map), 06 (icon pop), 07–12 (lines draw, label types), 13–14 (octopus fade).jpg |

### Camera behavior during held scenes (2)

| # | t | Narration beat | Camera behavior | Magnitude | Easing | Duration | Element motion during hold | SFX | Frames + proof |
|---|---|---|---|---|---|---|---|---|---|
| 7 | 1113–1116.3s (18:33) | "…the average American earned just $800 a year" | Lateral tracking drift across grey cubicle, following trudging worker | ~8%/s horizontal (ghost separation ~25% width over 3s) | linear, constant | ~3.3s hold | worker walk-cycle, briefcase sway | none distinct | e13_1113s_3fps_01…10.jpg; diff d2_cub (in diff_grid2.jpg) shows uniform double-edges on walls AND figure |
| 8 | 830–835.3s (13:50) | Journalist quote: "You could argue its existence from its effects, but you could not prove it." | Near-static spotlight portrait; micro push-in only | ~0.3%/s (faint concentric doubling over 5.3s) | linear | ~5.3s hold (longest sampled) | mouth/eyebrow talk-loop; quote text pops in/out phrase-by-phrase (3 lines) | small pop transients with text lines; street ambience swap at 835.3 cut | e09_830s_3fps_01,02,05,11,16.jpg; diff d2_spot (in diff_grid2.jpg) |

Corroborating camera data (not counted in quota): scroll close-up drifts ~1.4%/s (d_e01.jpg); pipeline wide shot pushes ~1–1.5%/s (d2_pipe); gold-pile scene pushes ~1%/s radial (d2_gold); newspaper-stack slate pushes ~0.5–0.8%/s (d_e15.jpg). Every sampled pictorial hold moves; only black/cream text cards are dead-static.

### Chart / diagram appearance (1)

| # | t | Narration beat | Behavior | Magnitude/order | Easing | Duration | Lands on word | SFX | Text treatment | Frames |
|---|---|---|---|---|---|---|---|---|---|---|
| 9 | 710.25–712.0s (11:50) | "He bought strips of land across the pipeline's path" | Map does NOT arrive complete: pipeline route pre-drawn, then land parcels FADE/draw on in waves (faint → dark → red "BOUGHT BY ROCKEFELLER" parcels last + derrick icon), density accelerating | ~25 parcels over ~1.5s, sparse→dense (accelerating count) | fade-on per parcel, snap per red parcel | ~1.75s to full | YES — red parcels land on "bought" | descending stab pattern under populate | map title underlined hand-caps; parcel labels tiny script; red = ownership emphasis | e04_709s_4fps_06 (route only), 07, 08, 10, 11, 12 (full grid + red).jpg |

### Emphasis beat (1)

| # | t | Narration beat | What sells the number | Mover + magnitude | Easing | Duration | Lands on word | SFX | Text treatment | Frames |
|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 1104.3–1118s (18:24–18:38) | "Front page news… first confirmed billionaire… a literal $1 billion" | ESCALATION RUN: three consecutive headline slates, each held ~2.3s (clothesline papers → bundled stack → tossed single paper), then a CONTRAST cut: shabby $800/yr cubicle → Rockefeller lounging on a mountain of gold | cuts do the work; slates push ~0.5–1%/s; toss = 80% height/s | slate pushes linear; toss ease-out | ~14s sequence | YES — toss on "world's first"; gold-pile cut lands at "a literal $1 billion" (1116.7s) | slap on toss; no hit on contrast cut | 3 different masthead styles, all-caps hand-serif headlines, escalating claim size | e15_1104s_3fps_01,02,09,16–20.jpg; e13_1113s_3fps_11→12.jpg (contrast cut), d2_gold diff |

### Scene-to-scene transition (1)

| # | t | Narration beat | Device | Magnitude | Easing | Duration | SFX | Text treatment | Frames |
|---|---|---|---|---|---|---|---|---|---|
| 11 | 764.75–767.75s (12:45) | chapter break after "…that target was about to be painted red" → "The Ghost" | Chapter idiom: HARD CUT to black title card (title already fully set, no build-on) → hold ~2.25s with music drop + low bass swell → ~0.5s FADE-UP from black into next scene (dark bowler-hat tableau brightens over 2 frames) | fade ~0.5s | card snap; fade linear | ~3s total | VO silent; low rumble swell through card, sparse piano on fade-up | white handwritten-script title, sentence case, centered, no outline | e07_763s_4fps_08 (globe) → 09 (card), 17→18→19→20 (fade-up).jpg; same idiom at 15:51: e11_952s_4fps_08,09,10,12.jpg |

Cut idiom confirmed: regular shot changes in this half are all hard cuts (no crossfades found in any sampled window). **Non-cut devices found (2):** the chapter-card fade-up above, and a WHITE-FLASH dissolve into flashback at 965.3–966.3s ("Decades earlier, her father…") — frame bleaches to near-white in ~0.7s, new desaturated scene resolves in ~0.3s, with palette shift to grey-blue for the past (e14_965s_3fps_01,02,03,04,05.jpg; soft shimmer swell on spectrogram sfx_s14). Also one lateral slide-wipe family inside montages (see event 12).

### Held-set evolution (1)

| # | t | Narration beat | Behavior | Magnitude | Easing | Duration | Lands on word | SFX | Frames |
|---|---|---|---|---|---|---|---|---|---|
| 12 | 671–678s (11:11–11:18) | "He bought the… barrels. He bought the warehouses. He even bought the chemical plants" | BOTH modes, split by scale: within a vignette, elements are ADDED LIVE on the held set — warehouses multiply one-by-one behind the handshake (1 → 2 → 3 buildings pop/grow in over ~1s) while figures + money bags hold; BETWEEN vignettes it does not hard-cut but slide-wipes laterally (old set exits left as new set enters right, full frame width in ~0.5s ≈ 200%/s) | pops snap/grow ~0.3s each; wipe ~200%/s | pop = snap→settle; wipe = fast linear | each vignette ~3s | YES — each wipe lands on the next "He bought…" item | soft whoosh under wipe; plucked-note pops with additions | e02_671s_3fps_01–09 (barrel set), 10 (wipe mid-state), 11,12 (warehouse grows), 13–16 (warehouses multiply), 17 (wipe mid-state), 18–27 (chem-plant set).jpg |

### Free pick — most distinctive motion moment (1)

| # | t | Narration beat | Behavior | Magnitude | Easing | Duration | Lands on word | SFX | Frames |
|---|---|---|---|---|---|---|---|---|---|
| 13 | 1064.3–1071.7s (17:44–17:52) | "The trust was shattered into 34 separate pieces… Exxon, Mobil and Chevron" | Full kinetic sequence on ONE held cream set, zero cuts: "THE TRUST" circle GROWS in (~40%→100% scale, 0.7s, ease-out) → crack lines DRAW across it (~1s) → SHATTER: halves fall, fragments burst outward ballistically (~90%/s initial, decelerating) and resolve into an arc formation of 34 small circles (~1s) → formation holds ~2s while one circle labels "Exxon" → circles CONVERGE/merge back inward, label cycling Exxon→Mobil→Chevron (~1.3s) → stack SLIDES APART into a settled row of 3 logo circles | scatter ~90%/s decel; converge ~40%/s | pop ease-out; scatter ballistic (gravity on halves); slide-apart ease-out | ~7.4s | YES — shatter frame (1066.3s) lands on "shattered"; 34-formation completes on "34 separate pieces" | pop on entrance; clear crack/debris burst at shatter; riser before it | e12_1064s_3fps_02,03,04 (grow), 05–07 (crack), 08 (burst), 09–11 (scatter→34), 12–16 (hold+Exxon), 17–20 (merge/relabel), 21–27 (slide apart, settle).jpg |

## Rollup (608–1216s)

| Metric | Value | Basis |
|---|---|---|
| Median hold length | **~4s** (mean 4.9s, min 1s, max 16s, n=118) | scdet events score≥18 in range; corroborated by burst windows (pictorial holds 2.3–5.3s) |
| % of holds with camera motion | **~90% of pictorial holds** (6/6 diffed holds moved: 0.3–8%/s; text/diagram cards 0/3 moved) | PSNR + difference images d_e01, d_e15, d2_cub, d2_gold, d2_spot, d2_pipe |
| % of holds with element motion | **100% of sampled windows (14/14)** — every hold carries at least one of: character action-loop, mouth-loop, type-on, pop-in, draw-on, glow pulse | all event bursts |
| Dead-static frames | only black type-on cards between scenes — and those carry live typing | e04, e05, e06, e08 card frames |

**Entrance vocabulary counts (across the 14 sampled windows):**

| Entrance style | Count | Where seen |
|---|---|---|
| Typewriter type-on (cards, speech bubbles, labels, strikethrough lists) | 7 | 709 card, 734 card, 747 card+bubble, 803 card, 833 quote lines, 1074 bubble, 1120 "FATH…" strike-list |
| Pop-in (icons, buildings, text lines, trust circle w/ scale) | 6 | 735 refinery, 674–676 warehouses, 833 captions, 1064 trust circle, 748 bubble, 952 card |
| Draw-on (lines, circles, painted letters, cracks, parcels) | 5 | 710 parcels, 735 rails, 804 red date-circle, 896 "8 CENTS" painted, 1065 cracks |
| Slide/toss-in | 3 | 1109 newspaper toss, 674+676 vignette wipes |
| Fade-in | 3 | 737 octopus, 767/954 chapter fade-ups, 965 white-flash resolve |
| None (element pre-set, revealed by insert cut) | 2 | 664 scroll close-up, 695.5 pipeline wide |

**Transition inventory:** hard cut (dominant, ~118 in range, one per ~5s) · black type-on text card as scripted interstitial (the VO's pivot sentence typed on black, then cut out — 5 observed: 709, 734, 746, 803, 893) · chapter idiom = hard cut to pre-set black title card + music drop/bass swell + 0.5s fade-up (2: 12:45, 15:51) · white-flash dissolve for flashback w/ palette desaturation (1: 16:05) · lateral slide-wipe between montage vignettes (~200%/s; 2: 11:14, 11:16) · zero crossfades between regular shots.

**Chart/map behavior:** never static, never pre-complete. Diagrams enter with structure only (route, empty map, blank circle) and POPULATE live, element class by element class, each wave timed to its spoken noun (parcels on "bought", rails on "Cleveland→Atlantic", red marks last as the punch). Populate time ~1.5–2.5s, density accelerating. Numbers are never overlay-text — they are painted/circled/printed on in-world props (sign, calendar, newspaper).

**Type observations:** one handwritten marker-script family carries everything (chapter cards, interstitial lines, quotes, map labels, speech bubbles) — white on black for cards/quotes, dark ink on parchment/paper props, sentence case, no outline, no drop shadow. Newspaper headlines use a heavier condensed hand-serif, ALL-CAPS. Red is reserved as the emphasis ink (strikethrough, ownership parcels, circled date). Text is almost always revealed (typed/painted/drawn), not popped whole; the only pre-set text is chapter titles.

**3 most re-usable motion mechanics (tied to beat type):**

1. **Black type-on card for the rhetorical pivot** (beat: a turn/verdict line — "Rockefeller's response? Scorched earth."). The VO's exact sentence typewriters onto a silent black card (~15 chars/s, tick foley, music thinned), then hard-cuts into the payoff scene. Doubles as a transition and resets visual attention so the next slate lands harder.
2. **Live-populating diagram synced to nouns** (beat: scale/expansion/data). Structure first, then waves of draw-on lines + pop-in icons + typed labels, each wave landing on its spoken word, emphasis color last. Turns a static map/chart into a ~2s choreography with zero camera motion needed.
3. **In-world number reveal with contrast cut** (beat: the big number). The figure is physically made on set — painted "8 CENTS", red-circled "2", tossed "WORLD'S FIRST BILLIONAIRE" front page — with draw-on/toss ease-out + foley landing exactly on the spoken number, then (for the biggest number) an immediate hard contrast cut (poor cubicle → gold mountain) that lets juxtaposition, not motion, deliver the weight.
