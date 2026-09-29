---
name: context-refresh
description: When to re-ground in durable state and discard stale working assumptions
when: always
audience: all
read_only: true
budget_bytes: 2500
---
Re-ground from the task, governing instructions, target files, and current tree after a session
boundary, material task change, failed verification, or uncertainty about scope or authority.

Put durable facts in the least-general file a fresh session loads. On resumption, follow the
handoff Load list; replace plans contradicted by current-tree evidence.

Load the relevant index and authoritative task state first; retrieve large supporting artifacts
only when needed. Batch independent reads. Return findings and artifact pointers instead of
copying raw tool output into the parent conversation. Start focused workers with fresh bounded
briefs: objective, constraints, active decisions, target paths, acceptance checks, and output
budget. Parent task state is background; the worker's own brief defines its assignment.

Before native compaction or a task boundary, checkpoint active decisions, unfinished work,
next steps, blockers, and artifact paths in the existing task/state/handoff files. Verify the
checkpoint, then use the runtime's native compact or fresh-session mechanism. Hooks only
restore bounded context; they do not delete or compact the native transcript. An overflow or
unavailable-source notice requires reading its source before acting on omitted state.

Authority: `CLAUDE.md` memory and navigation rules.
