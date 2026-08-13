---
id: 6a7d2a4d-ddbab266
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-workflow-platform
risk-tier: T1
owner: codex-worker
claim-token: 166bf819cd3d2436
state: done
approval: null
workflow: 019ff8d7-7536-7490-af12-b11deab99195
depends-on: []
variant-group: null
role: work
session-id: 6a7d24b6-93f0c73e
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Brief: Task-1 fix round 1 (adversarial review verdict REWORK)

Working dir: `C:/Users/danie/kb-worktrees/boss-workflow-platform` (branch `claude/workflow-platform`,
HEAD badc3b3, Task-1 work is the UNCOMMITTED diff). You fix that diff in place. NO commits.
Scope: the same 9 Task-1 files (types.ts, defs.ts+tests, compile.ts+tests, proposal.ts+tests,
compiler.ts+tests) plus AT MOST one short clarifying paragraph in
`docs/superpowers/specs/2026-08-12-p1-termination-rule-proposal.md` (see F4 ruling).

Read first: plan Task 1 (docs/superpowers/plans/2026-08-12-p1-iteration-loops.md) + proposal
schema/termination sections. A fresh opus adversarial review found 2 BLOCKERs, 4 MAJORs,
6 MINORs. Apply per boss rulings below. Findings text follows the rulings — trust its file:line
cites but re-verify anything you build on.

\## Boss rulings

- **F1+F2+F7 (BLOCKERs + minor, one root cause):** REVERT the premature Task-13 deletion.
  Restore `review` and `completionGate` emission on compiled `ProposalStage` (compile.ts:454-456
  area) exactly as before the diff. Revert compiler.ts:129 to the original
  `Boolean(stage.review)`-based derivation AND revert compile.ts:408-410/:439 to the original
  `!stage.review` write-target derivation — compile-time and runtime (`execution.ts:1456`,
  untouched) must agree everywhere until Task 13 swaps BOTH in lockstep. The plan's named test
  `does not grant checker-readonly tools from an iteration role label` must assert something
  REAL under review-based derivation: an iteration participant labeled `judge`/`mediator` on a
  stage WITHOUT `review` keeps its normal scope (role label grants nothing) — build a fixture
  where the assertion distinguishes the behavior (fails on a role-driven implementation).
- **F3 (MAJOR, dangling participants/routes):** Add validation: every participant must be the
  recipient of at least one REACHABLE schedule step (the seed participant's activation counts as
  its entry); every declared route must be referenced by at least one schedule step. Fix the
  fan-in `compile.test.ts` fixture to declare the missing schedule step for its `peer-to-judge`
  route instead of riding the hole. Negative tests for both rules.
