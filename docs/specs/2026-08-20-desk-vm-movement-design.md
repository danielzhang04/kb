# Desk ⇄ VM movement — design

Date: 2026-08-20 · Status: design for implementation  
Binding decisions: `docs/plans/2026-08-19-desk-vm-movement-decisions.md`  
Unqualified paths are under `C:/Users/danie/kb`; `[cutover]` paths are under `C:/Users/danie/kb-worktrees/cutover-run`.

## 1. Overview and trust model

The desktop is the cockpit: Daniel's interactive sessions, local signer, editor, and future Atlas client. The VM is the factory: the always-on dashboard, governed workflows, managed workers, and cadences. They share git content and explicitly transferred assets, never personal `~/.claude` state.

The VM retains three trust properties:

1. **Immutable signed releases.** CI emits `kb-platform-<sha>` plus a canonical attestation; the desktop verifies the digest and signs; the VM accepts only the signed digest and atomically selects an immutable release. CI and VM hold no signing key (`[cutover] scripts/deploy_platform_release.py:16-47`; `[cutover] deploy/activate_release.py:223-258,308-345`).
2. **Credential sandbox by least privilege.** Worker environments come from an allowlist; the denylist only filters allowed names (`[cutover] dashboard/server/control/childEnv.ts:1-29,31-70`). Dashboard and workers share uid `kb-dashboard`, so same-uid files are agent-readable; environment filtering is not file containment (`[cutover] deploy/systemd/kb-dashboard.service:5-8`; `[cutover] dashboard/server/control/claudeWorkerAdapter.ts:685-699`). Server-only credentials use another uid. Agent-readable credentials are minimal and explicitly registered.
3. **Persisted deploy fencing replaces managed-run quiescence.** A deploy fences every admission source, lets each active attempt finalize durably, parks the run, swaps, then rehydrates on the selected release. The eight-input quiescence predicate is retired as swap authority, with each input mapped to a fence acknowledgement or explicit residual-activity policy (`[cutover] dashboard/server/release/quiescence.ts:14-24`).

Delivery bars remain fixed:

- **Acceptance:** resume-safe deploys and the desktop one-command deploy work live on the VM; the unified Inbox is the only approval surface for governed cards, run gates, deploys, and PR notifications.
- **Designed and partially built:** asset return, repo-backed memory parity, and the credential registry plus the two named GitHub grants.
- **Stretch:** one complete FYT video run executes on the VM and its manifested assets are pulled home.

## 2. Resume-safe deploy engine

### 2.1 Durable model and single writer

Modify the existing control document and transitions; do not add a parallel run store. The current target's `StoreDocument` owns the control collections at `dashboard/server/control/store.ts:267-282`; the cutover analogue is `[cutover] dashboard/server/control/store.ts:412-428`.

The process entrypoint—not `makeSurfaceContext()`—creates random `bootId`, acquires a nonblocking exclusive OS lock on `$DASHBOARD_STATE_ROOT/control/dashboard.lock` with `O_CLOEXEC`, then holds its fd for process lifetime. Lock failure prevents app construction, so the contender atomically writes `control/lock-contention.json` as `{bootId,contenderPid,contenderStartTicks,holderPid,observedAt}` and exits. The sidecar is current only while `/proc/<contenderPid>/stat` matches `contenderStartTicks`; readiness ignores stale records. The incumbent re-verifies through its fd and `/proc/locks` that it owns the lock inode, then deletes the sidecar, making it the clearing owner; a current record yields explicit retryable blocker `lock-contention`. If no incumbent listens, systemd journal plus resident watchdog is visible. A spawned-child test proves the lock fd is not inherited. After 90 seconds the activator confirms service cgroup empty and reports any holder instead of waiting forever (`[cutover] dashboard/server/index.ts:135-148`; `[cutover] deploy/systemd/kb-dashboard.service:28-32`).

`createFileControlPlaneStore()` requires an explicit capability: `already-locked` for one writer, or `read-only-harness` with every mutation disabled. `makeSurfaceContext()` receives the store/capability instead of silently acquiring again. Production passes its entrypoint lease; synthetic acceptance acquires one exclusive lease on its throwaway state root and passes `already-locked`; inspection harnesses use read-only or isolated roots. This removes current unconditional construction (`[cutover] dashboard/server/http/surface.ts:123-142`; `[cutover] dashboard/server/control/synthetic-acceptance.ts:216-258`).

Replace persisted `Run.state` with the intentionally source-breaking field:

```text
Run.lifecycle =
  | { kind: paused-for-deploy, deployPause: DeployPause }
  | { kind: <each existing state>, deployPause: null }
DeployPause = { deploymentRef, pausedAt, priorKind, resumeStreak,
                lastResumeAttemptCursor,
                resumeClaim: {deploymentRef,bootId,claimantRef}|null }
AdmissionLease = { leaseRef, epoch, chokepoint, createdAt, durableOwnerRef|null }
Deployment = { deploymentRef, targetCommit, previousCommit, state, requestedAt,
               parkWarnAt, swapDeadlineAt|null, fenceRevision, drainAcks, blockers, progress,
               abortRequestedAt|null, error,
               terminalOutcome, acknowledgedBy }
DeploymentState = waiting-confirmation | requested | parked | swapping | resuming |
                  succeeded | aborted | failed | acknowledged
```

There is no durable `parkedRunRefs[]`; projections derive it by filtering `Run.deployPause.deploymentRef`. One deployment may be nonterminal. Every transition is one expected-revision store mutation with an idempotency key. Public DTOs may continue to expose `state`, but only through exhaustive `RunLifecycle` switches with `assertNever`. Renaming the persisted field makes every old access fail compilation; a meta-test enumerates every predicate and projection and proves it handles every lifecycle kind. The current plain string union cannot provide that guarantee (`[cutover] dashboard/server/control/types.ts:64-80,92-101`).

