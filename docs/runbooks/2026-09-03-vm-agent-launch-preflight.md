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

### d1. A release deploy does NOT reinstall systemd units - do this by hand when a unit changes

`scripts/deploy_platform_release.py` signs the tarball, `scp`s it, and calls
`activate_release.py activate`; `activate_release.py` extracts the release, flips
`/opt/kb-releases/current`, and restarts the daemon. **Neither ever writes
`/etc/systemd/system/kb-dashboard.service`.** The only writer is
`deploy/bootstrap_vm.py#install_dashboard_unit` (line 425), reached from the `bootstrap` and `converge`
subcommands - and `converge` re-renders the WHOLE fragment, so the per-VM `DASHBOARD_TAILNET_HOST`,
`DASHBOARD_TAILNET_OPERATOR`, and `DASHBOARD_DESKTOP_HELPER_ORIGIN` values must be passed again.

`validate_vm_runtime.py` asserts `UMask=0002` in its **static** phase, which runs from
`activate_release.py` before the symlink flip and from the unit's own `ExecStartPre`. Be precise about
what that buys today: the copy those two actually execute is the RESIDENT
`/usr/local/lib/kb/validate_vm_runtime.py`, refreshed only by `bootstrap_vm.py`
(`install_root_validators`, line 452) - a release deploy ships the new validator into
`/opt/kb-releases/<version>/deploy/` where nothing executes it. So an activation onto an unconverged VM
does **not** refuse; it refuses only once the resident validator has been refreshed. Until then the wall
is desktop-side: `scripts/deploy_platform_release.py#assert_dashboard_umask` probes
`systemctl show kb-dashboard -p UMask --value` over ssh and refuses the deploy before uploading a byte.

**Order matters, and it is the opposite of `bootstrap_vm.py`'s internal one - and it now names BOTH
units, not just the dashboard's.** `UMask=0002` is inert to the old resident validator (it has no rule
about `UMask`), while a refreshed validator against an old unit fails `ExecStartPre` on the next start.
So: **install BOTH unit files (`kb-dashboard.service` AND `kb-shell-broker.service`) + `daemon-reload`
FIRST, refresh the resident validators SECOND, restart the daemons LAST.** `converge` does both writes
with no start in between, which is why its own note reads the other way; a hand ceremony has no such
atomicity. If you do refresh the validators first anyway, **do not restart or stop either daemon until
BOTH new units are installed** - between those steps the service cannot start. This is stricter than it
was before W70 (Gate 4b run 3): `validate_vm_runtime.py`'s static phase calls `validate_broker_units()`
unconditionally, from inside the SAME invocation the dashboard's own `ExecStartPre` runs (`main()`,
`--phase static`). So refreshing the resident validator while `kb-shell-broker.service` on disk still
lacks `UMask=0002` does not merely leave the broker unfixed - `validate_broker_units()` raises on the
drifted broker unit BEFORE the dashboard's `ExecStartPre` can exit 0, which fails the DASHBOARD's own
start.

**The deadlock (W70, Gate 4b run 3), stated explicitly:** `scripts/deploy_platform_release.py#assert_dashboard_umask`
now probes BOTH `kb-dashboard` and `kb-shell-broker` and refuses the deploy unless EVERY probe reports
`0002` - and, exactly like the dashboard unit, a release deploy and its activation never write
`/etc/systemd/system/kb-shell-broker.service`. That unit's only writer is
`deploy/install_pty_broker.py#install_units`, which lays it down `install -m 0444` from a release
payload's `deploy/systemd/` - and nothing in a plain `deploy_platform_release.py` run invokes
`install_pty_broker.py`. So on a VM whose broker unit predates this fix, there is no release path that
reaches a passing pre-check by itself: **the hand edit below MUST come first.** Whenever
`install_pty_broker.py` next runs (this repo's `deploy/systemd/kb-shell-broker.service` already carries
`UMask=0002` after this fix), it re-lays byte-identical content over the hand-edited file - no drift,
and the hand edit was harmless plumbing to the same destination in the meantime.

