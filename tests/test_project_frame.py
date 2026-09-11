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
