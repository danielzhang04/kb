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

1. **Cycle evidence — DONE.** Linux 399, Windows 47, full-plus-sparse mutation
   proof, and independent Sol artifact recheck are recorded in the completed
   cycle card. No phase is complete.
2. **Plan repair — FROZEN.** The review returned REQUEST CHANGES for
   sessionPersistence/test omission, durable creator-nonce/CAS ownership, and
   the active-generation ledger map. Do not repair it in this cycle.
3. **Exact next plan step — WAIT FOR RENEWED DIRECTION.** Propose the ownership
   fix and fresh review for the three blockers only. Do not bind the full
   lifetime path, deploy, merge, or mark any phase complete.

## Current evidence and boundaries

PR176 targets main at source head
8237febde3db147e161172cc87d2ab76c7bb1814, which includes fixture commit
42125cb2 and the evidence/paused-plan commit; its remote body is updated.
ddadeb073acad732fcc60496016dacd75d38e26b and fb66695b are historical bases.
This coordination proposal is on codex/kb-vm-overhaul-ops-20260907 for PR177;
0992b7b884aa4d6c2d393cdf04e1fab7c7e39a90 is historical baseline only.

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

The independent plan review is REQUEST CHANGES. It found that C omits
sessionPersistence.ts/test despite exactKeys validation; creator nonce is not
durable cross-store ownership and ambiguous landed CAS may release the winner;
and the RetiredExecution ledger map is created only at Lock rather than with and
retained by the active generation. Plan work is paused pending renewed user
direction.

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
