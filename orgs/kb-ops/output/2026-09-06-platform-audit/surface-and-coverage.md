# Platform surface, UI/API, and coverage audit — DRAFT

**Snapshot.** Local worktree `39197cf5`, inspected 2026-09-06. This is an inventory plus selected end-to-end tracing, not a claim that every production line was read. “Full read” means whole-file reading in **this audit lane**; none of the 284 production server modules received that treatment here. “Traced” means relevant route/client/contract paths were read or followed. “Inventoried” means tracked files were counted and classified only. This label does not contradict a full read an execution/recovery lane may have performed elsewhere.

## Decision summary

The platform is substantially larger than a dashboard: 82,249 physical production lines under `dashboard/server` plus 12,439 in `dashboard/src`, with custom control-plane, PTY, Git-write, deployment, policy, WebAuthn and VM-release surfaces. Its clearest engineering strength is closed request/response decoding across the browser/server boundary. Its primary reduction opportunity is not a visual rewrite; it is shrinking the control-store/state-machine and route/client duplication while preserving the existing security boundary.

The immediate confirmed test problem is hermeticity: `GET /api/control/runs/:runRef` can allocate a display ordinal and write the default user-state `naming.json`. The supplied failure is reproducible in the primary suite as 23/25 pass with two `EPERM` failures against `C:/Users/danie/AppData/Local/kb/dashboard/naming.json`; isolating `DASHBOARD_STATE_ROOT` makes the two tests pass (2/2). I did not rerun it, per instruction; the code path corroborates the supplied result.

## Inventory method and counts

Tracked paths were obtained with `git ls-files`. “Physical LOC” is the sum of `[System.IO.File]::ReadAllLines(path).Count`, including blank lines and excluding tests/fixtures. It deliberately does **not** use PowerShell `Measure-Object -Line`, which counts only nonempty lines. Tests include filename tests plus `tests/`, `fixtures/`, `__fixtures__/`, and `testFixtures/`; assets include schemas, docs, config and metadata.

| Scope | Tracked files | Production source | Tests/fixtures | Assets/config/docs | Physical production LOC |
| --- | ---: | ---: | ---: | ---: | ---: |
| `dashboard/server/` | 647 | 284 | 360 | 3 | 82,249 |
| `dashboard/src/` | 170 | 79 | 74 | 17 | 12,439 |
| `dashboard/shared/` | 4 | 2 | 0 | 2 | 359 |
| `dashboard/scripts/` | 2 | 2 | 0 | 0 | 317 |
| `broker/` | 25 | 14 | 11 | 0 | 2,613 |
| `deploy/` | 15 | 9 | 0 | 6 | 4,271 |
| `scripts/` | 100 | 96 | 3 | 1 | 30,251 |
| `tests/` | 134 | 0 | 134 | 0 | 0 |
| `schemas/` | 4 | 0 | 0 | 4 | 0 |
| `agents/` | 18 | 0 | 0 | 18 | 0 |
| `.github/` | 1 | 0 | 0 | 1 | 0 |

There is no tracked top-level `workflows/` directory; workflow definitions live beneath projects, particularly `orgs/<project>/workflows/`, and are parsed by the platform. Business-specific code/data was not source-deep-reviewed: `atlas/**`, `orgs/faceless-youtube/**` (including render assets/scripts) and `scripts/yt_analytics.py`. They are part of the repository inventory, not evidence for a control-plane conclusion.

The complete machine-readable listing is [platform-file-inventory.tsv](platform-file-inventory.tsv). It contains all 1,120 tracked paths represented in the table, their classification, subsystem, physical line count and this lane’s conservative coverage level. The classifier treats `scripts/test_*.py` and `scripts/KeepAwake/KeepAwake.Tests.ps1` as tests rather than production source; that correction changes the `scripts/` row above.

### Twenty largest production modules

