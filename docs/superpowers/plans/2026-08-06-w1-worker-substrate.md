# W1 — Worker substrate: per-attempt live JSONL + injection audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every governed attempt's worker I/O is live-followable from disk (redacted, capped, append-only JSONL per attempt), and operator message injection is journaled as a run event.

**Architecture:** a new `attemptIo` store module owns the on-disk JSONL and an in-process `onAppend` seam (W2's bus will subscribe to it). Both worker adapters tap their existing stdout/stdin paths into it. The existing injection route gains one `appendEvent` call. The `finalize()`/summary engine contract is untouched.

**Tech Stack:** TypeScript (Node 24 native TS, ESM `.ts` specifiers, no enums/namespaces — repo "strip-only floor"), vitest, Fastify. All paths relative to `dashboard/`.

## Global Constraints (from spec §1)

- Redaction at the WRITE boundary: every line passes `redactSensitiveText` (from `server/composer/publicTimeline.ts`) + NUL-strip BEFORE disk or callback. Never at render time.
- Attempt-io lives at `<stateRoot>/control/attempt-io/<attemptRef>.jsonl` — NEVER inside `control-plane.json`.
- Caps mirror the PTY recorder ethos: default 512_000 bytes per attempt, drop-oldest; flush ≤2s.
- Engine result contract (`WorkerExecutionResult`, `finalize()`, `boundSummary`) unchanged.
- tsc baseline is exactly 7 pre-existing errors; vitest suites must pass with exit 0 judged on the Errors line + exit code, not counts.
- Workers never commit; the boss ports and commits. (Executor note: commit steps below are for the boss/inline executor; a dispatched codex worker leaves the tree for the boss.)

---

### Task 1: `attemptIo` store module

**Files:**
- Create: `server/control/attemptIo.ts`
- Test: `server/control/attemptIo.test.ts`

**Interfaces:**
- Consumes: `redactSensitiveText` from `../composer/publicTimeline.ts`.
- Produces (relied on by Tasks 2–5 and W2):

```ts
export type AttemptIoDir = 'out' | 'in' | 'meta';
export interface AttemptIoEntry { seq: number; t: string; dir: AttemptIoDir; line: string; }
export interface AttemptIoAppend { attemptRef: string; entry: AttemptIoEntry; }
/** Narrow write-side seam the adapters receive — keeps adapters ignorant of read/subscribe. */
export interface AttemptIoSink { append(attemptRef: string, dir: AttemptIoDir, line: string): void; }
export interface AttemptIoStore extends AttemptIoSink {
  read(attemptRef: string, afterSeq?: number, limit?: number): AttemptIoEntry[];
  onAppend(cb: (evt: AttemptIoAppend) => void): () => void; // returns unsubscribe
  stop(): void; // flush everything, clear timers
}
export function createAttemptIoStore(options: {
  root: string;                  // e.g. join(stateRoot, 'control', 'attempt-io')
  maxBytesPerAttempt?: number;   // default 512_000
  flushMs?: number;              // default 2_000
}): AttemptIoStore;
```

- [ ] **Step 1: Write failing tests** — `server/control/attemptIo.test.ts`:

```ts
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createAttemptIoStore } from './attemptIo.ts';

const root = () => mkdtempSync(join(tmpdir(), 'attempt-io-'));

describe('attemptIo store', () => {
  it('appends redacted JSONL lines with monotonic seq and reads them back after a given seq', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0 });
    store.append('attempt-1', 'out', 'hello');
    store.append('attempt-1', 'in', 'steer left');
    const all = store.read('attempt-1');
    expect(all.map((e) => [e.seq, e.dir, e.line])).toEqual([[1, 'out', 'hello'], [2, 'in', 'steer left']]);
    expect(store.read('attempt-1', 1).map((e) => e.line)).toEqual(['steer left']);
    store.stop();
  });

  it('redacts recognized secrets and strips NULs at the write boundary', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0 });
    // sk-ant token shape is what redactSensitiveText recognizes (see composer/publicTimeline.ts)
    store.append('a', 'out', 'key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789012345678901234-AA \0end');
    const [entry] = store.read('a');
    expect(entry.line).not.toContain('sk-ant-');
    expect(entry.line).not.toContain('\0');
    store.stop();
  });

  it('drops oldest lines beyond the byte cap but keeps seq monotonic', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0, maxBytesPerAttempt: 200 });
    for (let i = 0; i < 50; i++) store.append('a', 'out', `line-${i}-${'x'.repeat(20)}`);
    const entries = store.read('a');
    expect(entries.length).toBeLessThan(50);
    expect(entries.at(-1)?.line).toContain('line-49');
    const seqs = entries.map((e) => e.seq);
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
    store.stop();
  });

  it('persists to <root>/<attemptRef>.jsonl and survives reopen', () => {
    const dir = root();
    const store = createAttemptIoStore({ root: dir, flushMs: 0 });
    store.append('run-1__s1__a1', 'out', 'persisted');
    store.stop();
    expect(existsSync(join(dir, 'run-1__s1__a1.jsonl'))).toBe(true);
    const reopened = createAttemptIoStore({ root: dir, flushMs: 0 });
    expect(reopened.read('run-1__s1__a1').map((e) => e.line)).toEqual(['persisted']);
    reopened.stop();
  });

  it('rejects attemptRefs that are not single filename-safe segments', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0 });
    expect(() => store.append('../evil', 'out', 'x')).toThrow();
    expect(() => store.read('a/b')).toThrow();
    store.stop();
  });

  it('notifies onAppend subscribers with the redacted entry and honors unsubscribe', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0 });
    const seen: string[] = [];
    const off = store.onAppend((evt) => seen.push(`${evt.attemptRef}:${evt.entry.dir}:${evt.entry.line}`));
    store.append('a', 'meta', 'started');
    off();
    store.append('a', 'meta', 'unseen');
    expect(seen).toEqual(['a:meta:started']);
    store.stop();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run server/control/attemptIo.test.ts` from `dashboard/`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `server/control/attemptIo.ts`** — single responsibility: redact → in-memory ring per attempt (entries + byte total, drop-oldest) → buffered fd append (flush timer `flushMs`, `flushMs: 0` = synchronous writes for tests) → emit to subscribers. `read` on an attempt not in memory lazily loads the file (parse JSONL, tolerate a truncated last line). Filename-safety: reuse the `OWNER_RE`-style check inline: `/^[A-Za-z0-9._-]+$/` (mirror `launch.ts:52` rationale comment). Drop-oldest applies to memory AND rewrites the file on cap-hit at flush time (compaction on flush, not per append).
- [ ] **Step 4: Run to verify pass** — same command. Expected: PASS, exit 0, Errors line clean.
- [ ] **Step 5: Commit** — `git add server/control/attemptIo.ts server/control/attemptIo.test.ts && git commit -m "feat(control): attemptIo store — redacted, capped, live-followable per-attempt JSONL"`

---

### Task 2: claude adapter taps into attemptIo

**Files:**
- Modify: `server/control/claudeWorkerAdapter.ts` (options interface ~line 170; `start()` body ~lines 686–812)
- Test: extend `server/control/claudeWorkerAdapter.test.ts`

**Interfaces:**
- Consumes: `AttemptIoSink` from Task 1.
- Produces: `ClaudeWorkerAdapterOptions.attemptIo?: AttemptIoSink` (optional — absent means no tap, all existing tests unaffected). Write points, all through one local helper `tap(dir, text)` that no-ops when the option is absent:
  - each COMPLETE stdout line → `append(input.attemptRef, 'out', line)` (buffer partial chunks; flush the remainder at finalize as a final 'out' line if non-empty);
  - initial stdin payload frames, queued-operator frames, and every live `postMessage` frame → `append(input.attemptRef, 'in', <the prompt text, NOT the JSON envelope>)`;
  - finalize → `append(input.attemptRef, 'meta', 'exit code=<code> disposition=<succeeded|failed|timeout|output-cap|cancelled>')`.

- [ ] **Step 1: Write failing tests** — in the existing suite's style (fake `ClaudeSpawner`), add:

```ts
it('taps stdout lines, injected messages, and exit disposition into attemptIo', async () => {
  const taps: Array<{ ref: string; dir: string; line: string }> = [];
  const adapter = createClaudeWorkerAdapter({
    ...baseOptions(),
    attemptIo: { append: (ref, dir, line) => taps.push({ ref, dir, line }) },
  });
  // fake spawner emits two stream-json lines split across three chunks, then exits 0
  // (reuse the suite's existing fake-process pattern; emit '{"type":"assistant"', ',"x":1}\n{"type":"result","subtype":"success"}\n')
  const pending = adapter.execute(baseInput({ attemptRef: 'a-1' }));
  adapter.postMessage(baseInput().runRef, agentIdOf(baseInput()), 'steer');
  fakeProc.exit(0);
  await pending;
  expect(taps.some((t) => t.ref === 'a-1' && t.dir === 'out' && t.line.includes('"type":"assistant"'))).toBe(true);
  expect(taps.some((t) => t.dir === 'in' && t.line === 'steer')).toBe(true);
  expect(taps.at(-1)).toMatchObject({ dir: 'meta' });
});
```

(Adapt `baseOptions`/`baseInput`/fake-process helpers to whatever the existing test file actually names them — read the file first; it already has a fake spawner harness. The partial-line chunking assertion matters: two chunks that form one JSON line must produce ONE 'out' entry.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run server/control/claudeWorkerAdapter.test.ts`. Expected: FAIL, unknown option / no taps recorded.
- [ ] **Step 3: Implement** — add the option, a `lineBuffer` string per execution, split on `\n` in the `onStdout` handler BEFORE the existing `stdoutChunks.push` (do not alter cap/byte accounting), tap 'in' at the three stdin write sites (`bindingStdin`/queued/`workOrderStdin` decompose: tap the human-readable prompt argument of each `encodeStreamJsonUserMessage` call — bind a tiny wrapper `writeFrame(promptText)` to avoid duplicating), tap 'meta' inside `finalize()` after disposition is known. All taps inside try/catch: an attemptIo failure must NEVER fail the worker.
- [ ] **Step 4: Run to verify pass** — full file: `npx vitest run server/control/claudeWorkerAdapter.test.ts`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit** — `git commit -am "feat(control): claude worker adapter taps live attempt-io (out/in/meta)"`

---

### Task 3: codex adapter taps into attemptIo

**Files:**
- Modify: `server/control/codexExecAdapter.ts` (its stdout accumulation ~lines 264–363; options interface at top)
- Test: extend `server/control/codexExecAdapter.test.ts`

**Interfaces:**
- Consumes: `AttemptIoSink` (Task 1).
- Produces: `CodexExecAdapterOptions.attemptIo?: AttemptIoSink` — same three write points as Task 2, except there is no live 'in' path (codex delivery is queued-only per `activation.ts:453-457`): queued messages included in the spawn payload are tapped 'in' once at start.

- [ ] **Step 1: Write failing test** — mirror Task 2's shape against this file's existing fake-process harness (stdout lines → 'out' entries with partial-chunk joining; start-payload queued messages → 'in'; exit → 'meta').
- [ ] **Step 2: Run to verify failure** — `npx vitest run server/control/codexExecAdapter.test.ts`.
- [ ] **Step 3: Implement** — same `tap()` helper pattern; never throw into the worker path.
- [ ] **Step 4: Run to verify pass** — same command, exit 0.
- [ ] **Step 5: Commit** — `git commit -am "feat(control): codex exec adapter taps live attempt-io"`

---

### Task 4: activation wiring — construct the store, thread the sink

**Files:**
- Modify: `server/control/activation.ts` (worker construction ~lines 430–450; `ActivatedExecution` interface ~line 160; teardown path)
- Test: extend `server/control/activation.boot.test.ts`

**Interfaces:**
- Consumes: `createAttemptIoStore` (Task 1); adapter options (Tasks 2–3).
- Produces: `ActivatedExecution.attemptIo: AttemptIoStore` (exposed so routes in Task 6 and W2's bus wiring can reach `read`/`onAppend`); store constructed once per activation at `join(stateRoot, 'control', 'attempt-io')`; `stop()` called on the existing deactivation/teardown path next to the other singletons.

- [ ] **Step 1: Write failing test** — in `activation.boot.test.ts`'s existing builder pattern: assert `buildActivatedExecution(...)` result exposes `attemptIo` with `read`/`onAppend`/`append`, and that the claude/codex worker factory deps received an `attemptIo` option (the suite already injects fake `createWorkers` — capture its options argument).
- [ ] **Step 2: Run to verify failure** — `npx vitest run server/control/activation.boot.test.ts`.
- [ ] **Step 3: Implement** — construct, thread into both `deps.createWorkers`/`deps.createCodexWorkers` option objects, expose on the returned `ActivatedExecution`, stop on teardown.
- [ ] **Step 4: Run to verify pass** — plus the neighbor suite: `npx vitest run server/control/activation.test.ts`.
- [ ] **Step 5: Commit** — `git commit -am "feat(control): activation constructs attemptIo store and threads the sink to both worker adapters"`

---

### Task 5: injection audit event on the agent-messages route

**Files:**
- Modify: `server/control/routes.ts` (the `POST /api/control/runs/:runRef/agents/:agentId/messages` handler, ~lines 957–980)
- Test: extend the routes suite file that already covers this endpoint (locate with `grep -rn "agents/:agentId/messages\|agent-message" server/control/*.test.ts server/*.test.ts` — extend THAT file in its idiom)

**Interfaces:**
- Consumes: `ctx.controlStore.appendEvent(subject, runRef, input)` (`store.ts:5142`), `boundSummary` from `./claudeWorkerAdapter.ts`.
- Produces: on BOTH `'live'` and `'queued'` delivery outcomes, exactly one event:

```ts
ctx.controlStore.appendEvent(sub, runRef, {
  kind: 'message', source: 'human',
  stageRef: stageOfAssignment.stageRef,
  status: null,
  summary: boundSummary(`operator → ${agentId} (${delivered}): ${message}`),
});
```

(`stageOfAssignment` = the stage found by the existing assignment lookup in the handler — capture the stage, not just its `.assignment`.) The 202 response body is unchanged apart from delivery already present; a failed `appendEvent` must not fail the delivery response — log-and-continue (`auditFn` idiom if present in this file, else swallow with a comment).

- [ ] **Step 1: Write failing test** — extend the endpoint's existing happy-path test: after a delivered message, `listEvents` for the run contains one `kind:'message', source:'human'` event whose summary contains the message text and the agent id.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** (capture stage in the find; append after successful deliver).
- [ ] **Step 4: Run to verify pass** — the whole routes suite file, exit 0.
- [ ] **Step 5: Commit** — `git commit -am "feat(control): journal operator agent-message injections as run events"`

---

### Task 6: REST read endpoint for attempt-io

**Files:**
- Modify: `server/control/routes.ts` (add GET alongside the run-scoped reads, near `GET /api/control/runs/:runRef` handlers)
- Test: same routes suite file as Task 5

**Interfaces:**
- Consumes: `ctx.executionLatch?.current()?.attemptIo` (Task 4); run/subject validation identical to sibling run-scoped GETs.
- Produces (W3/W4 read this): `GET /api/control/runs/:runRef/attempts/:attemptRef/io?after=<seq>&limit=<n>` → `200 {entries: AttemptIoEntry[]}`; 401 unauthenticated; 404 unknown run (subject-scoped) or attempt not belonging to the run; `409 {error:'attempt-io-unavailable'}` when no activation. `limit` clamped to 500 default / 2000 max. Attempt-belongs-to-run check: the run detail's `attempts` list contains `attemptRef` (`RunDetailDto`).

- [ ] **Step 1: Write failing tests** — 200 shape with `after` windowing; 404 for an attemptRef of a different run; 409 when latch empty.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — routes suite exit 0, then the full server/control sweep: `npx vitest run server/control` (known baseline flakes per repo memory: canonicalResultEmbeddedPython timeout — reproduce-isolated before believing red).
- [ ] **Step 5: Commit** — `git commit -am "feat(control): read endpoint for per-attempt live io"`

---

## Verification at wave close (boss runs, not the worker)

1. `npx vitest run server/control` — exit 0 judged on Errors line (isolate known flakes before believing red).
2. `npx tsc --noEmit` — exactly the 7 baseline errors, nothing new.
3. Grep proof the engine contract is untouched: `git diff origin/main -- server/control/execution.ts` is EMPTY (no engine edits anywhere in W1).
4. Spec §1 acceptance: a fake-spawner adapter test demonstrates out/in/meta lines land redacted in a real temp attempt-io file (Task 2 + Task 1 integration covered by Task 4's boot test wiring).

## Self-review notes (run after drafting — resolved inline)

- Spec coverage: §1 transcript ✓ (T1–T4), §1 injection-audit ✓ (T5), §1 caps/redaction ✓ (T1), read path for W3/W4 ✓ (T6). §1 "refused when attempt not running" — NOT re-implemented: the existing route's 409-when-unavailable + adapter's settled-guard already covers it; spec amended accordingly.
- Type consistency: `AttemptIoSink`/`AttemptIoStore`/`AttemptIoEntry` names used identically in T1/T2/T3/T4/T6.
- No placeholders: every step carries code or an exact command; T2/T3 direct the worker to the existing fake harness by name rather than inventing parallel helpers.
