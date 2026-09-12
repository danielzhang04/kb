import inspect
import sqlite3
from pathlib import Path

import pytest

import scripts.prospecting.executor as executor_module
import scripts.prospecting.store as store_module
from scripts.prospecting.executor import Executor, enumerate_agent_capabilities
from scripts.prospecting.store import (
    ExecRequest, approval_scope_hash, insert_exec_request, open_store,
)


@pytest.fixture(autouse=True)
def isolate_existing_executor_tests_from_editorial_pipeline(monkeypatch) -> None:
    """These unit tests exercise executor behavior, not P16 receipt validity."""
    monkeypatch.setattr(store_module, "_require_revision_ready", lambda *_args: None)


def _queued(connection: sqlite3.Connection, request_id: str = "req_1111111111111111") -> None:
    request = ExecRequest(
        request_id, "prospecting-list-builder", "finder_page",
        {"finder_run_id": "camp_1111111111111111", "lane": "manual"}, "a" * 64, None,
        "2026-09-03T00:00:00Z", "queued", None,
    )
    insert_exec_request(connection, request, "T0")


def test_41_agent_capabilities_have_zero_raw_operations(record_property) -> None:
    capabilities = enumerate_agent_capabilities()
    forbidden = ("gmail.send", "gmail.draft", "vendor.call", "shell", "credential")
    assert capabilities
    assert all(not any(token in capability.lower() for token in forbidden)
               for capability in capabilities)
    assert all(capability.startswith("exec_request:") for capability in capabilities)
    public_surface = {
        name.casefold()
        for name, value in inspect.getmembers(executor_module)
        if not name.startswith("_") and callable(value)
    } | {
        name.casefold()
        for name, value in inspect.getmembers(Executor)
        if not name.startswith("_") and callable(value)
    }
    forbidden_surface = {
        name for name in public_surface
        if any(token in name for token in ("gmail", "vendor", "shell", "credential"))
    }
    assert not forbidden_surface
    agent_payload_attempt = ExecRequest(
        "req_1111111111111111", "prospecting-list-builder", "finder_page",
        {
            "finder_run_id": "camp_1111111111111111", "lane": "manual",
            "adapter": "gmail_send",
        },
        "a" * 64, None, "2026-09-03T00:00:00Z", "queued", None,
    )
    with pytest.raises(ValueError, match="payload keys do not match operation contract"):
        insert_exec_request(open_store(Path(":memory:")), agent_payload_attempt, "T0")
    record_property("raw_agent_capabilities", len(forbidden_surface))


def test_42_empty_executor_loop_returns_false(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "empty.sqlite")
    assert Executor(connection).process_one() is False


def test_43_executor_runs_validate_hooks_act_audit_in_order(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "order.sqlite")
    _queued(connection)
    events: list[str] = []

    class RecordingExecutor(Executor):
        def _validate(self, request: ExecRequest) -> None:
            events.append("validate")
            super()._validate(request)

        def _act(self, request: ExecRequest) -> tuple[str, str]:
            events.append("act")
            return super()._act(request)

        def _audit(self, request: ExecRequest, state: str, reason: str) -> None:
            events.append("audit")
            super()._audit(request, state, reason)

    def hook(request: ExecRequest) -> None:
        assert request.request_id == "req_1111111111111111"
        events.append("hooks")

    assert RecordingExecutor(connection, (hook,)).process_one() is True
    assert events == ["validate", "hooks", "act", "audit"]
    assert connection.execute(
        "SELECT state FROM exec_request WHERE request_id='req_1111111111111111'"
    ).fetchone()[0] == "rejected"
    assert connection.execute(
        "SELECT count(*) FROM audit WHERE entity_id='req_1111111111111111'"
    ).fetchone()[0] == 1


def test_44_no_adapter_rejects_and_audits(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "reject.sqlite")
    _queued(connection)
    assert Executor(connection).process_one() is True
    request = connection.execute(
        "SELECT state,reason FROM exec_request WHERE request_id='req_1111111111111111'"
    ).fetchone()
    assert tuple(request) == ("rejected", "no_adapter")
    audit = connection.execute(
        "SELECT action,entity_type,entity_id,reason FROM audit"
    ).fetchone()
    assert tuple(audit) == ("executor_request", "exec_request", "req_1111111111111111", "no_adapter")


