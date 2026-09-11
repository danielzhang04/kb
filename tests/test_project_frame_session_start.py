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
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "project_frame_session_start.js"

GUARD_MARKER = "[kb re-grounding]"


def git(cwd, *args):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def make_kb_root(tmp_path, preamble_body='print("PREAMBLE OK")\n', with_sweep=False):
    root = tmp_path / "kb_root"
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "preamble.py").write_text(preamble_body, encoding="utf-8")
    if with_sweep:
        (root / "scripts" / "handoffs_sweep.py").write_text(
            'import json, sys\n'
            'print(json.dumps([{"file": "2020-01-01-kb-old.md", "reasons": ["30 days old"]}]))\n',
            encoding="utf-8",
        )
    return root


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
