from __future__ import annotations

import ast
import base64
import sqlite3
from email import message_from_bytes
from pathlib import Path

import pytest

from scripts.prospecting.campaigner.fake_gmail import FakeGmail
from scripts.prospecting.campaigner.requests import CampaignerRequests
from scripts.prospecting.campaigner.wiring import attach_campaigner, attach_gmail
from scripts.prospecting.executor import Executor
from scripts.prospecting.tests.test_executor_surface import (
    _FixedNowExecutor,
    _seed_send_graph,
    _send_request,
)
from scripts.prospecting.gmail_adapter import (
    GMAIL_ADAPTER_CAPABILITIES,
    MAX_COST,
    GmailAdapter,
    McpRestBackend,
    deterministic_message_id,
)
from scripts.prospecting.store import ExecRequest, insert_exec_request, open_store
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_gmail_adapter")


def test_adapter_surface_is_exact_and_free() -> None:
    assert GMAIL_ADAPTER_CAPABILITIES == (
        "draft_create_in_thread",
        "labels_modify",
        "thread_refresh",
        "history_list",
    )
    assert MAX_COST == 0
    assert not {"send", "delete", "credentials", "command"} & set(
        GMAIL_ADAPTER_CAPABILITIES
    )
    public = {name for name in vars(GmailAdapter) if not name.startswith('_')}
    assert public == set(GMAIL_ADAPTER_CAPABILITIES)


def test_follow_up_headers_and_uncertain_reconciliation(monkeypatch) -> None:
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    fake = FakeGmail()
    root = fake.seed_outbound("Coffee", SYNTHETIC["root_message_id"])
    adapter = GmailAdapter(fake)
    logical_key = "a" * 64
    expected = deterministic_message_id(logical_key)
    draft = adapter.draft_create_in_thread(
        logical_key=logical_key, contact_id='contact-1',
        thread_id=root.thread_id,
        subject="Coffee",
        body="Synthetic follow-up",
        parent_message_id=SYNTHETIC["root_message_id"],
        references=(SYNTHETIC["root_message_id"],),
    )
    assert draft.rfc_message_id == expected
    assert draft.headers["In-Reply-To"] == SYNTHETIC["root_message_id"]
    assert draft.headers["References"] == SYNTHETIC["root_message_id"]
    repeated = adapter.draft_create_in_thread(
        logical_key=logical_key, contact_id='contact-1',
        thread_id=root.thread_id, subject="Coffee", body="Synthetic follow-up",
        parent_message_id=SYNTHETIC["root_message_id"], references=(SYNTHETIC["root_message_id"],),
    )
    assert repeated == draft


def test_labels_refresh_and_history_are_delegated(monkeypatch) -> None:
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    fake = FakeGmail()
    root = fake.seed_outbound("Coffee", SYNTHETIC["root_message_id"])
    adapter = GmailAdapter(fake)
    adapter.labels_modify(root.thread_id, ("Outreach/Sent",), ())
    assert adapter.thread_refresh(root.thread_id).labels == {"Outreach/Sent"}
    assert adapter.history_list("0")


def test_campaigner_tree_cannot_import_gmail_adapter() -> None:
    root = Path("scripts/prospecting/campaigner")
    offenders: list[str] = []
    for path in sorted(root.rglob("*.py")):
        if path == root / "wiring.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module and node.module.endswith("gmail_adapter"):
                offenders.append(str(path))
            if isinstance(node, ast.Import) and any(
                alias.name.endswith("gmail_adapter") for alias in node.names
            ):
                offenders.append(str(path))
    assert offenders == []


def test_campaigner_request_uses_p1_repository(monkeypatch) -> None:
    calls: list[tuple[object, str]] = []
    monkeypatch.setattr(
        "scripts.prospecting.campaigner.requests.store.insert_exec_request",
        lambda connection, request, campaign_tier: calls.append((request, campaign_tier)),
    )
    client = CampaignerRequests(sqlite3.connect(":memory:"), "p" * 64)
    request_id = client.enqueue(
        operation="gmail_draft",
        action="draft_create_in_thread",
        payload={"delivery_id": "00000000-0000-4000-8000-000000000002"},
    )
    assert request_id and len(calls) == 1 and calls[0][1] == "T0"
    assert calls[0][0].payload["action"] == "draft_create_in_thread"


def test_live_thread_shape_parses_every_message() -> None:
    shaped = {
        "threadId": "thread-1",
        "subject": "Synthetic",
        "labels": ["Outreach/Sent"],
        "messages": [{
            "messageId": "message-1", "threadId": "thread-1",
            "rfcMessageId": SYNTHETIC["root_message_id"], "subject": "Synthetic",
            "direction": "outbound", "draft": False,
            "headers": {"Message-ID": SYNTHETIC["root_message_id"], "Subject": "Synthetic", "References": ""},
            "historyId": "1",
        }, {
            "messageId": "message-2", "threadId": "thread-1",
            "rfcMessageId": SYNTHETIC["reply_message_id"], "subject": "Synthetic",
            "direction": "inbound", "draft": False,
            "headers": {"Message-ID": SYNTHETIC["reply_message_id"], "Subject": "Synthetic", "In-Reply-To": SYNTHETIC["root_message_id"]},
            "historyId": "2",
        }],
    }
    backend = McpRestBackend(lambda name, payload: shaped, lambda payload: {}, lambda start: (), lambda contact: SYNTHETIC["contact_email"])
    thread = backend.thread_get("thread-1")
    assert [message.rfc_message_id for message in thread.messages] == [
        SYNTHETIC["root_message_id"], SYNTHETIC["reply_message_id"],
    ]


