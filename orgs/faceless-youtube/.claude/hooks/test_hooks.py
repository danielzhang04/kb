import json
import subprocess
import sys
from pathlib import Path

HOOKS = Path(__file__).parent
BLOCK = HOOKS / "block_git_add_all.py"
INJECT = HOOKS / "inject_law_on_compact.py"


def _run(script, payload):
    return subprocess.run(
        [sys.executable, str(script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
    )


def test_blocks_git_add_dash_a():
    r = _run(BLOCK, {"tool_input": {"command": "git add -A"}})
    assert r.returncode == 2
    assert "BLOCKED" in r.stderr


def test_blocks_git_add_all_and_dot():
    for cmd in ("git add --all", "git add .", "git add . && git commit"):
        r = _run(BLOCK, {"tool_input": {"command": cmd}})
        assert r.returncode == 2, cmd


def test_allows_explicit_paths():
    r = _run(BLOCK, {"tool_input": {"command": "git add knowledge/operating-law.md"}})
    assert r.returncode == 0


def test_allows_unrelated_command():
    r = _run(BLOCK, {"tool_input": {"command": "ls -la"}})
    assert r.returncode == 0


def test_never_blocks_on_bad_json():
    r = subprocess.run(
        [sys.executable, str(BLOCK)], input="not json", capture_output=True, text=True
    )
    assert r.returncode == 0


def test_inject_emits_law_on_compact():
    r = _run(INJECT, {"source": "compact"})
    assert r.returncode == 0
    assert "Operating Law" in r.stdout


def test_inject_silent_on_startup():
    # @import already loads the law at launch; re-emitting would duplicate it.
    r = _run(INJECT, {"source": "startup"})
    assert r.returncode == 0
    assert r.stdout.strip() == ""
