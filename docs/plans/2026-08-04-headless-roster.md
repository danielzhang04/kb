# Headless Roster Implementation Plan

> **For agentic workers:** executed by codex workers via dispatch-codex, one task per dispatch,
> boss-graded between tasks. Steps use checkbox syntax for tracking. Spec:
> `docs/specs/2026-08-04-headless-roster-design.md` — read it first; it is authoritative.

**Goal:** Replace the PTY/TUI roster executor with headless one-shot-per-work-order workers
(claude `-p` stream-json, codex `exec --json`) with session-resume continuity, two-way stream UI,
and delete the screen-scraping layer.

**Architecture:** Both runtimes implement the existing `WorkerAdapter`/`ManagedSessionAdapter`
interfaces (`execution.ts:121`, `broker.ts:16`). Continuity = runtime session stores keyed by a new
durable per-(run, agent) chain registry. Truth = exit codes + terminal stream events; no screen
inference anywhere.

**Tech stack:** Node 22 (`--experimental-strip-types` — strip-only floor: no enums, parameter
properties, namespaces; ESM `.ts` specifiers), vitest, React (dashboard/src).

## Global constraints

- Branch `claude/headless-roster`, worktree `C:/Users/danie/kb-worktrees/headless-roster`. Workers
  NEVER commit; the boss harvests.
- Env discipline: child env built by `buildChildEnv`/`buildWorkerEnv` allowlist+denylist (strips
  `*_API_KEY`, `ANTHROPIC_API_KEY`); subscription auth only; never print/persist env values.
- Prompt discipline: work order authoritative; stdin only, never argv; foreign text (dependency
  results, operator feedback) only inside an explicit INERT CONTEXT BOUNDARY.
- Permission grammar: only `Read(path)` / `Edit(path)` rules (Glob/Write are dead grammar —
  claude 2.1.221 startup warnings are the authority). `-p` mode does not enforce Read DENY rules;
  secret protection = env denylist + workspace containment, never settings denies.
- Codex exec posture (mirror `scripts/codex_dispatch.py` + `codexLaunchLine`): subscription auth
  (`forced_login_method="chatgpt"`), `--ask-for-approval never` (exec cannot serve approval
  prompts), `--sandbox workspace-write` scoped to the attempt worktree, network + web_search off,
  `mcp_servers={}`.
- Tests: `cd dashboard && npx.cmd vitest run <files>` (PowerShell blocks npx.ps1). Known unrelated
  pre-existing failure: `server/write/workflowRun.test.ts:265` — never "fix" it here.
- Every task: match surrounding doc-comment density and fail-closed style; no new dependencies.

---

### Task 1: `codexExecAdapter.ts` — codex WorkerAdapter

**Files:**
- Create: `dashboard/server/control/codexExecAdapter.ts`
- Create: `dashboard/server/control/codexExecAdapter.test.ts`
- Read first: `dashboard/server/control/claudeWorkerAdapter.ts` (the pattern to mirror),
  `scripts/codex_dispatch.py:101-130` (the proven invocation + JSONL handling),
  `dashboard/server/control/execution.ts:111-145` (interfaces).

