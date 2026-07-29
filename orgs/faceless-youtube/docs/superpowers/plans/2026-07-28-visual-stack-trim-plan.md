# Visual-Stack Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the seven files governing visual prompting + image generation from ~2,900 lines to
~1,220, per `docs/superpowers/specs/2026-07-28-visual-stack-trim-design.md`, preserving every current
behavior and learning.

**Architecture:** One home per law with pointers elsewhere. A new `docs/retired-features.md` absorbs
all retirement prose first; then each governing file is rewritten against the spec's single-home map.
Doctrine prose only — no code, schema, or locked-value changes.

**Tech Stack:** Markdown; `py -3 -m pytest` for the VPW + image-gen script tests; grep sweeps for
acceptance.

## Global Constraints (from the spec — binding on every task)

- **Zero examples** — no worked walkthroughs, no BAD/GOOD blocks, no sample JSON scenes, no
  L11–L14-style evidence tables.
- **Zero provenance** — no changelogs, no dates on rules, no "measured/human-caught/proven
  2026-XX-XX", no "supersedes/replaces the earlier X" narration. A good learning becomes the rule's
  wording; the reasoning stays only where it changes what the reader does.
- **Zero retirement prose** in governing files — retired capabilities live only in
  `docs/retired-features.md`; a governing file states current behavior positively (e.g. "all
  on-screen text is baked diegetic") with at most a pointer to the archive.
- **Descriptor blocks byte-identical** — the five blockquotes in style-bible §2, §2b, §2c, §2d, §2e
  (the `>`-prefixed text only) must not change by one byte.
- **Every lint/code-enforced rule stays stated in exactly one doc.** The enforced set: verbatim
  `vo_ref` (≥4 words, exact order) + strict narration order; the supplied-text law; lettering L-1,
  L-2, L-3 hard + L-4's two-separator heads-up; delta-chain caps (exactly one `base` first, ≤3
  deltas, contiguity); runtime÷5 shot floor + Σ duration coverage; `hold_reason` required over ~6s;
  L-3's 4-word cap on shorts `first_frame` captions; forge.py's cutout aspect hard-error (w/h ≥ 1.5
  unless `--allow-wide`); forge.py's seeded-environment/style hard-error; §2c auto-append on
  character-bearing seeds; `stamp_review.py` as sole writer of the three review states.
- **Don't-lists → do-rules** where meaning allows (state the constraint as what to do; keep a
  prohibition only where the prohibition IS the rule, e.g. "never seed a derivative").
- Branch: `claude/fyt-writer-grammar-slim`. Stage explicit paths only; never `git add -A`. Do not
  touch `personable-calibration.md` or any scripting-overhaul file.
- All paths below relative to `orgs/faceless-youtube/`.

## Single-home map (where each shared law lives after the trim — every task obeys it)

| Law | ONE home | Everyone else |
| --- | --- | --- |
| shots.json field contract, field→engine map, source taxonomy | shots-schema.md | VPW SKILL points |
| Supplied-text law + lettering rules L-1..L-4 | shots-schema.md §4 | VPW SKILL one-line + pointer; motion-planner already points |
| Seven authoring laws (held tableau · scene facts · acting · casting · delta decisiveness · hook bar · disclosure order) + Step 0–8 procedure | VPW SKILL.md | critics.md maps its questions to them by name |
| Critic charter + one-cycle orchestration | critics.md | VPW SKILL Step 8 points |
| Three-tier rig model (named-seeded / §2e foreground / §2d crowd) + all rig invariants | style-bible.md §1–§3 | VPW SKILL + image-gen SKILL + visual-grammar say "route by SIZE per style-bible three-tier model" + pointer |
| Seed rules (order, ≤4 cap, provenance routing, style-anchor/ENV rule, map-crop, match-prop, regen-fresh-on-defect, delta-chain seed exceptions) | style-bible.md §5 | image-gen SKILL points; technique table keeps only per-technique seed lists |
| Recipe, lettering/stamp registers, palette | style-bible.md §4/§6 | others point |
| Library build spec + registry | style-bible.md §7/§9 | image-gen SKILL points |
| Generation protocols (anchored iteration, measure-not-eyeball, chroma-key cutouts, one re-authored retry, two-gen identity pass, de-nose two-pass) | style-bible.md §8 | image-gen SKILL keeps only the flow-level retry/review procedure |
| Pass 0/1/2 flow, technique menu, batched review, stamping, single-asset loop | image-gen SKILL.md | style-bible §0 points |
| Narration-type → shot-class table + core doctrine + cadence law | universal.md §13a/§13a-ii | VPW SKILL + visual-grammar point |
| Channel staging (conventions, composition, lever translation) | visual-grammar.md | VPW SKILL points |
| What was retired + why + where code is parked | docs/retired-features.md | at most one pointer per file |