`interrupted` remains unexpected loss of ownership; `paused-for-deploy` is intentional and fully committed. A deploy pause takes precedence over `pendingActivation`: crash normalization preserves the pending activation receipt inside the paused row, clears a stale resume claim, and lets rehydration finish that activation before automatic execution. Without `deployPause`, pending-activation recovery retains its present waiting-human containment. Today the generic recovering branch applies that containment first (`[cutover] dashboard/server/control/store.ts:3263-3281`).

Before adding lifecycle v2, extract `prepareLegacyStoreMigration`, attempt-provenance migration, review-loop materialization, and legacy-row decoding from `normalizeCrash()` into ordered registry migration v1→v2. `normalizeCrash()` then performs state normalization only; those four migrations are currently interleaved at `[cutover] dashboard/server/control/store.ts:3250-3252,3297-3299,3354-3366`. It still runs once at store construction (`[cutover] dashboard/server/control/store.ts:6574-6587`).

Add monotonic `documentRevision`, incremented by every mutation. Coalesce fence creation, affected-run capture, and initial drain acknowledgements into one transaction; coalesce each park plus its acknowledgement likewise. On Linux/VM, deploy-critical mutations—fence, park, resume claim, deployment transition, and migration—write temp, fsync fd, rename, then fsync the directory. Ordinary mutations retain atomic rename without the second barrier. Non-Linux uses temp fsync plus best-effort directory sync and claims no power-loss guarantee. This changes the synchronous full-document save path and avoids multiplying its blocking rename retries (`[cutover] dashboard/server/control/store.ts:6550-6567`; `[cutover] dashboard/server/atomicRename.ts:35-48`).

Resume is not an attempt. Attempt/retry/accounting derive only from durable attempt rows. `resumeStreak` increments once per distinct deployment claim only if no terminal attempt cursor advanced after the prior resume; any completed attempt resets it. Eight consecutive zero-progress resumes move the run to `waiting-human`; eight deploys separated by completed attempts do not (`[cutover] dashboard/server/control/store.ts:145-148`; `[cutover] dashboard/server/control/execution.ts:2396-2407`).

### 2.2 Pause protocol and atomic boundary

The clean boundary is each **finalized attempt**, not worker exit or batch completion. The unsafe attempt spans worker, settlement, integration, transitions, and early exits (`[cutover] dashboard/server/control/execution.ts:2107-2408`). Move `cleanupAttemptWorktree()` out of the unsafe success path into the outer attempt-wide `finally`; it is idempotent best-effort, records a cleanup intervention on failure, and completes before the park CAS (`[cutover] dashboard/server/control/execution.ts:1974-2024,2416-2429`).

Protocol:

1. `requestPause(targetCommit)` persists the deployment, global fence revision, and `parkWarnAt=requestedAt+35m`. Reaching that warning is nonterminal: the fence remains requested until the next durable attempt boundary or explicit human Abort.
2. Queue bridge `stopAndDrain(ref,revision)` clears its timer, checks the persisted fence before each dispatch, awaits the current tick/dispatch, then persists its matching idle acknowledgement. Today `stop()` clears only the interval while a tick may continue (`[cutover] dashboard/server/control/queueBridge.ts:179-215`).
3. The run batch loop is a named drain participant. It checks the fence before `prepareOrContain()` and before every batch; after attempt finalizers return, it returns a first-class `parked` boundary outcome instead of settling or transitioning the paused run. The current loop otherwise prepares another batch and later transitions the run (`[cutover] dashboard/server/control/execution.ts:929-955,2481-2486`).
4. The outer attempt `finally` always cleans then calls idempotent `parkRunIfEligible()`, covering cancellation returns and contained worker errors. Its store CAS succeeds only for the matching fence with no live attempt, worker/session turn, or integration. With parallel attempts, the last finalizer parks.
5. Detached activation completion/error handlers use that same lifecycle/deployment CAS: if the run is paused for the matching deployment, Human Request creation and run transitions are no-ops. This closes the post-response promise chains at `[cutover] dashboard/server/control/routes.ts:1936-1941,1988-2000`.
6. Human Request decisions are atomically refused during the fence; exact idempotent replay may return its prior response. The request remains open (`[cutover] dashboard/server/control/routes.ts:1417-1452`).
7. `parked` requires every pre-fence active run to be paused, terminal, or at an open natural Human Request, plus every in-flight component's drain acknowledgement for the same revision.

The replacement map is complete:

| Old blocker | Replacement |
| --- | --- |
| `execution-*` | Persisted fence plus batch-loop and in-flight-handler drain acknowledgements |
| `queue-bridge-running` | `stopAndDrain` idle acknowledgement |
| `work-queued` | Cards stay queued; bridge and producer acknowledgements prove they cannot launch |
| `workers-active` | Attempt-finally hook plus store no-live-unit predicate |
| `git-active` | Poll each second for at most **90 seconds**, then refuse |
| `pty-active` | Refuse for sessions active in the last **10 minutes**; never terminate automatically |
| `composer-active` | Refuse immediately; never terminate mid-stream Composer |
| `service-cgroup-active` | After known counts clear, poll the aggregate child count for at most **90 seconds**, then refuse |

Add `lastActivityAt` to each persistent PTY and update it on input, output, attach, and resize. A recent blocker returns its session IDs in one Inbox item whose sole action is `POST /api/v1/deployments/{ref}/close-ptys-and-continue` with expected deployment revision and exact IDs. It calls `closeAndWait()` for five seconds per ID, records who closed them, then retries that target; any unconfirmed exit refuses (`[cutover] dashboard/server/pty/persistentSessions.ts:142-149,345-402`). This is human-authorized closure, never automatic termination of active work. Sessions idle at least 10 minutes are classified non-live; ordinary service stop ends them and appends durable `ended-by-deploy:<ref>` session events. The current API exposes only total live count and summaries, so activity is new (`[cutover] dashboard/server/pty/persistentSessions.ts:154-157,442-444`).

