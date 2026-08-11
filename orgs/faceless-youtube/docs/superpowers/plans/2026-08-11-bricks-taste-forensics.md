# Bricks Taste-Forensics + Governance Revision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize VPW + image-gen governance by extracting what makes Daniel's liked shots good and what makes disliked shots bad, then applying approved generalized keep/remove/rollback rules.

**Architecture:** Five phases with human gates G0–G4 (spec: `../specs/2026-08-11-bricks-taste-forensics-design.md`). Boss session orchestrates; every substantive task runs in a dispatched subagent (sonnet = mechanical/archaeology, opus = routing trace/synthesis/implementation/adversarial review); every grade starts with the model-grep line. Phases 0–2 are read-only on governing files.

**Tech Stack:** Windows python 3.x (never MSYS paths), git archaeology on `claude/bricks-doctrine-reset` lineage, forge/stamp_review tooling in `orgs/faceless-youtube/.claude/skills/image-generation/scripts/`, self-contained HTML artifact boards.

## Global Constraints (from spec — binding on every task)

- No governing-file change before its G2 approval: doctrine, skills, forge, style-bible, shots.json, lint stay untouched through Phases 0–2. Scratchpad/dossier/board writes exempt.
- Rollback over addition: reduce/roll back offending parts of current files toward the version that worked; new function only with explicit why-no-rollback justification.
- Generalized rules only — no per-shot patches, no bolt-on micro-functions.
- Workers never commit; boss commits per reviewed unit on `claude/bricks-taste-forensics` (worktree `C:/Users/danie/kb-worktrees/boss-taste-forensics`).
- Spend: $0 through Phase 3; Phase 4 cap $5.00, pre-priced, ledgered to ops. 4-min stall ceiling + one re-issue per gen request.
- `assets/**`, `visual-kit/_staging/`, `review.json` are gitignored machine-local. `stamp_review.py` is the sole writer of review.json. Forge only with `--kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit`.
- All analysis outputs land in `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/` (create it; committed).
- Cross-generation shot joins by script beat / vo_text, never by L-number.
- Daniel's liked lists + defect taxonomy: copy from spec "Input data" verbatim — they are the ground truth; never re-infer them.

---

### Task 0: Evidence inventory + beat map (Phase 1 Track A prerequisite, runs BEFORE the elicitation board so the board can pair by beat)

**Dispatch:** sonnet subagent.
**Files:**
- Create: `scratchpad/taste-forensics/beat-map.json`
- Create: `scratchpad/taste-forensics/generations-index.json`
- Read-only sources: `videos/2026-07-28-bricks-fresh/shots.json` (current, 246 shots), git history of that path (`git log --follow --format='%h %cd %s' -- .../shots.json`), the pre-reset shots.json version (parent of `d680fda`), board HTMLs in `scratchpad/` (`full-board.html`, `p6b-board.html`, `6c2-board.html`, `tranche-a-board.html`, `tranche-b-board.html`), `assets/_archive-pre-reset/`, `assets/_archive-pre-regen-2026-08-06/`, `assets/scenes/` + `manifest.json`, `visual-kit/_staging/`.

**Interfaces:**
- Produces `beat-map.json`: array of `{beat_id, vo_text, old_L (214-file), new_L (246-file), boards: [{board, card_id}], renders: [{path_or_board, generation_tag, date}]}` covering AT MINIMUM every shot Daniel named (spec Input data) and every unnamed shot on the p6b/6c2 boards.
- Produces `generations-index.json`: for each named beat, every discoverable render generation (archive PNGs by sha, board embeds by board+card, canonical scenes) with provenance commit/date — this is what finds "the better MiniScribe HQ from before."

- [ ] **Step 1:** Dispatch worker with brief: exact source list above; join technique = vo_text/script-line fuzzy match between old and new shots.json (`still_prompt` + `vo_text` fields), then verify each join by eye against board card text; output schemas as above; acceptance = every Daniel-named shot has a beat-map row with ≥1 render per generation that exists on disk or in a board, and ambiguous joins are flagged `join_confidence: low` rather than guessed.
- [ ] **Step 2:** Grade (model-grep first line), spot-check 5 joins by opening the referenced board cards and comparing vo text.
- [ ] **Step 3:** Boss commits `taste-forensics/` outputs.

