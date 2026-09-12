"""Executor-only vendor request queueing and reserved adapter execution."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import sqlite3
import uuid
from collections.abc import Mapping
from typing import Literal, Protocol

from scripts.prospecting.store import (
    CreditReservation,
    ExecRequest,
    ProviderAttempt,
    insert_provider_attempt,
    release_credit,
    settle_credit,
    validate_exec_request,
)


@dataclass(frozen=True)
class VendorResult:
    state: str
    credits: int
    records: tuple[Mapping[str, object], ...]
    raw_response_ref: int | None = None


ContactState = Literal[
    "valid", "invalid", "risky", "catch_all", "role", "stale", "not_found", "error",
]


@dataclass(frozen=True)
class EmailResult:
    state: ContactState | None
    email_ref: str | None
    confidence: float
    at: str
    provider: str
    credits: int
    raw_response_ref: int | None = None
    outcome: Literal["budget_exhausted"] | None = None


class VendorAdapter(Protocol):
    provider: str
    max_retries: int

    def max_cost(self, operation: str) -> int: ...

    def _execute(
        self,
        reservation: CreditReservation,
        operation: str,
        payload: Mapping[str, object],
        idempotency_key: str,
    ) -> VendorResult: ...


VENDOR_OPERATIONS = {
    "pdl": "person_search",
    "apify": "profile_batch",
    "hunter": "find",
    "snov": "find",
}
PDL_FREE_TIER_MONTHLY_UNITS = 100


class _ReservationRefused(ValueError):
    """The claimed request no longer owns a usable vendor reservation."""


def normalize_contact_state(provider: str, raw_state: str) -> ContactState:
    maps: dict[str, dict[str, ContactState]] = {
        "hunter": {
            "valid": "valid", "invalid": "invalid", "accept_all": "catch_all",
            "webmail": "risky", "disposable": "risky",
        },
        "snov": {
            "valid": "valid", "invalid": "invalid", "unknown": "risky",
            "catch_all": "catch_all", "role_based": "role",
        },
    }
    return maps.get(provider, {}).get(raw_state, "error")


def queue_vendor_lookup(
    connection: sqlite3.Connection,
    *,
    campaign_id: str,
    person_id: str,
    provider: str,
    vendor_operation: str,
    payload: Mapping[str, object],
    policy_hash: str,
    request_id: str,
    adapter: VendorAdapter,
    now: str,
) -> str:
    """Atomically queue one opaque vendor request and, if allowed, reserve its units."""
    if payload:
        raise ValueError("raw_vendor_payload_rejected")
    if provider != adapter.provider or VENDOR_OPERATIONS.get(provider) != vendor_operation:
        raise ValueError("unknown_vendor_operation")
    request = ExecRequest(
        request_id=request_id, caller="prospecting-list-builder", operation="vendor_lookup",
        payload={"campaign_id": campaign_id, "person_id": person_id, "provider": provider},
        policy_hash=policy_hash, approval_id=None, created_at=now,
    )
    connection.execute("BEGIN IMMEDIATE")
    try:
        campaign = connection.execute(
            "SELECT policy_hash,approval_tier,credit_budget FROM campaign WHERE campaign_id=?", (campaign_id,)
        ).fetchone()
        if campaign is None or campaign["policy_hash"] != policy_hash:
            raise ValueError("vendor_request_campaign_mismatch")
        validate_exec_request(request, campaign["approval_tier"], connection)
        connection.execute(
            """INSERT INTO exec_request(
                   request_id,caller,operation,payload,policy_hash,approval_id,created_at,state,reason
               ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                request.request_id, request.caller, request.operation,
                json.dumps(request.payload, sort_keys=True, separators=(",", ":")),
                request.policy_hash, request.approval_id, request.created_at, "queued", None,
            ),
        )
        max_cost = adapter.max_cost(vendor_operation)
        if type(max_cost) is not int or max_cost < 0:
            raise ValueError("vendor_cost_invalid")
        if provider == "pdl":
            used = connection.execute(
                """SELECT COALESCE(SUM(CASE
                       WHEN state='reserved' THEN max_cost
                       WHEN state='settled' THEN actual_cost ELSE 0 END),0)
                   FROM credit_reservation
                   WHERE provider='pdl' AND substr(created_at,1,7)=?
                     AND state IN ('reserved','settled')""",
                (now[:7],),
            ).fetchone()[0]
            if int(used) + max_cost > PDL_FREE_TIER_MONTHLY_UNITS:
                connection.execute(
                    "UPDATE exec_request SET reason='skipped_budget' WHERE request_id=?", (request_id,)
                )
                connection.commit()
                return request_id
        reserved = connection.execute(
            """SELECT COALESCE(SUM(CASE
                 WHEN state='reserved' THEN max_cost
                 WHEN state IN ('settled','overage_error') THEN actual_cost ELSE 0 END),0)
               FROM credit_reservation WHERE campaign_id=?""",
            (campaign_id,),
        ).fetchone()[0]
        if int(reserved) + max_cost > int(campaign["credit_budget"]):
            connection.execute(
                "UPDATE exec_request SET reason='skipped_budget' WHERE request_id=?", (request_id,)
            )
            connection.commit()
            return request_id
        connection.execute(
            """INSERT INTO credit_reservation(
                   reservation_id,campaign_id,provider,exec_request_id,max_cost,actual_cost,state,created_at,settled_at
               ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                str(uuid.uuid5(uuid.NAMESPACE_URL, request_id)), campaign_id, provider, request_id,
                max_cost, None, "reserved", now, None,
            ),
        )
        connection.commit()
        return request_id
    except Exception:
        connection.rollback()
        raise


def _reservation_for_claimed_request(
    connection: sqlite3.Connection,
    request_id: str,
    campaign_id: str,
    provider: str,
    units: int,
) -> CreditReservation:
    """Read the persisted reservation afresh; request reasons are never authority."""
    rows = connection.execute(
        """SELECT * FROM credit_reservation
           WHERE exec_request_id=? AND campaign_id=? AND provider=? AND max_cost=? AND state='reserved'""",
        (request_id, campaign_id, provider, units),
    ).fetchall()
    if len(rows) != 1:
        raise _ReservationRefused("reservation_missing_or_invalid")
    reservation = CreditReservation(**dict(rows[0]))
    expected_id = str(uuid.uuid5(uuid.NAMESPACE_URL, request_id))
    if reservation.reservation_id != expected_id or reservation.actual_cost is not None:
        raise _ReservationRefused("reservation_missing_or_invalid")
    return reservation


def _execute_reserved(
    connection: sqlite3.Connection,
    campaign_id: str,
    exec_request_id: str,
    person_id: str,
    provider: str,
    operation: str,
    payload: Mapping[str, object],
    idempotency_key: str,
    adapter: VendorAdapter,
    now: str,
    reservation: CreditReservation,
) -> VendorResult:
    """Call an adapter only after its still-reserved row has been re-validated."""
    verified = _reservation_for_claimed_request(
        connection, exec_request_id, campaign_id, provider, reservation.max_cost,
    )
    if verified.reservation_id != reservation.reservation_id:
        raise _ReservationRefused("reservation_changed")
    result: VendorResult | None = None
    for attempt_number in range(adapter.max_retries + 1):
        try:
            result = adapter._execute(verified, operation, payload, idempotency_key)
            break
        except TimeoutError:
            if attempt_number == adapter.max_retries:
                result = VendorResult("error", 0, ())
        except Exception:
            result = VendorResult("error", 0, ())
            break
    assert result is not None
    if result.credits:
        settle_credit(connection, verified.reservation_id, result.credits, now)
    else:
        release_credit(connection, verified.reservation_id, now)
    _record_attempt(connection, exec_request_id, person_id, provider, operation, payload, result, now)
    return result


def _record_attempt(connection, exec_request_id, person_id, provider, operation, payload, result, now):
    input_hash = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    insert_provider_attempt(connection, ProviderAttempt(
        attempt_id=exec_request_id, person_id=person_id, provider=provider, call=operation,
        input_hash=input_hash, priority=0, credits=result.credits, result=result.state,
        started_at=now, finished_at=now, raw_response_ref=result.raw_response_ref,
    ))


def _vendor_payload(connection: sqlite3.Connection, provider: str, person_id: str) -> Mapping[str, object]:
    if provider == "pdl":
        return {}
    if provider == "apify":
        row = connection.execute(
            "SELECT linkedin_url FROM person WHERE person_id=?", (person_id,),
        ).fetchone()
        if row is None or row["linkedin_url"] is None:
            raise ValueError("unknown_profile_ref")
        return {"profileUrls": [row["linkedin_url"]], "includeCompanyDetails": False}
    if provider in {"hunter", "snov"}:
        return {"person_ref": person_id, "company_ref": person_id}
    raise ValueError("unknown_vendor_operation")


def _execute_vendor_request(
    executor,
    request: ExecRequest,
    adapters: Mapping[str, VendorAdapter],
    now: str,
) -> VendorResult:
    """Private executor adapter implementation; no public method calls a transport."""
    row = executor.connection.execute(
        "SELECT request_id,caller,operation,payload,policy_hash,state FROM exec_request WHERE request_id=?",
        (request.request_id,),
    ).fetchone()
    if row is None or row["caller"] != "prospecting-list-builder" or row["state"] != "claimed":
        raise ValueError("vendor_request_not_claimed")
    if row["operation"] != "vendor_lookup":
        raise ValueError("unknown_vendor_operation")
    payload = json.loads(row["payload"])
    if set(payload) != {"campaign_id", "person_id", "provider"}:
        raise ValueError("unvalidated_vendor_request")
    campaign_id = str(payload["campaign_id"])
    person_id = str(payload["person_id"])
    provider = str(payload["provider"])
    operation = VENDOR_OPERATIONS.get(provider)
    adapter = adapters.get(provider)
    if operation is None or adapter is None or adapter.provider != provider:
        raise ValueError("unknown_vendor_operation")
    campaign = executor.connection.execute(
        "SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    if campaign is None or campaign["policy_hash"] != row["policy_hash"]:
        raise ValueError("vendor_request_campaign_mismatch")
    units = adapter.max_cost(operation)
    reservation = _reservation_for_claimed_request(
        executor.connection, request.request_id, campaign_id, provider, units,
    )
    return _execute_reserved(
        executor.connection, campaign_id, request.request_id, person_id, provider, operation,
        _vendor_payload(executor.connection, provider, person_id), request.request_id,
        adapter, now, reservation,
    )


def register_vendor_adapters(executor, adapters: Mapping[str, VendorAdapter], *, now: str) -> None:
    """Register the sole executor-owned transport entry point for all vendors."""
    if set(adapters) != set(VENDOR_OPERATIONS):
        raise ValueError("vendor_adapter_map_incomplete")

    def _adapter(request: ExecRequest) -> tuple[str, str]:
        # Executor._act opens a transaction before invoking adapters.  Credit helpers
        # own their short transactions, so end that empty wrapper before reservation I/O.
        executor.connection.commit()
        try:
            _execute_vendor_request(executor, request, adapters, now)
        except _ReservationRefused:
            return "rejected", "reservation_missing_or_invalid"
        except ValueError:
            return "rejected", "vendor_request_rejected"
        return "succeeded", "vendor_completed"

    executor.register_adapter("vendor_lookup", _adapter)
