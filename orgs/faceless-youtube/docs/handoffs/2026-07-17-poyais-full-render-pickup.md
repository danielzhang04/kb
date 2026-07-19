# Pickup — Poyais FULL VIDEO RENDERED (2026-07-17) — PAUSED AT DANIEL'S WATCH-THROUGH

**State: the complete long-form video is rendered and was opened in Daniel's device player.
Chunks 1–6 visuals are ALL human-released. Nothing is generating or rendering. Resume = take
Daniel's watch-through notes (timing / audio feel / any shot), apply changes via the owning
skills, re-render, reopen in the device player.** Supersedes
`2026-07-17-chunks36-round4-pickup.md` (its board gate is CLOSED — see Round 5 below).

## The deliverable

`channels\the-second-take\videos\2026-07-04-poyais\assets\final.mp4` — 484.9s (8:05), 1920×1080
h264 @30fps + AAC stereo, 64.8 MiB, mastered −14.54 LUFS / −1.00 dBTP (target −14.5/−1.0).
audio_checker verbatim: ok:true, 0 warnings, 7 music segments, 11 SFX, 0 missing. All 118 shots
render REAL visuals (95 scenes + 22 plate+cutout layered + plate-only passthroughs; zero
placeholder cards — frame-probed at 13s/322s/479s and eye-verified). Chunked render (10×≤1500f,
ffmpeg concat); engine 423s ≈1.5× realtime. Minor: AAC sample rate is 96 kHz (loudnorm upsample
default) — plays fine, YouTube-safe, non-standard; normalize to 48 kHz on a future pass if anyone
cares.

## How the day ended (rounds 3→5 compressed; details in the two earlier 07-17 pickups + git log)

- **Round 3** executed Daniel's round-2 board feedback (crop-battery flow): his eye then rejected
  battery-passed frames → the missing invariants were EAR-HOLES and FULL-FRAME STYLE GESTALT.
- **Round 4 (the breakthrough):** VPW re-authored 15 shots to ≤80-word SIMPLE prompts (all rig
  prohibitions stripped; anonymous faces structurally eliminated/covered) + context-free regen
  (canonical-only seeds) + hardened battery → 11/14 clean incl. the 3-round failures. Flags L62 +
  L111 kept best-of-2; Daniel ruled "Everything else is good now".
- **Round 5:** L30 + L63 re-authored to EASIER scenes per Daniel — L30 = the lone shako soldier
  with water bucket (MacGregor removed; clean); L63 = top-down candlelit map desk, no head in
  frame (ear surface eliminated). L63 residual: the map-resting hand splays 5-digit — survived 4
  targeted re-rolls (the engine re-invents a "steadying hand" for desk-writing scenes; retry-law
  deviation disclosed to Daniel). **Daniel: "There are fine. Let's render."** Both stamped
  HUMAN-APPROVED in the manifest.
- **Render preflight caught 3 real gaps** (take-1 STOPPED honestly): (1) plate-only motion-plan
  shots (L60/L79) were never wired — FIXED in render-builder (`motion_plan.cutout_layer_ids` +
  `build_motion.apply_motion_plan` now exempt+wire zero-layer background plates, explicit path or
  plate_prompt→plates/<id>.png; committed 2f98bb6); (2) lagging verify stamps L01/L62/L95/L111
  flipped with audit notes citing Daniel's recorded rulings; (3) **production VO + audio plan had
  never been generated** (only test slices had them) → `voiceover` ran (Miles, 8,017 chars, one
  pass, 482.07s, 1,413 word timings → assets/vo.mp3 + voiceover.manifest.json + vo.txt) and
  `audio-director` ran (audio-plan.json, lint-green: 13 SFX / 3 pauses / 4 dry pull-backs /
  sneaky→upbeat→sneaky; committed 273cf37).

## Daniel's OPEN ear-flags for the watch-through (from the audio-director; feel is his)

