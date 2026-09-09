from __future__ import annotations

import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
import pytest

from scripts.prospecting.campaigner.inbound import (
    InboundEnvelope,
    InboundSummary,
    classify,
    process_inbound,
)
from scripts.prospecting.pii_guard import VM_SINKS, assert_vm_safe
from scripts.prospecting.store import migrate


@pytest.mark.parametrize(("headers", "body", "expected"), [
    ({"From": "MAILER-DAEMON", "Content-Type": "multipart/report; report-type=delivery-status"}, "Action: failed", "bounce_failed"),
    ({"From": "postmaster", "Content-Type": "multipart/report; report-type=delivery-status"}, "Action: delayed", "bounce_delayed"),
    ({"Auto-Submitted": "auto-replied", "Subject": "Out of office"}, "returning Monday", "ooo"),
    ({"Auto-Submitted": "auto-generated"}, "receipt", "automatic"),
    ({"Subject": "Re: Coffee"}, "Please unsubscribe me", "unsubscribe"),
    ({"Subject": "Re: Coffee"}, "You have the wrong person", "wrong_person"),
    ({"Subject": "Re: Coffee"}, "Tuesday at 2 works", "scheduling_logistics"),
    ({"Subject": "Re: Coffee"}, "Yes, happy to talk", "substantive_positive"),
    ({"Subject": "Re: Coffee"}, "Thanks", "thanks_ack"),
    ({"Subject": "Re: Coffee"}, "No thank you", "graceful_close"),
    ({"Subject": "Re: Coffee"}, "I read this and have no preference", "human_neutral"),
    ({"Subject": "Re: Coffee"}, "This outreach is inappropriate", "human_negative"),
    ({"Subject": "Re: Coffee"}, "", "ambiguous"),
    ({"Subject": "Re: Coffee"}, "This concerns legal advice", "sensitive"),
], ids=('bounce-failed','bounce-delayed','ooo','automatic','unsubscribe',
        'wrong-person','scheduling','positive','thanks','graceful-close',
        'human-neutral','human-negative','ambiguous','sensitive'))
def test_inbound_shapes(headers, body, expected) -> None:
    assert classify(headers, body).value == expected


