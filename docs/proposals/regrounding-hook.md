# Proposal: re-grounding hook (for Daniel to arm, if ever)

**Status:** PROPOSAL — inert, NOT wired into any live settings file.
**Rework ruling (Daniel, 2026-08-19):** The implemented design below uses post-compact
injection plus a per-session trigger-and-throttle state file; it does not cause compaction.
**Built:** 2026-08-18; reworked 2026-08-19, Agent Platform U7. Code:
`scripts/hooks/regrounding_hook.js`. Tests: `tests/test_regrounding_hook.py`.
Nothing in `.claude/settings.json`, `.claude/settings.local.json`, or `governance/**`
was touched.

## Implemented design

The hook reads its event JSON from stdin. It handles only these events:

- `SessionStart` with `source: "compact"` always injects. A compaction has discarded
  context, so this is the unthrottled re-grounding point; it also resets that session's
  tool-call counter and injection time.
- `PostToolUse` increments the session's tool-call counter, then injects if the counter
  reaches the configured limit or the configured elapsed-time limit has passed.
- `UserPromptSubmit` uses the same throttle without incrementing the counter.
- Any other event, including a non-compact `SessionStart`, emits `{}`.

The defaults are 25 tool calls (`KB_REGROUND_EVERY_CALLS`) or 30 minutes
(`KB_REGROUND_EVERY_MINUTES`). Both overrides accept positive whole numbers. This is a
re-grounding hook only: Claude Code's fullness-triggered auto-compaction remains the
only compaction mechanism.

Throttle state is stored at `DASHBOARD_STATE_ROOT/regrounding/state.json` when the daemon state
root exists, otherwise `%LOCALAPPDATA%/kb-regrounding/state.json`; tests and operators may override
its directory with `KB_REGROUND_STATE_DIR`. The versioned state
has a `sessions` map keyed only by a nonempty `session_id`. An event without an id is
deliberately stateless: it injects without throttling and does not read, lock, or write
the state directory. Injection is idempotent-safe; sharing mutable state between
otherwise unrelated incomplete payloads is not.

Missing or corrupt state means “never injected”, so the hook injects and best-effort
initializes a fresh record. Unreadable or unwritable state has the same fail-open,
silent behavior: output is still `{}` or an injection, exit is always 0, and stderr is
empty. A nonblocking exclusive-create `state.lock` serializes state reads and updates;
an observed lock older than one minute is treated as abandoned and recovered. On lock
contention or any lock error, the hook injects but makes no state update. Writes use a
temp file followed by rename so a completed update is atomic. A future
`lastInjectionMs` is corrupt (for example, after a clock rollback), so it too is
treated as never injected and reset by an injection.

The injection payload is unchanged: the hook deterministically extracts the `## North
star` and `## Invariants` sections from `KB_GOAL_STATE_PATH` (or the Wave 1 default),
whitespace-collapses them in that order, and prefixes the single-sourced `GUARD_LINE`
from `scripts/hooks/lib/hook_io.js`. State, time, session IDs, and counters never enter
the payload, so identical source bytes produce byte-identical injection output.

Missing/unreadable source, malformed stdin, missing sections, unknown events, and every
escaped exception all produce `{}` with exit 0 and empty stderr.

## Why

An unsupervised run can have one kickoff prompt followed by hours of tool calls, while
an interactive run can have frequent prompts. Post-tool counting covers the first case;
the per-session throttle avoids excessive reinjection in the second. Compaction is the moment
context is actually lost, so its `SessionStart` must always re-ground.

## How to arm

1. **Precondition — arm only after this branch merges to `main`.** The hook and its
   goal-state source must exist at the registered absolute path before any settings edit.
2. **Arming inverts the inert guards — retarget them in the same human settings edit.**
   `tests/test_context_lifecycle_inert.py::test_no_hook_is_registered_in_any_settings_file`,
   `tests/test_context_lifecycle_inert.py::test_no_live_settings_were_touched`, and
   `tests/test_model_verify.py::test_the_u9_hook_family_is_inert` currently prove that
   `.claude/**` was untouched. Change those assertions to allow exactly these three
   registrations at the committed path, while retaining their protection for every other
   hook and settings change.
3. As a human edit, add these three entries to the `hooks` object in
   `.claude/settings.json`. The absolute path is load-bearing because hook cwd is not
   stable.

```json
"SessionStart": [
  {
    "matcher": "compact",
    "hooks": [
      {
        "type": "command",
        "command": "node \"C:/Users/danie/kb/scripts/hooks/regrounding_hook.js\""
      }
    ]
  }
]
```

```json
"UserPromptSubmit": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"C:/Users/danie/kb/scripts/hooks/regrounding_hook.js\""
      }
    ]
  }
]
```

```json
"PostToolUse": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"C:/Users/danie/kb/scripts/hooks/regrounding_hook.js\""
      }
    ]
  }
]
```

4. Restart Claude Code; hooks load at session start. Then verify a compact, a prompt,
   and a tool call all leave the session usable. The hook is additive and never blocks.

## How to disarm

1. Delete all three registration keys from `.claude/settings.json`.
2. Restart Claude Code.

The state file is only a throttle cache; it may be left in place or deleted. Remove the
settings entries before deleting the hook file, otherwise each configured event would
invoke a missing `node` module.

## Verification

```text
py -3 -m pytest tests/test_regrounding_hook.py tests/test_context_lifecycle_inert.py -q
py -3 -m pytest tests/test_model_verify.py::test_the_u9_hook_family_is_inert -q
```

The hook suite has nineteen behaviors: valid extraction, deterministic payload, missing
source, cap, malformed stdin, unknown-event no-op, compact reset, Nth post-tool
injection, prompt-window skip, elapsed-time injection, corrupt-state fail-open,
unwritable-state silence, stateless missing-session injection, exact time-window
boundaries, backward-clock recovery, payload equality across event metadata and throttle
paths, stale-lock recovery, and two-process lock contention.
