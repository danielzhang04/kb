"""Private-file CLI for the durable P23 capture acquisition boundary.

This desktop-only adapter stores, leases and verifies operator capture work for
one saved P15 run through the existing ``CaptureService``.  It never browses,
never launches or connects to a browser, never seeds imports, never calls a
model or provider, and never performs discovery.

Every private value (query text, target URL, captured body text, lease token)
travels only through private JSON files under the selected store's own
``snapshots/`` directory.  Private values are never accepted from process
arguments and are never written to stdout or stderr, including on failure.

``--claim`` persists the lease in SQL first and only then exports the private
packet under ``snapshots/capture-packets`` with a fresh, exclusive, opaque
filename.  When that export fails the committed lease is deliberately left in
place until it expires and is reclaimed: a succeeded SQL claim is never rolled
back by this CLI.
"""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import sys
from typing import Any
import uuid

from .pipeline_cli import (
    CliError,
    _Parser,
    _approved_store,
    _read_private_json,
    _safe_existing_directory,
    _safe_existing_file,
)
from .research_capture_service import (
    MAX_LEASE_SECONDS,
    CaptureClaimRequest,
    CaptureError,
    CaptureFinishRequest,
    CaptureService,
    CaptureSessionRequest,
    CaptureSubmitRequest,
    CaptureTaskRequest,
)
from .source_capture import SourceCaptureError, cleanup_owned, copy_owned
from .store import open_store


MAX_CAPTURE_INPUT_BYTES = 20 * 1024
MAX_PACKET_BYTES = 8 * 1024
PACKET_NAMESPACE = "capture-packets"
_SESSION_FIELDS = frozenset({
    "request_id", "run_id", "expected_intake_hash", "acquisition_skill_hash",
    "task_cap",
})
_TASK_FIELDS = frozenset({"request_id", "session_id", "task_kind", "query", "url"})
_SUBMIT_FIELDS = frozenset({
    "task_id", "lease_token", "body_ref", "source_url", "retrieved_at",
})
_FINISH_FIELDS = frozenset({"task_id", "lease_token", "error_code"})
_CLI_CODES = frozenset({
    "capture_input_duplicate_key", "capture_input_invalid",
    "capture_input_json_invalid", "capture_input_json_too_deep",
    "capture_input_schema_invalid", "capture_input_snapshot_required",
    "capture_input_too_large", "invalid_arguments", "packet_export_failed",
    "store_invalid", "store_private_root_required",
})
_CAPTURE_CODES = frozenset({
    "capture_cleanup_failed", "capture_expired", "capture_missing",
    "duplicate_packet", "input_pending", "intake_stale", "invalid_body_ref",
    "invalid_capture", "invalid_error_code", "invalid_intake_hash",
    "invalid_lease", "invalid_lease_seconds", "invalid_packet", "invalid_request",
    "invalid_request_id", "invalid_run_id", "invalid_session", "invalid_skill_hash",
    "invalid_source_url", "invalid_task_cap", "invalid_task_kind", "invalid_time",
    "invalid_url", "lease_expired", "lease_lost", "pipeline_context_stale",
    "receipt_conflict", "request_conflict", "run_missing", "session_missing",
    "snapshot_store_required", "snapshot_store_unavailable", "source_changed",
    "source_stale", "source_too_large", "source_url_mismatch", "store_busy",
    "store_state_invalid", "task_cap_reached", "task_missing",
    "transaction_active",
})


def _string(value: Any, *, optional: bool = False) -> str | None:
    if optional and value is None:
        return None
    if type(value) is not str:
        raise CliError("capture_input_schema_invalid")
    return value


def _exact(value: Any, fields: frozenset[str]) -> dict[str, Any]:
    if type(value) is not dict or set(value) != set(fields):
        raise CliError("capture_input_schema_invalid")
    return value


def _private_json(store: Path, input_path: Path) -> Any:
    return _read_private_json(
        store, input_path,
        invalid_code="capture_input_invalid",
        snapshot_code="capture_input_snapshot_required",
        too_large_code="capture_input_too_large",
        duplicate_code="capture_input_duplicate_key",
        json_code="capture_input_json_invalid",
        depth_code="capture_input_json_too_deep",
        limit=MAX_CAPTURE_INPUT_BYTES,
    )


