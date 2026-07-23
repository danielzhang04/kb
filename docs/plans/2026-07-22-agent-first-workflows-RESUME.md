# Resume: agent-first dashboard workflows

_Checkpoint: 2026-07-22. This is an intentionally incomplete work-product branch, not merge-ready._

## Workspace

- Worktree: `C:\Users\danie\kb\_private\codex-worktrees\dashboard-agent-first-workflows`
- Branch: `codex/dashboard-agent-first-workflows`
- Base at creation: `03ba187` (`origin/main` at the start of this work)
- Binding design: `docs/plans/2026-07-22-agent-first-workflows.md`
- Dashboard `node_modules` is a local junction to `C:\Users\danie\kb\dashboard\node_modules` so this
  worktree can run the existing toolchain. It is ignored and not part of the commit.

## User outcome

1. Agents initially shows only agents the user creates (`agents/*.md`).
2. Humans and queue/ledger-only historical identities do not appear.
3. Canonical runtime workers appear in a separate collapsed **System workers** panel.
4. Workflows are presented as draggable, agent-first handoff networks, while the stage DAG remains the
   execution/retry/resume truth.
5. Clicking an agent enumerates what it governs.
6. FYT is mapped to its four declared agents without binding runners, activating execution, spending,
   uploading, or publishing.

## Decisions already made

- Ownership is `governedBy` metadata on both a workflow and its stages.
- `governedBy` is profile-free, compile-neutral accountability. It is NOT executable assignment.
- Existing `manager.agentId/profileId` and stage `agentId/profileId` remain the only executable bindings.
- Agent-level edges are derived handoffs, not a DAG. Collapsing an acyclic stage DAG can produce agent
  cycles (for example preproduction → checker → preproduction).
- Dragging a stage edits a local draft. One submit sends the complete governance snapshot as one
  source-hash-bound amendment/PR. Never create one PR per drop.
- Runtime defaults in `governance/model-routing.yaml` are the canonical system-worker set:
  `worker-desktop` (queue-addressable) and `codex-worker` (dashboard-triggerable through the closed
  scheduled-task mapping). Observed identities do not create workers.
- Agent detail must derive exact governance from definitions. Being declared for a project is not proof
  that an agent governs every workflow in that project.
- FYT `image-review` is governed by `fyt-runner`, not `fyt-checker`: the stage performs the honest stamp,
  and the checker declaration explicitly forbids stamping/merging. Checker findings feed the runner.

## Drafted code

### Server

- `dashboard/server/workflows/defs.ts`
  - accepts compile-neutral workflow/stage `governedBy` safe IDs.
- `dashboard/server/workflows/routes.ts`
  - exposes workflow/stage governance, stage titles/dependencies, eligible declared governance agents;
  - adds a source-addressed batch `POST /api/workflows/:id/governance-amendments` path;
  - validates owners are declared for the project and proves the compiled proposal hash is unchanged.
- `dashboard/server/workflows/amendments.ts`
  - adds a byte-preserving full-governance patcher and exact semantic-diff guard.
- `dashboard/server/agents/routes.ts`
  - agent detail now returns only exact workflow/stage governance facts;
  - adds `GET /api/agents/system-workers` from runtime defaults, with addressable/triggerable facts.

### Client

- `dashboard/src/views/Agents.tsx`
  - primary roster is declared agents only;
  - collapsed system-worker panel replaces the visible observed-identity table.
- `dashboard/src/views/AgentDetail.tsx` and `dashboard/src/lib/agentClient.ts`
  - governance section enumerates workflow role, governed stages, dependencies, action/target outputs,
    review relationships, and completion gates.
- `dashboard/src/views/WorkflowAgentGraph.tsx`
  - first ReactFlow handoff-network draft;
  - agent/unassigned nodes, stage cards, HTML drag/drop between owners, derived aggregated handoff edges,
    node inspector, and select fallback.
