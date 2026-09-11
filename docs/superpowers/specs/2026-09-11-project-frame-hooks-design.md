# Project frame + hooks — design (2026-09-11)

**Status:** APPROVED 2026-09-11 (Daniel: "Yes proceed"); §2 trimmed to two modes same day. Boss session (Fable 5.1).
**Goal:** every kb CLI session (boss, worker, subagent) starts and stays grounded in the active
project's GOAL state and CURRENT state without re-reading the whole repo, and without being
overloaded on every turn. Success = a fresh session on a project branch receives the frame at
startup, a subagent inherits the governing sections, every dispatch's model is audited, and stale
handoffs are flagged — all verified by tests plus one live run.

## 1. The three surfaces (per project, on ops)

| File | Job | Written by | Changes |
| --- | --- | --- | --- |
| `orgs/<p>/GOAL.md` | goal state: what done looks like | boss at plan approval | only on a ruling |
| `orgs/<p>/STATE.md` | current state, kept current (≤ 60 lines) | boss/worker at every gate | every session |
| `handoffs/<date>-<scope>-<topic>.md` | coordination: how to resume mid-flight | session close | deleted on pickup |

`_index.md` and `contract.md` are unchanged. Both new/kept files are coordination writes
(CLAUDE.md branch rules → ops); hooks read them from `origin/ops` so the checkout branch is
irrelevant.

### GOAL.md — required sections (headings exact, prefix-matched)
```
# <project> — GOAL
_Ruled: YYYY-MM-DD_
## North star        (2–5 lines: end functionality, who it serves)
## Success conditions (per phase: testable/visible statements; mark PASSED/OPEN)
## Invariants        (never violate; doctrine + hard rules that bit us)
## Governing docs    (spec / plan / contract paths with branch if not on main)
```
Boss-written distillation, ≤ 80 lines. Never a copy of the spec.

### STATE.md — required sections
```
# <project> — STATE
_Updated: YYYY-MM-DD HH:MM_
## Now               (what is true right now: shipped / running / broken)
## Current gate      (the ONE gate the arc sits on + who holds it)
## Next              (ordered, 1–5 items)
## Blocked           (or "None")
## Findings          (session-durable facts learned this arc, ≤ 10 bullets)
## Infra             (ids/paths/ports/store locations a resume needs)
```
Hard cap 60 lines. History goes to git, never appended here. `## Findings` is the answer to "important
information and findings throughout the session" — the boss moves a finding here the moment it
would matter to a fresh session.

## 2. Resolver — `scripts/hooks/lib/project_frame.js` (new)

- `activeProject(event, env)`: `KB_PROJECT` env → else branch of `event.cwd`
  (`git -C cwd branch --show-current`, 2 s timeout) matched as `<agent>/<project>[-…]` against the
  project ids present under `orgs/` on `origin/ops` → else `null` (boss/unknown branches).
- `readOpsFile(cwd, relPath)`: `git -C cwd show origin/ops:<relPath>`; on failure fall back to the
  working-tree file; cap 32 KiB; never throws.
- `frame(project, mode)` → string, two modes with hard char budgets (the `reground` and
  `subagent` payloads are served by U7/U9 straight from the store's governing sections, so no
  separate modes exist for them — ruled 2026-09-11):
  - `full` (SessionStart startup/resume/clear): GOAL all sections + STATE all sections + the
    project's handoff filenames + Load lists + the store's `## Resumed-session summary` when present.
    Budget 7000 chars, sections truncated last-first.
  - `rollup` (no active project): one line per project = `<p>: <first line of ## Now> (updated <date>)`
    plus handoff-sweep flags. 1500 chars.
- Every string opens with the existing stale-replay `GUARD_LINE` from `lib/hook_io.js`.

## 3. Hooks

### New: `scripts/hooks/project_frame_session_start.js` (SessionStart)
1. Runs `python scripts/preamble.py` (10 s timeout) and prepends its verdict line
   (`PREAMBLE OK` / the failure text). Never blocks.
2. Resolves the active project.
3. Writes the U8 context store's reserved governing sections for `event.session_id`:
   `## North star` ← GOAL North star, `## Invariants` ← GOAL Invariants,
   `## Current gate` ← STATE Current gate. This is the missing WRITER: with it, U7 regrounding,
   U8 resume, and U9 subagent load all work unchanged from the store.
4. Emits `full` (or `rollup`) as `additionalContext` unless `event.source == "compact"`, where it
   emits nothing (U7 owns the compact re-injection; avoids a double payload).
5. Appends the handoff sweep's flag lines (see §4) to the payload when non-empty.

