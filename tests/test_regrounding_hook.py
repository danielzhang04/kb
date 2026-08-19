import json
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "regrounding_hook.js"
GOAL_STATE = REPO / "docs" / "plans" / "2026-08-18-agent-platform-GOAL-STATE.md"
MAX_CONTEXT_CHARS = 1700

EVENT = {"hook_event_name": "UserPromptSubmit", "user_prompt": "carry on"}
SESSION = "session-under-test"
NOW = 1_700_000_000_000
THROTTLE_MS = 30 * 60 * 1000


def run_hook(goal_state_path, state_dir, payload=EVENT, extra_env=None):
    env = {
        **os.environ,
        "KB_GOAL_STATE_PATH": str(goal_state_path),
        "KB_REGROUND_STATE_DIR": str(state_dir),
        **(extra_env or {}),
    }
    encoded = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    return subprocess.run(["node", str(HOOK)], input=encoded, capture_output=True, env=env)


def context_of(result):
    data = json.loads(result.stdout.decode("utf-8"))
    return data.get("hookSpecificOutput", {}).get("additionalContext")


def write_state(state_dir, sessions):
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "state.json").write_text(
        json.dumps({"version": 1, "sessions": sessions}), encoding="utf-8"
    )


def state_record(state_dir, session=SESSION):
    return json.loads((state_dir / "state.json").read_text(encoding="utf-8"))["sessions"][session]


def test_emits_additional_context_for_mock_event(tmp_path):
    r = run_hook(GOAL_STATE, tmp_path / "state")
    assert r.returncode == 0
    out = json.loads(r.stdout.decode("utf-8"))
    hso = out["hookSpecificOutput"]
    assert hso["hookEventName"] == "UserPromptSubmit"
    ctx = hso["additionalContext"]
    assert isinstance(ctx, str) and ctx.strip()
    assert ctx.startswith("[kb re-grounding]")
    assert "North star:" in ctx and "Invariants:" in ctx
    assert len(ctx) <= MAX_CONTEXT_CHARS
    assert "..." not in ctx


def test_output_is_deterministic(tmp_path):
    a = run_hook(GOAL_STATE, tmp_path / "state-a")
    b = run_hook(GOAL_STATE, tmp_path / "state-b")
    assert a.returncode == 0 and b.returncode == 0
    assert a.stdout == b.stdout


def test_missing_source_file_fails_open(tmp_path):
    r = run_hook(tmp_path / "nope.md", tmp_path / "state")
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
    r = run_hook(fat, tmp_path / "state")
    assert r.returncode == 0
    ctx = context_of(r)
    assert ctx is not None
    assert len(ctx) <= MAX_CONTEXT_CHARS
    assert "North star:" in ctx and "Invariants:" in ctx
    assert "not extracted" not in ctx


def test_malformed_stdin_fails_open(tmp_path):
    r = run_hook(GOAL_STATE, tmp_path / "state", payload=b"{not json")
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert b"Error" not in r.stderr and b"    at " not in r.stderr
    assert r.stderr == b""


def test_unknown_event_fails_open(tmp_path):
    r = run_hook(GOAL_STATE, tmp_path / "state", {"hook_event_name": "PreCompact"})
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""


def test_compact_source_always_injects_and_resets_state(tmp_path):
    state_dir = tmp_path / "state"
    write_state(state_dir, {"session-a": {"lastInjectionMs": 1, "toolCallsSinceInjection": 24}})
    r = run_hook(
        GOAL_STATE,
        state_dir,
        {"hook_event_name": "SessionStart", "source": "compact", "session_id": "session-a"},
        {"KB_REGROUND_NOW_MS": "2"},
    )
    assert r.returncode == 0 and r.stderr == b""
    assert context_of(r) is not None
    assert json.loads(r.stdout)["hookSpecificOutput"]["hookEventName"] == "SessionStart"
    record = state_record(state_dir, "session-a")
    assert record["toolCallsSinceInjection"] == 0
    assert record["lastInjectionMs"] == 2


