# Boss plan — remaining work, in order — 2026-08-18

**Topic:** Consolidated resume point for the boss session that ran kb-structure Gate-1, the
workflow-platform P1 live-proof, and the gate1 follow-up fixes. Supersedes and replaces (deleted
this commit): `2026-08-18-kb-gate1-closed.md`, `2026-08-18-workflow-platform-p1-liveproof-findings.md`,
`2026-08-07-cloud-migration-wave1-done.md`. Do the numbered steps in order; the last is the cloud
cutover.

## DONE this arc (evidence)
- **kb-structure Gate-1 CLOSED** — signed + verified evidence package `gate1-20260818T044809Z`
  (`verify` → passed:true/verified:true, binds release `0554dc81`). Archived at
  `C:/Users/danie/kb-backups/gate1-evidence/`. VM `kb` live on `0554dc81`, auth working, backup +
  restore drill green (RPO/RTO). Evidence signing key `~/.ssh/kb_evidence_signing`. The ceremony
  surfaced + fixed 5 live platform defects → PRs #123-#127 (all merged).
- **windowsHide fold** — `d324ae3a` on `claude/workflow-platform` (e08308bc + the stranded fix).
- **Gate1 follow-up fixes committed** — three merged earlier (ops git identity, register transports,
  origin-guard default-port; branches swept). One still open: **PR #129** (gate1-followups: same three
  hardened together) — MERGEABLE/CLEAN, zero overlap with workflow-platform, ready to merge anytime.

## Step 1 — Merge PR #129 (gate1 follow-ups)
Ready now. `gh pr merge 129 --merge`. After merge: CI release run on main → (optional) redeploy VM
via the deploy one-liner + helper refresh (deploys don't refresh `/usr/local/lib/kb/*` — manual
`sudo install -m 0555` needed; PLATFORM GAP for the Task-24 window). No urgency: the live VM already
carries the identity fix by hand.

## Step 2 — kb-structure: 3 standing rulings + deferred sub-plan
- **3 rulings (Daniel):** (a) orgs/ served wholesale by the KB browser (dotfile/env exposure to
  authed callers); (b) unsigned `ledgers/`+`traces/` promotion incl. the T3 spend audit trail;
  (c) CP2 S14 minor. Decide each.
- **Deferred Tasks 9/21/23-25** — blocked until workflow-platform merges to main (Step 3). Then:
  plan's merge-checkpoint ancestry commands, re-read merged contracts, write specs against real
  signatures, adversarial plan re-review, execute. Task-21 spec must cover bridge-claim admission
  incl. paid-action in-flight; Task-24 owes the Linux vitest baseline decision. Plan §DEFERRED on
  main; SDD ledger worktree `boss-2026-08-11c` KEPT for this.

## Step 3 — workflow-platform P1: resolve the live-proof blocker, then merge
P1 = iteration loops (stage can rework→fix→accept with a declared cycle bound; exhausted → parks at
a human gate; never silently passes). Code merge-ready @ `d324ae3a`, 854 tests + whole-phase
adversarial review. **MERGE ON HOLD** pending the live-proof, which found 3 defects:

1. **DEFECT (registry):** `governance/model-routing.yaml` codex `known_models: [gpt-5.6-sol]` omits
   `gpt-5.6-terra` (the standard codex tier the demo workers use) → every codex-terra worker profile
   "unavailable". **Blocks ANY codex-terra workflow.** Fix: add `gpt-5.6-terra`.
2. **DEFECT (demo def):** `orgs/faceless-youtube/workflows/iteration-loop-demo.md` assigns manager
   `manager:codex:gpt-5.6-sol` to `fyt-runner`, a claude agent (allows only claude managers) →
   never launchable. Fix: manager → `manager:claude:claude-opus-4-8`.
3. **DEFECT? (engine) — the actual gate:** after fixing 1+2 the demo LAUNCHES (real run
   `run-23accef6-5747-475a-a4d5-d90691e58ffe`, 8 stages, 1 attempt `queued`) but the launch→execute
   projection throws `store.ts:5255` "iteration attempt is not the active turn owner" → parks at a
   "Launch reconciliation required" intervention BEFORE any agent runs. **Unknown: real P1 bug vs
   isolated-harness artifact. Resolve before merge.**

The 854 tests pass because they MOCK the worker/manager adapters (bypass agent/profile/registry) —
why 1+2 shipped latent; the live ceremony was deferred and never actually run by the builders.

**Next action for Step 3:** decide defect 3 first — reconcile `run-23accef6...` by runRef, or re-run
the demo on a REAL ops checkout (not the isolated harness) to determine bug-vs-artifact. Then land
1+2 as a small reviewed PR (they block every codex workflow regardless of P1), then merge P1.

