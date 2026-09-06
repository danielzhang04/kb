# KB platform overhaul plan — DRAFT

## 0. Status, decision boundary, and intended outcome

This is an architecture and migration plan only.

It authorizes no source change, governance change, deployment, live test, credential access, or production operation.

Baseline is `origin/main` at `39197cf5d9322f21d859d6f7a98d3a5b57cc42ea`.

The current VM is a planning baseline, not a claim of healthy production state.

Immediate recovery remains the existing human-reviewed #173 / `e8bf8d35` ceremony.

The known hydrate defect is a CRITICAL availability/integrity incident, not a security exploit.

Current live state was not observed in this work.

Existing cards and their governance remain authoritative until a human approves a migration amendment.

The goal is a slimmer, iterable platform where Daniel can declare agents and workflows once, launch or schedule them without repeatedly selecting models, observe real execution, steer or stop it, answer meaningful gates, and retrieve verified outputs.

The plan preserves the fd-pinned PTY broker, signed release boundary, WebAuthn/passkey T3 authorization, STOP semantics, independent grading, and no-credentials-as-objects rule.

It does not replace KB with n8n, Temporal, Prefect, LangGraph, or ECC.

It borrows only the proven separation of definition, durable runtime state, work delivery, human waits, and worker health.

Pending user decisions that may change the design are required recovery objectives, desired concurrency, disconnected duration, tolerated loss of accepted work, and whether desktop scheduling is a supported capability or a retired artifact.

## 1. Target architecture in one page

```text
Git (reviewed definitions, policy, durable work records, signed release evidence)
             | immutable revision / compatibility adapter
             v
Dashboard control service (one API, one execution authority, diagnostic read surface)
             | transaction
             v
Runtime repository: SQLite WAL candidate shown; Phase 2 selects runtime
  runs / stages / immutable attempts / leases / approvals / events / schedules / intents
             | at-least-once delivery with operation id + fencing token
             +---------------------+---------------------+
             v                     v                     v
  fd-pinned Linux PTY broker   non-interactive worker   deterministic maintenance job
             |                     |                     |
             +--------- artifact/transcript bytes ------+
                                   |
                                   v
               immutable manifest + digest; Git/outbox publication after commit

Browser and CLI are projections and command clients. They own no execution state.
Desktop is a client/promotion station unless a later supported executor/failover contract is approved.
```

The service owns the runtime database exclusively.

Remote or local workers never open the database file and never share it through a network filesystem.

Git remains reviewed source/policy/evidence, never the high-churn runtime queue.

Files or object storage own bulky immutable transcript and artifact bytes.

The runtime database stores digests, offsets, retention class, and references rather than duplicate bytes.

Each command is one transition transaction: authorize, compare expected version, mutate target rows, allocate event cursor, and append a pending external-effect intent.

External effects are not falsely claimed atomic with the transaction.

Delivery is at least once; operation IDs, idempotency fingerprints, and fence tokens make repeated delivery safe.

An uncertain non-idempotent effect parks for review rather than being guessed complete.

## 2. Architecture choices and disconfirming criteria

| Option | Recommendation now | Why | Disconfirming / adoption trigger |
| --- | --- | --- | --- |
| Modular app + SQLite WAL, one service writer | **Candidate A** | One VM, local durable state, small operational surface, transactional claims/leases/approvals without Redis or a new service estate | Phase 2's identical-workflow comparison rejects it if it misses an agreed recovery/latency criterion or has greater retained LOC/operating burden than Temporal |
| Modular app + Postgres | Deferred escalation | Better independent-writer/HA operational model, but adds service, backup, migration, and access-control operations | Adopt only after a written multi-writer/HA/RTO requirement and a load/restore benchmark that SQLite cannot meet |
| Temporal for execution delivery | **Candidate B, bounded reference** | Strong durable-task/replay model but adds server operations and deterministic workflow-code discipline | Phase 2 selects it only if its measured recovery/latency and retained LOC/operating burden beat Candidate A for the same workflow; reject both if neither meets the human-selected need |
| n8n / Prefect as control plane | Reject | Would duplicate KB governance, T3 grants, signed deploy, card rules, and custom runtime boundaries | Reconsider only for a separately bounded integration-automation product, never as a stealth replacement |
| Desktop scheduler/failover | **Capability unresolved; default retire** | Current `desktop_dispatch.ps1` cannot reach VM-local schedule socket and also hard-codes a shared checkout | Implement only after user requires offline desktop scheduling and accepts fenced replicated/remote authority complexity |

No performance improvement is asserted by this choice.

Phase 2 compares both candidates on the agreed workload: command latency under target concurrency, schedule claim contention, recovery after process kill, blank restore, retained production LOC, dependencies, and runbook burden. A human selects the winner from evidence; Postgres still requires a written multi-writer/HA need plus a benchmark showing the selected candidate fails it.

## 3. Data/state owner map

### SQLite operational contract (candidate A)

One startup migrator runs under exclusive application authority before routes admit work. It applies checksummed forward migrations, records a schema checksum/lock, and refuses a newer or partial schema; no down migration is allowed after the first new-authority write.

Every connection enables `PRAGMA foreign_keys`; the chosen WAL journal, synchronous, busy-timeout, and checkpoint policy is recorded with the Phase 2 benchmark, not assumed. Backup uses SQLite's online backup API or a frozen checkpoint plus fsynced manifest, never a main-file-only copy.

The deterministic harness kills the process during migration/checkpoint, injects ENOSPC, WAL/SHM loss, and migration failure, and proves admission closes, diagnostic evidence remains available, and verified restore works.

| Datum | Sole mutable owner | Durable representation | Consumers | Retention / recovery |
| --- | --- | --- | --- | --- |
| Agent/workflow/policy definitions | Protected Git path | versioned Markdown/YAML/schema revision | compiler, policy resolver, UI | Git history and signed release |
| Runtime run/stage/attempt state | Runtime repository | normalized transactional rows | API, scheduler, engine | DB backup plus integrity scan |
| Attempt lease/capacity reservation | Runtime repository | lease epoch, expiry, fence, reservation | dispatcher, worker adapter | expires; audit event retained |
| Human feedback / output acceptance / T3 grant | Runtime repository | separate typed request resources and immutable response/auth envelope | UI/engine/T3 | durable audit export; never conflate feedback, acceptance, and authorization |
| Schedule definition/occurrence | Runtime repository | schedule, timezone, occurrence, claim | scheduler, UI | definition persists; occurrence TTL by audit policy |
| Event sequence/read model | Runtime repository | append-only event cursor + projection | UI, diagnostics | compacted after snapshot/checkpoint policy |
| Artifact/transcript bytes | File/object artifact subsystem | bytes addressed by digest | UI/replay/integrator | retention class, legal/audit decision |
| Artifact metadata | Runtime repository | digest, URI/path, producer, commit, cursor | integrator/UI | durable, reconciled with byte store |
| Canonical work-product publication | Existing signed Git/outbox path | intent, receipt, signed bundle | desktop promotion/reconciler | existing retention/receipts |
| Release selection | Signed immutable release + systemd | current/previous links, attestation | bootstrap/health/operator | rollback/readiness procedure |
| Browser view state | Browser only | cache/projection, no authority | UI | discard/reload safely |

No datum has two active writers during or after cutover.

Compatibility readers may expose old state but cannot accept new execution writes after authority cutover.

## 4. Proposed minimal contracts (not final APIs)

Keep contracts small and versioned at real trust boundaries.

`DefinitionResolver.resolve(revision, workflowRef, agentRef) -> ResolvedDefinition` returns immutable definition digest, model/profile route, allowed tools, declared resource class, and source revision.

`RunCommandPort.execute(actor, expectedVersion, idempotencyKey, command) -> CommandReceipt` is the only mutating run command seam.

`RunQueryPort.get(runRef, cursor?) -> RunProjection` is a read-only projection seam.

`AttemptLeasePort.claim(worker, capabilitySet, now) -> Lease | Refusal` allocates one attempt lease with `leaseEpoch`, `fencingToken`, expiry, reservation, and operation ID.

