# Adversarial review — doctrine window (crowd expression + delta cap + seeded everyman)

Fresh-context reviewer, no involvement in the edits. Target: `scratchpad/b-window-diff.patch`
(374 lines, 13 files, +88/−55). Worktree `kb-worktrees/boss-bricks-expression`, branch
`claude/bricks-expression-restoration`. Diff read and judged BEFORE reading
`scratchpad/doctrine-window-report.md`; report claims then checked against it.

Out of scope by instruction: the known `forge.py::shot_cast` `base`-exclusion blocker (separate
task in flight). It is charged only where the report failed to disclose something about it — it
did not; §4 weakness 1 is the most complete disclosure in the document.

**Verdict: FIX-THEN-SHIP.** 0 BLOCKER · 4 MAJOR · 6 MINOR.

---

## CHARGE A — file-editing policies

### A1 — logic changed in place, no bolt-ons, one marked dated exception

**Largely survives.** The dated exception is real, marked and minimal: `visual-grammar.md:172-174`
carries exactly one italic block, `*Engine gate (2026-08-06, delete when closed): …*`, three lines,
inside the bullet whose rule it qualifies. No other dated block anywhere in the diff. No appended
paragraph contradicts earlier text; both large edits are re-scopings of the sentence that was
already there, not new paragraphs beside it.

**F-1 · MINOR · A1** — `style-bible.md:15`

> `— is the ANCHOR every cast character seeds off for form, and **it never appears in videos**.`

The absolute is left standing at the line where the law lives; the qualification that makes it
survivable arrives 13 lines later in a different bullet (`:28`, "which is how 'the base never
appears in videos' and 'the everyman is on the rig' hold at once"). That is the reconciliation
bolted downstream rather than the rule fixed in place. A reader who stops at `:15` — the bullet
titled "The base is a TEMPLATE, not a character" — gets the pre-wave law.
*Fix:* at `:15`, "and **it never appears as ITSELF** — an everyman staging always re-dresses it
(tier bullet below)"; then F-10's justification clause can go.

**F-2 · MINOR · A1/A4** — `visual-prompt-writer/SKILL.md:88`

> `with no story-bearing part are staged at crowd scale. Tier law + the current engine gate on the everyman route: `visual-grammar.md §2`.`

An undated pointer to a block that is explicitly marked for deletion. When the forge fix lands and
the gate line is deleted, this sentence points at nothing and reads as a live caveat.
*Fix:* "Tier law: `visual-grammar.md §2`." — five words out, and the pointer survives the deletion.

### A2 — core-rule fix over special-case

**Survives, cleanly.** Every change is a scope edit on the rule that already existed: the
pose/expression ban re-scoped to registry-backed figures rather than a crowd exception appended;
the tier law's own predicate changed from `NAMED CAST | CROWD` to `SEEDED | CROWD` rather than a
third tier bolted beside it; the cap's counted noun widened rather than a second cap added; the cap
number changed at its one enforcement site rather than a per-channel override. No rule was added
where widening an existing rule's scope would cover it.

### A3 — cross-file consistency (ONE story)

**Fails on one live file the report's doctrine map never visited.**

**F-3 · MAJOR · A3** — `image-generation/SKILL.md:150-153`

> `**Two tiers only: named cast (seeded from Pass-1 canonicals) and crowd (the §2d clause);`
> `there is no third, unseedable foreground tier.** `figures.anon_foreground` is a known-but-abolished key: the`
> `seeding law refuses it by name — name the figure in the video's cast (seeded) or stage the people at crowd`
> `scale (crowd exemplar).`

This is the pre-wave contract stated verbatim, in the skill that runs the Pass-1 gate and mints the
STEP-1 cards the everyman route depends on. Two further hits in the same file: `:15` "cast/crowd
tiers", and `:344` the post-gen rubric —

> `figure**, judged against the tier §3 assigns it (named cast → FULL rig, against that character's approved canonical … crowd → CROWD rig)`

— which gives a reviewer no tier to judge an everyman frame against. Not a scope excuse: this file
IS in the diff (the recipe-row cap edit at `:216`). The report's §1.1 doctrine map omits it entirely
and §1.2 concludes the reconciliation is owed "in the two live homes (style-bible §1, grammar §2)";
there are three. Mechanism of the miss: the cap number was swept by grep, the tier law was swept by
memory — `grep -rniE "two tiers"` finds this in one call. **Undisclosed by the report.**
*Fix:* at `:150-153` restate as the grammar does — "Figures are SEEDED (named cast · seeded
everyman) or CROWD; there is no unseedable foreground tier" — keeping the `anon_foreground` refusal
sentence; at `:344` add "seeded everyman → FULL rig against the `base` canonical".

