from __future__ import annotations

import hashlib
import json
import subprocess
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest

from scripts.gates import phase1_gate1 as gate1
from scripts.gates.phase1_gate1 import (
    AclProbeResult,
    REQUIRED_ROUTE_TESTS,
    REQUIRED_UNAUTH,
    build_evidence_payload,
    canonical_json,
    collect_package,
    decide,
    derive_tailnet_evidence,
    finalize_package,
    main,
    parse_closed_evidence,
    probe_http,
    route_inventory_covered,
    safe_command,
    sha256_file,
    verify_inventory,
    verify_ssh_signature,
    websocket_request_bytes,
)


PASSING_SERVE = json.dumps({
    "TCP": {"443": {"HTTPS": True}},
    "Web": {"kb.example.ts.net:443": {"Handlers": {
        "/": {"Proxy": "http://127.0.0.1:4317"},
    }}},
})
PASSING_FUNNEL = json.dumps({"AllowFunnel": {}})
ACL_PROBES = [
    AclProbeResult(role="authorized", endpoint="https://kb.example.ts.net:443", outcome="reached"),
    AclProbeResult(role="denied", endpoint="https://kb.example.ts.net:443", outcome="connection-refused"),
]
EXTERNAL_SERVE_ENDPOINT = "https://kb.example.ts.net:443"
COMMIT = "a" * 40
ARTIFACT = "b" * 64
STARTED = "2026-08-11T12:00:00.000Z"
FINISHED = "2026-08-11T12:01:00.000Z"
BOOT_ID = "11111111-1111-1111-1111-111111111111"


def completed(argv, stdout=b"", returncode=0, stderr=b""):
    return subprocess.CompletedProcess(argv, returncode, stdout=stdout, stderr=stderr)


def good_signature(namespace: str) -> bytes:
    return (
        f'Good "{namespace}" signature for kb-phase1 '
        "with ED25519 key SHA256:abcDEF012+/=\n"
    ).encode("ascii")


def signer(calls: list[list[str]]):
    def run(argv, **kwargs):
        calls.append(argv)
        source = Path(argv[-1])
        source.with_name(source.name + ".sig").write_bytes(b"signature")
        return completed(argv)

    return run


def verifier(calls=None, fail_namespace: str | None = None, *, stdout=None, stderr=b""):
    def run(argv, **kwargs):
        namespace = argv[argv.index("-n") + 1]
        if calls is not None:
            calls.append((argv, kwargs))
        failed = namespace == fail_namespace
        return completed(
            argv,
            stdout=(b"" if failed else good_signature(namespace)) if stdout is None else stdout,
            returncode=1 if failed else 0,
            stderr=stderr,
        )

    return run


def unsigned_gate1_fixture(tmp_path: Path):
    package = tmp_path / "gate1"
    package.mkdir()
    raw_files = {
        "gate1.json": b'{"decision":{"passed":true}}\n',
        "gate1.md": b"# Phase I Gate 1\n\nDecision: PASS\n",
        "tailscale-serve.json": PASSING_SERVE.encode(),
        "tailscale-funnel.json": PASSING_FUNNEL.encode(),
        "route-matrix.json": b'{"success":true}\n',
        "acl-authorized.txt": b'{"ok":true}\n',
        "acl-denied.txt": b"connection refused\n",
        "readyz.json": b'{"ok":true,"quiescent":true,"blockers":[]}',
    }
    for name, raw in raw_files.items():
        (package / name).write_bytes(raw)
    payload = build_evidence_payload(
        "gate1Boundary", True, COMMIT, ARTIFACT,
        ["phase1_gate1.py", "collect", "--session-env", "KB_GATE_SESSION"],
        STARTED, FINISHED, package / "gate1.json", "vm-1", BOOT_ID,
    )
    (package / "gate1Boundary.evidence.json").write_text(
        canonical_json(payload), encoding="utf-8", newline="\n",
    )
    approval = tmp_path / "approval.txt"
    approval.write_text(
        f"APPROVED gate=1 release={COMMIT} by=Daniel at={FINISHED}\n",
        encoding="ascii", newline="\n",
    )
    key = tmp_path / "key"
    key.write_bytes(b"not-read-by-the-test-signer")
    return package, approval, key


