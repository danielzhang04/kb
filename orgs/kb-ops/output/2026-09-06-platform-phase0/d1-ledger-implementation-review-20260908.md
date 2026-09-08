# DRAFT - D1 implementation review notes, 2026-09-08

Status: INTERIM feedback against active WIP; no final verdict or acceptance.
Root sent the following concrete observations to the builder before freeze.
The builder owns corrections/tests; final review must use its frozen bytes.

- Real Python `json.loads`/CSV formatting can differ from JavaScript numeric
  stringification (float zero, scientific notation); quoted model/card fields
  are escaped by CSV. Direct tab-joined expected rows do not prove the actual
  `emitFleetCostRow -> ledger.py -> reinspection` path. Require a real writer
  test and preserve exact input/row meaning without a second TSV writer.
- A committed receipt with dirty current HEAD must return required before
  publisher invocation; a null cleanHead result cannot merely skip adoption.
- Publication uncertainty must retain the last checkpointed SHA. An exception's
  SHA cannot replace it without the same exact proof/checkpoint protocol.
- Durable receipt validation must recompute owned paths, verify real canonical
  day, phase/postimage/commit relationships, and run-index identity before any
  filesystem or Git effect. Mere string shape permits poisoned paths.
- At rows-appended recovery, clean but mismatching candidate proof must not
  fall through to a fresh createCommit. Distinguish normal uncommitted owned
  paths from the crash candidate case, and fail closed on uncertain identity.

The reviewed D1 design and its independent READY disposition remain authority.
No production file was changed by root for this feedback. Primitive/parser
builder gate reports70/70; Python's first collection failed at stale global
pytest temp permissions before product execution, with workspace-local retry
pending. These notes are not a formal inspector grade or a repeated-test pause.

Additional pre-freeze checks sent to builder:

- Checkpoint closures must reject after callback/lock scope has ended; otherwise
  a retained closure can save outside SQLite exclusion.
- Exercise real Python -> Git with core.autocrlf=true, matching the Windows
  repository. Builder selected canonical LF for explicitly pinned-day append
  while retaining default legacy CRLF. Exact commit blob hash proof stays intact;
  the real Git fixture must prove this instead of forcing autocrlf=false.

## Independent adversarial review addendum — REQUEST CHANGES (2026-09-08)

Reviewed the active D1 diff against `1f0084ef`, including the two untracked
receipt files, the D1 parser/ledger/queue/atomic changes, and the existing
`write/branch.ts` publisher. The accepted `publication-uncertain` rule is
intentionally fail-closed: only `committed` may adopt a replacement clean HEAD.
`publication-uncertain` follows a push/outbox one-way boundary, retains its
checkpointed SHA, and `branch.ts:1293-1301` rejects a differing HEAD before
validation. No adoption expansion is requested for that path.

Two repair items remain:

1. **HIGH — malformed shard rows can be committed and published.**
   `dashboard/server/control/fleetLedgerReceipt.ts:261-300` accepts malformed
   quoted cells because `parseTsvLine` resumes appending ordinary characters
   after a closing quote. For immutable expected model `foobar`, the invalid
   CSV/TSV cell `"foo"bar` parses as `foobar`; a complete shard is then accepted
   at `381-408`, hashed, sidecarred, committed, and published. The same value
   check at line 296 accepts `0x0` for an expected zero cost through JavaScript
   `Number()`, although it is not the pinned Python writer's normal
   decimal/scientific output. This violates Brief D's malformed-tail ->
   `required` with no commit/publication rule. Reject any non-tab/non-end byte
   after a closing quote, and require a nonnegative decimal/scientific numeric
   lexical form before numeric equality (while retaining real Python forms such
   as `0.0` and `1e-06`). Add both malformed-quote and zero-cost-hex probes that
   assert no commit or publisher call.

2. **HIGH — a sidecar mismatch poisons the durable receipt document.**
   In the intent path, `fleetLedgerReceipt.ts:397-402` assigns
   `receipt.postimage` before checking an existing sidecar. A mismatching
   sidecar returns `required`, but `atomicJsonDocument.ts:123-126` performs its
   final `save(document)` without validation. It therefore persists
   `phase: "intent"` plus a postimage, which `assertReceiptDocument` rejects at
   `fleetLedgerReceipt.ts:160-163`; all later `read`/reconcile calls fail before
   any recovery step. Keep the last valid checkpoint by computing a local
   postimage and expected sidecar, verifying/writing it first, then assigning
   `receipt.postimage` and phase together immediately before the checkpoint.
   Add a recovery test: pre-existing valid shard plus drifted sidecar returns
   `required`, the store remains readable as intent with null postimage, and
   after repairing/removing the sidecar same-key reconciliation can settle.

Verification completed:

- `npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/control/fleetLedgerReceipt.test.ts server/control/atomicJsonDocument.test.ts` — 2 files, 22 passed.
- `npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/control/queueBridge.test.ts server/planeA/ledgers.test.ts server/agents/roster.test.ts` — 3 files, 152 passed.
- The two commands cover 174 passing TypeScript tests. `python -m pytest tests/test_ledger.py` could not start any product test: all 11 fixtures failed during setup on the protected global `C:\\Users\\danie\\AppData\\Local\\Temp\\pytest-of-danie` directory. An explicit basetemp retry had the same startup-only access failure; no further retry was made. An external isolated Vitest probe was also blocked by its configured in-repo include pattern, so the sidecar finding above is source-trace evidence rather than a landed product-test result.
