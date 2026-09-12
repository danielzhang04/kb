"""Validation primitives for temporary, source-only development jobs.

Callers own and quiesce ``root`` while these checks run.  The checks reject
links and reparse points, but they are not a substitute for an OS sandbox: a
hostile process that can rename ancestors concurrently can still create a
TOCTOU race.  Roots must therefore be local directories owned by the caller.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import stat
import unicodedata


SCHEMA_VERSION = 1
MAX_PATH_BYTES = 240
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024

_DIGEST_RE = re.compile(r"[0-9a-f]{64}\Z")
_FORBIDDEN_COMPONENTS = frozenset({".git", ".ssh", ".credentials"})
_WINDOWS_DEVICES = frozenset(
    {"aux", "con", "nul", "prn", "clock$"}
    | {f"com{number}" for number in range(1, 10)}
    | {f"lpt{number}" for number in range(1, 10)}
)
_REPARSE_FLAG = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


class DevJobValidationError(ValueError):
    """A fail-closed validation error whose message is a non-sensitive code."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str) -> None:
    raise DevJobValidationError(code)


def validate_relative(value: object) -> str:
    """Return a canonical portable relative POSIX file path."""

    if type(value) is not str or not value:
        _fail("path_invalid")
    try:
        encoded = value.encode("utf-8")
    except UnicodeError:
        _fail("path_invalid")
    if len(encoded) > MAX_PATH_BYTES:
        _fail("path_too_long")
    if value.startswith("/") or "\\" in value or ":" in value:
        _fail("path_invalid")
    if any(unicodedata.category(character).startswith("C") for character in value):
        _fail("path_invalid")

    components = value.split("/")
    if any(not component or component in {".", ".."} for component in components):
        _fail("path_invalid")
    for component in components:
        folded = component.casefold()
        if (
            folded in _FORBIDDEN_COMPONENTS
            or (folded.startswith(".env") and folded != ".env.example")
        ):
            _fail("path_forbidden")
        if component[-1] in {" ", "."}:
            _fail("path_invalid")
        if folded.split(".", 1)[0] in _WINDOWS_DEVICES:
            _fail("path_invalid")
    return value


def _require_path_list(value: object, *, empty_ok: bool = False) -> list[str]:
    if type(value) is not list or (not value and not empty_ok):
        _fail("path_list_invalid")
    paths = [validate_relative(item) for item in value]
    folded = [item.casefold() for item in paths]
    if len(set(folded)) != len(folded):
        _fail("path_duplicate")
    return paths


def _is_reparse(file_stat: os.stat_result) -> bool:
    attributes = getattr(file_stat, "st_file_attributes", 0)
    return bool(attributes & _REPARSE_FLAG)


def _safe_lstat(path: Path, *, missing_ok: bool = False) -> os.stat_result | None:
    try:
        return path.lstat()
    except FileNotFoundError:
        if missing_ok:
            return None
        _fail("file_missing")
    except (OSError, ValueError):
        _fail("file_access")


def _check_root(root: Path, *, missing_ok: bool = False) -> bool:
    try:
        absolute = Path(os.path.abspath(root))
    except (OSError, TypeError, ValueError):
        _fail("root_invalid")
    components = absolute.parts[1:]
    current = Path(absolute.anchor)
    if not components:
        components = absolute.parts
        current = Path()
    for component in components:
        current = current / component
        root_stat = _safe_lstat(current, missing_ok=missing_ok)
        if root_stat is None:
            return False
        if stat.S_ISLNK(root_stat.st_mode) or _is_reparse(root_stat):
            _fail("root_unsafe")
        if not stat.S_ISDIR(root_stat.st_mode):
            _fail("root_invalid")
    return True


def _leaf_stat(root: Path, relative: str, *, missing_ok: bool = False) -> tuple[Path, os.stat_result] | None:
    _check_root(root)
    target = root
    components = relative.split("/")
    for component in components[:-1]:
        target = target / component
        ancestor = _safe_lstat(target, missing_ok=missing_ok)
        if ancestor is None:
            return None
        if stat.S_ISLNK(ancestor.st_mode) or _is_reparse(ancestor):
            _fail("path_unsafe")
        if not stat.S_ISDIR(ancestor.st_mode):
            _fail("path_invalid")

    target = target / components[-1]
    leaf = _safe_lstat(target, missing_ok=missing_ok)
    if leaf is None:
        return None
    if stat.S_ISLNK(leaf.st_mode) or _is_reparse(leaf):
        _fail("file_unsafe")
    return target, leaf


def _regular_stat(root: Path, relative: str, *, missing_ok: bool = False) -> tuple[Path, os.stat_result] | None:
    item = _leaf_stat(root, relative, missing_ok=missing_ok)
    if item is None:
        return None
    target, file_stat = item
    if not stat.S_ISREG(file_stat.st_mode):
        _fail("file_type")
    if file_stat.st_nlink != 1:
        _fail("file_links")
    return target, file_stat


