# `audio-cue-writer` — the LLM audio-cue author + critic (2b fast-follow) — Design

**Date:** 2026-07-11 · **Status:** brainstormed, approved (design). **Scope:** the skill that makes Phase-2b
autonomous — it reads a scripted + storyboarded video and PROPOSES its `audio-cues.json` (the content-nuanced
audio layer: number-reveal punch, aside→sting, money→cash, deflate→womp, pivot→scratch, and the *withholds*),
then a fresh-eyes critic tightens it. The 2b *mechanism* is already built + ear-gated
(`…2026-07-11-sfx-emission-2b-authored-cues-design.md`); this doc designs the *author* on top of it.

## Why this exists / the goal

2b's mechanism works, but until now the cues are hand-authored per video — a manual step on every render, which
defeats the autonomous-pipeline goal. This skill authors the cues from the script + shots, so the pipeline stays
hands-off; the human still **ear-gates FEEL** on the render ([[audio-taste-is-human-judged]]). The author decides
**placement** (a text judgment — "this line is a money reveal", "this is human cost, stay silent"), never mix or
"feel" (which it can't hear).

## Model (settled during brainstorming)

- **Grounded in `beat_type`, not free-guessed.** The author walks `shots.json` and uses the already-authored
  `beat_type` per shot as the primary signal for where content-audio belongs (number-reveal→a punch;
  aside→optional sting; gravity/dialogue→**withhold**), plus a script scan for money-words / deflations / pivots.
  Placement is tied to signals the pipeline already produced — lowest variance, most consistent.
- **Timid by default.** Fewer SFX — *not none, not everywhere*. The correct failure direction is under-proposing
  (the human adds a cue they want) over carpeting (the human hunts for cues to cut). Restraint is the whole game;
  a whole section with no cue is a valid, common answer.
- **Fresh-eyes critic, then one revise; the ear-gate is the only human gate.** Matches the proven
  `long-form-writer` layer (a dispatched fresh-context critic + a mechanical lint), NOT self-checked prose rules
  ([[fix-generation-not-prohibitions]]). No paper checkpoint on the cues — cues can only be judged by hearing
  them, so the human gate is the rendered video.
- **Placement, not mix.** The author proposes `anchor` + `role` + `in_pause?` + a sensible `pause_s`; it leaves
  `gain_db` at the role default unless there's a clear reason. Levels/feel are the human's ear-tune.
- **No VO dependency.** Cue `anchor`s are verbatim *script* phrases (the same text `vo_ref` uses), so the skill
  runs after `visual-prompt-writer` in parallel with `voiceover`; a lint verifies anchors against the script
  word-stream (no timed audio needed).

## Pipeline slot

`visual-prompt-writer` (writes `shots.json`) → **`audio-cue-writer`** (writes `audio-cues.json`) ∥ `voiceover` →
`render-builder` (consumes both). It reads `shots.json` for `beat_type` + `vo_ref`; writes only
`videos/<slug>/audio-cues.json`. Absent output = render is a clean no-op (2b back-compat), so the skill is
strictly additive — no existing video breaks if it never runs.

## The mechanism (what this skill builds)

### Inputs
`script.md` (VO text) · `shots.json` (`beat_type` + `vo_ref` per shot) · `dna.md` (the channel register/comedy
dial) · the measured grammar (`universal.md §13a-iii.8`) + `audio-tokens.json` (which roles exist + their gains)
· the contract `render-builder/references/audio-cues-schema.md` · the **gold exemplar** (below).

### Flow (the skill orchestrates all of it; the human only ear-gates the render)
1. **Draft (grounded).** Walk `shots.json` in narration order. Map each `beat_type` to a cue *intent*
   (number-reveal → a punch (cash/boom) on the number · aside → an optional sting · gravity/dialogue → withhold,
   emit nothing) and scan the shot's VO span for money-words → cash, deflations → womp, hard pivots → a
   record_scratch with `in_pause`. **Anchor each cue to its shot's `vo_ref` opening words** (sync-to-image; the
   schema's sync rule). Timid: propose few; prefer to skip.
2. **Fresh-context critic** (`references/critics.md`). A dispatched subagent reads the draft + `script.md` + the
   grammar + the gold exemplar and returns findings on: over-cueing (restraint), wrong role (e.g. a womp on a
   line that isn't a deflation), a reveal SFX not synced to its image shot, a cue on a gravity/human-cost line
   (withhold-violation), and redundancy with 2a's structural SFX (whoosh/pop/boom-on-chapter/tick — those are
   auto-fired, never authored here).
3. **Revise once** against the findings → write `videos/<slug>/audio-cues.json`.
4. **Mechanical lint** (`scripts/lint_audio_cues.py`, hermetic-tested). Mirrors the render matcher and HARD-fails
   on: an `anchor` that doesn't resolve against the script word-stream (verbatim first-4-words), a `role` absent
   from `sfx_pools`, a cue with neither `role` nor `pause_s`, an `in_pause` with no `pause_s`, or cues out of
   narration order. This is the *derived* guardrail — a mechanical check, not a self-checked rule.
5. Human **ear-gates the render** (the only human gate).

### The gold exemplar
The `_chain-test` `audio-cues.json` you approved at the 2b ear-gate is the reference, carried into the skill with
a one-line *why* per cue (crash synced to the fiction image + held before the grim turn · scratch-in-pause on the
"so what happened" pivot · cash on the number · **and the withhold** on the human-cost line). It shows the target
density (sparse) and the two idioms (`in_pause`, sync-by-`vo_ref`). Positive exemplar, not a prohibition list.

### Scope boundaries (what it does NOT do)
Structural SFX (2a owns whoosh/pop/boom-on-chapter/thud/tick) · music / bed behavior (Phase 3) · device-card
overlays and their pop/riser/pluck (2c) · picking exact gains/pauses by "feel" (the human ear-tunes).

## Files touched + cross-file consistency (pitfall map)

- Create `.claude/skills/audio-cue-writer/SKILL.md` — the orchestration. **Points to** the schema contract (does
  NOT restate it — no redundant copy that can drift); states the grounded-draft → critic → revise → lint flow +
  the timid-by-default principle + the gold exemplar.
- Create `.claude/skills/audio-cue-writer/references/critics.md` — the critic's rubric/prompt (the five checks
  above), phrased as what GOOD looks like + the specific defects to catch.
