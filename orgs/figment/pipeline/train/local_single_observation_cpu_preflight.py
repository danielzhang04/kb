"""CPU-only ``sd-scripts`` dataset/config parser for a frozen local g01 plan.

Run this only with the fixed local trainer virtual environment after a plan has
been reviewed.  It deliberately sets ``CUDA_VISIBLE_DEVICES`` empty and stops
after sd-scripts has parsed the DreamBooth dataset.  ``sdxl_train_network``
transitively imports torch, so this is not a claim that torch is absent; the
preflight asserts CUDA was never initialized and never constructs a trainer,
accelerator, model, cache, checkpoint, sample, or export.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
PLAN_SCHEMA = "figment/local-single-observation-lora-plan@1"
MAX_PLAN_BYTES = 32 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_DIAGNOSTIC_CHARS = 384
OFFLINE_ENV = {
    "CUDA_VISIBLE_DEVICES": "",
    "HF_HUB_OFFLINE": "1",
    "TRANSFORMERS_OFFLINE": "1",
    "DIFFUSERS_OFFLINE": "1",
    "NO_PROXY": "*",
}


class CpuPreflightError(ValueError):
    pass


def _bounded_exception_chain(error: BaseException) -> str:
    """Expose a small actionable cause without copying runtime output verbatim."""
    parts: list[str] = []
    current: BaseException | None = error
    for _ in range(3):
        if current is None:
            break
        name = type(current).__name__
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}", name):
            name = "Exception"
        message = " ".join(str(current).split())
        # Parser/config errors can include arbitrary local values. Keep the
        # diagnosis useful while never retaining a secret-like value or path.
        if re.search(r"(?i)(api[ _-]?key|access[ _-]?token|password|secret|credential)", message):
            message = "<redacted-sensitive-message>"
        else:
            message = re.sub(r"(?i)(?:[a-z]:[\\/]|/)[^\s]+", "<path>", message)
            message = message[:MAX_DIAGNOSTIC_CHARS]
        parts.append(f"{name}: {message}" if message else name)
        current = current.__cause__
    return " <- ".join(parts)


def _raise_sd_scripts_rejection(error: BaseException) -> None:
    raise CpuPreflightError(
        "sd-scripts rejected the fixed CPU dataset/config; cause="
        + _bounded_exception_chain(error)
    ) from error


def _load_planner() -> Any:
    spec = importlib.util.spec_from_file_location("figment_local_single_observation", HERE / "local_single_observation.py")
    if spec is None or spec.loader is None:  # pragma: no cover
        raise CpuPreflightError("cannot load local observation planner")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _canonical(value: dict[str, Any]) -> bytes:
    value = dict(value)
    value.pop("frozen_sha256", None)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _bounded_bytes(path: Path, maximum: int, label: str) -> bytes:
    try:
        before = path.stat()
        if before.st_size < 1 or before.st_size > maximum:
            raise CpuPreflightError(f"{label} exceeds its bound")
        with path.open("rb") as handle:
            raw = handle.read(maximum + 1)
        after = path.stat()
    except OSError as exc:
        raise CpuPreflightError(f"cannot read {label}") from exc
    if (len(raw) != before.st_size or len(raw) > maximum or after.st_size != before.st_size
            or after.st_mtime_ns != before.st_mtime_ns):
        raise CpuPreflightError(f"{label} changed while it was read")
    return raw


def _read_plan(path: Path) -> dict[str, Any]:
    try:
        if path.is_symlink():
            raise CpuPreflightError("plan is linked or exceeds its bound")
        raw = _bounded_bytes(path, MAX_PLAN_BYTES, "plan")
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CpuPreflightError("plan cannot be read as bounded JSON") from exc
    if not isinstance(value, dict) or value.get("schema") != PLAN_SCHEMA:
        raise CpuPreflightError("unsupported local-observation plan")
    digest = value.get("frozen_sha256")
    if not isinstance(digest, str) or hashlib.sha256(_canonical(value)).hexdigest() != digest:
        raise CpuPreflightError("plan frozen hash is invalid")
    if value.get("execution", {}).get("gpu_fit_probe_allowed") is not False:
        raise CpuPreflightError("CPU preflight requires a GPU-disabled plan")
    return value


def _regular_file(path: Path, root: Path, expected: dict[str, Any]) -> None:
    if not isinstance(expected, dict):
        raise CpuPreflightError("staging file record is malformed")
    try:
        path = _load_planner()._safe_existing(path, root)
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise CpuPreflightError("staging member is not a regular file")
        if info.st_size < 1 or info.st_size > MAX_FILE_BYTES:
            raise CpuPreflightError("staging member exceeds its bound")
        data = _bounded_bytes(path, MAX_FILE_BYTES, "staging member")
    except (OSError, ValueError) as exc:
        raise CpuPreflightError("staging member is missing or unsafe") from exc
    if len(data) != info.st_size or expected.get("bytes") != len(data):
        raise CpuPreflightError("staging member byte count changed")
    if hashlib.sha256(data).hexdigest() != expected.get("sha256"):
        raise CpuPreflightError("staging member hash changed")


def parse_cpu_preflight(plan_path: Path, *, private_root: Path | None = None) -> dict[str, Any]:
    """Parse the exact staged one-observation dataset without creating a trainer."""
    planner = _load_planner()
    plan_path = Path(plan_path).absolute()
    plan_root = plan_path.parent
    private_root = Path(private_root or planner.PRIVATE_ROOT).absolute()
    try:
        planner._safe_existing(plan_path, private_root)
        plan_root.relative_to(private_root)
    except planner.LocalObservationError as exc:
        raise CpuPreflightError("plan is outside the fixed private root or unsafe") from exc
    plan = _read_plan(plan_path)
    if planner._is_reparse(plan_root):
        raise CpuPreflightError("plan root is reparse-backed")
    staging = plan.get("staging")
    trainer = plan.get("trainer")
    if not isinstance(staging, dict) or not isinstance(trainer, dict):
        raise CpuPreflightError("plan staging or trainer section is malformed")
    dataset_rel = staging.get("dataset")
    files = staging.get("files")
    if dataset_rel != f"dataset/1_{planner.TRIGGER}" or not isinstance(files, dict):
        raise CpuPreflightError("plan staging layout is not the fixed one-observation layout")
    template_name = trainer.get("template")
    if not isinstance(template_name, str) or template_name != "fit-probe.toml":
        raise CpuPreflightError("plan config name is not fixed")
    dataset = plan_root / dataset_rel
    config = plan_root / template_name
    try:
        dataset = planner._safe_existing(dataset, plan_root)
        config = planner._safe_existing(config, plan_root)
    except planner.LocalObservationError as exc:
        raise CpuPreflightError("staged dataset or config is unavailable or unsafe") from exc
    if not dataset.is_dir() or not config.is_file():
        raise CpuPreflightError("staged dataset or config is unavailable")
    expected_names = {"g01.jpg", "g01.txt", "fit-probe.toml"}
    if set(files) != expected_names:
        raise CpuPreflightError("staging inventory is not exact")
    observed: set[str] = set()
    try:
        with os.scandir(dataset) as members:
            for member in members:
                observed.add(member.name)
                if len(observed) > 2:
                    raise CpuPreflightError("dataset inventory exceeds its bound")
    except OSError as exc:
        raise CpuPreflightError("dataset inventory is unavailable") from exc
    if observed != {"g01.jpg", "g01.txt"}:
        raise CpuPreflightError("dataset inventory is not exact")
    _regular_file(dataset / "g01.jpg", plan_root, files["g01.jpg"])
    _regular_file(dataset / "g01.txt", plan_root, files["g01.txt"])
    _regular_file(config, plan_root, files["fit-probe.toml"])
    if trainer.get("sd_scripts_commit") != planner.SD_SCRIPTS_COMMIT:
        raise CpuPreflightError("sd-scripts commit is not pinned")
    if trainer.get("script") != "sdxl_train_network.py" or trainer.get("venv_python") != str(planner.VENV_PYTHON):
        raise CpuPreflightError("CPU parser path is not fixed")
    if trainer.get("sd_scripts_script_sha256") != planner._file_sha256(planner.SDXL_SCRIPT)[0]:
        raise CpuPreflightError("sd-scripts training script changed")
    try:
        planner._fixed_regular(planner.VENV_PYTHON, "Python executable")
        planner._fixed_regular(planner.SDXL_SCRIPT, "SDXL trainer script")
        planner._fixed_regular(planner.MODEL_PATH, "checkpoint")
    except planner.LocalObservationError as exc:
        raise CpuPreflightError("pinned CPU parser runtime is unavailable") from exc
    if planner.MODEL_PATH.stat().st_size != planner.MODEL_BYTES:
        raise CpuPreflightError("pinned base model byte count changed")
    model = plan.get("base_model")
    if model != {
        "path": str(planner.MODEL_PATH), "sha256": planner.MODEL_SHA256, "bytes": planner.MODEL_BYTES,
        "license": "OpenRAIL++", "provenance": "2026-09-08-local-comfy-capability.md",
    }:
        raise CpuPreflightError("base model provenance is not fixed")
    if plan.get("creator") != planner.CREATOR or plan.get("observation") != {
        "count": 1, "kind": "canonical-original-pixels", "crop_training_view": None, "independent_views": 1,
    }:
        raise CpuPreflightError("plan is not the fixed one-observation source shape")
    source = plan.get("source")
    if not isinstance(source, dict) or source.get("logical_path") != "anchors/g01.jpg":
        raise CpuPreflightError("plan source is not canonical g01")
    current_g01 = planner._safe_existing(planner.PERSONAS_ROOT / planner.SOURCE_RELATIVE, planner.PERSONAS_ROOT)
    current_bytes, current_width, current_height = planner._read_jpeg(current_g01)
    expected_source = {
        "logical_path": "anchors/g01.jpg", "sha256": hashlib.sha256(current_bytes).hexdigest(),
        "bytes": len(current_bytes), "width": current_width, "height": current_height, "format": "JPEG",
    }
    if source != expected_source or files["g01.jpg"] != {
        "sha256": expected_source["sha256"], "bytes": expected_source["bytes"],
        "width": expected_source["width"], "height": expected_source["height"],
    }:
        raise CpuPreflightError("canonical g01 changed after planning")
    if files["fit-probe.toml"].get("sha256") != planner._file_sha256(planner.TEMPLATE_PATH, maximum=16 * 1024)[0]:
        raise CpuPreflightError("fixed fit-probe template changed")

    try:
        planner._sd_scripts_head()
    except planner.LocalObservationError as exc:
        raise CpuPreflightError("sd-scripts pin cannot be revalidated before CPU parsing") from exc

    # This is intentionally after all on-disk integrity checks.  Importing this
    # parser imports torch, but does not initialize CUDA, construct a model,
    # construct an Accelerator, or enter any training method.
    os.environ.update(OFFLINE_ENV)
    sys.path.insert(0, str(planner.SD_SCRIPTS_ROOT))
    try:
        from library import accelerator_setup, args as args_util, config_util  # type: ignore
        from library.config_util import BlueprintGenerator, ConfigSanitizer  # type: ignore
        import sdxl_train_network  # type: ignore
        import torch

        if torch.cuda.is_initialized():
            raise CpuPreflightError("CUDA was already initialized before CPU parsing")

        original_argv = sys.argv
        sys.argv = [
            "sdxl_train_network.py", "--config_file", str(config),
            "--pretrained_model_name_or_path", str(planner.MODEL_PATH),
            "--train_data_dir", str(plan_root / "dataset"),
            "--output_dir", str(plan_root / "no-output"),
            "--output_name", planner.TRIGGER,
            "--logging_dir", str(plan_root / "no-logs"),
        ]
        parser = sdxl_train_network.setup_parser()
        args = parser.parse_args()
        args_util.verify_command_line_training_args(args)
        args = args_util.read_config_from_file(args, parser)
        accelerator_setup.prepare_dataset_args(args, True)
        config_value = {"datasets": [{"subsets": config_util.generate_dreambooth_subsets_config_by_subdirs(args.train_data_dir, args.reg_data_dir)}]}
        blueprint = BlueprintGenerator(ConfigSanitizer(True, True, args.masked_loss, True)).generate(config_value, args)
        group, _ = config_util.generate_dataset_group_by_blueprint(blueprint.dataset_group)
        group.set_current_strategies()
        count = len(group)
        datasets = group.datasets
        if torch.cuda.is_initialized():
            raise CpuPreflightError("CPU parsing initialized CUDA")
    except Exception as exc:
        _raise_sd_scripts_rejection(exc)
    finally:
        sys.argv = original_argv if "original_argv" in locals() else sys.argv
        if str(planner.SD_SCRIPTS_ROOT) in sys.path:
            sys.path.remove(str(planner.SD_SCRIPTS_ROOT))
    if count != 1 or len(datasets) != 1 or len(datasets[0].image_data) != 1:
        raise CpuPreflightError("sd-scripts did not resolve exactly one observation")
    image_info = next(iter(datasets[0].image_data.values()))
    if image_info.caption != plan.get("caption"):
        raise CpuPreflightError("sd-scripts caption differs from the frozen plan")
    bucket_manager = getattr(datasets[0], "bucket_manager", None)
    buckets = sorted(getattr(bucket_manager, "reso_to_id", {}).keys()) if bucket_manager is not None else []
    return {
        "schema": "figment/local-single-observation-cpu-preflight@1",
        "plan_sha256": plan["frozen_sha256"],
        "cuda_visible_devices": "",
        "offline_environment": sorted(OFFLINE_ENV),
        "cuda_initialized": False,
        "observations": count,
        "unique_source_images": len(datasets[0].image_data),
        "repeat_count": 1,
        "target_resolution": [datasets[0].width, datasets[0].height],
        "effective_buckets": [list(bucket) for bucket in buckets],
        "caption": image_info.caption,
        "not_promotable": True,
        "gpu_fit_probe_allowed": False,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = parse_cpu_preflight(args.plan)
    except CpuPreflightError as exc:
        print(f"local CPU preflight refused: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
