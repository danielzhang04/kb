# KB platform overhaul: implementation sequence — DRAFT

**Status:** design-only charter. It authorizes neither a runtime change nor a governance,
deployment, coordination, or production-authority write. The canonical numbered phases are
the 0–11 sequence in `overhaul-plan.md`; this document only makes its packages executable.

## Desired outcome and design advantage

KB should let Daniel define an agent/workflow once, run or schedule it with its approved
defaults, observe and stop real work, resolve durable human gates, and retrieve a verified
artifact after restart or a broker/provider failure. The dashboard is the same truthful
projection through every stage, not a late cosmetic layer.

KB's existing strengths are worth retaining: reviewed Git definitions and policy; cards,
approvals and signed promotion; scoped skills/memory; leases/CAS/outbox/quarantine; a
lower-privilege fd-pinned Linux PTY broker; artifact/transcript evidence; and route/test
coverage. The redesign narrows duplicate lifecycle authority, rather than replacing those
trust boundaries with a generic workflow product. Borrow n8n/Prefect's explicit run/worker
states, Temporal's durable-history comparison discipline, LangGraph's idempotent interrupt
lesson, and ECC's scoped/untrusted-memory boundary—not their whole platforms.

## Non-negotiable delivery rules

- All audited required capabilities stay on the acceptance register. `Unavailable`
  is an honest intermediate state, never a passing delivery result. Only Daniel
  can remove a required capability from scope. Topology is still undecided.
- Present this complete proposal and obtain confirmation before issuing build
  cards or creating implementation scaffolding; later gates remain separate.
- Before *every* implementation card, the boss publishes a concise pre-build summary
  (files, behavior, compatibility/retirement, test and rollback plan). Where the contract or
  binding governance requires human confirmation—public/governance compatibility, capability
  grant, production activation, retention, topology, or cutover—the card waits for it.
  Confirmation of a bounded phase permits its named child work; it does not preapprove
  later phases or T3 actions. Ordinary child work does not gain a new blanket human
  ceremony solely because the plan was split into small cards.
- Each package has a local build/typecheck/lint appropriate to its touched language, focused
  regression tests, then an independent fresh-context adversarial review of the diff and
  actual test output. Broader suites occur before a phase gate; no test is weakened to meet it.
  Two verification failures on the same item trigger escalation, not an unbounded repair loop.
- New vertical slices use an isolated state root, test fixtures and feature flag. They cannot
  launch, claim, approve, settle, publish, or change production authority until Phase 10.
- One authority owns each datum: Git owns reviewed definitions/policy; the selected runtime
  owns live execution; immutable files/object storage own bytes; dashboard/API are projections.
  Preserve STOP, least privilege, signed approvals, authority markers and trusted promotion.
- Effects are at least once. Operation IDs, idempotency keys, leases/fences and reconciliation
  protect logical acceptance; an uncertain non-idempotent physical effect parks for review.
- Dashboard parity is an acceptance item in every package: actual route producer/decoder bytes,
  state/error vocabulary, visibility of unavailable capability, and diagnostic availability.

## Architecture decision boundary

Phase 2 implements the identical representative workflow twice: four deterministic fake
workers, fan-out/join, human wait, retry, crash after effect before receipt, 10,000 histories,
and blank-instance restore. Candidate A is a SQLite-WAL repository behind one local service
writer; Candidate B is Temporal for execution delivery behind the same KB policy/dashboard
contract. Record recovery outcome, latency on named hardware, retained LOC, dependencies,
daemon/process count, deterministic test results, and operator runbook steps. Do not invent a
universal abstraction before both adapters reveal their real common contract.

The spike has a fixed, human-approved time/card budget and exit memo: select a winner, reject
both, or stop for missing requirements—never extend it by abstraction drift. Reject SQLite if it
requires global revalidation, dual authority, cross-store atomicity fiction, or disproportionate
bespoke recovery. Reject Temporal if server/schema/version operations and deterministic-replay
discipline exceed demonstrated recovery benefit. Postgres requires a measured multi-writer/HA
need. Topology (single VM, desktop execution, or multiple hosts) remains a human decision; no
desktop capability is silently retired.

Phase 2 is six separate work packages: (a) freeze black-box fixtures, criteria and budget;
(b) SQLite candidate; (c) Temporal candidate; (d) independent comparison memo; (e) human
selection; (f) selected-engine shadow/import. Only (b) and (c) may run in parallel after
(a). Candidate implementations are disposable. Neither author judges its own candidate.
Each code package has a declared stop condition and review boundary; split it further
if the expected diff breaches the project's review/size limits.

