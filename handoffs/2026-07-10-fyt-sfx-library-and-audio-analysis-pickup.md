# PICKUP — SFX library built + audio-analysis research phase mid-execution (2026-07-10)

> **▶ RESUME HERE (fresh terminal).** The SFX library is DONE, **Phase 1 (reference audio analysis) COMPLETE**
> (measured grammar → `universal.md §13a-iii.8` + `audio-tokens.json`), and **Phase 2a (deterministic structural
> SFX emission) DONE + ear-gated** (2026-07-11). `build_audio.sfx_events` now fires off the real `shots.json`
> signals: scene→whoosh · delta-chain add (`delta`+`enumeration-within`, stage-stable variant)→pop ·
> chapter-boundary→boom · escalation→thud · text→tick · gravity/dialogue/aside→withhold (map = DATA in
> `audio-tokens.json beat_type_sfx`) + the synchronized full-stop (breath gaps dip the bed to silence + drop
> SFX) + a multi-breath dip-shift fix. 22/22 tests green (commits through `8eb9c0d`).
>
> **Phase 2b BUILT + ear-gated AND its fast-follow (`audio-cue-writer`) BUILT + dogfooded (2026-07-11).**
> **Phase 3A (`music-forge` sourcing) DONE (2026-07-11). Phase 3B (the music LANE) DONE + ear-gated
> (2026-07-12):** `build_music_lane` fills `music_states[]` (was a stub) → engine `MusicLane` (placed
> per-section segments, constant present level, dry on gravity/dry-spans, fade→gap→fade track switches; the
> flat `neutral`-bed path removed); new **`music-cue-writer`** skill authors `music-cues.json`. Ear-gated on
> `_chain-test`: `music_present_db` 9→7, `music_fade_s` 0.5/0.9. See `decisions.md` 2026-07-12 + spec/plan
> `…2026-07-12-phase3b…`. **Iterate-later:** the full music drop on a human-cost line reads slightly weird
> (partial-thin candidate); `casual-bed` still PROVISIONAL until settled under a full front-half narration.
> **Mastering reconciled + Phase 4 (audio checker) DONE (2026-07-12) — THE AUDIO ARC IS COMPLETE.** Mastering
> existed (`loudnorm_pass`, was hardcoded) → now reads `master_target`, ear-gated to **−14.5 LUFS / −1.0 dBTP /
> LRA 4**; orphaned ElevenLabs `gen_audio_kit.py`/`audio_loop.py` deleted. Phase 4 = `audio_checker.check_audio`
> (deterministic, warn-not-fail, no model listening) → an `audio` block in `render.manifest.json`; lean check-set
> (missing-files / LUFS-TP-vs-target / register-present / lane-sanity). See `decisions.md` 2026-07-12 + plan
> `…2026-07-12-phase4-audio-checker.md`.
> ▶ **RESUME = there is no next audio PHASE — only NAMED follow-ups:** (1) a partial-thin on the human-cost
> music drop (full silence reads slightly weird — ear-tune); (2) settle the PROVISIONAL `casual-bed` bucket
> under a full front-half narration (not the `_chain-test` fixture); (3) device-card SFX (stat/counter/meter →
> pop/riser/pluck) light up automatically once the visual/animation workstream ships those overlays — the
> `_OVERLAY_ROLE` map in `build_audio.py` is already wired. The audio engine is production- AND
> verification-complete; further audio work is polish + the front-half-video validation.
> The **`audio-cue-writer`** skill authors `audio-cues.json` (grounded in `beat_type` → fresh-eyes critic →
> `lint_audio_cues.py`); its real generalization test = a fresh front-half topic once one has a `shots.json`
> (named follow-up; the `_chain-test` dogfood is the exemplar, so it proves machinery not generalization).
>
> **What 2b shipped:** a per-video `audio-cues.json` (SEPARATE from shots.json — VPW stays visual). Each cue
> `{anchor, role?, pause_s?, gain_db?, in_pause?}`: `anchor` = a verbatim VO phrase resolved by the SHARED
> `vo_ref` matcher (cursor-advancing); `pause_s` → merged into the breath gaps; `role` → a merged event
> (inherits density-cap + full-stop + missing-file). New `audio_cues.py`; `build_motion`/`build_audio` wiring;
> `number-reveal` dropped from `breath_s_by_beat` (its punch is now an authored cue); `breath.py`+engine
> UNTOUCHED; no `audio-cues.json` → identical render. **Ear-gate added two general idioms:** `in_pause` (an
> interrupt SFX fires IN the gap before the word) + sync-by-`vo_ref` (anchor an SFX to a shot's `vo_ref` opening
> words to land it with the image; pure-pause the next shot's words to hold an image). **Hard-authoring model:**
> Claude authors the cues, the human ear-gates FEEL. **Small follow-up:** a genuinely longer record-scratch =
> a `sfx-forge` re-source (the current file is 0.45s). Spec: `docs/superpowers/specs/2026-07-11-sfx-emission-2b-authored-cues-design.md`;
> plan: `docs/superpowers/plans/2026-07-11-sfx-emission-2b.md`.
>
> **Deferred beyond 2b (principles captured in the specs):** 2c device-cards (needs Remotion T3 animation)
> unlock the dormant pop/riser/pluck; Phase-3 music lane (dips FADE not cut · stop = fade→pause→DELAYED resume ·
> revisit `bed_db_under_vo=14` **by ear**) → Phase-4 checker. **Follow-up:** `sfx-forge` normalize should trim
> SFX leading silence (done locally this session; a re-source would undo it). Everything committed except audio
> binaries (gitignored); `_chain-test` render artifacts are untracked scratch.

## Where we are, in one line
SFX **sourcing + library = complete** (new `sfx-forge` skill + a 16-role CC0/CC-BY library baked into the
channel). The **next phase** (make the library actually *fire* + move the music on beats) is **analysis-first**:
we're building the measurement tool (Tasks 1–5 done), then we run it on 8 reference videos (Task 6+).

## The two live plan/spec docs (read these to resume)
- **Spec (the arc):** `docs/superpowers/specs/2026-07-10-audio-reference-analysis-and-emission-arc-design.md`
  — analysis-first, measurement-led, audio-only; the gated arc research → emission → music-lane → checker.
- **Plan (executing now):** `docs/superpowers/plans/2026-07-10-audio-reference-analysis.md` — 8 tasks.
  **Tasks 1–5 = DONE. Resume at Task 6.**

## EXACT resume point — Task 6 (precompute)
Files live: `.claude/skills/audio-analyzer/scripts/{measures.py, io_tools.py, beat_map.py}` + their tests
(`test_measures.py`, `test_beat_map.py` — both PASS). The pure measurement battery is complete + tested.

**Task 6 (do this next, per the plan):**
1. `py -3 -m pip install demucs` (the one new dep; torch already present).
2. Author `.claude/skills/audio-analyzer/scripts/videos.json` — the 6 motion-teardown videos (ids/urls from
   `channels/the-second-take/visual-kit/research/motion-logs/`: crayon ×3 palantir/rockefeller/singapore,
   heyhistorically disappeared-8x, oversimplified prohibition, kurzgesagt scariest-place) **+ 2 more
   OverSimplified videos** picked via `yt-dlp` top-views (record which 2).
3. Implement `fetch_stems.py` (`yt-dlp -x` → `htdemucs --two-stems=vocals` → cache `vocal.wav`/`residual.wav`
   under `.../audio-logs/_stems/<id>/`; idempotent).
4. **SMOKE (human):** run on ONE video → both stems non-empty; the vocal stem's speech regions (measures.
   `speech_regions`) align with that video's transcript timestamps (±0.5s). If not, STOP — timebase off.
