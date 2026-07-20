from kbmcp.kb_tools import queue_summary, read_dashboard, read_state, ledger_rollup, running_work
import pytest

def test_queue_summary_counts_and_cards(kb_fixture):
    s = queue_summary(kb_fixture)
    assert s["counts"]["inbox"] == 1 and s["counts"]["working"] == 1
    assert any(c["action"] == "do a thing" and c["state"] == "inbox" for c in s["cards"])

def test_queue_summary_filters_state(kb_fixture):
    s = queue_summary(kb_fixture, state="working")
    assert set(s["counts"]) == {"working"} and len(s["cards"]) == 1

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
