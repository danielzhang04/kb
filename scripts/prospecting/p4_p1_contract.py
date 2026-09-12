"""Pinned P1 surface that P4 depends on.

This module deliberately fails fast if the recorded P1 storage or executor
surface drifts before P4 starts to use it.
"""

from __future__ import annotations

import inspect
import sqlite3
from collections.abc import Mapping

from scripts.prospecting import executor, store


STORE_FUNCTION_PARAMETERS: Mapping[str, tuple[str, ...]] = {
    "open_store": ("path",),
    "migrate": ("connection",),
    "insert_exec_request": ("connection", "request", "campaign_tier", "now"),
    "consume_send_approval": ("connection", "request", "campaign_tier", "now"),
}

EXECUTOR_FUNCTION_PARAMETERS: Mapping[str, tuple[str, ...]] = {
    "enumerate_agent_capabilities": (),
}

EXECUTOR_CLAIM_PATH_PARAMETERS: Mapping[str, tuple[str, ...]] = {
    "__init__": ("self", "connection", "hooks", "send_adapter"),
    "_claim": ("self",),
    "_campaign_tier": ("self", "request"),
    "_trusted_now": ("self",),
    "_validate": ("self", "request"),
    "_act": ("self", "request"),
    "_audit": ("self", "request", "state", "reason"),
    "process_one": ("self",),
}

GMAIL_EXECUTOR_CAPABILITIES = (
    "exec_request:gmail_draft",
    "exec_request:gmail_send",
    "exec_request:gmail_label",
    "exec_request:gmail_thread_refresh",
)

EXPECTED_COLUMNS: Mapping[str, tuple[str, ...]] = {
    "approval": (
        "approval_id", "assertion_ref", "campaign_id", "policy_hash", "content_kind",
        "revision_hash", "contact_id", "mailbox_id", "approver", "approved_at", "expires_at",
        "tier", "send_window", "nonce", "permitted_action", "consumed_at", "scope_hash",
        "invalidation_reason",
    ),
    "revision": (
        "revision_id", "person_id", "campaign_id", "step", "subject", "body", "angle",
        "generation_mode", "purpose", "ask", "evidence_ids", "recipient_relevance_points",
        "sender_proof_points", "template_id", "template_version", "prompt_version", "model_version",
        "qa", "hash",
    ),
    "exec_request": (
        "request_id", "caller", "operation", "payload", "policy_hash", "approval_id",
        "created_at", "claimed_at", "state", "reason",
    ),
    "delivery": (
        "delivery_id", "campaign_id", "enrollment_id", "step", "revision_hash", "contact_id",
        "mailbox_id", "logical_key", "gmail_message_id", "gmail_thread_id", "rfc_message_id",
        "scheduled_at", "attempted_at", "sent_at", "state",
    ),
    "enrollment": (
        "enrollment_id", "campaign_id", "person_id", "current_step", "next_due_at", "status",
        "stop_reason", "block_reason", "variant_id",
    ),
    "inbound": (
        "inbound_id", "gmail_message_id", "gmail_thread_id", "enrollment_id", "received_at",
        "class", "confidence", "explanation_code", "reviewed_by", "correction_class",
    ),
    "reply_revision": (
        "reply_revision_id", "inbound_id", "campaign_id", "contact_id", "mailbox_id", "class",
        "template_id", "template_version", "subject", "body", "hash", "generation_mode",
    ),
    "reply_template": ("id", "version", "body_hash", "approved_at"),
    "suppression": (
        "suppression_id", "scope", "subject_key", "reason", "created_at", "created_by",
        "released_at", "released_by",
    ),
    "audit": (
        "event_id", "actor", "action", "entity_type", "entity_id", "at", "before_hash",
        "after_hash", "reason",
    ),
}


def verify_p1_contract(connection: sqlite3.Connection) -> None:
    """Raise ``AssertionError`` at the first P1 surface mismatch."""
    for name, expected in STORE_FUNCTION_PARAMETERS.items():
        actual = tuple(inspect.signature(getattr(store, name)).parameters)
        assert actual == expected, f"store.{name} parameters: expected {expected}, got {actual}"
    for name, expected in EXECUTOR_FUNCTION_PARAMETERS.items():
        actual = tuple(inspect.signature(getattr(executor, name)).parameters)
        assert actual == expected, f"executor.{name} parameters: expected {expected}, got {actual}"
    for name, expected in EXECUTOR_CLAIM_PATH_PARAMETERS.items():
        actual = tuple(inspect.signature(getattr(executor.Executor, name)).parameters)
        assert actual == expected, f"executor.Executor.{name} parameters: expected {expected}, got {actual}"
    actual_capabilities = executor.AGENT_CAPABILITIES["prospecting-campaigner"]
    assert actual_capabilities == GMAIL_EXECUTOR_CAPABILITIES, (
        f"prospecting-campaigner capabilities: expected {GMAIL_EXECUTOR_CAPABILITIES}, "
        f"got {actual_capabilities}"
    )
    for table, expected in EXPECTED_COLUMNS.items():
        actual = tuple(row[1] for row in connection.execute(f"PRAGMA table_info({table})"))
        assert actual == expected, f"{table} columns: expected {expected}, got {actual}"
