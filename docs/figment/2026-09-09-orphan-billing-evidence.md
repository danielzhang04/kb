# RunPod orphan billing evidence — 2026-09-09

This is an offline evidence review. It does not edit a ledger, change the $50 cap, or authorize future spend.

## Sources reviewed

| Source | SHA-256 | Relevant evidence |
| --- | --- | --- |
| Private v3 filtered billing result | `7d1d413d9f60b499dbcfa2a1c1ccfeae3deacbb09dfebbb2cdef101b96bad6aff` | Two HTTP 200 responses for the two exact pod IDs. The query was `2026-09-06T00:00:00Z` to `2026-09-09T00:00:00Z`, daily buckets, grouped and filtered by pod ID. |
| Earlier provider reconciliation retained locally | `9785d68f33fd4cb49ffbfc2291bff86f8d724214fec4e6ea854ea83d7f3e4a1f` | The same per-pod amounts were retained from a 2026-09-08 provider query. This corroborates, but does not extend, the v3 query. |
| Canonical Sep. 7 Figment ledger | `9b19a74067867bb4151fee0577bd5ad83304ca2a5bc5fe00eac47a9b3cf119b0` | Preserves the two harness `pod-create` rows and the two manual `pod-orphan-estimate` rows. |
| Retained historical Figment state snapshot | `cb2d03b42d71714a638972e7282788e6eb3af6b7dae6a4d758ef383ad8545eef` | Records the Sep. 7 DNS outage: `pmi9y2gsoaxkea` manually terminated at 08:30 after the 08:27 episode; `hvtovmusbx6a1t` had termination and absence verified at 23:16 after the 08:37 episode. |

The original per-pod `run.json` or recovery journal for these 2026-09-07 attempts was not retained in the inspected local paths. The state snapshot is therefore lifecycle corroboration, not a replacement for an original receipt.

## Returned billing evidence

The provider returned naive timestamp strings. They are recorded as bucket labels only; no timezone has been inferred.

| Pod | Returned buckets | Total provider amount (USD) | Billed milliseconds |
| --- | --- | ---: | ---: |
| `pmi9y2gsoaxkea` | `2026-09-07 00:00:00` | `0.40566559694707394` | `1,281,709` |
| `hvtovmusbx6a1t` | `2026-09-07 00:00:00`; `2026-09-08 00:00:00` | `3.22720715636387448` | `9,979,461 + 300,000` |

The known outage interval is dated Sep. 7 in local evidence and is comfortably inside the queried three-day UTC window. That supports coverage of the known orphan episodes. It does **not** prove that the endpoint is an invoice, that it cannot later adjust, or that there was no charge outside the query window. The v3 result correctly labels both records `partial-unresolved`.

## Conservative, review-only reconciliation candidate

Keep the existing harness `pod-create` rows unchanged. If a ledger owner accepts the coverage limitation above, replace **only** each manual orphan-estimate row with the positive difference between the provider total and its preserved harness row, rounded **up** to six decimal places (`Decimal`, `ROUND_CEILING`):

| Pod | Provider total | Preserved `pod-create` | Exact difference | Proposed orphan remainder |
| --- | ---: | ---: | ---: | ---: |
| `pmi9y2gsoaxkea` | `0.40566559694707394` | `0.400403` | `0.00526259694707394` | `0.005263` |
| `hvtovmusbx6a1t` | `3.22720715636387448` | `0.113185` | `3.11402215636387448` | `3.114023` |

The candidate orphan total is `0.005263 + 3.114023 = 3.119286`. The current manual orphan total is `0.055 + 15.97 = 16.025`; the arithmetic difference is `12.905714`. This is neither a ledger change nor a budget release.

## Recommendation

Retain the current conservative rows until an authorized ledger review accepts this bounded reconciliation. The reviewer should record that the provider response is a filtered, day-bucketed history query with naive bucket labels and that the local primary receipts are unavailable. If that level of coverage is not accepted, leave both orphan estimates unresolved; do not infer a zero charge, credit, or lower budget total from missing evidence.
