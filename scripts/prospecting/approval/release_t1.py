"""P6 T1 release queueing and guarded Gmail send integration."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import sqlite3
from typing import Protocol
from zoneinfo import ZoneInfo

from scripts.prospecting.campaigner.inbound import InboundEnvelope, process_inbound
from scripts.prospecting.executor import Executor
from scripts.prospecting.store import (
    ENABLED_SEND_TIERS,
    ExecRequest,
    approval_scope_hash,
    consume_send_approval,
    insert_exec_request,
)


class SendBackend(Protocol):
    def history_fence(self) -> str: ...

    def history_list(self, start_history_id: str) -> tuple[dict[str, str], ...]: ...

    def send(
        self, *, delivery_id: str, logical_key: str, rfc_message_id: str, history_id: str
    ): ...


class FenceUnavailable(RuntimeError):
    """The backend cannot prove the mailbox remained unchanged through send."""


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("now_must_be_timezone_aware")
    return value.astimezone(timezone.utc)


def _now(connection: sqlite3.Connection) -> datetime:
    value = connection.execute("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')").fetchone()[0]
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _request_id(logical_key: str) -> str:
    return "req_" + hashlib.sha256(f"p6:t1:{logical_key}".encode("ascii")).hexdigest()[:16]


def consume_t1_approval(
    connection: sqlite3.Connection, approval_id: str, consumed_at: str
) -> None:
    """Consume an approval once at the T1 Gmail-send boundary."""
    changed = connection.execute(
        """UPDATE approval SET consumed_at=?
           WHERE approval_id=?
             AND consumed_at IS NULL AND invalidation_reason IS NULL""",
        (consumed_at, approval_id),
    ).rowcount
    if changed != 1:
        raise ValueError("approval_already_resolved")


def queue_due_t1(connection: sqlite3.Connection, now: datetime) -> tuple[str, ...]:
    """Queue every due, approved D0 delivery once through the typed store boundary."""
    now = _as_utc(now)
    stamp = now.isoformat()
    rows = connection.execute(
        """SELECT d.delivery_id,d.logical_key,c.policy_hash,a.approval_id
           FROM delivery d JOIN campaign c ON c.campaign_id=d.campaign_id
           JOIN enrollment e ON e.enrollment_id=d.enrollment_id
           JOIN approval a ON a.campaign_id=d.campaign_id AND a.revision_hash=d.revision_hash
                AND a.contact_id=d.contact_id AND a.mailbox_id=d.mailbox_id
           WHERE d.step=0 AND d.state='reserved' AND d.scheduled_at<=?
             AND c.status='active' AND c.intent<>'sales' AND c.approval_tier='T1'
             AND e.status='scheduled' AND e.stop_reason IS NULL AND e.block_reason IS NULL
             AND a.tier='T1' AND a.content_kind='revision' AND a.permitted_action='send_revision'
             AND a.consumed_at IS NULL AND a.invalidation_reason IS NULL
             AND a.approved_at<=? AND a.expires_at>=?
             AND json_extract(a.send_window,'$.start')<=? AND json_extract(a.send_window,'$.end')>=?
           ORDER BY d.logical_key,a.approved_at,a.approval_id""",
        (stamp, stamp, stamp, stamp, stamp),
    ).fetchall()
    queued: list[str] = []
    seen: set[str] = set()
    for row in rows:
        delivery_id = str(row["delivery_id"])
        if delivery_id in seen:
            continue
        seen.add(delivery_id)
        request_id = _request_id(str(row["logical_key"]))
        if connection.execute("SELECT 1 FROM exec_request WHERE request_id=?", (request_id,)).fetchone():
            continue
        request = ExecRequest(request_id, "prospecting-campaigner", "gmail_send", {"delivery_id": delivery_id}, str(row["policy_hash"]), str(row["approval_id"]), stamp)
        try:
            insert_exec_request(connection, request, "T1", stamp)
        except sqlite3.IntegrityError:
            if not connection.execute("SELECT 1 FROM exec_request WHERE request_id=?", (request_id,)).fetchone():
                raise
        else:
            queued.append(request_id)
    return tuple(queued)


def _reconcile(backend: object, rfc_message_id: str):
    messages = getattr(backend, "messages_list", None)
    if messages is None:
        return None
    matches = tuple(messages(f"rfc822msgid:{rfc_message_id}"))
    if len(matches) > 1:
        raise RuntimeError("duplicate_rfc_message_id")
    return matches[0] if matches else None


def _load_bound_row(connection: sqlite3.Connection, request: ExecRequest):
    return connection.execute(
        """SELECT d.delivery_id,d.logical_key,d.rfc_message_id,d.gmail_thread_id,d.state delivery_state,d.step,
                  d.revision_hash delivery_revision_hash,d.contact_id delivery_contact_id,d.mailbox_id delivery_mailbox_id,
                  c.campaign_id,c.policy_hash,c.status,c.intent,c.approval_tier,c.send_window campaign_send_window,
                  c.timezone,c.daily_cap,c.hourly_cap,c.firm_collision_cap,c.policy_json,e.enrollment_id,
                  e.status enrollment_status,e.stop_reason,e.block_reason,cp.state contact_state,
                  a.assertion_ref,a.campaign_id approval_campaign_id,a.policy_hash approval_policy_hash,a.content_kind,
                  a.revision_hash approval_revision_hash,a.contact_id approval_contact_id,a.mailbox_id approval_mailbox_id,
                  a.approver,a.approved_at,a.expires_at,a.tier,a.send_window,a.nonce,a.permitted_action,a.consumed_at,
                  a.scope_hash,a.invalidation_reason,er.request_id
           FROM delivery d JOIN campaign c ON c.campaign_id=d.campaign_id
           JOIN enrollment e ON e.enrollment_id=d.enrollment_id JOIN contact_point cp ON cp.contact_id=d.contact_id
           JOIN approval a ON a.approval_id=? JOIN exec_request er ON er.request_id=? WHERE d.delivery_id=?""",
        (request.approval_id, request.request_id, request.payload["delivery_id"]),
    ).fetchone()


def _is_exact_t1(row: sqlite3.Row, request: ExecRequest, now: datetime) -> bool:
    if ENABLED_SEND_TIERS != ("T1",):
        return False
    required = (
        row["approval_campaign_id"] == row["campaign_id"], row["approval_policy_hash"] == row["policy_hash"],
        row["approval_policy_hash"] == request.policy_hash, row["status"] == "active", row["intent"] != "sales",
        row["approval_tier"] == "T1", row["tier"] == "T1", row["step"] == 0,
        row["delivery_state"] == "reserved", row["enrollment_status"] == "scheduled",
        row["stop_reason"] is None, row["block_reason"] is None, row["contact_state"] == "valid",
        row["content_kind"] == "revision", row["permitted_action"] == "send_revision",
        row["consumed_at"] is not None, row["invalidation_reason"] is None,
        row["approval_revision_hash"] == row["delivery_revision_hash"],
        row["approval_contact_id"] == row["delivery_contact_id"], row["approval_mailbox_id"] == row["delivery_mailbox_id"],
    )
    if not all(required):
        return False
    try:
        window = json.loads(row["send_window"])
        start = datetime.fromisoformat(window["start"]).astimezone(timezone.utc)
        end = datetime.fromisoformat(window["end"]).astimezone(timezone.utc)
        expires = datetime.fromisoformat(row["expires_at"]).astimezone(timezone.utc)
    except (KeyError, TypeError, ValueError):
        return False
    fields = {key: row[key] for key in (
        "assertion_ref", "content_kind", "approver", "approved_at", "tier", "send_window", "expires_at", "nonce", "permitted_action"
    )}
    fields.update(campaign_id=row["approval_campaign_id"], policy_hash=row["approval_policy_hash"],
                  revision_hash=row["approval_revision_hash"], contact_id=row["approval_contact_id"], mailbox_id=row["approval_mailbox_id"])
    return start <= now <= end and now <= expires and row["scope_hash"] == approval_scope_hash(fields)


def _lock_key(row: sqlite3.Row) -> str:
    return str(row["gmail_thread_id"] or f"delivery:{row['delivery_id']}")


def _release_lock(connection: sqlite3.Connection, key: str) -> None:
    with connection:
        connection.execute("DELETE FROM t1_thread_lock WHERE thread_key=?", (key,))


def _acquire_lock(connection: sqlite3.Connection, row: sqlite3.Row) -> str:
    key = _lock_key(row)
    try:
        with connection:
            connection.execute("INSERT INTO t1_thread_lock(thread_key,delivery_id,acquired_at) VALUES(?,?,?)", (key, row["delivery_id"], _now(connection).isoformat()))
    except sqlite3.IntegrityError as error:
        raise RuntimeError("thread_locked") from error
    return key


def _breaker_code(connection: sqlite3.Connection, campaign_id: str) -> str | None:
    row = connection.execute(
        """SELECT scope FROM t1_breaker WHERE cleared_at IS NULL
           AND (scope='global' OR (scope='campaign' AND subject_key=?))
           ORDER BY CASE scope WHEN 'global' THEN 0 ELSE 1 END LIMIT 1""", (campaign_id,)
    ).fetchone()
    return None if row is None else ("global_pause" if row["scope"] == "global" else "campaign_pause")


def _record_breaker(connection: sqlite3.Connection, scope: str, subject_key: str, reason: str) -> None:
    with connection:
        connection.execute(
            """INSERT INTO t1_breaker(scope,subject_key,reason,tripped_at,cleared_at) VALUES(?,?,?,?,NULL)
               ON CONFLICT(scope,subject_key) DO UPDATE SET reason=excluded.reason,tripped_at=excluded.tripped_at,cleared_at=NULL""",
            (scope, subject_key, reason, _now(connection).isoformat()),
        )


def _google_warning(headers: object) -> bool:
    if not isinstance(headers, dict):
        return False
    material = " ".join(f"{key}:{value}" for key, value in headers.items()).casefold()
    return "google" in material and any(token in material for token in ("warning", "suspicious", "violation", "abuse"))


def _campaign_bounce_breaker(connection: sqlite3.Connection, campaign_id: str, timezone_name: str) -> None:
    try:
        from zoneinfo import ZoneInfo
        zone = ZoneInfo(timezone_name)
    except Exception:
        zone = timezone.utc
    today = _now(connection).astimezone(zone).date()
    rows = connection.execute(
        "SELECT i.received_at FROM inbound i JOIN enrollment e ON e.enrollment_id=i.enrollment_id WHERE e.campaign_id=? AND i.class='bounce_failed'", (campaign_id,)
    ).fetchall()
    if sum(datetime.fromisoformat(row["received_at"]).astimezone(zone).date() == today for row in rows) >= 2:
        _record_breaker(connection, "campaign", campaign_id, "bounce_threshold")


def _observe_inbox(connection: sqlite3.Connection, backend: SendBackend, row: sqlite3.Row) -> None:
    """Apply known-thread inbound and scan the whole mailbox for global warnings."""
    messages: dict[str, object] = {}
    if row["gmail_thread_id"] is not None:
        getter = getattr(backend, "thread_get", None) or getattr(backend, "thread_refresh", None)
        if getter is None:
            raise RuntimeError("thread_refresh_unavailable")
        thread = getter(str(row["gmail_thread_id"]))
        for message in getattr(thread, "messages", ()):
            messages[str(message.message_id)] = message
    scanner = getattr(backend, "messages_list", None)
    if scanner is None:
        raise RuntimeError("mailbox_scan_unavailable")
    for message in scanner("in:inbox"):
        messages[str(message.message_id)] = message
    for message in messages.values():
        if not getattr(message, "inbound", False):
            continue
        first_observation = connection.execute(
            "INSERT INTO t1_mailbox_observation(message_id,observed_at) VALUES(?,?) "
            "ON CONFLICT(message_id) DO NOTHING",
            (message.message_id, _now(connection).isoformat()),
        ).rowcount == 1
        if first_observation and _google_warning(message.headers):
            _record_breaker(connection, "global", "global", "google_warning")
        enrollment = connection.execute(
            "SELECT enrollment_id FROM delivery WHERE gmail_thread_id=?",
            (message.thread_id,),
        ).fetchone()
        if enrollment is None:
            continue
        process_inbound(connection, InboundEnvelope(
            message.message_id, message.thread_id, str(enrollment["enrollment_id"]),
            _now(connection).isoformat(), message.headers,
            lambda message=message: message.body,
        ))


def _preflight(executor: Executor, backend: SendBackend, request: ExecRequest) -> None:
    """Claim the thread; inbound observation is deliberately repeated in the send path."""
    if request.operation != "gmail_send":
        return
    row = _load_bound_row(executor.connection, request)
    if row is None or _breaker_code(executor.connection, str(row["campaign_id"])) is not None:
        raise RuntimeError("release_blocked")
    _acquire_lock(executor.connection, row)


def _reject_before_send(executor: Executor, key: str, reason: str) -> tuple[str, str]:
    executor.connection.rollback()
    _release_lock(executor.connection, key)
    return "rejected", reason


def _window_bounds(row: sqlite3.Row, now: datetime) -> tuple[datetime, datetime]:
    try:
        start_text, end_text = str(row["campaign_send_window"]).split("-", 1)
        zone = timezone.utc if row["timezone"] == "UTC" else ZoneInfo(str(row["timezone"]))
        start_time = datetime.strptime(start_text, "%H:%M").time()
        end_time = datetime.strptime(end_text, "%H:%M").time()
    except Exception as error:
        raise RuntimeError("campaign_send_window_invalid") from error
    local_now = now.astimezone(zone)
    return (
        datetime.combine(local_now.date(), start_time, zone),
        datetime.combine(local_now.date(), end_time, zone),
    )


def _next_slot(row: sqlite3.Row, now: datetime, reason: str) -> datetime:
    start, end = _window_bounds(row, now)
    if reason in {"daily_cap", "firm_cap"} or now >= end:
        next_day = start.date() + timedelta(days=1)
        return datetime.combine(next_day, start.timetz()).astimezone(timezone.utc)
    if now < start:
        return start.astimezone(timezone.utc)
    return (now.astimezone(start.tzinfo).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).astimezone(timezone.utc)


def _defer_before_send(executor: Executor, row: sqlite3.Row, key: str, reason: str) -> tuple[str, str]:
    executor.connection.rollback()
    with executor.connection:
        executor.connection.execute(
            "UPDATE delivery SET scheduled_at=? WHERE delivery_id=? AND state='reserved'",
            (_next_slot(row, _now(executor.connection), reason).isoformat(), row["delivery_id"]),
        )
        executor.connection.execute(
            "UPDATE exec_request SET state='queued',reason='deferred' WHERE request_id=? AND state='claimed'",
            (row["request_id"],),
        )
    _release_lock(executor.connection, key)
    return "rejected", "deferred"


def _send_limit(connection: sqlite3.Connection, row: sqlite3.Row, now: datetime) -> str | None:
    start, end = _window_bounds(row, now)
    if not start <= now <= end:
        return "send_window"
    try:
        live_gate = bool(json.loads(row["policy_json"]).get("t1_live_gate", False))
    except (TypeError, ValueError, json.JSONDecodeError):
        live_gate = False
    daily_cap = min(int(row["daily_cap"]), 50 if live_gate else 25)
    hourly_cap = min(int(row["hourly_cap"]), 6)
    firm_cap = int(row["firm_collision_cap"])
    hour = now.replace(minute=0, second=0, microsecond=0)
    day_count = connection.execute(
        "SELECT count(*) FROM delivery WHERE campaign_id=? AND state IN ('claimed','sent','uncertain') AND attempted_at>=? AND attempted_at<?",
        (row["campaign_id"], start.astimezone(timezone.utc).isoformat(), (start + timedelta(days=1)).astimezone(timezone.utc).isoformat()),
    ).fetchone()[0]
    hour_count = connection.execute(
        "SELECT count(*) FROM delivery WHERE campaign_id=? AND state IN ('claimed','sent','uncertain') AND attempted_at>=? AND attempted_at<?",
        (row["campaign_id"], hour.isoformat(), (hour + timedelta(hours=1)).isoformat()),
    ).fetchone()[0]
    firm_count = connection.execute(
        """SELECT count(*) FROM delivery d JOIN contact_point cp ON cp.contact_id=d.contact_id
           LEFT JOIN employment emp ON emp.person_id=cp.person_id
           WHERE d.state IN ('claimed','sent','uncertain') AND d.attempted_at>=? AND d.attempted_at<?
             AND coalesce(emp.company_id,'')=coalesce((SELECT emp2.company_id FROM contact_point cp2
                 LEFT JOIN employment emp2 ON emp2.person_id=cp2.person_id WHERE cp2.contact_id=?), '')""",
        (start.astimezone(timezone.utc).isoformat(), (start + timedelta(days=1)).astimezone(timezone.utc).isoformat(), row["delivery_contact_id"]),
    ).fetchone()[0]
    if day_count >= daily_cap:
        return "daily_cap"
    if hour_count >= hourly_cap:
        return "hourly_cap"
    if firm_count >= firm_cap:
        return "firm_cap"
    return None


def _history_fence(backend: SendBackend) -> str:
    marker = getattr(backend, "history_fence", None)
    history = getattr(backend, "history_list", None)
    if not callable(marker) or not callable(history):
        raise FenceUnavailable("fence_unavailable")
    value = marker()
    if not isinstance(value, str) or not value:
        raise FenceUnavailable("fence_unavailable")
    return value


def _fence_clear(backend: SendBackend, history_id: str) -> bool:
    history = getattr(backend, "history_list", None)
    if not callable(history):
        return False
    try:
        return not tuple(history(history_id))
    except Exception:
        return False


def _reject_after_claim_fence(executor: Executor, key: str, request_id: str, delivery_id: str) -> tuple[str, str]:
    with executor.connection:
        executor.connection.execute(
            "UPDATE delivery SET state='reserved',attempted_at=NULL WHERE delivery_id=? AND state='claimed'",
            (delivery_id,),
        )
        executor.connection.execute("DELETE FROM t1_delivery_guard WHERE delivery_id=?", (delivery_id,))
        executor.connection.execute("DELETE FROM t1_send_fence WHERE request_id=?", (request_id,))
        executor.connection.execute("DELETE FROM t1_send_attempt WHERE request_id=?", (request_id,))
    _release_lock(executor.connection, key)
    return "rejected", "fence_unavailable"


def _adapter(executor: Executor, backend: SendBackend, request: ExecRequest) -> tuple[str, str]:
    if request.operation != "gmail_send" or set(request.payload) != {"delivery_id"}:
        return "rejected", "typed_payload"
    row = _load_bound_row(executor.connection, request)
    if row is None or not _is_exact_t1(row, request, _now(executor.connection)):
        return "rejected", "approval_scope_rejected"
    key = _lock_key(row)
    lock = executor.connection.execute("SELECT delivery_id FROM t1_thread_lock WHERE thread_key=?", (key,)).fetchone()
    if lock is None or lock["delivery_id"] != row["delivery_id"]:
        return "rejected", "thread_lock_missing"
    # Executor consumed the approval in its provisional transaction.  Drop that
    # provisional state so process_inbound can commit its own stop transitions.
    executor.connection.rollback()
    try:
        _observe_inbox(executor.connection, backend, row)
        history_id = _history_fence(backend)
    except FenceUnavailable:
        _release_lock(executor.connection, key)
        return "rejected", "fence_unavailable"
    except Exception:
        _release_lock(executor.connection, key)
        raise
    executor.connection.execute("BEGIN IMMEDIATE")
    try:
        consume_send_approval(executor.connection, request, "T1", executor._trusted_now())
        row = _load_bound_row(executor.connection, request)
        if row is None or not _is_exact_t1(row, request, _now(executor.connection)):
            return _reject_before_send(executor, key, "approval_scope_rejected")
        if executor.connection.execute("SELECT 1 FROM suppression WHERE scope='global' AND released_at IS NULL").fetchone():
            return _reject_before_send(executor, key, "global_suppression")
        if _breaker_code(executor.connection, str(row["campaign_id"])):
            return _reject_before_send(executor, key, "breaker_open")
        _campaign_bounce_breaker(executor.connection, str(row["campaign_id"]), str(row["timezone"]))
        if _breaker_code(executor.connection, str(row["campaign_id"])):
            return _reject_before_send(executor, key, "breaker_open")
        state = executor.connection.execute("SELECT status,stop_reason,block_reason FROM enrollment WHERE enrollment_id=?", (row["enrollment_id"],)).fetchone()
        if state is None or tuple(state) != ("scheduled", None, None):
            return _reject_before_send(executor, key, "enrollment_stopped")
        now = _now(executor.connection)
        limit = _send_limit(executor.connection, row, now)
        if limit is not None:
            return _defer_before_send(executor, row, key, limit)
        if not _fence_clear(backend, history_id):
            return _reject_before_send(executor, key, "fence_unavailable")
    except Exception:
        executor.connection.rollback()
        _release_lock(executor.connection, key)
        raise
    existing = _reconcile(backend, str(row["rfc_message_id"]))
    if existing is not None:
        executor.connection.execute("UPDATE delivery SET state='sent',gmail_message_id=?,gmail_thread_id=?,sent_at=? WHERE delivery_id=? AND state='reserved'", (existing.message_id, existing.thread_id, now.isoformat(), row["delivery_id"]))
        executor.connection.execute("INSERT INTO t1_delivery_guard(delivery_id,state,updated_at) VALUES(?,?,?) ON CONFLICT(delivery_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at", (row["delivery_id"], "sent", now.isoformat()))
        return "succeeded", "reconciled"
    if executor.connection.execute("UPDATE delivery SET state='claimed',attempted_at=? WHERE delivery_id=? AND state='reserved'", (now.isoformat(), row["delivery_id"])).rowcount != 1:
        return _reject_before_send(executor, key, "delivery_cas")
    executor.connection.execute("INSERT INTO t1_delivery_guard(delivery_id,state,updated_at) VALUES(?,?,?) ON CONFLICT(delivery_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at", (row["delivery_id"], "sending", now.isoformat()))
    # Commit the state claim, then record the external-call intent in an independent
    # transaction. A process loss after Gmail accepts the message leaves this row open.
    executor.connection.commit()
    with executor.connection:
        executor.connection.execute(
            "INSERT INTO t1_send_attempt(request_id,delivery_id,started_at) VALUES(?,?,?) "
            "ON CONFLICT(request_id) DO NOTHING",
            (request.request_id, row["delivery_id"], _now(executor.connection).isoformat()),
        )
        executor.connection.execute(
            "INSERT INTO t1_send_fence(request_id,history_id,observed_at) VALUES(?,?,?) "
            "ON CONFLICT(request_id) DO UPDATE SET history_id=excluded.history_id,observed_at=excluded.observed_at",
            (request.request_id, history_id, _now(executor.connection).isoformat()),
        )
    try:
        message = backend.send(
            delivery_id=str(row["delivery_id"]), logical_key=str(row["logical_key"]),
            rfc_message_id=str(row["rfc_message_id"]), history_id=history_id,
        )
    except FenceUnavailable:
        return _reject_after_claim_fence(executor, key, request.request_id, str(row["delivery_id"]))
    except Exception:
        with executor.connection:
            executor.connection.execute("UPDATE delivery SET state='uncertain' WHERE delivery_id=? AND state='claimed'", (row["delivery_id"],))
            executor.connection.execute("UPDATE t1_delivery_guard SET state='uncertain',updated_at=? WHERE delivery_id=?", (_now(executor.connection).isoformat(), row["delivery_id"]))
        return "rejected", "send_uncertain"
    with executor.connection:
        executor.connection.execute("UPDATE delivery SET state='sent',gmail_message_id=?,gmail_thread_id=?,sent_at=? WHERE delivery_id=? AND state='claimed'", (message.message_id, message.thread_id, _now(executor.connection).isoformat(), row["delivery_id"]))
        executor.connection.execute("UPDATE t1_delivery_guard SET state='sent',updated_at=? WHERE delivery_id=?", (_now(executor.connection).isoformat(), row["delivery_id"]))
        executor.connection.execute("UPDATE t1_send_attempt SET completed_at=? WHERE request_id=?", (_now(executor.connection).isoformat(), request.request_id))
    return "succeeded", "sent"


def reconcile_uncertain_t1(connection: sqlite3.Connection, backend: object, delivery_id: str) -> bool:
    row = connection.execute("SELECT rfc_message_id FROM delivery WHERE delivery_id=? AND state='uncertain'", (delivery_id,)).fetchone()
    if row is None:
        return False
    message = _reconcile(backend, str(row["rfc_message_id"]))
    if message is None:
        return False
    with connection:
        connection.execute("UPDATE delivery SET state='sent',gmail_message_id=?,gmail_thread_id=?,sent_at=? WHERE delivery_id=? AND state='uncertain'", (message.message_id, message.thread_id, _now(connection).isoformat(), delivery_id))
        connection.execute("UPDATE t1_delivery_guard SET state='sent',updated_at=? WHERE delivery_id=?", (_now(connection).isoformat(), delivery_id))
    return True


def recover_unfinished_t1_attempts(connection: sqlite3.Connection, backend: object) -> int:
    """Fence crash-left send intents before registering an adapter that can retry work."""
    attempts = connection.execute(
        "SELECT request_id,delivery_id FROM t1_send_attempt WHERE completed_at IS NULL ORDER BY started_at,request_id"
    ).fetchall()
    recovered = 0
    for attempt in attempts:
        request_id, delivery_id = str(attempt["request_id"]), str(attempt["delivery_id"])
        with connection:
            connection.execute(
                "UPDATE exec_request SET state='uncertain',reason='send_attempt_unfinished' "
                "WHERE request_id=? AND state IN ('queued','claimed')",
                (request_id,),
            )
            connection.execute(
                "UPDATE delivery SET state='uncertain' WHERE delivery_id=? AND state='claimed'",
                (delivery_id,),
            )
            connection.execute(
                "INSERT INTO t1_delivery_guard(delivery_id,state,updated_at) VALUES(?,?,?) "
                "ON CONFLICT(delivery_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at",
                (delivery_id, "uncertain", _now(connection).isoformat()),
            )
        if reconcile_uncertain_t1(connection, backend, delivery_id):
            with connection:
                connection.execute(
                    "UPDATE t1_send_attempt SET completed_at=? WHERE request_id=? AND completed_at IS NULL",
                    (_now(connection).isoformat(), request_id),
                )
            recovered += 1
    return recovered


def attach_t1_send(executor: Executor, backend: SendBackend) -> None:
    if ENABLED_SEND_TIERS != ("T1",):
        raise RuntimeError("unexpected_enabled_send_tiers")
    recover_unfinished_t1_attempts(executor.connection, backend)
    executor.hooks = (*executor.hooks, lambda request: _preflight(executor, backend, request))
    executor.register_adapter("gmail_send", lambda request: _adapter(executor, backend, request))
