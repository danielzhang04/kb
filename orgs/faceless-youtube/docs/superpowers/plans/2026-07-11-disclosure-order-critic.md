# Disclosure-order critic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "disclosure order" authoring law + Step-8 critic check so a shot can't visually reveal what the narration hasn't yet.

**Architecture:** Two prose files, edited as one atomic unit. `SKILL.md` names a new 7th canonical authoring law and states its authoring intent (a pointer, not a definition). `references/critics.md` holds the definition — a new plan-level check in the EXISTING shot critic's charter + a never-flag guard. No new subagent, no schema/lint/image-gen change. The "test" is a grep-based consistency check (the cross-file counts and names must stay in sync).

**Tech Stack:** Markdown docs; Git Bash for the consistency grep.

## Global Constraints

- **Law name is verbatim and canonical:** `disclosure order` — used identically in both files; never coin a variant (e.g. "premature disclosure", "reveal integrity"). (`SKILL.md` line 79–80 rule.)
- **Per-shot question count stays SIX.** disclosure order is **plan-level**, never a 7th per-shot question. Do NOT touch `critics.md` "Answer SIX questions per shot" (line 47) or the generalized-questions list in `SKILL.md` (`scene logic · tableau · casting · acting · staging interest · renderability`, line 436).
- **One home:** the *definition* of the check lives only in `critics.md`; `SKILL.md` names the law + states brief authoring intent + references `critics.md`. No duplicated definition. (Mirrors how `delta decisiveness` is already split.)
- **Fix direction is re-author-to-absent, never obscure** (no back-to-viewer/silhouette).
- **Narrow trigger:** fires only on a real setup→payoff withholding; ordinary first-introductions are never flagged.
- **Parallel terminals:** stage only these two explicit paths; never `git add -A`. Another terminal may be editing `SKILL.md` — re-read the exact strings before each edit; if a string has drifted, adapt the anchor, keep the intent.

---

### Task 1: Add the disclosure-order law + critic check (both files, one commit)

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md` (5 count/naming sites + 1 new authoring-intent paragraph)
- Modify: `.claude/skills/visual-prompt-writer/references/critics.md` (charter plan-level block + never-flag guard + Notes 1:1 map)

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: the canonical law name `disclosure order` referenced by both files; consumed by the human/subagent running VPW Step 8.

- [ ] **Step 1: Write the failing consistency check**

Create `scratchpad`-free inline check (run from repo root). Save as a throwaway you can re-run; the assertions ARE the test:

```bash
# consistency check for the disclosure-order docs change
S=.claude/skills/visual-prompt-writer/SKILL.md
C=.claude/skills/visual-prompt-writer/references/critics.md
fail=0
# 1. law present in BOTH files
grep -q "disclosure order" "$S" || { echo "FAIL: 'disclosure order' missing from SKILL.md"; fail=1; }
grep -qi "disclosure order" "$C" || { echo "FAIL: 'disclosure order' missing from critics.md"; fail=1; }
# 2. no stale 'six authoring laws' anywhere (must be seven)
if grep -rniE "six authoring laws" "$S" "$C" ; then echo "FAIL: stale 'six authoring laws' remains"; fail=1; fi
grep -q "seven authoring laws" "$S" || { echo "FAIL: 'seven authoring laws' not in SKILL.md"; fail=1; }
grep -qi "seven authoring laws" "$C" || { echo "FAIL: 'seven authoring laws' not in critics.md"; fail=1; }
# 3. per-shot question count untouched (still six)
grep -q "Answer SIX questions per shot" "$C" || { echo "FAIL: critics.md per-shot count changed"; fail=1; }
# 4. canonical list carries 7 laws (delta decisiveness + hook bar + disclosure order all present on the naming line)
grep -q "delta decisiveness · hook bar · disclosure order" "$S" || { echo "FAIL: SKILL.md canonical list not extended to 7"; fail=1; }
# 5. no obscuring-hack language crept into the fix direction
if grep -niE "back-to-viewer|silhouette" "$C" | grep -viE "never|dodges|merely obscured" ; then echo "FAIL: obscuring hack presented as a fix"; fail=1; fi
[ $fail -eq 0 ] && echo "CONSISTENCY: PASS" || echo "CONSISTENCY: FAIL"
```

- [ ] **Step 2: Run it to confirm it FAILS**

Run the block above.
Expected: `FAIL` lines for missing `disclosure order` (both files), missing `seven authoring laws`, and canonical-list not extended → ends `CONSISTENCY: FAIL`.

- [ ] **Step 3: Edit `SKILL.md` — the five count/naming sites**

Use Edit for each (exact current → new):

3a. Line ~45 (fundamentals paragraph):
- old: `— and feeding — the **six authoring laws** named canonically under *Load-bearing rules*, which the`
- new: `— and feeding — the **seven authoring laws** named canonically under *Load-bearing rules*, which the`

3b. Line ~78 (heading of the canonical list):
- old: `**The six authoring laws (canonical names — the taste/logic core).** These are the named laws the`
- new: `**The seven authoring laws (canonical names — the taste/logic core).** These are the named laws the`

3c. Line ~81 (the canonical name list — extend to 7):
- old: `**held tableau · scene facts · acting · casting · delta decisiveness · hook bar** — all under the`
- new: `**held tableau · scene facts · acting · casting · delta decisiveness · hook bar · disclosure order** — all under the`

3d. Line ~82–83 (the realization sentence):
- old: `six per-shot questions + one plan-level pair; the 1:1 map lives in `critics.md`.`
- new: `six per-shot questions + its plan-level checks (delta decisiveness + disclosure order, alongside the stage-grouping semantic check); the 1:1 map lives in `critics.md`.`

3e. Line ~435 (Step 8 dispatch — count only; the six generalized questions list stays untouched):
- old: `this run's authoring context, given `shots.json` + `script.md` + the channel staging law + the six`
- new: `this run's authoring context, given `shots.json` + `script.md` + the channel staging law + the seven`

