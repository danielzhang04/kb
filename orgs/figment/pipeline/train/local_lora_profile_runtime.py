"""Fixed-root controller for the one-off profile-base/current-20 comparison."""
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

from PIL import Image


HERE = Path(__file__).resolve().parent
STUDIO = HERE.parents[3]
STUDIO_PRIVATE = STUDIO / "_private"
MAIN_PRIVATE = STUDIO.parents[1]
PLANNER_PATH = HERE / "local_lora_profile_inference.py"
ENGINE_PATH = HERE / "local_lora_pair_engine.py"
HELPER_PATH = HERE.parent / "expand" / "local_comfy_input.py"
C1_PATH = HERE / "local_lora_matched_inference.py"
PLANNER_SHA256 = "eb46eba3c8f99379622bcf786fc9950eb3156623bdf9d9d5d8dc80588de891f2"
ENGINE_SHA256 = "26e1745885c6bea9d0e934c00953dcc3d5869fde1e56f3ee6a87b5e10c6819a9"
HELPER_SHA256 = "2997ba3185aabfb146b13f38d18c854615a7190064d30f14037570398bea7bac"
C1_SHA256 = "bca8be929852fe19eab724f878f8985e4b3f6146050e564af91d0c83e6570d6f"
SCHEMA = "figment/local-lora-profile-runtime@1"
ADMISSION_SCHEMA = "figment/local-lora-profile-admission@1"
REVIEW_SCHEMA = "figment/local-lora-profile-pair-review@1"
HEX = re.compile(r"[0-9a-f]{64}\Z")
MAX_JSON = 256 * 1024
MAX_HEADER = 1024 * 1024
MAX_LORA = 256 * 1024 * 1024
MAX_STDERR = 64 * 1024
MAX_PNG = 8 * 1024 * 1024
MAX_OUTPUT_ENTRIES = 3
PAIR_SECONDS = 10 * 60
SEEDS = (481516234, 90210)
STAGES = ("profile-base", "profile-current-20")
PROFILE_PREFIX = "figment-local-lora-profile"
PROFILE_SUFFIX = "20260908-v1"
PNG_NAMES = {481516234: "figment-local-lora-matched_00001_.png", 90210: "figment-local-lora-matched_00002_.png"}
BASE_MODEL_NAME = "RealVisXL_V5.0_fp16.safetensors"
HISTORICAL = {
    "base": {"receipt": "d12cdd5c99cc9666a919632712b3a5556147c509325b29295ad048f92bbd1b7a", "reviews": {"root": "e42edff6f1148a9710221ab06fc0ba582044c8e69c2165adcc2e984119cd293e", "independent": "188d10470dca6f1de71df3e2e8fe4319720207ce63f7775aee5ac8f2c8444d98"}},
    "current-20": {"receipt": "a6140543aff6fbf02bd294fa187b76aa477b593f34108bf6600d47f190746ffb", "reviews": {"root": "56d6fa6fba66eacf710c4306e071aeb0b9d78ee3dfc3b71959114ad3c7c0c5d9", "independent": "299cfb4ca019c08ebe30d3a5eb2eedbb987f3026399da0195310a6fcaad215e4"}},
}
CHECKPOINT = {"filename": "figmentlocalg01quality-current-100-step00000020.safetensors", "sha256": "fc3222248dd317270f975f34828f5376751114584d443eebeae0112deb3e473f", "header_sha256": "334341d2b46823ddb21f5da99b42797d785975c5e547bf22c7a9fff00efa74dc", "bytes": 170540948, "ss_steps": "20", "unet_tensor_keys": 2166}


class ProfileRuntimeError(RuntimeError):
    pass


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _slug(stage: str) -> str:
    if stage not in STAGES: raise ProfileRuntimeError("profile stage is invalid")
    return stage.removeprefix("profile-")


def _admission_id(stage: str) -> str:
    return f"{PROFILE_PREFIX}-{_slug(stage)}-{PROFILE_SUFFIX}"


def _admission_path(stage: str) -> Path:
    return STUDIO_PRIVATE / f"{PROFILE_PREFIX}-{_slug(stage)}-admission-{PROFILE_SUFFIX}" / "admission.json"


def _profile_root(stage: str) -> Path:
    return MAIN_PRIVATE / f"{PROFILE_PREFIX}-{_slug(stage)}-{PROFILE_SUFFIX}"


