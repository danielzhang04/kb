"""Closed, read-only evidence/admission validator for the local OmniGen2 reference probe.

No CLI, no file writes, no model imports. Importing this module reads no files and
spawns no processes. The pinned planner and preparer are loaded lazily, only from
bytes whose SHA-256 matched the frozen pin, compiled into fresh module objects (never
from cached bytecode). Research-only; non-promotable; commercial use uncleared.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import stat
import sys
import types
from collections.abc import Mapping
from pathlib import Path
from typing import Any

EVIDENCE_SCHEMA = "figment/local-omnigen2-evidence@1"
ADMISSION_SCHEMA = "figment/local-omnigen2-admission@1"
ADMISSION_ID = "figment-local-omnigen2-reference-20260908-v1"
ADMITTED_BY = "codex-worker"
PURPOSE = "local fictional adult research comparator"

STUDIO = Path(__file__).resolve().parents[4]
MAIN_PRIVATE = STUDIO.parents[1]
STUDIO_PRIVATE = STUDIO / "_private"
# Derived from the repo root rather than pinned to one codex worktree's literal
# absolute path, so this module (and its _check_layout guard below) works from
# any checkout. _check_layout still fails closed if STUDIO is ever monkeypatched
# out of step with EXPECTED_STUDIO by a caller.
EXPECTED_STUDIO = STUDIO
RUN_ROOT = MAIN_PRIVATE / "figment-local-omnigen2-reference-20260908-v1"
ADMISSION_PATH = STUDIO_PRIVATE / "figment-local-omnigen2-reference-admission-20260908-v1" / "admission.json"
MODELS_ROOT = MAIN_PRIVATE / "figment-local-omnigen2-models-20260908-v1"
TEMPLATE_PATH = MAIN_PRIVATE / "figment-omnigen2-template-20260908-v1" / "workflow.json"
REFERENCE_PATH = STUDIO / "orgs/figment/personas/creator-001/anchors/g01.jpg"

PLANNER_REL = "orgs/figment/pipeline/expand/local_omnigen2_inference.py"
PREPARER_REL = "orgs/figment/pipeline/expand/local_omnigen2_prepare.py"
FEASIBILITY_REL = "docs/figment/2026-09-08-local-omnigen2-feasibility.md"
RUNTIME_DESIGN_REL = "docs/figment/2026-09-08-local-omnigen2-runtime-design.md"
FIXED_CODE = {
    PLANNER_REL: "c91d636ffbcc21e96c22940784f897326f1655bbc8570c16a848751751b81bf9",
    PREPARER_REL: "20886544eb770a9005384540be8e265ed15bbc80b0f9210ca35c69af0fd246f3",
    "orgs/figment/pipeline/expand/local_comfy_input.py": "2997ba3185aabfb146b13f38d18c854615a7190064d30f14037570398bea7bac",
}
FIXED_DOCS = {
    FEASIBILITY_REL: "daf48e21a2eabd2b9f9d4e44f5ec464108a884a95cacc81bb12f952379823939",
    RUNTIME_DESIGN_REL: "ea4a4620074d2c41ba65adcc48933c34a0a48f23df37ab45f0b6d2f88661a9c9",
}
DYNAMIC_CODE = (
    "orgs/figment/pipeline/expand/local_omnigen2_admission.py",
    "orgs/figment/pipeline/expand/local_omnigen2_runtime.py",
    "orgs/figment/pipeline/expand/local_omnigen2_resources.py",
    "orgs/figment/pipeline/train/local_lora_pair_engine.py",
)
PINS: dict[str, Any] = {
    "code": dict(FIXED_CODE),
    "docs": dict(FIXED_DOCS),
    "template": {"bytes": 26553, "sha256": "3a63f64bf3b58ad8fa761e4606d7d5ca1e6efd42fc1df57afe9e3e6d075ca593"},
    "preparation_receipt_sha256": "7d8b1c72649376701503481ab1dc14070f96bab243e49be25b1db6c97e7dd3ac",
    "reference_bytes": 737366,
    "comfy_commit": "95d755cd8107a72258d452b5d3657273d571f07d",
    "comfy_critical_files": 7,
    "comfy_untracked_inventory": ("gen_history.json", "gen_start_ts.txt", "server.pid", "torch_install.pid"),
}
MODEL_DIRECTORIES = ("diffusion_models", "text_encoders", "vae")
RECEIPT_NAME = "preparation.json"
MAX_CODE_BYTES = 512 * 1024
MAX_DOC_BYTES = 1024 * 1024
MAX_RECEIPT_BYTES = 1024 * 1024
MAX_ADMISSION_BYTES = 1024 * 1024
MAX_ROOT_ENTRIES = 4
MAX_DIR_ENTRIES = 1
READ_CHUNK = 1024 * 1024
BOUNDS = {
    "total_minutes": 100,
    "ready_seconds": 180,
    "row_seconds": 2700,
    "teardown_acceptance_seconds": 30,
    "stderr_bytes": 16 * 1024 * 1024,
    "png_bytes": 8 * 1024 * 1024,
    "max_samples": 6100,
}
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
_PINNED_PREFIX = "figment_local_omnigen2_admission_pinned"


class AdmissionError(ValueError):
    """Raised whenever the evidence or admission is not exactly the frozen state."""


# ---------------------------------------------------------------- primitives
def _default(value: Any) -> Any:
    if isinstance(value, Mapping):
        return dict(value)
    raise TypeError(f"not JSON-friendly: {type(value).__name__}")


def canonical(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False, default=_default
    ).encode("utf-8")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return types.MappingProxyType({str(k): _freeze(v) for k, v in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(v) for v in value)
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    raise AdmissionError(f"not JSON-friendly: {type(value).__name__}")


def reparse(path: Path) -> bool:
    """True when the path itself (not its target) is a symlink, junction, or reparse point."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise AdmissionError(f"cannot inspect path: {path}") from exc
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & REPARSE_POINT:
        return True
    return bool(getattr(os.path, "isjunction", lambda _p: False)(path))


