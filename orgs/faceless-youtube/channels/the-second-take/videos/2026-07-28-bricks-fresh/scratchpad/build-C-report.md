# Build worker C report — doctrine docs (2026-08-04 bricks doctrine reset)

Worktree: `C:/Users/danie/kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`.
Edits only, no commit (boss stages/commits).

## Files changed

### 1. `channels/the-second-take/visual-kit/style-bible.md`
- **§2b STYLE-ONLY descriptor**: blockquote body replaced with C-1 verbatim (dropped the old "Draw
  in the SAME art style… gentle soft cel shading" text; new text is the plan's exact C-1 string —
  medium-thick outline, flat colour fills, one flat base colour + at most one hard-edged
  single-step shadow shape, no feathered/blended transitions, uniform highlight-free surfaces).
- **Soft/gradient sweep**: full-file grep for `soft|gradient|gloss|gentle|blend|smooth|feather`
  before and after the edit. Only real hit was §2b's "simple flat colours with gentle soft cel
  shading" — removed by the C-1 replacement above. §2c (RIG-HOLD) and §5 (committed recipe) had
  **zero** soft/gradient-permissive phrases to begin with — confirmed by grep, nothing to change.
  §4 palette section untouched (per-scene committed palettes, one channel colour family,
  neutral-grey-only not a palette — all intact). §3 rig invariants untouched.
- **Left alone (judgment call)**: two "soft" occurrences remain, both inside §2 "LOCKED STYLE
  descriptor" (verbatim, load-bearing, not named in my task scope): "a soft near-circle" (head
  *shape* geometry, not a shading permission) and "plain soft light-grey studio background"
  (background plainness/lightness, not a render-technique word from C-2's banned list). Neither is
  a shading/gradient permission in the sense C-1 forbids, and §2's body is itself a separately
  "verbatim" locked block that forge's parser also consumes — I did not touch it since the task
  named only §2b/§2c/§5 for the sweep and this text isn't the "gentle/soft cel/soft shading"
  pattern called out.

### 2. `.claude/skills/image-generation/SKILL.md`
- **Seed law table row** ("Hardened scene descriptor…" → renamed "Place/plate seed law…"): now
  states zero-seed is legal only for a derived place plate or a no-place root (C-3 exemptions
  named explicitly: symbolic/abstract/object-insert classes, shorts `first_frame`, thumbnail),
  every other in-place shot seeds its own place's first approved frame, and cross-place image
  seeding is a hard refusal — "the probe-refuted style-anchor failure under another name."
- **`place_anchor` paragraph**: widened from base-only to any non-delta shot whose `place` is
  established; added the same-place enforcement (source frame's `place` must match the anchoring
  shot's, else refused) alongside the existing cross-video refusal.
- **Slice law (M12)**: "Reviewing the run" intro no longer hardcodes 2–4 act batches; now states
  the batch COUNT is set by the run's gate cadence (2–4 act batches, or a different count such as
  five gated fifths), with the boundary rule fixed regardless of count — a slice boundary always
  falls on a stage boundary, a held stage never splits.
- **Review procedure re-scope**: new paragraph before the three-axis list stating verdict rows are
  machine-emitted by `build_review_artifact.py` (one empty row per shot × applicable invariant,
  pre-filtered by shot declarations — support/contact, place-owner, relative-scale, crowd, flat-cel
  hazards), and canonical-vs-candidate comparison images render only on named-figure shots at
  ordinary viewing scale, never a crop battery. The three-state stamp contract (`verified` /
  `parked` / `unreviewed`, `stamp_review.py` sole writer) was left untouched — confirmed unchanged.
- **Orphaned-sentence check**: grepped for `--plate-candidates`, `root_scene`, `crop_battery`,
  `build_review_artifact` before editing — none were present in this file to begin with, so
  nothing needed removing on that account; the only "root" language was the seed-law row itself,
  which I already rewrote to the C-3 "no-place root" vocabulary.

### 3. `.claude/skills/visual-prompt-writer/SKILL.md`
- **Place-first law**: expanded Step 3a's "Stages + environments" bullet into "Places, stages +
  environments" — full C-3 definition (`place` = recurring diegetic set identity, kebab-case,
  distinct from `stage`'s within-place continuity chain), the conditional plate law (≥2 shots or
  owner branding → plate; single-use unbranded → seedless place-first frame), the no-place shot
  classes, the place-inventory verification (`script_vocab` match, invented place fails lint like
  invented lettering), and the owner-cue data-sourcing rule (place declaration + `script_vocab`,
  never a skill constant, registered via `carried_literal_check`'s L-1 mechanism).
- **C-9 worked seed-cap example**: added after the figures/crowd-cap sentence in Step 2.3, with the
  exact numeric example from the plan: "2 named cast + crowd + one tagged prop + the place plate =
  5 seeds, over `SEED_CAP` (4) — the plate displaces the crowd exemplar → 4, legal," plus the
  restage-never-truncate fallback.
- **Process law**: added to the SCOPED-REPAIR mode paragraph — repair rounds re-author each touched
  shot fresh from its own `vo_ref`'d VO line, bulk vocabulary substitution (mass find/replace
  across shots) is banned. Added a second rule to Step 1's read list — fresh authoring never reads
  an archived/quarantined prior `shots.json`; only SCOPED-REPAIR reads a file, and only the current
  one.

