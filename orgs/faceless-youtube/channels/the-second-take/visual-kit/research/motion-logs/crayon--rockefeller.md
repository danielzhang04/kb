# Motion + audio teardown — Crayon Capital, "Rockefeller: The First Confirmed Billionaire" (FULL VIDEO)

- **Video:** Crayon Capital — *Rockefeller: The First Confirmed Billionaire (And How He Did It)*
- **URL:** https://www.youtube.com/watch?v=sMH8WchxQR8
- **Duration:** 1216s (20:16); source sampled 854x480, 30fps
- **Merged from:** `crayon--rockefeller--part1.md` (0–608s) + `crayon--rockefeller--part2.md` (608–1216s), 2026-07-08
- **Why this video:** Crayon's STORY format and the channel's biggest video — the base grammar reference for the teardown cycle.
- **Method note:** the claude-video-vision MCP server crashed in both extraction runs; all evidence was extracted directly from the plugin's cached MP4 (`~\.claude-video-vision\downloads\60dd9ed6e0e9-sMH8WchxQR8.mp4`) with ffmpeg — frame bursts at 2–4 fps, per-event spectrograms/waveforms, RMS traces, and (part 2) pixel-difference/PSNR proofs for camera-drift calls. Timestamps ground-truthed against the caption track in both parts; **no offset** on direct extraction. Frames live in `frames/crayon--rockefeller--part1/` and `frames/crayon-rockefeller-p2/`; per-frame time = window start + (N−1)/fps.
- **Seam dedupe check:** part 1 sampled to ~615s, part 2 from ~600s. No EVENT was logged by both parts within ~15s of the 608s seam — part 1's only cross-seam references (quote card 609.3–612.7s, clock ticking 609–610.3s) appear as rollup/mechanic examples, not events, and part 2 logged no event before 664.25s. **All 26 events kept; zero dropped as duplicates.**

## Events table — all 26 events

Part-1 frames → `frames/crayon--rockefeller--part1/`; part-2 frames → `frames/crayon-rockefeller-p2/` (`<event>_<startSec>s_<fps>fps_<NN>.jpg`). Magnitude = % frame width/s unless noted.

### Hard cuts (6)

| # | Part | t | Narration beat | What changes across the cut | Mover | Easing | Entrance at cut | Lands on word | SFX | Idle vs active after | Frames |
|---|---|---|---|---|---|---|---|---|---|---|---|
| E1 | 1 | 19.0s | VO silent over title card; cut lands as "July 8th, 1839, Richford, New York" begins | black title card → full-color aerial village (max luminance jump) | cut only (camera static both sides) | snap (1 frame) | date/place stamp "July 8, 1839 / Richford New York" FADES IN bottom-right over ~0.5s (cutA_09 absent → 11 faint → 13 full) | YES — exactly on "July 8th" (first VO word after 4.5s silence) | cymbal-swell wash decays across the card, birdsong ambience enters with the village (spec_cutA) | wagon travels, slight push-in, all idle-level | cutA_01–18 (sheet_cutA.jpg) |
| E2 | 1 | 195.0s | "…It was safe and steady." → "Then 1859 happened, the Pennsylvania oil strike" | black quote card → bright cream daylight derrick | cut only | snap | "1859" script date already on at first frame; oil GUSH animates 0.5s after cut (cutB_17→20) | YES — on "Then 1859 happened" | pad-only dark zone 194.3–195.2 then dense onset + LF gush rumble/splats 195.5–197 (spec_cutB) | derrick static, only the oil animates | cutB_13–20 (sheet_cutB.jpg) |
| E3 | 1 | 366.5s | "…he looked at his surroundings." → "As he stood over the smoky skyline…" | black quote card → sepia industrial vista | cut only | snap | none — scene arrives whole | YES — on "As he stood" | whoosh/wind swell at the cut, wind-noise wash under the vista (spec_skyline) | smoke drifts, figure idles | skyline_13–16 (sheet_skyline.jpg) |
| E14 | 2 | 664.25s (11:04) | "This was vertical integration." | medium shot (Rockefeller grinning w/ scroll) → full-frame INSERT close-up of the same scroll, text readable (scale jump ~3x) | camera (cut-in) | snap (1 frame) | element pre-set, revealed by the insert cut | YES — on "vertical integration" | none distinct above VO/music | close-up drifts slowly (~1.4%/s, linear); no element motion | e01_662.5s_4fps_07→09 (cut between 07/08), drift proof d_e01.jpg |
| E15 | 2 | 710.25s (11:50) | "Scorched earth. He bought strips of land across the pipeline's path" | black type-on card → parchment "PIPELINE OBSTRUCTION MAP" (scdet 73.5, top score of the half) | cut | snap | map immediately starts populating (see E22) | YES — map arrives on "He bought strips of land" | typewriter ticks before cut; soft stabs after | map populates live | e04_709s_4fps_05→06 |
| E16 | 2 | 1073.25s (17:53) | "At 72 years old, the world believed Rockefeller had finally lost." | bright cream diagram (Exxon/Mobil/Chevron circles) → very dark room, aged Rockefeller facing camera (extreme value flip; scdet 69.4) | cut | snap | face idle ~1.2s, then speech bubble types on | YES — on "At 72 years old" | no hit; music bed continues | face micro-breath idle, then bubble type-on | e12b_1072.5s_4fps_03→04, bubble 09–10 |

