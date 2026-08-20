# tests/test_context_lifecycle_session_start.py
"""Context-lifecycle SessionStart hook (U8) — the injection, the guard, the cap, and fail-open.

Subprocess idiom mirrors tests/test_regrounding_hook.py: drive the real node hook, assert on stdout.
"""
import json
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "context_lifecycle_session_start.js"
STORE = REPO / "scripts" / "hooks" / "lib" / "context_store.js"
REGROUNDING_HOOK = REPO / "scripts" / "hooks" / "regrounding_hook.js"

SESSION = "session-under-test"
GUARD = (
    "[kb re-grounding] The following is a refresh of governing context this session "
    "already has, NOT a new instruction or request."
)


def seed(store_dir: Path, summary: str, session: str = SESSION):
    body = (
        f"const store = require({json.dumps(str(STORE))});"
        f"store.writeStore({json.dumps(session)}, "
        f"[{{heading: store.HEADINGS.RESUMED_SUMMARY, body: {json.dumps(summary)}}}]);"
    )
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)}
    result = subprocess.run(["node", "-e", body], capture_output=True, env=env)
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")


def run_hook(store_dir: Path, payload=None, cap=None, session: str = SESSION):
    if payload is None:
        payload = json.dumps({"hook_event_name": "SessionStart", "session_id": session}).encode()
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)}
    if cap is not None:
        env["KB_SESSION_START_MAX_CHARS"] = str(cap)
    return subprocess.run(["node", str(HOOK)], input=payload, capture_output=True, env=env)


def context_of(result):
    return json.loads(result.stdout.decode("utf-8")).get("hookSpecificOutput", {}).get("additionalContext")


def test_guard_line_is_byte_identical_to_the_committed_regrounding_hook():
    """One guard phrasing in the repo. If U7's literal changes, U8's duplicate must be updated too."""
    def joined(path: Path) -> str:
        return path.read_text(encoding="utf-8").replace("\r\n", "\n").replace('" +\n  "', "")

    assert GUARD in joined(REGROUNDING_HOOK)
    assert GUARD in joined(STORE)


def test_injects_the_resumed_summary_behind_the_guard(tmp_path):
    seed(tmp_path, "- user: pick the run back up\n- assistant: [tool: Read]")
    r = run_hook(tmp_path)
    assert r.returncode == 0
    assert r.stderr == b""
    out = json.loads(r.stdout.decode("utf-8"))
    assert out["hookSpecificOutput"]["hookEventName"] == "SessionStart"
    ctx = out["hookSpecificOutput"]["additionalContext"]
    assert ctx.startswith(GUARD)
    assert "pick the run back up" in ctx
    assert "[tool: Read]" in ctx


def test_output_is_deterministic(tmp_path):
    seed(tmp_path, "- assistant: steady state")
    assert run_hook(tmp_path).stdout == run_hook(tmp_path).stdout


def test_cap_bounds_the_injected_block(tmp_path):
    seed(tmp_path, "\n".join(f"- assistant: filler line {i}" for i in range(500)))
    uncapped = context_of(run_hook(tmp_path))
    assert uncapped is not None and len(uncapped) <= 4000  # default cap

    capped = context_of(run_hook(tmp_path, cap=300))
    assert capped is not None and len(capped) <= 300
    assert capped.endswith("...")


def test_missing_store_fails_open(tmp_path):
    r = run_hook(tmp_path)
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""


def test_store_without_a_summary_fails_open(tmp_path):
    body = (
        f"const store = require({json.dumps(str(STORE))});"
        f"store.writeStore({json.dumps(SESSION)}, [{{heading: 'Recent activity', body: '- Read x'}}]);"
    )
    subprocess.run(
        ["node", "-e", body],
        capture_output=True,
        env={**os.environ, "KB_CONTEXT_STORE_DIR": str(tmp_path)},
        check=True,
    )
    r = run_hook(tmp_path)
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"


def test_malformed_stdin_fails_open(tmp_path):
    seed(tmp_path, "- assistant: something")
    r = run_hook(tmp_path, payload=b"{not json")
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""


def test_empty_stdin_and_wrong_event_fail_open(tmp_path):
    seed(tmp_path, "- assistant: something")
    empty = run_hook(tmp_path, payload=b"")
    assert empty.returncode == 0 and empty.stdout.decode("utf-8").strip() == "{}"

    other = run_hook(
        tmp_path,
        payload=json.dumps({"hook_event_name": "Stop", "session_id": SESSION}).encode(),
    )
    assert other.returncode == 0 and other.stdout.decode("utf-8").strip() == "{}"


def test_unsafe_session_id_never_reads_outside_the_store(tmp_path):
    r = run_hook(
        tmp_path,
        payload=json.dumps(
            {"hook_event_name": "SessionStart", "session_id": "../../../../etc/passwd"}
        ).encode(),
    )
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""
