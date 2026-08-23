---
schema-version: 1
id: 6a8ab6a3-bf9bd9da
project: atlas-prep
action: atlas-wave3-fix-b
target: C:\Users\danie\Atlas-worktrees\fb3
risk-tier: T1
owner: codex-worker
claim-token: 36558cbdd95c10fd
state: done
approval: null
workflow: 01a02dbc-5253-7c01-b6c3-e246828f2ce2
depends-on: []
variant-group: null
role: work
session-id: 6a8aaf20-9c48a5f0
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Atlas wave 3 — review fixes B (audio follow robustness, restart vs background jobs, files)

You are a Codex worker on the standalone Atlas application. Working directory:
`C:\Users\danie\Atlas-worktrees\fb3` (branch `claude/atlas-wave3-fix-b`, from a08e111). Work ONLY there. You own
`worker/devicewatch.py`, `worker/wakeword.py`, `worker/app.py`, `worker/desktop.py`, `worker/jobobject.py`,
`worker/claude_launcher.py`, `worker/work.py`, `worker/localfiles.py` and their tests. Worker A owns
`brain/tools/runtime/state/stateserver/ui` in parallel — do not touch those. Read `CLAUDE.md`,
`docs/specs/2026-08-23-atlas-wave3-design.md` §2, then the files. Behaviour-named tests for every item; never a
real device, window, process or job object in tests.

1. **Watch both directions always (app.py, devicewatch.py).** If the initial COM probe for input or output
   returns None, keep polling that direction and treat its first later endpoint as a reopen event.
2. **Reopen failures are not silent (wakeword.py, devicewatch.py, app.py).** The wake thread retries a failed
   open/read up to 3 times with backoff (0.5/1/2 s), then calls an injected `on_failure(reason)` that updates
   `/state.audio` (`following: false`, `error: <code>`) and requests restart (exit 21); the `InputFollower`
   reports reopen failures through the same callback.
3. **Capability-test LiveKit capture (devicewatch.py).** Before declaring input follow successful, open the
   endpoint with sounddevice at LiveKit's fixed rate (read it from the installed console code, do not hard-code
   24 kHz blindly) for one short block; on failure keep the wake stream on the new device at native rate, leave
   LiveKit on the previous device, and publish `audio.input.following: false, reason: "rate unsupported"` instead
   of entering the restart path.
4. **Coalesce audio flaps (desktop.py, app.py).** Device-change events within 2 s collapse into one; a second
   restart request inside the 30 s window is deferred until the window elapses (not turned into the stopped
   page); only three restarts within 10 minutes become the stopped page.
5. **Restart must not kill background jobs (jobobject.py, claude_launcher.py, work.py, desktop.py, app.py).**
   The kill-on-close Job Object is for MCP/helper children only: create it with
   `JOB_OBJECT_LIMIT_BREAKAWAY_OK` and launch `claude --bg` with `creationflags=CREATE_BREAKAWAY_FROM_JOB`
   so background Claude sessions survive an audio restart; the replacement worker re-attaches by session id
   (already supported). On a deliberate window close, `/shutdown` still cancels jobs explicitly (unchanged).
   Exit 21 path: flush the job store, stop the state server, then exit — no `os._exit` while a poll write is in
   flight.
6. **OneDrive placeholders + off-loop reads (localfiles.py).** Reparse points whose tag is a cloud-files tag
   (`IO_REPARSE_TAG_CLOUD*` family, 0x9000xxxx) are allowed (they are the user's own files); other reparse points
   stay refused. `read_file` and `open_file` run in `asyncio.to_thread` with a 5 s deadline so a hydration stall
   cannot block the loop; on timeout return `error: file not available yet (cloud placeholder)`.
7. **`hey_jarvis` fallback (wakeword.py).** If the configured model fails to load, try the bundled/downloadable
   `hey_jarvis` model once, publish `wake_model: "hey_jarvis (fallback)"` through the existing state hook, and
   keep listening; if that fails too, call `on_failure("wake model unavailable")`.
Norms: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp .pytest-tmp`
(full suite; delete `.pytest-tmp`); `git diff --check`; one statement per line; no dead information; no commits;
no git stash/reset/checkout. Report files, suite summary, checks, and the LiveKit capture rate you found.

## Result

FAILED: orphaned — dispatch parent died before completion (model gpt-5.6-sol, started 2026-08-23T08:28:20Z, log C:\Users\danie\AppData\Local\kb-codex-dispatch\logs\6a8aaf20-9c48a5f0.jsonl)

Last log lines:

{"type":"item.started","item":{"id":"item_38","type":"file_change","changes":[{"path":"C:\\Users\\danie\\Atlas-worktrees\\fb3\\tests\\test_devicewatch.py","kind":"update"}],"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_38","type":"file_change","changes":[{"path":"C:\\Users\\danie\\Atlas-worktrees\\fb3\\tests\\test_devicewatch.py","kind":"update"}],"status":"completed"}}
{"type":"item.started","item":{"id":"item_39","type":"file_change","changes":[{"path":"C:\\Users\\danie\\Atlas-worktrees\\fb3\\tests\\test_devicewatch.py","kind":"update"}],"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_39","type":"file_change","changes":[{"path":"C:\\Users\\danie\\Atlas-worktrees\\fb3\\tests\\test_devicewatch.py","kind":"update"}],"status":"completed"}}
{"type":"item.started","item":{"id":"item_40","type":"file_change","changes":[{"path":"C:\\Users\\danie\\Atlas-worktrees\\fb3\\tests\\test_wakeword.py","kind":"update"}],"status":"in_progress"}}
