#!/usr/bin/env python3
"""Plan, run, and grade the persona-driven Figment Track-1 chain.

Planning and grading are local. ``run`` is the only live path and delegates every
pod to pod/runpod_run.py with the exact argv recorded in plan.json. It never retries.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import importlib.util
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PERSONAS_ROOT = ROOT / "orgs" / "figment" / "personas"
POD_RUNNER = HERE / "pod" / "runpod_run.py"
TRAIN_DIR = HERE / "train"
EXPAND_DIR = HERE / "expand"
PINS_PATH = TRAIN_DIR / "tensor-pins.yaml"
PROMPTS_PATH = EXPAND_DIR / "templates" / "tensor-dataset-prompts.yaml"
WORKFLOW_PATH = EXPAND_DIR / "workflows" / "tensor_dataset_v2_api.json"
AI_TEMPLATE_PATH = TRAIN_DIR / "ai-toolkit-krea2.yaml.template"
TRAIN_START_PATH = TRAIN_DIR / "runs" / "start-training-aitoolkit.sh.template"
TESTER_START_PATH = TRAIN_DIR / "runs" / "start-comfy-lorapath.sh.template"
TRAINING_CONFIG_MODULE = HERE / "training_config.py"
RENDER_MODULE = TRAIN_DIR / "render_aitoolkit_config.py"
BUILD_SET_MODULE = TRAIN_DIR / "build_training_set.py"
QA_MODULE = HERE / "qa_stamp.py"
LEDGER_DIR = ROOT / "ledgers" / "cost"
ARC_CAP_USD = "50.00"
ARC_LEDGER_GLOB = "figment-*.tsv"
STAGES = ("dataset", "smoke", "train", "tester")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
KEY_MISMATCH_RE = re.compile(
    r"missing_keys|unexpected_keys|missing key\(s\)|unexpected key\(s\)", re.I,
)
# Matches an "anchors/<filename>" token inside the dataset-prompts template's descriptive
# note, in first-face-then-body order, so the note can be re-templated onto whichever two
# reference filenames the current persona actually has -- never by string-matching
# creator-001's old g01.jpg/g07.jpg literals.
_ANCHOR_FILENAME_RE = re.compile(r"anchors/\S+?\.(?:png|jpe?g|webp)", re.I)

REPLICATION_NOTE = (
    "orgs/figment/research/10sorlabs-package/10_dataset_generator_v2/"
    "10sorlabs_dataset_generator_v2.json (module 10, dataset generator 2.0). "
    "Node mapping, deviations, licences and grading protocol: "
    "orgs/figment/pipeline/expand/TENSOR-REPLICATION.md"
)
PIN_ENFORCEMENT_NOTE = (
    "installer_pin records the commit dataset_generator_model_installer.bat (and, for "
    "KJNodes, krea2_model_installer.bat) checks out. The pod harness clones custom "
    "nodes with `git clone --depth 1` from the default branch and cannot check out a "
    "ref, so these pins are RECORDED, NOT ENFORCED. Tightening this means changing "
    "runpod_run.py, not this file."
)
SHARD_NOTES = (
    "face angles, template rows 1-10 of 15",
    "face angles, template rows 11-15 of 15, then body poses, template rows 1-5 of 15",
    "body poses, template rows 6-15 of 15",
)


class FigmentTrainError(RuntimeError):
    """A plan, live record, or operator ruling failed closed."""


def _load_module(name: str, path: Path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _training_config_module():
    return _load_module("_figment_train_training_config", TRAINING_CONFIG_MODULE)


def _render_module():
    return _load_module("_figment_train_render_config", RENDER_MODULE)


def _build_set_module():
    return _load_module("_figment_train_build_set", BUILD_SET_MODULE)


def _qa_module():
    return _load_module("_figment_train_qa_stamp", QA_MODULE)


def _pod_runner_module():
    return _load_module("_figment_train_pod_runpod_run", POD_RUNNER)


def _read_json(path: Path) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FigmentTrainError(f"cannot read JSON document {path}: {exc}") from exc


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    try:
        temporary.write_text(
            json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _relative(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _creator_output_code(creator_id: str) -> str:
    match = re.fullmatch(r"creator-(\d+)", creator_id)
    if match:
        return "c" + match.group(1)
    return re.sub(r"[^a-z0-9]", "", creator_id.lower())


def _checkpoint_steps(steps: int, save_every: int) -> list[int]:
    return list(range(save_every, steps, save_every))


def _checkpoint_name(trigger: str, step: int | None) -> str:
    return f"{trigger}.safetensors" if step is None else f"{trigger}_{step:09d}.safetensors"


def manifest_ceiling(manifest: dict[str, Any]) -> str:
    estimate = Decimal(str(manifest["price_usd_per_hour"])) * Decimal(
        str(manifest["max_minutes"])
    ) / Decimal(60)
    cents = (estimate * 100).to_integral_value(rounding="ROUND_CEILING") / Decimal(100)
    return f"{cents:.2f}"


def _pod_base(pins: dict[str, Any], pod_class: str, stage: str) -> dict[str, Any]:
    try:
        selected = pins["pod_classes"][pod_class]
        stage_values = selected["stages"][stage]
    except (KeyError, TypeError) as exc:
        raise FigmentTrainError(f"pod class {pod_class!r} has no {stage!r} stage") from exc
    result = {
        "gpu": deepcopy(selected["gpu"]),
        "price_usd_per_hour": selected["price_usd_per_hour"],
        "max_minutes": stage_values["max_minutes"],
        "max_placement_attempts": selected["max_placement_attempts"],
        "container_disk_gb": stage_values["container_disk_gb"],
        "volume_gb": stage_values["volume_gb"],
        "volume_mount_path": selected["volume_mount_path"],
        "image": selected["image"],
    }
    if stage_values.get("avoid_machine_hosts"):
        result["avoid_machine_hosts"] = deepcopy(stage_values["avoid_machine_hosts"])
    result.update({
        "readiness_timeout_seconds": stage_values["readiness_timeout_seconds"],
        "job_timeout_seconds": stage_values["job_timeout_seconds"],
    })
    if "artifact_download_seconds" in stage_values:
        result["artifact_download_seconds"] = stage_values["artifact_download_seconds"]
    result["comfyui"] = deepcopy(stage_values["comfyui"])
    return result


def _load_inputs(creator_id: str, personas_root: Path) -> tuple[dict, dict, dict]:
    persona_path = Path(personas_root) / creator_id / "persona.yaml"
    if not persona_path.is_file():
        raise FigmentTrainError(f"persona not found: {persona_path}")
    try:
        persona = _training_config_module().load_persona_with_training(persona_path)
    except ValueError as exc:
        raise FigmentTrainError(str(exc)) from exc
    if persona.get("id") != creator_id:
        raise FigmentTrainError(
            f"persona.id {persona.get('id')!r} does not match requested creator {creator_id!r}"
        )
    pins = _read_json(PINS_PATH)
    training = persona["training"]
    try:
        pod_price = float(pins["pod_classes"][training["pod_class"]]["price_usd_per_hour"])
    except (KeyError, TypeError, ValueError) as exc:
        raise FigmentTrainError(
            f"unknown training pod class {training['pod_class']!r}"
        ) from exc
    if pod_price > training["price_ceiling_usd_per_hour"]:
        raise FigmentTrainError(
            f"pod class hourly price ${pod_price:.2f} exceeds persona ceiling "
            f"${training['price_ceiling_usd_per_hour']:.2f}"
        )
    return persona, training, pins


def _generalized_prompts(persona: dict) -> dict[str, Any]:
    prompts = _read_json(PROMPTS_PATH)
    references = [Path(value) for value in persona["identity"]["references"]]
    exemplar_stems = list(persona["body_target"].get("exemplars") or [])
    body_ref = next(
        (ref for stem in reversed(exemplar_stems) for ref in references if ref.stem == stem),
        references[-1],
    )
    prompts["persona"] = persona["id"]
    note = prompts["structure"]["prepend_is_the_hand_typed_description"]
    replacements = iter([references[0].as_posix(), body_ref.as_posix()])
    note = _ANCHOR_FILENAME_RE.sub(lambda match: next(replacements, match.group(0)), note)
    prompts["structure"]["prepend_is_the_hand_typed_description"] = note
    return prompts


def _generalized_dataset_workflow(persona: dict, prompts: dict[str, Any]) -> dict[str, Any]:
    workflow = _read_json(WORKFLOW_PATH)
    references = [Path(value) for value in persona["identity"]["references"]]
    exemplar_stems = list(persona["body_target"].get("exemplars") or [])
    body_ref = next(
        (ref for stem in reversed(exemplar_stems) for ref in references if ref.stem == stem),
        references[-1],
    )
    workflow["836"]["inputs"]["image"] = f"{persona['id']}/{references[0].name}"
    workflow["837"]["inputs"]["image"] = f"{persona['id']}/{body_ref.name}"
    workflow["800"]["inputs"]["text"] = prompts["face"]["identity"]
    workflow["780"]["inputs"]["text"] = prompts["body"]["identity"]
    workflow["832"]["inputs"]["filename_prefix"] = f"{persona['id']}-tensor-dataset"
    return workflow


def _dataset_jobs(persona: dict, prompts: dict[str, Any]) -> list[dict[str, Any]]:
    short = _creator_output_code(persona["id"])
    jobs: list[dict[str, Any]] = []
    branches = (
        ("f", "174", "791", "788", 241731167782064, prompts["face"]),
        ("b", "676", "776", "778", 269789944143426, prompts["body"]),
    )
    for label, prompt_node, image_node, seed_node, outer_seed, block in branches:
        for index, row in enumerate(block["rows"], start=1):
            jobs.append({
                "seed": outer_seed,
                "output_name": f"{short}-tds-{label}{index:02d}",
                "expected_images": 1,
                "substitutions": [
                    {"node_id": "832", "field": "images", "value": [image_node, 0]},
                    {"node_id": seed_node, "field": "seed", "value": 1098688918602660},
                    {"node_id": prompt_node, "field": "prompt", "value": block["identity"] + row},
                ],
            })
    return jobs


def _dataset_manifests(
    persona: dict, training: dict, pins: dict, prompts: dict[str, Any],
) -> list[dict[str, Any]]:
    jobs = _dataset_jobs(persona, prompts)
    references = [Path(value).name for value in persona["identity"]["references"]]
    manifests = []
    for index in range(3):
        manifest = {
            "_replicates": REPLICATION_NOTE,
            "_shard": SHARD_NOTES[index],
            "_pin_enforcement": PIN_ENFORCEMENT_NOTE,
            **_pod_base(pins, training["pod_class"], "dataset"),
            "models": deepcopy(pins["pins"]["dataset"]["models"]),
            "custom_nodes": deepcopy(pins["pins"]["dataset"]["custom_nodes"]),
            "workflow": "../workflows/tensor_dataset_v2_api.json",
            "seed_fields": ["seed"],
            "uploads": [{
                "files": [f"_uploads/{persona['id']}/{name}" for name in references],
                "subfolder": persona["id"],
                "type": "input",
                "overwrite": True,
            }],
            "jobs": jobs[index * 10:(index + 1) * 10],
        }
        manifests.append(manifest)
    return manifests


def _training_runtime(trigger: str, caption_mode: str, steps: list[int], final: int) -> dict:
    return {
        "repository": "https://github.com/ostris/ai-toolkit.git",
        "git_ref": "b36bb3998ae596a566d85513299696a3a78f0dcb",
        "trainer_root": "/workspace/ai-toolkit",
        "train_output": "/workspace/train-output",
        "trigger": trigger,
        "config_name": "training.json",
        "caption_mode": caption_mode,
        "caption_word": "woman",
        "caption_model": "Qwen/Qwen3-VL-8B-Instruct",
        "dataset_min_images": 20,
        "checkpoint_steps": " ".join(f"{step:09d}" for step in steps),
        "final_step": f"{final:09d}",
        "hf_home": "/workspace/hf",
        "reinstall_torch": "0",
        "torch_spec": "torch==2.13.0",
        "torchvision_spec": "torchvision==0.28.0",
        "torch_index_url": "https://download.pytorch.org/whl/cu130",
        "ready_marker": f"/workspace/ComfyUI/input/{trigger}/_dataset.ready",
        "complete_marker": "/workspace/output/_training.complete",
        "failed_marker": "/workspace/output/_training.failed",
        "start_script_path": "/workspace/start-training-aitoolkit.sh",
        "start_script_file": "start-training-aitoolkit.sh.template",
    }


def _smoke_note(creator_id: str, trigger: str) -> str:
    return (
        "Findings 13/14 dependency+compatibility smoke for the training stage (not the "
        "module-10 dependency-smoke in expand/). Same image, same trainer pin, same "
        "Krea-2 raw model pin, and the SAME start script "
        f"(start-training-aitoolkit.sh.template) as {creator_id}-tensor-train.yaml, but "
        "training.json is rendered with steps=100/save_every=50 "
        "(render_aitoolkit_config.py --set steps=100 --set save_every=50 --allow-drift) "
        "before this manifest runs, so the pod exercises the identical install -> "
        "torch.cuda -> ai-toolkit import -> Krea raw state-dict load -> N training steps "
        "-> save -> publish -> marker path at minimum cost. training.checkpoint_steps "
        "names the single step-50 intermediate save and training.final_step is 100, a "
        "DIFFERENT step, on purpose: smoke #4 (steps=50/save_every=50, "
        "checkpoint_steps==final_step==50) proved ai-toolkit only ever writes the "
        "step-AT-final under the bare trigger name, never a step-suffixed one, so "
        "aliasing the smoke's one intermediate save onto the final step made the wrapper "
        "look for a step-suffixed final file that could never exist. With final_step > "
        "the one checkpoint_steps entry, the publish logic that copies 7 intermediates "
        "plus a bare final on the full run is exercised at 1+1 instead, with the "
        "intermediate and final genuinely distinct saves. A third artifact, "
        "_training.log, is declared (same wait_for marker, .log is an allowed artifact "
        "suffix per pod/README.md) purely so the harness downloads the full ai-toolkit "
        "stdout/stderr locally — TENSOR-TRAINING.md documents that the full run is gated "
        "on this file showing the state dict loaded without missing/unexpected keys."
    )


def _train_manifest(
    persona: dict, training: dict, pins: dict, *, smoke: bool,
) -> dict[str, Any]:
    creator_id = persona["id"]
    trigger = training["trigger"]
    if smoke:
        final = 100
        intermediates = [50]
        stage = "smoke"
    else:
        final = training["steps"]
        intermediates = _checkpoint_steps(final, training["save_every"])
        stage = "train"
    manifest: dict[str, Any] = {}
    if smoke:
        manifest["_smoke"] = _smoke_note(creator_id, trigger)
    upload_files = [f"{creator_id}-tensor-dataset/*.png"]
    if training["caption_mode"] == "provided":
        upload_files.append(f"{creator_id}-tensor-dataset/*.txt")
    upload_files.append(f"{creator_id}-tensor-dataset/training.json")
    manifest.update(_pod_base(pins, training["pod_class"], stage))
    manifest.update({
        "models": deepcopy(pins["pins"]["train"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["train"]["custom_nodes"]),
        "workflow": {"1": {"class_type": "KSampler", "inputs": {"seed": 100001}}},
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [
            {
                "files": upload_files,
                "subfolder": trigger,
                "type": "input",
                "overwrite": True,
            },
            {
                "files": [f"{creator_id}-tensor-dataset/_dataset.ready"],
                "subfolder": trigger,
                "type": "input",
                "overwrite": True,
            },
        ],
        "training": _training_runtime(
            trigger, training["caption_mode"], intermediates, final,
        ),
        "jobs": [{
            "seed": 100001,
            "output_name": (
                f"training-transport-sentinel-{trigger}-smoke" if smoke
                else f"training-transport-sentinel-{trigger}"
            ),
            "substitutions": [],
            "expected_images": 1,
        }],
        "artifacts": [
            {
                "remote": _checkpoint_name(trigger, step),
                "type": "output",
                "local": _checkpoint_name(trigger, step),
                "wait_for": "_training.complete",
            }
            for step in intermediates
        ] + [{
            "remote": _checkpoint_name(trigger, None),
            "type": "output",
            "local": _checkpoint_name(trigger, None),
            "wait_for": "_training.complete",
        }],
    })
    if smoke:
        manifest["artifacts"].append({
            "remote": "_training.log",
            "type": "output",
            "local": "_training.log",
            "wait_for": "_training.complete",
        })
    return manifest


def _tester_workflow(creator_id: str, trigger: str) -> dict[str, Any]:
    return {
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
            "text": (
                "Close-up portrait photograph of an adult woman in her mid twenties, "
                "shoulders up, facing the camera, neutral relaxed expression with a faint "
                "smile. Natural skin texture with visible pores and fine flyaway hairs, "
                "no retouching. She wears a plain fitted black crew-neck top. Soft even "
                "daylight from a window camera-left, plain warm off-white wall behind her, "
                "shallow depth of field, shot on a phone camera."
            ),
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


def _tester_manifest(persona: dict, training: dict, pins: dict) -> dict[str, Any]:
    creator_id = persona["id"]
    trigger = training["trigger"]
    intermediates = _checkpoint_steps(training["steps"], training["save_every"])
    checkpoints: list[tuple[int | None, str]] = [
        (step, f"{step:09d}") for step in intermediates
    ] + [(None, "final")]
    return {
        **_pod_base(pins, training["pod_class"], "tester"),
        "models": deepcopy(pins["pins"]["tester"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["tester"]["custom_nodes"]),
        "workflow": _tester_workflow(creator_id, trigger),
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [{
            "files": [f"out/{creator_id}-tensor-train/*.safetensors"],
            "subfolder": trigger,
            "type": "input",
            "overwrite": True,
        }],
        "training": {
            "lora_source_dir": f"/workspace/ComfyUI/input/{trigger}",
            "start_script_path": "/workspace/start-comfy-lorapath.sh",
            "start_script_file": "start-comfy-lorapath.sh.template",
        },
        "jobs": [{
            "seed": 1595,
            "output_name": f"{_creator_output_code(creator_id)}-tensor-tester-{label}",
            "expected_images": 1,
            "substitutions": [{
                "node_id": "4",
                "field": "lora_name",
                "value": _checkpoint_name(trigger, step),
            }],
        } for step, label in checkpoints],
    }


def _render_training_config(trigger: str, steps: int, save_every: int) -> dict[str, Any]:
    renderer = _render_module()
    intermediate_count = len(_checkpoint_steps(steps, save_every))
    context = dict(renderer.MODULE_11)
    context.update({
        "trigger": trigger,
        "dataset_dir": f"/workspace/ComfyUI/input/{trigger}",
        "output_dir": "/workspace/train-output",
        "base_model_path": "/workspace/models/krea2/krea2_raw_bf16.safetensors",
        "steps": steps,
        "save_every": save_every,
        "max_step_saves_to_keep": max(15, intermediate_count),
    })
    rendered = renderer.render(AI_TEMPLATE_PATH.read_text(encoding="utf-8"), context)
    config = renderer.yaml.safe_load(rendered)
    try:
        renderer.validate_rendered_pod_paths(config)
    except ValueError as exc:
        raise FigmentTrainError(f"rendered training config is unsafe: {exc}") from exc
    return config


def _copy_support_files(out: Path, persona: dict, prompts: dict, workflow: dict) -> dict[str, Any]:
    expand_workflow = out / "expand" / "workflows" / WORKFLOW_PATH.name
    expand_prompts = out / "expand" / "templates" / PROMPTS_PATH.name
    train_runs = out / "train" / "runs"
    _write_json(expand_workflow, workflow)
    _write_json(expand_prompts, prompts)
    train_runs.mkdir(parents=True, exist_ok=True)
    for source in (TRAIN_START_PATH, TESTER_START_PATH):
        text = source.read_text(encoding="utf-8")
        text = text.replace("creator-001", persona["id"])
        text = text.replace("creator001krea2", persona["training"]["trigger"])
        (train_runs / source.name).write_text(text, encoding="utf-8")

    anchor_paths = []
    persona_dir = Path(persona["_persona_path"]).parent
    anchor_dir = out / "expand" / "runs" / "_uploads" / persona["id"]
    anchor_dir.mkdir(parents=True, exist_ok=True)
    for relative in persona["identity"]["references"]:
        source = (persona_dir / relative).resolve()
        target = anchor_dir / source.name
        shutil.copy2(source, target)
        anchor_paths.append(_relative(target, out))
    return {
        "anchors": anchor_paths,
        "dataset_workflow": _relative(expand_workflow, out),
        "dataset_prompts": _relative(expand_prompts, out),
    }


def _planned_run(out: Path, manifest_path: Path, run_out: Path) -> dict[str, Any]:
    manifest = _read_json(manifest_path)
    ceiling = manifest_ceiling(manifest)
    argv = [
        sys.executable,
        str(POD_RUNNER),
        "run",
        "--manifest", str(manifest_path.resolve()),
        "--out", str(run_out.resolve()),
        "--max-usd", ceiling,
        "--max-minutes", str(manifest["max_minutes"]),
        "--ledger-dir", str(LEDGER_DIR),
        "--arc-cap-usd", ARC_CAP_USD,
        "--arc-ledger-glob", ARC_LEDGER_GLOB,
    ]
    return {
        "manifest": _relative(manifest_path, out),
        "sha256": _sha256(manifest_path),
        "ceiling_usd": ceiling,
        "out": _relative(run_out, out),
        "argv": argv,
        "cli": subprocess.list2cmdline(argv),
    }


def build_plan(
    creator_id: str,
    stage: str,
    out: Path,
    *,
    personas_root: Path = PERSONAS_ROOT,
) -> dict[str, Any]:
    """Generate a complete, immutable plan without touching the hand-written runs."""
    if stage not in (*STAGES, "all"):
        raise FigmentTrainError(f"unknown stage {stage!r}")
    out = Path(out).resolve()
    if (out / "plan.json").exists():
        raise FigmentTrainError(f"refusing to overwrite an existing plan: {out / 'plan.json'}")
    if out.exists() and any(out.iterdir()):
        raise FigmentTrainError(f"plan output directory must be empty: {out}")
    out.mkdir(parents=True, exist_ok=True)

    persona, training, pins = _load_inputs(creator_id, Path(personas_root))
    persona = dict(persona)
    persona["_persona_path"] = str(Path(personas_root) / creator_id / "persona.yaml")
    prompts = _generalized_prompts(persona)
    workflow = _generalized_dataset_workflow(persona, prompts)
    assets = _copy_support_files(out, persona, prompts, workflow)

    configs_dir = out / "train" / "configs"
    smoke_config = configs_dir / "training-smoke.json"
    full_config = configs_dir / "training.json"
    _write_json(smoke_config, _render_training_config(training["trigger"], 100, 50))
    _write_json(
        full_config,
        _render_training_config(training["trigger"], training["steps"], training["save_every"]),
    )

    selected = STAGES if stage == "all" else (stage,)
    plan_stages: dict[str, Any] = {}
    for current in selected:
        if current == "dataset":
            manifests = _dataset_manifests(persona, training, pins, prompts)
            paths = [
                out / "expand" / "runs" / f"{creator_id}-tensor-dataset-shard-{n:02d}.yaml"
                for n in range(1, 4)
            ]
        elif current == "smoke":
            manifests = [_train_manifest(persona, training, pins, smoke=True)]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-train-smoke.yaml"]
        elif current == "train":
            manifests = [_train_manifest(persona, training, pins, smoke=False)]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-train.yaml"]
        else:
            manifests = [_tester_manifest(persona, training, pins)]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-tester.yaml"]
        for path, manifest in zip(paths, manifests):
            _write_json(path, manifest)
        run_root = out / ("expand" if current == "dataset" else "train") / "runs" / "out"
        runs = [
            _planned_run(out, path, run_root / path.stem)
            for path in paths
        ]
        plan_stages[current] = {"runs": runs}

    plan = {
        "schema": "figment/train-plan@1",
        "creator": creator_id,
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "generator": _sha256(Path(__file__)),
        "persona_sha256": _sha256(Path(persona["_persona_path"])),
        "training": training,
        "assets": assets,
        "configs": {
            "smoke": _relative(smoke_config, out),
            "train": _relative(full_config, out),
        },
        "ledger_dir": str(LEDGER_DIR),
        "arc_cap_usd": ARC_CAP_USD,
        "arc_ledger_glob": ARC_LEDGER_GLOB,
        "stages": plan_stages,
    }
    _write_json(out / "plan.json", plan)
    return plan


def _ledger_rows(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise FigmentTrainError(f"cost ledger is missing: {path}")
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            if reader.fieldnames != ["model", "step", "usd"]:
                raise FigmentTrainError(f"unexpected cost ledger schema: {path}")
            return list(reader)
    except OSError as exc:
        raise FigmentTrainError(f"cannot read cost ledger {path}: {exc}") from exc


def _verify_ledger(data: dict[str, Any], manifest: dict[str, Any], ledger_dir: Path) -> None:
    day = data.get("ledger_day")
    if not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise FigmentTrainError("run.json has no valid ledger_day")
    rows = _ledger_rows(Path(ledger_dir) / f"figment-{day}.tsv")
    pod_module = _pod_runner_module()
    try:
        model = pod_module.gpu_model_label(manifest.get("gpu", {}).get("type"))
    except pod_module.HarnessError as exc:
        raise FigmentTrainError(f"run.json GPU type cannot form a ledger model: {exc}") from exc
    placements = data.get("placement_attempts") or []
    if not placements and data.get("pod_id"):
        placements = [{
            "pod_id": data["pod_id"],
            "estimated_actual_usd": data.get("estimated_actual_usd"),
        }]
    if not placements:
        raise FigmentTrainError("run.json has no placement ledger evidence")
    for placement in placements:
        pod_id = placement.get("pod_id")
        expected = placement.get("estimated_actual_usd")
        if not isinstance(pod_id, str) or expected is None:
            raise FigmentTrainError("run.json placement lacks pod_id or estimated_actual_usd")
        matches = [
            row for row in rows
            if row.get("model") == model and row.get("step") == f"pod-create {pod_id}"
        ]
        if len(matches) != 1:
            raise FigmentTrainError(
                f"ledger agreement failed for pod {pod_id}: expected one row, found {len(matches)}"
            )
        try:
            ledger_usd = Decimal(matches[0]["usd"]).quantize(Decimal("0.000001"))
            run_usd = Decimal(str(expected)).quantize(Decimal("0.000001"))
        except (InvalidOperation, KeyError) as exc:
            raise FigmentTrainError(f"ledger row for pod {pod_id} has invalid USD") from exc
        if ledger_usd != run_usd:
            raise FigmentTrainError(
                f"ledger agreement failed for pod {pod_id}: run.json={run_usd}, ledger={ledger_usd}"
            )


def verify_run_record(
    stage: str,
    manifest: dict[str, Any],
    out_dir: Path,
    ledger_dir: Path,
) -> dict[str, Any]:
    """Apply the old driver's checks plus exact cost-ledger reconciliation."""
    out_dir = Path(out_dir)
    data = _read_json(out_dir / "run.json")
    if not isinstance(data, dict):
        raise FigmentTrainError("run.json must be an object")
    if data.get("error"):
        raise FigmentTrainError(f"run.json recorded an error: {data['error']}")
    if data.get("termination_verified") is not True:
        raise FigmentTrainError("run.json termination_verified is not true")
    for placement in data.get("placement_attempts") or []:
        if placement.get("termination_verified") is not True:
            raise FigmentTrainError(
                f"placement {placement.get('pod_id')!r} lacks verified termination"
            )

    expected_artifacts = [row["remote"] for row in manifest.get("artifacts") or []]
    if expected_artifacts:
        actual = {row.get("remote"): row for row in data.get("artifacts") or []}
        for name in expected_artifacts:
            if name not in actual:
                raise FigmentTrainError(f"run.json is missing artifact {name!r}")
            if not isinstance(actual[name].get("bytes"), int) or actual[name]["bytes"] <= 0:
                raise FigmentTrainError(f"run.json artifact {name!r} has non-positive bytes")
    else:
        expected_jobs = manifest.get("jobs") or []
        jobs = data.get("jobs") or []
        if len(jobs) != len(expected_jobs):
            raise FigmentTrainError(
                f"run.json has {len(jobs)} jobs; expected {len(expected_jobs)}"
            )
        for expected, actual in zip(expected_jobs, jobs):
            if actual.get("output_name") != expected.get("output_name"):
                raise FigmentTrainError("run.json job order/output_name disagrees with manifest")
            files = actual.get("files") or []
            if len(files) != expected.get("expected_images", 1):
                raise FigmentTrainError(
                    f"job {actual.get('output_name')!r} output count disagrees with manifest"
                )
            if any(not isinstance(row.get("bytes"), int) or row["bytes"] <= 0 for row in files):
                raise FigmentTrainError(
                    f"job {actual.get('output_name')!r} has a non-positive output"
                )

    if "_training.log" in expected_artifacts:
        log_path = out_dir / "_training.log"
        if not log_path.is_file():
            raise FigmentTrainError("_training.log was not downloaded")
        text = log_path.read_text(encoding="utf-8", errors="replace")
        if KEY_MISMATCH_RE.search(text):
            raise FigmentTrainError("state-dict missing/unexpected keys found in _training.log")
    _verify_ledger(data, manifest, Path(ledger_dir))
    return data


