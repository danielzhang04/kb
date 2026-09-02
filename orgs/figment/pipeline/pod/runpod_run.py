#!/usr/bin/env python3
"""Bounded RunPod/ComfyUI bake-off runner with verified pod teardown."""

from __future__ import annotations

import argparse
import atexit
import base64
import copy
import csv
import json
import logging
import math
import os
import re
import shlex
import signal
import sys
import threading
import time
import traceback
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable
from urllib.parse import quote

try:
    import requests
except ModuleNotFoundError:  # --dry-run and the stubbed tests remain intentionally offline.
    requests = None  # type: ignore[assignment]


API_BASE = "https://rest.runpod.io/v1"
DEFAULT_MAX_MINUTES = 60.0
DEFAULT_READY_TIMEOUT = 15 * 60.0
REQUEST_TIMEOUT = 30.0
TERMINATE_ATTEMPTS = 5
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
ARTIFACT_EXTENSIONS = {".safetensors", ".json", ".txt", ".log"}
DEFAULT_SEED_FIELDS = ("seed", "noise_seed")
COMFY_PORT = 8188
COMFY_OUTPUT_DIR = "/workspace/output"
BOOTSTRAP_LOG_EVERY_POLLS = 5
BOOTSTRAP_LOG_TAIL_LINES = 20
OPS_LEDGER_DIR = Path("C:/Users/danie/kb-worktrees/dashboard-ops/ledgers/cost")
LEDGER_LOCK_TIMEOUT = 5.0


_active_redactor: ApiKeyRedactionFilter | None = None


def redact_pod_state(pod: dict[str, Any]) -> dict[str, Any]:
    """Preserve diagnostic structure without persisting credential-like values."""
    sensitive_names = {
        "apikey", "authorization", "containerregistryauthid", "credential",
        "credentials", "password", "secret", "token",
    }

    def visit(value: Any, parent_key: str = "") -> Any:
        normalized_parent = re.sub(r"[^a-z0-9]", "", parent_key.lower())
        if normalized_parent == "env" and isinstance(value, dict):
            return {str(key): "[REDACTED]" for key in value}
        if isinstance(value, dict):
            safe: dict[str, Any] = {}
            for key, child in value.items():
                normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
                if (normalized in sensitive_names
                        or normalized.endswith(("apikey", "accesstoken", "refreshtoken",
                                                "password", "secret"))):
                    safe[str(key)] = "[REDACTED]"
                else:
                    safe[str(key)] = visit(child, str(key))
            return safe
        if isinstance(value, list):
            return [visit(child, parent_key) for child in value]
        return copy.deepcopy(value)

    return visit(pod)


class HarnessError(RuntimeError):
    """A safe, user-facing harness failure."""


class ReadinessTimeout(HarnessError):
    """Pod readiness expired; retain the last response for postmortem output."""

    def __init__(self, message: str, last_pod_state: dict[str, Any]):
        super().__init__(message)
        self.last_pod_state = redact_pod_state(last_pod_state)


class PodStillRunning(HarnessError):
    """Termination could not be verified."""


class CreateCallError(HarnessError):
    """A non-success response from the create call, retained for diagnosis."""

    def __init__(self, status_code: int, body: str):
        self.status_code = int(status_code)
        self.body = body[:500]
        detail = f"RunPod POST /pods returned HTTP {self.status_code}"
        if self.body:
            detail += f": {self.body}"
        super().__init__(detail)


class CreateFailed(HarnessError):
    """The provider definitively rejected the create request."""


class RunCancelled(HarnessError):
    """SIGINT, SIGTERM, or the wall-clock watchdog requested shutdown."""


class BootstrapFailed(HarnessError):
    """A bootstrap failure marker and its redacted diagnostic tail."""

    def __init__(self, reason: str, bootstrap_log_tail: list[str]):
        super().__init__(f"bootstrap failed: {reason}")
        self.bootstrap_log_tail = bootstrap_log_tail


@dataclass(frozen=True)
class UploadItem:
    """One validated local file and its ComfyUI input destination."""

    local_path: Path
    remote_name: str
    subfolder: str
    overwrite: bool


class ApiKeyRedactionFilter(logging.Filter):
    """Redact the key without storing a second copy outside Session.headers."""

    def __init__(self, session: Any):
        super().__init__()
        self._session = session

    def redact(self, value: Any) -> str:
        text = str(value)
        auth = self._session.headers.get("Authorization", "")
        key = auth.removeprefix("Bearer ")
        return text.replace(key, "[REDACTED]") if key else text

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self.redact(record.getMessage())
        record.args = ()
        return True


def set_active_redactor(redactor: ApiKeyRedactionFilter | None) -> None:
    global _active_redactor
    _active_redactor = redactor


def redact_for_stderr(value: Any) -> str:
    if _active_redactor:
        return _active_redactor.redact(value)
    return str(value)


def redacting_excepthook(exc_type: type[BaseException], exc: BaseException, tb: Any) -> None:
    """Last-resort full traceback reporting with the active credential redacted."""
    formatted = "".join(traceback.format_exception(exc_type, exc, tb))
    print(redact_for_stderr(formatted), file=sys.stderr, end="")


