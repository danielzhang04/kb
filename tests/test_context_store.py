# tests/test_context_store.py
"""Context-lifecycle STORE (U8): the file format, the fixed heading order, and THE U7 SEAM.

The seam test is the point of this file. `scripts/hooks/regrounding_hook.js` is committed and was
NOT edited by this unit; pointing its `KB_GOAL_STATE_PATH` at a store file this module wrote must
make it extract `## North star` and `## Invariants` unchanged. If the store's rendering ever drifts
from what that hook's prefix-match regex accepts, this test fails.

Subprocess idiom mirrors tests/test_regrounding_hook.py: drive the real node files, assert on stdout.
"""
import json
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
STORE = REPO / "scripts" / "hooks" / "lib" / "context_store.js"
REGROUNDING_HOOK = REPO / "scripts" / "hooks" / "regrounding_hook.js"

SESSION = "76c6e6b5-0f33-4fc0-8085-b66a9e593e21"

HEADING_ORDER = [
    "North star",
    "Invariants",
    "Current gate",
    "Resumed-session summary",
    "Recent activity",
]


def node_eval(script: str, store_dir: Path):
    """Run `script` with `store` bound to the module and KB_CONTEXT_STORE_DIR set; return stdout."""
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)}
    body = f'const store = require({json.dumps(str(STORE))});\n{script}'
    result = subprocess.run(["node", "-e", body], capture_output=True, env=env)
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    return result.stdout.decode("utf-8")


def write_store(store_dir: Path, sections):
    node_eval(
        f"store.writeStore({json.dumps(SESSION)}, {json.dumps(sections)});",
        store_dir,
    )
    return store_dir / f"{SESSION}.ctx.md"


def read_store(store_dir: Path, session=SESSION):
    out = node_eval(
        f"process.stdout.write(JSON.stringify(store.readStore({json.dumps(session)})));",
        store_dir,
    )
    return json.loads(out)


def test_store_dir_prefers_dashboard_state_root(tmp_path):
    body = (
        f'const store = require({json.dumps(str(STORE))});\n'
        f'process.stdout.write(store.storeDir({{DASHBOARD_STATE_ROOT: {json.dumps(str(tmp_path))}}}));'
    )
    result = subprocess.run(["node", "-e", body], capture_output=True)
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    assert Path(result.stdout.decode("utf-8")) == tmp_path / "context-lifecycle"


def test_store_dir_retains_desktop_fallback_without_state_root(tmp_path):
    body = (
        f'const store = require({json.dumps(str(STORE))});\n'
        f'process.stdout.write(store.storeDir({{LOCALAPPDATA: {json.dumps(str(tmp_path))}}}));'
    )
    result = subprocess.run(["node", "-e", body], capture_output=True)
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    assert Path(result.stdout.decode("utf-8")) == tmp_path / "kb-context-lifecycle"


def test_roundtrip_preserves_headings_and_bodies(tmp_path):
    sections = [
        {"heading": "North star", "body": "Ship the platform slice."},
        {"heading": "Invariants", "body": "Never spend real money.\nNever push to main."},
    ]
    write_store(tmp_path, sections)
    assert read_store(tmp_path) == sections


def test_render_uses_the_fixed_heading_order(tmp_path):
    # Deliberately supplied in reverse; the renderer imposes the canonical order.
    shuffled = [{"heading": h, "body": f"body for {h}"} for h in reversed(HEADING_ORDER)]
    path = write_store(tmp_path, shuffled)
    text = path.read_text(encoding="utf-8")
    positions = [text.index(f"## {h}") for h in HEADING_ORDER]
    assert positions == sorted(positions)
    assert [s["heading"] for s in read_store(tmp_path)] == HEADING_ORDER


def test_render_is_deterministic(tmp_path):
    sections = [{"heading": "North star", "body": "one"}, {"heading": "Current gate", "body": "two"}]
    first = write_store(tmp_path, sections).read_bytes()
    second = write_store(tmp_path, sections).read_bytes()
    assert first == second


