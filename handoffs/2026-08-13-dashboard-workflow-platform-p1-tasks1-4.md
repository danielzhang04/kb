# Workflow-platform P1 (iteration loops) — Tasks 1-4 checkpoint handoff — 2026-08-13

**Topic:** P1 of the workflow-platform arc: termination rule researched + gated + locked by
Daniel, 14-task implementation plan written + adversarially reviewed, Tasks 1-4 of 14 built,
reviewed, and committed. Branch `claude/workflow-platform` @ **5274d1e** (pushed, remote ==
local), worktree `C:/Users/danie/kb-worktrees/boss-workflow-platform` (KEEP — active arc).
Boss protocol this arc: codex workers build (dispatch-codex), fresh opus claude agents review
adversarially, same-reviewer delta re-reviews via SendMessage, boss commits per reviewed unit,
model-grep every grade, ≤2 fix rounds per task then escalate.

### Daniel's P1 rulings (all binding, quoted verbatim in the proposal doc)
1. Termination is SEMANTIC first (authorized participant accepts → done, any round count).
2. NO platform default or ceiling for the cycle bound — def-declared per use case ("It
   depends": shots.json feedback ~1-2; debate maybe 15).
3. One GENERAL N-participant primitive — debate was "just an example"; pairwise / judge /
   debate+mediator / coordinator-crew are configurations, not engines. Goals live in the def
   or a mandate-carrying participant.
4. Nothing left on the table: bound exhaustion parks to a human gate with full residue;
   approve/decline + separate relaunch; never in-place cap mutation.
5. Backstops always-on: run budget windows + byte-identical no-progress park.
6. Session-level: Daniel does NOT want unbounded manager⇄worker iteration in orchestration
   either — boss runs ≤2 fix rounds per task.

### What WORKED (with evidence)
- **Task 1 (62c662d)** — iteration-group contract/validation/compilation. 156/156 focused;
  hostile-def probes reject (ghost participants, unscheduled routes); verdict legality
  declaration-driven. One fix round (reverted a premature Task-13 deletion that silently
  killed all live ReviewLoop enforcement — found by opus reviewer, revert verified
  byte-equivalent).
- **Task 2 (db65634)** — run-state materialization + generic CAS core. Generic records =
  source of truth; legacy collections = derived projections; 412/412. One structural fix
  round (gate-kind conflation BRICKED daemon boot on restart-after-approved-completion-gate;
  reviewer found it with a 17-case lifecycle probe suite).
- **Task 3 (187e8f7)** — closed outcome validator generalized. 25/25 + 375-caller selection;
  33-fixture legacy differential byte-identical; complete AND consensus account for every
  open finding (boss extended consensus at commit). One fix round.
- **Task 4 (5274d1e)** — generic state machine replaces review transitions. Store 149/149,
  10-file runtime selection 518/1skip; sibling-group independence AND run-wide fail-closed
  both proven by probe. Two fix rounds (parked-verdict wedge + step re-derivation + replay
  loss; then a one-predicate gate-scoping correction).
- Merge bar held every task: tsc --noEmit exactly 7 baseline errors throughout.
- Process: fresh-opus review → codex fix → same-reviewer delta re-review caught real
  mechanism-level defects EVERY task that green suites missed (premature deletion, boot
  brick, closed-schema holes, parked wedge). The loop is earning its cost.
- 3 spooled codex-dispatch cards published to ops (8b93531) after a DNS outage.

### What Did NOT Work (and why)
- **codex-deep dispatch died mid-run on DNS failure** ("No such host is known", 5 reconnects
  exhausted) — re-dispatch fresh after `socket.gethostbyname` confirms recovery; worktree was
  left clean (verify with git status before re-dispatch).
- **Parallel vitest runs fail reconciliation suites** ("secure roster file open failed (io)")
  — known load-flake; judge `authorizedFailedRunReconciliation.test.ts` ISOLATED only
  (23/23 when isolated). Builders must exclude it from parallel selections.
- **Task-1 builder overreached scope** (did Task-13's deletion 12 tasks early) — suites
  stayed green because store/execution tests hand-build proposals; only the adversarial
  review caught it. Never trust green suites on negative space.
- **Boss F4 ruling over-corrected in Task 4 round 1** (gateKind-based scoping broke sibling
  completion gates — completion gates carry no gateKind). Identity-based scoping
  (isReviewLinkedRequest) is the correct predicate.

### What Has NOT Been Tried Yet
- Tasks 5-14 per the plan (inert worker boundary; scheduling + canonical lineage pinning —
  the hardest, execution.ts:1125-1164 in scope; termination/backstops in engine; restart
  reconciliation; human-gate HTTP; W7 bridge; SPA DTOs; graph UI; ReviewLoop cutover;
  no-spend demo + live proof). Each fully specified in the plan with named tests.
- P1 live proof + Daniel's phase-acceptance gate; then phase PR via
  commit-commands:commit-push-pr; then P2-P5 (session tasklist #2-#5).

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| branch `claude/workflow-platform` @ 5274d1e | PUSHED | remote == local verified; 6 commits: spec/prompt bank, research, plan, Tasks 1-4 |
| `docs/superpowers/specs/2026-08-12-p1-termination-rule-proposal.md` | DONE | locked rule; updated in-flight (resolvedFindingRefs, park reason 'parked') |
| `docs/superpowers/plans/2026-08-12-p1-iteration-loops.md` | DONE | 14 tasks; adversarially reviewed + fix round + N1 |
| `docs/superpowers/specs/2026-08-12-p1-iteration-research.md` | DONE | evidence base, citation-verified |
| dashboard/server: types/defs/compile/proposal/compiler/store/launch/reviewOutcome (+tests) | DONE | Tasks 1-4 committed, each review-clean |
| Task-13 carried debt (in commit messages) | TODO | legacy mutate bodies; receipt compat fields unvalidated vs tamper; cyclesUsed under-count; test-only hook removal; review-block defs get new proposalId (surface at gate) |
| Task-9 carried | TODO | routes.ts:1392 pre-check must cover interventionRequestRef/gateKind (iteration-park 409) |
| Dead P0 runs run-73e28f66 + run-96ce771d | TODO | Daniel archives in dashboard (needs passkey; API requires verified operator session) |

### Exact Next Step
In the arc worktree: dispatch Task 5 ("Carry iteration requests through the inert worker
boundary") to a codex-deep worker — brief pattern = `scratchpad/p1-task4-brief.md` of session
804a7997 (baseline-first w/ flake amendment, TDD, carried-findings block, ≤2 fix rounds,
fresh opus review then delta re-review). Plan section + proposal are the contract. Then
Tasks 6-14 in order; STOP for Daniel only at the live-proof/phase gate or a plan
contradiction (plan's own stop-rule).

### Load list
- this handoff
- `docs/superpowers/plans/2026-08-12-p1-iteration-loops.md` (on the arc branch — header +
  Execution rules + Risk register + next task section)
- `docs/superpowers/specs/2026-08-12-p1-termination-rule-proposal.md` (locked rule)
- `docs/superpowers/specs/2026-08-11-workflow-platform-design.md` + `docs/superpowers/plans/2026-08-11-workflow-platform-arc-prompt.md` (arc authority, banked on the branch)
- `memory/claude-boss.md` (2026-08-13 lessons)
- Skills: dispatch-codex (workers), save-session (next pause)
- Gotchas: preamble before work; keep-awake supervisor 16h cap expired ~08:13 08-13 (old-code
  hooks re-acquire on SessionStart; status CLI parse error vs new supervisor file is cosmetic);
  reconciliation suite isolated-only; never touch main checkout (bricks terminal may be live).
