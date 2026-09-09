from __future__ import annotations
import sqlite3
import pytest
from zoneinfo import ZoneInfoNotFoundError
from scripts.prospecting.campaigner import guards
from scripts.prospecting.campaigner.guards import evaluate_circuit_breaker, suppress


def store() -> sqlite3.Connection:
    db = sqlite3.connect(':memory:')
    db.executescript("""
      CREATE TABLE campaign(campaign_id TEXT PRIMARY KEY,status TEXT,policy_json TEXT);
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,class TEXT,received_at TEXT);
      CREATE TABLE suppression(suppression_id TEXT PRIMARY KEY,scope TEXT,subject_key TEXT,reason TEXT,created_at TEXT,created_by TEXT,released_at TEXT,released_by TEXT);
      CREATE TABLE audit(event_id TEXT PRIMARY KEY,actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,at TEXT,before_hash TEXT,after_hash TEXT,reason TEXT);
      INSERT INTO campaign VALUES('camp','active','{"timezone":"America/New_York"}');
    """)
    return db


def test_second_bounce_pauses_and_wakes_once() -> None:
    db = store()
    db.execute(
        "INSERT INTO campaign VALUES(?,?,?)",
        ('other', 'active', '{"timezone":"America/New_York"}'),
    )
    db.executemany("INSERT INTO inbound VALUES(?,?,?)", [
        ('one','bounce_failed','2026-09-04T00:30:00+00:00'),
        ('two','bounce_failed','2026-09-04T03:30:00+00:00'),
        ('next-day','bounce_failed','2026-09-04T04:30:00+00:00')])
    result = evaluate_circuit_breaker(db, 'camp', '2026-09-03', None)
    assert (result.paused, result.reason, result.wake_me_requested) == (True, 'hard_bounce_threshold', True)
    assert db.execute("SELECT count(*) FROM campaign WHERE status='paused'").fetchone()[0] == 2
    assert evaluate_circuit_breaker(db, 'camp', '2026-09-03', None).wake_me_requested is False
    other_result = evaluate_circuit_breaker(db, 'other', '2026-09-03', None)
    assert (other_result.paused, other_result.reason, other_result.wake_me_requested) == (
        True, 'hard_bounce_threshold', False
    )
    assert db.execute("SELECT count(*) FROM audit WHERE reason='hard_bounce_threshold'").fetchone()[0] == 1


def test_warning_and_suppression_are_reason_coded() -> None:
    db = store()
    result = evaluate_circuit_breaker(
        db, 'camp', '2026-09-03', 'gmail_unusual_activity_warning'
    )
    assert (result.paused, result.reason, result.wake_me_requested) == (
        True, 'google_warning', True
    )
    assert db.execute("SELECT status FROM campaign WHERE campaign_id='camp'").fetchone() == ('paused',)
    repeat = evaluate_circuit_breaker(
        db, 'camp', '2026-09-03', 'gmail_unusual_activity_warning'
    )
    assert (repeat.paused, repeat.reason, repeat.wake_me_requested) == (
        True, 'google_warning', False
    )
    with pytest.raises(ValueError, match='unknown_gmail_warning'):
        evaluate_circuit_breaker(db, 'camp', '2026-09-03', 'gmail_warning')
    suppression_id = suppress(db, 'global', 'all', 'google_warning', '2026-09-03T15:00:00+00:00')
    assert len(suppression_id) == 64
    assert db.execute("SELECT scope,reason FROM suppression").fetchone() == ('global','google_warning')


def test_resuppressing_releases_subject_with_refreshed_metadata() -> None:
    db = store()
    suppression_id = suppress(db, 'global', 'all', 'google_warning', '2026-09-03T15:00:00+00:00')
    db.execute(
        "UPDATE suppression SET released_at=?, released_by=? WHERE suppression_id=?",
        ('2026-09-03T16:00:00+00:00', 'operator', suppression_id),
    )

    assert suppress(db, 'global', 'all', 'google_warning', '2026-09-03T17:00:00+00:00') == suppression_id
    assert db.execute(
        "SELECT reason, created_at, released_at, released_by FROM suppression WHERE suppression_id=?",
        (suppression_id,),
    ).fetchone() == ('google_warning', '2026-09-03T17:00:00+00:00', None, None)


def test_timezone_unavailable_pauses_and_wakes_once(monkeypatch: pytest.MonkeyPatch) -> None:
    db = store()

    def unavailable(_: str) -> None:
        raise ZoneInfoNotFoundError('tzdata unavailable')

    monkeypatch.setattr(guards, 'ZoneInfo', unavailable)
    result = evaluate_circuit_breaker(db, 'camp', '2026-09-03', None)
    assert (result.paused, result.reason, result.wake_me_requested) == (
        True, 'timezone_unavailable', True
    )
    assert db.execute("SELECT status FROM campaign WHERE campaign_id='camp'").fetchone() == ('paused',)
    repeat = evaluate_circuit_breaker(db, 'camp', '2026-09-03', None)
    assert (repeat.paused, repeat.reason, repeat.wake_me_requested) == (
        True, 'timezone_unavailable', False
    )
