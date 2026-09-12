"""Stable next-morning scheduling for materialized T1 first touches."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import sqlite3
from zoneinfo import ZoneInfo


def _jitter(logical_key: str) -> int:
    return 480 + int(hashlib.sha256(logical_key.encode("ascii")).hexdigest()[:8], 16) % 241


def schedule_approved_t1(connection: sqlite3.Connection, now: datetime) -> tuple[datetime, ...]:
    """Assign at most one day's permitted T1 first touches without catch-up scheduling."""
    now = now.astimezone(timezone.utc)
    rows = connection.execute(
        """SELECT d.delivery_id,d.logical_key,d.scheduled_at,a.send_window,c.daily_cap,c.campaign_id,c.policy_json
           FROM delivery AS d JOIN campaign AS c ON c.campaign_id=d.campaign_id
           JOIN enrollment AS e ON e.enrollment_id=d.enrollment_id
           JOIN approval AS a ON a.campaign_id=d.campaign_id AND a.revision_hash=d.revision_hash
                AND a.contact_id=d.contact_id AND a.mailbox_id=d.mailbox_id
           WHERE d.step=0 AND d.state='reserved' AND c.status='active'
             AND c.approval_tier='T1' AND c.intent<>'sales' AND e.status='scheduled'
             AND e.stop_reason IS NULL AND e.block_reason IS NULL AND a.tier='T1'
             AND a.content_kind='revision' AND a.permitted_action='send_revision'
             AND a.consumed_at IS NULL AND a.invalidation_reason IS NULL
           ORDER BY d.campaign_id,d.logical_key"""
    ).fetchall()
    scheduled: list[datetime] = []
    cursors: dict[tuple[str, str], datetime] = {}
    counts: dict[tuple[str, str], int] = {}
    for row in rows:
        try:
            window = json.loads(row[3])
            start = datetime.fromisoformat(window["start"]).astimezone(timezone.utc)
            end = datetime.fromisoformat(window["end"]).astimezone(timezone.utc)
        except (KeyError, TypeError, ValueError):
            continue
        key = (row[5], str(start.date()))
        if now >= start:
            connection.execute(
                "UPDATE enrollment SET block_reason='machine_unavailable' WHERE enrollment_id="
                "(SELECT enrollment_id FROM delivery WHERE delivery_id=?)", (row[0],)
            )
            continue
        try:
            live_gate = bool(json.loads(row[6]).get("t1_live_gate", False))
        except (TypeError, ValueError, json.JSONDecodeError):
            live_gate = False
        if counts.get(key, 0) >= min(50 if live_gate else 25, int(row[4])):
            continue
        current = datetime.fromisoformat(row[2]).astimezone(timezone.utc) if row[2] else None
        candidate = current if current is not None and current > start else (
            start if key not in cursors else cursors[key] + timedelta(seconds=_jitter(row[1]))
        )
        if candidate > end:
            continue
        connection.execute(
            "UPDATE delivery SET scheduled_at=? WHERE delivery_id=? AND state='reserved'",
            (candidate.isoformat(), row[0]),
        )
        cursors[key] = candidate
        counts[key] = counts.get(key, 0) + 1
        scheduled.append(candidate)
    return tuple(scheduled)


def _next_business_day(day):
    day += timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def _batch_jitter(batch_hash: str, logical_key: str) -> timedelta:
    seed = hashlib.sha256(f"{batch_hash}:{logical_key}".encode("ascii")).digest()
    return timedelta(minutes=8 + int.from_bytes(seed[:2], "big") % 5)


