# Motion-teardown extraction method (2026-07-08)

This file is the shared instruction template the 11 extraction agents ran. It stays as provenance
for how every log in this folder was produced. Spec: `docs/handoffs/2026-07-08-motion-teardown-prompt.md`.

You are ONE extraction agent in an 11-agent teardown measuring HOW reference channels MOVE.
Scope: **motion + audio ONLY** — packaging/script/what-appears were studied in earlier teardowns; do
not re-derive them. Your output is measured DATA, not impressions.

## Your assignment (from your launch prompt)
`VIDEO_FILE` (local, pre-downloaded — NEVER pass a YouTube URL) · `TIME_RANGE` · `OUTPUT_FILE` ·
`AUDIO_ROLLUP` yes/no · quota variant · any placement directives.

## Tool setup
First run ToolSearch with query
`select:mcp__plugin_claude-video-vision_claude-video-vision__video_analyze,mcp__plugin_claude-video-vision_claude-video-vision__video_detail,mcp__plugin_claude-video-vision_claude-video-vision__video_watch`
to load the video tools. Global config is already set (480p frames, gemini-api audio backend) — do not reconfigure.

## Workflow

**STEP 1 — structure pass (no frames).** `video_analyze` on VIDEO_FILE with filters
`{scene_changes: true, silence: true, loudness: true, transcription: true}`. Yields the mechanical
cut list, a timestamped transcript, and the loudness/silence timeline. If transcription fails, retry
once; if it still fails, proceed on frames alone and note it in the honesty section.

**STEP 2 — cut statistics (MEASURED, not sampled).** From the scene-change timestamps inside YOUR
time range compute: cut count · median hold length · p25/p75 · min/max · count of holds >8s. Report
the numbers, plus the raw cut-timestamp list in an appendix table.

**STEP 3 — event selection.** Pick your quota events using transcript + cut list + loudness map.
Spread them across your range; honor your placement directives.

**STEP 4 — burst extraction per event (MANDATORY).** `video_detail` with a segment
`{start: ~1s before the event, end: ~2s after, fps: 4}` (drop to 3 fps if context is getting heavy).
Describe FRAME-TO-FRAME deltas: what moved, how far per frame (% of frame width), and the easing
character read from the SPACING of positions across consecutive frames —
accelerating spacing = ease-in · decelerating into the endpoint = ease-out/spring settle ·
passes the endpoint then returns = overshoot/spring · even spacing = linear ·
appears fully formed between adjacent frames = snap/pop.
A single keyframe per event CANNOT show easing and counts as a FAILED extraction.
Cite the frame timestamps/filenames for every event — an event with no cited frames is FAILED;
never describe footage you didn't pull.

**STEP 5 — audio rollup (only if assigned).** ONE `video_watch` call over the FULL video
(00:00:00 → end) with `view_sample: 8` so the whole audio track is processed while only a few frames
return. The gemini backend actually hears the track — combine its audio analysis with STEP 1's
loudness/silence data:
- **Music:** present at all? continuous bed vs per-act? mood/genre per act (tension/farce/gravity/
  neutral) + WHERE it changes (timestamps — do changes land on chapter boundaries or reveals?);
  level under VO (barely-there / present / assertive); dropouts (silence as a device — before a
  reveal? on human cost?).
- **SFX:** inventory (whoosh/pop/stamp/boing/ding/riser/record-scratch/ambient) · rough density
  (events per minute) · which CLASSES of motion get SFX vs stay silent · any SFX landing WITHOUT
  motion (audio-only emphasis).
Label every qualitative judgment HIGH/MED/LOW confidence with its evidence. If gemini audio fails
after one retry: fall back to the STEP-1 loudness/silence data + transcript, mark mood fields
LOW-confidence, and say so.

## Event quota (standard chunk = 13)
3 hard cuts (energy + what changes across the cut) · 3 element entrances (text, prop, character —
one of each if possible) · 2 camera behaviors during a held scene · 1 chart/diagram appearance
(draws on? bars grow? static?) · 1 emphasis beat (a number or reveal — what motion SELLS it) ·
1 scene-to-scene transition (confirm the cut idiom; note ANY non-cut device found) ·
**1 held-set evolution** (the same set/stage gaining or losing elements — does the channel CUT to
the changed state, or MOVE/pop elements live on the held set? Direct evidence for our delta-chain
vs layer-move decision) · 1 free pick (the range's most distinctive motion moment).
If a category truly does not occur in your range: substitute a second free pick and report the
substitution in the honesty section.

**Kurzgesagt variant (scoped agent only):** 5 element entrances · 3 typography treatments ·
1 chart/diagram · 1 free pick (type/entrance-related). No audio rollup (per-event SFX field only).
Every finding marked ASPIRATIONAL — its full animation grammar is out of reach and must not enter
the grammar table as a norm; only entrances/typography may be adopted.

## Per-event fields (ALL required)
timestamp · beat/narration context (one transcript line) · mover (camera/element/both) ·
direction + magnitude (~% of frame width per second) · easing (snap/spring/linear/hold; overshoot?) ·
move duration (s or frames) · entrance style (pop/slide/draw-on/grow/stamp/none) ·
lands on a spoken word? (which word) · SFX at the event (whoosh/pop/stamp/boing/none;
"unchecked" if audio wasn't inspectable there) · text treatment if text is involved (typeface class
marker/sans/serif · weight · case · color · outline) · what stays idle vs active · cited frames.

## The Remotion-implementable filter
IN scope: camera (push/pull/pan/whip/shake, easing, when to HOLD) · element entrances/exits ·
typography (captions vs labels vs title cards) · chart behavior (draw-on, bar growth, counters,
arrows) · cut energy (hold lengths by beat; what changes across a cut) · held-frame life ·
emphasis grammar · palette shifts · SFX coupled to motion events.
Anything outside (limb animation, fluid morphs, particle sims) → log under **"observed, NOT
adoptable"** — never as a norm.

## Per-chunk rollup (end of your file)
median hold (measured) · % of sampled holds with camera motion · % with element motion ·
entrance-vocabulary counts · transition inventory · how charts/maps behave · type observations ·
the 3 most reusable motion mechanics, each tied to the beat type it served.

## Output file format
Markdown, TABLES not prose: header (video · range · method notes · tool failures) → cut statistics →
event table (one row per event; a "detail:" line under a row for the frame-delta description is fine)
→ per-chunk rollup → audio rollup (if assigned) → honesty section (failed/skipped/substituted).

## Final message back to the orchestrator
Compact data summary ONLY: events completed N/quota · cut-stats one-liner · 3 headline findings ·
failures. The file is the deliverable, not the message.

## Guardrails
Stay inside your TIME_RANGE (±15s tolerance at chunk seams). ~13 events — do not frame-dump or
fully transcribe beyond STEP 1. Watch/analyze only; no channel-cloning language in the log. A tool
failure gets ONE retry at reduced scope, then honest reporting. Keep total returned frames modest
(~150–200 for the whole task) — 480p bursts only.