def _read_session_start(store: Path, input_path: Path) -> CaptureSessionRequest:
    value = _exact(_private_json(store, input_path), _SESSION_FIELDS)
    if type(value["task_cap"]) is not int:
        raise CliError("capture_input_schema_invalid")
    return CaptureSessionRequest(
        _string(value["request_id"]), _string(value["run_id"]),
        _string(value["expected_intake_hash"]),
        _string(value["acquisition_skill_hash"]), value["task_cap"],
    )


def _read_enqueue(store: Path, input_path: Path) -> CaptureTaskRequest:
    value = _exact(_private_json(store, input_path), _TASK_FIELDS)
    return CaptureTaskRequest(
        _string(value["request_id"]), _string(value["session_id"]),
        _string(value["task_kind"]), _string(value["query"], optional=True),
        _string(value["url"], optional=True),
    )


def _read_submit(store: Path, input_path: Path) -> CaptureSubmitRequest:
    value = _exact(_private_json(store, input_path), _SUBMIT_FIELDS)
    return CaptureSubmitRequest(
        _string(value["task_id"]), _string(value["lease_token"]),
        _string(value["body_ref"]), _string(value["source_url"]),
        _string(value["retrieved_at"]),
    )


def _read_finish(store: Path, input_path: Path) -> CaptureFinishRequest:
    value = _exact(_private_json(store, input_path), _FINISH_FIELDS)
    return CaptureFinishRequest(
        _string(value["task_id"]), _string(value["lease_token"]),
        _string(value["error_code"]),
    )


def _export_packet(root: Path, lease: object) -> str:
    """Write the exact private packet to one fresh exclusive owned file."""
    payload = {
        "task_id": lease.task_id,
        "attempt_id": lease.attempt_id,
        "attempt_no": lease.attempt_no,
        "lease_token": lease.lease_token,
        "lease_epoch": lease.lease_epoch,
        "task_kind": lease.task_kind,
        "expires_at": lease.expires_at,
        "query": lease.packet.get("query"),
        "url": lease.packet.get("url"),
    }
    created: list[tuple[Path, tuple[int, int]]] = []
    try:
        contents = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
        return copy_owned(
            root, namespace=PACKET_NAMESPACE,
            snapshot_id="pkt_" + uuid.uuid4().hex, contents=contents,
            maximum=MAX_PACKET_BYTES, created=created,
        )
    except (SourceCaptureError, OSError, TypeError, UnicodeError, ValueError):
        try:
            cleanup_owned(created)
        except OSError:
            pass
        raise CliError("packet_export_failed") from None


def _session_output(result: object) -> dict[str, object]:
    return {
        "session_id": result.session_id,
        "session_hash": result.session_hash,
        "run_id": result.run_id,
        "intake_hash": result.intake_hash,
        "state": result.state,
        "counts": dict(result.counts),
        "replayed": result.replayed,
    }


def _task_output(result: object) -> dict[str, object]:
    return {
        "task_id": result.task_id,
        "session_id": result.session_id,
        "ordinal": result.ordinal,
        "task_kind": result.task_kind,
        "state": result.state,
        "replayed": result.replayed,
    }


def _status_output(status: object) -> dict[str, object]:
    return {
        "task_id": status.task_id,
        "ordinal": status.ordinal,
        "task_kind": status.task_kind,
        "state": status.state,
        "attempt_count": status.attempt_count,
        "last_error_code": status.last_error_code,
    }


def _receipt_output(receipt: object) -> dict[str, object]:
    return {
        "receipt_id": receipt.receipt_id,
        "task_id": receipt.task_id,
        "attempt_id": receipt.attempt_id,
        "snapshot_id": receipt.snapshot_id,
        "content_sha256": receipt.content_sha256,
        "retrieved_at": receipt.retrieved_at,
        "byte_count": receipt.byte_count,
        "state": receipt.state,
    }


