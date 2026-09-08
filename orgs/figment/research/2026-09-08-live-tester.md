# Existing checkpoint diagnostic ? 2026-09-08

Status: corrected diagnostic completed successfully; checkpoint quality and promotion remain unresolved.

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

## Bounded correction and completed attempt

Timestamp fix commit `88a1da1a` was independently accepted by terra: 319 tests passed
in 15.14 seconds. The parser accepts the observed strict Go UTC format alongside
zone-aware ISO and epoch timestamps, rejects malformed/ambiguous values, and persists
the acquired ID before optional provider-metadata parsing.

The corrected attempt used the same manifest and fresh
`C:/Users/danie/kb/_private/figment-live-tester-20260908/live-output-retry-1`.
Pod `g2x0j52cicqvll` started at `2026-09-08 06:06:32 UTC`, with
`--max-usd 2.45` and `--max-minutes 113`, `max_placement_attempts: 1`. The local estimate is
$2.448333; this reserves $0.05 for the failed attempt inside the original $2.50
experiment ceiling. Its recovery journal is
`recovery-figment-bakeoff-20260908-060631-fbb659.json`, recording the acquired ID and
normalized last-start timestamp. Console log:
`C:/Users/danie/kb/_private/figment-live-tester-20260908/runner-retry-1-console.log`.

Observed run phases and measured outcome: the control plane reached `desiredStatus=RUNNING` before service
health was ready. At `2026-09-08 06:32:21 UTC` (harness elapsed `1548.0s`, 25m48s),
the ComfyUI proxy returned `/system_stats=200` and readiness passed. Upload then began;
upload completed at approximately `2026-09-08 07:16:33 UTC` after the 70 checkpoint
chunks and marker/manifest uploads, for a measured upload phase of 44m12s. The five
generation jobs all succeeded; the receipt records `finished_utc=2026-09-08T07:19:23Z`,
total elapsed `4371.929s`, READY hourly rate `$1.09`, and measured cost estimate
`$1.323723`. The five job durations sum to `168.48s`, including the LoRA assembly wait.
The first failed attempt's `$0.001087` estimate brings the two-attempt total to
`$1.324810`; the resulting current arc total is `$37.015061`. These are harness
estimates, not invoice charges.

The five raw PNGs are `1448x2176`, were visually inspected by the parent Codex agent
(`codex-worker`) at original resolution, and were found unambiguously adult and fully
clothed; no quarantine was needed. The parent's qualitative judgment was weak
intended-character resemblance across all five; later steps appeared closer in hair and
lips qualitatively, but that is not a proven improvement. The operator's checkpoint
decision remains pending.
This diagnostic has no held-out controls or scoring and does not provide the
driver-bound lineage required for promotion. No operator QA stamp, ruling, or promotion
was performed.

The latest wiring review found no concrete error: trigger wiring and LoRA strength
`1.0` were correct, and checkpoint steps were correct. Raw-to-turbo template parity is
intentional and is not proven to be the cause of the quality result.

Output SHA-256 inventory:

| Output | SHA-256 |
| --- | --- |
| `c001-tensor-tester-000000250.png` | `9880ed00f09d6c40549bcf935f32925807dfb0ad0244b59d7945784a9f6813ab` |
| `c001-tensor-tester-000000500.png` | `71d53cd990df431907847897f5033df5ccd0f830b055ccff6f9bdf8a21647df` |
| `c001-tensor-tester-000000750.png` | `7cc991c8d89cc14dd1f7eaf4812dd2278ff7b6a686c712bbcde6593c1e346187` |
| `c001-tensor-tester-000001000.png` | `0e2ed76f5038cfa5656f657a3d5cbfe079814df23ff3b08371e23b28d4df0495` |
| `c001-tensor-tester-final.png` | `e48622df4da6034d9327ba2557063120a14acffe9fe0472adbd2884f252f47d2` |

The private diagnostic board is at
`C:/Users/danie/kb/_private/figment-live-tester-20260908/tester-diagnostic-board.html`;
it is self-contained and not promotable.

Independent parent verification recorded both pod IDs absent and zero active pods at
`2026-09-08 07:20:47.868959 UTC` in
`independent-teardown-verification.json`. No further live attempt should be launched
from this diagnostic.

For operational diagnostics, the authenticated RunPod REST logs endpoint
`https://api.runpod.io/v2/pods/{id}/logs` returned HTTP 200 as an SSE stream in the
parent's redacted check; the redacted sample is
`provider-log-events-redacted.json`. The browser agent reported no available browser.
No retraining, parameter search, automatic promotion, merge, or deployment occurred.

## Next step

Obtain the operator's checkpoint review and a defined driver-bound held-out comparison
before any further paid run or promotion. Use the retry evidence to optimize and measure
the transfer path before considering another run; do not auto-rerun. Any future images
still require full-resolution visual QA before delivery.
