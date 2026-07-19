# PICKUP — layered-motion system + audio-director rework (2026-07-12)

> **▶ RESUME HERE (fresh terminal).** Two big builds this session. (A) The **layered-motion system** is
> COMPLETE (5 phases, committed, CLAUDE.md + decisions.md updated). (B) The **audio-director rework** is
> most of the way done: **Phases 1–3 + Phase-4 Task-1 DONE + committed**; **Phase-4 Task-2 (doc sweep) +
> Phase-5 (hygiene) REMAIN.** Resume = finish the `beat_type` deletion in the DOCS, then the hygiene sweep.
> The exact checklist is the plan: `docs/superpowers/plans/2026-07-12-audio-director-phase-4-5-beat-type-removal-and-hygiene.md`.

## A. Layered-motion system — DONE (context only)
A shot is now a `plate` + animated element **layers** (cutout: slide/path/bob/appear; engine-drawn). Built
across 5 phases (all committed): the `animation-menu.json` contract, `shots.motion.json` schema, `forge cutout`
(rembg), the engine `LayerView`, the **`motion-planner`** skill, and a hygiene sweep. Camera was decoupled from
`beat_type` (always locked). Proven E2E on Poyais L13 (MacGregor slides onto a stage plate) + L03 (ship paths a
map). Spec: `docs/superpowers/specs/2026-07-12-layered-motion-system-design.md`. **Already in CLAUDE.md +
decisions.md** — nothing left here.

## B. Audio-director rework — IN PROGRESS (resume this)
**Goal (user-set):** get audio OUT of the visual skill + reduce the pieces governing audio. **Delete
`beat_type` entirely** (it drove nothing after camera-decouple); one **`audio-director`** skill authors ONE
unified `audio-plan.json` (SFX·pause·music·dry) by judgment; the realizer (`build_audio`/`breath`) stays
deterministic. Spec: `docs/superpowers/specs/2026-07-12-audio-director-rework-design.md`.

### Done + committed:
- **Phase 1** — unified `audio-plan.json` (schema + `audio_plan.py` splitter + `lint_audio_plan.py`) read
  ADDITIVELY by `build_motion` (`split_plan` → the existing resolvers). Proven byte-identical round-trip.
- **Phase 2** — the **`audio-director`** skill (SKILL + `references/{critics,grammar-guidance}.md`); the two
  old cue-writers (`audio-cue-writer` + `music-cue-writer`) **retired/deleted**, README → one row.
- **Phase 3 (+3b)** — structural sounds (whoosh/boom/pop/thin/withhold/breath) **no longer auto-fired** —
  the director authors them; `register_audio` returns `([],[])`, `sfx_events` emits only overlay `tick`,
  `breath_gaps` deleted. Plus the ear-gate mechanism: **`sync:"element"`** snaps an item-SFX to the nearest
  cut/overlay (`snap_element_sfx`), a **clean music cut** into a switch (dry-abutting-switch = continuous
  silence), and **`consistent_sfx`** (whoosh/pop use ONE fixed variant, no rotation). **Ear-gated + approved
  by Daniel on `_chain-test`** (`.../videos/_chain-test/assets/final.mp4` = the reference render;
  `.../audio-plan.json` = the approved plan). Two items Daniel may iterate LATER (do NOT bake — "fine now"):
  the "so what happened" pivot feel + the sudden stop into "never came home".
- **Phase 4 Task 1** — `beat_type` deleted from the LIVE CODE (commit `4773a32`): `audio_checker.py` (gravity
  checks gone → fixed the 2 stale warnings), `build_motion.py` (whip entrance gone, entrance always "cut",
  `camera_from_beat_type`→`locked_camera`, no beat_type read/emit), `breath.py` (`breath_gaps` deleted),
  `lint_shots.py` (`BEAT_TYPES`+`beat_type_check` deleted; `test_lint_beat_type.py` removed), `audio-tokens.json`
  (`beat_type_sfx` + `breath_s_by_beat` keys deleted). All tests green.

### ▶ REMAINING (resume) — follow the Phase 4/5 plan:
1. **Phase 4 Task 2 — retire `beat_type` in the DOCS** (in place, no ghosts). The exact files (`grep -rl
   beat_type` confirms): `visual-prompt-writer/SKILL.md` (delete the "Pick beat_type" step) +
   `references/shots-schema.md` (delete the field); `render-builder/references/motion-schema.md` +
   `audio-cues-schema.md`; `render-builder/SKILL.md` (~L39/98/99); `motion-planner/SKILL.md`;
   **`universal.md §13a-iii`** (retire the 12-slug beat_type→treatment TABLE — **PRESERVE §13a-iii.8**, the
   measured audio grammar); `README.md` (VPW row); `motion-tokens.json` (`_note` L38);
   `audio-analyzer`/`image-generation`/`sfx-forge` SKILL descriptions; `visual-grammar.md` (L143/152);
   `knowledge/research/growth-optimization.md` (L96 "our beat_type/breath").
2. **Phase 5 Task 3 — hygiene:** update **CLAUDE.md** (audio-director rework built; skill roster: the 2
   cue-writers retired → `audio-director`, adjust the count) + a **decisions.md** entry (the rework: beat_type
   deleted, unified plan, element-sync + consistent_sfx + pop-additive/whoosh-rare learnings, ear-gated on
   `_chain-test`); `curate-doc` any drifted doc; then **`grep -rl beat_type .claude knowledge CLAUDE.md
   channels/*/visual-kit | grep -vE 'decisions.md|handoffs|/videos/'` → ZERO** (fix stragglers).
3. **Small residual:** `test_build_audio.py` still has ~6 harmless `beat_type` keys in TEST DATA dicts (lines
   ~67 comment, 68/74/76/81/131/149) — clean them for the grep→zero (they're ignored, but for hygiene).

## Learnings baked (durable, for future iteration)
- `feedback-is-a-learning-system` memory (generalized): real-video feedback → abstract → CONFIRM the
  generalization with the user → route to the durable layer → integrate in place; don't over-fit.
- Audio WHEN-logic is seeded in `audio-director/references/grammar-guidance.md` (whoosh RARE ~0–2/video;
  pop = additive-delta-elements not the base; item-SFX sync to their appearance) and REFINES via the
  ear-gate loop over real videos. `consistent_sfx` + element-sync are in `audio-tokens.json` / the schema.

## Warnings
- **Parallel terminals share this tree.** Stage explicit paths; never `git add -A`; never rewrite history.
- **PRESERVE `universal.md §13a-iii.8`** (measured audio grammar) — only the beat_type→treatment TABLE goes.
- Do NOT strip `beat_type` from existing video `shots.json` data (harmless; consumers ignore unknown keys).
- All audio binaries (sfx/beds/vo) are gitignored/local; `_chain-test` renders locally (assets present).
