# Image-gen checking slim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three image-gen checking layers into one batched 3-agent review with a retry-2-then-flag loop, and rebuild the two governing docs in place so no duplication or contradiction survives.

**Architecture:** Rewrite the checking sections of `image-generation/SKILL.md` (the portable mechanism) and shrink `style-bible.md` §3 to a values-only channel checklist (the WHAT), reconciling §0/§8/change-log, then sweep both files for surviving contradictions. Generation flow, descriptors, and `forge.py` are untouched.

**Tech Stack:** Markdown docs; `git`; `grep`/`rg` for verification. No code, no pytest.

## Global Constraints

- **Rebuild-in-place, no append.** Delete superseded content; no dated log-blocks, no orphaned old rules, no "fixed here but left the contradiction there." (CLAUDE.md operating rule 6.)
- **Generation is unchanged.** The two-pass flow, technique menu (a–e), model tiers, and the §2/§2b prompt descriptors — including the "three fingers + a thumb / Mickey-Simpsons" finger enforcement — stay exactly as they are. Only *checking* changes.
- **No hand crops, ever.** The `forge.py crop` procedure is removed from the flow (the command stays in code).
- **One governing location per concern.** The finger rule, the rig checklist, and the "verify" instruction each live in exactly one governing place; every other mention references it, never restates a divergent version.
- **`forge.py` untouched.** `crop`/`diff` stay as available tools; the flow stops mandating them.
- **Out of scope:** the visual-prompt-writer pre-gen shot critic (`critics.md`, VPW Step 8); the `_chain-test` fixture (untracked — never `git add` it); the still-side pickup handoff file.
- **Commit explicit paths only.** Never `git add -A` (parallel terminals run on this repo).
- **Spec:** `docs/superpowers/specs/2026-07-09-image-gen-checking-slim-design.md`.

---

### Task 1: Rewrite the checking flow in `image-generation/SKILL.md`

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md` — the "two gates" section (lines ~186–223), the Pass-2 per-scene verify line (~163), and the Report section (~237–241).

**Interfaces:**
- Produces (referenced by Task 2/3): the batched review is the single owner of the *procedure*; the manifest scene record gains `flagged: false | "<reason>"`.

- [ ] **Step 1: Replace the "The two gates" + "Retry budget" block** (from `## The two gates (every output, no exceptions)` through the end of the `**Retry budget:**` paragraph) with:

```markdown
## Reviewing the batch (ONE pass, after every scene is generated)

Generate all of Pass 2 first — **do not gate mid-run, and run no per-delta diff-gate.** When the
batch is complete, run ONE review round over the whole thing, then regen only what is genuinely wrong.

**Dispatch three concurrent review subagents**, each one tight mandate over the whole batch. Give each
the generated scene files + per shot its `still_prompt`, `vo_text` (the full narrated span — facts
often live in the tail), and `beat`/`shot_class`, plus the bible **§3 rig checklist**, the **§6
recipe**, and `universal.md §13a` (shot-class definitions):

1. **Identity/rig** — for every frame with a seeded character: did it hold that character's identity
   and stay on-rig per §3 (round head, no nose, no ears, four-digit hands, correct pinned costume)?
   Judge against the channel's **approved canonical** (`refs/<char>/<char>-base.png`), NOT an idealized
   pure-circle rig. This also owns **held-set drift** — across a stage's delta chain the set and
   identities must not wander; judge it by looking at the frames. Look at the FULL frame; **never crop
   hands.**
2. **Fidelity** — does each image assert **exactly the shot's load-bearing facts** (layout, geography,
   orientation / who faces whom, gesture + highlight targets, casting/costume) and **nothing extra that
   changes the read**? Check the prompt's claims one by one against the pixels.
3. **Style/taste** — does it read as its `beat` and `shot_class` at a glance, on-recipe (flat-cel 2.5D,
   built-but-flat, marker-honest per §6) — or is it slop / off-register / drifting to the detailed
   middle?

Each returns a **flagged list keyed by shot id** — one sentence per defect, quoting the offending
fact. **Merge the three lists.** A frame no agent flagged ships as-is.

**Fix flagged frames — bounded, no grind:**
- Regen the frame once, folding its flag(s) into the delta (same technique + seeds).
- **Self-check only the flagged points** on the new frame by looking at it — do NOT re-dispatch the
  review agents, do NOT re-review the whole batch.
- **≤2 regen attempts.** If a frame still fails after two, **keep the best attempt, mark it `flagged`
  in `assets/scenes/manifest.json` with the reason, and move on.** No technique-switch escalation
  ladder, no ~6-attempt cap.
```

- [ ] **Step 2: Update the Pass-2 per-scene manifest line** (currently `- Verify BOTH gates per scene (below), move passes into ... verified: {rig, scene}, notes`) to defer verification to the batched review and record the flag:

