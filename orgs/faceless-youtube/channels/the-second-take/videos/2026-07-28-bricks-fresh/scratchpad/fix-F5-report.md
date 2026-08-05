# Fix F5 — residual closer (R1-M8, R1-M1, R1-M6 tail, new plate-source seam)

Worktree `kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`. No commits made
(instructed not to git add/commit). Scope: the 4 items handed off by
`fix-wave-verification.md`'s "Still open / partial" section + the new-seam plate paragraph.

## 1. R1-M8 — `figures_check`'s `anon_foreground` message aligned to forge's real remedy

**Was:** `lint_shots.py:1208-1212` (old numbering) reported `anon_foreground` as a generic
"unknown key(s)" with the false claim "forge.py ignores anything else". Forge actually keeps
`anon_foreground` a KNOWN key (`forge.py:232` `_FIG_KEYS`) specifically so it can hard-refuse it
BY NAME (`forge.py:557-559`) with a named remedy: "name the figure in the video's cast (seeded)
or stage the people at crowd scale (crowd exemplar)."

**Now:** `lint_shots.py`'s `figures_check` special-cases `anon_foreground` before falling through
to the generic unknown-key branch, and states forge's own remedy verbatim (same two-tier
restage: named cast or crowd rig). A genuinely-unknown key (not `anon_foreground`, not `crowd`)
now also gets a truthful message — forge hard-rejects those too (`SystemExit`, `forge.py:246`),
so "ignores anything else" was false for that case as well; the message no longer claims forge
is silent about anything.

- Evidence: `lint_shots.py` `figures_check`, ~line 1200-1222; forge remedy source `forge.py:557-559`.
- Test: `test_new_guards.py` `test_g7_anon_foreground_gets_forges_named_refusal_not_a_generic_unknown_key`
  (renamed from `test_g7_anon_foreground_is_an_unknown_key`) asserts the message no longer says
  "unknown key" and does carry "abolished"/"crowd exemplar".

## 2. R1-M1 — one sentence splitter, shared by both call sites

**Was:** two constants with different terminator classes — `lint_shots.py:884` `_SENTENCE =
(?<=[.;])\s+` (used by `negation_list_check`) and `:1677` `_SENTENCE_SPLIT = (?<=[.;!?])\s+`
(used by `seat_support_check`'s same-sentence contact-phrase window). A prompt clause ending on
`!`/`?` split correctly for one check and wrongly fused into its neighbor for the other.

**Now:** one definition — `_SENTENCE_SPLIT = re.compile(r"(?<=[.;!?])\s+")`, defined once near
`negation_list_check`, used by both `negation_list_check` (line ~900) and `seat_support_check`
(line ~1872). Picked the fuller terminator class (`.;!?`) as the more correct one — a prompt
clause can legally end on `!` or `?`, and the narrower `.;`-only class would wrongly fuse such a
clause into its neighbor for negation counting. Documented in a comment at the definition site,
including the R1-M1 citation so a future editor doesn't reintroduce the drift.

- Evidence: `lint_shots.py` ~line 884-891 (definition + rationale comment), ~900 and ~1872 (both
  call sites).
- Test: `test_new_guards.py` `test_g4_splitter_terminates_on_bang_and_question_too` — two prompts
  each carrying a single negation per sentence separated by `!`/`?`; must stay silent under the
  unified splitter (would have false-positived a 2-negation report under the old `.;`-only class).

## 3. R1-M6 tail — motion-planner/SKILL.md:80 hand-crop language struck

**Was:** `motion-planner/SKILL.md:80` still asserted cutouts are "human-QC-gated on the hand
crop" — the fourth of the four crop-battery sites the original finding named, the only one left
disagreeing with the 2026-08-03 retirement ruling (crop_battery.py retired, no verdict depends on
it, judged at ordinary viewing scale instead — already the law in `image-generation/SKILL.md:110,
128, 295` and `crop_battery.py:2-10`).

**Now:** rewritten to "human-QC-gated at **ordinary viewing scale** — `crop_battery.py` is
RETIRED; no verdict depends on a hand crop (2026-08-03 ruling)." All four sites now agree.

- Evidence: `motion-planner/SKILL.md` line 78-81.
- No test (markdown-only change; motion-planner's own suite, `test_lint_motion_plan.py`, does not
  exercise SKILL.md prose). Confirmed the 17-test suite still passes unchanged.

## 4. New seam (boss ruling: lint mirrors forge) — plate definition now skips non-generated shots

**Was:** `forge.py:1292-1297` skips any shot whose `source` is outside `ai-gen`/`hybrid` BEFORE
`place_first` is ever set — a stock/chart/screencap/archival shot is invisible to forge's plate
math. `lint_shots.py`'s `place_groups`/`place_plate_check` ignored `source` entirely and always
picked `grp[0]`, so a place whose first-in-file shot was `stock` (etc.) passed lint's plate law
on that shot while forge's real plate was a later, different shot — the two engines could judge
different frames as "the plate."

**Now:** `place_groups` picks `plate = next(sh for sh in grp if _plate_eligible(sh))`, where
`_plate_eligible` mirrors forge's skip exactly: `sh.get("source", "ai-gen") in ("ai-gen",
"hybrid")` (absent defaults to `ai-gen`, same default forge uses). A place with no generated shot
at all now yields no plate group (forge builds nothing for it either, so no plate law applies).
The docstring states the mirrored skip and cites `forge.py:1293-1297`. `place_owner_check` and
`carried_literal_check` both consume `place_groups` and inherit the fix automatically (no
separate edit needed — one definition, three consumers, as designed).

Doc wording unified to the identical phrase **"first-in-file generated shot"** in all four
places the finding named:
- `lint_shots.py` `place_groups` docstring (~line 1533-1539)
- `visual-prompt-writer/references/shots-schema.md` (~line 60-68, `place` bullet)
- `visual-prompt-writer/SKILL.md` (~line 129-132, Places/stages/environments bullet)
- `image-generation/SKILL.md:108` (Place/plate seed law row — was "the first **emitted** shot")

- Evidence: `lint_shots.py` `place_groups`/`_plate_eligible`, ~line 1525-1556; forge skip at
  `forge.py:1292-1297`.
- Tests added in `test_doctrine_reset_guards.py`:
  - `test_c4_new_seam_the_plate_skips_a_non_generated_first_shot` — a `stock`-sourced L59
    precedes the place's real (generated) plate L60; `place_groups` must report L60 as the plate.
  - `test_c4_new_seam_a_place_with_no_generated_shot_has_no_plate` — an all-stock/chart place
    yields `place_groups(shots) == []`.
  - `test_c4_new_seam_a_stock_first_shot_still_lets_the_generated_plate_require_no_cast` — a
    stock shot precedes a named-cast generated shot; `place_plate_check` must still HARD-fail on
    the generated plate (C-4 is not defeated by a preceding stock frame).

## Suite counts (this worktree, `py -3 -m pytest -q`)

| Suite | Before (per verification doc) | After |
| --- | --- | --- |
| `visual-prompt-writer/scripts` | 218 | **222 passed** (218 + 4 new/renamed test functions; 0 failed) |
| `image-generation/scripts` | 162 | **162 passed**, unchanged (0 failed) |
| `motion-planner/scripts` | 17 | **17 passed**, unchanged (0 failed) |

No commits made per instructions; all changes are in the working tree of
`kb-worktrees/boss-bricks-reset` on `claude/bricks-doctrine-reset`.
