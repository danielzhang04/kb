---
name: dispatch-codex
description: Delegate a task from this Claude terminal to a background OpenAI Codex worker on a chosen model — Agent-tool feel through kb. Use for "hand this to codex", "codex subagent", "second implementation opinion at scale", or parallel grunt work on the codex side. The result returns as a task notification; a card + cost row lands on ops automatically. Do NOT use for quick sub-2-minute asks (use the codex MCP tool inline) or for Claude-runtime subagents (Agent tool).
---

# dispatch-codex

Spawn a codex worker like an Agent-tool subagent: dispatch, keep working, the
result arrives as a task notification.

## Convention

1. Write the brief to a scratchpad file (UTF-8). Same standard as an Agent-tool
   prompt: name the exact files/functions in scope, the norms to follow, what
   NOT to touch, acceptance criteria. The worker starts cold — the brief is all
   it knows.
2. Dispatch via Bash with `run_in_background: true` — NEVER foreground:

   ```
   py -3 scripts/codex_dispatch.py --prompt-file <brief.md> --model <tier> [--effort xhigh] [--cwd <dir>] [--sandbox read-only] [--worktree]
   ```

3. Keep working. The completion notification carries the worker's final message
   plus a footer (card id, model, duration, ops-publish status, log path).
4. Harvest: read the result, review any diffs yourself, commit yourself. The
   worker NEVER commits. If you passed `--worktree`, the footer names the
   worktree — harvest from it and `git worktree remove` it (leases, not
   real estate).

## Models

- `codex-cheap` (gpt-5.6-luna) — mechanical/bulk work
- `codex` (gpt-5.6-terra, default) — standard build/review work
- `codex-deep` (gpt-5.6-sol) — hard design/debugging; add `--effort xhigh` for the hardest
- Any concrete id in `governance/model-routing.yaml` `runtimes.codex.known_models`
  also works; unknown names refuse loudly before spawning.

## Rules

- Parallel dispatches are fine — each is its own process, card, and notification.
- Default cwd is the repo root with `workspace-write`; pass `--sandbox read-only`
  for pure research, `--worktree` when the task writes broadly or another writer
  shares the tree.
- The dispatch refuses on: STOP file, daily budget breach, `OPENAI_API_KEY`/
  `CODEX_API_KEY` in env, stale codex login, unknown model. Fix the cause; never
  work around a refusal.
- If the footer says ops publish FAILED, the card is spooled under
  `%LOCALAPPDATA%\kb-codex-dispatch\spool\` — surface that to the human.