def _load_plan(creator_id: str, plan_path: Path) -> tuple[dict[str, Any], Path]:
    plan_path = Path(plan_path).resolve()
    plan = _read_json(plan_path)
    if not isinstance(plan, dict) or plan.get("schema") != "figment/train-plan@1":
        raise FigmentTrainError("plan.json has an unsupported schema")
    if plan.get("creator") != creator_id:
        raise FigmentTrainError(
            f"plan creator {plan.get('creator')!r} does not match {creator_id!r}"
        )
    return plan, plan_path.parent


def _stage_state(path: Path, creator_id: str, plan_path: Path) -> dict[str, Any]:
    plan_digest = _sha256(plan_path)
    if path.is_file():
        state = _read_json(path)
        if state.get("creator") != creator_id or state.get("plan_sha256") != plan_digest:
            raise FigmentTrainError("stage.json belongs to a different creator or plan")
        return state
    return {
        "schema": "figment/train-stage@1",
        "creator": creator_id,
        "plan_sha256": plan_digest,
        "status": "ready",
        "runs": {},
        "completed_stages": [],
    }


def _write_stage_state(path: Path, state: dict[str, Any]) -> None:
    state["updated_utc"] = datetime.now(timezone.utc).isoformat()
    _write_json(path, state)


def _install_stage_config(stage: str, plan: dict[str, Any], root: Path) -> None:
    if stage not in ("smoke", "train"):
        return
    dataset_dir = root / "train" / "runs" / f"{plan['creator']}-tensor-dataset"
    approved = root / "grade" / "dataset" / "approved-list.json"
    if not approved.is_file() or not (dataset_dir / "_dataset.ready").is_file():
        raise FigmentTrainError(
            "operator dataset rulings have not been applied; run grade and apply-rulings first"
        )
    config_source = root / plan["configs"][stage]
    if not config_source.is_file():
        raise FigmentTrainError(f"planned {stage} config is missing: {config_source}")
    shutil.copy2(config_source, dataset_dir / "training.json")