### Element entrances (6)

| # | Part | t | Narration beat | Element + entrance style | Direction/magnitude | Easing | Duration | Lands on word | SFX | Text treatment | Idle vs active | Frames |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E4 | 1 | 39.2–40.8s | "William Avery Rockefeller, known to locals as Devil Bill" | TEXT: name card type-on, letter-by-letter L→R | in-place; 25 chars in ~1.7s ≈ 15 chars/s | linear tick-rate (typewriter) | ~1.7s | YES — name completes as "Devil Bill" is spoken | deep boom + tick transients (spec_father) | white handwritten-script, sentence case, centered on black, no outline | text only active thing on black | father_15–22 (sheet_father.jpg) |
| E5 | 1 | 153.0–155.3s | "recording every single penny… in a small red book he called ledger A" | PROP: expenses book swing/pop-in | book fills ~80% width in ≤0.33s (absent ledger_10, in ledger_11), then rocks/settles ~2s | snap-in + damped rock (spring settle) | entrance <0.33s; settle ~2s | YES — lands on "small red book" | broadband + LF thump at 153.3–153.5 (spec_ledger) | in-book: dark handwritten face, "TODAY'S EXPENSES" + 4 line items, pre-written (no draw-on) | book is the frame; nothing else | ledger_10–17 (sheet_ledger.jpg); re-verified in Spot-check A |
| E6 | 1 | 446.5–452.5s | "First, the rebate…" (pillar 1 of 3) | CHARACTERS/ELEMENTS: label + handshake pair + money pile + barrels ×3 + % tag pop-in sequentially | each pops ~0→full scale in 0.3–0.5s, one at a time | pop w/ slight grow-overshoot (spring) | 0.3–0.5s each; cluster accretes ~6s | YES — each element lands with its noun ("rebate" → handshake; barrels on "every barrel he shipped") | pluck/pop transient per entrance (spec_pillars) | "THE REBATE" small-caps dark olive in boxed strip | canvas static; only the entering element moves, landed elements hold | pillars_08–20 (sheet_pillars.jpg) |
| E17 | 2 | 709.0–710.0s (11:49) | "Rockefeller's response? Scorched earth." | TEXT: white script line typewriters onto pure black card, L→R | in-place typing, ~15 chars/s | linear stepped | ~1.7s incl. hold | YES — types in sync with the same spoken sentence | faint tick transients per keystroke cluster | handwritten marker-script, white on black, sentence case, no outline | card is 100% type; nothing else | e04_709s_4fps_01–04 |
| E18 | 2 | 1109.3–1110.3s (18:29) | "…the world's first confirmed billionaire." | PROP: third newspaper ("NATIONAL NEWS / WORLD'S FIRST BILLIONAIRE") tossed onto empty wood table from bottom of frame, slight rotation on landing | up ~80% frame HEIGHT in ~1s | ease-out (big first step, settles; no overshoot at 3fps) | ~1.0s | YES — lands on "world's first" | broadband slap/whoosh burst at 1109.3 | hand-serif headline, all-caps, black on newsprint | table empty before; paper is sole mover; holds ~2.3s after | e15_1104s_3fps_16–20; re-verified in Spot-check B |
| E19 | 2 | 735.25–737.3s (12:15) | "From Cleveland to the Atlantic coast…" | DIAGRAM: refinery icon pops at Cleveland; rail lines DRAW outward; "ATLANTIC" label typewriters; octopus fades in over network | draw-on tip travels ~60% width over ~1.5s (~40%/s) | linear (draw), snap (pop), fade (octopus ~0.7s) | ~2.3s total | YES — pop on "Cleveland", line reaches coast on "Atlantic coast" | thin rising riser under the draw-on | map labels: small script caps, dark ink on parchment | sea/ships static; only network + labels active | e05_734s_4fps_05–14 |