def _check_code(code: dict[str, Any], admitted: dict[str, Any]) -> None:
    if not isinstance(code, dict) or not isinstance(admitted, dict) or "controller_sha256" not in admitted or _canonical(code) != _canonical(admitted):
        raise ProfileRuntimeError("reviewed profile source differs from admitted evidence")


def _load(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ProfileRuntimeError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module; spec.loader.exec_module(module)
    return module


def _reparse(path: Path) -> bool:
    try:
        record = path.lstat()
        return stat.S_ISLNK(record.st_mode) or bool(getattr(record, "st_file_attributes", 0) & 0x400) or bool(getattr(os.path, "isjunction", lambda _p: False)(path))
    except OSError as exc:
        raise ProfileRuntimeError("cannot inspect evidence path") from exc


def _safe(path: Path, root: Path, label: str) -> Path:
    root, path = root.absolute(), path.absolute()
    if not path.is_relative_to(root) or not root.is_dir() or _reparse(root):
        raise ProfileRuntimeError(f"{label} escapes its fixed root")
    cursor = path
    while cursor.parent != cursor:
        if cursor.exists() and _reparse(cursor):
            raise ProfileRuntimeError(f"{label} is a reparse point")
        cursor = cursor.parent
    if not path.exists():
        raise ProfileRuntimeError(f"{label} is absent")
    try:
        resolved_root, resolved = root.resolve(strict=True), path.resolve(strict=True)
    except OSError as exc:
        raise ProfileRuntimeError(f"{label} cannot be resolved") from exc
    if not resolved.is_relative_to(resolved_root) or os.path.normcase(str(resolved)) != os.path.normcase(str(path)):
        raise ProfileRuntimeError(f"{label} is not an exact fixed-root path")
    return path


def _hash_file(path: Path, maximum: int | None = None, *, allow_empty: bool = False) -> tuple[str, int]:
    before = path.stat()
    if _reparse(path) or not stat.S_ISREG(path.lstat().st_mode) or (not allow_empty and before.st_size == 0) or (maximum is not None and before.st_size > maximum):
        raise ProfileRuntimeError("required evidence has an unsafe file shape")
    digest = hashlib.sha256(); seen = 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            seen += len(block)
            if maximum is not None and seen > maximum: raise ProfileRuntimeError("required evidence exceeds its byte bound")
            digest.update(block)
    after = path.stat()
    if seen != before.st_size or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
        raise ProfileRuntimeError("required evidence changed while hashed")
    return digest.hexdigest(), seen


def _json(path: Path, root: Path, label: str) -> tuple[dict[str, Any], bytes]:
    path = _safe(path, root, label); before = path.stat()
    if not stat.S_ISREG(path.lstat().st_mode) or not 0 < before.st_size <= MAX_JSON: raise ProfileRuntimeError(f"{label} has an unsafe shape")
    with path.open("rb") as handle: raw = handle.read(MAX_JSON + 1)
    after = path.stat()
    if len(raw) != before.st_size or len(raw) > MAX_JSON or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns: raise ProfileRuntimeError(f"{label} changed while read")
    try: value = json.loads(raw)
    except json.JSONDecodeError as exc: raise ProfileRuntimeError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict): raise ProfileRuntimeError(f"{label} is not an object")
    return value, raw


def _frozen(value: dict[str, Any], label: str) -> None:
    frozen = value.get("frozen_sha256"); body = dict(value); body.pop("frozen_sha256", None)
    if not isinstance(frozen, str) or not HEX.fullmatch(frozen) or _sha(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()) != frozen:
        raise ProfileRuntimeError(f"{label} frozen hash is invalid")


