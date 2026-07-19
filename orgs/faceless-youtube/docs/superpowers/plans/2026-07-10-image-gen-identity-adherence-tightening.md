# Image-gen identity/rig adherence tightening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rig-invariant identity-hold auto-apply on every character-bearing generation, and give the identity review a forced per-invariant verdict — so nose/ear/five-finger/base-drift can't ship by omission.

**Architecture:** Two moves, surgical to the identity/rig axis. **Move 1 (prevention):** the rig-hold text already exists as prose (§2 invariants, §2b family-form add-clause, §3 checklist); move the reusable *rig-only* subset into one extractable blockquote (new §2c), and have `forge.py` auto-append it to the prompt whenever a seed is character-bearing — including chain deltas, detected by seed path, so no new flag is needed. **Move 2 (detection):** rewrite the identity review agent's charter from "flag if noticed" to a forced PASS/FAIL per invariant per seeded frame. No new pipeline step, no schema change, no VPW change, no objective gate re-wired.

**Tech Stack:** Python 3 (`py -3`, stdlib only for the changed paths), plain-assert tests (repo has no pytest), Markdown docs.

## Global Constraints

- **Run scripts with `py -3`** (msys python lacks a CA bundle).
- **Tests are plain-assert style** — mirror `.claude/skills/visual-prompt-writer/scripts/test_lint_beat_type.py` (`sys.path.insert`, functions, `if __name__ == "__main__"` runner printing `PASS`). No pytest.
- **Stage explicit paths only; never `git add -A`; never rewrite history.** Parallel terminals share this tree (audio/Remotion is live).
- **Do NOT touch `channels/the-second-take/videos/_chain-test/`** — it is the audio terminal's active test bed. Validation runs are a separate step under human coordination.
- **The rig-hold holds FORM only** — round head · no nose · no ears · four-digit hand · outline · flat-cel. It must NEVER constrain costume, pose, expression, head-tone, or build (those are the delta's job). It is written **identity-agnostic** ("every cartoon figure keeps the rig"), so it is safe to over-apply and needs no "same character" wording.
- **No duplicated invariant text across §2 / §2b / §3 / §2c** — each states its slice once. §3 stays the values-only checklist (the WHAT); the SKILL owns the review HOW; §2c owns the auto-appended prompt text.
- **Integrate, don't append.** The bible's §10 change-log IS the designated log home (a dated entry there is correct, not append-drift). Everywhere else, edit in place.

---

### Task 1: style-bible §2c rig-hold block + de-dup §2b + align §3/§8/§10

**Files:**
- Modify: `channels/the-second-take/visual-kit/style-bible.md` (add §2c after §2b ~line 84; edit §2b add-clause lines 81–84; §3 hand-line ~line 97; §8 scene-assembly step 1 ~line 256–262; §10 log ~line 316)

**Interfaces:**
- Produces: a blockquote extractable by `blockquote_after(md, "RIG-HOLD descriptor")` — Task 2 reads it as `desc_righold`. Header text MUST contain the exact substring **`RIG-HOLD descriptor`**.

- [ ] **Step 1: Add the §2c RIG-HOLD blockquote** immediately after §2b (after the "environment/prop, describe the scene; palette is free." line). Insert:

```markdown
## 2c. RIG-HOLD descriptor (verbatim — auto-appended to every character-bearing generation)

> Every cartoon FIGURE in this image keeps the shared FAMILY RIG exactly as the reference(s): SAME round
> near-circle head (only slightly taller than wide, NOT an egg/oval), SAME eye style/size/position, NO nose,
> NO ears, SAME classic cartoon hands — exactly THREE fingers plus ONE thumb (four digits total, Mickey /
> Simpsons style, NEVER four fingers, NEVER five digits), SAME even medium-thick dark warm brown-black
> (#241a12) outline, SAME clean FLAT cel render. Hold ONLY this form — costume, pose, expression, head
> tone, build, and framing are set by the generation delta, not here.

This block holds **form, not identity** (it never says "the same person"), so it is safe on any generation
with a figure — a seeded existing character (identity carried by the seed image), a new character (identity
set by the delta), or a held-set chain delta. `image-generation` (`forge.py`) **auto-appends it** whenever a
seed is character-bearing (a `refs/<char>/`, `assets/library/`, or `assets/scenes/` seed) on a non-identity
mode; identity-mode gens already carry the full rig via §2, so it is not re-appended there. The rig VALUES
live once in §3 (the checklist) and §1 (the law) — this is their prompt-side voice, not a third definition.
```

- [ ] **Step 2: De-duplicate the §2b "for a new character, add:" clause** so the rig invariants live only in §2c. Replace the existing block (lines 81–84, the `For a **new character**, add: "…"` paragraph) with:

```markdown
For a **new character**, the delta supplies only the identity-VARYING traits: "a NEW cartoon person in the
SAME family form as the reference — with [hair / facial hair], a flat [tone] head (§4), and [build +
outfit]." The shared RIG it must hold (round head, no nose/ears, three-fingers-plus-thumb hands, outline,
flat cel) is the **§2c RIG-HOLD block**, which `forge.py` auto-appends to the gen — do not restate it in the
delta. For an **environment/prop**, describe the scene; palette is free.
```

- [ ] **Step 3: Align the §3 hand-line reference** (it currently credits only §2). Find the §3 Hands bullet ("Enforced in the §2 descriptor (the pinned 3-finger cartoon hand…") and change `§2 descriptor` → `§2/§2c descriptors`:

```markdown
- **Hands — four digits** (three fingers + a thumb), never five, six, or a mitten. Enforced in the §2/§2c
  descriptors (the pinned 3-finger cartoon hand — the generation-side prior that renders it reliably);
  the review confirms it by looking at the **full frame — no hand crops, no per-hand counting grind.**
```

- [ ] **Step 4: Add one DO line to §8 scene-assembly step 1** so the assembly procedure names the auto-append. At the end of §8 "Scene assembly" step 1 (after "…image-gen executes it, it does not re-compose."), append this sentence:

```markdown
   The **§2c RIG-HOLD block is auto-appended** to every character-seeded scene gen (and chain delta), so the
   figures' rig is held without the delta restating it — the delta carries only the scene's facts + framing.
```

- [ ] **Step 5: Log it in §10** (the designated change-log home). Add this dated entry to the Provenance list, after the 2026-07-09 "ALL generation moved to pro" entry:

```markdown
- **2026-07-10 — identity/rig adherence tightened (prevention + forced review verdict).** The per-character
  rig-hold, previously manual delta prose on composed scenes (`mode=environment` prepends only the §2b
  style-only descriptor), is now an extractable **§2c RIG-HOLD block** `forge.py` **auto-appends** to every
  character-bearing gen (seed under `refs/<char>/`, `assets/library/`, or `assets/scenes/`), closing the
  "operator forgot to assert it" hole that shipped noses + five-finger hands on the `_chain-test` slice. The
  §2b add-clause was de-duped to reference §2c (no invariant text stated twice). Move 2 (in the
  `image-generation` skill): the identity review now returns a forced PASS/FAIL per invariant per seeded
  frame instead of "flag if noticed." No objective gate (`diff`/`crop`) re-wired — the human artifact board
  stays the final finger authority. Spec/plan: `docs/superpowers/specs|plans/2026-07-10-image-gen-identity-adherence-tightening*`.
```

- [ ] **Step 6: Verify no duplicated invariant text and the header is extractable.**

Run: `grep -n "RIG-HOLD descriptor" channels/the-second-take/visual-kit/style-bible.md`
Expected: one line — the `## 2c. RIG-HOLD descriptor …` header.

Run: `grep -c "THREE fingers plus ONE thumb\|THREE fingers + ONE thumb" channels/the-second-take/visual-kit/style-bible.md`
Expected: the count did not grow beyond the §2 + §2c homes (the §2b restatement is gone) — read the three hits and confirm they are §2 (identity), §2c (rig-hold), and §3-references-only; §2b no longer restates it.

- [ ] **Step 7: Commit.**

```bash
git add channels/the-second-take/visual-kit/style-bible.md
git commit -m "feat(style-bible): §2c RIG-HOLD block, auto-appended; de-dup §2b add-clause"
```

---

### Task 2: forge.py — detect character-bearing seeds and auto-append §2c

**Files:**
- Modify: `.claude/skills/image-generation/scripts/forge.py` (add two module functions near `blockquote_after`; add `desc_righold` in `Kit.__init__`; add `hold` param to `Kit.prompt_for`; wire in `cmd_gen`)
- Test: `.claude/skills/image-generation/scripts/test_forge_hold.py` (new)

**Interfaces:**
- Consumes: `blockquote_after(md, "RIG-HOLD descriptor")` from Task 1's bible.
- Produces:
  - `_is_char_seed(path: str) -> bool` — True if a resolved seed path is a character/library/scene seed (not an env plate).
  - `should_hold(mode: str, resolved_seeds: list[str]) -> bool` — True when the rig-hold must be appended.
  - `Kit.desc_righold: str` — the §2c blockquote text (or `""` if absent).
  - `Kit.prompt_for(mode, delta, hold=False) -> str` — appends `desc_righold` when `hold`.

- [ ] **Step 1: Write the failing test** at `.claude/skills/image-generation/scripts/test_forge_hold.py`:

```python
#!/usr/bin/env python3
"""Unit test for forge.py rig-hold auto-append (plain-assert style; repo has no pytest)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from forge import _is_char_seed, should_hold, blockquote_after


def test_is_char_seed_classifies_paths():
    assert _is_char_seed("channels/x/visual-kit/refs/macgregor/macgregor-base.png") is True
    assert _is_char_seed("channels/x/videos/s/assets/library/bolivar.png") is True
    assert _is_char_seed("channels/x/videos/s/assets/scenes/L05.png") is True   # chain delta carry
    assert _is_char_seed("channels/x/visual-kit/refs/env/london-dock.png") is False  # env plate
    assert _is_char_seed(r"channels\x\visual-kit\refs\macgregor\m.png") is True  # windows sep
    assert _is_char_seed("some/random/plate.png") is False


def test_should_hold_only_on_char_bearing_nonidentity():
    char = ["channels/x/visual-kit/refs/macgregor/m.png"]
    env = ["channels/x/visual-kit/refs/env/dock.png"]
    # identity mode already carries the full rig via §2 -> never re-append
    assert should_hold("identity", char) is False
    # composed scene / new char / chain delta with a character-bearing seed -> append
    assert should_hold("environment", char) is True
    assert should_hold("new_character", char) is True
    assert should_hold("style", char) is True
    # character-free environment (env plate only / no seed) -> no append
    assert should_hold("environment", env) is False
    assert should_hold("environment", []) is False


def test_blockquote_after_extracts_righold():
    md = ("## 2b. STYLE-ONLY descriptor\n\n> style stuff here\n\n"
          "some prose\n\n## 2c. RIG-HOLD descriptor (verbatim)\n\n"
          "> Every cartoon FIGURE keeps the rig: no nose, no ears.\n\nnext prose\n")
    got = blockquote_after(md, "RIG-HOLD descriptor")
    assert got == "Every cartoon FIGURE keeps the rig: no nose, no ears.", repr(got)


if __name__ == "__main__":
    print("running")
    test_is_char_seed_classifies_paths()
    test_should_hold_only_on_char_bearing_nonidentity()
    test_blockquote_after_extracts_righold()
    print("PASS")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `py -3 .claude/skills/image-generation/scripts/test_forge_hold.py`
Expected: FAIL — `ImportError: cannot import name '_is_char_seed' from 'forge'`.

- [ ] **Step 3: Add the two module functions** to `forge.py`, immediately after the `blockquote_after` function (after its `return out ...` line, before `class Kit`):

```python
def _is_char_seed(path):
    """A seed path carries a figure (character canonical, per-video library copy, or a prior scene
    frame in a held-set chain) — as opposed to an environment plate. Drives the rig-hold auto-append."""
    rp = str(path).replace("\\", "/")
    if "/refs/env/" in rp:
        return False
    return ("/refs/" in rp) or ("/assets/library/" in rp) or ("/assets/scenes/" in rp)


def should_hold(mode, resolved_seeds):
    """Append the §2c RIG-HOLD block when a figure is in frame AND the mode isn't `identity`
    (identity gens already carry the full rig via the §2 descriptor, so re-appending is redundant)."""
    if mode not in ("new_character", "environment", "style"):
        return False
    return any(_is_char_seed(s) for s in resolved_seeds)
```

- [ ] **Step 4: Extract `desc_righold` in `Kit.__init__`.** After the `self.desc_style = blockquote_after(md, "STYLE-ONLY descriptor")` line, add:

```python
        self.desc_righold = blockquote_after(md, "RIG-HOLD descriptor")
```

- [ ] **Step 5: Add the `hold` param to `Kit.prompt_for`.** Replace the whole `prompt_for` method with:

```python
    def prompt_for(self, mode, delta, hold=False):
        if mode == "identity":
            text = self.desc_identity + "\n\n" + delta
        elif mode in ("new_character", "environment", "style"):
            text = self.desc_style + "\n\n" + delta
        else:
            raise SystemExit(f"unknown mode '{mode}'")
        if hold and self.desc_righold:
            text = text + "\n\n" + self.desc_righold
        return text
```

- [ ] **Step 6: Wire it into `cmd_gen`.** In `cmd_gen`, the `else` branch resolves `seeds = [k.resolve_seed(s) for s in seeds]`; the `if not seeds:` branch computes the auto-seed list. Both leave `seeds` as the resolved list used to build `parts`. Change the `parts` line to compute `hold` from the resolved seeds and pass it:

Find:
```python
        parts = [ip(s) for s in seeds] + [{"text": k.prompt_for(mode, r["delta"])}]
```
Replace with:
```python
        hold = should_hold(mode, seeds)
        parts = [ip(s) for s in seeds] + [{"text": k.prompt_for(mode, r["delta"], hold=hold)}]
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `py -3 .claude/skills/image-generation/scripts/test_forge_hold.py`
Expected: `running` then `PASS`.

- [ ] **Step 8: Smoke-check extraction against the real bible** (confirms Task 1's header is found and the wiring reads it). Run:

```bash
py -3 -c "import sys; sys.path.insert(0,'.claude/skills/image-generation/scripts'); from forge import Kit; k=Kit('channels/the-second-take/visual-kit'); print('RIGHOLD_LEN', len(k.desc_righold)); print(k.desc_righold[:60])"
```
Expected: `RIGHOLD_LEN` is a few hundred (non-zero), and the first 60 chars begin `Every cartoon FIGURE in this image keeps the shared FAMILY RIG`.

- [ ] **Step 9: Commit.**

```bash
git add .claude/skills/image-generation/scripts/forge.py .claude/skills/image-generation/scripts/test_forge_hold.py
git commit -m "feat(forge): auto-append §2c rig-hold on character-bearing gens (path-detected, no flag)"
```

---

### Task 3: image-generation SKILL.md — retire the manual assert, add the forced verdict

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md` (Move 1: the technique-(b) prompt-assembly note, lines ~130–131; Move 2: "Reviewing the batch" §1, lines ~200–206)

**Interfaces:**
- Consumes: the §2c auto-append behavior from Tasks 1–2 (the SKILL now describes it instead of instructing a manual assert).

- [ ] **Step 1 (Move 1): Retire the manual assert in the technique-(b) prompt-assembly note.** In the "Prompt assembly" paragraph, find the mode-(b) clause containing `assert in the delta "keep each seeded character EXACTLY as in its reference: round head, no nose, no ears, same outline"` and replace that parenthetical with a DO stating it's automatic:

Find (spanning ~lines 130–131):
```markdown
character refs carry each figure's identity — assert in the delta "keep each seeded character EXACTLY as
in its reference: round head, no nose, no ears, same outline");
```
Replace with:
```markdown
character refs carry each figure's identity, and `forge.py` auto-appends the §2c RIG-HOLD block whenever a
seed is character-bearing — so the delta states only the scene's facts + framing, never a hand-typed
"keep the character on-rig" assertion);
```

- [ ] **Step 2 (Move 1): Add a one-line DO to the Pass-2 technique-(b) row** so the technique table agrees. In the `| **(b) Seeded composition** …` row, at the end of the "How" cell (after "realize it faithfully, do NOT re-compose the shot"), append:

```markdown
 — the §2c rig-hold is auto-appended, so do not restate rig invariants in the delta
```

- [ ] **Step 3 (Move 2): Rewrite the identity/rig review charter to a forced verdict.** Replace review item **1. Identity/rig** (lines ~200–206) with:

```markdown
1. **Identity/rig** — return a FORCED verdict on **every seeded frame**, never a silent pass. For each
   seeded figure, rule **PASS/FAIL on each invariant, judged against the character's canonical seed**:
   **round head · no nose · no ears · four-digit hand (three fingers + a thumb) · pinned costume** — and for
   a **chain-delta** frame add one **held-set** line (is the set + identities consistent with this stage's
   `base` frame?). The **four-digit hand is judged like every other invariant** — the seed is 4-digit, so a
   5-digit render is a drift-from-seed FAIL, no different from a nose appearing; do not treat hands as a
   special "uncertain" case. On any FAIL, name the shot id and quote the offending pixel in one clause.
   Judge against the channel's **approved canonical** (`refs/<char>/<char>-base.png`), NOT an idealized
   pure-round-head/articulated-finger rig. Look at the **FULL frame; never crop hands, never grind a
   per-hand count.** Silence on a seeded frame is not allowed; every seeded frame gets an explicit
   per-invariant ruling.
```

- [ ] **Step 4: Verify the manual-assert phrasing is gone and the forced verdict is present.**

Run: `grep -n "keep each seeded character EXACTLY\|assert in the delta" .claude/skills/image-generation/SKILL.md`
Expected: no matches.

Run: `grep -n "FORCED verdict\|PASS/FAIL on each invariant" .claude/skills/image-generation/SKILL.md`
Expected: one match in review item 1.

- [ ] **Step 5: Commit.**

```bash
git add .claude/skills/image-generation/SKILL.md
git commit -m "feat(image-generation): auto-applied rig-hold in assembly note; forced per-invariant identity verdict"
```

---

### Task 4: cross-file alignment sweep

**Files:**
- Read-only sweep across `channels/the-second-take/visual-kit/style-bible.md`, `.claude/skills/image-generation/SKILL.md`, `.claude/skills/image-generation/scripts/forge.py`, `.claude/skills/long-form-writer/SKILL.md`

**Interfaces:**
- Consumes: everything from Tasks 1–3. Produces: confirmation that no stale reference or duplicated concept survived.

- [ ] **Step 1: Confirm no stale manual-assert or duplicated rig text anywhere.**

Run: `grep -rn "keep each seeded character EXACTLY\|round head, no nose, no ears, same outline" .claude/skills channels/the-second-take/visual-kit`
Expected: no matches (all replaced by the §2c auto-append).

- [ ] **Step 2: Check the incidental `long-form-writer` descriptor reference is unaffected.**

Run: `grep -n "§2b\|STYLE-ONLY descriptor\|LOCKED STYLE descriptor" .claude/skills/long-form-writer/SKILL.md`
Expected: read each hit; confirm it does not depend on §2b's now-de-duped add-clause (it is the script writer, not an image descriptor consumer). If a hit actually restates image rig invariants, note it — but do NOT edit long-form-writer unless it genuinely references the moved text (it should not).

- [ ] **Step 3: Confirm the four concept homes are singular** (the user's explicit no-redundancy bar): rig VALUES in §1/§3 only; rig PROMPT TEXT in §2 (identity, base-specific) and §2c (form-only) only; auto-append LOGIC in `forge.py` only; review VERDICT FORMAT in `SKILL.md` only. Read the four files' relevant sections and confirm nothing states another's slice.

Run: `py -3 .claude/skills/image-generation/scripts/test_forge_hold.py`
Expected: `PASS` (regression guard after all edits).

- [ ] **Step 4: Final commit (if the sweep produced any alignment fix; otherwise skip).**

```bash
git add -- <explicit paths touched>
git commit -m "chore(image-gen): cross-file alignment sweep for the rig-hold tightening"
```

---

## Self-Review

**Spec coverage:**
- Move 1 (auto-apply existing rig text on character-bearing gens) → Task 1 (§2c block + de-dup) + Task 2 (forge detection + append). ✓
- Chain-delta edge → resolved by path-detection (`assets/scenes/` in `_is_char_seed`), no flag — Task 2 Step 3. ✓ (supersedes the spec's "flag" suggestion, which the spec explicitly left to the plan.)
- Move 2 (forced per-invariant verdict) → Task 3 Step 3. ✓
- "What this does NOT do" (no diff/crop, no second pass, no VPW change) → honored; Task 3 Step 3 keeps "no crops" + human-board authority. ✓
- One-home / no-duplication success criterion → Task 1 Step 6, Task 4 Steps 1 & 3. ✓

**Placeholder scan:** no TBD/TODO; every code + doc step shows exact content; verification steps have exact commands + expected output. ✓

**Type consistency:** `_is_char_seed` / `should_hold` / `desc_righold` / `prompt_for(..., hold=)` names match across Task 2's definitions, the test, and the `cmd_gen` wiring. The extractable header substring `RIG-HOLD descriptor` matches between Task 1 (bible header) and Task 2 (`blockquote_after` call + smoke check). ✓
