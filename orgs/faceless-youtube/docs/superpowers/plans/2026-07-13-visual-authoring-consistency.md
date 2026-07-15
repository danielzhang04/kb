# Visual-Authoring + Consistency Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the visual-authoring + consistency half of the 2026-07-13 overhaul spec — crowd-rig tier, recurring-prop lock, casting lint, expression restraint, per-word/reveal authoring conventions, and the two image-gen manifest seams (verified-stamp + card-background-as-scene) — as cross-file-consistent LOGIC changes.

**Architecture:** Almost every change is a *logic replacement* in a prose law file (style-bible, visual-grammar, the VPW / image-generation SKILLs, the shots schema) — each edit REPLACES the stale rule in place (never appends a "BUT NOTE" rider). Two code artifacts change: `lint_shots.py` (a new derived casting check, with a plain-assert test) and `forge.py` (a prop-seed guard, with a plain-assert test). Three asset-build run-steps (crowd rig = NONE; recurring-prop canonicals; the 18-frame expression re-author) are documented as gated procedures, not code.

**Tech Stack:** Python 3 (`py -3`, plain `assert` tests — no pytest), Markdown law docs, JSON registry/manifest/schema. Image engine = `gemini-3-pro-image` via `forge.py`.

## Global Constraints

- **This plan is HALF the spec.** It covers **Phases A, D, the image-gen side of C (C1, C2), and Sweep fixes #1/#4/#5.** It does **NOT** touch the render/engine/motion-planner half (Phase B render-side, C3 lint-params, B0–B4 mechanism). Do not edit: `render-builder/**`, `motion-planner/**`, `build_motion.py`, `render.py`, `LayerView`/engine, `animation-menu.json`, `shots-motion-schema.md`, `motion-schema.md`. (You will READ render.py/shots-motion-schema.md to align on the shared contract; you will not edit them.)
- **Shared contract (do not break — the render-side plan depends on it):** the scenes-manifest entry field **`verified: {"scene": true, "rig": true}`** — this plan (C1) WRITES it; the already-built render gate (`render.py::resolve_scene_files`, lines 211–216) READS it (`entry["verified"]["scene"] is True and ["rig"] is True`). And: **a layered/hybrid shot has no `scenes/<id>.png`** (it uses `plates/` + `cutouts/`); only a normal or card-only shot has `scenes/<id>.png`. Note the contract; change nothing in render-builder.
- **One vocabulary, everywhere:** **"crowd rig"** (the prompted simplified tier for anonymous background/crowd figures), **"prop lock"** / **"recurring prop"** (the per-video prop library slot), **"recurring identifiable"** (the umbrella for characters / named groups / props that lock once and reuse). Do not coin variants ("small-figure spec", "crowd character", "prop character").
- **Change logic, don't append.** Each doc edit REPLACES the stale sentence(s). No dated log-blocks, no parallel "new rule" lists beside the old.
- **Derived stays derived.** `shots.json` / `shots.motion.json` stay authored; the lint checks (A3) are derived-only.
- **Do NOT re-author `refs/base/expr-*.png` or generate prop canonicals as part of a doc task.** Those are the gated asset-build tasks (Task 5, Task 8, Task 9) — real generations with a HUMAN rig-gate.
- **Test bed:** the act-1 slice `channels/the-second-take/videos/_t2-tier1-test/` (has `shots.json`, `script.md`, `shots.motion.json`). Doc-logic edits are verified by re-running the relevant skill on this slug + eyeballing, plus a grep assertion that the new law is present and the stale text is gone. Code edits (Task 4, Task 6) carry plain-assert tests.
- **Kit path** (for forge/lint commands): `channels/the-second-take/visual-kit`.

---

### Task 1: C1 — stamp `verified:{scene,rig}` on the scenes manifest (image-generation)

The render gate is already built and READS `verified`; image-gen only fails to WRITE it, so every real scene is rejected until hand-stamped. Fix the manifest-write step + the review so a passed shot is stamped `verified:{scene:true,rig:true}` and a flagged shot stays unverified.

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md` (Pass 2 manifest-entry shape + the "Fix flagged frames" review-close step)
- Modify: `.claude/skills/visual-prompt-writer/references/shots-schema.md` (§2 mapping row — note the manifest gate field; contract-doc only)

**Interfaces:**
- Consumes: nothing new.
- Produces: the scenes-manifest per-shot entry now carries **`verified: {"scene": bool, "rig": bool}`** in addition to the existing `{shot_id, file, technique, seeds, flagged, notes}`. `render.py::resolve_scene_files` already reads exactly this (`v.get("scene") is True and v.get("rig") is True`). A shot passing the batched review with no identity/rig flag AND no fidelity/style flag → `verified:{scene:true,rig:true}`, `flagged:false`. A shot still flagged after ≤2 retries → `verified:{scene:false,rig:false}` (or the failing axis false), `flagged:true`.

- [ ] **Step 1: Update the Pass-2 manifest-entry shape in the SKILL.** In `image-generation/SKILL.md`, find the Pass 2 "Generate the scene" bullet:

```
- Generate the scene, move it to `assets/scenes/<shot-id>.png`, and record `{shot_id, file, technique,
  seeds, flagged: false, notes}` in `assets/scenes/manifest.json` (skipped shots get a `skipped`
  entry). Verification is the batched review below, not a per-scene gate — the `flagged` field is set
  there.
```

Replace with:

```
- Generate the scene, move it to `assets/scenes/<shot-id>.png`, and record `{shot_id, file, technique,
  seeds, flagged: false, verified: {scene: false, rig: false}, notes}` in `assets/scenes/manifest.json`
  (skipped shots get a `skipped` entry). `verified` starts false and is stamped true only by the batched
  review below (a scene is NOT shippable until then) — `flagged` and `verified` are both set there.
  **`verified` is the render gate:** `render-builder` treats a scene present on disk but with
  `verified.scene`/`verified.rig` != true as NOT shippable (`render.py::resolve_scene_files`), so an
  unstamped scene hard-errors the render exactly like a missing one.
```

- [ ] **Step 2: Make the review-close step stamp `verified`.** In `image-generation/SKILL.md`, find the "Fix flagged frames — bounded, no grind" block. Append a new final bullet after the `≤2 regen attempts` bullet:

```
- **Stamp the gate.** After the batch settles, write each shot's manifest entry: a scene that ends with
  NO identity/rig flag AND no fidelity/style flag → `verified: {scene: true, rig: true}`, `flagged: false`.
  A scene still flagged after ≤2 retries → keep `flagged: true` and leave `verified.scene`/`verified.rig`
  **false on the axis that failed** (an identity/rig flag → `rig: false`; a fidelity/style flag → `scene:
  false`). Only a fully-passed shot is `{scene: true, rig: true}`. This stamp IS what unblocks
  render-builder's gate — a shipped-but-unstamped manifest rejects every scene.
```

- [ ] **Step 3: Note the gate field in the render-mapping doc.** In `shots-schema.md` §2, find the mapping row:

```
| `still_prompt` | image-generation's input → the verified scene PNG the shot displays |
```

Add a new row immediately after it:

```
| *(scenes/manifest.json `verified:{scene,rig}`)* | image-generation stamps `verified:{scene:true,rig:true}` on a shot only after its batched review passes; render-builder's scenes gate treats an unstamped/false entry as NOT shippable (a present-but-unverified PNG hard-errors like a missing one). Authored by image-gen, not VPW. |
```

- [ ] **Step 4: Verify.** Run:

```bash
grep -n "verified: {scene: false, rig: false}" .claude/skills/image-generation/SKILL.md
grep -n "Stamp the gate" .claude/skills/image-generation/SKILL.md
grep -n "verified:{scene,rig}" .claude/skills/visual-prompt-writer/references/shots-schema.md
```

Expected: each grep returns its line. Confirm the old `{shot_id, file, technique, seeds, flagged: false, notes}` string (without `verified`) no longer appears: `grep -c "flagged: false, notes}" .claude/skills/image-generation/SKILL.md` → expected `0`.

- [ ] **Step 5: Commit.**

```bash
git add .claude/skills/image-generation/SKILL.md .claude/skills/visual-prompt-writer/references/shots-schema.md
git commit -m "feat(image-gen): stamp scenes-manifest verified:{scene,rig} so render gate reads it (C1)"
```

---

### Task 2: C2 — device-card background is a SCENE, not a plate (image-generation)

A card-only shot (an engine device-card overlay, no cutout) whose baked number is subtracted currently writes the subtracted background to `plates/<id>.png`, but the renderer resolves a card shot's background from `scenes/<id>.png`. Fix: a card-only shot's number-omitted background is a normal `scenes/<id>.png`; only cutout-bearing shots use `plates/`.

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md` (the "Layered shots (from `shots.motion.json`)" block)

**Interfaces:**
- Consumes: `shots.motion.json` layer markers (read-only — from the motion-planner plan). A shot whose only layer(s) are `source: engine` (device cards) and has NO `source: cutout` layer = "card-only".
- Produces: card-only shot → its number-subtracted background at **`assets/scenes/<id>.png`** (a normal scene, the number omitted), stamped `verified` per Task 1, so render resolves it as an ordinary scene. `plates/<id>.png` is produced ONLY for a shot that carries a cutout layer. (Shared contract: a cutout-bearing/hybrid shot has no `scenes/<id>.png`; a card-only shot DOES.)

