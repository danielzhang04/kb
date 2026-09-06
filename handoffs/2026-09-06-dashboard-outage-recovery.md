# Handoff 2026-09-06 — VM dashboard DOWN (hydrate refusal crash loop); fix is PR #173, recovery scripted

## Load on resume
1. This file.
2. `handoffs/2026-09-02-dashboard-gate4-live-launch-plan.md` (the whole Gate-4 arc, sections dated 09-03..09-05).
3. `memory/claude-boss.md` (tail: 2026-09-04/05/06 laws).
4. Boss scratchpad (session 4dd42e67): `morning-rebuild.ps1`, `recover-deploy.ps1`, `deploy-pty-fix.ps1`, `drain-step1/2.ps1`, `w7q-gate4b-report.md` (run 4), `passkey-enrol.ps1`.
5. `docs/runbooks/2026-09-03-vm-agent-launch-preflight.md` (deploy ceremony d/d1, drain e, catalog e2, passkey h).

## STATE (2026-09-06 ~20:30Z)
- **kb-dashboard.service on the VM is STOPPED (failed, 6 restarts) since 19:04:55Z.** Every boot on release 39197cf5 dies at hydrate: `invalid control-plane creator attempt generation provenance` (store.ts:1715). The state document is NOT corrupt; the validator's pending-request join lacked subject/runRef and compared run 4's rework attempt against run 3's still-open request. Forensic snapshot: VM `/root/forensics-20260906T190455Z/`. No orphaned worker processes; broker fine (UMask 0002 on both units).
- **Fix = PR #173** (`claude/provenance-fix` @ e8bf8d35; opus root cause W72 + review W73 MERGEABLE; verified the live snapshot loads with the guard; plus the failure handler can no longer kill the process). NOT merged at handoff.
- Live release 39197cf5 (broker 610230c7). Deployed today before the outage: #171 (ledger budgets + rolling window, activation via `changed`, git safe.directory), #172 (broker UMask + iteration prompt rule). Gate 4b run 4 (`run-971d5ba4`, slug gate4b-20260906) got the furthest ever: concurrent producers, loops activated, checker turns dispatched, then the outage. Its attempt `713a22a2`/session `77047d3c` are stale-live (child dead); the run must be interrupted after recovery.

## RECOVERY (in order; Daniel merges, boss runs the scripts)
1. Merge PR #173.
2. `morning-rebuild.ps1` (guard e8bf8d35) -> release sha + broker digest written into `deploy-pty-fix.ps1`.
3. `recover-deploy.ps1 -SigningKey "$HOME\.ssh\kb-release-signing"` (NOT deploy-pty-fix.ps1: the daemon is down so there is no API lock). It: backs up `/var/lib/kb/state/control` to `/root/pre-fix-<ts>`, `systemctl reset-failed`, parks `/opt/kb-releases/current` so `activate_release.py` takes its is-active branch, pre-installs the release's validator, signs/uploads/activates, verifies VERSION + active + no `assertHydrated` throw, refreshes resident validator/reconciler, verifies broker digest, health. If activation unlinks `current`: `ln -sfn <sha> /opt/kb-releases/current` and start the unit.
4. Verify hydrate: `journalctl -u kb-dashboard -n 40` clean; `GET /api/control/runs/run-971d5ba4-16e5-4010-895f-33e69122984a` serves. Then `POST .../manager/stop` (idempotencyKey + expectedRunVersion + expectedManagerGeneration from the run) to interrupt it.
5. Preflight with main's routing hash (`git show origin/main:governance/model-routing.yaml | sha256sum`), admission 404 (drain if 503: chain base = oldest ready bundle's parent; Daniel signs if any `queue/` paths).
6. Decide on Gate 4b run 5 (slug gate4b-20260907): expected to reach exec resume, accept/pass, both park shapes.

## After recovery (Phase B, Daniel's stated goal: a working, iterable, consistent platform)
Post-deploy canary (one leg per runtime/role, run by the deploy script, fails the deploy); drain automation (P7 plan merged as doc, needs build); wire guards for every client decoder (P15d); P21 malformed-outcome re-ask; P23 process-level rejection handler policy; retire 15 stale wf-* cards; P11 work-product route; P14 ruling; governance/webauthn-credentials.yaml re-pin (values in the 09-03 handoff section); P18 n8n comparative analysis.

## Lessons of the day (also in memory/claude-boss.md)
- A validator that runs over the whole document must key every join by run; a writer that validates per run hides that until two runs coexist.
- A failure-surfacing path that re-loads the store can turn a refusal into process death; guard it (done) and decide the process-level policy (P23).
- A release that changes a frozen unit contract must pre-install its resident validator before activation (deploy step A3 now does; recover-deploy too).
- Probing the resident validator by hand needs the unit's env (systemd-run -p User= -E HOME=), or it fails on DBUS/HOME.

