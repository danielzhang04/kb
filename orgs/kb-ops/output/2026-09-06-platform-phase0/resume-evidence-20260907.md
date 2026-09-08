# VM-resume evidence — DRAFT

**Fixture-cycle record:** source and coordination drafts only. Nothing here is a deployment, release approval, VM recovery, browser proof, model run, or production result. Phase 0 remains incomplete.

The later plan-only cycle resolved the three planning findings below; see [plan ownership review](plan-ownership-review-20260908.md). Earlier pause statements in this record describe the fixture cycle, not the latest plan verdict.

## Historical 2026-09-07 archive run — retained evidence, not current acceptance

- Reviewed archive SHA-256: `8e4fd59ea86183199a7ad64a4d8bf09be2d4b39e69b2d847c3a0a6c854ae4613`.
- Snapshot basis: `9512f79f` plus the then-reviewed four source/test files. It does not establish the state of the current 09-08 correction archive.
- A fresh native WSL extraction ran the preamble and `npm ci --offline` (293 packages, 8 s). It used Node `v24.19.0` and npm `11.17.0`; repository pins are Node `24.18.0` and npm `11.16.0`. The mismatch was recorded, not waived.
- npm left `node-pty` pending under allow-scripts policy. The harness compiled only locked `node-pty` with npm's installed node-gyp and `/usr/include/node`, then required `spawn`; it did not approve scripts, change policy, lockfiles, or dependencies.
- Historical `unaffected` mode exited 0 after excluding only `server/control/adapters.test.ts`: 363 selected tests passed, plus typecheck/build. Its included suites were spend-grant (11), boot diagnostics (1), store boot diagnostics (4), activation (70), automatic failure reporter (4), store (163), launch (7), queue bridge (92), and real broker integration (11).
- The historical `all` invocation stopped in `adapters.test.ts`: 34 passed, 2 failed because the test expected `0700` but inherited setgid mode `02700`. This was an affected fixture result, not an unaffected-suite success. The current correction cycle below addresses that fixture through its corrected overlay and completed mutation verification.

## Earlier 2026-09-08 fixture correction/review cycle

The user authorized one bounded correction/review cycle. Current source evidence is separate from the historical archive:

- Trusted correction archive: `_private/linux-correction-source-20260908.tar`.
- Trusted archive SHA-256: `6d09d54ab5356a8425f9c5b1b0fb6291fcb153159ad709136dc12f32bc5aa073`.
- Archive basis: `ddadeb073acad732fcc60496016dacd75d38e26b`.
- Overlay: only corrected `dashboard/server/control/adapters.test.ts`, SHA-256 `235e5461fe6810f21722a15405db5418867feec123b9ec3f4df9f7bc43043c1d`.
- Fresh Windows focused command passed in 5.55 s: `npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/control/adapters.test.ts server/control/spendGrantProvision.test.ts` — 47 passed.

Linux run `Y5mujQ` completed the current full selected gate. It used the same observed Node/npm versions as the historical run, which remain mismatched from repository pins. An existing, unchanged unawaited-rejection warning at `adapters.test.ts:511` surfaced; it is outside this source/test correction scope.

| Gate | Current state |
| --- | --- |
| Native Linux full selected suite | PASS — 399 tests: adapters 36, spend-grant 11, boot diagnostics 1, store boot diagnostics 4, activation 70, automatic failure reporter 4, store 163, launch 7, queue bridge 92, real broker integration 11 |
| Typecheck / build | PASS — build transformed 128 modules |
| Linux mutation check | PASS — run `HrOmLA` exited 0. Mutant: 2 failed / 0 passed / 34 pending, both full and sparse held-add assertions observing illicit `02770` instead of the captured `02700` baseline. Restored: 0 failed / 2 passed / 34 pending. |
| Independent remaining-integration work-order review | REQUEST CHANGES — see current findings below |

The independent review found three concrete plan blockers. C still omits `sessionPersistence.ts` and its test from the exact-keys schema/persistence scope. The claim nonce does not transfer durable ownership, and no cross-store bound state proves that an ambiguous landed CAS cannot release a winner's claim. `ledgerRecoveries` is owned only by `RetiredExecution`, which is created at Lock; active-generation settlement needs a per-generation map from construction that Lock retains. The user-authorized correction/review cycle is consumed, so this work order remains WIP and no repair is made here.

The Slice 1A source gate is technically verified by the full 399-test gate and the completed mutation check. The mutation JSON SHA-256 values are mutant `a7c005aa4ea803f323015fd7dd890317cc91ad6328aca9f73750195f0c1524eb` and restored `1eda738c359040a4c7b5cfeb2fdc7c8714a96eea8c02e77f18a25126261c7d7e`. The restored `adapters.ts` checksum matched the original trusted source. JSON evidence is under `_private/linux-gate-evidence/kb-vm-resume-linux-gates.HrOmLA.adapters-held-add.{mutant,restored}.json`; the same directory contains `kb-vm-resume-linux-gates.HrOmLA.log` and its status, scope, and source-archive hash records. The first combined run passed all selected gates but exited 1 before mutation because its LF anchor missed CRLF source; HrOmLA corrected that verifier mismatch and ran only the mutation checks. This cycle changed only the test fixture; verification exercised the dormant source slice without production changes. The full Phase 0 generation fence remains gated regardless of the Slice 1A result.

## Scope limits and external posture

All recorded tests are synthetic/local archive or worktree tests. They do not contact the VM, network, models, credential stores, spend APIs, or production broker services. The isolated broker harness does not prove browser behavior, production recovery, deployment readiness, or VM health.

Root last verified PR #173 as OPEN and draft PRs #176 (source/main) and #177 (coordination/ops) as OPEN. The last 2026-09-07/08 read-only probe observed the VM dashboard failed on release `39197cf5`, broker activity, and tailnet `/healthz` and `/readyz` HTTP 502; this is historical observation, not a current liveness claim. No merge, deploy, runtime cutover, or production mutation was performed in this cycle. Local draft PR bodies are updated for root's existing-draft update flow; this worker does not publish them.