```markdown
- Generate the scene, move it to `assets/scenes/<shot-id>.png`, and record `{shot_id, file,
  technique, seeds, model, flagged: false, notes}` in `assets/scenes/manifest.json` (skipped shots get
  a `skipped` entry). Verification is the batched review below, not a per-scene gate — the `flagged`
  field is set there.
```

- [ ] **Step 3: Update the two worked examples** (Poyais L22 at ~173–179, and the "Verify BOTH gates" mentions) so they reference "the batched review (identity/fidelity/style)" instead of "verify rig + scene gate." Remove the parenthetical "(MacGregor on-rig? … four digits per hand at crop scale?)" crop reference — replace with "(identity held, on-rig, facts realized, on-recipe)".

- [ ] **Step 4: Update the Report section** to describe the flagged artifact:

```markdown
## Report

What shipped (library counts, scenes by technique), what was reused, what the batched review caught
per category (identity / fidelity / style) and what it regenerated, and any frames that stayed
**flagged** after the ≤2 retries (with their reason). Publish the generated images for human review via
an Artifact link — full frames, **flagged ones marked with their reason** — the human review is the
final authority (the user can't see them inline). No hand crops.
```

- [ ] **Step 5: Verify the old checking apparatus is gone.**

Run:
```bash
cd /c/Users/danie/faceless-youtube
rg -n 'two gates|diff-gate|held-set diff|crop --regions|native-scale hand crop|switch technique ONCE|hard cap of ~6|Retry budget' .claude/skills/image-generation/SKILL.md
```
Expected: **no matches** (the diff-gate as a mandatory step, the crop procedure, and the old retry ladder are all gone). A remaining mention of `forge.py diff`/`crop` as an *optional available tool* is acceptable only if it does not reappear as a mandated gate — confirm by reading any hit.

- [ ] **Step 6: Verify the new review is specified exactly once and coherently.**

Run:
```bash
rg -n 'Reviewing the batch|three concurrent review subagents|≤2 regen attempts|never crop hands' .claude/skills/image-generation/SKILL.md
```
Expected: the batched-review header, the 3-agent dispatch, the ≤2 rule, and the no-crop rule each appear once.

- [ ] **Step 7: Commit.**

```bash
git add .claude/skills/image-generation/SKILL.md
git commit -m "refactor(image-gen): collapse 3 checking gates into one batched review

Replace per-image rig grind + per-batch scene gate + per-delta diff-gate
+ hand-crop procedure with ONE post-gen review (3 concurrent agents:
identity/fidelity/style), retry-2-then-flag, flagged frames pushed to
the human artifact. No hand crops. Generation flow unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Shrink `style-bible.md` §3 to a values-only checklist + reconcile §0/§8/change-log

**Files:**
- Modify: `channels/the-second-take/visual-kit/style-bible.md` — §3 (lines ~86–127), §0 step 4 (~18), §8 verify-loop bullet (~243–244), the change-log finger entries (~344–356).

**Interfaces:**
- Consumes: Task 1's batched review owns the *procedure*; §3 provides the *values* it checks.
- Produces: §3 is the single channel rig checklist referenced by the identity/rig review agent.

- [ ] **Step 1: Replace all of §3** (`## 3. Acceptance checklist — the rig gate` through the parenthetical scene-taste-gate note) with:

```markdown
## 3. The rig checklist — channel invariants (values only)

The **WHAT** the `image-generation` skill's batched review checks every generated frame against; that
skill owns the **HOW** (the one post-gen review). Judge against the channel's **approved canonical**
(`refs/<char>/<char>-base.png` — the bar we actually ship), NOT an idealized pure-circle / articulated-
finger rig: drift from it fails, matching it passes.

**Every character, every frame (the shared rig, §1) — the rig drifts most inside busy scenes:**
- **Head** — round near-circle, only slightly taller than wide; NOT reshaped, NOT an egg/oval; same
  head-to-body proportion as the base.
- **No nose, no ears** — the first things to drift in scenes.
- **Hands — four digits** (three fingers + a thumb), never five, six, or a mitten. Enforced in the §2
  descriptor (the pinned 3-finger cartoon hand — the generation-side prior that renders it reliably);
  the review confirms it by looking at the **full frame — no hand crops, no per-hand counting grind.**
- **Facial layout** — same eye style/size/position; brows and mouth in the same places (only expression
  + slight brow/mouth-size shifts).
- **Outline** — even medium-thick dark warm brown-black (`#241a12`), not pure black, not thin.
- **Render** — clean flat cel shading, even line weight; cartoon, flat tones, not realistic.
- **Head tone** — one uniform flat tone (no gradient, no realistic skin, no blush).
- **Costume** — a named character's pinned canonical costume is part of identity; the wrong outfit fails
  unless the shot authored the change.
