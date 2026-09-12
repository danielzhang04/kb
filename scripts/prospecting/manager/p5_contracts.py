from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from pathlib import PurePosixPath, PureWindowsPath
import subprocess
import sys
from typing import Callable


ENTRYPOINTS = {
    name: {
        "module": "scripts.prospecting.manager.desktop_stage",
        "operations": operations,
        # Compatibility inventory only; it is not an argv template.
        "commands": operations,
    }
    for name, operations in {
        "list-builder": ("build",),
        "personalizer": ("prepare", "personalize"),
        "campaigner": ("sweep", "scan", "reconcile", "status"),
        "inspector": ("grade",),
    }.items()
}

MANIFESTS = {
    "P1": "scripts/prospecting/gate_manifest.json",
    "P2": "scripts/prospecting/gate_manifest_p2.json",
    "P3": "scripts/prospecting/gate_manifest_p3.json",
    "P4": "scripts/prospecting/gate_manifest_p4.json",
}

_MANIFEST_KEYS = {
    "phase",
    "artifacts",
    "artifact_hashes",
    "fixtures",
    "tests",
    "criteria",
}
_RECORD_KEYS = {
    "artifact_hashes",
    "child_processes_without_guard",
    "error_codes",
    "errors",
    "external_network_calls",
    "failed",
    "failed_nodes",
    "git_head",
    "inspector_score",
    "interpreter_path_sha256",
    "passed",
    "phase",
    "recorded_at",
    "skipped",
    "status",
    "strict_allowlist",
    "warnings",
    "xfailed",
}
_VERIFY_RESULT_KEYS = {"git_head", "matched", "mismatched", "status"}


@dataclass(frozen=True)
class PrerequisiteReport:
    phases: dict[str, str]


def _default_run(argv: list[str], root: Path) -> tuple[int, str, str]:
    result = subprocess.run(
        argv, cwd=root, text=True, capture_output=True, check=False
    )
    return result.returncode, result.stdout, result.stderr


def _is_sha256(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _is_git_hash(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) in {40, 64}
        and all(character in "0123456789abcdef" for character in value)
    )


def _artifact_path(root: Path, value: object) -> Path | None:
    if not isinstance(value, str) or not value or "\\" in value:
        return None
    posix = PurePosixPath(value)
    windows = PureWindowsPath(value)
    if (
        posix.is_absolute()
        or windows.is_absolute()
        or windows.drive
        or posix.as_posix() != value
        or any(part in {"", ".", ".."} for part in posix.parts)
    ):
        return None
    try:
        path = (root / Path(*posix.parts)).resolve(strict=True)
    except OSError:
        return None
    return path if path.is_file() and path.is_relative_to(root) else None


def _normalized_sha256(path: Path) -> str:
    content = path.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return hashlib.sha256(content).hexdigest()


def _record_shape_is_valid(value: object, phase: str) -> bool:
    if not isinstance(value, dict) or set(value) != _RECORD_KEYS:
        return False
    counters = (
        "passed",
        "failed",
        "skipped",
        "xfailed",
        "warnings",
        "external_network_calls",
        "child_processes_without_guard",
    )
    if any(
        not isinstance(value.get(name), int)
        or isinstance(value.get(name), bool)
        or value[name] < 0
        for name in counters
    ):
        return False
    return (
        value.get("phase") == phase
        and value.get("status") == "passed"
        and value["passed"] > 0
        and value["failed"] == 0
        and value["external_network_calls"] == 0
        and value["child_processes_without_guard"] == 0
        and value.get("error_codes") == []
        and value.get("errors") == []
        and value.get("failed_nodes") == []
        and _is_git_hash(value.get("git_head"))
        and _is_sha256(value.get("interpreter_path_sha256"))
        and isinstance(value.get("recorded_at"), str)
        and value["recorded_at"].endswith("Z")
        and isinstance(value.get("strict_allowlist"), bool)
        and (
            value.get("inspector_score") is None
            or (
                isinstance(value.get("inspector_score"), int)
                and not isinstance(value.get("inspector_score"), bool)
            )
        )
    )


