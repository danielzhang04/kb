# Fix worker F4 — place-owner review row (2026-08-04)

Worktree `kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`. Edits only, no
commit. Files touched (sole ownership, nothing outside it):

- `.claude/skills/image-generation/scripts/build_review_artifact.py`
- `.claude/skills/image-generation/scripts/test_build_review_artifact.py`

**Suite: 162 passed** (`py -3 -m pytest -q` in `image-generation/scripts`), baseline 155 → +7 net.
`test_build_review_artifact.py` alone: 26 → 33 (5 old tests removed outright, 1 rewritten test
replaced by 6, 6 new tests added for the two new helpers) — `py -3 test_build_review_artifact.py`
also green standalone (33/33).

## Closes R1-M3 / R2-M2 (row half) / R2-M3

The place-owner review row was inverted: `applicable_invariants` fired it when
`owner_branding_declared(shot)` — a heuristic scanning `still_prompt` for ANY quoted,
proper-noun-shaped literal — was true for **that shot's own prompt**. That fires on every branded
shot that happens to quote something (never necessarily the plate) and stays silent on exactly the
plate that forgot the owner cue, because a forgotten cue quotes nothing to scan. Daniel's failure
#6 (ownership invisible on the establishing frame) was the case the filter suppressed.

**Why this was safe to narrow, not just re-key:** F2 (prior fix worker) landed `place_owner` as a
real, lint-enforced field. `lint_shots.py::place_owner_check` now HARD-fails a place whose plate
declares neither `place_owner` nor `owner_ambiguity`, HARD-fails declaring both, and HARD-fails any
shot OTHER than the plate declaring either field. The missing-declaration failure mode is closed at
$0 by lint now. This file's job narrows to what only a human eye can verify: is the declared cue
actually **legible in the rendered frame**?

## Change

- **Deleted** the old inverted trigger: `owner_branding_declared()`, `_QUOTED`, `_TRACKABLE_LITERAL`
  (the copied, lookbehind-bearing quoted-proper-noun regex pair) and their explanatory comment
  block. Nothing re-infers a decision from prompt text any more — the field is read directly.
- **Added** `owner_literal_by_place(shots)` — one pass over the video's shots building
  `place -> declared place_owner literal`. Only shots with a non-empty string `place_owner` and a
  non-empty `place` contribute an entry. A place that instead declared `owner_ambiguity` (or
  neither, pre-lint) contributes nothing, so no row can fire anywhere in it.
- **Added** `_quotes_literal(prompt, literal)` — true if the (already-known) literal appears
  wrapped in any of the project's four quote-character pairs (straight `'…'`/`"…"` and curly
  single/double `'…'`/`"…"`) inside
  `prompt`. Because the literal being searched for is fixed in advance (read from the field, not
  inferred from text), none of the possessive-apostrophe ambiguity the deleted heuristic existed to
  guard against applies — there is nothing to mis-parse when the target string is already known.
- **Rekeyed** `applicable_invariants` (now takes an `owner_of` map, default `{}`): the `place-owner`
  row fires on a shot when its declared `place` has an entry in `owner_of` AND either
  (a) the shot itself carries that `place_owner` value (it is the plate that declared it), or
  (b) the shot's own `still_prompt` quotes that literal (`_quotes_literal`) — a delta/chain shot
  redrawing the plate's established cue, the L-1 carry `carried_literal_check` enforces on the lint
  side. No row on an `owner_ambiguity` place (no literal exists to check legibility of) and no row
  on a shot in a branded place that doesn't carry the literal either way.
- `collect()` now builds `owner_of = owner_literal_by_place(S.values())` once per video and threads
  it into `applicable_invariants`.
- `INVARIANTS`'s static `place-owner` entry was **removed** (not left dead): the question text is
  now built per shot from the literal, so a second static copy of the same fact would just drift.

**Exact row-question text:** `owner cue '<LITERAL>' legible in frame per L-1?` — e.g. for a plate
declaring `place_owner: "Widget Hall"`, the row reads `owner cue 'Widget Hall' legible in frame per
L-1?`.

## Tests

**Removed (inverted-behavior tests, no longer true of the new mechanism):**
- `test_the_possessive_guard_and_length_bound_are_actually_load_bearing` (asserted the deleted
  `_QUOTED` regex and `owner_branding_declared`'s possessive-guard behavior)
- `test_owner_branding_declared_quoted_trackable_literal_in_still_prompt`
- `test_owner_branding_declared_ambiguity_call_counts_even_if_false`
- `test_owner_branding_declared_false_when_nothing_recorded`
- `test_place_owner_needs_place_and_a_recorded_decision` (asserted the inverted trigger: any
  `owner_ambiguity`/quoted-literal anywhere on the shot's own entry was suf­ficient)

Also trimmed from the drift-canary `_MIRRORED_DEFINITIONS` tuple: `_QUOTED = ` and
`_TRACKABLE_LITERAL = ` (the byte-identical-copy check that pinned the now-deleted regexes against
`lint_shots.py`). `_BACKTICK = ` / `SEATED_PRIMITIVE = ` (C-7's seated signal, untouched by this
fix) remain pinned.

**Added (12, proving (a)/(b)/no-row):**
- `test_owner_literal_by_place_reads_the_declared_field`
- `test_owner_literal_by_place_empty_string_or_missing_contributes_nothing`
- `test_owner_literal_by_place_owner_ambiguity_contributes_no_entry`
- `test_quotes_literal_matches_any_of_the_project_quote_styles`
- `test_quotes_literal_false_when_unquoted_or_a_different_literal`
- `test_place_owner_fires_on_the_plate_that_declared_the_literal` — case (a)
- `test_place_owner_fires_on_a_later_shot_that_redraws_the_literal` — case (b)
- `test_place_owner_silent_on_an_owner_ambiguity_place` — no literal, no row, plate or otherwise
- `test_place_owner_silent_on_a_shot_that_does_not_carry_the_literal` — branded place, shot doesn't
  carry the cue either way
- `test_place_owner_silent_with_no_place_declared`
- `test_place_owner_defaults_owner_of_to_empty_when_omitted` — backward-compatible call shape
- `test_collect_wires_the_place_owner_row_across_a_place_end_to_end` — full (a)/(b)/no-row set
  driven through `collect()` over one real place (plate + redraw + bare shot) plus a second,
  `owner_ambiguity` place, proving the wiring end-to-end rather than just the unit function

**Updated:** `test_collect_wires_invariants_and_canon_into_cards_generically`'s `Q01` fixture now
declares `place_owner: "Widget Hall"` (it is the plate) so the row still fires under the new law,
plus an assertion on the exact question text.

## Final suite count

`py -3 -m pytest -q` from `image-generation/scripts`: **162 passed** (was 155; net +7 — this fix's
net test delta is -5 removed +12 added = +7, matching exactly).
