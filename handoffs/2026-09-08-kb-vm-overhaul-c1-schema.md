# KB VM overhaul C1 schema handoff — 2026-09-08

**Topic:** retain accepted A0/C0/D0 ports while C1 implements its narrow schema
and migration boundary; D1 is paused at a two-failure decision boundary.

### What WORKED (with evidence)

- Source documentation checkpoint `2b323531` adds the approved C1 scope and paused D1 design/review. C0 implementation remains commit `f3e0e392`; this checkpoint changes no production code.

- **A0/C0/D0 source checkpoint** — PR176 source head
  `2b323531008419b3d87dfbbb312bc8cdc381c041` records the ports. C0 independently
  passed `npm.cmd run typecheck` and its exact focused 18/18 command in 1.18 s
  (923 ms tests). D0's focused suite passed 45/45 in 2.64 s; its held scheduler
  tests were red against the previous source and green after local guards.
- **C1 frozen review boundary** — C1 owns attempt-session constructors, PTY
  exact-key contracts, strict current persistence/session records,
  `sessionMigration` and their focused tests. Terra-high completed 65 PTY and
  164 adapter/surface focused tests. Root found one malformed-fixture inference
  error; its fixture-only correction was followed by the 24-test migration
  subset and dashboard typecheck PASS. The subset is a rerun, not an additional
  total. `http/surface.ts` stays read-only; `surface.test.ts` proves the real
  boot migration-before-read path.
- **Frozen fixture evidence** — retained only: Windows 47, Linux 399, and
  full/sparse mutation proof. They were not rerun in this stage.

### What Did NOT Work (and why)

- **D1 rebase recovery design** — the same post-rebase/pre-checkpoint recovery
  finding survived two correction/review attempts. A receipt naming only the old
  prepared SHA can strand a proven rebased local commit; arbitrary `HEAD` cannot
  be treated as success. D1 is paused pending the user's answer to root's
  request for one further bounded correction/review cycle.
- **No D1 implementation dispatch** — the fixture-correction worker was retired
  by the runtime thread limit. There is no live D1 builder; do not create one
  before the approval decision.

### What Has NOT Been Tried Yet

- **C1 independent review** — `/root/c1_schema_review` (Sol-high requested) is
  active against frozen bytes. The original C1 builder remains available only
  for a review-directed correction; do not run competing tests meanwhile.
- **D1 decision and correction** — only after root receives user approval, define
  an exact-witness, clean-HEAD adoption rule with checkpoint-before-publication
  and held restart evidence. Until then D1 documents remain paused WIP.

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/kb-ops/STATE.md` | WIP checkpoint | C0/D0 ready, C1 active, D1 paused. |
| `queue/working/01K2KBARCH0600000000000100.md` | WIP checkpoint | Parent Phase 0 card; no controller or production authority. |
| `queue/inbox/01K2KBARCH0600000000000112.md` | WIP decision record | D1 paused pending the user answer. |
| `dashboard/server/control/attemptSessionAdapter.ts` | FROZEN C1 | Under independent review. |
| `dashboard/server/pty/sessionMigration.ts` | FROZEN C1 | Under independent review. |
| `orgs/kb-ops/output/2026-09-06-platform-phase0/d1-ledger-design-20260908.md` | PAUSED WIP | No edit before renewed authorization. |

### Exact Next Step

Await the C1 independent review verdict against frozen bytes. Separately, wait
for root to relay the user's D1 decision; do not repair D1 before then.

### Load list

- `CLAUDE.md`
- `governance/agent-rules.md`
- `orgs/kb-ops/contract.md`
- `orgs/kb-ops/STATE.md`
- `queue/working/01K2KBARCH0600000000000100.md`
- `queue/inbox/01K2KBARCH0600000000000112.md`
- `C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907/orgs/kb-ops/output/2026-09-06-platform-phase0/c1-attempt-persistence-preflight-20260908.md`
- `C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907/orgs/kb-ops/output/2026-09-06-platform-phase0/remaining-integration-work-order.md`
- `C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907/orgs/kb-ops/output/2026-09-06-platform-phase0/d1-ledger-design-review-20260908.md`
- `handoffs/2026-09-06-dashboard-outage-recovery.md`
- skills: `code-review`, `security-review`, `save-session`
