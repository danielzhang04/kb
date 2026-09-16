---
id: 1bd95cce-f49fcac2
project: kb-ops
action: fix:commit-never-validates-store
target: dashboard/server/control/store.ts
risk-tier: T2
owner: null
claim-token: null
state: inbox
approval: null
workflow: null
depends-on: []
variant-group: null
role: work
session-id: null
runtime: null
model: null
---

## Work order

[HIGH] `commit()` in `dashboard/server/control/store.ts:1922` never validates the document
before persisting it, and it is called from all 67 write sites in the file. This is the same
defect class as B1 (stop poisons doc, fixed for its one call site in #188) but latent across
every other writer — including `archiveRun`, `respondHumanRequest`, and `transitionAttempt`. Any
of those can persist a structurally invalid document and brick the daemon on next load, exactly
like B1 did before the hotfix.

Fix: run the B1 fix's validation triad (whatever `assertHydrated`/shape checks #188 added at the
one call site) inside `commit()` itself, gated by a durability flag or env var so it can be
staged in before being made unconditional. A request that would persist an invalid shape must
fail the write with a 4xx instead of writing.

## Acceptance
- `assertHydrated` (or equivalent) triad runs inside `commit()`, gated by a durability flag/env
  var, covering all 67 existing call sites without requiring each one to opt in individually.
- A request engineered to produce an invalid document shape (reuse or adapt the B1 repro) is
  rejected with 4xx and never reaches disk; the daemon does not brick.
- Measure and record the added latency of the validation triad on the ~250 KB prod document
  (see Evidence) — acceptance requires the number is recorded, not a specific ceiling.

## Evidence
Opus adversarial review of PR #188, finding on latent B1-class defect across `store.ts` write
sites. Local paths: `C:\Users\danie\kb-rehearsal\tooling\rehearsal\p3\evidence.md`. Prod document
size reference from the 2026-09-15 rehearsal fixture (~250 KB).

## Result