### Camera behavior during held scenes (4)

| # | Part | t | Narration beat | Camera behavior | Magnitude | Easing | Duration | Element motion during hold | SFX | Frames + proof |
|---|---|---|---|---|---|---|---|---|---|---|
| E7 | 1 | 81.7–88.0s | "One day, Devil Bill placed young John on a high chair. 'Jump, son! I'll catch you!'" | STATIC — 0%/s across a 3s close hold AND a 3s wide hold | 0%/s | hold | two ~3s holds, action resolves ~0.7s | John trembles in place (~1–2% jitter/frame, wobble lines drawn on); Bill statue-still — the contrast IS the composition | beat-pause dip 87.0–87.5 (−37dB) before the jump; LF impact thud at 88.5 (−16.9dB spike, spec_chair) | chair_03–30 (sheet_chair.jpg); dialogue line pops on as full line (chair_13→14) |
| E8 | 1 | 366.7–371.7s | "As he stood over the smoky skyline, he saw hundreds of small inefficient refineries…" | micro push-in + background layer drift | push ≈3–5% total over 5s (<1%/s); smoke plumes drift up-right ~2–3%/s | linear drift, no ramp | ≥5s continuous | smoke layer + coat sway; everything else frozen | wind-noise wash sustained (spec_skyline) | skyline_15–30 (sheet_skyline.jpg) |
| E20 | 2 | 1113–1116.3s (18:33) | "…the average American earned just $800 a year" | lateral tracking drift across grey cubicle, following trudging worker | ~8%/s horizontal (ghost separation ~25% width over 3s) | linear, constant | ~3.3s hold | worker walk-cycle, briefcase sway | none distinct | e13_1113s_3fps_01–10; diff d2_cub (diff_grid2.jpg): uniform double-edges on walls AND figure |
| E21 | 2 | 830–835.3s (13:50) | journalist quote: "You could argue its existence from its effects, but you could not prove it." | near-static spotlight portrait; micro push-in only | ~0.3%/s (faint concentric doubling over 5.3s) | linear | ~5.3s (longest sampled hold) | mouth/eyebrow talk-loop; quote text pops in/out phrase-by-phrase (3 lines) | small pop transients with text lines; street ambience swap at 835.3 | e09_830s_3fps_01–16; diff d2_spot |

Corroborating part-2 camera data (not counted in event quota): scroll close-up ~1.4%/s (d_e01.jpg); pipeline wide ~1–1.5%/s (d2_pipe); gold-pile ~1%/s radial (d2_gold); newspaper-stack slate ~0.5–0.8%/s (d_e15.jpg). Every part-2 pictorial hold moved under pixel-diff; only black/cream text cards were dead-static.

### Chart / diagram appearance (2)

| # | Part | t | Narration beat | Behavior | Magnitude/order | Easing | Lands on word | SFX | Text treatment | Frames |
|---|---|---|---|---|---|---|---|---|---|---|
| E9 | 1 | 349.25–351.25s | "…he could sell his oil cheaper than anyone else and still make a profit." | previous flowchart clears; hand-drawn line chart DRAWS ON L→R on the same cream canvas; arrow-tip flick; "PROFIT" types P→PRO→…; 4 coin stacks grow in sequence | line tip ~60% width in ~1.25s (~50%/s); label ~10 chars/s; coins sequential (bar-growth idiom) | continuous linear draw + fast arrow flick | YES — chart completes on "profit" | rising pitch-sweep ~1.2kHz→6kHz under the draw (spec_cutC) — draw-on gets a riser | "PROFIT" white-on-cream handwritten caps, no outline | cutC_01–10 (sheet_cutC.jpg) |
| E22 | 2 | 710.25–712.0s (11:50) | "He bought strips of land across the pipeline's path" | map does NOT arrive complete: route pre-drawn, then land parcels FADE/draw on in waves (faint → dark → red "BOUGHT BY ROCKEFELLER" parcels last + derrick icon), density accelerating | ~25 parcels over ~1.5s, sparse→dense | fade-on per parcel, snap per red parcel; ~1.75s to full | YES — red parcels land on "bought" | descending stab pattern under populate | map title underlined hand-caps; parcel labels tiny script; red = ownership emphasis | e04_709s_4fps_06–12 |

