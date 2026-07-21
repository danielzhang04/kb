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
    _git(wc, "fetch", "-q", "origin")
    return wc
