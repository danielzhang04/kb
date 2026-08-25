# Handoff — dashboard-v3 P5 CLOSED, P6 W0 in flight (2026-08-25 ~09:00)

**Branch:** `claude/dashboard-v3` — tip `4f98f429`. Overnight autonomous build under Daniel's
"run through the end of the plan" mandate. Boss session `c3b25381`.

## Load (read on resume)
- `memory/claude-boss.md` (or your agent memory) + `MEMORY.md`
- Auto-memory `dashboard-v3-arc.md` — PRIMARY resume point, P5-CLOSED block at top
- `docs/plans/2026-08-23-dv3-p6-plan.md` (SHIP a2e37af6) — the phase now building
- Ledger (boss scratchpad, session 833beb04): `dv3-p3-carried-deltas.md` — the running ledger
  (P4/P5 fold items + the 3 P5 boss rulings + P7 folds all appended)

## P5 — CLOSED @ `4f98f429`
One-click deploy from Inbox. 16 commits over `f99ea265` (72 files, +9209/-182). W0 contracts →
wave W1-W5 (deploy services+store writer / helper+T3 / inbox projector / health readers /
home+quiescence) → wave-integration tsc fix → serial verticals W6.1 (Inbox route/UI + 6 endpoints
+ shared activation port) / W6.2 (Health/Home cutover + ReleaseRow deletion + ETag full-row-hash
fix) / W6.3 (deploy-T3 challenge on shipped verifier + `:1834` exhaustive-switch gate) / W6.5
(closure-harness completion: §9 12-attack CLI + §8 browser DOM assertions).

**Closure evidence (P5-CLOSE-CLEAN + P5-PHASE-CLEAN):**
- §7 focused gate SERIAL **1014/1014** (parallel's 1 red = known health/routes ETag flake); pytest 86.
- §9 **12/12 attacks** exit 0 driving REAL refusal paths (4/4 mutation-verified) + `assertP5GateResults`
  exit 0 with the live tree byte-identical; six source scans 0-unexpected under the 3 rulings; NUL 0/666.
- §8 browser **112/112** real-Edge cells (7 scenarios × 16) reached-app + 0-console + DOM-bullet-pass.
- §4 inventory clean; git status clean.
- Whole-phase security-seam review = **P5-PHASE-CLEAN**: deploy path fail-closed + coherent across
  all 6 seams (revision integrity, T3 fail-closed end-to-end, helper deferred, quiescence CAS,
  additive migration, no contract drift, tsc 0).

**3 BOSS RULINGS (in ledger — ratify at plan §12 / present at P7):**
1. probe-3 transition allowlist = 3 files (`store.ts` + `deploymentService.ts` + `deploy/quiescence.ts` —
   quiescence's close-ptys CAS is a legit 3rd caller of the same primitive).
2. probe-4 helper-verb allowlist extended to the benign `'deploy'` HealthRow-kind/decision sites
   (`health/deployReader.ts`, `probeBudget.ts`, `__fixtures__/health.ts`, `control/routes.ts`).
3. probe-5 permits `decline` only in guard-string / comment / negative-absence-test contexts (never
   as an action/route/verb value).

## Carry to P7 (presented, not built)
- Production helper/ceremony ASYNC wiring: W1's `DeployCeremonyGate.verify` is sync, WebAuthn
  `verifyAssertion` is async — the VM fail-closes to `403 ceremony-unavailable` until wired (INTENDED
  pre-P7 state). Owes: async ceremony-verify interface, real helper transport into inbox action ports,
  `DASHBOARD_DESKTOP_HELPER_ORIGIN` required-env, escalation-card publisher, Daniel's passkey reg.
- Live deploy of a tested commit + MainPID-vs-chip check + real rollback/symlink-swap (Daniel).
- MINOR: double-click Deploy → `409 idempotency-conflict` not smooth `replayed:true` (safe, never
  double-creates, unreachable until verify is wired); pin `requestedAt` into the fingerprint at P7.
- §8 plan commands need `--scenario` on the runner invocation (doc fix).
- Plus all prior P3/P4 P7 items (passkey reg, WSL sudo/native oracle, ACL-locked worktree deletes,
  CodexSandboxUsers ACL finding, CI broker build step, VM tailnet passes).

## P6 — W0 IN FLIGHT
`P6 W0` (contracts-first) dispatched to **opus**, worktree `.claude/worktrees/p6-w0`, branch
`claude/dv3-p6-w0` at `4f98f429`. Freezes the `/api/v1` envelope + six branded revision domains +
signed cursor codec + `v1Idempotency` decoder + `HostAdvertisement`/`PlacementLease` + host-node map.
P6 = 11 tasks (W0 → wave W1-W5 → serial W6.1-W6.5). P6-C26: P3/P4/P5 are predecessors of W6.1 ONLY
(now satisfied — they're built). On W0 return: grade → SHAPE audit → harvest → wave → verticals →
closure → P7 presented.

## Live worktrees
- `.claude/worktrees/p6-w0` — active (P6 W0 build)
- `kb-worktrees/dv3-gate` — Windows gate oracle (reset per checkpoint; do not sweep)
- WSL `~/kb-v3` — Linux gate oracle (`~/dv3-gate.sh`; do not sweep)

## Keep-awake
`keep_awake.ps1 -Supervise -MaxHours 16` re-armed 2026-08-25 04:43 → expires ~20:43. Renew before cap.
