# DRAFT - A1 implementation review, 2026-09-08

Status: INTERIM; production and expanded tests are still owned by the builder.
This records root review feedback and does not accept the unfinished slice.

The review found and returned these concrete cleanup issues to the builder:

1. A falsey close rejection must remain failure. The initial cleanup used a
   nullable failure sentinel, allowing `reject(null)` to resemble success and
   permit removal. The builder reports an explicit failure boolean correction;
   final frozen evidence remains to be reviewed.
2. The close-issued bit must be set before calling the controller. A synchronous
   throw previously prevented memoization, so the withdrawal observer and later
   cleanup could issue close twice. The builder reports one-shot rejected-promise
   memoization; final frozen evidence remains to be reviewed.
3. The real managed controller discarded a false C PortResult. That independent
   two-file correction is accepted at `fc5e7100`, with root 17/17 and full
   typecheck passing. A1 still needs the real engine/controller/C composition
   proof that refusal blocks worktree removal while receipt/result are observed
   and the reservation is settled once at zero usage.
4. In `executeAttemptUnsafe`, the operator-cancellation branch immediately after
   an accepted reservation still directly awaited `accounting.settle` without
   tracking, settlement-state bookkeeping or a post-await admission check.
   Hold this zero settlement, revoke the lifetime, then resolve it: the method
   returns stopped without entering owned withdrawal cleanup. The outer engine
   rejects withdrawal, but the owned worktree remains. A rejection in this seam
   can also leave the state at none and allow another settlement call. The
   builder was asked to track the issued promise, record issued/succeeded, check
   admission afterward, and prove one zero settlement plus strict cleanup using
   a held-seam regression. This is the first review of this specific scenario.

Last builder full focused checkpoint before expanded cases: 121/121 PASS.
Expanded lifetime, tokenless and real composition cases are not yet accepted.
Root does not treat these counts as final A1 or integrated Phase 0 evidence.
