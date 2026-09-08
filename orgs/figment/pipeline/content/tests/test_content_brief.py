from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

import orgs.figment.pipeline.content.content_brief as compiler
from orgs.figment.pipeline.content.content_brief import ContentBriefError, build_content_brief, main


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _root(tmp_path: Path) -> Path:
    root = tmp_path / "brief-root"
    persona = root / "personas" / "creator-001"
    anchors = persona / "anchors"
    anchors.mkdir(parents=True)
    (anchors / "g01.jpg").write_bytes(b"canonical-anchor")
    (persona / "persona.yaml").write_text(json.dumps({
        "id": "creator-001", "identity": {"references": ["anchors/g01.jpg"]},
    }), encoding="utf-8")
    return root


def _request(**changes: object) -> dict:
    result = {
        "schema": "figment/content-brief-request@1",
        "brief_date": "2026-09-08",
        "creator": {"id": "creator-001", "persona_path": "personas/creator-001/persona.yaml", "canonical_reference": "anchors/g01.jpg"},
        "surface": "carousel",
        "template_id": "CT-2",
        "asset_slots": [
            {"taxonomy_type": "A", "kind": "persona"},
            {"taxonomy_type": "A", "kind": "persona"},
        ],
        "sources": [{"citation": "https://example.test/research", "observed_date": "2026-09-07"}],
        "hypothesis": "A two-frame payoff gives a concise outfit comparison.",
        "intended_metric": "saves per reached account",
        "observed_metrics": None,
    }
    result.update(changes)
    return result


def _write_request(root: Path, request: dict) -> None:
    (root / "request.json").write_text(json.dumps(request), encoding="utf-8")


def test_compiles_carousel_with_exact_local_lineage_and_null_metrics(tmp_path: Path):
    root = _root(tmp_path)
    (root / "out").mkdir()
    _write_request(root, _request())
    result = build_content_brief(root, "request.json", "out/brief.json")
    saved = json.loads((root / "out" / "brief.json").read_text(encoding="utf-8"))
    anchor = root / "personas/creator-001/anchors/g01.jpg"
    assert saved == result
    assert result["observed_metrics"] is None
    assert result["creator"]["canonical_reference"]["sha256"] == _sha(anchor)
    assert result["creator"]["canonical_reference"]["path"] == "personas/creator-001/anchors/g01.jpg"
    assert result["content"]["template_id"] == "CT-2"
    assert [item["kind"] for item in result["content"]["required_asset_slots"]] == ["persona", "persona"]


def test_compiles_reel_with_motion_persona_slot(tmp_path: Path):
    root = _root(tmp_path)
    _write_request(root, _request(surface="reel", template_id="RT-1", asset_slots=[{"taxonomy_type": "G", "kind": "persona"}]))
    result = build_content_brief(root, "request.json", "out.json")
    assert result["content"]["required_asset_slots"] == [{"index": 1, "role": "motion", "taxonomy_type": "G", "kind": "persona"}]


@pytest.mark.parametrize("changes", [
    {"observed_metrics": {"saves": 100}},
    {"approval": "granted"},
    {"template_id": "CT-99"},
    {"asset_slots": [{"taxonomy_type": "B", "kind": "persona"}]},
    {"sources": [{"citation": "http://example.test", "observed_date": "bad"}]},
])
def test_rejects_invented_results_claims_and_invalid_template_inputs(tmp_path: Path, changes: dict):
    root = _root(tmp_path)
    _write_request(root, _request(**changes))
    with pytest.raises(ContentBriefError):
        build_content_brief(root, "request.json", "out.json")
    assert not (root / "out.json").exists()


def test_rejects_traversal_symlink_and_existing_output(tmp_path: Path):
    root = _root(tmp_path)
    _write_request(root, _request())
    with pytest.raises(ContentBriefError, match="relative"):
        build_content_brief(root, "../request.json", "out.json")
    linked = root / "linked-request.json"
    try:
        os.symlink(root / "request.json", linked)
    except OSError as exc:
        pytest.skip(f"symlink unavailable: {exc}")
    with pytest.raises(ContentBriefError, match="link"):
        build_content_brief(root, "linked-request.json", "out.json")
    root_link = tmp_path / "linked-root"
    os.symlink(root, root_link, target_is_directory=True)
    with pytest.raises(ContentBriefError, match="reparse"):
        build_content_brief(root_link, "request.json", "root-out.json")
    (root / "out.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ContentBriefError, match="fresh"):
        build_content_brief(root, "request.json", "out.json")


def test_rejects_drive_relative_path_and_oversized_canonical_reference(tmp_path: Path, monkeypatch):
    root = _root(tmp_path)
    _write_request(root, _request(creator={
        "id": "creator-001", "persona_path": "C:persona.yaml", "canonical_reference": "anchors/g01.jpg",
    }))
    with pytest.raises(ContentBriefError, match="canonical creator persona"):
        build_content_brief(root, "request.json", "out.json")
    _write_request(root, _request())
    monkeypatch.setattr(compiler, "MAX_REFERENCE_BYTES", 4)
    with pytest.raises(ContentBriefError, match="canonical_reference"):
        build_content_brief(root, "request.json", "out.json")


def test_rejects_request_controlled_persona_path_or_self_referential_reference(tmp_path: Path):
    root = _root(tmp_path)
    _write_request(root, _request(creator={
        "id": "creator-001", "persona_path": "personas/creator-001/copy.yaml", "canonical_reference": "anchors/g01.jpg",
    }))
    with pytest.raises(ContentBriefError, match="canonical creator persona"):
        build_content_brief(root, "request.json", "out.json")
    persona = root / "personas/creator-001/persona.yaml"
    persona.write_text(json.dumps({
        "id": "creator-001", "identity": {"references": ["persona.yaml"]},
    }), encoding="utf-8")
    _write_request(root, _request(creator={
        "id": "creator-001", "persona_path": "personas/creator-001/persona.yaml", "canonical_reference": "persona.yaml",
    }))
    with pytest.raises(ContentBriefError, match="anchors"):
        build_content_brief(root, "request.json", "out.json")


def test_cli_writes_only_a_fresh_bounded_record(tmp_path: Path):
    root = _root(tmp_path)
    _write_request(root, _request())
    assert main(["--root", str(root), "--request", "request.json", "--out", "brief.json"]) == 0
    assert json.loads((root / "brief.json").read_text(encoding="utf-8"))["schema"] == "figment/content-brief@1"
