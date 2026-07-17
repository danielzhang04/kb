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


def test_invalid_role_rejected():
    with pytest.raises(cards.ValidationError):
        cards.new_card("p", "a", "t", "T1", role="bogus")


def test_default_role_is_work():
    c = cards.new_card("p", "a", "t", "T1")
    assert c.meta["role"] == "work"


# --------------------------------------------------------------------------- #
# Task D1.1 -- session-id field (Plane-A<->Plane-B join key)                  #
# --------------------------------------------------------------------------- #

def test_new_card_has_null_session_id_by_default():
    c = cards.new_card("p", "a", "t", "T1")
    assert "session-id" in c.meta
    assert c.meta["session-id"] is None


def test_stamp_session_sets_field(tmp_path):
    c = cards.new_card("p", "a", "t", "T1")
    cards.stamp_session(c, "sess-abc")
    assert c.meta["session-id"] == "sess-abc"
    p = cards.save(c, tmp_path)
    reread = cards.parse(p)
    assert reread.meta["session-id"] == "sess-abc"


def test_missing_session_id_still_validates(tmp_path):
    c = cards.new_card("p", "a", "t", "T1")
    del c.meta["session-id"]  # simulate a legacy on-disk card predating the field
    p = cards.save(c, tmp_path)
    reread = cards.parse(p)  # must not raise ValidationError
    assert "session-id" not in reread.meta


# --------------------------------------------------------------------------- #
# Task D1.3 -- steering-floor states (STATES/STATE_DIR/LEGAL)                #
# --------------------------------------------------------------------------- #

def test_steering_states_are_valid(tmp_path):
    for state in ("stop-requested", "halting", "halted"):
        c = cards.new_card("p", "a", "t", "T1", state=state)
        p = cards.save(c, tmp_path)  # must resolve a STATE_DIR without KeyError
        reread = cards.parse(p)
        assert reread.meta["state"] == state


def test_legal_stop_ladder_transitions(tmp_path):
    c = cards.new_card("p", "a", "t", "T1")
    cards.save(c, tmp_path)
    cards.claim(c, "agent-x")
    cards.transition(c, "working", tmp_path)
    cards.transition(c, "stop-requested", tmp_path)
    cards.transition(c, "halting", tmp_path)
    cards.transition(c, "halted", tmp_path)

    done_card = cards.new_card("p", "a", "t2", "T1", state="done")
    cards.save(done_card, tmp_path)
    with pytest.raises(cards.ValidationError):
        cards.transition(done_card, "stop-requested", tmp_path)


# --------------------------------------------------------------------------- #
# Phase R1.2 -- optional runtime/model routing fields + stamp_routing         #
# --------------------------------------------------------------------------- #

def test_new_card_has_null_runtime_and_model_by_default():
    c = cards.new_card("p", "a", "t", "T1")
    assert "runtime" in c.meta and c.meta["runtime"] is None
    assert "model" in c.meta and c.meta["model"] is None


def test_stamp_routing_sets_fields(tmp_path):
    c = cards.new_card("p", "a", "t", "T1")
    cards.stamp_routing(c, "claude", "claude-opus-4-8")
    assert c.meta["runtime"] == "claude"
    assert c.meta["model"] == "claude-opus-4-8"
    p = cards.save(c, tmp_path)
    reread = cards.parse(p)
    assert reread.meta["runtime"] == "claude"
    assert reread.meta["model"] == "claude-opus-4-8"


def test_missing_routing_fields_still_validate(tmp_path):
    c = cards.new_card("p", "a", "t", "T1")
    del c.meta["runtime"]  # simulate a legacy on-disk card predating the fields
    del c.meta["model"]
    p = cards.save(c, tmp_path)
    reread = cards.parse(p)  # must not raise ValidationError
    assert "runtime" not in reread.meta
    assert "model" not in reread.meta


def test_invalid_runtime_rejected_when_present():
    with pytest.raises(cards.ValidationError):
        cards.new_card("p", "a", "t", "T1", runtime="gpt")  # not in RUNTIMES


def test_null_or_absent_runtime_not_rejected(tmp_path):
    # runtime: None (fresh card) and absent (legacy) both validate -- mirror role.
    c = cards.new_card("p", "a", "t", "T1")  # runtime defaults to None
    cards.save(c, tmp_path)
    assert c.meta["runtime"] is None


def test_model_is_free_form_not_enum_checked():
    # cards.py deliberately does NOT validate concrete model ids (routing.resolve
    # does, against the registry) -- so an arbitrary model string is accepted here.
    c = cards.new_card("p", "a", "t", "T1", runtime="claude", model="some-future-model")
    assert c.meta["model"] == "some-future-model"


def test_existing_transitions_unchanged(tmp_path):
    assert cards.LEGAL["inbox"] == {"working", "blocked"}
    assert cards.LEGAL["blocked"] == {"inbox"}
    assert cards.LEGAL["approvals"] == {"approved", "rejected"}
    assert cards.LEGAL["approved"] == {"done"}
    assert cards.LEGAL["done"] == set()
    assert cards.LEGAL["rejected"] == set()
    assert {"done", "approvals", "blocked"} <= cards.LEGAL["working"]

    assert cards.STATE_DIR["inbox"] == "inbox"
    assert cards.STATE_DIR["blocked"] == "inbox"
    assert cards.STATE_DIR["working"] == "working"
    assert cards.STATE_DIR["done"] == "done"
    assert cards.STATE_DIR["rejected"] == "done"
    assert cards.STATE_DIR["approvals"] == "approvals"
    assert cards.STATE_DIR["approved"] == "approvals"

    c = cards.new_card("p", "a", "t", "T1")
    cards.save(c, tmp_path)
    cards.claim(c, "agent-x")
    p2 = cards.transition(c, "working", tmp_path)
    assert p2.parent.name == "working"
    with pytest.raises(cards.ValidationError):
        cards.transition(c, "approved", tmp_path)  # still illegal