`AttemptLeasePort.renew(lease, now) -> Lease | StaleFence` renews only the current fence.

`AttemptResultPort.record(lease, operationId, result) -> Receipt | StaleFence | Parked` rejects stale workers.

`SchedulerPort.tick(clock, owner, epoch) -> TickReceipt` claims due occurrences transactionally and never performs work directly.

`ApprovalPort.request(...)`, `respond(...)`, and `expire(...)` operate on a dedicated resource, not an unscoped array join.

`ArtifactPort.putVerified(manifest, stream) -> ArtifactReceipt` accepts bounded bytes and returns a digest-addressed immutable result.

`PublicationPort.deliver(intent) -> DeliveryReceipt` is at-least-once and reconciles provider/Git outcome before retry.

`RuntimeDiagnosticPort.status()` remains available when execution admission is closed or a historical record is quarantined.

Use one schema source to derive TypeScript wire types, runtime decoders, fixtures, and Python compatibility checks.

Read responses may negotiate additive fields.

Privileged commands remain exact-key, exact-version, exact-digest decoders.

Do not combine authorization hash preimages merely because shapes overlap.

## 5. Core lifecycle semantics

### 5.1 End-to-end run flow

1. Operator or authorized queue adapter submits a definition reference and idempotency key.

2. Service resolves the protected definition revision and policy before reserving capacity or enqueueing.

3. A transaction creates run/stages, pins definition/profile/model/tool capability digest, and appends `run-created` plus a delivery intent.

4. Scheduler or worker pool claims a ready stage only if dependencies, admission, resource reservation, and current execution generation allow it.

5. Claim transaction creates immutable attempt N, a lease epoch/fence, workspace reservation, and `attempt-leased` event.

6. Worker starts through the existing fd-pinned broker or an approved adapter, carrying attempt ID, operation ID, and fence.

7. Worker appends bounded sequenced observations and uploads verified bytes through the artifact port.

8. Worker reports terminal outcome with its fence and result digest.

9. Service atomically accepts or rejects result, settles capacity once, emits event, and creates any canonical-publication intent.

10. Integrator drives publication idempotently; a delivered receipt advances a run to published, while uncertainty parks it with evidence.

11. UI reads projection/events; it cannot manufacture or settle runtime state.

12. Independent judge may inspect declared artifacts and deterministic checks, then emits evidence; it never accepts its own build.

### 5.2 Retry, resume, restart, and replay

`resume` continues the same attempt only from a verified checkpoint/cursor and only with a current lease fence.

`retry` creates a new immutable attempt with a new operation ID and explicitly names the predecessor and retry policy.

`restart-stage` creates a declared successor stage/attempt plan and requires new scope authorization where required.

`replay` rebuilds a read projection from recorded events/snapshots; it never repeats an external side effect.

`reconcile` asks the actual provider, broker, artifact store, or Git receipt whether an effect landed before deciding retry/park.

No UI label should call all five operations “replay.”

### 5.3 Stop, drain, and deployment

`STOP` immediately refuses new schedule claims, new leases, and new external-effect intents.

`stop requested` is durable and is not equal to process death.

`draining` blocks Unlock/new execution until its one drain promise completes or reaches an explicit parked/refused outcome.

Every engine/adapter callback carries an execution-generation fence.

Old generation callbacks cannot project results or close sessions belonging to a later generation.

Deployment requests admission freeze, then drains or parks leased attempts within a declared timeout.

Quiescence report names active leases, non-reconciled effects, and blockers rather than approximating them.

Pre-new-write rollback restores the frozen snapshot and old authority marker.

Post-new-write rollback is forward recovery: compatible reader, export, or repair tool; never just an old binary against a new writer.

## 6. Scheduler contract

Scheduler runs only in the execution authority process.

Desktop is capability-unavailable for scheduling unless a later phase explicitly authorizes a supported remote/fenced adapter.

One schedule definition has an IANA timezone, normalized cron/interval expression, `misfirePolicy`, overlap policy, and definition revision.

Occurrence identity is deterministic: `scheduleId + nominalLocalTime + resolvedOffset + definitionRevision`.

For DST fall-back, the two distinct offsets are distinct occurrences when policy is `run-each-offset`.

For DST spring-forward nonexistent wall times, policy is explicit: `skip`, `run-at-next-valid`, or `coalesce`; default must be chosen and documented, not inferred from library behavior.

For clock rollback, monotonic persisted occurrence ordering and idempotency keys prevent duplicate claim.

For clock jump forward, missed occurrences apply one of `skip`, `coalesce-one`, or bounded `catch-up(max=N)`.

Default proposed policy is `coalesce-one` for housekeeping and `skip` for human-time-sensitive runs, pending human product decision.

Every claim compares schedule version and creates `claimedBy`, `claimEpoch`, `claimUntil`, and `fencingToken` in one transaction.

Only current fence can mark occurrence started/completed or create its attempt.

Overlap policy is one of `forbid`, `allow(maxConcurrent=N)`, or `replace`.

`replace` requests stop of the old occurrence but starts new work only after old fence is visibly settled or policy explicitly allows isolation.

`forbid` records a missed/blocked occurrence, never silently disappears it.

Scheduler tick is idempotent and bounded by a maximum occurrences-per-tick budget.

Scheduler tick does not parse mutable Git definitions on each firing; definition import is a separate post-commit, revision-pinned adapter.

Healthy deterministic tick, cleanup, compaction, and no-op integrity scan need no human approval.

Changing cadence scope, policy, timezone semantics, resource budget, or privileged target remains human-governed through the existing definition/policy process.

## 7. Invariant inventory

### Identity and scope

- Every join across runtime records includes `subject` and `runRef`; stage IDs alone are never global identity.
- Attempt, session, request, receipt, artifact, and event references are immutable and scoped to a run.
- A definition/profile/tool route is pinned by digest at attempt creation.
- One run has one active execution authority generation at a time.

### State transition and concurrency

- Every mutation has expected version plus idempotency key or operation ID.
- A stale fence can read but cannot settle, start, stop, or publish.
- Capacity reservation is allocated and settled exactly once per accepted lease terminalization.
- A terminal attempt is immutable except for append-only reconciliation/archival evidence.
- A human response is idempotent and bound to expected request/version/action digest/expiry.
- Global validators may enforce uniqueness but cannot make one corrupt historical run block diagnostic service availability.

### Effects and recovery

- An external effect has a durable pre-effect intent and an operation ID before dispatch.
- A receipt is accepted only when provider/process/artifact evidence matches that operation and fence.
- Effect-before-receipt crash is reconciled before retry.
- Non-idempotent uncertainty parks for human review.
- Artifact bytes match immutable manifest digest before canonical publication.
- Publication receipt names the exact source revision and target identity.

### Security and governance

- Worker gets resolved capability set, not ambient card text, arbitrary tools, or raw connector configuration.
- Broker retains fd pinning, user separation, path validation, and limited socket surface.
- T3 action requires existing passkey/WebAuthn grant bound to exact digest and expiry.
- No secret is read, copied, logged, prompted, stored, or treated as an ordinary object.
- Signature validation and resident release validator remain before activation.
- Independent judge cannot bless its own artifacts or eval definition.

### Observability and retention

- Event cursor, transcript byte cursor, and document version are distinct typed fields.
- Health distinguishes web liveness, database/readiness, scheduler freshness, executor availability, broker availability, outbox pressure, and degraded diagnostics.
- Retention/compaction never deletes the only evidence needed to reconcile an effect or verify an accepted output.

## 8. Phased delivery plan

Each numbered phase is a dependency-ordered delivery tranche. Each named work package inside it is its own bounded card, with a fresh worker brief and independent review.

| Phase | Dependency | Outcome / contained work packages |
| --- | --- | --- |
| 0 | none | production containment; isolated harness remains independently usable |
| 1 | 0 baseline evidence | frozen contracts, inventory, benchmarks |
| 2 | 1 | bounded SQLite-versus-Temporal comparison and one-way shadow |
| 3 | 2 selection + restore | new-run command authority only |
| 4 | 3 | v1 placement composition and atomic report |
| 5 | 3 (and 4 where placement launches work) | scheduler/maintenance authority |
| 6 | 3, 5 | executor/terminal adapter |
| 7 | 6 | artifact, outbox, publication saga |
| 8 | 5, 7 | System FIRE-to-runner durable execution |
| 9 | 3, 5, 6, 7 | truthful health plus Brain freshness/trust work package |
| 10 | 4--9 | human-gated authority cutover |
| 11 | 10 | learning-loop hardening and subtraction |

