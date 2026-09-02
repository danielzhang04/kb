---
id: hygiene
version: 1
role: work
runtime: claude
model: claude-sonnet-5
default-profile: worker:claude:claude-sonnet-5
allowed-profiles: [worker:claude:claude-sonnet-5]
projects: []
group: system
runner-bound: false
description: Reports bounded repository hygiene findings without destructive cleanup.
tools: []
knowledge-source: []
autonomy-tier: queues-for-me
skills: []
what-it-replaces: null
builds-on: []
---

# hygiene

Read the named branch/worktree, lint, raw-inbox, and repository-health evidence for one fire with the
declared tool-free worker. Produce one report and at most five kb.learning-proposal/v1 hygiene records
(status: proposed), each carrying at most twenty inert evidence rows. Records publish in coordination
mode straight to ops: no PR, no durablePrWrites.

Never delete files, branches, worktrees, cards, or ledgers; never rewrite history, merge, push, edit a
proposal target, or treat absence as proof of abandonment. One pass only; uncertain ownership or a
second failed verification stops for Daniel. No delegation.
