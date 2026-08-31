#!/usr/bin/env python3
"""Collect, finalize, and verify the Phase-I Gate-1 evidence package."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, TypedDict
from urllib.parse import quote, urlsplit


COMMAND_TIMEOUT = 30
HTTP_TIMEOUT = 10
SIGNING_PRINCIPAL = "kb-phase1"
EVIDENCE_NAMESPACE = "kb-phase1-evidence"
APPROVAL_NAMESPACE = "kb-phase1-approval"
INVENTORY_NAMESPACE = "kb-phase1-inventory"

REQUIRED_UNAUTH = (
    "/api/kb/tree", "/api/index", "/api/routing", "/api/agents", "/api/workflows",
    "/api/inbox", "/api/home", "/api/health", "/api/attention", "/api/schedules",
    "/api/control/runs", "/events",
)
REQUIRED_ROUTE_TESTS = (
    "server/index.test.ts",
    "server/agents/routes.test.ts",
    "server/control/routes.test.ts",
    "server/health/routes.test.ts",
    "server/home/routes.test.ts",
    "server/http/middleware.test.ts",
    "server/hub/sse.test.ts",
    "server/hub/ws.test.ts",
    "server/kb/routes.test.ts",
    "server/schedules/service.test.ts",
    "server/workflows/routes.test.ts",
)
# Task 15 non-data paths the confined browser must refuse, and one approved-root control.
CONFINEMENT_REFUSED = ("CLAUDE.md", ".git/config", "dashboard/server/index.ts", "scripts/cards.py")
CONFINEMENT_ALLOWED = "docs"

EVIDENCE_KEYS = {
    "schema", "key", "passed", "release", "host", "command", "startedAt", "finishedAt", "rawOutput",
}
RELEASE_KEYS = {"commit", "artifactSha256"}
HOST_KEYS = {"machineIdSha256", "bootId"}
RAW_OUTPUT_KEYS = {"file", "sha256"}
INVENTORY_KEYS = {"schema", "gate", "release", "files"}
INVENTORY_ROW_KEYS = {"path", "sha256"}
FINAL_CONTROL_FILES = {"evidence.inventory.json", "evidence.sha256", "evidence.sha256.sig"}
UNSIGNED_GATE1_FILES = {
    "gate1.json", "gate1.md", "tailscale-serve.json", "tailscale-funnel.json",
    "route-matrix.json", "acl-authorized.txt", "acl-denied.txt", "readyz.json",
    "gate1Boundary.evidence.json",
}
FINALIZED_GATE1_FILES = UNSIGNED_GATE1_FILES | {
    "APPROVED.txt", "APPROVED.txt.sig", "gate1Boundary.evidence.json.sig",
}
REPARSE_POINT = 0x400


@dataclass(frozen=True)
class AclProbeResult:
    role: Literal["authorized", "denied"]
    endpoint: str
    outcome: Literal["reached", "connection-refused", "timeout"]


class TailnetEvidence(TypedDict):
    serveTailnetOnly: bool
    funnelDisabled: bool
    aclAuthorized: bool
    aclDenied: bool


class EvidenceRelease(TypedDict):
    commit: str
    artifactSha256: str


class EvidenceHost(TypedDict):
    machineIdSha256: str
    bootId: str


class RawOutput(TypedDict):
    file: str
    sha256: str


class EvidencePayload(TypedDict):
    schema: Literal["kb.phase1-evidence/v1"]
    key: str
    passed: bool
    release: EvidenceRelease
    host: EvidenceHost
    command: list[str]
    startedAt: str
    finishedAt: str
    rawOutput: RawOutput


class EvidenceInventoryRow(TypedDict):
    path: str
    sha256: str


class EvidenceInventoryV1(TypedDict):
    schema: Literal["kb.phase1-inventory/v1"]
    gate: Literal[1]
    release: EvidenceRelease
    files: list[EvidenceInventoryRow]


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_NO_PROXY_HANDLER = urllib.request.ProxyHandler({})
_NO_REDIRECT_OPENER = urllib.request.build_opener(_NO_PROXY_HANDLER, _NoRedirectHandler())


def decide(evidence: dict) -> dict:
    failures = []
    if any(evidence["unauthenticatedReads"].get(path) != 401 for path in REQUIRED_UNAUTH):
        failures.append("non-health read bypassed session auth")
    if any(evidence["authenticatedReads"].get(path) != 200 for path in REQUIRED_UNAUTH):
        failures.append("authenticated read failed")
    if evidence.get("websocket") != {"unauthenticated": 401, "authenticated": 101}:
        failures.append("websocket session auth failed")
    if evidence["health"] != {"/healthz": 200, "/readyz": 200}:
        failures.append("health bootstrap failed")
    for key in (
        "routeInventoryCovered", "confined", "serveTailnetOnly", "funnelDisabled",
        "aclAuthorized", "aclDenied", "executionLocked",
    ):
        if evidence.get(key) is not True:
            failures.append(key)
    return {"passed": not failures, "failures": failures}


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"


def load_json_without_duplicates(raw: bytes) -> object:
    def closed_pairs(pairs: list[tuple[str, object]]) -> dict:
        result = {}
        for key, value in pairs:
            if key in result:
                raise RuntimeError(f"duplicate JSON key: {key}")
            result[key] = value
        return result

    try:
        return json.loads(raw, object_pairs_hook=closed_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("invalid JSON evidence") from error


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_link_or_reparse(path: Path) -> bool:
    try:
        attrs = getattr(path.lstat(), "st_file_attributes", 0)
    except OSError:
        return False
    return path.is_symlink() or bool(attrs & REPARSE_POINT)


def _is_regular_file(path: Path) -> bool:
    return path.is_file() and not _is_link_or_reparse(path)


def _is_real_directory(path: Path) -> bool:
    return path.is_dir() and not _is_link_or_reparse(path)


def _read_regular_bytes(path: Path) -> bytes:
    if not _is_regular_file(path):
        raise RuntimeError(f"regular file required: {path.name}")
    return path.read_bytes()


def _decode_utf8(raw: bytes, label: str) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError(f"{label} must be UTF-8") from error


def canonical_utc(value: str) -> datetime:
    if type(value) is not str or re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value,
    ) is None:
        raise RuntimeError("timestamp must be canonical millisecond UTC")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise RuntimeError("timestamp must be canonical millisecond UTC") from error


def _canonical_now(now) -> str:
    value = now().astimezone(timezone.utc)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"


def safe_command(command: list[str]) -> list[str]:
    if type(command) is not list or not command or any(type(arg) is not str or not arg for arg in command):
        raise RuntimeError("evidence command must be nonempty argv")
    for arg in command:
        if re.search(r"[\x00-\x1f\x7f]", arg):
            raise RuntimeError("control character in evidence command")
        if re.fullmatch(
            r"(?i)--?(?:token|secret|password|passkey|credential|api-key|access-key|authorization)(?:=.*)?",
            arg,
        ) or re.search(
            r"(?i)(authorization\s*:|-----BEGIN .*PRIVATE KEY-----|(?:token|secret|password|session)[A-Za-z0-9_]*=)",
            arg,
        ):
            raise RuntimeError("credential value in evidence command")
    return list(command)


def require_uuid(value: str) -> str:
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, TypeError, ValueError) as error:
        raise RuntimeError("boot id must be canonical UUID") from error
    if str(parsed) != value:
        raise RuntimeError("boot id must be canonical UUID")
    return value


def parse_closed_evidence(raw: bytes, expected_keys: set[str] = EVIDENCE_KEYS) -> EvidencePayload:
    value = load_json_without_duplicates(raw)
    if type(value) is not dict or set(value) != expected_keys or canonical_json(value).encode("utf-8") != raw:
        raise RuntimeError("closed canonical evidence required")
    if value.get("schema") != "kb.phase1-evidence/v1" or type(value.get("passed")) is not bool:
        raise RuntimeError("unsupported evidence payload")
    if type(value["release"]) is not dict or set(value["release"]) != RELEASE_KEYS:
        raise RuntimeError("closed release evidence required")
    if type(value["host"]) is not dict or set(value["host"]) != HOST_KEYS:
        raise RuntimeError("closed host evidence required")
    if type(value["rawOutput"]) is not dict or set(value["rawOutput"]) != RAW_OUTPUT_KEYS:
        raise RuntimeError("closed raw-output evidence required")
    scalar_strings = [
        value["key"], value["startedAt"], value["finishedAt"], value["release"]["commit"],
        value["release"]["artifactSha256"], value["host"]["machineIdSha256"],
        value["host"]["bootId"], value["rawOutput"]["file"], value["rawOutput"]["sha256"],
    ]
    if any(type(item) is not str for item in scalar_strings):
        raise RuntimeError("evidence scalar types are invalid")
    start, finish = canonical_utc(value["startedAt"]), canonical_utc(value["finishedAt"])
    if finish < start or re.fullmatch(r"[A-Za-z][A-Za-z0-9]*", value["key"]) is None:
        raise RuntimeError("invalid evidence identity or time range")
    if re.fullmatch(r"[0-9a-f]{40}", value["release"]["commit"]) is None or re.fullmatch(
        r"[0-9a-f]{64}", value["release"]["artifactSha256"],
    ) is None:
        raise RuntimeError("invalid release evidence")
    safe_command(value["command"])
    require_uuid(value["host"]["bootId"])
    if Path(value["rawOutput"]["file"]).name != value["rawOutput"]["file"]:
        raise RuntimeError("raw-output filename must be package-local")
    if re.fullmatch(r"[0-9a-f]{64}", value["host"]["machineIdSha256"]) is None or re.fullmatch(
        r"[0-9a-f]{64}", value["rawOutput"]["sha256"],
    ) is None:
        raise RuntimeError("invalid evidence digest")
    return value


def build_evidence_payload(
    key: str,
    passed: bool,
    commit: str,
    artifact_sha256: str,
    command: list[str],
    started_at: str,
    finished_at: str,
    raw_file: Path,
    machine_id: str,
    boot_id: str,
) -> EvidencePayload:
    start, finish = canonical_utc(started_at), canonical_utc(finished_at)
    if finish < start or re.fullmatch(r"[A-Za-z][A-Za-z0-9]*", key) is None or type(passed) is not bool:
        raise RuntimeError("invalid evidence identity or time range")
    if re.fullmatch(r"[0-9a-f]{40}", commit) is None or re.fullmatch(r"[0-9a-f]{64}", artifact_sha256) is None:
        raise RuntimeError("invalid release evidence")
    if not _is_regular_file(raw_file):
        raise RuntimeError("evidence raw output must be a regular file")
    argv = safe_command(command)
    return {
        "schema": "kb.phase1-evidence/v1",
        "key": key,
        "passed": passed,
        "release": {"commit": commit, "artifactSha256": artifact_sha256},
        "host": {
            "machineIdSha256": hashlib.sha256(machine_id.encode("utf-8")).hexdigest(),
            "bootId": require_uuid(boot_id),
        },
        "command": argv,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "rawOutput": {"file": raw_file.name, "sha256": sha256_file(raw_file)},
    }


def normalize_external_serve_endpoint(value: str) -> str:
    try:
        parsed = urlsplit(value)
        port = parsed.port or 443
    except (TypeError, ValueError) as error:
        raise RuntimeError("external Serve endpoint must identify one HTTPS host on port 443") from error
    if parsed.scheme.lower() != "https" or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise RuntimeError("external Serve endpoint must be HTTPS without credentials, query, or fragment")
    if parsed.path not in {"", "/"} or not parsed.hostname or port != 443:
        raise RuntimeError("external Serve endpoint must identify one HTTPS host on port 443")
    return f"https://{parsed.hostname.lower()}:443"


def normalize_base_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        scheme = parsed.scheme.lower()
        default_port = 443 if scheme == "https" else 80
        port = parsed.port if parsed.port is not None else default_port
    except (TypeError, ValueError) as error:
        raise RuntimeError("base URL must identify one HTTP(S) origin") from error
    if (
        scheme not in {"http", "https"} or parsed.username or parsed.password
        or parsed.query or parsed.fragment or parsed.path not in {"", "/"} or not parsed.hostname
    ):
        raise RuntimeError("base URL must identify one HTTP(S) origin")
    authority = parsed.hostname.lower()
    if port != default_port:
        authority += f":{port}"
    return f"{scheme}://{authority}"


def _serve_handler_proxies(config: dict, external_serve_endpoint: str) -> list[str] | None:
    services = config.get("Services", {})
    if not isinstance(services, dict):
        return None
    scopes = [config, *services.values()]
    proxies: list[str] = []
    for scope in scopes:
        if not isinstance(scope, dict):
            return None
        web = scope.get("Web", {})
        if not isinstance(web, dict):
            return None
        for authority, web_server in web.items():
            try:
                if normalize_external_serve_endpoint("https://" + authority) != external_serve_endpoint:
                    return None
            except (RuntimeError, TypeError, ValueError):
                return None
            handlers = web_server.get("Handlers", {}) if isinstance(web_server, dict) else {}
            if not isinstance(handlers, dict):
                return None
            for handler in handlers.values():
                proxy = handler.get("Proxy") if isinstance(handler, dict) else None
                if not isinstance(proxy, str):
                    return None
                proxies.append(proxy)
    return proxies


def _is_loopback_proxy(proxy: str) -> bool:
    try:
        parsed = urlsplit(proxy)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        return False
    if parsed.hostname.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        return False


def _funnel_entries(config: dict) -> list[str] | None:
    services = config.get("Services", {})
    if not isinstance(services, dict):
        return None
    scopes = [config, *services.values()]
    entries: list[str] = []
    for scope in scopes:
        if not isinstance(scope, dict):
            return None
        allowed = scope.get("AllowFunnel", {})
        if not isinstance(allowed, dict):
            return None
        entries.extend(allowed)
    return entries


def _probe_matches(probe: AclProbeResult, expected: str, outcomes: set[str]) -> bool:
    try:
        return normalize_external_serve_endpoint(probe.endpoint) == expected and probe.outcome in outcomes
    except (RuntimeError, TypeError, ValueError):
        return False


def derive_tailnet_evidence(
    serve_status_json: str,
    funnel_status_json: str,
    acl_probe_results: list[AclProbeResult],
    external_serve_endpoint: str,
) -> TailnetEvidence:
    try:
        serve, funnel = json.loads(serve_status_json), json.loads(funnel_status_json)
        expected = normalize_external_serve_endpoint(external_serve_endpoint)
        proxies = _serve_handler_proxies(serve, expected) if isinstance(serve, dict) else None
        serve_funnel_entries = _funnel_entries(serve) if isinstance(serve, dict) else None
        funnel_entries = _funnel_entries(funnel) if isinstance(funnel, dict) else None
    except (json.JSONDecodeError, AttributeError, KeyError, RuntimeError, TypeError, ValueError):
        return {"serveTailnetOnly": False, "funnelDisabled": False, "aclAuthorized": False, "aclDenied": False}
    authorized = [probe for probe in acl_probe_results if probe.role == "authorized"]
    denied = [probe for probe in acl_probe_results if probe.role == "denied"]
    return {
        "serveTailnetOnly": bool(proxies) and all(_is_loopback_proxy(proxy) for proxy in proxies),
        "funnelDisabled": serve_funnel_entries == [] and funnel_entries == [],
        "aclAuthorized": any(_probe_matches(probe, expected, {"reached"}) for probe in authorized),
        "aclDenied": any(_probe_matches(probe, expected, {"connection-refused", "timeout"}) for probe in denied),
    }


def route_inventory_covered(raw: bytes) -> bool:
    try:
        report = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    if type(report) is not dict or report.get("success") is not True:
        return False
    if report.get("numFailedTests") != 0 or report.get("numFailedTestSuites") != 0:
        return False
    total, passed = report.get("numTotalTests"), report.get("numPassedTests")
    if type(total) is not int or type(passed) is not int or total <= 0 or passed != total:
        return False
    results = report.get("testResults")
    if type(results) is not list:
        return False
    covered: set[str] = set()
    for result in results:
        if type(result) is not dict or type(result.get("name")) is not str or result.get("status") != "passed":
            return False
        normalized = result["name"].replace("\\", "/")
        for required in REQUIRED_ROUTE_TESTS:
            if normalized.endswith("/" + required) or normalized == required:
                covered.add(required)
    return covered == set(REQUIRED_ROUTE_TESTS)


def probe_http(
    url: str,
    authorization: str | None = None,
    read_body: bool = True,
    open_url=None,
) -> tuple[int, bytes]:
    headers = {} if authorization is None else {"Authorization": f"Bearer {authorization}"}
    request = urllib.request.Request(url, headers=headers, method="GET")
    opener = _NO_REDIRECT_OPENER.open if open_url is None else open_url
    try:
        with opener(request, timeout=HTTP_TIMEOUT) as response:
            body = response.read(1024 * 1024) if read_body else b""
            return response.status, body
    except urllib.error.HTTPError as error:
        try:
            body = error.read(1024 * 1024) if read_body else b""
            return error.code, body
        finally:
            error.close()
    except (OSError, urllib.error.URLError) as error:
        raise RuntimeError("Gate-1 HTTP probe failed") from error


def websocket_request_bytes(authority: str, path: str, authorization: str | None, key: str) -> bytes:
    fields = [authority, path, key]
    if any(type(value) is not str or re.search(r"[\x00-\x1f\x7f]", value) for value in fields):
        raise RuntimeError("unsafe WebSocket request field")
    if not path.startswith("/") or " " in authority:
        raise RuntimeError("unsafe WebSocket request target")
    if authorization is not None and (type(authorization) is not str or re.search(r"[\x00-\x1f\x7f]", authorization)):
        raise RuntimeError("unsafe WebSocket authorization value")
    rows = [
        f"GET {path} HTTP/1.1",
        f"Host: {authority}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
    ]
    if authorization is not None:
        rows.append(f"Authorization: Bearer {authorization}")
    return ("\r\n".join(rows) + "\r\n\r\n").encode("ascii")


def probe_websocket(url: str, authorization: str | None = None) -> int:
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"ws", "wss"} or not parsed.hostname or parsed.username or parsed.password:
            raise RuntimeError("WebSocket URL must identify one ws(s) endpoint")
        default_port = 443 if parsed.scheme == "wss" else 80
        port = parsed.port if parsed.port is not None else default_port
    except ValueError as error:
        raise RuntimeError("WebSocket URL must identify one ws(s) endpoint") from error
    authority = parsed.hostname if port == default_port else f"{parsed.hostname}:{port}"
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = websocket_request_bytes(authority, path, authorization, key)
    connection = None
    try:
        connection = socket.create_connection((parsed.hostname, port), timeout=HTTP_TIMEOUT)
        if parsed.scheme == "wss":
            connection = ssl.create_default_context().wrap_socket(connection, server_hostname=parsed.hostname)
        connection.settimeout(HTTP_TIMEOUT)
        connection.sendall(request)
        response = bytearray()
        while b"\r\n\r\n" not in response:
            chunk = connection.recv(4096)
            if not chunk:
                break
            response.extend(chunk)
            if len(response) > 64 * 1024:
                raise RuntimeError("WebSocket response headers are too large")
    except (OSError, ssl.SSLError) as error:
        raise RuntimeError("Gate-1 WebSocket probe failed") from error
    finally:
        if connection is not None:
            connection.close()
    match = re.match(rb"\AHTTP/1\.[01] ([0-9]{3})(?: |\r\n)", bytes(response))
    if match is None:
        raise RuntimeError("invalid WebSocket handshake response")
    return int(match.group(1))


def _run_tailscale_status(run, mode: str) -> str:
    argv = ["tailscale", mode, "status", "--json"]
    try:
        result = run(argv, capture_output=True, text=True, timeout=COMMAND_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f"tailscale {mode} status failed") from error
    stdout = getattr(result, "stdout", "")
    stderr = getattr(result, "stderr", "")
    if isinstance(stdout, bytes):
        stdout = _decode_utf8(stdout, f"tailscale {mode} stdout")
    if isinstance(stderr, bytes):
        stderr = _decode_utf8(stderr, f"tailscale {mode} stderr")
    if getattr(result, "returncode", None) != 0 or stderr != "" or type(stdout) is not str:
        raise RuntimeError(f"tailscale {mode} status failed")
    return stdout


def _acl_probe_results(authorized_raw: bytes, denied_raw: bytes, endpoint: str) -> list[AclProbeResult]:
    try:
        authorized = json.loads(authorized_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("authorized ACL probe must contain successful health JSON") from error
    if type(authorized) is not dict or authorized.get("ok") is not True:
        raise RuntimeError("authorized ACL probe did not reach health")
    denied = _decode_utf8(denied_raw, "denied ACL probe").lower()
    if "timed out" in denied or "timeout" in denied:
        outcome: Literal["connection-refused", "timeout"] = "timeout"
    elif any(item in denied for item in ("connection refused", "failed to connect", "couldn't connect", "could not connect")):
        outcome = "connection-refused"
    else:
        raise RuntimeError("denied ACL probe must show refusal or timeout")
    return [
        AclProbeResult(role="authorized", endpoint=endpoint, outcome="reached"),
        AclProbeResult(role="denied", endpoint=endpoint, outcome=outcome),
    ]


def write_package(output: Path, evidence: dict, raw: dict[str, str | bytes]) -> int:
    output.mkdir(parents=True, exist_ok=False)
    decision = decide(evidence)
    (output / "gate1.json").write_text(
        json.dumps({"gate": 1, "decision": decision, "evidence": evidence}, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8", newline="\n",
    )
    for name, value in raw.items():
        target = output / name
        if Path(name).name != name:
            raise RuntimeError("raw evidence filename must be package-local")
        if isinstance(value, bytes):
            target.write_bytes(value)
        else:
            target.write_text(value, encoding="utf-8", newline="")
    rows = [
        "# Phase I Gate 1", "", f"Decision: {'PASS' if decision['passed'] else 'FAIL'}",
        "", "## Failures", "",
    ] + [f"- {item}" for item in decision["failures"]]
    (output / "gate1.md").write_text("\n".join(rows) + "\n", encoding="utf-8", newline="\n")
    return 0 if decision["passed"] else 1


def write_gate1_envelope(
    output: Path,
    evidence: dict,
    release_commit: str,
    artifact_sha256: str,
    command: list[str],
    started_at: str,
    finished_at: str,
    machine_id: str,
    boot_id: str,
) -> Path:
    raw_file = output / "gate1.json"
    payload = build_evidence_payload(
        "gate1Boundary", decide(evidence)["passed"], release_commit, artifact_sha256,
        command, started_at, finished_at, raw_file, machine_id, boot_id,
    )
    target = output / "gate1Boundary.evidence.json"
    target.write_text(canonical_json(payload), encoding="utf-8", newline="\n")
    return target


def collect_package(
    *,
    base_url: str,
    external_serve_endpoint: str,
    output: Path,
    session_env: str,
    route_report: Path,
    acl_authorized: Path,
    acl_denied: Path,
    release_commit: str,
    artifact_sha256: str,
    command: list[str],
    run=subprocess.run,
    http_probe=probe_http,
    websocket_probe=probe_websocket,
    environ=os.environ,
    now=lambda: datetime.now(timezone.utc),
    machine_id_path: Path = Path("/etc/machine-id"),
    boot_id_path: Path = Path("/proc/sys/kernel/random/boot_id"),
) -> int:
    if session_env != "KB_GATE_SESSION":
        raise RuntimeError("Gate-1 session selector must be KB_GATE_SESSION")
    session = environ.get(session_env)
    if type(session) is not str or not session or re.search(r"[\x00-\x1f\x7f]", session):
        raise RuntimeError("Gate-1 ambient session is unavailable")
    command = safe_command(command)
    normalized_base = normalize_base_url(base_url)
    normalized_external = normalize_external_serve_endpoint(external_serve_endpoint)
    normalized_external_base = normalize_base_url(normalized_external)
    if output.exists():
        raise RuntimeError("Gate-1 output directory must not exist")
    started_at = _canonical_now(now)
    route_raw = _read_regular_bytes(route_report)
    authorized_raw = _read_regular_bytes(acl_authorized)
    denied_raw = _read_regular_bytes(acl_denied)
    serve_raw = _run_tailscale_status(run, "serve")
    funnel_raw = _run_tailscale_status(run, "funnel")
    acl_probes = _acl_probe_results(authorized_raw, denied_raw, normalized_external)
    tailnet = derive_tailnet_evidence(serve_raw, funnel_raw, acl_probes, normalized_external)

    health_status, _ = http_probe(normalized_base + "/healthz", authorization=None, read_body=True)
    ready_status, ready_raw = http_probe(normalized_base + "/readyz", authorization=None, read_body=True)
    unauthenticated = {
        path: http_probe(normalized_base + path, authorization=None, read_body=False)[0]
        for path in REQUIRED_UNAUTH
    }
    authenticated = {
        path: http_probe(normalized_base + path, authorization=session, read_body=False)[0]
        for path in REQUIRED_UNAUTH
    }
    confinement = {
        relpath: http_probe(
            normalized_base + "/api/kb/file?path=" + quote(relpath, safe=""),
            authorization=session, read_body=False,
        )[0]
        for relpath in CONFINEMENT_REFUSED
    }
    confinement[CONFINEMENT_ALLOWED] = http_probe(
        normalized_base + "/api/kb/tree?path=" + quote(CONFINEMENT_ALLOWED, safe=""),
        authorization=session, read_body=False,
    )[0]
    websocket_base = ("wss://" if normalized_base.startswith("https://") else "ws://") + normalized_base.split("//", 1)[1]
    websocket = {
        "unauthenticated": websocket_probe(websocket_base + "/ws", authorization=None),
        "authenticated": websocket_probe(websocket_base + "/ws", authorization=session),
    }
    try:
        readiness = json.loads(ready_raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        readiness = None
    execution_locked = (
        ready_status == 200 and type(readiness) is dict and readiness.get("ok") is True
        and readiness.get("quiescent") is True and readiness.get("blockers") == []
    )
    evidence = {
        "unauthenticatedReads": unauthenticated,
        "authenticatedReads": authenticated,
        "websocket": websocket,
        "health": {"/healthz": health_status, "/readyz": ready_status},
        "routeInventoryCovered": route_inventory_covered(route_raw),
        "confined": (
            normalized_base == normalized_external_base
            and all(confinement[relpath] == 403 for relpath in CONFINEMENT_REFUSED)
            and confinement[CONFINEMENT_ALLOWED] == 200
        ),
        "confinementProbe": confinement,
        **tailnet,
        "executionLocked": execution_locked,
    }
    try:
        result = write_package(output, evidence, {
            "tailscale-serve.json": serve_raw,
            "tailscale-funnel.json": funnel_raw,
            "route-matrix.json": route_raw,
            "acl-authorized.txt": authorized_raw,
            "acl-denied.txt": denied_raw,
            "readyz.json": ready_raw,
        })
        finished_at = _canonical_now(now)
        machine_id = _decode_utf8(_read_regular_bytes(machine_id_path), "machine id").strip()
        boot_id = _decode_utf8(_read_regular_bytes(boot_id_path), "boot id").strip()
        if not machine_id:
            raise RuntimeError("machine id is empty")
        write_gate1_envelope(
            output, evidence, release_commit, artifact_sha256, command,
            started_at, finished_at, machine_id, boot_id,
        )
        if {path.name for path in output.iterdir()} != UNSIGNED_GATE1_FILES:
            raise RuntimeError("unsigned Gate-1 package is incomplete")
        return result
    except BaseException:
        shutil.rmtree(output, ignore_errors=True)
        raise


def sign_evidence(report: Path, signing_key: Path, run=subprocess.run) -> Path:
    value = parse_closed_evidence(_read_regular_bytes(report), EVIDENCE_KEYS)
    signature = report.with_suffix(report.suffix + ".sig")
    signature.unlink(missing_ok=True)
    run(
        ["ssh-keygen", "-Y", "sign", "-f", str(signing_key), "-n", EVIDENCE_NAMESPACE, str(report)],
        check=True, timeout=COMMAND_TIMEOUT, stdin=subprocess.DEVNULL,
    )
    if not _is_regular_file(signature) or value["schema"] != "kb.phase1-evidence/v1":
        raise RuntimeError("evidence signing failed")
    return signature


def sign_file(path: Path, signing_key: Path, namespace: str, run=subprocess.run) -> Path:
    signature = path.with_suffix(path.suffix + ".sig")
    signature.unlink(missing_ok=True)
    run(
        ["ssh-keygen", "-Y", "sign", "-f", str(signing_key), "-n", namespace, str(path)],
        check=True, timeout=COMMAND_TIMEOUT, stdin=subprocess.DEVNULL,
    )
    if not _is_regular_file(signature):
        raise RuntimeError(f"{namespace} signature was not produced")
    return signature


def finalize_package(package: Path, approval: Path, signing_key: Path, run=subprocess.run) -> EvidenceInventoryV1:
    if not _is_real_directory(package):
        raise RuntimeError("unsigned Gate-1 package must be a directory")
    entries = list(package.iterdir())
    initial = {path.name for path in entries if _is_regular_file(path)}
    if initial != UNSIGNED_GATE1_FILES or any(not _is_regular_file(path) for path in entries):
        raise RuntimeError("unsigned Gate-1 package has extras, missing files, or non-regular entries")
    envelopes = sorted(package.glob("*.evidence.json"))
    if not envelopes:
        raise RuntimeError("Gate-1 package has no evidence envelopes")
    release = None
    for envelope in envelopes:
        value = parse_closed_evidence(_read_regular_bytes(envelope), EVIDENCE_KEYS)
        raw_path = package / value["rawOutput"]["file"]
        if raw_path.parent != package or not _is_regular_file(raw_path):
            raise RuntimeError("evidence raw file is not a regular package file")
        if sha256_file(raw_path) != value["rawOutput"]["sha256"]:
            raise RuntimeError("evidence raw digest mismatch")
        release = value["release"] if release is None else release
        if value["release"] != release:
            raise RuntimeError("evidence release identities differ")
        sign_evidence(envelope, signing_key, run=run)
    approval_text = _decode_utf8(_read_regular_bytes(approval), "approval")
    approval_text = approval_text.replace("\r\n", "\n").replace("\r", "\n")
    expected = re.fullmatch(
        r"APPROVED gate=1 release=([0-9a-f]{40}) by=Daniel at=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\n",
        approval_text,
    )
    if expected is None or expected.group(1) != release["commit"]:
        raise RuntimeError("approval does not bind Gate 1 and the release commit")
    canonical_utc(expected.group(2))
    approval_target = package / "APPROVED.txt"
    approval_target.write_text(approval_text, encoding="utf-8", newline="\n")
    sign_file(approval_target, signing_key, APPROVAL_NAMESPACE, run=run)
    entries = list(package.iterdir())
    if {path.name for path in entries if _is_regular_file(path)} != FINALIZED_GATE1_FILES or any(
        not _is_regular_file(path) for path in entries
    ):
        raise RuntimeError("Gate-1 package has unexpected finalized files or non-regular entries")
    rows: list[EvidenceInventoryRow] = []
    for path in sorted(package.iterdir(), key=lambda item: item.name):
        if path.name in FINAL_CONTROL_FILES:
            continue
        if not _is_regular_file(path):
            raise RuntimeError("Gate-1 package contains a non-regular entry")
        rows.append({"path": path.name, "sha256": sha256_file(path)})
    inventory: EvidenceInventoryV1 = {
        "schema": "kb.phase1-inventory/v1",
        "gate": 1,
        "release": release,
        "files": rows,
    }
    inventory_path = package / "evidence.inventory.json"
    inventory_path.write_text(canonical_json(inventory), encoding="utf-8", newline="\n")
    digest_path = package / "evidence.sha256"
    digest_path.write_text(
        f"{sha256_file(inventory_path)}  evidence.inventory.json\n", encoding="ascii", newline="\n",
    )
    sign_file(digest_path, signing_key, INVENTORY_NAMESPACE, run=run)
    return inventory


def _bytes(value: str | bytes | None) -> bytes:
    if value is None:
        return b""
    if isinstance(value, bytes):
        return value
    return value.encode("utf-8")


def verify_ssh_signature(
    path: Path,
    signature: Path,
    allowed_signers: Path,
    namespace: str,
    run=subprocess.run,
    *,
    raw: bytes | None = None,
) -> None:
    if re.fullmatch(r"[A-Za-z0-9._-]+", namespace) is None:
        raise RuntimeError("invalid signature namespace")
    signed_raw = _read_regular_bytes(path) if raw is None else raw
    if not _is_regular_file(signature) or not _is_regular_file(allowed_signers):
        raise RuntimeError(f"invalid {namespace} signature")
    try:
        result = run(
            [
                "ssh-keygen", "-Y", "verify", "-f", str(allowed_signers),
                "-I", SIGNING_PRINCIPAL, "-n", namespace, "-s", str(signature),
            ],
            input=signed_raw,
            capture_output=True,
            timeout=COMMAND_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f"invalid {namespace} signature") from error
    expected = re.compile(
        rb'\AGood "' + re.escape(namespace.encode("ascii")) + rb'" signature for '
        + re.escape(SIGNING_PRINCIPAL.encode("ascii"))
        + rb' with [A-Za-z0-9@._+-]+ key SHA256:[A-Za-z0-9+/=]+\r?\n?\Z'
    )
    stdout = _bytes(getattr(result, "stdout", None))
    stderr = _bytes(getattr(result, "stderr", None))
    if getattr(result, "returncode", None) != 0 or stderr or expected.fullmatch(stdout) is None:
        raise RuntimeError(f"invalid {namespace} signature")


def _parse_inventory(raw: bytes) -> EvidenceInventoryV1:
    inventory = load_json_without_duplicates(raw)
    if type(inventory) is not dict or set(inventory) != INVENTORY_KEYS or canonical_json(inventory).encode("utf-8") != raw:
        raise RuntimeError("closed canonical inventory required")
    if inventory["schema"] != "kb.phase1-inventory/v1" or inventory["gate"] != 1 or type(inventory["files"]) is not list:
        raise RuntimeError("unsupported Gate-1 inventory")
    if (
        type(inventory["release"]) is not dict or set(inventory["release"]) != RELEASE_KEYS
        or any(type(inventory["release"].get(key)) is not str for key in RELEASE_KEYS)
    ):
        raise RuntimeError("closed inventory release identity required")
    if re.fullmatch(r"[0-9a-f]{40}", inventory["release"]["commit"]) is None or re.fullmatch(
        r"[0-9a-f]{64}", inventory["release"]["artifactSha256"],
    ) is None:
        raise RuntimeError("closed inventory release identity required")
    return inventory


def verify_inventory(package: Path, allowed_signers: Path, run=subprocess.run) -> EvidenceInventoryV1:
    if not _is_real_directory(package):
        raise RuntimeError("Gate-1 package must be a directory")

    # The signed final digest is the trust anchor. Verify its raw bytes before
    # interpreting the digest or reading any inventory bytes.
    digest_path = package / "evidence.sha256"
    raw_digest = _read_regular_bytes(digest_path)
    verify_ssh_signature(
        digest_path, package / "evidence.sha256.sig", allowed_signers,
        INVENTORY_NAMESPACE, run=run, raw=raw_digest,
    )
    digest_match = re.fullmatch(rb"([0-9a-f]{64})  evidence\.inventory\.json\n", raw_digest)
    if digest_match is None:
        raise RuntimeError("final inventory digest is not one canonical line")

    # Only after the signed digest line is accepted may the inventory be read;
    # its raw digest is checked before its closed JSON is parsed.
    inventory_path = package / "evidence.inventory.json"
    raw_inventory = _read_regular_bytes(inventory_path)
    if not hmac.compare_digest(hashlib.sha256(raw_inventory).hexdigest().encode("ascii"), digest_match.group(1)):
        raise RuntimeError("final inventory digest mismatch")
    inventory = _parse_inventory(raw_inventory)

    listed: dict[str, str] = {}
    for row in inventory["files"]:
        if type(row) is not dict or set(row) != INVENTORY_ROW_KEYS or type(row["path"]) is not str or type(row["sha256"]) is not str:
            raise RuntimeError("closed inventory row required")
        if row["path"] in listed:
            raise RuntimeError("duplicate inventory path")
        if (
            Path(row["path"]).name != row["path"] or row["path"] in FINAL_CONTROL_FILES
            or re.fullmatch(r"[0-9a-f]{64}", row["sha256"]) is None
        ):
            raise RuntimeError("unsafe inventory row")
        listed[row["path"]] = row["sha256"]
    if list(listed) != sorted(listed):
        raise RuntimeError("inventory rows must be path-sorted")
    if set(listed) != FINALIZED_GATE1_FILES:
        raise RuntimeError("inventory is not the complete finalized Gate-1 file set")
    entries = list(package.iterdir())
    actual = {path.name for path in entries if _is_regular_file(path)}
    if actual != set(listed) | FINAL_CONTROL_FILES:
        raise RuntimeError("inventory has extras or missing files")
    if any(not _is_regular_file(path) for path in entries):
        raise RuntimeError("package contains a non-regular entry")
    for name, digest in listed.items():
        if not hmac.compare_digest(sha256_file(package / name), digest):
            raise RuntimeError(f"inventory digest mismatch: {name}")

    envelopes = sorted(package.glob("*.evidence.json"))
    if [path.name for path in envelopes] != ["gate1Boundary.evidence.json"]:
        raise RuntimeError("Gate-1 inventory must contain exactly the boundary envelope")
    for envelope in envelopes:
        raw_envelope = _read_regular_bytes(envelope)
        verify_ssh_signature(
            envelope, envelope.with_suffix(envelope.suffix + ".sig"), allowed_signers,
            EVIDENCE_NAMESPACE, run=run, raw=raw_envelope,
        )
        value = parse_closed_evidence(raw_envelope, EVIDENCE_KEYS)
        if value["release"] != inventory["release"]:
            raise RuntimeError("envelope release differs from inventory")
        raw_file = package / value["rawOutput"]["file"]
        if raw_file.parent != package or not _is_regular_file(raw_file):
            raise RuntimeError("envelope raw output is not a regular package file")
        if not hmac.compare_digest(sha256_file(raw_file), value["rawOutput"]["sha256"]):
            raise RuntimeError("envelope raw-output digest mismatch")
        raw_gate = _read_regular_bytes(package / value["rawOutput"]["file"])
        gate = load_json_without_duplicates(raw_gate)
        if type(gate) is not dict or type(gate.get("decision")) is not dict:
            raise RuntimeError("Gate-1 raw decision is unreadable")
        if gate["decision"].get("passed") is not value["passed"]:
            raise RuntimeError("envelope decision differs from the raw Gate-1 decision")

    approval_raw = _read_regular_bytes(package / "APPROVED.txt")
    approval_text = _decode_utf8(approval_raw, "approval")
    approval = re.fullmatch(
        r"APPROVED gate=1 release=([0-9a-f]{40}) by=Daniel at=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\n",
        approval_text,
    )
    if approval is None or approval.group(1) != inventory["release"]["commit"]:
        raise RuntimeError("approval does not bind the inventoried release")
    canonical_utc(approval.group(2))
    verify_ssh_signature(
        package / "APPROVED.txt", package / "APPROVED.txt.sig", allowed_signers,
        APPROVAL_NAMESPACE, run=run, raw=approval_raw,
    )
    return inventory


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="action", required=True)
    collect = subparsers.add_parser("collect")
    collect.add_argument("--base-url", required=True)
    collect.add_argument("--external-serve-endpoint", required=True)
    collect.add_argument("--output", type=Path, required=True)
    collect.add_argument("--session-env", required=True)
    collect.add_argument("--route-report", type=Path, required=True)
    collect.add_argument("--acl-authorized", type=Path, required=True)
    collect.add_argument("--acl-denied", type=Path, required=True)
    collect.add_argument("--release-commit", required=True)
    collect.add_argument("--artifact-sha256", required=True)
    finalize = subparsers.add_parser("finalize")
    finalize.add_argument("--package", type=Path, required=True)
    finalize.add_argument("--approval", type=Path, required=True)
    finalize.add_argument("--signing-key", type=Path, required=True)
    verify = subparsers.add_parser("verify")
    verify.add_argument("--package", type=Path, required=True)
    verify.add_argument("--allowed-signers", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    args = _parser().parse_args(raw_argv)
    if args.action == "collect":
        return collect_package(
            base_url=args.base_url,
            external_serve_endpoint=args.external_serve_endpoint,
            output=args.output,
            session_env=args.session_env,
            route_report=args.route_report,
            acl_authorized=args.acl_authorized,
            acl_denied=args.acl_denied,
            release_commit=args.release_commit,
            artifact_sha256=args.artifact_sha256,
            command=[sys.argv[0], *raw_argv],
        )
    if args.action == "finalize":
        finalize_package(args.package, args.approval, args.signing_key)
        return 0
    inventory = verify_inventory(args.package, args.allowed_signers)
    gate = load_json_without_duplicates(_read_regular_bytes(args.package / "gate1.json"))
    if type(gate) is not dict or type(gate.get("decision")) is not dict or type(gate["decision"].get("passed")) is not bool:
        raise RuntimeError("Gate-1 raw decision is unreadable")
    digest = _decode_utf8(_read_regular_bytes(args.package / "evidence.sha256"), "final inventory digest").split()[0]
    sys.stdout.write(canonical_json({
        "gate": 1, "verified": True, "passed": gate["decision"]["passed"],
        "release": inventory["release"], "finalInventoryDigest": digest,
    }))
    if not gate["decision"]["passed"]:
        sys.stderr.write("Gate-1 decision failed\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
