from dataclasses import dataclass
from datetime import UTC, datetime
import sqlite3


class EvidenceError(ValueError):
    pass


@dataclass(frozen=True)
class EvidenceDraft:
    evidence_id: str
    person_id: str
    claim: str
    source_ref: str
    observed_at: str | None
    excerpt: str
    confidence: float
    allowed_for_copy: bool


@dataclass(frozen=True)
class EvidenceRecord:
    evidence_id: str
    person_id: str
    claim: str
    url: str
    observed_at: str | None
    retrieved_at: str
    excerpt: str
    confidence: float
    expires_at: str
    allowed_for_copy: bool


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _record(row: sqlite3.Row) -> EvidenceRecord:
    return EvidenceRecord(
        row["evidence_id"], row["person_id"], row["claim"],
        row["url"], row["observed_at"], row["retrieved_at"], row["excerpt"],
        float(row["confidence"]), row["expires_at"], bool(row["allowed_for_copy"]),
    )


def copy_eligible(record: EvidenceRecord, now: datetime, confidence_floor: float) -> bool:
    return (
        record.allowed_for_copy
        and record.confidence >= confidence_floor
        and _utc(record.expires_at) >= now.astimezone(UTC)
    )


def insert_evidence(
    connection: sqlite3.Connection, draft: EvidenceDraft, confidence_floor: float
) -> EvidenceRecord:
    if not 0.0 <= draft.confidence <= 1.0:
        raise EvidenceError("confidence_out_of_range")
    if draft.confidence < confidence_floor:
        raise EvidenceError("confidence_below_floor")
    if "://" in draft.source_ref:
        if not draft.source_ref.startswith("https://"):
            raise EvidenceError("source_not_https")
        row = connection.execute(
            "SELECT * FROM source_snapshot WHERE source_url=? ORDER BY retrieved_at DESC LIMIT 1",
            (draft.source_ref,),
        ).fetchone()
    else:
        row = connection.execute(
            "SELECT * FROM source_snapshot WHERE snapshot_id=?", (draft.source_ref,)
        ).fetchone()
    if row is None:
        raise EvidenceError("source_not_snapshotted")
    if row["entity_id"] != draft.person_id:
        related = connection.execute(
            "SELECT 1 FROM employment WHERE person_id=? AND company_id=? LIMIT 1",
            (draft.person_id, row["entity_id"]),
        ).fetchone()
        if related is None:
            raise EvidenceError("source_entity_mismatch")
    try:
        connection.execute(
            """INSERT INTO evidence(
              evidence_id,person_id,claim,url,observed_at,retrieved_at,
              excerpt,confidence,expires_at,allowed_for_copy
            ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                draft.evidence_id, draft.person_id, draft.claim,
                row["source_url"], draft.observed_at, row["retrieved_at"], draft.excerpt,
                draft.confidence, row["expires_at"], int(draft.allowed_for_copy),
            ),
        )
    except sqlite3.IntegrityError as error:
        raise EvidenceError("duplicate_evidence_id") from error
    stored = connection.execute(
        "SELECT * FROM evidence WHERE evidence_id=?", (draft.evidence_id,)
    ).fetchone()
    if stored is None:
        raise EvidenceError("insert_failed")
    return _record(stored)


def list_evidence(
    connection: sqlite3.Connection,
    person_id: str,
    now: datetime,
    include_expired: bool = False,
) -> tuple[EvidenceRecord, ...]:
    rows = connection.execute(
        "SELECT * FROM evidence WHERE person_id=? ORDER BY evidence_id",
        (person_id,),
    ).fetchall()
    records = tuple(_record(row) for row in rows)
    if include_expired:
        return records
    return tuple(record for record in records if copy_eligible(record, now, 0.0))


def expire_evidence(
    connection: sqlite3.Connection, evidence_id: str, expired_at: str
) -> None:
    cursor = connection.execute(
        "UPDATE evidence SET expires_at=? WHERE evidence_id=?", (expired_at, evidence_id)
    )
    if cursor.rowcount != 1:
        raise EvidenceError("unknown_evidence_id")