- Create `.claude/skills/audio-cue-writer/scripts/lint_audio_cues.py` + `test_lint_audio_cues.py` — the mechanical
  gate; **reuses** `render.match_shots_to_tokens` / `_NORM` (the ONE matcher — no second implementation).
- Register the skill consistently in EVERY place the skill roster lives, same wording: `.claude/skills/README.md`
  (the skill list + design rules) and `CLAUDE.md` (the "Skills built" count + the pipeline/routing table row).
  Cross-file-consistency check: the count and the pipeline description must agree across both.
- The gold exemplar: reference `_chain-test`'s cues (annotated) from `SKILL.md`; the schema contract stays the
  single source for the field semantics.

**No new schema, no new render code** — the skill only *produces* the existing `audio-cues.json` contract.

## Guardrails (file-editing discipline — binding on the implementation)

- **Integrate, don't append.** Every doc edit (CLAUDE.md, README, decisions) goes into the right section,
  superseding what it replaces — no dated log-blocks, no bolt-on contradictions ([[keep-docs-structured]]).
- **Cross-file consistency.** The skill-count, the skill list, and the pipeline routing must agree wherever they
  appear; update all together in one commit.
- **No redundant / dead info.** SKILL.md points to `audio-cues-schema.md` for field semantics instead of copying
  them (a copy drifts). No stale references; no orphaned examples that don't teach how a principle applies.
- **Positive/structural over prohibitions.** Author + critic instructions say what GOOD placement is (grounded,
  timid, synced) and name concrete defects to catch — not a wall of "don't" rules a self-editor shares a blind
  spot with ([[fix-generation-not-prohibitions]]).
- **Derived, not authored.** The lint's checks are mechanical/derived (mirror the matcher); they do not become
  authoring pressure that changes how the author conceives a cue ([[derived-fields-not-generation-targets]]).
- **Skills do the work.** The artifact (`audio-cues.json`) is produced by the skill/agents, not hand-written per
  video ([[skills-do-the-work]]); the hand-authored `_chain-test` file remains a fixture/gold exemplar only.
- **Explicit-path commits on `master`.** Parallel terminals share this tree — stage exact paths, never
  `git add -A`, never rewrite history ([[parallel-terminals-stage-explicit-paths]]).

## Testing / validation

- **Hermetic unit tests** for `lint_audio_cues.py` (plain-assert, repo convention): an anchor that resolves
  passes; an unresolvable anchor HARD-fails; a role absent from `sfx_pools` fails; a role-less + pause-less cue
  fails; `in_pause` without `pause_s` fails; out-of-order cues fail; a valid file passes clean.
- **End-to-end dogfood (human ear-gate):** run the skill on a REAL video (a front-half batch video, e.g. the
  Pearlman slug) → it proposes `audio-cues.json` → render → you ear-gate. Success = it lands the number-reveal
  punch + a couple of tasteful hits, withholds on human cost, and reads *sparser* than a hand pass, with no
  lint failures and no wrong-spot cues surviving the critic. This is the acceptance gate.

## Self-review

- **Placeholders:** none — the flow, the five critic checks, the lint rules, and the file map are all concrete;
  the only human step is the deliberate ear-gate.
- **Consistency:** grounded-in-beat_type matches the draft step + the critic's withhold check; timid-by-default
  matches the critic's over-cueing check + the sparse gold exemplar; "placement not mix" matches leaving
  `gain_db` at default. The lint reuses the one matcher (no divergence from render timing).
- **Scope:** one implementation plan's worth (a SKILL.md + a critic doc + a lint + tests + registry updates + an
  e2e dogfood gate). Music, device-cards, and gain-by-feel are correctly out.
- **Ambiguity:** "grounded" pinned to the `beat_type`→intent map + a script scan; "timid" pinned to
  under-propose + a valid empty-section; the human gate pinned to the rendered video (no paper checkpoint).