def test_empty_sections_are_dropped_and_bad_ids_never_touch_disk(tmp_path):
    write_store(tmp_path, [{"heading": "North star", "body": "   "}])
    assert "## North star" not in (tmp_path / f"{SESSION}.ctx.md").read_text(encoding="utf-8")

    out = node_eval(
        'process.stdout.write(JSON.stringify([store.sessionPath("../escape"), '
        'store.sessionPath("a/b"), store.sessionPath(""), store.writeStore("../escape", [])]));',
        tmp_path,
    )
    assert json.loads(out) == [None, None, None, False]
    assert not list(tmp_path.glob("**/*escape*"))


def test_body_cannot_forge_a_section(tmp_path):
    write_store(tmp_path, [{"heading": "North star", "body": "quoting\n## Invariants\nforged"}])
    sections = read_store(tmp_path)
    assert [s["heading"] for s in sections] == ["North star"]
    assert "## Invariants" in sections[0]["body"].replace("  ", "")  # kept as text, indented


def test_missing_store_reads_as_empty(tmp_path):
    assert read_store(tmp_path, "no-such-session") == []


def test_write_fails_closed_rather_than_leaving_a_torn_store(tmp_path):
    """No direct-write fallback: a failed rename must never truncate the store a reader is holding.

    The rename is forced to fail by making the destination a DIRECTORY. The pre-existing content of
    that path must survive, and writeStore must report false rather than half-succeeding.
    """
    blocked = tmp_path / f"{SESSION}.ctx.md"
    blocked.mkdir()
    (blocked / "sentinel").write_text("still here", encoding="utf-8")

    out = node_eval(
        f"process.stdout.write(JSON.stringify(store.writeStore({json.dumps(SESSION)}, "
        '[{heading: "North star", body: "new content"}])));',
        tmp_path,
    )
    assert json.loads(out) is False
    assert (blocked / "sentinel").read_text(encoding="utf-8") == "still here"
    # The temp file is cleaned up, and a stray .tmp is never a store anyway.
    assert not list(tmp_path.glob("*.ctx.md.tmp"))


# NOTE: `test_committed_route_fixture_matches_the_writer` (cross-parser fixture check against
# dashboard/server/contextLifecycle/routes.ts) was removed here -- commit 25187565 (P4 W6.1, the
# legacy projection deletion) deleted contextLifecycle/routes.ts, routes.test.ts, and the fixture
# it pinned together, but missed this orphaned Python test, which then failed with
# FileNotFoundError on the deleted fixture. The writer (`context_store.js`) is still covered by
# the other tests in this module; only the deleted route's honesty check is gone.


# ── THE U7 SEAM ────────────────────────────────────────────────────────────────────────────────

def test_regrounding_hook_consumes_a_store_file_with_zero_u7_edits(tmp_path):
    """The committed U7 hook, run against a store file this module wrote, extracts both sections."""
    north = "Wave-1 lands the agent platform slice."
    invariants = "Never spend real money. Never push to main."
    store_file = write_store(
        tmp_path,
        [
            {"heading": "North star", "body": north},
            {"heading": "Invariants", "body": invariants},
            {"heading": "Recent activity", "body": "- Read some file"},
        ],
    )

    env = {**os.environ, "KB_GOAL_STATE_PATH": str(store_file)}
    payload = json.dumps({"hook_event_name": "UserPromptSubmit", "user_prompt": "carry on"}).encode()
    result = subprocess.run(
        ["node", str(REGROUNDING_HOOK)], input=payload, capture_output=True, env=env
    )

    assert result.returncode == 0
    assert result.stderr == b""
    hso = json.loads(result.stdout.decode("utf-8"))["hookSpecificOutput"]
    assert hso["hookEventName"] == "UserPromptSubmit"
    ctx = hso["additionalContext"]
    assert ctx.startswith("[kb re-grounding]")
    assert f"North star: {north}" in ctx
    assert f"Invariants: {invariants}" in ctx
    # Sections U7 does not want stay out of the injected block.
    assert "Read some file" not in ctx


