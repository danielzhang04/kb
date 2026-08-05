# Dashboard UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Spec: `docs/superpowers/specs/2026-08-04-dashboard-ux-overhaul-design.md` — read it first.

**Goal:** One unlock, human names instead of IDs, one Workflows surface (Runs/Run Canvas/cockpit absorbed), context-linked Inbox, runnable Agents, no stop floor, and a measurably smaller codebase.

**Architecture:** Branch `claude/dashboard-ux-overhaul` on `claude/headless-roster` @ae8a80c, worktree `kb-worktrees/boss-dashboard-ux`. React SPA (`dashboard/src`) + Fastify daemon (`dashboard/server`), vitest both sides. Acceptance daemon = 4620 launcher repointed at this worktree.

**Execution regime:** Claude subagents (sonnet default; opus for auth-adjacent units — unlock consolidation, archive write; haiku for mechanical sweeps). Boss diff-verifies every unit, runs tests, and greps the worker transcript for `"model":` before accepting. Phase order is dependency order — naming DTOs (P2) before view redesigns (P3–P5) consume them.

## Global constraints (from spec — binding on every task)

- Change core logic in place; never bolt on parallel paths, wrappers, or append-only fixes.
- No new files where an existing file owns the responsibility; keep files slim.
- Tests updated in place; tests for deleted paths are deleted, never skipped.
- Backend keeps real IDs everywhere; only presentation changes.
- Real IDs, file paths, hashes, branch refs never appear as primary UI text — tooltip/copy or a "Technical" fold only.
- Every governed write stays on its existing audited path; no second write path.
- All copy plain-language: what happened, what you can do. No control-plane jargon ("canonical", "proposal revision", "attempt", "amendment") in primary UI.

---

## Phase 1 — Platform fixes: static serving + single unlock

**Files:**
- Modify: `dashboard/server/static/routes.ts` (+ `routes.test.ts`)
- Create: `dashboard/src/lib/sessionContext.tsx` (+ test)
- Modify: `dashboard/src/App.tsx` (drop `SessionStopFloor`-adjacent session plumbing wiring, add top-bar lock chip; 16 `sessionToken` prop threads deleted), `dashboard/src/control/ManagedRuns.tsx` (unlock button/branch out), `dashboard/src/views/Home.tsx` (both sign-in panels out), `dashboard/src/views/RunCanvas.tsx` (banner → context), `dashboard/src/views/ApprovalsLive.tsx`, `dashboard/src/views/Workflows.tsx`, `dashboard/src/views/WorkflowDetail.tsx`, `dashboard/src/composer/ComposerChat.tsx`, `dashboard/src/views/AgentDetail.tsx` — all consume the context instead of props.

**Interfaces (produced):**
```tsx
// sessionContext.tsx
export function SessionProvider(props: { children: ReactNode }): JSX.Element;
export function useSession(): {
  session: Session | null;            // null = locked
  locked: boolean;
  requireSession(): Promise<Session | null>; // runs the passkey ceremony if locked; one in-flight ceremony shared
};
```
Internals reuse `authClient.signIn`/`readStoredSession`/`SESSION_INVALIDATED_EVENT` unchanged — authClient is NOT modified.

**Static fix:** in `registerStatic`, replace boot-time-only registration semantics: keep `fastifyStatic` for cache headers, and in the not-found handler, before the SPA fallback, `reply.sendFile(req.url.slice(1), distDir)` when the URL starts with `/assets/` and the file exists on disk (request-time `existsSync` under `distDir`, path-traversal-guarded via `join`+prefix check). Test: register against a temp dist, write a NEW hashed asset after registration, GET serves 200; `GET /assets/missing.js` still 404s; `../` traversal 404s.

**Steps:** failing test → fix → tests green → commit, per unit (static; context; per-view consumption sweep). The consumption sweep is one unit: it must delete every per-view unlock affordance and prop thread in one pass.

**Acceptance:**
- `grep -rn "onRequestSession\|Unlock cockpit\|Sign in to inspect\|Unlock run requests\|Unlock dashboard" dashboard/src` → only the top-bar chip's own file matches a single "Unlock" string.
- One passkey ceremony unlocks every surface (manual check on 4620).
- `npx vitest run` green in `dashboard/` (src + server projects).

## Phase 2 — Naming layer