- [ ] **Step 1: Read the current layered-shots block.** In `image-generation/SKILL.md`, locate the block beginning `**Layered shots (from ` shots.motion.json `).**` and its three sub-bullets (`plate`, `cutout layers`, `engine layers`) plus the `Hybrid` bullet.

- [ ] **Step 2: Rewrite the `engine layers` sub-bullet** to route the card-only background to `scenes/`. Find:

```
- **engine layers** (`source: engine` — device cards) need NO asset; the engine draws them.
```

Replace with:

```
- **engine layers** (`source: engine` — device cards) need no cutout asset; the engine draws the card
  itself. **But when a card REPLACES a baked number/label** in the scene (a stat/counter card standing in
  for a figure the still would otherwise render as garbled gen-text), generate the **number-subtracted
  background as a normal `scenes/<id>.png`** — the ordinary scene with that one number/label omitted, still
  a COMPLETE frame (never a blank hole where the number was). It is a scene, not a plate: a card-only shot
  (engine layer(s), NO `cutout` layer) has a `scenes/<id>.png` and NO `plates/<id>.png`. Only a
  cutout-bearing shot writes `plates/`.
```

- [ ] **Step 3: Scope the `plate` sub-bullet to cutout-bearing shots.** Find:

```
- **plate** `plates/<id>.png` — gen `background.plate_prompt` (the scene MINUS the moved/carded elements),
  which must still read as a **complete** object — never a blank slot where a subtracted element was.
```

Replace with:

```
- **plate** `plates/<id>.png` — **only for a shot that carries a `cutout` layer.** Gen
  `background.plate_prompt` (the scene MINUS the moved element), which must still read as a **complete**
  object — never a blank slot where the subtracted element was. A card-ONLY shot (engine layers, no
  cutout) does NOT get a `plates/` file — its number-subtracted background is a `scenes/<id>.png` (see the
  engine-layers bullet).
```

- [ ] **Step 4: Verify.** Run:

```bash
grep -n "card-only shot" .claude/skills/image-generation/SKILL.md
grep -n "number-subtracted background as a normal" .claude/skills/image-generation/SKILL.md
```

Expected: both return their lines. Cross-check the contract note against the read-only render doc (no edit): `grep -n "generates \*\*no \`plates" .claude/skills/render-builder/references/shots-motion-schema.md` — confirm the render doc still says a hybrid overlay shot generates no `plates/<id>.png` (your card-only routing is consistent with it: card-only ≠ hybrid, card-only uses `scenes/`).

- [ ] **Step 5: Commit.**

```bash
git add .claude/skills/image-generation/SKILL.md
git commit -m "fix(image-gen): card-only device-card background is a scenes/<id>.png, not a plate (C2)"
```

---

### Task 3: A1 — crowd-rig tier (a PROMPTED simplified rig, no asset build)

The learning behind ~10 feedback points (noses, mittens, mismatched crowd faces): an anonymous crowd has no identity to lock, and a SIMPLER rig (dot eyes, one plain mouth) is easier for the gen to hold on many tiny faces than the full detailed rig — whose fine detail is exactly what drifts into noses. Crowds are PROMPTED with the crowd rig, never seeded. **No asset is built.**

**Files:**
- Modify: `channels/the-second-take/visual-kit/style-bible.md` (§1 add the crowd-rig form spec; new §2d CROWD-RIG clause; §3 add the crowd-rig check; §8 scene-assembly step 3 replace the "detail may drop" footnote)
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md` (fundamental rule 5 crowd sentence; Step 2.5 step 4 casting)
- Modify: `.claude/skills/image-generation/SKILL.md` (Pass 2 "Every human figure obeys the family" bullet)
- Modify: `channels/the-second-take/visual-kit/visual-grammar.md` (§1 anonymous-crowd sentence — one-vocabulary pointer)

**Interfaces:**
- Consumes: VPW writes the §2d crowd-rig clause verbatim into a crowd shot's `still_prompt` (the words the forge sends must carry it).
- Produces: the canonical **§2d CROWD-RIG blockquote** (round heads, dot eyes, one simple mouth, no noses/ears, same proportions, varied era clothing). VPW references §2d; image-gen renders anonymous crowds on the crowd rig and reviews them against it; a foreground *named/seeded* figure in the same shot still holds the FULL rig via its seed. No new field, no asset, no registry entry.

- [ ] **Step 1: Add the crowd-rig form spec to style-bible §1.** After the `**VARIES — per character**` block (the two bullets ending `…stop a reaction mapping onto the character.`), and before `## 2. LOCKED STYLE descriptor`, insert:

```
**The CROWD RIG — anonymous background / crowd figures (a SIMPLER tier, not the full rig).** An
*anonymous* crowd (an audience, a mob, settlers on a dock — different non-recurring people, no shared
identity to lock) is **PROMPTED on a simplified rig, never seeded.** It holds the shared FORM — round
head, same head-to-body proportion, **no nose, no ears, no teeth** — but with **simplified features: DOT
EYES + one simple consistent mouth** (basic emotion only: neutral / smile / downturn), identical on every
crowd figure. The full detailed rig's fine features are exactly what drift into noses on many tiny faces;
the crowd rig is easier for the engine to hold at scale. A *named / foreground* character standing in the
same shot is NOT on the crowd rig — it keeps its full rig via its own seed. Crowds are never a Pass-1
lock (an anonymous crowd is different faces each time — a composition, not a recurring identity). *(A
recurring identifiable GROUP — a specific named band/troupe that reappears — is the opposite: it IS cast
and locked; see §7.)*
```

- [ ] **Step 2: Add the new §2d CROWD-RIG clause.** In style-bible, immediately after the `## 2c. RIG-HOLD descriptor` section (after the paragraph ending `…this is their prompt-side voice, not a third definition.`), insert:

```
## 2d. CROWD-RIG clause (verbatim — write INTO a crowd scene's prompt)

> The background / crowd figures are on the CROWD RIG: round cream-family heads, DOT EYES, one simple
> consistent mouth (neutral / smile / downturn only), NO noses, NO ears, NO teeth, the same head
> proportions, in varied era-appropriate clothing. Keep every crowd figure on this same simplified rig —
> do not give them individual detailed faces.

This clause governs the **anonymous** figures only. Unlike §2c (which `forge.py` auto-appends to every
character-bearing gen), **§2d is authored by VPW into the `still_prompt`** of any shot with an anonymous
crowd (the prompt the engine sees must carry these words) — it is not auto-appended, because most shots
have no crowd. A foreground named character in the same shot still holds its FULL rig via its seed + the
auto-appended §2c; §2d simplifies only the anonymous background.
```

- [ ] **Step 3: Add the crowd-rig check to style-bible §3.** In §3, find the `**Count**` bullet (`- **Count** — exactly the number of characters the scene declares.`) and insert a new bullet immediately before it:

```
- **Crowd figures — the crowd rig (§2d), not the full rig.** An anonymous crowd is judged against the
  CROWD rig: round heads, dot eyes, one simple mouth, no noses/ears/teeth, consistent across all crowd
  figures. A crowd figure rendered with individual detailed faces, noses, or mismatched styles is a FAIL;
  a *named/seeded* foreground figure in the same frame is still judged against the FULL rig (above).
```

- [ ] **Step 4: Replace the §8 "detail may drop" footnote.** In style-bible §8, under "Scene assembly", find step 3:

```
3. **Every human figure in the frame is the §1 family** — background crowds and incidental extras included,
   in **era/story-appropriate clothing** (never the template's modern hoodie, never random modern dress).
   Prompt them explicitly: "the same flat-cel cartoon family — round heads, no noses, [era] clothing."
   Detail may drop as figures recede or multiply (smaller, simpler, vaguer faces); art style, proportions,
   and period never switch.
```

Replace with:

```
3. **Every human figure in the frame is the §1 family — named foreground figures on the FULL rig,
   anonymous crowds on the CROWD RIG (§2d).** A named/seeded figure keeps the full rig (via its seed +
   the auto-appended §2c). An anonymous crowd is rendered on the crowd rig — the VPW-authored §2d clause
   ("round cream-family heads, dot eyes, one simple mouth, no noses/ears/teeth, same proportions, varied
   era clothing") is already in the `still_prompt`; generate the crowd from it, no seed. This REPLACES the
   old "detail may drop, vaguer faces" guidance: crowd figures are not a degraded full rig, they are a
   deliberately simpler rig, uniform across the crowd. Art style, proportions, and period never switch.
```

- [ ] **Step 5: Rewrite VPW fundamental rule 5's crowd sentence.** In `visual-prompt-writer/SKILL.md`, in the "A prompt states its FACTS" fundamental (rule 5), find:

```
   Crowds and extras are stated **"on the rig"** (family-form: round heads, no noses, era clothing) so
   they hold at scale.
```

Replace with:

```
   Anonymous crowds and extras are stated **on the CROWD RIG** — write the `style-bible.md §2d` crowd-rig
   clause verbatim into the `still_prompt` (round heads, dot eyes, one simple mouth, no noses/ears/teeth,
   same proportions, varied era clothing) so they hold uniformly at scale. A *named* figure in the same
   shot is cast (full rig), never folded into the crowd clause.
```

