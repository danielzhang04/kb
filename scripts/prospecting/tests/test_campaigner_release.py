from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone

import pytest

import scripts.prospecting.executor_campaigner as executor_campaigner
from scripts.prospecting import store as store_module
from scripts.prospecting.campaigner.fake_gmail import ArrivalPoint, FakeGmail
from scripts.prospecting.campaigner.release import ReleaseContext, release_due
from scripts.prospecting.campaigner.requests import CampaignerRequests
from scripts.prospecting.gmail_adapter import GmailAdapter
from scripts.prospecting.campaigner.wiring import attach_campaigner, attach_gmail
from scripts.prospecting.executor import Executor
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture

REVISION_ID = 'rev_0000000000000001'
REVISION_HASH = 'b' * 64
SYNTHETIC = legacy_fixture("test_campaigner_release")
_REAL_REVISION_READY = executor_campaigner._revision_ready


def store(path) -> sqlite3.Connection:
    db = sqlite3.connect(path, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.executescript("""
      PRAGMA journal_mode=WAL;
      CREATE TABLE campaign(campaign_id TEXT PRIMARY KEY,policy_json TEXT,policy_hash TEXT,status TEXT);
      CREATE TABLE enrollment(enrollment_id TEXT PRIMARY KEY,campaign_id TEXT,person_id TEXT,status TEXT,stop_reason TEXT,block_reason TEXT);
      CREATE TABLE revision(revision_id TEXT PRIMARY KEY,hash TEXT UNIQUE,person_id TEXT,campaign_id TEXT,step INTEGER,subject TEXT,body TEXT,qa TEXT,evidence_ids TEXT);
      CREATE TABLE contact_point(contact_id TEXT PRIMARY KEY,person_id TEXT,email TEXT,state TEXT);
      CREATE TABLE employment(employment_id TEXT PRIMARY KEY,person_id TEXT,company_id TEXT,valid_to TEXT);
      CREATE TABLE eligibility_decision(decision_id TEXT PRIMARY KEY,campaign_id TEXT,person_id TEXT,outcome TEXT,decided_at TEXT);
      CREATE TABLE suppression(scope TEXT,subject_key TEXT,released_at TEXT);
      CREATE TABLE delivery(delivery_id TEXT PRIMARY KEY,campaign_id TEXT,enrollment_id TEXT,step INTEGER,revision_hash TEXT,contact_id TEXT,mailbox_id TEXT,logical_key TEXT UNIQUE,rfc_message_id TEXT UNIQUE,gmail_message_id TEXT,gmail_thread_id TEXT,scheduled_at TEXT,attempted_at TEXT,state TEXT);
      CREATE TABLE audit(event_id TEXT PRIMARY KEY,actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,at TEXT,before_hash TEXT,after_hash TEXT,reason TEXT);
      CREATE TABLE exec_request(request_id TEXT PRIMARY KEY,caller TEXT,operation TEXT,payload TEXT,policy_hash TEXT,approval_id TEXT,created_at TEXT,claimed_at TEXT,state TEXT,reason TEXT);
      INSERT INTO campaign VALUES('camp','{"approval_tier":"T0","mailbox_id":"pol_0000000000000001","daily_cap":25,"hourly_cap":6,"firm_collision_cap":2,"send_window":"12:10-14:30","timezone":"UTC"}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','active');
      INSERT INTO enrollment VALUES('enr','camp','person','scheduled',NULL,NULL);
      INSERT INTO revision VALUES('rev_0000000000000001','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','person','camp',0,'Coffee','Synthetic body','{"passed":true,"qa_score":100}','["evidence"]');
      INSERT INTO employment VALUES('employment','person','company',NULL);
      INSERT INTO eligibility_decision VALUES('decision','camp','person','eligible','2026-09-03T00:00:00+00:00');
    """)
    db.execute(
        "INSERT INTO contact_point VALUES('cp_0000000000000001','person',?,'valid')",
        (SYNTHETIC["contact_email"],),
    )
    db.commit()
    return db


@pytest.fixture(autouse=True)
def available_policy_timezone(monkeypatch) -> None:
    monkeypatch.setattr(
        'scripts.prospecting.executor_campaigner.ZoneInfo', lambda _name: timezone.utc,
    )
    # Existing tests isolate T0 race/release mechanics from P16 receipt setup.
    monkeypatch.setattr(executor_campaigner, "_revision_ready", lambda *_args: True)


def _actual_ready_draft_fixture(
    tmp_path,
    *,
    expires_at: str = "2099-01-01T00:00:00+00:00",
    gmail_thread_id: str | None = None,
):
    """Build a genuine P16 chain, human-ready event, and queued T0 draft."""
    from scripts.prospecting.pipeline_stage_service import PipelineStageService
    from scripts.prospecting.review_service import EditorialRequest, ReviewService
    from scripts.prospecting.tests.test_pipeline_stage_service import (
        NOW,
        _adapters,
        _run_to_review,
        _seed,
    )

    connection, revision = _seed(tmp_path)
    connection.execute(
        "UPDATE evidence SET expires_at=? WHERE evidence_id='evidence-a'", (expires_at,),
    )
    connection.execute(
        "UPDATE source_snapshot SET expires_at=? WHERE snapshot_id=?",
        (expires_at, "obs_" + "a" * 16),
    )
    connection.commit()
    instant = datetime.fromisoformat(NOW.replace("Z", "+00:00"))
    pipeline = PipelineStageService(
        connection, adapters=_adapters(unchanged=True), now=lambda: instant,
    )
    item = pipeline.start_from_saved_revision(
        "campaign-a", revision.revision_id, "executor-chain-start",
    )
    _run_to_review(pipeline, item.item_id)
    accepted = pipeline.accept_suggestion(
        item.item_id, "executor-chain-accept", revision.revision_id, "human:fixture",
    )
    review = ReviewService(connection, now=lambda: NOW)
    review.set_editorial_ready(EditorialRequest(
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeec1",
        "campaign-a", accepted.revision_id, True,
    ))
    mailbox_id = "pol_0000000000000721"
    policy = {
        "approval_tier": "T0",
        "mailbox_id": mailbox_id,
        "daily_cap": 25,
        "hourly_cap": 6,
        "firm_collision_cap": 2,
        "send_window": "11:00-14:30",
        "timezone": "UTC",
    }
    connection.execute(
        "UPDATE campaign SET status='approved',approval_tier='T0',mailbox_id=?,"
        "policy_json=? WHERE campaign_id='campaign-a'",
        (mailbox_id, json.dumps(policy, sort_keys=True, separators=(",", ":"))),
    )
    activation = {
        "assertion_ref": "executor-activation",
        "campaign_id": "campaign-a",
        "policy_hash": "a" * 64,
        "content_kind": "campaign_policy",
        "revision_hash": None,
        "contact_id": None,
        "mailbox_id": None,
        "approver": "human:fixture",
        "approved_at": "2020-01-01T00:00:00Z",
        "expires_at": "2100-01-01T00:00:00Z",
        "tier": "T0",
        "send_window": "{}",
        "nonce": "executor-activation",
        "permitted_action": "activate_campaign",
    }
    connection.execute(
        "INSERT INTO approval(approval_id,assertion_ref,campaign_id,policy_hash,content_kind,"
        "revision_hash,contact_id,mailbox_id,approver,approved_at,expires_at,tier,send_window,"
        "nonce,permitted_action,scope_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("approval-executor-activation", *(activation[key] for key in activation),
         store_module.approval_scope_hash(activation)),
    )
    connection.execute("UPDATE campaign SET status='active' WHERE campaign_id='campaign-a'")
    connection.execute(
        "INSERT INTO fit_score_version VALUES(?,?,?,?,?,?)",
        ("executor-fit-version", "fixture", "{}", "7" * 64, NOW, NOW),
    )
    connection.execute(
        "INSERT INTO eligibility_decision("
        "decision_id,campaign_id,person_id,rule_version,fit_score_version_id,outcome,"
        "failed_predicate_ids,approximate_predicate_ids,decided_at"
        ") VALUES(?,?,?,?,?,?,?,?,?)",
        ("executor-decision", "campaign-a", "person-a", "fixture",
         "executor-fit-version", "eligible", "[]", "[]", NOW),
    )
    contact_id = "cp_0000000000000721"
    connection.execute(
        "INSERT INTO contact_point VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (contact_id, "person-a", "cmp_" + "a" * 16, SYNTHETIC["contact_email"],
         "manual", "fixture", NOW, NOW, "valid", 1.0, 0),
    )
    connection.execute(
        "INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?)",
        ("executor-enrollment", "campaign-a", "person-a", 0, NOW,
         "scheduled", None, None, "fixture"),
    )
    connection.execute(
        "INSERT INTO delivery("
        "delivery_id,campaign_id,enrollment_id,step,revision_hash,contact_id,mailbox_id,"
        "logical_key,gmail_thread_id,rfc_message_id,scheduled_at,state"
        ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        ("executor-delivery", "campaign-a", "executor-enrollment", 0,
         accepted.revision_hash, contact_id, mailbox_id, "7" * 64,
         gmail_thread_id, SYNTHETIC["deterministic_message_id"], NOW, "reserved"),
    )
    request = store_module.ExecRequest(
        "req_0000000000000721", "prospecting-campaigner", "gmail_draft",
        {"revision_id": accepted.revision_id, "contact_id": contact_id,
         "mailbox_id": mailbox_id},
        "a" * 64, None, NOW, "queued", None,
    )
    store_module.insert_exec_request(connection, request, "T0", NOW)
    connection.commit()
    return connection, accepted, review, NOW


