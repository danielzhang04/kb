"""Tests for scripts/sync_daemon_dirs.py.

Each test builds throwaway git repos (a bare "origin" plus a working clone with
``main`` and ``ops`` branches) so drift detection and the ops-write sync path are
exercised end-to-end without touching the real kb repo. Modelled on the temp-repo
approach used by the rest of scripts/ tests.
"""
import subprocess
import sys
from pathlib import Path

import pytest

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
    # newline="" disables Windows \n->\r\n translation so "\n" content is stored
    # as genuine LF (otherwise every fixture would silently be CRLF on disk).
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write(content)


def _commit_all(root, msg):
    _git(root, "add", "-A")
    _git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg)


# Baseline daemon-read content laid down on main in every scenario. The STATE.md
# file sits next to a workflows dir but is NOT a daemon-read path — it must never
# appear in any drift report (guards the pattern matcher). governance/ carries the
# one mirrored FILE entry plus a sibling that must stay unmirrored, which is what
# keeps "one registry file" from quietly becoming "the governance tree".
MAIN_LAYOUT = {
    "agents/fyt.md": "agent one\n",
    "orgs/foo/workflows/run.md": "workflow one\n",
    "orgs/foo/workflows/seg/a.js": "console.log(1)\n",
    "orgs/foo/STATE.md": "not a daemon-read dir\n",
    "governance/model-routing.yaml": "runtimes:\n  claude:\n    known_models: [claude-fable-5]\n",
    "governance/risk-tiers.md": "not a daemon-read path\n",
}


def build(tmp_path, ops_mutate=None):
    """Create origin + working clone with main and ops branches; return the clone."""
    origin = Path(tmp_path) / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", str(origin)],
                   check=True, capture_output=True)
    wc = Path(tmp_path) / "wc"
    subprocess.run(["git", "clone", "-q", str(origin), str(wc)],
                   check=True, capture_output=True)
    # Deterministic bytes so CRLF tests store exactly what they write (shared
    # config is inherited by worktrees added from this clone).
    _git(wc, "config", "core.autocrlf", "false")

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


def test_matcher_file_entry_is_exactly_one_file():
    """W61: governance/model-routing.yaml is a FILE entry, not a governance/ doorway.

    The daemon compiles its execution-profile catalogue from that one registry file
    (dashboard/server/control/environment.ts#loadExecutionProfiles); everything else
    under governance/ is human-edited policy that must never ride the mirror.
    """
    matchers = sdd._compile(sdd.DAEMON_READ_DIRS)
    assert sdd._matches("governance/model-routing.yaml", matchers)
    for miss in (
        "governance/risk-tiers.md",
        "governance/budget.yaml",
        "governance/model-routing.yaml.bak",
        "governance/model-routing.yaml/nested.yaml",
        "governance",
    ):
        assert not sdd._matches(miss, matchers), miss


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


def test_check_detects_model_routing_drift(tmp_path):
    """W61: the file entry is reported when ops drifts - the 2026-09-04 VM symptom.

    ops carried claude-opus-4-8 while main had moved to claude-fable-5, so the daemon
    compiled a catalogue with no manager:claude:claude-fable-5 and every launch of that
    assignment answered 400 assigned-profile-not-found. Before the file entry existed this
    report came back clean, which is why the drift went unseen.
    """
    def mutate(wc):
        _write(wc, "governance/model-routing.yaml",
               "runtimes:\n  claude:\n    known_models: [claude-opus-4-8]\n")
    wc = build(tmp_path, mutate)
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=None,
                       main_ref="origin/main", ops_ref="origin/ops")
    assert report["differs"] == ["governance/model-routing.yaml"]
    assert sdd.has_drift(report)


def test_check_detects_model_routing_missing_from_ops(tmp_path):
    """A fresh ops checkout without the registry file is main-only drift, not silence."""
    def mutate(wc):
        _git(wc, "rm", "-q", "governance/model-routing.yaml")
    wc = build(tmp_path, mutate)
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=None,
                       main_ref="origin/main", ops_ref="origin/ops")
    assert report["main_only"] == ["governance/model-routing.yaml"]