def _bound_modules() -> tuple[Any, Any, Any, dict[str, str]]:
    expected = ((PLANNER_PATH, PLANNER_SHA256), (ENGINE_PATH, ENGINE_SHA256), (HELPER_PATH, HELPER_SHA256), (C1_PATH, C1_SHA256))
    for path, digest in expected:
        actual, _ = _hash_file(path, 1024 * 1024)
        if actual != digest: raise ProfileRuntimeError("reviewed profile source changed")
    planner, engine, helper = _load("figment_profile_planner", PLANNER_PATH), _load("figment_profile_engine", ENGINE_PATH), _load("figment_profile_helper", HELPER_PATH)
    if helper.COMFY_COMMIT != "95d755cd8107a72258d452b5d3657273d571f07d" or helper.PORT != 8190 or helper.WIDTH != planner.build_manifest()["sampler"]["width"] or helper.HEIGHT != planner.build_manifest()["sampler"]["height"]:
        raise ProfileRuntimeError("installed Comfy helper is not pinned")
    if helper.git_head(helper.COMFY_ROOT) != helper.COMFY_COMMIT or not helper.git_clean(helper.COMFY_ROOT): raise ProfileRuntimeError("installed Comfy checkout is not pinned clean")
    base = helper.MODELS["checkpoint"]
    if base.get("filename") != BASE_MODEL_NAME: raise ProfileRuntimeError("base model name is not pinned")
    base_record = helper.checked_file(base["path"], base["sha256"])
    helper.safe_existing(helper.COMFY_PYTHON)
    return planner, engine, helper, {"planner_sha256": PLANNER_SHA256, "controller_sha256": _hash_file(Path(__file__), 512 * 1024)[0], "pair_engine_sha256": ENGINE_SHA256, "ownership_sha256": HELPER_SHA256, "c1_sha256": C1_SHA256, "comfy_commit": helper.COMFY_COMMIT, "comfy_base_model_sha256": base_record["sha256"], "comfy_nodes_sha256": _hash_file(helper.COMFY_ROOT / "nodes.py", 4 * 1024 * 1024)[0], "comfy_sd_sha256": _hash_file(helper.COMFY_ROOT / "comfy" / "sd.py", 4 * 1024 * 1024)[0]}


def _historical(stage: str) -> tuple[str, dict[int, str]]:
    root = MAIN_PRIVATE / f"figment-local-lora-matched-{stage}-20260908-v1"; receipt, raw = _json(root / "receipt.json", MAIN_PRIVATE, "historical receipt")
    if _sha(raw) != HISTORICAL[stage]["receipt"] or receipt.get("schema") != "figment/local-lora-matched-runtime@1" or receipt.get("status") != "complete" or receipt.get("stage") != stage or receipt.get("teardown", {}).get("verified_stopped") is not True: raise ProfileRuntimeError("historical receipt is invalid")
    outputs: dict[int, str] = {}
    for row in receipt.get("rows", []):
        output = row.get("output") if isinstance(row, dict) else None; seed = row.get("seed") if isinstance(row, dict) else None
        if not isinstance(output, dict) or seed not in SEEDS or seed in outputs or not isinstance(output.get("filename"), str) or Path(output["filename"]).name != output["filename"]: raise ProfileRuntimeError("historical output binding is invalid")
        actual, _ = _hash_file(_safe(root / "output" / output["filename"], MAIN_PRIVATE, "historical PNG"), MAX_PNG)
        if actual != output.get("sha256"): raise ProfileRuntimeError("historical PNG differs from receipt")
        outputs[seed] = actual
    if set(outputs) != set(SEEDS): raise ProfileRuntimeError("historical pair is incomplete")
    for role, digest in HISTORICAL[stage]["reviews"].items():
        review, review_raw = _json(root / f"review-{role}.json", MAIN_PRIVATE, "historical review")
        if _sha(review_raw) != digest or review.get("schema") != "figment/local-lora-matched-pair-review@1" or review.get("stage") != stage or review.get("reviewer_role") != role or review.get("receipt_sha256") != HISTORICAL[stage]["receipt"]: raise ProfileRuntimeError("historical review is invalid")
    return HISTORICAL[stage]["receipt"], outputs


def _checkpoint() -> dict[str, Any]:
    path = STUDIO_PRIVATE / "figment-local-quality-fit-current-20260908-v1" / "output" / CHECKPOINT["filename"]
    path = _safe(path, STUDIO_PRIVATE, "selected current-20 checkpoint"); digest, size = _hash_file(path, MAX_LORA)
    with path.open("rb") as handle:
        header_size = int.from_bytes(handle.read(8), "little")
        if not 2 <= header_size <= MAX_HEADER or 8 + header_size >= size: raise ProfileRuntimeError("selected checkpoint header exceeds bounds")
        raw = handle.read(header_size)
    try: header = json.loads(raw)
    except json.JSONDecodeError as exc: raise ProfileRuntimeError("selected checkpoint header is invalid") from exc
    if digest != CHECKPOINT["sha256"] or size != CHECKPOINT["bytes"] or _sha(raw) != CHECKPOINT["header_sha256"] or not isinstance(header, dict) or header.get("__metadata__", {}).get("ss_steps") != "20": raise ProfileRuntimeError("selected checkpoint differs from audited current-20")
    return dict(CHECKPOINT)


