# Motion teardown — Crayon Capital, "The Man Who Built Singapore in One Generation" (part 1)

| | |
| --- | --- |
| Video | Crayon Capital — "The Man Who Built Singapore in One Generation" (BASE channel; 16:08 total) |
| Local file | `scratchpad/teardown-videos/y51JjcymEAY.mp4` (854×480, 30fps, AV1) |
| Range | **00:00:00–00:08:04** (first half) |
| Audio rollup | YES — full track 00:00–16:08 |
| Method | The plugin MCP video tools were not mounted in this session, so the extraction replicated the plugin's exact pipeline by hand: ffmpeg `scdet=threshold=10` (scene changes), `silencedetect=n=-40dB:d=0.5`, `ebur128` (loudness) — the same filters/thresholds the `video_analyze` tool uses — plus Gemini 2.5 (the configured gemini-api backend, project API key) for the timestamped transcript and the full-track audio rollup. Bursts were extracted with ffmpeg at 4 fps (2 fps for the two long-window events) as tiled 427×240 contact sheets and read as images. Burst sheets archived at `scratchpad/td-y51/e01…e13*.png`; frame timestamps below are exact (frame k of a burst starting at S seconds, fps F = S + k/F). |
| Tool failures | None fatal. First Gemini call failed on a local SSL-cert issue (msys python), fixed and retried clean. Transcription: full-coverage timestamped transcript obtained (Gemini, ±2s accuracy). |

## Cut statistics (MEASURED, 00:00–08:04)

Detected cuts in range: **83** (scdet score ≥10). Holds counted between range edges and cuts: n=84.

| stat | value |
| --- | --- |
| median hold | **5.07 s** |
| p25 / p75 | 3.56 s / 7.93 s |
| min / max | 0.04 s* / **18.97 s** |
| holds >8 s | **18 / 84 (21%)** |
| mean | 5.76 s |

*The three 0.04 s "holds" are double-detections of single fast devices (a whip/panel pop at 116.53+116.57, a two-stage cut at 188.27+188.57, page-turn smears at 448.33+448.97) — real minimum shot length is ~1.3 s.

**Caveat (measured honestly):** scdet@10 under-detects low-contrast cuts in flat 2D animation. One in-set camera-angle change at ~00:26 visibly reads as a cut on frames but scored <10 (see E3). True cut count is somewhat higher and true median hold somewhat lower than the table.

## Event table (13/13)

