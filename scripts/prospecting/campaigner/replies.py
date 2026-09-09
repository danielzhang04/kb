"""Deterministic, template-only T0 reply drafting."""
from __future__ import annotations
import hashlib
import sqlite3
from dataclasses import dataclass
from scripts.prospecting.campaigner.requests import CampaignerRequests

REPLY_WORTHY = frozenset({'scheduling_logistics','thanks_ack','graceful_close',
                          'substantive_positive','human_neutral','human_negative'})


@dataclass(frozen=True)
class ReplyContext:
    inbound_id: str
    campaign_id: str
    contact_id: str
    mailbox_id: str
    subject: str
    template_id: str
    template_version: int
    template_body: str


@dataclass(frozen=True)
class ReplyResult:
    created: bool
    reply_revision_id: str | None


def draft_reply(connection: sqlite3.Connection, requests: CampaignerRequests,
                context: ReplyContext) -> ReplyResult:
    inbound_class = connection.execute(
        "SELECT class FROM inbound WHERE inbound_id=?", (context.inbound_id,),
    ).fetchone()[0]
    if inbound_class not in REPLY_WORTHY:
        return ReplyResult(False, None)
    body_hash = hashlib.sha256(context.template_body.encode()).hexdigest()
    approved = connection.execute(
        "SELECT 1 FROM reply_template WHERE id=? AND version=? AND body_hash=?",
        (context.template_id, context.template_version, body_hash),
    ).fetchone()
    if not approved:
        raise ValueError('reply_template_hash_mismatch')
    preimage = '|'.join((context.inbound_id, context.campaign_id, context.contact_id,
                         context.mailbox_id, inbound_class, context.subject,
                         context.template_body, context.template_id,
                         str(context.template_version)))
    revision_hash = hashlib.sha256(preimage.encode()).hexdigest()
    reply_id = f"rev_{hashlib.sha256(f'reply:{context.inbound_id}'.encode()).hexdigest()[:16]}"
    with connection:
        inserted = connection.execute(
            "INSERT OR IGNORE INTO reply_revision VALUES(?,?,?,?,?,?,?,?,?,?,?,'deterministic_template')",
            (reply_id, context.inbound_id, context.campaign_id, context.contact_id,
             context.mailbox_id, inbound_class, context.template_id,
             context.template_version, context.subject, context.template_body, revision_hash),
        ).rowcount
        if inserted:
            requests.enqueue(
                operation='gmail_draft', action='draft_create_in_thread',
                payload={
                    'revision_id': reply_id,
                    'contact_id': context.contact_id,
                    'mailbox_id': context.mailbox_id,
                },
                include_action=False,
            )
    return ReplyResult(bool(inserted), reply_id)
