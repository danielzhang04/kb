from __future__ import annotations

from dataclasses import dataclass, field, replace as dataclass_replace
from datetime import datetime, timedelta
import hashlib
import hmac
import json
from types import MappingProxyType
from typing import Iterable, Mapping


def _dt(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone_required")
    return parsed


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


@dataclass(frozen=True, order=True)
class BatchItem:
    revision_hash: str
    contact_id: str

    def __post_init__(self):
        if len(self.revision_hash) != 64 or not self.contact_id:
            raise ValueError("invalid_batch_item")


@dataclass(frozen=True)
class BatchScope:
    campaign_id: str
    policy_hash: str
    items: tuple[BatchItem, ...]
    batch_hash: str
    mailbox_id: str
    tier: str
    send_window: Mapping[str, str]
    expires_at: str
    nonce: str
    permitted_action: str = "send_revision"
    content_kind: str = "revision"
    schema: str = "prospecting-approval-scope/v1"
    approval_hash: str = field(init=False)

    def __post_init__(self) -> None:
        """Freeze compound fields and bind this scope to its canonical payload."""
        object.__setattr__(self, "items", tuple(self.items))
        object.__setattr__(self, "send_window", MappingProxyType(dict(self.send_window)))
        object.__setattr__(self, "batch_hash", _batch_hash(self.items))
        object.__setattr__(self, "approval_hash", _recomputed_scope_hash(self))

    def replace(self, **changes: object) -> "BatchScope":
        """Return a new frozen scope, recomputing all derived bindings."""
        if "items" in changes:
            items = _items(changes["items"])
            changes["items"] = items
        return dataclass_replace(self, **changes)


def _items(items: Iterable[BatchItem]) -> tuple[BatchItem, ...]:
    value = tuple(sorted(items, key=lambda item: (item.revision_hash, item.contact_id)))
    if not value or len(set(value)) != len(value):
        raise ValueError("empty_or_duplicate_items")
    if len({item.revision_hash for item in value}) != len(value):
        raise ValueError("revision_hash_not_unique")
    return value


def _batch_hash(items: tuple[BatchItem, ...]) -> str:
    return _sha(
        json.dumps(
            [item.revision_hash for item in items], sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    )


def build_scope(
    campaign_id: str,
    policy_hash: str,
    items: Iterable[BatchItem],
    mailbox_id: str,
    tier: str,
    window_start: str,
    window_end: str,
    expires_at: str,
    nonce: str,
    now: datetime,
) -> BatchScope:
    ordered = _items(items)
    start, end, expiry = _dt(window_start), _dt(window_end), _dt(expires_at)
    if not start < end or not now < expiry <= min(end, now + timedelta(hours=24)):
        raise ValueError("scope_expiry_or_window")
    if tier != "T1" or not campaign_id or len(policy_hash) != 64 or not mailbox_id or not nonce:
        raise ValueError("invalid_scope")
    batch_hash = _batch_hash(ordered)
    return BatchScope(
        campaign_id,
        policy_hash,
        ordered,
        batch_hash,
        mailbox_id,
        tier,
        {"start": start.isoformat(), "end": end.isoformat()},
        expiry.isoformat(),
        nonce,
    )


def _payload(scope: BatchScope) -> dict[str, object]:
    """The complete, immutable payload protected by the approval hash."""
    return {
        "campaign_id": scope.campaign_id,
        "policy_hash": scope.policy_hash,
        "items": [
            {"revision_hash": item.revision_hash, "contact_id": item.contact_id}
            for item in scope.items
        ],
        "batch_hash": scope.batch_hash,
        "mailbox_id": scope.mailbox_id,
        "tier": scope.tier,
        "send_window": dict(scope.send_window),
        "expires_at": scope.expires_at,
        "nonce": scope.nonce,
        "permitted_action": scope.permitted_action,
        "content_kind": scope.content_kind,
        "schema": scope.schema,
    }


def _recomputed_scope_hash(scope: BatchScope) -> str:
    return _sha(
        json.dumps(
            _payload(scope), sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
    )


def _value(scope: BatchScope) -> dict[str, object]:
    return {**_payload(scope), "approval_hash": scope.approval_hash}


def canonical_bytes(scope: BatchScope) -> bytes:
    return json.dumps(
        _value(scope), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def serialize(scope: BatchScope) -> str:
    return canonical_bytes(scope).decode("utf-8")


def scope_hash(scope: BatchScope) -> str:
    recomputed = _recomputed_scope_hash(scope)
    if not hmac.compare_digest(scope.approval_hash, recomputed):
        raise ValueError("scope_hash_mismatch")
    return scope.approval_hash


def send_scope_hash(value: dict[str, str]) -> str:
    expected = {
        "campaign_id",
        "policy_hash",
        "content_kind",
        "revision_hash",
        "contact_id",
        "mailbox_id",
        "tier",
        "send_window",
        "expires_at",
        "nonce",
        "permitted_action",
    }
    if set(value) != expected:
        raise ValueError("send_scope_keys")
    return _sha(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
            "utf-8"
        )
    )


def deserialize(data: str | bytes, expected_hash: str, now: datetime) -> BatchScope:
    raw = data.decode("utf-8") if isinstance(data, bytes) else data
    value = json.loads(raw)
    if set(value) != {
        "batch_hash",
        "campaign_id",
        "content_kind",
        "expires_at",
        "items",
        "mailbox_id",
        "nonce",
        "permitted_action",
        "policy_hash",
        "schema",
        "send_window",
        "tier",
        "approval_hash",
    }:
        raise ValueError("scope_keys")
    scope = build_scope(
        value["campaign_id"],
        value["policy_hash"],
        tuple(BatchItem(**item) for item in value["items"]),
        value["mailbox_id"],
        value["tier"],
        value["send_window"]["start"],
        value["send_window"]["end"],
        value["expires_at"],
        value["nonce"],
        now,
    )
    if (
        value["batch_hash"] != scope.batch_hash
        or value["schema"] != scope.schema
        or not hmac.compare_digest(value["approval_hash"], scope.approval_hash)
    ):
        raise ValueError("scope_derived_field")
    if value["content_kind"] != "revision" or value["permitted_action"] != "send_revision":
        raise ValueError("scope_action")
    if not hmac.compare_digest(scope_hash(scope), expected_hash):
        raise ValueError("scope_hash_mismatch")
    return scope


def materialized_send_scopes(scope: BatchScope) -> tuple[dict[str, str], ...]:
    scope_hash(scope)
    rows = []
    for index, item in enumerate(scope.items):
        nonce = scope.nonce if index == 0 else _sha(
            canonical_bytes(scope)
            + b"\nitem:"
            + f"{item.revision_hash}:{item.contact_id}".encode("utf-8")
        )
        value = {
            "campaign_id": scope.campaign_id,
            "policy_hash": scope.policy_hash,
            "content_kind": "revision",
            "revision_hash": item.revision_hash,
            "contact_id": item.contact_id,
            "mailbox_id": scope.mailbox_id,
            "tier": scope.tier,
            "send_window": json.dumps(
                dict(scope.send_window), sort_keys=True, separators=(",", ":")
            ),
            "expires_at": scope.expires_at,
            "nonce": nonce,
            "permitted_action": "send_revision",
        }
        value["scope_hash"] = send_scope_hash(value)
        rows.append(value)
    return tuple(rows)
