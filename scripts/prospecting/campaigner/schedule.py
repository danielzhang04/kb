"""Enrollment and bounded T0 scheduling."""

from __future__ import annotations

import hashlib
import json
import random
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Iterable, Mapping
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")
DEFAULT_WINDOW = (time(8, 10), time(10, 30))
DEFAULT_CADENCE = (
    {"step": 1, "business_day": 0},
    {"step": 2, "business_day": 5},
)


def _observed(day: date) -> date:
    if day.weekday() == 5:
        return day - timedelta(days=1)
    if day.weekday() == 6:
        return day + timedelta(days=1)
    return day


def _nth_weekday(year: int, month: int, weekday: int, ordinal: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(
        days=(weekday - first.weekday()) % 7 + 7 * (ordinal - 1)
    )


def _last_weekday(year: int, month: int, weekday: int) -> date:
    first_next = date(year + (month == 12), month % 12 + 1, 1)
    last = first_next - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def us_federal_holidays(year: int) -> frozenset[date]:
    """Return the same observed US federal-holiday policy for one year."""
    fixed = (
        date(year, 1, 1), date(year, 6, 19), date(year, 7, 4),
        date(year, 11, 11), date(year, 12, 25),
    )
    return frozenset({
        *(_observed(day) for day in fixed),
        _nth_weekday(year, 1, 0, 3),
        _nth_weekday(year, 2, 0, 3),
        _last_weekday(year, 5, 0),
        _nth_weekday(year, 9, 0, 1),
        _nth_weekday(year, 10, 0, 2),
        _nth_weekday(year, 11, 3, 4),
    })


US_HOLIDAYS_2026 = us_federal_holidays(2026)


def _cadence_holidays(start: date, maximum_offset: int) -> frozenset[date]:
    # Sixty business days spans less than this bounded calendar horizon under
    # the fixed federal policy.  Include one extra nominal year because a
    # January 1 Saturday is observed on December 31 of the prior year.
    horizon = start + timedelta(days=maximum_offset * 2 + 14)
    return frozenset().union(*(
        us_federal_holidays(year)
        for year in range(start.year, horizon.year + 2)
    ))


@dataclass(frozen=True)
class EnrollmentInput:
    enrollment_id: str
    delivery_id: str
    campaign_id: str
    person_id: str
    contact_id: str
    revision_hash: str
    mailbox_id: str
    step: int
    due_at: datetime
    variant_id: str | None = None


@dataclass(frozen=True)
class ScheduledSlot:
    when: datetime
    jitter_minutes: int


def business_day_add(start: date, days: int, holidays: Iterable[date]) -> date:
    if isinstance(days, bool) or not isinstance(days, int) or days < 0:
        raise ValueError("negative_business_days")
    blocked = frozenset(holidays)
    cursor, remaining = start, days
    while remaining:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5 and cursor not in blocked:
            remaining -= 1
    return cursor


def _validated_cadence(saved_cadence: object | None) -> tuple[tuple[int, int], ...]:
    value = list(DEFAULT_CADENCE) if saved_cadence is None else saved_cadence
    if not isinstance(value, list) or not 1 <= len(value) <= 2:
        raise ValueError("invalid_saved_cadence")
    result: list[tuple[int, int]] = []
    previous = -1
    for expected_step, entry in enumerate(value, 1):
        if not isinstance(entry, dict) or set(entry) != {"step", "business_day"}:
            raise ValueError("invalid_saved_cadence")
        step, offset = entry["step"], entry["business_day"]
        if (
            isinstance(step, bool) or not isinstance(step, int)
            or isinstance(offset, bool) or not isinstance(offset, int)
            or step != expected_step or offset < 0 or offset > 60
            or offset <= previous
        ):
            raise ValueError("invalid_saved_cadence")
        result.append((step - 1, offset))
        previous = offset
    if result[0] != (0, 0):
        raise ValueError("invalid_saved_cadence")
    return tuple(result)


def cadence_due_dates(
    first_touch: date,
    priority: bool,
    rng: random.Random,
    holidays: frozenset[date],
    *,
    saved_cadence: object | None = None,
) -> tuple[date, ...]:
    """Return due dates from saved cadence, with a conservative two-touch default."""
    del priority, rng
    return tuple(
        business_day_add(first_touch, offset, holidays)
        for _step, offset in _validated_cadence(saved_cadence)
    )


def logical_key(item: EnrollmentInput) -> str:
    canonical = json.dumps(
        [item.campaign_id, item.enrollment_id, item.step, item.revision_hash,
         item.contact_id, item.mailbox_id], separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _open_day(day: date, weekdays: set[int], holidays: frozenset[date]) -> date:
    for _ in range(14):
        if day.weekday() in weekdays and day not in holidays:
            return day
        day += timedelta(days=1)
    raise ValueError("no_open_day_within_bound")


def schedule_slots(
    *, count: int, start: datetime, window: tuple[time, time], weekdays: set[int],
    daily_cap: int, hourly_cap: int, jitter_minutes: tuple[int, int],
    holidays: frozenset[date], rng: random.Random,
) -> tuple[ScheduledSlot, ...]:
    if start.tzinfo is None or count < 0 or not 1 <= daily_cap <= 25 or not 1 <= hourly_cap <= 6:
        raise ValueError("invalid_schedule_policy")
    if not weekdays or not weekdays <= set(range(7)):
        raise ValueError("invalid_weekday_policy")
    if jitter_minutes[0] < 8 or jitter_minutes[1] > 12:
        raise ValueError("invalid_jitter_policy")
    slots: list[ScheduledSlot] = []
    day = _open_day(start.date(), weekdays, holidays)
    while len(slots) < count:
        first = datetime.combine(day, window[0], start.tzinfo)
        cursor = max(first, start) if day == start.date() else first
        day_slots: list[datetime] = []
        while len(day_slots) < daily_cap and len(slots) < count:
            jitter = 0 if not day_slots else rng.randint(*jitter_minutes)
            candidate = cursor if not day_slots else day_slots[-1] + timedelta(minutes=jitter)
            hour = candidate.replace(minute=0, second=0, microsecond=0)
            if sum(v.replace(minute=0, second=0, microsecond=0) == hour for v in day_slots) >= hourly_cap:
                break
            if candidate.time() > window[1]:
                break
            day_slots.append(candidate)
            slots.append(ScheduledSlot(candidate, jitter))
        if len(slots) < count:
            day = _open_day(day + timedelta(days=1), weekdays, holidays)
    return tuple(slots)


def enroll_revision(
    connection: sqlite3.Connection,
    item: EnrollmentInput,
    *,
    step_revisions: Mapping[int, str] | None = None,
) -> str:
    if isinstance(item.step, bool) or not isinstance(item.step, int) or item.step != 0:
        raise ValueError("unsupported_starting_step")
    if item.due_at.tzinfo is None or item.due_at.utcoffset() is None:
        raise ValueError("aware_due_at_required")
    key = logical_key(item)
    owns_transaction = not connection.in_transaction
    if owns_transaction:
        connection.execute("BEGIN IMMEDIATE")
    connection.execute("SAVEPOINT enroll")
    try:
        campaign = connection.execute(
            "SELECT status,policy_json,policy_hash,cadence FROM campaign WHERE campaign_id=?",
            (item.campaign_id,),
        ).fetchone()
        if campaign is None or campaign[0] != "active":
            raise ValueError("campaign_not_active")
        policy = json.loads(campaign[1])
        if policy.get("approval_tier") != "T0" or policy.get("mailbox_id") != item.mailbox_id:
            raise ValueError("campaign_not_t0_active")
        try:
            saved_cadence = json.loads(campaign[3])
        except (TypeError, json.JSONDecodeError) as error:
            raise ValueError("invalid_saved_cadence") from error
        if saved_cadence is None:
            raise ValueError("invalid_saved_cadence")
        cadence = _validated_cadence(saved_cadence)
        required_steps = {step for step, _offset in cadence}
        revisions = {item.step: item.revision_hash} if step_revisions is None else dict(step_revisions)
        if any(isinstance(step, bool) or not isinstance(step, int) for step in revisions):
            raise ValueError("invalid_step_revisions")
        if set(revisions) != required_steps:
            if step_revisions is None:
                raise ValueError("step_revisions_required")
            raise ValueError("invalid_step_revisions")
        if revisions.get(0) != item.revision_hash:
            raise ValueError("initial_revision_mismatch")

        employment = connection.execute(
            "SELECT company_id FROM employment WHERE person_id=? AND valid_to IS NULL "
            "ORDER BY valid_from DESC,employment_id LIMIT 1", (item.person_id,),
        ).fetchone()
        if employment is None:
            raise ValueError("open_employment_required")
        company_id = employment[0]
        contact = connection.execute(
            "SELECT person_id,lower(trim(email)),state FROM contact_point WHERE contact_id=?",
            (item.contact_id,),
        ).fetchone()
        if contact is None or contact[0] != item.person_id or contact[2] != "valid":
            raise ValueError("contact_not_eligible")
        eligible = connection.execute(
            "SELECT outcome FROM eligibility_decision WHERE campaign_id=? AND person_id=? "
            "ORDER BY decided_at DESC,decision_id DESC LIMIT 1",
            (item.campaign_id, item.person_id),
        ).fetchone()
        if eligible is None or eligible[0] != "eligible":
            raise ValueError("eligible_decision_required")

        due_by_step = {
            step: datetime.combine(
                business_day_add(
                    item.due_at.date(), offset,
                    _cadence_holidays(item.due_at.date(), offset),
                ),
                item.due_at.timetz(),
            )
            for step, offset in cadence
        }
        for step in sorted(required_steps):
            revision = connection.execute(
                "SELECT person_id,campaign_id,step,qa,evidence_ids FROM revision WHERE hash=?",
                (revisions[step],),
            ).fetchone()
            if revision is None or revision[:3] != (item.person_id, item.campaign_id, step):
                raise ValueError("revision_scope_mismatch")
            qa, evidence_ids = json.loads(revision[3]), json.loads(revision[4])
            if qa.get("qa_score", 0) < 80 or not qa.get("passed", False) or not evidence_ids:
                raise ValueError("revision_not_approved")
            placeholders = ",".join("?" for _ in evidence_ids)
            evidence_count = connection.execute(
                f"SELECT count(*) FROM evidence WHERE evidence_id IN ({placeholders}) "
                "AND person_id=? AND allowed_for_copy=1 AND expires_at>=?",
                (*evidence_ids, item.person_id, due_by_step[step].isoformat()),
            ).fetchone()[0]
            if evidence_count != len(set(evidence_ids)):
                raise ValueError("revision_evidence_invalid")

        suppressed = connection.execute(
            "SELECT 1 FROM suppression WHERE released_at IS NULL AND "
            "(scope='global' OR (scope='person' AND subject_key=?) OR "
            "(scope='email' AND lower(trim(subject_key))=?) OR "
            "(scope='company' AND subject_key=?) OR "
            "(scope='campaign' AND subject_key=?)) LIMIT 1",
            (item.person_id, contact[1], company_id, item.campaign_id),
        ).fetchone()
        if suppressed:
            raise ValueError("suppression_active")
        active = connection.execute(
            "SELECT count(*) FROM enrollment e JOIN employment em ON em.person_id=e.person_id "
            "AND em.valid_to IS NULL WHERE e.campaign_id=? AND em.company_id=? "
            "AND e.status NOT IN ('stopped','closed')",
            (item.campaign_id, company_id),
        ).fetchone()[0]
        if active >= int(policy.get("firm_collision_cap", 2)):
            raise ValueError("firm_collision")

        connection.execute(
            "INSERT INTO enrollment(enrollment_id,campaign_id,person_id,current_step,next_due_at,status,stop_reason,block_reason,variant_id) "
            "VALUES (?,?,?,?,?,'scheduled',NULL,NULL,?)",
            (item.enrollment_id, item.campaign_id, item.person_id, 0,
             due_by_step[0].isoformat(), item.variant_id),
        )
        for step, _offset in cadence:
            due_at = due_by_step[step]
            delivery_id = item.delivery_id if step == 0 else f"{item.delivery_id}-f{step}"
            delivery_item = EnrollmentInput(
                item.enrollment_id, delivery_id, item.campaign_id, item.person_id,
                item.contact_id, revisions[step], item.mailbox_id, step,
                due_at, item.variant_id,
            )
            delivery_key = logical_key(delivery_item)
            delivery_rfc = hashlib.sha256(f"prospecting:{delivery_key}".encode()).hexdigest()
            connection.execute(
                "INSERT INTO delivery(delivery_id,campaign_id,enrollment_id,step,revision_hash,contact_id,mailbox_id,logical_key,gmail_message_id,gmail_thread_id,rfc_message_id,scheduled_at,attempted_at,sent_at,state) "
                "VALUES (?,?,?,?,?,?,?,?,NULL,NULL,?,?,NULL,NULL,'reserved')",
                (delivery_id, item.campaign_id, item.enrollment_id, step,
                 revisions[step], item.contact_id, item.mailbox_id, delivery_key,
                 f"<{delivery_rfc}@prospecting.local>", due_at.isoformat()),
            )
    except BaseException:
        connection.execute("ROLLBACK TO enroll")
        connection.execute("RELEASE enroll")
        if owns_transaction:
            connection.rollback()
        raise
    else:
        connection.execute("RELEASE enroll")
        if owns_transaction:
            connection.commit()
        return key
