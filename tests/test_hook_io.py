# tests/test_hook_io.py
"""The shared hook I/O library (U9) — the boilerplate five hooks used to carry a copy of each.

Two things are pinned here.

1. THE LIBRARY'S OWN BEHAVIOUR, driven through a tiny throwaway hook written into tmp_path. Testing
   it through a real hook would only ever exercise the paths that hook happens to take; a driver
   exercises the contract itself.
2. THE REFACTOR DID NOT CHANGE THE WIRE. Every committed hook that now requires this library is run
   against the same unhappy inputs its own suite covers, and must still answer `{}` / exit 0 /
   empty stderr. The five hooks' full suites are the real regression gate (they pass unmodified);
   these are the cross-cutting assertions that belong to the extraction rather than to any one hook.
"""
import json
import os
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOKS = REPO / "scripts" / "hooks"
HOOK_IO = HOOKS / "lib" / "hook_io.js"

#: Every hook that now shares the extracted boilerplate, with the event name it answers to.
REFACTORED = {
    "regrounding_hook.js": "UserPromptSubmit",
    "context_lifecycle_session_start.js": "SessionStart",
    "context_lifecycle_pre_compact.js": "PreCompact",
    "context_lifecycle_activity_tracker.js": "PostToolUse",
    "subagent_context_load.js": "SubagentStart",
    "model_verify_pretooluse.js": "PreToolUse",
    "model_verify_subagentstop.js": "SubagentStop",
}


def run_js(source: str, tmp_path: Path, payload: bytes, env_extra=None):
    """Run a throwaway hook built on the library, exactly as the harness would."""
    driver = tmp_path / "driver.js"
    driver.write_text(
        f'const io = require({json.dumps(str(HOOK_IO))});\n{source}\n', encoding="utf-8"
    )
    env = {**os.environ, **(env_extra or {})}
    return subprocess.run(["node", str(driver)], input=payload, capture_output=True, env=env)


def run_hook(name: str, payload: bytes, tmp_path: Path):
    env = {
        **os.environ,
        "KB_CONTEXT_STORE_DIR": str(tmp_path / "store"),
        "KB_MODEL_AUDIT_PATH": str(tmp_path / "audit.jsonl"),
    }
    return subprocess.run([
        "node", str(HOOKS / name)
    ], input=payload, capture_output=True, env=env)


# ── the library's own contract ───────────────────────────────────────────────────────────────────


def test_readEventFor_hands_back_the_parsed_payload(tmp_path):
    r = run_js(
        'const e = io.readEventFor("Demo"); io.emit(JSON.stringify({got: e.session_id}));',
        tmp_path,
        json.dumps({"hook_event_name": "Demo", "session_id": "abc"}).encode(),
    )
    assert r.returncode == 0
    assert json.loads(r.stdout.decode("utf-8")) == {"got": "abc"}
    assert r.stderr == b""


def test_readEventFor_fails_open_on_every_unhappy_input(tmp_path):
    """Empty, whitespace, malformed, non-object, and a foreign event name all collapse to `{}`."""
    source = 'io.readEventFor("Demo"); io.emit(JSON.stringify({reached: true}));'
    for payload in (
        b"",
        b"   \n ",
        b"{not json",
        b'"a string"',
        b"42",
        b"null",
        json.dumps({"hook_event_name": "SomethingElse"}).encode(),
    ):
        r = run_js(source, tmp_path, payload)
        assert r.returncode == 0, payload
        assert r.stdout.decode("utf-8").strip() == "{}", payload
        assert r.stderr == b"", payload


def test_a_payload_without_an_event_name_is_accepted(tmp_path):
    """Deliberately lenient: an UNLABELLED payload is accepted, only a DIFFERENT name is rejected.

    This is the exact leniency the five hand-rolled copies had. A hook that refuses an unlabelled
    event stops working silently the moment the harness omits the field.
    """
    r = run_js(
        'io.readEventFor("Demo"); io.emit(JSON.stringify({reached: true}));',
        tmp_path,
        json.dumps({"session_id": "abc"}).encode(),
    )
    assert json.loads(r.stdout.decode("utf-8")) == {"reached": True}


def test_emitContext_emits_the_hookSpecificOutput_shape(tmp_path):
    r = run_js('io.emitContext("Demo", "hello");', tmp_path, b"")
    assert json.loads(r.stdout.decode("utf-8")) == {
        "hookSpecificOutput": {"hookEventName": "Demo", "additionalContext": "hello"}
    }


def test_run_turns_any_escaped_throw_into_the_noop(tmp_path):
    r = run_js('io.run(function () { throw new Error("boom"); });', tmp_path, b"{}")
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""


