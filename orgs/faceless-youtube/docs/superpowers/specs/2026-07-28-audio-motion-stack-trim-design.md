# Audio/VO/Motion/Render-Stack Trim — Design Spec (2026-07-28)

**Goal:** cut the 16 doctrine files governing audio direction, SFX/music sourcing, voiceover, motion
planning, and rendering from ~1,510 lines to ~1,050, preserving every current behavior and learning.
Wave 2 of the doc-trim program; wave 1 (visual stack) is the precedent and its rulings carry over.

**Daniel's rulings (binding, carried from the visual-stack trim + this wave's brief):**
1. Learnings fold into rule wording — no changelogs, no provenance tails, no "Daniel-confirmed
   2026-XX-XX" / "R8/R10 correction" / "chunk-1 evidence" narration.
2. Retired features live ONLY in `docs/retired-features.md`; governing files state current behavior
   positively (at most one archive pointer).
3. Zero examples (contract JSON skeletons are the contract, not examples — they stay).
4. Don't-lists → do-rules where meaning allows.
5. Code files (`build_motion.py`, `render.py`, `voiceover.py`, engine components, lint/forge scripts)
   are out of scope except where a doc contradicts code — docs must match code reality.
6. Channel research logs (`visual-kit/research/*`, `voice-lab.md`) are OUT of scope (Daniel 2026-07-28).
7. Data files (`audio-tokens.json`, `motion-tokens.json`, `animation-menu.json`, `vocabulary.json`,
   `music-buckets.json`, `videos.json`) are out of scope — docs reference, never restate, their contents.

## Honest scale note

This stack is already far leaner than the visual stack was (largest file 164 lines). The cut is ~30%,
concentrated in retirement narration, cross-file law duplication, and provenance prose — not in
procedure, which is mostly already terse.

## Target architecture — one home per law

| File | Now | Target | Owns after trim |
| --- | --- | --- | --- |
| render-builder/SKILL.md | 138 | ~100 | Pipeline position, run commands + flags, engine guarantees, render.py role, handoff. The two near-duplicate scenes-mode/placeholder paragraphs merge into one. |
| render-builder/references/motion-schema.md | 164 | ~110 | The motion.json contract + field-derivation table + token-block table. The ~30-line audioSpec cell shrinks to ~8 lines + audio-plan-schema pointer; chapter-card mechanics stated ONCE here OR in shots-motion-schema (pick one home, other points); parked-component prose (§3, `card`/`type_on`/`audio_layer` rows, T2 legend) → retired-features + positive one-liners. |
| render-builder/references/shots-motion-schema.md | 129 | ~95 | The shots.motion.json contract: per-shot fields, hybrid, reuse, cards (if chosen as the card home), materialized-asset layout. Absorbs animation-menu's 5 live lines (cutout-only family, draw_line is the one engine-drawn element, prove-then-extend rule). Boundary-rule restatement → pointer to universal §13a-ii. Retired section → archive. |
| render-builder/references/animation-menu.md | 19 | **DELETED** | Content folds into shots-motion-schema; `animation-menu.json` (data) untouched; all pointers updated. |
| render-builder/references/audio-plan-schema.md | 127 | ~100 | THE home for cue kinds/fields, pause-vs-dry, SFX-tail law, sentence-gap law, realizer-owned behaviors, QA block. Example JSON deleted; retired-tag narration ("[PAUSE] retired R8-B") becomes positive statements + archive entry. |
| motion-planner/SKILL.md | 95 | ~75 | The 7-step procedure. Step 2's boundary restatement → 3 lines + universal §13a-ii pointer; Step 3's supplied-text/lettering restatement → the two subtraction-specific corollaries (carry literals verbatim/uncased; strip production vocabulary when subtracting) + shots-schema §4 pointer, narratives deleted. |
| motion-planner/references/animation-rules.md | 163 | ~110 | When-to-layer rules, anchor law, anchor-origin table, dot density, stays-baked list, decomposition-by-subtraction. Boundary stated once (its planner-application form); chunk-1/M16/L15-17 provenance folded into rule wording; Deferred shared-base section compressed to ~6 lines (it is a pinned Daniel preference, not retired). |
| motion-planner/references/critics.md | 31 | ~30 | Kept; already lean. |
| voiceover/SKILL.md | 108 | ~85 | Run commands, guarantees, config-lives-in-dna, new-channel voice guidance (compressed). Marker list stated once (contract owns detail). |
| voiceover/references/voiceover-contract.md | 141 | ~105 | dna.md config block, lever starting-points table, marker rules, delivery-target rules (dated measurement essays folded into the rules: pitch-not-volume, persona-pace + pause-share, pauses-short-and-structural), manifest contract, failure modes. |
| audio-director/SKILL.md + references/grammar-guidance.md | 158 | **merged → ~110** | One SKILL.md: the four cue kinds (pointer to schema for fields), procedure, guardrails, and the placement laws now in grammar-guidance (card fades, long fades, bed rotation <3 min, human-cost register, no-dip-in-pause, structural-sound seed rules, sync:element, pin discipline). Mechanics duplicated from audio-plan-schema (SFX-tail, sentence-gap details) become pointers. grammar-guidance.md deleted; pointers updated. |
| audio-director/references/critics.md | 23 | ~23 | Kept. |
| audio-analyzer/SKILL.md | 65 | ~55 | Kept structure; hallucinated-inventory story folds into the rule ("tools produce numbers; the model never listens"). |
| sfx-forge/SKILL.md | 59 | ~55 | Kept; minor dedup. |
| music-forge/SKILL.md | 92 | ~65 | Division-of-labor/human-taste stated ONCE (currently 3×); register rules kept; retrack provenance folded. |

