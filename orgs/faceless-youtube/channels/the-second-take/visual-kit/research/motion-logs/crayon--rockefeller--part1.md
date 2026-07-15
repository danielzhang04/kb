# Motion + audio teardown — Crayon Capital, "Rockefeller: The First Confirmed Billionaire"

- **Video:** Crayon Capital — *Rockefeller: The First Confirmed Billionaire (And How He Did It)*
- **URL:** https://www.youtube.com/watch?v=sMH8WchxQR8 (1216s, 854x480 source sampled, 30fps)
- **Range:** 0s–608s (part 1 of 2; seam sampled to ~615s)
- **Date:** 2026-07-08
- **Method note:** the claude-video-vision MCP server crashed after one retry; all evidence below was extracted directly from the plugin's cached MP4 (`~\.claude-video-vision\downloads\60dd9ed6e0e9-sMH8WchxQR8.mp4`) with ffmpeg — frame bursts at 2–4 fps + per-event spectrograms/waveforms + RMS traces. Timestamps were ground-truthed against the auto-caption track (frame content matches caption timing exactly; no offset found). All frames/audio images live in `frames/crayon--rockefeller--part1/` next to this file; per-frame time = window start + (N−1)/fps.

## Events table (13 events)

Frame filenames refer to `frames/crayon--rockefeller--part1/`. "Sheet" = the tiled contact sheet built from the same frames.

### Hard cuts (3)

| # | Field | E1 — hook → chapter card → story | E2 — quote card → oil strike | E3 — quote card → skyline vista |
|---|---|---|---|---|
| | Timestamp | 19.0s (cut at title→village) | 195.0s | 366.5s |
| | Narration | VO silent over title card, cut lands as "July 8th, 1839, Richford, New York" begins | "…It was safe and steady." → "Then 1859 happened, the Pennsylvania oil strike" | "…he looked at his surroundings." → "As he stood over the smoky skyline…" |
| | Mover | cut only (camera static both sides) | cut only | cut only |
| | Direction/magnitude | n/a — full-frame content swap; black card → full-color aerial (max luminance jump) | black card → bright cream daylight derrick; max luminance jump | black card → sepia industrial vista |
| | Easing | snap (single frame; ≤0.25s bound at 4fps) | snap | snap |
| | Move duration | 1 frame | 1 frame | 1 frame |
| | Entrance at cut | date/place stamp "July 8, 1839 / Richford New York" FADES IN bottom-right over ~0.5s after the cut (cutA_09 absent → cutA_11 faint → cutA_13 full) | "1859" script date is already on at first frame; oil GUSH animates 0.5s after cut (cutB_17→20 black blob grows/drips) | none — scene arrives whole |
| | Lands on word? | YES — cut lands exactly on "July 8th" (first VO word after 4.5s of silence) | YES — on "Then 1859 happened" | YES — on "As he stood" |
| | SFX | cymbal-swell wash decays to near-dark across the card, then birdsong ambience enters with the village (spec_cutA: smooth broadband wash 0–2.1s, chirp squiggles 3–4.4kHz after 2.15s) | sustained pad-only dark zone 194.3–195.2 then dense onset + LF gush rumble/splats 195.5–197 (spec_cutB) | whoosh/wind swell right at the cut, wind-noise wash under the vista (spec_skyline 4.6–4.9s onset) |
| | Text treatment | title card: white handwritten-script, sentence case, no outline, centered on black, drifts DOWN slowly during its ~2s hold (cutA_01–08) | "1859" white script top-right; "PENNSYLVANIA" dark serif-ish sign in-scene | card text white script (see E11) |
| | Idle vs active | title text = only thing alive (slow drift); after cut: wagon travels, slight push-in, all idle-level | after cut derrick static, only the oil animates | after cut smoke drifts, figure idles |
| | Frames | cutA_01–cutA_18 (sheet_cutA.jpg) | cutB_13–cutB_20 (sheet_cutB.jpg) | skyline_13–skyline_16 (sheet_skyline.jpg) |