def test_live_thread_shape_rejects_incomplete_messages() -> None:
    backend = McpRestBackend(lambda name, payload: {"threadId": "thread-1", "subject": "Synthetic", "messages": [{}]}, lambda payload: {}, lambda start: (), lambda contact: SYNTHETIC["contact_email"])
    with pytest.raises(RuntimeError, match="gmail_result_shape"):
        backend.thread_get("thread-1")
    malformed_search = McpRestBackend(
        lambda _name, _payload: [None], lambda _payload: {}, lambda _start: (),
        lambda _contact: SYNTHETIC["contact_email"],
    )
    with pytest.raises(RuntimeError, match="gmail_result_shape"):
        malformed_search.messages_list("rfc822msgid:" + SYNTHETIC["missing_message_id"])


def test_mcp_rest_mapping_validates_shapes_and_raw_mime() -> None:
    calls: list[tuple[str, object]] = []
    shaped_message = {
        "messageId": "message-1", "threadId": "thread-1",
        "rfcMessageId": SYNTHETIC["root_message_id"], "subject": "Synthetic",
        "direction": "outbound", "draft": False,
        "headers": {"Message-ID": SYNTHETIC["root_message_id"], "Subject": "Synthetic"},
        "historyId": "1",
    }

    def call_tool(name: str, payload: object) -> object:
        calls.append((name, payload))
        if name == "get_thread":
            return {"threadId": "thread-1", "subject": "Synthetic", "messages": [shaped_message]}
        if name == "search_emails":
            return [shaped_message]
        assert name == "modify_thread"
        return {}

    drafts: list[object] = []
    history_calls: list[str] = []
    backend = McpRestBackend(
        call_tool,
        lambda payload: (drafts.append(payload), {"messageId": "draft-1", "threadId": "thread-1"})[1],
        lambda start: (history_calls.append(start), ({"history_id": "2"},))[1],
        lambda _contact: SYNTHETIC["contact_email"],
    )
    backend.draft_new("cp_0000000000000001", "Synthetic", "Body", SYNTHETIC["draft_message_id"])
    raw = drafts[0]["message"]["raw"]
    message = message_from_bytes(base64.urlsafe_b64decode(raw.encode("ascii")))
    assert message["To"] == SYNTHETIC["contact_email"]
    assert message["Message-ID"] == SYNTHETIC["draft_message_id"]
    backend.modify_labels("thread-1", ("sent",), ("INBOX",))
    assert backend.thread_get("thread-1").messages[0].message_id == "message-1"
    assert backend.messages_list("rfc822msgid:" + SYNTHETIC["root_message_id"])[0].message_id == "message-1"
    assert backend.history_list("1") == ({"history_id": "2"},)
    assert calls == [
        ("modify_thread", {"threadId": "thread-1", "addLabelIds": ["sent"], "removeLabelIds": ["INBOX"]}),
        ("get_thread", {"threadId": "thread-1"}),
        ("search_emails", {"query": "rfc822msgid:" + SYNTHETIC["root_message_id"]}),
    ]
    assert history_calls == ["1"]


def test_attached_gmail_adapter_processes_registered_t0_operations(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    connection = open_store(tmp_path / "gmail-executor.sqlite")
    fake = FakeGmail()
    root = fake.seed_outbound("Synthetic", SYNTHETIC["root_message_id"])
    executor = Executor(connection)
    gmail = attach_gmail(executor, fake)
    assert set(executor._adapters) == {"gmail_label", "gmail_thread_refresh"}
    assert executor._adapters["gmail_thread_refresh"] is gmail
    assert "gmail_draft" not in executor._adapters
    linearized = Executor(connection)
    attach_campaigner(linearized, fake)
    assert "gmail_draft" in linearized._adapters
    assert "gmail_send" not in executor._adapters
    requests = (
        ExecRequest(
            "req_0000000000000003", "prospecting-campaigner", "gmail_label",
            {"gmail_thread_id": root.thread_id, "label_code": "sent"},
            "a" * 64, None, "2026-09-03T00:00:00Z",
        ),
        ExecRequest(
            "req_0000000000000004", "prospecting-campaigner", "gmail_thread_refresh",
            {"gmail_thread_id": root.thread_id}, "a" * 64, None, "2026-09-03T00:00:00Z",
        ),
    )
    for request in requests:
        insert_exec_request(connection, request, "T0")
    assert [executor.process_one() for _ in requests] == [True, True]
    assert [tuple(row) for row in connection.execute(
        "SELECT state,reason FROM exec_request ORDER BY request_id"
    )] == [("succeeded", "labeled"), ("succeeded", "refreshed")]
    assert fake.thread_get(root.thread_id).labels == {"Outreach/Sent"}


def test_attached_gmail_adapter_leaves_gmail_send_unregistered(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    connection = open_store(tmp_path / "gmail-send-unregistered.sqlite")
    _seed_send_graph(connection)
    request = _send_request("req_0000000000000005")
    insert_exec_request(connection, request, "T1", "2026-09-03T12:00:00Z")
    executor = _FixedNowExecutor(connection)
    attach_gmail(executor, FakeGmail())
    assert executor.process_one() is True
    assert tuple(connection.execute(
        "SELECT state,reason FROM exec_request WHERE request_id=?", (request.request_id,)
    ).fetchone()) == ("rejected", "no_adapter")
