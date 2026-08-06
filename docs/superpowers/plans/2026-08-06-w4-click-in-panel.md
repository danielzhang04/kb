# W4 — Click-in panel: expanded workings + input + inline gates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** clicking an agent card in the running graph opens that agent's expanded workings directly beneath it: full live stream, a message box that types into the governed worker (session-gated, journaled — the W1/W2 stack), and its open human gates answerable inline.

**Architecture:** composition, not construction — RunDetail already owns `postAgentMessage` (:286-334), the gate respond flow with revision-CAS (`respond`, :950-970; decision buttons ~:1135), and run data. W4 extracts the two reusable pieces into shared modules and mounts them in a new `AgentWorkPanel` wired to W3's `onOpenPanel`. The panel is a stream view, not a PTY (spec §4 doctrine: distinct governed register).

**Tech Stack:** React, vitest + testing-library, strip-only TS.

## Global Constraints

- Existing RunDetail/graph test cases pass UNMODIFIED (extractions must be behavior-preserving).
- No new endpoints; the panel speaks only `postAgentMessage`'s POST, `respondToHumanRequest`, and W2's `useAttemptIo`.
- Composer disabled (with an honest hint) when: no session, or the agent has no live/queued-capable attempt (its overlay state is terminal: succeeded/failed/stopped) — delivery outcome text ('live' vs 'queued for next turn') surfaces after send, mirroring the 202 body.
- One panel open at a time; Escape and an explicit × both close; panel state is view-local (no routing change).
- tsc baseline 7; `vite build` clean.

---

### Task 1: extract shared modules (behavior-preserving)