| # | t | quota slot | beat / narration | mover | direction + magnitude | easing | duration | entrance style | lands on word? | SFX | text treatment | idle vs active | cited frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | 0:06.8 | hard cut #1 (first-60s directive) | "…wealthier than the average American." | cut, then element | full scene replacement; then split-screen panel slides in from right ~10% fw by 0:08.8 | cut = clean snap (no transition frames); panel slide = linear-ish start | 1 frame; panel ≥0.5 s | slide-in (panel) | cut lands just before "wealthier"; panel enters on "American" | unchecked at event (see rollup) | — | island scene before cut has idle bob + rotating sunburst; money scene has looping cash-toss character anim | e01 tiles 5.80–8.80 (cut between 6.55→6.80; panel sliver 8.30→8.80) |
| E2 | 0:29.0 | element entrance — TEXT | "Which crisis should we solve first?" | element | speech-bubble text pops fully formed WITH the cut at 28.93; second bubble "All of them." swaps at ~31.1 | snap/pop (fully formed between adjacent frames) | ≤0.25 s | pop | yes — bubble text = the spoken line, appears as the line starts | unchecked | handwritten marker-script, white, mixed case, no box (floating + small pointer tick) | speakers idle (sweat drop, blink); one character leans INTO frame left over ~1 s | e02 tiles 28.75→29.00 (pop), 31.00→31.25 (swap) |
| E3 | 0:14.7–0:28.9 | **held-set evolution** | crisis pile-on: "We just got kicked out of Malaysia!… no natural resources!… smaller than New York City!… And we have no army!" | element (+1 whip) | ONE boardroom set held 14.2 s; evolution ON the set, not by cutting to changed states | mixed (below) | 14.2 s | (a) newspaper prop RISES from below frame ~0.5–1.0 s (15.0→15.5); (b) prop EXITS via motion-blurred toss, 1 smear frame (16.5); (c) whip-pan to speaker 2 with 1 blur frame (19.5→20.0); (d) PROBLEM doc rises + blurred wave (22.5–25.0); (e) bubble text swaps every ~2 s; (f) in-set angle change ~26.0 (scored <10, reads as cut) | each prop entrance lands on its noun ("Malaysia" paper headline, "army" PROBLEM doc) | unchecked | same marker-script bubbles | leader face-down on desk = held gag; everything else churns | e03 tiles 14.5–29.0 (31 frames @2fps) |
| E4 | 0:52.5–0:58.0 | camera behavior #1 | "…a British guy named Stamford Raffles showed up…" | both | slow continuous PULL-OUT across a 12.9 s hold (49.9–62.8): fisherman shrinks ~25% over 5.5 s ≈ 3–5%/s scale; hut revealed left | decelerating spacing → ease-out into hold | ≥5.5 s | during the move: bubble pops (55.0), Raffles slides in from right ~10% fw in ~0.5 s (54.5→55.5) | bubble pop lands on "You know what…"; Raffles lands on his own intro | unchecked | marker-script bubbles | ship/water idle; entrances happen DURING the camera move | e04 tiles 52.5–58.0 (12 frames @2fps) |
| E5 | 1:15.5–1:20.2 | chart/diagram (map) | "It sat right at the southern tip of the Malay Peninsula…" | both | full-screen map ZOOM-OUT, subject→context, continuous across ≥5 s (hold is 72.9–88.4); red pin DROPS onto Singapore at ~76.1; geo labels (MALAY PENINSULA, INDIAN OCEAN, SOUTH CHINA SEA) pop in as zoom reveals them, map-anchored (scale with map, not screen) | zoom spacing ~even → linear long zoom; pin = pop/drop ≤0.33 s | zoom ≥5 s | pin drop-on; labels pop | pin lands on "sat right at"; ocean labels land on "Indian Ocean / South China Sea" | unchecked | geo labels in the same white marker-script | nothing idles — the zoom IS the life | e05 tiles 75.50–80.17 (15 frames @3fps; pin absent 75.83, present 76.17) |
| E6 | 1:35.0–1:38.8 | element entrance — CHARACTER | "Chinese, Indian, and Malay immigrants flooded in…" | element | conveyor entrance: each new character slides in from frame RIGHT (~15–20% fw in ~0.75 s ≈ 20–25%/s) while the existing lineup shifts LEFT to make room | shrinking deltas into position → ease-out settle | ~0.75 s per entrance, chained ×3 | slide-in | YES — each entrance lands on its ethnonym: Chinese (95.8), Indian (~96.3), Malay (~98.0) | unchecked | — | already-entered characters idle-bob while the next slides in | e06 tiles 95.75–98.75 (cut at 95.83; Indian enters 96.25–96.75; Malay 98.00–98.75) |
| E7 | 1:56.5 | scene-to-scene transition (non-cut device found) | "Sir, the Japanese are invading!" | element + camera | INSET PANEL pop: a picture-in-picture window (messenger + flag on sky-blue) appears over the held teatime set, left third; simultaneous small pull-back to make room. Registered as scdet double-hit 116.53+116.57 | panel appears fully formed between adjacent frames → snap/pop | ≤0.25 s | pop (panel) | lands on "Sir," | unchecked | bubble text inside panel, marker-script | officer keeps his tea-sip loop through the whole interruption (comic held-idle) | e07 tiles 116.30→116.55 (pop), 116.55–118.55 (composite held; bubble swap 118.55) |
| E8 | 2:02.9 | element entrance — PROP | "We have the big guns." → "I'm talking massive, 15-inch naval guns." | element (+slow push) | thought-bubble with gun GROWS ON next to head: seed puff (122.6) → small bubble (122.85) → full (123.35); then KEEPS growing slowly through "massive… 15-inch" (123.85–125.5) as emphasis; camera adds a slow push-in | grow-on with decelerating steps → ease-out; then sustained slow linear growth | entrance ~0.6 s; emphasis growth ~2 s | grow (with sequential tail puffs) | bubble completes on "big guns"; growth surge on "massive" | unchecked | bubble text marker-script above head | speaker talk-loop only; bubble is the only large mover | e08b tiles 122.35–124.35 (cut 122.47; seed 122.60; grown 123.35); e08 tiles 123.0–126.75 (continued growth) |
| E9 | 2:49.3 | hard cut #2 (+ act-boundary bridge) | "…that single blind spot cost them everything." → jungle | cut | full replacement + hard PALETTE FLIP: bright blue sea-deck → dark green jungle; no transition frames. Then the new shot HOLDS 19.0 s (169.3–188.3, the range max) and carries the visual straight across the act boundary into the sponsor pivot at 2:52 ("someone could be watching you… just like the British") — the metaphor bridges, no cut until 3:08 | snap | 1 frame | within 1 s of the cut: bubble box pops with a text smear frame (170.3), foreground soldier head RISES from bottom edge (170.8–171.3) | cut lands after "everything"; pop-up lands on "Hurry up" | unchecked | BOXED white bubble (rounded rect) — the box variant appears on shouted/whispered lines | jungle trees static; soldiers idle-blink between actions | e09 tiles 168.30–171.55 (cut 169.30→169.55; smear text 170.30; pop-up 170.80–171.30) |
| E10 | 4:20.6 | hard cut #3 (chapter/act boundary directive) | "Now, where were we?" → "During the Japanese occupation, life was brutal." | cut, then camera | act-boundary return from sponsor: host-avatar-on-white world → muted olive/grey occupation scene. Full replacement, snap. New shot gets a slow push-in (~1–2%/s) + flag-cloth wave loop | snap; push = slow linear | 1 frame | none (scene arrives whole) | cut lands between "were we?" and "During" | unchecked | — | flag wave + soldier bob = idle life on the held scene; sponsor side idles via discrete arm-pose SWAPS (poses snap between frames, no tween) | e10 tiles 259.60–262.60 (cut 260.35→260.60; pose snap 259.60→259.85) |
| E11 | 4:26.7–4:29.0 | free pick — most distinctive motion moment | "The Japanese renamed Singapore to Syonan-to…" | both | in-world SIGN LETTER-SWAP: cut to building wall (266.7); lantern-holder enters right; camera settles to reveal red plate "SINGAPORE"; letters are REMOVED right-to-left over ~0.5 s (267.95: full → 268.20: "SINGAP" → 268.45: blank); Japanese characters then pop on (268.70: "昭南" → 268.95: "昭南島" + SYONAN-TO subtitle) | letter removal = stepped (per-letter snaps); text smear frame at 267.7 during camera settle | full gag ~2.3 s | in-world signage swap (not a screen-space title card) | blank plate lands on "renamed"; new chars land on "Syonan-to" | unchecked | sign: white text on red plate, caps; subtitle smaller | crowd scene before the cut keeps its rice-pouring loop; grey background crowd vs colored key figures | e11 tiles 266.45–268.95 |
| E12 | 6:16.5–6:22.0 | camera behavior #2 | PM: "Yeah, that's not gonna work for us." / Lee: "But we had a deal!" / PM: "Deal's off." | camera | WHIP-PAN dialogue ping-pong inside one parliament set: static hold on PM (376.5–379.0) → 1 fully motion-blurred frame (379.5) → settled on Lee (380.0) → hold → blur frame back (381.5) → settled wider on PM + flag (382.0). scdet detects NO cut 374.5–385.2, confirming pans not cuts | whip: ≥200%/s equivalent, crisp the very next frame → fast move, hard stop | each whip ≤0.5 s | bubbles pop per speaker | each whip lands the incoming speaker on their first word | unchecked | marker-script bubbles | camera FROZEN between whips; talk-loop + blink only | e12 tiles 376.5–382.0 (blur frames 379.5, 381.5) |
| E13 | 7:27.3–7:31.1 | emphasis beat | crisis checklist: "…at best, suspicious." / "High unemployment." / "Racial tensions…" | element (+small camera) | the 1965 crisis list is a physical DOSSIER: each item = drawn panel + handwritten caption that TYPES ON word-by-word in sync ("suspic→suspicious." 447.55→447.80; "High unemp→High unemployment." 449.30→449.55; "Rac→Racial tensions" 450.30→451.05); between items a fast smeared page-slide/turn (448.30, 449.05, 450.05 — the scdet 448.33/448.97 double); icons saturate-in from pale to inked | type-on = stepped per word; page smears ≤0.25 s | ~1 s per item | type-on (captions), fade/saturate-in (drawings) | YES — every type-on completes exactly on its spoken word; the motion selling the beat IS the word-sync | unchecked | handwritten script captions, black on paper — the only non-bubble text class in range | book/desk static; only caption + page move | e13 tiles 447.30–451.05 (16 frames @4fps) |

