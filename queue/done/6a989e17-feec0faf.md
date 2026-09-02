---
schema-version: 1
id: 6a989e17-feec0faf
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\dv3-gate
risk-tier: T1
owner: codex-worker
claim-token: 6fe211de58619540
state: done
approval: null
workflow: 01a0641a-f8d3-7be1-9b6a-013f0c36d8ad
depends-on: []
variant-group: null
role: work
session-id: 6a989a3d-881c6cf7
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: e70645693afd878001a33c624342ab29cd7c6cce
---

## Work order

\# W17 — real-broker integration harness for the attempt-start vertical (Linux-only test, you write it, the boss runs it under WSL)

Checkout: `C:\Users\danie\kb-worktrees\dv3-gate` (origin/main e7064569) with the attempt-vertical patch
applied. ANOTHER worker is editing production files concurrently; you write EXACTLY ONE new file
`dashboard/server/pty/realBroker.integration.test.ts` (plus, if unavoidable, one helper
`dashboard/server/pty/realBrokerHarness.ts`) and touch nothing else. No commits, no git writes; ASCII
only; no TS parameter properties / enums / namespaces. You are on Windows: you CANNOT run this test
(it needs Linux + node-pty); `npx.cmd tsc --noEmit -p .` from `dashboard/` MUST pass. Guard the whole
suite with `describe.skipIf(process.platform !== 'linux')` so Windows CI skips it cleanly.

\## Why
Four review rounds found walls that fake hosts hid: frame sequencing (real hosts number frames as
counters, the transcript API expects byte offsets), broker protocol encode/decode of mapped keys,
`hello`/epoch handling, real output volume, real exit. This harness runs the REAL broker server, REAL
broker client, REAL protocol, REAL registry + persistence + validator, and the REAL
`createAttemptSessionAdapter` over a REAL Unix socket with a REAL node-pty child. Only two things are
substituted: the launcher (a bash script instead of the claude CLI, so no `fdPinnedPaths` root-owned
validation) and the Linux `LinuxBrokerMain` process wrapper (we construct `LinuxBrokerServer` in-process).

\## READ BUDGET (closed; first write by command 15; stop at 70 min and report)
- `dashboard/server/pty/linuxBrokerServer.ts` — constructor options (launcher, epochId, expectedClientUid/
  Gid, makeSessionId, log, persist path/recovery), `accept(socket, peer)`, how sessions are launched
- `dashboard/server/pty/linuxBrokerMain.ts` 200-350 — how the real launcher spawns node-pty and how the
  listener hands accepted sockets + peer identity to `accept` (mirror that, with `peer = {uid: process.getuid(),
  gid: process.getgid()}`)
- `dashboard/server/pty/linuxBrokerClient.ts` — constructor options (`connect`, `dashboardEpochId`, ids)
- `dashboard/server/pty/sessionRecord.ts` (registry factory), `sessionPersistence.ts` (persistence factory
  over a temp dir; the validator), `pty/contracts.ts`
- `dashboard/server/control/attemptSessionAdapter.ts` 60-120 (options) and
  `dashboard/server/control/attemptVertical.integration.test.ts` (COPY its wiring for registry/persistence/
  adapter/declaration; do not import test-only fakes from it unless exported)
- `dashboard/server/pty/linuxBrokerServer.test.ts` — grep how existing tests construct the server with an
  in-memory duplex (≤120 lines) and whether a node-pty launcher is exercised anywhere
Forbidden: everything else.

