# KB VM overhaul recovery handoff — 2026-09-07

**Topic:** bounded recovery of the stalled KB platform overhaul, with the
dormant Slice 1A source state preserved for supervised native execution.

**Checkpoint update:** 2026-09-08 — source WIP is clean, the unaffected Linux
gate passed its selected scope, and the paused adapter fixture remains excluded.

## Scope and authority

The complete twelve-phase overhaul remains the requested scope unless Daniel
steers recovery-first. Local builds, reviews, and source/evidence publication
were authorized and recorded. Production activation, authority changes,
deployment, and governance changes still require their signed ceremonies.
The Lock preference and the full-overhaul versus recovery-first choice remain
pending. Existing Lock, per-run Stop, and deployment readiness concerns stay
separate until that steering is recorded.

No private auth or secrets were read. No VM/deployment state is inferred from
isolated source records. Browser/composition, live VM availability, enabled
schedules, and execution-gate state are reported only where the authorized
read-only probe supplied evidence.

## Recovered source state

- Source worktree:
  `C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907`
- Branch: `codex/kb-vm-overhaul-resume-20260907`
- Published checkpoint: draft PR176 at remote `fb66695b`, with final source
  commit `ddadeb07`, containing WIP
  `1ba6d038`, initial plan `246b342f`, and the evidence/manual-runner result.
  The exact-LF manual-runner fix is included. `9512f79f` remains the recovered baseline and `246b342f`
  remains the initial draft reference; the final plan revision will land after
  its independent recheck.
- The published checkpoint contains the three reviewed containment fixes:
  drain barrier `25f87ff3`, detached-error containment `02092581`, and
  restricted diagnostics `227e1bc9`, plus the four-file Slice 1A result. No
  production lifetime binding is part of this slice.
- The native builder completed the four-file diff. Its reported result is 47
  focused tests and typecheck passing. Initial ESM spy instrumentation failed
  and was corrected. Requested model was `gpt-5.6-terra` (high); responding-model
  telemetry is unavailable. Independent adapter review returned READY after
  correcting missing Linux mode observation; Windows 47 passes. The Linux
  snapshot was 34 pass/2 fail because the fixture expected 0700 while inherited
  setgid produced 02700, a fixture mismatch rather than a demonstrated source
  defect.
- The first integration-plan review returned REQUEST CHANGES for four blockers:
  ledger recovery API, all pre-write release boundaries, immutable
  empty-claim/prompt-identity race handling, and interface ordering. One
  `adapter_build` correction pass completed against the plan file only; the
  final independent recheck returned REQUEST CHANGES and is paused; it is not a
  source dispatch.

## Coordination records

The twelve canonical phase cards remain preserved: Phase 0 is working at
`queue/working/01K2KBARCH0600000000000100.md`; Phases 1–11 remain blocked in
`queue/inbox/01K2KBARCH0600000000000101.md` through `0111.md`; wake-me card
`01K2KBARCH0600000000000112.md` remains inbox. Canonical dependencies and links
were rechecked with `scripts.cards` after the proposal edits.

Three supervised child assignment records are complete execution records; their
native results remain separate from phase acceptance:

- [adapter_build](../queue/done/6a9f84a7-36d2e614.md) — four-file dormant
  Slice 1A build, `role: work`, requested `gpt-5.6-terra` high; builder and
  independent review recorded, one Linux mode cycle paused.
- [context_recovery](../queue/done/6a9f84a7-8859a3c3.md) — coordination
  context preservation, `role: scout`, requested `gpt-5.6-luna` high.
- [vm_readiness_audit](../queue/done/6a9f84a7-c1f269d9.md) — read-only VM and
  deployment readiness assessment, `role: scout`, requested `gpt-5.6-terra`
  high.

The cards omit `execution-controller: terminal`; no dashboard dispatch was
enabled and no task was double-dispatched. Actual responding-model telemetry is
unavailable, so no model identity, grade, or zero-cost assertion is fabricated.

## Read-only VM/deployment evidence

Daniel approved the narrow read-only SSH probe. It observed:

- `systemctl` dashboard `ActiveState=failed`, `SubState=failed`, `MainPID=0`,
  `ExecMainStatus=1`;
- broker socket/service active;
- `/opt/kb-releases/current` and VERSION at
  `39197cf5d9322f21d859d6f7a98d3a5b57cc42ea`;