def test_check_ignores_other_governance_files(tmp_path):
    """An ops-side edit to another governance file is NOT drift this tool reports or fixes."""
    def mutate(wc):
        _write(wc, "governance/risk-tiers.md", "ops edited policy\n")
    wc = build(tmp_path, mutate)
    report = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=None,
                       main_ref="origin/main", ops_ref="origin/ops")
    assert not sdd.has_drift(report), report


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


def test_sync_mirrors_model_routing_and_leaves_governance_alone(tmp_path):
    """W61 end-to-end: --sync fixes the registry file and touches nothing else in governance/."""
    def mutate(wc):
        _write(wc, "governance/model-routing.yaml",
               "runtimes:\n  claude:\n    known_models: [claude-opus-4-8]\n")
        _write(wc, "governance/risk-tiers.md", "ops-side policy edit\n")
    wc = build(tmp_path, mutate)
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")

    result = sdd.sync(ops_root, sdd.DAEMON_READ_DIRS, ops_root, main_ref="origin/main")
    assert result["committed"] and result["pushed"]

    _git(wc, "fetch", "-q", "origin")
    mirrored = _git(wc, "show", "origin/ops:governance/model-routing.yaml").stdout
    assert "claude-fable-5" in mirrored and "claude-opus-4-8" not in mirrored
    # The mirror commit carries the registry file ONLY.
    committed = _git(ops_root, "show", "--name-only", "--format=", "HEAD").stdout
    assert committed.split() == ["governance/model-routing.yaml"], committed
    # The sibling policy file keeps its ops-side content: not mirrored, not reverted.
    assert "ops-side policy edit" in _git(wc, "show", "origin/ops:governance/risk-tiers.md").stdout


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


# --- Review round 1 regression tests ----------------------------------------
def test_crlf_content_clean_in_both_modes(tmp_path):
    # M2/d: ops holds the same logical content as main but with CRLF line
    # endings. Neither mode may report drift, and they must agree.
    def mutate(wc):
        (Path(wc) / "agents" / "fyt.md").write_bytes(b"agent one\r\n")  # main: LF
    wc = build(tmp_path, mutate)

    refs = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=None,
                     main_ref="origin/main", ops_ref="origin/ops")
    assert not sdd.has_drift(refs), refs  # refs mode: normalized, clean

    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")
    disk = sdd.check(wc, sdd.DAEMON_READ_DIRS, ops_root=ops_root,
                     main_ref="origin/main")
    assert not sdd.has_drift(disk), disk  # disk mode agrees


def test_sync_fetches_stale_main_before_checkout(tmp_path):
    # B1/e: the ops worktree's origin/main is stale; a new org merged on main
    # after the worktree was created must still be mirrored (requires an internal
    # fetch). repo_root and ops_root are separate clones — the real topology.
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", str(origin)],
                   check=True, capture_output=True)

    caller = tmp_path / "caller"
    subprocess.run(["git", "clone", "-q", str(origin), str(caller)],
                   check=True, capture_output=True)
    _git(caller, "config", "core.autocrlf", "false")
    _git(caller, "checkout", "-q", "-b", "main")
    _write(caller, "agents/fyt.md", "agent one\n")
    _commit_all(caller, "main v1")
    _git(caller, "push", "-q", "-u", "origin", "main")
    _git(caller, "checkout", "-q", "-b", "ops", "main")
    _git(caller, "push", "-q", "-u", "origin", "ops")
    _git(caller, "checkout", "-q", "main")

    # Separate ops clone + worktree; its origin/main now freezes at v1.
    opsclone = tmp_path / "opsclone"
    subprocess.run(["git", "clone", "-q", str(origin), str(opsclone)],
                   check=True, capture_output=True)
    _git(opsclone, "config", "core.autocrlf", "false")
    ops_root = tmp_path / "ops_wt"
    _git(opsclone, "worktree", "add", "-q", str(ops_root), "ops")

    # main advances: a brand-new org's workflow lands. opsclone hasn't fetched.
    _write(caller, "orgs/bar/workflows/new.md", "brand new workflow\n")
    _commit_all(caller, "main v2 adds orgs/bar")
    _git(caller, "push", "-q", "origin", "main")

    result = sdd.sync(ops_root, sdd.DAEMON_READ_DIRS, ops_root, main_ref="origin/main")
    assert result["committed"] and result["pushed"], result
    assert _origin_ops_has(caller, "orgs/bar/workflows/new.md")


