from __future__ import annotations

from dataclasses import asdict
import json
import sqlite3
from pathlib import Path

import pytest

from scripts.prospecting.manager.campaigns import (
    CampaignCreationStatus,
    CampaignError,
    CampaignService,
    DraftingSettings,
    _request_hash,
)
from scripts.prospecting.p2_store import compile_target_policy
from scripts.prospecting.personalizer.cli import _campaign_policy
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_affinity_fitspec import _queue_any_exec_request


PROFILE_ID = "22222222-2222-4222-8222-222222222222"
OTHER_PROFILE_ID = "33333333-3333-4333-8333-333333333333"
MAILBOX_ID = "mailbox-001"
OTHER_MAILBOX_ID = "mailbox-002"
REQUEST_ONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
REQUEST_TWO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
CAMPAIGN_ONE = "camp_1111111111111111"
CAMPAIGN_TWO = "camp_2222222222222222"
NOW = "2026-09-09T04:00:00Z"
BRIEF = (
    "intent:networking lane:manual industry:software people-count:8\n"
    "path: synthetic operations work\n"
    "must: synthetic operating experience\n"
)
DRAFTING = DraftingSettings(
    step=0, minimum_confidence=0.8, model_version="fixture-v1"
)


def _profile(connection: sqlite3.Connection, profile_id: str = PROFILE_ID) -> None:
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        (
            profile_id,
            "Synthetic Sender",
            None,
            "Synthetic focus",
            "Synthetic background",
            "Synthetic proof",
            "[]",
        ),
    )


def _service(
    connection: sqlite3.Connection, campaign_ids: tuple[str, ...]
) -> CampaignService:
    values = iter(campaign_ids)
    return CampaignService(
        connection, campaign_id_factory=lambda: next(values), now=lambda: NOW
    )


def _counts(connection: sqlite3.Connection) -> tuple[int, int]:
    return (
        connection.execute("SELECT count(*) FROM campaign").fetchone()[0],
        connection.execute("SELECT count(*) FROM campaign_brief").fetchone()[0],
    )


def _resolve_company_id(connection: sqlite3.Connection, value: str) -> str | None:
    row = connection.execute(
        "SELECT company_id FROM company WHERE company_id=?", (value,)
    ).fetchone()
    return str(row[0]) if row is not None else None


def test_two_requests_create_distinct_p8_campaign_ids_and_p2_policy_hashes(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE, CAMPAIGN_TWO))

    first = service.create(
        request_id=REQUEST_ONE,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
        drafting=DRAFTING,
    )
    second = service.create(
        request_id=REQUEST_TWO,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
        drafting=DRAFTING,
    )

    assert (first.campaign_id, second.campaign_id) == (CAMPAIGN_ONE, CAMPAIGN_TWO)
    assert first.created is True and second.created is True
    assert _counts(connection) == (2, 2)
    for session in (first, second):
        row = connection.execute(
            "SELECT policy_json,policy_hash FROM campaign WHERE campaign_id=?",
            (session.campaign_id,),
        ).fetchone()
        stored_policy = json.loads(row["policy_json"])
        expected = compile_target_policy(
            stored_policy, lambda value: _resolve_company_id(connection, value)
        )
        assert session.campaign_id.startswith("camp_")
        assert len(session.campaign_id) == len("camp_") + 16
        assert row["policy_hash"] == expected.policy_hash == session.policy_hash
        assert stored_policy == session.target_policy
        assert _campaign_policy(connection, session.campaign_id) == stored_policy


def test_company_names_compile_to_ids_before_the_downstream_p2_hash(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    company_id = "cmp_6666666666666666"
    connection.execute(
        "INSERT INTO company VALUES(?,?,?,?,?,?,?,?,?)",
        (
            company_id,
            "Synthetic Co",
            None,
            None,
            None,
            "software",
            "remote",
            "manual",
            "synthetic-co",
        ),
    )
    session = _service(connection, (CAMPAIGN_ONE,)).create(
        request_id=REQUEST_ONE,
        brief_text="intent:networking company-list:Synthetic_Co",
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )

    predicate = session.target_policy["predicates"][0]
    assert predicate == {
        "predicate_id": "p10-company-list",
        "type": "company_list",
        "value": [company_id],
    }
    assert compile_target_policy(
        session.target_policy, lambda value: _resolve_company_id(connection, value)
    ).policy_hash == session.policy_hash


def test_retry_with_same_request_and_inputs_returns_same_campaign(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))
    arguments = {
        "request_id": REQUEST_ONE,
        "brief_text": BRIEF,
        "sender_profile_id": PROFILE_ID,
        "mailbox_id": MAILBOX_ID,
    }

    created = service.create(**arguments)
    retried = service.create(**arguments)

    assert created.created is True
    assert retried.created is False
    assert retried.campaign_id == created.campaign_id == CAMPAIGN_ONE
    assert retried.policy_hash == created.policy_hash
    assert _counts(connection) == (1, 1)


