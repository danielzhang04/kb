#!/usr/bin/env python3
"""Bounded RunPod/ComfyUI bake-off runner with verified pod teardown."""

from __future__ import annotations

import argparse
import atexit
import base64
import calendar
import copy
import csv
import hashlib
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
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    import requests
except ModuleNotFoundError:  # --dry-run and the stubbed tests remain intentionally offline.
    requests = None  # type: ignore[assignment]


API_BASE = "https://rest.runpod.io/v1"
DEFAULT_MAX_MINUTES = 14 * 60.0
DEFAULT_READY_TIMEOUT = 15 * 60.0
DEFAULT_MAX_PLACEMENT_ATTEMPTS = 1
BAD_HOST_TTL_SECONDS = 24 * 60 * 60
REQUEST_TIMEOUT = 30.0
TERMINATE_ATTEMPTS = 5
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
ARTIFACT_EXTENSIONS = {".safetensors", ".json", ".txt", ".log"}
UPLOAD_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".txt", ".toml", ".json",
    ".safetensors", ".ready",
}
MAX_UPLOAD_FILE_BYTES = 2 * 1024 ** 3
MAX_UPLOAD_TOTAL_BYTES = 10 * 1024 ** 3
ARTIFACT_MIN_BYTES_WITHOUT_LENGTH = {
    ".safetensors": 1024,
    ".json": 2,
    ".txt": 1,
    ".log": 1,
}
TRANSIENT_MARKER_HTTP_STATUSES = {502, 503, 504}
TRANSIENT_MARKER_ERROR_TYPES = {
    "ConnectionError", "ConnectionResetError", "ConnectTimeout", "ReadTimeout",
    "Timeout", "TimeoutError",
}
PERSISTENT_MARKER_502_SECONDS = 5 * 60.0
TRAINING_DIAGNOSTIC_FILENAMES = ("_training.heartbeat", "_training.log")
# The heartbeat file can legitimately change on every poll cycle (it is a live
# counter); throttle its "saved" log line so an unchanged-content guard alone
# does not still spam once-every-~7s heartbeat log lines.
HEARTBEAT_DIAGNOSTIC_LOG_MIN_INTERVAL_SECONDS = 60.0
DEFAULT_SEED_FIELDS = ("seed", "noise_seed")
COMFY_PORT = 8188
COMFY_OUTPUT_DIR = "/workspace/output"
BOOTSTRAP_LOG_EVERY_POLLS = 5
BOOTSTRAP_LOG_TAIL_LINES = 20
OPS_LEDGER_DIR = Path("C:/Users/danie/kb-worktrees/dashboard-ops/ledgers/cost")
LEDGER_LOCK_TIMEOUT = 5.0
DEFAULT_COMFY_SOURCE_URL = "https://github.com/comfyanonymous/ComfyUI"
DEFAULT_ARC_CAP_USD = 50.0
DEFAULT_ARC_LEDGER_GLOB = "figment-*.tsv"
TRAINING_IDENTIFIER_PLACEHOLDERS = {"trigger", "git_ref", "diffusion_pipe_git_ref"}
ENV_SECRET_NAME_RE = re.compile(r"[A-Z][A-Z0-9_]*")
RUNPOD_SECRET_REF_PATTERN = re.compile(r"\{\{\s*RUNPOD_SECRET_[A-Za-z0-9_]*\s*\}\}")
GOVERNANCE_TIMEZONE_NAME = "America/New_York"
try:
    GOVERNANCE_TIMEZONE = ZoneInfo(GOVERNANCE_TIMEZONE_NAME)
except ZoneInfoNotFoundError:  # Windows Python may not ship the optional tzdata package.
    GOVERNANCE_TIMEZONE = None
HF_REVISION_RE = re.compile(r"(?:[0-9A-Fa-f]{40}|[A-Za-z0-9][A-Za-z0-9._/-]{0,127})")
GIT_COMMIT_RE = re.compile(r"[0-9A-Fa-f]{40}")


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


class TransientProxyError(HarnessError):
    """A proxy transport failure that is safe to retry within the job budget."""


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


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def governance_ledger_day(instant: datetime | None = None) -> str:
    """Return the America/New_York operating date for one captured instant."""
    instant = utc_now() if instant is None else instant
    if instant.tzinfo is None:
        raise HarnessError("governance ledger day requires a timezone-aware datetime")
    if GOVERNANCE_TIMEZONE is not None:
        eastern = instant.astimezone(GOVERNANCE_TIMEZONE)
    else:
        # US Eastern has observed the current second-Sunday-in-March / first-Sunday-
        # in-November rule since 2007. Compute the UTC transition instants so the
        # governance day remains correct without an undeclared tzdata dependency.
        instant_utc = instant.astimezone(timezone.utc)
        year = instant_utc.year
        march_first_weekday, _ = calendar.monthrange(year, 3)
        first_march_sunday = 1 + (6 - march_first_weekday) % 7
        second_march_sunday = first_march_sunday + 7
        november_first_weekday, _ = calendar.monthrange(year, 11)
        first_november_sunday = 1 + (6 - november_first_weekday) % 7
        dst_start = datetime(year, 3, second_march_sunday, 7, tzinfo=timezone.utc)
        dst_end = datetime(year, 11, first_november_sunday, 6, tzinfo=timezone.utc)
        offset_hours = -4 if dst_start <= instant_utc < dst_end else -5
        eastern = instant_utc.astimezone(timezone(timedelta(hours=offset_hours)))
    return eastern.strftime("%Y-%m-%d")


@dataclass(frozen=True)
class UploadItem:
    """One validated local file and its ComfyUI input destination."""

    local_path: Path
    remote_name: str
    subfolder: str
    overwrite: bool
    size_bytes: int | None


class ApiKeyRedactionFilter(logging.Filter):
    """Redact the key without storing a second copy outside Session.headers."""

    def __init__(self, session: Any):
        super().__init__()
        self._session = session

    def redact(self, value: Any) -> str:
        text = str(value)
        auth = self._session.headers.get("Authorization", "")
        key = auth.removeprefix("Bearer ")
        if key:
            text = text.replace(key, "[REDACTED]")
        # These are never sensitive by themselves (the RunPod reference string carries no
        # secret value, and HF_TOKEN is just a name) but keep them out of logs/run.json too.
        text = text.replace("HF_TOKEN", "[REDACTED]")
        text = RUNPOD_SECRET_REF_PATTERN.sub("[REDACTED]", text)
        return text

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


def session_bad_hosts_path() -> Path:
    local_appdata = os.environ.get("LOCALAPPDATA")
    if local_appdata:
        return Path(local_appdata) / "kb-figment-pod" / "bad_hosts.json"
    return Path.home() / "AppData" / "Local" / "kb-figment-pod" / "bad_hosts.json"


def _recent_bad_host_entries(
        path: Path, *, now: datetime | None = None,
        logger: logging.Logger | None = None) -> list[dict[str, str]]:
    now = now or utc_now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        if logger:
            logger.warning("ignoring unreadable bad-host file %s: %s", path, exc)
        return []
    raw_entries = data.get("hosts") if isinstance(data, dict) else None
    if not isinstance(raw_entries, list):
        if logger:
            logger.warning("ignoring malformed bad-host file %s", path)
        return []
    recent: dict[str, dict[str, str]] = {}
    for raw in raw_entries:
        if not isinstance(raw, dict):
            continue
        host = raw.get("host")
        reason = raw.get("reason")
        timestamp = raw.get("timestamp")
        if (not isinstance(host, str) or not host.strip()
                or not isinstance(reason, str) or not isinstance(timestamp, str)):
            continue
        try:
            recorded = parse_remote_timestamp(timestamp)
        except (TypeError, ValueError, OverflowError):
            continue
        age_seconds = (now - recorded).total_seconds()
        if 0 <= age_seconds < BAD_HOST_TTL_SECONDS:
            entry = {
                "host": host.strip(),
                "timestamp": recorded.isoformat(timespec="seconds"),
                "reason": reason,
            }
            previous = recent.get(entry["host"])
            if previous is None or entry["timestamp"] > previous["timestamp"]:
                recent[entry["host"]] = entry
    return sorted(recent.values(), key=lambda item: item["host"])


def load_recent_bad_hosts(
        path: Path, *, now: datetime | None = None,
        logger: logging.Logger | None = None) -> set[str]:
    return {
        entry["host"]
        for entry in _recent_bad_host_entries(path, now=now, logger=logger)
    }


def record_bad_machine_host(
        path: Path, host: str, reason: str, *, now: datetime | None = None) -> None:
    now = now or utc_now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    clean_host = str(host).strip()
    if not clean_host or any(char in clean_host for char in "\r\n\t"):
        raise HarnessError("machine host is unsafe for the bad-host cache")
    entries = {
        entry["host"]: entry
        for entry in _recent_bad_host_entries(path, now=now)
    }
    entries[clean_host] = {
        "host": clean_host,
        "timestamp": now.isoformat(timespec="seconds"),
        "reason": " ".join(str(reason).split())[:500],
    }
    write_json(
        path,
        {"schema": "figment/bad-hosts@1", "hosts": sorted(
            entries.values(), key=lambda item: item["host"],
        )},
        None,
    )


def forget_bad_host(path: Path, host: str) -> bool:
    """Remove one mislearned entry from a bad-host cache file.

    Returns True when an entry for `host` was present and removed, False when the
    file was absent, malformed, or held no entry for that host (a no-op either
    way — this never raises for a missing cache or a host that was never learned).
    """
    clean_host = str(host).strip()
    if not path.is_file():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False
    raw_entries = data.get("hosts") if isinstance(data, dict) else None
    if not isinstance(raw_entries, list):
        return False
    remaining = [
        entry for entry in raw_entries
        if not (isinstance(entry, dict) and entry.get("host") == clean_host)
    ]
    if len(remaining) == len(raw_entries):
        return False
    write_json(path, {"schema": "figment/bad-hosts@1", "hosts": remaining}, None)
    return True


def pod_machine_identity(pod: dict[str, Any]) -> tuple[str | None, str | None]:
    machine = pod.get("machine") if isinstance(pod.get("machine"), dict) else {}
    raw_host = (
        machine.get("podHostId") or machine.get("hostId")
        or machine.get("id") or pod.get("machineId")
    )
    raw_id = machine.get("id") or pod.get("machineId")
    host = str(raw_host) if raw_host not in (None, "") else None
    machine_id = str(raw_id) if raw_id not in (None, "") else None
    return host, machine_id


