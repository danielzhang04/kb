# DRAFT — D1 fleet-ledger design re-review, 2026-09-08

**Verdict: REQUEST CHANGES — one bounded recovery rule remains.** This is a
read-only review of `d1-ledger-design-20260908.md`; no implementation or tests
were run.

## Corrections now incorporated

The revised design preserves the fleet runnable preamble before every receipt
lookup or effect, validates a supplied ledger day as exact ISO `YYYY-MM-DD`,
and uses a receipt-qualified cost shard with a strict Plane-A parser boundary.
It correctly makes `withOpsTransaction` the outer lock and the receipt SQLite
mutex inner for every D entrypoint. A checkpoint failure escapes the
checkpointed callback and maps outside it to `required`, preventing the
ordinary final save/COMMIT from following an ambiguous checkpoint. It also
uses the existing `publishPreparedCoordinationCommit.validateCommit` hook,
rather than expanding the publisher API: the hook proves and checkpoints a
replacement rebased SHA before that SHA can be pushed.

## HIGH — rebase before the validation checkpoint still strands a proven receipt

`publishPreparedCoordinationCommit` changes local `HEAD` to the rebased commit
at `write/branch.ts:1341`, then calls `validateCommit` at line 1347. A process
crash in that interval leaves the receipt naming the original prepared SHA and
leaves the rebased commit at `HEAD`. The current draft permits only the stored
old SHA on restart and otherwise requires human reconstruction. That strands a
normal same-key recovery even though its immutable receipt witness can prove
the rebase exactly; it does not satisfy the planned reconciliation of proven
missing phases.

Require this bounded adoption branch before any append or new commit. It is
available only for a `committed` receipt whose stored original SHA cannot be
used as the clean local `HEAD`:

1. Require a clean checkout and inspect only the current `HEAD` candidate.
2. Require a valid one-parent candidate whose complete changed-path set is
   exactly the stored receipt's two owned paths.
3. Read both candidate blobs and require the cost-shard postimage hash and the
   sidecar bytes to equal the durable receipt's immutable key, canonical input,
   pinned day, and owned paths.
4. Checkpoint an explicit `committed { commit: candidateSha }` replacement
   before handing that SHA to the existing publisher. A checkpoint failure is
   `required` and starts no later effect.

Any failed proof, dirty checkout, missing candidate, extra changed path, or
nonmatching sidecar/postimage remains `required`; recovery must not search
history, infer success from a coincidental `HEAD`, append rows, or create a
replacement commit. The normal publisher then re-proves/rebases the adopted
SHA under its existing hook. This handles only the precise rebase-before-hook
crash and preserves the draft's explicit `required` behavior for all other
ambiguous publication states.

Focused evidence must hold the rebase after `HEAD` changes and before the
hook, restart with the old receipt SHA, prove the exact candidate is adopted
and no row/commit is duplicated; mutate any candidate path or sidecar byte and
prove `required` with no append, commit, or publication.
