"""P6's deliberately narrow Tier-1 send-shape allowlist."""

from __future__ import annotations


ENABLED_SEND_SHAPES = frozenset({
    ("T1", 0, "revision", "send_revision"),
})


def is_p6_send_shape(
    tier: str, step: int, content_kind: str, permitted_action: str,
) -> bool:
    return (tier, step, content_kind, permitted_action) in ENABLED_SEND_SHAPES