def build_logger(redactor: ApiKeyRedactionFilter | None = None) -> logging.Logger:
    logger = logging.Logger("figment.runpod", level=logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    if redactor:
        handler.addFilter(redactor)
    logger.addHandler(handler)
    return logger


def build_authenticated_session() -> tuple[Any, ApiKeyRedactionFilter]:
    if requests is None:
        raise HarnessError("the requests package is required for live commands")
    session = requests.Session()
    # Do not consult netrc or credential-bearing proxy environment variables.
    session.trust_env = False
    # This is the one and only credential read. The value is retained in this header only.
    session.headers["Authorization"] = "Bearer " + os.environ["RUNPOD_API_KEY"]
    session.headers["Content-Type"] = "application/json"
    redactor = ApiKeyRedactionFilter(session)
    set_active_redactor(redactor)
    return session, redactor


class RunPodAPI:
    def __init__(self, session: Any, base_url: str = API_BASE):
        self.session = session
        self.base_url = base_url.rstrip("/")

    def _request(self, method: str, path: str, *, json_body: Any = None,
                 allow_404: bool = False) -> Any:
        response = self.session.request(
            method,
            self.base_url + path,
            json=json_body,
            timeout=REQUEST_TIMEOUT,
        )
        if allow_404 and response.status_code == 404:
            return None
        if not 200 <= response.status_code < 300:
            # Never include response bodies: remote errors can reflect credentials or payloads.
            raise HarnessError(f"RunPod {method} {path} returned HTTP {response.status_code}")
        if response.status_code == 204 or not getattr(response, "content", b""):
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise HarnessError(f"RunPod {method} {path} returned invalid JSON") from exc

    def create_pod(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.session.request(
            "POST", self.base_url + "/pods", json=payload, timeout=REQUEST_TIMEOUT,
        )
        if not 200 <= response.status_code < 300:
            body = getattr(response, "content", b"")
            if isinstance(body, bytes):
                body = body.decode("utf-8", errors="replace")
            raise CreateCallError(response.status_code, str(body))
        if response.status_code == 204 or not getattr(response, "content", b""):
            data = None
        else:
            try:
                data = response.json()
            except ValueError as exc:
                raise HarnessError("RunPod POST /pods returned invalid JSON") from exc
        if not isinstance(data, dict):
            raise HarnessError("RunPod create response was not an object")
        return data

    def get_pod(self, pod_id: str) -> dict[str, Any] | None:
        data = self._request(
            "GET", f"/pods/{pod_id}?includeMachine=true", allow_404=True,
        )
        if data is not None and not isinstance(data, dict):
            raise HarnessError("RunPod pod response was not an object")
        return data

    def list_pods(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/pods?includeMachine=true")
        if not isinstance(data, list):
            raise HarnessError("RunPod list response was not an array")
        return data

    def delete_pod(self, pod_id: str) -> None:
        self._request("DELETE", f"/pods/{pod_id}", allow_404=True)


class DryRunAPI:
    """In-memory API used by --dry-run. It performs no requests."""

    def __init__(self, hourly_price: float):
        self.hourly_price = hourly_price
        self.pod: dict[str, Any] | None = None

    def create_pod(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.pod = {
            "id": "dry-run-pod",
            "name": payload["name"],
            "desiredStatus": "RUNNING",
            "ports": ["8188/http"],
            "adjustedCostPerHr": self.hourly_price,
            "gpu": {"id": payload["gpuTypeIds"][0], "count": payload["gpuCount"]},
        }
        return copy.deepcopy(self.pod)

    def get_pod(self, pod_id: str) -> dict[str, Any] | None:
        return copy.deepcopy(self.pod) if self.pod and self.pod["id"] == pod_id else None

    def list_pods(self) -> list[dict[str, Any]]:
        return [copy.deepcopy(self.pod)] if self.pod else []

    def delete_pod(self, pod_id: str) -> None:
        if self.pod and self.pod["id"] == pod_id:
            self.pod = None


@contextmanager
def teardown_signal_mask(logger: logging.Logger):
    """Make teardown signals flag-only so a second signal cannot abort retries."""
    if threading.current_thread() is not threading.main_thread():
        yield
        return
    previous: dict[int, Any] = {}
    received = threading.Event()

    def handler(signum: int, _frame: Any) -> None:
        received.set()
        logger.warning("signal %s received during teardown; finishing all attempts", signum)

    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.getsignal(signum)
            signal.signal(signum, handler)
        yield
    finally:
        for signum, old in previous.items():
            signal.signal(signum, old)


class PodLease:
    """The sole owner of a pod, including name recovery and verified teardown."""

    def __init__(self, api: Any, payload: dict[str, Any] | None, logger: logging.Logger,
                 *, pod_id: str | None = None, sleep: Callable[[float], None] = time.sleep,
                 attempts: int = TERMINATE_ATTEMPTS,
                 on_acquired: Callable[[str, dict[str, Any] | None], None] | None = None,
                 started_utc: datetime | None = None):
        self.api = api
        self.payload = payload
        self.logger = logger
        self.pod_id = str(pod_id) if pod_id else None
        self.pod: dict[str, Any] | None = None
        self.sleep = sleep
        self.attempts = attempts
        self.on_acquired = on_acquired
        self._lock = threading.RLock()
        self._verified_absent = False
        self._registered = False
        self._atexit_callback = self._close_at_exit
        self._known_ids: set[str] = {self.pod_id} if self.pod_id else set()
        self._acquired_notified = bool(self.pod_id)
        self._create_uncertain = False
        self.create_error: str | None = None
        self._create_response_received = False
        self._create_name_match_seen = False
        if started_utc is not None and started_utc.tzinfo is None:
            started_utc = started_utc.replace(tzinfo=timezone.utc)
        self.started_utc = started_utc.astimezone(timezone.utc) if started_utc else None

    @property
    def pod_name(self) -> str | None:
        if self.payload and self.payload.get("name"):
            return str(self.payload["name"])
        return None

    def _register_atexit(self) -> None:
        if not self._registered:
            atexit.register(self._atexit_callback)
            self._registered = True

    def _remember_pod(self, pod: dict[str, Any]) -> None:
        pod_id = pod.get("id")
        if not pod_id:
            return
        self.pod = pod
        self.pod_id = str(pod_id)
        self._known_ids.add(self.pod_id)
        if not self._acquired_notified:
            self._acquired_notified = True
            if self.on_acquired:
                self.on_acquired(self.pod_id, pod)

    def _named_matches(self) -> list[dict[str, Any]]:
        name = self.pod_name
        if not name:
            return []
        candidates = [
            pod for pod in self.api.list_pods()
            if isinstance(pod, dict) and pod.get("name") == name and pod.get("id")
        ]
        if self.started_utc is None:
            return candidates
        matches: list[dict[str, Any]] = []
        for pod in candidates:
            raw_created = next(
                (pod.get(key) for key in ("createdAt", "created_at", "created")
                 if pod.get(key) is not None),
                None,
            )
            if raw_created is None:
                self.logger.warning(
                    "pod %s has no creation timestamp; recovering by exact name only",
                    pod.get("id"),
                )
                matches.append(pod)
                continue
            try:
                created = parse_remote_timestamp(raw_created)
            except (TypeError, ValueError, OverflowError) as exc:
                self.logger.error(
                    "pod %s has unusable creation timestamp; refusing name recovery: %s",
                    pod.get("id"), exc,
                )
                continue
            if created >= self.started_utc:
                matches.append(pod)
            else:
                self.logger.warning(
                    "ignoring older pod %s during name recovery", pod.get("id")
                )
        return matches

    @staticmethod
    def _definitely_not_created(exc: BaseException) -> bool:
        if not isinstance(exc, CreateCallError):
            return False
        body = exc.body.lower()
        return (
            (400 <= exc.status_code < 500 and exc.status_code not in (408, 429))
            or "no gpu available" in body
            or "no gpus available" in body
            or "insufficient funds" in body
        )

    def _create_failure_banner(self) -> str:
        error = self.create_error or "unknown create failure"
        if self._create_response_received and not self._create_name_match_seen:
            return (
                f"create call failed ({error}) and no pod with this name is visible "
                "— most likely never created; verify with `status`"
            )
        return (
            f"create returned uncertain ({error}) and a pod may exist; "
            "verify with `status`"
        )

    def failure_banner(self) -> str:
        if self.create_error:
            return self._create_failure_banner()
        label = self.pod_id or self.pod_name or "UNKNOWN"
        return f"POD STILL RUNNING {label}"

    def _mark_verified(self, label: str) -> None:
        self._verified_absent = True
        self.logger.warning("termination verified: pod %s is absent", label)
        if self._registered:
            atexit.unregister(self._atexit_callback)
            self._registered = False

    def snapshot(self) -> tuple[str | None, str | None, bool]:
        with self._lock:
            return self.pod_id, self.pod_name, self._verified_absent

    def __enter__(self) -> "PodLease":
        # Register before POST: a timeout, proxy 5xx, or invalid response may still have
        # created a billable pod, in which case the unique name is our recovery handle.
        self._register_atexit()
        if self.pod_id is not None:
            self.logger.info("pod acquired %s", self.pod_id)
            return self
        if self.payload is None:
            raise HarnessError("a create payload is required")
        self.logger.info("creating pod")
        try:
            created = self.api.create_pod(self.payload)
            if not isinstance(created, dict):
                raise HarnessError("RunPod create response was not an object")
            self._remember_pod(created)
            if not self.pod_id:
                self._create_uncertain = True
                matches = self._named_matches()
                self._create_name_match_seen = bool(matches)
                if len(matches) != 1:
                    raise HarnessError(
                        "pod creation may have succeeded but its id was not returned"
                    )
                self._remember_pod(matches[0])
        except BaseException as exc:
            self._create_response_received = isinstance(exc, CreateCallError)
            self.create_error = redact_for_stderr(f"{type(exc).__name__}: {exc}")
            self.logger.error("create call failed: %s", self.create_error)
            if self._definitely_not_created(exc):
                # A definite refusal cannot create a pod. One exact-name scan is retained
                # as a guard against a provider-side inconsistency, but it is not retried.
                try:
                    matches = self._named_matches()
                    self._create_name_match_seen = bool(matches)
                    for pod in matches:
                        self._remember_pod(pod)
                except BaseException as scan_exc:
                    self.logger.error(
                        "pod-name safety scan after definite create failure failed: %s: %s",
                        type(scan_exc).__name__, scan_exc,
                    )
                if not self._known_ids:
                    self._mark_verified("(create definitively failed)")
                    wrapped = CreateFailed(f"CREATE FAILED: {self.create_error}")
                    attach_lease_status(wrapped, self)
                    raise wrapped from exc
            self._create_uncertain = True
            try:
                self.close()
            except BaseException as teardown_exc:
                if isinstance(teardown_exc, PodStillRunning):
                    raise attach_lease_status(teardown_exc, self) from exc
                wrapped = HarnessError(
                    f"pod creation failed and teardown was not verified: "
                    f"{type(exc).__name__}: {exc}; {type(teardown_exc).__name__}: {teardown_exc}"
                )
                attach_lease_status(wrapped, self)
                raise wrapped from exc
            wrapped = HarnessError(f"pod creation failed: {type(exc).__name__}: {exc}")
            attach_lease_status(wrapped, self)
            raise wrapped from exc
        self.logger.info("pod acquired %s", self.pod_id)
        return self

    def _close_at_exit(self) -> None:
        try:
            self.close()
        except BaseException:
            pass
        pod_id, name, verified = self.snapshot()
        if not verified:
            message = self.failure_banner()
            self.logger.critical(message)
            # Logging handlers may already be torn down during interpreter exit.
            print(message, file=sys.stderr)

    def close(self) -> None:
        with self._lock, teardown_signal_mask(self.logger):
            if self._verified_absent:
                return
            if not self._known_ids and not self.pod_name:
                self._mark_verified("(no pod acquired)")
                return
            ever_discovered = bool(self._known_ids)
            for attempt in range(1, self.attempts + 1):
                name_scan_ok = not self._create_uncertain
                if self._create_uncertain:
                    try:
                        matches = self._named_matches()
                        name_scan_ok = True
                        self._create_name_match_seen = self._create_name_match_seen or bool(matches)
                        for pod in matches:
                            self._remember_pod(pod)
                        ever_discovered = ever_discovered or bool(matches)
                    except BaseException as exc:
                        self.logger.error("pod-name recovery failed: %s", exc)

                for pod_id in sorted(self._known_ids):
                    self.logger.warning("terminate attempt %d/%d for pod %s",
                                        attempt, self.attempts, pod_id)
                    try:
                        self.api.delete_pod(pod_id)
                    except BaseException as exc:
                        self.logger.error("terminate request failed for pod %s: %s", pod_id, exc)

                all_ids_absent = bool(self._known_ids)
                for pod_id in sorted(self._known_ids):
                    try:
                        if self.api.get_pod(pod_id) is not None:
                            all_ids_absent = False
                    except BaseException as exc:
                        all_ids_absent = False
                        self.logger.error(
                            "termination verification failed for pod %s: %s", pod_id, exc
                        )

                if self._create_uncertain and name_scan_ok:
                    try:
                        remaining = self._named_matches()
                        self._create_name_match_seen = (
                            self._create_name_match_seen or bool(remaining)
                        )
                        for pod in remaining:
                            self._remember_pod(pod)
                        name_scan_ok = not remaining
                    except BaseException as exc:
                        name_scan_ok = False
                        self.logger.error("pod-name verification failed: %s", exc)

                if ever_discovered and all_ids_absent and name_scan_ok:
                    self._mark_verified(self.pod_id or self.pod_name or "UNKNOWN")
                    return
                if attempt < self.attempts:
                    self.sleep(min(2 ** (attempt - 1), 8))
            message = self.failure_banner()
            self.logger.critical(message)
            raise PodStillRunning(message)

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        self.close()
        return False


def attach_lease_status(exc: BaseException, lease: PodLease) -> BaseException:
    pod_id, pod_name, verified = lease.snapshot()
    try:
        setattr(exc, "pod_id", pod_id)
        setattr(exc, "pod_name", pod_name)
        setattr(exc, "termination_verified", verified)
        setattr(exc, "create_error", lease.create_error)
        if lease.create_error:
            setattr(exc, "fail_closed_banner", lease.failure_banner())
    except BaseException:
        pass
    return exc


def parse_remote_timestamp(value: Any) -> datetime:
    """Parse the common ISO or epoch timestamp shapes returned for RunPod pods."""
    if isinstance(value, bool):
        raise ValueError("boolean is not a creation timestamp")
    if isinstance(value, (int, float)):
        seconds = float(value)
        if abs(seconds) >= 100_000_000_000:
            seconds /= 1000.0
        return datetime.fromtimestamp(seconds, timezone.utc)
    if not isinstance(value, str) or not value.strip():
        raise ValueError("empty creation timestamp")
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


class Watchdog:
    """Wall-clock guard that directly tears down the lease from a daemon thread."""

    def __init__(self, seconds: float, lease: PodLease, cancel: threading.Event,
                 logger: logging.Logger):
        self.seconds = seconds
        self.lease = lease
        self.cancel = cancel
        self.logger = logger
        self._stop = threading.Event()
        self.fired = threading.Event()
        self.error: BaseException | None = None
        self.thread = threading.Thread(target=self._run, name="pod-watchdog", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def _run(self) -> None:
        if self._stop.wait(self.seconds):
            return
        self.fired.set()
        self.cancel.set()
        self.logger.error("maximum runtime reached; watchdog terminating pod")
        try:
            self.lease.close()
        except BaseException as exc:
            self.error = exc

    def check(self) -> None:
        if self.error:
            raise self.error
        if self.fired.is_set():
            raise RunCancelled("maximum runtime reached")

    def stop(self, timeout: float | None = None) -> None:
        self._stop.set()
        if self.thread.is_alive() and self.thread is not threading.current_thread():
            self.thread.join(timeout=timeout)


def teardown_budget_seconds(attempts: int = TERMINATE_ATTEMPTS) -> float:
    request_budget = attempts * 2 * REQUEST_TIMEOUT
    backoff_budget = sum(min(2 ** (attempt - 1), 8) for attempt in range(1, attempts))
    return request_budget + backoff_budget + 1.0


@contextmanager
def shutdown_signals(cancel: threading.Event):
    previous: dict[int, Any] = {}

    def handler(signum: int, _frame: Any) -> None:
        cancel.set()
        raise RunCancelled(f"received signal {signum}")

    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.getsignal(signum)
            signal.signal(signum, handler)
        yield
    finally:
        for signum, old in previous.items():
            signal.signal(signum, old)


def _parse_scalar(text: str) -> Any:
    text = text.strip()
    if text in {"", "null", "Null", "NULL", "~"}:
        return None
    if text.lower() in {"true", "false"}:
        return text.lower() == "true"
    if text.startswith(("\"", "'")):
        if text[0] == "\"":
            return json.loads(text)
        return text[1:-1].replace("''", "'")
    if text.startswith(("[", "{")):
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            if (text.startswith("[") and re.fullmatch(
                    r"\[\s*(?:[A-Za-z0-9_.-]+\s*(?:,\s*[A-Za-z0-9_.-]+\s*)*)?\]",
                    text)):
                inner = text[1:-1].strip()
                return [] if not inner else [item.strip() for item in inner.split(",")]
            raise HarnessError("invalid inline manifest value") from exc
    try:
        return float(text) if any(c in text for c in ".eE") else int(text)
    except ValueError:
        return text


def _strip_yaml_comment(line: str) -> str:
    quote: str | None = None
    escaped = False
    for index, char in enumerate(line):
        if escaped:
            escaped = False
        elif char == "\\" and quote == "\"":
            escaped = True
        elif char in {"'", "\""}:
            quote = None if quote == char else char if quote is None else quote
        elif char == "#" and quote is None:
            return line[:index]
    return line


def parse_simple_yaml(text: str) -> Any:
    """Parse the manifest's documented YAML subset without adding PyYAML."""
    tokens: list[tuple[int, str]] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        clean = _strip_yaml_comment(raw).rstrip()
        if not clean.strip():
            continue
        if "\t" in clean[:len(clean) - len(clean.lstrip())]:
            raise HarnessError(f"manifest line {number}: tabs are not valid indentation")
        tokens.append((len(clean) - len(clean.lstrip(" ")), clean.strip()))
    if not tokens:
        raise HarnessError("manifest is empty")

    def parse_block(index: int, indent: int) -> tuple[Any, int]:
        is_list = tokens[index][1].startswith("- ") or tokens[index][1] == "-"
        result: Any = [] if is_list else {}
        while index < len(tokens):
            level, content = tokens[index]
            if level < indent:
                break
            if level != indent:
                raise HarnessError(f"invalid manifest indentation near {content!r}")
            if is_list:
                if not (content.startswith("- ") or content == "-"):
                    break
                rest = content[1:].strip()
                if not rest:
                    if index + 1 >= len(tokens) or tokens[index + 1][0] <= indent:
                        raise HarnessError("trailing bare '-' requires an indented value")
                    child, index = parse_block(index + 1, tokens[index + 1][0])
                    result.append(child)
                    continue
                if ":" in rest:
                    key, value = rest.split(":", 1)
                    item: dict[str, Any] = {key.strip(): _parse_scalar(value) if value.strip() else None}
                    index += 1
                    if index < len(tokens) and tokens[index][0] > indent:
                        child, index = parse_block(index, tokens[index][0])
                        if item[key.strip()] is None and not isinstance(child, dict):
                            item[key.strip()] = child
                        elif isinstance(child, dict):
                            item.update(child)
                        else:
                            raise HarnessError("invalid list item continuation")
                    if index < len(tokens) and tokens[index][0] > indent:
                        continuation, index = parse_block(index, tokens[index][0])
                        if not isinstance(continuation, dict):
                            raise HarnessError("invalid list item mapping continuation")
                        item.update(continuation)
                    result.append(item)
                    continue
                result.append(_parse_scalar(rest))
                index += 1
            else:
                if content.startswith("-") or ":" not in content:
                    break
                key, value = content.split(":", 1)
                key = key.strip()
                index += 1
                if value.strip():
                    result[key] = _parse_scalar(value)
                elif index < len(tokens) and tokens[index][0] > indent:
                    result[key], index = parse_block(index, tokens[index][0])
                else:
                    result[key] = None
        return result, index

    parsed, final = parse_block(0, tokens[0][0])
    if final != len(tokens):
        raise HarnessError("could not parse the complete manifest")
    return parsed


def load_manifest(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = parse_simple_yaml(text)
    if not isinstance(data, dict):
        raise HarnessError("manifest root must be an object")
    return data


def resolve_manifest_path(path: Path) -> Path:
    if path.is_file():
        return path.resolve()
    if not path.is_absolute():
        beside_script = Path(__file__).resolve().parent / path
        if beside_script.is_file():
            return beside_script
    raise HarnessError(f"manifest not found: {path}")


def manifest_readiness_timeout_seconds(manifest: dict[str, Any]) -> float:
    if "ready_timeout_seconds" in manifest:
        raise HarnessError(
            "ready_timeout_seconds was renamed to readiness_timeout_seconds"
        )
    value = manifest.get("readiness_timeout_seconds", DEFAULT_READY_TIMEOUT)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HarnessError("readiness_timeout_seconds must be numeric")
    timeout = float(value)
    if not math.isfinite(timeout) or timeout <= 0:
        raise HarnessError("readiness_timeout_seconds must be finite and positive")
    return timeout


def _portable_relative_path(value: Any, label: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise HarnessError(f"{label} must be a non-empty relative path without NULs")
    path = PurePosixPath(value.replace("\\", "/"))
    has_windows_drive = bool(path.parts and re.fullmatch(r"[A-Za-z]:", path.parts[0]))
    if (path.is_absolute() or has_windows_drive
            or path == PurePosixPath(".") or ".." in path.parts):
        raise HarnessError(f"unsafe {label}: paths must stay below their declared root")
    return path


def _manifest_local_path(value: Any, manifest_path: Path, label: str) -> Path:
    relative = _portable_relative_path(value, label)
    root = manifest_path.parent.resolve()
    try:
        resolved = root.joinpath(*relative.parts).resolve()
    except (OSError, ValueError) as exc:
        raise HarnessError(f"{label} could not be resolved: {type(exc).__name__}") from exc
    if not resolved.is_relative_to(root):
        raise HarnessError(f"unsafe {label}: path escapes the manifest directory")
    return resolved


def _safe_remote_subfolder(value: Any) -> str:
    if not isinstance(value, str) or "\x00" in value:
        raise HarnessError("upload subfolder must be a relative path without NULs")
    if value == "":
        return ""
    path = _portable_relative_path(value, "upload subfolder")
    return path.as_posix()


def expand_manifest_uploads(
    manifest: dict[str, Any], manifest_path: Path,
) -> list[UploadItem]:
    """Validate and deterministically expand the optional uploads block."""
    if "uploads" not in manifest:
        return []
    groups = manifest["uploads"]
    if not isinstance(groups, list) or not groups:
        raise HarnessError("manifest uploads must be a non-empty list when present")

    root = manifest_path.parent.resolve()
    expanded: list[UploadItem] = []
    remote_names: set[str] = set()
    for group_number, group in enumerate(groups, start=1):
        if not isinstance(group, dict):
            raise HarnessError("each uploads entry must be an object")
        files = group.get("files")
        if (not isinstance(files, list) or not files
                or any(not isinstance(pattern, str) or not pattern for pattern in files)):
            raise HarnessError("each uploads.files value must be a non-empty list of paths or globs")
        if group.get("type") != "input":
            raise HarnessError("each upload must declare type=input")
        overwrite = group.get("overwrite")
        if not isinstance(overwrite, bool):
            raise HarnessError("each upload overwrite value must be true or false")
        subfolder = _safe_remote_subfolder(group.get("subfolder"))

        for pattern_number, pattern_text in enumerate(files, start=1):
            pattern = _portable_relative_path(
                pattern_text, f"uploads entry {group_number} files item {pattern_number}",
            )
            try:
                matches = sorted(
                    root.glob(pattern.as_posix()),
                    key=lambda candidate: candidate.as_posix(),
                )
            except (OSError, ValueError) as exc:
                raise HarnessError(
                    f"upload files item {pattern_number} could not be expanded: "
                    f"{type(exc).__name__}"
                ) from exc
            if not matches:
                raise HarnessError(
                    f"upload files item {pattern_number} matched no files"
                )
            for match in matches:
                try:
                    local_path = match.resolve()
                except (OSError, ValueError) as exc:
                    raise HarnessError(
                        f"upload file could not be resolved: {type(exc).__name__}"
                    ) from exc
                if not local_path.is_relative_to(root):
                    raise HarnessError("upload file traversal outside the manifest directory is forbidden")
                if not local_path.is_file():
                    raise HarnessError("upload files may not match directories")
                remote_name = local_path.name
                if remote_name in remote_names:
                    raise HarnessError(
                        f"duplicate upload remote name: {remote_name!r}"
                    )
                remote_names.add(remote_name)
                expanded.append(UploadItem(
                    local_path=local_path,
                    remote_name=remote_name,
                    subfolder=subfolder,
                    overwrite=overwrite,
                ))

    marker_positions = [
        index for index, item in enumerate(expanded)
        if item.remote_name == "_dataset.ready"
    ]
    if marker_positions and (len(marker_positions) != 1 or marker_positions[0] != len(expanded) - 1):
        raise HarnessError("the _dataset.ready upload must be strictly last")
    return expanded


def _output_marker_name(value: Any, label: str, *, absolute: bool) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise HarnessError(f"{label} must be a non-empty safe output marker path")
    path = PurePosixPath(value.replace("\\", "/"))
    if ".." in path.parts:
        raise HarnessError(f"unsafe {label}: traversal is forbidden")
    output_root = PurePosixPath(COMFY_OUTPUT_DIR)
    if absolute:
        if (not path.is_absolute() or path == output_root
                or not path.is_relative_to(output_root)):
            raise HarnessError(f"{label} must be below {COMFY_OUTPUT_DIR}")
        path = path.relative_to(output_root)
    else:
        path = _portable_relative_path(value, label)
    return path.as_posix()


def training_failed_marker_name(manifest: dict[str, Any]) -> str:
    training = manifest.get("training")
    if not isinstance(training, dict):
        raise HarnessError("artifacts require a training object")
    return _output_marker_name(
        training.get("failed_marker"), "training.failed_marker", absolute=True,
    )


def manifest_artifacts(manifest: dict[str, Any]) -> list[dict[str, str]]:
    if "artifacts" not in manifest:
        return []
    artifacts = manifest["artifacts"]
    if not isinstance(artifacts, list) or not artifacts:
        raise HarnessError("manifest artifacts must be a non-empty list when present")
    training_failed_marker_name(manifest)
    training = manifest["training"]
    if "complete_marker" in training:
        _output_marker_name(
            training["complete_marker"], "training.complete_marker", absolute=True,
        )

    validated: list[dict[str, str]] = []
    local_names: set[str] = set()
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise HarnessError("each artifacts entry must be an object")
        if artifact.get("type") != "output":
            raise HarnessError("each artifact must declare type=output")
        remote = _portable_relative_path(
            artifact.get("remote"), "artifact remote",
        ).as_posix()
        local = _portable_relative_path(
            artifact.get("local"), "artifact local",
        ).as_posix()
        wait_for = _output_marker_name(
            artifact.get("wait_for"), "artifact wait_for", absolute=False,
        )
        remote_suffix = PurePosixPath(remote).suffix.lower()
        local_suffix = PurePosixPath(local).suffix.lower()
        if (remote_suffix not in ARTIFACT_EXTENSIONS
                or local_suffix not in ARTIFACT_EXTENSIONS
                or remote_suffix != local_suffix):
            raise HarnessError(
                "unsupported artifact suffix; remote and local must match one of: "
                + ", ".join(sorted(ARTIFACT_EXTENSIONS))
            )
        if local in local_names:
            raise HarnessError(f"duplicate artifact local name: {local!r}")
        local_names.add(local)
        validated.append({
            "remote": remote,
            "local": local,
            "type": "output",
            "wait_for": wait_for,
        })
    return validated


def rendered_training_start_script(
    manifest: dict[str, Any], manifest_path: Path,
) -> tuple[str, str] | None:
    if "training" not in manifest:
        return None
    training = manifest["training"]
    if not isinstance(training, dict):
        raise HarnessError("manifest training must be an object")
    local_path = _manifest_local_path(
        training.get("start_script_file"), manifest_path,
        "training.start_script_file",
    )
    if not local_path.is_file():
        raise HarnessError("training.start_script_file must name an existing file")

    remote_value = training.get("start_script_path")
    if not isinstance(remote_value, str) or not remote_value or "\x00" in remote_value:
        raise HarnessError("training.start_script_path must be an absolute path without NULs")
    remote_path = PurePosixPath(remote_value.replace("\\", "/"))
    volume_root = PurePosixPath(str(manifest.get("volume_mount_path", "/workspace")))
    if (not remote_path.is_absolute() or ".." in remote_path.parts
            or remote_path == volume_root or not remote_path.is_relative_to(volume_root)):
        raise HarnessError(
            "training.start_script_path must be below volume_mount_path without traversal"
        )
    try:
        template = local_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise HarnessError(
            f"training.start_script_file could not be read: {type(exc).__name__}"
        ) from exc
    if "\x00" in template:
        raise HarnessError("training.start_script_file may not contain NULs")

    context = {
        str(key): value
        for source in (manifest, training)
        for key, value in source.items()
        if isinstance(value, (str, int, float)) and not isinstance(value, bool)
    }
    if "git_ref" in training:
        context.setdefault("diffusion_pipe_git_ref", training["git_ref"])

    def replace_placeholder(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in context:
            raise HarnessError(f"unresolved training start script placeholder: {key}")
        value = str(context[key])
        if "\x00" in value:
            raise HarnessError(f"training start script value {key!r} contains a NUL")
        return value

    rendered = re.sub(r"{{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}", replace_placeholder, template)
    if "{{" in rendered or "}}" in rendered:
        raise HarnessError("training start script contains an invalid or unresolved placeholder")
    return remote_path.as_posix(), rendered


def require_manifest(manifest: dict[str, Any], manifest_path: Path) -> None:
    gpu = manifest.get("gpu")
    if not isinstance(gpu, dict) or not gpu.get("type"):
        raise HarnessError("manifest gpu.type is required")
    if not manifest.get("image") and not manifest.get("template_id"):
        raise HarnessError("manifest requires image or template_id")
    if not isinstance(manifest.get("price_usd_per_hour"), (int, float)):
        raise HarnessError("manifest price_usd_per_hour is required for fail-closed preflight")
    manifest_price = float(manifest["price_usd_per_hour"])
    if not math.isfinite(manifest_price) or manifest_price <= 0:
        raise HarnessError("price_usd_per_hour must be finite and positive")
    readiness_timeout = manifest_readiness_timeout_seconds(manifest)
    if manifest.get("max_minutes") is not None:
        try:
            manifest_max_minutes = float(manifest["max_minutes"])
        except (TypeError, ValueError) as exc:
            raise HarnessError("manifest max_minutes must be numeric") from exc
        minimum_minutes = readiness_timeout / 60.0 + 5.0
        if (not math.isfinite(manifest_max_minutes) or manifest_max_minutes <= 0
                or manifest_max_minutes < minimum_minutes):
            raise HarnessError(
                "manifest max_minutes must cover readiness_timeout_seconds plus "
                f"a 5 minute teardown margin (minimum {minimum_minutes:g})"
            )
    if not isinstance(manifest.get("jobs"), list) or not manifest["jobs"]:
        raise HarnessError("manifest jobs must be a non-empty list")
    comfy = manifest.get("comfyui")
    if not isinstance(comfy, dict):
        raise HarnessError("manifest comfyui configuration is required")
    git_ref = comfy.get("git_ref")
    if not isinstance(git_ref, str) or not git_ref.strip():
        raise HarnessError("comfyui.git_ref is required")
    port = comfy.get("port", COMFY_PORT)
    if isinstance(port, bool) or not isinstance(port, int) or port != COMFY_PORT:
        raise HarnessError(f"comfyui.port must be {COMFY_PORT} for the HTTP proxy")
    start_command = comfy.get("start_command", "python main.py")
    if not isinstance(start_command, str) or not start_command.strip():
        raise HarnessError("comfyui.start_command must be a non-empty command")
    try:
        start_parts = shlex.split(start_command)
    except ValueError as exc:
        raise HarnessError(f"invalid comfyui.start_command: {exc}") from exc
    controlled_flags = {"--listen", "--port", "--output-directory"}
    if any(part in controlled_flags for part in start_parts):
        raise HarnessError(
            "comfyui.start_command must omit --listen, --port, and --output-directory; "
            "the harness supplies proxy-safe values"
        )
    if not isinstance(comfy.get("replace_non_git_root", False), bool):
        raise HarnessError("comfyui.replace_non_git_root must be true or false")
    volume_root = PurePosixPath(str(manifest.get("volume_mount_path", "/workspace")))
    comfy_root = PurePosixPath(str(comfy.get("root", "/workspace/ComfyUI")))
    if (not volume_root.is_absolute() or not comfy_root.is_absolute()
            or ".." in volume_root.parts or ".." in comfy_root.parts
            or comfy_root == volume_root or not comfy_root.is_relative_to(volume_root)):
        raise HarnessError("comfyui.root must be an absolute subdirectory of volume_mount_path")
    for job in manifest["jobs"]:
        expected = job.get("expected_images", 1) if isinstance(job, dict) else None
        if (not isinstance(job, dict) or isinstance(expected, bool)
                or not isinstance(expected, int) or expected <= 0):
            raise HarnessError("each job expected_images must be a positive integer")
    workflow = load_workflow(manifest, manifest_path)
    seed_fields = manifest_seed_fields(manifest)
    if not any(
        isinstance(node, dict)
        and isinstance(node.get("inputs"), dict)
        and any(field in node["inputs"] for field in seed_fields)
        for node in workflow.values()
    ):
        raise HarnessError(
            "workflow has no seed input fields; looked for: " + ", ".join(seed_fields)
        )
    for model in manifest.get("models", []):
        if not isinstance(model, dict) or not all(model.get(k) for k in ("repo_id", "filename", "destination_dir")):
            raise HarnessError("each model needs repo_id, filename, and destination_dir")
        if not re.fullmatch(r"[A-Za-z0-9._-]+/[A-Za-z0-9._-]+", str(model["repo_id"])):
            raise HarnessError(f"invalid public Hugging Face repo id: {model['repo_id']!r}")
        filename = PurePosixPath(str(model["filename"]))
        if filename.is_absolute() or ".." in filename.parts:
            raise HarnessError(f"unsafe model filename: {model['filename']!r}")
        if not PurePosixPath(str(model["destination_dir"])).is_absolute():
            raise HarnessError("model destination_dir must be an absolute pod path")
    for node in manifest.get("custom_nodes", []):
        url = node.get("git_url") if isinstance(node, dict) else None
        if not isinstance(url, str) or not url.startswith("https://"):
            raise HarnessError("custom node git_url must be a public https URL")
    expand_manifest_uploads(manifest, manifest_path)
    rendered_training_start_script(manifest, manifest_path)
    manifest_artifacts(manifest)


def load_workflow(manifest: dict[str, Any], manifest_path: Path) -> dict[str, Any]:
    workflow = manifest.get("workflow")
    if isinstance(workflow, dict):
        return copy.deepcopy(workflow)
    if isinstance(workflow, str):
        path = Path(workflow)
        if not path.is_absolute():
            path = manifest_path.parent / path
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    raise HarnessError("manifest workflow must be an API-format object or JSON file path")


def manifest_seed_fields(manifest: dict[str, Any]) -> tuple[str, ...]:
    fields = manifest.get("seed_fields", DEFAULT_SEED_FIELDS)
    if (not isinstance(fields, (list, tuple)) or not fields
            or any(not isinstance(field, str) or not field for field in fields)):
        raise HarnessError("manifest seed_fields must be a non-empty list of field names")
    return tuple(fields)


def estimate_cost(manifest: dict[str, Any], max_minutes: float, max_usd: float | None) -> float:
    if not math.isfinite(max_minutes) or max_minutes <= 0:
        raise HarnessError("--max-minutes must be greater than zero")
    if max_usd is not None and (not math.isfinite(max_usd) or max_usd <= 0):
        raise HarnessError("--max-usd must be finite and greater than zero")
    estimate = float(manifest["price_usd_per_hour"]) * max_minutes / 60.0
    if max_usd is not None and estimate > max_usd:
        raise HarnessError(
            f"preflight refused: estimated ${estimate:.4f} exceeds --max-usd ${max_usd:.4f}"
        )
    return estimate


def effective_max_minutes(cli_value: float | None, manifest: dict[str, Any]) -> float:
    try:
        values = [DEFAULT_MAX_MINUTES]
        if cli_value is not None:
            values.append(float(cli_value))
        if manifest.get("max_minutes") is not None:
            values.append(float(manifest["max_minutes"]))
    except (TypeError, ValueError) as exc:
        raise HarnessError("max_minutes values must be numeric") from exc
    if any(not math.isfinite(value) or value <= 0 for value in values):
        raise HarnessError("--max-minutes and manifest max_minutes must be finite and positive")
    maximum = min(values)
    return maximum


def enforce_effective_readiness_budget(
        manifest: dict[str, Any], max_minutes: float) -> None:
    # Legacy/test manifests without either budget key retain their prior CLI behavior.
    if ("readiness_timeout_seconds" not in manifest
            and manifest.get("max_minutes") is None):
        return
    minimum_minutes = manifest_readiness_timeout_seconds(manifest) / 60.0 + 5.0
    if max_minutes < minimum_minutes:
        raise HarnessError(
            "effective max_minutes must cover readiness_timeout_seconds plus "
            f"a 5 minute teardown margin (minimum {minimum_minutes:g})"
        )


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def repo_ledger_dir() -> Path:
    return repo_root() / "ledgers" / "cost"


def configured_ledger_dir(explicit: Path | None = None) -> Path:
    if explicit is not None:
        return explicit
    env_value = os.environ.get("KB_LEDGER_DIR")
    if env_value:
        return Path(env_value)
    if OPS_LEDGER_DIR.is_dir():
        return OPS_LEDGER_DIR
    return repo_ledger_dir()


def daily_budget_state(*, budget_path: Path | None = None,
                       ledger_dir: Path | None = None,
                       logger: logging.Logger | None = None) -> tuple[float, float]:
    budget_path = budget_path or repo_root() / "governance" / "budget.yaml"
    ledger_dir = configured_ledger_dir(ledger_dir)
    budget = parse_simple_yaml(budget_path.read_text(encoding="utf-8"))
    if not isinstance(budget, dict) or not isinstance(budget.get("daily_usd_limit"), (int, float)):
        raise HarnessError("governance budget is missing numeric daily_usd_limit")
    daily_limit = float(budget["daily_usd_limit"])
    if not math.isfinite(daily_limit) or daily_limit <= 0:
        raise HarnessError("governance daily_usd_limit must be positive")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    spent = 0.0
    for path in sorted(ledger_dir.glob(f"*-{today}.tsv")):
        try:
            with path.open("r", encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle, delimiter="\t")
                if not reader.fieldnames or "usd" not in reader.fieldnames:
                    if logger:
                        logger.warning("skipping cost ledger without usd column: %s", path)
                    continue
                for row in reader:
                    value = float(row["usd"])
                    if not math.isfinite(value) or value < 0:
                        raise HarnessError(f"cost ledger has invalid usd value: {path}")
                    spent += value
        except (OSError, TypeError, ValueError) as exc:
            raise HarnessError(f"could not read cost ledger {path}: {exc}") from exc
    return daily_limit, spent


def enforce_daily_budget(estimate: float, *, budget_path: Path | None = None,
                         ledger_dir: Path | None = None,
                         logger: logging.Logger | None = None) -> tuple[float, float]:
    daily_limit, spent = daily_budget_state(
        budget_path=budget_path, ledger_dir=ledger_dir, logger=logger,
    )
    if estimate < 0 or spent + estimate > daily_limit:
        raise HarnessError(
            f"daily budget refused: ${spent:.4f} spent + ${estimate:.4f} estimate "
            f"exceeds ${daily_limit:.4f}"
        )
    return daily_limit, spent


def ready_hourly_price(pod: dict[str, Any]) -> float:
    value = pod.get("adjustedCostPerHr")
    if value is None:
        value = pod.get("costPerHr")
    try:
        hourly = float(value)
    except (TypeError, ValueError) as exc:
        raise HarnessError("READY pod did not report a valid hourly price") from exc
    if not math.isfinite(hourly) or hourly <= 0:
        raise HarnessError("READY pod reported a missing or non-positive hourly price")
    return hourly


def settled_cost_estimate(*, elapsed_seconds: float, dry_run: bool,
                          ready_hourly_price_usd: float | None,
                          manifest_hourly_price_usd: float,
                          preflight_estimate_usd: float,
                          termination_verified: bool) -> tuple[float, str]:
    """Return the final cost and its evidence basis without inflating early failures."""
    if dry_run:
        return 0.0, "dry-run"
    elapsed_seconds = max(0.0, elapsed_seconds)
    if ready_hourly_price_usd is None:
        return (
            manifest_hourly_price_usd * elapsed_seconds / 3600.0,
            "ceiling-rate estimate",
        )
    measured = ready_hourly_price_usd * elapsed_seconds / 3600.0
    if termination_verified:
        return measured, "READY-rate measured"
    return max(preflight_estimate_usd, measured), "READY-rate conservative estimate"


def create_payload(
    manifest: dict[str, Any], manifest_path: Path | None = None,
) -> dict[str, Any]:
    gpu = manifest["gpu"]
    encoded_bootstrap = base64.b64encode(
        bootstrap_script(manifest, manifest_path).encode("utf-8")
    ).decode("ascii")
    bootstrap_command = (
        'echo "$FIGMENT_BOOTSTRAP_B64" | base64 -d > /workspace/bootstrap.sh '
        '&& bash /workspace/bootstrap.sh'
    )
    payload: dict[str, Any] = {
        "name": f"figment-bakeoff-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}",
        "cloudType": str(gpu.get("cloud", "SECURE")).upper(),
        "computeType": "GPU",
        "gpuTypeIds": [str(gpu["type"])],
        "gpuTypePriority": "availability",
        "gpuCount": int(gpu.get("count", 1)),
        "containerDiskInGb": int(manifest.get("container_disk_gb", 50)),
        "ports": [f"{COMFY_PORT}/http"],
        "dockerEntrypoint": ["bash", "-lc"],
        "dockerStartCmd": [bootstrap_command],
        "env": {"FIGMENT_BOOTSTRAP_B64": encoded_bootstrap},
        "volumeMountPath": str(manifest.get("volume_mount_path", "/workspace")),
    }
    if manifest.get("template_id"):
        payload["templateId"] = manifest["template_id"]
    else:
        payload["imageName"] = manifest["image"]
    if manifest.get("network_volume_id"):
        payload["networkVolumeId"] = manifest["network_volume_id"]
    else:
        payload["volumeInGb"] = int(manifest.get("volume_gb", 20))
    return payload


def pod_proxy_url(pod_id: str, port: int = COMFY_PORT) -> str:
    if not re.fullmatch(r"[A-Za-z0-9-]+", pod_id):
        raise HarnessError(f"unsafe pod id for proxy URL: {pod_id!r}")
    if port != COMFY_PORT:
        raise HarnessError(f"ComfyUI proxy port must be {COMFY_PORT}")
    return f"https://{pod_id}-{port}.proxy.runpod.net"


def _poll_value(value: Any) -> str:
    if value is None or value == "":
        return "-"
    return " ".join(str(value).split())


def readiness_poll_summary(pod: dict[str, Any], elapsed: float,
                           proxy_status: int | str | None) -> str:
    runtime = pod.get("runtime") if isinstance(pod.get("runtime"), dict) else {}
    machine = pod.get("machine") if isinstance(pod.get("machine"), dict) else {}
    gpu = pod.get("gpu") if isinstance(pod.get("gpu"), dict) else {}
    runtime_gpus = runtime.get("gpus") if isinstance(runtime.get("gpus"), list) else []
    runtime_gpu = runtime_gpus[0] if runtime_gpus and isinstance(runtime_gpus[0], dict) else {}
    machine_gpu = (
        machine.get("gpuDisplayName") or machine.get("gpuTypeId")
        or gpu.get("displayName") or gpu.get("id") or runtime_gpu.get("id")
    )
    machine_host = machine.get("podHostId") or machine.get("id") or pod.get("machineId")
    return (
        f"readiness poll elapsed={elapsed:.1f}s "
        f"desiredStatus={_poll_value(pod.get('desiredStatus'))} "
        f"currentStatus={_poll_value(pod.get('currentStatus'))} "
        f"runtimeStatus={_poll_value(runtime.get('status') or runtime.get('currentStatus'))} "
        f"lastStatusChange={_poll_value(pod.get('lastStatusChange'))} "
        f"proxyStatus={_poll_value(proxy_status)} "
        f"machineGpu={_poll_value(machine_gpu)} "
        f"machineHost={_poll_value(machine_host)}"
    )


def readiness_timeout_reason(pod: dict[str, Any], proxy_status: int | str | None) -> str:
    desired = _poll_value(pod.get("desiredStatus"))
    current = _poll_value(pod.get("currentStatus"))
    runtime = pod.get("runtime") if isinstance(pod.get("runtime"), dict) else {}
    runtime_status = _poll_value(runtime.get("status") or runtime.get("currentStatus"))
    last_change = _poll_value(pod.get("lastStatusChange"))
    state_text = " ".join((desired, current, runtime_status, last_change)).lower()
    if "image" in state_text and any(word in state_text for word in ("pull", "download")):
        return (
            "image pull in progress "
            f"(desiredStatus={desired}, currentStatus={current}, runtimeStatus={runtime_status})"
        )
    if desired in {"CREATED", "PENDING", "-"}:
        return f"never left CREATED/PENDING (desiredStatus={desired})"
    if desired == "RUNNING":
        return (
            "stuck in desiredStatus=RUNNING while proxy /system_stats "
            f"returned {_poll_value(proxy_status)}"
        )
    return (
        f"stuck in desiredStatus={desired}, currentStatus={current}, "
        f"runtimeStatus={runtime_status}"
    )


def _bootstrap_log_tail(proxy: Any, logger: logging.Logger, *, lines: int,
                        failure_context: bool = False) -> list[str]:
    """Fetch and log a redacted bootstrap tail, retaining only the requested lines."""
    try:
        status, text = proxy.fetch_artifact("_bootstrap.log")
    except Exception as exc:
        if failure_context:
            logger.warning(
                "could not fetch bootstrap log after failure: %s", type(exc).__name__,
            )
        return []
    if status != 200:
        if failure_context:
            logger.warning("could not fetch bootstrap log after failure: /view returned %s", status)
        return []
    if not text:
        if failure_context:
            logger.warning("could not fetch bootstrap log after failure: empty response")
        return []
    tail = [redact_for_stderr(line) for line in text.splitlines()[-lines:]]
    for line in tail:
        logger.info("bootstrap log tail: %s", line)
    return tail


def _log_bootstrap_tail(proxy: Any, logger: logging.Logger) -> None:
    _bootstrap_log_tail(proxy, logger, lines=BOOTSTRAP_LOG_TAIL_LINES)


def _raise_if_bootstrap_failed(proxy: Any, logger: logging.Logger) -> None:
    status, text = proxy.fetch_artifact("_bootstrap.failed")
    if status == 200:
        # Fetch diagnostics before raising: the surrounding lease will terminate the Pod.
        log_tail = _bootstrap_log_tail(proxy, logger, lines=40, failure_context=True)
        reason = redact_for_stderr(" ".join(text.strip().split()) or "unknown bootstrap failure")
        raise BootstrapFailed(reason, log_tail[-10:])


def wait_ready(api: Any, pod_id: str, timeout: float, watchdog: Watchdog,
               logger: logging.Logger, proxy: Any,
               sleep: Callable[[float], None] = time.sleep,
               bootstrap_log_every_polls: int = BOOTSTRAP_LOG_EVERY_POLLS) -> dict[str, Any]:
    if bootstrap_log_every_polls <= 0:
        raise HarnessError("bootstrap_log_every_polls must be positive")
    started = time.monotonic()
    deadline = started + timeout
    last_pod: dict[str, Any] = {}
    last_proxy_status: int | str | None = None
    poll_number = 0
    while time.monotonic() < deadline:
        poll_number += 1
        watchdog.check()
        pod = api.get_pod(pod_id)
        if pod is None:
            raise HarnessError(f"pod {pod_id} disappeared before becoming ready")
        last_pod = pod
        last_proxy_status = proxy.health_status()
        watchdog.check()
        if pod.get("desiredStatus") == "RUNNING":
            _raise_if_bootstrap_failed(proxy, logger)
            watchdog.check()
            if poll_number % bootstrap_log_every_polls == 0:
                _log_bootstrap_tail(proxy, logger)
        logger.info(readiness_poll_summary(
            pod, time.monotonic() - started, last_proxy_status,
        ))
        if pod.get("desiredStatus") == "RUNNING" and last_proxy_status == 200:
            logger.info("readiness matched desiredStatus=RUNNING and proxy /system_stats=200")
            return pod
        sleep(2)
    reason = readiness_timeout_reason(last_pod, last_proxy_status)
    safe_last_pod = redact_pod_state(last_pod)
    logger.error(
        "readiness timeout last pod state: %s",
        json.dumps(safe_last_pod, ensure_ascii=False, sort_keys=True, default=str),
    )
    raise ReadinessTimeout(
        f"pod readiness timed out after {timeout:.0f}s: {reason}", safe_last_pod,
    )


def _safe_node_name(url: str, explicit: str | None) -> str:
    name = explicit or PurePosixPath(url.removesuffix("/")).name.removesuffix(".git")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", name):
        raise HarnessError(f"unsafe custom node directory name: {name!r}")
    return name


def bootstrap_script(
    manifest: dict[str, Any], manifest_path: Path | None = None,
) -> str:
    comfy = manifest.get("comfyui") or {}
    root = str(comfy.get("root", "/workspace/ComfyUI"))
    git_ref = str(comfy["git_ref"])
    replace_non_git_root = comfy.get("replace_non_git_root") is True
    port = int(comfy.get("port", 8188))
    start_base = str(comfy.get("start_command", "python main.py"))
    start = (
        f"{start_base} --listen 0.0.0.0 --port {port} "
        f"--output-directory {COMFY_OUTPUT_DIR}"
    )
    diagnostic_server = """\
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

OUTPUT = Path("/workspace/output")
ALLOWED = {"_bootstrap.log", "_bootstrap.failed"}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/system_stats":
            self.send_response(503)
            self.end_headers()
            return
        query = parse_qs(parsed.query)
        filename = query.get("filename", [""])[0]
        if parsed.path != "/view" or filename not in ALLOWED:
            self.send_response(404)
            self.end_headers()
            return
        path = OUTPUT / filename
        if not path.is_file():
            self.send_response(404)
            self.end_headers()
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return

ThreadingHTTPServer(("0.0.0.0", 8188), Handler).serve_forever()
"""
    diagnostic_b64 = base64.b64encode(diagnostic_server.encode("utf-8")).decode("ascii")
    lines = [
        "#!/usr/bin/env bash",
        f"BOOTSTRAP_OUTPUT={shlex.quote(COMFY_OUTPUT_DIR)}",
        f"BOOTSTRAP_LOG={shlex.quote(COMFY_OUTPUT_DIR + '/_bootstrap.log')}",
        f"BOOTSTRAP_FAILED={shlex.quote(COMFY_OUTPUT_DIR + '/_bootstrap.failed')}",
        f"COMFY_RUNTIME_LOG={shlex.quote(COMFY_OUTPUT_DIR + '/_comfy.log')}",
        'mkdir -p "$BOOTSTRAP_OUTPUT"',
        ': > "$BOOTSTRAP_LOG"',
        'rm -f "$BOOTSTRAP_FAILED"',
        "fatal_active=0",
        f"DIAGNOSTIC_SERVER_B64={shlex.quote(diagnostic_b64)}",
        "log_line() { printf '%s\\n' \"$1\" | tee -a \"$BOOTSTRAP_LOG\"; }",
        "start_diagnostics() { echo \"$DIAGNOSTIC_SERVER_B64\" | base64 -d > /tmp/figment-bootstrap-server.py; python /tmp/figment-bootstrap-server.py >>\"$BOOTSTRAP_LOG\" 2>&1 & }",
        "fatal() { reason=\"$1\"; rc=\"${2:-1}\"; if [ \"$rc\" -eq 0 ]; then rc=1; fi; fatal_active=1; trap - EXIT; printf '%s\\n' \"$reason\" > \"$BOOTSTRAP_FAILED\"; log_line \"FATAL $reason\"; start_diagnostics || true; sleep 60; exit \"$rc\"; }",
        "on_exit() { rc=$?; if [ \"$rc\" -ne 0 ] && [ \"$fatal_active\" -eq 0 ]; then fatal \"unexpected bootstrap failure at line ${BASH_LINENO[0]} rc=$rc\" \"$rc\"; fi; }",
        "trap on_exit EXIT",
        "run_required() { label=\"$1\"; shift; \"$@\" >>\"$BOOTSTRAP_LOG\" 2>&1; rc=$?; log_line \"STEP $label rc=$rc\"; if [ \"$rc\" -ne 0 ]; then fatal \"$label failed with rc=$rc\" \"$rc\"; fi; }",
        "retry_required() { label=\"$1\"; shift; attempt=1; while :; do \"$@\" >>\"$BOOTSTRAP_LOG\" 2>&1; rc=$?; log_line \"STEP $label attempt=$attempt rc=$rc\"; if [ \"$rc\" -eq 0 ]; then return 0; fi; if [ \"$attempt\" -ge 3 ]; then fatal \"$label failed after $attempt attempts with rc=$rc\" \"$rc\"; return \"$rc\"; fi; if [ \"$attempt\" -eq 1 ]; then backoff=15; else backoff=30; fi; log_line \"STEP $label retrying in ${backoff}s\"; sleep \"$backoff\"; attempt=$((attempt + 1)); done; }",
        "wait_for_network() { elapsed=0; while :; do if getent hosts github.com >>\"$BOOTSTRAP_LOG\" 2>&1 && getent hosts huggingface.co >>\"$BOOTSTRAP_LOG\" 2>&1; then log_line \"NETWORK dns ready after ${elapsed}s\"; return 0; fi; rc=$?; log_line \"NETWORK dns wait elapsed=${elapsed}s rc=$rc\"; if [ \"$elapsed\" -ge 90 ]; then fatal \"network DNS was not ready after ${elapsed}s\" \"$rc\"; fi; sleep 5; elapsed=$((elapsed + 5)); done; }",
        "run_cosmetic() { label=\"$1\"; shift; \"$@\" >>\"$BOOTSTRAP_LOG\" 2>&1; rc=$?; log_line \"STEP $label rc=$rc (cosmetic)\"; return 0; }",
        "run_required python-present python --version",
        "run_required git-present git --version",
        "run_required curl-present curl --version",
        "wait_for_network",
    ]
    clone_comfy = (
        f"git clone --branch {shlex.quote(git_ref)} --depth 1 "
        f"https://github.com/comfyanonymous/ComfyUI {shlex.quote(root)}"
    )
    non_git_root = (
        f"rm -rf {shlex.quote(root)} && {clone_comfy}"
        if replace_non_git_root else
        "echo 'ComfyUI root exists but is not a git checkout; set "
        "comfyui.replace_non_git_root: true to replace it' >&2; exit 1"
    )
    install_comfy = (
        f"if [ -d {shlex.quote(root + '/.git')} ]; then "
        f"git -C {shlex.quote(root)} fetch --depth 1 origin {shlex.quote(git_ref)} && "
        f"git -C {shlex.quote(root)} checkout --detach FETCH_HEAD; "
        f"elif [ -e {shlex.quote(root)} ]; then {non_git_root}; "
        f"else {clone_comfy}; fi && "
        f"python -m pip install -r {shlex.quote(root + '/requirements.txt')}"
    )
    lines.extend([
        f"retry_required comfy-install bash -lc {shlex.quote(install_comfy)}",
    ])
    for index, model in enumerate(manifest.get("models", []), start=1):
        destination = str(PurePosixPath(str(model["destination_dir"])) / PurePosixPath(str(model["filename"])).name)
        encoded_filename = quote(str(model["filename"]), safe="/")
        url = f"https://huggingface.co/{model['repo_id']}/resolve/main/{encoded_filename}?download=true"
        command = (
            f"mkdir -p {shlex.quote(str(model['destination_dir']))} && "
            f"if [ -s {shlex.quote(destination)} ]; then true; else "
            f"tmp={shlex.quote(destination + '.partial')}; "
            f"curl --fail --location --output \"$tmp\" {shlex.quote(url)} && "
            f"test -s \"$tmp\" && mv \"$tmp\" {shlex.quote(destination)}; fi"
        )
        lines.append(f"retry_required model-{index} bash -lc {shlex.quote(command)}")
    nodes_root = f"{root}/custom_nodes"
    for index, node in enumerate(manifest.get("custom_nodes", []), start=1):
        name = _safe_node_name(str(node["git_url"]), node.get("name"))
        target = f"{nodes_root}/{name}"
        command = (
            f"mkdir -p {shlex.quote(nodes_root)} && "
            f"if [ -d {shlex.quote(target + '/.git')} ]; then "
            f"git -C {shlex.quote(target)} pull --ff-only; else "
            f"git clone --depth 1 {shlex.quote(str(node['git_url']))} {shlex.quote(target)}; fi"
        )
        lines.append(f"retry_required node-{index} bash -lc {shlex.quote(command)}")
        requirements = f"{target}/requirements.txt"
        install = f"if [ -f {shlex.quote(requirements)} ]; then python -m pip install -r {shlex.quote(requirements)}; else true; fi"
        lines.append(f"retry_required node-deps-{index} bash -lc {shlex.quote(install)}")
    training_script: tuple[str, str] | None = None
    if "training" in manifest:
        if manifest_path is None:
            raise HarnessError("manifest_path is required for a training start script")
        training_script = rendered_training_start_script(manifest, manifest_path)
    if training_script is not None:
        script_path, script_text = training_script
        script_b64 = base64.b64encode(script_text.encode("utf-8")).decode("ascii")
        script_parent = str(PurePosixPath(script_path).parent)
        command = (
            f"mkdir -p {shlex.quote(script_parent)} && "
            f"printf '%s' {shlex.quote(script_b64)} | base64 -d > {shlex.quote(script_path)} && "
            f"chmod 0700 {shlex.quote(script_path)}"
        )
        lines.append(
            f"run_required training-start-script bash -lc {shlex.quote(command)}"
        )
    lines.extend([
        "COMFY_PID=",
        f"start_comfy() {{ cd {shlex.quote(root)} || return 1; bash -lc {shlex.quote('exec ' + start)} >>\"$COMFY_RUNTIME_LOG\" 2>&1 & COMFY_PID=$!; sleep 1; kill -0 \"$COMFY_PID\"; }}",
        "run_required comfy-start start_comfy",
    ])
    health_cmd = (
        f"for n in $(seq 1 120); do curl --silent --fail http://127.0.0.1:{port}/system_stats >/dev/null && exit 0; sleep 2; done; "
        f"tail -n 100 {shlex.quote(COMFY_OUTPUT_DIR + '/_comfy.log')} 2>/dev/null; exit 1"
    )
    lines.append(f"run_required comfy-health bash -lc {shlex.quote(health_cmd)}")
    lines.extend([
        "run_cosmetic disk-summary df -h",
        'log_line "STEP bootstrap-complete rc=0"',
        'wait "$COMFY_PID"',
        "comfy_rc=$?",
        'fatal "ComfyUI exited with rc=$comfy_rc" "$comfy_rc"',
    ])
    return "\n".join(lines) + "\n"


class ComfyClient:
    def __init__(self, base_url: str, session: Any = None):
        if session is None and requests is None:
            raise HarnessError("the requests package is required for live commands")
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()
        if session is None:
            # The Pod proxy is public; never discover credentials from netrc or proxy env.
            self.session.trust_env = False
        if any(
            str(name).lower() == "authorization"
            for name in getattr(self.session, "headers", {})
        ):
            raise HarnessError("the public proxy client must not carry Authorization")
        self.client_id = uuid.uuid4().hex

    def close(self) -> None:
        close = getattr(self.session, "close", None)
        if callable(close):
            close()

    def health_status(self) -> int | str:
        try:
            response = self.session.get(
                self.base_url + "/system_stats", timeout=REQUEST_TIMEOUT,
            )
            return int(response.status_code)
        except Exception as exc:
            return f"error:{type(exc).__name__}"

    def fetch_artifact(self, filename: str) -> tuple[int | str, str]:
        if filename not in {"_bootstrap.log", "_bootstrap.failed"}:
            raise HarnessError(f"unsupported bootstrap artifact: {filename!r}")
        try:
            response = self.session.get(
                self.base_url + "/view",
                params={"filename": filename, "type": "output"},
                timeout=REQUEST_TIMEOUT,
                stream=True,
            )
        except Exception as exc:
            return f"error:{type(exc).__name__}", ""
        status = int(response.status_code)
        if status != 200:
            return status, ""
        limit = 64 * 1024 if filename == "_bootstrap.log" else 4 * 1024
        chunks = getattr(response, "iter_content", None)
        if callable(chunks):
            retained = bytearray()
            for chunk in chunks(chunk_size=8192):
                if not chunk:
                    continue
                retained.extend(chunk)
                if len(retained) > limit:
                    del retained[:-limit]
            body = bytes(retained)
        else:
            body = bytes(getattr(response, "content", b""))[-limit:]
        return status, body.decode("utf-8", errors="replace")

    def upload_file(
        self, local_path: Path, subfolder: str, overwrite: bool,
    ) -> dict[str, str]:
        expected = {
            "name": local_path.name,
            "subfolder": subfolder,
            "type": "input",
        }
        try:
            with local_path.open("rb") as handle:
                response = self.session.post(
                    self.base_url + "/upload/image",
                    files={"image": (local_path.name, handle)},
                    data={
                        "subfolder": subfolder,
                        "type": "input",
                        "overwrite": "true" if overwrite else "false",
                    },
                    timeout=REQUEST_TIMEOUT,
                )
        except OSError as exc:
            raise HarnessError(
                f"ComfyUI upload file could not be read: {type(exc).__name__}"
            ) from exc
        if not 200 <= response.status_code < 300:
            raise HarnessError(
                f"ComfyUI POST /upload/image returned HTTP {response.status_code}"
            )
        try:
            body = response.json()
        except (ValueError, TypeError) as exc:
            raise HarnessError("ComfyUI POST /upload/image returned invalid JSON") from exc
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()
        if not isinstance(body, dict) or any(body.get(key) != value for key, value in expected.items()):
            raise HarnessError("ComfyUI POST /upload/image returned mismatched JSON")
        return expected

    def marker_status(self, filename: str) -> int | str:
        marker = _output_marker_name(filename, "artifact marker", absolute=False)
        try:
            response = self.session.get(
                self.base_url + "/view",
                params={"filename": marker, "type": "output"},
                timeout=REQUEST_TIMEOUT,
                stream=True,
            )
            status = int(response.status_code)
            close = getattr(response, "close", None)
            if callable(close):
                close()
            return status
        except Exception as exc:
            return f"error:{type(exc).__name__}"

    def wait_for_marker(
        self, marker: str, failed_marker: str, timeout: float, watchdog: Watchdog,
    ) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            watchdog.check()
            failed_status = self.marker_status(failed_marker)
            if failed_status == 200:
                raise HarnessError("training failed marker appeared")
            if failed_status != 404:
                raise HarnessError(
                    f"training failed-marker poll returned {failed_status}"
                )
            watchdog.check()
            marker_status = self.marker_status(marker)
            if marker_status == 200:
                return
            if marker_status != 404:
                raise HarnessError(
                    f"artifact marker poll returned {marker_status}"
                )
            time.sleep(1)
        raise HarnessError(f"artifact marker {marker!r} timed out")

    def download_artifact(
        self, remote: str, local_path: Path, timeout: float,
    ) -> None:
        remote_name = _portable_relative_path(remote, "artifact remote").as_posix()
        if PurePosixPath(remote_name).suffix.lower() not in ARTIFACT_EXTENSIONS:
            raise HarnessError("unsupported artifact suffix")
        response = self.session.get(
            self.base_url + "/view",
            params={"filename": remote_name, "type": "output"},
            timeout=timeout,
            stream=True,
        )
        if not 200 <= response.status_code < 300:
            raise HarnessError(
                f"ComfyUI GET /view returned HTTP {response.status_code}"
            )
        temporary = local_path.with_suffix(local_path.suffix + ".partial")
        try:
            local_path.parent.mkdir(parents=True, exist_ok=True)
            with temporary.open("wb") as handle:
                chunks = getattr(response, "iter_content", None)
                if callable(chunks):
                    for chunk in chunks(chunk_size=1024 * 1024):
                        if chunk:
                            handle.write(chunk)
                else:
                    handle.write(bytes(getattr(response, "content", b"")))
            if temporary.stat().st_size <= 0:
                raise HarnessError("artifact download did not have a positive byte count")
            temporary.replace(local_path)
        except OSError as exc:
            raise HarnessError(
                f"artifact download could not be written: {type(exc).__name__}"
            ) from exc
        finally:
            temporary.unlink(missing_ok=True)
            close = getattr(response, "close", None)
            if callable(close):
                close()

    def submit(self, workflow: dict[str, Any]) -> str:
        response = self.session.post(
            self.base_url + "/prompt",
            json={"prompt": workflow, "client_id": self.client_id},
            timeout=REQUEST_TIMEOUT,
        )
        if not 200 <= response.status_code < 300:
            raise HarnessError(f"ComfyUI POST /prompt returned HTTP {response.status_code}")
        prompt_id = response.json().get("prompt_id")
        if not prompt_id:
            raise HarnessError("ComfyUI did not return prompt_id")
        return str(prompt_id)

    def wait_outputs(self, prompt_id: str, timeout: float, watchdog: Watchdog) -> list[dict[str, str]]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            watchdog.check()
            response = self.session.get(self.base_url + f"/history/{prompt_id}", timeout=REQUEST_TIMEOUT)
            if not 200 <= response.status_code < 300:
                raise HarnessError(f"ComfyUI history returned HTTP {response.status_code}")
            history = response.json()
            entry = history.get(prompt_id) if isinstance(history, dict) else None
            if entry:
                status = entry.get("status") or {}
                if status.get("status_str") == "error":
                    raise HarnessError(f"ComfyUI job {prompt_id} failed")
                if status.get("completed") is False:
                    time.sleep(1)
                    continue
                outputs: list[dict[str, str]] = []
                for node in (entry.get("outputs") or {}).values():
                    for image in node.get("images", []):
                        if image.get("filename") and image.get("type") == "output":
                            outputs.append({
                                "filename": str(image["filename"]),
                                "subfolder": str(image.get("subfolder", "")),
                                "type": "output",
                            })
                if outputs:
                    return outputs
                if status.get("completed") is True:
                    raise HarnessError(f"ComfyUI job {prompt_id} completed with zero images")
            time.sleep(1)
        raise HarnessError(f"ComfyUI job {prompt_id} timed out")

    def download_output(self, image: dict[str, str], local_path: Path,
                        timeout: float) -> None:
        params = view_params(image)
        response = self.session.get(
            self.base_url + "/view", params=params, timeout=timeout, stream=True,
        )
        if not 200 <= response.status_code < 300:
            raise HarnessError(
                f"ComfyUI GET /view returned HTTP {response.status_code}"
            )
        local_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = local_path.with_suffix(local_path.suffix + ".partial")
        try:
            with temporary.open("wb") as handle:
                chunks = getattr(response, "iter_content", None)
                if callable(chunks):
                    for chunk in chunks(chunk_size=1024 * 1024):
                        if chunk:
                            handle.write(chunk)
                else:
                    handle.write(bytes(getattr(response, "content", b"")))
            temporary.replace(local_path)
        finally:
            temporary.unlink(missing_ok=True)


class DryRunComfyClient:
    def __init__(self):
        self.counter = 0

    def submit(self, _workflow: dict[str, Any]) -> str:
        self.counter += 1
        return f"dry-prompt-{self.counter}"

    def wait_outputs(self, prompt_id: str, _timeout: float, watchdog: Watchdog) -> list[dict[str, str]]:
        watchdog.check()
        return [{"filename": f"{prompt_id}.png", "subfolder": "", "type": "output"}]

    def health_status(self) -> int:
        return 200

    def fetch_artifact(self, filename: str) -> tuple[int, str]:
        if filename == "_bootstrap.log":
            return 200, "STEP dry-run rc=0\n"
        return 404, ""

    def upload_file(
        self, local_path: Path, subfolder: str, overwrite: bool,
    ) -> dict[str, str]:
        del overwrite
        try:
            if not local_path.is_file() or local_path.stat().st_size < 0:
                raise OSError("not a readable file")
        except OSError as exc:
            raise HarnessError(
                f"ComfyUI upload file could not be read: {type(exc).__name__}"
            ) from exc
        return {"name": local_path.name, "subfolder": subfolder, "type": "input"}

    def wait_for_marker(
        self, _marker: str, _failed_marker: str, _timeout: float, watchdog: Watchdog,
    ) -> None:
        watchdog.check()

    def download_artifact(
        self, remote: str, local_path: Path, _timeout: float,
    ) -> None:
        if PurePosixPath(remote).suffix.lower() not in ARTIFACT_EXTENSIONS:
            raise HarnessError("unsupported artifact suffix")
        local_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = local_path.with_suffix(local_path.suffix + ".partial")
        try:
            temporary.write_bytes(("dry-run artifact from " + remote + "\n").encode())
            temporary.replace(local_path)
        finally:
            temporary.unlink(missing_ok=True)

    def download_output(self, image: dict[str, str], local_path: Path,
                        _timeout: float) -> None:
        view_params(image)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(("dry-run image from " + image["filename"] + "\n").encode())

    def close(self) -> None:
        pass


def apply_job(
    workflow: dict[str, Any], job: dict[str, Any],
    seed_fields: tuple[str, ...] = DEFAULT_SEED_FIELDS,
) -> dict[str, Any]:
    result = copy.deepcopy(workflow)
    if "seed" not in job:
        raise HarnessError("every job requires a seed")
    matched_seed_fields = 0
    for node in result.values():
        inputs = node.get("inputs") if isinstance(node, dict) else None
        if isinstance(inputs, dict):
            for field in seed_fields:
                if field in inputs:
                    inputs[field] = int(job["seed"])
                    matched_seed_fields += 1
    if matched_seed_fields == 0:
        raise HarnessError(
            "workflow has no seed input fields; looked for: " + ", ".join(seed_fields)
        )
    for substitution in job.get("substitutions", []):
        node_id = str(substitution.get("node_id", ""))
        field = str(substitution.get("field", ""))
        if node_id not in result or not field:
            raise HarnessError(f"invalid substitution target node={node_id!r} field={field!r}")
        target = result[node_id]
        parts = field.split(".") if "." in field else ["inputs", field]
        for part in parts[:-1]:
            if not isinstance(target, dict) or part not in target:
                raise HarnessError(f"substitution path not found: {node_id}.{field}")
            target = target[part]
        if not isinstance(target, dict) or parts[-1] not in target:
            raise HarnessError(f"substitution field not found: {node_id}.{field}")
        target[parts[-1]] = substitution.get("value")
    output_name = safe_output_name(job.get("output_name"))
    for node in result.values():
        inputs = node.get("inputs") if isinstance(node, dict) else None
        if isinstance(inputs, dict) and "filename_prefix" in inputs:
            inputs["filename_prefix"] = output_name
    return result


def safe_output_name(value: Any) -> str:
    name = str(value or "")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", name):
        raise HarnessError(f"unsafe or missing output_name: {name!r}")
    return name


def view_params(image: dict[str, str]) -> dict[str, str]:
    if image.get("type") != "output":
        raise HarnessError("ComfyUI returned a non-output image")
    filename = PurePosixPath(image["filename"])
    subfolder = PurePosixPath(image.get("subfolder", ""))
    if filename.is_absolute() or ".." in filename.parts or subfolder.is_absolute() or ".." in subfolder.parts:
        raise HarnessError("ComfyUI returned an unsafe output path")
    if filename.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HarnessError(f"ComfyUI returned unsupported output type: {filename.suffix}")
    return {
        "filename": str(filename),
        "subfolder": "" if str(subfolder) == "." else str(subfolder),
        "type": "output",
    }


def download_job_outputs(comfy: Any, remote_images: list[dict[str, str]], out_dir: Path,
                         output_name: str, timeout: float,
                         expected_images: int = 1) -> list[Path]:
    if expected_images <= 0:
        raise HarnessError("expected_images must be greater than zero")
    if len(remote_images) != expected_images:
        raise HarnessError(
            f"download count verification failed: expected {expected_images}, "
            f"received {len(remote_images)}"
        )
    downloaded: list[Path] = []
    for index, image in enumerate(remote_images, start=1):
        suffix = PurePosixPath(image["filename"]).suffix.lower()
        local_name = f"{output_name}{suffix}" if len(remote_images) == 1 else f"{output_name}_{index:02d}{suffix}"
        local_path = out_dir / local_name
        comfy.download_output(image, local_path, timeout)
        if not local_path.is_file() or local_path.stat().st_size <= 0:
            raise HarnessError(f"download verification failed for {local_path}")
        downloaded.append(local_path)
    if len(downloaded) != expected_images:
        raise HarnessError("download count verification failed")
    return downloaded


def local_file_size(path: Path, label: str, *, positive: bool) -> int:
    """Verify a new local file without reflecting its local path on failure."""
    try:
        if not path.is_file():
            raise HarnessError(f"{label} verification failed: file is missing")
        size = path.stat().st_size
    except HarnessError:
        raise
    except OSError as exc:
        raise HarnessError(
            f"{label} size could not be verified: {type(exc).__name__}"
        ) from exc
    if positive and size <= 0:
        raise HarnessError(f"{label} verification failed: expected a positive byte count")
    return size


def write_json(path: Path, value: Any, redactor: ApiKeyRedactionFilter | None) -> None:
    text = json.dumps(value, indent=2, ensure_ascii=False, default=str) + "\n"
    if redactor:
        text = redactor.redact(text)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def append_cost_row(ledger_dir: Path, gpu: str, step: str, usd: float) -> Path:
    ledger_dir.mkdir(parents=True, exist_ok=True)
    path = ledger_dir / f"figment-{datetime.now(timezone.utc):%Y-%m-%d}.tsv"
    needs_header = not path.exists() or path.stat().st_size == 0
    with path.open("a", encoding="utf-8", newline="") as handle:
        if needs_header:
            handle.write("model\tstep\tusd\n")
        handle.write(f"{gpu}\t{step}\t{usd:.6f}\n")
    return path


@contextmanager
def exclusive_ledger_lock(path: Path, timeout: float = LEDGER_LOCK_TIMEOUT):
    lock_path = path.with_suffix(path.suffix + ".lock")
    deadline = time.monotonic() + timeout
    descriptor: int | None = None
    while descriptor is None:
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError as exc:
            if time.monotonic() >= deadline:
                raise HarnessError(f"timed out waiting for cost ledger lock: {lock_path}") from exc
            time.sleep(0.01)
        except OSError as exc:
            raise HarnessError(f"could not acquire cost ledger lock {lock_path}: {exc}") from exc
    try:
        os.write(descriptor, f"{os.getpid()}\n".encode("ascii"))
        os.close(descriptor)
        descriptor = None
        yield
    finally:
        if descriptor is not None:
            os.close(descriptor)
        try:
            lock_path.unlink(missing_ok=True)
        except OSError as exc:
            raise HarnessError(f"could not release cost ledger lock {lock_path}: {exc}") from exc


def upsert_cost_row(ledger_dir: Path, model: str, step: str, usd: float) -> Path:
    if any(char in model + step for char in "\t\r\n"):
        raise HarnessError("ledger model and step must be single TSV fields")
    ledger_dir.mkdir(parents=True, exist_ok=True)
    path = ledger_dir / f"figment-{datetime.now(timezone.utc):%Y-%m-%d}.tsv"
    with exclusive_ledger_lock(path):
        rows: list[dict[str, str]] = []
        if path.exists() and path.stat().st_size:
            with path.open("r", encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle, delimiter="\t")
                if reader.fieldnames != ["model", "step", "usd"]:
                    raise HarnessError(f"unexpected cost ledger schema: {path}")
                rows = list(reader)
        replacement = {"model": model, "step": step, "usd": f"{usd:.6f}"}
        replaced = False
        for index, row in enumerate(rows):
            if row.get("model") == model and row.get("step") == step:
                rows[index] = replacement
                replaced = True
                break
        if not replaced:
            rows.append(replacement)
        temporary = path.with_name(
            f"{path.name}.{os.getpid()}.{time.time_ns()}.tmp"
        )
        try:
            with temporary.open("x", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(
                    handle, fieldnames=["model", "step", "usd"], delimiter="\t",
                    lineterminator="\n",
                )
                writer.writeheader()
                writer.writerows(rows)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return path


def gpu_model_label(gpu_type: Any) -> str:
    short = re.sub(r"^(?:NVIDIA\s+)?(?:GeForce\s+)?", "", str(gpu_type), flags=re.IGNORECASE)
    short = re.sub(r"[^A-Za-z0-9]+", "-", short).strip("-").lower()
    if not short:
        raise HarnessError("gpu.type cannot be converted to a ledger model name")
    return f"runpod:{short}"


def run_harness(manifest: dict[str, Any], manifest_path: Path, out_dir: Path, *,
                max_usd: float | None, max_minutes: float, dry_run: bool,
                api: Any | None = None, logger: logging.Logger | None = None,
                redactor: ApiKeyRedactionFilter | None = None,
                comfy_factory: Callable[[str], Any] | None = None,
                sleep: Callable[[float], None] = time.sleep,
                ledger_dir: Path | None = None,
                 budget_path: Path | None = None) -> dict[str, Any]:
    require_manifest(manifest, manifest_path)
    upload_items = expand_manifest_uploads(manifest, manifest_path)
    artifacts = manifest_artifacts(manifest)
    failed_marker = training_failed_marker_name(manifest) if artifacts else None
    max_minutes = effective_max_minutes(max_minutes, manifest)
    enforce_effective_readiness_budget(manifest, max_minutes)
    if not dry_run and max_usd is None:
        raise HarnessError("--max-usd is required for a live run")
    estimate = estimate_cost(manifest, max_minutes, max_usd)
    logger = logger or build_logger(redactor)
    if redactor:
        set_active_redactor(redactor)
    ledger_target = (
        out_dir / "dry-run-ledger"
        if dry_run and ledger_dir is None else configured_ledger_dir(ledger_dir)
    )
    logger.info("cost ledger directory: %s", ledger_target)
    daily_limit: float | None = None
    daily_spent: float | None = None
    if not dry_run:
        daily_limit, daily_spent = enforce_daily_budget(
            estimate,
            budget_path=budget_path,
            ledger_dir=ledger_target,
            logger=logger,
        )
    logger.info("preflight cost estimate: $%.4f for %.2f minute(s)", estimate, max_minutes)
    out_dir.mkdir(parents=True, exist_ok=True)
    if api is None:
        api = DryRunAPI(float(manifest["price_usd_per_hour"])) if dry_run else None
    if api is None:
        raise HarnessError("live run requires an authenticated API")

    payload = create_payload(manifest, manifest_path)
    ledger_model = gpu_model_label(manifest["gpu"]["type"])
    started = time.monotonic()  # The budget clock begins immediately before create.
    started_utc = datetime.now(timezone.utc).replace(microsecond=0)
    result: dict[str, Any] = {
        "schema": "figment/runpod-run@1",
        "dry_run": dry_run,
        "pod_id": None,
        "gpu": manifest["gpu"],
        "started_utc": started_utc.isoformat(timespec="seconds"),
        "max_minutes": max_minutes,
        "preflight_estimate_usd": round(estimate, 6),
        "uploads": [],
        "jobs": [],
        "artifacts": [],
        "termination_verified": False,
    }
    if daily_limit is not None and daily_spent is not None:
        result["daily_usd_limit"] = daily_limit
        result["daily_usd_before_create"] = round(daily_spent, 6)
    images_manifest: list[dict[str, Any]] = []

    def record_acquired(pod_id: str, _pod: dict[str, Any] | None) -> None:
        result["pod_id"] = pod_id
        cost_path = upsert_cost_row(
            ledger_target,
            ledger_model,
            f"pod-create {pod_id}",
            0.0 if dry_run else estimate,
        )
        logger.info("provisional cost row: %s", cost_path)

    lease = PodLease(
        api, payload, logger, sleep=sleep, on_acquired=record_acquired,
        started_utc=started_utc,
    )
    cancel = threading.Event()
    watchdog: Watchdog | None = None
    proxy_client: Any | None = None
    caught: BaseException | None = None
    actual_hourly: float | None = None

    def retain_finalization_failure(label: str, secondary: BaseException) -> None:
        nonlocal caught
        logger.error(
            "secondary finalization failure during %s: %s: %s",
            label, type(secondary).__name__, secondary,
        )
        if caught is None:
            caught = secondary
            result["error"] = f"{type(secondary).__name__}: {secondary}"

    try:
        with shutdown_signals(cancel), lease:
            result["pod_id"] = lease.pod_id
            watchdog = Watchdog(
                max(1.0, max_minutes * 60.0 - (time.monotonic() - started)),
                lease,
                cancel,
                logger,
            )
            watchdog.start()
            ready_timeout = min(
                manifest_readiness_timeout_seconds(manifest), max_minutes * 60.0,
            )
            proxy_url = pod_proxy_url(str(lease.pod_id), COMFY_PORT)
            if dry_run:
                proxy_client = DryRunComfyClient()
            else:
                proxy_client = (
                    comfy_factory(proxy_url) if comfy_factory else ComfyClient(proxy_url)
                )
            ready_pod = wait_ready(
                api, str(lease.pod_id), ready_timeout, watchdog, logger,
                proxy_client, sleep,
            )
            actual_hourly = ready_hourly_price(ready_pod)
            actual_ceiling = actual_hourly * max_minutes / 60.0
            if max_usd is not None and actual_ceiling > max_usd:
                raise HarnessError("READY pod hourly price exceeds the approved --max-usd budget")
            if (daily_limit is not None and daily_spent is not None
                    and daily_spent + actual_ceiling > daily_limit):
                raise HarnessError("READY pod hourly price exceeds the governance daily budget")
            watchdog.check()
            comfy = proxy_client
            per_job_timeout = float(manifest.get("job_timeout_seconds", 15 * 60))
            for item in upload_items:
                watchdog.check()
                response = comfy.upload_file(
                    item.local_path, item.subfolder, item.overwrite,
                )
                byte_count = local_file_size(
                    item.local_path, "uploaded file", positive=False,
                )
                result["uploads"].append({
                    "name": response["name"],
                    "subfolder": response["subfolder"],
                    "type": response["type"],
                    "overwrite": item.overwrite,
                    "bytes": byte_count,
                })
                logger.info(
                    "upload complete: %s/%s bytes=%d",
                    item.subfolder, item.remote_name, byte_count,
                )

            if artifacts:
                for artifact in artifacts:
                    watchdog.check()
                    marker = artifact["wait_for"]
                    assert failed_marker is not None
                    comfy.wait_for_marker(
                        marker, failed_marker, per_job_timeout, watchdog,
                    )
                    logger.info("artifact marker ready: %s", marker)
                    local_relative = PurePosixPath(artifact["local"])
                    local_path = out_dir.joinpath(*local_relative.parts)
                    comfy.download_artifact(
                        artifact["remote"], local_path, per_job_timeout,
                    )
                    byte_count = local_file_size(
                        local_path, "artifact download", positive=True,
                    )
                    artifact_result = {
                        "remote": artifact["remote"],
                        "path": local_relative.as_posix(),
                        "type": "output",
                        "wait_for": marker,
                        "bytes": byte_count,
                    }
                    result["artifacts"].append(artifact_result)
                    logger.info(
                        "artifact complete: %s bytes=%d",
                        artifact["remote"], artifact_result["bytes"],
                    )
            else:
                base_workflow = load_workflow(manifest, manifest_path)
                for job_number, job in enumerate(manifest["jobs"], start=1):
                    watchdog.check()
                    job_started = time.monotonic()
                    output_name = safe_output_name(job.get("output_name"))
                    workflow = apply_job(base_workflow, job, manifest_seed_fields(manifest))
                    prompt_id = comfy.submit(workflow)
                    remote_images = comfy.wait_outputs(prompt_id, per_job_timeout, watchdog)
                    expected_images = job.get("expected_images", 1)
                    if isinstance(expected_images, bool) or not isinstance(expected_images, int):
                        raise HarnessError("job expected_images must be a positive integer")
                    paths = download_job_outputs(
                        comfy, remote_images, out_dir, output_name,
                        per_job_timeout, expected_images,
                    )
                    job_result = {
                        "job": job_number,
                        "output_name": output_name,
                        "seed": int(job["seed"]),
                        "prompt_id": prompt_id,
                        "seconds": round(time.monotonic() - job_started, 3),
                        "files": [{"path": path.name, "bytes": path.stat().st_size} for path in paths],
                    }
                    result["jobs"].append(job_result)
                    for index, path in enumerate(paths, start=1):
                        image_id = output_name if len(paths) == 1 else f"{output_name}_{index:02d}"
                        images_manifest.append({
                            "image_id": image_id,
                            "path": path.name,
                            "review_status": "unreviewed",
                            "parked_reasons": [],
                        })
                    logger.info("job %s complete: %d verified file(s)", output_name, len(paths))
            if watchdog:
                watchdog.check()
    except BaseException as exc:
        caught = exc
        result["error"] = f"{type(exc).__name__}: {exc}"
        if isinstance(exc, ReadinessTimeout):
            result["last_pod_state"] = exc.last_pod_state
        if isinstance(exc, BootstrapFailed):
            result["bootstrap_log_tail"] = exc.bootstrap_log_tail
    finally:
        try:
            if proxy_client is not None:
                close_proxy = getattr(proxy_client, "close", None)
                if callable(close_proxy):
                    close_proxy()
        except BaseException as secondary:
            retain_finalization_failure("proxy client close", secondary)
        try:
            if watchdog:
                watchdog.stop(teardown_budget_seconds(lease.attempts))
                if caught is None and watchdog.error:
                    caught = watchdog.error
                    result["error"] = f"{type(caught).__name__}: {caught}"
                elif caught is None and watchdog.fired.is_set():
                    caught = RunCancelled("maximum runtime reached")
                    result["error"] = f"{type(caught).__name__}: {caught}"
        except BaseException as secondary:
            retain_finalization_failure("watchdog stop", secondary)
        try:
            pod_id, _pod_name, verified = lease.snapshot()
            result["pod_id"] = pod_id or result["pod_id"]
            if lease.create_error:
                result["create_error"] = lease.create_error
            result["termination_verified"] = verified
            elapsed = time.monotonic() - started
            result["finished_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            result["elapsed_seconds"] = round(elapsed, 3)
            result["hourly_price_usd"] = actual_hourly
            settled_cost, cost_basis = settled_cost_estimate(
                elapsed_seconds=elapsed,
                dry_run=dry_run,
                ready_hourly_price_usd=actual_hourly,
                manifest_hourly_price_usd=float(manifest["price_usd_per_hour"]),
                preflight_estimate_usd=estimate,
                termination_verified=verified,
            )
            result["estimated_actual_usd"] = round(settled_cost, 6)
            result["estimated_actual_usd_basis"] = cost_basis
        except BaseException as secondary:
            retain_finalization_failure("result accounting", secondary)
        try:
            write_json(out_dir / "run.json", result, redactor)
        except BaseException as secondary:
            retain_finalization_failure("run.json write", secondary)
        if images_manifest:
            try:
                write_json(out_dir / "manifest.json", {"images": images_manifest}, redactor)
            except BaseException as secondary:
                retain_finalization_failure("manifest.json write", secondary)
        if result["pod_id"]:
            try:
                cost_path = upsert_cost_row(
                    ledger_target,
                    ledger_model,
                    f"pod-create {result['pod_id']}",
                    float(result["estimated_actual_usd"]),
                )
                logger.info("cost row: %s", cost_path)
            except BaseException as secondary:
                retain_finalization_failure("cost ledger write", secondary)
    if caught is None and not result["termination_verified"]:
        caught = PodStillRunning(f"POD STILL RUNNING {result['pod_id'] or 'UNKNOWN'}")
    if caught:
        raise attach_lease_status(caught, lease)
    return result


def command_run(args: argparse.Namespace) -> int:
    manifest_path = resolve_manifest_path(args.manifest)
    manifest = load_manifest(manifest_path)
    if not args.dry_run and args.max_usd is None:
        raise HarnessError("--max-usd is required for a live run")
    max_minutes = effective_max_minutes(args.max_minutes, manifest)
    session: Any = None
    redactor: ApiKeyRedactionFilter | None = None
    api: Any | None = None
    if not args.dry_run:
        try:
            session, redactor = build_authenticated_session()
        except KeyError as exc:
            raise HarnessError("RUNPOD_API_KEY is required for live commands") from exc
        set_active_redactor(redactor)
        api = RunPodAPI(session)
    logger = build_logger(redactor)
    try:
        result = run_harness(
            manifest,
            manifest_path,
            args.out.resolve(),
            max_usd=args.max_usd,
            max_minutes=max_minutes,
            dry_run=args.dry_run,
            api=api,
            logger=logger,
            redactor=redactor,
            ledger_dir=args.ledger_dir,
        )
        if not result["termination_verified"]:
            error = PodStillRunning(f"POD STILL RUNNING {result['pod_id'] or 'UNKNOWN'}")
            setattr(error, "pod_id", result["pod_id"])
            setattr(error, "termination_verified", False)
            raise error
        logger.info("exit path complete: terminate + absence verification succeeded")
        return 0
    finally:
        if session:
            session.close()


def command_terminate(args: argparse.Namespace) -> int:
    try:
        session, redactor = build_authenticated_session()
    except KeyError as exc:
        raise HarnessError("RUNPOD_API_KEY is required for live commands") from exc
    set_active_redactor(redactor)
    logger = build_logger(redactor)
    lease = PodLease(RunPodAPI(session), None, logger, pod_id=args.pod_id)
    try:
        with lease:
            pass
        return 0
    except BaseException as exc:
        raise attach_lease_status(exc, lease)
    finally:
        session.close()


def command_status(_args: argparse.Namespace) -> int:
    try:
        session, redactor = build_authenticated_session()
    except KeyError as exc:
        raise HarnessError("RUNPOD_API_KEY is required for live commands") from exc
    set_active_redactor(redactor)
    try:
        pods = RunPodAPI(session).list_pods()
        safe = [{
            "id": pod.get("id"),
            "name": pod.get("name"),
            "desiredStatus": pod.get("desiredStatus"),
            "gpu": pod.get("gpu"),
            "costPerHr": pod.get("adjustedCostPerHr") or pod.get("costPerHr"),
            "publicIp": pod.get("publicIp"),
            "portMappings": pod.get("portMappings"),
        } for pod in pods]
        print(redactor.redact(json.dumps(safe, indent=2, default=str)))
        return 0
    finally:
        session.close()


def response_shape(value: Any, key: str | None = None) -> Any:
    """Retain response keys and status values while suppressing account data."""
    if isinstance(value, dict):
        return {str(child_key): response_shape(child, str(child_key))
                for child_key, child in value.items()}
    if isinstance(value, list):
        return [response_shape(child, key) for child in value]
    if key in {"desiredStatus", "currentStatus", "status", "runtimeStatus"}:
        return value
    if value is None:
        return "<null>"
    if isinstance(value, bool):
        return "<boolean>"
    if isinstance(value, (int, float)):
        return "<number>"
    return "<string>"


def command_probe(_args: argparse.Namespace) -> int:
    """Read only: list Pods and print their redacted structural shape."""
    try:
        session, redactor = build_authenticated_session()
    except KeyError as exc:
        raise HarnessError("RUNPOD_API_KEY is required for live commands") from exc
    set_active_redactor(redactor)
    try:
        pods = RunPodAPI(session).list_pods()
        safe_shape = response_shape(pods)
        print(redactor.redact(json.dumps(safe_shape, indent=2, default=str)))
        return 0
    finally:
        session.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run a bounded ComfyUI bake-off")
    run.add_argument("--manifest", required=True, type=Path)
    run.add_argument("--out", required=True, type=Path)
    run.add_argument("--dry-run", action="store_true", help="exercise every local stage with no network")
    run.add_argument("--max-usd", type=float)
    run.add_argument("--max-minutes", type=float)
    run.add_argument(
        "--ledger-dir", type=Path,
        help="cost ledger root (fallback: KB_LEDGER_DIR, ops worktree, then repo ledger)",
    )
    run.set_defaults(func=command_run)
    terminate = sub.add_parser("terminate", help="terminate a pod and verify it is absent")
    terminate.add_argument("--pod-id", required=True)
    terminate.set_defaults(func=command_terminate)
    status = sub.add_parser("status", help="list pods and their billing status")
    status.set_defaults(func=command_status)
    probe = sub.add_parser(
        "probe", help="read-only GET /pods response-shape probe",
    )
    probe.set_defaults(func=command_probe)
    return parser


def main(argv: list[str] | None = None) -> int:
    sys.excepthook = redacting_excepthook
    args = build_parser().parse_args(argv)

    def report(exc: BaseException, summary: str) -> None:
        safe_summary = redact_for_stderr(summary)
        print(safe_summary, file=sys.stderr)
        if getattr(exc, "termination_verified", True) is False:
            banner = getattr(exc, "fail_closed_banner", None)
            if banner:
                safe_banner = redact_for_stderr(banner)
                if safe_banner != safe_summary:
                    print(safe_banner, file=sys.stderr)
                return
            pod_id = getattr(exc, "pod_id", None)
            if pod_id:
                print(
                    f"POD STILL RUNNING {pod_id} — run: terminate --pod-id {pod_id}",
                    file=sys.stderr,
                )
            else:
                name = getattr(exc, "pod_name", None) or "UNKNOWN"
                print(f"POD STILL RUNNING {name} — run: status", file=sys.stderr)

    try:
        return int(args.func(args))
    except KeyboardInterrupt as exc:
        report(exc, "interrupted")
        return 130
    except RunCancelled as exc:
        report(exc, str(exc))
        return 128
    except HarnessError as exc:
        report(exc, str(exc))
        return 1
    except BaseException as exc:
        redacting_excepthook(type(exc), exc, exc.__traceback__)
        if getattr(exc, "termination_verified", True) is False:
            report(exc, "unexpected failure")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
