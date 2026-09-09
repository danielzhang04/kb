"""Deterministic tier-zero prospecting campaigner."""

from __future__ import annotations

APPROVAL_TIER = "T0"
ALLOWED_EXECUTOR_OPERATIONS = frozenset(
    {"gmail_draft", "gmail_label", "gmail_thread_refresh"}
)
