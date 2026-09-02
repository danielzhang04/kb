#!/usr/bin/env python3
"""Bounded RunPod/ComfyUI bake-off runner with verified pod teardown."""

from __future__ import annotations

import argparse
import atexit
import copy
import json
import logging
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
    return session, ApiKeyRedactionFilter(session)


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


class PodLease:
    """The sole owner of a pod, including idempotent terminate-and-verify."""

    def __init__(self, api: Any, payload: dict[str, Any] | None, logger: logging.Logger,
                 *, pod_id: str | None = None, sleep: Callable[[float], None] = time.sleep,
                 attempts: int = TERMINATE_ATTEMPTS):
        self.api = api
        self.payload = payload
        self.logger = logger
        self.pod_id = pod_id
        self.pod: dict[str, Any] | None = None
        self.sleep = sleep
        self.attempts = attempts
        self._lock = threading.RLock()
        self._verified_absent = False
        self._registered = False
        self._atexit_callback = self._close_at_exit

    def __enter__(self) -> "PodLease":
        if self.pod_id is None:
            if self.payload is None:
                raise HarnessError("a create payload is required")
            self.logger.info("creating pod")
            created = self.api.create_pod(self.payload)
            self.pod_id = created.get("id")
            self.pod = created
            if not self.pod_id:
                # Recover a billed pod by the unique name if the create response is incomplete.
                matches = [p for p in self.api.list_pods()
                           if p.get("name") == self.payload.get("name") and p.get("id")]
                if len(matches) == 1:
                    self.pod = matches[0]
                    self.pod_id = matches[0]["id"]
                else:
                    raise HarnessError(
                        "pod creation may have succeeded but its id is ambiguous; run `status` "
                        "and terminate the uniquely named figment-bakeoff pod manually"
                    )
        atexit.register(self._atexit_callback)
        self._registered = True
        self.logger.info("pod acquired %s", self.pod_id)
        return self

    def _close_at_exit(self) -> None:
        try:
            self.close()
        except BaseException:
            # close() already emitted the mandatory loud line.
            pass

    def close(self) -> None:
        with self._lock:
            if not self.pod_id or self._verified_absent:
                return
            pod_id = self.pod_id
            for attempt in range(1, self.attempts + 1):
                self.logger.warning("terminate attempt %d/%d for pod %s",
                                    attempt, self.attempts, pod_id)
                try:
                    self.api.delete_pod(pod_id)
                except BaseException as exc:
                    self.logger.error("terminate request failed for pod %s: %s", pod_id, exc)
                try:
                    if self.api.get_pod(pod_id) is None:
                        self._verified_absent = True
                        self.logger.warning("termination verified: pod %s is absent", pod_id)
                        if self._registered:
                            atexit.unregister(self._atexit_callback)
                            self._registered = False
                        return
                except BaseException as exc:
                    self.logger.error("termination verification failed for pod %s: %s", pod_id, exc)
                if attempt < self.attempts:
                    self.sleep(min(2 ** (attempt - 1), 8))
            message = f"POD STILL RUNNING {pod_id}"
            self.logger.critical(message)
            raise PodStillRunning(message)

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        self.close()
        return False


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

    def stop(self) -> None:
        self._stop.set()
        if self.thread.is_alive() and self.thread is not threading.current_thread():
            self.thread.join(timeout=2)


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
    if float(manifest["price_usd_per_hour"]) < 0:
        raise HarnessError("price_usd_per_hour cannot be negative")
    if not isinstance(manifest.get("jobs"), list) or not manifest["jobs"]:
        raise HarnessError("manifest jobs must be a non-empty list")
    load_workflow(manifest, manifest_path)
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


def estimate_cost(manifest: dict[str, Any], max_minutes: float, max_usd: float | None) -> float:
    if max_minutes <= 0:
        raise HarnessError("--max-minutes must be greater than zero")
    estimate = float(manifest["price_usd_per_hour"]) * max_minutes / 60.0
    if max_usd is not None and estimate > max_usd:
        raise HarnessError(
            f"preflight refused: estimated ${estimate:.4f} exceeds --max-usd ${max_usd:.4f}"
        )
    return estimate


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
        f"run_required comfy-root test -d {shlex.quote(root)}",
        "run_required python-present python --version",
        "run_required git-present git --version",
        "run_required curl-present curl --version",
    ]
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


