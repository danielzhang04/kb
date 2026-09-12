"""Deterministic desktop-local affinity helpers."""

from __future__ import annotations

from datetime import datetime, timezone


STAMP = "%Y-%m-%dT%H:%M:%SZ"


def as_stamp(value: datetime) -> str:
    """Convert an injected time to the store's UTC timestamp format."""
    return value.astimezone(timezone.utc).strftime(STAMP)


def as_datetime(value: str) -> datetime:
    """Convert a store timestamp to a UTC-aware datetime."""
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
