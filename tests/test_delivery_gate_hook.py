# tests/test_delivery_gate_hook.py
import os, subprocess, time
from pathlib import Path
REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "delivery_gate.js"

def run_hook(tmp, extra_env=None):
    env = {**os.environ, "KB_ROOT": str(tmp), **(extra_env or {})}
    return subprocess.run(["node", str(HOOK)], input=b"{}", capture_output=True, env=env)


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

def test_warns_when_memory_untouched(tmp_path):
    (tmp_path / "memory").mkdir()
    old = tmp_path / "memory" / "test-agent.md"; old.write_text("x")
    os.utime(old, (time.time() - 7200, time.time() - 7200))
    r = run_hook(tmp_path, {"KB_AGENT_ID": "test-agent", "KB_SESSION_START": str(int(time.time()) - 3600)})
    assert r.returncode == 0                      # warn-only: NEVER blocks
    assert b"delivery-gate WARN" in r.stderr

def test_silent_when_memory_appended(tmp_path):
    (tmp_path / "memory").mkdir()
    (tmp_path / "memory" / "test-agent.md").write_text("fresh")
    r = run_hook(tmp_path, {"KB_AGENT_ID": "test-agent", "KB_SESSION_START": str(int(time.time()) - 3600)})
    assert r.returncode == 0 and b"WARN" not in r.stderr

def test_silent_when_agent_unknown(tmp_path):
    r = run_hook(tmp_path)                        # no KB_AGENT_ID -> fail open, silent
    assert r.returncode == 0 and b"WARN" not in r.stderr