---

### Task 1: Create `docs/retired-features.md` (harvest before anything is deleted)

**Files:**
- Create: `docs/retired-features.md`
- Read-only sources: the seven governing files (pre-trim), `docs/STATUS.md`, `knowledge/decisions.md`

**Interfaces:**
- Produces: `docs/retired-features.md` — the archive every later task's deleted retirement prose
  points to. Structure: intro line ("Retired pipeline capabilities — what/why/where the code is
  parked, for possible re-implementation. Governing files do not re-explain these."), then one
  `## <feature>` section per retirement, each ≤6 lines: what it was · why retired · where
  code/components are parked · what to re-verify before reviving.

- [ ] **Step 1:** Grep the seven files for retirement content:
  `grep -n "retired\|deleted\|dormant\|no longer\|superseded\|merge tier\|flash\|ken_burns\|within_shot_motion\|device card\|Pass 1b\|posed-character" .claude/skills/visual-prompt-writer/SKILL.md .claude/skills/visual-prompt-writer/references/shots-schema.md .claude/skills/image-generation/SKILL.md channels/the-second-take/visual-kit/style-bible.md channels/the-second-take/visual-kit/visual-grammar.md knowledge/research/niche-playbooks/universal.md`
  and read each hit in context.
- [ ] **Step 2:** Write `docs/retired-features.md` covering at minimum: **engine text overlays +
  T2 device cards** (definition/meter/stat/chapter/counter — Remotion components parked dormant; all
  on-screen text now baked diegetic); **VPW camera/motion authoring fields** (`ken_burns`,
  `within_shot_motion`, `motion_prompt`, `transition_in`, `render_pattern`, `on_screen_text`,
  `asset_type`, beat-type treatment enum, `transform_note`/sprite-walk/`at_scene` — consumers ignore
  unknown keys, so old files still parse); **posed-character merge tier (Pass 1b)** (scenes now
  multi-seed in one run; the merge's cheap isolation gate is gone, so seed-routing failures surface
  at the batched review); **flash engine tier** (all gens on `gemini-3-pro-image`; revisit only at
  daily-cadence volume, and then via the Batch API, not flash); **chapter/title cards** (a chapter
  turn is a hard cut/palette turn); **`forge.py diff`/`crop` helper commands** (measure with Pillow
  directly).
- [ ] **Step 3:** Verify each section answers all four fields (what/why/where parked/re-verify) in
  ≤6 lines; file ≤60 lines total.
- [ ] **Step 4:** Commit:
  `git add docs/retired-features.md && git commit -m "docs(fyt): retired-features archive — retirement prose moves out of governing files"`

### Task 2: Rewrite `shots-schema.md` (421 → ~140)

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/references/shots-schema.md`

**Interfaces:**
- Consumes: `docs/retired-features.md` (Task 1) as the pointer target for the deleted-fields note.
- Produces: the canonical statements later tasks point to — "the supplied-text law
  (shots-schema.md §4)", "the lettering rules (shots-schema.md §4)", the `shot_class` enum, the
  field→engine table.

- [ ] **Step 1:** Rewrite section by section:
  - **§1 JSON shape:** keep the annotated JSON skeleton (it is the contract, not an example) but
    compress every field annotation to one clause; keep the `shot_class` enum verbatim (canonical
    list). Trim the notes list: keep verbatim-`vo_ref`/order, `vo_text`+`shot_counts` derived-only,
    stage/delta intent + the delta-vs-layer boundary (2–3 sentences), hard-cuts-only, `cast`/`props`
    semantics (compressed to ~6 lines total), `needed_assets` gate (2 lines). The deleted-fields
    note becomes: "Deleted fields — do not author; consumers ignore unknown keys. List + rationale:
    `docs/retired-features.md`." followed by the bare field names only.
  - **§2 field→engine table:** keep, minus the retired-path rows' commentary.
  - **§3 source taxonomy:** keep the table, one intro line.
  - **§4 text laws:** supplied-text law in ≤8 lines — the rule + the three resolutions
    (supply verbatim from the fact ledger citing `[F-NN]` · omit the element · author it
    deliberately blank) + "never invent a plausible value". Delete the BAD/GOOD block and both
    fabrication narratives. Lettering rules: L-1 re-quote a carried literal character-for-character
    on every frame that redraws it (HARD); L-2 state constraints as properties of the depicted
    thing, production vocabulary never as scene nouns; editorial gloss goes in `notes` (HARD);
    L-3 authored lettering ≤4 words, uniform including shorts `first_frame` captions (HARD);
    L-4 prefer word-form for big numbers; only ≥2 separators in one digit run draws a heads-up
    (advisory). Add the one governing line that changes behavior: fewer authored strings is the
    highest-leverage lever — a string you do not author cannot garble. Delete the entire
    measurement essay, the L11–L14 table, and the Poyais-comparison narrative.
  - **§5 limits/defaults:** keep, compressed to ~10 lines (density, coverage ÷5 floor,
    diagram-first hold exception + `hold_reason`, shorts 2–4s, `synthetic` disclosure, thumbnail
    text ≤3 words).
  - **§6 worked mini-example: DELETE.** Also delete the prompt-pattern prose paragraphs at the end
    of §4 (still-prompt/thumbnail patterns) — their load-bearing content (held tableau, stated
    facts, suffix on every prompt, §8 thumbnail spec) already lives in VPW SKILL steps; leave one
    pointer line.
- [ ] **Step 2:** Verify: `wc -l` ≤ ~170; grep the file for `2026-`, `Poyais`, `Wells Fargo`,
  `BAD `, `GOOD `, `measured`, `superseded` → zero hits; every Global-Constraints enforced rule
  that homes here is present (read the list, check each).
- [ ] **Step 3:** Run
  `py -3 -m pytest .claude/skills/visual-prompt-writer/scripts/ -q` → all pass.
- [ ] **Step 4:** Commit:
  `git add .claude/skills/visual-prompt-writer/references/shots-schema.md && git commit -m "refactor(fyt-vpw): shots-schema slimmed to contract + terse text laws"`

### Task 3: Rewrite VPW `SKILL.md` (555 → ~200) + `critics.md` (134 → ~100)

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md`,
  `.claude/skills/visual-prompt-writer/references/critics.md`

**Interfaces:**
- Consumes: shots-schema.md (Task 2) as the law home it points to; style-bible §2d/§2e as the
  clause home.
- Produces: the seven authoring laws' canonical naming + the Step 0–8 procedure that critics.md,
  image-gen, and the runner reference.

- [ ] **Step 1 — SKILL.md.** Rewrite keeping the frontmatter description unchanged. Structure:
  - **Mental model** (~15 lines): bridge between script and pixels; engine reality (verified still,
    baked diegetic text, no authored camera, motion-planner owns layers, changes arrive AT the cut);
    author intent never mechanism.
  - **The laws** (~45 lines): the five fundamentals and the seven authoring laws MERGE into one
    list — each law stated once in 2–4 lines, "do" phrasing. Keep the canonical seven names
    verbatim: **held tableau · scene facts · acting · casting · delta decisiveness · hook bar ·
    disclosure order**. Mechanical render-contract rules each get 1–2 lines with their enforcement
    named (lint / critic / schema pointer): reveal realization (delta chain or baked text), cadence
    + stretch-to-fill (densify, never lengthen), literal-check gate, `global_prompt_suffix` on
    every prompt, verbatim anchors + order (lint), critic before pixels, diegetic text + supplied-
    text + lettering caps (one line each + schema §4 pointer), anonymous-figure routing by size
    (one line + style-bible three-tier pointer).
  - **Steps 0–8** (~120 lines): keep every step and sub-step's INSTRUCTION; delete restated
    rationale, all parenthetical war stories, and every example. Step 1's read list: one line per
    file with what to take from it. Step 2.5: the 9-move procedure compressed to one line each.
    Step 3's bullets: each to ≤4 lines (expand cues · strict order · derived vo_text · densify ·
    stage the run + one-change-per-delta + decisive deltas · disclosure order · runtime coverage ·
    diagram-first exception · hook bar · reveal-on-name · escalate to beats · source tags).
    Steps 4–8 similarly compressed. Keep the pose/expression gate (hard stop + veto→restage
    convergence rule) at ~8 lines. Keep Output-to-user + output contract at ~10 lines total with
    the schema pointer.
