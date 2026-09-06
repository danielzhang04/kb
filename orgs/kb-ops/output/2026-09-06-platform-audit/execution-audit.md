# DRAFT — Execution/control-plane architecture audit

Date: 2026-09-06

Target: `origin/main` / `39197cf5d9322f21d859d6f7a98d3a5b57cc42ea`

Pending fix inspected: `origin/claude/provenance-fix` (six files, 224 insertions / 12 deletions)
Method: static audit plus focused local tests. No production access or production observation was performed in this audit. The outage facts below are attributed to the supplied `origin/ops` handoff, not independently observed.

## Executive verdict

**REQUEST CHANGES / REDESIGN IN STAGES.** The platform has unusually strong local invariants—CAS versions, idempotency fingerprints, strict result parsing, an atomic file replacement, a writer lease, and a resumable canonical-integration journal—but execution authority and failure containment are split across too many long-lived objects and fire-and-forget surfaces. The pending provenance PR addresses the immediate cross-run hydrate defect and two unhandled-rejection sites, but it does not close the same failure pattern in `routes.ts`.

Top conclusions:

1. **HIGH, open even after the pending PR:** three route-level fire-and-forget continuations can throw while trying to surface an execution failure; their returned rejected promises are unobserved and can terminate the daemon.
2. **MEDIUM design/coverage risk, not reproduced as a user bug:** Lock reports `locked` and permits a fresh Unlock before the old shared PTY host has finished draining. There is no explicit execution-generation fence, but normal immediately-resolved host continuations may finish their snapshot before a second HTTP request can interleave.
3. **HIGH, fixed in the pending PR:** hydrate joined a creator attempt to an open iteration request by repeated logical stage id without subject/run identity, making valid multi-run state unloadable after restart.
4. The execution core is too concentrated: the 15 primary files measured here total **21,578 lines**; `store.ts` is 6,258 lines, `execution.ts` 2,599, `routes.ts` 2,608, and the browser `controlClient.ts` 1,814. `store.ts` contains about 114 method-like implementations behind an 80-method `ControlPlaneStore` surface. This increases the chance that a locally correct per-run writer disagrees with whole-document hydrate validation.

## Architecture and ownership map

| Concern | Current owner | Durable state / write boundary | Important coupling |
|---|---|---|---|
| Unlock/lock authority | `activation.ts#createExecutionLatch` | Process memory only; `onChange` rewires the shared HTTP context | Owns creation/destruction of engine, attempt adapter, IO, internal service principal, workers, accounting and result integrator |
| Run orchestration | `execution.ts#AutomaticExecutionEngine` | Repeated CAS writes through `ControlPlaneStore`; process-local `activeRuns`, `cancellingRuns`, global worker count | Reads policy/assignments, schedules DAG and iteration turns, launches workers, integrates results, cancels, creates human boundaries |
| Manager state | Store `Run.managerSessionRef/generation` plus session rows; `managedExecution.ts` adapter | Store is durable; adapter's `ensured` set is process-local | “Manager” is metadata-only; the engine is the actual in-process coordinator |
| Attempt/session authority | `attemptSessionAdapter.ts` over one `SessionHost` and `SessionRecordRegistry` | Operation/binding records are durable; active attempt map/transcripts are process-local | Two-phase `receipt` then `result`; drain acts on the host epoch, not an engine generation |
| Control-plane aggregate | `store.ts` / `storeTypes.ts` | One `control-plane.json`, loaded and whole-document validated on every mutation, atomically replaced under a writer lease | 20+ collections and global/run-scoped invariants share one failure domain |
| Iteration semantics | `iterationOutcome.ts`, `execution.ts`, store iteration writers + hydrate validator | Requests, receipts, loops, generations, attempts in the same control document | Contract validation exists at parse, write, and hydrate layers; joins must use the full run identity |
| Worktree/accounting adapters | `adapters.ts` | Separate worktree and accounting JSON state | Called by engine; filesystem and Git boundaries are server-planned and path-checked |
| Canonical result | `canonicalResultIntegrator.ts` | Separate resumable journal, attempt commit, lineage branch, then canonical ops-card publication | Serialized under the ops transaction; re-verifies immutable commits and exact result hashes |
| Queue ingestion | `queueBridge.ts` | Reads canonical queue via Python; dispatches through approved launch; settlement writes coordination ledger | Poller is process-local single-flight; launch and reconciliation span store plus ops Git |
| HTTP lifecycle controls | `routes.ts` + `RunControlTransactions` | Per-run process-local FIFO around durable CAS mutations | Several calls intentionally outlive HTTP responses, creating failure-reporting seams |
| Browser projection | `p2Contracts.ts`, `controlClient.ts`, `dashboard/src/control/*` | Read-only DTO normalization and event windows | Several DTOs are duplicated deliberately, so drift is caught only by decoder/contract tests |