V1 does not invent PID classification: git, Composer, PTY, and cgroup integrations expose counts, not a complete PID registry (`[cutover] dashboard/server/write/asyncGit.ts:138-159`; `[cutover] dashboard/server/vibe/session.ts:72-90`; `[cutover] dashboard/server/release/serviceCgroup.ts:32-51`). Git and residual cgroup activity get the settled 90-second bounded wait; Composer and recent PTYs refuse. A long managed attempt instead leaves the deployment requested and exposes `waiting on attempt <ref>, running <Nm>` plus Abort. Only entry into `swapping` starts a 20-minute hard `swapDeadlineAt` covering swap through resume; its expiry invokes recovery.

Put mandatory admission leasing at the two spawn chokepoints: as the first store-backed operation in `dispatchClaimedCard()`, before card read/compile/launch, and inside `ManagedSessionAdapter.start()` immediately before spawn (`[cutover] dashboard/server/control/queueBridge.ts:578-600`; `[cutover] dashboard/server/control/claudeSessionAdapter.ts:137-144`). Each CAS-creates an epoch-bound `AdmissionLease` only when no fence exists; `requestPause` atomically closes that epoch and captures outstanding leases. A lease releases only after durable run/attempt/session ownership exists or launch fails; parked requires every captured lease released. Thus fence commit cannot land between check and spawn. The registry is only for positive drain acknowledgement by leases/in-flight queue ticks, batch loops, and approval verification. Import lint proves no production module reaches a spawner outside these chokepoints.

### 2.3 Boot reconciliation and rehydration

Add `dashboard/server/control/rehydrate.ts` as an orchestrator over the store/engine. It owns no state.

Boot order:

1. Create random `bootId`, acquire the process lock, resolve the executable release root once, and read its immutable `VERSION`. Never reread `current` after start; the unit starts through that symlink and releases embed the SHA (`[cutover] deploy/systemd/kb-dashboard.service:9-11`; `[cutover] scripts/build_platform_release.py:62-76`).
2. Construct the existing file store, run the new loader/migrations, then `normalizeCrash()` once. Store creation remains in the existing surface path (`[cutover] dashboard/server/http/surface.ts:123-153`; `[cutover] dashboard/server/control/store.ts:6532-6587`).
3. Reconcile deployment state through one exhaustive switch:

| State | Boot rule |
| --- | --- |
| `waiting-confirmation` | No fence; project Confirm |
| `requested` | Re-arm fence/drains; continue parking indefinitely until boundary or explicit Abort |
| `parked` | Re-arm fence; await or reconcile activator journal |
| `swapping` | Running SHA = target → CAS `resuming`; readable mismatch → abort/unpark on old code; unreadable/invalid → recovery failure |
| `resuming` | Re-arm the swap deadline; reclaim stale-boot claims and continue BootReport |
| terminal/acknowledged | Unconditionally rehydrate leftover paused runs and append a consistency event |

An `assertNever` covers `DeploymentState`. Only `swapping|resuming` re-arm the hard timer to `swapDeadlineAt`; expiry invokes journal recovery. Requested/parked have no automatic expiry and remain prominently abortable. The dashboard—not the activator or recovery—owns every Deployment/Run abort and unpark transition. Live handlers use the shared store CAS service; boot reconciliation alone consumes each journal outcome exactly once in the same CAS and applies its abort/unpark.

Live Abort is one dashboard CAS allowed only from `requested|parked`: set terminal `aborted`, clear fence/lease epoch and drain acknowledgements, rehydrate or contain every already-paused row through the shared rehydrator, then restart the bridge directly. An attempt still running under requested continues normally and its finalizer sees no fence. Abort is idempotent after success and returns 409 once `swapping|resuming` begins. On boot, journal-driven abort/unpark restarts the bridge only after BootReport partitions every pre-fence run.

4. Snapshot paused rows in `(pausedAt,runRef)` order. First characterize then refactor the roughly 305-line `activateRunUnderOwner()` into a shared activation-context service covering ownership, receipts, state/Human Request, hashes, approval, compile/policy, canonical root, audit, claim, and dispatch (`[cutover] dashboard/server/control/routes.ts:1700-2005`). Characterize and bring the manager-successor gates into the same service before rehydration depends on it (`[cutover] dashboard/server/control/routes.ts:1300-1330`).
5. Create a boot-scoped random `claimantRef`; claim paused → recovering with key `resume:<deploymentRef>:<bootId>:<claimantRef>:<runRef>` and persist all three identities. Because the lifetime OS lock proves one current writer, a non-current `bootId` is stale: reclaim and log it. Same `{bootId,claimantRef}` replay is idempotent; current boot with a different claimant is a duplicate-writer fault.
6. On boot, start queue bridge only after BootReport partitions every pre-fence run as resumed, paused with the current claim, natural waiting-human with open projected request, terminal, or explicit intervention. Modify the existing latch ordering, not a sibling hook (`[cutover] dashboard/server/http/surface.ts:289-353`).

A containable per-run validation failure creates one Human Request and lets other recovery complete. Failure to claim, record containment, or complete BootReport sets durable `startupRecoveryFailure`, keeps bridge stopped, and changes readiness behavior. This is **new**: today readiness can return `ok:true` with blockers and does not force false for recovery blockers (`[cutover] dashboard/server/http/surface.ts:195-229`). Keep the exact three-key shape `{ok,quiescent,blockers}`: `ok:false` with `deployment-rehydrating` or a current `lock-contention` is retryable; `ok:false` with `startup-recovery-failed` or an unknown recovery blocker is fatal; stale lock sidecars contribute no blocker. The activator exact-key parses that shape and must distinguish those blockers (`[cutover] deploy/activate_release.py:269-288`). Its 15-minute poll-budget exhaustion while still rehydrating is nonfatal: journal/timer retain ownership for the remaining five minutes. Only a fatal blocker or the 20-minute hard deadline may publish pre-commit swap-back; post-commit failures remain on target and surface (`[cutover] deploy/activate_release.py:338-354`).