@pytest.mark.parametrize(("point", "expected"), [
    (ArrivalPoint.BEFORE_REFRESH, "cancelled"),
    (ArrivalPoint.BETWEEN_REFRESH_AND_CAS, "cancelled"),
    (ArrivalPoint.AFTER_CAS, "stopped_after_claim"),
], ids=('before-refresh','between-refresh-cas','after-cas'))
def test_reply_race_boundary_from_second_thread(tmp_path, point: ArrivalPoint, expected: str) -> None:
    db, gmail = store(tmp_path / f"{point.value}.sqlite"), FakeGmail()
    root = gmail.seed_outbound("Coffee", SYNTHETIC["root_message_id"])
    db.execute(
        "INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,'reserved')",
        ('del','camp','enr',0,REVISION_HASH,'cp_0000000000000001','pol_0000000000000001','a'*64,
         SYNTHETIC["deterministic_message_id"],root.thread_id,'2026-09-03T12:00:00+00:00'),
    )
    gmail.queue_inbound(point, root.thread_id, "Coffee", {"In-Reply-To": SYNTHETIC["root_message_id"]}, "Synthetic reply")

    def inject(selected: ArrivalPoint) -> None:
        worker = threading.Thread(target=gmail.arrive, args=(selected,))
        worker.start()
        worker.join(5)
        assert not worker.is_alive()

    def persist(thread) -> None:
        if any(message.inbound for message in thread.messages):
            with db:
                db.execute("UPDATE enrollment SET status='stopped',stop_reason='human_reply',block_reason=NULL")

    request_id = f"req_{list(ArrivalPoint).index(point) + 1:016x}"
    db.execute(
        "INSERT INTO exec_request VALUES(?,?,?,?,?,?,?,?,?,?)",
        (request_id, 'prospecting-campaigner', 'gmail_draft',
             json.dumps({'revision_id': 'rev_0000000000000001', 'contact_id': 'cp_0000000000000001', 'mailbox_id': 'pol_0000000000000001'}), 'a' * 64,
         None, '2026-09-03T13:00:00+00:00', None, 'queued', None),
    )
    db.commit()
    executor = Executor(db)
    attach_campaigner(executor, gmail, persist_inbound=persist, inject=inject,
                      now='2026-09-03T13:00:00+00:00')
    assert executor.process_one() is True
    state, reason = db.execute(
        "SELECT state,reason FROM exec_request WHERE request_id=?", (request_id,)
    ).fetchone()
    assert (state, reason) == (("succeeded", "drafted") if expected == "drafted"
                               else ("rejected", expected if expected == "stopped_after_claim" else "cancelled"))
    assert sum(message.draft for message in gmail.thread_get(root.thread_id).messages) == int(expected == 'drafted')
    if expected == "stopped_after_claim":
        assert tuple(db.execute("SELECT state,attempted_at FROM delivery WHERE delivery_id='del'").fetchone()) == ('reserved', None)
    assert db.execute("SELECT count(*) FROM exec_request WHERE operation='gmail_send'").fetchone()[0] == 0
    if expected == "drafted":
        audit = db.execute(
            "SELECT actor,action,entity_id,before_hash,after_hash,reason FROM audit "
            "WHERE action='gmail_draft'"
        ).fetchone()
        assert tuple(audit) == ('executor', 'gmail_draft', 'del', 'claimed', 'attempted',
                                'draft_created:dl_del')
        assert root.thread_id not in audit[-1]


