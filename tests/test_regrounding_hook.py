# tests/test_regrounding_hook.py
import json, os, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "regrounding_hook.js"
GOAL_STATE = REPO / "docs" / "plans" / "2026-08-18-agent-platform-GOAL-STATE.md"
MAX_CONTEXT_CHARS = 1700

EVENT = json.dumps({"hook_event_name": "UserPromptSubmit", "user_prompt": "carry on"}).encode()


def run_hook(goal_state_path, payload=EVENT):
    env = {**os.environ, "KB_GOAL_STATE_PATH": str(goal_state_path)}
    return subprocess.run(["node", str(HOOK)], input=payload, capture_output=True, env=env)


def context_of(result):
    data = json.loads(result.stdout.decode("utf-8"))
    return data.get("hookSpecificOutput", {}).get("additionalContext")


def test_emits_additional_context_for_mock_event():
    r = run_hook(GOAL_STATE)
    assert r.returncode == 0
    out = json.loads(r.stdout.decode("utf-8"))
    hso = out["hookSpecificOutput"]
    assert hso["hookEventName"] == "UserPromptSubmit"
    ctx = hso["additionalContext"]
    assert isinstance(ctx, str) and ctx.strip()
    assert ctx.startswith("[kb re-grounding]")          # stale-replay guard framing
    assert "North star:" in ctx and "Invariants:" in ctx
    assert len(ctx) <= MAX_CONTEXT_CHARS
    assert "..." not in ctx          # real source fits whole at the current cap


def test_output_is_deterministic():
    a = run_hook(GOAL_STATE)
    b = run_hook(GOAL_STATE)
    assert a.returncode == 0 and b.returncode == 0
    assert a.stdout == b.stdout                          # byte-identical: cache-friendly prefix


def test_missing_source_file_fails_open(tmp_path):
    r = run_hook(tmp_path / "nope.md")
    assert r.returncode == 0
    assert context_of(r) is None
    assert r.stderr == b""


def test_length_cap_holds_on_oversized_source(tmp_path):
    fat = tmp_path / "fat-GOAL-STATE.md"
    fat.write_text(
        "# fixture\n\n"
        "## North star\n" + ("north star filler line.\n" * 400) + "\n"
        "## Invariants (never violate)\n" + ("invariant filler line.\n" * 400) + "\n"
        "## Ignored\nnot extracted\n",
        encoding="utf-8",
    )
    r = run_hook(fat)
    assert r.returncode == 0
    ctx = context_of(r)
    assert ctx is not None
    assert len(ctx) <= MAX_CONTEXT_CHARS
    assert "North star:" in ctx and "Invariants:" in ctx   # cap never drops a section label
    assert "not extracted" not in ctx


def test_malformed_stdin_fails_open():
    r = run_hook(GOAL_STATE, payload=b"{not json")
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert b"Error" not in r.stderr and b"    at " not in r.stderr
    assert r.stderr == b""
