# fyt bricks-fresh doctrine-reset — cast+plates gate handoff — 2026-08-05

## Context
Daniel scrapped the old bricks-fresh generation ($4.12 shot-fix plan rejected: "change the logic before
changing the shots"). This arc rebuilt the doctrine (style text-only / place plates pixels-only, 12 pinned
contracts), quarantined all prior generated work, re-authored shots.json from scratch, and ran the Phase-6a
generation sweeps. Everything lives on branch `claude/bricks-doctrine-reset` (pushed through `1186f4c`).
Worktree `C:/Users/danie/kb-worktrees/boss-bricks-reset` (detached) was the workers' edit surface; the main
checkout holds the branch and all committed truth. Daniel added a HARD GATE: he reviews the cast+plates
artifact board before any shot generation. That gate is where this handoff stands.

## Done (evidence = commits on claude/bricks-doctrine-reset)
- **shots.json COMPLETE and generation-ready**: 248 shots / 541.3s, authored in fifths by 4 fresh opus
  agents (each graded: model grep + reproduced lint/dry-run). Whole-file: lint ZERO HARDs, forge dry-run
  zero refusals/seeding violations. `2cb1856`, repairs `037ac27`, verify `100b895`.
- **Full-file adversarial review** (opus) found 24 real defects (3 BLOCKING incl. a third badge instance
  L65; a backwards quota-ratchet L66; duplicated world L117/L153; thumbnail depicting the real Terry
  Johnson perpetrating a fraud he'd left — defamation risk, replaced). All closed by a scoped-repair worker,
  independently verified: 0 regressions. Evidence: `scratchpad/adversarial-full-file.md`, `repair-wave-1.md`,
  `repair-wave-1-verify.md`.
- **miniscribe-rep de-badged at the root**: canonical v2 in refs (boss-eye verified) + registry costume text
  fixed (the USB was pinned doctrine, not drift). `240aed7`.
- **Crowd-rig §2d**: variety bounded to 2–3 silhouettes/group, simplified face per-figure. style-bible in
  both checkouts. Decisions logged in `orgs/faceless-youtube/knowledge/decisions.md` (2026-08-05 entries).
- **Phase 6a sweeps DONE ($3.178)**: 8 place plates (7 minted + L28 probe reuse), 51 STEP-1 cast cards
  (48 sweep + 2 rifenburgh + 1 stamped reuse), rifenburgh-ceo canonical minted, boss-eye verified, PROMOTED
  to refs + registry (`e110a96`). 4 surgical retries all landed. Ledgers: `scratchpad/sweep-genlog.md`,
  `sweep-report.md`, `sweep-shas.md`.
- **Gate board PUBLISHED**: https://claude.ai/code/artifact/767b9074-aee3-4d3d-817f-1319f2187325
  (61 images, lightbox, 6 rulings listed). Probe board (flatness 5/5 pass):
  https://claude.ai/code/artifact/318536e2-c5ce-448c-b231-c59625c058b9
- Session spend: **$3.97 of the $40 wave cap** (probe 0.575 + probe-fixes 0.173 + STEP-1 remint 0.039 +
  sweeps 3.100 + rifenburgh cards 0.078). Cost-ledger rows on ops.

## Remaining (ordered)
1. **DANIEL GATE — 6 rulings at the board** (R-1..R-6 on the board page): L03 pallet count (retry unspent,
   $0.134); L196 original vs retry; L71 clone-rank crowd; L172 variety-bound violation (mechanism fix
   proposed in sweep-report §mechanism, not re-rolled); systemic soft skin shading (doctrine Q); standing
   crowd-variety veto.
2. **C-6 stamp after the gate**: `assets/_review/figure-verdicts.json` (51 figures, SHAs precomputed,
   verdicts empty) → fill per worker verification + Daniel rulings → `py -3 stamp_review.py --figures <file>
   <kit>/_staging`. Until stamped, forge REFUSES every staged figure as a seed — this is the hard blocker
   on the scene leg (verified live).
3. **Phase 6b — generate first 1/10** (~L01–L25 stage-snapped): canary-first, spend law, per-lane genlogs;
   then per-invariant review + honest stamps; update the gate board with shot frames.
4. Then Phase 7 close: final board refresh, this handoff superseded, cost rows, memory lessons.
5. Parked/owed: registry rows for auditor-rep/brick-foreman/hq-banker/qt-wiles (canonicals committed
   `e110a96`, entries missing — registry drift from fifth-1-era minting); L35 probe frame flagged (retry
   spent; §2d per-figure fix targets its defect class at next gen); payload-last doctrine question
   (verdict: needs-per-shot-authoring, see `repair-wave-1.md` §5 — Daniel decision); shorts: [] (SKILL
   Step 5 requires shorts if in scope — Daniel decision); 12 critic NOTEs in `fix-G4-report.md`; locked
   `Usersdaniekbtest-tmp-forge/` dir in main checkout root (needs admin); stray nested
   `orgs/faceless-youtube/orgs/faceless-youtube/...` scratch dir (F-clean sweep owed).

## Gotchas
- Run forge ONLY with `--kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit`
  (main-checkout kit holds .env/_staging/refs; worktree kit is a mirror, synced manually).
- Workers never commit; boss ports worktree→main and stages EXPLICIT paths (no `git add -A`).
- Grade every subagent: FIRST line = grep `"model":` in
  `~/.claude/projects/C--Users-danie-kb/<session>/subagents/agent-<id>.jsonl`.
- `_staging/` is gitignored: staged PNGs + review.json + archives live on this machine only.
- MSYS `/c/...` paths break Windows Python — use `C:/Users/...`.
- Old quarantined figs (`_staging/_archive-*`, `assets/_archive-pre-reset/`) must never seed anything.

## Load list
- orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/sweep-report.md
- orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/adversarial-full-file.md
- orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/repair-wave-1-verify.md
- orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/vpw-log-fresh.md (lessons 1–35)
- orgs/faceless-youtube/docs/superpowers/plans/2026-08-04-bricks-doctrine-reset.md (contracts C-1..C-12)
- Skill to drive generation: orgs/faceless-youtube/.claude/skills/image-generation/ (forge.py, stamp_review.py)