def test_retry_with_changed_drafting_configuration_is_a_conflict(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE, CAMPAIGN_TWO))
    arguments = {
        "request_id": REQUEST_ONE,
        "brief_text": BRIEF,
        "sender_profile_id": PROFILE_ID,
        "mailbox_id": MAILBOX_ID,
    }
    service.create(**arguments, drafting=DRAFTING)

    with pytest.raises(CampaignError, match="^request_conflict$"):
        service.create(
            **arguments,
            drafting=DraftingSettings(0, 0.8, "different-v1"),
        )
    assert _counts(connection) == (1, 1)


@pytest.mark.parametrize(
    ("changed", "value"),
    [
        ("brief_text", BRIEF + "prefer: synthetic strategy experience\n"),
        ("sender_profile_id", OTHER_PROFILE_ID),
        ("mailbox_id", OTHER_MAILBOX_ID),
    ],
)
def test_conflicting_retry_fails_before_mutation(
    tmp_path: Path, changed: str, value: str
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    _profile(connection, OTHER_PROFILE_ID)
    service = _service(connection, (CAMPAIGN_ONE, CAMPAIGN_TWO))
    arguments = {
        "request_id": REQUEST_ONE,
        "brief_text": BRIEF,
        "sender_profile_id": PROFILE_ID,
        "mailbox_id": MAILBOX_ID,
    }
    service.create(**arguments)
    before = tuple(connection.execute("SELECT * FROM campaign_brief"))[0]

    with pytest.raises(CampaignError, match="^request_conflict$"):
        service.create(**(arguments | {changed: value}))

    assert _counts(connection) == (1, 1)
    after = tuple(connection.execute("SELECT * FROM campaign_brief"))[0]
    assert tuple(after) == tuple(before)


def test_restart_resume_preserves_campaign_and_creates_nothing(tmp_path: Path) -> None:
    path = tmp_path / "store.sqlite"
    connection = open_store(path)
    _profile(connection)
    created = _service(connection, (CAMPAIGN_ONE,)).create(
        request_id=REQUEST_ONE,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )
    connection.close()

    reopened = open_store(path)
    resumed = CampaignService(reopened).resume(CAMPAIGN_ONE)

    assert resumed.created is False
    assert resumed.campaign_id == created.campaign_id
    assert resumed.request_id == created.request_id
    assert resumed.policy_hash == created.policy_hash
    assert resumed.sender_profile_id == PROFILE_ID
    assert resumed.mailbox_id == MAILBOX_ID
    assert resumed.brief_text == BRIEF
    assert resumed.fit_text == created.fit_text
    assert _counts(reopened) == (1, 1)


@pytest.mark.parametrize(
    ("statement", "parameters"),
    [
        (
            "UPDATE campaign SET policy_hash=? WHERE campaign_id=?",
            ("f" * 64, CAMPAIGN_ONE),
        ),
        (
            "UPDATE campaign SET sender_profile_id=? WHERE campaign_id=?",
            (OTHER_PROFILE_ID, CAMPAIGN_ONE),
        ),
        (
            "UPDATE campaign SET policy_json=json_set(policy_json, '$.timezone', ?) "
            "WHERE campaign_id=?",
            ("UTC", CAMPAIGN_ONE),
        ),
    ],
)
def test_resume_rejects_a_stale_or_forged_policy_binding(
    tmp_path: Path, statement: str, parameters: tuple[str, str]
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    _profile(connection, OTHER_PROFILE_ID)
    service = _service(connection, (CAMPAIGN_ONE,))
    service.create(
        request_id=REQUEST_ONE,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )
    connection.execute(statement, parameters)

    with pytest.raises(CampaignError, match="^campaign_state_invalid$"):
        service.resume(CAMPAIGN_ONE)
    assert _counts(connection) == (1, 1)


@pytest.mark.parametrize(
    ("arguments", "code"),
    [
        ({"request_id": "missing"}, "invalid_request_id"),
        ({"request_id": ""}, "invalid_request_id"),
        ({"brief_text": "   "}, "invalid_brief"),
        ({"sender_profile_id": "missing"}, "invalid_sender_profile_id"),
        ({"sender_profile_id": OTHER_PROFILE_ID}, "sender_profile_missing"),
        ({"mailbox_id": ""}, "invalid_mailbox_id"),
    ],
)
def test_invalid_or_missing_creation_inputs_never_mutate(
    tmp_path: Path, arguments: dict[str, str], code: str
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    values = {
        "request_id": REQUEST_ONE,
        "brief_text": BRIEF,
        "sender_profile_id": PROFILE_ID,
        "mailbox_id": MAILBOX_ID,
    }

    with pytest.raises(CampaignError, match=f"^{code}$"):
        _service(connection, (CAMPAIGN_ONE,)).create(**(values | arguments))
    assert _counts(connection) == (0, 0)


@pytest.mark.parametrize(
    "brief",
    [
        "intent:networking intent:networking ask:informational_call minutes:15",
        "intent:networking people-count:20 PEOPLE-COUNT:8 ask:informational_call minutes:15",
    ],
)
def test_new_campaign_refuses_duplicate_compiler_fields_without_partial_state(
    tmp_path: Path, brief: str,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))

    with pytest.raises(CampaignError, match="^duplicate_brief_field$"):
        service.create(
            request_id=REQUEST_ONE,
            brief_text=brief,
            sender_profile_id=PROFILE_ID,
            mailbox_id=MAILBOX_ID,
        )

    assert _counts(connection) == (0, 0)
    assert connection.in_transaction is False
    created = service.create(
        request_id=REQUEST_ONE,
        brief_text=(
            "intent:networking people-count:8 ask:informational_call minutes:15\n"
            "path: synthetic operations work\n"
            "must: synthetic operating experience\n"
            "prefer: synthetic strategy experience\n"
        ),
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )
    assert created.created is True
    assert created.target_policy["requested_people"] == 8
    assert _counts(connection) == (1, 1)


def test_historical_duplicate_brief_remains_resumable_and_exactly_retryable(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))
    created = service.create(
        request_id=REQUEST_ONE,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )
    historical = BRIEF.replace(
        "people-count:8", "people-count:20 people-count:8",
    )
    connection.execute(
        "UPDATE campaign_brief SET brief_text=?,request_hash=? WHERE campaign_id=?",
        (
            historical,
            _request_hash(historical, created.fit_text, PROFILE_ID, MAILBOX_ID, None),
            CAMPAIGN_ONE,
        ),
    )
    connection.commit()

    resumed = service.resume(CAMPAIGN_ONE)
    retried = service.create(
        request_id=REQUEST_ONE,
        brief_text=historical,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )

    assert resumed.brief_text == historical
    assert resumed.target_policy["requested_people"] == 8
    assert retried.created is False
    assert retried.campaign_id == CAMPAIGN_ONE
    assert _counts(connection) == (1, 1)
    assert connection.in_transaction is False


@pytest.mark.parametrize("minutes", [10, 20])
def test_first_draft_compatible_accepts_minute_boundaries(
    tmp_path: Path, minutes: int
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    session = _service(connection, (CAMPAIGN_ONE,)).create(
        request_id=REQUEST_ONE,
        brief_text=f"intent:networking ask:informational_call minutes:{minutes}",
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
        require_first_draft_compatible=True,
    )
    assert session.target_policy["ask_minutes"] == minutes
    assert _counts(connection) == (1, 1)


@pytest.mark.parametrize(
    ("brief", "code"),
    [
        ("intent:networking ask:feedback minutes:15", "ask_type_unsupported"),
        ("intent:networking ask:informational_call minutes:9", "ask_minutes_unsupported"),
    ],
)
def test_first_draft_incompatible_policy_never_inserts_rows(
    tmp_path: Path, brief: str, code: str
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    with pytest.raises(CampaignError, match=f"^{code}$"):
        _service(connection, (CAMPAIGN_ONE,)).create(
            request_id=REQUEST_ONE,
            brief_text=brief,
            sender_profile_id=PROFILE_ID,
            mailbox_id=MAILBOX_ID,
            require_first_draft_compatible=True,
        )
    assert _counts(connection) == (0, 0)


def test_first_draft_compatible_retry_refuses_existing_incompatible_campaign(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))
    arguments = {
        "request_id": REQUEST_ONE,
        "brief_text": "intent:networking ask:feedback minutes:15",
        "sender_profile_id": PROFILE_ID,
        "mailbox_id": MAILBOX_ID,
    }
    service.create(**arguments)
    before = tuple(connection.execute("SELECT * FROM campaign"))[0]

    with pytest.raises(CampaignError, match="^ask_type_unsupported$"):
        service.create(**arguments, require_first_draft_compatible=True)

    assert _counts(connection) == (1, 1)
    assert tuple(connection.execute("SELECT * FROM campaign"))[0] == before


def test_campaign_and_literal_record_are_one_atomic_write(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    connection.execute(
        """CREATE TRIGGER reject_campaign_brief
           BEFORE INSERT ON campaign_brief
           BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END"""
    )

    with pytest.raises(CampaignError, match="^campaign_create_failed$"):
        _service(connection, (CAMPAIGN_ONE,)).create(
            request_id=REQUEST_ONE,
            brief_text=BRIEF,
            sender_profile_id=PROFILE_ID,
            mailbox_id=MAILBOX_ID,
        )
    assert _counts(connection) == (0, 0)


def test_vm_projection_contains_policy_and_opaque_ids_only(tmp_path: Path) -> None:
    marker = "synthetic-literal-marker"
    brief = BRIEF + f"prefer: {marker}\n"
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    session = _service(connection, (CAMPAIGN_ONE,)).create(
        request_id=REQUEST_ONE,
        brief_text=brief,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )

    projection = session.vm_projection()
    rendered = json.dumps(projection, sort_keys=True)
    assert marker not in rendered
    assert BRIEF not in rendered
    assert set(projection) == {
        "campaign_id",
        "policy_id",
        "policy_hash",
        "sender_profile_id",
        "mailbox_id",
        "drafting_configured",
        "target_policy",
    }
    assert connection.execute(
        "SELECT brief_text FROM campaign_brief WHERE campaign_id=?", (CAMPAIGN_ONE,)
    ).fetchone()[0] == brief


@pytest.mark.parametrize(
    ("field", "value"),
    [("requested_people", 400), ("timezone", "UTC")],
)
def test_mutating_a_frozen_sessions_policy_cannot_reuse_the_old_hash(
    tmp_path: Path, field: str, value: object
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    session = _service(connection, (CAMPAIGN_ONE,)).create(
        request_id=REQUEST_ONE,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )
    session.target_policy[field] = value

    with pytest.raises(CampaignError, match="^campaign_state_invalid$"):
        session.vm_projection()


def test_vm_projection_returns_a_copy_instead_of_session_state(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    session = _service(connection, (CAMPAIGN_ONE,)).create(
        request_id=REQUEST_ONE,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )
    projection = session.vm_projection()
    projection["target_policy"]["requested_people"] = 400

    assert session.vm_projection()["target_policy"]["requested_people"] == 8


def test_unknown_authority_bearing_policy_extension_is_never_forwarded(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))
    service.create(
        request_id=REQUEST_ONE,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )
    connection.execute(
        "UPDATE campaign SET policy_json=json_set(policy_json, '$.t1_live_gate', 1) "
        "WHERE campaign_id=?",
        (CAMPAIGN_ONE,),
    )

    with pytest.raises(CampaignError, match="^campaign_state_invalid$"):
        service.resume(CAMPAIGN_ONE)


def test_missing_drafting_configuration_is_explicit_and_not_invented(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    session = _service(connection, (CAMPAIGN_ONE,)).create(
        request_id=REQUEST_ONE,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )

    assert session.drafting_configured is False
    assert not {"step", "minimum_confidence", "model_version"} & set(
        session.target_policy
    )
    with pytest.raises(ValueError, match="^campaign_policy_schema$"):
        _campaign_policy(connection, CAMPAIGN_ONE)
    assert session.vm_projection()["drafting_configured"] is False


@pytest.mark.parametrize(
    "drafting",
    [
        DraftingSettings(-1, 0.8, "fixture-v1"),
        DraftingSettings(0, 1.1, "fixture-v1"),
        DraftingSettings(0, 0.8, "not a safe label"),
    ],
)
def test_invalid_drafting_configuration_never_mutates(
    tmp_path: Path, drafting: DraftingSettings
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    with pytest.raises(CampaignError, match="^invalid_drafting_settings$"):
        _service(connection, (CAMPAIGN_ONE,)).create(
            request_id=REQUEST_ONE,
            brief_text=BRIEF,
            sender_profile_id=PROFILE_ID,
            mailbox_id=MAILBOX_ID,
            drafting=drafting,
        )
    assert _counts(connection) == (0, 0)


def test_selected_draft_format_is_canonical_monotonic_and_preserves_target_hash(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))
    created = service.create(
        request_id=REQUEST_ONE, brief_text=BRIEF, sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID, require_first_draft_compatible=True,
    )
    before = connection.execute(
        "SELECT policy_json,policy_hash FROM campaign WHERE campaign_id=?", (CAMPAIGN_ONE,),
    ).fetchone()
    status = service.selected_draft_format_status(CAMPAIGN_ONE)
    assert (status.state, status.changed, status.policy_hash) == ("missing", False, created.policy_hash)
    with pytest.raises(CampaignError, match="^policy_state_stale$"):
        service.configure_selected_draft_format(CAMPAIGN_ONE, "0" * 64)
    assert connection.execute(
        "SELECT policy_json,policy_hash FROM campaign WHERE campaign_id=?", (CAMPAIGN_ONE,),
    ).fetchone() == before

    configured = service.configure_selected_draft_format(CAMPAIGN_ONE, status.policy_state_hash)
    row = connection.execute(
        "SELECT policy_json,policy_hash FROM campaign WHERE campaign_id=?", (CAMPAIGN_ONE,),
    ).fetchone()
    policy = json.loads(row["policy_json"])
    assert (configured.state, configured.changed, row["policy_hash"]) == (
        "configured", True, created.policy_hash,
    )
    assert policy["copy_profile"] == {
        "body_words": [75, 125], "subject_chars": [36, 50],
        "ask_minutes": 20, "third_touch": None,
    }
    assert "fit_spec_hash" not in policy
    assert policy["ask_minutes"] == created.target_policy["ask_minutes"]

    replay = service.configure_selected_draft_format(CAMPAIGN_ONE, status.policy_state_hash)
    assert (replay.state, replay.changed, replay.policy_state_hash) == (
        "configured", False, configured.policy_state_hash,
    )
    assert connection.execute(
        "SELECT policy_json,policy_hash FROM campaign WHERE campaign_id=?", (CAMPAIGN_ONE,),
    ).fetchone() == row


def test_selected_draft_format_refuses_corrupt_state_and_missing_required_guard_table(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))
    service.create(
        request_id=REQUEST_ONE, brief_text=BRIEF, sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID, require_first_draft_compatible=True,
    )
    status = service.selected_draft_format_status(CAMPAIGN_ONE)
    connection.execute("UPDATE campaign SET ask_minutes=11 WHERE campaign_id=?", (CAMPAIGN_ONE,))
    with pytest.raises(CampaignError, match="^campaign_state_invalid$"):
        service.configure_selected_draft_format(CAMPAIGN_ONE, status.policy_state_hash)
    connection.execute("UPDATE campaign SET ask_minutes=15 WHERE campaign_id=?", (CAMPAIGN_ONE,))
    connection.execute("DROP TABLE selected_draft_binding")
    with pytest.raises(CampaignError, match="^campaign_state_invalid$"):
        service.configure_selected_draft_format(CAMPAIGN_ONE, status.policy_state_hash)


def test_selected_draft_format_reports_busy_without_mutating(tmp_path: Path) -> None:
    database = tmp_path / "store.sqlite"
    connection = open_store(database)
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))
    service.create(
        request_id=REQUEST_ONE, brief_text=BRIEF, sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID, require_first_draft_compatible=True,
    )
    status = service.selected_draft_format_status(CAMPAIGN_ONE)
    before = connection.execute(
        "SELECT policy_json,policy_hash FROM campaign WHERE campaign_id=?", (CAMPAIGN_ONE,),
    ).fetchone()
    blocker = sqlite3.connect(database, timeout=0)
    try:
        blocker.execute("BEGIN EXCLUSIVE")
        with pytest.raises(CampaignError, match="^store_busy$"):
            service.configure_selected_draft_format(CAMPAIGN_ONE, status.policy_state_hash)
    finally:
        blocker.rollback()
        blocker.close()
    assert connection.execute(
        "SELECT policy_json,policy_hash FROM campaign WHERE campaign_id=?", (CAMPAIGN_ONE,),
    ).fetchone() == before


def test_selected_draft_format_refuses_a_valid_campaign_scoped_exec_request(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))
    service.create(
        request_id=REQUEST_ONE, brief_text=BRIEF, sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID, require_first_draft_compatible=True,
    )
    status = service.selected_draft_format_status(CAMPAIGN_ONE)
    before = connection.execute(
        "SELECT policy_json,policy_hash FROM campaign WHERE campaign_id=?", (CAMPAIGN_ONE,),
    ).fetchone()
    _queue_any_exec_request(connection, CAMPAIGN_ONE)

    with pytest.raises(CampaignError, match="^selected_draft_format_locked$"):
        service.configure_selected_draft_format(CAMPAIGN_ONE, status.policy_state_hash)

    assert connection.execute(
        "SELECT policy_json,policy_hash FROM campaign WHERE campaign_id=?", (CAMPAIGN_ONE,),
    ).fetchone() == before


NO_PREDICATE_MANUAL_BRIEF = "intent:networking lane:manual"
UNSUPPORTED_LANE_BRIEF = "intent:networking lane:pdl"
UNSUPPORTED_LANE_WITH_PREDICATE_BRIEF = "intent:networking lane:pdl industry:software"


def test_predicate_free_manual_brief_still_compiles_and_persists_one_campaign(
    tmp_path: Path,
) -> None:
    """A supported lane with no predicates must remain fully accepted.

    The lane guard is deliberately independent of predicate count, so this is
    the positive case that keeps it from becoming an over-broad refusal.
    """
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    session = _service(connection, (CAMPAIGN_ONE,)).create(
        request_id=REQUEST_ONE,
        brief_text=NO_PREDICATE_MANUAL_BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )

    assert session.created is True
    assert session.target_policy["predicates"] == []
    assert session.target_policy["lane_plan"] == ["manual"]
    assert _counts(connection) == (1, 1)
    resumed = CampaignService(connection).resume(CAMPAIGN_ONE)
    assert resumed.policy_hash == session.policy_hash


@pytest.mark.parametrize(
    ("brief", "code"),
    [
        (UNSUPPORTED_LANE_BRIEF, "unsupported_lane"),
        (UNSUPPORTED_LANE_WITH_PREDICATE_BRIEF, "unsupported:p01-industry"),
    ],
)
def test_unsupported_lane_is_refused_with_a_stable_code_and_no_partial_write(
    tmp_path: Path, brief: str, code: str
) -> None:
    """An unsupported lane is refused whether or not the brief has predicates.

    The predicate-free brief is the previously wrong behaviour: the general
    compiler capability-checks a lane only inside its predicate loop, so a
    zero-predicate brief compiled cleanly and both durable rows were written
    with an unsupported ``lane_plan``.  It must now refuse with a fixed code
    and leave no row in either table.  The with-predicate brief keeps the
    compiler's existing per-predicate code, unchanged by this repair.  Both
    attempts run twice to show the code is stable rather than first-call only.
    """
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE, CAMPAIGN_TWO))

    for _attempt in range(2):
        with pytest.raises(CampaignError, match=f"^{code}$"):
            service.create(
                request_id=REQUEST_ONE,
                brief_text=brief,
                sender_profile_id=PROFILE_ID,
                mailbox_id=MAILBOX_ID,
            )
        assert _counts(connection) == (0, 0)
    assert connection.in_transaction is False


