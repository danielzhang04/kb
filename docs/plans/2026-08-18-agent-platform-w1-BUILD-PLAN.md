# Agent Platform — Wave 1 Overnight BUILD PLAN

_The executable plan for the overnight autonomous run. The Fable 5 boss terminal loads
this + `2026-08-18-agent-platform-GOAL-STATE.md` and executes it. Companion:
`2026-08-18-agent-platform-program-spec.md`. Analyses: `docs/research/_ig-saved/analysis/`._

## 0. Success condition (machine-checkable, whole run)
By morning, on branch `claude/agent-platform-w1` (pushed, NOT merged):
- As many units below as the night allows, DONE = built + tested + surfaced on the new
  "Agent Platform" dashboard section + passed BOTH reviews (unit + goal).
- An isolated, display-only dashboard instance on port 4630 the operator unlocks to
  review the upgrade live.
- `MORNING-REPORT.md` at the worktree root: per-unit status, how-to-see-it, evidence,
  graded model, decision-notes; plus relaunch command + review order.

## 1. Orchestration model (no new abstractions)
The Fable boss terminal orchestrates with the standard kb pattern:
- It **holds the goal** (re-reads GOAL-STATE at each unit + after compaction) and
  dispatches all work — it does not write code by hand.
- **Build workers** (Claude Agent-tool subagents; model per §2) build one unit each.
- **Review agents** (separate, fresh-context) check the work. Every subagent's model is
  verified at grading by grepping
  `~/.claude/projects/C--Users-danie-kb/<session-id>/subagents/agent-<id>.jsonl` for
  `"model":`. An ungraded model = invalid.
- Work runs in **parallel lanes** (§4); results are committed on the branch per unit.

## 2. Per-unit pipeline (build → two adversarial reviews → commit)
For each unit, in order:
1. **SPEC** — a worker restates the unit's acceptance (authored in §5, do NOT invent a
   looser bar) into a short build spec + a test list.
2. **BUILD** — a worker builds to spec, TDD, following the Build Discipline (§3). Model:
   **opus** for hooks / permission-adjacent / core data-model / SPA-architecture units;
   **sonnet** for isolated scripts + simple panels (marked per unit in §5).
3. **UNIT REVIEW** — a *separate* fresh-context **opus** Inspector runs the acceptance
   deterministically (tests, the demo command) + adversarially reviews the diff. FAIL →
   back to BUILD with the reason.
4. **GOAL REVIEW** — a *separate* fresh-context **opus** auditor checks the unit against
   GOAL-STATE: does it move toward the agent platform, is it the right shape, does it
   integrate coherently (no bolt-on, no duplicate logic, matches existing patterns)?
   FAIL → back to BUILD.
5. **COMMIT** — only on BOTH passes: commit on the branch with a clear message; record in
   MORNING-REPORT. Retry cap = **2** review fails on a unit → stop it, write a BLOCKED
   note with the reason, move on. DO NOT SPIN.
After each lane finishes, one **coherence review** (fresh opus): do the lane's units
cohere, or fragment? File follow-ups as decision-notes, don't rework endlessly.

## 3. Build Discipline (smart file editing + building)
- **Read before writing.** Before touching any file, read it + its neighbors + its test;
  match the existing idiom, naming, error-handling, and test style. kb norm: change
  existing logic coherently, keep behavior consistent across files — never bolt on.
- **No duplicate logic.** Reuse existing subsystems (e.g. `trace/render.ts`, `ledgers/`,
  `promotion.py`/`trust.py`, the agents catalog) — surface/extend them, don't reimplement.
- **Minimal, coherent diffs.** Prefer the smallest change that fits the architecture. New
  files only where a self-contained unit avoids collision (dashboard **panels** are
  self-contained components; see §4).
- **TDD.** Test first; a unit is not done without passing tests + a runnable demo.
- **Collision avoidance.** Parallel workers touch **disjoint file sets**. Anything on a
  shared file (SPA nav/routing, `.gitignore`, package manifests) routes through the
  serial UI-shell (U0) / theme (U16) / integration (U12) steps, or an isolated worktree +
  a serial merge.
- **UI: inspired, not copied.** The 4 reference dashboards are DIRECTION, not a spec to
  clone. Adapt their DNA (dark functional-color shell, agents-as-a-graph, live run
  telemetry, model badges) to kb's own dashboard and data — never reproduce their layouts
  or branding.

## 4. Parallelization map
- **U0 (section + panel-registration) and U16 (design/theme upgrade) run FIRST, serial.**
  U0 creates the "Agent Platform" section + a registration mechanism so every feature panel
  is a self-contained component added WITHOUT editing shared nav/routing; U16 lands the
  centralized theme tokens so feature panels inherit the upgraded look. Key
  collision-avoidance move.
