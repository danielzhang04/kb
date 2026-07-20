# Atlas V0 (Voice Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Atlas V0 — wake word → streaming STT → Claude fast lane with read-only kb-MCP tools → streaming TTS — so Daniel can ask Atlas anything about kb state and get a spoken answer inside the latency bar.

**Architecture:** Per `docs/specs/2026-07-19-atlas-build-delta-design.md` (amending the approved 07-15 spec): all code in `kb/atlas/` (`mcp/` read-only stdio MCP server wrapping `scripts/*.py`; `worker/` LiveKit Agents app; `config/` teachable stores), a registration stub at `orgs/atlas/`, and a text-mode debug REPL so every layer is testable without audio hardware. The MCP server is the only door between voice stack and kb.

**Tech Stack:** Python 3.13 (`py -3.13`), `mcp` (official Python SDK, FastMCP), `livekit-agents` 1.6.6 + plugins (deepgram, anthropic, elevenlabs), `openwakeword` 0.6.0, `anthropic` SDK, pytest.

## Global Constraints

- Worktree: `C:/Users/danie/kb-worktrees/atlas`, branch `claude/atlas` (from origin/main e948ec4). Never push main; PR at wave end.
- Ops coordination writes go through worktree `C:/Users/danie/kb-worktrees/dashboard-ops`: `git -C <ops> pull --rebase origin ops` immediately before EVERY write, push immediately after; rejected push = re-read, reconcile, retry.
- Workers are Opus 4.8 or below; model self-reported in output AND orchestrator-verified. Implementers commit locally on `claude/atlas` only and never push; the orchestrator reviews every diff (task reviewer + own pass), owns all pushes, and owns all ops-branch writes (cards, ledgers, STATE).
- Atlas has its own venv `atlas/.venv` and its own test tree `atlas/tests/` — voice deps must NOT leak into the fleet suite. Fleet suite (`py -3.13 -m pytest tests/`) must stay green and dependency-free of atlas.
- Atlas pytest invocation (from repo root): `atlas\.venv\Scripts\python -m pytest atlas/tests -v`.
- Secrets: the scoped Anthropic key + vendor keys live ONLY in the worker's process env (loaded from `%USERPROFILE%\.atlas\env`, a file OUTSIDE the repo, never committed, never printed). Unit tests never need them.
- No purchases/signups by agents — Task 5/6 human gates cover keys and accounts. Nothing else spends money.
- Card discipline: cards `project: atlas`, `risk-tier: T2`, `role: work`, `runtime: claude`, model stamped `opus`; lifecycle inbox→working→done; inspector grades each card fresh-context (grade bar per `governance/risk-tiers.md`).
- `governance/` and `CLAUDE.md` are NEVER edited by agents — the preamble carve-out is drafted as a proposal file for Daniel (Task 2).
- LiveKit/plugin APIs move fast: any step that writes LiveKit/Deepgram/TTS integration code MUST first pull current docs via context7 (`mcp__plugin_context7_context7__query-docs`) for `livekit-agents` 1.6.6 and adjust the given code to the shipped API, keeping the step's behavior contract identical.

---

### Task 1: V0 pre-flight sweep

**Files:**
- Create: `atlas/requirements.txt`, `atlas/tests/test_preflight.py`
- Create (generated): `atlas/.venv/` (never committed; add `atlas/.venv/` to root `.gitignore` if absent)

**Interfaces:**
- Produces: a working venv at `atlas/.venv`; `test_preflight.py` stays in the suite as a standing sweep later phases re-run.

- [ ] **Step 1: Write `atlas/requirements.txt`**

```
mcp>=1.2
anthropic>=0.40
pytest>=8
pyyaml>=6
# voice deps land in Task 6 (livekit-agents==1.6.6 etc.); keep V0 unit lane light
```

- [ ] **Step 2: Create venv + install**

Run: `py -3.13 -m venv atlas/.venv && atlas\.venv\Scripts\python -m pip install -r atlas/requirements.txt`
Expected: install succeeds, no compiler errors.

- [ ] **Step 3: Write the sweep test**

```python
# atlas/tests/test_preflight.py
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
```

- [ ] **Step 4: Run, verify pass** — `atlas\.venv\Scripts\python -m pytest atlas/tests -v` → 3 PASS.
- [ ] **Step 5: Commit** — `git add atlas/requirements.txt atlas/tests/test_preflight.py .gitignore && git commit -m "feat(atlas): V0 pre-flight sweep + venv scaffold"`

---

### Task 2: Project registration, cards, and the carve-out draft

**Files:**
- Create (ops worktree): `orgs/atlas/` via `scripts/new_project.py`; delete `orgs/atlas-prep/`; edit `orgs/atlas/contract.md`, `orgs/atlas/STATE.md`, `_index.md` (atlas-prep line removal)
- Create (ops worktree): `queue/inbox/<id>.md` × 6 (cards for Tasks 3–8)
- Create (work branch): `docs/proposals/2026-07-19-atlas-preamble-carveout.md`

