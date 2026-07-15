# Motion teardown — HeyHistorically, "This Country Disappeared 8 TIMES...." (Poland)

**Video:** F0_d1xjk2to · 21:06 (1266s) · LEARNINGS-ONLY channel (log mechanics to borrow, no wholesale imitation)
**Range:** 00:00:00–00:21:06 (full video, single agent)
**Method notes:** MCP video tools not mountable → identical pipeline run directly (ffmpeg scdet 480p → cut list; yt-dlp auto-captions → transcript; 3s @ 4fps 480p bursts per event; PIL per-frame-pair diff stats — %pixels changed + change bbox; ffmpeg silencedetect/ebur128 on the extracted track; Gemini API via curl on a 32kbps mono mp3 of the full track). **This is a RELAUNCH:** a prior agent's verified artifacts were reused — full scdet cut list (171 cuts, full range), transcript, extracted audio, and 13 pre-extracted event bursts in `_frames/hh-disappeared/` (all checked against the transcript + diff-measured before use). Two bursts (e00a, e05b) newly extracted this run to satisfy the first-60s entrance directive and to capture the held-set evolution properly.
**Tool failures:** gemini-3-flash-preview 503 twice → fell back to gemini-2.5-flash; first fallback hit MAX_TOKENS (thinking ate the budget), second returned a MUSIC section that corroborates the measured silence dips but then **degenerated into hallucinated timestamp spam for the SFX/event-check/voice sections** → those sections discarded (see honesty). Per-event SFX therefore mostly "unchecked".

## Cut statistics (MEASURED, full 0–1266s)

| metric | value |
|---|---|
| cut count | **171** |
| median hold | **5.42s** |
| p25 / p75 hold | 3.17s / 10.17s |
| min / max hold | 0.03s / 36.53s |
| mean hold | 7.36s |
| holds >8s | **55** (32% of holds) |

Long tail is real: this channel holds a comedic tableau 8–36s while acting/props/type carry the frame, then bursts of sub-2s cuts inside gags. Raw cut list in the appendix.

## Event table (15 rows: 13 quota + e00b bonus + e05-orig reclassified; e13 measured-only)

| # | t | beat (transcript) | category | mover | what happens |
|---|---|---|---|---|---|
| e00a | 00:22.0 | "treated it like a resource vending machine" | element entrance (character) — **first-60s directive** | element | colonist character POPS in fully formed at frame-left of a held field scene |
| e00b | 00:56.3 | "bullied more than Poland" | bonus: word-prop scene arrival | both | hard cut lands on giant 3D "POLAND" letters with a character physically landing/squashing onto them |
| e01 | 00:16.0 | "But Korea wasn't wiped off the map" | hard cut (first 60s) | camera | jump-cut punch-in: same dark-study set, narrator ~30% larger + new pose |
| e02 | 01:40.3 | "welcome our recurring guest, Jesus Christ" | element entrance (character) | element | triptych panel EMPTIES, then a white light-burst materializes Jesus over ~1.5s (glow decays = ease-out) |
| e03 | 02:51.75 | "Bulisaf the brave had three sons" | camera during held scene | camera(cut)+bg | wide → hard punch-in to face close-up on dramatic radial bg; held ~1.5s with bg streaks animating, char static |
| e04 | 05:14.6 | "The Kingdom of Poland disappeared for the first time" | hard cut (+prop pop-OUT) | element→cut | model castle VANISHES from held set in ≤0.25s + corner HUD badge flips crown→skull; then hard cut to Casimir |
| e05 | 06:50–53 | "instead of a king, Poland got four of them" | (reclassified: hard cut macro→medium) | camera | macro close-up of floor cards → 77.5% hard cut to medium narrator; original held-set target missed, superseded by e05b |
| e05b | 06:53.9 / 06:55.3 | "four of them, and then eight, and then 12" | **held-set evolution** | element | on ONE held set, a fan of 4 king-cards POPS into raised hand (≤0.25s), then a 2nd fan POPS into the other hand — no cut, elements pop live |
| e06 | 08:07.25 | "Enter Vladislav the First" | element entrance (character, by cut-to-detail) | camera+element | tavern wide → 50% hard cut to extreme close-up of his fist; fist POUNDS table at ~08:08.5 (2-frame impact) |
| e07 | 09:37.5 | "multilingual, multiethnic, and massive" | chart/diagram | element | handheld chalkboard: handwritten labels + arrows appear ITEM-BY-ITEM synced to the spoken enumeration (~0.5s/item), each pops on whole |
| e08 | 11:34–37 | "a 5-year natural disaster. Warsaw burned" | camera during held scene | none→cut | dark atrocity tableau held near-static (1.2–1.6%/frame = torch flicker only); then 99% flash-white cut to map whose color saturates over ~0.5s; fire icon pops on Warsaw |
| e09 | 12:10.25 / 12:11 | "The Liberum veto" | element entrance (text) | element | "LIBERUM" STAMPS on (huge tilted caps), then "VETO" stamps lower-right on the second word — two-stage, screen-dominating |
| e10 | 13:11.75–12.5 | "First partition, boom, 30% of Poland is gone" | emphasis beat | element | giant hand+meat cleaver slides in from right (~0.5s), CHOPS across map-Poland leaving a permanent slash scar, exits immediately |
| e11 | 16:57.75 | "And now we have the worst, Russia" | hard cut (act boundary: bad→worse→worst) | camera | comedic land-auction ("Sold") → 84% hard cut to desaturated empty-village panorama + slow drift; register flip sold by the cut |
| e12 | 19:06–10 | "Poland is gone again. Seventh time, by the way" | scene-to-scene transition + chapter boundary | element(HUD) | graveyard-in-rain tableau HELD (rain streaks 2.5–4%/frame); the corner disappearance-counter badge flips 7→skull ON the line; no non-cut transition device found anywhere |
| e13 | 20:56–59 | "They all fell apart. But Poland, it's still here" | free pick: ending montage | camera/element | diff-measured only (steady 11–14%/frame = continuous montage motion, full-width), frames extracted but NOT visually verified — see honesty |