- **Requested text only, verbatim** — no unrequested words/labels/logos/watermarks. A composed SCENE
  may carry text its shot deliberately authored (a stamp, an on-artifact label — the HeyHistorically
  idiom), which renders in the §6 marker hand and must be legible + correctly spelled; a garbled or
  misspelled render of the asked-for words is a miss. Library character frames stay fully text-free.
- **Count** — exactly the number of characters the scene declares.

**Never checked — these vary:** pose, expression, camera framing, hair/facial hair, outfit, head-tone
choice, body build (stout/slight), age linework, action squash/stretch. Never reject a frame for an
exaggerated action pose, for a cast member having hair, or for a non-default head tone.

(A composed scene is additionally judged for **fidelity** and **taste** in the same batched review —
that procedure lives in the `image-generation` skill.)
```

- [ ] **Step 2: Reconcile §0 step 4** (currently `4. **Verify every output** against §3 by actually opening the PNG. Bounded retry (≤3), escalate locked-file faults, never ship an unverified frame.`) to:

```markdown
4. **Every output is reviewed** against §3 (the rig checklist) in the `image-generation` skill's one
   batched post-gen review (identity / fidelity / style). Bounded retry (≤2), then a residual defect is
   **flagged** for the human artifact — never silently ship an off-model frame, and never grind.
```

- [ ] **Step 3: Reconcile the §8 "Verify loop" bullet** (currently `- **Verify loop:** every frame runs the §3 gate — pass = ship + index; fail = fix the transient prompt + retry (≤3); the same item failing ~3× = stop, diagnose, escalate ... Never self-edit this file.`) to:

```markdown
- **Verify loop:** frames are reviewed in the `image-generation` skill's batched post-gen pass
  (§3 checklist + fidelity + taste), not per-frame mid-gen; a flagged frame is regenerated ≤2× then
  flagged-and-pushed. A locked-file fault (a §-value that looks wrong) is surfaced for approval, never
  self-edited here.
```

- [ ] **Step 4: Consolidate the change-log finger entries.** Replace the two entries `**2026-07-08 — hand count LOCKED...` and `**2026-07-09 — hand rule HARDENED...` (the whole two paragraphs) with a single clean entry, and add one entry for this change:

```markdown
- **2026-07-08/09 — hand count LOCKED at four digits (three fingers + a thumb), enforced in the
  prompt.** The §2/§2b descriptors name the *classic 3-finger cartoon hand (Mickey/Simpsons)* — a
  strong prior that renders 3+1 far more reliably than fighting the engine's 5-finger default (open /
  spread / raised-hand poses were the drift point). This is a **generation-side** guarantee; the
  standing library was audited and offenders regenerated. (`forge.py` also gained JPEG→PNG
  normalization — pro `gemini-3-pro-image` started returning JPEG.)
- **2026-07-09 — checking slimmed to one batched review.** The per-image rig LOOK grind + per-batch
  scene gate + per-delta diff-gate + hand-crop-and-count procedure collapsed into ONE post-gen batched
  review (3 concurrent agents: identity/fidelity/style) with retry-2-then-flag, owned by the
  `image-generation` skill; §3 here is now the values-only checklist it reads. Removed the finger-check
  self-contradiction (human-authority vs counting-subagent) and the cross-file duplication of the gate
  procedure. Spec: `docs/superpowers/specs/2026-07-09-image-gen-checking-slim-design.md`.
```

- [ ] **Step 5: Verify the procedure/contradiction is gone from the bible.**

Run:
```bash
rg -n 'forge crop|crop --regions|native-tile|native-scale|counting subagent|per-hand|glance-count|HARDENED|montage' channels/the-second-take/visual-kit/style-bible.md
```
Expected: **no matches** (the crop procedure, the counting-subagent alternative, and the contradiction wording are gone).

- [ ] **Step 6: Verify §3 is values-only and the finger prompt-enforcement still lives in §2.**

Run:
```bash
rg -n 'three fingers plus ONE thumb|THREE fingers|Mickey' channels/the-second-take/visual-kit/style-bible.md
```
Expected: matches in **§2 / §2b** (the descriptors — untouched) and the §3 one-line "enforced in the §2 descriptor" reference; NOT a re-specified counting procedure.

- [ ] **Step 7: Commit.**

```bash
git add channels/the-second-take/visual-kit/style-bible.md
git commit -m "refactor(style-bible): §3 -> values-only rig checklist; drop crop/count procedure

Shrink §3 to channel invariants (values), defer the HOW to the
image-generation batched review. Reconcile §0/§8 verify language.
Consolidate the stacked/contradictory finger change-log entries into
one clean entry + log the checking-slim change. Descriptors untouched.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Cross-file consistency sweep + project bookkeeping

