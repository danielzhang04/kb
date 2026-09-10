"""Desktop-only assembly and materialization of exact T1 approval batches."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import importlib
import json
from pathlib import Path
import sqlite3
import sys
import uuid
from zoneinfo import ZoneInfo

from scripts.prospecting.approval.scope import BatchItem, build_scope, scope_hash, serialize
from scripts.prospecting.approval.schedule_t1 import stagger_deliveries


@dataclass(frozen=True)
class BatchResult:
    state: str
    ids: tuple[str, ...]


@dataclass(frozen=True)
class StagedScope:
    card_path: Path
    ref: str


class ContactSelectionError(ValueError):
    """A campaign tranche does not resolve to exactly one valid contact."""


def _revision_ready(
    connection: sqlite3.Connection, campaign_id: str, revision_hash_value: str,
    now: datetime,
) -> bool:
    from scripts.prospecting.pipeline_stage_service import (
        PipelineStageError,
        require_revision_ready,
    )

    try:
        require_revision_ready(connection, campaign_id, revision_hash_value, now)
    except (PipelineStageError, sqlite3.Error, TypeError):
        return False
    return True


class _NestedScheduleConnection:
    """Let the scheduler participate in ``apply_batch``'s outer transaction."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    def execute(self, sql: str, parameters=()):
        if sql.strip().upper() == "BEGIN IMMEDIATE":
            return self._connection.execute("SELECT 1")
        return self._connection.execute(sql, parameters)

    def commit(self) -> None:
        # The outer materialization transaction is the atomic commit boundary.
        return None

    def rollback(self) -> None:
        self._connection.rollback()

    def __getattr__(self, name: str):
        return getattr(self._connection, name)


def _next_business_window(now: datetime, window: str, timezone_name: str) -> tuple[datetime, datetime]:
    start_text, end_text = window.split("-", 1)
    zone = timezone.utc if timezone_name == "UTC" else ZoneInfo(timezone_name)
    day = (now.astimezone(zone) + timedelta(days=1)).date()
    while day.weekday() >= 5:
        day += timedelta(days=1)
    start = datetime.combine(day, datetime.strptime(start_text, "%H:%M").time(), zone)
    end = datetime.combine(day, datetime.strptime(end_text, "%H:%M").time(), zone)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _selected_candidates(connection: sqlite3.Connection, campaign_id: str, now: datetime):
    """Return one row per due enrollment plus its campaign-tranche contacts.

    P1's ``contact_point`` table deliberately has no mutable ``selected`` flag.
    The campaign-qualified ``person_tranche`` view is therefore the selection
    authority; joining the raw contact table by itself would silently widen the
    scope to every contact for a person.
    """
    rows = connection.execute(
        "SELECT e.enrollment_id,r.hash,cp.contact_id FROM enrollment e "
        "JOIN revision r ON r.campaign_id=e.campaign_id AND r.person_id=e.person_id AND r.step=0 "
        "LEFT JOIN person_tranche pt ON pt.person_id=e.person_id AND pt.campaign_id=e.campaign_id "
        "LEFT JOIN contact_point cp ON cp.person_id=pt.person_id AND cp.state='valid' "
        "WHERE e.campaign_id=? AND e.current_step=0 AND e.status='approved' "
        "AND e.stop_reason IS NULL AND e.block_reason IS NULL AND e.next_due_at<=? "
        "AND json_extract(r.qa,'$.qa_score')>=80 "
        "ORDER BY e.enrollment_id,r.hash,cp.contact_id",
        (campaign_id, now.isoformat()),
    ).fetchall()
    return [
        row for row in rows
        if _revision_ready(connection, campaign_id, str(row[1]), now)
    ]


def build_batch(
    connection: sqlite3.Connection,
    campaign_id: str,
    mailbox_id: str,
    now: datetime,
    nonce: str,
):
    """Return the sole valid first-touch scope for each due enrollment."""
    campaign = connection.execute(
        "SELECT policy_hash,send_window,timezone,approval_tier FROM campaign "
        "WHERE campaign_id=? AND status='active'", (campaign_id,)
    ).fetchone()
    if campaign is None or campaign[3] != "T1":
        raise ValueError("t1_campaign_required")
    if not mailbox_id:
        raise ValueError("mailbox_id_required")
    grouped: dict[str, list[tuple[str, str]]] = {}
    for enrollment_id, revision_hash, contact_id in _selected_candidates(
        connection, campaign_id, now
    ):
        if contact_id is not None:
            grouped.setdefault(enrollment_id, []).append((revision_hash, contact_id))
        else:
            grouped.setdefault(enrollment_id, [])
    for enrollment_id, rows in grouped.items():
        if len(rows) != 1:
            raise ContactSelectionError(f"selected_contact_count:{enrollment_id}")
    items = tuple(BatchItem(*rows[0]) for rows in grouped.values())
    if not items:
        raise ValueError("empty_batch")
    start, end = _next_business_window(now, campaign[1], campaign[2])
    if end > now + timedelta(hours=24):
        raise ValueError("scope_prepared_too_early")
    return build_scope(
        campaign_id, campaign[0], items, mailbox_id, "T1", start.isoformat(), end.isoformat(),
        end.isoformat(), nonce, now,
    )


