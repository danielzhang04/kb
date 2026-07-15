# Still-Side Visual Authoring Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix VPW's still-frame generation (tableau law, scene facts, acting, casting) and add two fresh-eyes check layers (pre-gen shot critic, extended post-gen scene gate), per the approved spec `docs/superpowers/specs/2026-07-08-still-side-visual-authoring-rebuild-design.md`.

**Architecture:** In-place rebuild of `visual-prompt-writer/SKILL.md` (its mental model is contaminated by the retired Pattern A/B world) + surgical integrate-in-place edits to `shots-schema.md`, `image-generation/SKILL.md`, and `visual-grammar.md` staging sections + a new `critics.md` reference + a propose-only style-bible §3 edit + validation on the `_chain-test` fixture.

**Tech Stack:** Markdown skill files; `lint_shots.py` (Python, run `py -3`); git with explicit staged paths.

## Global Constraints

- **Integrate, don't append** (operating rule 6): every edit lands in the right existing section; no dated add-on blocks; remove what a change supersedes.
- **No itemized per-defect rules**: generalized laws + generalized check questions only.
- **Parallel-session boundary (HANDS OFF):** `universal.md` (all), `visual-grammar.md` **motion** section, `motion-tokens.json`, `build_motion.py`, `render-builder/engine/`, VPW motion-intent vocabulary. `ken_burns` + `within_shot_motion` stay authored exactly as today.
- **Locked files are propose-only:** `style-bible.md` edits are drafted and user-approved, never self-applied.
- **Git:** stage explicit paths only, never `git add -A`; commit after each task; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Read every target file in full before editing it (several were not read during design).

---

### Task 1: `shots-schema.md` — retire Pattern B fields, add the taxonomy seam

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/references/shots-schema.md`

**Interfaces:**
- Produces: the field contract Task 2's rebuilt SKILL.md references — `motion_prompt`/`asset_type` legacy-optional; `ken_burns`/`within_shot_motion` marked "frozen until the motion-intent taxonomy lands (teardown output; will be a lint-enforced enum like the stage fields)".

- [ ] **Step 1: Read the file in full.** Locate every mention of Pattern A/B, `motion_prompt`, `asset_type`, `ken_burns`, `within_shot_motion`.
- [ ] **Step 2: Edit in place:**
  - `motion_prompt`, `asset_type`: re-document as **legacy-optional** — "Pattern B (JSON2Video clips / video-gen) legacy only; the Remotion engine never reads them; VPW no longer authors them. Permitted on old files, not required, not validated."
  - Pattern A/B framing: rewrite the asset-resolution section around the real default (Remotion scenes mode; JSON2Video = legacy flag). Delete the "A→B is a config flag, write both specs" doctrine.
  - `ken_burns`, `within_shot_motion`: keep required/authored **exactly as today**, adding one seam line each: "Frozen: the motion-intent vocabulary (beat taxonomy from the motion-teardown synthesis) will replace/absorb this as a lint-enforced enum, like `stage`/`stage_role`. Do not extend its vocabulary before that lands."
  - Keep every other field contract unchanged (`vo_ref`, `vo_text`, `stage`, `changed_elements`, `duration_s`, `on_screen_text`, thumbnail, shorts).
- [ ] **Step 3: Verify.** `grep -n "Pattern B\|Kling\|motion_prompt" .claude/skills/visual-prompt-writer/references/shots-schema.md` → hits only in the legacy-optional passages. Run `py -3 .claude/skills/visual-prompt-writer/scripts/lint_shots.py channels/the-second-take/videos/_chain-test/shots.json` → still passes (no schema-breaking change; lint does not validate the legacy fields).
- [ ] **Step 4: Commit** `git add .claude/skills/visual-prompt-writer/references/shots-schema.md` → `Schema: motion_prompt/asset_type legacy-optional; taxonomy seam noted`.

---

### Task 2: VPW `SKILL.md` — in-place rebuild (still-side)

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md`

**Interfaces:**
- Consumes: Task 1's field contract.
- Produces: the authoring laws Task 3's critic checks against, referenced by name: **held-tableau law · scene-facts discipline · acting layer · casting pull-through · delta decisiveness · hook-frame bar**. Adds a step "Step 8 — shot critic (mandatory)" that references `references/critics.md` (created in Task 3).

