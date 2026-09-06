# KB platform overhaul adversarial review — DRAFT

Date: 2026-09-06

Review target: `origin/main` and worktree `HEAD` at `39197cf5d9322f21d859d6f7a98d3a5b57cc42ea`, plus the draft audit packet in this directory.

Scope: source-backed architecture, correctness, security, migration, and loop review. No production, credential, deployment, source, test, governance, coordination, or eval mutation was performed. This is the only artifact written by this review.

## Verdict

**Architecture direction: APPROVE WITH COMMENTS.**

**Production implementation or cutover: NOT AUTHORIZED AND NOT READY.** This is intentional rather than a remaining architectural rejection: the plan still requires user choices, a committed governance amendment, implemented acceptance harnesses, measured candidate evidence, a restore drill, and a signed cutover decision.

**Phase 0/1 card planning and isolated harness work: READY.** The pending `#173` recovery is a production merge/deploy prerequisite, not a reason to block independent local containment, inventory, or candidate-harness work.

The revised plan closes the original blocking design gaps. It now has a complete `StoreDocument` and external-store disposition, separates semantic quarantine from physical SQLite failure, defines a one-authority SQLite operating contract, compares SQLite with a bounded Temporal candidate, preserves credential-free VM publication and WebAuthn T3, distinguishes feedback/acceptance/authorization, assigns missing capabilities to real work packages, and makes post-cutover recovery asymmetric. No second scheduler, request-path dual write, self-accepting loop, blanket exactly-once external-effect promise, or weaker privilege boundary remains in the intended architecture.

## Blockers

### No unresolved architecture blocker after revision

The following original blockers are resolved in the revised plan:

- Complete migration ownership and disposition: `overhaul-plan.md:673-731`.
- Physical corruption versus run-local semantic quarantine: `overhaul-plan.md:661-671`, `:861-863`.
- SQLite migration, durability, backup, and restore contract: `overhaul-plan.md:90-96`.
- Typed identities and physical PK/FK/UNIQUE constraints: `overhaul-plan.md:733-743`.
- Credential-free trusted promotion and offline backlog semantics: `overhaul-plan.md:745-765`.
- Route-to-command actor/action/version/fence binding: `overhaul-plan.md:767-774`.
- Capability preservation and currently missing composition: `overhaul-plan.md:776-828`.
- Durable freeze/cutover journal and old-release admission guard: `overhaul-plan.md:531-541`.
- Governance activation order: `overhaul-plan.md:865-879`.

Production cutover remains blocked until those requirements are implemented and proved. In particular, the external journal must reach a durable fail-closed freeze state before the repository authority marker or first new write. A crash between journal states, marker persistence, link swap, readiness, or restart must leave old admission closed. Pre-marker abort must require a verified, recorded transition; no timeout or automatic restore may silently reopen the legacy writer.

## Major findings and required corrections

### M1 — Current production containment defects are real, reachable, and not all covered by the pending repair

**Source locations:**

- `dashboard/server/control/routes.ts:1730-1735`: detached `runAutomatic(...).catch(...)`; its reporter calls `createHumanRequest`, which can throw during store hydration.
- `dashboard/server/control/routes.ts:2504-2518`: detached `execution.catch(...)`; its reporter calls `createHumanRequest`, `getRun`, and `transitionRun`.
- `dashboard/server/control/routes.ts:2601-2607`: a discarded `.then(success, error)` chain; both paths may call `park`, which can reject.
- `dashboard/server/control/store.ts:1695-1715`: hydrate joins an iteration request without full subject/run scope, so two runs sharing a logical stage can make valid state globally unreadable.

The inspected pending commit `e8bf8d35` scopes the hydrate join and hardens `control/launch.ts` plus a queue-bridge timer reporter. It does not change these three `routes.ts` paths. On installed Node `v24.18.0`, a minimal unhandled rejected promise exited with status 1, so the route class has a concrete process-termination outcome.

**Required correction:** retain Phase 0’s inventory of all three continuations, route every detached continuation through a supervisor whose reporting and logging paths cannot reject, and fault-inject the reporter/store/logger in a child-process regression test. Do not describe `#173` as fixing this whole class.

### M2 — Current capability gaps require implementation or truthful retirement, not checkbox preservation

**Source locations:**

- Standalone VM execution exists, but distributed placement is not composed. `dashboard/server/index.ts:145-179,220-249` supplies no node identity/v1 ports and states that Desktop transport is not built; `dashboard/server/api/v1/routes.ts:195-200` consequently registers no node routes.
- `dashboard/server/placement/leaseService.ts:33-34,108-110` and `reportService.ts:110-113` accept a missing fresh advertisement even though the port defines it as lost capability. This is latent until placement is composed.
- The seven System paths are library functions without production FIRE-to-runner wiring (`dashboard/server/learnings/execution.ts:20-30`), and their Implementer registry is process-local (`:350-369`).
- Brain’s manifest lacks a source commit/corpus digest (`scripts/brain/store.py:93-106`), while `dashboard/server/brain/routes.ts:64-82` can return a valid response without a freshness comparison.
- `dashboard/server/health/routes.ts:45-50` reports node proxy and host-map success from constants. Conversely, the deferred MCP row in `dashboard/server/health/service.ts:28` is an unsupported capability and should not be converted into a fabricated probe.