def test_attach_gmail_rejects_raw_draft_requests(tmp_path) -> None:
    db, gmail = store(tmp_path / 'raw-draft.sqlite'), FakeGmail()
    db.execute(
        "INSERT INTO exec_request VALUES(?,?,?,?,?,?,?,?,?,?)",
        ('req_0000000000000099', 'prospecting-campaigner', 'gmail_draft',
         json.dumps({'revision_id': 'rev_0000000000000001', 'contact_id': 'cp_0000000000000001', 'mailbox_id': 'pol_0000000000000001'}),
         'a' * 64, None, '2026-09-03T13:00:00+00:00', None, 'queued', None),
    )
    db.commit()
    executor = Executor(db)
    attach_gmail(executor, gmail)
    assert executor.process_one() is True
    assert tuple(db.execute("SELECT state,reason FROM exec_request").fetchone()) == ('rejected', 'no_adapter')


def test_executor_rejects_unavailable_policy_timezone(tmp_path, monkeypatch) -> None:
    db, gmail = store(tmp_path / "timezone.sqlite"), FakeGmail()
    root = gmail.seed_outbound("Coffee", SYNTHETIC["root_message_id"])
    db.execute("UPDATE campaign SET policy_json=json_set(policy_json, '$.timezone', 'Missing/Zone')")
    db.execute(
        "INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,'reserved')",
        ('del','camp','enr',0,REVISION_HASH,'cp_0000000000000001','pol_0000000000000001','a'*64,
         SYNTHETIC["deterministic_message_id"],root.thread_id,'2026-09-03T12:00:00+00:00'),
    )
    db.execute(
        "INSERT INTO exec_request VALUES(?,?,?,?,?,?,?,?,?,?)",
        ('req_0000000000000004', 'prospecting-campaigner', 'gmail_draft',
         json.dumps({'revision_id': 'rev_0000000000000001', 'contact_id': 'cp_0000000000000001', 'mailbox_id': 'pol_0000000000000001'}), 'a' * 64,
         None, '2026-09-03T13:00:00+00:00', None, 'queued', None),
    )
    db.commit()
    import scripts.prospecting.executor_campaigner as campaigner_executor

    def unavailable(_name: str):
        raise campaigner_executor.ZoneInfoNotFoundError

    monkeypatch.setattr(campaigner_executor, 'ZoneInfo', unavailable)
    executor = Executor(db)
    attach_campaigner(executor, gmail, persist_inbound=lambda _thread: None,
                      inject=lambda _point: None, now='2026-09-03T13:00:00+00:00')
    assert executor.process_one() is True
    assert tuple(db.execute(
        "SELECT state,reason FROM exec_request WHERE request_id='req_0000000000000004'"
    ).fetchone()) == ('rejected', 'timezone_unavailable')
    assert sum(message.draft for message in gmail.thread_get(root.thread_id).messages) == 0


