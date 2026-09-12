# Token discipline — implementation plan (2026-09-11)

**For agentic workers:** execute tasks in order. Each task is TDD: write the failing test, run
it (confirm the failure reason, not just "red"), implement, run again (confirm green), commit.
Task 1 must land before Task 3 (context_guard reads the "Session model" note Task 1's edit to
`project_frame_session_start.js` — shared with Task 3 — writes). Task 6 must land LAST: it deletes
files Tasks 0–5 do not touch, but its "no dangling reference" check should run after every other
edit exists, so a reference introduced by an earlier task is caught too.

**Goal:** cut subscription-token burn on this machine by shrinking what every turn re-sends,
without losing decisions, rulings, or subagent continuity, and make the burn visible at every
session start. Success (spec's own, verbatim) = (a) a boss session's average context per turn
stays under 150k after a reset boundary; (b) no single tool result over 50 KB enters a Fable/Opus
context; (c) yesterday's Claude + Codex token totals appear in the SessionStart frame; (d) the
repo is smaller after this PR than before it.

**Architecture:** five levers, each independently landable, sharing two existing pieces of
infrastructure rather than duplicating them: `lib/context_store.js` (the per-session store —
`readStore`/`updateStore`/`upsertSection`/`withStoreLock`) and `lib/project_frame.js` (`frame()`,
`readOpsFile`, `sectionBodyByPrefix`) plus the SessionStart hook that already writes into that
store, `project_frame_session_start.js`. L1 (measure) adds one new stdlib script
(`scripts/usage_ledger.py`) that never runs from a hook directly — the hook only reads its output
file — and one new frame line. L2 (reset) is mostly a settings value, a required heading, and a
handful of text edits; nothing new to test beyond the heading and the frame line. L3 (guard) adds
one new PreToolUse hook (`scripts/hooks/context_guard.js`) in the OLDER exit-code idiom
(`hard_ceiling_guard.js`'s style, not `lib/hook_io.js`'s always-exit-0 style — this hook must be
able to say no) plus a Daniel-owned rules file parsed by a hand-rolled scanner, the same pattern
`lib/model_audit.js` already uses for `governance/model-routing.yaml`. L4 (load context) is one
frontmatter edit plus documentation of what does not apply and why. L5 (turns) is two small,
additive changes to the existing `scripts/codex_dispatch.py` dispatcher. Cleanup removes four
files this repo has already superseded and repairs every reference to them.

**Tech stack:** Node ≥ 18 CommonJS hooks, no dependencies (hooks run on whatever `node` the
harness has — this is why `context_guard.rules.yaml` is parsed by a small hand-rolled scanner,
not a YAML library: see `lib/model_audit.js`'s `parseAllowedModels` for the established
precedent). Python 3 stdlib scripts (`py -3` on this Windows host, `python` fallback, matching
`project_frame_session_start.js`'s `runPython`). pytest driving the Node hooks via
`subprocess.run(["node", HOOK], input=json, env=...)`, the same idiom as
`tests/test_hard_ceiling_guard.py` and `tests/test_project_frame_session_start.py`.

**Spec:** `docs/superpowers/specs/2026-09-11-token-discipline-design.md` — implemented exactly as
written, with the override already ruled in this brief (context-guard's rule file lives at
`scripts/hooks/context_guard.rules.yaml`, NOT under `governance/`, because `governance/` is
human-edited only per the constitution and this file is meant to be tuned without a human
committing YAML). Evidence: `docs/superpowers/specs/2026-09-11-token-discipline-evidence/`
(`usage-analysis-2026-09-06-to-11.md` tables A–G, `tooling-research.md`, and the throwaway
`analyze_tokens.py` prototype — its Claude/Codex JSONL parsing logic is mined directly into
`usage_ledger.py` below, not reimplemented from scratch).

## Global constraints (copied/derived from the spec, binding on every task)

- **Fail open everywhere**, except context_guard's deliberate exit-2 denials. Every hook: any
  unhandled error → `{}` / exit 0 / empty stderr. The one exception carries a one-line fix
  instruction on stderr and exits 2 — never anything else.
- **Ruling 1 (measure only):** nothing in this plan warns or blocks based on token counts, cost,
  or context size, except the two named context_guard denial classes, which exist independently
  of the measurement lever (they were already in the spec's L3 before any ledger existed).
- **Ruling 2 (MCP):** no server is removed, renamed, or reconfigured globally. The only MCP
  change anywhere in this plan is one per-agent `mcpServers: []` restriction (Task 4), applied
  only where a native Claude Code agent definition already exists and demonstrably uses no MCP
  tool.
- **Ruling 3 (Codex tiers):** `gpt-6-astra` stays the interactive boss terminal's model —
  nothing in this plan touches how the boss's own interactive codex session is invoked. Only
  `scripts/codex_dispatch.py` (background child dispatch) changes.
- **Ruling 4 (boundary, never mid-loop):** the 150k boundary is a human/boss judgment call at a
  task boundary, not a hook — no code in this plan tries to interrupt a running turn.
- **Ruling 5 (cleanup):** Task 6 deletes only files nothing functional or future-facing depends
  on, as reviewable hunks, each one checked for references first.
- **No network calls anywhere in this plan's code**, except `git fetch origin ops` /
  `git push origin HEAD:refs/heads/ops` inside `usage_ledger.py`'s ops-publish path (same
  operation `scripts/codex_dispatch.py:publish_ops` already performs) and whatever the untouched
  `codex`/`git` binaries do on their own.
- **Every new/edited hook stays registered by absolute path** in `.claude/settings.json` per the
  existing convention (`C:/Users/danie/kb/scripts/hooks/<file>.js`) — this plan never relativizes
  a hook path. Settings edits are DESCRIBED in this plan (exact JSON to add) but never applied by
  this plan's own execution — `.claude/settings.json` is out of scope for this worktree's edits
  per the dispatch brief; Task 7 lists the settings diff for Daniel/boss to apply by hand, the
  same way `governance/`- and `CLAUDE.md`/`BOSS.md`-adjacent asks are delivered as proposed diffs.
- **`governance/` and `CLAUDE.md`/`BOSS.md` are human-edited only.** Every ask that would
  normally touch one of those is instead written to a proposed-diff file under
  `docs/superpowers/specs/2026-09-11-token-discipline-evidence/` for Daniel to apply.

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `docs/superpowers/specs/2026-09-11-token-discipline-evidence/task0-probes.md` | NEW | Task 0's recorded probe results. |
| `scripts/usage_ledger.py` | NEW | Daily Claude+Codex token/cost ledger; stdlib, streams JSONL, publishes to ops. |
| `tests/test_usage_ledger.py` | NEW | Fixture-driven tests for the ledger's parsing, idempotency, and CLI. |
| `scripts/preamble.py` | EDIT | Runs `usage_ledger.py` once/day (5 s budget, fail-open) when yesterday's file is missing. |
| `scripts/hooks/project_frame_session_start.js` | EDIT | Appends `## Usage (yesterday)`; writes the `## Session model` note from `event.model`. |
| `tests/test_project_frame_session_start.py` | EDIT | New tests for the Usage line and the Session-model note. |
| `.claude/settings.json` | DESCRIBED, not applied | Add `autoCompactWindow`; arm `context_guard.js`. |
| `scripts/hooks/lib/project_frame.js` | EDIT | `full` and `rollup` modes surface `## Decisions`. |
| `scripts/project_frame_lint.py` | EDIT | `STATE_HEADINGS` gains `Decisions`. |
| `tests/test_project_frame_lint.py` | EDIT | New pass/fail tests for the `Decisions` heading. |
| `skills/curated/save-session/SKILL.md` (synced to `.claude/skills/`, `.agents/skills/` via `scripts/sync_skills.py`) | EDIT | New step: delete the superseded same-scope handoff at write time. |
| `docs/superpowers/specs/2026-09-11-token-discipline-evidence/proposed-BOSS-CLAUDE-diff.md` | NEW | Four proposed BOSS.md hunks (150k boundary rule, brief-rule pointer, BOSS.md trim, MEMORY.md collapse instruction) for Daniel to apply. |
| `scripts/hooks/context_guard.js` | NEW | PreToolUse `Read\|Bash` guard — exit-2 idiom, fail-open elsewhere. |
| `scripts/hooks/context_guard.rules.yaml` | NEW | Daniel-owned rule config; hand-parsed (no YAML dependency). |
| `tests/test_context_guard.py` | NEW | Allow/deny tests per rule, fail-open tests, config-shape pin. |
| `docs/runbooks/subagent-brief-rules.md` | NEW | The one brief-rule text, referenced from both dispatch templates and the BOSS.md diff. |
| `skills/curated/dispatch-codex/SKILL.md` | EDIT | Documents the brief rule, the new effort default, and the follow-up hop limit. |
| `.claude/agents/fyt-runner.md` | EDIT | Adds `mcpServers: []` (the only native agent definition; uses no MCP tool). |
| `scripts/codex_dispatch.py` | EDIT | Default `--effort medium`; `--follow-up` hop counter, refuses past 2 hops. |
| `tests/test_codex_dispatch.py` | EDIT | New tests for the effort default and the hop limit. |
| `docs/plans/2026-08-18-agent-platform-GOAL-STATE.md` | DELETE | Dead U7 default source, already replaced by the session store. |
| `docs/proposals/regrounding-hook.md`, `context-lifecycle-hooks.md`, `spawn-model-verify-hooks.md` | DELETE | Superseded by `docs/superpowers/specs/2026-09-11-project-frame-hooks-design.md` (ARMED); their arm-time-check content is already permanent there (line 134) and in that plan's Task 8 — nothing to fold forward. |
| `tests/fixtures/regrounding-source-fixture.md` | NEW | Replaces the deleted GOAL-STATE doc as `tests/test_regrounding_hook.py`'s override-target fixture. |
| `tests/test_regrounding_hook.py`, 7 hook/lib `.js` doc-comments, 2 more test `.py` doc-comments | EDIT | Repoint dead-path references at the surviving design spec. |
| `tests/test_cleanup_no_dangling_refs.py` | NEW | Fails if any committed, non-archival file still names a deleted path. |

---

## Task 0 — Probes (no product code)

Four empirical/research probes, each cheap, run from this worktree (no branches, no commits, no
subagents — run them directly). Output: a single new file,
`docs/superpowers/specs/2026-09-11-token-discipline-evidence/task0-probes.md`, with one section
per probe below, each ending in a one-line verdict a later task can cite.

### Probe A — load-context breakdown

1. Start a **fresh** `claude` session in this repo (no `--resume`, no `--continue`).
2. On turn 1, run `/context` (or, if unavailable in this build, run the `cco-overhead` skill —
   `claude-context-optimizer:cco-overhead` — which derives the same breakdown from real
   transcript usage per its own description).
3. Record the reported categories and their token counts verbatim (system prompt, tool
   definitions/MCP schemas, CLAUDE.md, memory, skill list, anything else `/context` names).
4. Compute: fixed load = sum of every category except the live conversation. Compare against the
   evidence doc's existing estimate ("~67k tokens at turn 1", §1 of the design spec) — confirm or
   correct that number with today's real reading.

Record in `task0-probes.md`: the full `/context` (or `cco-overhead`) output, the computed fixed
total, and the delta vs. the spec's ~67k estimate.

### Probe B — Codex compaction + per-run effort override

1. Run `codex --help` and `codex exec --help` (or `codex exec resume --help`) from a terminal on
   this machine. Capture full stdout.
2. Grep the captured output for `compact`, `reasoning`, `effort`, `model_reasoning_effort`.
3. Cross-check against what `scripts/codex_dispatch.py` already assumes: it passes
   `-c model_reasoning_effort=<value>` (see `spawn()`, and `EFFORTS = ("low", "medium", "high",
   "xhigh", "max")`) — confirm those five values are still accepted, and confirm whether `codex
   exec` documents ANY compaction-equivalent flag (if none exists, record that explicitly — it is
   itself the finding the spec's §9 already anticipated: "Codex compaction / per-dispatch effort:
   not in public docs").

Record in `task0-probes.md`: the relevant `--help` excerpts, confirmation (or correction) of the
five effort values, and whether a Codex compaction flag exists.

### Probe C — subagent notification survives `/compact`

Manual procedure (record exactly what you did and what you observed — this cannot be scripted,
it is testing the live harness):

1. In an interactive Claude Code session, dispatch one backgroundable Agent-tool subagent doing
   something that takes at least 60–90 seconds (e.g. `general-purpose` running a moderate repo
   search) so there is time to compact before it finishes.
2. Immediately after dispatch, run `/compact`.
3. Continue working (send at least one more message) until the subagent's completion
   notification arrives.
4. Record: did the notification arrive? Did it carry the full result? Was there any visible sign
   the compaction disrupted it (an error, a missing result, a duplicate)?

Record in `task0-probes.md`: pass/fail and the exact observed behavior. This directly answers the
spec's §9 "undocumented; verified empirically in Task 0" line.

### Probe D — superseded-plan list for Task 6

Run, from the repo root:

```
git log --oneline --diff-filter=D -- docs/superpowers/plans/ | head -50
```

and, for every plan file `git log --follow --oneline -- <path>` still tracked but whose most
recent commit message or content marks it `SHIPPED`/`MERGED`/`CLOSED` (grep
`docs/superpowers/plans/*.md` for those words in a `**Status:**` line), list it as a Task 6
cleanup candidate — **but do not delete any of them in this plan**: Task 6 below is scoped
narrowly (four specific files the delegator named). Record the candidate list in
`task0-probes.md` as a follow-up card for a *separate* cleanup pass, not something this plan
executes, since verifying each one's "nothing depends on it" claim individually is its own task
and the delegator's Task 6 already names an exact, reviewed set.

### Task 0 — Files
- Create `docs/superpowers/specs/2026-09-11-token-discipline-evidence/task0-probes.md` with the
  four recorded sections above.

### Task 0 — Commit
`docs(token-discipline): task 0 probe results (load-context, codex effort/compaction, subagent
notification survives /compact, superseded-plan candidates)`

---

## Task 1 — `scripts/usage_ledger.py` (L1: measure)

### Files
- Create `scripts/usage_ledger.py`
- Create `tests/test_usage_ledger.py`
- Edit `scripts/preamble.py`
- Edit `scripts/hooks/project_frame_session_start.js`
- Edit `tests/test_project_frame_session_start.py`
- Edit `scripts/codex_dispatch.py` (one line: mark the worker environment so
  `usage_ledger.py` can refuse to run inside it)

### Interfaces
```python
# scripts/usage_ledger.py
def classify_claude_model(model_name: str | None) -> str
def claude_cost(model_class, inp, cache_create, cache_read, out) -> float
def codex_cost(input_tok, cached_tok, output_tok) -> float
def process_claude_file(path, kind, session_id, project, target_day) -> list[dict]
def process_codex_file(path, target_day) -> dict | None
def collect_claude_rows(env, target_day) -> list[dict]
def collect_codex_rows(env, target_day) -> list[dict]
def build_totals_row(rows) -> dict
def write_ledger(path, rows) -> None
def read_existing_rows(path) -> list[dict]
def summary_line(rows, target_day) -> str      # <= 200 chars
def publish_to_ops(repo_root, file_path, rel_path) -> tuple[bool, str]
def main(argv=None) -> int
```

### Step 1 — failing tests

Create `tests/test_usage_ledger.py`:

```python
"""tests/test_usage_ledger.py — scripts/usage_ledger.py.

Pure-function tests import the module directly (conftest.py puts scripts/ on sys.path, same
pattern as tests/test_handoffs_sweep.py's `from scripts import handoffs_sweep`). CLI-level tests
drive the script as a subprocess with KB_CLAUDE_PROJECTS_DIR/KB_CODEX_SESSIONS_DIR pointed at a
throwaway fixture tree, and --no-publish so no test ever touches a real git remote.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from scripts import usage_ledger as ul  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "usage_ledger.py"


# ── pure-function tests ──────────────────────────────────────────────────────────────────────

def test_classify_claude_model():
    assert ul.classify_claude_model("claude-opus-5") == "opus"
    assert ul.classify_claude_model("claude-fable-5-1") == "fable"
    assert ul.classify_claude_model("claude-sonnet-5") == "sonnet"
    assert ul.classify_claude_model("claude-haiku-4-5") == "haiku"
    assert ul.classify_claude_model("something-else") == "default"
    assert ul.classify_claude_model(None) == "default"


def test_claude_cost_is_positive_and_scales_with_cache_read():
    base = ul.claude_cost("opus", 1_000_000, 0, 0, 0)
    with_cache_read = ul.claude_cost("opus", 0, 0, 1_000_000, 0)
    assert base > 0
    assert with_cache_read == round(base * ul.CACHE_READ_MULT, 10)


def test_codex_cost_treats_cached_as_subset_of_input():
    cost = ul.codex_cost(1_000_000, 1_000_000, 0)  # fully cached
    assert cost == round((1_000_000 / 1e6) * ul.CODEX_INPUT_PRICE * ul.CODEX_CACHE_MULT, 10)


# ── streaming / partial-line handling ────────────────────────────────────────────────────────

def _claude_line(model, day, inp=100, cc=0, cr=0, out=50):
    return json.dumps({
        "type": "assistant", "timestamp": f"{day}T12:00:00Z",
        "message": {"model": model, "usage": {
            "input_tokens": inp, "cache_creation_input_tokens": cc,
            "cache_read_input_tokens": cr, "output_tokens": out,
        }},
    })


def test_process_claude_file_skips_a_partial_last_line(tmp_path):
    day = "2026-09-10"
    path = tmp_path / "s1.jsonl"
    # Two complete lines, then a truncated (no trailing newline) third line.
    path.write_text(
        _claude_line("claude-sonnet-5", day) + "\n"
        + _claude_line("claude-sonnet-5", day) + "\n"
        + '{"type": "assistant", "timestamp": "' + day + 'T12:00:01Z", "message": {"mo',
        encoding="utf-8",
    )
    rows = ul.process_claude_file(path, "top", "s1", "kb", day)
    assert len(rows) == 1
    assert rows[0]["turns"] == 2  # the truncated third record never counted


def test_process_claude_file_filters_by_target_day(tmp_path):
    path = tmp_path / "s2.jsonl"
    path.write_text(
        _claude_line("claude-opus-5", "2026-09-09") + "\n"
        + _claude_line("claude-opus-5", "2026-09-10") + "\n",
        encoding="utf-8",
    )
    rows = ul.process_claude_file(path, "top", "s2", "kb", "2026-09-10")
    assert len(rows) == 1
    assert rows[0]["turns"] == 1


def _codex_line(rec):
    return json.dumps(rec)


def test_process_codex_file_takes_max_total_usage_per_file(tmp_path):
    day = "2026-09-10"
    path = tmp_path / "rollout-1.jsonl"
    lines = [
        _codex_line({"type": "session_meta", "payload": {"session_id": "abc", "timestamp": f"{day}T01:00:00Z"}}),
        _codex_line({"type": "turn_context", "payload": {"model": "gpt-5.6-terra"}}),
        _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 100, "cached_input_tokens": 50, "output_tokens": 10, "total_tokens": 110},
        }}}),
        _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 500, "cached_input_tokens": 400, "output_tokens": 40, "total_tokens": 540},
        }}}),
        _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 300, "cached_input_tokens": 250, "output_tokens": 20, "total_tokens": 320},
        }}}),  # a SMALLER later reading must not override the max
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    row = ul.process_codex_file(path, day)
    assert row is not None
    assert row["max_ctx_tokens"] == 540
    assert row["input_tokens"] == 500
    assert row["cache_read_tokens"] == 400
    assert row["model"] == "gpt-5.6-terra"
    assert row["session"] == "abc"


def test_process_codex_file_attributes_to_session_start_day_only(tmp_path):
    path = tmp_path / "rollout-2.jsonl"
    lines = [
        _codex_line({"type": "session_meta", "payload": {"session_id": "xyz", "timestamp": "2026-09-09T23:59:00Z"}}),
        _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 10, "cached_input_tokens": 0, "output_tokens": 1, "total_tokens": 11},
        }}}),
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert ul.process_codex_file(path, "2026-09-10") is None  # session started the PRIOR day
    assert ul.process_codex_file(path, "2026-09-09") is not None


# ── CLI-level tests ───────────────────────────────────────────────────────────────────────────

def _make_fixture_tree(tmp_path, day):
    claude_root = tmp_path / "claude_projects" / "C--Users-danie-kb"
    claude_root.mkdir(parents=True)
    (claude_root / "sess1.jsonl").write_text(_claude_line("claude-sonnet-5", day) + "\n", encoding="utf-8")
    sub_dir = claude_root / "sess1" / "subagents"
    sub_dir.mkdir(parents=True)
    (sub_dir / "agent-1.jsonl").write_text(_claude_line("claude-haiku-4-5", day) + "\n", encoding="utf-8")
    codex_root = tmp_path / "codex_sessions" / "2026" / "09" / day[-2:]
    codex_root.mkdir(parents=True)
    (codex_root / "rollout-1.jsonl").write_text(
        "\n".join([
            _codex_line({"type": "session_meta", "payload": {"session_id": "c1", "timestamp": f"{day}T01:00:00Z"}}),
            _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
                "total_token_usage": {"input_tokens": 10, "cached_input_tokens": 5, "output_tokens": 2, "total_tokens": 12},
            }}}),
        ]) + "\n",
        encoding="utf-8",
    )
    return claude_root.parent.parent, codex_root.parent.parent.parent


def _run(env_extra, *args):
    env = {**os.environ, **env_extra}
    return subprocess.run(["python", str(SCRIPT), *args], capture_output=True, text=True, env=env)


def test_cli_writes_ledger_and_summary(tmp_path):
    day = "2026-09-10"
    claude_dir, codex_dir = _make_fixture_tree(tmp_path, day)
    repo_root = tmp_path / "repo"
    (repo_root / "ledgers").mkdir(parents=True)
    r = _run({
        "KB_CLAUDE_PROJECTS_DIR": str(claude_dir), "KB_CODEX_SESSIONS_DIR": str(codex_dir),
    }, "--date", day, "--root", str(repo_root), "--no-publish")
    assert r.returncode == 0, r.stderr
    out_path = repo_root / "ledgers" / "usage" / f"{day}.tsv"
    assert out_path.exists()
    text = out_path.read_text(encoding="utf-8")
    assert text.startswith("#")  # rate-table header
    assert "_totals" in text
    assert "est_usd" in text.splitlines()[1]  # header row


def test_cli_is_idempotent_per_day(tmp_path):
    day = "2026-09-10"
    claude_dir, codex_dir = _make_fixture_tree(tmp_path, day)
    repo_root = tmp_path / "repo"
    (repo_root / "ledgers").mkdir(parents=True)
    env = {"KB_CLAUDE_PROJECTS_DIR": str(claude_dir), "KB_CODEX_SESSIONS_DIR": str(codex_dir)}
    r1 = _run(env, "--date", day, "--root", str(repo_root), "--no-publish")
    out_path = repo_root / "ledgers" / "usage" / f"{day}.tsv"
    first_mtime = out_path.stat().st_mtime_ns
    # Second run: even with an EMPTY fixture tree, the existing file must be left alone
    # (re-read, not recomputed) -- idempotent per day.
    r2 = _run({"KB_CLAUDE_PROJECTS_DIR": str(tmp_path / "empty"), "KB_CODEX_SESSIONS_DIR": str(tmp_path / "empty2")},
              "--date", day, "--root", str(repo_root), "--no-publish", "--summary")
    assert r1.returncode == 0 and r2.returncode == 0
    assert out_path.stat().st_mtime_ns == first_mtime
    assert len(r2.stdout.strip().splitlines()[-1]) <= 200


def test_cli_summary_line_is_at_most_200_chars(tmp_path):
    day = "2026-09-10"
    claude_dir, codex_dir = _make_fixture_tree(tmp_path, day)
    repo_root = tmp_path / "repo"
    (repo_root / "ledgers").mkdir(parents=True)
    r = _run({"KB_CLAUDE_PROJECTS_DIR": str(claude_dir), "KB_CODEX_SESSIONS_DIR": str(codex_dir)},
             "--date", day, "--root", str(repo_root), "--no-publish", "--summary")
    assert r.returncode == 0, r.stderr
    line = r.stdout.strip().splitlines()[-1]
    assert len(line) <= 200
    assert day in line


def test_refuses_inside_a_codex_worker(tmp_path):
    r = _run({"KB_INSIDE_CODEX_WORKER": "1"}, "--date", "2026-09-10", "--root", str(tmp_path), "--no-publish")
    assert r.returncode == 3
    assert "codex worker" in r.stderr
    assert not (tmp_path / "ledgers").exists()


def test_bad_date_argument_is_rejected(tmp_path):
    r = _run({}, "--date", "not-a-date", "--root", str(tmp_path), "--no-publish")
    assert r.returncode == 2
```

### Step 2 — run, confirm failure
`py -3 -m pytest tests/test_usage_ledger.py -q` → `ModuleNotFoundError: No module named
'usage_ledger'` (or `scripts.usage_ledger`).

### Step 3 — implement

Create `scripts/usage_ledger.py`:

```python
#!/usr/bin/env python3
"""scripts/usage_ledger.py — daily Claude Code + Codex token usage ledger (measure only).

Read-only over ~/.claude/projects/**/*.jsonl (+ subagents/*.jsonl) and
~/.codex/sessions/**/rollout-*.jsonl. Writes one row per (runtime, model, session,
top|subagent) to ledgers/usage/<YYYY-MM-DD>.tsv, plus a `_totals` row, then publishes the
file to the ops branch via a detached worktree -- same contention handling as
scripts/codex_dispatch.py's publish_ops (ported, not re-derived: rebuild-on-conflict,
ancestry check instead of head-equality).

stdlib only. Invoked as `py -3 scripts/usage_ledger.py [--date YYYY-MM-DD] [--summary]
[--no-publish] [--root <path>]`. Ruling 2026-09-11 Section 0.1: measure only -- this script
enforces nothing, warns nothing, and never blocks anything it is called from.

NEVER run this from inside a Codex worker's shell: it globs ~/.codex/sessions/**/rollout-*.jsonl,
and a worker that reads its OWN rollout file mid-session can inject megabytes of its own history
back into its context (openai/codex#27131). The STRUCTURAL guard: scripts/codex_dispatch.py's
spawn() sets KB_INSIDE_CODEX_WORKER=1 in every worker's environment; this script refuses
immediately (exit 3, one stderr line, no file touched) whenever that variable is set. This is a
belt, not the buckle -- the real guard is that no dispatch-codex brief, SKILL.md instruction, or
fleet cadence ever names this script as a worker's job. The daily preamble.py call runs it from
the operator's own shell, which never carries that variable.
"""
from __future__ import annotations

import argparse
import os
import random
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Pricing -- an ESTIMATE for cross-session comparison, not a real bill (subscription usage is
# not metered in dollars). Ported from the Task 0 evidence prototype
# (docs/superpowers/specs/2026-09-11-token-discipline-evidence/analyze_tokens.py) -- same rates,
# same caveats. Every derived column is named est_... so nobody mistakes it for an invoice.
# ---------------------------------------------------------------------------
CLAUDE_PRICING = {  # model_class -> (input $/1M, output $/1M)
    "opus": (15.00, 75.00),
    "sonnet": (3.00, 15.00),
    "haiku": (0.80, 4.00),
    "fable": (15.00, 75.00),  # ASSUMPTION: no public Fable price; Opus-tier used (flagged)
    "default": (3.00, 15.00),
}
CACHE_READ_MULT = 0.10
CACHE_CREATE_MULT = 1.25
CODEX_INPUT_PRICE = 1.25
CODEX_OUTPUT_PRICE = 10.00
CODEX_CACHE_MULT = 0.50

RATE_TABLE_HEADER = (
    "# est_ rates (per 1M tokens, comparison-only, NOT a real subscription bill): "
    "claude opus 15/75 sonnet 3/15 haiku 0.8/4 fable 15/75(assumed) cache-read 10% cache-create 125% "
    "| codex input 1.25 output 10.00 cached-input 50%"
)

TSV_FIELDS = [
    "runtime", "model", "session", "kind", "project",
    "input_tokens", "cache_creation_tokens", "cache_read_tokens", "output_tokens",
    "turns", "max_ctx_tokens", "est_usd",
]


def classify_claude_model(model_name):
    m = (model_name or "").lower()
    for key in ("opus", "haiku", "fable", "sonnet"):
        if key in m:
            return key
    return "default"


def claude_cost(model_class, inp, cache_create, cache_read, out):
    in_p, out_p = CLAUDE_PRICING.get(model_class, CLAUDE_PRICING["default"])
    return (
        (inp / 1e6) * in_p
        + (cache_create / 1e6) * in_p * CACHE_CREATE_MULT
        + (cache_read / 1e6) * in_p * CACHE_READ_MULT
        + (out / 1e6) * out_p
    )


def codex_cost(input_tok, cached_tok, output_tok):
    uncached = max(0, input_tok - cached_tok)
    return (
        (uncached / 1e6) * CODEX_INPUT_PRICE
        + (cached_tok / 1e6) * CODEX_INPUT_PRICE * CODEX_CACHE_MULT
        + (output_tok / 1e6) * CODEX_OUTPUT_PRICE
    )


# ---------------------------------------------------------------------------
# True line-by-line JSONL streaming. Holds at most ONE line buffered (never loads a whole
# transcript into memory) and drops a final line with no trailing newline -- a session file the
# current terminal is still writing is a NORMAL input, not an error ("skips a partial last line").
# ---------------------------------------------------------------------------

def _ends_with_newline(path: Path) -> bool:
    try:
        size = path.stat().st_size
    except OSError:
        return True
    if size == 0:
        return True
    try:
        with path.open("rb") as fb:
            fb.seek(-1, os.SEEK_END)
            return fb.read(1) == b"\n"
    except OSError:
        return True  # fail open: treat as complete rather than silently drop everything


def _iter_complete_json_lines(path: Path):
    import json
    complete_tail = _ends_with_newline(path)
    try:
        f = path.open("r", encoding="utf-8", errors="replace")
    except OSError:
        return
    with f:
        pending = None
        for line in f:
            if pending is not None:
                stripped = pending.strip()
                if stripped:
                    try:
                        yield json.loads(stripped)
                    except json.JSONDecodeError:
                        pass
            pending = line
        if pending is not None and complete_tail:
            stripped = pending.strip()
            if stripped:
                try:
                    yield json.loads(stripped)
                except json.JSONDecodeError:
                    pass


# ---------------------------------------------------------------------------
# Claude Code transcripts
# ---------------------------------------------------------------------------

def process_claude_file(path: Path, kind: str, session_id: str, project: str, target_day: str):
    """Rows (one per model class actually seen) for ONE Claude transcript, filtered to records
    whose OWN timestamp falls on target_day -- a long-lived session file spans many days, and
    attributing its whole history to whichever day it was last touched would misreport "yesterday"."""
    per_model = defaultdict(lambda: defaultdict(float))
    ctx_per_turn = []
    for rec in _iter_complete_json_lines(path):
        if not isinstance(rec, dict) or rec.get("type") != "assistant":
            continue
        ts = rec.get("timestamp") or ""
        if ts[:10] != target_day:
            continue
        msg = rec.get("message") or {}
        usage = msg.get("usage") or {}
        if not usage:
            continue
        mclass = classify_claude_model(msg.get("model"))
        inp = usage.get("input_tokens", 0) or 0
        cc = usage.get("cache_creation_input_tokens", 0) or 0
        cr = usage.get("cache_read_input_tokens", 0) or 0
        out = usage.get("output_tokens", 0) or 0
        row = per_model[mclass]
        row["input"] += inp
        row["cache_creation"] += cc
        row["cache_read"] += cr
        row["output"] += out
        row["turns"] += 1
        ctx_per_turn.append(inp + cr)
    if not per_model:
        return []
    max_ctx = max(ctx_per_turn) if ctx_per_turn else 0
    rows = []
    for mclass, row in per_model.items():
        rows.append({
            "runtime": "claude", "model": mclass, "session": session_id, "kind": kind, "project": project,
            "input_tokens": int(row["input"]), "cache_creation_tokens": int(row["cache_creation"]),
            "cache_read_tokens": int(row["cache_read"]), "output_tokens": int(row["output"]),
            "turns": int(row["turns"]), "max_ctx_tokens": int(max_ctx),
            "est_usd": round(claude_cost(mclass, row["input"], row["cache_creation"], row["cache_read"], row["output"]), 4),
        })
    return rows


# ---------------------------------------------------------------------------
# Codex rollouts -- session-level attribution (spec: "total_token_usage = max per rollout file"),
# NOT per-record like Claude: a session is attributed to its OWN start day only, matching table A3's
# "cumulative session totals attributed to session-start day".
# ---------------------------------------------------------------------------

def process_codex_file(path: Path, target_day: str):
    session_id = None
    model = None
    turns = 0
    max_usage = None
    start_day = None
    for rec in _iter_complete_json_lines(path):
        if not isinstance(rec, dict):
            continue
        rtype = rec.get("type")
        if rtype == "session_meta":
            p = rec.get("payload") or {}
            session_id = p.get("session_id") or p.get("id") or session_id
            ts = p.get("timestamp") or rec.get("timestamp")
            if ts:
                start_day = str(ts)[:10]
        elif rtype == "turn_context":
            model = (rec.get("payload") or {}).get("model") or model
        elif rtype == "event_msg":
            p = rec.get("payload") or {}
            if p.get("type") == "task_started":
                turns += 1
                model = p.get("model") or model
            elif p.get("type") == "token_count":
                info = p.get("info") or {}
                tu = info.get("total_token_usage")
                if tu and (max_usage is None or (tu.get("total_tokens", 0) or 0) > (max_usage.get("total_tokens", 0) or 0)):
                    max_usage = tu
    if start_day != target_day or max_usage is None:
        return None
    input_tok = max_usage.get("input_tokens", 0) or 0
    cached_tok = max_usage.get("cached_input_tokens", 0) or 0
    output_tok = max_usage.get("output_tokens", 0) or 0
    return {
        "runtime": "codex", "model": model or "unknown", "session": session_id or path.stem,
        "kind": "top", "project": "-",
        "input_tokens": int(input_tok), "cache_creation_tokens": 0,
        "cache_read_tokens": int(cached_tok), "output_tokens": int(output_tok),
        "turns": turns, "max_ctx_tokens": int(max_usage.get("total_tokens", 0) or 0),
        "est_usd": round(codex_cost(input_tok, cached_tok, output_tok), 4),
    }


# ---------------------------------------------------------------------------
# Enumeration
# ---------------------------------------------------------------------------

def _home(env) -> Path:
    return Path(env.get("USERPROFILE") or env.get("HOME") or str(Path.home()))


def _claude_projects_dir(env) -> Path:
    return Path(env.get("KB_CLAUDE_PROJECTS_DIR") or (_home(env) / ".claude" / "projects"))


def _codex_sessions_dir(env) -> Path:
    return Path(env.get("KB_CODEX_SESSIONS_DIR") or (_home(env) / ".codex" / "sessions"))


def _day_start_epoch(day: str) -> float:
    d = date.fromisoformat(day)
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()


def collect_claude_rows(env, target_day: str) -> list[dict]:
    root = _claude_projects_dir(env)
    if not root.is_dir():
        return []
    start_epoch = _day_start_epoch(target_day)
    rows: list[dict] = []
    for proj_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        project = proj_dir.name
        for entry in sorted(proj_dir.iterdir()):
            try:
                if entry.is_file() and entry.suffix == ".jsonl":
                    if entry.stat().st_mtime >= start_epoch:
                        rows.extend(process_claude_file(entry, "top", entry.stem, project, target_day))
                elif entry.is_dir():
                    sub = entry / "subagents"
                    if sub.is_dir():
                        for sf in sorted(sub.iterdir()):
                            if sf.suffix == ".jsonl" and sf.stat().st_mtime >= start_epoch:
                                rows.extend(process_claude_file(sf, "subagent", entry.name, project, target_day))
            except OSError:
                continue
    return rows


def collect_codex_rows(env, target_day: str) -> list[dict]:
    root = _codex_sessions_dir(env)
    if not root.is_dir():
        return []
    start_epoch = _day_start_epoch(target_day)
    rows: list[dict] = []
    for path in sorted(root.rglob("rollout-*.jsonl")):
        try:
            if path.stat().st_mtime < start_epoch:
                continue
        except OSError:
            continue
        row = process_codex_file(path, target_day)
        if row:
            rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Totals, TSV I/O, summary
# ---------------------------------------------------------------------------

def build_totals_row(rows: list[dict]) -> dict:
    totals = defaultdict(float)
    for r in rows:
        for f in ("input_tokens", "cache_creation_tokens", "cache_read_tokens", "output_tokens", "turns", "est_usd"):
            totals[f] += r[f]
        totals["max_ctx_tokens"] = max(totals["max_ctx_tokens"], r["max_ctx_tokens"])
    return {
        "runtime": "_totals", "model": "-", "session": "-", "kind": "-", "project": "-",
        "input_tokens": int(totals["input_tokens"]), "cache_creation_tokens": int(totals["cache_creation_tokens"]),
        "cache_read_tokens": int(totals["cache_read_tokens"]), "output_tokens": int(totals["output_tokens"]),
        "turns": int(totals["turns"]), "max_ctx_tokens": int(totals["max_ctx_tokens"]),
        "est_usd": round(totals["est_usd"], 4),
    }


def write_ledger(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    totals = build_totals_row(rows)
    with path.open("w", encoding="utf-8", newline="") as f:
        f.write(RATE_TABLE_HEADER + "\n")
        f.write("\t".join(TSV_FIELDS) + "\n")
        for r in rows + [totals]:
            f.write("\t".join(str(r[k]) for k in TSV_FIELDS) + "\n")


def read_existing_rows(path: Path) -> list[dict]:
    """Idempotent-read path: an already-written day is read back, never recomputed."""
    lines = path.read_text(encoding="utf-8").splitlines()
    if len(lines) < 2 or not lines[0].startswith("#"):
        return []
    header = lines[1].split("\t")
    rows = []
    for line in lines[2:]:
        if not line:
            continue
        values = line.split("\t")
        row = dict(zip(header, values))
        for k in ("input_tokens", "cache_creation_tokens", "cache_read_tokens", "output_tokens", "turns", "max_ctx_tokens"):
            row[k] = int(row.get(k, 0) or 0)
        row["est_usd"] = float(row.get("est_usd", 0) or 0)
        rows.append(row)
    if rows and rows[-1]["runtime"] == "_totals":
        rows = rows[:-1]  # summary_line recomputes totals from the non-totals rows
    return rows


def summary_line(rows: list[dict], target_day: str) -> str:
    totals = build_totals_row(rows)
    claude_usd = sum(r["est_usd"] for r in rows if r["runtime"] == "claude")
    codex_usd = sum(r["est_usd"] for r in rows if r["runtime"] == "codex")
    line = (
        f"{target_day}: claude ${claude_usd:.2f}-eq / codex ${codex_usd:.2f}-eq "
        f"| {int(totals['turns'])} turns | max ctx {int(totals['max_ctx_tokens']) // 1000}k"
    )
    return line[:200]


# ---------------------------------------------------------------------------
# Ops publish -- PORTED from scripts/codex_dispatch.py:publish_ops (same contention handling:
# never rebase, rebuild from a fresh fetch; ancestry check, not head equality, decides "landed").
# ---------------------------------------------------------------------------

def publish_to_ops(repo_root: Path, file_path: Path, rel_path: str) -> tuple[bool, str]:
    def git(*a, cwd=repo_root, timeout=120):
        try:
            return subprocess.run(["git", *a], cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return subprocess.CompletedProcess(a, 1, "", "git timed out")

    def landed(sha):
        return bool(sha) and git("merge-base", "--is-ancestor", sha, "FETCH_HEAD").returncode == 0

    content = file_path.read_bytes()
    wt = Path(tempfile.mkdtemp(prefix="usage-ledger-")) / "wt"
    local_sha = ""
    try:
        for attempt in range(3):
            if attempt:
                time.sleep(random.uniform(0.5, 2.0))
            if git("fetch", "origin", "ops").returncode != 0:
                continue
            if landed(local_sha):
                return True, "pushed"
            if wt.exists():
                git("reset", "--hard", "origin/ops", cwd=wt)
                git("clean", "-fdq", cwd=wt)
            elif git("worktree", "add", "--detach", str(wt), "origin/ops").returncode != 0:
                continue
            target = wt / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            git("add", "--", str(target), cwd=wt)
            if git("commit", "-m", f"chore(usage-ledger): record {rel_path}", cwd=wt).returncode != 0:
                continue
            local_sha = git("rev-parse", "HEAD", cwd=wt).stdout.strip()
            if git("push", "origin", "HEAD:refs/heads/ops", cwd=wt).returncode != 0:
                continue
            if git("fetch", "origin", "ops").returncode == 0 and landed(local_sha):
                return True, "pushed"
        return False, "publish failed after 3 rebuilt attempts (local file kept)"
    finally:
        git("worktree", "remove", "--force", str(wt))
        git("worktree", "prune")


def _run(env, root: Path, target_day: str) -> tuple[list[dict], Path]:
    rows = collect_claude_rows(env, target_day) + collect_codex_rows(env, target_day)
    rows.sort(key=lambda r: (r["runtime"], r["model"], r["session"], r["kind"]))
    out_path = root / "ledgers" / "usage" / f"{target_day}.tsv"
    write_ledger(out_path, rows)
    return rows, out_path


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=None, help="YYYY-MM-DD, default yesterday (UTC)")
    parser.add_argument("--summary", action="store_true", help="print the one-line summary")
    parser.add_argument("--no-publish", action="store_true", help="skip the ops publish (tests, dry runs)")
    parser.add_argument("--root", default=None, help="repo root override (tests only)")
    args = parser.parse_args(argv)

    env = os.environ
    if env.get("KB_INSIDE_CODEX_WORKER"):
        print(
            "usage_ledger.py refuses to run inside a codex worker (KB_INSIDE_CODEX_WORKER=1) -- "
            "self-ingestion hazard (openai/codex#27131); run it from the operator shell instead.",
            file=sys.stderr,
        )
        return 3

    target_day = args.date or (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    try:
        date.fromisoformat(target_day)
    except ValueError:
        print(f"bad --date {target_day!r}, expected YYYY-MM-DD", file=sys.stderr)
        return 2

    root = Path(args.root) if args.root else REPO_ROOT
    out_path = root / "ledgers" / "usage" / f"{target_day}.tsv"
    if out_path.exists():
        rows = read_existing_rows(out_path)
    else:
        rows, out_path = _run(env, root, target_day)
        if not args.no_publish:
            publish_to_ops(root, out_path, f"ledgers/usage/{target_day}.tsv")

    if args.summary:
        print(summary_line(rows, target_day))
    else:
        print(f"wrote {out_path} ({len(rows)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### Step 4 — run, confirm green
`py -3 -m pytest tests/test_usage_ledger.py -q`

### Step 5 — `scripts/preamble.py` hook-in

Add imports and a new best-effort function, called only from `main()` (never from the importable
`check()` — `codex_dispatch.py` and others call `check()` directly on every dispatch, and this
must run at most once per day, not once per dispatch):

```python
# top of scripts/preamble.py, add to imports:
import subprocess
from datetime import datetime, timedelta, timezone

# new function, near the bottom, before main():

def _maybe_run_usage_ledger(root: Path) -> None:
    """Best-effort, budgeted (5s), fail-open: run usage_ledger.py for yesterday if that day's
    file doesn't exist yet. NEVER affects preamble's PASS/FAIL verdict (ruling: measure only) --
    called only from main(), never from check(), so a library caller (codex_dispatch.py calls
    preamble.check() on every dispatch) never pays this cost."""
    yesterday = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    ledger_file = Path(root) / "ledgers" / "usage" / f"{yesterday}.tsv"
    if ledger_file.exists():
        return
    script = Path(root) / "scripts" / "usage_ledger.py"
    if not script.exists():
        return
    for bin_name in ("py", "python"):
        args = [bin_name] + (["-3"] if bin_name == "py" else []) + [str(script), "--date", yesterday]
        try:
            subprocess.run(args, cwd=str(root), timeout=5, capture_output=True)
            return
        except (OSError, subprocess.TimeoutExpired):
            continue
```

Edit `main()` to call it right after computing `root`, before the pass/fail branch:

```python
def main() -> int:
    root = Path.cwd()
    _maybe_run_usage_ledger(root)
    try:
        import ledger
        cost_fn = ledger.cost_today
    except ImportError:
        cost_fn = None
    ...
```

Add one test to `tests/test_preamble.py` (create it if it does not already exist — check first;
if it exists, add these two functions to it):

```python
def test_maybe_run_usage_ledger_skips_when_file_exists(tmp_path, monkeypatch):
    from scripts import preamble
    root = tmp_path
    (root / "ledgers" / "usage").mkdir(parents=True)
    day = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    (root / "ledgers" / "usage" / f"{day}.tsv").write_text("x", encoding="utf-8")
    calls = []
    monkeypatch.setattr(preamble.subprocess, "run", lambda *a, **k: calls.append(a) or None)
    preamble._maybe_run_usage_ledger(root)
    assert calls == []


def test_maybe_run_usage_ledger_calls_script_when_missing(tmp_path, monkeypatch):
    from scripts import preamble
    root = tmp_path
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "usage_ledger.py").write_text("", encoding="utf-8")
    calls = []
    monkeypatch.setattr(preamble.subprocess, "run", lambda *a, **k: calls.append((a, k)) or subprocess.CompletedProcess(a, 0))
    preamble._maybe_run_usage_ledger(root)
    assert len(calls) == 1
    assert calls[0][1]["timeout"] == 5
```

(Add `import subprocess` and `from datetime import datetime, timedelta, timezone` to the test
file's imports too, if not already present.)

### Step 6 — `project_frame_session_start.js`: `## Usage (yesterday)` line

Add near the top, after the existing constants:

```js
const fs = require("fs");  // NEW require -- file already requires path/spawnSync/hook_io/store/pf
const USAGE_LEDGER_TIMEOUT_MS = 3000;
```

Add a new function alongside `preambleVerdict`/`handoffFlags`:

```js
/**
 * The `_totals` row's one-line summary for '## Usage (yesterday)', or null when that day's
 * ledger doesn't exist yet. NEVER runs the parser itself (spec S3): checks the file on disk
 * FIRST and only then invokes `usage_ledger.py --summary --no-publish` (the fast idempotent-read
 * path -- see usage_ledger.py's main(), which reads an existing file rather than recomputing).
 * `--no-publish`: this is a read, the file already exists, there is nothing new to commit, and a
 * `git fetch`/push per SessionStart is a cost this hook cannot afford.
 */
function usageLine(root, timeoutMs) {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ledgerFile = path.join(root, "ledgers", "usage", yesterday + ".tsv");
  if (!fs.existsSync(ledgerFile)) {
    return null; // preamble.py hasn't produced it yet today -- this hook never computes it
  }
  const result = runPython(
    ["scripts/usage_ledger.py", "--date", yesterday, "--summary", "--no-publish"],
    root,
    timeoutMs,
  );
  if (!result || result.status !== 0 || !result.stdout) return null;
  return pf.firstLine(result.stdout);
}
```

Edit `main()`: compute `usageBlock` alongside `flagsBlock`, fold its length into the SAME budget
reservation (order is load-bearing, same reasoning as the existing preamble/flags reservation —
see the file's own comment on that), and append it after `flagsBlock`:

```js
  const flags = handoffFlags(root, sweepTimeoutMs);
  const flagsBlock = flags.length
    ? SEPARATOR + "## Stale handoffs" + NEWLINE + flags.map((f) => "- " + f).join(NEWLINE)
    : "";
  const usage = usageLine(root, USAGE_LEDGER_TIMEOUT_MS);
  const usageBlock = usage ? SEPARATOR + "## Usage (yesterday)" + NEWLINE + usage : "";

  const frameResult = pf.frame({
    project,
    mode,
    cwd,
    sessionId,
    env,
    budget: budget - preambleLine.length - SEPARATOR.length - flagsBlock.length - usageBlock.length,
  });

  const combined = preambleLine + SEPARATOR + frameResult.text + flagsBlock + usageBlock;
```

(The `payload = combined.length <= budget ? combined : io.truncateTo(combined, budget);` guard
line stays unchanged below it.)

### Step 7 — session-model note (shared plumbing for Task 3)

Add, in the same file, right after `writeGoverningSections`:

```js
/** '## Session model' -- a write-once-per-turn note of `event.model` (when the harness sends
 * one), read by scripts/hooks/context_guard.js's Fable/Opus PDF/image-read rule. NOT one of
 * context_store's five reserved HEADINGS -- an ordinary extra section, so lib/context_store.js
 * needs no change (renderSections already preserves unknown headings verbatim). */
const SESSION_MODEL_HEADING = "Session model";

function writeSessionModel(sessionId, event, env) {
  const model = typeof event.model === "string" && event.model.trim() ? event.model.trim() : null;
  if (!sessionId || !model) return;
  store.updateStore(sessionId, (sections) => store.upsertSection(sections, SESSION_MODEL_HEADING, model), env);
}
```

Call it in `main()`, right after `writeGoverningSections(...)`:

```js
  writeGoverningSections(sessionId, project, cwd, env);
  writeSessionModel(sessionId, event, env);
```

### Step 8 — tests

Add to `tests/test_project_frame_session_start.py` (uses the file's own existing `make_kb_root`,
`make_project_repo`, `run_hook`, `read_store_sections`, `section_body` helpers — extend
`make_kb_root` with one new optional parameter):

```python
from datetime import datetime, timedelta, timezone  # add to the file's imports

def make_kb_root(tmp_path, preamble_body='print("PREAMBLE OK")\n', with_sweep=False, sweep_body=None,
                  with_usage_summary=None):
    root = tmp_path / "kb_root"
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "preamble.py").write_text(preamble_body, encoding="utf-8")
    if with_sweep:
        body = sweep_body or (
            'import json, sys\n'
            'print(json.dumps([{"file": "2020-01-01-kb-old.md", "reasons": ["30 days old"]}]))\n'
        )
        (root / "scripts" / "handoffs_sweep.py").write_text(body, encoding="utf-8")
    if with_usage_summary is not None:
        day = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
        (root / "ledgers" / "usage").mkdir(parents=True, exist_ok=True)
        (root / "ledgers" / "usage" / f"{day}.tsv").write_text("stub\n", encoding="utf-8")
        (root / "scripts" / "usage_ledger.py").write_text(
            f"print({with_usage_summary!r})\n", encoding="utf-8",
        )
    return root


def test_usage_line_appended_when_ledger_exists(tmp_path):
    kb_root = make_kb_root(
        tmp_path, with_usage_summary="2026-09-10: claude $12.34-eq / codex $5.00-eq | 900 turns | max ctx 210k",
    )
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "## Usage (yesterday)" in ctx
    assert "claude $12.34-eq" in ctx


def test_usage_line_absent_when_ledger_missing(tmp_path):
    kb_root = make_kb_root(tmp_path)  # no ledgers/usage/<day>.tsv on disk
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "## Usage (yesterday)" not in ctx


def test_session_model_note_written_when_event_carries_model(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo),
         "model": "claude-opus-5"},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    sections = read_store_sections(store_dir, "s1")
    assert section_body(sections, "Session model") == "claude-opus-5"


def test_session_model_note_absent_when_event_has_no_model(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    sections = read_store_sections(store_dir, "s1")
    assert section_body(sections, "Session model") is None
```

These four new tests do not touch `ledgers`/`## Usage`/`Session model` in any EXISTING test's
fixtures, so none of the pre-existing `len(ctx) <= 7000` / `<= 1500` / `ctx.endswith(...)`
assertions change behavior (empty `usageBlock` when nothing is stubbed).

### Step 9 — `codex_dispatch.py`: mark the worker environment

One line in `spawn()`'s `subprocess.Popen(...)` call — add an explicit `env=`:

```python
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=log, stderr=log,
                                start_new_session=True,
                                env={**os.environ, "KB_INSIDE_CODEX_WORKER": "1"})
```

(`os` is already imported in `codex_dispatch.py`.) Add one test to `tests/test_codex_dispatch.py`
(the existing `_main_env` fixture fakes `spawn` entirely, so this needs a NARROWER test that
checks the real `spawn()` function's `Popen` call directly):

```python
def test_spawn_marks_worker_env(monkeypatch, tmp_path):
    seen_env = {}
    class FakeProc:
        pid = 111
        def communicate(self, input=None, timeout=None):
            return (b"", b"")
        returncode = 0
    def fake_popen(cmd, **kwargs):
        seen_env.update(kwargs.get("env") or {})
        return FakeProc()
    monkeypatch.setattr(codex_dispatch.shutil, "which", lambda _: "codex.cmd")
    monkeypatch.setattr(codex_dispatch.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(codex_dispatch, "update_marker", lambda *a, **k: None)
    monkeypatch.setattr(codex_dispatch, "process_start_time", lambda *_: None)
    codex_dispatch.spawn("hi", "gpt-5.6-terra", None, tmp_path, "workspace-write",
                          tmp_path / "out.txt", tmp_path / "log.txt")
    assert seen_env.get("KB_INSIDE_CODEX_WORKER") == "1"
```

### Step 10 — run everything, confirm green
```
py -3 -m pytest tests/test_usage_ledger.py tests/test_preamble.py tests/test_project_frame_session_start.py tests/test_codex_dispatch.py -q
```

### Step 11 — commit
`feat(token-discipline): usage_ledger.py + SessionStart Usage line + Session-model note (L1)`

---

## Task 2 — L2: reset at a boundary

### Files
- Edit `scripts/hooks/lib/project_frame.js`
- Edit `scripts/project_frame_lint.py`
- Edit `tests/test_project_frame_lint.py`
- Edit `skills/curated/save-session/SKILL.md` (then run `py -3 scripts/sync_skills.py` to
  propagate to `.claude/skills/save-session/SKILL.md` and `.agents/skills/save-session/SKILL.md`)
- Create `docs/superpowers/specs/2026-09-11-token-discipline-evidence/proposed-BOSS-CLAUDE-diff.md`
- Describe (do not apply): `.claude/settings.json` gains `"autoCompactWindow": "150k"`

### Step 1 — `project_frame_lint.py`: `## Decisions` required

Edit `STATE_HEADINGS`:

```python
STATE_HEADINGS = ["Now", "Current gate", "Decisions", "Next", "Blocked", "Findings", "Infra"]
```

Edit the existing `GOOD_STATE` fixture in `tests/test_project_frame_lint.py` to add the new
required heading (insert right after `## Current gate\nreview\n`):

```python
GOOD_STATE = textwrap.dedent("""\
    # demo — STATE
    _Updated: 2026-09-10 12:00_
    ## Now
    running
    ## Current gate
    review
    ## Decisions
    2026-09-11 — example ruling — why
    ## Next
    ship
    ## Blocked
    None
    ## Findings
    none yet
    ## Infra
    n/a
    """)
```

Add a new failing-then-passing test:

```python
def test_state_missing_decisions_fails(tmp_path):
    bad_state = GOOD_STATE.replace("## Decisions\n2026-09-11 — example ruling — why\n", "")
    _write(tmp_path, "demo", GOOD_GOAL, bad_state)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "missing ## Decisions" in r.stdout
```

Run `py -3 -m pytest tests/test_project_frame_lint.py -q` — confirm it fails before the
`GOOD_STATE` edit lands (every pre-existing test using the unedited fixture would fail the new
required heading), then apply both edits together and confirm green. NOTE for the boss: the
three real `orgs/*/STATE.md` files (`kb-ops` 9 lines, `atlas-prep` 9 lines, `faceless-youtube` 29
lines) do NOT yet have `## Decisions` and will fail this lint against the live tree — same
already-accepted posture as the prior plan's self-review ("existing STATE.md files do not conform
... expected and intentional... content work is boss work on ops"). All three are far under the
60-line cap even after adding a short `## Decisions` block, so **no trimming is needed right
now** — this only becomes a concern if a project's `## Decisions` list grows past a few bullets,
at which point the spec's own rule applies ("Older bullets roll into the arc's handoff on
close").

### Step 2 — `lib/project_frame.js`: surface `## Decisions` in both modes

Edit the `full`-mode `entries` construction:

```js
  const entries = bodiesFor(goalSections, [
    "North star",
    "Success conditions",
    "Invariants",
    "Governing docs",
  ]).concat(
    bodiesFor(stateSections, ["Now", "Current gate", "Decisions", "Next", "Blocked", "Findings", "Infra"])
  );
```

Edit the `rollup`-mode loop to append the latest decision, when present, to each project's line:

```js
    for (const id of listProjects(cwd, env)) {
      const stateText = readOpsFile(cwd, `orgs/${id}/STATE.md`, env);
      if (!stateText) continue;
      const sections = parseSections(stateText);
      const now = firstLine(sectionBodyByPrefix(sections, "Now")) || "(no ## Now)";
      const updated = updatedStamp(stateText) || "unknown";
      const decision = firstLine(sectionBodyByPrefix(sections, "Decisions"));
      const decisionSuffix = decision ? ` | latest decision: ${decision}` : "";
      entries.push({ label: null, body: `${id}: ${now} (updated ${updated})${decisionSuffix}` });
    }
```

Add tests to `tests/test_project_frame.py` (the resolver/frame test file from the prior plan):

```python
def test_full_mode_includes_decisions_section(tmp_repo):  # reuse whatever fixture helper that
    # file already uses to seed orgs/<project>/STATE.md with a `## Decisions` body, then:
    ...
    result = frame({"project": "demo", "mode": "full", "cwd": str(repo), "env": os.environ})
    assert "2026-09-11 — example ruling" in result["text"]


def test_rollup_mode_appends_latest_decision_when_present(tmp_repo):
    ...
    result = frame({"project": None, "mode": "rollup", "cwd": str(repo), "env": os.environ})
    assert "| latest decision:" in result["text"]


def test_rollup_mode_omits_decision_suffix_when_absent(tmp_repo):
    ...  # a STATE.md with no ## Decisions section
    result = frame({"project": None, "mode": "rollup", "cwd": str(repo), "env": os.environ})
    assert "| latest decision:" not in result["text"]
```

(`tests/test_project_frame.py` already exists per the prior plan's Task 1 — reuse its exact
fixture-building helper names rather than the placeholder `tmp_repo` above; if the existing file
uses e.g. `make_repo`/`seed_project`, use those.)

### Step 3 — `autoCompactWindow` (described only)

`.claude/settings.json` (project scope) gains, at the TOP level (sibling of `"env"` and
`"hooks"`, per the spec's own citation of `docs: model-config`):

```json
  "autoCompactWindow": "150k",
```

This plan does NOT apply this edit (out of scope per the dispatch brief). It is recorded here and
in the proposed-diff file (Step 5) for Daniel/boss to add by hand, then verified live in Task 7.

### Step 4 — `save-session` SKILL.md: delete the superseded handoff at write time

Edit `skills/curated/save-session/SKILL.md`'s "Where it lands (kb retarget)" section — the first
bullet currently ends "`git rm` that consumed handoff in the same push that adds your new one".
Add a second, symmetric sentence covering the SAME-SCOPE-but-not-resumed case (today only
`handoffs_sweep.py` catches this, after the fact, at the NEXT session's flag — this makes the
writer responsible immediately):

Old:
```
  LIFECYCLE: `handoffs/` holds only ACTIVE work. If this session RESUMED from a
  handoff, `git rm` that consumed handoff in the same push that adds your new one
  (or that completes the work — completed work leaves no handoff). Git history
  keeps every deleted file recoverable.
```

New:
```
  LIFECYCLE: `handoffs/` holds only ACTIVE work. If this session RESUMED from a
  handoff, `git rm` that consumed handoff in the same push that adds your new one
  (or that completes the work — completed work leaves no handoff). Before writing
  a NEW handoff for a scope you did NOT resume from, check `handoffs/` for any
  existing file with the same `<scope>` token (`ls handoffs/*-<scope>-*.md`); if
  one exists, `git rm` it in the SAME push as the new one — the new handoff is
  the current resume state for that scope, and `scripts/handoffs_sweep.py`
  already flags a same-scope supersession it finds later, so doing it at write
  time closes the gap between "flagged" and "deleted". Git history keeps every
  deleted file recoverable.
```

Then run `py -3 scripts/sync_skills.py` (propagates to `.claude/skills/save-session/SKILL.md` and
`.agents/skills/save-session/SKILL.md`). Run `py -3 -m pytest tests/test_sync_skills.py -q` to
confirm the sync itself is still green (this is a text-only edit; if `tests/test_sync_skills_kit.py`
diffs SKILL.md content anywhere, confirm it still passes too).

### Step 5 — proposed BOSS.md / MEMORY.md diff file

Create `docs/superpowers/specs/2026-09-11-token-discipline-evidence/proposed-BOSS-CLAUDE-diff.md`
(this is a reviewable proposal, never applied by this plan — `BOSS.md` is human-edited only):

```markdown
# Proposed BOSS.md / MEMORY.md edits — token discipline (2026-09-11)

Daniel-edits-only per the constitution. Four independent hunks; apply any subset.

## 1. 150k boundary rule (L2, spec S4) — add to BOSS.md's "Execution discipline" section

    - Past 150k context (statusline `context_window.used_percentage` is the cue —
      hooks cannot read context size): finish the current task's review or fix
      round, write the ledger/handoff, then either let auto-compact run or end
      the turn with "restart me". Running subagents continue uninterrupted;
      their notifications arrive after compaction (verified empirically,
      2026-09-11 token-discipline Task 0 probe C).

## 2. Brief-rule pointer (L3, spec S5) — add to BOSS.md's "Delegation" section

    - Every dispatch brief (Claude Agent tool AND dispatch-codex) follows the
      one brief rule in `docs/runbooks/subagent-brief-rules.md`: the worker
      writes its full output to a file and returns <= 300 words in its final
      message.

## 3. BOSS.md trim to rules-only (L4, spec S6)

Recommend cutting BOSS.md's prose explanations down to the imperative rule
each subsection already states, e.g. collapsing multi-sentence "why" framing
in "Startup" and "Planning" into the rule sentence plus one clause. Not
scripted here (a hand-edit judgment call) — the ask is: audit BOSS.md line by
line, keep every RULE, cut restated context the rule already implies.

## 4. MEMORY.md arc collapse at session close (L4, spec S6)

    - At session close, for any arc entry in MEMORY.md marked SHIPPED / MERGED
      / CLOSED this session, collapse it to a single pointer line (as several
      entries already do, e.g. "Bricks superseded chain") pointing at the ops
      STATE.md or the merged PR, rather than leaving the full multi-line
      history inline. MEMORY.md is personal (outside the repo); this is a
      boss-session habit, not a script.
```

### Step 6 — commit
`docs(token-discipline): L2 — Decisions heading, save-session handoff-delete step, autoCompactWindow + BOSS.md diff proposal (not applied)`

---

## Task 3 — L3: `context_guard.js` (guard the context)

### Files
- Create `scripts/hooks/context_guard.js`
- Create `scripts/hooks/context_guard.rules.yaml`
- Create `tests/test_context_guard.py`
- Create `docs/runbooks/subagent-brief-rules.md`
- Edit `skills/curated/dispatch-codex/SKILL.md`
- Describe (do not apply): `.claude/settings.json` PreToolUse arming entry

(The `## Session model` writer lives in Task 1 Step 7 — already landed by the time this task
runs, per the ordering note at the top of this plan.)

### Interfaces
```js
// scripts/hooks/context_guard.js  (CLI entry point; runs main() at load, hard_ceiling_guard.js's
// idiom — exit 2 + stderr for a real denial, exit 0 otherwise, NEVER hook_io.js's always-0 run())
function parseRulesFile(text) -> {read_extensions, read_models, read_message, rules[]}
function compileRule(raw) -> {id, tool, kind, trigger: RegExp, escape: RegExp|null, limitBytes, message} | null
function loadRules(filePath) -> {readExtensions[], readModels[], readMessage, rules[]}
function sessionModel(sessionId, env) -> string|null   // reads '## Session model' via lib/context_store.js
function checkRead(event, cfg, env) -> string|null     // deny message, or null (allow)
function checkBash(event, cfg) -> string|null
```

### Step 1 — failing tests

Create `tests/test_context_guard.py`:

```python
"""tests/test_context_guard.py — scripts/hooks/context_guard.js (PreToolUse Read|Bash).

Fail-open everywhere EXCEPT the two named denial classes (exit 2 + '[context-guard BLOCK]' on
stderr). Every test drives the real committed hook + rules file as a subprocess -- never requires
the .js directly (same posture as tests/test_hard_ceiling_guard.py)."""
import json
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "context_guard.js"
RULES = REPO / "scripts" / "hooks" / "context_guard.rules.yaml"


def run_hook(tmp_path, event, store_dir=None):
    pf = tmp_path / "payload.json"
    pf.write_text(json.dumps(event), encoding="utf-8")
    env = {**os.environ}
    if store_dir is not None:
        env["KB_CONTEXT_STORE_DIR"] = str(store_dir)
    return subprocess.run(["node", str(HOOK)], input=pf.read_bytes(), capture_output=True, env=env)


def write_session_model(store_dir, session_id, model):
    store_dir.mkdir(parents=True, exist_ok=True)
    (store_dir / f"{session_id}.ctx.md").write_text(
        "<!-- kb context-lifecycle store. Generated by the INERT context-lifecycle hooks; do not hand-edit. -->\n\n"
        f"## Session model\n\n{model}\n",
        encoding="utf-8",
    )


def read_event(session_id, cwd, file_path):
    return {"hook_event_name": "PreToolUse", "tool_name": "Read", "session_id": session_id,
            "cwd": str(cwd), "tool_input": {"file_path": str(file_path)}}


def bash_event(command, cwd):
    return {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": str(cwd),
            "tool_input": {"command": command}}


# ── Read: PDF/image + Fable/Opus ─────────────────────────────────────────────────────────────

def test_pdf_read_denied_for_opus(tmp_path):
    store_dir = tmp_path / "store"
    write_session_model(store_dir, "sess-1", "claude-opus-5")
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, read_event("sess-1", tmp_path, pdf), store_dir)
    assert r.returncode == 2
    assert b"[context-guard BLOCK]" in r.stderr
    assert b"haiku" in r.stderr


def test_pdf_read_denied_for_fable(tmp_path):
    store_dir = tmp_path / "store"
    write_session_model(store_dir, "sess-f", "claude-fable-5-1")
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, read_event("sess-f", tmp_path, pdf), store_dir)
    assert r.returncode == 2


def test_pdf_read_allowed_for_sonnet(tmp_path):
    store_dir = tmp_path / "store"
    write_session_model(store_dir, "sess-2", "claude-sonnet-5")
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, read_event("sess-2", tmp_path, pdf), store_dir)
    assert r.returncode == 0 and r.stderr.strip() == b""


def test_pdf_read_allowed_when_no_model_note(tmp_path):
    store_dir = tmp_path / "store"
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, read_event("sess-none", tmp_path, pdf), store_dir)
    assert r.returncode == 0


def test_txt_read_allowed_for_opus(tmp_path):
    store_dir = tmp_path / "store"
    write_session_model(store_dir, "sess-3", "claude-opus-5")
    txt = tmp_path / "notes.txt"
    txt.write_text("hi", encoding="utf-8")
    r = run_hook(tmp_path, read_event("sess-3", tmp_path, txt), store_dir)
    assert r.returncode == 0


# ── Bash: pytest / git log / find / — with escapes ───────────────────────────────────────────

def test_pytest_without_filter_denied(tmp_path):
    r = run_hook(tmp_path, bash_event("pytest tests/", tmp_path))
    assert r.returncode == 2
    assert b"pytest -q" in r.stderr


def test_pytest_with_q_allowed(tmp_path):
    r = run_hook(tmp_path, bash_event("pytest tests/ -q", tmp_path))
    assert r.returncode == 0


def test_pytest_piped_to_tail_allowed(tmp_path):
    r = run_hook(tmp_path, bash_event("pytest tests/ | tail -n 30", tmp_path))
    assert r.returncode == 0


def test_git_log_unbounded_denied(tmp_path):
    r = run_hook(tmp_path, bash_event("git log", tmp_path))
    assert r.returncode == 2


def test_git_log_with_n_allowed(tmp_path):
    r = run_hook(tmp_path, bash_event("git log -n 20", tmp_path))
    assert r.returncode == 0


def test_git_log_oneline_allowed(tmp_path):
    r = run_hook(tmp_path, bash_event("git log --oneline -n 20", tmp_path))
    assert r.returncode == 0


def test_find_root_denied(tmp_path):
    r = run_hook(tmp_path, bash_event("find / -name '*.log'", tmp_path))
    assert r.returncode == 2


def test_find_scoped_allowed(tmp_path):
    r = run_hook(tmp_path, bash_event("find . -name '*.log'", tmp_path))
    assert r.returncode == 0


def test_cat_large_file_denied(tmp_path):
    big = tmp_path / "big.log"
    big.write_bytes(b"x" * (60 * 1024))
    r = run_hook(tmp_path, bash_event(f"cat {big.name}", tmp_path))
    assert r.returncode == 2
    assert b"50 KB" in r.stderr


def test_cat_small_file_allowed(tmp_path):
    small = tmp_path / "small.log"
    small.write_bytes(b"x" * 100)
    r = run_hook(tmp_path, bash_event(f"cat {small.name}", tmp_path))
    assert r.returncode == 0


def test_cat_large_file_piped_to_tail_allowed(tmp_path):
    big = tmp_path / "big.log"
    big.write_bytes(b"x" * (60 * 1024))
    r = run_hook(tmp_path, bash_event(f"cat {big.name} | tail -n 50", tmp_path))
    assert r.returncode == 0


def test_cat_nonexistent_file_fails_open(tmp_path):
    r = run_hook(tmp_path, bash_event("cat does-not-exist.log", tmp_path))
    assert r.returncode == 0  # can't stat it -> not this hook's job to say so


def test_benign_bash_silent(tmp_path):
    r = run_hook(tmp_path, bash_event("echo hello", tmp_path))
    assert r.returncode == 0 and r.stderr.strip() == b""


# ── fail-open ─────────────────────────────────────────────────────────────────────────────────

def test_fail_open_on_garbage(tmp_path):
    r = subprocess.run(["node", str(HOOK)], input=b"not json", capture_output=True)
    assert r.returncode == 0 and r.stderr.strip() == b""


def test_fail_open_on_empty_stdin(tmp_path):
    r = subprocess.run(["node", str(HOOK)], input=b"", capture_output=True)
    assert r.returncode == 0 and r.stderr.strip() == b""


def test_fail_open_on_foreign_event(tmp_path):
    r = run_hook(tmp_path, {"hook_event_name": "Stop"})
    assert r.returncode == 0 and r.stderr.strip() == b""


def test_fail_open_on_unrecognised_tool(tmp_path):
    r = run_hook(tmp_path, {"hook_event_name": "PreToolUse", "tool_name": "Edit", "tool_input": {}})
    assert r.returncode == 0


# ── config shape pin ──────────────────────────────────────────────────────────────────────────

def test_rules_file_has_required_rule_ids():
    """Pin the config's shape: context_guard.js's hand-rolled parser (same pattern as
    lib/model_audit.js's parseAllowedModels) has no schema validation -- a reformat that drops a
    field fails OPEN (silently fewer rules), never crashes, so this is the safety net."""
    text = RULES.read_text(encoding="utf-8")
    assert "read_extensions:" in text and "read_models:" in text and "rules:" in text
    for required in ("bash-pytest-no-filter", "bash-git-log-unbounded", "bash-find-root", "bash-cat-large-file"):
        assert f"id: {required}" in text
```

### Step 2 — run, confirm failure (missing files)

### Step 3 — implement

Create `scripts/hooks/context_guard.rules.yaml`:

```yaml
# scripts/hooks/context_guard.rules.yaml — kb PreToolUse context guard, Daniel-owned rule config.
#
# LOCATION RULING (2026-09-11): this file overrides the spec's suggested `governance/` path.
# `governance/` is human-edited only per the constitution; this file is meant to be tuned by any
# agent without a human committing YAML, so it lives beside the hook that reads it instead.
#
# PARSED BY A HAND-ROLLED SCANNER, not a YAML library -- kb hooks take no dependencies (see
# scripts/hooks/lib/model_audit.js's parseAllowedModels for the established precedent reading
# governance/model-routing.yaml the same way). Keep every value on ONE line; arrays are
# flow-style only (`[a, b]`); the `rules:` list uses `- id: ...` at 2-space indent and further
# fields at deeper indent, one `key: value` per line. A reformat outside this shape is NOT an
# error -- context_guard.js fails OPEN on anything it can't parse (fewer or zero rules loaded,
# never a crash), and tests/test_context_guard.py's config-shape test is the safety net that
# catches a silent reformat.

read_extensions: [.pdf, .png, .jpg, .jpeg, .gif, .webp, .bmp, .tiff]
read_models: [fable, opus]
read_message: delegate to a haiku extractor (Agent, model haiku) and read its summary

rules:
  - id: bash-pytest-no-filter
    tool: Bash
    trigger: \bpytest\b
    escape: (-q\b|--quiet\b|\|\s*(tail|head|grep)\b|>\s*\S)
    message: re-run as `pytest -q` or pipe through `| tail -n 50` -- a full pytest run floods the tool result
  - id: bash-git-log-unbounded
    tool: Bash
    trigger: \bgit\s+log\b
    escape: (-n\s*\d|--oneline\b|-\d+\b|\|\s*(head|tail|grep)\b|>\s*\S)
    message: re-run as `git log -n 20` or `git log --oneline -n 20`
  - id: bash-find-root
    tool: Bash
    trigger: \bfind\s+/(\s|$)
    message: scope `find` to a subdirectory, e.g. `find . -name ...`, never the filesystem root
  - id: bash-cat-large-file
    tool: Bash
    kind: cat-size
    trigger: ^\s*cat\s+(\S+)
    escape: \|\s*(head|tail|grep|less|more)\b
    limit_bytes: 51200
    message: file is over 50 KB -- pipe through `| tail -c 50000` or delegate the read to a subagent
```

Create `scripts/hooks/context_guard.js`:

```js
#!/usr/bin/env node
/**
 * kb PreToolUse:Read|Bash hook — CONTEXT GUARD (L3, token-discipline spec S5).
 *
 * Deliberately on the OLDER exit-code + stderr idiom (hard_ceiling_guard.js's style), NOT
 * lib/hook_io.js's `run()` (which only ever exits 0) -- this hook must be able to say no.
 *
 * Two independent denial classes, both fail-open beyond their own narrow trigger:
 *   1. Read of a configured extension (default: PDF/image) in a session whose recorded model
 *      (scripts/hooks/lib/context_store.js's '## Session model', written by
 *      project_frame_session_start.js from `event.model` when present) matches a configured
 *      substring (default: fable/opus). No model note recorded -> ALLOW (spec: "else no guard").
 *   2. Bash matching a configured verbose-command pattern with no escape hatch present
 *      (pytest without -q/tail|head|grep, unbounded `git log`, `find /`, `cat` of a file over a
 *      configured byte limit unless piped through a filter).
 *
 * Rules are read from context_guard.rules.yaml (Daniel-owned, hand-parsed -- see that file's own
 * header for why no YAML library is used). A missing or malformed rules file degrades to ZERO
 * rules loaded (fail open), never a crash.
 *
 * Exit codes: 0 = allow (including every fail-open path). 2 = deny, with
 * "[context-guard BLOCK] <message>" on stderr and NOTHING on stdout.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const store = require("./lib/context_store.js");

const RULES_PATH = path.join(__dirname, "context_guard.rules.yaml");
const MAX_STDIN = 1024 * 1024;
const SESSION_MODEL_HEADING = "Session model";

function parseFlowArray(raw) {
  const m = /^\[(.*)\]$/.exec(raw.trim());
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

function parseRulesFile(text) {
  const top = { read_extensions: [], read_models: [], read_message: "", rules: [] };
  let currentRule = null;
  let inRulesList = false;

  for (const rawLine of String(text || "").replace(/\r\n/g, "\n").split("\n")) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;

    const topArray = /^(read_extensions|read_models):\s*(\[.*\])\s*$/.exec(rawLine);
    if (topArray) {
      top[topArray[1]] = parseFlowArray(topArray[2]);
      continue;
    }
    const topScalar = /^read_message:\s*(.*)$/.exec(rawLine);
    if (topScalar) {
      top.read_message = topScalar[1].trim();
      continue;
    }
    if (/^rules:\s*$/.test(rawLine)) {
      inRulesList = true;
      continue;
    }
    if (!inRulesList) continue;

    const newRule = /^\s*-\s*id:\s*(.+?)\s*$/.exec(rawLine);
    if (newRule) {
      if (currentRule) top.rules.push(currentRule);
      currentRule = { id: newRule[1] };
      continue;
    }
    const field = /^\s+([a-z_]+):\s*(.*)$/.exec(rawLine);
    if (field && currentRule) {
      currentRule[field[1]] = field[2].trim();
    }
    // any other line inside the rules list is ignored, not fatal -- fail open, never crash.
  }
  if (currentRule) top.rules.push(currentRule);
  return top;
}

function compileRule(raw) {
  if (!raw || typeof raw.id !== "string" || typeof raw.trigger !== "string" || !raw.tool) {
    return null;
  }
  let trigger;
  try {
    trigger = new RegExp(raw.trigger);
  } catch (_err) {
    return null;
  }
  let escape = null;
  if (raw.escape) {
    try {
      escape = new RegExp(raw.escape);
    } catch (_err) {
      escape = null;
    }
  }
  return {
    id: raw.id,
    tool: raw.tool,
    kind: raw.kind || "regex",
    trigger,
    escape,
    limitBytes: raw.limit_bytes ? Number(raw.limit_bytes) : null,
    message: raw.message || "denied by context guard",
  };
}

function loadRules(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (_err) {
    return { readExtensions: [], readModels: [], readMessage: "", rules: [] };
  }
  const parsed = parseRulesFile(text);
  return {
    readExtensions: parsed.read_extensions.map((e) => e.toLowerCase()),
    readModels: parsed.read_models.map((m) => m.toLowerCase()),
    readMessage: parsed.read_message,
    rules: parsed.rules.map(compileRule).filter(Boolean),
  };
}

function extractEvent(rawInput) {
  const trimmed = String(rawInput || "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function sessionModel(sessionId, env) {
  if (!sessionId) return null;
  const sections = store.readStore(sessionId, env);
  const body = store.sectionBody(sections, SESSION_MODEL_HEADING);
  return body ? body.trim().toLowerCase() : null;
}

function extensionOf(filePath) {
  const m = /\.[a-z0-9]+$/i.exec(String(filePath || ""));
  return m ? m[0].toLowerCase() : "";
}

function checkRead(event, cfg, env) {
  const filePath = event.tool_input && event.tool_input.file_path;
  if (typeof filePath !== "string" || !filePath) return null;
  if (!cfg.readExtensions.includes(extensionOf(filePath))) return null;
  const model = sessionModel(event.session_id, env);
  if (!model) return null; // no note recorded -> no guard (spec: "else no guard")
  if (!cfg.readModels.some((m) => model.includes(m))) return null;
  return cfg.readMessage || "denied by context guard";
}

function resolveCatTarget(command, cwd) {
  const m = /^\s*cat\s+(\S+)/.exec(command);
  if (!m) return null;
  const token = m[1].replace(/^["']|["']$/g, "");
  if (/[*?$`|;&<>]/.test(token)) return null; // not a plain literal path -- don't try to stat it
  return path.isAbsolute(token) ? token : path.join(cwd || ".", token);
}

