"""Executor-owned per-thread serialization and T0 draft mutation."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from scripts.prospecting.campaigner.fake_gmail import ArrivalPoint, FakeMessage, FakeThread
from scripts.prospecting.campaigner.inbound import InboundEnvelope, process_inbound
from scripts.prospecting.campaigner.requests import CampaignerRequests
from scripts.prospecting.campaigner.release import ReleaseContext, ReleaseResult, release_due
from scripts.prospecting.executor import Executor
from scripts.prospecting.gmail_adapter import GmailAdapter, McpRestBackend

_LOCKS_GUARD = threading.Lock()
_THREAD_LOCKS: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)


def build_live_service(
    connection: sqlite3.Connection, *, executor: Executor | None = None,
    backend: FakeGmail | McpRestBackend | None = None,
    now: Callable[[], str] = lambda: datetime.now(timezone.utc).isoformat(),
):
    """Assemble the live executor-backed campaigner service outside campaigner/."""
    if executor is None or backend is None:
        raise RuntimeError("no_backend_attached")
    from scripts.prospecting.campaigner.cli import CampaignerService
    from scripts.prospecting.campaigner.wiring import LABEL_NAMES, attach_campaigner

    def enqueue_label(thread_id: str, add: tuple[str, ...], _remove: tuple[str, ...]) -> None:
        row = connection.execute(
            "SELECT c.policy_hash FROM delivery d JOIN campaign c ON c.campaign_id=d.campaign_id "
            "WHERE d.gmail_thread_id=? ORDER BY d.step LIMIT 1", (thread_id,)
        ).fetchone()
        if row is None:
            return
        reverse_labels = {name: code for code, name in LABEL_NAMES.items()}
        requests = CampaignerRequests(connection, row[0], now())
        for label in add:
            requests.enqueue(
                operation="gmail_label", action="labels_modify",
                payload={"gmail_thread_id": thread_id, "label_code": reverse_labels[label]},
                include_action=False,
            )

    def persist_inbound(thread: FakeThread) -> None:
        enrollment = connection.execute(
            "SELECT enrollment_id FROM delivery WHERE gmail_thread_id=? ORDER BY step LIMIT 1",
            (thread.thread_id,),
        ).fetchone()
        if enrollment is None:
            return
        for message in thread.messages:
            if message.inbound:
                process_inbound(
                    connection,
                    InboundEnvelope(
                        message.message_id, thread.thread_id, enrollment[0], message.history_id,
                        message.headers, lambda message=message: message.body,
                    ),
                    label_request=enqueue_label,
                )

    gmail = attach_campaigner(
        executor, backend, persist_inbound=persist_inbound,
        inject=lambda _point: None, now=now(),
    )

    def inbound_source() -> tuple[InboundEnvelope, ...]:
        rows = connection.execute(
            "SELECT DISTINCT gmail_thread_id,enrollment_id FROM delivery "
            "WHERE gmail_thread_id IS NOT NULL"
        ).fetchall()
        envelopes: list[InboundEnvelope] = []
        for thread_id, enrollment_id in rows:
            thread = gmail.thread_refresh(thread_id)
            for message in thread.messages:
                if message.inbound:
                    envelopes.append(InboundEnvelope(
                        message.message_id, thread_id, enrollment_id, message.history_id,
                        message.headers, lambda message=message: message.body,
                    ))
        return tuple(envelopes)

    def release(delivery_id: str) -> ReleaseResult:
        policy = connection.execute(
            "SELECT c.policy_hash FROM delivery d JOIN campaign c ON c.campaign_id=d.campaign_id "
            "WHERE d.delivery_id=?", (delivery_id,)
        ).fetchone()
        if policy is None:
            return ReleaseResult("missing")
        return release_due(ReleaseContext(
            connection, CampaignerRequests(connection, policy[0], now()),
        ), delivery_id)

    return CampaignerService(
        connection, inbound_source, release, now=now, label_request=enqueue_label,
    )


@dataclass(frozen=True)
class ExecutorDraftContext:
    connection: sqlite3.Connection
    gmail: GmailAdapter
    persist_inbound: Callable[[FakeThread], None]
    inject: Callable[[ArrivalPoint], None]
    now: str
    request_policy_hash: str = "p" * 64


def _lock_for(thread_id: str) -> threading.Lock:
    with _LOCKS_GUARD:
        return _THREAD_LOCKS[thread_id]


def _cancel(connection: sqlite3.Connection, delivery_id: str, reason: str) -> ReleaseResult:
    with connection:
        connection.execute(
            "UPDATE delivery SET state='cancelled' WHERE delivery_id=? AND state='reserved'",
            (delivery_id,),
        )
    return ReleaseResult("cancelled")


def _full_recheck(
    connection: sqlite3.Connection, delivery_id: str, now: str,
    request_policy_hash: str,
) -> tuple[object, ...] | None:
    row = connection.execute(
        "SELECT d.logical_key,d.gmail_thread_id,d.revision_hash,d.contact_id,d.mailbox_id,"
        "d.campaign_id,d.enrollment_id,r.subject,r.body,c.policy_json,c.policy_hash,cp.email,em.company_id "
        "FROM delivery d JOIN enrollment e ON e.enrollment_id=d.enrollment_id "
        "JOIN campaign c ON c.campaign_id=d.campaign_id "
        "JOIN revision r ON r.hash=d.revision_hash AND r.campaign_id=d.campaign_id AND r.person_id=e.person_id "
        "JOIN contact_point cp ON cp.contact_id=d.contact_id AND cp.person_id=e.person_id "
        "JOIN employment em ON em.person_id=e.person_id AND em.valid_to IS NULL "
        "WHERE d.delivery_id=? AND d.state='reserved' AND d.scheduled_at<=? AND e.status='scheduled' "
        "AND e.stop_reason IS NULL AND e.block_reason IS NULL AND c.status='active' "
        "AND cp.state='valid' AND EXISTS (SELECT 1 FROM eligibility_decision ed "
        "WHERE ed.campaign_id=d.campaign_id AND ed.person_id=e.person_id AND ed.outcome='eligible')",
        (delivery_id, now),
    ).fetchone()
    if row is None:
        return None
    policy = json.loads(row[9])
    try:
        local = datetime.fromisoformat(now).astimezone(ZoneInfo(policy["timezone"]))
    except ZoneInfoNotFoundError:
        return "timezone_unavailable"
    if row[10] != request_policy_hash:
        return None
    if policy.get("approval_tier") != "T0" or policy.get("mailbox_id") != row[4]:
        return None
    if not policy["send_window"].split("-")[0] <= local.strftime("%H:%M") <= policy["send_window"].split("-")[1]:
        return None
    if connection.execute(
        "SELECT 1 FROM suppression WHERE released_at IS NULL AND (scope='global' OR "
        "(scope='campaign' AND subject_key=?) OR (scope='email' AND lower(trim(subject_key))=lower(trim(?))) OR "
        "(scope='person' AND subject_key=(SELECT person_id FROM enrollment WHERE enrollment_id=?)) OR "
        "(scope='company' AND subject_key=?)) LIMIT 1", (row[5], row[11], row[6], row[12]),
    ).fetchone():
        return None
    day_count = connection.execute(
        "SELECT count(*) FROM delivery WHERE campaign_id=? AND state IN ('claimed','attempted','sent') AND substr(attempted_at,1,10)=substr(?,1,10)",
        (row[5], now),
    ).fetchone()[0]
    hour_count = connection.execute(
        "SELECT count(*) FROM delivery WHERE campaign_id=? AND state IN ('claimed','attempted','sent') AND substr(attempted_at,1,13)=substr(?,1,13)",
        (row[5], now),
    ).fetchone()[0]
    firm_count = connection.execute(
        "SELECT count(*) FROM enrollment e JOIN employment x ON x.person_id=e.person_id AND x.valid_to IS NULL "
        "WHERE e.campaign_id=? AND x.company_id=? AND e.status NOT IN ('stopped','closed')",
        (row[5], row[12]),
    ).fetchone()[0]
    if day_count >= policy["daily_cap"] or hour_count >= policy["hourly_cap"] or firm_count > policy["firm_collision_cap"]:
        return None
    return row


def execute_linearized_draft(context: ExecutorDraftContext, delivery_id: str) -> ReleaseResult:
    seed = context.connection.execute(
        "SELECT d.logical_key,d.gmail_thread_id,d.state,"
        "(SELECT parent.delivery_id FROM delivery parent WHERE parent.enrollment_id=d.enrollment_id "
        "ORDER BY parent.scheduled_at,parent.delivery_id LIMIT 1) "
        "FROM delivery d WHERE d.delivery_id=?",
        (delivery_id,),
    ).fetchone()
    if seed is None:
        return ReleaseResult("missing")
    logical_key, gmail_thread_id, initial_state, parent_delivery_id = seed
    is_follow_up = parent_delivery_id != delivery_id
    thread_key = gmail_thread_id or f"delivery:{parent_delivery_id}"
    with _lock_for(thread_key):
        if gmail_thread_id is None and is_follow_up:
            parent = context.connection.execute(
                "SELECT gmail_thread_id FROM delivery WHERE delivery_id=?", (parent_delivery_id,)
            ).fetchone()
            gmail_thread_id = parent[0] if parent is not None else None
            if gmail_thread_id is None:
                return ReleaseResult("parent_thread_unavailable")
        existing = context.gmail.thread_refresh(logical_key=logical_key)
        if existing is not None:
            with context.connection:
                context.connection.execute(
                    "UPDATE delivery SET state='attempted',gmail_message_id=?,gmail_thread_id=? WHERE delivery_id=?",
                    (existing.message_id, existing.thread_id, delivery_id),
                )
            return ReleaseResult("reconciled")
        if initial_state == "uncertain":
            return ReleaseResult("blocked")
        if context.connection.in_transaction:
            context.connection.commit()
        thread = None
        if gmail_thread_id is not None:
            context.inject(ArrivalPoint.BEFORE_REFRESH)
            thread = context.gmail.thread_refresh(gmail_thread_id)
            context.persist_inbound(thread)
            context.inject(ArrivalPoint.BETWEEN_REFRESH_AND_CAS)
            thread = context.gmail.thread_refresh(gmail_thread_id)
            context.persist_inbound(thread)
        context.connection.execute("BEGIN IMMEDIATE")
        try:
            row = _full_recheck(
                context.connection, delivery_id, context.now,
                context.request_policy_hash,
            )
            if row == "timezone_unavailable":
                context.connection.rollback()
                return ReleaseResult("timezone_unavailable")
            if row is None:
                context.connection.rollback()
                return _cancel(context.connection, delivery_id, "full_recheck")
            claimed = context.connection.execute(
                "UPDATE delivery SET state='claimed',attempted_at=? WHERE delivery_id=? AND state='reserved'",
                (context.now, delivery_id),
            ).rowcount
            if claimed != 1:
                context.connection.rollback()
                return _cancel(context.connection, delivery_id, "cas_lost")
            context.connection.commit()
        except BaseException:
            context.connection.rollback()
            raise
        context.inject(ArrivalPoint.AFTER_CAS)
        if gmail_thread_id is not None:
            thread = context.gmail.thread_refresh(gmail_thread_id)
            context.persist_inbound(thread)
        stopped = context.connection.execute(
            "SELECT 1 FROM enrollment e JOIN delivery d ON d.enrollment_id=e.enrollment_id "
            "WHERE d.delivery_id=? AND (e.status!='scheduled' OR e.stop_reason IS NOT NULL OR e.block_reason IS NOT NULL)",
            (delivery_id,),
        ).fetchone()
        if stopped:
            with context.connection:
                context.connection.execute(
                    "UPDATE delivery SET state='reserved',attempted_at=NULL WHERE delivery_id=? AND state='claimed'",
                    (delivery_id,),
                )
            return ReleaseResult("stopped_after_claim")
        parent = thread.messages[-1].rfc_message_id if thread is not None else None
        references = (tuple(message.rfc_message_id for message in thread.messages if not message.inbound)
                      if thread is not None else ())
        draft = context.gmail.draft_create_in_thread(
            logical_key=row[0], contact_id=row[3], thread_id=gmail_thread_id,
            subject=row[7], body=row[8], parent_message_id=parent, references=references,
        )
        refreshed = context.gmail.thread_refresh(draft.thread_id)
        post = any(message.inbound and message.message_id not in {m.message_id for m in thread.messages} for message in refreshed.messages)
        if post:
            context.persist_inbound(refreshed)
        with context.connection:
            context.connection.execute(
                "UPDATE delivery SET state='attempted',gmail_message_id=?,gmail_thread_id=? WHERE delivery_id=?",
                (draft.message_id, draft.thread_id, delivery_id),
            )
            context.connection.execute(
                "UPDATE delivery SET gmail_thread_id=? WHERE enrollment_id=(SELECT enrollment_id FROM delivery WHERE delivery_id=?) "
                "AND gmail_thread_id IS NULL AND delivery_id!=?",
                (draft.thread_id, delivery_id, delivery_id),
            )
            requests = CampaignerRequests(context.connection, context.request_policy_hash, context.now)
            for label_code in ("sent", "followup_due"):
                requests.enqueue(
                    operation="gmail_label", action="labels_modify",
                    payload={"gmail_thread_id": draft.thread_id, "label_code": label_code},
                    include_action=False,
                )
            event_id = hashlib.sha256(f"draft:{delivery_id}:{draft.message_id}".encode()).hexdigest()
            context.connection.execute(
                "INSERT INTO audit VALUES(?,?,'gmail_draft','delivery',?,?,?,?,?)",
                (event_id, 'executor', delivery_id, context.now, 'claimed', 'attempted',
                 f'draft_created:dl_{delivery_id}'),
            )
            if post:
                event_id = hashlib.sha256(f"post:{delivery_id}".encode()).hexdigest()
                context.connection.execute(
                    "INSERT OR IGNORE INTO audit VALUES(?,?,'post_linearization_reply','delivery',?,?,NULL,NULL,?)",
                    (event_id, 'executor', delivery_id, context.now, 'outside_prevention_guarantee'),
                )
        return ReleaseResult("drafted", post_linearization=post)


def execute_gmail_draft(
    connection: sqlite3.Connection,
    gmail: GmailAdapter,
    revision_id: str,
    contact_id: str,
    mailbox_id: str,
) -> FakeMessage:
    row = connection.execute(
        "SELECT i.gmail_thread_id,r.subject,r.body,r.hash,r.contact_id,r.mailbox_id,t.body_hash "
        "FROM reply_revision r JOIN inbound i ON i.inbound_id=r.inbound_id "
        "JOIN reply_template t ON t.id=r.template_id AND t.version=r.template_version "
        "WHERE r.reply_revision_id=? AND r.contact_id=? AND r.mailbox_id=? "
        "AND r.generation_mode='deterministic_template'",
        (revision_id, contact_id, mailbox_id),
    ).fetchone()
    if row is None:
        raise ValueError("reply_revision_not_deterministic")
    thread_id, subject, body, revision_hash, revision_contact_id, revision_mailbox_id, template_hash = row
    if hashlib.sha256(body.encode()).hexdigest() != template_hash:
        raise ValueError("reply_template_hash_mismatch")
    with _lock_for(thread_id):
        thread = gmail.thread_refresh(thread_id)
        if thread is None or not thread.messages:
            raise ValueError("reply_thread_empty")
        if thread.subject != subject:
            raise ValueError("reply_subject_mismatch")
        parent = thread.messages[-1].rfc_message_id
        references = tuple(message.rfc_message_id for message in thread.messages)
        return gmail.draft_create_in_thread(
            logical_key=revision_hash, contact_id=revision_contact_id, thread_id=thread_id,
            subject=subject, body=body, parent_message_id=parent,
            references=references,
        )


OPERATION_HANDLERS = {
    "gmail_draft": execute_gmail_draft,
}
