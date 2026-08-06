# fyt bricks-fresh era-restoration + remint pickup — 2026-08-05

## Context
Continuation of the bricks doctrine-reset arc (supersedes the earlier 2026-08-05 gate handoff). At the
cast+plates board Daniel rejected register drift (thin lines, deep perspective, grey palettes) and ruled:
"go analyze HOW poyais created what it did and lean towards that." Archaeology found the era mechanism:
TWO style voices (era §2b at prompt head + a 643-char global_prompt_suffix at prompt TAIL), a pixel anchor
on EVERY gen (character canonicals; mandatory refs/env register exemplar on cast-free shots), 1K renders,
zero negation lists. Perspective drift mechanism: poyais had NO camera slot; the reset made `Framing:`
mandatory + stigmatized eye-level → 27 invented vantages. All fixes are REMOVALS/restorations — Daniel
explicitly rejected whitelists, banned-word lints, and image-derived adjectives. Boss adjudicated
keep/delete per item (logged in `orgs/faceless-youtube/knowledge/decisions.md`, 2026-08-05 era-restoration
entry). Branch `claude/bricks-doctrine-reset`, pushed through **`d1f771a`**.

## Done (all committed unless noted)
- **Era restoration implemented + graded** (452 tests green, zero lint HARDs, whole-file dry-run clean):
  era §2b verbatim, era suffix restored AND forge now actually appends it at tail (the old SKILL claim was
  stale — nothing appended it), HARDENED_SCENE_STYLE deleted, IMAGE_SIZE_DEFAULT 2K→1K, style tile =
  archived first-pass computer-shop frame registered + auto-seeded into cast-free gens, 16 dedup deletions.
  Report: `videos/2026-07-28-bricks-fresh/scratchpad/era-restoration-report.md`.
