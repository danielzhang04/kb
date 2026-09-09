# P1 schema mapping: person fixtures use one_line_blurb; company fixtures use one_line_summary.
# Employment fixtures require source_observation_id referencing a source_observation row.
# Keep these synthetic fixture names aligned with the P1 schema.
from datetime import UTC, datetime, timedelta
from pathlib import Path
import sqlite3
from uuid import UUID

import pytest

from scripts.prospecting.personalizer.evidence import (
    EvidenceDraft,
    EvidenceError,
    copy_eligible,
    expire_evidence,
    insert_evidence,
    list_evidence,
)
from scripts.prospecting.store import open_store


NOW = datetime(2026, 9, 3, tzinfo=UTC)


def synthetic_uuid(value: int) -> str:
    return str(UUID(int=value))


PERSON_ID = synthetic_uuid(1)
COMPANY_ID = synthetic_uuid(2)


def database(tmp_path: Path) -> sqlite3.Connection:
    connection = open_store(tmp_path / "p1.sqlite")
    connection.row_factory = sqlite3.Row
    connection.execute(
        """INSERT INTO person(person_id,first_name,full_name,linkedin_url,location,one_line_blurb,source_lane,dedupe_key)
           VALUES(?,?,?,?,?,?,?,?)""",
        (PERSON_ID, "Synthetic", "Synthetic Person", None, "Example", "Synthetic fixture", "manual", "synthetic-person"),
    )
    connection.execute(
        """INSERT INTO company(company_id,name,website_url,linkedin_url,one_line_summary,industry,location,source_lane,dedupe_key)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (COMPANY_ID, "Example Company", "https://example.test", None, "Synthetic fixture", "Testing", "Example", "manual", "example.test"),
    )
    connection.execute(
        """INSERT INTO source_observation(
             observation_id,entity_type,entity_id,field,value,source,seen_at,retrieved_at,confidence,snapshot_id
           ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (synthetic_uuid(7), "employment", PERSON_ID, "title", '"Operations"',
         "fixture", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z", 0.95, None),
    )
    connection.execute(
        """INSERT INTO employment(employment_id,person_id,company_id,title,valid_from,valid_to,source_observation_id,confidence)
           VALUES(?,?,?,?,?,?,?,?)""",
        (synthetic_uuid(3), PERSON_ID, COMPANY_ID, "Operations", "2026-01-01", None,
         synthetic_uuid(7), 0.95),
    )
    for snapshot_id, entity_id, source_url, body_ref in (
        (synthetic_uuid(4), PERSON_ID, "https://example.test/profile", "snapshot-valid.html"),
        (synthetic_uuid(5), COMPANY_ID, "https://example.test/company", "snapshot-expired.html"),
    ):
        connection.execute(
            """INSERT INTO source_snapshot(
                 snapshot_id,entity_id,source_url,source_domain,retrieved_at,content_type,
                 content_sha256,allowlist_version,body_ref,expires_at,retention_delete_at
               ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (snapshot_id, entity_id, source_url, "example.test", "2026-09-01T00:00:00Z",
             "text/html", "0" * 64, "fixture-v1", body_ref,
             "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"),
        )
    connection.commit()
    return connection


def draft(**changes: object) -> EvidenceDraft:
    values: dict[str, object] = {
        "evidence_id": synthetic_uuid(6), "person_id": PERSON_ID,
        "claim": "Leads operations", "source_ref": synthetic_uuid(4), "observed_at": "2026-08-20",
        "excerpt": "appointed its current operations lead", "confidence": 0.9,
        "allowed_for_copy": True,
    }
    values.update(changes)
    return EvidenceDraft(**values)


def test_insert_accepts_snapshot_id_and_copies_source_times(tmp_path: Path) -> None:
    record = insert_evidence(database(tmp_path), draft(), 0.8)
    assert record.url == "https://example.test/profile"
    assert record.retrieved_at == "2026-09-01T00:00:00Z"


def test_insert_accepts_url_present_in_snapshot(tmp_path: Path) -> None:
    record = insert_evidence(database(tmp_path), draft(source_ref="https://example.test/profile"), 0.8)
    assert record.url == "https://example.test/profile"


def test_insert_accepts_snapshot_for_persons_company(tmp_path: Path) -> None:
    record = insert_evidence(database(tmp_path), draft(source_ref=synthetic_uuid(5)), 0.8)
    assert record.url == "https://example.test/company"


def test_insert_rejects_free_floating_url(tmp_path: Path) -> None:
    with pytest.raises(EvidenceError, match="source_not_snapshotted"):
        insert_evidence(database(tmp_path), draft(source_ref="https://other.test/fact"), 0.8)


def test_insert_rejects_snapshot_for_different_person(tmp_path: Path) -> None:
    with pytest.raises(EvidenceError, match="source_entity_mismatch"):
        insert_evidence(database(tmp_path), draft(person_id=synthetic_uuid(99)), 0.8)


def test_insert_rejects_below_policy_floor(tmp_path: Path) -> None:
    with pytest.raises(EvidenceError, match="confidence_below_floor"):
        insert_evidence(database(tmp_path), draft(confidence=0.79), 0.8)


def test_disallowed_evidence_is_stored_but_hidden_from_copy_list(tmp_path: Path) -> None:
    connection = database(tmp_path)
    record = insert_evidence(connection, draft(allowed_for_copy=False), 0.8)
    assert not record.allowed_for_copy
    assert list_evidence(connection, PERSON_ID, NOW) == ()


def test_list_is_bound_to_person(tmp_path: Path) -> None:
    connection = database(tmp_path)
    insert_evidence(connection, draft(), 0.8)
    assert len(list_evidence(connection, PERSON_ID, NOW)) == 1
    assert list_evidence(connection, synthetic_uuid(99), NOW) == ()


def test_expired_evidence_is_hidden_by_default(tmp_path: Path) -> None:
    connection = database(tmp_path)
    insert_evidence(connection, draft(), 0.8)
    expire_evidence(connection, draft().evidence_id, "2026-09-02T00:00:00Z")
    assert list_evidence(connection, PERSON_ID, NOW) == ()


def test_expired_evidence_can_be_audited(tmp_path: Path) -> None:
    connection = database(tmp_path)
    insert_evidence(connection, draft(), 0.8)
    expire_evidence(connection, draft().evidence_id, "2026-09-02T00:00:00Z")
    records = list_evidence(connection, PERSON_ID, NOW, include_expired=True)
    assert len(records) == 1 and not copy_eligible(records[0], NOW, 0.8)


def test_duplicate_evidence_id_is_rejected(tmp_path: Path) -> None:
    connection = database(tmp_path)
    insert_evidence(connection, draft(), 0.8)
    with pytest.raises(EvidenceError, match="duplicate_evidence_id"):
        insert_evidence(connection, draft(), 0.8)


def test_snapshot_fixture_bytes_are_read() -> None:
    valid = Path("orgs/prospecting/fixtures/snapshot-valid.html").read_text(encoding="utf-8")
    expired = Path("orgs/prospecting/fixtures/snapshot-expired.html").read_text(encoding="utf-8")
    assert "Example Robotics" in valid and "Example Climate" in expired


def test_p1_snapshot_retention_is_thirty_days(tmp_path: Path) -> None:
    row = database(tmp_path).execute(
        "SELECT retrieved_at,retention_delete_at FROM source_snapshot ORDER BY snapshot_id LIMIT 1"
    ).fetchone()
    parsed = lambda value: datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert parsed(row["retention_delete_at"]) - parsed(row["retrieved_at"]) == timedelta(days=30)


def test_p1_store_keeps_wal_and_foreign_keys_enabled(tmp_path: Path) -> None:
    connection = database(tmp_path)
    assert connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_evidence_insert_obeys_transaction_rollback(tmp_path: Path) -> None:
    connection = database(tmp_path)
    connection.execute("BEGIN")
    with pytest.raises(RuntimeError, match="rollback"):
        with connection:
            insert_evidence(connection, draft(), 0.8)
            raise RuntimeError("rollback")
    assert connection.execute("SELECT count(*) FROM evidence").fetchone()[0] == 0
