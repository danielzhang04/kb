# Live run graph — design spec (2026-08-06)

**Goal state (Daniel's words):** whenever a workflow run launches, the operator sees the running
graph; any agent card in that graph can be clicked into to see its expanded workings; when not
clicked in, each card shows a small, live, in-chain view of the agent working.

**Ruling recorded (2026-08-06, Daniel):** governed stage workers become INTERACTIVE — the operator
may type into them, because human gates live in-band. This formally SUPERSEDES the 2026-08-05
doctrine line "governed RunDetail never hosts a terminal." The companion doctrine "chat sessions
never look governed" stands unchanged.

**Substrate decision (Daniel, this session):** Option B — governed workers stay HEADLESS
(stream-json), interactivity is stdin message injection. Rejected: Option A (full PTY/TUI workers)
— it degrades result parsing to ANSI scraping and breaks governance extraction.

## Base findings this design stands on (recon, file:line verified)

- Governed worker adapters (`server/control/claudeWorkerAdapter.ts:693-812`,
  `codexExecAdapter.ts:264-363`) buffer stdout in memory and keep only a ≤60KB redacted summary at
  completion. No on-disk transcript, nothing live-followable.
- The hub (`server/hub/`) serves `/events` (SSE) + `/ws` but production traffic is only `planeA`
  queue-file ticks; the `planeB` tail channel's sole producer (`server/timeline/stream.ts`) is dead
  code. The control plane never publishes to the bus.
- `WorkflowAgentGraph.tsx` builds one-card-per-agent purely from the static def (`agentGroups`,
  :225-289); no run overlay exists. `RunDetail.tsx` polls 5s→60s backoff; per-agent `AgentTile`
  badges exist but are event-starved (one lifecycle event per attempt).
- PTY chat sessions already have the target read-path shape: non-exclusive `observe()` tap →
  `createTranscriptRecorder` → `<stateRoot>/pty/transcripts/<id>.log` + read-only REST tail
  (`server/pty/sessionRunRoutes.ts:126-148`). Governed attempts have none of it.
- `createQueueBridge` (`server/control/queueBridge.ts:169`) is complete — preamble-gated tick,
  python-parity card scan, `dispatchClaimedCard` → `executeApprovedLaunch` — but has NO production
  caller. Cards with `execution-controller: dashboard` are never claimed.
- State model needs no rework: `Run/Stage/Attempt` states include `waiting-human`;
  `HumanRequest{kind: input|approval|review|intervention|governance-refusal}` already exists.

## Architecture

### 1. Worker substrate (per-attempt live I/O)

- Adapters write each stdout line to an append-only per-attempt JSONL:
  `<stateRoot>/control/attempt-io/<attemptRef>.jsonl` (new dir; NOT inside `control-plane.json`).
  Line shape: `{t: iso, dir: 'out'|'in'|'meta', line: <redacted string>}`.
- **Redaction at the write boundary:** the same redaction used by `boundSummary` is applied
  per-line BEFORE the line touches disk or the bus. A worker echoing env can never leak a key into
  a transcript or a browser.
- Caps mirror the PTY recorder: drop-oldest at a byte cap per attempt; flush ≤2s.
- **Input injection:** adapters keep the worker's stdin open (`--input-format stream-json`).
  New engine entry `injectAttemptInput(attemptRef, text, caller)`:
  - callable ONLY with a verified WebAuthn session (same gate as launch) — no internal-caller path;
  - appends a `dir:'in'` JSONL line AND an `OperationalEvent{kind:'operator-input'}` on the run
    (audit trail: steering is run history, not a side channel);
  - refused when the attempt is not `running`/`waiting-human`.
- The existing summary/result contract at `finalize()` is UNCHANGED — engine semantics identical.

### 2. Live channel (push, not poll)

- New bus channel `control` alongside `planeA`/`planeB`: the control plane publishes
  (a) state transitions (run/stage/attempt/humanRequest — ref + new state only, no payloads) and
  (b) attempt-io deltas (attemptRef + appended lines, already redacted).
- High-frequency output NEVER passes through `control-plane.json` (it is one atomic JSON blob;
  store writes stay state-transitions-only).
- REST read-path for catch-up/deep-links: `GET /api/control/attempts/:attemptRef/io?after=<n>`.
- UI: RunDetail and the run graph subscribe over the existing `/events` SSE; poll loop remains
  only as a fallback (SSE gap → refetch), honoring the read-rate budget.

### 3. Running graph (run mode)

- `WorkflowAgentGraph` gains an optional run overlay prop: `{runDetail}` — same `agentGroups`
  keying, each agent card decorated with: state badge (derived from its stages' states, worst-first
  precedence: failed > waiting-human > running > ready/blocked > succeeded), and a **mini-tail**:
  the last ~3 redacted `attempt-io` lines of that agent's current attempt, live via the `control`
  channel. Cards with an open `HumanRequest` show a gate chip.
- Launching a run (any path — operator launch surface or queue bridge) lands the operator on the
  run-scoped graph view (`RunDetail` gains the graph as its head section, replacing the static
  step strip as the primary visual).
- Def view (Workflows → Flow tab) is untouched when no run is selected.

### 4. Click-in (expanded workings)

- Clicking an agent card opens that agent's expanded panel: full structured stream (rendered from
  attempt-io JSONL, streaming), the input box (wired to `injectAttemptInput`; disabled when
  unauthenticated or attempt not accepting input), and any open `HumanRequest` for its stages
  rendered inline and answerable (existing human-request resolve endpoint).