\## The test (single `describe`, sequential `it`s sharing one broker)
1. Start `LinuxBrokerServer` with: a real launcher that spawns node-pty for `/bin/bash` with args
   `['-c', 'echo READY; for i in 1 2 3 4 5; do printf "line-%s-%s\\n" $i "$(head -c 300 /dev/zero | tr "\\0" x)"; done; read -r REPLY; echo "GOT:$REPLY"; exit 7']`
   (ignore the recipe's executable — assert it is the shape the adapter sends, then spawn bash), a fixed
   `epochId`, `expectedClientUid/Gid = process.getuid()/getgid()`, a temp state path, no-op log.
   Listen on a temp Unix socket path via `net.createServer` and call `server.accept(socket, peer)` per
   connection. Start `LinuxBrokerClient` with `connect: () => net.connect(path)`.
2. Real registry + persistence (validator on) over a temp dir; real adapter with `host = client`,
   `bindings/sessionRecords = registry`, `sessionHostKind: 'vm'`, a claude declaration with TWO prompts
   (the second prompt text must appear as `GOT:<prompt>` in output).
3. `begin` with `operationKey: 'automatic-attempt:attempt-real-1'` → receipt ok; wait for exit code 7.
   Assert: the transcript `.raw` file bytes CONTAIN `READY`, all five `line-N-xxx…` lines (≈1.5 KB), and
   `GOT:` + second prompt; record `transcript.lastSequence === byteLength(file)`; the operation record is
   host-keyed (`op-` + sha256 of the control key) — read the persisted document to prove it; the session
   row ends `exited` with `exitCode: 7`; retention can evict it; NO refusal anywhere (spy every `ok:false`).
4. Replay: `begin` again with the same control key while a second, still-live attempt
   (`automatic-attempt:attempt-real-2`, script `sleep 30`) exists → the replay returns ok without a second
   host create for key 1; then cancel attempt-real-2 by control key → child gone (poll `ps`/`kill -0`),
   row `exited`/`closed`.
5. Broker epoch change: stop the broker server, start a new one with a different `epochId` on the same
   path (client reconnects lazily via your resilience fix); a new `begin` (attempt-real-3) succeeds, the
   document's `epochId` updates, prior-epoch rows are abandoned by production activation (no hand call).
6. Protocol adversary: send a raw frame with `relativeCwd: '..'` from a second raw socket → per-request
   refusal and the broker connection for the ADAPTER's client is unaffected (attempt-real-4 still starts).
Timeouts: 30 s per `it`. Clean up: kill children, close sockets, remove temp dirs in `afterAll`.

\## Report (≤40 lines)
Exact wiring (which real classes, which two substitutions), every assertion with the wall it guards,
`tsc` tail, and what you could not verify on Windows. The boss runs it under WSL (`~/kb-v3`) and pastes
results back; expect a follow-up.

## Result

Implemented [realBroker.integration.test.ts](C:/Users/danie/kb-worktrees/dv3-gate/dashboard/server/pty/realBroker.integration.test.ts).

Wiring:

- Real `LinuxBrokerServer` and `LinuxBrokerClient` over a Unix socket.
- Real session registry, persistence validator, transcript retention, protocol, and attempt adapter.
- Substitutions only: node-pty launches the specified Bash fixture instead of Claude; the broker server runs in-process instead of through `LinuxBrokerMain`.

Assertions cover:

- Adapter launch-spec mapping and real node-pty execution.
- `READY`, five 300-byte lines, and `GOT:SECOND-REAL-PROMPT`.
- Frame-counter-to-byte-offset translation and exact transcript byte length.
- SHA-256 host-keyed operation persistence.
- Exit code 7, terminal row state, and retention eviction.
- Idempotent replay without another host creation.
- Cancellation, child-process death via `kill(pid, 0)`, and closed persistence state.
- Lazy reconnect, epoch update, and automatic stale-row abandonment.
- Recoverable unsafe-CWD protocol refusal while the adapter connection remains usable.
- Spied production paths produce no unexpected `ok:false` results.

Verification:

- `npx.cmd tsc --noEmit -p .` — exit 0, no output.
- Windows Vitest collection — 4 tests skipped cleanly.
- ASCII and diff checks passed.
- No commit or other file changes made.

The Linux/node-pty execution itself remains unverified here and needs the planned WSL run.
