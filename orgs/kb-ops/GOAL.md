# kb-ops — GOAL
_Ruled: 2026-09-06_

## North star
The dashboard/agent-platform arc: fleet operation that is "easier and cleaner" for Daniel (his
2026-08-20 goal) — a ten-destination IA, no tech text, click into a running agent and watch its
stream, terminals on Linux too, loops/learnings on autopilot, deploy from Inbox. Restated
2026-09-06 as Phase B's goal: "a working, iterable, consistent platform."

## Success conditions
- Agent Platform Wave-1/2/W3 (12 panels, Brain provisioned) — PASSED: merged #139/#140, LIVE on
  VM release 64fb3d02 since 2026-08-20.
- Gate 4a (claude launch via broker, `acceptance-run`) — PASSED (per 2026-09-06 memory note).
- Gate 4b (codex launch via broker, `iteration-loop-demo`) — OPEN: 4 runs attempted; run 4
  reached checker turns (concurrent producers, loop activation, checker legs, verdicts/receipts,
  rework scheduling proven); exec resume, accept/pass, and both park shapes still unproven.
- VM dashboard hydrate crash-loop fix — OPEN: root cause found and fixed on branch
  `claude/provenance-fix`, PR #173, **still OPEN/unmerged** (confirmed via `gh pr view 173`,
  2026-09-11 read: state OPEN, mergedAt null).
- Post-outage recovery (merge #173 -> rebuild -> recover-deploy -> interrupt run 971d5ba4) — OPEN,
  not yet executed as of the 2026-09-06 handoff.
- Phase B (canary, drain automation, wire guards, P21/P23, stale-card cleanup, P11/P14, webauthn
  re-pin, P18 n8n comparative analysis) — OPEN, queued behind recovery.

## Invariants
- Daniel is the only merge authority; no branch-tip deploys.
- T3 approvals (publishes, account changes, merges) are Daniel's passkey/WebAuthn channel only —
  never the weak channel; the boss pre-inspects the artifact and drives gates itself where
  possible, pinging Daniel only for real rulings.
- A release that changes a frozen unit contract (e.g. a new pinned directive) must install its
  resident validator BEFORE activation, or the old validator refuses the new release.
- Every deploy follows the converged ship process: probe -> opus root-cause -> build (worktree,
  workers never commit) -> boss-run gates (tsc, vitest, WSL real-broker harness, pytest) ->
  opus adversarial review -> boss commits -> Daniel merges -> rebuild from origin/main -> Daniel
  deploys.
- A validator that runs over the whole document must key every join by run (the #173 lesson).
- `queue/`-touching cadences and any diff >400 lines require Daniel's queue-for-me approval.

## Governing docs
- `orgs/kb-ops/_index.md`, `contract.md` (kb-ops project root, main)
- ops `handoffs/2026-09-06-dashboard-outage-recovery.md`, `handoffs/2026-09-02-dashboard-gate4-
  live-launch-plan.md`
- PR #173 `claude/provenance-fix` (open, unmerged)
- `docs/runbooks/2026-09-03-vm-agent-launch-preflight.md`
