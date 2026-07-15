# Shot composition variety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shot-class *drive* the composition (execute its inherent framing), wire framing/expression into the prompt's stated facts, stop image-gen re-composing, and lock diegetic art to flat-cel — so generation produces varied shots intrinsically, with no new rules, no new field, and no duplicated taxonomy.

**Architecture:** Four doc edits, each a DO integrated in place: `visual-grammar §2` becomes the channel's per-class composition realization (referencing `universal §13a`, never restating it); `VPW SKILL` makes the class load-bearing for composition + adds framing/expression to the stated facts; `image-generation` + `style-bible §8` stop re-deciding placement (VPW owns composition); `style-bible §6` adds the diegetic-art-is-flat-cel clause. Then a cross-file consistency sweep.

**Tech Stack:** Markdown docs; `git`; `rg` for verification. No code, no pytest.

## Global Constraints

- **DO's, not DON'Ts; integrate in place.** No new prohibitions, no appended log-blocks, no restated law. Each concept keeps exactly one home. (CLAUDE.md rule 6.)
- **No new taxonomy.** `universal §13a`'s narration→class table is the source of class definitions; `visual-grammar §2` only adds OUR *execution* of those classes — it must not re-derive the narration→class mapping.
- **No new `shots.json` field** (step-only — composition lives in the `still_prompt`).
- **Composition is authored ONCE by VPW** (in the `still_prompt`) and **executed by image-gen** — never double-authored.
- **Untouched:** `universal.md §13a`, `references/shots-schema.md` (no field), `references/critics.md` (no new checkpoint).
- **Out of scope:** minting the gold exemplar / any regeneration (a separate later step, user-deferred); the image-gen review-reliability gap (nose/fingers); per-video asset fixes (king recolor).
- **Parallel terminal is active** (Remotion). Commit **explicit paths only**, never `git add -A`. Before each edit, if the target text has changed from what this plan quotes, **re-read and reconcile** before editing.
- **Spec:** `docs/superpowers/specs/2026-07-09-shot-composition-variety-design.md`.

---

### Task 1: `visual-grammar.md §2` — the class drives composition (core rewrite)

**Files:** Modify `channels/the-second-take/visual-kit/visual-grammar.md` — replace all of §2 (the "Composition / framing menu" section).

**Interfaces:** Produces the per-class composition realization that `VPW Step 2.5` (Task 2) references.

- [ ] **Step 1: Replace §2** — from `## 2. Composition / framing menu` through the end of its `generous negative space is the house staging default …` paragraph — with:

```markdown
## 2. Composition — a decision, driven by the payload

A shot's **framing, scale, and angle are a choice** — driven by the one thing the viewer must see (the
payload) and the shot's class (each `universal.md §13a` class already *suggests* its composition). Left
unchosen, composition defaults to a centered, eye-level, same-size medium shot — fine once, deadly on
repeat. **So decide it, and vary it across the video:**

- **Scale / character-sizing** — subjects aren't always the same size or at eye level. A tiny figure
  under a dominant labelled mass (scale as argument), a face filling the frame (a reaction), one figure
  dwarfing another (power). Reach for size *relationships*, not a lineup of equals.
- **Angle / distance** — top-down for a map or plan, low for dominance, an extreme close-up on a face or
  a detail, a wide with air for a single graphic idea. Reach past the eye-level medium.
- **Literal vs symbolic** — non-literal is the default (`§13a`): draw what the beat *means*, not the
  sentence. A promotion is insignia arriving on the coat, or the man small before an army — not "a man
  standing in a field."

The class carries a *range* (`§13a`: a staged-interaction can be a handshake, a tug-of-war, an object
passed hand-to-hand, one figure looming; a physicalized-imbalance is relative size) — **pick the move the
beat argues; don't reduce a class to one framing, and don't collapse it to a centered default.** A plain
centered shot is valid when a beat genuinely wants it; the goal is **variety across the video**, not a
rule per shot.

**Negative space follows the payload:** air for a single graphic idea (our signature) — but where the
payload is *detail inside an artifact* (a brochure's contents, a map's territory, a seal), the artifact
fills the frame. Everything in frame earns its place by meaning, palette code, or staging; unmotivated
set dressing is a defect, not texture.
```

- [ ] **Step 2: Check class names referenced in §2 match the schema enum.** The new §2 only *names* a
  couple of classes inline as examples (`staged-interaction`, `physicalized-imbalance`) — open
  `.claude/skills/visual-prompt-writer/references/shots-schema.md` §1 and confirm those spellings match
  the `shot_class` enum. Fix any mismatch (do not coin variants).

