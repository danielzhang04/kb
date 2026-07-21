"""Pure read functions over a kb checkout. No MCP imports here — unit-testable directly."""
import datetime, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import cards as kb_cards
import ledger as kb_ledger

STATES = ("inbox", "working", "done", "approvals")

def kb_root() -> Path:
    return Path(os.environ.get("ATLAS_KB_ROOT", r"C:/Users/danie/kb-worktrees/dashboard-ops"))

def queue_summary(repo_root: Path, state: str | None = None) -> dict:
    states = (state,) if state else STATES
    counts, out = {}, []
    for st in states:
        files = sorted((repo_root / "queue" / st).glob("*.md"))
        counts[st] = len(files)
        for p in files:
            c = kb_cards.parse(p)
            out.append({"id": c.meta.get("id"), "state": st,
                        "project": c.meta.get("project"), "action": c.meta.get("action")})
    return {"counts": counts, "cards": out}

def read_dashboard(repo_root: Path, name: str = "executive") -> str:
    return (repo_root / "dashboards" / f"{name}.md").read_text(encoding="utf-8")

def read_state(repo_root: Path, project: str) -> str:
    p = repo_root / "orgs" / project / "STATE.md"
    if not p.is_file():
        # Name the known projects in the error so every tool surface (fastlane/LiveKit/MCP all
        # funnel this through dispatch's "ERROR: ..." path) hands the LLM a recovery hint.
        known = ", ".join(sorted(d.name for d in (repo_root / "orgs").iterdir() if d.is_dir()))
        raise FileNotFoundError(f"no such project STATE: {project}. Known projects: {known}")
    return p.read_text(encoding="utf-8")

def ledger_rollup(repo_root: Path) -> dict:
    today = datetime.date.today().isoformat()
    return {"cost_today_usd": kb_ledger.cost_today(repo_root),
            "activity_today": len(kb_ledger.read_day(repo_root, "activity", today))}

def running_work(repo_root: Path) -> list[dict]:
    return queue_summary(repo_root, state="working")["cards"]