### Task 1: Elicitation board build (Phase 0)

**Dispatch:** opus subagent (board logic burned us in the 6c2 review; this board gates everything).
**Files:**
- Create: `scratchpad/taste-forensics/_build_elicit_board.py`
- Create: `scratchpad/taste-forensics/elicit-board.html`
- Read-only: `beat-map.json`, `generations-index.json`, board HTMLs (image extraction), archives, `assets/scenes/`.

**Interfaces:**
- Consumes Task 0's `beat-map.json` schema.
- Produces `elicit-board.html` with stable question ids `Q1..Qn` and a machine-readable manifest `elicit-questions.json` (`{qid, panel, images: [...], question_text, answer_type: free|tag|keep-drop}`) the G0 recorder (Task 2) fills in.

Board content requirements (from spec Phase 0):
1. Beat panels: for each beat where Daniel liked one generation over another (or noted "better prior" — L28 HQ), all generations side by side, labeled with generation tag + date only (no leading captions that bias the answer).
2. Contrast panels inside 6c2: liked chain L40–43 vs the six L28-place-children (L29, L33, L44, L46, L47, L48); liked standalones L35/L37 vs disliked neighbors L36/L38.
3. Every disliked shot carries taxonomy tag checkboxes (a) too basic (b) base rig instead of character (c) off-rig character (d) cast rig in background instead of crowd (e) other — name it.
4. 2–4 numbered questions per panel: why is X better (staging / palette / figure acting / novelty / other), which rule would you keep, which would you drop.
5. Mechanics: `<meta charset="utf-8">` first; full-res lightbox (source-resolution data URI, separate from grid thumb), scrollable overlay (`#lb{overflow:auto}`); ←/→ + Esc; theme tokens on `:root` with dark redefinition in both `prefers-color-scheme` guard and `[data-theme=dark]`; all counts derived from the manifests, assert-guarded; ≤15.5MB output (assert).

- [ ] **Step 1:** Dispatch worker with the requirement list + the 6c2 board review findings summary (C1, H1, H2, H3, M3, M6 as anti-patterns to not reproduce).
- [ ] **Step 2:** Grade (model-grep), then boss verifies: python asserts pass on rebuild, grep confirms charset first node, spot-open 3 panels, file size, question count ≥ 25.
- [ ] **Step 3:** Boss commits builder + board + `elicit-questions.json`, publishes board as NEW artifact (own URL, favicon 🧱), hands URL to Daniel.

### Task 2: G0 — Daniel answers (HUMAN GATE)

- [ ] **Step 1:** Daniel answers by question number in terminal (multiple messages fine).
- [ ] **Step 2:** Boss records answers VERBATIM into `scratchpad/taste-forensics/elicit-answers.md` (qid → answer), asks follow-ups only where an answer is ambiguous against its question, commits.
- [ ] **Step 3:** Boss writes `hypotheses.md`: each hypothesis stated falsifiably, each traced to answer qids. Daniel confirms the hypothesis list. **G0 locked.**

### Task 3: Forensics Track A — governance archaeology (Phase 1)

**Dispatch:** sonnet subagent.
**Files:**
- Create: `scratchpad/taste-forensics/dossier.json`
- Read-only: git history of `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/**`, `.../image-generation/**` (forge.py, style-bible, registry), `channels/the-second-take/visual-kit/**` committed docs, shots.json all versions, `knowledge/decisions.md`.

**Interfaces:**
- Consumes `beat-map.json`, `hypotheses.md`.
- Produces `dossier.json`: per named shot × generation: `{beat_id, generation, shots_json_prose, authored_under: {vpw_commit, doctrine_files: [{path, commit}]}, rendered_under: {forge_commit, style_bible_commit}, prose_delta_vs_prior_gen}`.

- [ ] **Step 1:** Dispatch with the exact governance file list + technique: `git log --format='%h %cd' -- <path>` to find the version in force at each render date (render dates from generations-index provenance); acceptance = every liked/disliked named shot has complete rows, no "unknown" without a stated reason.
- [ ] **Step 2:** Grade (model-grep), spot-check 3 rows against git show.
- [ ] **Step 3:** Boss commits.