**Shared verdict:** charts/maps draw on live, never pop in whole; values grow sequentially; emphasis color (red) lands last as the punch.

### Emphasis beats (2)

| # | Part | t | Narration beat | What sells the number | Mover + magnitude | Easing | Lands on word | SFX | Text treatment | Frames |
|---|---|---|---|---|---|---|---|---|---|---|
| E10 | 1 | 276.0–280.5s | "Until — 72,500." | build: Clark's paddle LOWERS out of frame ~1.5–2s (~10%/s) → smug Clark hold → John's "$72.500" paddle SWINGS UP from bottom-left into full-frame close-up (~70% height in ~0.75s ≈ 90%/s, rotation settle) → holds huge 1.5s → cut to Clark shock face (sweat drop, trembling mouth) | element (prop) + edit pattern | spring (fast in, small rotational settle) | YES — paddle arrives exactly on the spoken "72,500" | measured: near-silence 269.5–270 (−44.8dB, "dead silent") → tense quiet → RISING SWEEP 1.5→8kHz at 277.3–278.1 under the swing → hit −18.6dB on arrival → sting on shock-face cut. **Silence → riser → hit → reaction = the number-selling grammar.** | number lives ON a diegetic prop (auction paddle, dark script on tan), not an overlay | auction_09–38 (sheet_auction.jpg) |
| E23 | 2 | 1104.3–1118s (18:24–38) | "Front page news… first confirmed billionaire… a literal $1 billion" | ESCALATION RUN: three consecutive headline slates each held ~2.3s (clothesline papers → bundled stack → tossed single paper), then CONTRAST cut: shabby $800/yr cubicle → Rockefeller lounging on a gold mountain | cuts do the work; slates push ~0.5–1%/s; toss = 80% height/s | slate pushes linear; toss ease-out | YES — toss on "world's first"; gold-pile cut lands at "a literal $1 billion" (1116.7s) | slap on toss; no hit on contrast cut | 3 different masthead styles, all-caps hand-serif, escalating claim size | e15_1104s_3fps_01–20; e13_1113s_3fps_11→12 (contrast cut), d2_gold diff |

### Scene-to-scene transitions (2)

| # | Part | t | Narration beat | Device | Detail | SFX | Frames |
|---|---|---|---|---|---|---|---|
| E11 | 1 | 385.25–389.5s | "…and I will be the one." → [3.5s VO silence] → "January 10th, 1870…" | chapter boundary "The War: Killing the Competition" | outgoing gold-pile scene ZOOMS OUT ~3.5s (reveal-by-widening ≈3%/s) → HARD CUT to black chapter card (white script title, static ~3s) → HARD CUT to close-up insert: desk calendar "JANUARY 1870", pen DRAWS a red circle around the 10 over ~1.0–1.25s as the date is spoken | massive LF boom-drone starts AT the cut to black, sustains under the whole card (spec_chapter, <3kHz, no VO); pen-scratch under the circle draw | chapter_01–36 (sheet_chapter.jpg), refineries_05–25 |
| E24 | 2 | 764.75–767.75s (12:45) | chapter break after "…that target was about to be painted red" → "The Ghost" | chapter idiom, part-2 variant | HARD CUT to black title card (title already fully set, no build-on) → hold ~2.25s with music drop + low bass swell → ~0.5s FADE-UP from black into the next scene (dark tableau brightens over 2 frames). Same idiom at 15:51 (e11_952s) | VO silent; low rumble swell through card, sparse piano on fade-up | e07_763s_4fps_08–20; e11_952s_4fps_08–12 |

### Held-set evolutions (2)

