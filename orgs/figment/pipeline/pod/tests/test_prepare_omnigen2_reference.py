from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from orgs.figment.pipeline.pod import runpod_run as harness


ROOT = Path(__file__).resolve().parents[5]
MODULE_PATH = ROOT / "orgs/figment/pipeline/pod/prepare_omnigen2_reference.py"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SPEC = importlib.util.spec_from_file_location("prepare_omnigen2_reference", MODULE_PATH)
assert SPEC and SPEC.loader
prep = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prep)


def test_manifest_has_exact_frozen_models_graphs_and_one_reference_pair():
    manifest = prep.build_manifest()
    frozen_manifest = prep.frozen.build_manifest()
    assert manifest["comfyui"]["git_ref"] == prep.frozen.COMFY_COMMIT
    assert manifest["comfyui"]["tarball_url"] == (
        f"https://codeload.github.com/Comfy-Org/ComfyUI/tar.gz/{prep.frozen.COMFY_COMMIT}"
    )
    assert [model["sha256"] for model in manifest["models"]] == [
        frozen_manifest["models"][kind]["sha256"] for kind in ("diffusion", "clip", "vae")
    ]
    expected_graph = prep.frozen.graph(prep.frozen.SEEDS[0])
    expected_graph[prep.frozen.N_SCALE]["inputs"]["resolution_steps"] = 1
    assert manifest["workflow"] == expected_graph
    assert "resolution_steps" not in prep.frozen.graph(prep.frozen.SEEDS[0])[prep.frozen.N_SCALE]["inputs"]
    assert manifest["provenance"]["adapter_graph_sha256"] == prep.frozen.sha256_of(expected_graph)
    assert [job["seed"] for job in manifest["jobs"]] == list(prep.frozen.SEEDS)
    assert manifest["jobs"][0]["substitutions"] == [{"node_id": prep.frozen.N_LOAD, "field": "image", "value": "omnigen2/g01.jpg"}]
    assert "custom_nodes" not in manifest and all("lora" not in json.dumps(model).lower() for model in manifest["models"])


def test_prepare_stages_exact_reference_under_payload_only(tmp_path):
    source = tmp_path / "admitted-g01.jpg"
    source.write_bytes(b"the admitted reference")
    review_root = tmp_path / "review-root"
    review_root.mkdir()
    expected = hashlib.sha256(source.read_bytes()).hexdigest()
    old_hash = prep.frozen.REFERENCE["sha256"]
    prep.frozen.REFERENCE["sha256"] = expected
    try:
        result = prep.prepare_payload(review_root, reference_path=source)
    finally:
        prep.frozen.REFERENCE["sha256"] = old_hash
    staged = Path(result["reference"])
    payload = Path(result["payload"])
    assert staged.is_relative_to(payload)
    assert staged.read_bytes() == source.read_bytes()
    assert Path(result["manifest"]).is_relative_to(payload)
    assert not (tmp_path / "g01.jpg").exists()


def test_prepare_refuses_wrong_reference_hash(tmp_path):
    source = tmp_path / "wrong.jpg"
    source.write_bytes(b"wrong")
    review_root = tmp_path / "review-root"
    review_root.mkdir()
    with pytest.raises(prep.PreparationError, match="sha256 mismatch"):
        prep.prepare_payload(review_root, reference_path=source)


def test_prepare_refuses_existing_payload_without_overwrite_or_write_through(tmp_path):
    root = tmp_path / "review-root"
    root.mkdir()
    payload = root / prep.PAYLOAD_NAME
    payload.mkdir()
    sentinel = payload / "must-not-change.txt"
    sentinel.write_bytes(b"preserve this")
    with pytest.raises(prep.PreparationError, match="fresh and absent"):
        prep.prepare_payload(root)
    assert sentinel.read_bytes() == b"preserve this"
    assert not (payload / "payload" / "g01.jpg").exists()


def test_prepare_refuses_reparse_destination_before_creating_payload(tmp_path, monkeypatch):
    root = tmp_path / "review-root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "must-not-change.txt"
    sentinel.write_bytes(b"preserve this")
    real_check = prep._is_reparse_or_symlink
    monkeypatch.setattr(prep, "_is_reparse_or_symlink", lambda path: path == root or real_check(path))
    with pytest.raises(prep.PreparationError, match="reparse/symlink"):
        prep.prepare_payload(root)
    assert sentinel.read_bytes() == b"preserve this"
    assert not (root / prep.PAYLOAD_NAME).exists()


def test_default_cli_is_static_and_does_not_prepare(monkeypatch, capsys):
    monkeypatch.setattr(prep, "prepare_payload", lambda *_a, **_kw: pytest.fail("default CLI wrote payload"))
    assert prep.main([]) == 0
    output = json.loads(capsys.readouterr().out)
    assert output["schema"] == prep.SCHEMA
    assert output["status"]["export_authorized"] is False


def test_budget_uses_compatibility_job_formula_and_is_within_recorded_remainder():
    manifest = prep.build_manifest()
    assert prep.minimum_runtime_minutes(manifest) == 60
    assert manifest["max_minutes"] == 60
    assert manifest["proposed_max_usd"] <= manifest["remaining_recorded_usd"]
    assert manifest["max_placement_attempts"] == 1


def test_prepared_manifest_passes_the_existing_harness_schema(tmp_path):
    result = prep.prepare_payload(tmp_path)
    manifest_path = Path(result["manifest"])
    harness.require_manifest(json.loads(manifest_path.read_text(encoding="utf-8")), manifest_path)