def test_post_tool_use_increments_and_injects_on_nth_call(tmp_path):
    state_dir = tmp_path / "state"
    write_state(
        state_dir,
        {"session-a": {"lastInjectionMs": NOW, "toolCallsSinceInjection": 0}},
    )
    event = {"hook_event_name": "PostToolUse", "session_id": "session-a"}
    for count in (1, 2):
        r = run_hook(
            GOAL_STATE,
            state_dir,
            event,
            {"KB_REGROUND_EVERY_CALLS": "3", "KB_REGROUND_NOW_MS": str(NOW)},
        )
        assert r.stdout.decode().strip() == "{}"
        assert state_record(state_dir, "session-a")["toolCallsSinceInjection"] == count
    r = run_hook(
        GOAL_STATE,
        state_dir,
        event,
        {"KB_REGROUND_EVERY_CALLS": "3", "KB_REGROUND_NOW_MS": str(NOW)},
    )
    assert context_of(r) is not None
    assert state_record(state_dir, "session-a")["toolCallsSinceInjection"] == 0


def test_user_prompt_skips_inside_the_throttle_window(tmp_path):
    state_dir = tmp_path / "state"
    event = {**EVENT, "session_id": SESSION}
    first = run_hook(GOAL_STATE, state_dir, event, {"KB_REGROUND_NOW_MS": str(NOW)})
    second = run_hook(GOAL_STATE, state_dir, event, {"KB_REGROUND_NOW_MS": str(NOW)})
    assert context_of(first) is not None
    assert second.returncode == 0
    assert second.stdout.decode().strip() == "{}"
    assert second.stderr == b""


def test_time_based_injection_after_throttle_window(tmp_path):
    state_dir = tmp_path / "state"
    write_state(state_dir, {SESSION: {"lastInjectionMs": NOW - THROTTLE_MS - 1, "toolCallsSinceInjection": 0}})
    r = run_hook(GOAL_STATE, state_dir, {**EVENT, "session_id": SESSION}, {"KB_REGROUND_NOW_MS": str(NOW)})
    assert r.returncode == 0 and context_of(r) is not None


def test_corrupt_state_file_fails_open_by_injecting(tmp_path):
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    (state_dir / "state.json").write_text("not json", encoding="utf-8")
    r = run_hook(GOAL_STATE, state_dir, {**EVENT, "session_id": SESSION}, {"KB_REGROUND_NOW_MS": str(NOW)})
    assert r.returncode == 0 and r.stderr == b""
    assert context_of(r) is not None
    assert state_record(state_dir, SESSION)["toolCallsSinceInjection"] == 0


def test_unwritable_state_dir_never_breaks_the_hook(tmp_path):
    blocked = tmp_path / "not-a-directory"
    blocked.write_text("block state directory creation", encoding="utf-8")
    r = run_hook(GOAL_STATE, blocked, {**EVENT, "session_id": SESSION}, {"KB_REGROUND_NOW_MS": str(NOW)})
    assert r.returncode == 0
    assert r.stderr == b""
    assert context_of(r) is not None


def test_missing_session_id_is_unthrottled_and_stateless(tmp_path):
    state_dir = tmp_path / "state"
    first = run_hook(GOAL_STATE, state_dir, EVENT, {"KB_REGROUND_NOW_MS": str(NOW)})
    second = run_hook(GOAL_STATE, state_dir, EVENT, {"KB_REGROUND_NOW_MS": str(NOW + 1)})
    assert context_of(first) is not None and context_of(second) is not None
    assert not (state_dir / "state.json").exists()
    assert not (state_dir / "state.lock").exists()


def test_time_boundary_just_under_throttle_window_skips(tmp_path):
    state_dir = tmp_path / "state"
    write_state(state_dir, {SESSION: {"lastInjectionMs": NOW - THROTTLE_MS + 1, "toolCallsSinceInjection": 0}})
    r = run_hook(GOAL_STATE, state_dir, {**EVENT, "session_id": SESSION}, {"KB_REGROUND_NOW_MS": str(NOW)})
    assert r.returncode == 0 and r.stdout.decode().strip() == "{}"
    assert r.stderr == b""


def test_time_boundary_just_over_throttle_window_injects(tmp_path):
    state_dir = tmp_path / "state"
    write_state(state_dir, {SESSION: {"lastInjectionMs": NOW - THROTTLE_MS - 1, "toolCallsSinceInjection": 0}})
    r = run_hook(GOAL_STATE, state_dir, {**EVENT, "session_id": SESSION}, {"KB_REGROUND_NOW_MS": str(NOW)})
    assert r.returncode == 0 and context_of(r) is not None
    assert state_record(state_dir, SESSION) == {"lastInjectionMs": NOW, "toolCallsSinceInjection": 0}