**Files:**
- Read-only sweep: `.claude/skills/image-generation/SKILL.md`, `channels/the-second-take/visual-kit/style-bible.md`.
- Modify: `knowledge/decisions.md` (append a dated decision line), `CLAUDE.md` (the image-generation status bullet).

**Interfaces:**
- Consumes: Tasks 1 + 2's rewritten files.

- [ ] **Step 1: Sweep both files for a surviving contradiction on the finger authority.**

Run:
```bash
cd /c/Users/danie/faceless-youtube
rg -n 'human is the authority|human.s.? call|let the human glance|counting subagent|crop' .claude/skills/image-generation/SKILL.md channels/the-second-take/visual-kit/style-bible.md
```
Expected: no hit that reintroduces a per-hand counting/crop procedure or a "human counts hands" gate that contradicts the batched review. (The human *artifact review as final authority* is fine and expected; a hand-*counting* procedure is not.)

- [ ] **Step 2: Confirm each concept has one governing home.** Read the hits from:

```bash
rg -n 'rig checklist|rig gate|batched review|verify every output|flagged' .claude/skills/image-generation/SKILL.md channels/the-second-take/visual-kit/style-bible.md
```
Expected: the *procedure* (batched review, ≤2, flag) lives only in the skill; the *values* (rig checklist) live only in bible §3; §0/§8 only *reference* them. Fix any restated-divergently instance inline before committing.

- [ ] **Step 3: Append the decision to `knowledge/decisions.md`** (integrate at the bottom of the log, one entry):

```markdown
**2026-07-09 — Image-gen checking slimmed to one batched review.** The ~30-min `_chain-test` check
time was root-caused to three overlapping gate layers (per-image rig LOOK + per-batch scene gate +
per-delta diff-gate + a hand-crop procedure) and a finger-check self-contradiction bred by cross-file
duplication (the rig gate was fully specified in BOTH `image-generation/SKILL.md` and `style-bible.md`
§3). Fix: ONE post-gen batched review — 3 concurrent agents (identity/fidelity/style) — with
retry-2-then-flag; flagged frames pushed to the human artifact (the final authority); no hand crops.
`style-bible.md` §3 is now the values-only rig checklist (the WHAT); the skill owns the procedure (the
HOW). Generation flow + §2/§2b descriptors (incl. the Mickey/Simpsons finger prior) unchanged. Spec:
`docs/superpowers/specs/2026-07-09-image-gen-checking-slim-design.md`.
```

- [ ] **Step 4: Update the `CLAUDE.md` image-generation status bullet** (the "STILL-SIDE VISUAL AUTHORING REBUILT" / image-generation area) — integrate a clause noting the checking was slimmed to one batched review (identity/fidelity/style, retry-2-then-flag, no hand crops); do NOT append a new dated block — edit the relevant existing bullet in place per operating rule 6.

- [ ] **Step 5: Commit (explicit paths only).**

```bash
git add knowledge/decisions.md CLAUDE.md
git commit -m "docs: log image-gen checking-slim decision + status

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Final fresh-eyes read.** Re-read the rewritten checking section of `image-generation/SKILL.md` and §3 of `style-bible.md` end to end. Confirm: a fresh terminal could run the review in one pass with no contradictory instruction, no reference to a deleted procedure, and no per-image grind. Note (do not fix now) that an actual `_chain-test`-scale gen run to measure the wall-clock win is a separate, user-triggered validation (real token spend).

---

## Self-Review

**Spec coverage:**
- Design §1 (generation unchanged) → Global Constraints + Task 1/2 leave the flow/descriptors untouched. ✓
- Design §2 (3 gates → one batched 3-agent review) → Task 1 Step 1. ✓
- Design §3 (retry-2-then-flag) → Task 1 Step 1 (fix block) + manifest `flagged` field (Task 1 Step 2). ✓
- Design §4 (human artifact = gate, no crops) → Task 1 Step 4 (Report) + Constraints. ✓
- Doc rebuild: SKILL.md mechanism → Task 1; §3 values-only + §0/§8/change-log reconcile → Task 2; forge.py untouched → Constraints; cross-file sweep → Task 3. ✓
- Success criteria: contradiction/duplication gone → Task 1 Step 5–6, Task 2 Step 5–6, Task 3 Step 1–2; genuine defects still caught → Task 1 Step 1 keeps all 3 categories. ✓

**Placeholder scan:** none — every rewrite block carries the actual final prose; every verification is a concrete `rg` with an expected result. ✓

**Type consistency:** the manifest field is `flagged: false | "<reason>"` in both Task 1 Step 1 and Step 2; "batched review" / "identity / fidelity / style" naming is consistent across Tasks 1–3. ✓
