import json
import os
import subprocess
import textwrap
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


def _build_ops_repo(repo, current_gate_heading="## Current gate"):
    """Build a throwaway repo with a real `origin/ops` ref carrying orgs/prospecting/{GOAL,STATE}.md.
    `current_gate_heading` is parameterized so a test can exercise an annotated heading
    (e.g. "## Current gate (P8)") without duplicating the whole fixture body.
    """
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
    (orgs / "STATE.md").write_text(
        "# prospecting — STATE\n"
        "_Updated: 2026-09-10 12:00_\n"
        "## Now\n"
        "Batch 2 running.\n"
        f"{current_gate_heading}\n"
        "Daniel reviews batch 2.\n",
        encoding="utf-8",
    )
    git(repo, "add", "orgs")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed orgs")
    git(repo, "checkout", "-q", "main")

    sha = git(repo, "rev-parse", "ops").strip()
    git(repo, "update-ref", "refs/remotes/origin/ops", sha)
    git(repo, "branch", "-D", "ops")
    return repo


@pytest.fixture
def ops_repo(tmp_path):
    return _build_ops_repo(tmp_path / "repo")


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


def test_frame_rollup_lists_every_project(ops_repo):
    body = (
        f'const pf = require({json.dumps(str(LIB))}); '
        f'const r = pf.frame({{mode:"rollup", cwd:{json.dumps(str(ops_repo))}, env:{{}}}}); '
        f'process.stdout.write(r.text);'
    )
    text = run_node(body)
    assert "prospecting: Batch 2 running. (updated 2026-09-10 12:00)" in text
    assert len(text) <= 1500


def test_frame_guard_line_always_first(ops_repo):
    for mode in ("full", "rollup"):
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


# ── Fix round 1 ──────────────────────────────────────────────────────────────────────────────


def test_read_ops_file_returns_null_for_bad_relpath(ops_repo):
    """readOpsFile(cwd, undefined) must fail soft to null, not throw a TypeError out of path.join."""
    result = call(f'readOpsFile({json.dumps(str(ops_repo))}, undefined, {{}})', ops_repo)
    assert result is None


def test_load_list_for_returns_null_for_bad_filename(ops_repo):
    """loadListFor(cwd, undefined) must fail soft to null, not throw a TypeError out of path.join."""
    result = call(f'loadListFor({json.dumps(str(ops_repo))}, undefined)', ops_repo)
    assert result is None


def test_frame_full_mode_matches_annotated_heading_by_prefix(tmp_path):
    """Spec §1: headings are 'exact, prefix-matched' — '## Current gate (P8)' must still resolve
    as 'Current gate', the same way regrounding_hook.js's extractSection prefix-matches."""
    repo = _build_ops_repo(tmp_path / "repo2", current_gate_heading="## Current gate (P8)")
    text = _frame_text(repo, "full")
    assert "Daniel reviews batch 2." in text


def test_read_ops_file_stderr_stays_empty_without_origin_ops(tmp_path):
    """gitCapture must never let git's own stderr (e.g. "fatal: Not a valid object name
    origin/ops:...") leak onto this process's real stderr on a nonzero exit. A repo with NO
    origin/ops ref at all -- a normal "no project data yet" situation, not a bug -- is the
    simplest way to force gitCapture's execFileSync call to exit nonzero. Every caller of this
    module (activeProject, listProjects, readOpsFile, and every hook built on top of them) is
    held to an "always empty stderr" contract; this pins the fix at its source rather than in any
    one caller."""
    repo = tmp_path / "no_ops_ref"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
    body = (
        f'const pf = require({json.dumps(str(LIB))}); '
        f'pf.readOpsFile({json.dumps(str(repo))}, "orgs/prospecting/STATE.md", {{}});'
    )
    r = subprocess.run(["node", "-e", body], capture_output=True, env=os.environ)
    assert r.returncode == 0
    assert r.stderr == b""


# ── Fix wave 2026-09-11 ──────────────────────────────────────────────────────────────────────


def _seed_store_summary(store_dir, session_id, summary):
    """Write a '## Resumed-session summary' into a session store through context_store.js's own
    writeStore -- exactly what context_lifecycle_pre_compact.js does just before a compaction."""
    lib = REPO / "scripts" / "hooks" / "lib" / "context_store.js"
    body = (
        f'const store = require({json.dumps(str(lib))}); '
        f'store.writeStore({json.dumps(session_id)}, '
        f'[{{heading: "Resumed-session summary", body: {json.dumps(summary)}}}]);'
    )
    run_node(body, {"KB_CONTEXT_STORE_DIR": str(store_dir)})


def test_rollup_includes_the_stores_resumed_session_summary(ops_repo, tmp_path):
    """F1: a boss session gets `rollup` and is the session that compacts most often. Serving the
    PreCompact hook's summary only in `full` mode meant that write was never replayed to the
    sessions that produced it -- red on revert (the summary is simply absent from the text)."""
    store_dir = tmp_path / "ctxstore"
    summary = "PRIOR-TURN-MARKER: dispatched the fix wave and graded it."
    _seed_store_summary(store_dir, "boss-session", summary)

    body = (
        f'const pf = require({json.dumps(str(LIB))}); '
        f'const r = pf.frame({{mode:"rollup", cwd:{json.dumps(str(ops_repo))}, '
        f'sessionId:"boss-session", env:{{KB_CONTEXT_STORE_DIR:{json.dumps(str(store_dir))}}}}}); '
        f'process.stdout.write(r.text);'
    )
    text = run_node(body)
    assert "Resumed-session summary: " + summary in text
    assert "prospecting: Batch 2 running." in text  # the rollup lines are not displaced by it
    assert len(text) <= 1500