def run_planned_stage(creator_id: str, stage: str, plan_path: Path) -> dict[str, Any]:
    """Run one stage (or the bounded chain), recording progress and never retrying."""
    if stage not in (*STAGES, "all"):
        raise FigmentTrainError(f"unknown stage {stage!r}")
    plan, root = _load_plan(creator_id, plan_path)
    requested = STAGES if stage == "all" else (stage,)
    for current in requested:
        if current not in plan.get("stages", {}):
            raise FigmentTrainError(f"plan does not contain stage {current!r}")
    state_path = root / "stage.json"
    state = _stage_state(state_path, creator_id, Path(plan_path).resolve())

    for current in requested:
        if current in state["completed_stages"]:
            if stage != "all":
                raise FigmentTrainError(f"stage {current!r} already completed; refusing a live retry")
            continue
        _install_stage_config(current, plan, root)
        state["status"] = f"running:{current}"
        _write_stage_state(state_path, state)
        for run in plan["stages"][current]["runs"]:
            key = run["manifest"]
            prior = state["runs"].get(key)
            if prior and prior.get("status") == "complete":
                continue
            if prior and prior.get("status") == "failed":
                raise FigmentTrainError(
                    f"planned run {key} already failed; create a reviewed new plan to retry"
                )
            if prior and prior.get("status") == "running":
                raise FigmentTrainError(
                    f"planned run {key} is still marked running; a prior invocation may have "
                    "been interrupted before recording completion or failure. Confirm the true "
                    "pod state with `runpod_run.py status`/`probe` (and terminate it if still "
                    "live) before touching this plan again — never launch a second pod for the "
                    "same manifest"
                )
            manifest_path = root / key
            if _sha256(manifest_path) != run["sha256"]:
                raise FigmentTrainError(f"planned manifest digest changed: {manifest_path}")
            expected_run = _planned_run(root, manifest_path, root / run["out"])
            for field in ("ceiling_usd", "out", "argv", "cli"):
                if run.get(field) != expected_run[field]:
                    raise FigmentTrainError(
                        f"planned run field {field!r} no longer matches the bounded harness command"
                    )
            state["runs"][key] = {"status": "running", "started_utc": datetime.now(timezone.utc).isoformat()}
            _write_stage_state(state_path, state)
            try:
                result = subprocess.run(run["argv"], cwd=ROOT)
            except OSError as exc:
                state["runs"][key] = {"status": "failed", "error": type(exc).__name__}
                state["status"] = f"stopped:{current}"
                _write_stage_state(state_path, state)
                raise FigmentTrainError(f"could not launch the planned harness command: {exc}") from exc
            if result.returncode != 0:
                state["runs"][key] = {"status": "failed", "returncode": result.returncode}
                state["status"] = f"stopped:{current}"
                _write_stage_state(state_path, state)
                raise FigmentTrainError(
                    f"harness stopped for {key} with exit code {result.returncode}; no retry attempted"
                )
            manifest = _read_json(manifest_path)
            try:
                verify_run_record(
                    current, manifest, root / run["out"], Path(plan["ledger_dir"]),
                )
            except FigmentTrainError as exc:
                state["runs"][key] = {"status": "failed", "error": str(exc)}
                state["status"] = f"stopped:{current}"
                _write_stage_state(state_path, state)
                raise
            state["runs"][key] = {"status": "complete"}
            _write_stage_state(state_path, state)
        state["completed_stages"].append(current)
        state["status"] = f"complete:{current}"
        _write_stage_state(state_path, state)
        if current == "dataset" and stage == "all":
            dataset_dir = root / "train" / "runs" / f"{creator_id}-tensor-dataset"
            if not (dataset_dir / "_dataset.ready").is_file():
                state["status"] = "waiting:dataset-rulings"
                _write_stage_state(state_path, state)
                raise FigmentTrainError(
                    "dataset stage completed; STOP for full-resolution operator grading and "
                    "apply-rulings, then invoke --stage all again to resume without rerunning it"
                )
    state["status"] = "complete"
    _write_stage_state(state_path, state)
    return state


