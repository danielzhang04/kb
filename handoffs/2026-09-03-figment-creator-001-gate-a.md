# figment creator-001 — overnight build parked at GATE A — 2026-09-03

**Topic:** The build terminal took the creator-001 mandate from "anchor set + pod harness" to a reviewed spec,
a reviewed plan, hardened harness, built stages P1/P2/P4b/P4e/P4f, and a LIVE expansion-02 run (60 cells, 6 pods,
$2.28) that is now parked on the blind board for the operator's eye-gate. Everything is on `claude/figment`
(HEAD `dfee3ba5`, pushed, unmerged). Two cards on `ops`: build card `b618941b-dbd9c768`, spend card
`044ea509-1b337cf6`. This handoff supersedes `2026-09-03-figment-anchor-first-overnight-build.md` (consumed).


### UPDATE 2026-09-03 21:05 — expansion-02 failed identity; expansion-03 (arm A) is the board to grade
- Operator viewed the expansion-02 board: "90% wrong" — different women. Root cause: free generation from an empty
  latent with 180-word scene prompts. Batch kept as evidence only.
- expansion-03 = the package's reference-conditioned EDIT method ported: verified klein multi-ref graph, target anchor
  as canvas, ≤25-word edit prompts, 12 templates × 3 anchors. Paired A/B pilot ($0.62): arm B (img2img 0.28-0.35)
  = near-copies; arm A = true edits, identity held. Rotation wording fixed ("a quarter turn, face toward camera").
- Batch `batches/expansion-03/`: 36 cells, $1.44, 35 scored, own-anchor median 0.864 (calibrated floor 0.836;
  anchors pairwise 0.886-0.926), 1 no-face. Blind board 35 cards; stage awaiting-eye-gate-a (e723a1ec).
  Cards: pilot/full 57c33efe (done); eye-gate 65d8f246 retargeted. Branch HEAD 3d046460.
- Exact next step: rule `batches/expansion-03/board.html` (NOT expansion-02) → qa_stamp → GATE A → curated set
  (regenerate culled templates with new seeds if < 30) → P5 → LoRA v1.

### What WORKED (with evidence)
- **Research pass, claim-checked** — r15 package artefacts (168 files, all 8 workflow JSONs' settings, .bat audit
  7/7 clean, 3 compliance rejections) 43/47 verified; r15b video lessons ×3 (faster-whisper narration, 114 rows
  checked, 7 corrected); r16 detail passes (28 checked, licences resolved); r17 video+voice (16/18 verified, no
  hallucinated models); r18 Instagram playbook (cohort = carousel-first 61%, 3:4 stills, 2-5 slides; 15/30 verified,
  0 wrong); r19 multi-account ops (API-first via Instagram Login; collab/trial reels API-supported). Commits
  22c5e79f…57221caf.
- **Spec v3** — `docs/superpowers/specs/2026-09-03-figment-creator-001-design.md` (699 lines) after two codex-sol
  adversarial rounds (REVIEW: 4 blockers; REVIEW2: 3 blockers), all folded under boss rulings (0e93ad63).
- **Plan v2** — `docs/superpowers/plans/2026-09-03-figment-creator-001-p1.md` (7 tasks, sonnet review APPROVE
  WITH FIXES folded, c92266c2).
- **Harness hardened** — REVIEW-e (opus, 21 findings) → codex-sol fixes 1-17,20 (4efea0de, f5ba643b) → P0R sonnet:
  expansion-02 live-safe YES, training YES with conditions (REVIEW-P0R-2026-09-03.md). 152 pod+train tests.
- **P1** persona.yaml + persona.py + gates.py (SHA-bound gate.json) + expand/batch_state.py (reducer, stages) +
  7-axis rulings fail-closed in qa_stamp.py + raw-only identity metrics + anchors moved to
  `orgs/figment/personas/creator-001/anchors/` (a1d78fdf, d557a6ea).
- **P2** `expand/build_expansion_set.py`: deterministic 60-cell allocation (40 strata + 20 replicates), 6 shard
  manifests (10 jobs, 360 s, 82 min, verbatim composite-02 blocks), captions, dry-run transcript; byte-identical on
  re-run (28c8988d, e1b8367b). **P2R (opus) LIVE-SAFE YES**, 270 tests, six dry runs re-verified.
- **P4b/P4e/P4f** content taxonomy + CT-1..7 + RT-1..6 (e67693e7); nine `agents/figment-*.md` + workflow DAG with
  gates S-H (1af90eed); `orgs/figment/HEARTBEAT.md` seven cadences `armed: false` (c5de16e1).
- **Live run** — six pods sequentially via a verify-between-shards driver: each 10/10 cells, terminate + absence
  verified, ledger row = run.json; $0.36-0.39 per pod, 159 s/cell steady, 260 s cold first job. Harvest 6/6;
  identity_check raw-only 60 scored; 4 no-face quarantined; blind pool + board 56; stage `awaiting-eye-gate-a`
  (6de153d9). `runpod_run.py status` = zero pods, arc $5.13.
- Models graded by transcript grep: opus for browsing/review/spec/P2R, sonnet for claim-checks/builds/folds, codex
  sol/terra for research/fixes/spec reviews/plan.

### What Did NOT Work (and why)
- **Opus 529 Overloaded ×3** (spec fold, P0R) — resumed once via SendMessage, died again; finished with sonnet.
  **Codex backend 404** on all four parallel build dispatches — built on sonnet under one card instead. An **opus
  P0R pass is still owed before any training pod**.