def finalized_gate1_fixture(tmp_path: Path):
    package, approval, key = unsigned_gate1_fixture(tmp_path)
    finalize_package(package, approval, key, run=signer([]))
    allowed = tmp_path / "allowed-signers"
    allowed.write_text("kb-phase1 ssh-ed25519 AAAA\n", encoding="ascii")
    return package, allowed


def rewrite_inventory_controls(package: Path, changed_name: str) -> None:
    inventory_path = package / "evidence.inventory.json"
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    for row in inventory["files"]:
        if row["path"] == changed_name:
            row["sha256"] = sha256_file(package / changed_name)
    inventory_path.write_text(canonical_json(inventory), encoding="utf-8", newline="\n")
    (package / "evidence.sha256").write_text(
        f"{sha256_file(inventory_path)}  evidence.inventory.json\n",
        encoding="ascii", newline="\n",
    )


def test_gate1_passes_only_with_auth_confinement_tailnet_and_locked_execution():
    evidence = {
        "unauthenticatedReads": {path: 401 for path in REQUIRED_UNAUTH},
        "authenticatedReads": {path: 200 for path in REQUIRED_UNAUTH},
        "websocket": {"unauthenticated": 401, "authenticated": 101},
        "health": {"/healthz": 200, "/readyz": 200},
        "routeInventoryCovered": True,
        "confined": True,
        "serveTailnetOnly": True,
        "funnelDisabled": True,
        "aclAuthorized": True,
        "aclDenied": True,
        "executionLocked": True,
    }
    assert decide(evidence) == {"passed": True, "failures": []}
    evidence["funnelDisabled"] = False
    assert decide(evidence)["passed"] is False


def test_derive_tailnet_evidence_accepts_loopback_serve_no_funnel_and_acl_probes():
    assert derive_tailnet_evidence(PASSING_SERVE, PASSING_FUNNEL, ACL_PROBES, EXTERNAL_SERVE_ENDPOINT) == {
        "serveTailnetOnly": True, "funnelDisabled": True,
        "aclAuthorized": True, "aclDenied": True,
    }


@pytest.mark.parametrize("serve, funnel, expected", [
    (json.dumps({"Web": {"kb.example.ts.net:443": {"Handlers": {"/": {"Proxy": "http://10.0.0.8:4317"}}}}}), PASSING_FUNNEL, {"serveTailnetOnly": False, "funnelDisabled": True}),
    (PASSING_SERVE, json.dumps({"AllowFunnel": {"kb.example.ts.net:443": True}}), {"serveTailnetOnly": True, "funnelDisabled": False}),
])
def test_derive_tailnet_evidence_rejects_non_loopback_proxy_or_public_funnel(serve, funnel, expected):
    evidence = derive_tailnet_evidence(serve, funnel, ACL_PROBES, EXTERNAL_SERVE_ENDPOINT)
    assert {key: evidence[key] for key in expected} == expected


def test_tailnet_evidence_binds_serve_and_acl_probes_to_the_exact_external_host():
    wrong_serve = PASSING_SERVE.replace("kb.example.ts.net:443", "other.example.ts.net:443")
    wrong_probes = [
        AclProbeResult(role="authorized", endpoint="https://other.example.ts.net:443", outcome="reached"),
        AclProbeResult(role="denied", endpoint="https://other.example.ts.net:443", outcome="timeout"),
    ]
    assert derive_tailnet_evidence(wrong_serve, PASSING_FUNNEL, wrong_probes, EXTERNAL_SERVE_ENDPOINT) == {
        "serveTailnetOnly": False, "funnelDisabled": True,
        "aclAuthorized": False, "aclDenied": False,
    }