def _profile_base(stage: str, admission: dict[str, Any], *, code: dict[str, Any], plan_sha256: str) -> tuple[str | None, dict[int, str] | None]:
    if stage == "profile-base":
        if admission.get("profile_base_receipt_sha256") is not None or admission.get("profile_base_review_digests") != []: raise ProfileRuntimeError("profile-base admission has prior profile evidence")
        return None, None
    root = _profile_root("profile-base"); receipt, raw = _json(root / "receipt.json", MAIN_PRIVATE, "profile-base receipt")
    if receipt.get("schema") != SCHEMA or receipt.get("status") != "complete" or receipt.get("stage") != "profile-base" or receipt.get("not_promotable") is not True or receipt.get("teardown", {}).get("verified_stopped") is not True: raise ProfileRuntimeError("profile-base receipt is invalid")
    prior, prior_raw = _json(_admission_path("profile-base"), STUDIO_PRIVATE, "profile-base admission"); _frozen(prior, "profile-base admission")
    if prior.get("schema") != ADMISSION_SCHEMA or prior.get("admission_id") != _admission_id("profile-base") or prior.get("stage") != "profile-base" or prior.get("planner_manifest_sha256") != plan_sha256 or prior.get("profile_base_receipt_sha256") is not None or prior.get("allow_local_execute") is not True or prior.get("not_promotable") is not True or any(prior.get(key) != value for key, value in code.items()):
        raise ProfileRuntimeError("profile-base admission does not bind the current fixed protocol")
    reviews = {"base": HISTORICAL["base"]["reviews"], "current-20": HISTORICAL["current-20"]["reviews"]}
    expected_inputs = _receipt_inputs({"plan_sha256": plan_sha256, "admission_sha256": _sha(prior_raw), "admission": prior, "historical_base_receipt_sha256": HISTORICAL["base"]["receipt"], "historical_current20_receipt_sha256": HISTORICAL["current-20"]["receipt"], "historical_review_sha256": reviews, "profile_base_receipt_sha256": None, "audited_current20_checkpoint": dict(CHECKPOINT), "checkpoint": None, "code": code})
    if _canonical(receipt.get("inputs")) != _canonical(expected_inputs): raise ProfileRuntimeError("profile-base receipt inputs are not bound to the fixed protocol")
    rows = receipt.get("rows")
    if not isinstance(rows, list) or len(rows) != len(SEEDS): raise ProfileRuntimeError("profile-base pair is incomplete")
    outputs: dict[int, str] = {}
    for seed, row in zip(SEEDS, rows):
        output = row.get("output") if isinstance(row, dict) else None
        if not isinstance(output, dict) or row.get("seed") != seed or row.get("row_id") != f"profile-base-seed-{seed}" or output.get("filename") != PNG_NAMES[seed]: raise ProfileRuntimeError("profile-base output binding is invalid")
        actual, size = _hash_file(_safe(root / "output" / PNG_NAMES[seed], MAIN_PRIVATE, "profile-base PNG"), MAX_PNG)
        if actual != output.get("sha256") or size != output.get("bytes"): raise ProfileRuntimeError("profile-base PNG differs from receipt")
        outputs[seed] = actual
    if len(set(outputs.values())) != len(SEEDS): raise ProfileRuntimeError("profile-base pair is not distinct")
    digests = []
    for role in ("root", "independent"):
        review, review_raw = _json(root / f"review-{role}.json", MAIN_PRIVATE, "profile-base review"); digests.append(_sha(review_raw))
        if review.get("schema") != REVIEW_SCHEMA or review.get("stage") != "profile-base" or review.get("reviewer_role") != role or review.get("receipt_sha256") != _sha(raw) or review.get("disposition") != "continue" or review.get("not_promotable") is not True or review.get("human_qa") is not False: raise ProfileRuntimeError("profile-base review is not a continuing diagnostic record")
        bindings = {row.get("seed"): row.get("output_sha256") for row in review.get("rows", []) if isinstance(row, dict)}
        if not isinstance(review.get("rows"), list) or len(review["rows"]) != 2 or bindings != outputs: raise ProfileRuntimeError("profile-base review PNG bindings are invalid")
    if admission.get("profile_base_receipt_sha256") != _sha(raw) or admission.get("profile_base_png_sha256_by_seed") != {str(seed): outputs[seed] for seed in SEEDS} or admission.get("profile_base_review_digests") != digests: raise ProfileRuntimeError("profile-current admission does not bind profile-base evidence")
    return _sha(raw), outputs


