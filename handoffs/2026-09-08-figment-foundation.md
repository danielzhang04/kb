# Figment foundation handoff — 2026-09-08

**Topic:** Foundation implementation and verification handoff after the architecture
audit. Portable fixtures and lineage passed independent review. Recovery fixes are
committed, with their final independent acceptance still pending.

## Context and authorization

Daniel wants a boss orchestrator, lower-model builders, feedback loops, own branches,
and durable handoffs. He accepted the first foundation package with "Okay. Let's go".
His prior "You can. You can also use paid compute. Runpod is up" authorizes paid
compute and the earlier budget-preamble exception. Do not ask again for generic paid
permission. No numeric ceiling was changed; the $50 arc remains binding.

RunPod is connected. After Daniel said other terminals connected, parent located the
already-installed Python 3.13.7 runtime with requests and used the original harness
client with ambient credentials. It succeeds. The default Python 3.12 lacks requests;
the earlier standard-library HTTP 403 did not establish the configured client's
availability. No credential store was opened, no key printed or copied.

The **recovery item reached two failed independent reviews**. Operator was notified
and wake-up card `queue/blocked/01K9FIGMENT0800000000000003.md` was published in the
ops proposal. Final local fixes are now delivered in recovery commit `66be5887` and
draft PR [#178](https://github.com/danielzhang04/kb/pull/178), but third independent
recovery acceptance and paid launch remain paused at the recorded review boundary.
Approval-lineage source is accepted at `23ce226d`; independent review returned
PASS / READY with 111 focused tests. The final code/report head is `27a2df60`,
pushed to draft PR #178. Do not silently launch a pod because generic paid authorization exists, or
demand generic permission again.

## What WORKED (with evidence)

- Worktree `C:/Users/danie/kb/_private/codex-worktrees/figment-foundation-20260908`,
  branch `codex/figment-foundation-20260908`, based on analysis `3b48d911`.
  Portability commit `10448378` tracks only creator-002 synthetic fixture images,
  generator, README, narrow ignore rules, and LF attributes. Parent fresh Windows
  checkout with autocrlf true passed **8 creator-002 tests in 10.28s**. Temporary
  verification checkout was removed.
- Followup LF rule covers every persona identity spec. Creator-001's normalized
  bytes equal the HEAD Git blob and declared SHA `1a969804...eacc0`; no declared
  digest changed. Four formerly blocked creator-001 tests plus test_persona passed
  **30 tests**. Three original fictional creator-001 references were copied into
  ignored anchors for integration only; do not stage them.
- Existing test adaptation returned **94 passed** after the evaluation-subject ruling
  contract was applied. Adapted fixtures now use real synthetic images/hashes and
  actual local grade/ruling/promotion paths, not manual chosen-step config. This is
  not a claim that the final full suite has passed.
- The delivered lineage changes require accepted dataset provenance, human ruling
  metadata and evaluation-subject binding; checkpoint-step selection is tied to a
  completed train receipt and accepted checkpoint promotion. Independent lineage
  review passed 111 tests with no remaining findings. Parent final integration:
  **700 passed, 13 failed in 58.82s**, all failures reproduced unchanged on baseline.
- Recovery commit `66be5887` delivers directory-wide run admission held through
  finalize, refusal of prior `run.json` and journals before POST, terminal placement
  journals, bounded WinError 32/33 retries, and isolated dry-run dummy writes.
  Builder verification reported **24 focused recovery checks and 287 pod checks
  passed**; the third independent recovery acceptance is still pending.
- Provider list returned zero pods. GETs for both interrupted tester IDs
  `pmi9y2gsoaxkea` and `hvtovmusbx6a1t` returned 404, confirming current absence.
- All five historical cost shards in the ops proposal exactly match the original
  worktree as parsed TSV records: $35.690251 conservative estimate, including $16.025
  orphan estimates. Provider billing records cover all **53** real ledger pod IDs,
  **56** matched rows totaling **$22.9947359941215834977**. Filtered evidence is
  `ledgers/audit/figment-provider-2026-09-08.json`. Retain the higher local estimate
  as the guard; don't double-book provider observations as new costs.
- Existing five trained checkpoints are present, sizes match the source train
  receipt, and parent computed SHA-256s (research preflight report). No new training
  is needed merely to begin evaluation.
- Prepared a five-cell corrected-trigger tester in
  `C:/Users/danie/kb/_private/figment-live-tester-20260908` with hard links to the
  exact checkpoints, copied support script, fixed seed 1595, one placement, $2.50,
  115 minutes. Manifest SHA is
  `35f23c56b249bca2b93d0719da6d87f6eb4e96f709d4aecb7a2c7968e6ab0e91`.
  Its dry run completed simulated uploads/jobs. Live output is absent; **no new
  paid pod has been launched**. The prompt is an adult, clothed shoulders-up portrait.
- The local tester's source-hash continuity does not attest to provider-side weight
  consumption because provider receipts expose byte counts rather than signed digests.
  The prepared standalone diagnostic cannot create driver-bound tester evidence by
  itself; the old unbound tester must be rerun through the driver before promotion.

## What Did NOT Work (and why)

- First recovery review found four HIGHs: bare sibling import breaks the driver's
  importlib loader; unsupported createdAt assumptions; journal overwrite destroys
  ownership; raw exceptions bypass redaction. Builder fixed import, documented
  lastStartedAt handling, safe error codes, and per-attempt journal filenames.
- Second review (historical) still found a HIGH: a different random pod name can reuse an
  unresolved output directory, start another paid attempt and overwrite run.json.
  Only same-name collisions were tested. Also, avoided-placement journals remain
  acquired although their leases were closed. These findings are addressed by
  delivered commit `66be5887`; retain the review as historical evidence.
- Parent's combined recovery/pod test run (historical): **303 passed, 1 failed in
  15.49s**, from a WinError 32 sharing violation during atomic journal replacement.
  The reviewer's isolated 17-test run passed. The delivered recovery commit adds
  bounded OS-specific retries and deterministic persistent-lock refusal tests; do not
  erase the original contention evidence.
- The missing-ID timeout branch safely discovers then refuses deletion. Automatic
  cleanup after POST timeout before ID persistence is not delivered; it needs
  operator reconciliation. A local journal/CLI is not an external always-on watchdog.
- Old dry runs with explicit shared ledger paths appended dummy zero-cost rows.
  Exact test artifacts were identified and removed. The delivered recovery changes
  isolate all dry-run writes, including explicit ledger cases; independent acceptance
  remains pending.

## Integration history and final result

- The first nonrecovery full-suite attempt reported **392 passed, 314 setup errors, and
  3 failures** because the nested pytest basetemp parent was missing; this was a test
  setup/environment error with no product interpretation. After creating
  `PYTEST_DEBUG_TEMPROOT` explicitly before the nested `--basetemp`, the corrected
  parent broad run reported **697 passed, 14 failed in 58.38s**. One failure is
  relevant: a stricter tester-inventory fixture declares artifacts that do not exist,
  and the builder subsequently materialized its declared test artifacts. The other 13 failures were
  independently reproduced against unchanged `3b48d911` with the same four files;
  that baseline run had **88 passed and 13 failed in 2.28s**:
  two calibration-timeout contract failures, two missing ignored 10sorlabs source
  graph inputs, three missing `facenet_pytorch` dependencies, and six Git Bash
  Windows mkdir permission failures. The baseline required private creator-001
  reference copies and temporary raw HEAD text bytes; tracked files were restored
  afterward. The final frozen run returned **700 passed, 13 failed in 58.82s**;
  its remaining failures exactly match that baseline set. It is not an all-green suite.
- The reviewer caught unlisted source files/symlinks being copied into train-first
  uploads. Final code copies approved inventory only and rejects extra entries or
  symlinks in the staged directory immediately before training. The independent
  reviewer accepted this fix at `23ce226d` with 111 focused tests passing.

## What Has NOT Been Tried Yet

- Third recovery acceptance (paused after the second failure; an asynchronous bounded
  continuation was requested and has no answer yet), new live tester,
  held-out candidate comparison, operator checkpoint choice, final output QA,
  second real persona, studio UI, merge/deploy/publishing.

## Current state of files

| Files | Status | Notes |
| --- | --- | --- |
| .gitattributes / fixture assets | DONE | 10448378 plus creator-001 LF normalization; declared hashes preserved |
| pipeline/figment_train.py, lineage.py, training_config.py, README | DONE | `23ce226d`; independent PASS / READY, 111 focused tests |
| pipeline/pod/runpod_run.py, recovery.py, README | DELIVERED, ACCEPTANCE PENDING | `66be5887` / [PR #178](https://github.com/danielzhang04/kb/pull/178) contains directory admission, receipt/journal guards, bounded Windows retries, and dry-run isolation; third independent acceptance pending |
| pipeline/tests changed fixtures + new tests | DONE for lineage | Final parent 700 passed / 13 reproduced baseline failures; recovery acceptance remains separate |
| research/2026-09-08-{foundation-plan,foundation-review,existing-candidate-preflight,tester-preparation}.md | DONE | `27a2df60`; final review history, limits, live command and candidate hashes |
| Prepared private tester tree | READY BUT PAUSED | Use live-output only after review boundary resolved; never reuse dry-run-output |

Coordination proposal worktree:
`C:/Users/danie/kb/_private/codex-worktrees/figment-analysis-ops-2026-09-07`, branch
`codex/figment-analysis-ops-2026-09-07`, draft PR https://github.com/danielzhang04/kb/pull/175.
Base origin/ops remains `696e9752` at last fetch. Main implementation card is
`queue/working/01K9FIGMENT0800000000000002.md`.

Original root stays on unrelated dirty `claude/boss-2026-09-02`; do not touch it.
Original Figment worktree `C:/Users/danie/kb-worktrees/figment` at `a005f6d0` is read-only
source. Do not overwrite historical failed receipts or source checkpoints.

## Exact next step

Resolve the pending bounded recovery continuation. The concrete fixes are at
`66be5887`; the source/report branch head is `27a2df60`. If Daniel authorizes the
additional round, independently review recovery and, only if it passes, execute
the prepared five-image diagnostic under its unchanged $2.50 / 115-minute /
one-placement limits. Recheck preamble and authoritative daily/arc ledger first.
The exact command is in the tester-preparation report. Verify termination, record
actual costs and inspect every output at full resolution. Do not treat this raw
standalone diagnostic as driver-bound approval evidence or silently retrain.

Lineage and portability workers/reviewers are finished. Recovery builder is finished;
its third independent acceptance has not run. All work remains on unmerged draft
PRs, so keep these worktrees for resume. Responding-model and token/USD telemetry
is unavailable; native review is not a formal inspector grade. No deployment,
merge, publication or new GPU launch occurred.

Python pytest needs an explicit private `--basetemp`. Create
`PYTEST_DEBUG_TEMPROOT` as a directory before using its nested basetemp; the pod
suite additionally checks that ancestor relationship. Git mutations need approved
escalation in this environment. The full integration logs are private:
`C:/Users/danie/kb/_private/figment-integration-final-20260908.log` and
`C:/Users/danie/kb/_private/figment-integration-baseline-20260908.log`.

## Load list

1. CLAUDE.md, BOSS.md, governance/agent-rules.md, orgs/figment/contract.md.
2. Main implementation and wake-up cards in this ops proposal.
3. Four September 8 reports in the implementation worktree; the September 7 main
   architecture report for the larger goal and deferred studio phases.
4. Current source diff against 3b48d911, then specific modules named above.
5. Skills code-review/security-review for acceptance, save-session/growth-log for close.
