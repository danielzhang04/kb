---
schema-version: 1
id: 6a8a0ec0-d0e6d9cc
project: atlas-prep
action: atlas-revamp-frame-fix
target: C:\Users\danie\Atlas-worktrees\revamp
risk-tier: T1
owner: codex-worker
claim-token: 89fcc169200e5e4b
state: done
approval: null
workflow: 01a02b46-8755-7630-a99f-45c4b19f2f63
depends-on: []
variant-group: null
role: work
session-id: 6a8a0df1-a245239e
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Atlas revamp — result-frame backslash fix (claude_launcher.py)

You are a Codex worker on the standalone Atlas application. Working directory:
`C:\Users\danie\Atlas-worktrees\revamp` (branch `claude/atlas-revamp`, HEAD 41b9cbd). Work ONLY there. Touch only
`worker/claude_launcher.py` and `tests/test_claude_launcher.py`. Read `CLAUDE.md` first.

Live evidence (session d454ec83): the real frame Claude printed was
`ATLAS_RESULT_V1:<nonce>:{"job_id":"52dbb226-…","status":"succeeded","summary":"Wrote a 3-line haiku …","error_code":null,"artifacts":["C:\Users\danie\AppData\Local\Atlas\jobs\52dbb226-…\haiku.txt"]}`
— the Windows path carries single backslashes, so `json.JSONDecoder().raw_decode` raises
`Invalid \escape` and `parse_result` returns None → the job is marked `result_missing` although it succeeded.

Fix, in this order:
1. Shrink the frame contract. `worker_prompt` must ask for exactly
   `ATLAS_RESULT_V1:<nonce>:{"job_id":"<job_id>","status":"succeeded|failed|cancelled","summary":"one factual sentence"}`
   — no `error_code`, no `artifacts`, no paths. The host uses only `job_id`, `status`, `summary`.
2. Make decoding tolerant anyway: before `raw_decode`, replace every backslash that does not start a valid
   JSON escape (`\\(?!["\\/bfnrtu])`) with a doubled backslash. Keep the existing wrapped-line join and
   whitespace collapse. Ignore any extra keys a frame still carries.
3. Tests: the exact live frame above (wrapped across two lines, with the raw-backslash path) decodes to
   `("succeeded", "Wrote a 3-line haiku …")`; the new minimal frame decodes; the template echo (status
   `succeeded|failed|cancelled`) is still excluded; `worker_prompt` output contains no `artifacts` and no
   doubled `}}`.
Norms: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp .pytest-tmp tests/test_claude_launcher.py tests/test_work.py`
then the full suite; delete `.pytest-tmp`; one statement per line; no dead information; no commits; no git
stash/reset/checkout. Report: test summary lines, `git diff --check`.

## Result

Implemented the result-frame fix in the two requested files.

- Prompt now requests only `job_id`, `status`, and a one-sentence `summary`.
- Parser repairs invalid raw backslashes before JSON decoding and still ignores extra keys.
- Tests cover the wrapped live raw-path frame, minimal frame, template echo rejection, and prompt contract.

Validation:

- `45 passed in 1.54s` — specified focused tests
- `203 passed, 1 warning in 6.93s` — full suite
- `git diff --check` passed (only CRLF conversion warnings)

Note: `.pytest-tmp/` remains untracked because the environment safety policy blocked its recursive removal.
