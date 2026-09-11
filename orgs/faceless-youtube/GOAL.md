# faceless-youtube — GOAL
_Ruled: 2026-08-21_

## North star
Faceless YouTube channel pipeline (`the-second-take`): prompt -> researched script -> generated
imagery -> rendered video -> human-gated publish. Legacy working tree imported into kb
2026-07-19; project law is Stage-0 human-gated (Daniel approves every publish).

## Success conditions
- Poyais video (R10) — PASSED render/verify, PARKED at Daniel's watch-through gate 6 (untouched
  since the 2026-07-19 kb import).
- Bricks "Variant D" taste-forensics (`2026-07-28-bricks-fresh`) L01-L50 — PASSED generation +
  render: 49/50 shots verified, 1 parked (L10), rendered over real narration
  (`preview-L01-L50.mp4`, 117.97s) on clone branch `claude/bricks-variant-vd` (unmerged).
- Bricks arc gate (Daniel: continue Variant D / run render-register experiment first / revert) —
  OPEN, awaiting Daniel's eye-gate on the L01-L50 render + board.
- fyt-run-001 (Wells Fargo video) — PARKED, excluded from the validation order per Daniel's
  2026-07-22 decision.
- PROJECT STATUS: PARKED overall — no active work is in flight; this frame is a resume point,
  not a running arc.

## Invariants
- Every YouTube publish is Stage-0 human-gated; no post leaves the pipeline without Daniel.
- Any diff >400 lines or anything touching another project queues for Daniel.
- Bricks work happens in the standalone clone `kb-clones/bricks-arc`, never the main kb checkout.

## Governing docs
- `orgs/faceless-youtube/CLAUDE.md` — authoritative per-video operating law (predates kb import)
- `orgs/faceless-youtube/contract.md`
- ops `handoffs/2026-08-21-fyt-bricks-variant-d-L50-render.md`
