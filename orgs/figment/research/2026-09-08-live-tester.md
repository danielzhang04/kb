# Existing checkpoint diagnostic ? 2026-09-08

Status: first live startup failed safely; timestamp correction accepted and the corrected attempt is running.

## Admission and independent review

The user accepted the bounded continuation. Independent recovery review passed at
`66be5887`: 24 focused tests and 287 existing pod tests passed, no blocking findings.
The initial sol dispatch was at capacity and returned no review; terra performed
this review. One incorrect pod-test temporary-root invocation returned 286 passes
and one configuration failure; the corrected invocation passed all 287 tests.
Lineage was already independently accepted at `23ce226d` (111 focused tests).

The five-cell manifest and all checkpoint/support hashes match the preparation
report. All cells use seed `1595` and `creator001krea2` with an adult clothed portrait
prompt. No model, node, or checkpoint bytes changed. Historical Figment ledger
rows matched original and proposal: 56 rows, $35.690251. Provider list: zero active.

Native model telemetry had blank USD values, which the actual daily guard rejects
as invalid numeric data. Every value was unknown; no numeric expense was present.
Rows are preserved in the dedicated `codex-worker-native-telemetry-2026-09-08.tsv`,
with `usd_status=not-exposed` and no numeric `usd` column. The harness explicitly skips
metadata shards lacking usd. Numeric expense records remain unchanged and future
numeric codex-worker costs retain their ordinary shard name. Model costs are unknown,
not zero. The actual CLI uses the existing code-branch daily $10 limit, stricter than
ops $30; recorded numeric daily spend was $0 before launch. No governance changed.

## Attempt 1: failed before image jobs

- Time: `2026-09-08 05:56 UTC`.
- Pod: `68xfk68u0ods8l`.
- Bounds: original $2.50 / 115 minutes / `max_placement_attempts: 1`.
- Receipt: `dry_run: false`, `termination_verified: true`, `estimated_actual_usd: 0.001087`.
- Output: `C:/Users/danie/kb/_private/figment-live-tester-20260908/live-output`.
- Result: zero images; create/acquisition callback rejected provider timestamp
  `2026-09-08 05:56:53.472 +0000 UTC` via datetime.fromisoformat.
- Teardown: known-ID DELETE followed by verified GET absence. Independent parent GET
  returned absent and provider list returned zero active pods.
- Recovery journal: `terminal/absence_verified: true` but `pod_id: null`; parsing failed
  before acquired ID persistence. The final run.json preserves the known ID.

The [provider reference](https://docs.runpod.io/api-reference/pods/GET/pods) shows an
ISO timestamp example for lastStartedAt. This actual response exposed a second
format missing from our offline fixtures. Preserve both the failed receipt and
journal; do not overwrite them or infer output quality from a successful teardown.

## Bounded correction and corrected attempt

Timestamp fix commit `88a1da1a` was independently accepted by terra: 319 tests passed
in 15.14 seconds. The parser accepts the observed strict Go UTC format alongside
zone-aware ISO and epoch timestamps, rejects malformed/ambiguous values, and persists
the acquired ID before optional provider-metadata parsing.

The corrected attempt is now running with the same manifest and fresh
`C:/Users/danie/kb/_private/figment-live-tester-20260908/live-output-retry-1`.
Pod `g2x0j52cicqvll` started at `2026-09-08 06:06:32 UTC`, with
`--max-usd 2.45` and `--max-minutes 113`, `max_placement_attempts: 1`. The local estimate is
$2.448333; this reserves $0.05 for the failed attempt inside the original $2.50
experiment ceiling. Its recovery journal is
`recovery-figment-bakeoff-20260908-060631-fbb659.json`, recording the acquired ID and
normalized last-start timestamp. The parent run is monitoring the existing process;
readiness currently returns proxy 404 while startup is still in progress, and no image
quality verdict exists. Console log: `C:/Users/danie/kb/_private/figment-live-tester-20260908/runner-retry-1-console.log`.
If this corrected attempt fails, stop further live retries.
No retraining, parameter search, automatic promotion, merge, or deployment.

The corrected run outcome is pending. Any images require full
resolution visual QA before delivery. This diagnostic alone does not create the
driver-bound tester provenance required for checkpoint promotion.
