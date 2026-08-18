# Proposal: context-lifecycle hooks — SessionStart + PreCompact + PostToolUse (for Daniel to arm, if ever)

**Status:** PROPOSAL — inert, NOT wired into any live settings file.
**Built:** 2026-08-18, Agent Platform Wave 1, unit U8. Code:
`scripts/hooks/lib/context_store.js`, `scripts/hooks/context_lifecycle_session_start.js`,
`scripts/hooks/context_lifecycle_pre_compact.js`,
`scripts/hooks/context_lifecycle_activity_tracker.js`.
Tests: `tests/test_context_store.py`, `tests/test_context_lifecycle_session_start.py`,
`tests/test_context_lifecycle_pre_compact.py`, `tests/test_context_lifecycle_activity_tracker.py`,
`tests/test_context_lifecycle_inert.py`. Nothing in `.claude/settings.json`,
`.claude/settings.local.json`, or `governance/**` was touched — `test_no_live_settings_were_touched`
asserts that against git.

## What it does

The three hooks share one markdown file per session — the **context store** — with a fixed section
order:

```
## North star
## Invariants
## Current gate
## Resumed-session summary
## Recent activity
```

- **PreCompact** runs at the moment a compaction is about to throw the recent turns away, and writes
  a deterministic summary of the last N turns into `## Resumed-session summary`.
- **SessionStart** reads that section back the next time it fires for the same session — after a
  compaction (`source: "compact"`) or a resumed session (`source: "resume"`) — and injects it as
  `additionalContext`, behind the stale-replay guard. **This rests on an unverified assumption:**
  that `SessionStart` firing after a compaction carries the SAME `session_id` the `PreCompact` hook
  saw. Unlike U9's two arm-time checks (resolved against the installed harness's own bundled
  strings — see `docs/proposals/spawn-model-verify-hooks.md`), this has not been confirmed the same
  way. If compaction instead assigns a new `session_id`, the store PreCompact wrote is orphaned:
  SessionStart just finds no store under the id it was given and emits `{}`, which is
  indistinguishable from "nothing written yet" — the loop would fail silently rather than
  visibly. See the arm-time check in "How to arm" below.
- **PostToolUse** appends one redacted line per tool call to a 20-entry ring buffer in
  `## Recent activity`.

The first two headings are spelled byte-identically to the sections
`scripts/hooks/regrounding_hook.js` (U7) extracts, so `KB_GOAL_STATE_PATH=<a store file>` re-grounds a
session from live session state with **zero edits to U7**. That seam is a test, not a claim:
`test_regrounding_hook_consumes_a_store_file_with_zero_u7_edits` runs the committed U7 hook against a
store this module wrote.

**The seam is a FORMAT CAPABILITY, not a running feature.** Read the section list again: of the five
headings, only `## Resumed-session summary` (PreCompact) and `## Recent activity` (PostToolUse) have a
writer. **Nothing writes `## North star`, `## Invariants`, or `## Current gate` today** — they are
RESERVED headings, spelled and ordered now so that a future writer (or a human editing a store by
hand) drops straight into the U7 seam without a format migration. Armed exactly as proposed here, a
store contains a summary and an activity buffer, and re-grounding one against U7 would inject nothing.
What this unit proves is that the format works end to end; deciding what should author a north star,
and when, is a separate call.

**Sharing context between agents is out of scope.** These stores are strictly per-session, keyed
only by `session_id` — nothing here matches on working directory, timestamp, or any other signal.
**The correct claim is narrower than "same session" suggests:** re-injection works if and only if
the `session_id` a `SessionStart` payload carries is the same one the preceding `PreCompact` wrote
its store under — a compaction or a resume that keeps the id intact, not a genuinely new session
and not a different agent. Whether the harness actually preserves the id across compaction is the
open question flagged above, not something this proposal asserts. The subagent/fleet sharing
question belongs to U9, not here.

## The change

Add three entries to the `hooks` object in `.claude/settings.json`. They MERGE with what is already
there and with U7's proposed `UserPromptSubmit` entry — `PreToolUse` and `Stop` keep their existing
arrays untouched, and `UserPromptSubmit` (if U7 is armed) is a separate key that coexists:

