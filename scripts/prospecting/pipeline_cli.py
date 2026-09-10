"""Private-file CLI for the versioned prospecting intake boundary."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import sqlite3
import stat
import sys
from typing import Any

from .pipeline_service import PipelineError, PipelineService, PipelineStartRequest, ScopeSpec
from .store import open_store


MAX_INPUT_BYTES = 20 * 1024
MAX_JSON_DEPTH = 32
_REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
_FIELDS = frozenset({
    "request_id", "campaign_id", "as_of_date", "funding_stage_min", "funding_stage_max",
    "funding_window_years", "funding_stage_interpretation", "geography", "sector",
    "requested_companies", "requested_people_per_company", "role_families",
    "original_specification", "outreach_goal",
})
_CLI_CODES = frozenset({
    "input_duplicate_key", "input_invalid", "input_json_invalid", "input_json_too_deep",
    "input_schema_invalid", "input_snapshot_required", "input_too_large", "invalid_arguments",
    "store_invalid", "store_private_root_required",
})
_PIPELINE_CODES = frozenset({
    "campaign_missing", "campaign_state_invalid", "invalid_as_of_date", "invalid_campaign_id",
    "invalid_funding_interpretation", "invalid_funding_stage", "invalid_funding_stage_range",
    "invalid_funding_window", "invalid_geography", "invalid_geography_scope",
    "invalid_people_per_company", "invalid_request", "invalid_request_id",
    "invalid_requested_companies", "invalid_role_families", "invalid_sector",
    "invalid_sector_scope", "request_conflict", "run_missing", "store_state_invalid",
    "transaction_active",
})


class CliError(ValueError):
    """A stable-code refusal at the private-file CLI boundary."""


class _Parser(argparse.ArgumentParser):
    def error(self, _message: str) -> None:
        raise CliError("invalid_arguments")


def _unsafe(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & _REPARSE
    )


def _same_identity(left: os.stat_result, right: os.stat_result) -> bool:
    return (left.st_dev, left.st_ino) == (right.st_dev, right.st_ino)


def _safe_existing_file(
    path: Path, code: str, *, expected: os.stat_result | None = None,
) -> tuple[Path, os.stat_result]:
    """Bind an existing regular file without accepting linked path components."""
    try:
        if str(path).startswith(("\\\\", "//")):
            raise OSError
        absolute = Path(os.path.abspath(path))
        current = Path(absolute.anchor)
        parts = absolute.parts[1:]
        for index, component in enumerate(parts):
            current /= component
            info = current.lstat()
            if _unsafe(info):
                raise OSError
            if index != len(parts) - 1 and not stat.S_ISDIR(info.st_mode):
                raise OSError
        before = absolute.lstat()
        if (
            _unsafe(before) or not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
            or (expected is not None and not _same_identity(before, expected))
        ):
            raise OSError
        resolved = absolute.resolve(strict=True)
        if not _same_identity(before, resolved.stat()):
            raise OSError
        return resolved, before
    except (OSError, RuntimeError, ValueError):
        raise CliError(code) from None


def _safe_existing_directory(path: Path, code: str) -> Path:
    try:
        if str(path).startswith(("\\\\", "//")):
            raise OSError
        absolute = Path(os.path.abspath(path))
        current = Path(absolute.anchor)
        for component in absolute.parts[1:]:
            current /= component
            info = current.lstat()
            if _unsafe(info) or not stat.S_ISDIR(info.st_mode):
                raise OSError
        return absolute.resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        raise CliError(code) from None


def _bounded_read(path: Path, limit: int, code: str, too_large_code: str) -> bytes:
    absolute, before = _safe_existing_file(path, code)
    if before.st_size > limit:
        raise CliError(too_large_code)
    try:
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        with os.fdopen(os.open(absolute, flags), "rb") as source:
            opened = os.fstat(source.fileno())
            if (
                _unsafe(opened) or not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1
                or not _same_identity(before, opened)
            ):
                raise OSError
            contents = source.read(limit + 1)
            after = os.fstat(source.fileno())
        named = absolute.lstat()
        if (
            _unsafe(named) or named.st_nlink != 1
            or not _same_identity(opened, after) or not _same_identity(after, named)
            or opened.st_size != after.st_size or opened.st_mtime_ns != after.st_mtime_ns
            or after.st_size != named.st_size or after.st_mtime_ns != named.st_mtime_ns
        ):
            raise OSError
        if len(contents) > limit:
            raise CliError(too_large_code)
        if len(contents) != after.st_size:
            raise OSError
        return contents
    except CliError:
        raise
    except (OSError, ValueError):
        raise CliError(code) from None


def _inside(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def _small_metadata_text(path: Path) -> str:
    try:
        raw = _bounded_read(
            path, 4096, "store_private_root_required", "store_private_root_required",
        )
        return raw.decode("utf-8").strip()
    except (CliError, UnicodeError):
        raise CliError("store_private_root_required") from None


def _shared_repository_root(repo: Path) -> Path | None:
    """Resolve the main checkout from Git metadata without invoking Git or a shell."""
    marker = repo / ".git"
    try:
        if marker.is_dir():
            common = _safe_existing_directory(marker, "store_private_root_required")
        else:
            pointer = _small_metadata_text(marker)
            if not pointer.startswith("gitdir: ") or "\n" in pointer or "\r" in pointer:
                return None
            git_dir = Path(pointer.removeprefix("gitdir: "))
            if not git_dir.is_absolute():
                git_dir = repo / git_dir
            git_dir = _safe_existing_directory(git_dir, "store_private_root_required")
            common_marker = git_dir / "commondir"
            if common_marker.exists():
                common_path = Path(_small_metadata_text(common_marker))
                if not common_path.is_absolute():
                    common_path = git_dir / common_path
                common = _safe_existing_directory(
                    common_path, "store_private_root_required",
                )
            else:
                common = git_dir
        if common.name.casefold() != ".git":
            return None
        return common.parent.resolve(strict=True)
    except (CliError, OSError, RuntimeError, ValueError):
        return None


def _inside_other_checkout(path: Path, private_root: Path) -> bool:
    """Reject stores under nested worktrees within the shared private directory."""
    current = path.parent
    while current != private_root:
        marker = current / ".git"
        try:
            if marker.exists():
                return True
        except OSError:
            return True
        if current.parent == current:
            return True
        current = current.parent
    return False


def _approved_store(path: Path) -> tuple[Path, os.stat_result]:
    store, identity = _safe_existing_file(path, "store_invalid")
    if store.suffix.casefold() != ".sqlite":
        raise CliError("store_invalid")

    repo = Path(__file__).resolve().parents[2]
    if _inside(store, repo):
        relative = store.relative_to(repo)
        if not relative.parts or relative.parts[0].casefold() != "_private":
            raise CliError("store_private_root_required")
        return store, identity

    roots: list[Path] = []
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data and not local_app_data.startswith(("\\\\", "//")):
        try:
            roots.append(_safe_existing_directory(
                Path(local_app_data) / "kb-prospecting", "store_private_root_required",
            ))
        except CliError:
            pass
    shared_repo = _shared_repository_root(repo)
    shared_private: Path | None = None
    if shared_repo is not None:
        try:
            shared_private = _safe_existing_directory(
                shared_repo / "_private", "store_private_root_required",
            )
            roots.append(shared_private)
        except CliError:
            pass

    if not any(_inside(store, root) for root in roots):
        raise CliError("store_private_root_required")
    if shared_private is not None and _inside(store, shared_private) and _inside_other_checkout(
        store, shared_private,
    ):
        raise CliError("store_private_root_required")
    return store, identity


def _reject_duplicate(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise CliError("input_duplicate_key")
        result[key] = value
    return result


def _finite_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise CliError("input_json_invalid")
    return parsed


def _invalid_constant(_value: str) -> None:
    raise CliError("input_json_invalid")


def _reject_excess_depth(contents: bytes) -> None:
    depth = 0
    in_string = False
    escaped = False
    for value in contents:
        if in_string:
            if escaped:
                escaped = False
            elif value == 0x5C:
                escaped = True
            elif value == 0x22:
                in_string = False
            continue
        if value == 0x22:
            in_string = True
        elif value in (0x5B, 0x7B):
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise CliError("input_json_too_deep")
        elif value in (0x5D, 0x7D):
            depth -= 1


def _scope(value: Any) -> ScopeSpec:
    if (
        type(value) is not dict or set(value) != {"mode", "values"}
        or type(value["values"]) is not list
    ):
        raise CliError("input_schema_invalid")
    return ScopeSpec(value["mode"], tuple(value["values"]))


def _request(value: Any) -> PipelineStartRequest:
    if (
        type(value) is not dict or set(value) != _FIELDS
        or type(value["role_families"]) is not list
    ):
        raise CliError("input_schema_invalid")
    return PipelineStartRequest(
        value["request_id"], value["campaign_id"], value["as_of_date"],
        value["funding_stage_min"], value["funding_stage_max"],
        value["funding_window_years"], value["funding_stage_interpretation"],
        _scope(value["geography"]), _scope(value["sector"]),
        value["requested_companies"], value["requested_people_per_company"],
        tuple(value["role_families"]), value["original_specification"],
        value["outreach_goal"],
    )


def _read_input(store: Path, input_path: Path) -> PipelineStartRequest:
    source, _identity = _safe_existing_file(input_path, "input_invalid")
    snapshots = _safe_existing_directory(store.parent / "snapshots", "input_snapshot_required")
    if not _inside(source, snapshots):
        raise CliError("input_snapshot_required")
    contents = _bounded_read(source, MAX_INPUT_BYTES, "input_invalid", "input_too_large")
    _reject_excess_depth(contents)
    try:
        parsed = json.loads(
            contents.decode("utf-8"), object_pairs_hook=_reject_duplicate,
            parse_constant=_invalid_constant, parse_float=_finite_float,
        )
    except CliError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, OverflowError, RecursionError, ValueError):
        raise CliError("input_json_invalid") from None
    return _request(parsed)


def _safe_output(result: object, safe: object) -> dict[str, object]:
    return {
        "run_id": safe.run_id,
        "intake_id": safe.intake_id,
        "intake_revision": safe.intake_revision,
        "intake_hash": safe.intake_hash,
        "campaign_id": safe.campaign_id,
        "campaign_policy_hash": safe.campaign_policy_hash,
        "workflow_id": safe.workflow_id,
        "workflow_version": safe.workflow_version,
        "workflow_hash": safe.workflow_hash,
        "state": safe.state,
        "next_stage": safe.next_stage,
        "pending_fields": list(safe.pending_fields),
        "counts": dict(safe.counts),
        "replayed": result.replayed,
    }


def _error_code(error: BaseException) -> str:
    value = str(error)
    if isinstance(error, CliError) and value in _CLI_CODES:
        return value
    if isinstance(error, PipelineError) and value in _PIPELINE_CODES:
        return value
    return "operation_failed"


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(add_help=False, allow_abbrev=False)
    parser.add_argument("--store", required=True)
    parser.add_argument("--input", required=True)
    try:
        args = parser.parse_args(argv)
        store, identity = _approved_store(Path(args.store))
        request = _read_input(store, Path(args.input))
        store, _identity = _safe_existing_file(store, "store_invalid", expected=identity)
        connection = open_store(store)
        try:
            service = PipelineService(connection)
            result = service.start_or_resume(request)
            safe = service.get_safe_projection(result.run_id)
        finally:
            connection.close()
        sys.stdout.write(
            json.dumps(_safe_output(result, safe), sort_keys=True, separators=(",", ":")) + "\n"
        )
        return 0
    except (CliError, PipelineError) as error:
        code = _error_code(error)
    except (OSError, OverflowError, RecursionError, RuntimeError, sqlite3.Error, TypeError, ValueError):
        code = "operation_failed"
    sys.stderr.write(f"pipeline_cli_error:{code}\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
