# faceless-youtube — STATE
_Updated: 2026-08-21 23:59_

## Now
PARKED. No active work in flight. Repo `orgs/faceless-youtube/STATE.md` is stale (dated
2026-07-19, describes only the kb import) — the real last activity is the Bricks Variant-D arc,
tracked outside the main checkout in clone `C:/Users/danie/kb-clones/bricks-arc`
(branch `claude/bricks-variant-vd`, tip 4bc82dc2, pushed), which this file distills instead.

## Current gate
Daniel's eye-gate on the Bricks Variant-D render (`preview-L01-L50.mp4`, 117.97s, 49 verified
frames + 1 placeholder at L10) and `board.html` — decides continue-D / render-register-
experiment-first / revert. Not yet ruled as of the last handoff.

## Next
1. Daniel watches the render + board, rules on the arc gate.
2. If continue D: rule on the two proposed engine fixes (seed-card wave before scene waves;
   forge card-id hashing on tokens+digest instead of prose clause), then L10 crowd-rig call,
   then A2+ authoring.
3. fyt-run-001 (Wells Fargo) and Poyais (R10) both stay parked pending separate Daniel decisions.

## Blocked
None beyond the human gate above.

## Findings
- Open governance question (unresolved, not blocking): `governance/budget.yaml` daily cap $5 vs
  a full video costing ~$15-30; the preamble gate currently passes only because image spend is
  never written to `ledgers/cost/` — needs reconciliation (raise ceiling / per-run waiver / log
  image spend).
- codex 0.149 rejects `approval_policy="untrusted"` at config load ("auth stale") — clone config
  fixed to `on-request`.
- Bricks engine: `forge.py batch` validates every chain in the file, so stale parked-parent
  residue blocks unrelated waves; figure cards are the recurring defect-dense layer; the engine
  bakes unrequested prop text and loses supplied literals under prompt deltas.

## Infra
- Main checkout: `orgs/faceless-youtube/` (imported working tree; git history archived at
  `C:\Users\danie\faceless-youtube.git-archive`).
- Bricks work: standalone clone `C:/Users/danie/kb-clones/bricks-arc`, branch
  `claude/bricks-variant-vd` — keep separate from the main kb checkout.
- Cost ledger rows: ops `ledgers/cost/claude-boss-2026-08-21.tsv` (127e87e8, e6ef49be).
