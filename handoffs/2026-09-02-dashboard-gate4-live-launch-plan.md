# Handoff — Gate 4: prove live `claude` + `codex` launches on the VM (2026-09-02)

Supersedes `handoffs/2026-09-02-dashboard-pty-vertical-live.md` (delete on pickup). Plan authored by
the boss session; execution status is tracked in the checklist at the bottom.

## Load on resume
- this file, then `orgs/kb-ops/workflows/acceptance-run.md` and
  `orgs/faceless-youtube/workflows/iteration-loop-demo.md` (the two Gate-4 runs)
- `dashboard/server/control/routes.ts:629` (launch), `dashboard/server/control/launch.ts`
  (`launchService`, the `/api/workflows/:id/launch` path), `dashboard/server/control/agentAssignmentResolver.ts`
- `dashboard/server/write/outboxStatus.ts` (the 24 h admission ceiling), `scripts/promote_vm_outbox.py`,
  `deploy/apply_ops_reconciliation.py` (the drain ceremony)
- `dashboard/server/pty/fdPinnedPaths.ts` (launch validator), prior-session `gate3-preflight.sh`
  (session `d81c0458…` scratchpad; copy lives in this session's scratchpad)
- PR https://github.com/danielzhang04/kb/pull/149 — its tip `c952c098` IS the deployed release

## Goal
Prove that the control plane can launch real `claude` and `codex` agent attempts on the VM through
the broker as `kb-shell` — the thing the 2026-09-02 handoff left UNPROVEN — by running two existing
no-spend workflows end to end.

**Success condition (all must hold):**
1. `acceptance-run` (kb-ops, claude sonnet default worker, T1, 3 stages, 2 dashboard human gates)
   reaches a completed terminal state; `orgs/kb-ops/output/acceptance-run-status.md` and
   `acceptance-run-signoff.md` (verdict PASS) exist in `/var/lib/kb/ops`.
2. `iteration-loop-demo` (faceless-youtube; manager `fyt-runner` on `manager:claude:claude-fable-5`,
   workers `fyt-story` on `worker:codex:gpt-5.6-terra` and `fyt-checker` on `worker:codex:gpt-5.6-sol`,
   T2, validation-slice, no spend) reaches a completed terminal state with its `status.json` /
   `readiness.json` / `source.json` artifacts written.
3. Every attempt of both runs shows a broker-launched session for the expected CLI (claude AND codex
   both observed), running as `kb-shell`; zero launch refusals (`assigned agent resolution refused`,
   `runnable-owner-required`, `manual launch recipe is unavailable`, `226/NAMESPACE`, `toolPolicyId`
   decode errors) in `journalctl -u kb-dashboard` / broker journals for the run window.
4. Admission is healthy (`PUT /api/workflows/<nonexistent>` → 404, not 503 `outbox-degraded`) before
   the first launch, and the drain that got it there left every spooled bundle receipted.

## State found at plan time (2026-09-02 16:15 UTC, all verified live)
- VM release `c952c098` == PR #149 tip; `kb-dashboard`, `kb-shell-broker.socket/.service` active;
  `kb-node-proxy` failed (known stub, non-load-bearing). `/api/health` 200 over the tailnet.
- **Admission is DEGRADED right now**: `PUT /api/workflows/zzz` → `503 {"error":"outbox-degraded"}`.
  Three unreceipted bundles in `/var/lib/kb/state/outbox/ready` (audit rows: `e9e23b0d` 09-01 07:28,
  `0c507554` 09-02 02:14, `afe19771` 09-02 05:12); the oldest is > 24 h, which is the ceiling PR #149
  set (`DEFAULT_OUTBOX_MAX_AGE_MS`). Every launch route checks `admission('new-work')` first, so
  **Gate 4 cannot start until a drain.** This is open question D-1 from 09-01 materialising: with only
  the signed manual ceremony clearing bundles, the platform degrades daily.
- VM ops checkout `/var/lib/kb/ops` at `afe19771` = `ed85df3d` (last reconciled, on origin/ops) + the
  3 audit commits above; clean. `origin/ops` has moved past `ed85df3d` (nightly regen, handoff, memory)
  so the drain rebases the 3 rows onto the current ops tip. Receipts dir empty (last drain's receipts
  archived to `promoted/`).
- `readyz`: `quiescent:false`, blockers `execution-unlocked, queue-bridge-running, workers-active`.
  The first two clear with the lock; `workers-active` (`release/quiescence.ts:19`, `activeWorkers > 0`)
  must be diagnosed in P2 (no PTY sessions, `/api/control/runs` empty, no cgroup children — likely a
  stale fleet "working" record or the self-advertise beat).
- Execution `unlocked` (by `dashboard-engine` 05:13 UTC, tailnet source). Host advertisement route
  `/api/v1/hosts` 404s to an operator GET (node-scope only) — placement completeness must be checked
  another way (Home host chip / launch dry-run) in P3.
- Agents catalog on VM: all `fyt-*` `runner-bound: true` (host `vm`, never run); `demo-agent` and every
  kb-ops agent `runner-bound: false` — `acceptance-run` has no `agentId`, so `compile.ts:427` routes it
  to the default claude sonnet worker and never hits the runner-bound check. Correct as is.
- Browser terminal: proven over WebSocket last session; Daniel's own browser confirmation still owed.
- Local: `claude/outbox-max-age-default` (worktree `agent-aa79b80c…`) is folded into #149 — dead once
  #149 merges. `.claude/worktrees/agent-a86c4245…` is the #149 branch worktree — same.

## Rulings needed from Daniel (asked at plan time; answers recorded below when given)
- R1 Browser terminal confirmed working on his side? (if no → a P3 item before launches)
- R2 Merge #149 before Gate 4 (recommended: yes — the VM already runs its tip; merging makes
  main == VM and lets the two dead worktrees be swept)
