"""Fixed-root executor for separately admitted, two-image matched LoRA pairs.

The default command validates receipts and staged evidence only.  It never
starts ComfyUI unless ``--execute`` is supplied after a matching admission has
been written into the fixed Studio-private evidence root.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
STUDIO = HERE.parents[3]
STUDIO_PRIVATE = STUDIO / "_private"
MAIN_PRIVATE = STUDIO.parents[1]
C1_PATH = HERE / "local_lora_matched_inference.py"
OWNERSHIP_PATH = HERE.parent / "expand" / "local_comfy_input.py"
C1_SHA256 = "bca8be929852fe19eab724f878f8985e4b3f6146050e564af91d0c83e6570d6f"
OWNERSHIP_SHA256 = "2997ba3185aabfb146b13f38d18c854615a7190064d30f14037570398bea7bac"
SCHEMA = "figment/local-lora-matched-runtime@1"
ADMISSION_SCHEMA = "figment/local-lora-matched-admission@1"
QUALITY_PLAN_SCHEMA = "figment/local-one-source-quality-plan@1"
QUALITY_RUN_SCHEMA = "figment/local-quality-fit@1"
HEX = re.compile(r"[0-9a-f]{64}\Z")
SAFE_ID = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")
MAX_JSON = 256 * 1024
MAX_HEADER = 1024 * 1024
MAX_LORA = 256 * 1024 * 1024
MAX_STDERR = 64 * 1024
MAX_PNG = 8 * 1024 * 1024
MAX_OUTPUT_ENTRIES = 3
PAIR_SECONDS = 10 * 60
BASE_MODEL_NAME = "RealVisXL_V5.0_fp16.safetensors"
PRIOR = {"base": None, "current-20": "base", "current-50": "current-20", "current-final100": "current-50", "concise-50": "current-final100"}


class MatchedRuntimeError(RuntimeError):
    pass


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _hash(value: Any, label: str) -> str:
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise MatchedRuntimeError(f"{label} must be a SHA-256")
    return value


def _load(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise MatchedRuntimeError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _file_hash(path: Path, maximum: int | None = None, *, allow_empty: bool = False) -> tuple[str, int]:
    try:
        info = path.stat()
    except OSError as exc:
        raise MatchedRuntimeError("required evidence is unavailable") from exc
    if _reparse(path) or not stat.S_ISREG(path.lstat().st_mode) or info.st_size < 0 or (not allow_empty and info.st_size == 0) or (maximum is not None and info.st_size > maximum):
        raise MatchedRuntimeError("required evidence has an unsafe file shape")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        seen = 0
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            seen += len(block)
            if maximum is not None and seen > maximum:
                raise MatchedRuntimeError("required evidence exceeds its byte bound")
            digest.update(block)
    final = path.stat()
    if seen != info.st_size or final.st_size != info.st_size or final.st_mtime_ns != info.st_mtime_ns:
        raise MatchedRuntimeError("required evidence changed while being hashed")
    return digest.hexdigest(), info.st_size


def _reparse(path: Path) -> bool:
    try:
        record = path.lstat()
        return stat.S_ISLNK(record.st_mode) or bool(getattr(record, "st_file_attributes", 0) & 0x400) or bool(getattr(os.path, "isjunction", lambda _p: False)(path))
    except OSError as exc:
        raise MatchedRuntimeError("cannot inspect evidence path") from exc


def _safe_existing(path: Path, root: Path, label: str) -> Path:
    root = root.absolute()
    path = path.absolute()
    if not path.is_relative_to(root):
        raise MatchedRuntimeError(f"{label} escapes its fixed root")
    if not root.exists() or _reparse(root) or not stat.S_ISDIR(root.lstat().st_mode):
        raise MatchedRuntimeError(f"{label} fixed root is not a regular directory")
    cursor = path
    while True:
        if cursor.exists() and _reparse(cursor):
            raise MatchedRuntimeError(f"{label} is a reparse point")
        if cursor.parent == cursor:
            break
        cursor = cursor.parent
    if not path.exists():
        raise MatchedRuntimeError(f"{label} is absent")
    try:
        resolved_root = root.resolve(strict=True)
        resolved_path = path.resolve(strict=True)
    except OSError as exc:
        raise MatchedRuntimeError(f"{label} cannot be resolved") from exc
    if not resolved_path.is_relative_to(resolved_root) or os.path.normcase(str(resolved_path)) != os.path.normcase(str(path)):
        raise MatchedRuntimeError(f"{label} is not an exact fixed-root path")
    return path


def _json(path: Path, root: Path, label: str) -> tuple[dict[str, Any], bytes]:
    path = _safe_existing(path, root, label)
    before = path.stat()
    if not stat.S_ISREG(path.lstat().st_mode) or _reparse(path) or not 0 < before.st_size <= MAX_JSON:
        raise MatchedRuntimeError(f"{label} has an unsafe file shape")
    with path.open("rb") as handle:
        raw = handle.read(MAX_JSON + 1)
    after = path.stat()
    if len(raw) != before.st_size or len(raw) > MAX_JSON or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
        raise MatchedRuntimeError(f"{label} changed while read")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise MatchedRuntimeError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise MatchedRuntimeError(f"{label} is not an object")
    return value, raw


def _frozen(value: dict[str, Any], label: str) -> str:
    frozen = _hash(value.get("frozen_sha256"), f"{label} frozen hash")
    body = dict(value); body.pop("frozen_sha256", None)
    actual = _sha(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode())
    if actual != frozen:
        raise MatchedRuntimeError(f"{label} frozen hash is invalid")
    return frozen


def _fixed(stage: str, c1: Any) -> str:
    if stage not in c1.STAGES:
        raise MatchedRuntimeError("comparison stage is invalid")
    return stage


def _quality_paths(branch: str) -> tuple[Path, Path, Path]:
    if branch not in {"current", "concise"}:
        raise MatchedRuntimeError("quality branch is invalid")
    plan_root = STUDIO_PRIVATE / f"figment-local-quality-{branch}-plan-20260908-v1"
    producer = STUDIO_PRIVATE / f"figment-local-quality-fit-{branch}-20260908-v1"
    admission = STUDIO_PRIVATE / f"figment-local-quality-{branch}-fit-admission-20260908-v1.json"
    return plan_root / "local-quality-plan.json", producer / "receipt.json", admission


def _matched_admission_path(stage: str) -> Path:
    return STUDIO_PRIVATE / f"figment-local-lora-matched-{stage}-admission-20260908-v1" / "admission.json"


def _completed_pair(stage: str) -> tuple[str, dict[int, str]]:
    """Rehash the two finished PNGs named by one fixed prior receipt."""
    root = MAIN_PRIVATE / f"figment-local-lora-matched-{stage}-20260908-v1"
    receipt, raw = _json(root / "receipt.json", MAIN_PRIVATE, "prior pair receipt")
    receipt_sha = _sha(raw)
    rows = receipt.get("rows")
    if receipt.get("schema") != SCHEMA or receipt.get("status") != "complete" or receipt.get("stage") != stage or not isinstance(rows, list) or len(rows) != 2 or receipt.get("teardown", {}).get("verified_stopped") is not True:
        raise MatchedRuntimeError("prior pair receipt is invalid")
    expected: dict[int, str] = {}
    for row in rows:
        output = row.get("output") if isinstance(row, dict) else None
        seed = row.get("seed") if isinstance(row, dict) else None
        name = output.get("filename") if isinstance(output, dict) else None
        claimed = output.get("sha256") if isinstance(output, dict) else None
        if seed not in {481516234, 90210} or seed in expected or not isinstance(name, str) or name != Path(name).name or not name.endswith(".png") or not isinstance(claimed, str) or not HEX.fullmatch(claimed):
            raise MatchedRuntimeError("prior pair PNG bindings are invalid")
        png = _safe_existing(root / "output" / name, MAIN_PRIVATE, "prior pair PNG")
        actual, _size = _file_hash(png, MAX_PNG)
        if actual != claimed:
            raise MatchedRuntimeError("prior pair PNG bytes differ from receipt")
        expected[seed] = actual
    if set(expected) != {481516234, 90210}:
        raise MatchedRuntimeError("prior pair PNG bindings are invalid")
    return receipt_sha, expected


def _prior_reviews(stage: str, admission: dict[str, Any]) -> None:
    prior = PRIOR[stage]
    digests = admission.get("prior_pair_review_digests")
    if prior is None:
        if digests != []:
            raise MatchedRuntimeError("base stage cannot cite prior reviews")
        return
    root = MAIN_PRIVATE / f"figment-local-lora-matched-{prior}-20260908-v1"
    receipt_sha, expected = _completed_pair(prior)
    actual: list[str] = []
    for role in ("root", "independent"):
        review, review_raw = _json(root / f"review-{role}.json", MAIN_PRIVATE, "prior pair review")
        actual.append(_sha(review_raw))
        observations = review.get("observations")
        observation_keys = {"seed", "realism", "resemblance_to_g01", "pose", "apparent_adulthood", "apparent_age_fit", "clothing", "defects"}
        observation_bindings = {item.get("seed"): item for item in observations if isinstance(item, dict)} if isinstance(observations, list) else {}
        observations_valid = isinstance(observations, list) and len(observations) == 2 and len(observation_bindings) == 2 and set(observation_bindings) == set(expected) and all(set(item) == observation_keys and all(isinstance(item.get(key), str) and item[key].strip() for key in observation_keys - {"seed"}) for item in observation_bindings.values())
        if review.get("schema") != "figment/local-lora-matched-pair-review@1" or review.get("stage") != prior or review.get("reviewer_role") != role or not isinstance(review.get("reviewer_id"), str) or not review["reviewer_id"].strip() or review.get("receipt_sha256") != receipt_sha or review.get("disposition") != "continue" or review.get("not_promotable") is not True or review.get("human_qa") is not False or not observations_valid:
            raise MatchedRuntimeError("prior pair review is invalid")
        review_rows = review.get("rows")
        review_bindings = {row.get("seed"): row.get("output_sha256") for row in review_rows if isinstance(row, dict)} if isinstance(review_rows, list) else {}
        if not isinstance(review_rows, list) or len(review_rows) != 2 or review_bindings != expected:
            raise MatchedRuntimeError("prior pair review PNG bindings are invalid")
    if digests != actual:
        raise MatchedRuntimeError("matched admission prior review digests are invalid")


def _quality_plan(path: Path, branch: str) -> tuple[dict[str, Any], str, str]:
    plan, raw = _json(path, STUDIO_PRIVATE, "quality plan")
    canonical = _frozen(plan, "quality plan")
    if plan.get("schema") != QUALITY_PLAN_SCHEMA or plan.get("branch") != branch or plan.get("not_promotable") is not True:
        raise MatchedRuntimeError("quality plan identity is invalid")
    execution = plan.get("execution")
    recipe = plan.get("recipe")
    if not isinstance(execution, dict) or not isinstance(recipe, dict) or execution != {"checkpoint_acceptance_allowed": False, "cpu_preflight_allowed": True, "gpu_quality_allowed": False, "sample_export_allowed": False}:
        raise MatchedRuntimeError("quality plan execution boundary is invalid")
    output = recipe.get("output_name")
    names = [f"{output}-step{step:08d}.safetensors" for step in range(10, 101, 10)] + [f"{output}.safetensors"]
    if not isinstance(output, str) or recipe.get("max_train_steps") != 100 or recipe.get("save_every_n_steps") != 10 or recipe.get("save_state") is not False or recipe.get("samples") != 0 or recipe.get("exports") != 0 or recipe.get("checkpoint_names") != names or recipe.get("checkpoint_steps") != [*range(10, 101, 10), 100]:
        raise MatchedRuntimeError("quality plan does not bind the 100-step eleven-file recipe")
    source = plan.get("source")
    if not isinstance(source, dict) or source.get("sha256") != "e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed":
        raise MatchedRuntimeError("quality plan source binding is invalid")
    return plan, _sha(raw), canonical


def _checkpoint_header(path: Path, expected_steps: str, expected_base: str, *, root: Path | None = None) -> dict[str, Any]:
    path = _safe_existing(path, STUDIO_PRIVATE if root is None else root, "selected checkpoint")
    digest, size = _file_hash(path, MAX_LORA)
    with path.open("rb") as handle:
        prefix = handle.read(8)
        if len(prefix) != 8:
            raise MatchedRuntimeError("selected checkpoint has no safetensors header")
        header_size = int.from_bytes(prefix, "little")
        if not 2 <= header_size <= MAX_HEADER or 8 + header_size >= size:
            raise MatchedRuntimeError("selected checkpoint header exceeds bounds")
        header_raw = handle.read(header_size)
    try:
        header = json.loads(header_raw)
    except json.JSONDecodeError as exc:
        raise MatchedRuntimeError("selected checkpoint header is invalid") from exc
    if not isinstance(header, dict) or not isinstance(header.get("__metadata__"), dict):
        raise MatchedRuntimeError("selected checkpoint metadata is invalid")
    metadata = header["__metadata__"]
    if metadata.get("ss_steps") != expected_steps or metadata.get("ss_network_module") != "networks.lora" or metadata.get("ss_new_sd_model_hash") != expected_base:
        raise MatchedRuntimeError("selected checkpoint metadata does not bind the slot")
    ranges: list[tuple[int, int]] = []
    keys = 0
    for name, tensor in header.items():
        if name == "__metadata__":
            continue
        dtype_bytes = {"BOOL": 1, "U8": 1, "I8": 1, "U16": 2, "I16": 2, "U32": 4, "I32": 4, "U64": 8, "I64": 8, "F16": 2, "BF16": 2, "F32": 4, "F64": 8, "F8_E4M3FN": 1, "F8_E5M2": 1}
        if not isinstance(name, str) or not isinstance(tensor, dict) or tensor.get("dtype") not in dtype_bytes or not isinstance(tensor.get("shape"), list) or any(not isinstance(d, int) or d < 0 for d in tensor["shape"]):
            raise MatchedRuntimeError("selected checkpoint tensor declaration is invalid")
        offsets = tensor.get("data_offsets")
        if not isinstance(offsets, list) or len(offsets) != 2 or not all(isinstance(value, int) for value in offsets) or offsets[0] < 0 or offsets[1] <= offsets[0] or 8 + header_size + offsets[1] > size:
            raise MatchedRuntimeError("selected checkpoint tensor span is invalid")
        elements = 1
        for dimension in tensor["shape"]: elements *= dimension
        if offsets[1] - offsets[0] != elements * dtype_bytes[tensor["dtype"]]:
            raise MatchedRuntimeError("selected checkpoint tensor byte span is invalid")
        ranges.append((offsets[0], offsets[1]))
        if name.startswith("lora_unet_"):
            keys += 1
    if keys == 0:
        raise MatchedRuntimeError("selected checkpoint has no U-Net LoRA tensors")
    previous = 0
    for start, end in sorted(ranges):
        if start != previous:
            raise MatchedRuntimeError("selected checkpoint tensor payload is not contiguous")
        previous = end
    if previous != size - 8 - header_size:
        raise MatchedRuntimeError("selected checkpoint tensor payload is incomplete")
    final_digest, final_size = _file_hash(path, MAX_LORA)
    if final_digest != digest or final_size != size:
        raise MatchedRuntimeError("selected checkpoint changed while header was checked")
    return {"filename": path.name, "bytes": size, "sha256": digest, "header_sha256": _sha(header_raw), "ss_steps": expected_steps, "unet_tensor_keys": keys}


def _producer(plan: dict[str, Any], plan_raw: str, plan_sha: str, receipt_path: Path, producer_admission: Path, stage: str, c1: Any) -> tuple[str, str, dict[str, Any] | None]:
    receipt, raw = _json(receipt_path, STUDIO_PRIVATE, "quality producer receipt")
    receipt_sha = _sha(raw)
    producer, producer_raw = _json(producer_admission, STUDIO_PRIVATE, "quality producer admission")
    producer_sha = _sha(producer_raw)
    _frozen(producer, "quality producer admission")
    teardown = receipt.get("teardown")
    if receipt.get("schema") != QUALITY_RUN_SCHEMA or receipt.get("status") != "complete" or receipt.get("not_promotable") is not True or receipt.get("failure") is not None or receipt.get("exit_code") != 0 or receipt.get("log_truncated") is not False or not isinstance(teardown, dict) or teardown.get("verified_stopped") is not True:
        raise MatchedRuntimeError("quality producer receipt is incomplete")
    inputs = receipt.get("inputs")
    if not isinstance(inputs, dict) or inputs.get("plan_file_sha256") != plan_raw or inputs.get("plan_sha256") != plan_sha or not isinstance(inputs.get("cpu_receipt_sha256"), str) or not HEX.fullmatch(inputs["cpu_receipt_sha256"]):
        raise MatchedRuntimeError("quality producer receipt bindings are invalid")
    if producer.get("schema") != "figment/local-quality-fit-admission@1" or producer.get("plan_sha256") != plan_sha or producer.get("cpu_receipt_sha256") != inputs["cpu_receipt_sha256"] or producer.get("allow_gpu_quality") is not True or producer.get("max_train_steps") != 100 or producer.get("not_promotable") is not True:
        raise MatchedRuntimeError("quality producer admission bindings are invalid")
    if stage == "base":
        return receipt_sha, producer_sha, None
    slot = c1.SLOTS[stage]
    records = receipt.get("checkpoints")
    if not isinstance(records, list) or len(records) != 11:
        raise MatchedRuntimeError("quality producer checkpoint inventory is invalid")
    names = plan["recipe"]["checkpoint_names"]
    if [record.get("path") for record in records if isinstance(record, dict)] != names:
        raise MatchedRuntimeError("quality producer checkpoint names are invalid")
    selected = next((record for record in records if isinstance(record, dict) and record.get("path") == slot["filename"]), None)
    if not isinstance(selected, dict) or selected.get("ss_steps") != int(slot["steps"]) or not isinstance(selected.get("sha256"), str) or not HEX.fullmatch(selected["sha256"]):
        raise MatchedRuntimeError("quality producer selected checkpoint is invalid")
    root = receipt_path.parent / "output"
    actual = _checkpoint_header(root / slot["filename"], slot["steps"], plan["base_model"]["sha256"])
    if actual["sha256"] != selected["sha256"] or actual["bytes"] != selected.get("bytes"):
        raise MatchedRuntimeError("selected checkpoint differs from producer receipt")
    return receipt_sha, producer_sha, actual


def _load_bound_modules() -> tuple[Any, Any, dict[str, str]]:
    c1_hash, _ = _file_hash(C1_PATH, 256 * 1024)
    ownership_hash, _ = _file_hash(OWNERSHIP_PATH, 1024 * 1024)
    if c1_hash != C1_SHA256 or ownership_hash != OWNERSHIP_SHA256:
        raise MatchedRuntimeError("accepted graph or ownership helper changed")
    c1 = _load("figment_matched_c1", C1_PATH)
    helper = _load("figment_matched_ownership", OWNERSHIP_PATH)
    if helper.COMFY_COMMIT != "95d755cd8107a72258d452b5d3657273d571f07d" or helper.PORT != 8190 or helper.WIDTH != c1.SAMPLER["width"] or helper.HEIGHT != c1.SAMPLER["height"]:
        raise MatchedRuntimeError("installed Comfy helper is not the pinned matched runtime")
    try:
        if helper.git_head(helper.COMFY_ROOT) != helper.COMFY_COMMIT or not helper.git_clean(helper.COMFY_ROOT):
            raise MatchedRuntimeError("installed Comfy checkout is not the pinned clean revision")
        base = helper.MODELS["checkpoint"]
        if base.get("filename") != BASE_MODEL_NAME:
            raise MatchedRuntimeError("installed base checkpoint name is not pinned")
        base_record = helper.checked_file(base["path"], base["sha256"])
        helper.safe_existing(helper.COMFY_PYTHON)
        if not helper.COMFY_PYTHON.is_file():
            raise MatchedRuntimeError("installed Comfy interpreter is unavailable")
    except MatchedRuntimeError:
        raise
    except Exception as exc:
        raise MatchedRuntimeError("installed Comfy or base checkpoint pin cannot be verified") from exc
    nodes_hash, _ = _file_hash(helper.COMFY_ROOT / "nodes.py", 4 * 1024 * 1024)
    sd_hash, _ = _file_hash(helper.COMFY_ROOT / "comfy" / "sd.py", 4 * 1024 * 1024)
    return c1, helper, {"c1_sha256": c1_hash, "ownership_sha256": ownership_hash, "comfy_nodes_sha256": nodes_hash, "comfy_sd_sha256": sd_hash, "comfy_commit": helper.COMFY_COMMIT, "comfy_base_model_sha256": base_record["sha256"]}


def validate(stage: str) -> dict[str, Any]:
    c1, _helper, code = _load_bound_modules(); stage = _fixed(stage, c1)
    branch = "current" if stage == "base" or stage.startswith("current-") else "concise"
    plan_path, receipt_path, producer_admission = _quality_paths(branch)
    plan, plan_raw, plan_sha = _quality_plan(plan_path, branch)
    receipt_sha, producer_sha, checkpoint = _producer(plan, plan_raw, plan_sha, receipt_path, producer_admission, stage, c1)
    admission, admission_raw = _json(_matched_admission_path(stage), STUDIO_PRIVATE, "matched admission")
    runtime_hash, _ = _file_hash(Path(__file__), 512 * 1024)
    base_receipt_sha, base_pngs = (None, None) if stage == "base" else _completed_pair("base")
    expected = {"stage": stage, "c1_sha256": code["c1_sha256"], "runtime_sha256": runtime_hash, **code, "plan_file_sha256": plan_raw, "plan_sha256": plan_sha, "producer_receipt_sha256": receipt_sha, "producer_admission_sha256": producer_sha, "checkpoint_sha256": None if checkpoint is None else checkpoint["sha256"], "base_receipt_sha256": base_receipt_sha, "base_png_sha256_by_seed": None if base_pngs is None else {str(seed): digest for seed, digest in sorted(base_pngs.items())}, "allow_local_execute": True, "not_promotable": True}
    if admission.get("schema") != ADMISSION_SCHEMA or not SAFE_ID.fullmatch(str(admission.get("admission_id", ""))) or any(admission.get(key) != value for key, value in expected.items()):
        raise MatchedRuntimeError("matched admission does not bind this exact stage")
    _frozen(admission, "matched admission")
    _prior_reviews(stage, admission)
    rows = [row for row in c1.build_manifest(plan_sha, concise_plan_sha256=plan_sha)["rows"] if row["stage"] == stage]
    if len(rows) != 2 or {row["seed"] for row in rows} != set(c1.SEEDS):
        raise MatchedRuntimeError("matched C1 pair is not exact")
    return {"stage": stage, "plan": plan, "plan_file_sha256": plan_raw, "plan_sha256": plan_sha, "admission": admission, "matched_admission_sha256": _sha(admission_raw), "matched_admission_id": admission["admission_id"], "runtime_sha256": runtime_hash, "checkpoint": checkpoint, "rows": rows, "code": code, "producer_receipt_sha256": receipt_sha, "producer_admission_sha256": producer_sha, "base_receipt_sha256": base_receipt_sha, "base_png_sha256_by_seed": base_pngs}


class _Pumper:
    def __init__(self, stream: Any, path: Path):
        self.stream, self.path, self.error, self.truncated, self.started = stream, path, None, False, False
        self.thread = threading.Thread(target=self._run, daemon=True)
    def _run(self) -> None:
        kept = 0
        try:
            with self.path.open("ab") as handle:
                while True:
                    block = self.stream.read(4096)
                    if not block: break
                    if kept + len(block) > MAX_STDERR:
                        self.truncated = True; return
                    handle.write(block); handle.flush(); kept += len(block)
        except BaseException as exc:
            self.error = exc
    def start(self) -> None:
        self.thread.start(); self.started = True
    def finish(self) -> None:
        if not self.started:
            return
        self.thread.join(timeout=3)
        if self.thread.is_alive() or self.error is not None or self.truncated:
            raise MatchedRuntimeError("Comfy stderr journal is incomplete")


def _entries(path: Path, maximum: int, root: Path, label: str) -> dict[str, Path]:
    path = _safe_existing(path, root, label)
    if _reparse(path) or not stat.S_ISDIR(path.lstat().st_mode):
        raise MatchedRuntimeError(f"{label} is not a regular directory")
    result: dict[str, Path] = {}
    try:
        with os.scandir(path) as scan:
            for entry in scan:
                if len(result) >= maximum:
                    raise MatchedRuntimeError(f"{label} exceeds its entry bound")
                candidate = Path(entry.path)
                if entry.name in result or _reparse(candidate):
                    raise MatchedRuntimeError(f"{label} has an unsafe entry")
                result[entry.name] = candidate
    except OSError as exc:
        raise MatchedRuntimeError(f"cannot enumerate {label}") from exc
    return result


def _runtime_output_bound(output: Path, staged: Path | None) -> None:
    entries = _entries(output, MAX_OUTPUT_ENTRIES, MAIN_PRIVATE, "matched output")
    loras = entries.get("loras")
    if loras is None or _reparse(loras) or not stat.S_ISDIR(loras.lstat().st_mode):
        raise MatchedRuntimeError("matched output has no regular LoRA directory")
    lora_entries = _entries(loras, 1, MAIN_PRIVATE, "matched LoRA output")
    if set(lora_entries) != (set() if staged is None else {staged.name}):
        raise MatchedRuntimeError("matched LoRA inventory is not exact")
    for name, candidate in entries.items():
        if name == "loras":
            continue
        if not name.endswith(".png") or _reparse(candidate) or not stat.S_ISREG(candidate.lstat().st_mode):
            raise MatchedRuntimeError("matched output contains an unsafe file")
        if candidate.stat().st_size > MAX_PNG:
            raise MatchedRuntimeError("matched output PNG exceeds its byte bound")


def _exact_output_inventory(output: Path, results: list[dict[str, Any]], staged: Path | None) -> None:
    expected_pngs = {entry["output"]["filename"] for entry in results}
    _runtime_output_bound(output, staged)
    entries = _entries(output, MAX_OUTPUT_ENTRIES, MAIN_PRIVATE, "matched output")
    if len(expected_pngs) != len(results) or set(entries) != expected_pngs | {"loras"}:
        raise MatchedRuntimeError("matched output inventory is not exact")
    for row in results:
        output_record = row["output"]
        name = output_record.get("filename")
        if not isinstance(name, str) or name not in expected_pngs:
            raise MatchedRuntimeError("matched output filename is invalid")
        actual, size = _file_hash(entries[name], MAX_PNG)
        if actual != output_record.get("sha256") or size != output_record.get("bytes"):
            raise MatchedRuntimeError("matched output bytes differ from receipt row")


def _journal_lora_application(pumper: _Pumper, checkpoint: dict[str, Any] | None) -> dict[str, int]:
    pumper.finish()
    raw = _read_bounded(pumper.path, MAX_STDERR, "Comfy stderr journal", allow_empty=True)
    text = raw.decode("utf-8", errors="replace")
    missing = text.count("lora key not loaded:") + text.count("NOT LOADED")
    if checkpoint is not None and missing:
        raise MatchedRuntimeError("Comfy reported unmatched LoRA keys")
    return {"header_unet_keys": 0 if checkpoint is None else checkpoint["unet_tensor_keys"], "comfy_missing_lora_key_warnings": missing}


def _record(root: Path, name: str, value: dict[str, Any]) -> None:
    data = (json.dumps(value, sort_keys=True) + "\n").encode()
    with (root / name).open("xb") as handle:
        handle.write(data); handle.flush(); os.fsync(handle.fileno())


def _receipt_inputs(evidence: dict[str, Any]) -> dict[str, Any]:
    base_pngs = evidence["base_png_sha256_by_seed"]
    return {"plan_file_sha256": evidence["plan_file_sha256"], "plan_sha256": evidence["plan_sha256"], "runtime_sha256": evidence["runtime_sha256"], "matched_admission_sha256": evidence["matched_admission_sha256"], "matched_admission_id": evidence["matched_admission_id"], "producer_receipt_sha256": evidence["producer_receipt_sha256"], "producer_admission_sha256": evidence["producer_admission_sha256"], "base_receipt_sha256": evidence["base_receipt_sha256"], "base_png_sha256_by_seed": None if base_pngs is None else {str(seed): digest for seed, digest in sorted(base_pngs.items())}, "checkpoint": evidence["checkpoint"], **evidence["code"]}


def _read_bounded(path: Path, maximum: int, label: str, *, allow_empty: bool = False) -> bytes:
    path = _safe_existing(path, MAIN_PRIVATE, label)
    before = path.stat()
    if _reparse(path) or not stat.S_ISREG(path.lstat().st_mode) or (not allow_empty and before.st_size == 0) or before.st_size > maximum:
        raise MatchedRuntimeError(f"{label} has an unsafe file shape")
    with path.open("rb") as handle:
        raw = handle.read(maximum + 1)
    after = path.stat()
    if len(raw) != before.st_size or len(raw) > maximum or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
        raise MatchedRuntimeError(f"{label} changed while read")
    return raw


def _copy_stream(source: Path, target: Path, expected: str) -> None:
    source = _safe_existing(source, STUDIO_PRIVATE, "selected checkpoint")
    before = source.stat()
    if before.st_size > MAX_LORA or _reparse(target.parent): raise MatchedRuntimeError("adapter copy boundary is unsafe")
    digest = hashlib.sha256(); total = 0
    with source.open("rb") as src, target.open("xb") as dst:
        while True:
            block = src.read(1024 * 1024)
            if not block: break
            total += len(block)
            if total > MAX_LORA: raise MatchedRuntimeError("adapter copy exceeds bound")
            digest.update(block); dst.write(block)
        dst.flush(); os.fsync(dst.fileno())
    after = source.stat()
    if total != before.st_size or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns or digest.hexdigest() != expected or _file_hash(target, MAX_LORA)[0] != expected:
        raise MatchedRuntimeError("adapter changed while copied")


def execute(evidence: dict[str, Any]) -> dict[str, Any]:
    """Run exactly two sequential prompts after revalidating fixed evidence."""
    stage = evidence.get("stage")
    if not isinstance(stage, str):
        raise MatchedRuntimeError("execute requires validated stage")
    evidence = validate(stage)
    _c1, helper, _code = _load_bound_modules()
    root = MAIN_PRIVATE / f"figment-local-lora-matched-{stage}-20260908-v1"
    if root.exists() or root.parent != MAIN_PRIVATE or not MAIN_PRIVATE.is_dir():
        raise MatchedRuntimeError("matched output root must be fresh and fixed")
    root.mkdir()
    output = root / "output"
    loras = output / "loras"
    temp = root / "temp"
    user = root / "user"
    home = root / "home"
    for path in (output, loras, temp, user, home): path.mkdir()
    stderr_path = root / "stderr.log"
    stderr_path.open("xb").close()
    checkpoint = evidence["checkpoint"]
    staged = None
    process = wrapper = None
    tracked: dict[int, Any] = {}
    pumper: _Pumper | None = None
    teardown: dict[str, Any] = {"verified_stopped": False}
    results: list[dict[str, Any]] = []
    application: dict[str, int] | None = None
    deadline = time.monotonic() + PAIR_SECONDS
    failure: BaseException | None = None
    secondary_failures: list[str] = []
    try:
        if checkpoint is not None:
            source = _quality_paths("current" if stage.startswith("current-") else "concise")[1].parent / "output" / checkpoint["filename"]
            staged = loras / checkpoint["filename"]
            _copy_stream(source, staged, checkpoint["sha256"])
            copied = _checkpoint_header(staged, checkpoint["ss_steps"], evidence["plan"]["base_model"]["sha256"], root=MAIN_PRIVATE)
            if copied["sha256"] != checkpoint["sha256"]:
                raise MatchedRuntimeError("staged adapter hash changed")
        _runtime_output_bound(output, staged)
        if time.monotonic() >= deadline:
            raise MatchedRuntimeError("matched run exceeded its one deadline before launch")
        helper._port_available()
        command = [str(helper.COMFY_PYTHON), "-X", "utf8", "main.py", "--listen", "127.0.0.1", "--port", str(helper.PORT), "--output-directory", str(output), "--temp-directory", str(temp), "--user-directory", str(user), "--disable-api-nodes", "--disable-all-custom-nodes", "--disable-auto-launch"]
        process = subprocess.Popen(command, cwd=helper.COMFY_ROOT, shell=False, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=helper._isolated_environment(root), creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        pumper = _Pumper(process.stderr, stderr_path)
        pumper.start()
        wrapper = helper._process_identity(process.pid)
        if wrapper is None:
            raise MatchedRuntimeError("cannot identify owned Comfy wrapper")
        tracked = helper._wait_for_owned_listener(wrapper, deadline, {wrapper.pid: wrapper})
        opener = helper._loopback_opener()
        for row in evidence["rows"]:
            if time.monotonic() >= deadline:
                raise MatchedRuntimeError("matched run exceeded its one deadline")
            _runtime_output_bound(output, staged)
            marker = root / f"dispatch-{row['seed']}.json"
            with marker.open("xb") as handle:
                handle.write(json.dumps({"stage": stage, "row_id": row["id"], "graph_sha256": _sha(json.dumps(row["graph"], sort_keys=True, separators=(",", ":")).encode())}, sort_keys=True).encode())
            tracked = helper._require_owned_listener(wrapper, tracked)
            queued = helper._local_json(opener, "POST", "/prompt", {"prompt": row["graph"], "client_id": uuid.uuid4().hex})
            prompt_id = queued.get("prompt_id")
            if not isinstance(prompt_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", prompt_id): raise MatchedRuntimeError("local prompt id is invalid")
            completed = None
            while time.monotonic() < deadline:
                if pumper.error is not None or pumper.truncated:
                    raise MatchedRuntimeError("Comfy stderr journal failed while polling")
                _runtime_output_bound(output, staged)
                tracked = helper._require_owned_listener(wrapper, tracked)
                completed = helper._completed_output(helper._local_json(opener, "GET", f"/history/{prompt_id}"), prompt_id, output)
                if completed is not None: break
                time.sleep(0.5)
            if completed is None: raise MatchedRuntimeError("matched prompt did not complete")
            results.append({"row_id": row["id"], "seed": row["seed"], "prompt_id": prompt_id, "output": completed})
        if len(results) != 2 or len({entry["output"]["sha256"] for entry in results}) != 2:
            raise MatchedRuntimeError("matched pair output inventory is invalid")
    except BaseException as exc:
        failure = exc
    finally:
        try:
            if wrapper is not None:
                teardown = helper._teardown(wrapper, tracked, process)
            elif process is not None:
                try:
                    process.terminate(); process.wait(timeout=5)
                    teardown = {"verified_stopped": False, "retained_wrapper_cleanup": "terminated-without-identity"}
                except BaseException as cleanup_error:
                    teardown = {"verified_stopped": False, "retained_wrapper_cleanup": type(cleanup_error).__name__}
        except BaseException as exc:
            teardown = {"verified_stopped": False, "teardown_error_class": type(exc).__name__}
            if failure is None:
                failure = exc
            else:
                secondary_failures.append(type(exc).__name__)
        try:
            if pumper is not None:
                application = _journal_lora_application(pumper, checkpoint)
        except BaseException as exc:
            if failure is None:
                failure = exc
            else:
                secondary_failures.append(type(exc).__name__)
    if failure is None:
        try:
            if teardown.get("verified_stopped") is not True:
                raise MatchedRuntimeError("owned Comfy teardown was not verified")
            _exact_output_inventory(output, results, staged)
        except BaseException as exc:
            failure = exc
    if failure is not None:
        try:
            stderr_raw = _read_bounded(stderr_path, MAX_STDERR, "Comfy stderr journal", allow_empty=True)
            stderr_sha = _sha(stderr_raw)
        except BaseException as exc:
            stderr_sha = None
            secondary_failures.append(type(exc).__name__)
        _record(root, "failure.json", {"schema": SCHEMA, "status": "failed", "not_promotable": True, "stage": stage, "inputs": _receipt_inputs(evidence), "failure_class": type(failure).__name__, "failure_message": str(failure)[:256], "teardown": teardown, "rows": results, "stderr_sha256": stderr_sha, "stderr_complete": pumper is None or (pumper.started and pumper.error is None and not pumper.truncated and not pumper.thread.is_alive()), "secondary_failure_classes": secondary_failures})
        raise failure
    record = {"schema": SCHEMA, "status": "complete", "not_promotable": True, "stage": stage, "inputs": _receipt_inputs(evidence), "rows": results, "lora_application": application, "teardown": teardown, "stderr_sha256": _file_hash(stderr_path, MAX_STDERR, allow_empty=True)[0], "deadline_seconds": PAIR_SECONDS}
    _record(root, "receipt.json", record)
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--stage", required=True); parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    try:
        evidence = validate(args.stage)
        if not args.execute:
            print(json.dumps({"status": "validated-not-executed", "stage": evidence["stage"], "not_promotable": True}, sort_keys=True)); return 0
        print(json.dumps(execute(evidence), sort_keys=True)); return 0
    except MatchedRuntimeError as exc:
        print("matched local inference refused: " + str(exc), file=sys.stderr); return 2


if __name__ == "__main__":
    raise SystemExit(main())