### Phase 0 — stabilize and make failures diagnosable

**Prerequisite:** Production remediation requires human merge/deploy/recovery of #173. Isolated harness, inventory, and comparison work may proceed from the audited baseline without claiming live recovery or changing production authority.

**Affected current paths:** `dashboard/server/control/store.ts`, `launch.ts`, `queueBridge.ts`, `routes.ts`, `activation.ts`, `attemptSessionAdapter.ts`, `dashboard/server/index.ts`, relevant control tests, `deploy/activate_release.py`.

**Work:** Land the run-scoped hydrate repair; centralize a never-throw detached-execution reporter; make latch states `unlocked | draining | locked`; fence generation callbacks; expose a restricted diagnostic/readiness surface when run admission closes.

**Minimal entities:** `ExecutionGeneration`, `DrainReceipt`, `AutomaticFailureReporter`, `RuntimeDegradedReason`.

**Worker brief:** “Change only failure containment and generation fencing. Preserve public run DTOs, broker protocols, T3 behavior, and signed release flow. Every detached promise must end in a non-throwing supervisor.”

**Human gate:** Merge/deploy/recovery only; deterministic code/test work follows ordinary card routing.

**Acceptance:** Fault-inject each route-level detached continuation, reporter, and logger; assert no unhandled rejection in a child process. Delay old drain across Lock → Unlock → new attempt; prove new attempt cannot be swept by old generation.

**Failure/backout:** Before deployment, revert code normally. After deploy failure, existing signed rollback/recovery procedure restores previous release; preserve control snapshot for diagnosis.

**Retire:** Ad hoc `void promise.catch(...)` reporters after callers move to shared supervisor.

### Phase 1 — freeze contracts and measure baseline

**Prerequisite:** Phase 0 release is stable in isolated harness; no live workload migration.

**Affected current paths:** `dashboard/server/control/{p2Contracts.ts,types.ts,storeTypes.ts,store.ts}`, `dashboard/server/api/v1`, `dashboard/src/control/controlClient.ts`, Python `deploy/control_plane_schema.py`, fixtures/tests.

**Work:** Publish an inventory of public command/query/wire schemas, ownership, callers, and compatibility policy. Add contract conformance tests without changing semantics. Measure LOC/module dependency/transition inventory and agreed workload benchmark baseline.

**Minimal entities:** `WireContractVersion`, `CapabilityManifest`, `CompatibilityMatrix`, `BenchmarkScenario`.

**Worker brief:** “Inventory and tests only; no wire behavior change, no generated-code commitment until schema source is human-approved.”

**Human gate:** Approve schema-source and benchmark criteria only if they alter governance/public compatibility.

**Acceptance:** UI producer → actual server decoder and server producer → actual UI decoder pass for each frozen command; all unsupported fields fail closed.

**Failure/backout:** Delete unconsumed inventory artifacts; existing routes remain authority.

**Retire:** None.

### Phase 2 — compare repository candidates and shadow the selected design

**Prerequisite:** Phase 1 frozen contract inventory. No architecture selection is pre-approved: bounded, isolated SQLite and Temporal implementations use the same representative workflow before a human selects either.

**Affected current paths:** add `dashboard/server/runtime/{repository,schema,migrations,projection,integrity}.ts`; adapt `control/store.ts` read observation only; deployment build/backup path and test fixtures.

**Work:** Implement bounded SQLite WAL and Temporal candidates behind the same local-only service interface and run the same representative workflow. Record recovery, retained production LOC, new processes/dependencies, runbook burden, and deterministic-test outcome; then shadow only the human-selected candidate from a pinned, post-commit snapshot/feed. Derive projections and compare IDs, versions, terminal outcomes, artifact digests, open requests, and schedules. Shadow never launches, claims, settles, or publishes.

**Minimal entities:** `RuntimeSnapshot`, `ImportCursor`, `ShadowComparison`, `QuarantinedRecord`, `RuntimeRepository`.

**Worker brief:** “One-way post-commit observation only. No request-path dual write, no production authority, no network DB. Quarantine malformed source records with evidence instead of rejecting all projection.”

**Human gate:** Select candidate after comparison; approve migration data classification/retention and any governance amendment proposal. Routine bounded comparisons and shadow checks need no per-run approval.

**Acceptance:** Re-import same cutoff twice is idempotent; two same-stage runs load independently; corrupt one historical source record appears quarantined while diagnostics/read projection remains available.

**Failure/backout:** Stop shadow importer and discard shadow DB; old store untouched.

**Retire:** None.

### Phase 3 — introduce one command authority for new test runs

**Prerequisite:** Phase 2 comparison is clean for selected fixtures and restore drill succeeds. This phase is isolated-state only: no production operator command or production new-authority write may be exposed before Phase 10's amendment and cutover.

**Affected current paths:** add `dashboard/server/runtime/{commands,queries,leases,events,approvals}.ts`; adapt `control/routes.ts`, `control/execution.ts`, `control/runTransactions.ts`, `http/surface.ts` through an adapter.

**Work:** Route only a feature-flagged synthetic/new test-run class through `RunCommandPort`. Persist run, stage, attempt, event, approval, and lease rows transactionally. Legacy engine remains sole authority for legacy runs.

**Minimal entities:** `CommandReceipt`, `RunProjection`, `Lease`, `ResourceReservation`, `ApprovalRequest`.

**Worker brief:** “Implement a narrow new-run slice with full fences and idempotency. Do not migrate existing live runs. Preserve current API shape through adapter.”

**Human gate:** None for local deterministic fixture runs. A production operator command is not a Phase 3 option; it remains prohibited until Phase 10's amendment and cutover gate.

**Acceptance:** Concurrent identical command returns same receipt; stale expected version/fence is refused; human response changed after expiry is refused; API/UI decoders consume actual producer bytes.

**Failure/backout:** Disable feature flag before first authority write. After any new-authority write, use compatible reader/export, not legacy writer.

**Retire:** No legacy paths yet.

### Phase 5 — scheduler and deterministic maintenance

**Prerequisite:** Phase 3 command/lease slice, plus Phase 4 only where a placement launch is needed; explicit human decision on supported desktop scheduling.

**Affected current paths:** `scripts/dispatch.py`, `scripts/schedule_store.py`, `scripts/desktop_dispatch.ps1`, `dashboard/server/schedules/{service,socketRoutes,heartbeat,mirror}.ts`, `dashboard/server/health/*`, schedule tests.

**Work:** Move occurrence claim semantics into runtime repository scheduler. Keep definition import post-commit and revision-pinned. Mark desktop scheduler unsupported and remove/disable its hazardous task wrapper unless user approves a remote/fenced design. Fix the independent issue that `desktop_dispatch.ps1:10,23-27` hard-codes a shared checkout, runs `git checkout ops`, and does not check checkout/pull exit before subsequent work; live task installation remains unverified.

**Minimal entities:** `ScheduleDefinition`, `Occurrence`, `ScheduleClaim`, `MisfirePolicy`, `SchedulerHeartbeat`.

**Worker brief:** “One scheduler authority. Implement DST/misfire/fence tests and an explicit capability-unavailable desktop result; do not create a second parser/clock.”

**Human gate:** Decide whether desktop scheduling is retired or requires later replicated authority; cadence/policy scope changes retain current governance.

**Acceptance:** DST vectors, rollback/forward clock jumps, overlapping ticks, stale claim, crash at each claim phase, and 24-hour outage all yield declared occurrences/events. Healthy no-op tick and deterministic compaction run autonomously.

**Failure/backout:** Before new scheduler writes, restore old schedule snapshot. After writes, retain scheduler-compatible reader and freeze admission while exporting/reconciling.