Install resident `kb-dashboard-watchdog.timer` outside the release. Every minute it polls `/readyz` for recovery health and calls the root-resident activator's read-only `status --deployment`, which queries the dashboard over `kb.deploy/v1` and returns exactly one of `deployment {deploymentRef,state,parkWarnAt,progress}`, `none`, or `unavailable`. `unavailable`—socket stopped mid-swap or an expected handler absent—suppresses the generic bridge-stopped rule and never means no deployment; only `none` is an authoritative absence. The step-0 compatibility stub is the sole planned exception: before phase 3 it returns `none` without a handler. Deployment state is never conveyed through `/readyz` blocker strings. `startup-recovery-failed` alerts immediately. While status reports any nonterminal Deployment, suppress the generic bridge-stopped rule; instead, `requested` alerts once `now >= parkWarnAt` with live attempt/blocker progress, while `swapping|resuming` use their hard timer. Only with `none` does an intentionally stopped bridge alert after 10 continuous minutes. Unreachable is suppressed while a nonexpired activation journal exists and otherwise alerts after two polls. Each episode writes one deduplicated wake-me card and durable incident, retries delivery, and clears after two healthy polls. Thus a normal long park does not page merely because its bridge is drained. The current wake-me helper is callable but not scheduled (`[cutover] scripts/agent_runner.py:37-54`).

### 2.4 Versioned run-state and migrations

Create a new version-keyed mechanism:

```text
parse -> assertMigrationEnvelope -> ordered pure up/down registry
      -> assertDocumentInvariant(target) -> normalizeCrash -> durable save
```

`assertMigrationEnvelope` accepts an object, supported safe-integer version, and bounded required containers. Unknown future/malformed input fails before mutation. This is new because current `assertDocument` rejects version != 1 before legacy preparation (`[cutover] dashboard/server/control/store.ts:2192-2217,6532-6543`).

Each migration edge declares `{from,to,breaking:boolean,down:present|absent}`. Humans author those semantics; the shipped machine-readable registry is their sole source. The builder only aggregates: `stateSchema` is maximum `to`, `rollbackStateSchema` is the lowest schema reachable through a contiguous present-down chain, and `stateMigration` is breaking iff any applicable up edge declares it. After extraction and before swap authorization, the activator recomputes and matches all three. The present builder authors fixed metadata directly (`[cutover] scripts/build_platform_release.py:78-85`).

Pin v2 to `schema:"kb.release-attestation/v2"` and exactly eight string keys: `archive,schema,sha256,sourceCommit,stateSchema,rollbackStateSchema,stateMigration,workflow`. Schema numbers are canonical decimal strings; migration is `compatible|breaking`. Parsers accept exactly canonical v1 or v2, never extras. Existing parsing is coupled to the five-key v1 literal (`[cutover] scripts/deploy_platform_release.py:13-31`; `[cutover] deploy/activate_release.py:98-108`), so compatibility bootstrap precedes builder change.

Generate one Python `control_plane_schema` validator/manifest from the registry. It exports both validation and the canonical empty document at the registry's current schema version. `seed_control_plane()` writes that generated document, never a literal; its existing-file path and tier-zero restore use the same validator. TypeScript version interpretation exists only in `assertMigrationEnvelope`. Today bootstrap hard-codes a version-1 seed whose collection set diverges from `StoreDocument`, writes it when the file is absent, and only JSON-parses the already-existing branch (`[cutover] deploy/bootstrap_vm.py:21,34-50,65-69`; `dashboard/server/control/store.ts:267-282`); backup has its own gate (`[cutover] scripts/backup_tier0.py:410-429`). Cross-language fixtures cover supported/future/malformed schemas and assert the generated seed's collection-key set exactly equals `StoreDocument`'s collections.

Migration dry-runs occur twice: a fresh pre-fence copy decides whether target-bound breaking confirmation is required; a post-park copy includes deployment/pause rows and records `{documentRevision,sha256}`. After service stop, exact bytes/revision must match; otherwise rerun the gate on the now-stable store. Failure restarts old code, journals failure, and lets boot reconcile; it touches no link. The loader must read the root activation journal before migration and refuse automatic up-migration while any rollback phase is in flight.

Migrations preserve approved proposal snapshots/hashes or deterministically recompute every linked hash in one repeat-safe transaction. Parked runs resume stored approved snapshots; working-tree definition changes apply only to new launches. Every schema-changing release supplies tested `up` and `down`; breaking confirmation is bound to target commit and attestation digest.

### 2.5 Swap gate, crash recovery, and rollback

Replace activator `require_quiescence()` with pause → parked → swap → resume. Maintenance services are exposed **only** through a systemd-created Unix socket under a root-owned `0700` directory, socket `0600`. The root activator connects as uid 0; the dashboard receives the socket fd and verifies `SO_PEERCRED`. No TCP listener, forwarded route, header convention, or nonce exists. The closed protocol is `kb.deploy/v1`; the activator already requires euid 0 (`[cutover] deploy/activate_release.py:308-312`).

The activator, recovery timer/oneshot, watchdog, and `kb-deploy.socket` are bootstrap-resident outside `/opt/kb-releases/current`. The deployment handler ships inside the immutable dashboard release. The activator stops the socket **before** dashboard; after link/migration are final it starts the socket before the chosen dashboard so systemd passes the fd. Any connect can then activate only the already-selected release. `kb-github-integration` is resident with protocol `kb.github-inbox/v1` and keeps its cache while dashboard stops. Every resident protocol is compatibility-checked before stop; incompatible major requires compatibility-first bootstrap (`[cutover] deploy/bootstrap_vm.py:141-164`).

Before service stop, atomically replace/fsync `/var/lib/kb-activation/journal.json`. Its directory is root:root `0755`, file root-owned `0444`, outside dashboard `ReadWritePaths`; dashboard may read, only root activator may replace. The `authorized` record contains deployment ref, target/previous SHA, `snapshotDigest:null`, phase, and timestamp. Only the durable post-stop snapshot transition fills a required digest; later phases without it are corrupt. Then arm a root recovery timer. The advisory release flock alone cannot close the current swap/restart SIGKILL gap (`[cutover] deploy/activate_release.py:67-96,338-360`).