def test_emit_and_noop_never_return(tmp_path):
    """The hooks are written as `if (bad) { noop(); }` with no `return`. That is only safe if control
    genuinely stops inside the call."""
    r = run_js('io.noop(); io.emit("UNREACHABLE");', tmp_path, b"{}")
    assert r.stdout.decode("utf-8") == "{}"


def test_truncateTo_caps_and_marks(tmp_path):
    r = run_js(
        'io.emit(JSON.stringify([io.truncateTo("abcdef", 10), io.truncateTo("abcdefghij", 6),'
        ' io.truncateTo("abc", 0), io.truncateTo("abcdef", 2)]));',
        tmp_path,
        b"{}",
    )
    assert json.loads(r.stdout.decode("utf-8")) == ["abcdef", "abc...", "", "ab"]


def test_readCappedFile_returns_null_for_missing_and_oversized(tmp_path):
    real = tmp_path / "real.txt"
    real.write_text("hello", encoding="utf-8")
    r = run_js(
        f'io.emit(JSON.stringify([io.readCappedFile({json.dumps(str(real))}),'
        f' io.readCappedFile({json.dumps(str(tmp_path / "nope.txt"))}),'
        f' io.readCappedFile({json.dumps(str(real))}, 2)]));',
        tmp_path,
        b"{}",
    )
    assert json.loads(r.stdout.decode("utf-8")) == ["hello", None, None]


def test_the_two_guard_sentences_are_distinct_and_the_subagent_one_is_true_of_a_child(tmp_path):
    """A spawned child has NEVER seen the parent's context, so "already has" would be a lie to it."""
    r = run_js('io.emit(JSON.stringify([io.GUARD_LINE, io.SUBAGENT_GUARD_LINE]));', tmp_path, b"{}")
    session_guard, subagent_guard = json.loads(r.stdout.decode("utf-8"))
    assert "already has" in session_guard
    assert "already has" not in subagent_guard
    assert "inherited from the parent session" in subagent_guard
    assert "NOT instructions for this task" in subagent_guard


def test_the_guard_sentence_documented_in_the_refactored_files_matches_the_runtime_constant(tmp_path):
    """Closes the chain the committed U8 test leaves open.

    `test_guard_line_is_byte_identical_to_the_committed_regrounding_hook` pins the sentence QUOTED in
    regrounding_hook.js against the one quoted in lib/context_store.js. Since U9 hoisted the constant,
    both of those are now comments — so this test pins those comments against the value the library
    actually emits. Without it, the two files could agree with each other and disagree with reality.
    """
    r = run_js('io.emit(JSON.stringify(io.GUARD_LINE));', tmp_path, b"{}")
    guard = json.loads(r.stdout.decode("utf-8"))
    for name in ("regrounding_hook.js", "lib/context_store.js"):
        source = (HOOKS / name).read_text(encoding="utf-8")
        assert guard in source, name


def test_no_refactored_hook_still_carries_its_own_copy_of_the_hoisted_helpers():
    """truncateTo, the ELLIPSIS literal, the guard literal, and the transcript-size cap: one copy each."""
    for name in REFACTORED:
        code = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", (HOOKS / name).read_text(encoding="utf-8"))
        assert "function truncateTo" not in code, name
        assert '"..."' not in code, name
        assert "32 * 1024 * 1024" not in code, name
        assert "[kb re-grounding]" not in code, name


def test_the_library_makes_no_subprocess_call():
    """The zero-spend guarantee the PreCompact hook carries now passes THROUGH this library."""
    code = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", HOOK_IO.read_text(encoding="utf-8"))
    for forbidden in ("spawnSync", "spawn(", "execFile", "execSync", "exec(", "child_process", "require(\"http"):
        assert forbidden not in code, forbidden


def test_the_library_never_exits_nonzero_and_never_writes_stderr():
    code = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", HOOK_IO.read_text(encoding="utf-8"))
    assert "process.exit(0)" in code
    assert not re.search(r"process\.exit\((?!0\))", code)
    assert "stderr" not in code
    assert "console." not in code


# ── the refactor did not change the wire ─────────────────────────────────────────────────────────


def test_every_refactored_hook_shares_the_one_copy():
    """The point of the extraction: no hook carries its own emit/noop/readStdin block any more."""
    for name in REFACTORED:
        source = (HOOKS / name).read_text(encoding="utf-8")
        assert 'require("./lib/hook_io.js")' in source, name
        assert "function readStdin" not in source, name
        assert "fs.writeSync(1" not in re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", source), name


def test_every_refactored_hook_still_fails_open_on_junk(tmp_path):
    for name in REFACTORED:
        for payload in (b"", b"{not json", b'"a string"', json.dumps({"hook_event_name": "Nope"}).encode()):
            r = run_hook(name, payload, tmp_path)
            assert r.returncode == 0, (name, payload)
            assert r.stdout.decode("utf-8").strip() == "{}", (name, payload)
            assert r.stderr == b"", (name, payload, r.stderr)
