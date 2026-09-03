# VM agent-launch preflight (2026-09-03)

Read this before opening a Gate window on the VM, and before any deploy touching
`dashboard/server/pty/**`, `dashboard/server/control/attemptSessionAdapter.ts`, or the broker unit
files. It exists because Gate 4 (proving a real `claude`/`codex` launch through the broker) took four
PRs (#149-#152) and three days against walls invisible until a live launch hit them. Run
`scripts/vm_launch_preflight.sh` on the VM first — it catches the filesystem-shape defects below
before they cost a launch attempt.

## a. The launch chain, in order

1. **Control plane** — an operator or workflow hits a launch route: `POST
   /api/workflows/:id/launch` (`dashboard/server/workflows/routes.ts:1265`) for a workflow run, or
   `POST /api/control/proposals/:proposalRef/revisions/:revision/launch`
   (`dashboard/server/control/routes.ts:629`) for a single revision retry. Both check
   `ctx.admission('new-work')` first — see §e, this is the 404/503 gate.
2. **attemptSessionAdapter** (`dashboard/server/control/attemptSessionAdapter.ts`) resolves the
   approved attempt declaration, mints a durable `attemptOperations` record keyed by the control
   plane's own `operationKey`, then derives the host-facing key with `hostKey()` (line 303:
   `` `op-${sha256Hex(controlOperationKey)}` ``) and calls `options.sessionRecords.startRunSession`
   (line 1024) — this is "PHASE 1: the registry creates and atomically binds the run session."
3. **registry `startRunSession`** (`dashboard/server/pty/sessionRecord.ts:826`) is the single writer
   of run-session truth: it validates the host operation key against `OPERATION_KEY = /^op-[0-9a-f]
   {64}$/` (line 166; the same literal is restated in `sessionPersistence.ts:50` and
   `brokerProtocol.ts:19` — all three must agree or a well-formed launch is refused at a random hop),
   then drives the host adapter.
4. **LinuxBrokerClient** (`dashboard/server/pty/linuxBrokerClient.ts`, `class LinuxBrokerClient`)
   is the `SessionHost` implementation that speaks the wire protocol over
   `/run/kb-shell/broker.sock` (`BROKER_SOCKET_PATH`, `fdPinnedPaths.ts:27`). Every RPC calls
   `ensureConnected()` first.
5. **LinuxBrokerServer** (`dashboard/server/pty/linuxBrokerServer.ts`, `class LinuxBrokerServer`)
   runs as a separate systemd unit under uid `kb-shell` (see the frozen `BROKER_SYSTEMD_POLICY` table,
   `fdPinnedPaths.ts:60-104`) — the only principal that can see inside the provider home
   (`/var/lib/kb-shell/home`, 0700). It decodes the recipe and calls the pinning walk.
