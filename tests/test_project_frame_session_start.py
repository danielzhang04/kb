"""kb project-frame SessionStart hook — `scripts/hooks/project_frame_session_start.js`.

This is the WRITER half of U8's context store: it resolves the active project from the checked-out
branch, writes the store's three reserved governing sections ('## North star', '## Invariants',
'## Current gate') for the current session, and emits the full/rollup frame as additionalContext.

Every test drives the committed hook as a real subprocess (node + stdin/stdout), exactly as the
Claude Code harness would invoke it — never requires the .js file directly. Fixtures build a throwaway
git repo standing in for the kb checkout (an `origin/ops` ref carrying orgs/<project>/GOAL.md +
STATE.md, plus a project or boss branch checked out) and a "fake KB_ROOT" carrying a fast,
deterministic stub `scripts/preamble.py` so these tests never depend on the real preamble's
`yaml`/`ledger` imports or `governance/budget.yaml`.
"""
import json
import os
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "project_frame_session_start.js"
STORE_LIB = REPO / "scripts" / "hooks" / "lib" / "context_store.js"

GUARD_MARKER = "[kb re-grounding]"


def git(cwd, *args):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def make_kb_root(tmp_path, preamble_body='print("PREAMBLE OK")\n', with_sweep=False, sweep_body=None):
    root = tmp_path / "kb_root"
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "preamble.py").write_text(preamble_body, encoding="utf-8")
    if with_sweep:
        body = sweep_body or (
            'import json, sys\n'
            'print(json.dumps([{"file": "2020-01-01-kb-old.md", "reasons": ["30 days old"]}]))\n'
        )
        (root / "scripts" / "handoffs_sweep.py").write_text(body, encoding="utf-8")
    return root


def yesterday_utc() -> str:
    """Matches the hook's own `new Date(Date.now() - 24*60*60*1000).toISOString().slice(0, 10)`."""
    return (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()


def add_ops_only_file(repo, rel_path, content):
    """Commits `rel_path` onto whatever `refs/remotes/origin/ops` currently points to, via a
    detached worktree, WITHOUT touching the checked-out working branch -- simulates ops carrying a
    file (fix round 3: scripts/usage_ledger.py's `.summary` sidecar, published by its own
    publish_to_ops) that this particular local checkout has never had in its own working tree."""
    wt = repo.parent / (repo.name + "_ops_wt")
    git(repo, "worktree", "add", "--detach", str(wt), "refs/remotes/origin/ops")
    target = wt / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    git(wt, "add", "--", rel_path)
    git(wt, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "add ops-only file")
    new_sha = git(wt, "rev-parse", "HEAD").strip()
    git(repo, "worktree", "remove", "--force", str(wt))
    git(repo, "update-ref", "refs/remotes/origin/ops", new_sha)


def add_working_tree_only_file(repo, rel_path, content):
    """Writes `rel_path` directly into the checked-out working tree, deliberately UNCOMMITTED --
    exercises `readOpsFile`'s working-tree fallback path (ops HEAD doesn't have it)."""
    target = repo / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def make_project_repo(tmp_path, updated="2026-09-10 12:00", name="proj", project="prospecting"):
    repo = tmp_path / name
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "checkout", "-q", "-b", "main")
    (repo / "README.md").write_text("x", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")
    orgs = repo / "orgs" / project
    orgs.mkdir(parents=True)
    (orgs / "GOAL.md").write_text(
        "## North star\nDeliver leads.\n## Invariants\nNever fabricate.\n", encoding="utf-8"
    )
    (orgs / "STATE.md").write_text(
        f"_Updated: {updated}_\n## Now\nBatch 2.\n## Current gate\nReview.\n", encoding="utf-8"
    )
    git(repo, "add", "orgs")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed")
    git(repo, "checkout", "-q", "-b", f"claude/{project}-p8")
    sha = git(repo, "rev-parse", "HEAD").strip()
    git(repo, "update-ref", "refs/remotes/origin/ops", sha)
    return repo


def make_boss_repo(tmp_path):
    """Two projects on origin/ops, but the working branch is a boss branch matching neither —
    the rollup case a real orchestrator terminal hits every session."""
    repo = tmp_path / "boss_repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "checkout", "-q", "-b", "main")
    (repo / "README.md").write_text("x", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")
    for project, now_line in (("prospecting", "Batch 2."), ("figment", "Train LoRA.")):
        orgs = repo / "orgs" / project
        orgs.mkdir(parents=True)
        (orgs / "GOAL.md").write_text("## North star\nGoal.\n", encoding="utf-8")
        (orgs / "STATE.md").write_text(
            f"_Updated: 2026-09-10 12:00_\n## Now\n{now_line}\n", encoding="utf-8"
        )
    git(repo, "add", "orgs")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed projects")
    git(repo, "checkout", "-q", "-b", "claude/boss-x")
    sha = git(repo, "rev-parse", "HEAD").strip()
    git(repo, "update-ref", "refs/remotes/origin/ops", sha)
    return repo


def run_hook(event, kb_root, store_dir, extra_env=None, raw=None):
    env = {
        **os.environ,
        "KB_ROOT": str(kb_root),
        "KB_CONTEXT_STORE_DIR": str(store_dir),
        **(extra_env or {}),
    }
    payload = raw if raw is not None else json.dumps(event).encode()
    return subprocess.run(["node", str(HOOK)], input=payload, capture_output=True, env=env)


def seed_store(store_dir, session_id, sections):
    """Write a session's store file directly via lib/context_store.js's own `writeStore`, exactly
    the way the PreCompact/PostToolUse siblings would have before this hook ever runs -- the
    fixture for the no-clobber test below. `sections` is a list of {"heading", "body"} dicts."""
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)}
    body = (
        f'const store = require({json.dumps(str(STORE_LIB))}); '
        f'store.writeStore({json.dumps(session_id)}, {json.dumps(sections)});'
    )
    r = subprocess.run(["node", "-e", body], capture_output=True, env=env)
    assert r.returncode == 0, r.stderr


