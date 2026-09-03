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

## Rulings from Daniel (2026-09-02 ~16:40 UTC)
- R1 = **not tried yet** → P3 gains a one-minute gate: Daniel opens the Terminal page once, boss watches the journal.
- R2 = **merge now** → DONE: #149 merged as `654ea4bd`; both dead worktrees + branches swept.
- R3 = **sign today; design a fix after Gate 4** → P7 added: codex-planned PR for the drain cadence (auto-drain or a receipt path without fleet pause + signature).
- R4 = **Daniel approves gates in the dashboard Inbox** (browser coverage); boss pings one gate at a time.
- R5 = not asked; non-blocking fixes stay parked unless Daniel says otherwise.

### As asked
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

## P3b — the browser terminal was broken by three composed defects (found 2026-09-02 16:45–17:10 UTC)
Daniel: "Terminal is unavailable on this host right now." after a hard reload + New shell. Proven by a
syscall trace on the daemon (`strace -f -p <daemon>` over the broker fd; log saved in the boss scratchpad
as `dtrace-17h02.log`) and reproduced in a real headless Edge over CDP (`scratchpad/cdp/run-1.log`):
1. `Terminal.tsx` sent `relativeCwd: "."` (and default root `repo`). My hand-rolled probe sent `""`,
   which is the only reason the 09-02 shell proof "worked".
2. `brokerProtocol.ts relativeCwd()` treats `"."` as a BrokerProtocolError; `linuxBrokerServer.accept()`
   answered `{"requestId":null,"code":"unsafe-cwd"}` and DESTROYED the daemon's socket.
3. `linuxBrokerClient.handleDisconnect()` set a sticky `unavailable`; `ensureConnected()` threw forever
   → every later create (terminal OR agent launch) returned `unavailable` until a daemon restart.
Also: the empty-state Terminal layout has no root select, so the first launch always ships the React
default; `repo` cannot pass the VM validator (`internal: root-owned component metadata is unsafe`) → P3c.
**Fix branch** (codex sol build → opus adversarial review → codex fix round → gates): lazy reconnect +
disconnect diagnostics; broker per-request refusals keep the connection (hello/undecodable still
destroy); daemon boundary validates cwd with the shared `isSafeRelativeCwd`, `"."`→`""`; Terminal sends
`""`, default root `worktrees`. Opus round found 2 MED (orphaned broker sessions after a drop → `capacity`
at 16; socket leak on failed `hello`) — fixed in the W5 round before PR.
**Deploy** = Daniel's step: WSL build (`npm run build:pty-broker` + `build_platform_release.py`), then
`deploy_platform_release.py <tar> <attestation> --signing-key <his key> --host root@100.89.73.118`,
then `install_pty_broker.py --digest <manifest digest>` (broker changed!), then `systemctl restart
kb-dashboard`. Then Daniel's browser check, THEN Gate 4.
**Lesson re-hit:** `codex --follow-up` drops `--cwd/--worktree` and writes into the main checkout
([[codex-followup-loses-cwd]]) — I knew and did it anyway; harvest from the main checkout was fine but
never again: fresh dispatch with `--cwd` for any writing follow-up.

## P3b DEPLOYED (PR #150 merged e7064569; VM release e7064569 + broker b1cf5b6a… live 18:18Z). Daniel's
browser shell proven (`kb-shell@kb:/var/lib/kb-shell/worktrees`). Deploy script that worked:
`scratchpad/deploy-pty-fix.ps1` (lock → deploy_platform_release under Git Bash with POSIX paths →
install_pty_broker --digest → daemon restart → unlock → health/admission). Two script bugs fixed on the way:
`-notmatch` on a multi-line ssh result is an array (never a boolean); python `re.sub` repl turns `` into
backspace — never build paths through a regex repl.

## Gate 4a — FIRST LAUNCH FAILED, three walls found (run-fa45349f, 18:26Z)
Draft attempt refused in 1.4 s: `claude attempt session start refused (invalid-request): attempt operation
key is invalid`. Root: `execution.ts:2124` mints `automatic-attempt:<ref>`; PTY validators
(`sessionRecord.ts:165`, `sessionPersistence.ts:49`, `brokerProtocol.ts:19`, `windowsSessionHost.ts:110`)
require `op-<64hex>`. NO agent attempt had ever started on a real host — every earlier proof used fake ports.
W8 (codex sol): deterministic `op-`+sha256 mapping at the attemptSessionAdapter boundary (gated green).
W9 (opus): mapping complete+safe, BLOCKED by two further unconditional walls — `bind()` needs a run-provenance
SessionRecord nobody writes (`persistRunSession` has 0 callers; adapter bypasses the registry), and bind
receives the host OUTPUT SEQUENCE as `expectedRevision` (document revision expected). Plus: persistence
validator ordering (317), test fake hiding unmapped reads, missing control→host log, managedExecution cancel
key for iteration turns, sessionId field misuse. W10 (codex sol, in flight): fix all + a real-store
integration test `attemptVertical.integration.test.ts` (real sessionRecord + persistence validator + broker-shaped fake host).
Also found: queue bridge can claim engine-owned stage cards between the 3 canonical hops (second launch path) → P4c.
Also fixed today: agents catalog drift (ops had 10 of 18 declarations → Schedules offline) → `sync_daemon_dirs --sync`
pushed `d7e962d4` to ops; VM picks it up at the next drain.

