# tests/test_subagent_context_load.py
"""The SubagentStart context-load hook (U9) — what a spawned subagent inherits, and what it must not.

Subprocess idiom mirrors tests/test_regrounding_hook.py and its U8 siblings: drive the real node hook
with a mock event, assert on stdout.

The OUTPUT SHAPE assertions here are not a guess. The field name and nesting were verified against the
installed harness (Claude Code 2.1.234): its embedded schema is
`ye({hookEventName:Ct("SubagentStart"),additionalContext:F().optional()})` and its consumer reads
`e.hookSpecificOutput.additionalContext`. Evidence is recorded in
docs/proposals/spawn-model-verify-hooks.md.
"""
import json
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "subagent_context_load.js"
STORE = REPO / "scripts" / "hooks" / "lib" / "context_store.js"

SESSION = "parent-session-under-test"

#: The SUBAGENT guard, not the session one. A freshly spawned child has never seen the parent's
#: context, so "context this session already has" would be a false statement to make to it — the whole
#: point of a guard is to frame the block truthfully. Defined as SUBAGENT_GUARD_LINE in lib/hook_io.js.
GUARD = (
    "[kb spawn context] The following is inherited from the parent session's governing "
    "context, NOT instructions for this task."
)
#: The session-scoped guard, which must NOT appear in a subagent injection.
SESSION_GUARD = "[kb re-grounding] The following is a refresh of governing context this session"

FULL_STORE = [
    ("North star", "Ship the Wave-1 platform slice."),
    ("Invariants", "Never spend real money."),
    ("Current gate", "awaiting the human review gate"),
    ("Resumed-session summary", "- user: pick the run back up"),
    ("Recent activity", "- Bash git status"),
]


def store_dir_of(tmp_path: Path) -> Path:
    """The store root, kept in its own subdirectory so the seed script never lands inside it."""
    return tmp_path / "store"


def seed(tmp_path: Path, sections, session: str = SESSION):
    """Write a store with the REAL hook library — a hand-written fixture would only pin itself.

    The seed script goes in a FILE rather than `node -e`: the cap test seeds ~16k characters, which
    overflows the Windows command line (WinError 206).
    """
    payload = [{"heading": h, "body": b} for h, b in sections]
    script = tmp_path / "seed.js"
    script.write_text(
        f"const store = require({json.dumps(str(STORE))});\n"
        f"store.writeStore({json.dumps(session)}, {json.dumps(payload)});\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        ["node", str(script)],
        capture_output=True,
        env={**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir_of(tmp_path))},
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")


def run_hook(tmp_path: Path, payload=None, cap=None, session: str = SESSION):
    if payload is None:
        payload = json.dumps(
            {
                "hook_event_name": "SubagentStart",
                # VERIFIED: this is the PARENT session's id — a subagent shares the parent Session and
                # is distinguished by agent_id / agent_type, not by a new session id.
                "session_id": session,
                "agent_id": "agent-abc123",
                "agent_type": "general-purpose",
            }
        ).encode()
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir_of(tmp_path))}
    if cap is not None:
        env["KB_SUBAGENT_CONTEXT_MAX_CHARS"] = str(cap)
    return subprocess.run(["node", str(HOOK)], input=payload, capture_output=True, env=env)


def context_of(result):
    return json.loads(result.stdout.decode("utf-8")).get("hookSpecificOutput", {}).get("additionalContext")


def test_injects_the_governing_context_behind_the_guard(tmp_path):
    seed(tmp_path, FULL_STORE)
    r = run_hook(tmp_path)
    assert r.returncode == 0
    assert r.stderr == b""
    out = json.loads(r.stdout.decode("utf-8"))
    # The verified shape, asserted field by field.
    assert set(out) == {"hookSpecificOutput"}
    assert out["hookSpecificOutput"]["hookEventName"] == "SubagentStart"
    ctx = out["hookSpecificOutput"]["additionalContext"]
    assert ctx.startswith(GUARD)
    # A child is never told it "already has" context it has never seen.
    assert SESSION_GUARD not in ctx
    assert "Ship the Wave-1 platform slice." in ctx
    assert "Never spend real money." in ctx
    assert "awaiting the human review gate" in ctx


