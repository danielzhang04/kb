"""Voice tools (Task 9, design §6): file_card / launch_workflow / credit_remaining.

`file_card` (and its named-workflow twin `launch_workflow`) writes a card into `queue/inbox/`
on the ops worktree under the constitution's pull-rebase-before-write + rejected-push-retry
discipline — the SAME injected git-runner seam Task 6 proved (throwaway repo + local bare
'origin', no network). `credit_remaining` calls Deepgram's balances management API through an
injected `http_get`; the real callable reads `DEEPGRAM_API_KEY` from env INSIDE the function and
it never appears in a parameter or the return value (the scoped-key carve-out — provably leak-free).

Registry discipline: `file_card`/`launch_workflow` both require `confirmed: true`; `dispatch`
rejects an unconfirmed call with an exact speakable ERROR and writes NOTHING.
"""
import json
import subprocess

import pytest

from kbmcp import kb_tools
from worker import toolreg
from worker.state import StatePublisher

ID = ["-c", "user.name=seed", "-c", "user.email=seed@agents.local"]
CONFIRMED_ERROR = "ERROR: not confirmed — read the card back and get a yes."


# --- git bare-origin fixture (mirrors test_ledgerwriter) -------------------------------------
def _git(args, cwd, check=True):
    r = subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True)
    if check and r.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed in {cwd}:\n{r.stdout}\n{r.stderr}")
    return r


def _real_runner(args, cwd):
    """Production seam shape: fn(args, cwd) -> CompletedProcess (never check=True)."""
    return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True)


def _seed_origin(tmp_path):
    origin = tmp_path / "origin.git"
    _git(["init", "--bare", "-b", "ops", str(origin)], tmp_path)
    seed = tmp_path / "seed"
    _git(["clone", str(origin), str(seed)], tmp_path)
    _git(["checkout", "-b", "ops"], seed, check=False)
    (seed / "README.md").write_text("kb ops\n", encoding="utf-8")
    _git(["add", "README.md"], seed)
    _git([*ID, "commit", "-m", "seed ops"], seed)
    _git(["push", "-u", "origin", "ops"], seed)
    return origin


def _clone(origin, dest):
    _git(["clone", str(origin), str(dest)], dest.parent)
    _git(["checkout", "ops"], dest, check=False)
    return dest


