# workflow-platform P1 live-proof — findings + 3 defects — 2026-08-18

**Topic:** Attempted the P1 live-proof by driving the real dashboard headlessly (no browser/passkey
dependency). Engine logic confirmed sound; the shipped demo could NOT launch as delivered; three
concrete defects found, two fixed-in-principle, one needs daylight investigation before merge.

### What WORKED (with evidence)
- **Headless auth** — minted valid session tokens directly (pinned `DASHBOARD_SESSION_SECRET` +
  long TTL + `DASHBOARD_EXECUTION_ACTIVATED=1`), authed `/api/index` → 200. Removes the
  browser/Windows-Hello/5-min-expiry friction entirely for any future proof. Token format is
  `payload.signature` (163 chars); `verifySession` rejects any control char — copy integrity via
  `(Get-Clipboard -Raw).Trim() | ssh` is the reliable transport.
- **Engine behaviors 4/4** — `execution.test.ts`, driven through the real AutomaticExecutionEngine:
  accept-at-bound (no park), rework→fulfilled→accept sequence, park-before-maxCycles+1 with full
  residue, no-progress park. These ARE the ceremony's four assertions.
- **Isolated harness** — bare mirror of the repo (`scratchpad/p1-iso/mirror.git`) + a checkout ON
  `ops` with the demo def + agents committed locally, `origin` = the mirror. Nothing this session
  touched shared `origin/ops`. Daemon run with wp CODE but `DASHBOARD_REPO_ROOT` = the isolated ops
  checkout. Required `core.longpaths=true` (a legacy poyais PNG path exceeds MAX_PATH).
- **After the fixes below, the demo LAUNCHES** — `launchable=True`, launch created
  `run-23accef6-5747-475a-a4d5-d90691e58ffe`: state `planned`, **8 stages**, 1 manager attempt
  `queued`. The entire validation + planning stack works live.

### What Did NOT Work — the 3 defects
1. **DEFECT (registry) — `gpt-5.6-terra` unregistered.** `governance/model-routing.yaml` codex
   runtime `known_models: [gpt-5.6-sol]` only. The demo's workers use `worker:codex:gpt-5.6-terra`
   (the standard `codex` tier). Result: every codex-terra worker profile resolves "unavailable" /
   "default profile does not match runtime/model". **Blocks ANY codex-terra workflow, not just the
   demo.** FIX: add `gpt-5.6-terra` to codex `known_models`. (Applied in the isolated checkout;
   needs a real PR.)
2. **DEFECT (demo def) — manager profile the agent can't run.** `iteration-loop-demo.md` `manager:`
   block assigns `profileId: manager:codex:gpt-5.6-sol` to `fyt-runner`, but `fyt-runner` is a
   claude agent (`allowed-profiles: [manager:claude:claude-opus-4-8, manager:claude:claude-sonnet-5]`).
   The demo could never launch as authored. FIX: set the demo manager to
   `manager:claude:claude-opus-4-8`.
3. **DEFECT? (engine) — launch→execute turn-ownership conflict.** After the two fixes, launch
   returns HTTP 500 `launch-reconciliation-required`; `runAutomatic` fires async but the durable
   projection throws `store.ts:5255` "iteration attempt is not the active turn owner". Run parks at
   a "Launch reconciliation required" intervention with the attempt stuck `queued` — BEFORE the
   first codex agent executes. UNKNOWN whether this is a real P1 launch-projection bug or an
   artifact of the isolated harness. **This must be resolved (or explained) before merging P1.**

Also confirmed: the 854 P1 tests pass because they inject MOCK worker/manager adapters, bypassing
agent/profile/registry resolution — which is exactly why defects 1 & 2 shipped latent. The live
ceremony was deferred to Daniel and never actually executed by the builders.

### What Has NOT Been Tried Yet
- Reconcile-by-runRef on `run-23accef6...` to see if the run then advances (would isolate defect 3
  as projection-only vs execution-blocked).
- A real codex agent actually executing a stage workOrder end-to-end (never reached).
- Confirming defect 3 on a NON-isolated setup (real ops checkout) to rule out the harness.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `governance/model-routing.yaml` | FIX-NEEDED | add `gpt-5.6-terra` to codex known_models (real PR) |
| `orgs/faceless-youtube/workflows/iteration-loop-demo.md` | FIX-NEEDED | manager → claude profile |
| `claude/workflow-platform` @ d324ae3a | HOLD | engine sound; do NOT merge until defect 3 resolved |
| PR #129 (gate1 follow-ups) | OPEN | unrelated; independently mergeable |
| `scratchpad/p1-iso/` | TEMP | isolated harness; self-cleans with scratch; all local |
| dev daemons | STOPPED | ports 4317/5318 freed |

### Exact Next Step
Decide defect 3 first: reconcile `run-23accef6...` by runRef (or re-run the demo on a real ops
checkout) to determine whether the turn-ownership conflict is a P1 launch-projection bug (→ fix
before merge) or a harness artifact (→ the two config fixes are all P1 needs). Then land defects
1 & 2 as a small reviewed PR (they block every codex workflow regardless of P1).

### Load list
- This file.
- `dashboard/server/control/store.ts:5255` (turn-owner conflict) + `control/launch.ts:450-470`.
- `governance/model-routing.yaml` codex block.
- `orgs/faceless-youtube/workflows/iteration-loop-demo.md` manager block.
- `handoffs/2026-08-14-dashboard-workflow-platform-p1-complete.md` (the recipe this tested).
- `scratchpad/p1-iso/ops-checkout/` (the isolated harness, if still present).
