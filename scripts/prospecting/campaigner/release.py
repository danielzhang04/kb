"""Campaigner-side release queues one typed executor operation."""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from scripts.prospecting.campaigner.requests import CampaignerRequests


@dataclass(frozen=True)
class ReleaseContext:
    connection: sqlite3.Connection
    requests: CampaignerRequests


@dataclass(frozen=True)
class ReleaseResult:
    state: str
    request_id: str | None = None
    post_linearization: bool = False


def release_due(context: ReleaseContext, delivery_id: str) -> ReleaseResult:
    row = context.connection.execute(
        "SELECT d.state,r.revision_id,d.contact_id,d.mailbox_id,"
        "d.campaign_id,d.enrollment_id,d.step,r.campaign_id,r.person_id,r.step,"
        "cp.person_id,e.campaign_id,e.person_id "
        "FROM delivery AS d "
        "LEFT JOIN revision AS r ON r.hash=d.revision_hash "
        "LEFT JOIN contact_point AS cp ON cp.contact_id=d.contact_id "
        "LEFT JOIN enrollment AS e ON e.enrollment_id=d.enrollment_id "
        "WHERE d.delivery_id=?",
        (delivery_id,),
    ).fetchone()
    if row is None:
        return ReleaseResult("missing")
    if row[0] not in {"reserved", "uncertain"}:
        return ReleaseResult(row[0])
    if row[1] is None:
        return ReleaseResult("missing_revision")
    if not (
        row[4] == row[7] == row[11]
        and row[6] == row[9]
        and row[8] == row[10] == row[12]
    ):
        return ReleaseResult("scope_mismatch")
    request_id = context.requests.enqueue(
        operation="gmail_draft",
        action="draft_create_in_thread",
        payload={
            "revision_id": row[1],
            "contact_id": row[2],
            "mailbox_id": row[3],
        },
        include_action=False,
    )
    return ReleaseResult("queued", request_id)