**F-4 · MINOR (disclosed, correctly deferred) · A3** — `lint_shots.py:1254` and `forge.py:660`

> `f"it by name (SystemExit, forge.py:557): name the figure in the video's cast "`
> `f"(seeded) or stage the people at crowd scale (crowd exemplar).")`

Two remedies where doctrine now has three. Report weakness 2 states this precisely, explains why it
is one paired edit across both engines plus `test_new_guards.py`, and routes it with the forge task.
While the engine gate stands the two-route message is in fact the correct instruction, so no charge
today — recorded so it lands *with* the forge fix, not after it.

**F-5 · MINOR · A3** — the cap's new name is half-applied

`visual-grammar.md:184` renames it "**The foreground cap**", but two cross-references still call it
by the old name: `visual-prompt-writer/SKILL.md:80` "(`visual-grammar.md §2` cast-cap table…)" and
`shots-schema.md:141` "`visual-grammar.md §2` carries the cast-cap slate." (`critics.md:69` already
says "figure cap" and is consistent.)
*Fix:* two words — "cast-cap" → "figure-cap" in both.

**Swept clean (verified, not assumed):** repo-wide grep over `.claude/` + `visual-kit/` +
`knowledge/` finds **no** surviving statement of a blanket expression-prose ban (only the three
re-scoped lines: `VPW SKILL.md:71`, `critics.md:52`, `visual-grammar.md:116-118`); **no** surviving
"anonymous foreground human does not exist" in live doctrine; **no** live `≤3`/`>3` delta statement
(remaining `3`s are unrelated: thumbnail `≤3 words`, researcher `≤3–4 sub-questions`,
`test_breath.py` chained words, lint's `≤3 distinct literals` guard, `compliance_check.py` path
parts). §2e residue exists only in the wells-fargo `assets/_review/rig-shard-*.md`, the poyais
`_image-gen-plan`, and `decisions.md` — all dated records of runs judged under the old law, not live
doctrine; the report's §1.2 correction ("§2e does not exist in the current style-bible") is correct,
headings run §1·§2·§2b·§2c·§2d·§3·§4·§5·§6. `motion-planner`, `render-builder` and `shot-board`
carry no tier language at all, so nothing is owed there.

### A4 — no dead information

**Two real hits.**

**F-6 · MAJOR · A4** — `visual-grammar.md:186-197`, the cap table and its closing line

The header was re-scoped at `:184` ("at most 2 SEEDED figures per shot (named cast or seeded
everyman, in any mix)") but the slate it introduces was not:

> `| 1 cast, fresh | step-1 figure · **plate** | nothing — 2 slots free |`
> `| **2 cast, fresh** | step-1 figure A · step-1 figure B · **plate** | nothing — 1 slot still free |`
> …
> `Stated positively: **a fresh two-cast shot is the BASE of a stage; every later two-cast beat in that`
> `place is a delta on it.**`

All six rows and the summing sentence enumerate *cast* only. An author staging the wave's headline
shape — one named cast plus one seeded everyman, or two everymen — finds no row, no slate, and a
"stated positively" rule that does not describe their shot. This is exactly a stale example
invalidated by the edit, in the one table the pipeline reads for its seed budget.
*Fix (minimal):* one clause under the header — "*cast* in the rows below reads as *seeded figure*:
an everyman occupies a cast row identically" — or substitute the noun in the six rows and `:196`.

**F-7 · MAJOR · A4** — `docs/superpowers/specs/2026-08-06-crowd-expression-restaging-design.md:99`

> `- No change to cast caps, seeding law, or the two-tier authoring law.`