def test_future_injection_time_is_corrupt_and_resets_on_backward_clock_skew(tmp_path):
    state_dir = tmp_path / "state"
    write_state(state_dir, {SESSION: {"lastInjectionMs": NOW + 1, "toolCallsSinceInjection": 7}})
    r = run_hook(GOAL_STATE, state_dir, {**EVENT, "session_id": SESSION}, {"KB_REGROUND_NOW_MS": str(NOW)})
    assert r.returncode == 0 and context_of(r) is not None
    assert state_record(state_dir, SESSION) == {"lastInjectionMs": NOW, "toolCallsSinceInjection": 0}


def test_injected_context_is_byte_identical_across_metadata_and_throttle_paths(tmp_path):
    cases = [
        ({"hook_event_name": "SessionStart", "source": "compact", "session_id": "compact-a"}, {}, NOW),
        ({**EVENT, "session_id": "prompt-b"}, {}, NOW + 1),
        ({"hook_event_name": "PostToolUse", "session_id": "tool-c"},
         {"tool-c": {"lastInjectionMs": NOW, "toolCallsSinceInjection": 2}}, NOW + 2),
        ({**EVENT, "session_id": "stale-d"},
         {"stale-d": {"lastInjectionMs": NOW - THROTTLE_MS - 1, "toolCallsSinceInjection": 0}}, NOW + 3),
        ({**EVENT, "session_id": "future-e"},
         {"future-e": {"lastInjectionMs": NOW + 10, "toolCallsSinceInjection": 0}}, NOW + 4),
    ]
    contexts = []
    for index, (event, sessions, now) in enumerate(cases):
        state_dir = tmp_path / f"state-{index}"
        if sessions:
            write_state(state_dir, sessions)
        r = run_hook(
            GOAL_STATE,
            state_dir,
            event,
            {"KB_REGROUND_NOW_MS": str(now), "KB_REGROUND_EVERY_CALLS": "3"},
        )
        assert r.returncode == 0 and r.stderr == b""
        contexts.append(context_of(r).encode("utf-8"))
    assert len(set(contexts)) == 1


def test_stale_lock_is_recovered_without_breaking_injection(tmp_path):
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    lock = state_dir / "state.lock"
    lock.write_text("abandoned", encoding="utf-8")
    os.utime(lock, (0, 0))
    r = run_hook(GOAL_STATE, state_dir, {**EVENT, "session_id": SESSION}, {"KB_REGROUND_NOW_MS": str(NOW)})
    assert r.returncode == 0 and r.stderr == b"" and context_of(r) is not None
    assert state_record(state_dir, SESSION)["lastInjectionMs"] == NOW
    assert not lock.exists()


def test_two_processes_contending_for_one_state_lock_inject_without_mutating_state(tmp_path):
    state_dir = tmp_path / "state"
    write_state(state_dir, {SESSION: {"lastInjectionMs": NOW, "toolCallsSinceInjection": 0}})
    lock = state_dir / "state.lock"
    lock.write_text("held", encoding="utf-8")
    env = {"KB_REGROUND_NOW_MS": str(NOW), "KB_REGROUND_EVERY_CALLS": "3"}
    payload = {"hook_event_name": "PostToolUse", "session_id": SESSION}
    processes = [
        subprocess.Popen(
            ["node", str(HOOK)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "KB_GOAL_STATE_PATH": str(GOAL_STATE), "KB_REGROUND_STATE_DIR": str(state_dir), **env},
        )
        for _ in range(2)
    ]
    encoded = json.dumps(payload).encode()
    for process in processes:
        process.stdin.write(encoded)
        process.stdin.close()
    outputs = [(process.stdout.read(), process.stderr.read()) for process in processes]
    assert all(process.wait() == 0 and stderr == b"" for process, (_stdout, stderr) in zip(processes, outputs))
    assert all(json.loads(stdout)["hookSpecificOutput"]["additionalContext"] for stdout, _stderr in outputs)
    assert state_record(state_dir, SESSION) == {"lastInjectionMs": NOW, "toolCallsSinceInjection": 0}
