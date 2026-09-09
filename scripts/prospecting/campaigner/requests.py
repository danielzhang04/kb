"""The campaigner's only Gmail-facing surface: typed P1 request insertion."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from typing import Mapping

from scripts.prospecting import store

ALLOWED = {
    "gmail_draft": frozenset({"draft_create_in_thread", "linearized_draft"}),
    "gmail_label": frozenset({"labels_modify"}),
    "gmail_thread_refresh": frozenset({"thread_get", "history_list", "message_id_reconcile"}),
}


@dataclass
class CampaignerRequests:
    connection: sqlite3.Connection
    policy_hash: str
    now: str = "2026-09-03T12:00:00+00:00"

    def enqueue(
        self, *, operation: str, action: str, payload: Mapping[str, object],
        include_action: bool = True,
    ) -> str:
        if action not in ALLOWED.get(operation, frozenset()):
            raise ValueError("campaigner_action_not_allowlisted")
        typed_payload = {**payload, **({"action": action} if include_action else {})}
        encoded = json.dumps(typed_payload, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(
            f"{operation}:{self.policy_hash}:{encoded}".encode("utf-8")
        ).hexdigest()
        request_id = f"req_{digest[:16]}"
        request = store.ExecRequest(
            request_id=request_id, caller="prospecting-campaigner", operation=operation,
            payload=typed_payload, policy_hash=self.policy_hash, approval_id=None,
            created_at=self.now, state="queued", reason=None,
        )
        store.insert_exec_request(self.connection, request, "T0")
        return request_id
