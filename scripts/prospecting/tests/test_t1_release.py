"""P6's T1 release boundary uses only a migrated synthetic store."""

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from threading import Barrier, Thread

import pytest

from scripts.prospecting.approval.release_t1 import (
    FenceUnavailable,
    attach_t1_send,
    consume_t1_approval,
    queue_due_t1,
    reconcile_uncertain_t1,
)
from scripts.prospecting.approval.schedule_t1 import schedule_approved_t1, stagger_deliveries
from scripts.prospecting.approval.verify import update_approval_resolution
from scripts.prospecting.campaigner.fake_gmail import ArrivalPoint, FakeGmail
from scripts.prospecting.executor import Executor
from scripts.prospecting.store import ExecRequest, approval_scope_hash, insert_exec_request, open_store
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


POLICY = "a" * 64
REVISION = "b" * 64
NOW = datetime(2099, 6, 1, 12, tzinfo=timezone.utc)
T1_SYNTHETIC_FIXTURE = Path(__file__).parents[3] / "orgs" / "prospecting" / "fixtures" / "t1-synthetic-10.json"
SYNTHETIC = legacy_fixture("test_t1_release")


class SendFakeGmail(FakeGmail):
    def __init__(self, *, crash_after_send: bool = False, fatal_after_send: bool = False) -> None:
        super().__init__()
        self.send_count = 0
        self.crash_after_send = crash_after_send
        self.fatal_after_send = fatal_after_send
        self.arrive_during_refresh = False
        self.fence_available = True
        self.arrive_before_send = False

    def history_fence(self) -> str:
        if not self.fence_available:
            raise FenceUnavailable("fence_unavailable")
        return str(self._next_history - 1)

    def thread_get(self, thread_id: str):
        return super().thread_get(thread_id)

    def messages_list(self, query: str):
        if query == "in:inbox":
            if self.arrive_during_refresh:
                self.arrive_during_refresh = False
                self.arrive(ArrivalPoint.BETWEEN_REFRESH_AND_CAS)
            return tuple(
                message for thread in self._threads.values() for message in thread.messages
                if message.inbound
            )
        return super().messages_list(query)

    def send(
        self, *, delivery_id: str, logical_key: str, rfc_message_id: str, history_id: str
    ):
        if self.arrive_before_send:
            self.arrive_before_send = False
            self.arrive(ArrivalPoint.AFTER_CAS)
        if self.history_list(history_id):
            raise FenceUnavailable("fence_unavailable")
        existing = self.messages_list(f"rfc822msgid:{rfc_message_id}")
        if existing:
            return existing[0]
        self.send_count += 1
        message = self.seed_outbound("Synthetic", rfc_message_id)
        if self.crash_after_send:
            self.crash_after_send = False
            raise RuntimeError("synthetic_crash")
        if self.fatal_after_send:
            self.fatal_after_send = False
            raise SystemExit("synthetic_process_loss")
        return message


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _freeze_sqlite_clock(db, now: datetime) -> None:
    """Make the executor's SQLite-trusted clock match this test's logical clock."""
    stamp = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    db.create_function("strftime", -1, lambda *_args: stamp)


