from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]


def load():
    spec = importlib.util.spec_from_file_location("local_lora_matched_inference_test", HERE / "local_lora_matched_inference.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


matched = load()
CURRENT = "a" * 64
CONCISE = "b" * 64


def test_exact_prompt_normalizes_only_document_whitespace_and_fixed_seeds():
    assert matched.PROMPT == "Photographic waist-up portrait of a fictional adult woman around twenty-one, turned slightly toward her own right with eyes to camera, wearing a plain opaque black top, in soft daylight against a plain warm off-white wall, figmentlocalg01probe."
    assert matched.SEEDS == (481516234, 90210)


def test_graph_is_core_only_and_lora_uses_installed_loader_keys():
    base = matched.graph("base", matched.SEEDS[0])
    assert {node["class_type"] for node in base.values()} == {"CheckpointLoaderSimple", "CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage"}
    assert all("IPAdapter" not in node["class_type"] and node["class_type"] != "LoadImage" for node in base.values())
    lora = matched.graph("current-20", matched.SEEDS[0], staged_lora_name=matched.SLOTS["current-20"]["filename"])
    loader = lora["2"]
    assert loader["class_type"] == "LoraLoader"
    assert set(loader["inputs"]) == {"model", "clip", "lora_name", "strength_model", "strength_clip"}
    assert loader["inputs"]["strength_model"] == 1.0 and loader["inputs"]["strength_clip"] == 0.0
    assert lora["11"]["inputs"]["images"] == ["7", 0]


def test_manifest_is_ten_row_maximum_with_reused_two_seed_baselines_and_ordered_batches():
    plan = matched.build_manifest(CURRENT, concise_plan_sha256=CONCISE)
    matched.validate_manifest(plan)
    assert len(plan["rows"]) == 10
    assert [batch["stage"] for batch in plan["batches"]] == list(matched.STAGES)
    assert [row["baseline_id"] for row in plan["rows"] if row["stage"] != "base"] == [f"base-seed-{seed}" for _stage in matched.STAGES[1:] for seed in matched.SEEDS]


def refreeze(plan):
    plan["frozen_sha256"] = matched._sha(matched._canonical(plan))


def test_phase_c1_refuses_receipts_and_any_closed_field_tampering():
    plan = matched.build_manifest(CURRENT, concise_plan_sha256=CONCISE)
    with pytest.raises(matched.MatchedInferenceError, match="not implemented"):
        matched.validate_producer_receipt({})
    for mutate in (
        lambda value: value["prompt"].update({"negative": "changed"}),
        lambda value: value["sampler"].update({"steps": 25}),
        lambda value: value.update({"not_promotable": False}),
        lambda value: value["rows"][1].update({"seed": matched.SEEDS[0]}),
        lambda value: value["rows"][2].update({"id": value["rows"][0]["id"]}),
        lambda value: value["batches"][1].update({"stage": "base"}),
    ):
        changed = matched.json.loads(matched.json.dumps(plan))
        mutate(changed); refreeze(changed)
        with pytest.raises(matched.MatchedInferenceError, match="closed C1 manifest"):
            matched.validate_manifest(changed)


def test_manifest_requires_a_concise_plan_hash():
    with pytest.raises(matched.MatchedInferenceError):
        matched.build_manifest(CURRENT, concise_plan_sha256=None)  # type: ignore[arg-type]


def test_graph_refuses_unknown_seed_and_non_basename_lora_name():
    with pytest.raises(matched.MatchedInferenceError):
        matched.graph("base", 0)
    with pytest.raises(matched.MatchedInferenceError):
        matched.graph("current-20", matched.SEEDS[0], staged_lora_name="../adapter.safetensors")
    with pytest.raises(matched.MatchedInferenceError):
        matched.graph("current-20", matched.SEEDS[0], staged_lora_name="figmentlocalg01quality-current-100-step00000050.safetensors")