def test_uncertain_result_reconciles_without_retry(tmp_path) -> None:
    db, gmail = store(tmp_path / "uncertain.sqlite"), FakeGmail()
    root = gmail.seed_outbound("Coffee", SYNTHETIC["root_message_id"])
    adapter = GmailAdapter(gmail)
    adapter.draft_create_in_thread(logical_key='a'*64, contact_id='cp_0000000000000001',
        thread_id=root.thread_id,
        subject='Coffee', body='Synthetic body', parent_message_id=SYNTHETIC["root_message_id"],
        references=(SYNTHETIC["root_message_id"],))
    db.execute("INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,'uncertain')",
        ('del','camp','enr',0,REVISION_HASH,'cp_0000000000000001','pol_0000000000000001','a'*64,
         SYNTHETIC["deterministic_message_id"],root.thread_id,'2026-09-03T12:00:00+00:00'))
    db.execute(
        "INSERT INTO exec_request VALUES(?,?,?,?,?,?,?,?,?,?)",
        ('req_0000000000000005', 'prospecting-campaigner', 'gmail_draft',
         json.dumps({'revision_id': 'rev_0000000000000001', 'contact_id': 'cp_0000000000000001',
                     'mailbox_id': 'pol_0000000000000001'}), 'a' * 64,
         None, '2026-09-03T12:01:00+00:00', None, 'queued', None),
    )
    db.commit()
    executor = Executor(db)
    attach_campaigner(executor, gmail, persist_inbound=lambda _thread: None,
                      inject=lambda _point: None, now='2026-09-03T12:01:00+00:00')
    assert executor.process_one() is True
    assert tuple(db.execute(
        "SELECT state,reason FROM exec_request WHERE request_id='req_0000000000000005'"
    ).fetchone()) == ('succeeded', 'reconciled')
    assert sum(message.draft for message in gmail.thread_get(root.thread_id).messages) == 1