## Dashboard contract across phases

Keep the existing navigation and guarded routes. Home, Health and Run Detail share
versioned read-side revision/provenance semantics, not a new global polling store or
one generic aggregate that loads every run. Each bounded response identifies its
observation time, relevant authority/revision and unavailable/stale reason. If a
revision gap occurs, refetch that projection; never merge incompatible snapshots.

| Operator journey | Required visible result |
| --- | --- |
| Agent/workflow defaults | Resolved manager, chain, model and profile before launch; immutable pinned values after launch |
| DAG and bounded iteration | Stage/attempt identity, dependency status, generation and actionable waiting reason agree with the engine |
| Terminal and stop | Attach/replay cursor, stop requested, draining, stopped/closed and uncertain outcome stay distinct |
| Human decisions | Task feedback, output acceptance and T3 authorization are separate resources with exact action binding |
| Scheduling and placement | Nominal occurrence/timezone, claim, worker capability, lateness and next action are visible |
| Health and recovery | Web liveness, diagnostic availability, execution admission, broker, scheduler and publication health are separate |
| Brain and System learning | Source freshness, completed index generation, durable batch/receipt and independent acceptance are visible |
| Artifacts and publication | Verified local bytes, pending publication, accepted remote receipt and uncertainty are distinct |

Initial UI work uses existing `dashboard/src/home/D13Home.tsx`,
`dashboard/src/views/{Health,RunDetail}.tsx`, `dashboard/src/lib/{homeClient,healthClient}.ts`,
`dashboard/src/control/controlClient.ts` and their current server contracts/tests.
Split route/decoder compatibility and each screen binding into bounded child work.
No screen may advertise an unimplemented path as available or own execution state.

## Phase packages and gates

### Phase 0 — containment and a dashboard-visible isolated vertical slice

**Depends on:** none; production recovery separately requires human merge/deploy of #173.
**Targets:** `dashboard/server/control/{store,routes,activation,attemptSessionAdapter,launch,queueBridge}.ts`,
`dashboard/server/{index.ts,health/routes.ts}`, `deploy/activate_release.py`, and their tests.
**Build/test/review:** TypeScript build and focused proposed `automaticFailureReporter` and
`executionGeneration` tests (not implemented), plus existing `store` regressions; fault-inject every detached continuation,
reporter, and logger in a child process; fresh review confirms no detached rejection path.
**Acceptance/dashboard:** two same-stage runs hydrate independently; `unlocked|draining|locked`
generation fence rejects stale callbacks; admission failure has a restricted diagnostic/readiness
view while run data is unavailable. The early slice includes an actual browser journey through
real server composition (not a component mock), still against isolated state only.
**Retires:** only ad-hoc `void promise.catch(...)` reporting once all callers use one never-throw
supervisor. #173 is not claimed to fix unrelated continuations.

### Phase 1 — freeze contracts, capability inventory, and measured baseline

**Depends on:** Phase 0 isolated evidence; no live migration. **Targets:**
`dashboard/server/control/{p2Contracts,types,storeTypes,store}.ts`,
`dashboard/server/api/v1/**`, `dashboard/src/control/controlClient.ts`,
`deploy/control_plane_schema.py`, `dashboard/server/{agents,workflows,registry}/**`, fixtures.
**Build/test/review:** typecheck/build plus real producer-to-decoder and decoder-to-producer
contract tests; fresh reviewer samples every mutating boundary and unsupported-field refusal.
**Acceptance/dashboard:** compatibility matrix inventories actor/owner/ref/version/digest/expiry/
fence bindings, agent defaults, workflow DAG/iteration, skills/roles/memory, API/UI errors and
dashboard panels. Record baseline dependency/transition/LOC and benchmark method—not telemetry.
Before leaving Phase 1, run a baseline fake executable through the existing real Linux broker
and server composition, with a browser checking launch, terminal output, stop and result identity.
This precedes the Phase 6 adapter replacement. If Linux or browser execution is unavailable,
record that gate as blocked; independent local tests may proceed but cannot satisfy it.
**Retires:** none; inventory/tests change no wire behavior or schema-source commitment.

### Phase 2 — fair engine spike and one-way shadow