### Per-event detail (frame-cited)

- **e00a — colonist pop-in, 00:22.0.** Burst 20.0–23.0 @4fps (`e00a-vending_01–12.jpg`). Frames 01–08: held field scene, 4 diggers idle-loop (5.6–9.6%/frame, full-frame bbox = gentle global wobble). Frame 08→09 (t≈21.75→22.0): colonist ABSENT → fully present at frame-left, laughing pose (13.9% change). **Entrance = snap/pop, ≤0.25s, no slide/scale-in visible at 4fps.** Frames 09–12: he holds, mouth-flap only. Easing: pop (HIGH conf — adjacent frames). SFX unchecked. Idle: diggers keep digging — entrance does not freeze the set.
- **e00b — "POLAND" letters, 00:56.3 (bonus).** Burst 55.0–58.0 (`e00b-poland_01–12.jpg`). Frames 01–05: two-character kick gag, motion confined to a 21%w bbox (limb animation only, 0.7–2.6%). Frame 05→06 (t≈56.0→56.25): hard cut to giant extruded "POLAND" (white "POL" + red "AND", ~70% frame width) with a character mid-air; 06→09 he lands/flattens onto the letters (16–17% full-width changes = letters jostle + body squash). Frame 09→10 (84.8%): hard cut out to dark room at 57.25 (matches scdet 57.2). Text: 3D extruded display caps, white+red (flag colors), no outline, baseline-bounced by the landing. Word-prop = the text IS the set.
- **e01 — jump-cut punch-in, 00:16.0.** Burst 13.5–16.5 (`e01-cut-korea_01–12.jpg`). Frames 01–10: dark-study narrator holds a raised-finger tableau ~2.5s; 2.9–4.6%/frame full-width = breathing/gesture idle. Frame 10→11 (26.0%): CUT to ~30% tighter framing, same set, new pose (hand to face). Frame 11→12: 6.8% settle. **The cut itself changes scale+pose, not location** — cheap re-energize inside one set. Measured near-silence dip at 16.5s lands ON this cut (music tacet under "But Korea wasn't wiped off the map" — corroborated by Gemini music pass). Easing: n/a (cut). 
- **e02 — Jesus light-burst entrance, 01:40.3.** Burst 99.5–102.5 (`e02-jesus-entrance_01–12.jpg`). Frame 01→02 (45.4%): the 3-panel triptych EMPTIES (all three figures vanish — clearing the stage on "welcome our recurring guest"). Frame 03→04 (19.6%, bbox 43%w centered): white light-burst erupts in the middle panel. Frames 05–10: glow decays stepwise (8.1→1.1→9.6→12.0→10.9→12.4% flicker) while the figure resolves; fully readable by frame 10 (t≈101.75). **Entrance = flash-materialize, ~1.5s, decelerating (ease-out via glow decay), no positional motion.** Corner HUD badge "1" stays idle. Text: none.
- **e03 — punch-in + animated background, 02:51.75.** Burst 171–174 (`e03-heldcam-sons_01–12.jpg`). Frame 03→04 (87.1%): wide king-table → face close-up on radial streak bg. Frames 05–09: character STATIC, radial bg streaks animate (3.4–4.8%/frame confined to a 61–64%w bbox). Frame 09→10 (59.1%): cut out to next gag. **Held-frame life = animated bg texture behind a frozen face, ~1.5s.** Camera itself does not move (bbox stable) — the "energy" is a background layer, not a zoom.
- **e04 — prop pop-out + counter flip + cut, 05:14.6.** Burst 313–316 (`e04-cut-restored_01–12.jpg`). Frames 01–07: church set held; Casimir's arm reaches to the model castle (8–12%/frame, bbox ~90%w incl. slow ambient). Frame 07→08 (t≈314.5→314.75, 9.4%): castle GONE + HUD badge crown→purple-skull in the same step. **Disappearance = snap pop-out ≤0.25s on the held set; the persistent corner counter is the state-change chart.** Frame 09→10 (59.9%): hard cut to paper-bag-crown Casimir waving (frames 10–12, 19.9–23.6% = arm wave).
- **e05b — held-set evolution (THE delta-chain/layer-move evidence), 06:53.9 & 06:55.3.** Burst 412.5–416 @4fps (`e05b-kings-multiply_01–14.jpg`). Frames 01–05: narrator holds an arms-out tableau (3.0–3.3%/frame, bbox 45%w = torso idle). Frame 06→07 (19.6%): fan of 4 king playing-cards fully formed in the raising left hand ("four of them"). Frames 08–11: hold with fan (10.6–11.5%). Frame 11→12 (22.9%, bbox widens to 76%w): second fan pops into the right hand ("and then eight"). **Verdict: the channel MOVES/POPS elements live on a held set — it does NOT cut to the changed state.** Pops complete within one 0.25s frame gap; the sell is the hand raise, not the element animating. Direct support for layer-move over cut-per-state.
- **e06 — entrance by cut-to-detail + impact, 08:07.25.** Burst 487–490 (`e06-vladislav-entrance_01–12.jpg`). Frame 01→02 (50.2%): tavern wide → extreme close-up of Vladislav's fist/forearm on table edge. Frames 03–06 hold (2.2–3.6%). Frames 07–08 (17.0%, 23.1%): fist lifts and POUNDS the table (impact spread over ~2 frames ≈ 0.5s, ease-in then hard stop). Frames 10–12: rest (2.2–2.6%). **A new character "enters" as an action close-up, not a pop-in** — introduction = what he does, not his face.
- **e07 — chalkboard enumeration, 09:37.5.** Burst 577–580 (`e07-map-commonwealth_01–12.jpg`; named for the expected map, actual content = chalkboard). Narrator holds a small chalkboard; handwritten "Multilingual" → arrow → "Multiethnic" → "Massive" (+ gag "Like yo mama") appear item-by-item: appearances register at frames 03 (11.8%), 04 (11.1%), 06 (9.2%) ≈ one item per 0.5s, each word pops on whole (no stroke-by-stroke draw at 4fps). Frame 06→07 (52.2%): hard cut to Poland-ball at table; frames 10–12 it raises fists (excited beat). Text: hand-marker class, white chalk on dark board, mixed case, arrows as connectors. HUD badge = green check ("beneficial disappearance").
- **e08 — dark-register held frame → flash cut to map, 11:34–37.** Burst 694–697 (`e08-heldcam-deluge_01–12.jpg`). Frames 01–09: night atrocity tableau (overturned cart, blood pool) held **eight+ seconds essentially static — 1.2–1.6%/frame, motion = torch flame + steam wisps only.** The register model in the wider project (comedy OFF on human cost) shows up as motion OFF too. Frame 09→10 (99.3%): cut lands as a white-washed map frame; 10→11 (81.4%): color saturates in; 11→12 (6.6%): fire icon pops at Warsaw ≈ on "burned". **Flash-white cut = the one non-plain-cut device found (still a cut, dressed with a 2-frame luminance settle).**
- **e09 — two-stage text stamp, 12:10.25 / 12:11.** Burst 729–732 (`e09-liberumveto-text_01–12.jpg`). Frames 01–05: parliament wide held (7.6–8.9% = torch flicker + figures idle). Frame 05→06 (21.1%): "LIBERUM" stamps on — white extra-bold caps, fat black outline, tilted ≈ −8°, ~60% frame width. Frame 08→09 (16.2%): "VETO" stamps lower-right, opposite tilt. Frames 10–12 keep 10.5–12.1%/frame → the type (and scene) keeps living after landing (jitter/pulse; overshoot not resolvable at 4fps — MED conf snap-with-settle). **Each word lands on its own spoken word.** Scene stays visible around the type; the words dominate but don't replace the set.
- **e10 — cleaver chop emphasis, 13:11.75–12.5.** Burst 791–794 (`e10-partition-boom_01–12.jpg`). Frames 01–02: full-color Europe map held, red Poland. Frame 03→04 (24.0%): giant hand+meat cleaver slides in from frame-right (~40%w travelled in ≤0.5s, ease-out into a poised hold). Frames 05–06 hold the threat (~1s). Frame 06→07 (14.1%): CHOP — blade crosses Poland, effort droplets, dark slash line appears; frame 08→09 (3.5%): cleaver already GONE, slash line REMAINS. Frames 10–12: held aftermath (3.4–3.9%). **Emphasis grammar: prop enters → beat of threat → single decisive action leaving a persistent scar → prop exits fast.** "boom" is the spoken anchor.
- **e11 — act-boundary hard cut + register flip, 16:57.75.** Burst 1016.5–1019.5 (`e11-cut-russia_01–12.jpg`). Frames 01–05: comedic auction tableau ("Sold" banner) held, 1.4–1.6%/frame. Frame 05→06 (84.4%): hard cut to a desaturated, washed-out empty village panorama. Frames 07–12: slow ambient drift (1.0–5.8%). Measured near-silence dip at 1020.4s ≈ 2.5s after the cut (music drop under "the worst, Russia" — MED conf). **The bad→worse→worst ladder is articulated purely by cut + palette + music-drop; no transition device.**
- **e12 — chapter boundary on a held set, 19:06–10.** Burst 1146–1149 (`e12-transition-gone7th_01–12.jpg`). Gag graveyard ("RIP", "RIP again", "Guess what? RIP", "Yeap RIP", "coming soon") in rain, HELD throughout the burst — 2.5–4.1%/frame = rain streaks + fog drift; no cut, no camera move. The corner disappearance-counter badge reads "7" (frame 01) and flips to the skull state by frame 09 — **the chapter turn is carried by the persistent HUD counter + the spoken "Seventh time, by the way," not by a scene change.** Measured near-silence dip at 1149.7s inside the beat.

