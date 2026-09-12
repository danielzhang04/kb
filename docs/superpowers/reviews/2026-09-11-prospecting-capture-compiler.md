Verified responding models: claude-opus-5 in worker51,55,57,60,65,68 assistant stream receipts.

# Capture import compiler review

Accepted for deterministic, read-only compilation and private export input. The compiler
resolves exact capture task/receipt/hash identities, verifies session/run/intake scope,
rehashes captured bytes, slices exact Unicode codepoint spans, and supplies importer byte
preconditions. P17/P18 still own semantic validation and request identity.

Independent review65 accepted the binding, bounds, privacy and importer-precondition
invariants but requested explicit occurrence pairing before durable export. Repair68 adds
candidate/page ordinals without deduplicating shared captures or changing importer request
objects. Funding and shared-person occurrence tests verify exact mappings. Raw SQLite
resolution failures now become the fixed capture_unresolved code.

Root verification: compiler and importer hash-precondition suites, 62 passed in24.73s.
Earlier compiler60 plus preconditions passed60tests; syntax-broken57 was never applied.
The earlier review55 claim that a3year funding window meant3months was false and rejected;
fixture dates were preserved. Tests demonstrate real import compatibility, tamper refusal,
scope/expiry/bounds, and shared-page provenance; no actual browser capture is claimed.

Limits: compilation is read-only and results remain in RAM until a separate export path
persists them. Exact spans and bounded metadata can still fail importer semantic checks.
Compilation and import are separate operations; importer preconditions recheck bytes and
context. A durable export CLI and browser broker remain separate outstanding work.