- [ ] **Step 3: Verify no §13a duplication + the section is DO-shaped.**

Run:
```bash
cd /c/Users/danie/faceless-youtube
rg -n 'narration.type|When the narration is' channels/the-second-take/visual-kit/visual-grammar.md
```
Expected: **no match** (§2 must not re-derive the narration→class table — that stays in §13a). Then read the new §2 and confirm it references `§13a` as the source and adds only composition execution.

- [ ] **Step 4: Commit.**

```bash
git add channels/the-second-take/visual-kit/visual-grammar.md
git commit -m "feat(visual-grammar): §2 -> payload-driven composition guidance

Replace the floating composition menu with 'composition is a decision
driven by the payload' + the axes to vary (scale/character-sizing,
angle, literal-vs-symbolic). Class stays a suggestion (range in §13a),
not a formula; a centered shot is still valid; goal is variety across
the video. Negative space follows payload. All DO's, interpretive.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `VPW SKILL.md` — class drives composition + framing/expression as stated facts

**Files:** Modify `.claude/skills/visual-prompt-writer/SKILL.md` — rule 5 (~line 69), Step 2.5 step 2 (~227), Step 2.5 step 6 (~244).

**Interfaces:** Consumes Task 1's §2. Produces `still_prompt`s that carry framing + expression.

- [ ] **Step 1: Extend rule 5 (the canonical stated-facts rule).** Replace:

```
5. **A prompt states its FACTS.** A `still_prompt` carries the facts that are load-bearing for the
   beat's meaning — layout (what's where), orientation (who faces whom; a vehicle points where it
   travels), targets (what a gesture/highlight refers to, named precisely — "the northern half of
   South America", never "the continent"), casting/costume — such that **a stranger could verify the
   image against the prompt.**
```
with:
```
5. **A prompt states its FACTS.** A `still_prompt` carries the facts that are load-bearing for the
   beat's meaning — layout (what's where), orientation (who faces whom; a vehicle points where it
   travels), targets (what a gesture/highlight refers to, named precisely — "the northern half of
   South America", never "the continent"), casting/costume, **framing/scale (the composition its class
   + payload demand — `visual-kit/visual-grammar.md §2`), and each character's expression (from the
   beat/register)** — such that **a stranger could verify the image against the prompt.**
```

- [ ] **Step 2: Make the class drive composition (Step 2.5 step 2).** Replace:

```
2. **Invent a FRESH, on-style shot in that class** for *this* story. Examples in the grammar illustrate the
   class, never template it — don't reflex to "a genie" or "a handshake-with-emoji." Two same-typed lines
   must produce visibly different images. **(The anti-slop guardrail — classify then INVENT — is the point
   of this step.)**
```
with:
```
2. **Invent a FRESH, on-style shot in that class** for *this* story. **The class carries its
   composition — realize it** (physicalized-imbalance → relative size; staged-interaction → an active
   interaction, never two figures parked; per `visual-grammar.md §2`); a shot staged as a generic
   centered medium shot has ignored its class. Examples in the grammar illustrate the class, never
   template it — don't reflex to "a genie" or "a handshake-with-emoji." Two same-typed lines must produce
   visibly different images. **(The anti-slop guardrail — classify then INVENT — is the point of this step.)**
```

- [ ] **Step 3: Add framing + expression to Step 2.5 step 6.** Replace:

```
6. **State the facts.** Write the `still_prompt` so its load-bearing facts are explicit and checkable
   (rule 5): layout, orientation, targets, casting. Nothing in frame that isn't motivated by meaning,
   palette code, or staging.
```
with:
```
6. **State the facts.** Write the `still_prompt` so its load-bearing facts are explicit and checkable
   (rule 5): layout, orientation, targets, casting, **framing/scale (from the class + payload), and each
   character's expression (from the beat)**. Nothing in frame that isn't motivated by meaning, palette
   code, or staging.
```

- [ ] **Step 4: Verify.**

Run:
```bash
cd /c/Users/danie/faceless-youtube
rg -n 'framing/scale|expression \(from the beat' .claude/skills/visual-prompt-writer/SKILL.md
rg -n 'class carries its\s+\n?\s*composition|carries its composition' .claude/skills/visual-prompt-writer/SKILL.md
```
Expected: framing/scale + expression appear in rule 5 AND step 6; "carries its composition" appears in step 2. Confirm no other stated-facts list in the file still omits them (read the hits).

- [ ] **Step 5: Commit.**

```bash
git add .claude/skills/visual-prompt-writer/SKILL.md
git commit -m "feat(vpw): class drives composition; framing+expression are stated facts

