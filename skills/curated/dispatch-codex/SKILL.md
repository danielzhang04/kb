---
name: dispatch-codex
description: Delegate a task from this Claude terminal to a background OpenAI Codex worker on a chosen model — Agent-tool feel through kb. Use for "hand this to codex", "codex subagent", "second implementation opinion at scale", or parallel grunt work on the codex side. The result returns as a task notification; a card + cost row lands on ops automatically. Do NOT use for quick sub-2-minute asks (use the codex MCP tool inline) or for Claude-runtime subagents (Agent tool).
---

# dispatch-codex

Spawn a codex worker like an Agent-tool subagent: dispatch, keep working, the result arrives as a task notification.

## Convention

1. Write the brief to a scratchpad file (UTF-8). Same standard as an Agent-tool
   prompt: name the exact files/functions in scope, the norms to follow, what
   NOT to touch, acceptance criteria. The worker starts cold — the brief is all
   it knows.
2. Dispatch via Bash with `run_in_background: true` — NEVER foreground, using the
   absolute script path (an FYT-rooted terminal breaks on a relative one):

   ```
   py -3 "$(git rev-parse --show-toplevel)/scripts/codex_dispatch.py" --prompt-file <brief.md> --model <tier> [--effort xhigh] [--timeout <seconds>] [--cwd <dir>] [--sandbox read-only] [--worktree]
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

## Iterating with your worker

Each footer names the worker's session id — the SendMessage equivalent, worker context intact:

```
py -3 "$(git rev-parse --show-toplevel)/scripts/codex_dispatch.py" --prompt-file <followup.md> --follow-up <thread-id> --model <tier>
```

Repeat the footer's `--model <tier>` — a follow-up does NOT keep the session's own model, the
script re-pins it every turn; omit it and a `codex-deep` session silently drops back to the
`codex` default tier (terra), not its own model. `--sandbox`/`--cwd`/`--worktree` are refused on a
follow-up; follow up before you sweep a `--worktree` (a follow-up into a removed one resumes into
a deleted dir). Each turn writes its own card, linked by the shared `workflow: <thread-id>` field.
To stop a worker: stopping the background shell task orphans the codex child (no job object) —
find the python parent's pid and `taskkill /PID <pid> /T /F` (the `/T` kills the tree). Either way
the spool trace under `%LOCALAPPDATA%\kb-codex-dispatch\spool\` is the only record; no card is
published.

## Rules

- Parallel dispatches are fine — each is its own process, card, and notification.
- Default cwd is the repo root with `workspace-write` (writes anywhere under `--cwd`, incl.
  `governance/` — scope it down for untrusted briefs); `--sandbox read-only` for research (no
  network — web-research briefs degrade silently, don't dispatch); `--worktree` when the task
  writes broadly or another writer shares the tree.
- Refuses on: STOP file, `ANTHROPIC_API_KEY` set (preamble gate), `OPENAI_API_KEY`/`CODEX_API_KEY`
  in env, stale codex login, unknown model. Fix the cause; never work around a refusal.
- Failed runs still land as a `done` card, Result starting `FAILED: ...` (footer names the
  JSONL log); default timeout 2700s (45 min), `--timeout <seconds>` to change — a timeout kills
  the worker and records the same shape.
- Ops publish FAILED in the footer means the card is spooled under
  `%LOCALAPPDATA%\kb-codex-dispatch\spool\` — surface that to the human.
- The MCP lane (`codex` server in `.mcp.json`, billing-guarded the same way) writes no card —
  throwaway inline asks only.
