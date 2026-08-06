# Doctrine fix-wave report — B-window findings + performer tier + place diversity

Worktree `kb-worktrees/boss-bricks-expression`, branch `claude/bricks-expression-restoration`
(base HEAD 27bc7e2). 15 files changed, no commit, no `shots.json` touched.
Line numbers below are POST-edit.

## 1. The ten adversarial findings — all closed

| # | Where | What changed |
| --- | --- | --- |
| F-1 MINOR | `visual-kit/style-bible.md:15` | "it never appears in videos" → "**it never appears as ITSELF** — a performer staging always re-dresses it (tier bullet below)"; the absolute is now scoped where the law lives. |
| F-2 MINOR | `visual-prompt-writer/SKILL.md:89` | Pointer trimmed to "Tier law: `visual-grammar.md §2`" — the reference to the deleted engine gate is gone. |
| F-3 MAJOR | `image-generation/SKILL.md:15, 150-156, 348` | ":15 "cast/crowd tiers" → "seeded/crowd tiers"; :150 "Two tiers only…" replaced by the SEEDED (named cast · seeded performer) / CROWD statement with the mint-then-seed route, keeping the `anon_foreground` refusal (now three remedies); :348 post-gen rubric gained "seeded performer → FULL rig, against its own STEP-1 card and the `base` canonical — never the template's default outfit". |
| F-4 MINOR | `lint_shots.py:1256`, `forge.py:679` | Both refusals already stated three remedies (the forge fix landed with the B window); wording swept to "seeded performer" so both engines read word-identical. |
| F-5 MINOR | `VPW SKILL.md:80`, `shots-schema.md:142` (+ `forge.py:635`, `lint_shots.py:1991, 2019`) | "cast-cap" → "figure-cap" everywhere the table is named — the rename is now whole, in docs AND in both engines' messages. |
| F-6 MAJOR | `visual-grammar.md:195-210` | Cap table re-scoped: one clause under the header ("*Figure* in the rows below is any seeded figure: a performer occupies a row identically to named cast") **and** the noun substituted in all six rows and the closing "a fresh two-figure shot is the BASE of a stage" line. |
| F-7 MAJOR | `specs/2026-08-06-crowd-expression-restaging-design.md:88-104, 116-119` | New "### 6. Seeded performer tier" change section states the locked design (three tiers, mint-first, attribute routing, cap scope widened, homes, open engine work); the non-goal line no longer forbids the wave's largest edit — it now reads "No change to the foreground cap's VALUE (2) or to the seeding law's mechanism. The two-tier authoring law itself IS changed — see change 6", with the superseded wording recorded. §2's "≤2 named/foreground figures" → "≤2 seeded figures per shot". |
| F-8 MAJOR | `shots-schema.md:66` (+ `VPW SKILL.md:169`, `lint_shots.py` `place_plate_check` docstring + message) | "zero named cast" → "**zero SEEDED figures (named cast or performer)**", and lint now actually enforces it (see §2). |
| F-9 MINOR | `visual-grammar.md:172-176` | The doubled demotion ban folded into one sentence ending "— the seeded performer is that beat's fallback, never crowd scale". |
| F-10 MINOR | `visual-kit/style-bible.md:26-30` | The "which is how … hold at once" justification clause deleted; the bullet states values only, as every other bullet in the LOCKED bible does. |

## 2. The locked performer design, written into doctrine

Daniel's locked design is now the text in all five homes
(`visual-grammar.md:151-194`, `style-bible.md:15, 24-30`, `image-generation/SKILL.md:150-156, 348`,
`VPW SKILL.md:85-89`, `shots-schema.md:179-189`), word-consistent:

- Three tiers — NAMED CAST · SEEDED PERFORMER · CROWD — no promotion path.
- A shot wanting a foreground performer **mints it first**: one STEP-1 card off the `base` rig wearing
  THAT scene's era costume and THAT beat's `expr-`/`action-` cards, rig-checked at card cost; the scene
  then seeds that card, two-step, exactly as named cast does.
- **Attribute-routing law** stated once, in the grammar: any attribute not carried by the figure's own
  seed bleeds a base trait, so costume and expression live IN the card, never as loose prose over a bare
  `base`. The template never renders as itself; forge refuses a bare-`base` slate by name.
- Cards recorded in the VIDEO's own Pass-1 library; `registry.json` only where the character recurs.
- Cap unchanged at 2, scope = any seeded figure, crowd uncapped and background-only.

**Vocabulary decision:** the tier is named **"seeded performer"** throughout, replacing the B window's
"seeded everyman" — swept in every live home plus `forge.py`, `lint_shots.py`, and the three test files
that quote their messages, so no file states the law in the older word. Rationale: the locked design's
own noun, and "everyman" (generic figure) no longer describes a per-shot minted character carrying its
own era costume.

**Where the brief's "figures.json" landed:** no such file exists in the pipeline, and inventing one would
be a new vocabulary. The video-local figure record that already exists is the Pass-1 library
(`assets/library/manifest.json`) — the same file `forge.py merge_vocabulary` and lint's `video_chars`
read — so doctrine names that.