- [ ] **Step 4: Edit `SKILL.md` — add the authoring-intent statement (one home = intent only)**

Append disclosure-order's authoring intent to the plan-level staging discussion, immediately after the "Deltas are DECISIVE" passage. Edit at the end of the `- **Stage the run …**` bullet block (line ~338, after `…a shot with no shared`… sentence completes) is risky to anchor; instead add it as its own new bullet right after that bullet. Concretely, find the line `  is what reads like the reference channels. **Deltas are DECISIVE:**` and after the whole `- **Stage the run …**` bullet ends, insert a new sibling bullet:

- old (anchor — the start of the next section/bullet after "Stage the run"; locate the first line that begins a new `- **` bullet or `## ` heading AFTER line 338 and insert BEFORE it):

Insert this new bullet (self-contained; intent + pointer, no definition):

```markdown
- **Disclosure order — an image never reveals ahead of the narration (plan-level law).** A shot may
  contain only what the VO has already introduced by that shot's `vo_ref` position. When the script
  **deliberately withholds** a payload for a later beat (a character's identity, a fate, a twist
  object/number/place), that entity does **not** appear in any earlier shot — in **any pose or form**;
  the fix is to re-author the shot (or rework its stage chain) with the entity absent, never to obscure
  it. It's a cross-shot sequencing property, so the Step-8 critic enforces it at plan level
  (`references/critics.md`); an ordinary first-introduction is not withholding and is not a defect.
```

(If the exact insertion anchor has drifted, place this bullet anywhere inside the authoring-laws body near the `Stage the run` / delta discussion — the requirement is: one concise intent statement + pointer to `critics.md`, not near the numbered mechanical-rules list.)

- [ ] **Step 5: Edit `critics.md` — the charter plan-level block (the definition)**

5a. Replace the plan-level pair block. 
- old:
```
> Also check the plan-level pair: **delta decisiveness** (a world-flip delta must flip the frame —
> flag timid partial changes, e.g. a "paradise peels away" where paradise visibly remains) and
> **stage grouping** — but here your job is the **SEMANTIC call only**: *are these really one held
> set?* (consecutive shots on one set that were NOT chained into a stage, or a chain whose set changes
> so much it isn't really held). The **mechanical caps** (exactly one `base`, ≤3 `delta`s, contiguity,
> delta timing, `stage_role` order) are `lint_shots.py`'s job — do **not** re-flag those.
```
- new:
```
> Also check the plan-level checks. **Delta decisiveness** (a world-flip delta must flip the frame —
> flag timid partial changes, e.g. a "paradise peels away" where paradise visibly remains). **Stage
> grouping** — here your job is the **SEMANTIC call only**: *are these really one held set?*
> (consecutive shots on one set that were NOT chained into a stage, or a chain whose set changes so
> much it isn't really held); the **mechanical caps** (exactly one `base`, ≤3 `delta`s, contiguity,
> delta timing, `stage_role` order) are `lint_shots.py`'s job — do **not** re-flag those.
> **Disclosure order** — does the script **deliberately withhold** a payload for a later beat (a
> setup→payoff: a character's identity, a fate, a twist object/number/place)? If so, flag the
> **earliest** shot that visually discloses it before the narration does. Fix direction: **re-author**
> that shot (or rework the chain if it's a `base`/`delta`) so the withheld entity is **absent
> entirely** — never merely obscured (back-to-viewer/silhouette still puts a recognizable figure in
> frame and dodges the rule).
```