5. Then Task 7 (per-video runner → `audio-logs/<id>/report.json`), Task 8 (synthesis → measured grammar →
   **HUMAN SYNTHESIS GATE** → integrate into `universal.md §13a-iii` + `audio-tokens.json`).

## What the SFX library delivered (complete)
- **New skill `sfx-forge`** (`.claude/skills/sfx-forge/`, has `SKILL.md`) — Freesound (CC0+CC-BY) → vet → CLAP
  rank → two-section audition artifact → `pick` (normalize + pool + provenance). `run`/`board`/`pick` subcommands.
  Deps: `FREESOUND_API_KEY` in `.env` (set), CLAP (`laion/clap-htsat-unfused`, downloaded), torch/transformers/
  librosa/soundfile/certifi (installed).
- **16-role library baked** into `channels/the-second-take/visual-kit/audio/sfx/` (files gitignored;
  `manifest.json` + `audio-tokens.json sfx_pools`/`sfx_gain_db` + `attribution.txt` are the tracked record):
  whoosh×2, boom×2, riser, boing, record_scratch, cash, sting, womp, pop×3, stamp(bass-EQ'd), tick×2, ding,
  buzzer×2, sparkle×2, thud×3, powerdown. **pluck dropped** (`vocabulary.json` `"dropped":true`).
- **cash `#91924` + sting `#244534` are PROVISIONAL** — the iconic cha-ching + dun-dun-dunnn aren't on
  Freesound; upgrade later by dropping the files into `visual-kit/audio/sfx/incoming/` (Pixabay, no-attribution)
  → re-`pick`. Everything else is user-approved.
- **Render defense:** `build_audio.build_audio_spec(..., audio_dir=)` drops SFX events with no backing file +
  counts `sfx_missing` (never a missing-file crash). Wired in `build_motion`.

## Design decisions locked this session (also in decisions.md)
- **Emission is a SPLIT:** element-coupled SFX (whoosh/boom/pop/riser) stay **deterministic** (fire on visual
  events); comedic/semantic SFX (boing/scratch/cash/sting/womp/ding/buzzer/sparkle) are **malleable + opt-in**
  (an authored `sfx` hint per shot; beat_type + measured density only *suggest*). Predictability kills comedy.
- **License = CC0 + CC-BY** (attribution = a description credit line; NC excluded). Not ElevenLabs-gen (flopped).
- **Analysis is audio-only, no video** — cuts can't be inferred from audio + aren't load-bearing; beat maps are
  **narrative (transcript-derived)**. Measurement-led: `[reliable]` measures load-bearing, `[directional]`
  (transient density, SFX-ID) quarantined.
- **The emission gap is bigger than comedic SFX:** device-card overlays (chapter-card→boom, stat-card→pop,
  meter/progressive-reveal→riser) **aren't produced by `build_motion`** — only whoosh (stage) + tick
  (on_screen_text) fire today. Phase 2 (emission) must wire the device-cards too.

## Warnings for the next terminal
- **Parallel terminals share this tree.** Stage explicit paths; never `git add -A`; never rewrite history.
  (Other terminals have front-half video work in flight — leave `videos/*/script.md` etc. alone.)
- **Audio binaries are gitignored** — the library mp3s exist locally on THIS machine; a fresh checkout has only
  the manifest. If the sfx files are missing, re-run `sfx-forge pick` from the audition caches (or re-source).
- **Demucs runtime is the pitfall** — pre-compute stems sequentially + cache; keep it OUT of any parallel
  fan-out so workers stay light (no agent timeouts).
- **Small open item:** none pending after this handoff — CLAUDE.md + decisions.md updated below.

## Task-list state
SFX A1–A8 done. **Reference audio-analysis plan — ALL 8 tasks DONE** (measurement battery + demucs precompute
of all 8 refs + fan-out reports + synthesis + grammar/dial integration; commits through `bbcbb5b`). Skill built
+ registered. **Phase 2a (structural SFX emission) DONE. Phase 2b (authored `audio-cues.json` content layer)
DONE. Phase 2b fast-follow (`audio-cue-writer` = LLM cue-author + fresh-eyes critic + lint) BUILT + dogfooded
(2026-07-11). All ear-gated. Resume = Phase 3 music lane.**
