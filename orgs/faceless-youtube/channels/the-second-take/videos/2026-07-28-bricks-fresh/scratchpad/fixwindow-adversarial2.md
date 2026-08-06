# Adversarial review 2 — the fix wave + the forge costumed-card mint (2026-08-06)

Fresh reviewer, no part in either edit. Target: the **uncommitted** delta over `27bc7e2` in
`kb-worktrees/boss-bricks-expression` (17 files) = (a) the fix wave closing the 10 B-window findings
plus the performer/place doctrine (`fixwave-report.md`), (b) the forge costumed-card mint
(`forge-costume-fix-report.md`). Engine paths read line by line; every claim below was reproduced,
not taken from either report. Fixes applied in place under review authority; nothing committed.

**VERDICT: SHIP-WITH-NOTES** — 0 BLOCKER · 2 MAJOR (both FIXED) · 1 ESCALATE · 4 MINOR (3 FIXED,
1 accepted). The wave's substance is right: all ten findings are genuinely closed, the three-tier law
reads the same in all live homes, the `everyman`→`performer` sweep is complete in live doctrine, no
test was weakened, and the place-diversity edit is exactly the approved minimum (one grammar sentence
+ one critic finding, no cap, no lint). What was wrong is the costumed card's **reuse key**: it was
keyed on the place, not on the costume, and that reintroduces the very collision the fix exists to
close — one severity level below the pre-fix bug, because the scene is now told the card's costume is
authoritative and can no longer correct it in prose.

---

## Findings

| # | Sev | File:line (post-fix) | Finding | Status |
| --- | --- | --- | --- | --- |
| A-1 | **MAJOR** | `forge.py:1585-1596` (was: `costume_key = slug(place)`) | Performer cards keyed on `place`, so two DIFFERENTLY DRESSED performers in one place on one pose/expr recipe silently share a card — and `seed_roles_text` now says "everything it wears comes from this card", so the second shot's own prose cannot correct it. | **FIXED** — key is now `<place>-<sha256(dress)[:8]>`. Proof: probe (labourer + barrister, one courtroom, `expr-worried`/`action-slump`) minted ONE card `fig-base--action-slump--expr-worried--jury-courtroom` before; now mints `…-7e826c09` + `…-747b049b`, each dressed from its own shot. New regression test `test_two_dresses_in_ONE_place_never_share_a_card`. |
| A-2 | **MAJOR** | `VPW SKILL.md:90-91`, `shots-schema.md:190-191` | Both stated that clothing written outside the figure's sentence leaves "the rig template's default outfit" standing — false, and it contradicts the locked absolute ("the base template never renders as itself", style-bible §1 / grammar §2). `figure_card_payload` orders "dress the figure in it for that era… **never the rig template's default hoodie**" from whatever era prose does reach the card. | **FIXED** — both homes now say the figure is dressed from the opening era sentence alone, "the generator's invention rather than yours", word-consistent across the two files. |
| A-3 | **ESCALATE** | `forge.py::shot_cast:487-492` + `visual-grammar.md:195-203` (cap table) | The cap table's re-scoped rows now make **2 performers in one shot** legal doctrine ("2 figures, fresh · step-1 figure A · step-1 figure B"), but the engine cannot build it: `backticked()` de-dupes, so two `` `base` `` mentions collapse to ONE cast entry with the union of primitives. Probe: a two-performer courtroom shot mints one card and records `surplus primitive(s) NOT seeded: expr-smug` in `why` — the second performer is unseeded prose, i.e. the abolished anonymous-foreground tier, arriving **silently**. | **ESCALATE** — see option analysis below. |
| A-4 | MINOR | `lint_shots.py:1251,1255` | Remedy text pointed at `forge.py:557`; the refusal is at `forge.py:712` and 557 is now `_interaction_primitives`. Dead pointer, in the one message the word-identical-remedy law governs. | **FIXED** — both sites now name `seeding_law_violations` (the remedy trio itself stays byte-identical to forge's). |
| A-5 | MINOR | `forge.py:1853` spec-item field | The new scene-item field was named `costume` while holding a KEY, colliding in name with the registry's `costume` (a named character's pinned outfit, `forge.py:454`). | **FIXED** — renamed `costume_key` at all three sites (writer, `seeding_law_violations` reader, tests); the comment states why it is a key and not a costume. |
| A-6 | MINOR | `lint_shots.py:1640-1642` | `place_plate_check`'s degradation docstring still said "the **cast** half degrades silently" after the law became zero-SEEDED-figures. | **FIXED** — "figure half". |
| A-7 | MINOR | `lint_shots.py:2276` `two_cast_presence_check` | Function identifier still says "two-cast" while its docstring, message and section header all say two-figure. | **NOT-A-BUG (accepted)** — an identifier, not a statement of law; renaming it touches two test files for no legal gain. Recorded so the next sweep does not re-find it. |

### A-3 option analysis (needs Daniel, not a reviewer)

