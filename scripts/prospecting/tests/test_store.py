from scripts import prospecting


def test_01_package_discovery() -> None:
    assert prospecting.SCHEMA_VERSION == 1


import os
import inspect
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import replace
from pathlib import Path

import pytest

from scripts.prospecting.store import (
    ExecRequest,
    MigrationError,
    SCHEMA_PATH,
    get_schema_version,
    open_store,
    resolve_store_path,
    validate_exec_request,
)
import scripts.prospecting.export as export_module
import scripts.prospecting.store as store_module
from scripts.prospecting.cli import apply_override
from scripts.prospecting.export import export_csv
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture

SCHEMA = Path(__file__).parents[1] / "schema.sql"
DATASSETTE_SCRIPT = Path(__file__).parents[1] / "serve_datasette.ps1"
SYNTHETIC = legacy_fixture("test_store")


def _schema_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript(SCHEMA.read_text(encoding="utf-8"))
    return connection


def test_25_two_campaigns_share_one_policy_hash(record_property: object) -> None:
    connection = _schema_connection()
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender", "Synthetic", None, "focus", "background", "proof", "[]"),
    )
    campaign = (
        "campaign-1", "networking", "sender", "{}", "informational_call", 15, "direct",
        "networking-v1", "[]", "09:00-17:00", "America/New_York", 25, 6, 2, "T1",
        "mailbox", "{}", 0, "draft", "a" * 64,
    )
    connection.execute("INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", campaign)
    second_campaign = list(campaign)
    second_campaign[0] = "campaign-2"
    connection.execute("INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", second_campaign)

    persisted = connection.execute(
        "SELECT campaign_id FROM campaign WHERE policy_hash=? ORDER BY campaign_id", ("a" * 64,)
    ).fetchall()
    assert persisted == [("campaign-1",), ("campaign-2",)]
    policy_hash_index = next(
        index for index in connection.execute("PRAGMA index_list('campaign')") if "policy" in index[1]
    )
    assert policy_hash_index[2] == 0
    record_property("shared_policy_hash_campaigns", len(persisted))  # type: ignore[attr-defined]


def test_02_schema_contains_every_data_table() -> None:
    connection = _schema_connection()
    names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    expected = {
        "schema_version", "schema_migrations", "sender_profile", "company", "person", "campaign",
        "source_observation", "employment", "merge_review", "fit_score_version",
        "fit_score", "predicate_override", "eligibility_decision", "fit_veto", "contact_point", "exec_request",
        "provider_attempt", "credit_reservation", "finder_run", "finder_cursor",
        "source_snapshot", "evidence", "revision", "reply_template", "approval",
        "enrollment", "delivery", "inbound", "reply_revision", "suppression",
        "relationship", "audit"
    }
    assert names == expected
    normalized = " ".join(SCHEMA.read_text(encoding="utf-8").split())
    required_checks = (
        "source_lane IN ('linkedin_assisted','class_c_public_profile','manual','pitchbook','pdl')",
        "intent IN ('networking','recruiting_live','curiosity','alumni','sales')",
        "ask_minutes BETWEEN 1 AND 20", "tone IN ('direct','warm','formal')",
        "json_array_length(cadence) <= 3", "daily_cap BETWEEN 1 AND 50",
        "hourly_cap BETWEEN 1 AND 6", "firm_collision_cap BETWEEN 1 AND 2",
        "approval_tier IN ('T0','T1','T2','T3')", "credit_budget >= 0",
        "status IN ('draft','approved','active','paused','closed')",
        "entity_type IN ('company','person','contact','employment')",
        "confidence BETWEEN 0.0 AND 1.0", "score BETWEEN 0 AND 100",
        "outcome IN ('eligible','ineligible','needs_override')", "bounce_history >= 0",
        "step BETWEEN 0 AND 2", "angle IN ('why_them','signal_led','offer_led','follow_up_value')",
        "generation_mode IN ('bespoke','template_with_purpose')", "template_version >= 1",
        "content_kind IN ('revision','reply_template','campaign_policy')",
        "permitted_action IN ('send_revision','send_preapproved_reply_template','activate_campaign')",
        "state IN ('queued','claimed','succeeded','rejected','uncertain')",
        "priority >= 0", "credits >= 0", "max_cost >= 0",
        "requested_companies >= 0", "requested_people >= 0", "processed >= 0",
        "yielded >= 0", "allowed_for_copy IN (0,1)",
    )
    assert all(fragment in normalized for fragment in required_checks)


