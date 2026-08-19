---
name: spin-up
description: How any kb agent starts a run safely and with the right local context
when: always
audience: all
read_only: true
budget_bytes: 4000
---
Run `python scripts/preamble.py` from repo root. If it fails, STOP and emit a wake-me card. Run it before any loop or task.

Read `CLAUDE.md`, `governance/agent-rules.md`, and the target org's `_index.md`, `STATE.md`, and
`contract.md` before work. Execute only a card assigned to your agent id.

Keep work products on the assigned worktree branch. Never push to `main`. Coordination writes (`queue/`, `ledgers/`, `memory/`, `dashboards/`, `orgs/*/STATE.md`) → branch `ops`, `git pull --rebase origin ops` immediately before every write, push immediately after.

A worktree lease ends when its branch merges or its wave ends; the creator removes that worktree.
A merged branch is dead. Every sub-work brief names its explicit files, governing norms, and
acceptance criteria; workers never commit.

Authority: `CLAUDE.md` branch, cards, and navigation rules.
