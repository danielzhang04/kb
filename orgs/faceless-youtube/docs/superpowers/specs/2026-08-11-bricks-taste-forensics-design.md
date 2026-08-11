# Bricks taste-forensics + governance revision — design

**Date:** 2026-08-11 · **Branch:** `claude/bricks-taste-forensics` (cut from `claude/bricks-doctrine-reset` @ 2495d8c)
**Owner:** boss session (orchestrator only; all substantive work delegated, every grade model-grepped)
**Status:** approved design, awaiting Daniel's written-spec review

## Goal

Governance produces shots Daniel finds interesting again. The 6c2 wave regressed: shots read as
"too basic," named characters render as the base rig instead of their character, characters drift
off-rig, and background figures get cast-rig treatment where crowd treatment was wanted.

**Success condition (G4):** a ~10–15-shot validation slice re-minted under the revised governance
receives Daniel's verdict "recovered" on a side-by-side board against the prior generations; all
affected test suites green; adversarial review of the implementation passed; accepted rules logged
in `orgs/faceless-youtube/knowledge/decisions.md`. Validation spend cap **$5.00** under the daily
budget guard, ledgered.

## Input data (Daniel, 2026-08-11 — verbatim lists, authoritative)

Liked shots ("assume these are the ones I like most; unnamed = not necessarily liked"):

- **Old full-video board** (pre-reset generation, 214 shots, artifact 55b02d0d): L05–16, L19–44,
  L49/50, L76–88, L111, L113, L164, L212–215.
- **p6b board** (new doctrine, first tenth L01–L25, artifact b654a4d7): L1–18 except 07 and 10;
  L21–25. → 21/25 liked.