def test_03_schema_foreign_keys_are_valid() -> None:
    connection = _schema_connection()
    tables = tuple(row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'"))
    actual = {(table, row[3], row[2], row[4]) for table in tables for row in connection.execute(f"PRAGMA foreign_key_list({table})")}
    expected = {
        ("campaign", "sender_profile_id", "sender_profile", "sender_profile_id"),
        ("source_observation", "snapshot_id", "source_snapshot", "snapshot_id"),
        ("employment", "person_id", "person", "person_id"), ("employment", "company_id", "company", "company_id"), ("employment", "source_observation_id", "source_observation", "observation_id"),
        ("fit_score", "campaign_id", "campaign", "campaign_id"), ("fit_score", "person_id", "person", "person_id"), ("fit_score", "fit_score_version_id", "fit_score_version", "fit_score_version_id"),
        ("predicate_override", "campaign_id", "campaign", "campaign_id"),
        ("eligibility_decision", "campaign_id", "campaign", "campaign_id"), ("eligibility_decision", "person_id", "person", "person_id"), ("eligibility_decision", "fit_score_version_id", "fit_score_version", "fit_score_version_id"), ("eligibility_decision", "override_id", "predicate_override", "override_id"),
        ("fit_veto", "person_id", "person", "person_id"), ("fit_veto", "campaign_id", "campaign", "campaign_id"),
        ("contact_point", "person_id", "person", "person_id"), ("contact_point", "employer_company_id", "company", "company_id"), ("evidence", "person_id", "person", "person_id"),
        ("revision", "person_id", "person", "person_id"), ("revision", "campaign_id", "campaign", "campaign_id"),
        ("approval", "campaign_id", "campaign", "campaign_id"), ("approval", "contact_id", "contact_point", "contact_id"), ("exec_request", "approval_id", "approval", "approval_id"),
        ("provider_attempt", "person_id", "person", "person_id"), ("credit_reservation", "campaign_id", "campaign", "campaign_id"), ("credit_reservation", "exec_request_id", "exec_request", "request_id"),
        ("finder_run", "campaign_id", "campaign", "campaign_id"), ("finder_cursor", "finder_run_id", "finder_run", "finder_run_id"),
        ("enrollment", "campaign_id", "campaign", "campaign_id"), ("enrollment", "person_id", "person", "person_id"),
        ("delivery", "campaign_id", "campaign", "campaign_id"), ("delivery", "enrollment_id", "enrollment", "enrollment_id"), ("delivery", "revision_hash", "revision", "hash"), ("delivery", "contact_id", "contact_point", "contact_id"),
        ("inbound", "enrollment_id", "enrollment", "enrollment_id"), ("reply_revision", "inbound_id", "inbound", "inbound_id"), ("reply_revision", "campaign_id", "campaign", "campaign_id"), ("reply_revision", "contact_id", "contact_point", "contact_id"), ("relationship", "person_id", "person", "person_id"),
    }
    assert actual == expected
    assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize(
    ("statement", "parameters"),
    (
        ("INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)", ("c1", "Synthetic Company", "unknown", "synthetic-company")),
        ("INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key) VALUES(?,?,?,?,?)", ("c1", "Synthetic Company", "http://example.test", "manual", "synthetic-company")),
        ("INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)", ("p1", "Casey", "Casey Example", "unknown", "casey")),
        ("INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)", ("o1", "unknown", "p1", "title", '\"Associate\"', "synthetic", "2026-09-03T00:00:00Z", 1.0)),
        ("INSERT INTO merge_review(review_id,entity_type,candidate_ids,observation_ids,reason,state) VALUES(?,?,?,?,?,?)", ("m1", "person", "[]", "[]", "test", "unknown")),
        ("INSERT INTO contact_point(contact_id,person_id,email,provider,adapter_version,state,confidence) VALUES(?,?,?,?,?,?,?)", ("cp1", "missing", "safe" + chr(64) + "example.test", "unknown", "v1", "valid", 1.0)),
        ("INSERT INTO provider_attempt(attempt_id,person_id,provider,call,input_hash,priority,credits,result,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?)", ("pa1", "missing", "unknown", "lookup", "a" * 64, 0, 0, "error", "t", "t")),
        ("INSERT INTO finder_run(finder_run_id,campaign_id,policy_hash,requested_companies,requested_people,state,updated_at) VALUES(?,?,?,?,?,?,?)", ("fr1", "missing", "a" * 64, -1, 0, "queued", "t")),
        ("INSERT INTO suppression(suppression_id,scope,subject_key,reason,created_at,created_by) VALUES(?,?,?,?,?,?)", ("s1", "unknown", "x", "manual_dnc", "t", "human")),
    ),
)
def test_04_schema_check_rejects_bad_enum(statement: str, parameters: tuple[object, ...]) -> None:
    connection = _schema_connection()
    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
        connection.execute(statement, parameters)


@pytest.mark.parametrize("provider", ("apify", "hdw"))
def test_04a_schema_provider_checks_allow_class_c_adapters(provider: str) -> None:
    connection = _schema_connection()
    connection.execute("PRAGMA foreign_keys=OFF")
    statements = (
        (
            "INSERT INTO contact_point(contact_id,person_id,email,provider,adapter_version,state,confidence) VALUES(?,?,?,?,?,?,?)",
            ("cp-" + provider, "person", provider + chr(64) + "example.test", provider, "v1", "valid", 1.0),
        ),
        (
            "INSERT INTO provider_attempt(attempt_id,person_id,provider,call,input_hash,priority,credits,result,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            ("pa-" + provider, "person", provider, "lookup", "a" * 64, 0, 0, "not_found", "t", "t"),
        ),
        (
            "INSERT INTO credit_reservation(reservation_id,campaign_id,provider,exec_request_id,max_cost,state,created_at) VALUES(?,?,?,?,?,?,?)",
            ("cr-" + provider, "campaign", provider, "request-" + provider, 0, "reserved", "t"),
        ),
    )
    for statement, parameters in statements:
        connection.execute(statement, parameters)


@pytest.mark.parametrize("provider", ("linkedin", "clay"))
def test_04aa_schema_provider_checks_reject_unapproved_adapters(provider: str) -> None:
    connection = _schema_connection()
    statements = (
        (
            "INSERT INTO contact_point(contact_id,person_id,email,provider,adapter_version,state,confidence) VALUES(?,?,?,?,?,?,?)",
            ("cp-" + provider, "person", provider + chr(64) + "example.test", provider, "v1", "valid", 1.0),
        ),
        (
            "INSERT INTO provider_attempt(attempt_id,person_id,provider,call,input_hash,priority,credits,result,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            ("pa-" + provider, "person", provider, "lookup", "a" * 64, 0, 0, "not_found", "t", "t"),
        ),
        (
            "INSERT INTO credit_reservation(reservation_id,campaign_id,provider,exec_request_id,max_cost,state,created_at) VALUES(?,?,?,?,?,?,?)",
            ("cr-" + provider, "campaign", provider, "request-" + provider, 0, "reserved", "t"),
        ),
    )
    for statement, parameters in statements:
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
            connection.execute(statement, parameters)


def test_04b_schema_cross_row_triggers_and_campaign_tranche() -> None:
    schema = SCHEMA.read_text(encoding="utf-8")
    for trigger in ("campaign_activate_requires_approval", "campaign_sales_no_activate", "approval_campaign_policy_insert", "approval_campaign_policy_update", "exec_request_approval_insert", "exec_request_approval_update", "employment_overlap_review", "one_valid_contact_per_person"):
        assert trigger in schema
    connection = _schema_connection()
    connection.execute("INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)", ("sender", "Synthetic", None, "focus", "background", "proof", "[]"))
    campaign = ("campaign", "networking", "sender", "{}", "informational_call", 15, "direct", "networking-v1", "[]", "09:00-17:00", "America/New_York", 25, 6, 2, "T1", "mailbox", "{}", 0, "draft", "a" * 64)
    connection.execute("INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", campaign)
    with pytest.raises(sqlite3.IntegrityError, match="approved"):
        connection.execute("UPDATE campaign SET status='active' WHERE campaign_id='campaign'")
    sales = list(campaign)
    sales[0], sales[1] = "sales-campaign", "sales"
    connection.execute("INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", sales)
    with pytest.raises(sqlite3.IntegrityError, match="sales activation"):
        connection.execute("UPDATE campaign SET status='active' WHERE campaign_id='sales-campaign'")
    with pytest.raises(sqlite3.IntegrityError, match="approval applicability"):
        connection.execute("INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,created_at,state) VALUES(?,?,?,?,?,?,?)", ("request", "campaigner", "gmail_send", "{}", "a" * 64, "t", "queued"))
    connection.execute("INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)", ("company-1", "Synthetic 1", "manual", "synthetic-1"))
    connection.execute("INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)", ("person", "Casey", "Casey Example", "manual", "casey"))
    connection.execute("INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)", ("observation-1", "employment", "employment-1", "title", '\"Associate\"', "synthetic", "t", 1.0))
    connection.execute("INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)", ("employment-1", "person", "company-1", "Associate", None, None, "observation-1", 1.0))
    connection.execute("INSERT INTO contact_point(contact_id,person_id,email,provider,adapter_version,state,confidence) VALUES(?,?,?,?,?,?,?)", ("contact-1", "person", "one" + chr(64) + "example.test", "manual", "v1", "valid", 1.0))
    connection.execute("INSERT INTO reply_template VALUES(?,?,?,?)", ("reply-template", 1, "c" * 64, "t"))

    def insert_approval(approval_id: str, *, policy_hash: str = "a" * 64, approver: str = "human", expires_at: str = "2999-01-01T00:00:00Z", consumed_at: str | None = None) -> None:
        connection.execute(
            "INSERT INTO approval VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (approval_id, "assertion-" + approval_id, "campaign", policy_hash, "reply_template", "c" * 64,
             "contact-1", "mailbox", approver, "t", expires_at, "T1", "{}", "nonce-" + approval_id,
             "send_preapproved_reply_template", consumed_at, "scope-" + approval_id + "x" * (64 - len("scope-" + approval_id)), None),
        )

    insert_approval("mismatched")
    insert_approval("expired", expires_at="2000-01-01T00:00:00Z")
    insert_approval("agent", approver="agent:builder")
    insert_approval("consumed", consumed_at="2026-09-03T00:00:00Z")
    for approval_id, policy_hash in (("mismatched", "b" * 64), ("expired", "a" * 64), ("agent", "a" * 64), ("consumed", "a" * 64)):
        with pytest.raises(sqlite3.IntegrityError, match="approval applicability"):
            connection.execute("INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,approval_id,created_at,state) VALUES(?,?,?,?,?,?,?,?)", ("request-" + approval_id, "campaigner", "gmail_send", "{}", policy_hash, approval_id, "t", "queued"))
    insert_approval("valid")
    connection.execute("INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,approval_id,created_at,state) VALUES(?,?,?,?,?,?,?,?)", ("request-valid", "campaigner", "gmail_send", "{}", "a" * 64, "valid", "t", "queued"))
    assert connection.execute("SELECT policy_hash FROM approval WHERE approval_id='valid'").fetchone()[0] == connection.execute("SELECT policy_hash FROM exec_request WHERE request_id='request-valid'").fetchone()[0]
    connection.execute("UPDATE campaign SET status='approved' WHERE campaign_id='campaign'")
    with pytest.raises(sqlite3.IntegrityError, match="current human approval"):
        connection.execute("UPDATE campaign SET status='active' WHERE campaign_id='campaign'")
    connection.execute(
        "INSERT INTO approval VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("campaign-policy", "assertion-campaign", "campaign", "a" * 64,
         "campaign_policy", None, None, None, "human:reviewer",
         "2026-01-01T00:00:00Z", "2999-01-01T00:00:00Z", "T1", "{}",
         "nonce-campaign-policy", "activate_campaign", None, "e" * 64, None),
    )
    connection.execute("UPDATE campaign SET status='active' WHERE campaign_id='campaign'")
    assert connection.execute(
        "SELECT status FROM campaign WHERE campaign_id='campaign'"
    ).fetchone()[0] == "active"

    second_campaign = list(campaign)
    second_campaign[0], second_campaign[-1] = "campaign-2", "b" * 64
    connection.execute("INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", second_campaign)
    connection.execute("INSERT INTO fit_score_version VALUES(?,?,?,?,?,?)", ("score-version", "v1", "{}", "d" * 64, "t", "t"))
    connection.execute("INSERT INTO fit_score VALUES(?,?,?,?,?,?,?)", ("score-a-old", "campaign", "person", "score-version", 10, "{}", "2026-01-01T00:00:00Z"))
    connection.execute("INSERT INTO fit_score VALUES(?,?,?,?,?,?,?)", ("score-a-new", "campaign", "person", "score-version", 20, "{}", "2026-01-02T00:00:00Z"))
    connection.execute("INSERT INTO fit_score VALUES(?,?,?,?,?,?,?)", ("score-b", "campaign-2", "person", "score-version", 90, "{}", "2026-01-03T00:00:00Z"))
    assert [column[0] for column in connection.execute("SELECT * FROM company_tranche").description] == [
        "company_id", "name", "website_url", "linkedin_url", "one_line_summary", "industry", "location", "source_lane",
    ]
    assert [column[0] for column in connection.execute("SELECT * FROM person_tranche").description] == [
        "person_id", "campaign_id", "first_name", "full_name", "title", "company", "linkedin_url", "location", "email",
        "verification_state", "one_line_blurb", "fit_score", "source_lane",
    ]
    assert connection.execute(
        "SELECT pt.person_id FROM person_tranche AS pt JOIN person AS p ON p.person_id = pt.person_id"
    ).fetchall() == [("person",), ("person",)]
    assert connection.execute(
        "SELECT ct.company_id FROM company_tranche AS ct JOIN company AS c ON c.company_id = ct.company_id"
    ).fetchall() == [("company-1",)]
    assert len(connection.execute("SELECT * FROM company_tranche").fetchall()) == 1
    scores_by_campaign = {row[1]: row[11] for row in connection.execute("SELECT * FROM person_tranche").fetchall()}
    assert scores_by_campaign == {"campaign": 20, "campaign-2": 90}
    for index in (1, 2):
        if index == 1:
            continue
        connection.execute("INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)", (f"company-{index}", f"Synthetic {index}", "manual", f"synthetic-{index}"))
    for index in (1, 2):
        if index == 1:
            continue
        connection.execute("INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)", (f"observation-{index}", "employment", f"employment-{index}", "title", '\"Associate\"', "synthetic", "t", 1.0))
        connection.execute("INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)", (f"employment-{index}", "person", f"company-{index}", "Associate", None, None, f"observation-{index}", 1.0))
    assert connection.execute("SELECT count(*) FROM merge_review WHERE reason='overlapping_open_employment'").fetchone()[0] == 1
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE constraint failed"):
        connection.execute("INSERT INTO contact_point(contact_id,person_id,email,provider,adapter_version,state,confidence) VALUES(?,?,?,?,?,?,?)", ("contact-2", "person", "two" + chr(64) + "example.test", "manual", "v1", "valid", 1.0))


