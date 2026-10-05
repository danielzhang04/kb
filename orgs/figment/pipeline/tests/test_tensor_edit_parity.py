"""Module07 source parity; no model, network, paid judge, or pod execution.

The source snapshot is required. Expectations below come from its links/widgets,
not from the production exporter. U12 and U13 are the only recipe overrides.
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
SOURCE = PIPELINE.parent / "research/10sorlabs-package/07_editing_images"
GRAPH_SHA = "0d99bee74c93802d9537cafaa8b80e3ab46df9c2313fc02c60ea9feab3b2905b"
INSTALLER_SHA = "458d1768ede819a441b5405cae47804102800502ef083cdf3d7dd570c70d3d5d"
SWAP = "bfs_head_v1_flux-klein_9b_step3500_rank128.safetensors"
spec = importlib.util.spec_from_file_location("tensor_edit_parity_test", PIPELINE / "tensor_parity.py")
assert spec and spec.loader
tp = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = tp
spec.loader.exec_module(tp)


def workflow():
    return json.loads((PIPELINE / "train/workflows/tensor_edit_m07_api.json").read_text(encoding="utf-8"))


def manifest():
    pins = json.loads((PIPELINE / "train/tensor-pins.yaml").read_text(encoding="utf-8"))
    result = copy.deepcopy(pins["pins"]["edit_tensor"])
    result["jobs"] = [{"seed": 17, "output_name": "synthetic-edit-01", "expected_images": 1,
                       "substitutions": []}]
    result["seed_fields"] = ["noise_seed"]
    return result


def test_source_digests_and_installer_authority():
    raw = (SOURCE / "10sorlabs_image_edit_workflow.json").read_bytes()
    installer = (SOURCE / "image_edit_models.bat").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == GRAPH_SHA
    assert hashlib.sha256(installer).hexdigest() == INSTALLER_SHA
    assert b"black-forest-labs/FLUX.2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors" in installer
    assert ("Alissonerdx/BFS-Best-Face-Swap/resolve/main/" + SWAP).encode() in installer


def test_every_effective_source_edge_and_widget_is_preserved():
    graph = json.loads((SOURCE / "10sorlabs_image_edit_workflow.json").read_text(encoding="utf-8"))
    nodes = {str(n["id"]): n for n in graph["nodes"]}
    links = {link[0]: link for link in graph["links"]}
    actual = workflow()
    # 4 notes, one prompt primitive and two singleton switches are UI-only.
    assert set(actual) == set(nodes) - {"126", "145", "146", "165", "167", "170", "171"}
    for node_id, exported in actual.items():
        source = nodes[node_id]
        assert exported["class_type"] == source["type"]
        values = list(source.get("widgets_values", []))
        if node_id == "103":
            assert values.pop(1) == "randomize"
        fields = [i["name"] for i in source["inputs"] if "widget" in i]
        assert len(fields) == len(values)
        expected = dict(zip(fields, values))
        for item in source["inputs"]:
            if item.get("link") is None:
                continue
            _, src, slot, *_ = links[item["link"]]
            if src in (145, 146):
                incoming = [i["link"] for i in nodes[str(src)]["inputs"] if i.get("link") is not None]
                assert len(incoming) == 1
                _, src, slot, *_ = links[incoming[0]]
            expected[item["name"]] = "__EDIT_PROMPT__" if src == 126 else [str(src), slot]
        if node_id in ("76", "169"):
            expected.pop("upload")
            expected["image"] = "__BASE_IMAGE__" if node_id == "76" else "__IDENTITY_IMAGE__"
        if node_id == "104":  # U12: official installer fp8 weights.
            expected["unet_name"] = "flux-2-klein-9b-fp8.safetensors"
        if node_id == "164":  # U13: head swap, transcript strength1.0.
            expected.update(lora_name=SWAP, strength_model=1.0)
        assert exported["inputs"] == expected, node_id


def test_committed_export_and_bound_request_match_checker():
    graph, pins = workflow(), manifest()
    assert tp.edit_workflow() == graph
    assert tp.check_edit(graph, pins) == []
    graph["76"]["inputs"]["image"] = "fixture-base.png"
    graph["169"]["inputs"]["image"] = "fixture-identity.png"
    graph["113"]["inputs"]["text"] = "Preserve the base framing and replace its head."
    assert tp.check_edit(graph, pins, prompt=graph["113"]["inputs"]["text"],
                         base_image="fixture-base.png", identity_image="fixture-identity.png") == []
    assert tp.check_edit(graph, pins, prompt=graph["113"]["inputs"]["text"],
                         base_image="fixture-identity.png", identity_image="fixture-base.png")


@pytest.mark.parametrize("node,field,value", [
    ("119", "latent", ["121", 0]), ("117", "latent", ["121", 0]),
    ("122", "conditioning", ["113", 0]), ("120", "conditioning", ["114", 0]),
    ("143", "scale_to_length", 1024), ("144", "value", 1024),
    ("107", "width", 1024), ("116", "height", 1024),
    ("111", "type", "lumina2"), ("100", "sampler_name", "euler"),
    ("115", "cfg", 2), ("116", "steps", 8),
    ("164", "strength_model", 2.0), ("164", "lora_name", "breast_slider.safetensors"),
    ("104", "unet_name", "flux-2-klein-9b.safetensors"),
    ("143", "method", "nearest-exact"), ("114", "text", "altered negative"),
])
def test_unlisted_recipe_changes_fail(node, field, value):
    graph = workflow()
    graph[node]["inputs"][field] = value
    assert tp.check_edit(graph, manifest())


@pytest.mark.parametrize("node", ["119", "117", "122", "120", "144", "163"])
def test_missing_effective_nodes_fail(node):
    graph = workflow()
    del graph[node]
    assert tp.check_edit(graph, manifest())


def test_extra_nodes_and_job_topology_overrides_fail():
    graph, pins = workflow(), manifest()
    graph["999"] = {"class_type": "SaveImage", "inputs": {"images": ["102", 0], "filename_prefix": "extra"}}
    assert tp.check_edit(graph, pins)
    pins["jobs"][0]["substitutions"] = [{"node_id": "119", "field": "latent", "value": ["121", 0]}]
    assert tp.check_edit(workflow(), pins)


def test_alternate_model_repository_and_duplicate_pin_fail():
    pins = manifest()
    next(m for m in pins["models"] if m["filename"].endswith("flux-2-klein-9b-fp8.safetensors"))["repo_id"] = "Kiro930/flux-2-klein-9b"
    assert tp.check_edit(workflow(), pins)
    pins = manifest()
    pins["models"].append(copy.deepcopy(pins["models"][0]))
    assert tp.check_edit(workflow(), pins)


def test_unresolved_model_metadata_cannot_be_runtime_ready():
    pins = manifest()
    swap = next(m for m in pins["models"] if m["filename"].endswith(SWAP))
    swap["revision"] = None
    swap["sha256"] = None
    assert tp.edit_readiness_problems(pins)


def test_changed_source_snapshot_fails_closed(monkeypatch, tmp_path):
    altered = tmp_path / "changed-module07.json"
    altered.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(tp, "EDIT_GRAPH", altered)
    with pytest.raises(tp.ParityError, match="digest changed"):
        tp.edit_workflow()


def test_actual_harness_dry_run_accepts_edit_graph_and_pins(tmp_path, monkeypatch):
    """Simulated upload/output plumbing only; no model-execution or approval proof."""
    from PIL import Image

    sys.path.insert(0, str(PIPELINE / "pod"))
    runner_spec = importlib.util.spec_from_file_location("edit_parity_harness_test", PIPELINE / "pod/runpod_run.py")
    assert runner_spec and runner_spec.loader
    runner = importlib.util.module_from_spec(runner_spec)
    sys.modules[runner_spec.name] = runner
    runner_spec.loader.exec_module(runner)
    monkeypatch.setattr(runner, "build_authenticated_session", lambda *_a, **_k: pytest.fail("dry run contacted network"))
    pins = json.loads((PIPELINE / "train/tensor-pins.yaml").read_text(encoding="utf-8"))
    pod = pins["pod_classes"]["l40s"]
    value = manifest()
    value.update({k: copy.deepcopy(pod[k]) for k in ("gpu", "image", "price_usd_per_hour", "volume_mount_path", "max_placement_attempts")})
    value.update(copy.deepcopy(pod["stages"]["edit_tensor"]))
    value["workflow"] = workflow()
    for name, color, node in (("base.png", "blue", "76"), ("identity.png", "green", "169")):
        Image.new("RGB", (32, 32), color).save(tmp_path / name)
        value["workflow"][node]["inputs"]["image"] = name
    value["workflow"]["113"]["inputs"]["text"] = "Synthetic fixture plumbing test."
    value["uploads"] = [{"files": ["base.png", "identity.png"], "type": "input", "overwrite": False, "subfolder": ""}]
    path = tmp_path / "edit.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    assert tp.check_edit(value["workflow"], value, prompt="Synthetic fixture plumbing test.",
                         base_image="base.png", identity_image="identity.png") == []
    out = tmp_path / "dry"
    assert runner.main(["run", "--manifest", str(path), "--out", str(out), "--dry-run"]) == 0
    receipt = json.loads((out / "run.json").read_text(encoding="utf-8"))
    assert receipt["dry_run"] is True and receipt["termination_verified"] is True
    assert (out / "synthetic-edit-01.png").is_file()
