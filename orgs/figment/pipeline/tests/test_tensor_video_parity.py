"""Module08 source-normalized graph tests, not runtime execution proof.

DynamicCombo encoding and dependencies are source/metadata verified; installed
runtime compatibility and executed-movie provenance remain production blockers. No network, models, or fabricated hashes.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
SOURCE = PIPELINE.parent / "research/10sorlabs-package/08_motion_control"
DIGESTS = {
    "10sorlabs_motion_control.json": "1241dbe6572fdd4d77350a4bb748f9bf704eebe7a47e4af6e247f9fad8a2fc2a",
    "motion_control_models.bat": "3e423bc32ec0db0c3303d3e9cb975623e759c2564eada97213dba87831c0e9dc",
    "extract_first_frame.bat": "cadac3273fdf54f6a0df2a21d9fdf3f421bc5e3716c100e353e0f1ac1770fe12",
    "transcript.txt": "2b8aab0cab495d1443dabd40311d00ebbab5928f4fa4bb4348b23c35fb902d37",
}
spec = importlib.util.spec_from_file_location("tensor_video_parity_test", PIPELINE / "tensor_video_parity.py")
assert spec and spec.loader
tp = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = tp
spec.loader.exec_module(tp)


def workflow():
    return json.loads((PIPELINE / "video/tensor_video_m08_api.json").read_text(encoding="utf-8"))


def manifest():
    result = tp.video_pin_group()
    result["jobs"] = [{"seed": 123, "output_name": "synthetic-video-01", "substitutions": [],
                       "output_contract": {"schema": "figment/comfy-output-contract@1", "outputs": [{
                           "node_id": "49", "role": "video", "media_type": "video/mp4", "count": 1,
                           "max_bytes": 536870912, "workflow_png": False}]}}]
    result["seed_fields"] = ["seed"]
    return result


@pytest.mark.parametrize("name,digest", DIGESTS.items())
def test_required_source_digests(name, digest):
    assert hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() == digest


def test_all_source_edges_widgets_and_types_survive_normalization():
    graph = json.loads((SOURCE / "10sorlabs_motion_control.json").read_text(encoding="utf-8"))
    nodes = {str(n["id"]): n for n in graph["nodes"]}
    links = {link[0]: link for link in graph["links"]}
    actual = workflow()
    assert set(actual) == set(nodes) - {"117", "118", "123", "124"}
    for node_id, exported in actual.items():
        node = nodes[node_id]
        assert exported["class_type"] == node["type"]
        fields = [i["name"] for i in node["inputs"] if "widget" in i]
        values = node.get("widgets_values", [])
        if isinstance(values, dict):
            assert node_id in {"49", "113"}
            assert set(values) == set(fields) | {"videopreview"}
            expected = {key: values[key] for key in fields}
        else:
            values = list(values)
            if node_id == "3":
                assert values.pop(1) == "fixed"
            assert len(fields) == len(values)
            expected = dict(zip(fields, values))
        for item in node["inputs"]:
            if item.get("link") is not None:
                _, src, slot, *_ = links[item["link"]]
                expected[item["name"]] = [str(src), slot]
        if node_id == "58":
            expected.pop("upload")
            expected["image"] = "__START_IMAGE__"
        if node_id == "113":
            expected["video"] = "__DRIVING_VIDEO__"
        if node_id == "6":
            expected["text"] = "__VIDEO_PROMPT__"
        assert exported["inputs"] == expected, node_id
        # bool and int compare equal in Python; API field types still matter.
        for field, value in expected.items():
            assert type(exported["inputs"][field]) is type(value), (node_id, field)


def test_dynamic_combo_is_explicitly_source_only_and_previews_do_not_leak():
    graph = workflow()
    assert graph["102"]["inputs"]["resize_type"] == "scale total pixels"
    assert graph["102"]["inputs"]["resize_type.megapixels"] == 0.5
    assert graph["103"]["inputs"]["resize_type.multiple"] == 32
    for node in ("102", "103"):
        assert "source-verified flat dotted fields" in graph[node]["_meta"]["runtime_schema_status"]
        assert "runtime execution unproved" in graph[node]["_meta"]["runtime_schema_status"]
    text = json.dumps(graph)
    assert "videopreview" not in text and "/home/nomax" not in text
    assert "SCAIL-2_00016" not in text


def test_graph_checker_and_exact_bound_media():
    graph, pins = workflow(), manifest()
    assert tp.video_workflow() == graph
    assert tp.check_video(graph, pins) == []
    graph["58"]["inputs"]["image"] = "accepted-frame0.png"
    graph["113"]["inputs"]["video"] = "synthetic-drive.mp4"
    graph["6"]["inputs"]["text"] = "An adult in a plain shirt raises one hand."
    kwargs = dict(start_image="accepted-frame0.png", driving_video="synthetic-drive.mp4",
                  prompt=graph["6"]["inputs"]["text"])
    assert tp.check_video(graph, pins, **kwargs) == []
    kwargs["start_image"] = "other-clip-frame0.png"
    assert tp.check_video(graph, pins, **kwargs)


@pytest.mark.parametrize("node,field,value", [
    ("101", "width", 512), ("101", "height", 896),
    ("101", "pose_video", ["103", 0]), ("101", "reference_image", ["113", 0]),
    ("107", "driving_track_data", ["116", 0]), ("107", "ref_track_data", ["112", 0]),
    ("101", "clip_vision_output", ["110", 0]), ("101", "replacement_mode", True),
    ("107", "replacement_mode", 0), ("101", "length", 80),
    ("113", "frame_load_cap", 80), ("113", "force_rate", 24),
    ("113", "skip_first_frames", 1), ("113", "select_every_nth", 2),
    ("49", "frame_rate", 24), ("49", "save_metadata", False),
    ("49", "save_output", 1), ("49", "format", "image/gif"),
    ("49", "pix_fmt", "yuv420p10le"), ("49", "crf", 23),
    ("102", "resize_type.megapixels", 1.0), ("103", "resize_type.multiple", 16),
    ("102", "scale_method", "lanczos"), ("103", "resize_type", {"value": "scale to multiple"}),
    ("3", "seed", 124), ("3", "steps", 4), ("3", "cfg", 2),
    ("3", "sampler_name", "euler_ancestral"), ("48", "shift", 3),
    ("96", "strength_model", 0.6), ("110", "ckpt_name", "other.safetensors"),
    ("7", "text", "translated or shortened negative"), ("109", "text", "face"),
])
def test_typed_widget_and_topology_mutations_fail(node, field, value):
    graph = workflow()
    graph[node]["inputs"][field] = value
    assert tp.check_video(graph, manifest())


@pytest.mark.parametrize("node", ["49", "56", "57", "107", "112", "116", "110"])
def test_missing_branch_or_output_fails(node):
    graph = workflow()
    del graph[node]
    assert tp.check_video(graph, manifest())


def test_job_cannot_override_negative_masks_or_fixed_seed():
    pins = manifest()
    pins["jobs"][0]["substitutions"] = [{"node_id": "7", "field": "text", "value": "changed"}]
    assert tp.check_video(workflow(), pins)
    pins = manifest()
    pins["jobs"][0]["seed"] = 999
    assert tp.check_video(workflow(), pins)


def test_extra_output_and_missing_checkpoint_pin_fail():
    graph, pins = workflow(), manifest()
    graph["999"] = {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "extra"}}
    assert tp.check_video(graph, pins)
    pins["models"] = [m for m in pins["models"] if not m["filename"].endswith("sam3.1_multiplex_fp16.safetensors")]
    assert tp.check_video(workflow(), pins)


def test_source_only_video_cannot_be_runtime_ready():
    assert tp.video_readiness_problems(manifest())


def test_static_readiness_is_explicit_and_does_not_admit_old_runtime_or_fixture():
    value = manifest()
    value["comfyui"] = {"git_ref": tp.VIDEO_RUNTIME_COMMIT, "source_url": tp.VIDEO_RUNTIME_SOURCE_URL,
                        "tarball_url": tp.VIDEO_RUNTIME_TARBALL_URL}
    assert tp.video_readiness_problems(value) == []  # Static integrity only.
    value["comfyui"]["git_ref"] = "v0.20.1"
    assert tp.video_readiness_problems(value)
    value["comfyui"]["git_ref"] = tp.VIDEO_RUNTIME_COMMIT
    value["fixture_only"] = True
    assert tp.video_readiness_problems(value)


@pytest.mark.parametrize("field,value", [("repo_id", "other/model"), ("revision", "main"),
                                         ("sha256", "0" * 64), ("destination_dir", "/workspace/other")])
def test_every_model_requires_exact_verified_metadata(field, value):
    for index in range(6):
        value_manifest = manifest()
        value_manifest["models"][index][field] = value
        assert tp.check_video(workflow(), value_manifest)


def test_unused_installer_sam3_dependency_and_unselected_vhs_revision_fail():
    value = manifest()
    value["custom_nodes"].append({"git_url": "https://github.com/PozzettiAndrea/ComfyUI-SAM3.git", "git_ref": "0" * 40})
    assert tp.check_video(workflow(), value)
    value = manifest()
    value["custom_nodes"][0]["git_ref"] = "2984ec4c4b93292421888f38db74a5e8802a8ff8"
    assert tp.check_video(workflow(), value)


def test_pin_inventory_returns_fresh_copies():
    value = tp.video_pin_group()
    value["models"][0]["sha256"] = "0" * 64
    assert tp.video_pin_group()["models"][0]["sha256"] != "0" * 64


def test_shared_video_profile_dispatch_and_runtime_inventory():
    shared_spec = importlib.util.spec_from_file_location("shared_video_dispatch_test", PIPELINE / "tensor_parity.py")
    shared = importlib.util.module_from_spec(shared_spec)
    shared_spec.loader.exec_module(shared)
    pins = json.loads((PIPELINE / "train/tensor-pins.yaml").read_text(encoding="utf-8"))
    assert pins["profiles"]["tensor"]["video"] == ["video_tensor"]
    value = manifest()
    value.update(copy.deepcopy(pins["pins"]["video_tensor"]))
    value["comfyui"] = pins["pod_classes"]["l40s"]["stages"]["video_tensor"]["comfyui"]
    assert shared.video_workflow() == workflow()
    assert shared.check_video(workflow(), value) == []
    assert shared.video_readiness_problems(value) == []  # Static integrity only.


@pytest.mark.parametrize("field,value", [("node_id", "8"), ("role", "preview"),
                                         ("media_type", "image/png"), ("count", 81),
                                         ("count", True), ("max_bytes", 536870913),
                                         ("max_bytes", 0), ("max_bytes", True),
                                         ("workflow_png", "false")])
def test_output_contract_mutations_fail(field, value):
    pins = manifest()
    pins["jobs"][0]["output_contract"]["outputs"][0][field] = value
    assert tp.check_video(workflow(), pins)


def test_explicit_companion_policy_and_no_competing_output_declarations():
    value = manifest()
    assert value["jobs"][0]["output_contract"] == tp.video_output_contract()
    value["jobs"][0]["output_contract"] = tp.video_output_contract(workflow_png=True)
    assert tp.check_video(workflow(), value) == []
    value["jobs"][0]["expected_images"] = 81
    assert tp.check_video(workflow(), value)
    value = manifest()
    value["jobs"][0]["output_contract"]["outputs"].append(
        {"node_id": "8", "role": "preview", "media_type": "image/png", "count": 1,
         "max_bytes": 1024, "workflow_png": False})
    assert tp.check_video(workflow(), value)


def test_changed_source_snapshot_fails_closed(monkeypatch, tmp_path):
    altered = tmp_path / "changed-module08.json"
    altered.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(tp, "VIDEO_GRAPH", altered)
    with pytest.raises(tp.ParityError, match="digest changed"):
        tp.video_workflow()
