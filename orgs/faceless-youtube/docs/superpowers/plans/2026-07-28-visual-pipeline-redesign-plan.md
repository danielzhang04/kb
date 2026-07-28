# Visual-Pipeline Redesign Implementation Plan (wave 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute `docs/superpowers/specs/2026-07-28-visual-pipeline-redesign-design.md` — VPW thinned
over channel grammar, image-gen restructured Pass1→Pass2 with all gen mechanics, style-bible to LOOK
law (~155), shots.json v2, lint updated. FUNCTION CHANGES — the spec's rulings 1–12 are the law.

**Architecture:** Archive first; then two parallel workers on disjoint file sets — A: the doctrine
core (grammar, bible, VPW, schema, critic, universal stub, dna, metadata-writer); B: lint_shots.py v2
under TDD + image-gen SKILL (absorbing bible §5/§7/§8 read from CURRENT HEAD before A deletes them).
Exemplar draft runs parallel to Gate B. Boss acceptance last.

**Tech Stack:** Markdown; `py -3 -m pytest`; grep sweeps.

## Global Constraints

- Spec rulings 1–12 verbatim. Zero examples outside gated exemplar files + contract skeletons; zero
  provenance; retirement prose only in the archive; don't-lists → do-rules.
- **shots.json v2 (the one definition every task uses):** per long-form/short shot: `id`, `vo_ref`
  (verbatim ≥4 words, narration order), `duration_s`, `stage?`/`stage_role?`/`changed_elements?`,
  `shot_class`, `source`, `still_prompt` (registry vocab names inline, backticked), `stock_query?`
  (stock/hybrid/archival only), `synthetic`, `notes`. File level: `schema:
  "faceless-youtube/shots@2"`, `channel`, `video_slug`, `generated`, `status`,
  `global_prompt_suffix` (copied verbatim from visual-grammar header — no house_style block),
  `long_form{aspect_ratio,shots[]}`, `thumbnail{primary,challengers[2]}` (source: script+dna),
  `shorts[]` (file, archetype, status, aspect_ratio, first_frame, shots[]). Pass 1 (image-gen) may
  add per-shot `assets` tags (`{character/prop/pose/expression name: library path}`) — image-gen-
  owned, ignored by lint + render. DELETED: `from_cue`, `beat`, `narration_type`, `hold_reason`,
  `cast`, `props`, `needed_assets`, `house_style`, `shot_counts`, `timing_status`, `vo_text`
  (derived viewing aid stays lint-written and documented, if kept — worker B decides with the code:
  keep `--write` vo_text derivation, drop shot_counts).
- **Descriptor blockquotes byte-identical, section headings intact** (forge.py parses
  `blockquote_after("LOCKED STYLE descriptor"/"STYLE-ONLY descriptor"/"RIG-HOLD descriptor")`).
- Engine/render/forge code untouched. `lint_shots.py` + its test files are the ONLY code in scope.
- Frontmatter descriptions: updated ONLY for VPW (loses metadata/thumbnail-concept + motion-intent
  wording) and metadata-writer (loses thumbnail wording) — report the diffs verbatim.
- Branch `claude/fyt-stack-trims`. Explicit paths; the r2 terminal owns writer/grammar/judge files —
  never touch storytelling-grammar.md, long-form-writer/, proxy-judge/, example-scripts.md, dna.md's
  non-visual sections.
- All paths relative to `orgs/faceless-youtube/`.

## Ownership map (parallel-safety)

Worker A: visual-grammar.md · style-bible.md · VPW SKILL.md · VPW references/shots-schema.md · VPW
references/critics.md · universal.md §13a block · dna.md (visual block ONLY) · metadata-writer/SKILL.md.
Worker B: VPW scripts/lint_shots.py + scripts/test_*.py · image-generation/SKILL.md.
Exemplar worker: channels/the-second-take/example-shots.md (new file only).
Nobody else's files. Period.

---

### Task 1: Archive the deleted laws (`docs/retired-features.md`)

- [ ] **Step 1:** Append entries (four-field, ≤6 lines): hook-bar law · delta-decisiveness law ·
  anti-slop guardrail + channel-translation step · VPW-side needed_assets hard-stop (gate moved to
  image-gen Pass 1, pre-gen approval kept) · per-video house_style distillation (suffix now fixed in
  visual-grammar header) · metadata-writer thumbnail concepts (VPW derives from script+dna) ·
  shots.json v1 author-metadata fields (from_cue/beat/narration_type/hold_reason/cast/props —
  consumers ignore unknown keys, v1 files still parse) · seven-authoring-laws apparatus (surviving
  content redistributed: tableau one-liner + facts in grammar/VPW; disclosure order in grammar).