def test_evidence_payload_binds_exact_schema_release_host_command_time_and_raw_digest(tmp_path):
    raw = tmp_path / "raw.txt"
    raw.write_bytes(b"ok\n")
    payload = build_evidence_payload(
        "workerDrain", True, COMMIT, ARTIFACT, ["npm", "test"],
        STARTED, FINISHED, raw, "vm-1", BOOT_ID,
    )
    assert payload["rawOutput"] == {"file": "raw.txt", "sha256": hashlib.sha256(b"ok\n").hexdigest()}
    assert payload["host"]["machineIdSha256"] == hashlib.sha256(b"vm-1").hexdigest()
    assert set(payload) == {"schema", "key", "passed", "release", "host", "command", "startedAt", "finishedAt", "rawOutput"}
    assert set(payload["release"]) == {"commit", "artifactSha256"}
    assert set(payload["host"]) == {"machineIdSha256", "bootId"}
    assert parse_closed_evidence(canonical_json(payload).encode()) == payload


@pytest.mark.parametrize("command", [
    [], ["curl", "--authorization=Bearer value"], ["TOKEN=value"],
    ["x", "Authorization: Bearer value"], ["-----BEGIN OPENSSH PRIVATE KEY-----"],
])
def test_safe_command_rejects_secret_bearing_or_empty_argv(command):
    with pytest.raises(RuntimeError):
        safe_command(command)


def test_safe_command_permits_only_the_session_environment_selector():
    assert safe_command(["collect", "--session-env", "KB_GATE_SESSION"]) == [
        "collect", "--session-env", "KB_GATE_SESSION",
    ]


def test_route_inventory_requires_every_named_vitest_file_and_all_tests_passed():
    report = {
        "success": True,
        "numFailedTests": 0, "numFailedTestSuites": 0,
        "numTotalTests": 5, "numPassedTests": 5,
        "testResults": [{"name": f"/release/dashboard/{name}", "status": "passed"} for name in REQUIRED_ROUTE_TESTS],
    }
    assert route_inventory_covered(json.dumps(report).encode()) is True
    report["testResults"][0]["status"] = "failed"
    assert route_inventory_covered(json.dumps(report).encode()) is False
    report["testResults"] = report["testResults"][1:]
    assert route_inventory_covered(json.dumps(report).encode()) is False
    report["testResults"] = [{"name": f"/release/dashboard/{name}", "status": "passed"} for name in REQUIRED_ROUTE_TESTS]
    report["numTotalTests"] = report["numPassedTests"] = 0
    assert route_inventory_covered(json.dumps(report).encode()) is False


def test_http_probe_keeps_health_request_headerless_and_adds_bearer_only_when_requested():
    captured = []

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def read(self, _limit):
            return b'{"ok":true}'

    def open_url(request, timeout):
        captured.append((request, timeout))
        return Response()

    assert probe_http("http://127.0.0.1:4317/readyz", open_url=open_url) == (200, b'{"ok":true}')
    assert dict(captured[-1][0].header_items()) == {}
    probe_http("https://kb.example.ts.net/api/kb/tree", authorization="session-value", read_body=False, open_url=open_url)
    assert dict(captured[-1][0].header_items()) == {"Authorization": "Bearer session-value"}