### 4. `docs/superpowers/specs/2026-08-04-vpw-middle-path-design.md`
- One SUPERSEDED banner blockquote added above the title, pointing at
  `docs/superpowers/specs/2026-08-04-bricks-doctrine-reset-design.md`. Nothing else in the file
  touched.

### 5. `knowledge/decisions.md`
- Two entries appended at end of file (append-only, dated 2026-08-04), verbatim below.

## Anchor-heading verification (byte-identical)

```
$ grep -n "LOCKED STYLE descriptor\|STYLE-ONLY descriptor\|RIG-HOLD descriptor\|CROWD-RIG clause\|BASE-RIG clause" style-bible.md
30:## 2. LOCKED STYLE descriptor (verbatim — prepend to every generation)
41:## 2b. STYLE-ONLY descriptor (verbatim — for new characters & environments/props)
51:## 2c. RIG-HOLD descriptor (verbatim — auto-appended to every character-bearing generation)
58:> crowd figures instead follow the §2d CROWD-RIG clause when
66:## 2d. CROWD-RIG clause (verbatim template — `forge.py` expands it at gen time)
```
All five load-bearing anchor phrases present, unchanged (I never touched heading lines — only the
§2b blockquote *body*, which the anchor list explicitly targets for C-1 replacement).

UTF-8 codepoint verification (not by-eye) on all five owned files — each decodes cleanly as UTF-8,
no cp1252 mojibake risk:
```
style-bible.md                                    OK utf-8   13262 bytes
.claude/skills/image-generation/SKILL.md          OK utf-8   38956 bytes
.claude/skills/visual-prompt-writer/SKILL.md      OK utf-8   18496 bytes
docs/.../2026-08-04-vpw-middle-path-design.md     OK utf-8    4792 bytes
knowledge/decisions.md                            OK utf-8  345939 bytes
```

## The two decisions.md entries, verbatim

```
## 2026-08-04 — Seedless-root ruling narrowed to place-scoped seeding (not voided)
**Decision.** The 2026-08-04 "root scenes may run seedless again" ruling (entry above) is narrowed,
not reversed: cross-place image seeding — anchoring a shot to a verified frame from a DIFFERENT
place — bleeds content and is refuted by the same probe evidence; within-place plate seeding bleeds
the set on purpose, which is the point of holding a place. Seedless generation stays legal for: a
place's derived plate (the first emitted shot of a qualifying place carrying no named cast), a
single-use unbranded place (its own place-first frame — a dedicated plate for it would be pure
waste), and no-place shot classes (symbolic, abstract, standalone object-insert, a short's
`first_frame`, the thumbnail). Every other in-place shot seeds its own place's first approved frame;
forge and lint both refuse a `place_anchor` (or derived place seed) whose source shot's `place`
differs from the consuming shot's.
**Evidence.** Adversarial review findings B5 and C1
(`videos/2026-07-28-bricks-fresh/scratchpad/adversarial-review-2026-08-04.md`): the probe ruling
above was decided by exactly a cross-place bleed (L160's people/furniture/calendar replacing L100's
scene); the doctrine-reset design's blanket seedless-root reversal had no same-place enforcement,
leaving that refuted failure mode authorable again under the new "place" vocabulary.
**Alternatives rejected.** (1) Leaving the 2026-08-04 ruling unqualified ("root scenes may run
seedless again," full stop) — reproduces the probe-refuted cross-place bleed under the place model.
(2) Requiring a plate for every place regardless of use count — wasteful and unpriced for a
single-use, unbranded place that is itself the seedless place-first frame the probe proved safe.

## 2026-08-04 — Review procedure re-scoped: machine-emitted rows, named-figure-only comparisons (re-authorization pending)
**Decision.** `build_review_artifact.py` now pre-renders one empty verdict row per (shot ×
applicable invariant), pre-filtered by what the shot actually declares — support/contact only where
a seated primitive is authored, place-owner only on branded interiors, relative-scale only on
2-cast shots, crowd only where declared, flat-cel hazards on all — so the reviewer fills rows
instead of inventing the row set. Canonical-vs-candidate comparison images render only on
named-figure shots, at the ordinary-viewing-scale standard, never a zoomed crop battery. This
RE-SCOPES, not reverses, the 2026-08-03 ratified loosening (above: "Rig-review evidence standard:
loosening RATIFIED") — ordinary-viewing-scale judging and no crop battery both stay; what changes is
that the forced-per-invariant rows become machine-emitted, closing the gap between what was ratified
in principle and what was executed in practice (the audit's own root cause: a review pass that "did
not execute its own forced-per-invariant procedure"). **Daniel's explicit re-authorization at the
doctrine gate is still required before this lands as binding** — logged here per adversarial-review
findings B4/C4 so the re-scoping cannot later be re-argued as a silent reversal.
**Evidence.** Adversarial review finding B4
(`videos/2026-07-28-bricks-fresh/scratchpad/adversarial-review-2026-08-04.md`): the doctrine-reset
design's review-operationalization section added six forced axes plus a canonical-vs-candidate crop
battery per named figure without naming that it was reversing the 2026-08-03 ruling; the amendment
moves cost from typing to eye instead of re-inflating reviewer load.
**Alternatives rejected.** (1) Human-typed forced verdicts on all six new axes plus a crop battery
per named figure (the design as first written) — reproduces the exact review-collapse-under-load
mechanism the 2026-08-03 ruling exists to stop. (2) Reverting fully to the 2026-08-03 loosening with
no machine-emitted rows — leaves the forced-per-invariant procedure unexecuted again, the audit's
own documented failure mode.
```

