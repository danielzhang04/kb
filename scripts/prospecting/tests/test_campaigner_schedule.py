from __future__ import annotations

import json
import random
import sqlite3
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from scripts.prospecting.campaigner.schedule import (
    DEFAULT_WINDOW, US_HOLIDAYS_2026, EnrollmentInput, business_day_add,
    cadence_due_dates, enroll_revision, logical_key, schedule_slots,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture

EASTERN = ZoneInfo("America/New_York")
SYNTHETIC = legacy_fixture("test_campaigner_schedule")


def test_business_day_math_skips_weekends_and_holidays() -> None:
    assert business_day_add(date(2026, 11, 20), 5, US_HOLIDAYS_2026) == date(2026, 11, 30)
    assert business_day_add(date(2026, 11, 20), 7, US_HOLIDAYS_2026) == date(2026, 12, 2)
    ordinary = cadence_due_dates(date(2026, 11, 20), False, random.Random(1), US_HOLIDAYS_2026)
    priority = cadence_due_dates(date(2026, 11, 20), True, random.Random(1), US_HOLIDAYS_2026)
    assert ordinary == priority == (date(2026, 11, 20), date(2026, 11, 30))
    assert sum(1 for _ in _business_days_between(ordinary[0], ordinary[1], US_HOLIDAYS_2026)) == 5


def _business_days_between(start: date, end: date, holidays: frozenset[date]):
    cursor = start
    while cursor < end:
        cursor += __import__('datetime').timedelta(days=1)
        if cursor.weekday() < 5 and cursor not in holidays:
            yield cursor


@pytest.mark.parametrize(
    "cadence",
    [
        [{"step": 1, "business_day": 0}, {"step": 2, "business_day": 61}],
        [{"step": 1, "business_day": 0}, {"step": 2, "business_day": True}],
        [
            {"step": 1, "business_day": 0},
            {"step": 2, "business_day": 5},
            {"step": 3, "business_day": 10},
        ],
    ],
)
def test_saved_cadence_is_finite_bounded_and_two_touch(cadence) -> None:
    with pytest.raises(ValueError, match="^invalid_saved_cadence$"):
        cadence_due_dates(
            date(2026, 9, 3), False, random.Random(1), frozenset(),
            saved_cadence=cadence,
        )


def test_200_slots_obey_window_caps_and_jitter() -> None:
    slots = schedule_slots(
        count=200, start=datetime(2026, 9, 1, 7, 30, tzinfo=EASTERN),
        window=DEFAULT_WINDOW, weekdays={1, 2, 3}, daily_cap=25, hourly_cap=6,
        jitter_minutes=(8, 12), holidays=US_HOLIDAYS_2026,
        rng=random.Random(702),
    )
    by_day: dict[date, list[datetime]] = {}
    for slot in slots:
        by_day.setdefault(slot.when.date(), []).append(slot.when)
        assert slot.when.weekday() in {1, 2, 3}
        assert (8, 10) <= (slot.when.hour, slot.when.minute) <= (10, 30)
    assert len(slots) == 200
    assert max(map(len, by_day.values())) <= 25
    for values in by_day.values():
        for left, right in zip(values, values[1:]):
            assert 8 * 60 <= (right - left).total_seconds() <= 12 * 60
        for value in values:
            hour = value.replace(minute=0, second=0, microsecond=0)
            assert sum(v.replace(minute=0, second=0, microsecond=0) == hour for v in values) <= 6


def test_seeded_jitter_is_repeatable_but_not_constant() -> None:
    arguments = dict(
        count=12, start=datetime(2026, 9, 1, 8, 10, tzinfo=EASTERN),
        window=DEFAULT_WINDOW, weekdays={1, 2, 3}, daily_cap=25, hourly_cap=6,
        jitter_minutes=(8, 12), holidays=frozenset(),
    )
    first = schedule_slots(rng=random.Random(4), **arguments)
    assert first == schedule_slots(rng=random.Random(4), **arguments)
    assert len({slot.jitter_minutes for slot in first[1:]}) > 1


def test_schedule_rejects_invalid_weekday_policies_and_bounds_open_day_search() -> None:
    arguments = dict(
        count=1, start=datetime(2026, 9, 1, 8, 10, tzinfo=EASTERN),
        window=DEFAULT_WINDOW, daily_cap=25, hourly_cap=6,
        jitter_minutes=(8, 12), rng=random.Random(1),
    )
    with pytest.raises(ValueError, match="invalid_weekday_policy"):
        schedule_slots(weekdays=set(), holidays=frozenset(), **arguments)
    with pytest.raises(ValueError, match="invalid_weekday_policy"):
        schedule_slots(weekdays={0, 7}, holidays=frozenset(), **arguments)
    blocked_days = frozenset(
        arguments["start"].date() + timedelta(days=offset) for offset in range(14)
    )
    with pytest.raises(ValueError, match="no_open_day_within_bound"):
        schedule_slots(weekdays={1}, holidays=blocked_days, **arguments)


def test_schedule_property_twenty_named_seeds_dst_and_reschedule_keys(record_property) -> None:
    starts = (
        datetime(2026, 3, 3, 7, 30, tzinfo=EASTERN),
        datetime(2026, 3, 10, 7, 30, tzinfo=EASTERN),
        datetime(2026, 10, 27, 7, 30, tzinfo=EASTERN),
        datetime(2026, 11, 3, 7, 30, tzinfo=EASTERN),
    )
    schedule_cases = 0
    for seed in range(20):
        slots = schedule_slots(
            count=200, start=starts[seed % len(starts)], window=DEFAULT_WINDOW,
            weekdays={1, 2, 3}, daily_cap=25, hourly_cap=6,
            jitter_minutes=(8, 12), holidays=US_HOLIDAYS_2026,
            rng=random.Random(seed),
        )
        assert len(slots) == 200
        schedule_cases += len(slots)
        for left, right in zip(slots, slots[1:]):
            if left.when.date() == right.when.date():
                assert 8 <= (right.when - left.when).total_seconds() / 60 <= 12
        assert all(slot.when.tzinfo is EASTERN for slot in slots)
    record_property('schedule_cases', schedule_cases)
    item = EnrollmentInput("enr", "del", "camp", "person", "contact", "r" * 64, "mailbox", 0, starts[0])
    moved = EnrollmentInput(**{**item.__dict__, "due_at": starts[1]})
    assert logical_key(item) == logical_key(moved)


def test_timezone_data_is_provisioned_on_windows() -> None:
    assert ZoneInfo("America/New_York").key == "America/New_York"


def _seed_atomic_enrollment(path: Path) -> None:
    db = sqlite3.connect(path)
    db.executescript("""
      PRAGMA journal_mode=WAL;
      CREATE TABLE campaign(campaign_id TEXT PRIMARY KEY,policy_json TEXT,policy_hash TEXT,status TEXT,cadence TEXT);
      CREATE TABLE person(person_id TEXT PRIMARY KEY);
      CREATE TABLE employment(employment_id TEXT PRIMARY KEY,person_id TEXT,company_id TEXT,valid_from TEXT,valid_to TEXT);
      CREATE TABLE contact_point(contact_id TEXT PRIMARY KEY,person_id TEXT,email TEXT,state TEXT);
      CREATE TABLE eligibility_decision(decision_id TEXT PRIMARY KEY,campaign_id TEXT,person_id TEXT,outcome TEXT,decided_at TEXT);
      CREATE TABLE evidence(evidence_id TEXT PRIMARY KEY,person_id TEXT,allowed_for_copy INTEGER,expires_at TEXT);
      CREATE TABLE revision(hash TEXT PRIMARY KEY,person_id TEXT,campaign_id TEXT,step INTEGER,qa TEXT,evidence_ids TEXT);
      CREATE TABLE suppression(scope TEXT,subject_key TEXT,released_at TEXT);
      CREATE TABLE enrollment(enrollment_id TEXT PRIMARY KEY,campaign_id TEXT,person_id TEXT,current_step INTEGER,next_due_at TEXT,status TEXT,stop_reason TEXT,block_reason TEXT,variant_id TEXT);
      CREATE TABLE delivery(delivery_id TEXT PRIMARY KEY,campaign_id TEXT,enrollment_id TEXT,step INTEGER,revision_hash TEXT,contact_id TEXT,mailbox_id TEXT,logical_key TEXT UNIQUE,gmail_message_id TEXT,gmail_thread_id TEXT,rfc_message_id TEXT UNIQUE,scheduled_at TEXT,attempted_at TEXT,sent_at TEXT,state TEXT);
    """)
    policy = json.dumps({"approval_tier": "T0", "mailbox_id": "mailbox", "firm_collision_cap": 2})
    cadence = json.dumps([{"step": 1, "business_day": 0}, {"step": 2, "business_day": 5}])
    db.execute("INSERT INTO campaign VALUES('camp',?,'policy','active',?)", (policy, cadence))
    for index in range(3):
        person, contact, evidence, revision = f"person-{index}", f"contact-{index}", f"evidence-{index}", str(index) * 64
        db.execute("INSERT INTO person VALUES(?)", (person,))
        db.execute("INSERT INTO employment VALUES(?,?,?,?,NULL)", (f"employment-{index}", person, "company", "2026-01-01"))
        db.execute("INSERT INTO contact_point VALUES(?,?,?,'valid')", (contact, person, f"synthetic-{index}@invalid.test"))
        db.execute("INSERT INTO eligibility_decision VALUES(?,?,?,'eligible','2026-09-01T00:00:00+00:00')", (f"decision-{index}", "camp", person))
        db.execute("INSERT INTO evidence VALUES(?,?,1,'2027-01-01T00:00:00+00:00')", (evidence, person))
        follow_up = f"{index + 10:064x}"
        db.execute("INSERT INTO revision VALUES(?,?,?,0,?,?)", (revision, person, "camp", json.dumps({"passed": True, "qa_score": 100}), json.dumps([evidence])))
        db.execute("INSERT INTO revision VALUES(?,?,?,1,?,?)", (follow_up, person, "camp", json.dumps({"passed": True, "qa_score": 100}), json.dumps([evidence])))
    db.execute("INSERT INTO enrollment VALUES('existing','camp','person-0',0,NULL,'scheduled',NULL,NULL,NULL)")
    db.commit()
    db.close()


def test_two_concurrent_enrollments_respect_firm_cap(tmp_path) -> None:
    path = tmp_path / "enrollment-race.sqlite"
    _seed_atomic_enrollment(path)
    barrier = threading.Barrier(2)
    outcomes: list[str] = []
    worker_errors: list[BaseException] = []

    def worker(index: int) -> None:
        db: sqlite3.Connection | None = None
        try:
            db = sqlite3.connect(path, timeout=5.0)
            db.execute("PRAGMA busy_timeout=5000")
            barrier.wait()
            item = EnrollmentInput(
                f"enrollment-{index}", f"delivery-{index}", "camp", f"person-{index}",
                f"contact-{index}", str(index) * 64, "mailbox", 0,
                datetime(2026, 9, 3, 8, 10, tzinfo=EASTERN),
            )
            try:
                enroll_revision(db, item, step_revisions={0: str(index) * 64, 1: f"{index + 10:064x}"})
                outcomes.append("enrolled")
            except ValueError as error:
                outcomes.append(str(error))
        except BaseException as error:
            worker_errors.append(error)
        finally:
            if db is not None:
                db.close()

    workers = [threading.Thread(target=worker, args=(index,)) for index in (1, 2)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(10)
        assert not worker.is_alive()
    assert worker_errors == []
    assert sorted(outcomes) == ["enrolled", "firm_collision"]


def test_enrollment_uses_latest_eligibility_decision_regardless_of_outcome(tmp_path) -> None:
    path = tmp_path / "eligibility.sqlite"
    _seed_atomic_enrollment(path)
    db = sqlite3.connect(path)
    due_at = datetime(2026, 9, 3, 8, 10, tzinfo=EASTERN)

    db.execute(
        "INSERT INTO eligibility_decision VALUES('later-ineligible','camp','person-1','ineligible','2026-09-02T00:00:00+00:00')"
    )
    db.commit()
    blocked = EnrollmentInput("enrollment-1", "delivery-1", "camp", "person-1", "contact-1", "1" * 64, "mailbox", 0, due_at)
    with pytest.raises(ValueError, match="eligible_decision_required"):
        enroll_revision(db, blocked, step_revisions={0: "1" * 64, 1: f"{11:064x}"})

    db.execute(
        "INSERT INTO eligibility_decision VALUES('later-eligible','camp','person-2','eligible','2026-09-02T00:00:00+00:00')"
    )
    db.commit()
    allowed = EnrollmentInput("enrollment-2", "delivery-2", "camp", "person-2", "contact-2", "2" * 64, "mailbox", 0, due_at)
    enroll_revision(db, allowed, step_revisions={0: "2" * 64, 1: f"{12:064x}"})
    assert db.execute("SELECT count(*) FROM enrollment WHERE enrollment_id='enrollment-2'").fetchone()[0] == 1
    deliveries = db.execute(
        "SELECT step,gmail_thread_id,scheduled_at FROM delivery WHERE enrollment_id='enrollment-2' ORDER BY step"
    ).fetchall()
    assert len(deliveries) == 2
    assert all(thread_id is None for _, thread_id, _ in deliveries)
    dates = [datetime.fromisoformat(scheduled_at).date() for _, _, scheduled_at in deliveries]
    assert sum(1 for _ in _business_days_between(dates[0], dates[1], US_HOLIDAYS_2026)) == 5
    db.close()


def test_enrollment_composes_with_a_callers_transaction(tmp_path) -> None:
    path = tmp_path / "nested-enrollment.sqlite"
    _seed_atomic_enrollment(path)
    db = sqlite3.connect(path)
    item = EnrollmentInput(
        "enrollment-1", "delivery-1", "camp", "person-1", "contact-1", "1" * 64,
        "mailbox", 0, datetime(2026, 9, 3, 8, 10, tzinfo=EASTERN),
    )
    db.execute("BEGIN")
    enroll_revision(db, item, step_revisions={0: "1" * 64, 1: f"{11:064x}"})
    assert db.in_transaction
    db.rollback()
    assert db.execute(
        "SELECT count(*) FROM enrollment WHERE enrollment_id='enrollment-1'"
    ).fetchone()[0] == 0
    db.close()


def test_naive_enrollment_datetime_is_rejected_before_writes(tmp_path) -> None:
    path = tmp_path / "naive-enrollment.sqlite"
    _seed_atomic_enrollment(path)
    db = sqlite3.connect(path)
    item = EnrollmentInput(
        "enrollment-1", "delivery-1", "camp", "person-1", "contact-1", "1" * 64,
        "mailbox", 0, datetime(2026, 9, 3, 8, 10),
    )
    before = tuple(
        db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in ("enrollment", "delivery")
    )

    with pytest.raises(ValueError, match="^aware_due_at_required$"):
        enroll_revision(
            db, item, step_revisions={0: "1" * 64, 1: f"{11:064x}"},
        )

    assert not db.in_transaction
    assert tuple(
        db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in ("enrollment", "delivery")
    ) == before
    db.close()


def test_enrollment_requires_saved_cadence_and_every_step_revision(tmp_path) -> None:
    path = tmp_path / "cadence-contract.sqlite"
    _seed_atomic_enrollment(path)
    db = sqlite3.connect(path)
    item = EnrollmentInput(
        "enrollment-1", "delivery-1", "camp", "person-1", "contact-1", "1" * 64,
        "mailbox", 0, datetime(2026, 9, 3, 8, 10, tzinfo=EASTERN),
    )
    with pytest.raises(ValueError, match="^step_revisions_required$"):
        enroll_revision(db, item)
    assert db.execute(
        "SELECT count(*) FROM enrollment WHERE enrollment_id='enrollment-1'"
    ).fetchone()[0] == 0

    db.execute("UPDATE campaign SET cadence='null' WHERE campaign_id='camp'")
    db.commit()
    with pytest.raises(ValueError, match="^invalid_saved_cadence$"):
        enroll_revision(
            db, item, step_revisions={0: "1" * 64, 1: f"{11:064x}"},
        )
    assert db.execute(
        "SELECT count(*) FROM enrollment WHERE enrollment_id='enrollment-1'"
    ).fetchone()[0] == 0
    db.close()


def test_saved_one_based_cadence_maps_to_real_schema_steps_and_revision_hashes(
    tmp_path,
) -> None:
    db = open_store(tmp_path / "real-schema.sqlite")
    policy_hash = "a" * 64
    first_hash, follow_up_hash = "1" * 64, "2" * 64
    cadence = [{"step": 1, "business_day": 0}, {"step": 2, "business_day": 5}]
    db.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender", "Synthetic", None, "Synthetic", "Synthetic", "Synthetic", "[]"),
    )
    db.execute(
        "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
        ("company", "Synthetic Firm", "manual", "company-key"),
    )
    db.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ("person", "Synthetic", "Synthetic Person", "manual", "person-key"),
    )
    db.execute(
        "INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "camp", "networking", "sender",
            json.dumps({
                "approval_tier": "T0", "mailbox_id": "mailbox",
                "firm_collision_cap": 2,
            }),
            "informational_call", 15, "warm", "fixture", json.dumps(cadence),
            "09:00-17:00", "America/New_York", 25, 6, 2, "T0", "mailbox",
            "{}", 0, "active", policy_hash,
        ),
    )
    db.execute(
        "INSERT INTO source_observation("
        "observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence"
        ") VALUES(?,?,?,?,?,?,?,?)",
        ("observation", "employment", "employment", "title", '"Synthetic"',
         "manual", "2026-09-01T00:00:00+00:00", 1.0),
    )
    db.execute(
        "INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)",
        ("employment", "person", "company", "Synthetic", "2026-01-01", None,
         "observation", 1.0),
    )
    db.execute(
        "INSERT INTO contact_point VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ("contact", "person", "company", SYNTHETIC["contact_email"], "manual", "v1",
         "2026-09-01T00:00:00+00:00", "2026-09-01T00:00:00+00:00",
         "valid", 1.0, 0),
    )
    db.execute(
        "INSERT INTO fit_score_version VALUES(?,?,?,?,?,?)",
        ("fit-version", "fixture", "{}", "b" * 64,
         "2026-09-01T00:00:00+00:00", "2026-09-01T00:00:00+00:00"),
    )
    db.execute(
        "INSERT INTO eligibility_decision("
        "decision_id,campaign_id,person_id,rule_version,fit_score_version_id,outcome,"
        "failed_predicate_ids,approximate_predicate_ids,decided_at"
        ") VALUES(?,?,?,?,?,?,?,?,?)",
        ("decision", "camp", "person", "fixture", "fit-version", "eligible", "[]", "[]",
         "2026-09-01T00:00:00+00:00"),
    )
    db.execute(
        "INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("evidence", "person", "Synthetic claim", "https://example.test/source", None,
         "2026-09-01T00:00:00+00:00", "Synthetic excerpt", 1.0,
         "2027-02-01T00:00:00+00:00", 1),
    )
    for step, digest in enumerate((first_hash, follow_up_hash)):
        db.execute(
            "INSERT INTO revision VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                f"revision-{step}", "person", "camp", step, "Synthetic subject",
                "Synthetic body", "why_them", "bespoke", None,
                "Would you have 15 minutes for an informational conversation?",
                '["evidence"]', '["Synthetic"]', "[]", "fixture", 1,
                "fixture", "fixture", '{"passed":true,"qa_score":100}', digest,
            ),
        )

    enroll_revision(
        db,
        EnrollmentInput(
            "enrollment", "delivery", "camp", "person", "contact", first_hash,
            "mailbox", 0, datetime(2026, 12, 28, 8, 10, tzinfo=EASTERN),
        ),
        step_revisions={0: first_hash, 1: follow_up_hash},
    )

    assert [tuple(row) for row in db.execute(
        "SELECT step,revision_hash FROM delivery ORDER BY step"
    )] == [(0, first_hash), (1, follow_up_hash)]
    assert [row[0] for row in db.execute(
        "SELECT scheduled_at FROM delivery ORDER BY step"
    )] == [
        "2026-12-28T08:10:00-05:00",
        "2027-01-05T08:10:00-05:00",
    ]
    db.close()
