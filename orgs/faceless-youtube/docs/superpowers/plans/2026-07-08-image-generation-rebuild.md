# Image-Generation Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the image-generation system in place — `asset-forge` → `image-generation` with a two-pass flow (video asset library → scene assembly), `style-bible.md` as the single image-gen doc, `visual-grammar.md` slimmed to staging law — per `docs/superpowers/specs/2026-07-08-image-generation-rebuild-design.md`.

**Architecture:** Doc split by owner: the skill (process) + style-bible (channel law) are image-generation's whole world; slim visual-grammar is visual-prompt-writer's staging doc; `registry.json` is the only shared surface (data). Pass 1 derives a per-video library from `shots.json`; pass 2 composes scenes generation-based (multi-seed). Validation is a fresh-eyes paper dry-run, no image spend.

**Tech Stack:** Markdown skill/docs; Python stdlib (`forge.py`); git.

## Global Constraints

- LOCKED spec values survive VERBATIM: the §2 + §2b descriptor blockquotes, hexes `#f5ead6` / `#241a12`, the §3 invariant items, canonical refs paths, the §9 approval rule.
- `forge.py` extracts descriptors via `blockquote_after(md, "LOCKED STYLE descriptor")` and `blockquote_after(md, "STYLE-ONLY descriptor")` — the rebuilt bible MUST keep `## …LOCKED STYLE descriptor…` and `## …STYLE-ONLY descriptor…` headers each followed by a `> …` blockquote.
- Skills stay niche-agnostic; channel specifics live in `channels/<name>/`.
- Positive DO-THIS procedure; the §3 invariant checklist survives as-is.
- No changes to shots-schema.md content rules, visual-prompt-writer's flow, render-builder, the scriptwriter system, or the vo_ref/lint_shots.py contract (pointer/cross-ref updates only).
- Append-only history (decisions.md past entries) and dated specs untouched.
- No image generation in this task.
- Run scripts with native `py -3`. Commit after each task.

---

### Task 1: Rename skill folder + rebuild SKILL.md around the two-pass flow

**Files:**
- Rename: `.claude/skills/asset-forge/` → `.claude/skills/image-generation/` (via `git mv`)
- Rewrite: `.claude/skills/image-generation/SKILL.md`

**Interfaces:**
- Produces: skill name `image-generation`; per-video outputs `videos/<slug>/assets/library/` (+ `manifest.json`), `videos/<slug>/assets/scenes/<shot-id>.png` (+ `manifest.json`). Tasks 4–6 reference these.

- [ ] `git mv .claude/skills/asset-forge .claude/skills/image-generation`
- [ ] Rewrite SKILL.md: frontmatter description keeps every current trigger phrase + adds two-pass triggers ("generate the images/visuals for a video", "build the asset library", "do the image generation"); body =
  - Mental model (verified on-style pixels; judgment here, mechanics in forge.py; Nano Banana stochastic, 1–3 tries; the guarantee is the verify loop).
  - Mode selection: video request → two-pass; one-off asset / cast extension / "iterate on this" → single-asset loop.
  - **Pass 1 (video asset library):** read shots.json + script.md → entity table (name, kind, shots it appears in, majorness: ≥2 shots or load-bearing hook/climax) → registry lookup per entity (reuse) → generate missing (seed rules from the bible) → verify (rig gate) → write `assets/library/` + manifest (name, file, seed used, shots served) → promote channel-recurring assets via `register`. Worked example.
  - **Pass 2 (scene assembly):** walk shots in order; technique menu (a) reuse/reframe, (b) seeded composition (multi-seed plate + asset refs, placement/depth in prompt), (c) plate-first then place, (d) one-shot whole-scene only for simple single-character shots; model tier per bible (flash plates / pro identity); verify BOTH gates; `assets/scenes/<shot-id>.png` + manifest. Worked example.
  - **The two gates:** rig/invariant gate (bible §3, every figure) + scene-taste gate (subagent fresh-eyes: reads as beat+shot_class? on-recipe? not slop?).
  - Single-asset loop (condensed current loop: lookup → seed → gen → verify → retry ≤3 / escalate → register).
  - Rules kept: never ship unverified; never silently change a locked value (propose); reuse-before-regenerate; one variable per iteration; invariants checked / pose-expression-proportions flex.
  - Render reality note: `assets/scenes/` NOT yet consumed by render-builder (Pattern A inline-generates from text and cannot hold the locked style); wiring = follow-up #1.
- [ ] Verify: frontmatter parses (name matches folder), all bible section references match the rebuilt bible's numbering (coordinate with Task 3).
- [ ] Commit: `feat: rebuild asset-forge as image-generation (two-pass flow)`

### Task 2: forge.py per-call model tier

**Files:**
- Modify: `.claude/skills/image-generation/scripts/forge.py`

**Interfaces:**
- Produces: `gen --model <id>` CLI flag + per-batch-item `"model"` field; default = registry `engine`.

