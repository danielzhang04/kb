# Bricks doctrine reset + fresh gated run — design (2026-08-04, amended)

Daniel-approved design closing the B4/B5 drift wave. Root-cause source:
`videos/2026-07-28-bricks-fresh/scratchpad/audit-drift-2026-08-04.md` (5 mechanisms, all nine of
Daniel's failures pinned). Amended per the adversarial review
`videos/2026-07-28-bricks-fresh/scratchpad/adversarial-review-2026-08-04.md` (AMEND-THEN-SHIP,
5 blocking / 16 major / 8 minor — all folded in below). Era analysis: style/place anchor
conflation — probe-refuted *style* anchors were removed together with *place* anchors, whose
content bleed is the desired set-holding behavior. Prior shot work is quarantined; the video
regenerates fresh under the corrected doctrine.

## Keep / revert verdicts (Daniel, 2026-08-04)

- **KEEP** hardened flat-cel text (probe-proven), no rendered-scene style anchors any video
  (same-video L160→L100 bleed), two-tier cast law, digest pins, builder slates, retry overlays,
  three-state stamps, lint hard checks.
- **REVERT** seedless roots in *established places* (L89–L91 mechanism), the style contradiction,
  and bulk-substitution repair authoring (B3's wholesale generic→named conversion → L100–L101).
- **Two logged reversals** (decisions.md entries land with this wave — reversals unlogged get
  re-argued): (1) the 2026-08-04 "root scenes may run seedless again" ruling is *narrowed*, not
  voided — cross-place image seeding bleeds content (refuted); within-place plate seeding bleeds
  the set, which is the point; seedless stays legal for plates, single-use unbranded places, and
  no-place shot classes. (2) The 2026-08-03 review loosening is *re-scoped*, not reversed — see
  §1-Review; Daniel re-authorizes explicitly at the doctrine gate.

## 1. Doctrine changes ($0, land before any generation)

### Style — one voice, text-only
- `style-bible.md` §2b/§2c/§5: delete "gentle soft cel shading" and all soft/gradient-permissive
  wording; one positive recipe — flat base fill + at most one hard-edged single-step shadow per
  surface, even medium-thick #241a12 outlines, committed scene palette — stated once, cited
  everywhere else.
- `forge.py`: the scene descriptor derives from the bible's unified recipe; `HARDENED_SCENE_STYLE`
  may remain only as reinforcement of the *same* words (no second voice).
- VPW `global_prompt_suffix` inherits the recipe. Style lint splits three ways (M8):
  **(a) HARD, one-voice**: suffix + bible descriptor blocks carry no soft/gradient-permissive
  wording (two-string check). **(b) HARD, narrow render-technique ban in prompts** — exactly:
  `gradient`, `gloss/glossy`, `specular`, `bloom`, `depth-of-field`, `blurred background/behind`,
  `soft focus`, `photoreal*`, `subsurface`, `rim light`. **(c)** Scene-light nouns (`warm`,
  `amber`, `lamp glow`, `lit`) are never flagged; everything else is the reviewer's style axis.

### Place — pixels-only, per video
- **New first-class `place` key** in `visual-prompt-writer/references/shots-schema.md` (B2): a
  recurring diegetic set identity (e.g. `miniscribe-boardroom`), distinct from `stage` (a
  continuity chain *within* a place; stages stay capped 1 base + ≤3 deltas). Forge derives plate
  seeding from place-first, not stage-first; `place_anchor` becomes legal on any non-delta shot
  whose place is established (reversing the base-only restriction in forge + lint).
- **Place definition + exemptions** (M5): symbolic, abstract, and standalone object-insert shot
  classes declare no place and run as seedless roots under the hardened descriptor (probe-proven
  path); bound to the existing `shot_class` lint. Shorts `first_frame` and thumbnail are exempt.
- **Conditional plate law** (M4): a plate is required when a place hosts ≥2 shots OR carries
  owner branding under L-1. A single-use, unbranded place is its own place-first frame, seedless.
- **`plate` restored as a derived marker** (B3): first emitted shot of a place with no cast; the
  zero-seed exception keys to it in `resolve_request_seeds`. `--plate-candidates` and its dead
  filter are **deleted** (contradicts the one-candidate-per-place ruling; slimmer).
- **Same-place enforcement** (B5): forge refuses a `place_anchor` whose source shot's place
  differs from the anchoring shot's place; lint mirrors. Invariant: *a plate may only seed shots
  in its own place; cross-place image seeding is the probe-refuted style-anchor failure under
  another name.*
- **Place-owner rule**: institution-owned interiors author one visible owner cue on the plate or
  record intentional ambiguity. The literal is per-video data — sourced from the shot's `place`
  declaration + script vocabulary (`script_vocab`), registered with the existing
  `carried_literal_check` L-1 carry mechanism. Never a skill constant.
- **Place inventory verification**: every declared place maps to a `script.md` span; invented
  places fail lint like invented lettering.
- **Seed-cap displacement rule** (M3, stated in VPW SKILL with a worked example): the plate
  outranks the crowd exemplar when the plate already contains the rear-zone mass; a shot still
  exceeding `SEED_CAP=4` is restaged with fewer named cast, never truncated.

### Authoring feasibility — HARD lint = presence/omission; critic = judgment (M9/M10/M11)
- **Seat/support (HARD)**: a *named figure carrying a seated pose primitive* (registry binding,
  never the English verb "sits") must name a support object from a closed noun list
  (`chair|stool|bench|seat|crate|step|ledge|desk edge|sill`) + a contact phrase in the same
  sentence. Framing sufficiency is a soft heads-up + forced review row.
- **Two-cast plane/scale (HARD = presence)**: a 2-named-cast shot must state plane, eye line, and
  relative head scale; "dominant" resolves to posture/framing. Coherence of those clauses is a
  named forced question in `visual-prompt-writer/references/critics.md`.
- **Action-chain (HARD = presence)**: consecutive VO actions on the same props carry
  `stage`/`stage_role` or an explicit hard-cut declaration. Cause→effect readability is a critic
  question, not lint.
- **Semantic cast (HARD, narrow)**: fail only when `vo_text` names a generic plural role AND the
  shot declares a named character appearing nowhere in that VO span or its ±1 neighbours; all
  else to the critic. Docstring cites the B3 bulk-conversion mechanism.

### Process law (VPW SKILL)
- Repair rounds re-author each shot from its VO line; bulk vocabulary substitution banned.
- Fresh authoring **must not read the archived `shots.json`** (C6) — stated in the run brief.

### Forge gates
- **Verified-asset reuse** (M1): per-figure record store `visual-kit/_staging/review.json` (one
  entry per `fig-*`: `canonical_sha256`, `expression_sha256`, per-invariant verdicts, reviewer,
  date), written **only** by an extension of `stamp_review.py` (single-writer law). Gate applies
  to `batch`-emitted scene slates; missing record ⇒ refuse **with the one-line remint command**,
  never grandfather. This run starts with zero records by construction.
- **Parent provenance/depth**: manifest records scene-parent depth + longest canonical lineage; a
  child refuses a parent carrying any parked defect; propagated failure forces re-base. Must not
  collide with the existing verified-parent retry check (one refusal per condition, distinct
  wording).
- **Expression-delta** (M2): implemented as an extension of the existing delta path
  (`delta_primitives` / `seeding_law_violations`), not a parallel check: a delta authoring a
  changed expression supplies the expression primitive or a verified combined STEP-1, else refuse.
  **Carve-outs**: `defect: seed`/`mechanism` retry overlays, `no_hands` personified objects
  (canonical is the rig), thumbnails (own authored seeds).

### Review — machine-emitted, human-eyed (B4; re-scopes the 2026-08-03 loosening, gate item)
- `build_review_artifact.py` **pre-renders one empty verdict row per (shot × applicable
  invariant), pre-filtered by what the shot declares**: support/contact only where a seated
  primitive is authored, place-owner only on branded interiors, relative-scale only on 2-cast
  shots, crowd row only where crowd is declared, flat-cel hazards on all. Cost moves from typing
  to eye; aggregate "rig holds" sentences stay structurally impossible.
- Canonical-vs-candidate comparison **only on named-figure shots** (~105 of 214), at the
  ordinary-viewing-scale standard Daniel ratified — no zoomed crop battery.
- The `merged.json` → `stamp_review.py` contract shape (axes `f`/`s`/`r` + `dsg`, three-state
  stamp, single writer) is untouched.
- Human cost stated honestly: five boards of ~43 frames each is the real ask Daniel signs.

### Cross-file consistency in the same wave
- `image-generation/SKILL.md` batch law amended (M12): slice count set by the run's gate cadence;
  boundary rule preserved — a slice boundary falls on a stage boundary, a held stage never splits.
- Middle-path spec marked SUPERSEDED in-file (m7). Both reversal entries logged in
  `knowledge/decisions.md`.
- Named change targets: `shots-schema.md`, `critics.md`, `lint_shots.py`, `forge.py`,
  `stamp_review.py`, `build_review_artifact.py`, both SKILL.md files, `style-bible.md` (m1).
- Every code change lands TDD in the owning skill's test files; skill docs edited per
  `.claude/skills/README.md` design rules.

### Regression carve-outs (workers implement gates around these, verbatim from review §5)
Thumbnail gen (outside `batch`), shorts `first_frame` (no place), motion-planner plates/cutouts
(different "plate", same word — the layered-shot contract is untouched), surgical retry overlays
(`defect: seed`/`mechanism` fire no expression gate), `no_hands` objects, render/compliance
contracts (`--preview-parked`, three-state stamp, Gate-3). Review §6's changes-to-NOT-make list
(16 items) is a binding annex handed to every build worker.

## 2. Quarantine (executes in the MAIN checkout — the artifacts are gitignored and exist only there)

- Video assets: `assets/scenes/`, `assets/_review/`, thumbs, old boards, old `shots.json`,
  `shots.motion.json`/audio plan → **`assets/_archive-pre-reset/`** (inside `assets/` so the
  existing gitignore keeps 1.8 GB of binaries untracked — M13).
- **Channel staging (B1, the real STEP-1 store)**: every `fig-*` for this video's cast
  (`brick-foreman`, `qt-wiles`, `auditor-rep`, `hq-banker`, `miniscribe-rep`, `ibm-suit`,
  `terry-johnson`, `pc-boxy`) moves from `visual-kit/_staging/` to
  `visual-kit/_staging/_archive-pre-reset-2026-08-04/`. Rule: **no STEP-1 minted before the
  unified descriptor may seed any scene in this run.** Machine check: the fifth-1 dry-run must
  show every `fig-*` as `GENERATE`, never `REUSED`.
- Scene manifest reset = write `{"shots": []}`, never delete (an absent manifest disables the
  render gate — m5).
- **Stays live**: `script.md`, `research.md`, `vo.mp3` + `voiceover.manifest.json`, channel
  `visual-kit/refs/`, and **`assets/library/manifest.json`** (Pass-1 identity data, not output —
  M16; if the fresh author changes the cast, Pass 1 re-runs).
- Trees: doctrine/code changes land in worktree `kb-worktrees/boss-bricks-reset`; quarantine and
  the generation run execute in the main checkout (`C:/Users/danie/kb`), which holds refs,
  `_staging`, and `vo.mp3` (M14).

## 3. Doctrine gate ($0, Daniel signs before any paid call)

Acceptance artifact: (a) diff summary of every doctrine change; (b) **calibration run of all new
hard lints over the ARCHIVED `shots.json`** with per-check fire counts — proving M8/M9/M10/M11
calibration against real prose before authoring 214 shots against them; (c) the two decisions.md
reversal entries; (d) the review re-scope for explicit re-authorization; (e) budget of record:
the $30 wave cap's supersession decision (the fresh run's honest floor is ~$38.4 — 214 scenes
$28.68 + ~52 STEP-1s $2.03 + ~25 plates $3.35 + ~15% retries $4.29 — i.e. ~$8.6/fifth
realistic; per-lane plan-gate tables derive from the authored `shots.json`, not this estimate).

## 4. Style probe (~$0.40, after the gate, before any slice)

One plate + one reminted STEP-1 + **three composed frames across content classes** (figure-bearing
interior, crowd frame, prop insert — m3). Runs only after the B1 quarantine is closed (a probe
passing on fresh mints while the run would reuse 493 pre-reset figures certifies a lie). The
assembled descriptor bytes (`gen --dry-run`) are pinned in `decisions.md` so later text edits are
detectable regressions. Daniel rules flat/not-flat. Passed probe assets are reused, not
regenerated (reuse-before-regenerate).

## 5. Run plan

- VPW authors the **complete** `shots.json` once (whole-script view: place inventory, cast map,
  stage chains, retention cadence), from `script.md` alone, lint + whole-file forge dry-run clean.
  Word-sync acceptance: `vo_ref` anchors + word timings lint clean against the existing
  `voiceover.manifest.json` before any generation (m8). Thumbnail block authored as today;
  generated in the final fifth (m6).
- Generation runs in **fifths**, boundaries snapped to stage boundaries. Intra-fifth shape (M15):
  **lane 1 = the fifth's new plates → human plate verdict → promote to `assets/scenes/` → lane 2 =
  the fifth's scenes → fresh-eyes review → board → Daniel's verdict gates fifth N+1.**
- After every fifth's verdict: re-run lint + whole-file forge dry-run; any doctrine amendment
  forces re-authoring of the untouched tail shot-by-shot from each VO line (never bulk
  substitution), with re-authored ids + reasons in the fifth's genlog (M7).
- **Stop rule** (m4): a style failure in fifth 1 stops the run and reopens doctrine; no further
  paid call until a new $0 gate passes. Spend law per lane: plan-gate table first (§D), first-429
  fail-fast, one precision retry, 4-min stall + one re-issue, per-lane genlogs.

## Execution routing (this wave)

Claude subagents in the boss session (Daniel 2026-08-04, supersedes codex-only for this wave):
haiku mechanical, sonnet standard build, opus for review-gate code and adversarial review. Model
of every subagent verified at grading via transcript grep. Work branch
`claude/bricks-doctrine-reset` in worktree `kb-worktrees/boss-bricks-reset`; boss does git
plumbing and grading.

## Out of scope

Whole-video style rerender decisions beyond the fresh run; motion/audio replanning (replanned
after visuals settle); budget cap changes beyond the §3 record decision; the >L101
deferred-slice items (subsumed by fresh authoring). Tranche-E word-sync is NOT subsumed — it is
the m8 acceptance line above.