### Element entrances (3)

| # | Field | E4 — TEXT: name card type-on | E5 — PROP: expenses book swing-in | E6 — CHARACTER(S): diagram figures pop-in |
|---|---|---|---|---|
| | Timestamp | 39.2–40.8s | 153.0–155.3s | 446.5–452.5s |
| | Narration | "William Avery Rockefeller, known to locals as Devil Bill" | "recording every single penny… in a small red book he called ledger A" | "First, the rebate…" (pillar 1 of 3) |
| | Mover | element (text) | element (prop) | elements (label + 2 figures + money + barrels + % tag) |
| | Direction/magnitude | in-place, letter-by-letter L→R; full name (25 chars) in ~1.7s ≈ 15 chars/s | book swings up into frame filling ~80% of width in ≤0.33s (absent at ledger_10, fully in at ledger_11), then rocks/settles ~2s | each element pops from ~0 to full scale in ~0.3–0.5s, one at a time: label → handshake pair (center) → money pile (bottom-L) + barrel (bottom-R) → barrels ×3 → % tag |
| | Easing | linear tick-rate (typewriter) | snap-in + damped rock (spring settle: book angle oscillates ledger_11→13→15) | pop with slight grow-overshoot (spring) |
| | Move duration | ~1.7s | entrance 1 frame @3fps (<0.33s); settle ~2s | ~0.3–0.5s each; cluster accretes over ~6s |
| | Entrance style | type-on | swing/pop-in | pop/grow, sequential |
| | Lands on word? | YES — name completes as "Devil Bill" is spoken | YES — book lands on "small red book" | YES — each element lands with its noun ("rebate" → handshake; barrels on "every barrel he shipped") |
| | SFX | deep boom + tick transients under the type-on (spec_father 5.2–5.6s: repeated ticks + LF hit) | broadband + LF thump at 153.3–153.5 (spec_ledger) = book plop | pluck/pop transient per entrance (spec_pillars: ~12–15 discrete pops across the canvas section) |
| | Text treatment | white handwritten-script, sentence case, centered on solid black, no outline | in-book text: dark handwritten face, "TODAY'S EXPENSES" + 4 line items, pre-written (no draw-on) | label "THE REBATE" small-caps dark olive in a boxed strip, types/pops at top |
| | Idle vs active | text only active thing on black | book is the frame; nothing else | canvas static; only the entering element moves, previously-landed elements hold |
| | Frames | father_15–father_22 (sheet_father.jpg) | ledger_10–ledger_17 (sheet_ledger.jpg) | pillars_08–pillars_20 (sheet_pillars.jpg) |

### Camera behaviors during held scenes (2)

| # | Field | E7 — high-chair scene (static cam) | E8 — smoky-skyline vista (micro push + layer drift) |
|---|---|---|---|
| | Timestamp | 81.7–88.0s | 366.7–371.7s |
| | Narration | "One day, Devil Bill placed young John on a high chair. 'Jump, son! I'll catch you!'" | "As he stood over the smoky skyline, he saw hundreds of small inefficient refineries…" |
| | Mover | NEITHER camera nor layout — character idle only | camera (micro) + background layer |
| | Direction/magnitude | camera 0%/s across a 3s close hold AND a 3s wide hold; John trembles in place (~1–2% positional jitter per frame, wobble lines drawn on) | slow push-in ≈ 3–5% total over 5s (<1%/s); smoke plumes drift up-right ~2–3%/s continuously |
| | Easing | hold | linear drift (no ramp detectable) |
| | Move duration | two holds ≈ 3s each, then action resolves in ~0.7s (see E13 note) | ≥5s continuous |
| | Entrance style | none | none |
| | Lands on word? | the held tension parks across the whole quote; the JUMP resolves right after "I'll catch you" (chair tips + fall at 88.3–89.0, chair_22–25) | n/a — hold is the point |
| | SFX | beat-pause dip at 87.0–87.5 (RMS −37dB) before the jump; big LF impact thud at 88.5 (RMS spike −16.9dB; spec_chair 4.5–5.0s yellow LF burst) as John hits the floorboards | wind-noise wash sustained under the vista (spec_skyline) |
| | Text treatment | dialogue as small white script line top-center, pops on as a full line (chair_13 absent → chair_14 full) | none |
| | Idle vs active | active: John's tremble only; Bill statue-still (contrast is the composition) | active: smoke layer + coat sway; everything else frozen |
| | Frames | chair_03–chair_30 (sheet_chair.jpg) | skyline_15–skyline_30 (sheet_skyline.jpg) |