### One edit to U7 `regrounding_hook.js`
Default source, when `KB_GOAL_STATE_PATH` is unset, becomes the session's store file
(`store.sessionPath(event.session_id)`) instead of the dead August plan. `WANTED_SECTIONS`
gains `"Current gate"`. Nothing else changes; the throttle ruling (25 calls / 30 min) stands.

### Armed as-is (no code change)
- U8 `context_lifecycle_pre_compact.js` (PreCompact), `context_lifecycle_activity_tracker.js`
  (PostToolUse). `context_lifecycle_session_start.js` is NOT armed — the new SessionStart hook
  covers resume by reading the same store's `## Resumed-session summary` in `full` mode.
- U9 `subagent_context_load.js` (SubagentStart), `model_verify_pretooluse.js`
  (PreToolUse matcher `Agent|Task`), `model_verify_subagentstop.js` (SubagentStop). Report-only
  stays; refusing a missing `model` is out of scope (revisit after a week of audit rows).

### Stop hook (`delivery_gate.js`) — one added warning
If an active project resolves and its STATE.md `_Updated:` is older than 3 days, warn
"STATE.md stale — update before closing". Warn-only, as today.

### Removed from boss sessions
The cco plugin's `prompt-coach` UserPromptSubmit hook: grades every boss prompt "D, name the file".
Disable via the plugin's own config or `disabledHooks`, whichever the plugin supports; never by
editing `~/.claude/settings.json` (keep-awake is load-bearing).

### Settings change (`.claude/settings.json`, project scope, MERGE not replace)
Add `SessionStart`, `PreCompact`, `PostToolUse` (regrounding + activity tracker),
`UserPromptSubmit` (regrounding), `SubagentStart`, `SubagentStop`; append the `Agent|Task` entry to
the existing `PreToolUse` array. Absolute paths like every existing entry. All new entries are
synchronous (file/git-local I/O with caps); SessionStart end-to-end must stay < 3 s on this machine
(test asserts < 5 s with a warm git).

## 4. Handoff sweep — `scripts/handoffs_sweep.py` (new)
Reads `handoffs/*.md` on `origin/ops` (and the checkout, deduped). Flags a handoff when any of:
older than 14 days; a newer handoff exists for the same `<scope>`; any path in its `## Load` list no
longer exists on origin/ops or origin/main. Output: table (default), `--json` (hook), `--delete`
prints the `git rm` lines for a boss to run on ops (never deletes itself). Rule added to
`handoffs/README.md`: a flagged handoff is deleted at the next boss session close.

## 5. Lint — `scripts/project_frame_lint.py` (new)
Checks every `orgs/*/GOAL.md` and `STATE.md`: required headings present, STATE ≤ 60 lines,
`_Updated:`/`_Ruled:` parse. Run by tests and by hand; not a pre-commit hook (ops writes bypass
this checkout's hooks anyway).

## 6. Content (boss work, on ops, after the code lands)
Initial GOAL.md + STATE.md for: `prospecting`, `figment`, `kb-ops` (dashboard/platform arc),
`faceless-youtube` (marked PARKED). `atlas-prep`/`atlas` id split is noted, not fixed. First handoff sweep
run by hand; flagged handoffs deleted on ops.

## 7. Tests (pytest, node hooks via subprocess, same pattern as `tests/test_regrounding_hook.py`)
- `test_project_frame.py`: branch→project mapping (agent/project-suffix, boss branch → null,
  `KB_PROJECT` override), ops-read fallback, each mode's budget, GUARD_LINE first.
- `test_project_frame_session_start.py`: full payload on startup, nothing on compact, store
  sections written, preamble failure line surfaces, every unhappy path → `{}` exit 0.
- `test_regrounding_hook.py`: default source = session store (one new test), existing tests keep
  passing with `KB_GOAL_STATE_PATH` set.
- `test_handoffs_sweep.py`, `test_project_frame_lint.py`.
- `test_context_lifecycle_inert.py` and the U9 inert test flip to assert the hooks ARE registered at
  the committed paths (arm-time Check 3 from the proposals becomes permanent).
- Live check: start a session in `kb-worktrees/prospecting-p8`, confirm the frame arrives; dispatch
  one haiku subagent, confirm the model-audit row and inherited context.

## 8. Out of scope
Cross-agent context sharing beyond the store; any hook that shells out to a model; blocking
dispatches; editing CLAUDE.md/governance (a proposed CLAUDE.md diff is delivered for Daniel to apply:
"Navigation: read GOAL.md and STATE.md" and "Memory: findings go to STATE.md `## Findings`").
