# forge `base`-cast fix — making the seeded everyman executable

Scoped engine task in `kb-worktrees/boss-bricks-expression`, branch `claude/bricks-expression-restoration`.
Closes weakness 1 and weakness 3 of `doctrine-window-report.md` (the BLOCKER and the paired refusal text).
No generation call was made; forge ran only in dry/offline paths the test suite already uses.

---

## 1. INTENT ARCHAEOLOGY — what `and n != "base"` actually guarded

**Provenance.** `git log -L 461,473:forge.py` returns exactly ONE commit: `6735796`
("fix-wave(bricks-fresh): seeding law + forge batch, two-tier authoring law, plate abolition"),
which introduced `shot_cast` whole-cloth, exclusion included. There is no earlier form and no
commit that ADDED the exclusion to a working function — so there is no bug-fix story behind it and
no comment explaining it. `git log -S'!= "base"'` shows the same commit is the only one in
`orgs/faceless-youtube/` to have touched that predicate.

**The intent, reconstructed from what the commit shipped.** `6735796` is the commit that abolished
the unseeded anonymous-foreground tier and installed the two-tier law (NAMED CAST | CROWD). Under
that law `base` was not a figure tier at all. It is in `characters` for one mechanical reason —
Pass-1 asset builds resolve `--character base` → `refs/base/base.png` (`Kit.base_frame`,
`cmd_register`'s `character` default) — and the registry says so in its own words:

```json
"base": { "role": "BASE TEMPLATE / rig anchor — not an on-screen character; seeds the cast for form.", ... }
```

style-bible §1 states the same law for humans: "the ANCHOR every cast character seeds off for form,
and **it never appears in videos**". So the exclusion was a guard, and its genuine content is:

> **the bare template must never enter a scene as a cast identity.**

That is real and it is still law. What the exclusion got wrong is only its METHOD: it enforced the
law by silently deleting the name. Post-ratification that same silence blocks a route doctrine now
requires — the everyman resolved to `[]`, minted no step-1 card, seeded nothing, raised nothing, and
then measured `cast_free`, so §5's style tile was derived onto a figure-bearing frame. A guard that
is indistinguishable from a bug is the parent-fallback defect class already logged in `decisions.md`.

**Two concrete routes by which the bare template would enter a scene** (both found before editing,
both now closed, neither mentioned in the doctrine map):

1. **A `base` named with NO card.** `figure_frame_name("base", None, None)` → `fig-base`, whose
   step-1 recipe is just the canonical: the bald cream figure in the template's default hoodie,
   rendered as itself. Doctrine's everyman is seeded "THROUGH the `expr-`/`action-` vocabulary the
   beat needs" (visual-grammar §2) — a cardless `base` is not an everyman, it is the template.
2. **Seed-role prose.** `seed_roles_text` tells the provider a `canonical` seed is where "identity,
   head tone, hair and the **pinned costume** come from", and a `figure` seed is one to "carry that
   figure's **identity, costume**, pose, hands and expression exactly". Applied to `base` — as a
   delta beat's canonical, or as the `fig-base--…` card entering a scene — that is a direct order to
   keep the brown hoodie in a shot whose prose dresses the everyman for its own era. It would have
   defeated the exact doctrine sentence this fix exists to make executable ("**always dressed in the
   shot's own era and setting in prose** — the base template never renders as itself").

The fix therefore keeps the guard and changes where it lives: **decidable and LOUD, in the seeding
law and in the provider prose, instead of silent, in the parser.**

**Not a guard, and left alone:** `lint_shots.py::video_chars` carries the mirror line
`chars.discard("base")`. It is a separate exclusion in a different engine with a different blast
radius — see weakness 1.

---

## 2. THE DIFF

Five hunks in `forge.py`, one in `lint_shots.py`, one deletion in `visual-grammar.md`, tests in two
files. Nothing else. (The branch's working tree also carries the earlier doctrine-window worker's
uncommitted edits to `SKILL.md`, `critics.md`, `test_stage_check.py` and the rest of
`visual-grammar.md`; those are not mine and were not touched.)

### `forge.py`

1. **`BASE_TEMPLATE = "base"`** — new constant beside `FIGURE_PREFIX`, with the two-law comment: the
   template resolves as a figure, and is held to (a) a card requirement and (b) form-only seed prose.
2. **`shot_cast`** — the fix itself:
   ```diff
   -        if n in chars and n != "base":
   +        if n in chars:
   ```
   plus a docstring paragraph recording what the exclusion enforced and where that intent moved, so
   the next reader cannot mistake the removal for a loosening.
3. **`seeding_law_violations`** — the guard, at $0, ahead of the `no_hands`/delta/fresh branches:
   ```python
   if c == BASE_TEMPLATE and not any(_split_primitives(k.reg, prims, omitted)):
       bad.append(f"{name}: `base` is the shared RIG TEMPLATE, not a character — a seeded everyman
                    authors it WITH the `expr-`/`action-` card(s) the beat needs. …")
   ```
   `cmd_batch` runs `preflight_batch` over its own output before writing the spec, so a cardless
   `base` refuses the whole slate before any API call and no spec file is written.
4. **`seed_roles_text`** — two base-specific branches ahead of the generic ones. `figure` →
   "the seeded EVERYMAN's STEP-1 rig card … an ANONYMOUS figure, not a recurring identity, and it
   wears what THIS prompt authors for the era and setting, never the card's own default outfit".
   `canonical` → "the shared BASE RIG template … NOT an identity and not a costume: the figure wears
   what this prompt authors, and the template's plain default outfit only where the prompt authors
   none". The clothing clause is deliberately written to be TRUE in both places it is reached: the
   step-1 card build (whose payload authors no costume, so the template's default stands) and a
   scene delta (whose prose does, and wins). Named-cast prose is byte-unchanged.
5. **`figures.anon_foreground` refusal** — third remedy added (below).

### `lint_shots.py`

One hunk: the same third remedy, in the same order, in `figures_check`. The two engines' remedy
clause stays word-identical, per that function's own comment ("stated identically here so lint never
hands the author a second, different fix"):

> name the figure in the video's cast (seeded), author a story-bearing anonymous one as a seeded
> everyman (`` `base` `` plus its `expr-`/`action-` cards), or stage the people at crowd scale
> (crowd exemplar).

### `visual-grammar.md`

The dated engine-gate italic is DELETED (3 lines, §2 tier bullet). The route is executable, so the
line is now false; nothing replaces it.

### Downstream verified, not assumed

* **`cast_free`** (`cmd_batch`, the §5 style-tile derivation) reads `fig_roles or canon_roles or
  crowd or anon_declared`. A fresh everyman now fills `fig_roles`, a delta everyman `canon_roles`, so
  the shot measures NOT cast-free and the tile is not derived onto it. Asserted end-to-end over the
  real registry, including the negative (`"scene-style-tile" not in seeds`, `"STYLE TILE" not in why`).
* **Blast radius, measured rather than argued:** `shot_cast` old vs new over every `still_prompt` in
  every shots file in the repo — **2,669 shots across 35 files, 0 cast resolutions changed.** No live
  file backticks `` `base` ``, so nothing existing re-plans, re-seeds, or re-costs.
* **Behaviour probe** (the doctrine report's own three prompts, real registry):
  ```
  'A brick-yard clerk, `base`, `expr-worried`, `action-slump`, …' -> [('base', ['expr-worried', 'action-slump'])]
  'A brick-yard clerk, `expr-worried`, `action-slump`, …'         -> []
  '`macgregor`, `expr-smug`, stage-left.'                          -> [('macgregor', ['expr-smug'])]
  ```

---

## 3. TESTS

Six added, all in the existing style (plain asserts that also collect under pytest), all offline on
fixtures the suite already uses. Five in `test_forge_seed_requirement.py` (the seeding-law file, and
the file that already pins `shot_cast`), one pin extended in `test_new_guards.py`.

| Test | Pins |
| --- | --- |
| `test_the_everyman_resolves_base_as_a_figure_with_its_step1_recipe` | (a) `base` + cards → `[("base", ["expr-deadpan","action-armscrossed"])]`, and the step-1 name composes; (c) the old silent `[]` asserted OUT by name |
| `test_an_everyman_shot_owes_its_step1_card_exactly_like_named_cast` | the FRESH law demands `fig-base--action-armscrossed--expr-deadpan` and is satisfied by it |
| `test_a_delta_everyman_inherits_from_the_rig_template_plus_its_parent` | delta route: canonical + chain parent, same law as named cast |
| `test_a_bare_base_with_no_card_is_refused_as_the_rig_template` | the guard, on fresh AND delta |
| `test_the_rig_templates_seed_prose_claims_no_identity_and_no_costume` | base prose grants form only; `"pinned costume"` absent; named-cast prose unchanged |
| `test_an_everyman_batch_mints_its_step1_card_and_is_never_cast_free` | (b) end-to-end over the REAL registry: card generated from [canonical, expression, pose] with those roles, scene seeds the card, and **no style tile / no `cast_free`** |
| `test_g7_anon_foreground_…` (extended) | the refusal now offers THREE remedies and names the everyman route |

### Verbatim tails

Baseline in this worktree, before any edit — both suites:

```
$ python -m pytest .claude/skills/visual-prompt-writer/scripts/ .claude/skills/image-generation/scripts/ -q
........................................................................ [ 15%]
........................................................................ [ 31%]
........................................................................ [ 47%]
........................................................................ [ 63%]
........................................................................ [ 79%]
........................................................................ [ 95%]
....................                                                     [100%]
452 passed in 3.98s
```

After the fix — both suites, full:

```
$ python -m pytest .claude/skills/visual-prompt-writer/scripts/ .claude/skills/image-generation/scripts/ -q
........................................................................ [ 15%]
........................................................................ [ 31%]
........................................................................ [ 47%]
........................................................................ [ 62%]
........................................................................ [ 78%]
........................................................................ [ 94%]
..........................                                               [100%]
458 passed in 3.43s
```

452 → **458 = 452 + 6 added, 0 removed, 0 failed, 0 skipped.** Nothing was forced green; the only
red during the run was the real one described in weakness 2, and it was fixed at its cause.

The plain-assert file also run directly, per its own `Run:` header (its tail prints offline provider
errors on purpose — those are the live-gen failure-path fixtures):

```
$ python .claude/skills/image-generation/scripts/test_forge_seed_requirement.py
  == 0 generated, 1 failed, 0 skipped ==
  [1/2] first: ERR integrity seed SHA-256 changed before request assembly: …; aborting remaining batch
PASS test_forge_seed_requirement
```

---

## 4. WEAKNESSES (first, and honestly)

1. **`lint_shots.py::video_chars` still does `chars.discard("base")` — the engines now disagree about
   the everyman.** Forge resolves it; lint cannot see it. Consequences, all live: `place_plate_check`
   would NOT flag a plate that stages an everyman (the plate law's whole point is that a cast-bearing
   plate bleeds into every shot seeding it); C-7's entering/held cast walk, `two_cast_presence_check`
   and `semantic_cast_check` all skip everyman figures; and the ≤2 SEEDED-figure cap has no
   mechanical check on either side. **Deliberately not fixed here.** Un-discarding `base` changes the
   cast vocabulary of every check in that file against a live 248-shot `shots.json` that is already
   HARD-failing 3 chain-cap violations — a blast radius nothing in this brief measured, and the brief
   scopes lint to the refusal text. It is the natural next scoped task, and it should be measured the
   same way (old-vs-new over every shots file) before it lands.
2. **A test in the VPW suite was grading the WRONG CHECKOUT, and had been for as long as worktrees
   have been used here.** `test_new_guards.py` line 13 hardcoded
   `SCRIPTS = Path(r"C:\Users\danie\kb\orgs\…\scripts")`, an absolute path into the MAIN checkout, so
   from any worktree it imported main's `lint_shots.py`. My lint edit came back "green" against
   unchanged code, and the pin only failed because I had strengthened it in the same run. Fixed to
   `Path(__file__).resolve().parent` with the reason in a comment. Nothing else in either suite
   carries an absolute path (grepped). **The wider point is not fixed and is not mine to assert:** any
   worktree-based verdict on that file before today graded main, so a "green" recorded for a
   lint_shots change made in a worktree proves nothing.
3. **The orphan-primitive silent discard is untouched.** `` `expr-worried` `` with no preceding
   character name still resolves to `[]` (`elif cast and …`), exactly as the doctrine report measured.
   Doctrine requires the author to backtick `` `base` `` explicitly, so this is not on the everyman
   path — but it is the same fail-silent shape, and inferring `base` from an orphan primitive was
   REJECTED on purpose: it would silently promote existing crowd/prop shots that name a primitive into
   figure shots that mint a paid step-1 card.
4. **`_is_canonical` is loose for `base` specifically.** Its first test is
   `f"/refs/{character}/" in path`, and EVERY `expr-*`/`action-*`/`pose-*` asset plus
   `crowd-exemplar.png` lives in `refs/base/`. So for character `base`, any of those satisfies "carries
   its canonical" in the delta law and in `seed_role_violations`' truthfulness check. Unreachable
   through `cmd_batch` (the walk always appends the real canonical), reachable in a hand-authored
   slate. Not tightened: the `/refs/<char>/` rule is what makes every other character's canonical
   resolve, and narrowing it is a change with its own blast radius.
5. **The costume inheritance is still unproven in pixels** — unchanged from the doctrine report's
   weakness 4, and my prose edit is an argument, not evidence. The step-1 card renders "the character
   alone, fully resolved" from `base.png` (bald, cream, brown hoodie); the scene then has to re-dress
   it from prose with the card in the slate saying "never the card's own default outfit". That
   instruction is now explicit where before it was absent-or-contradicted, but whether the provider
   obeys it is a question only a gen answers. **First everyman frames are a probe, not production.**
6. **No test asserts the two engines' refusal strings are byte-identical**, because lint's suite
   cannot import forge. The pairing is held by a comment in each file plus this report; a future
   editor can still drift one. A cheap fix exists (a shared literal in a data file both read); it was
   out of scope.
7. **Zero generation evidence.** Everything here is static: parser, seeding law, prose text, and a
   dry `cmd_batch`. The everyman route is now proven to MINT and SEED correctly. Whether it RENDERS
   an anonymous era-dressed person on the rig is unmeasured.