### Task 4: Forensics Track B — measurement (Phase 1)

**Dispatch:** sonnet subagent.
**Files:**
- Create: `scratchpad/taste-forensics/measurements.json`, `measure.py`
- Read-only: renders per `generations-index.json`, manifest seeds, shots.json versions.

**Interfaces:**
- Consumes `beat-map.json`, `generations-index.json`, `hypotheses.md`.
- Produces `measurements.json`: per shot: `{beat_id, generation, seed_topology: {seed_type, place_plate_id, chain_depth, plate_reuse_count}, median_sat, ink_r_minus_b, figure_count, tier_mix, prose: {words, staging_clauses, distinct_props}}` + `separations.md`: which measurables split liked vs disliked at what margin, and which G0-stated reasons the numbers support/contradict.

- [ ] **Step 1:** Dispatch; measurement code follows the existing verify-record conventions (same sat/ink metrics used in `6c2-w2verify-*.json` so numbers are comparable); acceptance = every metric computed for both liked and disliked sets across generations, separations stated with margins, contradictions of G0 answers flagged not suppressed.
- [ ] **Step 2:** Grade (model-grep), re-run `measure.py` fresh to confirm determinism, spot-check 3 values against the 6c2 verify records.
- [ ] **Step 3:** Boss commits.

### Task 5: Forensics Track C — forge routing trace (Phase 1)

**Dispatch:** opus subagent (exploitable-surface read of forge internals).
**Files:**
- Create: `scratchpad/taste-forensics/routing-trace.json`, `routing-findings.md`
- Read-only: `image-generation/scripts/forge.py` (+ its tests), shots.json (current + pre-reset), `visual-kit` registry/cards, genlogs (`6c2-genlog.md`, p6b logs), manifest seeds.

**Interfaces:**
- Consumes `beat-map.json`, taxonomy tags from `elicit-answers.md`.
- Produces `routing-trace.json`: per defect-tagged shot: `{beat_id, figures: [{name, prose_intent_tier, resolved_tier, card_in_payload: bool, displaced_by_seed_cap: bool, chain_inheritance: parent|canonical|none}], verdict: authored_boring|authored_fine_rendered_wrong, mechanism}` and `routing-findings.md`: the mechanisms ranked by blast radius across all 246 shots.

- [ ] **Step 1:** Dispatch with named suspect mechanisms from spec (three-tier routing, seed-cap ordered displacement `0e7e8d8`, delta-chain face redraw, crowd re-scope, seeded-everyman routing) + instruction: reconstruct by reading forge code paths against each shot's actual spec/genlog, dry-run forge payload construction where possible ($0 — no gen calls), never infer from pixels alone.
- [ ] **Step 2:** Grade (model-grep), verify 3 traces by independently reading the forge path for those shots.
- [ ] **Step 3:** Boss commits.

### Task 6: Synthesis → change-list (Phase 2)

**Dispatch:** opus subagent, fresh context, full evidence pack.
**Files:**
- Create: `scratchpad/taste-forensics/change-list.md`
- Read-only: everything in `taste-forensics/` + the governing files + their git history.

**Interfaces:**
- Consumes all prior outputs.
- Produces `change-list.md`: numbered proposals `P1..Pn`, each: `{rule (generalized), class: keep|remove|rollback|new, evidence: (qids + measurements + trace rows), files_touched (exact paths, exact sections/functions), rollback_target_commit (if class=rollback), why_no_rollback (REQUIRED if class=new), blast_radius (shots affected of 246), test_impact, ordering_dependency}`.

- [ ] **Step 1:** Dispatch with the rollback-over-addition law quoted verbatim + generalized-rules-only constraint + instruction that proposals must span both halves (VPW/authoring + figure-law/forge) where evidence points there.
- [ ] **Step 2:** Grade (model-grep). Boss adversarial pass: for each proposal, check evidence rows actually exist and say what's claimed; check no proposal is a per-shot patch in disguise; check every `new` has a real why-no-rollback.
- [ ] **Step 3:** Boss commits change-list.

### Task 7: G2 — Daniel rules the change-list (HUMAN GATE)

