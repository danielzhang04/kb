# Build brief — Variant D, Task 1 (doctrine build + fragment lint + tests)

You are executing ONE task of a written plan, exactly as written. No sub-agents, no synthesis skill. Budget 55 minutes; work in plan order; after each step run its stated check. Do NOT commit (the boss commits after review). Do NOT touch git state (no checkout/stash/reset/branch).

Repo clone: `C:/Users/danie/kb-clones/bricks-arc`, branch `claude/bricks-variant-vd`. Plan: `orgs/faceless-youtube/doctrine-recon/variant-d-plan.md` — execute **Task 1 only** (steps 1–27). Spec for intent: `variant-d-spec.md` rev 4 (read §2–§3 once; the plan is the instruction).

Binding rules (owner): every textual change is a replacement at the cited home, preceded by the plan's pre-edit byte assertion — if an OLD block is not found byte-for-byte, STOP on that step, record the actual text at that location in your report, and continue with the next independent step (never improvise a different edit). Delete superseded wording; no dead text; no new section headers beyond the sanctioned bible `## 2d. CROWD-RIG clause` move (+ suffix renumber); no quotas, bans, lexical gates; keep files slim; UTF-8, no mojibake (never write `Â`, `â€”`, `Ã` sequences — write real `—`, `≤`, `§`).

Test commands: `py -3 -m pytest -q` inside `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts` and `.../image-generation/scripts` (vb baseline 101 + 166 = 267). If the default temp dir is inaccessible, use `--basetemp` inside the worktree as vb's notes did. Run the plan's zero-sweep `rg` command at the end and `git diff --check`.

Write a running log to `orgs/faceless-youtube/doctrine-recon/variant-d-task1-log.md` (append per step: step id, done/blocked, check output summary). Final message ≤12 lines: steps done/blocked, test counts before/after, zero-sweep result, `git diff --stat` summary, anything the reviewer must look at first.