- Then **parallel lanes** (disjoint backend files + self-contained panels):
  - **BRAIN:** U1 → U2
  - **AGENT-PLATFORM:** U3 → U4 → U14 (fleet/agent-connection graph)
  - **SURFACE-EXISTING:** U5, U6, U15 (watch-agents-run) — read-mostly
  - **CONTEXT/HOOKS:** U7 → U8 (ECC-adapt) → U9 (serialize *within* the lane — shared hook area)
  - **HYGIENE:** U10, U11 ; plus **U13** docs (anytime)
- **U12 (integration) runs LAST, serial** — wires all built panels into the shell, verifies
  design coherence, runs the full dashboard build + tests.
- Concurrency is capped by the harness; the boss keeps ~all lanes in flight. If the night is
  short, priority: **U0,U16 → U3,U4,U14 → U15 → U1,U2 → U5,U6 → U7,U8,U9 → U10,U11 → U12 →
  U13, keep-on.**

## 5. The units (each = function + UI + authored acceptance)

**U0 · Agent-Platform dashboard section + panel registration** (opus, serial-first)
- Function/UI: a new nav entry + section view in the SPA with a panel grid + a documented
  registration pattern for self-contained panels.
- Accept: section renders with a placeholder grid; adding a demo panel needs no shared-file
  edit; existing dashboard build + all existing tests still pass.

**U1 · Semantic Brain indexer** (sonnet)
- Function: walk `memory/`, `handoffs/`, `docs/`, `orgs/*/STATE.md`; chunk + embed with a
  LOCAL model (e.g. sentence-transformers, CPU — NO API); write a vector index to a
  GITIGNORED path.
- Accept: builds an index over a fixture dir; unit tests for chunk + embed; `.gitignore`
  updated; runs with zero network/API.

**U2 · Brain query + search panel** (sonnet)
- Function/UI: `brain_query.py "q"` returns top-k corpus chunks by meaning + source paths;
  a "Brain Search" panel runs a query live and shows ranked results.
- Accept: golden test (a known query returns the known-relevant file in top-k); panel
  returns results against the built index. Deps: U0, U1.

**U3 · Agent definition schema + registry** (opus)
- Function: a schema for a complex agent (id, role, model, tools, knowledge-source,
  autonomy-tier, skills) + a loader that reads the existing `agents/` catalog and new defs
  into one registry.
- Accept: schema + loader + tests; validates a sample complex-agent def; lists existing
  agents without loss.

**U4 · Agent management view + detail cards** (opus) — the headline UI
- Function/UI: a fleet/agent management view — list with model badges + status; click →
  a detail card (role, model, tools, THE LADDER autonomy tier, WHAT-IT-REPLACES, BUILDS-ON).
- Accept: renders real agents from U3; a detail card opens with the real fields. Deps: U0, U3.

**U5 · Autonomy-ladder view** (opus — reads safety code, read-only)
- Function/UI: read the EXISTING `promotion.py` / `trust.py` gate state; render per-agent
  autonomy tier + rolling track record as the ladder UI. READ-ONLY — no writes to the gate.
- Accept: renders real gate state for real workers; a test asserts zero writes to gate
  state/ledgers. Deps: U0.

**U6 · Run-envelope panel + step-check prototype** (opus)
- Function/UI: surface the EXISTING inert `trace` flight-recorder as a "run steps" panel
  (read-only); add a deterministic step-check prototype (report-only, on a fixture).
- Accept: renders a real run's envelope; the step-check runs on a fixture and reports
  per-step pass/fail without mutating anything. Deps: U0.

**U7 · Re-grounding hook (inert)** (opus)
- Function: a `UserPromptSubmit` hook injecting a compact GOAL-STATE + guidelines summary
  as `additionalContext`, cache-friendly (stable prefix). Shipped as a PROPOSED settings
  snippet under `docs/proposals/` — NOT wired into live settings.
- Accept: emits valid `additionalContext` for a mock event; tests; snippet documented.

**U8 · Context persistence via adapted ECC** (opus)
- Function: study the DISABLED ECC plugin's context stack (per-session store, SessionStart
  injector, PreCompact summarizer, read/activity tracker). Extract + ADAPT the
  context-persistence parts into kb-native scripts — DROP ECC's intrusive GateGuard (the
  reason ECC was killed). Serves the "persistent shortened context store, shareable to
  subagents, re-accessible after compaction" goal. Ship INERT + a PROPOSED wiring under
  `docs/proposals/` + a decision-note on reclaim scope; do NOT auto-wire live settings.
- UI: a "Context Lifecycle" panel showing the adapted store's current contents.
- Accept: kb-native adapted module + tests; a proposed settings snippet; a decision-note;
  ZERO live-settings edits; no GateGuard. Deps: U0.

**U9 · Spawn context-load + model-verify hooks (inert)** (opus)
- Function: a `SubagentStart` context-injection hook + a two-stage model-verify
  (`PreToolUse`-on-Task requested-model check + `SubagentStop` transcript check) writing an
  audit row; a "Model Audit" panel. EMPIRICALLY verify the injection field name against the
  live harness — do not guess. Inert/tested; not wired live.
- Accept: a spawned test subagent receives injected context; model-verify emits an audit row
  on a mock; panel renders the audit log. Deps: U0.

