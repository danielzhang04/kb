# Visual-Stack Trim — Design Spec (2026-07-28)

**Goal:** cut the files governing visual prompting + image generation from ~2,900 lines to ~1,220
while preserving every current behavior and learning, so (1) the file system stops being bloated and
(2) future image-gen runs aren't bogged down by context that makes them lose sight of the task.

**Daniel's rulings (2026-07-28, binding):**
1. Learnings fold into the actual rule logic. No changelogs, no provenance tails ("measured
   2026-07-16", "human-caught"), no dated appendages. A good learning becomes the rule's wording.
2. Retired features move OUT of governing files into one archive file that stores what/why/where
   the code is parked, for possible re-implementation. Workflow files purge all retirement prose.
3. universal.md §13–§13a-iii gets the full trim now, including the measured motion/audio grammar.
4. Zero examples anywhere — no worked walkthroughs, no BAD/GOOD blocks, no sample JSON scenes.
5. General trim style: concise prose, dead/duplicate bullets removed, no-impact sections removed,
   misplaced functionality moved to its right home, don't-lists rephrased as "do" rules where
   meaning allows.

## Target architecture — one home per law, pointers elsewhere

| File | Now | Target | Owns after trim |
| --- | --- | --- | --- |
| `.claude/skills/visual-prompt-writer/references/shots-schema.md` | 421 | ~140 | The shots.json contract, field→engine mapping, source taxonomy, supplied-text law + lettering rules (terse). Deleted-fields note becomes a one-line pointer to the archive. |
| `.claude/skills/visual-prompt-writer/SKILL.md` | 555 | ~200 | The authoring laws stated ONCE each + the Step 0–8 procedure. Loses restatements of schema laws, §2d/§2e clause duplication (pointer to style-bible), lettering essays, the Wells Fargo narrative (the rule absorbs the lesson), all examples. |
| `.claude/skills/visual-prompt-writer/references/critics.md` | 134 | ~100 | The critic charter + orchestration. War stories and law-map commentary compressed. |
| `.claude/skills/image-generation/SKILL.md` | 503 | ~200 | Modes, Pass 0/1/2, technique table, batched review, single-asset loop, report. Seed doctrine deduped to a pointer at style-bible §5; both worked examples and all retirement narratives deleted. |
| `channels/the-second-take/visual-kit/style-bible.md` | 775 | ~300 | Identity/rig, the five verbatim descriptor blocks (**byte-identical** — refs were generated against them), §3 rig checklist, §4 palette, §5 seed rules (canonical home, absorbing any unique learning currently only in image-gen SKILL), §6 recipe, §7 library spec, §8 protocols with learnings folded into rules, §9 registry. **§10 change log deleted entirely.** |
| `channels/the-second-take/visual-kit/visual-grammar.md` | 197 | ~120 | Staging conventions, composition, lever translation. §4 motion-dials shrinks to the one line VPW needs (locked camera, hard cuts, no long-form captions) — the rest is motion-planner's domain. |
| `knowledge/research/niche-playbooks/universal.md` §13–§13a-iii | ~300 | ~120 | §13 production universals + §13a narration→shot-class table + core doctrine, compressed. §13a-i rewritten to current reality (no `within_shot_motion` — deleted field). §13a-iii's measured evidence goes; surviving dials already live in motion-planner / audio-director guidance and `audio-tokens.json`. |
| NEW `docs/retired-features.md` | — | ~40 | One entry per retired capability — engine text overlays + device cards, camera/motion authoring fields (`ken_burns`, `within_shot_motion`, transition/treatment enums), posed-character merge tier, flash engine tier — each with: what it was, why retired, where code is parked, what to re-verify before reviving. |

## Method + guardrails

- **Single-home map first.** Before rewriting, each worker maps every rule/learning in its files to
  its ONE home (this table) so nothing is lost and nothing is stated twice. `curate-doc` discipline:
  map learnings → rewrite structured → verify nothing dropped.
- **Lint/code stays authoritative.** Every rule `lint_shots.py` or `forge.py` mechanically enforces
  must remain stated in exactly one doc. Acceptance includes a code-rule→doc cross-check and both
  test suites passing (`test_lettering_fidelity.py`, `test_text_supply_check.py`, plus the other VPW
  and image-gen script tests).
- **Descriptor blocks §2/§2b/§2c/§2d/§2e stay byte-identical** (operational payload sent to the
  engine; the reference frames were generated against these exact words).
- **Pointer integrity.** After the move, grep-verify: no file references a deleted section (§10, the
  removed examples, `personable`-style stale anchors); every "see X §N" resolves.
- **No behavior change.** This is a rewrite of doctrine PROSE. shots.json schema fields, lint
  behavior, forge.py behavior, and all locked values are unchanged. Any wording that turns out to be
  the only statement of a lint-enforced rule is kept (tersely), never dropped.
- **Out of scope:** audio/motion/render/remotion files (motion-planner, audio-director,
  render-builder, audio-analyzer docs) — a later pass; scripts/code logic; registry.json and other
  data files; the scripting-overhaul work already on this branch.

## Acceptance

1. Line counts at or near targets (±20%); total ≤ ~1,400.
2. Zero examples, zero changelog/provenance blocks, zero retirement prose in the seven governing
   files; `docs/retired-features.md` exists and carries all of it.
3. Descriptor blocks byte-identical (diff the five blockquotes pre/post).
4. All VPW + image-gen script tests pass; code-rule→doc cross-check written into the run report.
5. Cross-file pointer grep clean.
6. A fresh-eyes review agent, given only the trimmed files, can restate: the seven authoring laws,
   the supplied-text law, the seeding order for a composed scene, the three-tier rig model, and the
   delta-vs-layer boundary — proving the trimmed stack still teaches the pipeline.