- [ ] **Step 2 — critics.md.** Keep orchestration diagram, dispatch list, and the charter's six
  questions + plan-level checks + never-flag list (they gate over-triggering — keep as
  prohibitions); compress the intro to 3 lines (no chain-test story), the law-map note to 2 lines,
  the author's-edit-pass to 4 bullets, notes-for-the-skill to 2 lines.
- [ ] **Step 3:** Verify: SKILL ≤ ~230 lines, critics ≤ ~110; grep both for `2026-`, `Poyais`,
  `Wells Fargo`, `ken_burns`, `retired`, `superseded` → zero; the seven law names appear identically
  in both files; every Step 0–8 heading survives.
- [ ] **Step 4:** Commit:
  `git add .claude/skills/visual-prompt-writer/SKILL.md .claude/skills/visual-prompt-writer/references/critics.md && git commit -m "refactor(fyt-vpw): SKILL + critic slimmed — laws stated once, procedure kept, war stories out"`

### Task 4: Rewrite `style-bible.md` (775 → ~300)

**Files:**
- Modify: `channels/the-second-take/visual-kit/style-bible.md`
- Scratch: `docs/superpowers/plans/_descriptor-blocks.txt` (temporary, deleted in Task 7)

**Interfaces:**
- Consumes: image-gen SKILL.md (pre-trim) — absorb any seed learning stated ONLY there into §5.
- Produces: §5 as the single seed-rule home; §2–§2e clauses at stable anchors; §3 checklist;
  §6 recipe; §7 build spec; §8 protocols — the pointer targets for Task 5.

