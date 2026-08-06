# forge costume fix — the seeded performer's card is dressed (2026-08-06)

Closes the one engine gap the doctrine fix-wave handed back (`fixwave-report.md` §6): `forge.py`
minted a STEP-1 card with no costume, on a reuse key with no costume dimension, so a performer's era
dress reached the figure only as loose prose in the scene — the exact bleed the attribute-routing law
names, and two eras on one pose/expression recipe collided on one card.

## 1. Costume source decision

**Source: the shot's own `still_prompt` prose — the opening era sentence plus the sentence that names
the figure. Reuse-key dimension: the shot's `place` (forge's existing ONE seeding key,
`place or stage or id`).** No new shot field; none was needed and none would have been legal.

Why this source:

- **There is no era or costume field in `shots.json`, by design.** `shots-schema.md §2`: "Casting is
  PROSE, by vocabulary name… there are no structured cast/pose/expression arrays." Dress is authored
  the same way. The registry `costume` field exists only for NAMED cast (a pinned canonical outfit);
  `base` deliberately has none, which is why the performer tier has this problem at all.
- **It is the same source a place plate takes its era from.** A plate is just the place's first
  generated shot: its era comes from its own prose, it is minted once, and every later shot in that
  place inherits it in pixels. The performer's card is the figure-side plate, so it reads the same
  prose and keys the same way — one card per (pose, expression) per place, re-minted the moment the
  shot moves to a place the card was not dressed for.
- **The SENTENCE is the binding scope** because that is the scope the authoring side already binds
  figure facts to (`lint_shots.py`'s seat/support law: the support must be named "in the SAME
  SENTENCE" as the pose). The prompt's opening sentence rides along because that is where a shot
  states its decade ("A cramped 1985 plant floor.") while the figure's own sentence usually states
  only the garments.
- **Scoped to the performer.** A named character's costume is carried by its own canonical seed, so
  its card is costume-invariant: its key is byte-identical to the pre-fix shape (no re-mint of any
  existing library card, no cost inflation) and its payload authors no dress clause.

Two things are stripped before the prose reaches a card payload: backticked control tokens (the card
already carries those seeds as images) and any quoted literal (a reference sheet that draws lettering
bleeds that lettering into every scene seeding it — deletion is a harder guard than negative prose).
The dress clause sits BEFORE the payload's "Flat solid pale-grey studio backdrop, no scenery, no
props, no furniture", which is the fence against the setting words it quotes.

> **Superseded 2026-08-06 by `fixwindow-adversarial2.md` (A-1):** keying the card on the PLACE alone
> collided inside one place — a labourer and a barrister in the same courtroom share a pose and an
> expression, so the second silently wore the first's clothes. The key now carries a digest of the
> authored dress (`…--<place>-<dress digest>`), and the spec item's field is `costume_key`. §1's
> costume SOURCE (the prose) is unchanged and still current; §2's key shape below is history.

## 2. Key shape before → after

```
before   fig-<char>--<pose>--<expr>                      (every figure)
after    fig-<char>--<pose>--<expr>                      named cast — UNCHANGED
         fig-base--<pose>--<expr>--<place>               seeded performer — costume dimension
```

Distinct places → distinct cards; the same place again → reuse (`why`: "STEP-1 … shared"). The
component is a slug of the seeding key, so a place-less shot falls back to its stage and then to its
own id and still yields a legal filename stem.

## 3. Files touched

- `.claude/skills/image-generation/scripts/forge.py` — new `costume_clause` (the prose reader);
  `figure_frame_name` takes a 4th `costume` component; `figure_card_payload` takes the dress clause
  and authors it into the card; `cmd_batch` derives `costume_key` beside `place`, passes both for
  `base` only, records the key in `why` and on the scene item; `seeding_law_violations` names the
  costumed card in its "expected" message; `_retry_step1` mints its re-mint dressed the same way;
  `seed_roles_text`'s performer-card prose now says the scene carries the card's costume (it used to
  order a re-dress, which is the bleed the law forbids); the base-canonical clause and the
  `FIGURE_PREFIX` / two-step comments restated to match.
- `.claude/skills/image-generation/scripts/test_forge_seed_requirement.py` — 3 new tests, 2 updated.
- `.claude/skills/image-generation/scripts/build_review_artifact.py` — `figure_character` docstring:
  the key's 4th component, and why reading component 0 is still correct.
- `.claude/skills/image-generation/scripts/stamp_review.py` — figure-verdict store key shape.
- `.claude/skills/image-generation/SKILL.md` — two-step seeding bullet (the performer's key + where
  its costume comes from) and the verdict-store record line.
- `.claude/skills/visual-prompt-writer/SKILL.md` — the authoring rule this makes load-bearing: write
  the era clothing in the SAME SENTENCE that names `` `base` ``, or it never reaches the card.
- `.claude/skills/visual-prompt-writer/references/shots-schema.md` — performer-declaration bullet:
  key shape + the prose-is-the-costume-field rule.
- `channels/the-second-take/visual-kit/visual-grammar.md` — dated engine-gate line DELETED (its
  delete-when-closed contract), replaced by one sentence of mechanics inside the same bullet.
- `docs/superpowers/specs/2026-08-06-crowd-expression-restaging-design.md` — change 6's "Open engine
  work" item closed, naming the mechanism.
- `videos/2026-07-28-bricks-fresh/scratchpad/fixwave-report.md` — §6 heading marked closed here.

## 4. Consumer sweep

Grepped the whole worktree for `fig-`, `figure_frame_name`, `figure_card_payload`, `<pose>--<expr`,
`char>--<pose`, and the old costume statements:

- `build_review_artifact.py::figure_character` splits on `--` and takes component 0 — correct
  unchanged; docstring updated.
- `stamp_review.py` / `SKILL.md` / `shots-schema.md` / `visual-grammar.md` state the key shape in
  prose — all updated word-consistently.
- No parser anywhere splits the key past component 0; `_is_figure_frame` matches by prefix and the
  law's primitive check is a substring test, so both are indifferent to the new component.
- Stale statements of the old law ("payload authors no costume", "wears what THIS prompt authors",
  "no costume dimension") now survive only in the dated run records in this scratchpad
  (`forge-basecast-fix-report.md`, `fixwave-report.md` §6, which points here) — history, not contract.
- `docs/superpowers/plans/2026-07-1*.md` mention a RETIRED `<char>--<pose>--<expr>` library asset
  naming, not this key; left alone.

## 5. Tests

`python -m pytest image-generation/scripts visual-prompt-writer/scripts -q`

- baseline **459 passed** · after **462 passed**, 0 failed (both suites, one run).
- New (`test_forge_seed_requirement.py`):
  `test_two_eras_on_one_recipe_get_two_cards_and_one_era_reuses_its_own` (distinct costumes →
  distinct keys, each dressed from its own shot; same place again → one card, shared),
  `test_a_named_characters_card_key_carries_no_costume_dimension` (no re-mint for pinned-costume
  cast), `test_the_costume_clause_is_the_era_opener_plus_the_figures_own_sentence` (source, token and
  literal stripping, and the empty case).
- Extended: `test_a_performer_batch_mints_its_step1_card_and_is_never_cast_free` now pins the costume
  IN the card payload, the costumed key, the `why` record and the scene item's `costume`;
  the cast-free plate's spec-item equality gained `"costume": None`.
- Smoke: `cmd_batch` over the real 248-shot `shots.json` (scope L01/L26/L45) builds clean with
  `costume: None` and unchanged named-cast keys.