**U10 · Learning miner + panel** (sonnet)
- Function/UI: `session_miner.py` parses a transcript → candidate ADD lessons to a PROPOSALS
  file (feeds `dream.py`); a "Proposed Lessons" panel. Boundary: proposal-only, NEVER writes
  `memory/` directly.
- Accept: fixture transcript → proposals file; panel lists proposals. Deps: U0.

**U11 · File cleanser + panel (dry-run)** (sonnet)
- Function/UI: a DRY-RUN sweep reporting trash/bloat + proposed shrinks to a report file; a
  "Hygiene Report" panel. Boundary: ZERO deletions, no history rewrite, ever.
- Accept: emits a report; a test asserts zero filesystem mutations. Deps: U0.

**U12 · UI integration + design pass** (opus, serial-last)
- Function/UI: wire all built panels into the Agent-Platform section; apply the design
  language (dark near-black shell, color-as-functional-legend, model badges, review-panel
  split); nav coherence.
- Accept: full dashboard build + all tests green; every built unit's panel is reachable and
  shows real data. Deps: all panel units.

**U13 · Guideline docs** (sonnet, anytime)
- `docs/proposals/file-editing-guidelines.md` + `docs/proposals/subagent-governance.md`
  generalizing BOSS.md dispatch discipline. Accept: both written, coherent.

**U14 · Agent-connection / fleet graph** (opus)
- Function/UI: build OVER the existing `WorkflowAgentGraph` — a fleet view rendering agents
  as nodes with edges (dispatch / coordination relationships), color-coded by role/status,
  click-to-inspect a node. Inspired by the videos' org-chart/radial graph — kb-native, NOT a
  copy — over real registry (U3) + run data.
- Accept: renders real agents + edges; clicking a node opens its detail; existing graph tests
  still pass. Deps: U0, U3.

**U15 · Watch-agents-run (live) view** (opus)
- Function/UI: surface + upgrade the EXISTING live-run-graph (live mini-tails): live agent
  status, model badge, "working Ns · called N tools", running/idle/done states, live tails.
- Accept: shows live/recent runs with live status against real run data; existing live-run
  tests pass. Deps: U0.

**U16 · Dashboard-wide design/color upgrade** (opus, serial-early)
- Function/UI: a CENTRALIZED theme-token + shared-component pass (improved dark palette as a
  functional color legend, spacing, cards, status pills, model badges) that propagates across
  the dashboard WITHOUT per-screen rewrites — the "better colors + elements across the
  dashboard." Adapts the inspiration's DNA to kb; NOT a copy of any layout/branding.
- Accept: theme tokens + shared components updated; ALL existing dashboard tests + screens
  still pass (boundary: break nothing); a before/after note. If a broad restyle can't keep
  tests green, scope down + write a decision-note.

**keep-on (lowest priority)** (opus) — build the `Stop`-hook forced-continuation +
closing-file loop DISABLED behind a flag, with a HARD numeric cap + off-switch + tests. DO
NOT ARM IT. If unsure, leave a design doc only.

## 6. Hard boundaries (violating any = failure)
- NEVER merge; NEVER push to `main` or `ops`. Push only `claude/agent-platform-w1`.
- NEVER edit `governance/**` or `CLAUDE.md`/`BOSS.md`/`AGENTS.md`/`GEMINI.md` (a hook blocks
  it) — governance changes go to `docs/proposals/`.
- NEVER spend real money; no `ANTHROPIC_API_KEY`; local embeddings only.
- NEVER delete/weaken tests or lower coverage; NEVER delete repo files (cleanser is
  dry-run-only); NEVER arm keep-on/auto-continuation/cadence.
- NEVER touch the live dashboard's port or the control-plane worktrees under
  `AppData/Local/kb-dashboard/control/`. Honor the STOP file + budget guard at every unit.

## 7. Decision-note rule (no human tonight)
For any judgment not pre-decided here (reclaim-vs-replace ECC, which embedding model,
keep-on cap policy, anything interpreting human-edited `risk-tiers.md`): build the SAFEST
reversible default and write a DECISION-NOTE (choice, alternatives, what to rule). Never
guess on anything irreversible — skip and note it.

## 8. Final deliverable
1. Commit every done unit; PUSH `origin/claude/agent-platform-w1`.
2. Stand up the ISOLATED, DISPLAY-ONLY dashboard on port 4630 from THIS worktree —
   read-only: NO reconciler / cadence / execution / managed-worktree writes; a SEPARATE
   data dir; never the live control dir. Find the safe display-only invocation; if isolation
   can't be GUARANTEED, do NOT start it — document exact manual launch steps instead.
3. Write `MORNING-REPORT.md`: per unit (DONE/BLOCKED/SKIPPED, what it does, the command OR
   panel to SEE it work + expected result, test evidence, graded model, decision-notes);
   then units done, branch + tip SHA, port + unlock + one-line relaunch command, budget,
   recommended review order. Append lessons to `memory/<agent-id>.md`. Leave the tree clean.
