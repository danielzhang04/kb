"""Private metadata-only CLI for one persisted P19 qualification stage."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sqlite3
import sys
import uuid

from scripts.prospecting.pipeline_cli import CliError, _approved_store, _safe_existing_file
from scripts.prospecting.personalizer.private_stage_adapter import (
    PrivateStageRuntimeError,
    prepare_stage_adapters,
    take_adapter_cleanup_code,
)
from scripts.prospecting.qualification_service import QualificationError, QualificationService
from scripts.prospecting.store import open_store


_ITEM = re.compile(r"pqit_[0-9a-f]{32}\Z")
_QUALIFICATION_CODES = frozenset({
    "invalid_item_id", "invalid_request_id", "invalid_stage_binding", "lease_expired",
    "lease_lost", "pipeline_context_stale", "qualification_adapter_failed",
    "qualification_adapter_unavailable", "qualification_already_complete",
    "qualification_attempt_failed", "qualification_attempts_exhausted",
    "qualification_conflict", "qualification_context_stale", "qualification_in_progress",
    "qualification_input_invalid", "qualification_input_too_large",
    "qualification_item_missing", "qualification_output_invalid", "request_conflict",
    "snapshot_store_required", "source_changed", "source_stale", "store_state_invalid",
    "transaction_active",
})


class QualificationStageCliError(ValueError):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, _message: str) -> None:
        raise QualificationStageCliError("invalid_arguments")


def _request_id(value: object) -> str:
    if type(value) is not str:
        raise QualificationStageCliError("invalid_request_id")
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, ValueError):
        raise QualificationStageCliError("invalid_request_id") from None
    if parsed.version != 4 or str(parsed) != value:
        raise QualificationStageCliError("invalid_request_id")
    return value


def _safe_item(item: object) -> dict[str, object]:
    return {
        "item_id": item.item_id,
        "state": item.state,
        "candidate_count": item.candidate_count,
        "context_codes": list(item.context_codes),
        "company_outcome": item.company_outcome,
        "person_counts": dict(item.person_counts),
    }


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(add_help=False, allow_abbrev=False)
    parser.add_argument("--store", required=True)
    parser.add_argument("--item-id", required=True)
    parser.add_argument("--request-id", required=True)
    cleanup_code: str | None = None
    qualification_adapter: object | None = None
    try:
        args = parser.parse_args(argv)
        if type(args.item_id) is not str or _ITEM.fullmatch(args.item_id) is None:
            raise QualificationStageCliError("invalid_item_id")
        request_id = _request_id(args.request_id)
        store, identity = _approved_store(Path(args.store))
        store, _ = _safe_existing_file(store, "store_invalid", expected=identity)
        with prepare_stage_adapters(store) as adapters:
            qualification_adapter = adapters["qualification_factcheck"]
            connection = open_store(store)
            try:
                item = QualificationService(
                    connection,
                    adapters={"qualification_factcheck": qualification_adapter},
                ).run_next(args.item_id, request_id)
                output = _safe_item(item)
            finally:
                connection.close()
        sys.stdout.write(json.dumps(output, sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    except QualificationStageCliError as error:
        code = str(error)
    except CliError as error:
        code = str(error) if str(error) in {"store_invalid", "store_private_root_required"} else "operation_failed"
    except PrivateStageRuntimeError as error:
        code = error.code
        cleanup_code = error.cleanup_code
    except QualificationError as error:
        candidate = str(error)
        code = candidate if candidate in _QUALIFICATION_CODES else "operation_failed"
        direct_cleanup = getattr(error, "cleanup_code", None)
        if direct_cleanup in {"runtime_cleanup_failed", "stage_runtime_cleanup_failed"}:
            cleanup_code = direct_cleanup
        elif qualification_adapter is not None:
            cleanup_code = take_adapter_cleanup_code(qualification_adapter)
    except (KeyError, OSError, RuntimeError, sqlite3.Error, TypeError, ValueError) as error:
        code = "operation_failed"
        direct_cleanup = getattr(error, "cleanup_code", None)
        if direct_cleanup in {"runtime_cleanup_failed", "stage_runtime_cleanup_failed"}:
            cleanup_code = direct_cleanup
        elif qualification_adapter is not None:
            cleanup_code = take_adapter_cleanup_code(qualification_adapter)
    sys.stderr.write(f"qualification_stage_cli_error:{code}\n")
    if cleanup_code in {"runtime_cleanup_failed", "stage_runtime_cleanup_failed"}:
        sys.stderr.write(f"qualification_stage_cli_cleanup:{cleanup_code}\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
