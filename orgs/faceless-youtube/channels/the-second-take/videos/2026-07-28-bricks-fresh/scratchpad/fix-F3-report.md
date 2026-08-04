# Fix worker F3 — forge + review loop (adversarial R1/R2 closure)

Worktree: `kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`. No commits made.

Files touched (all owned): `forge.py`, `stamp_review.py`, `build_review_artifact.py`,
`test_forge_place_and_gates.py`, `test_build_review_artifact.py`, `image-generation/SKILL.md`,
plus `crop_battery.py`'s docstring (see "Ownership judgment call" at the end).

**Suites: image-generation 155 passed (was 142, +13); visual-prompt-writer 218 passed (F2's
number, untouched by me). Both `py -3 -m pytest -q`, 0 failed.**

---

## 1. C-6 loop closure (R1-B3 + R2-M4) — the run no longer hard-stops at slice 2

**Wiring chosen** (single-writer preserving, smallest coherent path): the board emits the INPUT,
`stamp_review.py` stays the only writer of the store.

- `build_review_artifact.py` gained `--staging <kit>/_staging` and `--figures-out <path>`.
  With `--staging` it (a) appends one review card per staged `fig-*` frame that forge would refuse
  to reuse, carrying the refusal reason as its badge and the character's canonical as its
  comparison strip, and (b) writes a **figure-verdicts skeleton** (default
  `<video>/assets/_review/figure-verdicts.json`) pre-keyed by `fig-*` id with `canonical_sha256`
  computed from the bytes on disk and every verdict left `""`.
- The pending list is **`forge.figure_reuse_blocker` itself**, imported (same skill, same dir),
  never a second predicate — so the board's "needs a ruling" set and forge's refusal set are the
  same set by construction. To make that import possible without a key-bearing `Kit`,
  `figure_review_record` now takes a staging DIR, and the gate predicate was split out of
  `figure_reuse_refusal` as `figure_reuse_blocker(staging_dir, fn, frame, store_label=None)`.
  Forge's refusal behaviour is byte-unchanged apart from the remint text (item 3).
- `merged.json` was NOT given a figures section: the two stores are deliberately different
  (per-video scene manifest vs channel-wide `_staging/review.json`), the scene stamping path is
  byte-stable by contract, and `stamp_review.py <video_dir>` cannot derive a staging dir. The
  figure half rides the existing `--figures` CLI form instead.

**The documented C-6 procedure** (now in `SKILL.md` §Reviewing the run, verbatim):

> **The same pass also rules the batch's STEP-1 figures — this is what closes the reuse loop, and a
> run that skips it hard-stops on the next batch.** `batch` refuses to seed any staged `fig-*` that
> lacks an **all-pass, digest-current review record** in the channel-wide store
> `<kit>/_staging/review.json`; a figure minted in slice N is reusable in slice N+1 **only** because
> that slice's review recorded a verdict for it. The loop, in order:
>
> 1. **Build the board with the staging dir**: `py -3 .../build_review_artifact.py --video
>    <video-dir> --out <board.html> --staging <kit>/_staging`. Alongside the scene cards it renders
>    one card per STEP-1 figure forge would refuse (its refusal reason is the card's badge, and the
>    pending list IS forge's own reuse gate, so the two can never disagree), and writes a
>    **figure-verdicts skeleton** to `<video>/assets/_review/figure-verdicts.json` (override with
>    `--figures-out`) — pre-keyed by `fig-*` id with `canonical_sha256` already computed from the
>    bytes on disk, and every verdict left EMPTY.
> 2. **The fresh-eyes pass rules those cards too**, on the same three axes, at the same ordinary
>    viewing scale. Its scene rulings merge into `assets/_review/merged.json` as always; its FIGURE
>    rulings fill in the skeleton's verdicts (`"pass"` / `"fail"` per invariant — a figure needs
>    every one to read `pass`).
> 3. **The ORCHESTRATOR records them, before the next batch generates**: `py -3 .../stamp_review.py
>    --figures <figure-verdicts.json> <kit>/_staging`. Same single-writer law as the scene path —
>    `stamp_review.py` is the ONLY writer of a verdict anywhere in this pipeline; the board writes
>    only the skeleton, and forge only ever reads.
>
> The record shape the store keeps, per `fig-<character>--<pose>--<expression>`:
> `{canonical_sha256, expression_sha256, verdicts: {"<invariant-slug>": "pass"|"fail", …}, reviewer,
> date}`. A re-review of the same id REPLACES the record wholesale; ids absent from an input are
> untouched (additive merge). **A staged figure with no record, with no per-invariant verdicts, with
> any `fail`, or whose `canonical_sha256` no longer matches the bytes on disk is refused as a
> seed** — the refusal names which of the four it is and prints the builder invocation that re-mints
> it (delete the frame, re-run this same `batch --shots <id>`, `gen --batch` the spec, review,
> stamp). **Never hand-mint a STEP-1 with `gen --seed a,b,c`:** the `gen` CLI can only build
> `reference` seed roles, so the figure would be generated with role prose that lies about what each
> seed is for — the exact root cause the truthful roles exist to remove. One minter, one truth.

