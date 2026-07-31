# FYT gated pipeline SHIPPED — resume for the deferred full run — 2026-07-31

**Topic:** The FYT human-gated multi-agent video pipeline + all four roster-delivery fixes shipped to `main`.
Only the full end-to-end run (Facts 4 & 5 harness + maiden video) remains, deferred for the Aug 1 9pm
weekly-cap reset.

### What WORKED (with evidence)
- **Pipeline + delivery fixes merged to `main`** — confirmed: `git rev-list --count origin/main..<branch>` == 0;
  `3a04a82` in `origin/main`; PR #106 MERGED (`6c359ca`). #102 had merged a STALE tip (`a64cc43`); the 17 real
  commits were recovered via #106 (clean merge, 0 conflicts — `merge-tree` exit 0, GitHub `MERGEABLE/CLEAN`).
- **`auto` permission mode** (c6e37c9) — live-verified: fresh pty boots with NO acceptance modal; deny floor
  now ENFORCES under auto (headless `-p` git config → permission_denied). Model-gated to Opus 4.6+/Sonnet
  4.6+/Fable 5; roster runs Fable 5 = OK.
- **Freshness-gated busy readiness** (0193b9f) — pure `detectReplReadinessFresh`; unit-tested; stale spinner no
  longer false-parks.
- **Two-write submit** (d63ce06) + **outcome-verified submit** (3a04a82) — a delivered order provably starts a
  turn or parks loudly (`DELIVERY_NOT_ENGAGED_REASON`); proven at single-terminal (transcript grew, retry
  recovered a forced folded-Enter). Suite 2361 passed / 5 skipped, tsc clean. Adversarial pre-merge review =
  SHIP-WITH-NITS (nits fail-closed).
- **Faithful single-terminal repro of the real `deliver()` path SUBMITS correctly** under cap — the delivery
  mechanism itself is sound.

### What Did NOT Work (and why)
- **Harness re-run #2 (full 6-terminal daemon) FAILED Facts 4 & 5** — the idea order was written to disk and
  the daemon recorded `"working stage idea"`, but fyt-story's transcript had ZERO post-boot user-turn entries →
  the turn was never submitted; idea timed out at 40 min, no `brief.md`. NOT a code defect in the end (the
  faithful repro submits fine) and NOT a rate-limit LINE — most probable cause: a **pre-submit weekly-cap
  block** at the REPL UI (account was ~84% of weekly limit, climbing), which looks identical to a never-submit
  (no user entry, no rate-limit line because no turn was submitted).
- **Two wrong root-cause hypotheses** (do not retry): (1) "first-run onboarding splash"; (2) "1856-byte large
  paste swallowed the Enter" — WRONG, the delivery line is a SHORT ~150-byte file-pointer (`defaultDeliveryLine`,
  rosterSessions.ts:953); the 1856 bytes is the order FILE on disk.

### What Has NOT Been Tried Yet
- **The full end-to-end run with cap headroom** — re-run the dry-check harness after the Aug 1 9pm reset to
  close Facts 4 (G0 halt at story) & 5 (idea → brief.md round-trip through a real terminal). If it stalls
  again with headroom, the outcome-verified submit will now PARK LOUDLY (`roster-delivery-not-engaged`) instead
  of hanging 40 min — read the park reason.
- **The maiden video run** — fresh the-second-take idea → full script → ~2-min slice through images/VO/render.
  G2/G3b (spend) and G4 (publish) are Daniel's authorizations, never self-granted.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `dashboard/server/control/rosterSessions.ts` | DONE | in main; auto mode + freshness gate + two-write + outcome-verified submit |
| `dashboard/server/control/rosterSessions.test.ts` | DONE | in main; retry-recovers, never-engages-parks, pure classifiers |
| whole `orgs/faceless-youtube/` pipeline | DONE | 13 stages / 6 agents / 6 gates, in main |
| the dry-check harness | REUSABLE | at `…/161e0c0f-…/scratchpad/dry-check/run-dry-check.mjs` (operand worktree was pruned; re-setup a detached worktree at the NEW main `6c359ca`) |

### Exact Next Step
After **Aug 1 9pm** (weekly cap reset): set up a fresh detached throwaway worktree at `origin/main` (now
`6c359ca`+), point the dry-check harness at it, run it, and close Facts 4 & 5 (fyt-story transcript grows +
`brief.md` round-trips + DAG halts at G0). Then propose the maiden run to Daniel (his spend/publish gates).
Do NOT point any test daemon's `DASHBOARD_REPO_ROOT` at a live work-branch worktree.

### Load list
- `handoffs/2026-07-31-fyt-pipeline-shipped.md` (this file)
- personal memory `fyt-gated-pipeline-arc` (PRIMARY resume point), `verify-pr-remote-equals-local`,
  `verify-run-health-by-transcript-growth`
- `orgs/faceless-youtube/docs/STATUS.md`, `orgs/faceless-youtube/workflows/video-run.md`
- `dashboard/server/control/rosterSessions.ts` (the delivery seam ~1500-1680)
- `memory/claude-boss.md` (lessons)