## 3. Item 2 — lint sees the performer tier

**Schema decision (matches forge reality, no new field):** a shot declares a minted performer exactly as
it declares any figure — the registry character `` `base` `` named inline in `still_prompt` plus the
`expr-`/`action-` slug(s) the beat needs. That recipe IS what `forge.py::shot_cast` resolves (it stopped
excluding `base` on 2026-08-06) and what `figure_frame_name` mints as `fig-base--<pose>--<expr>`. Written
into `shots-schema.md:179-189` under the existing "Casting is PROSE" bullet — no parallel vocabulary, no
new key, `FIGURES_KEYS` / `_FIG_KEYS` untouched.

Lint changes (`lint_shots.py`):
- `video_chars` (:2186-2214) no longer discards `base`; docstring re-scoped to the "seeded-figure
  vocabulary" and states why, plus the one exception.
- New module constant `BASE_TEMPLATE = "base"` (:2170-2172) mirroring forge's, used by the exception.
- `semantic_cast_check` (:2383-2386) filters `base` OUT: its subject is casting a NAMED identity on a
  generic beat, and an anonymous performer there is the doctrine's fix, not the defect. Every other
  figure-reading law now counts a performer: `place_plate_check` (plate = zero seeded figures),
  `delta_entrance_check`, `interaction_cast_check` (2 seeded figures in any mix — matching forge's own
  `len(cast) < 2`, which counts `base` today), `seat_support_check`, `two_cast_presence_check`.
- Messages/docstrings re-worded so lint and forge state the same law in the same words
  ("seeded figure(s)", "two-figure", "figure-cap", "figure count against `SEED_CAP`").

Blast radius measured on the live 248-shot `shots.json`: **unchanged** — 3 HARD (the three known
over-cap chains) and 13 heads-up, identical to before the change, because the current file names no
`base` yet. The new laws bite on the coming regen, not retroactively.

## 4. Item 3 — place diversity (minimal, as approved)

- `visual-grammar.md:81-84` (§1 chain logic, where invention/chain law lives): "**Where the beat leaves
  the staging open, DEPARTURE is the default:** prefer the staging that leaves the current place, and let
  lingering there be a choice the beat earns — re-using a place because it is already established is how
  a video collects long single-set runs."
- `critics.md:112-115`: plan-level finding "**Place monotony**" added beside Cadence taste / Stage
  grouping, same register — names the span and the beat that should have left, "impose no cap or place
  count". No numeric cap, no lint check, no new field.

## 5. Tests

Both suites run from the worktree, after every edit:

```
orgs/faceless-youtube/.claude/skills/image-generation/scripts   $ python -m pytest -q  → 206 passed
orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts $ python -m pytest -q → 253 passed
                                                                 $ python test_stage_check.py → PASS
```

**459 passed, 0 failed, 0 skipped** (baseline at 27bc7e2 was 458 = 206 + 252). `test_stage_check.py`
collects 0 tests under pytest by design — its asserts run at import — so it was also run directly.

Re-pins, all at equal-or-greater strength, none weakened:
- `test_doctrine_reset_guards.py:960` — `video_chars` now keeps `base` (the pre-fix pin asserted the
  drop that made lint blind); comment states the new law.
- `test_doctrine_reset_guards.py:965-991` — **new** guard
  `test_a_seeded_performer_counts_as_a_figure_everywhere_but_semantic_cast`: a `base` performer HARD-fails
  the plate law and the delta-entrance ban, and is silent in `semantic_cast_check`. (This is the one test
  added; it pins the item-2 fix in both directions.)
- `test_round2_guards.py:358`, `test_forge_interaction_and_lettering.py:174` — interaction message
  "1 named cast" → "1 seeded figure(s)" (same assertion shape, same count).
- `test_forge_place_and_gates.py` ×2 + `test_forge_seed_requirement.py` ×1 — seed-cap refusal now names
  "figure count" / "seeded-figure seed(s)" because `base` is a figure seed; assertions otherwise identical.
- `test_forge_seed_requirement.py` — everyman→performer identifiers, docstrings and the `seed_roles_text`
  assertion ("seeded PERFORMER").

## 6. Not closed — one item, handed back  → CLOSED 2026-08-06 (`forge-costume-fix-report.md`)

**The engine does not yet mint a costumed card.** `forge.py::figure_card_payload` authors no costume, the
reuse key `fig-<char>--<pose>--<expr>` carries no costume dimension (two performers in different eras and
the same pose/expression recipe would share one card), and `seed_roles_text` tells the provider the base
figure "wears what THIS prompt authors". So the locked attribute-routing law is doctrine-true and
engine-partial today: the era costume still reaches the figure through the scene prompt.

Handled the way the B window handled its own gap and the reviewer accepted: **one dated, delete-when-closed
italic line inside the bullet whose rule it qualifies** (`visual-grammar.md:166-169`), plus a line in the
spec's change 6. It is queued engine work (card payload + reuse key + card-level costume record), not a
doctrine question. Nothing else from the fix list is open.
