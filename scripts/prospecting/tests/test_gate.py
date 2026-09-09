import errno
import json
import os
import re
from dataclasses import replace
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time

import pytest
import scripts.prospecting.gate as gate_module
from scripts.prospecting.gate import (
    GateRun,
    LoopbackOnlySocket,
    evaluate_run,
    load_manifest,
    main,
    manifest_path,
    record_path,
    run_tests,
    strict_allowlist,
    validate_files,
    validate_manifest,
)
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_gate")

MANIFEST_PATH = Path(__file__).parents[1] / "gate_manifest.json"
REPO_ROOT = Path(__file__).parents[3]


def _run_pytest_in_subprocess(
    *args: str | Path, cwd: Path = REPO_ROOT, basetemp: Path,
    extra_environment: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable, "-m", "pytest", *(str(arg) for arg in args), "-q",
            "--basetemp", str(basetemp), "-p", "no:cacheprovider",
        ],
        cwd=cwd,
        env={**os.environ, "KB_PROSPECTING_NO_NETWORK": "1", **(extra_environment or {})},
        text=True,
        capture_output=True,
        check=False,
    )


def _clean_run(manifest: dict[str, object]) -> GateRun:
    criteria = dict(manifest["criteria"])
    builtins = {
        "minimum_enumerated_tests", "failures", "skips", "xfails", "warnings",
        "external_network_calls", "child_processes_without_guard", "inspector_minimum",
    }
    measurements = {name: int(value) for name, value in criteria.items() if name not in builtins}
    tests = tuple(manifest["tests"])
    return GateRun(tests, len(tests), 0, 0, 0, 0, 0, 0, measurements)