class RemoteExecutor:
    def __init__(self, host: str, port: int, known_hosts: Path, logger: logging.Logger):
        self.host = host
        self.port = port
        self.known_hosts = known_hosts
        self.logger = logger

    def _base(self, program: str) -> list[str]:
        return [
            program,
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", f"UserKnownHostsFile={self.known_hosts}",
        ]

    def bootstrap(self, script: str, timeout: float) -> None:
        command = self._base("ssh") + ["-p", str(self.port), f"root@{self.host}", "bash -s"]
        completed = subprocess.run(command, input=script, text=True, capture_output=True, timeout=timeout)
        for line in (completed.stdout + completed.stderr).splitlines():
            self.logger.info("bootstrap: %s", line)
        if completed.returncode:
            raise HarnessError(f"bootstrap failed with exit code {completed.returncode}")

    def copy(self, remote_path: str, local_path: Path, timeout: float) -> None:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        remote = f"root@{self.host}:{shlex.quote(remote_path)}"
        # Uppercase -P is intentional: lowercase -p only preserves timestamps/modes.
        command = self._base("scp") + ["-P", str(self.port), remote, str(local_path)]
        completed = subprocess.run(command, text=True, capture_output=True, timeout=timeout)
        if completed.returncode:
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

    def __enter__(self) -> int:
        command = self.remote._base("ssh") + [
            "-o", "ExitOnForwardFailure=yes",
            "-p", str(self.remote.port),
            "-N", "-L", f"127.0.0.1:{self.local_port}:127.0.0.1:{self.remote_port}",
            f"root@{self.remote.host}",
        ]
        self.process = subprocess.Popen(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
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

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
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
                if status.get("status_str") == "error" or status.get("completed") is False:
                    raise HarnessError(f"ComfyUI job {prompt_id} failed")
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


def apply_job(workflow: dict[str, Any], job: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(workflow)
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
    if "seed" not in job:
        raise HarnessError("every job requires a seed")
    seed_fields = 0
    for node in result.values():
        inputs = node.get("inputs") if isinstance(node, dict) else None
        if isinstance(inputs, dict) and "seed" in inputs:
            inputs["seed"] = int(job["seed"])
            seed_fields += 1
    if seed_fields == 0:
        raise HarnessError("workflow has no inputs.seed field for the job seed")
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
                         output_name: str, comfy_root: str, timeout: float) -> list[Path]:
    downloaded: list[Path] = []
    for index, image in enumerate(remote_images, start=1):
        suffix = PurePosixPath(image["filename"]).suffix.lower()
        local_name = f"{output_name}{suffix}" if len(remote_images) == 1 else f"{output_name}_{index:02d}{suffix}"
        local_path = out_dir / local_name
        remote.copy(remote_output_path(comfy_root, image), local_path, timeout)
        if not local_path.is_file() or local_path.stat().st_size <= 0:
            raise HarnessError(f"download verification failed for {local_path}")
        downloaded.append(local_path)
    if len(downloaded) != len(remote_images):
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


def repo_ledger_dir() -> Path:
    return Path(__file__).resolve().parents[4] / "ledgers" / "cost"


def run_harness(manifest: dict[str, Any], manifest_path: Path, out_dir: Path, *,
                max_usd: float | None, max_minutes: float, dry_run: bool,
                api: Any | None = None, logger: logging.Logger | None = None,
                redactor: ApiKeyRedactionFilter | None = None,
                remote_factory: Callable[[str, int, Path, logging.Logger], Any] | None = None,
                comfy_factory: Callable[[str], Any] | None = None,
                tunnel_factory: Callable[[Any, int, logging.Logger], Any] | None = None,
                sleep: Callable[[float], None] = time.sleep,
                ledger_dir: Path | None = None) -> dict[str, Any]:
    require_manifest(manifest, manifest_path)
    estimate = estimate_cost(manifest, max_minutes, max_usd)
    logger = logger or build_logger(redactor)
    logger.info("preflight cost estimate: $%.4f for %.2f minute(s)", estimate, max_minutes)
    out_dir.mkdir(parents=True, exist_ok=True)
    if api is None:
        api = DryRunAPI(float(manifest["price_usd_per_hour"])) if dry_run else None
    if api is None:
        raise HarnessError("live run requires an authenticated API")

    payload = create_payload(manifest)
    started = time.monotonic()
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
    images_manifest: list[dict[str, Any]] = []
    lease = PodLease(api, payload, logger, sleep=sleep)
    cancel = threading.Event()
    watchdog: Watchdog | None = None
    caught: BaseException | None = None
    actual_hourly = float(manifest["price_usd_per_hour"])
    try:
        with shutdown_signals(cancel), lease:
            result["pod_id"] = lease.pod_id
            created = lease.pod or {}
            actual_hourly = float(created.get("adjustedCostPerHr") or created.get("costPerHr") or actual_hourly)
            max_actual = max_usd if max_usd is not None else float("inf")
            if actual_hourly * max_minutes / 60.0 > max_actual:
                raise HarnessError("created pod hourly price exceeds the approved --max-usd budget")
            watchdog = Watchdog(max_minutes * 60.0, lease, cancel, logger)
            watchdog.start()
            ready_timeout = min(float(manifest.get("ready_timeout_seconds", DEFAULT_READY_TIMEOUT)), max_minutes * 60.0)
            _pod, host, ssh_port = wait_ready(api, str(lease.pod_id), ready_timeout, watchdog, logger, sleep)
            known_hosts = out_dir / ".runpod_known_hosts"
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
                    workflow = apply_job(base_workflow, job)
                    prompt_id = comfy.submit(workflow)
                    remote_images = comfy.wait_outputs(prompt_id, per_job_timeout, watchdog)
                    paths = download_job_outputs(remote, remote_images, out_dir, output_name,
                                                 comfy_root, per_job_timeout)
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
            watchdog.stop()
        result["termination_verified"] = lease._verified_absent
        elapsed = time.monotonic() - started
        result["finished_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        result["elapsed_seconds"] = round(elapsed, 3)
        result["hourly_price_usd"] = actual_hourly
        result["estimated_actual_usd"] = round(actual_hourly * elapsed / 3600.0, 6)
        write_json(out_dir / "run.json", result, redactor)
        if images_manifest:
            write_json(out_dir / "manifest.json", {"images": images_manifest}, redactor)
        if result["pod_id"]:
            if dry_run and ledger_dir is None:
                ledger_dir = out_dir / "dry-run-ledger"
            cost_path = append_cost_row(
                ledger_dir or repo_ledger_dir(),
                str(manifest["gpu"]["type"]),
                f"runpod-bakeoff:{result['pod_id']}",
                float(result["estimated_actual_usd"]),
            )
            logger.info("cost row: %s", cost_path)
    if caught:
        raise caught
    return result


def command_run(args: argparse.Namespace) -> int:
    manifest_path = resolve_manifest_path(args.manifest)
    manifest = load_manifest(manifest_path)
    session: Any = None
    redactor: ApiKeyRedactionFilter | None = None
    api: Any | None = None
    if not args.dry_run:
        try:
            session, redactor = build_authenticated_session()
        except KeyError as exc:
            raise HarnessError("RUNPOD_API_KEY is required for live commands") from exc
        api = RunPodAPI(session)
    logger = build_logger(redactor)
    try:
        run_harness(
            manifest,
            manifest_path,
            args.out.resolve(),
            max_usd=args.max_usd,
            max_minutes=args.max_minutes or float(manifest.get("max_minutes", DEFAULT_MAX_MINUTES)),
            dry_run=args.dry_run,
            api=api,
            logger=logger,
            redactor=redactor,
        )
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
    logger = build_logger(redactor)
    try:
        lease = PodLease(RunPodAPI(session), None, logger, pod_id=args.pod_id)
        with lease:
            pass
        return 0
    finally:
        session.close()


def command_status(_args: argparse.Namespace) -> int:
    try:
        session, redactor = build_authenticated_session()
    except KeyError as exc:
        raise HarnessError("RUNPOD_API_KEY is required for live commands") from exc
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
    try:
        return int(args.func(args))
    except KeyboardInterrupt:
        print("interrupted; pod termination was attempted and verified", file=sys.stderr)
        return 130
    except RunCancelled as exc:
        print(str(exc), file=sys.stderr)
        return 128
    except HarnessError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