def validate(stage: str) -> dict[str, Any]:
    if stage not in STAGES: raise ProfileRuntimeError("profile stage is invalid")
    planner, _engine, _helper, code = _bound_modules(); plan = planner.build_manifest(); planner.validate_manifest(plan)
    base_receipt, base_pngs = _historical("base"); current_receipt, current_pngs = _historical("current-20"); checkpoint = _checkpoint()
    admission, admission_raw = _json(_admission_path(stage), STUDIO_PRIVATE, "profile admission"); _frozen(admission, "profile admission")
    profile_receipt, profile_pngs = _profile_base(stage, admission, code=code, plan_sha256=plan["frozen_sha256"])
    rows = [row for row in plan["rows"] if row["stage"] == stage]
    expected = {"stage": stage, "planner_manifest_sha256": plan["frozen_sha256"], **code, "historical_base_receipt_sha256": base_receipt, "historical_current20_receipt_sha256": current_receipt, "historical_base_png_sha256_by_seed": {str(seed): base_pngs[seed] for seed in SEEDS}, "historical_current20_png_sha256_by_seed": {str(seed): current_pngs[seed] for seed in SEEDS}, "historical_review_sha256": {"base": HISTORICAL["base"]["reviews"], "current-20": HISTORICAL["current-20"]["reviews"]}, "current20_checkpoint": checkpoint, "profile_base_receipt_sha256": profile_receipt, "profile_base_png_sha256_by_seed": None if profile_pngs is None else {str(seed): profile_pngs[seed] for seed in SEEDS}, "allow_local_execute": True, "not_promotable": True}
    if admission.get("schema") != ADMISSION_SCHEMA or admission.get("admission_id") != _admission_id(stage) or any(admission.get(key) != value for key, value in expected.items()): raise ProfileRuntimeError("profile admission does not bind exact evidence")
    if len(rows) != 2 or {row["seed"] for row in rows} != set(SEEDS): raise ProfileRuntimeError("profile manifest pair is invalid")
    return {"stage": stage, "rows": rows, "checkpoint": None if stage == "profile-base" else checkpoint, "audited_current20_checkpoint": checkpoint, "admission": admission, "admission_sha256": _sha(admission_raw), "code": code, "plan_sha256": plan["frozen_sha256"], "historical_base_receipt_sha256": base_receipt, "historical_current20_receipt_sha256": current_receipt, "historical_review_sha256": expected["historical_review_sha256"], "profile_base_receipt_sha256": profile_receipt}


def _receipt_inputs(evidence: dict[str, Any]) -> dict[str, Any]:
    return {"planner_manifest_sha256": evidence["plan_sha256"], "profile_admission_sha256": evidence["admission_sha256"], "profile_admission_id": evidence["admission"]["admission_id"], "historical_base_receipt_sha256": evidence["historical_base_receipt_sha256"], "historical_current20_receipt_sha256": evidence["historical_current20_receipt_sha256"], "historical_review_sha256": evidence["historical_review_sha256"], "profile_base_receipt_sha256": evidence["profile_base_receipt_sha256"], "current20_checkpoint": evidence["audited_current20_checkpoint"], "selected_checkpoint": evidence["checkpoint"], **evidence["code"]}