The principal write rule is “single daemon writer lease + load/validate/mutate/save.” That prevents two daemon processes from owning `control-plane.json`, but it does not make every multi-system transition atomic: canonical publication spans a separate journal and Git; activation spans store state and process/PTY state; queue dispatch spans the queue, proposal/run store, and ops Git. Those seams therefore need explicit, never-throw recovery records and generation fences.

## Findings

### HIGH — Route error-reporters can still crash the daemon after the pending PR

Locations: `dashboard/server/control/routes.ts:1730-1735`, `2504-2518`, and `2601-2607`. Related pending change: `dashboard/server/control/launch.ts:549-553` and `queueBridge.ts:237` are hardened on `origin/claude/provenance-fix`, but `routes.ts` is unchanged.

Trigger and outcome:

- A Manager-successor execution, ordinary activation, or automatic post-response resume rejects after the HTTP response path has detached it.
- The rejection continuation calls `createHumanRequest`, `getRun`, `transitionRun`, or the local `park` helper.
- If store load/hydration throws (the exact class of failure in the supplied outage handoff), or a reporter/logical follow-up itself throws, the `.catch(...)`/`.then(...)` callback rejects.
- The returned promise is discarded with `void`; there is no final never-throw catch. Under the daemon's documented/default Node rejection posture this is process-fatal, turning one run failure into a service restart or crash loop.

Existing guards inspected: activation dispatch has durable phase receipts and deadline containment; those guard run state, not exceptions thrown inside the detached reporter. The pending PR's `surfaceAutomaticExecutionFailure` safely catches both store refusal and throw, but only the launch module uses it. `routes.ts:2504` also ignores a non-OK `createHumanRequest` except when choosing lifecycle, and any thrown load bypasses that logic.

Smallest fix direction: one shared `surfaceAutomaticExecutionFailure`/`parkNeverThrow` primitive used by **every** detached execution continuation, with a final `.catch` whose callback cannot throw. Prefer a structured process-level rejection policy as a last safety net, but do not use it instead of claiming each detached promise.

Required regression tests:

- For each of the three sites, inject a rejected execution promise and a store whose `createHumanRequest` throws; attach an `unhandledRejection` observer and assert it remains empty.
- Repeat with `createHumanRequest` returning a refusal, `getRun` throwing, `transitionRun` throwing, and the logging callback throwing.
- A static test should enumerate sanctioned detached promises so a new one cannot bypass the helper.

Confidence: **high** (direct control-flow evidence; not production-reproduced in this audit).

### MEDIUM — Lock/unlock lacks an explicit drain state and execution-generation fence

_Amended after adversarial review: the original draft classified this HIGH and stated the Windows host could normally sweep a newly authorized session. That overclaimed the evidence. With an already-ready Windows host, `listEpoch()` and entry into `drain()` continue through immediately resolved promises/microtasks, so a separate HTTP Unlock event is not shown to interleave before the snapshot. No user-visible duplicate/close was reproduced._

Locations: `dashboard/server/control/activation.ts:801-818`; HTTP returns immediately at `routes.ts:737-751`; old adapter drain sets only its own `draining` flag at `attemptSessionAdapter.ts:1267-1273`; the Windows host takes an epoch-wide session snapshot at `pty/windowsSessionHost.ts:688-699`. Existing test `activation.test.ts:548-559` immediately unlocks after lock but uses an already-resolved mock drain.