## Per-chunk rollup

- **Median hold 5.42s** (p25 3.17 / p75 10.17; 55 holds >8s). Comedy-history pacing = long acted tableaux punctuated by sub-2s gag cut-runs.
- **% of sampled holds with camera motion: ~13%** (2/15 — e11 post-cut drift, e03's energy is a bg layer not a camera move; true camera moves are RARE; punch-ins are done as CUTS, not zooms).
- **% of sampled holds with element motion: 100%** — every held frame has life: character idle/acting (3–9%/frame), ambient flame/rain/steam (1–4%/frame), or live element pops. Dead holds do not occur.
- **Entrance vocabulary (counts across sampled events):** snap-pop fully-formed ×3 (e00a colonist, e05b card fans ×2) · flash-of-light materialize ×1 (e02) · cut-to-action-detail ×2 (e06 fist, e11 new-scene) · slide-in prop ×1 (e10 cleaver) · text stamp ×3 (e09 ×2, e07 items) · pop-OUT (exit) ×2 (e04 castle, e10 cleaver exit).
- **Transition inventory:** hard cut ≈100% of the 171 boundaries sampled/spot-checked; ONE dressed variant = flash-white cut with 2-frame color settle (e08, used entering the atrocity-map); zero fades/wipes/whips found. Chapter turns ride the persistent corner counter-badge + music drops, not transition devices.
- **Charts/maps behave as:** props and sets, not UI — maps are full-bleed sets that receive persistent scars (e10 slash), pop-on icons (e08 fire), and color washes; the one "diagram" is a handheld chalkboard whose labels pop on per spoken item (e07); the signature counter is a **persistent corner HUD badge with a state machine** (number → crown/skull/check per disappearance) updated ON the narration beat (e04, e07, e08 "4", e10 "5", e12 "7"→skull).
- **Type observations:** two registers — (1) screen-dominating stamp caps: extra-bold, white fill + fat black outline, tilted ±8°, one word per spoken word (e09); (2) diegetic/hand class: chalk marker on props (e07), 3D extruded word-props that characters physically interact with (e00b "POLAND"). No lower-third/caption layer at all.
- **3 most reusable motion mechanics (beat-tied):**
  1. **Live pop-on-held-set for enumerations** (e05b): keep ONE tableau, snap elements into the actor's hands/frame on each spoken count — never cut per state. Maps directly onto our layer-move/delta-chain plan (this is layer-move evidence).
  2. **Persistent corner state-badge** (e04/e12): a tiny always-on counter whose state flips exactly on the thesis beat — a Remotion-trivial device that converts a recurring theme ("disappeared again") into visible motion.
  3. **Prop-action emphasis with a persistent scar** (e10): enter prop fast → 1s poised hold → one decisive hit → prop exits, the MARK stays. Sells a number/loss without text; the residue keeps paying during the following hold.
- **Register-motion coupling** (bonus, matches our §2 dial): on human-cost beats the frame goes near-static (1–2%/frame ambient only, e08) and music dips; on absurdity beats motion density triples and pops cluster.

## Audio rollup (full track)

**Measured (HIGH confidence):** Integrated **−14.9 LUFS**, LRA **3.3 LU** (very compressed, constant-energy mix). True silence (−32dB ≥0.4s) only twice: 76.6s (post-title-card beat) and the end. Near-silence dips (−25dB ≥0.35s) at: **16.5** (music tacet on "But Korea wasn't wiped off the map" — lands ON the e01 cut), **76.5** (after "Historically facts, part 11" title card — chapter reset), 162.1 ("Slight problem though, brothers"), 260.8 (castration gag beat), 276.2 ("assassinated within a year"), 473.4 ("promptly forget to leave"), 538.9 ("Europe, Lithuania. The deal."), **796.4** (right after "boom, 30% of Poland is gone… 'Wait, what?'" — e10), 814.2 ("foaming at the mouth"), 932.2+933.8 (1867 pivot), 947.2 (West Berlin line), 962.6 (Breslau gag), **1020.4** ("the worst, Russia" — e11 act turn), **1149.7** ("gone again. Seventh time" — e12 chapter turn), 1264.6 (end). → **Dips are a deliberate device: they land on punchlines, reveals, and every act/chapter turn sampled.**
**Music (MED confidence — Gemini pass, kept only where it agrees with the measured dips):** continuous bed, mood re-cued per section (investigative synth intro → somber on suffering comparisons → sci-fi sting on the time-teleporter gag → epic hit on the title card → neutral-academic under exposition). Level under VO: present, not assertive. Dropouts confirmed at 00:13–16, 00:31–34, 00:47–52 (cough gag — comedic timing), 01:10–14 (pre-title anticipation), 02:31–35 ("same day that he died" irony), all serving punchline/reveal beats.
**SFX (LOW confidence / partially UNRELIABLE):** the Gemini SFX inventory degenerated into hallucinated every-2-seconds timestamp lists and was discarded. Plausible class names before degeneration (whoosh, pop/click, boing, riser, record-scratch, explosion/impact, sword, fire, crowd) are consistent with the genre but density/placement are NOT verified. Per-event SFX left "unchecked". No reliable evidence for SFX-without-motion.
**Voice (LOW confidence):** section lost to the same degeneration; from transcript alone: one narrator doing character voices, a staged coughing gag at 00:49 (with measured music dropout), reported-speech skits throughout.

## Per-event required-fields matrix

| # | mover | dir + magnitude | easing | move dur | entrance | on word | SFX | text | idle vs active | frames cited |
|---|---|---|---|---|---|---|---|---|---|---|
| e00a | element | pop in place, 0→full | snap/pop (HIGH) | ≤0.25s | pop | ~"vending machine" | unchecked | none | diggers keep idling | e00a-vending_08–12 |
| e00b | both | cut-in; char drop ~15%h | impact squash | ~0.75s | cut + physical landing | "Poland" | unchecked | 3D extruded caps, white+red, no outline | letters jostle, bg still | e00b-poland_05–10 |
| e01 | camera(cut) | punch-in ~30% scale | n/a (cut) | 1 frame | none | "wasn't wiped off" | music dip 16.5s (measured) | none | narrator idle 3–5%/frame pre-cut | e01-cut-korea_10–12 |
| e02 | element | materialize in place | ease-out glow decay (HIGH) | ~1.5s | flash/grow | "Jesus Christ" | unchecked | none | panels+badge static | e02-jesus-entrance_01–10 |
| e03 | bg layer | radial streaks, face static | linear loop | ~1.5s hold | cut | "three sons" | unchecked | none | face frozen, bg active | e03-heldcam-sons_03–10 |
| e04 | element | pop-out in place | snap (HIGH) | ≤0.25s | pop-out + HUD flip | "disappeared" | unchecked | HUD badge glyph | set held, arm active | e04-cut-restored_05–10 |
| e05b | element | pop into hand ×2 | snap + hand-raise sell (HIGH) | ≤0.25s each | pop | "four"/"eight" | unchecked | card faces (prop) | torso idle 3%/frame | e05b-kings-multiply_05–14 |
| e06 | element | fist raise+slam ~10%h | ease-in, hard stop | ~0.5s | cut-to-detail | "Enter Vladislav" | unchecked | none | held 2–3% between beats | e06-vladislav-entrance_01–12 |
| e07 | element | labels pop per item | snap per item | ~0.5s/item | draw-on (whole-word) | each list item | unchecked | chalk marker, white, mixed case | narrator holds board | e07-map-commonwealth_01–07 |
| e08 | none→cut | static; then flash cut | luminance settle 2 frames | 0.5s settle | flash-cut + icon pop | "burned" (icon) | unchecked | none | 1.2–1.6%/frame ambient only | e08-heldcam-deluge_01–12 |
| e09 | element | stamp ×2, ~60%w type | snap, settle unresolved (MED) | ≤0.25s each | stamp | "Liberum"/"veto" | unchecked | extra-bold caps, white + black outline, tilted ±8° | scene keeps living under type | e09-liberumveto-text_05–12 |
| e10 | element | slide-in ~40%w in 0.5s; chop | ease-out in, snap chop | 0.5s + 0.25s | slide + action | "boom" | music dip 796.4s (measured, just after) | none | map held; scar persists | e10-partition-boom_01–12 |
| e11 | camera | cut; then drift ~2%w/s | linear drift | ~2s+ | cut | "the worst, Russia" | music dip 1020.4s (measured) | "Sold" hand-lettered banner pre-cut | pre-cut tableau 1.5%/frame | e11-cut-russia_04–12 |
| e12 | element(HUD) | badge state flip | snap | ≤0.5s | HUD flip | "Seventh time" | music dip 1149.7s (measured) | tombstone gag lettering (diegetic) | rain 2.5–4%/frame, no cut | e12-transition-gone7th_01–12 |
| e13 | camera/element | full-width continuous ~12%/frame | unresolved | 3s+ | — | "still here" | unchecked | — | montage continuously active | diff stats only — NOT verified |

## Observed, NOT adoptable

Full limb/squash character acting (kick gag e00b, body-squash landings), hand-drawn per-scene illustration density, and the physical-comedy staging depend on real character animation — outside the Remotion component library. The *devices* (pop-on-held-set, HUD counter, scar-persistence, stamp type) are the adoptable layer.

## Honesty section

- **Relaunch reuse:** cut list, transcript, audio, and 13 bursts were produced by the killed prior agent; each was verified before use (cut list spans full 0–1266s and matches scdet spot-checks; burst timestamps match transcript beats; diff stats recomputed fresh this run).
- **e13 (ending montage) = FAILED per the frame-citation rule:** frames exist on disk + diff stats computed (steady 11–14%/frame), but the session was terminated before visual review — row kept as measured-only, LOW confidence, no qualitative claims.
- **e05 (original burst) missed its target** (caught a cut, not the held-set evolution); superseded by the newly extracted e05b rather than counted. Quota filled: 3 hard cuts (e01, e04, e11) · 3 entrances (e00a char-pop, e02 char-materialize, e09 text; e06 logged as a 4th, cut-to-detail variant; no clean PROP entrance found beyond e10's cleaver) · 2 camera-in-held-scene (e03, e08) · 1 chart (e07 — chalkboard; the big Commonwealth map moment was not re-hunted after the burst landed on the chalkboard) · 1 emphasis (e10) · 1 transition (e11/e12) · 1 held-set (e05b) · 1 free (e13, degraded as above; e00b serves as the effective free pick).
- **Gemini audio:** gemini-3-flash-preview 503×2 → gemini-2.5-flash; the usable output = MUSIC section only. SFX inventory / specific-event checks / voice section degenerated into fabricated timestamp spam and were DISCARDED — per-event SFX fields are "unchecked", SFX density unmeasured. Mood labels marked MED only where a measured silence dip corroborates.
- **Easing finer than 0.25s is unresolvable at 4fps** — "snap" claims are adjacent-frame evidence (HIGH); overshoot/settle judgments are MED at best (e09). No 8fps re-pulls were made (session budget).
- Stayed in range; ~168 frames total returned across the task (within budget).

## Appendix — raw cut timestamps (scdet, seconds)

```
    0.83      3.30     13.17     16.83     18.97     34.97     43.10     48.67     52.37     57.23
   60.07     65.53     66.30     71.00     77.10    110.17    112.50    124.87    129.30    139.50
  144.90    155.47    165.03    169.10    171.73    177.10    181.73    185.53    190.13    194.10
  200.00    205.37    217.00    228.10    237.93    244.97    252.03    252.93    253.20    261.07
  273.73    276.50    279.73    283.47    297.43    300.17    301.63    311.63    315.20    331.57
  331.77    334.47    336.03    336.17    339.23    344.50    344.70    348.50    357.03    358.63
  359.63    360.23    367.53    367.57    380.13    390.73    390.87    392.40    394.13    397.23
  407.40    411.47    422.90    433.30    437.83    445.83    449.03    453.53    459.17    464.13
  467.53    473.73    484.10    487.27    490.07    497.90    502.40    509.63    515.17    521.63
  535.00    545.30    548.10    552.23    553.13    555.90    562.27    574.37    578.53    586.43
  590.33    591.57    594.27    599.37    604.67    611.30    612.70    615.43    618.57    620.77
  632.30    637.53    642.13    645.57    650.33    657.13    664.93    669.47    676.27    684.33
  689.07    706.83    706.90    715.13    718.97    724.27    760.80    765.67    769.43    796.67
  799.80    817.47    825.80    836.70    841.97    846.70    861.50    869.03    876.60    882.03
  890.17    919.00    926.10    927.10    939.53    967.97    979.73   1011.00   1017.70   1033.10
 1050.53   1061.07   1072.70   1072.77   1087.20   1102.90   1113.73   1129.10   1136.83   1144.47
 1152.60   1153.87   1167.20   1175.13   1195.77   1201.90   1223.03   1228.77   1237.87   1264.30
 1264.40
```