## Per-chunk rollup (00:00–08:04)

- **Median hold (measured): 5.07 s** (p25 3.56 / p75 7.93; 21% of holds >8 s; max 18.97 s — and that max is load-bearing: it bridges the act boundary into the sponsor read).
- **% of sampled holds with camera motion: ~55%** (8/15 sampled holds) — always ONE of: slow push/pull ~1–5%/s (E4, E5, E8, E10), or whip-pan ≤0.5 s between speakers (E3, E12). Camera never wanders during dialogue; it is frozen between whips.
- **% of sampled holds with element motion: 100% (15/15).** Zero dead holds observed: every held scene has at minimum a character loop (talk/sip/pour/blink/sweat), usually plus an entrance or prop churn.
- **Entrance vocabulary counts** (across the 13 events): pop/snap ×6 (bubble text ×3, inset panel, map pin, sign characters) · slide-in ×6 (split panel, 3 immigrant characters counted as the chained idiom, Raffles, lantern) · rise-from-below-frame ×3 (newspaper, PROBLEM doc, foreground soldier head) · grow-on ×1 (thought bubble, + sustained grow for emphasis) · type-on ×3 captions · smear/blur-exit ×2 (prop toss, page turns) · draw-on ×0 (nothing draws on in this range).
- **Transition inventory:** hard cut (dominant, 83 in 484 s, no transition frames, frequent palette flips across cuts) · whip-pan (in-set speaker changes; 1 blur frame) · inset-panel pop (introduces a second location WITHOUT leaving the set) · smeared page-slide (list/checklist sequences) · slide-in split panel (comparison beats). **No fades, no dissolves, no wipes observed anywhere in the range.**
- **Charts/maps:** one map event; it behaves as a continuous zoom-out from subject to context with a dropped pin marker and map-anchored labels that pop as the zoom reveals them. No bar charts / counters in this half.
- **Type observations:** effectively ALL text is diegetic — speech bubbles (floating marker-script, white, mixed case; BOXED variant for shouted/whispered lines), thought bubbles, in-world signage (red plate/white caps), dossier captions (black script on paper), TV chyron. No screen-space lower-thirds, no VO captions, no title cards in the range; even the "title card" moment (Syonan-to) is played as physical signage.
- **3 most reusable motion mechanics** (beat type → mechanic):
  1. **List/enumeration beats → word-synced element churn on ONE held set:** props rise from the frame edge, get blur-tossed out, and the bubble text swaps — each entrance landing exactly on its spoken noun (E3, E6, E13). The set holds 10–20 s while elements do all the work.
  2. **Dialogue ping-pong → whip-pan with a single blur frame** between speakers inside one set, camera frozen between whips (E12, also E3). Gives conversation cut-energy with zero actual cuts.
  3. **Emphasis on a number/quality → sustained slow GROWTH of the carrier element** while the word lands (thought-bubble gun growing through "massive, 15-inch", E8) — scale-over-time as the emphasis channel, not a flash or shake.