## THE SHIP PROCESS WE CONVERGED ON (every PR since 09-03 went through this; keep it)
1. **Probe before building** when a leg has never run on the VM: reproduce the broker's exact argv as the worker uid
   (scratchpad `probe-codex.sh`, `probe-manager.sh`, `ptyprobe*.py`). Ten minutes of probing replaced deploy cycles.
2. **Root cause (opus, read-only)** over code + VM state, citing file:line and VM evidence; one recommended fix per wall.
3. **Build (opus for broker/security/store; sonnet for docs/UX/glue)** in a fresh `kb-worktrees/<name>` from origin/main,
   node_modules as a JUNCTION to a sibling install (currently `kb-worktrees/vm-movement-p1/dashboard/node_modules`;
   the main checkout's node_modules is EMPTY). Workers never commit. Every fix ships with a red-on-revert test.
4. **Gates run by the boss**, never trusted from the worker: Windows `tsc --noEmit` (both tsconfigs when broker files
   change) + the touched vitest files; the Linux real-broker harness under WSL (`wsl-*-gate.sh` pattern: reset ~/kb-v3 to
   origin/main, apply the exported patch, run realBroker.integration + linuxBrokerServer + fdPinnedPaths twice, build the
   broker archive and note its sha256); pytest for deploy/scripts changes; `bash -n` on LF copies of shell scripts.
5. **Adversarial review (opus, read-only, scoped questions A-G, at most 25 min)**; BLOCKED items folded by the same builder
   (SendMessage resume); the same reviewer re-confirms (about 2 min). Verdicts posted as PR comments.
6. **Commit by the boss** (`python scripts/sync_skills.py` first for the pre-commit hook; message from a scratchpad file),
   push, `gh pr create` with a body: Why / What / Evidence / After merge / Not in this PR.
7. **Daniel merges** (the only merge authority). No branch-tip deploys.
8. **Rebuild from origin/main**: `morning-rebuild.ps1` refuses unless origin/main contains the PR head sha(s) it was pointed
   at, builds on WSL (`npm run build:pty-broker`, vite build, `build_platform_release.py`), copies tarball + attestation
   into scratchpad/release, and rewrites `deploy-pty-fix.ps1` defaults ($Sha, $BrokerDigest = archive sha256).
9. **Deploy (Daniel runs, boss authors)** `deploy-pty-fix.ps1 -SigningKey <release signing key path>`: A lock over the
   tailnet + quiescence; A2 both units UMask=0002 (edit + daemon-reload before activation; remote scripts run via
   `cmd /c "ssh host bash -s < file"` to dodge PowerShell quoting); A3 pre-install the release's resident validator (frozen
   unit contracts); B `deploy_platform_release.py` under Git Bash with POSIX paths (signs, uploads, activates, restarts the
   daemon; refuses if a unit's effective UMask is not 0002); C confirm VERSION; C2 resident validator refresh + static
   dry-run; C3 resident reconciler refresh; D `install_pty_broker.py --digest`; E daemon restart; F unlock + health 200 +
   admission (404, or 503 = drain next); G committed preflight with main's routing sha256 (must be CLEAN; only the
   admission FAIL is tolerated). With the daemon DOWN use `recover-deploy.ps1` instead (no API lock; parks `current`,
   reset-failed, then the same A3/B/C/C2/C3/D/F).
10. **Drain when admission is 503** (24 h ceiling on the oldest outbox bundle): `drain-step1.ps1` (lock, quiescence, clean
    ops checkout, approval for the chain; CHAINBASE = the oldest ready bundle's `parent`, full 40-hex), Daniel signs with
    `ssh-keygen -Y sign -f <release signing key path> -n kb-ops-instructions <approval.json>`, `drain-step2.ps1` (promote +
    reconcile + unlock). Ledger-only chains promote unsigned via `promote_vm_outbox.py --trusted-ops-head <full sha>` with
    no --approval. Always check `git -C /var/lib/kb/ops status --short` first.
11. **Launch via a sonnet driver** (`w59-gate4b-driver-brief.md`, `w7-gate4a-driver-brief.md`): read-only, never
    approves, explicit STOP conditions, evidence blocks (init tools, ps line, attempt io, canonical records, journal); the
    boss arms a journal Monitor and, for long waits, a persistent run-state Monitor.
12. **T3 gates are Daniel's passkey** (Run detail -> Approve -> Windows Hello); the boss pre-inspects the artifact and hands
    one gate at a time.
13. **Close**: sweep merged worktrees (delete the node_modules JUNCTION first), handoff + memory to ops.

## PR LEDGER 09-03 -> 09-06 (all merged by Daniel except the last)
- #157 drain-cadence PLAN (doc, P7); awaiting Daniel's ruling.
- #158 P4e broker-client residue (three review rounds).
- #159 stdin-pipe exec shim + codex NATIVE-binary pin + preflight/runbook (three rounds; harness 55/55 six times).
- #160 tool cap `--tools` + `--strict-mcp-config` (live-proven: 4 tools, no MCP; uncapped = 68 incl. Gmail/Drive).
- #161 daemon UMask=0002 + outbox-aware lineage durability + deploy pre-check + preflight (two rounds).
- #162 constrained VM passkey channel (origin alone legal; drop-in content-pinned; ceremony routes operator-locked).
- #163 run-detail envelope decorations; #164 stage/attempt DTOs + cross-tier guard; #165 human-response DTO +
  participantAttemptRef + guard over all ten lists (three layers of client/server wire drift).
- #166 replay pane retry; #167 + #168 queue bridge (never claims engine wf-* cards; wake-me through the coordination
  writer; the un-write gated on untracked).
