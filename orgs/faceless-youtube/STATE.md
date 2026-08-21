# faceless-youtube — STATE

_Updated: 2026-07-31 (gated pipeline shipped to main; roster delivery hardening is approved and
awaiting its post-cap-reset live rerun; note: a richer 2026-07-19 STATE.md exists on branch
claude/faceless-live-import — reconcile to this one at merge, this is newer)_

## Now
- Active production run: **bricks-fresh** (`channels/the-second-take/videos/2026-07-28-bricks-fresh/`),
  branch `claude/bricks-doctrine-reset` (pushed, dd22f97). Era doctrine restored + R1 saturation fix live.
  Phase 6B first tenth: 18/25 slots verified in `assets/scenes/`; PAUSED at the P1-P5 human gate
  (board: https://claude.ai/code/artifact/767b9074-aee3-4d3d-817f-1319f2187325).
  Resume via `handoffs/2026-08-06-fyt-bricks-p6b-gate.md`.
- Poyais published; wells-fargo parked (see git history).

## Now (bricks-fresh, 2026-08-21)
- channels/the-second-take/videos/2026-07-28-bricks-fresh: Variant D trial extended to L01-L25 on clone branch `claude/bricks-variant-vd` @ da651c6c — 25/25 verified (37 calls, $4.96 cumulative), 16 dropped canonicals restored to the kit registry, blind D-vs-LIKED analysis (LIKED 18 / D 7 row preferences, 4 valid holds, 2 missed seams), 25-row board artifact 12e75c13 (L01-L12 A/B/C/D board stays 53c84a37). Daniel gate = keep D / keep D with edits / iterate / revert. Handoff: handoffs/2026-08-21-fyt-bricks-variant-d-L25.md.

## Next
- After Aug 1 9pm ET: run the pinned `051de9e` harness and require 7/7; then rewrite PR #109 and bring
  the held merge gate to Daniel. The maiden video remains a separate G2/G3b spend + G4 publish proposal.
- Daniel: merge PR #41 + companion; Gate 3 for poyais; complete the one-time analytics credential setup;
  first fresh A→C video under a new spend card, run by fyt-runner.

## Blocked
- publish-queue live upload: behind Gate 3 + compliance green.
- analytics first pull: behind .env refresh token + first publish.
- governance/budget.yaml daily_usd_limit 5.00 vs ~$15-30/video: human-edited file, Daniel to fix.
