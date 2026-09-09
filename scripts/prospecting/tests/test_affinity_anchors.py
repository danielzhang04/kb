"""Synthetic checks for desktop-local sender-anchor loading."""

from __future__ import annotations

import json
from dataclasses import fields
from pathlib import Path

import pytest

from scripts.prospecting.affinity.anchors import SenderAnchors, load_anchors


FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "orgs"
    / "prospecting"
    / "fixtures"
    / "affinity"
    / "sender-anchors-synthetic.json"
)


def _write(tmp_path: Path, payload: dict[str, object]) -> Path:
    path = tmp_path / "sender-anchors.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_heritage_language_can_never_produce_a_signal() -> None:
    anchors = load_anchors(FIXTURE)
    assert not hasattr(anchors, "heritage_language")
    assert "heritage" not in {field.name for field in fields(SenderAnchors)}


def test_alias_match_is_exact_or_full_token_containment_never_fuzzy() -> None:
    anchors = load_anchors(FIXTURE)
    assert anchors.schools.match("  Néwtown  University ") == "newtown university"
    assert anchors.schools.match("Newtown University School of Business") == "newtown university"
    assert anchors.schools.match("Newton University") is None
    assert anchors.employers.match("Meridian Bank, N.A.") == "meridian bank"
    assert anchors.employer_kinds["meridian bank"] == "bank"


def test_unknown_top_level_key_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="anchors_schema"):
        load_anchors(_write(tmp_path, {"schools": [], "surprise": 1}))