**Depends on:** Phase 1 frozen contracts and human-selected evaluation criteria. **Targets:**
new `dashboard/server/runtime/{repository,schema,migrations,projection,integrity}.ts`,
read-only observation in `dashboard/server/control/store.ts`, deployment backup fixtures.
**Build/test/review:** both candidates use the same fixtures/contract DTOs and isolated Linux
composition; repeat import/corruption/restore tests; fresh reviewer verifies metrics and no
candidate has a hidden live authority or shadow side effect.
**Acceptance/dashboard:** idempotent re-import of a pinned post-commit cutoff; independent
same-stage runs; one semantic bad record quarantined with visible reason while other dashboard
projections work; physical DB corruption closes writes and leaves an independent diagnostic.
**Retires:** none. Shadow never launches, claims, approves, settles, publishes, or dual-writes.

### Phase 3 — selected-engine command/lease slice for synthetic runs

**Depends on:** human choice from Phase 2 and successful isolated restore. **Targets:** new
`dashboard/server/runtime/{commands,queries,leases,events,approvals}.ts`; adapters in
`dashboard/server/control/{routes,execution,runTransactions}.ts` and `dashboard/server/http/surface.ts`.
**Build/test/review:** transaction/concurrency plus actual HTTP/UI decoder tests; fresh review
tests substituted actor, owner, ref, expected version, digest, expiry and fence.
**Acceptance/dashboard:** feature-flagged synthetic run gets one receipt under concurrent
submission; stale CAS/fence and expired altered approval refuse; dashboard shows attempts,
leases/events/approval and capability-unavailable states through actual bytes.
**Retires:** none; legacy engine remains the sole authority for legacy runs and no Phase 3
production operator command is permitted.

### Phase 4 — placement composition, not merely placement libraries

**Depends on:** Phase 3; topology decision before any desktop/remote claim. **Targets:**
`dashboard/server/{index.ts,http/context.ts,http/surface.ts,api/v1/routes.ts}`,
`dashboard/server/placement/{leaseService,reportService,selfAdvertise,contracts}.ts`,
`dashboard/server/control/{storeTypes,placementState}.ts`.
**Build/test/review:** real `start()` composition integration plus lease/report unit tests; fresh
review traces identity and shared authoritative table end to end.
**Acceptance/dashboard:** missing or mismatched fresh advertisement produces `capability-lost`;
report is transactional or receipt-idempotent; VM/desktop dashboard visibly distinguishes
supported, unavailable, and stale placement. **Retires:** no route/service until composition
parity passes; unsupported topology remains explicit, not deleted.

### Phase 5 — one scheduler authority and declared desktop outcome

**Depends on:** Phase 3 and Phase 4 only for placement-backed launch; explicit human desktop
scheduling decision. **Targets:** `scripts/{dispatch.py,schedule_store.py,desktop_dispatch.ps1}`,
`dashboard/server/schedules/{service,socketRoutes,heartbeat,mirror}.ts`, health tests.
**Build/test/review:** Python scheduler semantics and dashboard socket tests cover DST/misfire,
clock jumps, overlap, stale fence, crash phase, and 24-hour outage; fresh review checks there is
one parser/clock/claim authority.
**Acceptance/dashboard:** dashboard shows occurrence, claimant, lateness and unavailable desktop
mode; deterministic no-op maintenance is bounded. **Retires:** hazardous desktop task wrapper
only if human elects unsupported desktop scheduling; otherwise it is replaced by a fenced design.

### Phase 6 — executor/terminal contract through the real Linux broker

**Depends on:** Phases 3 and 5. **Targets:** `dashboard/server/control/{attemptSessionAdapter,
managedExecution,adapters}.ts`, `dashboard/server/pty/{linuxBroker*,route,sessionPersistence,
windowsSessionHost}.ts`, `scripts/{agent_runner*,codex_dispatch.py}`.
**Build/test/review:** deterministic fake executable travels the actual Linux broker (UID, fd,
argv, stdio/profile); kill/restart/timeout/orphan/fence tests; fresh review protects broker
privileges and protocol. A separately authorized real-model canary must verify the supported
CLI invocation, meaningful output, independent result checking, artifact provenance, dashboard
state, and stop behavior. A correct argv or process exit alone does not satisfy this canary.
**Acceptance/dashboard:** attach/disconnect/replay has sequenced cursor and distinct broker-loss,
worker-exit, receipt and presently unsupported-Windows states. Any required Windows adapter
must pass its own conformance gate before this capability is complete. **Retires:** duplicate supervision wrappers
only after conformance plus zero callers; no broker security control is retired.

