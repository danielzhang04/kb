import pytest
import cards


def test_new_card_has_required_meta():
    c = cards.new_card("faceless-youtube", "regenerate dashboards", "dashboards/", "T1")
    for key in ("id", "project", "action", "target", "risk-tier", "state"):
        assert key in c.meta
    assert c.meta["state"] == "inbox"
    assert c.meta["owner"] is None


def test_save_and_parse_roundtrip(tmp_path):
    c = cards.new_card("p", "do thing", "wiki/x.md", "T2", body="## Work order\nDo the thing.\n")
    p = cards.save(c, tmp_path)
    assert p.parent.name == "inbox"
    c2 = cards.parse(p)
    assert c2.meta["id"] == c.meta["id"]
    assert "Do the thing." in c2.body


def test_invalid_risk_tier_rejected():
    with pytest.raises(cards.ValidationError):
        cards.new_card("p", "a", "t", "T4")  # T4 is never carded


def test_claim_sets_owner_and_token():
    c = cards.new_card("p", "a", "t", "T1")
    cards.claim(c, "dispatcher-cloud")
    assert c.meta["owner"] == "dispatcher-cloud"
    assert len(c.meta["claim-token"]) >= 8


def test_transition_moves_file_and_validates(tmp_path):
    c = cards.new_card("p", "a", "t", "T1")
    cards.save(c, tmp_path)
    cards.claim(c, "agent-x")
    p2 = cards.transition(c, "working", tmp_path)
    assert p2.parent.name == "working"
    assert not (tmp_path / "inbox" / p2.name).exists()
    with pytest.raises(cards.ValidationError):
        cards.transition(c, "approved", tmp_path)  # working -> approved is illegal


def test_unowned_card_cannot_start_working(tmp_path):
    c = cards.new_card("p", "a", "t", "T1")
    cards.save(c, tmp_path)
    with pytest.raises(cards.ValidationError):
        cards.transition(c, "working", tmp_path)
