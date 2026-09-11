"""Contract tests for the extracted `_tester_base_workflow` helper.

`_tester_base_workflow` reuses the pinned native Flux Krea2 tester graph for
non-persona images with no LoRA node, and `_tester_workflow` must still
produce byte-identical output to before the extraction.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[4]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"
PERSONAS = ROOT / "orgs" / "figment" / "personas"
MODULE_PATH = PIPELINE / "figment_train.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def command():
    return load_module("figment_train_test_module_base_workflow", MODULE_PATH)


def test_base_workflow_has_no_lora_node_and_correct_connectivity(command):
    graph = command._tester_base_workflow("a plain prompt", "some-prefix")

    assert "4" not in graph
    assert set(graph.keys()) == {"1", "2", "3", "5", "6", "7", "8", "9", "10"}

    assert graph["5"]["class_type"] == "CLIPTextEncode"
    assert graph["5"]["inputs"]["clip"] == ["2", 0]
    assert graph["5"]["inputs"]["text"] == "a plain prompt"

    assert graph["8"]["class_type"] == "KSampler"
    assert graph["8"]["inputs"]["model"] == ["1", 0]
    assert graph["8"]["inputs"]["positive"] == ["5", 0]
    assert graph["8"]["inputs"]["negative"] == ["6", 0]
    assert graph["8"]["inputs"]["latent_image"] == ["7", 0]

    assert graph["6"]["inputs"]["conditioning"] == ["5", 0]
    assert graph["9"]["inputs"]["samples"] == ["8", 0]
    assert graph["9"]["inputs"]["vae"] == ["3", 0]
    assert graph["10"]["inputs"]["images"] == ["9", 0]
    assert graph["10"]["inputs"]["filename_prefix"] == "some-prefix"


def test_base_workflow_uses_native_dimensions_constant(command):
    graph = command._tester_base_workflow("prompt text", "prefix")

    assert graph["7"]["inputs"]["width"] == command.TESTER_NATIVE_DIMENSIONS["width"]
    assert graph["7"]["inputs"]["height"] == command.TESTER_NATIVE_DIMENSIONS["height"]
    assert command.TESTER_NATIVE_DIMENSIONS == {"width": 1448, "height": 2176}


def test_base_workflow_carries_no_persona_prompt_or_trigger(command):
    graph = command._tester_base_workflow("literal prompt only", "prefix")

    assert graph["5"]["inputs"]["text"] == "literal prompt only"
    assert "trigger" not in json.dumps(graph)


def test_base_workflow_key_order_matches_pinned_native_graph(command):
    graph = command._tester_base_workflow("prompt", "prefix")
    assert list(graph.keys()) == ["1", "2", "3", "5", "6", "7", "8", "9", "10"]


def test_tester_workflow_inserts_lora_at_original_position_and_rewires(command):
    persona, training, _pins = command._load_inputs("creator-001", PERSONAS)
    graph = command._tester_workflow(persona, training)

    assert list(graph.keys()) == ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
    assert graph["4"]["class_type"] == "LoraLoader"
    assert graph["4"]["inputs"]["model"] == ["1", 0]
    assert graph["4"]["inputs"]["clip"] == ["2", 0]
    assert graph["5"]["inputs"]["clip"] == ["4", 1]
    assert graph["8"]["inputs"]["model"] == ["4", 0]


def test_tester_workflow_matches_frozen_expected_graph_for_creator001(command):
    """Independently built expected graph (not a second call into the new helper)
    for a real, representative persona/training pair, proving the extraction left
    `_tester_workflow`'s output byte-for-byte unchanged."""
    persona, training, _pins = command._load_inputs("creator-001", PERSONAS)
    creator_id = persona["id"]
    trigger = training["trigger"]
    prompt_text = command._tester_prompt(persona, training)

    expected = {
        "1": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "krea2_turbo_fp8_scaled.safetensors", "weight_dtype": "default",
        }},
        "2": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": "qwen3vl_4b_fp8_scaled.safetensors", "type": "krea2",
            "device": "default",
        }},
        "3": {"class_type": "VAELoader", "inputs": {
            "vae_name": "qwen_image_vae.safetensors",
        }},
        "4": {"class_type": "LoraLoader", "inputs": {
            "lora_name": f"{trigger}.safetensors",
            "strength_model": 1.0,
            "strength_clip": 1.0,
            "model": ["1", 0],
            "clip": ["2", 0],
        }},
        "5": {"class_type": "CLIPTextEncode", "inputs": {
            "text": prompt_text,
            "clip": ["4", 1],
        }},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {
            "conditioning": ["5", 0],
        }},
        "7": {"class_type": "EmptyLatentImage", "inputs": {
            "width": 1448, "height": 2176, "batch_size": 1,
        }},
        "8": {"class_type": "KSampler", "inputs": {
            "seed": 1595,
            "steps": 4,
            "cfg": 1.0,
            "sampler_name": "res_2s",
            "scheduler": "beta",
            "denoise": 1.0,
            "model": ["4", 0],
            "positive": ["5", 0],
            "negative": ["6", 0],
            "latent_image": ["7", 0],
        }},
        "9": {"class_type": "VAEDecode", "inputs": {
            "samples": ["8", 0], "vae": ["3", 0],
        }},
        "10": {"class_type": "SaveImage", "inputs": {
            "filename_prefix": f"{creator_id}-tensor-tester", "images": ["9", 0],
        }},
    }

    graph = command._tester_workflow(persona, training)
    assert graph == expected
    assert json.dumps(graph, sort_keys=True) == json.dumps(expected, sort_keys=True)
    assert list(graph.keys()) == list(expected.keys())