### Chart/diagram appearance (1)

**E9 — PROFIT line chart draws on — 349.25–351.25s**
- Narration: "…he could sell his oil cheaper than anyone else and still make a profit."
- Mover: element. The previous flowchart (FACTORY → ~~MIDDLEMAN~~ → COST, red strikethrough) clears; on the same cream canvas a hand-drawn line chart DRAWS ON left→right: cutC_02 short stroke → cutC_04 S-curve ~70% drawn + first coins → cutC_07 arrow-tip flick + "PROFIT" label typing (P→PRO→PROFI→PROFIT) → cutC_08 complete with 4 coin stacks grown left-to-right in sequence.
- Magnitude/easing: line tip travels ~60% of frame width in ~1.25s (~50%/s), continuous linear draw with a fast arrow flick at the end; coin stacks grow-in sequentially (bar-growth idiom); label types on at ~10 chars/s.
- Lands on word: YES — chart completes on "profit".
- SFX: clear rising pitch-sweep under the draw (spec_cutC: curved trace ~1.2kHz→6kHz across 0.6–1.5s) — draw-on gets a riser.
- Text: "PROFIT" white-on-cream handwritten caps, no outline.
- Idle vs active: canvas otherwise empty; only the drawing line, growing stacks, typing label.
- Frames: cutC_01–cutC_10 (sheet_cutC.jpg). Verdict: **charts draw on live, never pop in whole; values (coins) grow sequentially.**

### Emphasis beat (1)

**E10 — the $72,500 auction reveal — 276.0–280.5s**
- Narration: "Until — 72,500." (after "The room went dead silent… certain he'd just won")
- Mover: element (prop) + edit pattern. Build: Clark's own paddle LOWERS slowly out of frame over ~1.5–2s (auction_09–15, linear sink ≈10%/s) → cut to smug Clark hold (auction_17–21) → dark crowd frame, then John's "$72.500" paddle SWINGS UP from bottom-left off-frame into a full-frame close-up: edge enters auction_23 (277.5), fills center by auction_26 (278.25) — travels ~70% of frame height in ~0.75s (~90%/s) with slight rotation settle (spring overshoot) → holds huge 1.5s → cut to Clark shock face with sweat drop + trembling mouth (auction_33–38).
- Easing: spring (fast in, small rotational settle).
- Lands on word: YES — paddle arrives exactly on the spoken "72,500".
- SFX (measured): near-silence 269.5–270 (−44.8dB, "dead silent"), tense quiet −34..−39dB through 274–276.5, RISING SWEEP ~1.5kHz→8kHz at 277.3–278.1 under the swing (spec_auction curved trace), loud hit −18.6dB on arrival, sting on the shock-face cut (280.5). **Silence → riser → hit → reaction is the number-selling grammar.**
- Text: number lives ON a diegetic prop (auction paddle, dark script on tan), not an overlay.
- Idle vs active: crowd silhouettes frozen; only the paddle moves.
- Frames: auction_09–auction_38 (sheet_auction.jpg); RMS trace in report above.

### Scene-to-scene transition (1)