```sh
# ON THE VM, as root. Preferred - re-renders the unit exactly as bootstrap does, in one step:
python3 /path/to/release/deploy/bootstrap_vm.py converge \
  --tailnet-host kb.tail82dd4f.ts.net \
  --tailnet-operator daniel.zhang.t1@gmail.com \
  --desktop-helper-origin https://<helper>.ts.net
systemctl restart kb-dashboard.service

# Minimal hand path when only the unit body changed (host/operator lines already installed).
# 1. UNIT FIRST - inert to the old validator, so nothing breaks if you stop here.
cp /etc/systemd/system/kb-dashboard.service /root/kb-dashboard.service.pre-$(date -u +%Y%m%dT%H%M%SZ)
# add the new directive(s) to [Service], keeping every existing Environment= line
systemctl daemon-reload
systemctl show kb-dashboard -p UMask --value          # must print 0002 BEFORE any restart
# 2. RESIDENT VALIDATORS SECOND - now the unit already satisfies the rule they arm.
install -o root -g root -m 0555 /opt/kb-releases/current/deploy/validate_vm_runtime.py \
  /usr/local/lib/kb/validate_vm_runtime.py
python3 -I -B /usr/local/lib/kb/validate_vm_runtime.py --phase static \
  --ops-root /var/lib/kb/ops --unit kb-dashboard.service
# 3. RESTART LAST.
systemctl restart kb-dashboard.service

# Twin ceremony for kb-shell-broker.service - do this FIRST if the broker unit still lacks UMask=0002
# (see the deadlock note above). The installed unit is 0444 (deploy/install_pty_broker.py#install_units),
# so edit a working copy and lay it down the same way the installer does, rather than editing the
# 0444 file in place.
cp /etc/systemd/system/kb-shell-broker.service /root/kb-shell-broker.service.pre-$(date -u +%Y%m%dT%H%M%SZ)
cp /etc/systemd/system/kb-shell-broker.service /root/kb-shell-broker.service.next
# add UMask=0002 to [Service] in /root/kb-shell-broker.service.next, keeping every existing directive
install -o root -g root -m 0444 /root/kb-shell-broker.service.next /etc/systemd/system/kb-shell-broker.service
systemctl daemon-reload
systemctl show kb-shell-broker -p UMask --value       # must print 0002 BEFORE any restart
# Restart only once no PTY session is live: KillMode=control-group means a restart kills every
# worker child under the unit's cgroup, not just the broker process.
systemctl restart kb-shell-broker.service
```

**Wall 1, the reason this section exists** (first successful claude launch, 2026-09-03): the daemon runs
`git worktree add` for every attempt, so the daemon's umask - not any later `chmod` - sets the modes
inside the run worktree. At systemd's default 0022 git wrote 2755 dirs / 644 files under the setgid
`kb-shell` group and the worker (uid `kb-shell`) could not write a byte into the tree it was handed;
`adapters.ts#chmodWorktreeComponents` only forces 02770 on the path components down to the attempt dir.
`UMask=0002` in `[Service]` is the fix, and it removes no control: write scope is enforced post-hoc from
`git status` (`adapters.ts:344-350`), never from filesystem modes.

## e. The drain

A ledger-only audit bundle (cost rows, no instruction content) needs no signature to promote. A
bundle that carries an **instruction path** (anything that would execute on the VM) needs the
`kb-ops-approver` key, signed with `ssh-keygen -Y sign -n kb-ops-instructions`. Either kind ages out
at a **24 hour ceiling** (`DEFAULT_OUTBOX_MAX_AGE_MS`) — past that, admission degrades to 503 on every
new-work route until a drain runs, whether or not anyone touched the VM in between.

## e2. The execution-profile catalogue lives on ops (W61, 2026-09-04)

`dashboard/server/control/environment.ts#loadExecutionProfiles` builds the whole
`manager:<runtime>:<model>` / `worker:<runtime>:<model>` catalogue from
`governance/model-routing.yaml` **as it exists in the daemon's ops checkout** (`/var/lib/kb/ops`,
via `loadRuntimeSkillRegistry(repoRoot)` over `runtimes.<runtime>.known_models`). Nothing on the VM
reads main.

- **Symptom.** `POST /api/workflows/<id>/launch` -> `400 assigned-profile-not-found` for a profile
  id that plainly exists on main (2026-09-04: `manager:claude:claude-fable-5`, with
  `worker:codex:gpt-5.6-terra` queued to fail next). The workflow, the agent and the assignment are
  all fine; the VM's copy of the registry is simply older than main's.
