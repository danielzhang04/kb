# W5 — Platform chaining: wire the queue bridge + fyt-runner card doctrine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a card filed with `execution-controller: dashboard` + `owner: dashboard-engine` is claimed by the daemon within one poll tick and driven through the governed engine while execution is armed — making conductor-filed stage cards actually run. The fyt-runner def stops teaching inline `agent()` stages and teaches card filing.

**Architecture:** the bridge (`createQueueBridge` — complete, tested, unwired) is constructed at the surface layer inside the execution latch's `onChange` and lifecycle-bound to the armed window. Its dispatch is `dispatchClaimedCard(ctx, card, {internalCaller})`. The blocking gap: `createInternalServiceCaller` (activation.ts:92-100) throws unless `DASHBOARD_EXECUTION_ACTIVATED === '1'`; under passkey arming it can never mint. W5 extends THAT ONE producer (not a second brand site) to also accept a valid `ExecutionUnlockGrant`, and `buildActivatedExecution` mints the principal at construction so caller lifetime == armed lifetime.

**Tech Stack:** TypeScript strip-only, vitest, existing python-parity card scripts (untouched).

## Global Constraints

- Fail-closed invariants preserved verbatim: locked latch → no principal → no dispatch; STOP/budget preamble gates both the tick AND each dispatch (already in the bridge — do not weaken); `brandInternalServiceCaller` remains called from exactly ONE exported producer.
- Bridge interval ≥15s; tick single-flight (already built).
- No edits to `queueBridge.ts` dispatch logic, `launch.ts`, `store.ts`, `execution.ts`.
- tsc baseline 7; suites judged Errors line + exit code.
- This wave gets a MANDATORY adversarial review before commit (auth boundary) — the boss runs it; the worker just builds.

---

### Task 1: grant-aware internal service caller

**Files:**
- Modify: `server/control/activation.ts` (`createInternalServiceCaller` :92-100; `buildActivatedExecution` — mint at construction, near where the unlock grant is validated ~:318; `ActivatedExecution` interface — add `serviceCaller: InternalServiceCaller`)
- Test: extend `server/control/activation.test.ts` + `activation.boot.test.ts`

**Interfaces:**
- Produces (Task 2 consumes):

```ts
export function createInternalServiceCaller(
  subject?: string,                       // default DASHBOARD_EXECUTOR_SUBJECT
  env?: Record<string, string | undefined>,
  unlockGrant?: unknown,                  // accepted iff isExecutionUnlockGrant(unlockGrant)
): InternalServiceCaller;                 // throws unless env-activated OR grant valid
// ActivatedExecution gains: serviceCaller: InternalServiceCaller
```

`buildActivatedExecution` calls it with `options.unlockGrant` at the same point the grant already gates construction (:318) — the principal exists exactly when execution does. Update the :83-91 doc block to describe BOTH admission paths and why the invariant ("sole producer, unforgeable brand") is unchanged.