**Files:**
- Create: `src/control/agentMessages.ts` (move `postAgentMessage` from `src/views/RunDetail.tsx:286-334` verbatim, exporting `postAgentMessage(runRef, agentId, text, token, request?)` and its result type; RunDetail imports it)
- Create: `src/components/HumanRequestCard.tsx` (lift the open-request markup + respond controls RunDetail renders around :1100-1140 into `HumanRequestCard({request, busy, onRespond})` where `onRespond(decision: HumanRequestDecision, response: string)`; RunDetail's open-requests section renders this component with its existing `respond` handler)
- Modify: `src/views/RunDetail.tsx` (imports + section swap only)
- Test: existing `RunDetail.test.tsx` is the lock — run it UNMODIFIED and green; add one shallow render test per new module file (`src/control/agentMessages.test.ts` mocks fetch and asserts URL/body/headers; `src/components/HumanRequestCard.test.tsx` asserts decision buttons call onRespond with typed response text)

- [ ] **Step 1:** write the two new-module tests (they fail: modules absent).
- [ ] **Step 2:** run them + `npx vitest run src/views/RunDetail.test.tsx` (currently green — baseline).
- [ ] **Step 3:** extract; RunDetail behavior identical.
- [ ] **Step 4:** all three files green, RunDetail suite UNMODIFIED and green.
- [ ] **Step 5:** commit `git commit -am "refactor(ui): extract agentMessages client + HumanRequestCard (behavior-preserving)"`

---

### Task 2: `AgentWorkPanel`

**Files:**
- Create: `src/components/AgentWorkPanel.tsx`
- Test: `src/components/AgentWorkPanel.test.tsx`
- Modify: `src/styles/views/workflows.css` (panel styles beside W3's `v-mini-tail` block, both themes)

**Interfaces:**
- Consumes: `useAttemptIo` (W2), `AttemptMiniTail` is NOT reused here — the panel renders its own full stream list (same row treatment, `lines: 200`); `postAgentMessage` + `HumanRequestCard` (Task 1); `AgentRunOverlay` + run dto (W3 shapes).
- Produces (Task 3 mounts it):

```ts
export function AgentWorkPanel(props: {
  runRef: string;
  agentId: string;                    // '' = unresolved group → panel shows stream/gates only, no composer
  run: RunDetailDto;
  overlay: AgentRunOverlay | undefined;
  sse: UseSseResult;
  onClose: () => void;
}): React.JSX.Element;
```

Sections, in order: (1) header — agent name, overlay state chip (reuse `v-agent-state--*`), close ×; (2) **stream** — `useAttemptIo({runRef, attemptRef: overlay?.attemptRef ?? latestAttemptRefOfAgent(run, agentId), sse, maxLines: 200})`, auto-scroll-to-bottom on append unless the user scrolled up (track via a `nearBottom` ref on scroll events), rows: `dir==='in'` prefixed `› ` + accent, `meta` dimmed; empty state text "no live output for this agent yet"; (3) **gates** — `run.humanRequests` open items whose `stageRef` ∈ this agent's stages → `HumanRequestCard` each, wired to the SAME respond flow RunDetail uses (the panel receives `onRespond` pre-bound per request from its mount point — add an `onRespondRequest(request, decision, response)` prop to keep CAS/refetch logic in RunDetail); (4) **composer** — textarea + Send calling `postAgentMessage`, disabled per Global Constraints, after-send status line from the delivery result. `latestAttemptRefOfAgent`: newest attempt (by createdAt) across the agent's stages — export it from `src/control/runGraph.ts` (one small addition + unit test there).

- [ ] **Step 1: failing tests** — stubbed hook + fetch: stream renders rows with in/meta treatment; composer disabled without session and on terminal overlay; send posts and surfaces 'queued for next turn'; gate card rendered only for this agent's stages and respond bubbles up; unresolved agentId hides composer.
- [ ] **Step 2:** run — FAIL. **Step 3:** implement (+ `latestAttemptRefOfAgent` in runGraph.ts with test). **Step 4:** panel + runGraph suites green. **Step 5:** commit `git commit -am "feat(ui): AgentWorkPanel — live stream, governed composer, inline gates"`

---

### Task 3: mount in RunDetail behind graph clicks

**Files:**
- Modify: `src/views/RunDetail.tsx` (selected-agent state; pass `onOpenPanel` into the W3 `runOverlay` prop; render panel directly beneath the graph head; Escape handler)
- Test: extend `src/views/RunDetail.test.tsx` (new cases only)

**Interfaces:**
- Consumes: W3's `runOverlay.onOpenPanel` seam (already typed, currently undefined), Task 2 panel.
- Produces: click agent header → panel for that agent (one at a time); click another card → panel swaps; × or Escape → closed; panel's `onRespondRequest` delegates to RunDetail's existing `respond` (so CAS conflict handling and refetch stay in one place).

- [ ] **Step 1: failing tests** — click node header (testid `workflow-agent-node-<id>` header) → panel visible scoped to that agent; second click swaps; Escape closes; a gate answered through the panel invokes the same store update path the section flow uses (spy on `respondToHumanRequest`).
- [ ] **Step 2:** run — FAIL. **Step 3:** implement. **Step 4:** RunDetail suite (old cases unmodified) + graph suite green. **Step 5:** commit `git commit -am "feat(ui): click-in expanded workings — graph card opens AgentWorkPanel"`

---

## Wave-close verification (boss)

1. `npx vitest run src/control src/components src/views/RunDetail.test.tsx src/views/WorkflowAgentGraph.test.tsx src/views/WorkflowDetail.test.tsx` — exit 0.
2. `npx tsc --noEmit` — 7 baseline; `npx vite build` clean.
3. Doctrine check (spec §4): panel is a stream view — grep proof no `ConsolePane`/`/api/pty` import anywhere in the new files.

## Self-review notes (resolved inline)

- Spec §4 coverage: expanded workings ✓ (T2 stream), input box → existing injection stack ✓ (T2 composer via extracted client), inline answerable gates ✓ (T2/T3 via extracted card + delegated respond), distinct governed register ✓ (styles + no-PTY grep), codex read-only caveat surfaces naturally ('queued for next turn' outcome).
- Consistency: `AgentRunOverlay`/`onOpenPanel` names match W3; `latestAttemptRefOfAgent` lives in runGraph.ts beside its sibling selectors.
- The completion-gate reservation (routes.ts:1502 — review-lineage CAS) is untouched: those gates already refuse the generic respond route server-side; the card surfaces the 409 error text as-is.
