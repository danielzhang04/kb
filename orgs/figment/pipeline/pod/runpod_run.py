#!/usr/bin/env python3
"""Bounded RunPod/ComfyUI bake-off runner with verified pod teardown."""

from __future__ import annotations

import argparse
import atexit
import copy
import csv
import json
import logging
import math
import os
import re
import shlex
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
from contextlib import contextmanager
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
DEFAULT_READY_TIMEOUT = 20 * 60.0
REQUEST_TIMEOUT = 30.0
TERMINATE_ATTEMPTS = 5
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
COMFYUI_TAG = "v0.3.76"
DEFAULT_SEED_FIELDS = ("seed", "noise_seed")


_active_redactor: ApiKeyRedactionFilter | None = None


class HarnessError(RuntimeError):
    """A safe, user-facing harness failure."""


class PodStillRunning(HarnessError):
    """Termination could not be verified."""


class RunCancelled(HarnessError):
    """SIGINT, SIGTERM, or the wall-clock watchdog requested shutdown."""


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


def redacting_excepthook(exc_type: type[BaseException], exc: BaseException, _tb: Any) -> None:
    """Last-resort one-line exception reporting; never emit a raw traceback."""
    print(redact_for_stderr(f"{exc_type.__name__}: {exc}"), file=sys.stderr)


