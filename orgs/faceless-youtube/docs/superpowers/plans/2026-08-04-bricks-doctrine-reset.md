# Bricks Doctrine Reset Implementation Plan

> **For agentic workers:** executed subagent-driven from the boss session. Each task = one worker
> with sole ownership of its files. Workers EDIT ONLY — the boss stages explicit paths, commits,
> and grades. TDD per change; run the owning skill's test files before reporting done.

**Goal:** Land the 2026-08-04 doctrine reset (spec:
`docs/superpowers/specs/2026-08-04-bricks-doctrine-reset-design.md`) so the bricks-fresh video can
regenerate clean: style one-voice text-only, place pixels-only via per-video plates, calibrated
feasibility lints, forge integrity gates, machine-emitted review.

**Architecture:** Four parallel workers with disjoint file ownership (forge core / lint+schema /
docs+bible / review machinery), wired by the pinned contracts below. Quarantine + lint-calibration
run follow as Phase 2, then Daniel's $0 gate.

**Tech stack:** Python 3 (stdlib only, matching existing scripts), markdown doctrine files.

## Global constraints

- Binding annexes every worker reads first: the spec (path above), adversarial review §5
  (regression carve-outs) + §6 (16 changes-to-NOT-make):
  `channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/adversarial-review-2026-08-04.md`.
- Worktree: `C:/Users/danie/kb-worktrees/boss-bricks-reset` (branch `claude/bricks-doctrine-reset`).
  Never touch the main checkout.