def test_zero_gmail_send_requests_across_every_path(tmp_path, monkeypatch) -> None:
    db = store(tmp_path / "request.sqlite")
    db.execute("INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,NULL,'reserved')",
               ('del','camp','enr',0,REVISION_HASH,'cp_0000000000000001','pol_0000000000000001','a'*64,
                SYNTHETIC["deterministic_message_id"],'2026-09-03T12:00:00+00:00'))
    calls: list[object] = []
    monkeypatch.setattr(
        'scripts.prospecting.campaigner.requests.store.insert_exec_request',
        lambda connection, request, campaign_tier: calls.append(request),
    )
    result = release_due(ReleaseContext(db, CampaignerRequests(db, 'p'*64)), 'del')
    assert result.state == 'queued' and len(calls) == 1
    assert calls[0].operation == 'gmail_draft'
    assert calls[0].payload == {
        'revision_id': REVISION_ID,
        'contact_id': 'cp_0000000000000001', 'mailbox_id': 'pol_0000000000000001',
    }
    db.execute("DELETE FROM revision WHERE hash=?", (REVISION_HASH,))
    assert release_due(ReleaseContext(db, CampaignerRequests(db, 'p'*64)), 'del').state == 'missing_revision'
    assert len(calls) == 1
    for path, operation, action, payload in (
        ('first_touch', 'gmail_draft', 'linearized_draft', {'delivery_id': 'first'}),
        ('follow_up', 'gmail_draft', 'linearized_draft', {'delivery_id': 'follow'}),
        ('reply', 'gmail_draft', 'draft_create_in_thread', {'delivery_id': 'reply'}),
        ('retry', 'gmail_thread_refresh', 'message_id_reconcile', {'delivery_id': 'retry'}),
        ('reschedule', 'gmail_thread_refresh', 'message_id_reconcile', {'delivery_id': 'reschedule'}),
        ('warning', 'gmail_label', 'labels_modify', {'thread_id': 'warning', 'add': (), 'remove': ()}),
        ('race', 'gmail_draft', 'linearized_draft', {'delivery_id': 'race'}),
    ):
        CampaignerRequests(db, 'p'*64).enqueue(operation=operation, action=action, payload=payload)
    assert {request.payload.get('delivery_id', request.payload.get('reply_revision_id', request.payload.get('thread_id'))) for request in calls[1:]} == {
        'first', 'follow', 'reply', 'retry', 'reschedule', 'warning', 'race'
    }
    assert all(request.operation != 'gmail_send' for request in calls)
    assert db.execute(
        "SELECT count(*) FROM exec_request WHERE operation='gmail_send'"
    ).fetchone()[0] == 0


@pytest.mark.parametrize(
    "mutation",
    [
        "UPDATE delivery SET campaign_id='other' WHERE delivery_id='del'",
        "UPDATE delivery SET step=1 WHERE delivery_id='del'",
        "UPDATE contact_point SET person_id='other' WHERE contact_id='cp_0000000000000001'",
        "UPDATE enrollment SET person_id='other' WHERE enrollment_id='enr'",
    ],
    ids=(
        "campaign-scope-mismatch",
        "step-mismatch",
        "contact-person-mismatch",
        "person-mismatch",
    ),
)
def test_release_refuses_cross_scope_delivery_components(tmp_path, mutation) -> None:
    db = store(tmp_path / "scope.sqlite")
    db.execute(
        "INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,NULL,'reserved')",
        (
            "del", "camp", "enr", 0, REVISION_HASH, "cp_0000000000000001",
            "pol_0000000000000001", "a" * 64,
            SYNTHETIC["deterministic_message_id"], "2026-09-03T12:00:00+00:00",
        ),
    )
    db.execute(mutation)
    db.commit()

    result = release_due(
        ReleaseContext(db, CampaignerRequests(db, "p" * 64)), "del"
    )

    assert result.state == "scope_mismatch"
    assert db.execute("SELECT count(*) FROM exec_request").fetchone()[0] == 0


