from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

import pytest

from scripts.prospecting.manager import p5_contracts
from scripts.prospecting.manager.p5_contracts import (
    ENTRYPOINTS,
    MANIFESTS,
    verify_prerequisites,
)


def test_entrypoints_are_exact() -> None:
    assert set(ENTRYPOINTS) == {"list-builder", "personalizer", "campaigner", "inspector"}
    assert all(entry["module"] == "scripts.prospecting.manager.desktop_stage" for entry in ENTRYPOINTS.values())
    assert all(entry["commands"] == entry["operations"] for entry in ENTRYPOINTS.values())


def test_pinned_modules_import_unconditionally() -> None:
    modules = ", ".join(value["module"] for value in ENTRYPOINTS.values())
    result = subprocess.run(
        [sys.executable, "-c", f"import {modules}"],
        env={**os.environ, "KB_PROSPECTING_NO_NETWORK": "1"},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


_VERIFY_PASSED = {
    "git_head": "a" * 40,
    "matched": True,
    "mismatched": [],
    "status": "passed",
}


def _verified_stdout(**changes: Any) -> str:
    value = {**_VERIFY_PASSED, **changes}
    return json.dumps(value)


def _record(root: Path, record_phase: str, artifact_count: int = 1) -> list[Path]:
    gate = root / "orgs/prospecting/gate-results"
    gate.mkdir(parents=True, exist_ok=True)
    manifest = root / MANIFESTS[record_phase]
    manifest.parent.mkdir(parents=True, exist_ok=True)
    artifacts = []
    artifact_hashes = {}
    for index in range(artifact_count):
        relative = f"synthetic/{record_phase.lower()}-{index}.txt"
        artifact = root / relative
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_text(f"{record_phase}:{index}\r\n", encoding="utf-8")
        artifacts.append(artifact)
        normalized = (
            artifact.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        )
        artifact_hashes[relative] = hashlib.sha256(normalized).hexdigest()
    manifest.write_text(
        json.dumps(
            {
                "phase": record_phase,
                "artifacts": [*artifact_hashes, MANIFESTS[record_phase]],
                "artifact_hashes": artifact_hashes,
                "fixtures": [],
                "tests": ["synthetic/test_gate.py::test_recorded_phase"],
                "criteria": {
                    "minimum_enumerated_tests": 1,
                    "failures": 0,
                    "skips": 0,
                    "xfails": 0,
                    "warnings": 0,
                    "external_network_calls": 0,
                    "child_processes_without_guard": 0,
                    "inspector_minimum": 90,
                },
            }
        ),
        encoding="utf-8",
    )
    value = {
        "artifact_hashes": artifact_hashes,
        "child_processes_without_guard": 0,
        "error_codes": [],
        "errors": [],
        "external_network_calls": 0,
        "failed": 0,
        "failed_nodes": [],
        "git_head": "b" * 40,
        "inspector_score": 90,
        "interpreter_path_sha256": "c" * 64,
        "passed": 1,
        "phase": record_phase,
        "recorded_at": "2026-09-08T12:00:00Z",
        "skipped": 0,
        "status": "passed",
        "strict_allowlist": False,
        "warnings": 0,
        "xfailed": 0,
    }
    (gate / f"{record_phase}.json").write_text(json.dumps(value), encoding="utf-8")
    return artifacts


def _change_record(root: Path, record_phase: str, **changes: Any) -> None:
    path = root / f"orgs/prospecting/gate-results/{record_phase}.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    value.update(changes)
    path.write_text(json.dumps(value), encoding="utf-8")


def test_all_four_exact_recorded_passes_are_required(tmp_path: Path) -> None:
    for phase in ("P1", "P2", "P3", "P4"):
        _record(tmp_path, phase)
    seen = []

    def run(argv: list[str]) -> tuple[int, str, str]:
        seen.append(argv)
        return 0, _verified_stdout(), ""

    report = verify_prerequisites(tmp_path, run=run)
    assert report.phases == {phase: "pass" for phase in ("P1", "P2", "P3", "P4")}
    assert seen == [[
        sys.executable,
        "-m",
        "scripts.prospecting.gate",
        "--phase",
        "P1",
        "--verify-recorded",
    ]]


@pytest.mark.parametrize(
    ("code", "stdout"),
    [
        (0, "P1 RECORDED PASS"),
        (0, "{}"),
        (0, _verified_stdout(status="pass")),
        (0, _verified_stdout(matched=False)),
        (0, _verified_stdout(mismatched=["artifact.txt"])),
        (0, _verified_stdout(extra="loose-schema")),
        (1, _verified_stdout()),
    ],
)
def test_p1_requires_exact_real_verify_schema(
    tmp_path: Path, code: int, stdout: str
) -> None:
    for phase in ("P1", "P2", "P3", "P4"):
        _record(tmp_path, phase)
    with pytest.raises(RuntimeError, match="P1_recorded_gate_required"):
        verify_prerequisites(tmp_path, run=lambda argv: (code, stdout, ""))


def test_missing_later_records_need_explicit_pending_ok(tmp_path: Path) -> None:
    _record(tmp_path, "P1")
    run = lambda argv: (0, _verified_stdout(), "")
    with pytest.raises(RuntimeError, match="P2_recorded_gate_missing"):
        verify_prerequisites(tmp_path, run=run)
    report = verify_prerequisites(tmp_path, pending_ok=True, run=run)
    assert report.phases == {
        "P1": "pass",
        "P2": "pending",
        "P3": "pending",
        "P4": "pending",
    }


@pytest.mark.parametrize(
    "change",
    [
        {"phase": "P9"},
        {"status": "failed"},
        {"artifact_hashes": {}},
        {"failed": 1},
        {"skipped": 1},
        {"xfailed": 1},
        {"warnings": 1},
        {"external_network_calls": 1},
        {"child_processes_without_guard": 1},
        {"passed": 0},
        {"passed": 2},
        {"inspector_score": 89},
        {"errors": ["fabricated pass"]},
    ],
)
def test_present_record_must_match_all_fields(
    tmp_path: Path, change: dict[str, Any]
) -> None:
    _record(tmp_path, "P1")
    _record(tmp_path, "P2")
    _change_record(tmp_path, "P2", **change)
    with pytest.raises(RuntimeError, match="P2_recorded_gate_invalid"):
        verify_prerequisites(
            tmp_path,
            pending_ok=True,
            run=lambda argv: (0, _verified_stdout(), ""),
        )


def test_record_must_cover_the_manifest_full_artifact_set(tmp_path: Path) -> None:
    _record(tmp_path, "P1")
    _record(tmp_path, "P2", artifact_count=2)
    path = tmp_path / "orgs/prospecting/gate-results/P2.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    value["artifact_hashes"].pop(next(iter(value["artifact_hashes"])))
    path.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(RuntimeError, match="P2_recorded_gate_invalid"):
        verify_prerequisites(
            tmp_path,
            pending_ok=True,
            run=lambda argv: (0, _verified_stdout(), ""),
        )


def test_record_recomputes_artifacts_under_the_supplied_root(tmp_path: Path) -> None:
    _record(tmp_path, "P1")
    artifacts = _record(tmp_path, "P2")
    artifacts[0].write_text("changed after recording\n", encoding="utf-8")

    with pytest.raises(RuntimeError, match="P2_recorded_gate_invalid"):
        verify_prerequisites(
            tmp_path,
            pending_ok=True,
            run=lambda argv: (0, _verified_stdout(), ""),
        )


def test_manifest_phase_must_match_the_requested_phase(tmp_path: Path) -> None:
    _record(tmp_path, "P1")
    _record(tmp_path, "P2")
    path = tmp_path / MANIFESTS["P2"]
    value = json.loads(path.read_text(encoding="utf-8"))
    value["phase"] = "P9"
    path.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(RuntimeError, match="P2_recorded_gate_invalid"):
        verify_prerequisites(
            tmp_path,
            pending_ok=True,
            run=lambda argv: (0, _verified_stdout(), ""),
        )


def test_manifest_cannot_hash_an_artifact_outside_the_root(tmp_path: Path) -> None:
    _record(tmp_path, "P1")
    _record(tmp_path, "P2")
    outside = tmp_path.parent / "p5-outside-artifact.txt"
    outside.write_text("outside\n", encoding="utf-8")
    digest = hashlib.sha256(outside.read_bytes()).hexdigest()
    manifest_path = tmp_path / MANIFESTS["P2"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["artifacts"] = ["../p5-outside-artifact.txt", MANIFESTS["P2"]]
    manifest["artifact_hashes"] = {"../p5-outside-artifact.txt": digest}
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    _change_record(
        tmp_path,
        "P2",
        artifact_hashes={"../p5-outside-artifact.txt": digest},
    )

    with pytest.raises(RuntimeError, match="P2_recorded_gate_invalid"):
        verify_prerequisites(
            tmp_path,
            pending_ok=True,
            run=lambda argv: (0, _verified_stdout(), ""),
        )


def test_default_runner_executes_the_real_gate_from_the_supplied_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for phase in ("P1", "P2", "P3", "P4"):
        _record(tmp_path, phase)
    observed = {}

    def subprocess_run(argv: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        observed["argv"] = argv
        observed["cwd"] = kwargs["cwd"]
        return subprocess.CompletedProcess(argv, 0, _verified_stdout(), "")

    monkeypatch.setattr(p5_contracts.subprocess, "run", subprocess_run)
    report = verify_prerequisites(tmp_path)

    assert report.phases == {phase: "pass" for phase in ("P1", "P2", "P3", "P4")}
    assert observed == {
        "argv": [
            sys.executable,
            "-m",
            "scripts.prospecting.gate",
            "--phase",
            "P1",
            "--verify-recorded",
        ],
        "cwd": tmp_path.resolve(),
    }
