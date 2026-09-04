"""Functional test for scripts/queue_bridge_select.py — the dashboard-engine bridge selector.

Proves the selector is the EXACT inverse (on the execution-controller axis) of
agent_runner.ps1's scan: it claims a card iff execution-controller == "dashboard"
AND state in (inbox, working), without pre-filtering the later server-owned runnable
resolution by card owner. Absent-controller cards are excluded from the bridge.
"""
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
import cards  # noqa: E402
import queue_bridge_select as qbs  # noqa: E402

SUBJECT = "dashboard-engine"


def _card(queue_root: Path, *, state: str, owner, controller, **extra) -> str:
    """Create + save one card, returning its id. controller=None omits the field entirely."""
    meta_extra = {"owner": owner, "state": state}
    if controller is not None:
        meta_extra["execution-controller"] = controller
    meta_extra.update(extra)
    card = cards.new_card("kb-ops", "docs.update", "orgs/kb-ops/out.md", "T1", body="body", **meta_extra)
    cards.save(card, queue_root)
    return card.meta["id"]


# --- the execution-controller x state matrix --------------------------------------------

def test_claims_every_dashboard_controlled_inbox_and_working_card_without_a_subject(tmp_path):
    q = tmp_path / "queue"
    claimed_inbox = _card(q, state="inbox", owner=SUBJECT, controller="dashboard")
    claimed_working = _card(q, state="working", owner=SUBJECT, controller="dashboard")
    # Everything below must be EXCLUDED:
    _card(q, state="inbox", owner=SUBJECT, controller=None)            # absent controller -> legacy runner
    _card(q, state="inbox", owner=SUBJECT, controller="codex")         # other controller value
    claimed_agent_owner = _card(q, state="inbox", owner="grader", controller="dashboard")
    _card(q, state="blocked", owner=SUBJECT, controller="dashboard")   # non-claimable state (sits in inbox/)
    _card(q, state="done", owner=SUBJECT, controller="dashboard")      # terminal state

    got = qbs.select_owned_dashboard_cards(q)
    ids = sorted(row["id"] for row in got)
    assert ids == sorted([claimed_inbox, claimed_working, claimed_agent_owner])
    # Each row carries id/path/state and the state is one of the claimable states.
    for row in got:
        assert set(row) == {"id", "path", "state"}
        assert row["state"] in ("inbox", "working")


def test_engine_owned_stage_cards_are_not_claimed_by_the_bridge(tmp_path):
    """W58: a managed workflow stage card carries `workflow: <runRef>` AND the dashboard controller.

    The workflow engine drives it (managed-root activation -> attempt -> canonical result). The bridge
    claiming it between hops is a second launch path, and — because a stage `owner` is a placement worker
    id, not a declared agent — it refused `runnable-owner-required` and filed a wake-me every poll tick.
    Mirrors `bridgeClaimsCard`'s carve-out in dashboard/server/control/queueBridge.ts.
    """
    q = tmp_path / "queue"
    trigger = _card(q, state="inbox", owner="grader", controller="dashboard")
    for state in ("inbox", "working"):
        _card(q, state=state, owner="worker-desktop", controller="dashboard",
              workflow="run-d71ccd8b-a3ec-4fdc-9bac-99f541ce898a")
    assert [row["id"] for row in qbs.select_owned_dashboard_cards(q)] == [trigger]
    assert qbs.claims_card({
        "execution-controller": "dashboard", "state": "inbox",
        "workflow": "run-d71ccd8b-a3ec-4fdc-9bac-99f541ce898a",
    }) is False
    # An explicit null / absent workflow is a trigger card and stays claimable.
    assert qbs.claims_card({"execution-controller": "dashboard", "state": "inbox", "workflow": None}) is True
    assert qbs.claims_card({"execution-controller": "dashboard", "state": "inbox"}) is True


def test_absent_controller_belongs_to_the_legacy_runner_not_the_bridge(tmp_path):
    q = tmp_path / "queue"
    _card(q, state="inbox", owner=SUBJECT, controller=None)
    assert qbs.select_owned_dashboard_cards(q) == []


