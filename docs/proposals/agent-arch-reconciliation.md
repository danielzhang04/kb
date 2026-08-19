# Reconciliation — external agent-architecture brief vs kb's built design (2026-08-19)

Input: Daniel's CLI-researched design brief (provider-neutral governed agents; Build/Run/
Observe surfaces; thin runner; learning loop). Verdict up front: **the brief validates the
architecture kb already has across two branches; it surfaces three real gaps worth building
and zero conflicts worth a redesign.** No tonight's-run unit changes shape because of it.

## Where the brief is already built (no action)

| Brief concept | kb reality |
|---|---|
| Skill / bounded worker / agent / checker | skills/ tiers · codex dispatch workers · agents/*.md defs + kit standard-loops · inspector + eval suites |
| Workflow/DAG + thin deterministic runner owning state/gates/retries/budgets | the workflow-platform branch (stages, iteration bounds, parks, human gates, launch/store) |
| Schedule triggers, owns no logic | HEARTBEAT cadences + cron `due()` (agent-infra T7); Schedules panel is read/pause-only |
| Build surface (defs, roles, permissions, promotion status) | agent factory + roster loader + autonomy ladder |
| Observe surface (history, traces, cost, approvals inbox, learnings) | Agent Platform dashboard section; grades-history + per-schedule run-history land tonight (Wave-2 C/D) |
| Governance invariants (no self-approval, independent checker, least-privilege outside prompts, worktree isolation, single-writer, state outside context, disposition incl. parked, schedules-trigger-only) | test-pinned across both branches; eval self-judgment wall + tonight's fail-closed `eval-suite` promotion exclusion (Wave-2 G) |
| Learning loop w/ improvement agent that never self-promotes | lesson miner (raw inbox) + Wave-2 Task A maintainer agent (PR/card drafts only, hard walls) |
| "Agents only where judgment is needed; scripts for the predictable" | workflow-defaults doctrine + kb's script-first norms |

## Real gaps the brief surfaces (Wave-3 candidates, Daniel prioritizes)

1. **Agent versioning + run pinning.** Defs are unversioned; nothing pins a running job to
   the def version it started under (nearest analog: `kit_sha` stamping on codex cards).
   Brief's `agent@v3 → run-0042` is right. Touches: def frontmatter (version field), factory
   (bump-on-edit), workflow-platform run records (pin + display). Structural — after merge.
2. **Proposal-time evaluation in the maintainer loop.** Brief: improvement agent runs evals
   against its proposal BEFORE approval. Tonight's Task A proposes with evidence citations
   but does not sandbox-apply + re-run the target's evals. Upgrade path: FireResult gains an
   `eval_forecast` step (apply diff in tmp worktree → `eval_trigger --run` on affected agents
   → attach results to the ProposalDraft). Queued, not folded into tonight (heavier machinery,
   same governance).
3. **Def schema depth: input/output schemas + per-agent default budgets/escalation rules.**
   Today these live per-workflow or per-dispatch, not on the def. Worth folding into the def
   shape when versioning (gap 1) opens the def format anyway — one format change, not two.

## Noted alignments needing no work now

- Provider adapters + normalized event stream: workflow-platform's manager/worker adapters
  already abstract claude/codex; API/open-model adapters slot there later.
- Run-control verbs (pause/resume/cancel/continue): partially present in the control plane;
  completeness audit belongs to the workflow-platform merge checklist, not this branch.
- The two branches ARE the brief's surfaces — agent-platform = Build+Observe, workflow-
  platform = Run. The brief is a good convergence checklist for their eventual co-merge.

## Explicit non-adoptions (and why)

- A new "runner" abstraction: would duplicate the workflow-platform engine. Reuse, never
  re-implement (file-editing law: change core logic, don't append parallel function).
- Provider-neutral rewrite now: premature; two live runtimes work through adapters already.