1. Bed lift between dry spans at the L99–L101 rescue pivot ("So how did any of them make it
   home?") — confirm it doesn't read as a stab.
2. FICTION-stamp beat (~0:40) relies on the script's baked [BEAT] for its stop — check punch.
3. The `upbeat` register on the 1822 mania section.
Accepted-with-eyes-open visual residuals: L63 five-digit map hand · L62 distant nose-bumps ·
L111 grey filler figures · L95 distant-settler noses (all human-accepted on the record).

## Learning candidates — NOT codified, need Daniel's §G confirm (route per G-route when confirmed)

1. **VPW law:** ≤80-word scene prompts; NO rig prohibitions (they cause defects); anonymous faces
   eliminated or structurally covered (backs/hoods/hats/named canonicals); "easier image to hold"
   as a composition principle. (Validated: 11/14 + both round-5 shots.)
2. **Hands:** never author a hand resting flat/splayed on a surface — grips pass (quill 5/5),
   surface-hands fail (5/5 across two shots); desk-writing scenes re-invent a steadying hand
   against explicit prohibition.
3. **Identity pass conditional-on-starve** (unconditional gen-B balded healthy frames twice).
4. **"The ONLY people in the scene are those stated"** clause kills engine-invented
   galleries/mannequins (proven L116/L111-retry/L30-r5).
5. **Judge law:** ear-HOLES = distinct blocking invariant; full-frame style-gestalt ruling
   mandatory (crop-passes ≠ frame-passes — Daniel's round-3 rejections). Already practiced;
   `crop_battery.py` has the `ear_zones` part-type (committed).
6. Far-scale figures: author featureless/silhouette (distant nose-bumps survived 2 rounds).
7. Agent briefs: forge runs FOREGROUND-sequential; never end a turn to wait (three units stalled).
8. Doc-clarity: hybrid shots' composed-shot still_prompt keeps being misread as "stale" by units —
   needs an explicit plate-vs-composed convention.

## Key paths & housekeeping

- Session scratchpad (briefs-r3/r4.md, logs-r3/r4/r5\, verdicts-*\, crops\, board builders +
  flags jsons, r4-prompt-table.md, l75 composites, render probes):
  `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-faceless-youtube\30e11bff-346b-4ec6-94a7-f342dc6ad105\scratchpad\`
- Board artifact (currently shows the round-5 two-card view):
  https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5 — republish to the SAME
  url (`url:` param from a new conversation).
- Manifest: `assets/scenes/manifest.json` (rework36_round3/4/5 blocks; backups manifest.pre-r3/4/5-*).
  Prompt-rewrite backups in the video root: shots.pre-r4-vpw / r5-vpw / r5b / r5d / r5e +
  shots.motion.pre-r3 — SWEEP at video lock (F-clean), not before. `_superseded-2026-07-16/`
  (untracked, video root) predates this work — sweep at lock too.
- Standing rules unchanged: Opus 4.8 grunts, model line verified first log line · same-URL board ·
  supersede-first (`assets/*/_superseded-<date>-r6\` next) · orchestrator-only manifest merges ·
  UTF-8 by codepoint · crop battery (ear-holes + gestalt) is LAW for any regen · forge via `py -3`.

## After Daniel's watch-through

His notes → targeted fixes via owning skills (shot changes = VPW/image-gen + battery; audio feel =
audio-director edit + re-realize; timing = shots.json/VPW) → re-render (chunked; localized changes
can re-render cheaply) → reopen in device player. Then the tail: metadata (check whether
metadata-writer ever ran for Poyais), thumbnail (VPW owns the prompt; image-gen generates),
compliance + QA gate, publish-queue (Stage-0: human approves publish). Open elsewhere: chunk-1
bugs (`--mode identity` bald head; head-turn NOSE), VPW prop-lettering whitelist gap, dashboard
timeline backfill, codification gate on the 8 candidates above.
