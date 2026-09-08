# DRAFT — D1 fleet-ledger design final re-review, 2026-09-08

**Current verdict: TECHNICALLY READY — design only.** The bounded candidate
adoption rule closes the prior recovery finding. This verdict authorizes no
implementation, commit, merge, publication, or Phase 0 completion. This was a
read-only review of the fresh `d1-ledger-design-20260908.md` diff and the
existing `dashboard/server/write/branch.ts`; no implementation or tests were
run.

## Current disposition

The revised recovery branch is limited to a `committed` receipt whose stored
SHA differs from the current clean checkout `HEAD`. Under the already-required
outer `withOpsTransaction` and inner receipt SQLite mutex, it reads only that
one current candidate. The shared proof requires exactly one parent, exactly
the receipt's two owned changed paths, the exact cost-shard blob hash pinned by
the durable postimage, and exact canonical sidecar bytes regenerated from the
receipt's immutable key, prepared input, day, owned paths, and postimage. `HEAD`
alone grants no authority.

Only a candidate that passes every check may replace `committed.commit`, and
that replacement is checkpointed before the existing publisher is invoked. A
checkpoint throw, including a falsey value, escapes the receipt callback and
maps to `required` after lock release; it cannot fall through to the primitive's
final save or to publication. A dirty checkout, absent or invalid candidate,
non-single-parent commit, missing or extra path, changed shard or sidecar blob,
or any key/input/day/path/postimage mismatch returns `required` with zero
append, new commit, or publication.

This matches the existing publisher's real order. It rebases at
`dashboard/server/write/branch.ts:1335`, reads replacement `HEAD` at line 1341,
calls `validateCommit` at line 1347, and cannot push until line 1360. D's same
proof routine therefore revalidates the initial/adopted SHA and every later
rebased SHA. A replacement callback checkpoints that SHA before returning; a
proof or checkpoint rejection prevents its push. The returned publication SHA
must still equal the currently checkpointed receipt and pass the exact blob
proof before `completed` is checkpointed.

The recovery exception performs no history search, append, commit, amend,
reset, rebase, publication, completion inference, or automatic retry. After its
checkpoint it delegates once to the existing bounded publisher. Ordinary
already-ancestor and outbox recovery remain publisher-owned. Publication
uncertainty retains the last checkpointed SHA and permits only same-SHA
publication/proof reconciliation; it never re-enters append or commit creation.

The required evidence is sufficiently concrete. The held rebase-before-hook
case must prove adoption, checkpoint-before-publication, and zero duplicate
append/commit. Its negative matrix covers dirty checkout, absent candidate,
zero/multiple parents, missing/extra paths, either changed blob, every immutable
sidecar field mismatch, and checkpoint failure, all with zero publication. The
same negative proof/checkpoint matrix applies inside `validateCommit` after
every publisher rebase: corrupt paths/blobs or a rejected replacement
checkpoint must produce zero push. This is an implementation acceptance reading
of the design's shared-proof rule, not an added authority or scope expansion.

The rest of the design remains intact: runnable preamble before receipt access,
outer ops lock before the cross-process receipt mutex, checkpoint throws
escaping, receipt-unique shards, exact ISO pinned-day validation with default
Python compatibility, Plane-A writer normalization and cost attribution,
same-run immutable input refusal, and two-store SQLite serialization. Browser
DTOs, the publisher API, and roster production code remain unchanged.

## Authorization and failure history

The earlier D1 design correction cycle had reached the repository's
twice-failed-scenario pause. That evidence remains historical and is not erased
by this verdict. The user's 2026-09-08 overnight directive renewed authority
for one bounded D1 design correction and review cycle; it did not itself accept
the design or authorize implementation. The current READY verdict follows the
fresh correction and independent review under that renewed authorization.

## Prior REQUEST CHANGES disposition (preserved)

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