| Physical LOC | File |
| ---: | --- |
| 6,258 | `dashboard/server/control/store.ts` |
| 2,608 | `dashboard/server/control/routes.ts` |
| 2,599 | `dashboard/server/control/execution.ts` |
| 1,814 | `dashboard/src/control/controlClient.ts` |
| 1,629 | `dashboard/server/control/proposal.ts` |
| 1,580 | `dashboard/server/write/branch.ts` |
| 1,371 | `dashboard/server/workflows/defs.ts` |
| 1,366 | `dashboard/server/pty/sessionRecord.ts` |
| 1,315 | `scripts/KeepAwake/KeepAwake.psm1` |
| 1,299 | `dashboard/server/control/canonicalResultIntegrator.ts` |
| 1,295 | `dashboard/server/workflows/routes.ts` |
| 1,293 | `dashboard/server/control/queueBridge.ts` |
| 1,279 | `dashboard/server/control/attemptSessionAdapter.ts` |
| 1,247 | `scripts/dispatch.py` |
| 1,235 | `dashboard/server/control/migrations.ts` |
| 1,120 | `dashboard/server/control/adapters.ts` |
| 1,059 | `scripts/gates/phase1_gate1.py` |
| 1,008 | `scripts/hooks/lib/destructive_classifier.js` |
| 966 | `scripts/promote_vm_outbox.py` |
| 929 | `dashboard/server/control/storeTypes.ts` |

The largest three server modules are all in the bespoke control plane. `controlClient.ts` repeats a large closed DTO grammar in the browser. That concentration is the strongest evidence for modularization and generated/shared contracts, not for replacing the UI.

## Server-family ownership and audit coverage

“Ownership” below means the architectural concern the family owns, not a named human owner. Every tracked `dashboard/server` family is listed. The coverage labels are deliberately conservative.

| Server families (tracked files) | Architectural ownership | Coverage in this audit |
| --- | --- | --- |
| `(root)` (10) | boot, route inventory and daemon composition | **Traced**: `index.ts` registration/read-write scope boundary |
| `agents` (6) | agent declarations, roster, builder and launch | **Traced**: routes and Agents UI |
| `control` (150) | proposals, runs, stages, attempts, gates, persistence and queue bridge | **Traced**: store outline, main routes, client DTO decoder and run-wire integration test; not full read |
| `http` (7) | shared surface context and write-surface guards | **Traced**: route composition, auth/rate/session/write layering |
| `pty` (37) | terminal protocol, broker adapter, session persistence/replay | **Traced**: route, client and Terminal UI; not broker implementation full read |
| `schedules` (17) | schedule source/mirror, ownership, socket routes | **Traced**: service/client route registration and UI contract |
| `workflows` (20) | workflow definition scan/compile/launch and read DTOs | **Traced**: route/UI launch path |
| `auth` (26), `approvals` (7), `security` (4), `placement` (24), `runtime` (14), `win32` (2) | identity, passkey/session, authorization, execution placement and host capability | **Inventoried**; referenced only through shared guards/launch paths, not source-audited |
| `api` (25), `services` (14), `entities` (10), `schema` (4), `types` (2), `shared` (4) | versioned API, service seams, entity DTOs and schema/types | **Inventoried**; the `api/v1` registration and browser decoder interface were observed, but families were not fully traced |
| `health` (19), `home` (7), `inbox` (19), `hub` (8), `trace` (11), `panels` (2), `planeA` (10), `planeB` (7), `routing` (9), `brain` (2), `kb` (4), `tasks` (2), `vibe` (2), `static` (2) | read-model/dashboard panels, search, event stream and navigation data | **Inventoried**; health/home/inbox registration seen, no semantic audit |
| `write` (32), `deploy` (15), `release` (6), `reconciliation` (12), `runner` (4), `stop` (2), `composer` (5), `registry` (4), `platform` (4), `learnings` (8), `audit` (3) | Git mutation, releases, recovery/runner, authoring, registry and audit | **Inventoried**; write/release are in scope for a separate mutation/deploy audit |
| `__fixtures__` (17), `testFixtures` (48) | test data and integration harness support | **Inventoried only**; excluded from production LOC |

No family is labeled “full read” in this lane. That boundary matters: e.g. static route registration does not establish semantic correctness of an API, and a route/client trace does not audit PTY host execution or release signing.

