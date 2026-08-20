# tests/test_context_lifecycle_activity_tracker.py
"""Context-lifecycle PostToolUse activity tracker (U8) — redaction and the ring buffer.

The redaction table is ported from ECC's session-activity-tracker; these cases are the ones that
table exists for. A secret reaching the store would be a secret written to disk on every tool call,
so each class gets its own assertion.
"""
import json
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "context_lifecycle_activity_tracker.js"
STORE = REPO / "scripts" / "hooks" / "lib" / "context_store.js"

SESSION = "activity-session"
ACTIVITY_LIMIT = 20


def run_hook(store_dir: Path, payload: bytes):
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)}
    return subprocess.run(["node", str(HOOK)], input=payload, capture_output=True, env=env)


def bash_event(command: str, session: str = SESSION) -> bytes:
    return json.dumps(
        {
            "hook_event_name": "PostToolUse",
            "session_id": session,
            "tool_name": "Bash",
            "tool_input": {"command": command},
        }
    ).encode()


def entries(store_dir: Path, session: str = SESSION):
    body = (
        f"const store = require({json.dumps(str(STORE))});"
        f"process.stdout.write(JSON.stringify(store.activityEntries(store.readStore({json.dumps(session)}))));"
    )
    result = subprocess.run(
        ["node", "-e", body],
        capture_output=True,
        env={**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)},
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    return json.loads(result.stdout.decode("utf-8"))


def test_appends_one_entry_per_tool_call(tmp_path):
    r = run_hook(tmp_path, bash_event("git status"))
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""
    assert entries(tmp_path) == ["Bash git status"]

    run_hook(tmp_path, bash_event("git diff"))
    assert entries(tmp_path) == ["Bash git status", "Bash git diff"]


def test_redacts_aws_keys(tmp_path):
    run_hook(tmp_path, bash_event("aws configure AKIA0123456789ABCDEF ASIA0123456789ABCDEF"))
    line = entries(tmp_path)[0]
    assert "AKIA0123456789ABCDEF" not in line and "ASIA0123456789ABCDEF" not in line
    assert line.count("<REDACTED>") == 2


def test_redacts_github_tokens(tmp_path):
    run_hook(tmp_path, bash_event("gh auth ghp_AbCdEf123456 gho_x1 ghs_y2 github_pat_z3"))
    line = entries(tmp_path)[0]
    for token in ("ghp_AbCdEf123456", "gho_x1", "ghs_y2", "github_pat_z3"):
        assert token not in line
    assert line.count("<REDACTED>") == 4


def test_redacts_authorization_headers(tmp_path):
    run_hook(tmp_path, bash_event("curl -H Authorization: Bearer sk-supersecret https://example.test"))
    line = entries(tmp_path)[0]
    assert "sk-supersecret" not in line
    assert "Authorization:<REDACTED>" in line


def test_redacts_password_assignments(tmp_path):
    run_hook(tmp_path, bash_event("psql --password=hunter2 --host db"))
    line = entries(tmp_path)[0]
    assert "hunter2" not in line
    assert "password=<REDACTED>" in line


MODERN_SECRET_PROBES = [
    # (probe fragment, the substring that must NOT survive)
    ("sk-ant-api03-AbCdEfGhIjKlMnOpQrSt", "sk-ant-api03-AbCdEfGhIjKlMnOpQrSt"),
    ("sk-proj-AbCdEfGhIjKlMnOpQrSt", "sk-proj-AbCdEfGhIjKlMnOpQrSt"),
    ("sk-live-AbCdEfGhIjKlMnOpQrSt", "sk-live-AbCdEfGhIjKlMnOpQrSt"),
    ("sk-AbCdEfGhIjKlMnOpQrStUvWx", "sk-AbCdEfGhIjKlMnOpQrStUvWx"),
    ("xoxb-1234567890-0987654321-AbCdEf", "xoxb-1234567890-0987654321-AbCdEf"),
    ("xoxp-1234567890-0987654321-AbCdEf", "xoxp-1234567890-0987654321-AbCdEf"),
    ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r0", "eyJhbGciOiJIUzI1NiJ9."),
    ("-----BEGIN RSA PRIVATE KEY-----", "PRIVATE KEY-----"),
    ("API_KEY=abc123def456", "abc123def456"),
    ("GH_TOKEN=abc123def456", "abc123def456"),
    ("MY_SECRET=abc123def456", "abc123def456"),
    ("x-api-key: abc123def456", "abc123def456"),
    ("Bearer abc123def456ghi", "abc123def456ghi"),
]