function checkBash(event, cfg) {
  const command = event.tool_input && event.tool_input.command;
  if (typeof command !== "string" || !command) return null;
  for (const rule of cfg.rules) {
    if (rule.tool !== "Bash") continue;
    if (!rule.trigger.test(command)) continue;
    if (rule.escape && rule.escape.test(command)) continue;
    if (rule.kind === "cat-size") {
      const target = resolveCatTarget(command, event.cwd);
      if (!target) continue;
      let size;
      try {
        size = fs.statSync(target).size;
      } catch (_err) {
        continue; // can't stat it -> not this hook's job to say so
      }
      if (size <= (rule.limitBytes || Infinity)) continue;
    }
    return rule.message;
  }
  return null;
}

function main() {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch (_err) {
    raw = "";
  }
  const event = extractEvent(raw.slice(0, MAX_STDIN));
  if (!event) {
    process.exit(0);
  }
  if (event.hook_event_name && event.hook_event_name !== "PreToolUse") {
    process.exit(0);
  }

  const cfg = loadRules(RULES_PATH);
  let denyMessage = null;
  try {
    if (event.tool_name === "Read") {
      denyMessage = checkRead(event, cfg, process.env);
    } else if (event.tool_name === "Bash") {
      denyMessage = checkBash(event, cfg);
    }
  } catch (_err) {
    process.exit(0); // any classifier failure fails OPEN -- never wedges the tool call
  }

  if (denyMessage) {
    process.stderr.write("[context-guard BLOCK] " + denyMessage + "\n");
    process.exit(2);
  }
  process.exit(0);
}