## Audio rollup (full track 00:00–16:08)

Loudness/silence (measured, ffmpeg): integrated −17.9 LUFS, LRA 3.4 LU (very compressed, steady level); **only ONE silence ≥0.5 s in the entire 16:08** (@16:07.0, the outro) — the track is wall-to-wall audio.

### Music (gemini backend actually heard the track; confidence per claim)

**Structure: continuous bed for essentially the whole runtime, but PER-ACT — sectional, re-scored at every narrative shift** (HIGH). Level under VO: **present** (clearly audible, not competing) throughout (HIGH).

| section | mood/genre | evidence |
| --- | --- | --- |
| 0:00–0:36 | upbeat modern explainer (pizzicato strings, ukulele/guitar, clean beat) | HIGH |
| 0:36–1:54 | historical farce — jaunty silent-film piano | HIGH |
| 1:54–2:52 | military tension — low brass, snares, grave tempo | HIGH |
| 2:52–4:19 | sponsor segment: its OWN neutral corporate electronic bed | HIGH |
| 4:19–6:52 | post-war gravity — slow mournful strings (cello 4:22) | HIGH |
| 6:52–7:44 | somber independence — sustained strings under Lee's tears | HIGH |
| 7:44–12:36 | problem-solving/building — rhythmic, determined, plucked strings | HIGH |
| 12:36–14:37 | triumphant swell, fuller strings — lands EXACTLY on "they worked" | HIGH |
| 14:37–15:28 | mournful sparse piano+strings (Lee's death) | HIGH |
| 15:28–16:08 | upbeat funky outro | HIGH |

**Boundary alignment:** every music change lands on a chapter boundary or reveal — 0:36 (rewind, with record-scratch), 1:54 (invasion), 2:52/4:19 (sponsor in/out framed by both beds), 6:52 (independence/tears), 7:44 (the plan begins), 12:36 (success reveal), 14:37 (death), 15:28 (closing) (HIGH).

**Dropouts as a device (2):** ~1 s of full silence at **1:54** before the war music (shock of the invasion), and a music stop at **14:37** on the announcement of Lee's death before the mournful piece fades in — i.e., silence is reserved for the shock beat and the human-cost beat (HIGH).

### SFX (gemini backend)

**Inventory:** whoosh (map zoom 0:06, camera pull-back 0:37, pan 4:44) · pop/click on appearances (person 0:07, speech bubble 0:11, icon 7:20) · cash-register/coins (0:08, 1:10, 14:12) · stamp/thud for finality (0:15 "kicked out", 0:30) · record-scratch (0:36 rewind) · explosions/gunfire (1:57, 2:14, 2:29) · crowd ambience (1:37 immigrants, 6:31 riots, 14:43 mourning) · paper rustle/writing (0:26, 7:48, 10:01) · UI clicks/typing/chimes (sponsor: 3:11, 3:38, 3:52) · riser (1:56 pre-invasion) · foley (oar splash 0:52, shell impact 2:15, water tap 8:20) · boing (13:21 caning gag). (HIGH)

**Density: ~15–20 events/min average**, varying by section: comedic dialogue scenes MED (emphasis words + entrances only, not every move); montage/list sections HIGH (nearly every appearing icon/text gets a pop/whoosh/thud — matches E13's type-on grammar); sponsor segment HIGH with its own clean tech-UI palette. (HIGH)

**Which motion classes get SFX:** speech bubbles and major text get a pop/light whoosh on appearance (HIGH); significant camera moves/scene transitions get whooshes (HIGH); key prop movements get foley (HIGH). **Audio-only emphasis exists:** a low thud on the spoken word "impossible" at 0:34 with no on-screen impact (MED).

### Voice

One narrator performs everything; characters are differentiated by **pitch-shifting the same performance** (Lee moderately up; British officer significantly down; subordinates up for panic/deference) (HIGH).

## Honesty section

- **Substitutions: none.** All 13 quota slots filled from the range; all placement directives honored (E1 hard cut + E2/E3 entrances in the first 60 s; E10 at the sponsor→story act boundary, E9 documents the boundary-bridging hold).
- **Tooling deviation, reported:** the claude-video-vision MCP tools were not mounted in this session. The pipeline was reproduced by hand with the plugin's own ffmpeg filters/thresholds (verified in its source) + the same gemini-api audio backend. Numbers are therefore comparable with the other agents' logs, with the scdet caveat above.
- **E8 first pull missed the entrance** (window started 0.5 s late); re-extracted at 121.6 (e08b) — entrance fully captured. Counted as one event, two cited sheets.
- **Per-event SFX fields are "unchecked":** frame bursts were extracted video-only; audio evidence comes from the full-track rollup instead of per-event listening.
- **Easing reads at 2 fps (E4, E12) are coarser than 4 fps ones**; E4's ease-out and E12's whip-hard-stop are the confident reads, sub-0.25 s overshoot behavior was not resolvable anywhere.
- Frame sheets for every event archived at `scratchpad/td-y51/` (session-local); the log's timestamps are the durable citation.

## Appendix — raw cut timestamps in range (s, scdet score in parens)

6.77(27) 10.73(32) 14.70(21) 28.93(16) 37.67(58) 44.00(56) 45.50(48) 49.90(18) 62.83(28) 71.60(33) 72.90(11) 88.43(19) 92.47(16) 95.83(19) 100.03(41) 103.77(67) 106.77(32) 110.33(19) 114.37(26) 116.53(12) 116.57(11) 122.47(31) 132.17(31) 140.10(29) 150.10(54) 154.43(33) 162.43(24) 167.33(24) 169.30(25) 188.27(44) 188.57(18) 190.07(27) 195.97(40) 199.87(20) 203.80(14) 211.53(29) 214.30(30) 224.93(20) 230.30(51) 237.53(30) 239.77(27) 247.70(17) 251.93(17) 258.57(36) 260.60(45) 265.33(17) 266.70(21) 282.63(31) 294.63(27) 301.23(28) 304.83(23) 308.77(24) 313.90(45) 318.90(69) 324.60(44) 330.67(33) 338.93(28) 342.67(28) 348.63(28) 350.57(39) 358.00(66) 359.97(84) 361.17(21) 363.80(29) 368.90(20) 374.53(28) 385.23(24) 390.07(20) 396.47(24) 403.63(30) 412.53(41) 417.27(39) 421.23(38) 424.13(22) 433.03(20) 434.53(21) 437.40(36) 448.33(10) 448.97(11) 455.60(59) 464.40(20) 470.40(38) 475.47(38)
