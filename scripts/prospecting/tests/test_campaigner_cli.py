from __future__ import annotations
import sqlite3
import pytest
from scripts.prospecting.campaigner.cli import CampaignerService, main
from scripts.prospecting.campaigner.inbound import InboundEnvelope
from scripts.prospecting.campaigner.release import ReleaseResult


def store() -> sqlite3.Connection:
    db = sqlite3.connect(':memory:')
    db.executescript("""
      CREATE TABLE enrollment(enrollment_id TEXT PRIMARY KEY,status TEXT,stop_reason TEXT,block_reason TEXT);
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,gmail_message_id TEXT UNIQUE,gmail_thread_id TEXT,enrollment_id TEXT,received_at TEXT,class TEXT,confidence REAL,explanation_code TEXT,reviewed_by TEXT,correction_class TEXT);
      CREATE TABLE inbound_claim(message_id TEXT PRIMARY KEY,claimed_at TEXT);
      CREATE TABLE delivery(delivery_id TEXT PRIMARY KEY,scheduled_at TEXT,state TEXT);
      INSERT INTO enrollment VALUES('enr','scheduled',NULL,NULL);
    """)
    return db


def test_scan_is_idempotent_and_counts_only() -> None:
    db = store()
    envelope = InboundEnvelope('msg','thread','enr','2026-09-03T13:00:00+00:00',
                               {'Subject': 'Re: Coffee'}, lambda: 'Thanks')
    service = CampaignerService(db, lambda: (envelope,), lambda delivery_id: ReleaseResult('drafted'))
    assert service.scan() == {'processed': 1, 'stopped': 1, 'blocked': 0}
    assert service.scan() == {'processed': 0, 'stopped': 0, 'blocked': 0}


def test_sweep_scans_before_release_and_status_is_typed() -> None:
    db = store()
    db.execute("INSERT INTO delivery VALUES('due','2026-09-03T13:00:00+00:00','reserved')")
    events: list[str] = []
    def release(delivery_id: str) -> ReleaseResult:
        events.append(delivery_id)
        with db:
            db.execute("UPDATE delivery SET state='attempted' WHERE delivery_id=?", (delivery_id,))
        return ReleaseResult('drafted')
    service = CampaignerService(
        db, lambda: (), release,
        now=lambda: '2026-09-03T14:00:00+00:00',
    )
    assert service.sweep()['drafted'] == 1
    assert events == ['due']
    assert service.status() == {'due': 0, 'paused': 0, 'replied': 0}
    db.execute("INSERT INTO delivery VALUES('blocked','2026-09-03T13:00:00+00:00','reserved')")
    paused = CampaignerService(db, lambda: (), release, breaker=lambda: True)
    assert paused.sweep()['warning_paused'] == 1
    assert events == ['due']

    resumed = store()
    resumed.executemany("INSERT INTO delivery VALUES(?,?,'reserved')", [
        ('first','2026-09-03T13:00:00+00:00'),
        ('second','2026-09-03T13:01:00+00:00'),
    ])
    attempts = 0
    def interrupted(delivery_id: str) -> ReleaseResult:
        nonlocal attempts
        attempts += 1
        if attempts == 2:
            raise KeyboardInterrupt()
        with resumed:
            resumed.execute("UPDATE delivery SET state='attempted' WHERE delivery_id=?", (delivery_id,))
        return ReleaseResult('drafted')
    with pytest.raises(KeyboardInterrupt):
        CampaignerService(resumed, lambda: (), interrupted).sweep()
    def finish(delivery_id: str) -> ReleaseResult:
        with resumed:
            resumed.execute("UPDATE delivery SET state='attempted' WHERE delivery_id=?", (delivery_id,))
        return ReleaseResult('drafted')
    assert CampaignerService(resumed, lambda: (), finish).sweep()['drafted'] == 1

    output: list[str] = []
    assert main(
        ['status'], open_store_fn=lambda: db,
        service_factory=lambda connection: CampaignerService(connection, lambda: (), release),
        emit=output.append,
    ) == 0
    assert output == ['{"due":1,"paused":0,"replied":0}']


def test_sweep_uses_utc_due_order_and_observed_release_transition() -> None:
    db = store()
    db.executemany("INSERT INTO delivery VALUES(?,?, 'reserved')", [
        ('late_utc', '2026-09-03T10:30:00+00:00'),
        ('first_utc', '2026-09-03T12:00:00+02:00'),
        ('future', '2026-09-03T11:30:00+00:00'),
        ('lying', '2026-09-03T10:15:00+00:00'),
    ])
    released: list[str] = []

    def release(delivery_id: str) -> ReleaseResult:
        released.append(delivery_id)
        if delivery_id != 'lying':
            with db:
                db.execute("UPDATE delivery SET state='attempted' WHERE delivery_id=?", (delivery_id,))
        return ReleaseResult('drafted')

    result = CampaignerService(
        db, lambda: (), release, now=lambda: '2026-09-03T11:00:00+00:00',
    ).sweep()
    assert released == ['first_utc', 'lying', 'late_utc']
    assert result['considered'] == 3
    assert result['drafted'] == 2
    assert result['next_due_count'] == 2


def test_sweep_reconciles_inbound_after_breaker_and_interruption() -> None:
    db = store()
    calls = 0

    def inbound_source():
        nonlocal calls
        calls += 1
        return ()

    paused = CampaignerService(db, inbound_source, lambda _delivery_id: ReleaseResult('drafted'), breaker=lambda: True)
    assert paused.sweep()['warning_paused'] == 1
    assert calls == 2

    db.execute("INSERT INTO delivery VALUES('due','2026-09-03T13:00:00+00:00','reserved')")
    with pytest.raises(KeyboardInterrupt):
        CampaignerService(
            db, inbound_source, lambda _delivery_id: (_ for _ in ()).throw(KeyboardInterrupt()),
            now=lambda: '2026-09-03T14:00:00+00:00',
        ).sweep()
    assert calls == 4


def test_live_service_refuses_to_start_without_an_attached_backend() -> None:
    with pytest.raises(RuntimeError, match='no_backend_attached'):
        main(['status'], open_store_fn=store)