class _VerifiedHelper:
    def __init__(self, helper: Any, rows: list[dict[str, Any]]):
        self._helper, self._rows, self._pending = helper, rows, {}
    def __getattr__(self, name: str) -> Any: return getattr(self._helper, name)
    def _local_json(self, opener: Any, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self._helper._local_json(opener, method, path, body)
        if method == "POST" and path == "/prompt":
            prompt_id = response.get("prompt_id")
            graph = body.get("prompt") if isinstance(body, dict) else None
            if not isinstance(prompt_id, str) or not isinstance(graph, dict) or _canonical(graph) not in [_canonical(row["graph"]) for row in self._rows]:
                raise ProfileRuntimeError("profile dispatch graph is invalid")
            self._pending[prompt_id] = graph
        return response
    def _completed_output(self, history: dict[str, Any], prompt_id: str, output: Path) -> dict[str, Any] | None:
        completed = self._helper._completed_output(history, prompt_id, output)
        if completed is None: return None
        graph = self._pending.get(prompt_id)
        name = completed.get("filename") if isinstance(completed, dict) else None
        if not isinstance(graph, dict) or not isinstance(name, str): raise ProfileRuntimeError("profile completed output is invalid")
        path = _safe(output / name, MAIN_PRIVATE, "profile PNG")
        before = path.stat()
        if before.st_size > MAX_PNG: raise ProfileRuntimeError("profile PNG exceeds its byte bound")
        latents = [node.get("inputs") for node in graph.values() if isinstance(node, dict) and node.get("class_type") == "EmptyLatentImage"]
        if len(latents) != 1 or not isinstance(latents[0], dict) or not isinstance(latents[0].get("width"), int) or not isinstance(latents[0].get("height"), int):
            raise ProfileRuntimeError("profile admitted graph has no exact dimensions")
        dimensions = (latents[0]["width"], latents[0]["height"])
        try:
            with Image.open(path) as image:
                raw = image.info.get("prompt")
                if image.size != dimensions or not isinstance(raw, str) or len(raw.encode("utf-8")) > MAX_JSON:
                    raise ProfileRuntimeError("profile PNG embedded prompt is invalid")
                embedded = json.loads(raw)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            if isinstance(exc, ProfileRuntimeError): raise
            raise ProfileRuntimeError("profile PNG embedded prompt is invalid") from exc
        if not isinstance(embedded, dict) or _canonical(embedded) != _canonical(graph): raise ProfileRuntimeError("profile PNG graph differs from admitted row")
        after = path.stat()
        if after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns: raise ProfileRuntimeError("profile PNG changed while verified")
        completed = dict(completed); completed["verified_graph_sha256"] = _sha(json.dumps(graph, sort_keys=True, separators=(",", ":")).encode())
        return completed


def execute(evidence: dict[str, Any]) -> dict[str, Any]:
    stage = evidence.get("stage")
    if stage not in STAGES: raise ProfileRuntimeError("execute requires validated profile stage")
    evidence = validate(stage)
    _planner, engine, helper, code = _bound_modules()
    admitted = evidence["code"]
    _check_code(code, admitted)
    if any(evidence["admission"].get(key) != value for key, value in admitted.items()): raise ProfileRuntimeError("profile admission does not bind exact source evidence")
    checkpoint = evidence["checkpoint"]
    source = None if checkpoint is None else STUDIO_PRIVATE / "figment-local-quality-fit-current-20260908-v1" / "output" / checkpoint["filename"]
    def verify_staged(path: Path) -> dict[str, Any]:
        copied = _checkpoint()
        actual, size = _hash_file(path, MAX_LORA)
        if actual != copied["sha256"] or size != copied["bytes"]: raise ProfileRuntimeError("staged current-20 checkpoint changed")
        return copied
    verified = _VerifiedHelper(helper, evidence["rows"])
    root = _profile_root(stage)
    return engine.execute_pair(evidence, verified, root=root, main_private=MAIN_PRIVATE, studio_private=STUDIO_PRIVATE, source=source, verify_staged=verify_staged, verify_before_success=lambda: _check_code(_bound_modules()[3], admitted), receipt_inputs=_receipt_inputs, sha=_sha, safe_existing=_safe, reparse=_reparse, file_hash=_hash_file, error=ProfileRuntimeError, pumper_factory=lambda stream, path: engine.Pumper(stream, path, maximum=MAX_STDERR, error=ProfileRuntimeError), schema=SCHEMA, maximum_lora=MAX_LORA, maximum_stderr=MAX_STDERR, maximum_png=MAX_PNG, maximum_output_entries=MAX_OUTPUT_ENTRIES, deadline_seconds=PAIR_SECONDS)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--stage", required=True, choices=STAGES); parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    try:
        evidence = validate(args.stage)
        if not args.execute:
            print(json.dumps({"status": "validated-not-executed", "stage": args.stage, "not_promotable": True}, sort_keys=True)); return 0
        print(json.dumps(execute(evidence), sort_keys=True)); return 0
    except ProfileRuntimeError as exc:
        print("profile local inference refused: " + str(exc), file=sys.stderr); return 2


if __name__ == "__main__": raise SystemExit(main())
