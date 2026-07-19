"""Tests for the W2.2 config-protection hook.

Every payload is WRITTEN TO A TEMP FILE and read back as bytes before being piped
to the hook's stdin — protected path strings never touch a Bash command line. The
repo root the hook resolves file paths against is redirected to a tmp_path fixture
tree via the KB_ROOT env var, so the tests never depend on the live repo layout.

Contract:
  BLOCK (exit 2 + stderr reason) writes to governance/** and the repo-root
  constitution mirrors CLAUDE.md / AGENTS.md / GEMINI.md. Everything else exits 0,
  including paths that merely contain those substrings (docs/governance-notes.md)
  and per-project orgs/<proj>/CLAUDE.md files. Missing file_path or unparseable
  input fails open (exit 0). Block-mode from day one.
"""

import json
import os
import subprocess
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parents[1] / "scripts" / "hooks" / "config_protection.js"


@pytest.fixture
def repo(tmp_path):
    """A minimal kb-shaped tree the hook resolves file paths against."""
    (tmp_path / "governance").mkdir()
    (tmp_path / "governance" / "budget.yaml").write_text("daily: 1", encoding="utf-8")
    (tmp_path / "governance" / "sub").mkdir()
    (tmp_path / "governance" / "sub" / "policy.md").write_text("x", encoding="utf-8")
    (tmp_path / "CLAUDE.md").write_text("root", encoding="utf-8")
    (tmp_path / "AGENTS.md").write_text("root", encoding="utf-8")
    (tmp_path / "GEMINI.md").write_text("root", encoding="utf-8")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "governance-notes.md").write_text("notes", encoding="utf-8")
    proj = tmp_path / "orgs" / "faceless-youtube"
    proj.mkdir(parents=True)
    (proj / "CLAUDE.md").write_text("per-project", encoding="utf-8")
    return tmp_path


def run_hook(repo, file_path, *, raw=None):
    """Pipe a hook payload (or arbitrary raw bytes) to the hook via a temp file."""
    if raw is not None:
        data = raw if isinstance(raw, bytes) else raw.encode()
    else:
        payload = {"tool_name": "Write", "tool_input": {"file_path": str(file_path)}}
        data = json.dumps(payload).encode()
    pf = repo / "_payload.json"
    pf.write_bytes(data)
    env = {**os.environ, "KB_ROOT": str(repo)}
    return subprocess.run(
        ["node", str(HOOK)], input=pf.read_bytes(), capture_output=True, env=env
    )


# --- BLOCK: governance/** ---

def test_blocks_governance_file(repo):
    r = run_hook(repo, repo / "governance" / "budget.yaml")
    assert r.returncode == 2, r.stderr
    assert b"BLOCKED" in r.stderr


def test_blocks_nested_governance_file(repo):
    r = run_hook(repo, repo / "governance" / "sub" / "policy.md")
    assert r.returncode == 2, r.stderr


def test_blocks_governance_relative_path(repo):
    # A relative file_path resolves against KB_ROOT, so it is still protected.
    r = run_hook(repo, "governance/budget.yaml")
    assert r.returncode == 2, r.stderr


# --- BLOCK: repo-root constitution mirrors ---

def test_blocks_root_claude_md(repo):
    r = run_hook(repo, repo / "CLAUDE.md")
    assert r.returncode == 2, r.stderr
    assert b"BLOCKED" in r.stderr


def test_blocks_root_agents_md(repo):
    assert run_hook(repo, repo / "AGENTS.md").returncode == 2


def test_blocks_root_gemini_md(repo):
    assert run_hook(repo, repo / "GEMINI.md").returncode == 2


# --- ALLOW: substring / per-project look-alikes ---

def test_allows_per_project_claude_md(repo):
    # orgs/<proj>/CLAUDE.md is NOT the constitution — only the repo-root file is.
    r = run_hook(repo, repo / "orgs" / "faceless-youtube" / "CLAUDE.md")
    assert r.returncode == 0, r.stderr


def test_allows_governance_substring_filename(repo):
    # "governance" appears in the filename but the file is under docs/, not
    # the repo-root governance/ directory.
    r = run_hook(repo, repo / "docs" / "governance-notes.md")
    assert r.returncode == 0, r.stderr


# --- Fail open ---

def test_fail_open_missing_file_path(repo):
    pf = repo / "_p.json"
    pf.write_bytes(json.dumps({"tool_name": "Write", "tool_input": {}}).encode())
    env = {**os.environ, "KB_ROOT": str(repo)}
    r = subprocess.run(["node", str(HOOK)], input=pf.read_bytes(), capture_output=True, env=env)
    assert r.returncode == 0, r.stderr


def test_fail_open_unparseable(repo):
    r = run_hook(repo, None, raw=b"not json at all")
    assert r.returncode == 0, r.stderr
