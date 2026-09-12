"""Only P4 component permitted to read raw inbound content."""

from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Mapping


class InboundClass(str, Enum):
    SCHEDULING = "scheduling_logistics"
    THANKS = "thanks_ack"
    GRACEFUL_CLOSE = "graceful_close"
    POSITIVE = "substantive_positive"
    NEUTRAL = "human_neutral"
    NEGATIVE = "human_negative"
    OOO = "ooo"
    BOUNCE_FAILED = "bounce_failed"
    BOUNCE_DELAYED = "bounce_delayed"
    UNSUBSCRIBE = "unsubscribe"
    WRONG_PERSON = "wrong_person"
    AUTOMATIC = "automatic"
    AMBIGUOUS = "ambiguous"
    SENSITIVE = "sensitive"


@dataclass(frozen=True)
class InboundEnvelope:
    gmail_message_id: str
    gmail_thread_id: str
    enrollment_id: str
    received_at: str
    headers: Mapping[str, str]
    body_reader: Callable[[], str]


@dataclass(frozen=True)
class InboundSummary:
    processed: int
    stopped: int
    blocked: int

    def as_dict(self) -> dict[str, int]:
        return {"processed": self.processed, "stopped": self.stopped, "blocked": self.blocked}

    def as_vm_output(self, sink: str) -> dict[str, object]:
        """Return the count-only result in the required VM sink envelope."""
        return {"kind": sink, "fields": self.as_dict()}


OUTCOME_LABELS = (
    'Outreach/Sent', 'Outreach/Follow-up due', 'Outreach/Replied',
    'Outreach/OOO', 'Outreach/Bounced', 'Outreach/Closed-no-reply',
    'Outreach/Closed-declined',
)


def label_for(inbound_class: InboundClass) -> str:
    if inbound_class is InboundClass.OOO:
        return 'Outreach/OOO'
    if inbound_class is InboundClass.BOUNCE_FAILED:
        return 'Outreach/Bounced'
    if inbound_class in {InboundClass.UNSUBSCRIBE, InboundClass.WRONG_PERSON,
                         InboundClass.GRACEFUL_CLOSE, InboundClass.NEGATIVE}:
        return 'Outreach/Closed-declined'
    if inbound_class in {InboundClass.BOUNCE_DELAYED, InboundClass.AUTOMATIC}:
        return 'Outreach/Sent'
    return 'Outreach/Replied'


def classify(headers: Mapping[str, str], body: str) -> InboundClass:
    values = {key.lower(): value.lower() for key, value in headers.items()}
    sender, content_type = values.get("from", ""), values.get("content-type", "")
    subject, text = values.get("subject", ""), body.casefold()
    if "report-type=delivery-status" in content_type or any(x in sender for x in ("mailer-daemon", "postmaster")):
        return InboundClass.BOUNCE_DELAYED if "action: delayed" in text else InboundClass.BOUNCE_FAILED
    automatic = values.get("auto-submitted", "no") != "no" or values.get("precedence") in {"bulk", "list", "junk"}
    if automatic:
        if any(x in subject + " " + text for x in ("out of office", "ooo", "returning", "away")):
            return InboundClass.OOO
        return InboundClass.AUTOMATIC
    if any(x in text for x in ("unsubscribe", "remove me", "do not contact")):
        return InboundClass.UNSUBSCRIBE
    if "wrong person" in text or "no longer works" in text:
        return InboundClass.WRONG_PERSON
    if any(x in text for x in ("legal", "medical", "bank account", "social security")):
        return InboundClass.SENSITIVE
    if any(x in text for x in ("tuesday", "wednesday", "calendar", "works for me")):
        return InboundClass.SCHEDULING
    if any(x in text for x in ("happy to", "glad to", "yes,")):
        return InboundClass.POSITIVE
    if text.strip().rstrip(".! ") in {"thanks", "thank you"}:
        return InboundClass.THANKS
    if any(x in text for x in ("no thank", "not interested", "decline")):
        return InboundClass.GRACEFUL_CLOSE
    if any(x in text for x in ("inappropriate", "hostile", "never contact")):
        return InboundClass.NEGATIVE
    return InboundClass.NEUTRAL if text.strip() else InboundClass.AMBIGUOUS


def transition(inbound_class: InboundClass) -> tuple[str | None, str | None]:
    if inbound_class is InboundClass.OOO:
        return "ooo", None
    if inbound_class is InboundClass.BOUNCE_FAILED:
        return "hard_bounce", None
    if inbound_class is InboundClass.BOUNCE_DELAYED:
        return None, "delayed_dsn"
    if inbound_class is InboundClass.UNSUBSCRIBE:
        return "unsubscribe", None
    if inbound_class is InboundClass.WRONG_PERSON:
        return "wrong_person", None
    if inbound_class in {InboundClass.GRACEFUL_CLOSE, InboundClass.NEGATIVE}:
        return "decline", None
    if inbound_class in {InboundClass.AUTOMATIC, InboundClass.AMBIGUOUS, InboundClass.SENSITIVE}:
        return None, "manual_hold"
    return "human_reply", None


def process_inbound(
    connection: sqlite3.Connection, envelope: InboundEnvelope, *,
    after_pause: Callable[[], None] = lambda: None,
    label_request: Callable[[str, tuple[str, ...], tuple[str, ...]], None] = (
        lambda thread_id, add, remove: None
    ),
) -> InboundSummary:
    inbound_id = hashlib.sha256(envelope.gmail_message_id.encode()).hexdigest()
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "INSERT INTO inbound_claim(message_id, claimed_at) VALUES (?, datetime('now'))",
            (envelope.gmail_message_id,),
        )
        hold = connection.execute(
            "UPDATE enrollment SET status='blocked', block_reason='manual_hold' "
            "WHERE enrollment_id=? AND status NOT IN ('stopped','closed')",
            (envelope.enrollment_id,),
        )
        if hold.rowcount != 1:
            connection.rollback()
            return InboundSummary(0, 0, 0)
        connection.commit()
    except sqlite3.IntegrityError:
        connection.rollback()
        return InboundSummary(0, 0, 0)
    except Exception:
        connection.rollback()
        raise
    after_pause()
    body = envelope.body_reader()
    inbound_class = classify(envelope.headers, body)
    stop_reason, block_reason = transition(inbound_class)
    with connection:
        connection.execute(
            "INSERT INTO inbound VALUES (?,?,?,?,?,?,?,?,NULL,NULL)",
            (inbound_id, envelope.gmail_message_id, envelope.gmail_thread_id,
             envelope.enrollment_id, envelope.received_at, inbound_class.value,
             1.0, f"header_body_v1:{inbound_class.value}"),
        )
        if stop_reason:
            connection.execute(
                "UPDATE enrollment SET status='stopped',stop_reason=?,block_reason=NULL WHERE enrollment_id=?",
                (stop_reason, envelope.enrollment_id),
            )
        else:
            connection.execute(
                "UPDATE enrollment SET status='blocked',stop_reason=NULL,block_reason=? WHERE enrollment_id=?",
                (block_reason, envelope.enrollment_id),
            )
        selected = label_for(inbound_class)
        label_request(
            envelope.gmail_thread_id,
            (selected,),
            tuple(label for label in OUTCOME_LABELS if label != selected),
        )
    return InboundSummary(1, int(stop_reason is not None), int(block_reason is not None))
