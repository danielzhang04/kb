"""Freeze a closed 100-step, one-source local quality-diagnostic plan.

This creates evidence only. It never invokes the trainer, imports torch, or
initializes CUDA. A later root admission and separate CPU parser receipt are
required before any quality execution.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import tomllib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PLANNER_PATH = HERE / "local_single_observation.py"
CPU_HELPER_PATH = HERE / "local_single_observation_cpu_preflight.py"
CPU_HELPER_SHA256 = "24317914b2a05790bcf887ab4941f67d623d2c18e73218f019d4f962a173336e"
TEMPLATE_PATH = HERE / "local_quality.toml"
PLAN_NAME = "local-quality-plan.json"
SCHEMA = "figment/local-one-source-quality-plan@1"
MAX_TEMPLATE_BYTES = 16 * 1024
MAX_ARTIFACT_BYTES = 256 * 1024 * 1024
MAX_ARTIFACT_TOTAL_BYTES = 3 * 1024 * 1024 * 1024
CONCISE_CAPTION = (
    "figmentlocalg01probe, fictional adult woman around twenty-one, long center-parted "
    "jet-black hair, dark brown eyes, narrow eyelids with lifted asymmetry, dark arched "
    "brows, tapered jaw, natural skin texture, opaque black strapped top, bedroom photograph"
)
FIXED_TOML = {"mixed_precision":"bf16","save_precision":"fp16","gradient_checkpointing":True,"sdpa":True,"cache_latents":True,"cache_latents_to_disk":True,"cache_text_encoder_outputs":True,"cache_text_encoder_outputs_to_disk":True,"network_train_unet_only":True,"max_data_loader_n_workers":0,"persistent_data_loader_workers":False,"vae_batch_size":1,"enable_bucket":True,"resolution":"768,768","min_bucket_reso":512,"max_bucket_reso":1024,"bucket_reso_steps":64,"bucket_no_upscale":True,"train_batch_size":1,"gradient_accumulation_steps":1,"max_train_steps":100,"seed":481516234,"network_module":"networks.lora","network_dim":32,"network_alpha":16,"optimizer_type":"AdamW8bit","learning_rate":1e-4,"lr_scheduler":"cosine","lr_warmup_steps":0,"caption_extension":".txt","shuffle_caption":False,"keep_tokens":1,"max_token_length":225,"clip_skip":2,"min_snr_gamma":5.0,"save_model_as":"safetensors","save_every_n_steps":10,"save_state":False,"save_state_on_train_end":False,"sample_every_n_steps":0,"log_with":"tensorboard"}


class QualityPlanError(ValueError):
    pass


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _bounded(path: Path, maximum: int, label: str) -> bytes:
    try:
        before = path.stat()
        if before.st_size < 1 or before.st_size > maximum or path.is_symlink():
            raise QualityPlanError(f"{label} is not a bounded regular file")
        with path.open("rb") as handle:
            data = handle.read(maximum + 1)
        after = path.stat()
    except OSError as exc:
        raise QualityPlanError(f"cannot read {label}") from exc
    if len(data) != before.st_size or len(data) > maximum or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
        raise QualityPlanError(f"{label} changed while read")
    return data


def _load_planner() -> Any:
    # Read and bind exact planner bytes before importing its helpers.
    planner_sha = _sha(_bounded(PLANNER_PATH, 256 * 1024, "one-source planner"))
    spec = importlib.util.spec_from_file_location("figment_quality_planner", PLANNER_PATH)
    if spec is None or spec.loader is None:
        raise QualityPlanError("cannot load one-source planner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._quality_planner_sha256 = planner_sha
    return module


def _canonical(value: dict[str, Any]) -> bytes:
    copy = dict(value)
    copy.pop("frozen_sha256", None)
    return json.dumps(copy, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _write_exclusive(path: Path, data: bytes) -> None:
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as exc:
        raise QualityPlanError(f"cannot exclusively publish {path.name}") from exc


def _caption(branch: str, planner: Any, persona_path: Path) -> tuple[str, str]:
    if branch == "current":
        return planner._persona_caption(persona_path)
    if branch == "concise":
        if len(CONCISE_CAPTION.encode("utf-8")) > planner.MAX_CAPTION_BYTES:
            raise QualityPlanError("concise caption exceeds bound")
        return CONCISE_CAPTION, _sha(_bounded(persona_path, 64 * 1024, "creator persona"))
    raise QualityPlanError("branch must be current or concise")


def _recipe(template: bytes, output_name: str) -> dict[str, Any]:
    try: parsed = tomllib.loads(template.decode("utf-8"))
    except (UnicodeDecodeError, tomllib.TOMLDecodeError) as exc: raise QualityPlanError("quality template is not TOML") from exc
    if parsed != FIXED_TOML: raise QualityPlanError("quality template does not match the fixed recipe")
    periodic = [f"{output_name}-step{step:08d}.safetensors" for step in range(10, 101, 10)]
    names = [*periodic, f"{output_name}.safetensors"]
    return {
        "max_train_steps": 100,
        "save_every_n_steps": 10,
        "save_state": False,
        "samples": 0,
        "exports": 0,
        "output_name": output_name,
        "checkpoint_names": names,
        "checkpoint_steps": [*range(10, 101, 10), 100],
        "max_checkpoint_bytes": MAX_ARTIFACT_BYTES,
        "max_checkpoint_total_bytes": MAX_ARTIFACT_TOTAL_BYTES,
    }


def build_plan(out: str, *, branch: str = "current", personas_root: Path | None = None, private_root: Path | None = None) -> dict[str, Any]:
    planner = _load_planner()
    personas_root = Path(personas_root or planner.PERSONAS_ROOT).absolute()
    private_root = Path(private_root or planner.PRIVATE_ROOT).absolute()
    if not out.startswith("figment-local-quality-"):
        raise QualityPlanError("quality plan output must use the fixed private prefix")
    try:
        destination = planner._safe_fresh_output(private_root, Path(out))
        g01 = planner._safe_existing(personas_root / planner.SOURCE_RELATIVE, personas_root)
        persona = planner._safe_existing(personas_root / planner.CREATOR / "persona.yaml", personas_root)
        template = planner._safe_existing(TEMPLATE_PATH, HERE)
        image, width, height = planner._read_jpeg(g01)
        caption, persona_sha = _caption(branch, planner, persona)
        template_bytes = _bounded(template, MAX_TEMPLATE_BYTES, "quality template")
        planner._fixed_regular(planner.VENV_PYTHON, "Python executable")
        planner._fixed_regular(planner.SDXL_SCRIPT, "SDXL trainer script")
        planner._fixed_regular(planner.MODEL_PATH, "checkpoint")
        planner._sd_scripts_head()
        model_sha, model_bytes = planner._file_sha256(planner.MODEL_PATH, maximum=planner.MODEL_BYTES)
    except planner.LocalObservationError as exc:
        raise QualityPlanError("quality plan inputs are unavailable or unsafe") from exc
    if model_sha != planner.MODEL_SHA256 or model_bytes != planner.MODEL_BYTES:
        raise QualityPlanError("base model disagrees with its pin")
    output_name = f"figmentlocalg01quality-{branch}-100"
    recipe = _recipe(template_bytes, output_name)
    helper_sha = _sha(_bounded(CPU_HELPER_PATH, 256 * 1024, "accepted CPU helper"))
    if helper_sha != CPU_HELPER_SHA256: raise QualityPlanError("accepted CPU helper hash changed")
    image_sha = _sha(image)
    destination.mkdir()
    dataset = destination / "dataset" / f"1_{planner.TRIGGER}"
    dataset.mkdir(parents=True)
    _write_exclusive(dataset / "g01.jpg", image)
    _write_exclusive(dataset / "g01.txt", (caption + "\n").encode("utf-8"))
    _write_exclusive(destination / "local-quality.toml", template_bytes)
    files = {
        "g01.jpg": {"sha256": image_sha, "bytes": len(image), "width": width, "height": height},
        "g01.txt": {"sha256": _sha((caption + "\n").encode()), "bytes": len((caption + "\n").encode())},
        "local-quality.toml": {"sha256": _sha(template_bytes), "bytes": len(template_bytes)},
    }
    plan: dict[str, Any] = {
        "schema": SCHEMA, "purpose": "one-source-local-quality-diagnostic", "not_promotable": True,
        "execution": {"cpu_preflight_allowed": True, "gpu_quality_allowed": False, "sample_export_allowed": False, "checkpoint_acceptance_allowed": False},
        "branch": branch, "creator": planner.CREATOR,
        "observation": {"count": 1, "kind": "canonical-original-pixels", "crop_training_view": None, "independent_views": 1},
        "source": {"logical_path": "anchors/g01.jpg", "sha256": image_sha, "bytes": len(image), "width": width, "height": height, "format": "JPEG"},
        "caption": caption, "persona_sha256": persona_sha,
        "staging": {"dataset": f"dataset/1_{planner.TRIGGER}", "files": files}, "recipe": recipe,
        "trainer": {"script": "sdxl_train_network.py", "sd_scripts_commit": planner.SD_SCRIPTS_COMMIT, "sd_scripts_script_sha256": planner._file_sha256(planner.SDXL_SCRIPT)[0], "venv_python": str(planner.VENV_PYTHON), "template": "local-quality.toml"},
        "base_model": {"path": str(planner.MODEL_PATH), "sha256": planner.MODEL_SHA256, "bytes": planner.MODEL_BYTES, "license": "OpenRAIL++", "provenance": "2026-09-08-local-comfy-capability.md"},
        "code": {"planner_sha256": planner._quality_planner_sha256, "quality_plan_sha256": _sha(_bounded(Path(__file__), 256 * 1024, "quality planner")), "cpu_helper_sha256": helper_sha},
        "generated_utc": datetime.now(timezone.utc).isoformat(),
    }
    plan["frozen_sha256"] = _sha(_canonical(plan))
    _write_exclusive(destination / PLAN_NAME, json.dumps(plan, indent=2, sort_keys=True).encode() + b"\n")
    return plan


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True); parser.add_argument("--branch", choices=("current", "concise"), default="current")
    args = parser.parse_args(argv)
    try: plan = build_plan(args.out, branch=args.branch)
    except QualityPlanError as exc:
        print(f"local quality plan refused: {exc}"); return 2
    print(json.dumps({"plan": PLAN_NAME, "frozen_sha256": plan["frozen_sha256"], "not_promotable": True})); return 0


if __name__ == "__main__":
    raise SystemExit(main())
