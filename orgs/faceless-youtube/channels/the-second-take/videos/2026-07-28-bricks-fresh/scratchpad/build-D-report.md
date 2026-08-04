# Build worker D report — review machinery (C-6 writer + C-12)

Branch `claude/bricks-doctrine-reset`, worktree `C:/Users/danie/kb-worktrees/boss-bricks-reset`.
Scope: `.claude/skills/image-generation/scripts/build_review_artifact.py`,
`.claude/skills/image-generation/scripts/stamp_review.py`,
`.claude/skills/image-generation/scripts/test_stamp_review.py`,
`.claude/skills/image-generation/scripts/test_build_review_artifact.py` (new — none existed).

## Files changed

- `build_review_artifact.py` — C-12 row/comparison machinery, additive (+162/-5 lines).
- `stamp_review.py` — C-6 figure-verdicts writer extension, additive (+104/-5 lines).
- `test_stamp_review.py` — 11 new tests appended after the existing 13; none of the 13 originals
  edited.
- `test_build_review_artifact.py` — new file, 19 tests (no prior test file for this script).

`forge.py`, `critics.md`, `shots-schema.md` are showing as modified in `git status` too — that is
Task A / Task B's concurrent work in the shared worktree, not mine. `test_forge_seed_requirement.py`
and `test_forge_seed_roles_and_delta.py` currently fail (`cmd_batch` signature / missing
`_scene_provenance`) — both are forge.py's in-flight state, outside my file ownership; flagging so
it isn't mistaken for review-machinery breakage.

## Test results

```
py -3 test_stamp_review.py         -> 24/24 passed  (13 original scene-stamping tests untouched
                                       and still green + 11 new figure-verdicts tests)
py -3 test_build_review_artifact.py -> 19/19 passed  (new file)
```

Also re-ran the neighboring image-generation suite for regression sanity (outside my ownership,
informational only): `test_cutout.py`, `test_finalize_thumbnail.py`, `test_forge_figures.py`,
`test_forge_hold.py`, `test_forge_prop_guard.py`, `test_forge_surgical_retry_and_zones.py` (8/9,
one pre-existing unrelated failure) all pass/unchanged; the two forge failures noted above are
Task A's in-progress edits.

No smoke test against real generated pixels was possible in this worktree — `assets/scenes/`,
`assets/plates/`, etc. are gitignored binaries that live only in the main checkout (M13/M14); only
`assets/library/manifest.json` is checked in here, confirmed present and read-only in this task.
All new logic is covered by unit tests with fabricated tmp-dir fixtures (Pillow-built PNGs),
matching the existing `test_finalize_thumbnail.py` fixture style.

## C-12 — row-emission filter logic (`build_review_artifact.py`)

Reads generically from **`shots.json`** + **`assets/library/manifest.json`** (this video's own
Pass-1 identity/pose ledger — never `registry.json`, since a video's own cast never gets promoted
there). No character or place name is hardcoded anywhere in the filter.

- **Named-figure detection**: `named_figures_by_shot()` reads every `kind == "identity"` asset's
  own `shots` list from the library manifest and inverts it to `shot_id -> sorted [names]`. Fully
  data-driven — proven in tests with never-seen-before names (`zeta-clerk`, `vintner-nine`).
- **Seated-primitive detection**: `seated_shots()` scans `kind in ("pose", "action")` assets whose
  `name`/`tag` matches `\bsit\b|\bseat` (regex, case-insensitive) — this catches the channel's
  actual `pose: sit` vocabulary entry generically (matches on the *vocabulary's own* labels, not a
  literal per-video string), and would also catch a future `seat-fold` or similar without a code
  change.
- **support-contact** row: `named` non-empty AND `sid in seated_shots`.
- **relative-scale** row: `len(named) >= 2`.
- **place-owner** row: `shot.get("place")` truthy AND `owner_branding_declared(shot)` — checks
  `owner_branding` / `place_owner` (affirmative cue authored) or `owner_ambiguity` (explicit,
  either boolean value — a deliberate "no cue, on purpose" call still counts as a recorded
  decision) at shot level or inside `figures`. **Ambiguity resolved**: C-3's `place` key and the
  owner-declaration field(s) were not yet landed by Task B/C at the time I wrote this (concurrent
  work in the same worktree) — I designed against the spec's own wording ("record intentional
  ambiguity") and picked a small, documented, easily-updated key tuple
  (`_OWNER_DECLARED_KEYS`/`_OWNER_AMBIGUITY_KEYS` at the top of the file) rather than guess-coding
  a rigid single name. If Task B lands different field names, it's a one-line tuple edit, not a
  redesign.
- **crowd** row: `shot["figures"]["crowd"] is True` (existing, unchanged convention).
- **flat-cel-hazard** row: `shot.get("source") == "ai-gen"`.
- **Comparison images**: emitted only when `named` is non-empty, sourced from the library
  manifest's own `file` path per named figure, skipped (not invented) when that file doesn't
  exist on disk yet. Rendered through the existing `inline()` downscale path — same
  ordinary-viewing-scale treatment as the main still, never cropped; `crop_battery.py` is not
  imported or referenced anywhere.
