"""Single-process deterministic executor shell; P1 has no live adapters."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from collections.abc import Callable, Mapping

from . import install_no_network_guard
from .pii_guard import assert_vm_safe
from .store import ExecRequest, consume_send_approval, validate_exec_request

install_no_network_guard()

Hook = Callable[[ExecRequest], None]
SendAdapter = Callable[[ExecRequest], tuple[str, str]]
Adapter = Callable[[ExecRequest], tuple[str, str]]

AGENT_CAPABILITIES: Mapping[str, tuple[str, ...]] = {
    "prospecting-list-builder": (
        "exec_request:fetch_snapshot", "exec_request:finder_page", "exec_request:vendor_lookup",
    ),
    "prospecting-campaigner": (
        "exec_request:gmail_draft", "exec_request:gmail_send", "exec_request:gmail_label",
        "exec_request:gmail_thread_refresh",
    ),
    "prospecting-manager": (),
    "prospecting-personalizer": (),
}

EXECUTOR_OPERATIONS = frozenset(
    capability.removeprefix("exec_request:")
    for capabilities in AGENT_CAPABILITIES.values()
    for capability in capabilities
)


def enumerate_agent_capabilities() -> tuple[str, ...]:
    return tuple(
        capability
        for agent in sorted(AGENT_CAPABILITIES)
        for capability in AGENT_CAPABILITIES[agent]
    )


class Executor:
    def __init__(
        self, connection: sqlite3.Connection, hooks: tuple[Hook, ...] = (),
        send_adapter: SendAdapter | None = None,
    ) -> None:
        self.connection = connection
        self.hooks = hooks
        self.send_adapter = send_adapter
        self._adapters: dict[str, Adapter] = {}
        self._registry_locked = False
        if send_adapter is not None:
            self.register_adapter("gmail_send", send_adapter)

    def lock_registry(self) -> None:
        """Close bootstrap-time adapter registration before claiming work."""
        self._registry_locked = True

    def register_adapter(
        self, operation: str, adapter: Adapter, *, replace: bool = False
    ) -> None:
        if self._registry_locked:
            raise RuntimeError("registry_locked")
        if operation not in EXECUTOR_OPERATIONS:
            raise ValueError("unknown executor operation")
        if operation in self._adapters and not replace:
            raise ValueError("adapter already registered")
        self._adapters[operation] = adapter

    def _claim(self) -> sqlite3.Row | None:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            row = self.connection.execute(
                "SELECT * FROM exec_request WHERE state='queued' ORDER BY created_at,request_id LIMIT 1"
            ).fetchone()
            if row is None:
                self.connection.rollback()
                return None
            changed = self.connection.execute(
                """UPDATE exec_request SET state='claimed',claimed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                   WHERE request_id=? AND state='queued'""",
                (row["request_id"],),
            )
            if changed.rowcount != 1:
                self.connection.rollback()
                return None
            self.connection.commit()
            return self.connection.execute(
                "SELECT * FROM exec_request WHERE request_id=?", (row["request_id"],)
            ).fetchone()
        except Exception:
            self.connection.rollback()
            raise

    @staticmethod
    def _from_row(row: sqlite3.Row) -> ExecRequest:
        return ExecRequest(
            row["request_id"], row["caller"], row["operation"], json.loads(row["payload"]),
            row["policy_hash"], row["approval_id"], row["created_at"], row["state"], row["reason"],
        )

    def _campaign_tier(self, request: ExecRequest) -> str:
        if request.operation != "gmail_send":
            return "T0"
        row = self.connection.execute(
            """SELECT c.approval_tier FROM delivery AS d
               JOIN campaign AS c ON c.campaign_id=d.campaign_id
               WHERE d.delivery_id=?""",
            (request.payload["delivery_id"],),
        ).fetchone()
        if row is None:
            raise ValueError("delivery is not resolvable")
        return str(row[0])

    def _trusted_now(self) -> str:
        return str(self.connection.execute(
            "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')"
        ).fetchone()[0])

    def _validate(self, request: ExecRequest) -> None:
        assert_vm_safe({"kind": "process_arguments", "fields": request.payload}, "process_arguments")
        validate_exec_request(
            request, self._campaign_tier(request), self.connection, self._trusted_now()
        )

    def _act(self, request: ExecRequest) -> tuple[str, str]:
        adapter = self._adapters.get(request.operation)
        if adapter is None:
            return "rejected", "no_adapter"
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            if request.operation == "gmail_send":
                consume_send_approval(
                    self.connection, request, self._campaign_tier(request), self._trusted_now()
                )
            state, reason = adapter(request)
            if state == "succeeded":
                self.connection.commit()
            else:
                self.connection.rollback()
            return state, reason
        except Exception:
            self.connection.rollback()
            return "rejected", "adapter_error"

    def _audit(self, request: ExecRequest, state: str, reason: str) -> None:
        before = hashlib.sha256(b"claimed").hexdigest()
        after = hashlib.sha256(state.encode("ascii")).hexdigest()
        self.connection.execute(
            """INSERT INTO audit(
               event_id,actor,action,entity_type,entity_id,at,before_hash,after_hash,reason
               ) VALUES(?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,?,?)""",
            (str(uuid.uuid4()), "desktop-executor", "executor_request", "exec_request",
             request.request_id, before, after, reason),
        )

    def process_one(self) -> bool:
        self.lock_registry()
        row = self._claim()
        if row is None:
            return False
        request = self._from_row(row)
        try:
            self._validate(request)
            for hook in self.hooks:
                hook(request)
            state, reason = self._act(request)
        except Exception:
            state, reason = "rejected", "validation_or_hook_rejected"
        if state not in ("succeeded", "rejected"):
            state, reason = "rejected", "invalid_adapter_state"
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            self.connection.execute(
                "UPDATE exec_request SET state=?,reason=? WHERE request_id=? AND state='claimed'",
                (state, reason, request.request_id),
            )
            self._audit(request, state, reason)
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return True
