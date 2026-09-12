# Capture accessor review

Verdict: READY for the accessor slice. Requested opus; response JSONL verified
claude-opus-5 for independent worker49. Implementation workers43/44 responded
claude-sonnet-5. Root verified source and output hashes before applying proposals.

ResolvedCapture exposes one verified capture's exact task, receipt, snapshot,
session, run, intake and source metadata. Expected receipt/hash mismatches fail
closed. The accessor reuses existing byte-integrity, expiry and context checks,
creates no rows or authority, preserves caller transactions and suppresses private repr.

Verification: 40 capture lifecycle tests passed in17.56s, including nine new accessor
cases covering exact open/search fields, malformed/mismatched expectations, changed
bytes, expiry, same-byte captures in different sessions, closed connection, caller
transaction ownership and unchanged legacy receipt equality. Independent review49
found no actionable introduced defect; its review was source-only, not test execution.

Limits: separate SELECTs do not promise cross-statement isolation. Saved captures
prove submitted bytes/metadata, not browser observation or qualification. Hash/url/time
is not a unique capture receipt identifier. The downstream compiler and importer byte
preconditions are separate work and are not accepted by this review.