def _same_file(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        left.st_dev,
        left.st_ino,
        left.st_size,
        left.st_mtime_ns,
    ) == (
        right.st_dev,
        right.st_ino,
        right.st_size,
        right.st_mtime_ns,
    )


def _metadata(root: Path, relative: str, max_file_bytes: int) -> dict[str, object]:
    checked = _regular_stat(root, relative)
    assert checked is not None
    target, before = checked
    if before.st_size > max_file_bytes:
        _fail("file_oversize")

    digest = hashlib.sha256()
    count = 0
    try:
        with target.open("rb") as source:
            opened = os.fstat(source.fileno())
            if (
                not _same_file(before, opened)
                or not stat.S_ISREG(opened.st_mode)
                or opened.st_nlink != 1
                or _is_reparse(opened)
            ):
                _fail("file_changed")
            while True:
                chunk = source.read(128 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                if count > max_file_bytes:
                    _fail("file_oversize")
                digest.update(chunk)
            after = os.fstat(source.fileno())
    except DevJobValidationError:
        raise
    except (OSError, ValueError):
        _fail("file_access")
    if not _same_file(opened, after) or count != after.st_size:
        _fail("file_changed")
    return {"path": relative, "sha256": digest.hexdigest(), "size": count}


def snapshot(root: str | os.PathLike[str], files: object, allowed_outputs: object) -> dict[str, object]:
    """Hash an explicit source allowlist and capture allowed-output baselines."""

    input_paths = _require_path_list(files)
    output_paths = _require_path_list(allowed_outputs)
    try:
        base_root = Path(root)
    except (TypeError, ValueError):
        _fail("root_invalid")
    _check_root(base_root)

    inputs: list[dict[str, object]] = []
    total = 0
    for relative in sorted(input_paths):
        item = _metadata(base_root, relative, MAX_FILE_BYTES)
        total += int(item["size"])
        if total > MAX_TOTAL_BYTES:
            _fail("total_oversize")
        inputs.append(item)
    input_by_path = {item["path"]: item for item in inputs}

    output_base: dict[str, object] = {}
    for relative in sorted(output_paths):
        existing = _regular_stat(base_root, relative, missing_ok=True)
        if existing is None:
            output_base[relative] = None
            continue
        if relative not in input_by_path:
            _fail("output_not_input")
        source_meta = input_by_path[relative]
        output_base[relative] = {
            "sha256": source_meta["sha256"],
            "size": source_meta["size"],
        }

    return {
        "version": SCHEMA_VERSION,
        "inputs": inputs,
        "allowed_outputs": sorted(output_paths),
        "output_base": output_base,
        "limits": {
            "max_file_bytes": MAX_FILE_BYTES,
            "max_total_bytes": MAX_TOTAL_BYTES,
        },
    }


def _exact_dict(value: object, keys: set[str], code: str) -> dict[str, object]:
    if type(value) is not dict or set(value) != keys:
        _fail(code)
    return value


def _validate_size(value: object, maximum: int) -> int:
    if type(value) is not int or value < 0 or value > maximum:
        _fail("size_invalid")
    return value


def _validate_digest(value: object) -> str:
    if type(value) is not str or _DIGEST_RE.fullmatch(value) is None:
        _fail("digest_invalid")
    return value


def validate_manifest(manifest: object) -> dict[str, object]:
    """Validate and return a normalized copy of a development-job manifest."""

    value = _exact_dict(
        manifest,
        {"version", "inputs", "allowed_outputs", "output_base", "limits"},
        "manifest_schema",
    )
    if type(value["version"]) is not int or value["version"] != SCHEMA_VERSION:
        _fail("manifest_version")

    limits = _exact_dict(value["limits"], {"max_file_bytes", "max_total_bytes"}, "limits_schema")
    max_file = limits["max_file_bytes"]
    max_total = limits["max_total_bytes"]
    if (
        type(max_file) is not int
        or type(max_total) is not int
        or max_file <= 0
        or max_total <= 0
        or max_file > MAX_FILE_BYTES
        or max_total > MAX_TOTAL_BYTES
        or max_file > max_total
    ):
        _fail("limits_invalid")

    raw_inputs = value["inputs"]
    if type(raw_inputs) is not list or not raw_inputs:
        _fail("inputs_invalid")
    inputs: list[dict[str, object]] = []
    input_paths: list[str] = []
    input_total = 0
    for raw_item in raw_inputs:
        item = _exact_dict(raw_item, {"path", "sha256", "size"}, "input_schema")
        relative = validate_relative(item["path"])
        size = _validate_size(item["size"], max_file)
        normalized = {"path": relative, "sha256": _validate_digest(item["sha256"]), "size": size}
        input_total += size
        if input_total > max_total:
            _fail("total_oversize")
        input_paths.append(relative)
        inputs.append(normalized)
    if len({path.casefold() for path in input_paths}) != len(input_paths):
        _fail("path_duplicate")

    output_paths = _require_path_list(value["allowed_outputs"])
    raw_base = value["output_base"]
    if type(raw_base) is not dict or not raw_base:
        _fail("output_base_invalid")
    try:
        base_keys = [validate_relative(key) for key in raw_base]
    except TypeError:
        _fail("output_base_invalid")
    if set(base_keys) != set(output_paths) or len(base_keys) != len(output_paths):
        _fail("output_base_invalid")

    input_map = {item["path"]: item for item in inputs}
    output_base: dict[str, object] = {}
    for relative in sorted(output_paths):
        raw_meta = raw_base[relative]
        if raw_meta is None:
            if relative in input_map:
                _fail("output_base_invalid")
            output_base[relative] = None
            continue
        meta = _exact_dict(raw_meta, {"sha256", "size"}, "output_meta_schema")
        normalized_meta = {
            "sha256": _validate_digest(meta["sha256"]),
            "size": _validate_size(meta["size"], max_file),
        }
        source_meta = input_map.get(relative)
        if source_meta is None or normalized_meta != {
            "sha256": source_meta["sha256"],
            "size": source_meta["size"],
        }:
            _fail("output_base_invalid")
        output_base[relative] = normalized_meta

    return {
        "version": SCHEMA_VERSION,
        "inputs": sorted(inputs, key=lambda item: str(item["path"])),
        "allowed_outputs": sorted(output_paths),
        "output_base": output_base,
        "limits": {"max_file_bytes": max_file, "max_total_bytes": max_total},
    }


def _scan_outputs(root: Path, allowed: set[str]) -> list[str]:
    if not _check_root(root, missing_ok=True):
        return []
    permitted_dirs = {""}
    for relative in allowed:
        components = relative.split("/")
        permitted_dirs.update("/".join(components[:end]) for end in range(1, len(components)))

    found: list[str] = []
    pending: list[tuple[Path, str]] = [(root, "")]
    while pending:
        directory, prefix = pending.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError:
            _fail("output_access")
        for entry in entries:
            relative = f"{prefix}/{entry.name}" if prefix else entry.name
            validate_relative(relative)
            try:
                entry_stat = entry.stat(follow_symlinks=False)
            except OSError:
                _fail("output_access")
            if stat.S_ISLNK(entry_stat.st_mode) or _is_reparse(entry_stat):
                _fail("output_unsafe")
            if stat.S_ISDIR(entry_stat.st_mode):
                if relative not in permitted_dirs:
                    _fail("output_unexpected")
                pending.append((Path(entry.path), relative))
            elif stat.S_ISREG(entry_stat.st_mode):
                if relative not in allowed:
                    _fail("output_unexpected")
                found.append(relative)
            else:
                _fail("output_type")
    return sorted(found)


def validate_outputs(output_root: str | os.PathLike[str], manifest: object) -> list[dict[str, object]]:
    """Validate collected outputs and return metadata for allowed changed files."""

    normalized = validate_manifest(manifest)
    try:
        root = Path(output_root)
    except (TypeError, ValueError):
        _fail("root_invalid")
    allowed = set(normalized["allowed_outputs"])
    paths = _scan_outputs(root, allowed)
    max_file = normalized["limits"]["max_file_bytes"]
    max_total = normalized["limits"]["max_total_bytes"]
    total = 0
    changed: list[dict[str, object]] = []
    for relative in paths:
        item = _metadata(root, relative, max_file)
        total += int(item["size"])
        if total > max_total:
            _fail("total_oversize")
        baseline = normalized["output_base"][relative]
        if baseline is None or (
            item["sha256"] != baseline["sha256"] or item["size"] != baseline["size"]
        ):
            changed.append(item)
    return changed


def verify_local_base(
    root: str | os.PathLike[str], manifest: object, output_paths: object
) -> None:
    """Refuse stale local targets before a caller applies already-validated outputs."""

    normalized = validate_manifest(manifest)
    requested = _require_path_list(output_paths, empty_ok=True)
    allowed = set(normalized["allowed_outputs"])
    if not set(requested).issubset(allowed):
        _fail("output_unexpected")
    try:
        base_root = Path(root)
    except (TypeError, ValueError):
        _fail("root_invalid")
    _check_root(base_root)

    max_file = normalized["limits"]["max_file_bytes"]
    for relative in requested:
        baseline = normalized["output_base"][relative]
        current = _regular_stat(base_root, relative, missing_ok=True)
        if baseline is None:
            if current is not None:
                _fail("base_stale")
            continue
        if current is None:
            _fail("base_stale")
        item = _metadata(base_root, relative, max_file)
        if item["sha256"] != baseline["sha256"] or item["size"] != baseline["size"]:
            _fail("base_stale")


__all__ = [
    "DevJobValidationError",
    "MAX_FILE_BYTES",
    "MAX_PATH_BYTES",
    "MAX_TOTAL_BYTES",
    "SCHEMA_VERSION",
    "snapshot",
    "validate_manifest",
    "validate_outputs",
    "validate_relative",
    "verify_local_base",
]
