from __future__ import annotations

import importlib.util
import io
import json
import sys
from pathlib import Path

import pytest
from PIL import Image


EXPAND = Path(__file__).resolve().parents[1]
MODULE_PATH = EXPAND / "local_conditioning_crop.py"


def load_module():
    spec = importlib.util.spec_from_file_location("local_conditioning_crop_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def source(tmp_path, monkeypatch):
    module = load_module()
    repo = tmp_path / "repo"
    path = repo / "orgs" / "figment" / "personas" / "creator-001" / "anchors" / "g01.jpg"
    path.parent.mkdir(parents=True)
    image = Image.new("RGB", (1408, 768), (12, 34, 56))
    image.paste((220, 40, 30), (512, 17, 896, 401))
    image.save(path, format="JPEG", quality=95)
    monkeypatch.setattr(module, "CANONICAL_SHA256", module._bounded_file_hash(path))
    return module, repo, path


def test_offline_plan_binds_frozen_source_without_materializing(source):
    module, repo, path = source
    plan = module.offline_plan(repo)
    assert plan["mode"] == "offline-plan-only"
    assert plan["materialized"] is False and plan["not_promotable"] is True
    assert plan["source"]["sha256"] == module._bounded_file_hash(path)
    assert plan["derivation"]["box"] == [512, 17, 896, 401]
    assert not list(repo.rglob("g01-face384-crop-v1.png"))


def test_materialization_uses_original_pixels_exact_box_and_deterministic_png(source, tmp_path):
    module, _repo, path = source
    private = tmp_path / "private"; private.mkdir()
    output = private / "figment-local-conditioning-crop-test"
    record = module.materialize_crop(path, module._bounded_file_hash(path), (1408, 768), private, output)
    target = output / module.CROP_NAME
    with Image.open(path) as original, Image.open(target) as crop:
        expected = original.convert("RGB").crop(module.CROP_BOX)
        assert crop.format == "PNG" and crop.mode == "RGB" and crop.size == (384, 384)
        assert crop.tobytes() == expected.tobytes()
    assert record["derivation"]["resize"] is False
    assert record["output"]["sha256"] == module._bounded_file_hash(target)


def test_materialization_refuses_mutated_source_and_existing_output(source, tmp_path):
    module, _repo, path = source
    private = tmp_path / "private"; private.mkdir()
    expected = module._bounded_file_hash(path)
    existing = private / "figment-local-conditioning-crop-existing"; existing.mkdir()
    with pytest.raises(module.ConditioningCropError, match="fresh"):
        module.materialize_crop(path, expected, (1408, 768), private, existing)
    path.write_bytes(b"changed")
    with pytest.raises(module.ConditioningCropError, match="hash mismatch"):
        module.materialize_crop(path, expected, (1408, 768), private, private / "figment-local-conditioning-crop-mutated")


def test_materialization_refuses_out_of_bounds_box_and_reparse_output(source, tmp_path, monkeypatch):
    module, _repo, path = source
    private = tmp_path / "private"; private.mkdir()
    monkeypatch.setattr(module, "CROP_BOX", (0, 0, 385, 384))
    with pytest.raises(module.ConditioningCropError, match="384 square"):
        module.materialize_crop(path, module._bounded_file_hash(path), (1408, 768), private,
                                private / "figment-local-conditioning-crop-bounds")
    monkeypatch.setattr(module, "CROP_BOX", (512, 17, 896, 401))
    output = private / "figment-local-conditioning-crop-reparse"
    original = module._is_reparse
    monkeypatch.setattr(module, "_is_reparse", lambda candidate: candidate == output or original(candidate))
    with pytest.raises(module.ConditioningCropError, match="containment"):
        module.materialize_crop(path, module._bounded_file_hash(path), (1408, 768), private, output)


def test_paired_workflows_have_only_node_two_loadimage_delta(source):
    module, _repo, _path = source
    baseline = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "pinned.safetensors"}},
        "2": {"class_type": "LoadImage", "inputs": {"image": "g01.jpg"}},
        "9": {"class_type": "KSampler", "inputs": {"seed": 481516234, "steps": 24}},
    }
    pair = module.paired_workflows(baseline)
    assert pair["full"]["2"]["inputs"]["image"] == "g01.jpg"
    assert pair["crop"]["2"]["inputs"]["image"] == module.CROP_NAME
    normalized = json.loads(json.dumps(pair["crop"]))
    normalized["2"]["inputs"]["image"] = "g01.jpg"
    assert normalized == pair["full"]
    bad = {"2": {"class_type": "LoadImage", "inputs": {"image": "other.jpg"}}}
    with pytest.raises(module.ConditioningCropError, match="g01"):
        module.paired_workflows(bad)
