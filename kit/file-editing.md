---
name: file-editing
description: Make small coherent edits in the subsystem that owns the behavior
when: always
audience: all
read_only: true
budget_bytes: 3000
---
Edit the subsystem that owns the behavior; keep its callers, configuration, documentation,
tests, and visible behavior consistent. Do not create a parallel implementation.

For executable behavior, add or adjust a failing test, make the smallest coherent change, then
verify the test passes. Never delete, weaken, or bypass a test to manufacture a pass. Remove
obsolete material only when it is safe and in scope.

Authority: `docs/proposals/file-editing-guidelines.md`, subject to `CLAUDE.md` and
`governance/agent-rules.md`.
