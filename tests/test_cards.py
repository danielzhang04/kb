import json
from pathlib import Path

import pytest
import cards


def test_new_card_emits_schema_v1(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    card = cards.new_card(project="kb-ops", action="test:noop", target="phase-i", risk_tier="T1")
    assert card.meta["schema-version"] == 1


def test_absent_schema_version_is_transition_v0():
    card = cards.parse_text("""---\nid: version-test\nproject: kb-ops\naction: test:noop\ntarget: phase-i\nrisk-tier: T1\nstate: inbox\n---\n""")
    assert cards.card_schema_version(card.meta) == 0


def test_python_supported_card_versions_match_platform_compatibility_matrix():
    matrix = json.loads((Path(__file__).parents[1] / "schemas" / "compatibility.json").read_text(encoding="utf-8"))
    assert cards.SUPPORTED_CARD_SCHEMA_VERSIONS == frozenset(matrix["cards"]["supported"])


@pytest.mark.parametrize("value", [2, -1, "1", True])
def test_unsupported_card_schema_is_rejected(value):
    meta = {"id": "version-test", "project": "kb-ops", "action": "test:noop", "target": "x", "risk-tier": "T1", "state": "inbox", "schema-version": value}
    with pytest.raises(cards.ValidationError, match="schema-version"):
        cards._validate(meta)


def test_migrate_v0_card_to_v1_without_changing_body():
    card = cards.parse_text("""---\nid: version-test\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n\n## Work order\nkeep me\n""")
    migrated = cards.migrate_card(card)
    assert migrated.meta["schema-version"] == 1
    assert migrated.body == card.body


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
# Stranded-archiver -- the terminal, reversible `archived` state               #
# --------------------------------------------------------------------------- #

def test_archived_is_a_valid_state_under_its_own_dir(tmp_path):
    c = cards.new_card("p", "a", "t", "T1", state="archived", owner="codex-worker")
    p = cards.save(c, tmp_path)  # must resolve STATE_DIR["archived"] without KeyError
    assert p.parent.name == "archived"
    assert cards.parse(p).meta["state"] == "archived"


def test_inbox_can_be_archived_directly(tmp_path):
    # The archiver walks an idle owned inbox card straight to archived.
    c = cards.new_card("p", "a", "t", "T1", owner="codex-worker")
    cards.save(c, tmp_path)
    p2 = cards.transition(c, "archived", tmp_path)
    assert p2.parent.name == "archived"
    assert not (tmp_path / "inbox" / p2.name).exists()


def test_working_can_be_archived_directly(tmp_path):
    # working is reachable (owner is set), so the archiver can archive it too.
    c = cards.new_card("p", "a", "t", "T1")
    cards.save(c, tmp_path)
    cards.claim(c, "codex-worker")
    cards.transition(c, "working", tmp_path)
    p2 = cards.transition(c, "archived", tmp_path)
    assert p2.parent.name == "archived"
    assert not (tmp_path / "working" / p2.name).exists()


def test_archived_reverses_to_inbox_only(tmp_path):
    # Reversibility: a human un-archives by walking archived -> inbox. Every other
    # move out of archived is illegal (it is terminal in every other direction).
    c = cards.new_card("p", "a", "t", "T1", state="archived", owner="codex-worker")
    cards.save(c, tmp_path)
    p2 = cards.transition(c, "inbox", tmp_path)
    assert p2.parent.name == "inbox"
    for illegal in ("working", "done", "approvals", "archived"):
        reread = cards.new_card("p", "a", "t2", "T1", state="archived", owner="codex-worker")
        cards.save(reread, tmp_path)
        with pytest.raises(cards.ValidationError):
            cards.transition(reread, illegal, tmp_path)


def test_terminal_states_cannot_be_archived(tmp_path):
    # done/rejected are already terminal; archived is not a legal escape from them.
    for terminal in ("done", "rejected"):
        c = cards.new_card("p", "a", "t", "T1", state=terminal)
        cards.save(c, tmp_path)
        with pytest.raises(cards.ValidationError):
            cards.transition(c, "archived", tmp_path)


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
    # inbox and working each GAINED `archived` (the stranded sink); every other
    # pre-existing target is untouched, asserted by subset below.
    assert cards.LEGAL["inbox"] == {"working", "blocked", "archived"}
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
