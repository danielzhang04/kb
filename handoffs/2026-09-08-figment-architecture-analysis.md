# Figment architecture analysis handoff — 2026-09-08

**Topic:** Pickup of the overnight Track-2 work, architecture/current-state audit,
and recommended path to a reusable studio. Analysis began Sept 7; no pipeline build
or paid GPU run was performed during the audit.

## Context and standing authorization

Daniel asked this Codex boss to use lower-model workers, feedback loops and its own
branch, then to pick up Figment and completely analyze current state, goal and context
for a 10sorlabs-like architecture. When the Figment preamble failed at $19.40 >= $10,
Daniel explicitly said: "You can. You can also use paid compute. Runpod is up" in
response to the request to continue analysis despite the guard. Do not ask again for
that analysis exception or generic paid-compute permission during this continuing
session. The instruction does not supply a new numeric ceiling or a completed
provider reconciliation; use bounded experiment manifests and keep uncertainty honest.
No governance file or credential store was changed/read.

## What WORKED (with evidence)

- Preserved the original Figment worktree at `a005f6d0` and the unrelated dirty main
  checkout. Created `codex/figment-analysis-2026-09-07` under
  `C:/Users/danie/kb/_private/codex-worktrees/figment-analysis-2026-09-07`.
- Three bounded native workers audited implementation, reference/goal history, and
  calibration/recovery. Parent reconciled stale findings and requested a separate
  synthesis review. Worker requested models were sol/sol/terra; review requested
  luna. Actual responding-model and token/USD telemetry were not exposed; no formal
  inspector grade or exact responding model is claimed.
- Confirmed source gaps: disconnected score/human gate contracts, marker-only
  train-first admission, missing tester-to-chosen-checkpoint promotion, unregistered
  workflow profile `creator`, and incomplete anchor pause/recovery semantics. Inline
  still generation/refinement/detail code exists; do not call it absent merely because
  separate register/passes directories are missing.
- Four research reports are the deliverables on the analysis branch:
  `orgs/figment/research/2026-09-07-architecture-{analysis,code-evidence,reference-evidence,loop-evidence}.md`.
  Committed together as `3b48d911`; all 12 relative file links resolve and the
  repository pre-commit skill-sync check passed.
- Source and historical run JSON establish a trained 1,250-step candidate, a tester
  missing the trigger, then two failed tester attempts with unverified teardown.
  The trigger fix `abc91610` is in the inspected snapshot; a valid post-fix quality
  result is not yet established.
- Parent focused pytest selection: gates/gen had 33 passes; creator-002 acceptance
  had 8 failures before test behavior could be fully exercised (details below).
- Fresh public 10sorlabs product/panel check supports workflow/tutorial/package
  capabilities, not proof of an autonomous managed studio or measured output quality.

## What Did NOT Work (and why)

- Fresh checkout lacks ignored creator-002 anchor fixtures (and its placeholder
  generator). Initial three-file pytest run: 8 failed, 33 passed in 4.95s.
- Copied only the original three synthetic fixture JPGs into the analysis worktree's
  ignored anchors directory; second run: 8 failed, 33 passed in 4.65s. Identity-spec
  hash failed because checkout converted LF to CRLF. Original/raw LF SHA starts
  `802ca421`; checkout CRLF SHA starts `023104da`. Read-only LF normalization exactly
  reproduces the declared hash. No third rerun or hash/test weakening was attempted.
- `runpod_run.py status` cannot import requests in this terminal. A standard-library,
  read-only REST GET with ambient authorization returned HTTP 403 in sandbox and
  outside it. No response body, credential, pod environment or account store was
  printed. RunPod pod state and invoices remain unverified despite operator-reported
  availability; this is not evidence that RunPod itself is down.
- Some inherited reports/comments are stale or overstate evidence: current prompt
  derivation fixes creator contamination; old review issues fixed by `fb1f20ae`
  should not be refiled; m1's scores 85/78 are inside its stated 78–88 anchor band;
  finite trials do not establish that all editing routes are exhausted.

## What Has NOT Been Tried Yet

- A valid post-trigger-fix tester, controlled raw-versus-detailed comparison, and
  held-out prompts/seeds on the existing trained candidate.
- Fresh-checkout acceptance after portable fixtures and explicit line-ending policy
  are repaired. Those repairs are not part of this analysis.
- An independent compute-recovery actor surviving the initiating desktop's outage,
  provider-charge reconciliation, full studio journey, or second real persona proof.
- Full 964-test suite, new visual grading, browser acceptance, deployment, publishing.

## Current state of files

| File group | State | Notes |
| --- | --- | --- |
| Four architecture reports on analysis branch | DRAFT | Evidence and recommendations; no adopted implementation plan |
| Existing Figment production code | UNCHANGED | Snapshot `a005f6d0` |
| Analysis creator-002 anchors | LOCAL FIXTURES | Three ignored JPG copies, not new persona assets or tracked deliverables |
| This handoff and memory/cost/activity records | COORDINATION PROPOSAL | Separate branch `codex/figment-analysis-ops-2026-09-07`; publication status must be checked |
| Previous overnight handoff | CONSUMED IN PROPOSAL | Removed together with this replacement; Git history preserves it |

The original worktree's five cost TSVs sum to $35.690251, including $16.025 of explicit
orphan estimates; the remainder is $19.665251 in other recorded estimates. These are
not provider-verified charges. The analysis snapshot alone does not contain every
historical shard, so never compute the arc from it without restoring the source ledger.

## Exact next step

Read the main architecture analysis and its code-evidence findings. Decide the first
bounded implementation package around the existing CLI's lifecycle/decision contract,
portable inputs and compute recovery. Then evaluate the already-trained candidate
through a valid tester before commissioning a fresh training run. The draft recommends
proving accepted-checkpoint -> reviewed batch -> recoverable resume, then exposing
Creators/Generate/QA views over that same path. No model/framework replacement is
required merely to begin closing these gaps.

## Load list

1. `CLAUDE.md`, `BOSS.md`, `governance/agent-rules.md`.
2. On the analysis worktree: `orgs/figment/{_index,MANDATE,contract}.md`,
   `orgs/figment/pipeline/GUARDRAILS.md`, `pipeline/README.md` and STATE's latest entries.
3. `orgs/figment/research/2026-09-07-architecture-analysis.md` and its three supporting audits.
4. `docs/superpowers/plans/2026-09-06-figment-track2-faithful-pipeline.md` and
   `docs/superpowers/specs/2026-09-03-figment-creator-001-design.md` (design, not build proof).
5. Original ignored `orgs/figment/runs/c001-tf*` metadata/checkpoints as needed;
   do not regenerate or overwrite these on pickup.
6. Skills: code-review, loop-design-check; save-session and growth-log for close.
