# Selected-person source resolver acceptance

Scope: `selected_person_source.py` and its focused tests. This is the P22 source
resolution slice; rendering, immutable draft binding and review integration remain.

Worker response model verification: the source-only CLI assistant events identify
`claude-opus-5` for the independent review `p22-source-review-16`. The source proposal
and narrow test repairs were also verified from response events before application.
The independent verdict is READY; root accepted it after checking the actual source.

The resolver binds the current P20 selection to its exact P19 artifact, P18 candidate,
employment and owned snapshot. It checks current hashes, identity, expiry and bytes;
an unrelated newer employment cannot substitute for the selected employment. It
creates no fill, contact, affinity, evidence, draft or approval rows. Its result hides
private fields from repr and its SQLite boundary returns a fixed error code.

Root verification: 9 focused tests passed, followed by 52 combined resolver,
qualification and ranking tests. The real P15-P20 fixtures cover exact provenance,
unrelated employment, stale selection/source, refusal without mutation and a closed
SQLite connection. No model inference or real prospect data was used by these tests.

Review triage: the possible missing-run None dereference is absent: PipelineService
raises `run_missing` and the resolver normalizes it. Optional observation-entity and
error-allowlist hardening is not an acceptance blocker. Consumers that write must
resolve within their coherent transaction; the next renderer slice owns that boundary.
Selection provenance must continue through human edits and P21 budget resets: a
budget root does not replace or terminate the provenance root.
