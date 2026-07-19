# Pickup — Poyais R9 (watch-through №4 feedback round)

**Written:** 2026-07-17, end of the R7+R8 session. **Resume trigger:** Daniel returns with
watch-through-№4 notes on the R8 render; run ONE more iteration (R9) using the proven round
pattern below, then re-render and re-board.

## Where things stand

- **R8 render is DONE and verified**, awaiting Daniel's gate:
  `channels/the-second-take/videos/2026-07-04-poyais/assets/final.mp4` — 544.6s (~9:04),
  −14.58 LUFS / −1.00 dBTP, checker green, all preflight gates + 20 probe groups PASS.
  A/B comparators beside it: `final.pre-r8-2026-07-17.mp4` (R7), `final.pre-r7-2026-07-17.mp4` (R6).
- **Review board** (25 probe frames + ear/eye gate flags), same artifact URL every round:
  https://claude.ai/code/artifact/aaba522c-9d2e-4426-909e-680c5e55c38d
- **Everything is committed** on `feat/pipeline-simplification`: R7 `6dbc783`/`2a9f85b`/`a89bfad`,
  R8 `4a49ef2`/`baf87bd`/`e421181`, STATUS `5411aa4`, docs `5b98b9f`. Working tree clean for
  engine + visual-kit + video files (only scratch/backup files untracked).
- **Round history:** R6 = watch-through 1 (34 notes), R7 = watch-through 2 (35 M-notes,
  `_r7-fix-plan-2026-07-17.md`), R8 = watch-through 3 (30 P-notes, `_r8-fix-plan-2026-07-17.md`).
  Note files live beside the plans in the video folder (`_watch-through-N-notes-*.md`).

## Gate flags Daniel was asked to judge (his notes may reference these)

- **Ear:** whole-video prosody re-rolled (script cuts forced full VO re-synthesis); 84 universal
  0.5s sentence gaps (runtime grew to 9:04); card 1 plays over clean SILENCE (precedes first music
  bed); new sounds — heavier crack-2, halo_vocal-2 (+11 st), Cheery Monday middle bed, Monkeys
  Spinning Monkeys to the very end; my unoverruled closing line "Thanks for watching. And maybe
  double-check before you buy a country."
- **Eye:** L26 shows its own frame for the first time (latent reveal-bug fix); L122 Venezuela
  burial = tricolour + shako (historical call, overrule if Union-Jack read wanted); trio —
  MacGregor reads a touch taller/fancier than the chibi trio.

## The proven round pattern (use it for R9)

1. **Parse notes** → write a stable-ID file in the video folder
   (`_watch-through-4-notes-2026-07-17.md`, IDs Q01…), then a fix plan
   (`_r9-fix-plan-2026-07-17.md`) with root causes, workstreams, gate flags.
2. **Ask clarifying questions FIRST** — Daniel answers fast and his rulings change scope
   (R8: stacking + 0.5s, cards→own scenes, Monkeys-to-end all came from questions).
3. **Agents:** Opus 4.8 only for grunt work (`model: "opus"`, VERIFY via model probe — agent
   logs its model ID as line 1 of its report). Every agent writes an incremental scratchpad
   report (`r9-map-*.md` / `r9-exec-*.md` / `r9-review-*.md`). Mapping agents → execution
   agents → a fresh-eyes 3-lens review (identity / fidelity / style).
4. **Single-writer merge:** agents stage patches in `assets/r9-staging/`; ONLY the orchestrator
   writes `shots.json`, `shots.motion.json`, `audio-plan.json`, `scenes/manifest.json` — via a
   `merge_r9.py` in the scratchpad (pattern: `merge_r8.py` — phases backup → motion merge →
   file placements w/ archival to `_superseded-…-r9/` → manifest upsert w/ review citation).
   Backups: `*.pre-r9-2026-07-17.json` beside the files.