- actual tailnet HTTPS `/healthz` and `/readyz` both HTTP 502.

The initial localhost:5317 `healthok`/UI was a different surface and is not
health proof. No signed deployment approval/token was observed. Browser bootstrap
failed before connection because the Windows sandbox denied the required ACL
read, so there is no browser proof. WSL is available for an isolated harness,
but its Node/npm versions are 24.19.0/11.17.0 versus repository pins
24.18.0/11.16.0; this is a compatibility caveat, not a deployment result.

Draft PR176 publishes this coordination checkpoint at `fb66695b`. PR #173
(`e8bf8d35ce11534a75d31a659535393942673496`) remains OPEN/MERGEABLE with
`mergedAt: null` and no reported checks. A prior remote probe request was
auto-review rejected because explicit target/root permission had not yet been
established; the later narrow probe was authorized. No deploy followed.
Existing coordination PR174 is a separate older proposal branch based on ops;
this recovery proposal is a new branch/PR and must not silently overwrite PR174
or its historical evidence.

## Established bounded evidence

- The old Phase 0 evidence still holds: 70 drain tests, 245 reporter tests,
  diagnostics/index/store 5+96+163, typecheck/native build, and the 11-test
  Linux broker baseline on `e8bf8d35`. These are bounded local gates, not
  full-suite, browser, new-patch Linux, live-VM, real-model, or deployment
  acceptance.
- A separate independent Windows gate passed 4 files/79 tests in 8.03s with
  native config, one worker and no file parallelism: activation,
  automatic-failure-reporter, boot diagnostics, and store-boot diagnostics.
  This is additional local evidence, not browser, live-VM, deployment, or
  Phase 0 acceptance.
- Fresh unaffected Linux evidence used archive SHA-256
  `8e4fd59ea86183199a7ad64a4d8bf09be2d4b39e69b2d847c3a0a6c854ae4613` and
  passed 363 selected tests: spend 11, boot 1, storeBoot 4, activation 70,
  reporter 4, store 163, launch 7, queueBridge 92, realBroker 11, plus
  typecheck and native Vite build (128 modules). `adapters.test.ts` was
  intentionally excluded after its recorded fixture failure; this is not full
  acceptance. Node-pty was rebuilt offline and realBroker passed 11. Node/npm
  were 24.19.0/11.17.0 versus repository pins 24.18.0/11.16.0. No approval
  settings changed.
- The initial Slice 1A/integration plan names the previously missed nested
  post-await worktree Git/file effects and post-mint grant-file write. Its
  first review returned REQUEST CHANGES for four concrete integration blockers;
  the pending correction is plan-file only and its recheck is not dispatchable.
- The full generation fence, operator-message claim receipt, route settlement,
  complete platform composition, runtime comparison, and cutover remain open.
- The dashboard checklist and `orgs/kb-ops/STATE.md` now point to this handoff
  as the current recovery context without marking any phase complete.

## What Worked

- The three containment commits and four-file Slice 1A result are published in
  draft PR176 at checkpoint `fb66695b`; the source tree is clean.
- The native adapter builder completed the four-file Slice 1A diff with 47
  focused tests and typecheck passing; the initial ESM spy instrumentation was
  corrected. The adapter review was READY. The plan-file-only correction
  completed, then the second integration-plan review returned REQUEST CHANGES;
  the plan is paused.
- The authorized read-only VM probe and separate Windows 4-file/79-test gate
  produced bounded evidence. Twelve canonical phase cards and dependencies
  parse cleanly, and the three execution records are in `queue/done` without a
  terminal controller.

## What Did Not Work

- The first ESM spy instrumentation attempt failed and had to be corrected.
- Dashboard systemd is failed with exit 1 and tailnet healthz/readyz return
  HTTP 502; the localhost:5317 healthok/UI surface cannot establish health.
- Browser bootstrap failed before connection because the Windows sandbox denied
  the required ACL read. A prior remote probe request was auto-review rejected
  before explicit target/root permission; the later narrow read-only probe was
  authorized.
- The first Linux mode observation reported 34 pass/2 fail because the test
  expected 0700 while inherited setgid produced 02700. Under the two-failure
  rule, no third automatic Slice 1A repair/review loop was started.

## What Has Not Been Tried

- No production deployment, remediation, release activation, merge, or
  production authority change has been performed. Source/evidence publication
  to draft PR176 did occur under the authorized workflow.
