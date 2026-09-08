#!/usr/bin/env python3
"""Plan, run, and grade the persona-driven Figment Track-1 chain.

Planning and grading are local. ``run`` is the only live path and delegates every
pod to pod/runpod_run.py with the exact argv recorded in plan.json. It never retries.
"""
from __future__ import annotations

import argparse
import csv
import glob
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
FULLBODY_WORKFLOW_PATH = EXPAND_DIR / "workflows" / "tensor_dataset_fullbody_api.json"
ANCHOR_PROMPTS_PATH = EXPAND_DIR / "templates" / "anchor-prompts.yaml"
ANCHOR_WORKFLOW_PATH = EXPAND_DIR / "workflows" / "zimage_passport_api.json"
GEN_PROMPTS_PATH = EXPAND_DIR / "templates" / "gen-prompts.yaml"
GEN_WORKFLOW_PATH = TRAIN_DIR / "workflows" / "krea2_gen_api.json"
DETAIL_WORKFLOW_PATH = TRAIN_DIR / "workflows" / "krea2_detail_only_api.json"
AI_TEMPLATE_PATH = TRAIN_DIR / "ai-toolkit-krea2.yaml.template"
TRAIN_START_PATH = TRAIN_DIR / "runs" / "start-training-aitoolkit.sh.template"
TESTER_START_PATH = TRAIN_DIR / "runs" / "start-comfy-lorapath.sh.template"
TRAINING_CONFIG_MODULE = HERE / "training_config.py"
RENDER_MODULE = TRAIN_DIR / "render_aitoolkit_config.py"
BUILD_SET_MODULE = TRAIN_DIR / "build_training_set.py"
QA_MODULE = HERE / "qa_stamp.py"
SCORE_CELLS_MODULE = HERE / "score_cells.py"
IDENTITY_GATE_MODULE = HERE / "identity_gate.py"
LINEAGE_MODULE = HERE / "lineage.py"
VERIFY_PINS_MODULE = TRAIN_DIR / "verify_pins.py"
LEDGER_DIR = ROOT / "ledgers" / "cost"
ARC_CAP_USD = "50.00"
ARC_LEDGER_GLOB = "figment-*.tsv"
STAGES = ("anchor", "dataset", "smoke", "train", "tester", "gen")
# Track-2 Task D2 (review H3): the one, single source of truth for "which stages have a
# grading board" -- `build_grade`, `apply_rulings`, and `command_gate` each used to carry
# their own local tuple, so widening one and not the others silently reopened the exact
# gap H3 first closed for "anchor". "gen" is gradeable; "smoke"/"train" never are (no
# per-cell operator ruling makes sense for either).
GRADEABLE_STAGES = ("anchor", "dataset", "tester", "gen")
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
# Which `pins.pins` profile(s) each STAGES entry consumes -- the anchor stage alone spans
# two profiles (passport + edit arms); "smoke" reuses the "train" profile exactly as
# `_train_manifest` does. Drives the `plan` preflight's pin verification (HIGH-1 / LOW-15):
# only the profiles an actual `--stage` selection will use are HEAD-checked.
STAGE_PIN_PROFILES = {
    "anchor": ("anchor", "anchor_edit"),
    "dataset": ("dataset",),
    "smoke": ("train",),
    "train": ("train",),
    "tester": ("tester",),
    "gen": ("gen",),
}
SHARD_NOTES = (
    "face-row and half-body-row cells (framing: half), part 1 of 3",
    "face-row and half-body-row cells (framing: half), part 2 of 3",
    "face-row and half-body-row cells (framing: half), part 3 of 3",
)
FULLBODY_SHARD_NOTE = (
    "full-body-row cells (framing: full) routed through the face-repair second pass "
    "(D25) on tensor_dataset_fullbody_api.json -- wide/low-angle/walking framings where "
    "the face would otherwise read too small at native scale"
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


def _score_cells_module():
    return _load_module("_figment_train_score_cells", SCORE_CELLS_MODULE)


def _identity_gate_module():
    return _load_module("_figment_train_identity_gate", IDENTITY_GATE_MODULE)


def _lineage_module():
    return _load_module("_figment_train_lineage", LINEAGE_MODULE)


def _pod_runner_module():
    return _load_module("_figment_train_pod_runpod_run", POD_RUNNER)


def _verify_pins_module():
    return _load_module("_figment_train_verify_pins", VERIFY_PINS_MODULE)


def _verify_pins_preflight(pins: dict[str, Any], selected_stages: list[str]) -> None:
    """Run `verify_pins.verify_pins` for every pin profile `selected_stages` will actually
    consume, before a single model is ever bootstrapped on a pod (review HIGH-1: all four
    `pins.anchor` sha256 digests were wrong and only failed at pod readiness, burning the
    full cost ceiling for zero images). Raises `FigmentTrainError` on any mismatch."""
    profiles: list[str] = []
    for stage in selected_stages:
        for profile in STAGE_PIN_PROFILES.get(stage, ()):
            if profile not in profiles:
                profiles.append(profile)
    if not profiles:
        return
    module = _verify_pins_module()
    try:
        results = module.verify_pins(pins, stages=profiles)
    except module.VerifyPinsError as exc:
        raise FigmentTrainError(f"pin verification could not run: {exc}") from exc
    if results:
        lines = [
            f"[{stage}] {problem}"
            for stage, problems in results.items() for problem in problems
        ]
        raise FigmentTrainError("pin verification failed:\n" + "\n".join(lines))


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


# Live defect: the train stage's wall-clock budget used to be a static pod-class pin
# (tensor-pins.yaml train.job_timeout_seconds/max_minutes) regardless of
# training.steps/training.dop_enabled. Measured rates: 1.3-2.5s/step cached without DOP,
# a steady 8.6s/step with DOP's 3 forward passes/step (r21) -- a long DOP run can blow
# through the fixed 3h job_timeout / 270min ceiling mid-training. TRAIN_STEP_RATE_DOP_S
# carries a small margin over the measured 8.6s/step.
TRAIN_STEP_RATE_NO_DOP_S = 2.5
TRAIN_STEP_RATE_DOP_S = 9.0
TRAIN_WARMUP_SECONDS = 900
TRAIN_BUDGET_MARGIN = 1.35


def _train_step_rate(dop_enabled: bool) -> float:
    return TRAIN_STEP_RATE_DOP_S if dop_enabled else TRAIN_STEP_RATE_NO_DOP_S


def _apply_train_budget(
    manifest: dict[str, Any], training: dict[str, Any], *, num_artifacts: int,
) -> dict[str, Any]:
    """Derive the train stage's job_timeout_seconds/max_minutes from `training.steps`
    and `training.dop_enabled`, mutating `manifest` in place, and return the numbers for
    plan.json's run entry (`budget`). The pod-class pins in tensor-pins.yaml (already
    populated into `manifest` by `_pod_base`) stay FLOORS -- this only ever raises
    job_timeout_seconds/max_minutes above the pinned value, never below it.
    readiness_timeout_seconds and artifact_download_seconds are left exactly as pinned.
    max_minutes is computed with the SAME harness helper
    (`pod/runpod_run.minimum_runtime_minutes`) every manifest's live preflight already
    uses -- never a second, independently hand-rolled formula that could drift from it.
    """
    floor_job_timeout_seconds = manifest["job_timeout_seconds"]
    floor_max_minutes = manifest["max_minutes"]
    per_step_s = _train_step_rate(training["dop_enabled"])
    steps = training["steps"]
    job_timeout_seconds = max(
        floor_job_timeout_seconds,
        math.ceil((steps * per_step_s + TRAIN_WARMUP_SECONDS) * TRAIN_BUDGET_MARGIN),
    )
    probe_manifest = {
        "readiness_timeout_seconds": manifest["readiness_timeout_seconds"],
        "job_timeout_seconds": job_timeout_seconds,
        "artifact_download_seconds": manifest["artifact_download_seconds"],
        "artifacts": [{} for _ in range(num_artifacts)],
    }
    minimum_minutes = _pod_runner_module().minimum_runtime_minutes(probe_manifest)
    max_minutes = max(floor_max_minutes, math.ceil(minimum_minutes))
    manifest["job_timeout_seconds"] = job_timeout_seconds
    manifest["max_minutes"] = max_minutes
    ceiling_usd = manifest_ceiling({
        "price_usd_per_hour": manifest["price_usd_per_hour"], "max_minutes": max_minutes,
    })
    return {
        "per_step_s": per_step_s,
        "steps": steps,
        "job_timeout_seconds": job_timeout_seconds,
        "max_minutes": max_minutes,
        "ceiling_usd": ceiling_usd,
    }


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
    if "upload_allowance_seconds" in stage_values:
        result["upload_allowance_seconds"] = stage_values["upload_allowance_seconds"]
    if "job_wait_for_seconds" in stage_values:
        result["job_wait_for_seconds"] = stage_values["job_wait_for_seconds"]
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


def _resolve_body_reference(persona: dict, references: list[Path]) -> Path:
    """Pick the reference image `body.identity` should describe.

    Review MED-9: after anchor-stage promotion, `identity.references` collapses to the one
    picked anchor while `body_target.exemplars` still names the old g-set stems it can no
    longer match -- the old code fell through to `references[-1]` in that case with no
    warning, which happened to work only because a promoted persona has exactly one
    reference. Fail closed instead: a non-empty `exemplars` that matches nothing is treated
    as stale persona.yaml state, not a coincidence to paper over.
    """
    exemplar_stems = list(persona["body_target"].get("exemplars") or [])
    for stem in reversed(exemplar_stems):
        for ref in references:
            if ref.stem == stem:
                return ref
    if exemplar_stems:
        raise FigmentTrainError(
            f"persona.body_target.exemplars {exemplar_stems!r} match none of "
            f"persona.identity.references {[ref.stem for ref in references]!r} -- this "
            "looks like stale post-anchor-promotion state (identity.references collapsed "
            "to the picked anchor without body_target.exemplars being updated); correct or "
            "clear body_target.exemplars by hand before planning the dataset stage"
        )
    return references[-1]


def _generalized_prompts(persona: dict) -> dict[str, Any]:
    prompts = _read_json(PROMPTS_PATH)
    references = [Path(value) for value in persona["identity"]["references"]]
    body_ref = _resolve_body_reference(persona, references)
    prompts["persona"] = persona["id"]
    note = prompts["structure"]["prepend_is_the_hand_typed_description"]
    replacements = iter([references[0].as_posix(), body_ref.as_posix()])
    note = _ANCHOR_FILENAME_RE.sub(lambda match: next(replacements, match.group(0)), note)
    prompts["structure"]["prepend_is_the_hand_typed_description"] = note

    # Fix (dataset-stage face/body identity contamination): compose face/body identity
    # the same way `_generalized_anchor_prompts` composes passport/edit identity below --
    # entirely from the persona's own `identity.look` (never a face/body description
    # hardcoded in the shared template). Guarded on "face"/"body" being present so a
    # minimal/legacy template (e.g. test_figment_train.py's note-derivation fixture,
    # which supplies neither section nor a persona `identity.look`) keeps working
    # unchanged -- only the real tensor-dataset-prompts.yaml template (which has both)
    # takes this path.
    if "face" in prompts and "body" in prompts:
        look = persona.get("identity", {}).get("look")
        if not isinstance(look, dict):
            raise FigmentTrainError(
                "persona.identity.look is required to compose the dataset-stage "
                "face/body identity"
            )
        clause = _compose_look_clause(look)
        # Track-2 dataset-stage fix: the shared, non-persona skin-texture rendering
        # instruction (a photorealism directive, not a look description) stays intact --
        # popped from the template rather than left hardcoded on both "face" and "body".
        skin_texture_clause = prompts.pop("skin_texture_clause")
        identity = f"{clause}, {skin_texture_clause}, "
        prompts["face"]["identity"] = identity
        prompts["body"]["identity"] = identity
    return prompts


def _compose_look_clause(look: dict[str, Any]) -> str:
    """Join `identity.look`'s eight fields into one comma-separated descriptive clause,
    with no trailing punctuation -- the caller decides how the clause continues."""
    return ", ".join(
        look[key] for key in
        ("age_stage", "hair", "eyes", "skin", "brows", "makeup", "build", "clothing")
    )


def _generalized_anchor_prompts(persona: dict) -> dict[str, Any]:
    """Build the anchor-stage prompts entirely from the template's structure/rows/camera
    and framing clauses plus the persona's own `identity.look` (Track-2 review HIGH-2) --
    never from a face/body description hardcoded in the shared template. `persona.py`
    already fails closed on a missing or malformed `identity.look` before a persona
    document is ever returned by `_load_inputs`; the check here is defense in depth for a
    persona dict built by hand (e.g. in a test) that bypassed that validation.
    """
    prompts = _read_json(ANCHOR_PROMPTS_PATH)
    prompts["persona"] = persona["id"]
    look = persona.get("identity", {}).get("look")
    if not isinstance(look, dict):
        raise FigmentTrainError(
            "persona.identity.look is required to compose the anchor-stage prompts"
        )
    clause = _compose_look_clause(look)
    prompts["passport"]["identity"] = clause + ","
    prompts["edit"]["identity"] = clause + ". " + prompts["edit"].pop("constraint_clause")

    framing_prefix = prompts["passport"].pop("framing_prefix")
    prompts["passport"]["rows"] = [
        row if row.startswith(framing_prefix) else f"{framing_prefix} {row}"
        for row in prompts["passport"]["rows"]
    ]
    camera_clause = prompts["camera_clause"]
    for arm in ("passport", "edit"):
        prompts[arm]["rows"] = [
            row if camera_clause in row else f"{row} {camera_clause}"
            for row in prompts[arm]["rows"]
        ]
    return prompts


def _generalized_dataset_workflow(persona: dict, prompts: dict[str, Any]) -> dict[str, Any]:
    workflow = _read_json(WORKFLOW_PATH)
    references = [Path(value) for value in persona["identity"]["references"]]
    body_ref = _resolve_body_reference(persona, references)
    workflow["836"]["inputs"]["image"] = f"{persona['id']}/{references[0].name}"
    workflow["837"]["inputs"]["image"] = f"{persona['id']}/{body_ref.name}"
    workflow["800"]["inputs"]["text"] = prompts["face"]["identity"]
    workflow["780"]["inputs"]["text"] = prompts["body"]["identity"]
    workflow["832"]["inputs"]["filename_prefix"] = f"{persona['id']}-tensor-dataset"
    return workflow


FULLBODY_OUTPUT_NODE = "958"


def _chunks(items: list[Any], count: int) -> list[list[Any]]:
    """Split `items` into `count` as-equal-as-possible contiguous chunks."""
    size, extra = divmod(len(items), count)
    chunks: list[list[Any]] = []
    start = 0
    for index in range(count):
        take = size + (1 if index < extra else 0)
        chunks.append(items[start:start + take])
        start += take
    return chunks


def _dataset_jobs(persona: dict, prompts: dict[str, Any]) -> list[dict[str, Any]]:
    """Build every face + body job, each tagged with its own `framing` ("half"|"full",
    Track-2 Task B1/D24-D25). Face rows are always plain strings (already close framings,
    never routed to the fullbody face-repair pass); body rows are now `{"text",
    "framing"}` objects. A "full" body job's `832`/`images` substitution points at the
    fullbody workflow's face-repair composite output instead of the raw refine decode, so
    the same job dict works unchanged whichever manifest (`_dataset_manifests`) it lands in.
    """
    short = _creator_output_code(persona["id"])
    jobs: list[dict[str, Any]] = []
    branches = (
        ("f", "174", "791", "788", 241731167782064, prompts["face"]),
        ("b", "676", "776", "778", 269789944143426, prompts["body"]),
    )
    for label, prompt_node, image_node, seed_node, outer_seed, block in branches:
        for index, row in enumerate(block["rows"], start=1):
            if isinstance(row, dict):
                text, framing = row["text"], row["framing"]
            else:
                text, framing = row, "half"
            output_node = FULLBODY_OUTPUT_NODE if framing == "full" else image_node
            substitutions = [
                {"node_id": "832", "field": "images", "value": [output_node, 0]},
                {"node_id": seed_node, "field": "seed", "value": 1098688918602660},
                {"node_id": prompt_node, "field": "prompt", "value": block["identity"] + text},
            ]
            if framing == "full":
                # D25: the face-repair tail's own TextEncodeQwenImageEditPlus (node 952)
                # needs its placeholder prompt substituted too -- a fixed instruction, not
                # a per-row scene description (see fullbody_repair_prompt_note).
                substitutions.append({
                    "node_id": "952", "field": "prompt",
                    "value": prompts["fullbody_repair_prompt"],
                })
            jobs.append({
                "seed": outer_seed,
                "output_name": f"{short}-tds-{label}{index:02d}",
                "expected_images": 1,
                "framing": framing,
                "substitutions": substitutions,
            })
    return jobs


def _dataset_manifests(
    persona: dict, training: dict, pins: dict, prompts: dict[str, Any],
) -> list[dict[str, Any]]:
    """Three shards of face + half-body-framed cells on the v2 workflow, plus one
    `fullbody` manifest of full-body-framed cells on the face-repair workflow (Track-2
    Task B1). `full` cells are never mixed into the v2 shards -- the repair tail only
    exists in `tensor_dataset_fullbody_api.json`."""
    jobs = _dataset_jobs(persona, prompts)
    half_jobs: list[dict[str, Any]] = []
    full_jobs: list[dict[str, Any]] = []
    for job in jobs:
        framing = job.pop("framing")
        (full_jobs if framing == "full" else half_jobs).append(job)
    references = [Path(value).name for value in persona["identity"]["references"]]
    upload = {
        "files": [f"_uploads/{persona['id']}/{name}" for name in references],
        "subfolder": persona["id"],
        "type": "input",
        "overwrite": True,
    }
    manifests: list[dict[str, Any]] = []
    for index, shard_jobs in enumerate(_chunks(half_jobs, 3)):
        manifests.append({
            "_replicates": REPLICATION_NOTE,
            "_shard": SHARD_NOTES[index],
            "_pin_enforcement": PIN_ENFORCEMENT_NOTE,
            **_pod_base(pins, training["pod_class"], "dataset"),
            "models": deepcopy(pins["pins"]["dataset"]["models"]),
            "custom_nodes": deepcopy(pins["pins"]["dataset"]["custom_nodes"]),
            "workflow": "../workflows/tensor_dataset_v2_api.json",
            "seed_fields": ["seed"],
            "uploads": [dict(upload)],
            "jobs": shard_jobs,
        })
    manifests.append({
        "_replicates": REPLICATION_NOTE,
        "_shard": FULLBODY_SHARD_NOTE,
        "_pin_enforcement": PIN_ENFORCEMENT_NOTE,
        **_pod_base(pins, training["pod_class"], "dataset_fullbody"),
        # Review-precedent D23 (anchor_edit): the fullbody manifest reuses the dataset
        # profile's own models/custom_nodes verbatim -- the repair tail (FaceBoundingBox,
        # ImageResizeKJv2, core KSampler/VAEEncode/VAEDecode/ImageScale/
        # ImageCompositeMasked/ConditioningZeroOut) needs no model or node this profile
        # doesn't already carry.
        "models": deepcopy(pins["pins"]["dataset"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["dataset"]["custom_nodes"]),
        "workflow": "../workflows/tensor_dataset_fullbody_api.json",
        "seed_fields": ["seed"],
        "uploads": [dict(upload)],
        "jobs": full_jobs,
    })
    return manifests


def _fullbody_dataset_workflow(dataset_workflow: dict[str, Any]) -> dict[str, Any]:
    """Graft the fullbody face-repair tail (nodes 950-958) onto an already
    persona-generalized dataset workflow dict, so the copy `_copy_support_files` writes
    into the plan is persona-specific (references, identity clauses) the same way the v2
    workflow copy is -- never a second, independently-substituted read of the source
    file."""
    workflow = deepcopy(dataset_workflow)
    tail = _read_json(FULLBODY_WORKFLOW_PATH)
    for node_id in ("950", "951", "952", "953", "954", "955", "956", "957", "958"):
        workflow[node_id] = deepcopy(tail[node_id])
    workflow["832"]["inputs"]["images"] = ["958", 0]
    return workflow


def _anchor_manifests(
    persona: dict, training: dict, pins: dict, prompts: dict[str, Any],
) -> list[dict[str, Any]]:
    short = _creator_output_code(persona["id"])
    passport = {
        **_pod_base(pins, training["pod_class"], "anchor"),
        "models": deepcopy(pins["pins"]["anchor"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["anchor"]["custom_nodes"]),
        "workflow": "../workflows/zimage_passport_api.json",
        "seed_fields": ["seed"],
        "jobs": [{"seed": 148 + i, "output_name": f"{short}-anchor-p{i + 1:02d}",
                  "expected_images": 1,
                  "substitutions": [{"node_id": "4", "field": "text",
                      "value": prompts["passport"]["identity"] + " " + row}]}
                 for i, row in enumerate(prompts["passport"]["rows"])],
    }
    names = [Path(v).name for v in persona["identity"]["references"]]
    # Review LOW-11: no per-job filename_prefix override belongs here -- `apply_job`
    # (pod/runpod_run.py) always overwrites any node's `filename_prefix` input with the
    # job's own `output_name`, so setting it on this shared workflow template was a no-op
    # that read as load-bearing.
    workflow = _generalized_dataset_workflow(persona, _generalized_prompts(persona))
    edit = {
        **_pod_base(pins, training["pod_class"], "anchor_edit"),
        "models": deepcopy(pins["pins"]["anchor_edit"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["anchor_edit"]["custom_nodes"]),
        "workflow": workflow, "seed_fields": ["seed"],
        "uploads": [{"files": [f"_uploads/{persona['id']}/{n}" for n in names],
                     "subfolder": persona["id"], "type": "input", "overwrite": True}],
        "jobs": [{"seed": 241731167782064,
                  "output_name": f"{short}-anchor-e{i + 1:02d}", "expected_images": 1,
                  "substitutions": [
                      {"node_id": "788", "field": "seed", "value": 1098688918602660 + i},
                      {"node_id": "174", "field": "prompt",
                       "value": prompts["edit"]["identity"] + " " + row},
                      # Review MED-6: node 800 is a second CLIPTextEncode later in the
                      # inherited dataset graph (a face-repair resample at denoise 0.23) that
                      # otherwise keeps the DATASET template's makeup register, contradicting
                      # node 174's anchor identity clause within the same job. Both nodes now
                      # carry the identical persona-derived clause.
                      {"node_id": "800", "field": "text",
                       "value": prompts["edit"]["identity"]}]}
                 for i, row in enumerate(prompts["edit"]["rows"])],
    }
    return [passport, edit]


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
    persona: dict, training: dict, pins: dict, *, smoke: bool, dataset_dirname: str | None = None,
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
    # Path-A train-first (r24 method 4) points uploads at its OWN copied dataset
    # directory (never `<id>-tensor-dataset`, which is the module-10 dataset stage's
    # operator-graded output) so the two lineages can never collide on disk.
    dataset_dirname = dataset_dirname or f"{creator_id}-tensor-dataset"
    upload_files = [f"{dataset_dirname}/*.png"]
    if training["caption_mode"] == "provided":
        upload_files.append(f"{dataset_dirname}/*.txt")
    upload_files.append(f"{dataset_dirname}/training.json")
    manifest.update(_pod_base(pins, training["pod_class"], stage))
    if not smoke:
        # Defect fix: derive job_timeout_seconds/max_minutes from steps + dop_enabled
        # instead of leaving the static pod-class pin in place regardless of them.
        manifest["_budget"] = _apply_train_budget(
            manifest, training, num_artifacts=len(intermediates) + 1,
        )
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
                "files": [f"{dataset_dirname}/_dataset.ready"],
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


def _persona_trigger_clause(training: dict) -> str:
    """The `"<trigger> <noun>, "` prefix every tester/gen/detail-only prompt must open
    with (r24/r25 evidence: the train-first LoRA's own tester prompt carried NO trigger
    word, so every checkpoint rendered as the base model's generic woman -- facenet
    0.17-0.23 vs anchors, i.e. a stranger -- because ai-toolkit's LoRA identity is only
    ever invoked by naming the trigger in the prompt text, never implicitly just by being
    loaded). `training["dop_class"]` is the class-DOP regularization target
    (training_config.py DEFAULT_TRAINING) -- it is NOT required to echo the caption's own
    descriptive noun and happens to read "woman" on every real persona today, so "woman"
    is the explicit fallback. Applies to every persona, DOP-enabled or not."""
    trigger = training["trigger"]
    noun = training.get("dop_class") or "woman"
    return f"{trigger} {noun}, "


def _compose_triggered_prompt(training: dict, body: str) -> str:
    """Prefix `body` (an already-composed scene/look/description clause) with the
    persona's own trigger so the LoRA is always explicitly invoked -- the single helper
    `_tester_manifest` (`_tester_workflow`), `_gen_manifest` (`_generalized_gen_prompts`),
    and `_detail_manifest` all route through."""
    return _persona_trigger_clause(training) + body


def _tester_workflow(creator_id: str, training: dict) -> dict[str, Any]:
    trigger = training["trigger"]
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
            "text": _compose_triggered_prompt(training, (
                "Close-up portrait photograph of an adult woman in her mid twenties, "
                "shoulders up, facing the camera, neutral relaxed expression with a faint "
                "smile. Natural skin texture with visible pores and fine flyaway hairs, "
                "no retouching. She wears a plain fitted black crew-neck top. Soft even "
                "daylight from a window camera-left, plain warm off-white wall behind her, "
                "shallow depth of field, shot on a phone camera."
            )),
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


def _tester_manifest(
    persona: dict, training: dict, pins: dict, *, train_out_dirname: str | None = None,
) -> dict[str, Any]:
    creator_id = persona["id"]
    trigger = training["trigger"]
    # Path-A train-first (r24 method 4): the tester's checkpoint upload glob must point
    # at the SAME `out/<dirname>/` the matching train manifest's harness run wrote its
    # local output into (`_planned_run`'s `run_root / path.stem`), never the module-10
    # dataset lineage's `<id>-tensor-train` unconditionally.
    train_out_dirname = train_out_dirname or f"{creator_id}-tensor-train"
    intermediates = _checkpoint_steps(training["steps"], training["save_every"])
    checkpoints: list[tuple[int | None, str]] = [
        (step, f"{step:09d}") for step in intermediates
    ] + [(None, "final")]
    return {
        **_pod_base(pins, training["pod_class"], "tester"),
        "models": deepcopy(pins["pins"]["tester"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["tester"]["custom_nodes"]),
        "workflow": _tester_workflow(creator_id, training),
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [{
            "files": [f"out/{train_out_dirname}/*.safetensors"],
            "subfolder": trigger,
            "type": "input",
            "overwrite": True,
            "chunk_bytes": 16777216,
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
            **({"wait_for": "_loras.assembled"} if index == 0 else {}),
            "substitutions": [{
                "node_id": "4",
                "field": "lora_name",
                "value": _checkpoint_name(trigger, step),
            }],
        } for index, (step, label) in enumerate(checkpoints)],
    }


# ---------------------------------------------------------------------------
# Generation (module 09, Track-2 Task D2) + the cheap re-detail mode (r25 cause #2)
# ---------------------------------------------------------------------------

GEN_ROW_SEED_BASE = 269789944143426
DETAIL_SEED_BASE = 100200300


def _generalized_gen_prompts(persona: dict, training: dict) -> dict[str, Any]:
    """Build the gen-stage's rows entirely from `gen-prompts.yaml`'s generic photography
    vocabulary plus the persona's own `identity.look` (same discipline as
    `_generalized_anchor_prompts` -- never a template-hardcoded face/body clause), each
    row opening with the persona's own trigger (`_compose_triggered_prompt`) so the LoRA
    is always explicitly invoked."""
    prompts = _read_json(GEN_PROMPTS_PATH)
    prompts["persona"] = persona["id"]
    look = persona.get("identity", {}).get("look")
    if not isinstance(look, dict):
        raise FigmentTrainError(
            "persona.identity.look is required to compose the gen-stage prompts"
        )
    clause = _compose_look_clause(look)
    prompts["rows"] = [
        _compose_triggered_prompt(
            training, prompts["base_clause"].format(look=clause, scene=scene),
        )
        for scene in prompts["scenes"]
    ]
    return prompts


def _gen_workflow(training: dict, pins: dict) -> dict[str, Any]:
    """Load `krea2_gen_api.json` and, when `training.style_lora` is unset, delete node
    `40` (the style `LoraLoaderModelOnly`) and rewire nodes `8`/`15`/`33`'s `model` input
    back to the identity LoRA (node `4`) -- no bypassed node ever ships in a manifest
    (Track-2 Task D2)."""
    workflow = _read_json(GEN_WORKFLOW_PATH)
    style_key = training.get("style_lora")
    if style_key is None:
        del workflow["40"]
        for node_id in ("8", "15", "33"):
            if workflow[node_id]["inputs"].get("model") == ["40", 0]:
                workflow[node_id]["inputs"]["model"] = ["4", 0]
    else:
        try:
            pins["pins"]["style_loras"][style_key]
        except KeyError as exc:
            raise FigmentTrainError(
                f"unknown training.style_lora key {style_key!r}"
            ) from exc
        workflow["40"]["inputs"]["strength_model"] = training["style_lora_strength"]
    return workflow


def _gen_manifest(
    persona: dict, training: dict, pins: dict, *, checkpoint_upload: str | None = None,
) -> dict[str, Any]:
    """`_gen_manifest` mirrors `_tester_manifest` -- `_pod_base`, `pins.gen`
    models/nodes, the lorapath launcher's `training` block, a chunked upload of ONLY the
    chosen checkpoint, `seed_fields: ["seed", "noise_seed"]` -- but plans generation, not
    testing: one job per gen-prompts row, each producing base + refined + detailed
    (`expected_images: 3`). Raises until GATE 3 has recorded a checkpoint (Task A3/C2)."""
    chosen_step = training.get("chosen_checkpoint_step")
    if chosen_step is None:
        raise FigmentTrainError(
            "gen requires a chosen checkpoint; run apply-rulings --stage tester first"
        )
    creator_id = persona["id"]
    trigger = training["trigger"]
    short = _creator_output_code(creator_id)
    checkpoint_name = _checkpoint_name(trigger, chosen_step)
    prompts = _generalized_gen_prompts(persona, training)
    workflow = _gen_workflow(training, pins)

    models = deepcopy(pins["pins"]["gen"]["models"])
    style_key = training.get("style_lora")
    if style_key is not None:
        style_pin = pins["pins"]["style_loras"][style_key]
        models.append(deepcopy(style_pin["model"]))

    jobs = []
    for index, row in enumerate(prompts["rows"]):
        substitutions = [
            {"node_id": "5", "field": "text", "value": row},
            {"node_id": "4", "field": "lora_name", "value": checkpoint_name},
            # seed_fields sweeps every "seed" input (including nodes 15/33) to the job's
            # own seed for base-image diversity; pin the refine and detail passes back to
            # a fixed seed the same way the hand-written manifest pinned node 15 (module
            # 09's own convention -- only the base render varies per job).
            {"node_id": "15", "field": "seed", "value": 40},
            {"node_id": "33", "field": "seed", "value": 40},
        ]
        if style_key is not None:
            substitutions.append({
                "node_id": "40", "field": "lora_name",
                "value": pins["pins"]["style_loras"][style_key]["model"]["filename"],
            })
        jobs.append({
            "seed": GEN_ROW_SEED_BASE + index,
            "output_name": f"{short}-tensor-gen-{index + 1:02d}",
            "expected_images": 3,
            **({"wait_for": "_loras.assembled"} if index == 0 else {}),
            "substitutions": substitutions,
        })

    checkpoint_upload = checkpoint_upload or f"out/{creator_id}-tensor-train/{checkpoint_name}"
    return {
        **_pod_base(pins, training["pod_class"], "gen"),
        "models": models,
        "custom_nodes": deepcopy(pins["pins"]["gen"]["custom_nodes"]),
        "workflow": workflow,
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [{
            "files": [checkpoint_upload],
            "subfolder": trigger,
            "type": "input",
            "overwrite": True,
            "chunk_bytes": 16777216,
        }],
        "training": {
            "lora_source_dir": f"/workspace/ComfyUI/input/{trigger}",
            "start_script_path": "/workspace/start-comfy-lorapath.sh",
            "start_script_file": "start-comfy-lorapath.sh.template",
        },
        "jobs": jobs,
    }


def _copy_detail_images(out: Path, persona: dict, image_paths: list[Path]) -> list[str]:
    """Copy each `--detail-images` match into the plan's own upload tree
    (`_uploads/<persona>/<name>`, the same convention `_copy_support_files` uses for
    anchor references) -- `pod/runpod_run.py`'s upload expansion refuses any path outside
    the manifest's own directory, so a source image living anywhere else on disk must be
    staged inside `out` before a manifest can reference it."""
    upload_dir = out / "train" / "runs" / "_uploads" / persona["id"]
    upload_dir.mkdir(parents=True, exist_ok=True)
    names: list[str] = []
    seen: set[str] = set()
    for source in image_paths:
        source = Path(source).resolve()
        if not source.is_file():
            raise FigmentTrainError(f"--detail-images match is not a file: {source}")
        name = source.name
        if name in seen:
            raise FigmentTrainError(
                f"--detail-images matched two files with the same name {name!r}"
            )
        seen.add(name)
        shutil.copy2(source, upload_dir / name)
        names.append(name)
    return names


def _detail_manifest(
    persona: dict, training: dict, pins: dict, names: list[str], *,
    checkpoint_upload: str | None = None,
) -> dict[str, Any]:
    """r25 ranked cause #2, made durable: re-detail already-rendered Track-1
    tester/dataset cells (named by `names`, already staged under
    `train/runs/_uploads/<persona>/` by `_copy_detail_images`) at the package's own
    denoise band without spending a full regeneration. Two jobs per image -- `denoise
    0.15` and `denoise 0.27` -- both loading the same chosen checkpoint `_gen_manifest`
    uses, sharing one seed per source image so the pair is a controlled A/B."""
    chosen_step = training.get("chosen_checkpoint_step")
    if chosen_step is None:
        raise FigmentTrainError(
            "gen requires a chosen checkpoint; run apply-rulings --stage tester first"
        )
    creator_id = persona["id"]
    trigger = training["trigger"]
    short = _creator_output_code(creator_id)
    checkpoint_name = _checkpoint_name(trigger, chosen_step)
    workflow = _read_json(DETAIL_WORKFLOW_PATH)
    workflow["5"]["inputs"]["text"] = _compose_triggered_prompt(
        training, workflow["5"]["inputs"]["text"],
    )

    jobs = []
    for image_index, name in enumerate(names):
        for variant_index, denoise in enumerate((0.15, 0.27)):
            job_index = image_index * 2 + variant_index
            jobs.append({
                "seed": DETAIL_SEED_BASE + image_index,
                "output_name": f"{short}-tensor-detail-{image_index + 1:02d}-d{str(denoise).replace('.', '')}",
                "expected_images": 1,
                **({"wait_for": "_loras.assembled"} if job_index == 0 else {}),
                "substitutions": [
                    {"node_id": "1", "field": "image", "value": f"{creator_id}/{name}"},
                    {"node_id": "4", "field": "lora_name", "value": checkpoint_name},
                    {"node_id": "15", "field": "denoise", "value": denoise},
                ],
            })

    checkpoint_upload = checkpoint_upload or f"out/{creator_id}-tensor-train/{checkpoint_name}"
    return {
        **_pod_base(pins, training["pod_class"], "detail"),
        "models": deepcopy(pins["pins"]["detail"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["detail"]["custom_nodes"]),
        "workflow": workflow,
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [
            {
                "files": [f"_uploads/{creator_id}/{name}" for name in names],
                "subfolder": creator_id,
                "type": "input",
                "overwrite": True,
            },
            {
                "files": [checkpoint_upload],
                "subfolder": trigger,
                "type": "input",
                "overwrite": True,
                "chunk_bytes": 16777216,
            },
        ],
        "training": {
            "lora_source_dir": f"/workspace/ComfyUI/input/{trigger}",
            "start_script_path": "/workspace/start-comfy-lorapath.sh",
            "start_script_file": "start-comfy-lorapath.sh.template",
        },
        "jobs": jobs,
    }


def _render_training_config(
    trigger: str, steps: int, save_every: int, *,
    dop_enabled: bool = False, dop_multiplier: float = 1.0, dop_class: str = "person",
) -> dict[str, Any]:
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
        # Path-A train-first (r24 method 4 + r21 DOP): off by default -- every existing
        # `build_plan` caller below passes none of these, so it keeps rendering exactly
        # the same config it always has.
        "dop_enabled": str(dop_enabled).lower(),
        "dop_multiplier": str(dop_multiplier),
        "dop_class": dop_class,
    })
    rendered = renderer.render(AI_TEMPLATE_PATH.read_text(encoding="utf-8"), context)
    config = renderer.yaml.safe_load(rendered)
    renderer.apply_dop_trigger_word(config, trigger)
    try:
        renderer.validate_rendered_pod_paths(config)
    except ValueError as exc:
        raise FigmentTrainError(f"rendered training config is unsafe: {exc}") from exc
    return config


def _copy_anchors(out: Path, persona: dict) -> list[str]:
    """Copy this persona's identity reference images into `out`'s own upload tree and
    return their `out`-relative paths, in `persona.yaml` order. Shared by `build_plan`
    (via `_copy_support_files`) and `build_train_first_plan` -- both plan.json flavors
    need `plan["assets"]["anchors"]` populated with real, `out`-relative files for
    `build_grade`/`_run_identity_gate` to find, regardless of whether this plan also
    stages a fresh anchor/dataset run."""
    anchor_paths = []
    persona_dir = Path(persona["_persona_path"]).parent
    anchor_dir = out / "expand" / "runs" / "_uploads" / persona["id"]
    anchor_dir.mkdir(parents=True, exist_ok=True)
    for relative in persona["identity"]["references"]:
        source = (persona_dir / relative).resolve()
        target = anchor_dir / source.name
        shutil.copy2(source, target)
        anchor_paths.append(_relative(target, out))
    return anchor_paths


def _persona_dir_asset(persona: dict) -> str:
    """ROOT-relative (never `out`-relative, review MED-8: the persona dir usually lives
    outside `out` entirely) path for `plan["assets"]["persona_dir"]`. Shared by
    `build_plan` and `build_train_first_plan` so both plan.json flavors resolve it the
    same way (`_load_persona_document_for_gate`, apply_rulings' anchor promotion)."""
    return Path(persona["_persona_path"]).resolve().parent.relative_to(
        ROOT.resolve(), walk_up=True,
    ).as_posix()


def _copy_support_files(out: Path, persona: dict, prompts: dict, workflow: dict) -> dict[str, Any]:
    expand_workflow = out / "expand" / "workflows" / WORKFLOW_PATH.name
    fullbody_workflow = out / "expand" / "workflows" / FULLBODY_WORKFLOW_PATH.name
    anchor_workflow = out / "expand" / "workflows" / ANCHOR_WORKFLOW_PATH.name
    expand_prompts = out / "expand" / "templates" / PROMPTS_PATH.name
    # Review LOW-10: the anchor prompts were the one thing `_copy_support_files` didn't
    # bundle -- `plan.json` copied the dataset template but not this one, so it was not a
    # self-contained reproduction of what the anchor stage actually rendered.
    expand_anchor_prompts = out / "expand" / "templates" / ANCHOR_PROMPTS_PATH.name
    train_runs = out / "train" / "runs"
    _write_json(expand_workflow, workflow)
    _write_json(fullbody_workflow, _fullbody_dataset_workflow(workflow))
    _write_json(anchor_workflow, _read_json(ANCHOR_WORKFLOW_PATH))
    _write_json(expand_prompts, prompts)
    _write_json(expand_anchor_prompts, _generalized_anchor_prompts(persona))
    train_runs.mkdir(parents=True, exist_ok=True)
    for source in (TRAIN_START_PATH, TESTER_START_PATH):
        text = source.read_text(encoding="utf-8")
        text = text.replace("creator-001", persona["id"])
        text = text.replace("creator001krea2", persona["training"]["trigger"])
        (train_runs / source.name).write_text(text, encoding="utf-8")

    return {
        "anchors": _copy_anchors(out, persona),
        "dataset_workflow": _relative(expand_workflow, out),
        "dataset_fullbody_workflow": _relative(fullbody_workflow, out),
        "dataset_prompts": _relative(expand_prompts, out),
        "anchor_prompts": _relative(expand_anchor_prompts, out),
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
    result = {
        "manifest": _relative(manifest_path, out),
        "sha256": _sha256(manifest_path),
        "ceiling_usd": ceiling,
        "out": _relative(run_out, out),
        "argv": argv,
        "cli": subprocess.list2cmdline(argv),
    }
    if "_budget" in manifest:
        result["budget"] = manifest["_budget"]
    return result


def build_plan(
    creator_id: str,
    stage: str,
    out: Path,
    *,
    personas_root: Path = PERSONAS_ROOT,
    skip_pin_verify: bool = False,
    detail_images: str | None = None,
) -> dict[str, Any]:
    """Generate a complete, immutable plan without touching the hand-written runs.

    `detail_images` (Track-2 Task D2, r25 cause #2) is a local glob pattern, meaningful
    only when `"gen"` is being planned: each match is staged into the plan's own upload
    tree and an extra `<id>-tensor-detail.yaml` manifest is emitted alongside
    `<id>-tensor-gen.yaml`, re-detailing those existing cells instead of regenerating.
    """
    if stage not in (*STAGES, "all"):
        raise FigmentTrainError(f"unknown stage {stage!r}")
    if detail_images is not None and stage not in ("gen", "all"):
        raise FigmentTrainError("--detail-images is only meaningful for --stage gen")
    out = Path(out).resolve()
    if (out / "plan.json").exists():
        raise FigmentTrainError(f"refusing to overwrite an existing plan: {out / 'plan.json'}")
    if out.exists() and any(out.iterdir()):
        raise FigmentTrainError(f"plan output directory must be empty: {out}")
    out.mkdir(parents=True, exist_ok=True)

    persona, training, pins = _load_inputs(creator_id, Path(personas_root))
    persona = dict(persona)
    persona["_persona_path"] = str(Path(personas_root) / creator_id / "persona.yaml")

    selected = list(STAGES if stage == "all" else (stage,))
    if persona["identity"].get("history") and "anchor" in selected:
        if stage != "all":
            raise FigmentTrainError(
                f"{creator_id} already has a promoted anchor (identity.history is non-empty); "
                "the anchor stage cannot be replanned without clearing it by hand"
            )
        selected.remove("anchor")
    # "gen" is only ever planned explicitly, after GATE 3 (Task D2 step5) -- never as
    # part of a `--stage all` chain, alongside the promoted-anchor exclusion above.
    if stage == "all" and "gen" in selected:
        selected.remove("gen")

    if not skip_pin_verify:
        _verify_pins_preflight(pins, selected)
        if detail_images and "gen" in selected:
            # `detail` is not a top-level STAGES entry (it rides along with a "gen"
            # plan when --detail-images is given), so STAGE_PIN_PROFILES's per-stage
            # lookup never reaches it -- verify it directly, same fail-closed contract.
            module = _verify_pins_module()
            try:
                results = module.verify_pins(pins, stages=["detail"])
            except module.VerifyPinsError as exc:
                raise FigmentTrainError(f"pin verification could not run: {exc}") from exc
            if results:
                lines = [
                    f"[detail] {problem}"
                    for problems in results.values() for problem in problems
                ]
                raise FigmentTrainError("pin verification failed:\n" + "\n".join(lines))

    prompts = _generalized_prompts(persona)
    workflow = _generalized_dataset_workflow(persona, prompts)
    assets = _copy_support_files(out, persona, prompts, workflow)
    # Review MED-8: store repo-relative (against ROOT), never an absolute machine path --
    # every other asset is `out`-relative, but the persona directory usually lives OUTSIDE
    # `out` entirely (a scratch/tmp plan dir vs. `orgs/figment/personas/<id>`), so it is
    # made relative to ROOT instead: a plan moved to a different checkout of the same repo
    # still resolves to the right tree. `walk_up=True` (3.12+) also covers the common test
    # fixture where the persona lives under a tmp_path outside ROOT entirely.
    assets["persona_dir"] = _persona_dir_asset(persona)

    configs_dir = out / "train" / "configs"
    smoke_config = configs_dir / "training-smoke.json"
    full_config = configs_dir / "training.json"
    _write_json(smoke_config, _render_training_config(training["trigger"], 100, 50))
    _write_json(
        full_config,
        _render_training_config(training["trigger"], training["steps"], training["save_every"]),
    )

    plan_stages: dict[str, Any] = {}
    for current in selected:
        if current == "anchor":
            manifests = _anchor_manifests(
                persona, training, pins, _generalized_anchor_prompts(persona),
            )
            paths = [
                out / "expand" / "runs" / f"{creator_id}-anchor-{arm}.yaml"
                for arm in ("passport", "edit")
            ]
        elif current == "dataset":
            manifests = _dataset_manifests(persona, training, pins, prompts)
            paths = [
                out / "expand" / "runs" / f"{creator_id}-tensor-dataset-shard-{n:02d}.yaml"
                for n in range(1, 4)
            ] + [out / "expand" / "runs" / f"{creator_id}-tensor-dataset-fullbody.yaml"]
        elif current == "smoke":
            manifests = [_train_manifest(persona, training, pins, smoke=True)]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-train-smoke.yaml"]
        elif current == "train":
            manifests = [_train_manifest(persona, training, pins, smoke=False)]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-train.yaml"]
        elif current == "tester":
            manifests = [_tester_manifest(persona, training, pins)]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-tester.yaml"]
        elif current == "gen":
            checkpoint_upload = _stage_accepted_checkpoint(out, persona, training)
            gen_manifest = _gen_manifest(
                persona, training, pins, checkpoint_upload=checkpoint_upload,
            )
            gen_workflow_path = out / "train" / "workflows" / "krea2_gen_api.json"
            _write_json(gen_workflow_path, gen_manifest.pop("workflow"))
            gen_manifest["workflow"] = "../workflows/krea2_gen_api.json"
            manifests = [gen_manifest]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-gen.yaml"]
            if detail_images:
                image_paths = sorted(Path(p) for p in glob.glob(detail_images))
                if not image_paths:
                    raise FigmentTrainError(
                        f"--detail-images matched no files: {detail_images!r}"
                    )
                names = _copy_detail_images(out, persona, image_paths)
                detail_manifest = _detail_manifest(
                    persona, training, pins, names, checkpoint_upload=checkpoint_upload,
                )
                detail_workflow_path = out / "train" / "workflows" / "krea2_detail_only_api.json"
                _write_json(detail_workflow_path, detail_manifest.pop("workflow"))
                detail_manifest["workflow"] = "../workflows/krea2_detail_only_api.json"
                manifests.append(detail_manifest)
                paths.append(out / "train" / "runs" / f"{creator_id}-tensor-detail.yaml")
        else:
            raise FigmentTrainError(f"unknown stage {current!r}")
        for path, manifest in zip(paths, manifests):
            _write_json(path, manifest)
        run_root = out / ("expand" if current in ("anchor", "dataset") else "train") / "runs" / "out"
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


TRAIN_FIRST_DATASET_MARKERS = ("_dataset.ready", "dataset_manifest.json")


def accept_train_first_dataset(
    creator_id: str, dataset_dir: Path, *, decided_by: str, decided_at: str,
) -> dict[str, Any]:
    """Record an explicit operator acceptance of an existing captioned dataset."""
    if not decided_by.strip() or not decided_at.strip():
        raise FigmentTrainError("dataset acceptance requires decided_by and decided_at")
    dataset_dir = Path(dataset_dir).resolve()
    approval_path = dataset_dir / "dataset-approval.json"
    if approval_path.exists():
        raise FigmentTrainError(f"refusing to overwrite dataset approval: {approval_path}")
    try:
        subject = _lineage_module().dataset_subject(dataset_dir)
    except ValueError as exc:
        raise FigmentTrainError(f"dataset cannot be accepted: {exc}") from exc
    if subject["count"] < 20:
        raise FigmentTrainError(
            f"dataset has only {subject['count']} images; training requires at least 20"
        )
    document = _lineage_module().wrap_subject(
        _lineage_module().DATASET_APPROVAL_SCHEMA, subject,
        creator=creator_id, decision="verified",
        decided_by=decided_by.strip(), decided_at=decided_at.strip(),
    )
    _write_json(approval_path, document)
    return document


def _validated_train_first_dataset(creator_id: str, dataset_dir: Path) -> dict[str, Any]:
    approval_path = dataset_dir / "dataset-approval.json"
    if not approval_path.is_file():
        raise FigmentTrainError(
            f"train-first dataset has no operator provenance at {approval_path}. For an "
            "existing historical dataset, inspect its full-resolution images and captions, "
            "then run `figment_train.py accept-dataset --creator ... --dataset-dir ... "
            "--decided-by ... --decided-at ...`; a legacy ready marker is insufficient."
        )
    approval = _read_json(approval_path)
    if (approval.get("schema") != _lineage_module().DATASET_APPROVAL_SCHEMA
            or approval.get("creator") != creator_id
            or approval.get("decision") != "verified"
            or not isinstance(approval.get("decided_by"), str)
            or not approval["decided_by"].strip()
            or not isinstance(approval.get("decided_at"), str)
            or not approval["decided_at"].strip()):
        raise FigmentTrainError("train-first dataset approval is malformed or belongs to another creator")
    try:
        current = _lineage_module().dataset_subject(dataset_dir)
        _lineage_module().assert_current(
            approval, current, label="train-first dataset operator approval",
        )
    except ValueError as exc:
        raise FigmentTrainError(str(exc)) from exc
    if current["count"] < 20:
        raise FigmentTrainError(
            f"train-first dataset has only {current['count']} images; training requires at least 20"
        )
    return approval


def _approved_dataset_names(approval: dict[str, Any]) -> set[str]:
    subject = approval.get("subject") or {}
    rows = subject.get("files") or []
    names = {"dataset_manifest.json", "dataset-approval.json"}
    for row in rows:
        if not isinstance(row, dict):
            raise FigmentTrainError("dataset approval has a malformed file inventory")
        for kind in ("image", "caption"):
            entry = row.get(kind)
            name = entry.get("name") if isinstance(entry, dict) else None
            if not isinstance(name, str) or Path(name).name != name:
                raise FigmentTrainError("dataset approval has a malformed file inventory")
            names.add(name)
    return names


def _assert_exact_staged_dataset(dataset_dir: Path, approval: dict[str, Any]) -> None:
    expected = _approved_dataset_names(approval) | {"_dataset.ready", "training.json"}
    actual = {item.name for item in dataset_dir.iterdir()}
    if actual != expected:
        raise FigmentTrainError(
            "staged training dataset has unexpected or missing entries; "
            f"missing={sorted(expected - actual)}, unexpected={sorted(actual - expected)}"
        )
    for name in sorted(expected):
        item = dataset_dir / name
        if item.is_symlink() or not item.is_file():
            raise FigmentTrainError(
                f"staged training dataset entry must be a regular file, not a symlink: {name}"
            )


def build_train_first_plan(
    creator_id: str,
    dataset_dir: Path,
    out: Path,
    *,
    personas_root: Path = PERSONAS_ROOT,
    skip_pin_verify: bool = False,
) -> dict[str, Any]:
    """Path-A train-first (r24 method 4 + r21 DOP + r25 causes #4/#5): plan a train +
    tester run directly against an ALREADY-BUILT, ALREADY-CAPTIONED dataset directory
    -- `select_training_cells.py` + `build_training_set.py --mode provided`'s output --
    instead of the module-10 dataset stage's fresh generate-then-grade loop.

    Emits the SAME `plan.json` (`figment/train-plan@1`) `build_plan` does, just with
    `stages` limited to `{train, tester}` and a top-level `variant: "train-first"`
    marker (`_install_stage_config`'s only fork on it -- this plan's dataset copy and
    training.json are already fully rendered below, so there is no module-10
    "grade/dataset" ruling step to gate on). That one shared schema is what lets
    `run --stage train|tester|all`, `grade --stage tester`, `apply-rulings`, and `gate`
    all work unchanged against a train-first plan: only `build_plan` itself (never
    `run`/`grade`/`gate`) needs to know how a plan.json was produced. `build_plan`
    still never plans "anchor" or "dataset" for this lineage -- `train-first` is a
    thin sibling entry point, not a `build_plan` stage choice -- and the manifests it
    emits (`<id>-tensor-train-first.yaml`, `<id>-tensor-tester-first.yaml`) are named
    so their local upload/output directories (`<id>-tensor-dataset-train-first`,
    `out/<id>-tensor-train-first/`) can never collide with the module-10 lineage's own
    `<id>-tensor-dataset` / `out/<id>-tensor-train/`. DOP rides whatever
    `training.dop_enabled` / `dop_multiplier` / `dop_class` the persona already
    declares (default off, training_config.py) -- this function never overrides them;
    the "train-first" idea and DOP are independent choices that happen to ship
    together here.

    `dataset_dir` must carry `_dataset.ready`, `dataset_manifest.json`, and a current
    operator `dataset-approval.json`. Every image hash, caption, count, and approval
    subject is verified before copying; this function never selects or captions cells.
    """
    dataset_dir = Path(dataset_dir).resolve()
    if not all((dataset_dir / marker).is_file() for marker in TRAIN_FIRST_DATASET_MARKERS):
        raise FigmentTrainError(
            f"dataset_dir is not ready (missing {' or '.join(TRAIN_FIRST_DATASET_MARKERS)}): "
            f"{dataset_dir}"
        )
    dataset_approval = _validated_train_first_dataset(creator_id, dataset_dir)
    out = Path(out).resolve()
    # Same guard build_plan uses, against the same filename -- a train-first plan is a
    # `plan.json` like any other, not a separately-named artifact.
    if (out / "plan.json").exists():
        raise FigmentTrainError(f"refusing to overwrite an existing plan: {out / 'plan.json'}")
    if out.exists() and any(out.iterdir()):
        raise FigmentTrainError(f"plan output directory must be empty: {out}")
    out.mkdir(parents=True, exist_ok=True)

    persona, training, pins = _load_inputs(creator_id, Path(personas_root))
    persona = dict(persona)
    persona["_persona_path"] = str(Path(personas_root) / creator_id / "persona.yaml")
    # The "training" block build_plan's plan.json already carries (dop_*, steps,
    # save_every, trigger, ...) plus this variant's one extra fact: which already-built
    # dataset directory it trained from. `_train_manifest`/`_tester_manifest`/
    # `_render_training_config` only ever read the specific keys they know about, so
    # this extra key rides along harmlessly wherever `training` is passed on below.
    training = {**training, "dataset_dir": str(dataset_dir)}

    if not skip_pin_verify:
        _verify_pins_preflight(pins, ["train", "tester"])

    # Same anchor files `build_plan` stages via `_copy_support_files` -- `grade --stage
    # tester` (`build_grade`) needs `plan["assets"]["anchors"]` to resolve to real,
    # `out`-relative files exactly the same way for either plan.json flavor.
    assets = {"anchors": _copy_anchors(out, persona), "persona_dir": _persona_dir_asset(persona)}

    train_runs_dir = out / "train" / "runs"
    train_runs_dir.mkdir(parents=True, exist_ok=True)
    # Same launcher templates every other stage's plan copies alongside its manifests
    # (`_copy_support_files`) -- the harness resolves `training.start_script_file`
    # relative to the manifest's own directory, so a train-first plan needs its own
    # copy too, not a reference back into the module-10 lineage's plan tree.
    for source in (TRAIN_START_PATH, TESTER_START_PATH):
        text = source.read_text(encoding="utf-8")
        text = text.replace("creator-001", creator_id)
        text = text.replace("creator001krea2", training["trigger"])
        (train_runs_dir / source.name).write_text(text, encoding="utf-8")

    plan_dataset_dirname = f"{creator_id}-tensor-dataset-train-first"
    plan_dataset_dir = train_runs_dir / plan_dataset_dirname
    plan_dataset_dir.mkdir(parents=True, exist_ok=True)
    # Copy only the operator-approved inventory. Arbitrary source side files never
    # enter a plan, even if their extension would match a later upload glob.
    for name in sorted(_approved_dataset_names(dataset_approval)):
        item = dataset_dir / name
        if item.is_symlink() or not item.is_file():
            raise FigmentTrainError(
                f"approved dataset entry must be a regular file, not a symlink: {name}"
            )
        shutil.copy2(item, plan_dataset_dir / name)

    config = _render_training_config(
        training["trigger"], training["steps"], training["save_every"],
        dop_enabled=training["dop_enabled"], dop_multiplier=training["dop_multiplier"],
        dop_class=training["dop_class"],
    )
    _write_json(plan_dataset_dir / "training.json", config)
    (plan_dataset_dir / "_dataset.ready").write_text("", encoding="utf-8")

    train_manifest = _train_manifest(
        persona, training, pins, smoke=False, dataset_dirname=plan_dataset_dirname,
    )
    train_path = train_runs_dir / f"{creator_id}-tensor-train-first.yaml"
    _write_json(train_path, train_manifest)

    train_out_dirname = f"{creator_id}-tensor-train-first"
    tester_manifest = _tester_manifest(
        persona, training, pins, train_out_dirname=train_out_dirname,
    )
    tester_path = train_runs_dir / f"{creator_id}-tensor-tester-first.yaml"
    _write_json(tester_path, tester_manifest)

    run_root = train_runs_dir / "out"
    train_run = _planned_run(out, train_path, run_root / train_path.stem)
    tester_run = _planned_run(out, tester_path, run_root / tester_path.stem)

    plan = {
        "schema": "figment/train-plan@1",
        "creator": creator_id,
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "generator": _sha256(Path(__file__)),
        "persona_sha256": _sha256(Path(persona["_persona_path"])),
        "training": training,
        "assets": assets,
        "configs": {"train": _relative(plan_dataset_dir / "training.json", out)},
        "ledger_dir": str(LEDGER_DIR),
        "arc_cap_usd": ARC_CAP_USD,
        "arc_ledger_glob": ARC_LEDGER_GLOB,
        "stages": {
            "train": {"runs": [train_run]},
            "tester": {"runs": [tester_run]},
        },
        # The one thing that makes this plan.json different from a `build_plan` one --
        # `_install_stage_config`'s only fork point (see this function's own docstring).
        "variant": "train-first",
        "dataset_approval": {
            "path": str((dataset_dir / "dataset-approval.json").resolve()),
            "sha256": _sha256(dataset_dir / "dataset-approval.json"),
            "subject_sha256": dataset_approval["subject_sha256"],
        },
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
    if stage == "gen":
        expected = plan.get("training", {}).get("chosen_checkpoint_sha256")
        if not isinstance(expected, str):
            raise FigmentTrainError("gen plan has no accepted checkpoint digest")
        for run in plan["stages"]["gen"]["runs"]:
            manifest_path = root / run["manifest"]
            manifest = _read_json(manifest_path)
            checkpoint_files = [
                value
                for upload in manifest.get("uploads") or []
                for value in upload.get("files") or []
                if isinstance(value, str) and value.endswith(".safetensors")
            ]
            if len(checkpoint_files) != 1 or any(ch in checkpoint_files[0] for ch in "*?[]"):
                raise FigmentTrainError("gen manifest must upload exactly one explicit checkpoint")
            staged = (manifest_path.parent / checkpoint_files[0]).resolve()
            try:
                staged.relative_to(root.resolve())
            except ValueError as exc:
                raise FigmentTrainError("gen checkpoint upload escapes the reviewed plan root") from exc
            if not staged.is_file() or _sha256(staged) != expected:
                raise FigmentTrainError(
                    "staged gen checkpoint changed after planning; create a fresh gen plan"
                )
        return
    if stage not in ("smoke", "train"):
        return
    if plan.get("variant") == "train-first":
        # build_train_first_plan already rendered training.json (with this plan's DOP
        # settings) and wrote `_dataset.ready` directly into its own
        # `<id>-tensor-dataset-train-first` copy -- there is no module-10
        # "grade/dataset" operator-ruling step in this lineage to gate on.
        if stage == "train":
            dataset_dir = root / "train" / "runs" / f"{plan['creator']}-tensor-dataset-train-first"
            approval = _validated_train_first_dataset(plan["creator"], dataset_dir)
            _assert_exact_staged_dataset(dataset_dir, approval)
            planned = plan.get("dataset_approval") or {}
            copied_path = dataset_dir / "dataset-approval.json"
            if (_sha256(copied_path) != planned.get("sha256")
                    or approval.get("subject_sha256") != planned.get("subject_sha256")):
                raise FigmentTrainError(
                    "train-first dataset approval differs from the approval captured by plan.json"
                )
            training = plan["training"]
            expected_config = _render_training_config(
                training["trigger"], training["steps"], training["save_every"],
                dop_enabled=training["dop_enabled"],
                dop_multiplier=training["dop_multiplier"], dop_class=training["dop_class"],
            )
            if _read_json(dataset_dir / "training.json") != expected_config:
                raise FigmentTrainError(
                    "train-first training.json changed after planning; create a fresh plan"
                )
        return
    dataset_dir = root / "train" / "runs" / f"{plan['creator']}-tensor-dataset"
    approved = root / "grade" / "dataset" / "approved-list.json"
    if not approved.is_file() or not (dataset_dir / "_dataset.ready").is_file():
        raise FigmentTrainError(
            "operator dataset rulings have not been applied; run grade and apply-rulings first"
        )
    _load_current_approval(plan, root, "dataset")
    dataset_approval = _validated_train_first_dataset(plan["creator"], dataset_dir)
    _assert_exact_staged_dataset(dataset_dir, dataset_approval)
    config_source = root / plan["configs"][stage]
    if not config_source.is_file():
        raise FigmentTrainError(f"planned {stage} config is missing: {config_source}")
    training = plan["training"]
    expected_config = (
        _render_training_config(training["trigger"], 100, 50)
        if stage == "smoke" else
        _render_training_config(training["trigger"], training["steps"], training["save_every"])
    )
    if _read_json(config_source) != expected_config:
        raise FigmentTrainError(
            f"planned {stage} training config changed; create a fresh plan"
        )
    shutil.copy2(config_source, dataset_dir / "training.json")


def _tester_checkpoint_inputs(plan: dict[str, Any], root: Path, run: dict[str, Any]) -> list[dict[str, Any]]:
    manifest_path = root / run["manifest"]
    if _sha256(manifest_path) != run["sha256"]:
        raise FigmentTrainError("tester manifest changed after planning")
    manifest = _read_json(manifest_path)
    expected = {
        item["value"]
        for job in manifest.get("jobs") or []
        for item in job.get("substitutions") or []
        if item.get("field") == "lora_name" and isinstance(item.get("value"), str)
    }
    matches: dict[str, Path] = {}
    for upload in manifest.get("uploads") or []:
        for pattern in upload.get("files") or []:
            if not isinstance(pattern, str) or ".safetensors" not in pattern:
                continue
            for raw in glob.glob(str(manifest_path.parent / pattern)):
                path = Path(raw).resolve()
                try:
                    path.relative_to(root.resolve())
                except ValueError as exc:
                    raise FigmentTrainError("tester checkpoint input escapes the plan root") from exc
                if path.name in matches:
                    raise FigmentTrainError(f"duplicate tester checkpoint input {path.name!r}")
                if not path.is_file() or path.stat().st_size <= 0:
                    raise FigmentTrainError(f"tester checkpoint input is missing or empty: {path}")
                matches[path.name] = path
    if set(matches) != expected:
        raise FigmentTrainError(
            f"tester checkpoint inputs do not match its candidate slate; "
            f"missing={sorted(expected - set(matches))}, unexpected={sorted(set(matches) - expected)}"
        )
    return [
        {
            "filename": name, "path": _relative(matches[name], root),
            "bytes": matches[name].stat().st_size, "sha256": _sha256(matches[name]),
        }
        for name in sorted(matches)
    ]


def _verify_tester_receipt_evidence(manifest: dict[str, Any], out_dir: Path) -> None:
    """Recheck the durable, non-cost portion of a completed tester receipt.

    Live execution already performs full ledger reconciliation before recording a run
    complete. Promotion repeats the receipt/job checks so later edits cannot turn a
    failed or unrelated tester run into checkpoint provenance.
    """
    receipt = _read_json(Path(out_dir) / "run.json")
    if not isinstance(receipt, dict) or receipt.get("error"):
        raise FigmentTrainError("checkpoint promotion requires a successful tester receipt")
    if receipt.get("dry_run") is not False:
        raise FigmentTrainError(
            "tester receipt dry_run must be boolean false to authorize checkpoint promotion"
        )
    if receipt.get("termination_verified") is not True:
        raise FigmentTrainError("checkpoint promotion requires tester teardown verification")
    if any(
        row.get("termination_verified") is not True
        for row in receipt.get("placement_attempts") or []
    ):
        raise FigmentTrainError("checkpoint promotion requires every tester placement terminated")
    expected_jobs = manifest.get("jobs") or []
    actual_jobs = receipt.get("jobs") or []
    if len(actual_jobs) != len(expected_jobs):
        raise FigmentTrainError("tester receipt job count disagrees with its reviewed manifest")
    for expected, actual in zip(expected_jobs, actual_jobs):
        if actual.get("output_name") != expected.get("output_name"):
            raise FigmentTrainError("tester receipt jobs disagree with its reviewed manifest")
        files = actual.get("files") or []
        if len(files) != expected.get("expected_images", 1) or any(
            not isinstance(row.get("bytes"), int) or row["bytes"] <= 0 for row in files
        ):
            raise FigmentTrainError(
                f"tester receipt output evidence is invalid for {expected.get('output_name')!r}"
            )


def run_planned_stage(creator_id: str, stage: str, plan_path: Path) -> dict[str, Any]:
    """Run one stage (or the bounded chain), recording progress and never retrying."""
    if stage not in (*STAGES, "all"):
        raise FigmentTrainError(f"unknown stage {stage!r}")
    plan, root = _load_plan(creator_id, plan_path)
    if stage == "all":
        # A promoted persona's plan never contains "anchor" (build_plan already refused
        # to (re-)plan it) -- walk only the stages the plan actually carries, in STAGES
        # order, rather than the full STAGES tuple.
        requested = tuple(current for current in STAGES if current in plan.get("stages", {}))
    else:
        requested = (stage,)
    for current in requested:
        if current not in plan.get("stages", {}):
            raise FigmentTrainError(f"plan does not contain stage {current!r}")
    state_path = root / "stage.json"
    state = _stage_state(state_path, creator_id, Path(plan_path).resolve())

    for current in requested:
        if current in state["completed_stages"]:
            if stage != "all":
                raise FigmentTrainError(
                    f"stage {current!r} is already complete or graded; refusing a live retry"
                )
            if current in GRADEABLE_STAGES:
                approval = _load_current_approval(plan, root, current)
                if current == "anchor" and approval.get("transition", {}).get("requires_replan"):
                    raise FigmentTrainError(
                        "anchor approval is current and the completed anchor run will not be repeated, "
                        "but promotion changed the persona references; create a fresh plan for dataset "
                        "and later stages"
                    )
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
            tester_inputs = (
                _tester_checkpoint_inputs(plan, root, run) if current == "tester" else None
            )
            attempt = {
                "status": "running", "started_utc": datetime.now(timezone.utc).isoformat(),
            }
            if tester_inputs is not None:
                attempt["checkpoint_inputs"] = tester_inputs
            state["runs"][key] = attempt
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
                if tester_inputs is not None:
                    current_inputs = _tester_checkpoint_inputs(plan, root, run)
                    if current_inputs != tester_inputs:
                        raise FigmentTrainError(
                            "tester checkpoint inputs changed while the tester run was active; "
                            "the rendered candidates cannot be promoted"
                        )
            except FigmentTrainError as exc:
                state["runs"][key] = {
                    **attempt, "status": "failed", "error": str(exc),
                }
                state["status"] = f"stopped:{current}"
                _write_stage_state(state_path, state)
                raise
            state["runs"][key] = {**attempt, "status": "complete"}
            _write_stage_state(state_path, state)
        state["completed_stages"].append(current)
        state["status"] = f"complete:{current}"
        _write_stage_state(state_path, state)
        if current in ("anchor", "dataset") and stage == "all":
            state["status"] = f"waiting:{current}-rulings"
            _write_stage_state(state_path, state)
            raise FigmentTrainError(
                f"{current} stage completed; STOP for full-resolution operator grading and "
                "apply-rulings, then invoke --stage all again to resume without rerunning it"
            )
    state["status"] = "complete"
    _write_stage_state(state_path, state)
    return state


def _find_job_image(run_out: Path, output_name: str) -> Path:
    """A single-image job (`expected_images` 1, every stage before Track-2 gen) writes
    `<output_name><ext>`. A multi-image job (gen's `expected_images: 3`: base, refined,
    detailed) writes `<output_name>_01<ext>`..`_NN<ext>` in ComfyUI history-completion
    order (`download_job_outputs`, pod/runpod_run.py) -- base (from the earliest-ready
    decode), refined, then detailed last (the mask/SEGS/detailer branch has the longest
    dependency chain). Grade only the last one, `_03`: the detailed output is the one
    result a gen-stage board should ever show (Track-2 Task D2)."""
    detailed = [
        run_out / f"{output_name}_03{suffix}" for suffix in IMAGE_EXTENSIONS
        if (run_out / f"{output_name}_03{suffix}").is_file()
    ]
    matches = detailed or [
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


def _advisory_annotation(advisory_row: dict[str, Any] | None) -> str:
    """Track-2 Task B3: render one cell's advisory numbers as
    `cos <x.xxx> · Δage <±y.y> · lap <n> · clip <p%>`, `n/a` for any field that is
    `None` or the row is missing entirely (a scorer outage, or advisory scoring never ran).
    Advisory-only -- this is annotation text, never a decision."""
    if not advisory_row:
        return ""

    def _fmt(value: Any, template: str) -> str:
        return template.format(value) if isinstance(value, (int, float)) else "n/a"

    cos = _fmt(advisory_row.get("anchor_cosine"), "{:.3f}")
    age = _fmt(advisory_row.get("age_delta_years"), "±{:.1f}")
    lap = _fmt(advisory_row.get("laplacian_variance"), "{:.0f}")
    clip = _fmt(advisory_row.get("clipped_highlight_fraction"), "{:.1%}")
    return f"cos {cos} · Δage {age} · lap {lap} · clip {clip}"


def _judge_annotation(judge_row: dict[str, Any] | None) -> str:
    """Stage 2's numbers + notes for one cell, rendered
    `judge: same X · age Y→Z (Δd) · skin S · gloss G · artifacts A · "notes"`, or a
    short explanatory string when the judge never ran for this cell (skipped, or
    genuinely unavailable) -- ALWAYS informational text, the pass/fail decision itself
    already lives in the gate reasons, never here."""
    if judge_row is None:
        return ""
    if judge_row.get("unavailable"):
        return f'judge: {judge_row["unavailable"].get("judge", "unavailable")}'

    def _fmt(value: Any) -> str:
        return str(value) if isinstance(value, (int, float)) else "n/a"

    same = _fmt(judge_row.get("same_person"))
    age_ref = _fmt(judge_row.get("apparent_age_reference"))
    age_cand = _fmt(judge_row.get("apparent_age_candidate"))
    delta = _fmt(judge_row.get("age_delta"))
    skin = _fmt(judge_row.get("skin_realism"))
    gloss = _fmt(judge_row.get("gloss"))
    artifacts = _fmt(judge_row.get("artifacts"))
    notes = judge_row.get("notes") or ""
    return (
        f"judge: same {same} · age {age_ref}→{age_cand} (Δ{delta}) · "
        f"skin {skin} · gloss {gloss} · artifacts {artifacts}"
        + (f' · "{notes}"' if notes else "")
    )


def _figure_html(
    row: dict[str, Any], advisory_by_id: dict[str, Any], *,
    gate_by_id: dict[str, Any] | None = None, number: int | None = None,
    reasons: list[str] | None = None,
) -> str:
    annotation = _advisory_annotation(advisory_by_id.get(row["image_id"]))
    gate_row = (gate_by_id or {}).get(row["image_id"])
    judge_annotation = _judge_annotation((gate_row or {}).get("judge"))
    caption = f"{number}. {html.escape(row['image_id'])}" if number is not None else html.escape(row["image_id"])
    extra = ""
    if annotation:
        extra += f'<br><span class="advisory">{html.escape(annotation)}</span>'
    if judge_annotation:
        extra += f'<br><span class="judge">{html.escape(judge_annotation)}</span>'
    if reasons:
        extra += f'<br><span class="gate-reasons">{html.escape("; ".join(reasons))}</span>'
    return (
        f'<figure><a href="{html.escape(Path(row["path"]).as_uri())}">'
        f'<img loading="lazy" src="{html.escape(Path(row["path"]).as_uri())}" '
        f'alt="{html.escape(row["image_id"])}"></a>'
        f'<figcaption>{caption}{extra}</figcaption></figure>'
    )


def _grading_html(
    creator_id: str,
    stage: str,
    anchors: list[Path],
    images: list[dict[str, Any]],
    advisory: dict[str, Any] | None = None,
    gate_document: dict[str, Any] | None = None,
) -> str:
    advisory_by_id = {
        row["image_id"]: row for row in (advisory or {}).get("rows", [])
    }
    gate_by_id = {row["image_id"]: row for row in (gate_document or {}).get("rows", [])}
    anchor_cards = "\n".join(
        f'<figure><a href="{html.escape(path.as_uri())}"><img loading="eager" '
        f'src="{html.escape(path.as_uri())}" alt="anchor {html.escape(path.name)}"></a>'
        f'<figcaption>anchor · {html.escape(path.name)}</figcaption></figure>'
        for path in anchors
    )

    passed_rows: list[dict[str, Any]] = []
    failed_rows: list[tuple[dict[str, Any], list[str]]] = []
    for row in images:
        gate_row = gate_by_id.get(row["image_id"])
        if gate_row is not None and gate_row.get("pass"):
            passed_rows.append(row)
        else:
            reasons = list((gate_row or {}).get("reasons") or ["gate did not run for this cell"])
            failed_rows.append((row, reasons))

    passed_cells = "\n".join(
        _figure_html(row, advisory_by_id, gate_by_id=gate_by_id, number=index)
        for index, row in enumerate(passed_rows, start=1)
    )
    failed_cells = "\n".join(
        _figure_html(row, advisory_by_id, gate_by_id=gate_by_id, reasons=reasons)
        for row, reasons in failed_rows
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
.advisory{{color:#888;font-size:0.85em}}
.judge{{color:#8ab4f8;font-size:0.85em}}
.advisory-note{{color:#bbb;font-style:italic}}
.gate-reasons{{color:#e08080;font-size:0.85em}}
summary{{cursor:pointer;font-size:1.2em;margin:16px 0}}
</style></head><body>
<h1>{html.escape(creator_id)} · {html.escape(stage)}</h1>
<p>full-resolution source files: click any image to inspect its original pixels. Rule beside the anchors; never grade a thumbnail alone.</p>
<p class="advisory-note">advisory annotations (cos/Δage/lap/clip) are advisory only — never keep or cull. The gate below IS fail-closed: only PASS cells are numbered for the ruling sheet.</p>
<section class="anchors"><h2>Identity anchors</h2><div class="grid">{anchor_cards}</div></section>
<main><h2>Cells passing the gate ({len(passed_rows)})</h2><div class="grid">{passed_cells}</div></main>
<details class="failed-gate"><summary>failed gate ({len(failed_rows)})</summary><div class="grid">{failed_cells}</div></details>
</body></html>
"""


_GATE_FALLBACK_METRICS = ("identity_own", "age_delta", "gloss", "niqe", "face_px")


def _load_persona_document_for_gate(plan: dict[str, Any]) -> dict[str, Any]:
    # plan["assets"]["persona_dir"] is ROOT-relative (see build_plan's own comment on
    # that field), never `root`-relative (the plan's own output directory) -- the
    # persona directory usually lives outside `root` entirely.
    persona_path = (ROOT / plan["assets"]["persona_dir"] / "persona.yaml").resolve()
    return _read_json(persona_path)


def _persona_path_for_plan(plan: dict[str, Any]) -> Path:
    return (ROOT / plan["assets"]["persona_dir"] / "persona.yaml").resolve()


def _current_persona_training(plan: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    persona_path = _persona_path_for_plan(plan)
    try:
        merged = _training_config_module().load_persona_with_training(persona_path)
    except (OSError, ValueError) as exc:
        raise FigmentTrainError(f"current persona/training configuration is invalid: {exc}") from exc
    return merged, merged["training"]


def _current_review_subject(
    plan: dict[str, Any], root: Path, stage: str, grading: dict[str, Any],
) -> dict[str, Any]:
    persona, training = _current_persona_training(plan)
    manifest_paths = [root / run["manifest"] for run in plan["stages"][stage]["runs"]]
    anchors = [(root / value).resolve() for value in plan["assets"]["anchors"]]
    checkpoint_inputs = None
    if stage == "tester":
        state_path = root / "stage.json"
        if state_path.is_file():
            state = _stage_state(state_path, plan["creator"], root / "plan.json")
            checkpoint_inputs = [
                {
                    "manifest": run["manifest"],
                    "manifest_sha256": run["sha256"],
                    "status": state.get("runs", {}).get(run["manifest"], {}).get("status"),
                    "inputs": state.get("runs", {}).get(run["manifest"], {}).get(
                        "checkpoint_inputs"
                    ),
                }
                for run in plan["stages"][stage]["runs"]
            ]
    try:
        return _lineage_module().review_subject(
            creator=plan["creator"], stage=stage, plan_path=root / "plan.json",
            manifest_paths=manifest_paths, images=grading["images"], anchors=anchors,
            persona=persona, training=training, threshold_path=HERE / "gate.yaml",
            score_path=root / "grade" / stage / "gate.json",
            checkpoint_inputs=checkpoint_inputs,
        )
    except (OSError, ValueError) as exc:
        raise FigmentTrainError(f"cannot establish {stage} review lineage: {exc}") from exc


def _load_current_approval(
    plan: dict[str, Any], root: Path, stage: str, *, required: bool = True,
) -> dict[str, Any] | None:
    grade_dir = root / "grade" / stage
    approval_path = grade_dir / "approval-lineage.json"
    if not approval_path.is_file():
        if required:
            raise FigmentTrainError(
                f"{stage} has no current operator approval; run grade and apply-rulings first"
            )
        return None
    grading = _read_json(grade_dir / "grading-manifest.json")
    approval = _read_json(approval_path)
    if approval.get("schema") != _lineage_module().APPROVAL_SCHEMA:
        raise FigmentTrainError(f"unsupported approval lineage at {approval_path}")
    try:
        _lineage_module().assert_current(
            approval, _current_review_subject(plan, root, stage, grading),
            label=f"{stage} operator approval",
        )
    except ValueError as exc:
        raise FigmentTrainError(str(exc)) from exc
    return approval


def _run_identity_gate(
    plan: dict[str, Any], anchors: list[Path], images: list[dict[str, Any]],
    grade_dir: Path, *, skip_judge: bool = False,
) -> dict[str, Any]:
    """Fail-closed per-cell TWO-STAGE gate (operator ruling 2026-09-03: no board reaches
    the operator until every shown cell holds identity, age and realism; ruling
    2026-09-06 added stage 2, the vlm_judge.py Claude vision judge, after calibration
    showed facenet/the age classifier/the gloss proxy/NIQE do not separate the
    operator's own verdicts -- see identity_gate.py's `two_stage_gate` docstring).

    Stage 2 is only ever invoked for a cell whose stage 1 (`identity_floor_gate`) has
    already passed -- a gross identity miss or an unusable face crop never spends a
    judge call, so `--skip-judge` (offline/test use only -- never used on a real grading
    run) and "genuinely had no usable face" both leave a cell's `judge` field `None`,
    but the top-level `judge_skipped` flag distinguishes the two for the board/operator.

    Unlike `score_cells.score`'s advisory annotations -- which degrade to `None` fields
    on a scorer outage and never gate anything -- a TOTAL outage here still produces a
    `gate.json`, but with every cell explicitly FAILED closed (never silently promoted
    to pass, never silently omitted from the document).

    This is now a thin plan-specific wrapper: the actual two-stage composition (score,
    stage 1, stage 2 only for stage-1 passes, outage handling) lives in
    `identity_gate.run_two_stage_gate` so a plan-driven grading stage and
    `identity_gate.py run`'s own plan-independent CLI (for a bake-off run dir, a batch
    folder, or any other ad hoc image set) gate identically and produce the exact same
    `figment/gate@1` schema. `load_persona` is a thunk rather than an
    already-resolved dict so a persona-resolution failure is caught by the SAME
    outage handling as a scorer/judge failure, exactly as it was before this
    extraction."""
    gate_module = _identity_gate_module()
    return gate_module.run_two_stage_gate(
        lambda: _load_persona_document_for_gate(plan),
        anchors, images, grade_dir, skip_judge=skip_judge,
    )


def build_grade(
    creator_id: str, stage: str, plan_path: Path, *, skip_judge: bool = False,
) -> dict[str, str]:
    """Build a non-destructive, original-pixel grading surface and blank rulings.

    `skip_judge` (offline/test use only -- NEVER pass this on a real grading run)
    entirely omits stage 2 (the vlm_judge.py Claude vision judge, subscription-billed):
    every cell's overall pass/fail then rests on stage 1 alone failing closed, or on
    stage 2 being recorded as `unavailable: judge` for any cell whose stage 1 passed --
    see `_run_identity_gate`'s own docstring."""
    if stage not in GRADEABLE_STAGES:
        raise FigmentTrainError(f"grade stage must be one of {GRADEABLE_STAGES}")
    plan, root = _load_plan(creator_id, plan_path)
    anchors = [(root / value).resolve() for value in plan["assets"]["anchors"]]
    for anchor in anchors:
        if not anchor.is_file() or anchor.stat().st_size <= 0:
            raise FigmentTrainError(f"anchor is missing or empty: {anchor}")
    images = _grading_images(plan, root, stage)
    grade_dir = root / "grade" / stage
    grade_dir.mkdir(parents=True, exist_ok=True)
    # Track-2 Task B3: advisory identity/age/quality annotations, wrapped so a scorer
    # outage (missing model weights, no network, a bad anchor file) never blocks the
    # gate -- `score_cells.score` itself is advisory-only and must never keep or cull.
    advisory: dict[str, Any] | None = None
    try:
        advisory = _score_cells_module().score(images, anchors, grade_dir)
    except Exception as exc:
        advisory = None
        _write_json(
            grade_dir / "advisory-error.json",
            {"error": f"{type(exc).__name__}: {exc}"},
        )
    # Operator ruling 2026-09-03: no board reaches the operator until this fail-closed
    # gate has scored every cell -- see _run_identity_gate's own docstring for how a
    # total scoring outage still fails every cell closed rather than skipping the gate.
    gate_document = _run_identity_gate(plan, anchors, images, grade_dir, skip_judge=skip_judge)
    gate_path = grade_dir / "gate.json"
    _write_json(gate_path, gate_document)

    manifest_path = grade_dir / "grading-manifest.json"
    template_path = grade_dir / "rulings.template.json"
    page_path = grade_dir / "board.html"
    grading_document = {"creator": creator_id, "stage": stage, "images": images}
    _write_json(manifest_path, grading_document)
    subject = _current_review_subject(plan, root, stage, grading_document)
    _write_json(
        grade_dir / "evaluation-inputs.json",
        _lineage_module().wrap_subject(
            _lineage_module().EVALUATION_SCHEMA, subject,
            creator=creator_id, stage=stage,
        ),
    )
    _write_json(template_path, {
        "schema": "figment/rulings-template@1",
        "creator": creator_id,
        "stage": stage,
        "evaluation_subject_sha256": _lineage_module().canonical_sha256(subject),
        "decided_by": None,
        "decided_at": None,
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
        _grading_html(creator_id, stage, anchors, images, advisory, gate_document), encoding="utf-8",
    )
    return {
        "page": str(page_path),
        "rulings_template": str(template_path),
        "grading_manifest": str(manifest_path),
        "gate": str(gate_path),
    }


def _normalize_rulings(
    creator_id: str, stage: str, document: Any, image_ids: list[str],
    evaluation_subject_sha256: str,
) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise FigmentTrainError("rulings document must be an object")
    if document.get("creator") != creator_id or document.get("stage") != stage:
        raise FigmentTrainError("rulings creator/stage does not match the command")
    if document.get("evaluation_subject_sha256") != evaluation_subject_sha256:
        raise FigmentTrainError(
            "rulings were filled for a different evaluation subject; use the current "
            "grade's rulings template"
        )
    decided_by = document.get("decided_by")
    decided_at = document.get("decided_at")
    if not isinstance(decided_by, str) or not decided_by.strip():
        raise FigmentTrainError("rulings require a non-empty human decided_by identity")
    if not isinstance(decided_at, str) or not decided_at.strip():
        raise FigmentTrainError("rulings require a non-empty decided_at timestamp")
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
        "evaluation_subject_sha256": evaluation_subject_sha256,
        "decided_by": decided_by.strip(),
        "decided_at": decided_at.strip(),
        "rulings": [by_id[image_id] for image_id in image_ids],
    }


def _checkpoint_candidate(plan: dict[str, Any], root: Path, step: int) -> dict[str, Any]:
    training = plan["training"]
    allowed = _checkpoint_steps(training["steps"], training["save_every"]) + [training["steps"]]
    if step not in allowed:
        raise FigmentTrainError(
            f"checkpoint step {step} was not produced by this plan; choose one of {allowed}"
        )
    filename = _checkpoint_name(training["trigger"], None if step == training["steps"] else step)
    tester_matches: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    for run in plan["stages"]["tester"]["runs"]:
        manifest_path = root / run["manifest"]
        if _sha256(manifest_path) != run["sha256"]:
            raise FigmentTrainError("tester manifest changed after the reviewed plan was written")
        manifest = _read_json(manifest_path)
        for job in manifest.get("jobs") or []:
            values = [
                item.get("value") for item in job.get("substitutions") or []
                if item.get("field") == "lora_name"
            ]
            if filename in values:
                tester_matches.append((run, manifest, job["output_name"]))
    if len(tester_matches) != 1:
        raise FigmentTrainError(
            f"tester manifest does not map checkpoint {filename!r} to exactly one candidate"
        )

    tester_run, tester_manifest, tester_image_id = tester_matches[0]
    state_path = root / "stage.json"
    if not state_path.is_file():
        raise FigmentTrainError(
            "checkpoint promotion requires this plan's completed train and tester stages"
        )
    state = _stage_state(state_path, plan["creator"], root / "plan.json")
    if "train" not in state.get("completed_stages", []):
        raise FigmentTrainError("checkpoint promotion requires this plan's completed train stage")
    if "tester" not in state.get("completed_stages", []):
        raise FigmentTrainError("checkpoint promotion requires this plan's completed tester stage")
    tester_state = state.get("runs", {}).get(tester_run["manifest"], {})
    if tester_state.get("status") != "complete":
        raise FigmentTrainError("checkpoint promotion requires its tester run to be complete")
    tester_inputs = tester_state.get("checkpoint_inputs")
    if not isinstance(tester_inputs, list) or not tester_inputs:
        raise FigmentTrainError(
            "completed tester run has no checkpoint digest inventory; rerun under the current "
            "driver before promoting a candidate"
        )
    _verify_tester_receipt_evidence(tester_manifest, root / tester_run["out"])

    matches: list[tuple[dict[str, Any], Path]] = []
    for run in plan["stages"].get("train", {}).get("runs", []):
        manifest_path = root / run["manifest"]
        if _sha256(manifest_path) != run["sha256"]:
            raise FigmentTrainError("train manifest changed after the reviewed plan was written")
        manifest = _read_json(manifest_path)
        if filename not in [item.get("local") for item in manifest.get("artifacts") or []]:
            continue
        if state.get("runs", {}).get(run["manifest"], {}).get("status") != "complete":
            continue
        run_out = (root / run["out"]).resolve()
        checkpoint = (run_out / filename).resolve()
        try:
            checkpoint.relative_to(run_out)
        except ValueError as exc:
            raise FigmentTrainError("selected checkpoint escapes its planned train output") from exc
        matches.append((run, checkpoint))
    if len(matches) != 1:
        raise FigmentTrainError(
            f"checkpoint {filename!r} is not a unique artifact of this plan's completed train run"
        )
    run, checkpoint = matches[0]
    if not checkpoint.is_file() or checkpoint.stat().st_size <= 0:
        raise FigmentTrainError(f"produced checkpoint is missing or empty: {checkpoint}")
    receipt = _read_json(checkpoint.parent / "run.json")
    artifact_rows = [
        item for item in receipt.get("artifacts") or []
        if item.get("remote") == filename and item.get("bytes") == checkpoint.stat().st_size
    ]
    if (receipt.get("error") is not None or receipt.get("dry_run") is not False
            or receipt.get("termination_verified") is not True
            or len(artifact_rows) != 1):
        raise FigmentTrainError(
            f"checkpoint {filename!r} lacks a real successful, teardown-verified train receipt"
        )
    recorded_inputs = [
        item for item in tester_inputs
        if isinstance(item, dict) and item.get("filename") == filename
    ]
    current_input = {
        "filename": filename,
        "path": _relative(checkpoint, root),
        "bytes": checkpoint.stat().st_size,
        "sha256": _sha256(checkpoint),
    }
    if len(recorded_inputs) != 1 or recorded_inputs[0] != current_input:
        raise FigmentTrainError(
            f"checkpoint {filename!r} no longer matches the bytes recorded for the completed "
            "tester run; rerun tester before promotion"
        )
    return {
        "step": step,
        "filename": filename,
        "tester_image_id": tester_image_id,
        "path": str(checkpoint),
        "bytes": checkpoint.stat().st_size,
        "sha256": _sha256(checkpoint),
        "train_manifest": run["manifest"],
        "train_manifest_sha256": run["sha256"],
    }


def _config_path_value(path: Path) -> str:
    path = Path(path).resolve()
    try:
        return path.relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return str(path)


def _persist_checkpoint_selection(
    plan: dict[str, Any], step: int, digest: str, approval_path: Path,
) -> None:
    persona_path = _persona_path_for_plan(plan)
    sidecar_path = persona_path.with_name("training.yaml")
    target = sidecar_path if sidecar_path.is_file() else persona_path
    document = _read_json(target)
    training = document.get("training")
    if not isinstance(training, dict):
        raise FigmentTrainError(f"cannot persist checkpoint selection: {target} has no training object")
    training.update({
        "chosen_checkpoint_step": step,
        "chosen_checkpoint_sha256": digest,
        "chosen_checkpoint_approval": _config_path_value(approval_path),
    })
    _write_json(target, document)


def _resolve_config_path(value: str) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (ROOT / path).resolve()


def apply_rulings(
    creator_id: str, stage: str, plan_path: Path, rulings_path: Path,
    checkpoint_step: int | None = None,
) -> dict[str, str]:
    """Validate operator rulings, stamp QA, and materialize dataset keeps."""
    if stage not in GRADEABLE_STAGES:
        raise FigmentTrainError(f"apply-rulings stage must be one of {GRADEABLE_STAGES}")
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
    evaluation_path = grade_dir / "evaluation-inputs.json"
    if not evaluation_path.is_file():
        raise FigmentTrainError(
            f"review freshness record is missing: {evaluation_path}; rebuild the grade"
        )
    evaluation = _read_json(evaluation_path)
    if evaluation.get("schema") != _lineage_module().EVALUATION_SCHEMA:
        raise FigmentTrainError("review freshness record has an unsupported schema")
    try:
        _lineage_module().assert_current(
            evaluation, _current_review_subject(plan, root, stage, grading),
            label=f"{stage} numeric evaluation",
        )
    except ValueError as exc:
        raise FigmentTrainError(str(exc)) from exc
    normalized = _normalize_rulings(
        creator_id, stage, _read_json(Path(rulings_path)), image_ids,
        evaluation["subject_sha256"],
    )
    if stage == "anchor":
        keeps = [r for r in normalized["rulings"] if r["decision"] == "keep"]
        if len(keeps) != 1:
            raise FigmentTrainError(
                f"anchor rulings must keep exactly one candidate, got {len(keeps)}")

    # Operator ruling 2026-09-03: a cell the fail-closed identity/age/realism gate
    # marked FAIL can never be kept silently -- the ruling must carry an explicit,
    # non-empty "gate_override" reason. REVIEW-2026-09-07 findings #1/#2: this must be
    # fail-CLOSED, not fail-open. `build_grade` always writes a gate.json beside
    # board.html, so a missing file means the gate was bypassed (deleted, never run),
    # not that this grade dir predates the wiring -- refuse rather than tolerate it.
    # Every graded image id must be covered by gate.json (a partial rewrite must not
    # silently ungate a cell), and a gate row missing its own "pass" key (hand-edited,
    # truncated write, older schema) is treated exactly like an explicit
    # `"pass": false` row -- never defaulted to a silent PASS.
    gate_path = grade_dir / "gate.json"
    if not gate_path.is_file():
        raise FigmentTrainError(
            f"no gate.json at {gate_path}; run `figment_train.py grade` before apply-rulings"
        )
    gate_document = _read_json(gate_path)
    if gate_document.get("schema") != "figment/gate@1":
        raise FigmentTrainError("gate.json must be the per-cell numeric figment/gate@1 document")
    gate_by_id: dict[str, dict[str, Any]] = {
        row["image_id"]: row for row in gate_document.get("rows", [])
    }
    ungated = [image_id for image_id in image_ids if image_id not in gate_by_id]
    if ungated:
        raise FigmentTrainError(f"gate.json does not cover every graded cell: {ungated}")

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
            gate_row = gate_by_id.get(row["image_id"])
            if gate_row is None or gate_row.get("pass") is not True:
                override = ruling.get("gate_override")
                if not isinstance(override, str) or not override.strip():
                    raise FigmentTrainError(
                        f"kept cell {row['image_id']!r} failed the identity/age/realism gate "
                        f"({'; '.join(gate_row.get('reasons') or [])}) and its ruling carries "
                        "no gate_override reason"
                    )
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

    checkpoint = None
    if checkpoint_step is not None:
        if stage != "tester":
            raise FigmentTrainError("--checkpoint-step is only valid for tester rulings")
        checkpoint = _checkpoint_candidate(plan, root, checkpoint_step)
        if checkpoint["tester_image_id"] not in {row["image_id"] for row in approved_rows}:
            raise FigmentTrainError(
                f"checkpoint step {checkpoint_step} was not explicitly kept by the tester rulings"
            )

    rulings_out = grade_dir / "rulings.json"
    review_out = grade_dir / "review-manifest.json"
    approved_out = grade_dir / "approved-list.json"
    approval_out = grade_dir / "approval-lineage.json"
    accepted_checkpoint_out = grade_dir / "accepted-checkpoint.json"
    if any(path.exists() for path in (rulings_out, review_out, approved_out, approval_out)):
        if not (stage == "tester" and checkpoint is not None
                and not accepted_checkpoint_out.exists()
                and rulings_out.is_file() and _read_json(rulings_out) == normalized):
            raise FigmentTrainError("refusing to overwrite previously applied rulings")
        _load_current_approval(plan, root, stage)
        approved_existing = _read_json(approved_out)
        if checkpoint["tester_image_id"] not in {
            row.get("image_id") for row in approved_existing.get("images") or []
        }:
            raise FigmentTrainError("selected checkpoint was not kept by the applied tester rulings")
        accepted_document = {
            "schema": _lineage_module().CHECKPOINT_SCHEMA,
            "creator": creator_id,
            "operator": {
                "decided_by": normalized["decided_by"],
                "decided_at": normalized["decided_at"],
            },
            "source_plan": str((root / "plan.json").resolve()),
            "source_plan_sha256": _sha256(root / "plan.json"),
            "approval_lineage": str(approval_out.resolve()),
            "approval_lineage_sha256": _sha256(approval_out),
            "training_inputs": _lineage_module().training_input_projection(plan["training"]),
            "checkpoint": checkpoint,
        }
        _write_json(accepted_checkpoint_out, accepted_document)
        _persist_checkpoint_selection(
            plan, checkpoint["step"], checkpoint["sha256"], accepted_checkpoint_out,
        )
        return {
            "rulings": str(rulings_out), "review_manifest": str(review_out),
            "approved_list": str(approved_out),
            "approval_lineage": str(approval_out),
            "accepted_checkpoint": str(accepted_checkpoint_out),
        }

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
            dataset_subject = _lineage_module().dataset_subject(dataset_dir)
            _write_json(
                dataset_dir / "dataset-approval.json",
                _lineage_module().wrap_subject(
                    _lineage_module().DATASET_APPROVAL_SCHEMA, dataset_subject,
                    creator=creator_id, decision="verified",
                    decided_by=normalized["decided_by"], decided_at=normalized["decided_at"],
                    source_approval=str(approval_out.resolve()),
                ),
            )
    elif stage == "anchor":
        approved = approved_rows[0]
        image_id = approved["image_id"]
        source = Path(approved["path"])
        if not source.is_file() or source.stat().st_size <= 0:
            raise FigmentTrainError(f"approved anchor source image is missing or empty: {source}")
        persona_dir = (ROOT / plan["assets"]["persona_dir"]).resolve()
        anchors_dir = persona_dir / "anchors"
        anchors_dir.mkdir(parents=True, exist_ok=True)
        # Review LOW-13: take the extension from the actual source file rather than
        # hardcoding .png -- safe today only because SaveImage always emits PNG.
        extension = source.suffix.lower() or ".png"
        destination = anchors_dir / f"{image_id}{extension}"
        if destination.exists():
            raise FigmentTrainError(f"anchor destination already exists: {destination}")
        shutil.copy2(source, destination)
        chosen_document = {
            "schema": "figment/chosen-anchor@1",
            "creator": creator_id,
            "image_id": image_id,
            "path": str(destination),
            "sha256": _sha256(destination),
        }
        _write_json(grade_dir / "chosen-anchor.json", chosen_document)

        persona_path = persona_dir / "persona.yaml"
        persona_document = _read_json(persona_path)
        identity = persona_document.setdefault("identity", {})
        identity["history"] = identity.get("history", []) + identity.get("references", [])
        identity["references"] = [f"anchors/{image_id}{extension}"]
        _write_json(persona_path, persona_document)

    approved_document = {
        "schema": "figment/approved-images@1",
        "creator": creator_id,
        "stage": stage,
        "images": approved_rows,
    }
    _write_json(rulings_out, normalized)
    _write_json(review_out, review)
    _write_json(approved_out, approved_document)
    settled_subject = _current_review_subject(plan, root, stage, grading)
    approval_document = _lineage_module().wrap_subject(
        _lineage_module().APPROVAL_SCHEMA,
        settled_subject,
        creator=creator_id, stage=stage, decision="verified",
        decided_by=normalized["decided_by"], decided_at=normalized["decided_at"],
        rulings_sha256=_sha256(rulings_out),
        reviewed_subject=evaluation["subject"],
        reviewed_subject_sha256=evaluation["subject_sha256"],
        transition=(
            {"kind": "anchor-promotion", "requires_replan": True,
             "from_subject_sha256": evaluation["subject_sha256"],
             "to_subject_sha256": _lineage_module().canonical_sha256(settled_subject)}
            if stage == "anchor" else {"kind": "none", "requires_replan": False}
        ),
    )
    _write_json(approval_out, approval_document)
    result = {
        "rulings": str(rulings_out),
        "review_manifest": str(review_out),
        "approved_list": str(approved_out),
        "approval_lineage": str(approval_out),
    }
    if checkpoint is not None:
        accepted_document = {
            "schema": _lineage_module().CHECKPOINT_SCHEMA,
            "creator": creator_id,
            "operator": {
                "decided_by": normalized["decided_by"],
                "decided_at": normalized["decided_at"],
            },
            "source_plan": str((root / "plan.json").resolve()),
            "source_plan_sha256": _sha256(root / "plan.json"),
            "approval_lineage": str(approval_out.resolve()),
            "approval_lineage_sha256": _sha256(approval_out),
            "training_inputs": _lineage_module().training_input_projection(plan["training"]),
            "checkpoint": checkpoint,
        }
        _write_json(accepted_checkpoint_out, accepted_document)
        _persist_checkpoint_selection(
            plan, checkpoint["step"], checkpoint["sha256"], accepted_checkpoint_out,
        )
        result["accepted_checkpoint"] = str(accepted_checkpoint_out)
    return result


def _stage_accepted_checkpoint(
    out: Path, persona: dict[str, Any], training: dict[str, Any],
) -> str:
    step = training.get("chosen_checkpoint_step")
    digest = training.get("chosen_checkpoint_sha256")
    approval_value = training.get("chosen_checkpoint_approval")
    if step is None:
        raise FigmentTrainError(
            "gen requires a chosen checkpoint; apply tester rulings with --checkpoint-step"
        )
    if not isinstance(digest, str) or not isinstance(approval_value, str):
        raise FigmentTrainError(
            "legacy chosen_checkpoint_step has no checkpoint hash/provenance; re-apply the "
            "tester rulings with --checkpoint-step"
        )
    approval_path = _resolve_config_path(approval_value)
    if approval_path.name != "accepted-checkpoint.json" or approval_path.parent.name != "tester":
        raise FigmentTrainError("chosen checkpoint approval must be a tester accepted-checkpoint.json")
    expected_plan_path = approval_path.parents[2] / "plan.json"
    accepted = _read_json(approval_path)
    if (accepted.get("schema") != _lineage_module().CHECKPOINT_SCHEMA
            or accepted.get("creator") != persona["id"]):
        raise FigmentTrainError("chosen checkpoint approval is malformed or belongs to another creator")
    source_plan_path = Path(accepted.get("source_plan", "")).resolve()
    if source_plan_path != expected_plan_path.resolve():
        raise FigmentTrainError("chosen checkpoint approval names a plan outside its own review root")
    if _sha256(source_plan_path) != accepted.get("source_plan_sha256"):
        raise FigmentTrainError("chosen checkpoint source plan changed after promotion")
    source_plan, source_root = _load_plan(persona["id"], source_plan_path)
    approval_lineage = approval_path.with_name("approval-lineage.json")
    if (Path(accepted.get("approval_lineage", "")).resolve() != approval_lineage.resolve()
            or _sha256(approval_lineage) != accepted.get("approval_lineage_sha256")):
        raise FigmentTrainError("tester approval lineage changed after checkpoint promotion")
    _load_current_approval(source_plan, source_root, "tester")
    expected_inputs = _lineage_module().training_input_projection(training)
    if (accepted.get("training_inputs") != expected_inputs
            or accepted.get("training_inputs")
            != _lineage_module().training_input_projection(source_plan["training"])):
        raise FigmentTrainError("training inputs changed after checkpoint promotion")
    candidate = _checkpoint_candidate(source_plan, source_root, step)
    recorded = accepted.get("checkpoint")
    if not isinstance(recorded, dict):
        raise FigmentTrainError("chosen checkpoint approval has no checkpoint record")
    for field in ("step", "filename", "tester_image_id", "path", "bytes", "sha256",
                  "train_manifest", "train_manifest_sha256"):
        if recorded.get(field) != candidate.get(field):
            raise FigmentTrainError(f"chosen checkpoint provenance changed at field {field!r}")
    if candidate["sha256"] != digest:
        raise FigmentTrainError("chosen checkpoint bytes do not match training configuration")

    upload_name = _checkpoint_name(training["trigger"], step)
    staged_dir = out / "train" / "runs" / "accepted-checkpoint"
    staged_dir.mkdir(parents=True, exist_ok=True)
    staged = staged_dir / upload_name
    shutil.copy2(candidate["path"], staged)
    if _sha256(staged) != digest:
        raise FigmentTrainError("staged checkpoint hash differs from the approved checkpoint")
    return f"accepted-checkpoint/{upload_name}"


def command_gate(creator_id: str, stage: str, plan_path: Path) -> dict[str, Any]:
    """Read `grade/<stage>/gate.json` (written by `build_grade`) and return it --
    never recomputes the gate, so this is fast and matches exactly what the board a
    human is looking at was gated with. Raises if `grade` has not been run yet."""
    if stage not in GRADEABLE_STAGES:
        raise FigmentTrainError(f"gate stage must be one of {GRADEABLE_STAGES}")
    plan, root = _load_plan(creator_id, plan_path)
    gate_path = root / "grade" / stage / "gate.json"
    if not gate_path.is_file():
        raise FigmentTrainError(
            f"no gate.json at {gate_path}; run `figment_train.py grade` for this stage first"
        )
    document = _read_json(gate_path)
    if document.get("own_anchor") is None and not document.get("rows"):
        raise FigmentTrainError(f"gate.json at {gate_path} is empty or malformed")
    evaluation_path = root / "grade" / stage / "evaluation-inputs.json"
    if not evaluation_path.is_file():
        raise FigmentTrainError("cached gate has no freshness record; rebuild it with `grade`")
    evaluation = _read_json(evaluation_path)
    grading = _read_json(root / "grade" / stage / "grading-manifest.json")
    try:
        _lineage_module().assert_current(
            evaluation, _current_review_subject(plan, root, stage, grading),
            label=f"cached {stage} numeric gate",
        )
    except ValueError as exc:
        raise FigmentTrainError(str(exc)) from exc
    result = deepcopy(document)
    result["freshness"] = "cached-current"
    result["recalculated"] = False
    return result


def _format_gate_table(document: dict[str, Any]) -> str:
    header = ("image_id", "pass", "identity_own", "age_delta", "gloss", "niqe", "face_px", "reasons")
    rows = [header]
    for row in document.get("rows", []):
        def _fmt(value: Any) -> str:
            return f"{value:.3f}" if isinstance(value, (int, float)) else "n/a"
        rows.append((
            str(row.get("image_id")),
            "PASS" if row.get("pass") else "FAIL",
            _fmt(row.get("identity_own")),
            _fmt(row.get("age_delta")),
            _fmt(row.get("gloss")),
            _fmt(row.get("niqe")),
            _fmt(row.get("face_px")),
            "; ".join(row.get("reasons") or []),
        ))
    widths = [max(len(str(cell)) for cell in column) for column in zip(*rows)]
    lines = [
        "  ".join(str(cell).ljust(width) for cell, width in zip(row, widths))
        for row in rows
    ]
    summary = document.get("summary", {})
    lines.append("")
    lines.append(
        f"{summary.get('passed', 0)}/{summary.get('total', len(document.get('rows', [])))} passed"
    )
    if document.get("outage"):
        lines.append(f"GATE OUTAGE: {document['outage']}")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan", help="generate a creator-specific Track-1 plan")
    plan.add_argument("--creator", required=True)
    plan.add_argument("--stage", choices=(*STAGES, "all"), default="all")
    plan.add_argument("--out", required=True, type=Path)
    plan.add_argument(
        "--skip-pin-verify", action="store_true",
        help="skip the live Hugging Face pin-verification preflight (offline/test use only)",
    )
    plan.add_argument(
        "--detail-images", default=None,
        help="glob of existing rendered cells to re-detail (only meaningful with "
             "--stage gen); emits an extra <id>-tensor-detail.yaml manifest (r25 cause #2)",
    )

    run = commands.add_parser("run", help="run one planned stage without retries")
    run.add_argument("--creator", required=True)
    run.add_argument("--stage", choices=(*STAGES, "all"), required=True)
    run.add_argument("--plan", required=True, type=Path)

    grade = commands.add_parser("grade", help="build a full-resolution grading board")
    grade.add_argument("--creator", required=True)
    grade.add_argument("--stage", choices=GRADEABLE_STAGES, required=True)
    grade.add_argument("--plan", type=Path, default=Path("plan.json"))
    grade.add_argument(
        "--skip-judge", action="store_true",
        help="omit stage 2 (the vlm_judge.py Claude vision judge) -- offline/test use "
             "only, NEVER pass this on a real grading run",
    )

    apply = commands.add_parser("apply-rulings", help="validate and apply operator rulings")
    apply.add_argument("--creator", required=True)
    apply.add_argument("--stage", choices=GRADEABLE_STAGES, required=True)
    apply.add_argument("--plan", type=Path, default=Path("plan.json"))
    apply.add_argument("--rulings", required=True, type=Path)
    apply.add_argument(
        "--checkpoint-step", type=int, default=None,
        help="tester only: promote this explicitly kept checkpoint candidate",
    )

    gate = commands.add_parser("gate", help="print the fail-closed gate's pass/fail table")
    gate.add_argument("--creator", required=True)
    gate.add_argument("--stage", choices=GRADEABLE_STAGES, required=True)
    gate.add_argument("--plan", type=Path, default=Path("plan.json"))

    train_first = commands.add_parser(
        "train-first",
        help="Path-A train-first (r24 method 4 + r21 DOP): plan train+tester against an "
             "already-selected, already-captioned dataset dir, never the module-10 "
             "dataset stage",
    )
    train_first.add_argument("--creator", required=True)
    train_first.add_argument("--dataset-dir", required=True, type=Path)
    train_first.add_argument("--out", required=True, type=Path)
    train_first.add_argument(
        "--skip-pin-verify", action="store_true",
        help="skip the live Hugging Face pin-verification preflight (offline/test use only)",
    )
    accept_dataset = commands.add_parser(
        "accept-dataset",
        help="record explicit operator acceptance of an existing train-first dataset",
    )
    accept_dataset.add_argument("--creator", required=True)
    accept_dataset.add_argument("--dataset-dir", required=True, type=Path)
    accept_dataset.add_argument("--decided-by", required=True)
    accept_dataset.add_argument("--decided-at", required=True)
    return parser


def _print_train_budget(result: dict[str, Any]) -> None:
    train_stage = result.get("stages", {}).get("train")
    if not train_stage or not train_stage["runs"]:
        return
    budget = train_stage["runs"][0].get("budget")
    if not budget:
        return
    print(
        f"train budget: steps={budget['steps']} per_step_s={budget['per_step_s']} "
        f"job_timeout_seconds={budget['job_timeout_seconds']} "
        f"max_minutes={budget['max_minutes']} ceiling_usd=${budget['ceiling_usd']}"
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "plan":
            result = build_plan(
                args.creator, args.stage, args.out, skip_pin_verify=args.skip_pin_verify,
                detail_images=args.detail_images,
            )
            print(f"wrote {args.out.resolve() / 'plan.json'} ({len(result['stages'])} stage(s))")
            _print_train_budget(result)
        elif args.command == "run":
            result = run_planned_stage(args.creator, args.stage, args.plan)
            print(f"stage state: {result['status']}")
        elif args.command == "grade":
            result = build_grade(args.creator, args.stage, args.plan, skip_judge=args.skip_judge)
            print(f"grading page: {result['page']}")
            print(f"rulings template: {result['rulings_template']}")
        elif args.command == "gate":
            document = command_gate(args.creator, args.stage, args.plan)
            print("cached evaluation; freshness verified against current inputs (no recalculation)")
            print(_format_gate_table(document))
        elif args.command == "train-first":
            result = build_train_first_plan(
                args.creator, args.dataset_dir, args.out, skip_pin_verify=args.skip_pin_verify,
            )
            print(f"wrote {args.out.resolve() / 'plan.json'} "
                  f"({len(result['stages'])} stage(s))")
            _print_train_budget(result)
        elif args.command == "accept-dataset":
            result = accept_train_first_dataset(
                args.creator, args.dataset_dir,
                decided_by=args.decided_by, decided_at=args.decided_at,
            )
            print(f"dataset accepted: {Path(args.dataset_dir).resolve() / 'dataset-approval.json'}")
        else:
            result = apply_rulings(
                args.creator, args.stage, args.plan, args.rulings,
                checkpoint_step=args.checkpoint_step,
            )
            print(f"applied rulings: {result['rulings']}")
            print(f"approved list: {result['approved_list']}")
    except (FigmentTrainError, OSError) as exc:
        print(f"STOP: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