def _find_job_image(run_out: Path, output_name: str) -> Path:
    matches = [
        run_out / f"{output_name}{suffix}" for suffix in IMAGE_EXTENSIONS
        if (run_out / f"{output_name}{suffix}").is_file()
    ]
    if len(matches) != 1:
        raise FigmentTrainError(
            f"expected exactly one full-resolution output for {output_name!r} in "
            f"{run_out}, found {len(matches)}"
        )
    if matches[0].stat().st_size <= 0:
        raise FigmentTrainError(f"grading image is empty: {matches[0]}")
    return matches[0].resolve()


def _grading_images(plan: dict[str, Any], root: Path, stage: str) -> list[dict[str, Any]]:
    if stage not in plan.get("stages", {}):
        raise FigmentTrainError(f"plan does not contain stage {stage!r}")
    images: list[dict[str, Any]] = []
    for run in plan["stages"][stage]["runs"]:
        manifest_path = root / run["manifest"]
        if _sha256(manifest_path) != run["sha256"]:
            raise FigmentTrainError(f"planned manifest digest changed: {manifest_path}")
        manifest = _read_json(manifest_path)
        run_out = root / run["out"]
        for job in manifest.get("jobs") or []:
            image = _find_job_image(run_out, job["output_name"])
            images.append({
                "image_id": job["output_name"],
                "path": str(image),
                "review_status": "unreviewed",
                "parked_reasons": [],
                "safety_failed": False,
                "safety_reasons": [],
            })
    if not images:
        raise FigmentTrainError(f"stage {stage!r} has no grading images")
    return images


