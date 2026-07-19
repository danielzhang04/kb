from kbmcp.kb_tools import queue_summary

def test_queue_summary_counts_and_cards(kb_fixture):
    s = queue_summary(kb_fixture)
    assert s["counts"]["inbox"] == 1 and s["counts"]["working"] == 1
    assert any(c["action"] == "do a thing" and c["state"] == "inbox" for c in s["cards"])

def test_queue_summary_filters_state(kb_fixture):
    s = queue_summary(kb_fixture, state="working")
    assert set(s["counts"]) == {"working"} and len(s["cards"]) == 1
