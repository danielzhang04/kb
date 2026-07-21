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

# --- V1 additions (2026-07-20): infra the Hands wave leans on ---

def test_dispatcher_importable():
    """V1 sweep static guard: the dispatcher Atlas-filed cards flow through parses/imports.
    (The live end-to-end proof is a wave-open gate, not CI — see V1 plan Task 1.)"""
    sys.path.insert(0, str(REPO / "scripts"))
    import dispatch  # noqa: F401
    assert callable(dispatch.run)

def test_dashboard_panels_surface_exists():
    """The panel tier Task 7 extends must exist where the plan says it does."""
    panels = REPO / "dashboard" / "server" / "panels"
    assert panels.is_dir()
    assert (panels / "routes.ts").is_file()