def _seed(path, now: datetime, count: int = 1, *, future: bool = False):
    db = open_store(path)
    _freeze_sqlite_clock(db, now)
    campaign_window = f"{(now - timedelta(minutes=1)):%H:%M}-{(now + timedelta(hours=2)):%H:%M}"
    db.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("pol_0000000000000001", "Sender", None, "Synthetic", "Synthetic", "Synthetic", "[]"),
    )
    db.execute(
        "INSERT INTO company VALUES(?,?,?,?,?,?,?,?,?)",
        ("cmp_0000000000000001", "Synthetic", "https://fixture.test", None, None, None, None, "manual", "company-key"),
    )
    db.execute(
        "INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("camp_0000000000000001", "networking", "pol_0000000000000001", "{}", "relationship", 15, "warm", "fixture", "[]", campaign_window, "UTC", 25, 6, 2, "T1", "pol_0000000000000001", "{}", 0, "active", POLICY),
    )
    start = now + timedelta(minutes=1) if future else now - timedelta(minutes=1)
    end = now + timedelta(hours=2)
    for index in range(count):
        suffix = f"{index + 1:016x}"
        person, contact = f"per_{suffix}", f"cp_{suffix}"
        delivery = f"req_{index + 2:016x}"  # P1's frozen payload contract types delivery IDs as req IDs.
        db.execute("INSERT INTO person VALUES(?,?,?,?,?,?,?,?)", (person, "Synthetic", "Synthetic", None, None, None, "manual", f"person-{index}"))
        db.execute("INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,?)", (f"obs_{suffix}", "employment", person, "source", "\"fixture\"", "fixture", None, _iso(now), 1.0, None))
        db.execute("INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)", (f"emp_{suffix}", person, "cmp_0000000000000001", "Synthetic", None, None, f"obs_{suffix}", 1.0))
        db.execute("INSERT INTO contact_point VALUES(?,?,?,?,?,?,?,?,?,?,?)", (contact, person, "cmp_0000000000000001", f"synthetic-{index}@fixture.test", "manual", "fixture", None, None, "valid", 1.0, 0))
        db.execute("INSERT INTO revision VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (f"rev_{suffix}", person, "camp_0000000000000001", 0, "Synthetic", "Synthetic", "why_them", "bespoke", None, "Synthetic", "[]", "[]", "[]", "fixture", 1, "fixture", "fixture", "{\"qa_score\":100}", f"{index + 11:064x}"))
        db.execute("INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?)", (f"enr-{index}", "camp_0000000000000001", person, 0, _iso(now), "scheduled", None, None, None))
        window = json.dumps({"start": _iso(start), "end": _iso(end)}, sort_keys=True, separators=(",", ":"))
        approval = {
            "assertion_ref": f"assertion-{index}", "campaign_id": "camp_0000000000000001", "policy_hash": POLICY,
            "content_kind": "revision", "revision_hash": f"{index + 11:064x}", "contact_id": contact,
            "mailbox_id": "pol_0000000000000001", "approver": "human:fixture", "approved_at": _iso(now - timedelta(minutes=1)),
            "expires_at": _iso(end), "tier": "T1", "send_window": window, "nonce": f"nonce-{index}", "permitted_action": "send_revision",
        }
        db.execute("INSERT INTO approval VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (f"apr_{suffix}", approval["assertion_ref"], approval["campaign_id"], approval["policy_hash"], approval["content_kind"], approval["revision_hash"], contact, approval["mailbox_id"], approval["approver"], approval["approved_at"], approval["expires_at"], "T1", window, approval["nonce"], "send_revision", None, approval_scope_hash(approval), None))
        db.execute("INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (delivery, "camp_0000000000000001", f"enr-{index}", 0, approval["revision_hash"], contact, "pol_0000000000000001", f"{index + 101:064x}", None, None, f"<t1-{index}@fixture.test>", _iso(start), None, None, "reserved"))
    db.commit()
    return db


def _queue(db, now: datetime) -> str:
    delivery, approval = db.execute("SELECT delivery_id,(SELECT approval_id FROM approval LIMIT 1) FROM delivery LIMIT 1").fetchone()
    request = ExecRequest("req_0000000000000001", "prospecting-campaigner", "gmail_send", {"delivery_id": delivery}, POLICY, approval, _iso(now))
    insert_exec_request(db, request, "T1", _iso(now))
    return request.request_id


def _queue_delivery(db, now: datetime, delivery_id: str, request_id: str) -> str:
    approval = db.execute(
        "SELECT approval_id FROM approval a JOIN delivery d ON d.campaign_id=a.campaign_id "
        "AND d.revision_hash=a.revision_hash AND d.contact_id=a.contact_id AND d.mailbox_id=a.mailbox_id "
        "WHERE d.delivery_id=?", (delivery_id,)
    ).fetchone()[0]
    request = ExecRequest(request_id, "prospecting-campaigner", "gmail_send", {"delivery_id": delivery_id}, POLICY, approval, _iso(now))
    insert_exec_request(db, request, "T1", _iso(now))
    return request_id


def _threaded_delivery(db, gmail: SendFakeGmail, delivery_id: str) -> str:
    message = gmail.seed_outbound("Synthetic prior", SYNTHETIC["prior_message_id"])
    db.execute("UPDATE delivery SET gmail_thread_id=? WHERE delivery_id=?", (message.thread_id, delivery_id))
    return message.thread_id


def _clone_campaign(db, campaign_id: str) -> None:
    db.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
               template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
               firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,
               status,policy_hash
           ) SELECT ?,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
                    template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
                    firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,
                    status,policy_hash
             FROM campaign WHERE campaign_id='camp_0000000000000001'""",
        (campaign_id,),
    )


def _add_reserved_delivery(db, source_delivery_id: str, delivery_id: str, now: datetime) -> None:
    db.execute(
        """INSERT INTO delivery(
               delivery_id,campaign_id,enrollment_id,step,revision_hash,contact_id,mailbox_id,
               logical_key,gmail_message_id,gmail_thread_id,rfc_message_id,scheduled_at,
               attempted_at,sent_at,state
           ) SELECT ?,campaign_id,enrollment_id,step,revision_hash,contact_id,mailbox_id,
                    ?,NULL,NULL,?,?,NULL,NULL,'reserved'
             FROM delivery WHERE delivery_id=?""",
        (delivery_id, "f" * 64, f"<{delivery_id}@fixture.test>", _iso(now + timedelta(minutes=1)), source_delivery_id),
    )


def test_schedule_is_stable_bounded_and_staggered(tmp_path, record_property) -> None:
    now = NOW
    fixture = json.loads(T1_SYNTHETIC_FIXTURE.read_text(encoding="utf-8"))
    assert fixture["tier"] == "T1"
    db = _seed(tmp_path / "schedule.sqlite", now, len(fixture["contacts"]), future=True)
    values = schedule_approved_t1(db, now)
    assert len(values) == 10
    gaps = [(right - left).total_seconds() for left, right in zip(values, values[1:])]
    assert all(480 <= gap <= 720 for gap in gaps)
    assert schedule_approved_t1(db, now) == values
    record_property("t1_sends", 0)
    record_property("t1_rejections", 0)
    record_property("duplicate_sends", 0)


def test_approved_send_and_rejections_are_fail_closed(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "send.sqlite", now)
    _queue(db, now)
    gmail = SendFakeGmail()
    executor = Executor(db)
    attach_t1_send(executor, gmail)
    assert executor.process_one() is True
    assert gmail.send_count == 1
    assert db.execute("SELECT state FROM delivery").fetchone()[0] == "sent"
    db.execute("UPDATE exec_request SET state='queued'")
    db.execute("UPDATE delivery SET state='reserved'")
    assert executor.process_one() is True
    assert gmail.send_count == 1
    assert db.execute("SELECT state FROM exec_request").fetchone()[0] == "rejected"
    record_property("t1_sends", gmail.send_count)
    record_property("t1_rejections", 1)
    record_property("duplicate_sends", 0)


@pytest.mark.parametrize("mutation", ["expired", "consumed", "t2", "t3"])
def test_unapproved_expired_or_other_tiers_are_inert(tmp_path, mutation, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / f"{mutation}.sqlite", now)
    _queue(db, now)
    if mutation == "expired":
        db.execute("UPDATE approval SET expires_at=?", (_iso(now - timedelta(seconds=1)),))
    elif mutation == "consumed":
        db.execute("UPDATE approval SET consumed_at=?", (_iso(now),))
    else:
        db.execute("UPDATE campaign SET approval_tier=?", (mutation.upper(),))
    gmail = SendFakeGmail()
    executor = Executor(db)
    attach_t1_send(executor, gmail)
    assert executor.process_one() is True
    assert gmail.send_count == 0
    record_property("t1_sends", 0)
    record_property("t1_rejections", 1)
    record_property("duplicate_sends", 0)


def test_reconsuming_an_approval_is_refused_without_changing_it(tmp_path) -> None:
    now = NOW
    db = _seed(tmp_path / "reconsume.sqlite", now)
    approval_id = db.execute("SELECT approval_id FROM approval").fetchone()[0]
    first = _iso(now)
    consume_t1_approval(db, approval_id, first)

    with pytest.raises(ValueError, match="approval_already_resolved"):
        consume_t1_approval(db, approval_id, _iso(now + timedelta(seconds=1)))

    assert db.execute("SELECT consumed_at FROM approval WHERE approval_id=?", (approval_id,)).fetchone()[0] == first


def test_p6_api_refuses_to_uninvalidate_an_approval(tmp_path) -> None:
    now = NOW
    db = _seed(tmp_path / "uninvalidate.sqlite", now)
    approval_id = db.execute("SELECT approval_id FROM approval").fetchone()[0]
    update_approval_resolution(
        db, approval_id, consumed_at=None, invalidation_reason="revoked"
    )

    with pytest.raises(ValueError, match="approval_already_resolved"):
        update_approval_resolution(
            db, approval_id, consumed_at=None, invalidation_reason=None
        )

    assert tuple(db.execute(
        "SELECT consumed_at,invalidation_reason FROM approval WHERE approval_id=?", (approval_id,)
    ).fetchone()) == (None, "revoked")


def test_crash_after_backend_send_is_uncertain_then_reconciles_without_duplicate(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "reconcile.sqlite", now)
    _queue(db, now)
    gmail = SendFakeGmail(crash_after_send=True)
    executor = Executor(db)
    attach_t1_send(executor, gmail)
    assert executor.process_one() is True
    assert gmail.send_count == 1
    delivery_id = db.execute("SELECT delivery_id FROM delivery").fetchone()[0]
    assert db.execute("SELECT state FROM delivery").fetchone()[0] == "uncertain"
    assert db.execute("SELECT state FROM t1_delivery_guard").fetchone()[0] == "uncertain"
    assert reconcile_uncertain_t1(db, gmail, delivery_id) is True
    assert db.execute("SELECT state FROM delivery").fetchone()[0] == "sent"
    record_property("t1_sends", 1)
    record_property("t1_rejections", 1)
    record_property("duplicate_sends", 0)
    record_property("breaker_trips", 0)
    record_property("race_runs", 0)


def test_process_loss_after_send_recovers_durable_attempt_without_duplicate(tmp_path, record_property) -> None:
    now = NOW
    path = tmp_path / "durable-reconcile.sqlite"
    db = _seed(path, now)
    request_id = _queue(db, now)
    gmail = SendFakeGmail(fatal_after_send=True)
    executor = Executor(db)
    attach_t1_send(executor, gmail)
    with pytest.raises(SystemExit, match="synthetic_process_loss"):
        executor.process_one()
    assert db.execute("SELECT completed_at FROM t1_send_attempt WHERE request_id=?", (request_id,)).fetchone()[0] is None
    db.close()

    resumed = open_store(path)
    attach_t1_send(Executor(resumed), gmail)
    assert gmail.send_count == 1
    assert resumed.execute("SELECT state FROM exec_request WHERE request_id=?", (request_id,)).fetchone()[0] == "uncertain"
    assert resumed.execute("SELECT state FROM delivery").fetchone()[0] == "sent"
    assert resumed.execute("SELECT completed_at FROM t1_send_attempt WHERE request_id=?", (request_id,)).fetchone()[0] is not None
    record_property("t1_sends", gmail.send_count)
    record_property("t1_rejections", 0)
    record_property("duplicate_sends", 0)
    record_property("uncertain_recoveries", resumed.execute("SELECT count(*) FROM t1_send_attempt WHERE completed_at IS NOT NULL").fetchone()[0])


def test_send_time_daily_cap_defers_with_a_future_slot(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "deferred.sqlite", now, count=2)
    first, second = [row[0] for row in db.execute("SELECT delivery_id FROM delivery ORDER BY delivery_id")]
    db.execute("UPDATE campaign SET daily_cap=1")
    db.execute("UPDATE delivery SET state='sent',attempted_at=? WHERE delivery_id=?", (_iso(now), first))
    request_id = _queue_delivery(db, now, second, "req_0000000000000005")
    gmail = SendFakeGmail()
    executor = Executor(db)
    attach_t1_send(executor, gmail)
    assert executor.process_one() is True
    request = db.execute("SELECT state,reason FROM exec_request WHERE request_id=?", (request_id,)).fetchone()
    assert tuple(request) == ("queued", "deferred")
    scheduled = datetime.fromisoformat(db.execute("SELECT scheduled_at FROM delivery WHERE delivery_id=?", (second,)).fetchone()[0])
    assert scheduled > now
    assert gmail.send_count == 0
    record_property("t1_sends", gmail.send_count)
    record_property("t1_rejections", 0)
    record_property("duplicate_sends", 0)
    record_property("deferred_sends", db.execute("SELECT count(*) FROM exec_request WHERE reason='deferred'").fetchone()[0])


def test_uncertain_delivery_consumes_send_capacity(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "uncertain-cap.sqlite", now, count=2)
    first, second = [row[0] for row in db.execute("SELECT delivery_id FROM delivery ORDER BY delivery_id")]
    db.execute("UPDATE campaign SET daily_cap=1")
    db.execute("UPDATE delivery SET state='uncertain',attempted_at=? WHERE delivery_id=?", (_iso(now), first))
    request_id = _queue_delivery(db, now, second, "req_0000000000000006")
    gmail = SendFakeGmail()
    executor = Executor(db)
    attach_t1_send(executor, gmail)
    assert executor.process_one() is True
    assert tuple(db.execute("SELECT state,reason FROM exec_request WHERE request_id=?", (request_id,)).fetchone()) == ("queued", "deferred")
    uncertain_rows = db.execute("SELECT count(*) FROM delivery WHERE state='uncertain'").fetchone()[0]
    assert uncertain_rows == 1
    assert gmail.send_count == 0
    record_property("uncertain_cap_rows", uncertain_rows)
    record_property("t1_sends", gmail.send_count)
    record_property("t1_rejections", 0)


def test_send_time_firm_cap_counts_other_campaigns(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "cross-campaign-firm.sqlite", now, count=2)
    first, second = [row[0] for row in db.execute("SELECT delivery_id FROM delivery ORDER BY delivery_id")]
    other_campaign = "camp_0000000000000002"
    _clone_campaign(db, other_campaign)
    db.execute("UPDATE campaign SET firm_collision_cap=1")
    db.execute("UPDATE delivery SET campaign_id=?,state='sent',attempted_at=? WHERE delivery_id=?", (other_campaign, _iso(now), first))
    request_id = _queue_delivery(db, now, second, "req_0000000000000007")
    gmail = SendFakeGmail()
    executor = Executor(db)
    attach_t1_send(executor, gmail)
    assert executor.process_one() is True
    assert tuple(db.execute("SELECT state,reason FROM exec_request WHERE request_id=?", (request_id,)).fetchone()) == ("queued", "deferred")
    cross_campaign_rows = db.execute("SELECT count(*) FROM delivery WHERE campaign_id=? AND state='sent'", (other_campaign,)).fetchone()[0]
    assert cross_campaign_rows == 1
    assert gmail.send_count == 0
    record_property("cross_campaign_firm_rows", cross_campaign_rows)
    record_property("t1_sends", gmail.send_count)
    record_property("t1_rejections", 0)


def test_queue_due_is_typed_and_idempotent(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "queue.sqlite", now, count=2)
    queued = queue_due_t1(db, now)
    assert len(queued) == 2
    assert queue_due_t1(db, now) == ()
    rows = db.execute("SELECT operation,state FROM exec_request ORDER BY request_id").fetchall()
    assert [tuple(row) for row in rows] == [("gmail_send", "queued")] * 2
    record_property("t1_sends", 0)
    record_property("t1_rejections", 0)
    record_property("duplicate_sends", 0)
    record_property("breaker_trips", 0)
    record_property("race_runs", 0)


def test_reply_between_validation_and_send_stops_before_backend_call(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "reply.sqlite", now)
    delivery_id = db.execute("SELECT delivery_id FROM delivery").fetchone()[0]
    gmail = SendFakeGmail()
    thread_id = _threaded_delivery(db, gmail, delivery_id)
    gmail.queue_inbound(ArrivalPoint.BETWEEN_REFRESH_AND_CAS, thread_id, "Synthetic", {"From": SYNTHETIC["reply_email"]}, "please stop")
    gmail.arrive_during_refresh = True
    _queue(db, now)
    executor = Executor(db)
    attach_t1_send(executor, gmail)
    assert executor.process_one() is True
    assert gmail.send_count == 0
    assert db.execute("SELECT status FROM enrollment").fetchone()[0] == "stopped"
    record_property("t1_sends", gmail.send_count)
    record_property("t1_rejections", 1)
    record_property("duplicate_sends", 0)
    record_property("breaker_trips", 0)
    record_property("race_runs", 0)


def test_post_scan_inbound_fence_stops_before_backend_call(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "post-scan-fence.sqlite", now)
    delivery_id = db.execute("SELECT delivery_id FROM delivery").fetchone()[0]
    gmail = SendFakeGmail()
    thread_id = _threaded_delivery(db, gmail, delivery_id)
    gmail.queue_inbound(ArrivalPoint.AFTER_CAS, thread_id, "Synthetic", {"From": SYNTHETIC["reply_email"]}, "please stop")
    gmail.arrive_before_send = True
    _queue(db, now)
    executor = Executor(db)
    attach_t1_send(executor, gmail)
    assert executor.process_one() is True
    assert gmail.send_count == 0
    assert tuple(db.execute("SELECT state,reason FROM exec_request").fetchone()) == ("rejected", "fence_unavailable")
    inbound_rows = len(gmail.messages_list("in:inbox"))
    assert inbound_rows == 1
    record_property("post_scan_inbound_rows", inbound_rows)
    record_property("t1_sends", gmail.send_count)
    record_property("t1_rejections", 1)


def test_global_warning_after_preflight_stops_send_and_pauses_all(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "global-warning.sqlite", now)
    gmail = SendFakeGmail()
    unrelated = gmail.seed_outbound("Unrelated", SYNTHETIC["unrelated_message_id"])
    gmail.queue_inbound(
        ArrivalPoint.BETWEEN_REFRESH_AND_CAS,
        unrelated.thread_id,
        "Google warning",
        {"From": SYNTHETIC["warning_email"]},
        "automatic notice",
    )
    gmail.arrive_during_refresh = True
    _queue(db, now)
    executor = Executor(db)
    attach_t1_send(executor, gmail)
    assert executor.process_one() is True
    assert gmail.send_count == 0
    assert db.execute("SELECT reason FROM t1_breaker WHERE scope='global' AND cleared_at IS NULL").fetchone()[0] == "google_warning"
    record_property("t1_sends", gmail.send_count)
    record_property("t1_rejections", 1)
    record_property("duplicate_sends", 0)
    record_property("breaker_trips", db.execute("SELECT count(*) FROM t1_breaker WHERE cleared_at IS NULL").fetchone()[0])


def test_google_warning_and_two_campaign_bounces_trip_breakers(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "breakers.sqlite", now, count=2)
    gmail = SendFakeGmail()
    first, second = [row[0] for row in db.execute("SELECT delivery_id FROM delivery ORDER BY delivery_id")]
    first_thread = _threaded_delivery(db, gmail, first)
    gmail.queue_inbound(ArrivalPoint.BETWEEN_REFRESH_AND_CAS, first_thread, "Google warning", {"From": SYNTHETIC["warning_email"]}, "automatic notice")
    gmail.arrive_during_refresh = True
    _queue(db, now)
    executor = Executor(db)
    attach_t1_send(executor, gmail)
    assert executor.process_one() is True
    assert gmail.send_count == 0
    assert db.execute("SELECT reason FROM t1_breaker WHERE scope='global'").fetchone()[0] == "google_warning"
    # Human clearing is explicit; create two synthetic bounce observations to exercise the campaign breaker.
    db.execute("UPDATE t1_breaker SET cleared_at=? WHERE scope='global'", (_iso(now),))
    db.execute("INSERT INTO inbound VALUES(?,?,?,?,?,?,?,?,NULL,NULL)", ("inb-a", "msg-a", "thread-a", "enr-0", _iso(now), "bounce_failed", 1.0, "fixture"))
    db.execute("INSERT INTO inbound VALUES(?,?,?,?,?,?,?,?,NULL,NULL)", ("inb-b", "msg-b", "thread-b", "enr-1", _iso(now), "bounce_failed", 1.0, "fixture"))
    _queue_delivery(db, now, second, "req_0000000000000004")
    # The remaining queued request enters preflight and observes the two campaign-day bounces.
    assert executor.process_one() is True
    assert gmail.send_count == 0
    trips = db.execute("SELECT count(*) FROM t1_breaker WHERE cleared_at IS NULL").fetchone()[0]
    assert trips == 1
    assert db.execute("SELECT reason FROM t1_breaker WHERE scope='campaign'").fetchone()[0] == "bounce_threshold"
    record_property("t1_sends", gmail.send_count)
    record_property("t1_rejections", 2)
    record_property("duplicate_sends", 0)
    record_property("breaker_trips", trips + 1)
    record_property("race_runs", 0)


def test_stagger_is_batch_deterministic_and_respects_firm_cap(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "stagger.sqlite", now, count=2, future=True)
    first = stagger_deliveries(db, "camp_0000000000000001", "c" * 64, now)
    assert len(first) == 2
    assert stagger_deliveries(db, "camp_0000000000000001", "c" * 64, now) == tuple(sorted(first))
    original = dict(db.execute("SELECT delivery_id,scheduled_at FROM delivery"))
    _add_reserved_delivery(db, "req_0000000000000002", "req_0000000000000004", now)
    second = stagger_deliveries(db, "camp_0000000000000001", "d" * 64, now)
    assert len(second) == 1
    assert dict(db.execute("SELECT delivery_id,scheduled_at FROM delivery WHERE delivery_id IN (?,?)", ("req_0000000000000002", "req_0000000000000003"))) == original
    assert second[0].date() > first[0].date()
    scheduled = [datetime.fromisoformat(row[0]).date() for row in db.execute("SELECT scheduled_at FROM delivery")]
    assert max(scheduled.count(day) for day in set(scheduled)) <= 2
    batch_b_occupancy_slots = db.execute("SELECT count(*) FROM t1_delivery_batch WHERE batch_hash=?", ("c" * 64,)).fetchone()[0]
    assert batch_b_occupancy_slots == 2
    record_property("batch_b_occupancy_slots", batch_b_occupancy_slots)
    record_property("t1_sends", 0)
    record_property("t1_rejections", 0)
    record_property("duplicate_sends", 0)
    record_property("breaker_trips", 0)
    record_property("race_runs", 0)


def test_stagger_firm_cap_counts_other_campaigns(tmp_path, record_property) -> None:
    now = NOW
    db = _seed(tmp_path / "cross-campaign-stagger.sqlite", now, count=2, future=True)
    first, second = [row[0] for row in db.execute("SELECT delivery_id FROM delivery ORDER BY delivery_id")]
    other_campaign = "camp_0000000000000002"
    _clone_campaign(db, other_campaign)
    db.execute("UPDATE campaign SET firm_collision_cap=1")
    db.execute("UPDATE delivery SET campaign_id=? WHERE delivery_id=?", (other_campaign, second))
    first_batch = stagger_deliveries(db, "camp_0000000000000001", "a" * 64, now)
    second_batch = stagger_deliveries(db, other_campaign, "b" * 64, now)
    assert len(first_batch) == len(second_batch) == 1
    assert second_batch[0].date() > first_batch[0].date()
    cross_campaign_slots = db.execute(
        "SELECT count(*) FROM t1_delivery_batch WHERE batch_hash IN (?,?)", ("a" * 64, "b" * 64)
    ).fetchone()[0]
    assert cross_campaign_slots == 2
    record_property("cross_campaign_stagger_slots", cross_campaign_slots)
    record_property("t1_sends", 0)
    record_property("t1_rejections", 0)


def test_two_wal_connections_never_exceed_the_firm_day_cap(tmp_path, record_property) -> None:
    now = NOW
    path = tmp_path / "stagger-race.sqlite"
    db = _seed(path, now, count=4, future=True)
    db.close()
    barrier = Barrier(2)
    failures: list[Exception] = []

    def worker(batch_hash: str) -> None:
        connection = open_store(path)
        try:
            barrier.wait(timeout=5)
            stagger_deliveries(connection, "camp_0000000000000001", batch_hash, now)
        except Exception as error:  # pragma: no cover - asserted by the parent thread
            failures.append(error)
        finally:
            connection.close()

    workers = [Thread(target=worker, args=(character * 64,)) for character in ("e", "f")]
    for worker_thread in workers:
        worker_thread.start()
    for worker_thread in workers:
        worker_thread.join(timeout=10)
    assert not failures and all(not worker_thread.is_alive() for worker_thread in workers)
    checked = open_store(path)
    dates = [datetime.fromisoformat(row[0]).date() for row in checked.execute("SELECT scheduled_at FROM delivery")]
    assert max(dates.count(day) for day in set(dates)) <= 2
    record_property("t1_sends", 0)
    record_property("t1_rejections", 0)
    record_property("duplicate_sends", 0)
    record_property("breaker_trips", 0)
    record_property("race_runs", len(workers))