def _criteria_are_satisfied(
    record: dict[str, object], criteria: object, tests: object
) -> bool:
    if (
        not isinstance(criteria, dict)
        or not criteria
        or not isinstance(tests, list)
        or not tests
        or any(not isinstance(node, str) or not node for node in tests)
        or len(set(tests)) != len(tests)
        or any(
            not isinstance(required, int) or isinstance(required, bool)
            for required in criteria.values()
        )
    ):
        return False
    builtins = {
        "failures": "failed",
        "skips": "skipped",
        "xfails": "xfailed",
        "warnings": "warnings",
        "external_network_calls": "external_network_calls",
        "child_processes_without_guard": "child_processes_without_guard",
    }
    if any(record[field] != criteria.get(criterion) for criterion, field in builtins.items()):
        return False
    minimum = criteria.get("minimum_enumerated_tests")
    inspector_minimum = criteria.get("inspector_minimum")
    measured_tests = sum(
        int(record[field]) for field in ("passed", "failed", "skipped", "xfailed")
    )
    inspector_score = record.get("inspector_score")
    return (
        isinstance(minimum, int)
        and minimum > 0
        and len(tests) >= minimum
        and measured_tests == len(tests)
        and isinstance(inspector_minimum, int)
        and isinstance(inspector_score, int)
        and not isinstance(inspector_score, bool)
        and inspector_score >= inspector_minimum
    )


def _record(root: Path, phase: str, pending_ok: bool) -> str:
    relative_record = f"orgs/prospecting/gate-results/{phase}.json"
    record_candidate = root / relative_record
    if not record_candidate.exists():
        if pending_ok and phase != "P1":
            return "pending"
        raise RuntimeError(f"{phase}_recorded_gate_missing")
    path = _artifact_path(root, relative_record)
    manifest_path = _artifact_path(root, MANIFESTS[phase])
    if path is None or manifest_path is None:
        raise RuntimeError(f"{phase}_recorded_gate_invalid")

    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise RuntimeError(f"{phase}_recorded_gate_invalid") from None

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise RuntimeError(f"{phase}_recorded_gate_invalid") from None

    if (
        not _record_shape_is_valid(value, phase)
        or not isinstance(manifest, dict)
        or set(manifest) != _MANIFEST_KEYS
        or manifest.get("phase") != phase
        or not isinstance(manifest.get("artifacts"), list)
        or not manifest["artifacts"]
        or any(not isinstance(item, str) for item in manifest["artifacts"])
        or len(set(manifest["artifacts"])) != len(manifest["artifacts"])
        or not isinstance(manifest.get("artifact_hashes"), dict)
        or not manifest["artifact_hashes"]
        or not _criteria_are_satisfied(
            value, manifest.get("criteria"), manifest.get("tests")
        )
    ):
        raise RuntimeError(f"{phase}_recorded_gate_invalid")

    expected_paths = set(manifest["artifacts"]) - {MANIFESTS[phase]}
    manifest_hashes = manifest["artifact_hashes"]
    record_hashes = value["artifact_hashes"]
    if (
        set(manifest_hashes) != expected_paths
        or any(not _is_sha256(digest) for digest in manifest_hashes.values())
        or not isinstance(record_hashes, dict)
        or record_hashes != manifest_hashes
    ):
        raise RuntimeError(f"{phase}_recorded_gate_invalid")

    try:
        artifacts_match = all(
            (artifact := _artifact_path(root, relative)) is not None
            and _normalized_sha256(artifact) == digest
            for relative, digest in manifest_hashes.items()
        )
    except OSError:
        artifacts_match = False
    if not artifacts_match:
        raise RuntimeError(f"{phase}_recorded_gate_invalid")
    return "pass"


def _verified_gate_result(code: int, stdout: str) -> bool:
    try:
        value = json.loads(stdout)
    except (TypeError, json.JSONDecodeError):
        return False
    return (
        code == 0
        and isinstance(value, dict)
        and set(value) == _VERIFY_RESULT_KEYS
        and value.get("status") == "passed"
        and value.get("matched") is True
        and value.get("mismatched") == []
        and _is_git_hash(value.get("git_head"))
    )


def verify_prerequisites(
    root: Path,
    pending_ok: bool = False,
    run: Callable[[list[str]], tuple[int, str, str]] | None = None,
) -> PrerequisiteReport:
    try:
        root = root.resolve(strict=True)
    except OSError:
        raise RuntimeError("P1_recorded_gate_required") from None
    argv = [
        sys.executable,
        "-m",
        "scripts.prospecting.gate",
        "--phase",
        "P1",
        "--verify-recorded",
    ]
    code, stdout, _ = run(argv) if run is not None else _default_run(argv, root)
    if not _verified_gate_result(code, stdout):
        raise RuntimeError("P1_recorded_gate_required")

    phases = {
        phase: _record(root, phase, pending_ok) for phase in ("P1", "P2", "P3", "P4")
    }
    return PrerequisiteReport(phases)
