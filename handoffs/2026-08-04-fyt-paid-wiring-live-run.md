# Handoff — FYT paid-wiring (Phase 3) SHIPPED; live thin-slice run BANKED at executor/roster hardening

Date: 2026-08-04 · Author: claude-boss (Fable 5 boss terminal) · Daniel-directed "bank it, handoff for a future terminal"

## TL;DR
**Phase 3 (paidActionService worker-mediated wiring) is BUILT, reviewed, and unit/integration/boot-tested** on
branch `claude/fyt-paid-wiring` (pushed; UNMERGED — merge is T3, Daniel-passkey only). The **live end-to-end
thin-slice run was banked** after proving most of the stack, because it kept hitting **pre-existing executor/roster
production-safety limits and a roster boot-handshake bug** — none of them Phase-3 defects. What remains is an
**executor-hardening arc** (make the executor/roster runnable as an iterating validation harness), not more Phase-3
work.

## Load list (read these first on resume)
- This file.
- Auto-memory `C:\Users\danie\.claude\projects\C--Users-danie-kb\memory\fyt-paid-wiring-arc.md` (primary resume pointer).
- Scratchpad specs/recon: `phase3-spec.md`, `phase3-auth-recon.md`, `phase4-activation-recon.md`
  (under `...\7eb21010-77fa-4748-aef9-d9b2ca3fe082\scratchpad\`).
- Branch code: `dashboard/server/control/{paidActionService,spendGrant,paidActionProviders,paidActionRoute,
  paidActionWiring,spendGrantProvision,codexDirectoryTrust,rosterSessions,activation}.ts`.
- The isolated daemon launcher: `...\scratchpad\start-fyt-phase4-daemon.mjs`.

## Branch state — `claude/fyt-paid-wiring` (worktree `C:\Users\danie\kb-worktrees\boss-fyt-phase3`)
Pushed to origin. Tip `e0b4198`. Commits (all reviewed):
- A `2d87c63` paidActionService fixes (F1 $1.50 journal ceiling, F2 failed-releases-ownership, F3 verifier-throw).
- B `94f34bf` spendGrant.ts durable capability-token store.
- C `ffe45d2` paidActionProviders.ts (server-side CredentialResolver, 1-attempt Transport w/ JPEG→PNG transcode,
  atomic Committer, Verifier).
- D `3a60523` `/api/control/paid-action` route: server-derived identity, mandatory T3 audit, mint+`.kb/spend-grant.json`
  at stage launch.
- E `c80e5aa` forge.py + voiceover.py route mode (grant-file-gated, backward-compatible).
- F `8f6894a` N4 fail-closed PTY host + full-chain integration test.
- P2 `0931494` route-mode image path must be under `videos/<slug>/` (forge `--to`, local namespace validation).
- F4 `7839dd1` codex attempt-worktree pre-trust before spawn (`codexDirectoryTrust.ts`; `ensureCodexDirectoryTrusted`).
- P2b `75d386a` images-stage `--to` work-order line + voiceover namespace guard.
- BUG1 `e0b4198` **roster grants `Write` (not just `Edit`) for the boot-sentinel `ready.json`** — the real claude
  boot bug (see below). UNTESTED live (attempt budget pre-empted the run that would test it).
Pre-existing unrelated failure: `server/write/workflowRun.test.ts:265` (stale assertion, fails on main too; owed its own tiny PR).

## What is PROVEN live (isolated daemon, port 4620)
- Isolated daemon works: settlement-pattern launcher, code from `boss-fyt-phase3`, **REPO_ROOT = a local-bare-origin
  coordination checkout** so all `git pull/push origin ops` stay local (real `origin/ops` never touched). Details below.
- Passkey **unlock** works (RP-ID=localhost verifies cross-port). Executor **activation** wires paidActionService +
  spendGrantStore + provisionSpendGrant + roster. Paid route 503s when locked, 401s (needs grant token) when unlocked.
- **Worktree creation, codex spawn, F4 pre-trust** all work: the trust entry
  `[projects.'<lowercased attempt-worktree>']` was written to `~/.codex/config.toml` before spawn; no trust-wall stall
  on the pre-trusted dir (confirmed live + by ConPTY repro).
- Full claude roster spawn works (all 5 agents get binding.md/settings.json/mcp.json; worktree `.claude/` scaffold).
- Provider keys reach the daemon **in-process** (launcher lifts GEMINI_API_KEY/ELEVENLABS_API_KEY from
  `orgs/faceless-youtube/.env` into the daemon env only; resolver fromEnv path; stripped from workers by the *_API_KEY denylist).
- **$0 real spend** across all attempts; the $1.50 paidActionService journal ceiling was never approached (no paid stage reached).

## What BLOCKED the live run (the executor-hardening arc — NOT Phase 3)
1. **codex boot** (runs run-c8766f3b): parked `roster-delivery-not-ready` ("not at REPL prompt in 5 min"). Root cause
   most consistent = the **pre-F4 trust wall** (F4 `7839dd1` fixes it); a faithful ConPTY repro of the exact roster
   launch boots clean post-F4 (reaches the `›` idle prompt, writes the sentinel via its writable `--add-dir`). NOT
   reproduced as a post-F4 failure. Latent fragility flagged (not fixed): `CODEX_READY_MARKERS` depends on the
   non-ASCII glyph `›`(U+203A); if the PTY ever decodes non-UTF-8 it mojibakes → classifies `silent` forever. Live
   transport is UTF-8-safe. If codex re-parks post-F4, capture that terminal's raw PTY bytes and replay through
   `detectRuntimeReplReadinessFresh/Settled` to pinpoint the gate.
2. **claude boot** (runs run-564abe06 fable-5, run-a1fa29fc sonnet-5): parked "did not write a valid token-bound ready
   sentinel." ROOT CAUSE FOUND + FIXED (BUG1 `e0b4198`): the settings-builder granted `Edit(ready.json)` but the worker
   must CREATE the file → needs `Write`. **Fix is committed but UNTESTED live** — the run that would test it hit blocker 3 first.
3. **Global attempt budget = 3/day** (`activation.ts:119` `DEFAULT_BUDGET.maxAttempts: 3`, enforced `adapters.ts:671`).
   The 3 failed boot attempts exhausted it, so the next launch was refused ("global attempt budget exhausted") BEFORE
   it could boot — which is why BUG1's fix is still untested. Raising it is classifier-gated (governance safety);
   Daniel must approve/apply. Note: shared constant also caps per-attempt regenerations.

## RESUME PLAN (executor-hardening arc)
1. Raise `DEFAULT_BUDGET.maxAttempts` (human-approved: `sed -i 's/  maxAttempts: 3,/  maxAttempts: 30,/' dashboard/server/control/activation.ts`
   in `boss-fyt-phase3` — or reset the isolated `kb-dashboard-phase4/control/execution-accounting/<date>.json`).
2. Restart the isolated daemon (`node ...\scratchpad\start-fyt-phase4-daemon.mjs`), Daniel passkey-unlocks at
   http://localhost:4620.
3. Launch `thin-slice-run` (workflow profiles in the ISOLATED `fyt-phase4-ops` are currently `claude:claude-sonnet-5`;
   the real branch keeps all-codex) with a fresh slug. **Watch `ready.json` sentinels appear** across agents =
   BUG1 fix confirmed. Then walk G0/G1/G2(spend ≤$1.40)/G3/G3b(spend one TTS) → images+audio via the paid route →
   render → verify. This is the actual paid-pipeline validation.
4. Decide all-codex vs claude for the validation (Daniel wanted all-codex; claude is the proven-boot path).

## Isolated setup (recreate/reuse) — all THROWAWAY
- Daemon launcher: `...\scratchpad\start-fyt-phase4-daemon.mjs`. Env: port 4620, RP_ORIGIN http://localhost:4620,
  WEBAUTHN creds lifted from prod pm2 config, GEMINI/ELEVENLABS keys lifted from org .env in-process,
  DASHBOARD_EXECUTION_ACTIVATED unset (passkey path), REPO_ROOT=`C:\Users\danie\kb-worktrees\fyt-phase4-ops`,
  STATE_ROOT=`C:\Users\danie\AppData\Local\kb-dashboard-phase4`.
- Local-bare origin: `C:\Users\danie\kb-worktrees\fyt-phase4-bare.git` (branch `ops` seeded from the phase-3 tip);
  `fyt-phase4-ops` cloned from it (on `ops`, origin=the bare) so coordination is fully local.
- Watch run state without a session token by reading `kb-dashboard-phase4\control\control-plane.json`
  (runs/stages/humanRequests) directly.

## Owed / cleanup
- Merge Phase 3 to main (T3, Daniel passkey) once the live validation lands — do NOT self-merge.
- `~/.codex/config.toml` has junk trust entries: `roster-longpaths-*` (from a rosterSessions test that calls the real
  `ensureCodexDirectoryTrusted` without a temp codexHome — TEST-HYGIENE BUG worth fixing) + per-run attempt trust
  entries. Harmless; sweep when convenient.
- Throwaway artifacts to delete when the arc closes: worktrees/repos `fyt-phase4-ops`, `fyt-phase4-bare.git`,
  `fyt-phase4`, `fyt-phase4-origin.git`; state root `kb-dashboard-phase4`; the parked runs therein.
- Earlier Phase-4 notes still open: route-mode TTS drops ElevenLabs word-timings (Daniel accepted estimated timing
  for the validation); artifact-namespace already handled by P2/P2b.
- `workflowRun.test.ts:265` stale assertion → its own tiny PR.

## Key rulings (Daniel, this arc)
- Full worker-mediated paid wiring (not a boss harness). Estimated TTS timing OK for the validation. Controlled
  Phase-3 daemon (not prod :5317, which runs stale dirty code). Fix both roster bugs, then re-run. Finally: BANK it,
  handoff. Boss NEVER self-merges (merge=T3). "codex-only subagents" memory applies to OTHER terminals, not the boss.