main();
```

### Step 4 — run, confirm green
`py -3 -m pytest tests/test_context_guard.py -q`

### Step 5 — settings arming (described only)

`.claude/settings.json`'s `"PreToolUse"` array gains one more matcher entry (merged alongside the
existing `Bash`/`Edit|Write`/`Agent|Task` entries — never replacing them):

```json
      {
        "matcher": "Read|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/Users/danie/kb/scripts/hooks/context_guard.js\""
          }
        ]
      }
```

Not applied by this plan (out of scope for this worktree). Task 7 verifies it live once Daniel
applies it.

### Step 6 — brief rule doc + dispatch-codex SKILL.md

Create `docs/runbooks/subagent-brief-rules.md`:

```markdown
# Subagent brief rules

One rule, referenced from every dispatch surface (Claude Agent tool briefs AND
`dispatch-codex` briefs) rather than restated in each: a token-burn driver the
2026-09-11 token-discipline evidence found directly (Table B/E: 24-35 subagents
per boss session, subagent turns = 31-41% of total cost) is a subagent's own
tool-result bytes flowing straight back into the PARENT's context through its
final message.

**The rule:** every dispatched worker (Agent-tool subagent or `dispatch-codex`
worker) writes its full findings/diffs/output to a file (its own scratchpad, or
a path the brief names) and returns AT MOST 300 WORDS in its final message —
the verdict, the file path(s), and anything the dispatcher must act on. Never
paste a diff, a log, or a search result wholesale into the final message when a
file path would do.

