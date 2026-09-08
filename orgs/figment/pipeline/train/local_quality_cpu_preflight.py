"""CPU-only sd-scripts parser for one frozen 100-step quality plan.

It never constructs an Accelerator, loads model weights, creates a cache, or
starts training. The command is intentionally separate from plan creation.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import stat
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PLAN_PATH = HERE / "local_quality_plan.py"
CPU_HELPER_PATH = HERE / "local_single_observation_cpu_preflight.py"
CPU_HELPER_SHA256 = "24317914b2a05790bcf887ab4941f67d623d2c18e73218f019d4f962a173336e"
PLAN_SCHEMA = "figment/local-one-source-quality-plan@1"
RECEIPT_SCHEMA = "figment/local-quality-cpu-preflight@1"
PLAN_NAME = "local-quality-plan.json"
MAX_PLAN_BYTES = 64 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
OFFLINE_ENV = {"CUDA_VISIBLE_DEVICES": "-1", "PYTORCH_NVML_BASED_CUDA_CHECK": "1", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "DIFFUSERS_OFFLINE": "1", "NO_PROXY": "*"}


class QualityCpuError(ValueError):
    pass


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _bounded(path: Path, maximum: int, label: str) -> bytes:
    try:
        before = path.lstat()
        if path.is_symlink() or not stat.S_ISREG(before.st_mode) or before.st_size < 1 or before.st_size > maximum:
            raise QualityCpuError(f"{label} is not a bounded regular file")
        with path.open("rb") as handle: data = handle.read(maximum + 1)
        after = path.lstat()
    except OSError as exc: raise QualityCpuError(f"cannot read {label}") from exc
    if len(data) != before.st_size or len(data) > maximum or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
        raise QualityCpuError(f"{label} changed while read")
    return data


def _load_quality_plan() -> Any:
    source_sha = _sha(_bounded(PLAN_PATH, 256 * 1024, "quality plan module"))
    spec = importlib.util.spec_from_file_location("figment_quality_plan_for_cpu", PLAN_PATH)
    if spec is None or spec.loader is None: raise QualityCpuError("cannot load quality plan module")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    module._cpu_checked_quality_plan_sha256 = source_sha
    return module


def _load_cpu_helper() -> Any:
    actual = _sha(_bounded(CPU_HELPER_PATH, 256 * 1024, "accepted CPU helper"))
    if actual != CPU_HELPER_SHA256: raise QualityCpuError("accepted CPU helper hash changed")
    spec = importlib.util.spec_from_file_location("figment_accepted_cpu_helper", CPU_HELPER_PATH)
    if spec is None or spec.loader is None: raise QualityCpuError("cannot load accepted CPU helper")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def _frozen(plan: dict[str, Any]) -> None:
    body = dict(plan); recorded = body.pop("frozen_sha256", None)
    if not isinstance(recorded, str) or _sha(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()) != recorded:
        raise QualityCpuError("quality plan frozen hash is invalid")


def _expected_recipe(plan: dict[str, Any]) -> None:
    recipe = plan.get("recipe")
    if not isinstance(recipe, dict) or recipe.get("max_train_steps") != 100 or recipe.get("save_every_n_steps") != 10 or recipe.get("save_state") is not False or recipe.get("samples") != 0 or recipe.get("exports") != 0:
        raise QualityCpuError("quality recipe is not closed")
    name = recipe.get("output_name")
    expected = [*[f"{name}-step{step:08d}.safetensors" for step in range(10, 101, 10)], f"{name}.safetensors"]
    if recipe.get("checkpoint_names") != expected or recipe.get("checkpoint_steps") != [*range(10, 101, 10), 100] or recipe.get("max_checkpoint_bytes") != 256 * 1024 * 1024 or recipe.get("max_checkpoint_total_bytes") != 3 * 1024 * 1024 * 1024:
        raise QualityCpuError("quality checkpoint policy is invalid")


def _validate_current_pins(plan: dict[str, Any], quality: Any, planner: Any) -> None:
    """Bind a self-hashed quality plan to present immutable local inputs."""
    try:
        source_path = planner._safe_existing(planner.PERSONAS_ROOT / planner.SOURCE_RELATIVE, planner.PERSONAS_ROOT)
        persona_path = planner._safe_existing(planner.PERSONAS_ROOT / planner.CREATOR / "persona.yaml", planner.PERSONAS_ROOT)
        image, width, height = planner._read_jpeg(source_path)
        caption, persona_sha = quality._caption(plan.get("branch"), planner, persona_path)
        template = _bounded(quality.TEMPLATE_PATH, 16 * 1024, "current quality template")
        current_recipe = quality._recipe(template, plan["recipe"]["output_name"])
        planner._fixed_regular(planner.VENV_PYTHON, "Python executable")
        planner._fixed_regular(planner.SDXL_SCRIPT, "SDXL trainer script")
        planner._fixed_regular(planner.MODEL_PATH, "checkpoint")
        script_sha, _ = planner._file_sha256(planner.SDXL_SCRIPT, maximum=16 * 1024 * 1024)
        if planner.MODEL_PATH.stat().st_size != planner.MODEL_BYTES:
            raise QualityCpuError("base model byte count changed")
        planner._sd_scripts_head()
    except planner.LocalObservationError as exc:
        raise QualityCpuError("current quality pins are unavailable or unsafe") from exc
    except quality.QualityPlanError as exc:
        raise QualityCpuError("current quality template is not closed") from exc
    expected_source = {"logical_path": "anchors/g01.jpg", "sha256": _sha(image), "bytes": len(image), "width": width, "height": height, "format": "JPEG"}
    expected_model = {"path": str(planner.MODEL_PATH), "sha256": planner.MODEL_SHA256, "bytes": planner.MODEL_BYTES, "license": "OpenRAIL++", "provenance": "2026-09-08-local-comfy-capability.md"}
    expected_trainer = {"script": "sdxl_train_network.py", "sd_scripts_commit": planner.SD_SCRIPTS_COMMIT, "sd_scripts_script_sha256": script_sha, "venv_python": str(planner.VENV_PYTHON), "template": "local-quality.toml"}
    if plan.get("source") != expected_source or plan.get("caption") != caption or plan.get("persona_sha256") != persona_sha:
        raise QualityCpuError("quality source, caption, or persona changed")
    if plan.get("base_model") != expected_model or plan.get("trainer") != expected_trainer:
        raise QualityCpuError("quality trainer or model pin changed")
    if plan.get("recipe") != current_recipe:
        raise QualityCpuError("quality template recipe changed")
    staged = plan["staging"]["files"]
    if staged["g01.jpg"] != {"sha256": expected_source["sha256"], "bytes": expected_source["bytes"], "width": width, "height": height} or staged["g01.txt"] != {"sha256": _sha((caption + "\n").encode()), "bytes": len((caption + "\n").encode())} or staged["local-quality.toml"] != {"sha256": _sha(template), "bytes": len(template)}:
        raise QualityCpuError("quality staged records disagree with current pins")


def validate_plan(plan_path: Path, *, private_root: Path | None = None) -> tuple[dict[str, Any], Any, Path]:
    quality = _load_quality_plan(); planner = quality._load_planner()
    private_root = Path(private_root or planner.PRIVATE_ROOT).absolute(); plan_path = Path(plan_path).absolute()
    try:
        plan_path = planner._safe_existing(plan_path, private_root)
    except planner.LocalObservationError as exc: raise QualityCpuError("quality plan is outside fixed private root") from exc
    if plan_path.name != PLAN_NAME: raise QualityCpuError("quality plan name is invalid")
    raw = _bounded(plan_path, MAX_PLAN_BYTES, "quality plan")
    try: plan = json.loads(raw.decode())
    except (UnicodeDecodeError, json.JSONDecodeError) as exc: raise QualityCpuError("quality plan is invalid JSON") from exc
    if not isinstance(plan, dict) or plan.get("schema") != PLAN_SCHEMA: raise QualityCpuError("quality plan schema is invalid")
    _frozen(plan); _expected_recipe(plan)
    if plan.get("purpose") != "one-source-local-quality-diagnostic" or plan.get("not_promotable") is not True:
        raise QualityCpuError("quality plan purpose or promotion boundary is invalid")
    if plan.get("execution") != {"cpu_preflight_allowed": True, "gpu_quality_allowed": False, "sample_export_allowed": False, "checkpoint_acceptance_allowed": False}:
        raise QualityCpuError("quality plan execution boundary is invalid")
    if plan.get("creator") != planner.CREATOR or plan.get("observation") != {"count": 1, "kind": "canonical-original-pixels", "crop_training_view": None, "independent_views": 1}:
        raise QualityCpuError("quality plan observation boundary is invalid")
    if plan.get("branch") not in {"current", "concise"} or plan["recipe"].get("output_name") != f"figmentlocalg01quality-{plan['branch']}-100":
        raise QualityCpuError("quality plan branch output name is invalid")
    root = plan_path.parent; staging = plan.get("staging")
    if not isinstance(staging, dict) or not isinstance(staging.get("files"), dict):
        raise QualityCpuError("quality stage shape is invalid")
    files = staging["files"]
    if staging.get("dataset") != f"dataset/1_{planner.TRIGGER}" or set(files) != {"g01.jpg", "g01.txt", "local-quality.toml"}:
        raise QualityCpuError("quality stage shape is invalid")
    dataset_parent = root / "dataset"; dataset = root / staging["dataset"]
    try:
        dataset_parent = planner._safe_existing(dataset_parent, root)
        dataset = planner._safe_existing(dataset, root)
        template = planner._safe_existing(root / "local-quality.toml", root)
    except planner.LocalObservationError as exc: raise QualityCpuError("quality stage is unsafe") from exc
    parent_names: set[str] = set(); names: set[str] = set()
    try:
        with os.scandir(dataset_parent) as entries:
            for entry in entries:
                parent_names.add(entry.name)
                if len(parent_names) > 1: raise QualityCpuError("quality repeat root inventory exceeds bound")
        with os.scandir(dataset) as entries:
            for entry in entries:
                names.add(entry.name)
                if len(names) > 2: raise QualityCpuError("quality dataset inventory exceeds bound")
    except OSError as exc: raise QualityCpuError("quality dataset inventory unavailable") from exc
    if parent_names != {f"1_{planner.TRIGGER}"} or names != {"g01.jpg", "g01.txt"}: raise QualityCpuError("quality dataset inventory is not exact")
    for relative, record in (("g01.jpg", files["g01.jpg"]), ("g01.txt", files["g01.txt"]), ("local-quality.toml", files["local-quality.toml"])):
        path = template if relative == "local-quality.toml" else dataset / relative
        data = _bounded(path, MAX_FILE_BYTES, "quality staged file")
        if not isinstance(record, dict) or record.get("bytes") != len(data) or record.get("sha256") != _sha(data): raise QualityCpuError("quality staged file changed")
    expected_code = {"planner_sha256": getattr(planner, "_quality_planner_sha256", None), "quality_plan_sha256": quality._cpu_checked_quality_plan_sha256, "cpu_helper_sha256": CPU_HELPER_SHA256}
    if plan.get("code") != expected_code: raise QualityCpuError("quality planner module changed")
    _validate_current_pins(plan, quality, planner)
    return plan, planner, root


def parse_cpu_preflight(plan_path: Path) -> dict[str, Any]:
    plan, planner, root = validate_plan(plan_path)
    helper = _load_cpu_helper()
    try:
        if Path(sys.executable).resolve(strict=True) != planner.VENV_PYTHON.resolve(strict=True):
            raise QualityCpuError("quality CPU parser requires the fixed trainer interpreter")
    except OSError as exc:
        raise QualityCpuError("quality CPU parser interpreter is unavailable") from exc
    os.environ.update(OFFLINE_ENV)
    sys.path.insert(0, str(planner.SD_SCRIPTS_ROOT))
    try:
        from library import accelerator_setup, args as args_util, config_util
        from library.config_util import BlueprintGenerator, ConfigSanitizer
        import sdxl_train_network, torch
        state = helper._assert_cpu_torch_state(torch)
        original_argv = sys.argv
        sys.argv = ["sdxl_train_network.py", "--config_file", str(root / "local-quality.toml"), "--pretrained_model_name_or_path", str(planner.MODEL_PATH), "--train_data_dir", str(root / "dataset"), "--output_dir", str(root / "no-output"), "--output_name", plan["recipe"]["output_name"], "--logging_dir", str(root / "no-logs")]
        parser = sdxl_train_network.setup_parser(); args = parser.parse_args()
        args_util.verify_command_line_training_args(args)
        args = args_util.read_config_from_file(args, parser)
        accelerator_setup.prepare_dataset_args(args, True)
        blueprint = BlueprintGenerator(ConfigSanitizer(True, True, args.masked_loss, True)).generate({"datasets": [{"subsets": config_util.generate_dreambooth_subsets_config_by_subdirs(args.train_data_dir, args.reg_data_dir)}]}, args)
        group, _ = config_util.generate_dataset_group_by_blueprint(blueprint.dataset_group); group.set_current_strategies(); state = helper._assert_cpu_torch_state(torch)
    except Exception as exc: raise QualityCpuError("sd-scripts rejected quality plan; cause=" + helper._bounded_exception_chain(exc)) from exc
    finally:
        sys.argv = original_argv if "original_argv" in locals() else sys.argv
        if str(planner.SD_SCRIPTS_ROOT) in sys.path: sys.path.remove(str(planner.SD_SCRIPTS_ROOT))
    if len(group) != 1 or len(group.datasets) != 1 or len(group.datasets[0].image_data) != 1: raise QualityCpuError("quality parser did not resolve one image")
    image = next(iter(group.datasets[0].image_data.values()))
    if image.caption != plan["caption"]: raise QualityCpuError("quality parser caption changed")
    bucket_manager = getattr(group.datasets[0], "bucket_manager", None)
    buckets = sorted(getattr(bucket_manager, "reso_to_id", {}).keys()) if bucket_manager is not None else []
    return {"schema": RECEIPT_SCHEMA, "plan_sha256": plan["frozen_sha256"], "quality_plan_module_sha256": _sha(_bounded(PLAN_PATH, 256 * 1024, "quality plan module")), "offline_environment": sorted(OFFLINE_ENV), **state, "observations": 1, "unique_source_images": 1, "repeat_count": 1, "caption": image.caption, "target_resolution": [group.datasets[0].width, group.datasets[0].height], "effective_buckets": [list(bucket) for bucket in buckets], "not_promotable": True, "gpu_quality_allowed": False}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--plan", required=True, type=Path); args = parser.parse_args(argv)
    try: result = parse_cpu_preflight(args.plan)
    except QualityCpuError as exc: print(f"local quality CPU preflight refused: {exc}", file=sys.stderr); return 2
    print(json.dumps(result, sort_keys=True)); return 0


if __name__ == "__main__": raise SystemExit(main())