- [ ] **Step 1: failing tests** — (a) caller constructible with a latch-minted grant (reuse the suite's existing grant fixture) and env unset; (b) throws with neither; (c) still constructible with env override alone; (d) built execution exposes `serviceCaller` whose `subject === DASHBOARD_EXECUTOR_SUBJECT` and satisfies `isInternalServiceCaller`; (e) gate-off build (`buildActivatedExecution` returning null) mints nothing.
- [ ] **Step 2:** `npx vitest run server/control/activation.test.ts server/control/activation.boot.test.ts` — new FAIL, old PASS.
- [ ] **Step 3:** implement. **Step 4:** both suites exit 0. **Step 5:** commit `git commit -am "feat(control): internal service caller mintable from the execution unlock grant (armed-window lifetime)"`

---

### Task 2: bridge lifecycle at the surface layer

**Files:**
- Modify: `server/http/surface.ts` (latch `onChange` :207-215 — same closure the W2 attemptIo tap lives in), `server/http/context.ts` (if a field is needed for teardown/tests)
- Test: extend `server/http/surface.test.ts`

**Interfaces:**
- Consumes: `createQueueBridge` (`QueueBridgeOptions`: repoRoot, subject, runPy, runPreamble, dispatch, onError), `dispatchClaimedCard(ctx, card, deps)`, Task 1's `execution.serviceCaller`.
- Produces: on arm — `bridge = createQueueBridge({ repoRoot: ctx.repoRoot, runPy: ctx.runPy, runPreamble: ctx.runPreamble, dispatch: (card) => dispatchClaimedCard(ctx, card, { internalCaller: () => execution.serviceCaller }).then(() => undefined), onError: (err) => <audit/log idiom of the file> })`; `bridge.start(QUEUE_BRIDGE_INTERVAL_MS)` (`const QUEUE_BRIDGE_INTERVAL_MS = 15_000`). On disarm/lock — `bridge.stop()`, reference dropped. App close path (`preClose` hook :224-231) also stops it.

- [ ] **Step 1: failing tests** — surface.test idiom with injected fakes: (a) unlock → a fake `createQueueBridge` (injected via a new optional override, mirroring how the suite injects other seams) is constructed with the ctx repoRoot and started at 15_000; (b) its dispatch, invoked with a fake card, calls the injected `dispatchClaimedCard` spy with `internalCaller` yielding the armed execution's `serviceCaller`; (c) lock → `stop()` called exactly once; (d) boot-locked daemon constructs no bridge.
- [ ] **Step 2:** run — FAIL. **Step 3:** implement. **Step 4:** surface suite exit 0. **Step 5:** commit `git commit -am "feat(server): queue bridge lives on the execution latch — armed window = claiming window"`

---

### Task 3: bridge-to-launch integration test

**Files:**
- Test only: extend `server/control/queueBridge.test.ts`

**Interfaces:** none new — this is the end-to-end lock: a temp queue dir with one card fixture (`execution-controller: dashboard`, `owner: dashboard-engine`, `state: inbox`, a Work order body), a bridge whose dispatch is the REAL `dispatchClaimedCard` with stubbed `launch`/`reconcile`/`internalCaller` (the suite already stubs these — follow its existing dispatch tests), driven by one `tick()`. Assert: outcome `launched`, the launch spy received the caller from `internalCaller`, and the reconcile spy fired. Then flip the fixture's owner to `someone-else` → tick discovers nothing.

- [ ] **Step 1:** write both cases (fail if Task 1/2 misassembled anything they consume).
- [ ] **Step 2-4:** run `npx vitest run server/control/queueBridge.test.ts` — exit 0.
- [ ] **Step 5:** commit `git commit -am "test(control): bridge tick → governed launch end-to-end lock"`

---

### Task 4: fyt-runner def — stages are filed cards

**Files:**
- Modify: `agents/fyt-runner.md` (the stage-driving section around :89 — "Each stage in a segment is one `agent()` call…" — and any other `agent()`-stage language; READ THE WHOLE FILE first)
- No test; doc-consistency grep is the check.

Replace the inline-subagent doctrine with card-filing doctrine, preserving the file's voice and ALL of its unrelated laws (single-writer, gates, spend law — untouched):

- Each stage becomes ONE queue card filed per `governance/card-schema.md` on the ops branch: frontmatter `owner: dashboard-engine`, `execution-controller: dashboard`, `state: inbox`, `project`/`action`/`target`/`risk-tier` from the workflow def's stage row; the stage `workOrder` verbatim under `## Work order`.
- File cards in dependency order, one at a time; watch the run on the platform (the card reconciles on launch; run state carries progress); never file a dependent stage before its parent's artifact gate passes.
- The conductor NEVER spawns stage work as in-terminal subagents (`agent()` calls); `agent()` remains legitimate ONLY for the conductor's own fresh-eyes review gates explicitly named elsewhere in the file.
- Keep a pointer note: the mechanics live in `governance/card-schema.md`; the honest three-state review stamp and gate laws are unchanged.

- [ ] **Step 1:** edit. **Step 2:** self-check greps: `grep -n "agent()" agents/fyt-runner.md` shows only review-gate usages; `grep -c "execution-controller" agents/fyt-runner.md` ≥ 1. **Step 3:** commit `git commit -am "docs(agents): fyt-runner drives stages as dashboard-engine queue cards, never inline agent() spawns"`

---

## Wave-close verification (boss, before commit acceptance)

1. `npx vitest run server/control/activation.test.ts server/control/activation.boot.test.ts server/control/queueBridge.test.ts server/http/surface.test.ts` — exit 0.
2. `npx tsc --noEmit` — 7 baseline.
3. **Mandatory opus adversarial review** of the auth-boundary diff (Task 1+2) — refutation targets: forge-a-grant paths, principal outliving the armed window, bridge dispatch after lock, brand producer uniqueness, STOP-mid-batch behavior.
4. Post-merge operational note (W6 checklist, not this wave): the daemon reads `agents/` from the dashboard-ops worktree — sync the def to ops after this branch merges (agents/ main↔ops sync rule), and restart pm2 so the new server code loads.

## Self-review notes (resolved inline)

- Spec §5 coverage: bridge constructed+started by activation lifecycle ✓ (T2 — at the surface layer where ctx lives, which IS the activation lifecycle owner via the latch; spec's "buildActivatedExecution constructs it" amended to the latch closure because dispatchClaimedCard requires SurfaceContext), `dispatchClaimedCard` as dispatch ✓, ≥15s tick ✓, def rewrite ✓ (T4), main↔ops sync flagged ✓.
- The ONE brand producer invariant: `brandInternalServiceCaller` call sites after W5 = still exactly one exported producer (`createInternalServiceCaller`); `buildActivatedExecution` calls the producer, not the primitive.
- Type consistency: `serviceCaller` name used in T1 interface, T2 wiring, T3 assertions.
