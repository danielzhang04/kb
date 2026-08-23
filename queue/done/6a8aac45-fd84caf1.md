---
schema-version: 1
id: 6a8aac45-fd84caf1
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\AppData\Local\kb-codex-dispatch\worktrees\6a8a8c35-07ee12c4
risk-tier: T1
owner: codex-worker
claim-token: 9a3831c29007f8d1
state: done
approval: null
workflow: 01a02d76-2f17-7aa0-96af-dc99a00f6945
depends-on: []
variant-group: null
role: work
session-id: 6a8a9d31-e40b2754
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 542c404700ef6cfc6a7931ccede91ec29fb62ef4
---

## Work order

\# Task — P3 W2b: REWORK of the Linux broker / WSL oracle after adversarial review

Same worktree (your 13 W2 files are untracked; leave them so). Never commit. Failing-first test per
item. Rules: `C:/Users/danie/AppData/Local/Temp/claude/C--Users-danie-kb/833beb04-ca1f-4739-9250-95c23e464b7d/scratchpad/dv3-p3-builder-common.md`
(read once). **Ceiling 80 min; at 70 min stop with a compiling tree, run the checkpoint, report what
is left.** READ: the review in full —
`C:/Users/danie/AppData/Local/Temp/claude/C--Users-danie-kb/833beb04-ca1f-4739-9250-95c23e464b7d/scratchpad/detached-p3-W2-review.out`
— it is the specification for this round; your 13 files; W0 `dashboard/shared/ptyProtocol.ts` (broker
frame unions, `recipe`/`relativeCwd` fields — by range) + `ptyProtocolVectors.ts`; plan §3 "Wire and
transport bounds" + "Launcher and filesystem policy" (lines 249–327), §5 W6.2 (431–435, for the exact
`ExecStart`/runtime-state/account facts your main must honour), §7 WSL gate (501–517). First edit by
command 10.

\## Boss ruling on review blocker 6
W0 wins: the client sends W0's `recipe` + `relativeCwd` (+ model where W0 allows it); the broker owns
the recipe → argv/env mapping and an APPROVED MODEL TABLE (closed list, not a regex); anything outside
the table ⇒ §3 refusal. Ignore the previous brief's "opaque recipe id" wording.

\## Blockers (all required)
B1. **Process interface.** `linuxBrokerMain` accepts exactly `--socket-fd=3 --protocol-version=kb-shell-broker/v1`
   (plan §5 W6.2 `ExecStart`) and `--print-protocol-version` (prints exactly `kb-shell-broker/v1`, exit 0);
   any other fd, extra arg, missing arg, or a non-socket fd 3 ⇒ exit non-zero with a one-line reason;
   NO pathname bind fallback (delete it). Tests: argv matrix; fd 3 not a socket ⇒ refusal; print-version
   exact bytes.
B2. **TOCTOU-safe fd pinning.** Traverse from the pinned root dirfd with `O_NOFOLLOW|O_DIRECTORY` per
   component (openat-style; Node: open each component relative to the previous fd, `fs.openSync` with
   path under `/proc/self/fd/<n>/` is acceptable on Linux — document the primitive), validate exact
   owner/gid/mode per root from the plan's policy table (02770 worktree parents are VALID per plan —
   fix the group-writable rejection), pin every interpreter/entrypoint component (node binary, main.js,
   shim), and launch from the pinned fds. Tests (Windows-portable via a fake fs that records open order
   + the WSL oracle for the real thing): symlink swap between check and open ⇒ refused; a swap of an
   ancestor ⇒ refused; launch never uses a pathname after the pin.
B3. **Crash/orphan safety.** Durably record the session (runtime state) BEFORE ack and BEFORE the child
   is exposed; contain the child so restart can find it by verified identity (cgroup path or
   `/proc/<pid>/stat` start-time + pgid match, not bare PID); restart cleanup kills only verified
   identities. Tests: crash between spawn and persistence (fake: persistence throws) ⇒ child killed,
   no ack; PID reuse (fake: same pid, different start-time) ⇒ not killed.
B4. **Bounded durable receipts.** Receipts are retained for idempotency with a bound consistent with
   the 16-session limit (e.g. remove on exit after the close ack is delivered, keep the last N
   terminal receipts); >16 sequential create/exit cycles across a restart keep working. Test it.
B5. **The WSL oracle runs the built broker.** `tests/test_pty_linux_oracle.py` must: build the broker
   (`npx tsc -p tsconfig.pty-broker.json` → the outDir your tsconfig declares; plan names
   `dist-server/kb-shell-broker/main.js`) or use it if present; launch `node main.js --socket-fd=3
   --protocol-version=kb-shell-broker/v1` with a real `AF_UNIX` listening socket passed as fd 3; drive
   the REAL decoder/launcher/state through the socket (hello, create with a W0 recipe, input/output,
   over-bound input refusal, list/drain, epoch loss, restart with orphan kill, peer-uid refusal with a
   second uid if available else skip-with-reason for that ONE selector); a dashboard fixture PROCESS
   (a small Python client process that is killed and restarted — not a reconnect) with a zero-orphan
   assertion after BOTH dashboard restart and broker restart. Dedicated fixture uid; explicit
   no-systemd/no-production-uid disclaimer stays. On Windows every selector skips with the declared
   reason; nothing is a source-text assertion.

