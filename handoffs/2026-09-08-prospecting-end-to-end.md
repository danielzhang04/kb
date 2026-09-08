# Prospecting end-to-end handoff ? 2026-09-08

## Context
User assigned this boss to finish prospecting: outreach ask -> qualified leads -> cleaning/fit ->
polished local UI -> evidence-backed drafts -> reviewed campaigns/scheduling/results. Actual Claude
Opus/Fable workers, adversarial reviews and tests throughout. Main changes consolidate into one
session-end PR. Remote work must be isolated, monitored, recoverable and cleaned after collection.

## Current state / what worked
Own source branch codex/prospecting-e2e-20260908 at P8 52067386; isolated worktree under
_private/codex-worktrees/prospecting-e2e-20260908. Original P8 worktree preserved.
Plan: docs/superpowers/plans/2026-09-08-prospecting-end-to-end.md.
Evidence: orgs/prospecting/output/2026-09-08-baseline-review.md.
All seven historical gate record artifact sets (285 hashes) match original source. No fresh full suite.
Read-only live counts: 42 companies, 96 people, three campaigns, 95 affinity rows; zero revisions,
enrollments, deliveries and inbound. Sender input files exist; not read or modified here.
Remote Opus narrow review completed in 18.73 seconds; actual streamed model claude-opus-5.
Session 86c2f920-7b12-49be-bfc8-8131d5dc5213; session persistence disabled, exact-session scan empty.
Receipts on desktop root _private/prospecting-prerequisite-review-20260908. Auxiliary Haiku usage
reported by CLI; not a deliberately dispatched worker. No remote task directory or installs made.
Real desktop Python 3.13.7 probe: P1 verify-recorded passes; workflow verifier rejects that exact
contract with P1_recorded_gate_required. Independent review confirms old marker/record assumptions.
Two synthetic asks reuse fixed campaign/profile IDs. Existing scheduler emits four touches while
P8 approval specifies two. UI directory absent; old P7-UI design predates P8.

## What did not work
Broad tool-disabled review hit its 100-second deadline with no accepted result; narrowed review
succeeded. Do not treat the broad attempt as reviewed. Sandbox Python 3.12 lacks tzdata; use the
existing user Python313 runtime for small desktop-specific checks. Sparse checkout initially missed
.githooks/pre-commit; materializing the tracked file restored recorded-gate verification.

## Questions pending / exact next step
Collect the six UI questions already presented before dependent setup or product commitments:
1. Use cases: general networking with NYC first vs NYC-only vs sales.
2. Sending: per-batch approval vs drafts-only vs campaign-policy approval.
3. Temporary remote workspace/recovery retention until acknowledged collection; required for
   disconnect survival. No response yet, so do not infer approval from elapsed time.
4. UI: local prospecting app linked from dashboard vs main integration vs boss choice.
5. First real acceptance ask, qualified-contact target, geography, budget and deadline.
6. Offline: development workers only vs live prospecting/sending too.
Then revise the plan, establish/prove remote lifecycle with independent review, and implement the
first gate-contract repair slice using real gate evidence. No code fixes have been made yet.

## Boundaries and untried work
Existing prospecting contract forbids all real PII and message content in VM sinks. Live SQLite,
Chrome, Gmail/vendor operations stay desktop-local; remote builders use source + synthetic fixtures.
No live sends, external messages, paid vendor calls, production changes or migrations performed.
No detached worker setup, offline recovery, tool-capability parity, or cleanup lifecycle accepted yet.
Remote systemd-run and bwrap exist. Literal zero system/provider logs cannot be guaranteed.
No new PR; existing orientation ops draft #180 predates the clarified no-small-PR preference.
Coordination changes staged on its own codex branch; no direct ops/main push.

## Files and Load list
- CLAUDE.md; BOSS.md; governance/agent-rules.md; orgs/prospecting/contract.md
- Source worktree docs/superpowers/plans/2026-09-08-prospecting-end-to-end.md
- Source worktree orgs/prospecting/output/2026-09-08-baseline-review.md
- orgs/prospecting/runbook-p8.md; doctrine.md; deployment.md
- scripts/prospecting/run_workflow.py; manager/p5_contracts.py; manager/desktop_stage.py
- Original boss checkout docs/superpowers/specs/2026-09-04-prospecting-p7ui-amendment.md
- Root _private/prospecting-prerequisite-review-20260908/stdout.json
- Skills: code-review, security-review, loop-design-check, save-session
Old 2026-09-07 prospecting handoff was consumed by this pickup; Git history retains it.