Also: the "Stamp the gate" bullet now names the figure half as the same orchestrator step; the batch
paragraph's false "reuses an existing step-1 figure frame before generating one" now states the C-6
gate; `stamp_review.py`'s docstring now names `build_review_artifact.py --staging` as the producer of
its input instead of "whatever tool runs that review" (the tool that did not exist).

Figure invariant slugs the skeleton emits (`FIGURE_INVARIANTS`, the review's own vocabulary —
`stamp_review` stores whatever slugs the review names, forge requires every one to read `pass`):
`rig`, `expression-register`, `flat-cel-hazard`.

## 2. C-11 completion (R1-B2) — the counters now reach the manifest

`batch` already wrote `parent_depth`/`lineage` onto every spec item; nothing copied them onto
`scenes/manifest.json`, so `_scene_provenance` read 0 hops every run and `lineage` could never climb.

- New `forge.batch_provenance(spec_path)` + `cmd_manifest(..., from_batch=None)` + CLI
  `--from-batch <spec.json>`: each scenes entry inherits both counters from the matching batch item
  (spec `name` == entry `shot_id`) unless it states its own. Refused on `--kind library`. The
  existing non-negative-hop validation is unchanged and still applies to inherited values.
- Derived ONCE by the walk that knows the chain, copied here, never re-derived by eye.

**Manifest record shape** (now in `SKILL.md`, replacing the old 9-field line):

```
{shot_id, file, technique, seeds, flagged: false, review_status: "unreviewed", parked_reasons: [],
 retry_cause: null, parent_depth, lineage, notes}
```
emitted with
`forge.py manifest --kind scenes --batch <entries.json> --from-batch <the spec batch wrote> --to <video>/assets/scenes`.
The SKILL states what each counter means, that they are copied never re-derived, and that a present
counter must be a non-negative hop count or forge refuses the manifest.

Lineage reset-to-1-under-verified-parent is untouched, as built by A.

## 3. Second minter folded (R1-B4) — one STEP-1 minter, one truth

`figure_remint_command` (the `gen --seed a,b,c --delta "<figure card>"` line, whose roles the CLI
forces to `reference`) is **deleted**. Replaced by `figure_remint_instruction`, which prints the
exact builder invocation that re-derives the figure through `cmd_batch`'s own STEP-1 branch:

```
    1. delete the refused frame:  <rel path>
    2. py -3 .../forge.py batch --kit <kit> --batch <shots.json> --out <spec.json> --shots <shot-id>
    3. py -3 .../forge.py gen --kit <kit> --batch <spec.json>
    4. review the frame, then record the verdicts (the ONLY writer):
       py -3 .../stamp_review.py --figures <figure-verdicts.json> <kit>/_staging
```

Why not `batch --retry` (`_retry_step1`): it cannot re-mint in place — `_retry_name` hard-refuses an
output name colliding with an existing staging/library/scenes PNG, and the refused frame is exactly
such a PNG; its `defect` is also closed to `expression|rig`, and "unreviewed" is neither. Re-running
the same `batch` with the frame removed IS the builder's own STEP-1 path, with `step1_roles` built
at the call site. `figure_reuse_refusal` now takes `(k, fn, frame, shots_path, out_path, shot_name)`
so the printed command is exact, and step 4 is what makes the loop terminate.