def _reject_reparse_ancestors(path: Path) -> None:
    cursor = path
    while True:
        if reparse(cursor):
            raise AdmissionError(f"path traverses a reparse point: {cursor}")
        if cursor.parent == cursor:
            return
        cursor = cursor.parent


def safe(path: Path, root: Path, label: str) -> Path:
    """Absolute `path` contained in absolute `root`, with no reparse point on any ancestor."""
    path, root = Path(path), Path(root)
    if not path.is_absolute() or not root.is_absolute():
        raise AdmissionError(f"{label}: paths must be absolute")
    if any(part in {"", ".", ".."} for part in path.parts[1:]) or any(part in {"", ".", ".."} for part in root.parts[1:]):
        raise AdmissionError(f"{label}: relative components are not allowed")
    if path != root and root not in path.parents:
        raise AdmissionError(f"{label}: {path} is outside {root}")
    _reject_reparse_ancestors(path)
    return path


def _identity(info: os.stat_result) -> tuple[int, int, int, int]:
    return (info.st_size, info.st_mtime_ns, info.st_ino, info.st_dev)


def _stream_file(path: Path, maximum: int, *, allow_empty: bool, collect: bool) -> tuple[bytes | None, str, int]:
    """Stream a regular non-reparse file through SHA-256 in <=1 MiB chunks.

    Bytes are retained only when `collect` is True (small JSON/code/reference reads).
    File identity (size, mtime_ns, ino, dev) must agree between the initial lstat, the
    fstat of the open handle before and after reading, and a final lstat, so a same-size
    replacement is rejected alongside growth and short reads.
    """
    if type(maximum) is not int or maximum <= 0:
        raise AdmissionError("maximum must be a positive int")
    _reject_reparse_ancestors(path)
    try:
        before = os.lstat(path)
    except FileNotFoundError as exc:
        raise AdmissionError(f"missing file: {path}") from exc
    except OSError as exc:
        raise AdmissionError(f"cannot stat: {path}") from exc
    if not stat.S_ISREG(before.st_mode):
        raise AdmissionError(f"not a regular file: {path}")
    size = before.st_size
    if size > maximum:
        raise AdmissionError(f"file exceeds bound ({size} > {maximum}): {path}")
    if size == 0 and not allow_empty:
        raise AdmissionError(f"empty file: {path}")
    expected = _identity(before)
    digest = hashlib.sha256()
    chunks: list[bytes] = []
    observed = 0
    try:
        with open(path, "rb", buffering=0) as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or _identity(info) != expected:
                raise AdmissionError(f"file changed while opening: {path}")
            while observed <= size:
                block = handle.read(min(READ_CHUNK, size - observed + 1))
                if not block:
                    break
                observed += len(block)
                if observed > size:
                    raise AdmissionError(f"file grew during read: {path}")
                digest.update(block)
                if collect:
                    chunks.append(block)
            if observed != size:
                raise AdmissionError(f"short read: {path}")
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or _identity(info) != expected:
                raise AdmissionError(f"file changed during read: {path}")
    except OSError as exc:
        raise AdmissionError(f"cannot read: {path}") from exc
    try:
        after = os.lstat(path)
    except OSError as exc:
        raise AdmissionError(f"cannot stat: {path}") from exc
    if not stat.S_ISREG(after.st_mode) or _identity(after) != expected:
        raise AdmissionError(f"file changed during read: {path}")
    _reject_reparse_ancestors(path)
    data = b"".join(chunks) if collect else None
    return data, digest.hexdigest(), size


