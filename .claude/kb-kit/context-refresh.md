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

Authority: `CLAUDE.md` memory and navigation rules.
