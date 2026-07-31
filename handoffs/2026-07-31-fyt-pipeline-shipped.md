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
| the dry-check harness | READY (prepped 2026-07-31) | at `…/161e0c0f-…/scratchpad/dry-check/run-dry-check.mjs`; operand worktree RECREATED at its pinned path `…/161e0c0f-…/scratchpad/dry-check-repo` detached @ `6c359ca`, `dashboard/node_modules` junctioned from `C:/Users/danie/kb/dashboard/node_modules`, server-module imports verified resolving |

### Exact Next Step (UPDATED 2026-07-31 late: Facts 4 & 5 CLOSED — 7/7 PROVEN)

Dry-check run 6 (`run-3776411c`, operand @ 9d0e3bc): idea stage succeeded in 140.6s — marker matched
via the real production matcher, brief.md artifact-delta verified server-side, DAG halted at G0,
spend gates untouched, clean retire. Five roster-delivery fixes were found live and are on
**PR #109** (`claude/fyt-full-run`, 5 commits: MCP-server disable + deny-floor Edit() repair,
marker line reconstruction, split scan/screen streams, settled delivery readiness, skills-manifest
chore). Remaining:
1. Daniel merges PR #109.
2. Maiden video run (Daniel's G2/G3b spend + G4 publish gates) — fresh the-second-take idea through
   the real daemon, ~2-min slice.
3. Arc-close hygiene: sweep `kb-worktrees/boss-fyt-run` + the 161e0c0f scratchpad `dry-check-repo`
   worktree once #109 is in `origin/main` (rev-list==0 check first).
Do NOT point any test daemon's `DASHBOARD_REPO_ROOT` at a live work-branch worktree.
