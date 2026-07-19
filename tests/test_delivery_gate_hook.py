# tests/test_delivery_gate_hook.py
import os, subprocess, time
from pathlib import Path
REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "delivery_gate.js"

def run_hook(tmp, extra_env=None):
    env = {**os.environ, "KB_ROOT": str(tmp), **(extra_env or {})}
    return subprocess.run(["node", str(HOOK)], input=b"{}", capture_output=True, env=env)

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
