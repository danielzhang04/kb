# P21 atomic human-edit restart acceptance

Reviewed against accepted source `163a853b` on `codex/prospecting-session-20260909`.
Builder and independent reviewer both returned verified `claude-opus-5` response events.
The independent review used a fresh source-only vCPU job. Root ran the tests locally;
the workers did not execute tests. This accepts this bounded infrastructure slice.

The authenticated review action now records an immutable reset and its ordinary waiting
P16 item in one transaction. It requires a changed, QA-passed human edit descended from
the exact exhausted item, with no newer work or live claim. Replay requires both records.
Nearest-reset lineage resolution starts a new bounded cycle and preserves prior history.
No source confirmation, readiness, approval or sending authority is created.

Root verification:

- P16 service and authenticated HTTP tests: 71 passed in 35.64 seconds.
- Browser-state tests: 19 passed, including payload-bound restart and retry.
- ReviewService, feedback, approval and executor tests: 109 passed in 40.89 seconds.
- Store and affinity-schema tests: 52 passed; the separate launcher test was intermittent.
  Its synthetic process tree was verified and cleaned. Two subsequent isolated runs passed
  in 7.42 and 6.17 seconds. This does not establish that the intermittent failure is fixed.
- Diff hygiene passed. Staged source receives the repository PII guard before commit.

Independent technical verdict: READY. Root agrees on atomicity, changed-edit ancestry,
old-attempt fencing, repeated exhaustion, pending-edit preservation and inherited gates.
The exhausted item's historical intake/policy can differ: the new item binds and validates
current context. Requiring the immutable exhausted item to become current would prevent
recovery after a legitimate intake change.

Nonblocking review comments remain: database faults use the existing fixed generic HTTP
error, blocked-restart copy could describe the specific remedy more clearly, and the store
does not duplicate every service-level ancestry/currentness check. No speculative future
writer or unmeasured performance concern is accepted as a demonstrated bypass.

P22 must preserve selected-source provenance across human and agent revision ancestry,
including edits at P21 reset boundaries. Budget roots and selection provenance are distinct;
a reset must not discard or substitute the original exact selection binding. Full selected
draft integration, acquisition and actual model-stage acceptance remain separate work.