```json
"SessionStart": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"C:/Users/danie/kb/scripts/hooks/context_lifecycle_session_start.js\""
      }
    ]
  }
],
"PreCompact": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"C:/Users/danie/kb/scripts/hooks/context_lifecycle_pre_compact.js\""
      }
    ]
  }
],
"PostToolUse": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"C:/Users/danie/kb/scripts/hooks/context_lifecycle_activity_tracker.js\""
      }
    ]
  }
]
```

The absolute paths are load-bearing: hooks run with an unpredictable cwd, and every existing kb hook
is registered by absolute path. Do not relativize them.

Arm them **independently if you like** — SessionStart alone is inert-but-harmless (it finds no store
and emits `{}`), PreCompact alone silently builds stores nothing reads, and the activity tracker alone
gives the dashboard panel something to show. The pair that earns its keep is PreCompact + SessionStart.

Emitted shapes:

```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}
```

for SessionStart; a bare `{}` for the other two, whose entire value is the write side effect.

Every unhappy path (no stdin, malformed stdin, missing session id, missing store, missing or
unreadable transcript, unwritable store, any thrown error) emits `{}` with exit 0 and empty stderr —
fail open, silent, same as `delivery_gate.js` and `regrounding_hook.js`.

## Why

- **Compaction is the drop.** A long session's recent working state disappears at compaction and never
  comes back. PreCompact is the last moment it still exists; writing it down there is the only place
  the capture can happen at all.
- **Re-grounding needs a source that changes.** U7 injects a static plan file. A session store is the
  same shape but reflects the session's own state, which is what makes the U7 seam worth having.
- **A redacted activity trail beats an unredacted memory.** The ring buffer is what an operator (and
  the panel) can read without opening a transcript. The redaction table makes it *safer* to read, not
  provably safe — see the denylist decision-note.
- **Zero spend.** See the decision-note below: the summarization is deterministic, not a model call.

## How to arm

1. **Precondition — arm only after this branch merges to `main`.** All four
   `C:/Users/danie/kb/scripts/hooks/context_lifecycle_*.js` files (plus `lib/context_store.js`) must
   exist in the main checkout. Arming while they live only on `claude/agent-platform-w1` means `node`
   "Cannot find module" stderr noise on every session start, compaction, and tool call.
2. **Re-read the redaction table** against the credential shapes actually in use (decision-note
   below). It is a best-effort denylist and the PostToolUse tracker writes on every tool call.
3. Decide the store location (decision-note below) and, if it is not the default, add
   `KB_CONTEXT_STORE_DIR` to the settings `env` block.
4. **Arming inverts the inert-guard tests — retarget them in the same edit.** These
   currently-green assertions exist to prove this family is NOT armed, and go red the moment
   any of it is: `tests/test_context_lifecycle_inert.py::test_no_hook_is_registered_in_any_settings_file`,
   `tests/test_context_lifecycle_inert.py::test_no_live_settings_were_touched`, and
   `tests/test_model_verify.py::test_the_u9_hook_family_is_inert` (U9's inert guard also
   watches `.claude/**` generically, so it trips too). That is correct — they are inert
   guards, not general regression tests — but leaving them red afterward is not: retarget
   each one, in the same edit that changes `.claude/settings.json`, to assert the relevant
   hooks are registered **exactly once, at the committed path**, rather than not registered
   at all.
