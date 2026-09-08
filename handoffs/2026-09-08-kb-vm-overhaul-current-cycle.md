# KB VM overhaul current-cycle handoff — 2026-09-08

**Topic:** preserve the verified fixture result and paused plan review while
keeping the complete twelve-phase overhaul resumable.

The requested scope remains all twelve phases: failure containment, broker
contracts, runtime choice, transactional commands, placement, scheduler,
terminal/model verification, artifact recovery, learning paths, truthful health,
cutover, and sustained verification. This cycle did not complete Phase 0 or
authorize production work.

### What WORKED (with evidence)

- **Linux selected gate** — Linux run Y5mujQ passed all 399 selected tests,
  including 11 isolated realBroker tests, typecheck, and native Vite build
  (128 modules), from archive
  6d09d54ab5356a8425f9c5b1b0fb6291fcb153159ad709136dc12f32bc5aa073.
- **Windows adapter gate** — root recorded 47 passing tests in 5.55 seconds.
- **Mutation proof** — HrOmLA exit 0 confirmed that deliberately bad post-add
  chmod produced 2 failed / 0 passed / 34 skipped in both full and sparse
  variants, exposing 02770 versus captured 02700. Exact restoration SHA checks
  passed; restored runs were 2 passed / 0 failed / 34 skipped.
- **Source evidence** — PR176 source head
  8237febde3db147e161172cc87d2ab76c7bb1814 includes stable fixture commit
  42125cb2 and the evidence/paused-plan commit. ddadeb073acad732fcc60496016dacd75d38e26b
  is historical basis.
- **Independent final artifact recheck** — Sol returned TECHNICALLY READY after
  verifying disk archive SHA and overlay, 399/typecheck/build evidence, JSON
  mutant/restored counts and modes, exact checksums, and unchanged source.
- **Coordination baseline** — the ops worktree was current with origin/ops
  (HEAD..origin/ops count 0). Earlier source
  ddadeb073acad732fcc60496016dacd75d38e26b and coordination
  0992b7b884aa4d6c2d393cdf04e1fab7c7e39a90 checkpoints are historical.

### What Did NOT Work (and why)

- **First mutation verifier** — its LF anchor did not match the archived CRLF
  adapters.ts source, so it did not run the mutation. A newline-aware verifier-only
  correction followed; HrOmLA then completed the mutation-only full and sparse
  checks recorded above. No fixture source change was needed for that correction.
- **Plan review** — returned REQUEST CHANGES. C still omits
  sessionPersistence.ts/test despite exactKeys validation; creator nonce is not
  durable cross-store ownership and ambiguous landed CAS may release the
  winner; and the RetiredExecution ledger map is made only at Lock rather than
  created with and retained by the active generation. Plan repair is frozen.
- **VM readiness** — the last read-only probe found dashboard systemd failed
  with exit 1 and tailnet health/ready returned HTTP 502 on release
  39197cf5d9322f21d859d6f7a98d3a5b57cc42ea. No remediation was authorized.
- **Browser proof** — the prior Windows sandbox ACL-read failure prevented
  browser evidence. No substitute browser attempt was made.
- **Exact toolchain pin proof** — Linux verification used Node 24.19.0/npm
  11.17.0, while repository pins are Node 24.18.0/npm 11.16.0. Exact-pin
  verification remains unproven.

### What Has NOT Been Tried Yet

- After renewed user direction, propose an ownership fix and fresh review for
  the three plan blockers only. Do not implement full lifetime binding.

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| queue/done/01K2KBARCH0600000000000113.md | DONE | One supervised fixture-and-plan cycle result; no phase acceptance. |
| orgs/kb-ops/STATE.md | WIP | Verified fixture and final plan-review facts; Phase 0 remains incomplete. |
| dashboards/kb-platform-implementation.md | WIP | Twelve phases retained; current terminal task list. |
| queue/working/01K2KBARCH0600000000000100.md | WIP | Phase 0 incomplete; cycle record linked. |
| queue/inbox/01K2KBARCH0600000000000112.md | WIP | Historical stop retained; plan frozen pending renewed direction. |
| queue/done/6a9f8780-660fc886.md | DONE / HISTORICAL | Prior plan-only record with superseded pointer. |
| C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907/dashboard/server/control/adapters.test.ts | DONE | Verified test-only fixture at source commit 42125cb2. |
| C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907/orgs/kb-ops/output/2026-09-06-platform-phase0/remaining-integration-work-order.md | WIP / PAUSED | Plan review REQUEST CHANGES; ownership fix needs renewed direction. |
| C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907/orgs/kb-ops/output/2026-09-06-platform-phase0/resume-evidence-20260907.md | DONE | Evidence incorporated at PR176 source head 8237febde3db147e161172cc87d2ab76c7bb1814. |
| ledgers/cost/codex-worker-2026-09-08.tsv | WIP | Requested models and unavailable telemetry only; no grade row. |
| handoffs/2026-09-08-kb-vm-overhaul-current-cycle.md | WIP | This active handoff. |

### Exact Next Step

After renewed user direction, propose the ownership fix and fresh review for the
three plan blockers only; do not bind the full lifetime path or claim Phase 0.

### Load list

- CLAUDE.md
- governance/agent-rules.md
- orgs/kb-ops/contract.md
- orgs/kb-ops/STATE.md
- dashboards/kb-platform-implementation.md
- queue/working/01K2KBARCH0600000000000100.md
- queue/inbox/01K2KBARCH0600000000000112.md
- queue/done/01K2KBARCH0600000000000113.md
- queue/done/6a9f8780-660fc886.md
- ledgers/cost/codex-worker-2026-09-08.tsv
- C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907
- C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907/orgs/kb-ops/output/2026-09-06-platform-phase0/execution-generation-plan.md
- C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907/orgs/kb-ops/output/2026-09-06-platform-phase0/remaining-integration-work-order.md
- C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907/orgs/kb-ops/output/2026-09-06-platform-phase0/resume-evidence-20260907.md
- C:/Users/danie/kb/_private/codex-worktrees/kb-platform-overhaul-20260906/orgs/kb-ops/output/2026-09-06-platform-audit/implementation-sequence.md
- C:/Users/danie/kb/_private/codex-worktrees/kb-platform-overhaul-20260906/orgs/kb-ops/output/2026-09-06-platform-audit/architecture-brief.md
- handoffs/2026-09-06-dashboard-outage-recovery.md — separate outage context; PR173 and signed production gates remain distinct
- skill: save-session
