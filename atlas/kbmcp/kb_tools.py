"""kb read functions + the two ops WRITE tools Atlas is allowed (file_card / launch_workflow via
`file_card`, and credit_remaining). The reads are pure over a checkout; the write goes through an
injected git-runner seam so it's unit-testable against a throwaway repo. No MCP imports here."""
import datetime, json, os, sys, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import cards as kb_cards
import ledger as kb_ledger
from worker import gitseam   # shared git seam (no voice imports); reachable without livekit

STATES = ("inbox", "working", "done", "approvals")

# Default ops worktree for both reads (kb_root) and card-filing writes (ops_root). They coincide
# today (the ops worktree IS the read checkout); kept as separate resolvers so a future split is a
# one-line change, and so tests point ATLAS_OPS_ROOT at a throwaway repo without touching reads.
DEFAULT_OPS_ROOT = r"C:/Users/danie/kb-worktrees/dashboard-ops"
OPS_REMOTE = "origin"
OPS_BRANCH = "ops"
PUSH_RETRIES = 3
# Deepgram management API (verified via context7 /websites/developers_deepgram, 2026-07-20):
# GET /v1/projects -> {"projects":[{project_id,name}]}; GET /v1/projects/<id>/balances ->
# {"balances":[{balance_id,amount,units,purchase_order_id}]}. Auth header: "Token <API_KEY>".
DEEPGRAM_BASE = "https://api.deepgram.com"

def kb_root() -> Path:
    return Path(os.environ.get("ATLAS_KB_ROOT", DEFAULT_OPS_ROOT))

def ops_root() -> Path:
    return Path(os.environ.get("ATLAS_OPS_ROOT", DEFAULT_OPS_ROOT))

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


# --- write tool: file a card into queue/inbox on ops (design §6) ------------------------------
def file_card(ops_root, project, action, target, risk_tier, body: str = "",
              workflow=None, git_runner=gitseam.default_git_runner) -> dict:
    """File one card into `queue/inbox/` on the ops worktree and STOP — the dispatcher assigns
    owners; Atlas never claims, transitions, or self-assigns (contract: queues-for-me/supervised).

    Stamps `workflow: atlas-voice` when `workflow` is None, else the named workflow — a named
    workflow IS `launch_workflow` (same card-backed path, different stamp). Writes under the
    pull-rebase-before-write rule with a bounded rejected-push -> reconcile -> retry loop, all
    through the injected `git_runner` seam (tests: throwaway repo + local bare origin).

    Returns `{"id", "path"}`. A card-schema validation failure (bad risk_tier, missing field)
    is re-raised as `ValueError` with the schema's message so the tool surface can speak it (the
    registry dispatch turns it into "ERROR: ..."); the card is BUILT (and thus validated) before
    any git write, so an invalid card never touches the repo.
    """
    try:
        card = kb_cards.new_card(project, action, target, risk_tier, body=body,
                                 workflow=(workflow or "atlas-voice"))
    except kb_cards.ValidationError as e:
        raise ValueError(str(e)) from e

    root = Path(ops_root)
    gitseam.run(git_runner, root, ["pull", "--rebase", OPS_REMOTE, OPS_BRANCH])
    kb_cards.save(card, root / "queue")
    rel = f"queue/inbox/{card.meta['id']}.md"
    gitseam.run(git_runner, root, ["add", rel])
    gitseam.run(git_runner, root,
                [*gitseam.ATLAS_IDENTITY, "commit", "-m",
                 f"atlas: voice-filed card {card.meta['id']} [atlas-voice]"])
    gitseam.push_with_retry(git_runner, root, OPS_REMOTE, OPS_BRANCH, PUSH_RETRIES)
    return {"id": card.meta["id"], "path": rel}


# --- read tool: Deepgram credit remaining (key read inside, never returned) -------------------
def _default_http_get(url: str, headers: dict) -> dict:
    """Real transport: authenticated GET returning parsed JSON. Only used in production — every
    test injects its own `http_get`, so this never runs (and never hits the network) under pytest."""
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=10) as resp:   # nosec - fixed Deepgram host
        return json.loads(resp.read().decode("utf-8"))


def credit_remaining(http_get=_default_http_get) -> dict:
    """How much Deepgram credit is left. Reads `DEEPGRAM_API_KEY` from env HERE, inside the
    function — never a parameter — and passes it only as the `Authorization: Token <key>` transport
    header; the key never appears in the return value (the scoped-key carve-out: provably leak-free).

    Two calls (the balances endpoint is project-scoped): list projects, then read the first
    project's balances, summing them. Returns `{"balance", "units"}` (both speakable), plus the
    per-balance count — no ids, no key."""
    key = os.environ.get("DEEPGRAM_API_KEY", "")
    headers = {"Authorization": f"Token {key}", "Accept": "application/json"}
    projects = http_get(f"{DEEPGRAM_BASE}/v1/projects", headers)
    project_id = projects["projects"][0]["project_id"]
    data = http_get(f"{DEEPGRAM_BASE}/v1/projects/{project_id}/balances", headers)
    balances = data.get("balances", [])
    amount = round(sum(float(b.get("amount", 0)) for b in balances), 2)
    units = balances[0].get("units", "USD") if balances else "USD"
    return {"balance": amount, "units": units, "count": len(balances)}