def read_store_sections(store_dir, session_id):
    """The session store's sections, read back through lib/context_store.js's own `readStore` --
    parses the file exactly the way every real consumer (U7 regrounding, U9 subagent load) does,
    rather than re-parsing the markdown by hand in this test."""
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)}
    body = (
        f'const store = require({json.dumps(str(STORE_LIB))}); '
        f'process.stdout.write(JSON.stringify(store.readStore({json.dumps(session_id)})));'
    )
    r = subprocess.run(["node", "-e", body], capture_output=True, env=env)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.decode("utf-8"))


def section_body(sections, heading):
    for section in sections:
        if section.get("heading") == heading:
            return section.get("body")
    return None


def test_usage_line_read_from_ops_only_sidecar(tmp_path):
    """fix round 3: usageLine() is a PURE FILE READ -- no python spawn. When the `.summary`
    sidecar exists on `origin/ops` (the normal case, once usage_ledger.py's own publish has
    landed) but NOT in this particular local working tree, `readOpsFile`'s ops-first git-show path
    must still surface it."""
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    day = yesterday_utc()
    add_ops_only_file(
        repo, f"ledgers/usage/{day}.summary",
        f"{day}: claude $12.34-eq / codex $5.00-eq | 900 turns | peak ctx 210k | codex total 3.2M\n",
    )
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "## Usage (yesterday)" in ctx
    assert "claude $12.34-eq" in ctx


def test_usage_line_read_from_working_tree_only_sidecar(tmp_path):
    """fix round 3: when the sidecar exists only in the local working tree (a same-machine run
    that computed it but hasn't published to ops yet), `readOpsFile`'s fallback path picks it up."""
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    day = yesterday_utc()
    add_working_tree_only_file(
        repo, f"ledgers/usage/{day}.summary",
        f"{day}: claude $9.00-eq / codex $0.00-eq | 42 turns | peak ctx 55k | codex total 0.0M\n",
    )
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "## Usage (yesterday)" in ctx
    assert "claude $9.00-eq" in ctx


def test_usage_line_absent_when_sidecar_missing_does_not_block_payload(tmp_path):
    """Absent sidecar -> no block: the hook still emits its normal payload (governing sections,
    preamble line, frame), just without a '## Usage (yesterday)' block."""
    kb_root = make_kb_root(tmp_path)  # no ledgers/usage/<day>.summary anywhere
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "## Usage (yesterday)" not in ctx
    assert "[preamble]" in ctx  # the rest of the payload still emitted normally