- **17 Tier-A camera-move shots re-authored** (vantage clauses DELETED not replaced; 4 restages keep each
  shot's idea; 231 shots byte-identical). Report: `scratchpad/tier-a-repairs.md`. Aisle one-points (10)
  kept per Daniel; ~20 recession-verb prompts kept — board renders are the evidence gate.
- **C-6 stamped**: 48 records in MAIN-kit `_staging/review.json` (46 board-approved cards + canonical-v2 +
  the deadpan STEP-1). The 4 flagged cards have NO record deliberately. `_staging/` is gitignored —
  machine-local, same machine required for pickup.
- **Registry near-miss caught + repaired**: the era worker regressed registry.json to an era-vintage copy
  (badge back, rifenburgh gone); boss rebuilt from git HEAD + tile entry. Lesson: after porting any worker
  output, diff DATA files against HEAD, not just code/tests.
- Earlier same-day (see git log): full shots.json (248, review-clean), Phase 6a sweeps ($3.28), miniscribe
  de-badge at root, crowd-rig §2d bounds, probe fixes. Boards: gate v1
  https://claude.ai/code/artifact/767b9074-aee3-4d3d-817f-1319f2187325 · probe
  https://claude.ai/code/artifact/318536e2-c5ce-448c-b231-c59625c058b9
- Spend: **$3.97** of the $40 wave cap, plus the in-flight remint (≤$4 ceiling).

## IN FLIGHT AT HANDOFF — the remint worker
An opus subagent was minting when this session handed off: **7 plates at 1K under era doctrine** (L03,
L28, L63, L71, L113, L172, L196; supersedes archived to `_staging/_pre-remint-archive-2026-08-05/`),
**L05 = $0 stage of the archived first-pass frame** (Daniel's pick, same frame as the style tile), **4 card
remints** (fig-auditor-rep--action-present--expr-deadpan, fig-qt-wiles--action-accuse--expr-deadpan,
fig-qt-wiles--action-present--expr-delighted — THREE ARMS each — and
fig-qt-wiles--action-armscrossed--expr-crestfallen — pale/cool face vs canonical tone). It writes
incrementally to `scratchpad/remint-genlog.md` + `scratchpad/remint-report.md` (worktree
`C:/Users/danie/kb-worktrees/boss-bricks-reset/...`) and builds `remint-c6-board.html` +
`remint-c6-figures.json` when done. **On pickup: reconcile its disk state first** (ledger vs `_staging/`
listing). If it died mid-run, resume the remainder with the same brief pattern (canary-first, $ remaining
from its ledger). Its transcript for model-grading:
`~/.claude/projects/C--Users-danie-kb/1b21aff8-77c9-4b46-88f5-c372aea64680/subagents/agent-a999727556a615895.jsonl`.

## Remaining (ordered)
1. Reconcile/grade the remint (model grep FIRST line of the grade; eye-verify every plate + the 4 cards
   against era register: even medium-thick warm outline, frontal eye-level, warm-leaning palette, arm
   counts, crestfallen tone).
2. Port worktree→main (diff DATA files vs HEAD — registry lesson), commit explicit paths, push. Add the
   remint cost row to `ledgers/cost/root-2026-08-05.tsv` on ops (genlog is authoritative).
3. **Board v2**: rebuild `scratchpad/cast-plates-board.html` (builder script pattern:
   `<session-scratchpad>/build_cast_board.py` from this session — rewrite is fine; lightbox + ←/→ per
   memory law) with new plates + reminted cards + superseded thumbnails; publish to the SAME URL by
   passing `url: https://claude.ai/code/artifact/767b9074-aee3-4d3d-817f-1319f2187325`. Include the
   palette question: era palettes were authored warm per shot (93% "warm"); fresh file is cooler — the v2
   renders are the evidence for/against a palette pass. **DANIEL GATE at the board.**
4. After his approval: stamp the reminted assets (fill `remint-c6-figures.json` verdicts →
   `stamp_review.py --figures <file> <kit>/_staging`), then **Phase 6b**: generate first 1/10 of shots
   (~L01–L25 stage-snapped), canary-first, spend law, per-lane genlogs, per-invariant review + honest
   stamps, board update.
5. Phase 7 close: final board, supersede this handoff (delete on pickup, write new if pausing), memory
   lessons, `git fetch --prune` sweep, tree clean on a work branch.
6. Parked: registry rows owed for auditor-rep/brick-foreman/hq-banker/qt-wiles (canonicals committed,
   entries missing); L35 probe frame banked (defect class now targeted by §2d per-figure rule); payload-
   last verdict = needs-per-shot-authoring (Daniel decision, `repair-wave-1.md` §5); shorts: [] decision;
   12 critic NOTEs in `fix-G4-report.md`; locked `Usersdaniekbtest-tmp-forge/` dir (needs admin); stray
   nested `orgs/faceless-youtube/orgs/faceless-youtube/` scratch dir (F-clean).

## Gotchas
- Forge ONLY with `--kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit`
  (main kit holds .env/_staging/refs; the worktree kit is a manually-synced mirror — sync BEFORE
  dispatching any worker that reads it).
- Workers never commit; boss ports and stages EXPLICIT paths. Grade every worker: first line = model grep
  of its subagents jsonl. Old archives (`_archive-*`) never seed anything.
- MSYS `/c/...` paths break Windows Python — use `C:/Users/...`. `_staging/` + `review.json` are
  gitignored, machine-local.
- Daniel's working style: context in prose BEFORE any option widget; no unexplained jargon in options;
  no bloat — no specific fixes where core logic covers, no new checking layers (taste → exemplar+critic
  per governance G-route).

## Load list
- orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/era-restoration-report.md
- orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/poyais-mechanism-archaeology.md
- orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/tier-a-repairs.md
- orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/remint-report.md (+ remint-genlog.md — in-flight state)
- orgs/faceless-youtube/knowledge/decisions.md (2026-08-05 entries — the adjudications)
- Skills: orgs/faceless-youtube/.claude/skills/image-generation/ (forge, stamp_review, build_review_artifact) + visual-prompt-writer/ (lint)
