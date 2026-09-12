"""Verified P1 interfaces and schema surfaces consumed by P2."""

from __future__ import annotations


P1_STORE_FUNCTION_PARAMS: dict[str, tuple[str, ...]] = {
    "open_store": ("path",),
    "reserve_credit": ("connection", "reservation"),
    "settle_credit": ("connection", "reservation_id", "actual_cost", "settled_at"),
    "release_credit": ("connection", "reservation_id", "released_at"),
    "insert_exec_request": ("connection", "request", "campaign_tier", "now"),
    "insert_source_observation": ("connection", "observation"),
}

P2_WRITABLE_COLUMNS: dict[str, tuple[str, ...]] = {
    "company": (
        "company_id", "name", "website_url", "linkedin_url", "one_line_summary",
        "industry", "location", "source_lane", "dedupe_key",
    ),
    "person": (
        "person_id", "first_name", "full_name", "linkedin_url", "location",
        "one_line_blurb", "source_lane", "dedupe_key",
    ),
    "contact_point": (
        "contact_id", "person_id", "employer_company_id", "email", "provider",
        "adapter_version", "retrieved_at", "verified_at", "state", "confidence",
        "bounce_history",
    ),
    "source_observation": (
        "observation_id", "entity_type", "entity_id", "field", "value", "source",
        "seen_at", "retrieved_at", "confidence", "snapshot_id",
    ),
    "provider_attempt": (
        "attempt_id", "person_id", "provider", "call", "input_hash", "priority",
        "credits", "result", "started_at", "finished_at", "raw_response_ref",
    ),
    "credit_reservation": (
        "reservation_id", "campaign_id", "provider", "exec_request_id", "max_cost",
        "actual_cost", "state", "created_at", "settled_at",
    ),
    "source_snapshot": (
        "snapshot_id", "entity_id", "source_url", "source_domain", "retrieved_at",
        "content_type", "content_sha256", "allowlist_version", "body_ref", "expires_at",
        "retention_delete_at",
    ),
    "lane_cursor": ("lane", "cursor", "updated_at"),
}
