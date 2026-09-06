# KB platform implementation checklist

Approved 2026-09-06. Canonical task state is in the linked phase cards; this page
is the terminal checklist's durable projection, not an executor or new authority.
All required capabilities remain in scope. Runtime selection and production actions
retain their separate human gates.

- [ ] Phase 0: Contain failures and establish dashboard diagnostics ([card](../queue/working/01K2KBARCH06000000000000100.md)) - IN PROGRESS
- [ ] Phase 1: Freeze contracts and prove the existing broker ([card](../queue/blocked/01K2KBARCH06000000000000101.md))
- [ ] Phase 2: Compare and select durable runtime ([card](../queue/blocked/01K2KBARCH06000000000000102.md))
- [ ] Phase 3: Implement transactional commands and leases ([card](../queue/blocked/01K2KBARCH06000000000000103.md))
- [ ] Phase 4: Compose placement and supported workers ([card](../queue/blocked/01K2KBARCH06000000000000104.md))
- [ ] Phase 5: Complete scheduler and bounded maintenance ([card](../queue/blocked/01K2KBARCH06000000000000105.md))
- [ ] Phase 6: Verify executor terminal and real model ([card](../queue/blocked/01K2KBARCH06000000000000106.md))
- [ ] Phase 7: Complete artifact and publication recovery ([card](../queue/blocked/01K2KBARCH06000000000000107.md))
- [ ] Phase 8: Connect all System learning paths ([card](../queue/blocked/01K2KBARCH06000000000000108.md))
- [ ] Phase 9: Complete truthful health and Brain freshness ([card](../queue/blocked/01K2KBARCH06000000000000109.md))
- [ ] Phase 10: Rehearse and authorize production cutover ([card](../queue/blocked/01K2KBARCH06000000000000110.md))
- [ ] Phase 11: Sustained verification and subtraction ([card](../queue/blocked/01K2KBARCH06000000000000111.md))

## Current work

Phase 0, isolated worktree `codex/kb-platform-phase0-20260906` at prerequisite
`e8bf8d35`. Pending PR173 is included locally for integration tests, not merged or
deployed. Detached-error containment and drain barrier have separate worker plans.
No phase is complete yet; prior audit tests do not satisfy new build acceptance.

## Phase rule

Plan review -> bounded implementation -> focused tests -> fresh code review ->
phase integration/browser/fault evidence -> required human gate. Independent work
may proceed around an unavailable environment; its readiness gate cannot be waived.
