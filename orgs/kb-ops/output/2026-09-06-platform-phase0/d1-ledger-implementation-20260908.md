# DRAFT — D1 fleet-ledger implementation, 2026-09-08

**Status: implementation frozen after builder gates; awaiting independent adversarial review.** This draft does not claim acceptance, authorize publication, or mark Phase 0 complete.

## Implemented boundary

The D1 implementation adds a checkpoint-capable method to the existing SQLite-serialized atomic JSON document. A checkpoint validates and atomically saves the current document while the SQLite mutex remains held. The callback continues under the same mutex, and an escaped checkpoint closure refuses after that transaction ends. Callback and checkpoint failures, including falsey thrown values, bypass the ordinary final save and SQLite commit; an already-renamed checkpoint remains the durable recovery boundary.

`scripts/ledger.py:append` now accepts an optional exact ISO day. Omission preserves its existing current-day and CRLF behavior. A supplied day is validated before path formation and uses canonical LF output, which keeps the receipt's working postimage identical to the committed blob under the Windows coordination checkout's `core.autocrlf=true`. The queue bridge passes the receipt's pinned day through the existing Python writer; no TypeScript TSV writer was added to production.

`FleetLedgerReceiptStore` persists one immutable receipt per canonical sorted `{subject,runRef,rows}` snapshot and a one-to-one hashed subject/run index. The decoder recomputes the receipt key, run identity, pinned paths, and phase field constraints before an effect can use them. It rejects invalid calendar days, poisoned paths, missing/extra run-index entries, and inconsistent postimage/commit phases. The document remains size-bounded and uses the shared atomic JSON primitive.

Both begin and reconciliation run the fleet preamble before receipt access, then enter `withOpsTransaction` before the receipt's cross-process SQLite mutex. They checkpoint `intent` before append, inspect the receipt-unique shard as an exact sorted-row prefix, append only the missing suffix through `ledger.append`, require the complete semantic TSV rows, write and re-read the canonical sidecar, and checkpoint `rows-appended`. TSV inspection implements the Python CSV quote rules and compares the parsed numeric USD with the immutable integer-micros value, so Python spellings such as `0.0` and `1e-06` retain their exact accounting meaning.

Commit creation owns exactly the cost shard and sidecar. A clean current `HEAD` at `rows-appended` is treated as an adoption candidate and must pass the shared one-parent, exact-two-path, exact-shard-postimage, and exact-sidecar proof; a failed candidate creates no replacement commit. Only the expected dirty set of those two owned paths may enter commit creation. A landed commit whose receipt checkpoint failed is adopted by that same proof.

Publication uses the existing `publishPreparedCoordinationCommit` hook. Its `validateCommit` callback runs the same proof and checkpoints any replacement SHA before returning. A committed or publication-uncertain receipt with a dirty checkout starts no publisher. The bounded rebase-crash recovery inspects only a clean current `HEAD`, adopts it only after the full proof, and checkpoints it before publisher invocation. `PublishedCoordinationCommitError` may mark `publication-uncertain` only when its SHA equals the already-checkpointed SHA; an unproven error-carried SHA never replaces durable identity. Completion requires the publisher return the currently checkpointed SHA and a final exact commit proof.

Plane A strips only a terminal `--fleet-<64 lowercase hex>` suffix from a ledger writer before slicing. The roster consumes the same parser, so receipt-qualified shards contribute activity to the original writer and create no synthetic agent identity. Nonconforming suffixes remain ordinary writer names.

The legacy queue bridge settlement surface now prepares and starts the durable receipt operation while preserving its existing `{emitted,blocked}` result for current callers. The optional receipt-store dependency is the composition seam for Brief B's required generation-retained store; its temporary fallback preserves existing direct callers until B owns construction and passes the same store to begin and reconciliation.

## Builder verification

- Shared preamble: PASS.
- Python ledger tests: first invocation reached no test bodies because pytest could not access its stale global `%TEMP%/pytest-of-danie` base directory. The workspace-local basetemp rerun passed **11/11**.
- Atomic document, Plane-A ledger, and roster focused tests: **70/70 PASS**.
- Initial atomic-document plus receipt focused run: **13 passed, 4 failed** because the synthetic test append helper did not encode quoted fields like Python CSV. Production's real Python-seam test already passed. The helper was corrected without weakening the parser; the bounded rerun passed **17/17**.
- Queue bridge focused tests: **87/87 PASS** before the final pinned-day assertion was added.
- Intermediate full dashboard typecheck: **PASS**.
- Final combined native Vitest gate across the atomic document, receipt protocol, queue bridge, Plane-A ledger, and roster suites: **174/174 PASS**.
- Final Python ledger gate with a workspace-local basetemp: **11/11 PASS**.
- Final full dashboard typecheck: **PASS**.
- Final owned-file `git diff --check`: **PASS** (Git emitted only the checkout's existing LF/CRLF conversion notices).

No production ledger was written and all Git publication evidence used disposable local repositories and bare remotes.

## Bounded review correction evidence

The independent review addendum released two corrections. Test-first focused
evidence on the frozen implementation produced **15 passed / 3 failed** in the
receipt suite: both malformed-row probes incorrectly returned `settled`, and
the sidecar-conflict probe made the store unreadable with
`fleet ledger receipt phase is invalid`. This is the expected red evidence for
the two reviewed findings; no unrelated scenario failed.

The correction makes a closing quote terminal for its TSV field: only a tab
or end-of-line may follow it. USD additionally requires a nonnegative
decimal/scientific lexical form before numeric comparison, preserving the real
Python forms `0.0` and `1e-06` while rejecting `0x0`. The receipt now computes
postimage and expected sidecar in locals, verifies or writes the sidecar, then
assigns postimage and `rows-appended` together immediately before checkpoint.
A conflicting sidecar therefore leaves the last durable state as readable
`intent` with null postimage.

Focused correction rerun: **18/18 PASS**. Final D1 native gate across the same
five suites as the prior 174-test gate, plus the three new probes: **177/177
PASS**. Final dashboard typecheck: **PASS**. Python code was unchanged during
this correction; the prior builder **11/11 PASS** remains the applicable Python
evidence.