- [ ] **Step 1: Rebuild the mental model + load-bearing rules.** Remove: "Provider-agnostic … write both specs" (rule 1), "write BOTH still_prompt and motion_prompt" (rule 5), every "Pattern A/B" and Kling/JSON2Video-as-default mention, and the instruction **"Compose `still_prompt` *to move*"** wherever it appears. Replace with the Remotion-reality model: *"VPW writes a still-frame plan plus intent metadata. Stills are produced by image-generation; motion is realized downstream by the Remotion engine from intent — VPW never authors mechanism (easing, amplitude, camera treatment beyond the existing frozen fields). The only motion VPW can rely on today: one spring camera arc per stage, idle baseline, code overlays, and changes arriving AT cuts (stage deltas)."* JSON2Video survives only as a legacy footnote.
- [ ] **Step 2: Write the six authoring laws into the sections that own them** (verbatim from spec §1 — held-tableau law and delta decisiveness into Step 3 + the load-bearing rules list; scene-facts discipline, acting layer, and casting pull-through into Step 2.5's procedure; hook-frame bar into the visual-question passage). Key text that must appear:
  - *Held-tableau law:* "Every still must read as a deliberate composition when frozen for its full duration. Held poses that carry action meaning are the vocabulary (a salute, a planted stance, presenting a deed, a held point); a freeze of continuous motion (mid-stride, mid-shuffle, mid-sweep) is broken output. The beat's change arrives at a cut (stage delta) or via motion intent — never baked into the pose."
  - *Scene-facts discipline:* "A `still_prompt` states the facts that are load-bearing for the beat's meaning — layout, orientation (who faces whom; a vehicle points where it travels), targets (what a gesture/highlight refers to, named precisely), casting/costume — such that a stranger could verify the image against the prompt. Load-bearing facts left implied are defects; exhaustive inventories are bloat, also a defect."
  - *Acting layer:* "Expression + pose are authored per shot, tracking beat/register per the channel staging law (`visual-grammar.md`); an expression change is a legitimate `changed_element` in a delta."
  - *Casting pull-through:* "Every story-named or story-referenced figure — including inside diegetic media (a brochure's prince who IS the story's con-man) — routes through registry casting; a role must read at a glance (a king reads as a king via 1–2 signifiers)."
  - *Delta decisiveness:* "A delta's `changed_elements` must be decisive: if the beat is a world-flip, the frame flips (full palette turn) — never a timid partial coexistence."
  - *Hook-frame bar:* "The hook shot is held to a scroll-stop standard — the most arresting staging of the beat, not the first competent one."
- [ ] **Step 3: Keep untouched** (verify each survives verbatim in intent): `vo_ref` anchor contract + lint step, stage/delta structure + `changed_elements` intent-only rule, cadence + stretch-to-fill law, densify, Step 2.5 narration→shot-class grammar, thumbnail step, shorts step, `on_screen_text` rules, `ken_burns`/`within_shot_motion` authoring (frozen; add the same one-line seam note as the schema).
- [ ] **Step 4: Add "Step 8 — shot critic (mandatory)"** after the lint step: "After `lint_shots.py` passes, dispatch the fresh-eyes shot critic per `references/critics.md`; edit `shots.json` through its findings; re-run the lint. Runs before any generation token is spent." Update the "Output to the user" section to include "critic pass ran, N findings addressed."
- [ ] **Step 5: Verify.** `grep -n "compose.*to move\|Pattern B\|Kling\|both specs\|motion_prompt" .claude/skills/visual-prompt-writer/SKILL.md` → only legacy-footnote hits. Read the rebuilt file top-to-bottom once for internal contradictions (a rule referencing a deleted rule is a failure).
- [ ] **Step 6: Commit** `git add .claude/skills/visual-prompt-writer/SKILL.md` → `VPW rebuild: still-side laws (tableau/facts/acting/casting), Remotion-reality model, critic step`.

---

### Task 3: `references/critics.md` — the pre-gen shot critic

**Files:**
- Create: `.claude/skills/visual-prompt-writer/references/critics.md`
- Read first (format model): `.claude/skills/long-form-writer/references/critics.md`

**Interfaces:**
- Consumes: the six authoring laws by name (Task 2).
- Produces: the critic protocol Step 8 dispatches.

- [ ] **Step 1: Read the long-form-writer critics file** and mirror its structure (dispatch protocol, critic charter, findings format, edit-through loop).
- [ ] **Step 2: Write the file.** Contents:
  - **Dispatch:** one fresh-eyes subagent (no shared context with the authoring run). Inputs: `shots.json`, `script.md`, `channels/<name>/visual-kit/visual-grammar.md`, the six authoring laws (quoted in the dispatch prompt so the critic needs no skill file).
  - **Charter — six generalized questions** (no itemized defect lists): (1) Does each scene's stated logic hold — geography, spatial sense, orientation, causality? (2) Would each still read as deliberate when frozen (tableau law) — any freeze-frame poses? (3) Is every named figure cast from the registry and role-legible? (4) Does acting (expression/pose) track the beat? (5) Is this the most interesting legitimate staging of the beat — hook held to the scroll-stop bar? (6) Does any shot depend on unrenderable animation to make sense?
  - **Findings format:** per shot-id: question #, the defect in one sentence, the fix direction (not rewritten prompts — the author rewrites).
  - **Loop:** author edits `shots.json` through findings → re-run `lint_shots.py --write` → a second critic pass only if the edit set was large (author's judgment); findings the author rejects are noted in the run summary to the user, never silently dropped.
- [ ] **Step 3: Verify.** Step 8 in SKILL.md and this file agree on inputs + loop (read both).
- [ ] **Step 4: Commit** `git add .claude/skills/visual-prompt-writer/references/critics.md` → `VPW: pre-gen shot critic reference`.

---

### Task 4: `image-generation/SKILL.md` — gate charter + casting (surgical)

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md`

**Interfaces:**
- Consumes: fact-stating `still_prompt`s (Task 2) — the fidelity question only works because prompts now state checkable facts.

- [ ] **Step 1: Extend gate 2 (scene-taste gate) in place** — add ONE question to the existing subagent charter: *"Does the image assert exactly what the prompt asserts — every stated fact realized (layout, facing, targets, geography, costume/casting) — and nothing extra that changes the read (no unrequested set dressing)?"* Add the shot's `still_prompt` to the materials the subagent receives (it currently gets beat/shot_class/vo_ref but not the prompt).
- [ ] **Step 2: Rework gate 1's procedure line** ("checked by LOOKING…"): add *"Verify countable locked invariants at the scale of the invariant: crop/zoom each hand (or other countable element) to full size before judging — a contact sheet can never clear a countable item."* Integrate into the existing gate-1 text; do not create a third gate.
- [ ] **Step 3: Pass 1 entity table** — extend the derivation rule in place: story-named or story-referenced roles **inside diegetic media** (a brochure figure, a portrait, a poster) are entities too and route through casting; canonical costume is part of a character's identity (an appearance in the wrong outfit fails the rig gate unless the shot authored the change).
- [ ] **Step 4: Verify.** Read the modified sections; confirm gates remain exactly two + the diff-gate, and no rule duplicates the style-bible.
- [ ] **Step 5: Commit** `git add .claude/skills/image-generation/SKILL.md` → `image-gen: prompt-fidelity gate question, counting-scale verify, diegetic casting`.

---

### Task 5: `visual-grammar.md` — staging-law additions (staging sections ONLY)

**Files:**
- Modify: `channels/the-second-take/visual-kit/visual-grammar.md` (§1 staging conventions, §2 composition menu — do NOT create or touch any motion section)

- [ ] **Step 1: Read the file in full.**
- [ ] **Step 2: Integrate into §1/§2:**
  - Tableau pose menu: the channel's held poses that carry action meaning (saluting, planted stance, presenting, a held point, bowed aftermath) — poses read deliberate when frozen; never freeze continuous motion.
  - Eye-line rule: co-stars share eye-line/height unless the size difference IS the beat's argument; interacting characters face each other unless the beat is about disconnection.
  - Expression-by-beat register mapping: smug/self-important on con beats · grim-flat on human cost (register OFF) · deadpan on irony · hopeful-warm on the sell — a register mapping, not per-scene rules; expression varies across a character's appearances.
  - Role legibility: named cast wear their pinned canonical outfits; a role (king, general, banker) reads at a glance via 1–2 signifiers.
  - Set-dressing motivation: everything in frame earns its place (meaning, palette, or staging); unmotivated scenery is a defect.
- [ ] **Step 3: Verify + commit immediately** (parallel-session collision risk): `git add channels/the-second-take/visual-kit/visual-grammar.md` → `visual-grammar: staging law — tableaux, eye-line, expression-by-beat, role legibility`.

---

### Task 6: style-bible §3 proposal + MacGregor red/gold pin (USER GATES)

**Files:**
- Propose (not self-applied): `channels/the-second-take/visual-kit/style-bible.md` §3
- Data: `channels/the-second-take/visual-kit/registry/registry.json` + `refs/` (+ candidates in `visual-kit/_staging/`)

- [ ] **Step 1: Draft the §3 edit** (the counting-scale verify procedure, mirroring Task 4's wording) and present it to the user as a diff-style proposal. Apply only on approval; commit separately.
- [ ] **Step 2: MacGregor costume pin.** `py -3 .claude/skills/image-generation/scripts/forge.py lookup --kit channels/the-second-take/visual-kit --character macgregor` (and read `registry.json`); collect every MacGregor ref incl. `_staging/test-macgregor-base`. Publish a small compare Artifact (big images + lightbox) → user picks the red/gold canonical → update the registry entry/notes so the costume is pinned as identity; register the chosen frame if it lives only in `_staging`.
- [ ] **Step 3: Commit** the approved changes with explicit paths → `style-bible §3 verify procedure (approved); registry: MacGregor red/gold canonical pinned`.

---

### Task 7: Validation on `_chain-test` (the acceptance test)

**Files:**
- Overwrite (intended; scratch fixture): `channels/the-second-take/videos/_chain-test/shots.json`, then `assets/scenes/`, `assets/final.mp4`

- [ ] **Step 1: Fresh VPW run** on `_chain-test` following the rebuilt SKILL (Steps 0–8 incl. lint + critic). Do NOT hand-tune the output beyond the critic loop — this is the generalization test.
- [ ] **Step 2: Present to user:** the new `shots.json` (open in VS Code + a summary of what changed vs the old plan: tableaux, facts, casting, expressions, hook). **STOP for user review** before spending generation tokens.
- [ ] **Step 3 (on approval): image-generation re-run** on the slice through the extended gates (fidelity question + counting-scale crops). Rebuild the render board Artifact (same URL `https://claude.ai/code/artifact/5c652760-a2f6-437b-be7a-4caf5e908869`, all scenes, lightbox + 2× zoom).
- [ ] **Step 4 (on approval): voiceover reuse + re-render** via `py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/_chain-test` (VO unchanged if the script text is unchanged) and refresh the video-player artifact.
- [ ] **Step 5: User verdict.** Pass → fixture may be deleted (user's call). Fail → findings feed back into the relevant file (fix the skill, not the output).

---

### Task 8: Close-out

**Files:**
- Modify: `knowledge/decisions.md`, `CLAUDE.md` (status block), `docs/handoffs/2026-07-08-chain-test-pickup.md`

- [ ] **Step 1: decisions.md** — one dated entry: the still-side rebuild (root causes → the six laws + two check layers), the check-layer architecture, the deferred post-teardown list (§13a-i reconciliation, motion-intent enum, `ken_burns` migration, stamp/X devices).
- [ ] **Step 2: CLAUDE.md status** — integrate into the existing visual-grammar/image-gen status bullets (don't append a new one if editing an existing bullet is truer): VPW rebuilt still-side + critic layer; gates extended; validation state.
- [ ] **Step 3: Handoff file** — update `2026-07-08-chain-test-pickup.md`: issues 1–4 dispositioned (fixed / deferred-to-teardown), or delete it if validation passed and the user agrees.
- [ ] **Step 4: Commit** explicit paths → `Close-out: still-side rebuild logged (decisions, status, handoff)`.

---

## Self-review (done at write time)

- **Spec coverage:** spec §1→Task 2, §2→Task 3, §3→Task 4, §5→Task 6, §6→Task 1, §4→Task 5, §7→Task 7, close-out+deferred→Task 8. No gaps.
- **Placeholders:** none — every edit lists its exact text or exact target rule.
- **Name consistency:** the six laws are named identically in Tasks 2, 3 and the spec; gate names match image-generation's existing "two gates + diff-gate" structure.
