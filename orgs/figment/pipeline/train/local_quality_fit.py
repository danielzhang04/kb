"""Explicit, bounded executor for a frozen one-source 100-step quality run.

Validation is side-effect free.  ``--execute`` is required for the later,
separately admitted local training launch; it never samples, exports, accepts,
or promotes a checkpoint.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
import threading
import time
from pathlib import Path, PurePath
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PRIVATE_ROOT = ROOT / "_private"
MAIN_PRIVATE_ROOT = ROOT.parents[1]
RUNTIME_PATH = HERE / "local_fit_runtime.py"
QUALITY_PLAN_PATH = HERE / "local_quality_plan.py"
QUALITY_CPU_PATH = HERE / "local_quality_cpu_preflight.py"
OLD_PLANNER_PATH = HERE / "local_single_observation.py"
OLD_CPU_HELPER_PATH = HERE / "local_single_observation_cpu_preflight.py"
TOKENIZER_PATH = HERE / "local_tokenizer_preflight.py"
OWNERSHIP_PATH = HERE.parent / "expand" / "local_comfy_input.py"
QUALITY_CPU_LAUNCHER = MAIN_PRIVATE_ROOT / "run-figment-local-quality-cpu-preflight-20260908.py"

PLAN_SCHEMA = "figment/local-one-source-quality-plan@1"
CPU_SCHEMA = "figment/local-quality-cpu-preflight-launch@1"
CPU_RESULT_SCHEMA = "figment/local-quality-cpu-preflight@1"
ADMISSION_SCHEMA = "figment/local-quality-fit-admission@1"
RUN_SCHEMA = "figment/local-quality-fit@1"
PLAN_NAME = "local-quality-plan.json"
PREPARED_NAME = "local-tokenizer-prepared.json"
LOAD_NAME = "local-tokenizer-load.json"
MAX_JSON_BYTES = 256 * 1024
MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_TOKENIZER_FILE_BYTES = 4 * 1024 * 1024
MAX_TOKENIZER_TOTAL_BYTES = 16 * 1024 * 1024
MAX_LOG_BYTES = 256 * 1024
MAX_LOG_FILES = 24
MAX_CHECKPOINT_BYTES = 256 * 1024 * 1024
MAX_CHECKPOINT_TOTAL_BYTES = 3 * 1024 * 1024 * 1024
MAX_WALL_SECONDS = 20 * 60
SAFE_ID = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")
HEX = re.compile(r"[0-9a-f]{64}\Z")
TOKENIZER_IDS = ("openai/clip-vit-large-patch14", "laion/CLIP-ViT-bigG-14-laion2B-39B-b160k")
TOKENIZER_DIRS = {
    TOKENIZER_IDS[0]: "openai_clip-vit-large-patch14",
    TOKENIZER_IDS[1]: "laion_CLIP-ViT-bigG-14-laion2B-39B-b160k",
}
TOKENIZER_FILES = {"merges.txt", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.json"}


def _load_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


runtime = _load_module("figment_quality_fit_runtime", RUNTIME_PATH)
QualityFitError = runtime.FitRuntimeError


def _sha(data: bytes) -> str:
    return runtime.sha(data)


def _bounded(path: Path, maximum: int, label: str, empty: bool = False) -> bytes:
    return runtime.bounded(path, maximum, label, empty=empty)


def _safe(path: Path, root: Path, label: str) -> Path:
    return runtime.safe(path, root, label)


def _json(path: Path, maximum: int, label: str) -> tuple[dict[str, Any], bytes]:
    return runtime.json_object(path, maximum, label)


def _frozen(value: dict[str, Any], label: str) -> None:
    runtime.frozen(value, label, HEX)


def _checked_module(name: str, path: Path, expected: str | None = None) -> tuple[Any, str]:
    digest = _sha(_bounded(path, MAX_JSON_BYTES, name))
    if expected is not None and digest != expected:
        raise QualityFitError(f"{name} hash changed")
    return _load_module(name, path), digest


def _hashes() -> dict[str, str]:
    paths = {
        "launcher_sha256": Path(__file__), "runtime_sha256": RUNTIME_PATH,
        "quality_planner_sha256": QUALITY_PLAN_PATH, "quality_cpu_parser_sha256": QUALITY_CPU_PATH,
        "planner_sha256": OLD_PLANNER_PATH, "cpu_helper_sha256": OLD_CPU_HELPER_PATH,
        "tokenizer_preflight_sha256": TOKENIZER_PATH, "ownership_sha256": OWNERSHIP_PATH,
    }
    return {key: _sha(_bounded(path, MAX_JSON_BYTES, key)) for key, path in paths.items()}


def _quality(expected: str) -> Any:
    return _checked_module("figment_quality_fit_plan", QUALITY_PLAN_PATH, expected)[0]


def _cpu_parser(expected: str) -> Any:
    return _checked_module("figment_quality_fit_cpu", QUALITY_CPU_PATH, expected)[0]


def _planner(expected: str) -> Any:
    return _checked_module("figment_quality_fit_planner", OLD_PLANNER_PATH, expected)[0]


def _ownership(expected: str) -> Any:
    return _checked_module("figment_quality_fit_ownership", OWNERSHIP_PATH, expected)[0]


def _plan(path: Path, private: Path) -> tuple[dict[str, Any], bytes]:
    path = _safe(path, private, "quality plan")
    if path.name != PLAN_NAME or path.parent.parent != private:
        raise QualityFitError("quality plan location is not fixed")
    value, raw = _json(path, MAX_JSON_BYTES, "quality plan")
    _frozen(value, "quality plan")
    if value.get("schema") != PLAN_SCHEMA or value.get("purpose") != "one-source-local-quality-diagnostic":
        raise QualityFitError("quality plan schema is invalid")
    if value.get("not_promotable") is not True or value.get("execution") != {
        "cpu_preflight_allowed": True, "gpu_quality_allowed": False,
        "sample_export_allowed": False, "checkpoint_acceptance_allowed": False,
    }:
        raise QualityFitError("quality plan execution boundary is invalid")
    if value.get("branch") not in {"current", "concise"}:
        raise QualityFitError("quality plan branch is invalid")
    return value, raw


def _recipe(plan: dict[str, Any]) -> tuple[runtime.RunPolicy, str]:
    recipe = plan.get("recipe")
    if not isinstance(recipe, dict) or recipe.get("max_train_steps") != 100 or recipe.get("save_every_n_steps") != 10:
        raise QualityFitError("quality recipe is not 100-step/every-10")
    output_name = recipe.get("output_name")
    if not isinstance(output_name, str) or output_name != f"figmentlocalg01quality-{plan['branch']}-100" or not SAFE_ID.fullmatch(output_name):
        raise QualityFitError("quality output name is invalid")
    names = [*[f"{output_name}-step{step:08d}.safetensors" for step in range(10, 101, 10)], f"{output_name}.safetensors"]
    steps = [*range(10, 101, 10), 100]
    if recipe.get("checkpoint_names") != names or recipe.get("checkpoint_steps") != steps:
        raise QualityFitError("quality checkpoint names are not exact")
    if recipe.get("max_checkpoint_bytes") != MAX_CHECKPOINT_BYTES or recipe.get("max_checkpoint_total_bytes") != MAX_CHECKPOINT_TOTAL_BYTES:
        raise QualityFitError("quality checkpoint limits are invalid")
    if recipe.get("save_state") is not False or recipe.get("samples") != 0 or recipe.get("exports") != 0:
        raise QualityFitError("quality recipe expands the admitted boundary")
    return runtime.RunPolicy(
        "figment-local-quality-fit-", "figment-local-quality-fit-dispatches", MAX_WALL_SECONDS,
        MAX_LOG_BYTES, MAX_LOG_FILES, MAX_CHECKPOINT_BYTES, MAX_CHECKPOINT_TOTAL_BYTES,
        tuple(runtime.ArtifactPolicy(name, step) for name, step in zip(names, steps)),
    ), output_name


def _cpu(path: Path, plan: dict[str, Any], raw_sha: str, hashes: dict[str, str], launcher_sha: str, main: Path) -> str:
    path = _safe(path, main, "quality CPU receipt")
    if path.name != "receipt.json":
        raise QualityFitError("quality CPU receipt name is invalid")
    value, raw = _json(path, MAX_JSON_BYTES, "quality CPU receipt")
    result = value.get("result")
    inputs = value.get("inputs")
    teardown = value.get("teardown")
    process = value.get("process")
    if not isinstance(result, dict) or not isinstance(inputs, dict) or not isinstance(teardown, dict) or not isinstance(process, dict):
        raise QualityFitError("quality CPU receipt shape is invalid")
    expected_inputs = {
        "plan_file_sha256": raw_sha, "plan_canonical_sha256": plan["frozen_sha256"],
        "quality_parser_sha256": hashes["quality_cpu_parser_sha256"],
        "quality_planner_sha256": hashes["quality_planner_sha256"],
        "planner_sha256": hashes["planner_sha256"], "cpu_helper_sha256": hashes["cpu_helper_sha256"],
        "ownership_sha256": hashes["ownership_sha256"], "launcher_sha256": launcher_sha,
    }
    if any(inputs.get(key) != expected for key, expected in expected_inputs.items()):
        raise QualityFitError("quality CPU receipt inputs are stale")
    staged = plan.get("staging", {}).get("files", {})
    for name in ("g01.jpg", "g01.txt", "local-quality.toml"):
        if inputs.get(f"stage_{name}_sha256") != staged.get(name, {}).get("sha256"):
            raise QualityFitError("quality CPU receipt stage binding is stale")
    offline = result.get("offline_environment")
    if (
        value.get("schema") != CPU_SCHEMA or value.get("status") != "complete" or value.get("plan_sha256") != plan["frozen_sha256"]
        or process.get("exit_code") != 0 or teardown.get("verified_stopped") is not True
        or value.get("branch") != plan["branch"] or result.get("schema") != CPU_RESULT_SCHEMA or result.get("plan_sha256") != plan["frozen_sha256"]
        or result.get("quality_plan_module_sha256") != hashes["quality_planner_sha256"]
        or (result.get("observations"), result.get("unique_source_images"), result.get("repeat_count")) != (1, 1, 1)
        or result.get("caption") != plan.get("caption") or result.get("target_resolution") != [768, 768]
        or result.get("effective_buckets") != [[896, 512]] or result.get("cuda_visible_devices") != "-1"
        or result.get("cuda_available") is not False or result.get("cuda_device_count") != 0 or result.get("cuda_initialized") is not False
        or result.get("not_promotable") is not True or result.get("gpu_quality_allowed") is not False
        or not isinstance(offline, list) or "PYTORCH_NVML_BASED_CUDA_CHECK" not in offline
    ):
        raise QualityFitError("quality CPU receipt does not prove the fixed parser preflight")
    return _sha(raw)


def _tokenizer_rel(record: dict[str, Any]) -> Path:
    identifier, name = record.get("tokenizer"), record.get("path")
    if identifier not in TOKENIZER_DIRS or not isinstance(name, str) or "\\" in name:
        raise QualityFitError("tokenizer path is invalid")
    pure = PurePath(name)
    if pure.is_absolute() or len(pure.parts) != 2 or pure.parts[0] != TOKENIZER_DIRS[identifier] or pure.parts[1] not in TOKENIZER_FILES or any(part in {"", ".", ".."} for part in pure.parts):
        raise QualityFitError("tokenizer path is not exact id-derived layout")
    return Path(*pure.parts)


def _prepared(path: Path, private: Path) -> tuple[dict[str, Any], str]:
    path = _safe(path, private, "prepared tokenizer receipt")
    if path.name != PREPARED_NAME:
        raise QualityFitError("prepared tokenizer receipt name is invalid")
    value, raw = _json(path, MAX_JSON_BYTES, "prepared tokenizer receipt")
    _frozen(value, "prepared tokenizer receipt")
    copies = value.get("copies")
    if value.get("schema") != "figment/local-tokenizer-prepared@1" or value.get("not_promotable") is not True or value.get("runtime_or_training_approval") is not False or not isinstance(value.get("inventory_sha256"), str) or not HEX.fullmatch(value["inventory_sha256"]) or not isinstance(copies, list) or len(copies) != 10:
        raise QualityFitError("prepared tokenizer receipt is invalid")
    seen: set[tuple[str, str]] = set(); total = 0
    for record in copies:
        if not isinstance(record, dict):
            raise QualityFitError("tokenizer record is invalid")
        relative = _tokenizer_rel(record); key = (record["tokenizer"], relative.name)
        if key in seen or not isinstance(record.get("bytes"), int) or not 0 < record["bytes"] <= MAX_TOKENIZER_FILE_BYTES or not isinstance(record.get("sha256"), str) or not HEX.fullmatch(record["sha256"]):
            raise QualityFitError("tokenizer record binding is invalid")
        seen.add(key); total += record["bytes"]
    if seen != {(identifier, name) for identifier in TOKENIZER_IDS for name in TOKENIZER_FILES} or total > MAX_TOKENIZER_TOTAL_BYTES or value.get("total_bytes") != total:
        raise QualityFitError("tokenizer inventory is incomplete")
    return value, _sha(raw)


def _load_receipt(path: Path, private: Path, prepared_sha: str, inventory: str, copies: list[dict[str, Any]]) -> str:
    path = _safe(path, private, "tokenizer load receipt")
    if path.name != LOAD_NAME:
        raise QualityFitError("tokenizer load receipt name is invalid")
    value, raw = _json(path, MAX_JSON_BYTES, "tokenizer load receipt")
    _frozen(value, "tokenizer load receipt")
    cuda = (value.get("torch_imported") is False and value.get("cuda_available") is None and value.get("cuda_device_count") is None) or (value.get("torch_imported") is True and value.get("cuda_available") is False and value.get("cuda_device_count") == 0)
    tokens = value.get("tokenizers")
    if value.get("schema") != "figment/local-tokenizer-load@1" or value.get("not_promotable") is not True or value.get("runtime_or_training_approval") is not False or value.get("prepared_receipt_sha256") != prepared_sha or value.get("inventory_sha256") != inventory or value.get("copies") != copies or value.get("cuda_visible_devices") != "-1" or value.get("pytorch_nvml_based_cuda_check") != "1" or value.get("cuda_initialized") is not False or not cuda or not isinstance(tokens, list) or len(tokens) != 2:
        raise QualityFitError("tokenizer load receipt is invalid")
    seen: set[str] = set()
    for token in tokens:
        if not isinstance(token, dict) or token.get("id") not in TOKENIZER_IDS or token["id"] in seen or token.get("class") != "CLIPTokenizer" or token.get("local_files_only") is not True or not isinstance(token.get("effective_pad_token_id"), int) or not isinstance(token.get("caption_token_count"), int) or token["caption_token_count"] < 1 or (token["id"] == TOKENIZER_IDS[1] and token["effective_pad_token_id"] != 0):
            raise QualityFitError("tokenizer load result is invalid")
        seen.add(token["id"])
    if seen != set(TOKENIZER_IDS):
        raise QualityFitError("tokenizer load receipt is incomplete")
    return _sha(raw)


def _current_copies(prepared_path: Path, prepared: dict[str, Any], private: Path) -> list[dict[str, Any]]:
    root = _safe(prepared_path.parent, private, "tokenizer root")
    copies = []
    for record in prepared["copies"]:
        relative = _tokenizer_rel(record)
        data = _bounded(_safe(root / relative, root, "tokenizer asset"), MAX_TOKENIZER_FILE_BYTES, "tokenizer asset")
        if len(data) != record["bytes"] or _sha(data) != record["sha256"]:
            raise QualityFitError("tokenizer asset changed")
        copies.append(dict(record))
    return copies


def _admission(path: Path, private: Path, plan_sha: str, cpu_sha: str, prepared: dict[str, Any], prepared_sha: str, load_sha: str, hashes: dict[str, str], launcher_sha: str) -> dict[str, Any]:
    value, _ = _json(_safe(path, private, "quality admission"), MAX_JSON_BYTES, "quality admission")
    _frozen(value, "quality admission")
    expected = {
        "plan_sha256": plan_sha, "cpu_receipt_sha256": cpu_sha,
        "tokenizer_inventory_sha256": prepared["inventory_sha256"],
        "tokenizer_prepared_receipt_sha256": prepared_sha, "tokenizer_probe_sha256": load_sha,
        "allow_gpu_quality": True, "max_train_steps": 100, "max_wall_seconds": MAX_WALL_SECONDS,
        "gpu_device": 0, "max_checkpoint_bytes": MAX_CHECKPOINT_BYTES,
        "max_checkpoint_total_bytes": MAX_CHECKPOINT_TOTAL_BYTES, "not_promotable": True,
        "quality_cpu_launcher_sha256": launcher_sha, **hashes,
    }
    if value.get("schema") != ADMISSION_SCHEMA or not SAFE_ID.fullmatch(str(value.get("admission_id", ""))) or any(value.get(key) != expected_value for key, expected_value in expected.items()):
        raise QualityFitError("quality admission does not bind the fixed boundary")
    return value


def _revalidate_current(plan_path: Path, plan: dict[str, Any], private: Path, hashes: dict[str, str]) -> None:
    """Repeat current source/template/model checks immediately before launch."""
    quality = _quality(hashes["quality_planner_sha256"])
    parser = _cpu_parser(hashes["quality_cpu_parser_sha256"])
    planner = _planner(hashes["planner_sha256"])
    try:
        parser.validate_plan(_safe(plan_path, private, "quality plan"), private_root=private)
        model_sha, model_bytes = planner._file_sha256(planner.MODEL_PATH, maximum=planner.MODEL_BYTES)
    except (getattr(parser, "QualityCpuError", ValueError), getattr(quality, "QualityPlanError", ValueError), getattr(planner, "LocalObservationError", ValueError)) as exc:
        raise QualityFitError("current quality inputs cannot be revalidated") from exc
    if model_sha != plan.get("base_model", {}).get("sha256") or model_bytes != plan.get("base_model", {}).get("bytes"):
        raise QualityFitError("quality base model changed")


def validate(plan_path: Path, cpu_receipt_path: Path, admission_path: Path, tokenizer_prepared_path: Path, tokenizer_load_path: Path, *, private_root: Path | None = None, main_private_root: Path | None = None) -> dict[str, Any]:
    hashes = _hashes()
    _quality(hashes["quality_planner_sha256"])
    private = Path(private_root or PRIVATE_ROOT).absolute(); main = Path(main_private_root or MAIN_PRIVATE_ROOT).absolute()
    if private != PRIVATE_ROOT.absolute() or main != MAIN_PRIVATE_ROOT.absolute():
        raise QualityFitError("public validation uses only fixed private roots")
    plan, raw = _plan(plan_path, private); policy, _ = _recipe(plan)
    launcher_sha = _sha(_bounded(_safe(QUALITY_CPU_LAUNCHER, main, "quality CPU launcher"), MAX_JSON_BYTES, "quality CPU launcher"))
    cpu_sha = _cpu(cpu_receipt_path, plan, _sha(raw), hashes, launcher_sha, main)
    prepared, prepared_sha = _prepared(tokenizer_prepared_path, private)
    load_sha = _load_receipt(tokenizer_load_path, private, prepared_sha, prepared["inventory_sha256"], prepared["copies"])
    admission = _admission(admission_path, private, plan["frozen_sha256"], cpu_sha, prepared, prepared_sha, load_sha, hashes, launcher_sha)
    _revalidate_current(plan_path, plan, private, hashes)
    copies = _current_copies(tokenizer_prepared_path, prepared, private)
    bindings = {"plan_file_sha256": _sha(raw), "plan_sha256": plan["frozen_sha256"], "cpu_receipt_sha256": cpu_sha, "tokenizer_prepared_receipt_sha256": prepared_sha, "tokenizer_load_receipt_sha256": load_sha, "tokenizer_inventory_sha256": prepared["inventory_sha256"], "quality_cpu_launcher_sha256": launcher_sha, "recipe_sha256": _sha(json.dumps(plan["recipe"], sort_keys=True, separators=(",", ":")).encode()), **hashes}
    return {"plan": plan, "policy": policy, "admission": admission, "tokenizer_copies": copies, "bindings": bindings, **hashes, "quality_cpu_launcher_sha256": launcher_sha, "input_paths": {"plan": str(Path(plan_path).absolute()), "cpu": str(Path(cpu_receipt_path).absolute()), "admission": str(Path(admission_path).absolute()), "prepared": str(Path(tokenizer_prepared_path).absolute()), "load": str(Path(tokenizer_load_path).absolute()), "private": str(private), "main": str(main)}}


def _fresh(private: Path, out: str, policy: runtime.RunPolicy) -> Path:
    if not SAFE_ID.fullmatch(out) or not out.startswith(policy.output_prefix):
        raise QualityFitError("quality output must be a safe fixed-private id")
    if not private.is_dir() or runtime.is_reparse(private) or (private / out).exists():
        raise QualityFitError("quality output must be fresh")
    return private / out


def _stage_current(stage: Path, data: Path, tokens: Path, plan: dict[str, Any], copies: list[dict[str, Any]]) -> None:
    files = plan["staging"]["files"]
    expected = {data / "g01.jpg": files["g01.jpg"], data / "g01.txt": files["g01.txt"], stage / "local-quality.toml": files["local-quality.toml"]}
    if {entry.name for entry in runtime.entries(data, 2, "quality run dataset")} != {"g01.jpg", "g01.txt"} or {entry.name for entry in runtime.entries(stage, 2, "quality run stage")} != {"dataset", "local-quality.toml"} or {entry.name for entry in runtime.entries(stage / "dataset", 1, "quality repeat root")} != {"1_figmentlocalg01probe"}:
        raise QualityFitError("quality run stage inventory is not exact")
    for path, record in expected.items():
        data_bytes = _bounded(_safe(path, stage, "quality run stage"), MAX_INPUT_BYTES, "quality run staged input")
        if len(data_bytes) != record["bytes"] or _sha(data_bytes) != record["sha256"]:
            raise QualityFitError("quality staged input changed before launch")
    if len(copies) != 10 or {entry.name for entry in runtime.entries(tokens, 2, "quality tokenizer root")} != set(TOKENIZER_DIRS.values()):
        raise QualityFitError("quality tokenizer inventory is incomplete")
    for record in copies:
        relative = _tokenizer_rel(record)
        data_bytes = _bounded(_safe(tokens / relative, tokens, "quality tokenizer asset"), MAX_TOKENIZER_FILE_BYTES, "quality tokenizer asset")
        if len(data_bytes) != record["bytes"] or _sha(data_bytes) != record["sha256"]:
            raise QualityFitError("quality tokenizer asset changed before launch")
    for directory in TOKENIZER_DIRS.values():
        if {entry.name for entry in runtime.entries(tokens / directory, 5, "quality tokenizer files")} != TOKENIZER_FILES:
            raise QualityFitError("quality tokenizer file inventory is not exact")


def _fresh_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    paths = evidence.get("input_paths", {})
    required = ("plan", "cpu", "admission", "prepared", "load", "private", "main")
    if not isinstance(paths, dict) or not all(isinstance(paths.get(key), str) for key in required):
        raise QualityFitError("execute requires validated source paths")
    return validate(Path(paths["plan"]), Path(paths["cpu"]), Path(paths["admission"]), Path(paths["prepared"]), Path(paths["load"]), private_root=Path(paths["private"]), main_private_root=Path(paths["main"]))


def execute(evidence: dict[str, Any], *, out: str) -> dict[str, Any]:
    evidence = _fresh_evidence(evidence); plan = evidence["plan"]; admission = evidence["admission"]; policy = evidence["policy"]
    private = Path(evidence["input_paths"]["private"]); root = _fresh(private, out, policy)
    markers = private / policy.marker_namespace
    if markers.exists(): _safe(markers, private, "quality dispatch markers")
    else: markers.mkdir(); _safe(markers, private, "quality dispatch markers")
    runtime.exclusive(markers / f"{admission['admission_id']}.json", json.dumps({"admission_id": admission["admission_id"], "plan_sha256": plan["frozen_sha256"]}, sort_keys=True).encode())
    root.mkdir(); stage = root / "stage"; data = stage / "dataset" / "1_figmentlocalg01probe"; output = root / "output"; logs = root / "logs"; tokens = root / "tokenizers"
    data.mkdir(parents=True); output.mkdir(); logs.mkdir(); tokens.mkdir()
    plan_root = Path(evidence["input_paths"]["plan"]).parent; files = plan["staging"]["files"]
    runtime.copy_checked(plan_root / plan["staging"]["dataset"] / "g01.jpg", data / "g01.jpg", files["g01.jpg"]["sha256"], MAX_INPUT_BYTES, "quality g01")
    runtime.copy_checked(plan_root / plan["staging"]["dataset"] / "g01.txt", data / "g01.txt", files["g01.txt"]["sha256"], MAX_INPUT_BYTES, "quality caption")
    runtime.copy_checked(plan_root / "local-quality.toml", stage / "local-quality.toml", files["local-quality.toml"]["sha256"], MAX_INPUT_BYTES, "quality template")
    token_root = Path(evidence["input_paths"]["prepared"]).parent
    for record in evidence["tokenizer_copies"]:
        relative = _tokenizer_rel(record); (tokens / relative).parent.mkdir(exist_ok=True)
        runtime.copy_checked(_safe(token_root / relative, token_root, "tokenizer asset"), tokens / relative, record["sha256"], MAX_TOKENIZER_FILE_BYTES, "quality tokenizer asset")
    evidence = _fresh_evidence(evidence)
    _stage_current(stage, data, tokens, evidence["plan"], evidence["tokenizer_copies"])
    planner = _planner(evidence["planner_sha256"]); output_name = evidence["plan"]["recipe"]["output_name"]
    mark = {"schema": RUN_SCHEMA, "not_promotable": True, "status": "dispatched", "plan_sha256": plan["frozen_sha256"], "admission_id": admission["admission_id"], "launcher_sha256": evidence["launcher_sha256"]}
    runtime.exclusive(root / "dispatch.json", (json.dumps(mark, sort_keys=True) + "\n").encode())
    command = [str(planner.VENV_PYTHON), "-X", "utf8", "-B", "-m", "sdxl_train_network", "--config_file", str(stage / "local-quality.toml"), "--pretrained_model_name_or_path", str(planner.MODEL_PATH), "--train_data_dir", str(stage / "dataset"), "--output_dir", str(output), "--output_name", output_name, "--logging_dir", str(logs), "--tokenizer_cache_dir", str(tokens)]
    runtime.exclusive(root / "journal.json", (json.dumps({**mark, "status": "started", "command_sha256": _sha(json.dumps(command, separators=(",", ":")).encode())}, sort_keys=True) + "\n").encode())
    started = time.monotonic(); owner = _ownership(evidence["ownership_sha256"])
    result = runtime.run_owned(command, cwd=planner.SD_SCRIPTS_ROOT, environment_map=runtime.environment(root, admission["gpu_device"]), root=root, logs=logs, output=output, policy=policy, ownership=owner, popen=subprocess.Popen, thread_factory=threading.Thread)
    artifacts = None; failure = result.failure
    if failure is None:
        try: artifacts = runtime.checkpoints(output, policy)
        except QualityFitError: failure = "output-invalid"
    record = {**mark, "inputs": evidence["bindings"], "status": "complete" if failure is None else "failed", "exit_code": result.exit_code, "duration_seconds": round(time.monotonic() - started, 3), "log_truncated": result.log_truncated, "log_summary": result.log_summary, "teardown": result.teardown, "failure": failure, "checkpoints": artifacts}
    runtime.exclusive(root / ("receipt.json" if failure is None else "failure.json"), (json.dumps(record, sort_keys=True) + "\n").encode())
    if failure:
        raise QualityFitError("quality fit failed: " + failure)
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path); parser.add_argument("--cpu-receipt", required=True, type=Path)
    parser.add_argument("--admission", required=True, type=Path); parser.add_argument("--tokenizer-prepared", required=True, type=Path); parser.add_argument("--tokenizer-load", required=True, type=Path)
    parser.add_argument("--execute", action="store_true"); parser.add_argument("--out")
    args = parser.parse_args(argv)
    try: evidence = validate(args.plan, args.cpu_receipt, args.admission, args.tokenizer_prepared, args.tokenizer_load)
    except QualityFitError as exc: print("local quality fit refused: " + str(exc), file=sys.stderr); return 2
    if not args.execute: print(json.dumps({"status": "validated-not-executed", "not_promotable": True, "plan_sha256": evidence["plan"]["frozen_sha256"]}, sort_keys=True)); return 0
    if not isinstance(args.out, str): print("local quality fit refused: --execute requires --out", file=sys.stderr); return 2
    try: print(json.dumps(execute(evidence, out=args.out), sort_keys=True)); return 0
    except QualityFitError as exc: print("local quality fit refused: " + str(exc), file=sys.stderr); return 2


if __name__ == "__main__":
    raise SystemExit(main())
