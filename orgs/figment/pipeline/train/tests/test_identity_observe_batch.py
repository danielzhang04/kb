from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from PIL import Image
import pytest


TRAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRAIN))
import identity_observe as observe  # noqa: E402
import identity_observe_batch as batch  # noqa: E402


def _image(path: Path, value: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (5, 4), (value, value, value)).save(path)


def _sources(tmp_path: Path) -> tuple[tuple[tuple[str, str], ...], tuple[dict, ...]]:
    _image(tmp_path / "anchors/g01.png", 1)
    _image(tmp_path / "candidate.png", 2)
    anchors = (("g01", "anchors/g01.png"),)
    candidates = ({"id": "candidate", "path": "candidate.png", "source_group": "synthetic", "required_anchor_ids": ["g01"]},)
    return anchors, candidates


def test_inventory_hashes_root_relative_inputs_without_starting_observer(tmp_path: Path, monkeypatch):
    anchors, candidates = _sources(tmp_path)
    monkeypatch.setattr(observe, "observe", lambda **_kwargs: (_ for _ in ()).throw(AssertionError("no observer session")))
    result = batch.build_inventory(tmp_path, anchors=anchors, candidates=candidates)
    expected = hashlib.sha256((tmp_path / "candidate.png").read_bytes()).hexdigest()
    assert result["schema"] == batch.SCHEMA
    assert result["observation_status"].startswith("not-run")
    assert result["candidates"][0]["source"] == {"path": "candidate.png", "bytes": (tmp_path / "candidate.png").stat().st_size, "sha256": expected}
    assert result["candidates"][0]["required_anchor_ids"] == ["g01"]
    assert result["not_a_score"] is True and result["not_an_approval"] is True


def test_inventory_writes_only_fresh_root_relative_json(tmp_path: Path):
    anchors, candidates = _sources(tmp_path)
    (tmp_path / "output").mkdir()
    result = batch.write_inventory(tmp_path, "output/inventory.json", anchors=anchors, candidates=candidates)
    written = json.loads((tmp_path / "output/inventory.json").read_text(encoding="utf-8"))
    assert written == result
    with pytest.raises(observe.IdentityObserveError, match="fresh"):
        batch.write_inventory(tmp_path, "output/inventory.json", anchors=anchors, candidates=candidates)
    with pytest.raises(observe.IdentityObserveError, match="root-relative"):
        batch.write_inventory(tmp_path, "../inventory.json", anchors=anchors, candidates=candidates)


def test_inventory_rejects_changed_or_invalid_fixed_sources(tmp_path: Path):
    anchors, candidates = _sources(tmp_path)
    invalid = ({**candidates[0], "required_anchor_ids": ["wrong"]},)
    with pytest.raises(observe.IdentityObserveError, match="anchor set"):
        batch.build_inventory(tmp_path, anchors=anchors, candidates=invalid)
    missing = ({**candidates[0], "path": "missing.png"},)
    with pytest.raises(observe.IdentityObserveError, match="missing"):
        batch.build_inventory(tmp_path, anchors=anchors, candidates=missing)
