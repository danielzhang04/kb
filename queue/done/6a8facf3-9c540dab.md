---
schema-version: 1
id: 6a8facf3-9c540dab
project: kb-ops
action: atlas-x3-fix
target: C:\Users\danie\Atlas-worktrees\x3
risk-tier: T1
owner: codex-worker
claim-token: 2c56b6f59a0ba275
state: done
approval: null
workflow: 01a04131-279a-74b2-bbd4-1214ed7bffe3
depends-on: []
variant-group: null
role: work
session-id: 6a8faa3d-0e51b6a1
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: ca365d0053d182ebb607431c35a90e2133eaca41
---

## Work order

\# Atlas X3b fix round (boss rulings)

cwd = C:\Users\danie\Atlas-worktrees\x3 (uncommitted X3b tree). NOT a kb project: ignore every kb
preamble/spin-up/card/ops instruction (no scripts/preamble.py - do NOT stop for it). You never commit. Never
launch the app. ASCII only. Tests: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q
--basetemp=.pytest-tmp -p no:cacheprovider`. Baseline: 484 passed. Adversarial review rulings (TDD):

1. BLOCKER (ruling: authorized governance amendment, NOT a design change) - amend CLAUDE.md rule 6 to:
   "MCP child environments are never logged and never the host's full environment. `from_claude_config`
   servers take exactly their named entry from ~/.claude.json; `command:` servers take a fixed argv from
   config plus ONLY the non-secret flags named in `env_from` (resolved from atlas.yaml) and a minimal
   PATH/SystemRoot. Secrets never travel in env for command servers; the kb session token travels only over
   the private notification channel." Keep `tests/test_mcp_client.py` env-isolation test; add an assertion
   that no value from `os.environ` other than PATH/SystemRoot reaches the child.
2. HIGH - lost-wakeup race (`worker/mcp_client.py` ~343/354/395): publish the session under the client's
   lock BEFORE the initial notification and recheck the session generation after `list_tools()`; a
   `set_session()` landing during initialize must still produce exactly one notification. Test with a fake
   transport that delays `list_tools`.
3. HIGH (ruling: bridge-side enforcement) - T3 kinds are refused inside the kb bridge (`kb_human_respond`
   returns typed `t3_requires_dashboard`). Host change ONLY: map that typed error to bounded text "that needs
   the dashboard - T3 is never done by voice", and move the brain/description sentence into CLAUDE.md rule
   12's kb paragraph as a statement of WHERE it is enforced. Test the mapping.
4. MEDIUM - reject sessions whose expiresAt <= now + 30 s skew at `set_session` (typed error, unlock window
   reports failure, nothing retained); schedule in-memory erasure at expiry (health flips to `expired`, then
   `none` once erased). Tests with a fake clock.
5. MEDIUM - unlock window: validate the verify response shape (`{token: str, expiresAt: str|int}`) else
   signal terminal failure immediately; wire the window `closed` event to the cancellation event so manual
   close returns "unlock cancelled" at once, not after 60 s. Tests.
6. MEDIUM - `session_required` -> "kb is locked" mapping applies ONLY to the server with
   `session_channel: true`; other servers' errors keep the generic bounded mapping. Test with a google fake.
7. MEDIUM - command config fails closed: `command` must be a non-empty list of strings (no scalar, no shell
   line), `enabled_from` must resolve to a bool, otherwise the entry is rejected at config load (bounded
   error, never spawned). Tests: scalar command, missing enabled_from, non-bool.
8. LOW - normalize all 10 touched files to CRLF (`git ls-files --eol` shows w/crlf; no content changes).

READ BUDGET: `git diff --stat`, `worker/mcp_client.py` by ranges (`grep -n "def set_session\|_notify_held\|list_tools\|session_required\|def _load\|command"`),
`worker/desktop.py` unlock ranges (`grep -n "kb_session\|_forward_kb\|closed\|evaluate_js"`), CLAUDE.md,
test files by ranges. Stop at 50 minutes. Exit: focused (`tests/test_mcp_client.py tests/test_desktop.py
tests/test_stateserver.py tests/test_tools.py`), full suite (>= 484), `git diff --check`, `node --check
ui/app.js`, `git ls-files --eol` on touched files. Final message: per-item changes + red-on-revert for 2, 4,
5, 7. Do not commit.

## Result

Implemented all eight X3b rulings without committing or launching the app.

1. Amended [CLAUDE.md](C:/Users/danie/Atlas-worktrees/x3/CLAUDE.md:16) rules 6 and 12 for environment isolation and bridge-side T3 enforcement.
2. Fixed session lost-wakeup race using locked publication, generations, and post-`list_tools()` recheck.
3. Added bounded `t3_requires_dashboard` mapping and removed T3 enforcement claims from tool descriptions.
4. Added 30-second expiry skew rejection, typed errors, and scheduled token erasure.
5. Added verify-response shape validation, terminal failure reporting, and immediate manual-close cancellation.
6. Scoped `session_required` mapping to `session_channel` servers only.
7. Made command configuration fail closed for scalar/empty argv, missing `enabled_from`, and non-boolean values. Updated the runtime fixture accordingly.
8. All 12 modified tracked files report `w/crlf`.

Red-on-revert coverage:

- Item 2: delayed `list_tools()` race verifies exactly one notification.
- Item 4: fake-clock tests verify skew rejection, no retention, expired state, and erasure.
- Item 5: tests verify invalid response/forwarding failure and immediate window-close cancellation.
- Item 7: tests reject scalar commands, missing `enabled_from`, and non-boolean resolution.

Verification:

- Focused: 162 passed.
- Full suite: 492 passed, exceeding the 484 baseline.
- `git diff --check`: passed.
- `node --check ui/app.js`: passed.
- One existing third-party Pydantic warning remains.
- No commit created; app not launched.