def test_sync_split_root_ignores_stale_repo_root(tmp_path):
    # MINOR-1 (round 2): repo_root != ops_root and repo_root is a STALE clone
    # frozen before a new org merged. sync must enumerate what to mirror from the
    # freshly-fetched ops_root, never the stale repo_root, or the new org is
    # silently skipped — re-opening the drift class this tool kills.
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", str(origin)],
                   check=True, capture_output=True)

    caller = tmp_path / "caller"
    subprocess.run(["git", "clone", "-q", str(origin), str(caller)],
                   check=True, capture_output=True)
    _git(caller, "config", "core.autocrlf", "false")
    _git(caller, "checkout", "-q", "-b", "main")
    _write(caller, "agents/fyt.md", "agent one\n")
    _commit_all(caller, "main v1")
    _git(caller, "push", "-q", "-u", "origin", "main")
    _git(caller, "checkout", "-q", "-b", "ops", "main")
    _git(caller, "push", "-q", "-u", "origin", "ops")
    _git(caller, "checkout", "-q", "main")

    # A distinct clone used ONLY as repo_root — deliberately never fetched again,
    # so its origin/main is frozen at v1 (no orgs/bar).
    stale_repo_root = tmp_path / "stale_repo"
    subprocess.run(["git", "clone", "-q", str(origin), str(stale_repo_root)],
                   check=True, capture_output=True)

    opsclone = tmp_path / "opsclone"
    subprocess.run(["git", "clone", "-q", str(origin), str(opsclone)],
                   check=True, capture_output=True)
    _git(opsclone, "config", "core.autocrlf", "false")
    ops_root = tmp_path / "ops_wt"
    _git(opsclone, "worktree", "add", "-q", str(ops_root), "ops")

    # main advances with a brand-new org AFTER both other clones froze.
    _write(caller, "orgs/bar/workflows/new.md", "brand new workflow\n")
    _commit_all(caller, "main v2 adds orgs/bar")
    _git(caller, "push", "-q", "origin", "main")

    result = sdd.sync(stale_repo_root, sdd.DAEMON_READ_DIRS, ops_root,
                      main_ref="origin/main")
    assert result["committed"] and result["pushed"], result
    assert _origin_ops_has(caller, "orgs/bar/workflows/new.md")


def test_sync_ignores_unrelated_worktree_files_when_in_sync(tmp_path):
    # B2/b: unrelated untracked (.playwright-mcp/) + staged files in the shared
    # ops worktree must not crash an already-in-sync run nor trigger a commit.
    wc = build(tmp_path)
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")
    _write(ops_root, ".playwright-mcp/session.json", "{}\n")   # untracked
    _write(ops_root, "notes-unrelated.md", "wip\n")            # staged, unrelated
    _git(ops_root, "add", "notes-unrelated.md")

    result = sdd.sync(ops_root, sdd.DAEMON_READ_DIRS, ops_root, main_ref="origin/main")
    assert not result["committed"], "unrelated files must not produce a mirror commit"
    assert (ops_root / ".playwright-mcp" / "session.json").exists()
    assert (ops_root / "notes-unrelated.md").exists()


