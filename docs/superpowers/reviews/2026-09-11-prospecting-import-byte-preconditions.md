# Import byte preconditions review

Verdict: READY for optional expected_content_sha256 on P17/P18 captures and private
pipeline manifests. Worker46 implementation and independent53 review both requested
opus; actual response JSONL verified claude-opus-5. No model executed tests.

Root verification: 109 combined new precondition, funding, person and pipeline CLI
tests passed90.39s. Matching hashes preserve request/batch replay identity; None keeps
old callers compatible. Malformed hashes and changed bytes refuse before import writes.
The digest is computed from the one retained byte buffer that the importer later copies.
Unknown manifest keys still refuse; no new data-bearing command arguments were added.

Independent review53 found no blocking introduced defect. It examined the importer
call sites; source_capture internals were outside its supplied scope. The compiler is
separate. This precondition does not make compile/import jointly atomic, record which
caller asserted a precondition, prove browser observation, or create authority. The
actual content hash remains part of persisted import identity. No schema, importer
version, approval gate, evaluation manifest or runtime acceptance pin changed.