def test_session_model_note_written_when_event_carries_model(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo),
         "model": "claude-opus-5"},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    sections = read_store_sections(store_dir, "s1")
    assert section_body(sections, "Session model") == "claude-opus-5"


def test_session_model_note_absent_when_event_has_no_model(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    sections = read_store_sections(store_dir, "s1")
    assert section_body(sections, "Session model") is None


def test_full_payload_on_startup(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    out = json.loads(r.stdout)
    ctx = out["hookSpecificOutput"]["additionalContext"]
    assert out["hookSpecificOutput"]["hookEventName"] == "SessionStart"
    assert "PREAMBLE OK" in ctx
    assert "Deliver leads." in ctx
    assert "Batch 2." in ctx


def test_full_payload_opens_with_preamble_then_guard_line(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "resume", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert ctx.startswith("[preamble]")
    assert "PREAMBLE OK" in ctx.splitlines()[0]
    preamble_idx = ctx.index("[preamble]")
    guard_idx = ctx.index(GUARD_MARKER)
    goal_idx = ctx.index("Deliver leads.")
    state_idx = ctx.index("Batch 2.")
    assert preamble_idx < guard_idx < goal_idx
    assert guard_idx < state_idx
    assert len(ctx) <= 7000


def test_nothing_emitted_on_compact(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "compact", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    assert r.stdout.decode().strip() == "{}"


def test_store_sections_are_written_even_on_compact(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    run_hook(
        {"hook_event_name": "SessionStart", "source": "compact", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    written = (store_dir / "s1.ctx.md").read_text(encoding="utf-8")
    assert "## North star" in written and "Deliver leads." in written
    assert "## Invariants" in written and "Never fabricate." in written
    assert "## Current gate" in written and "Review." in written
    # Sections this hook does not own must never appear -- it never fabricates them.
    assert "## Resumed-session summary" not in written


def test_preamble_failure_line_surfaces(tmp_path):
    kb_root = make_kb_root(
        tmp_path,
        preamble_body='import sys\nprint("PREAMBLE FAIL: STOP file present")\nsys.exit(2)\n',
    )
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "PREAMBLE FAIL: STOP file present" in ctx


def test_rollup_when_no_project_resolves(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = tmp_path / "no_project"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "PREAMBLE OK" in ctx


def test_rollup_on_boss_branch_lists_one_line_per_project(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_boss_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "prospecting: Batch 2." in ctx
    assert "figment: Train LoRA." in ctx
    assert len(ctx) <= 1500


def test_handoff_sweep_flags_appended_when_present(tmp_path):
    kb_root = make_kb_root(tmp_path, with_sweep=True)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "## Stale handoffs" in ctx
    assert "2020-01-01-kb-old.md" in ctx


def test_missing_handoffs_sweep_is_tolerated(tmp_path):
    kb_root = make_kb_root(tmp_path, with_sweep=False)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "## Stale handoffs" not in ctx


def test_slow_sweep_omits_block_but_payload_still_arrives(tmp_path):
    """Fix round 2, item 2: the sweep subprocess timeout is env-overridable via
    KB_SWEEP_TIMEOUT_MS (default 2000ms), and when the sweep doesn't finish within it, the
    hook simply omits the '## Stale handoffs' block -- it never blocks the rest of the
    SessionStart payload on a slow/hung sweep."""
    kb_root = make_kb_root(tmp_path, with_sweep=True, sweep_body="import time\ntime.sleep(5)\n")
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    started = time.monotonic()
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
        extra_env={"KB_SWEEP_TIMEOUT_MS": "300"},
    )
    elapsed = time.monotonic() - started
    assert r.returncode == 0 and r.stderr == b""
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "## Stale handoffs" not in ctx
    assert "Deliver leads." in ctx  # the rest of the payload still arrives
    assert elapsed < 5.0, elapsed  # did not wait out the sweep's full 5s sleep


def test_no_stdin_and_malformed_json_fail_open(tmp_path):
    kb_root = make_kb_root(tmp_path)
    store_dir = tmp_path / "store"
    for raw in (b"", b"{not json", b"null", json.dumps({"hook_event_name": "Stop"}).encode()):
        r = run_hook(None, kb_root, store_dir, raw=raw)
        assert r.returncode == 0 and r.stderr == b"", raw
        assert r.stdout.decode().strip() == "{}", raw


def test_missing_session_id_fails_open(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    assert r.stdout.decode().strip() == "{}"
    assert not list(store_dir.glob("*.ctx.md"))


def test_missing_store_dir_degrades_gracefully(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    # A store "directory" that is actually a plain file -- mkdirSync inside writeStore must fail,
    # and the hook must still answer cleanly rather than crash.
    store_dir = tmp_path / "store_is_a_file"
    store_dir.write_text("not a directory", encoding="utf-8")
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    json.loads(r.stdout)  # still valid JSON, whatever it says


def test_unreadable_ops_degrades_to_rollup(tmp_path):
    kb_root = make_kb_root(tmp_path)
    # A project branch name with NO matching orgs/<project> anywhere (neither origin/ops nor the
    # working tree) -- the resolver cannot find GOAL.md/STATE.md at all.
    repo = tmp_path / "orphan"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
    git(repo, "checkout", "-q", "-b", "claude/prospecting-p8")
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "PREAMBLE OK" in ctx


def test_session_start_completes_within_five_seconds(tmp_path):
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    started = time.monotonic()
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    elapsed = time.monotonic() - started
    assert r.returncode == 0
    assert elapsed < 5.0, elapsed


def test_seeded_resumed_summary_and_recent_activity_survive_the_write(tmp_path):
    """The read-modify-write no-clobber guarantee, end to end: this hook owns only
    '## North star', '## Invariants', '## Current gate'. A '## Resumed-session summary' (written
    by the PreCompact sibling) and a '## Recent activity' (written by the PostToolUse activity
    tracker) that already exist in the session's store BEFORE this hook runs must come out
    byte-identical to what was seeded -- and the three governing sections must land in that SAME
    file alongside them, not in a separate write that dropped what was already there."""
    kb_root = make_kb_root(tmp_path)
    repo = make_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    session_id = "s1"

    resumed_body = "Prior turn resumed context, verbatim, byte for byte."
    activity_body = "- did X\n- did Y\n- did Z"
    seed_store(
        store_dir,
        session_id,
        [
            {"heading": "Resumed-session summary", "body": resumed_body},
            {"heading": "Recent activity", "body": activity_body},
        ],
    )

    r = run_hook(
        {
            "hook_event_name": "SessionStart",
            "source": "startup",
            "session_id": session_id,
            "cwd": str(repo),
        },
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""

    sections = read_store_sections(store_dir, session_id)
    # (a) the two pre-existing sections this hook does not own: byte-identical to what was seeded.
    assert section_body(sections, "Resumed-session summary") == resumed_body
    assert section_body(sections, "Recent activity") == activity_body
    # (b) the three governing sections this hook DOES own: freshly written, in the same file.
    assert section_body(sections, "North star") == "Deliver leads."
    assert section_body(sections, "Invariants") == "Never fabricate."
    assert section_body(sections, "Current gate") == "Review."


# ── Fix wave 2026-09-11 ──────────────────────────────────────────────────────────────────────

THREE_FLAGS_SWEEP = (
    "import json\n"
    "print(json.dumps(["
    '{"file": "2020-01-01-kb-alpha.md", "reasons": ["900 days old (> 14)"]},'
    '{"file": "2020-01-02-kb-bravo.md", "reasons": ["superseded by 2026-09-01-kb-later.md"]},'
    '{"file": "2020-01-03-kb-charlie.md", "reasons": ["dead Load path(s): docs/gone.md"]}'
    "]))\n"
)


def make_oversized_project_repo(tmp_path, name="big_proj", project="prospecting"):
    """A project whose GOAL.md + STATE.md bodies comfortably exceed the 7000-char `full` budget on
    their own, so frame() is guaranteed to be doing real truncation."""
    repo = tmp_path / name
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "checkout", "-q", "-b", "main")
    (repo / "README.md").write_text("x", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")
    orgs = repo / "orgs" / project
    orgs.mkdir(parents=True)
    filler = "\n".join(f"goal filler line {i:04d} " + "x" * 60 for i in range(80))   # ~6.3k
    state_filler = "\n".join(f"state filler line {i:04d} " + "y" * 60 for i in range(80))
    (orgs / "GOAL.md").write_text(
        f"## North star\nDeliver leads.\n{filler}\n## Invariants\nNever fabricate.\n{filler}\n",
        encoding="utf-8",
    )
    (orgs / "STATE.md").write_text(
        f"_Updated: 2026-09-10 12:00_\n## Now\nBatch 2.\n{state_filler}\n"
        f"## Current gate\nReview.\n## Infra\nTAIL-OF-INFRA-MARKER\n",
        encoding="utf-8",
    )
    git(repo, "add", "orgs")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed")
    git(repo, "checkout", "-q", "-b", f"claude/{project}-p8")
    sha = git(repo, "rev-parse", "HEAD").strip()
    git(repo, "update-ref", "refs/remotes/origin/ops", sha)
    return repo


def test_oversized_frame_keeps_the_stale_handoffs_tail_intact(tmp_path):
    """F2 (critical). frame() used to fill the WHOLE MODE_BUDGETS[mode]; the '[preamble]' line and
    the '## Stale handoffs' block were appended afterwards and the combined string was cut to
    budget -- from the TAIL, so the flags and the end of the frame were the first things lost. The
    costs are now reserved BEFORE frame() is called.

    Red on revert: the payload ends mid-flag (or mid-frame) instead of on the third flag line."""
    kb_root = make_kb_root(tmp_path, with_sweep=True, sweep_body=THREE_FLAGS_SWEEP)
    repo = make_oversized_project_repo(tmp_path)
    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""
    ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]

    expected_tail = (
        "## Stale handoffs\n"
        "- 2020-01-01-kb-alpha.md: 900 days old (> 14)\n"
        "- 2020-01-02-kb-bravo.md: superseded by 2026-09-01-kb-later.md\n"
        "- 2020-01-03-kb-charlie.md: dead Load path(s): docs/gone.md"
    )
    assert ctx.endswith(expected_tail), repr(ctx[-200:])
    assert ctx.startswith("[preamble]")
    assert ctx.index("[preamble]") < ctx.index(GUARD_MARKER) < ctx.index("Deliver leads.")
    assert len(ctx) <= 7000, len(ctx)
    assert "..." in ctx  # the frame really was truncated -- the fixture is doing its job


def test_annotated_governing_headings_are_written_to_the_store(tmp_path):
    """F3. The store write read GOAL/STATE through store.sectionBody (EXACT heading match) while
    frame() read the same files through sectionBodyByPrefix. A real STATE.md writes
    '## Current gate (P8)', so the section shown in the frame was silently absent from the store
    that U7 re-grounding and U9 subagent load read.

    Red on revert: the three bodies are missing from the store file."""
    kb_root = make_kb_root(tmp_path)
    repo = tmp_path / "annotated"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "checkout", "-q", "-b", "main")
    (repo / "README.md").write_text("x", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")
    orgs = repo / "orgs" / "prospecting"
    orgs.mkdir(parents=True)
    (orgs / "GOAL.md").write_text(
        "## North star (P8 arc)\nDeliver leads.\n"
        "## Invariants (never violate)\nNever fabricate.\n",
        encoding="utf-8",
    )
    (orgs / "STATE.md").write_text(
        "_Updated: 2026-09-10 12:00_\n## Now\nBatch 2.\n## Current gate (P8)\nReview.\n",
        encoding="utf-8",
    )
    git(repo, "add", "orgs")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed")
    git(repo, "checkout", "-q", "-b", "claude/prospecting-p8")
    git(repo, "update-ref", "refs/remotes/origin/ops", git(repo, "rev-parse", "HEAD").strip())

    store_dir = tmp_path / "store"
    r = run_hook(
        {"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": str(repo)},
        kb_root, store_dir,
    )
    assert r.returncode == 0 and r.stderr == b""

    sections = read_store_sections(store_dir, "s1")
    # The store's headings stay the RESERVED spellings (U7/U9 match on those), carrying the bodies
    # found under the annotated GOAL.md/STATE.md headings.
    assert section_body(sections, "North star") == "Deliver leads."
    assert section_body(sections, "Invariants") == "Never fabricate."
    assert section_body(sections, "Current gate") == "Review."