The spec is one of the two sources of law the report names in its own header. Its Changes list
(§§1–5) contains no seeded-everyman edit at all, and this non-goal line now flatly forbids the
wave's largest edit — which was in fact authorised by `decisions.md` 2026-08-06 ruling (4), a
higher and same-day authority. Nothing anywhere records the supersession. A fresh agent reading the
spec — the documented entry point for this wave — concludes edit 3 was out of scope. (Partial
mitigation: spec §2 already hedges the cap as "≤2 named/**foreground** figures".) Left as-is this is
live text asserting something false about the shipped state.
*Fix:* one clause on `:99` — "superseded by `decisions.md` 2026-08-06 ruling (4): the two-tier law
becomes SEEDED (named cast | seeded everyman) / CROWD; cap VALUE unchanged at 2, scope widened from
named cast to any seeded figure" — plus a one-line §6 naming the everyman edit.

**F-8 · MAJOR · A4** — `shots-schema.md:66`, the conditional plate law

> `must declare **zero named cast and no `stage_role: delta`**, because every other shot in the place seeds it`
> `and whatever it contains bleeds into all of them.`

"Zero named cast" was an exhaustive statement of "no foreground figure" under the two-tier law. It
is not under SEEDED/CROWD: a seeded everyman is not named cast, so the letter of the plate law now
permits one on a place plate — precisely the frame whose contents "bleed into all of them". The
edit that widened the tier law did not follow through to the rule that depended on its exhaustiveness.
*Fix:* "zero named cast" → "zero SEEDED figures (named cast or everyman)". Two words; no mechanism
change, and the mechanical side rides along with the queued forge task.

*Not charged (pre-existing, untouched by this wave):* `critics.md:25/35/49` and `VPW SKILL.md:48/61/202`
all instruct a read of `references/example-shots.md`, which does not exist in the references dir.
Dead before this diff, unaffected by it — flagged only so it is not mistaken for wave damage.

### A5 — files slim; is the +88 real content?

**Mostly yes.** The growth is concentrated in `visual-grammar.md` (+53/−16) and is genuinely new
law: the three-route tier definition, the clothing binding, the demotion ban with its measured
citation, the crowd expression channel, the engine gate. Two nits:

**F-9 · MINOR · A5** — `visual-grammar.md:159-162`, the demotion ban stated twice in adjacent
sentences: "must not be replaced with an empty object, **nor demoted to rear-zone crowd**, to avoid
spending a figure" then "Crowd scale is never the fallback for ONE anonymous performer; the seeded
everyman is." Only the four-word tail carries new information.
*Fix:* fold into one sentence ending "…nor demoted to rear-zone crowd — the seeded everyman is the
fallback, not crowd scale."

**F-10 · MINOR · A5** — `style-bible.md:28-29`, "— which is how 'the base never appears in videos'
and 'the everyman is on the rig' hold at once." Reasoning *about the edit* inside a LOCKED bible
whose every other bullet states values only. The law reads without it.
*Fix:* delete the clause (pairs with F-1, which removes the need for it).

---

## CHARGE B — goal states

### B1 — crowd figures may carry beat-fit expressions and group attitudes in prose · **LANDS**