def assemble_due_batch(
    connection: sqlite3.Connection,
    campaign_id: str,
    now: datetime,
    nonce: str,
):
    """Compatibility wrapper; new callers must supply a mailbox to ``build_batch``."""
    row = connection.execute(
        "SELECT mailbox_id FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    if row is None:
        raise ValueError("t1_campaign_required")
    return build_batch(connection, campaign_id, row[0], now, nonce)


def summarize(scope) -> dict[str, object]:
    """Return the approval-stage summary using hashes and opaque IDs only."""
    return {
        "campaign_id": scope.campaign_id,
        "batch_hash": scope.batch_hash,
        "scope_hash": scope_hash(scope),
        "count": len(scope.items),
        "revision_ids": tuple(item.revision_hash for item in scope.items),
        "contact_ids": tuple(item.contact_id for item in scope.items),
    }


def stage_scope(scope, repo_root: Path, opener=None) -> StagedScope:
    """Stage exact canonical bytes through the existing signed-card primitive."""
    root = Path(repo_root)
    card_id = f"prospecting-t1-{scope.batch_hash[:16]}"
    text = (
        "---\n"
        "schema-version: 1\n"
        f"id: {card_id}\n"
        "project: prospecting\n"
        "action: approve-prospecting-send\n"
        f"target: {scope.campaign_id}\n"
        "risk-tier: T3\n"
        "state: approvals\n"
        "owner: human:daniel\n"
        "assurance: webauthn\n"
        "webauthn:\n"
        "  credential-id: \"\"\n"
        "  authenticator-data: \"\"\n"
        "  client-data-json: \"\"\n"
        "  signature: \"\"\n"
        "---\n\n"
        "## Work order\n\n"
        f"{serialize(scope)}\n"
    )
    staging = root / ".approval-staging"
    staging.mkdir(exist_ok=True)
    card_path = staging / f"{card_id}.md"
    card_path.write_text(text, encoding="utf-8")
    if opener is None:
        return StagedScope(card_path, card_id)
    # ``stage_approval`` is also executable as a script and uses sibling imports.
    # Add that directory only when staging is actually requested, so parser-level
    # refusals remain usable through ``python -m``.
    scripts_dir = Path(__file__).resolve().parents[3] / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    stage_approval = importlib.import_module("scripts.stage_approval")
    ref = stage_approval.stage(card_path, repo_root=root, opener=opener)
    # ``stage`` commits the canonical record where the verifier expects it.
    # Returning that path prevents downstream materialization from accidentally
    # falling back to the mutable pre-stage draft.
    return StagedScope(root / "queue" / "approvals" / f"{card_id}.md", ref)


def _identical_completed_batch(
    connection: sqlite3.Connection, expected_hash: str, assertion_ref: str
) -> tuple[str, ...] | None:
    assertion_hash = hashlib.sha256(assertion_ref.encode()).hexdigest()
    receipt = connection.execute(
        "SELECT after_hash FROM audit WHERE action='p6_batch_materialized' "
        "AND entity_type='approval_batch' AND entity_id=? AND before_hash=?",
        (expected_hash, assertion_hash),
    ).fetchone()
    if receipt is None:
        return None
    rows = connection.execute(
        "SELECT a.approval_id,d.state,e.status FROM approval a "
        "JOIN delivery d ON d.campaign_id=a.campaign_id AND d.revision_hash=a.revision_hash "
        "AND d.contact_id=a.contact_id AND d.mailbox_id=a.mailbox_id "
        "JOIN enrollment e ON e.enrollment_id=d.enrollment_id "
        "WHERE a.assertion_ref=? ORDER BY a.approval_id", (assertion_ref,)
    ).fetchall()
    ids = tuple(row[0] for row in rows)
    digest = hashlib.sha256("\n".join(ids).encode()).hexdigest()
    if not ids or digest != receipt[0] or any(
        row[1] not in {"reserved", "claimed", "attempted", "sent", "uncertain"}
        or row[2] not in {"scheduled", "sent", "closed"} for row in rows
    ):
        raise ValueError("partial_or_nonidentical_replay")
    return ids


def _enrollment_for_approval(
    connection: sqlite3.Connection, approval_id: str, now: datetime
) -> tuple[str, str, str, str, str]:
    row = connection.execute(
        "SELECT campaign_id,revision_hash,contact_id,mailbox_id,send_window FROM approval "
        "WHERE approval_id=?", (approval_id,)
    ).fetchone()
    if row is None:
        raise ValueError("approval_missing")
    campaign_id, revision_hash, contact_id, mailbox_id, window_json = row
    enrollments = connection.execute(
        "SELECT e.enrollment_id FROM enrollment e JOIN revision r "
        "ON r.person_id=e.person_id AND r.campaign_id=e.campaign_id AND r.step=0 "
        "JOIN person_tranche pt ON pt.person_id=e.person_id AND pt.campaign_id=e.campaign_id "
        "JOIN contact_point cp ON cp.person_id=pt.person_id AND cp.contact_id=? "
        "AND cp.state='valid' "
        "WHERE e.campaign_id=? AND r.hash=? AND e.current_step=0 AND e.status='approved' "
        "AND e.stop_reason IS NULL AND e.block_reason IS NULL AND json_extract(r.qa,'$.qa_score')>=80",
        (contact_id, campaign_id, revision_hash),
    ).fetchall()
    if len(enrollments) != 1:
        raise ValueError("scope_mismatch")
    due = connection.execute(
        "SELECT 1 FROM enrollment WHERE enrollment_id=? AND next_due_at<=?",
        (enrollments[0][0], now.isoformat()),
    ).fetchone()
    if due is None:
        raise ValueError("scope_mismatch")
    return campaign_id, enrollments[0][0], revision_hash, contact_id, mailbox_id, window_json


def apply_batch(
    connection: sqlite3.Connection,
    card_ref: str,
    card_path: Path,
    repo_root: Path,
    expected_hash: str,
    now: datetime,
) -> BatchResult:
    """Verify once, then atomically materialize all bound sends and enrollments."""
    from scripts.prospecting.approval.verify import verify_and_insert

    connection.execute("BEGIN IMMEDIATE")
    try:
        try:
            ids = verify_and_insert(
                connection, card_ref, card_path, repo_root, expected_hash, now,
                manage_transaction=False,
            )
        except ValueError as exc:
            if str(exc) != "approval_replay":
                raise
            completed = _identical_completed_batch(connection, expected_hash, card_ref)
            if completed is None:
                raise ValueError("partial_or_nonidentical_replay") from exc
            connection.rollback()
            return BatchResult("identical_completed_noop", completed)
        for approval_id in ids:
            campaign_id, enrollment_id, revision_hash, contact_id, mailbox_id, window_json = _enrollment_for_approval(
                connection, approval_id, now
            )
            logical = hashlib.sha256(
                f"{campaign_id}:{enrollment_id}:0:{revision_hash}:{contact_id}:{mailbox_id}".encode()
            ).hexdigest()
            delivery_id = "req_" + hashlib.sha256(logical.encode("ascii")).hexdigest()[:16]
            start = json.loads(window_json)["start"]
            connection.execute(
                "INSERT INTO delivery(delivery_id,campaign_id,enrollment_id,step,revision_hash,"
                "contact_id,mailbox_id,logical_key,rfc_message_id,scheduled_at,state) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(logical_key) DO NOTHING",
                (delivery_id, campaign_id, enrollment_id, 0, revision_hash, contact_id, mailbox_id,
                 logical, f"<{logical}@prospecting.test>", start, "reserved"),
            )
            connection.execute(
                "UPDATE enrollment SET status='scheduled',block_reason=NULL "
                "WHERE enrollment_id=? AND status='approved'", (enrollment_id,)
            )
        # ``stagger_deliveries`` normally owns its transaction.  The small proxy
        # makes it part of this materialization transaction, so no delivery can
        # become due at the window start between insertion and staggering.
        campaign_ids = {
            row[0] for row in connection.execute(
                "SELECT DISTINCT campaign_id FROM approval WHERE approval_id IN ("
                + ",".join("?" for _ in ids) + ")", ids
            ).fetchall()
        }
        if len(campaign_ids) != 1:
            raise ValueError("scope_mismatch")
        stagger_deliveries(_NestedScheduleConnection(connection), campaign_ids.pop(), expected_hash, now)
        assertion_hash = hashlib.sha256(card_ref.encode()).hexdigest()
        ids_hash = hashlib.sha256("\n".join(sorted(ids)).encode()).hexdigest()
        connection.execute(
            "INSERT INTO audit(event_id,actor,action,entity_type,entity_id,at,before_hash,after_hash,reason) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), "human:daniel", "p6_batch_materialized", "approval_batch",
             expected_hash, now.isoformat(), assertion_hash, ids_hash, "verified_complete"),
        )
        connection.commit()
        return BatchResult("materialized", tuple(ids))
    except Exception:
        connection.rollback()
        raise
