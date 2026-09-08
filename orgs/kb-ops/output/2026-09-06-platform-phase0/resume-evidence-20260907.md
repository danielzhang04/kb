# VM-resume Linux verification evidence — DRAFT

**Status:** focused synthetic Linux verification only. This is not a deployment, release approval, VM recovery, browser proof, or real-model execution result.

## Source and execution boundary

- Reviewed snapshot archive SHA-256: `8e4fd59ea86183199a7ad64a4d8bf09be2d4b39e69b2d847c3a0a6c854ae4613`.
- Snapshot basis: `9512f79f` plus the four reviewed source/test files. The current worktree also contains WIP `1ba6d038` and plan `246b342f`; neither is represented as a deployment claim here.
- The runner extracted the archive into a fresh native WSL `/tmp/kb-vm-resume-linux-gates.miRPJe` directory, ran the repository preamble, and used `npm ci --offline` from the existing cache (293 packages, 8 s).
- Executor versions were Node `v24.19.0` and npm `11.17.0`; repository pins are Node `24.18.0` and npm `11.16.0`. This mismatch was recorded, not waived.
- npm left `node-pty` pending under its allow-scripts policy. The harness explicitly compiled only the locked `node-pty` package using npm's installed node-gyp and `/usr/include/node`, then required its `spawn` capability. It neither approved package scripts nor changed npm policy, the lockfile, or dependencies.

## Observed unaffected mode

`linux-verification.sh <trusted-git-archive> <evidence-directory> unaffected` exited 0. It intentionally excluded only `server/control/adapters.test.ts`; this is a scoped result and never a full-gates acceptance.

| Gate | Result |
| --- | --- |
| `spendGrantProvision.test.ts` | 11 passed |
| `bootDiagnostics.test.ts` | 1 passed |
| `storeBootDiagnostics.test.ts` | 4 passed |
| `activation.test.ts` | 70 passed |
| `automaticFailureReporter.test.ts` | 4 passed |
| `store.test.ts` | 163 passed |
| `launch.test.ts` | 7 passed |
| `queueBridge.test.ts` | 92 passed |
| `realBroker.integration.test.ts` | 11 passed on Linux with the compiled native dependency |
| Typecheck / build | passed; Vite transformed 128 modules |

The selected test total was **363 passed**. The runner used `--configLoader native`, `--no-cache`, one worker, and no file parallelism.

## Paused adapter result and limitations

The initial `all` invocation stopped at `server/control/adapters.test.ts`: 34 passed and 2 failed. Both failures expected mode `0700` after forward-admission revocation but observed inherited setgid mode `02700`. No repair or retry is authorized; `unaffected` excludes that one file only.

The synthetic tests use local archive code and deterministic test processes. They do not contact the VM, network, models, credential stores, or a spend API, and they do not touch a production broker service; the broker tests start an isolated test server. They do not establish browser behavior, production state recovery, or deploy readiness.

## Coordinator-observed platform status

Windows verification was reported as 79 containment tests and 47 adapter tests. PR #173 remains open. Under the user's narrow status-check authorization, the VM dashboard was failed on release `39197cf5`, the broker was active, and tailnet `/healthz` and `/readyz` returned 502. No deployment or recovery mutation was performed.