def test_default_opener_does_not_follow_redirects_or_forward_the_bearer():
    received: list[dict[str, str]] = []

    class Sink(BaseHTTPRequestHandler):
        def do_GET(self):
            received.append({key.lower(): value for key, value in self.headers.items()})
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *_):
            return

    sink = HTTPServer(("127.0.0.1", 0), Sink)
    threading.Thread(target=sink.serve_forever, daemon=True).start()

    class Redirector(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", f"http://localhost:{sink.server_address[1]}/stolen")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *_):
            return

    front = HTTPServer(("127.0.0.1", 0), Redirector)
    threading.Thread(target=front.serve_forever, daemon=True).start()
    try:
        assert probe_http(
            f"http://127.0.0.1:{front.server_address[1]}/api/kb/tree",
            authorization="session-value", read_body=False,
        ) == (302, b"")
        assert received == []
    finally:
        front.shutdown()
        sink.shutdown()


def test_default_opener_ignores_ambient_proxy_configuration():
    assert gate1._NO_PROXY_HANDLER.proxies == {}


def test_websocket_probe_bytes_have_no_browser_headers_or_credential_until_authenticated():
    plain = websocket_request_bytes("kb.example.ts.net:443", "/ws", None, "fixed-key")
    assert plain == (
        b"GET /ws HTTP/1.1\r\nHost: kb.example.ts.net:443\r\nUpgrade: websocket\r\n"
        b"Connection: Upgrade\r\nSec-WebSocket-Key: fixed-key\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    authenticated = websocket_request_bytes("kb.example.ts.net:443", "/ws", "session-value", "fixed-key")
    assert b"Origin:" not in authenticated
    assert authenticated.endswith(b"Authorization: Bearer session-value\r\n\r\n")


def test_finalize_signs_envelopes_approval_and_final_inventory_digest(tmp_path):
    package, approval, key = unsigned_gate1_fixture(tmp_path)
    calls = []
    inventory = finalize_package(package, approval, key, run=signer(calls))
    namespaces = [argv[argv.index("-n") + 1] for argv in calls]
    assert namespaces.count("kb-phase1-evidence") == len(list(package.glob("*.evidence.json")))
    assert namespaces[-2:] == ["kb-phase1-approval", "kb-phase1-inventory"]
    assert set(inventory) == {"schema", "gate", "release", "files"}
    assert set(inventory["release"]) == {"commit", "artifactSha256"}
    assert all(set(row) == {"path", "sha256"} for row in inventory["files"])
    assert (package / "evidence.sha256.sig").is_file()


def test_finalize_signing_is_bounded_and_cannot_prompt_on_stdin(tmp_path):
    package, approval, key = unsigned_gate1_fixture(tmp_path)
    calls = []

    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        Path(argv[-1] + ".sig").write_bytes(b"signature")
        return completed(argv)

    finalize_package(package, approval, key, run=run)
    assert all(call[1]["timeout"] == 30 for call in calls)
    assert all(call[1]["stdin"] is subprocess.DEVNULL for call in calls)


def test_desktop_reparse_entries_are_not_accepted_as_regular_files(tmp_path, monkeypatch):
    entry = tmp_path / "entry"
    entry.write_text("data\n", encoding="utf-8")
    original = entry.lstat()
    monkeypatch.setattr(
        Path, "lstat", lambda _self: SimpleNamespace(st_file_attributes=0x400, st_mode=original.st_mode),
    )
    assert gate1._is_regular_file(entry) is False


def test_finalize_accepts_desktop_crlf_approval_and_stores_canonical_lf(tmp_path):
    package, approval, key = unsigned_gate1_fixture(tmp_path)
    approval.write_bytes(
        f"APPROVED gate=1 release={COMMIT} by=Daniel at={FINISHED}\r\n".encode("ascii")
    )
    finalize_package(package, approval, key, run=signer([]))
    assert (package / "APPROVED.txt").read_bytes() == (
        f"APPROVED gate=1 release={COMMIT} by=Daniel at={FINISHED}\n".encode("ascii")
    )


def test_verify_inventory_recomputes_complete_set_and_rejects_extras_or_duplicates(tmp_path):
    package, allowed = finalized_gate1_fixture(tmp_path)
    assert verify_inventory(package, allowed, run=verifier()).get("schema") == "kb.phase1-inventory/v1"
    (package / "unlisted.txt").write_text("extra\n", encoding="utf-8")
    with pytest.raises(RuntimeError, match="extras or missing"):
        verify_inventory(package, allowed, run=verifier())
    (package / "unlisted.txt").unlink()
    inventory_path = package / "evidence.inventory.json"
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    inventory["files"].append(inventory["files"][0])
    inventory_path.write_text(canonical_json(inventory), encoding="utf-8", newline="\n")
    (package / "evidence.sha256").write_text(
        f"{sha256_file(inventory_path)}  evidence.inventory.json\n", encoding="ascii", newline="\n",
    )
    with pytest.raises(RuntimeError, match="duplicate inventory path"):
        verify_inventory(package, allowed, run=verifier())


def test_verify_inventory_requires_the_complete_finalized_file_set(tmp_path):
    package, allowed = finalized_gate1_fixture(tmp_path)
    (package / "tailscale-serve.json").unlink()
    inventory_path = package / "evidence.inventory.json"
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    inventory["files"] = [row for row in inventory["files"] if row["path"] != "tailscale-serve.json"]
    inventory_path.write_text(canonical_json(inventory), encoding="utf-8", newline="\n")
    (package / "evidence.sha256").write_text(
        f"{sha256_file(inventory_path)}  evidence.inventory.json\n", encoding="ascii", newline="\n",
    )
    with pytest.raises(RuntimeError, match="complete finalized Gate-1 file set"):
        verify_inventory(package, allowed, run=verifier())


def test_verify_cli_reports_a_signed_fail_decision_and_a_passing_summary(tmp_path, monkeypatch, capsys):
    package, allowed = finalized_gate1_fixture(tmp_path)
    monkeypatch.setattr(gate1, "verify_ssh_signature", lambda *_args, **_kwargs: None)
    assert main(["verify", "--package", str(package), "--allowed-signers", str(allowed)]) == 0
    assert json.loads(capsys.readouterr().out)["passed"] is True

    gate_path = package / "gate1.json"
    gate = json.loads(gate_path.read_text(encoding="utf-8"))
    gate["decision"] = {"passed": False, "failures": ["confined"]}
    gate_path.write_text(json.dumps(gate, indent=2) + "\n", encoding="utf-8", newline="\n")
    envelope_path = package / "gate1Boundary.evidence.json"
    envelope = json.loads(envelope_path.read_text(encoding="utf-8"))
    envelope["passed"] = False
    envelope["rawOutput"]["sha256"] = sha256_file(gate_path)
    envelope_path.write_text(canonical_json(envelope), encoding="utf-8", newline="\n")
    inventory_path = package / "evidence.inventory.json"
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    for row in inventory["files"]:
        row["sha256"] = sha256_file(package / row["path"])
    inventory_path.write_text(canonical_json(inventory), encoding="utf-8", newline="\n")
    (package / "evidence.sha256").write_text(
        f"{sha256_file(inventory_path)}  evidence.inventory.json\n", encoding="ascii", newline="\n",
    )
    assert main(["verify", "--package", str(package), "--allowed-signers", str(allowed)]) == 1
    captured = capsys.readouterr()
    assert json.loads(captured.out)["passed"] is False
    assert "Gate-1 decision failed" in captured.err


@pytest.mark.parametrize("namespace", ["kb-phase1-evidence", "kb-phase1-approval", "kb-phase1-inventory"])
def test_verify_inventory_rejects_each_invalid_signature_class(tmp_path, namespace):
    package, allowed = finalized_gate1_fixture(tmp_path)
    with pytest.raises(RuntimeError, match="invalid"):
        verify_inventory(package, allowed, run=verifier(fail_namespace=namespace))


def test_verify_inventory_checks_final_digest_signature_before_digest_or_inventory_parse(tmp_path):
    package, allowed = finalized_gate1_fixture(tmp_path)
    raw = b"not a digest\n"
    (package / "evidence.sha256").write_bytes(raw)
    (package / "evidence.inventory.json").write_bytes(b"not json\n")
    calls = []
    with pytest.raises(RuntimeError, match="invalid kb-phase1-inventory signature"):
        verify_inventory(package, allowed, run=verifier(calls, fail_namespace="kb-phase1-inventory"))
    assert calls[0][0][calls[0][0].index("-n") + 1] == "kb-phase1-inventory"
    assert calls[0][1]["input"] == raw


def test_verify_inventory_checks_envelope_signature_before_closed_json_parse(tmp_path):
    package, allowed = finalized_gate1_fixture(tmp_path)
    envelope = package / "gate1Boundary.evidence.json"
    raw = b"not json\n"
    envelope.write_bytes(raw)
    rewrite_inventory_controls(package, envelope.name)
    calls = []
    with pytest.raises(RuntimeError, match="invalid kb-phase1-evidence signature"):
        verify_inventory(package, allowed, run=verifier(calls, fail_namespace="kb-phase1-evidence"))
    evidence_call = next(call for call in calls if call[0][call[0].index("-n") + 1] == "kb-phase1-evidence")
    assert evidence_call[1]["input"] == raw


@pytest.mark.parametrize("stdout,stderr", [
    (b"", b""),
    (b'Good "wrong" signature for kb-phase1 with ED25519 key SHA256:abc\n', b""),
    (b'prefix Good "kb-phase1-evidence" signature for kb-phase1 with ED25519 key SHA256:abc\n', b""),
    (good_signature("kb-phase1-evidence"), b"warning\n"),
])
def test_verify_ssh_signature_requires_anchored_namespace_principal_token_and_empty_stderr(tmp_path, stdout, stderr):
    source = tmp_path / "evidence.json"
    signature = tmp_path / "evidence.json.sig"
    allowed = tmp_path / "allowed-signers"
    source.write_bytes(b"raw signed bytes\n")
    signature.write_bytes(b"sig")
    allowed.write_bytes(b"allowed")
    calls = []
    with pytest.raises(RuntimeError, match="invalid kb-phase1-evidence signature"):
        verify_ssh_signature(
            source, signature, allowed, "kb-phase1-evidence",
            run=verifier(calls, stdout=stdout, stderr=stderr),
        )
    assert calls[0][1]["input"] == b"raw signed bytes\n"
    assert calls[0][1]["timeout"] == 30
    assert calls[0][0][5:9] == ["-I", "kb-phase1", "-n", "kb-phase1-evidence"]


def test_collect_writes_exact_unsigned_package_without_session_or_tailscale_mutation(tmp_path):
    route_report = tmp_path / "vitest.json"
    route_report.write_text(json.dumps({
        "success": True, "numFailedTests": 0, "numFailedTestSuites": 0,
        "numTotalTests": 5, "numPassedTests": 5,
        "testResults": [{"name": f"/release/dashboard/{name}", "status": "passed"} for name in REQUIRED_ROUTE_TESTS],
    }), encoding="utf-8")
    authorized = tmp_path / "authorized.txt"
    authorized.write_text('{"ok":true}\n', encoding="utf-8")
    denied = tmp_path / "denied.txt"
    denied.write_text("curl: (7) Failed to connect: Connection refused\n", encoding="utf-8")
    machine = tmp_path / "machine-id"
    machine.write_text("vm-1\n", encoding="ascii")
    boot = tmp_path / "boot-id"
    boot.write_text(BOOT_ID + "\n", encoding="ascii")
    output = tmp_path / "package"
    run_calls = []

    def run(argv, **kwargs):
        run_calls.append((argv, kwargs))
        raw = PASSING_SERVE if argv[1] == "serve" else PASSING_FUNNEL
        return completed(argv, stdout=raw, stderr="")

    probe_calls = []

    def http(url, authorization=None, read_body=False):
        probe_calls.append((url, authorization, read_body))
        path = urlsplit(url).path
        if path == "/healthz":
            return 200, b'{"ok":true}'
        if path == "/readyz":
            return 200, b'{"ok":true,"quiescent":true,"blockers":[]}'
        if path == "/api/kb/file":
            return 403, b""
        if path == "/api/kb/tree" and urlsplit(url).query == "path=docs":
            return 200, b""
        return (401, b"") if authorization is None else (200, b"")

    ws_calls = []

    def websocket(url, authorization=None):
        ws_calls.append((url, authorization))
        return 401 if authorization is None else 101

    command = ["phase1_gate1.py", "collect", "--session-env", "KB_GATE_SESSION"]
    result = collect_package(
        base_url="https://kb.example.ts.net:443",
        external_serve_endpoint=EXTERNAL_SERVE_ENDPOINT,
        output=output,
        session_env="KB_GATE_SESSION",
        route_report=route_report,
        acl_authorized=authorized,
        acl_denied=denied,
        release_commit=COMMIT,
        artifact_sha256=ARTIFACT,
        command=command,
        run=run,
        http_probe=http,
        websocket_probe=websocket,
        environ={"KB_GATE_SESSION": "ambient-session-value"},
        now=lambda: datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc),
        machine_id_path=machine,
        boot_id_path=boot,
    )
    assert result == 0
    assert {path.name for path in output.iterdir()} == {
        "gate1.json", "gate1.md", "tailscale-serve.json", "tailscale-funnel.json",
        "route-matrix.json", "acl-authorized.txt", "acl-denied.txt", "readyz.json",
        "gate1Boundary.evidence.json",
    }
    assert [call[0] for call in run_calls] == [
        ["tailscale", "serve", "status", "--json"],
        ["tailscale", "funnel", "status", "--json"],
    ]
    assert all(call[1]["timeout"] == 30 for call in run_calls)
    assert all(call[1]["capture_output"] is True and call[1]["text"] is True for call in run_calls)
    assert probe_calls[0] == ("https://kb.example.ts.net:443/healthz", None, True)
    assert probe_calls[1] == ("https://kb.example.ts.net:443/readyz", None, True)
    assert ws_calls == [
        ("wss://kb.example.ts.net:443/ws", None),
        ("wss://kb.example.ts.net:443/ws", "ambient-session-value"),
    ]
    package_bytes = b"".join(path.read_bytes() for path in output.iterdir())
    assert b"ambient-session-value" not in package_bytes
    envelope = parse_closed_evidence((output / "gate1Boundary.evidence.json").read_bytes())
    assert envelope["command"] == command
    assert envelope["release"] == {"commit": COMMIT, "artifactSha256": ARTIFACT}
    assert json.loads((output / "gate1.json").read_text(encoding="utf-8"))["decision"]["passed"] is True


def test_confinement_requires_live_refusal_of_non_data_paths(tmp_path):
    route_report = tmp_path / "vitest.json"
    route_report.write_text(json.dumps({
        "success": True, "numFailedTests": 0, "numFailedTestSuites": 0,
        "numTotalTests": 5, "numPassedTests": 5,
        "testResults": [{"name": f"/release/dashboard/{name}", "status": "passed"} for name in REQUIRED_ROUTE_TESTS],
    }), encoding="utf-8")
    authorized, denied = tmp_path / "authorized.txt", tmp_path / "denied.txt"
    authorized.write_text('{"ok":true}\n', encoding="utf-8")
    denied.write_text("connection refused\n", encoding="utf-8")
    machine, boot = tmp_path / "machine-id", tmp_path / "boot-id"
    machine.write_text("vm-1\n", encoding="ascii")
    boot.write_text(BOOT_ID + "\n", encoding="ascii")

    def run(argv, **kwargs):
        return completed(argv, stdout=PASSING_SERVE if argv[1] == "serve" else PASSING_FUNNEL, stderr="")

    def http(url, authorization=None, read_body=False):
        parsed = urlsplit(url)
        if parsed.path == "/healthz":
            return 200, b'{"ok":true}'
        if parsed.path == "/readyz":
            return 200, b'{"ok":true,"quiescent":true,"blockers":[]}'
        if parsed.path == "/api/kb/file" and parsed.query == "path=CLAUDE.md":
            return 200, b""
        if parsed.path == "/api/kb/file":
            return 403, b""
        if parsed.path == "/api/kb/tree" and parsed.query == "path=docs":
            return 200, b""
        return (401, b"") if authorization is None else (200, b"")

    output = tmp_path / "package"
    assert collect_package(
        base_url=EXTERNAL_SERVE_ENDPOINT, external_serve_endpoint=EXTERNAL_SERVE_ENDPOINT,
        output=output, session_env="KB_GATE_SESSION", route_report=route_report,
        acl_authorized=authorized, acl_denied=denied, release_commit=COMMIT,
        artifact_sha256=ARTIFACT, command=["phase1_gate1.py", "collect", "--session-env", "KB_GATE_SESSION"],
        run=run, http_probe=http, websocket_probe=lambda _url, authorization=None: 101 if authorization else 401,
        environ={"KB_GATE_SESSION": "ambient-session-value"}, now=lambda: datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc),
        machine_id_path=machine, boot_id_path=boot,
    ) == 1
    gate = json.loads((output / "gate1.json").read_text(encoding="utf-8"))
    assert gate["evidence"]["confined"] is False
    assert gate["evidence"]["confinementProbe"]["CLAUDE.md"] == 200