def test_full_mode_still_includes_the_resumed_session_summary(ops_repo, tmp_path):
    store_dir = tmp_path / "ctxstore"
    summary = "PRIOR-TURN-MARKER-FULL"
    _seed_store_summary(store_dir, "worker-session", summary)
    body = (
        f'const pf = require({json.dumps(str(LIB))}); '
        f'const r = pf.frame({{project:"prospecting", mode:"full", cwd:{json.dumps(str(ops_repo))}, '
        f'sessionId:"worker-session", env:{{KB_CONTEXT_STORE_DIR:{json.dumps(str(store_dir))}}}}}); '
        f'process.stdout.write(r.text);'
    )
    assert summary in run_node(body)


def test_budget_override_lowers_the_cap_but_can_never_raise_it(ops_repo):
    """F2 needs frame() to accept a budget the caller has already spent part of. The override only
    ever LOWERS: MODE_BUDGETS[mode] stays the hard ceiling."""
    def framed(budget):
        body = (
            f'const pf = require({json.dumps(str(LIB))}); '
            f'const r = pf.frame({{project:"prospecting", mode:"full", '
            f'cwd:{json.dumps(str(ops_repo))}, budget:{budget}, env:{{}}}}); '
            f'process.stdout.write(String(r.text.length));'
        )
        return int(run_node(body))

    assert framed(400) <= 400
    assert framed(99999) <= 7000  # an over-large override cannot lift the mode ceiling
    assert framed(0) == 0         # a fully-spent budget renders nothing rather than throwing


def test_kb_project_override_is_ignored_when_it_is_not_a_project_id(ops_repo):
    """M1: KB_PROJECT flows into the `orgs/<project>/GOAL.md` string handed to `git show`. Anything
    that is not a plain project id is ignored, and the branch resolver still gets its chance."""
    git(ops_repo, "checkout", "-q", "-b", "claude/prospecting-p8")
    for bad in ("../../etc/passwd", "Prospecting", "pros pecting", "-x", "a;b", "orgs/prospecting"):
        result = call(
            f'activeProject({{cwd:{json.dumps(str(ops_repo))}}}, {{KB_PROJECT:{json.dumps(bad)}}})',
            ops_repo,
        )
        assert result == "prospecting", bad  # fell through to the branch, never honoured `bad`


def _build_ops_repo_with_decisions(repo, decisions_body=None):
    """Like `_build_ops_repo` but the `prospecting` STATE.md optionally carries a
    `## Decisions` section, for the Task 2 Decisions-surfacing tests."""
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
    state = (
        "# prospecting — STATE\n"
        "_Updated: 2026-09-10 12:00_\n"
        "## Now\n"
        "Batch 2 running.\n"
        "## Current gate\n"
        "Daniel reviews batch 2.\n"
    )
    if decisions_body is not None:
        state += "## Decisions\n" + decisions_body + "\n"
    (orgs / "STATE.md").write_text(state, encoding="utf-8")
    git(repo, "add", "orgs")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed orgs")
    git(repo, "checkout", "-q", "main")

    sha = git(repo, "rev-parse", "ops").strip()
    git(repo, "update-ref", "refs/remotes/origin/ops", sha)
    git(repo, "branch", "-D", "ops")
    return repo


def test_full_mode_includes_decisions_section(tmp_path):
    """Step 2: `## Decisions` must join the `full`-mode entries after `Findings`, per Task 2."""
    repo = _build_ops_repo_with_decisions(
        tmp_path / "repo3", decisions_body="2026-09-11 — example ruling — why"
    )
    text = _frame_text(repo, "full")
    assert "2026-09-11 — example ruling" in text


def test_rollup_mode_appends_latest_decision_when_present(tmp_path):
    repo = _build_ops_repo_with_decisions(
        tmp_path / "repo4", decisions_body="2026-09-11 — example ruling — why"
    )
    body = (
        f'const pf = require({json.dumps(str(LIB))}); '
        f'const r = pf.frame({{mode:"rollup", cwd:{json.dumps(str(repo))}, env:{{}}}}); '
        f'process.stdout.write(r.text);'
    )
    text = run_node(body)
    assert "| latest decision: 2026-09-11 — example ruling — why" in text


def test_rollup_mode_omits_decision_suffix_when_absent(tmp_path):
    repo = _build_ops_repo_with_decisions(tmp_path / "repo5", decisions_body=None)
    body = (
        f'const pf = require({json.dumps(str(LIB))}); '
        f'const r = pf.frame({{mode:"rollup", cwd:{json.dumps(str(repo))}, env:{{}}}}); '
        f'process.stdout.write(r.text);'
    )
    text = run_node(body)
    assert "| latest decision:" not in text


def test_kb_project_override_is_ignored_on_a_boss_branch_too(ops_repo):
    """Same rule with no branch fallback available: the answer is null, never the bad value."""
    git(ops_repo, "checkout", "-q", "-b", "claude/boss-2026-09-11")
    result = call(
        f'activeProject({{cwd:{json.dumps(str(ops_repo))}}}, {{KB_PROJECT:"../../secrets"}})',
        ops_repo,
    )
    assert result is None
