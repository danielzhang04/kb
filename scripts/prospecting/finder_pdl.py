"""PDL spot-search adapter with fixture-only no-network execution."""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Mapping
from pathlib import Path

from scripts.prospecting.providers.base import VendorResult, queue_vendor_lookup
from scripts.prospecting.store import CreditReservation


class PDLSpotAdapter:
    provider = "pdl"
    timeout_seconds = 20
    max_retries = 2

    def __init__(self, fixture_dir: Path = Path("orgs/prospecting/fixtures/vendor/pdl"), transport: Callable[..., Mapping[str, object]] | None = None, clock: Callable[[], float] | None = None, sleeper: Callable[[float], None] | None = None):
        import time
        self.fixture_dir = fixture_dir
        self.transport = transport
        self.clock = clock or time.monotonic
        self.sleeper = sleeper or time.sleep
        self.last_call: float | None = None
        self._results: dict[str, VendorResult] = {}

    def max_cost(self, operation: str) -> int:
        if operation != "person_search":
            raise ValueError("pdl_unknown_operation")
        return 1

    def queue(
        self, connection, *, campaign_id: str, person_id: str, policy_hash: str,
        request_id: str, now: str = "2026-09-03T00:00:00Z",
    ) -> str:
        """Build an opaque executor request; this method never invokes a transport."""
        return queue_vendor_lookup(
            connection, campaign_id=campaign_id, person_id=person_id, provider=self.provider,
            vendor_operation="person_search", payload={}, policy_hash=policy_hash,
            request_id=request_id, adapter=self, now=now,
        )

    def _execute(
        self,
        reservation: CreditReservation,
        operation: str,
        payload: Mapping[str, object],
        idempotency_key: str,
    ) -> VendorResult:
        if reservation.provider != self.provider or not reservation.exec_request_id:
            raise ValueError("pdl_unreserved_call")
        if idempotency_key in self._results:
            return self._results[idempotency_key]
        if os.environ.get("KB_PROSPECTING_NO_NETWORK") == "1":
            filename = "spot-not-found.json" if payload.get("force_not_found") else "spot-success.json"
            raw = json.loads((self.fixture_dir / filename).read_text(encoding="utf-8"))
        else:
            if self.transport is None:
                raise RuntimeError("pdl_transport_unavailable")
            current = self.clock()
            if self.last_call is not None:
                self.sleeper(max(0.0, 1.0 - (current - self.last_call)))
            self.last_call = current
            raw = self.transport(operation, payload, idempotency_key, self.timeout_seconds)
        result = VendorResult(str(raw["result"]), int(raw["credits"]), tuple(raw.get("records", ())))
        self._results[idempotency_key] = result
        return result


def remaining_pdl_free_tier(connection, request_id: str, month: str) -> int:
    request = connection.execute(
        "SELECT state FROM exec_request WHERE request_id=?", (request_id,)
    ).fetchone()
    if request is None or request["state"] != "claimed":
        raise ValueError("pdl_request_not_claimed")
    used = connection.execute(
        """SELECT COALESCE(SUM(max_cost),0) FROM credit_reservation
           WHERE provider='pdl' AND substr(created_at,1,7)=?
             AND state IN ('reserved','settled','overage_error')""",
        (month,),
    ).fetchone()[0]
    return max(0, 100 - int(used))