## ARCHITECTURE VERDICT (opus W18, fresh context, 2026-09-02 evening) — why the walls keep appearing
One attempt = 12 durable writes across 6 stores, 12 identifier namespaces, and 3 meanings sharing 2 field names
(`sequence`, `revision`). Confirmed tensions: (b) two writers of the session truth split across
`sessions`/`attemptBindings`/`attemptOperations`/`operationReceipts` — ~60% of all defects; (c) sequence
semantics differ per path (hosts count frames; transcript API expects byte offsets) — STILL LIVE until W16 lands;
(d) epoch handled in four places, no owner; (e) exit observed by the adapter, recorded by the registry; (g)
boot-time broker coupling crash-loops the daemon. Refuted: the `op-`+sha256 idempotency token is the standard
Docker-exec/CRI shape — keep it. Shapes that fit: Docker ExecCreate/ExecStart/Inspect, systemd transient
units, tmux/mosh. Six rules: one writer per durable fact + atomic start; runtime names the session, caller
supplies a token; one cursor space minted once; never two meanings per field name; epoch belongs to its
minter; per-request failures never kill transport, boot never depends on the runtime.
**Recommendation B (adopted):** keep the patch, restructure ONE seam (~1 day): S1 registry owns the start
(`startRunSession` does host.create + sink + all four collections in one mutate; delete `bind()` from the
attempt path); S2 one cursor space minted in the registry sink for both paths, rename
`HostStartReceipt.revision` → `outputSequence`; S3 registry is the only exit recorder (refused close →
terminal non-abandoned reason); S4 land the rest of W16 (no boot probe, pty doc v2→v3 migration + rollback
note, key fallback); S5 fake hosts count frames; `realBroker.integration.test.ts` (W17) is the merge gate;
fix the create-ok/attach-failed leak in linuxBrokerClient.ts:136-142. THEN Gate 4a/4b. Later: put the queue
bridge (P4c) behind `startRunSession`; make `document.epochId` a read-through of the broker epoch.

**Real-broker harness (W17) EXISTS and WORKS**: `dashboard/server/pty/realBroker.integration.test.ts` — real
`LinuxBrokerServer` + `LinuxBrokerClient` + protocol + registry + persistence validator + retention + attempt
adapter over a real Unix socket with a real node-pty bash child; Linux-only (`describe.skipIf`), run under WSL
`~/kb-v3` (`npx vitest run server/pty/realBroker.integration.test.ts`, node-pty present). First run against
round-3 code: scenario 1 fails with the transcript missing `READY` (frame-counter vs byte-offset drop), the rest
cascade — the first live wall ever reproduced by a test. It is the merge gate from now on.
Round 4 (W16) landed: byte-cursor sequencing, client DTO field, no boot probe (manual create activates epoch),
pty document v2→v3 with migration (`.v2.bak` written; rollback = stop daemon, restore `session-runs.json.v2.bak`),
refused-close records terminal exit, legacy key fallback, store validation. Harness on round-4 tree: scenario 1
reaches the END of the vertical on a REAL broker (launch, mapped keys over the wire, node-pty child, both
prompts as stream-json, `GOT:` echo, five lines with byte cursors); only the FIRST frame (`READY`) is lost —
emitted before the session row exists. W19 (seam restructure: registry-owned atomic start with the early-frame
queue inside the registry) is the fix by construction.
W19 (seam restructure) + W20 (scoped opus review) + W21 (opus debugger WITH the harness in the loop) landed:
harness 4/4 green on the real broker, repeated. W21's root cause of the post-restructure refusal: the adapter
treated "exit after the last approved prompt" as a start failure, and the compensating close hit an
already-finalized broker session (`not-found` masked the real refusal). Also fixed IN THE BROKER:
node-pty's first frame lost between spawn and listener registration (production launcher too); client now
binds session+sink synchronously on the create ack. Lesson: the reading-review loop found three walls per
round; ONE engineer with the real harness closed the vertical in one pass. Pattern for next time: build the
real-host harness FIRST, then let an opus debugger own the edit→run loop; use codex for well-specified
mechanical rounds only.

## 2026-09-03 — PR #151 MERGED (d84e4688) + DEPLOYED; Gate 4a relaunch hit two VM-only walls → PR #152
- Deploy of d84e4688 (broker 1e412f3a) OK. First relaunch: `[pty-registry] PTY session document is invalid` — the
  v2→v3 migration was wired lazily into the session-run store only; the registry read the raw v2 file first.
  Hand-migrated on the VM (`migratePtySessionStateRoot` as kb-dashboard; `.v2.bak` written), daemon restarted.
