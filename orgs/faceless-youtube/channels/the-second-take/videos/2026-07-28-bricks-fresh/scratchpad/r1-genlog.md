# R1 gen log — grayscale-fix probe

Budget: ≤ $0.20 provider spend, ≈4 calls max. Stall ceiling 4 min + one re-issue per call.

| # | time (local) | target | size | result | cost |
|---|---|---|---|---|---|
| 1 | 2026-08-06 00:19:39 → 00:21:49 | `L28-r1probe` (cast-free plate, fix live) | 1K | **FAIL — HTTP 503** "model is currently experiencing high demand"; 0 generated, no image returned | **$0.00** (no billable completion) |
| 2 | 2026-08-06 00:22:00 → 00:24:11 | `L28-r1probe` (re-issue of #1) | 1K | **FAIL — HTTP 503**, same message; 0 generated | **$0.00** |
| 3 | 2026-08-06 00:26:20 → 00:27:32 | `L28-r1probe` (re-issue after ~100s pause) | 1K | **OK → `_staging/L28-r1probe.png`**; 1 generated, 0 failed | **$0.05** |

**TOTAL SPEND: $0.05** — 1 billable 1K generation, inside the ≤$0.20 / ≈4-call budget.
No call exceeded the 4-minute stall ceiling (longest was 2m10s, and that was a 503 round trip).

Both failures are provider-side capacity 503s, not stalls and not
prompt/assembly errors — the request assembled and validated cleanly under the seeding law both
times (`--dry-run` verified before each call), and forge reported `0 generated, 1 failed`, so
nothing was charged and nothing was written to `_staging/`.

Probe output name is `L28-r1probe.png`, which is a name no existing file uses; forge's
`_reserve_staging_output` refuses to overwrite an existing `_staging/*.png` without `--force`, so
the offender `L28-retry1.png` and the accepted `L28.png` are structurally safe from this probe.
Nothing was archived or moved.
