# W3 — Running graph: run-mode overlay on WorkflowAgentGraph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an active run renders as the agent graph — per-agent state badge, open-gate chip, and a 3-line live mini-tail on each card — as the head section of RunDetail; the def-only Flow view is byte-identical when no overlay props are passed.

**Architecture:** run state is projected into graph-shaped data by pure selectors (`entryFromRun`, `overlaysFromRun`) so `WorkflowAgentGraph` stays one component with optional overlay props. Mini-tails ride W2's `useAttemptIo` (signal-driven, authed fetches). No new endpoints, no server changes.

**Tech Stack:** React + reactflow (existing), vitest + testing-library, TypeScript strip-only floor.

## Global Constraints

- Def-only mode untouched: every new prop optional; existing `WorkflowAgentGraph`/`WorkflowDetail` tests must pass UNMODIFIED (they are the regression lock).
- One `useSse('/events')` stream per page — RunDetail already owns one after W2; thread its result down, never open a second.
- Badge precedence (spec §3), worst-first: `failed` > `waiting-human` > `running` > `ready` > `blocked` > `stopped`/`interrupted` > `succeeded`.
- tsc baseline exactly 7; suites judged on Errors line + exit code.

---

### Task 1: pure selectors — `entryFromRun` + `overlaysFromRun`

**Files:**
- Create: `src/control/runGraph.ts`
- Test: `src/control/runGraph.test.ts`

**Interfaces:**
- Consumes: the run detail shape RunDetail already fetches (`RunDetailDto`: `run{runRef, managerAssignment, state}`, `stages[]{stageRef, stageId, title, dependsOn, state, assignment, currentAttemptRef}`, `attempts[]{attemptRef, stageRef, state}`, `humanRequests[]{stageRef, state}` — read `src/control/` dto definitions and `src/views/RunDetail.tsx` usage first and match the REAL field names).
- Produces (Task 2/4 rely on these exact shapes):

```ts
export type AgentRunState =
  | 'failed' | 'waiting-human' | 'running' | 'ready' | 'blocked' | 'stopped' | 'interrupted' | 'succeeded';
export interface AgentRunOverlay {
  state: AgentRunState;          // worst-first fold of the agent's stages
  openGate: boolean;             // any open HumanRequest on one of its stages
  attemptRef: string | null;     // current attempt of its active stage (running > waiting-human priority), else null
}
/** Rebuild the WorkflowDefEntry-shaped input agentGroups() needs, from a live run. */
export function entryFromRun(run: RunDetailDto): WorkflowDefEntry;
/** Key = the same group key agentGroups() derives (agentId or '' for unresolved). */
export function overlaysFromRun(run: RunDetailDto): Record<string, AgentRunOverlay>;
```

