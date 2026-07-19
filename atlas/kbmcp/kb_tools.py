"""Pure read functions over a kb checkout. No MCP imports here — unit-testable directly."""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import cards as kb_cards

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
