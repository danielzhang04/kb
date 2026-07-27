# FYT autonomous runner — pickup

Date: 2026-07-21

## Resume point

- Worktree: `C:\Users\danie\kb-worktrees\fyt-autonomous-runner`
- Branch: `codex/fyt-autonomous-runner`
- HEAD: `28c9aac feat(control): park exhausted review loops`
- The primary checkout must remain parked on `main`.
- Continue only on this feature branch. Do not merge or rebase `main` into it; finish the branch, run merge checks, push the branch, and open a PR for Daniel to approve.
- Wave A live-fire is complete and the earlier daemon/runtime freeze has been lifted.
- No implementation edits were made after `28c9aac`; the next checkpoint is still cleanly unstarted.

## Completed and committed

- First-class FYT Runner, pre-production, production, and checker agent declarations.
- Per-agent and per-workflow-stage immutable runtime/model assignments.
- Registered FYT workflow/checker contracts and completion-gate definitions.
- Durable stage generations, checker attempt provenance, review receipts, bounded creator rework, completion gates, and crash/replay validation.
- Exactly-once intervention when the creator rework budget is exhausted.
- Worker sessions may now be created only for queued attempts; exhausted parking CASes creator/checker attempts and requires any attached worker sessions to be completed.
- Latest checkpoint verification: `dashboard/server/control/store.test.ts` 80/80 passed, `npm.cmd run typecheck` passed, `git diff --check` passed, explicit `gpt-5.6-terra` adversarial review returned GO.

## Preserve untouched

These user-owned untracked paths are not part of this work:

- `.playwright-mcp/`
- `acceptance.sh`
- `orgs/faceless-youtube/channels/_test-pipeline/videos/2026-07-02-car-sinks/assets/`
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-04-poyais/assets/`

Do not build `dashboard/dist`, restart the daemon, push, merge, or alter the primary checkout without a later explicit step that requires it.

## Exact next task

Wire the committed review/generation control plane into `AutomaticExecutionEngine`. Do this as two independently reviewed checkpoints.

### Checkpoint A — canonical durability seam

Current facts:

- `dashboard/server/control/execution.ts` defines `WorkerExecutionResult.reviewOutcome`, but `CanonicalStageResult` and `canonicalStageResultHash` discard it.
- `dashboard/server/control/canonicalResultIntegrator.ts` already journals `attemptBaseCommit` and `integrationCommit`, but `ResultIntegrator.lookup`/`integrate` expose only a result hash.
- A crash after checker integration but before `recordReviewReceipt` therefore loses the checker verdict and cannot reconcile safely.
- The engine always uses `result:<run>:<stage>` and canonical integration currently deduplicates one result per stage. Reworked generations require the existing store convention: g1 stays `result:<run>:<stage>` and gN uses `result:<run>:<stage>:gN`.

Implement the smallest extension that durably returns/replays:

- validated checker `reviewOutcome` as part of the canonical result and its hash/journal/card;
- immutable attempt base commit and canonical integration commit;
- generation-aware result identity so g2+ cannot collide with g1.

Primary files/tests: `execution.ts`, `canonicalResultIntegrator.ts`, `adapters.ts`, and their focused tests. Preserve the existing Claude worker adapter/parser and canonical integration infrastructure; do not create a parallel runtime.

### Checkpoint B — execution state machine

Current deliberate stub:

- `AutomaticExecutionEngine.preflightReviewRuntime` and the review branch in `stageBoundary` park every checker with `review-loop-durable-state-not-yet-available` before policy resolution or worker spawn.

Replace that stub with the existing store APIs:

1. For a creator stage owned by a review loop, integrate its canonical result, finish session/attempt, and call `recordStageGeneration` with exact generation, result hash, base commit, canonical commit, and g1/gN operation key before dependent release.
2. Create the checker attempt bound to the active committed generation (`reviewSubjectGenerationRef`, result hash, canonical commit).
3. Pass the immutable `reviewContract` to the existing worker adapter; require a validated `reviewOutcome` for checker success.
4. Finish checker session/attempt/stage, then call `recordReviewReceipt` using the durable canonical outcome.
5. Outcome routing:
   - pass without completion gate: loop passes and downstream may release;
   - pass with gate: call `attachReviewCompletionGate`, return `waiting-human`, and release only after the dedicated gate resolver marks the receipt/loop passed;
   - fail below bound: call `advanceReviewGeneration`; creator becomes ready for gN+1 and checker becomes blocked;
   - fail at bound: call `parkExhaustedReview` and return `waiting-human` with exactly one linked intervention;
   - parser decision `parked`: retain the store-created intervention and wait.
6. Reconciliation must replay every operation exactly after crashes; never mutate reserved review requests through generic Human Request APIs.

Important existing store behavior:

- `recordStageGeneration` moves the loop to `checking`.
- `createAttempt` accepts checker provenance only for the active committed generation.
- `recordReviewReceipt` owns pass/fail/parked state and creates parser-parked intervention.
- `stageMaySucceed` permits the checker stage to record its terminal execution before the receipt transition.
- `dependenciesSucceeded` permits only the checker to consume an unaccepted subject generation; all other consumers require `loop.state === passed` and the exact accepted generation.

## Remaining roadmap after engine wiring

1. Dedicated completion-gate resolution route/UI using `resolveReviewCompletionGate`.
2. Standalone persistent agent sessions: open an agent, chat/run/resume it independently.
3. Dashboard model controls for individual agents and workflow stages.
4. Complete FYT Runner + specialists + Checker workflow registration.
5. Bounded end-to-end acceptance run.
6. Merge checks, push `codex/fyt-autonomous-runner`, and open a PR into `main` for Daniel's approval.

## First commands next terminal

```powershell
Set-Location C:\Users\danie\kb-worktrees\fyt-autonomous-runner
python scripts/preamble.py
git -c safe.directory=C:/Users/danie/kb-worktrees/fyt-autonomous-runner status --short --branch
git -c safe.directory=C:/Users/danie/kb-worktrees/fyt-autonomous-runner log -3 --oneline
```

Then read `CLAUDE.md`, `governance/agent-rules.md`, `orgs/faceless-youtube/contract.md`, the project `CLAUDE.md`/operating law, and this pickup before editing.