5. Apply the snippet above to `.claude/settings.json` (human edit — hooks config is Daniel's to change).
6. Restart the Claude Code session. Hooks load at session start; an edited settings file does not take
   effect in an already-running session.
7. Confirm: run a couple of tool calls, then check that
   `%LOCALAPPDATA%\kb-context-lifecycle\<session>.ctx.md` exists and holds a `## Recent activity`
   section. The Context Lifecycle panel in the dashboard's Agent Platform section shows the same thing.
8. **The arm-time check — session-id continuity across compaction** (see the decision-note below).
   Seed or let PreCompact write a store for the live session, force a compaction, then confirm
   SessionStart's `additionalContext` actually contains the summary. This mirrors U9's arm-time-check
   style: the assumption it verifies has not been confirmed against the installed harness the way
   U9's checks were, so confirm it once, on the machine, before trusting the loop.

## How to disarm

1. Delete the `"SessionStart"`, `"PreCompact"`, and `"PostToolUse"` keys from `.claude/settings.json`
   (or just the entries pointing at these files, if other hooks share those events by then).
2. Restart the session.
3. Optionally delete the store directory — `%LOCALAPPDATA%\kb-context-lifecycle` (or whatever
   `KB_CONTEXT_STORE_DIR` pointed at). It is the ONLY state this family creates; nothing lives in the
   repo.

Deleting the scripts while they are still registered would leave `node` failing on every tool call, so
remove the settings entries first.

## Verification

```
py -3 -m pytest tests/test_context_store.py tests/test_context_lifecycle_session_start.py tests/test_context_lifecycle_pre_compact.py tests/test_context_lifecycle_activity_tracker.py tests/test_context_lifecycle_inert.py -v
cd dashboard && npx.cmd vitest run server/contextLifecycle src/views/agentPlatform/panels/ContextLifecycle.panel.test.tsx
```

What the suites pin, beyond the happy paths: the fixed heading order and the U7 seam (the committed
re-grounding hook run against a store this library wrote); the guard line is byte-identical to U7's,
and the panel's seam headings are read out of U7's own `WANTED_SECTIONS` rather than restated; the
SessionStart cap holds and every malformed input fails open; the PreCompact source contains **no**
`spawnSync`/`exec`/`child_process` reference at all (the zero-spend assertion); every redaction class
gets its own probe — ECC's four plus the modern shapes — and ANSI cannot smuggle a token past the
table; the 20-entry ring cap; a failed write fails **closed**, leaving the previous store intact
rather than a torn one; the dashboard route's parser reads a fixture generated by the hook library
itself (the two implementations cannot silently diverge); an unsafe session id never reaches the
filesystem in any of the three hooks; and `.claude/**` is byte-identical to HEAD with no GateGuard
anywhere in the family.

Manual smoke test (PowerShell, from the repo root — writes to a throwaway store, touches nothing live):

```powershell
$env:KB_CONTEXT_STORE_DIR = "$env:TEMP\ctxstore-smoke"
'{"hook_event_name":"PostToolUse","session_id":"smoke","tool_name":"Bash","tool_input":{"command":"git status"}}' | node scripts/hooks/context_lifecycle_activity_tracker.js
'{"hook_event_name":"SessionStart","session_id":"smoke"}' | node scripts/hooks/context_lifecycle_session_start.js
Get-Content "$env:KB_CONTEXT_STORE_DIR\smoke.ctx.md"
Remove-Item -Recurse -Force $env:KB_CONTEXT_STORE_DIR; Remove-Item Env:\KB_CONTEXT_STORE_DIR
```

(The SessionStart line prints `{}` — correct: nothing has written a `## Resumed-session summary` for
that throwaway session. Add a PreCompact call with a real `transcript_path` to see an injection.)

## Decision-notes

### Reclaim scope — what came over from ECC, and what did not

**ADOPTED (pattern, re-implemented against kb's shapes):**

- The **SessionStart injection pattern** — read persisted per-session context, hand it back as
  `additionalContext`. This is the idea ECC is actually right about.
- The **stale-replay guard**, reusing U7's sentence verbatim so exactly one guard phrasing exists in
  this repo. A resumed summary arriving alongside a fresh prompt would otherwise read as a new
  instruction; the guard is what makes replay safe.
- The **PreCompact write-side-effect pattern** — hook the one moment before the context is discarded.
- The **activity-tracker redaction table** (imported near-verbatim: same regexes, same order, same
  220-char cap), **extended** — see the next note.

**DROPPED:**

- **GateGuard, entirely.** It is off in this repo already (`ECC_GATEGUARD: off` in
  `.claude/settings.json`) and it is the kill reason for the whole plugin: a hook family that decides
  what the model may assert, enforced by regex, at the cost of a check on every edit. No part of it is
  reclaimed here, and `test_no_gateguard_reached_scripts_hooks_through_this_unit` keeps it out. (Two
  committed files cite `gateguard-fact-force.js` as the provenance of the destructive-command
  classifier a previous import retargeted — a citation, not the subsystem.)
- **LLM summarization.** ECC's PreCompact equivalent shells out to `claude -p` to write the summary.
  That is hidden, unbudgeted, per-compaction spend on a path nobody is watching, which is precisely
  what kb's daily budget guard exists to prevent — and it makes the hook's latency and its output both
  unpredictable. We trade summary quality for **zero spend and determinism**: last N turns, role +
  first text or tool name, redacted and capped. The summary is a recall cue, not prose. If the cue
  turns out to be too thin in practice, the honest fix is a longer N, not a model call.
- ECC's **JSONL metrics sink**, crypto row ids, per-row timestamps, deep `tool_input` walk, and the
  `git diff` enrichment that shells out to `git` on every single tool call.
- ECC's **cross-session, worktree-matched lookup** — on session start it hunts for context written by
  *other* sessions whose working directory matches. Declined: this machine routinely runs several
  worktrees and several agents at once, and that lookup is exactly how one run's context bleeds into
  another's prompt. Same-session-only is a deliberate narrowing, not an oversight; the key is the
  session id and nothing else.
- ECC's **day-based retention pruner** (delete stores older than N days, on a hook). Declined for now
  on a simple principle: a sweeping hook is a deleting hook, and this family is otherwise
  append-and-read. Aging is real and unsolved — see Retention below — but it is a pre-arming decision
  with its own blast radius, not something to inherit by default.

**DEFERRED (not built, deliberately):**

- A **SessionEnd summarizer** — a proper end-of-session write-up rather than a compaction-triggered
  one. Wanted, but it needs a spend decision first, and it overlaps whatever U10 lands.
- **Instinct / skill mining** from the activity buffer. That is U10's domain (`memory/` and the
  lessons pipeline); mining the same trail from two places would produce two disagreeing memories.

### Redaction is a best-effort denylist — reviewing it is a PRE-ARMING precondition

The table in `scripts/hooks/lib/context_store.js:redactSecrets` catches the shapes we know about.
ECC's original block (AWS `AKIA`/`ASIA`, `ghp_`/`gho_`/`ghs_`/`github_pat_`, `Authorization:`,
`password=`, `--token`) dates from 2.0.0 and misses most of what actually passes through a terminal
today, so kb adds: `sk-ant-…`, `sk-proj-`/`sk-live-`/`sk-test-` and generic `sk-…`, Slack `xoxb-`/
`xoxp-`, JWTs, PEM `-----BEGIN … PRIVATE KEY-----` blocks, generic `*API_KEY=`/`*_TOKEN=`/`*_SECRET=`
assignments, `x-api-key:`, and a bare `Bearer <token>` with no `Authorization:` in front of it.
Ordering within the table matters (PEM and `sk-ant-` run before the narrower rules that would
otherwise shred them), and **ANSI is stripped before redaction, not after** — ECC had it the other
way round, which lets `ghp_<ESC>[0m<rest>` slip past every regex and be reassembled intact by the
strip that follows.