- R3 Drain today with his `kb-ops-approver` signature (the one human step in the ceremony); and the
  D-1 direction: keep the 24 h ceiling + a daily signed drain, or raise/redesign (a follow-up PR)
- R4 Gate-4 runs = `acceptance-run` then `iteration-loop-demo` (both no-spend). He approves the two
  `acceptance-run` dashboard gates himself in the Inbox (doubles as a browser test), or the boss does
  it via `/api/control/human-requests/:ref/respond`
- R5 Run the non-blocking fixes (`rootId:'repo'` validator branch, `/usr/local/lib/kb` bootstrap-copy
  sync path) as a parallel codex PR while Gate 4 waits on gates — or park them

## Plan (one terminal task per phase; human gates marked GATE)
Worker mix target ≈ 75 % codex / 25 % claude; every Claude subagent's model is verified at grading by
grepping its transcript for `"model":`.

**P0 — plan + rulings (boss).** This handoff pushed to ops; R1–R5 answered. Tasks created.

**P1 — merge #149 + sweep.** GATE: Daniel merges #149 (or authorises the boss to). Then
`git fetch --prune`, delete `claude/linux-pty-capability-probe` + `claude/outbox-max-age-default`
locals and their `.claude/worktrees/agent-*` dirs (rev-list == 0 check first), `git worktree prune`.
No code changes.

**P2 — drain (fleet-pausing ceremony).**
- W1 (codex sol, `--worktree`, READ BUDGET): produce `drain-step1.ps1` / `drain-step2.ps1` in the
  boss scratchpad from the proven 09-01 pair (in the prior-session scratchpad), with: `--trusted-ops-head`
  = `ed85df3d…` (parent of the first pending bundle; verify against `promote_vm_outbox.py` semantics,
  not assumed), the one-off 09-01 lines removed (wake-card `rm`, `6a9fbcea` check, wf-* orphan check
  kept only as informational), a `workers-active` diagnosis step before the quiescence check
  (name the source: fleet record vs cgroup vs beat), and every abort message kept. Acceptance:
  PowerShell parses both (`-Command` syntax check), a dry read of the spool via
  `promote_vm_outbox.py --help` semantics documented in the script header, no VM mutation performed
  by the worker (read-only ssh only).
- Boss runs step 1: lock over the tailnet URL → quiescent → snapshot → approval request (exit 3).
- GATE: Daniel signs `instruction-approval.json` with the `kb-ops-approver` key
  (`ssh-keygen -Y sign -n kb-ops-instructions`), touching nothing else on the VM.
- Boss runs step 2: promote → apply on VM → receipts for all 3 → VM ops head moved → unlock.
- Verify: admission probe → 404; `readyz` ok; journal clean for 90 s; `origin/ops` contains the 3 rows.

