from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


HERE = Path(__file__).resolve().parents[1]


def load():
    spec = importlib.util.spec_from_file_location("local_lora_profile_inference_test", HERE / "local_lora_profile_inference.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


profile = load()


def refreeze(plan):
    plan["frozen_sha256"] = profile._sha(profile._canonical(plan))


def test_closed_four_row_manifest_has_only_base_and_current20():
    plan = profile.build_manifest()
    profile.validate_manifest(plan)
    assert plan["schema"] == profile.SCHEMA
    assert plan["not_promotable"] is True
    assert [(row["stage"], row["seed"]) for row in plan["rows"]] == [(stage, seed) for stage in profile.STAGES for seed in profile.SEEDS]
    assert len(plan["rows"]) == 4
    assert [batch["stage"] for batch in plan["batches"]] == list(profile.STAGES)
    assert plan["batches"][1]["requires_profile_base_diagnostic_records"] == ["root", "independent"]
    assert "current-50" not in json.dumps(plan)


def test_each_profile_graph_changes_only_c1_positive_prompt():
    c1 = profile._load_c1()
    for stage in profile.STAGES:
        c1_stage = profile._stage(stage)
        for seed in profile.SEEDS:
            name = None if c1_stage == "base" else c1.SLOTS["current-20"]["filename"]
            original = c1.graph(c1_stage, seed, staged_lora_name=name)
            actual = profile.graph(stage, seed)
            assert profile._without_positive(original, prompt=c1.PROMPT) == profile._without_positive(actual, prompt=profile.PROFILE_PROMPT)
            assert sum(node["inputs"].get("text") == profile.PROFILE_PROMPT for node in actual.values() if node["class_type"] == "CLIPTextEncode") == 1
            assert actual["11"] == original["11"]
            assert actual["5" if c1_stage == "base" else "6"]["inputs"]["seed"] == seed


def test_manifest_reconstruction_rejects_every_closed_field_tamper():
    plan = profile.build_manifest()
    for mutate in (
        lambda value: value["prompt"].update({"negative": "changed"}),
        lambda value: value["sampler"].update({"steps": 25}),
        lambda value: value["rows"][2].update({"stage": "current-50"}),
        lambda value: value["rows"][3]["graph"]["11"]["inputs"].update({"filename_prefix": "changed"}),
        lambda value: value["batches"][1].update({"requires_profile_base_diagnostic_records": []}),
    ):
        changed = json.loads(json.dumps(plan))
        mutate(changed)
        refreeze(changed)
        with pytest.raises(profile.ProfileInferenceError, match="closed C3-B plan"):
            profile.validate_manifest(changed)


def test_graph_refuses_unknown_stage_or_seed_and_c1_source_tampering(tmp_path, monkeypatch):
    with pytest.raises(profile.ProfileInferenceError, match="stage"):
        profile.graph("profile-current-50", profile.SEEDS[0])
    with pytest.raises(profile.ProfileInferenceError, match="seed"):
        profile.graph("profile-base", 0)
    changed = tmp_path / "changed-c1.py"
    changed.write_text("# changed\n")
    monkeypatch.setattr(profile, "C1_PATH", changed)
    with pytest.raises(profile.ProfileInferenceError, match="changed"):
        profile.build_manifest()