None of that makes it a guarantee. **It is a denylist: a credential shape nobody anticipated is
written to disk verbatim.** Two things follow.

1. **Before arming the PostToolUse tracker, re-read this table against the credentials actually in
   use** (and add any that are missing, with a probe test — see
   `MODERN_SECRET_PROBES` in `tests/test_context_lifecycle_activity_tracker.py`). This is a
   precondition, not a nice-to-have: the tracker writes to disk on *every* tool call, so a gap is a
   standing leak rather than a one-off.
2. The store directory should be treated as **sensitive-at-rest** regardless — it holds real (if
   redacted) session content. That is another argument for the repo-external location below, and it
   is why the retention question is a privacy question, not a disk-space one.

### Store location

`%LOCALAPPDATA%\kb-context-lifecycle\<sessionId>.ctx.md`, overridable with `KB_CONTEXT_STORE_DIR`.

Deliberately **outside every git worktree**, following the `DASHBOARD_STATE_ROOT` precedent recorded
in `.gitignore`: a per-session context file is daemon-local state, never coordination truth. In the
repo it would be a merge-conflict generator across worktrees, would leak session content into git
history, and would put a hook-written file inside the tree the delivery gate watches.

**Open:** whether the store should instead sit next to Claude Code's own transcripts
(`~/.claude/projects/<project>/`), which would keep session artefacts in one place and make the
project a natural partition key. The counter-argument is that `~/.claude` is the harness's directory,
not ours. Decide before arming; the env override makes it a one-line change either way.