**Interfaces:**
- Produces: `createCodexExecAdapter(options: CodexExecAdapterOptions): WorkerAdapter` with
  `options: { spawner?, killTree?, timeoutMs?, maxOutputBytes?, resolveThread?: (runRef: string, agentId: string) => string | null, recordThread?: (runRef: string, agentId: string, threadId: string) => void }`
  (`resolveThread`/`recordThread` are wired to Task 2's registry; default no-ops).
- Consumes: `WorkerAdapter.execute(input)` exactly as `execution.ts:121-145` declares;
  returns `WorkerExecutionResult` (`{state, summary, usage, artifacts, checkpoints, reviewOutcome?}`).

- [ ] Write failing tests with an injected fake spawner (mirror `claudeWorkerAdapter.test.ts`'s
  fake-spawner harness): (1) first turn spawns
  `codex exec - --json --model <model> --sandbox workspace-write --ask-for-approval never -c forced_login_method="chatgpt" -c mcp_servers={} -c sandbox_workspace_write.network_access=false -c web_search="disabled" --cd <worktreePath>`
  with the prompt written to stdin then stdin closed; (2) when `resolveThread` returns an id, the
  argv is `codex exec resume <threadId> -` plus the same pinned `-c` flags and `--json`; (3) the
  emitted thread/session id parsed from the JSONL stream is passed to `recordThread`; (4) nonzero
  exit → `state:'failed'` with stderr tail in summary; (5) timeout kills the tree and fails; (6)
  output past `maxOutputBytes` kills and fails; (7) a stream that never yields a terminal result
  event → failed, never succeeded. Derive the exact JSONL event names by reading how
  `codex_dispatch.py` extracts the final message and thread id — encode those names in the tests.
- [ ] Run: `npx.cmd vitest run server/control/codexExecAdapter.test.ts` — expect FAIL (module
  missing).
- [ ] Implement, reusing `buildWorkerEnv` from `claudeWorkerAdapter.ts` for env and the
  `runTrackedProcess` kill/cap discipline (copy the pattern, do not import private helpers if not
  exported — export them from claudeWorkerAdapter if trivially reusable rather than duplicating).
- [ ] Run the test file — expect PASS; also run
  `npx.cmd vitest run server/control/claudeWorkerAdapter.test.ts` — unchanged PASS.
- [ ] Report per dispatch-codex convention (boss commits).

### Task 2: `agentSessionChains.ts` — durable per-(run, agent) continuity registry

**Files:**
- Create: `dashboard/server/control/agentSessionChains.ts`
- Create: `dashboard/server/control/agentSessionChains.test.ts`
- Read first: `dashboard/server/control/atomicJsonDocument.ts` (the storage primitive to reuse),
  `dashboard/server/control/spendGrant.ts` (an existing small durable store to mirror).

**Interfaces:**
- Produces: `createAgentSessionChainStore(stateRoot: string): AgentSessionChainStore` with
  `get(runRef: string, agentId: string): ChainEntry | null`,
  `record(runRef: string, agentId: string, entry: {runtime: 'claude'|'codex', sessionId: string}): void`,
  `ChainEntry = {runtime: 'claude'|'codex', sessionId: string, updatedAt: string}`.
  Document location: `<stateRoot>/control/agent-session-chains/<runRef>.json`.
- Consumed by: Task 1 (`resolveThread`/`recordThread`), Task 3 (claude `--resume` wiring and
  binding-first-turn decision: chain absent → this spawn's first stdin message is the binding
  context + work order; chain present → work order only, resumed session already holds binding).

- [ ] Write failing tests: get on empty store → null; record→get roundtrip; re-record overwrites
  and bumps `updatedAt`; entries isolated per runRef file; corrupt JSON in an existing file →
  fail-closed throw (mirror `ClaudeProjectTrustError` style with its own error class); concurrent
  record calls (two stores, same file) both land (atomic document semantics).
- [ ] Run — expect FAIL. Implement on `atomicJsonDocument.ts`. Run — expect PASS.

### Task 3: Headless-primary wiring in `activation.ts` + codex manager sessions

**Files:**
- Modify: `dashboard/server/control/activation.ts` (worker/manager construction, ~lines 199-215,
  317-330, 420-460, 505-515)
- Create: `dashboard/server/control/codexSessionAdapter.ts` (+ `.test.ts`) — manager-role sibling
  of `claudeSessionAdapter.ts`, running the SAME engine as Task 1 but implementing
  `ManagedSessionAdapter.start(spec, observer)` (`broker.ts:16-21`): map each JSONL event through
  `normalizeOperationalEvent` to redacted `PublicOperationalEvent`s, call `observer.onExit` on
  child exit, `ManagedChild.stop()` kills the tree.
- Modify: `dashboard/server/control/rosterSessions.ts` ONLY at `createRosterWorkerAdapter`
  consumers — do not delete machinery yet (Task 6).
- Test: extend `dashboard/server/control/activation.test.ts` + `activation.boot.test.ts`.

**Interfaces:**
- Consumes: Task 1 `createCodexExecAdapter`, Task 2 chain store, existing
  `createClaudeWorkerAdapter`/`createClaudeSessionAdapter`.
- Produces: profile-routed adapters — a stage/session whose `ExecutionProfile.runtime` is `codex`
  gets the codex adapters, `claude` gets the claude adapters; `createRosterWorkers` and the
  `ptyHost`/`ptySessions` gate are no longer consulted for workers or managers (activation no
  longer requires a PTY stack to run a roster proposal — delete the `proposalUsesCodexRoster`
  refusal at ~510).

- [ ] Write failing activation tests: codex-profile stage executes via the codex adapter (fake
  spawners injected through the existing `deps` seam); claude-profile stage via claude adapter
  with `--resume` argv when a chain entry exists and binding-first-turn stdin when it does not;
  manager sessions route by runtime the same way; activation succeeds with NO ptyHost/ptySessions
  supplied.
- [ ] Run — expect FAIL. Implement. Run activation + boot + broker test files — expect PASS.

### Task 4: Two-way operator messaging to workers

**Files:**
- Modify: `dashboard/server/control/routes.ts` (mirror the
  `/api/control/runs/:runRef/manager/messages` route at :903 with
  `/api/control/runs/:runRef/agents/:agentId/messages`)
- Modify: `dashboard/server/control/claudeWorkerAdapter.ts` (expose a
  `postMessage(text: string): boolean` on the running child — encodes via
  `encodeStreamJsonUserMessage` and writes to live stdin; returns false when no turn is live)
- Modify: `dashboard/server/control/agentSessionChains.ts` (add
  `queueMessage(runRef, agentId, text)` / `drainMessages(runRef, agentId): string[]` — drained
  messages are prepended to the next turn's stdin inside an INERT CONTEXT BOUNDARY, mirroring
  `claudeWorkerAdapter.ts`'s existing boundary constant)
- Test: routes test + adapter tests.

**Interfaces:**
- Produces: route body `{message: string}` → 202 `{delivery: 'live'|'queued'}`; codex always
  `queued`; claude `live` iff a turn is executing.
- Consumes: Task 2 store, Task 3 wiring.

- [ ] Failing tests: route auth (session-gated like :903), live inject path (fake child stdin
  records the encoded frame), queue path persists and drains into next spawn's stdin inside the
  boundary, codex always queues.
- [ ] Run FAIL → implement → run PASS.

### Task 5: Run Canvas stream tiles

**Files:**
- Modify: `dashboard/src/views/RunCanvas.tsx` (replace `TileTerminal` xterm attach with a stream
  transcript view fed by the run's public events; add the message box calling Task 4's route)
- Modify: `dashboard/src/views/RunCanvas.test.tsx`
- Read first: how `ManagedRuns.tsx` fetches run events (`getRun`/`/api/control/runs/:runRef/events`).

**Interfaces:**
- Consumes: existing public-events endpoint (`routes.ts:584`) + Task 4 message route.
- Produces: per-agent tile = scrolling transcript of that agent's redacted events + input box with
  per-runtime delivery hint ("queued for next turn" when the POST returns `queued`).

- [ ] Failing component tests: tile renders events for its agent only; send box POSTs to the agent
  message route and renders the `queued`/`live` hint; no WebSocket/xterm imports remain in the
  file.
- [ ] Run FAIL → implement → run PASS. Keep `Terminal.tsx` untouched.

### Task 6: Deletion sweep — the screen layer dies

**Files:**
- Modify: `dashboard/server/control/rosterSessions.ts` + `.test.ts` — delete: launch-line
  builders, `CLAUDE_/CODEX_*_MARKERS`, `detectRepl*`/`detectRuntimeRepl*`, boot handshake +
  `ready.json` scaffold, delivery-line typing + engagement proof, screen windows
  (`stripForScreenWindow`, `currentFrame`, `SCREEN_WINDOW_*`), `createRosterSessionManager`'s PTY
  spawning, `createRosterWorkerAdapter`. What remains (per spec): whatever scaffold the headless
  adapters still consume — if nothing, delete the file and its imports entirely.
- Modify: `dashboard/server/control/activation.ts`, `http/surface.ts`, `http/context.ts`,
  `workflows/compile.ts`, `workflows/defs.ts` — remove now-dead roster imports/options.
- Delete: uncommitted `claudeProjectTrust.ts`(+test) if still present on the branch; delete
  `codexDirectoryTrust.ts`(+test) ONLY if the Task 7 probe proved exec has no trust wall —
  otherwise keep and wire it into `codexExecAdapter`.
- Test: full control-plane suite.

- [ ] Grep-gate before finishing: `grep -rn "READY_MARKERS\|detectRepl\|ready.json\|deliveryLine\|ptyHost" dashboard/server/control/` returns only PTY-host references owned by the manual
  Terminal path (`pty/`, `http/` wiring for `/api/pty`).
- [ ] Run `npx.cmd vitest run server/control/` — all pass except the known workflowRun.test.ts:265.
- [ ] `npx.cmd vitest run src/` for the dashboard UI suite — pass.

### Task 7: Probes + live acceptance (boss-run, not dispatched)

- [ ] Probe A (before Task 1 lands — actually run FIRST, results feed Tasks 1/6): in a scratch
  dir outside kb, run `codex exec - --json` with a trivial prompt via a fresh ConPTY-free
  subprocess; record (1) whether any trust/onboarding output appears, (2) the JSONL event names
  for thread id + final message. Save transcript to the session scratchpad.
- [ ] Probe B: two-turn claude chain — `claude -p --output-format stream-json` then
  `claude -p --resume <sessionId>`; verify second turn recalls first-turn context; record session
  id event shape.
- [ ] Probe C: mid-turn stdin injection into a live `-p --input-format stream-json` turn.
- [ ] Acceptance: stop stuck run-01812bb6 + old daemon; restart isolated daemon from this branch;
  Daniel unlocks; launch thin-slice **all-codex** (switch the isolated def's profileIds to
  worker/manager codex tiers), walk G0→G3b, paid images+audio via route, render, verify, ≤$1.50
  ceiling; then boot the claude-profile variant clean. Evidence: control-plane states + artifacts
  under `videos/<slug>/`, spend journal.

## Self-review notes

- Spec coverage: engine (T1-T3), orders/results+binding (T2/T3), governance unchanged (constraint
  block + T3 keeping adapters' env/tool caps), UI (T4/T5), deletions (T6), acceptance/probes (T7).
- Type consistency: `WorkerAdapter`/`WorkerExecutionResult`/`ManagedSessionAdapter` names copied
  from source; chain-store signatures defined once in T2 and consumed by name in T1/T3/T4.
- Probe A deliberately precedes implementation — JSONL event names in T1 tests come from evidence,
  not invention.