def _origin_file(origin, relpath):
    r = subprocess.run(["git", "--git-dir", str(origin), "show", f"ops:{relpath}"],
                       capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def _ops_commit_count(origin):
    r = subprocess.run(["git", "--git-dir", str(origin), "rev-list", "--count", "ops"],
                       capture_output=True, text=True)
    return int(r.stdout.strip())


@pytest.fixture
def ops_work(tmp_path):
    """A throwaway ops worktree (clone on `ops`) with a bare origin; returns (origin, work)."""
    origin = _seed_origin(tmp_path)
    work = _clone(origin, tmp_path / "work")
    return origin, work


@pytest.fixture(autouse=True)
def _reset_hook():
    """The post-file hook is module-global; keep tests independent."""
    toolreg.set_post_file_hook(None)
    yield
    toolreg.set_post_file_hook(None)


# --- kb_tools.file_card (pure, git seam injected) --------------------------------------------
def test_file_card_lands_parseable_card_in_inbox_and_pushes(ops_work):
    origin, work = ops_work
    import cards

    out = kb_tools.file_card(str(work), "atlas", "check the faceless renderer", "orgs/faceless-youtube/",
                             "T2", body="voice-filed\n", git_runner=_real_runner)

    assert set(out.keys()) == {"id", "path"}
    rel = f"queue/inbox/{out['id']}.md"
    content = _origin_file(origin, rel)
    assert content is not None, "card must be pushed to origin ops"
    card = cards.parse_text(content)
    assert card.meta["project"] == "atlas"
    assert card.meta["action"] == "check the faceless renderer"
    assert card.meta["target"] == "orgs/faceless-youtube/"
    assert card.meta["risk-tier"] == "T2"
    assert card.meta["state"] == "inbox"
    assert card.meta["owner"] is None          # Atlas never self-assigns
    assert card.meta["workflow"] == "atlas-voice"


def test_file_card_commit_message_and_identity(ops_work):
    origin, work = ops_work
    out = kb_tools.file_card(str(work), "atlas", "a thing", "wiki/", "T1", git_runner=_real_runner)

    msg = _git(["log", "-1", "--pretty=%s", "ops"], work).stdout.strip()
    assert msg == f"atlas: voice-filed card {out['id']} [atlas-voice]"
    author = _git(["log", "-1", "--pretty=%an <%ae>", "ops"], work).stdout.strip()
    assert author == "atlas-worker <atlas-worker@agents.local>"


def test_file_card_named_workflow_stamps(ops_work):
    origin, work = ops_work
    import cards

    out = kb_tools.file_card(str(work), "atlas", "run the pipeline", "orgs/faceless-youtube/",
                             "T2", workflow="faceless-run", git_runner=_real_runner)

    card = cards.parse_text(_origin_file(origin, f"queue/inbox/{out['id']}.md"))
    assert card.meta["workflow"] == "faceless-run"


def test_file_card_invalid_risk_tier_raises_valueerror_and_writes_nothing(ops_work):
    origin, work = ops_work
    before = _ops_commit_count(origin)

    with pytest.raises(ValueError):
        kb_tools.file_card(str(work), "atlas", "bad", "wiki/", "T9", git_runner=_real_runner)

    assert _ops_commit_count(origin) == before, "an invalid card must not push a commit"
    assert not list((work / "queue" / "inbox").glob("*.md")) if (work / "queue" / "inbox").exists() else True


# --- registry / dispatch ---------------------------------------------------------------------
def test_registry_covers_exactly_9_names():
    expected = {"queue_summary", "read_dashboard", "read_state", "ledger_rollup", "running_work",
                "file_card", "launch_workflow", "credit_remaining", "go_to_sleep"}
    assert {s.name for s in toolreg.REGISTRY} == expected
    assert len(toolreg.REGISTRY) == 9


def test_file_card_and_launch_workflow_schemas_require_confirmed():
    by_name = {s.name: s for s in toolreg.REGISTRY}
    for name in ("file_card", "launch_workflow"):
        schema = by_name[name].input_schema
        assert schema["properties"]["confirmed"]["type"] == "boolean"
        assert "confirmed" in schema["required"]
        # description mandates the spoken read-back before confirming
        assert "read back" in by_name[name].description.lower()
    # launch_workflow additionally requires a named workflow
    assert "workflow" in by_name["launch_workflow"].input_schema["required"]


def test_dispatch_unconfirmed_returns_exact_error_and_writes_nothing(ops_work, monkeypatch):
    origin, work = ops_work
    monkeypatch.setenv("ATLAS_OPS_ROOT", str(work))
    before = _ops_commit_count(origin)

    out = toolreg.dispatch("file_card", {"project": "atlas", "action": "x", "target": "wiki/",
                                         "risk_tier": "T2", "confirmed": False})

    assert out == CONFIRMED_ERROR
    assert _ops_commit_count(origin) == before, "unconfirmed dispatch must write nothing"
    inbox = work / "queue" / "inbox"
    assert not (inbox.exists() and list(inbox.glob("*.md")))


def test_dispatch_missing_confirmed_is_rejected(ops_work, monkeypatch):
    origin, work = ops_work
    monkeypatch.setenv("ATLAS_OPS_ROOT", str(work))
    out = toolreg.dispatch("file_card", {"project": "atlas", "action": "x", "target": "wiki/",
                                         "risk_tier": "T2"})
    assert out == CONFIRMED_ERROR


def test_dispatch_confirmed_files_card_and_fires_hook(ops_work, monkeypatch):
    origin, work = ops_work
    monkeypatch.setenv("ATLAS_OPS_ROOT", str(work))
    fired = []
    toolreg.set_post_file_hook(fired.append)

    out = toolreg.dispatch("file_card", {"project": "atlas", "action": "ship it", "target": "wiki/",
                                         "risk_tier": "T2", "confirmed": True})

    result = json.loads(out)
    assert set(result.keys()) == {"id", "path"}
    assert _origin_file(origin, f"queue/inbox/{result['id']}.md") is not None
    assert len(fired) == 1
    assert fired[0]["id"] == result["id"]
    assert fired[0]["action"] == "ship it"


def test_dispatch_launch_workflow_sets_named_workflow(ops_work, monkeypatch):
    origin, work = ops_work
    monkeypatch.setenv("ATLAS_OPS_ROOT", str(work))
    import cards

    out = toolreg.dispatch("launch_workflow", {"workflow": "faceless-run", "project": "atlas",
                                               "action": "make a video", "target": "orgs/faceless-youtube/",
                                               "risk_tier": "T2", "confirmed": True})
    result = json.loads(out)
    card = cards.parse_text(_origin_file(origin, f"queue/inbox/{result['id']}.md"))
    assert card.meta["workflow"] == "faceless-run"


def test_dispatch_invalid_risk_tier_is_speakable_error(ops_work, monkeypatch):
    origin, work = ops_work
    monkeypatch.setenv("ATLAS_OPS_ROOT", str(work))
    out = toolreg.dispatch("file_card", {"project": "atlas", "action": "x", "target": "wiki/",
                                         "risk_tier": "T9", "confirmed": True})
    assert out.startswith("ERROR: ")
    assert "risk" in out.lower()


# --- credit_remaining (Deepgram balances; key read inside, never leaked) ---------------------
PROJECTS_PAYLOAD = {"projects": [{"project_id": "proj_abc123", "name": "Atlas"}]}
BALANCES_PAYLOAD = {"balances": [
    {"balance_id": "b1", "amount": 42.5, "units": "USD", "purchase_order_id": "PO-1"},
]}


def _fake_http_get(captured):
    """A canned Deepgram management API: /v1/projects then /projects/<id>/balances. Records
    every (url, headers) it is called with so the test can prove the key was passed as transport."""
    def get(url, headers):
        captured.append((url, headers))
        if url.endswith("/v1/projects"):
            return PROJECTS_PAYLOAD
        if url.endswith("/balances"):
            assert "proj_abc123" in url  # used the project id from the first call
            return BALANCES_PAYLOAD
        raise AssertionError(f"unexpected url {url}")
    return get


def test_credit_remaining_parses_balances(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-real-key")
    out = kb_tools.credit_remaining(http_get=_fake_http_get([]))
    assert out["units"] == "USD"
    assert out["balance"] == 42.5


def test_credit_remaining_reads_key_inside_and_never_leaks_it(monkeypatch):
    poison = "POISON-DEEPGRAM-KEY-DO-NOT-LEAK"
    monkeypatch.setenv("DEEPGRAM_API_KEY", poison)
    captured = []

    out = kb_tools.credit_remaining(http_get=_fake_http_get(captured))

    # the key is read INSIDE and used only as the Authorization transport header...
    assert captured, "http_get must have been called"
    assert any(poison in h.get("Authorization", "") for _, h in captured), \
        "the key must reach the API as the Authorization header"
    # ...but never appears in the return value.
    assert poison not in json.dumps(out)


def test_credit_remaining_via_dispatch(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-real-key")
    # dispatch uses the real default http_get, so monkeypatch kb_tools to inject the fake.
    monkeypatch.setattr(kb_tools, "credit_remaining", lambda: {"balance": 42.5, "units": "USD"})
    out = toolreg.dispatch("credit_remaining", {})
    assert json.loads(out) == {"balance": 42.5, "units": "USD"}


# --- state snapshot: filed_cards -------------------------------------------------------------
def _dt():
    from datetime import datetime, timezone
    return datetime(2026, 7, 20, 12, 0, 0, tzinfo=timezone.utc)


def test_snapshot_round_trips_filed_cards():
    p = StatePublisher(clock=_dt)
    assert p.snapshot()["filed_cards"] == []
    p.add_filed_card("card-1", "check the renderer")
    snap = p.snapshot()
    assert snap["filed_cards"] == [{"id": "card-1", "action": "check the renderer", "state": "inbox"}]


def test_update_filed_card_changes_state():
    p = StatePublisher(clock=_dt)
    p.add_filed_card("card-1", "do x")
    p.update_filed_card("card-1", "done")
    assert p.snapshot()["filed_cards"][0]["state"] == "done"


def test_filed_card_events_emitted():
    p = StatePublisher(clock=_dt)
    events = []
    p.subscribe(events.append)
    p.add_filed_card("card-1", "do x")
    p.update_filed_card("card-1", "working")
    filed = [e for e in events if e[0] == "filed_card"]
    assert len(filed) == 2
    assert filed[0][1] == {"id": "card-1", "action": "do x", "state": "inbox"}
    assert filed[1][1]["state"] == "working"
