# Phase 0 implementation evidence — DRAFT

**Status:** partial Phase 0 implementation evidence, not a platform-wide release approval.

**Write state:** diagnostics is locally committed as `227e1bc9`, pending human review and Phase 0 integration. Its 435 changed lines exceed the 400-line human-review gate. No production, remote, governance, or coordination write is represented by this document.

## Scope: three aspects of the diagnostics slice

| Slice | Current code paths | Delivered boundary | Still outside this slice |
| --- | --- | --- | --- |
| Startup hydrate classification | `dashboard/server/control/store.ts`, `dashboard/server/control/storeBootDiagnostics.test.ts` | The initial persisted-document stat/read/JSON/migrate/assert sequence is explicitly classified. It ends before normalization, migration backup, sidecar, or save; existing startup `ControlStoreLimitError` identity remains compatible and is marked only for this startup path. | Per-operation/runtime hydration wrapping, recovery/import, changing a bad document, or treating post-write failure as diagnostic-safe. |
| Restricted diagnostics | `dashboard/server/bootDiagnostics.ts`, `dashboard/server/bootDiagnostics.test.ts` | Raw Fastify app has exactly two explicit GET endpoints, `/healthz` and `/readyz`; Fastify-generated HEAD is allowed. Both return fixed 503 unavailable state. The test inspects actual `printRoutes()` and proves representative GET plus POST/PUT/DELETE auth/control/workflow/schedule/PTY/static paths are absent. | Root, HTML, static assets, a browser UI, normal health projection, auth ceremonies, or any data/execution route. |
| Boot integration and lease retention | `dashboard/server/index.ts`, `dashboard/server/index.test.ts` | After auth-mode validation and a real writer lease, a typed *pre-write* hydrate failure may boot diagnostics only on literal `127.0.0.1`. It retains the lease until diagnostics closes and uses a single release-once closure that clears the local reference before release. Nonloopback is refused; normal auth/lease/post-hydrate failures remain fatal. | Any fallback on auth, lease, normalization, migration-backup/save, schedule-migration, capability-probe, full-app, or listener failure; any release of the lease while an unvalidated writer state might be active. |

The actual-corrupt-document startup regression uses a synthetic on-disk `{broken-json` document and the real minted writer lease; it is not merely a factory-seam test.

## Relevant prior work and prerequisite state

The implementation worktree began from `e8bf8d35`, the outage-fix prerequisite baseline.

Two adjacent Phase 0 slices were already committed and are not reimplemented by this diagnostics slice:

- `25f87ff3` — drain/activation work (reported commit reference).
- `02092581` — detached-failure reporter work (reported commit reference).

The reporter is a 471-line human-review-gated change. Its boundary is detached-continuation failure reporting; it does not make control-store hydration recoverable or provide the diagnostics surface. The drain/activation boundary is execution-latch generation/drain behavior; deployment quiescence remains separate. This draft does not claim either adjacent slice is small, automatically accepted, or covered by diagnostics tests.

## Verification actually observed

### This implementation worker

| Command / gate | Result |
| --- | --- |
| `npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/bootDiagnostics.test.ts server/control/storeBootDiagnostics.test.ts` | PASS, exit 0; 2 files, 5 tests, 5.32 s after actual-router/mutation-matrix hardening. |
| Same focused new-file gate before hardening | PASS, exit 0; 2 files, 5 tests, 2.45 s. |
| `npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/index.test.ts` | PASS, exit 0; 1 file, 96 tests, 105.19 s. |
| `npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/control/store.test.ts` | PASS, exit 0; 1 file, 163 tests, 41.86 s. |
| `npm.cmd run typecheck` | PASS, exit 0. |
| `npm.cmd run build -- --configLoader native` | PASS, exit 0; Vite transformed 128 modules and built in 1.54 s. |
| `git diff --check` over the six approved source/test paths | PASS, exit 0. |

### Independently reported to this worker

| Gate | Reported result / limitation |
| --- | --- |
| Parent controlled reporter gate | PASS, 245/245, exit 0, 34.92 s. This is parent-reported evidence, not rerun by this worker. |
| Independent activation test gate | One fresh reviewer reported 70/70 activation tests and a READY/PASS result. This is parent-reported evidence, not rerun by this worker. |
| Linux baseline | On WSL Ubuntu: Node v24.19.0/npm 11.17.0, with a recorded mismatch from repository pin Node 24.18/npm 11.16. A fresh archive of exact `e8bf8d35` used native `/tmp/kb-platform-phase0-*` state; `npm ci --offline` used 293 locally cached packages in 19 s without a dependency/lockfile change. `realBroker.integration.test.ts` passed 11/11, exit 0, 3.28 s total (1.619 s tests). It exercised actual Linux broker server/client/PTY plus deterministic shell only. |

The Linux result is a **baseline only**: it did not test this diagnostics patch, a real model, browser/server full composition, or production.

## Failed/limited attempts retained for interpretation

- The first real-corrupt-document index test failed because the test copied a minted writer-lease object; its opaque capability brand then failed `assertWriterLeaseForRoot`. The test was corrected to spy on the real lease's `release` method. The final index gate passed 96/96.
- The first actual Fastify inventory assertion failed only on a Windows terminal-newline difference in `printRoutes()`; the assertion now normalizes CRLF and trims terminal whitespace while retaining the exact route tree and mutation absence matrix. The final focused gate passed 5/5.
- A default `npm.cmd run build` failed before application build with `EPERM` opening Vite's shared `.vite-temp` config file. The one prescribed correction, `--configLoader native`, passed. No default retry is claimed as successful.
- An earlier WSL setup using a Windows-mounted checkout had permission mode `0777`; a `cp` step ran for roughly eight minutes and its specific PID 514 was terminated before test execution. The subsequent native `/tmp` archive/offline-cache baseline is the only Linux test evidence listed above.

## Boundaries and remaining proof

This is not a global-green claim. In particular, it supplies no production deployment, live VM, browser journey, authenticated full-server diagnostic exercise, real-model execution, release activation, or end-to-end Linux test of the diagnostics code.

The diagnostics fresh review reported READY with zero findings. Human review remains required because the locally committed diagnostics diff exceeds 400 lines; Phase integration, deployment, and any Phase 0 completion assertion remain root/human actions.
