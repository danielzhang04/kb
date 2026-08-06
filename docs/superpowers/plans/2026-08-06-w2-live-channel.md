# W2 — Live channel: control bus channel + SSE-driven reads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** run/attempt state changes and live attempt-io lines reach the browser as push events; RunDetail refetches on ticks instead of blind 5s polling; a `useAttemptIo` hook exposes live per-attempt lines for W3/W4 to render.

**Architecture:** mirror the proven `planeA` pattern — a new `control` bus channel with two producers: (1) the armed execution's `attemptIo.onAppend` (per-line deltas, already redacted at W1's write boundary), wired in the execution latch's existing `onChange`; (2) a debounced chokidar watch on `<stateRoot>/control/control-plane.json` (coarse store-change ticks — the store has no subscription seam and W2 does not add one). No store or engine edits.

**Tech Stack:** TypeScript strip-only floor, ESM `.ts` specifiers, vitest, Fastify, chokidar (existing dep), React hooks.

## Global Constraints (spec §2)

- High-frequency output NEVER passes through `control-plane.json`; store writes stay transitions-only (this plan touches neither).
- SSE reconnect must not stampede the read-rate budget: refetch on tick, exponential backoff preserved, base poll stretched (not removed) when SSE is live.
- Frames stay small: one attempt-io entry per frame (W1 caps lines at 8K); the store tick carries no payload.
- tsc baseline exactly 7; suites judged by Errors line + exit code.

---

### Task 1: `control` channel + producers in the hub

**Files:**
- Modify: `server/hub/bus.ts` (HubEvent union :16-21; add helpers after `publishTailDelta` :83)
- Test: `server/hub/bus.test.ts` (extend)

**Interfaces:**
- Consumes: `AttemptIoAppend` type from `../control/attemptIo.ts` (W1: `{attemptRef: string; entry: {seq, t, dir, line}}`).
- Produces (Tasks 2–4 rely on these exact shapes):

```ts
// HubEvent.channel widens to: 'planeA' | 'planeB' | 'control'
export function publishAttemptIoDelta(bus: EventBus, delta: AttemptIoAppend): void;
// → bus.publish({ channel: 'control', kind: 'attempt-io', data: delta })
export function publishControlTick(bus: EventBus): void;
// → bus.publish({ channel: 'control', kind: 'store-change' })
export function wireControlStoreTick(
  bus: EventBus, stateRoot: string, opts?: { debounceMs?: number },
): Promise<FSWatcher>;
// chokidar.watch(join(stateRoot,'control','control-plane.json'), {ignoreInitial:true}) — every
// add/change publishes ONE publishControlTick after debounce (default 250ms, trailing edge).
```

- [ ] **Step 1: failing tests** — extend `bus.test.ts` in its existing style: (a) `publishAttemptIoDelta` delivers `{channel:'control',kind:'attempt-io',data:{attemptRef,entry}}` to a subscriber; (b) `publishControlTick` delivers `{channel:'control',kind:'store-change'}`; (c) `wireControlStoreTick` with a real temp dir: write the file twice within the debounce window → exactly ONE tick after settle (use `debounceMs: 50`, poll-wait ≤2s); a third write after settle → a second tick.
- [ ] **Step 2: run** `npx vitest run server/hub/bus.test.ts` — FAIL (helpers missing).
- [ ] **Step 3: implement** — widen the union; helpers as specified; the watcher mirrors `wirePlaneA`'s fire-and-forget/return-watcher shape (read `watchPlaneA` for the chokidar options idiom).
- [ ] **Step 4: run** — PASS, exit 0.
- [ ] **Step 5: commit** `git commit -am "feat(hub): control channel — attempt-io deltas + debounced store-change ticks"`

---

### Task 2: wire producers at boot and at latch arm/disarm

**Files:**
- Modify: `server/index.ts` (:101 area), `server/http/surface.ts` (ctx construction ~:190-217 + `SurfaceContext` type in `server/http/context.ts` — add optional `hubBus?: EventBus`)
- Test: extend `server/http/surface.test.ts`

**Interfaces:**
- Consumes: `registerHub` return value (already returns the bus, `hub/index.ts:41`); `ActivatedExecution.attemptIo.onAppend` (W1); Task 1 helpers.
- Produces: while execution is armed, every attemptIo append reaches the bus; on disarm the subscription is dropped (no leak, no publish-after-lock). Store tick watcher runs for the daemon lifetime (wired in `index.ts` next to `registerHub`, closed in `onClose` like the planeA watcher).

- [ ] **Step 1: failing test** — in `surface.test.ts`'s context-builder idiom: build a ctx with an injected fake bus + a latch whose fake execution exposes a controllable `onAppend` (capture the callback). Assert: after latch unlock, emitting an append publishes exactly one `control/attempt-io` event on the fake bus; after `lock()`, further appends publish nothing.
- [ ] **Step 2: run** the file — FAIL.
- [ ] **Step 3: implement** — `makeSurfaceContext` accepts `hubBus`; inside the existing `onChange: (execution) => {...}` (surface.ts:207-215): unsubscribe any prior tap (`let offAttemptIo: (() => void) | null` in the closure), then `if (execution && ctx.hubBus) offAttemptIo = execution.attemptIo.onAppend((evt) => publishAttemptIoDelta(ctx.hubBus!, evt))`. In `index.ts`: capture `const bus = registerHub(...)`, pass into the surface context construction, and wire `wireControlStoreTick(bus, stateRoot)` with the same onClose teardown as planeA.
- [ ] **Step 4: run** — PASS; also `npx vitest run server/http/surface.test.ts` full file exit 0.
- [ ] **Step 5: commit** `git commit -am "feat(server): publish attempt-io + store ticks on the control channel across latch lifecycle"`