- **`codex --follow-up` loses `--cwd`** (again) — the builder-sharding follow-up refused to write; fresh dispatch fixed it.
- **Three concurrent codex dispatches wedge `codex login status`** (15 s) — timeout raised to 60 s in
  `scripts/codex_dispatch.py` (boss branch, uncommitted there) + 25 s stagger.
- **claude-video-vision MCP crashed on whisper** for every video — settings came from frames + JSONs; narration
  recovered with faster-whisper (installed) via a detached script (transcripts under the gitignored package dir).
- **v1 spec numbers were guesses**: "a klein cell is seconds" (measured 157-165 s), 18 cells/pod at 120 s, an
  unledgered network volume. Fixed by reading composite run.json files. Then 300 s had only 13% margin over the
  260 s cold job → 360 s.
- **pytest temp roots**: ACL-locked leftovers + a >260-char scratchpad path broke the ledger tmp file; use a short
  fresh `PYTEST_DEBUG_TEMPROOT` per run.
- **`facenet_pytorch` missing for `py -3`** (tests use mock embedders) — installed `--no-deps`; scoring then ran.
- **Harvest/apply gaps**: quarantined PNGs stayed in `images/` (board built with 60 until moved) and batch stage
  stayed `building` (strict one-step transitions). Moved by hand; fold into the CLIs (see Not tried).
- **Eromify template catalogue** (r18 §9): browser navigation classifier-refused; only nav-level names recovered.

### What Has NOT Been Tried Yet
- Operator eye-gate on `board.html` (open locally; do NOT open `blind-key.json`); rulings via `qa_stamp.py` with
  all seven axes; then `gates.write_gate` GATE A; curated ≥40 with stratum coverage (`require_strata_coverage`).
- Fold the file-move + stage-step into `build_expansion_set.py harvest` / `batch_state.py apply`; add an import
  smoke for lazy model deps to preflight.
- P4a pass manifests, P4c/P4d schemas, skills (figment-runner), P5 training-path prep (job_timeout 6000 /
  readiness 1200 / max_minutes 180; opus P0R), S2b swimwear batch, S2c full-body pass, P7 LoRA v1 with the
  dataset-tester (all GATE-BLOCKED per spec §9).
- Steps trim experiment (50 → 28) for throughput, on non-identity cells only.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/figment/personas/creator-001/batches/expansion-02/{batch.json,scores.json,pod-runs/}` | DONE | tracked pre-gate metadata; `images/` 56, `rejected/` 4, `blind/`, `blind-key.json`, `board.html` gitignored local |
| `orgs/figment/pipeline/expand/` | DONE | builder, batch_state, 6 manifests, allocation, captions, P2R verdict |
| `orgs/figment/pipeline/{persona.py,gates.py,qa_stamp.py,blind_pool.py,build_grading_board.py,tests/}` | DONE | P1 |
| `orgs/figment/pipeline/train/identity_check.py` | DONE | raw-only mode, cell_id join, `--out` file |
| `orgs/figment/pipeline/pod/` | DONE | fixes + REVIEW-e + REVIEW-P0R records; 18/19/21 deferred (low) |
| `orgs/figment/pipeline/content/`, `agents/figment-*.md`, `orgs/figment/workflows/`, `orgs/figment/HEARTBEAT.md` | DONE | P4b/P4e/P4f |
| `docs/superpowers/specs/2026-09-03-figment-creator-001-design.md` (+REVIEW, REVIEW2) | DONE | v3 |
| `docs/superpowers/plans/2026-09-03-figment-creator-001-p1.md` (+REVIEW) | DONE | v2; Task 7 executed |
| `orgs/figment/research/r15*, r16-r19` | DONE | claim-checked |
| `orgs/figment/{_index,STATE,contract}.md` | DONE | STATE has the parked state |
| `governance/budget.yaml` | DONE (branch only) | 10.00 by operator ruling; human-edited elsewhere |
| `ledgers/cost/figment-2026-09-0{2,3}.tsv` | DONE | published to ops with this handoff |
| `scripts/codex_dispatch.py` (main checkout, claude/boss-2026-09-02) | WIP | 60 s auth timeout, uncommitted |
| `orgs/figment/research/10sorlabs-package/` | untracked bulk | 168 files + transcripts, gitignored |

### Exact Next Step
Open `C:\Users\danie\kb-worktrees\figment\orgs\figment\personas\creator-001\batches\expansion-02\board.html`
in a browser and rule every card on all seven axes; then a terminal runs `qa_stamp.py` over the rulings, writes
GATE A via `gates.write_gate`, and applies `require_strata_coverage` before selecting the 40. Do not train, render
or post before that gate. Then P5 with an opus P0R pass, then P7.

### Load list
- `orgs/figment/STATE.md`, `orgs/figment/MANDATE.md`, `orgs/figment/pipeline/GUARDRAILS.md`
- `docs/superpowers/specs/2026-09-03-figment-creator-001-design.md` (§9 build order, §6 cards)
- `docs/superpowers/plans/2026-09-03-figment-creator-001-p1.md` (Task 7 tail: what a continuation may do)
- `orgs/figment/pipeline/expand/REVIEW-2026-09-03-expansion-02.md` (P2R + boss delta)
- `orgs/figment/personas/creator-001/batches/expansion-02/batch.json`, `scores.json`
- `memory/claude-boss.md` (2026-09-03 sections)
- Skills: save-session, dispatch-codex, superpowers:executing-plans