def stagger_deliveries(
    connection: sqlite3.Connection, campaign_id: str, batch_hash: str, now: datetime
) -> tuple[datetime, ...]:
    """Materialize a deterministic T1 batch under hourly, daily, and firm caps.

    ``BEGIN IMMEDIATE`` deliberately serializes WAL writers: every schedule calculation
    observes and reserves its slots in one transaction, so the firm cap also holds across
    two desktop workers.
    """
    if len(batch_hash) != 64 or any(char not in "0123456789abcdef" for char in batch_hash):
        raise ValueError("batch_hash_must_be_sha256")
    if now.tzinfo is None:
        raise ValueError("now_must_be_timezone_aware")
    connection.execute("BEGIN IMMEDIATE")
    try:
        campaign = connection.execute(
            "SELECT send_window,timezone,daily_cap,hourly_cap,firm_collision_cap,policy_json "
            "FROM campaign WHERE campaign_id=? AND status='active' AND approval_tier='T1'",
            (campaign_id,),
        ).fetchone()
        if campaign is None:
            raise ValueError("active_t1_campaign_required")
        zone = timezone.utc if campaign["timezone"] == "UTC" else ZoneInfo(str(campaign["timezone"]))
        start_text, end_text = str(campaign["send_window"]).split("-", 1)
        start_time = datetime.strptime(start_text, "%H:%M").time()
        end_time = datetime.strptime(end_text, "%H:%M").time()
        try:
            live_gate = bool(json.loads(campaign["policy_json"]).get("t1_live_gate", False))
        except (TypeError, ValueError, json.JSONDecodeError):
            live_gate = False
        daily_cap = min(int(campaign["daily_cap"]), 50 if live_gate else 25)
        hourly_cap = min(int(campaign["hourly_cap"]), 6)
        firm_cap = int(campaign["firm_collision_cap"])
        rows = connection.execute(
            """SELECT d.delivery_id,d.logical_key,d.scheduled_at,coalesce(emp.company_id,'') firm_id,
                      b.batch_hash current_batch
               FROM delivery d JOIN enrollment e ON e.enrollment_id=d.enrollment_id
               JOIN contact_point cp ON cp.contact_id=d.contact_id
               LEFT JOIN employment emp ON emp.person_id=cp.person_id
               LEFT JOIN t1_delivery_batch b ON b.delivery_id=d.delivery_id
               WHERE d.campaign_id=? AND d.step=0 AND d.state='reserved'
                 AND e.status='scheduled' AND e.stop_reason IS NULL AND e.block_reason IS NULL
               ORDER BY d.logical_key,d.delivery_id""",
            (campaign_id,),
        ).fetchall()
        retained = [row for row in rows if row["current_batch"] == batch_hash and row["scheduled_at"]]
        # A batch owns only deliveries that have not previously been materialized.
        # Earlier batches are immutable occupancy, including when a new batch is
        # materialized later for the same campaign.
        pending = [row for row in rows if row["current_batch"] is None]
        if not pending:
            connection.commit()
            return tuple(sorted(datetime.fromisoformat(row["scheduled_at"]).astimezone(timezone.utc) for row in retained))
        target_ids = {row["delivery_id"] for row in pending}
        occupied = connection.execute(
            "SELECT d.campaign_id,d.scheduled_at,coalesce(emp.company_id,'') firm_id FROM delivery d "
            "JOIN contact_point cp ON cp.contact_id=d.contact_id LEFT JOIN employment emp ON emp.person_id=cp.person_id "
            "JOIN t1_delivery_batch b ON b.delivery_id=d.delivery_id "
            "WHERE d.step=0 AND d.scheduled_at IS NOT NULL AND d.delivery_id NOT IN (" + ",".join("?" for _ in target_ids) + ")",
            tuple(target_ids),
        ).fetchall() if target_ids else ()
        all_slots: list[datetime] = [
            datetime.fromisoformat(row["scheduled_at"]).astimezone(zone)
            for row in occupied if row["campaign_id"] == campaign_id
        ]
        firm_slots: dict[tuple[object, object], int] = {}
        for row in occupied:
            when = datetime.fromisoformat(row["scheduled_at"]).astimezone(zone)
            firm_slots[(when.date(), row["firm_id"])] = firm_slots.get((when.date(), row["firm_id"]), 0) + 1
        day = _next_business_day(now.astimezone(zone).date())
        cursor = datetime.combine(day, start_time, zone)
        assigned: list[datetime] = []
        for row in pending:
            candidate = max(cursor + _batch_jitter(batch_hash, str(row["logical_key"])), datetime.combine(day, start_time, zone))
            while True:
                window_start = datetime.combine(day, start_time, zone)
                window_end = datetime.combine(day, end_time, zone)
                day_slots = [slot for slot in all_slots if slot.date() == day]
                if len(day_slots) >= daily_cap or firm_slots.get((day, row["firm_id"]), 0) >= firm_cap:
                    day = _next_business_day(day)
                    cursor = datetime.combine(day, start_time, zone)
                    candidate = cursor + _batch_jitter(batch_hash, str(row["logical_key"]))
                    continue
                recent = sorted(slot for slot in all_slots if candidate - timedelta(hours=1) < slot <= candidate)
                if len(recent) >= hourly_cap:
                    candidate = recent[0] + timedelta(hours=1)
                    continue
                if candidate > window_end:
                    day = _next_business_day(day)
                    cursor = datetime.combine(day, start_time, zone)
                    candidate = cursor + _batch_jitter(batch_hash, str(row["logical_key"]))
                    continue
                if candidate < window_start:
                    candidate = window_start
                break
            utc_candidate = candidate.astimezone(timezone.utc)
            connection.execute("UPDATE delivery SET scheduled_at=? WHERE delivery_id=? AND state='reserved'", (utc_candidate.isoformat(), row["delivery_id"]))
            connection.execute("INSERT INTO t1_delivery_batch(delivery_id,batch_hash) VALUES(?,?) ON CONFLICT(delivery_id) DO UPDATE SET batch_hash=excluded.batch_hash", (row["delivery_id"], batch_hash))
            all_slots.append(candidate)
            firm_slots[(candidate.date(), row["firm_id"])] = firm_slots.get((candidate.date(), row["firm_id"]), 0) + 1
            cursor = candidate
            assigned.append(utc_candidate)
        connection.commit()
        return tuple(assigned)
    except Exception:
        connection.rollback()
        raise
