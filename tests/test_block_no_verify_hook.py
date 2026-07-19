# tests/test_block_no_verify_hook.py
import json, subprocess
from pathlib import Path
HOOK = Path(__file__).resolve().parents[1] / "scripts" / "hooks" / "block_no_verify.js"

def run_hook(cmd):
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}}).encode()
    return subprocess.run(["node", str(HOOK)], input=payload, capture_output=True)

def test_blocks_no_verify():
    assert run_hook("git commit --no-verify -m x").returncode == 2

def test_blocks_hookspath_override():
    assert run_hook("git -c core.hooksPath=/dev/null commit -m x").returncode == 2

def test_allows_normal_commit():
    assert run_hook("git commit -m x").returncode == 0

def test_allows_mention_in_string():
    assert run_hook("echo 'docs about --no-verify'").returncode == 0