- **Fix.** On the desktop: `python scripts/sync_daemon_dirs.py --check` (the file is a
  `DAEMON_READ_DIRS` entry, so drift shows as `content-differs`), then `--sync` to mirror main onto
  ops, then promote (`python scripts/promote_vm_outbox.py ...`) so the reconciler moves the ops
  checkout on the VM. `governance/` is human-edited: never hand-edit either copy to close the gap.
- **The resident reconciler must be refreshed first.** `deploy/apply_ops_reconciliation.py`
  `RECONCILED` admits exactly `governance/model-routing.yaml` as of W61; the VM runs the resident
  copy at `/usr/local/lib/kb/apply_ops_reconciliation.py`, which a release deploy does NOT refresh.
  Until it is refreshed, the promotion pushes to `origin/ops` and the VM leg refuses the range with
  `reconciled ref contains a non-coordination path`, leaving the ops checkout untouched (no
  `kb-before-reconcile-*` branch: the refusal happens before that branch is cut). On the VM, as root:

  ```bash
  install -m 0555 -o root -g root \
    /opt/kb-releases/current/deploy/apply_ops_reconciliation.py \
    /usr/local/lib/kb/apply_ops_reconciliation.py
  # or, equivalently, re-run the converge that owns the resident tree:
  # python3 /opt/kb-releases/current/deploy/bootstrap_vm.py converge ...
  ```

- **Preflight.** `scripts/vm_launch_preflight.sh` FAILs on this drift and prints the model list the
  daemon will actually compile. It needs a reference and FAILs without one: pass main's hash as
  `$2` (or `$KB_MODEL_ROUTING_SHA256`), obtained on the desktop with
  `git show origin/main:governance/model-routing.yaml | sha256sum`. There is no on-VM fallback --
  `RELEASE_ROOTS` in `scripts/build_platform_release.py` ships `dashboard/**`, `scripts`, `schemas`
  and `deploy`, but no `governance/`, so the release carries no copy of main's version to compare
  against.

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
- **VM work products have no route off the box.** Wall 2's fix proves lineage durability against the
  local shared object store under `KB_COORDINATION_PUBLICATION=outbox`, which is correct - there is no
  remote to push to. But that means the `codex/managed-*` branches a VM run produces stay on the VM: the
  outbox `COORDINATION` regex (`scripts/promote_vm_outbox.py`, `deploy/apply_ops_reconciliation.py`)
  deliberately carries coordination paths only, and widening it to carry work products would turn the
  outbox into a general code channel. A separate promotion path for `codex/managed-*` is owed as a
  follow-up; until it exists, treat a VM run's work product as inspectable on the VM only.
- **P7** — the 24h drain ceiling in §e degrades admission daily with only a signed manual ceremony;
  auto-drain or a no-fleet-pause receipt path is owed as a follow-up PR.

- **Run gates are not projected into the Inbox (W47 follow-up).** An open T3 `approval` on a run is
  reachable only by navigating to that run's inspector; Inbox does not list it, so a parked run is
  invisible until someone goes looking. Deliberately out of W47's scope - it is a projection, not an
  authorization change - and owed as a separate PR.
- **The iteration-gates resolve route (W47 follow-up).** It resolves a gate without the
  `ceremonyModeAdmits` + credential check the human-request and deployment challenge routes enforce, so
  the two T3 paths disagree about what D2.13 requires. A governance inconsistency, not a W47 defect;
  it needs its own card and its own ruling before code moves.

## h. One-time: register Daniel's passkey against the VM RP (W47)

**Why.** The first complete acceptance run parked at a T3 `approval` gate nobody could clear:
`POST /api/control/human-requests/:ref/respond/challenge` answered `403 ceremony-unavailable` because
`ctx.credentials()` was `[]` by construction. `resolveCredentials()` reads exactly one variable
(`DASHBOARD_WEBAUTHN_CREDENTIALS`, `dashboard/server/auth/credentialStore.ts`), and tailnet mode used
to REFUSE TO BOOT if it or `DASHBOARD_RP_ORIGIN` was set. `governance/risk-tiers.md` D2.13 says a T3
decision travels a WebAuthn-signed channel only, so the fix is a constrained channel, never a bypass.

