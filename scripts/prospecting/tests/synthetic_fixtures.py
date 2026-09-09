"""Load exact, validated synthetic values used by legacy prospecting tests."""

from __future__ import annotations

import json
from pathlib import Path


_FIXTURE = (
    Path(__file__).parents[3]
    / "orgs"
    / "prospecting"
    / "fixtures"
    / "legacy-synthetic.json"
)
_VALUES = json.loads(_FIXTURE.read_text(encoding="utf-8"))


def legacy_fixture(section: str) -> dict[str, object]:
    value = _VALUES.get(section)
    if not isinstance(value, dict):
        raise ValueError("unknown legacy synthetic fixture section")
    return value


__all__ = ["legacy_fixture"]
