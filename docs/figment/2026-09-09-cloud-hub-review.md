# Figment cloud hub review — 2026-09-09

The read-only dashboard slice projects one configured cloud experiment as sanitized lifecycle evidence. It reads `run.json` only after harness finalization; before that, one producer-shaped acquired recovery journal may show `started-pending-final` with unknown liveness. Output count comes from `run.jobs[].files`, not ancillary `artifacts`. The projection omits pod IDs, paths, uploads, logs, response bodies, and error text.

An independent review found two medium issues. First, the pending projection labeled recovery `max_usd` as a preflight estimate even though it is the operator's spend ceiling. Second, it accepted an incomplete acquired-journal envelope. Root narrowed the second finding: formatted hashes are structural fields, not authentication or proof that a pod started, because recovery state and pod ID are mutable outside the intent digest.

The repair separates nullable `maxUsd` and `preflightEstimateUsd`. Pending status shows the journal cap and no estimate; final receipts retain their recorded preflight estimate. Acquired records now require the bounded known producer envelope, equal valid attempt/ownership names, a non-null safe pod ID, formatted SHA fields, an absolute manifest path without reading it, and an exact adjacent `run.json` receipt path. Liveness remains unknown and quality remains `not-reviewed`.

The original five-file dashboard batch passed 147 tests in 96.81 seconds. The latest repair batch passed 29 tests in 17.03 seconds, and dashboard typecheck passed. A direct Node probe of actual roots then reported V1 failed in bootstrap at $0.019366 with verified termination; V2 failed during the run at $0.103064 with verified termination; and V3 completed at 08:16:25 UTC with two files, a $0.325452 estimate, and verified termination. No private paths or pod IDs appeared.

This is local evidence only; no full dashboard suite or deployment was claimed. Later original-resolution root and independent reviews both stopped V3 before the six-row pilot. Those quality decisions are separate from this lifecycle projection.