def _write_manifest(path: Path, phase: str, artifacts: list[str], tests: list[str],
                    criteria: dict[str, int], fixtures: list[str] | None = None) -> dict[str, object]:
    manifest = {
        "phase": phase,
        "artifacts": artifacts,
        "fixtures": fixtures or [],
        "tests": tests,
        "criteria": criteria,
        "artifact_hashes": {},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


def _copy_manifest_artifacts(tmp_path: Path, manifest: dict[str, object]) -> None:
    """Build an isolated tracked worktree for runner-level tests."""
    for relative in manifest["artifacts"]:
        source = REPO_ROOT / str(relative)
        destination = tmp_path / str(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    copied_manifest = tmp_path / "scripts" / "prospecting" / "gate_manifest.json"
    manifest_data = load_manifest(copied_manifest)
    artifacts = tuple(str(item) for item in manifest_data["artifacts"])
    hashes, missing = gate_module.compute_artifact_hashes(
        tmp_path, artifacts, gate_module.manifest_artifact(tmp_path, copied_manifest)
    )
    assert not missing
    manifest_data["artifact_hashes"] = hashes
    copied_manifest.write_text(json.dumps(manifest_data), encoding="utf-8")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)


def test_45_manifest_enumerates_the_current_test_suite() -> None:
    manifest = load_manifest(MANIFEST_PATH)
    assert validate_manifest(manifest) == ()
    assert len(manifest["tests"]) == int(manifest["criteria"]["minimum_enumerated_tests"])
    assert len(set(manifest["tests"])) == len(manifest["tests"])


def test_46_gate_rejects_failures_and_main_emits_one_safe_json_line(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = load_manifest(MANIFEST_PATH)
    clean = _clean_run(manifest)
    for mutation in (
        replace(clean, nodeids=clean.nodeids[:-1], passed=clean.passed - 1),
        replace(clean, failed=1), replace(clean, skipped=1), replace(clean, xfailed=1),
        replace(clean, warnings=1), replace(clean, external_network_calls=1),
        replace(clean, child_processes_without_guard=1),
    ):
        assert evaluate_run(manifest, mutation)
    assert evaluate_run(manifest, clean) == ()
    _copy_manifest_artifacts(tmp_path, manifest)
    path = manifest_path(tmp_path, "P1")
    monkeypatch.setattr(gate_module, "ROOT", tmp_path)
    monkeypatch.setattr(gate_module, "resolve_runtime", lambda: (Path("python.exe"), "a" * 64))
    monkeypatch.setattr(gate_module, "run_tests", lambda root, nodeids: clean)
    assert main(["--phase", "P1", "--inspector-score", "90"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 1 and json.loads(lines[0])["status"] == "passed"
    assert main(["--phase", "P99", "--inspector-score", "90"]) == 1
    assert json.loads(capsys.readouterr().out) == {"code": "unknown_phase", "status": "failed"}


def test_47_manifest_validation_and_files_are_hermetic(tmp_path: Path) -> None:
    manifest = load_manifest(MANIFEST_PATH)
    _copy_manifest_artifacts(tmp_path, manifest)
    fixture_root = tmp_path / "orgs" / "prospecting" / "fixtures"
    (fixture_root / "synthetic.json").unlink()
    missing = validate_files(tmp_path, {**manifest, "fixtures": ["synthetic.json"]})
    assert "missing fixture: synthetic.json" in missing


def test_48_p2_style_manifest_loads_and_custom_criterion_needs_measurement(tmp_path: Path) -> None:
    test_file = tmp_path / "scripts" / "prospecting" / "tests" / "test_p2.py"
    test_file.parent.mkdir(parents=True)
    test_file.write_text("def test_p2():\n    pass\n", encoding="utf-8")
    path = manifest_path(tmp_path, "P2")
    manifest = _write_manifest(
        path, "P2", ["scripts/prospecting/gate_manifest_p2.json"],
        ["scripts/prospecting/tests/test_p2.py::test_p2"],
        {"minimum_enumerated_tests": 1, "failures": 0, "skips": 0, "xfails": 0,
         "warnings": 0, "external_network_calls": 0, "child_processes_without_guard": 0,
         "inspector_minimum": 90, "custom_count": 7},
    )
    assert load_manifest(path)["phase"] == "P2"
    assert validate_manifest(manifest, "P2", tmp_path, path) == ()
    clean = GateRun(tuple(manifest["tests"]), 1, 0, 0, 0, 0, 0, 0, {"custom_count": 7})
    assert evaluate_run(manifest, clean) == ()
    assert "criterion custom_count has no recorded measurement" in evaluate_run(manifest, replace(clean, measurements={}))


def test_49_custom_criterion_is_summed_from_record_property(tmp_path: Path) -> None:
    test_file = tmp_path / "test_metric.py"
    test_file.write_text(
        "def test_metric(record_property):\n    record_property('custom_count', 7)\n",
        encoding="utf-8",
    )
    result_file = tmp_path / "run.json"
    runner = tmp_path / "test_run_tests.py"
    runner.write_text(
        "import json\n"
        "from pathlib import Path\n"
        "from scripts.prospecting.gate import run_tests\n\n"
        "def test_run_tests():\n"
        f"    run = run_tests(Path({str(tmp_path)!r}), ({f'{test_file}::test_metric'!r},))\n"
        f"    Path({str(result_file)!r}).write_text(json.dumps(dict(run.measurements)), encoding='utf-8')\n",
        encoding="utf-8",
    )
    result = _run_pytest_in_subprocess(runner, basetemp=tmp_path / "pytest-subprocess")
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result_file.read_text(encoding="utf-8")) == {"custom_count": 7}


def test_54_gate_run_of_this_suite_matches_a_direct_subprocess_run(tmp_path: Path) -> None:
    if os.environ.get("KB_PROSPECTING_NESTED_GATE_PROBE") == "1":
        return

    direct = _run_pytest_in_subprocess(
        Path(__file__), basetemp=tmp_path / "direct-pytest",
        extra_environment={"KB_PROSPECTING_NESTED_GATE_PROBE": "1"},
    )
    assert direct.returncode == 0, direct.stdout + direct.stderr
    direct_match = re.search(r"(\d+) passed", direct.stdout)
    assert direct_match is not None

    result_file = tmp_path / "nested-gate.json"
    runner = tmp_path / "test_nested_gate.py"
    runner.write_text(
        "import json\n"
        "import os\n"
        "from pathlib import Path\n"
        "from scripts.prospecting.gate import run_tests\n\n"
        "def test_nested_gate():\n"
        "    os.environ['KB_PROSPECTING_NESTED_GATE_PROBE'] = '1'\n"
        f"    os.environ['PYTEST_ADDOPTS'] = {f'--basetemp {tmp_path / 'inner-gate-pytest'}'!r}\n"
        f"    run = run_tests(Path({str(REPO_ROOT)!r}), ({str(Path(__file__))!r},))\n"
        f"    Path({str(result_file)!r}).write_text(json.dumps({{'passed': run.passed}}), encoding='utf-8')\n",
        encoding="utf-8",
    )
    nested = _run_pytest_in_subprocess(runner, basetemp=tmp_path / "nested-pytest")
    assert nested.returncode == 0, nested.stdout + nested.stderr
    assert json.loads(result_file.read_text(encoding="utf-8"))["passed"] == int(direct_match.group(1))


def test_50_loopback_connect_ex_permits_localhost_and_refuses_external() -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    try:
        permitted = LoopbackOnlySocket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            assert permitted.connect_ex(listener.getsockname()) == 0
        finally:
            permitted.close()
        accepted, _ = listener.accept()
        accepted.close()
        LoopbackOnlySocket.external_network_calls = 0
        refused = LoopbackOnlySocket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            assert refused.connect_ex(("203.0.113.1", 443)) == errno.EACCES
        finally:
            refused.close()
        assert LoopbackOnlySocket.external_network_calls == 1
    finally:
        listener.close()


def test_51_strict_allowlist_unions_multiple_manifests(tmp_path: Path) -> None:
    _write_manifest(tmp_path / "scripts/prospecting/gate_manifest.json", "P1", ["scripts/prospecting/one.py"], [], {}, ["one.json"])
    _write_manifest(tmp_path / "scripts/prospecting/gate_manifest_p2.json", "P2", ["scripts/prospecting/two.py"], [], {}, ["two.json"])
    for relative in ("scripts/prospecting/one.py", "scripts/prospecting/two.py", "orgs/prospecting/fixtures/one.json", "orgs/prospecting/fixtures/two.json"):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x", encoding="utf-8")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    assert set(gate_module.committed_phase_paths(tmp_path)) == set(strict_allowlist(tmp_path))


def test_52_record_and_verify_are_phase_specific(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    artifact = tmp_path / "artifact.txt"
    artifact.write_text("unchanged\n", encoding="utf-8")
    digest = gate_module.compute_artifact_hashes(tmp_path, ("artifact.txt",))[0]["artifact.txt"]
    _write_manifest(manifest_path(tmp_path, "P3"), "P3", [], [], {})
    record = record_path(tmp_path, "P3")
    record.parent.mkdir(parents=True)
    record.write_text(json.dumps({"status": "passed", "artifact_hashes": {"artifact.txt": digest}}), encoding="utf-8")
    monkeypatch.setattr(gate_module, "ROOT", tmp_path)
    monkeypatch.setattr(gate_module, "current_git_head", lambda root: "c" * 40)
    monkeypatch.setattr(pytest, "main", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("must not run")))
    started = time.monotonic()
    assert main(["--phase", "P3", "--verify-recorded"]) == 0
    assert time.monotonic() - started < 5
    verified = json.loads(capsys.readouterr().out)
    assert verified["matched"] is True
    assert verified["status"] == "passed"
    artifact.write_text("modified\n", encoding="utf-8")
    assert main(["--phase", "P3", "--verify-recorded"]) == 1
    assert json.loads(capsys.readouterr().out)["mismatched"] == ["artifact.txt"]


def test_53_manifest_ids_must_not_contain_pii_like_literals() -> None:
    manifest = load_manifest(MANIFEST_PATH)
    unsafe = {**manifest, "tests": [f"test.py::test_case[{SYNTHETIC['unsafe_node_id_phone']}]"]}
    assert "manifest_ids_clean failed: node ids contain PII-like literals" in validate_manifest(unsafe)
