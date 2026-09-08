# Figment foundation handoff — 2026-09-08

**Topic:** Active implementation after the architecture audit. WIP capture while
builders finish; do not mistake this handoff for completed or approved recovery.

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

The **recovery item has reached two failed independent reviews**. Operator was
notified and wake-up card `queue/blocked/01K9FIGMENT0800000000000003.md` was published
in the ops proposal. Local fixes continue to make the result concrete; third independent
recovery acceptance and paid launch are paused at the recorded review boundary.
Approval-lineage review is a separate item and continues. Do not silently launch a
pod because generic paid authorization exists, or demand generic permission again.

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
- Existing test adaptation returned **90 passed, 2 deselected** before the creator-001
  followup above. Adapted fixtures now use real synthetic images/hashes and actual
  local grade/ruling/promotion paths, not manual chosen-step config. This is not a
  claim that the final full suite has passed.
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

## What Did NOT Work (and why)

- First recovery review found four HIGHs: bare sibling import breaks the driver's
  importlib loader; unsupported createdAt assumptions; journal overwrite destroys
  ownership; raw exceptions bypass redaction. Builder fixed import, documented
  lastStartedAt handling, safe error codes, and per-attempt journal filenames.
- Second review still found a HIGH: a different random pod name can reuse an
  unresolved output directory, start another paid attempt and overwrite run.json.
  Only same-name collisions were tested. Also, avoided-placement journals remain
  acquired although their leases were closed. Builder is implementing directory-wide
  admission, receipt preservation, and per-placement terminal updates now.
- Parent combined recovery/pod test run: **303 passed, 1 failed in 15.49s**, from
  a WinError 32 sharing violation during atomic journal replacement. Reviewer's
  isolated 17-test run passed. Builder is adding a bounded OS-specific retry with
  deterministic persistent-lock refusal tests. Do not erase this evidence as noise.
- The missing-ID timeout branch safely discovers then refuses deletion. Automatic
  cleanup after POST timeout before ID persistence is not delivered; it needs
  operator reconciliation. A local journal/CLI is not an external always-on watchdog.
- Old dry runs with explicit shared ledger paths appended dummy zero-cost rows.
  Exact test artifacts were identified and removed. Recovery changes now isolate
  all dry-run writes, including explicit ledger cases; independent recheck pending.

## What Has NOT Been Tried Yet

- Final full Figment integration suite after source/test freeze.
- Independent lineage verdict; reviewer is active. Parent raised old-ruling replay
  after a new grade on changed images with the same IDs: incoming rulings need an
  expected evaluation digest, not only an outgoing approval digest.
- Third recovery acceptance (paused after the second failure), new live tester,
  held-out candidate comparison, operator checkpoint choice, final output QA,
  second real persona, studio UI, merge/deploy/publishing.

## Current state of files

| Files | Status | Notes |
| --- | --- | --- |
| .gitattributes / fixture assets | DONE, partial commit | 10448378 plus uncommitted creator-001 LF followup |
| pipeline/figment_train.py, lineage.py, training_config.py, README | WIP | Explicit checkpoint promotion, current approval, dataset admission; tests/review finishing |
| pipeline/pod/runpod_run.py, recovery.py, README | WIP | Remaining directory/receipt guard and Windows retry fixes; two reviews failed |
| pipeline/tests changed fixtures + new tests | WIP | Relevant subsets passed; final suite not yet run |
| research/2026-09-08-{foundation-plan,foundation-review,existing-candidate-preflight,tester-preparation}.md | WIP evidence | Parent-maintained; keep final outcomes current |
| code-worktree memory/codex-worker.md | MOVE TO OPS | Accidental untracked worker lesson; parent must dedupe/transfer, never stage as product |
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

Collect active builders' final changes and independent lineage findings. Finish
necessary local fixes/tests, commit and publish a concrete reviewable implementation
PR and update this handoff. Keep the recovery review boundary explicit; once its
continuation is authorized, independently recheck and execute the prepared tester
with guards rechecked. The exact live command is in the tester-preparation report.

Active native workers at capture: figment_lineage (sol production/new tests),
figment_lineage_review (sol independent review), figment_recovery (terra remaining
fixes); fixture adapter luna completed. Responding-model and token/USD telemetry
is unavailable. Native review is not a formal inspector grade. Python pytest
needs an explicit private --basetemp; pod suite also needs PYTEST_DEBUG_TEMPROOT
set to a parent of that basetemp. Git mutations require approved escalation here.

## Load list

1. CLAUDE.md, BOSS.md, governance/agent-rules.md, orgs/figment/contract.md.
2. Main implementation and wake-up cards in this ops proposal.
3. Four September 8 reports in the implementation worktree; the September 7 main
   architecture report for the larger goal and deferred studio phases.
4. Current source diff against 3b48d911, then specific modules named above.
5. Skills code-review/security-review for acceptance, save-session/growth-log for close.