## UI/API and contract trace

### Composition and guard layering

`dashboard/server/index.ts:279-307` registers the authenticated read scope: origin allowlist, rate limit and session first; then runtime capabilities, browser/index/routing, Agents, schedules, inbox/home/health, trace (conditional), workflow reads and v1 reads. `dashboard/server/http/surface.ts:596-675` separately assembles the governed write scope (origin → rate limit → session → gate → audit), then control/approval/v1 mutation routes. PTY has its own WebSocket-compatible scope rather than being folded into the HTTP mutation hook. This is a sensible boundary, but it makes registration and contract testing especially important.

The static inventory extraction saw 133 explicit production route registrations and 117 unique method/path pairs. The apparent duplicate paths were expected alternate-mode/fixture registrations, not a confirmed collision: e.g. `index.ts` has desktop/tailnet mode alternatives for `/readyz`, capabilities, agents and workflows; `testFixtures/p6TwoDaemonFixture.ts` simulates routes. This audit found **no confirmed duplicate active production registration**.

### Workflow launch → run detail → approval/terminal

1. `dashboard/src/views/Workflows.tsx:83-105` takes a source revision plus client idempotency key and posts `POST /api/workflows/:id/launch`; on a returned run it navigates to the workflow/run detail. `dashboard/server/workflows/routes.ts:1230+` owns workflow list/detail; launch lives in the separately guarded workflow write scope described in `index.ts`.
2. `dashboard/src/control/controlClient.ts:1114-1436` is a strict closed decoder for the run envelope, stages, attempts, sessions, human requests, iteration state and replay data. It rejects an unknown or absent key rather than displaying an inferred state.
3. `dashboard/server/control/runDetailWireContract.test.ts` drives a real in-memory store through a real `GET /api/control/runs/:runRef` route and then the browser decoder, with populated generation, iteration and resolved-human-request rows. That is a valuable cross-tier regression guard against the prior DTO drift class; it is not an end-to-end VM test.
4. `dashboard/src/control/RunInspector.tsx`, `RunStream.tsx` and `views/RunDetail.tsx` present gate decisions, events and attempt/session links. Human response and run activation/stop/successor paths use expected version/generation plus idempotency values in `controlClient.ts`.

### Agent list/detail/launch/schedule

1. `dashboard/src/lib/agentClient.ts` uses the shared entity client for `GET /api/agents[/:id]`; `Agents.tsx` fetches list/detail and uses a separate guarded `POST /api/agents/:id/launch` with source-CAS and client idempotency.
2. `dashboard/server/agents/routes.ts:284-325` provides ETag-capable list/detail plus session-protected create/update/launch. The launch route checks the exact body, declared agent, source revision and pending amendment state before admission/launch.
3. The agent route itself records an **implementation-seam gap**, not a behavior failure: `dashboard/server/agents/routes.ts:271-276` says the agent launch path has no covering W2 `launchService` analogue and remains inline because its source-CAS/gate sequence differs from workflow launch. Treat this as a refactor/coverage debt: agent and workflow launch may drift because they do not share one launch-service contract. Do not describe it as a currently reproducible broken launch.
4. “Schedule” navigates to `Schedules`; `dashboard/src/lib/scheduleClient.ts` has closed decoders for collection/mutation receipts and posts create/arm/disarm/delete requests. `server/schedules/socketRoutes.ts` is the registered server family; this audit traced its boundary but did not fully audit schedule timing/dispatch semantics.

### Terminal

1. `App.tsx:269-296` deliberately makes “Open terminal” navigation rather than a launch tied to an agent/workflow; the operator picks a launcher in the persistent workspace.
2. `Terminal.tsx` uses `terminalClient.ts`: list sessions over HTTP, then open `/api/pty` WebSocket only when visible/allowed. Create frames are constrained to approved launcher/root/relative path fields; session list/delete are `GET/DELETE /api/pty/sessions/:sessionId` in `server/pty/route.ts:620-635`.
3. Terminal UI tests cover unavailable state, hidden/no-connect behavior, launch frame shape, session isolation, close/detach and no localStorage persistence. This verifies browser protocol behavior, not actual Linux broker execution, descriptor safety or VM process lifecycle.