def _durable_state(
    connection: sqlite3.Connection,
) -> tuple[tuple[tuple[object, ...], ...], tuple[tuple[object, ...], ...]]:
    return (
        tuple(
            tuple(row)
            for row in connection.execute("SELECT * FROM campaign ORDER BY campaign_id")
        ),
        tuple(
            tuple(row)
            for row in connection.execute(
                "SELECT * FROM campaign_brief ORDER BY request_id"
            )
        ),
    )


def test_creation_status_for_an_absent_request_reads_nothing_and_writes_nothing(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))

    status = service.creation_status(REQUEST_ONE)

    assert status == CampaignCreationStatus(REQUEST_ONE, "not_found", None)
    assert _counts(connection) == (0, 0)
    assert _durable_state(connection) == ((), ())
    assert connection.in_transaction is False
    # Repeating the lookup is still a pure read: no row is created to remember it.
    assert service.creation_status(REQUEST_ONE) == status
    assert _counts(connection) == (0, 0)


def test_creation_status_resolves_the_exact_saved_campaign_id_without_private_fields(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))
    created = service.create(
        request_id=REQUEST_ONE,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
        drafting=DRAFTING,
    )
    before = _durable_state(connection)

    status = service.creation_status(REQUEST_ONE)

    assert status == CampaignCreationStatus(REQUEST_ONE, "saved", created.campaign_id)
    assert status.campaign_id == CAMPAIGN_ONE
    # A different, never-saved key is answered independently and truthfully.
    assert service.creation_status(REQUEST_TWO) == CampaignCreationStatus(
        REQUEST_TWO, "not_found", None
    )
    # Fixed closed shape: no brief, fit text, sender profile, mailbox, policy
    # hash or drafting model is reachable through the returned status.
    assert set(asdict(status)) == {"request_id", "state", "campaign_id"}
    rendered = json.dumps(asdict(status), sort_keys=True)
    for secret in (
        BRIEF, "synthetic operations work", PROFILE_ID, MAILBOX_ID,
        DRAFTING.model_version, created.policy_hash, created.fit_text,
    ):
        assert secret not in rendered
    # Repeating the lookup changes no durable state at all.
    assert service.creation_status(REQUEST_ONE) == status
    assert _durable_state(connection) == before
    assert _counts(connection) == (1, 1)
    assert connection.in_transaction is False