**E11 — chapter boundary "The War: Killing the Competition" — 385.25–389.5s**
- Narration: "…and I will be the one." → [3.5s VO silence] → "January 10th, 1870…"
- Idiom confirmed: HARD CUT to a black chapter card (white handwritten-script title, centered, static ~3s) → HARD CUT to a close-up insert (desk calendar "JANUARY 1870") where a pen DRAWS a red circle around the 10 over ~1.0–1.25s (chapter_28 no circle → chapter_29 arc → chapter_33 closed) as the date is spoken. Before the card, the outgoing gold-pile scene ZOOMS OUT slowly for ~3.5s (chapter_01–14, reveal-by-widening ≈3%/s).
- Non-cut devices found in range (the only ones): (a) calendar PAGE-FLIP Feb→Mar 1872 on a held set, ~0.7–1.0s curl (refineries_08–10); (b) GHOST-DISSOLVE time-lapse — spinning clock face overlaid on refinery silhouettes that fade in/out (refineries_17–25, opacity transitions, hands spin ~1 revolution/0.7s); (c) sub-second date-stamp fade-ins. **No crossfades or wipes between narrative scenes anywhere in part 1 — cuts only.**
- SFX: massive LF boom-drone starts AT the cut to black and sustains under the whole card (spec_chapter 3.6–6.1s, energy almost all <3kHz, no VO); pen-scratch transients under the circle draw (6.6–7.6s).
- Frames: chapter_01–chapter_36 (sheet_chapter.jpg), refineries_05–25 (sheet_refineries.jpg).

### Held-set evolution (1)

**E12 — the "three ruthless pillars" diagram canvas — 443.0–471.5s (28.5s, ONE continuous canvas, zero cuts — the longest hold in part 1 per scene-change data: 38s from 433)**
- Narration: "It had three ruthless pillars. First, the rebate… Second, the spy network… And the kill shot? The drawback…"
- Verdict: **the channel MOVES/POPS elements live on the held set — it does not cut to changed states — whenever it is in diagram mode.** Sequence, all on the same cream canvas:
  1. shell-company sight gag (conch shell w/ buildings inside) EXITS upward off-canvas while numbered coins 1-2-3 POP IN sequentially (pillars_01–04);
  2. coins park at top; "THE REBATE" label + handshake pair pop center; money pile, barrels ×3, "%" tag accrete one-by-one (pillars_08–20);
  3. rebate cluster EXITS (slides off bottom-left), spy-network sheet pops in small and GROWS; red "SECRET" stamp lands; sheets multiply + fan (pillars_21–30);
  4. camera pushes INTO the report → full-frame table (COMPETITOR / DESTINATION / BUYER / PRICE PER BARREL), red ovals DRAWN ON around each column header as VO says "where they were shipping, who they were selling to, and at what price" (pillars_31–38) → zoom back out;
  5. sheets exit; "THE DRAWBACK" label + barrel pop in; barrels stack into a pyramid while money bills physically FLY from the competitor's barrel side to smiling Rockefeller (pillars_43–58) — the mechanic animated as object motion.
- Magnitude/easing: entrances pop/grow 0.3–0.5s; exits slide 0.5–1s; annotation draw-ons ~0.5s each; camera push into table ~1.5s ease-in-out.
- Lands on words: every arrival syncs to its noun; the three red ovals land phrase-by-phrase.
- SFX: pluck/pop per entrance (~12–15 across the section), sustained high string pings during table zoom; no booms (booms are reserved for chapter cards).
- Text: labels small-caps olive in boxed strips; table in handwritten face; ALL annotation red.
- Frames: pillars_01–pillars_58 (sheet_pillars.jpg).

### Free pick (1)

**E13 — the 9-second cold open (0.0–8.7s): five escalating sight-gag beats before the title**
- Narration: "This man controlled 90% of America's oil. And when the government shattered his empire to stop him, he actually became richer."
- The section's most distinctive move: a claim→visual-pun chain at ~1.8s per beat, each beat's motion device different:
  1. scroll UNROLLS into a US map on the desk (coldopen_01–04, unroll L→R ~40% width/s);
  2. cut to map close-up: dark oil-stain GROWS over the map to swallow it as "90%" reads (coldopen_07–11, radial grow ~25%/s, linear) — the stat is painted as a spreading blot, not a counter;
  3. speech bubble type-on "Destroy it now!" (coldopen_14–16);
  4. "EMPIRE" building DEMOLISHES — debris cloud pops + expands, building collapses in ~1s (coldopen_18–20, snap + expanding cloud);
  5. cut to bowler-hat figure spotlit on a rubble+money mountain, holding a money bag, near-still (coldopen_21–27) — irony parked as a static tableau.
