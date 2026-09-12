"""Narrow executor-owned Gmail adapter; never exposed to an agent."""

from __future__ import annotations

import base64
import hashlib
import os
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Callable, Mapping

from scripts.prospecting.campaigner.fake_gmail import FakeGmail, FakeMessage, FakeThread
from scripts.prospecting.store import ExecRequest


MAX_COST = 0
GMAIL_ADAPTER_CAPABILITIES = (
    "draft_create_in_thread",
    "labels_modify",
    "thread_refresh",
    "history_list",
)


def deterministic_message_id(logical_key: str) -> str:
    if len(logical_key) != 64:
        raise ValueError("invalid_logical_key")
    digest = hashlib.sha256(f"prospecting:{logical_key}".encode("ascii")).hexdigest()
    return f"<{digest}@prospecting.local>"


def build_raw_mime(to_address: str, subject: str, body: str,
                   headers: Mapping[str, str]) -> str:
    message = EmailMessage()
    message['To'] = to_address
    message['Subject'] = subject
    for name, value in headers.items():
        if name.lower() != 'subject':
            message[name] = value
    message.set_content(body)
    return base64.urlsafe_b64encode(message.as_bytes()).decode('ascii')


@dataclass(frozen=True)
class McpRestBackend:
    """Translation layer owned by the executor process."""

    call_tool: Callable[[str, Mapping[str, object]], object]
    rest_draft_create: Callable[[Mapping[str, object]], Mapping[str, object]]
    rest_history_list: Callable[[str], tuple[dict[str, str], ...]]
    resolve_contact: Callable[[str], str]

    def draft_new(self, contact_id: str, subject: str, body: str,
                  rfc_message_id: str) -> FakeMessage:
        raw = build_raw_mime(
            self.resolve_contact(contact_id), subject, body,
            {"Message-ID": rfc_message_id},
        )
        result = self.rest_draft_create({"message": {"raw": raw}})
        if not isinstance(result, Mapping):
            raise RuntimeError("gmail_result_shape")
        return FakeMessage(
            str(result["messageId"]), str(result["threadId"]), rfc_message_id,
            subject, "", {"Message-ID": rfc_message_id}, False, True,
            str(result.get("historyId", "0")),
        )

    def draft_in_thread(
        self, contact_id: str, thread_id: str, subject: str, body: str, rfc_message_id: str,
        in_reply_to: str, references: tuple[str, ...],
    ) -> FakeMessage:
        raw = build_raw_mime(
            self.resolve_contact(contact_id), subject, body,
            {"Message-ID": rfc_message_id, "In-Reply-To": in_reply_to,
             "References": " ".join(references)},
        )
        result = self.rest_draft_create(
            {"message": {"raw": raw, "threadId": thread_id}}
        )
        if not isinstance(result, Mapping):
            raise RuntimeError("gmail_result_shape")
        return FakeMessage(
            str(result["messageId"]), str(result["threadId"]), rfc_message_id,
            subject, "", {"Message-ID": rfc_message_id,
                          "In-Reply-To": in_reply_to,
                          "References": " ".join(references)},
            False, True, str(result.get("historyId", "0")),
        )

    def modify_labels(
        self, thread_id: str, add: tuple[str, ...], remove: tuple[str, ...]
    ) -> frozenset[str]:
        self.call_tool("modify_thread", {
            "threadId": thread_id, "addLabelIds": list(add),
            "removeLabelIds": list(remove),
        })
        return frozenset(add)

    def thread_get(self, thread_id: str) -> FakeThread:
        result = self.call_tool("get_thread", {"threadId": thread_id})
        if (
            not isinstance(result, Mapping)
            or not isinstance(result.get("threadId"), str)
            or not isinstance(result.get("subject"), str)
            or not isinstance(result.get("messages"), list)
            or not isinstance(result.get("labels", []), list)
            or not all(isinstance(label, str) for label in result.get("labels", []))
        ):
            raise RuntimeError("gmail_result_shape")
        messages = [_parse_message(item) for item in result["messages"]]
        if not messages:
            raise RuntimeError("gmail_empty_thread")
        return FakeThread(
            str(result["threadId"]), str(result["subject"]), messages,
            set(map(str, result.get("labels", []))),
        )

    def history_list(self, start_history_id: str) -> tuple[dict[str, str], ...]:
        return self.rest_history_list(start_history_id)

    def messages_list(self, query: str) -> tuple[FakeMessage, ...]:
        result = self.call_tool("search_emails", {"query": query})
        if not isinstance(result, list):
            raise RuntimeError("gmail_result_shape")
        return tuple(_parse_message(item) for item in result)