Activation sequence:

1. Ask the running dashboard to CAS `parked→swapping`; journal `authorized`; set `swapDeadlineAt`; arm timer.
2. Stop `kb-deploy.socket`, then dashboard; confirm service cgroup empty. Acquire `dashboard.lock` with `O_CLOEXEC` and a 90-second bound before any control-document snapshot, migration, or restore. Lock timeout performs no store write.
3. Snapshot/fsync/hash the locked store; re-run the post-park gate if revision changed; only after the verified snapshot is durable journal `service-stopped` with its digest.
4. Run/validate target `up` migration; journal `migrated`.
5. Preserve `previous`, select `current`, journal `current-swapped`; release `dashboard.lock`, start `kb-deploy.socket`, then start dashboard with its socket fd; journal `restart-issued`.
6. Target boot migrates/validates, creates claims, and builds a complete pre-commit BootReport but both spawn chokepoints remain closed. It reports `activation-commit-ready` over `kb.deploy/v1`; it cannot start an attempt yet.
7. Activator validates target SHA/report and fsyncs journal `activation-committed`. Dashboard observes that barrier, CAS-releases the execution fence, and rehydrates. Only after full readiness does activator journal `healthy`; boot finalizes succeeded, then timer/journal clear. Activator never mutates Deployment/Run lifecycle rows.

Every activator start and recovery oneshot reconciles under the release flock. Before a store write it stops socket/service, confirms cgroup empty, and takes `dashboard.lock`; it holds the lock through the last write and releases immediately before service start. At and after `service-stopped`, its first store/link mutation is verified snapshot restore. Each row ends by journaling an outcome and starting a selected release; only boot consumes that outcome and aborts/unparks once:

| Journal phase | Recovery action |
| --- | --- |
| `authorized` | Select old current, journal `old-selected`, start it; boot aborts/unparks |
| `service-stopped` | Restore/hash snapshot first, select old current, journal outcome, start old |
| `migrated` | Restore snapshot first, keep old current, journal outcome, start old |
| `current-swapped` | Restore snapshot first, restore exact previous link, journal outcome, start old |
| `restart-issued` | Pre-commit only: stop target, restore snapshot first, restore exact previous, journal outcome, start old |
| `activation-committed` | Never restore snapshot or swap back; start/continue target and let boot resume |
| `healthy` | Verify target SHA/state, start target; boot finalizes, then timer/journal clear |

This is required because old code rejects a migrated version before it can down-migrate (`[cutover] dashboard/server/control/store.ts:2196-2198,6532-6543`) and `Restart=on-failure` does not revive an intentionally stopped service (`[cutover] deploy/systemd/kb-dashboard.service:29-32`).

Deliberate rollback requires human confirmation and uses the same lock/snapshot discipline. The current path swaps/restarts without a rollback journal (`[cutover] deploy/activate_release.py:363-375`); replace it with these phases:

| Rollback phase | Recovery action |
| --- | --- |
| `rollback-authorized` | Keep/select current release, journal cancellation, start current; boot unfences |
| `rollback-stopped` | Restore verified snapshot first, select current, journal cancellation, start current |
| `down-migrated` | Restore snapshot first, select current, journal cancellation, start current |
| `rollback-swapped` | Pre-commit only: restore snapshot first, restore original current link, journal cancellation, start it |
| `rollback-committed` | Never restore/up-migrate; continue previous release and let boot resume |
| `rollback-healthy` | Verify previous SHA/down-schema, journal success; boot finalizes |

The loader refuses auto-up in every nonterminal rollback phase. Previous-release boot must likewise build a no-spawn BootReport and report `rollback-commit-ready`; activator fsyncs `rollback-committed` before boot releases execution. Down failure or SIGKILL cannot silently turn rollback into an up-migrated restart, and post-commit progress is never erased. Preserve signature verification and safe extraction (`[cutover] deploy/activate_release.py:111-126,153-199,223-240`).

Automatic swap-back is valid only before `activation-committed`, inside this deployment's live swap window, when `current` resolves to its exact target SHA and `previous` to the exact immediately-previous signed SHA recorded in the journal. Any mismatch or post-commit failure is recovery-required, never snapshot restore or selection of another historical release. Every swap-back journals a durable terminal outcome; old-code boot creates an Inbox Acknowledge item, and the desktop helper's closed retry-until-ack `deployment-result` verb raises a Windows notification. Until helper receipt, the Inbox shows notification pending. The current broad exception path swaps to `old` without these bounds (`[cutover] deploy/activate_release.py:338-354`).

Bootstrap order:

0. Over root SSH, install/test a compatibility activator accepting only canonical attestation v1/v2, the unchanged three-key readiness shape, read-only `status --deployment`, and `activation-commit-ready|rollback-commit-ready` on `kb.deploy/v1`. Until the deployment handler ships in phase 3, `status --deployment` answers `none`; afterward it exposes the tri-state contract in §2.3. The activator treats `ok:true` with no recovery blocker as healthy, retries `ok:false` with `deployment-rehydrating|lock-contention`, and treats `startup-recovery-failed` or unknown recovery blockers as fatal. Fifteen-minute retry exhaustion is nonfatal and leaves the resident timer its final five minutes; only fatal or hard expiry may pre-commit swap back. Acceptance holds rehydrating beyond today's 60 seconds, commits, then becomes healthy without swap-back (`[cutover] deploy/activate_release.py:269-288`). Any future readiness shape change updates this resident activator first.
1. Then merge builder/desktop v2 metadata support.
2. Deploy the first pause-engine release under old quiescence.
3. Thereafter use the durable protocol for activation and rollback.

### 2.6 Isolation units