**Headless proof recipe (reusable — removes the browser/passkey/5-min friction):** run the wp
daemon (`npm run dev:server` from `dashboard/`) with `DASHBOARD_SESSION_SECRET=<fixed>`
`DASHBOARD_SESSION_TTL_MS=7200000` `DASHBOARD_EXECUTION_ACTIVATED=1` `DASHBOARD_RP_ORIGIN=http://localhost:5318`
`DASHBOARD_REPO_ROOT=<an ops checkout that has the demo def>` `DASHBOARD_STATE_ROOT=<fresh>`
`DASHBOARD_WEBAUTHN_CREDENTIALS=<a registered passkey JSON>`. Mint the token in node with the same
secret (payload.sig HMAC-SHA256, claims {sub:"operator",iat,exp,jti}); POST
`/api/workflows/iteration-loop-demo/launch` with header `Host: localhost:5318` and body
{idempotencyKey, expectedSourceHash, parameters:{slug}}. Isolated git harness lives in
`scratchpad/p1-iso` (bare mirror as `origin` so nothing touches shared ops; requires
`core.longpaths=true` — a legacy poyais PNG path exceeds MAX_PATH). Engine behaviors independently
proven 4/4 via `execution.test.ts` (accept-at-bound, rework→fulfilled→accept, park-before-maxCycles+1,
no-progress park).

## Step 4 — Closure sweep
After Steps 1+3 merge: advance `claude/dashboard-prod-pin` to follow main (ends the repeated
workflow-platform merge loop); delete 0-unmerged local branches; remove `boss-workflow-platform`
worktree (KEEP `boss-2026-08-11c` SDD ledger, `dashboard-ops`, control-plane worktrees); the
`kb-worktrees/gate1-*` and `fix-*` dirs are git-deregistered but their `.pytest-*` tmp subdirs are
ACL-locked — need ONE elevated `Remove-Item -Recurse -Force` from Daniel to clear. `git worktree
prune`; delete the VM `/var/tmp/gate1-run.sh` if still present.

## Step 5 (FINAL) — Cloud migration Wave-3 cutover
Only after Steps 1-4. Branch `claude/cloud-migration` @ **`9ee705a`**, worktree
`C:/Users/danie/kb-worktrees/boss-cloud-migration` (KEEP until merge).

**The VM (live, billing hourly):** Hetzner **CCX23** (4 vCPU/16GB/160GB), Ubuntu 24.04, name `kb`,
tailnet `100.89.73.118` (~$103/mo cap). Tailscale SSH on (`ssh kb@kb` / `ssh root@kb` keyless).
User `kb` (sudo, linger), node 24 via fnm, python 3.14 venv `~/.venvs/kb`. Auth: claude subscription
(persistent `~/.claude` login — the token env is denied to governed workers by design) + codex
file-backed `~/.codex/auth.json` (0600, Daniel's 2026-08-06 fallback ruling; headless keyring can't
make a login collection). Repo: bare mirror `~/kb-mirror.git` (pushed from desktop over tailnet — no
GitHub creds on VM), clone `~/kb`, ops worktree `~/kb-dashboard-ops`. Daemon: systemd user unit
`kb-dashboard` on 127.0.0.1:5317, `DASHBOARD_REPO_ROOT=~/kb-dashboard-ops`, currently **DISARMED**
(fail-closed until cutover). vm_verify.sh all-PASS post-reboot.

**Proven (Wave 1-final):** full vitest green ON LINUX (2427 tests) after fixing 5 real port defects
(`10503c2..9ee705a`: resolveWithin win32-absolute escape, buildActivatedExecution ActivationDeps
bypass, bare-python spawns, noReparseFiles win32-only POSIX hot path → new platform/noReparseFiles.*,
claude worker stdin-EOF finalization). Synthetic acceptance 8/8 ON THE VM (real governed chain end
to end, subscription spend only).

**Deferred BY ARCHITECTURE to this cutover window (not failures):** live queue-bridge tick needs a
passkey-sourced unlock (env arming deliberately won't start autonomous pickup) — passkey creds
(DASHBOARD_WEBAUTHN_CREDENTIALS + SECRET) migrate at cutover; VM inbox has ZERO claimable cards so
re-arming is safe. One codex-runtime governed attempt (spec wording). W7 full-flow acceptance runs on
the VM.

**Cutover action:** Daniel schedules a quiescent window (quiescent = kb-only: no other kb terminals
mid-work, no codex dispatches in flight, daemon/cadences idle — non-kb desktop activity irrelevant;
bricks' uncommitted tree may SIT, just can't run). Execute `docs/runbooks/2026-08-06-wave3-cutover.md`
(branch) live + the deferred items above + merge `claude/cloud-migration` → main. Full-kb scope (all
projects; repo already mirrored, 141G free). The fyt image-gen spend-capped provider key is human-only
— Daniel places it himself when fyt generation first runs on the VM (not needed for cutover). Then
Wave 4 decommission (kills the Wave-1a nt branch, frees local 5317 held by legacy prod PID 21960,
sweeps stale VS Code sessions), then the Atlas plan. Pilot watch-item: ffmpeg render load on 4 vCPU
decides whether the durable box needs CCX33 (8 vCPU).

## Load list
- This file.
- PR bodies #123-#129 (Gate-1 defect + review record; #129 = the open follow-up).
- `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` §DEFERRED (Step 2).
- `dashboard/server/control/store.ts:5255` + `control/launch.ts:450-470` (Step 3 defect 3);
  `governance/model-routing.yaml` codex block + `orgs/faceless-youtube/workflows/iteration-loop-demo.md`
  manager block (Step 3 defects 1-2); `scratchpad/p1-iso/` (isolated harness if still present).
- `docs/superpowers/plans/2026-08-06-cloud-migration.md` + `docs/runbooks/2026-08-06-wave3-cutover.md`
  (both on `claude/cloud-migration`) for Step 5.
- `memory/claude-boss.md` (2026-08-18 + 2026-08-07 lessons).