def _parse_message(item: object) -> FakeMessage:
    required = {
        "messageId", "threadId", "rfcMessageId", "subject", "direction", "draft",
        "headers", "historyId",
    }
    if not isinstance(item, Mapping) or not required <= set(item):
        raise RuntimeError("gmail_result_shape")
    text_fields = ("messageId", "threadId", "rfcMessageId", "subject", "historyId")
    headers = item["headers"]
    if (
        any(not isinstance(item[field], str) for field in text_fields)
        or item["direction"] not in {"inbound", "outbound"}
        or not isinstance(item["draft"], bool)
        or not isinstance(headers, Mapping)
        or not {"Message-ID", "Subject"} <= set(headers)
        or any(not isinstance(name, str) or not isinstance(value, str)
               for name, value in headers.items())
    ):
        raise RuntimeError("gmail_result_shape")
    return FakeMessage(
        item["messageId"], item["threadId"], item["rfcMessageId"], item["subject"],
        "", dict(headers), item["direction"] == "inbound", item["draft"], item["historyId"],
    )


class GmailAdapter:
    def __init__(self, backend: FakeGmail | McpRestBackend) -> None:
        if os.environ.get("KB_PROSPECTING_NO_NETWORK") == "1" and not isinstance(
            backend, FakeGmail
        ):
            raise RuntimeError("recorded_backend_required")
        self._backend = backend

    def draft_create_in_thread(
        self, *, logical_key: str, contact_id: str,
        thread_id: str | None, subject: str, body: str,
        parent_message_id: str | None, references: tuple[str, ...],
    ) -> FakeMessage:
        existing = self._reconcile(logical_key)
        if existing is not None:
            return existing
        message_id = deterministic_message_id(logical_key)
        if thread_id is None:
            if parent_message_id is not None or references:
                raise ValueError("new_draft_has_thread_headers")
            if isinstance(self._backend, FakeGmail):
                return self._backend.draft_new(subject, body, message_id)
            return self._backend.draft_new(contact_id, subject, body, message_id)
        if parent_message_id is None:
            raise ValueError("thread_parent_required")
        if isinstance(self._backend, FakeGmail):
            return self._backend.draft_in_thread(
                thread_id, subject, body, message_id, parent_message_id, references,
            )
        return self._backend.draft_in_thread(
            contact_id, thread_id, subject, body, message_id,
            parent_message_id, references,
        )

    def labels_modify(
        self, thread_id: str, add: tuple[str, ...], remove: tuple[str, ...]
    ) -> frozenset[str]:
        return self._backend.modify_labels(thread_id, add, remove)

    def thread_refresh(
        self, thread_id: str | None = None, *, logical_key: str | None = None
    ) -> FakeThread | FakeMessage | None:
        if (thread_id is None) == (logical_key is None):
            raise ValueError("one_refresh_target_required")
        if logical_key is not None:
            return self._reconcile(logical_key)
        return self._backend.thread_get(thread_id)

    def history_list(self, start_history_id: str) -> tuple[dict[str, str], ...]:
        return self._backend.history_list(start_history_id)

    def _reconcile(self, logical_key: str) -> FakeMessage | None:
        matches = self._backend.messages_list(
            f"rfc822msgid:{deterministic_message_id(logical_key)}"
        )
        if len(matches) > 1:
            raise RuntimeError("gmail_duplicate_message_id")
        return matches[0] if matches else None

    def __call__(self, request: ExecRequest) -> tuple[str, str]:
        if request.operation == "gmail_draft":
            logical_key = hashlib.sha256(
                f"{request.request_id}:{request.payload['revision_id']}".encode("ascii")
            ).hexdigest()
            self.draft_create_in_thread(
                logical_key=logical_key,
                contact_id=request.payload["contact_id"],
                thread_id=None,
                subject="Prospecting draft",
                body=f"Draft prepared from revision {request.payload['revision_id']}.",
                parent_message_id=None,
                references=(),
            )
            return "succeeded", "drafted"
        if request.operation == "gmail_label":
            self.labels_modify(
                request.payload["gmail_thread_id"], (request.payload["label_code"],), ()
            )
            return "succeeded", "labeled"
        if request.operation == "gmail_thread_refresh":
            self.thread_refresh(request.payload["gmail_thread_id"])
            return "succeeded", "refreshed"
        return "rejected", "unsupported_operation"