def test_two_executor_requests_mutate_one_logical_key(tmp_path) -> None:
    db = store(tmp_path / "workers.sqlite")
    gmail = FakeGmail()
    root = gmail.seed_outbound("Coffee", SYNTHETIC["root_message_id"])
    db.execute("INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,'reserved')",
               ('del','camp','enr',0,REVISION_HASH,'cp_0000000000000001','pol_0000000000000001','a'*64,
                SYNTHETIC["deterministic_message_id"],root.thread_id,'2026-09-03T12:00:00+00:00'))
    for request_id in ('req_0000000000000006', 'req_0000000000000007'):
        db.execute(
            "INSERT INTO exec_request VALUES(?,?,?,?,?,?,?,?,?,?)",
            (request_id, 'prospecting-campaigner', 'gmail_draft',
             json.dumps({'revision_id': 'rev_0000000000000001',
                         'contact_id': 'cp_0000000000000001', 'mailbox_id': 'pol_0000000000000001'}),
             'a' * 64, None, '2026-09-03T13:00:00+00:00', None, 'queued', None),
        )
    db.commit()
    executor = Executor(db)
    attach_campaigner(executor, gmail, persist_inbound=lambda _thread: None,
                      inject=lambda _point: None, now='2026-09-03T13:00:00+00:00')
    assert executor.process_one() is True
    assert executor.process_one() is True
    assert [tuple(row) for row in db.execute(
        "SELECT state,reason FROM exec_request WHERE operation='gmail_draft' ORDER BY request_id"
    )] == [('succeeded', 'drafted'), ('rejected', 'delivery_not_unique')]
    assert db.execute("SELECT count(*) FROM exec_request WHERE operation='gmail_label'").fetchone()[0] == 2
    assert sum(message.draft for message in gmail.thread_get(root.thread_id).messages) == 1
    reasons = {
        'stop_reason': (
            'human_reply', 'ooo', 'hard_bounce', 'decline', 'unsubscribe',
            'wrong_person', 'manual_dnc', 'exhausted_touches', 'closed_no_reply',
        ),
        'block_reason': (
            'manual_hold', 'campaign_paused', 'suppression_active', 'daily_cap',
            'hourly_cap', 'send_window', 'google_warning', 'delayed_dsn',
            'approval_missing', 'approval_expired', 'approval_mismatch',
            'hash_mismatch', 'firm_collision', 'machine_unavailable',
            'gmail_uncertain', 'inbound_refresh_error',
        ),
    }
    for column, values in reasons.items():
        for index, reason in enumerate(values):
            case = store(tmp_path / f"{column}-{index}.sqlite")
            fake = FakeGmail()
            parent = fake.seed_outbound("Coffee", f"<{column}-{index}@kb.test>")
            case.execute(
                f"UPDATE enrollment SET status=?,{column}=? WHERE enrollment_id='enr'",
                ('stopped' if column == 'stop_reason' else 'blocked', reason),
            )
            case.execute("INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,'reserved')",
                         ('del','camp','enr',0,REVISION_HASH,'cp_0000000000000001','pol_0000000000000001',f'{index:064x}',
                          f'<{index:064x}@prospecting.local>',parent.thread_id,'2026-09-03T12:00:00+00:00'))
            case.execute(
                "INSERT INTO exec_request VALUES(?,?,?,?,?,?,?,?,?,?)",
                ('req_0000000000000008', 'prospecting-campaigner', 'gmail_draft',
                 json.dumps({'revision_id': 'rev_0000000000000001',
                             'contact_id': 'cp_0000000000000001', 'mailbox_id': 'pol_0000000000000001'}),
                 'a' * 64, None, '2026-09-03T13:00:00+00:00', None, 'queued', None),
            )
            case.commit()
            executor = Executor(case)
            attach_campaigner(executor, fake, persist_inbound=lambda _thread: None,
                              inject=lambda _point: None, now='2026-09-03T13:00:00+00:00')
            assert executor.process_one() is True
            assert tuple(case.execute(
                "SELECT state,reason FROM exec_request WHERE request_id='req_0000000000000008'"
            ).fetchone()) == ('rejected', 'cancelled')
            assert sum(message.draft for message in fake.thread_get(parent.thread_id).messages) == 0