Totals: ~1,510 → ~1,050 (±20% per file), two files deleted, one merged.

## Method + guardrails (wave-1 method verbatim)

- Single-home map first; `curate-doc` discipline (map learnings → rewrite → verify nothing dropped).
- **Every code/lint-enforced rule stays stated in exactly one doc.** The enforced set here:
  `lint_motion_plan.py` (schema/menu/shot-id/cutout-prompt checks, lineage backstops, baseline_life +
  camera validation, supplied-text + lettering via lint_shots import); `lint_audio_plan.py` (0-errors
  gate); `motion_plan.py::validate_plan` (cutout-only source, card errors); voiceover.py marker
  validation (exact marker set, adjacency/mid-sentence hard errors); build_motion/audio realizer laws
  (card-on-silence pause alignment, pause-inserts vs dry-carves, SFX-tail WARN, sentence-gap engine
  behavior, pinned-file hard error, publish gating, scenes-mode hard error); frontmatter descriptions
  byte-unchanged on all SKILL.md files.
- Docs-match-code: where a doc contradicts current code behavior, the doc is corrected to code (report
  each instance) — never the reverse.
- Pointer integrity grep after every deletion/merge (animation-menu.md and grammar-guidance.md inbound
  pointers especially — grep the whole skills tree + channel docs).
- Out of scope: everything not in the table (VPW/image-gen/style-bible wave-1 files, research logs,
  data JSONs, code, publish/compliance skills).

## Acceptance

1. Line counts within ±20% of targets; total ≤ ~1,150.
2. Zero examples / provenance dates / retirement prose in the 14 surviving files;
   `docs/retired-features.md` gains the motion/audio entries (T2 device-card token rows + type_on,
   whip entrance, audio_layer motion-tokens block, [PAUSE]/[BEAT] TTS tags, 2s SFX truncation,
   human-cost dry pull-back).
3. `animation-menu.md` and `grammar-guidance.md` deleted with zero dangling inbound pointers.
4. All audio/motion/render/voiceover script tests pass (`test_measures.py`, `test_beat_map.py`,
   sfx-forge `test_*.py`, render-builder + motion-planner + voiceover test files where present).
5. Fresh-eyes comprehension probe from trimmed files only: the four cue kinds + pause-vs-dry; the
   SFX-tail levers; the delta-vs-layer decision + hybrid plate reuse; anchor vs anchor_origin; the
   voiceover marker set + config source; card-on-silence law; what the engine guarantees at render.
6. decisions.md entry + STATUS.md line.