The engine has exactly one name for the whole performer tier — `` `base` `` — so a shot cannot address
two distinct performers, and the doctrine this wave shipped says it can. Three ways out. **(a) Narrow
the law:** at most ONE seeded performer per shot; a second anonymous figure is named cast or crowd. One
clause in the cap table, zero engine work, and it costs the shape "two anonymous people play the beat
at each other" — which is a real comic shape on this channel. **(b) Build performer identities:** let a
shot name `base` twice (or `base-2`), giving each mention its own recipe and card. This is genuinely
new vocabulary and touches `backticked`/`shot_cast`/`_split_primitives` and every lint law that counts
figures — the largest option, and the only one that keeps the shipped cap table true as written.
**(c) Refuse loudly, decide later:** HARD-refuse a prompt naming `` `base` `` more than once, in both
engines, so the unbuildable shape costs $0 and names itself instead of silently demoting a performer
to unseeded prose. (c) is the cheap holding position and is compatible with either (a) or (b) later; I
did not apply it, because choosing between "one performer per shot" and "performers get identities" is
a law decision, and a refusal is that decision by default.

## What I checked and found CLEAN (not assumed)

- **The ten B-window findings are closed as claimed** — F-1/F-10 (style-bible absolute scoped, the
  justification clause gone), F-2 (pointer survives the gate deletion), F-3 (`image-generation/SKILL.md`
  :15/:150-156/:348, the third home, now states SEEDED/CROWD and gives a reviewer the performer's rig
  tier), F-5 (figure-cap rename whole, in docs AND both engines' messages), F-6 (all six cap rows +
  the closing line + a scope clause), F-7 (spec's non-goal records its own supersession), F-8 (plate
  law widened AND lint enforces it), F-9 (demotion ban folded to one sentence).
- **Vocabulary sweep is complete.** `grep -rniI everyman` over `orgs/faceless-youtube` returns only
  dated scratchpad records, a stale `.pytest_cache`, and one unrelated English use in
  `example-scripts.md`. No live file states the two-tier law, "cast-cap", or "never appears in videos".
- **Lint now counts a performer everywhere it must, and nowhere it must not** — plate, delta entrance,
  interaction, seat/support, two-figure presence all see `base`; `semantic_cast_check` excludes it by
  name. `BASE_TEMPLATE` mirrors forge's constant on both engines.
- **Blast radius re-measured, not trusted:** lint over the live 248-shot `shots.json` → **3 HARD
  (the three known >2-delta chains) + 13 heads-up**, identical to the pre-wave baseline. The live file
  names `` `base` `` zero times and no `fig-base--*` card is staged, so A-1's key change orphans
  nothing and re-mints nothing.
- **Named-cast keys are byte-identical to the pre-2026-08-06 shape** (`fig-miniscribe-rep--sit--
  expr-worried` on a live-file smoke), so no existing library card is invalidated by either fix.