- [ ] **Step 6: Edit `critics.md` — the never-flag guard**

Add a bullet to the `**NEVER flag these — over-triggering is the failure mode:**` list.
- old:
```
> - Non-literal depictions that feel "indirect" — non-literal is the channel default and the point.
```
- new:
```
> - Non-literal depictions that feel "indirect" — non-literal is the channel default and the point.
> - A character or thing shown at or after its first narration mention, absent a real setup→payoff
>   withholding. Disclosure order fires ONLY on deliberate withholding — never on ordinary first
>   introductions.
```

- [ ] **Step 7: Edit `critics.md` — Notes 1:1 map (seven + map extension)**

- old:
```
- The critic checks **the six authoring laws** named canonically in `SKILL.md` → *Load-bearing rules*
  (**held tableau · scene facts · acting · casting · delta decisiveness · hook bar**, under the
  *author intent, never mechanism* / engine-reality frame). Do **not** restate a divergent set here —
  reference that named list. The 1:1 map: Q1 scene logic → **scene facts** · Q2 → **held tableau** ·
  Q3 → **casting** · Q4 → **acting** · Q5 staging interest → **hook bar** · Q6 renderability → the
  **engine-reality** frame; the plan-level pair covers **delta decisiveness** (+ stage grouping, the
  semantic half). If a law's name changes in SKILL.md, update these references in the same edit.
```
- new:
```
- The critic checks **the seven authoring laws** named canonically in `SKILL.md` → *Load-bearing rules*
  (**held tableau · scene facts · acting · casting · delta decisiveness · hook bar · disclosure order**,
  under the *author intent, never mechanism* / engine-reality frame). Do **not** restate a divergent set
  here — reference that named list. The 1:1 map: Q1 scene logic → **scene facts** · Q2 → **held tableau** ·
  Q3 → **casting** · Q4 → **acting** · Q5 staging interest → **hook bar** · Q6 renderability → the
  **engine-reality** frame; the plan-level checks cover **delta decisiveness** + **disclosure order**
  (+ stage grouping, the semantic half). If a law's name changes in SKILL.md, update these references in
  the same edit.
```

- [ ] **Step 8: Run the consistency check to confirm it PASSES**

Re-run the Step-1 block.
Expected: `CONSISTENCY: PASS` (no FAIL lines).

- [ ] **Step 9: Eyeball both edited sections for prose flow**

Read `SKILL.md` lines ~76–86 + the new disclosure-order bullet, and `critics.md` lines ~40–120. Confirm: the seven-law naming reads cleanly, the new critic check flows after stage grouping, the never-flag guard fits its list, and no definition is duplicated between the two files (SKILL = intent+pointer, critics = definition).

- [ ] **Step 10: Commit (both files, one commit)**

```bash
git add .claude/skills/visual-prompt-writer/SKILL.md .claude/skills/visual-prompt-writer/references/critics.md
git commit -m "feat(vpw): disclosure-order law + Step-8 critic check

7th authoring law (plan-level): an image must not reveal what the narration
hasn't yet, on a deliberate setup->payoff withholding. Definition in the
existing shot critic's plan-level checks (critics.md); SKILL.md names the law
+ authoring intent. Fix = re-author shot/chain with the entity absent, not
obscured. Cross-file six->seven counts synced.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Validation (post-implementation, not a task)

No unit test — the critic is a prose charter. Real validation is the next VPW dogfood (the Poyais gold-exemplar slice per `docs/handoffs/2026-07-09-composition-variety-gold-exemplar-pickup.md`): with the check in place, the Step-8 critic should flag a premature-disclosure shot (MacGregor shown before his reveal), the author should re-author it to absent the character, and `lint_shots.py --write` should re-pass. Also confirm the never-flag guard holds — ordinary first-introduction shots are not flagged.