**Files:**
- Create: `dashboard/server/naming.ts` (+ `naming.test.ts`)
- Modify (embed `displayName`/`shortRef` in list/detail DTOs): `dashboard/server/control/routes.ts` (runs, human requests), `dashboard/server/kb`/workflows index route, agents route, `dashboard/server/dag/graph.ts` (node payload), approvals/inbox feed route, tasks route. Locate each by `rg "app.get" dashboard/server` — every route already returning entity lists.
- Create: `dashboard/src/components/EntityName.tsx` (+ test)
- Modify: every view rendering raw ids (`Home`, `Approvals`, `ApprovalsLive`, `Workflows`, `WorkflowDetail`, `Agents`, `AgentDetail`, `Tasks`, run surfaces) to render `<EntityName>`.

**Interfaces (produced):**
```ts
// server/naming.ts — registry persisted at join(process.env.DASHBOARD_STATE_ROOT ?? <default>, 'naming.json')
export type EntityKind = 'card' | 'run' | 'workflow' | 'agent' | 'task';
export function shortRef(kind: EntityKind, id: string): number;      // assigns next ordinal on first sight, stable + persisted (atomic rename write, same pattern as control/store.ts)
export function displayFor(kind: EntityKind, id: string, title?: string): { displayName: string; shortRef: number };
// displayName precedence: explicit title → derived (run: workflow name; card: card name field) → id prefix fallback
```
```tsx
// EntityName.tsx
export function EntityName(props: { kind: EntityKind; id: string; displayName: string; shortRef: number; muted?: boolean }): JSX.Element;
// renders "{displayName} #{shortRef}"; title-attr full id; click-to-copy id glyph
```

**Acceptance:** registry survives daemon restart (test: two store instances over same file agree); no UUID/`wf-…`/`run-…`/`request-…` string as primary text on Home, Inbox, Workflows, Agents, Tasks (Playwright text scan); tests green.

## Phase 3 — Workflows unification

