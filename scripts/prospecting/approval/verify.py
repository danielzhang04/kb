from __future__ import annotations

from datetime import datetime
import hashlib
import sqlite3
import uuid
from pathlib import Path

import scripts.approvals as approvals
from scripts.webauthn_verify import verify_webauthn_approval
from scripts.prospecting.approval.scope import deserialize, materialized_send_scopes, scope_hash
from scripts.prospecting.store import approval_scope_hash


def _require_revision_ready(
    connection: sqlite3.Connection,
    campaign_id: str,
    revision_hash_value: str,
    now: datetime,
) -> None:
    from scripts.prospecting.pipeline_stage_service import (
        PipelineStageError,
        require_revision_ready,
    )

    try:
        require_revision_ready(connection, campaign_id, revision_hash_value, now)
    except (PipelineStageError, sqlite3.Error, TypeError):
        raise ValueError("revision_not_ready") from None


def _human(value: str) -> bool:
    return value.startswith("human:") and value != "human:"


def _approval_id(row: dict[str, str]) -> str:
    """Return the frozen-store typed ID for one exact send scope."""
    logical_key = ":".join(
        (row["campaign_id"], row["revision_hash"], row["contact_id"], row["mailbox_id"])
    )
    return "apr_" + hashlib.sha256(logical_key.encode("ascii")).hexdigest()[:16]


def update_approval_resolution(
    connection: sqlite3.Connection,
    approval_id: str,
    *,
    consumed_at: str | None,
    invalidation_reason: str | None,
) -> None:
    """Set an unresolved approval's terminal resolution exactly once."""
    changed = connection.execute(
        """UPDATE approval
           SET consumed_at=?, invalidation_reason=?
           WHERE approval_id=?
             AND consumed_at IS NULL AND invalidation_reason IS NULL""",
        (consumed_at, invalidation_reason, approval_id),
    ).rowcount
    if changed != 1:
        raise ValueError("approval_already_resolved")


def verify_and_insert(
    connection: sqlite3.Connection,
    card_ref: str,
    approved_card_path: Path,
    repo_root: Path,
    expected_scope_hash: str,
    now: datetime,
    manage_transaction: bool = True,
) -> tuple[str, ...]:
    # The verifier owns all assertion parsing and reads only the card pinned on
    # ``card_ref``.  Neither assertion bytes nor credential paths cross this API.
    result = verify_webauthn_approval(approved_card_path, repo_root, ref=card_ref)
    if not getattr(result, "ok", False) or result.card is None:
        reason = str(getattr(result, "reason", "")).lower()
        if "replay" in reason:
            raise ValueError("approval_replay")
        if "expired" in reason:
            raise ValueError("approval_expired")
        raise ValueError("webauthn_rejected")
    card = result.card
    if (
        card.meta.get("risk-tier") != "T3"
        or card.meta.get("action") != "approve-prospecting-send"
    ):
        raise ValueError("webauthn_scope_action")
    approver = str(card.meta.get("owner", ""))
    if not _human(approver):
        raise ValueError("human_approver_required")
    scope_text = approvals.work_order_of(card.body).strip()
    scope = deserialize(scope_text, expected_scope_hash, now)
    if scope_hash(scope) != expected_scope_hash:
        raise ValueError("scope_hash_mismatch")
    rows = materialized_send_scopes(scope)
    ids: list[str] = []
    savepoint = f"approval_verify_{uuid.uuid4().hex}"
    savepoint_active = False
    try:
        if manage_transaction:
            connection.execute("BEGIN IMMEDIATE")
        connection.execute(f"SAVEPOINT {savepoint}")
        savepoint_active = True
        if connection.execute(
            "SELECT 1 FROM approval WHERE nonce=?", (scope.nonce,)
        ).fetchone():
            raise ValueError("approval_replay")
        campaign = connection.execute(
            "SELECT policy_hash,approval_tier FROM campaign WHERE campaign_id=?",
            (scope.campaign_id,),
        ).fetchone()
        if campaign is None or tuple(campaign) != (scope.policy_hash, "T1"):
            raise ValueError("scope_mismatch")
        for row in rows:
            match = connection.execute(
                "SELECT 1 FROM revision r JOIN contact_point c ON c.person_id=r.person_id "
                "WHERE r.hash=? AND r.campaign_id=? AND c.contact_id=? AND c.state='valid'",
                (row["revision_hash"], scope.campaign_id, row["contact_id"]),
            ).fetchone()
            if match is None:
                raise ValueError("scope_mismatch")
            _require_revision_ready(
                connection, scope.campaign_id, row["revision_hash"], now,
            )
            approval_id = _approval_id(row)
            approved_at = now.isoformat()
            approval_values = {
                "assertion_ref": card_ref,
                "campaign_id": row["campaign_id"],
                "policy_hash": row["policy_hash"],
                "content_kind": row["content_kind"],
                "revision_hash": row["revision_hash"],
                "contact_id": row["contact_id"],
                "mailbox_id": row["mailbox_id"],
                "approver": approver,
                "approved_at": approved_at,
                "expires_at": row["expires_at"],
                "tier": row["tier"],
                "send_window": row["send_window"],
                "nonce": row["nonce"],
                "permitted_action": row["permitted_action"],
            }
            connection.execute(
                "INSERT INTO approval VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    approval_id,
                    card_ref,
                    row["campaign_id"],
                    row["policy_hash"],
                    row["content_kind"],
                    row["revision_hash"],
                    row["contact_id"],
                    row["mailbox_id"],
                    approver,
                    approved_at,
                    row["expires_at"],
                    row["tier"],
                    row["send_window"],
                    row["nonce"],
                    row["permitted_action"],
                    None,
                    approval_scope_hash(approval_values),
                    None,
                ),
            )
            ids.append(approval_id)
        connection.execute(f"RELEASE SAVEPOINT {savepoint}")
        savepoint_active = False
        if manage_transaction:
            connection.commit()
    except Exception:
        if savepoint_active:
            connection.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
            connection.execute(f"RELEASE SAVEPOINT {savepoint}")
        if manage_transaction:
            connection.rollback()
        raise
    return tuple(ids)