Stated affirmatively in all three homes: `VPW SKILL.md:81-84` ("plain scene prose is its ONLY
expression channel"), `visual-grammar.md:116-118` (the seed-competition clause re-scoped: "**This is
a rule about SEEDED figures only**") and `visual-grammar.md:166-170` (the crowd staging sentence now
lists "the simple beat-fit expression and group attitude they hold"), and `critics.md:53-56` with
the inverse finding named so a critic cannot re-flag restored crowds. Nothing anywhere still forbids
it — verified by repo-wide grep (A3 above); the code-side expression guards (`forge.py:782, 1908,
1916`, lint's delta-entrance check at `1780-1810`) are all seed-scoped and cannot fire on crowd
prose.

*Residual, disclosed and spec-ruled, not a finding:* `style-bible.md` §2d's "identical simplified
face … without exception" and its three-mouth menu (neutral/smile/downturn) are untouched and may
flatten authored emotion. Report weakness 3; spec §2 makes the L07 re-mint the canary. Correct call —
pre-editing §2d would have violated the non-goal.

### B2 — the base template can never render as itself · **LANDS, bindingly**

`visual-grammar.md:157-159`: "it is **always dressed in the shot's own era and setting in prose** —
the base template never renders as itself". `style-bible.md:27-28`: "wearing the shot's own era
clothing from the prompt **and never** the template's default hoodie". `VPW SKILL.md:96`: "dressed
in the shot's own era in prose". All three are "always"/"never" constructions; no "should", "prefer"
or "where possible" anywhere. No mechanical guard exists, which is correct — B5 forbids adding one.
(F-1 is the one place the older absolute was left un-scoped.)

### B3 — no unseeded foreground-figure path remains · **LANDS**

"An anonymous foreground human does not exist" and "the beat becomes mass action" are gone from both
homes; every route in the replacement text is seeded (own canonical, `base` canonical, or crowd
exemplar). The abolished key is still hard-refused by name on both engines: `lint_shots.py:1195`
`FIGURES_KEYS = ("crowd",)` unchanged, `:1249-1257` refusal intact; `forge.py:236` `_FIG_KEYS`
unchanged, `:660` refusal intact. No new key, no new tier value, no promotion path — the replacement
explicitly hardens it ("a figure is authored in its tier from its first frame").

### B4 — the delta cap is 2 everywhere · **LANDS**

Logic: `lint_shots.py:311` `if deltas > 2:` with message "N delta frames (>2) — cap the chain at 2,
then re-base or hard-cut." Docstring `:291` follows. Prose: 12 of the 13 wave files carry the number;
grep finds no live doctrine still at 3. The only surviving `base + 3` text is the poyais
`shots.json` and its six dated `.pre-*` snapshots — per-video authored records of a run made under
the old cap, not doctrine; correctly left alone.

**Test tallies — run by me, not taken from the report:**

```
$ cd .claude/skills/visual-prompt-writer/scripts && python -m pytest -q
252 passed in 1.08s

$ cd .claude/skills/image-generation/scripts && python -m pytest -q
200 passed in 4.81s
```

**252 + 200 = 452 passed, 0 failed, 0 skipped.** The report's 452 is confirmed independently.
`test_stage_check.py` additionally run directly → `PASS test_stage_check`. Precision note, in the
report's favour: under pytest that file collects **0 tests** ("no tests ran in 0.03s") — its asserts
execute at import, so a regression surfaces as a collection error but contributes nothing to the
452. The report says exactly this and is accurate.

*Residual, by design and disclosed:* the live bricks-fresh `shots.json` now HARD-fails 3 stages.
Spec §4 routes those to the audit fix-list; not hot-patched. Correct.

### B5 — zero new functions, fields, vocabularies, enums, rulebooks · **LANDS**

`FIGURES_KEYS` / `_FIG_KEYS` unchanged. No schema field added (`shots-schema.md:173-174` `figures`
untouched). No `crowd_mood`. No expression vocabulary — "grinning"/"worried"/"deadpan" appear as
parenthetical illustrations in running prose, resolve to nothing, and are not enumerated as a closed
set. No pose-simplicity bound. No lint check added, no forge behaviour changed: the entire code
delta in the wave is one comparison constant, one error string, and three docstrings. The only new
named concept is "seeded everyman", which was ruled. "SEEDED" as the parent tier name and "the
foreground cap" as the cap's name are renamings of existing concepts — legitimate, though F-5 and
F-6 leave the rename half-applied.

### B6 — non-goals intact · **PARTLY**

- **style-bible §2d byte-untouched — VERIFIED.** `git diff -U0` on `style-bible.md` yields exactly
  one hunk, `@@ -24,5 +24,9 @@`; §2d begins at line 71. Untouched by construction, not by claim.
- **shots.json untouched — VERIFIED.** `git status --short` on the file is empty; `--stat` lists 13
  files, none a `shots.json`.
- **Seed caps unchanged** (`image-generation/SKILL.md:105`, ≤4 seeds/gen, untouched). **Night-shot
  rule** not in the diff at all. **No place-run rule added** — F-8 is a gap left open, not a rule added.
- **Cast caps:** the VALUE is unchanged at 2, but the cap was renamed and its scope widened from
  "named cast" to any seeded figure. Disclosed in report §2.3 as a consequential edit; defensible as
  the minimal consistent reading of ruling (4) — an everyman that cost nothing against the cap would
  blow the ≤4-seed budget. Charged only as F-7, because the spec's own non-goal line was not updated
  to record it.

---

## CHARGE C — honesty of the report

- **"9-file wording sweep" — ACCURATE.** Exactly 9 files carry ONLY the cap edit
  (`image-generation/SKILL.md`, `forge.py`, `test_forge_place_and_gates.py`, `animation-rules.md`,
  `shots-motion-schema.md`, `shots-schema.md`, `lint_shots.py`, `test_stage_check.py`,
  `universal.md`); 3 more carry it alongside edit 1/3 (`VPW SKILL.md`, `critics.md`,
  `visual-grammar.md`); `style-bible.md` is edit-3-only. The §2.2 header "(9 files)" then enumerates
  12 homes in prose, which reads loose but states nothing false. No charge.
- **"No test forced green" — VERIFIED TRUE.** The only test-behaviour diff is `test_stage_check.py`,
  and every fixture was re-pinned at equal strength: over-cap `base+4`/`">3"` → `base+3`/`">2"`
  (still exactly one over the cap, still asserting the HARD message); at-cap `base+3`-clean →
  `base+2`-clean (still exactly at the cap); reset fixture two 3-delta chains → two 2-delta chains
  (still at the cap on both). No assertion deleted, none loosened to a weaker predicate, no
  `skip`/`xfail`/try-except introduced. `test_forge_place_and_gates.py` is docstring-only. Counts
  match baseline (452 → 452, none added or removed).
- **`universal.md` §13a-ii rationale — VERIFIED.** The changed line (1356, "Continuity, cheapest
  first") sits inside `#### 13a-ii. Cut cadence — … (BINDING)` (1346–1366), which is exactly the
  section `animation-rules.md` and `shots-motion-schema.md` both cite as "Full law". Leaving it at 3
  would have made the cited authority contradict the enforcing lint — the stated reason is the true
  one. `universal.md` carries no figure-tier or crowd doctrine (only an unrelated "multiplying
  crowd" and a creator-identity "Anonymous + faceless" line), so no everyman sweep is owed there.
  The cross-channel caveat flagged as weakness 5 is real and correctly self-reported.
- **What the report missed:** F-3 (a third live home of the tier law, in the consuming skill, never
  entered the doctrine map), F-6 (the cap table left un-scoped under its own re-scoped header), F-7
  (the spec's non-goal now false), F-8 (the plate law's exhaustiveness broken). The pattern is
  single: the cap number was swept by grep, the tier law was swept from a hand-built map of two
  files. Everything the report *did* disclose — the forge blocker, the remedy-text gap, the §2d
  canary risk, the unproven everyman rig, the cross-channel `universal.md` call, the 3 designed lint
  violations — checked out against the tree.

---

## VERDICT

**FIX-THEN-SHIP** — 0 BLOCKER · 4 MAJOR · 6 MINOR.

Nothing in the diff is wrong-in-substance: all four owner rulings are provably in the text, both
non-goals that could be checked byte-wise hold, the 452-test tally is real, no test was weakened,
and no new mechanism was smuggled in. What is missing is the last mile of the sweep — three files
and one table still tell the pre-wave story.

Fix list, in order:

1. **F-3** `image-generation/SKILL.md:150-153` — replace "Two tiers only: named cast … and crowd …"
   with the SEEDED (named cast · seeded everyman) / CROWD statement, keeping the `anon_foreground`
   refusal; add the everyman tier at `:344`; drop "cast/crowd tiers" at `:15`.
2. **F-6** `visual-grammar.md:186-197` — re-scope the cap table: one clause under the header, or
   "cast" → "seeded figure" in the six rows and `:196`.
3. **F-7** `specs/2026-08-06-crowd-expression-restaging-design.md:99` — record the supersession of
   the "no change to … the two-tier authoring law" non-goal by `decisions.md` ruling (4).
4. **F-8** `shots-schema.md:66` — "zero named cast" → "zero SEEDED figures (named cast or everyman)".
5. **F-5** `VPW SKILL.md:80` + `shots-schema.md:141` — "cast-cap" → "figure-cap".
6. **F-1 / F-10** `style-bible.md:15` — scope "never appears in videos" to "never appears as ITSELF";
   then delete the justification clause at `:28-29`.
7. **F-2** `VPW SKILL.md:88` — drop "+ the current engine gate on the everyman route" so the pointer
   survives the gate's deletion.
8. **F-9** `visual-grammar.md:159-162` — fold the doubled demotion ban into one sentence.

**F-4** (`lint_shots.py:1254` / `forge.py:660` two-remedy text) needs no action now — it is correct
while the engine gate stands — but must ship *with* the queued `shot_cast` fix, not after it.