- Second relaunch: `claude attempt session start refused (internal): pinned component open refused`. Cause: the
  worktree adapter creates `run-<ref>` at 0700 (adapters.ts mkdirSync mode 0o700) and git creates `attempt-<ref>`
  at 2755; the broker (uid kb-shell, group-only) cannot open the run dir; the validator (fdPinnedPaths.ts:424)
  demands exactly 02770. PROVEN on the VM with the release's own `pinBrokerLaunch` as kb-shell: 02770 tree → ok;
  2700 → the exact live refusal; 2755 → "worktree component metadata is unsafe". (Probe trick: chmod as
  `sudo -u kb-dashboard -g kb-shell`, else setgid is silently dropped; the daemon has SupplementaryGroups=kb-shell.)
- PR #152 (`claude/vm-launch-modes`): chmod every worktree component the adapter creates to 02770 (fd-based,
  O_NOFOLLOW, after opus W25 caught the symlink-following hazard on a kb-shell-writable tree); PTY document
  migration runs once at boot before any reader (memoised; failure degrades, does not brick boot). Linux mode test
  red without the fix (0700=448 vs 02770=1528). Manifest gate forbids `skipIf` in focused files → platform guard
  lives inside the test body.
- The bridge keeps 409-ing the stale stage cards `wf-fe2fcb76…`, `wf-d0eaf235…` every tick (P4c); harmless noise.
- NEXT: merge #152 → rebuild from main → Daniel deploys → Gate 4a driver (w7 brief; acceptance-run) → Daniel
  approves g1/g2 in the Inbox → Gate 4b → P6 audit.

## 2026-09-03 10:22Z — FIRST REAL CLAUDE LAUNCH ON THE VM (release 079e5ab6, run-a9bdd60f)
The whole chain worked: control plane → adapter → registry start → broker → node-pty child as kb-shell; session
`pty-e2890418`, one prompt delivered, transcript captured. The CLI exited 1:
`Error: Input must be provided either through stdin or as a prompt argument when using --print` — `claude -p`
refuses a TTY stdin, and node-pty gives all three fds a TTY. Empirical probes on the VM as kb-shell:
`-p "<prompt>"` = one turn only (claude exits after it); `cat | claude` inside the pty = hangs; stream-json over
a plain pipe = works, multi-turn, before EOF; **stdin=pipe + stdout/stderr=pty slave = works, two turns in 4 s**
(target shape). W30 (opus + harness loop) is building that in the broker (`linuxBrokerMain.ts` launcher: pipe
stdin for `headless-json` recipes, pty for `shell`; input frames routed to the pipe; fd-pinned exec kept).
Probe scripts: scratchpad `ptyprobe*.py` (python pty/subprocess as kb-shell) — reuse them.
W30 built the pipe branch (openpty via node-pty's native binding + child_process.spawn with stdio
[pipe, slave, slave], detached); harness 25/25 with STDIN_TTY tripwire. Opus W32 BLOCKED it on fd hygiene:
the pty MASTER leaks into the child (transcript forgery), the child's stdout is O_NONBLOCK (burst truncation),
no controlling tty (SIGWINCH never delivered), resize-after-master-close on a recycled fd, stdin write-end
never closed. Fix shape (in flight, same engineer): a root-owned Python shim packed in the broker payload,
run as `/usr/bin/python3 /proc/self/fd/<shim> <pinned-cli-fd> args…`: reopen the tty blocking + TIOCSCTTY,
close every fd >= 3 except the pinned CLI fd, exec `/proc/self/fd/<n>`. Tests: no /dev/ptmx in the child's
/proc/self/fd, 1 MiB burst exact, WINCH trap after resize, resize-after-close guard, stdin destroyed.

## Process lesson (Daniel, 2026-09-03): 10-15 merges chased one vertical
Genuinely sequential: #149→#150→#151→W30. Avoidable: #152 (probe the VM validator before asking for a
deploy) and the three CI PRs (run the workflow's steps once on WSL). Rule: before any deploy, run
`scripts/vm_launch_preflight.sh`, probe the exact CLI invocation shape on the VM, and run the CI steps on Linux.

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
- [x] P0 rulings R1–R4 recorded (R5 parked)
- [x] P1 #149 merged (654ea4bd), worktrees swept
- [ ] P2 drain complete, admission 404-healthy
- [x] P3 preflight PASS (W2 sonnet, 10/10 live checks)
- [x] P3b PTY resilience PR #150 merged + deployed (e7064569) + Daniel browser check PASSED
- [x] P4-fix + P4d attempt-start vertical: PR #151 (969bfa26) OPEN — harness 4/4 green on the real broker; NEXT = Daniel merges → WSL rebuild from main → Daniel deploy (deploy-pty-fix.ps1: update Sha + BrokerDigest) → Gate 4a driver (w7 brief) → Daniel approves 2 Inbox gates → Gate 4b
- [ ] P4c queue-bridge second launch path (after Gate 4)
- [ ] P3d Terminal launcher UX
- [ ] P3c repo-root validation (after Gate 4)
- [ ] P4 acceptance-run PASS (claude proven)
- [ ] P5 iteration-loop-demo complete (codex proven)
- [ ] P6 opus evidence audit PASS; memory + STATE + handoff updated
- [ ] P7 D-1 drain-cadence design PR (codex plan → opus review), after Gate 4
