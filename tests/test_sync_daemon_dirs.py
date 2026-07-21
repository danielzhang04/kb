"""Tests for scripts/sync_daemon_dirs.py.

Each test builds throwaway git repos (a bare "origin" plus a working clone with
``main`` and ``ops`` branches) so drift detection and the ops-write sync path are
exercised end-to-end without touching the real kb repo. Modelled on the temp-repo
approach used by the rest of scripts/ tests.
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
import sync_daemon_dirs as sdd  # noqa: E402


def _git(cwd, *args, check=True):
    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True,
        text=True,
        check=check,
    )


def _write(root, rel, content):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def _commit_all(root, msg):
    _git(root, "add", "-A")
    _git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg)


# Baseline daemon-read content laid down on main in every scenario. The STATE.md
# file sits next to a workflows dir but is NOT a daemon-read path — it must never
# appear in any drift report (guards the pattern matcher).
MAIN_LAYOUT = {
    "agents/fyt.md": "agent one\n",
    "orgs/foo/workflows/run.md": "workflow one\n",
    "orgs/foo/workflows/seg/a.js": "console.log(1)\n",
    "orgs/foo/STATE.md": "not a daemon-read dir\n",
}


def build(tmp_path, ops_mutate=None):
    """Create origin + working clone with main and ops branches; return the clone."""
    origin = Path(tmp_path) / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", str(origin)],
                   check=True, capture_output=True)
    wc = Path(tmp_path) / "wc"
    subprocess.run(["git", "clone", "-q", str(origin), str(wc)],
                   check=True, capture_output=True)

    _git(wc, "checkout", "-q", "-b", "main")
    for rel, content in MAIN_LAYOUT.items():
        _write(wc, rel, content)
    _commit_all(wc, "main content")
    _git(wc, "push", "-q", "-u", "origin", "main")

    _git(wc, "checkout", "-q", "-b", "ops", "main")
    if ops_mutate is not None:
        ops_mutate(wc)
        _commit_all(wc, "ops content")
    _git(wc, "push", "-q", "-u", "origin", "ops")
    # Leave the clone on main so ops is free to be checked out as a worktree.
    _git(wc, "checkout", "-q", "main")
    _git(wc, "fetch", "-q", "origin")
    return wc


# --- Unit tests for the path matcher ----------------------------------------
def test_matcher_covers_daemon_dirs_only():
    matchers = sdd._compile(sdd.DAEMON_READ_DIRS)
    assert sdd._matches("agents/fyt.md", matchers)
    assert sdd._matches("orgs/foo/workflows/run.md", matchers)
    assert sdd._matches("orgs/foo/workflows/seg/a.js", matchers)
    # Not daemon-read: sibling STATE.md, top-level file, deeper non-workflows.
    assert not sdd._matches("orgs/foo/STATE.md", matchers)
    assert not sdd._matches("agents", matchers)  # the dir entry itself, no file
    assert not sdd._matches("orgs/foo/docs/plan.md", matchers)


# --- check() in refs-fallback mode (no ops worktree on disk) ----------------
def test_check_clean_no_drift(tmp_path):
    wc = build(tmp_path)  # ops == main
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=None,
                       main_ref="origin/main", ops_ref="origin/ops")
    assert report["mode"].startswith("refs")
    assert not sdd.has_drift(report), report


def test_check_detects_main_only(tmp_path):
    # ops is missing a file that exists on main.
    def mutate(wc):
        _git(wc, "rm", "-q", "orgs/foo/workflows/run.md")
    wc = build(tmp_path, mutate)
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=None,
                       main_ref="origin/main", ops_ref="origin/ops")
    assert report["main_only"] == ["orgs/foo/workflows/run.md"]
    assert sdd.has_drift(report)


def test_check_detects_content_differs(tmp_path):
    def mutate(wc):
        _write(wc, "agents/fyt.md", "agent CHANGED on ops\n")
    wc = build(tmp_path, mutate)
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=None,
                       main_ref="origin/main", ops_ref="origin/ops")
    assert report["differs"] == ["agents/fyt.md"]
    assert sdd.has_drift(report)


def test_check_detects_ops_only(tmp_path):
    def mutate(wc):
        _write(wc, "agents/ghost.md", "extra ops agent\n")
    wc = build(tmp_path, mutate)
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=None,
                       main_ref="origin/main", ops_ref="origin/ops")
    assert report["ops_only"] == ["agents/ghost.md"]
    assert sdd.has_drift(report)


def test_check_ignores_non_daemon_dirs(tmp_path):
    # A change to a sibling STATE.md must not register as drift.
    def mutate(wc):
        _write(wc, "orgs/foo/STATE.md", "ops edited state\n")
    wc = build(tmp_path, mutate)
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=None,
                       main_ref="origin/main", ops_ref="origin/ops")
    assert not sdd.has_drift(report), report


# --- check() in disk mode (ops worktree present) ----------------------------
def _add_ops_worktree(wc, path):
    _git(wc, "worktree", "add", "-q", str(path), "ops")
    return Path(path)


def test_check_disk_clean(tmp_path):
    wc = build(tmp_path)
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=ops_root,
                       main_ref="origin/main")
    assert report["mode"].startswith("disk")
    assert not sdd.has_drift(report), report


def test_check_disk_content_differs(tmp_path):
    def mutate(wc):
        _write(wc, "orgs/foo/workflows/run.md", "ops-diverged workflow\n")
    wc = build(tmp_path, mutate)
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=ops_root,
                       main_ref="origin/main")
    assert report["differs"] == ["orgs/foo/workflows/run.md"]
    assert sdd.has_drift(report)


def test_check_disk_main_only(tmp_path):
    def mutate(wc):
        _git(wc, "rm", "-q", "agents/fyt.md")
    wc = build(tmp_path, mutate)
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=ops_root,
                       main_ref="origin/main")
    assert report["main_only"] == ["agents/fyt.md"]


def test_check_disk_falls_back_when_ops_root_missing(tmp_path):
    # A nonexistent ops_root must fall back to origin/main vs origin/ops refs
    # (this is the cloud path — no worktree present).
    wc = build(tmp_path)
    missing = tmp_path / "does-not-exist"
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=missing,
                       main_ref="origin/main", ops_ref="origin/ops")
    assert report["mode"].startswith("refs")
    assert not sdd.has_drift(report)


# --- sync() (ops-write path) ------------------------------------------------
def _origin_ops_has(wc, path):
    _git(wc, "fetch", "-q", "origin")
    r = _git(wc, "cat-file", "-e", f"origin/ops:{path}", check=False)
    return r.returncode == 0


def test_sync_pushes_main_content_to_ops(tmp_path):
    # ops is missing run.md and has stale agents/fyt.md; sync fixes both.
    def mutate(wc):
        _git(wc, "rm", "-q", "orgs/foo/workflows/run.md")
        _write(wc, "agents/fyt.md", "STALE ops agent\n")
    wc = build(tmp_path, mutate)
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")

    result = sdd.sync(ops_root, sdd.DAEMON_READ_DIRS, ops_root, main_ref="origin/main")
    assert result["committed"] and result["pushed"]

    # origin/ops now carries main's content.
    assert _origin_ops_has(wc, "orgs/foo/workflows/run.md")
    _git(wc, "fetch", "-q", "origin")
    fixed = _git(wc, "show", "origin/ops:agents/fyt.md").stdout
    assert "STALE" not in fixed and "agent one" in fixed

    # A follow-up check reports clean.
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=None,
                       main_ref="origin/main", ops_ref="origin/ops")
    assert not sdd.has_drift(report), report


def test_sync_noop_when_already_synced(tmp_path):
    wc = build(tmp_path)  # ops already == main
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")
    result = sdd.sync(ops_root, sdd.DAEMON_READ_DIRS, ops_root, main_ref="origin/main")
    assert not result["committed"] and not result["pushed"]


def test_sync_keeps_ops_only_without_prune(tmp_path):
    def mutate(wc):
        _write(wc, "agents/ghost.md", "extra ops-only agent\n")
    wc = build(tmp_path, mutate)
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")
    result = sdd.sync(ops_root, sdd.DAEMON_READ_DIRS, ops_root,
                      main_ref="origin/main", prune=False)
    assert result["kept_ops_only"] == ["agents/ghost.md"]
    assert result["pruned"] == []
    assert (ops_root / "agents" / "ghost.md").exists()


def test_sync_prune_removes_ops_only(tmp_path):
    def mutate(wc):
        _write(wc, "agents/ghost.md", "extra ops-only agent\n")
    wc = build(tmp_path, mutate)
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")
    result = sdd.sync(ops_root, sdd.DAEMON_READ_DIRS, ops_root,
                      main_ref="origin/main", prune=True)
    assert result["pruned"] == ["agents/ghost.md"]
    assert not (ops_root / "agents" / "ghost.md").exists()
    assert not _origin_ops_has(wc, "agents/ghost.md")


# --- CLI (exercises the exact invocation a cadence runs) --------------------
def test_cli_check_exits_nonzero_on_drift(tmp_path):
    def mutate(wc):
        _write(wc, "agents/fyt.md", "drifted\n")
    wc = build(tmp_path, mutate)
    script = Path(sdd.__file__)
    clean = subprocess.run(
        [sys.executable, str(script), "--check", "--repo-root", str(wc),
         "--ops-root", str(tmp_path / "no-worktree")],
        capture_output=True, text=True,
    )
    assert clean.returncode == 1, clean.stdout + clean.stderr
    assert "content-differs" in clean.stdout


def test_cli_check_exits_zero_when_clean(tmp_path):
    wc = build(tmp_path)
    script = Path(sdd.__file__)
    r = subprocess.run(
        [sys.executable, str(script), "--check", "--repo-root", str(wc),
         "--ops-root", str(tmp_path / "no-worktree")],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert "clean" in r.stdout
