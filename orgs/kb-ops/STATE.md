# kb-ops — STATE

_Updated: 2026-09-08 (published draft checkpoint; no production change)_

## Now

- Daniel's requested scope remains the complete twelve-phase overhaul with
  adversarial reviews and tests. Phase 0 is partly built and remains incomplete;
  Phases 1–11 remain gated. Lock semantics are still a policy decision, not an
  implementation approval.
- The source/evidence checkpoint is published on draft PR176: remote head
  `fb66695b`, final source commit `ddadeb07`. It includes WIP `1ba6d038`, the
  initial remaining-integration plan `246b342f`, the exact-LF manual-runner fix,
  and the evidence checkpoint. The source tree is clean. `9512f79f` remains the
  recovered baseline and `246b342f` remains the historical initial draft
  reference.
- Slice 1A adapter WIP is paused awaiting one user-directed actual-mode-capture,
  review, and Linux rerun cycle. The first integration-plan review returned
  REQUEST CHANGES with four concrete blockers: ledger recovery API; all
  pre-write release boundaries; immutable empty-claim/prompt-identity race
  handling; and interface ordering. The second review returned REQUEST CHANGES
  with two remaining blockers: attempt status/record ownership plus CAS-loser
  claim release, and all-admitted ledger receipt tracking before Unlock. The
  plan and Slice 1A fixture are paused under the two-failure rule pending one
  renewed bounded correction/review cycle. Native responding-model and cost
  telemetry remain unknown.
- Windows evidence includes adapter 47 tests and the independent 4-file/79-test
  gate. Fresh unaffected Linux evidence passed 363 selected tests, excluding
  `adapters.test.ts`, plus typecheck, native Vite build (128 modules), and
  realBroker 11. Node/npm were 24.19.0/11.17.0 against pins 24.18.0/11.16.0.
  Archive SHA-256: `8e4fd59ea86183199a7ad64a4d8bf09be2d4b39e69b2d847c3a0a6c854ae4613`.
- VM evidence is read-only: dashboard systemd failed/exit 1 on release
  `39197cf5d9322f21d859d6f7a98d3a5b57cc42ea`, while tailnet `/healthz` and
  `/readyz` returned HTTP 502. PR173 remains OPEN/MERGEABLE and is the unmerged
  prerequisite. Browser bootstrap is blocked by the Windows ACL-read failure.
- No production deployment, authority change, or governance change occurred.
  Build/review/publication work was authorized and recorded; production
  activation still requires its signed ceremony and acceptance evidence.

## Next

- Keep the plan and adapter implementation paused under the two-failure rule.
  Await one user-directed bounded correction/review cycle for the two remaining
  plan blockers and the Slice 1A actual-mode-capture/Linux rerun.
- Preserve the full twelve-phase sequence and Phase 0 gate. Do not bind lifetime
  callbacks, claim Phase 0, or infer production readiness from selected tests.
- Keep VM/browser facts read-only and explicit. Continue only the authorized
  isolated work; production activation remains separately signed and gated.

## Blocked

- Phase 0 lacks the full generation fence, integration/browser/fault evidence,
  and required human gate. The second review's two remaining plan blockers
  remain unresolved.
- Lock/stop semantics, runtime selection, topology, cutover, and production
  authority remain open decisions. No replacement UI/control was approved.
- Browser proof is unavailable; VM readiness is failed on the observed release.
  Unknown native telemetry must remain unknown rather than becoming a zero-cost
  or model-identity claim.

## Historical evidence (not current operational status)

- July 21 Wave A supervised `self-lint-report` succeeded (`run-7b0b8de8`, four
  runbook checks), then the daemon was returned to inert. Do not carry those
  July observations forward as September facts.
- Prior unresolved notes concerned repo-wide read-scope design and an intent-scan
  false positive. This audit did not adjudicate their current merge/status history.
