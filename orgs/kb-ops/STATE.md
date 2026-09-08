# kb-ops — STATE

_Updated: 2026-09-08 (A0 ready; C0 active; D0 bounded correction active)_

## Now

- The complete twelve-phase overhaul remains active. Phase 0 is incomplete and
  Phases 1–11 remain gated. The ownership plan is TECHNICALLY READY, A0 neutral
  interfaces are complete and independently READY. C0 and the D0 review-driven
  correction are active. None of this completes Phase 0 or
  authorizes production.
- PR176 targets main at current source head
  df100897837d9ba6916bf810552127ca0f4029bf. It adds only A0's neutral
  `executionLifetime` interface/test and `SpendGrantProvisionOutcome`; the
  engine and frozen adapter/grant files remain untouched. The reviewed plan is
  at ccb2ec9565f92a867c85f693a10f64a2e93032e0. This coordination proposal is at
  b5b0233b143b921693e517e29e0c6c4dec17f8e8 for PR177.
- Linux run Y5mujQ passed all 399 selected tests, including 11 isolated
  realBroker tests, typecheck, and native Vite build (128 modules), from archive
  6d09d54ab5356a8425f9c5b1b0fb6291fcb153159ad709136dc12f32bc5aa073. Root's
  fresh Windows adapter gate passed 47 tests in 5.55s. The environment was Node
  24.19.0/npm 11.17.0 versus pins Node 24.18.0/npm 11.16.0.
- Fixture mutation proof passed. In HrOmLA, intentionally bad post-add chmod
  produced 2 failed / 0 passed / 34 skipped in both full and sparse variants,
  exposing 02770 versus captured 02700. Exact source restoration SHA checking
  passed; restored fixture runs were 2 passed / 0 failed / 34 skipped.
- Independent Sol recheck is TECHNICALLY READY: it verified disk archive SHA and
  overlay, 399-pass/typecheck/build evidence, JSON mutant/restored counts and
  modes, exact checksums, and unchanged source.
- The renewed plan-only correction/review cycle is **TECHNICALLY READY** after
  fresh Terra review and root cross-check. The plan now assigns C the actual
  persistence migration and constructors; permits release/write-intent CAS only
  to the creator-owned handle in the same chain; retains ambiguous landed writes
  and crashes for reconciliation without automatic recovery; and pre-registers
  an immutable active-generation receipt snapshot before effects, reusing its
  pure key across Lock. This remains planning only; no source binding or Phase 0
  acceptance is authorized.
- **A0 — READY.** Independent Sol review found the dormant lifetime interface
  and outcome type ready. Its six focused behavioral cases passed in 196 ms and
  dashboard typecheck passed; no engine, activation, or lifetime binding changed.
- **C0 — ACTIVE.** Sol owns only `agentSessionChains.ts` and its test for the
  claim-store protocol. **D0 — CORRECTION ACTIVE.** Terra's focused gate reported
  41/41 passed, but independent review found a no-card post-await withdrawal
  path that can promote canonical success. No broad suite or parallel typecheck.
- Requested native work was Terra-high and Sol-high; responding-model, cost, and
  inspection-grade telemetry are unknown and remain unrecorded. The last VM
  probe remains failed systemd/HTTP 502 evidence; PR173 was last checked OPEN and
  the signed production gate persists.

## Next

- Resolve D0's admission review and complete C0, then review each final diff
  before the next integration gate. Do not create a runnable controller, deploy,
  merge, or mark Phase 0 complete.

## Blocked

- Phase 0 still lacks generation-fence integration, browser/fault evidence, and
  its required human gate. Implementation remains blocked pending its bounded
  stages and evidence.
- The VM is not ready on the observed release, browser proof is absent, and the
  Linux toolchain differs from the repository pin.

## Historical evidence (not current operational status)

- The prior adapter snapshot was 34 pass / 2 fail because a parent setgid bit
  produced 02700 where the fixture expected 0700. Earlier completed records and
  the 2026-09-07 recovery handoff remain historical evidence in Git.
