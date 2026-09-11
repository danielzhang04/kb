# Project frame + hooks — implementation plan (2026-09-11)

**For agentic workers:** execute tasks in order. Each task is TDD: write the failing test, run
it (confirm the failure reason, not just "red"), implement, run again (confirm green), commit.
Do not skip ahead — Task 3 depends on Task 1's exports, Task 6 depends on Task 1, Task 7 depends
on every prior task's files existing at their committed paths.

**Goal:** every kb CLI session (boss, worker, subagent) starts and stays grounded in the active
project's GOAL state and CURRENT state without re-reading the whole repo, and without being
overloaded on every turn. Success = a fresh session on a project branch receives the frame at
startup, a subagent inherits the governing sections, every dispatch's model is audited, and stale
handoffs are flagged — all verified by tests plus one live run (Task 8).

**Architecture:** one new resolver library (`scripts/hooks/lib/project_frame.js`) turns a hook
event into `{project, frame text}` by reading `orgs/<p>/GOAL.md` and `STATE.md` off
`origin/ops` (git show, 2 s timeout, working-tree fallback) and rendering them through the
existing U8 context-store section format. One new SessionStart hook
(`project_frame_session_start.js`) is the missing WRITER for the U8 store's reserved governing
headings, which makes U7's re-grounding hook and U9's subagent-context-load hook work against
live project state for the first time. Two new Python scripts (`handoffs_sweep.py`,
`project_frame_lint.py`) are read-only housekeeping, run by tests and by hand — never hooks.

**Tech stack:** Node ≥ 18 CommonJS hooks (no dependencies — hooks run on whatever `node` the
harness has); Python 3 scripts (`py -3` on this Windows host, `python` fallback); pytest driving
the Node hooks via `subprocess.run(["node", HOOK], input=json, env=...)`, the same idiom as
`tests/test_regrounding_hook.py`.

**Spec:** `docs/superpowers/specs/2026-09-11-project-frame-hooks-design.md` — implemented exactly
as written; ambiguities the spec leaves open are resolved explicitly in each task and summarized
in the self-review section at the end of this plan.

## Global constraints (copied verbatim from the spec)

- Char budgets per `frame()` mode: **full 7000**, **reground 1700** (matches U7's
  `MAX_CONTEXT_CHARS`), **subagent 2500**, **rollup 1500**.
- `STATE.md` hard cap **60 lines**. `GOAL.md` hard cap **80 lines**.
- SessionStart end-to-end target **< 3 s** on this machine; the automated test asserts **< 5 s**
  with a warm git (Task 8).
- **Fail open everywhere.** Every hook: any error → stdout `{}`, exit 0, empty stderr. No hook in
  this plan may ever block a session, a tool call, a compaction, or a spawn.
- Hooks are registered by **absolute path**, `C:/Users/danie/kb/scripts/hooks/<file>.js` — hook
  cwd is unpredictable and every existing kb hook is registered this way. Never relativize.
- No network calls, ever. `git show origin/ops:<path>` reads a local ref; nothing fetches.

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `scripts/hooks/lib/project_frame.js` | NEW | Branch→project resolver, ops-file reader, per-mode frame renderer. |
| `scripts/hooks/project_frame_session_start.js` | NEW | SessionStart hook: runs preamble, resolves project, writes governing store sections, emits full/rollup context, appends handoff-sweep flags. |
| `scripts/hooks/regrounding_hook.js` | EDIT | Default source becomes the session store; `WANTED_SECTIONS` gains `"Current gate"`. |
| `scripts/handoffs_sweep.py` | NEW | Flags stale/superseded/dead-Load handoffs; table/`--json`/`--delete` output. |
| `scripts/project_frame_lint.py` | NEW | Validates every `orgs/*/GOAL.md` and `STATE.md` against the required shape. |
| `scripts/hooks/delivery_gate.js` | EDIT | Adds a stale-STATE.md warning (3 days), reusing `project_frame`. |
| `.claude/settings.json` | EDIT (Task 7) | Arms the new/edited hooks; merges with the three existing `PreToolUse` entries. |
| `handoffs/README.md` | EDIT (Task 7) | Adds the sweep-driven deletion rule. |
| `docs/proposals/regrounding-hook.md`, `context-lifecycle-hooks.md`, `spawn-model-verify-hooks.md` | EDIT (Task 7) | Status lines flip from PROPOSAL to ARMED (partially, for the context-lifecycle doc). |
| `tests/test_project_frame.py` | NEW | Resolver + frame() tests, real git-repo fixture. |
| `tests/test_project_frame_session_start.py` | NEW | SessionStart hook tests + the 5 s wall-clock test. |
| `tests/test_regrounding_hook.py` | EDIT | One new test for the store-default source. |
| `tests/test_handoffs_sweep.py` | NEW | Sweep flag/JSON/delete tests. |
| `tests/test_project_frame_lint.py` | NEW | Lint pass/fail tests. |
| `tests/test_delivery_gate_hook.py` | EDIT | Stale-STATE warning tests. |
| `tests/test_context_lifecycle_inert.py` | EDIT (Task 7) | Armed/still-inert split assertions. |
| `tests/test_model_verify.py` | EDIT (Task 7) | U9 inert→armed assertions. |

---

## Task 1 — `scripts/hooks/lib/project_frame.js`

### Files
- Create `scripts/hooks/lib/project_frame.js`
- Create `tests/test_project_frame.py`

### Interfaces
```js
function activeProject(event, env) -> string|null
function readOpsFile(cwd, relPath, env) -> string|null
function listProjects(cwd, env) -> string[]
const parseSections = store.parseSections   // re-exported, see note below
function frame({project, mode, cwd, sessionId, env}) -> {text: string, sections: Array}
const MODE_BUDGETS = {full: 7000, reground: 1700, subagent: 2500, rollup: 1500}
```

**`parseSections` reuse decision:** `context_store.parseSections(text)` already returns ordered
`{heading, body}` pairs, drops any preamble before the first `## `, and trims bodies — exactly the
shape `GOAL.md`/`STATE.md` need, because the spec's required-sections blocks spell every heading
exactly (`## North star`, not `## North star (something)`). Reused directly, not reimplemented.
`regrounding_hook.js`'s `extractSection` is NOT reused here — it does prefix-matching for a single
named section from a flat string, a different shape than "parse the whole file into sections".

### Step 1 — failing test: branch → project resolution
Write `tests/test_project_frame.py` with a fixture that builds a throwaway git repo carrying a
real `refs/remotes/origin/ops` ref (no network, no real remote — `update-ref` points it at a local
commit) with `orgs/prospecting/{GOAL,STATE}.md`:

```python
import json
import os
import subprocess
import textwrap
from datetime import date
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
LIB = REPO / "scripts" / "hooks" / "lib" / "project_frame.js"


def git(cwd, *args):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def run_node(script, env=None):
    e = {**os.environ, **(env or {})}
    r = subprocess.run(["node", "-e", script], capture_output=True, env=e)
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
    return r.stdout.decode("utf-8")


def call(fn_expr, cwd, extra_env=None):
    """Evaluate `pf.<fn_expr>` against LIB, JSON-stringifying the result to stdout."""
    body = (
        f'const pf = require({json.dumps(str(LIB))}); '
        f'const out = pf.{fn_expr}; '
        f'process.stdout.write(JSON.stringify(out === undefined ? null : out));'
    )
    return json.loads(run_node(body, extra_env))


@pytest.fixture
def ops_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "checkout", "-q", "-b", "main")
    (repo / "README.md").write_text("x", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")

    git(repo, "checkout", "-q", "-b", "ops")
    orgs = repo / "orgs" / "prospecting"
    orgs.mkdir(parents=True)
    (orgs / "GOAL.md").write_text(textwrap.dedent("""\
        # prospecting — GOAL
        _Ruled: 2026-09-01_
        ## North star
        Deliver qualified leads.
        ## Invariants
        Never fabricate an email.
        """), encoding="utf-8")
    (orgs / "STATE.md").write_text(textwrap.dedent("""\
        # prospecting — STATE
        _Updated: 2026-09-10 12:00_
        ## Now
        Batch 2 running.
        ## Current gate
        Daniel reviews batch 2.
        """), encoding="utf-8")
    git(repo, "add", "orgs")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed orgs")
    git(repo, "checkout", "-q", "main")

    sha = git(repo, "rev-parse", "ops").strip()
    git(repo, "update-ref", "refs/remotes/origin/ops", sha)
    git(repo, "branch", "-D", "ops")
    return repo


def test_active_project_matches_longest_id(ops_repo):
    git(ops_repo, "checkout", "-q", "-b", "claude/prospecting-p8")
    result = call(f'activeProject({{cwd:{json.dumps(str(ops_repo))}}}, {{}})', ops_repo)
    assert result == "prospecting"


def test_kb_project_env_overrides_branch(ops_repo):
    git(ops_repo, "checkout", "-q", "-b", "claude/boss-2026-09-11")
    result = call(
        f'activeProject({{cwd:{json.dumps(str(ops_repo))}}}, {{KB_PROJECT:"prospecting"}})', ops_repo
    )
    assert result == "prospecting"


def test_boss_branch_resolves_to_null(ops_repo):
    git(ops_repo, "checkout", "-q", "-b", "claude/boss-2026-09-11")
    result = call(f'activeProject({{cwd:{json.dumps(str(ops_repo))}}}, {{}})', ops_repo)
    assert result is None


def test_branch_with_no_slash_resolves_to_null(ops_repo):
    git(ops_repo, "checkout", "-q", "main")
    result = call(f'activeProject({{cwd:{json.dumps(str(ops_repo))}}}, {{}})', ops_repo)
    assert result is None
```

### Step 2 — run, confirm failure
```
py -3 -m pytest tests/test_project_frame.py -q
```
Expect `ModuleNotFoundError`-equivalent from node (`Cannot find module '.../project_frame.js'`)
surfaced as a nonzero exit inside `run_node`'s assert.

