"""Sole fail-closed phase gate for prospecting phases."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import errno
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import pytest

from . import install_no_network_guard
from .pii_guard import assert_vm_safe, find_text_classes

PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE.parents[1]
MANIFEST_PATH = PACKAGE / "gate_manifest.json"
RESULTS_DIRECTORY = "orgs/prospecting/gate-results"
MANIFEST_ARTIFACT = "scripts/prospecting/gate_manifest.json"
BUILTIN_CRITERIA = frozenset({
    "minimum_enumerated_tests", "failures", "skips", "xfails", "warnings",
    "external_network_calls", "child_processes_without_guard", "inspector_minimum",
})


@dataclass(frozen=True)
class GateRun:
    nodeids: tuple[str, ...]
    passed: int
    failed: int
    skipped: int
    xfailed: int
    warnings: int
    external_network_calls: int
    child_processes_without_guard: int
    measurements: Mapping[str, int]
    failed_nodes: tuple[str, ...] = ()


class GatePlugin:
    def __init__(self) -> None:
        self.nodeids: tuple[str, ...] = ()
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.xfailed = 0
        self.warnings = 0
        self.measurements: dict[str, int] = {}
        self.failed_nodes: list[str] = []

    def pytest_collection_finish(self, session: pytest.Session) -> None:
        self.nodeids = tuple(item.nodeid.replace("\\", "/") for item in session.items)

    def pytest_runtest_logreport(self, report: pytest.TestReport) -> None:
        if report.when == "call":
            if getattr(report, "wasxfail", False):
                self.xfailed += 1
            elif report.skipped:
                self.skipped += 1
            elif report.failed:
                self.failed += 1
                self.failed_nodes.append(f"{report.nodeid}[{report.when}]: {str(report.longrepr)[-300:]}")
            elif report.passed:
                self.passed += 1
            for name, value in getattr(report, "user_properties", ()):
                if isinstance(value, int):
                    self.measurements[name] = self.measurements.get(name, 0) + value
        elif report.when in {"setup", "teardown"} and report.failed:
            self.failed += 1
            self.failed_nodes.append(f"{report.nodeid}[{report.when}]: {str(report.longrepr)[-300:]}")

    def pytest_warning_recorded(self, warning_message: object, when: str, nodeid: str, location: object) -> None:
        self.warnings += 1


def manifest_path(root: Path, phase: str) -> Path:
    suffix = "" if phase == "P1" else f"_p{phase[1:]}"
    return root / "scripts" / "prospecting" / f"gate_manifest{suffix}.json"


def load_manifest(path: Path = MANIFEST_PATH) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def manifest_artifact(root: Path, path: Path) -> str:
    return str(path.relative_to(root)).replace("\\", "/")


def validate_manifest(manifest: Mapping[str, object], phase: str | None = None,
                      root: Path = ROOT, path: Path = MANIFEST_PATH) -> tuple[str, ...]:
    errors: list[str] = []
    if set(manifest) != {"phase", "artifacts", "artifact_hashes", "fixtures", "tests", "criteria"}:
        errors.append("manifest keys differ from contract")
    expected_phase = phase or str(manifest.get("phase", ""))
    if not re.fullmatch(r"P[1-9][0-9]*", expected_phase) or manifest.get("phase") != expected_phase:
        errors.append("manifest phase does not match requested phase")
    criteria = manifest.get("criteria")
    if not isinstance(criteria, Mapping):
        errors.append("manifest criteria must be a mapping")
        criteria = {}
    missing_builtins = BUILTIN_CRITERIA - set(criteria)
    if missing_builtins:
        errors.append("manifest criteria missing built-ins: " + ",".join(sorted(missing_builtins)))
    if any(not isinstance(value, int) for value in criteria.values()):
        errors.append("manifest criteria values must be integers")
    minimum = criteria.get("minimum_enumerated_tests")
    tests = tuple(manifest.get("tests", ()))
    if not isinstance(minimum, int) or minimum < 1:
        errors.append("minimum_enumerated_tests must be positive")
    elif len(tests) < minimum or len(set(tests)) != len(tests):
        errors.append("manifest must enumerate at least the minimum unique test functions")
    if any(not isinstance(value, str) for value in tests):
        errors.append("manifest tests must be strings")
    if any(re.search(r"\d{7,}|[+]\d", str(node)) for node in tests):
        errors.append("manifest_ids_clean failed: node ids contain PII-like literals")
    artifacts = tuple(manifest.get("artifacts", ()))
    if not artifacts or any(not isinstance(value, str) for value in artifacts) or len(set(artifacts)) != len(artifacts):
        errors.append("manifest artifacts must be unique non-empty strings")
    hashes = manifest.get("artifact_hashes")
    expected_hash_paths = set(artifacts) - {manifest_artifact(root, path)}
    if not isinstance(hashes, Mapping) or set(hashes) != expected_hash_paths:
        errors.append("manifest artifact hashes differ from required artifacts")
    elif any(not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None
             for value in hashes.values()):
        errors.append("manifest artifact hashes must be sha256 hex strings")
    fixtures = tuple(manifest.get("fixtures", ()))
    if any(not isinstance(value, str) for value in fixtures) or len(set(fixtures)) != len(fixtures):
        errors.append("manifest fixtures must be unique strings")
    return tuple(errors)


def validate_files(root: Path, manifest: Mapping[str, object]) -> tuple[str, ...]:
    errors: list[str] = []
    artifacts = tuple(str(item) for item in manifest["artifacts"])
    missing = tuple(path for path in artifacts if not (root / path).is_file())
    if missing:
        errors.append("missing artifact: " + ",".join(missing))
    fixture_root = root / "orgs" / "prospecting" / "fixtures"
    missing_fixtures = tuple(name for name in manifest["fixtures"] if not (fixture_root / str(name)).is_file())
    if missing_fixtures:
        errors.append("missing fixture: " + ",".join(str(name) for name in missing_fixtures))
    for nodeid in manifest["tests"]:
        node = str(nodeid)
        if "::" not in node:
            errors.append(f"manifest test does not exist: {node}")
            continue
        relative, function = node.split("::", 1)
        source_path = root / relative
        if not source_path.is_file():
            errors.append(f"manifest test does not exist: {node}")
            continue
        source = source_path.read_text(encoding="utf-8")
        function_name = function.split("[", 1)[0]
        if f"def {function_name}(" not in source:
            errors.append(f"manifest test does not exist: {node}")
    state = root / "orgs" / "prospecting" / "STATE.md"
    if state.is_file():
        if find_text_classes(state.read_text(encoding="utf-8")):
            errors.append("work-tree STATE.md DRAFT fails PII guard")
    return tuple(errors)


def normalized_lf_bytes(path: Path) -> bytes:
    return path.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def compute_artifact_hashes(root: Path, artifacts: tuple[str, ...],
                            manifest_file: str = MANIFEST_ARTIFACT) -> tuple[dict[str, str], tuple[str, ...]]:
    hashes: dict[str, str] = {}
    missing: list[str] = []
    for artifact in artifacts:
        if artifact == manifest_file:
            continue
        path = root / artifact
        if not path.is_file():
            missing.append(artifact)
            continue
        hashes[artifact] = hashlib.sha256(normalized_lf_bytes(path)).hexdigest()
    return hashes, tuple(missing)


def validate_artifact_tracking(root: Path, artifacts: tuple[str, ...]) -> tuple[str, ...]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--", *artifacts],
        cwd=root, capture_output=True, check=True,
    )
    tracked = {item.decode("utf-8", "strict").replace("\\", "/")
               for item in result.stdout.split(b"\0") if item}
    missing = tuple(path for path in artifacts if path not in tracked)
    return () if not missing else ("untracked artifact: " + ",".join(missing),)


def changed_paths(root: Path) -> tuple[str, ...]:
    result = subprocess.run(
        ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        cwd=root, capture_output=True, check=True,
    )
    fields = [item.decode("utf-8", "strict") for item in result.stdout.split(b"\0") if item]
    paths: list[str] = []
    index = 0
    while index < len(fields):
        entry = fields[index]
        status, path = entry[:2], entry[3:]
        paths.append(path.replace("\\", "/"))
        if "R" in status or "C" in status:
            index += 1
            paths.append(fields[index].replace("\\", "/"))
        index += 1
    return tuple(paths)


def committed_phase_paths(root: Path) -> tuple[str, ...]:
    result = subprocess.run(
        ["git", "ls-files", "--", ".githooks/pre-commit", "orgs/prospecting", "scripts/prospecting"],
        cwd=root, capture_output=True, text=True, check=True,
    )
    return tuple(
        line.replace("\\", "/") for line in result.stdout.splitlines()
        if line
    )


def all_manifest_paths(root: Path) -> tuple[Path, ...]:
    directory = root / "scripts" / "prospecting"
    return tuple(sorted(directory.glob("gate_manifest*.json")))


def strict_allowlist(root: Path) -> tuple[str, ...]:
    allowed = {f"{RESULTS_DIRECTORY}/{path.name}" for path in (root / RESULTS_DIRECTORY).glob("*.json")}
    for path in all_manifest_paths(root):
        allowed.add(manifest_artifact(root, path))
        try:
            manifest = load_manifest(path)
        except (OSError, json.JSONDecodeError):
            continue
        allowed.update(str(item) for item in manifest.get("artifacts", ()))
        allowed.update(f"orgs/prospecting/fixtures/{item}" for item in manifest.get("fixtures", ()))
    return tuple(sorted(allowed))


def record_path(root: Path, phase: str = "P1") -> Path:
    return root / RESULTS_DIRECTORY / f"{phase}.json"


def current_git_head(root: Path) -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=root, capture_output=True,
        text=True, check=True,
    ).stdout.strip()


def write_record(root: Path, phase: str, summary: Mapping[str, object], strict_allowlist: bool,
                 hashes: Mapping[str, str]) -> None:
    record = {
        **summary,
        "artifact_hashes": dict(hashes),
        "git_head": current_git_head(root),
        "recorded_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "strict_allowlist": strict_allowlist,
    }
    destination = record_path(root, phase)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(record, sort_keys=True, indent=2) + "\n", encoding="utf-8", newline="\n")


def verify_recorded(root: Path, phase: str) -> int:
    destination = record_path(root, phase)
    mismatched: list[str] = []
    try:
        record = json.loads(destination.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        record = {}
        mismatched.append(str(destination.relative_to(root)).replace("\\", "/"))
    recorded_hashes = record.get("artifact_hashes", {})
    if not isinstance(recorded_hashes, Mapping):
        recorded_hashes = {}
        mismatched.append("artifact_hashes")
    hashes, missing = compute_artifact_hashes(root, tuple(str(path) for path in recorded_hashes))
    mismatched.extend(path for path in recorded_hashes if hashes.get(path) != recorded_hashes[path])
    mismatched.extend(path for path in missing if path not in mismatched)
    if record.get("status") != "passed":
        mismatched.append("status")
    result = {
        "git_head": current_git_head(root),
        "matched": not mismatched,
        "mismatched": sorted(set(mismatched)),
        "status": "passed" if not mismatched else "failed",
    }
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result["matched"] else 1


def evaluate_run(manifest: Mapping[str, object], run: GateRun) -> tuple[str, ...]:
    errors: list[str] = []
    expected = tuple(str(item) for item in manifest["tests"])
    collected = run.nodeids
    if collected != expected:
        expected_nodes = set(expected)
        collected_nodes = set(collected)
        errors.extend(
            f"manifest node missing from collection: {node}"
            for node in expected if node not in collected_nodes
        )
        errors.extend(
            f"collected node absent from manifest: {node}"
            for node in collected if node not in expected_nodes
        )
        if expected_nodes == collected_nodes:
            errors.append("collected node order differs from manifest")
    criteria = dict(manifest.get("criteria", {}))
    builtins = {
        "failures": run.failed,
        "skips": run.skipped,
        "xfails": run.xfailed,
        "warnings": run.warnings,
        "external_network_calls": run.external_network_calls,
        "child_processes_without_guard": run.child_processes_without_guard,
    }
    minimum = criteria.get("minimum_enumerated_tests")
    if isinstance(minimum, int) and len(collected) < minimum:
        errors.append(f"criterion minimum_enumerated_tests measured {len(collected)}; required at least {minimum}")
    for criterion, required in criteria.items():
        if criterion in {"minimum_enumerated_tests", "inspector_minimum"}:
            continue
        measured = builtins.get(criterion)
        if measured is None:
            if criterion not in run.measurements:
                errors.append(f"criterion {criterion} has no recorded measurement")
                continue
            measured = run.measurements[criterion]
        if measured != required:
            errors.append(f"criterion {criterion} measured {measured}; required {required}")
    return tuple(errors)


class LoopbackOnlySocket(socket.socket):
    """Socket used during a gate run; it permits only loopback destinations."""

    external_network_calls = 0

    @classmethod
    def _allowed(cls, address: object) -> bool:
        host = address[0] if isinstance(address, tuple) and address else ""
        return host in {"127.0.0.1", "::1", "localhost"}

    @classmethod
    def _reject(cls) -> None:
        cls.external_network_calls += 1

    def connect(self, address: object) -> object:
        if not self._allowed(address):
            self._reject()
            raise OSError("external network disabled by gate")
        return super().connect(address)

    def connect_ex(self, address: object) -> int:
        if not self._allowed(address):
            self._reject()
            return errno.EACCES
        return super().connect_ex(address)


def run_tests(root: Path, nodeids: tuple[str, ...]) -> GateRun:
    plugin = GatePlugin()
    os.environ["KB_PROSPECTING_NO_NETWORK"] = "1"
    install_no_network_guard()
    original_socket = socket.socket
    original_popen = subprocess.Popen
    unguarded_children = 0
    LoopbackOnlySocket.external_network_calls = 0

    class GuardedPopen(original_popen):  # type: ignore[misc,valid-type]
        """Subclass (not a function) so stdlib code may still subclass subprocess.Popen."""

        def __init__(self, *args: object, **kwargs: object) -> None:
            nonlocal unguarded_children
            child_environment = kwargs.get("env", os.environ)
            if not isinstance(child_environment, Mapping) or child_environment.get(
                "KB_PROSPECTING_NO_NETWORK"
            ) != "1":
                unguarded_children += 1
                raise RuntimeError("P1 child missing no-network environment")
            super().__init__(*args, **kwargs)  # type: ignore[arg-type]

    socket.socket = LoopbackOnlySocket
    subprocess.Popen = GuardedPopen
    try:
        exit_code = pytest.main(
            [
                *nodeids,
                "-q",
                "-W",
                "ignore:pkg_resources is deprecated as an API:UserWarning",
                "-p",
                "no:cacheprovider",
            ],
            plugins=[plugin],
        )
    finally:
        socket.socket = original_socket
        subprocess.Popen = original_popen
    if exit_code != pytest.ExitCode.OK and plugin.failed == 0:
        plugin.failed = 1
    return GateRun(
        plugin.nodeids, plugin.passed, plugin.failed, plugin.skipped, plugin.xfailed,
        plugin.warnings, LoopbackOnlySocket.external_network_calls, unguarded_children, dict(plugin.measurements),
        tuple(plugin.failed_nodes),
    )


def resolve_runtime() -> tuple[Path, str]:
    environment = {**os.environ, "KB_PROSPECTING_NO_NETWORK": "1"}
    resolved = subprocess.run(
        ["py", "-3", "-c", "import sys;print(sys.executable)"],
        env=environment, text=True, capture_output=True, check=True,
    ).stdout.strip()
    if not resolved:
        raise RuntimeError("host interpreter did not resolve")
    interpreter = Path(resolved)
    facts = subprocess.run(
        [str(interpreter), "-c",
         "import datasette,sqlite3,sys;print(sys.version_info[:2]);print(sqlite3.sqlite_version);print(datasette.__version__)"],
        env=environment, text=True, capture_output=True, check=True,
    ).stdout.splitlines()
    if facts != ["(3, 13)", "3.50.4", "0.65.1"]:
        raise RuntimeError("P1 runtime prerequisite mismatch")
    return interpreter, hashlib.sha256(str(interpreter).encode("utf-8")).hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True)
    parser.add_argument("--inspector-score", type=int)
    parser.add_argument("--strict-allowlist", action="store_true")
    parser.add_argument("--record", action="store_true")
    parser.add_argument("--verify-recorded", action="store_true")
    args = parser.parse_args(argv)
    if not isinstance(args.phase, str) or re.fullmatch(r"P[1-9][0-9]*", args.phase) is None:
        print('{"code":"invalid_phase","status":"failed"}')
        return 1
    if args.verify_recorded:
        return verify_recorded(ROOT, args.phase)
    os.environ["KB_PROSPECTING_NO_NETWORK"] = "1"
    install_no_network_guard()
    path = manifest_path(ROOT, args.phase)
    if not path.is_file():
        print('{"code":"unknown_phase","status":"failed"}')
        return 1
    try:
        manifest = load_manifest(path)
    except (OSError, json.JSONDecodeError):
        print('{"code":"unknown_phase","status":"failed"}')
        return 1
    errors = [*validate_manifest(manifest, args.phase, ROOT, path), *validate_files(ROOT, manifest)]
    artifacts = tuple(str(item) for item in manifest.get("artifacts", ()))
    try:
        errors.extend(validate_artifact_tracking(ROOT, artifacts))
    except subprocess.CalledProcessError:
        errors.append("artifact tracking could not be verified")
    hashes, missing_hash_artifacts = compute_artifact_hashes(ROOT, artifacts, manifest_artifact(ROOT, path))
    if missing_hash_artifacts or hashes != manifest.get("artifact_hashes"):
        errors.append("artifact hashes differ from manifest")
    if args.strict_allowlist:
        committed = committed_phase_paths(ROOT)
        if set(committed) != set(strict_allowlist(ROOT)):
            errors.append("committed prospecting paths differ from manifest union allowlist")
    inspector_minimum = dict(manifest.get("criteria", {})).get("inspector_minimum")
    if isinstance(inspector_minimum, int):
        if args.inspector_score is None:
            errors.append("criterion inspector_minimum requires boss-supplied --inspector-score")
        elif args.inspector_score < inspector_minimum:
            errors.append(
                f"criterion inspector_minimum measured {args.inspector_score}; required {inspector_minimum}"
            )
    interpreter_hash = ""
    try:
        _, interpreter_hash = resolve_runtime()
    except Exception:
        errors.append("runtime prerequisite mismatch")
    run = GateRun((), 0, 1, 0, 0, 0, 0, 0, {})
    if not errors:
        run = run_tests(ROOT, tuple(str(item) for item in manifest["tests"]))
        errors.extend(evaluate_run(manifest, run))
    summary = {
        "phase": args.phase, "status": "passed" if not errors else "failed",
        "passed": run.passed, "failed": run.failed, "skipped": run.skipped,
        "xfailed": run.xfailed, "warnings": run.warnings,
        "external_network_calls": run.external_network_calls,
        "child_processes_without_guard": run.child_processes_without_guard,
        "inspector_score": args.inspector_score,
        "failed_nodes": list(run.failed_nodes),
        "interpreter_path_sha256": interpreter_hash,
        "artifact_hashes": hashes,
        "error_codes": tuple(f"gate_{index + 1}" for index in range(len(errors))),
        "errors": tuple(errors),
    }
    assert_vm_safe({"kind": "stdout", "fields": summary}, "stdout")
    print(json.dumps(summary, sort_keys=True, separators=(",", ":")))
    if not errors and args.record:
        write_record(ROOT, args.phase, summary, args.strict_allowlist, hashes)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