### Phase 7 — artifact/outbox publication saga

**Depends on:** Phase 6 terminal/artifact manifests. **Targets:**
`dashboard/server/control/{canonicalResultIntegrator,queueBridge}.ts`,
`dashboard/server/write/{outbox,asyncGit,branch}.ts`, `dashboard/server/reconciliation/**`,
`scripts/{promote_vm_outbox.py}`, `deploy/apply_ops_reconciliation.py`.
**Build/test/review:** crash-before-effect, effect-before-receipt, receipt-before-projection and
double-replay tests against real ports; fresh review verifies no VM direct push/authority widening.
**Acceptance/dashboard:** intent/effect/receipt and oldest pending publication are visible;
strict parent chain and exact lineage hold; unknown effects park. **Retires:** ambiguous
`dispatched` counter and engine-specific exception classification after equivalent evidence.

### Phase 8 — System FIRE-to-runner execution

**Depends on:** Phases 5 and 7; human approval before live schedule activation. **Targets:**
`dashboard/server/{learnings/execution.ts,index.ts,runner/{trigger,liveness}.ts,
reconciliation/{mergePoll,publisher}.ts}`, schedule definitions/tests.
**Build/test/review:** restart from FIRE through durable batch/PR registry and merge receipt;
fresh reviewer verifies target wall, max-five drafts, independent judge and no direct publish.
**Acceptance/dashboard:** all seven intended System paths must execute in the isolated
production-composition harness, reconstruct after boot, and settle only on accepted receipt.
Unimplemented paths remain visibly unavailable and keep the phase incomplete. **Retires:** none
until each former library-only path has that full canary.

### Phase 9 — truthful health, Brain freshness, and capability surfaces

**Depends on:** read ports from Phases 3, 5, 6 and 7. **Targets:**
`dashboard/server/health/{routes,service,machineReaders,releaseReader}.ts`,
`dashboard/server/{index.ts,brain/routes.ts}`, `scripts/brain/{indexer,store,brain_query,chunker}.py`,
`scripts/agent_maintainer.py`, release/deployment validators.
**Build/test/review:** independently break DB, broker, proxy, host map, outbox and scheduler;
generation freshness/provenance tests; fresh review checks all probes are bounded and never fake green.
**Acceptance/dashboard:** liveness/readiness/admission/execution/diagnostic status, lease/outbox
age and maintenance outcome are accurate; Brain activates only complete attributed generation.
**Retires:** static-health placeholders/manual check-everything only after signal/runbook parity;
prior Brain generation remains on failed rebuild.

### Phase 10 — human-gated one-way authority cutover

**Depends on:** Phases 4–9 green in isolation, explicit RPO/RTO/SLO and topology decisions,
approved governance amendment, backup/restore drill and signed cutover approval. **Targets:**
`dashboard/server/control/{store,storeTypes,migrations}.ts`, selected `runtime/**`, API composition,
`deploy/{activate_release.py,control_plane_schema.py}`, backup/restore scripts and runbooks.
**Build/test/review:** blank-instance DB+artifact+approval+receipt+definition restore; physical and
semantic corruption; inventory/digest comparison, legacy read, authority-marker and forward
recovery tests. Fresh review is independent and must reject any automatic legacy-writer rollback.
Kill/restart at every durable freeze, drain-journal, marker-persistence, release-link,
readiness and boot transition. Every rollback-eligible old release and activator must
enforce the durable marker. A pre-marker abort is verified and recorded; no timeout
or automatic restart may reopen legacy admission. These are required tests, not an
assumption inherited from the diagram.
**Acceptance/dashboard:** cutoff journal, drain/park disposition, one durable authority marker,
disjoint writer ownership, visible migration/diagnostic state and no uncertain-effect retry.
Import preserves historical run/request/attempt identities and approved proposal digests;
disjoint ownership is not permission to rewrite existing IDs or rebuild historical approvals.
**Retires:** only with zero callers and retention approval: mutable `control-plane.json` runtime
authority, whole-document hot hydrate, old writers/routes/browser constants and obsolete migrators.

### Phase 11 — bounded learning, scale reassessment, and subtraction proof