- **6c2 board** (new doctrine, second tenth L26–L50, artifact 767b9074): L26, L28 (with note: "the
  MiniScribe HQ — there was a better shot sometime prior"), L35, L37, L40–43, L49. → 9/25 liked.

Named defect taxonomy (open — Phase 0 may grow it): (a) too basic; (b) character is base rig
instead of character; (c) off-rig characters; (d) cast rig in background instead of crowd.

**L-number caveat:** old-board numbering is the pre-reset shots.json (214/215 shots); p6b/6c2 use
the 2026-08-06 re-authored 246-shot file. All cross-generation joins go by script beat / vo line,
never by L-number.

## First-pass signal (hypotheses to test, not conclusions)

1. All six shots seeded on L28's place plate (L29, L33, L44, L46, L47, L48) are unnamed/disliked;
   the liked L40→L41→L42 run is the parent-chained delta; L35/L37 are standalone metaphor frames.
   Hypothesis: single-plate reuse repetition reads as boring; evolving chains and standalone
   concept frames survive.
2. p6b 21/25 liked vs 6c2 9/25 under the same doctrine: the damage concentrates in what changed
   between the waves (6c2's seeding topology and delta-chaining), not the 08-06 reset per se —
   but the reset stays on the table (Daniel: "everything on the table").
3. Defects (b)–(d) map onto the 08-06 figure machinery: three-tier figure law routing, costumed
   performer minting, seeded-everyman routing, crowd re-scope, forge seed-cap ordered displacement
   (`0e7e8d8` — cards droppable under displacement), delta-chain face redraw (the L34/L39 parked
   mechanism). The rendering/routing half is a first-class suspect alongside VPW authoring.

## Scope of allowed change (Daniel's rulings, 2026-08-11)

- **Everything on the table**: doctrine laws, re-authoring shots.json (fully or per-act), reverting
  any governing file to a prior state, forge/VPW logic changes, combining function.
- **Generalized rules only**: no per-shot patches, no bolt-on micro-functions for individual fixes;
  change core logic so general rules cover the cases. Keep files slim; no dead information left.
- Approach: **A+C hybrid** — elicitation-first, measurements verify elicited hypotheses.
- Subsumes the pending R-A..R-E 6c2 gate rulings: R-A (ink seed) and R-D (saturation) become
  elicitation themes; R-B/R-C/R-E resolve in synthesis. The 6c2 board's own defects (charset,
  evidence derivation, lightbox) are NOT this wave's scope except that the Phase-0 elicitation
  board must not inherit them.

## Phases and gates

### Phase 0 — Taste elicitation → Gate G0

One worker builds a single self-contained elicitation board (artifact):

- Pairs by beat across generations (old-gen vs p6b vs 6c2 renders of the same beat, archives
  included — `assets/_archive-pre-reset/`, `_archive-pre-regen-2026-08-06/`, tranche boards — so
  the "better MiniScribe HQ from before" is found, not assumed).
- Contrast panels inside 6c2: liked chain L40–43 vs disliked L28-place-children; liked standalone
  L35/L37 vs disliked neighbors.
- Each panel carries 2–4 numbered questions (why is left better; staging, palette, figure acting,
  novelty; keep-rule or drop-rule). Every disliked shot gets defect-taxonomy tags (a)–(d) plus an
  open "other — name it" slot.
- Board requirements (learned from the 6c2 board review): `<meta charset="utf-8">` first, full-res
  lightbox with scrollable overlay, click-to-fullscreen + ←/→ nav, theme-token compliant, evidence
  sets derived from manifests — never hand-authored counts.

Daniel answers by question number in the terminal. **G0 = his answers lock the hypothesis set.**

### Phase 1 — Forensics (three parallel tracks, after G0)

- **Track A, archaeology (sonnet):** beat-map old↔new L-numbers via script/vo join; for every named
  shot pull each generation's shots.json prose (git history), the VPW doctrine version that
  authored it, and the style-bible/forge state that rendered it. Output: per-shot lineage dossier.
- **Track B, measurement (sonnet):** per liked/unliked set — seed topology (place-plate reuse
  counts, chain depth, parent types), median saturation, ink r−b, figure count, tier mix, prose
  features (length, verb density, staging clauses). Output: separation table — which measurables
  actually split the sets, tested against Daniel's G0 reasons.
- **Track C, routing trace (opus — this is the exploitable-surface read):** for every
  defect-tagged shot, reconstruct mechanically what forge did: which figures resolved to which
  tier, which STEP-1 cards entered the seed payload, which were displaced/dropped by the ordered
  seed cap, what the delta chain inherited — versus what the prose intended. Output: per-shot
  verdict "authored boring" vs "authored fine, rendered wrong," with the responsible mechanism.

### Phase 2 — Synthesis → Gate G2

One opus synthesis worker, full Phase 0+1 evidence: a change-list of **generalized** keep / remove
/ revert / add rules spanning both halves (VPW + authoring doctrine; figure-tier law + forge
routing/seeding). Reversions to prior file states are legal proposals. Each proposal: the rule,
evidence (Daniel's words + measurements + routing traces), files touched, blast radius (shots
affected across all 246), test impact. **G2 = Daniel rules per proposal, one at a time, in
plan order.**

### Phase 3 — Implementation (approved proposals only) → Gate G3

- Worktree `kb-worktrees/boss-taste-forensics`, branch `claude/bricks-taste-forensics`. Workers
  never commit; boss commits per reviewed unit.
- Opus workers change existing logic in place (no appended special cases); cross-file consistency
  sweep is part of each unit's acceptance.
- Full affected suites (forge tests, lint_shots, VPW tests) green; then an independent opus
  adversarial review of the complete diff; fixes applied; re-review if majors.
- **G3 = Daniel shown evidence (test output, review verdict), not claims.**

### Phase 4 — Validation re-mint → Gate G4

- Slice of ~10–15 beats chosen to cover the tagged failure modes (must include L28-cluster beats,
  a named-character beat that previously base-rigged, and a background-crowd beat).
- Minted under revised governance (forge `--kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit`,
  Windows python, 4-min stall ceiling + one re-issue), fresh-eyes verified (two disjoint
  verifiers, one stamping writer via `stamp_review.py`), boarded side-by-side with prior
  generations. **G4 = Daniel's recovered/not-recovered verdict = the wave's success condition.**
  Not recovered → findings feed back to a bounded second synthesis pass (one iteration; then
  stop and re-plan with Daniel).

## Constraints and laws that bind every worker

- Spend law: every paid mint pre-priced, ledgered to ops cost ledger; $5 validation cap; $0 dry
  runs preferred wherever the question is mechanical.
- `assets/**`, `_staging/`, `review.json` are gitignored machine-local; manifests carry shas;
  `stamp_review.py` is the sole writer of review.json.
- Coordination writes (ledgers, handoffs) → ops branch via temp-branch push; work products → this
  arc branch; never touch `main`/`ops` checkouts directly.
- Dispatch prompts name exact files/functions in scope, what NOT to touch, acceptance criteria;
  boss grades with model-grep (projects-path transcript, first line of grade) before accepting.
- 6c2's parked L34/L39 stay parked until the figure-mechanism proposals land (their fix is
  expected to fall out of proposals addressing defects (b)/(c)); do not plain re-roll.
- Phase 6c3+ minting stays frozen until G4 passes — 8 tenths must not inherit a regression.

## Out of scope

- Rebuilding/republishing the 6c2 gate board (separate fix-list, already reviewed).
- Motion, audio, render pipeline; metadata; publishing.
- Any change to governance/ or CLAUDE.md (human-edited only).