The plan now assigns these to normative Phases 4, 8, and 9 and supplies named, not-yet-implemented canaries (`overhaul-plan.md:776-859`). That is the correct correction. A service unit test does not count as a working production capability: composition root, durable restart path, actual producer/consumer boundary, and truthful health state must all pass. Unsupported Desktop scheduling should default to retirement rather than create a second authority.

### M3 — Migration safety is now specified, but the specification is not evidence

`overhaul-plan.md:90-96` now requires one exclusive startup migrator, checksummed forward migrations, refusal of newer/partial schemas, per-connection foreign keys, measured WAL/synchronous/busy/checkpoint policy, WAL-safe backup, and kill/ENOSPC/WAL/SHM/migration-failure injection. `:531-541` requires a separately durable signed cutover journal, marker-aware guards in every rollback-eligible old release and activator, durable drain state across restart, and forward-only recovery after a new-authority write.

These requirements address the catastrophic paths found in review, including a main-file-only WAL backup, two migrators, automatic rollback into an old JSON writer, and a restart that forgets it was draining. They remain proposed behavior. Phase 10 cannot be called ready until the exact blank-instance restore and crash-boundary tests at `:846-863` exist and pass on the target filesystem and Linux release path.

The migration inventory is now complete against `StoreDocument` at `dashboard/server/control/storeTypes.ts:312-378`. It explicitly disposes:

`proposals`, `runs`, `stages`, `attempts`, `sessions`, `humanRequests`, `events`, `stageGenerations`, `iterationLoops`, `iterationRequests`, `iterationReceipts`, `generationSupersessions`, `quarantine`, `deployments`, `schedules`, `scheduleTombstones`, `scheduleOccurrenceClaims`, `scheduleSeedImports`, `hostAdvertisements`, `placementLeases`, `v1Idempotency`, `version`, `documentRevision`, `nextEventCursor`, `scheduleCollectionRevision`, `scheduleMirrorRevision`, `scheduleMirrorBatch`, `scheduleMirrorMergedWatermark`, `reconciliationReceipts`, `assetPullIntents`, and `cursorSecret`.

It also covers nested activation/recovery, schedule operation/emission/phase and deployment receipts, plus PTY state, canonical integration, accounting, outbox, artifacts, Git records, paid actions, spend grants, durable receipts, session chains, attempt I/O/results, composer/naming state, accepted-size/backups, reconciliation audit, and Brain generations (`overhaul-plan.md:709-731`). The proposed generated disposition test must fail on both missing and extra keys; this review does not claim that test exists.

`cursorSecret` receives the right special treatment at `overhaul-plan.md:707`: service-internal trusted preservation/rotation or deliberate cursor invalidation only. Its value must never pass through an agent, user, browser, worker, log, diagnostic, ordinary migration DTO, or review artifact.

### M4 — Lock/drain is a medium, unproved ordering risk, not the initially proposed Windows HIGH

`dashboard/server/control/activation.ts:801-818` detaches `attemptPort.drain()` and immediately applies locked state; the stored latch has only locked/unlocked at `:697-716`, and the lock route returns at `control/routes.ts:737-751`. This proves missing durable `draining`/generation state, but the previously hypothesized immediate HTTP interleaving is not established under normal promise/microtask ordering.

**Required correction:** keep severity MEDIUM and the plan’s deterministic delayed-drain, restart, old-generation callback, and Linux reconnect tests (`overhaul-plan.md:317-325`). Do not promote it to a demonstrated duplicate-launch incident without a reproduction.

### M5 — External effects remain at-least-once; only internal acceptance can be exactly-once

The final plan’s governing wording is correct at `overhaul-plan.md:66-72`, `:485`, `:573`, and `:595`: delivery is at least once, effect-before-receipt is reconciled, and uncertain non-idempotent effects park without automatic redispatch. It requires no duplicate accepted receipt or logical projection, not no duplicate physical provider effect.

**Required correction during implementation:** preserve this distinction in every provider adapter and test. Only capacity settlement and repository receipt acceptance inside one transaction may claim exactly-once behavior. Provider-specific idempotency or reconciliation guarantees must be recorded separately.

### M6 — Phase gates and proposed SLOs must not be reported as completed validation

The commands in `overhaul-plan.md:846-859` are explicitly “NOT YET IMPLEMENTED.” The Phase 2 workload—four deterministic fake workers, fanout/join, a human wait, retry, effect-before-receipt crash, 10,000 histories, and blank restore—and provisional p95 targets at `:834-844` are useful falsifiable hypotheses. They are neither measured capacity nor user-approved SLOs.

The reported 706 passing cases are selected evidence: 156 Python, 25 TypeScript from the boss run (23 initially passing plus two passing after state isolation), 402 TypeScript from four execution-audit files, and 123 TypeScript from eight different supporting-audit files. The file sets do not overlap, but the worker-reported suites were not independently rerun by this reviewer. The packet correctly says this is not a full suite, Linux/VM gate, coverage percentage, or end-to-end platform proof.