6. **`fdPinnedPaths.pinBrokerLaunch`** (`fdPinnedPaths.ts:519`) re-walks every path component of both
   `cwd` and `executable` with `openat`-style O_NOFOLLOW opens anchored at fds (ownership/mode rules
   in §b), hands back `/proc/self/fd/<n>` paths so the spawn cannot be raced by a changed path, and
   spawns the **node-pty child** from those fds — first-frame emission has to happen after the
   session row exists (see PR #151/#152 in §c) or the transcript starts one frame short.

## b. The validator's exact rules

`fdPinnedPaths.ts` `validateComponent()` (lines 412-440) is the one function every launch's path
components pass through. Read it as three buckets by path prefix, checked in this order:

- **Executable roots** — an executable must resolve (after following at most 8 symlink hops) inside
  one of `APPROVED_EXECUTABLE_ROOTS` (line 372): `/bin`, `/usr/bin`, `/usr/local/bin`, or
  `/var/lib/kb-shell/home/.local`. A launcher symlink under `.local/bin` is legal; `pinBrokerLaunch`
  pins the *link itself* by owner (must be `kb-shell`), and separately pins its *target* by the file
  rule below — Linux symlinks are always mode 0777 and chmod cannot change that, so the 0700/0750
  file rule is never applied to the link, only its target.
- **Home components** (`inHome`, anything under `/var/lib/kb-shell/home`) — owner must be
  `kb-shell:kb-shell`. The home directory itself must be **exactly 0700**. Everything else under it
  (files and directories alike) must be **0700 or 0750** — 0755, npm's default install mode, is
  refused.
- **Worktree components** (`inWorktree`, anything under `/var/lib/kb-shell/worktrees`) — must be a
  directory, group `kb-shell`, mode **exactly 02770** (setgid, so files the broker's `kb-shell` child
  creates inherit the group), and owned by either the dashboard uid or the shell uid (the worktree
  root itself must be dashboard-owned specifically). This is the rule PR #152 exists because of: a
  freshly `mkdirSync`'d `run-<ref>` directory is 0700 and a `git worktree add`'d `attempt-<ref>` is
  2755 — neither passes.
- **Root-owned components** (everything else — the chain above `/var/lib/kb-shell`) — owner must be
  root, group root or `kb-shell`, mode 0755 for files, 0755 or 0750 for directories.

Special/setuid/setgid bits (`mode & 0o6000`) are refused everywhere except the deliberate worktree
setgid exception (`0o2000`). Symlinks get their own mirrored ownership check per bucket
(`openAbsolute`'s `ELOOP`/`ENOTDIR` branch, lines 460-492).

## c. Defects found 2026-09-02/03, one line each

- **PR #149** (deploy defects, 7): stale model enumeration in the broker deleted in favor of the
  `MODEL_PREFIXES` claude-/gpt- prefix check (`fdPinnedPaths.ts:126`, comment at 108-125 explains why
  a second allowlist was actively harmful); the broker's tool-policy table replaced by one table
  derived from `control/workflowProfiles.ts` (`buildWorkflowPolicyTable`, line 182); codex launched
  with a colon-bearing model id; codex sandbox mode now derived from the resolved tool policy
  (`codexSandboxMode`) instead of hardcoded `workspace-write` for read-only stages, on both hosts;
  a `226/NAMESPACE` systemd failure from an `InaccessiblePaths` entry (`/var/lib/kb-activation`) that
  nothing on the VM creates, fixed with the `-` ignore-if-missing prefix (`fdPinnedPaths.ts:99`);
  `/run/kb-shell` left root-owned so `kb-dashboard` could not traverse to the socket, fixed by the
  socket unit's own `ExecStartPre` chown/chmod pair (`fdPinnedPaths.ts:76-79`); the frontend never
  minting the browser-session cookie `/api/pty` requires.
- **PR #150** (browser terminal wall, three composed defects): `Terminal.tsx` sent `relativeCwd: "."`
  with default root `repo`; `brokerProtocol.ts`'s `relativeCwd()` treated `"."` as a
  `BrokerProtocolError` and the server answered `unsafe-cwd`, which **destroyed the daemon's whole
  broker socket**, not just that request; `LinuxBrokerClient.handleDisconnect()` then set a sticky
  `unavailable` state (`ensureConnected()` threw forever after), so every later create — terminal or
  agent launch — failed until a daemon restart. Fix: per-request refusals keep the connection alive
  (hello/undecodable frames still destroy it); `"."` normalizes to `""`; Terminal's default root
  changed to `worktrees` (`repo` can never pass the validator — see §g P3c).
- **PR #151** (attempt-start vertical, first real launch attempt): op-key format mismatch — the
  control plane's `operationKey` is not itself `op-<64hex>`, so `attemptSessionAdapter.ts` now derives
  a deterministic `op-` + sha256 host key (`hostKey()`, line 303) rather than passing the raw key
  through; no code ever called `persistRunSession` to write the run-provenance `SessionRecord` that
  `bind()` needs, so bind always failed; `bind()` was receiving the host's **output sequence**
  (frame count) where it expected a document **revision** — three meanings sharing two field names
  (`sequence`, `revision`) across stores was the root architectural issue (see the opus verdict
  below); replay-hash mismatches; a restart-collision on the operation CAS; rows that recorded exit
  but never flipped to a terminal state; frame counters used as byte offsets in the transcript API
  (and back); the client-side exact DTO shape; a boot-time broker capability probe that crash-looped
  the daemon; the `kb.pty-sessions/v2`→`v3` document migration and its `.v2.bak` rollback path
  (`sessionMigration.ts:171-298`); node-pty's first frame lost between spawn and listener
  registration.
- **PR #152** (VM-only walls, found only once #151 was deployed and a real launch attempted):
  run directories created at 0700 by `mkdirSync` and attempt directories at 2755 by `git worktree
  add`, neither matching the 02770 the validator demands — "pinned component open refused"
  (`fdPinnedPaths.ts:465`). Fixed by `chmodWorktreeComponents()` (`adapters.ts:238-264`), which
  fchmods every path component between the worktree root and the target to 02770 via an O_NOFOLLOW fd
  (never the root itself — that belongs to the host installer). Second wall: the v2→v3 PTY document
  migration was wired lazily into the session-run store only, so the registry read the stale v2 file
  first and refused with `"[pty-registry] PTY session document is invalid"`
  (`sessionPersistence.ts:77`). Fixed by running the migration once at boot, before any reader,
  memoised and non-fatal on failure (`http/surface.ts:258-266`, `ensurePtyDocumentMigrated`).

**Architecture verdict** (opus, fresh context, after #151): one attempt is 12 durable writes across
6 stores sharing 2 overloaded field names (`sequence`, `revision`) for 3 different meanings — that
overload produced roughly 60% of the defects above. The adopted fix restructured ONE seam: the
registry now owns the atomic start (`startRunSession` does host-create + sink + all four collections
in one mutate; `bind()` was deleted from the attempt path) rather than patching each symptom.

## d. The deploy ceremony that works

1. Build on **Linux** (WSL) — `npm run build:pty-broker` then `scripts/build_platform_release.py`.
   Windows cannot produce the broker artifact.
2. Deploy the **release first**, then the **broker**, addressed by its MANIFEST digest:
   `scripts/deploy_platform_release.py <tar> <attestation> --signing-key <key> --host root@<vm>`,
   then `deploy/install_pty_broker.py --digest <manifest digest>` — only needed when the broker
   itself changed, but a dashboard restart is required after either. Run this script under **Git
   Bash with POSIX paths**, not PowerShell — it shells `scp` and a Windows-native path breaks that.
3. **Lock over the tailnet URL** (`https://kb.tail82dd4f.ts.net`) — locking against `localhost`
   answers `untrusted-peer`. Between generating the approval and signing it, nothing may touch the
   VM: any audit row spools a bundle and invalidates the signed chain digest.
4. **Quiescence blockers** to clear before the lock is usable: `execution-unlocked`,
   `queue-bridge-running`, `workers-active` (the last one needs its source diagnosed per run — fleet
   "working" record vs. a live cgroup child vs. the self-advertise beat — before assuming it is
   stale) and, separately, a stale probe shell left over from a previous Terminal session.
5. Restart the daemon **last**, after the release and broker are both in place, then verify the
   admission probe returns **404** on `PUT /api/workflows/<nonexistent>` (503 `outbox-degraded` means
   the drain in §e has not run) and `/api/health` returns 200, both over the tailnet URL.
6. **Rollback** of a bad PTY-document migration: stop the daemon, restore
   `session-runs.json.v2.bak` over the migrated file, restart.

## e. The drain

A ledger-only audit bundle (cost rows, no instruction content) needs no signature to promote. A
bundle that carries an **instruction path** (anything that would execute on the VM) needs the
`kb-ops-approver` key, signed with `ssh-keygen -Y sign -n kb-ops-instructions`. Either kind ages out
at a **24 hour ceiling** (`DEFAULT_OUTBOX_MAX_AGE_MS`) — past that, admission degrades to 503 on every
new-work route until a drain runs, whether or not anyone touched the VM in between.

## f. Diagnosis tools that worked

- **`strace -f -p <daemon-pid>`** on the daemon's broker fd was what actually proved the "Terminal
  unavailable" symptom was a destroyed socket, not a slow one — read the syscalls around the failing
  request, don't guess from the HTTP response alone.
- **Run the release's own validators on the VM**, not a hand-rolled check: `node
  --experimental-strip-types <script>` as the exact user that matters (`kb-shell` for anything
  filesystem-shaped, `kb-dashboard` for anything socket-shaped), passing a real `PinIdentities` map
  that includes `rootUid` — a probe built against fake identities validates a different filesystem
  than the one that will refuse the real launch.
- **Mode probes must preserve the setgid bit**: `chmod` as `sudo -u kb-dashboard -g kb-shell`, or as
  the owning uid directly — a bare `sudo chmod` as root silently drops setgid on some paths, making a
  probe report success on a tree the real broker will still refuse.
- **`dashboard/server/pty/realBroker.integration.test.ts`**, run under WSL
  (`npx vitest run server/pty/realBroker.integration.test.ts`, Linux-only via `describe.skipIf`,
  needs node-pty present) wires a real `LinuxBrokerServer` + `LinuxBrokerClient` + protocol +
  registry + persistence validator + retention + attempt adapter over a real Unix socket with a real
  node-pty bash child. It is the merge gate for this vertical — it reproduced the first live wall
  (missing `READY` frame) no unit test caught; going 1/4 to 4/4 green on it closed the vertical, not
  another round of code reading.

## g. Known open items (not blocking Gate 4, do not re-litigate)

- **P3c** — `rootId: 'repo'` can never pass the validator (root must be `worktrees`); Terminal's
  empty-state root selector still offers it and needs to stop.
- **P4c** — the queue bridge can claim engine-owned stage cards as a second, un-audited launch path
  between the three canonical hops; put it behind `startRunSession` directly.
- **P4e** — W22 residue from the seam-restructure round, not yet swept.
- **P3d** — Terminal launcher UX (no root select on first launch is what let `repo` ship default).
- **P7** — the 24h drain ceiling in §e degrades admission daily with only a signed manual ceremony;
  auto-drain or a no-fleet-pause receipt path is owed as a follow-up PR.

## Addendum 2026-09-03 10:22Z: the CLI's own stdin rule (found by the first real launch)

With every layer above fixed, the first real `claude` attempt on the VM started, received its prompt over the
PTY, and exited 1: `Error: Input must be provided either through stdin or as a prompt argument when using
--print`. `claude -p` refuses to read a TTY stdin, and node-pty gives the child a TTY on all three fds.
Probes on the VM as `kb-shell` (scripts in the 2026-09-02/03 boss scratchpad, `ptyprobe*.py`):
`-p "<prompt>"` = exactly one turn, then exit; `cat | claude` inside the PTY hangs; stream-json over a plain
pipe works multi-turn before EOF; **stdin on a pipe + stdout/stderr on the PTY slave works, two turns in 4 s**.
That is the broker change (headless-json recipes: pipe stdin, route `input` frames to the pipe, keep the
fd-pinned exec; `shell` keeps the TTY). Rule for the future: any headless CLI launched under the broker must
be probed for its stdin contract with the pipe+pty shape before the recipe is trusted.