def bootstrap_network_failure_reason(exc: BootstrapFailed) -> str | None:
    text = "\n".join([str(exc), *exc.bootstrap_log_tail])
    lowered = text.lower()
    network_class = (
        "could not read username" in lowered
        or "could not resolve host" in lowered
        or bool(re.search(r"(?:comfy|git|node)[^\n]*rc=128\b", lowered))
        or bool(re.search(r"\brc=(?:6|7|28|35)\b", lowered))
        or bool(re.search(
            r"(?:huggingface|hf)[^\n]*(?:http[^\n]*)?(?:403|429)\b|"
            r"(?:403|429)[^\n]*(?:huggingface|hf)",
            lowered,
        ))
    )
    if not network_class:
        return None
    return " ".join(str(exc).split())[:500]


def bootstrap_host_class_failure_reason(exc: BootstrapFailed) -> str | None:
    """Return a cacheable reason only for evidence that the *machine* is unusable.

    Restricted to GPU/Torch preflight (missing/broken CUDA driver): `gpu-present`
    (a non-empty `nvidia-smi -L`) and `torch-cuda` (`torch.cuda.is_available()`).
    ComfyUI import-smoke and ComfyUI health are deliberately excluded — those steps
    run our own pinned Python/package set, so a failure there is evidence about the
    image/dependency pins, not about the machine. See
    `bootstrap_dependency_failure_reason` for that class.
    """
    text = "\n".join([str(exc), *exc.bootstrap_log_tail])
    match = re.search(
        r"\b(gpu-present|torch-cuda) failed(?: with rc=\d+)?",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    return " ".join(str(exc).split())[:500]


def bootstrap_dependency_failure_reason(exc: BootstrapFailed) -> str | None:
    """Return a reason for a bootstrap failure that is an image/pin problem, not a
    machine problem: ComfyUI import-smoke, ComfyUI health, the ComfyUI install step
    (which includes `pip install -r requirements.txt`), or a custom node's
    `pip install` of its own requirements. These must never be learned as a bad
    machine host — the same machine, with a fixed image, would pass.
    """
    text = "\n".join([str(exc), *exc.bootstrap_log_tail])
    match = re.search(
        r"\b(comfy-import-smoke|comfy-health|comfy-install|node-deps-\d+) failed"
        r"(?: after \d+ attempts)?(?: with rc=\d+)?",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    return " ".join(str(exc).split())[:500]


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


def prepare_dry_run_manifest(
        manifest: dict[str, Any], manifest_path: Path) -> dict[str, Any]:
    """Substitute inert values so an unrendered manifest template can be dry-run."""
    if ".template." not in manifest_path.name:
        return manifest

    def placeholder_value(name: str) -> str:
        normalized = re.sub(r"[^A-Za-z0-9_.-]+", "-", name).strip("-")
        return f"dry-{normalized or 'value'}"

    def visit(value: Any) -> Any:
        if isinstance(value, dict):
            return {str(key): visit(child) for key, child in value.items()}
        if isinstance(value, list):
            return [visit(child) for child in value]
        if not isinstance(value, str):
            return copy.deepcopy(value)
        stripped = value.strip()
        if stripped == "{{winning_arm_models}}":
            return []
        if stripped == "{{winning_arm_workflow}}":
            return {
                "1": {"class_type": "KSampler", "inputs": {"seed": 1}},
            }
        return re.sub(
            r"{{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}",
            lambda match: placeholder_value(match.group(1)),
            value,
        )

    prepared = visit(manifest)
    assert isinstance(prepared, dict)
    return prepared


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
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", value):
        raise HarnessError(
            "upload subfolder must be an identifier using only A-Z, a-z, 0-9, _, ., or -"
        )
    return value


def expand_manifest_uploads(
    manifest: dict[str, Any], manifest_path: Path, *, allow_missing: bool = False,
) -> list[UploadItem]:
    """Validate and deterministically expand the optional uploads block."""
    if "uploads" not in manifest:
        return []
    groups = manifest["uploads"]
    if not isinstance(groups, list) or not groups:
        raise HarnessError("manifest uploads must be a non-empty list when present")

    root = manifest_path.parent.resolve()
    expanded: list[UploadItem] = []
    remote_destinations: set[tuple[str, str]] = set()
    total_bytes = 0
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
                if not allow_missing:
                    raise HarnessError(
                        f"upload files item {pattern_number} matched no files"
                    )
                matches = [root.joinpath(*pattern.parts)]
            for match in matches:
                try:
                    local_path = match.resolve()
                except (OSError, ValueError) as exc:
                    raise HarnessError(
                        f"upload file could not be resolved: {type(exc).__name__}"
                    ) from exc
                if not local_path.is_relative_to(root):
                    raise HarnessError("upload file traversal outside the manifest directory is forbidden")
                missing = not local_path.exists()
                if not local_path.is_file() and not (allow_missing and missing):
                    raise HarnessError("upload files may not match directories")
                remote_name = local_path.name
                suffix = local_path.suffix.lower()
                if suffix not in UPLOAD_EXTENSIONS:
                    raise HarnessError(
                        "unsupported upload suffix; allowed suffixes are: "
                        + ", ".join(sorted(UPLOAD_EXTENSIONS))
                    )
                size_bytes: int | None = None
                if not missing:
                    try:
                        size_bytes = local_path.stat().st_size
                    except OSError as exc:
                        raise HarnessError(
                            f"upload file size could not be read: {type(exc).__name__}"
                        ) from exc
                    if size_bytes > MAX_UPLOAD_FILE_BYTES:
                        raise HarnessError(
                            f"upload file exceeds the {MAX_UPLOAD_FILE_BYTES} byte per-file size cap"
                        )
                    if size_bytes <= 0 and remote_name != "_dataset.ready":
                        raise HarnessError(
                            "upload file verification failed: expected a positive byte count"
                        )
                    total_bytes += size_bytes
                    if total_bytes > MAX_UPLOAD_TOTAL_BYTES:
                        raise HarnessError(
                            f"uploads exceed the {MAX_UPLOAD_TOTAL_BYTES} byte aggregate size cap"
                        )
                destination = (subfolder, remote_name)
                if destination in remote_destinations:
                    raise HarnessError(
                        f"duplicate upload remote destination: {subfolder!r}/{remote_name!r}"
                    )
                remote_destinations.add(destination)
                expanded.append(UploadItem(
                    local_path=local_path,
                    remote_name=remote_name,
                    subfolder=subfolder,
                    overwrite=overwrite,
                    size_bytes=size_bytes,
                ))

    marker_positions = [
        index for index, item in enumerate(expanded)
        if item.remote_name == "_dataset.ready"
    ]
    if marker_positions and (len(marker_positions) != 1 or marker_positions[0] != len(expanded) - 1):
        raise HarnessError("the _dataset.ready upload must be strictly last")
    if marker_positions:
        marker_subfolder = expanded[marker_positions[0]].subfolder
        dataset_subfolders = {
            item.subfolder for item in expanded
            if item.remote_name != "_dataset.ready"
        }
        if marker_subfolder not in dataset_subfolders or len(dataset_subfolders) != 1:
            raise HarnessError(
                "the _dataset.ready upload must share the one dataset subfolder"
            )
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


def marker_poll_is_transient(status: int | str) -> bool:
    if isinstance(status, int):
        return status in TRANSIENT_MARKER_HTTP_STATUSES
    if isinstance(status, str) and status.startswith("error:"):
        return status.removeprefix("error:") in TRANSIENT_MARKER_ERROR_TYPES
    return False


def output_view_params(value: Any, label: str) -> dict[str, str]:
    path = _portable_relative_path(value, label)
    parent = path.parent.as_posix()
    return {
        "filename": path.name,
        "subfolder": "" if parent == "." else parent,
        "type": "output",
    }


def proxy_http_status_is_transient(status: int) -> bool:
    return status in {408, 429} or 500 <= status < 600


def retry_transient_proxy(
        operation: Callable[[], Any], label: str, watchdog: Watchdog,
        sleep: Callable[[float], None], logger: logging.Logger) -> Any:
    for attempt in range(1, 4):
        watchdog.check()
        try:
            return operation()
        except TransientProxyError:
            if attempt == 3:
                raise
            delay = 15.0 * attempt
            logger.warning(
                "%s transient failure on attempt %d/3; retrying in %.0fs",
                label, attempt, delay,
            )
            sleep(delay)
            watchdog.check()
    raise AssertionError("unreachable retry loop")


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
    manifest_artifact_download_seconds(manifest)
    training = manifest["training"]
    complete_marker: str | None = None
    if "complete_marker" in training:
        complete_marker = _output_marker_name(
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
        if complete_marker is not None and wait_for != complete_marker:
            raise HarnessError(
                "training.complete_marker and every artifact wait_for must agree"
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
        validated_artifact = {
            "remote": remote,
            "local": local,
            "type": "output",
            "wait_for": wait_for,
        }
        artifact_sha256 = artifact.get("sha256")
        if artifact_sha256 is not None:
            if (not isinstance(artifact_sha256, str)
                    or not re.fullmatch(r"[0-9A-Fa-f]{64}", artifact_sha256)):
                raise HarnessError("artifact sha256 must be a 64-character hexadecimal digest")
            validated_artifact["sha256"] = artifact_sha256.lower()
        validated.append(validated_artifact)
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
        if (key in TRAINING_IDENTIFIER_PLACEHOLDERS
                and not re.fullmatch(r"[A-Za-z0-9_.-]+", value)):
            raise HarnessError(
                f"training start script identifier {key!r} must use only "
                "A-Z, a-z, 0-9, _, ., or -"
            )
        return shlex.quote(value)

    rendered = re.sub(r"{{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}", replace_placeholder, template)
    if "{{" in rendered or "}}" in rendered:
        raise HarnessError("training start script contains an invalid or unresolved placeholder")
    return remote_path.as_posix(), rendered


def manifest_machine_avoidance(manifest: dict[str, Any]) -> tuple[set[str], set[str]]:
    values: list[set[str]] = []
    for key in ("avoid_machine_hosts", "avoid_machine_ids"):
        raw = manifest.get(key, [])
        if (not isinstance(raw, list)
                or any(not isinstance(item, str) or not item.strip() for item in raw)):
            raise HarnessError(f"manifest {key} must be a list of non-empty strings")
        values.append({item.strip() for item in raw})
    return values[0], values[1]


def manifest_max_placement_attempts(manifest: dict[str, Any]) -> int:
    value = manifest.get("max_placement_attempts", DEFAULT_MAX_PLACEMENT_ATTEMPTS)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise HarnessError("manifest max_placement_attempts must be a positive integer")
    return value


def model_revision(model: dict[str, Any]) -> str:
    revision = model.get("revision", "main")
    if (not isinstance(revision, str) or not HF_REVISION_RE.fullmatch(revision)
            or ".." in revision or "//" in revision or revision.endswith(("/", ".lock"))):
        raise HarnessError(
            "model revision must be a 40-character commit or a safe tag"
        )
    return revision


def model_sha256(model: dict[str, Any]) -> str | None:
    digest = model.get("sha256")
    if digest is None:
        return None
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9A-Fa-f]{64}", digest):
        raise HarnessError("model sha256 must be a 64-character hexadecimal digest")
    return digest.lower()


def custom_node_git_ref(node: dict[str, Any]) -> str:
    git_ref = node.get("git_ref")
    installer_pin = node.get("installer_pin")
    if git_ref is not None and installer_pin is not None and git_ref != installer_pin:
        raise HarnessError("custom node git_ref and installer_pin must match when both are set")
    pin = git_ref if git_ref is not None else installer_pin
    if not isinstance(pin, str) or not GIT_COMMIT_RE.fullmatch(pin):
        raise HarnessError(
            "each custom node git_ref (or installer_pin alias) must be a 40-character "
            "hexadecimal commit"
        )
    return pin.lower()


def manifest_job_timeout_seconds(manifest: dict[str, Any]) -> float:
    value = manifest.get("job_timeout_seconds", 15 * 60)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HarnessError("job_timeout_seconds must be numeric")
    timeout = float(value)
    if not math.isfinite(timeout) or timeout <= 0:
        raise HarnessError("job_timeout_seconds must be finite and positive")
    return timeout


def manifest_artifact_download_seconds(manifest: dict[str, Any]) -> float:
    """Per-artifact allowance for a second-and-later artifact's own marker poll plus
    download, once the first artifact has already spent the shared job_timeout_seconds
    budget confirming the training completion marker. Defaults to 180 seconds so a
    12-checkpoint ladder does not have to multiply the full job timeout by artifact
    count (see HARNESS-CHANGES.md addendum)."""
    value = manifest.get("artifact_download_seconds", 180)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HarnessError("artifact_download_seconds must be numeric")
    seconds = float(value)
    if not math.isfinite(seconds) or seconds <= 0:
        raise HarnessError("artifact_download_seconds must be finite and positive")
    return seconds


def manifest_env_secret_refs(manifest: dict[str, Any]) -> dict[str, str]:
    """Validate the optional env_secret_refs block.

    Values are RunPod secret NAMEs, never secret values. The harness only ever embeds a
    "{{ RUNPOD_SECRET_<name> }}" reference string in the create payload; RunPod substitutes
    the encrypted secret's value into the Pod's own environment at start time, so the
    harness process never reads, prints, or stores it.
    """
    refs = manifest.get("env_secret_refs")
    if refs is None:
        return {}
    if not isinstance(refs, dict) or not refs:
        raise HarnessError("manifest env_secret_refs must be a non-empty mapping when present")
    validated: dict[str, str] = {}
    for env_var, secret_name in refs.items():
        if not isinstance(env_var, str) or not ENV_SECRET_NAME_RE.fullmatch(env_var):
            raise HarnessError(
                f"env_secret_refs env var name must match [A-Z][A-Z0-9_]*: {env_var!r}"
            )
        if env_var != "HF_TOKEN":
            raise HarnessError(
                "manifest env_secret_refs supports only HF_TOKEN -> <RunPod secret NAME>"
            )
        if not isinstance(secret_name, str) or not secret_name:
            raise HarnessError(
                f"env_secret_refs value for {env_var} must be a non-empty string"
            )
        if len(secret_name) > 64:
            raise HarnessError(
                f"env_secret_refs value for {env_var} looks like a token, not a RunPod "
                "secret NAME (too long); pass only the secret's NAME, never its value"
            )
        if any(char.isspace() for char in secret_name):
            raise HarnessError(
                f"env_secret_refs value for {env_var} looks like a token, not a RunPod "
                "secret NAME (contains whitespace); pass only the secret's NAME, never its "
                "value"
            )
        if "hf_" in secret_name:
            # Case-sensitive: real Hugging Face tokens carry a lowercase "hf_" prefix.
            # The all-uppercase secret NAME "HF_TOKEN" is the documented example and must
            # not trip this check.
            raise HarnessError(
                f"env_secret_refs value for {env_var} looks like a Hugging Face token, not "
                "a RunPod secret NAME; pass only the secret's NAME, never its value"
            )
        if not ENV_SECRET_NAME_RE.fullmatch(secret_name):
            raise HarnessError(
                f"env_secret_refs secret NAME must match [A-Z][A-Z0-9_]*: {secret_name!r}"
            )
        validated[env_var] = secret_name
    return validated


def minimum_runtime_minutes(manifest: dict[str, Any]) -> float:
    artifacts = manifest.get("artifacts")
    if artifacts is not None:
        if not isinstance(artifacts, list) or not artifacts:
            raise HarnessError("manifest artifacts must be a non-empty list when present")
        # Artifact mode shares ONE job_timeout_seconds budget for the training
        # completion marker wait (or the first distinct wait_for marker); every
        # further artifact only needs its own artifact_download_seconds allowance
        # for its marker poll plus download, not another full job timeout. See the
        # HARNESS-CHANGES.md addendum — this is what lets a long marker wait and a
        # multi-checkpoint ladder both fit under DEFAULT_MAX_MINUTES.
        work_seconds = (
            manifest_job_timeout_seconds(manifest)
            + (len(artifacts) - 1) * manifest_artifact_download_seconds(manifest)
        )
    else:
        jobs = manifest.get("jobs")
        if not isinstance(jobs, list) or not jobs:
            raise HarnessError("manifest jobs must be a non-empty list")
        work_seconds = manifest_job_timeout_seconds(manifest) * len(jobs)
    return (
        manifest_readiness_timeout_seconds(manifest) / 60.0
        + work_seconds / 60.0
        + 5.0
    )


def comfy_extra_args(manifest: dict[str, Any]) -> list[str]:
    """Return launch arguments while preserving old string manifests."""
    comfy = manifest.get("comfyui") or {}
    raw = comfy.get("extra_args", [])
    if isinstance(raw, str):
        try:
            return shlex.split(raw)
        except ValueError as exc:
            raise HarnessError(f"invalid comfyui.extra_args: {exc}") from exc
    if (not isinstance(raw, list)
            or any(not isinstance(item, str) or not item for item in raw)):
        raise HarnessError("comfyui.extra_args must be a string or a list of strings")
    return list(raw)


def require_manifest(
        manifest: dict[str, Any], manifest_path: Path,
        *, allow_missing_uploads: bool = False) -> None:
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
    manifest_readiness_timeout_seconds(manifest)
    if manifest.get("max_minutes") is not None:
        try:
            manifest_max_minutes = float(manifest["max_minutes"])
        except (TypeError, ValueError) as exc:
            raise HarnessError("manifest max_minutes must be numeric") from exc
        minimum_minutes = minimum_runtime_minutes(manifest)
        if (not math.isfinite(manifest_max_minutes) or manifest_max_minutes <= 0
                or manifest_max_minutes < minimum_minutes):
            raise HarnessError(
                "manifest max_minutes must cover readiness_timeout_seconds plus "
                "job_timeout_seconds for every compatibility job (or, in artifact mode, "
                "one job_timeout_seconds for the marker wait plus artifact_download_seconds "
                "for every artifact after the first) plus a 5 minute teardown "
                f"margin (minimum {minimum_minutes:g})"
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
    extra_parts = comfy_extra_args(manifest)
    if any(part in controlled_flags for part in extra_parts):
        raise HarnessError(
            "comfyui.extra_args must omit --listen, --port, and --output-directory; "
            "the harness supplies proxy-safe values"
        )
    if not isinstance(comfy.get("replace_non_git_root", False), bool):
        raise HarnessError("comfyui.replace_non_git_root must be true or false")
    for key in ("source_url", "tarball_url"):
        value = comfy.get(key)
        if value is not None and (
                not isinstance(value, str) or not value.startswith("https://")):
            raise HarnessError(f"comfyui.{key} must be a public HTTPS URL")
    manifest_machine_avoidance(manifest)
    manifest_max_placement_attempts(manifest)
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
        model_revision(model)
        model_sha256(model)
    for node in manifest.get("custom_nodes", []):
        url = node.get("git_url") if isinstance(node, dict) else None
        if not isinstance(url, str) or not url.startswith("https://"):
            raise HarnessError("custom node git_url must be a public https URL")
        custom_node_git_ref(node)
    expand_manifest_uploads(
        manifest, manifest_path, allow_missing=allow_missing_uploads,
    )
    rendered_training_start_script(manifest, manifest_path)
    manifest_artifacts(manifest)
    manifest_env_secret_refs(manifest)


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
    minimum_minutes = minimum_runtime_minutes(manifest)
    if max_minutes < minimum_minutes:
        raise HarnessError(
            "effective max_minutes must cover readiness_timeout_seconds plus "
            "job_timeout_seconds for every compatibility job (or, in artifact mode, "
            "one job_timeout_seconds for the marker wait plus artifact_download_seconds "
            "for every artifact after the first) plus a 5 minute teardown "
            f"margin (minimum {minimum_minutes:g})"
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


def require_arc_ledger_baseline(ledger_dir: Path, *, allow_empty: bool) -> None:
    """Refuse a live create when no Figment arc ledger baseline is visible."""
    try:
        has_baseline = next(ledger_dir.glob(DEFAULT_ARC_LEDGER_GLOB), None) is not None
    except (OSError, ValueError) as exc:
        raise HarnessError(f"could not enumerate arc cost ledgers: {exc}") from exc
    if not has_baseline and not allow_empty:
        raise HarnessError(
            f"live create refused: resolved ledger directory {ledger_dir} has no "
            "figment-*.tsv baseline; pass --allow-empty-ledger only for an intentional "
            "new arc"
        )


def daily_budget_state(*, budget_path: Path | None = None,
                       ledger_dir: Path | None = None,
                       logger: logging.Logger | None = None,
                       ledger_day: str | None = None) -> tuple[float, float]:
    budget_path = budget_path or repo_root() / "governance" / "budget.yaml"
    ledger_dir = configured_ledger_dir(ledger_dir)
    budget = parse_simple_yaml(budget_path.read_text(encoding="utf-8"))
    if not isinstance(budget, dict) or not isinstance(budget.get("daily_usd_limit"), (int, float)):
        raise HarnessError("governance budget is missing numeric daily_usd_limit")
    daily_limit = float(budget["daily_usd_limit"])
    if not math.isfinite(daily_limit) or daily_limit <= 0:
        raise HarnessError("governance daily_usd_limit must be positive")
    today = governance_ledger_day() if ledger_day is None else ledger_day
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
                         logger: logging.Logger | None = None,
                         ledger_day: str | None = None) -> tuple[float, float]:
    daily_limit, spent = daily_budget_state(
        budget_path=budget_path, ledger_dir=ledger_dir, logger=logger,
        ledger_day=ledger_day,
    )
    if estimate < 0 or spent + estimate > daily_limit:
        raise HarnessError(
            f"daily budget refused: ${spent:.4f} spent + ${estimate:.4f} estimate "
            f"exceeds ${daily_limit:.4f}"
        )
    return daily_limit, spent


def configured_arc_cap_usd(explicit: float | None = None) -> float:
    """Return the operator's whole-arc cap, validating CLI and environment values."""
    raw_value: float | str = (
        explicit if explicit is not None
        else os.environ.get("KB_ARC_CAP_USD", DEFAULT_ARC_CAP_USD)
    )
    try:
        cap = float(raw_value)
    except (TypeError, ValueError) as exc:
        raise HarnessError("--arc-cap-usd and KB_ARC_CAP_USD must be numeric") from exc
    if not math.isfinite(cap) or cap < 0:
        raise HarnessError("--arc-cap-usd and KB_ARC_CAP_USD must be finite and non-negative")
    return cap


def arc_budget_state(*, arc_cap_usd: float | None = None,
                     ledger_dir: Path | None = None,
                     ledger_glob: str = DEFAULT_ARC_LEDGER_GLOB,
                     logger: logging.Logger | None = None) -> tuple[float, float]:
    """Return the arc cap and all matching Figment ledger spend, regardless of date."""
    cap = configured_arc_cap_usd(arc_cap_usd)
    if not isinstance(ledger_glob, str) or not ledger_glob:
        raise HarnessError("--arc-ledger-glob must be a non-empty glob")
    ledger_dir = configured_ledger_dir(ledger_dir)
    spent = 0.0
    try:
        paths = sorted(ledger_dir.glob(ledger_glob))
    except (OSError, ValueError) as exc:
        raise HarnessError(f"could not enumerate arc cost ledgers: {exc}") from exc
    for path in paths:
        try:
            with path.open("r", encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle, delimiter="\t")
                if not reader.fieldnames or "usd" not in reader.fieldnames:
                    if logger:
                        logger.warning("skipping arc ledger without usd column: %s", path)
                    continue
                for row in reader:
                    value = float(row["usd"])
                    if not math.isfinite(value) or value < 0:
                        raise HarnessError(f"arc cost ledger has invalid usd value: {path}")
                    spent += value
        except (OSError, TypeError, ValueError) as exc:
            raise HarnessError(f"could not read arc cost ledger {path}: {exc}") from exc
    return cap, spent


def enforce_arc_cap(estimate: float, *, arc_cap_usd: float | None = None,
                    ledger_dir: Path | None = None,
                    ledger_glob: str = DEFAULT_ARC_LEDGER_GLOB,
                    logger: logging.Logger | None = None) -> tuple[float, float]:
    cap, spent = arc_budget_state(
        arc_cap_usd=arc_cap_usd,
        ledger_dir=ledger_dir,
        ledger_glob=ledger_glob,
        logger=logger,
    )
    if estimate < 0 or spent + estimate > cap:
        raise HarnessError(
            f"ARC CAP REFUSED: ${spent:.4f} spent + ${estimate:.4f} estimate "
            f"exceeds ${cap:.4f} cap"
        )
    return cap, spent


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
    for env_var, secret_name in manifest_env_secret_refs(manifest).items():
        # A RunPod reference string, never a value: RunPod substitutes the encrypted
        # secret at Pod start time, so this literal "{{ RUNPOD_SECRET_<name> }}" text is
        # all the create payload — and this harness process — ever holds.
        payload["env"][env_var] = "{{ RUNPOD_SECRET_" + secret_name + " }}"
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


FULL_BOOTSTRAP_ARTIFACT_FILENAMES = ("_bootstrap.log", "_comfy.log")


def dump_full_bootstrap_artifacts(
        proxy: Any, harness_dir: Path | None, logger: logging.Logger) -> None:
    """Best-effort: persist the full (proxy-capped) bootstrap and ComfyUI runtime
    logs to `harness_dir` while the Pod and proxy are still alive, immediately
    before the surrounding lease terminates it. A short tail alone can miss the
    real error when a background process (for example a training wrapper's own
    `pip install`s) buries it under thousands of unrelated lines. Never raises:
    a fetch or write failure here must never mask the original bootstrap or
    readiness failure that triggered the dump.
    """
    if harness_dir is None:
        return
    for filename in FULL_BOOTSTRAP_ARTIFACT_FILENAMES:
        try:
            status, text = proxy.fetch_artifact(filename)
        except Exception as exc:
            logger.warning(
                "could not fetch full %s for postmortem: %s", filename, type(exc).__name__,
            )
            continue
        if status != 200 or not text:
            logger.warning(
                "could not fetch full %s for postmortem: /view returned %s",
                filename, status,
            )
            continue
        redacted = "\n".join(redact_for_stderr(line) for line in text.splitlines()) + "\n"
        try:
            harness_dir.mkdir(parents=True, exist_ok=True)
            target = harness_dir / filename
            target.write_text(redacted, encoding="utf-8")
            logger.warning(
                "wrote full %s (%d bytes) to %s", filename, len(redacted), target,
            )
        except OSError as exc:
            logger.warning(
                "could not write full %s for postmortem: %s", filename, type(exc).__name__,
            )


def _raise_if_bootstrap_failed(
        proxy: Any, logger: logging.Logger, *, harness_dir: Path | None = None) -> None:
    status, text = proxy.fetch_artifact("_bootstrap.failed")
    if status == 200:
        # Fetch diagnostics before raising: the surrounding lease will terminate the Pod.
        log_tail = _bootstrap_log_tail(proxy, logger, lines=40, failure_context=True)
        dump_full_bootstrap_artifacts(proxy, harness_dir, logger)
        reason = redact_for_stderr(" ".join(text.strip().split()) or "unknown bootstrap failure")
        raise BootstrapFailed(reason, log_tail[-10:])


def wait_ready(api: Any, pod_id: str, timeout: float, watchdog: Watchdog,
               logger: logging.Logger, proxy: Any,
               sleep: Callable[[float], None] = time.sleep,
               bootstrap_log_every_polls: int = BOOTSTRAP_LOG_EVERY_POLLS,
               initial_pod: dict[str, Any] | None = None,
               on_observed: Callable[[dict[str, Any]], None] | None = None,
               harness_dir: Path | None = None) -> dict[str, Any]:
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
        pod = initial_pod if poll_number == 1 and initial_pod is not None else api.get_pod(pod_id)
        if pod is None:
            raise HarnessError(f"pod {pod_id} disappeared before becoming ready")
        if on_observed is not None:
            on_observed(pod)
        last_pod = pod
        last_proxy_status = proxy.health_status()
        watchdog.check()
        if pod.get("desiredStatus") == "RUNNING":
            _raise_if_bootstrap_failed(proxy, logger, harness_dir=harness_dir)
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
    dump_full_bootstrap_artifacts(proxy, harness_dir, logger)
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
    source_url = str(comfy.get("source_url", DEFAULT_COMFY_SOURCE_URL))
    tarball_url = str(comfy.get(
        "tarball_url",
        f"https://codeload.github.com/Comfy-Org/ComfyUI/tar.gz/refs/tags/{git_ref}",
    ))
    marker_ref = re.sub(r"[^A-Za-z0-9._-]+", "_", git_ref).strip("_") or "source"
    tarball_marker = f"{root}/.figment-tarball-{marker_ref}"
    replace_non_git_root = comfy.get("replace_non_git_root") is True
    port = int(comfy.get("port", 8188))
    start_base = str(comfy.get("start_command", "python main.py"))
    extra_args = comfy_extra_args(manifest)
    normalized_extra_args = shlex.join(extra_args) if extra_args else ""
    start = (
        f"{start_base}{' ' + normalized_extra_args if normalized_extra_args else ''} "
        f"--listen 0.0.0.0 --port {port} "
        f"--output-directory {COMFY_OUTPUT_DIR}"
    )
    diagnostic_server = """\
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

OUTPUT = Path("/workspace/output")
ALLOWED = {"_bootstrap.log", "_bootstrap.failed", "_comfy.log"}

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
        "retry_optional() { label=\"$1\"; shift; attempt=1; while :; do \"$@\" >>\"$BOOTSTRAP_LOG\" 2>&1; rc=$?; log_line \"STEP $label attempt=$attempt rc=$rc\"; if [ \"$rc\" -eq 0 ]; then return 0; fi; if [ \"$attempt\" -ge 3 ]; then return \"$rc\"; fi; if [ \"$attempt\" -eq 1 ]; then backoff=15; else backoff=30; fi; log_line \"STEP $label retrying in ${backoff}s\"; sleep \"$backoff\"; attempt=$((attempt + 1)); done; }",
        "wait_for_network() { elapsed=0; while :; do if getent hosts github.com >>\"$BOOTSTRAP_LOG\" 2>&1 && getent hosts huggingface.co >>\"$BOOTSTRAP_LOG\" 2>&1; then log_line \"NETWORK dns ready after ${elapsed}s\"; return 0; fi; rc=$?; log_line \"NETWORK dns wait elapsed=${elapsed}s rc=$rc\"; if [ \"$elapsed\" -ge 90 ]; then fatal \"network DNS was not ready after ${elapsed}s\" \"$rc\"; fi; sleep 5; elapsed=$((elapsed + 5)); done; }",
        "run_cosmetic() { label=\"$1\"; shift; \"$@\" >>\"$BOOTSTRAP_LOG\" 2>&1; rc=$?; log_line \"STEP $label rc=$rc (cosmetic)\"; return 0; }",
        "run_required python-present python --version",
        "run_required git-present git --version",
        "run_required curl-present curl --version",
        "run_required gpu-present bash -lc 'gpu_lines=$(nvidia-smi -L) && test -n \"$gpu_lines\" && printf \'%s\\n\' \"$gpu_lines\"'",
        "run_required torch-cuda python -c 'import torch,sys; sys.exit(0 if torch.cuda.is_available() else 3)'",
        "wait_for_network",
    ]
    clone_comfy = (
        f"git clone --branch {shlex.quote(git_ref)} --depth 1 "
        f"{shlex.quote(source_url)} {shlex.quote(root)}"
    )
    git_source = (
        f"if [ -d {shlex.quote(root + '/.git')} ]; then "
        f"git -C {shlex.quote(root)} fetch --depth 1 origin {shlex.quote(git_ref)} && "
        f"git -C {shlex.quote(root)} checkout --detach FETCH_HEAD; "
        f"else rm -rf \"$COMFY_ROOT\" && {clone_comfy}; fi"
    )
    non_git_policy = (
        f"rm -rf {shlex.quote(root)}"
        if replace_non_git_root else
        "echo 'ComfyUI root exists but is not a git checkout; set "
        "comfyui.replace_non_git_root: true to replace it' >&2; return 64"
    )
    root_parent = str(PurePosixPath(root).parent)
    import_smoke_command = (
        f"cd {shlex.quote(root)} && timeout 120 python -c "
        f"{shlex.quote('import comfy.model_management, comfy.utils')}"
    )
    lines.extend([
        f"COMFY_ROOT={shlex.quote(root)}",
        f"COMFY_TARBALL_MARKER={shlex.quote(tarball_marker)}",
        "install_comfy() { if [ -f \"$COMFY_TARBALL_MARKER\" ]; then "
        "log_line \"COMFY source=tarball-marker\"; else "
        f"if [ -e {shlex.quote(root)} ] && [ ! -d {shlex.quote(root + '/.git')} ]; then "
        f"{non_git_policy}; fi; if retry_optional comfy-git bash -lc {shlex.quote(git_source)}; then "
        "log_line \"COMFY source=git\"; else log_line \"COMFY git retries exhausted; trying tarball\"; "
        "install_comfy_tarball || return $?; log_line \"COMFY source=tarball\"; fi; fi; "
        f"python -m pip install -r {shlex.quote(root + '/requirements.txt')}; }}",
        "install_comfy_tarball() { tmp_dir=$(mktemp -d /tmp/figment-comfy.XXXXXX) || return 1; if ! (set -o pipefail; "
        f"curl -fL --retry 3 {shlex.quote(tarball_url)} | tar -xz -C \"$tmp_dir\"); then "
        "rm -rf \"$tmp_dir\"; return 1; fi; set -- \"$tmp_dir\"/*; "
        "if [ \"$#\" -ne 1 ] || [ ! -d \"$1\" ]; then rm -rf \"$tmp_dir\"; return 1; fi; "
        f"extracted=\"$1\"; mkdir -p {shlex.quote(root_parent)} && rm -rf \"$COMFY_ROOT\" && "
        "mv \"$extracted\" \"$COMFY_ROOT\" && rm -rf \"$COMFY_ROOT/.git\" && "
        "touch \"$COMFY_TARBALL_MARKER\"; rc=$?; rm -rf \"$tmp_dir\"; return \"$rc\"; }",
        "retry_required comfy-install install_comfy",
        f"run_required comfy-import-smoke bash -lc {shlex.quote(import_smoke_command)}",
    ])
    for index, model in enumerate(manifest.get("models", []), start=1):
        destination = str(PurePosixPath(str(model["destination_dir"])) / PurePosixPath(str(model["filename"])).name)
        encoded_filename = quote(str(model["filename"]), safe="/")
        revision = model_revision(model)
        encoded_revision = quote(revision, safe="")
        url = (
            f"https://huggingface.co/{model['repo_id']}/resolve/"
            f"{encoded_revision}/{encoded_filename}?download=true"
        )
        digest = model_sha256(model)
        # $HF_TOKEN, when the container env carries it (via env_secret_refs), is expanded
        # by the shell directly into curl's argv. It is never passed to log_line/echo/
        # printf, so it never reaches _bootstrap.log or the harness's own output.
        hf_auth_snippet = (
            'hf_auth=(); if [ -n "${HF_TOKEN:-}" ]; then '
            'hf_auth=(-H "Authorization: Bearer $HF_TOKEN"); fi; '
        )
        if digest is None:
            command = (
                f"mkdir -p {shlex.quote(str(model['destination_dir']))} && "
                f"if [ -s {shlex.quote(destination)} ]; then true; else "
                f"tmp={shlex.quote(destination + '.partial')}; "
                f"{hf_auth_snippet}"
                f'curl --fail --location "${{hf_auth[@]}}" --output "$tmp" {shlex.quote(url)} && '
                f"test -s \"$tmp\" && mv \"$tmp\" {shlex.quote(destination)}; fi"
            )
        else:
            checksum_existing = (
                f"printf '%s  %s\\n' {shlex.quote(digest)} "
                f"{shlex.quote(destination)} | sha256sum --check --status -"
            )
            checksum_partial = (
                f"printf '%s  %s\\n' {shlex.quote(digest)} \"$tmp\" "
                "| sha256sum --check --status -"
            )
            command = (
                f"mkdir -p {shlex.quote(str(model['destination_dir']))} && "
                f"if [ -s {shlex.quote(destination)} ]; then "
                f"if ! {checksum_existing}; then echo 'MODEL sha256 mismatch' >&2; "
                f"rm -f {shlex.quote(destination)}; exit 86; fi; else "
                f"tmp={shlex.quote(destination + '.partial')}; "
                f"{hf_auth_snippet}"
                f'curl --fail --location "${{hf_auth[@]}}" --output "$tmp" {shlex.quote(url)} && '
                "test -s \"$tmp\" || exit $?; "
                f"if ! {checksum_partial}; then echo 'MODEL sha256 mismatch' >&2; "
                "rm -f \"$tmp\"; exit 86; fi; "
                f"mv \"$tmp\" {shlex.quote(destination)}; fi"
            )
        lines.append(f"retry_required model-{index} bash -lc {shlex.quote(command)}")
    # Drop the token from the container env once model downloads are done and well before
    # ComfyUI starts, regardless of whether any model was actually configured.
    lines.append("unset HF_TOKEN")
    nodes_root = f"{root}/custom_nodes"
    for index, node in enumerate(manifest.get("custom_nodes", []), start=1):
        name = _safe_node_name(str(node["git_url"]), node.get("name"))
        target = f"{nodes_root}/{name}"
        git_ref = custom_node_git_ref(node)
        commit_object = f"{git_ref}^{{commit}}"
        command = (
            f"mkdir -p {shlex.quote(nodes_root)} && "
            f"if [ ! -d {shlex.quote(target + '/.git')} ]; then "
            f"git clone --depth 1 {shlex.quote(str(node['git_url']))} {shlex.quote(target)}; fi && "
            f"if ! git -C {shlex.quote(target)} cat-file -e {shlex.quote(commit_object)}; then "
            f"git -C {shlex.quote(target)} fetch --depth 1 origin {shlex.quote(git_ref)}; fi && "
            f"git -C {shlex.quote(target)} checkout --detach {shlex.quote(git_ref)} && "
            f"head=$(git -C {shlex.quote(target)} rev-parse HEAD) && "
            f"test \"$head\" = {shlex.quote(git_ref)} && "
            f"printf 'CUSTOM NODE %s checked-out %s\\n' {shlex.quote(name)} \"$head\""
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
    # Bound the in-pod health poll by the manifest's own readiness timeout (2s per
    # iteration) rather than a fixed constant: a training wrapper that installs
    # ai-toolkit, restores ComfyUI's requirements, and pre-warms HF repos before
    # exec'ing ComfyUI (see pipeline/train/start-training-aitoolkit.sh) can take far
    # longer than a bare ComfyUI start on a slow-network host, and the harness-side
    # `wait_ready` already enforces the overall readiness/watchdog budget.
    health_iterations = math.ceil(manifest_readiness_timeout_seconds(manifest) / 2.0)
    health_cmd = (
        f"for n in $(seq 1 {health_iterations}); do curl --silent --fail "
        f"http://127.0.0.1:{port}/system_stats >/dev/null && exit 0; sleep 2; done; "
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
    def __init__(self, base_url: str, session: Any = None,
                 logger: logging.Logger | None = None,
                 sleep: Callable[[float], None] = time.sleep,
                 monotonic: Callable[[], float] = time.monotonic,
                 training_diagnostics_dir: Path | None = None):
        if session is None and requests is None:
            raise HarnessError("the requests package is required for live commands")
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()
        self.logger = logger or logging.getLogger(__name__)
        self._sleep = sleep
        self._monotonic = monotonic
        self.training_diagnostics_dir = training_diagnostics_dir
        # filename -> (size, sha256 hex digest) of the last snapshot actually logged.
        self._diag_last_logged_snapshot: dict[str, tuple[int, str]] = {}
        # filename -> monotonic time of the last "saved" log line, for the
        # heartbeat's additional once-per-minute log throttle.
        self._diag_last_logged_at: dict[str, float] = {}
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
        if filename not in {"_bootstrap.log", "_bootstrap.failed", "_comfy.log"}:
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
        # _bootstrap.failed is a short reason line; _bootstrap.log and _comfy.log can be
        # large (a training wrapper's own pip installs stream to _comfy.log), so both get
        # a generous tail-truncated cap rather than the failure marker's small one.
        limit = 64 * 1024 if filename in {"_bootstrap.log", "_comfy.log"} else 4 * 1024
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
                try:
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
                except Exception as exc:
                    raise TransientProxyError(
                        "ComfyUI POST /upload/image transport failed: "
                        f"{type(exc).__name__}"
                    ) from exc
        except OSError as exc:
            raise HarnessError(
                f"ComfyUI upload file could not be read: {type(exc).__name__}"
            ) from exc
        try:
            if not 200 <= response.status_code < 300:
                error_type = (
                    TransientProxyError
                    if proxy_http_status_is_transient(int(response.status_code))
                    else HarnessError
                )
                raise error_type(
                    f"ComfyUI POST /upload/image returned HTTP {response.status_code}"
                )
            try:
                body = response.json()
            except (ValueError, TypeError) as exc:
                raise HarnessError(
                    "ComfyUI POST /upload/image returned invalid JSON"
                ) from exc
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()
        if (not overwrite and isinstance(body, dict)
                and body.get("subfolder") == subfolder and body.get("type") == "input"):
            returned_name = body.get("name")
            renamed_pattern = (
                re.escape(local_path.stem) + r" \(\d+\)" + re.escape(local_path.suffix)
            )
            if isinstance(returned_name, str) and re.fullmatch(renamed_pattern, returned_name):
                raise HarnessError(
                    "ComfyUI upload found a pre-existing remote file; enable overwrite"
                )
        if not isinstance(body, dict) or any(
                body.get(key) != value for key, value in expected.items()):
            raise HarnessError("ComfyUI POST /upload/image returned mismatched JSON")
        return body

    def marker_status(self, filename: str) -> int | str:
        marker = _output_marker_name(filename, "artifact marker", absolute=False)
        try:
            response = self.session.get(
                self.base_url + "/view",
                params=output_view_params(marker, "artifact marker"),
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

    def _log_training_diagnostic_saved(
        self, filename: str, destination: Path, body: bytes,
    ) -> None:
        """Log the "saved" line only when the snapshot's content actually changed.

        The snapshot is written to disk on every marker-poll cycle (about every
        7 s) regardless; this only gates the INFO log line so an unchanged file
        does not spam the log every cycle. The heartbeat file can legitimately
        change every cycle (it is a live counter), so it gets an additional
        once-per-minute cap on top of the change check.
        """
        snapshot = (len(body), hashlib.sha256(body).hexdigest())
        if self._diag_last_logged_snapshot.get(filename) == snapshot:
            return
        if filename == "_training.heartbeat":
            now = self._monotonic()
            last_logged_at = self._diag_last_logged_at.get(filename)
            if (last_logged_at is not None
                    and now - last_logged_at < HEARTBEAT_DIAGNOSTIC_LOG_MIN_INTERVAL_SECONDS):
                self._diag_last_logged_snapshot[filename] = snapshot
                return
            self._diag_last_logged_at[filename] = now
        self._diag_last_logged_snapshot[filename] = snapshot
        self.logger.info(
            "training diagnostic saved: %s bytes=%d", destination, len(body),
        )

    def fetch_training_diagnostic(self, filename: str) -> int | str:
        if filename not in TRAINING_DIAGNOSTIC_FILENAMES:
            raise HarnessError(f"unsupported training diagnostic: {filename!r}")
        target_dir = self.training_diagnostics_dir
        if target_dir is None:
            return 404
        try:
            response = self.session.get(
                self.base_url + "/view",
                params=output_view_params(filename, "training diagnostic"),
                timeout=REQUEST_TIMEOUT,
                stream=True,
            )
        except Exception as exc:
            return f"error:{type(exc).__name__}"
        try:
            status = int(response.status_code)
            if status != 200:
                return status
            chunks = getattr(response, "iter_content", None)
            if callable(chunks):
                body = b"".join(chunk for chunk in chunks(chunk_size=64 * 1024) if chunk)
            else:
                body = bytes(getattr(response, "content", b""))
            safe_text = redact_for_stderr(body.decode("utf-8", errors="replace"))
            target_dir.mkdir(parents=True, exist_ok=True)
            destination = target_dir / filename
            partial = destination.with_name(destination.name + ".partial")
            try:
                partial.write_text(safe_text, encoding="utf-8")
                partial.replace(destination)
            finally:
                partial.unlink(missing_ok=True)
            self._log_training_diagnostic_saved(filename, destination, body)
            return status
        except OSError as exc:
            self.logger.warning(
                "training diagnostic could not be saved: %s: %s",
                filename, type(exc).__name__,
            )
            return f"error:{type(exc).__name__}"
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()

    def capture_training_diagnostics(self) -> None:
        if getattr(self, "training_diagnostics_dir", None) is None:
            return
        for filename in TRAINING_DIAGNOSTIC_FILENAMES:
            self.fetch_training_diagnostic(filename)

    def wait_for_marker(
        self, marker: str, failed_marker: str, timeout: float, watchdog: Watchdog,
    ) -> None:
        deadline = self._monotonic() + timeout
        last_transient: int | str | None = None
        persistent_502_since: float | None = None

        def record_cycle_status(status: int | str, now: float) -> None:
            nonlocal persistent_502_since
            if status != 502:
                persistent_502_since = None
                return
            if persistent_502_since is None:
                persistent_502_since = now
                return
            if now - persistent_502_since >= PERSISTENT_MARKER_502_SECONDS:
                raise HarnessError(
                    "artifact marker polling received HTTP 502 continuously for "
                    "more than 5 minutes"
                )

        while True:
            now = self._monotonic()
            if now >= deadline:
                break
            watchdog.check()
            ComfyClient.capture_training_diagnostics(self)
            failed_status = self.marker_status(failed_marker)
            if failed_status == 200:
                raise HarnessError("training failed marker appeared")
            if marker_poll_is_transient(failed_status):
                last_transient = failed_status
                record_cycle_status(failed_status, now)
                self.logger.warning(
                    "transient training failed-marker poll result %s; retrying",
                    failed_status,
                )
                self._sleep(min(5.0, deadline - now))
                continue
            if failed_status != 404:
                raise HarnessError(
                    f"training failed-marker poll returned {failed_status}"
                )
            watchdog.check()
            marker_status = self.marker_status(marker)
            if marker_status == 200:
                return
            record_cycle_status(marker_status, now)
            if marker_poll_is_transient(marker_status):
                last_transient = marker_status
                self.logger.warning(
                    "transient artifact marker poll result %s; retrying",
                    marker_status,
                )
                self._sleep(min(5.0, deadline - now))
                continue
            if marker_status != 404:
                raise HarnessError(
                    f"artifact marker poll returned {marker_status}"
                )
            last_transient = None
            self._sleep(min(5.0, deadline - now))
        if last_transient is not None:
            raise HarnessError(
                "artifact marker polling encountered persistent transient proxy errors "
                "and timed out"
            )
        raise HarnessError(f"artifact marker {marker!r} timed out")

    def download_artifact(
        self, remote: str, local_path: Path, timeout: float,
        *, sha256: str | None = None,
    ) -> None:
        remote_name = _portable_relative_path(remote, "artifact remote").as_posix()
        remote_suffix = PurePosixPath(remote_name).suffix.lower()
        if remote_suffix not in ARTIFACT_EXTENSIONS:
            raise HarnessError("unsupported artifact suffix")
        try:
            response = self.session.get(
                self.base_url + "/view",
                params=output_view_params(remote_name, "artifact remote"),
                timeout=timeout,
                stream=True,
            )
        except Exception as exc:
            raise TransientProxyError(
                f"ComfyUI GET /view transport failed: {type(exc).__name__}"
            ) from exc
        temporary = local_path.with_suffix(local_path.suffix + ".partial")
        try:
            if not 200 <= response.status_code < 300:
                error_type = (
                    TransientProxyError
                    if proxy_http_status_is_transient(int(response.status_code))
                    else HarnessError
                )
                raise error_type(
                    f"ComfyUI GET /view returned HTTP {response.status_code}"
                )
            headers = getattr(response, "headers", {}) or {}
            raw_content_length = headers.get("Content-Length")
            expected_length: int | None = None
            if raw_content_length is not None:
                try:
                    expected_length = int(raw_content_length)
                except (TypeError, ValueError) as exc:
                    raise HarnessError("artifact response had an invalid Content-Length") from exc
                if expected_length < 0:
                    raise HarnessError("artifact response had an invalid Content-Length")
            else:
                minimum = ARTIFACT_MIN_BYTES_WITHOUT_LENGTH[remote_suffix]
                self.logger.warning(
                    "artifact response Content-Length absent; requiring minimum %d bytes for %s",
                    minimum, remote_suffix,
                )
            local_path.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256() if sha256 is not None else None
            bytes_written = 0
            with temporary.open("wb") as handle:
                chunks = getattr(response, "iter_content", None)
                if callable(chunks):
                    for chunk in chunks(chunk_size=1024 * 1024):
                        if chunk:
                            handle.write(chunk)
                            bytes_written += len(chunk)
                            if digest is not None:
                                digest.update(chunk)
                else:
                    body = bytes(getattr(response, "content", b""))
                    handle.write(body)
                    bytes_written = len(body)
                    if digest is not None:
                        digest.update(body)
            if expected_length is not None and bytes_written != expected_length:
                raise HarnessError(
                    "artifact download byte count did not match Content-Length "
                    f"({bytes_written} received, {expected_length} advertised)"
                )
            if expected_length is None:
                minimum = ARTIFACT_MIN_BYTES_WITHOUT_LENGTH[remote_suffix]
                if bytes_written < minimum:
                    raise HarnessError(
                        f"artifact download was below the minimum {minimum} byte count"
                    )
            if bytes_written <= 0:
                raise HarnessError("artifact download did not have a positive byte count")
            if digest is not None and digest.hexdigest() != sha256:
                raise HarnessError("artifact download sha256 verification failed")
            temporary.replace(local_path)
        except HarnessError:
            raise
        except OSError as exc:
            raise HarnessError(
                f"artifact download could not be written: {type(exc).__name__}"
            ) from exc
        except Exception as exc:
            raise TransientProxyError(
                f"artifact download stream failed: {type(exc).__name__}"
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

    def wait_outputs(
        self, prompt_id: str, timeout: float, watchdog: Watchdog,
        *, expected_images: int = 1,
    ) -> list[dict[str, str]]:
        del expected_images  # live jobs are counted from ComfyUI's own history entry
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

    def wait_outputs(
        self, prompt_id: str, _timeout: float, watchdog: Watchdog,
        *, expected_images: int = 1,
    ) -> list[dict[str, str]]:
        watchdog.check()
        if expected_images == 1:
            return [{"filename": f"{prompt_id}.png", "subfolder": "", "type": "output"}]
        return [
            {"filename": f"{prompt_id}_{index:02d}.png", "subfolder": "", "type": "output"}
            for index in range(1, expected_images + 1)
        ]

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
        *, sha256: str | None = None,
    ) -> None:
        del sha256
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


def append_cost_row(
        ledger_dir: Path, gpu: str, step: str, usd: float,
        *, ledger_day: str | None = None) -> Path:
    ledger_dir.mkdir(parents=True, exist_ok=True)
    day = governance_ledger_day() if ledger_day is None else ledger_day
    path = ledger_dir / f"figment-{day}.tsv"
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


def upsert_cost_row(
        ledger_dir: Path, model: str, step: str, usd: float,
        *, ledger_day: str | None = None) -> Path:
    if any(char in model + step for char in "\t\r\n"):
        raise HarnessError("ledger model and step must be single TSV fields")
    ledger_dir.mkdir(parents=True, exist_ok=True)
    day = governance_ledger_day() if ledger_day is None else ledger_day
    path = ledger_dir / f"figment-{day}.tsv"
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
                budget_path: Path | None = None,
                arc_cap_usd: float | None = None,
                arc_ledger_glob: str = DEFAULT_ARC_LEDGER_GLOB,
                allow_empty_ledger: bool = False) -> dict[str, Any]:
    require_manifest(
        manifest, manifest_path, allow_missing_uploads=dry_run,
    )
    upload_items = expand_manifest_uploads(
        manifest, manifest_path, allow_missing=dry_run,
    )
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
    if upload_items:
        logger.info(
            "upload preflight: %d files, %d bytes",
            len(upload_items), sum(item.size_bytes or 0 for item in upload_items),
        )
        missing_uploads = sum(item.size_bytes is None for item in upload_items)
        if missing_uploads:
            logger.warning(
                "dry-run simulated %d missing upload pattern(s); live preflight remains strict",
                missing_uploads,
            )
        if any(not item.overwrite for item in upload_items):
            logger.warning(
                "upload preflight: overwrite=false may fail on pre-existing remote files"
            )
    ledger_target = (
        out_dir / "dry-run-ledger"
        if dry_run and ledger_dir is None else configured_ledger_dir(ledger_dir)
    )
    logger.info("cost ledger directory: %s", ledger_target)
    # Capture the operating day once for this create transaction. Every provisional and
    # settled row from the invocation reuses it even if teardown crosses local midnight.
    started_utc = utc_now().replace(microsecond=0)
    ledger_day = governance_ledger_day(started_utc)
    if not dry_run:
        require_arc_ledger_baseline(ledger_target, allow_empty=allow_empty_ledger)
    daily_limit: float | None = None
    daily_spent: float | None = None
    arc_cap, arc_spent = arc_budget_state(
        arc_cap_usd=arc_cap_usd,
        ledger_dir=ledger_target,
        ledger_glob=arc_ledger_glob,
        logger=logger,
    )
    logger.info("arc total before create: $%.6f", arc_spent)
    if not dry_run:
        daily_limit, daily_spent = enforce_daily_budget(
            estimate,
            budget_path=budget_path,
            ledger_dir=ledger_target,
            logger=logger,
            ledger_day=ledger_day,
        )
        arc_cap, arc_spent = enforce_arc_cap(
            estimate,
            arc_cap_usd=arc_cap,
            ledger_dir=ledger_target,
            ledger_glob=arc_ledger_glob,
            logger=logger,
        )
    logger.info("preflight cost estimate: $%.4f for %.2f minute(s)", estimate, max_minutes)
    out_dir.mkdir(parents=True, exist_ok=True)
    if api is None:
        api = DryRunAPI(float(manifest["price_usd_per_hour"])) if dry_run else None
    if api is None:
        raise HarnessError("live run requires an authenticated API")

    ledger_model = gpu_model_label(manifest["gpu"]["type"])
    started = time.monotonic()  # The budget clock begins immediately before create.
    avoid_hosts, avoid_ids = manifest_machine_avoidance(manifest)
    learned_hosts = load_recent_bad_hosts(session_bad_hosts_path(), logger=logger)
    avoid_hosts.update(learned_hosts)
    max_placement_attempts = manifest_max_placement_attempts(manifest)
    logger.info("max placement attempts: %d", max_placement_attempts)
    result: dict[str, Any] = {
        "schema": "figment/runpod-run@1",
        "dry_run": dry_run,
        "pod_id": None,
        "gpu": manifest["gpu"],
        "started_utc": started_utc.isoformat(timespec="seconds"),
        "ledger_day": ledger_day,
        "max_minutes": max_minutes,
        "preflight_estimate_usd": round(estimate, 6),
        "arc_usd_before": round(arc_spent, 6),
        "arc_cap_usd": arc_cap,
        "uploads": [],
        "jobs": [],
        "artifacts": [],
        "placement_attempts": [],
        "termination_verified": False,
    }
    if daily_limit is not None and daily_spent is not None:
        result["daily_usd_limit"] = daily_limit
        result["daily_usd_before_create"] = round(daily_spent, 6)
    images_manifest: list[dict[str, Any]] = []

    cancel = threading.Event()
    watchdog: Watchdog | None = None
    proxy_client: Any | None = None
    caught: BaseException | None = None
    actual_hourly: float | None = None
    lease: PodLease | None = None
    initial_pod: dict[str, Any] | None = None
    active_machine_host: str | None = None
    current_placement_started: float | None = None
    current_placement_settled = False
    current_placement_record: dict[str, Any] | None = None
    avoided_cost_total = 0.0
    current_cost_for_ledger = 0.0
    placement_needs_close = False
    placement_error: BaseException | None = None

    def retain_finalization_failure(label: str, secondary: BaseException) -> None:
        nonlocal caught
        logger.error(
            "secondary finalization failure during %s: %s: %s",
            label, type(secondary).__name__, secondary,
        )
        if caught is None:
            caught = secondary
            result["error"] = f"{type(secondary).__name__}: {secondary}"

    def remember_machine(pod: dict[str, Any]) -> None:
        nonlocal active_machine_host
        machine_host, _machine_id = pod_machine_identity(pod)
        if machine_host is not None:
            active_machine_host = machine_host

    try:
        for placement_attempt in range(1, max_placement_attempts + 1):
            if placement_attempt > 1:
                if max_usd is not None and avoided_cost_total + estimate > max_usd:
                    raise HarnessError(
                        "placement recreation refused: avoided-pod cost plus the next "
                        "full-run estimate exceeds --max-usd"
                    )
                if (daily_limit is not None and daily_spent is not None
                        and daily_spent + avoided_cost_total + estimate > daily_limit):
                    raise HarnessError(
                        "placement recreation refused: avoided-pod cost plus the next "
                        "full-run estimate exceeds the governance daily budget"
                    )
                if arc_spent + avoided_cost_total + estimate > arc_cap:
                    raise HarnessError(
                        "placement recreation refused: avoided-pod cost plus the next "
                        "full-run estimate exceeds the arc cap"
                    )
            payload = create_payload(manifest, manifest_path)
            current_placement_started = (
                started if placement_attempt == 1 else time.monotonic()
            )
            current_placement_settled = False

            def record_acquired(
                    pod_id: str, _pod: dict[str, Any] | None,
                    *, attempt: int = placement_attempt) -> None:
                result["pod_id"] = pod_id
                cost_path = upsert_cost_row(
                    ledger_target,
                    ledger_model,
                    f"pod-create {pod_id}",
                    0.0 if dry_run else estimate,
                    ledger_day=ledger_day,
                )
                logger.info(
                    "provisional cost row for placement %d/%d: %s",
                    attempt, max_placement_attempts, cost_path,
                )

            lease = PodLease(
                api, payload, logger, sleep=sleep, on_acquired=record_acquired,
                started_utc=utc_now().replace(microsecond=0),
            )
            lease.__enter__()
            placement_needs_close = True
            observed = api.get_pod(str(lease.pod_id))
            if observed is None:
                raise HarnessError(
                    f"pod {lease.pod_id} disappeared during placement inspection"
                )
            lease._remember_pod(observed)
            machine_host, machine_id = pod_machine_identity(observed)
            current_placement_record = {
                "attempt": placement_attempt,
                "pod_id": lease.pod_id,
                "machine_host": machine_host,
                "machine_id": machine_id,
                "avoided": False,
                "termination_verified": False,
            }
            result["placement_attempts"].append(current_placement_record)
            is_avoided = (
                machine_host is not None and machine_host in avoid_hosts
            ) or (
                machine_id is not None and machine_id in avoid_ids
            )
            if not is_avoided:
                initial_pod = observed
                active_machine_host = machine_host
                break

            current_placement_record["avoided"] = True
            avoided_label = machine_host or machine_id or "UNKNOWN"
            logger.warning(
                "AVOIDED HOST %s — terminating and recreating (attempt %d/%d)",
                avoided_label, placement_attempt, max_placement_attempts,
            )
            placement_needs_close = False
            lease.close()
            _pod_id, _pod_name, verified = lease.snapshot()
            current_placement_record["termination_verified"] = verified
            placement_elapsed = time.monotonic() - current_placement_started
            placement_cost, placement_basis = settled_cost_estimate(
                elapsed_seconds=placement_elapsed,
                dry_run=dry_run,
                ready_hourly_price_usd=None,
                manifest_hourly_price_usd=float(manifest["price_usd_per_hour"]),
                preflight_estimate_usd=estimate,
                termination_verified=verified,
            )
            current_placement_record["elapsed_seconds"] = round(placement_elapsed, 3)
            current_placement_record["estimated_actual_usd"] = round(placement_cost, 6)
            current_placement_record["estimated_actual_usd_basis"] = placement_basis
            avoided_cost_total += placement_cost
            upsert_cost_row(
                ledger_target, ledger_model,
                f"pod-create {lease.pod_id}", placement_cost,
                ledger_day=ledger_day,
            )
            current_placement_settled = True
            if placement_attempt == max_placement_attempts:
                raise HarnessError(
                    "PLACEMENT FAILED: all "
                    f"{max_placement_attempts} placement attempts landed on avoided "
                    "machine hosts/ids; every pod was terminated and verified absent"
                )
    except BaseException as exc:
        placement_error = exc

    try:
        if placement_error is not None:
            raise placement_error
        if lease is None or initial_pod is None:
            raise HarnessError("placement failed before a usable pod was acquired")
        with shutdown_signals(cancel), lease:
            placement_needs_close = False
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
                    comfy_factory(proxy_url)
                    if comfy_factory else ComfyClient(
                        proxy_url, logger=logger, sleep=sleep,
                        training_diagnostics_dir=(
                            out_dir / "_harness" if artifacts else None
                        ),
                    )
                )
            ready_pod = wait_ready(
                api, str(lease.pod_id), ready_timeout, watchdog, logger,
                proxy_client, sleep, initial_pod=initial_pod,
                on_observed=remember_machine,
                harness_dir=out_dir / "_harness",
            )
            actual_hourly = ready_hourly_price(ready_pod)
            actual_ceiling = actual_hourly * max_minutes / 60.0
            if max_usd is not None and avoided_cost_total + actual_ceiling > max_usd:
                raise HarnessError("READY pod hourly price exceeds the approved --max-usd budget")
            if (daily_limit is not None and daily_spent is not None
                    and daily_spent + avoided_cost_total + actual_ceiling > daily_limit):
                raise HarnessError("READY pod hourly price exceeds the governance daily budget")
            if arc_spent + avoided_cost_total + actual_ceiling > arc_cap:
                raise HarnessError("READY pod hourly price exceeds the arc cap")
            watchdog.check()
            comfy = proxy_client
            per_job_timeout = manifest_job_timeout_seconds(manifest)
            for item in upload_items:
                watchdog.check()
                if item.size_bytes is None:
                    if not dry_run:
                        raise HarnessError("live upload file disappeared after preflight")
                    byte_count = 0
                    response = {
                        "name": item.remote_name,
                        "subfolder": item.subfolder,
                        "type": "input",
                    }
                else:
                    byte_count = local_file_size(
                        item.local_path, "uploaded file",
                        positive=item.remote_name != "_dataset.ready",
                    )
                    response = retry_transient_proxy(
                        lambda item=item: comfy.upload_file(
                            item.local_path, item.subfolder, item.overwrite,
                        ),
                        f"upload {item.remote_name}", watchdog, sleep, logger,
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
                # The shared job_timeout_seconds deadline pays for the training
                # completion marker wait (or the first distinct wait_for marker); it is
                # the "existing shared artifact deadline" logic and stays unchanged.
                # Every artifact after the first no longer borrows that same generous
                # per_job_timeout as its own download ceiling — it gets the much smaller
                # artifact_download_seconds allowance instead, matching what preflight
                # actually reserved for it. See HARNESS-CHANGES.md addendum.
                artifact_download_seconds = manifest_artifact_download_seconds(manifest)
                artifact_marker_deadline = time.monotonic() + per_job_timeout
                for artifact_index, artifact in enumerate(artifacts):
                    watchdog.check()
                    artifact_deadline = (
                        artifact_marker_deadline if artifact_index == 0
                        else time.monotonic() + artifact_download_seconds
                    )
                    marker = artifact["wait_for"]
                    assert failed_marker is not None
                    remaining_marker_wait = artifact_deadline - time.monotonic()
                    if remaining_marker_wait <= 0:
                        raise HarnessError("artifact marker/download deadline expired")
                    comfy.wait_for_marker(
                        marker, failed_marker, remaining_marker_wait, watchdog,
                    )
                    logger.info("artifact marker ready: %s", marker)
                    local_relative = PurePosixPath(artifact["local"])
                    local_path = out_dir.joinpath(*local_relative.parts)
                    download_kwargs = (
                        {"sha256": artifact["sha256"]}
                        if "sha256" in artifact else {}
                    )

                    def download_with_remaining_deadline(
                            *, artifact: dict[str, str] = artifact,
                            local_path: Path = local_path,
                            download_kwargs: dict[str, str] = download_kwargs,
                            artifact_deadline: float = artifact_deadline) -> None:
                        download_timeout = artifact_deadline - time.monotonic()
                        if download_timeout <= 0:
                            raise HarnessError("artifact marker/download deadline expired")
                        comfy.download_artifact(
                            artifact["remote"], local_path, download_timeout,
                            **download_kwargs,
                        )

                    retry_transient_proxy(
                        download_with_remaining_deadline,
                        f"artifact download {artifact['remote']}",
                        watchdog, sleep, logger,
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
                    expected_images = job.get("expected_images", 1)
                    if isinstance(expected_images, bool) or not isinstance(expected_images, int):
                        raise HarnessError("job expected_images must be a positive integer")
                    remote_images = comfy.wait_outputs(
                        prompt_id, per_job_timeout, watchdog,
                        expected_images=expected_images,
                    )
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
            host_class_reason = bootstrap_host_class_failure_reason(exc)
            network_reason = bootstrap_network_failure_reason(exc)
            learned_reason = host_class_reason or network_reason
            reason_class = (
                "machine" if host_class_reason
                else "network" if network_reason
                else "dependency" if bootstrap_dependency_failure_reason(exc)
                else "unclassified"
            )
            if learned_reason and active_machine_host:
                learned_at = utc_now()
                learned_paths = [
                    out_dir / "_harness" / "bad_hosts.json",
                    session_bad_hosts_path(),
                ]
                learned_errors: list[str] = []
                for bad_host_path in learned_paths:
                    try:
                        record_bad_machine_host(
                            bad_host_path, active_machine_host,
                            redact_for_stderr(learned_reason), now=learned_at,
                        )
                        logger.warning(
                            "recorded failing machine host %s in %s",
                            active_machine_host, bad_host_path,
                        )
                    except BaseException as secondary:
                        safe_error = redact_for_stderr(
                            f"{type(secondary).__name__}: {secondary}"
                        )
                        learned_errors.append(f"{bad_host_path}: {safe_error}")
                        logger.error(
                            "could not record failing machine host in %s: %s",
                            bad_host_path, safe_error,
                        )
                result["learned_bad_host"] = active_machine_host
                result["host_learned"] = True
                result["bootstrap_failure_class"] = reason_class
                if learned_errors:
                    result["bad_host_record_errors"] = learned_errors
            else:
                # Image/dependency evidence (or an unclassified bootstrap failure, or
                # machine/network evidence with no known host to blame) never learns a
                # bad host: a fixed image on the same machine could still pass. Record
                # the reason class for postmortem so it is visible without re-reading
                # the full bootstrap log tail.
                not_learned_reason = (
                    learned_reason
                    or bootstrap_dependency_failure_reason(exc)
                    or " ".join(str(exc).split())[:500]
                )
                result["host_learned"] = False
                result["bootstrap_failure_class"] = reason_class
                try:
                    write_json(
                        out_dir / "_harness" / "bootstrap-failure.json",
                        {
                            "schema": "figment/bootstrap-failure@1",
                            "host": active_machine_host,
                            "host_learned": False,
                            "reason_class": reason_class,
                            "reason": redact_for_stderr(not_learned_reason),
                        },
                        redactor,
                    )
                except BaseException as secondary:
                    retain_finalization_failure("bootstrap-failure.json write", secondary)
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
                watchdog.stop(teardown_budget_seconds(
                    lease.attempts if lease is not None else TERMINATE_ATTEMPTS
                ))
                if caught is None and watchdog.error:
                    caught = watchdog.error
                    result["error"] = f"{type(caught).__name__}: {caught}"
                elif caught is None and watchdog.fired.is_set():
                    caught = RunCancelled("maximum runtime reached")
                    result["error"] = f"{type(caught).__name__}: {caught}"
        except BaseException as secondary:
            retain_finalization_failure("watchdog stop", secondary)
        try:
            if (placement_needs_close and lease is not None
                    and not lease.snapshot()[2]):
                lease.close()
        except BaseException as secondary:
            retain_finalization_failure("pod termination", secondary)
        try:
            if lease is None:
                pod_id, verified = None, True
            else:
                pod_id, _pod_name, verified = lease.snapshot()
            result["pod_id"] = pod_id or result["pod_id"]
            if lease is not None and lease.create_error:
                result["create_error"] = lease.create_error
            result["termination_verified"] = verified
            elapsed = time.monotonic() - started
            result["finished_utc"] = utc_now().isoformat(timespec="seconds")
            result["elapsed_seconds"] = round(elapsed, 3)
            result["hourly_price_usd"] = actual_hourly
            if (pod_id is not None and not current_placement_settled
                    and current_placement_started is not None):
                current_elapsed = time.monotonic() - current_placement_started
                current_cost_for_ledger, cost_basis = settled_cost_estimate(
                    elapsed_seconds=current_elapsed,
                    dry_run=dry_run,
                    ready_hourly_price_usd=actual_hourly,
                    manifest_hourly_price_usd=float(manifest["price_usd_per_hour"]),
                    preflight_estimate_usd=estimate,
                    termination_verified=verified,
                )
                if current_placement_record is not None:
                    current_placement_record["termination_verified"] = verified
                    current_placement_record["elapsed_seconds"] = round(current_elapsed, 3)
                    current_placement_record["estimated_actual_usd"] = round(
                        current_cost_for_ledger, 6,
                    )
                    current_placement_record["estimated_actual_usd_basis"] = cost_basis
            else:
                cost_basis = "dry-run" if dry_run else "ceiling-rate estimate"
            total_cost = avoided_cost_total + current_cost_for_ledger
            result["estimated_actual_usd"] = round(total_cost, 6)
            result["estimated_actual_usd_basis"] = (
                "sum of per-pod estimates" if avoided_cost_total else cost_basis
            )
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
        unsettled_pod_id = lease.snapshot()[0] if lease is not None else None
        if unsettled_pod_id and not current_placement_settled:
            try:
                cost_path = upsert_cost_row(
                    ledger_target,
                    ledger_model,
                    f"pod-create {unsettled_pod_id}",
                    current_cost_for_ledger,
                    ledger_day=ledger_day,
                )
                logger.info("cost row: %s", cost_path)
            except BaseException as secondary:
                retain_finalization_failure("cost ledger write", secondary)
    if caught is None and not result["termination_verified"]:
        caught = PodStillRunning(f"POD STILL RUNNING {result['pod_id'] or 'UNKNOWN'}")
    if caught:
        if lease is not None:
            raise attach_lease_status(caught, lease)
        raise caught
    return result


def command_run(args: argparse.Namespace) -> int:
    manifest_path = resolve_manifest_path(args.manifest)
    manifest = load_manifest(manifest_path)
    if args.dry_run:
        manifest = prepare_dry_run_manifest(manifest, manifest_path)
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
            arc_cap_usd=args.arc_cap_usd,
            arc_ledger_glob=args.arc_ledger_glob,
            allow_empty_ledger=args.allow_empty_ledger,
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


def command_status(args: argparse.Namespace) -> int:
    try:
        session, redactor = build_authenticated_session()
    except KeyError as exc:
        raise HarnessError("RUNPOD_API_KEY is required for live commands") from exc
    set_active_redactor(redactor)
    logger = build_logger(redactor)
    try:
        bad_hosts_path = session_bad_hosts_path()
        if args.forget_bad_host:
            if forget_bad_host(bad_hosts_path, args.forget_bad_host):
                print(f"forgot bad host: {args.forget_bad_host}")
            else:
                print(f"no learned bad-host entry for: {args.forget_bad_host}")
        learned_hosts = _recent_bad_host_entries(bad_hosts_path, logger=logger)
        if learned_hosts:
            print("learned bad hosts:")
            for entry in learned_hosts:
                print(f"  {entry['host']}  ({entry['timestamp']})  {entry['reason']}")
        else:
            print("learned bad hosts: (none)")
        arc_cap, arc_total = arc_budget_state(
            arc_cap_usd=args.arc_cap_usd,
            ledger_dir=args.ledger_dir,
            ledger_glob=args.arc_ledger_glob,
            logger=logger,
        )
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
        print(f"arc total: ${arc_total:.4f}; arc cap: ${arc_cap:.4f}")
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
    run.add_argument(
        "--allow-empty-ledger", action="store_true",
        help="permit a live create with no figment-*.tsv baseline (intentional new arcs only)",
    )
    run.add_argument(
        "--arc-cap-usd", type=float,
        help="whole-arc spending cap (fallback: KB_ARC_CAP_USD, then 50.0)",
    )
    run.add_argument(
        "--arc-ledger-glob", default=DEFAULT_ARC_LEDGER_GLOB,
        help=f"ledger glob below --ledger-dir (default: {DEFAULT_ARC_LEDGER_GLOB})",
    )
    run.set_defaults(func=command_run)
    terminate = sub.add_parser("terminate", help="terminate a pod and verify it is absent")
    terminate.add_argument("--pod-id", required=True)
    terminate.set_defaults(func=command_terminate)
    status = sub.add_parser("status", help="list pods and their billing status")
    status.add_argument(
        "--ledger-dir", type=Path,
        help="cost ledger root (fallback: KB_LEDGER_DIR, ops worktree, then repo ledger)",
    )
    status.add_argument(
        "--arc-cap-usd", type=float,
        help="whole-arc spending cap (fallback: KB_ARC_CAP_USD, then 50.0)",
    )
    status.add_argument(
        "--forget-bad-host", default=None,
        help=(
            "remove one mislearned host from the session bad-host cache "
            "(%LOCALAPPDATA%/kb-figment-pod/bad_hosts.json) before printing the "
            "learned-host list"
        ),
    )
    status.add_argument(
        "--arc-ledger-glob", default=DEFAULT_ARC_LEDGER_GLOB,
        help=f"ledger glob below --ledger-dir (default: {DEFAULT_ARC_LEDGER_GLOB})",
    )
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
