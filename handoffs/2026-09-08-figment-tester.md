# Figment tester handoff ? 2026-09-08

**Topic:** WIP capture during the first live diagnostic and its narrow parser fix.

## Context and authorization

Daniel requested a boss orchestrator, lower-model workers, own branches, and an
architecture inspired by 10sorlabs. Architecture audit and first foundations are
in draft PR #178, branch `codex/figment-foundation-20260908`, current committed head
`27a2df60`. Implementation worktree:
`C:/Users/danie/kb/_private/codex-worktrees/figment-foundation-20260908`.

Portable fixtures and lineage passed independent review (111 focused lineage
checks; parent 700 passed and 13 baseline-identical failures). Recovery at `66be5887`
subsequently passed the authorized final independent review: 24 focused + 287 pod tests.
The sol dispatch was at capacity; terra performed the review. Wake card
01K9FIGMENT0800000000000003 is resolved in queue/done. Native review is not a formal
inspector grade. Prior foundation handoff is consumed; history is in commit `c0ecb81f`.

User's paid-compute authorization persists. "Okay. WHat now" accepted the bounded
continuation. The five-cell diagnostic has an overall $2.50 ceiling. It does not
approve a checkpoint, establish held-out quality, or authorize deployment/merge.

## What WORKED (with evidence)

- RunPod's ambient authenticated client works using Python 3.13.7 at
  `C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe`.
  No credential store was opened. Default Python3.12 is used for local tests.
- Local preflight confirmed manifest `35f23c56b249bca2b93d0719da6d87f6eb4e96f709d4aecb7a2c7968e6ab0e91`,
  exact five checkpoint hashes and support script, adult clothed prompt with
  `creator001krea2`, seed 1595, one placement, original 115 min / $2.50 bounds.
- Both original/proposal historical Figment ledgers match: 56 rows, $35.690251.
- First live pod `68xfk68u0ods8l` was terminated; harness and independent parent GET
  verified absence, provider list zero active. Receipt cost estimate $0.001087
  exactly matches the new `figment-2026-09-08.tsv` row. No images generated.
- Exact effective harness budget check passed after telemetry schema correction:
  code-branch daily cap $10, recorded numeric daily $0 before launch; arc $35.690251 / $50.
  Ops governance limit is $30; the CLI's existing $10 limit is stricter and unchanged.

## What Did NOT Work (and why)

- Live acquisition failed on actual provider timestamp
  `2026-09-08 05:56:53.472 +0000 UTC` because datetime.fromisoformat rejected it.
  Callback parsing failed before journaling the acquired ID; final receipt has ID,
  terminal journal still has pod_id:null. Worker is fixing exact parsing and safe
  ID persistence without weakening recovery ownership. Offline fixtures had only ISO.
- Native telemetry's blank numeric `usd` column blocked the real daily reader.
  All rows had unknown amounts; none held a numeric expense. They were preserved
  in `codex-worker-native-telemetry-2026-09-08.tsv` with `usd_status:not-exposed` and no
  `usd` column (supported metadata-shard skip). No numeric cost was removed or set to zero.
  Ordinary codex-worker cost-shard name stays free for future actual numeric costs.
- Parent optional budget-path probe hit UTF-8 BOM in ops governance YAML. Actual CLI
  uses its unmodified stricter $10 code-branch budget and passed. Don't edit governance.

## What Has NOT Been Tried Yet

- Full-resolution image QA, operator checkpoint choice,
  driver-bound tester proof, held-out comparison, second persona, studio UI.

## Current state of files

| File/tree | Status | Notes |
| --- | --- | --- |
| pipeline/pod/recovery.py, runpod_run.py, timestamp tests | WIP | Narrow observed-format/acquisition fix; worker owns source |
| research/2026-09-08-* foundation reports | DONE but live status needs follow-up | Committed `27a2df60`; preserve review history |
| queue/working/01K9FIGMENT0800000000000002.md | WIP | Live diagnostic result and bounded correction |
| queue/done/01K9FIGMENT0800000000000003.md | DONE | Prior recovery continuation and final review resolved |
| ledgers/cost/figment-2026-09-08.tsv | LIVE EVIDENCE | One terminated attempt, $0.001087 estimated |
| private figment-live-tester-20260908/live-output | IMMUTABLE FAILED ATTEMPT | run.json, terminal journal, console log outside output; no images |

## Exact next step

Monitor the existing corrected attempt; do not launch another run. Timestamp fix commit
`88a1da1a` passed terra's independent review (319 tests in 15.14 seconds). The corrected
attempt is pod `g2x0j52cicqvll`, started at `2026-09-08 06:06:32 UTC`, using
`--max-usd 2.45 --max-minutes 113`, one placement, and fresh `live-output-retry-1`.
Readiness currently returns proxy 404 while startup is still in progress. If this
corrected attempt fails, stop further live retries and record the outcome. Always verify
termination. Don't reuse `live-output` or `dry-run-output`.

Full command template/hashes are in `research/2026-09-08-tester-preparation.md`.
Code worktree above; ops proposal worktree:
`C:/Users/danie/kb/_private/codex-worktrees/figment-analysis-ops-2026-09-07`,
branch `codex/figment-analysis-ops-2026-09-07`, draft PR #175. Origin/ops `696e9752` last fetch.
Never touch dirty original kb root or original Figment worktree at
`C:/Users/danie/kb-worktrees/figment`. No merge/deploy/publish.

## Load list

1. CLAUDE.md,BOSS.md,governance/agent-rules.md,orgs/figment/contract.md and GUARDRAILS.
2. This handoff and working card01K9FIGMENT0800000000000002.
3. Implementation research/2026-09-08-foundation-review.md and tester-preparation.md.
4. Exact timestamp diff and private live-output/run.json; no credentialstores.
5. code-review/security-review and save-session/growth-log skills for completion.