**Retire:** Desktop scheduled-task wrapper if unsupported; legacy `dispatch.run()` execution path after zero callers and fixture equivalence.

### Phase 6 — worker/executor adapter and terminal lifecycle

**Prerequisite:** Phase 3 leases and Phase 5 scheduler for test class.

**Affected current paths:** `dashboard/server/control/{attemptSessionAdapter.ts,managedExecution.ts,adapters.ts}`, `dashboard/server/pty/{linuxBroker*,route.ts,sessionPersistence.ts,windowsSessionHost.ts}`, `scripts/{agent_runner*,codex_dispatch.py}`.

**Work:** Define one executor adapter contract around lease/fence, capability manifest, workspace reservation, sequenced output, checkpoint, terminal observation, and reconciliation. Preserve fd-pinned Linux broker as the first implementation. Make unsupported Windows capabilities explicit instead of pretending parity.

**Minimal entities:** `ExecutorCapability`, `StartAttempt`, `ObservedExit`, `Checkpoint`, `EffectProbe`, `ExecutorConformanceResult`.

**Worker brief:** “Do not replace broker security controls. Use deterministic fake executable through actual broker plus optional subscription canary; distinguish broker disconnect, worker exit, and result receipt.”

**Human gate:** Any real subscription/live canary and new runtime capability grant; deterministic fake harness is ordinary test work.

**Acceptance:** Linux target runs actual broker path/uid/stdio/profile with deterministic fake CLI; optional separately authorized subscription canary proves real argv only. Kill/restart/timeout leaves one outcome, no orphan, stale fence refusal, replayable transcript cursor.

**Failure/backout:** Disable new adapter routing; current broker/protocol stays active. Never replay unknown provider effect automatically.

**Retire:** Duplicate process-supervision wrappers only after adapter conformance and zero callers.

### Phase 7 — canonical artifacts, outbox, and publication saga

**Prerequisite:** Phase 6 terminal result and artifact manifests.

**Affected current paths:** `control/canonicalResultIntegrator.ts`, `control/queueBridge.ts`, `write/{outbox.ts,asyncGit.ts,branch.ts}`, `reconciliation/*`, `scripts/promote_vm_outbox.py`, `deploy/apply_ops_reconciliation.py`.

**Work:** Convert canonical integration to an explicit intent/effect/receipt saga attached to runtime event IDs. Keep signature, exact-tree, path, outbox, and desktop-promotion guards. Report queue bridge as `{attempted,succeeded,failed}` rather than ambiguous `dispatched`.

**Minimal entities:** `PublicationIntent`, `EffectState`, `ProviderObservation`, `PublicationReceipt`, `ArtifactManifest`.

**Worker brief:** “Keep Git and outbox trust boundaries. Add crash recovery, never distributed transaction fiction, and do not grant daemon direct remote-push authority.”

**Human gate:** Existing signed promotion/deploy approvals only; deterministic reconcile/no-op delivery autonomous.

**Acceptance:** Inject crash before effect, after effect/before receipt, after receipt/before projection, and replay twice. Assert one logical published artifact/card result and exact lineage target.

**Failure/backout:** Pending intent is reconciled against Git/artifact evidence; unknown non-idempotent effect parks. No cleanup deletes evidence.

**Retire:** Engine-specific exception classification and ambiguous queue counter after migration.

### Phase 9 — health, diagnostics, resource budgets, and non-LLM maintenance

**Prerequisite:** Runtime repository, scheduler, executor, and saga expose read ports.

**Affected current paths:** `dashboard/server/health/{routes,service,machineReaders,releaseReader}.ts`, `dashboard/server/index.ts`, `release/*`, deployment validator, dashboards/runbooks.

**Work:** Separate liveness, readiness, admission, execution, scheduler freshness, lease expiry, outbox age/depth, DB migration, broker status, node-proxy/host-map truth, and diagnostic availability. Add deterministic maintenance jobs for expiry, compaction, orphan reconciliation, retention, and integrity scan.

**Minimal entities:** `HealthComponent`, `ReadinessBlocker`, `MaintenanceRun`, `BudgetReservation`, `StaleDecision`.

**Worker brief:** “All probes bounded and read-only except named maintenance transactions. A health check never fabricates healthy. Maintenance has fixed budget/lock/exit-code and no LLM.”

**Human gate:** Threshold/scope changes, destructive retention policy, and deployment decision; healthy/no-op maintenance requires none.

**Acceptance:** Break DB read, broker, proxy, map, outbox, and scheduler independently; affected component is red/unavailable within agreed test deadline while diagnostic endpoint stays available. Maintenance resumes idempotently after kill.

**Failure/backout:** Disable individual maintenance schedule; preserve pending records and alert. Health failure never restarts an otherwise serving process by itself.

**Retire:** Static health placeholders and manual “check everything” operational steps after equivalent signals/runbook.

### Phase 10 — migration cutover and legacy retirement

**Prerequisite:** All capability checklist rows green in isolated environment; human-approved migration amendment; backup/restore drill; explicit SLO decision.

**Affected current paths:** control store/read adapters, runtime repository, API composition, build/release manifest, backup/restore scripts, runbooks, compatibility tests.

**Work:** Take pinned cutoff snapshot, persist durable freeze/cutover journal, drain/park old owned work, replay shadow through cutoff, compare full inventory, write one durable authority marker, then admit only new runs to repository. Before the marker, ship marker-aware admission guards to every rollback-eligible activator and old release so automatic restore/manual rollback cannot restart a legacy JSON writer. Old incomplete runs remain old-engine disjoint, are explicitly parked, or are exported; never guessed migrated.

**Minimal entities:** `AuthorityMarker`, `CutoverInventory`, `LegacyRunDisposition`, `MigrationReceipt`, `ForwardRecoveryPlan`.

**Worker brief:** “One-way cutover with no dual writer. Refuse cutover on any count/ID/digest mismatch. Old/new runs must be disjoint by runRef and authority marker.”

**Human gate:** Migration amendment, cutoff, deployment, and disposition of incomplete live runs.

**Acceptance:** Restore blank isolated instance from DB backup + artifacts + approvals + receipts + definitions; prove one authority, no duplicate accepted receipt or automatic retry of an uncertain non-idempotent external effect, old read availability, and post-cutover forward recovery.

**Failure/backout:** Before marker/new write, restore snapshot and old engine. After marker/new write, compatible reader/export/repair only; no binary-only rollback.

**Retire:** `control-plane.json` as mutable execution authority, whole-document hot-path hydrate, obsolete migration routes, old writer APIs, and their browser constants only after zero callers plus retention approval.

### Phase 11 — learning loops, scale review, and subtraction gate

**Prerequisite:** Phase 10 stable isolated release and measured results against proposed targets.

**Affected current paths:** `orgs/*/HEARTBEAT.md`, `scripts/reconcile.py`, promotion/grade paths, `dashboard/server/reconciliation/*`, health/runbooks, dependency manifests.

**Work:** Keep independent judge/grade workflow separate from builders. Install regulator-style learning/maintenance loops only where target, boundaries, deterministic judge, retry cap, evidence, and human acceptance are explicit. Revisit the selected runtime only on a newly measured, written need; do not add Postgres or Temporal by platform momentum.

**Minimal entities:** `MaintenancePolicy`, `JudgeEvidence`, `LoopBudget`, `EscalationReceipt`, `RetirementProof`.

**Worker brief:** “No self-approval, no automatic policy promotion, no LLM for deterministic housekeeping. Produce subtraction evidence: callers, fixtures, runbooks, dependencies, and migration artifacts removed.”

**Human gate:** New autonomous scope, policy/skill promotion, resource-budget widening, and any platform adoption decision.

**Acceptance:** Independent fresh-context judge fails weakened tests/changed boundary; retry cap two escalates; no-op regulator remains quiet; subtraction proof shows zero callers before removal.

**Failure/backout:** Disable cadence via policy/STOP; preserve evidence; do not clear freeze automatically.

**Retire:** Legacy adapters, dormant fallbacks, one-off recovery routes, and unneeded dependencies only per recorded retirement proof.

## 9. Migration rules and cutover checklist

Shadow feed is post-commit observation or pinned snapshot import only.

