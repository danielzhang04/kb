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
  Image-generation **Pass 1 is complete** (3/3 cast locked, 4 calls, ~$0.54);
  **Pass 2 is halted** — see Blocked. Resume state:
  `docs/handoffs/2026-07-20-wells-fargo-imagegen-pickup.md`.

## Blocked
- **fyt-run-001 image-generation Pass 2 needs an attended spend decision from Daniel.**
  The batch (119 long-form scenes + 5 plate/cutout pairs + 3 thumbnails, ~130 calls) costs **~$17–18**
  against `governance/budget.yaml`'s **`daily_usd_limit: 5.00`**; `governance/risk-tiers.md` puts real
  money at **T4 — "never unattended, never carded"**. No authorising card exists for this run.
  Note the standing contradiction: `knowledge/stack.md` budgets ~$15–30 per full video, so the $5/day
  ceiling cannot fund *any* complete video — a governance question, not a per-run workaround.