### Step 3 — implement the resolver half
```js
#!/usr/bin/env node
/*
 * kb project-frame resolver — turns a hook event into the active project (if any) and renders
 * its GOAL.md/STATE.md into the per-mode context blocks the SessionStart, re-grounding, and
 * subagent-load hooks emit.
 *
 * Status: ARMED 2026-09-11 via project_frame_session_start.js (SessionStart) and the U7 edit to
 * regrounding_hook.js. See docs/superpowers/plans/2026-09-11-project-frame-hooks.md.
 *
 * Reads: `git -C <cwd> branch --show-current` and `git -C <cwd> show origin/ops:<path>`, both
 * with a 2 s timeout. NEVER fetches — origin/ops is read as a local ref, exactly as the
 * checkout already has it. Every function here fails open to null/[]/"" on any git, filesystem,
 * or parse error; nothing throws past this file's own boundary.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const io = require("./hook_io.js");
const store = require("./context_store.js");

const GIT_TIMEOUT_MS = 2000;
const MAX_OPS_FILE_CHARS = 32 * 1024;
const MAX_HANDOFF_CHARS = 32 * 1024;

const MODE_BUDGETS = Object.freeze({ full: 7000, reground: 1700, subagent: 2500, rollup: 1500 });

// GOAL.md/STATE.md headings are spelled exactly per the spec — the U8 store's parser already
// drops any preamble and trims bodies the same way this format needs. Reused, not reimplemented.
const parseSections = store.parseSections;

const GUARD_LINE = io.GUARD_LINE;

/** A project id under orgs/ known to have a `faceless-youtube`-style multi-word directory name
 *  but a single-word handoff-filename scope token (see handoffs/README.md's scope list). Extend
 *  this table as new aliases are needed; it is deliberately small and explicit. */
const HANDOFF_SCOPE_ALIASES = Object.freeze({ "faceless-youtube": "fyt" });

const HANDOFF_NAME_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+)-.+\.md$/;
const UPDATED_RE = /^_Updated:\s*([^_\n]+?)_?\s*$/m;

function gitCapture(cwd, args) {
  if (typeof cwd !== "string" || !cwd) return null;
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch (_err) {
    return null; // nonzero exit, missing git, timeout — all fail open
  }
}

function listProjects(cwd, env) {
  const out = gitCapture(cwd, ["ls-tree", "-d", "--name-only", "origin/ops:orgs"]);
  if (out !== null) {
    return out
      .split("\n")
      .map((line) => line.trim().replace(/\/$/, ""))
      .filter(Boolean);
  }
  try {
    return fs
      .readdirSync(path.join(cwd, "orgs"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (_err) {
    return [];
  }
}

function projectFromBranch(branch, ids) {
  if (typeof branch !== "string" || !branch.includes("/")) return null;
  const portion = branch.slice(branch.indexOf("/") + 1);
  const byLengthDesc = ids.slice().sort((a, b) => b.length - a.length);
  for (const id of byLengthDesc) {
    if (portion === id || portion.startsWith(id + "-")) return id;
  }
  return null;
}

function activeProject(event, env) {
  const e = env || process.env;
  if (typeof e.KB_PROJECT === "string" && e.KB_PROJECT.trim()) {
    return e.KB_PROJECT.trim();
  }
  const cwd = event && typeof event.cwd === "string" && event.cwd ? event.cwd : null;
  if (!cwd) return null;
  const branch = gitCapture(cwd, ["branch", "--show-current"]);
  if (!branch) return null;
  return projectFromBranch(branch, listProjects(cwd, e));
}

function readOpsFile(cwd, relPath, env) {
  const out = gitCapture(cwd, ["show", "origin/ops:" + relPath]);
  if (out !== null) {
    return out.length > MAX_OPS_FILE_CHARS ? out.slice(0, MAX_OPS_FILE_CHARS) : out;
  }
  if (typeof cwd !== "string" || !cwd) return null;
  return io.readCappedFile(path.join(cwd, relPath), MAX_OPS_FILE_CHARS);
}

module.exports = {
  MODE_BUDGETS,
  activeProject,
  listProjects,
  parseSections,
  readOpsFile,
  // frame(), projectHandoffs(), loadListFor() are added in Step 5 below.
};
```

### Step 4 — run, confirm the four resolver tests pass
```
py -3 -m pytest tests/test_project_frame.py -q
```

### Step 5 — failing tests: `readOpsFile` fallback + `frame()` per mode
Append to `tests/test_project_frame.py`:

```python
def test_read_ops_file_uses_git_show_not_working_tree(ops_repo):
    git(ops_repo, "checkout", "-q", "main")  # working tree has no orgs/ at all on main
    out = call(
        f'readOpsFile({json.dumps(str(ops_repo))}, "orgs/prospecting/STATE.md", {{}})', ops_repo
    )
    assert "Batch 2 running." in out


def test_read_ops_file_falls_back_to_working_tree(tmp_path):
    repo = tmp_path / "solo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
    (repo / "orgs" / "kb-ops").mkdir(parents=True)
    (repo / "orgs" / "kb-ops" / "STATE.md").write_text("## Now\nlocal only\n", encoding="utf-8")
    out = call(f'readOpsFile({json.dumps(str(repo))}, "orgs/kb-ops/STATE.md", {{}})', repo)
    assert "local only" in out


def _frame_text(ops_repo, mode, project="prospecting", session_id=None):
    body = (
        f'const pf = require({json.dumps(str(LIB))}); '
        f'const r = pf.frame({{project:{json.dumps(project)}, mode:{json.dumps(mode)}, '
        f'cwd:{json.dumps(str(ops_repo))}, sessionId:{json.dumps(session_id)}, env:{{}}}}); '
        f'process.stdout.write(r.text);'
    )
    return run_node(body)


def test_frame_full_mode_includes_goal_and_state(ops_repo):
    text = _frame_text(ops_repo, "full")
    assert text.startswith("[kb re-grounding]")
    assert "Deliver qualified leads." in text
    assert "Batch 2 running." in text
    assert len(text) <= 7000


def test_frame_reground_mode_stays_under_budget(ops_repo):
    text = _frame_text(ops_repo, "reground")
    assert len(text) <= 1700
    assert "Batch 2 running." in text or "Daniel reviews batch 2." in text


def test_frame_subagent_mode_stays_under_budget(ops_repo):
    text = _frame_text(ops_repo, "subagent")
    assert len(text) <= 2500
    assert "Deliver qualified leads." in text


def test_frame_rollup_lists_every_project(ops_repo):
    body = (
        f'const pf = require({json.dumps(str(LIB))}); '
        f'const r = pf.frame({{mode:"rollup", cwd:{json.dumps(str(ops_repo))}, env:{{}}}}); '
        f'process.stdout.write(r.text);'
    )
    text = run_node(body)
    assert "prospecting: Batch 2 running. (updated 2026-09-10 12:00)" in text


def test_frame_guard_line_always_first(ops_repo):
    for mode in ("full", "reground", "subagent"):
        assert _frame_text(ops_repo, mode).startswith("[kb re-grounding]"), mode


def test_frame_full_mode_includes_project_handoff_load_list(ops_repo):
    handoffs = ops_repo / "handoffs"
    handoffs.mkdir()
    (handoffs / "2026-09-05-prospecting-batch1-pickup.md").write_text(textwrap.dedent("""\
        # prospecting batch 1 handoff — 2026-09-05
        ## Context
        mid-flight
        ## Load list
        `orgs/prospecting/STATE.md`
        """), encoding="utf-8")
    text = _frame_text(ops_repo, "full")
    assert "2026-09-05-prospecting-batch1-pickup.md" in text
    assert "orgs/prospecting/STATE.md" in text
```

### Step 6 — run, confirm failure
`frame`/`projectHandoffs`/`loadListFor` are not exported yet; the module-eval calls throw
`TypeError: pf.frame is not a function`.

### Step 7 — implement `frame()` and the handoff helpers
Append to `scripts/hooks/lib/project_frame.js`, replacing the trailing `module.exports`:

```js
function firstLine(text) {
  if (!text) return null;
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line || null;
}

function updatedStamp(text) {
  if (typeof text !== "string") return null;
  const m = UPDATED_RE.exec(text);
  return m ? m[1].trim() : null;
}

function bodiesFor(sections, headings) {
  const parts = [];
  for (const heading of headings) {
    const body = store.sectionBody(sections, heading);
    if (body) parts.push({ label: heading, body });
  }
  return parts;
}

/**
 * Render `Label: body` entries in order, truncating LAST-FIRST once `budget` is exceeded: every
 * entry before the overflow point is kept whole, the first entry that would overflow is cut to
 * whatever room remains, and every entry after it is dropped outright. This differs deliberately
 * from regrounding_hook.js's water-filling `fitSections` — the spec calls for last-first here,
 * not an equal-share split, because a frame's EARLIER sections (GOAL before STATE, Now before
 * Findings) are the ones a resuming session most needs intact.
 */
function truncateLastFirst(entries, budget) {
  const rendered = [];
  let used = 0;
  for (const entry of entries) {
    const line = entry.label ? entry.label + ": " + entry.body : entry.body;
    const sep = rendered.length ? "\n\n" : "";
    const room = budget - used - sep.length;
    if (room <= 0) break;
    if (line.length <= room) {
      rendered.push(line);
      used += sep.length + line.length;
    } else {
      rendered.push(io.truncateTo(line, room));
      used = budget;
      break;
    }
  }
  return rendered.join("\n\n");
}

function projectHandoffs(cwd, project) {
  if (!cwd || !project) return [];
  let names;
  try {
    names = fs.readdirSync(path.join(cwd, "handoffs")).filter((n) => n.endsWith(".md"));
  } catch (_err) {
    return [];
  }
  const scope = HANDOFF_SCOPE_ALIASES[project] || project;
  return names
    .filter((name) => {
      const m = HANDOFF_NAME_RE.exec(name);
      return Boolean(m && m[2] === scope);
    })
    .sort();
}

function loadListFor(cwd, filename) {
  const text = io.readCappedFile(path.join(cwd, "handoffs", filename), MAX_HANDOFF_CHARS);
  if (!text) return null;
  const sections = parseSections(text);
  return store.sectionBody(sections, "Load list") || store.sectionBody(sections, "Load");
}

function frame(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const cwd = o.cwd;
  const mode = Object.prototype.hasOwnProperty.call(MODE_BUDGETS, o.mode) ? o.mode : "rollup";
  const budget = MODE_BUDGETS[mode];

  if (mode === "rollup") {
    const entries = [];
    for (const id of listProjects(cwd, env)) {
      const stateText = readOpsFile(cwd, `orgs/${id}/STATE.md`, env);
      if (!stateText) continue;
      const now = firstLine(store.sectionBody(parseSections(stateText), "Now")) || "(no ## Now)";
      const updated = updatedStamp(stateText) || "unknown";
      entries.push({ label: null, body: `${id}: ${now} (updated ${updated})` });
    }
    const body = truncateLastFirst(entries, budget - GUARD_LINE.length - 2);
    const text = io.truncateTo(body ? GUARD_LINE + "\n\n" + body : GUARD_LINE, budget);
    return { text, sections: entries };
  }

  const project = o.project;
  let goalSections = [];
  let stateSections = [];
  if (project && cwd) {
    const goalText = readOpsFile(cwd, `orgs/${project}/GOAL.md`, env);
    const stateText = readOpsFile(cwd, `orgs/${project}/STATE.md`, env);
    goalSections = goalText ? parseSections(goalText) : [];
    stateSections = stateText ? parseSections(stateText) : [];
  }

  let entries;
  if (mode === "full") {
    entries = bodiesFor(goalSections, ["North star", "Success conditions", "Invariants", "Governing docs"])
      .concat(bodiesFor(stateSections, ["Now", "Current gate", "Next", "Blocked", "Findings", "Infra"]));
    for (const name of projectHandoffs(cwd, project)) {
      const loadList = loadListFor(cwd, name);
      entries.push({ label: `Handoff ${name}`, body: loadList || "(no Load list found)" });
    }
    const sessionSections = o.sessionId ? store.readStore(o.sessionId, env) : [];
    const resumed = store.sectionBody(sessionSections, store.HEADINGS.RESUMED_SUMMARY);
    if (resumed) entries.push({ label: "Resumed-session summary", body: resumed });
  } else if (mode === "reground") {
    entries = bodiesFor(stateSections, ["Now", "Current gate"]).concat(
      bodiesFor(goalSections, ["Invariants"])
    );
  } else if (mode === "subagent") {
    entries = bodiesFor(goalSections, ["North star", "Invariants"]).concat(
      bodiesFor(stateSections, ["Current gate"])
    );
  } else {
    entries = [];
  }

  const body = truncateLastFirst(entries, budget - GUARD_LINE.length - 2);
  const text = io.truncateTo(body ? GUARD_LINE + "\n\n" + body : GUARD_LINE, budget);
  return { text, sections: entries };
}

module.exports = {
  MODE_BUDGETS,
  activeProject,
  frame,
  listProjects,
  loadListFor,
  parseSections,
  projectHandoffs,
  readOpsFile,
};
```

### Step 8 — run, confirm all of `tests/test_project_frame.py` passes
```
py -3 -m pytest tests/test_project_frame.py -q
```

### Step 9 — commit
```
git add scripts/hooks/lib/project_frame.js tests/test_project_frame.py
git commit -m "feat(hooks): project_frame resolver — branch->project, ops-file reads, per-mode frame()"
```

---

## Task 2 — `scripts/hooks/project_frame_session_start.js`

### Files
- Create `scripts/hooks/project_frame_session_start.js`
- Create `tests/test_project_frame_session_start.py`

### Interfaces
```js
function runPython(args, cwd, timeoutMs) -> {status, stdout, stderr} | null
function preambleVerdict(root) -> string
function handoffFlags(root) -> string[]
function writeGoverningSections(sessionId, project, cwd, env) -> void
function main() -> void   // entry point, io.run(main) at module scope
```

