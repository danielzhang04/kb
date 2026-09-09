from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from orgs.figment.pipeline.pod import runpod_run as harness

ROOT = Path(__file__).resolve().parents[5]
PATH = ROOT / "orgs/figment/pipeline/pod/prepare_qwen_reference.py"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("prepare_qwen_reference", PATH)
assert spec and spec.loader
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)


def test_manifest_is_native_non_lightning_official_composite_and_harness_valid():
    manifest = prep.build_manifest()
    graph = manifest["workflow"]
    assert manifest["comfyui"]["git_ref"] == prep.COMFY_COMMIT
    assert manifest["status"]["session_authorization"]["authorized"] is True
    assert manifest["status"]["production_approval"] is False
    assert manifest["provenance"]["official_workflow"]["sha256"] == prep.OFFICIAL_WORKFLOW["sha256"]
    assert [job["seed"] for job in manifest["jobs"]] == list(prep.SEEDS)
    assert len(graph) == 15
    assert graph["149"]["inputs"]["image1"] == ["160", 0]
    assert "image2" not in graph["149"]["inputs"]
    assert graph["151"]["inputs"]["prompt"] == prep.POSITIVE_PROMPT
    assert graph["149"]["inputs"]["prompt"] == prep.NEGATIVE_PROMPT
    assert graph["152"]["inputs"] == {"model": ["145", 0], "strength": 1.0, "pre_cfg": False}
    assert graph["147"]["inputs"]["reference_latents_method"] == "index_timestep_zero"
    assert graph["156"]["inputs"]["pixels"] == ["160", 0]
    assert graph["169"]["inputs"]["latent_image"] == ["156", 0]
    assert graph["169"]["inputs"]["steps"] == 40
    assert manifest["provenance"]["scaled_reference_expected_dimensions"] == [1392, 752]
    assert "LoraLoaderModelOnly" not in {node["class_type"] for node in graph.values()}
    assert len(manifest["static_api_schema_audit"]["contracts"]) == 15
    assert "independently reviewed" in manifest["static_api_schema_audit"]["result"]
    harness.require_manifest(manifest, Path("qwen-manifest.json"), allow_missing_uploads=True)


def test_prepare_is_exact_fresh_contained_staging(tmp_path, monkeypatch):
    source = tmp_path / "g01.jpg"
    source.write_bytes(b"qwen g01")
    monkeypatch.setattr(prep, "REFERENCE_SHA256", hashlib.sha256(source.read_bytes()).hexdigest())
    monkeypatch.setattr(prep, "REFERENCE_BYTES", source.stat().st_size)
    root = tmp_path / "review"
    root.mkdir()
    result = prep.prepare_payload(root, reference_path=source)
    staged = Path(result["reference"])
    assert staged.is_relative_to(Path(result["payload"]))
    assert staged.read_bytes() == source.read_bytes()
    assert json.loads(Path(result["manifest"]).read_text())["status"]["research_only"] is True


def test_prepare_refuses_existing_payload_without_write_through(tmp_path):
    root = tmp_path / "review"
    root.mkdir()
    payload = root / prep.PAYLOAD_NAME
    payload.mkdir()
    sentinel = payload / "keep"
    sentinel.write_bytes(b"unchanged")
    with pytest.raises(prep.PreparationError, match="fresh and absent"):
        prep.prepare_payload(root)
    assert sentinel.read_bytes() == b"unchanged"


def test_default_cli_only_emits_json(monkeypatch, capsys):
    monkeypatch.setattr(prep, "prepare_payload", lambda *_a, **_k: pytest.fail("wrote a payload"))
    assert prep.main([]) == 0
    assert json.loads(capsys.readouterr().out)["schema"] == prep.SCHEMA


def test_budget_formula_includes_two_jobs_and_teardown():
    manifest = prep.build_manifest()
    assert prep.minimum_runtime_minutes(manifest) == 60
    assert manifest["proposed_max_usd"] == 1.30
    assert manifest["max_placement_attempts"] == 1