- [ ] **Step 2:** Verify ≤160 lines total; commit:
  `git add docs/retired-features.md && git commit -m "docs(fyt): retired-features gains wave-3 deleted laws + v1 fields"`

### Task 2 (Worker A): visual-grammar.md → ~130 CAP + style-bible.md → ~155

- [ ] **Step 1 — visual-grammar.md.** Keep the current file's §1 staging + §2 composition + §3 lever
  lines + §4 dials essentially as-is. ADD, compactly: header `global_prompt_suffix` string (build it
  from style-bible §6's committed recipe: texture/line-weight/art-style terms only — no palette, no
  lighting); the narration-type → shot-class TABLE (verbatim rows from universal §13a); the
  literal/non-literal bar (≤6 lines: non-literal default; literal only for concrete physical
  action/objects; skew MORE non-literal than the shipped reference — when a line could go either
  way, go non-literal; calibration = `../example-shots.md`); chain logic (≤3 lines: consecutive
  same-set shots share a `stage`, base then deltas, ONE element per delta, ≤3 deltas then re-base or
  hard cut; a world/register change is a hard cut; an image never reveals what the VO hasn't
  said — disclosure); the tableau one-liner; policy constraints (≤3 lines from dna/niche: no
  defamatory depiction of real people, analysis-not-gore posture, evergreen references only).
  DELETE from current file anything the additions supersede. HARD CAP 130 lines.