- [ ] **Step 1:** Present proposals ONE AT A TIME in plan order, each with its evidence and blast radius in prose (no unexplained jargon). Record verdicts in `change-list.md` (`verdict: approved|rejected|deferred + Daniel's words`).
- [ ] **Step 2:** Commit ruled change-list. Approved set = Phase 3 scope. **First governing-file change is allowed only past this line.**

### Task 8: Implementation of approved proposals (Phase 3) — template, instantiated per proposal after G2

For each approved proposal Pk, in `ordering_dependency` order, one opus worker per proposal (or per coupled cluster), TDD:

- [ ] **Step 1:** Write the failing test first — a test that pins the NEW intended behavior (for rollbacks: the factor-A behavior that regressed; test lands in the owning suite: `test_forge_*.py` for forge, lint fixtures for lint, doctrine-consistency checks for doc-enforced rules). Run; expect FAIL; record output.
- [ ] **Step 2:** Apply the change per proposal class — rollback = `git show <rollback_target_commit>:<path>` as the base for the reverted section, reduced into the current file (not wholesale file replacement unless the proposal says so); keep = often a test-pin only; remove = delete rule + its enforcement + its tests; cross-file consistency sweep is in-scope for the worker.
- [ ] **Step 3:** Run owning suite + full affected suites (forge tests, lint_shots, VPW tests). Expect green; record counts.
- [ ] **Step 4:** Grade (model-grep) + boss reviews diff against proposal scope (nothing outside `files_touched`).
- [ ] **Step 5:** Boss commits: `gov(bricks-fresh): Pk — <rule> (class, blast radius, tests N green)`.

- [ ] **After all proposals:** dispatch independent opus adversarial reviewer over the COMPLETE Phase-3 diff (`git diff <pre-P1>..HEAD`) with the spec + ruled change-list; findings fixed by a follow-up worker; re-review if any major. Record verdict in `taste-forensics/adversarial-review.md`; commit.
- [ ] **G3 (HUMAN GATE):** show Daniel test evidence + review verdict. Proceed on his word.

### Task 9: Validation re-mint (Phase 4) → G4 (HUMAN GATE)

- [ ] **Step 1:** Boss + Daniel pick the slice (~10–15 beats; must include L28-cluster beats, a previously-base-rigged named-character beat, a background-crowd beat; plus 2–3 beats Daniel picks freely). Pre-price at current per-gen rates from `6c2-genlog.md`; confirm ≤ $5.00; write `taste-forensics/validation-slice.json`.
- [ ] **Step 2:** Dispatch mint worker: forge batch per image-generation skill, `--kit` path verbatim, 4-min stall + one re-issue, all frames to `_staging`, $ per request logged.
- [ ] **Step 3:** Two disjoint fresh-eyes verifiers (sonnet) with the SAME metrics as Task 4; one stamping writer via `stamp_review.py`. No self-verification.
- [ ] **Step 4:** Build side-by-side board (reuse Task 1 builder, new manifest): each validation frame next to its prior generations. Publish as new artifact.
- [ ] **Step 5:** Ledger spend to ops (temp branch off `origin/ops`, push `<sha>:ops`).
- [ ] **Step 6:** **G4:** Daniel verdicts recovered/not. Recovered → wave done: update `knowledge/decisions.md` with accepted rules (worker), `STATE.md` refresh, handoff via save-session, lessons to `memory/claude-boss.md`, unfreeze 6c3. Not recovered → ONE bounded second synthesis pass (Task 6 rerun scoped to the failing qualities), then stop and re-plan with Daniel.

## Self-review notes

- Spec coverage: Phase 0→Task 1-2, Phase 1→Tasks 0,3,4,5, Phase 2→Task 6-7, Phase 3→Task 8, Phase 4→Task 9; R-A/R-D subsumption lands in Task 1 panel themes (ink/saturation questions) via spec; parked L34/L39 handled post-G2 (Task 8 scope if their mechanism proposals approved — spec constraint restated in Global Constraints).
- No placeholder scan hits; Task 8 is a template by necessity (content exists only after G2) but every step states its actual procedure.
- Type consistency: `beat-map.json` schema consumed by Tasks 1, 3, 4, 5 as defined in Task 0; qids from Task 1 consumed by Tasks 2, 4, 6.