- [ ] **Step 1:** Extract the five descriptor blockquotes to the scratch file first:
  `awk '/^> /' channels/the-second-take/visual-kit/style-bible.md > docs/superpowers/plans/_descriptor-blocks.txt`
  (this captures §2/§2b/§2c/§2d/§2e plus the §6 recipe quote — all must survive byte-identical).
- [ ] **Step 2:** Rewrite section by section:
  - **Header + §0:** 6 lines — what the file is, LOCKED-edit rule (human approval), read order.
    Drop the spec-doc references and dates.
  - **§1 identity:** ~25 lines — template-not-character, the shared rig, varies-per-character,
    crowd-rig concept (2 lines + "clause: §2d"), aspect defaults.
  - **§2–§2e:** keep every blockquote byte-identical; compress each block's surrounding prose to
    ≤5 lines stating when it applies and who authors/appends it (delta-supplies-costume precedence,
    §2c auto-append condition, §2d VPW-authored + crowd-exemplar seeded, §2e three-tier choice).
  - **§3 checklist:** ~40 lines — keep every invariant bullet (head, no nose/ears + haired-side
    rule, four-digit hands + open-pose emphasis + crop-battery ruling requirement + human board as
    final authority, facial layout, outline, render, head tone, identity-match-vs-canonical +
    two-gen-pass pointer, costume, diegetic-text verbatim + prop-lettering whitelist, proportion
    per tier, tier routing, count), each to 1–3 lines, calibration framing ("judge against the
    approved canonical; in doubt, beside the canonical — same channel passes") in 3 lines.
    Keep the expression-register-fit rule (3 lines). Delete the never-checked list's rationale,
    keep the list (2 lines).
  - **§4 palette:** keep the table; prose to 4 lines.
  - **§5 seed rules:** ~60 lines, the canonical home. One bullet each: multi-seed one-run order;
    ≤4 seed cap; regen-fresh-on-defect + the two exceptions (chain parent, human-ordered hold —
    both take before/after crop diff on every figure); neutral-face primitives; exposed-hand from
    a seeded pose primitive; attribute provenance (character seed → identity/tone/hair/costume/face;
    pose seed → body/hands/geometry; expression seed → eye/brow/mouth shape); new-character;
    ENV/style-anchor rule + preference order (mandatory on every scene/plate gen — anchor holds art
    style, character seeds hold only identity); map-crop rule; composed-scene anchor rule;
    match-prop first-approved-frame rule; delta-chain seed exceptions (prior frame in-stage;
    same-location re-base seeds the stage BASE; removal of a transient seeds the pre-transient
    ancestor); reuse-before-regenerate; trace-to-approved-canonical never a derivative. Absorb from
    image-gen SKILL anything stated only there (crowd-with-lead costume assert + contrast lever;
    expression-softest-seed caveat). Delete every probe narrative and date.
  - **§6 recipe:** ~35 lines — recipe quote byte-identical; cast/environments/lettering/stamp
    register/diegetic-art/colour bullets each ≤5 lines, keeping the operational values (marker
    capitals, ink `#241a12`, stamp exemplar seed + destination plate, truncated-caption →
    re-author as its own architectural element, family-match-not-glyph-identity, no cards) and the
    why-this-fits execution notes at 1 line each.
  - **§7 library:** ~30 lines — the six build items as terse lists (keep every named pose/grip/
    interaction slug), the seed-source role (2 lines), the eye-line pupils-only rule (2 lines),
    build order line.
  - **§8 protocols:** ~40 lines — base-then-fan-out; anchored iteration + prove-by-measurement
    (mean-abs-diff, near-zero = ignored); escalate mechanism not wording; measure-matte/colour/
    geometry incl. interior regions + composite over the real destination plate; magenta chroma
    field + flat-field prompt; one re-authored-retry verify loop; head-shape follows content +
    anti-realism clause; scene-assembly 5 steps compressed to ~12 lines (one-gen compose, boundary
    rule delta-vs-layer + same-location re-base + pre-transient ancestor, tier rendering, one-shot
    single-character, verify); channel-signature promotion 3 lines.
  - **§9 registry:** ~10 lines — what it indexes, the three env register anchors, refs/ as
    canonical home. Drop the current-cast inventory paragraph (registry.json is the live index).
  - **§10: DELETE the entire section.** Fold the two surviving operational facts upward: the
    LOCKED-edit approval rule (already §0) and "first approved scenes become the gold composed-scene
    exemplar" (one line in §6).
- [ ] **Step 3:** Verify: `awk '/^> /' style-bible.md | diff - docs/superpowers/plans/_descriptor-blocks.txt`
  → empty; `wc -l` ≤ ~340; grep for `2026-`, `provenance`, `superseded`, `Pending`, `changelog`,
  `spec:` → zero hits.
- [ ] **Step 4:** Commit:
  `git add channels/the-second-take/visual-kit/style-bible.md && git commit -m "refactor(fyt-style-bible): 775→~300 — learnings folded into rules, changelog deleted, descriptors byte-identical"`

### Task 5: Rewrite image-gen `SKILL.md` (503 → ~200)

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md`

**Interfaces:**
- Consumes: style-bible §5/§8 (Task 4) as the seed/protocol home; retired-features (Task 1).
- Produces: the Pass 0/1/2 + review procedure the runner and render-builder docs reference.

- [ ] **Step 1:** Rewrite keeping the frontmatter description unchanged:
  - **Intro** (~12 lines): role split (forge.py mechanics / you own judgment), engine reality
    (stochastic, 1–3 tries, batched review is the guarantee, `py -3`), log-as-you-generate rule
    (manifests ARE the log; descriptive filenames; a `<thing>-lab.md` per iterative round),
    read-the-bible-first + never-silently-change-a-value.
  - **Mode selection + Pass-1/Pass-2 split** (~10 lines): video vs one-off; characters/groups/
    recurring props lock in Pass 1; environments/plates/anonymous crowds compose in Pass 2.
  - **Pass 0** (~8 lines), **Pass 1** (~30 lines: derive table from `cast`+`props`, reuse-before-
    regenerate, generate missing per bible §5, verify inline vs §3, manifest fields, channel
    promotion — delete the Poyais worked example).
  - **Pass 2** (~70 lines): seeding one-liner + "order and doctrine: bible §5"; aspect rules
    (explicit every scene; cutouts never 16:9 — forge hard-errors ≥1.5 w/h unless `--allow-wide`);
    scope-of-a-shot (generate ai-gen/hybrid only; ignore motion fields; text-bearing gens seed the
    lettering exemplar); prompt assembly + precedence (delta overrides descriptor on named
    variables; bible wins over suffix); the technique table (a)–(e) with per-technique seed lists
    kept but each cell ≤3 lines; two-gen identity pass default for scene-heavy single-character
    shots (~6 lines); de-nose two-pass (~4 lines); manifest entry + `review_status` gate (~6
    lines); shorts/thumbnail handling incl. `finalize_thumbnail.py` (~10 lines); layered shots
    (plate/cutout/hybrid, ~10 lines).
  - **Batched review** (~40 lines): one pass after the whole batch; three concurrent mandates —
    identity/rig (forced per-invariant verdicts, crop-battery procedure: localizer → crop_battery.py
    → judge cites crop paths, generator self-checks never substitute, fresh-eyes FAIL never
    downgraded), fidelity (facts one-by-one; letter-by-letter transcription, garble = blocking),
    style/taste (beat + class + recipe + richness; expression-register per beat). Fix loop: ONE
    re-authored retry (fresh gen, re-authored logic, never accretion; re-author HOW a fact is
    depicted never WHETHER), then flag + surface. Stamping: orchestrator-only, `merged.json` →
    `stamp_review.py`, the three states, verified-only ships.
  - **Single-asset loop** (~10 lines) and **Report** (~10 lines: neutral presentation, weaknesses
    first, Artifact with crop sheets, human calibrates the bar).
  - Keep the "Not this skill" line.
- [ ] **Step 2:** Verify: ≤ ~230 lines; grep for `2026-`, `Poyais`, `worked example`, `retired`,
  `merge`, `flash` → zero (retired/merge may appear only in a pointer to `docs/retired-features.md`
  if one is kept); every enforced rule homing here (stamp states, cutout aspect, review procedure)
  present.
- [ ] **Step 3:** Run `py -3 -m pytest .claude/skills/image-generation/scripts/ -q` → all pass.
- [ ] **Step 4:** Commit:
  `git add .claude/skills/image-generation/SKILL.md && git commit -m "refactor(fyt-image-gen): SKILL 503→~200 — seed doctrine deduped to bible §5, examples and retirement prose out"`

### Task 6: Trim `visual-grammar.md` (197 → ~120) + `universal.md` §13–§13a-iii (~300 → ~120)

**Files:**
- Modify: `channels/the-second-take/visual-kit/visual-grammar.md`,
  `knowledge/research/niche-playbooks/universal.md` (ONLY §13 through §13a-iii + "The Simon Whistler
  test"; §§1–12 and §14 untouched)

**Interfaces:**
- Consumes: single-home map (pointers to style-bible / shots-schema).
- Produces: universal §13a table at its current anchor (motion-planner/audio-director pointers to
  §13a-ii/§13a-iii must still resolve to existing sections).

- [ ] **Step 1 — visual-grammar.md:** keep header pointers (3 lines) + the procedure line; §1
  staging conventions each bullet ≤3 lines (tableau pose menu kept as a list; group-vs-crowd
  routing = 2 lines + style-bible pointer); §2 composition ~20 lines (scale/angle/no-hand-macro/
  literal-vs-symbolic/negative-space, class-carries-a-range); §3 lever translation ~15 lines;
  §4 shrinks to ~6 lines: locked camera (authored exceptions only), hard cuts only, no long-form
  captions, red = the only emphasis ink, numbers in-world, enumerations = delta-chain or baked
  text — "measured grammar + dials: universal.md §13a-iii + motion-tokens/audio-tokens". Delete
  §5 (pipeline routing — CLAUDE.md and the skills own routing) and the validation-status footer.
- [ ] **Step 2 — universal.md:** rewrite §13 to ~20 lines (voice, lock-one-style, register
  decision stylized/real/never-the-middle, disclosure, cadence discipline); §13a to ~45 lines
  (governing grammar-not-phrasebook rule ~4 lines; core doctrine 9 items → 1 line each; the
  narration-type → shot-class TABLE kept verbatim; cross-channel caution 2 lines); §13a-i to ~10
  lines rewritten to current reality: a shot is a composed slate — idle baseline is the engine's,
  one meaningful change per shot arrives AT the cut or via a motion-planner layer, element reveals
  land on their narrated word via delta chain / seeded cutout / baked text, hold-then-hard-cut on
  the payload word (NO `within_shot_motion` field — the shot-writer authors intent in
  `still_prompt` + stage metadata only); §13a-ii to ~15 lines (4–8s swap, role cadence, the >8s
  progressive-reveal hard rule, stretch-to-fill fix = produce enough shots, structural breaths, the
  continuity hierarchy layer/delta/hard-cut + no fades, the layer-vs-delta boundary + re-base rule
  in 4 lines); §13a-iii to ~25 lines — keep the section anchor + one-line summary ("camera is
  furniture; the element layer is the life; the cut is the verb") + the ten numbered rules each
  compressed to 1–2 lines of their operational content (camera law %, entrance vocabulary order +
  fade-near-ban, text animates at speech pace, hard-cut transition law + reserved-meaning
  exceptions, number-selling recipe sequence, held-set live evolution, cadence numbers, audio
  grammar dials pointer → audio-tokens.json + audio-director guidance, typography law, the three
  executors) — delete all measurement methodology, channel citations, and dated study narration;
  keep "The Simon Whistler test" at 3 lines (the monetization point, no quote).
- [ ] **Step 3:** Verify: visual-grammar ≤ ~130; universal §13-to-Whistler block ≤ ~140 (measure
  by heading line numbers); grep both for `2026-`, `measured`, `teardown`, `superseded` → zero in
  the edited ranges; confirm anchors `### 13a.`, `#### 13a-i`, `#### 13a-ii`, `#### 13a-iii` all
  still exist.
- [ ] **Step 4:** Commit:
  `git add channels/the-second-take/visual-kit/visual-grammar.md knowledge/research/niche-playbooks/universal.md && git commit -m "refactor(fyt): visual-grammar + universal §13a trimmed — law kept, measurement narration out"`

### Task 7: Acceptance sweep + records

**Files:**
- Modify: `knowledge/decisions.md` (append), `docs/STATUS.md` (current-state line)
- Delete: `docs/superpowers/plans/_descriptor-blocks.txt`
- Read-only: everything else

- [ ] **Step 1 — line counts:** `wc -l` all seven files + the archive; each within spec target
  ±20%, total ≤ ~1,400. Report the table.
- [ ] **Step 2 — purge greps** across the seven files:
  `grep -rn "2026-\|Poyais\|Wells Fargo\|human-caught\|measured\|superseded\|worked example\|changelog\|ken_burns\|within_shot_motion\|posed-character\|flash tier" <the seven paths>` →
  only legal hits are inside `docs/retired-features.md` pointers (field names in the schema's
  deleted-fields list are also legal).
- [ ] **Step 3 — pointer integrity:** grep the seven files for `§` and `.md` references; open each
  referenced section; zero dangling references (§10, deleted examples, removed sections). Also grep
  OUTSIDE the seven files for inbound pointers:
  `grep -rn "style-bible.md §10\|shots-schema.md §6\|§13a-iii" .claude/skills/ channels/the-second-take/ knowledge/` — fix any dangling inbound pointer in the pointing file (one-line edit).
- [ ] **Step 4 — code-rule→doc cross-check:** for each enforced rule in Global Constraints, name
  the doc+section that now states it; write the mapping into the run report. Any rule with no home →
  fix before proceeding.
- [ ] **Step 5 — tests:** `py -3 -m pytest .claude/skills/visual-prompt-writer/scripts/ .claude/skills/image-generation/scripts/ -q` → all pass.
- [ ] **Step 6 — descriptor diff:** re-run the Task-4 awk diff → empty; then delete the scratch
  file.
- [ ] **Step 7 — fresh-eyes comprehension probe:** dispatch one fresh subagent given ONLY the seven
  trimmed files + the archive, asked to state: the seven authoring laws; the supplied-text law and
  its three resolutions; the seed order + cap for a composed scene; the three-tier rig model; the
  delta-vs-layer boundary + same-location re-base rule; what happens to a flagged frame after one
  retry. Grade against the pre-trim content (this plan's Global Constraints + single-home map are
  the key). Any miss traced to missing doctrine → restore that doctrine tersely, re-run the probe
  on the fixed file.
- [ ] **Step 8 — records:** `knowledge/decisions.md` entry (2026-07-28): visual-stack trim per the
  spec — single-home law map, retired-features archive created, changelog/examples/provenance
  policy (Daniel's rulings), alternatives rejected (keep-evidence-in-place; per-file retirement
  one-liners). `docs/STATUS.md`: one-line current-state update.
- [ ] **Step 9 — commit:**
  `git add knowledge/decisions.md docs/STATUS.md && git rm docs/superpowers/plans/_descriptor-blocks.txt 2>/dev/null; git commit -m "chore(fyt): visual-stack trim acceptance — cross-checks pass, records updated"`
  (if the scratch file was never committed, plain-delete it instead of `git rm`).

## Self-review (done at write time)

- Spec coverage: architecture table → Tasks 1–6; method guardrails → Global Constraints + Task 7
  Steps 2–6; acceptance 1→7.1, 2→7.2, 3→7.6, 4→7.4+7.5, 5→7.3, 6→7.7. No gaps.
- Placeholder scan: none — every rewrite step names sections, line budgets, and what
  survives/dies; per-file verify greps are concrete commands.
- Consistency: law names, file paths, and section anchors match across tasks; the single-home map
  is restated wherever a task depends on it.
- Execution routing: Tasks 2–5 = ONE Opus worker in sequence (cross-file coherence is the whole
  game); Task 1 = Sonnet; Task 6 = Sonnet after Task 5; Task 7 = boss-orchestrated (probe is a
  fresh subagent).