def _read_bounded(path: Path, maximum: int, *, allow_empty: bool = False) -> tuple[bytes, str, int]:
    """Small bounded read (JSON/code/reference) that retains the bytes."""
    data, sha, size = _stream_file(path, maximum, allow_empty=allow_empty, collect=True)
    assert data is not None
    return data, sha, size


def hash_file(path: Path, maximum: int, *, allow_empty: bool = False) -> tuple[str, int]:
    """(sha256, size) of a regular non-reparse file, streamed without retaining bytes."""
    _, sha, size = _stream_file(Path(path), maximum, allow_empty=allow_empty, collect=False)
    return sha, size


def _strict_loads(data: bytes, label: str) -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, value in items:
            if key in out:
                raise AdmissionError(f"{label}: duplicate key {key!r}")
            out[key] = value
        return out

    def constant(name: str) -> Any:
        raise AdmissionError(f"{label}: non-finite number {name}")

    def finite(text: str) -> float:
        value = float(text)
        if not math.isfinite(value):
            raise AdmissionError(f"{label}: non-finite number {text}")
        return value

    def integer(text: str) -> int:
        try:
            return int(text)
        except ValueError as exc:
            raise AdmissionError(f"{label}: integer too large {text[:32]}") from exc

    try:
        return json.loads(
            data.decode("utf-8", errors="strict"),
            object_pairs_hook=pairs,
            parse_constant=constant,
            parse_float=finite,
            parse_int=integer,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AdmissionError(f"{label}: invalid JSON") from exc


# ---------------------------------------------------------------- pinned loads
def _load_pinned(relative: str) -> types.ModuleType:
    expected = PINS["code"][relative]
    path = safe(STUDIO / relative, STUDIO, relative)
    data, sha, _ = _read_bounded(path, MAX_CODE_BYTES)
    if sha != expected:
        raise AdmissionError(f"pinned source hash mismatch: {relative}")
    name = f"{_PINNED_PREFIX}.{Path(relative).stem}"
    code = compile(data, str(path), "exec", dont_inherit=True)
    module = types.ModuleType(name)
    module.__file__ = str(path)
    sys.modules[name] = module
    try:
        exec(code, module.__dict__)  # noqa: S102 - bytes were hash-checked above
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


def _load_planner() -> types.ModuleType:
    return _load_pinned(PLANNER_REL)


def _load_preparer() -> types.ModuleType:
    return _load_pinned(PREPARER_REL)


def _inspect_comfy(prep: types.ModuleType) -> Any:
    return prep._inspect_comfy()


def _model_pins(planner: types.ModuleType) -> dict[str, dict[str, Any]]:
    models = {k: dict(v) for k, v in planner.MODELS.items()}
    if sum(int(v["bytes"]) for v in models.values()) != planner.MODEL_PAYLOAD_BYTES:
        raise AdmissionError("planner model payload is inconsistent")
    return models


def _reference_pin(planner: types.ModuleType) -> dict[str, Any]:
    return dict(planner.REFERENCE)


def _inspect_models(pins: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    root = safe(MODELS_ROOT, MAIN_PRIVATE, "models_root")
    if reparse(root) or not root.is_dir():
        raise AdmissionError("models root is missing or reparse-backed")
    by_dir = {v["directory"]: (k, v) for k, v in pins.items()}
    if set(by_dir) != set(MODEL_DIRECTORIES) or len(pins) != 3:
        raise AdmissionError("planner model directories are not the frozen three")
    names = _scan(root, MAX_ROOT_ENTRIES, "models root")
    if set(names) != {*MODEL_DIRECTORIES, RECEIPT_NAME}:
        raise AdmissionError(f"models root inventory is not closed: {sorted(names)}")
    observed: dict[str, dict[str, Any]] = {}
    for directory in MODEL_DIRECTORIES:
        key, spec = by_dir[directory]
        folder = root / directory
        if reparse(folder) or not folder.is_dir():
            raise AdmissionError(f"model directory is missing or reparse-backed: {directory}")
        entries = _scan(folder, MAX_DIR_ENTRIES, directory)
        if entries != [spec["file"]]:
            raise AdmissionError(f"model directory inventory is not closed: {directory}")
        sha, size = hash_file(folder / spec["file"], int(spec["bytes"]))
        if size != spec["bytes"] or sha != spec["sha256"]:
            raise AdmissionError(f"model weight does not match pin: {spec['file']}")
        observed[key] = {"directory": directory, "file": spec["file"], "bytes": size, "sha256": sha}
    return observed


def _scan(folder: Path, maximum: int, label: str) -> list[str]:
    names: list[str] = []
    try:
        with os.scandir(folder) as it:
            for entry in it:
                if len(names) >= maximum:
                    raise AdmissionError(f"{label}: more than {maximum} entries")
                if entry.is_symlink() or reparse(Path(entry.path)):
                    raise AdmissionError(f"{label}: reparse entry {entry.name}")
                names.append(entry.name)
    except OSError as exc:
        raise AdmissionError(f"{label}: cannot scan") from exc
    return sorted(names)


def _inspect_receipt() -> str:
    path = safe(MODELS_ROOT / RECEIPT_NAME, MAIN_PRIVATE, "preparation receipt")
    data, sha, _ = _read_bounded(path, MAX_RECEIPT_BYTES)
    if sha != PINS["preparation_receipt_sha256"]:
        raise AdmissionError("preparation receipt hash mismatch")
    if not isinstance(_strict_loads(data, "preparation receipt"), dict):
        raise AdmissionError("preparation receipt is not a JSON object")
    return sha


def _inspect_reference(pin: dict[str, Any]) -> dict[str, Any]:
    from io import BytesIO

    from PIL import Image

    path = safe(REFERENCE_PATH, STUDIO, "reference")
    data, sha, size = _read_bounded(path, PINS["reference_bytes"])
    if size != PINS["reference_bytes"] or sha != pin["sha256"] or path.name != pin["filename"]:
        raise AdmissionError("reference image does not match planner pin")
    with Image.open(BytesIO(data)) as image:
        fmt, width, height = image.format, image.width, image.height
    if fmt != "JPEG" or (width, height) != (pin["width"], pin["height"]):
        raise AdmissionError("reference image format or dimensions differ from planner pin")
    return {"filename": path.name, "bytes": size, "sha256": sha, "format": fmt, "width": width, "height": height}


def _snapshot_sources() -> dict[str, dict[str, Any]]:
    snapshot: dict[str, dict[str, Any]] = {}
    for relative, expected in PINS["code"].items():
        sha, size = hash_file(safe(STUDIO / relative, STUDIO, relative), MAX_CODE_BYTES)
        if sha != expected:
            raise AdmissionError(f"pinned code hash mismatch: {relative}")
        snapshot[relative] = {"bytes": size, "sha256": sha}
    for relative in DYNAMIC_CODE:
        sha, size = hash_file(safe(STUDIO / relative, STUDIO, relative), MAX_CODE_BYTES)
        snapshot[relative] = {"bytes": size, "sha256": sha}
    for relative, expected in PINS["docs"].items():
        sha, size = hash_file(safe(STUDIO / relative, STUDIO, relative), MAX_DOC_BYTES)
        if sha != expected:
            raise AdmissionError(f"pinned doc hash mismatch: {relative}")
        snapshot[relative] = {"bytes": size, "sha256": sha}
    template = PINS["template"]
    sha, size = hash_file(safe(TEMPLATE_PATH, MAIN_PRIVATE, "template"), template["bytes"])
    if size != template["bytes"] or sha != template["sha256"]:
        raise AdmissionError("template hash mismatch")
    snapshot["template"] = {"bytes": size, "sha256": sha}
    return snapshot


def _check_layout() -> None:
    if STUDIO != EXPECTED_STUDIO:
        raise AdmissionError(f"studio worktree is not the expected path: {STUDIO}")
    if MAIN_PRIVATE != STUDIO.parents[1] or STUDIO_PRIVATE != STUDIO / "_private":
        raise AdmissionError("private roots are not derived from the studio path")
    if RUN_ROOT.parent != MAIN_PRIVATE or MODELS_ROOT.parent != MAIN_PRIVATE or TEMPLATE_PATH.parents[1] != MAIN_PRIVATE:
        raise AdmissionError("run/models/template roots left the main private root")
    if ADMISSION_PATH.parents[1] != STUDIO_PRIVATE or REFERENCE_PATH.parents[4] != STUDIO / "orgs":
        raise AdmissionError("admission or reference path left the studio")


# ---------------------------------------------------------------- evidence
def build_evidence() -> Mapping[str, Any]:
    """Freshly observed, fully pinned evidence; raises AdmissionError on any deviation."""
    _check_layout()
    before = _snapshot_sources()
    planner = _load_planner()
    manifest = planner.build_manifest()
    planner.validate_manifest(manifest)
    if planner.COMFY_COMMIT != PINS["comfy_commit"]:
        raise AdmissionError("planner Comfy commit differs from admission pin")
    template = planner.TEMPLATE_SNAPSHOT
    if (template["bytes"], template["sha256"]) != (PINS["template"]["bytes"], PINS["template"]["sha256"]):
        raise AdmissionError("planner template snapshot differs from admission pin")
    if planner.FEASIBILITY_SHA256 != PINS["docs"][FEASIBILITY_REL]:
        raise AdmissionError("planner feasibility pin differs from admission pin")

    prep = _load_preparer()
    if prep.COMFY_COMMIT != PINS["comfy_commit"] or prep.REVISION != planner.MODEL_REVISION:
        raise AdmissionError("preparer pins differ from planner pins")
    comfy = _inspect_comfy(prep)
    if not isinstance(comfy, dict) or comfy.get("commit") != PINS["comfy_commit"] or comfy.get("tracked_clean") is not True:
        raise AdmissionError("installed ComfyUI is not the frozen clean commit")
    files = comfy.get("critical_files")
    untracked = comfy.get("untracked_inventory")
    if not isinstance(files, list) or len(files) != PINS["comfy_critical_files"]:
        raise AdmissionError("ComfyUI critical file evidence is incomplete")
    if not isinstance(untracked, list) or not all(isinstance(u, str) for u in untracked):
        raise AdmissionError("ComfyUI untracked inventory is malformed")
    if tuple(untracked) != tuple(PINS["comfy_untracked_inventory"]):
        raise AdmissionError("ComfyUI untracked inventory differs from the reviewed snapshot")
    if set(comfy) != {"root", "commit", "tracked_clean", "untracked_inventory", "critical_files"}:
        raise AdmissionError("ComfyUI evidence has unexpected shape")

    models = _inspect_models(_model_pins(planner))
    receipt_sha = _inspect_receipt()
    reference = _inspect_reference(_reference_pin(planner))

    comfy_after = _inspect_comfy(prep)
    if canonical(comfy_after) != canonical(comfy):
        raise AdmissionError("installed ComfyUI changed while evidence was being gathered")

    after = _snapshot_sources()
    if canonical(after) != canonical(before):
        raise AdmissionError("a pinned source changed while evidence was being gathered")

    code = {k: v for k, v in before.items() if k in PINS["code"] or k in DYNAMIC_CODE}
    docs = {k: v for k, v in before.items() if k in PINS["docs"]}
    evidence = {
        "schema": EVIDENCE_SCHEMA,
        "studio": str(STUDIO),
        "run_root": str(RUN_ROOT),
        "models_root": str(MODELS_ROOT),
        "manifest": manifest,
        "code": code,
        "docs": docs,
        "reference": reference,
        "models": models,
        "preparation_receipt_sha256": receipt_sha,
        "template": {"path": str(TEMPLATE_PATH), **before["template"]},
        "comfyui": comfy,
        "bounds": dict(BOUNDS),
        "cooperative_deadlines": True,
        "automatic_promotion": False,
        "commercial_use_cleared": False,
    }
    return _freeze(_strict_loads(canonical(evidence), "evidence"))


# ---------------------------------------------------------------- admission
def make_admission(evidence: Mapping[str, Any]) -> Mapping[str, Any]:
    """Pure data: the exact admission record for `evidence`. Writes nothing."""
    if not isinstance(evidence, Mapping) or evidence.get("schema") != EVIDENCE_SCHEMA:
        raise AdmissionError("evidence schema mismatch")
    body = {
        "schema": ADMISSION_SCHEMA,
        "id": ADMISSION_ID,
        "admitted_by": ADMITTED_BY,
        "purpose": PURPOSE,
        "not_promotable": True,
        "evidence": _freeze(evidence),
    }
    return _freeze({**body, "admission_sha256": _sha256(canonical(body))})


def compare_admission(observed: Any, expected: Mapping[str, Any]) -> None:
    """Whole-document canonical equality: no subsets, no numeric or boolean coercion."""
    if not isinstance(observed, Mapping) or not isinstance(expected, Mapping):
        raise AdmissionError("admission must be a JSON object")
    if canonical(observed) != canonical(expected):
        raise AdmissionError("admission does not match freshly built evidence")


def validate_admission() -> Mapping[str, Any]:
    """Read the fixed admission file, rebuild evidence, and require exact equality."""
    path = safe(ADMISSION_PATH, STUDIO_PRIVATE, "admission")
    data, raw_sha, size = _read_bounded(path, MAX_ADMISSION_BYTES)
    observed = _strict_loads(data, "admission")
    expected = make_admission(build_evidence())
    compare_admission(observed, expected)
    return _freeze(
        {
            "admission_id": expected["id"],
            "admission_sha256": expected["admission_sha256"],
            "admission_file_sha256": raw_sha,
            "admission_file_bytes": size,
            "canonical_sha256": _sha256(canonical(expected)),
            "evidence": expected["evidence"],
        }
    )