- [ ] **Step 6: Update VPW Step 2.5 step 4 (casting) crowd handling.** In `visual-prompt-writer/SKILL.md`, Step 2.5 step 4, find:

```
An **anonymous** crowd (different nonrecurring people)
   stays prose in the `still_prompt`, never cast. If a group member later acts alone in a hero shot, cast
   that member as an individual.
```

Replace with:

```
An **anonymous** crowd (different nonrecurring people)
   stays prose in the `still_prompt`, never cast — and its prose is the **`style-bible.md §2d` crowd-rig
   clause** written verbatim (round heads, dot eyes, one simple mouth, no noses/ears/teeth), so the engine
   renders it on the simplified crowd rig. If a group member later acts alone in a hero shot, cast that
   member as an individual.
```

- [ ] **Step 7: Update the image-gen Pass 2 family bullet.** In `image-generation/SKILL.md`, Pass 2, find:

```
- **Every human figure obeys the family** (bible §3/§8): incidental extras and crowds included, in
  era/story-appropriate clothing — prompt them explicitly as family-form figures; detail may drop with
  distance, style/proportions/period never switch.
```

Replace with:

```
- **Every human figure obeys the family** (bible §3/§8): named foreground figures on the FULL rig (seeded
  + §2c), anonymous crowds on the **CROWD RIG (§2d)** — the crowd-rig clause is already in the shot's
  `still_prompt`, so render the crowd from it (no seed) on the simplified rig (round heads, dot eyes, one
  simple mouth). Review crowd figures against the crowd rig, not the full rig. Style/proportions/period
  never switch.
```

- [ ] **Step 8: One-vocabulary pointer in visual-grammar §1.** In `visual-grammar.md` §1, in the "recurring identifiable GROUP" bullet, find:

```
An **anonymous** crowd (different nonrecurring people — an audience,
  a mob) stays prose in the `still_prompt`.
```

Replace with:

```
An **anonymous** crowd (different nonrecurring people — an audience,
  a mob) stays prose in the `still_prompt`, written as the **`style-bible.md §2d` crowd-rig clause** (the
  simplified rig — round heads, dot eyes, one simple mouth), never seeded.
```

- [ ] **Step 9: Verify.** Run:

```bash
grep -n "## 2d. CROWD-RIG clause" channels/the-second-take/visual-kit/style-bible.md
grep -n "CROWD RIG" channels/the-second-take/visual-kit/style-bible.md | head
grep -n "§2d" .claude/skills/visual-prompt-writer/SKILL.md .claude/skills/image-generation/SKILL.md channels/the-second-take/visual-kit/visual-grammar.md
grep -c "detail may drop\|Detail may drop" channels/the-second-take/visual-kit/style-bible.md .claude/skills/image-generation/SKILL.md
```

Expected: §2d present in style-bible; `§2d` referenced in VPW + image-gen + visual-grammar; the "detail may drop" count is `0` in both files (stale footnote gone). Then re-run VPW on the slice and eyeball that a crowd shot's `still_prompt` now carries the §2d clause: `Skill(visual-prompt-writer)` on `_t2-tier1-test`, then `grep -c "dot eyes" channels/the-second-take/videos/_t2-tier1-test/shots.json` should be > 0 if the slice has any anonymous crowd (if it has none, note that and eyeball the doc law instead).

- [ ] **Step 10: Commit.**

```bash
git add channels/the-second-take/visual-kit/style-bible.md channels/the-second-take/visual-kit/visual-grammar.md .claude/skills/visual-prompt-writer/SKILL.md .claude/skills/image-generation/SKILL.md
git commit -m "feat(visual): crowd-rig tier — prompted simplified rig for anonymous crowds (A1)"
```

---

### Task 4: Sweep #1/#10 — reconcile §2c so it doesn't force the full rig onto crowd figures

§2c RIG-HOLD currently says "every cartoon FIGURE keeps the shared rig" — which contradicts the new §2d crowd rig (forge auto-appends §2c to any character-bearing gen, so a crowd scene with a seeded named character would carry §2c and pull the full rig onto the crowd). Reword §2c to scope it to foreground/named/seeded figures; confirm forge's auto-append is unaffected.

**Files:**
- Modify: `channels/the-second-take/visual-kit/style-bible.md` (§2c RIG-HOLD blockquote + its trailing paragraph)