**Files:**
- Modify: `dashboard/src/nav/config.ts` (delete `pipeline` + `runCanvas` from `DestinationId` and sections), `dashboard/src/App.tsx` (body switch), `dashboard/src/palette/paletteModel.ts`, `dashboard/src/nav/stack.ts` + `dashboard/src/control/entityLinks.ts` (retarget run links into workflows), tests of each.
- Rewrite: `dashboard/src/views/Workflows.tsx` (informative list: name, project, latest-run status/time, live dot; no paths, no governance chips, no launch), `dashboard/src/views/WorkflowDetail.tsx` (graph-centric; ONE Launch button; parameters as inline fields next to Launch, prefilled with defaults; governor dropdown + amendment ceremony UI deleted), `dashboard/src/views/WorkflowAgentGraph.tsx` (per-agent node: assignment + model editable inline via the EXISTING governed assignment/routing write paths; plain-language handoff edges; no dead canvas).
- Absorb-and-delete: `dashboard/src/views/RunCanvas.tsx` + `dashboard/src/control/ManagedRuns.tsx` + `dashboard/src/control/RunCockpit.tsx` + `dashboard/src/control/RunGrid.tsx` + `dashboard/src/views/Pipeline.tsx` → one run-detail surface inside WorkflowDetail (new file allowed: `dashboard/src/views/RunDetail.tsx` since no existing file owns it): stream tiles + two-way messaging (from RunCanvas), stage/status + human-gate strip (from RunCockpit), scoped card DAG (React Flow, `/api/dag` filtered to the run's cards via the queue-bridge card refs on the run DTO).
- Server: run-list DTO gains `workflowRef`-derived grouping key (already derivable via `entityLinks.workflowIdForRun` — move that join server-side into the runs route so the client stops re-deriving).

**Acceptance:** nav shows one Workflows entry; every run reachable under its workflow or "Ad-hoc"; `Pipeline.tsx`, `RunCanvas.tsx`, `ManagedRuns.tsx`, `RunCockpit.tsx`, `RunGrid.tsx` deleted with their tests migrated to the new surface's tests; launch = one click after optional inline param edit; per-agent assignment editable on the graph and persisted through the existing audited write; all suites green.

## Phase 4 — Waiting-on-human + Inbox + Home

**Files:**
- Modify: `dashboard/server/control/routes.ts` + `store.ts`: archive action — `POST /api/control/runs/:runRef/archive` (T3-audited, session-gated, idempotent; sets terminal `archived` state on the run and resolves its open human requests; archived runs excluded from default list projections, included with `?includeArchived=1`).
- Modify: human-request DTO: `ask` field — plain-language rendering of known `kind`s (map in one server module next to the DTO builder); raw prompt text demoted to a `technicalDetail` field.
- Rewrite: `dashboard/src/views/Approvals.tsx` + `ApprovalsLive.tsx` → single list (cards + run asks merged): concise line (what needs you, why, tier chip) + deep link (`entityLinks`) to the owning run/agent/terminal surface; stat tiles, "Select an item…" pane, and the separate "Run requests" panel deleted; no inline gate-answering UI in Inbox; SSE-driven pure projection (item vanishes when queue/run state moves on).
- Modify: `dashboard/src/views/Home.tsx`: waiting-on-you uses `EntityName` + deep links; "Launch / rerun" form deleted; stat tiles reduced to agents/running/waiting/blocked.

**Acceptance:** resolving a card from a terminal (flip its state on ops fixture) removes the inbox item with no dashboard interaction (SSE test + manual); archive action audited + idempotent (tests); the 8 stale thin-slice runs archived at validation — after root-causing the `canonical result lookup identity differs` ask (fix or file it as its own card if it's a real live bug); no raw error text as an ask anywhere.

## Phase 5 — Agents

**Files:**
- Modify: `dashboard/src/views/Agents.tsx` + `AgentDetail.tsx`: "Run agent" replaces "Work with this agent"; digestible rows (name, role, model, current run via card ownership, last activity); DECLARED/runner-bound chips → technical fold; composer-workspace path removed.
- Modify: `dashboard/src/views/Terminal.tsx` + `dashboard/server/pty` launch path: agent-primed launch mode — Terminal accepts `{ agentId }` target; the PTY spawn injects the agent's binding/prompt priming (claude in the kb repo with the agent's `agents/<id>.md` loaded); UI toggle primed ↔ plain claude.
- Fallback (allowed by spec if PTY priming proves brittle in implementation): headless spawn + stream-tile attach à la RunDetail; criterion — Daniel types to the agent within one click of "Run agent".

**Acceptance:** "Run agent" from Agents lands in a live surface where typing reaches the agent (manual on 4620); no composer reference left in Agents surfaces; tests green.

## Phase 6 — Stop relocation + visual polish

**Files:**
- Modify: `dashboard/src/App.tsx` (delete `SessionStopFloor` + its palette hook), `dashboard/src/styles/app.css` (floor block), `dashboard/src/views` Sentinel view (StopControls panel added), `dashboard/src/views/Control.tsx` (StopControls stays the single implementation, de-chromed styles updated).
- Polish (five surfaces: Home, Workflows, Agents, Tasks, Inbox): `dashboard/src/styles/*` + surface files — typography hierarchy, spacing rhythm, card layout, empty states, status-dot consistency, hover/transition.
- GATE (before any accent lands): present Daniel 2–3 muted-accent swatches on the real UI (screenshot set); apply the chosen one as CSS custom property only.

**Acceptance:** no stop floor in sidebar; fleet-stop reachable in Sentinel and still works against `/api/stop` (manual + existing tests moved); accent applied only after Daniel picks; Playwright screenshot set of all five surfaces for Daniel's yes/no.

## Phase 7 — Adversarial bloat sweep + close-out

**Process:**
1. Inventory (haiku/sonnet fan-out): unused exports (`npx tsc --noEmit` + `rg` import-graph per module; `clientImportGraph.test.ts` pattern extended), dead files, redundant components, duplicate logic, stale comments/docs, orphaned CSS blocks, `dashboard/docs` staleness.
2. Adversarial verify (opus): every cut-list item gets a refutation attempt (who imports it, what breaks). Output: evidence-backed cut list (path, why dead, proof).
3. Boss gate → Daniel sees anything load-bearing → execute deletions in one commit series, suites green after each.
4. Close-out: before/after `cloc dashboard/src dashboard/server` report; full `npx vitest run` + `npx tsc --noEmit`; `npx vite build`; restart 4620 launcher pointed at this worktree (edit `cwd` in a copied launcher under this session's scratchpad — never edit the original session's file); full manual acceptance walkthrough (spec §Testing list); update `handoffs/` + memory per repo law.

**Acceptance:** LOC/file-count reduction reported; all suites + typecheck + build green; Daniel walks the five surfaces: one unlock, no raw IDs, one Workflows surface, inbox auto-clears, no stop floor.

---

## Self-review notes

- Spec coverage: §1→P1, §2→P2, §3+3b→P3+P4, §4→P5, §5→P4, §6→P6, §7→P6, §8→P7, static bug→P1. Home ruling→P4. No gaps.
- Later-phase consumers reference only interfaces defined here (`useSession`, `EntityName`, `shortRef`, archive route, `RunDetail`).
- One new-file exception each in P1 (`sessionContext.tsx` — no existing owner), P2 (`naming.ts`, `EntityName.tsx`), P3 (`RunDetail.tsx`); everything else edits in place, and P3/P6/P7 delete more files than the plan creates (5 view/control files + floor vs 4 new).
