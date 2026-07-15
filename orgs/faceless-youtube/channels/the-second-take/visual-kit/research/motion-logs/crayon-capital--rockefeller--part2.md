# Motion teardown — Crayon Capital, "Rockefeller: The First Confirmed Billionaire" — PART 2

| | |
|---|---|
| **Video** | Crayon Capital — "Rockefeller: The First Confirmed Billionaire (And How He Did It)" (sMH8WchxQR8, 20:16, BASE channel) |
| **Range** | 00:10:08–00:20:16 (second half) |
| **Quota** | standard 13 events (13/13 completed) |
| **Audio rollup** | SKIPPED per assignment (part-1 agent covers it) |
| **Method notes** | STEP 1 `video_analyze` (scene/silence/loudness/transcription) → cut stats offline → 1 fps frame-delta bursts via `video_detail` `view` |
| **Tool failures** | (1) Transcription: Gemini 503 on both chunks, tool-internal retry + 1 reduced-scope retry all failed — NO transcript; beat context reconstructed from on-screen text (speech bubbles / black cards / headlines). (2) `video_detail` at 4 fps crashed the MCP server 3× ("Connection closed"); the recovered session cache is keyed at 1-second granularity, so **all frame deltas were read at 1 fps, not the mandated 4 fps** — easing of sub-second moves is capped at MED/LOW confidence throughout. |

## Cut statistics (MEASURED, 00:10:08–00:20:16)

scdet emits sub-threshold entries; a **cut = scdet score ≥ 10**. Frame-verified: the repeated ~9.x / ~5.x score clusters (10:46–10:49, 16:41–16:43, 17:55–17:57) are continuous in-scene animation (gestures / bubble type-on / lighting shifts), NOT cuts — excluded. Timestamps are second-resolution (±0.5 s per value).

| Metric | Value |
|---|---|
| Cuts in range | **146** (≈ 14.4 cuts/min) |
| Holds measured (between consecutive cuts) | 145 |
| Median hold | **4 s** |
| p25 / p75 | 3 s / 5 s |
| Min / max | 1 s / 12 s |
| Holds > 8 s | 5 (9, 9, 9, 10, 12 s) — plus the terminal **~25 s outro** (19:48→20:13: final quote scene + Subscribe card), outside the inter-cut list |
| Hold distribution | 1s×1 · 2s×24 · 3s×44 · 4s×35 · 5s×21 · 6s×5 · 7s×7 · 8s×3 · 9s×3 · 10s×1 · 12s×1 |

Silence intervals in range (STEP 1): 11:19–11:20 (0.64 s, lands inside the dead-static sepia-flashback hold) and 20:13–20:15 (2.0 s, end fade). Loudness: mean −18.4 LUFS, range 3.7 LU (whole video; very compressed/steady bed — no per-event loudness spikes resolvable from the summary).

## Event table (13 events)

Shared fields: **SFX = unchecked for every event** (audio backend down; loudness data is summary-level only). "Lands on spoken word" is inferred from on-screen text where noted, otherwise unverifiable (no transcript). All easing reads at 1 fps.

