"""Module09 parity and U5 branch contract; source proof, not image quality proof.

Requires the ignored source snapshot. Tests do not call models or network. The
driver must bind prompt/checkpoint authority and output-node receipts separately.
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
SOURCE = PIPELINE.parent / "research/10sorlabs-package/09_krea2_image"
GRAPH_SHA = "44d6200d36ae7ea73194451fa6dcf9f6af33767062b43865984e571a9d0b7eb6"
INSTALLER_SHA = "4e47ee8dcd45bb011abd1640e5295fe04d0d97a0900f301aa0ca24d327af0cfc"
DETAIL_SEED = 137053700462745
U5_REMOVED = {"1635", "1636", "1625", "1626", "1637", "1627", "1702"}
sys.path.insert(0, str(PIPELINE))
spec = importlib.util.spec_from_file_location("tensor_stills_parity_test", PIPELINE / "tensor_stills_parity.py")
assert spec and spec.loader
tp = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = tp
spec.loader.exec_module(tp)


def workflow():
    return json.loads((PIPELINE / "train/workflows/tensor_stills_m09_api.json").read_text(encoding="utf-8"))


def expected_variant(framing):
    graph = workflow()
    if framing == "close-up":
        for node in U5_REMOVED:
            del graph[node]
        graph["1611"]["inputs"]["image"] = ["1622", 0]
    return graph


def manifest(framing="full"):
    result = tp.stills_pin_group(framing)
    roles = {"base": "1699", "enhanced": "1703"}
    if framing != "close-up":
        roles["upscaled"] = "1702"
    else:
        result["models"] = [m for m in result["models"] if not m["filename"].endswith("4xNMKDSuperscale_4xNMKDSuperscale.pt")]
    result["output_roles"] = roles
    result["seed_fields"] = ["seed"]
    # Harness assigns each matching seed field, then applies per-node overrides.
    result["jobs"] = []
    for i in range(2):
        subs = [{"node_id": "1611", "field": "seed", "value": DETAIL_SEED}]
        if framing != "close-up":
            subs.append({"node_id": "1637", "field": "seed", "value": 40})
        result["jobs"].append({"seed": 1594 + i, "output_name": f"synthetic-stills-{i}", "substitutions": subs,
                               "output_contract": {"schema": "figment/comfy-output-contract@1", "outputs": [
                                   {"node_id": node, "role": role, "media_type": "image/png", "count": 1,
                                    "max_bytes": 33554432, "workflow_png": False} for role, node in roles.items()]}})
    return result


def test_source_digests_and_ordered_enabled_style_slots():
    raw = (SOURCE / "10sorlabs_krea2_image.json").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == GRAPH_SHA
    assert hashlib.sha256((SOURCE / "krea2_model_installer.bat").read_bytes()).hexdigest() == INSTALLER_SHA
    node = next(n for n in json.loads(raw)["nodes"] if n["id"] == 1633)
    slots = [v for v in node["widgets_values"] if isinstance(v, dict) and "on" in v]
    assert [v["on"] for v in slots] == [False, True, True]
    assert [(v["lora"], v["strength"], v["strengthTwo"]) for v in slots if v["on"]] == [
        ("RealisticSnapshotKrea2.safetensors", 1.5, None), ("pawg_krea2.safetensors", 0.65, None)]


def test_all_effective_source_edges_widgets_and_types():
    source = json.loads((SOURCE / "10sorlabs_krea2_image.json").read_text(encoding="utf-8"))
    nodes = {str(n["id"]): n for n in source["nodes"]}
    links = {edge[0]: edge for edge in source["links"]}
    setters = {n["widgets_values"][0]: n for n in nodes.values() if n["type"] == "SetNode"}
    graph = workflow()
    effective = {key for key, n in nodes.items() if n["type"] not in {
        "SetNode", "GetNode", "Image Comparer (rgthree)", "Power Lora Loader (rgthree)"}}
    assert set(graph) == effective | {"1633", "1633_style2", "1633_identity"}

    def resolve(link):
        _, src, slot, *_ = links[link]
        node = nodes[str(src)]
        if node["type"] == "GetNode":
            return resolve(setters[node["widgets_values"][0]]["inputs"][0]["link"])
        if node["type"] == "SetNode":
            return resolve(node["inputs"][0]["link"])
        return ["1633_identity" if src == 1633 else str(src), slot]

    for node_id in effective:
        source_node = nodes[node_id]
        fields = [item["name"] for item in source_node["inputs"] if "widget" in item]
        values = list(source_node["widgets_values"])
        if node_id in ("1634", "1637"):
            assert values.pop(1) == ("increment" if node_id == "1634" else "fixed")
        elif node_id == "1611":
            assert values.pop(4) == "fixed"
        assert len(fields) == len(values)
        expected = dict(zip(fields, values))
        for item in source_node["inputs"]:
            if item.get("link") is not None:
                expected[item["name"]] = resolve(item["link"])
        if node_id == "1686":
            expected["text"] = "__STILLS_PROMPT__"
        assert graph[node_id]["class_type"] == source_node["type"]
        assert graph[node_id]["inputs"] == expected, node_id
        for field, value in expected.items():
            assert type(graph[node_id]["inputs"][field]) is type(value), (node_id, field)
    for node, model, clip, name, strength in [
        ("1633", "1689", "1687", "RealisticSnapshotKrea2.safetensors", 1.5),
        ("1633_style2", "1633", "1633", "pawg_krea2.safetensors", 0.65),
        ("1633_identity", "1633_style2", "1633_style2", "__IDENTITY_LORA__", 1.0),
    ]:
        assert graph[node] == {"class_type": "LoraLoader", "inputs": {
            "model": [model, 0], "clip": [clip, 1 if clip != "1687" else 0],
            "lora_name": name, "strength_model": strength, "strength_clip": strength}}
    assert graph["1611"]["inputs"]["segm_detector_opt"] == ["1631", 1]
    assert graph["1611"]["inputs"]["sam_mask_hint_use_negative"] == "False"
    dumped = json.dumps(graph)
    assert "Mystic" not in dumped and "high-angle top-down" not in dumped
    assert all(n["class_type"] != "LoadImage" for n in graph.values())


@pytest.mark.parametrize("framing", ["full", "wide", "medium", "close-up"])
def test_exporter_parity_and_no_dangling_edges(framing):
    graph = tp.stills_workflow(framing=framing)
    assert graph == expected_variant(framing)
    assert tp.check_stills(graph, manifest(framing), framing=framing) == []
    for node in graph.values():
        for value in node["inputs"].values():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                assert value[0] in graph
    roles = {n for n, v in graph.items() if v["class_type"] == "SaveImage"}
    assert roles == ({"1699", "1703"} if framing == "close-up" else {"1699", "1702", "1703"})


def test_bound_prompt_and_checkpoint_cannot_be_substituted():
    graph = workflow()
    graph["1686"]["inputs"]["text"] = "Approved synthetic adult portrait scene."
    graph["1633_identity"]["inputs"]["lora_name"] = "fixture-step000001250.safetensors"
    args = dict(prompt=graph["1686"]["inputs"]["text"], identity_lora=graph["1633_identity"]["inputs"]["lora_name"])
    assert tp.check_stills(graph, manifest(), **args) == []
    assert tp.check_stills(graph, manifest(), **{**args, "identity_lora": "other.safetensors"})
    assert tp.check_stills(graph, manifest(), **{**args, "prompt": "Unapproved replacement"})


@pytest.mark.parametrize("node,field,value", [
    ("1633", "strength_model", 1.0), ("1633", "strength_clip", 1.0),
    ("1633_style2", "strength_model", 0.6), ("1633_style2", "clip", ["1687", 0]),
    ("1633_identity", "strength_model", 1.2), ("1633_identity", "strength_clip", 1.2),
    ("1633_identity", "model", ["1633", 0]),
    ("1689", "unet_name", "krea2_raw_bf16.safetensors"), ("1687", "type", "lumina2"),
    ("1634", "negative", ["1686", 0]), ("1611", "negative", ["1617", 0]),
    ("1658", "width", 1024), ("1634", "sampler_name", "euler"),
    ("1637", "seed", 1594), ("1637", "denoise", 0.0),
    ("1611", "seed", 1594), ("1611", "denoise", 0.2),
    ("1611", "guide_size_for", 1), ("1611", "sam_mask_hint_use_negative", False),
    ("1611", "segm_detector_opt", ["1631", 0]), ("1617", "text", "extra look prefix"),
    ("1635", "model_name", "4xNomosWebPhoto_RealPLKSR.safetensors"),
    ("1625", "scale_by", 0.5), ("1625", "upscale_method", "lanczos"),
    ("1702", "images", ["1622", 0]), ("1703", "images", ["1627", 0]),
])
def test_unapproved_recipe_mutations_fail(node, field, value):
    graph = workflow()
    graph[node]["inputs"][field] = value
    assert tp.check_stills(graph, manifest())


@pytest.mark.parametrize("framing", ["full", "close-up"])
def test_fixed_tail_seeds_and_incrementing_main_jobs_are_required(framing):
    graph = expected_variant(framing)
    pins = manifest(framing)
    pins["jobs"][0]["substitutions"] = []
    assert tp.check_stills(graph, pins, framing=framing)
    pins = manifest(framing)
    pins["jobs"][1]["seed"] = 1594
    assert tp.check_stills(graph, pins, framing=framing)


def test_closeup_cannot_restore_upscale_or_lose_face_detailer():
    graph = expected_variant("close-up")
    graph["1635"] = workflow()["1635"]
    assert tp.check_stills(graph, manifest("close-up"), framing="close-up")
    graph = expected_variant("close-up")
    del graph["1611"]
    assert tp.check_stills(graph, manifest("close-up"), framing="close-up")


def test_output_roles_and_job_counts_are_not_filename_order():
    pins = manifest()
    pins["output_roles"]["enhanced"] = "1699"
    assert tp.check_stills(workflow(), pins)
    pins = manifest("close-up")
    pins["jobs"][0]["expected_images"] = 3
    assert tp.check_stills(expected_variant("close-up"), pins, framing="close-up")


def test_swapped_style_order_missing_models_and_broad_pickle_hatch_fail():
    graph = workflow()
    first, second = graph["1633"]["inputs"], graph["1633_style2"]["inputs"]
    for field in ("lora_name", "strength_model", "strength_clip"):
        first[field], second[field] = second[field], first[field]
    assert tp.check_stills(graph, manifest())
    pins = manifest()
    pins["models"].pop()
    assert tp.check_stills(workflow(), pins)
    pins = manifest()
    pins["models"].append(copy.deepcopy(pins["models"][0]))
    assert tp.check_stills(workflow(), pins)
    pins = manifest()
    style = next(m for m in pins["models"] if m["filename"].endswith("RealisticSnapshotKrea2.safetensors"))
    style["pickle_ack"] = "allow every model"
    assert tp.check_stills(workflow(), pins)


def test_unknown_licence_readiness_cannot_be_overridden_by_manifest_labels():
    value = manifest()
    for model in value["models"]:
        model["licence"] = "pretend-cleared"
        model["licence_status"] = "verified"
    problems = tp.stills_readiness_problems(value)
    assert any("RealisticSnapshotKrea2" in problem for problem in problems)
    assert any("pawg_krea2" in problem for problem in problems)
    assert any("RES4LYF" in problem for problem in problems)


def test_closed_output_contract_is_order_independent_but_role_exact():
    value = manifest()
    for job in value["jobs"]:
        job["output_contract"]["outputs"].reverse()
    assert tp.check_stills(workflow(), value) == []
    value["jobs"][0]["output_contract"]["outputs"][0]["node_id"] = "1699"
    assert tp.check_stills(workflow(), value)


def test_noncontiguous_scene_shards_keep_original_main_seed_indices():
    value = manifest()
    for job, scene_index in zip(value["jobs"], (2, 5)):
        job.update(scene_index=scene_index, seed=1594 + scene_index)
    assert tp.check_stills(workflow(), value) == []


def test_unknown_framing_and_changed_source_fail_closed(monkeypatch, tmp_path):
    with pytest.raises(tp.ParityError):
        tp.stills_workflow(framing="auto")
    changed = tmp_path / "changed09.json"
    changed.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(tp, "STILLS_GRAPH", changed)
    with pytest.raises(tp.ParityError, match="digest changed"):
        tp.stills_workflow()