## Confirmed defect: GET-side persistent naming breaks test isolation

**Evidence.** `dashboard/server/naming.ts:87-102` implements `displayFor()` by allocating a `shortRef`; the first reference updates its bucket and calls `save()` (`:94-95`). `save()` performs `mkdirSync`, exclusive temp file creation, `writeFileSync`, rename and cleanup (`:70-84`). The default singleton targets `resolveDashboardStateRoot()/naming.json` (`:106-111`). `dashboard/server/control/routes.ts:207` derives a run display via `namingFor(ctx).displayFor('run', run.runRef, run.title)` while building the GET DTO.

**Observed supplied result.** `runDetailWireContract.test.ts` creates the default surface context and injects `GET /api/control/runs/:runRef`; without an isolated `DASHBOARD_STATE_ROOT`, two primary-suite tests attempt to write `C:/Users/danie/AppData/Local/kb/dashboard/naming.json` and fail `EPERM` (23/25 pass). With `DASHBOARD_STATE_ROOT` isolated, the same focused tests pass 2/2. I did not repeat the execution.

**Consequence.** A read-contract test has a hidden host-state write and depends on permission to a real user state root. It can fail in sandboxes and can mutate a developer/operator naming registry merely by projecting a previously unseen run. This is a test hermeticity and GET-side-effect defect; it is not evidence that all GET routes write.

**Smallest safe repair direction.** Make `runDetailWireContract.test.ts` supply a temporary `stateRoot`/`NamingRegistry` (the established `namingFor(ctx)` injection seam) and assert cleanup. Separately decide whether persistent ordinal allocation belongs in a GET projection. If stable user-visible ordinals are required, allocate them at accepted entity/run creation or use an explicitly injected ephemeral projection registry for read-only/test contexts; preserve the existing persisted-registry behavior only where it is intentional. Add a test that `GET /api/control/runs/:runRef` with a fresh ID does not touch the production/default state root.

## Prioritized coverage and reduction work

1. **P0 — repair run-detail test isolation.** Add the explicit temporary state root/injected registry to the cross-tier test, protect the default state root with a test, and decide/read-document GET naming semantics. This is small, independently verifiable, and removes an actual red suite result.
2. **P1 — one contract package, generated or mechanically shared.** Keep closed decoders, but derive server DTO types/key sets and browser validators from a shared versioned contract. The current `control/routes.ts` + `controlClient.ts` + `runDetailWireContract.test.ts` triangle has already drifted repeatedly; the 6,258-line store and 1,814-line client make parallel hand-maintenance expensive.
3. **P1 — isolate the control engine.** Break `control/store.ts` into transaction/repository, pure transition policy, and read projection as recommended in `prior-art.md`. Route handlers should call a narrow service port; the UI reads a versioned projection. This reduces both hydrate blast radius and API-shape fan-out.
4. **P1 — converge agent/workflow launch.** Preserve the agent-specific source-CAS/gate checks, but express them as typed policy inputs to one launch orchestration port. Add contract tests proving both routes produce the same run/placement/authorization outcome for equivalent input. Do not force them through a generic service before that contract exists.
5. **P2 — split audit suites by seam.** Maintain fast pure transition/decoder tests, an explicit temporary-state cross-tier HTTP suite, and a separately labeled VM/PTY integration gate. The current count of test/fixture files signals strong test investment, but a file-count ratio is not coverage measurement and must not be reported as one.
6. **P2 — route inventory as a generated contract.** The existing `registeredRoutesOf()`/mode inventory is a good start. Generate a method/path/auth/audit-owner manifest from registration and test it against the frontend clients so alternate desktop/tailnet branches and write scopes cannot silently diverge.

## Audit limits and handoff

- No production, source, dependency, install, branch or commit changes were made.
- No source line outside the traced paths is represented as semantically reviewed.
- The business application areas excluded above may carry separate risks/capabilities and need their own audits.
- The report does not claim runtime test coverage percentages, performance, or absence of defects.