Step 2.5 step 2 now requires realizing the shot-class's inherent
composition (not a centered default); rule 5 + step 6 add framing/scale
and per-beat expression to the load-bearing facts, closing the
expression leak. References visual-grammar §2; no new rules.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `image-generation SKILL.md` — execute, don't re-decide composition

**Files:** Modify `.claude/skills/image-generation/SKILL.md` — the "Prompt assembly" paragraph (~line 122) and technique-(b) table row (~line 146).

**Interfaces:** Consumes the framing VPW now authors into the `still_prompt`.

- [ ] **Step 1: Prompt-assembly paragraph.** Find the sentence that reads `your delta is the shot's still_prompt (which already carries the file's global_prompt_suffix) plus your placement/depth language.` and replace `plus your placement/depth language` with:

```
plus the seeds; the still_prompt ALREADY carries the authored framing/composition (VPW owns it — do not re-compose, add only minimal technical placement)
```

- [ ] **Step 2: Technique-(b) row.** In the technique table's `(b) Seeded composition` row, replace `Delta = the shot's \`still_prompt\` + explicit placement/depth ("MacGregor at left third, foreground; the ornate gilt frame centered; the harbour behind")` with:

```
Delta = the shot's `still_prompt`, which already carries the authored framing/composition — realize it faithfully, do NOT re-compose the shot
```

- [ ] **Step 3: Verify no re-compose instruction survives.**

Run:
```bash
cd /c/Users/danie/faceless-youtube
rg -n 'placement/depth|placement . depth|explicit placement' .claude/skills/image-generation/SKILL.md
```
Expected: no surviving instruction telling image-gen to author placement/depth itself (a mention of "minimal technical placement / do not re-compose" is fine — read the hits to confirm).

- [ ] **Step 4: Commit.**

```bash
git add .claude/skills/image-generation/SKILL.md
git commit -m "refactor(image-gen): execute the still_prompt's framing, don't re-compose

VPW owns composition (authored in the still_prompt); image-gen realizes
it and stops adding independent placement/depth. Removes the
double-authoring seam.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `style-bible.md` — diegetic art = flat-cel (§6) + placement→execute (§8)

**Files:** Modify `channels/the-second-take/visual-kit/style-bible.md` — §6 recipe (add a bullet ~line 178) and §8 scene-assembly step 1 (~line 255).

**Interfaces:** §8 mirrors Task 3's execute-don't-re-compose; §6 is the across-video render rule.

- [ ] **Step 1: Add the diegetic-art bullet to §6.** After the `**Charts / title-cards:** …` bullet (the one ending `…not a divergence to "fix."`), insert:

```markdown
- **Diegetic art / artifacts:** an in-world painting, poster, brochure vista, or map-as-artifact renders
  in OUR flat-cel look with the `#241a12` outline — our style *depicting* an artifact, NOT a soft-gradient
  illustration or a different medium. A too-perfect glossy "brochure" is achieved with palette +
  composition, still flat-cel. (The frame is a frame; the art inside it is us.)
```

- [ ] **Step 2: Reconcile §8 scene-assembly step 1.** Replace `The delta directs placement + depth ("X at left third, foreground; the ornate frame centered; the harbour behind").` with:

```
The delta REALIZES the `still_prompt`'s authored framing/placement (VPW owns composition — `visual-grammar.md §2`); image-gen executes it, it does not re-compose.
```

- [ ] **Step 3: Verify.**

Run:
```bash
cd /c/Users/danie/faceless-youtube
rg -n 'Diegetic art / artifacts|REALIZES the .still_prompt' channels/the-second-take/visual-kit/style-bible.md
rg -n 'delta directs placement' channels/the-second-take/visual-kit/style-bible.md
```
Expected: the two new lines present; the old "delta directs placement" gone.

- [ ] **Step 4: Commit.**

```bash
git add channels/the-second-take/visual-kit/style-bible.md
git commit -m "feat(style-bible): diegetic art renders flat-cel; §8 executes VPW framing

§6 gains the across-video rule that in-world art (framed paintings,
posters, maps-as-artifacts) renders in our flat-cel + #241a12 outline,
not a soft-gradient illustration. §8 step 1 reconciled to execute the
still_prompt's framing rather than re-decide placement.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Cross-file consistency sweep + bookkeeping

**Files:** Read-only sweep of the four edited files; modify `knowledge/decisions.md`, `CLAUDE.md`.

- [ ] **Step 1: Sweep — composition has one home, no §13a duplication, no double-authoring.**