- **F4 (MAJOR, role→verdict tables):** DELETE `participantVerdicts` / `terminalVerdictForRole`
  (defs.ts:367-388, proposal.ts:732-747). Verdict legality is DECLARATION-driven:
  * Terminal legality = exactly the `terminalAuthorities` entries. Any participant may be
    declared terminal authority for any of `accept | pass | consensus | complete` — role is
    irrelevant (the spec's checker-records-`pass` example must be representable).
  * A participant's nonterminal vocabulary = the verdicts named in schedule `after` conditions
    with that participant as subject, plus `fulfilled` when the participant is the recipient of
    an artifact-producing request kind (`rework`/`delegate`), plus `parked` always (see F5).
  * Coverage check (exhaustive reachable-verdict rule): every (participant, nonterminal verdict)
    in that vocabulary except `parked` has exactly one matching successor step (ambiguity still
    rejected); terminal-authority verdicts must have none.
  You MAY add one short paragraph to the proposal's schema-sketch section documenting this
  vocabulary derivation (it implements the existing "routes and terminal authorities determine
  behavior" law — do not change any rule).
- **F5 (MAJOR, parked):** `parked` is a universal verdict: always legal for every participant,
  always terminal-to-human-gate at platform level, EXEMPT from successor coverage. Remove the
  dead skip branches; document the exemption where the coverage check lives; one test: a def
  with no parked successors validates, and parked appears in every participant's vocabulary.
- **F6 (MAJOR, mandatory after):** `after` becomes optional on `initialStepId` ONLY (activation
  triggers it); required on every other step. Remove the fabricated circular predecessor from
  fixtures; verify the legacy compiled group still validates; test: a one-shot schedule (single
  step, no after) validates.
- **F8:** Require nonempty group `artifacts` and nonempty `seedArtifactIds` (def-side and
  proposal-side). Legacy compilation: if the subject stage declares no artifacts, that is a
  validation error for defs carrying `review` (fail loudly, do not invent artifacts).
- **F9:** Register stage-level `completionGate` ids in the same `gateIds` namespace as iteration
  group gate ids; cross-check both in defs.ts and validateProposalIterationGroups; collision test.
- **F10:** Mirror the per-participant goal rule (goal only on an accepting manager/coordinator)
  in the proposal-side validator; drift test.
- **F11:** No code change. Note in your final report that any def with a `review:` block gets a
  new proposalId (intentional — semantics changed); the boss surfaces it at the gate.
- **F12:** Strengthen the two vacuous tests: the cycle-boundary test must reject a schedule
  whose `cycle` markers are inconsistent (e.g. a `next`-cycle step whose predecessor is in the
  same declared cycle when the schedule's shape makes that ambiguous — assert a real validator
  behavior, or if no cycle arithmetic exists in Task 1, rename the test to what it actually
  asserts and add the arithmetic assertion where it belongs per the plan). The compiler test is
  covered by the F1/F2 ruling above.

\## Acceptance
- Focused suites (defs, compile, proposal, compiler) green including your new negative tests;
  ALSO run `npx vitest run server/control/store.test.ts` and confirm the review/completionGate
  restoration keeps 301-suite behavior intact (spot-run store + routes + queueBridge).
- `npx tsc --noEmit` = exactly 7 baseline errors.
- `git diff` no longer touches ANY compiled-proposal emission of review/completionGate relative
  to HEAD except where a test needed a fixture.
- Final message ≤16 lines: per finding one line what changed; test counts; suite + tsc numbers.

\## The review, verbatim (evidence)

F1 BLOCKER: compile.ts:454-456 removed review/completionGate from compiled ProposalStage; review is compiler-only (proposal.ts:650 refuses it elsewhere) → store.ts:3390 never creates ReviewLoops; store.ts:2439 invariant vacuous; execution.ts:1190/1947 fail-closed checks unreachable; execution.ts:1899 review contract never reaches worker; execution.ts:754 rework budget drops to 0. Suites stay green because store/execution tests hand-build proposals still carrying review.
F2 BLOCKER: compiler.ts:129 now profile-based but execution.ts:1456 still `Boolean(proposalStage.review)` — permanently false post-F1 → compiled policyHash != stage-boundary recompute; checker writes trip target-outside-approved-write-scope at runtime after passing compile.
F3 MAJOR: dangling participant `ghost` with unscheduled route validates ok:true (proved); visited.size check (defs.ts:673) catches unreachable steps only; compile.ts:466-471 adds seed edge to ghost stage → runs unfenced. Builder's fan-in test rides this hole.
F4 MAJOR: defs.ts:367-388 / proposal.ts:732-747 role→verdict tables decide terminal legality (defs.ts:633, proposal.ts:1001) — contradicts spec:52-53 and spec:92; contributor can never be terminal; checker-records-pass unrepresentable; mediator hardcoded ['consensus','continue'] regardless of requestKinds.
F5 MAJOR: parked in verdict enum but participantVerdicts never returns it; skip at defs.ts:665 dead; proposal.ts:1010 lacks it; runtime parked receipt has no validated successor/coverage.
F6 MAJOR: defs.ts:546 / proposal.ts:911 require `after` on every step incl. initialStepId (spec:219 says optional) → circular fabricated predecessor hashed into identity; one-shot schedule has no legal encoding.
F7 MINOR: compile.ts:408-410/:439 swapped !stage.review for workflowProfile — created F2 asymmetry; strips write scope from non-review checker-profile stages.
F8 MINOR: artifacts: [] and seedArtifactIds: [] validate → activation-before-pinned-artifacts rule vacuous for such groups.
F9 MINOR: gate-id collision possible between iteration group completionGate.id and stage-level completionGate ids (defs.ts:1121 registers only the former).
F10 MINOR: proposal-side lacks the per-participant goal rule defs.ts:626-631 enforces.
F11 MINOR: any def with review: block gets a new proposalId (groups enter deriveProposalId preimage, compile.ts:102) — call out at gate.
F12 MINOR: two vacuous tests — cycle-boundary test only echoes parsed shape; compiler role-label test passes on unmodified HEAD.

## Result

- F1: Restored compiled stage `review` and `completionGate`.
- F2: Restored `Boolean(stage.review)` policy derivation.
- F3: Rejects dangling participants/routes; fan-in fixture schedules every route.
- F4: Verdict legality and vocabulary are declaration-driven.
- F5: `parked` is universal, terminal-to-human, and coverage-exempt.
- F6: `after` is optional only for initial steps; one-shot schedules validate.
- F7: Restored review-based proposal/stage write scopes.
- F8: Artifacts/seeds must be nonempty; artifactless legacy reviews fail.
- F9: Unified gate namespace with narrowly validated legacy alias.
- F10: Proposal validator now mirrors participant-goal rules.
- F11: Definitions containing `review:` intentionally receive a new proposalId.
- F12: Cycle and role-label tests now assert distinguishing behavior.
- Tests: focused 156/156; store/routes/queueBridge 275/275.
- TypeScript: exactly 7 baseline errors. Diff check clean; no commit created.