- `dashboard/src/views/WorkflowDetail.tsx` / `Workflows.tsx`
  - Agents is currently the first/default detail section;
  - loads governance choices, retains a local draft, and submits one batch amendment.

## Verification at checkpoint

- `python scripts/preamble.py`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run build`: PASS (existing >500 kB chunk warning only).
- `git diff --check`: PASS (line-ending warnings only).
- Focused tests: 104 total; 85 passed, 19 failed.
  - `server/workflows/defs.test.ts`: PASS unchanged.
  - `server/workflows/amendments.test.ts`: PASS unchanged.
  - Failures are in old assertions for Agents/AgentDetail/WorkflowDetail/Workflows plus one old agent
    route expectation. They have not yet been migrated or supplemented with new behavior tests.
- No full suite, canary guard, browser QA, merge simulation, or independent code review has run.

## Known incomplete work

1. **Do not merge this checkpoint.** Tests intentionally remain red.
2. Add focused parser/amendment/API tests for `governedBy`, exact batch patching, declaration/project
   validation, and compiled-proposal identity preservation.
3. Update old Agents tests to supply declared roster entries. Preserve snapshot-derived observed rows only
   as an internal fallback; they must not render in the user-created roster.
4. Update WorkflowDetail tests for the new default Agents tab, or render Overview explicitly when an old
   test is about Overview content.
5. Add `WorkflowAgentGraph.test.tsx`: grouping, unassigned node, cyclic handoffs, internal dependency
   preservation, click inspector, drag draft, select fallback, and no network write on drop.
6. Add governance-submit tests: exactly one batch request; pending amendment disables further submission
   and launch; stale source fails; execution assignment endpoint is never called.
7. Add workflow-network CSS. The production bundle compiles, but the new canvas/inspector has no dedicated
   layout styling yet and therefore has not been visually accepted.
8. Review `WorkflowAgentGraph` state synchronization. The current `useNodesState` + effect preserves node
   positions while replacing node data; exercise it under React tests and browser drag behavior.
9. The batch governance route currently mirrors durable assignment routing in a separate function. Before
   merge, refactor shared durable amendment mechanics so this does not become parallel per-case infra.
10. Generalize the assignment amendment state/store naming from “assignment” to “definition amendment,”
    while retaining backward-compatible API/error behavior and preventing governance/assignment races.
11. Add ownership support to Composer workflow creation (`artifactTypes.ts`, `Composer.tsx`, tests), so a
    newly designed workflow does not require a later source amendment.
12. Replace the workflow list's 14-stage dump with agent summary chips/counts.
13. Add canonical FYT metadata to `orgs/faceless-youtube/workflows/video-run.md`:
    - workflow `governedBy: fyt-runner`
    - `fyt-preproduction`: idea, research, script, shorts, metadata, shots, motion
    - `fyt-production`: images, voiceover, audio-plan, render
    - `fyt-runner`: image-review
    - `fyt-checker`: judge-gate, verify
14. Update FYT registration tests to pin that exact map while continuing to pin all four
    `runner-bound: false`, all executable assignments null, and activation absent.
15. The existing future-binding role mismatch remains: declarations use `manage/work/inspect`, while
    assignment eligibility expects `manager/worker`. Normalize `manage → manager` and
    `work|inspect|scout|consolidate → worker`, with tests, before claiming future binding is usable.
16. Run typecheck, build, focused suites, full dashboard suite, canary diff guard, browser QA, merge-base
    analysis/simulation, and an independent review before opening a PR.

## Exact restart sequence

```powershell
Set-Location C:\Users\danie\kb\_private\codex-worktrees\dashboard-agent-first-workflows
python scripts/preamble.py
git status --short
Get-Content docs/plans/2026-07-22-agent-first-workflows.md
Get-Content docs/plans/2026-07-22-agent-first-workflows-RESUME.md
Set-Location dashboard
npm.cmd run typecheck
```

Then start with tests and the amendment-infrastructure refactor. Do not add FYT metadata until the
generic parser/amendment/API invariants are green.

