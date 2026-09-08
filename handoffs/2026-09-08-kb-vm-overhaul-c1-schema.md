# KB VM overhaul claim delivery handoff - 2026-09-08

C1 schema is accepted and published; C1 delivery is paused for user approval. The twelve-phase
program remains active and Phase 0 incomplete. D1 design is paused for a human
decision after the same rebase-recovery finding survived two reviews.

## What worked

- Accepted source `5a480e5cd4b147a283ea0e9abe29202a7fe3fe29` contains A0,
  C0, D0, and C1 schema. Final independent C1 review passed 230 tests in seven
  files, full dashboard typecheck, and diff checking, with no remaining findings.
  Legacy v2/v3 migration is strict and atomic; the real boot test rejects a
  swallowed registry-read warning. No delivery behavior was part of that verdict.
- C0 passed 18 focused tests and typecheck; D0 passed 45 with actual held-seam
  red/green proof; A0 passed six behavioral tests and typecheck.
- Prior-only fixture evidence: Linux 399, Windows 47, full/sparse mutation proof.
  These have not been rerun against new C1 delivery code.
- Coordination proposal rebased onto nightly ops `46266f37`, resulting in
  baseline `9713208aaa2a7b84e38c409a29d162c1817cb34b`. A transient Git object
  permission failure left a clean, rescheduled step; rebase continuation passed.

## What failed and remains paused

D1 design still cannot recover a proven rebase-before-checkpoint commit. The
concrete requested correction must verify clean HEAD, exact two changed files,
immutable sidecar/input and shard postimage, then checkpoint the replacement SHA
before publication. Root's specific approval request remains unanswered. Do not
edit D1 or dispatch its implementation before root relays approval.

C delivery is also paused. The exact test at adapter.test.ts:780 returns
undefined after the real write-intent mutation. Its first failure was a cleanup
TypeError; the next run wrote one prompt where zero were expected. Root asked
for one bounded correction/review: validate transition results before effects,
preserve this malformed-fulfillment regression, and add true mutation-then-throw
undefined probes. Do not repair C until the user answers. Pending C and D1
questions are separate. Source documentation checkpoint `36f76379` preserves
staging decisions and the interim review; C implementation is uncommitted WIP.

## Active ownership and next step

- `/root/c1_schema_build`, Terra-high requested: only
  `dashboard/server/control/attemptSessionAdapter.ts`, its test,
  `attemptVertical.integration.test.ts`, and a delivery implementation DRAFT.
  Frozen partial implementation; exact failures and remaining tests are in
  c1-delivery-implementation-20260908.md. No C repair or rerun before approval.
- `/root/c1_schema_review`, Sol-high requested: independent adversarial preflight,
  C delivery is NOT READY. Its review report records the interim findings and
  frozen fault-test diagnosis.
- Absent `messageClaims` must refuse before any effect. The old `drainMessages`
  option remains temporarily for type compatibility and must never be invoked.
  B supplies the active chain store and lifetime last; there is no safe fallback.
- Root judges final scope/evidence and commits only accepted bytes. No merge,
  deployment, activation binding, formal inspector grade, or Phase 0 completion.
- Actual responding model and cost telemetry are unavailable, recorded as unknown.

## Load list

- `CLAUDE.md`, `governance/agent-rules.md`, `orgs/kb-ops/contract.md`
- `orgs/kb-ops/STATE.md`, `dashboards/kb-platform-implementation.md`
- `queue/working/01K2KBARCH0600000000000100.md`
- `queue/inbox/01K2KBARCH0600000000000112.md`
- Source worktree: `C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907`
- Source `orgs/kb-ops/output/2026-09-06-platform-phase0/remaining-integration-work-order.md`
- Source `orgs/kb-ops/output/2026-09-06-platform-phase0/c1-schema-review-20260908.md`
- Source `orgs/kb-ops/output/2026-09-06-platform-phase0/c0-claim-store-review-20260908.md`
- Source `orgs/kb-ops/output/2026-09-06-platform-phase0/d1-ledger-design-review-20260908.md`
- `handoffs/2026-09-06-dashboard-outage-recovery.md`
- Skills: code-review, security-review, save-session

Independent next work: Sol writes a1-engine-grant-preflight-20260908.md; Terra
reviews the existing durable boundary/Resume seams, then the frozen plan. No
engine or grant production edits yet; no frozen-file release yet. B still waits
for accepted A/C/D ports. Load the new A1 preflight when it exists.
