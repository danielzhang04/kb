"""Cookieless class-C adapter for preselected public profile URLs."""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Mapping
from pathlib import Path

from scripts.prospecting.providers.base import VendorResult, queue_vendor_lookup
from scripts.prospecting.store import CreditReservation


APIFY_ACTOR = "atomus/linkedin-profile-scraper"
MAPPED_FIELDS = frozenset({
    "identifier", "full_name", "first_name", "title", "location", "company_name", "company_profile_ref",
})


def map_apify_record(record: Mapping[str, object]) -> tuple[dict[str, object | None], frozenset[str]]:
    profile = record.get("profile") or {}
    if not isinstance(profile, Mapping):
        profile = {}
    location = profile.get("location") or {}
    if not isinstance(location, Mapping):
        location = {}
    company = profile.get("company") or {}
    if not isinstance(company, Mapping):
        company = {}
    mapped: dict[str, object | None] = {
        "source_lane": "class_c_public_profile",
        "identifier": profile.get("identifier"),
        "full_name": profile.get("full_name"),
        "first_name": profile.get("first_name"),
        "title": profile.get("title"),
        "location": location.get("default"),
        "company_name": company.get("name"),
        "company_profile_ref": company.get("linkedin_url", company.get("profile_ref")),
    }
    return mapped, frozenset(
        key for key, value in mapped.items() if key != "source_lane" and value is not None
    )


def _validate_raw_response(raw: object) -> Mapping[str, object]:
    """Reject incomplete responses before the executor can settle a credit."""
    if not isinstance(raw, Mapping):
        raise ValueError("apify_invalid_response")
    status = raw.get("status")
    if status not in {"success", "not_found", "error"}:
        raise ValueError("apify_invalid_response")
    required = {"url", "profile", "_metadata"}
    if not required <= raw.keys():
        raise ValueError("apify_invalid_response")
    if not isinstance(raw["url"], str) or not isinstance(raw["profile"], Mapping):
        raise ValueError("apify_invalid_response")
    if not isinstance(raw["_metadata"], Mapping):
        raise ValueError("apify_invalid_response")
    return raw


class ApifyPublicProfileAdapter:
    provider = "apify"
    timeout_seconds = 30
    max_retries = 2

    def __init__(
        self,
        fixture_dir: Path = Path("orgs/prospecting/fixtures/vendor/apify"),
        transport: Callable[..., Mapping[str, object]] | None = None,
        fixture_name: str = "profile-success.json",
    ) -> None:
        self.fixture_dir = fixture_dir
        self.transport = transport
        self.fixture_name = fixture_name
        self._results: dict[str, VendorResult] = {}

    def max_cost(self, operation: str) -> int:
        if operation != "profile_batch":
            raise ValueError("apify_unknown_operation")
        return 1

    def queue(
        self, connection, *, campaign_id: str, person_id: str, policy_hash: str,
        request_id: str, now: str = "2026-09-03T00:00:00Z",
    ) -> str:
        """Build an opaque executor request; this method never invokes a transport."""
        return queue_vendor_lookup(
            connection, campaign_id=campaign_id, person_id=person_id, provider=self.provider,
            vendor_operation="profile_batch", payload={}, policy_hash=policy_hash,
            request_id=request_id, adapter=self, now=now,
        )

    def _execute(
        self, reservation: CreditReservation, operation: str, payload: Mapping[str, object],
        idempotency_key: str,
    ) -> VendorResult:
        if reservation.provider != self.provider or not reservation.exec_request_id:
            raise ValueError("apify_unreserved_call")
        if idempotency_key in self._results:
            return self._results[idempotency_key]
        if operation != "profile_batch":
            raise ValueError("apify_unknown_operation")
        if set(payload) != {"profileUrls", "includeCompanyDetails"} or payload["includeCompanyDetails"] is not False:
            raise ValueError("apify_invalid_input_shape")
        urls = payload["profileUrls"]
        if not isinstance(urls, list) or not 1 <= len(urls) <= 5000 or any(not isinstance(url, str) for url in urls):
            raise ValueError("apify_preselected_profiles_only")
        if os.environ.get("KB_PROSPECTING_NO_NETWORK") == "1":
            raw = json.loads((self.fixture_dir / self.fixture_name).read_text(encoding="utf-8"))
        else:
            if self.transport is None:
                raise RuntimeError("apify_transport_unavailable")
            raw = self.transport(APIFY_ACTOR, payload, idempotency_key, self.timeout_seconds)
        raw = _validate_raw_response(raw)
        status = raw["status"]
        state = "valid" if status == "success" else "not_found" if status == "not_found" else "error"
        result = VendorResult(state, 1 if state == "valid" else 0, (raw,))
        self._results[idempotency_key] = result
        return result
