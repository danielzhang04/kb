# Audio Director — Phase 4 (delete beat_type) + Phase 5 (hygiene)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove `beat_type` entirely (it no longer drives anything: camera decoupled, audio authored by the director) and finish the audio-director rework with a clean hygiene sweep. End state: `grep -rl beat_type` over live code + docs returns **zero** (decisions/handoffs history + old video `shots.json` data excluded — old data still parses, consumers ignore unknown keys).

**Architecture:** Phases 4+5 of `2026-07-12-audio-director-rework-design.md`. Split by risk: **Task 1** = the live-code reads (exact, tested); **Task 2** = the doc/description sweep (retire the language, preserve the measured §13a-iii.8 grammar); **Task 3** = tests; **Task 4** = hygiene (decisions/CLAUDE.md + grep→zero).

**Tech Stack:** Python 3 (`py -3`, plain-assert), Markdown/JSON.

## Global Constraints
- Parallel terminals → explicit git paths, never `git add -A`.
- **PRESERVE `universal.md §13a-iii.8`** (measured audio grammar) — only the beat_type→treatment TABLE goes.
- Edit docs in place; retire the beat_type language, no dead ghosts, no append piles.
- Do NOT strip `beat_type` from existing video `shots.json` files (harmless data; consumers ignore it).

---

### Task 1: Live-code reads (exact + tested)

**Files:** `audio_checker.py`, `build_motion.py`, `lint_shots.py`, `breath.py`, `audio-tokens.json` (+ delete `test_lint_beat_type.py`)

- [ ] **Step 1: `audio_checker.py`** — delete the two `beat_type == "gravity"` checks (`has_gravity` + the gravity-span "music should be dry" check, ~lines 43–52). Human-cost pull-back is now an authored `dry`; the checker no longer derives a gravity span. Update `test_audio_checker.py` (remove the gravity-warning test).
- [ ] **Step 2: `build_motion.py`** — remove `WHIP_BEAT_TYPES`; in `derive_shots` drop `beat_type = shot.get(...)`, make `entrance` always `"cut"` (delete the whip branch), and remove `"beat_type": beat_type` from the emitted shot dict. `camera_from_beat_type` already ignores its arg — rename its param to `_bt` (or keep; it stays a locked-camera stub). Keep `beat` (narrative-position metadata) untouched.
- [ ] **Step 3: `lint_shots.py`** — delete the `BEAT_TYPES` set + `beat_type_check()` + its call in the lint runner + any "beat_type REQUIRED" doc line. `git rm .claude/skills/visual-prompt-writer/scripts/test_lint_beat_type.py`.
- [ ] **Step 4: `breath.py`** — `breath_gaps` is dead (returns []). Delete the function; in `build_motion` replace `beat_gaps = breath_gaps(...)` with `beat_gaps = []` (drop the import + the `breath_s_by_beat` arg). Keep `shift_timings`/`splice_silence` (cue pauses use them). Update `test_breath.py` (drop the `breath_gaps` test + the `beat_type` field in its SHOTS).
- [ ] **Step 5: `audio-tokens.json`** — delete the dead keys `beat_type_sfx` + its `_note`, and `breath_s_by_beat` + `_breath_note`'s beat_type framing (rewrite the note to "authored `pause` cues"). Keep everything else.
- [ ] **Step 6: Run the full render-builder + VPW test suites — all green.**
Run: `for t in test_build_audio test_build_motion test_breath test_audio_checker test_audio_plan test_sfx_snap test_lint_audio_plan; do py -3 .claude/skills/render-builder/scripts/$t.py; done` + `py -3 .claude/skills/visual-prompt-writer/scripts/test_lint_shots.py` (if present).
- [ ] **Step 7: Re-render `_chain-test` — no beat_type, still sounds identical (spot-check the audioSpec).**
- [ ] **Step 8: Commit** — `git add` the changed scripts + tokens + `git rm` the deleted test; commit `refactor: delete beat_type from the live code (audio-director phase 4)`.

---

### Task 2: Doc / description sweep (retire the language)

Edit each in place — remove/replace the beat_type reference with the current reality (camera locked; audio authored by `audio-director`):

- [ ] **`visual-prompt-writer/SKILL.md`** — delete the "Pick `beat_type`" step; VPW no longer authors any audio/treatment field.
- [ ] **`visual-prompt-writer/references/shots-schema.md`** — delete the `beat_type` field from the shape + its note + the example values + the "REQUIRED, lint-enforced" line.
- [ ] **`render-builder/references/motion-schema.md`** — remove beat_type from the shot shape/derivation + the audioSpec note (audio is authored, not beat_type-derived).
- [ ] **`render-builder/references/audio-cues-schema.md`** — remove beat_type grounding refs (or fold into `audio-plan-schema.md` if it's now redundant).
- [ ] **`render-builder/SKILL.md`** — lines ~39/98/99: camera is locked (not beat_type-driven); audio is authored by `audio-director` (not derived from beat_type).
- [ ] **`motion-planner/SKILL.md`** — drop `beat_type` from the classification grounding (use `shot_class`/content).
- [ ] **`knowledge/research/niche-playbooks/universal.md §13a-iii`** — **retire the 12-slug beat_type→treatment TABLE** (the field is gone); keep the measured law and §13a-iii.8 verbatim, reframed as the audio-director's guidance, not a beat_type map.
- [ ] **`.claude/skills/README.md`** — the VPW row: drop beat_type; the audio row is already `audio-director`.
- [ ] **`motion-tokens.json`** (`_note` line 38) + **`audio-analyzer`/`image-generation`/`sfx-forge` SKILL descriptions** + **`visual-grammar.md`** (lines 143/152) + **`knowledge/research/growth-optimization.md`** (line 96): replace each `beat_type` mention with the current phrasing (camera locked / audio-director / the emission layer). Small, one-line edits.
- [ ] **Commit** — `docs: retire beat_type language across skills/schemas/grammar (audio-director phase 4)`.

---

### Task 3: `CLAUDE.md` status + `decisions.md` + grep→zero (Phase 5 hygiene)

- [ ] **Step 1: `CLAUDE.md`** — update the status: the audio-director rework is built (unified plan · one director skill · structural sounds → judgment · element-sync · consistent motifs · beat_type deleted); fix the skills roster count (audio-cue-writer + music-cue-writer retired → audio-director; net 14). Integrate into the audio bullet, don't append.
- [ ] **Step 2: `knowledge/decisions.md`** — one dated entry: the audio-director rework (beat_type deleted; audio-plan unified; the element-sync + consistent_sfx + pop/whoosh-rare learnings; ear-gated on `_chain-test`).
- [ ] **Step 3: `curate-doc` pass** on any touched doc that drifted (esp. `motion-schema.md`, `universal.md §13a-iii`, `render-builder/SKILL.md`).
- [ ] **Step 4: grep→zero verification** — `grep -rl "beat_type" .claude knowledge CLAUDE.md channels/*/visual-kit | grep -vE "decisions.md|handoffs|/videos/"` returns **nothing**. Fix any stragglers.
- [ ] **Step 5: Commit** — `docs: audio-director rework complete — status + decisions + beat_type grep-zero (phase 5)`.

---

## Done — beat_type is gone; the audio-director rework is complete + hygiene-swept.