Shadow never launches, claims, approves, settles, publishes, or writes legacy authority.

No request handler dual-writes old and new execution stores.

Every imported row has source revision, source digest, import cursor, and result classification.

Comparison is deterministic over sorted identities and semantic digests, not incidental row order.

Cutover inventory includes run/stage/attempt/request/event/artifact/receipt/schedule counts and per-ID digest comparison.

Cutover requires zero unresolved mismatch or explicit human-signed disposition for each mismatch.

Admissions freeze before drain.

Drain reports leases and uncertain effects, then completes/parks them; it never claims them dead from elapsed time alone.

One `AuthorityMarker` is stored in the new repository and a separately durable, signed cutover journal outside the old JSON authority. It contains authority kind, cutoff, schema version, release digest, timestamp, admission-freeze/drain state, and human-approved migration receipt.

Before cutover, ship marker-aware admission guards to every rollback-eligible release activator and old release, including `deploy/activate_release.py` automatic restore at lines 393-409 and manual rollback at lines 418-430. Those guards read the durable journal before starting any legacy JSON writer; a marker/new write causes fail-closed legacy admission and an operator-visible forward-recovery path.

New run IDs after marker are new-authority only.

Legacy runs are read-only/old-engine-disjoint/parked/exported, one declared disposition each.

Pre-marker rollback uses old snapshot and release only while the journal says no new-authority write occurred. Restart during freeze resumes the recorded drain state; it never silently reopens admissions.

Post-marker recovery uses compatible reader plus export/reconciliation plan; manual rollback and automatic restore cannot restart a marker-unaware writer.

Migration governance text is a proposal until human approval; no existing card semantics silently change.

## 10. Test and evidence matrix

| Area | Deterministic test | Optional separately authorized live evidence |
| --- | --- | --- |
| Schema/UI | Actual browser/client producer bytes into real server decoder and reverse | Authenticated browser smoke after deploy |
| Store isolation | Two runs same logical stage/request, randomized collection order, corrupt one row | Sanitized historical snapshot load |
| Commands | duplicate idempotency, stale expected version, stale approval, stale fence | Operator command smoke |
| Scheduler | DST both directions, misfire policies, overlap, claim/restart/crash points | One harmless scheduled canary |
| Executor | Fake executable through actual Linux broker/uid/stdio/profile | One subscription-auth CLI canary |
| PTY | disconnect, backpressure, close timeout, old generation drain | Interactive terminal attach/stop |
| Saga | crash before effect, after effect before receipt, twice replay | Signed outbox promotion drill |
| Stop/deploy | STOP, drain, unlock race, deploy pause/resume, old callback | Human-authorized deployment ceremony |
| Restore | blank isolated instance from DB/artifacts/approvals/definitions/receipts | Periodic human-approved restore drill |
| Health | each component failure isolated; diagnostics survive bad runtime record | VM health/readiness observation |
| Learning | independent judge rejects weakened boundary; cap escalates | None required for no-op review |

Linux target tests are mandatory before a Linux deployment claim.

Windows tests cover only supported adapters and explicitly assert unsupported capability otherwise.

Do not substitute mocked broker tests for the actual broker harness.

Do not substitute test-only DTOs for actual UI/server producers and decoders.

## 11. Proposed acceptance targets and required measurements

These are proposed acceptance targets, not measured current performance claims.

- One process-kill/restart at every named transaction/effect boundary converges without duplicate accepted receipt or automatic redispatch of an uncertain non-idempotent effect. Provider-specific physical duplicates remain possible; reconciliation or a parked decision is required.
- Zero unhandled promise rejections from sanctioned detached execution continuations in fault-injection suite.
- Zero stale-fence result accepted after lease replacement in a 1,000-iteration deterministic race harness.
- Scheduler claims each generated occurrence at most once under overlapping ticks; declared misfires become an event, never silence.
- Diagnostic health response remains available when execution admission is closed for one quarantined runtime record.
- Restore to a blank isolated instance reproduces all accepted run/artifact/approval/receipt inventories at cutoff.
- Maintenance jobs have explicit per-run row/time/I/O budgets and exit after at most two failed attempts before escalation.
- Outbox health exposes depth, oldest age, last successful promotion, and unreconciled intent count with thresholds chosen by humans.

Benchmark decisions still required: target command latency percentile, scheduler lateness, max concurrent attempts, artifact/transcript retention, backup RPO/RTO, outbox age ceiling, and offline desktop duration.

No phase may claim a measured speedup until a reproducible benchmark records baseline, environment, load, and result.

## 12. Capability completeness checklist

- [ ] Versioned agent declarations, profile/model routing, skills, and scoped memory resolve to immutable attempt manifests.
- [ ] Workflow compiler supports DAG, fan-out/consolidation, bounded iteration, and definition pinning.
- [ ] Run/stage/attempt/lease lifecycle has one authority, fences, idempotency, and separate retry/resume/restart.
- [ ] Scheduler has explicit timezone/DST/misfire/overlap/fencing semantics.
- [ ] Supported executor adapters pass conformance; broker security controls remain intact.
- [ ] Terminals/replay use distinct session, event, and byte-cursor lifecycles.
- [ ] Meaningful human gates are durable, scoped, expiring, idempotent, and T3-compatible.
- [ ] Artifacts/lineage/canonical publication tolerate at-least-once delivery, deduplicate accepted receipts, and reconcile or park uncertain effects before redispatch.
- [ ] Browser/API contracts share schema and actual producer-decoder tests.
- [ ] Health separates liveness/readiness/admission/executor/scheduler/outbox/diagnostics.
- [ ] Independent judge and learning proposal flows retain human acceptance and retry damping.
- [ ] Release, signature, backup, blank restore, and forward recovery are rehearsed.
- [ ] Desktop capability is explicitly supported with proof or explicitly unavailable/retired.

## 13. Effort, dependency, and risk register

| Risk | Why it matters | Mitigation / decision point |
| --- | --- | --- |
| Hidden current API consumers | Adapter changes could break UI/CLI/automation | Phase 1 producer-decoder inventory and compatibility tests before writer change |
| Legacy state not cleanly importable | Whole-document historical records may be malformed | Quarantine per record; preserve old read/export; never guessed migration |
| SQLite durability/throughput mismatch | Baseline may not meet unspoken scale/HA need | Define workload/RPO/RTO; benchmark and promote Postgres only on evidence |
| External effect ambiguity | Duplicate or missing work-product publication harms trust | intent/receipt/reconcile/park model and fault injection |
| Scheduler redesign expands scope | Desktop failover request could create split brain | Default retire unsupported artifact; require explicit user need and fencing design |
| Broker refactor weakens boundary | PTY is security-sensitive and VM-proven | Preserve broker; adapter conformance around it; adversarial review |
| Cutover becomes dual write | Conflicting authorities corrupt semantics | shadow post-commit only; one marker; new run disjointness |
| LLM loops Goodhart | Self-validation can weaken safety | deterministic judge, independent inspector, cap two, human acceptance |

Rough effort cannot be estimated responsibly until the user answers scale/recovery/desktop requirements and Phase 1 inventory measures dependency surface.

Phase 0 is urgent remediation work.

Phases 1–2 are low-to-medium uncertainty discovery.

Phases 3–7 are high integration effort because they cross runtime, browser, broker, and deployment contracts.

Phase 10 is a high-risk human-gated migration.

Phase 11 is subtraction and operational hardening, not a license for indefinite platform expansion.

## 14. Practical development expectations

Workers begin with `python scripts/preamble.py` and repository/project instructions.

Workers use isolated worktrees and never share the desktop production checkout.

The current desktop wrapper's `git checkout ops` / unchecked pull behavior is not a safe development or runtime contract and should be removed/retired if unsupported.

Focused tests use isolated runtime and temporary state roots, including `DASHBOARD_STATE_ROOT`, never user AppData.

Python tests use an explicit writable `--basetemp` under the approved workspace temporary root.

TypeScript tests use the repository-supported native config loader/cache settings when shared dependency cache writes are unavailable.

Linux broker harness, static validator, and deployment script tests run on Linux/WSL before asserting Linux readiness.

