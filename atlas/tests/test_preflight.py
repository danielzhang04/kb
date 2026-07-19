"""Standing pre-flight sweep: proves the kb infra Atlas leans on works TODAY."""
import os, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OPS = Path(os.environ.get("ATLAS_KB_ROOT", r"C:/Users/danie/kb-worktrees/dashboard-ops"))

def test_kb_scripts_importable():
    sys.path.insert(0, str(REPO / "scripts"))
    import cards, ledger  # noqa: F401
    assert callable(cards.parse) and callable(ledger.cost_today)

def test_ops_state_readable():
    assert (OPS / "queue" / "inbox").is_dir()
    assert (OPS / "dashboards" / "executive.md").is_file()

def test_ops_worktree_is_ops_branch():
    r = subprocess.run(["git", "-C", str(OPS), "branch", "--show-current"],
                       capture_output=True, text=True)
    assert r.stdout.strip() == "ops"
