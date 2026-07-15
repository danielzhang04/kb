# Pose/expression seeding (two-step) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the channel's pose/expression library into scene generation via a two-step build — VPW selects `pose_ref`/`expression_ref` from the registry, image-gen merges a posed-character (Pass 1) then places it in the scene (Pass 2) — so the correct 4-digit library hand is seeded, not re-synthesized from words.

**Architecture:** Four interlocking documentation/skill files change; **no code** (forge.py's multi-seed + §2c already do the mechanics). VPW authors intent (refs), image-gen owns mechanism (merge+place), style-bible §5 holds the seed doctrine. Every visual concern has exactly one authoring/generation home (the ownership map below).

**Tech Stack:** Markdown skill docs + a JSON schema doc. No runtime code, no tests-as-code — verification is `grep`/read checks for the change landing + no overlap/dead content surviving.

**Spec:** `docs/superpowers/specs/2026-07-10-pose-expression-seeding-two-step-design.md` (read it first).

## Global Constraints

**Shared vocabulary — every file MUST use these exact keys/strings (this is the cross-file contract):**
- Per-shot field: **`cast`** = array of `{ "character": "<registry name>", "pose_ref": "<slug>", "expression_ref": "<slug>" }` — `character` required when `cast` present; `pose_ref`/`expression_ref` each optional. Present on character-forward shots, omitted on character-free shots.
- Top-level per-video field: **`needed_assets`** = a single uniform array `[ { "kind": "pose | expression | interaction", "slug": "...", "wants": "<clear description of what to draw>", "why": "<which shot/beat>" } ]`. Interactions are just another `kind` — no separate path. Surfaced only after VPW checked the registry and found nothing close.
- Posed-character asset naming (image-gen `assets/library/`): **`<character>--<pose|none>--<expr|none>`** (e.g. `macgregor--offering--smug`, `macgregor--present--none`, `macgregor--none--worried`).
- **Hand-tone rule — canonical phrasing (authored once in style-bible §5, referenced elsewhere):** *"Every skin patch, INCLUDING BOTH HANDS, renders in the character's head tone — never the pose reference's tone."*
- **Merge delta binding template (image-gen Pass 1b):** *"Combine the references into ONE `<character>`: body pose + hands from the POSE reference; face/expression from the EXPRESSION reference; identity + costume from the CHARACTER reference (do NOT restate the costume — it lives in that reference). [§5 hand-tone rule]."*

**Single-home ownership map (enforced; audited in Task 5) — no concern authored twice:**
| Concern | ONE home | Must NOT also live in |
|---|---|---|
| Scene / placement / narrative action | `still_prompt` | — |
| Body pose + hands | `pose_ref` → seeded asset | `still_prompt` prose (remove) |
| Facial expression | `expression_ref` → seeded asset | `still_prompt` prose (remove) |
| Identity + costume | character seed + registry pinned costume | merge delta points to it, never restates coat |
| Skin/hand tone | §5 hand-tone rule | — |
| Form invariants (round head/no nose/ears/4-digit) | §2c auto-append + §3 review | NOT the specific pose |
| Which figures are in a shot | `cast` | prose figure-parsing (replace) |

**Doc discipline:** restructure-in-place (rewrite the governing section; delete superseded text — never leave contradictory guidance or stack dated append-blocks). Stage explicit paths only; never `git add -A` (parallel terminals share the tree). **Interactions are treated uniformly** — a `needed_assets` entry with `kind: interaction`, same gate + merge mechanism (the merge seeds the interaction-pose frame + the involved character canonicals); this build simply doesn't pre-generate the interaction category.

---

### Task 1: shots-schema.md — add `cast` + `needed_assets` (the contract)

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/references/shots-schema.md` (§1 JSON shape ~lines 41–67; the Notes list ~lines 115–160; §2 mapping table ~lines 172–186)

**Interfaces:**
- Produces: the `cast` and `needed_assets` field definitions that Tasks 3 (VPW writes) and 4 (image-gen reads) depend on. Exact keys per Global Constraints.

- [ ] **Step 1: Add `cast` to the per-shot object** in §1's `long_form.shots[]` example. Insert after the `shot_class` line, before `source`:

```json
        "cast": [
          { "character": "<registry character name>", "pose_ref": "<registry pose slug — OMIT if no specific pose>", "expression_ref": "<registry expression slug — OMIT if none>" }
        ],
```

- [ ] **Step 2: Add `needed_assets` at the top level** of the JSON shape (a sibling of `long_form`, after the `long_form` block closes, before `thumbnail`):

```json
  "needed_assets": [
    { "kind": "pose | expression | interaction",
      "_note": "an asset VPW needs that the registry LACKS; a HUMAN GATE — generate on the base + approve, or veto (VPW then restages onto existing assets). Interactions are just another kind.",
      "slug": "<new-asset-slug>",
      "wants": "<clear description of the pose/expression/interaction to draw>",
      "why": "<which shot/beat needs it>" }
  ],
```

- [ ] **Step 3: Add a Notes entry** documenting the fields + the single-home rule. Append to the Notes bullet list (after the `vo_text`/`shot_counts` bullet ~line 157):

```markdown
- **`cast` + `pose_ref`/`expression_ref` — the figure's pose/expression come from SEEDED library assets, not the `still_prompt`.** VPW records each prominent figure's registry pose/expression (INTENT); `image-generation` seeds them (a two-step posed-character merge → scene placement). **The `still_prompt` therefore describes the scene + the figure's placement/action ONLY — never its hand/finger mechanics, body-pose mechanics, or facial expression** (those are the `pose_ref`/`expression_ref` assets' job; authoring them in prose too is the double-authoring trap). `pose_ref`/`expression_ref` are each optional (pose-only / expr-only / both / neither). `cast` is how image-gen enumerates a shot's figures — it replaces prose figure-parsing. Seed doctrine: `style-bible.md §5`.
- **`needed_assets` — surface-then-gate.** When a shot needs a pose/expression/interaction the registry lacks, VPW adds an entry (`kind` + `slug` + **`wants`** = what to draw + `why`) and **HARD-STOPS** (does not proceed to generation). The human approves+generates on the base, or vetoes → VPW restages that beat onto EXISTING assets only. **Interactions are just `kind: interaction`** — same path, no special-casing; the `wants` description is what makes the request actionable.
```

- [ ] **Step 4: Add the two fields to the §2 render-mapping table** so it's clear render-builder ignores them (they're upstream). Add two rows to the "shot field | Remotion engine" table:

```markdown
| `cast` (`pose_ref`/`expression_ref`) | *(upstream authoring — consumed by image-generation for the posed-character merge; render-builder ignores)* |
| `needed_assets` (top-level) | *(upstream authoring/human-gate — not consumed by render-builder)* |
```

- [ ] **Step 5: Verify the fields are present and self-consistent.**

Run: `grep -n "cast\|pose_ref\|expression_ref\|needed_assets" .claude/skills/visual-prompt-writer/references/shots-schema.md`
Expected: the field appears in the JSON shape, the two Notes bullets, and the mapping table — using the exact keys `cast` / `pose_ref` / `expression_ref` / `needed_assets`.

- [ ] **Step 6: Commit.**

```bash
git add .claude/skills/visual-prompt-writer/references/shots-schema.md
git commit -m "feat(shots-schema): add cast (pose_ref/expression_ref) + needed_assets for pose-seeding"
```

---

### Task 2: style-bible §5 — rewrite the seed doctrine (governing law) + align §7/§8

**Files:**
- Modify: `channels/the-second-take/visual-kit/style-bible.md` (§5 seed rules ~lines 140–159; §7 build spec ~lines 202–232; §8 scene assembly ~lines 256–275; §10 log)

**Interfaces:**
- Consumes: nothing. Produces: the §5 seed doctrine + the canonical **hand-tone rule** string that Task 4's merge delta references verbatim.

- [ ] **Step 1: Read §5 in full** (`channels/the-second-take/visual-kit/style-bible.md`, the "## 5. Seed rules" section) so the rewrite replaces the word-driven line, not appends beside it.

- [ ] **Step 2: Rewrite §5's "Recurring character" bullet** from word-driven to seeded two-step. Replace the existing `- **Recurring character (identity):** seed off that character's stored **canonical frame** … change ONE variable (expression / outfit / pose / action).` bullet with:

```markdown
- **Recurring character (identity + pose + expression) — the two-step build.** A character's IDENTITY is
  its stored canonical frame. Its POSE and EXPRESSION are **not described in words** — they are SEEDED from
  the channel's library (§7): `image-generation` first **merges** a posed-character (seed the character
  canonical + the `pose_ref` frame + the `expression_ref` frame into one verified portrait), then **places**
  that single posed-character into the scene (single-seed). This is what carries the correct 4-digit library
  hand — re-synthesizing a pose from words reverts to the engine's 5-finger prior. `pose_ref`/`expression_ref`
  are each optional (pose-only / expr-only / both / neither = the plain canonical). VPW selects them from the
  registry (it authors INTENT; image-gen owns the merge mechanism). Outfit/action changes the delta still
  names remain delta variables; **pose and expression do not** — they are seeded.
- **Hand-tone rule (a merge invariant).** When a pose frame is seeded onto a character, the transferred hand
  takes the POSE frame's skin tone unless corrected. So: **Every skin patch, INCLUDING BOTH HANDS, renders in
  the character's head tone — never the pose reference's tone.**
```

- [ ] **Step 3: Delete the now-superseded word-driven pose/expression language** anywhere else in §5 (e.g. a "change ONE variable (expression/pose)" phrase in the delta-chain or composed-scene bullets that implies pose/expression come from words). Leave outfit/action as delta variables; remove pose/expression from the "word-driven variable" framing. (Read the section; excise contradictions, don't stack a correction.)

- [ ] **Step 4: Align §7 (library build spec)** — make the expression + action-pose entries' PURPOSE explicit: they are the **seed source** for posed-character merges. Add one clause to the §7 intro (the paragraph before the numbered build list):

```markdown
The expression set (item 1) and action-pose set (item 6) are the **seed source** for the two-step
posed-character merge (§5): a shot's `pose_ref`/`expression_ref` names one of these, and `image-generation`
seeds it onto the character. That is their function — not just an authoring vocabulary. A pose/expression a
video needs but the library lacks is generated on the base first (VPW surfaces it via `needed_assets`, human
gate), never re-drawn ad-hoc inside a scene.
```

- [ ] **Step 5: Align §8 (scene assembly)** — the composed-scene step must seed the POSED-CHARACTER, not the raw canonical + word-pose. In §8 "Scene assembly" step 1, change "seed the character canonical(s) present" to:

```markdown
1. **Compose the whole scene in ONE gen** (pro if a locked character is in frame): seed the **posed-character
   asset(s)** for the shot's `cast` (each = the character's canonical merged with its `pose_ref`/`expression_ref`
   per §5's two-step build — pose/expression already baked in, hands on the character's tone); the environment +
   fixed props + sky/water are DESCRIBED in the delta and composed in the SAME generation (never pre-baked as an
   isolated plate — §5). The delta REALIZES the `still_prompt`'s authored framing/placement (VPW owns
   composition — `visual-grammar.md §2`); image-gen executes it. It does NOT describe the pose or expression in
   words (those are in the seeded posed-character).
```

- [ ] **Step 6: Log it in §10** (the change-log home). Add after the 2026-07-10 rig-hold entry:

```markdown
- **2026-07-10 — pose/expression are SEEDED, not word-driven (the two-step build).** §5 rewritten: a
  character's pose + expression come from library frames merged into a posed-character (Pass 1) then placed in
  the scene (Pass 2), carrying the correct 4-digit library hand + the hand-tone rule (hands = character tone,
  not the pose ref's). The old word-driven pose/expression framing was removed (not appended-beside). §7 names
  the expression/pose sets as the seed source; §8 seeds the posed-character. VPW selects `pose_ref`/
  `expression_ref` (intent); image-gen owns the merge. Spec/plan: `docs/superpowers/specs|plans/2026-07-10-pose-expression-seeding-two-step*`.
```

- [ ] **Step 7: Verify the doctrine changed and the tone rule is present verbatim.**

Run: `grep -n "Every skin patch, INCLUDING BOTH HANDS" channels/the-second-take/visual-kit/style-bible.md`
Expected: exactly one hit (§5) — the canonical hand-tone string Task 4 will reference.

Run: `grep -ni "change ONE variable (expression\|pose from words\|describe the pose" channels/the-second-take/visual-kit/style-bible.md`
Expected: no matches (the word-driven pose framing is gone).

- [ ] **Step 8: Commit.**

```bash
git add channels/the-second-take/visual-kit/style-bible.md
git commit -m "feat(style-bible): §5 seeded two-step pose/expression doctrine + hand-tone rule; align §7/§8"
```

---

### Task 3: VPW SKILL — Step 5 selects refs; add the surface/veto gate; strip pose prose

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md` (Step 2.5 step 5 ~line 241; step 6 ~line 246; Step 3/7 flow; add a gate note; the "Output to the user" section ~line 418)

**Interfaces:**
- Consumes: the `cast`/`needed_assets` schema (Task 1) + §5 doctrine (Task 2). Produces: VPW emitting `cast` + `needed_assets`, and hard-stopping at the gate.

- [ ] **Step 1: Read Step 2.5 (steps 4–6) in full** so the edit restructures step 5 rather than appends.

- [ ] **Step 2: Restructure Step 2.5 step 5** (currently "Stage the tableau + act it") to SELECT refs from the registry, mirroring step 4's casting. Replace step 5 with:

```markdown
5. **Stage the tableau + act it — by SELECTING library assets, not describing them.** Mirror step 4's
   casting: for each prominent figure, choose its **`pose_ref`** (the held body pose/gesture that carries the
   action's meaning) and/or **`expression_ref`** (the face for this beat/register) **from the registry
   vocabulary**, and record them on the shot's `cast` entry. These are SEEDED by `image-generation` (§5
   two-step build) — so the pose/hands and the expression are the assets' job, **not** the `still_prompt`'s.
   Scene-first ordering: the shot's meaning/scene drives which pose/expression fits, never the reverse.
   `pose_ref`/`expression_ref` are each optional (a plain standing figure needs neither). A two-figure
   interaction (a clasp) uses an **interaction** asset — the same kind of `pose_ref`, just one that shows two
   figures; if the registry lacks it, surface it (below) as `kind: interaction`, no special path.
   - **Reuse-or-surface:** if the registry has a close-enough pose/expression/interaction, reference it (the
     `still_prompt` may still adjust the figure's *placement/angle*; the asset supplies the *hand/face*). If
     nothing is close, add a NEW entry to top-level `needed_assets` (`kind` + `slug` + `wants` + `why`) — then
     the gate (below) handles it.
```

- [ ] **Step 3: Amend Step 2.5 step 6** ("State the facts") to EXCLUDE pose/expression/hand mechanics from the `still_prompt` (the single-home boundary). Change step 6 to:

```markdown
6. **State the facts (scene + placement only).** Write the `still_prompt` so every load-bearing SCENE fact is
   explicit and checkable — layout, geography, who stands where, what a highlight/prop targets, the figure's
   narrative ACTION and PLACEMENT. **Do NOT describe the body pose, hand/finger mechanics, or facial
   expression** — those are seeded via `pose_ref`/`expression_ref` (step 5); authoring them here too is
   double-authoring (single-home map, `style-bible §5`). Everything in frame earns its place; nothing
   decorative that could mislead.
```

- [ ] **Step 4: Add the surface/veto GATE** as a short subsection right after Step 2.5 (before Step 3), so the authoring flow knows to hard-stop. Insert:

```markdown
### The pose/expression gate (hard stop before generation)

When any shot's `pose_ref`/`expression_ref` names an asset the registry LACKS, VPW records it in
`needed_assets` (with `kind` + `slug` + **`wants`** = what to draw + `why`) and **ends its run there — it does
NOT proceed toward generation.** Then a HUMAN:
- **approves** → the pose/expression/interaction is generated on the base + rig-gated, registered, and a later
  invocation resumes; OR
- **vetoes** (too niche/hard) → VPW **restages that beat using ONLY existing library assets** — it may not
  request a new asset for a vetoed beat (the convergence rule; no endless surface→veto loop). If a beat truly
  cannot be staged from existing assets, VPW flags THAT beat back to the human.
- **Interactions are handled uniformly** — a `kind: interaction` entry, same gate; nothing special.
This is the only path new base assets enter the library — never ad-hoc generation inside a scene (`style-bible §7`).
```

- [ ] **Step 5: Update the "Output to the user" section** so a run that surfaced `needed_assets` reports the hard-stop. Add a line to that section:

```markdown
- **If `needed_assets` is non-empty:** STOP and surface the wanted poses/expressions (+ each `why`) for the
  human gate — do not hand off to `image-generation`. List any interaction beats flagged for the separate pass.
```

- [ ] **Step 6: Verify the authoring change + no pose-in-prose guidance survives.**

Run: `grep -n "pose_ref\|expression_ref\|needed_assets\|pose/expression gate" .claude/skills/visual-prompt-writer/SKILL.md`
Expected: step 5, step 6, the gate subsection, and the output section all reference the exact keys.

Run: `grep -ni "set expression + pose\|pick the held pose from the channel" .claude/skills/visual-prompt-writer/SKILL.md`
Expected: no matches — the old "describe the pose/expression in the still_prompt" framing is replaced by ref-selection.

- [ ] **Step 7: Commit.**

```bash
git add .claude/skills/visual-prompt-writer/SKILL.md
git commit -m "feat(vpw): Step 5 selects pose_ref/expression_ref from registry; add surface/veto gate; strip pose prose"
```

---

### Task 4: image-generation SKILL — Pass 0 (coverage) / Pass 1 (merge) / Pass 2 (place)

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md` (Mode selection ~line 34; Pass 1 ~lines 49–100; Pass 2 prompt-assembly + technique table ~lines 102–170)

**Interfaces:**
- Consumes: `cast`/`needed_assets` (Task 1), §5 doctrine + hand-tone string (Task 2). Produces: posed-character assets keyed `<character>--<pose|none>--<expr|none>` that render-builder ultimately consumes as scene PNGs.

- [ ] **Step 1: Read Pass 1 + Pass 2 in full** so the changes restructure in place.

- [ ] **Step 2: Add Pass 0 (library coverage)** as a new section before "## Pass 1", and reference it in Mode selection. Insert:

```markdown
## Pass 0 — library coverage (the human gate is upstream, in VPW)

Before locking characters, ensure the pose/expression library covers this video. Read `needed_assets` from
`shots.json`. Each entry (`kind` ∈ pose | expression | interaction) has already passed the **human gate in
VPW** (approved, not vetoed — a vetoed one was restaged and is gone), and its `wants` says what to draw. For each:
1. Generate it **on the base** via the single-asset loop (`--mode new_character`/`identity` seeded off the
   template base), `2:3`. A `pose` asset shows the base figure in that gesture with clean four-digit hands; an
   `expression` asset shows the base face; an `interaction` asset shows TWO base figures in the interaction
   (both on the rig, correct hands) — same generation, just two figures.
2. **Human rig-gates** the generated frames (a base pose/expression is a channel asset — §10 approval).
3. `register` the approved frame into the registry (its `tag` = the `slug` VPW named). Now `pose_ref`/
   `expression_ref` resolves.
If `needed_assets` is empty, skip Pass 0. **Never** generate a pose ad-hoc inside a scene — poses come only
from the registry (bible §5/§7).
```

- [ ] **Step 3: Restructure Pass 1** into 1a (identity lock, today's behavior) + 1b (posed-character merge). After Pass 1's existing steps (which lock character canonicals), add step 1b:

```markdown
### Pass 1b — posed-character merge

For each DISTINCT `(character, pose_ref, expression_ref)` combo appearing in the shots' `cast`, build ONE
posed-character asset (a combo used by many shots is merged once, reused). Combo with neither ref → the plain
identity canonical (Pass 1a), no merge.

- **Merge gen:** seed `[<character canonical>, <pose_ref frame>, <expression_ref frame>]` (drop a seed a combo
  omits), `--mode environment`, plain background. Delta = the **binding template:** *"Combine the references
  into ONE `<character>`: body pose + hands from the POSE reference; face/expression from the EXPRESSION
  reference; identity + costume from the CHARACTER reference (do NOT restate the costume — it lives in that
  reference). Every skin patch, INCLUDING BOTH HANDS, renders in the character's head tone — never the pose
  reference's tone (bible §5 hand-tone rule)."* (`forge.py` auto-appends the §2c rig-hold — the form prior.)
- **Verify the portrait** against §3 + the combo's intent: 4-digit hands, hands on the CHARACTER's tone, the
  right expression, identity held. Retry ≤2, then flag. This is the isolation gate — a bad merge is caught
  HERE, cheaply, before any scene gen.
- Save as `assets/library/<character>--<pose|none>--<expr|none>.png`; record it in the library manifest with
  its `character`, `pose_ref`, `expression_ref`, and the `cast`-matching shot ids.
- **Interactions generalize the same merge:** an interaction `pose_ref` shared by two `cast` figures merges
  `[interaction-pose frame + character A canonical + character B canonical]` → a posed-INTERACTION asset (both
  figures, each identity bound to its position), same binding delta + hand-tone rule. This build doesn't
  pre-generate interactions, but the mechanism is uniform — validated on first use (as single poses were).
```

- [ ] **Step 4: Restructure Pass 2 prompt-assembly + technique (b)** to place the posed-character (single-seed) instead of seeding the raw canonical + word-pose. In the "Prompt assembly" paragraph, replace the technique-(b) clause about seeded characters with:

```markdown
technique: **(b) composed scenes → `--mode environment`** (the style-only descriptor; **seed the
POSED-CHARACTER asset** for each of the shot's `cast` figures — `assets/library/<character>--<pose|none>--<expr|none>.png`
— so the pose, expression, hands, and tone are already baked in; the delta describes ONLY the environment +
placement, NEVER the pose/expression/hands — those are in the seed);
```

- [ ] **Step 5: Update the technique table row (b)** to match. Change the "(b) Seeded composition" row's "How" cell to:

```markdown
ONE generation seeded on the **posed-character asset(s)** (`--seed <char--pose--expr>[,<char2--...>]`) for the shot's `cast`. The environment + props are DESCRIBED in the delta and composed in the gen. Delta = the `still_prompt`'s scene/placement facts only — the pose, expression, hands and tone are baked into the seeded posed-character (bible §5); do NOT re-compose or re-describe them
```

- [ ] **Step 6: Delete the superseded "describe/assert the pose in the delta" guidance** anywhere in Pass 2 (the old model where pose came from words). Read Pass 2; excise any instruction to author pose/expression/hands in the delta (they're now in the seed). Do not leave a contradicting sentence.

- [ ] **Step 7: Update Mode selection** to name Pass 0. Change the "A video" bullet to: `→ the **two-pass flow** below (preceded by **Pass 0** when `needed_assets` is non-empty).`

- [ ] **Step 8: Verify the three passes + single-seed placement + no word-pose survives.**

Run: `grep -n "Pass 0\|Pass 1b\|posed-character\|<character>--<pose" .claude/skills/image-generation/SKILL.md`
Expected: Pass 0 section, Pass 1b section, the technique-(b) placement, and the asset-naming all present.

Run: `grep -ni "describe the pose\|assert.*pose.*delta\|pose in the delta\|keep each seeded character EXACTLY" .claude/skills/image-generation/SKILL.md`
Expected: no matches — the word-driven pose model is gone.

- [ ] **Step 9: Commit.**

```bash
git add .claude/skills/image-generation/SKILL.md
git commit -m "feat(image-generation): Pass 0 coverage + Pass 1b posed-character merge + Pass 2 places posed-character"
```

---

### Task 5: cross-file alignment + single-home audit

**Files:**
- Read-only sweep across all four modified files + `forge.py` (confirm no change needed).

**Interfaces:**
- Consumes: Tasks 1–4. Produces: confirmation the vocabulary aligns and no concern is authored twice.

- [ ] **Step 1: Field-name alignment** — the contract keys must match across schema, VPW, image-gen.

Run: `grep -rn "pose_ref\|expression_ref\|needed_assets" .claude/skills/visual-prompt-writer .claude/skills/image-generation channels/the-second-take/visual-kit/style-bible.md`
Expected: every occurrence uses these exact spellings (no `poseRef`, `pose-ref`, `posed_ref` drift); the asset key is always `<character>--<pose|none>--<expr|none>`.

- [ ] **Step 2: Hand-tone rule has ONE home** (authored in §5, referenced not re-defined elsewhere).

Run: `grep -rn "Every skin patch, INCLUDING BOTH HANDS" channels .claude/skills`
Expected: the full canonical sentence appears authoritatively in style-bible §5; image-gen Pass 1b may quote/reference it, but there is no *divergent* re-wording of the rule.

- [ ] **Step 3: Single-home audit — pose/expression/hands live in exactly one place.**

Run: `grep -rni "still_prompt.*\(pose\|finger\|expression\)\|describe the pose\|set expression + pose" .claude/skills/visual-prompt-writer/SKILL.md .claude/skills/image-generation/SKILL.md`
Expected: no instruction telling the `still_prompt`/delta to author pose, finger, or expression mechanics. Read each hit; if one survives, it's dead content — remove it (route to the responsible task's file, commit the fix explicitly).

- [ ] **Step 4: Confirm forge.py needs no change** — the merge is a multi-seed gen with a delta the skill authors; §2c auto-append already fires on character seeds.

Run: `py -3 .claude/skills/image-generation/scripts/test_forge_hold.py`
Expected: `PASS` (regression guard; nothing in forge changed).

- [ ] **Step 5: Commit any alignment fix** (explicit paths only; skip if the sweep was clean).

```bash
git add -- <explicit files touched>
git commit -m "chore(pose-seeding): cross-file alignment + single-home audit"
```

---

## Self-Review

**Spec coverage:**
- Two-step (merge → place) → Task 4 (Pass 1b + Pass 2). ✓
- Authoring selects refs, scene-first → Task 3 (Step 5/6). ✓
- `cast` + `needed_assets` fields → Task 1. ✓
- Seed doctrine + hand-tone rule (one governing home) → Task 2 (§5). ✓
- Human gate + veto/convergence + interaction flag → Task 3 (gate subsection) + Task 4 (Pass 0 consumes approved). ✓
- Pass 0 coverage (human rig-gate) → Task 4 Step 2. ✓
- Single-home ownership / no overlap → Global Constraints table + Task 5 audit; dead-content removal in Tasks 2 Step 3, 3 Steps 3/6-verify, 4 Step 6. ✓
- Non-goals (interactions deferred; no forge/render change) → honored; Task 5 Step 4 confirms forge unchanged. ✓

**Placeholder scan:** the `<...>` tokens in the schema/asset-key/delta template are intentional format placeholders (the literal contract), not TODOs; every doc edit provides its actual new text. No "TBD".

**Type/name consistency:** `cast` / `pose_ref` / `expression_ref` / `needed_assets` / `<character>--<pose|none>--<expr|none>` / the hand-tone sentence are used identically in Tasks 1–4 and audited in Task 5. The merge binding template (Task 4 Step 3) quotes the §5 hand-tone sentence (Task 2 Step 2) verbatim.