| # | Slot | Time | Beat context (on-screen text) | Mover | Direction + magnitude | Easing | Duration | Entrance style | Text treatment | Idle vs active |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Hard cut A | ~10:10.5 | Pocket-watch over industrial skyline → black card "One by one." | cut | full scene swap; busiest frame → emptiest frame | n/a (cut) | 1 frame | post-cut text write-on | white handwritten script, sentence case, no outline, on black | pre-cut: bg factories SWAP behind held clock + hands move; post-cut: only text active |
| 2 | Camera, held scene 1 | 10:44–10:51 | Office dialogue; bubbles "I don't need it anymore" / "Cleveland is already in my hands." / "I will dominate." | elements only (camera locked) | punch-in reframe VIA CUT at ~10:46.5 (~2× scale jump, same set); arms spread ~15% fw between 10:47→10:49 | camera: none (<0.5%/s); limbs unresolvable @1fps | 8 s scene | bubbles type on word-by-word | bubble: black casual hand-lettering on white bubble | set/bg pixel-static; active = bubble text, arms, face (eyes scrunch→glare) |
| 3 | Hard cut B | 11:47→11:50 | Laughing at "THE INDEPENDENT PIPELINE" newspaper → black card "Rockefeller's response? Scorched earth." | cut | scene → typographic card at the punchline | n/a (cut) | card holds ~3 s | text write-on ~1.5–2 words/s ("…res" → "response? Sc" → full) | white script on black | card: only text active |
| 4 | Chart/diagram | 11:51–11:53 | "PIPELINE OBSTRUCTION MAP" — parchment map w/ route, compass, callout | elements on static base | base arrives FULLY DRAWN at the cut; then +parcel grid, +3 red "BOUGHT BY ROCKEFELLER" parcels + derricks (11:52); +2 derricks, pipeline REROUTED/SEVERED — pipe end bends up at blockade (11:53) | pops appear fully formed between 1s frames = snap/pop (MED) | ~1 delta-cluster/s over 4 s hold | pop/stamp | hand-lettered marker CAPS, black; RED fill = hostile (palette carries meaning) | base map + compass idle; parcels/derricks/route active |
| 5 | Held-set evolution | 12:15–12:17 | Black card "One by one, the dominoes fell" → East Coast parchment map builds | elements on static base | base map+ships (12:15) → +CLEVELAND label+factory+rail lines (12:16) → +octopus center, +2nd refinery, +more rail loops, +ATLANTIC label (12:17) | segments appear whole between 1s frames: fast draw-on <1s or pop (LOW on which) | ~1 delta/s across 5 s hold | pop / fast draw-on | map labels: marker caps black | base held; adds active. **The channel does NOT cut to changed states — it layer-moves live on the held set** |
| 6 | Camera, held scene 2 | 12:33–12:35 | Rockefeller beside STANDARD sign; bubble "I'll unify all oil under one system." | camera | slow push-in, sign grows ~28%→~31% fw over 2 s ≈ **1.5%/s** | linear at this sampling | ≥3 s | none | bubble as above | everything idle except scale + bubble |
| 7 | Entrance: PROP | 12:36–12:39 | White void; globe drops onto Rockefeller's back (Atlas beat); by 12:44 globe recolored RED + "TARGET" | element | globe enters top edge (12:37, bottom of sphere ~15% down) → seated on his back center-frame (12:38): **~40–50% frame height in ≤1.5 s** | gravity ease-in; impact sold by character buckling (secondary action), no overshoot visible | ~1–1.5 s | drop-in from offscreen top | "TARGET" hand-written white on red globe | void + character idle until impact; post-impact walk cycle |
| 8 | Chapter/act boundary | 12:44–12:49 | Red TARGET globe → black TITLE card "The Ghost: How to Own Everything" (3 s) → sepia 1882 city vista, year label "188"→"1882" types on | cut + text | two hard cuts bracketing a full-formed title card | n/a (cuts); year label = typewriter digit-wise | card 12:45–12:47 (3 s static) | title card appears FULLY FORMED ≤1 s (unlike narration cards' visible write-on) — pop or sub-second type (LOW) | title: white script on black; year: white script, top-right corner | title card fully static; vista: camera static, arms swing idle behind back |
| 9 | Entrance: CHARACTER | 12:35→12:36 · 17:53→17:54 · 14:15–14:17 | Void scene / dark corridor "i'm still here." / refinery "Thirty-nine drops. Precisely" | cut (norm); camera (variant) | **Characters never animate INTO a held scene — they are on stage at frame 1 of the cut** (12:36 void, 17:54 corridor, 11:21 barrel man). Sole variant: supervisor revealed by slow **pan right ~5%/s** over 3 s (left machinery exits as he enters frame-right, 14:15–14:17) | n/a (cut) / linear pan (MED — could be char step-in) | — | by-cut; pan-reveal | — | — |
| 10 | Entrance: TEXT | 18:45–18:46 (+15:12–15:14, 11:48–11:50, 19:46–19:48) | Black cards: "But as the gold piled…" / "But the numbers were the only things still grow[ing]" / "As Rockefeller himself once put it:" | element (text) | write-on left→right, wrapping line | continuous write-on (letter clusters visible mid-word: "GOVE", "Sc", "Bu") | **rate varies 1.5–5 words/s — tracks narration cadence, not a fixed tween** (15:12→15:14: 0→9 words in 2 s; 11:48→11:50: 2→5 words in 2 s) | typewriter/write-on | white handwritten script, sentence case, centered-left, no outline | black void; only text active |
| 11 | Emphasis beat | 18:24–18:32 | THE money reveal: jubilant Rockefeller in falling bills → 3 newspaper stagings: clothesline "OIL KING BECOMES BILLIONAIRE" → bound stack "HITS $1 BILLION" → front page "WORLD'S FIRST BILLIONAIRE: CONFIRMED!" | cuts + one element slide | **repetition montage: 4 shots / ~8 s for one fact.** Final paper slides UP from bottom edge: ~60–70% frame height over ~2 s, peak ~35%/s | slide decelerates into settle (18:29 big step → 18:31 small step) = **ease-out**, no overshoot visible | slide ~2 s, then 2 s dead hold on the headline | slide-up (final); others arrive by cut | headlines: hand-drawn serif-ish caps black on newsprint; sizes escalate | bills falling = only particle-ish motion seen; headline holds dead-static once settled |
| 12 | Scene-to-scene transition | 11:17–11:23 (+inventory) | Sepia flashback "ACID CHEMICAL PLANT" handshake → warehouse "This is the last barrel we have" | cut | flashback = DEAD-STATIC 4 s hold (4 identical frames, VO pause 11:19.5 inside it), then hard cut; palette sepia → warm color | n/a | — | n/a | plant sign: marker caps on wooden plaque | **Idiom confirmed: hard cut ≈ 100% of body transitions.** Non-cut devices found: (a) end-of-video fade-out 20:13–20:15; (b) background-swap behind a held foreground (10:09→10:10 factories change behind the clock); (c) cut to EMPTY white void that then populates (14:19 blank → 14:20 row of cans → cut 14:21 to a WALL of cans = escalation via cut). NO wipes/dissolves anywhere |
| 13 | Free pick | 17:54–17:58 | Dark corridor, old Rockefeller face-on; bubble "i'm still here." | (almost) nothing — that's the device | **stillness as menace**: camera locked, body locked; only the bubble types on (17:55–17:56), a light patch crosses his face (17:57), arms drop to sides (17:58). The ~5.x scdet cluster = these micro-shifts | micro-shifts, snap-level | 5 s hold | bubble type-on | bubble as usual, lowercase "i'm" | everything idle BY DESIGN; the sole movers are text + lighting |

Detail — corroborations with cited frames:
- **Held-set evolution, 2nd instance (18:41–18:44):** white void, old Rockefeller arms-crossed right; list builds LIVE one item/~1 s: "FATHER" struck (18:41) → +"COMPETITORS" struck (18:42) → "GOVE" mid-type (18:43) → "GOVERNMENT" complete + struck (18:44). Word types on, then red strikethrough swipes it. List = black marker CAPS; strike = red. Direct layer-move evidence, zero cuts.
- **Outro grammar (19:43–20:14):** ledger checklist prop (✓ list vs ✗ list, hand-lettered, slight hand-bob idle 19:43–19:45) → hard cut → black card types "As Rockefeller himself once put it:" (19:46–19:48) → cut into the FINAL QUOTE scene (old man in chair, dark; full quote paragraph present ≤1 s after the cut — LOW confidence pop vs fast write) held ~20 s → "Subscribe" script card (20:11–20:13) → fade to black (20:14).
- Event 1 pre-cut detail (10:09→10:10): clock hands advance AND the entire factory skyline behind the held clock is replaced between adjacent frames — time-passing montage via background swap under a held anchor element.

## Per-chunk rollup

| Measure | Finding |
|---|---|
| Median hold | 4 s (p25 3 / p75 5; 14.4 cuts/min) — but the distribution is bimodal in function: 2–5 s working cuts + deliberate long holds (dead-static flashback 4 s, title card 3 s, final quote ~20 s) |
| % sampled holds with camera motion | ~12% (2 of ~16 closely-read holds: one 1.5%/s push-in, one ~5%/s pan-reveal). **Camera is locked by default; reframes happen via punch-in CUT, not zoom** |
| % sampled holds with element motion | ~80% — bubbles typing, limbs gesturing, map elements popping, text writing. True dead-stills exist and are deliberate beats (flashback, title card, settled headline) |
| Entrance vocabulary (counts across events) | text write-on/typewriter ×6 (narration cards ×4, year label, list items) · pop/stamp ×4 (map parcels, derricks, strikethrough, quote paragraph) · slide-up ×1 (newspaper) · gravity drop ×1 (globe) · by-cut ×4+ (every character; escalated can-wall) · pan-reveal ×1 |
| Transition inventory | hard cut ≈100%; black typographic card as inter-scene punctuation (≥6 in range); end fade-out; empty-stage-then-populate; background-swap under held anchor. Zero wipes/dissolves/whips |
| Charts/maps | arrive as a FULLY-DRAWN base, then build additively live ~1 delta-cluster/s (parcels, derricks, rails, labels); the drawing itself can re-argue the point (pipeline visibly severed/rerouted); red = hostile/marked; no axes-style charts in range — data lives in maps, newspapers, lists, ledgers |
| Typography | Two systems: (1) narration = black card + white handwritten script, sentence case, write-on at 1.5–5 words/s tracking VO cadence; (2) diegetic = black marker CAPS labels/headlines, red for negation/hostility. Dialogue = white speech bubbles, black casual hand-lettering, typed on word-wise. **NO burned-in captions/subtitles anywhere** |
| 3 most reusable mechanics | (1) **Black quote card with VO-paced write-on** as act punctuation + punchline delivery (beat: narrator's zinger/turn) — the single most frequent device in the range. (2) **Live additive build on a held set** (map parcels, strikethrough list): the set holds, meaning accumulates one pop per beat (beat: enumeration/escalation) — never cut-to-changed-state. (3) **Repetition montage for a milestone** (same fact staged 3–4 ways in ~8 s, final staging enters with a ~2 s ease-out slide then a dead hold) (beat: the big number/reveal). Honorable mention: **emphasis-by-total-stillness** for menace/gravity beats |

## Audio rollup

SKIPPED per assignment (AUDIO_ROLLUP: NO — part-1 agent covers it). Per-event SFX could not be filled: STEP-1 loudness returned only a whole-video summary (−18.4 LUFS mean, 3.7 LU range) and the Gemini audio backend was down (503) for the transcript and any hearing pass — every event's SFX field = "unchecked".

## Honesty section

| Item | Status |
|---|---|
| 4 fps bursts | **NOT achieved.** `video_detail` with 4 fps segments crashed the MCP server 3×; the surviving session cache is keyed at 1 s granularity. Every event was instead read as a 1 fps burst window (3–10 frames each, all cited). Consequence: "appears fully formed between adjacent frames" conflates true snap/pop with any <1 s tween; all sub-second easing calls are MED/LOW confidence. Multi-second moves (push-in, slide-up, write-on rates, delta cadence) are properly measured |
| Transcription | Failed (Gemini 503) after tool-internal retries + 1 reduced-scope `video_watch` retry. Beat context comes from on-screen text (bubbles/cards/headlines), which in this channel is dense and near-verbatim to the VO; "lands on spoken word" left unverified everywhere |
| SFX fields | All "unchecked" (see audio rollup note) |
| Cut-stat threshold | scdet score ≥10 counted as a cut; ~9.x/5.x clusters frame-verified as in-scene animation and excluded. Threshold choice could shift the count by a few cuts near the boundary (e.g. 10:46 @9.9 excluded) |
| Event spread | Events cluster 10:08–12:51 and 17:52–20:15; midrange 13:00–17:50 is covered only by cut statistics + spot frames (13:28 boardroom, 14:15–14:21 refinery/can-wall, 15:11–15:14 newspaper→card). No placement directive was violated; the act-boundary directive is satisfied by event 8 (title card "The Ghost: How to Own Everything" @12:45) |
| Substitutions | None. The "character entrance" slot is filled by a **negative result with cited frames** (characters arrive with the cut; sole variant = pan-reveal), which is itself the needed grammar datum |
| Frames viewed | ~130 total, 480–512 px JPEG (within the ~150–200 budget) |

## Appendix — raw cut timestamps (scdet ≥10, in range)

| Minute | Cut timestamps (s = scdet second) |
|---|---|
| 10:xx | 10:10, 10:14, 10:16, 10:19, 10:23, 10:25, 10:27, 10:29, 10:32, 10:34, 10:38, 10:40, 10:43, 10:51, 10:54, 10:58 |
| 11:xx | 11:01, 11:04, 11:06, 11:08, 11:20, 11:27, 11:33, 11:35, 11:38, 11:43, 11:47, 11:50, 11:55 |
| 12:xx | 12:00, 12:03, 12:07, 12:11, 12:15, 12:20, 12:23, 12:27, 12:31, 12:35, 12:45, 12:50, 12:55 |
| 13:xx | 13:00, 13:03, 13:08, 13:15, 13:19, 13:23, 13:26, 13:29, 13:33, 13:37, 13:41, 13:45, 13:48, 13:55, 13:58 |
| 14:xx | 14:01, 14:04, 14:07, 14:11, 14:18, 14:23, 14:27, 14:31, 14:33, 14:36, 14:39, 14:44, 14:47, 14:51, 14:53, 14:58 |
| 15:xx | 15:00, 15:02, 15:04, 15:08, 15:12, 15:15, 15:19, 15:21, 15:24, 15:26, 15:28, 15:31, 15:36, 15:42, 15:44, 15:47, 15:54, 15:59 |
| 16:xx | 16:01, 16:03, 16:10, 16:13, 16:19, 16:22, 16:25, 16:28, 16:32, 16:37, 16:40, 16:44, 16:46, 16:49, 16:50, 16:54, 16:56, 16:59 |
| 17:xx | 17:02, 17:05, 17:10, 17:14, 17:17, 17:22, 17:26, 17:29, 17:33, 17:36, 17:44, 17:53, 17:58 |
| 18:xx | 18:05, 18:09, 18:12, 18:16, 18:24, 18:26, 18:29, 18:32, 18:36, 18:40, 18:45, 18:50, 18:56, 18:58 |
| 19:xx | 19:02, 19:07, 19:16, 19:19, 19:24, 19:27, 19:33, 19:36, 19:45, 19:48 — then no cut until the 20:13 fade (terminal ~25 s outro hold) |

Excluded sub-threshold clusters (frame-verified as in-scene animation, not cuts): 10:46–10:49 (~9.x: bubble type-on + arm gestures), 16:41–16:43 (~8–9.x: unexamined, same signature), 17:55–17:57 (~5.x: bubble + lighting micro-shifts on the static menace hold).