**Interfaces:**
- Consumes: `scripts/new_project.py::create(repo_root, name)`; `scripts/cards.py::new_card(project, action, target, risk_tier, body, **extra)` + `save(card, queue_root)`.
- Produces: project `atlas` registered (cards with `project: atlas` validate); card ids recorded in this plan's execution notes; carve-out proposal text for Daniel.

- [ ] **Step 1: Rebase ops worktree** — `git -C C:/Users/danie/kb-worktrees/dashboard-ops pull --rebase origin ops`
- [ ] **Step 2: Scaffold + retire (script run once, not committed to repo)**

```python
import sys; sys.path.insert(0, r"C:/Users/danie/kb/scripts")
import shutil, new_project
from pathlib import Path
OPS = Path(r"C:/Users/danie/kb-worktrees/dashboard-ops")
new_project.create(OPS, "atlas")
shutil.rmtree(OPS / "orgs" / "atlas-prep")          # empty scaffold, retirement approved in delta design §2
idx = OPS / "_index.md"
idx.write_text(idx.read_text(encoding="utf-8").replace(
    "- [atlas-prep](orgs/atlas-prep/_index.md)\n", ""), encoding="utf-8")
```

(`new_project.create` also writes HEARTBEAT.md + raw/wiki/output dirs — keep them; consistency with the standard scaffold beats the delta design's "3-file" minimalism. Note this in execution notes.)

- [ ] **Step 3: Edit `orgs/atlas/contract.md`** — replace template body with:

```markdown
# atlas — contract (autonomy policy)

Conservative default: EVERYTHING queues-for-me until grades earn wider lists (governance/risk-tiers.md).

## acts-alone
- update STATE.md and wiki/ in this project
- read-only kb reads via the atlas MCP server (dashboards, STATEs, queue summaries, ledger rollups)
- run atlas tests; write DRAFT reports into output/ marked DRAFT

## queues-for-me
- everything else, explicitly including: merges to main, filing cards on behalf of the user
  (V1 feature — supervised until graded), any diff > 400 lines, anything touching other projects

## wakes-me-up
- verification fails twice on the same item; daily budget breached; any request to handle
  a secret as an object; governance rule violated

## spend authorization (PENDING DANIEL RATIFICATION — inert until he commits this line himself)
- voice services up to ~$50/mo total: Deepgram STT, LiveKit Cloud, one TTS vendor, scoped
  Anthropic API key for the fast lane. All spend ledgered to ledgers/cost/atlas-*.tsv under
  the daily budget guard. Accounts and keys are created by Daniel only.
```

- [ ] **Step 4: File 6 cards (Tasks 3–8)** with `new_card("atlas", action, target, "T2", body="## Work order\nPer docs/plans/2026-07-19-atlas-v0-plan.md Task N (branch claude/atlas). <one-line deliverable>\n", role="work", runtime="claude", model="opus", workflow="atlas-v0")`, `save(c, OPS/"queue")`. Actions: T3 "build kb-MCP fixture + queue_summary tool"; T4 "build remaining MCP read tools"; T5 "build router + fast lane + debug REPL"; T6 "build LiveKit worker + pairing smoke"; T7 "wake-word gating + engagement window"; T8 "latency harness + persona samples + V0 checkpoint". Verify all parse: `cards.parse()` over the new files. (Inspect `new_card` extra-field spelling against `governance/card-schema.md` before running — match exactly.)
- [ ] **Step 5: Commit + push ops** — `git -C <ops> add orgs _index.md queue/inbox && git -C <ops> commit -m "atlas: register project, retire atlas-prep, file V0 cards [atlas-v0]" && git -C <ops> push origin ops`
- [ ] **Step 6: Write the carve-out proposal** (work branch) — `docs/proposals/2026-07-19-atlas-preamble-carveout.md` containing the exact CLAUDE.md diff Daniel would apply: an amendment to the preamble section stating "`ANTHROPIC_API_KEY` must be unset **in fleet agent environments**. Exception (2026-07-19): the Atlas voice worker process may hold a spend-capped key in its own environment only, loaded from outside the repo, never printed/persisted/copied; spend ledgered to `ledgers/cost/atlas-*.tsv`." Commit: `docs(atlas): preamble carve-out proposal for Daniel`.
- [ ] **Step 7: HUMAN GATE — present to Daniel:** (a) ratify contract spend line + carve-out proposal (he commits CLAUDE.md himself), (b) confirm card list. Do not proceed to Task 5's live steps until (a) is ratified; Tasks 3–4 need no ratification.

---

### Task 3: kb-MCP server — fixture + `queue_summary` (TDD)

**Files:**
- Create: `atlas/kbmcp/__init__.py` (empty), `atlas/kbmcp/kb_tools.py`, `atlas/kbmcp/server.py`, `atlas/tests/conftest.py`, `atlas/tests/test_kb_tools.py`

**Interfaces:**
- Consumes: `scripts/cards.py` (`new_card`, `save`, `parse`, `transition`).
- Produces: `kb_tools.queue_summary(repo_root: Path, state: str|None = None) -> dict` returning `{"counts": {state: int}, "cards": [{"id","state","project","action"}]}`; `kb_tools.kb_root() -> Path` env resolver (`ATLAS_KB_ROOT`, default dashboard-ops worktree); `server.py` exposing tools over stdio via FastMCP. Later tasks add functions to `kb_tools.py` and register them in `server.py`. (Package is `kbmcp`, NOT `mcp`, to avoid shadowing the SDK package.)

- [ ] **Step 1: Write the fixture factory + failing tests**

```python
# atlas/tests/conftest.py
import sys
from pathlib import Path
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(REPO / "atlas"))
import pytest, cards

@pytest.fixture
def kb_fixture(tmp_path):
    """Minimal kb repo built with the REAL card schema (no hand-guessed frontmatter)."""
    for q in ("inbox", "working", "done", "approvals"):
        (tmp_path / "queue" / q).mkdir(parents=True)
    (tmp_path / "dashboards").mkdir()
    (tmp_path / "dashboards" / "executive.md").write_text("# Executive\nAll quiet.\n", encoding="utf-8")
    (tmp_path / "orgs" / "demo").mkdir(parents=True)
    (tmp_path / "orgs" / "demo" / "STATE.md").write_text("# demo — STATE\n## Now\ntesting\n", encoding="utf-8")
    c1 = cards.new_card("demo", "do a thing", "wiki/", "T2", body="## Work order\nx\n")
    cards.save(c1, tmp_path / "queue")                      # lands in inbox
    c2 = cards.new_card("demo", "another thing", "output/", "T1", body="## Work order\ny\n")
    p2 = cards.save(c2, tmp_path / "queue")
    cards.transition(cards.parse(p2), "working", tmp_path / "queue")
    return tmp_path
```

```python
# atlas/tests/test_kb_tools.py
from kbmcp.kb_tools import queue_summary

def test_queue_summary_counts_and_cards(kb_fixture):
    s = queue_summary(kb_fixture)
    assert s["counts"]["inbox"] == 1 and s["counts"]["working"] == 1
    assert any(c["action"] == "do a thing" and c["state"] == "inbox" for c in s["cards"])

def test_queue_summary_filters_state(kb_fixture):
    s = queue_summary(kb_fixture, state="working")
    assert set(s["counts"]) == {"working"} and len(s["cards"]) == 1
```

(If `cards.transition`'s real signature differs, adapt the fixture to the real API — the schema source of truth is `scripts/cards.py`, never guessed frontmatter.)

- [ ] **Step 2: Run, verify FAIL** — `atlas\.venv\Scripts\python -m pytest atlas/tests/test_kb_tools.py -v` → ImportError.
- [ ] **Step 3: Implement**

```python
# atlas/kbmcp/kb_tools.py
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
```

- [ ] **Step 4: Run, verify PASS** (both tests).
- [ ] **Step 5: Write `atlas/kbmcp/server.py`** (thin registration — grows in Task 4)

```python
# atlas/kbmcp/server.py
"""Atlas kb-MCP server (stdio). Read-only in V0. The ONLY door between voice stack and kb."""
from mcp.server.fastmcp import FastMCP
from kbmcp import kb_tools

app = FastMCP("kb")

@app.tool()
def queue_summary(state: str | None = None) -> dict:
    """Summarize kb task-card queues (counts + card list), optionally one state."""
    return kb_tools.queue_summary(kb_tools.kb_root(), state)

if __name__ == "__main__":
    app.run()   # stdio transport
```

- [ ] **Step 6: Smoke the stdio server** — from `atlas/`: `.venv\Scripts\python -m kbmcp.server` → process starts and waits on stdin with no import error (Ctrl-C to exit).
- [ ] **Step 7: Commit** — `feat(atlas): kb-MCP server skeleton + queue_summary (read-only)`
- [ ] **Step 8: Card lifecycle + grade** — orchestrator appends `## Result` (deliverable, commit sha, test output), moves card to done on ops (rebase/push), dispatches fresh-context inspector; verify one grade + one paired activity row.

---

### Task 4: Remaining MCP read tools (TDD)

**Files:**
- Modify: `atlas/kbmcp/kb_tools.py`, `atlas/kbmcp/server.py`, `atlas/tests/conftest.py`
- Test: `atlas/tests/test_kb_tools.py` (extend)

**Interfaces:**
- Consumes: `scripts/ledger.py::read_day(repo_root, kind, day)`, `::cost_today(repo_root)`, `::append(repo_root, kind, agent, record)`.
- Produces: `read_dashboard(repo_root, name="executive") -> str`; `read_state(repo_root, project) -> str` (raises `FileNotFoundError` on unknown project); `ledger_rollup(repo_root) -> dict` (`{"cost_today_usd": float, "activity_today": int}`); `running_work(repo_root) -> list[dict]` (working cards, same card-dict shape as Task 3).

- [ ] **Step 1: Extend the fixture** — in `conftest.py`, append to the fixture body:

```python
    import ledger
    ledger.append(tmp_path, "cost", "test-agent", {"usd": "0.00", "note": "unit"})
    ledger.append(tmp_path, "activity", "test-agent", {"note": "unit"})
```

(Read `scripts/ledger.py` first and adapt record field names to `append`'s real contract; the contract for us: `cost_today` returns a float ≥ 0 over the shard, `read_day` returns ≥ 1 activity row.)

- [ ] **Step 2: Write failing tests**

```python
from kbmcp.kb_tools import read_dashboard, read_state, ledger_rollup, running_work
import pytest

def test_read_dashboard(kb_fixture):
    assert "All quiet" in read_dashboard(kb_fixture)

def test_read_state(kb_fixture):
    assert "testing" in read_state(kb_fixture, "demo")

def test_read_state_unknown_project_raises(kb_fixture):
    with pytest.raises(FileNotFoundError):
        read_state(kb_fixture, "nope")

def test_ledger_rollup(kb_fixture):
    r = ledger_rollup(kb_fixture)
    assert r["cost_today_usd"] >= 0.0 and r["activity_today"] >= 1

def test_running_work(kb_fixture):
    w = running_work(kb_fixture)
    assert len(w) == 1 and w[0]["state"] == "working"
```

- [ ] **Step 3: Run, verify FAIL.**
- [ ] **Step 4: Implement** (append to `kb_tools.py`)

```python
import datetime
import ledger as kb_ledger

def read_dashboard(repo_root: Path, name: str = "executive") -> str:
    return (repo_root / "dashboards" / f"{name}.md").read_text(encoding="utf-8")

def read_state(repo_root: Path, project: str) -> str:
    p = repo_root / "orgs" / project / "STATE.md"
    if not p.is_file():
        raise FileNotFoundError(f"no such project STATE: {project}")
    return p.read_text(encoding="utf-8")

def ledger_rollup(repo_root: Path) -> dict:
    today = datetime.date.today().isoformat()
    return {"cost_today_usd": kb_ledger.cost_today(repo_root),
            "activity_today": len(kb_ledger.read_day(repo_root, "activity", today))}

def running_work(repo_root: Path) -> list[dict]:
    return queue_summary(repo_root, state="working")["cards"]
```

- [ ] **Step 5: Run, verify PASS** (all `atlas/tests`).
- [ ] **Step 6: Register all four in `server.py`** — one `@app.tool()` wrapper each (docstring = tool description, same pattern as `queue_summary`); `read_state`'s wrapper catches `FileNotFoundError` and returns `"Unknown project: <name>. Known: " + ", ".join(p.name for p in (root/'orgs').iterdir())` so the LLM can recover.
- [ ] **Step 7: Commit** — `feat(atlas): full V0 read-tool surface (dashboard/state/ledger/working)`
- [ ] **Step 8: Card lifecycle + grade** (as Task 3 Step 8).

---

### Task 5: Router + fast lane + debug REPL (text mode, no audio)

**Files:**
- Create: `atlas/worker/__init__.py`, `atlas/worker/router.py`, `atlas/worker/fastlane.py`, `atlas/worker/repl.py`, `atlas/config/atlas.yaml`
- Test: `atlas/tests/test_router.py`, `atlas/tests/test_fastlane.py`

**Interfaces:**
- Consumes: `kbmcp.kb_tools` functions imported directly — this in-process path doubles as the livekit/agents#2519 fallback (no MCP transport needed inside the worker).
- Produces: `router.route(utterance: str) -> str` (`"reflex" | "fast" | "work"`; V0 always `"fast"`; raises `ValueError` on empty); `fastlane.answer(question: str, client, model: str, max_turns: int = 5) -> str` running an Anthropic tool-use loop; `fastlane.TOOLS` (list of Anthropic tool schemas), `fastlane._dispatch(name, args) -> str`, `fastlane.SYSTEM` (persona-neutral V0 system prompt); `repl.load_env()` reading `%USERPROFILE%\.atlas\env`. `atlas/config/atlas.yaml` keys: `fast_model`, `escalation_model`, `max_tool_turns`, `engagement_timeout_s`.

- [ ] **Step 1: Write `atlas/config/atlas.yaml`**

```yaml
fast_model: claude-haiku-4-5
escalation_model: claude-sonnet-4-6
max_tool_turns: 5
engagement_timeout_s: 15
```

- [ ] **Step 2: Failing router test**

```python
# atlas/tests/test_router.py
import pytest
from worker.router import route

def test_everything_routes_fast_in_v0():
    assert route("what's in the queue?") == "fast"

def test_route_rejects_empty():
    with pytest.raises(ValueError):
        route("   ")
```

- [ ] **Step 3: Implement `router.py`** (V0-minimal: strip, raise `ValueError` if empty, return `"fast"`; module docstring notes reflex/work lanes arrive in V1). Run → PASS.
- [ ] **Step 4: Failing fastlane test with a FAKE client (no network, no key)**

```python
# atlas/tests/test_fastlane.py
from types import SimpleNamespace
from worker.fastlane import answer, TOOLS

def fake_client(scripted):
    calls = []
    def create(**kw):
        calls.append(kw)
        return scripted.pop(0)
    c = SimpleNamespace(messages=SimpleNamespace(create=create))
    c.calls = calls
    return c

def block(**kw):
    return SimpleNamespace(**kw)

def test_answer_runs_tool_loop(kb_fixture, monkeypatch):
    monkeypatch.setenv("ATLAS_KB_ROOT", str(kb_fixture))
    fake = fake_client([
        SimpleNamespace(stop_reason="tool_use",
                        content=[block(type="tool_use", name="queue_summary", input={}, id="tu_1")]),
        SimpleNamespace(stop_reason="end_turn",
                        content=[block(type="text", text="One card in inbox.")]),
    ])
    out = answer("what's queued?", client=fake, model="claude-haiku-4-5")
    assert out == "One card in inbox."
    assert any(t["name"] == "queue_summary" for t in fake.calls[0]["tools"])

def test_tool_names_cover_v0_surface():
    assert {t["name"] for t in TOOLS} == {
        "queue_summary", "read_dashboard", "read_state", "ledger_rollup", "running_work"}
```

- [ ] **Step 5: Run, verify FAIL.**
- [ ] **Step 6: Implement `fastlane.py`**

```python
# atlas/worker/fastlane.py
"""Fast conversational lane: Anthropic tool-use loop over kb read tools (in-process)."""
import json
from kbmcp import kb_tools

SYSTEM = ("You are Atlas, the spoken interface to Daniel's kb agentic OS. Answers are read "
          "aloud: lead with the point, one breath long by default; offer detail on request. "
          "Use tools to ground every factual claim about kb state.")

TOOLS = [
    {"name": "queue_summary", "description": "Task-card queue counts + cards, optionally one state (inbox/working/done/approvals).",
     "input_schema": {"type": "object", "properties": {"state": {"type": "string"}}, "required": []}},
    {"name": "read_dashboard", "description": "Read a dashboard markdown (default: executive).",
     "input_schema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": []}},
    {"name": "read_state", "description": "Read a project's STATE.md.",
     "input_schema": {"type": "object", "properties": {"project": {"type": "string"}}, "required": ["project"]}},
    {"name": "ledger_rollup", "description": "Today's cost (USD) and activity counts.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},
    {"name": "running_work", "description": "Cards currently in 'working'.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},
]

def _dispatch(name: str, args: dict) -> str:
    root = kb_tools.kb_root()
    fns = {"queue_summary": lambda: kb_tools.queue_summary(root, args.get("state")),
           "read_dashboard": lambda: kb_tools.read_dashboard(root, args.get("name", "executive")),
           "read_state": lambda: kb_tools.read_state(root, args["project"]),
           "ledger_rollup": lambda: kb_tools.ledger_rollup(root),
           "running_work": lambda: kb_tools.running_work(root)}
    try:
        out = fns[name]()
        return out if isinstance(out, str) else json.dumps(out)
    except FileNotFoundError as e:
        return f"ERROR: {e}"

def answer(question: str, client, model: str, max_turns: int = 5) -> str:
    messages = [{"role": "user", "content": question}]
    for _ in range(max_turns):
        msg = client.messages.create(model=model, max_tokens=1024, system=SYSTEM,
                                     tools=TOOLS, messages=messages)
        if msg.stop_reason != "tool_use":
            return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        messages.append({"role": "assistant", "content": msg.content})
        results = [{"type": "tool_result", "tool_use_id": b.id,
                    "content": _dispatch(b.name, b.input)}
                   for b in msg.content if getattr(b, "type", "") == "tool_use"]
        messages.append({"role": "user", "content": results})
    return "I hit my tool-call limit before finishing — try a narrower question."
```

- [ ] **Step 7: Run, verify PASS.**
- [ ] **Step 8: Write `repl.py`**

```python
# atlas/worker/repl.py
"""Typed-text debug REPL: the voice pipeline minus audio. Run (from atlas/):
   .venv\\Scripts\\python -m worker.repl     (needs ANTHROPIC_API_KEY in %USERPROFILE%\\.atlas\\env)"""
import os, sys
from pathlib import Path
import yaml

def load_env():
    envfile = Path.home() / ".atlas" / "env"
    if envfile.is_file():
        for line in envfile.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

def main() -> int:
    load_env()
    import anthropic
    from worker.router import route
    from worker import fastlane
    cfg = yaml.safe_load((Path(__file__).resolve().parents[1] / "config" / "atlas.yaml").read_text(encoding="utf-8"))
    client = anthropic.Anthropic()
    print("atlas repl — type a question, 'quit' to exit")
    while True:
        q = input("you> ").strip()
        if q.lower() in ("quit", "exit"):
            return 0
        if not q:
            continue
        assert route(q) == "fast"
        print("atlas>", fastlane.answer(q, client=client, model=cfg["fast_model"],
                                        max_turns=cfg["max_tool_turns"]))

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 9: HUMAN GATE — scoped key.** Requires Task 2 Step 7 ratification first. Daniel creates a spend-capped Anthropic API key and puts `ANTHROPIC_API_KEY=...` in `%USERPROFILE%\.atlas\env` (outside repo). Then live-smoke the REPL: ask "what's in the queue?" — expect a grounded, one-breath answer. Log the session's cost to the ops ledger via `ledger.append(<ops>, "cost", "atlas-worker", <record per ledger.py contract>)` (rebase/push).
- [ ] **Step 10: Commit** — `feat(atlas): three-lane router (fast-only V0) + tool-loop fast lane + debug REPL`
- [ ] **Step 11: Card lifecycle + grade.**

---

### Task 6: LiveKit worker + STT/TTS + pairing smoke

**Files:**
- Create: `atlas/worker/app.py`, `atlas/worker/pairing_smoke.py`
- Modify: `atlas/requirements.txt` (add voice deps)

**Interfaces:**
- Consumes: `fastlane.TOOLS` / `fastlane._dispatch` / `fastlane.SYSTEM` (wrapped as LiveKit `function_tool`s if needed), `config/atlas.yaml`, `repl.load_env()`.
- Produces: `app.py` runnable via LiveKit Agents console mode for a desk mic/speaker session; a recorded pairing-smoke verdict (native MCP attach vs function_tool fallback) in execution notes + `orgs/atlas/STATE.md`.

- [ ] **Step 1: HUMAN GATE — accounts.** Daniel creates: Deepgram account ($200 signup credit — covers BOTH Flux STT and Aura-2 TTS for years at our volume) and a scoped `atlas` API key on his EXISTING ElevenLabs paid subscription (TTS + Voices-read only; Cartesia scratched by Daniel 2026-07-20 — two candidates suffice). Keys land in `%USERPROFILE%\.atlas\env` as `DEEPGRAM_API_KEY / ELEVENLABS_API_KEY`. **No LiveKit account** (2026-07-20 amendment, Daniel-approved): V0–V2 run via livekit-agents **console mode**, which connects to no LiveKit server (docs-verified — credentials are only required for LiveKit Inference, which we don't use). LiveKit Cloud signup is deferred to V3 (phone/SIP). Desk caveat: console mode has no WebRTC echo cancellation — use headphones or an AEC mic.
- [ ] **Step 2: Add voice deps** to `requirements.txt`: `livekit-agents==1.6.6`, `livekit-plugins-deepgram`, `livekit-plugins-anthropic==1.6.5`, `livekit-plugins-elevenlabs`, `livekit-plugins-silero`, `openwakeword==0.6.0`. Install into `atlas/.venv`; expect success on Windows (wheels platform-agnostic per 07-19 research). (cartesia plugin dropped 2026-07-20 with the vendor.)
- [ ] **Step 3: MANDATORY docs pull** — context7 query for `livekit-agents` 1.6.6: `AgentSession` construction, STT/LLM/TTS plugin wiring (incl. Deepgram Aura TTS class in `livekit-plugins-deepgram`), `function_tool` decorator, MCP server attach, **console startup mode** (audio-device flags, no-server operation), interruption defaults. Adjust Steps 4–5 code to the shipped API (behavior contracts fixed).
- [ ] **Step 4: Write + run `pairing_smoke.py`** — the livekit/agents#2519 check, BEFORE building app.py. Spec (implement per pulled docs, ~60 lines): build a minimal `AgentSession` with `llm=` Anthropic plugin on `fast_model`, then (a) attach the kb-MCP server natively (stdio command `.venv\Scripts\python -m kbmcp.server`), send one text turn asking it to call `queue_summary`; (b) same session but with `fastlane._dispatch` wrapped as LiveKit `function_tool`s instead. PASS per path = a tool call executes and a text reply returns without exception. Print verdict lines `native-mcp: PASS|FAIL <err>` / `function-tool: PASS|FAIL <err>`. **Decision rule:** native-mcp PASS → use it; FAIL (#2519) → use function_tool wrapping and record the bug id + retest condition in `orgs/atlas/STATE.md`.
- [ ] **Step 5: Write `app.py`** — LiveKit Agents worker: Deepgram **Flux** STT (keyterms seeded at startup from `orgs/*` dir names + `skills/*/*/` names, per spec §12 mitigation — verify Flux keyterm support in the docs pull; unsupported → note-and-skip), Anthropic LLM (`fast_model`, system prompt = `fastlane.SYSTEM`), **Deepgram Aura-2 TTS default voice** (presumed production default — rides the $200 credit; ElevenLabs is the Task-8 bake-off challenger), tools per Step 4's verdict, barge-in at framework default (adaptive interruption). **Console mode is the run mode** (no LiveKit server, per Step 1 amendment) — it is the desk entrypoint, not just a test convenience. `load_env()` before session start.
- [ ] **Step 6: Manual desk smoke (console mode):** speak "what's in the queue?" (no wake word yet) → spoken grounded answer. Note rough latency feel; hard numbers come in Task 8.
- [ ] **Step 7: Commit** — `feat(atlas): LiveKit voice worker (Flux/Claude/Aura-2) + 2519 pairing smoke`
- [ ] **Step 8: Card lifecycle + grade.**

---

### Task 7: Wake-word gating + engagement window (TDD on the state machine)

**Files:**
- Create: `atlas/worker/engagement.py`, `atlas/worker/wakeword.py`
- Modify: `atlas/worker/app.py` (gate the STT stream), `atlas/config/atlas.yaml` (add `wake_model`)
- Test: `atlas/tests/test_engagement.py`

**Interfaces:**
- Consumes: `config/atlas.yaml::engagement_timeout_s`.
- Produces: `engagement.Engagement(timeout_s, clock=time.monotonic)` with `.wake()`, `.heard_speech()`, `.dismiss()`, `.tick() -> str`, `.state -> "ASLEEP"|"ENGAGED"`; `wakeword.listen(on_wake)` mic loop using the **pretrained "hey jarvis" model for V0** (`wake_model: hey_jarvis` in atlas.yaml; custom "Atlas" model is a Daniel Colab gate, config swap on delivery).

- [ ] **Step 1: Failing state-machine tests**

```python
# atlas/tests/test_engagement.py
from worker.engagement import Engagement

def test_wake_engages_and_silence_timeout_sleeps():
    t = [0.0]
    e = Engagement(timeout_s=15, clock=lambda: t[0])
    assert e.state == "ASLEEP"
    e.wake();            assert e.state == "ENGAGED"
    t[0] = 10; e.heard_speech()               # speech resets the silence clock
    t[0] = 24; assert e.tick() == "ENGAGED"   # only 14s of silence
    t[0] = 26; assert e.tick() == "ASLEEP"    # 16s of silence -> timeout

def test_dismiss_is_immediate():
    e = Engagement(timeout_s=15, clock=lambda: 0.0)
    e.wake(); e.dismiss()
    assert e.state == "ASLEEP"

def test_tick_while_asleep_stays_asleep():
    e = Engagement(timeout_s=15, clock=lambda: 99.0)
    assert e.tick() == "ASLEEP"
```

- [ ] **Step 2: Run FAIL → implement `engagement.py`** — a ~30-line class exactly matching the contract: `wake()` → ENGAGED + stamp `clock()`; `heard_speech()` re-stamps; `tick()` → ASLEEP when `clock() - last_activity > timeout_s` (no-op when asleep); `dismiss()` immediate ASLEEP. Run → PASS.
- [ ] **Step 3: Implement `wakeword.py`** per openwakeword 0.6.0 docs: mic frames (16 kHz) → `openwakeword.Model(wakeword_models=[cfg["wake_model"]])`, score threshold 0.5, call `on_wake()` on trigger. Wire the gate in `app.py`: wakeword loop always running; the Deepgram STT stream opens on wake and closes on sleep/dismiss (audio leaves the PC ONLY while ENGAGED — spec §2 Listening decision); transcript handler recognizes "that's all" → `dismiss()`; every final transcript event calls `heard_speech()`.
- [ ] **Step 4: Manual desk test:** wake word → ask → answer; 15 s silence → stream closes; "that's all" → immediate close. Verify with Deepgram dashboard that no audio minutes accrue while ASLEEP.
- [ ] **Step 5: Commit** — `feat(atlas): gated listening — wake word + engagement window state machine`
- [ ] **Step 6: Card lifecycle + grade. HUMAN GATE (queued, non-blocking):** offer Daniel the Colab run to train the custom "Atlas" wake model (~75–90 min); config swap on delivery.

---

### Task 8: Latency harness + persona bake-off + V0 checkpoint

**Files:**
- Create: `atlas/worker/latency_harness.py`, `atlas/worker/persona_samples.py`
- Create (ops worktree): `orgs/atlas/output/v0-latency-report.md` (DRAFT), `orgs/atlas/output/persona-samples/*.wav` (DRAFT)

**Interfaces:**
- Consumes: everything prior; `%USERPROFILE%\.atlas\env` keys.
- Produces: per-stage latency numbers (utterance-end→Flux EOT; EOT→first Claude token; first token→first TTS audio; end-to-end voice-to-voice) over 10 scripted turns, mean/median/p95; sample wavs: 3 fixed lines (a status report, a completion callback, an approval readback — spec §10) × 5 candidate voices (3 Cartesia + 2 ElevenLabs).

- [ ] **Step 1: Implement `latency_harness.py`** — **API-only** (Daniel decided 2026-07-20: no warm-SDK-session comparison) — drives 10 scripted questions through the live pipeline (console session or direct plugin calls, per what Task 6 shipped), stamping the four timestamps above per turn (exact event hook names from Task 6's docs pull; the four-timestamp contract is fixed). Writes a markdown table (mean/median/p95 per stage + per-turn appendix) to `orgs/atlas/output/v0-latency-report.md`, first line `DRAFT — per orgs/atlas/contract.md`.
- [ ] **Step 2: Run it; commit the report to ops** (rebase → add → `atlas: V0 latency report (DRAFT)` → push).
- [ ] **Step 3: Implement + run `persona_samples.py`** — voice-id candidate list in `atlas/config/atlas.yaml` (`persona_candidates:` — **2-way bake-off** (2026-07-20 amendments; Cartesia scratched by Daniel): 3 Deepgram Aura-2 + 3 ElevenLabs stock voices spanning butler / chief-of-staff / casual registers); synthesize the 3 fixed lines per voice to `orgs/atlas/output/persona-samples/<vendor>-<voice>-<line>.wav`; commit to ops as DRAFT. Aura-2 is the presumed production winner (~$0/mo on the Deepgram credit) unless out-eared; an ElevenLabs pick draws on Daniel's existing paid subscription quota (shared with faceless-youtube — surface that at the decision).
- [ ] **Step 4: HUMAN GATE — V0 checkpoint (ONE package, per Daniel's gating preference):** live desk demo (Daniel asks Atlas about kb state), latency report vs the spec bar (conversational 500–800 ms voice-to-voice; **miss = stop-and-reassess, not plow-ahead**), persona pick by ear (voice id + register → `atlas.yaml` + `atlas/config/persona.md` stub), TTS vendor decision, custom-wake-word go/no-go.
- [ ] **Step 5: Wave close:** fleet suite green (`py -3.13 -m pytest tests/`) AND atlas suite green; consistency sweep — grep the branch for leaked keys (`sk-ant`, `API_KEY=` outside `.atlas` references), dead `atlas-prep` references, unresolved spec cross-refs, files >~300 lines that should split; memory append to `memory/claude-boss.md` on ops; **PR `claude/atlas` → main** for Daniel's merge; V1 go/no-go.

---

## Execution notes

- Task 2 (2026-07-19): orgs/atlas registered via new_project.py standard scaffold (kept HEARTBEAT.md + raw/wiki/output — consistency over 3-file minimalism); atlas-prep retired; ops commit 80024d9.
- Card ids (workflow atlas-v0): Task 3 = 6a5c8ad2-812b97e7, Task 4 = 6a5c8ad2-98115d61, Task 5 = 6a5c8ad2-1d991c23, Task 6 = 6a5c8ad2-df7abf53, Task 7 = 6a5c8ad2-a1613d5a, Task 8 = 6a5c8ad2-984e5ccf.
- Task 1 done pre-cards (sweep is infrastructure for the wave itself); commits 12c0b10.
- 2026-07-20 (later): Daniel scratched Cartesia entirely — he holds an existing ElevenLabs PAID subscription (also used by faceless-youtube; atlas gets its own scoped key, TTS+Voices-read, so it's independently revocable). Bake-off = Aura-2 vs ElevenLabs only; gate 4 = DEEPGRAM_API_KEY + ELEVENLABS_API_KEY. livekit-plugins-cartesia removed from requirements.txt (left installed in the venv, harmless).
- 2026-07-20 cost-research amendments (3 Opus 4.8 research agents, model-verified; Daniel approved): (1) STT stays Deepgram Flux — $200 credit ≈ 7 yrs at our volume, best-in-class native EOT; **AssemblyAI Universal-Streaming ($0.0025/min, first-party plugin) recorded as post-credit successor**. (2) TTS bake-off becomes 3-way with Deepgram Aura-2 as presumed default (rides same credit; conversational naturalness rated above ElevenLabs); **Kokoro-82M via Kokoro-FastAPI recorded as $0 local fallback, GPU-gated** (CPU TTFA ~1.8s blows the latency bar). (3) LiveKit account dropped from gate 4 — console mode runs serverless (docs-verified); deferred to V3. (4) Fast lane unchanged — Haiku 4.5 ≈ $10/mo realistic at 30 q/day, $20 cap right-sized; prompt caching inapplicable (stable prefix < 4,096-tok Haiku cache minimum); Task 8 harness API-only per Daniel.