Any real CLI subscription check is an optional canary with a human-approved card, hard resource budget, and no credentials printed or copied.

No new dependency, release unit, network listener, or database service is installed during design-only work.

## 15. Review request

Before implementation, send this plan to a fresh-context adversarial reviewer.

The review must challenge authority ownership, stale-fence behavior, effect-before-receipt recovery, desktop-retirement decision, cutover/rollback asymmetry, privilege preservation, test realism, and every claimed retirement.

The reviewer should reject phases that add a second scheduler, dual writer, unbounded retry, self-accepting loop, fabricated health, or secret-bearing runtime configuration.

Only then should a human select Phase 0/1 cards and answer the open product decisions.

## 16. Migration disposition appendix

This appendix supplies the evidence and record-level rules used by the numbered phases; it does not create a parallel delivery sequence.

“Quarantine” below means a semantically invalid aggregate record in an otherwise readable database.

It never means physical database/page/WAL/schema/FK corruption is safe to ignore.

Physical corruption closes all runtime writes, opens an independent diagnostic surface that does not query the failed database, and requires restore/rebuild from verified backup plus artifact and Git receipt inventory.

The diagnostic surface may show signed release/version, last independently persisted health marker, and restore instructions, but never reads or displays `cursorSecret` or other secret values.

No human disposition can waive an unexplained integrity or security mismatch.

Human disposition applies only to classified, evidence-preserved legacy semantic records after a deterministic comparison identifies the exact mismatch and permitted outcome.

### 16.1 Complete `StoreDocument` migration disposition

| Current collection/key (`storeTypes.ts:312-378`) | New owner / disposition | Transform or rebuild | Verification and dependency |
| --- | --- | --- | --- |
| `proposals` | Git definition revision + repository proposal snapshot | Retain each historical approved proposal snapshot verbatim with its immutable digest and referenced protected revision; never reconstruct a past approval from current definitions | count/id/approved-snapshot digest/revision; depends on definition resolver |
| `runs` | runtime repository `runs` | Normalize identity, lifecycle, pinned definition and execution generation | count/runRef/owner/version; depends on proposals |
| `stages` | runtime repository `stages` | Normalize DAG edges and assignment snapshot | count/stageRef/runRef/dependency digest; depends on runs |
| `attempts` | runtime repository immutable `attempts` | Preserve predecessor, operation, fence, terminal result digest | count/attemptRef/runRef/result digest; depends on stages |
| `sessions` | runtime repository session metadata | Import only immutable linkage/cursors; active session reconciles broker | count/sessionRef/attemptRef/cursor; depends on attempts and PTY store |
| `humanRequests` | distinct `feedback_requests`, `output_acceptances`, and `t3_action_grants` (or one strictly discriminated table) | Preserve immutable, typed request intent; T3 grants carry a separate immutable authorization envelope bound to actor/action/digest/expiry | count/type/requestRef/runRef/action digest/expiry/auth-envelope digest; depends on runs/stages |
| `events` | append-only runtime events | Re-sequence only through a recorded import map; preserve source cursor | count/cursor/event digest; depends on all referenced IDs |
| `stageGenerations` | runtime generation/checkpoint rows | Normalize logical stage generation and artifact base/result references | count/generationRef/predecessor/result digest; depends on stages/attempts |
| `iterationLoops` | runtime iteration-loop rows | Preserve bounded policy/state, separate from human approval records | count/loopRef/runRef/version; depends on runs |
| `iterationRequests` | runtime iteration request rows | Import full run-scoped request; never join by logical stage alone | count/requestRef/loopRef/base digest; depends on loops |
| `iterationReceipts` | runtime iteration receipt rows | Import immutable decision/evidence digest | count/receiptRef/requestRef/finding digest; depends on requests |
| `generationSupersessions` | runtime supersession edges | Rebuild only when predecessor/successor refs verify | count/edge IDs/generation pair; depends on generations |
| `quarantine` | legacy audit export, not active authority | Classify each bundle; preserve signed/digested export | count/bundle/run digest; depends on semantic integrity scan |
| `deployments` | runtime deployment ledger/read model | Import request/transition history; active deployment reconciles release journal | count/deploymentRef/target/receipt; depends on release journal |
| `schedules` | runtime scheduler definitions | Normalize timezone/misfire/overlap defaults under recorded policy version | count/scheduleId/definition digest; depends on policy decision |
| `scheduleTombstones` | scheduler tombstone table | Import delete revision/identity; never resurrect by import order | count/id/deleted version; depends on schedules |
| `scheduleOccurrenceClaims` | scheduler occurrence/claim table | Import only reconciled occurrences; open claim probes actual executor | count/occurrence/fence/state; depends on schedules |
| `scheduleSeedImports` | Git-definition import receipts | Rebuild from pinned definition revision and preserve old receipt evidence | id/path/seed digest/revision; depends on Git adapter |
| `hostAdvertisements` | placement advertisement table | Import only fresh, decoder-valid records; stale rows retained as audit only | hostId/capability hash/revision; depends on v1 composition |
| `placementLeases` | runtime placement leases | Reconcile active leases against fresh advertisement and worker state | leaseId/host/fence/expiry; depends on advertisements |
| `v1Idempotency` | API command idempotency table | Import unexpired, hash-valid entries; expire by declared retention | key/request digest/response digest; depends on route binding |
| `version` | migration metadata | Record source schema and target schema in authority marker | exact schema pair; depends on cutover receipt |
| `documentRevision` | import source cursor only | Preserve as source revision, do not reuse as target concurrency version | monotonic source map; depends on event import |
| `nextEventCursor` | source cursor/checkpoint | Verify target event count and cursor mapping | last cursor/event digest; depends on events |
| `scheduleCollectionRevision` | source revision/checkpoint | Map to scheduler import revision | revision + schedule digest; depends on schedules |
| `scheduleMirrorRevision` | Git mirror import receipt | Rebuild from merge receipts/watermark | revision/watermark digest; depends on Git/outbox |
| `scheduleMirrorBatch` | publication intent/receipt | Classify completed, pending, failed; reconcile pending before cutover | operation key/PR/target digest; depends on promoter policy |
| `scheduleMirrorMergedWatermark` | immutable mirror watermark receipt | Rebuild from verified merge/no-op receipt | watermark digest; depends on mirror batch |
| `reconciliationReceipts` | publication/reconciliation receipt table | Import exact-key receipts and reconcile prepared rows | key/request/result digest; depends on outbox/promoter |
| `assetPullIntents` | asset-pull saga table | Import intent/receipt; probe active pull before retry | intentRef/operation/fence; depends on deployment state |
| `cursorSecret` | service-managed cursor keyring decision | No user, browser, agent, worker, log, or diagnostic path receives its value. Either a trusted service-internal migration preserves/rotates it without exposing it, or an approved compatibility policy invalidates every v1 cursor | key presence/version only, no value; depends on human policy and key-management review |

The external durable stores require the following disposition too; no migration is complete by copying only `control-plane.json`.