| # | Part | t | Narration beat | Behavior | Magnitude/easing | Lands on word | SFX | Frames |
|---|---|---|---|---|---|---|---|---|
| E12 | 1 | 443.0–471.5s | "It had three ruthless pillars. First, the rebate… Second, the spy network… And the kill shot? The drawback…" | ONE cream canvas, 28.5s, ZERO cuts (longest hold in part 1: 38s from 433). Sequence: shell-gag EXITS up while numbered coins 1-2-3 POP IN → rebate cluster accretes element-by-element → cluster slides off bottom-left; spy sheet pops + GROWS; red "SECRET" stamp; sheets fan → camera PUSHES INTO the report → full-frame table, red ovals DRAWN ON per column header phrase-by-phrase → zoom out → sheets exit; "THE DRAWBACK" + barrels pyramid; money bills physically FLY from competitor's barrel to smiling Rockefeller | pops 0.3–0.5s; exits slide 0.5–1s; draw-ons ~0.5s; push into table ~1.5s ease-in-out | every arrival syncs to its noun; the three red ovals land phrase-by-phrase | pluck/pop per entrance (~12–15 across section), high string pings during table zoom; no booms (booms reserved for chapter cards) | pillars_01–58 (sheet_pillars.jpg) |
| E25 | 2 | 671–678s (11:11–18) | "He bought the… barrels. He bought the warehouses. He even bought the chemical plants" | BOTH modes, split by scale: WITHIN a vignette, elements ADD LIVE on the held set (warehouses multiply 1→2→3 behind the handshake, pop/grow ~1s, figures + money bags hold); BETWEEN vignettes, no hard cut — lateral SLIDE-WIPE (old set exits left, new enters right, full width ~0.5s ≈ 200%/s) | pops snap→settle ~0.3s each; wipe fast linear; each vignette ~3s | YES — each wipe lands on the next "He bought…" item | soft whoosh under wipe; plucked-note pops with additions | e02_671s_3fps_01–27 (wipe mid-states at 10, 17) |

### Free picks (2)

| # | Part | t | Narration beat | Behavior | Lands on word | SFX | Frames |
|---|---|---|---|---|---|---|---|
| E13 | 1 | 0.0–8.7s | "This man controlled 90% of America's oil. And when the government shattered his empire to stop him, he actually became richer." | 9s cold open: five escalating sight-gag beats at ~1.8s/beat, each with a DIFFERENT motion device: (1) scroll UNROLLS into US map (~40% width/s); (2) cut to close-up: dark oil-stain GROWS radially ~25%/s to swallow the map — the stat painted as a spreading blot, not a counter; (3) speech bubble type-on "Destroy it now!"; (4) "EMPIRE" building DEMOLISHES (debris cloud pop + collapse ~1s); (5) cut to bowler-hat figure spotlit on rubble+money mountain, near-still — irony parked as a static tableau | stain grows on "90% of America's oil"; demolition on "shattered"; tableau holds under "became richer" | LF rumble under the stain, broadband explosion boom w/ heavy LF at 5.4–6.2s (spec_coldopen), shimmer under the money tableau | coldopen_01–27 (sheet_coldopen.jpg) |
| E26 | 2 | 1064.3–1071.7s (17:44–52) | "The trust was shattered into 34 separate pieces… Exxon, Mobil and Chevron" | Full kinetic sequence on ONE held cream set, zero cuts: "THE TRUST" circle GROWS in (~40→100% scale, 0.7s ease-out) → crack lines DRAW (~1s) → SHATTER: halves fall, fragments burst ballistically (~90%/s decelerating) and resolve into an arc of 34 small circles (~1s) → hold ~2s, one circle labels "Exxon" → circles CONVERGE/merge, label cycling Exxon→Mobil→Chevron (~1.3s) → stack SLIDES APART into a settled row of 3 logo circles | YES — shatter frame (1066.3s) on "shattered"; 34-formation completes on "34 separate pieces" | pop on entrance; clear crack/debris burst at shatter; riser before it | e12_1064s_3fps_02–27 |

## Combined rollup (0–1216s)

