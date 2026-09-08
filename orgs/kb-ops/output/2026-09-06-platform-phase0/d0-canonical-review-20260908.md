# DRAFT — D0 canonical admission review, 2026-09-08

**Technical verdict: READY.** This independent re-review covers only
`canonicalResultIntegrator.ts` and `canonicalResultIntegrator.test.ts` in the
corrected D0 working diff. It finds no remaining concrete correctness or
security blocker for the bounded port. This is not integrated Phase 0
acceptance.

## Findings closed in this correction

The original no-card final-lineage-proof issue is closed. The Git and
coordination-Git wrappers check both sides of their awaited runners; the final
lineage proof, final lineage-head, canonical verification, and public-result
projections now have outer admission checks. A withdrawal therefore retains an
already-issued `lineage-local` receipt but cannot promote it to canonical
success or return a resolved base.

The subsequent outer-continuation issue is also closed. A post-await guard in
an inner Git helper does not guard a caller's later continuation: a queued
withdrawal can run after that helper's post-check and before the caller begins
a new mutation. The correction adds local admission checks immediately before
the lineage-parent `mkdirSync` and before constructing and persisting a fresh
integration `intent`. The two deterministic held-seam tests cover that exact
scheduler shape and prove that withdrawal creates neither an integration
directory/worktree nor a fresh journal record. The builder reported that those
tests were red against the preceding 43-test source and green after the two
guards.

All other forward paths reviewed here remain fenced: serialized callbacks
check before entering a queued operation; Git and publisher calls check before
issuance; final lineage/card verification checks before success projection; and
post-issued state writes remain the allowed durable receipts rather than new
forward effects.

## Security review

The port adds no credential handling, external destination, public route, or
authority. The admission callback is optional for compatibility and defaults
to a no-op until the later lifetime wiring stage. With a supplied callback, the
new local guards cover the two previously reachable post-await filesystem and
journal mutations.

## Verification and scope

- Builder-reported: focused `canonicalResultIntegrator.test.ts`, **45/45
  passed in 2.64 s**. The two new scheduler regressions were red before the
  correction and green after it.
- Reviewer ran `git diff --check --
  dashboard/server/control/canonicalResultIntegrator.ts
  dashboard/server/control/canonicalResultIntegrator.test.ts`; it passed
  (Git printed only the existing Windows line-ending warnings).
- I did not run focused tests, typecheck, or broad suites while C0 remains
  active, so the builder result is reported rather than independently
  reproduced.
- Excluded: C0 claim-store work, engine/lifetime binding, activation, routes,
  frozen Slice 1A files, and production actions.