### Step 1 — failing tests
Create `tests/test_project_frame_session_start.py`. It needs a fixture "fake KB_ROOT" carrying a
fast, deterministic stub `scripts/preamble.py` (the real one imports `yaml`/`ledger` and reads
`governance/budget.yaml`, which is not what this hook's own tests should depend on) plus, for one
test, a stub `scripts/handoffs_sweep.py`:

```python
import json
import os
import subprocess
import textwrap
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "project_frame_session_start.js"


def git(cwd, *args):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def make_kb_root(tmp_path, preamble_body='print("PREAMBLE OK")\n', with_sweep=False):
    root = tmp_path / "kb_root"
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "preamble.py").write_text(preamble_body, encoding="utf-8")
    if with_sweep:
        (root / "scripts" / "handoffs_sweep.py").write_text(
            'import json, sys\n'
            'print(json.dumps([{"file": "2020-01-01-kb-old.md", "reasons": ["30 days old"]}]))\n',
            encoding="utf-8",
        )
    return root


def make_project_repo(tmp_path, updated="2026-09-10 12:00"):
    repo = tmp_path / "proj"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "checkout", "-q", "-b", "main")
    (repo / "README.md").write_text("x", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")
    orgs = repo / "orgs" / "prospecting"
    orgs.mkdir(parents=True)
    (orgs / "GOAL.md").write_text("## North star\nDeliver leads.\n## Invariants\nNever fabricate.\n", encoding="utf-8")
    (orgs / "STATE.md").write_text(f"_Updated: {updated}_\n## Now\nBatch 2.\n## Current gate\nReview.\n", encoding="utf-8")
    git(repo, "add", "orgs")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed")
    git(repo, "checkout", "-q", "-b", "claude/prospecting-p8")
    sha = git(repo, "rev-parse", "HEAD").strip()
    git(repo, "update-ref", "refs/remotes/origin/ops", sha)
    return repo


def run_hook(event, kb_root, store_dir, extra_env=None):
    env = {
        **os.environ,
        "KB_ROOT": str(kb_root),
        "KB_CONTEXT_STORE_DIR": str(store_dir),
        **(extra_env or {}),
    }
    return subprocess.run(["node", str(HOOK)], input=json.dumps(event).encode(), capture_output=True, env=env)


def test_full_payload_on_startup(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    out = json.loads(r.stdout)
    ctx = out["hookSpecificOutput"]["additionalContext"]
    assert "PREAMBLE OK" in ctx
    assert "Deliver leads." in ctx
    assert "Batch 2." in ctx


def test_nothing_emitted_on_compact(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "compact", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0
    assert r.stdout.decode().strip() == "{}"


def test_store_sections_are_written_even_on_compact(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    run_hook(
        {"hook_event_name": "SessionStart", "source": "compact", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    written = (store_dir / "s1.ctx.md").read_text(encoding="utf-8")
    assert "## North star" in written and "Deliver leads." in written
    assert "## Current gate" in written and "Review." in written


def test_preamble_failure_line_surfaces(tmp_path):
    kb_root = make_kb_root(
        tmp_path,
        preamble_body='import sys\nprint("PREAMBLE FAIL: STOP file present")\nsys.exit(2)\n',
    )
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "PREAMBLE FAIL: STOP file present" in ctx


def test_rollup_when_no_project_resolves(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = tmp_path / "no_project"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "PREAMBLE OK" in ctx


def test_handoff_sweep_flags_appended_when_present(tmp_path):
    kb_root = make_kb_root(tmp_path, with_sweep=True)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "2020-01-01-kb-old.md" in ctx


def test_missing_handoffs_sweep_is_tolerated(tmp_path):
    kb_root = make_kb_root(tmp_path, with_sweep=False)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""


def test_every_unhappy_path_fails_open(tmp_path):
    kb_root = make_kb_root(tmp_path)
    store_dir = tmp_path / "store"
    for payload in (b"", b"{not json", b"[]", b"null"):
        r = run_hook({}, kb_root, store_dir)  # placeholder overwritten below
        break
    for raw in (b"", b"{not json", b"null", json.dumps({"hook_event_name": "Stop"}).encode()):
        env = {**os.environ, "KB_ROOT": str(kb_root), "KB_CONTEXT_STORE_DIR": str(store_dir)}
        r = subprocess.run(["node", str(HOOK)], input=raw, capture_output=True, env=env)
        assert r.returncode == 0 and r.stderr == b""
        assert r.stdout.decode().strip() == "{}"


def test_session_start_completes_within_five_seconds(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    started = time.monotonic()
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    elapsed = time.monotonic() - started
    assert r.returncode == 0
    assert elapsed < 5.0, elapsed
```

### Step 2 — run, confirm failure (missing module)

### Step 3 — implement
```js
#!/usr/bin/env node
/*
 * kb project-frame SessionStart hook — ARMED 2026-09-11.
 *
 * The missing WRITER for the U8 context store's reserved governing headings: reads the active
 * project's GOAL.md/STATE.md (via lib/project_frame.js) and writes '## North star',
 * '## Invariants', '## Current gate' into this session's store, then emits the full/rollup frame
 * as additionalContext. On a compacted SessionStart it still writes the store (so U7's
 * post-compact re-grounding has fresh sections to read) but emits nothing itself — U7 owns the
 * compact re-injection, and a double payload on the same turn is wasted budget.
 *
 * Contract: fail open on every unhappy path (no stdin, malformed stdin, foreign event, no
 * session id, no project, unreadable preamble/sweep) -> "{}", exit 0, empty stderr. Never blocks
 * a session start. Two subprocess calls only (python for preamble.py and handoffs_sweep.py), both
 * time-boxed and both optional to the emitted payload.
 */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const io = require("./lib/hook_io.js");
const store = require("./lib/context_store.js");
const pf = require("./lib/project_frame.js");

const PREAMBLE_TIMEOUT_MS = 10000;
const SWEEP_TIMEOUT_MS = 5000;

function runPython(scriptRelPath, extraArgs, cwd, timeoutMs) {
  for (const bin of ["py", "python"]) {
    const args = bin === "py" ? ["-3", scriptRelPath, ...extraArgs] : [scriptRelPath, ...extraArgs];
    const result = spawnSync(bin, args, { cwd, timeout: timeoutMs, encoding: "utf8", windowsHide: true });
    if (!result.error) return result; // ran (whether exit 0 or not) -- that is a real answer
  }
  return null; // neither interpreter is on PATH
}

function preambleVerdict(root) {
  const result = runPython("scripts/preamble.py", [], root, PREAMBLE_TIMEOUT_MS);
  if (!result) return "PREAMBLE FAIL: no python interpreter found";
  const text = (result.stdout || "") + (result.stderr || "");
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line || (result.status === 0 ? "PREAMBLE OK" : "PREAMBLE FAIL: unknown");
}

function handoffFlags(root) {
  const result = runPython("scripts/handoffs_sweep.py", ["--json"], root, SWEEP_TIMEOUT_MS);
  if (!result || result.status !== 0 || !result.stdout) return [];
  try {
    const rows = JSON.parse(result.stdout);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => row && typeof row.file === "string")
      .map((row) => "handoff flag: " + row.file + " — " + (row.reason || (row.reasons || []).join("; ")));
  } catch (_err) {
    return [];
  }
}

function writeGoverningSections(sessionId, project, cwd, env) {
  if (!sessionId || !project || !cwd) return;
  const goalText = pf.readOpsFile(cwd, `orgs/${project}/GOAL.md`, env);
  const stateText = pf.readOpsFile(cwd, `orgs/${project}/STATE.md`, env);
  const goalSections = goalText ? pf.parseSections(goalText) : [];
  const stateSections = stateText ? pf.parseSections(stateText) : [];
  const northStar = store.sectionBody(goalSections, "North star");
  const invariants = store.sectionBody(goalSections, "Invariants");
  const currentGate = store.sectionBody(stateSections, "Current gate");
  if (!northStar && !invariants && !currentGate) return;
  let sections = store.readStore(sessionId, env);
  if (northStar) sections = store.upsertSection(sections, store.HEADINGS.NORTH_STAR, northStar);
  if (invariants) sections = store.upsertSection(sections, store.HEADINGS.INVARIANTS, invariants);
  if (currentGate) sections = store.upsertSection(sections, store.HEADINGS.CURRENT_GATE, currentGate);
  store.writeStore(sessionId, sections, env);
}

function main() {
  const event = io.readEventFor("SessionStart");
  const env = process.env;
  const root = env.KB_ROOT || path.resolve(__dirname, "..", "..");
  const cwd = typeof event.cwd === "string" && event.cwd ? event.cwd : root;
  const sessionId = typeof event.session_id === "string" ? event.session_id : null;

  const preambleLine = preambleVerdict(root);
  const project = pf.activeProject(event, env);
  writeGoverningSections(sessionId, project, cwd, env);

  if (event.source === "compact") {
    io.noop();
  }

  const mode = project ? "full" : "rollup";
  const result = pf.frame({ project, mode, cwd, sessionId, env });
  const flags = handoffFlags(root);
  const combined = flags.length ? result.text + "\n\n" + flags.join("\n") : result.text;
  const budget = pf.MODE_BUDGETS[mode];
  const payload = io.truncateTo(preambleLine + "\n\n" + combined, budget + preambleLine.length + 2);

  io.emitContext("SessionStart", payload);
}

io.run(main);
```

### Step 4 — run, confirm green
```
py -3 -m pytest tests/test_project_frame_session_start.py -q
```

### Step 5 — commit
```
git add scripts/hooks/project_frame_session_start.js tests/test_project_frame_session_start.py
git commit -m "feat(hooks): project_frame_session_start — write governing store sections, emit full/rollup frame"
```

---

## Task 3 — U7 edit: `scripts/hooks/regrounding_hook.js`

### Files
- Edit `scripts/hooks/regrounding_hook.js`
- Edit `tests/test_regrounding_hook.py`

### Step 1 — failing test
Add to `tests/test_regrounding_hook.py`:

```python
def test_default_source_is_the_session_store_when_no_goal_state_path(tmp_path, monkeypatch):
    store_dir = tmp_path / "ctxstore"
    write_body = (
        'const store = require(' + json.dumps(str(REPO / "scripts" / "hooks" / "lib" / "context_store.js")) + ');\n'
        'store.writeStore("store-session", ['
        '{heading: "North star", body: "Ship the frame."},'
        '{heading: "Invariants", body: "Never spend real money."},'
        '{heading: "Current gate", body: "Daniel reviews the plan."}'
        ']);'
    )
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)}
    subprocess.run(["node", "-e", write_body], check=True, env=env, capture_output=True)

    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir), "KB_REGROUND_STATE_DIR": str(tmp_path / "state")}
    env.pop("KB_GOAL_STATE_PATH", None)
    payload = {**EVENT, "session_id": "store-session"}
    r = subprocess.run(["node", str(HOOK)], input=json.dumps(payload).encode(), capture_output=True, env=env)

    assert r.returncode == 0 and r.stderr == b""
    ctx = context_of(r)
    assert "North star: Ship the frame." in ctx
    assert "Invariants: Never spend real money." in ctx
    assert "Current gate: Daniel reviews the plan." in ctx
```

Every OTHER test in this file already sets `KB_GOAL_STATE_PATH` explicitly via `run_hook`'s
default `goal_state_path=GOAL_STATE` argument, so they are unaffected by changing the default.

### Step 2 — run, confirm failure
`Current gate: ...` is absent (not in `WANTED_SECTIONS` yet) and the default source is still the
dead plan file, not the store — `context_of(r)` is `None` because `KB_GOAL_STATE_PATH` is unset
and the old default path doesn't exist in this environment either way once the source changes.

### Step 3 — implement
```js
// WANTED_SECTIONS — see docs/superpowers/plans/2026-09-11-project-frame-hooks.md Task 3: gains
// "Current gate" so a re-grounded turn also carries which gate the arc is sitting on, not just
// the static north star/invariants.
const WANTED_SECTIONS = ["North star", "Invariants", "Current gate"];
```

```js
function loadBlock() {
  const root = process.env.KB_ROOT || path.resolve(__dirname, "..", "..");
  const sourcePath =
    process.env.KB_GOAL_STATE_PATH ||
    require("./lib/context_store.js").sessionPath(
      // sessionKey() is defined below in this same file; loadBlock() is called from main() after
      // the event is parsed, so hoist the lookup into main() and pass the resolved path in,
      // rather than re-deriving session_id here. See the call-site edit below.
      undefined,
      process.env
    );
  ...
```

Rather than reach for the session id inside `loadBlock` (which has no event in scope today),
change the call site in `main()` so the default path is computed once the event is known:

```js
function defaultSourcePath(event) {
  const key = sessionKey(event);
  if (!key) return null;
  return require("./lib/context_store.js").sessionPath(key, process.env);
}

function loadBlock(event) {
  const root = process.env.KB_ROOT || path.resolve(__dirname, "..", "..");
  const sourcePath = process.env.KB_GOAL_STATE_PATH || defaultSourcePath(event);
  if (!sourcePath) return null;

  let source = null;
  try {
    source = fs.readFileSync(sourcePath, "utf8");
  } catch (_err) {
    return null;
  }
  return buildBlock(source);
}
```

And in `main()`, change `const block = loadBlock();` to `const block = loadBlock(event);` (the
`event` variable is already in scope at that point — see the existing code, line ~334-336).
`require("./lib/context_store.js")` is hoisted to the top of the file alongside the existing
`kbPaths`/`io` requires rather than inlined, to match the file's existing style:

```js
const store = require("./lib/context_store.js");
```

and `defaultSourcePath` becomes:

```js
function defaultSourcePath(event) {
  const key = sessionKey(event);
  return key ? store.sessionPath(key, process.env) : null;
}
```

The dead default path (`docs/plans/2026-08-18-agent-platform-GOAL-STATE.md`) is removed entirely
— there is no more static fallback; a session with no id and no `KB_GOAL_STATE_PATH` override now
has nothing to re-ground from, which is correct (there is no store to read without a session id).

### Step 4 — run, confirm green
```
py -3 -m pytest tests/test_regrounding_hook.py -q
```
All prior tests stay green because every one of them sets `KB_GOAL_STATE_PATH` explicitly via
`run_hook`'s default argument.

### Step 5 — commit
```
git add scripts/hooks/regrounding_hook.js tests/test_regrounding_hook.py
git commit -m "feat(hooks): U7 default source is the session store; WANTED_SECTIONS gains Current gate"
```

---

## Task 4 — `scripts/handoffs_sweep.py`

### Files
- Create `scripts/handoffs_sweep.py`
- Create `tests/test_handoffs_sweep.py`

### Interfaces
```python
def collect_handoffs(root: Path) -> list[Handoff]
def flag(root: Path, handoffs: list[Handoff], today: date) -> list[dict]
def render_table(flags: list[dict]) -> str
def render_delete(flags: list[dict]) -> str
def main(argv: list[str] | None = None) -> int
```

### Step 1 — failing tests
```python
import json
import subprocess
import textwrap
from datetime import date, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "handoffs_sweep.py"


def git(cwd, *args):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
    (repo / "handoffs").mkdir()
    return repo


def run_sweep(repo, *args, now=None):
    import os
    env = {**os.environ}
    if now:
        env["KB_HANDOFFS_NOW"] = now
    return subprocess.run(
        ["python", str(SCRIPT), "--root", str(repo), *args], capture_output=True, text=True, env=env
    )


def test_stale_by_age_is_flagged(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "handoffs" / "2026-01-01-kb-old-thing.md").write_text("# old\n## Load list\n", encoding="utf-8")
    r = run_sweep(repo, "--json", now="2026-02-01")
    assert r.returncode == 0
    rows = json.loads(r.stdout)
    assert rows[0]["file"] == "2026-01-01-kb-old-thing.md"
    assert "days old" in rows[0]["reason"]


def test_superseded_same_scope_is_flagged(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "handoffs" / "2026-01-01-fyt-first.md").write_text("# a\n", encoding="utf-8")
    (repo / "handoffs" / "2026-01-05-fyt-second.md").write_text("# b\n", encoding="utf-8")
    r = run_sweep(repo, "--json", now="2026-01-06")
    rows = json.loads(r.stdout)
    by_file = {row["file"]: row["reason"] for row in rows}
    assert "superseded by 2026-01-05-fyt-second.md" in by_file["2026-01-01-fyt-first.md"]
    assert "2026-01-05-fyt-second.md" not in by_file  # the newer one is not itself flagged as superseded


def test_dead_load_path_is_flagged(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "handoffs" / "2026-01-05-kb-thing.md").write_text(
        "# thing\n## Load list\n`docs/does/not/exist.md`\n", encoding="utf-8"
    )
    r = run_sweep(repo, "--json", now="2026-01-05")
    rows = json.loads(r.stdout)
    assert "dead Load path" in rows[0]["reason"]
    assert "docs/does/not/exist.md" in rows[0]["reason"]


def test_healthy_handoff_is_not_flagged(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "README.md").write_text("kept file", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "add readme")
    (repo / "handoffs" / "2026-01-05-kb-thing.md").write_text(
        "# thing\n## Load list\n`README.md`\n", encoding="utf-8"
    )
    r = run_sweep(repo, "--json", now="2026-01-05")
    assert json.loads(r.stdout) == []


def test_delete_mode_prints_git_rm_lines_only(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "handoffs" / "2026-01-01-kb-old.md").write_text("# old\n", encoding="utf-8")
    r = run_sweep(repo, "--delete", now="2026-02-01")
    assert r.returncode == 0
    assert r.stdout.strip() == "git rm handoffs/2026-01-01-kb-old.md"


def test_table_mode_says_no_flags_when_clean(tmp_path):
    repo = make_repo(tmp_path)
    r = run_sweep(repo, now="2026-01-05")
    assert "No flagged handoffs." in r.stdout
```

### Step 2 — run, confirm failure
```
py -3 -m pytest tests/test_handoffs_sweep.py -q
```
`FileNotFoundError` / nonzero exit — the script doesn't exist yet.

### Step 3 — implement
```python
"""Flag stale/superseded/dead-Load handoffs for a human to delete on ops.

Read-only, always. `--delete` only PRINTS the `git rm handoffs/<file>` lines a boss runs by hand
on the ops branch (CLAUDE.md's coordination-write flow: pull --rebase origin ops, write, push) —
this script never deletes, never writes, never touches git state.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STALE_DAYS = 14
FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z0-9]+)-.+\.md$")
LOAD_HEADING_RE = re.compile(r"^##\s+Load(?:\s+list)?\s*$", re.MULTILINE | re.IGNORECASE)
NEXT_HEADING_RE = re.compile(r"^##\s+")
BACKTICK_PATH_RE = re.compile(r"`([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`")


@dataclass
class Handoff:
    filename: str
    handoff_date: date | None
    scope: str | None
    text: str


def _git(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)


def _now(env: dict) -> date:
    override = (env.get("KB_HANDOFFS_NOW") or "").strip()
    if override:
        return date.fromisoformat(override)
    return datetime.now(timezone.utc).date()


def _ops_handoff_names(root: Path) -> set[str]:
    result = _git(root, "ls-tree", "--name-only", "origin/ops:handoffs")
    if result.returncode != 0:
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip().endswith(".md")}


def _local_handoff_names(root: Path) -> set[str]:
    d = root / "handoffs"
    if not d.is_dir():
        return set()
    return {p.name for p in d.glob("*.md")}


def _read_handoff_text(root: Path, filename: str) -> str:
    local = root / "handoffs" / filename
    if local.is_file():
        try:
            return local.read_text(encoding="utf-8")
        except OSError:
            return ""
    result = _git(root, "show", f"origin/ops:handoffs/{filename}")
    return result.stdout if result.returncode == 0 else ""


def collect_handoffs(root: Path) -> list[Handoff]:
    names = sorted((_ops_handoff_names(root) | _local_handoff_names(root)) - {"README.md"})
    out = []
    for name in names:
        m = FILENAME_RE.match(name)
        handoff_date = date.fromisoformat(m.group(1)) if m else None
        scope = m.group(2) if m else None
        out.append(Handoff(filename=name, handoff_date=handoff_date, scope=scope, text=_read_handoff_text(root, name)))
    return out


def _load_paths(text: str) -> list[str]:
    m = LOAD_HEADING_RE.search(text)
    if not m:
        return []
    rest = text[m.end():]
    nxt = NEXT_HEADING_RE.search(rest)
    body = rest[: nxt.start()] if nxt else rest
    return BACKTICK_PATH_RE.findall(body)


def _path_exists_on_ops_or_main(root: Path, rel_path: str) -> bool:
    for ref in ("origin/ops", "origin/main"):
        if _git(root, "cat-file", "-e", f"{ref}:{rel_path}").returncode == 0:
            return True
    # A path good only in the WORKING TREE (not yet pushed to either ref, e.g. this very repo
    # during local development) still counts as real -- cat-file only sees committed refs.
    return (root / rel_path).exists()


def flag(root: Path, handoffs: list[Handoff], today: date) -> list[dict]:
    by_scope: dict[str, list[Handoff]] = {}
    for h in handoffs:
        if h.scope:
            by_scope.setdefault(h.scope, []).append(h)

    flags: list[dict] = []
    for h in handoffs:
        reasons: list[str] = []
        if h.handoff_date is not None:
            age_days = (today - h.handoff_date).days
            if age_days > STALE_DAYS:
                reasons.append(f"{age_days} days old (> {STALE_DAYS})")
        if h.scope and h.handoff_date:
            newer = [
                o for o in by_scope[h.scope]
                if o.filename != h.filename and o.handoff_date and o.handoff_date > h.handoff_date
            ]
            if newer:
                latest = sorted(newer, key=lambda o: o.handoff_date)[-1]
                reasons.append(f"superseded by {latest.filename}")
        dead = [p for p in _load_paths(h.text) if not _path_exists_on_ops_or_main(root, p)]
        if dead:
            reasons.append("dead Load path(s): " + ", ".join(dead))
        if reasons:
            flags.append({"file": h.filename, "reasons": reasons, "reason": "; ".join(reasons)})
    return flags


def render_table(flags: list[dict]) -> str:
    if not flags:
        return "No flagged handoffs."
    width = max(len(f["file"]) for f in flags)
    return "\n".join(f["file"].ljust(width) + "  " + f["reason"] for f in flags)


def render_delete(flags: list[dict]) -> str:
    return "\n".join(f"git rm handoffs/{f['file']}" for f in flags)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(REPO_ROOT))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--delete", action="store_true")
    args = parser.parse_args(argv)

    root = Path(args.root)
    today = _now(os.environ)
    handoffs = collect_handoffs(root)
    flags = flag(root, handoffs, today)

    if args.json:
        print(json.dumps(flags))
    elif args.delete:
        print(render_delete(flags))
    else:
        print(render_table(flags))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### Step 4 — run, confirm green
```
py -3 -m pytest tests/test_handoffs_sweep.py -q
```

### Step 5 — commit
```
git add scripts/handoffs_sweep.py tests/test_handoffs_sweep.py
git commit -m "feat(scripts): handoffs_sweep — flag stale/superseded/dead-Load handoffs, read-only"
```

---

## Task 5 — `scripts/project_frame_lint.py`

### Files
- Create `scripts/project_frame_lint.py`
- Create `tests/test_project_frame_lint.py`

### Interfaces
```python
def check_goal(path: Path) -> list[str]
def check_state(path: Path) -> list[str]
def lint(root: Path) -> list[str]
def main(argv: list[str] | None = None) -> int
```

### Step 1 — failing tests
```python
import subprocess
import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "project_frame_lint.py"


def run_lint(root):
    return subprocess.run(["python", str(SCRIPT), "--root", str(root)], capture_output=True, text=True)


def _write(root, project, goal_body, state_body):
    d = root / "orgs" / project
    d.mkdir(parents=True)
    (d / "GOAL.md").write_text(goal_body, encoding="utf-8")
    (d / "STATE.md").write_text(state_body, encoding="utf-8")


GOOD_GOAL = textwrap.dedent("""\
    # demo — GOAL
    _Ruled: 2026-09-01_
    ## North star
    Ship it.
    ## Success conditions
    Tests pass.
    ## Invariants
    Never spend real money.
    ## Governing docs
    docs/x.md
    """)

GOOD_STATE = textwrap.dedent("""\
    # demo — STATE
    _Updated: 2026-09-10 12:00_
    ## Now
    running
    ## Current gate
    review
    ## Next
    ship
    ## Blocked
    None
    ## Findings
    none yet
    ## Infra
    n/a
    """)


def test_well_formed_pair_passes(tmp_path):
    _write(tmp_path, "demo", GOOD_GOAL, GOOD_STATE)
    r = run_lint(tmp_path)
    assert r.returncode == 0, r.stdout


def test_missing_heading_fails(tmp_path):
    bad_goal = GOOD_GOAL.replace("## Invariants\nNever spend real money.\n", "")
    _write(tmp_path, "demo", bad_goal, GOOD_STATE)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "missing ## Invariants" in r.stdout


def test_malformed_updated_line_fails(tmp_path):
    bad_state = GOOD_STATE.replace("_Updated: 2026-09-10 12:00_", "_Updated: whenever_")
    _write(tmp_path, "demo", GOOD_GOAL, bad_state)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "_Updated:_" in r.stdout


def test_state_over_60_lines_fails(tmp_path):
    bloated = GOOD_STATE + ("filler\n" * 60)
    _write(tmp_path, "demo", GOOD_GOAL, bloated)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "max" in r.stdout


def test_no_org_files_is_not_a_failure(tmp_path):
    (tmp_path / "orgs").mkdir()
    r = run_lint(tmp_path)
    assert r.returncode == 0
```

### Step 2 — run, confirm failure

### Step 3 — implement
```python
"""Validate every orgs/*/GOAL.md and orgs/*/STATE.md against the project-frame required shape.

Read-only. Exits 1 with one line per problem the moment any tracked GOAL.md/STATE.md fails a
check; exits 0 (including when zero such files exist -- an org that has not adopted the frame yet
is not a lint failure, only a malformed file that DOES exist is).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

GOAL_HEADINGS = ["North star", "Success conditions", "Invariants", "Governing docs"]
STATE_HEADINGS = ["Now", "Current gate", "Next", "Blocked", "Findings", "Infra"]
STATE_MAX_LINES = 60
GOAL_MAX_LINES = 80
RULED_RE = re.compile(r"^_Ruled:\s*\d{4}-\d{2}-\d{2}_?\s*$", re.MULTILINE)
UPDATED_RE = re.compile(r"^_Updated:\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?_?\s*$", re.MULTILINE)
HEADING_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)


def _missing_headings(text: str, wanted: list[str]) -> list[str]:
    have = set(HEADING_RE.findall(text))
    return [h for h in wanted if h not in have]


def check_goal(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    problems = [f"{path}: missing ## {h}" for h in _missing_headings(text, GOAL_HEADINGS)]
    if not RULED_RE.search(text):
        problems.append(f"{path}: missing or malformed _Ruled:_ line")
    lines = text.splitlines()
    if len(lines) > GOAL_MAX_LINES:
        problems.append(f"{path}: {len(lines)} lines > {GOAL_MAX_LINES} max")
    return problems


def check_state(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    problems = [f"{path}: missing ## {h}" for h in _missing_headings(text, STATE_HEADINGS)]
    if not UPDATED_RE.search(text):
        problems.append(f"{path}: missing or malformed _Updated:_ line")
    lines = text.splitlines()
    if len(lines) > STATE_MAX_LINES:
        problems.append(f"{path}: {len(lines)} lines > {STATE_MAX_LINES} max")
    return problems


def lint(root: Path) -> list[str]:
    problems: list[str] = []
    for goal in sorted(root.glob("orgs/*/GOAL.md")):
        problems.extend(check_goal(goal))
    for state in sorted(root.glob("orgs/*/STATE.md")):
        problems.extend(check_state(state))
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    args = parser.parse_args(argv)
    problems = lint(Path(args.root))
    for line in problems:
        print(line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
```

### Step 4 — run, confirm green
```
py -3 -m pytest tests/test_project_frame_lint.py -q
```

### Step 5 — commit
```
git add scripts/project_frame_lint.py tests/test_project_frame_lint.py
git commit -m "feat(scripts): project_frame_lint — validate orgs/*/GOAL.md and STATE.md shape"
```

---

## Task 6 — `delivery_gate.js` stale-STATE warning

### Files
- Edit `scripts/hooks/delivery_gate.js`
- Edit `tests/test_delivery_gate_hook.py`

### Step 1 — failing tests
Add to `tests/test_delivery_gate_hook.py`:

```python
import json
from datetime import date, timedelta


def _git(root, *args):
    r = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def _project_repo(tmp_path, updated_date):
    repo = tmp_path / "proj"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "checkout", "-q", "-b", "main")
    (repo / "README.md").write_text("x", encoding="utf-8")
    _git(repo, "add", "README.md")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")
    orgs = repo / "orgs" / "prospecting"
    orgs.mkdir(parents=True)
    (orgs / "STATE.md").write_text(f"_Updated: {updated_date}_\n## Now\nx\n", encoding="utf-8")
    _git(repo, "add", "orgs")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed")
    _git(repo, "checkout", "-q", "-b", "claude/prospecting-p8")
    sha = _git(repo, "rev-parse", "HEAD").strip()
    _git(repo, "update-ref", "refs/remotes/origin/ops", sha)
    return repo


def _run_with_event(kb_root, event, extra_env=None):
    env = {**os.environ, "KB_ROOT": str(kb_root), **(extra_env or {})}
    return subprocess.run(["node", str(HOOK)], input=json.dumps(event).encode(), capture_output=True, env=env)


def test_warns_when_active_project_state_is_stale(tmp_path):
    repo = _project_repo(tmp_path, "2020-01-01")
    r = _run_with_event(tmp_path, {"cwd": str(repo)})
    assert r.returncode == 0
    assert b"STATE.md stale" in r.stderr


def test_silent_when_active_project_state_is_fresh(tmp_path):
    repo = _project_repo(tmp_path, date.today().isoformat())
    r = _run_with_event(tmp_path, {"cwd": str(repo)})
    assert r.returncode == 0
    assert b"STATE.md stale" not in r.stderr


def test_silent_when_no_project_resolves(tmp_path):
    r = _run_with_event(tmp_path, {"cwd": str(tmp_path)})
    assert r.returncode == 0
    assert b"STATE.md stale" not in r.stderr
```

### Step 2 — run, confirm failure
The two new positive/negative assertions fail: `delivery_gate.js` today never reads stdin, so no
project resolution or STATE check happens at all.

### Step 3 — implement
Add near the top of `scripts/hooks/delivery_gate.js` (after the existing header comment, before
`function main()`), and call it first inside `main()`. The file stays on its own hand-rolled
stdin idiom deliberately — see its header comment grouping it with the three other blocking-style
hooks that do NOT use `lib/hook_io.js` — but it now reads stdin for the first time:

```js
function readEvent() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function warnStaleState(event, root) {
  try {
    const pf = require("./lib/project_frame.js");
    const cwd = typeof event.cwd === "string" && event.cwd ? event.cwd : root;
    const project = pf.activeProject(event, process.env);
    if (!project) return;
    const stateText = pf.readOpsFile(cwd, `orgs/${project}/STATE.md`, process.env);
    if (!stateText) return;
    const m = /^_Updated:\s*(\d{4}-\d{2}-\d{2})/m.exec(stateText);
    if (!m) return;
    const updatedMs = Date.parse(m[1] + "T00:00:00Z");
    if (!Number.isFinite(updatedMs)) return;
    const ageDays = (Date.now() - updatedMs) / (24 * 60 * 60 * 1000);
    if (ageDays > 3) {
      process.stderr.write(
        `[delivery-gate WARN] orgs/${project}/STATE.md stale (${Math.floor(ageDays)}d) — ` +
          `update before closing. (warn-only; not blocking)\n`
      );
    }
  } catch (_err) {
    // Fail open: an unresolvable project, missing git, or unreadable STATE.md warns about nothing.
  }
}
```

Edit `main()` to compute `root` once and call `warnStaleState` before the existing
`KB_AGENT_ID`-gated early return, since the two warnings are independent:

```js
function main() {
  const root = process.env.KB_ROOT || path.resolve(__dirname, "..", "..");
  warnStaleState(readEvent(), root);

  const agentId = process.env.KB_AGENT_ID;
  if (!agentId) {
    process.exit(0);
  }

  const sessionStart = Number(process.env.KB_SESSION_START);
  if (!Number.isFinite(sessionStart)) {
    process.exit(0);
  }

  const memFile = path.join(root, "memory", `${agentId}.md`);
  ...
```

(the existing memory-mtime logic below is unchanged; `root` is now computed once at the top
instead of redeclared partway through).

### Step 4 — run, confirm green
```
py -3 -m pytest tests/test_delivery_gate_hook.py -q
```
The three pre-existing tests stay green: `run_hook` sets `KB_ROOT` to an empty `tmp_path` with no
`.git`, so `pf.activeProject` fails open to `null` inside the try/catch and `warnStaleState`
returns without writing anything — no `"STATE.md stale"` text ever collides with the existing
`b"WARN" not in r.stderr` assertions.

### Step 5 — commit
```
git add scripts/hooks/delivery_gate.js tests/test_delivery_gate_hook.py
git commit -m "feat(hooks): delivery_gate warns when the active project's STATE.md is stale (3d)"
```

---

## Task 7 — Settings arming + status flips

**This task is a human-reviewable settings edit plus doc updates — no new application code.**
Do this task LAST, only once Tasks 1–6 are green, since several of its assertions require every
file above to already exist at its committed path.

### 7a — `.claude/settings.json`

Replace the file's `hooks` object and add one `env` key. The three existing `PreToolUse` entries
are KEPT verbatim (only a fourth is appended); `context_lifecycle_session_start.js` is
deliberately NOT added anywhere.

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "env": {
    "ECC_DISABLED_HOOKS": "pre:bash:dispatcher,pre:write:doc-file-warning,pre:edit-write:suggest-compact,pre:observe:continuous-learning,pre:governance-capture,pre:config-protection,pre:mcp-health-check,pre:edit-write:gateguard-fact-force,pre:compact,session:start,session-start:plan-canvas-sessions,post:bash:dispatcher,post:quality-gate,post:edit:design-quality-check,post:edit:accumulator,post:edit:console-warn,post:governance-capture,post:session-activity-tracker,post:observe:continuous-learning,post:ecc-metrics-bridge,post:ecc-context-monitor,post:mcp-health-check,stop:format-typecheck,stop:check-console-log,stop:session-end,stop:evaluate-session,stop:cost-tracker,stop:desktop-notify,session:end:marker,pre:bash:block-no-verify,pre:bash:auto-tmux-dev,pre:bash:tmux-reminder,pre:bash:git-push-reminder,pre:bash:commit-quality,pre:bash:gateguard-fact-force,post:bash:command-log-audit,post:bash:command-log-cost,post:bash:pr-created,post:bash:build-complete",
    "ECC_GATEGUARD": "off",
    "CCO_QUIET": "1"
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/project_frame_session_start.js\"" }
        ]
      },
      {
        "matcher": "compact",
        "hooks": [
          { "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/regrounding_hook.js\"" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/regrounding_hook.js\"" }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/context_lifecycle_pre_compact.js\"" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/regrounding_hook.js\"" }
        ]
      },
      {
        "hooks": [
          { "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/context_lifecycle_activity_tracker.js\"" }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/subagent_context_load.js\"" }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/model_verify_subagentstop.js\"" }
        ]
      }
    ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/block_no_verify.js\"" }] },
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/hard_ceiling_guard.js\"" }] },
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/config_protection.js\"" }] },
      { "matcher": "Agent|Task", "hooks": [{ "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/model_verify_pretooluse.js\"" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"C:/Users/danie/kb/scripts/hooks/delivery_gate.js\"" }] }
    ]
  }
}
```

**`CCO_QUIET: "1"` — the prompt-coach disable mechanism.** Investigated directly against the
installed plugin (`C:/Users/danie/.claude/plugins/cache/cco/claude-context-optimizer/4.6.0`):
`hooks/hooks.json` registers `src/prompt-coach.js` on `UserPromptSubmit` with no matcher (fires on
every prompt). Inside `prompt-coach.js`, the ONLY early-exit before it can emit `additionalContext`
is `if (analysis.score >= 80 || isQuietMode()) { process.exit(0); }`, and `isQuietMode()`
(`src/utils.js`) is `process.env.CCO_QUIET === '1' || ... || process.env.CI === 'true'`.
`isQuietMode` is called nowhere else in the plugin — `tracker.js`, `budget.js`, `dashboard.js`,
`read-cache.js`, and `context-shield.js` never reference it, so `CCO_QUIET=1` disables ONLY the
prompt-grading injection, not the plugin's token-tracking or read-cache behavior. This is a plain
env var, not a plugin config file, so it is set the same way `ECC_DISABLED_HOOKS`/`ECC_GATEGUARD`
already are: in this project-scope `.claude/settings.json`'s `env` block. **Scoping caveat, stated
explicitly per the dispatch brief's instruction:** `.claude/settings.json` is a tracked file, so
this only takes effect in a session whose cwd resolves to a checkout that HAS this edit — the main
kb checkout once this merges to `main`, and any worktree cut from (or rebased/merged onto) a
commit at or after that merge. A worktree cut from an older `main` commit will not see it until it
picks up the new commit. No global (`~/.claude/settings.json`) edit is made — keep-awake there is
untouched, per CLAUDE.md's git-hygiene rule against touching that file.

### 7b — `tests/test_context_lifecycle_inert.py` — armed/still-inert split

Replace the whole file:

```python
"""Acceptance guard for the U7/U8 hook family after project-frame arming (2026-09-11).

Three of these files are now ARMED (regrounding_hook.js, context_lifecycle_pre_compact.js,
context_lifecycle_activity_tracker.js — see docs/superpowers/plans/2026-09-11-project-frame-hooks.md
Task 7). Two remain INERT: context_lifecycle_session_start.js (project_frame_session_start.js now
owns SessionStart injection) and the lib file context_store.js (never itself a registered command).
This file's job shifts from "prove nothing is armed" to "prove exactly the right split holds".
"""
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOKS = REPO / "scripts" / "hooks"
SETTINGS = REPO / ".claude" / "settings.json"

ARMED = [
    HOOKS / "regrounding_hook.js",
    HOOKS / "context_lifecycle_pre_compact.js",
    HOOKS / "context_lifecycle_activity_tracker.js",
]
STILL_INERT = [
    HOOKS / "context_lifecycle_session_start.js",
    HOOKS / "lib" / "context_store.js",
]
FAMILY = ARMED + STILL_INERT


def test_armed_members_are_registered_exactly_once_at_the_committed_path():
    text = SETTINGS.read_text(encoding="utf-8")
    for path in ARMED:
        needle = f"C:/Users/danie/kb/scripts/hooks/{path.name}"
        assert text.count(needle) == 1, path.name


def test_still_inert_members_are_registered_nowhere():
    for settings in (REPO / ".claude").glob("settings*.json"):
        text = settings.read_text(encoding="utf-8")
        for path in STILL_INERT:
            assert path.stem not in text, (settings.name, path.stem)


def test_no_gateguard_reached_scripts_hooks_through_this_unit():
    """GateGuard is the ECC subsystem this reclaim DROPPED (`ECC_GATEGUARD: off`). No file in this
    family, armed or not, may mention it except the two pre-existing legitimate citations."""
    allowed = {HOOKS / "hard_ceiling_guard.js", HOOKS / "lib" / "destructive_classifier.js"}
    hits = {
        path
        for path in HOOKS.rglob("*")
        if path.is_file() and "gateguard" in path.read_text(encoding="utf-8", errors="replace").lower()
    }
    assert hits <= allowed
    assert not (hits & set(FAMILY))


def test_armed_members_declare_armed_and_the_rest_declare_inert():
    for path in ARMED:
        assert "ARMED" in path.read_text(encoding="utf-8"), path
    for path in STILL_INERT:
        assert "INERT" in path.read_text(encoding="utf-8"), path
```

Update the file headers accordingly: `regrounding_hook.js`, `context_lifecycle_pre_compact.js`,
and `context_lifecycle_activity_tracker.js` each get their `INERT (not wired into any settings
file)` phrase in the docstring/header replaced with `ARMED 2026-09-11 — see
docs/superpowers/plans/2026-09-11-project-frame-hooks.md Task 7.` `context_lifecycle_session_start.js`
keeps its existing `INERT` header unchanged.

### 7c — `tests/test_model_verify.py` — U9 inert→armed

Replace `test_the_u9_hook_family_is_inert` and `test_every_new_hook_declares_itself_inert` with:

```python
def test_the_u9_model_hooks_are_armed_at_the_committed_path():
    """Acceptance condition after arming (2026-09-11): each hook registered exactly once at its
    committed absolute path, and governance/ stays untouched (these hooks only read it)."""
    settings = (REPO / ".claude" / "settings.json").read_text(encoding="utf-8")
    for name in ("subagent_context_load.js", "model_verify_pretooluse.js", "model_verify_subagentstop.js"):
        needle = f"C:/Users/danie/kb/scripts/hooks/{name}"
        assert settings.count(needle) == 1, name
    assert "Agent|Task" in settings

    def git(*args):
        result = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        return result.stdout

    assert git("status", "--porcelain", "--", "governance/").strip() == ""


def test_armed_hooks_declare_armed():
    for name in ("subagent_context_load.js", "model_verify_pretooluse.js", "model_verify_subagentstop.js"):
        text = (HOOKS / name).read_text(encoding="utf-8")
        assert "ARMED" in text, name
        assert "INERT. Nothing in" not in text, name
```

Update the three hook files' headers (`subagent_context_load.js`, `model_verify_pretooluse.js`,
`model_verify_subagentstop.js`): replace `Status:\n *   INERT. Nothing in .claude/settings*.json
references this file...` with `Status:\n *   ARMED 2026-09-11 — see
docs/superpowers/plans/2026-09-11-project-frame-hooks.md Task 7.`

### 7d — Proposal doc status lines

- `docs/proposals/regrounding-hook.md`: `**Status:** PROPOSAL — inert, NOT wired into any live
  settings file.` → `**Status:** ARMED 2026-09-11 — SessionStart (matcher "compact"),
  UserPromptSubmit, and PostToolUse all registered per
  docs/superpowers/plans/2026-09-11-project-frame-hooks.md Task 7. The default source is now the
  session's context store, not the static plan file described below — see Task 3 of that plan.`
- `docs/proposals/context-lifecycle-hooks.md`: `**Status:** PROPOSAL — inert, NOT wired into any
  live settings file.` → `**Status:** PARTIALLY ARMED 2026-09-11 — PreCompact and PostToolUse
  (activity tracker) registered; `context_lifecycle_session_start.js` remains INERT because
  `project_frame_session_start.js` now owns SessionStart injection (writes `## North star`,
  `## Invariants`, `## Current gate` from live GOAL.md/STATE.md — the "nothing writes them today"
  caveat below no longer holds). See docs/superpowers/plans/2026-09-11-project-frame-hooks.md
  Task 7.`
- `docs/proposals/spawn-model-verify-hooks.md`: `**Status:** PROPOSAL — inert, NOT wired into any
  live settings file.` → `**Status:** ARMED 2026-09-11 — SubagentStart, PreToolUse (matcher
  "Agent|Task"), and SubagentStop all registered per
  docs/superpowers/plans/2026-09-11-project-frame-hooks.md Task 7. The "SubagentStart hook has
  nothing to inject today" caveat below no longer holds now that
  `project_frame_session_start.js` writes the governing sections.`

### 7e — `handoffs/README.md` rule line

In the `## Lifecycle` section's deletion-conditions bullet list, add a third bullet after the
existing two:

```markdown
- the work it describes is completed, or
- a terminal picks it up to resume the work — the picker deletes it on pickup.
  If the picker later pauses before finishing, it writes a NEW dated handoff.
- a handoff flagged by `scripts/handoffs_sweep.py` is deleted at the next boss session close.
```

### Step — run everything, confirm green
```
py -3 -m pytest tests/test_context_lifecycle_inert.py tests/test_model_verify.py tests/test_kb_hook_settings.py -q
```

### Commit
```
git add .claude/settings.json handoffs/README.md \
  docs/proposals/regrounding-hook.md docs/proposals/context-lifecycle-hooks.md docs/proposals/spawn-model-verify-hooks.md \
  scripts/hooks/regrounding_hook.js scripts/hooks/context_lifecycle_pre_compact.js scripts/hooks/context_lifecycle_activity_tracker.js \
  scripts/hooks/subagent_context_load.js scripts/hooks/model_verify_pretooluse.js scripts/hooks/model_verify_subagentstop.js \
  tests/test_context_lifecycle_inert.py tests/test_model_verify.py
git commit -m "chore(hooks): arm project-frame + U7/U8/U9 hook family; disable cco prompt-coach in kb sessions"
```

**This settings edit is Daniel's to make** (per CLAUDE.md, `.claude/settings.json` is not
off-limits to edit generally, but hooks config changes of this size should be presented to him
before landing — surface the diff at this task's gate rather than committing unattended).

---

## Task 8 — Verification

### Full test run
```
py -3 -m pytest \
  tests/test_project_frame.py \
  tests/test_project_frame_session_start.py \
  tests/test_regrounding_hook.py \
  tests/test_handoffs_sweep.py \
  tests/test_project_frame_lint.py \
  tests/test_delivery_gate_hook.py \
  tests/test_context_lifecycle_inert.py \
  tests/test_model_verify.py \
  tests/test_context_store.py \
  tests/test_kb_hook_settings.py \
  -v
```
All green is the acceptance bar for this plan's code. The 5-second wall-clock assertion is already
embedded as `test_session_start_completes_within_five_seconds` in
`tests/test_project_frame_session_start.py` (Task 2, Step 1) — it is not a separate script.

### Manual live check (PowerShell, from the repo root)
Run this AFTER Task 7 lands (the hook must exist at its committed absolute path for a real
harness-driven session to pick it up; this manual check drives the hook directly, so it works
even before that, but the goal is to also see it fire in a real session once armed):

```powershell
$event = @{
  hook_event_name = "SessionStart"
  source = "startup"
  session_id = "live-check-prospecting-p8"
  cwd = "C:/Users/danie/kb-worktrees/prospecting-p8"
} | ConvertTo-Json -Compress

$env:KB_CONTEXT_STORE_DIR = "$env:TEMP\project-frame-live-check"
$out = $event | node "C:/Users/danie/kb/scripts/hooks/project_frame_session_start.js"
$out
if ($out -match "prospecting") { "PASS: payload names prospecting" } else { "FAIL: prospecting not found in payload" }
Remove-Item -Recurse -Force $env:KB_CONTEXT_STORE_DIR
Remove-Item Env:\KB_CONTEXT_STORE_DIR
```

Confirm the printed JSON's `additionalContext` contains `prospecting` (the project resolved from
`kb-worktrees/prospecting-p8`'s checked-out branch) and a `PREAMBLE` line. If it does not: check
that `C:/Users/danie/kb-worktrees/prospecting-p8` is on a branch shaped like `<agent>/prospecting...`,
and that `git -C C:/Users/danie/kb-worktrees/prospecting-p8 show origin/ops:orgs` lists
`prospecting` (it does, per the fact-gathering for this plan — `git ls-tree -d --name-only
origin/ops:orgs` returned `atlas`, `faceless-youtube`, `kb-ops`, `prospecting`).

### Second live check — subagent inheritance (after Task 7)
Dispatch one haiku subagent from a session with an active project frame; confirm
`%LOCALAPPDATA%\kb-context-lifecycle\model-audit.jsonl` gains a `PreToolUse` row (verdict field
populated) and a paired `SubagentStop` row, and that the subagent's own transcript shows the
`[kb spawn context]` guard line with a non-empty `North star`/`Invariants`/`Current gate` block —
this is only possible now that `project_frame_session_start.js` is the writer U9's own proposal
flagged as missing ("The SubagentStart hook has nothing to inject today").

---

## Self-review

### Spec coverage table

| Spec section | Plan task(s) |
| --- | --- |
| §1 The three surfaces (GOAL.md/STATE.md/handoffs shape) | Task 5 (lint enforces the shape); content creation itself is explicitly out of this plan's code scope (§6, boss work on ops) |
| §2 Resolver `project_frame.js` (`activeProject`, `readOpsFile`, `frame` + 4 modes + budgets, GUARD_LINE first) | Task 1 |
| §3 New SessionStart hook (preamble, resolve, write store, emit full/rollup, append sweep flags) | Task 2 |
| §3 One edit to U7 (store default source, `WANTED_SECTIONS` + Current gate) | Task 3 |
| §3 Armed as-is (U8 PreCompact/PostToolUse, U9 SubagentStart/PreToolUse/SubagentStop) | Task 7a |
| §3 Stop hook stale-STATE warning | Task 6 |
| §3 Removed from boss sessions (prompt-coach) | Task 7a |
| §3 Settings change (merge, absolute paths, sync latency) | Task 7a, Task 8 (5s test) |
| §4 Handoff sweep (`handoffs_sweep.py`, flags, table/json/delete, README rule) | Task 4, Task 7e |
| §5 Lint (`project_frame_lint.py`) | Task 5 |
| §6 Content (GOAL.md/STATE.md for prospecting/figment/kb-ops/faceless-youtube, first sweep run) | Explicitly OUT of this plan's code tasks — boss work on `ops`, listed here only for traceability |
| §7 Tests (all seven bullets) | Tasks 1, 2, 3, 4, 5, 7b, 7c; live checks in Task 8 |
| §8 Out of scope (cross-agent sharing, model-shelling hooks, blocking dispatches, CLAUDE.md edit) | Respected — no task in this plan touches `CLAUDE.md`/`governance/`, adds a blocking exit path, or shares context beyond the existing per-session store |

### Placeholder scan
No `TBD`, `similar to task N`, or `add error handling` placeholders appear in any code step above
— every function body is complete, real code. (The one intentionally-elided block, in Task 3's
walkthrough of `loadBlock`'s edit, is explicitly superseded two paragraphs later by the final
`defaultSourcePath`/`loadBlock` pair that IS the real, final code — flagged there as a
"rather than reach for..." rewrite, not left as a stub.)

### Name consistency check
- `project_frame.js` exports (`activeProject`, `readOpsFile`, `listProjects`, `parseSections`,
  `frame`, `MODE_BUDGETS`, plus `projectHandoffs`/`loadListFor` added in Task 1 Step 7) are used
  with those exact names in Task 2 (`project_frame_session_start.js`) and Task 6
  (`delivery_gate.js`).
- `MODE_BUDGETS` keys (`full`, `reground`, `subagent`, `rollup`) match the spec's four mode names
  and the Global Constraints budgets (7000/1700/2500/1500) exactly.
- `store.HEADINGS.NORTH_STAR`/`INVARIANTS`/`CURRENT_GATE`/`RESUMED_SUMMARY` (from the existing
  `context_store.js`) are the only heading constants used to write/read the store in Tasks 2 and
  3 — no new heading spelling is invented.
- Hook filenames in Task 7a's settings snippet match the filenames created/edited in Tasks 1–6
  exactly, including case.

### Ambiguities resolved (not in the spec verbatim, decided here)

1. **`frame()`'s `reground` and `subagent` modes have no direct caller in this plan.**
   `project_frame_session_start.js` only ever calls `frame()` with `mode: "full"` or `"rollup"`
   (§3 point 4 says so explicitly); U7's re-grounding after the Task 3 edit reads the session
   store directly, not through `frame('reground', ...)`, and U9's `subagent_context_load.js` reads
   the store directly too, unchanged in this plan. Rather than either drop the two modes (a scope
   reduction the spec doesn't authorize — §2 defines all four with budgets) or invent a caller the
   spec never asked for, both modes are implemented in `frame()` per §2's literal section lists
   and budgets, and tested directly in `tests/test_project_frame.py` (Task 1). They are library
   capabilities today, not wired into any hook's runtime path — exactly analogous to how U8's own
   proposal shipped a store format before anything wrote to three of its five headings.
2. **`frame()`'s handoff-filenames-and-Load-lists (full mode, §2) vs. the handoff SWEEP's flag
   lines (§3 point 5) are two different features**, resolved by splitting them: `frame('full', …)`
   itself reads the PROJECT's own matching handoff files from the working tree and inlines their
   Load lists (Task 1, `projectHandoffs`/`loadListFor`); the project-agnostic stale/superseded/
   dead-path flags from `handoffs_sweep.py --json` are appended separately by
   `project_frame_session_start.js` (Task 2) after `frame()` returns, per §3 point 5's exact
   wording ("Appends the handoff sweep's flag lines... to the payload").
3. **Project-id-to-handoff-scope mapping.** `orgs/` directory names and handoff filename scope
   tokens disagree for one project today (`faceless-youtube` vs. the `fyt` scope token
   `handoffs/README.md` documents). `project_frame.js` carries one explicit alias
   (`HANDOFF_SCOPE_ALIASES`), not a general slugification — extend the table if more diverge.
4. **`readOpsFile`'s 32 KiB cap is applied to the decoded string, not a pre-read byte stat** (unlike
   `hook_io.readCappedFile`'s filesystem-stat-first approach), because `git show` output has no
   file to stat in advance — the full output is already in memory by the time the cap can apply.
   Acceptable at this size; noted rather than silently diverging from the `readCappedFile`
   convention without explanation.
5. **`handoffs_sweep.py`'s dead-Load-path check also accepts a working-tree-only path** (not just
   `origin/ops`/`origin/main`) so the sweep is usable against an uncommitted, in-progress handoff
   during local development — the spec says "no longer exists on origin/ops or origin/main", which
   this satisfies as a superset (a path good on either ref always passes; a path good ONLY in the
   working tree is the one case this plan is more lenient than a literal reading, and is called
   out here rather than left implicit).

### What in the existing code contradicts the spec

- `regrounding_hook.js`'s current default source is a **dead path**
  (`docs/plans/2026-08-18-agent-platform-GOAL-STATE.md`) that the spec's Task 3 edit removes
  entirely rather than keeping as a final fallback — confirmed during research that the spec
  intends full replacement ("Default source... becomes the session's store file... instead of the
  dead August plan"), not a fallback chain.
- The **existing `orgs/*/STATE.md` files do not conform** to the spec's required shape (e.g.
  `orgs/kb-ops/STATE.md` has only `## Now`/`## Next`/`## Blocked`, no `## Current gate` /
  `## Findings` / `## Infra`, and `_Updated: 2026-07-16_` has no `HH:MM`). `project_frame_lint.py`
  (Task 5) will fail against the live `orgs/` tree today — this is expected and intentional: §6
  content work (writing conforming GOAL.md/STATE.md for each project) is explicitly boss work on
  `ops`, out of this plan's code tasks, and the lint script's own tests run against fixture
  directories, not the live tree.
- `orgs/` in this worktree's checkout currently has `atlas-prep` where `origin/ops` has `atlas`
  (confirmed via `git ls-tree -d --name-only origin/ops:orgs`). `listProjects()` reads from
  `origin/ops` first specifically because of this drift; the working-tree fallback only fires when
  the git-show path fails outright, so this id mismatch does not affect `activeProject`'s normal
  path. The spec itself flags this split as "noted, not fixed" (§6).