5. **Lints before render:** `lint_shots.py <path>` (positional), motion lint at
   `.claude/skills/motion-planner/scripts/lint_motion_plan.py <shots> <motion>` (two positional),
   `lint_audio_plan.py <plan> <tokens>` (needs the tokens arg).
6. **Render:** in a subagent, FOREGROUND-SEQUENTIAL (a background render child orphans at turn
   end — R7 lesson). RENDER_CHUNK_FRAMES=1500, ffmpeg concat, loudnorm −14.5 LUFS/−1.0 dBTP.
   If a render "looks dead", CHECK THE LOG/ARTIFACT before re-running (R7 false alarm:
   RENDER_EXIT=0 was already in the captured log).
7. **Verify:** preflight gate counts (cues_unresolved=0, sentence_gap_count, no card-fallback
   warnings, duration formula), ~20 probe-frame groups at note timestamps, audio spot-checks.
8. **Board:** regenerate via scratchpad `build_r8_board.py` pattern — output MUST stay at
   scratchpad `r7-review-board.html` (same path = same artifact URL). Republish with Artifact
   `url` param if a fresh session (URL above).
9. **Commit** with explicit paths only (never `git add -A` / `commit -a`); engine changes,
   library changes, and video changes as separate commits.

## Known gotchas (all hit this session)

- **GateGuard hook** blocks the FIRST Write/Edit per file: state importers/callers, affected
  API, schemas, and the user's verbatim instruction inline, then retry the identical op — passes.
- **PowerShell 5.1**: never inline `py -3 -c` with non-ASCII (cp1252 mangles it) — Write a .py
  to the scratchpad and run it. Verify any bulk text edit by codepoint (§F-encoding).
- **VO anchors:** verbatim 4-word `vo_ref`/anchor n-grams against ElevenLabs word timings; if a
  word occurs twice in the VO, disambiguate with a unique consecutive n-gram (see the DISAMBIG
  dict in scratchpad `merge_r8.py` for the trio example).
- **Sentence-gap law is engine-wide now**: `audio-tokens.json` dials
  (`sentence_gap_s: 0.5` / `sentence_gap_chained_s: 0.3`, stacking); `source:"sentence"` gaps
  are excluded from music dips/withhold. Baked `[PAUSE]` tags are retired — do not re-add.
- **Chapter scenes:** plan-level `cards[]` + `post_vo_hold_s` in `shots.motion.json`, realized by
  `build_motion.apply_cards()` inside co-located pause-cue silence. A card anchor MUST equal its
  pause cue's anchor. Card text = Daniel's titles verbatim.
- **Per-cue pins:** music cues take `"track"`, sfx take `"variant"`; a pinned-missing file is a
  HARD error. `dip_in_pause:false` — bed flows through authored pauses.

## After Daniel's gate passes (the tail — unstarted)

1. Check whether **metadata-writer** ever ran for Poyais; run if not.
2. **Thumbnail** (visual-prompt-writer prompt → image-gen).
3. **CC-BY credit block** — Incompetech beds incl. upbeat-4 Cheery Monday, crack-3, halo-1,
   collapse-1; see `channels/the-second-take/visual-kit/audio-library/attribution.txt`.
4. **Compliance + QA gate** (playbook), then publish-queue — Stage 0: Daniel publishes.
5. **§G codification session**: R6 candidates 1–15 (in `2026-07-17-poyais-r6-pickup.md`) + R7/R8
   candidates (per-cue pins, cumulative-chain re-base seeds LAST delta, deterministic-composite
   lever, sentence-gap law, card-on-silence idiom, anchor-disambiguation lint,
   foreground-render-in-subagent, verify-artifact-before-declaring-dead, rembg magenta-panel).
   Each needs Daniel's confirmation before routing (§G).
6. **F-clean sweep** at video lock: `*.pre-r*-*.json/mp4` backups, `_superseded-*` dirs,
   staging dirs, watch-note/plan scratch files.

## Open bugs (non-blocking, parked)

forge.py pick path-id crash · `--mode identity` bald head · head-turn NOSE · AAC 96 kHz residual.