`entryFromRun` maps run stages → `entry.stages` (id=stageId, title, dependsOn, resolvedAssignment from the run's frozen `assignment`) and the run's `managerAssignment` → `entry.manager`/`entry.resolvedManager`, mirroring the field names `agentGroups(entry)`/`stageSlot(stage)` actually read (`src/views/WorkflowAgentGraph.tsx:225-289` — READ IT FIRST; the selector must produce keys identical to the def path so positions/edges/grouping are stable).

- [ ] **Step 1: failing tests** — fixture run with 3 stages across 2 agents + manager: (a) `entryFromRun` groups identically to a hand-built def entry (compare `agentGroups()` output keys); (b) precedence: agent with `succeeded`+`running` stages → `running`; with `waiting-human`+`running` → `waiting-human`; with any `failed` → `failed`; (c) `openGate` true only for the agent whose stage has an open request; (d) `attemptRef` picks the running stage's `currentAttemptRef`, null when the agent is entirely `succeeded`.
- [ ] **Step 2: run** `npx vitest run src/control/runGraph.test.ts` — FAIL.
- [ ] **Step 3: implement** (pure functions, no React).
- [ ] **Step 4: run** — PASS exit 0.
- [ ] **Step 5: commit** `git commit -am "feat(ui): runGraph selectors — entryFromRun + overlaysFromRun"`

---

### Task 2: `AttemptMiniTail` component

**Files:**
- Create: `src/components/AttemptMiniTail.tsx`
- Test: `src/components/AttemptMiniTail.test.tsx`

**Interfaces:**
- Consumes: `useAttemptIo` (W2 — `{runRef, attemptRef, sse, maxLines}` → `{lines, live}`).
- Produces (Task 3 renders it; W4 reuses it at full height):

```ts
export function AttemptMiniTail(props: {
  runRef: string; attemptRef: string; sse: UseSseResult; lines?: number; // default 3
}): React.JSX.Element;
// Renders <div className="v-mini-tail" data-testid={`mini-tail-${attemptRef}`}>:
//  - last `lines` entries, mc-mono, one per row: dir 'in' rows prefixed '› ' (operator), 'meta' rows dimmed
//  - a live dot (className 'v-mini-tail__live') present only while hook reports live
//  - nothing at all (null) while the hook has no lines yet
```

- [ ] **Step 1: failing tests** — with a stubbed `useAttemptIo` (vi.mock the module): renders last-3 of 5 lines newest-last; '›' prefix on in-rows; live dot toggles with `live`; null when no lines.
- [ ] **Step 2: run** — FAIL. **Step 3: implement** (+ minimal styles in the stylesheet the components dir already uses — find where `v-workflow-agent` classes live and add `v-mini-tail` beside them, both themes). **Step 4: run** — PASS. **Step 5: commit** `git commit -am "feat(ui): AttemptMiniTail live component"`

---

### Task 3: overlay props on `WorkflowAgentGraph` + `AgentNode`

**Files:**
- Modify: `src/views/WorkflowAgentGraph.tsx` (props :569-581, `AgentNodeData` construction :587-605, `AgentNode` :458-555)
- Test: extend `src/views/WorkflowAgentGraph.test.tsx` (new cases ONLY — existing cases unmodified)

**Interfaces:**
- Consumes: Task 1 overlay shape, Task 2 component, W2 `UseSseResult`.
- Produces (Task 4 passes these):

```ts
// WorkflowAgentGraph gains optional props:
runOverlay?: {
  runRef: string;
  overlays: Record<string, AgentRunOverlay>;
  sse: UseSseResult;
  onOpenPanel?: (agentId: string) => void;   // W4 wires the panel; W3 leaves undefined
};
```

`AgentNode` additions, all conditional on `data.overlay` (threaded per-group in `projectedNodes` as `overlay: runOverlay?.overlays[group.key]`, plus `runRef`/`sse`/`onOpenPanel`):
- header gains `<span className={`entity-chip v-agent-state v-agent-state--${overlay.state}`}>{overlay.state}</span>` and, when `overlay.openGate`, `<span className="entity-chip v-agent-state--gate">gate open</span>`;
- after the stages list: `overlay.attemptRef ? <AttemptMiniTail runRef attemptRef sse /> : null`;
- when `onOpenPanel` present, the card's header becomes clickable (`onClick={() => onOpenPanel(group.agentId ?? '')}`, `nodrag nopan` guards like the existing Open-agent button :492-501);
- in run mode (`data.overlay` present) the assignment-override `<details>` fold (:524-552) is NOT rendered — a frozen run's cast is not editable.

- [ ] **Step 1: failing tests** — new cases: badge text per state; gate chip presence; mini-tail rendered only when attemptRef; override fold absent in run mode, PRESENT (unchanged) in def mode; def-mode snapshot of `AgentNode` output unchanged with no overlay props (lock).
- [ ] **Step 2: run** the file — new FAIL, old PASS.
- [ ] **Step 3: implement.** Style hooks: `v-agent-state--running` warm accent, `--waiting-human` attention, `--failed` danger, others neutral — reuse the app's existing chip color tokens (grep `entity-chip` styles; both themes).
- [ ] **Step 4: run** — full file PASS exit 0.
- [ ] **Step 5: commit** `git commit -am "feat(ui): run-mode overlay on the agent graph — state badges, gate chips, live mini-tails"`

---

### Task 4: RunDetail renders the running graph as its head

**Files:**
- Modify: `src/views/RunDetail.tsx` (head sections, :1-19 documented order; the view already holds `run` + `useSse` after W2)
- Test: extend `src/views/RunDetail.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–3; RunDetail's existing `run` state and W2 `sse`.
- Produces: above the existing step strip: `<WorkflowAgentGraph entry={entryFromRun(run)} readOnly runOverlay={{runRef, overlays: overlaysFromRun(run), sse}} />`, recomputed via `useMemo` on `run`. `onOpenPanel` left undefined (W4). The step strip and every existing section REMAIN (spec: graph is the head, not a replacement — the plain-word strip still serves accessibility/scan).

- [ ] **Step 1: failing test** — RunDetail with a fixture run renders the graph head (node testids present) with a `running` badge on the running agent; def-mode Flow tab in `WorkflowDetail.test.tsx` untouched and passing.
- [ ] **Step 2: run** — FAIL. **Step 3: implement.** **Step 4: run** — RunDetail + WorkflowDetail + WorkflowAgentGraph suites all exit 0. **Step 5: commit** `git commit -am "feat(ui): RunDetail heads with the live running graph"`

---

## Wave-close verification (boss)

1. `npx vitest run src/control/runGraph.test.ts src/components/AttemptMiniTail.test.tsx src/views/WorkflowAgentGraph.test.tsx src/views/RunDetail.test.tsx src/views/WorkflowDetail.test.tsx` — exit 0.
2. `npx tsc --noEmit` — 7 baseline. `npx vite build` — clean (reactflow tree-shake sanity).
3. Live smoke on 5317: open an archived/waiting run's RunDetail — graph head renders with truthful badges (no live attempt needed; mini-tails simply absent). Full live-tail smoke lands with W6's slice run.

## Self-review notes (resolved inline)

- Spec §3 coverage: badges ✓ (T1 precedence + T3), mini-tail ✓ (T2/T3), gate chip ✓, launch-lands-on-graph → satisfied by RunDetail being the run's landing view with the graph as head (T4); def view untouched ✓ (T3 lock test).
- Type consistency: `AgentRunOverlay`/`runOverlay` prop names identical across T1/T3/T4; group key = `group.key` in both selector and projection.
- Placeholder scan: none; T1 directs the worker to read the real dto/`agentGroups` field names rather than trusting this doc's approximations — that is deliberate (single source of truth is the code), with output-identity tests enforcing correctness.