- The panel is a stream view, not a PTY. ConsolePane remains chat-session-only ("chat sessions
  never look governed" holds — and governed panels get a distinct visual register).

### 5. Platform chaining (queue bridge live)

- `buildActivatedExecution` constructs `createQueueBridge({repoRoot, dispatch: dispatchClaimedCard
  (bound to the activated engine), runPreamble})` and `start()`s it whenever the engine is armed
  (unlock grant or env override); `stop()` on disarm/shutdown. Interval conservative (≥15s), tick
  already single-flight + preamble-gated (STOP file/budget refusals short-circuit).
- `agents/fyt-runner.md` stage-driving section rewritten: stages are filed as queue cards
  (`execution-controller: dashboard`, `owner: dashboard-engine`, Work order per card-schema) —
  never inline `agent()` calls. Same fix mirrored to the main-checkout copy per the agents/
  main↔ops sync rule.

### 6. Doctrine + acceptance

- `dashboard/docs/` doctrine note + this spec record the supersession (§Ruling above).
- Acceptance = the paused slice run (`2026-08-06-slice-test`) resumed: conductor files stage
  cards → bridge claims → engine runs governed attempts → operator watches the running graph,
  opens an agent mid-run, types a steering message (visible in run events), answers a human gate
  from the panel, and the run completes its bounded slice. Every phase also carries unit tests in
  the existing suites (vitest; tsc baseline = exactly 7 known errors).

## Non-goals (this arc)

- No PTY for governed workers (Option A rejected).
- No cross-runtime interactive console for codex chat agents (existing backlog, unchanged).
- No sliding session renewal, no remote access (existing backlog).
- No new polling loops; no third state store.

## Risks / constraints

- **Rate budget:** SSE-driven refetch must not recreate the 429 lockout — deltas ride the push
  channel; REST refetch only on reconnect.
- **Store contention:** `control-plane.json` is one atomic document — output volume must bypass it
  (attempt-io files + bus only). State transitions remain the only store writes.
- **Secrets:** redaction is at the write boundary (§1), not the render boundary.
- **codex workers:** `codexExecAdapter` has no stdin contract equal to claude's stream-json input;
  injection lands claude-runtime first, codex documented as read-only stream + gate-answer via
  HumanRequest until its injection path is proven.
