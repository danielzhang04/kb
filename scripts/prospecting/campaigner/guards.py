"""Reason-coded suppression and circuit breaker.

Requires the host's ``tzdata`` package so campaign IANA timezones can be
resolved by :class:`zoneinfo.ZoneInfo`.
"""
from __future__ import annotations
import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@dataclass(frozen=True)
class GuardResult:
    paused: bool
    reason: str | None
    wake_me_requested: bool


def suppress(connection: sqlite3.Connection, scope: str, subject_key: str,
             reason: str, created_at: str, created_by: str = 'campaigner') -> str:
    suppression_id = hashlib.sha256(f'{scope}:{subject_key}:{reason}'.encode()).hexdigest()
    with connection:
        connection.execute(
            """INSERT INTO suppression
               (suppression_id, scope, subject_key, reason, created_at, created_by,
                released_at, released_by)
               VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
               ON CONFLICT(suppression_id) DO UPDATE SET
                 reason=excluded.reason,
                 created_at=excluded.created_at,
                 created_by=excluded.created_by,
                 released_at=NULL,
                 released_by=NULL""",
            (suppression_id, scope, subject_key, reason, created_at, created_by),
        )
    return suppression_id


def evaluate_circuit_breaker(connection: sqlite3.Connection, campaign_id: str,
                             local_day: str, warning_code: str | None) -> GuardResult:
    if warning_code not in {None, 'gmail_unusual_activity_warning'}:
        raise ValueError('unknown_gmail_warning')
    row = connection.execute(
        "SELECT policy_json FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    if row is None:
        raise ValueError('campaign_missing')
    timezone_name = json.loads(row[0])['timezone']
    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return _pause_and_request_wake_me(
            connection, local_day, 'timezone_unavailable'
        )
    bounces = sum(
        1 for (received_at,) in connection.execute(
            "SELECT received_at FROM inbound WHERE class='bounce_failed'"
        )
        if datetime.fromisoformat(received_at).astimezone(timezone).date().isoformat()
        == local_day
    )
    reason = 'google_warning' if warning_code == 'gmail_unusual_activity_warning' else ('hard_bounce_threshold' if bounces >= 2 else None)
    if reason is None:
        return GuardResult(False, None, False)
    return _pause_and_request_wake_me(connection, local_day, reason)


def _pause_and_request_wake_me(connection: sqlite3.Connection, local_day: str,
                               reason: str) -> GuardResult:
    """Pause active campaigns and emit one wake-me event per day and reason."""
    event_id = hashlib.sha256(f'breaker:{local_day}:{reason}'.encode()).hexdigest()
    with connection:
        connection.execute("UPDATE campaign SET status='paused' WHERE status='active'")
        inserted = connection.execute(
            "INSERT OR IGNORE INTO audit VALUES(?,?,'wake_me_requested','breaker',?,?,NULL,NULL,?)",
            (event_id, 'executor', local_day, f'{local_day}T00:00:00', reason),
        ).rowcount
    return GuardResult(True, reason, inserted == 1)