def test_44a_register_adapter_dispatches_and_is_instance_local(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "registered.sqlite")
    _queued(connection)
    called: list[str] = []
    executor = Executor(connection)
    executor.register_adapter(
        "finder_page", lambda request: (called.append(request.request_id), ("succeeded", "fetched"))[1]
    )
    assert executor.process_one() is True
    assert called == ["req_1111111111111111"]
    assert tuple(connection.execute(
        "SELECT state,reason FROM exec_request WHERE request_id='req_1111111111111111'"
    ).fetchone()) == ("succeeded", "fetched")


def test_44b_register_adapter_rejects_unknown_and_duplicate_operations(tmp_path: Path) -> None:
    executor = Executor(open_store(tmp_path / "registration.sqlite"))
    adapter = lambda _request: ("succeeded", "synthetic")
    with pytest.raises(ValueError, match="unknown executor operation"):
        executor.register_adapter("unknown_operation", adapter)
    executor.register_adapter("finder_page", adapter)
    with pytest.raises(ValueError, match="adapter already registered"):
        executor.register_adapter("finder_page", adapter)
    executor.register_adapter("finder_page", adapter, replace=True)


def test_44bb_registry_locks_after_bootstrap_and_before_processing(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "registry-lock.sqlite")
    executor = Executor(connection)
    adapter = lambda _request: ("succeeded", "synthetic")
    executor.register_adapter("finder_page", adapter)
    executor.lock_registry()
    with pytest.raises(RuntimeError, match="registry_locked"):
        executor.register_adapter("finder_page", adapter, replace=True)

    processing_executor = Executor(connection)
    assert processing_executor.process_one() is False
    with pytest.raises(RuntimeError, match="registry_locked"):
        processing_executor.register_adapter("finder_page", adapter)


def test_44c_adapter_exception_rejects_and_rolls_back(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "adapter-error.sqlite")
    _queued(connection)

    def raises_after_write(_request: ExecRequest) -> tuple[str, str]:
        connection.execute("CREATE TABLE adapter_write(value TEXT)")
        raise RuntimeError("synthetic adapter failure")

    executor = Executor(connection)
    executor.register_adapter("finder_page", raises_after_write)
    assert executor.process_one() is True
    assert tuple(connection.execute(
        "SELECT state,reason FROM exec_request WHERE request_id='req_1111111111111111'"
    ).fetchone()) == ("rejected", "adapter_error")
    assert connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='adapter_write'"
    ).fetchone() is None


def _seed_send_graph(connection: sqlite3.Connection) -> None:
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender", "Synthetic", None, "focus", "background", "proof", "[]"),
    )
    connection.execute(
        "INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("campaign", "networking", "sender", "{}", "informational_call", 15, "direct",
         "networking-v1", "[]", "09:00-17:00", "America/New_York", 25, 6, 2, "T1",
         "mailbox", "{}", 0, "approved", "a" * 64),
    )
    connection.execute(
        "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
        ("company", "Synthetic", "manual", "synthetic"),
    )
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ("person", "Casey", "Casey Synthetic", "manual", "casey"),
    )
    connection.execute(
        "INSERT INTO contact_point(contact_id,person_id,employer_company_id,email,provider,adapter_version,state,confidence) VALUES(?,?,?,?,?,?,?,?)",
        ("contact", "person", "company", "casey" + chr(64) + "example.test", "manual", "v1", "valid", 1.0),
    )
    connection.execute(
        "INSERT INTO revision VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("revision", "person", "campaign", 0, "Synthetic", "Synthetic", "why_them",
         "bespoke", None, "Synthetic", "[]", "[]", "[]", "template", 1, "p1", "m1",
         "{}", "b" * 64),
    )
    connection.execute(
        "INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?)",
        ("enrollment", "campaign", "person", 0, None, "approved", None, None, None),
    )
    connection.execute(
        "INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("req_aaaaaaaaaaaaaaaa", "campaign", "enrollment", 0, "b" * 64, "contact",
         "mailbox", "1" * 64, None, None, "message", None, None, None, "reserved"),
    )
    fields = {
        "assertion_ref": "assertion", "campaign_id": "campaign", "policy_hash": "a" * 64,
        "content_kind": "revision", "revision_hash": "b" * 64, "contact_id": "contact",
        "mailbox_id": "mailbox", "approver": "human:reviewer",
        "approved_at": "2026-01-01T00:00:00Z", "expires_at": "2999-01-01T00:00:00Z",
        "tier": "T1", "send_window": '{"start":"2026-01-01T00:00:00Z","end":"2999-01-01T00:00:00Z"}',
        "nonce": "nonce", "permitted_action": "send_revision",
    }
    connection.execute(
        "INSERT INTO approval VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("apr_aaaaaaaaaaaaaaaa", *(fields[key] for key in (
            "assertion_ref", "campaign_id", "policy_hash", "content_kind", "revision_hash",
            "contact_id", "mailbox_id", "approver", "approved_at", "expires_at", "tier",
            "send_window", "nonce", "permitted_action",
        )), None, approval_scope_hash(fields), None),
    )