- No generation-fence lifetime binding, operator-message claim receipt, route
  settlement integration, full browser/server journey, real-model canary, or
  phase-level acceptance has been completed.
- One renewed bounded actual-mode-capture, review, and Linux-rerun cycle is
  pending the user's direction. The isolated Linux harness still has the
  repository Node/npm pin mismatch (24.19.0/11.17.0 versus 24.18.0/11.16.0),
  and node-pty/koffi install scripts were skipped, so broker binary readiness
  is unproven for the paused adapter slice. The fresh unaffected run passed its
  selected 363-test gate; it intentionally did not rerun paused adapters and is
  not a full acceptance gate.

## Current State of Files

| Path | State |
| --- | --- |
| `queue/working/01K2KBARCH0600000000000100.md` | Phase 0 manager card working; incomplete |
| `queue/inbox/01K2KBARCH0600000000000101.md`–`0111.md` | Phases 1–11 blocked and preserved |
| `queue/inbox/01K2KBARCH0600000000000112.md` | Historical wake-me context; current resume reset the bounded stop |
| `queue/done/6a9f84a7-36d2e614.md` | Adapter builder and independent review recorded; one Linux mode cycle paused |
| `queue/done/6a9f84a7-8859a3c3.md` | Context recovery complete |
| `queue/done/6a9f84a7-c1f269d9.md` | Read-only VM assessment complete |
| `queue/done/6a9f8780-660fc886.md` | Plan execution complete; final independent recheck REQUEST CHANGES, plan paused |
| `C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907` | Published PR176 remote `fb66695b`; final source commit `ddadeb07` |
| `dashboards/kb-platform-implementation.md` | Durable twelve-phase checklist; no phase complete |
| `orgs/kb-ops/STATE.md` | Current state with read-only VM facts and blockers |
| `memory/codex-worker.md` | Durable recovery lessons and telemetry caveat |
| `handoffs/2026-09-06-kb-platform-phase0-implementation.md` | Consumed and removed after this handoff completed; history remains in Git |
| `handoffs/2026-09-07-kb-vm-overhaul-resume.md` | Canonical continuation |

## Missing scope and acceptance decisions

1. The full twelve-phase overhaul remains the active requested scope by default.
   Daniel may steer recovery-first as a planning preference; that preference
   does not block already-authorized local build, review, or read-only work.
2. Daniel must choose the intended Lock semantics: compatibility-preserving
   executor-generation withdrawal with explicit Resume, finish current work,
   durable interrupt/park, or permanent cancellation. No new durable
   cancellation/UI behavior is authorized by the local records.
3. The VM probe establishes current failure/readiness facts only. Deployment,
   remediation, release activation, schedule changes, and health recovery need
   separate authorization and acceptance.
4. The integration plan needs one correction/recheck for the four REQUEST
   CHANGES blockers. Slice 1A then needs one renewed bounded actual-mode-capture,
   review, and Linux rerun direction after the fixture mismatch. Exact native
   task telemetry is unavailable; no responding model was verified.
5. Phase 0 still requires generation-fence implementation and integration
   evidence, browser/server composition evidence, and the required human gate;
   dormant Slice 1A cannot close the phase.

## Exact next step

Retain the four-file Slice 1A result and adapter READY review as dormant
infrastructure. The final independent recheck returned REQUEST CHANGES; retain
the two findings and await one user-directed bounded correction/review cycle for
both the plan and adapter fixture before the Linux mode-capture/rerun. The Lock
semantics choice remains open for later durable control/UI work. Do not bind
lifetime callbacks, activate remote/dashboard dispatch, assign a terminal
controller, deploy, merge, or mark Phase 0 complete.

## Load list

- `CLAUDE.md`, `governance/agent-rules.md`, and `orgs/kb-ops/contract.md`
- `orgs/kb-ops/STATE.md` and `memory/codex-worker.md`
- `dashboards/kb-platform-implementation.md`
- Phase cards `01K2KBARCH0600000000000100` through `0112`
- `orgs/kb-ops/output/2026-09-06-platform-audit/implementation-sequence.md`
  and `overhaul-plan.md` from the audit worktree
- Source plan `execution-generation-plan.md` and drafted
  `remaining-integration-work-order.md` at initial reference `246b342f`; final
  source checkpoint is `ddadeb07`
- Published source checkpoint `fb66695b`, committed four-file Slice 1A result,
  initial plan `246b342f`, and evidence/manual-runner result