def _grading_html(
    creator_id: str, stage: str, anchors: list[Path], images: list[dict[str, Any]],
) -> str:
    anchor_cards = "\n".join(
        f'<figure><a href="{html.escape(path.as_uri())}"><img loading="eager" '
        f'src="{html.escape(path.as_uri())}" alt="anchor {html.escape(path.name)}"></a>'
        f'<figcaption>anchor · {html.escape(path.name)}</figcaption></figure>'
        for path in anchors
    )
    cells = "\n".join(
        f'<figure><a href="{html.escape(Path(row["path"]).as_uri())}">'
        f'<img loading="lazy" src="{html.escape(Path(row["path"]).as_uri())}" '
        f'alt="{html.escape(row["image_id"])}"></a>'
        f'<figcaption>{html.escape(row["image_id"])}</figcaption></figure>'
        for row in images
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(creator_id)} · {html.escape(stage)} grading</title>
<style>
body{{font:16px system-ui;background:#111;color:#eee;margin:24px}}
h1,h2{{margin:0 0 16px}}p{{color:#bbb}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:24px}}
figure{{margin:0;background:#1b1b1b;padding:12px;border-radius:8px}}img{{display:block;width:100%;height:auto;background:#222}}figcaption{{padding-top:8px;font-family:ui-monospace,monospace}}
.anchors{{border:2px solid #8ab4f8;padding:16px;margin-bottom:28px}}
</style></head><body>
<h1>{html.escape(creator_id)} · {html.escape(stage)}</h1>
<p>full-resolution source files: click any image to inspect its original pixels. Rule beside the anchors; never grade a thumbnail alone.</p>
<section class="anchors"><h2>Identity anchors</h2><div class="grid">{anchor_cards}</div></section>
<main><h2>Cells</h2><div class="grid">{cells}</div></main>
</body></html>
"""


def build_grade(creator_id: str, stage: str, plan_path: Path) -> dict[str, str]:
    """Build a non-destructive, original-pixel grading surface and blank rulings."""
    if stage not in ("dataset", "tester"):
        raise FigmentTrainError("grade stage must be dataset or tester")
    plan, root = _load_plan(creator_id, plan_path)
    anchors = [(root / value).resolve() for value in plan["assets"]["anchors"]]
    for anchor in anchors:
        if not anchor.is_file() or anchor.stat().st_size <= 0:
            raise FigmentTrainError(f"anchor is missing or empty: {anchor}")
    images = _grading_images(plan, root, stage)
    grade_dir = root / "grade" / stage
    grade_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = grade_dir / "grading-manifest.json"
    template_path = grade_dir / "rulings.template.json"
    page_path = grade_dir / "board.html"
    _write_json(manifest_path, {"creator": creator_id, "stage": stage, "images": images})
    _write_json(template_path, {
        "schema": "figment/rulings-template@1",
        "creator": creator_id,
        "stage": stage,
        "rulings": [{
            "image_id": row["image_id"],
            "decision": None,
            "identity": None,
            "realism": None,
            "hands": None,
            "lighting": None,
            "adult_read": None,
            "garment_integrity": None,
            "real_person_resemblance": None,
            "why": "",
        } for row in images],
    })
    page_path.write_text(
        _grading_html(creator_id, stage, anchors, images), encoding="utf-8",
    )
    return {
        "page": str(page_path),
        "rulings_template": str(template_path),
        "grading_manifest": str(manifest_path),
    }


def _normalize_rulings(
    creator_id: str, stage: str, document: Any, image_ids: list[str],
) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise FigmentTrainError("rulings document must be an object")
    if document.get("creator") != creator_id or document.get("stage") != stage:
        raise FigmentTrainError("rulings creator/stage does not match the command")
    raw = document.get("rulings")
    if not isinstance(raw, list):
        raise FigmentTrainError("rulings document must contain a rulings list")
    quality = ("identity", "realism", "hands", "lighting")
    safety = ("adult_read", "garment_integrity", "real_person_resemblance")
    by_id: dict[str, dict[str, Any]] = {}
    for row in raw:
        if not isinstance(row, dict) or not isinstance(row.get("image_id"), str):
            raise FigmentTrainError("every ruling must be an object with image_id")
        image_id = row["image_id"]
        if image_id in by_id:
            raise FigmentTrainError(f"duplicate ruling for {image_id!r}")
        decision = row.get("decision")
        if not isinstance(decision, str) or decision.lower() not in ("keep", "cull"):
            raise FigmentTrainError(f"ruling {image_id!r} needs decision keep|cull")
        normalized = dict(row)
        normalized["decision"] = decision.lower()
        for axis in (*quality, *safety):
            value = row.get(axis)
            if not isinstance(value, str) or not value.strip():
                raise FigmentTrainError(f"ruling {image_id!r} is missing axis {axis!r}")
            normalized[axis] = value.strip().lower()
        by_id[image_id] = normalized
    missing = [image_id for image_id in image_ids if image_id not in by_id]
    unexpected = sorted(set(by_id) - set(image_ids))
    if missing or unexpected:
        raise FigmentTrainError(
            f"rulings do not exactly cover the grading manifest; missing={missing}, "
            f"unexpected={unexpected}"
        )
    return {
        "schema": "figment/rulings@1",
        "creator": creator_id,
        "stage": stage,
        "rulings": [by_id[image_id] for image_id in image_ids],
    }


def apply_rulings(
    creator_id: str, stage: str, plan_path: Path, rulings_path: Path,
) -> dict[str, str]:
    """Validate operator rulings, stamp QA, and materialize dataset keeps."""
    if stage not in ("dataset", "tester"):
        raise FigmentTrainError("apply-rulings stage must be dataset or tester")
    plan, root = _load_plan(creator_id, plan_path)
    grade_dir = root / "grade" / stage
    grading_path = grade_dir / "grading-manifest.json"
    grading = _read_json(grading_path)
    if grading.get("creator") != creator_id or grading.get("stage") != stage:
        raise FigmentTrainError("grading manifest creator/stage mismatch")
    images = grading.get("images")
    if not isinstance(images, list) or not images:
        raise FigmentTrainError("grading manifest has no images")
    image_ids = [row.get("image_id") for row in images]
    if any(not isinstance(value, str) for value in image_ids) or len(set(image_ids)) != len(image_ids):
        raise FigmentTrainError("grading manifest has invalid or duplicate image ids")
    normalized = _normalize_rulings(
        creator_id, stage, _read_json(Path(rulings_path)), image_ids,
    )

    review = deepcopy(grading)
    try:
        _qa_module().stamp(review, normalized)
    except ValueError as exc:
        raise FigmentTrainError(f"qa_stamp rejected rulings: {exc}") from exc
    ruling_by_id = {row["image_id"]: row for row in normalized["rulings"]}
    approved_rows = []
    for row in review["images"]:
        ruling = ruling_by_id[row["image_id"]]
        if ruling["decision"] == "keep":
            if row.get("safety_failed"):
                raise FigmentTrainError(
                    f"kept cell {row['image_id']!r} failed a mandatory safety axis"
                )
            if row.get("review_status") != "verified":
                raise FigmentTrainError(
                    f"kept cell {row['image_id']!r} failed a quality axis"
                )
            approved_rows.append({"image_id": row["image_id"], "path": row["path"]})
    if not approved_rows:
        raise FigmentTrainError("rulings approved no images")
    if stage == "dataset" and len(approved_rows) < 20:
        raise FigmentTrainError(
            f"dataset approved only {len(approved_rows)} images; training requires at least 20"
        )

    rulings_out = grade_dir / "rulings.json"
    review_out = grade_dir / "review-manifest.json"
    approved_out = grade_dir / "approved-list.json"
    if any(path.exists() for path in (rulings_out, review_out, approved_out)):
        raise FigmentTrainError("refusing to overwrite previously applied rulings")

    if stage == "dataset":
        approved_dir = grade_dir / "approved"
        dataset_dir = root / "train" / "runs" / f"{creator_id}-tensor-dataset"
        if approved_dir.exists() or dataset_dir.exists():
            raise FigmentTrainError("approved or training dataset directory already exists")
        with tempfile.TemporaryDirectory(prefix="apply-rulings-", dir=root) as temporary_name:
            temporary = Path(temporary_name)
            temporary_approved = temporary / "approved"
            temporary_dataset = temporary / "dataset"
            temporary_approved.mkdir()
            for index, row in enumerate(approved_rows, start=1):
                source = Path(row["path"])
                if not source.is_file() or source.stat().st_size <= 0:
                    raise FigmentTrainError(f"approved source image is missing or empty: {source}")
                shutil.copy2(
                    source,
                    temporary_approved /
                    f"{index:03d}-{row['image_id']}{source.suffix.lower()}",
                )
            builder = _build_set_module()
            try:
                builder.build_training_set(
                    approved_cells=None,
                    source_dir=None,
                    caption_mode="class",
                    out_dir=temporary_dataset,
                    caption_word="woman",
                    images_from=[temporary_approved],
                    exclude=None,
                )
            except ValueError as exc:
                raise FigmentTrainError(f"build_training_set rejected approved images: {exc}") from exc
            shutil.copy2(root / plan["configs"]["train"], temporary_dataset / "training.json")
            approved_dir.parent.mkdir(parents=True, exist_ok=True)
            dataset_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(temporary_approved), str(approved_dir))
            shutil.move(str(temporary_dataset), str(dataset_dir))

    approved_document = {
        "schema": "figment/approved-images@1",
        "creator": creator_id,
        "stage": stage,
        "images": approved_rows,
    }
    _write_json(rulings_out, normalized)
    _write_json(review_out, review)
    _write_json(approved_out, approved_document)
    return {
        "rulings": str(rulings_out),
        "review_manifest": str(review_out),
        "approved_list": str(approved_out),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan", help="generate a creator-specific Track-1 plan")
    plan.add_argument("--creator", required=True)
    plan.add_argument("--stage", choices=(*STAGES, "all"), default="all")
    plan.add_argument("--out", required=True, type=Path)

    run = commands.add_parser("run", help="run one planned stage without retries")
    run.add_argument("--creator", required=True)
    run.add_argument("--stage", choices=(*STAGES, "all"), required=True)
    run.add_argument("--plan", required=True, type=Path)

    grade = commands.add_parser("grade", help="build a full-resolution grading board")
    grade.add_argument("--creator", required=True)
    grade.add_argument("--stage", choices=("dataset", "tester"), required=True)
    grade.add_argument("--plan", type=Path, default=Path("plan.json"))

    apply = commands.add_parser("apply-rulings", help="validate and apply operator rulings")
    apply.add_argument("--creator", required=True)
    apply.add_argument("--stage", choices=("dataset", "tester"), required=True)
    apply.add_argument("--plan", type=Path, default=Path("plan.json"))
    apply.add_argument("--rulings", required=True, type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "plan":
            result = build_plan(args.creator, args.stage, args.out)
            print(f"wrote {args.out.resolve() / 'plan.json'} ({len(result['stages'])} stage(s))")
        elif args.command == "run":
            result = run_planned_stage(args.creator, args.stage, args.plan)
            print(f"stage state: {result['status']}")
        elif args.command == "grade":
            result = build_grade(args.creator, args.stage, args.plan)
            print(f"grading page: {result['page']}")
            print(f"rulings template: {result['rulings_template']}")
        else:
            result = apply_rulings(args.creator, args.stage, args.plan, args.rulings)
            print(f"applied rulings: {result['rulings']}")
            print(f"approved list: {result['approved_list']}")
    except (FigmentTrainError, OSError) as exc:
        print(f"STOP: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