| Unit | What it does | Interface | Depends on |
| --- | --- | --- | --- |
| Store | CAS, lifecycle, fences, migrations, durable saves | `requestPause`, `parkRunIfEligible`, `claimResume`, terminal/ack | Existing control document, process lock |
| Engine | Fences the two spawn chokepoints; drains batch/verify work; parks after cleanup | Fence query and drain acknowledgements | Existing execution/accounting |
| Rehydrator | Exhaustive boot reconcile and engine re-entry | `rehydratePausedRuns(): BootReport` | Store, activation-context service |
| Queue bridge | Drains with positive proof | `stopAndDrain(ref,revision)` | Store fence, existing dispatch |
| VM activator | Locks, snapshots, migrates, links, services, journals; never run-state transitions | root Unix socket `kb.deploy/v1` | Resident socket/recovery timer, immutable releases |
| Watchdog | Alerts on recovery failure, overdue `parkWarnAt` inside deploy lifetime, and bridge failure outside it | `/readyz` + activator `status --deployment` | Resident timer/activator, `kb.deploy/v1`, wake-me spool |
| GitHub integration | Immutable card blobs and normalized PR data | `kb.github-inbox/v1` | Separate uid, `/var/lib/kb-github` mirror/cache |
| Desktop helper | Deploy, asset intent, and result notification closed verbs | `deploy`, `pull-assets`, `deployment-result` | `gh`, git, signer only for deploy |

**Snapshot contract addendum (build note, 2026-08-20):** the store's accepted-size
sidecar `control/control-plane.accepted-size.json` (introduced in Phase 1 as the
durable basis for migration-grown documents) moves in lockstep with
`control-plane.json`: every §2.5 snapshot, restore, and rollback step that touches
the control document MUST include the sidecar. A missing sidecar is fail-safe
(base limit applies); a stale one is not, so restore both or neither.

## 3. One-click deploy

### v1 desktop command

Add `scripts/deploy_green_platform.py`. As new wrapper behavior, it uses `gh run list/view` to select the newest successful `kb-platform-release` run labelled main and `gh run download --name kb-platform-<sha>` into a fresh temp directory; it accepts no arbitrary run/artifact name. Then it:

1. uses **new behavior to build**: the default read-only `status` mode in the root-resident activator resolves systemd `MainPID`, resolves that process's loaded platform root, reads immutable `VERSION`, and returns only a validated lowercase full SHA—never dashboard-reported version data or the movable `current` link. The separate read-only `--deployment` mode proxies deployment state, where the dashboard is the source of truth. Today the desktop only invokes the resident `activate` verb and the service loads through `current`; neither status nor MainPID resolution exists (`[cutover] scripts/deploy_platform_release.py:35-49`; `[cutover] deploy/systemd/kb-dashboard.service:9-11`; `[cutover] scripts/build_platform_release.py:62-76`);
2. fresh-fetches `origin main` and requires target != live, `git merge-base --is-ancestor <live> <target>`, and `git merge-base --is-ancestor <target> refs/remotes/origin/main`;
3. repeats those checks immediately before signing, then requires workflow SHA, artifact name, attested source commit, and archive digest to agree;
4. obtains target-bound breaking confirmation, invokes the existing fixed signer/shipper flow, and prints deployment ref, SHAs, park duration, and BootReport.

Thus neither a force-pushed-away run nor an old vulnerable ancestor is deployable. Going backward is only §2.5 deliberate rollback. CI labels artifacts with push-time `github.sha`, so ancestry must be independently proved (`[cutover] .github/workflows/kb-platform-release.yml:1-6,27-35`; `[cutover] scripts/branch_hygiene.py:134-136`).

### v2 Inbox Deploy

A desktop helper runs as Daniel, binds only the desktop tailnet address, verifies the caller's pinned VM node identity through local Tailscale, and accepts a closed verb union: `deploy {sourceCommit,attestationDigest,requestRef}`, `pull-assets {intentRef,runRef,manifestDigest}`, or `deployment-result {deploymentRef,outcome}`. Only `deploy` may invoke the fixed local signer/`gh` commands; no verb accepts paths, hosts, commands, or keys. Deploy repeats v1 green, strict-descendant, ancestry, digest, and live-SHA checks and permits one request plus a five-minute cooldown. Pull/result are independently idempotent and rate-limited.

Before signing, every accepted or refused invocation appends and fsyncs one canonical JSONL receipt to `%LOCALAPPDATA%\kb\deploy-helper\invocations.jsonl` with time, request ref, short SHA, caller node, and outcome—never secrets/signatures—and raises a Windows notification. Log or notification failure refuses unattended signing.

## 4. Unified approval Inbox

Project one server-side Inbox from source truth; do not add Inbox-owned truth. The current Human Inbox item/action model is card-based and browser joining remains separate (`[cutover] dashboard/server/approvals/humanInbox.ts:22-40,150-168`; `[cutover] dashboard/src/views/ApprovalsLive.tsx:87-144`).

```text
InboxItem = { id, source, title, context, createdAt, entity,
              ceremony: webauthn|null, enabled, disabledReason|null,
              sourceVersion: {commitSha,blobSha}|null,
              action: { label, method, href, inputSchema|null, external:boolean } }
```

Every item has one action. During a deploy fence, Respond/Resume remain visible but disabled with deployment ref/reason; the deploy item explains the fence. Mutation still returns 409 for races.

