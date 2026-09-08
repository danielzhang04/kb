# DRAFT — A1 engine/grant preflight review, 2026-09-08

Reviewer: `codex-worker`
Reviewed plan: `a1-engine-grant-preflight-20260908.md`
Status: **REQUEST CHANGES — no implementation authority**

## What is sound

The proposed atomic window is correctly limited to `execution.ts`,
`execution.test.ts`, `spendGrantProvision.ts`, and
`spendGrantProvision.test.ts`. `ExecutionLifetime` and
`SpendGrantProvisionOutcome` already exist as accepted supporting surfaces;
the only production hook producer is `createSpendGrantProvisioner`, so changing
its return type in the same window preserves the frozen `activation.ts` call.
The strict promise outcome is preferable to a void union.

The tokenless tuple amendment is also correct: an unstarted attempt and its
session must be `interrupted`, while the stage and run are
`waiting-human`. Existing `stageBoundary` can move an accepted boundary to
ready, and `prepareAttempt` can make exactly one successor from an interrupted
attempt. This avoids using mutable title/prompt prose or a stage's current
attempt as authority. A batch `createHumanRequests` key derived from the
128-character bounded attempt reference fits the store's 512-character key
limit and gives one boundary per attempt. An early Resume while the grant stays
live therefore creates a new interrupted attempt and its own boundary; it does
not touch a later unrelated waiting attempt.

## Required corrections

1. **Withdrawal after `workers.begin` must settle zero only.** The cleanup
   table currently says to settle the observed worker result through the
   ordinary accounting path. That conflicts with the common contract: after
   lifetime withdrawal, the only settlement for an issued reservation is
   `settle:<attemptRef>` with zero usage. The plan must require observing and
   draining both native receipt/result promises, performing owned
   cancellation/close before worktree removal, then exactly one same-key
   zero-usage settlement and one removal. It must prohibit a ceiling fallback,
   a new usage projection, and any post-withdrawal run-store projection.

2. **Make rejected cleanup a real, observable barrier.**
   `ExecutionLifetime.track()` removes an entry on either fulfillment or
   rejection. Merely tracking a removal/settlement promise cannot support the
   plan's statement that rejection remains visible and blocks B unlock. Do not
   add a global failure map. Instead, define the caller-owned completion path:
   the affected engine invocation must await the exact cleanup promises and
   return/reject their failure to its owner, which must not bind a replacement
   generation until that completion is observed. The plan must state this
   precisely and add a rejected-zero-settle and rejected-remove test proving no
   silent completion and no later worker admission.

3. **Tokenless cleanup cannot use the present best-effort helper unchanged.**
   `cleanupAttemptWorktree()` currently catches removal failures, appends a
   non-fatal event, and returns. For the tokenless order, that would let a
   failed removal proceed to boundary creation and eventually a successor,
   contrary to the required one-remove/no-retry fail-closed behavior. Specify
   a caller-owned strict cleanup path for tokenless and withdrawal cleanup:
   zero settlement succeeds before boundary creation; a single remove failure
   is surfaced to tracked completion, creates no silent ready path, and cannot
   call `workers.begin`. It must not append a retired-generation event after
   withdrawal. The focused test needs a stateful accounting fake where Resume
   would be refused if the reservation leaked, rather than an always-successful
   fake.

4. **Separate forward admission from allowed operator cleanup.**
   The guard map says every transition helper is protected, while `cancelRun`
   and `containManagerStart` deliberately remain callable after revocation and
   reuse those helpers. The plan must place guards at forward callers (and at
   async continuations) while retaining an explicit local cleanup/control path
   for these two methods. A process-wide or long-lived “mute lifetime” flag is
   unacceptable because a concurrent retired callback could use it to mutate.
   Add regressions that prove a revoked forward continuation has zero
   projections, while post-revoke `cancelRun` and `containManagerStart` still
   perform only their authorized cancellation/containment convergence.

5. **Expand the proof around outer continuations.** The listed seam tests are
   useful but must cover `runToBoundary` capacity wait, `Promise.all` attempt
   joins, and `settleRunState` manager-shutdown continuation with a held
   promise. Each must assert before and after await and produce no
   post-withdrawal boundary/event/transition. The existing broad catches,
   including `recoverCaughtIterationResult`, must rethrow
   `ExecutionWithdrawnError` rather than contain it.

## Release criteria

After these corrections, the four-file window can be released only with tests
for: strict outcome mappings; the complete interrupted tokenless tuple;
accepted/denied/early-live/unrelated-request Resume behavior; held seams and
outer continuations; zero-only accounting after withdrawal; cleanup rejection
visibility; and post-revoke cancellation/containment. B remains gated on
accepted A, C, and D surfaces. No frozen adapter, activation, store, public
DTO, C, or D1 change is required by this review.
# Coordinator closure after the first revision

Root reviewed the revised preflight against the five findings and the accepted
A0/common contract on 2026-09-08. The revised plan is technically ready for the
bounded four-file implementation window. This is the coordinator's closure of
the initial REQUEST CHANGES verdict below, not a claim that the reviewer reran
tests or a formal inspector grade.

The revision requires zero-only newly issued settlement after withdrawal,
observes an already-issued normal settlement without issuing a second one,
observes both worker promises and owned cancellation before strict removal,
separates strict tokenless cleanup from best-effort terminal cleanup, and adds
caller-scoped guards and held outer-continuation tests. Its stateful accounting
fixture must prove a resumed reservation can actually acquire the released slot.

The accepted lifetime removes pending labels on both fulfillment and rejection.
A cleanup failure is propagated and observed; it does not create a retained
failure barrier, prove resource cleanup succeeded, or independently block B's
Unlock. No new failure map, permanently pending promise, or retry is introduced.
The implementation must preserve these explicit limits.