# main() catches command failures, but this also protects importers that invoke a command
# outside main() and allow it to reach the interpreter.
sys.excepthook = redacting_excepthook


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
    # This is the one and only environment read. The value is retained in this header only.
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
        data = self._request("POST", "/pods", json_body=payload)
        if not isinstance(data, dict):
            raise HarnessError("RunPod create response was not an object")
        return data

    def get_pod(self, pod_id: str) -> dict[str, Any] | None:
        data = self._request("GET", f"/pods/{pod_id}", allow_404=True)
        if data is not None and not isinstance(data, dict):
            raise HarnessError("RunPod pod response was not an object")
        return data

    def list_pods(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/pods")
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
            "publicIp": "127.0.0.1",
            "portMappings": {"22": 22022},
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

    for signum in (signal.SIGINT, signal.SIGTERM):
        previous[signum] = signal.getsignal(signum)
        signal.signal(signum, handler)
    try:
        yield
    finally:
        for signum, old in previous.items():
            signal.signal(signum, old)


class PodLease:
    """The sole owner of a pod, including name recovery and verified teardown."""

    def __init__(self, api: Any, payload: dict[str, Any] | None, logger: logging.Logger,
                 *, pod_id: str | None = None, sleep: Callable[[float], None] = time.sleep,
                 attempts: int = TERMINATE_ATTEMPTS,
                 on_acquired: Callable[[str, dict[str, Any] | None], None] | None = None):
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
        return [
            pod for pod in self.api.list_pods()
            if isinstance(pod, dict) and pod.get("name") == name and pod.get("id")
        ]

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
                if len(matches) != 1:
                    raise HarnessError(
                        "pod creation may have succeeded but its id was not returned"
                    )
                self._remember_pod(matches[0])
        except BaseException as exc:
            self._create_uncertain = True
            try:
                self.close()
            except BaseException as teardown_exc:
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
            label = pod_id or name or "UNKNOWN"
            message = f"POD STILL RUNNING {label}"
            self.logger.critical(message)
            # Logging handlers may already be torn down during interpreter exit.
            print(message, file=sys.stderr)

    def close(self) -> None:
        with teardown_signal_mask(self.logger), self._lock:
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
                        for pod in remaining:
                            self._remember_pod(pod)
                        name_scan_ok = not remaining
                    except BaseException as exc:
                        name_scan_ok = False
                        self.logger.error("pod-name verification failed: %s", exc)

                if ever_discovered and all_ids_absent and name_scan_ok:
                    self._mark_verified(self.pod_id or self.pod_name or "UNKNOWN")
                    return
                # With an ambiguous create and no discovered id, require the final name
                # scan to be empty; early empty lists may only reflect eventual consistency.
                if (not ever_discovered and self._create_uncertain and name_scan_ok
                        and attempt == self.attempts):
                    self._mark_verified(self.pod_name or "UNKNOWN")
                    return
                if attempt < self.attempts:
                    self.sleep(min(2 ** (attempt - 1), 8))
            label = self.pod_id or self.pod_name or "UNKNOWN"
            message = f"POD STILL RUNNING {label}"
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
    except BaseException:
        pass
    return exc


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

    for signum in (signal.SIGINT, signal.SIGTERM):
        previous[signum] = signal.getsignal(signum)
        signal.signal(signum, handler)
    try:
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
        return json.loads(text)
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
    if not isinstance(manifest.get("jobs"), list) or not manifest["jobs"]:
        raise HarnessError("manifest jobs must be a non-empty list")
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


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def repo_ledger_dir() -> Path:
    return repo_root() / "ledgers" / "cost"


def daily_budget_state(*, budget_path: Path | None = None,
                       ledger_dir: Path | None = None) -> tuple[float, float]:
    budget_path = budget_path or repo_root() / "governance" / "budget.yaml"
    ledger_dir = ledger_dir or repo_ledger_dir()
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
                    raise HarnessError(f"cost ledger has no usd column: {path}")
                for row in reader:
                    value = float(row["usd"])
                    if not math.isfinite(value) or value < 0:
                        raise HarnessError(f"cost ledger has invalid usd value: {path}")
                    spent += value
        except (OSError, TypeError, ValueError) as exc:
            raise HarnessError(f"could not read cost ledger {path}: {exc}") from exc
    return daily_limit, spent


def enforce_daily_budget(estimate: float, *, budget_path: Path | None = None,
                         ledger_dir: Path | None = None) -> tuple[float, float]:
    daily_limit, spent = daily_budget_state(budget_path=budget_path, ledger_dir=ledger_dir)
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


def create_payload(manifest: dict[str, Any]) -> dict[str, Any]:
    gpu = manifest["gpu"]
    payload: dict[str, Any] = {
        "name": f"figment-bakeoff-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}",
        "cloudType": str(gpu.get("cloud", "SECURE")).upper(),
        "computeType": "GPU",
        "gpuTypeIds": [str(gpu["type"])],
        "gpuTypePriority": "availability",
        "gpuCount": int(gpu.get("count", 1)),
        "containerDiskInGb": int(manifest.get("container_disk_gb", 50)),
        "ports": ["22/tcp"],
        "supportPublicIp": True,
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


def pod_connection(pod: dict[str, Any]) -> tuple[str, int] | None:
    host = pod.get("publicIp")
    mappings = pod.get("portMappings") or {}
    port = mappings.get("22") if isinstance(mappings, dict) else None
    if port is None and isinstance(mappings, dict):
        port = mappings.get(22)
    if host and port:
        return str(host), int(port)
    return None


def wait_ready(api: Any, pod_id: str, timeout: float, watchdog: Watchdog,
               logger: logging.Logger, sleep: Callable[[float], None] = time.sleep) -> tuple[dict[str, Any], str, int]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        watchdog.check()
        pod = api.get_pod(pod_id)
        if pod is None:
            raise HarnessError(f"pod {pod_id} disappeared before becoming ready")
        connection = pod_connection(pod)
        if pod.get("desiredStatus") == "RUNNING" and connection:
            logger.info("pod ready with mapped SSH port")
            return pod, connection[0], connection[1]
        sleep(2)
    raise HarnessError(f"pod readiness timed out after {timeout:.0f}s")


def _safe_node_name(url: str, explicit: str | None) -> str:
    name = explicit or PurePosixPath(url.removesuffix("/")).name.removesuffix(".git")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", name):
        raise HarnessError(f"unsafe custom node directory name: {name!r}")
    return name


def bootstrap_script(manifest: dict[str, Any]) -> str:
    comfy = manifest.get("comfyui") or {}
    root = str(comfy.get("root", "/workspace/ComfyUI"))
    port = int(comfy.get("port", 8188))
    lines = [
        "#!/usr/bin/env bash",
        "fail=0",
        "run_required() { label=\"$1\"; shift; \"$@\"; rc=$?; printf 'STEP %s rc=%s\\n' \"$label\" \"$rc\"; if [ \"$rc\" -ne 0 ]; then fail=1; fi; return 0; }",
        "run_cosmetic() { label=\"$1\"; shift; \"$@\"; rc=$?; printf 'STEP %s rc=%s (cosmetic)\\n' \"$label\" \"$rc\"; return 0; }",
        "run_required python-present python --version",
        "run_required git-present git --version",
        "run_required curl-present curl --version",
        "if [ \"$fail\" -ne 0 ]; then exit \"$fail\"; fi",
    ]
    install_comfy = (
        f"if [ -d {shlex.quote(root + '/.git')} ]; then "
        f"git -C {shlex.quote(root)} fetch --depth 1 origin tag {shlex.quote(COMFYUI_TAG)} && "
        f"git -C {shlex.quote(root)} checkout --detach {shlex.quote(COMFYUI_TAG)}; "
        f"elif [ -e {shlex.quote(root)} ]; then "
        f"echo 'ComfyUI root exists but is not a git checkout' >&2; exit 1; "
        f"else git clone --branch {shlex.quote(COMFYUI_TAG)} --depth 1 "
        f"https://github.com/comfyanonymous/ComfyUI {shlex.quote(root)}; fi && "
        f"python -m pip install -r {shlex.quote(root + '/requirements.txt')}"
    )
    lines.extend([
        f"run_required comfy-install bash -lc {shlex.quote(install_comfy)}",
        "if [ \"$fail\" -ne 0 ]; then exit \"$fail\"; fi",
    ])
    for index, model in enumerate(manifest.get("models", []), start=1):
        destination = str(PurePosixPath(str(model["destination_dir"])) / PurePosixPath(str(model["filename"])).name)
        encoded_filename = quote(str(model["filename"]), safe="/")
        url = f"https://huggingface.co/{model['repo_id']}/resolve/main/{encoded_filename}?download=true"
        command = (
            f"mkdir -p {shlex.quote(str(model['destination_dir']))} && "
            f"if [ -s {shlex.quote(destination)} ]; then true; else "
            f"tmp={shlex.quote(destination + '.partial')}; "
            f"curl --fail --location --retry 3 --output \"$tmp\" {shlex.quote(url)} && "
            f"test -s \"$tmp\" && mv \"$tmp\" {shlex.quote(destination)}; fi"
        )
        lines.append(f"run_required model-{index} bash -lc {shlex.quote(command)}")
        lines.append("if [ \"$fail\" -ne 0 ]; then exit \"$fail\"; fi")
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
        lines.append(f"run_required node-{index} bash -lc {shlex.quote(command)}")
        requirements = f"{target}/requirements.txt"
        install = f"if [ -f {shlex.quote(requirements)} ]; then python -m pip install -r {shlex.quote(requirements)}; else true; fi"
        lines.append(f"run_required node-deps-{index} bash -lc {shlex.quote(install)}")
        lines.append("if [ \"$fail\" -ne 0 ]; then exit \"$fail\"; fi")
    start = str(comfy.get("start_command", f"python main.py --listen 127.0.0.1 --port {port}"))
    start_cmd = (
        f"if curl --silent --fail http://127.0.0.1:{port}/system_stats >/dev/null; then true; else "
        f"cd {shlex.quote(root)} && nohup bash -lc {shlex.quote(start)} > /tmp/figment-comfy.log 2>&1 & fi"
    )
    lines.append(f"run_required comfy-start bash -lc {shlex.quote(start_cmd)}")
    health_cmd = (
        f"for n in $(seq 1 120); do curl --silent --fail http://127.0.0.1:{port}/system_stats >/dev/null && exit 0; sleep 2; done; "
        "tail -n 100 /tmp/figment-comfy.log 2>/dev/null; exit 1"
    )
    lines.append(f"run_required comfy-health bash -lc {shlex.quote(health_cmd)}")
    lines.extend(["run_cosmetic disk-summary df -h", "exit \"$fail\""])
    return "\n".join(lines) + "\n"


def child_process_env() -> dict[str, str]:
    # The filter condition is evaluated before the value expression, so the key's value
    # is neither copied nor read here.
    return {name: value for name, value in os.environ.items() if name != "RUNPOD_API_KEY"}


class RemoteExecutor:
    def __init__(self, host: str, port: int, known_hosts: Path, logger: logging.Logger):
        self.host = host
        self.port = port
        self.known_hosts = known_hosts
        self.logger = logger
        self.known_hosts.parent.mkdir(parents=True, exist_ok=True)

    def _base(self, program: str) -> list[str]:
        return [
            program,
            "-o", "BatchMode=yes",
            "-o", "LogLevel=ERROR",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", f"UserKnownHostsFile={self.known_hosts}",
        ]

    def bootstrap(self, script: str, timeout: float) -> None:
        command = self._base("ssh") + ["-p", str(self.port), f"root@{self.host}", "bash -s"]
        completed = subprocess.run(
            command, input=script, text=True, capture_output=True, timeout=timeout,
            env=child_process_env(),
        )
        for line in (completed.stdout + completed.stderr).splitlines():
            self.logger.info("bootstrap: %s", line)
        if completed.returncode:
            raise HarnessError(f"bootstrap failed with exit code {completed.returncode}")

    def copy(self, remote_path: str, local_path: Path, timeout: float) -> None:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        remote = f"root@{self.host}:{shlex.quote(remote_path)}"
        # Uppercase -P is intentional: lowercase -p only preserves timestamps/modes.
        command = self._base("scp") + ["-P", str(self.port), remote, str(local_path)]
        completed = subprocess.run(
            command, text=True, capture_output=True, timeout=timeout,
            env=child_process_env(),
        )
        if completed.returncode:
            for line in completed.stderr.splitlines():
                self.logger.error("scp: %s", line)
            raise HarnessError(f"scp download failed with exit code {completed.returncode}")


class DryRunRemote:
    def __init__(self, logger: logging.Logger):
        self.logger = logger

    def bootstrap(self, _script: str, _timeout: float) -> None:
        self.logger.info("bootstrap: STEP dry-run rc=0")

    def copy(self, remote_path: str, local_path: Path, _timeout: float) -> None:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(("dry-run image from " + remote_path + "\n").encode())


class SSHTunnel:
    def __init__(self, remote: RemoteExecutor, remote_port: int, logger: logging.Logger):
        self.remote = remote
        self.remote_port = remote_port
        self.logger = logger
        self.local_port = _free_tcp_port()
        self.process: subprocess.Popen[str] | None = None
        self._stderr_thread: threading.Thread | None = None

    def _drain_stderr(self) -> None:
        if not self.process or not self.process.stderr:
            return
        try:
            for line in self.process.stderr:
                if line.strip():
                    self.logger.error("SSH port-forward: %s", line.rstrip())
        except BaseException as exc:
            self.logger.error("SSH port-forward stderr reader failed: %s", exc)

    def _kill(self) -> None:
        process = self.process
        if not process:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if self._stderr_thread and self._stderr_thread is not threading.current_thread():
            self._stderr_thread.join(timeout=1)
        self.logger.info("SSH port-forward exited with status %s", process.poll())

    def __enter__(self) -> int:
        command = self.remote._base("ssh") + [
            "-o", "ExitOnForwardFailure=yes",
            "-p", str(self.remote.port),
            "-N", "-L", f"127.0.0.1:{self.local_port}:127.0.0.1:{self.remote_port}",
            f"root@{self.remote.host}",
        ]
        try:
            self.process = subprocess.Popen(
                command, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                env=child_process_env(),
            )
            self._stderr_thread = threading.Thread(
                target=self._drain_stderr, name="ssh-tunnel-stderr", daemon=True
            )
            self._stderr_thread.start()
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    raise HarnessError("SSH port-forward exited before becoming ready")
                try:
                    with socket.create_connection(("127.0.0.1", self.local_port), timeout=0.25):
                        self.logger.info("SSH port-forward ready on local port %s", self.local_port)
                        return self.local_port
                except OSError:
                    time.sleep(0.1)
            raise HarnessError("SSH port-forward did not become ready within 30s")
        except BaseException:
            self._kill()
            raise

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        self._kill()
        return False


@contextmanager
def no_tunnel():
    yield 0


def _free_tcp_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class ComfyClient:
    def __init__(self, base_url: str, session: Any = None):
        if session is None and requests is None:
            raise HarnessError("the requests package is required for live commands")
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()
        self.client_id = uuid.uuid4().hex

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
                        if image.get("filename"):
                            outputs.append({
                                "filename": str(image["filename"]),
                                "subfolder": str(image.get("subfolder", "")),
                                "type": str(image.get("type", "output")),
                            })
                if outputs:
                    return outputs
                if status.get("completed") is True:
                    raise HarnessError(f"ComfyUI job {prompt_id} completed with zero images")
            time.sleep(1)
        raise HarnessError(f"ComfyUI job {prompt_id} timed out")


class DryRunComfyClient:
    def __init__(self):
        self.counter = 0

    def submit(self, _workflow: dict[str, Any]) -> str:
        self.counter += 1
        return f"dry-prompt-{self.counter}"

    def wait_outputs(self, prompt_id: str, _timeout: float, watchdog: Watchdog) -> list[dict[str, str]]:
        watchdog.check()
        return [{"filename": f"{prompt_id}.png", "subfolder": "", "type": "output"}]


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


def remote_output_path(comfy_root: str, image: dict[str, str]) -> str:
    filename = PurePosixPath(image["filename"])
    subfolder = PurePosixPath(image.get("subfolder", ""))
    if filename.is_absolute() or ".." in filename.parts or subfolder.is_absolute() or ".." in subfolder.parts:
        raise HarnessError("ComfyUI returned an unsafe output path")
    if filename.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HarnessError(f"ComfyUI returned unsupported output type: {filename.suffix}")
    return str(PurePosixPath(comfy_root) / "output" / subfolder / filename)


def download_job_outputs(remote: Any, remote_images: list[dict[str, str]], out_dir: Path,
                         output_name: str, comfy_root: str, timeout: float,
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
        remote.copy(remote_output_path(comfy_root, image), local_path, timeout)
        if not local_path.is_file() or local_path.stat().st_size <= 0:
            raise HarnessError(f"download verification failed for {local_path}")
        downloaded.append(local_path)
    if len(downloaded) != expected_images:
        raise HarnessError("download count verification failed")
    return downloaded


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


def upsert_cost_row(ledger_dir: Path, model: str, step: str, usd: float) -> Path:
    if any(char in model + step for char in "\t\r\n"):
        raise HarnessError("ledger model and step must be single TSV fields")
    ledger_dir.mkdir(parents=True, exist_ok=True)
    path = ledger_dir / f"figment-{datetime.now(timezone.utc):%Y-%m-%d}.tsv"
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
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["model", "step", "usd"], delimiter="\t",
                                lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)
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
                remote_factory: Callable[[str, int, Path, logging.Logger], Any] | None = None,
                comfy_factory: Callable[[str], Any] | None = None,
                tunnel_factory: Callable[[Any, int, logging.Logger], Any] | None = None,
                sleep: Callable[[float], None] = time.sleep,
                ledger_dir: Path | None = None, budget_path: Path | None = None,
                daily_ledger_dir: Path | None = None) -> dict[str, Any]:
    require_manifest(manifest, manifest_path)
    max_minutes = effective_max_minutes(max_minutes, manifest)
    if not dry_run and max_usd is None:
        raise HarnessError("--max-usd is required for a live run")
    estimate = estimate_cost(manifest, max_minutes, max_usd)
    logger = logger or build_logger(redactor)
    if redactor:
        set_active_redactor(redactor)
    daily_limit: float | None = None
    daily_spent: float | None = None
    if not dry_run:
        daily_limit, daily_spent = enforce_daily_budget(
            estimate,
            budget_path=budget_path,
            ledger_dir=daily_ledger_dir or ledger_dir or repo_ledger_dir(),
        )
    logger.info("preflight cost estimate: $%.4f for %.2f minute(s)", estimate, max_minutes)
    out_dir.mkdir(parents=True, exist_ok=True)
    if api is None:
        api = DryRunAPI(float(manifest["price_usd_per_hour"])) if dry_run else None
    if api is None:
        raise HarnessError("live run requires an authenticated API")

    payload = create_payload(manifest)
    ledger_target = ledger_dir or repo_ledger_dir()
    if dry_run and ledger_dir is None:
        ledger_target = out_dir / "dry-run-ledger"
    ledger_model = gpu_model_label(manifest["gpu"]["type"])
    started = time.monotonic()  # The budget clock begins immediately before create.
    started_utc = datetime.now(timezone.utc)
    result: dict[str, Any] = {
        "schema": "figment/runpod-run@1",
        "dry_run": dry_run,
        "pod_id": None,
        "gpu": manifest["gpu"],
        "started_utc": started_utc.isoformat(timespec="seconds"),
        "max_minutes": max_minutes,
        "preflight_estimate_usd": round(estimate, 6),
        "jobs": [],
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

    lease = PodLease(api, payload, logger, sleep=sleep, on_acquired=record_acquired)
    cancel = threading.Event()
    watchdog: Watchdog | None = None
    caught: BaseException | None = None
    actual_hourly: float | None = None
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
            ready_timeout = min(float(manifest.get("ready_timeout_seconds", DEFAULT_READY_TIMEOUT)), max_minutes * 60.0)
            ready_pod, host, ssh_port = wait_ready(
                api, str(lease.pod_id), ready_timeout, watchdog, logger, sleep
            )
            actual_hourly = ready_hourly_price(ready_pod)
            actual_ceiling = actual_hourly * max_minutes / 60.0
            if max_usd is not None and actual_ceiling > max_usd:
                raise HarnessError("READY pod hourly price exceeds the approved --max-usd budget")
            if (daily_limit is not None and daily_spent is not None
                    and daily_spent + actual_ceiling > daily_limit):
                raise HarnessError("READY pod hourly price exceeds the governance daily budget")
            known_hosts = out_dir / "_harness" / ".runpod_known_hosts"
            if dry_run:
                remote = DryRunRemote(logger)
                tunnel_context = no_tunnel()
            else:
                remote_builder = remote_factory or RemoteExecutor
                remote = remote_builder(host, ssh_port, known_hosts, logger)
                comfy_port = int((manifest.get("comfyui") or {}).get("port", 8188))
                tunnel_builder = tunnel_factory or SSHTunnel
                tunnel_context = tunnel_builder(remote, comfy_port, logger)
            remote.bootstrap(bootstrap_script(manifest), min(ready_timeout, 30 * 60))
            watchdog.check()
            with tunnel_context as local_port:
                if dry_run:
                    comfy = DryRunComfyClient()
                else:
                    comfy = comfy_factory(f"http://127.0.0.1:{local_port}") if comfy_factory else ComfyClient(f"http://127.0.0.1:{local_port}")
                base_workflow = load_workflow(manifest, manifest_path)
                comfy_root = str((manifest.get("comfyui") or {}).get("root", "/workspace/ComfyUI"))
                per_job_timeout = float(manifest.get("job_timeout_seconds", 15 * 60))
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
                    paths = download_job_outputs(remote, remote_images, out_dir, output_name,
                                                 comfy_root, per_job_timeout, expected_images)
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
    finally:
        if watchdog:
            watchdog.stop(teardown_budget_seconds(lease.attempts))
            if caught is None and watchdog.error:
                caught = watchdog.error
                result["error"] = f"{type(caught).__name__}: {caught}"
            elif caught is None and watchdog.fired.is_set():
                caught = RunCancelled("maximum runtime reached")
                result["error"] = f"{type(caught).__name__}: {caught}"
        pod_id, _pod_name, verified = lease.snapshot()
        result["pod_id"] = pod_id or result["pod_id"]
        result["termination_verified"] = verified
        elapsed = time.monotonic() - started
        result["finished_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        result["elapsed_seconds"] = round(elapsed, 3)
        result["hourly_price_usd"] = actual_hourly
        settled_cost = 0.0 if dry_run else estimate
        if not dry_run and actual_hourly is not None:
            measured = actual_hourly * elapsed / 3600.0
            settled_cost = measured if verified else max(estimate, measured)
        result["estimated_actual_usd"] = round(settled_cost, 6)
        write_json(out_dir / "run.json", result, redactor)
        if images_manifest:
            write_json(out_dir / "manifest.json", {"images": images_manifest}, redactor)
        if result["pod_id"]:
            cost_path = upsert_cost_row(
                ledger_target,
                ledger_model,
                f"pod-create {result['pod_id']}",
                float(result["estimated_actual_usd"]),
            )
            logger.info("cost row: %s", cost_path)
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run a bounded ComfyUI bake-off")
    run.add_argument("--manifest", required=True, type=Path)
    run.add_argument("--out", required=True, type=Path)
    run.add_argument("--dry-run", action="store_true", help="exercise every local stage with no network")
    run.add_argument("--max-usd", type=float)
    run.add_argument("--max-minutes", type=float)
    run.set_defaults(func=command_run)
    terminate = sub.add_parser("terminate", help="terminate a pod and verify it is absent")
    terminate.add_argument("--pod-id", required=True)
    terminate.set_defaults(func=command_terminate)
    status = sub.add_parser("status", help="list pods and their billing status")
    status.set_defaults(func=command_status)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    def report(exc: BaseException, summary: str) -> None:
        print(redact_for_stderr(summary), file=sys.stderr)
        if getattr(exc, "termination_verified", True) is False:
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
        report(exc, f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