\## Majors (all required)
M1. Backpressure: input over high-water ⇒ pause the socket (`socket.pause()`) until drained, refuse
   only beyond the hard cap; ALL outbound sends honour `socket.write() === false` (ack/error frames
   included) with a bounded pending queue ⇒ detach/close the slow client when exceeded. Tests.
M2. Binary input preserved byte-for-byte to `node-pty.write` (Buffer path; no UTF-8 decode). Test with
   `0xff`.
M3. Service identity: main resolves the exact expected uids/gids (`kb-shell` effective, `kb-dashboard`
   peer) by name via the plan's policy and refuses root / wrong gid / mismatched peer; the expected
   dashboard uid is NOT derived from the socket owner. Tests (fake identity resolver).
M4. `brokerProtocol.test.ts:32-36`: pass `vector.frame` (not the wrapper) so all 26 invalid vectors
   really hit the decoder; assert the specific refusal per vector.
M5. Epoch tests: client test creates a session, then an old-epoch frame after drain is refused; server
   test asserts `killOrphan` was called with the verified identity; late exit after drain suppressed
   exactly once.
M6. Probe typing: `ProbeResult.reason` is the W0 closed union (no `string`); uid/gid checks mandatory;
   a production `SO_PEERCRED` path test in the WSL oracle.

\## Minor
m1. `loadRuntimeState` enforces the 262,144-byte limit via `fstat` size before reading.

Checkpoint (paste numbers): `cd dashboard; npm run typecheck; npx vitest run server/pty/brokerProtocol.test.ts
server/pty/fdPinnedPaths.test.ts server/pty/linuxBrokerClient.test.ts server/pty/linuxBrokerServer.test.ts
server/pty/brokerProbe.test.ts --maxWorkers=2; npx tsc -p tsconfig.pty-broker.json; cd ..;
py -3 -m pytest tests/test_pty_linux_oracle.py -q -rs`. The boss runs the oracle on WSL after you report.
Final message ≤ 30 lines: per item file:line + test; the pinning primitive used; oracle selector list;
numbers; anything not done + why.

## Result

Implemented the full rework without committing; the tree remains exactly the original 13 untracked W2 files.

- B1: exact fd-3 CLI and version output — `linuxBrokerMain.ts:276`; argv/non-socket tests `linuxBrokerServer.test.ts:65`.
- B2: fd-chain pinning, closed model table, `02770` policy — `fdPinnedPaths.ts:63,247`; swap/order tests `fdPinnedPaths.test.ts:77,110`.
- B3: durable-before-ack and verified `{pid,pgid,startTimeTicks}` cleanup — `linuxBrokerServer.ts:324`, `linuxBrokerMain.ts:206`; tests `linuxBrokerServer.test.ts:97,169,225`.
- B4: receipts removed after terminal delivery — `linuxBrokerServer.ts:422`; 21-cycle restart test `linuxBrokerServer.test.ts:245`.
- B5: built-JS namespace oracle — `test_pty_linux_oracle.py:74,96`; real fd 3, decoder, launcher, state, dashboard process, restart and peer credentials.
- M1: pause/resume and bounded outbound queue — `linuxBrokerServer.ts:273,431`; tests `linuxBrokerServer.test.ts:188,288`.
- M2: binary `Buffer` path — `linuxBrokerMain.ts:174`; `0xff` test `linuxBrokerServer.test.ts:114`.
- M3: named non-root UID/GID enforcement — `linuxBrokerMain.ts:43`; test `linuxBrokerServer.test.ts:88`.
- M4: vectors now pass `vector.frame` with refusal checks — `brokerProtocol.test.ts:33`.
- M5: real old-epoch/drain and verified orphan assertions — `linuxBrokerClient.test.ts:60`, `linuxBrokerServer.test.ts:169`.
- M6: closed probe reason and mandatory UID/GID — `brokerProbe.ts:14,28`; tests `brokerProbe.test.ts:12,23` plus oracle peer selector.
- m1: `fstat` before reading runtime state — `linuxBrokerMain.ts:118`; oversized-state test `linuxBrokerServer.test.ts:105`.
- Pinning primitive: root dirfd followed by `/proc/self/fd/<dirfd>/<component>` with `O_NOFOLLOW|O_DIRECTORY`; symlinks use pinned `O_PATH|O_NOFOLLOW`; launch uses proc-fd paths only.
- Oracle selectors: socket UID, Unix/network, roots, traversal, fd swap, recipe refusal, input bounds, epoch loss, peer UID, dashboard/broker zero-orphans.
- Checkpoint: typecheck exit 0; Vitest **5 files / 25 tests passed**; broker `tsc` exit 0; pytest **10 skipped on Windows**, all with the declared Linux reason.
- Native WSL execution remains for the boss; systemd and production-UID proof remain explicitly P7-only.
- Growth-log append was not written: that coordination write requires `ops`, while this task forbids branch/commit changes and requires exactly 13 untracked files.