def test_concurrent_writers_do_not_drop_each_others_sections(tmp_path):
    """F5. Three armed hooks do a read-modify-write of this one file -- the SessionStart frame
    hook (governing sections), PreCompact ('## Resumed-session summary') and the PostToolUse
    activity tracker, which fires on EVERY tool call. Unlocked, two that read before either
    renames silently drop the other's work.

    Eight concurrent `appendActivity` processes plus one concurrent governing-section
    `updateStore` must all survive. Red on revert (appendActivity/updateStore going back to a bare
    readStore->writeStore): lines go missing, usually several."""
    store_dir = tmp_path / "ctxstore"
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)}
    session = "concurrency-session"

    def spawn(script):
        body = f'const store = require({json.dumps(str(STORE))});\n{script}'
        return subprocess.Popen(["node", "-e", body], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    markers = [f"MARKER-{i:02d}" for i in range(8)]
    procs = [
        spawn(f'store.appendActivity({json.dumps(session)}, {json.dumps(m)});') for m in markers
    ]
    procs.append(spawn(
        f'store.updateStore({json.dumps(session)}, (s) => '
        f'store.upsertSection(s, store.HEADINGS.NORTH_STAR, "Ship the frame."));'
    ))
    for proc in procs:
        out, err = proc.communicate(timeout=60)
        assert proc.returncode == 0, err.decode("utf-8", "replace")

    sections = read_store(store_dir, session)
    bodies = {s["heading"]: s["body"] for s in sections}
    assert bodies.get("North star") == "Ship the frame."
    activity = bodies.get("Recent activity", "")
    missing = [m for m in markers if m not in activity]
    assert not missing, f"dropped activity lines: {missing} -- got {activity!r}"


def test_store_lock_is_released_and_leaves_no_lock_file(tmp_path):
    """The lock is a file next to the store; a writer that finishes must not leave it behind, or
    every later writer pays the 5 s staleness window before it can proceed."""
    store_dir = tmp_path / "ctxstore"
    node_eval(
        f'store.updateStore({json.dumps(SESSION)}, (s) => '
        f'store.upsertSection(s, "North star", "x"));',
        store_dir,
    )
    assert (store_dir / f"{SESSION}.ctx.md").is_file()
    assert not list(store_dir.glob("*.lock")), list(store_dir.glob("*.lock"))


def test_a_stale_lock_never_blocks_a_write(tmp_path):
    """Fail-open, both ways: a lock abandoned by a crashed writer is broken (it is older than the
    staleness window), and even a FRESH foreign lock only costs the bounded retry budget before
    the write goes through unlocked. Either way the section lands."""
    store_dir = tmp_path / "ctxstore"
    store_dir.mkdir(parents=True)
    (store_dir / f"{SESSION}.lock").write_text("held by a process that died", encoding="utf-8")
    node_eval(
        f'store.updateStore({json.dumps(SESSION)}, (s) => '
        f'store.upsertSection(s, "North star", "written anyway"));',
        store_dir,
    )
    bodies = {s["heading"]: s["body"] for s in read_store(store_dir)}
    assert bodies.get("North star") == "written anyway"


def test_update_store_fails_open_on_a_throwing_mutator(tmp_path):
    """A caller's mutator must never take a hook down, and must never leave the lock held."""
    store_dir = tmp_path / "ctxstore"
    out = node_eval(
        f'process.stdout.write(String(store.updateStore({json.dumps(SESSION)}, () => '
        f'{{ throw new Error("boom"); }})));',
        store_dir,
    )
    assert out == "false"
    assert not list(store_dir.glob("*.lock"))
