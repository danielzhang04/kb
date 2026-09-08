# Figment evaluation handoff - 2026-09-08

**Topic:** Foundations accepted; five-checkpoint diagnostic completed safely;
identity quality needs an operator decision and a controlled follow-up.

## Context

Daniel wants a 10sorlabs-like creator studio, a boss orchestrator delegating most
work to lower models, isolated branches, feedback loops, and durable handoffs.
Architecture analysis is complete. First foundations and the bounded diagnostic
are complete; this handoff continues the larger studio objective.

Paid compute authorization persists, but this experiment is closed. Do not rerun
its command or promote a checkpoint automatically. A new experiment needs a fixed
hypothesis, explicit bounds, current cost reconciliation, and the normal review path.
No training, merge, deployment, or publication occurred in this continuation.

## What WORKED (with evidence)

- Portable synthetic fixtures and LF-sensitive identity records survived independent
  fresh-checkout checks. Lineage passed 111 focused tests; broad integration returned
  700 passes and 13 failures reproduced unchanged on the baseline.
- Recovery at `66be5887` passed the authorized independent continuation (24 focused
  and 287 pod tests). Actual provider timestamp/acquisition fix `88a1da1a` then passed
  an independent 319-test review. Sol was at capacity; terra performed the review.
  Responding-model/token/USD telemetry is not exposed; no formal inspector grade claimed.
- Corrected pod `g2x0j52cicqvll` completed all five raw-image jobs, exited 0, and was
  terminated at `2026-09-08T07:19:23+00:00`, elapsed 4371.929 seconds. Terminal journal
  retains its ID and `absence_verified:true`. Parent API checked both experiment
  IDs absent and zero active pods at `07:20:47.868959 UTC`.
- Corrected run estimate $1.323723 plus first startup $0.001087 = **$1.324810**.
  Arc estimate **$37.015061 / $50**. Both ledger rows exactly match receipts; these
  are estimates, not reconciled provider invoices. Native model charges remain unknown.
- All five raw PNGs were viewed at original 1448 x 2176 resolution by the parent:
  unambiguously adult and fully clothed. No clothing/age quarantine was required.
- Existing grading-board tool created a five-image comparison; payloads decode at
  original spatial dimensions and source/receipt hashes were unchanged. The board
  JPEG-reencodes previews; raw PNGs remain the evidence originals.

## What Did NOT Work (and why)

- The first pod `68xfk68u0ods8l` failed during acquisition on provider timestamp
  `2026-09-08 05:56:53.472 +0000 UTC`. Optional parsing preceded durable ID storage.
  Teardown verified absence; its immutable receipt has the ID, terminal journal has
  null ID. Fixed locally and independently reviewed before the single corrected run.
- Native telemetry with blank numeric USD values blocked the real budget parser.
  Unknown-only rows now live in `codex-worker-native-telemetry-2026-09-08.tsv` with
  `usd_status:not-exposed`, no USD column. No numeric expense was removed or set to zero.
- Optional ops budget-path parsing hit a UTF-8 BOM. The actual CLI used its unchanged,
  stricter code-branch $10 daily limit and passed. Do not change governance for this.
- Startup took about 26 minutes; 70 checkpoint chunks took about 44 minutes and several
  transient retries. Service-ready is distinct from provider RUNNING. Authenticated
  `GET https://api.runpod.io/v2/pods/{id}/logs` SSE supplied redacted startup evidence;
  the in-app browser list was empty. No credential store was opened.
- Parent qualitative judgment: all five portraits show weak intended-character
  resemblance. Later checkpoints change hair and facial appearance but no candidate
  was selected. Worker read-only review found correct trigger, LoRA wiring/strength,
  and step metadata; Raw training/Turbo inference is intentional template parity.
  This does not prove the cause of the quality shortfall or justify immediate retraining.

## What Has NOT Been Tried Yet

- Operator checkpoint ruling, quantitative scoring of these outputs, a frozen held-out
  prompt/seed comparison with an unchanged control, or accepted checkpoint promotion.
- Driver-bound tester evidence for this standalone diagnostic. Do not relabel its
  receipt as a driver run or fabricate plan/evaluation/approval lineage.
- Same-path proof with a second real fictional adult persona; Creators/Generate/QA
  studio views. The existing offline board already covers this diagnostic presentation.

## Current State of Files

| File/tree | Status | Notes |
| --- | --- | --- |
| `orgs/figment/pipeline` foundation changes | DONE | Source parser fix `88a1da1a`; final reports `dcf21605`; draft PR #178 |
| `orgs/figment/research/2026-09-08-*` | DONE | Review, preparation and final diagnostic reports |
| `queue/done/01K9FIGMENT0800000000000002.md` | DONE | Foundation plus bounded diagnostic result |
| `queue/done/01K9FIGMENT0800000000000003.md` | DONE | Recovery continuation resolved |
| `ledgers/cost/figment-2026-09-08.tsv` | DONE | Two terminated attempts, $1.324810 estimated |
| `ledgers/audit/figment-tester-2026-09-08.json` | DONE | Filtered receipt, independent absence, image hashes |
| Private `live-output` | DONE / FAILED EVIDENCE | Original startup failure, immutable |
| Private `live-output-retry-1` | DONE | Five raw PNGs, manifest, receipt, terminal journal; immutable |

## Exact Next Step

Open the diagnostic board for operator review, then define a driver-bound held-out
comparison that can distinguish weak identity learning from inference behavior.
Keep thresholds fixed, include a control, and address the measured transfer overhead
in the execution plan. Do not choose a checkpoint merely because all jobs completed.

Board: `C:/Users/danie/kb/_private/figment-live-tester-20260908/tester-diagnostic-board.html`.
Private run root: `C:/Users/danie/kb/_private/figment-live-tester-20260908/`.
Original manifest SHA-256:
`35f23c56b249bca2b93d0719da6d87f6eb4e96f709d4aecb7a2c7968e6ab0e91`.

Implementation worktree: `C:/Users/danie/kb/_private/codex-worktrees/figment-foundation-20260908`,
branch `codex/figment-foundation-20260908`, draft PR #178 (base `claude/figment`).
Ops proposal: `C:/Users/danie/kb/_private/codex-worktrees/figment-analysis-ops-2026-09-07`,
branch `codex/figment-analysis-ops-2026-09-07`, draft PR #175. It reconciled origin/ops
`46266f37` after the live run. Never touch the dirty main kb checkout or original
Figment worktree at `C:/Users/danie/kb-worktrees/figment`.

Prior active tester handoff is consumed in this push; historical version at `db9aef5f`.
No Figment STATE exists on the ops base; this canonical handoff carries current state.

## Load list

1. `CLAUDE.md`, `BOSS.md`, `governance/agent-rules.md`, project contract and GUARDRAILS.
2. This handoff and `queue/done/01K9FIGMENT0800000000000002.md` on ops proposal.
3. Implementation `orgs/figment/research/2026-09-07-architecture-analysis.md`.
4. Implementation foundation-review, tester-preparation, and live-tester September 8 reports.
5. `ledgers/audit/figment-tester-2026-09-08.json`, cost shards, and private raw run receipts.
6. `save-session` and `growth-log`; code/security review skills for subsequent changes.
