# faceless-youtube — STATE

_Updated: 2026-07-19_

## Now
- Live repo imported into kb at `orgs/faceless-youtube` (working tree moved, same drive).
- Git history archived out-of-repo at `C:\Users\danie\faceless-youtube.git-archive`
  (HEAD `ae6a2e1`, branch `feat/pipeline-simplification`, 471 commits — inspectable via `git --git-dir`).
- Poyais (`channels/the-second-take/videos/2026-07-04-poyais/`, R10 rendered+verified) is PARKED
  at Daniel's watch-through gate 6 — UNTOUCHED by this import, including its 18 untracked
  post-gate-6 leftovers (`_superseded-*`, `*.pre-*`) which moved as-is.

## Next
- First kb-coordinated video run: **fyt-run-001** (`channels/the-second-take/videos/2026-07-19-wells-fargo`,
  prompt→render, stage-two work owned by the run orchestrator).
  Image-generation **Pass 1 complete** (3/3 cast locked, 4 calls, ~$0.54); **Pass 2 in progress**.
  Authorised by parent card `6a5d53ea-562cad3a` (Daniel's verbatim 2026-07-19 instruction,
  ~$15–30 one-video API budget). Resume state:
  `docs/handoffs/2026-07-20-wells-fargo-imagegen-pickup.md`.

## Blocked
- (none)

## Open governance question (not blocking)
- `governance/budget.yaml` sets `daily_usd_limit: 5.00` for API-billed steps, while
  `knowledge/stack.md` budgets **~$15–30 per full video**. No complete video fits inside one day's
  ceiling. The preamble gate currently passes only because image spend is never written to
  `ledgers/cost/` (all rows are `0.0` subscription steps), so the gate measures nothing real.
  Reconcile: raise the ceiling, formalise a per-run waiver, or start logging image spend.