def test_sync_commit_excludes_unrelated_staged_files(tmp_path):
    # B2/b: when a real mirror change IS committed, unrelated staged/untracked
    # files in the shared worktree must NOT be swept into the ops mirror commit.
    def mutate(wc):
        _write(wc, "agents/fyt.md", "STALE ops agent\n")
    wc = build(tmp_path, mutate)
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")
    _write(ops_root, "notes-unrelated.md", "wip\n")
    _git(ops_root, "add", "notes-unrelated.md")
    _write(ops_root, ".playwright-mcp/session.json", "{}\n")

    result = sdd.sync(ops_root, sdd.DAEMON_READ_DIRS, ops_root, main_ref="origin/main")
    assert result["committed"]
    committed = _git(ops_root, "show", "--name-only", "--format=", "HEAD").stdout
    assert "agents/fyt.md" in committed
    assert "notes-unrelated.md" not in committed, committed
    # The unrelated changes survive uncommitted in the worktree.
    assert (ops_root / "notes-unrelated.md").exists()
    assert (ops_root / ".playwright-mcp" / "session.json").exists()


def test_sync_aborts_cleanly_on_rebase_conflict(tmp_path):
    # M1/c: a conflicting rebase must not leave conflict markers or a
    # rebase-merge state in the worktree the live daemon reads.
    wc = build(tmp_path)
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")
    target = "orgs/kb-ops/workflows/email-triage.md"

    # Local (unpushed) ops commit editing the file.
    _write(ops_root, target, "LOCAL ops edit\n")
    _commit_all(ops_root, "local ops edit")

    # Conflicting remote ops commit to the same file, via a separate clone.
    rc = tmp_path / "rc"
    subprocess.run(["git", "clone", "-q", str(tmp_path / "origin.git"), str(rc)],
                   check=True, capture_output=True)
    _git(rc, "checkout", "-q", "ops")
    _write(rc, target, "REMOTE ops edit\n")
    _commit_all(rc, "remote ops edit")
    _git(rc, "push", "-q", "origin", "ops")

    with pytest.raises(SystemExit):
        sdd.sync(ops_root, sdd.DAEMON_READ_DIRS, ops_root, main_ref="origin/main")

    # No mid-rebase state left behind, no conflict markers in the file.
    rebase_dir = _git(ops_root, "rev-parse", "--git-path", "rebase-merge").stdout.strip()
    assert not (ops_root / rebase_dir).exists() and not Path(rebase_dir).exists()
    assert "<<<<<<<" not in (ops_root / target).read_text(encoding="utf-8")


def test_sync_retries_on_rejected_push(tmp_path, monkeypatch):
    # M3/a: a concurrent writer advances origin/ops between our rebase and push,
    # so the first push is rejected; sync must re-rebase and push successfully.
    def mutate(wc):
        _write(wc, "agents/fyt.md", "STALE ops agent\n")
    wc = build(tmp_path, mutate)
    ops_root = _add_ops_worktree(wc, tmp_path / "ops_wt")
    origin = tmp_path / "origin.git"

    original_git = sdd._git
    state = {"injected": False}

    def racing_git(cwd, *args, **kwargs):
        if args[:3] == ("push", "origin", "ops") and not state["injected"]:
            state["injected"] = True
            # A competing writer lands an unrelated commit on origin/ops first.
            rc = tmp_path / "racer"
            subprocess.run(["git", "clone", "-q", str(origin), str(rc)],
                           check=True, capture_output=True)
            _git(rc, "checkout", "-q", "ops")
            _write(rc, "orgs/kb-ops/STATE.md", "competing writer\n")
            _commit_all(rc, "competing commit")
            _git(rc, "push", "-q", "origin", "ops")
        return original_git(cwd, *args, **kwargs)

    monkeypatch.setattr(sdd, "_git", racing_git)
    result = sdd.sync(ops_root, sdd.DAEMON_READ_DIRS, ops_root, main_ref="origin/main")
    assert result["committed"] and result["pushed"]

    # Both the competing commit and our mirror landed on origin/ops.
    assert _origin_ops_has(wc, "orgs/kb-ops/STATE.md")
    _git(wc, "fetch", "-q", "origin")
    fixed = _git(wc, "show", "origin/ops:agents/fyt.md").stdout
    assert "STALE" not in fixed and "agent one" in fixed
