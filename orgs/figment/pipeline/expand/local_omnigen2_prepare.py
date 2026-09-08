#!/usr/bin/env python3
"""Prepare the exact OmniGen2 ComfyUI weights without running a model.

The default command prints the frozen plan and performs no writes or network
requests. --apply validates the local ComfyUI pin, downloads three immutable
public files into a fresh private staging root, verifies their byte counts and
SHA-256 digests, writes a preparation receipt, and atomically publishes the
root. It never imports a model runtime, touches a GPU, or admits a model.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA = "figment/local-omnigen2-model-preparation@1"
REPOSITORY = "Comfy-Org/Omnigen2_ComfyUI_repackaged"
REVISION = "4876f2222e35e269029e8d72aaff5b2aaaf73e1b"
COMFY_ROOT = Path(r"C:\Users\danie\tools\ComfyUI")
COMFY_COMMIT = "95d755cd8107a72258d452b5d3657273d571f07d"
PRIVATE_BASE = Path(r"C:\Users\danie\kb\_private")
PRIVATE_ROOT = PRIVATE_BASE / "figment-local-omnigen2-models-20260908-v1"
FEASIBILITY_PATH = "docs/figment/2026-09-08-local-omnigen2-feasibility.md"
FEASIBILITY_SHA256 = "43b1c6fe64fd817971ab9250dc63789af75ecff5a4ff473367bfb3fa9182d9d4"
MIN_START_FREE_BYTES = 35 * 1024**3
MIN_REMAINING_FREE_BYTES = 20 * 1024**3
EXPECTED_TOTAL_BYTES = 15_779_025_788
READ_BYTES = 1024 * 1024
DISK_CHECK_INTERVAL_BYTES = 64 * 1024 * 1024
MAX_SAFETENSORS_HEADER_BYTES = 32 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 30
APPLY_DEADLINE_SECONDS = 60 * 60
MAX_GIT_OUTPUT_BYTES = 64 * 1024
ALLOWED_HOSTS = frozenset({
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "cdn-lfs-us-1.hf.co",
    "cdn-lfs-eu-1.hf.co",
    "cas-bridge.xethub.hf.co",
})
SAFE_PRIVATE_CHILD = re.compile(r"\.?[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)

MODELS: tuple[dict[str, Any], ...] = (
    {
        "id": "diffusion_model",
        "source_path": "split_files/diffusion_models/omnigen2_fp16.safetensors",
        "target": "diffusion_models/omnigen2_fp16.safetensors",
        "bytes": 7_934_384_176,
        "sha256": "60dbde45107762d164bac463e1cf365e074b377fa843dc90cb2985fb211cd4de",
        "component_license": "Apache-2.0 declared by OmniGen2 and Comfy repack",
    },
    {
        "id": "text_vision_encoder",
        "source_path": "split_files/text_encoders/qwen_2.5_vl_fp16.safetensors",
        "target": "text_encoders/qwen_2.5_vl_fp16.safetensors",
        "bytes": 7_509_337_224,
        "sha256": "ba05dd266ad6a6aa90f7b2936e4e775d801fb233540585b43933647f8bc4fbc3",
        "component_license": "Qwen Research License; commercial use uncleared",
    },
    {
        "id": "vae",
        "source_path": "split_files/vae/ae.safetensors",
        "target": "vae/ae.safetensors",
        "bytes": 335_304_388,
        "sha256": "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
        "component_license": "Apache-2.0 FLUX autoencoder weights",
    },
)

CORE_FILES: tuple[tuple[str, str], ...] = (
    ("nodes.py", "5ab70a74109118256934b63675ed620a47becb54343a77daa66b4fe20a4d0ee7"),
    ("comfy/supported_models.py", "23fe5b971f2f27c080f3fcd144e0a5d8de6a5d8d5af2b7584d80cb1dea4b6c1a"),
    ("comfy/model_base.py", "de79289f4190e9fd8821c9210dfe2cb0f4a5b1583bda7addbadfd016b8184fa0"),
    ("comfy/text_encoders/omnigen2.py", "42592971b333b2b1a74b3061e1b835607c0bff0d1d705bbbabbd5be670f36edf"),
    ("comfy_extras/nodes_edit_model.py", "3773fd748c404758ee36a3bac24cfea6e10c1b9990fa388cc440c56db1dc6a4a"),
    ("comfy_extras/nodes_custom_sampler.py", "913d776b5e696c70b77b8184f2af504533fbff2fad62a05cef4ecba87975f0bf"),
    ("comfy/cli_args.py", "b13f488ba08a50e78f487c7f4d6e8b43e05e3be53464e8b5fba1ff6cd47f11a1"),
)


class OmniGen2PreparationError(RuntimeError):
    pass


def _is_reparse(path: Path) -> bool:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise OmniGen2PreparationError(f"cannot inspect path: {path}") from exc
    if stat.S_ISLNK(info.st_mode):
        return True
    if getattr(info, "st_file_attributes", 0) & REPARSE_POINT:
        return True
    return bool(getattr(os.path, "isjunction", lambda _path: False)(path))


def _reject_reparse_ancestors(path: Path, *, require_leaf: bool) -> Path:
    absolute = path.absolute()
    existing: list[Path] = []
    cursor = absolute
    while True:
        if cursor.exists() or cursor.is_symlink():
            existing.append(cursor)
        elif cursor == absolute and require_leaf:
            raise OmniGen2PreparationError(f"required path is unavailable: {absolute}")
        if cursor.parent == cursor:
            break
        cursor = cursor.parent
    for member in existing:
        if _is_reparse(member):
            raise OmniGen2PreparationError(f"path may not traverse a reparse point: {member}")
    return absolute


def _sha256_file(path: Path, *, expected_bytes: int | None = None) -> dict[str, Any]:
    digest = hashlib.sha256()
    observed = 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(READ_BYTES), b""):
            observed += len(block)
            if expected_bytes is not None and observed > expected_bytes:
                raise OmniGen2PreparationError(f"file exceeds byte pin: {path.name}")
            digest.update(block)
    if expected_bytes is not None and observed != expected_bytes:
        raise OmniGen2PreparationError(f"file byte count mismatch: {path.name}")
    return {"bytes": observed, "sha256": digest.hexdigest()}


def _validate_model_specs() -> None:
    if len(MODELS) != 3 or sum(int(item["bytes"]) for item in MODELS) != EXPECTED_TOTAL_BYTES:
        raise OmniGen2PreparationError("the frozen three-file payload is inconsistent")
    targets: set[str] = set()
    for item in MODELS:
        target = Path(str(item["target"]))
        source = str(item["source_path"])
        if (
            target.is_absolute()
            or target.drive
            or len(target.parts) != 2
            or any(part in {"", ".", ".."} for part in target.parts)
            or "\\" in source
            or Path(source).is_absolute()
            or len(Path(source).parts) != 3
            or ".." in Path(source).parts
            or not re.fullmatch(r"[0-9a-f]{64}", str(item["sha256"]))
            or int(item["bytes"]) <= 0
        ):
            raise OmniGen2PreparationError("invalid frozen model specification")
        normalized = target.as_posix()
        if normalized in targets:
            raise OmniGen2PreparationError("duplicate model target")
        targets.add(normalized)


def _trusted_private_base() -> Path:
    base = _reject_reparse_ancestors(PRIVATE_BASE, require_leaf=True)
    if not base.is_dir():
        raise OmniGen2PreparationError("private base is unavailable")
    return base.resolve(strict=True)


def _fresh_destination() -> Path:
    base = _trusted_private_base()
    target = PRIVATE_ROOT.absolute()
    if target.parent != base or not SAFE_PRIVATE_CHILD.fullmatch(target.name):
        raise OmniGen2PreparationError("destination must be a direct child of the trusted private base")
    if target.exists() or target.is_symlink() or _is_reparse(target):
        raise OmniGen2PreparationError("destination must be fresh and non-reparse")
    return target


def _owned_staging(path: Path, base: Path, *, must_exist: bool) -> Path:
    absolute = path.absolute()
    if absolute.parent != base or not absolute.name.startswith(f".{PRIVATE_ROOT.name}."):
        raise OmniGen2PreparationError("staging path is not an owned private child")
    if _is_reparse(absolute):
        raise OmniGen2PreparationError("staging path may not be a reparse point")
    if must_exist and not absolute.is_dir():
        raise OmniGen2PreparationError("staging path is unavailable")
    return absolute


def _git(root: Path, *arguments: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-c", f"safe.directory={root}", "-C", str(root), *arguments],
            check=False,
            shell=False,
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise OmniGen2PreparationError(
            "cannot verify the installed ComfyUI checkout"
        ) from exc
    if result.returncode or len(result.stdout) > MAX_GIT_OUTPUT_BYTES:
        raise OmniGen2PreparationError("cannot verify the installed ComfyUI checkout")
    try:
        return result.stdout.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise OmniGen2PreparationError("ComfyUI git output is not UTF-8") from exc


def _inspect_comfy() -> dict[str, Any]:
    root = _reject_reparse_ancestors(COMFY_ROOT, require_leaf=True)
    if not root.is_dir():
        raise OmniGen2PreparationError("installed ComfyUI root is unavailable or reparse-backed")
    root = root.resolve(strict=True)
    head = _git(root, "rev-parse", "HEAD").strip()
    if head != COMFY_COMMIT:
        raise OmniGen2PreparationError("installed ComfyUI commit differs from the frozen pin")
    if _git(root, "status", "--porcelain", "--untracked-files=no").strip():
        raise OmniGen2PreparationError("installed ComfyUI has tracked changes")
    untracked = sorted(
        line[3:]
        for line in _git(root, "status", "--porcelain", "--untracked-files=all").splitlines()
        if line.startswith("?? ")
    )
    files: list[dict[str, Any]] = []
    for relative, expected in CORE_FILES:
        path = root.joinpath(*Path(relative).parts)
        _reject_reparse_ancestors(path, require_leaf=True)
        if not path.is_file():
            raise OmniGen2PreparationError(f"missing or unsafe ComfyUI core file: {relative}")
        observed = _sha256_file(path)
        if observed["sha256"] != expected:
            raise OmniGen2PreparationError(f"ComfyUI core file hash mismatch: {relative}")
        files.append({"path": relative, **observed})
    return {
        "root": str(root),
        "commit": head,
        "tracked_clean": True,
        "untracked_inventory": untracked,
        "critical_files": files,
    }


def _inspect_feasibility() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[4] / FEASIBILITY_PATH
    _reject_reparse_ancestors(path, require_leaf=True)
    if not path.is_file():
        raise OmniGen2PreparationError("frozen feasibility plan is unavailable")
    observed = _sha256_file(path)
    if observed["sha256"] != FEASIBILITY_SHA256:
        raise OmniGen2PreparationError("feasibility plan hash mismatch")
    return {"repo_path": FEASIBILITY_PATH, **observed}


def _source_url(item: dict[str, Any]) -> str:
    quoted = "/".join(
        urllib.parse.quote(part, safe="") for part in str(item["source_path"]).split("/")
    )
    return f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{quoted}"


def _validated_url(value: str) -> urllib.parse.SplitResult:
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise OmniGen2PreparationError("download URL is malformed") from exc
    if (
        parsed.scheme != "https"
        or parsed.hostname not in ALLOWED_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or parsed.fragment
    ):
        raise OmniGen2PreparationError("download URL left the fixed HTTPS host allowlist")
    return parsed


class _PinnedRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        absolute = urllib.parse.urljoin(req.full_url, newurl)
        _validated_url(absolute)
        return super().redirect_request(req, fp, code, msg, headers, absolute)


def _new_opener():
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}), _PinnedRedirectHandler()
    )


def _free_bytes(path: Path) -> int:
    return shutil.disk_usage(path).free


def _remaining(deadline: float) -> float:
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise OmniGen2PreparationError("60-minute preparation deadline expired")
    return seconds


def _validate_safetensors_header(prefix: bytes, expected_bytes: int, item_id: str) -> dict[str, Any]:
    if len(prefix) < 8:
        raise OmniGen2PreparationError(f"safetensors header is truncated: {item_id}")
    header_bytes = int.from_bytes(prefix[:8], "little", signed=False)
    if header_bytes < 2 or header_bytes > MAX_SAFETENSORS_HEADER_BYTES:
        raise OmniGen2PreparationError(f"safetensors header exceeds bound: {item_id}")
    if header_bytes + 8 > expected_bytes or len(prefix) < header_bytes + 8:
        raise OmniGen2PreparationError(f"safetensors header is truncated: {item_id}")
    try:
        header = json.loads(prefix[8:8 + header_bytes].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OmniGen2PreparationError(f"invalid safetensors header: {item_id}") from exc
    tensors = {key: value for key, value in header.items() if key != "__metadata__"} if isinstance(header, dict) else {}
    if not tensors:
        raise OmniGen2PreparationError(f"safetensors header contains no tensors: {item_id}")
    data_bytes = expected_bytes - 8 - header_bytes
    for value in tensors.values():
        if (
            not isinstance(value, dict)
            or not isinstance(value.get("dtype"), str)
            or not isinstance(value.get("shape"), list)
            or not all(isinstance(axis, int) and axis >= 0 for axis in value["shape"])
            or not isinstance(value.get("data_offsets"), list)
            or len(value["data_offsets"]) != 2
            or not all(isinstance(offset, int) for offset in value["data_offsets"])
            or not 0 <= value["data_offsets"][0] <= value["data_offsets"][1] <= data_bytes
        ):
            raise OmniGen2PreparationError(f"invalid safetensors tensor metadata: {item_id}")
    return {"header_bytes": header_bytes, "tensor_count": len(tensors)}


def _download_one(
    opener,
    item: dict[str, Any],
    target: Path,
    *,
    disk_root: Path,
    deadline: float,
) -> dict[str, Any]:
    request_url = _source_url(item)
    _validated_url(request_url)
    request = urllib.request.Request(request_url, headers={"User-Agent": "kb-figment-local-preparer/1"})
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.part")
    expected_bytes = int(item["bytes"])

    def _local(operation, *arguments):
        try:
            return operation(*arguments)
        except OmniGen2PreparationError:
            raise
        except Exception:
            raise OmniGen2PreparationError(f"local write failed: {item['id']}") from None

    try:
        _reject_reparse_ancestors(target.parent, require_leaf=True)
        timeout = min(float(REQUEST_TIMEOUT_SECONDS), _remaining(deadline))
        with opener.open(request, timeout=timeout) as response:
            code = getattr(response, "status", None)
            if code is None and hasattr(response, "getcode"):
                code = response.getcode()
            if code != 200:
                raise OmniGen2PreparationError(f"unexpected HTTP status for {item['id']}")
            final = _validated_url(response.geturl())
            content_length = response.headers.get("Content-Length")
            if content_length is not None:
                try:
                    declared = int(content_length)
                except ValueError as exc:
                    raise OmniGen2PreparationError("invalid Content-Length") from exc
                if declared != expected_bytes:
                    raise OmniGen2PreparationError(f"download byte count mismatch: {item['id']}")
            digest = hashlib.sha256()
            observed = 0
            next_disk_check = DISK_CHECK_INTERVAL_BYTES
            prefix = bytearray()
            declared_header_bytes: int | None = None
            with _local(temporary.open, "xb") as handle:
                while True:
                    _remaining(deadline)
                    block = response.read(READ_BYTES)
                    if not block:
                        break
                    observed += len(block)
                    if observed > expected_bytes:
                        raise OmniGen2PreparationError(f"download exceeds byte pin: {item['id']}")
                    if len(prefix) < MAX_SAFETENSORS_HEADER_BYTES + 8:
                        wanted = MAX_SAFETENSORS_HEADER_BYTES + 8 - len(prefix)
                        prefix.extend(block[:wanted])
                    if declared_header_bytes is None and len(prefix) >= 8:
                        declared_header_bytes = int.from_bytes(prefix[:8], "little", signed=False)
                        if (
                            declared_header_bytes < 2
                            or declared_header_bytes > MAX_SAFETENSORS_HEADER_BYTES
                            or declared_header_bytes + 8 > expected_bytes
                        ):
                            raise OmniGen2PreparationError(
                                f"safetensors header exceeds bound: {item['id']}"
                            )
                    digest.update(block)
                    _local(handle.write, block)
                    if observed >= next_disk_check:
                        if _free_bytes(disk_root) < MIN_REMAINING_FREE_BYTES:
                            raise OmniGen2PreparationError("less than 20 GiB free during download")
                        next_disk_check = observed + DISK_CHECK_INTERVAL_BYTES
                _local(handle.flush)
                _local(os.fsync, handle.fileno())
            if _free_bytes(disk_root) < MIN_REMAINING_FREE_BYTES:
                raise OmniGen2PreparationError("less than 20 GiB free during download")
        actual = digest.hexdigest()
        if observed != expected_bytes:
            raise OmniGen2PreparationError(f"download byte count mismatch: {item['id']}")
        if actual != item["sha256"]:
            raise OmniGen2PreparationError(f"download SHA-256 mismatch: {item['id']}")
        safetensors = _validate_safetensors_header(bytes(prefix), expected_bytes, item["id"])
        _local(os.replace, temporary, target)
        return {
            "id": item["id"],
            "repository": REPOSITORY,
            "revision": REVISION,
            "source_path": item["source_path"],
            "final_host": final.hostname,
            "target": item["target"],
            "bytes": observed,
            "sha256": actual,
            "safetensors": safetensors,
            "component_license": item["component_license"],
        }
    except OmniGen2PreparationError:
        raise
    except Exception:
        raise OmniGen2PreparationError(f"download transport failed: {item['id']}") from None


def _write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
    try:
        with temporary.open("xb") as handle:
            handle.write((json.dumps(receipt, indent=2, sort_keys=True) + "\n").encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _tree_inventory(root: Path) -> dict[str, list[dict[str, Any]] | list[str]]:
    files: list[dict[str, Any]] = []
    directories: list[str] = []
    for current, names, filenames in os.walk(root, topdown=True, followlinks=False):
        directory = Path(current)
        _reject_reparse_ancestors(directory, require_leaf=True)
        for name in names:
            entry = directory / name
            if _is_reparse(entry):
                raise OmniGen2PreparationError("prepared tree contains a reparse directory")
            directories.append(entry.relative_to(root).as_posix())
        for name in filenames:
            entry = directory / name
            if _is_reparse(entry) or not entry.is_file():
                raise OmniGen2PreparationError("prepared tree contains an unsafe file")
            files.append({
                "path": entry.relative_to(root).as_posix(),
                "bytes": entry.stat().st_size,
            })
    return {
        "directories": sorted(directories),
        "files": sorted(files, key=lambda row: row["path"]),
    }


def _failure_code(error: BaseException) -> str:
    if isinstance(error, OmniGen2PreparationError):
        message = str(error)
        known = (
            "deadline expired",
            "host allowlist",
            "HTTP status",
            "Content-Length",
            "byte count mismatch",
            "exceeds byte pin",
            "SHA-256 mismatch",
            "safetensors",
            "free during download",
            "transport failed",
            "local write failed",
            "source changed",
            "final inventory",
        )
        for fragment in known:
            if fragment in message:
                return fragment.replace(" ", "_").replace("-", "_").lower()
        return "bounded_preparation_error"
    return "unexpected_local_error"


def _verify_final_inventory(staging: Path, *, deadline: float) -> dict[str, Any]:
    inventory = _tree_inventory(staging)
    expected_files = sorted([str(item["target"]) for item in MODELS] + ["preparation.json"])
    expected_directories = sorted({Path(str(item["target"])).parts[0] for item in MODELS})
    if (
        [row["path"] for row in inventory["files"]] != expected_files
        or inventory["directories"] != expected_directories
    ):
        raise OmniGen2PreparationError("final inventory differs from the exact three-file layout")
    for item in MODELS:
        _remaining(deadline)
        path = staging.joinpath(*Path(str(item["target"])).parts)
        try:
            observed = _sha256_file(path, expected_bytes=int(item["bytes"]))
        except OmniGen2PreparationError:
            raise OmniGen2PreparationError(
                f"final inventory bytes differ from the pin: {item['id']}"
            ) from None
        if observed["sha256"] != item["sha256"]:
            raise OmniGen2PreparationError(
                f"final inventory SHA-256 differs from the pin: {item['id']}"
            )
    return inventory


def _plan() -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "mode": "plan-only; no writes or network",
        "destination": str(PRIVATE_ROOT),
        "repository": REPOSITORY,
        "revision": REVISION,
        "files": [
            {
                "source_path": item["source_path"],
                "target": item["target"],
                "bytes": item["bytes"],
                "sha256": item["sha256"],
            }
            for item in MODELS
        ],
        "total_bytes": EXPECTED_TOTAL_BYTES,
        "apply_is_preparation_not_admission": True,
        "commercial_deployment_cleared": False,
        "gpu_used": False,
    }


def _run_apply(opener=None) -> Path:
    deadline = time.monotonic() + APPLY_DEADLINE_SECONDS
    _validate_model_specs()
    destination = _fresh_destination()
    base = destination.parent
    if _free_bytes(base) < MIN_START_FREE_BYTES:
        raise OmniGen2PreparationError("less than 35 GiB free before download")
    source_path = Path(__file__).resolve()
    _reject_reparse_ancestors(source_path, require_leaf=True)
    source_before = _sha256_file(source_path)
    feasibility = _inspect_feasibility()
    comfy = _inspect_comfy()
    _remaining(deadline)
    opener = _new_opener() if opener is None else opener
    staging = base / f".{destination.name}.{uuid.uuid4().hex}.staging"
    _owned_staging(staging, base, must_exist=False)
    records: list[dict[str, Any]] = []
    try:
        staging.mkdir()
        _owned_staging(staging, base, must_exist=True)
        for item in MODELS:
            _remaining(deadline)
            target = staging.joinpath(*Path(item["target"]).parts)
            target.parent.mkdir(parents=True, exist_ok=False)
            _reject_reparse_ancestors(target.parent, require_leaf=True)
            records.append(
                _download_one(opener, item, target, disk_root=base, deadline=deadline)
            )
            if _free_bytes(base) < MIN_REMAINING_FREE_BYTES:
                raise OmniGen2PreparationError("less than 20 GiB free during download")
        total = sum(record["bytes"] for record in records)
        if total != EXPECTED_TOTAL_BYTES:
            raise OmniGen2PreparationError("verified payload total differs from the pin")
        source_after = _sha256_file(source_path)
        feasibility_after = _inspect_feasibility()
        if source_after != source_before or feasibility_after != feasibility:
            raise OmniGen2PreparationError("source changed during preparation")
        expected_inventory = [
            {"path": record["target"], "bytes": record["bytes"], "sha256": record["sha256"]}
            for record in records
        ] + [{"path": "preparation.json", "self_describing_receipt": True}]
        receipt = {
            "schema": SCHEMA,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "state": "verified-files; not-admitted",
            "destination": str(destination),
            "source": {"repository": REPOSITORY, "revision": REVISION},
            "files": records,
            "total_bytes": total,
            "feasibility_plan": feasibility,
            "comfyui": comfy,
            "preparer_before": source_before,
            "preparer_after": source_after,
            "expected_final_inventory": expected_inventory,
            "gpu_used": False,
            "model_loaded": False,
            "generation_run": False,
            "admission": False,
            "promotable": False,
            "commercial_deployment_cleared": False,
            "limitation": (
                "Preparation provenance only. Qwen 2.5 VL 3B commercial rights remain "
                "uncleared; a separate reviewed admission is required before any probe."
            ),
        }
        _write_receipt(staging / "preparation.json", receipt)
        _verify_final_inventory(staging, deadline=deadline)
        _remaining(deadline)
        _fresh_destination()
        os.replace(staging, destination)
        return destination
    except Exception as error:
        bounded_error = (
            error
            if isinstance(error, OmniGen2PreparationError)
            else OmniGen2PreparationError("unexpected local preparation failure")
        )
        if staging.exists() and not _is_reparse(staging):
            failure_root = base / f"{destination.name}-failed-{uuid.uuid4().hex}"
            if (failure_root.parent != base or failure_root.exists()
                    or _is_reparse(failure_root)
                    or not SAFE_PRIVATE_CHILD.fullmatch(failure_root.name)):
                raise OmniGen2PreparationError(
                    "preparation failed and a safe retained failure root is unavailable"
                ) from None
            retained_inventory: dict[str, Any] | None
            inventory_error_code: str | None = None
            try:
                retained_inventory = _tree_inventory(staging)
            except Exception:
                retained_inventory = None
                inventory_error_code = "retained_inventory_unavailable"
            failure_receipt = {
                "schema": SCHEMA,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "state": "failed-preparation; retained-for-review",
                "intended_destination": str(destination),
                "retained_root": str(failure_root),
                "source": {"repository": REPOSITORY, "revision": REVISION},
                "error_code": _failure_code(bounded_error),
                "completed_files": records,
                "retained_inventory": retained_inventory,
                "retained_inventory_error_code": inventory_error_code,
                "feasibility_plan": feasibility,
                "comfyui": comfy,
                "preparer_before": source_before,
                "gpu_used": False,
                "model_loaded": False,
                "generation_run": False,
                "admission": False,
                "promotable": False,
                "commercial_deployment_cleared": False,
            }
            try:
                _write_receipt(staging / "preparation-failed.json", failure_receipt)
                os.replace(staging, failure_root)
            except Exception:
                raise OmniGen2PreparationError(
                    "preparation failed and its retained failure root could not be finalized"
                ) from None
        raise bounded_error from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="perform the bounded three-file preparation; default prints the plan only",
    )
    args = parser.parse_args(argv)
    try:
        if not args.apply:
            _validate_model_specs()
            print(json.dumps(_plan(), indent=2, sort_keys=True))
            return 0
        print(_run_apply())
        return 0
    except OmniGen2PreparationError as exc:
        parser.error(str(exc))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