def test_predicate_partitions_with_no_overlap_or_gap(tmp_path):
    # For an owner/state-matched card, exactly one of {bridge, legacy} claims it, for every
    # controller value — this is the guarantee the double-execution guard rests on.
    def legacy_claims(meta, agent):  # mirror of agent_runner.ps1 step 6
        return (meta.get("execution-controller") != "dashboard"
                and meta.get("owner") == agent
                and meta.get("state") in ("inbox", "working"))

    for controller in ("dashboard", "codex", None, "", "DASHBOARD"):
        meta = {"execution-controller": controller, "owner": SUBJECT, "state": "inbox"}
        bridge = qbs.claims_card(meta)
        legacy = legacy_claims(meta, SUBJECT)
        assert bridge != legacy, f"overlap/gap for controller={controller!r}: bridge={bridge} legacy={legacy}"
    # only the exact literal 'dashboard' goes to the bridge
    assert qbs.claims_card({"execution-controller": "dashboard", "owner": SUBJECT, "state": "inbox"})
    assert not qbs.claims_card({"execution-controller": "DASHBOARD", "owner": SUBJECT, "state": "inbox"})


def test_empty_or_missing_queue_is_empty(tmp_path):
    assert qbs.select_owned_dashboard_cards(tmp_path / "nope") == []
    (tmp_path / "queue").mkdir()
    assert qbs.select_owned_dashboard_cards(tmp_path / "queue") == []


def test_main_requires_no_subject_and_emits_json(tmp_path, capsys):
    q = tmp_path / "queue"
    cid = _card(q, state="working", owner=SUBJECT, controller="dashboard")
    rc = qbs.main(["prog", json.dumps({"queueRoot": str(q)})])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert [row["id"] for row in out] == [cid]
    assert qbs.main(["prog", json.dumps({"subject": SUBJECT, "queueRoot": str(q)})]) == 0


def test_wake_operation_calls_the_shared_agent_runner_helper(tmp_path, monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(
        qbs.agent_runner,
        "wake_me",
        lambda repo, reason, detail: calls.append((repo, reason, detail)) or "wake-1",
    )
    rc = qbs.main(["prog", json.dumps({
        "operation": "wake",
        "repoRoot": str(tmp_path),
        "reason": "runnable-owner-required",
        "detail": "card c1 has no declared owner",
    })])
    assert rc == 0
    assert calls == [(tmp_path, "runnable-owner-required", "card c1 has no declared owner")]
    # No file on disk for a stubbed helper -> no path, and nothing for the caller to commit.
    assert json.loads(capsys.readouterr().out) == {
        "cardId": "wake-1", "path": None, "created": False,
    }


# --- W58: the wake op must tell its caller a NEW file exists, so it can be committed + bundled ---------

def test_wake_operation_reports_the_created_card_path_for_the_coordination_commit(tmp_path, capsys):
    rc = qbs.main(["prog", json.dumps({
        "operation": "wake",
        "repoRoot": str(tmp_path),
        "reason": "runnable-owner-required",
        "detail": "queue bridge card wf-488ddbaf9c0b4154102575de refused before proposal creation",
    })])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["created"] is True
    assert out["path"] == "queue/inbox/" + out["cardId"] + ".md"
    assert (tmp_path / out["path"]).is_file()


def test_wake_operation_reports_created_false_on_a_dedupe_hit(tmp_path, capsys):
    op = json.dumps({
        "operation": "wake",
        "repoRoot": str(tmp_path),
        "reason": "runnable-owner-required",
        "detail": "first refusal",
    })
    assert qbs.main(["prog", op]) == 0
    first = json.loads(capsys.readouterr().out)
    assert qbs.main(["prog", op]) == 0
    second = json.loads(capsys.readouterr().out)
    assert second["cardId"] == first["cardId"]
    assert second["path"] == first["path"]
    # The second call wrote nothing; a caller that committed again would commit an unchanged tree.
    assert second["created"] is False
    assert len(list((tmp_path / "queue").glob("*/*.md"))) == 1


def test_shared_wake_helper_deduplicates_by_target(tmp_path):
    first = qbs.agent_runner.wake_me(
        tmp_path, "runnable-owner-required", "first unresolved card"
    )
    second = qbs.agent_runner.wake_me(
        tmp_path, "runnable-owner-required", "second unresolved card"
    )
    assert first is not None
    assert second == first
    paths = list((tmp_path / "queue").glob("*/*.md"))
    assert len(paths) == 1
    card = cards.parse(paths[0])
    assert card.meta["action"] == "wake-me"
    assert card.meta["target"] == "runnable-owner-required"
    assert "first unresolved card" in card.body
    assert "second unresolved card" not in card.body