Trigger and concrete outcome:

1. Operator calls Lock while the shared host has live sessions. `lock()` calls `attemptPort.drain()` without awaiting it, drops the wiring, publishes `locked`, and the route returns success.
2. Operator immediately calls Unlock; no latch `draining` state or admission fence exists, so a new engine and attempt adapter are constructed over the same `SessionHost`/epoch.
3. The contract permits asynchronous drain work to remain pending while the new generation exists. On Linux, `listEpoch()` and `drain()` await `ensureConnected()` (`linuxBrokerClient.ts:342-355`), so reconnect or transport suspension is a possible scheduling window; a deliberately delayed host also exposes the API-level gap.
4. However, this audit did not demonstrate that a production HTTP Unlock plus a successful new launch can interleave before the old host/client snapshot. The confirmed issue is the absence of an explicit generation/drain invariant and a realistic deterministic test, not a proven duplicate-execution incident.

Existing guards inspected: the old adapter refuses new starts after its local `draining=true`; that flag is not shared with the freshly constructed adapter. The Unlock route checks `admission('new-work')`, but latch state is already `locked` and there is no drain promise/generation in admission. Session-record idempotency prevents some duplicate operation keys; it does not prevent an old epoch drain from closing a new session.

Smallest fix direction: make latch state `locked | draining | unlocked`; retain and await one drain promise; refuse Unlock/new work until drain completes (or create a new host epoch and prove old-epoch drain cannot address it). Bind every execution/attempt declaration to a latch generation and fence stale engine callbacks before store projection.

Required regression tests: (1) use a real-shaped delayed host to define the intended Lock→Unlock contract; (2) exercise the Linux reconnect/transport-suspension path; (3) run an event-loop-level HTTP test proving whether a fresh launch can or cannot precede the old snapshot. The fixed contract should either refuse/delay Unlock until drain settles or bind the new wiring to a demonstrably separate epoch.

Confidence: **high** that the latch exposes no drain/generation state; **low** that this produces a user-visible close under current production scheduling. Severity is therefore MEDIUM and coverage/design-focused.

### HIGH — Whole-document hydrate used a cross-run iteration join (fixed in pending PR)

Location on audited main: `dashboard/server/control/store.ts:1695-1700`. Pending fix adds `request.subject === attempt.subject && request.runRef === attempt.runRef` before matching repeated logical stage ids. New pending tests cover two concurrent runs with open creator reworks and writer/hydrate symmetry.

Trigger and outcome: two runs contain the same logical stage id and open artifact-producing requests. Write-time validation sees a single-run bundle, but restart hydration sees the whole document. `requests.find(...)` could select the other run's request, derive the wrong pending base commit, and throw `invalid control-plane creator attempt generation provenance`. The supplied outage handoff reports this caused the VM daemon's restart loop; this audit independently confirms the static faulty join but did not inspect the VM.

Fix assessment: the added subject/run guard is the correct minimal repair and mirrors the already run-scoped generation/request joins. The pending tests are appropriately red-on-revert. It should merge before any further live iteration run.

Confidence: **high**.

### LOW — Queue bridge reports attempted cards as “dispatched,” including failures

Location: `dashboard/server/control/queueBridge.ts:218-227`; test `queueBridge.test.ts:227-247` explicitly expects `dispatched: 2` when the first dispatcher throws.

This is not currently consumed outside tests, so it is not a user-impacting correctness defect today. It is nevertheless an ambiguous metric: the field name and `tick()` documentation imply successful dispatch, while the implementation counts attempts after both success and failure. Before exposing the result to health/telemetry, rename it `attempted` or return `{attempted, succeeded, failed}`. Keep per-card failure isolation.

Confidence: **high** on behavior, **low severity** because no production consumer was found.

## Coupling and bloat measurements