### Retention

Today: a **20-entry ring buffer** for activity, and last-write-wins for every other section. That
bounds a single store, but nothing bounds the NUMBER of stores — one file per session id, forever.

**File aging is deferred, not solved.** A store is a few KiB, so the disk cost is negligible for a
long time, but the privacy surface is not: an unbounded directory of redacted-but-real session content
accumulates. Before arming fleet-wide, decide an aging policy (delete stores older than N days on
SessionStart? cap the directory at M files?) and where it runs — a hook that also sweeps is a hook
that can delete, which is a materially bigger blast radius than one that appends.

### Concurrent writers to one store — a PRE-ARMING decision-note, not solved here

U9 verified (against the installed harness's own bundled schema, not documentation) that a
dispatched subagent shares its **parent's** `session_id` — see
`docs/proposals/spawn-model-verify-hooks.md`. That was the right read for U9's own seam, but it has
a consequence for this unit's writer that U9 did not need to absorb: with one or more subagents in
flight, the PostToolUse activity tracker for the parent and every child dispatched from it are all
writing to the **same store file**, keyed by the same `session_id`, concurrently.

The store's write path (write-then-rename) prevents a **torn** file — a reader never sees a
half-written store — but it does nothing about a **lost update**. Two concurrent writers each read
the current `## Recent activity` ring buffer, append their own line in memory, and rename their own
copy over the file; whichever rename lands second wins outright, and the other writer's activity
line is silently dropped rather than merged. This machine routinely runs several subagents at once,
so this is not a corner case — it is the common case the moment `SubagentStart`/`PostToolUse` are
armed together with any concurrent dispatch pattern.

**Decide before arming**, not after: this is a race, not a bug to fix reactively once a line goes
missing. Candidate fixes, neither built here:

1. **Serialize writes** — a lock (advisory file lock, or a single-writer queue) around the
   read-modify-write, so concurrent appends interleave safely instead of racing. Simple to reason
   about; adds latency and a lock-file failure mode to every tool call.
2. **Per-writer files** — the parent and each subagent append to their own file (e.g. keyed by
   `session_id` + `agent_id`), merged only at read time (`SessionStart`, or the dashboard panel).
   No lock needed, but a reader now has to fan out across N files per session instead of one.

Neither option is implemented; today's tracker is correct only for the no-concurrent-subagent case.

### The `KB_GOAL_STATE_PATH` "latest pointer" question

U7's proposal already flags that its default source is a dated, wave-scoped plan file, and that a
stable "latest GOAL-STATE" pointer must exist before it is armed. The seam this unit built adds a
second, sharper version of the same question: if `KB_GOAL_STATE_PATH` is pointed at a **session
store**, it has to point at *this* session's store — a per-session path that no static settings value
can express, because the session id is not known when settings are read.

Three options, none free:

1. **Leave the seam manual.** `KB_GOAL_STATE_PATH` stays a static plan file; the store is used by the
   SessionStart hook only. Nothing to decide, and the seam is a capability rather than a wiring.
2. **A "latest" pointer file** the PreCompact hook also writes (`latest.ctx.md`, a copy or a
   symlink). Simple, but wrong the moment two sessions run concurrently — and on this machine they
   routinely do.
3. **Teach the re-grounding hook a session-relative default.** Correct, but it is an edit to U7, which
   this unit deliberately did not make: the whole point of the byte-identical headings was to prove the
   seam works with U7 untouched.

Recommend (1) until someone has actually wanted (3).