This is advisory (ruling 2026-09-11: measure only, no enforcement) — no hook
checks message length. It is a brief-writing habit: every dispatch template
should say it explicitly, because a worker with no such instruction defaults
to being thorough in its own reply, which is the opposite of what the parent's
context budget needs.
```

Edit `skills/curated/dispatch-codex/SKILL.md`: add a bullet to the existing "Rules" section
(after "Parallel dispatches are fine..."):

```
- Brief rule (docs/runbooks/subagent-brief-rules.md): every brief instructs the worker to write
  full output to a file and return <= 300 words in its final message — never paste a diff or log
  wholesale into the reply.
```

Run `py -3 scripts/sync_skills.py` to propagate.

### Step 7 — commit
`feat(token-discipline): context_guard.js PreToolUse hook + rules.yaml (L3) + brief-rule doc`

---

## Task 4 — L4: load context

### Files
- Edit `.claude/agents/fyt-runner.md`
- (No code change for `agents/*.md` catalog or MEMORY.md — documented below)

### Step 1 — `mcpServers` restriction

`.claude/agents/fyt-runner.md` is the ONLY native Claude Code agent definition in this repo
(confirmed: `find . -iname agents -type d` finds `.claude/agents` [1 file: `fyt-runner.md`],
`agents/` [18 files, kb's OWN routing/registry catalog — role/runtime/model resolution consumed
by `scripts/routing.py` and `scripts/codex_dispatch.py`, a different artifact Claude Code has
never heard of as an "agent definition" — `mcpServers` there would be inert, not a restriction],
plus `dashboard/server/agents` and `evals/agents`, neither of which are Claude Code subagent
definitions either). `grep -n "mcp__\|chrome-devtools\|playwright\|MCP" agents/fyt-runner.md`
returns nothing — fyt-runner drives the project's own skills, never a browser or Gmail/Drive/video
MCP tool. Safe to restrict.

Edit the frontmatter:

```yaml
---
name: fyt-runner
description: Gates-first conductor for one faceless-youtube video run, idea → published-private, inside orgs/faceless-youtube. Use to run or resume a video pipeline run, run a single stage, or do a targeted repair (e.g. "regen shots 12+43 and re-review"). It drives the project's skills via the committed workflow segments (segment-a → GATE 1 script review → segment-b1 → GATE 2 shot board → segment-b2 → GATE 3 compliance + publish approval → segment-c), enforces the single-writer rule, the honest three-state review stamp, and the spend law. Supersedes faceless-producer (2026-07-20). Public flips and thumbnail-set stay human-only in Studio.
model: opus
mcpServers: []
---
```

(One line added: `mcpServers: []`. Everything else in the file is unchanged.)

No automated test exists for `.claude/agents/*.md` frontmatter in this repo today (confirmed: no
`test_*agent*frontmatter*` file under `tests/`) — adding one is out of this plan's scope (it
would need to assert against the harness's own frontmatter contract, which this plan cannot
observe from inside a worktree); Task 7's live-check list includes a manual confirmation instead
("dispatch fyt-runner once, confirm it still completes normally with no MCP tool available").

### Step 2 — what does NOT change, and why (documented, not coded)

- The 17 other `agents/*.md` files (kb's routing catalog) get no `mcpServers` field: it is not a
  concept that format recognizes, and adding it would be silently inert — recorded here so a
  future reader doesn't wonder why only one of 18 agent files was touched.
- `MEMORY.md` (personal, outside this repo) gets no code change; Task 2's proposed-diff file
  (Step 5, hunk 4) already carries the boss-habit instruction to collapse closed arcs by hand at
  session close.
- `BOSS.md`'s trim proposal is the SAME diff file from Task 2 (hunk 3) — not duplicated here.

### Step 3 — commit
`feat(token-discipline): restrict fyt-runner's MCP servers (L4) — only native agent def in repo`

---

## Task 5 — L5: dispatch-codex defaults

### Files
- Edit `scripts/codex_dispatch.py`
- Edit `tests/test_codex_dispatch.py`
- Edit `skills/curated/dispatch-codex/SKILL.md`

### Step 1 — failing tests

Add to `tests/test_codex_dispatch.py` (uses the file's existing `repo`/`prompt_file` fixtures and
`_main_env` helper):

```python
def test_default_effort_is_medium_when_unspecified(repo, prompt_file, tmp_path, monkeypatch):
    seen = _main_env(monkeypatch, tmp_path)
    codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo)])
    assert seen["effort"] == "medium"


def test_explicit_effort_overrides_default(repo, prompt_file, tmp_path, monkeypatch):
    seen = _main_env(monkeypatch, tmp_path)
    codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo), "--effort", "low"])
    assert seen["effort"] == "low"


def test_follow_up_allowed_within_hop_limit(repo, prompt_file, tmp_path, monkeypatch):
    seen = _main_env(monkeypatch, tmp_path)
    monkeypatch.setattr(codex_dispatch, "parse_thread_id", lambda *_: "thread-1")
    rc1 = codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo),
                               "--follow-up", "thread-1"])
    rc2 = codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo),
                               "--follow-up", "thread-1"])
    assert rc1 == 0 and rc2 == 0


def test_follow_up_refused_past_hop_limit(repo, prompt_file, tmp_path, monkeypatch):
    _main_env(monkeypatch, tmp_path)
    monkeypatch.setattr(codex_dispatch, "parse_thread_id", lambda *_: "thread-2")
    for _ in range(codex_dispatch.FOLLOW_UP_HOP_LIMIT):
        rc = codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo),
                                  "--follow-up", "thread-2"])
        assert rc == 0
    rc = codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo),
                              "--follow-up", "thread-2"])
    assert rc == 2


def test_follow_up_hop_refusal_message_names_the_thread(repo, prompt_file, tmp_path, monkeypatch, capsys):
    _main_env(monkeypatch, tmp_path)
    monkeypatch.setattr(codex_dispatch, "parse_thread_id", lambda *_: "thread-3")
    for _ in range(codex_dispatch.FOLLOW_UP_HOP_LIMIT):
        codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo),
                             "--follow-up", "thread-3"])
    capsys.readouterr()
    codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo),
                         "--follow-up", "thread-3"])
    out = capsys.readouterr().out
    assert "thread-3" in out and "DISPATCH REFUSED" in out and "--cwd" in out
```

### Step 2 — run, confirm failure (`AttributeError: FOLLOW_UP_HOP_LIMIT`, and the effort default
assertion fails since the current default is `None`)

### Step 3 — implement

Edit `scripts/codex_dispatch.py`:

1. Change the `--effort` default:

```python
    ap.add_argument("--effort", choices=EFFORTS, default="medium",
                    help="default medium (ruling 2026-09-11: child dispatches run lower effort "
                         "than the gpt-6-astra interactive boss terminal)")
```

2. Add a hop-limit constant and two functions, near `load_threads`/`remember_thread`:

```python
FOLLOW_UP_HOP_LIMIT = 2  # ruling 2026-09-11: past this, start a fresh --cwd dispatch instead
                          # (lesson: codex-followup-loses-cwd.md)


def load_hops() -> dict:
    """{thread_id: hop_count}. Corrupt/missing -> empty, never fatal -- a lost counter
    under-counts (a thread gets a few extra hops before the limit re-engages), never
    over-refuses a thread that should still be allowed."""
    try:
        hops = json.loads((STATE_ROOT / "follow_up_hops.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return hops if isinstance(hops, dict) else {}


def record_hop(thread_id: str | None) -> int:
    if not thread_id:
        return 0
    hops = load_hops()
    count = int(hops.get(thread_id, 0)) + 1
    hops[thread_id] = count
    try:
        (STATE_ROOT / "follow_up_hops.json").parent.mkdir(parents=True, exist_ok=True)
        (STATE_ROOT / "follow_up_hops.json").write_text(json.dumps(hops, indent=1), encoding="utf-8")
    except OSError:
        pass  # best-effort -- see load_hops' fail-open note
    return count
```

3. In `main()`, right after the existing `--follow-up`-refuses-`--worktree`/`--cwd`/`--sandbox`
   block, add the hop-limit refusal:

```python
    if args.follow_up:
        hops = load_hops()
        if hops.get(args.follow_up, 0) >= FOLLOW_UP_HOP_LIMIT:
            print(f"DISPATCH REFUSED: session {args.follow_up} has already used "
                  f"{hops[args.follow_up]} --follow-up hops (limit {FOLLOW_UP_HOP_LIMIT}) -- "
                  "start a fresh dispatch with --cwd instead of extending this thread "
                  "(lesson: codex-followup-loses-cwd.md)")
            return 2
```

4. Right where `remember_thread(thread_id or args.follow_up, model)` is already called (after a
   successful dispatch), add the hop record for a follow-up specifically:

```python
    remember_thread(thread_id or args.follow_up, model)
    if args.follow_up:
        record_hop(args.follow_up)
```

### Step 4 — run, confirm green
`py -3 -m pytest tests/test_codex_dispatch.py -q`

### Step 5 — `dispatch-codex` SKILL.md: document the defaults

Edit the "Models" section's intro line and add one "Rules" bullet:

```
## Models

Every dispatch runs `-c model_reasoning_effort=medium` by default (ruling 2026-09-11 — pass
`--effort <low|high|xhigh|max>` to override; the interactive `gpt-6-astra` BOSS terminal is
untouched by this default, it only applies to dispatched children):

- `codex-cheap` (gpt-5.6-luna) — mechanical/bulk work
- `codex` (gpt-5.6-terra, default) — standard build/review work
- `codex-deep` (gpt-5.6-sol) — hard design/debugging; add `--effort xhigh` for the hardest
...
```

And in "Rules":
```
- `--follow-up` is capped at 2 hops per thread (ruling 2026-09-11); the 3rd extension is
  refused with the thread id and a reminder to start fresh with `--cwd` — see
  codex-followup-loses-cwd.md for why a stale --cwd is worse than a new dispatch.
```

Run `py -3 scripts/sync_skills.py`.

### Step 6 — commit
`feat(token-discipline): dispatch-codex default effort=medium + follow-up hop limit (L5)`

---

## Task 6 — Cleanup

### Files (delete)
- `docs/plans/2026-08-18-agent-platform-GOAL-STATE.md`
- `docs/proposals/regrounding-hook.md`
- `docs/proposals/context-lifecycle-hooks.md`
- `docs/proposals/spawn-model-verify-hooks.md`

### Files (edit — repair references so nothing dangles)
- `tests/fixtures/regrounding-source-fixture.md` (NEW — replaces the deleted GOAL-STATE doc as a
  test fixture)
- `tests/test_regrounding_hook.py`
- `scripts/hooks/regrounding_hook.js`
- `scripts/hooks/subagent_context_load.js`
- `scripts/hooks/model_verify_subagentstop.js`
- `scripts/hooks/model_verify_pretooluse.js`
- `scripts/hooks/lib/model_audit.js`
- `scripts/hooks/lib/context_store.js`
- `scripts/hooks/context_lifecycle_session_start.js`
- `scripts/hooks/context_lifecycle_pre_compact.js`
- `tests/test_subagent_context_load.py`
- `tests/test_model_verify.py`
- Create `tests/test_cleanup_no_dangling_refs.py`

### Step 0 — pre-check: is there arm-time-check content to fold forward first?

Already checked (part of writing this plan, recorded here rather than re-done at execution time):
all three `docs/proposals/*hook*.md` files carry `**Status:** ARMED 2026-09-11 — see
docs/superpowers/specs/2026-09-11-project-frame-hooks-design.md`, and that design spec's own §7
line 134 already states "the committed paths (arm-time Check 3 from the proposals becomes
permanent)" — i.e. the fold-forward the delegator's brief asked for already happened when that
spec and its plan (`docs/superpowers/plans/2026-09-11-project-frame-hooks.md`, Task 8's "Manual
live check" sections) were written. **Verdict: nothing further to fold.** The four files below
are pure duplication now; delete them as-is.

### Step 1 — find every reference (already run; results below)

```
grep -rl "docs/proposals/regrounding-hook\.md\|docs/proposals/context-lifecycle-hooks\.md\|docs/proposals/spawn-model-verify-hooks\.md\|2026-08-18-agent-platform-GOAL-STATE" --include=*.js --include=*.py --include=*.md .
```

19 files matched. Two categories:

**(A) Live, load-bearing references — FIX these:**
| File | What it says | Fix |
| --- | --- | --- |
| `tests/test_regrounding_hook.py:8` | `GOAL_STATE = REPO / "docs" / "plans" / "2026-08-18-agent-platform-GOAL-STATE.md"` — a REAL path used as a `KB_GOAL_STATE_PATH` override target in ~20 test cases | Point at a new committed fixture instead (Step 2 below) |
| `scripts/hooks/regrounding_hook.js:16,65` | "See docs/proposals/regrounding-hook.md" / "docs/proposals/regrounding-hook.md decision-notes" | Repoint at the design spec |
| `scripts/hooks/subagent_context_load.js:14` | "preconditions and decision-notes live in docs/proposals/spawn-model-verify-hooks.md" | Repoint |
| `scripts/hooks/model_verify_subagentstop.js:13` | same | Repoint |
| `scripts/hooks/model_verify_pretooluse.js:14` | same | Repoint |
| `scripts/hooks/lib/model_audit.js:9` | same | Repoint |
| `scripts/hooks/lib/context_store.js:14,247` | "docs/proposals/context-lifecycle-hooks.md" (twice) | Repoint |
| `scripts/hooks/context_lifecycle_session_start.js:19` | same | Repoint |
| `scripts/hooks/context_lifecycle_pre_compact.js:24` | same | Repoint |
| `tests/test_subagent_context_load.py:11` | doc-comment pointer | Repoint |
| `tests/test_model_verify.py:13` | doc-comment pointer | Repoint |

**(B) Archival historical records — LEAVE UNTOUCHED, and exclude from the dangling-ref check:**
`docs/superpowers/specs/2026-08-19-wave2-overnight-design.md`,
`docs/superpowers/plans/2026-08-19-wave2-overnight.md`,
`docs/superpowers/plans/2026-08-18-agent-infra.md`,
`docs/plans/2026-08-18-agent-platform-program-spec.md`,
`docs/plans/2026-08-18-agent-platform-w1-BUILD-PLAN.md` — these are dated, closed/shipped plans
that mention the GOAL-STATE doc or a proposal file as part of THEIR OWN historical record of what
was planned at the time. Rewriting history in a closed plan is undesirable (and out of the
delegator's named scope, which is four specific files) — left alone. `docs/superpowers/specs/
2026-09-11-token-discipline-design.md` and `docs/superpowers/plans/2026-09-11-project-frame-hooks.md`
/ `...-design.md` are the CURRENT, still-referenced pair and are covered by category (A)'s
principle, but their own mentions are self-referential (naming the plan/spec that superseded the
proposals, which is the CORRECT permanent record) — no edit needed there; confirm this with a
targeted read before Task 6's final grep, since a stray literal path in either would need the
same repoint as category A.

### Step 2 — new test fixture (fixes `tests/test_regrounding_hook.py`)

The dead doc's only property the tests rely on: a real, readable file with `## North star` and
`## Invariants` headings (regrounding_hook.js's `WANTED_SECTIONS`/`extractSection` reads those;
tests assert only the rendered LABELS "North star:"/"Invariants:" appear — never the dead doc's
actual words, confirmed by reading every `GOAL_STATE`-adjacent assertion in the file).

Create `tests/fixtures/regrounding-source-fixture.md`:

```markdown
# regrounding hook test fixture — NOT read by any hook at runtime

Stand-in file for tests/test_regrounding_hook.py's `KB_GOAL_STATE_PATH` override tests. Replaces
the deleted `docs/plans/2026-08-18-agent-platform-GOAL-STATE.md` (2026-09-11 token-discipline
cleanup, Task 6) — content is arbitrary; only the heading shape (`## North star`, `##
Invariants`) matters, since that is what `scripts/hooks/regrounding_hook.js`'s
`WANTED_SECTIONS`/`extractSection` reads.

## North star
Fixture north-star text for tests only.

## Invariants
Fixture invariants text for tests only.
```

Edit `tests/test_regrounding_hook.py` line 8:

Old: `GOAL_STATE = REPO / "docs" / "plans" / "2026-08-18-agent-platform-GOAL-STATE.md"`
New: `GOAL_STATE = REPO / "tests" / "fixtures" / "regrounding-source-fixture.md"`

Run `py -3 -m pytest tests/test_regrounding_hook.py -q` — confirm still green (this is a pure
fixture swap; every assertion in that file checks labels/behavior, not the dead doc's wording).

### Step 3 — repoint the 10 doc-comment references

Each is a one-line text substitution (`docs/proposals/<X>.md` → the design spec that superseded
it). Example (`scripts/hooks/regrounding_hook.js:16`):

Old: `"compact"), UserPromptSubmit, and PostToolUse. See docs/proposals/regrounding-hook.md.`
New: `"compact"), UserPromptSubmit, and PostToolUse. See
docs/superpowers/specs/2026-09-11-project-frame-hooks-design.md (the regrounding-hook.md proposal
that originated this design is deleted, 2026-09-11 token-discipline cleanup).`

Apply the same substitution pattern (repoint `docs/proposals/<name>.md` → `
docs/superpowers/specs/2026-09-11-project-frame-hooks-design.md`, with the same one-clause
"(... proposal ... is deleted, 2026-09-11 token-discipline cleanup)" note) to the other 9 sites
listed in Step 1's table (A).

### Step 4 — delete the four files
```
git rm docs/plans/2026-08-18-agent-platform-GOAL-STATE.md
git rm docs/proposals/regrounding-hook.md docs/proposals/context-lifecycle-hooks.md docs/proposals/spawn-model-verify-hooks.md
```

### Step 5 — the dangling-reference test

Create `tests/test_cleanup_no_dangling_refs.py`:

```python
"""No committed, non-archival file names a path this repo has deleted. Archival plan/spec docs
(dated historical records of what was planned/shipped at the time) are excluded deliberately --
rewriting their own history is out of scope; see docs/superpowers/plans/2026-09-11-token-discipline.md
Task 6 for the reasoning."""
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

DELETED_PATHS = [
    "docs/plans/2026-08-18-agent-platform-GOAL-STATE.md",
    "docs/proposals/regrounding-hook.md",
    "docs/proposals/context-lifecycle-hooks.md",
    "docs/proposals/spawn-model-verify-hooks.md",
]

ARCHIVAL_ALLOWLIST = {
    "docs/superpowers/specs/2026-08-19-wave2-overnight-design.md",
    "docs/superpowers/plans/2026-08-19-wave2-overnight.md",
    "docs/superpowers/plans/2026-08-18-agent-infra.md",
    "docs/plans/2026-08-18-agent-platform-program-spec.md",
    "docs/plans/2026-08-18-agent-platform-w1-BUILD-PLAN.md",
}


def _tracked_files() -> list[str]:
    r = subprocess.run(["git", "-C", str(REPO), "ls-files"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return [line for line in r.stdout.splitlines() if line]


def test_no_committed_file_references_a_deleted_path():
    offenders = []
    for rel in _tracked_files():
        if rel in ARCHIVAL_ALLOWLIST or rel.startswith("node_modules/"):
            continue
        full = REPO / rel
        if not full.is_file():
            continue
        try:
            text = full.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for dead in DELETED_PATHS:
            if dead in text:
                offenders.append(f"{rel} references {dead}")
    assert not offenders, "\n".join(offenders)


def test_deleted_paths_no_longer_exist_on_disk():
    for dead in DELETED_PATHS:
        assert not (REPO / dead).exists(), dead
```

Run `py -3 -m pytest tests/test_cleanup_no_dangling_refs.py -q` — red before Step 3/4, green
after. This test is intentionally red-on-revert for exactly this cleanup: reintroducing any of
the four files, or a reference to one, fails it immediately.

### Step 6 — run the full repaired suite
```
py -3 -m pytest tests/test_regrounding_hook.py tests/test_subagent_context_load.py tests/test_model_verify.py tests/test_cleanup_no_dangling_refs.py -q
```

### Step 7 — commit
`chore(token-discipline): delete 4 superseded proposal/plan docs; repoint 10 live references; add dangling-ref regression test`

---

## Task 7 — Verification

### Full pytest run (every suite this plan touched or added)
```
py -3 -m pytest tests/test_usage_ledger.py tests/test_preamble.py tests/test_project_frame_session_start.py tests/test_project_frame.py tests/test_project_frame_lint.py tests/test_context_guard.py tests/test_codex_dispatch.py tests/test_regrounding_hook.py tests/test_subagent_context_load.py tests/test_model_verify.py tests/test_cleanup_no_dangling_refs.py tests/test_sync_skills.py tests/test_sync_skills_kit.py -q
```
Then, once confident, the whole suite: `py -3 -m pytest -q` (repo default: `-m "not slow"` per
`pytest.ini`).

### Live checks (require Daniel/boss to have applied the two DESCRIBED settings.json hunks —
Task 2 Step 3 and Task 3 Step 5 — since this plan does not apply them)

1. **Usage line.** Ensure `ledgers/usage/<yesterday>.tsv` exists (run
   `py -3 scripts/usage_ledger.py --date <yesterday>` once by hand if needed — NOT `--no-publish`
   the first real time, so it actually lands on ops). Start a fresh `claude -p` session in this
   repo; confirm the SessionStart context includes a `## Usage (yesterday)` line matching the
   ledger's `_totals` row.
2. **PDF/image guard.** In a session whose model is Fable or Opus, attempt `Read` on any `.pdf`
   in the repo; confirm it is denied with the `[context-guard BLOCK] ... haiku ...` message. In a
   Sonnet/Haiku session, confirm the same Read succeeds.
3. **`autoCompactWindow` visible.** `claude --print-config` (or the harness's equivalent) shows
   `autoCompactWindow: 150k` (or `150000`) once Daniel applies the settings hunk.
4. **Sweep + lint still green.** `py -3 scripts/handoffs_sweep.py` and
   `py -3 scripts/project_frame_lint.py` both still run without crashing (lint's non-zero exit
   against the live `orgs/` tree, for the STILL-missing `## Decisions` headings, is EXPECTED —
   confirm the failure reason is exactly the three known projects missing `## Decisions`, nothing
   new).
5. **fyt-runner still dispatches.** One `Agent` dispatch to `fyt-runner` (a cheap, read-only ask)
   completes normally with `mcpServers: []` in place — confirms the restriction didn't break
   anything that secretly needed an MCP tool.

### Commit
No separate commit for Task 7 (verification only) unless a live check surfaces a fix, in which
case that fix gets its own commit against the task it belongs to.

---

## Self-review

### Spec coverage table

| Spec section | Plan task(s) |
| --- | --- |
| §0 Ruling 1 (measure only) | Global constraints; no warn/enforce code anywhere in Tasks 1–5 |
| §0 Ruling 2 (MCP stays; per-agent restriction only) | Task 4 |
| §0 Ruling 3 (Codex boss stays astra; children lower) | Task 5 (codex_dispatch.py only — interactive terminal untouched) |
| §0 Ruling 4 (boundary, never mid-loop) | Task 2 Step 5 (proposed BOSS.md text — human/boss judgment, not code) |
| §0 Ruling 5 (cleanup, reviewable hunks) | Task 6 |
| §1 Evidence | Cited throughout; mined directly into `usage_ledger.py` (Task 1) and `subagent-brief-rules.md` (Task 3) |
| §2 Five-lever table | One task per lever: L1=Task 1, L2=Task 2, L3=Task 3, L4=Task 4, L5=Task 5 |
| §3 L1 measurement (ledger shape, invocation, frame line, idempotency, ops-write) | Task 1 |
| §4 L2 (Decisions log, compact path, boundary rule, handoff hygiene) | Task 2 |
| §5 L3 (guard rules, denylist file, brief rule) — path OVERRIDDEN per this brief's ruling (`scripts/hooks/context_guard.rules.yaml`, not `governance/`) | Task 3 |
| §6 L4 (Task 0 breakdown, memory index, BOSS.md trim, MCP) | Task 0 (breakdown), Task 4 (MCP + doc pointers), Task 2 Step 5 (BOSS.md/MEMORY.md diff) |
| §7 L5 (dispatch templates, codex effort/hop limit) | Task 3 Step 6 (brief rule doc), Task 5 (codex_dispatch.py) |
| §8 Cleanup (4 named deletions + root-level stray files) | Task 6 (deletions + reference repair); root-level `*.png`/`*_tmp.txt` stray files are UNTRACKED per the dispatch brief's own git-status snapshot — not this plan's to touch (they are not committed, so they cannot be "cleaned up" by a git operation; flagged here for Daniel same as the spec's own §8 says: "listed in the handoff for Daniel to delete") |
| §9 Verification facts | Cited in Task 0 (Probes B/C directly re-verify the two "undocumented; verified empirically" lines) and Task 3/Task 4 (MCP fact) |
| §10 Tests | Task 1 (`test_usage_ledger.py`), Task 3 (`test_context_guard.py`), Task 2 (`test_project_frame_lint.py` Decisions case), Task 1 (`test_project_frame_session_start.py` Usage-line case); live checks in Task 7 |
| §11 Out of scope | Respected — no task adds enforcement, OTel/Grafana, a usage-monitor app, a proxy, or auto-successor-spawning |

### Placeholder scan
No `TBD`, `similar to Task N`, or `add error handling` placeholders in any code block above —
every function body is complete, runnable code (context_guard.js's hand-rolled YAML parser,
usage_ledger.py's streaming JSONL reader, codex_dispatch.py's hop counter, and every test file
are given in full, not sketched).

### Name consistency check
- `usage_ledger.py`'s `TSV_FIELDS` order matches exactly what `write_ledger`/`read_existing_rows`
  both use — a column added to one without the other would silently misalign every row on
  read-back, which `test_cli_is_idempotent_per_day` would catch (it round-trips through both).
- `context_guard.js`'s rule `id`s (`bash-pytest-no-filter`, `bash-git-log-unbounded`,
  `bash-find-root`, `bash-cat-large-file`) are used identically in
  `context_guard.rules.yaml` and pinned by name in `test_rules_file_has_required_rule_ids`.
- `SESSION_MODEL_HEADING = "Session model"` is the ONE literal spelling, defined in
  `project_frame_session_start.js` (writer) and independently spelled identically (not imported —
  these are two separate hook processes with no shared runtime state) in `context_guard.js`
  (reader) as `SESSION_MODEL_HEADING` too; both compile-time constants, both tested
  (`test_session_model_note_written_when_event_carries_model` in Task 1, the Read-guard tests in
  Task 3) — a future rename of one without the other silently breaks the guard (fail OPEN, never
  denying), flagged as an ambiguity below.
- `KB_INSIDE_CODEX_WORKER` is spelled identically in `codex_dispatch.py`'s `spawn()` (setter) and
  `usage_ledger.py`'s `main()` (reader); both tested independently
  (`test_spawn_marks_worker_env`, `test_refuses_inside_a_codex_worker`).
- `FOLLOW_UP_HOP_LIMIT = 2` matches the spec's "limited to 2 hops" wording exactly.

### Ambiguities resolved (not spelled out verbatim in the spec/brief; decided here)

1. **`SESSION_MODEL_HEADING` has no shared constant module between the writer
   (`project_frame_session_start.js`) and the reader (`context_guard.js`).** Both are separate
   hook processes reading/writing the same on-disk store format via `lib/context_store.js`, which
   has no registry of "extra" (non-`HEADING_ORDER`) heading names — only the five reserved ones
   are constants there. Rather than add a heading constant to `lib/context_store.js` for a single
   non-reserved heading (which would blur that file's own "five reserved headings" contract,
   pinned by tests elsewhere), each hook defines its own local string constant with a matching
   comment pointing at the other file. A rename in one without the other fails OPEN (the guard
   simply stops firing, never mis-fires) — the safe direction, but still worth a shared-constant
   follow-up if this pattern grows a third consumer.
2. **Whether a real `SessionStart` hook payload ever actually carries `event.model` is
   UNCONFIRMED.** The design spec itself hedges ("from `event.model` if present; else no guard")
   and Task 0's four probes (as scoped by the delegator's brief) do not include verifying this
   field's presence. The code is written so this is harmless either way: if `event.model` is
   never sent, `writeSessionModel` silently no-ops every time, `## Session model` is never
   written, and `context_guard.js`'s Read-guard rule never fires (fail-open, the safe default per
   the spec's own "else no guard" clause) — see "What I could not plan" below.
3. **Task 6's "grep the repo... and fix them" scope.** 19 files matched the four dead paths.
   Rather than rewrite five archival, already-closed plan/spec docs' own historical record (which
   would be revisionist and is not what the delegator's four named deletions implied), this plan
   fixes only the 11 LIVE files (8 hook/lib `.js` files + 3 test `.py` files) whose comments are
   current-state documentation, not history, and excludes the five archival docs from the new
   dangling-ref test via an explicit allowlist. Documented as a deliberate scope decision, not an
   oversight.
4. **`context_guard.rules.yaml`'s Bash rules are four INDEPENDENT trigger/escape pairs**, not one
   generic "pipes to no filter" detector applied to a shared verbose-command list. The spec's
   prose groups them under one sentence ("Bash whose command pipes to no filter and matches a
   known-verbose pattern (pytest without -q/tail, git log without -n, cat of a file > 50 KB, find
   /)"), but each parenthetical already carries its own distinct escape condition (`-q`/`tail` for
   pytest; `-n`/`--oneline` for git log; a piped filter OR a small file for `cat`; nothing at all
   for `find /`, which is always denied regardless of piping since the cost is in the filesystem
   walk, not the tool result). Four independent, individually testable rules implement this
   precisely; a single generic detector would either over-trigger (denying `find / | grep x`,
   which spec's own wording never distinguishes as safe) or need the same four special cases
   internally anyway.
5. **`--effort` defaulting to `"medium"` applies uniformly to fresh dispatches AND follow-ups**
   (nothing in `spawn()` special-cases a follow-up's effort the way it special-cases `--cwd`/
   `--sandbox`). The spec only says "child runs default ... `model_reasoning_effort=medium`"
   without distinguishing fresh vs. resumed; applying it uniformly is the simpler, spec-consistent
   reading, and an explicit `--effort` on any call still overrides it.
6. **`ledgers/usage/` is NOT added to `scripts/ledger.py`'s sharded-append `KINDS` tuple**
   (`dispatch`, `cost`, `activity`, `grades`, `approvals`). That module's model is many small
   per-writer-per-day shards merged by `read_day`; `usage_ledger.py` instead computes and writes
   ONE complete file per day directly (mirroring the analysis prototype's output shape, and the
   spec's own literal `ledgers/usage/<YYYY-MM-DD>.tsv` path, singular). Reusing `ledger.append`
   would have meant writing per-session rows across possibly hundreds of `append()` calls with no
   shared idempotency check across the whole day — the wrong shape for a script whose defining
   property is "idempotent per day, one read decides everything." `usage_ledger.py`'s own
   `publish_to_ops` is a direct, acknowledged PORT of `codex_dispatch.py:publish_ops`'s pattern
   instead (same file, not `ledger.py`), which is the right precedent for "one script commits one
   file to ops from any branch."

### What in the existing code contradicts the spec, or what this plan could not fully resolve

- **Codex's own compaction/per-dispatch-effort behavior is genuinely undocumented** (spec §9
  states this outright). Task 0 Probe B captures whatever `codex --help`/`codex exec --help`
  actually say at execution time; this plan cannot pre-verify it from inside the worktree without
  running that probe live, so the `EFFORTS` tuple and the `-c model_reasoning_effort=` mechanism
  are trusted as-is from the ALREADY-COMMITTED `codex_dispatch.py` (which the harness has
  presumably exercised against a real `codex` binary already) rather than re-derived here.
- **Whether `SessionStart` payloads carry `event.model` is unverified** (ambiguity 2 above) — the
  code degrades safely either way, but if it turns out `event.model` is NEVER sent, the Read-guard
  half of L3 is permanently a no-op until a different signal for "current model" is found (e.g.
  reading it from the transcript file directly, which would break the "hooks cannot read context
  size" boundary the spec draws elsewhere, or from a statusline-adjacent mechanism). Recommend the
  first live SessionStart after this ships is inspected by hand (log the raw hook payload once)
  to close this out — not scripted here because it requires a live harness invocation this plan
  cannot produce from a worktree.
- **The root-level stray files the spec's §8 flags** (`*.png`, `*_tmp.txt`, `p5_plan_b380.md`,
  etc., visible in the dispatch brief's own git-status snapshot) are untracked in the MAIN
  checkout, not this worktree, and not reachable by any operation this plan performs here — they
  are Daniel's to delete by hand, exactly as the spec itself already says.
- **This plan does not apply `.claude/settings.json`.** Every settings change it needs (the L2
  `autoCompactWindow` value and the L3 `context_guard.js` PreToolUse entry) is written out in
  full, exact JSON in Task 2 Step 3 and Task 3 Step 5, but never executed — per the dispatch
  brief's explicit exclusion of `.claude/settings.json` from this worktree's edits. Task 7's live
  checks assume Daniel/boss has applied both hunks by hand first.