def test_the_child_never_inherits_the_activity_trail_or_the_parent_summary(tmp_path):
    """A subagent prompt is a wider blast radius than the parent's own store.

    The redacted ring buffer is best-effort clean, not provably clean, and the parent's compaction
    recall is noise to a child with a specific brief. Governing sections only.
    """
    seed(tmp_path, FULL_STORE)
    ctx = context_of(run_hook(tmp_path))
    assert "Bash git status" not in ctx
    assert "pick the run back up" not in ctx


def test_sections_are_emitted_in_the_declared_order(tmp_path):
    seed(tmp_path, list(reversed(FULL_STORE)))
    ctx = context_of(run_hook(tmp_path))
    assert ctx.index("North star") < ctx.index("Invariants") < ctx.index("Current gate")


def test_output_is_deterministic(tmp_path):
    seed(tmp_path, FULL_STORE)
    assert run_hook(tmp_path).stdout == run_hook(tmp_path).stdout


def test_cap_bounds_the_injected_block(tmp_path):
    seed(tmp_path, [("North star", "star " * 4000), ("Invariants", "inv " * 4000)])
    uncapped = context_of(run_hook(tmp_path))
    assert uncapped is not None and len(uncapped) <= 2000  # default cap

    capped = context_of(run_hook(tmp_path, cap=300))
    assert capped is not None and len(capped) <= 300
    assert capped.endswith("...")


def test_missing_store_fails_open(tmp_path):
    r = run_hook(tmp_path)
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""


def test_a_store_with_no_governing_sections_injects_nothing(tmp_path):
    """The state U8 actually ships in: only PreCompact and PostToolUse have writers today."""
    seed(tmp_path, [("Recent activity", "- Bash ls"), ("Resumed-session summary", "- user: hi")])
    r = run_hook(tmp_path)
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"


def test_malformed_and_empty_stdin_fail_open(tmp_path):
    seed(tmp_path, FULL_STORE)
    for payload in (b"{not json", b"", b"   "):
        r = run_hook(tmp_path, payload=payload)
        assert r.returncode == 0, payload
        assert r.stdout.decode("utf-8").strip() == "{}", payload
        assert r.stderr == b"", payload


def test_a_foreign_event_and_a_missing_session_id_fail_open(tmp_path):
    seed(tmp_path, FULL_STORE)
    other = run_hook(tmp_path, payload=json.dumps({"hook_event_name": "SessionStart", "session_id": SESSION}).encode())
    assert other.returncode == 0 and other.stdout.decode("utf-8").strip() == "{}"

    no_id = run_hook(tmp_path, payload=json.dumps({"hook_event_name": "SubagentStart"}).encode())
    assert no_id.returncode == 0 and no_id.stdout.decode("utf-8").strip() == "{}"


def test_unsafe_session_id_never_reads_outside_the_store(tmp_path):
    r = run_hook(
        tmp_path,
        payload=json.dumps(
            {"hook_event_name": "SubagentStart", "session_id": "../../../../etc/passwd"}
        ).encode(),
    )
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""


def test_the_hook_never_writes_the_store(tmp_path):
    """It is a READER. The three U8 hooks own every write to a session store."""
    seed(tmp_path, FULL_STORE)
    store_file = store_dir_of(tmp_path) / f"{SESSION}.ctx.md"
    before = store_file.read_bytes()
    run_hook(tmp_path)
    assert store_file.read_bytes() == before
    # No audit log, no temp file, no second store — the hook adds nothing to the store root.
    assert sorted(p.name for p in store_dir_of(tmp_path).iterdir()) == [f"{SESSION}.ctx.md"]