- Primary execution/control files measured: **21,578 LOC** across 15 files.
- Largest units: `store.ts` 6,258; `routes.ts` 2,608; `execution.ts` 2,599; browser `controlClient.ts` 1,814; `canonicalResultIntegrator.ts` 1,299; `queueBridge.ts` 1,293; `attemptSessionAdapter.ts` 1,279; `adapters.ts` 1,120; `storeTypes.ts` 929.
- `ControlPlaneStore` exposes about **80 methods**; `store.ts` contains about **114 method-like implementations** (mechanical regex count, including some nested method shapes).
- `storeTypes.ts` has **223 typed field declarations** by a simple line-pattern count. There are **65** `dashboard/server/control/*.test.ts` files, evidence of substantial local coverage but also a high surface-maintenance cost.
- State is split among at least five authorities: `control-plane.json`, canonical-integration journal, accounting JSON, PTY session/binding persistence, and ops Git/outbox. A transition can therefore be locally atomic yet globally partial.
- Dated, one-off recovery APIs (`20260731`, `20260801`) remain in `storeTypes.ts`, `store.ts`, routes, browser constants, and tests. Once their authorized state is conclusively reconciled, they should be retired into offline/versioned repair tooling rather than remain permanent application surface.
- The browser deliberately duplicates several server DTO declarations and normalizes them separately. Keep strict boundary decoding, but generate both sides from one wire schema so “strict duplicate” does not become hand-maintained drift.

## Keep, remove, redesign

Keep:

- Atomic replace + writer lease + whole-document validation.
- CAS versions and content-bound idempotency fingerprints.
- Two-phase attempt start receipt/result and durable operation binding.
- Canonical integrator's journaled progression, transaction serialization, immutable-commit verification, path/symlink checks, and replay.
- Strict duplicate-key/shape/lineage validation for iteration outcomes.
- Queue per-card failure isolation and engine global concurrency budgeting.

Remove/retire after explicit human/state migration:

- Hard-coded historical recovery routes, store methods, and browser constants.
- Ambiguous `dispatched` counter semantics.
- Hand-copied wire types where a generated contract plus strict decoder can provide the same fail-closed behavior.

Redesign in bounded stages:

1. Introduce an `ExecutionGeneration` owner with `unlocked/draining/locked` lifecycle. Every engine, port, callback and internal caller carries the generation; stale callbacks are rejected before mutation.
2. Centralize detached-promise supervision. No route or poller should author its own `.catch` side effects.
3. Split the 80-method store surface into domain command ports (run lifecycle, attempts/sessions, iteration, human boundaries, schedule/deploy), while retaining one document transaction coordinator and one cross-aggregate validator.
4. Make hydrate validators explicitly partitioned: global uniqueness pass, then per-`subject/runRef` validation bundles. Any cross-bundle join must name why it is global.
5. Keep canonical result integration as a separate saga, but expose its phases through one typed recovery state machine rather than engine-specific exception classification.
6. Generate server/browser wire types and strict decoders from the canonical control-plane schema; keep UI view models separate.

## Staged verification plan

1. **Outage tripwire:** run the pending cross-run hydrate tests and load a sanitized copy of the outage document with the pending validator. Assert no write occurs during read-only load. (Not performed here; no production snapshot was available in this worktree.)
2. **Failure containment:** fault-inject every detached continuation at reporter/store/log stages and assert zero `unhandledRejection`/`uncaughtException` events. Run in a child Node process too, so the test verifies actual exit behavior.
3. **Lock/restart:** deterministic delayed-drain test; rapid Lock→Unlock→start; daemon restart with active starting/running/waiting attempts; repeated Lock; drain refusal; host epoch loss. Assert exactly one generation may launch or project results.
4. **Concurrency:** simultaneous runs at global capacity; cancel while manager ensure is awaiting; cancel during attempt receipt; cancel during integration; manager-successor racing old engine callback. Assert CAS conflicts converge, capacity is released once, and no waiter hangs.
5. **Idempotency/saga:** crash injection after every canonical-integration phase (`intent`, attempt commit, lineage local/committed, canonical intent/committed), then replay twice. Assert one logical result, one card result section, and immutable lineage.
6. **Iteration:** multi-run same-stage ids, multiple subjects, open requests in different cycles, restart at each request/receipt/generation transition, no-progress park, exhaustion and completion gate. Add property-based permutation tests for document collection ordering so validators never rely on `find` order across runs.
7. **Fault isolation matrix:** store refusal/throw, reporter throw, ops push rejection, outbox refusal, PTY host refusal/hang, accounting settlement overage, cleanup failure, and event-log failure. Each must map to a durable boundary or a bounded log—not daemon death.
8. **Live canary (human/deploy authorized separately):** one tiny run per runtime and one iteration turn, then Lock during a live attempt and restart/resume. This audit did not authorize or perform this stage.

