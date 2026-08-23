---
schema-version: 1
id: 6a8a9cef-e0d6df92
project: atlas-prep
action: atlas-wave3-v4b-confirm
target: C:\Users\danie\Atlas-worktrees\v4b
risk-tier: T1
owner: codex-worker
claim-token: 8f4d8501ca01a07b
state: done
approval: null
workflow: 01a02d6a-d45c-7551-9949-f2b8325ec60a
depends-on: []
variant-group: null
role: work
session-id: 6a8a9a48-095babeb
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Atlas wave 3 — Task V4b brief (host-owned confirmation turn)

You are a Codex worker on the standalone Atlas application. Working directory:
`C:\Users\danie\Atlas-worktrees\v4b` (branch `claude/atlas-wave3-v4b`). Work ONLY there. Touch only
`worker/brain.py`, `worker/tools.py`, `worker/router.py` (reuse `normalize`), `tests/test_brain.py`,
`tests/test_tools.py`. Read `CLAUDE.md`, `docs/specs/2026-08-22-atlas-revamp-design.md` §2 (authority model),
then the modules and tests.

Live evidence (model `claude-haiku-4-5`, after V4a): turn 1 "draft an email…" → `needs_confirmation` with the
new explicit instruction; turn 2 "yes, go ahead and create the draft" → the model re-called
`google__draft_gmail_message` with slightly different arguments (dropped `"to":"me"`), so the same-args guard
did not fire, a new pending action replaced the old one, and `confirm` was never called. Prompting does not
fix this reliably. Make the host own the confirmation turn:

1. **Host-side confirmation (brain.py).** Before calling the model, if `registry.pending` (add a read-only
   property returning the current `PendingAction | None`, honouring expiry) is set and the normalized
   transcript (`router.normalize`) matches an affirmative — exact phrases or leading-filler-stripped forms
   (`yes`, `yeah`, `yep`, `yup`, `sure`, `ok`, `okay`, `go ahead`, `do it`, `confirm`, `confirmed`, `send it`,
   `create it`, `please do`, `go for it`, plus `yes <anything>` / `confirm <anything>` / `go ahead <anything>`)
   — the Brain executes `registry.confirm(pending.confirm_id)` itself, then runs ONE model call whose messages
   are: history + user transcript + assistant `tool_use` block `confirm(confirm_id)` (client-constructed,
   stable id `toolu_host_confirm`) + user `tool_result` with the real result, `tool_choice={"type":"none"}`,
   so the model only narrates. A negative (`no`, `nope`, `cancel`, `never mind`, `don't`, `stop`, `not now`)
   cancels the pending action the same way via `cancel_pending`. Anything else falls through to the normal
   turn. `on_tool` fires for the host-executed call.
2. **Re-proposal guard by name (tools.py).** While a pending action exists and is unexpired, a confirm-policy
   call to the SAME tool name (any arguments) returns `ToolResult("error", "already pending; Daniel must confirm
   or cancel first")` and leaves the pending action untouched. A different confirm-policy tool still replaces it.
3. Tests: affirmative executes the pending action exactly once and the model request carries the synthetic
   tool_use/tool_result with `tool_choice none`; negative cancels; non-matching utterance proceeds normally;
   expired pending ignored; name-only re-proposal refused; `on_tool` invoked; existing taint/confirm tests stay.
Norms: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp .pytest-tmp`
(full suite; delete `.pytest-tmp`); account-free; one statement per line; no dead information; no commits;
no git stash/reset/checkout. Report files, suite summary, `git diff --check`.

## Result

Implemented host-owned confirmation turns.

- [worker/brain.py](C:/Users/danie/Atlas-worktrees/v4b/worker/brain.py:227): host-side affirmative/cancel handling, synthetic tool results, narration-only model call, and `on_tool`.
- [worker/tools.py](C:/Users/danie/Atlas-worktrees/v4b/worker/tools.py:110): expiring `pending` property and same-tool name reproposal guard.
- [tests/test_brain.py](C:/Users/danie/Atlas-worktrees/v4b/tests/test_brain.py:253): affirmative, negative, fallback, expiry, callback, and request-shape coverage.
- [tests/test_tools.py](C:/Users/danie/Atlas-worktrees/v4b/tests/test_tools.py:74): name-only reproposal coverage.

Validation:

- Full suite: `319 passed, 1 warning in 8.24s`
- Warning: existing Pydantic unresolved-forward-reference warning in `test_mcp_client.py`
- `git diff --check`: clean
- `.pytest-tmp`: deleted
- No commits created; only the four allowed files above were modified.
