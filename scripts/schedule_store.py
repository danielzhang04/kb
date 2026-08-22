"""Bounded Unix-socket client for the dashboard schedule authority.

The daemon owns the writer lease and returns raw rows/claim receipts. This
client never decides due time; ``dispatch.py`` remains the only firing clock.
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
from pathlib import Path

PROTOCOL_VERSION = 1
DEFAULT_SOCKET_PATH = Path("/run/kb-dashboard/schedules.sock")
DEFAULT_TIMEOUT_SECONDS = 5.0
MAX_RESPONSE_BYTES = 1024 * 1024


class ScheduleStoreError(RuntimeError):
    def __init__(self, code: str, detail: str | None = None):
        super().__init__(detail or code)
        self.code = code


def _round_trip(socket_path: str | Path, payload: dict,
                timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict:
    encoded = (json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    if len(encoded) > 64 * 1024:
        raise ScheduleStoreError("schedule-request-too-large")
    if not hasattr(socket, "AF_UNIX"):
        raise ScheduleStoreError("schedule-socket-unavailable", "Unix sockets are unavailable")
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(timeout)
            client.connect(str(socket_path))
            client.sendall(encoded)
            chunks = bytearray()
            while b"\n" not in chunks:
                chunk = client.recv(min(64 * 1024, MAX_RESPONSE_BYTES + 1 - len(chunks)))
                if not chunk:
                    break
                chunks.extend(chunk)
                if len(chunks) > MAX_RESPONSE_BYTES:
                    raise ScheduleStoreError("schedule-response-too-large")
    except ScheduleStoreError:
        raise
    except (OSError, TimeoutError) as error:
        raise ScheduleStoreError("schedule-socket-unavailable", str(error)) from error
    line, _, _rest = bytes(chunks).partition(b"\n")
    try:
        response = json.loads(line)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ScheduleStoreError("schedule-response-invalid") from error
    if not isinstance(response, dict) or response.get("version") != PROTOCOL_VERSION:
        raise ScheduleStoreError("schedule-response-invalid")
    if response.get("ok") is not True:
        code = response.get("error")
        raise ScheduleStoreError(code if isinstance(code, str) else "schedule-request-refused")
    return response


def snapshot(socket_path: str | Path = DEFAULT_SOCKET_PATH,
             timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict:
    response = _round_trip(socket_path, {"version": PROTOCOL_VERSION, "operation": "snapshot"}, timeout)
    value = response.get("snapshot")
    if not isinstance(value, dict) or not isinstance(value.get("collectionRevision"), int) or not isinstance(value.get("schedules"), list):
        raise ScheduleStoreError("schedule-response-invalid")
    return value


def claim(socket_path: str | Path, *, schedule_id: str, scheduled_for: str,
          next_at: str, expected_version: int, idempotency_key: str,
          timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict:
    response = _round_trip(socket_path, {
        "version": PROTOCOL_VERSION,
        "operation": "claim",
        "scheduleId": schedule_id,
        "scheduledFor": scheduled_for,
        "nextAt": next_at,
        "expectedVersion": expected_version,
        "idempotencyKey": idempotency_key,
    }, timeout)
    value = response.get("claim")
    if not isinstance(value, dict):
        raise ScheduleStoreError("schedule-response-invalid")
    return value


def advance(socket_path: str | Path, *, schedule_id: str, scheduled_for: str,
            next_at: str, phase: str, idempotency_key: str,
            timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict:
    if phase not in ("card-saved", "ledger-appended"):
        raise ScheduleStoreError("schedule-phase-invalid")
    response = _round_trip(socket_path, {
        "version": PROTOCOL_VERSION,
        "operation": "advance",
        "scheduleId": schedule_id,
        "scheduledFor": scheduled_for,
        "nextAt": next_at,
        "phase": phase,
        "idempotencyKey": idempotency_key,
    }, timeout)
    value = response.get("claim")
    if not isinstance(value, dict):
        raise ScheduleStoreError("schedule-response-invalid")
    return value


def complete(socket_path: str | Path, *, schedule_id: str, scheduled_for: str,
             run_ref: str, last_outcome: str, next_at: str | None,
             idempotency_key: str,
             timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict:
    response = _round_trip(socket_path, {
        "version": PROTOCOL_VERSION,
        "operation": "complete",
        "scheduleId": schedule_id,
        "scheduledFor": scheduled_for,
        "runRef": run_ref,
        "lastOutcome": last_outcome,
        "nextAt": next_at,
        "idempotencyKey": idempotency_key,
    }, timeout)
    value = response.get("receipt")
    if not isinstance(value, dict):
        raise ScheduleStoreError("schedule-response-invalid")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="dashboard schedule Unix-socket client")
    parser.add_argument("--socket", default=str(DEFAULT_SOCKET_PATH))
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("snapshot")
    claim_parser = commands.add_parser("claim")
    advance_parser = commands.add_parser("advance")
    complete_parser = commands.add_parser("complete")
    for command in (claim_parser, advance_parser, complete_parser):
        command.add_argument("--schedule-id", required=True)
        command.add_argument("--scheduled-for", required=True)
        command.add_argument("--idempotency-key", required=True)
    claim_parser.add_argument("--next-at", required=True)
    claim_parser.add_argument("--expected-version", type=int, required=True)
    advance_parser.add_argument("--next-at", required=True)
    advance_parser.add_argument("--phase", choices=("card-saved", "ledger-appended"), required=True)
    complete_parser.add_argument("--run-ref", required=True)
    complete_parser.add_argument("--last-outcome", choices=("ok", "failed", "stopped", "interrupted", "abandoned"), required=True)
    complete_parser.add_argument("--next-at")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "snapshot":
            result = snapshot(args.socket, args.timeout)
        elif args.command == "claim":
            result = claim(args.socket, schedule_id=args.schedule_id, scheduled_for=args.scheduled_for,
                           next_at=args.next_at, expected_version=args.expected_version,
                           idempotency_key=args.idempotency_key, timeout=args.timeout)
        elif args.command == "advance":
            result = advance(args.socket, schedule_id=args.schedule_id, scheduled_for=args.scheduled_for,
                             next_at=args.next_at, phase=args.phase,
                             idempotency_key=args.idempotency_key, timeout=args.timeout)
        else:
            result = complete(args.socket, schedule_id=args.schedule_id, scheduled_for=args.scheduled_for,
                              run_ref=args.run_ref, last_outcome=args.last_outcome, next_at=args.next_at,
                              idempotency_key=args.idempotency_key, timeout=args.timeout)
    except ScheduleStoreError as error:
        print(error.code[:256], file=sys.stderr)
        return 2
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
