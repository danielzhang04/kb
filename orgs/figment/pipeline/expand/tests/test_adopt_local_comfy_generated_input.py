from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image


EXPAND = Path(__file__).resolve().parents[1]
MODULE_PATH = EXPAND / "adopt_local_comfy_generated_input.py"


def load_module():
    spec = importlib.util.spec_from_file_location("local_comfy_generated_adopter_test", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


adopt = load_module()


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def image(kind: str, size: tuple[int, int]) -> bytes:
    result = BytesIO(); Image.new(kind, size, (30, 60, 90)).save(result, format="PNG" if kind == "RGB" else "JPEG")
    return result.getvalue()


def fixture(tmp_path: Path) -> tuple[Path, Path, Path, str]:
    private, requests, gallery, repo = tmp_path / "private", tmp_path / "requests", tmp_path / "gallery", tmp_path / "repo"
    for path in (private, requests, gallery, repo / "orgs" / "figment" / "personas" / "creator-001" / "anchors"):
        path.mkdir(parents=True, exist_ok=True)
    canonical = image("RGB", (32, 24)); canonical_path = repo / adopt.CANONICAL; canonical_path.write_bytes(canonical)
    canonical_sha = digest(canonical)
    run = private / "figment-local-comfy-baseline-v3"; (run / "output").mkdir(parents=True)
    output = image("RGB", (1024, 1024)); output_name = "figment-local-comfy-input_00001_.png"; (run / "output" / output_name).write_bytes(output)
    workflow = {"api_prompt": {"1": {"class_type": "SaveImage", "inputs": {}}, "2": {"class_type": "LoadImage", "inputs": {"image": "g01.jpg"}}}}
    positive, negative = "fixture positive", "fixture negative"
    manifest = {
        "schema": adopt.LOCAL_SCHEMA, "diagnostic_only": True,
        "reference": {"repo_path": str(adopt.CANONICAL).replace("\\", "/"), "sole_pixel_reference": True, "sha256": canonical_sha},
        "conditioning": {"name": "full", "materialized": False, "source_filename": "g01.jpg", "derivative": None},
        "models": {name: {"sha256": digest(name.encode())} for name in ("checkpoint", "clip_vision", "ipadapter")},
        "workflow": {**workflow, "sha256": digest(json.dumps(workflow["api_prompt"], sort_keys=True, separators=(",", ":")).encode())},
        "prompt": {"positive": positive, "negative": negative, "sha256": digest((positive + "\n" + negative).encode())}, "launcher": {"sha256": digest(b"launcher")},
    }
    manifest_raw = json.dumps(manifest).encode(); (run / "manifest.json").write_bytes(manifest_raw)
    receipt = {
        "schema": adopt.LOCAL_SCHEMA, "status": "completed", "manifest_sha256": digest(manifest_raw),
        "output": {"filename": output_name, "bytes": len(output), "sha256": digest(output), "dimensions": [1024, 1024]},
        "teardown": {"verified_stopped": True, "unresolved_processes": [], "teardown_errors": []},
    }
    receipt_raw = json.dumps(receipt).encode(); (run / "receipt.json").write_bytes(receipt_raw); (run / "journal.json").write_bytes(receipt_raw)
    dispatch = {"schema": adopt.LOCAL_SCHEMA, "manifest_sha256": digest(manifest_raw), "attempt": 1}; dispatch_raw = json.dumps(dispatch).encode(); (run / "dispatch-attempt.json").write_bytes(dispatch_raw)
    observed_source = {"path": "_private/fixture/output/figment-local-comfy-input_00001_.png",
                       "sha256": digest(output), "bytes": len(output)}
    identity = {"schema": adopt.IDENTITY_SCHEMA, "candidate": {
        "unavailable_reason": "multiple faces detected", "source_before": observed_source,
        "source_after": observed_source}}
    identity_raw = json.dumps(identity).encode(); (run / "identity-fixed640.json").write_bytes(identity_raw)
    request = {
        "schema": adopt.REQUEST_SCHEMA, "request_id": "v3-rejected", "run_name": run.name,
        "manifest_sha256": digest(manifest_raw), "receipt_sha256": digest(receipt_raw), "journal_sha256": digest(receipt_raw), "dispatch_sha256": digest(dispatch_raw), "identity_observation_sha256": digest(identity_raw), "canonical_sha256": canonical_sha,
        "target_name": "g01-local-comfy-baseline-v3.png", "generation_date": "2026-09-08",
        "review": {"status": "rejected-as-same-person-candidate", "training_eligible": False, "identity": "root visual review rejects same-person evidence", "independent_findings": "fixed640 recorded multiple faces; no identity verdict"},
        "source_derivation": {"kind": "sole-canonical-g01", "original_pixel_sha256": canonical_sha, "independent_view": False},
    }
    name = "v3-rejected.json"; (requests / name).write_text(json.dumps(request), encoding="utf-8")
    return private, requests, gallery, repo, name


def test_default_plan_is_offline_and_import_publishes_a_rejected_pair(tmp_path):
    private, requests, gallery, repo, name = fixture(tmp_path)
    planned = adopt.adopt(name, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)
    assert planned["status"] == "planned" and not list(gallery.iterdir())
    result = adopt.adopt(name, do_import=True, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)
    assert result["status"] == "imported"
    record = json.loads((gallery / "g01-local-comfy-baseline-v3.provenance.json").read_text(encoding="utf-8"))
    assert record["review"]["status"] == "rejected-as-same-person-candidate"
    assert record["review"]["training_eligible"] is False
    assert record["generation"]["date_basis"].startswith("root-observed")
    assert record["source"]["derivation"]["independent_view"] is False
    assert set(record["generation"]["model_sha256"]) == {"checkpoint", "clip_vision", "ipadapter"}


def test_fixed640_one_face_raw_observation_is_admitted_without_a_quality_decision(tmp_path):
    private, requests, gallery, repo, name = fixture(tmp_path)
    run = private / "figment-local-comfy-baseline-v3"
    output = (run / "output" / "figment-local-comfy-input_00001_.png").read_bytes()
    source = {"path": "_private/fixture/output/figment-local-comfy-input_00001_.png",
              "sha256": digest(output), "bytes": len(output)}
    identity = {
        "schema": adopt.IDENTITY_SCHEMA,
        "candidate": {"source_before": source, "source_after": source, "unavailable_reason": None,
                      "face": {}, "detector_preprocessing": {"id": adopt.FIXED640_PREPROCESSING, "face_count": 1}},
        "anchors": [{"raw_cosine": value, "unavailable_reason": None} for value in (0.2, 0.4, 0.6)],
    }
    identity_raw = json.dumps(identity).encode(); (run / "identity-fixed640.json").write_bytes(identity_raw)
    request_path = requests / name; request = json.loads(request_path.read_text(encoding="utf-8"))
    request["identity_observation_sha256"] = digest(identity_raw); request_path.write_text(json.dumps(request), encoding="utf-8")
    result = adopt.adopt(name, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)
    assert result["status"] == "planned" and result["not_promotable"] is True
    generation = result["provenance"]["generation"]
    assert generation["identity_observation_sha256"] == digest(identity_raw)
    assert "raw_cosine" not in json.dumps(result["provenance"])
    assert result["provenance"]["review"]["training_eligible"] is False


@pytest.mark.parametrize("mutate", ["before-source", "raw-cosine", "unavailable-shape"])
def test_fixed640_one_face_refuses_unbound_or_incomplete_raw_observation(tmp_path, mutate):
    private, requests, gallery, repo, name = fixture(tmp_path)
    run = private / "figment-local-comfy-baseline-v3"
    output = (run / "output" / "figment-local-comfy-input_00001_.png").read_bytes()
    source = {"path": "_private/fixture/output/figment-local-comfy-input_00001_.png",
              "sha256": digest(output), "bytes": len(output)}
    identity = {
        "schema": adopt.IDENTITY_SCHEMA,
        "candidate": {"source_before": dict(source), "source_after": source, "unavailable_reason": None,
                      "face": {}, "detector_preprocessing": {"id": adopt.FIXED640_PREPROCESSING, "face_count": 1}},
        "anchors": [{"raw_cosine": 0.2, "unavailable_reason": None}],
    }
    if mutate == "before-source":
        identity["candidate"]["source_before"]["sha256"] = "a" * 64
    elif mutate == "raw-cosine":
        identity["anchors"][0]["raw_cosine"] = None
    else:
        identity["candidate"]["unavailable_reason"] = ["multiple faces detected"]
    identity_raw = json.dumps(identity).encode(); (run / "identity-fixed640.json").write_bytes(identity_raw)
    request_path = requests / name; request = json.loads(request_path.read_text(encoding="utf-8"))
    request["identity_observation_sha256"] = digest(identity_raw); request_path.write_text(json.dumps(request), encoding="utf-8")
    with pytest.raises(adopt.AdoptionError, match="identity observation"):
        adopt.adopt(name, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)


@pytest.mark.parametrize("mutate", ["output", "teardown", "identity"])
def test_refuses_changed_run_evidence_without_publishing(tmp_path, mutate):
    private, requests, gallery, repo, name = fixture(tmp_path)
    run = private / "figment-local-comfy-baseline-v3"
    if mutate == "output":
        output_path = run / "output" / "figment-local-comfy-input_00001_.png"
        output_path.write_bytes(output_path.read_bytes() + b"changed")
    elif mutate == "teardown":
        value = json.loads((run / "receipt.json").read_text(encoding="utf-8")); value["teardown"]["verified_stopped"] = False; (run / "receipt.json").write_text(json.dumps(value), encoding="utf-8"); (run / "journal.json").write_text(json.dumps(value), encoding="utf-8")
    else:
        value = json.loads((run / "identity-fixed640.json").read_text(encoding="utf-8")); value["candidate"]["source_after"]["sha256"] = "a" * 64; (run / "identity-fixed640.json").write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(adopt.AdoptionError):
        adopt.adopt(name, do_import=True, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)
    assert not list(gallery.iterdir())


def test_refuses_nonrejected_or_eligible_request_and_collision(tmp_path):
    private, requests, gallery, repo, name = fixture(tmp_path)
    request_path = requests / name; value = json.loads(request_path.read_text(encoding="utf-8")); value["review"]["training_eligible"] = True; request_path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(adopt.AdoptionError, match="rejected"):
        adopt.adopt(name, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)
    value["review"]["training_eligible"] = False; request_path.write_text(json.dumps(value), encoding="utf-8")
    (gallery / value["target_name"]).write_bytes(b"collision")
    with pytest.raises(adopt.AdoptionError, match="fresh"):
        adopt.adopt(name, do_import=True, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)


def test_crop_record_is_explicitly_nonindependent_and_requires_manifest_binding(tmp_path):
    private, requests, gallery, repo, name = fixture(tmp_path)
    request_path = requests / name; value = json.loads(request_path.read_text(encoding="utf-8")); canonical_sha = value["canonical_sha256"]
    value["source_derivation"] = {"kind": "canonical-g01-crop", "original_pixel_sha256": canonical_sha, "crop_sha256": "b" * 64, "crop": {"x": 1, "y": 2, "width": 10, "height": 10}, "independent_view": False}; request_path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(adopt.AdoptionError, match="materialized"):
        adopt.adopt(name, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)


def test_crop_refuses_when_the_preserved_input_raster_is_absent(tmp_path):
    private, requests, gallery, repo, name = fixture(tmp_path)
    run = private / "figment-local-comfy-baseline-v3"; request_path = requests / name
    crop = image("RGB", (10, 10)); crop_sha = digest(crop); manifest = json.loads((run / "manifest.json").read_text(encoding="utf-8"))
    manifest["conditioning"] = {"name": "face-crop384", "materialized": True, "derivative": {"filename": "g01-crop.png", "sha256": crop_sha, "bytes": len(crop), "dimensions": [10, 10]}, "crop_provenance": {"source": {"sha256": manifest["reference"]["sha256"]}, "derivation": {"box": [1, 2, 11, 12]}, "output": {"sha256": crop_sha, "bytes": len(crop), "dimensions": [10, 10]}}}
    manifest["workflow"]["api_prompt"]["2"]["inputs"]["image"] = "g01-crop.png"; manifest["workflow"]["sha256"] = digest(json.dumps(manifest["workflow"]["api_prompt"], sort_keys=True, separators=(",", ":")).encode())
    manifest_raw = json.dumps(manifest).encode(); (run / "manifest.json").write_bytes(manifest_raw)
    receipt = json.loads((run / "receipt.json").read_text(encoding="utf-8")); receipt["manifest_sha256"] = digest(manifest_raw); receipt_raw = json.dumps(receipt).encode(); (run / "receipt.json").write_bytes(receipt_raw); (run / "journal.json").write_bytes(receipt_raw)
    dispatch = {"schema": adopt.LOCAL_SCHEMA, "manifest_sha256": digest(manifest_raw), "attempt": 1}; dispatch_raw = json.dumps(dispatch).encode(); (run / "dispatch-attempt.json").write_bytes(dispatch_raw)
    request = json.loads(request_path.read_text(encoding="utf-8")); request.update({"manifest_sha256": digest(manifest_raw), "receipt_sha256": digest(receipt_raw), "journal_sha256": digest(receipt_raw), "dispatch_sha256": digest(dispatch_raw), "source_derivation": {"kind": "canonical-g01-crop", "original_pixel_sha256": request["canonical_sha256"], "crop_sha256": crop_sha, "crop": {"x": 1, "y": 2, "width": 10, "height": 10}, "independent_view": False}}); request_path.write_text(json.dumps(request), encoding="utf-8")
    with pytest.raises(adopt.AdoptionError, match="materialized local-Comfy crop"):
        adopt.adopt(name, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)


def test_direct_request_refuses_a_crop_conditioning_manifest(tmp_path):
    private, requests, gallery, repo, name = fixture(tmp_path)
    run = private / "figment-local-comfy-baseline-v3"; request_path = requests / name
    manifest = json.loads((run / "manifest.json").read_text(encoding="utf-8"))
    manifest["conditioning"] = {"name": "face-crop384", "materialized": True, "source_filename": "g01.jpg", "derivative": {"sha256": "b" * 64}, "crop_provenance": {"source": {"sha256": manifest["reference"]["sha256"]}, "derivation": {"box": [1, 2, 11, 12]}}}
    manifest_raw = json.dumps(manifest).encode(); (run / "manifest.json").write_bytes(manifest_raw)
    receipt = json.loads((run / "receipt.json").read_text(encoding="utf-8")); receipt["manifest_sha256"] = digest(manifest_raw); receipt_raw = json.dumps(receipt).encode(); (run / "receipt.json").write_bytes(receipt_raw); (run / "journal.json").write_bytes(receipt_raw)
    dispatch = {"schema": adopt.LOCAL_SCHEMA, "manifest_sha256": digest(manifest_raw), "attempt": 1}; dispatch_raw = json.dumps(dispatch).encode(); (run / "dispatch-attempt.json").write_bytes(dispatch_raw)
    request = json.loads(request_path.read_text(encoding="utf-8")); request.update({"manifest_sha256": digest(manifest_raw), "receipt_sha256": digest(receipt_raw), "journal_sha256": digest(receipt_raw), "dispatch_sha256": digest(dispatch_raw)}); request_path.write_text(json.dumps(request), encoding="utf-8")
    with pytest.raises(adopt.AdoptionError, match="direct adoption requires"):
        adopt.adopt(name, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)


def test_known_legacy_v3_shape_uses_its_g01_loadimage_binding(tmp_path, monkeypatch):
    private, requests, gallery, repo, name = fixture(tmp_path)
    run = private / "figment-local-comfy-baseline-v3"; request_path = requests / name
    manifest = json.loads((run / "manifest.json").read_text(encoding="utf-8")); del manifest["conditioning"]
    manifest_raw = json.dumps(manifest).encode(); (run / "manifest.json").write_bytes(manifest_raw)
    receipt = json.loads((run / "receipt.json").read_text(encoding="utf-8")); receipt["manifest_sha256"] = digest(manifest_raw); receipt_raw = json.dumps(receipt).encode(); (run / "receipt.json").write_bytes(receipt_raw); (run / "journal.json").write_bytes(receipt_raw)
    dispatch = {"schema": adopt.LOCAL_SCHEMA, "manifest_sha256": digest(manifest_raw), "attempt": 1}; dispatch_raw = json.dumps(dispatch).encode(); (run / "dispatch-attempt.json").write_bytes(dispatch_raw)
    request = json.loads(request_path.read_text(encoding="utf-8")); request.update({"manifest_sha256": digest(manifest_raw), "receipt_sha256": digest(receipt_raw), "journal_sha256": digest(receipt_raw), "dispatch_sha256": digest(dispatch_raw)}); request_path.write_text(json.dumps(request), encoding="utf-8")
    monkeypatch.setattr(adopt, "LEGACY_V3_FULL_MANIFEST_SHA256", digest(manifest_raw))
    assert adopt.adopt(name, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)["status"] == "planned"


def test_failed_provenance_publish_removes_only_its_owned_png(tmp_path, monkeypatch):
    private, requests, gallery, repo, name = fixture(tmp_path); original = adopt._exclusive_write

    def fail_record(path, data, label):
        if label == "gallery provenance":
            raise adopt.AdoptionError("fixture second publish failure")
        original(path, data, label)

    monkeypatch.setattr(adopt, "_exclusive_write", fail_record)
    with pytest.raises(adopt.AdoptionError, match="fixture second"):
        adopt.adopt(name, do_import=True, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)
    assert not list(gallery.iterdir())


def test_rejects_oversized_dimensions_before_pixel_decode():
    raw = image("RGB", (2048, 1024))
    with pytest.raises(adopt.AdoptionError, match="dimensions or format"):
        adopt._png(raw, "fixture")


def test_refuses_a_reparse_run_root(tmp_path):
    private, requests, gallery, repo, name = fixture(tmp_path)
    run = private / "figment-local-comfy-baseline-v3"; real = private / "real-run"
    run.rename(real); os.symlink(real, run, target_is_directory=True)
    with pytest.raises(adopt.AdoptionError, match="reparse|real directory"):
        adopt.adopt(name, request_root=requests, gallery_root=gallery, workspace_private=private, repo_root=repo)