def _send_request(request_id: str) -> ExecRequest:
    return ExecRequest(
        request_id, "prospecting-campaigner", "gmail_send",
        {"delivery_id": "req_aaaaaaaaaaaaaaaa"}, "a" * 64, "apr_aaaaaaaaaaaaaaaa",
        "2026-09-03T00:00:00Z",
    )


class _FixedNowExecutor(Executor):
    def _trusted_now(self) -> str:
        return "2026-09-03T12:00:00Z"


def test_45_send_consumes_at_adapter_only_and_replay_is_rejected(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "send-lifecycle.sqlite")
    _seed_send_graph(connection)
    first = _send_request("req_1111111111111111")
    replay = _send_request("req_2222222222222222")
    insert_exec_request(connection, first, "T1", "2026-09-03T12:00:00Z")
    insert_exec_request(connection, replay, "T1", "2026-09-03T12:00:00Z")
    assert connection.execute(
        "SELECT consumed_at FROM approval WHERE approval_id=?", (first.approval_id,)
    ).fetchone()[0] is None
    events: list[str] = []

    def hook(request: ExecRequest) -> None:
        events.append("hook")

    def adapter(request: ExecRequest) -> tuple[str, str]:
        consumed = connection.execute(
            "SELECT consumed_at FROM approval WHERE approval_id=?", (request.approval_id,)
        ).fetchone()[0]
        assert consumed == "2026-09-03T12:00:00Z"
        events.append("adapter_after_consume")
        return "succeeded", "sent"

    executor = _FixedNowExecutor(connection, (hook,), adapter)
    assert executor.process_one()
    assert events == ["hook", "adapter_after_consume"]
    assert executor.process_one()
    assert events == ["hook", "adapter_after_consume"]
    assert connection.execute(
        "SELECT state FROM exec_request WHERE request_id=?", (replay.request_id,)
    ).fetchone()[0] == "rejected"


def test_46_rejected_hook_does_not_consume_send_approval(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "send-hook.sqlite")
    _seed_send_graph(connection)
    request = _send_request("req_1111111111111111")
    insert_exec_request(connection, request, "T1", "2026-09-03T12:00:00Z")

    def reject(_request: ExecRequest) -> None:
        raise ValueError("synthetic hook rejection")

    called: list[str] = []
    executor = _FixedNowExecutor(
        connection, (reject,), lambda item: (called.append(item.request_id), ("succeeded", "sent"))[1]
    )
    assert executor.process_one()
    assert called == []
    assert connection.execute(
        "SELECT consumed_at FROM approval WHERE approval_id=?", (request.approval_id,)
    ).fetchone()[0] is None
    connection.execute(
        "UPDATE exec_request SET state='queued', reason=NULL WHERE request_id=?",
        (request.request_id,),
    )
    executor = _FixedNowExecutor(connection, (), lambda _item: ("rejected", "synthetic rejection"))
    assert executor.process_one()
    assert connection.execute(
        "SELECT consumed_at FROM approval WHERE approval_id=?", (request.approval_id,)
    ).fetchone()[0] is None