| Metric | Part 1 (0–608s) | Part 2 (608–1216s) | Combined picture |
|---|---|---|---|
| Median hold length | **3.0s** (mean 4.3s, p90 7s, n=143; scdet threshold 15) | **~4s** (mean 4.9s, min 1s, max 16s, n=118; scdet score ≥18) | ~261 cuts / 1216s ≈ **one cut per ~4.7s; median hold ~3–4s** (part 2 is slightly slower-paced AND used a stricter cut threshold — treat 3.0s/4s as bracketing values, not a drift claim). Longest holds: 38s (pillars canvas, 433–471), 19–22s (dialogue scenes), 16s max in part 2. |
| % holds with camera motion | ~20% of ~15 sampled held shots (eyeball method; static-by-default, motion reserved for reveal-by-widening/vista mood) | **~90% of PICTORIAL holds** (6/6 pixel-diffed pictorial holds moved, 0.3–8%/s; **0/3 text/diagram cards moved**; part 2 EXCLUDED text cards from its denominator and used PSNR/pixel-diff) | **Definitions differ — do not average.** Reconciled: (a) text/diagram/chapter cards are dead-static in both parts; (b) under pixel-diff, essentially every PICTORIAL hold carries at least a micro-drift (0.3–1.5%/s push/track — below what part 1's eyeball method could detect); (c) overt, purposeful camera moves (≥3%/s zoom-out, tracking, push) remain the minority, roughly the ~20% part 1 saw. Working rule: **cards frozen; pictures never fully frozen (micro-drift floor); big moves rare and motivated.** |
| % holds with element motion | 100% — every hold has at least idle-level element life (tremble/wobble lines, smoke, type-on, prop bob); dead frames do not occur | 100% of 14 sampled windows (action-loop, mouth-loop, type-on, pop-in, draw-on, glow pulse); only black type-on cards are otherwise static — and those carry live typing | **100% across the whole video. Dead frames are unrepresentable in this grammar.** |

**Entrance vocabulary — summed counts (sampled windows, both parts):**

| Entrance style | P1 | P2 | Total | Where seen |
|---|---|---|---|---|
| Typewriter type-on (cards, quotes, speech bubbles, labels) | 8 | 7 | **15** | quote/name cards, speech bubbles, interstitial pivot cards, map labels, strike-list |
| Pop/grow-in (diagram elements, icons, buildings, circles) | 10+ | 6 | **16+** | pillars canvas, warehouses, refinery icon, trust circle, captions |
| Draw-on (lines, circles, cracks, parcels, painted letters) | 4 | 5 | **9** | PROFIT chart, red circles/ovals, rails, parcels, cracks, "8 CENTS" |
| Slide/swing/toss-in | 4 | 3 | **7** | paddle, book, oats panel, shell exit, newspaper toss, vignette wipes |
| Fade-in | 2 | 3 | **5** | date stamps, ghost dissolve, octopus, chapter fade-ups, white-flash resolve |
| Unroll | 1 | 0 | **1** | cold-open scroll→map |
| Page-flip | 1 | 0 | **1** | calendar Feb→Mar 1872 |
| None (pre-set, revealed by insert cut) | 0 | 2 | **2** | scroll close-up, pipeline wide |

**Transition inventory — union of ALL non-cut devices (plus the cut):**

| Device | Where | Notes |
|---|---|---|
| Hard cut | dominant everywhere: ~143 (p1) + ~118 (p2) ≈ **261**, one per ~4.7s | **Zero crossfades between regular narrative shots anywhere in 20:16.** |
| Black quote/chapter card insert (cut in, cut out) | p1: 191.5→195, 351.5→354, 362→366.5, 609.3→612.7 | white script types on at VO pace ~12–15 chars/s; cut out ON next scene's first word |
| Black type-on interstitial card (the VO's pivot sentence) | p2: 709, 734, 746, 803, 893 | same family as above; doubles as transition + attention reset |
| Chapter card + boom + FADE-UP (~0.5s) | p2: 12:45 ("The Ghost"), 15:51 ("The Leak") | p1's chapter card (385s) cut out hard; p2's variant fades up from black — both carry an LF boom/bass swell |
| In-scene calendar page-flip | p1: refineries_08–10 (~0.7–1.0s curl) | time-lapse on a held set |
| Ghost-dissolve time-lapse overlay | p1: refineries_17–25 | spinning clock face over refinery silhouettes fading in/out |
| Sub-second date-stamp fade-ins | p1: 19.5s + others | bottom-right, ~0.5s |
| White-flash flashback dissolve | p2: 965.3–966.3s ("Decades earlier…") | bleach to near-white ~0.7s, resolve ~0.3s, palette desaturates grey-blue for the past; shimmer swell (sfx_s14) |
| Lateral slide-wipe between montage vignettes | p2: 11:14, 11:16 | full width ~0.5s (≈200%/s); each wipe lands on the next list item |
| Element swap on a held canvas | p1 pillars (E12), p2 vignettes (E25) | clusters slide out / pop in — the set persists, contents change |

**Chart/map behavior (both parts agree):** never static, never pre-complete. Structure arrives first (route, empty canvas, blank circle), then POPULATES live in waves — draw-on lines (~40–50% width/s tip speed) + pop-in icons + typed labels — each wave timed to its spoken noun, emphasis red LAST as the punch (red parcels on "bought", red ovals phrase-by-phrase). Draw-ons ride a pitch riser. Values grow sequentially (coin stacks). Numbers are never overlay text — always painted/circled/printed on in-world props (paddle, sign, calendar, newspaper).

**Type observations (merged):** ONE handwritten marker-script family carries everything — chapter cards, quote/interstitial cards, name cards, date stamps, map labels, speech bubbles. White on black for cards/quotes; dark ink on parchment/paper/props; sentence case; no outline; no drop shadow. Diagram labels: small-caps dark olive in boxed strips on cream. Newspaper headlines: heavier condensed hand-serif, ALL-CAPS. **Red is the only emphasis/annotation ink** (circles, ovals, SECRET stamp, strikethrough, ownership parcels). Text is almost always REVEALED (typed ~12–15 chars/s, painted, drawn) rather than popped whole; the only pre-set text is chapter titles and in-prop print revealed by insert cut.

**Top re-usable mechanics — union, tied to beat types:**

| # | Mechanic | Beat type | Recipe |
|---|---|---|---|
| 1 | Word-synced black quote/pivot card | pivot / thesis / verdict line | hard cut to black; the VO's exact sentence typewriters on at VO pace (~12–15 chars/s, tick foley, music thinned; line erases + retypes for sentence 2); hard cut out ON the next scene's first word. Doubles as transition + attention reset so the next slate lands harder. |
| 2 | Held-canvas enumeration | multi-part mechanism / list | one cream canvas held 20–40s, zero cuts; parts pop in one-per-noun (0.3–0.5s spring), clusters slide out between parts, red annotation draws on live, objects physically travel to animate the mechanic (money flying to Rockefeller). Pluck/pop foley per entrance. |
| 3 | Silence → riser → prop reveal → reaction cut | number / reveal | mix dips ~2s pre-reveal (to ~−40dB), a 1.5→8kHz sweep rides the object swinging in from off-frame (~0.75s, spring settle), a hit lands on the spoken number, then cut to a held reaction face. |
| 4 | Live-populating diagram synced to nouns | scale / expansion / data | structure first, then waves of draw-on lines + pop-in icons + typed labels, each wave landing on its spoken word, emphasis red last. ~1.5–2.5s populate, density accelerating; zero camera motion needed. |
| 5 | In-world number + contrast cut | the biggest number | the figure is physically made on set (painted "8 CENTS", red-circled date, tossed front page) with ease-out + foley landing on the spoken number; then an immediate hard CONTRAST cut (poor cubicle → gold mountain) lets juxtaposition, not motion, deliver the weight. (Sibling of #3: same in-world-number rule, different closer.) |
| 6 | Kinetic concept-sequence on one held set | abstract structural event (breakup, merger, split) | grow-in → draw-on cracks → ballistic shatter → re-formation → converge/relabel → settle, ~7s, zero cuts, every keyframe landing on its spoken word (E26); the concept is choreographed as physics instead of cut apart. |
| 7 | Escalation run of held slates | mounting evidence / fame / repetition | 3 consecutive same-species slates (~2.3s each, micro-push 0.5–1%/s), each raising the claim, capped by a toss-in + the contrast cut (E23). |

## AUDIO ROLLUP — full track (0–1216s)

*(Carried verbatim from part 1, which measured the full track.)*

**Music**
- Present: YES, effectively wall-to-wall. A staccato plucked-strings/pizzicato driving bed with constant fine onset striping across the entire 20:16 (spec_full_firsthalf / spec_full_secondhalf), including under dialogue and diagram sections.
- Continuous vs per-act: one continuous-feeling bed at dead-flat level — 30s RMS sits at −20.5±1.5dB for the whole runtime (measured trace above; LUFS integrated −18.4, loudness range only 3.7 LU). Act changes are marked not by level but by TEXTURE STINGS at chapter boundaries: a cymbal-swell wash decaying under the "The Trap" card (17–19s) and a huge low-frequency boom-drone (<3kHz) sustained under the "The War" card (385.6–388.1). The ad read (~525–601s) is the one texture break: brighter, cleaner voice-forward mix.
- Mood per act (as far as measurably supportable): the bed keeps one tense, driving, neutral-dark staccato character throughout part 1 and part 2's spectrogram texture matches; gravity beats are carved with silence and LF boons rather than a new cue. (Finer genre/mood labels per act are not extractable from spectrograms alone — flagged as a limit, not a finding.)
- Level under VO: assertive — only ~2–4dB under speech peaks; the mix never idles.
- Dropouts / silence as device: NO real dropout anywhere (nothing below −40dB for even 0.3s except the ad→story seam at 601.9–602.6 and the outro at 20:13). Instead: **sub-second beat-pauses** (~0.5–0.7s, full mix dips) placed exactly on story gravity/reveal points — measured at 1:09, 1:17 ("I cheat my boys…"), 2:05 (before "He abandoned his family"), 3:00, 4:32 ("the room went dead silent" — mix literally obeys the line, −44.8dB), 4:48 ("I'm done."), 4:56, 5:38, 11:19. Silence is a scalpel (≤1s), never a mood section.

**SFX**
- Inventory observed (spectrogram-verified): explosion/demolition boom (5.7s), body-impact thud (88.5s, −16.9dB spike), riser sweeps (chart draw-on 349.6–350.5; reveal swing 277.3–278.1), LF boom-drone stingers (chapter cards), typewriter ticks pacing every type-on (~12/s, matching char rate), pluck/pop per diagram-element entrance, pen/pencil scratch under draw-on annotation (388.8–390, 613), page-flip flutter (604), clock ticking under the time-lapse (609–610.3), ambient beds swapped per scene (birdsong at the village 19.3+, wind at the skyline 366.6+), shimmer under money tableaus. Not heard in part 1: boing, record-scratch, ding-as-such.
- Density: high — during diagram/build sections ~25–30 transients/min (12–15 pops in the 29s pillars canvas); dialogue/tableau scenes ~5–10/min. Overall the track averages roughly 10–20 SFX events/min.
- What gets SFX vs silent: every ENTRANCE, DRAW-ON, IMPACT and REVEAL gets a transient; camera micro-moves, idle wobble, and date-stamp fades stay silent (no visible transient at those moments).
- SFX without motion (audio-only emphasis): YES — the static chapter title card carries a 2.5s LF boom-drone while nothing moves on screen (385.6–388.1); stings also land on held reaction faces (280.5). Audio does the emphasis work whenever the frame deliberately freezes.

**Audio evidence files:** spec_full_firsthalf.png (whole track), spec_full_secondhalf.png (608–1216s), spec_/wave_{coldopen,cutA,cutB,cutC,father,chair,ledger,auction,skyline,chapter,pillars,refineries}.png, plus RMS traces quoted inline (30s full-track; 0.5s-resolution at 268–284s and 84–92s).

*Part-2 SFX corroboration (from its own spectrogram reads, sfx_s01–s14): typewriter ticks on cards, whoosh under slide-wipes, slap on the newspaper toss, crack/debris burst + riser at the trust shatter, descending stabs under map populate, rumble swell + sparse piano at chapter fade-ups, shimmer swell on the white-flash flashback — all consistent with the part-1 inventory; no contradictions.*

## Spot-check (post-merge verification, 2026-07-08)

Two events re-pulled at random (one per part) directly from the cached MP4 with ffmpeg (no timestamp offset on direct extraction). Frames in `frames/crayon--rockefeller--spotcheck/`; frame N = window start + (N−1)/4 s.

| Check | Event | Re-pulled frames | Logged claim | Observed | Verdict |
|---|---|---|---|---|---|
| A | E5 — ledger book entrance @153.0s (part 1) | spotA_152s_4fps_01–12 (window 152.0–154.75s) | prop snaps in ≤0.33s (bakery scene → full-frame open book), pre-written "TODAY'S EXPENSES" + 4 line items (no draw-on), then damped rock/settle ~2s | frame 06 (153.25s) = bakery scene, Rockefeller holding the small red book; frame 07 (153.5s) = full-frame open book, all 4 expense lines already written (Bread 10¢ / Coffee 5¢ / Newspaper 2¢ / Tram Ticket 5¢); frames 07→08→10 show the book's tilt angle oscillating then settling upright — entrance within 1 frame @4fps, pre-written text, damped rock all confirmed | **PASS** |
| B | E18 — newspaper toss @1109.3s (part 2) | spotB_1108s_4fps_01–12 (window 1108.0–1110.75s) | paper tossed up from bottom of frame ~80% height in ~1s, slight rotation on landing, ease-out (big first step, settles), lands as sole mover on empty wood table, "NATIONAL NEWS / WORLD'S FIRST BILLIONAIRE" hand-serif all-caps | frame 05 (1109.0s) = bare wood table, masthead edge just entering at bottom; 06 (1109.25s) ≈40% in, tilted; 07 (1109.5s) ≈70% in; 08–09 (1109.75–1110.0s) settled — displacement per frame shrinks 05→09 (ease-out), tilt angle changes as it lands (rotation), headline text exactly as logged, nothing else moves | **PASS** |

Both checks PASS — mover, direction, entrance style, easing character, and text content all match the logged observations. The merged log stands as written.
