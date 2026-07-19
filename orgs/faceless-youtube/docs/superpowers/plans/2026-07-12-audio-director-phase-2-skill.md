# Audio Director — Phase 2: the `audio-director` skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the `audio-director` skill — one authoring skill that emits the unified `audio-plan.json` (SFX + pause + music + dry), merging `audio-cue-writer` + `music-cue-writer` into one. Retire the two old skills. No render behavior changes (the plan format was proven identical in Phase 1); `beat_type` still exists.

**Architecture:** Phase 2 of `2026-07-12-audio-director-rework-design.md`. Mirrors the cue-writers' pattern (grounded draft → fresh-eyes critic → lint → human ear-gate; timid-by-default) but authors ONE file with two clearly-sectioned procedures (SFX/pauses, music/dry). The lint (`lint_audio_plan.py`) + splitter (`audio_plan.py`) already exist from Phase 1.

**Tech Stack:** Markdown (the skill + references). No new Python (Phase 1 built the machinery).

## Global Constraints

- Parallel terminals → explicit git paths, never `git add -A`.
- **No render behavior change** — the audio-director produces the same `audio-plan.json` the format already round-trips. `beat_type` untouched (Phase 4 removes it).
- Retire the two cue-writers by **deleting** their skill dirs (they're superseded) — but KEEP the resolver modules (`audio_cues.py`, `music_cues.py`) and their schema docs: those are the *realizer* layer `build_motion` still uses via `split_plan`. Only the *authoring* skills go.
- More do's than don'ts in the skill doc.

---

### Task 1: The `audio-director` skill (SKILL.md + references)

**Files:**
- Create: `.claude/skills/audio-director/SKILL.md`
- Create: `.claude/skills/audio-director/references/critics.md`
- Create: `.claude/skills/audio-director/references/grammar-guidance.md`

- [ ] **Step 1: Write `SKILL.md`** — frontmatter (`name: audio-director`; description: authors the unified `audio-plan.json` for a scripted+storyboarded video — SFX, pauses, music, dry — grounded in `shots.json` + script + the audio grammar; timid-by-default; runs after visual-prompt-writer / motion-planner, in parallel with voiceover, before render-builder; NOT the structural realizer) + the procedure:
  1. Read `shots.json` + `script.md` + `audio-tokens.json` (pools/dials) + `references/grammar-guidance.md` + `render-builder/references/audio-plan-schema.md`.
  2. **Draft, timid-by-default**, walking the script in narration order. TWO clearly-sectioned passes into ONE `cues` list:
     - **SFX + pauses:** place `sfx`/`pause` cues where content earns it (a money beat → cash, a hard pivot → record_scratch + `in_pause`, a reveal → a punch + a `pause`); WITHHOLD on human-cost/dialogue. The one you must not miss: the number/reveal punch.
     - **Music + dry:** segment into mood sections (few switches, let one run), `dry` on human cost. The one you must not miss: dry on human cost.
  3. **Fresh-eyes critic** (`references/critics.md`, fresh-context subagent) → apply fixes in ONE revise pass.
  4. Write `videos/<slug>/audio-plan.json`.
  5. **Lint (HARD):** `py -3 ../render-builder/scripts/lint_audio_plan.py <plan> <audio-tokens.json>` → `0 error(s)`.
  6. **Human ear-gate on the render** — FEEL is the human's call; levels/pauses/moods tuned there.

- [ ] **Step 2: Write `references/critics.md`** — the MERGED fresh-eyes checks (from both old critics): restraint (SFX ~4/57s ceiling; few music switches) · right role/mood vs meaning+register · sync (image-hits anchored to the shot's `vo_ref` opening words) · withhold/dry on human-cost/dialogue · boundary alignment (mood switches on section seams) · no double-fire with the render's remaining structural sounds · `pause`≠`dry` used correctly.

- [ ] **Step 3: Write `references/grammar-guidance.md`** — the audio-director's staging guidance, sourced from `universal.md §13a-iii.8` (bed placed ~79% not wall-to-wall; two ducking regimes; silence-as-scalpel; dips on ~⅓ of punchlines never all; selective breath ~0.55s on ~20% of events; density cap). This is GUIDANCE the director applies by judgment — the law stays single-sourced in universal.md; this doc points to it + gives the director its working rules.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/audio-director/
git commit -m "feat(audio-director): the unified audio-authoring skill (SKILL + critics + grammar guidance) (phase 2)"
```

---

### Task 2: Register + retire the two cue-writers

**Files:**
- Modify: `.claude/skills/README.md` (replace the two rows with one `audio-director` row)
- Delete: `.claude/skills/audio-cue-writer/`, `.claude/skills/music-cue-writer/`

- [ ] **Step 1: Update `README.md`** — remove the `audio-cue-writer` + `music-cue-writer` rows; add one `audio-director` row (authors the unified `audio-plan.json`; runs after visual-prompt-writer/motion-planner, before render-builder; timid-by-default; authors PLACEMENT, human ear-gates FEEL). Keep the row style consistent with the neighbors.

- [ ] **Step 2: Delete the two old skill dirs** (superseded; the resolver modules + schema docs stay).

```bash
git rm -r .claude/skills/audio-cue-writer .claude/skills/music-cue-writer
```

- [ ] **Step 3: Confirm nothing else imports the deleted skills' scripts.** `build_motion` imports `audio_cues`/`music_cues` (the resolver modules in `render-builder/scripts` — NOT the deleted skill dirs). Verify the render-builder suite still passes:

Run: `py -3 .claude/skills/render-builder/scripts/test_build_audio.py` → PASS.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/README.md
git commit -m "refactor(skills): retire audio-cue-writer + music-cue-writer, folded into audio-director (phase 2)"
```

---

## Phase 2 done — one `audio-director` authors the unified plan. Next: Phase 3 (absorb the structural sounds into judgment — the first ear-gate).