def _progress_output(progress: object) -> dict[str, object]:
    return {
        "session_id": progress.session_id,
        "session_hash": progress.session_hash,
        "run_id": progress.run_id,
        "intake_hash": progress.intake_hash,
        "state": progress.state,
        "counts": dict(progress.counts),
        "tasks": [_status_output(status) for status in progress.tasks],
    }


def _claim_output(
    service: CaptureService, store: Path, session_id: str,
) -> dict[str, object]:
    """Validate the snapshots root, persist the lease, then export the packet.

    The ``snapshots/`` root is resolved and validated *before* the lease is
    committed so that a missing or rejected root never burns a task attempt:
    when the root is unavailable the task is left untouched at its prior
    attempt count (``queued``/``attempt 0`` on a fresh task) and can be
    claimed again, unburned, once the operator repairs the directory.  Only
    after ``claim_task`` has durably committed the lease in SQL is the
    private packet exported; an export failure at that point must never roll
    back the already-committed lease.
    """
    root = _safe_existing_directory(store.parent / "snapshots", "packet_export_failed")
    lease = service.claim_task(CaptureClaimRequest(session_id, MAX_LEASE_SECONDS))
    if lease is None:
        return {
            "session_id": session_id,
            "claimed": False,
            "state": "no_capture_task_available",
        }
    packet_ref = _export_packet(root, lease)
    return {
        "task_id": lease.task_id,
        "attempt_id": lease.attempt_id,
        "attempt_no": lease.attempt_no,
        "lease_epoch": lease.lease_epoch,
        "task_kind": lease.task_kind,
        "expires_at": lease.expires_at,
        "packet_ref": packet_ref,
        "claimed": True,
        "state": "leased",
    }


def _error_code(error: BaseException) -> str:
    value = str(error)
    if isinstance(error, CliError) and value in _CLI_CODES:
        return value
    if isinstance(error, CaptureError) and value in _CAPTURE_CODES:
        return value
    return "operation_failed"


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(add_help=False, allow_abbrev=False)
    parser.add_argument("--store", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--session-start")
    mode.add_argument("--enqueue")
    mode.add_argument("--claim")
    mode.add_argument("--submit")
    mode.add_argument("--finish")
    mode.add_argument("--progress")
    mode.add_argument("--verify")
    try:
        args = parser.parse_args(argv)
        store, identity = _approved_store(Path(args.store))
        session_request = None
        task_request = None
        submit_request = None
        finish_request = None
        if args.session_start is not None:
            session_request = _read_session_start(store, Path(args.session_start))
        elif args.enqueue is not None:
            task_request = _read_enqueue(store, Path(args.enqueue))
        elif args.submit is not None:
            submit_request = _read_submit(store, Path(args.submit))
        elif args.finish is not None:
            finish_request = _read_finish(store, Path(args.finish))
        store, _identity = _safe_existing_file(store, "store_invalid", expected=identity)
        connection = open_store(store)
        try:
            service = CaptureService(connection)
            if session_request is not None:
                output = _session_output(service.start_session(session_request))
            elif task_request is not None:
                output = _task_output(service.enqueue_task(task_request))
            elif args.claim is not None:
                output = _claim_output(service, store, args.claim)
            elif submit_request is not None:
                output = _receipt_output(service.submit_capture(submit_request))
            elif finish_request is not None:
                output = _status_output(service.finish_attempt(finish_request))
            elif args.progress is not None:
                output = _progress_output(service.get_progress(args.progress))
            else:
                output = _receipt_output(service.verify_capture(args.verify))
        finally:
            connection.close()
        sys.stdout.write(
            json.dumps(output, sort_keys=True, separators=(",", ":")) + "\n"
        )
        return 0
    except (CaptureError, CliError) as error:
        code = _error_code(error)
    except (
        OSError, OverflowError, RecursionError, RuntimeError, sqlite3.Error,
        TypeError, ValueError,
    ):
        code = "operation_failed"
    sys.stderr.write(f"capture_cli_error:{code}\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