## 4. Duplication sweep

- **M1 (second sentence splitter)** — **not fixed here, and not mine to fix**: both constants
  (`_SENTENCE_SPLIT` at `lint_shots.py:1522`, `_SENTENCE` at `:884`) live entirely in F2's file.
  I introduced no splitter: the review board's seated signal needs no sentence scoping (that is
  lint's HARD support check), and forge has none. **Flagging for F2/boss.**
- **M11 (seated-ness implemented twice)** — fixed. `build_review_artifact.seated_shots` now reads
  lint's own PROMPT signal: a backticked `sit` pose primitive bound by backtick ORDER to the most
  recently named character, never the English verb "sits". The library-manifest `kind in
  (pose, action)` heuristic is gone. New `identity_names()` supplies the binding vocabulary
  (this video's Pass-1 identities; documented as the narrowing vs lint's registry∪library union,
  which is safe under the registry-promotion rule). The dead
  "same cross-skill precedent as `SEATED_PRIMITIVE` **below**" comment is now accurate — the
  constant really is in the file, and above.
- **M2 (owner-cue regex dropped lint's possessive guard)** — fixed. `_OWNER_CUE_QUOTED` is gone;
  `_QUOTED` (with the `(?<![A-Za-z])` lookbehind and the `{1,60}` bound) and `_TRACKABLE_LITERAL`
  are now copied **verbatim** from lint, and `owner_branding_declared` composes them the way
  `place_owner_check` does.
- **M12 (anchor→source-shot binding written twice)** — fixed. One `_derived_from(stem, base)`
  helper; `_anchor_place` and `_repaired_parent_matches` both call it. A test asserts the binding
  regex literal occurs exactly once in `forge.py`.

**Drift-canary tests** (read the other file's source as TEXT at test time):

| test | file | asserts |
| --- | --- | --- |
| `test_every_signal_copied_from_lint_is_byte_identical_in_both_files` | `test_build_review_artifact.py` | the full module-level definition blocks of `_BACKTICK`, `SEATED_PRIMITIVE`, `_QUOTED`, `_TRACKABLE_LITERAL` are byte-identical in `lint_shots.py` and `build_review_artifact.py` (and fails loudly if either side deletes one) |
| `test_the_possessive_guard_and_length_bound_are_actually_load_bearing` | `test_build_review_artifact.py` | the guard's behaviour: the "customer's name … 'NEW ACCOUNT' tab" frame yields exactly one literal, not the phantom span; a purely possessive prompt records no owner decision; `'204'` is not trackable |
| `test_the_place_anchor_delta_law_sentence_is_byte_identical_to_lints` | `test_forge_place_and_gates.py` | the M14 law sentence reads identically in `lint_shots.py` and `forge.py` |
| `test_one_derived_frame_binding_serves_both_the_place_law_and_the_retry_path` | `test_forge_place_and_gates.py` | `_derived_from` behaviour + the regex literal appears exactly once in `forge.py` |

## 5. Semantics

- **R2-M7 (expression state keyed on place)** — fixed. `held_expression` is keyed on
  `((place, stage or place), character)`, and a chain ROOT (any non-delta beat) clears its own
  chain's entries. Two regression tests: `test_expression_state_is_keyed_on_the_stage_chain_not_the_place`
  (chain B's delta re-introducing a character at chain A's held expression now owes pixels — the
  false negative, the L75 mechanism) and `test_a_chain_root_resets_its_own_expression_record`.
  Both fail on the pre-fix keying.
- **M13 (flat-cel row skipped on hybrid/missing source)** — fixed. `GENERATED_SOURCES =
  ("ai-gen", "hybrid")` with `shot.get("source", "ai-gen")`, matching forge's own generation
  predicate exactly. Rule documented in `applicable_invariants`, in a code comment naming the
  reason, and in `SKILL.md`'s machine-emitted-rows paragraph ("only pure library reuse is exempt,
  since nothing generated those pixels").
- **M4 (dead `verified` boolean)** — fixed. Cards carry `review_status` (three-state, defaulting to
  `"unreviewed"`); the closing note now reads
  `note: N image(s) are not `verified` in assets/scenes/manifest.json yet (unreviewed or parked)`
  and counts only genuinely non-verified entries. Test:
  `test_cards_carry_the_three_state_review_status_not_the_deleted_verified_boolean`.

## 6. M14 mirror sync, forge side

- `stage_role` comparison: forge already normalizes (`str(...).lower()`); **left as-is**, F2 aligns
  lint. No forge change.
- `place_anchor` delta-legality sentence: forge's message now carries lint's sentence verbatim —
  "``place_anchor`` is not valid on a stage `delta` (a delta continues its own base's held scene via
  the chain parent; `place_anchor` is a different seed, for a base or standalone shot)." Its
  drift canary is listed above. **Coordination CONFIRMED with F2:** `build-integration-report.md`
  names a canonical form only for the CROSS-PLACE law (already in sync, untouched); for this
  delta-legality sentence it records the divergence and picks neither side, so F2's landed lint
  wording is canonical. Verified against F2's landed `place_anchor_legality_check`: the law sentence
  is byte-identical at both sites (both sides even wrap the literal at the same points), each side
  keeping only its own context prefix; lint compares `stage_role` case-insensitively and forge
  already did (`str(shot.get("stage_role", "")).lower()`, `forge.py:1304`/`:1320`) — no forge change
  needed, mirror in sync both ways.

## 7. M10 + M6 docs

- **M10** — `SKILL.md` now disambiguates in both directions: the §Seed law row ends "**'Plate' here
  is the PLACE plate — a whole shot, the place's first approved frame. The layered-shot plate
  (`plates/<id>.png`, §Layered shots) is a different object: a subtraction from one scene, not a
  place's establishing frame.**", and §Layered shots carries the mirror sentence plus the
  operational consequence ("materializing 'the plate' … means the subtraction, never a re-minted
  place frame").
- **M6 crop_battery — ONE ruling, stated identically in three places**: RETIRED; no review procedure
  calls it, no verdict depends on it; the file is kept on disk as a historical tool only; do not wire
  it back into a gate without a new ruling. Sites: `SKILL.md` §Seed law (the "rig FIX never seeds the
  defective frame" row — the mandatory before/after crop diff is replaced by "re-ruled by the next
  fresh-eyes pass at ordinary viewing scale"), `SKILL.md` §Reviewing the run, the resolution
  paragraph's historical mention (now "the then-live crop battery … that battery is retired"),
  `build_review_artifact.py`'s header, and `crop_battery.py`'s own docstring. **The file was NOT
  deleted.**

---

## Stopped on / flagged, nothing invented

1. **M1 is F2's** — see item 4. No splitter added on my side.
2. **R1-m1 (mojibake `â€”` in `seed_roles_text`) is a FALSE finding.** Read as UTF-8, `forge.py`
   lines 997–1017 contain real em dashes (U+2014). The reviewer read the file as cp1252. No change
   made; nothing is being sent mojibake to the provider.
3. **M3 / R2-M3 (the place-owner row fires where the cue exists and stays silent on the plate that
   is missing it)** is in `build_review_artifact.py` — my file — but was **not in my fix list**, so I
   left `applicable_invariants`' place-owner predicate exactly as it was. It is still open, and it
   pairs with R2-M1/R2-M2 on the lint side.
4. **Ownership judgment call: `crop_battery.py`'s docstring.** The file is in no worker's ownership
   list, and its first paragraph asserted the repealed law ("a rig verdict without a crop path is
   inadmissible"). Leaving it would have left M6 with two rulings instead of one, so I rewrote the
   docstring only — no code, no deletion. Flagging in case the boss wants it reverted.
5. **`forge.py manifest` cannot be smoke-tested from this worktree** (pre-existing, not a
   regression): `manifest` is not a dry command, so `Kit.__init__` loads `.env`, which the worktree
   lacks. `cmd_manifest` is covered directly by
   `test_the_scenes_manifest_inherits_the_provenance_the_batch_derived`. The board CLI WAS smoke
   tested end-to-end (board + skeleton written, correct sha, empty verdicts, `stamp_review
   --figures` accepts it unchanged and clears the gate).