**Depends on:** Phase 10 stable isolated release and measured results. **Targets:**
`orgs/*/HEARTBEAT.md`, `scripts/reconcile.py`, `dashboard/server/reconciliation/**`, health/runbooks,
dependency manifests, promotion/grade paths.
**Build/test/review:** independent fresh-context judge rejects weaker boundary; retry cap two,
quiet no-op and zero-caller retirement tests; fresh review verifies builders cannot self-approve.
**Acceptance/dashboard:** every maintenance/learning loop declares target, budget, evidence,
judge and escalation; dashboard shows loop state and STOP/freeze. **Retires:** legacy adapters,
fallbacks, one-off recovery routes and dependencies only through recorded retirement proof.

## Initial bounded scopes (not issued; Phase 0/1 only)

These are scope identifiers, not dispatch order. Complete the P0 browser scope
(7) before closing Phase 0, and the P1 broker baseline (8) before closing Phase 1.

1. **P0 detached-failure inventory.** Target `dashboard/server/control/routes.ts`,
   `activation.ts`, `launch.ts`, `queueBridge.ts` and add a focused inventory/regression test.
   Stop guard: only the inventory and test-only child-process harness may change; do not alter
   production catch behavior or release paths. Report exact continuation ownership and prove
   the harness detects an injected unhandled reporter rejection.
2. **P0 non-throwing supervisor.** Target new `dashboard/server/control/automaticFailureReporter.ts`
   plus `routes.ts` callers/tests. Stop guard: preserve public DTO/broker/T3 behavior; injected
   store/logger/reporter failures must not produce an unhandled rejection.
3. **P0 generation/drain fence.** Target `dashboard/server/control/{activation,execution,
attemptSessionAdapter}.ts` and integration test. Stop guard: isolated-state fixture only; prove
   old drain cannot sweep a post-unlock attempt and dashboard shows draining/readiness correctly.
4. **P0 degraded diagnostic slice.** Target `dashboard/server/{health/routes.ts,index.ts}` and
   control admission tests. Stop guard: diagnostic reads no failed runtime store or secrets; prove
   normal admission closes while release/version/restore guidance remains available.
5. **P1 mutating-boundary inventory.** Target `dashboard/server/api/v1/routes.ts`,
   `dashboard/server/control/{p2Contracts,p2Decoders,storeTypes}.ts`,
   `dashboard/src/control/controlClient.ts`, `deploy/control_plane_schema.py`. Stop guard: no
   semantic/wire change; publish actor/owner/ref/version/digest/expiry/fence ownership matrix.
6. **P1 actual producer/decoder parity.** Target the Phase 1 inventory plus new contract fixtures.
   Stop guard: no generator/schema-source adoption; test real UI-to-server/server-to-UI bytes and
   one substituted binding at a time, with unknown fields failing closed.
7. **P0 browser/composition baseline.** Target the current server composition, Home/Health/
   RunDetail clients/views and an explicitly proposed browser harness. Run the real browser
   against isolated state; check launch/result IDs, diagnostic refusal and UI freshness.
   Split screen bindings into child patches; never replace routes with browser mocks.
8. **P1 existing Linux broker baseline.** Target existing
   `dashboard/server/pty/realBroker.integration.test.ts` and the real broker test fixture.
   Prove fd/UID/profile/stdio, transcript/result identity and stop through a deterministic
   executable. Stop guard: no deployment, real subscription, new privilege or broker rewrite;
   unavailable Linux execution leaves this gate blocked, not waived.

## Unresolved choices requiring human direction

- All capabilities are required; the first representative fixture is a technical sequencing
  choice, not a reduction of scope. Acceptable RPO/RTO, recovery time, concurrency and offline
  promoter duration remain undecided.
- Supported topology and desktop contract: client only, executor, scheduler, or fenced remote authority.
- Phase 2 engine winner after evidence, retention/cursor compatibility policy, and Phase 10 amendment/
  cutover authority. No cost, model, performance, security or live-capability result is implied here.

## File status

Fresh adversarial review after corrections: READY FOR SUMMARY AND EXPLICIT
INITIAL-SCOPE CONFIRMATION. This is a design verdict, not a promotion grade,
implementation approval or production-readiness result. The review disposition
is in `synthesis-reports/implementation-prebuild/report.md`.

Created this design-only draft: `orgs/kb-ops/output/2026-09-06-platform-audit/implementation-sequence.md`.
No runtime, test, governance, coordination, deployment, dashboard or source file was changed; no
tests or benchmarks were run by this charter.
