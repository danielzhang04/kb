"""Campaigner-owned assembly for the Gmail executor adapter."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone

from .fake_gmail import FakeGmail
from ..executor import Executor
from ..executor_campaigner import ExecutorDraftContext, execute_linearized_draft
from ..gmail_adapter import GmailAdapter, McpRestBackend


LABEL_NAMES = {
    "sent": "Outreach/Sent",
    "followup_due": "Outreach/Follow-up due",
    "replied": "Outreach/Replied",
    "ooo": "Outreach/OOO",
    "bounced": "Outreach/Bounced",
    "closed_no_reply": "Outreach/Closed-no-reply",
    "closed_declined": "Outreach/Closed-declined",
}


def attach_gmail(executor: Executor, backend: FakeGmail | McpRestBackend) -> GmailAdapter:
    """Attach one T0 Gmail adapter to the non-send campaigner operations."""
    gmail = GmailAdapter(backend)
    def label_adapter(request):
        label = LABEL_NAMES.get(request.payload["label_code"])
        if label is None:
            return "rejected", "unsupported_label_code"
        gmail.labels_modify(request.payload["gmail_thread_id"], (label,), ())
        return "succeeded", "labeled"
    executor.register_adapter("gmail_label", label_adapter)
    executor.register_adapter("gmail_thread_refresh", gmail)
    return gmail


def attach_campaigner(
    executor: Executor,
    backend: FakeGmail | McpRestBackend,
    *,
    persist_inbound=lambda _thread: None,
    inject=lambda _point: None,
    now: str = "2026-09-03T12:00:00+00:00",
    clock: Callable[[], str] | None = None,
) -> GmailAdapter:
    """Attach the campaigner's linearized draft handler inside Executor._act."""
    gmail = attach_gmail(executor, backend)

    def draft_adapter(request):
        payload = request.payload
        if set(payload) != {"revision_id", "contact_id", "mailbox_id"}:
            return "rejected", "unsupported_draft_payload"
        revision = executor.connection.execute(
            "SELECT hash FROM revision WHERE revision_id=?", (payload["revision_id"],)
        ).fetchone()
        if revision is None:
            return "rejected", "missing_revision"
        deliveries = executor.connection.execute(
            "SELECT delivery_id FROM delivery WHERE revision_hash=? AND contact_id=? "
            "AND mailbox_id=? AND state IN ('reserved','uncertain') "
            "AND scheduled_at<=? "
            "ORDER BY scheduled_at,delivery_id LIMIT 2",
            (revision[0], payload["contact_id"], payload["mailbox_id"], now),
        ).fetchall()
        if len(deliveries) != 1:
            return "rejected", "delivery_not_unique"
        controller_clock = clock or (
            lambda: datetime.now(timezone.utc).isoformat()
        )
        result = execute_linearized_draft(ExecutorDraftContext(
            executor.connection, gmail, persist_inbound, inject, now,
            request.policy_hash, controller_clock,
        ), deliveries[0][0])
        if result.state in {"drafted", "reconciled"}:
            return "succeeded", result.state
        if result.state == "timezone_unavailable":
            return "rejected", "timezone_unavailable"
        return "rejected", result.state

    executor.register_adapter("gmail_draft", draft_adapter, replace=True)
    return gmail
