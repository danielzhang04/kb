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

from .funding_research_service import (
    CapturedPage,
    CompanyCapture,
    CoverageInput,
    FundingEventInput,
    FundingResearchError,
    FundingResearchRequest,
    FundingResearchService,
)
from .pipeline_service import PipelineError, PipelineService, PipelineStartRequest, ScopeSpec
from .person_research_service import (
    PersonCapture,
    PersonResearchError,
    PersonResearchRequest,
    PersonResearchService,
)
from .store import open_store


MAX_INPUT_BYTES = 20 * 1024
MAX_FUNDING_IMPORT_BYTES = 1024 * 1024
MAX_PERSON_IMPORT_BYTES = 1024 * 1024
MAX_JSON_DEPTH = 32
_REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
_FIELDS = frozenset({
    "request_id", "campaign_id", "as_of_date", "funding_stage_min", "funding_stage_max",
    "funding_window_years", "funding_stage_interpretation", "geography", "sector",
    "requested_companies", "requested_people_per_company", "role_families",
    "original_specification", "outreach_goal",
})
_FUNDING_FIELDS = frozenset({
    "request_id", "run_id", "expected_intake_hash", "predecessor_batch_id",
    "predecessor_hash", "candidates",
})
_CANDIDATE_FIELDS = frozenset({
    "name", "website_url", "location", "sector", "pages", "events",
})
_PAGE_REQUIRED_FIELDS = frozenset({
    "body_ref", "source_url", "source_kind", "captured_at",
})
_COVERAGE_FIELDS = frozenset({
    "query", "searched_at", "status", "result_count", "result_cap",
})
_EVENT_FIELDS = frozenset({"page_ordinal", "stage", "announced_at", "excerpt"})
_PERSON_FIELDS = frozenset({
    "request_id", "run_id", "expected_intake_hash", "funding_batch_id",
    "funding_batch_hash", "predecessor_batch_id", "predecessor_hash",
    "research_result_ids", "candidates",
})
_PERSON_CANDIDATE_FIELDS = frozenset({
    "funding_result_id", "company_id", "first_name", "full_name", "title",
    "profile_url", "source_url", "body_ref", "captured_at",
})
_CLI_CODES = frozenset({
    "funding_import_duplicate_key", "funding_import_invalid",
    "funding_import_json_invalid", "funding_import_json_too_deep",
    "funding_import_schema_invalid", "funding_import_snapshot_required",
    "funding_import_too_large", "funding_projection_missing",
    "input_duplicate_key", "input_invalid", "input_json_invalid", "input_json_too_deep",
    "input_schema_invalid", "input_snapshot_required", "input_too_large", "invalid_arguments",
    "person_import_duplicate_key", "person_import_invalid",
    "person_import_json_invalid", "person_import_json_too_deep",
    "person_import_schema_invalid", "person_import_snapshot_required",
    "person_import_too_large", "person_projection_missing", "person_scope_missing",
    "store_invalid", "store_private_root_required",
})
_FUNDING_CODES = frozenset({
    "batch_too_large", "candidate_pool_too_large", "input_pending",
    "intake_stale", "invalid_body_ref", "invalid_candidate", "invalid_coverage",
    "invalid_funding_event", "invalid_intake_hash", "invalid_page",
    "invalid_predecessor", "invalid_request", "invalid_request_id", "invalid_run_id",
    "invalid_source_kind", "invalid_source_url", "pipeline_context_stale",
    "predecessor_conflict", "request_conflict", "run_missing", "snapshot_store_required",
    "source_changed", "source_stale", "source_too_large", "store_state_invalid",
    "transaction_active",
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
_PERSON_CODES = frozenset({
    "batch_too_large", "candidate_company_mismatch", "candidate_outside_scope",
    "candidate_pool_too_large", "funding_batch_stale", "intake_stale",
    "invalid_body_ref", "invalid_candidate", "invalid_candidates",
    "invalid_funding_batch", "invalid_intake_hash", "invalid_predecessor",
    "invalid_profile_url", "invalid_request", "invalid_request_id",
    "invalid_research_scope", "invalid_run_id", "invalid_source_url",
    "operator_source_store_cap", "operator_source_store_invalid",
    "pipeline_context_stale", "predecessor_conflict", "request_conflict",
    "research_scope_too_large", "snapshot_store_required", "source_changed",
    "source_stale", "source_too_large", "store_state_invalid", "transaction_active",
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


def _reject_duplicate(
    pairs: list[tuple[str, Any]], code: str = "input_duplicate_key",
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise CliError(code)
        result[key] = value
    return result


def _finite_float(value: str, code: str = "input_json_invalid") -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise CliError(code)
    return parsed


def _invalid_constant(_value: str, code: str = "input_json_invalid") -> None:
    raise CliError(code)


def _reject_excess_depth(
    contents: bytes, code: str = "input_json_too_deep",
) -> None:
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
                raise CliError(code)
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


def _read_private_json(
    store: Path,
    input_path: Path,
    *,
    invalid_code: str,
    snapshot_code: str,
    too_large_code: str,
    duplicate_code: str,
    json_code: str,
    depth_code: str,
    limit: int,
) -> Any:
    source, _identity = _safe_existing_file(input_path, invalid_code)
    snapshots = _safe_existing_directory(store.parent / "snapshots", snapshot_code)
    if not _inside(source, snapshots):
        raise CliError(snapshot_code)
    contents = _bounded_read(source, limit, invalid_code, too_large_code)
    _reject_excess_depth(contents, depth_code)
    try:
        return json.loads(
            contents.decode("utf-8"),
            object_pairs_hook=lambda pairs: _reject_duplicate(pairs, duplicate_code),
            parse_constant=lambda value: _invalid_constant(value, json_code),
            parse_float=lambda value: _finite_float(value, json_code),
        )
    except CliError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, OverflowError, RecursionError, ValueError):
        raise CliError(json_code) from None


def _read_input(store: Path, input_path: Path) -> PipelineStartRequest:
    return _request(_read_private_json(
        store, input_path,
        invalid_code="input_invalid", snapshot_code="input_snapshot_required",
        too_large_code="input_too_large", duplicate_code="input_duplicate_key",
        json_code="input_json_invalid", depth_code="input_json_too_deep",
        limit=MAX_INPUT_BYTES,
    ))


def _funding_request(value: Any) -> FundingResearchRequest:
    if type(value) is not dict or set(value) != _FUNDING_FIELDS:
        raise CliError("funding_import_schema_invalid")
    candidates_value = value["candidates"]
    if type(candidates_value) is not list:
        raise CliError("funding_import_schema_invalid")
    candidates: list[CompanyCapture] = []
    for candidate_value in candidates_value:
        if (
            type(candidate_value) is not dict
            or set(candidate_value) != _CANDIDATE_FIELDS
            or type(candidate_value["pages"]) is not list
            or type(candidate_value["events"]) is not list
        ):
            raise CliError("funding_import_schema_invalid")
        pages: list[CapturedPage] = []
        for page_value in candidate_value["pages"]:
            if type(page_value) is not dict or frozenset(page_value) not in {
                _PAGE_REQUIRED_FIELDS, _PAGE_REQUIRED_FIELDS | {"coverage"},
            }:
                raise CliError("funding_import_schema_invalid")
            coverage_value = page_value.get("coverage")
            coverage = None
            if "coverage" in page_value:
                if type(coverage_value) is not dict or set(coverage_value) != _COVERAGE_FIELDS:
                    raise CliError("funding_import_schema_invalid")
                coverage = CoverageInput(
                    coverage_value["query"], coverage_value["searched_at"],
                    coverage_value["status"], coverage_value["result_count"],
                    coverage_value["result_cap"],
                )
            pages.append(CapturedPage(
                page_value["body_ref"], page_value["source_url"],
                page_value["source_kind"], page_value["captured_at"], coverage,
            ))
        events: list[FundingEventInput] = []
        for event_value in candidate_value["events"]:
            if type(event_value) is not dict or set(event_value) != _EVENT_FIELDS:
                raise CliError("funding_import_schema_invalid")
            events.append(FundingEventInput(
                event_value["page_ordinal"], event_value["stage"],
                event_value["announced_at"], event_value["excerpt"],
            ))
        candidates.append(CompanyCapture(
            candidate_value["name"], candidate_value["website_url"],
            candidate_value["location"], candidate_value["sector"],
            tuple(pages), tuple(events),
        ))
    return FundingResearchRequest(
        value["request_id"], value["run_id"], value["expected_intake_hash"],
        value["predecessor_batch_id"], value["predecessor_hash"], tuple(candidates),
    )


def _read_funding_import(store: Path, input_path: Path) -> FundingResearchRequest:
    return _funding_request(_read_private_json(
        store, input_path,
        invalid_code="funding_import_invalid",
        snapshot_code="funding_import_snapshot_required",
        too_large_code="funding_import_too_large",
        duplicate_code="funding_import_duplicate_key",
        json_code="funding_import_json_invalid",
        depth_code="funding_import_json_too_deep",
        limit=MAX_FUNDING_IMPORT_BYTES,
    ))


def _person_request(value: Any) -> PersonResearchRequest:
    if type(value) is not dict or set(value) != _PERSON_FIELDS:
        raise CliError("person_import_schema_invalid")
    candidates_value = value["candidates"]
    result_ids = value["research_result_ids"]
    if type(candidates_value) is not list or type(result_ids) is not list:
        raise CliError("person_import_schema_invalid")
    candidates: list[PersonCapture] = []
    for candidate_value in candidates_value:
        if type(candidate_value) is not dict or set(candidate_value) != _PERSON_CANDIDATE_FIELDS:
            raise CliError("person_import_schema_invalid")
        candidates.append(PersonCapture(
            candidate_value["funding_result_id"], candidate_value["company_id"],
            candidate_value["first_name"], candidate_value["full_name"],
            candidate_value["title"], candidate_value["profile_url"],
            candidate_value["source_url"], candidate_value["body_ref"],
            candidate_value["captured_at"],
        ))
    return PersonResearchRequest(
        value["request_id"], value["run_id"], value["expected_intake_hash"],
        value["funding_batch_id"], value["funding_batch_hash"],
        value["predecessor_batch_id"], value["predecessor_hash"],
        tuple(result_ids), tuple(candidates),
    )


def _read_person_import(store: Path, input_path: Path) -> PersonResearchRequest:
    return _person_request(_read_private_json(
        store, input_path,
        invalid_code="person_import_invalid",
        snapshot_code="person_import_snapshot_required",
        too_large_code="person_import_too_large",
        duplicate_code="person_import_duplicate_key",
        json_code="person_import_json_invalid",
        depth_code="person_import_json_too_deep",
        limit=MAX_PERSON_IMPORT_BYTES,
    ))


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


def _safe_funding_import_output(
    result: object, request: FundingResearchRequest,
) -> dict[str, object]:
    return {
        "batch_id": result.batch_id,
        "batch_hash": result.batch_hash,
        "run_id": result.run_id,
        "intake_hash": request.expected_intake_hash,
        "state": result.state,
        "counts": dict(result.counts),
        "replayed": result.replayed,
    }


def _safe_funding_projection_output(safe: object) -> dict[str, object]:
    return {
        "batch_id": safe.batch_id,
        "batch_hash": safe.batch_hash,
        "run_id": safe.run_id,
        "intake_hash": safe.intake_hash,
        "state": safe.state,
        "counts": dict(safe.counts),
    }


def _safe_person_import_output(
    result: object, request: PersonResearchRequest,
) -> dict[str, object]:
    return {
        "batch_id": result.batch_id,
        "batch_hash": result.batch_hash,
        "run_id": result.run_id,
        "intake_hash": request.expected_intake_hash,
        "funding_batch_id": request.funding_batch_id,
        "funding_batch_hash": request.funding_batch_hash,
        "state": result.state,
        "counts": dict(result.counts),
        "replayed": result.replayed,
    }


def _safe_person_projection_output(safe: object) -> dict[str, object]:
    return {
        "batch_id": safe.batch_id,
        "batch_hash": safe.batch_hash,
        "run_id": safe.run_id,
        "intake_hash": safe.intake_hash,
        "funding_batch_id": safe.funding_batch_id,
        "funding_batch_hash": safe.funding_batch_hash,
        "state": safe.state,
        "counts": dict(safe.counts),
    }


def _safe_person_scope_output(projection: object) -> dict[str, object]:
    return {
        "run_id": projection.run_id,
        "intake_hash": projection.intake_hash,
        "funding_batch_id": projection.batch_id,
        "funding_batch_hash": projection.batch_hash,
        "state": "provisional_person_research_scope",
        "requested_company_cap": projection.desired_companies,
        "companies": [
            {
                "ordinal": company.ordinal,
                "funding_result_id": company.result_id,
                "company_id": company.company_id,
            }
            for company in projection.companies
            if company.rule_outcome == "provisional_match" and company.company_id is not None
        ],
    }


def _error_code(error: BaseException) -> str:
    value = str(error)
    if isinstance(error, CliError) and value in _CLI_CODES:
        return value
    if isinstance(error, PipelineError) and value in _PIPELINE_CODES:
        return value
    if isinstance(error, FundingResearchError) and value in _FUNDING_CODES:
        return value
    if isinstance(error, PersonResearchError) and value in _PERSON_CODES:
        return value
    return "operation_failed"


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(add_help=False, allow_abbrev=False)
    parser.add_argument("--store", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--input")
    mode.add_argument("--funding-import")
    mode.add_argument("--funding-project")
    mode.add_argument("--person-import")
    mode.add_argument("--person-project")
    mode.add_argument("--person-scope")
    try:
        args = parser.parse_args(argv)
        store, identity = _approved_store(Path(args.store))
        request = None
        funding_request = None
        person_request = None
        if args.input is not None:
            request = _read_input(store, Path(args.input))
        elif args.funding_import is not None:
            funding_request = _read_funding_import(store, Path(args.funding_import))
        elif args.person_import is not None:
            person_request = _read_person_import(store, Path(args.person_import))
        store, _identity = _safe_existing_file(store, "store_invalid", expected=identity)
        connection = open_store(store)
        try:
            if request is not None:
                service = PipelineService(connection)
                result = service.start_or_resume(request)
                safe = service.get_safe_projection(result.run_id)
                output = _safe_output(result, safe)
            elif funding_request is not None or args.funding_project is not None:
                funding = FundingResearchService(connection)
                if funding_request is not None:
                    result = funding.import_and_classify(funding_request)
                    output = _safe_funding_import_output(result, funding_request)
                else:
                    safe = funding.get_safe_projection(args.funding_project)
                    if safe is None:
                        raise CliError("funding_projection_missing")
                    output = _safe_funding_projection_output(safe)
            elif args.person_scope is not None:
                projection = FundingResearchService(connection).get_projection(
                    args.person_scope,
                )
                if projection is None:
                    raise CliError("person_scope_missing")
                output = _safe_person_scope_output(projection)
            else:
                people = PersonResearchService(connection)
                if person_request is not None:
                    result = people.import_current_people(person_request)
                    output = _safe_person_import_output(result, person_request)
                else:
                    safe = people.get_safe_projection(args.person_project)
                    if safe is None:
                        raise CliError("person_projection_missing")
                    output = _safe_person_projection_output(safe)
        finally:
            connection.close()
        sys.stdout.write(
            json.dumps(output, sort_keys=True, separators=(",", ":")) + "\n"
        )
        return 0
    except (CliError, FundingResearchError, PersonResearchError, PipelineError) as error:
        code = _error_code(error)
    except (OSError, OverflowError, RecursionError, RuntimeError, sqlite3.Error, TypeError, ValueError):
        code = "operation_failed"
    sys.stderr.write(f"pipeline_cli_error:{code}\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