@pytest.mark.parametrize(
    "value",
    [
        "missing",
        "",
        REQUEST_ONE.upper(),
        REQUEST_ONE.replace("-", ""),
        "{" + REQUEST_ONE + "}",
        " " + REQUEST_ONE,
        REQUEST_ONE + "\n",
        CAMPAIGN_ONE,
    ],
)
def test_creation_status_refuses_a_noncanonical_request_key(
    tmp_path: Path, value: str
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))
    service.create(
        request_id=REQUEST_ONE,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )
    before = _durable_state(connection)

    with pytest.raises(CampaignError, match="^invalid_request_id$"):
        service.creation_status(value)

    assert _durable_state(connection) == before
    assert _counts(connection) == (1, 1)


@pytest.mark.parametrize(
    ("statement", "parameters"),
    [
        (
            "UPDATE campaign SET policy_json=json_set(policy_json, '$.timezone', ?) "
            "WHERE campaign_id=?",
            ("UTC", CAMPAIGN_ONE),
        ),
        (
            "UPDATE campaign SET policy_hash=? WHERE campaign_id=?",
            ("f" * 64, CAMPAIGN_ONE),
        ),
        (
            "UPDATE campaign_brief SET request_hash=? WHERE campaign_id=?",
            ("f" * 64, CAMPAIGN_ONE),
        ),
    ],
)
def test_creation_status_refuses_saved_but_corrupt_state_and_binds_no_campaign(
    tmp_path: Path, statement: str, parameters: tuple[str, str]
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection)
    service = _service(connection, (CAMPAIGN_ONE,))
    service.create(
        request_id=REQUEST_ONE,
        brief_text=BRIEF,
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
    )
    connection.execute(statement, parameters)
    connection.commit()
    before = _durable_state(connection)

    with pytest.raises(CampaignError) as error:
        service.creation_status(REQUEST_ONE)

    # The refusal is a fixed code only: no campaign identity is handed back for
    # a row that failed the full session integrity recompile.
    assert str(error.value) == "campaign_state_invalid"
    assert CAMPAIGN_ONE not in str(error.value)
    assert BRIEF not in str(error.value)
    assert _durable_state(connection) == before
    assert _counts(connection) == (1, 1)
    assert connection.in_transaction is False