---

### Task 3: client — control channel in the SSE client + `useAttemptIo` hook

**Files:**
- Modify: `src/lib/sseClient.ts` (CHANNELS :43; `SseDelta` type)
- Create: `src/lib/useAttemptIo.ts`
- Test: `src/lib/useAttemptIo.test.tsx` (new, vitest + testing-library in the repo's component-test idiom), extend `src/lib/sseClient.test.ts` if present

**Interfaces:**
- Consumes: `useSse` (`{last, count}`), W1's REST `GET /api/control/runs/:runRef/attempts/:attemptRef/io?after=` and its `{entries}` body.
- Produces (W3/W4 render from this):

```ts
export interface AttemptIoLine { seq: number; t: string; dir: 'out' | 'in' | 'meta'; line: string; }
export function useAttemptIo(options: {
  runRef: string;
  attemptRef: string | null;      // null → hook is dormant, returns []
  sse: UseSseResult;              // the page's existing useSse('/events') result — ONE stream per page
  fetcher?: typeof fetch;         // DI for tests
  maxLines?: number;              // client-side ring, default 200
}): { lines: AttemptIoLine[]; live: boolean };
```

Behavior: on mount / attemptRef change → one REST catch-up fetch (`after=0`, keep last `maxLines`); on each `sse.last` frame with `channel==='control' && kind==='attempt-io' && data.attemptRef === attemptRef` → append `data.entry` if `entry.seq` > last seen (else ignore; on a GAP — seq jump > 1 — do ONE catch-up fetch with `after=<lastSeen>`); `live` = at least one matching frame seen in the last 15s. Dedup by seq. Ring-cap at `maxLines`.

- [ ] **Step 1: failing tests** — (a) catch-up fetch populates lines; (b) matching SSE frame appends without a fetch; (c) non-matching attemptRef frame ignored; (d) seq gap triggers exactly one `after=<lastSeen>` fetch; (e) ring cap holds.
- [ ] **Step 2: run** `npx vitest run src/lib/useAttemptIo.test.tsx` — FAIL.
- [ ] **Step 3: implement** (add `'control'` to CHANNELS in the same commit — the hook's frames depend on it).
- [ ] **Step 4: run** — PASS; plus `npx vitest run src/lib` exit 0.
- [ ] **Step 5: commit** `git commit -am "feat(ui): control SSE channel + useAttemptIo live-lines hook"`

---

### Task 4: RunDetail — tick-driven refetch

**Files:**
- Modify: `src/views/RunDetail.tsx` (poll loop :774-803, constants :91-92)
- Test: extend `src/views/RunDetail.test.tsx`

**Interfaces:**
- Consumes: `useSse('/events')` (add to this view — it currently imports none), Task 3's channel type only (`store-change` frames; attempt-io frames are W3/W4's concern here).
- Produces: on a `control/store-change` frame → immediate `loadRun` refetch + backoff reset. Base poll interval becomes `RUN_POLL_MS = 5_000` when NO control frame has arrived in the last 60s, else `RUN_SSE_POLL_MS = 30_000` (fallback safety net, not the driver). 429 backoff behavior unchanged.

- [ ] **Step 1: failing test** — in the view test's existing fake-timer/fetch idiom: a `store-change` frame triggers a refetch ahead of the poll schedule; with frames flowing, the background poll fires at the stretched interval.
- [ ] **Step 2: run** the file — FAIL.
- [ ] **Step 3: implement.**
- [ ] **Step 4: run** — PASS; full `npx vitest run src/views/RunDetail.test.tsx` exit 0.
- [ ] **Step 5: commit** `git commit -am "feat(ui): RunDetail rides control ticks — push-driven refetch, stretched fallback poll"`

---

## Wave-close verification (boss)

1. `npx vitest run server/hub server/http/surface.test.ts src/lib src/views/RunDetail.test.tsx` — exit 0 (isolate known load-flakes before believing red).
2. `npx tsc --noEmit` — exactly 7 baseline errors.
3. `git diff origin/main -- dashboard/server/control/store.ts dashboard/server/control/execution.ts` — both EMPTY across the whole branch (spec constraint held through W2).
4. Live smoke on 5317 deferred to W3 (needs a visible surface); transport proof is the surface.test latch-lifecycle test.

## Self-review notes (resolved inline)

- Spec §2 coverage: push channel ✓ (T1/T2), REST catch-up reuse ✓ (T3 uses W1's GET — no new endpoint needed; spec's "catch-up endpoint" satisfied by W1's `after=` param), UI off blind polling ✓ (T4), store-contention constraint ✓ (watcher reads nothing, publishes payload-free ticks).
- Type consistency: `AttemptIoAppend` (W1) is the wire `data` shape; `AttemptIoLine` mirrors W1's `AttemptIoEntry` field-for-field (client-side redeclaration to avoid a server-type import into src/ — matches repo convention of separate Dto shapes).
- No placeholders; every task names its test idiom source file.
