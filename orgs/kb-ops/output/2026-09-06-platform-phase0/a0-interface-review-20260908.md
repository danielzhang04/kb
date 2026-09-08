# DRAFT ? A0 neutral interface review, 2026-09-08

**Technical verdict: READY.** This is the first implementation stage of the reviewed remaining-integration work order. It adds only `executionLifetime.ts`, its focused test, and `spendGrantProvisionOutcome.ts`, on source baseline `ccb2ec9565f92a867c85f693a10f64a2e93032e0`.

The lifetime revokes synchronously and irreversibly, resolves withdrawal once, and observes already-issued work without admitting effects. Each tracked call owns a separate pending entry even when labels repeat. Both success and rejection remove only that entry. An internal rejection observer prevents an ignored returned chain from becoming unhandled while preserving the exact value/error for callers. Pending snapshots expose labels only; the outcome import is type-only.

Independent code review found no blocking findings. Its one non-blocking comment removed a redundant arity/property/literal test; all six behavioral cases remain. Final builder verification: focused lifetime test **6/6 passed** (196 ms), full dashboard typecheck passed, and diff hygiene passed. The six cases cover immediate/idempotent withdrawal, held success, Error/undefined rejection propagation, ignored rejection observation, duplicate-label barriers, and post-withdrawal observation.

Requested builder: `gpt-5.6-terra` high. Requested independent reviewer: `gpt-5.6-sol` high. Responding-model/cost telemetry are unavailable; this is not a formal inspector grade.

The engine, activation wiring, and four verified adapter/grant files remain unchanged. These neutral interfaces do not activate the generation fence. C/D ports, A1 engine integration, B wiring, integrated tests, browser/fault evidence, and production gates remain outstanding; Phase 0 is incomplete.