- **Cards:** `kb-github-integration` owns `/var/lib/kb-github/inbox-ops.git`; `/var/lib/kb-github` is mode `0700` and owned by that dedicated uid. This DAC boundary is primary. Add `ProtectSystem=strict` and `InaccessiblePaths=/var/lib/kb-github` to `kb-dashboard.service`; its writable exceptions remain only `/var/lib/kb/state /var/lib/kb/ops` (`[cutover] deploy/systemd/kb-dashboard.service:37`). Dashboard obtains immutable objects only through `kb.github-inbox/v1` and cannot name the mirror path. Each item pins mirror commit and blob SHA. Response/verify requires both, resolves immutable bytes from that object, and executes that `VerifiedCardView` directly—never `/var/lib/kb/ops`. Missing/ref-moved/hash-mismatched objects return `409 source-changed` and refresh. This replaces the current route/path flow that shells verification against mutable `repoRoot` (`[cutover] dashboard/server/approvals/routes.ts:37-47,66-92`; `[cutover] dashboard/server/approvals/inbox.ts:160-173`). Source health retains last fetch/head/age/stale and last-good data.
- **Runs:** open Human Requests become Respond; waiting-human without one becomes Resume.
- **Deploys:** green becomes Deploy, breaking becomes Confirm, active/failure becomes Inspect. Terminal failure/abort exposes Acknowledge, which transitions the deployment itself and retains outcome/error/actor/time.
- **PRs:** project only open PRs where `!draft || reviewRequestedForDanielOrPinnedTeam`. Agent drafts remain absent until marked ready or review-requested. Review constructs a 303 only from pinned owner/repo plus validated positive integer; never echo upstream `html_url`. The VM has no merge endpoint/token.
- **Assets:** completed manifested runs become Pull home only after the helper advertises `pull-assets/v1`. The VM action validates succeeded run and stored manifest digest, records `AssetPullIntent={intentRef,runRef,manifestDigest,state,requestedAt,attempts,result}`, then invokes the helper's closed verb. A resident retry loop resends pending intents with the same idempotency key until the helper reports success/failure; offline/failure stays visible and retryable. The endpoint never pretends the VM performed the desktop transfer.

T3 items declare `ceremony: webauthn`; this is the settled browser-ceremony carve-out. Keep the single-POST verifier and add `approvals-verify-execute` as a drain participant. It refuses before verification when fenced and atomically rechecks immediately before `deps.execute`; a fence arriving mid-ceremony returns `409 deploy-pause-active`, does not execute/consume the assertion, and leaves the same assertion/idempotency key replayable after resume. Execution uses the pinned blob above. Do not add challenge storage this arc (`[cutover] dashboard/server/approvals/inbox.ts:105-116,139-174`; `[cutover] dashboard/server/approvals/routes.ts:66-112`).

Other actions are closed POST endpoints for card response, Human Request response, run resume, deploy confirm/deploy/abort/acknowledge, PTY close-and-continue, and asset-pull intent. PR open is a constructed GET redirect and is the only action with `external:true`; every same-origin/helper action is false, so the UI labels the one off-tailnet transition. `GET /api/v1/inbox` returns items, active fence/progress, and source health. Mutations require idempotency key and expected revision. The UI is one Claude-dark page with neutral hierarchy, hairlines, semantic status only, and no accents (`[cutover] dashboard/src/styles/app.css:3-35,63-86`).

## 5. VM production floor

### Assets home

Add a new manifest-emitting stage after `verify`; the present final stage emits only `render-verify.md` (`orgs/faceless-youtube/workflows/video-run.md:114-119`). It writes sorted `assets/transfer.manifest.json` with schema, run/project/root/time and `{path,sha256,bytes,role}` files. Reject absolute/`..` paths, duplicates, symlinks, nonregular files, unapproved media extensions, and hash/size mismatch.

The concrete Windows client is `wsl.exe --distribution Ubuntu --exec /usr/bin/rsync`. `%LOCALAPPDATA%\kb\pull-assets\config.json` pins the VM's literal tailnet IP and SSH host-key fingerprint; WSL never relies on MagicDNS. Before creating a staging directory it parses/resolves the literal to itself, verifies the pinned host key and fixed `KB-ASSET-PULL/1` banner, and runs `rsync --version` locally/remotely. Failures are distinct: `invalid-tailnet-ip`, `ssh-hostkey/banner-mismatch`, `local-rsync-version`, or `remote-rsync-version`.

Transfer uses `--files-from --no-links --no-devices --no-specials --no-perms --no-owner --no-group` into a WSL ext4 temp root. POSIX `lstat`/realpath/hash validates staging. Windows promotion rejects reparse points in every assets-root/staging/destination component, resolves handles with `GetFinalPathNameByHandle`, requires final paths below the fixed assets root, rejects destinations from `git ls-files`, verifies hashes on Windows, then atomically promotes. No glob, delete, remote destination, or tree sync exists.

### Memory and credentials

Perform one human-reviewed curation pass: durable facts to `memory/*.md`, current state to project `STATE.md`, active resume material to `handoffs/`; no transcript, credential, or personal-state copy. Standing rule: desk+VM facts go in the least-general repo file a fresh session loads (`CLAUDE.md:33-42`).

Create human-owned `governance/credential-registry.md`, values excluded. Each row records integration, principal/uid, kind, purpose, scopes, external location, injection target, same-uid readability, child exclusions, permitted/human-gated operations, owner, rotation/revocation, verification, and evidence.

This arc grants:

1. `github-inbox-read`: metadata/Pull requests read only, held by separate `kb-github-integration` uid and exposed only as normalized PR data.
2. `github-agent-codeflow`: injected through a fixed git/`gh` wrapper; registry says **readable by all VM agents**. Minimal branch-push/PR-create scope plus protected main/ops is the accepted boundary. Prove disposable branch/draft PR succeeds and direct main/ops push and merge fail. This extends Phase-A identity (`governance/agent-rules.md:14-19`) without merge authority.

## 6. Atlas contract

`/api/v1` is a **new namespace**, not a second implementation. Extract canonical services, then repoint existing `/api/...` handlers and new `/api/v1` handlers as thin callers under the same auth/origin/rate middleware. Neither route owns business gates.

| Capability | Endpoint | Shared service |
| --- | --- | --- |
| Launch | `POST /api/v1/runs` | Existing compile/import/approve/launch transaction |
| Observe | `GET /api/v1/runs[/{runRef}]`, events cursor | Existing list/detail/event services |
| Act | Closed hrefs from `GET /api/v1/inbox` | Existing card, Human Request, resume, deploy, PR-open, asset services |

The launch service preserves origin plugin, authenticated subject, write rate limit, admission(new-work), closed body/parameter validation, client idempotency, expected source-hash recheck, pending-amendment guards, transactional reread/reparse, Composer/project binding, and compile/import/approve. These gates currently sit before the launch call (`[cutover] dashboard/server/workflows/routes.ts:858-933`). Characterization tests require the existing workflow route and `/api/v1/runs` to return the same refusal/success matrix.

