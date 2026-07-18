# codex-worker memory

## 2026-07-18 — dashboard execution control

- Separate dashboard code, canonical ops coordination, durable Composer saves, and worker execution into distinct worktrees; sharing an ops checkout with durable saves can leak work-product commits into ops.
- Immediate runner pickup is safe only as a closed owner-to-scheduled-task signal after the queue commit; it is not a terminal session or a workflow engine.
- Codex result branches remain behind the binding human/cloud merge gate. The compliant continuation UX is review/merge externally, prove the pinned SHA landed, then passkey-release dependents and trigger the next owner.
- Runner result commits must append the cost row before exact-path staging, and non-zero model exits must halt rather than mark done.
- Full dashboard verification: typecheck, 131 Vitest files (972 passed, 1 skipped), production build, PowerShell parse, and 15 runner shape assertions.