def test_post_cas_human_unready_blocks_actual_chain_without_gmail_mutation(
    tmp_path, monkeypatch,
) -> None:
    from scripts.prospecting.review_service import EditorialRequest, ReviewService

    monkeypatch.setattr(executor_campaigner, "_revision_ready", _REAL_REVISION_READY)
    db, accepted, _review, now = _actual_ready_draft_fixture(tmp_path)
    other = store_module.open_store(tmp_path / "pipeline-stage.sqlite")
    gmail = FakeGmail()

    def inject(point: ArrivalPoint) -> None:
        if point is ArrivalPoint.AFTER_CAS:
            ReviewService(other, now=lambda: now).set_editorial_ready(EditorialRequest(
                "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeec2",
                "campaign-a", accepted.revision_id, False,
            ))

    executor = Executor(db)
    attach_campaigner(
        executor, gmail, persist_inbound=lambda _thread: None, inject=inject,
        now=now, clock=lambda: now,
    )
    assert executor.process_one() is True
    assert tuple(db.execute(
        "SELECT state,reason FROM exec_request WHERE request_id='req_0000000000000721'",
    ).fetchone()) == ("rejected", "cancelled")
    assert tuple(db.execute(
        "SELECT state,attempted_at FROM delivery WHERE delivery_id='executor-delivery'",
    ).fetchone()) == ("cancelled", now)
    assert gmail._history == []
    other.close()


def test_final_gate_uses_fresh_clock_after_callbacks_cross_source_expiry(
    tmp_path, monkeypatch,
) -> None:
    monkeypatch.setattr(executor_campaigner, "_revision_ready", _REAL_REVISION_READY)
    gmail = FakeGmail()
    root = gmail.seed_outbound("Example subject", SYNTHETIC["root_message_id"])
    expiry = "2026-09-09T12:00:30+00:00"
    db, _accepted, _review, now = _actual_ready_draft_fixture(
        tmp_path, expires_at=expiry, gmail_thread_id=root.thread_id,
    )
    persisted: list[str] = []
    executor = Executor(db)
    attach_campaigner(
        executor, gmail,
        persist_inbound=lambda thread: persisted.append(thread.thread_id),
        inject=lambda _point: None,
        now=now,
        clock=lambda: "2026-09-09T12:01:00+00:00",
    )
    assert executor.process_one() is True
    assert len(persisted) == 3
    assert tuple(db.execute(
        "SELECT state,reason FROM exec_request WHERE request_id='req_0000000000000721'",
    ).fetchone()) == ("rejected", "cancelled")
    assert db.execute(
        "SELECT state FROM delivery WHERE delivery_id='executor-delivery'",
    ).fetchone()[0] == "cancelled"
    assert sum(message.draft for message in gmail.thread_get(root.thread_id).messages) == 0


def test_independent_connection_cannot_cancel_another_workers_claim(tmp_path) -> None:
    path = tmp_path / "owned-claim.sqlite"
    owner = store(path)
    gmail = FakeGmail()
    root = gmail.seed_outbound("Coffee", SYNTHETIC["root_message_id"])
    attempted_at = "2026-09-03T13:00:00+00:00"
    owner.execute(
        "INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,?,'claimed')",
        ("del", "camp", "enr", 0, REVISION_HASH, "cp_0000000000000001",
         "pol_0000000000000001", "a" * 64, SYNTHETIC["deterministic_message_id"],
         root.thread_id, "2026-09-03T12:00:00+00:00", attempted_at),
    )
    owner.commit()
    contender = sqlite3.connect(path)
    contender.row_factory = sqlite3.Row
    result = executor_campaigner.execute_linearized_draft(
        executor_campaigner.ExecutorDraftContext(
            contender, GmailAdapter(gmail), lambda _thread: None, lambda _point: None,
            attempted_at, "a" * 64, lambda: attempted_at,
        ),
        "del",
    )
    assert result.state == "cancelled"
    assert tuple(owner.execute(
        "SELECT state,attempted_at FROM delivery WHERE delivery_id='del'",
    ).fetchone()) == ("claimed", attempted_at)
    assert sum(message.draft for message in gmail.thread_get(root.thread_id).messages) == 0
    contender.close()
    owner.close()