- Lands on words: stain grows on "90% of America's oil"; demolition lands on "shattered"; tableau holds under "became richer".
- SFX: LF rumble under the stain grow (~1.8–2.2s), broadband explosion boom w/ heavy LF at 5.4–6.2s (spec_coldopen yellow bottom band), shimmer under the money tableau.
- Text: speech-bubble dark script in white bubble, type-on; map label "Empire of Oil" + "90%" handwritten olive.
- Frames: coldopen_01–coldopen_27 (sheet_coldopen.jpg).

## Part-1 rollup (0–608s)

| Metric | Measured value |
|---|---|
| Median hold length | **3.0s** (scene-change threshold 15, deduped; mean 4.3s, p90 7s, n=143 cuts in 608s) |
| Longest holds | 38s (the pillars diagram canvas, 433–471); 19–22s (dialogue scenes ~74–96s, ~203–224s); everything else ≤14s |
| % of sampled holds with camera motion | ~20% (3 of ~15 held shots: gold-pile zoom-out, skyline micro-push, village drift; camera is STATIC by default — motion is reserved for reveal-by-widening or vista mood) |
| % of sampled holds with element motion | 100% — every hold has at least idle-level element life (tremble/wobble lines, smoke, speech-bubble type-on, prop bob); dead frames do not occur |
| Entrance vocabulary (counts across sampled windows) | type-on text ×8 (quote cards, name card, speech bubbles), pop/grow-in ×10+ (diagram elements), draw-on ×4 (PROFIT line, red circle, red ovals, checklist ticks), slide/swing-in ×4 (oats panel, paddle, book, shell exit), unroll ×1, page-flip ×1, fade-in ×2 (date stamps, ghost dissolve) |
| Transition inventory | hard cut (dominant, ~143 in part 1); black quote/chapter card inserts (cut in, cut out); in-scene page-flip; ghost-dissolve time-lapse overlay (clock + fading skylines); element swap on a held canvas. **Zero crossfades/wipes between narrative scenes.** |
| Chart/map behavior | always constructed live: line charts draw on (~50% width/s) with a pitch riser; values grow sequentially (coin stacks); annotations (red circles/ovals/strikethrough) are drawn on synced to VO; the 90% stat rendered as a growing stain on a map. Nothing pops in pre-built. |
| Type observations | one type family everywhere: white handwritten-marker/script, sentence case, no outline — black cards (chapter titles, VO-synced quote lines ~12–15 chars/s), name cards, date stamps (bottom-right, fade-in). Diagram labels: small-caps dark olive in boxed strips on cream. Dialogue: dark script inside white speech bubbles, type-on. Red = the only annotation color (circles, ovals, SECRET stamp, strikethrough). |
| Reusable mechanic 1 | **Word-synced black quote card** (beat type: pivot/thesis line): hard cut to black, white script types on at VO pace (~12–15 chars/s, line erases and retypes for sentence 2), hard cut out ON the next scene's first word. Used at 191.5→195, 351.5→354, 362→366.5, 609.3→612.7. |
| Reusable mechanic 2 | **Held-canvas enumeration** (beat type: multi-part mechanism/list): one cream canvas held 20–40s; parts pop in one-per-noun, clusters slide out between parts, red annotation draws on live, money/objects physically travel to animate the mechanic (E12). |
| Reusable mechanic 3 | **Silence → riser → prop reveal → reaction cut** (beat type: number/reveal): mix dips ~2s pre-reveal (to −40dB), a 1.5→8kHz sweep rides the object swinging in from off-frame (~0.75s, spring), a hit lands on the spoken number, then a cut to a held reaction face (E10). |

## AUDIO ROLLUP — full track (0–1216s)

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
