# Build worker A — forge core (bricks doctrine reset, 2026-08-04)

Worktree `kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`.
Files owned/changed: `.claude/skills/image-generation/scripts/forge.py`,
`test_forge_seed_requirement.py`, `test_forge_seed_roles_and_delta.py`,
`test_forge_surgical_retry_and_zones.py`, `test_forge_figures.py`,
new `test_forge_place_and_gates.py`.

## Stage 0 — baseline (environment fix, no doctrine change)

`test_forge_seed_requirement.py` and `test_forge_seed_roles_and_delta.py` failed on arrival in this
worktree: `Kit.__init__` finds the repo root by walking up to the env marker, which exists only in
the primary checkout (M14). In a worktree the walk reaches `C:\`, so every registry-relative seed
path stops resolving ("seed frame not found: channels/.../miniscribe-rep.png"). Fixed in the test
helpers only — `_real_kit()` / `_kit()` pin `k.root = KIT_DIR.parents[2]`, which is exactly the root
the primary checkout derives. No forge behaviour changed. Suite green before stage 1 began.

## Stage 1 — place model (C-4, C-5, C-9) + dead code

Command: `py -3 .claude/skills/image-generation/scripts/test_*.py` (each file), cwd =
`orgs/faceless-youtube`. Result: 11/11 files OK except the not-yet-implemented stage-2 tests in
`test_forge_place_and_gates.py`. Stage-1 tests in that file: 9/9 OK.

Changes:
- **C-4**: `cmd_batch`'s ONE seeding key is now `shot["place"] or shot["stage"] or name` — the
  existing `place_first`/`place_last` maps, no parallel map. A new stage chain inside an established
  place therefore seeds that place's first frame instead of running as an independent root.
- **C-4 plate**: `plate` is DERIVED on the emitted item — `plate = not seeds` (a scene carrying no
  image seed at all is the frame that establishes its own place). `resolve_request_seeds`'s zero-seed
  exception keys on it. `root_scene` (request flag), `--plate-candidates` and its dead filter are
  deleted, consumers included; `_retry_scene` now recomputes `plate` from its final seeds instead of
  popping the key.
- **C-5**: `place_anchor` is legal on any non-delta shot (the stage-`base`-only refusal is gone);
  refused on a delta; refused when the anchored frame's owning shot declares a different `place`
  (`_anchor_place` binds `assets/scenes/<id>.png` and `<id>-fix.png` to the shot that minted it, the
  same binding the retry path uses). Cross-place *derived* seeding is structurally impossible: two
  places are two keys, so no map entry can be shared — asserted by the place tests.
- **C-9**: over `SEED_CAP` with both a place frame and the crowd exemplar in the slate, the crowd
  exemplar is dropped, recorded in `why` ("CAP DISPLACEMENT — …") and in the item's
  `assets_omitted`, which the seeding law already honours as a deliberate exclusion (so the "crowd
  declared but unseeded" violation stays correct and no new field was invented). Still over cap ⇒
  the existing restage error, unchanged.

## Stage 2 — integrity gates (C-6 consumer, C-10, C-11)

Command: each `.claude/skills/image-generation/scripts/test_*.py`, cwd = `orgs/faceless-youtube`.
Result after the stage: 11/11 files OK (143 tests), including 16/16 in
`test_forge_place_and_gates.py`.

- **C-6 consumer**: `cmd_batch`'s REUSE branch calls `figure_reuse_refusal()` before it accepts a
  staged/library `fig-*` frame. Lookup semantics: `<kit>/_staging/review.json` →
  `figures[<fig-name>]`; refuse when the entry is absent, carries no verdicts, carries any verdict
  != `pass`, or its `canonical_sha256` != the SHA-256 of the reuse candidate's own bytes. Forge
  never writes the file (single-writer law intact).
- **C-10**: implemented INSIDE `seeding_law_violations`' existing delta branch. The builder derives
  which expressions a delta CHANGES (walk-level `held_expression[(place, character)]`) and emits
  `expression_change` on the item; the law demands the primitive or a STEP-1 frame holding it.
  Carve-outs: `no_hands` (its earlier branch continues first), retry overlays whose
  `retry_authority.kind == "seed/mechanism"`, thumbnails (never in the batch walk).
  Correction found by an existing fixture: keying on "the delta names an expression" over-fires —
  the default delta authoring re-states the whole recipe while only a prop changes (D02 in
  `test_forge_seed_roles_and_delta.py`). Keying on the CHANGE keeps that clean and still catches L75.
- **C-11**: `_scene_provenance()` returns `(parent_depth, lineage)` for every emitted scene;
  `lineage` resets to 1 under a `verified` parent, otherwise climbs. A parent whose scenes-manifest
  entry is `parked` is refused at batch. `cmd_manifest --kind scenes` carries the two counters
  through and rejects a malformed one.
  Seam: `cmd_retry_batch` rebuilds canonical items with `retry_rebuild=True`, which suppresses ONLY
  the parked refusal — a `defect: seed|mechanism` overlay exists to replace a parked parent, and the
  retry path already runs its own verified-parent check over the FINAL seeds. One law per condition.

## Stage 3 — descriptor single voice + dead-info sweep

Result: 11/11 files OK (143 tests).

- `HARDENED_SCENE_STYLE` now restates C-1's recipe in C-1's terms (flat colour fills, one flat base
  colour per surface, at most ONE hard-edged single-step shadow shape, no feathered or blended
  transitions, uniform highlight-free surfaces, even medium-thick dark warm brown-black outlines)
  and its NO-list mirrors the C-2 ban. `desc_scene` still assembles from the bible's STYLE-ONLY
  blockquote + this block; the blockquote anchors are untouched.
- BASE-RIG dead read REMOVED (worker C's finding confirmed): `style-bible.md` has no `## 2e.
  BASE-RIG clause` heading, so `Kit.desc_baserig` always parsed to `""`. Removed with the machinery
  that only served it — `_BASE_RIG_ANCHOR`, `_rig_tail`, `_has_binding`, `_FIG_BINDING`, and the
  `anon_foreground` half of `figures_expansion` (that tier is abolished; the seeding law refuses it
  by name, and `_FIG_KEYS` still lists it so that refusal stays reachable). `figures_expansion` is
  now `(figures, crowd_rig)`; its `stage_role` argument existed only for the removed held-figure
  wording, so `Kit.prompt_for` drops it too. No test covered the branch (all callers already passed
  `""`), and lint's `_RIG_CLAUSE` fingerprint is its own literal, not forge's constant.
- `--stage-role` KEPT on `gen`: it still declares a request an in-chain delta for the seeding law
  (and now for C-10). Its help text no longer promises prompt wording.

## Refusal strings (worker B mirrors these in lint)

1. Zero-seed legality — `resolve_request_seeds`:
   `{name}: only a derived place plate — a place-first frame with no chain parent and no
   ` + "`place_anchor`" + ` — may carry zero image seeds. Delta, chained, anchored, and
   identity-bearing requests must keep their continuity/identity seeds.`
2. C-5 anchor on a delta — `cmd_batch`:
   ``{name}: `place_anchor` is not valid on a delta beat — a delta inherits the in-chain parent
   frame it is a delta OF.``
3. C-5 same-place — `cmd_batch`:
   ``{name}: `place_anchor` {anchor} is not a frame of this shot's place `{place|none}` — a plate
   may only seed shots in its own place; cross-place image seeding is the probe-refuted
   style-anchor failure under another name.``
4. C-6 reuse — `figure_reuse_refusal` (one law, four reasons; the command is printed on its own
   indented line):
   ``{fig-name}: staged STEP-1 refused as a seed — {reason}. Re-mint it, then review it:``
   reasons: `it has no review record in {store}` · `its {store} record carries no per-invariant
   verdicts` · ``its {store} record FAILS {slug, slug}`` · ``its {store} record is stale —
   `canonical_sha256` no longer matches the frame on disk, so the pixels that were reviewed are not
   the pixels this slate would seed``.
   command: `py -3 <script> gen --kit <kit> --name <fig-name> --mode environment --aspect 2:3
   --image-size 1K --force --seed <canonical>[,<expr>][,<pose>] --delta "<figure card payload>"`
5. C-10 expression delta — `seeding_law_violations` (collected, not raised):
   ``{name}: delta changes `{character}` to `{expr}` but the slate carries neither that expression
   primitive nor a STEP-1 frame holding it — an expression changed by prose alone reverts to the
   engine's prior. Declare `delta_primitives`: {"<character>": ["<expr>"]}.``
6. C-11 parked parent — `_scene_provenance`:
   `{name}: its place frame {frame} is PARKED — a parked defect is non-shippable and may not be
   inherited. Re-base this shot on an approved frame, or repair and re-review the parent first.`
   (Deliberately distinct from the retry path's `fresh retry may not seed an old video scene output
   unless its manifest `review_status` is `verified``.)
7. C-11 manifest counters — `cmd_manifest`:
   ``scenes entry #{i} `{parent_depth|lineage}` must be a non-negative integer count of hops, as
   `batch` derived it.``
8. C-9 is not a refusal — it is a `why` note on the emitted item:
   `CAP DISPLACEMENT — crowd exemplar dropped; the place frame carries the rear crowd mass`
   (plus `crowd-exemplar` in that item's `assets_omitted`).

## Emitted item shape (for B / D)

Scene items now carry `plate` (bool, derived), `parent_depth` (int), `lineage` (int) and
`expression_change` (`{character: expr}` or null); `root_scene` is gone. STEP-1 items are unchanged.

## Ambiguities resolved (flag if Daniel rules otherwise)

- **C-6 `canonical_sha256`** = the SHA-256 of the reviewed staged frame's own bytes (what forge
  would seed), not of the character's canonical ref. Only this reading makes "stale" meaningful: a
  frame re-minted after review is refused. Forge does not read `expression_sha256` — it is the
  record's provenance data on the writer side (worker D).
- **C-9 "background-tier crowd"**: `figures.crowd` IS the background tier — `anon_foreground` is
  abolished, so no tier field was invented for it.
- **C-4 "plate-qualifying place"** (≥2 shots or owner branding): forge DERIVES the marker (a scene
  with no image seed at all); whether a plate had to be authored for a place is lint's/VPW's call.
  Forge cannot see owner branding without a per-video literal, which skills may not hold.
- **C-10 "changes an expression"**: derived by the walk (the chain's held expression vs this
  delta's), not by "the delta names an expression" — the latter over-fires on the default delta
  authoring that re-states the recipe while only a prop changes.

## Not done, and why

- Lint mirrors of C-5/C-4 (worker B), the bible/SKILL text (worker C), `stamp_review.py`'s C-6
  WRITER and `build_review_artifact.py` (worker D) — not my files.
- `image-generation/SKILL.md` line ~142 still describes the removed §2e held-figure `figures`
  wording, and line ~139's `figures` example still shows `anon_foreground`. Worker C owns SKILL.md;
  both lines are now stale and need the same-wave fix.
- No commits, per brief.