- **`costume_clause` robustness:** it cannot return empty while a performer is cast unless the shot's
  ONLY `base` sentence is bare control tokens AND is also the opening sentence (then the card carries
  no dress clause and the template default stands — the corner A-2's new wording now covers honestly).
  Backtick tokens and quoted literals are stripped before the prose reaches a payload; the dress clause
  sits before the "no scenery, no props, no furniture" fence. Sentence splitting is naive about
  abbreviations ("Mr. Smith"), which can only widen the clause, never narrow it — not charged.
- **Retry path is consistent:** `_retry_step1` re-mints dressed from the same source prompt and the same
  reader, so a re-mint cannot lose the costume. (Its card NAME is human-supplied and unvalidated — a
  pre-existing property of the retry overlay, unchanged by this delta.)
- **Place diversity is the approved minimum:** one grammar sentence (§1 chain logic, departure-default)
  + one plan-level critic finding that explicitly says "impose no cap or place count". No numeric cap,
  no new lint check, no new field anywhere.
- **Tests pin the law, with one exception I corrected.** `test_two_eras_on_one_recipe…` asserted reuse
  *by place* — an implementation detail that passes under the wrong law (its "same place → shared" case
  happens to restate the same dress). It now asserts the place-prefixed stem plus reuse under an
  identical dress, and the collision case has its own test. Everything else re-pins at equal strength:
  no assertion deleted, no `skip`/`xfail`, and the one new lint guard
  (`test_a_seeded_performer_counts_as_a_figure_everywhere_but_semantic_cast`) pins the tier in both
  directions.

## Test counts (run by me, after every edit)

```
$ python -m pytest image-generation/scripts visual-prompt-writer/scripts -q
463 passed in 3.24s          (delta as received: 462 — my regression test is the 463rd)
$ python test_stage_check.py → PASS test_stage_check      (0 collected under pytest by design)
$ lint_shots.py <live 248-shot shots.json> → 3 HARD / 13 heads-up (baseline, unchanged)
```

## Files I changed under review authority

`forge.py` (key derivation + `costume_key` rename + two docstrings), `test_forge_seed_requirement.py`
(2 tests re-pinned to the law, 1 added), `lint_shots.py` (dead pointer, one docstring),
`visual-grammar.md`, `image-generation/SKILL.md`, `VPW SKILL.md`, `shots-schema.md`,
`specs/2026-08-06-crowd-expression-restaging-design.md` (key shape + the A-2 wording, word-consistent
across all five), `forge-costume-fix-report.md` (§2 marked superseded, per its own dated-record
convention). No commit. `shots.json` untouched (`git status` clean on it).

## A-3 — CLOSED 2026-08-06

**Decision (the boss, not a reviewer):** option (a) from the escalation above — narrow the law to at
most ONE seeded performer per shot. The foreground cap stays ≤2 (two named cast, or one named + one
performer, or one performer alone). A beat wanting two anonymous performers is restaged: promote one to
named cast via the registry, or stage it as crowd/mass action. Option (b) (performer identities,
`base`/`base-2`) and option (c) (refuse-loudly-decide-later) were not taken.

**Doctrine swept, word-consistent** (`` `base` `` named at most once per shot; the engine has one name
for the whole tier so it cannot address two distinct performers; restage remedy = promote to named cast
via the registry, or stage as crowd):
- `visual-kit/visual-grammar.md` — SEEDED PERFORMER definition (one-performer sentence), the foreground
  cap bullet, and the cap table's closing paragraph (which "2 figures" combos are legal).
- `.claude/skills/image-generation/SKILL.md` — the SEEDED/CROWD tier paragraph.
- `.claude/skills/visual-prompt-writer/SKILL.md` — the seeded-performer authoring step.
- `.claude/skills/visual-prompt-writer/references/shots-schema.md` — the interaction-template law's
  "exactly 2 SEEDED figures" clause, and the "Casting is PROSE" declaration block.
- `docs/superpowers/specs/2026-08-06-crowd-expression-restaging-design.md` — change-6's cap-scope line.
- `style-bible.md` — checked, no numeric performer-cap statement lives there; no edit needed.
- Grepped the whole worktree for `performer`/`in any mix`/`2 seeded figures`/`figure-cap` after the
  sweep; the only remaining "2"/cap mentions are the unrelated foreground-cap VALUE (unchanged at 2) and
  dated scratchpad records (`b-window-adversarial.md`, `fix-design.md`, `fixwave-report.md`,
  `doctrine-window-report.md`), left alone per this project's own dated-record convention.

**Engine guards added, same mechanism, no new function in forge:**
- `forge.py::seeding_law_violations` — extended the existing `for c, prims in cast:` loop (the SAME
  cluster the bare-`base` refusal lives in) with a new `c == BASE_TEMPLATE` branch: counts raw
  `` `base` `` backtick occurrences in the shot's authored prose via `_BACKTICK_RE`; more than one is a
  hard violation naming the one-seeded-performer law, before the bare-base check runs. `shot_cast`'s and
  `BASE_TEMPLATE`'s docstrings updated from "two laws" to "three laws".
- `lint_shots.py` — new `seeded_performer_singleton_check(label, objs, hard)` (mirrors
  `interaction_cast_check`'s shape), wired into both the long-form and every short's check sequence
  beside `interaction_cast_check`. Same detection (raw `` `base` `` backtick count via `_BACKTICK` >1)
  and word-identical remedy clause to forge's message ("Promote the second to named cast via the
  registry, or stage it as crowd.").
- Detection is a raw backtick-count on the shot's own prose, not a primitive-kind grouping: it needs no
  registry-kind lookups (asset `kind` for pose/action is inconsistent — some named `action-*`, some bare
  like `sit`/`facepalm` — so a prefix or kind-based signal would be engine-asymmetric), it is decidable
  from the same text both engines already parse, and it matches the schema's own authoring law ("the
  registry character `` `base` `` named inline" — singular).

**Tests (pin the new refusal, extend existing files, no new test files):**
- `image-generation/scripts/test_forge_seed_requirement.py` —
  `test_two_base_castings_in_one_shot_are_refused_not_silently_collapsed` (fresh AND delta shapes,
  plus a negative confirming the single-performer path is untouched).
- `visual-prompt-writer/scripts/test_doctrine_reset_guards.py` —
  `test_a_shot_may_name_base_at_most_once_two_castings_hard_refused`, placed directly after
  `test_a_seeded_performer_counts_as_a_figure_everywhere_but_semantic_cast` (the existing
  seeded-performer-tier lint test), same file the tier's other lint test already lives in.

**Test counts, run after every edit:**
```
$ python -m pytest image-generation/scripts visual-prompt-writer/scripts -q
465 passed in 4.48s          (baseline 463 + 2 new: one per engine)
$ python test_stage_check.py → PASS test_stage_check
$ lint_shots.py <live 248-shot shots.json> → 3 HARD / 13 heads-up — UNCHANGED from baseline
```
The live file names `` `base` `` zero times (confirmed by direct scan, `count: 0`), so the new guard
fires nowhere on it — the lint delta from this change is exactly 0.

**Files touched:** `visual-grammar.md`, `image-generation/SKILL.md`, `visual-prompt-writer/SKILL.md`,
`shots-schema.md`, `specs/2026-08-06-crowd-expression-restaging-design.md` (doctrine); `forge.py`,
`lint_shots.py` (engines); `test_forge_seed_requirement.py`, `test_doctrine_reset_guards.py` (tests).
No commit; `shots.json` untouched.