**Interfaces:**
- Consumes: `forge.py::blockquote_after(md, "RIG-HOLD descriptor")` extracts the §2c blockquote text and auto-appends it (via `should_hold`) to character-bearing gens. The reword changes only the WORDS forge injects; it does not change which gens get it.
- Produces: a §2c blockquote scoped to "every FOREGROUND / named / seeded figure keeps the FULL rig; anonymous background/crowd figures follow the §2d crowd-rig clause when the prompt states it." No code change — the reworded prose is the fix (#1 and #10 are the same edit).

- [ ] **Step 1: Reword the §2c blockquote.** In style-bible §2c, find the blockquote:

```
> Every cartoon FIGURE in this image keeps the shared FAMILY RIG exactly as the reference(s): SAME round
> near-circle head (only slightly taller than wide, NOT an egg/oval), SAME eye style/size/position, NO nose,
> NO ears, SAME classic cartoon hands — exactly THREE fingers plus ONE thumb (four digits total, Mickey /
> Simpsons style, NEVER four fingers, NEVER five digits), SAME even medium-thick dark warm brown-black
> (#241a12) outline, SAME clean FLAT cel render. Hold ONLY this form — costume, pose, expression, head
> tone, build, and framing are set by the generation delta, not here.
```

Replace with:

```
> Every FOREGROUND / named / seeded cartoon figure in this image keeps the shared FAMILY RIG exactly as
> the reference(s): SAME round near-circle head (only slightly taller than wide, NOT an egg/oval), SAME
> eye style/size/position, NO nose, NO ears, SAME classic cartoon hands — exactly THREE fingers plus ONE
> thumb (four digits total, Mickey / Simpsons style, NEVER four fingers, NEVER five digits), SAME even
> medium-thick dark warm brown-black (#241a12) outline, SAME clean FLAT cel render. Anonymous background /
> crowd figures instead follow the §2d CROWD-RIG clause when the prompt states it (simplified: dot eyes,
> one simple mouth) — do NOT force this full rig onto them. Hold ONLY this form — costume, pose,
> expression, head tone, build, and framing are set by the generation delta, not here.
```

- [ ] **Step 2: Reword the §2c trailing paragraph's "any generation with a figure" claim.** Find the sentence:

```
This block holds **form, not identity** (it never says "the same person"), so it is safe on any generation
with a figure — a seeded existing character (identity carried by the seed image), a new character (identity
set by the delta), or a held-set chain delta.
```

Replace with:

```
This block holds **form, not identity** (it never says "the same person"), so it is safe on any generation
with a SEEDED / foreground figure — a seeded existing character (identity carried by the seed image), a new
character (identity set by the delta), or a held-set chain delta. It does not govern the anonymous crowd
(the §2d crowd rig does); a crowd scene that also seeds a named figure still gets §2c auto-appended for
THAT figure, and the §2c wording above now explicitly exempts the crowd so the two rigs coexist in one
frame.
```

- [ ] **Step 3: Confirm forge's auto-append still parses the reworded §2c.** The reword keeps §2c a single `>` blockquote directly under the `## 2c. RIG-HOLD descriptor` header, so `blockquote_after` still extracts it. Verify:

```bash
py -3 -c "import sys; sys.path.insert(0,'.claude/skills/image-generation/scripts'); import forge; md=open('channels/the-second-take/visual-kit/style-bible.md',encoding='utf-8').read(); t=forge.blockquote_after(md,'RIG-HOLD descriptor'); print('OK len', len(t)); assert 'FOREGROUND' in t and 'CROWD-RIG' in t and 'THREE fingers' in t, 'reworded 2c not extracted'; assert t.startswith('Every FOREGROUND'), t[:40]"
```

Expected: prints `OK len <n>` and no assertion error (forge extracts the reworded blockquote intact, including the crowd exemption). This confirms the auto-append injects the scoped text — no forge code change needed (Sweep #1 satisfied by the reword alone).

- [ ] **Step 4: Verify the stale text is gone.**

```bash
grep -c "Every cartoon FIGURE in this image keeps" channels/the-second-take/visual-kit/style-bible.md
```

Expected: `0` (the old unscoped opener is replaced).

- [ ] **Step 5: Commit.**

```bash
git add channels/the-second-take/visual-kit/style-bible.md
git commit -m "fix(visual): scope §2c rig-hold to foreground/seeded figures; crowd follows §2d (sweep #1/#10)"
```

---

### Task 5: A2 — recurring-prop lock (per-video prop library slot + asset build)

A recurring identifiable PROP (the guidebook, a banknote) currently composes per-scene → drifts. Mirror the character lock: generate its canonical ONCE, seed/reuse into each appearance. This task lands the LOGIC (doc + schema + registry note) AND the gated asset-build run-steps.

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/references/shots-schema.md` (add the `props` array to the shot shape + a mapping/notes line)
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md` (Step 2.5 step 4 — declare recurring props)
- Modify: `.claude/skills/image-generation/SKILL.md` (Pass 1 — a recurring prop earns a library slot)
- Modify: `channels/the-second-take/visual-kit/style-bible.md` (§7 build-spec + §9 registry note)
- Asset build (run-steps, HUMAN gate): generate prop canonicals for the act-1 slice into `assets/library/prop-<name>.png`

**Interfaces:**
- Consumes: a shot's new optional **`props: ["<prop-name>", …]`** array (parallel to `cast`) names the recurring-prop library slots to seed. image-gen Pass 1 reads `props` across all shots to build the prop table.
- Produces: per-video prop canonical at **`assets/library/prop-<name>.png`** (naming: `prop-` prefix — load-bearing for the forge guard in Task 6), recorded in the library manifest with `kind: prop`. A prop has no pose/expression → no merge; per-shot placement is composed in Pass 2 off the seeded prop canonical. A prop named in prose but absent from `props` is an authoring gap (like an uncast figure — see Task 7 note; A3 lints characters, props are surfaced by the image-gen prose-vs-`props` cross-check).

- [ ] **Step 1: Add the `props` array to the shot shape in the schema.** In `shots-schema.md` §1, in the long-form shot object, find the `cast` block:

```
        "cast": [
          { "character": "<registry character name>", "pose_ref": "<registry pose slug — OMIT if no specific pose>", "expression_ref": "<registry expression slug — OMIT if none>" }
        ],
```

Insert immediately after it (before `"source": "hybrid",`):

```
        "props": ["<recurring-prop name, e.g. guidebook — parallel to cast; OMIT if none recur>"],
```

- [ ] **Step 2: Document the `props` array in the schema notes.** In `shots-schema.md`, immediately after the `cast` + `pose_ref`/`expression_ref` notes bullet (the one ending `…An anonymous crowd stays prose in the `still_prompt`, never cast.`), add a new bullet:

```
- **`props` — recurring-prop lock (parallel to `cast`).** A **recurring identifiable prop** (a specific
  object whose look must MATCH across shots — the guidebook, a named banknote) is declared in a shot's
  optional `props` array by its library name. `image-generation` Pass 1 gives each such prop ONE canonical
  (`assets/library/prop-<name>.png`, `prop-` prefix required) and seeds/reuses it into every appearance —
  no pose/expression, no merge; per-shot placement is composed in Pass 2 off the seeded canonical. Omit
  `props` when nothing recurs; a one-off prop stays composed per-scene from the `still_prompt` (no slot). A
  recurring prop named in the `still_prompt` prose but absent from `props` is an authoring gap (image-gen
  flags it back, like an uncast figure). `render-builder` ignores `props` (upstream-authoring only).
```

- [ ] **Step 3: Add `props` to the render-mapping table.** In `shots-schema.md` §2, add a row after the `cast` row:

```
| `props` | *(upstream authoring — consumed by image-generation for the per-video prop lock; render-builder ignores)* |
```

- [ ] **Step 4: VPW Step 2.5 step 4 — declare recurring props.** In `visual-prompt-writer/SKILL.md`, Step 2.5, at the END of step 4 ("Cast it."), after the anonymous-crowd sentence you edited in Task 3 Step 6, append:

```
   **Recurring props are declared like cast.** A specific identifiable object that recurs across shots and
   must look the SAME each time (the guidebook, a named banknote, a signed deed) is named in the shot's
   **`props` array** (its library name). A recurring prop named in the prose but omitted from `props` is an
   authoring gap, exactly like an uncast named figure. A one-off object (used in a single shot, no match
   requirement) stays in the `still_prompt` prose only — no `props` entry, no slot.
```

- [ ] **Step 5: image-gen Pass 1 — a recurring prop earns a slot.** In `image-generation/SKILL.md`, Pass 1 step 1, find the bullet:

```
   - **Props, environments, plates, and *anonymous/nonrecurring* crowds do NOT earn a slot** — they're
     composed inside the scene's Pass-2 gen (an anonymous crowd is different people each time, a
     composition, not a recurring identity; an adjacent shot holding the same crowd/set carries it via
     technique (e)). *(A recurring identifiable GROUP is the exception above — it DOES earn a slot.)* A channel-SIGNATURE prop/environment recurring
     across MANY videos is a separate deliberate build (bible §7 standing kit + the single-asset loop),
     never a per-video Pass-1 default.
```

Replace with:

```
   - **A recurring identifiable PROP earns a per-video library slot** (mirrors the character lock). A
     specific object appearing across multiple shots whose look must MATCH (the guidebook, a named
     banknote) — every shot referencing it lists it in that shot's **`props` array** — gets ONE canonical
     generated ONCE (`assets/library/prop-<name>.png`, `prop-` prefix, `--mode environment`/`style`, no
     character seed), then seeded/reused into each appearance. A prop has no pose/expression → **no Pass-1b
     merge**; its per-shot placement (held up, on a desk, stamped) is composed in the Pass-2 scene gen off
     the seeded prop canonical. **`props` names each recurring prop by its library name — no prose
     guesswork** (a prop VPW referenced in the `still_prompt` but omitted from `props` is an authoring gap;
     flag it back).
   - **Environments, plates, one-off props, and *anonymous/nonrecurring* crowds do NOT earn a slot** —
     they're composed inside the scene's Pass-2 gen (an anonymous crowd is different people each time, a
     composition, not a recurring identity; an adjacent shot holding the same crowd/set carries it via
     technique (e)). *(A recurring identifiable GROUP is the exception above — it DOES earn a slot.)* A
     channel-SIGNATURE prop/environment recurring across MANY videos is a separate deliberate build (bible
     §7 standing kit + the single-asset loop + a `kind: environment` registry entry), never a per-video
     Pass-1 default.
```

- [ ] **Step 6: Extend the Pass-1 manifest shape to record prop slots.** In `image-generation/SKILL.md`, Pass 1 step 5, find:

```
5. **Write `assets/library/manifest.json`:** `{video_slug, generated, assets: [{name, kind: character,
   file, source: reused|generated, seed: [<frames used>], shots: [<shot ids>], notes}]}` (the per-video
   library is characters only; a deliberately-promoted channel prop/environment carries its own registry
   kind).
```

Replace with:

```
5. **Write `assets/library/manifest.json`:** `{video_slug, generated, assets: [{name, kind: character|prop,
   file, source: reused|generated, seed: [<frames used>], shots: [<shot ids>], notes}]}` (the per-video
   library is recurring characters + recurring props — a prop entry is `kind: prop`, `file`
   `assets/library/prop-<name>.png`, no pose/expr; a deliberately-promoted channel-signature
   prop/environment additionally carries its own `kind: environment` registry entry, bible §9).
```

- [ ] **Step 7: style-bible §7 — name the recurring-prop lock in the build spec.** In style-bible §7, the intro paragraph currently reads (`(A single video's scene environments/props are composed in-shot at generation time…` — find):

```
(A single video's scene environments/props are composed in-shot at generation time — `image-generation`
Pass 2 / §8 step 1 — never pre-baked as plates; per-video Pass 1 locks only that video's recurring individual
characters — plus any recurring identifiable GROUP, locked once as a group-character.)
```

Replace with:

```
(A single video's *one-off* scene environments/props are composed in-shot at generation time —
`image-generation` Pass 2 / §8 step 1 — never pre-baked as plates; per-video Pass 1 locks that video's
recurring individual characters, any recurring identifiable GROUP (locked once as a group-character), AND
any **recurring identifiable PROP** — a specific object whose look must match across shots (a guidebook, a
named banknote), locked once as `assets/library/prop-<name>.png` and seeded into each appearance, no
pose/expression.)
```

- [ ] **Step 8: style-bible §9 — a prop note in the registry schema.** In style-bible §9, find:

```
Environments/props/plates are `assets` with `kind: environment`
(there is no separate top-level environments list).
```

Replace with:

```
Cross-video channel-signature environments/props/plates are `assets` with `kind: environment` (there is no
separate top-level environments list). A **per-video recurring prop** is NOT a registry entry — it lives
only in that video's `assets/library/` (`kind: prop`, `prop-<name>.png`); it graduates to a `kind:
environment` registry entry only if it recurs across MANY videos (a deliberate §8 promotion).
```

- [ ] **Step 9 (ASSET BUILD — HUMAN GATE): generate the act-1 recurring-prop canonicals.** This is a real generation, gated. Run-steps:
  1. Identify the slice's recurring props: read `_t2-tier1-test/shots.json`, list every object named in ≥2 shots' `still_prompt` whose look must match (for the Poyais act-1 slice this is the **guidebook**; confirm by inspection). Add a `props` array naming it to each shot that shows it.
  2. Generate each canonical: `py -3 .claude/skills/image-generation/scripts/forge.py gen --kit channels/the-second-take/visual-kit --name prop-guidebook --mode environment --aspect 1:1 --delta "<the guidebook described as a standalone object on a plain background, flat-cel, #241a12 outline — a bound leather-and-gilt promotional guidebook to Poyais>"` (no character seed; §2b style-only descriptor auto-prepends).
  3. Review the staged frame against §3 (line + flat-cel + no unrequested text) by looking at it; retry ≤2.
  4. **HUMAN RIG-GATE:** publish the staged prop frame(s) via an Artifact link (big images, per the user's review-images-via-artifact rule) and STOP for approval — a prop canonical is a per-video asset the human signs off, same as a new character. Do not proceed to seed it into scenes until approved.
  5. On approval: `py -3 forge.py place --kit … --name prop-guidebook --to channels/the-second-take/videos/_t2-tier1-test/assets/library` and add the `{name, kind: prop, file, …}` entry to the library manifest.

- [ ] **Step 10: Verify the logic edits.** Run:

```bash
grep -n '"props":' .claude/skills/visual-prompt-writer/references/shots-schema.md
grep -n "recurring identifiable PROP earns" .claude/skills/image-generation/SKILL.md
grep -n "prop-<name>.png" channels/the-second-take/visual-kit/style-bible.md .claude/skills/image-generation/SKILL.md
```

Expected: each returns its line. (The asset build in Step 9 is verified by the human rig-gate, not a grep.)

- [ ] **Step 11: Commit the logic edits** (commit the asset build separately if/when approved).

```bash
git add .claude/skills/visual-prompt-writer/references/shots-schema.md .claude/skills/visual-prompt-writer/SKILL.md .claude/skills/image-generation/SKILL.md channels/the-second-take/visual-kit/style-bible.md
git commit -m "feat(visual): recurring-prop lock — per-video prop library slot + props[] array (A2)"
```

---

### Task 6: Sweep #4 — a prop-canonical seed must NOT trigger the §2c rig-hold (forge.py)

`forge.py::should_hold` auto-appends the §2c RIG-HOLD (a figure prior) whenever any seed is a "character seed." A prop canonical lives at `assets/library/prop-<name>.png`, which `_is_char_seed` currently treats as a character seed (path contains `/assets/library/`) — so seeding a prop would wrongly append the human-rig prior (a guidebook is not a figure). Add a guard.

**Files:**
- Modify: `.claude/skills/image-generation/scripts/forge.py` (`_is_char_seed`)
- Test: `.claude/skills/image-generation/scripts/test_forge_prop_guard.py` (new, plain-assert)

**Interfaces:**
- Consumes: seed paths passed to `should_hold(mode, resolved_seeds)`.
- Produces: `_is_char_seed(path)` returns **False** for any path whose basename starts with `prop-` (a prop canonical), so `should_hold` does not append §2c for a prop-only seed. A character seed (`macgregor-base.png`, `refs/…`, a prior scene) is unaffected. Depends on Task 5's `prop-<name>.png` naming convention.

- [ ] **Step 1: Write the failing test.** Create `.claude/skills/image-generation/scripts/test_forge_prop_guard.py`:

```python
"""Plain-assert test: a prop-canonical seed must not trigger the §2c rig-hold auto-append.
Run: py -3 .claude/skills/image-generation/scripts/test_forge_prop_guard.py"""
import forge

# A prop canonical (prop- prefix) is NOT a character seed -> no rig-hold.
assert forge._is_char_seed("videos/x/assets/library/prop-guidebook.png") is False, \
    "prop- seed wrongly treated as a character seed"
assert forge.should_hold("environment", ["videos/x/assets/library/prop-guidebook.png"]) is False, \
    "rig-hold wrongly appended for a prop-only seed"

# A real character library asset IS a character seed -> rig-hold holds.
assert forge._is_char_seed("videos/x/assets/library/macgregor-base.png") is True, \
    "character library asset wrongly exempted"
assert forge.should_hold("environment", ["videos/x/assets/library/macgregor-base.png"]) is True, \
    "rig-hold should append for a character seed"

# An env plate stays exempt (unchanged); a mixed prop+character seed still holds (the character needs it).
assert forge._is_char_seed("channels/c/visual-kit/refs/env/dock.png") is False
assert forge.should_hold("environment",
                         ["videos/x/assets/library/prop-guidebook.png",
                          "videos/x/assets/library/macgregor-base.png"]) is True, \
    "a scene seeding BOTH a prop and a character still needs the rig-hold for the character"

print("PASS test_forge_prop_guard")
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
cd .claude/skills/image-generation/scripts && py -3 test_forge_prop_guard.py
```

Expected: `AssertionError: prop- seed wrongly treated as a character seed` (the first assert fails — current `_is_char_seed` returns True for the `prop-` path).

- [ ] **Step 3: Add the prop guard to `_is_char_seed`.** In `forge.py`, find:

```python
def _is_char_seed(path):
    """A seed path carries a figure (character canonical, per-video library copy, or a prior scene
    frame in a held-set chain) — as opposed to an environment plate. Drives the rig-hold auto-append."""
    rp = str(path).replace("\\", "/")
    if "/refs/env/" in rp:
        return False
    return ("/refs/" in rp) or ("/assets/library/" in rp) or ("/assets/scenes/" in rp)
```

Replace with:

```python
def _is_char_seed(path):
    """A seed path carries a FIGURE (character canonical, per-video library copy, or a prior scene
    frame in a held-set chain) — as opposed to an environment plate or a recurring PROP. Drives the
    rig-hold auto-append (the human-figure prior). A prop canonical (`prop-<name>.png`, Task A2) is an
    object, not a figure, so it is exempt exactly like an env plate."""
    rp = str(path).replace("\\", "/")
    if "/refs/env/" in rp:
        return False
    if os.path.basename(rp).startswith("prop-"):
        return False
    return ("/refs/" in rp) or ("/assets/library/" in rp) or ("/assets/scenes/" in rp)
```

(`os` is already imported at the top of `forge.py`.)

- [ ] **Step 4: Run the test to verify it passes.**

```bash
cd .claude/skills/image-generation/scripts && py -3 test_forge_prop_guard.py
```

Expected: `PASS test_forge_prop_guard`.

- [ ] **Step 5: Commit.**

```bash
git add .claude/skills/image-generation/scripts/forge.py .claude/skills/image-generation/scripts/test_forge_prop_guard.py
git commit -m "fix(forge): prop-canonical seed does not trigger §2c rig-hold (sweep #4)"
```

---

### Task 7: A3 — casting lint (lint_shots.py flags an uncast named figure)

VPW already casts every named figure, but enforcement is a manual flag-back. Add a derived check: a story-named / registry-character figure named in a `still_prompt` but absent from the shot's `cast` is flagged. Derived-only — no new authoring, no change to the vo_ref matcher.

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/scripts/lint_shots.py` (new `casting_check` + wire it into `main`)
- Test: `.claude/skills/visual-prompt-writer/scripts/test_casting_check.py` (new, plain-assert)

**Interfaces:**
- Consumes: each shot's `still_prompt` (str), `cast` (list of `{character,…}`), and the channel registry character names (loaded from `visual-kit/registry/registry.json` — keys of `characters`, minus `base`).
- Produces: a new function **`casting_check(label, shots, registry_characters, soft)`** that appends a heads-up (SOFT, not HARD — it must not block a render, and proper-noun detection is heuristic) for any shot whose `still_prompt` names a registry character (case-insensitive word match) OR a capitalized story-name token that is NOT in that shot's `cast`. Wired into `main` after each `stage_check`.

- [ ] **Step 1: Write the failing test.** Create `.claude/skills/visual-prompt-writer/scripts/test_casting_check.py`:

```python
"""Plain-assert test for lint_shots.casting_check.
Run: py -3 .claude/skills/visual-prompt-writer/scripts/test_casting_check.py"""
import lint_shots

REG = ["macgregor", "bolivar"]

def flags(shots):
    soft = []
    lint_shots.casting_check("t", shots, REG, soft)
    return soft

# A registry character named in the prompt but not cast -> flagged.
s1 = [{"id": "L01", "still_prompt": "MacGregor holds up the guidebook", "cast": []}]
assert any("L01" in m and "macgregor" in m.lower() for m in flags(s1)), "should flag uncast MacGregor"

# Same character, properly cast -> no flag.
s2 = [{"id": "L02", "still_prompt": "MacGregor holds up the guidebook",
       "cast": [{"character": "macgregor"}]}]
assert flags(s2) == [], "cast MacGregor should not flag"

# No named figure (anonymous crowd prose) -> no flag.
s3 = [{"id": "L03", "still_prompt": "a crowd of settlers on a dock, dot eyes", "cast": []}]
assert flags(s3) == [], "anonymous crowd should not flag"

# A capitalized story-name not cast -> flagged (heuristic proper-noun catch).
s4 = [{"id": "L04", "still_prompt": "Bolivar signs the loan papers", "cast": []}]
assert any("L04" in m for m in flags(s4)), "should flag uncast Bolivar"

print("PASS test_casting_check")
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
cd .claude/skills/visual-prompt-writer/scripts && py -3 test_casting_check.py
```

Expected: `AttributeError: module 'lint_shots' has no attribute 'casting_check'`.

- [ ] **Step 3: Implement `casting_check` in `lint_shots.py`.** Add this function immediately before `def main(argv):`:

```python
# A3: casting enforcement. A story-named or registry-character figure named in a still_prompt but
# absent from the shot's `cast` is an authoring gap (VPW casts every named figure; this makes it
# derived-checkable). SOFT: proper-noun detection is heuristic + a miss must never block a render.
_STOPWORDS = {"A", "An", "The", "In", "On", "At", "As", "It", "He", "She", "They", "His", "Her",
              "MacGregor's", "This", "That", "One", "Two", "Poyais", "London", "South", "America",
              "St", "Joseph", "British", "Scottish", "FICTION", "PAUSE", "BEAT"}

def _cast_names(shot):
    return {(c.get("character") or "").lower() for c in (shot.get("cast") or []) if c.get("character")}

def casting_check(label, shots, registry_characters, soft):
    reg = {c.lower() for c in (registry_characters or [])}
    for sh in shots:
        prompt = sh.get("still_prompt") or ""
        cast = _cast_names(sh)
        # (a) a known registry character named in prose but not cast
        for rc in reg:
            if re.search(r"\b" + re.escape(rc) + r"\b", prompt, re.IGNORECASE) and rc not in cast:
                soft.append(f"[{label}] {sh.get('id','?')}: names registry character '{rc}' in "
                            f"still_prompt but it is not in `cast` — cast it or it renders off-rig.")
        # (b) a capitalized mid-sentence story-name (heuristic) not cast and not already reg-flagged
        for tok in re.findall(r"(?<![.!?]\s)\b[A-Z][a-zA-Z]{2,}\b", prompt):
            if tok in _STOPWORDS or tok.lower() in reg or tok.lower() in cast:
                continue
            # only flag a token that recurs like a name (appears capitalized) — single common caps skipped
            if prompt.count(tok) >= 1 and tok[0].isupper() and not tok.isupper():
                soft.append(f"[{label}] {sh.get('id','?')}: capitalized name '{tok}' in still_prompt not "
                            f"in `cast` — if it's a story figure, cast it (heuristic; ignore if not a person).")
                break  # one heuristic heads-up per shot is enough
```

- [ ] **Step 4: Load registry character names + wire the check into `main`.** In `lint_shots.py::main`, after the line `script_md = vdir / "script.md"`, add:

```python
    # A3: registry character names (minus the base template) for the casting check — best-effort.
    reg_chars = []
    reg_path = None
    for anc in vdir.parents:
        cand = anc / "visual-kit" / "registry" / "registry.json"
        if cand.exists():
            reg_path = cand
            break
    if reg_path:
        try:
            reg_json = json.loads(reg_path.read_text(encoding="utf-8"))
            reg_chars = [c for c in (reg_json.get("characters") or {}) if c != "base"]
        except (ValueError, OSError):
            reg_chars = []
```

Then, immediately after `stage_check("long-form", lf_shots, hard, soft)`, add:

```python
    casting_check("long-form", lf_shots, reg_chars, soft)
```

And inside the `for short in shorts:` loop, immediately after `stage_check(f"short:{short.get('file','?')}", sshots, hard, soft)`, add:

```python
        casting_check(f"short:{short.get('file','?')}", sshots, reg_chars, soft)
```

- [ ] **Step 5: Run the test to verify it passes.**

```bash
cd .claude/skills/visual-prompt-writer/scripts && py -3 test_casting_check.py
```

Expected: `PASS test_casting_check`.

- [ ] **Step 6: Regression-run the lint on the act-1 slice** (confirm it still runs clean end-to-end and the new check is advisory, not a HARD break):

```bash
py -3 .claude/skills/visual-prompt-writer/scripts/lint_shots.py channels/the-second-take/videos/_t2-tier1-test/shots.json
```

Expected: exit code reflects only pre-existing HARD state (the casting findings appear under "Heads-up", never "HARD violations"). If it surfaces a real uncast figure in the slice, that is a true finding — note it for the VPW re-run, do not "fix" it in the lint.

- [ ] **Step 7: Commit.**

```bash
git add .claude/skills/visual-prompt-writer/scripts/lint_shots.py .claude/skills/visual-prompt-writer/scripts/test_casting_check.py
git commit -m "feat(lint): flag a named figure in still_prompt absent from cast (A3, derived soft check)"
```

---

### Task 8: A4 — expression rework: restrain the default + re-author the base frames

Exaggeration is baked at the SOURCE — the 18 `expr-*.png` frames are authored "extreme" and the merge transfers their eye/brow/mouth SHAPE directly, so extreme frames → caricature faces on ordinary beats. Fix at the root: (a) restrain the guidance that produced the extreme frames, (b) restrain the DEFAULT expression choice, (c) change the review rule from "never reject exaggeration" to "reject an over-the-top expression for its beat," and (d) re-author the 18 frames to a moderate register (gated asset build). The re-author cascades — see Task 9.

**Files:**
- Modify: `channels/the-second-take/visual-kit/style-bible.md` (§6 execution note; §7 item 1; §3 review rule)
- Modify: `channels/the-second-take/visual-kit/visual-grammar.md` (§1 expression-choice restraint)
- Asset build (run-steps, HUMAN gate): re-author `refs/base/expr-*.png` (18 frames) to a moderate baseline

**Interfaces:**
- Consumes: nothing new.
- Produces: restrained expression law across §6/§7/§3 + visual-grammar §1; and (asset build) the 18 re-authored moderate `expr-*.png` frames. The frames are the seed source for Pass-1b — re-authoring them changes every downstream posed-character + scene (Task 9 sequences the regen).

- [ ] **Step 1: Restrain the §6 execution note.** In style-bible §6, "Why this recipe fits our rig (execution notes)", find:

```
- The **no-nose round head is ideally suited to a tiny, mouth-led expression vocabulary** — push **mouth
  extremity harder** than a typical explainer dares.
```

Replace with:

```
- The **no-nose round head carries a tiny, mouth-led expression vocabulary** — read the emotion in a
  LEGIBLE mouth + brow, restrained by default. Reserve a big/extreme mouth for a genuine comedic PEAK; an
  ordinary, sincere, or grim beat gets a calm, plain expression, not a caricature. (A caricature face on
  an ordinary beat is the "everyone mugging" defect — it flattens the register the story is dialing.)
```

- [ ] **Step 2: Re-author the §7 item-1 expression-set spec to a moderate baseline.** In style-bible §7, find item 1:

```
1. **Extreme-register expression set** (the lead of a beat). Small, mouth-led, pushed to extremes: held
   deadpan/unimpressed (the dry default), big-mouth wide-trapezoid shock, crescent-eye delight,
   jagged-mouth irritation, worried knit-brow, smug asymmetric brow. Secondary characters get **one held
   expression**; cheap graphic-symbol overlays (heart, sparkle, exclamation, zigzag, blush, stat glyph)
   add warmth/intensity at near-zero cost.
```

Replace with:

```
1. **Moderate-register expression set** (the lead of a beat). Small, mouth-led, **restrained by default —
   legible, not a caricature**: held deadpan/unimpressed (the dry default), a measured shock (open mouth,
   not a wide trapezoid), a warm smile (not crescent-eyed mania), mild irritation, worried knit-brow, smug
   asymmetric brow. The big/extreme end (wide-mouth laughing, full shock) exists for a genuine comedic
   PEAK, reached for deliberately — NOT the baseline. Since the Pass-1b merge transfers each frame's
   eye/brow/mouth SHAPE directly, the FRAMES themselves are authored moderate (an extreme frame → an
   extreme face on every beat that uses it). Secondary characters get **one held expression**; cheap
   graphic-symbol overlays (heart, sparkle, exclamation, zigzag, blush, stat glyph) add warmth/intensity at
   near-zero cost.
```

- [ ] **Step 3: Change the §3 review rule — reject an over-the-top expression for its beat.** In style-bible §3, find the "Never checked — these vary" paragraph:

```
**Never checked — these vary:** pose, expression, camera framing, hair/facial hair, outfit, head-tone
choice, body build (stout/slight), age linework, action squash/stretch. Never reject a frame for an
exaggerated action pose, for a cast member having hair, or for a non-default head tone (the base template
is bald + cream — that is *its* canonical form, not a cast requirement).
```

Replace with:

```
**Never checked — these vary:** pose, camera framing, hair/facial hair, outfit, head-tone choice, body
build (stout/slight), age linework, action squash/stretch. Never reject a frame for an exaggerated action
POSE, for a cast member having hair, or for a non-default head tone (the base template is bald + cream —
that is *its* canonical form, not a cast requirement).

**Expression IS checked for register-fit.** An expression is judged against its BEAT: a calm/ordinary/
sincere/grim beat wants a restrained face, and an **over-the-top expression for its beat is a defect**
(a caricature laughing/shock face on an ordinary or grim beat → reject and regen with a restrained
expression). The big expressions are correct only on a genuine comedic peak. (This replaces the former
blanket "never reject for exaggeration" — exaggerated action *poses* are still fine; over-the-top
*expressions on the wrong beat* are not.)
```

- [ ] **Step 4: Restrain the expression-CHOICE logic in visual-grammar §1.** In `visual-grammar.md` §1, find the "Emotion is acted" bullet:

```
- **Emotion is acted with the mouth and the body, not the hands:** push mouth extremity hard on the
  lead of a beat; secondary characters hold **one** expression; posture/lean/recoil carries the rest
  (the rig has simple hands — see `style-bible.md §6` for why).
```

Replace with:

```
- **Emotion is acted with the mouth and the body, not the hands — restrained by default:** the lead of a
  beat gets a LEGIBLE expression sized to the beat's register, not a reflex caricature; secondary
  characters hold **one** expression; posture/lean/recoil carries the rest (the rig has simple hands — see
  `style-bible.md §6` for why). Reserve laughing/shock/delight for genuine comedic PEAKS; ordinary beats
  get calm (deadpan / thinking / smug), grim beats get grim-flat.
```

- [ ] **Step 5: Restrain the §1 expression-by-beat register mapping default.** In `visual-grammar.md` §1, find the "Expression tracks the beat" bullet and its final sentence:

```
One default
  face riding every beat is a defect; an expression change is a legitimate delta (swap the `expression_ref`).
```

Replace with:

```
The DEFAULT is restrained — a calm/plain face on an ordinary beat; the strong faces (laughing, shock,
  delighted) are RESERVED for real comedic peaks, not reached for by reflex. One default face riding every
  beat is a defect; so is a caricature riding every beat — an expression change is a legitimate delta (swap
  the `expression_ref`), and its STRENGTH tracks the beat's gravity.
```

- [ ] **Step 6 (ASSET BUILD — HUMAN GATE): re-author the 18 `expr-*.png` frames to a moderate baseline.** This is the largest asset task; it can be staged/batched. Run-steps:
  1. Enumerate the 18 frames from the registry (`kind: expression`): deadpan, delighted, skeptical, smug, surprised, worried, confused, pleading, annoyed, fear, talking, thinking, crestfallen, eyeroll, laughing, caught, greedy, shock. (Confirm the list from `registry.json`.)
  2. For each, regen on the base seeded off `refs/base/base.png` (`--mode identity` or `new_character` per the single-asset loop), authoring a **moderate** version of that expression per the new §7 item-1 spec (legible, not extreme). Batch via `forge.py gen --batch`.
  3. Self-check each staged frame against §3 (rig held, no nose/ears, restrained register) by looking at it; retry ≤2.
  4. **HUMAN RIG-GATE:** publish all 18 re-authored frames via an Artifact link (big images + before/after where possible) and STOP for approval. The human judges FEEL (moderate, still legible) — a base expression is a channel asset (§10 approval). Do not register or cascade until approved.
  5. On approval: `forge.py register --batch` the 18 frames (overwrites the same `refs/base/expr-*.png` names + registry entries — `cmd_register` drops the old entry with the same name). Then proceed to Task 9 (cascade).

- [ ] **Step 7: Verify the logic edits.** Run:

```bash
grep -c "push mouth extremity harder\|push \*\*mouth extremity harder\|pushed to extremes\|Extreme-register expression" channels/the-second-take/visual-kit/style-bible.md
grep -c "never reject for exaggeration\|Never reject a frame for an\nexaggerated" channels/the-second-take/visual-kit/style-bible.md
grep -n "Moderate-register expression set\|over-the-top expression for its beat\|restrained by default" channels/the-second-take/visual-kit/style-bible.md
grep -n "restrained by default\|Reserve laughing/shock" channels/the-second-take/visual-kit/visual-grammar.md
```

Expected: the first grep (stale "extreme/push harder" strings) → `0`; the "reject an over-the-top expression" + "Moderate-register" strings present; visual-grammar restraint present. (The re-authored FRAMES are verified by the Step-6 human gate, not a grep.)

- [ ] **Step 8: Commit the logic edits** (commit the re-authored frames separately under Task 9, gated).

```bash
git add channels/the-second-take/visual-kit/style-bible.md channels/the-second-take/visual-kit/visual-grammar.md
git commit -m "feat(visual): restrain expression register — moderate default + review rejects over-the-top for beat (A4 logic)"
```

---

### Task 9: Sweep #5 — ordered regeneration cascade after the expression re-author

Re-authoring `expr-*.png` (Task 8) invalidates every downstream asset MERGED from the old frames: every per-video posed-character library asset (`<char>--<pose>--<expr>.png`) and every scene seeded from those. This task makes the dependency explicit and sequences the regen so nothing ships a mix of old-extreme and new-moderate faces. This is a run-book task (documented procedure + a doc note), gated at each stage.

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md` (Pass 1b — a note that an expr-frame re-author invalidates posed-character assets)
- Run-steps (HUMAN gates): the ordered regen (frames → posed-characters → scenes)

**Interfaces:**
- Consumes: the approved re-authored `expr-*.png` frames (Task 8 Step 6).
- Produces: regenerated posed-character library assets + regenerated affected scenes, in dependency order, each gated. No new field.

- [ ] **Step 1: Add the invalidation note to image-gen Pass 1b.** In `image-generation/SKILL.md`, at the end of the Pass-1b section (after the "Interactions apply the same provenance split" bullet), add:

```
- **Expression-frame re-author invalidates every posed-character asset built from it (dependency, not
  optional).** A posed-character asset (`<char>--<pose>--<expr>.png`) BAKES the `expression_ref` frame's
  eye/brow/mouth shape at merge time; a scene then seeds that posed-character. So if the `expr-*.png`
  library is re-authored (register register), every posed-character asset merged from an old frame — and
  every scene seeded from those — is STALE and must be regenerated in order: **(1) re-author + human-gate
  the frames → (2) regen the affected posed-character merges → (3) regen the scenes that seeded them.**
  Never ship a video with a mix of old-register and new-register faces; do the cascade top-down.
```

- [ ] **Step 2 (RUN — HUMAN GATE): regen the affected posed-character merges.** After Task 8's frames are approved + registered:
  1. Identify affected assets: for the act-1 slice, read `_t2-tier1-test/assets/library/manifest.json`; every entry with a non-null `expression_ref` (a Pass-1b merge) is stale.
  2. Re-run the Pass-1b merge for each stale combo (seed `[character canonical, pose_ref frame, NEW expression_ref frame]` per the provenance split), overwriting `assets/library/<char>--<pose>--<expr>.png`.
  3. **HUMAN RIG-GATE** the regenerated posed-characters via an Artifact link; STOP for approval.

- [ ] **Step 3 (RUN — HUMAN GATE): regen the affected scenes.** After the posed-characters are approved:
  1. Identify every `scenes/<id>.png` whose manifest `seeds` reference a regenerated posed-character.
  2. Regen those scenes (technique (b)/(d) off the new posed-character), run the batched review, re-stamp `verified` (Task 1).
  3. **HUMAN GATE** the re-rendered scenes via the review Artifact; STOP for approval. Only then is the slice consistent end-to-end.

- [ ] **Step 4: Verify the doc note.** Run:

```bash
grep -n "Expression-frame re-author invalidates" .claude/skills/image-generation/SKILL.md
```

Expected: returns its line. (The regen itself is verified by the Step-2/Step-3 human gates.)

- [ ] **Step 5: Commit the doc note** (regen outputs commit under their own gated steps).

```bash
git add .claude/skills/image-generation/SKILL.md
git commit -m "docs(image-gen): expr re-author cascades to posed-characters + scenes; ordered regen (sweep #5)"
```

---

### Task 10: B1 (authoring side) — author additive beats as shared-`stage` hybrids (VPW only)

When a beat ADDS a figure/prop to a scene we've established (MacGregor onto the swamp; a 5-STAR stamp on the guidebook), keep the same `stage` and author the addition as a layerable delta — don't re-describe the whole scene. This is the VPW authoring change only; the motion-planner mechanism (the reuse-the-plate rule) is the OTHER plan.

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md` (Step 3 — "Stage the run — held evolving stages" bullet)

**Interfaces:**
- Consumes: nothing new (uses the existing `stage`/`stage_role`/`changed_elements` fields).
- Produces: guidance that an additive beat is authored as a shared-`stage` delta whose `changed_elements` names only the ADDED element, and whose `still_prompt`/delta does not re-describe the whole established scene. Downstream, the motion-planner (other plan) decides whether to reuse the plate + matte the addition; VPW only authors the intent.

- [ ] **Step 1: Extend the delta-chain authoring guidance.** In `visual-prompt-writer/SKILL.md`, Step 3, find the "Stage the run — held evolving stages" bullet and its `changed_elements` sentence. After the sentence ending `…that continuity (not a new scene each cut) is what reads like the reference channels.`, insert:

```
**An ADDITIVE beat is a shared-`stage` delta — author the addition, not the whole scene.** When a beat
    adds a discrete element to a scene we've already established (a character entering the held swamp; a
    5-STAR stamp landing on the guidebook), keep the SAME `stage`, mark the shot `stage_role: "delta"`, and
    name ONLY the added element in `changed_elements` (`"+ MacGregor enters, stage-left"`, `"+ red 5-STAR
    stamp on the guidebook"`). Do NOT re-describe the established set in the delta's `still_prompt` — the
    set persists from the base frame; you are adding one layerable thing. (Downstream, the motion-planner
    may realize this as a plate-reuse + a matted cutout rather than a full re-gen — but that is its call
    from the same `stage` + `changed_elements` metadata; you author only the intent.)
```

- [ ] **Step 2: Verify.** Run:

```bash
grep -n "An ADDITIVE beat is a shared-" .claude/skills/visual-prompt-writer/SKILL.md
```

Expected: returns its line. Then re-run VPW on the slice and eyeball that an additive beat (e.g. MacGregor entering an established scene, or a stamp on the guidebook) is authored as a same-`stage` delta with a scoped `changed_elements`, not a fresh full-scene shot.

- [ ] **Step 3: Commit.**

```bash
git add .claude/skills/visual-prompt-writer/SKILL.md
git commit -m "feat(vpw): author additive beats as shared-stage hybrid deltas (B1 authoring side)"
```

---

### Task 11: D1 — per-word delta granularity (VPW)

Split a multi-element delta into ONE element per delta, each shot anchored to its own word (bank on "bank", coin on "its own money") — no bundling two elements at one cut. Guidance change in the delta-chain authoring section.

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md` (Step 3 delta-chain bullet — the "one change per delta" rule)

**Interfaces:**
- Consumes: nothing new.
- Produces: sharper guidance that a delta changes exactly ONE element and anchors to the word that introduces it; a beat that adds two elements is TWO deltas (or a delta + a cut), each with its own verbatim `vo_ref`. Reinforces the existing `lint_shots.py` stage cap (≤3 deltas) — does not change the lint.

- [ ] **Step 1: Tighten the "one thing changes" rule.** In `visual-prompt-writer/SKILL.md`, Step 3, in the "Stage the run — held evolving stages" bullet, find:

```
mark the first `stage_role: "base"` and the rest `"delta"`, and on each delta author
   `changed_elements` — the ONE **world-change** vs the prior frame (`"+ cathedral rises"`, `"- ship"`,
   `"MacGregor gains epaulettes"`, `"MacGregor's smugness drops to alarm"`).
```

Replace with:

```
mark the first `stage_role: "base"` and the rest `"delta"`, and on each delta author
   `changed_elements` — **exactly ONE** world-change vs the prior frame (`"+ cathedral rises"`, `"- ship"`,
   `"MacGregor gains epaulettes"`, `"MacGregor's smugness drops to alarm"`). **One element per delta,
   anchored to its own word** — if the VO introduces a bank on "bank" and a coin on "its own money", that
   is TWO deltas (each its own shot + verbatim `vo_ref` on the word the element lands on), never one delta
   that adds both. Bundling two elements at one cut makes the reveal mushy and mis-times the second element
   against its word. If a beat truly adds several things at once, it is either several fast deltas (still
   ≤3 per chain) or a hard cut to a new base.
```

- [ ] **Step 2: Verify.** Run:

```bash
grep -n "One element per delta, anchored to its own word" .claude/skills/visual-prompt-writer/SKILL.md
```

Expected: returns its line. Re-run VPW on the slice and eyeball that no delta's `changed_elements` lists two distinct additions.

- [ ] **Step 3: Commit.**

```bash
git add .claude/skills/visual-prompt-writer/SKILL.md
git commit -m "feat(vpw): per-word delta granularity — one element per delta, anchored to its word (D1)"
```

---

### Task 12: D2 — reveal staging convention (VPW + visual-grammar)

A character REVEAL enters on the NAMING moment (the character's name in the VO), with a reveal staging (spotlight/dramatic for a big reveal), and the character's canonical/default expression unless the beat authors otherwise.

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md` (Step 3 — a reveal-staging note near the hook/escalation guidance)
- Modify: `channels/the-second-take/visual-kit/visual-grammar.md` (§1 — a reveal-staging staging convention)

**Interfaces:**
- Consumes: nothing new (uses `vo_ref` anchoring + `still_prompt` staging + `cast` default expression).
- Produces: guidance that a character-introduction shot (a) anchors its `vo_ref` to the naming line, (b) stages the reveal (spotlight/dramatic framing for a big reveal), and (c) uses the canonical/default expression unless the beat authors a different one. Consistent with disclosure-order (a withheld character does not appear before its naming).

- [ ] **Step 1: Add the reveal-staging note to VPW Step 3.** In `visual-prompt-writer/SKILL.md`, Step 3, immediately after the "Visual question before narration (§1b) — and the hook-frame bar" bullet, insert:

```
- **Reveal staging — a character enters on their NAME.** A character's first appearance (a reveal) is
    anchored to the **naming moment** — its `vo_ref` is the VO line that names the character, so the figure
    lands on their name, not a beat early (respects disclosure order: a withheld character appears in NO
    earlier shot). Stage the reveal with intent: a big reveal gets a **dramatic staging** (spotlight, low
    angle, the figure arriving into a held scene — the gold-stage exemplar), a minor one a clean
    introduction. Use the character's **canonical / default expression** unless the beat authors a specific
    one (a reveal is an entrance, not yet a reaction).
```

- [ ] **Step 2: Add the reveal-staging convention to visual-grammar §1.** In `visual-grammar.md` §1, after the "Roles read at a glance" bullet, insert:

```
- **A character reveal is staged on the naming moment.** The first time a named character appears, the
  shot lands on the VO line that NAMES them (the entrance anchors to the name), with a reveal staging
  sized to the beat — a big reveal is dramatic (spotlight / low angle / arrival into a held scene), a
  minor one a clean introduction — and the character wears its **canonical/default expression** unless the
  beat authors otherwise (an entrance, not a reaction). A withheld character never appears before its
  naming (disclosure order).
```

- [ ] **Step 3: Verify.** Run:

```bash
grep -n "Reveal staging — a character enters on their NAME" .claude/skills/visual-prompt-writer/SKILL.md
grep -n "A character reveal is staged on the naming moment" channels/the-second-take/visual-kit/visual-grammar.md
```

Expected: both return their lines. Re-run VPW on the slice and eyeball that MacGregor's introduction shot anchors to his naming line with a reveal staging + default expression.

- [ ] **Step 4: Commit.**

```bash
git add .claude/skills/visual-prompt-writer/SKILL.md channels/the-second-take/visual-kit/visual-grammar.md
git commit -m "feat(visual): reveal staging convention — enter on the naming moment, canonical expression (D2)"
```

---

## Final integration check (after all tasks)

- [ ] **Run the full lint on the act-1 slice** and confirm it passes with only expected findings:

```bash
py -3 .claude/skills/visual-prompt-writer/scripts/lint_shots.py channels/the-second-take/videos/_t2-tier1-test/shots.json
```

- [ ] **Run both new unit tests:**

```bash
cd .claude/skills/image-generation/scripts && py -3 test_forge_prop_guard.py
cd .claude/skills/visual-prompt-writer/scripts && py -3 test_casting_check.py
```

Expected: both print `PASS`.

- [ ] **Re-run VPW then image-generation on `_t2-tier1-test`** (the spec's re-run-on-act-1-slice gate), then hand to a render retry — the crowd rig, prop lock, restrained expressions, per-word deltas, and reveal staging should all show in the regenerated `shots.json` + scenes; the manifest carries `verified`; card-only shots resolve from `scenes/`. Human gates the visual result (per project doctrine — visual FEEL is the human's call).

- [ ] **Log the decision** in `knowledge/decisions.md` (a dated line: the visual-authoring + consistency half of the 2026-07-13 overhaul landed — crowd rig, prop lock, casting lint, expression restraint, D1/D2 conventions, C1/C2 image-gen seams, sweep #1/#4/#5), per the CLAUDE.md log-decisions rule.

---

## Self-Review (run against the spec)

**1. Spec coverage (Phases A, D, image-gen side of C, sweep #1/#4/#5):**
- A1 crowd-rig → Task 3 (style-bible §1/§2d/§3/§8, VPW rule5/step4, image-gen Pass 2, visual-grammar §1). ✓
- A2 recurring-prop lock → Task 5 (schema `props`, VPW step4, image-gen Pass 1, style-bible §7/§9, asset build). ✓
- A3 casting lint → Task 7 (lint_shots `casting_check` + test). ✓
- A4 expression rework → Task 8 (style-bible §6/§7/§3, visual-grammar §1, asset re-author). ✓
- D1 per-word delta → Task 11. ✓  D2 reveal staging → Task 12. ✓
- B1 authoring side (VPW only) → Task 10 (motion-planner side explicitly deferred to the other plan). ✓
- C1 manifest `verified` → Task 1 (+ contract note; render gate already reads it — confirmed in render.py). ✓
- C2 card background = scene → Task 2. ✓
- Sweep #1/#10 §2c reconcile → Task 4.  Sweep #4 prop-seed guard → Task 6.  Sweep #5 cascade → Task 9. ✓
- Shared contract (`verified:{scene,rig}`; layered/hybrid shot has no `scenes/<id>.png`) noted in Global Constraints + Tasks 1/2; NO render-builder/motion-planner edits planned. ✓
- Out-of-scope render/engine items (B0–B4 mechanism, C3 lint-params) correctly excluded.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases/similar to Task N". Every doc edit gives exact old→new snippets; both code tasks give full function bodies + full test files; asset builds are explicit gated run-steps.

**3. Type consistency:** `verified:{scene:bool,rig:bool}` used identically in Task 1 and matched to `render.py`'s `v.get("scene") is True`. `casting_check(label, shots, registry_characters, soft)` signature identical in Task 7 Steps 3–4 and its test. `_is_char_seed(path)` / `should_hold(mode, resolved_seeds)` match forge.py's real signatures. `props` array (list of str library names) consistent across schema, VPW, image-gen. `prop-<name>.png` naming consistent between Task 5 (produces) and Task 6 (guards on `basename startswith "prop-"`). One vocabulary held: "crowd rig", "prop lock"/"recurring prop", "recurring identifiable".
