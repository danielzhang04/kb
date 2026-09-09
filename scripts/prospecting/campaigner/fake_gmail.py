"""Stateful Gmail fake used by every P4 test."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Mapping


class ArrivalPoint(str, Enum):
    BEFORE_REFRESH = "before_refresh"
    BETWEEN_REFRESH_AND_CAS = "between_refresh_and_cas"
    AFTER_CAS = "after_cas"


@dataclass(frozen=True)
class FakeMessage:
    message_id: str
    thread_id: str
    rfc_message_id: str
    subject: str
    body: str
    headers: Mapping[str, str]
    inbound: bool
    draft: bool
    history_id: str


@dataclass
class FakeThread:
    thread_id: str
    subject: str
    messages: list[FakeMessage] = field(default_factory=list)
    labels: set[str] = field(default_factory=set)


@dataclass(frozen=True)
class _QueuedInbound:
    point: ArrivalPoint
    thread_id: str
    subject: str
    headers: Mapping[str, str]
    body: str


class FakeGmail:
    def __init__(self) -> None:
        self._threads: dict[str, FakeThread] = {}
        self._history: list[dict[str, str]] = []
        self._queued: list[_QueuedInbound] = []
        self._next_message = 1
        self._next_thread = 1
        self._next_history = 1

    def _ids(self, thread_id: str | None = None) -> tuple[str, str, str]:
        message_id = f"msg-{self._next_message:04d}"
        self._next_message += 1
        if thread_id is None:
            thread_id = f"req_{self._next_thread:016x}"
            self._next_thread += 1
        history_id = str(self._next_history)
        self._next_history += 1
        return message_id, thread_id, history_id

    def _record(self, event: str, message: FakeMessage) -> None:
        self._history.append(
            {"history_id": message.history_id, "event": event,
             "message_id": message.message_id, "thread_id": message.thread_id}
        )

    def seed_outbound(self, subject: str, rfc_message_id: str) -> FakeMessage:
        message_id, thread_id, history_id = self._ids()
        message = FakeMessage(
            message_id, thread_id, rfc_message_id, subject, "Synthetic outbound",
            {"Message-ID": rfc_message_id, "Subject": subject}, False, False,
            history_id,
        )
        self._threads[thread_id] = FakeThread(thread_id, subject, [message])
        self._record("messageAdded", message)
        return message

    def draft_new(self, subject: str, body: str, rfc_message_id: str) -> FakeMessage:
        message_id, thread_id, history_id = self._ids()
        if self.messages_list(f"rfc822msgid:{rfc_message_id}"):
            raise ValueError("duplicate_rfc_message_id")
        message = FakeMessage(
            message_id, thread_id, rfc_message_id, subject, body,
            {"Message-ID": rfc_message_id, "Subject": subject}, False, True,
            history_id,
        )
        self._threads[thread_id] = FakeThread(thread_id, subject, [message])
        self._record("draftAdded", message)
        return message

    def draft_in_thread(
        self,
        thread_id: str,
        subject: str,
        body: str,
        rfc_message_id: str,
        in_reply_to: str,
        references: tuple[str, ...],
    ) -> FakeMessage:
        thread = self._threads[thread_id]
        if subject != thread.subject:
            raise ValueError("thread_subject_mismatch")
        known = {message.rfc_message_id for message in thread.messages}
        if in_reply_to not in known or in_reply_to not in references:
            raise ValueError("thread_header_mismatch")
        if self.messages_list(f"rfc822msgid:{rfc_message_id}"):
            raise ValueError("duplicate_rfc_message_id")
        message_id, _, history_id = self._ids(thread_id)
        message = FakeMessage(
            message_id, thread_id, rfc_message_id, subject, body,
            {"Message-ID": rfc_message_id, "Subject": subject,
             "In-Reply-To": in_reply_to, "References": " ".join(references)},
            False, True, history_id,
        )
        thread.messages.append(message)
        self._record("draftAdded", message)
        return message

    def modify_labels(
        self, thread_id: str, add: tuple[str, ...], remove: tuple[str, ...]
    ) -> frozenset[str]:
        thread = self._threads[thread_id]
        thread.labels.difference_update(remove)
        thread.labels.update(add)
        _, _, history_id = self._ids(thread_id)
        self._history.append(
            {"history_id": history_id, "event": "labelsChanged",
             "message_id": "", "thread_id": thread_id}
        )
        return frozenset(thread.labels)

    def thread_get(self, thread_id: str) -> FakeThread:
        source = self._threads[thread_id]
        return FakeThread(
            source.thread_id, source.subject, list(source.messages), set(source.labels)
        )

    def history_list(self, start_history_id: str) -> tuple[dict[str, str], ...]:
        start = int(start_history_id)
        return tuple(
            dict(event) for event in self._history
            if int(event["history_id"]) > start
        )

    def messages_list(self, query: str) -> tuple[FakeMessage, ...]:
        prefix = "rfc822msgid:"
        if not query.startswith(prefix):
            raise ValueError("query_not_allowlisted")
        wanted = query[len(prefix):]
        return tuple(
            message
            for thread in self._threads.values()
            for message in thread.messages
            if message.rfc_message_id == wanted
        )

    def queue_inbound(
        self,
        point: ArrivalPoint,
        thread_id: str,
        subject: str,
        headers: Mapping[str, str],
        body: str,
    ) -> None:
        self._queued.append(_QueuedInbound(point, thread_id, subject, headers, body))

    def arrive(self, point: ArrivalPoint) -> tuple[FakeMessage, ...]:
        due = [item for item in self._queued if item.point is point]
        self._queued = [item for item in self._queued if item.point is not point]
        created: list[FakeMessage] = []
        for item in due:
            message_id, _, history_id = self._ids(item.thread_id)
            rfc_id = f"<inbound-{message_id}@kb.test>"
            headers = {**item.headers, "Message-ID": rfc_id, "Subject": item.subject}
            message = FakeMessage(
                message_id, item.thread_id, rfc_id, item.subject, item.body,
                headers, True, False, history_id,
            )
            self._threads[item.thread_id].messages.append(message)
            self._record("messageAdded", message)
            created.append(message)
        return tuple(created)
