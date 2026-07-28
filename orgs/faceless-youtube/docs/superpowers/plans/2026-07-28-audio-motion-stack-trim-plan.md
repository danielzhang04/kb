# Audio/VO/Motion/Render-Stack Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute `docs/superpowers/specs/2026-07-28-audio-motion-stack-trim-design.md` — 16 doctrine
files ~1,510 → ~1,050 lines, two files deleted, one merge, zero behavior change.

**Architecture:** Archive additions first, then the coupled render/motion/audio contract cluster in
sequence (one worker), the disjoint periphery in parallel (another), acceptance last.

**Tech Stack:** Markdown; `py -3` for script tests; grep sweeps.

## Global Constraints (spec §rulings — binding on every task)

- Zero examples (contract JSON skeletons stay; illustrative examples die — audio-plan-schema §Example,
  shots-motion-schema cards example, Poyais fixture mentions).
- Zero provenance/dates/supersession ("Daniel-confirmed 2026-XX-XX", "R8/R8-B/R10", "chunk-1
  evidence", "M16", "L12/L15-17", "human-caught", "(2026-07-0X correction…)"). The learning becomes
  the rule's wording.
- Zero retirement prose outside `docs/retired-features.md`; governing files state current behavior
  positively, at most one archive pointer each.
- Don't-lists → do-rules where meaning allows.
- **Enforced-rule floor** (each stays stated in exactly one doc): lint_motion_plan.py checks
  (schema/menu/shot-id/cutout-prompt, lineage backstops, baseline_life + camera validation,
  supplied-text/lettering via lint_shots import); lint_audio_plan.py 0-errors gate;
  motion_plan.py::validate_plan (cutout-only `source`, card errors); voiceover.py marker validation
  (the exact six markers, adjacency/mid-sentence hard errors, v3 tag translation / v2 strip);
  realizer laws (card-on-silence pause alignment, pause-INSERTS vs dry-CARVES, SFX-tail WARN +
  `fade_out_s`/same-anchor-pause levers, sentence-gap engine behavior + stacking, pinned
  variant/track hard error, publish gating, scenes-mode hard error + placeholder counting,
  `--allow-wide`-style flags as documented in each SKILL's command block).
- Frontmatter `description` blocks byte-unchanged on every SKILL.md.
- Docs-match-code: a doc↔code contradiction is corrected TO code and reported.
- Out of scope: code, data JSONs, research logs, voice-lab.md, wave-1 files, publish/compliance
  skills. Branch `claude/fyt-writer-grammar-slim`; explicit-path staging only; never touch files
  other workers own.
- All paths relative to `orgs/faceless-youtube/`.

## Single-home map

| Law | ONE home | Everyone else |
| --- | --- | --- |
| Delta-vs-layer boundary + ≤3 cap + same-location re-base | `universal.md §13a-ii` (wave-1) | motion stack states ≤3-line application + pointer |
| Supplied-text + lettering laws | `shots-schema.md §4` (wave-1) | motion-planner keeps ONLY the two subtraction corollaries + pointer |
| motion.json contract + derivation table + tokens table | motion-schema.md | render-builder SKILL points |
| shots.motion.json contract + cutout family + chapter cards | shots-motion-schema.md | motion-schema's cards prose → 2 lines + pointer; animation-menu.md content absorbed |
| audio-plan cue kinds/fields, pause-vs-dry, SFX-tail, sentence-gap, realizer-owned | audio-plan-schema.md | audio-director + motion-schema audioSpec cell point |
| Audio placement judgment (register, card fades, bed rotation, structural-sound seeds, pins, sync) | audio-director/SKILL.md (absorbing grammar-guidance) | schema points for mechanics |
| When-to-layer rules, anchors, anchor-origin, dot density, decomposition | animation-rules.md | motion-schema §4a + shots-motion-schema keep field syntax only |
| VO config/markers/manifest contract | voiceover-contract.md | voiceover SKILL summarizes in one line each + pointer |
| Retired capabilities | docs/retired-features.md | one pointer max per file |

---

### Task 1: Extend `docs/retired-features.md` (harvest first)

**Files:** Modify: `docs/retired-features.md`. Read-only: the 16 files.

- [ ] **Step 1:** Grep the 16 files for `retired|parked|dormant|legacy|superseded|no longer|RETIRED`
  and read hits in context.
- [ ] **Step 2:** Append entries (≤6 lines each, what/why/where-parked/re-verify): **engine device-card
  token styling** (`card` + `type_on` motion-tokens blocks feed only parked components); **whip
  entrance** (entrance is always `cut`); **`audio_layer` motion-tokens block** (superseded by
  audio-tokens.json — stale block ignored); **baked TTS pause tags** (`[PAUSE]`/`[BEAT]` retired for
  this channel; rhythm = prosody + engine sentence-gap + authored pause cues); **2s SFX truncation**
  (engine now plays full measured file length; tails shaped by `fade_out_s`/same-anchor pause);
  **human-cost dry pull-back** (bed runs through human-cost; register from track+level; comedic SFX
  still withheld); **`source:"engine"` motion layers** (extend the existing engine-text entry rather
  than duplicating it). Merge with the existing six entries — extend, never duplicate.
- [ ] **Step 3:** Verify ≤110 lines total, four fields per entry.
- [ ] **Step 4:** Commit: `git add docs/retired-features.md && git commit -m "docs(fyt): retired-features gains motion/audio entries (wave-2 harvest)"`

### Task 2: Render-builder cluster (SKILL 138→~100, motion-schema 164→~110, shots-motion-schema 129→~95, audio-plan-schema 127→~100, animation-menu DELETED)

**Files:** Modify: `.claude/skills/render-builder/SKILL.md`, `references/motion-schema.md`,
`references/shots-motion-schema.md`, `references/audio-plan-schema.md`. Delete:
`references/animation-menu.md`.

- [ ] **Step 1 — SKILL.md:** merge the duplicate scenes-mode/placeholder paragraphs ("What the engine
  guarantees" + "Visual generation is an upstream step") into one; keep every command + flag verbatim;
  delete the ken_burns/within_shot_motion retirement sentence (schema's deleted-note covers it);
  compress render.py section to ~4 lines.
- [ ] **Step 2 — motion-schema.md:** keep §1 skeleton + §2 derivation table + §5 tokens table.
  Delete the T1/T2/T3 tier legend (state positively: cutout layers are the live animation tier).
  audioSpec table cell → ~8 lines + audio-plan-schema pointer. §3 → ~6 lines: chapter cards live
  (pointer to shots-motion-schema for authoring law), captions separate track, all other overlay
  components + archive pointer. §5: delete the `card`/`type_on`/`audio_layer` rows (archive holds
  them); keep every live row's sub-keys.
- [ ] **Step 3 — shots-motion-schema.md:** boundary paragraph → 3 lines + universal §13a-ii pointer;
  absorb animation-menu's live content as a short "Animation vocabulary" section (data in
  `animation-menu.json`; cutout-only family appear/bob/slide/path; `draw_line` is the engine's one
  drawn element; extend by proving in Remotion then adding the JSON triple); chapter-cards section
  kept as THE card home, compressed ~25%; delete the example JSONs, the Poyais fixture line, and the
  Retired section (one archive pointer).
- [ ] **Step 4 — audio-plan-schema.md:** keep cue kinds, all field semantics, combining-stop-with-punch,
  SFX-tail law (once), sentence-gap law (once, "retired R8-B" → positive statement), realizer-owned,
  QA block. Delete §Example. Fold "the old hard 2s truncation…was retired R8" style narration into
  the rules.
- [ ] **Step 5:** `git rm .claude/skills/render-builder/references/animation-menu.md`; grep the whole
  repo-subtree for `animation-menu.md` and repoint every hit to shots-motion-schema's vocabulary
  section.
- [ ] **Step 6:** Verify: line counts; grep the four files for `2026-|retired|R8|R10|parked|dormant|
  Poyais|M16|chunk-1|superseded` → zero (archive pointer lines exempt); `grep -rn "animation-menu.md"`
  → zero hits outside git history.
- [ ] **Step 7:** Commit: `git add` the four files + the deletion; `git commit -m "refactor(fyt-render): motion/audio contracts deduped, animation-menu folded into shots-motion-schema, retirement prose out"`

### Task 3: Motion-planner cluster (SKILL 95→~75, animation-rules 163→~110, critics kept)

**Files:** Modify: `.claude/skills/motion-planner/SKILL.md`, `references/animation-rules.md`,
`references/critics.md` (light touch only).

- [ ] **Step 1 — SKILL.md:** Step 2's boundary text → 3 lines + universal §13a-ii pointer + the
  planner decision («DISCRETE AND seedable → layer; integrative → delta-chain; default passthrough»);
  Step 3's supplied-text block → the two subtraction corollaries (carry literals VERBATIM and
  case-exact into cutout/plate prompts; strip production-control vocabulary when subtracting; no
  value in source → cut the element and flag VPW) + shots-schema §4 pointer, all narratives deleted;
  keep steps 4–7 + lint command verbatim.
- [ ] **Step 2 — animation-rules.md:** boundary precondition once (~6 lines); per-trigger bullets
  kept, provenance folded ("per-shot regens of one figure drift — author once, `reuse` everywhere");
  anchor-origin table + dot-density kept as the canonical syntax home; Deferred section → ~6 lines
  (active-scan-for-shared-base is the pinned next lean, bounded by the boundary rule; do not plan
  against it yet); stays-baked list → do-form.
- [ ] **Step 3 — critics.md:** remove evidence parentheticals ("chunk-1 evidence…"); keep all six
  checks.
- [ ] **Step 4:** Verify counts + purge grep (same pattern as Task 2 Step 6) → zero.
- [ ] **Step 5:** Commit: `git add` the three files; `git commit -m "refactor(fyt-motion-planner): boundary + text laws to pointers, provenance folded into rules"`

### Task 4: Audio-director merge (SKILL 69 + grammar-guidance 89 → ONE SKILL ~110; guidance deleted)

**Files:** Modify: `.claude/skills/audio-director/SKILL.md`. Delete:
`references/grammar-guidance.md`. Keep: `references/critics.md` untouched except its
grammar-guidance mention.

- [ ] **Step 1:** Rewrite SKILL.md (frontmatter unchanged): the plan (four kinds, one line each +
  schema pointer) · procedure (6 steps, kept) · guardrails (kept, deduped) · a new **Placement laws**
  section absorbing grammar-guidance's judgment rules stated once each: placed-not-wall-to-wall;
  bed fades long by default and always fades out into a chapter card (card runs silent, next bed
  post-card; cold-open + END card exempt); rotate the bed at major pivots — never one loop 3+
  minutes; human-cost keeps a present restrained bed (track+level carries gravity; comedic SFX
  withheld); no-dip-in-pause channels reserve full music cuts for `dry` + track switches; `dry` is
  rare and line-specific; sentence-gap floor is automatic — author only EXTRA silence; breath
  selective ~0.55s on ~20% of events; density diagnostic never target; register dial (underscore
  default con-spine, casual-bed neutral, upbeat deliberate lift, sneaky deliberate comedic);
  sync:"element" for item-appearance sounds; hold-image-longer = pure pause on next shot's opening
  words; SFX-tail levers (pointer to schema); pin only directed takes; whoosh rare ~0–2/video
  same-sound, pop on additive accretion items only (not base frames, not character entrances, not
  costume changes), `consistent_sfx` motif rule. Mechanics stay schema pointers.
- [ ] **Step 2:** `git rm references/grammar-guidance.md`; grep repo-subtree for `grammar-guidance`
  and repoint every hit (audio-director SKILL, critics.md, universal.md §13a-iii if present, any
  runner segment) to the SKILL's Placement-laws section.
- [ ] **Step 3:** Verify: SKILL ≤ ~120; purge grep zero; `grep -rn "grammar-guidance"` → zero.
- [ ] **Step 4:** Commit: `git add .claude/skills/audio-director/SKILL.md .claude/skills/audio-director/references/critics.md` + the deletion; `git commit -m "refactor(fyt-audio-director): grammar-guidance merged into SKILL as placement laws"`

### Task 5: Periphery — voiceover (108→~85, contract 141→~105), audio-analyzer (65→~55), sfx-forge (59→~55), music-forge (92→~65)

**Files:** Modify: `.claude/skills/voiceover/SKILL.md`, `.claude/skills/voiceover/references/voiceover-contract.md`,
`.claude/skills/audio-analyzer/SKILL.md`, `.claude/skills/sfx-forge/SKILL.md`,
`.claude/skills/music-forge/SKILL.md`. (Disjoint from Tasks 2–4 — may run in parallel.)

- [ ] **Step 1 — voiceover SKILL:** keep command block + flags verbatim; guarantees list compressed
  (markers → one line + contract pointer); new-channel voice section → ~6 lines; keep the
  Windows-interpreter note (machine reality) as 2 lines.
- [ ] **Step 2 — contract:** config block + lever table + manifest JSON kept (contracts); marker rules
  kept once; the three dated "correction" essays fold into their rules (liveliness = pitch +
  sentence variance at stability ~0.4–0.5, style ~0.15–0.3, never volume; pace = persona feel +
  20–30% pause share, not a wpm number — an energetic persona sits ~180–200 gross wpm at speed 1.0;
  pauses short and structural — v3 mapping `[BEAT]`→natural, `[PAUSE]`→short, `[PAUSE:LONG]`→normal;
  punctuation carries cadence; flat compressed loudness is correct). NOTE: this channel's baked TTS
  tags are retired (archive) but the marker/pause contract stays — it is the project-wide engine
  behavior; state channel fact in one clause.
- [ ] **Step 3 — audio-analyzer:** fold the hallucination story into the load-bearing rule; keep
  reliable/directional split, run steps, smoke gate, file list, tests.
- [ ] **Step 4 — sfx-forge:** keep loop + guarantees; trim repeated division-of-labor to one
  statement.
- [ ] **Step 5 — music-forge:** division-of-labor stated ONCE; two-registers section kept with
  retrack provenance folded ("underscore is the default con-spine bed; sneaky/meme cues stay for
  deliberate comedic use"); scope list → one line each.
- [ ] **Step 6:** Verify counts; purge grep (add `retrack|2026-07-1`) → zero; frontmatters unchanged.
- [ ] **Step 7:** Commit: `git add` the five files; `git commit -m "refactor(fyt-audio-periphery): voiceover/analyzer/forges deduped, measurement essays folded into rules"`

### Task 6: Acceptance sweep + records (boss-orchestrated)

- [ ] **Step 1:** `wc -l` all 14 surviving files; each within ±20% of target; total ≤ ~1,150.
- [ ] **Step 2:** Purge grep across all 14: `2026-|Daniel-confirmed|R8|R10|chunk-1|M16|human-caught|superseded|parked|dormant|worked example|retired` → only archive-pointer lines legal.
- [ ] **Step 3:** Deleted-file pointer sweep: `grep -rn "animation-menu.md\|grammar-guidance" .claude/ channels/ knowledge/ docs/` → zero (retired-features and git history exempt).
- [ ] **Step 4:** Code-rule→doc cross-check per Global Constraints; write mapping into run report.
- [ ] **Step 5:** Tests: `py -3 .claude/skills/audio-analyzer/scripts/test_measures.py && py -3 .claude/skills/audio-analyzer/scripts/test_beat_map.py`; `py -3 -m pytest .claude/skills/sfx-forge/scripts/ .claude/skills/render-builder/scripts/ .claude/skills/motion-planner/scripts/ .claude/skills/voiceover/scripts/ -q` (run whatever test files exist; report which).
- [ ] **Step 6:** Fresh-eyes probe (files-only): four cue kinds + pause-vs-dry; SFX-tail levers;
  delta-vs-layer decision + hybrid plate reuse; anchor vs anchor_origin; the six voiceover markers +
  where config lives; card-on-silence law; the engine's render guarantees. Gaps → restore tersely,
  re-probe.
- [ ] **Step 7:** decisions.md entry (2026-07-28, wave 2: what/why/alternatives — logs ruled out of
  scope by Daniel); STATUS.md one-line update folded into the existing trim line.
- [ ] **Step 8:** Commit records: explicit paths, `git commit -m "chore(fyt): audio/motion-stack trim acceptance — sweep + records"`

## Self-review (write time)

- Spec coverage: table rows → Tasks 2–5; deletions → T2.5/T4.2; acceptance 1–6 → Task 6. No gaps.
- No placeholders; every step names files, content dispositions, and verify commands.
- Routing: Task 1 Sonnet → then Task 2–4 = ONE Opus worker (coupled contracts, sequential) ∥ Task 5 =
  Sonnet (disjoint files); Task 6 boss. Workers stage explicit paths; concurrent-worker warning in
  both briefs.
