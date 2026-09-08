# KB platform implementation checklist

Approved 2026-09-06. Canonical task state is in the linked phase cards; this is
the terminal checklist's durable projection, not an executor or new authority.
All required capabilities remain in scope. Runtime selection and production work
retain their separate human gates.

- [ ] Phase 0: Contain failures and establish dashboard diagnostics ([card](../queue/working/01K2KBARCH0600000000000100.md)) — BOUNDED PORTS EVIDENCED; INCOMPLETE
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

1. **A0 neutral interfaces — DONE / READY.** The source port remains dormant;
   six focused behavioral cases passed in 196 ms and typecheck passed.
2. **Fixture evidence — RETAINED / FROZEN.** Linux 399, Windows 47, and the
   full/sparse mutation proof are prior evidence, not tests rerun in this wave.
3. **C0 claim store — DONE / READY.** Source head
   `2b323531008419b3d87dfbbb312bc8cdc381c041` includes C0. Root independently
   verified typecheck and 18/18 focused claim-store tests in 1.18 s.
4. **D0 canonical admission — DONE / READY.** The bounded correction is at
   `57aebea0`; its focused suite passed 45/45 in 2.64 s and includes the held
   scheduler red/green proof.
5. **C1 schema/migration — FROZEN UNDER INDEPENDENT REVIEW.** Terra-high
   completed 65 PTY and 164 adapter/surface focused tests. After one
   malformed-fixture inference correction, root reran the 24-test migration
   subset and dashboard typecheck PASS; the subset is not added to that total.
   Fresh Sol-high review is active. No message delivery or B binding is active.
6. **D1 ledger design — PAUSED.** The same rebase-recovery finding failed two
   correction/review attempts. Root has asked the user for one further bounded
   cycle; no D1 draft edit or implementation dispatch may occur until answered.

## Current evidence and boundaries

PR176 targets main at source head
`2b323531008419b3d87dfbbb312bc8cdc381c041`; it records A0, C0, and D0 only.
The C1 source files are actively owned and uncommitted. The frozen Slice 1A
adapter/grant files remain unchanged. Coordination is based on
`a4e4d06838335972bf066506b2d7b06e24171fc9` for PR177.

Linux run Y5mujQ passed all 399 selected tests, including 11 isolated realBroker
tests, typecheck, and native Vite build (128 modules), from source archive
`6d09d54ab5356a8425f9c5b1b0fb6291fcb153159ad709136dc12f32bc5aa073`. Windows
passed 47 tests in 5.55 seconds. HrOmLA mutation verification passed: the
deliberate chmod mutant failed in full and sparse variants; exact restoration
then passed. This retained fixture evidence is not a new C1 run.

The last read-only VM probe found dashboard systemd failed with exit 1 on release
`39197cf5d9322f21d859d6f7a98d3a5b57cc42ea`; tailnet `/healthz` and `/readyz`
returned HTTP 502. PR173 was last checked OPEN. No new probe, deployment, or
browser work occurred. The signed production gate persists. Requested native
models and their responding-model/cost telemetry are recorded separately as
unknown.

## Phase rule

Plan review → bounded implementation → focused tests → fresh code review →
phase integration/browser/fault evidence → required human gate. Independent work
may proceed around an unavailable environment; its readiness gate cannot be
waived.
