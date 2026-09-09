from datetime import timedelta
from io import BytesIO
import hashlib
import json
from pathlib import Path

import pytest

import scripts.prospecting.control_desktop as control_module
from scripts.prospecting.control_desktop import (
    ControlError, DesktopControl, SshPullTransport, create_disabled_grant,
    read_grant, read_receipt, run_once, set_grant_state,
)
from scripts.prospecting.control_protocol import ControlRequest, encode_request, encode_result
from scripts.prospecting.control_spool import ControlSpool
from scripts.prospecting.tests.p6_support import migrated_t1_store

CONTROL_REF = "ctl_" + "1" * 32
OWNER = "desk_" + "2" * 32
LEASE = "lease_" + "3" * 32


def request(now, *, request_digit: str = "4", operation: str = "queue_due", control_ref: str = CONTROL_REF):
    start = now.isoformat().replace("+00:00", "Z")
    end = (now + timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    return ControlRequest(1, "ctlreq_" + request_digit * 32, control_ref, operation, start, end)


def active_control(tmp_path, *, operation: str = "queue_due"):
    fixture = migrated_t1_store(tmp_path / "store.sqlite", tier="T0")
    create_disabled_grant(
        fixture.connection, control_ref=CONTROL_REF,
        campaign_id="camp_0000000000000001", operation=operation,
        expires_at=fixture.now + timedelta(hours=2), now=fixture.now,
    )
    assert fixture.connection.execute(
        "SELECT state FROM remote_control_grant WHERE control_ref=?", (CONTROL_REF,)
    ).fetchone()[0] == "disabled"
    set_grant_state(fixture.connection, CONTROL_REF, "active")
    return fixture, DesktopControl(fixture.connection, OWNER, now=lambda: fixture.now)


def test_status_is_campaign_scoped_and_counts_only(tmp_path) -> None:
    fixture, control = active_control(tmp_path, operation="status")
    before = fixture.connection.total_changes
    result = control.execute(encode_request(request(fixture.now, operation="status")))
    assert result.state == "succeeded"
    assert result.code == "status"
    assert result.counts == {"due": 2, "paused": 0, "replied": 0}
    assert fixture.connection.total_changes == before + 2  # claimed then terminal receipt
    assert fixture.connection.execute("SELECT count(*) FROM exec_request").fetchone()[0] == 0
    assert read_grant(fixture.connection, CONTROL_REF).state == "active"
    receipt = read_receipt(fixture.connection, request(fixture.now, operation="status").request_id)
    assert (receipt.state, receipt.code, receipt.counts) == (
        "succeeded", "status", {"due": 2, "paused": 0, "replied": 0},
    )


def test_queue_due_uses_real_t0_release_and_never_queues_send(tmp_path) -> None:
    fixture, control = active_control(tmp_path)
    item = request(fixture.now)
    first = control.execute(encode_request(item))
    second = control.execute(encode_request(item))
    assert first == second
    assert first.counts == {"considered": 2, "queued": 2, "already_queued": 0, "reserved": 2}
    rows = fixture.connection.execute(
        "SELECT operation,payload,policy_hash,state FROM exec_request ORDER BY request_id"
    ).fetchall()
    assert len(rows) == 2
    assert {row[0] for row in rows} == {"gmail_draft"}
    assert {row[3] for row in rows} == {"queued"}
    assert all(set(json.loads(row[1])) == {"revision_id", "contact_id", "mailbox_id"} for row in rows)
    assert fixture.connection.execute(
        "SELECT count(*) FROM exec_request WHERE operation='gmail_send'"
    ).fetchone()[0] == 0


def test_queue_reconnect_reconciles_exact_release_keys_after_crash(tmp_path, monkeypatch) -> None:
    fixture, control = active_control(tmp_path)
    item = request(fixture.now)
    original = control_module.encode_result
    monkeypatch.setattr(control_module, "encode_result", lambda _result: (_ for _ in ()).throw(RuntimeError("synthetic")))
    with pytest.raises(RuntimeError, match="^synthetic$"):
        control.execute(encode_request(item))
    assert fixture.connection.execute("SELECT count(*) FROM exec_request").fetchone()[0] == 0
    assert fixture.connection.execute(
        "SELECT state FROM remote_control_receipt WHERE request_id=?", (item.request_id,)
    ).fetchone() is None

    monkeypatch.setattr(control_module, "encode_result", original)
    recovered = control.execute(encode_request(item))
    assert recovered.state == "succeeded"
    assert recovered.counts == {"considered": 2, "queued": 2, "already_queued": 0, "reserved": 2}
    assert fixture.connection.execute("SELECT count(*) FROM exec_request").fetchone()[0] == 2


def test_late_queue_conflict_rolls_back_earlier_release_and_receipt(tmp_path) -> None:
    fixture, control = active_control(tmp_path)
    row = fixture.connection.execute(
        "SELECT r.revision_id,d.contact_id,d.mailbox_id "
        "FROM delivery d JOIN revision r ON r.hash=d.revision_hash "
        "WHERE d.delivery_id=?", (fixture.followup_delivery_id,),
    ).fetchone()
    payload = {"revision_id": row[0], "contact_id": row[1], "mailbox_id": row[2]}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    policy_hash = "a" * 64
    digest = hashlib.sha256(f"gmail_draft:{policy_hash}:{encoded}".encode()).hexdigest()
    fixture.connection.execute(
        "INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,approval_id,"
        "created_at,claimed_at,state,reason) VALUES(?,?,?,?,?,NULL,?,NULL,'queued',NULL)",
        (f"req_{digest[:16]}", "fixture", "gmail_draft", "{}", policy_hash, fixture.now.isoformat()),
    )
    with pytest.raises(ControlError, match="^queue_conflict$"):
        control.execute(encode_request(request(fixture.now)))
    assert fixture.connection.execute("SELECT count(*) FROM exec_request").fetchone()[0] == 1
    assert fixture.connection.execute("SELECT count(*) FROM remote_control_receipt").fetchone()[0] == 0


def test_control_rejects_ambient_caller_transaction(tmp_path) -> None:
    fixture, control = active_control(tmp_path, operation="status")
    fixture.connection.execute("BEGIN")
    try:
        with pytest.raises(ControlError, match="^caller_transaction_active$"):
            control.execute(encode_request(request(fixture.now, operation="status")))
    finally:
        fixture.connection.rollback()


def test_request_id_cannot_be_rebound(tmp_path) -> None:
    fixture, control = active_control(tmp_path, operation="status")
    first = request(fixture.now, operation="status")
    control.execute(encode_request(first))
    changed = request(fixture.now, operation="status", control_ref="ctl_" + "9" * 32)
    with pytest.raises(ControlError, match="^request_conflict$"):
        control.execute(encode_request(changed))


def test_missing_grant_failure_replays_after_request_expiry(tmp_path) -> None:
    fixture = migrated_t1_store(tmp_path / "store.sqlite", tier="T0")
    item = request(fixture.now, operation="status")
    control = DesktopControl(fixture.connection, OWNER, now=lambda: fixture.now)
    first = control.execute(encode_request(item))
    assert (first.state, first.code) == ("failed", "grant_missing")
    row = fixture.connection.execute(
        "SELECT control_ref,resolved_grant_ref,state FROM remote_control_receipt WHERE request_id=?",
        (item.request_id,),
    ).fetchone()
    assert tuple(row) == (item.control_ref, None, "failed")
    control.now = lambda: fixture.now + timedelta(hours=2)
    assert control.execute(encode_request(item)) == first


@pytest.mark.parametrize("change,code", [
    ("paused", "grant_inactive"),
    ("revoked", "grant_inactive"),
])
def test_inactive_grant_returns_fixed_terminal_failure(tmp_path, change: str, code: str) -> None:
    fixture, control = active_control(tmp_path, operation="status")
    set_grant_state(fixture.connection, CONTROL_REF, change)
    result = control.execute(encode_request(request(fixture.now, operation="status")))
    assert (result.state, result.code, result.counts) == ("failed", code, {})


def test_campaign_policy_drift_fails_before_queue_mutation(tmp_path) -> None:
    fixture, control = active_control(tmp_path)
    fixture.connection.execute(
        "UPDATE campaign SET policy_hash=? WHERE campaign_id=?",
        ("f" * 64, "camp_0000000000000001"),
    )
    result = control.execute(encode_request(request(fixture.now)))
    assert result.code == "grant_binding_mismatch"
    assert fixture.connection.execute("SELECT count(*) FROM exec_request").fetchone()[0] == 0


def test_expired_grant_fails_before_queue_mutation(tmp_path) -> None:
    fixture, control = active_control(tmp_path)
    control.now = lambda: fixture.now + timedelta(hours=3)
    later = request(fixture.now + timedelta(hours=3), request_digit="8")
    result = control.execute(encode_request(later))
    assert result.code == "grant_expired"
    assert fixture.connection.execute("SELECT count(*) FROM exec_request").fetchone()[0] == 0


def test_grants_are_disabled_and_rebinding_fields_are_immutable(tmp_path) -> None:
    fixture = migrated_t1_store(tmp_path / "store.sqlite", tier="T0")
    create_disabled_grant(
        fixture.connection, control_ref=CONTROL_REF, campaign_id="camp_0000000000000001",
        operation="status", expires_at=fixture.now + timedelta(hours=1), now=fixture.now,
    )
    with pytest.raises(Exception, match="remote_control_grant_binding_immutable"):
        fixture.connection.execute(
            "UPDATE remote_control_grant SET policy_hash=? WHERE control_ref=?", ("f" * 64, CONTROL_REF)
        )
    set_grant_state(fixture.connection, CONTROL_REF, "revoked")
    with pytest.raises(Exception, match="remote_control_grant_revoked"):
        fixture.connection.execute(
            "UPDATE remote_control_grant SET state='active' WHERE control_ref=?", (CONTROL_REF,)
        )


def test_terminal_receipt_is_immutable_in_sqlite(tmp_path) -> None:
    fixture, control = active_control(tmp_path, operation="status")
    item = request(fixture.now, operation="status")
    control.execute(encode_request(item))
    with pytest.raises(Exception, match="remote_control_receipt_terminal"):
        fixture.connection.execute(
            "UPDATE remote_control_receipt SET state='failed' WHERE request_id=?", (item.request_id,)
        )


def test_ssh_pull_uses_fixed_argv_no_shell_and_bounded_result(tmp_path) -> None:
    known_hosts = tmp_path / "known_hosts"
    known_hosts.write_text("fixture", encoding="utf-8")
    calls = []
    item = request(control_module.datetime(2099, 1, 1, 12, tzinfo=control_module.timezone.utc), operation="status")

    class Process:
        def __init__(self, stdout):
            self.stdout, self.stderr, self.stdin = BytesIO(stdout), BytesIO(), None
            self.returncode = 0
        def wait(self, timeout): return self.returncode
        def kill(self): self.returncode = -1

    def launch(argv, **kwargs):
        calls.append((argv, kwargs))
        return Process(encode_request(item))

    transport = SshPullTransport(
        "vm-control", "kb", LEASE, OWNER, known_hosts, frozenset({"vm-control"}),
        f"/run/user/1000/{LEASE}/control_spool.py", launch=launch,
    )
    assert transport.claim_next(
        request_id=item.request_id,
        control_ref=item.control_ref,
        operation=item.operation,
    ) == encode_request(item)
    argv, kwargs = calls[0]
    assert argv[-14:] == [
        "python3", "-B", f"/run/user/1000/{LEASE}/control_spool.py", "claim-next",
        "--lease", LEASE, "--owner", OWNER,
        "--request-id", item.request_id, "--control-ref", item.control_ref,
        "--operation", item.operation,
    ]
    assert kwargs["shell"] is False


def test_ssh_pull_bounds_combined_stdout_and_stderr(tmp_path) -> None:
    known_hosts = tmp_path / "known_hosts"
    known_hosts.write_text("fixture", encoding="utf-8")

    class Process:
        def __init__(self):
            self.stdout, self.stderr, self.stdin = BytesIO(b"x" * 4097), BytesIO(), None
            self.returncode = 0
        def wait(self, timeout): return self.returncode
        def kill(self): self.returncode = -1

    transport = SshPullTransport(
        "vm-control", "kb", LEASE, OWNER, known_hosts, frozenset({"vm-control"}),
        f"/run/user/1000/{LEASE}/control_spool.py", launch=lambda *_args, **_kwargs: Process(),
    )
    with pytest.raises(ControlError, match="^transport_failed$"):
        transport.claim_next()


def test_run_once_posts_exact_correlated_result(tmp_path) -> None:
    fixture, control = active_control(tmp_path, operation="status")
    raw = encode_request(request(fixture.now, operation="status"))

    class Transport:
        completed = None
        selectors = []
        def claim_next(self, **selector):
            self.selectors.append(selector)
            return raw
        def complete(self, result): self.completed = result

    transport = Transport()
    item = request(fixture.now, operation="status")
    assert run_once(
        control,
        transport,
        request_id=item.request_id,
        control_ref=item.control_ref,
        operation=item.operation,
    ) is True
    assert transport.completed.request_hash == request(fixture.now, operation="status").digest
    assert transport.selectors == [{
        "request_id": item.request_id,
        "control_ref": item.control_ref,
        "operation": item.operation,
    }]


def test_lost_remote_ack_reuses_local_terminal_receipt(tmp_path) -> None:
    fixture, control = active_control(tmp_path, operation="status")
    raw = encode_request(request(fixture.now, operation="status"))

    class Transport:
        attempts = 0
        completed = []
        def claim_next(self): return raw
        def complete(self, result):
            self.attempts += 1
            if self.attempts == 1:
                raise ControlError("transport_failed")
            self.completed.append(result)

    transport = Transport()
    with pytest.raises(ControlError, match="^transport_failed$"):
        run_once(control, transport)
    assert run_once(control, transport) is True
    assert len(transport.completed) == 1
    assert fixture.connection.execute("SELECT count(*) FROM remote_control_receipt").fetchone()[0] == 1


def test_lost_ack_after_request_expiry_reconciles_without_new_effect(tmp_path) -> None:
    fixture, control = active_control(tmp_path, operation="status")
    raw = encode_request(request(fixture.now, operation="status"))
    spool = ControlSpool(tmp_path / "runtime", LEASE)
    spool.initialize(fixture.now + timedelta(hours=2), now=fixture.now)
    spool.enqueue(raw)
    claimed_at = fixture.now + timedelta(minutes=59, seconds=50)
    assert spool.claim_next(OWNER, now=claimed_at, lease_seconds=300) == raw
    control.now = lambda: claimed_at
    original = control.execute(raw)

    retry_at = fixture.now + timedelta(hours=1, minutes=5)
    second_owner = "desk_" + "7" * 32
    assert spool.claim_next(second_owner, now=retry_at) == raw
    control.now = lambda: retry_at
    replay = control.execute(raw)
    assert replay == original
    spool.complete(second_owner, encode_result(replay), now=retry_at)
    assert spool.result(replay.request_id) == encode_result(original)
