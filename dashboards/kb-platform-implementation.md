# KB platform implementation checklist

Approved 2026-09-06. Canonical task state is in the linked phase cards; this page
is the terminal checklist's durable projection, not an executor or new authority.
All required capabilities remain in scope. Runtime selection and production actions
retain their separate human gates.

- [ ] Phase 0: Contain failures and establish dashboard diagnostics ([card](../queue/working/01K2KBARCH0600000000000100.md)) - PARTLY BUILT; SLICE 1A + INTEGRATION PLAN PAUSED AFTER REQUEST CHANGES; LOCK/PHASE GATES OPEN
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

## Current work

Phase 0, isolated worktree `codex/kb-platform-phase0-20260906` at prerequisite
`e8bf8d35`; recovered dormant Slice 1A source state is at `9512f79f` on
`codex/kb-vm-overhaul-resume-20260907`. Pending PR173 remains OPEN/MERGEABLE
with `mergedAt: null` and no reported checks; it is not merged or deployed.
Three local reviewed slices: drain barrier 25f87ff3, detached-error containment
02092581, restricted diagnostics 227e1bc9. The four-file Slice 1A builder result
is 47 focused tests plus typecheck passing; initial ESM spy instrumentation was
corrected. Independent adapter review returned READY; Linux mode follow-up is
paused after a fixture mismatch. Gates: 70 drain
tests, 245 reporter tests, 5+96+163 diagnostics/index/store tests, typecheck/build.
Existing Linux broker baseline: 11 tests on e8bf8d35 only. These are bounded
gates, not full-suite, browser, new-patch Linux, live-VM, or platform acceptance.
Generation fencing and Lock semantics remain open. No phase is complete.

Authorized read-only VM evidence: dashboard systemd failed/failed, exit 1,
broker active, release/VERSION `39197cf5d9322f21d859d6f7a98d3a5b57cc42ea`, and
tailnet healthz/readyz HTTP 502. Localhost:5317 healthok/UI is a different
surface and is not health proof. No signed deployment approval/token was
observed. Browser bootstrap previously failed before connection, and no
browser proof exists.

Separate independent Windows gate: activation, automaticFailureReporter,
bootDiagnostics, and storeBootDiagnostics passed 4 files/79 tests in 8.03s with
native config, one worker, and no file parallelism. This is local evidence only.

Fresh unaffected Linux run from archive SHA-256
`8e4fd59ea86183199a7ad64a4d8bf09be2d4b39e69b2d847c3a0a6c854ae4613` passed
363 selected tests: spend 11, boot 1, storeBoot 4, activation 70, reporter 4,
store 163, launch 7, queueBridge 92, realBroker 11, plus typecheck and native
Vite build (128 modules). `adapters.test.ts` was intentionally excluded after
its recorded fixture failure; this is not full acceptance. Node/npm were
24.19.0/11.17.0 versus repository pins 24.18.0/11.16.0. Node-pty was rebuilt
offline and realBroker passed; lifecycle approval remains a recorded
environment caveat.

Completed supervised records: [adapter_build](../queue/done/6a9f84a7-36d2e614.md)
and [vm_readiness_audit](../queue/done/6a9f84a7-c1f269d9.md) requested
`gpt-5.6-terra` high; [context_recovery](../queue/done/6a9f84a7-8859a3c3.md)
requested `gpt-5.6-luna` high. Responding-model telemetry is unknown. No
terminal execution-controller, dashboard dispatch, signed deployment approval
or token, or double dispatch is implied.
The completed [remaining integration work order](../queue/done/6a9f8780-660fc886.md)
records plan execution only, without source edits or a terminal controller.
Published draft PR176 checkpoint is `fb66695b`, containing WIP `1ba6d038`,
initial plan `246b342f`, and the evidence/manual-runner result. `9512f79f`
remains the recovered baseline; current committed source is `ddadeb07`. First
`integration_plan_review` returned REQUEST CHANGES for four blockers; the second
review returned REQUEST CHANGES for two remaining blockers. The plan and adapter
fixture are paused under the two-failure rule pending one renewed bounded cycle.

Daniel resumed the same Phase 0 manager card for bounded plan correction and fresh
review. Compatibility-preserving Lock wiring is a working assumption only, not an
approved policy vote or UI redesign. The [wake-me](../queue/inbox/01K2KBARCH0600000000000112.md)
remains inbox and records the remaining nested-effect finding and Lock/stop decision.

## Phase rule

Plan review -> bounded implementation -> focused tests -> fresh code review ->
phase integration/browser/fault evidence -> required human gate. Independent work
may proceed around an unavailable environment; its readiness gate cannot be waived.
