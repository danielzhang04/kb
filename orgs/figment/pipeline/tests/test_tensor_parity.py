"""Spec 2026-09-29 §9 parity test, phase 1: the tensor passport stage (module 03).
Reads the gitignored 10sorlabs package; fails loudly when it is absent."""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


tp = load_module("figment_tensor_parity_test", PIPELINE / "tensor_parity.py")
PINS = json.loads((PIPELINE / "train" / "tensor-pins.yaml").read_text(encoding="utf-8"))
# Quoted from modules.json, module 03 "Passport photo prompt" -- independent of the
# renderer under test.
HAIR_SLOT = "{long, straight platinum blonde hair}"
EYES_SLOT = "{bright light blue-grey}"
LOOK = {
    "age_stage": "an adult woman in her early twenties",
    "hair": "long, straight platinum blonde hair",
    "eyes": "bright light blue-grey",
    "skin": "fair skin with fine natural texture",
    "brows": "her own natural brows",
    "makeup": "light everyday makeup",
    "build": "slim with an ordinary adult figure",
    "clothing": "wearing a plain grey top, fully opaque and intact",
}


def _workflow() -> dict:
    return json.loads(tp.PASSPORT_WORKFLOW.read_text(encoding="utf-8"))


def _manifest(prompt: str | None = None) -> dict:
    text = prompt if prompt is not None else tp.render_passport_prompt(
        tp.passport_prompt_template(), LOOK["hair"], LOOK["eyes"])
    return {
        "diagnostic_non_commercial": True,
        "models": copy.deepcopy(PINS["pins"]["passport_tensor"]["models"]),
        "jobs": [{"seed": 148 + i, "output_name": f"c003-passport-p{i + 1:02d}",
                  "expected_images": 1,
                  "substitutions": [{"node_id": "4", "field": "text", "value": text}]}
                 for i in range(12)],
    }


def test_widget_values_skip_the_control_after_generate_ui_value():
    graph = json.loads(tp._read_verified(tp.PASSPORT_GRAPH, tp.PASSPORT_GRAPH_SHA256))
    nodes = {n["id"]: n for n in graph["nodes"]}
    sampler = tp._widget_values(nodes[47])
    assert (sampler["seed"], sampler["sampler_mode"], sampler["bongmath"]) == (148, "standard", True)
    detailer = tp._widget_values(nodes[30])
    assert (detailer["steps"], detailer["denoise"], detailer["tiled_decode"]) == (8, 0.4, False)


def test_passport_prompt_fills_only_the_two_slots():
    template = tp.passport_prompt_template()
    assert template.count(HAIR_SLOT) == 1 and template.count(EYES_SLOT) == 1
    rendered = tp.render_passport_prompt(template, LOOK["hair"], LOOK["eyes"])
    assert rendered == template.replace(HAIR_SLOT, LOOK["hair"]).replace(EYES_SLOT, LOOK["eyes"])
    assert "{" not in rendered and "a stunning young woman" in rendered
    with pytest.raises(tp.ParityError):
        tp.render_passport_prompt(template, "{hair}", LOOK["eyes"])


def test_committed_passport_workflow_is_at_parity():
    assert tp.check_passport(_workflow(), _manifest(), LOOK) == []


def _set(path, value):
    def mutate(workflow, manifest):
        node, field = path
        workflow[node]["inputs"][field] = value
    return mutate


def _pin(name, key, value):
    def mutate(workflow, manifest):
        for model in manifest["models"]:
            if Path(model["filename"]).name == name:
                model[key] = value
    return mutate


@pytest.mark.parametrize(("mutate", "expected"), [
    (_set(("30", "denoise"), 0.4), "30.denoise"),
    (_set(("66", "denoise"), 0.27), "66.denoise"),
    (_set(("5", "text"), "a shorter negative"), "5.text"),
    (_set(("102", "strength_clip"), 0.5), "node 102"),
    (_set(("102", "strength"), 0.66), "node 102"),
    (_set(("30", "cycle"), True), "30.cycle"),
    (_set(("30", "model"), ["102", 0]), "topology"),
    (lambda w, m: w.update({"999": {"class_type": "ImageScaleBy", "inputs": {}}}), "extra"),
    (lambda w, m: w.pop("66"), "missing"),
    (_pin("zit_upscaler.safetensors", "sha256", "0" * 64), "installer-stated"),
    (_pin("realistic_snapshot_lora.safetensors", "pickle_ack", "x"), "pickle hatch"),
    (lambda w, m: m["models"].pop(), "models"),
    (lambda w, m: [job.update(seed=job["seed"] + 1) for job in m["jobs"]], "seeds"),
    (lambda w, m: m["jobs"][0]["substitutions"].append(
        {"node_id": "5", "field": "text", "value": "x"}), "job 0"),
    (lambda w, m: m["jobs"][3]["substitutions"][0].update(
        value=LOOK["skin"] + ", " + m["jobs"][3]["substitutions"][0]["value"]), "identity.look.skin"),
])
def test_parity_fails_on_every_unlisted_difference(mutate, expected):
    workflow, manifest = _workflow(), _manifest()
    mutate(workflow, manifest)
    problems = tp.check_passport(workflow, manifest, LOOK)
    assert any(expected in problem for problem in problems), problems
