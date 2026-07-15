# SFX Emission Phase 2b — Authored Content Cues — Design

**Date:** 2026-07-11 · **Status:** brainstormed, approved (design). **Scope:** the **mechanism** for the
authored content/comedic audio layer — hand-authored first, ear-gated, THEN the LLM author + critic as a
fast-follow. Follows Phase 2a (deterministic structural SFX, done: `…2026-07-10-sfx-emission-phase-2-design.md`),
which is the umbrella Phase-2 spec; this doc is the detailed 2b design that spec's "Phase 2b" section pointed to.

## Why this exists / the goal

2a auto-fires only the **reliable** structural SFX (scene→whoosh, chapter→boom, delta-add→pop, …). The
**content-nuanced** hits it correctly refused to automate — the number-reveal *punch*, `aside`→sting,
money-word→cash, a womp on *this* deflating line — live at a **word**, not a shot boundary, and only "belong"
where the *content* warrants (firing them off a coarse `beat_type` is the "weird in the wrong spot" failure).
2b adds the layer that places those precisely and deterministically-once-authored: a human (later an LLM step)
reads the content and drops a cue; the engine renders it deterministically; the human gates FEEL by ear
([[audio-taste-is-human-judged]]).

## Model (settled during brainstorming)

- **Structural boundary = automatic (2a); content position = authored (2b).** The number-reveal breath was the
  one content-position beat masquerading as structural — it **moves to an authored cue** here (chapter-boundary
  breath stays automatic; it *is* a shot boundary and lands correctly).
- **One authoring surface, separate from `shots.json`** — `audio-cues.json` (keeps `visual-prompt-writer`
  focused on visuals; no overload). Read by the render, not baked into the visual plan.
- **Deterministic rendering; authored placement.** A cue's *placement* is a content judgment (hand/LLM); once
  authored, its render is fully deterministic (word-anchored, fixed role/gain/pause). No probabilistic firing.
- **VO stays the master clock; only additive breath-gaps mutate the timeline** — a cue's `pause_s` reuses the
  same additive-gap primitive as the beat_type breaths (shifts downstream once, ripples correctly).

## The mechanism (this is what 2b builds)

### 1. `audio-cues.json` (new per-video input)

```json
{ "cues": [
  { "anchor": "eight million acres", "role": "cash", "pause_s": 0.5 },
  { "anchor": "and it was all gone", "role": "womp", "pause_s": 0.6, "gain_db": -7 }
] }
```
- **`anchor`** (required) — a **verbatim VO phrase** (a mini-`vo_ref`), resolved to a precise word time by the
  shared matcher. Cues are in narration order; a **cursor-advancing** resolve makes a repeated phrase hit
  successive occurrences (same discipline as the shot `vo_ref` matcher).
- **`role`** (optional) — any SFX role in `sfx_pools` (cash/sting/womp/boing/record_scratch/boom/ding/…).
- **`pause_s`** (optional) — a breath (silence gap) inserted at the anchor word.
- **`gain_db`** (optional) — per-cue level override (else the role's `sfx_gain_db`).
- **Validity:** at least one of `role`/`pause_s`. A dangling role (not in `sfx_pools`) is dropped + counted
  (the existing missing-file/`sfx_missing` defense covers the file side).

### 2. Cue resolution + routing (`build_motion`)

`build_motion` reads `audio-cues.json` (absent → no-op), resolves each `anchor` → a word time on the ORIGINAL
timeline (via the shared matcher over `word_timings`), then routes each field to its lane — the same split the
whole audio layer uses:
- **`pause_s` → the generalized breath.** Fed into `breath_gaps` alongside the beat_type (chapter-boundary)
  breaths; `shift_timings`/`splice_silence` already handle arbitrary gap times, so a cue-pause at an arbitrary
  word Just Works. The 2a **full-stop** then auto-dips the bed to silence + drops other SFX inside that gap.
- **`role`/`gain_db` → an event** at the (breath-shifted) word time, merged into `build_audio`'s events (so
  density-cap / register-withhold / missing-file defense all still apply).

### 3. Number-reveal migration (structural → authored)

- Remove `number-reveal` from `audio-tokens.json breath_s_by_beat` → **no more automatic number-reveal breath**.
- The number-reveal emphasis becomes an **authored cue** on the number word: `{anchor: "<the number phrase>",
  role: <punch>, pause_s: <n>}`. Its dip falls out of the generalized full-stop (any breath gap dips the bed).