**The three legal postures in tailnet mode** (`auth/mode.ts#assertTailnetPasskeyChannel`, mirrored by
`deploy/validate_vm_runtime.py#_validate_passkey_channel`):

| `DASHBOARD_RP_ORIGIN` | `DASHBOARD_WEBAUTHN_CREDENTIALS` | boot | T3 gates |
| --- | --- | --- | --- |
| absent | absent | OK (today's default) | unavailable |
| set | absent | OK (**enrolment posture**) | unavailable |
| set | set | OK | approvable |
| absent | set | **REFUSED** | - |

When set, the RP origin must be EXACTLY `https://<DASHBOARD_TAILNET_HOST>` and the credential JSON
must parse to at least one entry. The enrolment posture grants nothing: an empty store means
`ceremonyAvailable` is false, every T3 challenge is `403 ceremony-unavailable`, and `assert/verify` is
`401` with no credential to match. Credentials without an origin refuse because a store that can pin no
RP-ID can never verify anything while still looking provisioned.

**The execution latch is untouched.** Tailnet arms it at boot with `source: 'tailnet'` and `unlock()`
short-circuits on an already-constructed execution, so no passkey assertion can ever re-source it
(proved byte-identically in `dashboard/server/control/activation.test.ts`).

**There is NO registration page.** Neither mode ships one; enrolment has always been a deliberate
out-of-band human step (`credentialStore.ts` never writes a store, per CLAUDE.md's credential ceiling).
`/api/auth/register/verify` REPORTS the material; it never trusts it. A human installs it. In tailnet
mode the four ceremony routes sit behind the operator identity gate (peer-uid + the pinned
`DASHBOARD_TAILNET_OPERATOR`), so only Daniel's browser can drive the ceremony; `/api/auth/context`
stays public in both modes.

```bash
# ON THE VM, as root. PHASE 1 - the RP origin ONLY, installed as a DROP-IN. Never edit the fragment:
# deploy/bootstrap_vm.py re-renders it on every converge and would drop the line (assert_unit_env_complete
# refuses a fragment carrying either name). The drop-in's CONTENT is pinned too - validate_vm_runtime.py
# refuses anything but a [Service] header plus these Environment= names, so it can never widen the sandbox.
install -d -m 0755 /etc/systemd/system/kb-dashboard.service.d
cat > /etc/systemd/system/kb-dashboard.service.d/passkey.conf <<'CONF'
[Service]
# W47 T3 passkey channel. PUBLIC keys only - see deploy/validate_vm_runtime.py PASSKEY_UNIT_ENV.
Environment=DASHBOARD_RP_ORIGIN=https://kb.tail82dd4f.ts.net
CONF
chmod 0644 /etc/systemd/system/kb-dashboard.service.d/passkey.conf
systemctl daemon-reload && systemctl restart kb-dashboard
systemctl is-active kb-dashboard   # ExecStartPre runs the W47 checks; a bad value fails loudly here
```

Then, in Daniel's browser, on `https://kb.tail82dd4f.ts.net` (the tab must be on that exact origin -
the routes are origin-guarded, the RP-ID is derived from it, and the operator gate reads this
connection's tailnet identity), open DevTools and run:

```js
// PHASE 2 - the Windows Hello ceremony. Paste as one block.
const j = async (u, b) => (await fetch(u, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(b||{})})).json();
const { ceremonyId, options } = await j('/api/auth/register/options');
// SimpleWebAuthn's startRegistration is not on the page; drive the platform API directly.
const dec = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
const enc = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const cred = await navigator.credentials.create({ publicKey: {
  ...options,
  challenge: dec(options.challenge),
  user: { ...options.user, id: dec(options.user.id) },
  excludeCredentials: (options.excludeCredentials||[]).map(c => ({...c, id: dec(c.id)})),
}});
const out = await j('/api/auth/register/verify', { ceremonyId, response: {
  id: cred.id, rawId: enc(cred.rawId), type: cred.type,
  response: {
    clientDataJSON: enc(cred.response.clientDataJSON),
    attestationObject: enc(cred.response.attestationObject),
    transports: cred.response.getTransports ? cred.response.getTransports() : [],
  },
  clientExtensionResults: cred.getClientExtensionResults(),
}});
// out.verified must be true. Copy the ONE-LINE JSON array below into the drop-in.
console.log(JSON.stringify([out.credential]));
```

```bash
# ON THE VM, as root. PHASE 3 - APPEND the credentials line to the drop-in, verbatim, on one line.
# Keep the surrounding single quotes: systemd Environment= is shlex-split and the JSON contains commas.
cat >> /etc/systemd/system/kb-dashboard.service.d/passkey.conf <<'CONF'
Environment=DASHBOARD_WEBAUTHN_CREDENTIALS='<PASTE>'
CONF
systemctl daemon-reload && systemctl restart kb-dashboard
curl -s https://kb.tail82dd4f.ts.net/api/auth/context   # expect {"mode":"tailnet","ceremonyAvailable":true}
sudo /opt/kb-releases/current/scripts/vm_launch_preflight.sh https://kb.tail82dd4f.ts.net
```

Then approve the parked gate in the UI: Run -> inspector -> the T3 gate now renders an enabled
Approve instead of "Passkey ceremony unavailable", and clicking it runs the Windows Hello ceremony.

**Owed to Daniel (human-edited, do NOT let an agent write it):** re-pin
`governance/webauthn-credentials.yaml`. It still records the 2026-07-17 desktop enrolment -
`rp-id: localhost`, `origin: http://localhost:5317` - and its own header says "Re-enroll + re-pin when
moving to ts.net". The new pin is `rp-id: kb.tail82dd4f.ts.net`, `origin:
https://kb.tail82dd4f.ts.net`, plus the new `credential-id` (and its `x`/`y`, which are the COSE
coordinates inside the `publicKey` this ceremony returned). Whether the localhost entry stays as a
second row is Daniel's call: it is the desktop dashboard's own root of trust, not stale drift.

**Rollback.** `rm /etc/systemd/system/kb-dashboard.service.d/passkey.conf && systemctl daemon-reload &&
systemctl restart kb-dashboard`. That returns the VM to the both-absent default posture, which is a
legal boot; the only thing lost is T3 gate approval in the UI. To roll back only the credential
(keeping enrolment reachable), delete just the `DASHBOARD_WEBAUTHN_CREDENTIALS` line.

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

## Addendum 2026-09-03 (overnight): how the pipe is delivered, and the codex entrypoint trap

**The shape that shipped.** For `headless-json` recipes the broker spawns the CLI with stdin on a pipe and
stdout/stderr on the PTY slave, through a root-owned Python shim (`dashboard/server/pty/pipeStdinExec.py`,
packed beside `main.js` in the broker archive and run with `python3 -I`). The shim re-opens the controlling
tty blocking, takes `TIOCSCTTY`, closes every fd except 0/1/2 and the pinned CLI descriptor (set
`FD_CLOEXEC`), then `execv('/proc/self/fd/<cli>')`. The CLI and the shim reach the child as descriptors in
stdio slots; no pathname is re-resolved. `/usr/bin/python3` is pinned ONCE at broker start through the same
walk as every other executable; if it is missing the daemon stops advertising `claude`/`codex` (shells stay
servable) instead of advertising a launcher that refuses at create. The harness asserts the child sees
`STDIN_TTY=0`, no `/dev/ptmx`, exactly fds `0,1,2,3`, a controlling tty (SIGWINCH), and a blocking terminal
that takes a 1 MiB burst intact.

**Codex is a shebang wrapper, not a binary.** `~/.local/bin/codex -> @openai/codex/bin/codex.js` starts
`#!/usr/bin/env node` and only `spawn`s the real ELF at
`~/.local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`
(hoisted installs put it one level up under `@openai/codex-linux-x64/...`). A script entrypoint cannot be
exec'd through a pinned descriptor (the kernel opens the interpreter, and the script fd is already
close-on-exec by then), so the launcher now resolves codex through a FIXED candidate list, native binary
first, and both the capability probe and `create` use the same resolver. The wrapper adds only
`CODEX_MANAGED_*` update-hint env; argv passes through untouched. `scripts/vm_launch_preflight.sh` now
prints the resolved codex target and fails on a shebang, and checks python3 and the deployed shim.

**Rule for the future:** before trusting any CLI under the broker, `head -c 4` its resolved entrypoint as
the shell user. `#!` means find the native binary and pin that.
