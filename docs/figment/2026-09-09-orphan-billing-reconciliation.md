# Orphan billing reconciliation — 2026-09-09

Recorded at `2026-09-09T21:56:41.923Z`: `codex-worker` root accepted a bounded reconciliation of two manual RunPod orphan estimates, following independent arithmetic and coverage review. This corrects estimates; it is not a provider credit, an invoice-final determination, or an increase to any budget cap.

## Evidence

- `C:/Users/danie/kb/_private/codex-worktrees/figment-studio-20260908/docs/figment/2026-09-09-orphan-billing-evidence.md` — SHA-256 `0db96f4bb265ea940735b3875c6b3ac4393ebd66ac1be6db08d90f58cf4bf60c`
- `C:/Users/danie/kb/_private/figment-runpod-orphan-billing-probe-20260909-v3.json` — SHA-256 `7d1d413d9f60b499dbcfa2a1c1ccfeae3deacbb09dfebbb2cdef101b96bad6aff`
- `C:/Users/danie/kb/_private/figment-provider-reconciliation-20260908.json` — SHA-256 `9785d68f33fd4cb49ffbfc2291bff86f8d724214fec4e6ea854ea83d7f3e4a1f`
- Prior `ledgers/cost/figment-2026-09-07.tsv` — SHA-256 `9b19a74067867bb4151fee0577bd5ad83304ca2a5bc5fe00eac47a9b3cf119b0`
- Retained historical Figment state — SHA-256 `cb2d03b42d71714a638972e7282788e6eb3af6b7dae6a4d758ef383ad8545eef`

The provider query used the two exact pod IDs over `2026-09-06T00:00:00Z` through `2026-09-09T00:00:00Z`, covering the recorded Sep. 7 lifetimes. The Sep. 8 snapshot contains the same amounts. The existing harness `pod-create` rows, every unrelated ledger row, and all caps remain unchanged.

The official [RunPod billing endpoint documentation](https://docs.runpod.io/api-reference/billing/GET/billing/pods), checked September 9, describes `amount` as the USD charged for the selected group and period. It supports interpreting these rows as period charges, without asserting invoice finality.

The two superseded manual rows were:

```tsv
runpod:l40s	pod-orphan-estimate pmi9y2gsoaxkea 08:27-08:30 manual terminate	0.055
runpod:l40s	pod-orphan-estimate hvtovmusbx6a1t 08:37-23:16 WORST CASE ceiling-rate, verify RunPod billing	15.97
```

## Arithmetic

Amounts use `Decimal` and positive remainders are rounded upward to six decimal places.

| Pod | Provider total | Preserved `pod-create` | Exact remainder | Reconciled orphan row |
| --- | ---: | ---: | ---: | ---: |
| `pmi9y2gsoaxkea` | `0.40566559694707394` | `0.400403` | `0.00526259694707394` | `0.005263` |
| `hvtovmusbx6a1t` | `3.22720715636387448` | `0.113185` | `3.11402215636387448` | `3.114023` |

The prior manual orphan total was `0.055 + 15.97 = 16.025`. The reconciled orphan total is `0.005263 + 3.114023 = 3.119286`, a reduction of `12.905714`.

## Limits

The provider returned naive bucket timestamps, and the original primary run receipts were not found. The independent Sep. 8 snapshot corroborates the amounts but does not extend query coverage. Later provider adjustments remain possible, so these rows remain a bounded reconciliation of the known episodes rather than invoice-final billing evidence.

After reconciliation, `ledgers/cost/figment-2026-09-07.tsv` has SHA-256 `63e40000bb22c0bdcca3049db7f4c7dffd9569b857f67d9ef1d3e695d1e1d4c9`.
