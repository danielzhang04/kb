"""Fixture-capable Hunter lookup builder with executor-owned transport."""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Mapping
from pathlib import Path

from scripts.prospecting.providers.base import VendorResult, normalize_contact_state, queue_vendor_lookup
from scripts.prospecting.store import CreditReservation


class HunterEmailFinder:
    provider = "hunter"
    timeout_seconds = 20
    max_retries = 2

    def __init__(
        self,
        fixture_dir: Path = Path("orgs/prospecting/fixtures/vendor/hunter"),
        transport: Callable[..., Mapping[str, object]] | None = None,
    ) -> None:
        self.fixture_dir = fixture_dir
        self.transport = transport
        self._results: dict[tuple[str, str], Mapping[str, object]] = {}
        self._completed: dict[str, VendorResult] = {}

    def max_cost(self, operation: str) -> int:
        if operation not in {"find", "verify"}:
            raise ValueError("hunter_unknown_operation")
        return 1

    def queue(
        self, connection, *, campaign_id: str, person_id: str, policy_hash: str,
        request_id: str, now: str = "2026-09-03T00:00:00Z",
    ) -> str:
        """Build an opaque executor request; this method never invokes a transport."""
        return queue_vendor_lookup(
            connection, campaign_id=campaign_id, person_id=person_id, provider=self.provider,
            vendor_operation="find", payload={}, policy_hash=policy_hash,
            request_id=request_id, adapter=self, now=now,
        )

    def _read(self, name: str, payload: Mapping[str, object], key: str) -> Mapping[str, object]:
        cache_key = (name, key)
        if cache_key in self._results:
            return self._results[cache_key]
        if os.environ.get("KB_PROSPECTING_NO_NETWORK") == "1":
            raw = json.loads((self.fixture_dir / name).read_text(encoding="utf-8"))
        elif self.transport is None:
            raise RuntimeError("hunter_transport_unavailable")
        else:
            raw = self.transport(name, payload, key, self.timeout_seconds)
        self._results[cache_key] = raw
        return raw

    def _execute(
        self, reservation: CreditReservation, operation: str, payload: Mapping[str, object],
        idempotency_key: str,
    ) -> VendorResult:
        if reservation.provider != self.provider or operation != "find":
            raise ValueError("hunter_unreserved_call")
        if set(payload) != {"person_ref", "company_ref"}:
            raise ValueError("hunter_invalid_input_shape")
        raw = self._read("find.json", payload, idempotency_key)
        result = VendorResult(
            normalize_contact_state(self.provider, str(raw["state"])), int(raw["credits"]), (raw,),
        )
        self._completed[idempotency_key] = result
        return result
