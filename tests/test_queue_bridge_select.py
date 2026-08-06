"""Functional test for scripts/queue_bridge_select.py — the dashboard-engine bridge selector.

Proves the selector is the EXACT inverse (on the execution-controller axis) of
agent_runner.py's ``owned_cards()`` owner scan: it claims a card iff execution-controller == "dashboard"
AND owner == subject AND state in (inbox, working). Absent-controller cards — which the
legacy runner owns — are excluded, and vice versa, so the two predicates partition the
card space with no overlap and no gap (the double-execution guard).
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


# --- the owner x execution-controller x state matrix -----------------------------------

def test_claims_only_dashboard_owned_inbox_and_working_cards(tmp_path):
    q = tmp_path / "queue"
    claimed_inbox = _card(q, state="inbox", owner=SUBJECT, controller="dashboard")
    claimed_working = _card(q, state="working", owner=SUBJECT, controller="dashboard")
    # Everything below must be EXCLUDED:
    _card(q, state="inbox", owner=SUBJECT, controller=None)            # absent controller -> legacy runner
    _card(q, state="inbox", owner=SUBJECT, controller="codex")         # other controller value
    _card(q, state="inbox", owner="claude-boss", controller="dashboard")  # wrong owner
    _card(q, state="blocked", owner=SUBJECT, controller="dashboard")   # non-claimable state (sits in inbox/)
    _card(q, state="done", owner=SUBJECT, controller="dashboard")      # terminal state

    got = qbs.select_owned_dashboard_cards(q, SUBJECT)
    ids = sorted(row["id"] for row in got)
    assert ids == sorted([claimed_inbox, claimed_working])
    # Each row carries id/path/state and the state is one of the claimable states.
    for row in got:
        assert set(row) == {"id", "path", "state"}
        assert row["state"] in ("inbox", "working")


def test_absent_controller_belongs_to_the_legacy_runner_not_the_bridge(tmp_path):
    q = tmp_path / "queue"
    _card(q, state="inbox", owner=SUBJECT, controller=None)
    assert qbs.select_owned_dashboard_cards(q, SUBJECT) == []


def test_predicate_partitions_with_no_overlap_or_gap(tmp_path):
    # For an owner/state-matched card, exactly one of {bridge, legacy} claims it, for every
    # controller value — this is the guarantee the double-execution guard rests on.
    def legacy_claims(meta, agent):  # compatibility mirror of agent_runner.py's owned_cards()
        return (meta.get("execution-controller") != "dashboard"
                and meta.get("owner") == agent
                and meta.get("state") in ("inbox", "working"))

    for controller in ("dashboard", "codex", None, "", "DASHBOARD"):
        meta = {"execution-controller": controller, "owner": SUBJECT, "state": "inbox"}
        bridge = qbs.claims_card(meta, SUBJECT)
        legacy = legacy_claims(meta, SUBJECT)
        assert bridge != legacy, f"overlap/gap for controller={controller!r}: bridge={bridge} legacy={legacy}"
    # only the exact literal 'dashboard' goes to the bridge
    assert qbs.claims_card({"execution-controller": "dashboard", "owner": SUBJECT, "state": "inbox"}, SUBJECT)
    assert not qbs.claims_card({"execution-controller": "DASHBOARD", "owner": SUBJECT, "state": "inbox"}, SUBJECT)


def test_empty_or_missing_queue_is_empty(tmp_path):
    assert qbs.select_owned_dashboard_cards(tmp_path / "nope", SUBJECT) == []
    (tmp_path / "queue").mkdir()
    assert qbs.select_owned_dashboard_cards(tmp_path / "queue", SUBJECT) == []


def test_main_requires_a_subject_and_emits_json(tmp_path, capsys):
    q = tmp_path / "queue"
    cid = _card(q, state="working", owner=SUBJECT, controller="dashboard")
    rc = qbs.main(["prog", json.dumps({"subject": SUBJECT, "queueRoot": str(q)})])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert [row["id"] for row in out] == [cid]
    with pytest.raises(ValueError):
        qbs.main(["prog", json.dumps({"queueRoot": str(q)})])  # no subject