- [ ] **Step 2 — style-bible.md.** Rebuild to ~155: title + one-line role ("image-gen's craft law —
  the LOOK; procedure lives in the image-generation skill") · §1 identity + cast/crowd model (~15) ·
  §2/§2b/§2c/§2d/§2e blockquotes byte-identical with headings intact, ≤2 framing lines each · §3
  rig-value checklist — values only, kept as the shared generator+judge rule set (~25; includes
  identity-match-vs-canonical, proportion-by-tier, expression-register-fit, diegetic-text verbatim +
  prop-lettering whitelist) · §4 character color table (~6, prose cut) · §5 recipe quote +
  lettering/stamp register values (~12) · §6 registry pointer (~4). DELETE: §5 seed rules, §7 build
  spec, §8 protocols (worker B absorbs from HEAD — do NOT coordinate, just delete), §0 how-to-use,
  all review-procedure prose.
- [ ] **Step 3:** Verify: grammar ≤130, bible ≤165; `awk '/^> /'` on new bible diffed against the
  same command on `git show HEAD:...style-bible.md` → identical; purge grep (`2026-|measured|
  superseded|retired|parked|Poyais|Wells Fargo`) → zero (archive pointer exempt).
- [ ] **Step 4:** Commit: `git add` both; `git commit -m "refactor(fyt): visual-grammar absorbs depiction doctrine (capped); style-bible cut to LOOK law"`

### Task 3 (Worker A): VPW SKILL → ~130, shots-schema v2 → ~100, critics → ~70

- [ ] **Step 1 — SKILL.md.** Rewrite: frontmatter description updated (remove metadata.json /
  thumbnail-concept / motion-intent wording; add "reads pure-prose script.md; derives the full shot
  list"). Body: mental model ≤8 lines (bridge script→pixels; author intent; stills + baked diegetic
  text; downstream realizes) · Step 1 read list (script.md · visual-grammar.md + example-shots.md ·
  dna.md visual block · registry.json — one line each) · Step 2 per-line procedure (classify from
  the grammar table → INVENT against the example bar, non-literal default → reference
  figures/poses/expressions by backticked registry vocab inline → state scene facts (layout,
  orientation, palette, light, depth; supplied-text law one line + schema §4 pointer; tableau
  one-liner) → group stages/chains per grammar) · Step 3 walk + densify (2–5s cuts, first-60s
  weighting, Σ duration ≈ runtime, ≥ runtime÷5 shots — the authoring floors; matcher mechanics live
  in render docs) · Step 4 thumbnails from script+dna (universal §8 rules in ≤5 lines) · Step 5
  shorts (≤5 lines) · Step 6 policy ≤4 lines · Step 7 write v2 + `lint_shots.py --write` · Step 8
  critic + edit pass + re-lint · output summary ≤4 lines.
- [ ] **Step 2 — shots-schema.md.** v2 per Global Constraints: skeleton + one-clause field
  semantics; the `assets` tag note (image-gen-owned); supplied-text + lettering laws unchanged
  (home); source taxonomy table; deleted-fields one-liner → archive pointer. Render-mapping table
  DELETED here; add one line into render-builder's motion-schema §2 intro is NOT worker A's file —
  instead note "field→engine mapping: render-builder references/motion-schema.md §2" (that table
  already exists there).
- [ ] **Step 3 — critics.md.** Charter: five questions (scene logic/facts · literal-check against
  the bar · vocab resolution (every backticked name exists in registry.json or is flagged) ·
  renderability · disclosure order) + cadence-taste plan check + never-flag list (updated: drop the
  hook-bar/tableau items that no longer exist as laws). One cycle, author edits, re-lint. ~70.
- [ ] **Step 4:** Verify counts + purge grep + frontmatter diff reported; commit:
  `git add` the three + `git commit -m "refactor(fyt-vpw): thin procedure over grammar, schema v2, critic recut"`

### Task 4 (Worker A): universal §13a stub, dna.md visual block, metadata-writer

- [ ] **Step 1:** universal.md: replace §13a body (table + doctrine now channel-side) with ~12-line
  stub: the principle (map narration kinds to shot kinds; non-literal default), "each channel's
  visual-kit/visual-grammar.md owns the table + bar; `_TEMPLATE` carries a skeleton", keep §13a-i/ii
  anchors + content untouched (motion/cadence law, wave-2 state). Add the skeleton pointer line to
  `channels/_TEMPLATE/` only if a visual-kit stub file already exists there — otherwise note it in
  the report (do not scaffold new template dirs).
- [ ] **Step 2:** dna.md VISUAL block only (locate the "Visual style (LOCKED recipe)" bullet +
  "Thumbnail style" bullet): compress to ~8 lines — pointer to visual-kit docs + imagery policy
  constraints + thumbnail grammar pointer. Touch nothing else in dna.md (r2 terminal owns the rest).
- [ ] **Step 3:** metadata-writer/SKILL.md: remove thumbnail-concept output (frontmatter + body);
  title/description/tags/chapters/pinned-comment unchanged; report the frontmatter diff.
- [ ] **Step 4:** Verify + commit: `git add` the three; `git commit -m "refactor(fyt): universal §13a stub, dna visual pointer, metadata-writer drops thumbnails"`

### Task 5 (Worker B): lint_shots.py v2 + tests (TDD), then image-gen SKILL → ~200

- [ ] **Step 1:** READ FIRST from current HEAD (before worker A's deletions land): style-bible §5
  seed rules, §7 build spec, §8 protocols — your absorption source. Also read the plan's v2
  definition, lint_shots.py, all VPW test files, image-generation/SKILL.md.
- [ ] **Step 2 (TDD):** update tests to v2 fixtures FIRST: remove tests asserting
  from_cue/hold_reason/cast/props/needed_assets enforcement; add tests: v2 file passes; legacy v1
  field present → warning not error; delta caps still hard-fail; supplied-text + lettering
  unchanged; runtime÷5 + Σ-coverage unchanged; vo_text `--write` derivation kept, shot_counts
  removed. Run → RED where behavior must change.
- [ ] **Step 3:** Edit lint_shots.py to v2: delete the dropped-field checks; add unknown-legacy-field
  WARNING list; keep every other check byte-equivalent in behavior. Run full VPW test dir → GREEN.
  Commit: `git add` lint + tests; `git commit -m "feat(fyt-lint): shots.json v2 — legacy fields warn, dropped-field enforcement removed"`
- [ ] **Step 4:** image-generation/SKILL.md rewrite (~200, frontmatter description unchanged):
  sequential steps per spec ruling 8 + 11 — Pass 1 (read v2 shots.json → derive asset list by
  scanning backticked vocab names + named figures against registry.json → list any missing asset →
  **STOP for human pre-gen approval** (approve → gen on the base per the character-gen rule: seed
  template base, 2:3, rig-gate vs bible §3, register; veto → flag VPW to restage that beat) →
  reuse-before-regenerate → gen missing characters/groups/props per the absorbed rules → store
  library + manifest → **write per-shot `assets` tags into shots.json**) · Pass 2 (read tags →
  technique table (a)–(e) → the absorbed seed mechanics: order, ≤4 cap, attribute routing,
  regen-fresh-on-defect, style-anchor mandatory + preference order, map-crop, match-prop, chain
  seed exceptions, two-gen identity pass default, de-nose two-pass, crowd-exemplar seed → aspect
  rules → text-bearing gens seed the lettering exemplar → layered shots) · review procedure
  (unchanged in substance: three mandates, crop battery, forced verdicts **against bible §3 — the
  same values the generator used**, letter-by-letter, one re-authored retry, orchestrator-only
  stamp, three states) · the absorbed measured laws (measure-not-eyeball + interior sampling,
  magenta chroma flat field, anchored-iteration diff proof, base-then-fan-out, batch-and-pick) ·
  single-asset loop · report section (neutral presentation kept).
- [ ] **Step 5:** Verify: ≤210 lines; purge grep zero; every absorbed rule present (grep spot-list:
  `≤4|four seeds`, `magenta`, `mean-abs-diff|Pillow`, `two-gen`, `crowd-exemplar`, `map canonical`,
  `match-prop|first approved`, `style anchor`); commit:
  `git add .claude/skills/image-generation/SKILL.md && git commit -m "refactor(fyt-image-gen): pass1→pass2 steps, gen mechanics absorbed from bible, review reads bible §3"`

### Task 6 (Exemplar worker): draft `channels/the-second-take/example-shots.md` → GATE B

- [ ] **Step 1:** Read: the redesign spec (ruling 2) · visual-grammar.md ·
  `videos/2026-07-04-poyais/shots.json` + `script.md` · `videos/2026-07-19-wells-fargo/shots.json` +
  `script.md` (if present) · example-scripts.md (the format model).
- [ ] **Step 2:** Draft 8 exemplar pairs, each: the script line (verbatim) → the ideal shot
  (still_prompt-style prose with vocab names) → 1-line "why this depiction" note. Mix: ≥6
  non-literal (symbolic stand-in, staged interaction, physicalized imbalance, ironic counterpoint,
  idiom-pun, number-glued-to-object), 1 literal-correct, 1 delta-chain trio compressed as one entry.
  Mine the strongest real shots and improve them; invent where the real ones were too literal.
  Header: what the file is, match-the-thinking-never-clone, grows with approved entries. Mark
  `<!-- PENDING Daniel approval — gate B -->`. ~60 lines. No em dashes in exemplar text.
- [ ] **Step 3:** Commit: `git add channels/the-second-take/example-shots.md && git commit -m "feat(fyt): example-shots draft — depiction bar exemplars (PENDING gate B)"`

### Task 7 (boss): acceptance + gates

- [ ] **Step 1:** GATE B: present example-shots.md draft to Daniel (open in VS Code); apply his
  edits verbatim; remove PENDING marker; commit.
- [ ] **Step 2:** Counts vs targets (±20%); purge greps across all touched files; descriptor diff;
  pointer sweep for dropped fields + moved content
  (`grep -rn "from_cue\|narration_type\|hold_reason\|needed_assets\|house_style\|pose_ref\|expression_ref" .claude/skills/ channels/the-second-take/visual-kit/ knowledge/` —
  legal only in archive, lint's legacy-warning list, and motion-planner/render docs where they
  describe LEGACY files).
- [ ] **Step 3:** Full test run (VPW + image-gen + render-builder + motion-planner script dirs).
- [ ] **Step 4:** Fresh-eyes probe (trimmed files only): author a 3-shot v2 fragment for a given
  script paragraph (checks: vocab-name usage, non-literal skew, chain grouping, supplied-text) +
  restate the Pass-1→Pass-2 tag flow, the missing-asset gate, the seed order + cap, and where the
  judge's rules live. Gaps → restore tersely, re-probe.
- [ ] **Step 5:** decisions.md entry + STATUS.md update + boss memory lesson; closing commit.
- [ ] **Step 6:** GATE C: Daniel reads visual-grammar.md + VPW SKILL.md + example-shots.md final.

## Self-review (write time)

- Spec rulings 1–12 → every one lands in a task (1→T2/T3; 2→T6/T2; 3→T3/T5; 4→T3; 5→T2/T4; 6→T2/T4;
  7→T3/T4; 8→T5; 9→GC+T3/T5; 10→T2; 11→T2/T5; 12→throughout). No gaps.
- Parallel-safety: ownership map is disjoint; worker B absorbs bible content from HEAD read at
  start, no coordination needed.
- Routing: T1 Sonnet · T2–T4 ONE Opus worker (sequential) ∥ T5 ONE Opus worker ∥ T6 Sonnet · T7 boss.
