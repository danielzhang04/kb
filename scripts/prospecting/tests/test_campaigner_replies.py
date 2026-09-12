from __future__ import annotations
import hashlib
import json
import sqlite3
import pytest
from scripts.prospecting.campaigner.fake_gmail import FakeGmail
from scripts.prospecting.campaigner.requests import CampaignerRequests
from scripts.prospecting.campaigner.replies import ReplyContext, draft_reply
from scripts.prospecting.executor_campaigner import OPERATION_HANDLERS
from scripts.prospecting.gmail_adapter import GmailAdapter
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_campaigner_replies")


def test_human_reply_creates_immutable_revision_and_typed_draft_request() -> None:
    db = sqlite3.connect(':memory:')
    db.executescript("""
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,class TEXT,gmail_thread_id TEXT);
      CREATE TABLE reply_template(id TEXT,version INTEGER,body_hash TEXT,approved_at TEXT,PRIMARY KEY(id,version));
      CREATE TABLE reply_revision(reply_revision_id TEXT PRIMARY KEY,inbound_id TEXT,campaign_id TEXT,contact_id TEXT,mailbox_id TEXT,class TEXT,template_id TEXT,template_version INTEGER,subject TEXT,body TEXT,hash TEXT UNIQUE,generation_mode TEXT);
      CREATE TABLE exec_request(request_id TEXT PRIMARY KEY,caller TEXT,operation TEXT,payload TEXT,policy_hash TEXT,approval_id TEXT,created_at TEXT,state TEXT,reason TEXT,tier TEXT DEFAULT 'T0');
      INSERT INTO inbound VALUES('inbound','human_neutral','thread-placeholder');
    """)
    body = 'Thanks for your reply. I will follow up personally.'
    db.execute("INSERT INTO reply_template VALUES('ack-v1',1,?,'2026-09-03T12:00:00+00:00')",
               (hashlib.sha256(body.encode()).hexdigest(),))
    gmail = FakeGmail()
    root = gmail.seed_outbound('Coffee', SYNTHETIC["root_message_id"])
    db.execute("UPDATE inbound SET gmail_thread_id=?", (root.thread_id,))
    result = draft_reply(db, CampaignerRequests(db, 'a'*64), ReplyContext(
        'inbound','camp','cp_0123456789abcdef','pol_0123456789abcdef','Coffee','ack-v1',1,body))
    assert result.created is True
    row = db.execute("SELECT class,generation_mode,body FROM reply_revision").fetchone()
    assert row == ('human_neutral','deterministic_template',body)
    request = db.execute("SELECT operation,payload,tier FROM exec_request").fetchone()
    assert request == (
        'gmail_draft',
        json.dumps({'contact_id': 'cp_0123456789abcdef', 'mailbox_id': 'pol_0123456789abcdef',
                    'revision_id': result.reply_revision_id},
                   sort_keys=True, separators=(',', ':')),
        'T0',
    )
    draft = OPERATION_HANDLERS['gmail_draft'](
        db, GmailAdapter(gmail), result.reply_revision_id, 'cp_0123456789abcdef', 'pol_0123456789abcdef',
    )
    assert draft.thread_id == root.thread_id
    assert draft.subject == root.subject
    assert draft.headers['In-Reply-To'] == SYNTHETIC["root_message_id"]
    assert draft.headers['References'] == SYNTHETIC["root_message_id"]
    db.execute("UPDATE reply_template SET body_hash='changed' WHERE id='ack-v1' AND version=1")
    with pytest.raises(ValueError, match='reply_template_hash_mismatch'):
        OPERATION_HANDLERS['gmail_draft'](
            db, GmailAdapter(gmail), result.reply_revision_id, 'cp_0123456789abcdef', 'pol_0123456789abcdef',
        )
    db.execute("UPDATE reply_template SET body_hash=? WHERE id='ack-v1' AND version=1",
               (hashlib.sha256(body.encode()).hexdigest(),))
    for index, inbound_class in enumerate((
        'scheduling_logistics', 'thanks_ack', 'graceful_close',
        'substantive_positive', 'human_negative',
    ), start=1):
        inbound_id = f'inbound-{index}'
        db.execute("INSERT INTO inbound VALUES(?,?,?)", (inbound_id, inbound_class, root.thread_id))
        created = draft_reply(db, CampaignerRequests(db, 'a'*64), ReplyContext(
            inbound_id, 'camp', 'cp_0123456789abcdef', 'pol_0123456789abcdef', 'Coffee', 'ack-v1', 1, body,
        ))
        assert created.created is True
    assert db.execute("SELECT count(*) FROM reply_revision").fetchone()[0] == 6
    assert db.execute("SELECT count(*) FROM exec_request WHERE operation='gmail_draft'").fetchone()[0] == 6


