# KB platform implementation checklist

Approved 2026-09-06. Canonical task state is in the linked phase cards; this is
the terminal checklist's durable projection, not an executor or new authority.
All required capabilities remain in scope. Runtime selection and production work
retain their separate human gates.

- [ ] Phase 0: Contain failures and establish dashboard diagnostics ([card](../queue/working/01K2KBARCH0600000000000100.md)) — BOUNDED CYCLE EVIDENCED; INCOMPLETE
- [ ] Phase 1: Freeze contracts and prove the existing broker ([card](../queue/inbox/01K2KBARCH0600000000000101.md))
- [ ] Phase 2: Compare and select durable runtime ([card](../queue/inbox/01K2KBARCH0600000000000102.md))
- [ ] Phase 3: Implement transactional commands and leases ([card](../queue/inbox/01K2KBARCH0600000000000103.md))
- [ ] Phase 4: Compose placement and supported workers ([card](../queue/inbox/01K2KBARCH0600000000000104.md))
- [ ] Phase 5: Complete scheduler and bounded maintenance ([card](../queue/inbox/01K2KBARCH0600000000000105.md))
- [ ] Phase 6: Verify executor terminal and real model ([card](../queue/inbox/01K2KBARCH0600000000000106.md))
- [ ] Phase 7: Complete artifact and publication recovery ([card](../queue/inbox/01K2KBARCH0600000000000107.md))
- [ ] Phase 8: Connect all System learning paths ([card](../queue/inbox/01K2KBARCH0600000000000108.md))
- [ ] Phase 9: Complete truthful health and Brain freshness ([card](../queue/inbox/01K2KBARCH0600000000000109.md))
- [ ] Phase 10: Rehearse and authorize production cutover ([card](../queue/inbox/01K2KBARCH0600000000000110.md))
- [ ] Phase 11: Sustained verification and subtraction ([card](../queue/inbox/01K2KBARCH0600000000000111.md))

## Current terminal task list

1. **Fixture evidence — RETAINED / FROZEN.** Linux 399, Windows 47,
   full-plus-sparse mutation proof, and the independent Sol artifact recheck are
   recorded. They are prior evidence, not a new run.
2. **Plan correction — DONE / TECHNICALLY READY.** Fresh Terra review and root
   cross-check found no concrete blockers. C owns persistence migration and
   constructors; creator-only CAS ownership and active-generation receipt
   registration are explicit; ambiguous landed writes require reconciliation.
3. **Next authorized stage — A0 INTERFACES.** Start the reviewed plan's bounded
   A0 neutral-interface stage separately from Phase 0 acceptance. Do not create
   a runnable controller, deploy, merge, or mark any phase complete.

## Current evidence and boundaries

PR176 targets main at source head
ccb2ec9565f92a867c85f693a10f64a2e93032e0, which records the technically ready
plan review. Fixture commit 42125cb2 remains unchanged from source head
8237febde3db147e161172cc87d2ab76c7bb1814; PR176's remote body is updated.
This coordination proposal is on codex/kb-vm-overhaul-ops-20260907 for PR177;
c7792546648b28cc87e72262b2951942a1362065 is historical baseline only.

Linux run Y5mujQ passed all 399 selected tests, including 11 isolated realBroker
tests, typecheck, and native Vite build (128 modules), from source archive
6d09d54ab5356a8425f9c5b1b0fb6291fcb153159ad709136dc12f32bc5aa073. Root's
fresh Windows adapter gate passed 47 tests in 5.55 seconds. HrOmLA mutation-only
verification passed: the deliberate chmod gave 2 failed / 0 passed / 34 skipped
in each full and sparse variant (02770 versus captured 02700); exact restoration
SHA checks passed and restored runs gave 2 passed / 0 failed / 34 skipped.
Independent Sol recheck is TECHNICALLY READY after verifying disk archive SHA,
overlay, 399/typecheck/build evidence, JSON mutant/restored counts and modes,
exact checksums, and unchanged source.

The renewed plan-only correction/review cycle is **TECHNICALLY READY**. It
assigned C the actual persistence migration and constructors; limited
release/write-intent CAS to a creator-owned handle in the same chain; retained
ambiguous landed writes and crashes for reconciliation without automatic
recovery; and required a pre-effect active-generation registry with an immutable
subject/run/rows snapshot and pure-key reuse through Lock. No implementation
tests ran in this planning cycle, and no source binding occurred.

The last read-only VM probe found dashboard systemd failed with exit 1 on release
39197cf5d9322f21d859d6f7a98d3a5b57cc42ea; tailnet /healthz and /readyz returned
HTTP 502. PR173 was last checked OPEN. No new probe, deployment, or browser work
occurred. The signed production gate persists. Requested native work was
Terra-high and Sol-high; responding-model, cost, and inspection-grade telemetry
are unknown.

Historical builder, review, and recovery evidence remains in the linked
[Phase 0 card](../queue/working/01K2KBARCH0600000000000100.md),
[wake-me card](../queue/inbox/01K2KBARCH0600000000000112.md), and completed
[cycle record](../queue/done/01K2KBARCH0600000000000113.md).

## Phase rule

Plan review → bounded implementation → focused tests → fresh code review →
phase integration/browser/fault evidence → required human gate. Independent work
may proceed around an unavailable environment; its readiness gate cannot be
waived.