Run:
```bash
cd /c/Users/danie/faceless-youtube
echo "=== composition-execution should be in visual-grammar §2 + VPW only ==="
rg -n 'realize the class|carries its composition|class + payload' .claude/skills/visual-prompt-writer/SKILL.md channels/the-second-take/visual-kit/visual-grammar.md
echo "=== §13a class table must NOT be duplicated in the channel docs ==="
rg -n 'When the narration is|narration.type ->|narration-type table' channels/the-second-take/visual-kit/
echo "=== no surviving 'image-gen authors placement' ==="
rg -n 'directs placement|explicit placement/depth|your placement/depth' .claude/skills/image-generation/SKILL.md channels/the-second-take/visual-kit/style-bible.md
```
Expected: composition-execution lives only in `visual-grammar §2` + `VPW`; no narration→class table in the channel docs; no surviving image-gen-authors-placement instruction. Fix any stray inline.

- [ ] **Step 2: Append the decision to `knowledge/decisions.md`** (before "## Open questions"):

```markdown
## 2026-07-09 — shot composition variety: make the class DRIVE composition

The generated Poyais shots were monotonous (characters same-size, centered, literal; flat repeated
expressions). Root cause (from reading the authoring flow, not asserting indiscipline): `universal §13a`'s
shot-class table already carries each class's composition (comparison → physicalized-imbalance/relative
size; relationship → staged-interaction: handshake/linked-arms/tug-of-war; etc.), but `VPW Step 2.5`
recorded the class as a TAG and then staged a generic centered shot — proof: L18 (`physicalized-imbalance`)
executed its class → the good scale shot; L16/L17 (`staged-interaction`) didn't → two figures parked.
Also: expression was decided (step 5) but not a STATED fact (step 6) so it never reached the prompt; and
composition was double-authored (VPW `still_prompt` + image-gen "placement/depth").

Fix [user-directed], all DO's, no new rules/field/taxonomy: (1) `VPW` — the class must DRIVE composition
(step 2) + framing/scale + expression become stated facts (rule 5, step 6); (2) `visual-grammar §2`
restructured into the channel's per-class composition realization (references §13a, doesn't duplicate it);
negative space now follows payload (artifact-detail fills the frame); (3) `image-generation` + `style-bible
§8` — image-gen EXECUTES the still_prompt's framing, stops re-composing (VPW owns composition, authored
once); (4) `style-bible §6` — diegetic art renders flat-cel. `universal §13a`, the shots schema, and the
pre-gen critic are untouched. Enforcement is generative + a gold exemplar to be minted later (deferred);
the image-gen review-reliability gap (a nose slipped) is a separate follow-up. Spec/plan:
`docs/superpowers/specs|plans/2026-07-09-shot-composition-variety*`.
```

- [ ] **Step 3: Update the `CLAUDE.md` visual-grammar/VPW status** — integrate a clause into the existing VISUAL GRAMMAR or still-side bullet noting the class-drives-composition change (composition authored once by VPW from the class+payload, executed by image-gen; diegetic art = flat-cel). Do NOT append a new dated block — edit the relevant existing bullet (rule 6).

- [ ] **Step 4: Commit (explicit paths).**

```bash
git add knowledge/decisions.md CLAUDE.md
git commit -m "docs: log shot-composition-variety decision + status

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final fresh-eyes read.** Re-read the new `visual-grammar §2`, the VPW Step 2.5 changes, and the image-gen/style-bible reconciliations end-to-end. Confirm: a fresh writer would (a) realize each class's composition, (b) state framing + expression in every prompt, (c) find composition-execution in exactly one place, with §13a still the sole class-definition source and image-gen executing not re-composing. Note (do not act) that minting the gold exemplar via a re-authored + regenerated slice is the deferred next step.

---

## Self-Review

**Spec coverage:**
- Change 1 (class drives composition + framing/expression facts) → Task 2. ✓
- Change 2 (visual-grammar per-class realization) → Task 1. ✓
- Change 3 (image-gen execute-not-re-decide) → Task 3 + Task 4 Step 2 (style-bible §8 mirror). ✓
- Change 4 (diegetic art flat-cel) → Task 4 Step 1. ✓
- Non-goals (no field, no taxonomy dup, §13a/critic/schema untouched, exemplar+nose deferred) → Global Constraints + Task 1 Step 3 + Task 5 Step 1. ✓

**Placeholder scan:** none — every edit shows exact old→new text; every verification is a concrete `rg` with an expected result.

**Type/name consistency:** the §2 class names (Task 1) are aligned to the schema enum in Task 1 Step 2; "framing/scale" + "expression (from the beat)" phrasing is identical across rule 5 and step 6 (Task 2); "execute, don't re-compose" phrasing is consistent across image-gen (Task 3) and style-bible §8 (Task 4).