- `build_audio.sfx_events` already does NOT auto-fire a number-reveal hit (2a deferred it) — so nothing to
  remove there; only the auto *breath* goes. Chapter-boundary breath is untouched.

### Deferred (named, not forgotten)
- **2b fast-follow (after the mechanism ear-proves):** the **LLM audio-cue author** step (reads `script.md` +
  `shots.json` + the measured grammar → proposes `audio-cues.json`) + an **audio-cue critic** (fresh-eyes:
  "does this cue belong, is it too much, does the pause help or stall?"). Matches the writers-room critic
  pattern ([[fix-generation-not-prohibitions]]). Re-planned at its own gate.
- **Beyond 2b:** a cue `music` field / general music control (Phase 3 — the music lane); device-cards (2c,
  Remotion T3); the Phase-3 bed-behavior principles (dips fade not cut; stop = fade→pause→delayed resume).

## Files touched + cross-file consistency (pitfall map)

- Create `.claude/skills/render-builder/scripts/audio_cues.py` — load `audio-cues.json`, resolve anchors →
  `[{at_s, role, gain_db?, pause_s?}]` (pure resolve + a thin loader; reuses `render.py`'s matcher).
- Modify `.claude/skills/render-builder/scripts/breath.py` — `breath_gaps` accepts **cue-pauses** (gaps at
  arbitrary resolved word times) in addition to the beat_type breaths; merged + sorted; one shift.
- Modify `.claude/skills/render-builder/scripts/build_motion.py` — read `audio-cues.json`, resolve, feed
  pauses into `breath_gaps` and role-events into `build_audio_spec` (a new `cue_events=` param).
- Modify `.claude/skills/render-builder/scripts/build_audio.py` — `build_audio_spec` merges `cue_events` into
  `events` (so they inherit density/withhold/full-stop/missing-file).
- Modify `channels/the-second-take/visual-kit/audio-tokens.json` — drop `number-reveal` from `breath_s_by_beat`.
- Create `.claude/skills/render-builder/references/audio-cues-schema.md` — the `audio-cues.json` contract.
- Modify `.claude/skills/render-builder/references/motion-schema.md` — note `audio-cues.json` as an input +
  that cue-pauses join the breath mechanism, number-reveal breath now authored.
- Create `.claude/skills/render-builder/scripts/test_audio_cues.py` — hermetic tests.
- (fast-follow, not this plan) the author skill + critic.

**Guardrails:** integrate-don't-append the docs; no dangling roles (resolve against `sfx_pools`); a missing
`audio-cues.json` is a clean no-op (back-compat — every existing video still renders); cue anchors resolve by
the SAME matcher semantics as shot `vo_ref` (no second matcher); deterministic (no random/wall-clock); the
engine event schema is unchanged.

## Testing / validation

- **Hermetic unit tests** (`test_audio_cues.py`, plain-assert): a cue resolves to the right word time; a
  repeated anchor hits the successive occurrence (cursor); a cue-pause produces a gap at that word; a cue role
  becomes an event with its gain; a role absent from `sfx_pools` drops cleanly; no `audio-cues.json` → no-op.
  Plus `build_audio` tests that `cue_events` merge + inherit the full-stop.
- **Fixture ear-gate (human):** hand-author an `audio-cues.json` on a real slice (a money-word cash + a womp +
  a number-reveal punch), render, **you listen** and tune roles/gains/pauses by ear. This is the 2b acceptance
  gate. [[review-video-in-device-player]].

## Self-review

- **Placeholders:** none — the mechanism is fully specified; the LLM author + critic are a stated fast-follow
  (re-planned at their gate), not a TODO.
- **Consistency:** the "content position = authored" line matches the number-reveal migration; cue-pauses reuse
  the exact additive-breath primitive (no new timeline model); routing mirrors the 2a field-split.
- **Scope:** one implementation plan's worth (a resolver + breath/build_motion/build_audio wiring + a config
  drop + docs + tests + a hand-author ear-gate). The author/critic + music + device-cards are correctly out.
- **Ambiguity:** "anchor" pinned to a verbatim VO phrase resolved by the shared cursor-advancing matcher;
  "number-reveal" pinned to remove-auto-breath + authored-cue; "music" pinned to Phase-3 (not a 2b field).