## Verification performed

- `python scripts/preamble.py` — **PASS**, `PREAMBLE OK`.
- `npm.cmd test -- --configLoader runner server/control/activation.test.ts server/control/queueBridge.test.ts server/control/store.test.ts server/control/execution.test.ts` from `dashboard/` — **PASS**, 4 files / 402 tests, 75.00 s.
- The first attempt using `npm` rather than `npm.cmd` did not run because local PowerShell execution policy blocks `npm.ps1`; this was an environment invocation failure, not a product-test failure.
- `git diff --stat` / `--name-only origin/main...origin/claude/provenance-fix` — inspected six changed files. The pending branch itself was not checked out and its tests were not executed in this audit.

Passing focused tests do not clear the findings: the current latch test uses an immediately resolved mocked drain, the queue test codifies attempted-as-dispatched behavior, and no test claims reporter failures at the remaining route sites.

## Files inspected

Read in full or effectively full for this audit:

- `CLAUDE.md`; `governance/agent-rules.md`; `orgs/kb-ops/_index.md`, `STATE.md`, `contract.md`
- `.agents/skills/code-review/SKILL.md`; `.agents/skills/security-review/SKILL.md`
- `dashboard/server/control/managedExecution.ts`, `runTransactions.ts`, `runLifecycle.ts`, `iterationOutcome.ts`, `activation.ts`
- `schemas/workflows/v1.schema.json`; `orgs/faceless-youtube/workflows/iteration-loop-demo.md`; `agents/fyt-runner.md`
- `origin/ops:handoffs/2026-09-06-dashboard-outage-recovery.md`

Targeted tracing (symbols, relevant ranges, callers, tests, and error paths; not every line):

- `dashboard/server/control/store.ts`, `storeTypes.ts`, `types.ts`, `execution.ts`, `adapters.ts`, `queueBridge.ts`, `canonicalResultIntegrator.ts`, `attemptSessionAdapter.ts`, `launch.ts`, `routes.ts`
- `dashboard/server/control/activation.test.ts`, `activation.boot.test.ts`, `queueBridge.test.ts`, `store.test.ts`, `execution.test.ts`, `attemptSessionAdapter.test.ts`, `canonicalResultIntegrator.test.ts`
- `dashboard/server/http/surface.ts`, `context.ts`; `dashboard/server/pty/contracts.ts`, `windowsSessionHost.ts`
- `dashboard/server/workflows/defs.ts`, `compile.ts`, `routes.ts`; `dashboard/server/write/workflowRun.ts`
- `dashboard/src/control/controlClient.ts`, `runEvents.ts`, `runGraph.ts` and the file inventory under `dashboard/src/control/**`
- Pending diff for `dashboard/server/control/{store,launch,queueBridge}.ts` and their tests.

Explicit exclusions:

- No credentials, `.env`, `.ssh`, production VM, broker process, external network, outbound SSH, installs, branch changes, commits, governance/eval/coordination mutation, broad suite, or destructive command.
- Paid-provider implementation, deploy/release internals, authentication ceremony cryptography, schedule engine, Composer implementation, and most presentation-only React/CSS were outside this execution-focused pass except where a caller/type trace touched them.
- This is not a complete line-by-line review of every file under `dashboard/server/control/**`; the inventory was enumerated and the named execution/state/canonical paths were prioritized.

## Review basis

This report used the repository's `code-review` workflow to require exact location, trigger, outcome, guards and test gaps, and the `security-review` workflow for process authority, filesystem/Git boundaries, untrusted worker results, failure isolation, and state concurrency. The requested responding model was `gpt-5.6-sol`; this runtime exposed no independent responding-model identifier, so none is asserted.