## Ambiguities resolved

1. **C-1 replacement scope**: the plan says "style-bible §2b blockquote body, replacing the
   current one." I replaced the *entire* blockquote body (dropping the old lead-in "Draw in the
   SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even") since
   C-1's text is given as a complete, self-contained replacement with no lead-in of its own, and
   "replacing the current one" reads as a full swap, not a splice.
2. **§2 vs §2b "soft" wording**: resolved by scope — the task named §2c and §5 for the sweep (plus
   "any other section" catch-all), with example phrases "gentle / soft cel / soft shading" that are
   all shading-technique permissions. §2's two "soft" occurrences describe head *shape* and
   background *plainness*, not a shading technique, and §2 is itself a separately-verbatim locked
   block I was not asked to rewrite. Left as-is; flagged here rather than silently deciding.
3. **Where to place the C-9 worked example and place-first law in VPW SKILL.md**: the plan doesn't
   pin exact locations, only that both land in the file. I put the place-first law in Step 3a
   (where stage/environment planning already lives) and the seed-cap example in Step 2.3 (where
   `figures`/crowd/cap language already lives) rather than appending a new section, per the
   "integrate, don't append" instruction shared across both SKILL.md files.

## Pre-existing inconsistency observed (not fixed — outside my file ownership)

`forge.py:360` still calls `blockquote_after(md, "BASE-RIG clause")` (comment: "§2e, expanded from
`figures`"), but `style-bible.md` has no §2e section — it goes straight from §2d (CROWD-RIG clause)
to §3. `image-generation/SKILL.md` also still describes `anon_foreground`/§2e as live machinery in
its "Provider-text order" paragraph. The middle-path spec's walk-back item 6 ("finish two-tier
migration… style-bible §2e") named `style-bible.md` and appears to have been done there (no §2e
exists), but forge.py's parser call and image-generation/SKILL.md's prose describing it were not
updated to match — this predates my edits and is not named in Task C's scope (my brief lists only
seed-law/slice-law/review-scope changes for this file). Not touched, since forge.py is Task A's
file and reintroducing/describing a third figure tier would also contradict the adversarial
review's binding "changes to NOT make" #2 (`anon_foreground` stays abolished). Flagging for the
boss to route to Task A or a follow-up card — if forge.py's `blockquote_after` raises/hard-fails on
a missing anchor rather than tolerating an absent optional section, this could be a live bug
independent of this wave.

## Not done / out of scope

- Did not touch `style-bible.md` §3 (rig invariants) or §4 (palette) — explicitly out of scope,
  verified unchanged.
- Did not touch `forge.py`, `lint_shots.py`, `shots-schema.md`, `critics.md`,
  `build_review_artifact.py`, `stamp_review.py` — all Task A/B/D files, read at HEAD only for
  cross-file consistency, never edited.
- Did not remove `anon_foreground`/§2e references from `image-generation/SKILL.md` — see the
  pre-existing-inconsistency note above; not named in Task C's brief for this wave.
- No commits made; edits left staged in the worktree for the boss to review/stage/commit.