- Degrades gracefully with no `assets/library/manifest.json` at all: `source`-driven and
  `figures.crowd`-driven rows still fire (they don't need the ledger); named-figure rows and
  comparisons correctly emit nothing rather than crashing.
- All additive to the HTML: a card with no invariants/no comparisons renders byte-for-byte like
  the pre-C-12 board (verified by `test_build_omits_checklist_and_canon_blocks_when_none_apply`).

## C-6 writer — figure-record input format (`stamp_review.py`)

`stamp_review.py` remains the sole writer, extended with a second, fully independent CLI path
selected by a leading `--figures` flag (the original `py -3 stamp_review.py <video_dir>` form is
untouched — same argv-length check, same behavior, verified byte-identical by the original 13
tests plus a new explicit dispatch-safety test).

```
py -3 stamp_review.py --figures <input.json> <staging_dir>
```

`<input.json>` — the figure-verdicts input, produced upstream by whichever tool runs the fresh-eyes
figure review (not by a generating agent):

```json
{"figures": {
  "fig-brick-foreman--sit--deadpan": {
    "canonical_sha256": "<sha256 of the reviewed canonical PNG>",
    "expression_sha256": "<sha256 of the expression seed, or null>",
    "verdicts": {"support-contact": "pass"},
    "reviewer": "fresh-eyes",
    "date": "2026-08-04"
  }
}}
```

A bare `{fig_id: record, ...}` mapping (no `"figures"` wrapper) is also accepted for authoring
convenience. `merge_figure_records(store, input_data)` merges each record into
`<staging_dir>/review.json`'s `"figures"` dict:

- normalizes every merged record to exactly the pinned C-6 shape, dropping any extra input keys;
- a record for a `fig_id` already on file is **replaced wholesale** (a re-review — new canonical
  sha, new verdicts — always supersedes the old entry for that id; nothing from the old record
  survives a re-review, including `expression_sha256`);
- entries for `fig_id`s **not** present in this input are left untouched (additive merge, not a
  full-file replace) — one channel-wide file accumulates across many review passes;
- a record missing any of `canonical_sha256` / `verdicts` / `reviewer` / `date` is skipped with a
  stderr warning; the rest of the batch still merges (one bad record doesn't sink the run).

Example invocation, from a fresh `_staging/` with nothing on file yet:

```
py -3 stamp_review.py --figures scratchpad/figure-verdicts-2026-08-04.json \
  ../../visual-kit/_staging
# -> figure-review: 3 merged into ../../visual-kit/_staging/review.json
```

Write is atomic (tmp file + `os.replace`, UTF-8, matching the existing `_atomic_write_json` helper
reused as-is — no second writer was added).

## Ambiguities resolved

1. **Named-figure / seated-primitive detection source.** The spec's C-7 text ("registry binding
   via the shot's `figures` cast list") doesn't match the current schema (`figures` only carries
   `crowd`), and the global `registry.json` doesn't carry this video's cast (per the
   registry-promotion rule — a video's own cast never reaches it). Resolved by reading
   `assets/library/manifest.json` instead — the actual per-video Pass-1 identity/pose ledger,
   confirmed against the real `2026-07-28-bricks-fresh` file (`kind: "identity"` entries per named
   character, `kind: "pose"` entry named `sit`/tag `sit` for the seated primitive, each carrying
   its own `shots` list). This is the only data source that is both video-scoped and fully
   declarative — no scanning/parsing of `still_prompt` prose was needed.
2. **Place-owner declaration field name.** Not yet landed anywhere in the schema at build time
   (Task B's C-3 work, concurrent). Resolved with a small, documented, adjustable key tuple (see
   above) rather than blocking on cross-worker coordination or guessing a single rigid name.
3. **Test style.** This scripts directory has two conventions in play (plain-assert +
   custom `_run_all()` runner in `test_stamp_review.py`/`test_forge_*.py`, vs. `pytest` in
   `test_finalize_thumbnail.py`). Matched the plain-assert convention since both files I own/extend
   sit in the same directory as `test_stamp_review.py`, which already uses it, and it needs no
   extra dependency.

## Not done / out of scope

- Nothing in C-12 or the C-6 writer was left undone relative to the brief.
- `forge.py`'s C-6 *consumer* (the reuse gate reading `review.json`) is explicitly Task A's — not
  touched here.
- Schema documentation for `place`, `owner_branding`/`owner_ambiguity`, and the invariant slug
  vocabulary in `references/shots-schema.md` / `references/critics.md` is Task B's file ownership;
  I did not edit either file. My code is written to tolerate whatever field names land there within
  the small key tuple noted above — worth a quick cross-check once Task B's schema commit lands, to
  confirm the field names match (or update the tuple).