- Daniel's editing law: change core logic, never bolt on; no per-case special-casing core logic can
  cover; files slim; no dead info left behind; cross-file consistency; UTF-8 explicit on every
  file write (this machine's shell default is cp1252).
- Skill code stays generic — no channel/video literal in any skill file.
- `blockquote_after` anchor strings in `style-bible.md` ("LOCKED STYLE descriptor", "STYLE-ONLY
  descriptor", "RIG-HOLD descriptor", "CROWD-RIG clause", "BASE-RIG clause") are LOAD-BEARING for
  forge — headings may not be reworded.
- Contract shapes that may not change: `merged.json` axes `f`/`s`/`r` + `dsg`; three-state stamp;
  `RETRY_OVERLAY_SCHEMA@2`; cutout/magenta contract; registry promotion rule.

## Pinned contracts (all tasks build to these exactly)

**C-1 unified recipe** (style-bible §2b blockquote body, replacing the current one):
> MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, flat colour fills — one flat
> base colour per surface plus at most ONE hard-edged single-step shadow shape, no feathered or
> blended transitions, uniform highlight-free surfaces — rounded friendly shapes, no realistic
> detail. No text, no words, no labels.

**C-2 banned render-technique terms** (lint HARD, prompts + suffix; case-insensitive):
`gradient`, `gloss`/`glossy`, `specular`, `bloom`, `depth-of-field`/`depth of field`,
`blurred background`/`blurred behind`, `soft focus`, `photoreal*`, `subsurface`, `rim light`.
Scene-light nouns (`warm`, `amber`, `glow`, `lit`, `lamp`) are never flagged.

**C-3 `place` key** (shots.json, optional per shot): kebab-case recurring diegetic set id.
Semantics: `place` = set identity; `stage` = continuity chain *within* a place (caps unchanged).
Shots whose `shot_class` is symbolic/abstract/object-insert, shorts `first_frame`, and the
thumbnail block never declare `place`.

**C-4 plate derivation** (forge `cmd_batch`): the first emitted shot of a `place` that declares
zero named cast is the place's plate (`plate: true` on the emitted item, name `plate-<place>` not
required — the shot's own id stays). Plate-qualifying places: ≥2 shots share the `place`, or the
place carries owner branding. In-place non-delta shots seed the place's first approved frame
(extend the existing `place_first`/`place_last` map, keyed on `place` when present, else `stage`,
else shot name — one map, not a parallel one). Zero-seed legality keys on the derived plate (or a
no-place root under C-3 exemptions), replacing the `root_scene` request flag. `--plate-candidates`
and its filter are deleted.

**C-5 same-place law** (forge + lint): a `place_anchor` or derived place seed whose source shot's
`place` differs from the consuming shot's `place` is a hard error: cross-place image seeding is
the probe-refuted style-anchor failure. `place_anchor` becomes legal on any non-delta shot whose
place is established (base-only restriction removed both sides).

**C-6 figure review record** (`visual-kit/_staging/review.json`, single file):
```json
{"figures": {"fig-<char>--<pose>--<expr>": {
  "canonical_sha256": "…", "expression_sha256": "…or null",
  "verdicts": {"<invariant-slug>": "pass|fail"},
  "reviewer": "fresh-eyes", "date": "YYYY-MM-DD"}}}
```
Written ONLY by `stamp_review.py` (extension; single-writer law). Forge `cmd_batch` REUSE of a
staged `fig-*` requires an all-pass entry whose `canonical_sha256` matches the current canonical;
missing/failed/stale ⇒ refuse and print the one-line `gen` remint command. Gate applies to
batch-emitted scene slates only (thumbnail carve-out).

**C-7 seat/support law** (lint HARD): a named figure bound to a seated pose primitive (registry
binding via the shot's `figures` cast list — never the English verb) must, in `still_prompt`, name
a support from `chair|stool|bench|seat|crate|step|ledge|desk edge|sill` AND a contact phrase in
the same sentence. Framing sufficiency = soft heads-up only.

**C-8 presence checks** (lint HARD): 2-named-cast shot ⇒ prompt states plane, eye line, relative
head scale (presence of each clause, not coherence). Consecutive shots whose `vo_text` continues
an action on the same props ⇒ shared `stage`/`stage_role` or an explicit `hard_cut: true` field
(add to schema). Semantic cast ⇒ fail only when `vo_text` has a generic plural role noun AND a
declared named character appears nowhere in that VO span ±1 neighbours.

**C-9 seed-cap displacement** (forge): when a slate exceeds `SEED_CAP` and contains both the place
plate and the crowd exemplar and the shot's crowd is background tier, drop the crowd exemplar
(the plate carries the rear mass) and record the displacement in the emitted `why`. Still over
cap ⇒ existing restage error (never truncate).

**C-10 expression-delta gate** (forge, inside the existing delta path): a delta whose authored
prompt changes a named figure's expression must carry that expression primitive seed or a
C-6-verified combined STEP-1. Carve-outs: retry overlays with `defect: seed|mechanism`,
`no_hands` characters, thumbnails.

**C-11 provenance ledger** (forge → `assets/scenes/manifest.json` entries): add
`parent_depth` (int, 0 for roots) and `lineage` (int, hops from approved canonical). A child whose
parent entry carries `review_status: "parked"` is refused at batch time (distinct message from the
retry-path verified-parent check).

**C-12 review rows** (`build_review_artifact.py`): emit one empty verdict row per
(shot × applicable invariant), pre-filtered: support/contact rows only where C-7 binds, place-owner
only on branded interiors, relative-scale only on 2-cast shots, crowd only where declared,
flat-cel hazards on all. Canonical-vs-candidate comparison images only on named-figure shots,
ordinary viewing scale.

---

### Task A — forge core (opus)

**Files:** Modify `channels/…/nothing` — NO channel files. Only:
`.claude/skills/image-generation/scripts/forge.py` + its `test_forge_*.py` files.
**Owns contracts:** C-4, C-5, C-9, C-10, C-11, and the C-6 *consumer* (reuse gate), plus: scene
descriptor single-voice (keep `HARDENED_SCENE_STYLE` verbatim-aligned with C-1's terms; it
reinforces, never contradicts), remove the `root_scene` request flag and `--plate-candidates`
(dead code + consumers), widen `place_anchor` legality per C-5.
**Sequence inside the task:** (1) place model C-4/C-5/C-9 + tests; (2) gates C-6-consumer/C-10/
C-11 + tests; (3) dead-code removal + descriptor. Run the full image-generation test suite after
each stage.
**Produces for others:** the exact refusal strings for lint to mirror (report them); `plate` on
emitted items; manifest `parent_depth`/`lineage` fields.

### Task B — lint + schema + critics (sonnet)

**Files:** `.claude/skills/visual-prompt-writer/scripts/lint_shots.py` + its `test_*.py`,
`references/shots-schema.md`, `references/critics.md`.
**Owns contracts:** C-2, C-3 (schema doc), C-5 mirror, C-7, C-8, plus: place-inventory check
(every declared `place` maps to a `script.md` span via `script_vocab`), place-owner check
(branded-interior cue present on the plate shot or `owner_ambiguity: true` declared), suffix
one-voice check (suffix contains no C-2 term and no soft/gradient-permissive wording),
`first_frame`/thumbnail exemptions, critic questions for the judgment halves (plane/scale
coherence, action cause→effect, semantic-cast justification) added to `critics.md` citing the B3
bulk-conversion mechanism.
**Consumes:** C-4 semantics (plate = first no-cast shot of a qualifying place — lint validates
authoring matches).

### Task C — doctrine docs (sonnet)

**Files:** `channels/the-second-take/visual-kit/style-bible.md`,
`.claude/skills/image-generation/SKILL.md`, `.claude/skills/visual-prompt-writer/SKILL.md`,
`docs/superpowers/specs/2026-08-04-vpw-middle-path-design.md` (SUPERSEDED banner only),
`knowledge/decisions.md` (append two reversal entries per spec §Keep/revert).
**Owns:** C-1 into §2b (and §2c/§5 consistency — delete every soft/gradient-permissive phrase),
image-gen SKILL: seed law text (plate/place model, zero-seed legality), slice law (batch count =
run's gate cadence, boundary on stage boundaries, held stage never splits), review procedure
scoping (machine-emitted rows, named-figure-only comparisons, ordinary viewing scale); VPW SKILL:
place-first law + C-3 definition, process law (per-shot re-author from VO line, bulk substitution
banned, archived shots.json never read), C-9 worked seed-cap example (2 cast + crowd + prop +
plate = 5 → plate displaces crowd → 4).
**Constraint:** blockquote anchors unchanged; docs stay at router altitude; integrate in place.

### Task D — review machinery (sonnet)

**Files:** `.claude/skills/image-generation/scripts/build_review_artifact.py`,
`scripts/stamp_review.py` + `test_stamp_review.py`.
**Owns:** C-12, and the C-6 *writer*: `stamp_review.py` gains the figure-record path (merge a
figure-verdicts input into `visual-kit/_staging/review.json`; scene stamping contract byte-stable;
single-writer preserved — document the input shape in the script docstring).
**Consumes:** C-6 schema; C-7/C-8 field names for row pre-filtering.

### Phase 2 (after A–D graded & committed) — quarantine + calibration (haiku/sonnet, main checkout)

Quarantine per spec §2 (archive paths, 8 cast figure globs → `_staging/_archive-pre-reset-2026-08-04/`,
manifest reset `{"shots": []}`, keep-live list). Then calibration: run the NEW lint over the
ARCHIVED shots.json; report per-check fire counts + example ids. Output feeds Daniel's gate.

### Phase 3 — Daniel's $0 gate

Present: diff summary, calibration counts, two decisions.md reversals, review re-scope
re-authorization, budget-of-record ruling. No paid call before sign-off.

## Self-review notes

Spec coverage: every §1 bullet maps to A–D (style→A/B/C, place→A/B/C, feasibility→B, process→C,
gates→A/D, review→D, cross-file→C); §2→Phase 2; §3→Phase 3. Type/name consistency pinned by C-1…
C-12. No placeholders: contracts carry the exact strings, schema, and lists workers need.