- [ ] In `Kit.__init__`: keep `self.model` as default; build URL per-request instead of once (`self.url_for(model)` helper using `model or self.model`).
- [ ] In `cmd_gen`: `model = r.get("model")`; pass `k.url_for(model)` to `nano(...)`.
- [ ] In `main()`: `ap.add_argument("--model")`; thread into the single-request dict.
- [ ] Verify: `py -3 -m py_compile .claude/skills/image-generation/scripts/forge.py` → exit 0; `py -3 forge.py lookup --kit channels/the-second-take/visual-kit --character base --tag deadpan` → `REUSE: …` (proves Kit still loads).
- [ ] Commit: `feat: forge.py per-call model tier (flash/pro)`

### Task 3: Rebuild style-bible.md

**Files:**
- Rewrite: `channels/the-second-take/visual-kit/style-bible.md`

**Interfaces:**
- Consumes: current bible (all learnings + locked values), visual-grammar §1 (recipe), §2 (rig execution notes), §3.1–3.6 (library taxonomy), §4 (build order).
- Produces: section numbering Task 1's SKILL.md and Task 4's slim grammar point at.

- [ ] Rebuild, categorized (identity/rig → descriptors → verify gate → palette → seed rules → recipe → library build spec + build order → generation protocols/model tiers/scene assembly → registry → lock status/provenance). LOCKED values verbatim (see Global Constraints, incl. the two descriptor headers + blockquotes forge.py parses). Absorb VG §1 recipe, §2 rig execution notes, §3.1–3.6 taxonomy, §4 build order. Preserve every provenance learning: seed-from-reference; invariants-vs-flex; head-shape-follows-content; flash-holds-style-drifts-identity; every-figure-obeys-the-family + era clothing; recurring-elements-lock-like-characters + scene-style descriptor; base-then-fan-out; anchored iteration; one-variable-per-iteration; verify-every-character-in-every-scene. Rewrite the §8c NEVER-pile as the positive scene-assembly procedure (matching the SKILL.md technique menu). Keep the §9 approval rule + provenance log.
- [ ] Verify: `py -3 forge.py lookup …` still returns `REUSE:` (descriptor extraction unbroken); grep the new bible for `#f5ead6`, `#241a12`, "LOCKED STYLE descriptor", "STYLE-ONLY descriptor" — all present.
- [ ] Commit: `feat: style-bible absorbs recipe + library build spec (the image-gen doc)`

### Task 4: Slim visual-grammar.md

**Files:**
- Rewrite: `channels/the-second-take/visual-kit/visual-grammar.md`

- [ ] Keep ONLY staging law: the pointer block (universal §13/§13a is LAW), lever/register translation (old §5), composition/framing menu (old §3.7), cast staging notes (the staging-relevant parts of old §2: no on-screen narrator, institutions = cast + identity tag, mouth-led expressions, posture acting), pipeline feed (old §6, updated: image-generation runs the two passes after shots.json exists; live vocabulary = registry.json). One-line pointer to the bible's recipe + build spec. Remove everything absorbed by the bible.
- [ ] Verify: no content appears in both files (spot-check recipe, library list, build order → bible only).
- [ ] Commit: `refactor: visual-grammar slimmed to staging law (visual-prompt-writer's doc)`

### Task 5: Reference sweep

**Files:**
- Modify: `CLAUDE.md`, `.claude/skills/README.md`, `.claude/skills/visual-prompt-writer/SKILL.md` (+ its `references/shots-schema.md` if it names asset-forge), `channels/the-second-take/dna.md` + `storytelling-grammar.md` (if they reference the moved sections), `index.html` (if material), `channels/_TEMPLATE/` (if it references asset-forge).

- [ ] `grep -ri "asset-forge\|asset forge" --include="*.md" --include="*.html" --include="*.py"` repo-wide; update every LIVING doc to `image-generation`; leave decisions.md past entries + dated `docs/superpowers/specs/*` untouched.
- [ ] Grep for `visual-grammar` + `style-bible` references; fix any that point at moved sections (e.g. "visual-grammar §8 shot classes / §4 build order" → the bible's new section).
- [ ] Update the README skills table row (asset-forge → image-generation, two-pass description, new Reads/Writes).
- [ ] Verify: re-run the greps → zero stale references outside history/specs.
- [ ] Commit: `docs: reference sweep asset-forge → image-generation`

### Task 6: Fresh-eyes dry-run validation

- [ ] Dispatch a subagent given ONLY: the new SKILL.md, the new style-bible.md, registry.json, and `channels/the-second-take/videos/2026-07-04-poyais/shots.json`. Instruct: dry-run both passes on paper — (1) the pass-1 entity table + what it would generate vs reuse; (2) for 10 named shots, the pass-2 technique + exact seed files + model tier; (3) every point where the docs under-specify or contradict. NO generation.
- [ ] Fix the docs against its findings; iterate once (second subagent only if the first found blocking ambiguities).
- [ ] Commit: `docs: fix image-generation docs against fresh-eyes dry-run`

### Task 7: Close out

- [ ] decisions.md: dated entry (root cause → architectural fix; the two-pass flow; the doc split; the two follow-ups).
- [ ] CLAUDE.md status block: integrate (don't append) — image-gen rebuild line; skills list rename; next-up includes follow-ups #1 (render wiring + entity-naming rule) and #2 (Poyais dogfood → gold scene exemplars).
- [ ] index.html "Last updated" bump if touched in Task 5.
- [ ] Commit: `docs: log image-generation rebuild decision + status`