def test_05_audit_is_append_only(record_property) -> None:
    connection = _schema_connection()
    connection.execute("INSERT INTO audit(event_id,actor,action,entity_type,entity_id,at,reason) VALUES('a1','human','override','campaign','c1','2026-09-03T00:00:00Z','test')")
    attempts = [("UPDATE audit SET reason='changed' WHERE event_id='a1'",), ("DELETE FROM audit WHERE event_id='a1'",)]
    for (statement,) in attempts:
        with pytest.raises(sqlite3.IntegrityError, match="audit is append-only"):
            connection.execute(statement)
    assert connection.execute("SELECT reason FROM audit").fetchone()[0] == "test"
    record_property("audit_rejections", len(attempts))


def _seed_campaign(
    connection: sqlite3.Connection,
    campaign_id: str = "campaign-1",
    credit_budget: int = 1,
    policy_hash: str = "a" * 64,
) -> None:
    connection.execute(
        "INSERT OR IGNORE INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender-1", "Synthetic Sender", None, "testing", "testing", "proof", "[]"),
    )
    connection.execute(
        """INSERT INTO campaign(
          campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
          template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
          firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (campaign_id, "networking", "sender-1", '{"predicates":[]}',
         "informational_call", 15, "direct", "networking-v1", "[]", "09:00-17:00",
         "America/New_York", 25, 6, 2, "T0", "mailbox-1", "{}", credit_budget,
         "draft", policy_hash),
    )


def test_06_migration_is_idempotent(tmp_path: Path) -> None:
    # Later phases ship schema_p{n}.sql next to schema.sql; the version is 1 + their count.
    phase_migrations = sorted(
        path for path in SCHEMA_PATH.parent.glob("schema_p*.sql")
        if re.fullmatch(r"schema_p\d+\.sql", path.name)
    )
    expected_version = 1 + len(phase_migrations)
    database = tmp_path / "store.sqlite"
    first = open_store(database)
    assert get_schema_version(first) == expected_version
    first.close()
    second = open_store(database)
    assert get_schema_version(second) == expected_version
    assert second.execute("SELECT count(*) FROM schema_version").fetchone()[0] == 1
    assert second.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == len(phase_migrations)
    second.close()


def _migration_schema_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    schema_path = tmp_path / "schema.sql"
    schema_path.write_text(SCHEMA.read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setattr(store_module, "SCHEMA_PATH", schema_path)
    return schema_path


def test_06_phase_migration_is_applied_once_and_updates_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    schema_path = _migration_schema_path(tmp_path, monkeypatch)
    (schema_path.parent / "schema_p9.sql").write_text(
        "CREATE TABLE phase_nine(value TEXT);", encoding="utf-8"
    )
    database = tmp_path / "phase.sqlite"
    first = open_store(database)
    assert get_schema_version(first) == 2
    assert first.execute("SELECT name FROM sqlite_master WHERE name='phase_nine'").fetchone()
    assert first.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == 1
    first.close()
    second = open_store(database)
    assert get_schema_version(second) == 2
    assert second.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == 1
    second.close()


def test_06_modified_phase_migration_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    schema_path = _migration_schema_path(tmp_path, monkeypatch)
    phase_path = schema_path.parent / "schema_p9.sql"
    phase_path.write_text("CREATE TABLE phase_nine(value TEXT);", encoding="utf-8")
    database = tmp_path / "modified.sqlite"
    open_store(database).close()
    phase_path.write_text("CREATE TABLE phase_nine(value INTEGER);", encoding="utf-8")
    with pytest.raises(MigrationError, match="modified_migration"):
        open_store(database)


def test_06_phase_migrations_run_in_numeric_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    schema_path = _migration_schema_path(tmp_path, monkeypatch)
    (schema_path.parent / "schema_p2.sql").write_text(
        "CREATE TABLE phase_order(value INTEGER);", encoding="utf-8"
    )
    (schema_path.parent / "schema_p4.sql").write_text(
        "INSERT INTO phase_order(value) VALUES (4);", encoding="utf-8"
    )
    connection = open_store(tmp_path / "ordered.sqlite")
    assert get_schema_version(connection) == 3
    assert connection.execute("SELECT value FROM phase_order").fetchone()[0] == 4
    assert [row[0] for row in connection.execute(
        "SELECT name FROM schema_migrations ORDER BY applied_at"
    )] == ["schema_p2.sql", "schema_p4.sql"]
    connection.close()


def test_07_foreign_key_rejection(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "fk.sqlite")
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY constraint failed"):
        connection.execute(
            """INSERT INTO contact_point(
               contact_id,person_id,email,provider,adapter_version,state,confidence
               ) VALUES(?,?,?,?,?,?,?)""",
            ("contact-x", "missing", "safe" + chr(64) + "example.test",
             "manual", "v1", "valid", 1.0),
        )


def test_08_two_writer_wal_race_has_no_lost_update(
    tmp_path: Path, record_property
) -> None:
    database = tmp_path / "wal.sqlite"
    setup = open_store(database)
    _seed_campaign(setup)
    setup.execute(
        "INSERT INTO finder_run VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("run-1", "campaign-1", "a" * 64, 1, 2, "running",
         "2026-09-03T00:00:00Z", "2026-09-03T00:00:00Z", None, None),
    )
    setup.execute(
        "INSERT INTO finder_cursor VALUES(?,?,?,?,?,?,?)",
        ("run-1", "manual", None, 0, 0, "v1", "2026-09-03T00:00:00Z"),
    )
    setup.close()
    barrier = threading.Barrier(2)
    failures: list[str] = []

    def increment() -> None:
        writer = open_store(database)
        writer.execute("PRAGMA busy_timeout=5000")
        barrier.wait()
        try:
            writer.execute("BEGIN IMMEDIATE")
            writer.execute(
                "UPDATE finder_cursor SET processed=processed+1 WHERE finder_run_id='run-1'"
            )
            writer.commit()
        except Exception as exc:
            writer.rollback()
            failures.append(type(exc).__name__)
        finally:
            writer.close()

    workers = [threading.Thread(target=increment) for _ in range(2)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=10)
    assert all(not worker.is_alive() for worker in workers)
    check = open_store(database)
    assert check.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    assert failures == []
    assert check.execute(
        "SELECT processed FROM finder_cursor WHERE finder_run_id='run-1'"
    ).fetchone()[0] == 2
    record_property("wal_writers", len(workers) - len(failures))


def test_09_store_path_uses_test_override(tmp_path: Path) -> None:
    target = tmp_path / "override.sqlite"
    assert resolve_store_path({"KB_PROSPECTING_STORE": str(target)}) == target
    fallback = resolve_store_path({"LOCALAPPDATA": str(tmp_path)})
    assert fallback == tmp_path / "kb-prospecting" / "store.sqlite"


@pytest.mark.parametrize(
    ("provider", "allowed"),
    (("apify", True), ("hdw", True), ("linkedin", False), ("clay", False)),
)
def test_09a_vendor_request_provider_validator(provider: str, allowed: bool) -> None:
    request = ExecRequest(
        "req_0123456789abcdef", "prospecting-list-builder", "vendor_lookup",
        {
            "campaign_id": "camp_0123456789abcdef",
            "person_id": "per_0123456789abcdef",
            "provider": provider,
        },
        "a" * 64, None, "2026-09-03T00:00:00Z",
    )
    if allowed:
        assert validate_exec_request(request, "T0") is None
    else:
        with pytest.raises(ValueError, match="provider must be an enumerated code"):
            validate_exec_request(request, "T0")


import json
from dataclasses import replace

from scripts.prospecting.store import (
    Company,
    ContactPoint,
    Employment,
    FitScoreVersion,
    MergeReview,
    Person,
    ProviderAttempt,
    SourceObservation,
    apply_role_change,
    get_company,
    get_contact_point,
    get_employment,
    get_fit_score_version,
    get_merge_review,
    get_person,
    get_person_tranche,
    get_provider_attempt,
    get_source_observation,
    insert_company,
    insert_contact_point,
    insert_employment,
    insert_fit_score_version,
    insert_merge_review,
    insert_person,
    insert_provider_attempt,
    insert_source_observation,
    ingest_observations,
)

FIXTURES = Path(__file__).parents[3] / "orgs" / "prospecting" / "fixtures"


def _objects(connection: sqlite3.Connection) -> tuple[Company, Person, SourceObservation]:
    company = Company("company-1", "Example Test", "https://example.test", None,
                      "Synthetic company", "Testing", "New York, NY", "manual",
                      "example.test")
    person = Person("person-1", "Casey", "Casey Example", None, "New York, NY",
                    "Synthetic person", "manual", "casey|company-1|associate")
    observation = SourceObservation(
        "observation-1", "employment", "employment-1", "title", '"Associate"',
        "synthetic", "2026-09-03", "2026-09-03T00:00:00Z", 1.0, None,
    )
    insert_company(connection, company)
    insert_person(connection, person)
    insert_source_observation(connection, observation)
    return company, person, observation


def test_10_typed_repository_round_trip(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "repo.sqlite")
    _seed_campaign(connection, "campaign-1")
    _seed_campaign(connection, "campaign-2")
    company, person, observation = _objects(connection)
    contact = ContactPoint(
        "contact-1", person.person_id, company.company_id,
        "casey" + chr(64) + "example.test",
        "manual", "v1", "2026-09-03T00:00:00Z", "2026-09-03T00:00:00Z",
        "valid", 1.0, 0,
    )
    insert_contact_point(connection, contact)
    employment = Employment(
        "employment-1", person.person_id, company.company_id, "Associate",
        "2025-01-01", None, "observation-1", 1.0,
    )
    insert_employment(connection, employment)
    review = MergeReview(
        "review-round-trip", "person", ("person-1", "person-2"),
        ("observation-1",), "synthetic_conflict",
    )
    insert_merge_review(connection, review)
    attempt = ProviderAttempt(
        "attempt-1", person.person_id, "hunter", "lookup-v1", "a" * 64,
        0, 0, "not_found", "2026-09-03T00:00:00Z", "2026-09-03T00:00:01Z",
    )
    insert_provider_attempt(connection, attempt)
    score_version = FitScoreVersion(
        "score-version-1", "v1", "{}", "b" * 64,
        "2026-09-03T00:00:00Z", "2026-09-03T00:00:00Z",
    )
    insert_fit_score_version(connection, score_version)
    connection.execute(
        "INSERT INTO fit_score VALUES(?,?,?,?,?,?,?)",
        ("fit-0", "campaign-1", person.person_id, score_version.fit_score_version_id,
         5, "{}", "2026-09-02T00:00:00Z"),
    )
    connection.execute(
        "INSERT INTO fit_score VALUES(?,?,?,?,?,?,?)",
        ("fit-1", "campaign-1", person.person_id, score_version.fit_score_version_id,
         25, "{}", "2026-09-03T00:00:00Z"),
    )
    connection.execute(
        "INSERT INTO fit_score VALUES(?,?,?,?,?,?,?)",
        ("fit-2", "campaign-2", person.person_id, score_version.fit_score_version_id,
         90, "{}", "2026-09-03T00:01:00Z"),
    )
    assert get_company(connection, company.company_id) == company
    assert get_person(connection, person.person_id) == person
    assert get_contact_point(connection, contact.contact_id) == contact
    assert get_source_observation(connection, observation.observation_id) == observation
    assert get_employment(connection, employment.employment_id) == employment
    assert get_merge_review(connection, review.review_id) == review
    assert get_provider_attempt(connection, attempt.attempt_id) == attempt
    assert get_fit_score_version(connection, score_version.fit_score_version_id) == score_version
    first = get_person_tranche(connection, "campaign-1")
    second = get_person_tranche(connection, "campaign-2")
    assert len(first) == len(second) == 1
    assert first[0]["fit_score"] == 25
    assert second[0]["fit_score"] == 90


def test_11_source_observation_cannot_change(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "immutable.sqlite")
    _, _, observation = _objects(connection)
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        connection.execute(
            "UPDATE source_observation SET confidence=.5 WHERE observation_id=?",
            (observation.observation_id,),
        )


def test_12_job_change_is_one_transaction(tmp_path: Path) -> None:
    case = json.loads((FIXTURES / "job-change.json").read_text(encoding="utf-8"))
    connection = open_store(tmp_path / "job.sqlite")
    old_company, person, old_observation = _objects(connection)
    new_company = Company(**case["new_company"])
    insert_company(connection, new_company)
    old_employment = Employment(
        "employment-1", person.person_id, old_company.company_id, "Associate",
        "2025-01-01", None, old_observation.observation_id, 1.0,
    )
    insert_employment(connection, old_employment)
    contact = ContactPoint(
        "contact-1", person.person_id, old_company.company_id,
        "casey" + chr(64) + "example.test",
        "manual", "v1", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
        "valid", 1.0, 0,
    )
    insert_contact_point(connection, contact)
    observations = tuple(SourceObservation(**item) for item in case["observations"])
    new_employment = Employment(**case["new_employment"])
    stale_count = apply_role_change(
        connection, old_employment.employment_id, old_company.company_id,
        new_employment, observations, case["changed_at"],
    )
    assert stale_count == 1
    assert get_contact_point(connection, "contact-1").state == "stale"
    assert connection.execute(
        "SELECT valid_to FROM employment WHERE employment_id='employment-1'"
    ).fetchone()[0] == case["changed_at"]
    assert connection.execute("SELECT count(*) FROM source_observation").fetchone()[0] == 3

    rollback = open_store(tmp_path / "job-rollback.sqlite")
    rollback_old_company, rollback_person, rollback_old_observation = _objects(rollback)
    insert_company(rollback, new_company)
    rollback_old = replace(
        old_employment,
        person_id=rollback_person.person_id,
        company_id=rollback_old_company.company_id,
        source_observation_id=rollback_old_observation.observation_id,
    )
    insert_employment(rollback, rollback_old)
    insert_contact_point(rollback, contact)

    def fail_after_close() -> None:
        raise RuntimeError("injected after old-role close")

    with pytest.raises(RuntimeError, match="injected"):
        apply_role_change(
            rollback, rollback_old.employment_id, rollback_old_company.company_id,
            new_employment, observations, case["changed_at"], after_close=fail_after_close,
        )
    assert get_employment(rollback, rollback_old.employment_id).valid_to is None
    assert get_contact_point(rollback, "contact-1").state == "valid"
    assert rollback.execute(
        "SELECT count(*) FROM employment WHERE employment_id='employment-2'"
    ).fetchone()[0] == 0
    assert rollback.execute(
        "SELECT count(*) FROM source_observation"
    ).fetchone()[0] == 1


def test_12_job_change_rejects_mismatched_old_company(tmp_path: Path) -> None:
    case = json.loads((FIXTURES / "job-change.json").read_text(encoding="utf-8"))
    connection = open_store(tmp_path / "job-mismatched-company.sqlite")
    old_company, person, old_observation = _objects(connection)
    new_company = Company(**case["new_company"])
    insert_company(connection, new_company)
    old_employment = Employment(
        "employment-1", person.person_id, old_company.company_id, "Associate",
        "2025-01-01", None, old_observation.observation_id, 1.0,
    )
    insert_employment(connection, old_employment)
    contact = ContactPoint(
        "contact-1", person.person_id, old_company.company_id,
        "casey" + chr(64) + "example.test",
        "manual", "v1", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
        "valid", 1.0, 0,
    )
    insert_contact_point(connection, contact)

    with pytest.raises(ValueError, match="old employment is not open"):
        apply_role_change(
            connection, old_employment.employment_id, new_company.company_id,
            Employment(**case["new_employment"]),
            tuple(SourceObservation(**item) for item in case["observations"]),
            case["changed_at"],
        )

    assert get_employment(connection, old_employment.employment_id).valid_to is None
    assert get_contact_point(connection, "contact-1").state == "valid"


def test_12_job_change_rejects_cross_person_old_employment(tmp_path: Path) -> None:
    case = json.loads((FIXTURES / "job-change.json").read_text(encoding="utf-8"))
    connection = open_store(tmp_path / "job-cross-person.sqlite")
    old_company, person, old_observation = _objects(connection)
    new_company = Company(**case["new_company"])
    insert_company(connection, new_company)
    insert_employment(connection, Employment(
        "employment-1", person.person_id, old_company.company_id, "Associate",
        "2025-01-01", None, old_observation.observation_id, 1.0,
    ))
    connection.execute(
        "INSERT INTO person VALUES(?,?,?,?,?,?,?,?)",
        ("person-2", "Taylor", "Taylor Synthetic", None, None, None, "manual", "taylor"),
    )
    new_employment = replace(Employment(**case["new_employment"]), person_id="person-2")
    with pytest.raises(ValueError, match="old employment is not open"):
        apply_role_change(
            connection, "employment-1", old_company.company_id, new_employment,
            tuple(SourceObservation(**item) for item in case["observations"]), case["changed_at"],
        )
    assert get_employment(connection, "employment-1").valid_to is None
    assert connection.execute("SELECT count(*) FROM employment").fetchone()[0] == 1


@pytest.fixture
def _assert_provider_conflict_sqlite(monkeypatch):
    original_open_store = open_store
    connections = []

    def tracking_open_store(*args, **kwargs):
        connection = original_open_store(*args, **kwargs)
        connections.append(connection)
        return connection

    monkeypatch.setitem(globals(), "open_store", tracking_open_store)
    yield

    case = json.loads(
        (FIXTURES / "conflicting-providers.json").read_text(encoding="utf-8")
    )
    expected = case["merge_review"]
    assert len(connections) == 1
    row = connections[0].execute(
        "SELECT entity_type, candidate_ids, observation_ids, reason, state FROM merge_review"
    ).fetchone()
    assert row is not None
    assert row["entity_type"] == expected["entity_type"]
    assert json.loads(row["candidate_ids"]) == expected["candidate_ids"]
    assert json.loads(row["observation_ids"]) == expected["observation_ids"]
    assert row["reason"] == expected["reason"]
    assert row["state"] == expected["state"]


@pytest.mark.usefixtures("_assert_provider_conflict_sqlite")
def test_13_conflicting_providers_create_review(tmp_path: Path) -> None:
    case = json.loads(
        (FIXTURES / "conflicting-providers.json").read_text(encoding="utf-8")
    )
    connection = open_store(tmp_path / "conflict.sqlite")
    _objects(connection)
    review = ingest_observations(
        connection,
        tuple(SourceObservation(**item) for item in case["observations"]),
        tuple(case["merge_review"]["candidate_ids"]),
    )
    assert review is not None
    row = connection.execute(
        "SELECT state, observation_ids FROM merge_review WHERE review_id=?",
        (review.review_id,),
    ).fetchone()
    assert row["state"] == "open"
    assert json.loads(row["observation_ids"]) == list(review.observation_ids)
    assert connection.execute("SELECT count(*) FROM source_observation").fetchone()[0] == 3


from scripts.prospecting.store import (
    CreditReservation,
    get_credit_reservation,
    release_credit,
    reserve_credit,
    settle_credit,
)


def _seed_requests(connection: sqlite3.Connection, count: int = 2) -> None:
    for index in range(count):
        connection.execute(
            """INSERT INTO exec_request(
               request_id,caller,operation,payload,policy_hash,approval_id,created_at,state
               ) VALUES(?,?,?,?,?,?,?,?)""",
            (f"request-{index}", "prospecting-list-builder", "vendor_lookup",
             '{"campaign_id":"campaign-1","person_id":"person-1","provider":"hunter"}', "a" * 64, None,
             "2026-09-03T00:00:00Z", "queued"),
        )


def test_14_two_workers_one_credit_allows_one_reservation(tmp_path: Path) -> None:
    database = tmp_path / "credit.sqlite"
    setup = open_store(database)
    _seed_campaign(setup, credit_budget=1)
    _seed_requests(setup)
    setup.close()
    barrier = threading.Barrier(2)
    outcomes: list[bool] = []

    def attempt(index: int) -> None:
        connection = open_store(database)
        barrier.wait()
        outcomes.append(reserve_credit(connection, CreditReservation(
            f"reservation-{index}", "campaign-1", "hunter", f"request-{index}",
            1, None, "reserved", "2026-09-03T00:00:00Z", None,
        )))
        connection.close()

    workers = [threading.Thread(target=attempt, args=(index,)) for index in range(2)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=10)
    check = open_store(database)
    assert sorted(outcomes) == [False, True]
    assert check.execute("SELECT count(*) FROM credit_reservation").fetchone()[0] == 1


def test_14_credit_reservation_rejects_cross_campaign_and_charges_request_campaign(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "credit-campaign-binding.sqlite")
    _seed_campaign(connection, "campaign-1", credit_budget=1, policy_hash="a" * 64)
    _seed_campaign(connection, "campaign-2", credit_budget=5, policy_hash="b" * 64)
    _seed_requests(connection, count=2)
    mismatched = CreditReservation(
        "reservation-mismatch", "campaign-2", "hunter", "request-0", 1, None,
        "reserved", "2026-09-03T00:00:00Z", None,
    )
    with pytest.raises(ValueError, match="campaign mismatch"):
        reserve_credit(connection, mismatched)
    assert connection.execute("SELECT count(*) FROM credit_reservation").fetchone()[0] == 0
    bound = replace(mismatched, reservation_id="reservation-bound", campaign_id="campaign-1")
    assert reserve_credit(connection, bound)
    assert connection.execute(
        "SELECT campaign_id FROM credit_reservation WHERE reservation_id='reservation-bound'"
    ).fetchone()[0] == "campaign-1"


def test_15_credit_settle_release_and_overage(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "credit-states.sqlite")
    _seed_campaign(connection, credit_budget=3)
    _objects(connection)
    _seed_requests(connection, count=3)
    first = CreditReservation("r1", "campaign-1", "hunter", "request-0", 1, None,
                              "reserved", "2026-09-03T00:00:00Z", None)
    second = replace(first, reservation_id="r2", exec_request_id="request-1")
    third = replace(first, reservation_id="r3", exec_request_id="request-2")
    assert reserve_credit(connection, first)
    assert reserve_credit(connection, second)
    assert reserve_credit(connection, third)
    assert settle_credit(connection, "r1", 1, "2026-09-03T00:01:00Z") == "settled"
    release_credit(connection, "r2", "2026-09-03T00:01:00Z")
    assert settle_credit(connection, "r3", 2, "2026-09-03T00:01:00Z") == "overage_error"
    rows = dict(connection.execute(
        "SELECT reservation_id,state FROM credit_reservation"
    ).fetchall())
    assert rows == {"r1": "settled", "r2": "released", "r3": "overage_error"}
    assert get_credit_reservation(connection, "r1").actual_cost == 1
    assert connection.execute(
        "SELECT status FROM campaign WHERE campaign_id='campaign-1'"
    ).fetchone()[0] == "paused"
    attempts = connection.execute(
        "SELECT call,result FROM provider_attempt ORDER BY call"
    ).fetchall()
    assert [tuple(row) for row in attempts] == [
        ("credit_overage", "error"), ("credit_release", "skipped_budget")
    ]
    assert connection.execute(
        "SELECT count(*) FROM audit WHERE action='adapter_disabled'"
    ).fetchone()[0] == 1
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        connection.execute("UPDATE provider_attempt SET credits=9")


def test_20_two_word_overrides_each_write_audit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import scripts.prospecting.cli as cli_module

    connection = open_store(tmp_path / "overrides.sqlite")
    campaign_id = "camp_1111111111111111"
    person_id = "per_1111111111111111"
    _seed_campaign(connection, campaign_id)
    _objects(connection)
    connection.execute(
        "INSERT INTO person VALUES(?,?,?,?,?,?,?,?)",
        (person_id, "Taylor", "Taylor Synthetic", None, None, None, "manual", "taylor"),
    )
    verbs = (
        ("dnc", person_id, {"reason": "manual_dnc"}),
        ("note", person_id, {"note": "Synthetic-local-note"}),
        ("status", campaign_id, {"status": "paused"}),
        ("veto", person_id, {"campaign_id": campaign_id}),
    )
    event_ids = {
        apply_override(connection, verb, operand, "2026-09-03T00:00:00Z", **options)
        for verb, operand, options in verbs
    }
    assert len(event_ids) == 4
    assert connection.execute("SELECT count(*) FROM audit").fetchone()[0] == 4
    assert connection.execute(
        "SELECT status FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()[0] == "paused"
    assert connection.execute("SELECT insights FROM relationship").fetchone()[0] == "Synthetic-local-note"
    assert connection.execute("SELECT count(*) FROM suppression").fetchone()[0] == 1
    assert connection.execute("SELECT actor FROM audit LIMIT 1").fetchone()[0].startswith("human:")
    assert connection.execute(
        "SELECT active FROM fit_veto WHERE person_id=? AND campaign_id=?",
        (person_id, campaign_id),
    ).fetchone()[0] == 1
    with pytest.raises((ValueError, sqlite3.IntegrityError), match="approved"):
        apply_override(connection, "status", campaign_id, "2026-09-03T00:00:01Z",
                       status="active")
    with pytest.raises(KeyError):
        apply_override(connection, "veto", "per_9999999999999999", "2026-09-03T00:00:02Z",
                       campaign_id=campaign_id)
    monkeypatch.setattr(cli_module, "_human_actor", lambda: "agent:x")
    with pytest.raises(ValueError, match="human"):
        apply_override(connection, "note", person_id, "2026-09-03T00:00:03Z",
                       note="Synthetic-local-note")
    connection.close()
    received: dict[str, str | None] = {}
    monkeypatch.setattr(cli_module, "open_store", lambda: sqlite3.connect(":memory:"))
    monkeypatch.setattr(cli_module, "apply_override", lambda *args, **kwargs: (
        received.update(note=kwargs["note"]), "req_0123456789abcdef"
    )[1])
    monkeypatch.setattr(cli_module.sys, "stdin", type("Stdin", (), {
        "read": lambda self: "Synthetic-local-note"
    })())
    assert cli_module.main(["note", "per_0123456789abcdef"]) == 0
    assert received == {"note": "Synthetic-local-note"}

    accessed_store = False

    def should_not_open_store() -> sqlite3.Connection:
        nonlocal accessed_store
        accessed_store = True
        raise AssertionError("invalid operand opened the database")

    monkeypatch.setattr(cli_module, "open_store", should_not_open_store)
    with pytest.raises(SystemExit):
        cli_module.main(["note", SYNTHETIC["person_email"]])
    assert not accessed_store


def test_20_campaign_activation_requires_campaign_policy_approval(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "activation.sqlite")
    campaign_id = "camp_2222222222222222"
    _seed_campaign(connection, campaign_id)
    connection.execute(
        "UPDATE campaign SET status='approved',approval_tier='T1' WHERE campaign_id=?",
        (campaign_id,),
    )
    company, person, _ = _objects(connection)
    insert_contact_point(connection, ContactPoint(
        "contact-activation", person.person_id, company.company_id,
        "activation" + chr(64) + "example.test", "manual", "v1", None, None,
        "valid", 1.0, 0,
    ))
    connection.execute("INSERT INTO reply_template VALUES(?,?,?,?)", (
        "template-activation", 1, "c" * 64, "2026-01-01T00:00:00Z",
    ))
    connection.execute(
        "INSERT INTO approval VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("approval-revision", "assertion-revision", campaign_id, "a" * 64,
         "reply_template", "c" * 64, "contact-activation", "mailbox-1",
         "human:reviewer", "2026-01-01T00:00:00Z", "2999-01-01T00:00:00Z",
         "T1", "{}", "nonce-revision", "send_preapproved_reply_template", None,
         "c" * 64, None),
    )
    with pytest.raises(ValueError, match="current human approval"):
        apply_override(
            connection, "status", campaign_id, "2026-09-03T00:00:00Z", status="active"
        )
    connection.execute(
        "INSERT INTO approval VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("approval-campaign", "assertion-campaign", campaign_id, "a" * 64,
         "campaign_policy", None, None, None, "human:reviewer",
         "2026-01-01T00:00:00Z", "2999-01-01T00:00:00Z", "T1", "{}",
         "nonce-campaign", "activate_campaign", None, "d" * 64, None),
    )
    apply_override(
        connection, "status", campaign_id, "2026-09-03T00:00:01Z", status="active"
    )
    assert connection.execute(
        "SELECT status FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()[0] == "active"


def test_21_export_is_timestamped_and_has_no_import_surface(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    connection = open_store(tmp_path / "export.sqlite")
    company, person, _ = _objects(connection)
    opaque_company_id = "cmp_1111111111111111"
    opaque_person_id = "per_1111111111111111"
    connection.execute(
        "UPDATE company SET company_id=? WHERE company_id=?",
        (opaque_company_id, company.company_id),
    )
    connection.execute(
        "UPDATE person SET person_id=? WHERE person_id=?",
        (opaque_person_id, person.person_id),
    )
    connection.execute(
        "INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)",
        ("employment-export", opaque_person_id, opaque_company_id, "Associate", None, None, "observation-1", 1.0),
    )
    with tempfile.TemporaryDirectory(prefix="kb-prospecting-export-") as local_data:
        local_path = Path(local_data)
        monkeypatch.setenv("LOCALAPPDATA", str(local_path))
        path = export_csv(connection, "company_tranche", "20260903T120000Z")
        export_root = local_path / "kb-prospecting" / "exports"
        assert path.parent == export_root
        assert path.name == "company_tranche-20260903T120000Z.csv"
        lines = path.read_text(encoding="utf-8").splitlines()
        assert lines[0] == "# kb-prospecting-one-way-export reimport=false"
        assert lines[1].split(",")[0] == "company_id"
        assert opaque_company_id in lines[2]
        assert company.name in lines[2]
        person_path = export_csv(connection, "person_tranche", "20260903T120000Z")
        person_lines = person_path.read_text(encoding="utf-8").splitlines()
        assert person_lines[1].split(",")[0] == "person_id"
        assert opaque_person_id in person_lines[2]
        for invalid_timestamp in ("Z", "123"):
            with pytest.raises(ValueError, match="timestamp"):
                export_csv(connection, "company_tranche", invalid_timestamp)
        monkeypatch.setattr(export_module, "EXPORT_VIEWS", frozenset({"../outside"}))
        with pytest.raises(ValueError, match="within the export root"):
            export_csv(connection, "../outside", "20260903T120000Z")
        monkeypatch.setenv("KB_PROSPECTING_EXPORT_DIR", str(local_path / "ignored"))
        assert export_module._export_root() == export_root
    public_callables = {
        name for name, value in inspect.getmembers(export_module)
        if not name.startswith("_") and callable(value)
    }
    assert public_callables == {"Path", "export_csv"}


def test_21_export_rejects_unc_symlink_and_repository_roots(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LOCALAPPDATA", r"\\server\share")
    with pytest.raises(ValueError, match="UNC"):
        export_module._export_root()
    with tempfile.TemporaryDirectory(prefix="kb-prospecting-link-") as temporary:
        root = Path(temporary)
        local_app_data = root / "local-app-data"
        local_app_data.mkdir()
        with monkeypatch.context() as context:
            context.setenv("LOCALAPPDATA", str(local_app_data))
            context.setattr(
                Path, "is_symlink", lambda path: path == local_app_data
            )
            with pytest.raises(ValueError, match="symlinked"):
                export_module._export_root()
    monkeypatch.setenv("LOCALAPPDATA", str(Path(__file__).parents[3] / "local-data"))
    with pytest.raises(ValueError, match="repository"):
        export_module._export_root()


def test_16_credit_reservation_must_start_reserved_and_unsettled(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "credit-new-state.sqlite")
    _seed_campaign(connection)
    _seed_requests(connection)
    reservation = CreditReservation(
        "released", "campaign-1", "hunter", "request-0", 1, None,
        "released", "2026-09-03T00:00:00Z", None,
    )
    with pytest.raises(ValueError, match="unsettled and reserved"):
        reserve_credit(connection, reservation)
    assert connection.execute("SELECT count(*) FROM credit_reservation").fetchone()[0] == 0


def test_17_credit_reservation_requires_queued_request(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "credit-request-state.sqlite")
    _seed_campaign(connection)
    _seed_requests(connection)
    connection.execute("UPDATE exec_request SET state='succeeded' WHERE request_id='request-0'")
    reservation = CreditReservation(
        "completed-request", "campaign-1", "hunter", "request-0", 1, None,
        "reserved", "2026-09-03T00:00:00Z", None,
    )
    with pytest.raises(ValueError, match="not queued"):
        reserve_credit(connection, reservation)


def test_18_unicode_credit_reservation_ids_settle_and_release(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "credit-unicode.sqlite")
    _seed_campaign(connection, credit_budget=2)
    _objects(connection)
    _seed_requests(connection)
    settled = CreditReservation(
        "r\u00e9serv\u00e9", "campaign-1", "hunter", "request-0", 1, None,
        "reserved", "2026-09-03T00:00:00Z", None,
    )
    released = replace(settled, reservation_id="r\u00e9serv\u00e9-l\u00e2ch\u00e9", exec_request_id="request-1")
    assert reserve_credit(connection, settled)
    assert reserve_credit(connection, released)
    assert settle_credit(connection, settled.reservation_id, 1, "2026-09-03T00:01:00Z") == "settled"
    release_credit(connection, released.reservation_id, "2026-09-03T00:01:00Z")
    assert get_credit_reservation(connection, settled.reservation_id).state == "settled"
    assert get_credit_reservation(connection, released.reservation_id).state == "released"


def test_19_credit_costs_must_be_exact_ints_and_respect_budget(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "credit-costs.sqlite")
    _seed_campaign(connection, credit_budget=1)
    _seed_requests(connection)
    float_cost = CreditReservation(
        "fraction-0", "campaign-1", "hunter", "request-0", 0.6, None,
        "reserved", "2026-09-03T00:00:00Z", None,
    )
    with pytest.raises(ValueError, match="max_cost"):
        reserve_credit(connection, float_cost)
    with pytest.raises(ValueError, match="max_cost"):
        reserve_credit(connection, replace(float_cost, reservation_id="fraction-1", exec_request_id="request-1"))
    first = replace(float_cost, reservation_id="integer-0", max_cost=1)
    second = replace(first, reservation_id="integer-1", exec_request_id="request-1")
    assert reserve_credit(connection, first)
    assert not reserve_credit(connection, second)
    with pytest.raises(ValueError, match="actual_cost"):
        settle_credit(connection, first.reservation_id, 0.6, "2026-09-03T00:01:00Z")


def _datasette_process(database: Path, port: int) -> subprocess.Popen[bytes]:
    environment = {**os.environ, "KB_PROSPECTING_NO_NETWORK": "1"}
    startup = database.parent / "guarded-startup"
    startup.mkdir(exist_ok=True)
    (startup / "sitecustomize.py").write_text(
        "from scripts.prospecting import install_no_network_guard\n"
        "install_no_network_guard()\n",
        encoding="utf-8",
    )
    environment["PYTHONPATH"] = os.pathsep.join(
        (str(startup), str(Path(__file__).parents[3]), environment.get("PYTHONPATH", ""))
    )
    command = [
        sys.executable, "-m", "datasette", "--host", "127.0.0.1",
        "--port", str(port), "--immutable", str(database),
    ]
    assert environment["KB_PROSPECTING_NO_NETWORK"] == "1"
    process = subprocess.Popen(
        command,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    assert process.args == command
    return process


def _wait_for_datasette(url: str) -> None:
    deadline = time.monotonic() + 15
    while True:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                assert response.status == 200
            return
        except (urllib.error.URLError, ConnectionError):
            if time.monotonic() >= deadline:
                raise AssertionError("Datasette did not become ready")
            time.sleep(0.1)


def test_22_datasette_launcher_is_localhost_and_immutable(tmp_path: Path) -> None:
    database = tmp_path / "launcher.sqlite"
    open_store(database).close()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = _datasette_process(database, port)
    try:
        _wait_for_datasette(f"http://127.0.0.1:{port}/{database.stem}.json")
        assert "--host" in process.args and "127.0.0.1" in process.args
        assert "--immutable" in process.args and "0.0.0.0" not in process.args
    finally:
        process.kill()
        process.wait(timeout=10)
    assert process.poll() is not None


def test_24_launcher_script_serves_readonly(tmp_path: Path) -> None:
    import socket
    import time
    import urllib.error
    import urllib.parse
    import urllib.request

    database = tmp_path / "launcher.sqlite"
    connection = open_store(database)
    connection.close()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]

    environment = {**os.environ, "KB_PROSPECTING_NO_NETWORK": "1"}
    launcher = Path(__file__).parents[3] / "scripts" / "prospecting" / "serve_datasette.ps1"
    process = subprocess.Popen(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(launcher),
            "-Store",
            str(database),
            "-Port",
            str(port),
            "-PythonExecutable",
            sys.executable,
        ],
        env=environment,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    try:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if process.poll() is not None:
                pytest.fail(f"Datasette launcher exited with {process.returncode}")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            pytest.fail("Datasette launcher did not listen within 20 seconds")

        base = f"http://127.0.0.1:{port}/{database.stem}"
        with urllib.request.urlopen(
            f"{base}.json", timeout=5
        ) as response:
            assert response.status == 200
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(
                f"{base}?sql={urllib.parse.quote('CREATE TABLE blocked(id INTEGER)', safe='')}",
                timeout=5,
            )
        body = error.value.read().decode("utf-8", "replace").casefold()
        assert 400 <= error.value.code < 500
        assert any(marker in body for marker in (
            "read-only", "readonly", "immutable", "statement must be a select"
        ))
    finally:
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(process.pid)],
            check=False,
            capture_output=True,
        )
        process.wait(timeout=10)
        with socket.socket() as probe:
            probe.settimeout(1)
            assert probe.connect_ex(("127.0.0.1", port)) != 0


def test_23_datasette_accepts_20_reads_rejects_10_writes(
    tmp_path: Path, record_property
) -> None:
    database = tmp_path / "datasette.sqlite"
    connection = open_store(database)
    _objects(connection)
    connection.close()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = _datasette_process(database, port)
    base = f"http://127.0.0.1:{port}/{database.stem}/company.json?_shape=array"
    try:
        _wait_for_datasette(base)
        reads = 0
        for _ in range(20):
            with urllib.request.urlopen(base, timeout=2) as response:
                reads += response.status == 200
        statements = (
            "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES('x','x','manual','x')",
            "UPDATE company SET name='changed'",
            "DELETE FROM company",
            "DROP TABLE company",
            "ALTER TABLE company ADD COLUMN changed TEXT",
            "CREATE TABLE changed(value TEXT)",
            "PRAGMA journal_mode=DELETE",
            "ATTACH DATABASE 'other.sqlite' AS other",
            "VACUUM",
            "REPLACE INTO company(company_id,name,source_lane,dedupe_key) VALUES('x','x','manual','x')",
        )
        rejected = 0
        for statement in statements:
            url = (
                f"http://127.0.0.1:{port}/{database.stem}"
                f"?sql={urllib.parse.quote(statement, safe='')}"
            )
            try:
                urllib.request.urlopen(url, timeout=2)
            except urllib.error.HTTPError as error:
                body = error.read().decode("utf-8", "replace").casefold()
                assert 400 <= error.code < 500
                assert any(marker in body for marker in (
                    "read-only", "readonly", "immutable", "statement must be a select"
                ))
                rejected += 1
            with urllib.request.urlopen(base, timeout=2) as response:
                rows = json.loads(response.read())[0]
                assert rows["name"] == "Example Test"
        assert reads == 20
        assert rejected == 10
        record_property("datasette_reads", reads)
        record_property("datasette_write_rejections", rejected)
    finally:
        process.kill()
        process.wait(timeout=10)
    assert process.poll() is not None
    check = open_store(database)
    assert check.execute("SELECT count(*) FROM company").fetchone()[0] == 1