def test_reply_revision_rolls_back_when_enqueue_fails_then_retries_once() -> None:
    db = sqlite3.connect(':memory:')
    db.executescript("""
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,class TEXT);
      CREATE TABLE reply_template(id TEXT,version INTEGER,body_hash TEXT,approved_at TEXT,PRIMARY KEY(id,version));
      CREATE TABLE reply_revision(reply_revision_id TEXT PRIMARY KEY,inbound_id TEXT,campaign_id TEXT,contact_id TEXT,mailbox_id TEXT,class TEXT,template_id TEXT,template_version INTEGER,subject TEXT,body TEXT,hash TEXT UNIQUE,generation_mode TEXT);
      INSERT INTO inbound VALUES('inbound','human_neutral');
    """)
    body = 'Thanks for your reply. I will follow up personally.'
    db.execute("INSERT INTO reply_template VALUES('ack-v1',1,?,'2026-09-03T12:00:00+00:00')",
               (hashlib.sha256(body.encode()).hexdigest(),))
    db.commit()

    class FailingRequests:
        def enqueue(self, **kwargs: object) -> str:
            raise RuntimeError('enqueue failed')

    with pytest.raises(RuntimeError, match='enqueue failed'):
        draft_reply(db, FailingRequests(), ReplyContext(
            'inbound', 'camp', 'contact', 'mailbox', 'Coffee', 'ack-v1', 1, body,
        ))
    assert db.execute("SELECT count(*) FROM reply_revision").fetchone()[0] == 0

    requests: list[dict[str, object]] = []

    class RecordingRequests:
        def enqueue(self, **kwargs: object) -> str:
            requests.append(kwargs)
            return 'request'

    result = draft_reply(db, RecordingRequests(), ReplyContext(
        'inbound', 'camp', 'contact', 'mailbox', 'Coffee', 'ack-v1', 1, body,
    ))
    assert result.created is True
    assert db.execute("SELECT count(*) FROM reply_revision").fetchone()[0] == 1
    assert len(requests) == 1
    assert draft_reply(db, RecordingRequests(), ReplyContext(
        'inbound', 'camp', 'contact', 'mailbox', 'Coffee', 'ack-v1', 1, body,
    )).created is False
    assert len(requests) == 1


def test_non_reply_class_creates_nothing(monkeypatch) -> None:
    db = sqlite3.connect(':memory:')
    db.executescript("""
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,class TEXT);
      CREATE TABLE reply_template(id TEXT,version INTEGER,body_hash TEXT,approved_at TEXT,PRIMARY KEY(id,version));
      CREATE TABLE reply_revision(reply_revision_id TEXT PRIMARY KEY,inbound_id TEXT,campaign_id TEXT,contact_id TEXT,mailbox_id TEXT,class TEXT,template_id TEXT,template_version INTEGER,subject TEXT,body TEXT,hash TEXT UNIQUE,generation_mode TEXT);
    """)
    calls: list[object] = []
    monkeypatch.setattr('scripts.prospecting.campaigner.requests.store.insert_exec_request',
                        lambda connection, request, campaign_tier: calls.append(request))
    for index, inbound_class in enumerate((
        'ooo', 'bounce_failed', 'bounce_delayed', 'unsubscribe',
        'wrong_person', 'automatic', 'ambiguous', 'sensitive',
    )):
        inbound_id = f'inbound-{index}'
        db.execute("INSERT INTO inbound VALUES(?,?)", (inbound_id, inbound_class))
        result = draft_reply(db, CampaignerRequests(db, 'p'*64), ReplyContext(
            inbound_id, 'camp', 'contact', 'mailbox', 'Coffee', 'ack-v1', 1, 'unused'))
        assert result.created is False
    assert db.execute("SELECT count(*) FROM reply_revision").fetchone()[0] == 0
    assert calls == []


def test_template_hash_mismatch_is_fail_closed(monkeypatch) -> None:
    db = sqlite3.connect(':memory:')
    db.executescript("""
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,class TEXT,gmail_thread_id TEXT);
      CREATE TABLE reply_template(id TEXT,version INTEGER,body_hash TEXT,approved_at TEXT,PRIMARY KEY(id,version));
      CREATE TABLE reply_revision(reply_revision_id TEXT PRIMARY KEY,inbound_id TEXT,campaign_id TEXT,contact_id TEXT,mailbox_id TEXT,class TEXT,template_id TEXT,template_version INTEGER,subject TEXT,body TEXT,hash TEXT UNIQUE,generation_mode TEXT);
      INSERT INTO inbound VALUES('inbound','human_neutral','thread-placeholder');
      INSERT INTO reply_template VALUES('ack-v1',1,'wrong','2026-09-03T12:00:00+00:00');
    """)
    calls: list[object] = []
    monkeypatch.setattr('scripts.prospecting.campaigner.requests.store.insert_exec_request',
                        lambda connection, request, campaign_tier: calls.append(request))
    with pytest.raises(ValueError, match='reply_template_hash_mismatch'):
        draft_reply(db, CampaignerRequests(db, 'p'*64), ReplyContext(
            'inbound','camp','contact','mailbox','Coffee','ack-v1',1,'changed'))
    assert calls == []