| External store | Owner/disposition | Verification/dependency |
| --- | --- | --- |
| PTY session document and transcripts | broker/session persistence remains authority until adapter import; active sessions reconcile, never guessed migrated | session/attempt binding, epoch, transcript digest/cursor; broker conformance |
| PTY attempt bindings and operation receipts | import/reconcile into attempt lease/effect receipts | operation ID, fence, terminal receipt; broker + runtime repository |
| canonical integration journal | retain as publication saga evidence, import phase/receipt map | intent/commit/card/artifact digest; canonical integrator |
| accounting JSON and budget ledgers | retain ledger authority; project immutable consumption snapshots into reservations | row identity/cost digest/window; budget policy |
| VM outbox ready/receipts/promoted archive | retain trusted promoter protocol, no direct VM push | manifest/bundle hash/parent chain/receipt prefix; drain plan |
| artifact files, worktrees, transcripts | immutable bytes owner; manifest/import only after digest verify | URI/path policy, SHA-256, producer attempt; artifact port |
| Git cards, approvals, memory, workflow records | remain authoritative under current governance until amendment | path/commit/digest/state; human amendment + compatibility adapter |
| `paid-actions.json` and `spend-grants.json` | retain accounting/provider-cap authority; project only immutable, non-secret reservation snapshots | provider-uncertainty state, global-cap window, grant/decision digest; accounting policy |
| `control/durable-receipts.json` | retain as receipt evidence; import exact-key projection only | operation/idempotency key, effect/receipt digest, fence; saga reconciler |
| `agent-session-chains/*.json` | retain/import immutable session-chain ledger | chain parent, subject/run activation, authorized-recovery digest; session adapter |
| `attempt-io/*.jsonl` and `execution-results.json` | immutable I/O/result evidence; repository stores manifests and reconciled terminal projection | attempt/operation/fence, byte/result digest, cursor; artifact/PTY ports |
| `composer/workspaces.json` and `naming.json` | retain UX/workspace naming authority until a compatibility adapter is proven; never make execution authority | workspace/name identity and referenced run/agent digest; UI parity |
| `control-plane.accepted-size` and backups | retain backup/admission evidence through cutover; rebuild only from verified source | cutoff/schema/digest, backup restore result; release journal |
| reconciliation audit store | retain immutable reconciliation evidence; project receipt references | reconciliation key, source/target/receipt digest; trusted promoter |
| Brain index generations | generation store remains authority; atomically activate only complete, verified generation | generation/corpus/commit/model digest and cursor; Brain work package |
| nested run activation/authorized recovery | normalize into typed activation and recovery records, not a generic event | parent/child run IDs, authorizer, grant digest, fence; command authority |
| schedule operation/emission/phase records | normalize into occurrence operation, emission, and phase rows | schedule/occurrence/operation/fence/event digest; scheduler |
| deployment receipts | retain/import release-journal receipt references | deployment/release/target/receipt digest; activation guard |

The disposition test is generated from `storeTypes.ts:312-378` plus this named external-store registry. It fails on any extra, missing, renamed, or unclassified key before import code may claim coverage.

### 16.2 Typed identities and physical constraints

Repository code uses branded `SubjectId`, `RunId`, `StageId`, `AttemptId`, `RequestId`, `OperationId`, `IdempotencyKey`, `ScheduleId`, `OccurrenceId`, `LeaseId`, and `FenceToken`; route strings are decoded once and never reused as interchangeable ID types.

The schema requires primary keys for each identity; foreign keys `stage.run_id`, `attempt.stage_id`/`attempt.run_id`, `request.run_id`, `operation.attempt_id`, `occurrence.schedule_id`, and `lease.(subject_id,run_id)`; and unique constraints for `(subject_id,run_id)`, `(run_id,stage_id)`, `(run_id,attempt_id)`, `(actor_id,idempotency_key)`, `(schedule_id,occurrence_key)`, and one current lease per reservable resource.

The command test suite inserts swapped same-shaped IDs and duplicate rows and must prove type decoding, FK, UNIQUE, expected-version, and fence refusal independently. Migration checks count/cardinality plus every parent-child identity and digest relation, not only aggregate totals.

### 16.3 Authority, outbox, and offline promotion policy

The trusted-promoter model remains the one in `docs/plans/2026-09-03-outbox-drain-cadence-plan.md`.

The VM has no direct Git push credential and receives no new remote-push credential.

The desktop trusted promoter validates complete parent-ordered bundles and applicable signed instruction approval before promotion to `ops`.

“Locally completed” means runtime effect and local durable receipt are complete; it is not “Git published.”

“Git published” requires the promoter's exact commit/receipt after parent-chain validation.

The UI/health model exposes both states and the oldest pending publication age.

Offline lag policy is proposed: warn at 6 hours, block new publication-dependent admissions at 24 hours, and require human disposition at 72 hours; values are revisable after RPO/RTO choice.

A strict-chain instruction item blocked by missing approval or earlier parent is not skipped.

It remains pending with a typed blocker, prevents later chain promotion, and emits a bounded wake/health signal.

Ledger-only chains retain their narrower existing promotion rule; they do not broaden instruction authority.

No phase weakens T3 or allows the daemon to self-authorize promotion/deployment.

### 16.4 Route-to-command binding rule

Shape decoding is necessary but insufficient.

Every mutating HTTP/node/browser route must bind the authenticated actor, owner/subject, target ref, expected version, exact action/request digest, expiry where applicable, idempotency key, and current fence before `RunCommandPort.execute`.

Tests must prove a valid-shaped command is refused when any one of those bindings is substituted.

The permission/action binding is part of the command fingerprint, not a UI convention.

## 17. Capability parity matrix and missing-composition delivery

| Capability | Current modules/routes | Delivery phase | Named parity canary (NOT YET IMPLEMENTED) | Retirement protection |
| --- | --- | --- | --- | --- |
| Agent create/update/default manager/models | `agents/{roster,routes}.ts`, `workflows/{compile,defaults}.ts`, `api/v1/routes.ts` | 1, 3 | `dashboard/server/agents/agentWorkflowParity.integration.test.ts`: factory declaration → roster → default manager → compiler → launch refusal matrix | Do not retire roster/compiler route until old/new DTO byte fixtures and unknown profile/model/runtime refusals match |
| Workflow DAG/fanout/consolidation | `workflows/{defs,compile,routes}.ts`, `control/execution.ts` | 1, 3 | `dashboard/server/runtime/workflowDagParity.integration.test.ts`: fanout, join, dependency failure and ordering | Retire legacy launch slice only after stage IDs/dependency/result projection parity |
| Bounded iteration/gates | `control/{iterationOutcome,store,execution}.ts`, workflows iteration specs | 0, 3 | `dashboard/server/runtime/iterationTwoRunCrash.integration.test.ts`: same stage IDs, two runs, request/receipt/restart | Never remove legacy iteration reader until generation/request/receipt digest inventory matches |
| Skills, roles, scoped memory | `registry/{skills,connections}.ts`, `skills/*`, `memory/*`, agent declarations | 1, 9 | `dashboard/server/registry/agentCapabilityParity.integration.test.ts`: declared skill/role/memory scope resolves to manifest and rejects unapproved connector | Keep current policy/skill gates until manifest and target-wall equivalence prove no widened tool set |
| Brain index/search | `scripts/brain/{indexer,store,brain_query}.py`, `server/brain/routes.ts` | 9 | `dashboard/server/brain/generationFreshness.integration.test.ts`: mutate corpus, observe stale, atomically activate new complete generation | Do not retire current index until source digest/commit, model fingerprint, and result cursor parity |
| Existing API surfaces | `dashboard/server/api/v1/*`, `control/routes.ts`, `services/*` | 1, 3 | `dashboard/server/api/v1/actionBinding.contract.test.ts`: actor/owner/ref/version/digest/expiry/fence substitution matrix | Keep legacy route adapters until actual producer/decoder and HTTP status/error bytes match |
| Terminal create/attach/input/replay/close | `pty/{route,sessionPersistence,linuxBroker*,windowsSessionHost}.ts` | 6 | `dashboard/server/pty/runtimeAdapterParity.integration.test.ts`: fake executable through actual broker and reconnect/replay | fd pin, Unix UID, and path tests remain mandatory; no broad broker retirement |
| Health/diagnostics | `health/*`, `index.ts`, `release/*` | 0, 9 | `dashboard/server/health/physicalAndSemanticFailure.integration.test.ts` | Static healthy placeholders retire only after component probe canary |
| Placement v1 advertise/claim/renew/report | `api/v1/routes.ts`, `placement/{leaseService,reportService,selfAdvertise}.ts`, `index.ts` | 4 | `dashboard/server/placement/productionComposition.integration.test.ts` | Unit services do not count as delivered until full `start()` composition exposes ports and shared state |
| System learning schedules | `learnings/execution.ts`, `index.ts`, `runner/trigger.ts`, `schedules/{heartbeat,mirror}.ts` | 8, 11 | `dashboard/server/learnings/fireToRunnerRestart.integration.test.ts` | Seven schedules cannot be marked active until FIRE → runner → durable batch → merge poll → retire survives restart |
| Learning judge/source provenance | `scripts/agent_maintainer.py`, promotion/reconcile, reconciliation publisher | 9 | `tests/test_agent_maintainer_provenance.py` | Keep target wall/human review; untrusted memory/ledger can propose only with attribution |