def test_late_collection_failure_removes_the_package_for_a_retry(tmp_path):
    route_report = tmp_path / "vitest.json"
    route_report.write_text(json.dumps({
        "success": True, "numFailedTests": 0, "numFailedTestSuites": 0,
        "numTotalTests": 5, "numPassedTests": 5,
        "testResults": [{"name": f"/release/dashboard/{name}", "status": "passed"} for name in REQUIRED_ROUTE_TESTS],
    }), encoding="utf-8")
    authorized, denied = tmp_path / "authorized.txt", tmp_path / "denied.txt"
    authorized.write_text('{"ok":true}\n', encoding="utf-8")
    denied.write_text("connection refused\n", encoding="utf-8")
    machine, boot = tmp_path / "machine-id", tmp_path / "boot-id"
    machine.write_text("\n", encoding="ascii")
    boot.write_text(BOOT_ID + "\n", encoding="ascii")

    def run(argv, **kwargs):
        return completed(argv, stdout=PASSING_SERVE if argv[1] == "serve" else PASSING_FUNNEL, stderr="")

    def http(url, authorization=None, read_body=False):
        parsed = urlsplit(url)
        if parsed.path == "/healthz":
            return 200, b'{"ok":true}'
        if parsed.path == "/readyz":
            return 200, b'{"ok":true,"quiescent":true,"blockers":[]}'
        if parsed.path == "/api/kb/file":
            return 403, b""
        if parsed.path == "/api/kb/tree" and parsed.query == "path=docs":
            return 200, b""
        return (401, b"") if authorization is None else (200, b"")

    output = tmp_path / "package"
    kwargs = {
        "base_url": EXTERNAL_SERVE_ENDPOINT, "external_serve_endpoint": EXTERNAL_SERVE_ENDPOINT,
        "output": output, "session_env": "KB_GATE_SESSION", "route_report": route_report,
        "acl_authorized": authorized, "acl_denied": denied, "release_commit": COMMIT,
        "artifact_sha256": ARTIFACT, "command": ["phase1_gate1.py", "collect", "--session-env", "KB_GATE_SESSION"],
        "run": run, "http_probe": http,
        "websocket_probe": lambda _url, authorization=None: 101 if authorization else 401,
        "environ": {"KB_GATE_SESSION": "ambient-session-value"},
        "now": lambda: datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc),
        "machine_id_path": machine, "boot_id_path": boot,
    }
    with pytest.raises(RuntimeError, match="machine id is empty"):
        collect_package(**kwargs)
    assert not output.exists()
    machine.write_text("vm-1\n", encoding="ascii")
    assert collect_package(**kwargs) == 0


@pytest.mark.parametrize("serve, expected", [
    ("{}", False),
    (json.dumps({"TCP": {"443": {"HTTPS": True}}}), False),
    (json.dumps({"Web": {"kb.example.ts.net:443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:4317"}}}}, "Services": {"svc:a": {"TCP": {"443": {"HTTPS": True}}}}}), True),
])
def test_derive_tailnet_evidence_handles_serve_shapes_without_web(serve, expected):
    assert derive_tailnet_evidence(serve, PASSING_FUNNEL, ACL_PROBES, EXTERNAL_SERVE_ENDPOINT)["serveTailnetOnly"] is expected