def test_redacts_modern_credential_shapes(tmp_path):
    """kb's extension to the ECC table. Best-effort denylist — each known shape gets its own probe."""
    for index, (probe, must_not_survive) in enumerate(MODERN_SECRET_PROBES):
        store_dir = tmp_path / f"probe{index}"
        run_hook(store_dir, bash_event(f"deploy {probe} --now"))
        line = entries(store_dir)[0]
        assert must_not_survive not in line, probe
        assert "<REDACTED>" in line, probe


def test_ansi_cannot_smuggle_a_token_past_redaction(tmp_path):
    """ANSI is stripped BEFORE redaction. With ECC's order the strip reassembled the intact token."""
    run_hook(tmp_path, bash_event("gh auth ghp_AbC\x1b[0mdEf123456 done"))
    line = entries(tmp_path)[0]
    assert "ghp_AbCdEf123456" not in line
    assert "ghp_" not in line
    assert "<REDACTED>" in line


def test_entry_is_capped_and_single_line(tmp_path):
    run_hook(tmp_path, bash_event("echo " + ("x" * 500) + "\nsecond line"))
    rows = entries(tmp_path)
    assert len(rows) == 1
    assert len(rows[0]) <= 220
    assert rows[0].endswith("...")


def test_ring_buffer_keeps_the_last_twenty(tmp_path):
    for i in range(ACTIVITY_LIMIT + 7):
        run_hook(tmp_path, bash_event(f"step {i}"))
    rows = entries(tmp_path)
    assert len(rows) == ACTIVITY_LIMIT
    assert rows[0] == "Bash step 7"
    assert rows[-1] == f"Bash step {ACTIVITY_LIMIT + 6}"


def test_other_sections_survive_appends(tmp_path):
    seed = (
        f"const store = require({json.dumps(str(STORE))});"
        f"store.writeStore({json.dumps(SESSION)}, [{{heading: 'North star', body: 'keep me'}}]);"
    )
    subprocess.run(
        ["node", "-e", seed],
        capture_output=True,
        env={**os.environ, "KB_CONTEXT_STORE_DIR": str(tmp_path)},
        check=True,
    )
    run_hook(tmp_path, bash_event("ls"))
    text = (tmp_path / f"{SESSION}.ctx.md").read_text(encoding="utf-8")
    assert "keep me" in text and "## Recent activity" in text


def test_fails_open_on_bad_input(tmp_path):
    for payload in (
        b"",
        b"{not json",
        json.dumps({"hook_event_name": "PostToolUse", "session_id": SESSION}).encode(),  # no tool_name
        json.dumps({"hook_event_name": "PostToolUse", "tool_name": "Bash"}).encode(),  # no session
        json.dumps({"hook_event_name": "Stop", "session_id": SESSION, "tool_name": "Bash"}).encode(),
    ):
        r = run_hook(tmp_path, payload)
        assert r.returncode == 0
        assert r.stdout.decode("utf-8").strip() == "{}"
        assert r.stderr == b""
    assert not list(tmp_path.glob("*.ctx.md"))


def test_unsafe_session_id_never_writes_outside_the_store(tmp_path):
    r = run_hook(tmp_path, bash_event("ls", session="../../escape"))
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert not list(tmp_path.glob("**/*escape*"))