The following are normative work packages for the canonical phases above; their placement after the parity matrix avoids repeating the full matrix in each phase, not a separate delivery sequence.

### Phase 4 — complete v1 placement composition and atomic report

**Prerequisite:** Phase 3 command authority test slice; does not require production #173 recovery for isolated local harness.

**Affected paths:** `dashboard/server/{index.ts,http/context.ts,http/surface.ts,api/v1/routes.ts,placement/{leaseService,reportService,selfAdvertise}.ts,control/{storeTypes,placementState}.ts}`.

**Work:** Supply node identity and all v1 ports at production composition; ensure VM/desktop surface uses the intended shared authoritative placement table; reject both missing and mismatched fresh capability advertisement on renew/report; implement report as one transaction or durable idempotent receipt.

**Acceptance command (NOT YET IMPLEMENTED):** `npm.cmd test -- --configLoader native --no-cache server/placement/productionComposition.integration.test.ts server/placement/leaseService.test.ts server/placement/reportService.test.ts` from `dashboard/`.

**Failure/backout:** Feature route remains absent/fail-closed until full composition test passes; do not expose a partial v1 node surface.

### Phase 8 — wire System schedule FIRE to bounded runners and durable batch discovery

**Prerequisite:** Phase 5 scheduler semantics and Phase 7 publication receipts; isolated harness only until human approves any live schedule activation.

**Affected paths:** `dashboard/server/{learnings/execution.ts,index.ts,runner/{trigger,liveness}.ts,reconciliation/{mergePoll,publisher}.ts}`, schedule definitions, learning tests.

**Work:** Add one typed FIRE adapter that resolves an approved System schedule to an owner runner, records durable batch/PR metadata before poll, reconstructs registry at boot, and retires only after one accepted merge/receipt; uncertainty parks rather than automatically retrying a non-idempotent effect. Keep max-five draft output, target wall, independent judge, and no direct publish from proposal sources.

**Acceptance command (NOT YET IMPLEMENTED):** `npm.cmd test -- --configLoader native --no-cache server/learnings/fireToRunnerRestart.integration.test.ts server/learnings/execution.test.ts server/runner/trigger.test.ts server/reconciliation/mergePoll.test.ts`.

**Failure/backout:** Unwired schedule remains visibly capability-unavailable; never describe its library function as live execution.

#### Phase 9 work package — Brain generation freshness and trust attribution

**Prerequisite:** Within Phase 9, complete the health/maintenance read-port work package first and record the source-retention decision.

**Affected paths:** `scripts/brain/{indexer,store,brain_query,chunker}.py`, `dashboard/server/brain/routes.ts`, `scripts/agent_maintainer.py`.

**Work:** Build into a new complete generation carrying corpus digest/commit and file revision map; atomically activate only complete generation; API marks stale/refuses according to declared policy. Attach provenance/trust classification to memory/ledger-derived learning proposals.

**Acceptance command (NOT YET IMPLEMENTED):** `python -m pytest -q tests/test_brain_generation.py tests/test_agent_maintainer_provenance.py --basetemp <isolated-approved-temp>` plus `npm.cmd test -- --configLoader native --no-cache server/brain/generationFreshness.integration.test.ts`.

**Failure/backout:** Preserve prior complete generation; failed rebuild never overwrites it; untrusted evidence remains draft-only.

## 18. Repository evaluation, corruption, and exact test gates

Phase 0's #173 merge/recovery gates production recovery only.

Every local harness/build phase may proceed against isolated state from the audited baseline, provided it never changes production authority or claims live recovery.

Phase 2 must compare a bounded SQLite prototype and a bounded Temporal prototype using the same representative workflow: four concurrent deterministic fake workers, fanout/join, one human wait, one retry, one crash-after-effect-before-receipt, 10,000 retained event histories, and blank-instance restore.

The comparison records retained production LOC, new runtime/process/dependency count, operational procedures, deterministic test count, recovery outcome, and measured command/scheduler latency on named hardware.

It is not a categorical topology rejection.

The provisional acceptance criteria are DB command p95 <= 250 ms, scheduler claim lateness p95 <= 5 s, and local recovery <= 60 s excluding remote providers at four fake workers/10k histories.

These are proposed/revisable test targets, not current measurements or user SLOs.

RPO/RTO and hardware baseline require explicit human choice and recorded benchmark environment.

| Phase | Exact proposed command, all NOT YET IMPLEMENTED unless named existing | Required result |
| --- | --- | --- |
| 0 | `npm.cmd test -- --configLoader native --no-cache server/control/automaticFailureReporter.test.ts server/control/executionGeneration.integration.test.ts server/control/store.test.ts` | no unhandled rejection; two-run hydration and lock/drain fence |
| 1 | `npm.cmd test -- --configLoader native --no-cache server/api/v1/actionBinding.contract.test.ts server/agents/agentWorkflowParity.integration.test.ts` | actual producers/decoders plus bound actor/owner/ref/version/digest/expiry/fence refusals |
| 2 | `npm.cmd test -- --configLoader native --no-cache server/runtime/sqliteTemporalEvaluation.integration.test.ts` | same workflow/report and named burden metrics; no execution from shadow |
| 3 | `npm.cmd test -- --configLoader native --no-cache server/runtime/runCommandLease.integration.test.ts server/runtime/workflowDagParity.integration.test.ts` | idempotency/CAS/fence/resource reservation |
| 4 | command named in Phase 4 | v1 routes bound, missing advertisement is `capability-lost`, report atomic |
| 5 | `python -m pytest -q tests/test_runtime_scheduler_semantics.py --basetemp <isolated-approved-temp>` | DST/misfire/claim/overlap/fence/crash vectors |
| 6 | `npm.cmd test -- --configLoader native --no-cache server/pty/runtimeAdapterParity.integration.test.ts server/pty/realBroker.integration.test.ts` | actual broker fake executable; stale result/orphan behavior |
| 7 | `npm.cmd test -- --configLoader native --no-cache server/runtime/publicationSagaCrash.integration.test.ts server/reconciliation/realPorts.test.ts` | effect-before-receipt reconciliation and strict promotion chain |
| 8 | command named in Phase 8 | all seven System paths survive restart and retire only on an accepted receipt |
| 9 | commands named in Phase 9 work package plus `server/health/physicalAndSemanticFailure.integration.test.ts` | bounded truthful health, complete generation or old generation |
| 10 | `python -m pytest -q tests/test_runtime_cutover_restore.py --basetemp <isolated-approved-temp>` | blank restore, authority marker, inventory, post-write forward recovery |
| 11 | `python -m pytest -q tests/test_learning_loop_judge.py tests/test_retirement_proof.py --basetemp <isolated-approved-temp>` | independent judge, cap-two escalation, zero-caller retirement proof |

Physical corruption test uses intentionally damaged isolated SQLite database/page/WAL and proves writes close, diagnostic endpoint does not open the DB, and verified restore succeeds.

Semantic corruption test changes one run-scoped row while physical DB remains valid and proves only that record is quarantined with a durable diagnostic reason.

## 19. Governance activation order

1. Test-only phases use isolated state roots and feature flags; current cards, Git transitions, and production run authority remain unchanged.

2. A human reviews a proposed amendment that names new runtime authority, Git/card compatibility behavior, record retention, cursor compatibility/invalidation, and cutover approval role.

3. Until that amendment is approved and committed through existing governance, no production new-authority command, schedule claim, approval, or publication write is enabled.

4. Human approves a signed cutover card only after isolated restore, parity, physical/semantic corruption, and trusted-promoter chain tests pass.

5. Deployment freezes old admissions, drains/parks work, validates inventory, writes one authority marker, and enables new writes only after marker persistence and readiness.

6. A later human approves retirement only with zero caller proof, fixture parity, retention/export confirmation, and a forward-recovery drill.

Deterministic healthy no-op scheduler, reconciliation, compaction, and health checks need no per-run human approval within their already approved bounds.
