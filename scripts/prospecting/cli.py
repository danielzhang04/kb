"""Desktop-only two-word human override CLI."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import re
import sqlite3
import sys
import uuid
from datetime import UTC, datetime

from .store import open_store

VERBS = frozenset({"dnc", "note", "status", "veto"})
DNC_REASONS = frozenset({"decline", "unsubscribe", "wrong_person", "manual_dnc"})
CAMPAIGN_STATUSES = frozenset({"draft", "approved", "active", "paused", "closed"})


def _opaque_id(operand: str, prefix: str) -> str:
    if re.fullmatch(rf"{prefix}_[0-9a-f]{{16}}", operand) is None:
        raise ValueError(f"operand must be a typed opaque {prefix} id")
    return operand


def _human_actor() -> str:
    user = getpass.getuser()
    if user.startswith("agent:"):
        raise ValueError("agent actors are prohibited")
    return f"human:{user}"


def _validate_audit_actor(actor: str) -> None:
    if actor.startswith("agent:") or not actor.startswith("human:"):
        raise ValueError("audit actor must be human")


def apply_override(
    connection: sqlite3.Connection,
    verb: str,
    operand: str,
    at: str,
    *,
    note: str | None = None,
    reason: str | None = None,
    status: str | None = None,
    campaign_id: str | None = None,
) -> str:
    if verb not in VERBS:
        raise ValueError("unknown override verb")
    _opaque_id(operand, "camp" if verb == "status" else "per")
    if campaign_id is not None:
        _opaque_id(campaign_id, "camp")
    subject = operand
    actor = _human_actor()
    _validate_audit_actor(actor)
    connection.execute("BEGIN IMMEDIATE")
    try:
        before = ""
        entity_type = "person"
        if verb == "dnc":
            if reason not in DNC_REASONS:
                raise ValueError("invalid dnc reason")
            connection.execute(
                "INSERT INTO suppression VALUES(?,?,?,?,?,?,?,?)",
                (str(uuid.uuid4()), "person", subject, reason, at,
                 actor, None, None),
            )
            entity_type = "suppression"
            value = reason
        elif verb == "note":
            if not note:
                raise ValueError("note text is required")
            if connection.execute(
                "SELECT 1 FROM person WHERE person_id=?", (subject,)
            ).fetchone() is None:
                raise KeyError(subject)
            connection.execute(
                """INSERT INTO relationship(person_id,insights) VALUES(?,?)
                   ON CONFLICT(person_id) DO UPDATE SET insights=excluded.insights""",
                (subject, note),
            )
            value = note
        elif verb == "status":
            if status not in CAMPAIGN_STATUSES:
                raise ValueError("invalid campaign status")
            current = connection.execute(
                "SELECT status FROM campaign WHERE campaign_id=?", (subject,)
            ).fetchone()
            if current is None:
                raise KeyError(subject)
            before = str(current[0])
            if status == "active":
                approved = connection.execute(
                    """SELECT 1 FROM campaign AS c JOIN approval AS a
                       ON a.campaign_id=c.campaign_id AND a.policy_hash=c.policy_hash
                       WHERE c.campaign_id=? AND c.status='approved' AND c.intent<>'sales'
                         AND a.content_kind='campaign_policy'
                         AND a.permitted_action='activate_campaign'
                         AND a.tier=c.approval_tier AND a.approver LIKE 'human:%'
                         AND a.invalidation_reason IS NULL AND a.consumed_at IS NULL
                         AND a.approved_at <= ? AND a.expires_at >= ?""",
                    (subject, at, at),
                ).fetchone()
                if approved is None:
                    raise ValueError("active requires approved campaign and current human approval")
            connection.execute("UPDATE campaign SET status=? WHERE campaign_id=?", (status, subject))
            entity_type = "campaign"
            value = status
        elif verb == "veto":
            if not campaign_id:
                raise ValueError("veto requires a campaign id")
            if connection.execute(
                "SELECT 1 FROM person WHERE person_id=?", (subject,)
            ).fetchone() is None:
                raise KeyError(subject)
            if connection.execute(
                "SELECT 1 FROM campaign WHERE campaign_id=?", (campaign_id,)
            ).fetchone() is None:
                raise KeyError(campaign_id)
            veto_id = "pol_" + hashlib.sha256(
                f"{subject}:{campaign_id}".encode("utf-8")
            ).hexdigest()[:16]
            connection.execute(
                "INSERT INTO fit_veto VALUES(?,?,?,?,?,?,?)",
                (veto_id, subject, campaign_id, "manual_fit_veto", 1, actor, at),
            )
            value = campaign_id
        event_id = "req_" + uuid.uuid4().hex[:16]
        connection.execute(
            "INSERT INTO audit VALUES(?,?,?,?,?,?,?,?,?)",
            (event_id, actor, f"override_{verb}", entity_type, subject, at,
             hashlib.sha256(before.encode()).hexdigest() if before else None,
             hashlib.sha256(value.encode()).hexdigest(), verb),
        )
        connection.commit()
        return event_id
    except Exception:
        connection.rollback()
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("verb", choices=sorted(VERBS))
    parser.add_argument("operand")
    parser.add_argument("--reason", choices=sorted(DNC_REASONS))
    parser.add_argument("--status", choices=sorted(CAMPAIGN_STATUSES))
    parser.add_argument("--campaign")
    args = parser.parse_args(argv)
    if args.verb == "dnc" and args.reason is None:
        parser.error("dnc requires --reason")
    if args.verb == "status" and args.status is None:
        parser.error("status requires --status")
    if args.verb == "veto" and args.campaign is None:
        parser.error("veto requires --campaign")
    try:
        _opaque_id(args.operand, "camp" if args.verb == "status" else "per")
        if args.campaign is not None:
            _opaque_id(args.campaign, "camp")
    except ValueError as error:
        parser.error(str(error))
    note = sys.stdin.read() if args.verb == "note" else None
    with open_store() as connection:
        event_id = apply_override(
            connection, args.verb, args.operand,
            datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            note=note, reason=args.reason, status=args.status, campaign_id=args.campaign,
        )
    print(event_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
