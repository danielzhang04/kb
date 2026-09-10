"""Private metadata-only CLI for one persisted P16 model stage."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sqlite3
import sys
import uuid

from scripts.prospecting.pipeline_cli import _approved_store, _safe_existing_file
from scripts.prospecting.pipeline_stage_service import PipelineStageError, PipelineStageService
from scripts.prospecting.personalizer.private_stage_adapter import (
    PrivateStageRuntimeError,
    prepare_stage_adapters,
    run_diagnostic_preflight,
)
from scripts.prospecting.store import open_store


_ITEM = re.compile(r"item-[0-9a-f]{32}\Z")


class StageCliError(ValueError):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, _message: str) -> None:
        raise StageCliError("invalid_arguments")


def _request_id(value: object) -> str:
    if type(value) is not str:
        raise StageCliError("invalid_request_id")
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, ValueError):
        raise StageCliError("invalid_request_id") from None
    if str(parsed) != value:
        raise StageCliError("invalid_request_id")
    return value


def _safe_preflight(result: object) -> dict[str, object]:
    return {
        "status": result.status, "code": result.code,
        "bundle_sha256": result.bundle_sha256,
        "executable_sha256": result.executable_sha256,
        "cli_version": result.cli_version,
        "requested_model": result.requested_model,
        "responding_model_verified": result.responding_model_verified,
        "event_policy_sha256": result.event_policy_sha256,
        "elapsed_ms": result.elapsed_ms, "cleanup_state": result.cleanup_state,
        "authorizes_later_process": False,
    }


def _safe_stage(item: object) -> dict[str, object]:
    return {
        "item_id": item.item_id, "state": item.state,
        "next_stage": item.next_stage, "repair_cycle": item.repair_cycle,
    }


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(add_help=False, allow_abbrev=False)
    parser.add_argument("--store", required=True)
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--item-id")
    parser.add_argument("--request-id")
    cleanup_code: str | None = None
    try:
        args = parser.parse_args(argv)
        diagnostic = bool(args.preflight)
        stage = args.item_id is not None or args.request_id is not None
        if diagnostic == stage:
            raise StageCliError("invalid_arguments")
        store, identity = _approved_store(Path(args.store))
        store, _ = _safe_existing_file(store, "store_invalid", expected=identity)
        if diagnostic:
            output = _safe_preflight(run_diagnostic_preflight(store))
        else:
            if type(args.item_id) is not str or _ITEM.fullmatch(args.item_id) is None:
                raise StageCliError("invalid_item_id")
            request_id = _request_id(args.request_id)
            with prepare_stage_adapters(store) as adapters:
                connection = open_store(store)
                try:
                    item = PipelineStageService(connection, adapters=adapters).run_next(
                        args.item_id, request_id,
                    )
                    output = _safe_stage(item)
                finally:
                    connection.close()
        sys.stdout.write(json.dumps(output, sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    except StageCliError as error:
        code = str(error)
    except PrivateStageRuntimeError as error:
        code = error.code
        cleanup_code = error.cleanup_code
    except PipelineStageError as error:
        code = error.code
        cleanup_code = getattr(error, "cleanup_code", None)
    except (OSError, RuntimeError, sqlite3.Error, TypeError, ValueError):
        code = "operation_failed"
    sys.stderr.write(f"pipeline_stage_cli_error:{code}\n")
    if cleanup_code in {"runtime_cleanup_failed", "stage_runtime_cleanup_failed"}:
        sys.stderr.write(f"pipeline_stage_cli_cleanup:{cleanup_code}\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