def test_pause_is_committed_before_raw_body_read_and_survives_failure(tmp_path) -> None:
    path = tmp_path / "inbound.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript("""
      CREATE TABLE enrollment(enrollment_id TEXT PRIMARY KEY,status TEXT,stop_reason TEXT,block_reason TEXT);
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,gmail_message_id TEXT UNIQUE,gmail_thread_id TEXT,enrollment_id TEXT,received_at TEXT,class TEXT,confidence REAL,explanation_code TEXT,reviewed_by TEXT,correction_class TEXT);
      CREATE TABLE inbound_claim(message_id TEXT NOT NULL UNIQUE,claimed_at TEXT NOT NULL);
      INSERT INTO enrollment VALUES('enr-1','scheduled',NULL,NULL);
    """)
    observer = sqlite3.connect(path)
    observed: list[tuple[str, int]] = []
    labels: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = []
    def read_body() -> str:
        observed.append((
            observer.execute("SELECT status FROM enrollment").fetchone()[0],
            observer.execute("SELECT count(*) FROM inbound").fetchone()[0],
        ))
        return 'Please unsubscribe me'
    summary = process_inbound(
        connection,
        InboundEnvelope('gmail-1','thread-1','enr-1','2026-09-03T13:00:00+00:00',
                        {'Subject': 'Re: Coffee'}, read_body),
        label_request=lambda thread_id, add, remove: labels.append((thread_id, add, remove)),
    )
    assert observed == [('blocked', 0)]
    assert connection.execute("SELECT stop_reason FROM enrollment").fetchone()[0] == 'unsubscribe'
    assert summary.as_dict() == {'processed': 1, 'stopped': 1, 'blocked': 0}
    assert 'unsubscribe' not in str(summary.as_dict()).lower()
    assert labels == [('thread-1', ('Outreach/Closed-declined',), (
        'Outreach/Sent', 'Outreach/Follow-up due', 'Outreach/Replied',
        'Outreach/OOO', 'Outreach/Bounced', 'Outreach/Closed-no-reply',
    ))]


def test_classifier_failure_leaves_committed_manual_hold(tmp_path) -> None:
    path = tmp_path / "failure.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript("""
      CREATE TABLE enrollment(enrollment_id TEXT PRIMARY KEY,status TEXT,stop_reason TEXT,block_reason TEXT);
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,gmail_message_id TEXT UNIQUE,gmail_thread_id TEXT,enrollment_id TEXT,received_at TEXT,class TEXT,confidence REAL,explanation_code TEXT,reviewed_by TEXT,correction_class TEXT);
      CREATE TABLE inbound_claim(message_id TEXT NOT NULL UNIQUE,claimed_at TEXT NOT NULL);
      INSERT INTO enrollment VALUES('enr-1','scheduled',NULL,NULL);
    """)
    def fail_after_read() -> str:
        raise RuntimeError("synthetic_classifier_failure")
    with pytest.raises(RuntimeError, match="synthetic_classifier_failure"):
        process_inbound(connection, InboundEnvelope(
            'gmail-1', 'thread-1', 'enr-1', '2026-09-03T13:00:00+00:00',
            {'Subject': 'Re: Coffee'}, fail_after_read,
        ))
    observer = sqlite3.connect(path)
    assert observer.execute(
        "SELECT status,block_reason FROM enrollment"
    ).fetchone() == ('blocked', 'manual_hold')
    assert observer.execute("SELECT count(*) FROM inbound").fetchone()[0] == 0


@pytest.mark.parametrize(("enrollment_sql", "expected"), [
    ("INSERT INTO enrollment VALUES('enr-1','stopped','unsubscribe',NULL);", ('stopped', 'unsubscribe', None)),
    ("", None),
], ids=("terminal", "missing"))
def test_nonprocessable_enrollment_does_not_read_body(tmp_path, enrollment_sql, expected) -> None:
    connection = sqlite3.connect(tmp_path / "unprocessable.sqlite")
    connection.executescript("""
      CREATE TABLE enrollment(enrollment_id TEXT PRIMARY KEY,status TEXT,stop_reason TEXT,block_reason TEXT);
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,gmail_message_id TEXT UNIQUE,gmail_thread_id TEXT,enrollment_id TEXT,received_at TEXT,class TEXT,confidence REAL,explanation_code TEXT,reviewed_by TEXT,correction_class TEXT);
      CREATE TABLE inbound_claim(message_id TEXT NOT NULL UNIQUE,claimed_at TEXT NOT NULL);
    """ + enrollment_sql)
    body_reads = 0

    def read_body() -> str:
        nonlocal body_reads
        body_reads += 1
        return "Please unsubscribe me"

    assert process_inbound(connection, InboundEnvelope(
        'gmail-1', 'thread-1', 'enr-1', '2026-09-03T13:00:00+00:00',
        {'Subject': 'Re: Coffee'}, read_body,
    )) == InboundSummary(0, 0, 0)
    assert body_reads == 0
    if expected:
        assert connection.execute(
            "SELECT status,stop_reason,block_reason FROM enrollment WHERE enrollment_id='enr-1'"
        ).fetchone() == expected


def test_concurrent_duplicate_reads_body_once_and_creates_one_inbound(tmp_path) -> None:
    path = tmp_path / "concurrent.sqlite"
    setup = sqlite3.connect(path)
    setup.executescript("""
      CREATE TABLE enrollment(enrollment_id TEXT PRIMARY KEY,status TEXT,stop_reason TEXT,block_reason TEXT);
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,gmail_message_id TEXT UNIQUE,gmail_thread_id TEXT,enrollment_id TEXT,received_at TEXT,class TEXT,confidence REAL,explanation_code TEXT,reviewed_by TEXT,correction_class TEXT);
      CREATE TABLE inbound_claim(message_id TEXT NOT NULL UNIQUE,claimed_at TEXT NOT NULL);
      INSERT INTO enrollment VALUES('enr-1','scheduled',NULL,NULL);
    """)
    setup.close()
    barrier = threading.Barrier(2)
    body_reads = 0
    read_lock = threading.Lock()

    def worker() -> InboundSummary:
        connection = sqlite3.connect(path, timeout=5)
        barrier.wait()
        try:
            return process_inbound(connection, InboundEnvelope(
                'gmail-1', 'thread-1', 'enr-1', '2026-09-03T13:00:00+00:00',
                {'Subject': 'Re: Coffee'}, read_body,
            ))
        finally:
            connection.close()

    def read_body() -> str:
        nonlocal body_reads
        with read_lock:
            body_reads += 1
        return 'Please unsubscribe me'

    with ThreadPoolExecutor(max_workers=2) as workers:
        summaries = list(workers.map(lambda _: worker(), range(2)))

    observer = sqlite3.connect(path)
    assert body_reads == 1
    assert observer.execute("SELECT count(*) FROM inbound").fetchone()[0] == 1
    assert summaries.count(InboundSummary(1, 1, 0)) == 1
    assert summaries.count(InboundSummary(0, 0, 0)) == 1


def test_store_migration_installs_inbound_claim_table() -> None:
    connection = sqlite3.connect(":memory:")
    migrate(connection)
    assert connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_claim'"
    ).fetchone() == ('inbound_claim',)


def test_counts_only_summary_is_safe_at_every_vm_sink() -> None:
    summary = InboundSummary(processed=14, stopped=8, blocked=4)
    for sink in VM_SINKS:
        assert_vm_safe(summary.as_vm_output(sink), sink)
