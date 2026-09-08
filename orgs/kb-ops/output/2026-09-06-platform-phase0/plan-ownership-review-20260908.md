# DRAFT ? Phase 0 plan ownership review, 2026-09-08

**Verdict: TECHNICALLY READY for the staged implementation described in the work order.** The user authorized one further plan correction/review cycle with a different builder. Independent review found no concrete blocker; the orchestrator cross-check agreed. This is a planning verdict, not Phase 0 acceptance.

The reviewed change is [remaining-integration-work-order.md](remaining-integration-work-order.md), based on source commit `8237febde3db147e161172cc87d2ab76c7bb1814`. Only that document's technical clauses changed; its final status annotation records the verdict.

- **Persistence ownership:** C explicitly owns the strict PTY decoder, legacy v2/v3 normalization, constructors, cloning, registry CAS, and corresponding tests. The binding extends only `AttemptOperationRecord`; shared manual/session receipts remain unchanged. Review traced `pty/sessionPersistence.ts`, `pty/contracts.ts`, and `pty/sessionRecord.ts` plus the affected constructor fixtures.
- **Claim ownership:** one successful creator receives an ephemeral handle. Repeated callers only observe. Bind admission prevents direct release; the same chain-store CAS arbitrates release versus write intent. An ambiguous landed mutation cannot grant permission to continue or release. Terminal tombstones preserve operation identity and exclude later queued messages. Review traced `agentSessionChains.ts`, `atomicJsonDocument.ts`, and `attemptSessionAdapter.ts` and walked the plan's race table.
- **Ledger lifetime:** the active generation owns the registry from construction. It records each immutable input snapshot before issuing effects, reuses unresolved matching keys, and retains the same map through Lock. Reconciliation uses the original snapshot even when intent persistence failed. Completion and recovery callbacks are entry-identity guarded; multi-run, duplicate-key, and falsey-failure cases are explicit acceptance obligations.

## Verification and limits

`git diff --check` passed. The four frozen adapter/grant source and test files have zero diff against `8237febd`. No implementation tests were rerun for this document change. The [prior fixture evidence](resume-evidence-20260907.md) remains valid: Windows 47, selected Linux 399, typecheck/build, and full/sparse mutation proof; Linux toolchain pins still differ.

Ambiguous crashed claims deliberately remain reconciliation-required. This plan provides no automatic replay, ownership takeover, or automatic claim recovery. The implementation must surface that condition through the existing refusal/boundary path. These are protected design limits, not a claim that restart recovery is complete.

Requested builder model: `gpt-5.6-sol` high. Requested independent reviewer: `gpt-5.6-terra` high. Responding-model and cost telemetry are unavailable; no formal inspector grade is asserted.

The next planned stage is A0's neutral lifetime and grant-outcome interfaces, followed by the ordered C/D, A1, and B waves and their independent tests/reviews. No production binding, merge, deployment, new public authority, or phase completion occurred in this cycle.