**P3 — Gate-4 preflight (read-only).**
- W2 (claude **sonnet**): run `gate3-preflight.sh` on the VM (still CLEAN), confirm broker units +
  socket ownership, confirm `/api/workflows/acceptance-run` and `/api/workflows/iteration-loop-demo`
  detail carry no compile refusal, confirm the three profile ids the demo names exist in the runtime
  registry the VM loads (`governance/model-routing.yaml` known models + codex tiers), confirm a
  complete placement exists (host chip on Home shows `vm` with claude+codex clis; else identify why),
  confirm execution unlocked and no active runs. Output: a PASS/FAIL table, no fixes.
- If R1 = no: Daniel opens the Terminal page once (cookie mint + a shell) — GATE, quick.

**P4 — Gate 4a: the claude launch (`acceptance-run`).**
- W3 (codex sol, no repo writes): `POST /api/workflows/acceptance-run/launch` with a fresh
  `idempotencyKey`, then follow `GET /api/control/runs/:runRef`, `/events/stream`, and
  `/attempts/:attemptRef/io`; on each human gate STOP and report the request ref + prompt.
- GATE ×2 (one at a time, in plan order): Daniel approves `g1-review-draft`, later `g2-review-revise`
  in the dashboard Inbox (or boss via API per R4).
- Verify: signoff file PASS in `/var/lib/kb/ops/orgs/kb-ops/output/`, broker journal shows a
  `claude` launch as `kb-shell`, no refusals.

**P5 — Gate 4b: the codex launch (`iteration-loop-demo`).**
- W4 (codex sol): launch with parameter `slug=gate4-20260902`, follow the run; iteration gates
  (`/api/control/iteration-gates/:ref/resolve`) and any human requests reported, not resolved, unless
  R4 says boss resolves. Watch specifically for defects 1–4 resurfacing (model prefix, tool-policy id,
  codex sandbox, resume).
- Verify: `fyt-story` (terra) and `fyt-checker` (sol) attempts launched via the broker as codex under
  `kb-shell`; `fyt-runner` manager attempt on claude; artifacts present; run terminal.

**P6 — evidence review + close.**
- W6 (claude **opus**, read-only): adversarial audit of the P4/P5 evidence against the success
  condition — could any check pass without a real broker launch (e.g. attempt recorded but CLI never
  spawned, artifact written by a fallback path)? Names the exact journal lines / io records that
  prove each of the four conditions, or fails the gate.
- Boss: results back to `origin/ops` need a SECOND drain (the runs spool audit + result bundles) —
  only if Daniel wants them reconciled today; else note pending count. Update this handoff (or delete
  on completion), `memory/claude-boss.md` lessons, `orgs/kb-ops/STATE.md` if stale, sweep branches.
- Optional per R5: W5 (codex terra) PR for `rootId:'repo'` + bootstrap-copy sync, opus-reviewed.

## Known traps carried forward (do not rediscover)
- Lock/unlock only over `https://kb.tail82dd4f.ts.net` (localhost → `untrusted-peer`).
- Between approval generation and signing NOTHING may touch the VM — any audit row spools a bundle
  and invalidates the chain digest.
- `promote_vm_outbox.py` rejects a signature if `ssh-keygen` prints anything to stderr.
- `apply_ops_reconciliation.py` refuses on a dirty ops checkout and on `quiescent:false`.
- PTY capability is probed once per daemon process; a broker change needs a dashboard restart.
- Run scripts from Git Bash when they shell `scp`; PowerShell for the `.ps1` pair as before.
- `deploy-step*.ps1` say "send me this output" at every abort — keep that discipline: an abort is a
  stop, not a retry.

## Open, non-blocking (unchanged from 09-02 handoff)
`rootId:'repo'` can never validate; `/usr/local/lib/kb/` bootstrap copies never refreshed; no
`--settings` read-scope blob on Linux (protocol v2 deferred); `kb-node-proxy.service` stub.

## Checklist (updated as phases close)
- [ ] P0 rulings R1–R5 recorded
- [ ] P1 #149 merged, worktrees swept
- [ ] P2 drain complete, admission 404-healthy
- [ ] P3 preflight PASS
- [ ] P4 acceptance-run PASS (claude proven)
- [ ] P5 iteration-loop-demo complete (codex proven)
- [ ] P6 opus evidence audit PASS; memory + STATE + handoff updated