## Minor findings

### N1 — One README source line is imprecise

`README.md:60` cites `scripts/desktop_dispatch.ps1:26` for the checkout/pull hazard. The hard-coded checkout is at line 10 and the unchecked `Set-Location`, `git checkout ops`, and `git pull --rebase origin ops` are at lines 23-25; line 26 is blank. `overhaul-plan.md:397` uses the accurate `:10,23-27` range. Correct the README citation without changing the finding.

### N2 — LOC and coverage claims are now appropriately bounded

`surface-and-coverage.md:23,31` correctly classifies the two `scripts/test_codex_dispatch_*.py` files and `KeepAwake.Tests.ps1` as tests: `scripts/` is 100 tracked files, 96 production, 3 test, 1 asset, 30,251 physical lines. The earlier 98-production/30,765 count was wrong and has been corrected.

The inventory covers 1,120 tracked paths in the declared families, not every repository path or every source line. The packet’s current caveat—deep review on selected critical paths, conservative `traced`/`inventoried` labels elsewhere—is supportable. No stronger semantic-coverage claim should be made from the TSV.

### N3 — Prior-art evidence is directional, not a benchmark

`prior-art.md` distinguishes source inspection from documentation and openly uses moving n8n `master` links. Its conclusions are suitable for architecture comparison, not a security, reliability, or superiority claim. Implementation cards should pin exact upstream commit SHAs for any borrowed mechanism and rerun the bounded Temporal comparison rather than pre-rejecting it from topology alone.

## Security and governance conclusion

The revised target preserves the important trust boundaries:

- The VM does not gain a general remote Git push credential.
- A trusted Desktop promoter validates the strict parent chain and applicable signed instruction before publication.
- Local completion and Git publication are separate states, with explicit backlog pressure.
- Tailnet presence, worker results, scheduler occurrences, outbox receipts, task feedback, and output acceptance cannot substitute for a WebAuthn-bound T3 grant.
- Workers receive resolved capabilities rather than card text, connector secrets, or ambient configuration.
- Route schemas are generated from one wire source, but action binding is independently tested through the real route/command/transaction path.
- Independent judges cannot edit acceptance criteria or self-accept; learning loops require deterministic goals, boundaries, cap-two escalation, STOP behavior, and human acceptance.

No credential values or secret-bearing files were inspected.

## Complexity to delete or decline

Do not build a Desktop scheduler, replicated authority, Postgres service, n8n/Prefect control plane, or full Temporal estate without the explicit need and disconfirming evidence in `overhaul-plan.md:74-86`. The default should retire the unsafe `desktop_dispatch.ps1` scheduling story, then remove legacy JSON hot-path writers, duplicate supervisors, obsolete migration routes, and dormant fallbacks only after zero-caller, retention, export, and rollback proof. Phase 11’s subtraction gate is necessary; it must not become a new self-improvement subsystem that preserves every compatibility layer indefinitely.

## User decisions that gate implementation

Daniel must decide before architecture selection or production migration:

1. The highest-priority real workflows and required parity floor, including agent defaults, workflow DAG/iteration, terminal, Brain/memory, and System schedules.
2. Accepted workload and recovery envelope: concurrency, command/scheduler latency, retention, backup RPO/RTO, tolerated loss of accepted work, and target hardware.
3. Whether Desktop scheduling/execution is supported or retired. The safe default is client/promoter only.
4. Maximum trusted-promoter offline duration and warn/block/human thresholds; offline local progress is not remote archival progress.
5. Artifact/transcript storage and retention policy.
6. Legacy open-run disposition, cursor preservation versus invalidation, cutover authority, and post-cutover forward-recovery responsibility.
7. SQLite versus the bounded Temporal candidate after identical-workflow evidence exists. Postgres remains conditional on a demonstrated multi-writer/HA need that the selected candidate cannot meet.
8. The governance amendment that changes runtime authority while preserving Git/card compatibility and the existing T3 floor.

None of these choices may authorize an unexplained integrity/security mismatch, uncertain external effect, credential exposure, weaker T3 channel, dual writers, or rollback into a marker-unaware legacy writer.

## Verification performed and limits

- `python scripts/preamble.py` — PASS.
- Confirmed `HEAD == origin/main == 39197cf5d9322f21d859d6f7a98d3a5b57cc42ea`.
- Independently traced the named route continuations, hydrate join, activation drain, Desktop wrapper, health placeholders, composition root, placement lease/report checks, learning wiring, Brain manifest/routes, and release rollback branches.
- Independently compared the full `StoreDocument` field inventory to the revised disposition appendix.
- Ran only a minimal local Node unhandled-rejection probe; no source test suite was rerun by this reviewer.
- Relied on clearly attributed packet evidence for the 706 selected passing cases; did not convert it into a coverage or production claim.
- No live VM, Linux deployment, provider, signed promotion, restore, browser session, production state, or credential path was tested.

This review used the repository’s code-review, security-review, and loop-design-check procedures. They caused the final design to retain exact source/trigger/outcome evidence, explicit trust-boundary checks, and human judgment outside autonomous learning loops.