Responses are versioned envelopes; incompatible field/action/enum changes require `/api/v2`. Tailnet auth remains caller-agnostic across browser, curl, and future Atlas. WebAuthn is the sole ceremony-capability carve-out, not an authority bypass. Atlas itself—voice, UI, hosting, desktop control, orchestration—is out of scope.

## 7. Testing and verification

| Piece | Automated proof | Live proof |
| --- | --- | --- |
| State/writer | Lifecycle exhaustiveness; entrypoint-only lease; `O_CLOEXEC` child-fd proof; synthetic already-locked/read-only modes; total deployment switch | Second daemon and leaked-child cases fail visibly; every state converges/intervenes |
| Pause | Spawn import lint; queue/batch/verify drains; parked boundary outcome; fence during detached handlers; cleanup on every early/caught-error path; HR/T3 409/replay | A >40-minute attempt stays requested with progress, then parks once; Abort and PTY close-and-deploy work |
| Resume | Stale-old-boot reclaim/current-boot conflict; pendingActivation precedence; manager successor; terminal sweep; BootReport; resume-streak/ledger equality | Multiple parked/natural runs all resume or surface |
| Migration/save | Legacy extraction; generated TS/Python fixtures including bootstrap/tier-zero; v2 exact keys/aggregate; pre/post dry-runs; up/down/repeat/hash; 2× production-store p99 critical save ≤250ms and max event-loop delay ≤1s over 100 transitions | Breaking dry run and N→N+1→N preserve state; readiness remains responsive during park |
| Crash/rollback | Kill every forward/rollback journal phase; pre-commit spawn prohibition/commit handshake; activator lock timeout; socket-fd/connect race; snapshot-first; 15/20-minute budgets; bounded previous-only swapback; watchdog rules | SIGKILL phase-by-phase never erases post-commit attempts/spend; result is target+resumed or exact previous+unparked with Inbox+toast |
| Desktop | New live-status verb; green/current-main/strict-descendant; helper closed-union auth/replay/log/notification | Shortcut and Inbox Deploy; VM never signs; every swap-back toasts |
| Inbox/API | Mutable-checkout/ref-move card attacks execute only pinned blob; fence-disabled items; WebAuthn replay; PR external flag/predicate; route parity | Resolve every source; reviewed bytes equal executed bytes; off-tailnet action is labelled |
| Assets/credentials | Helper capability handshake/intent retry; literal-IP/host-key/banner/rsync preflights before staging; WSL/reparse/tracked escapes; uid/socket scope | Pull VM render from Inbox intent, compare hashes; GitHub grants pass/fail exact scope |

Acceptance evidence is the live mid-run deploy, all-phase SIGKILL drill, deliberate rollback, v1 output, unified Inbox walkthrough, source freshness, and credential boundary proof. VM-only tests substantiate power-loss durability.

## 8. Risks and phasing

Build order:

0. **Compatibility bootstrap:** resident v1/v2 activator with retryable/fatal 15-minute readiness, socket-stop behavior, recovery/watchdog units, plus the desktop's minimal authenticated `deployment-result` listener so every phase-4 swap-back can notify; only then v2 metadata.
1. **State foundation:** entrypoint `O_CLOEXEC` lease/modes; type-breaking lifecycle; extract legacy v1→v2; generated TS/Python validators; registry semantics; coalesced critical durability/latency gate; deployment/journal models.
2. **Activation-context refactor:** characterize both owner activation and manager successor, extract the shared service, then let rehydrator depend on it.
3. **Pause/resume:** spawn chokepoint fences; queue/batch/T3 drains; attempt cleanup/finally/parked outcome; detached-handler CAS; Human Response fence; PTY activity/action; progress/Abort; boot claims/BootReport/readiness. Bootstrap-deploy once under old quiescence.
4. **Swap/rollback:** activator-held writer lease; stopped socket; forward+rollback journals/timers; dry-runs/revision gate; snapshot-first recovery; bounded swap-back/watchdog/notification; SIGKILL drills.
5. **Desktop v1:** new resident live-status verb, green strict-descendant selector, signer/shipper wrapper. This closes resume-safe/one-command acceptance.
6. **Shared API services and Inbox:** extract/repoint routes; isolated bare mirror and pinned-blob actions; GitHub integration; fence/source health; action/page; add the helper's `deploy` verb to the already-installed result listener. This closes Inbox acceptance.
7. **Production floor:** install/test `pull-assets/v1` helper verb before enabling Pull home; then registry/grants, memory curation, manifest stage, literal-IP WSL pull. These ship independently.
8. **Stretch:** one full FYT VM run and verified pull-home.

Principal risks:

- A missed admission path defeats the fence: only two spawn chokepoints exist, both fence atomically, and import lint enforces that graph; participants prove drain only.
- Two daemons double-spend: lifetime OS lock and process-unique claims fail closed.
- Old code sees new schema: stop/lock before migration plus snapshot-first phase recovery prevents it.
- Proposal changes deadlock resume: deterministic hash migration and characterization preserve the stored approved snapshot.
- Long runs hit false resume caps: only consecutive zero-progress resumes count.
- Same-uid credentials leak despite env filtering: separate uid for server-only tokens; agent-readable grant is explicit/minimal.
- Reviewed and executed card bytes diverge: immutable commit/blob identity is required at projection and action; mutable ops checkout is never executable authority.
- Approval sources go stale: isolated integration-owned mirror/cache, visible age, last-good data, and interventions.

Explicit non-goals:

- Auto-on-merge/cadence deploys; PR merge from VM; any VM signing key.
- Atlas product features, voice, desktop control, or hosting.
- Blue-green or old-code-until-complete execution.
- Reattaching mid-turn workers; turns finish before park.
- Personal-state sync, binary commits, or later FYT credential provisioning.