- #169 governance/model-routing.yaml admitted as a daemon-read mirror path (+ sync tool + preflight drift check).
- #170 codex launch: dead `--cd` dropped (headless + interactive); new broker wire request `end-input` (typed, sequenced,
  per-session ordered, client counter rollback).
- #171 ledger-derived budgets + rolling accounting window; loop activation reads `changed`; git safe.directory.
- #172 broker unit UMask=0002 + iteration prompt emptiness rule.
- #173 (UNMERGED at handoff) hydrate pending-request join keyed by run; failure surfacing never kills the process.

## EVERY PROBLEM HIT, IN ORDER (symptom -> cause -> where fixed)
1. Terminal "unavailable" -> `.` cwd + protocol destroy + sticky client -> #150.
2. `attempt operation key is invalid` -> key mapping + two writers / two cursors / two exit recorders -> #151 (seam
   restructure after four review rounds and an architecture verdict).
3. VM `pinned component open refused` / PTY doc invalid -> run dir 2700, doc v2 -> #152 + a hand migration.
4. CI red on every merge -> jsonschema, oracle env, orphan fixtures, broker build order -> #153-#156.
5. First real claude launch exit 1 -> `claude -p` refuses a TTY stdin -> #159 shim (pipe stdin + pty stdout).
6. Review of the shim: leaked pty master, slave O_NONBLOCK, no TIOCSCTTY, resize on a recycled fd, stdin never destroyed,
   EPIPE coverage, tautological test -> folded into #159 (fd hygiene; `PTMX=0 FDS=0,1,2,3`).
7. codex entrypoint is a `#!/usr/bin/env node` wrapper (a pinned-descriptor exec cannot run it) -> native ELF pin, #159.
8. Worker could not write its output (2755 checkout under umask 0022) -> daemon UMask, #161.
9. `lineage publication failed: transport 'disabled'` on every stage -> outbox-aware durability, #161.
10. Scanner worker held 68 tools incl. Gmail/Drive connectors and called Bash -> `--tools` cap, #160.
11. T3 approvals impossible (tailnet retired the WebAuthn vars; no passkey) -> #162 + Daniel's enrolment.
12. Run detail "invalid run detail" three times -> envelope decorations, then nine stage/attempt fields, then
    respondedBy/idempotencyKey (plus a fourth latent field, participantAttemptRef) -> #163/#164/#165 + cross-tier guard.
13. Replay pane "terminal output could not be read" -> transient read race with no retry -> #166.
14. Stray untracked wake-me cards in the VM ops checkout blocked every drain -> the queue bridge claimed engine cards and
    wrote bare files -> #167/#168 (a post-merge HIGH: the un-write of a committed card -> #168).
15. Gate 4b launch refused `assigned-profile-not-found` -> model-routing.yaml drift with NO route to the VM -> #169
    (reconciler allowlist + sync tool) + an unsigned ledger-only promotion.
16. codex probes: the broker's `--cd /proc/self/fd/<n>` is dead at exec; stdin held with U+0004 hangs -> #170.
17. Gate 4b run 1: "global token or cost budget exhausted" with a $0 ledger (1M x 2 = the 2M window) and a window that
    never rolled; loop activation compared against the worker's always-empty `artifacts` -> #171. The review refuted the
    first 400k ceiling with the ledger's own maxima (1.22M input).
18. Run 3: daemon EACCES cleaning worker dirs (the broker unit had no UMask) + the pair-checker's `rework` carried
    `positions` (the prompt never stated the rule) -> #172.
19. Deploy of #172 refused by the OLD resident validator (new pinned directive) -> deploy step A3 (validator first).
20. Run 4: hydrate refused the whole document (cross-run pending-request join) -> crash loop -> #173 (+ handler).
21. Ceremony/tooling: PowerShell mangles quoted remote commands (use `cmd /c ssh ... bash -s < file`); PowerShell pipes
    append CRLF; regex replacements can turn `\v` into a vertical tab; `git worktree remove` follows a node_modules
    junction (delete it first); Git Bash mangles `/mnt/c` and `$(` (MSYS_NO_PATHCONV, script files); vitest 5 s caps
    time out under load (re-run alone; p3DeletionClosure is P10); WSL idles out between commands (harmless); opus 529s
    mid-agent (resume; verify the tree by patch diff); the classifier blocks a driver's approve call (approvals are
    Daniel's anyway); the deploy pre-check and the resident validator can deadlock across a unit-contract change.
