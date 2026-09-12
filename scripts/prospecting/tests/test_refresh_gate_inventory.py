"""Focused tests for the draft-only gate inventory refresh tool.

Each case builds a small synthetic root and monkeypatches the trusted
collector or a single named helper. Nothing here runs a phase gate, writes a
gate-results record, touches MANIFEST.sha256, or asserts an inspector grade.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.prospecting import gate as gate_module
from scripts.prospecting import refresh_gate_inventory as refresh_module

TEST_FILE = "scripts/prospecting/tests/test_synthetic_inventory_case.py"
SECOND_FILE = "scripts/prospecting/tests/test_synthetic_inventory_other.py"
TEST_SOURCE = (
    "def test_alpha() -> None:\n    assert True\n\n\n"
    "def test_beta() -> None:\n    assert True\n"
)
SECOND_SOURCE = "def test_gamma() -> None:\n    assert True\n"
NODES = (TEST_FILE + "::test_alpha", TEST_FILE + "::test_beta")
SECOND_NODE = SECOND_FILE + "::test_gamma"


def _write(root: Path, relative: str, text: str) -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    return path


def _build(
    root: Path,
    phase: str,
    *,
    tests: tuple[str, ...] = NODES,
    minimum: int | None = None,
    stale: bool = False,
    extra_file: bool = False,
) -> Path:
    manifest_relative = "scripts/prospecting/" + refresh_module.PHASE_FILES[phase]
    _write(root, TEST_FILE, TEST_SOURCE)
    _write(root, "orgs/prospecting/fixtures/synthetic.json", "{}\n")
    _write(root, "orgs/prospecting/STATE.md", "# synthetic DRAFT\n")
    artifacts = [TEST_FILE, "orgs/prospecting/STATE.md", manifest_relative]
    if extra_file:
        _write(root, SECOND_FILE, SECOND_SOURCE)
        artifacts.insert(1, SECOND_FILE)
    hashes, missing = gate_module.compute_artifact_hashes(
        root, tuple(artifacts), manifest_relative
    )
    assert missing == ()
    if stale:
        hashes = {name: "0" * 64 for name in hashes}
    criteria = {
        "minimum_enumerated_tests": len(tests) if minimum is None else minimum,
        "failures": 0, "skips": 0, "xfails": 0, "warnings": 0,
        "external_network_calls": 0, "child_processes_without_guard": 0,
        "inspector_minimum": 90,
    }
    manifest = {
        "phase": phase, "artifacts": artifacts, "artifact_hashes": hashes,
        "fixtures": ["synthetic.json"], "tests": list(tests), "criteria": criteria,
    }
    return _write(
        root, manifest_relative,
        json.dumps(manifest, sort_keys=True, indent=2) + "\n",
    )


def _never_collect(root: Path, files: tuple[str, ...]) -> set[str]:
    raise AssertionError("P1 must never collect tests")


def _run(monkeypatch, capsys, root, argv, *, nodes=(), collector=None):
    monkeypatch.setattr(refresh_module, "ROOT", root)
    if collector is None:
        def collector(_root: Path, _files: tuple[str, ...]) -> set[str]:
            return set(nodes)
    monkeypatch.setattr(refresh_module, "discover_live_nodes", collector)
    code = refresh_module.main(argv)
    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 1
    return code, json.loads(lines[0])


def test_dry_run_reports_change_and_writes_no_bytes(tmp_path, monkeypatch, capsys):
    manifest_path = _build(tmp_path, "P6", stale=True)
    before = manifest_path.read_bytes()
    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P6"], nodes=NODES
    )
    assert code == 0
    assert summary["change"] == "changed"
    assert summary["code"] == "ok"
    assert summary["counts"]["hashes_changed"] == 1
    assert manifest_path.read_bytes() == before


def test_write_emits_valid_json_then_replays_as_an_exact_noop(tmp_path, monkeypatch, capsys):
    manifest_path = _build(tmp_path, "P6", stale=True)
    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P6", "--write"], nodes=NODES
    )
    assert (code, summary["change"], summary["code"]) == (0, "changed", "ok")
    text = manifest_path.read_text(encoding="utf-8")
    assert text.endswith("\n")
    assert "\\n" not in text
    written = json.loads(text)
    expected, missing = gate_module.compute_artifact_hashes(
        tmp_path, tuple(written["artifacts"]),
        "scripts/prospecting/" + refresh_module.PHASE_FILES["P6"],
    )
    assert missing == ()
    assert written["artifact_hashes"] == expected
    settled = manifest_path.read_bytes()
    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P6", "--write"], nodes=NODES
    )
    assert (code, summary["change"]) == (0, "none")
    assert manifest_path.read_bytes() == settled


def test_p6_minimum_count_only_mismatch_is_repaired(tmp_path, monkeypatch, capsys):
    manifest_path = _build(tmp_path, "P6", minimum=1)
    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P6"], nodes=NODES
    )
    assert (code, summary["change"]) == (0, "changed")
    assert summary["counts"]["hashes_changed"] == 0
    assert summary["counts"]["tests_changed"] == 0
    assert summary["counts"]["minimum_changed"] == 1
    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P6", "--write"], nodes=NODES
    )
    written = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert code == 0
    assert written["tests"] == list(NODES)
    assert written["criteria"]["minimum_enumerated_tests"] == len(NODES)


def test_p1_write_moves_only_artifact_hashes(tmp_path, monkeypatch, capsys):
    manifest_path = _build(tmp_path, "P1", stale=True)
    before = json.loads(manifest_path.read_text(encoding="utf-8"))
    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P1", "--write"],
        collector=_never_collect,
    )
    after = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert (code, summary["change"]) == (0, "changed")
    assert after["tests"] == before["tests"]
    assert after["criteria"] == before["criteria"]
    assert after["artifacts"] == before["artifacts"]
    assert after["fixtures"] == before["fixtures"]
    assert after["phase"] == before["phase"]
    assert after["artifact_hashes"] != before["artifact_hashes"]


def test_collection_timeout_becomes_a_fixed_refusal(tmp_path, monkeypatch):
    captured: dict[str, Path] = {}

    def _timeout(cmd: list[str], **kwargs: object) -> None:
        assert kwargs["timeout"] == refresh_module.COLLECT_TIMEOUT_SECONDS
        basetemp = Path(cmd[cmd.index("--basetemp") + 1])
        captured["scratch"] = basetemp.parent
        # The scratch directory must already exist and be live while the
        # subprocess is (notionally) running, before cleanup happens.
        assert captured["scratch"].is_dir()
        raise subprocess.TimeoutExpired(cmd="pytest", timeout=1)

    monkeypatch.setattr(refresh_module.subprocess, "run", _timeout)
    with pytest.raises(refresh_module.InventoryError) as error:
        refresh_module.discover_live_nodes(tmp_path, (TEST_FILE,))
    assert error.value.code == "collection_timeout"
    # The TemporaryDirectory must be torn down even when subprocess.run
    # raises, not just on the successful-return path.
    assert not captured["scratch"].exists()


def test_scratch_basetemp_and_zoneinfo_are_isolated_siblings_and_cleaned_up(
    tmp_path, monkeypatch
):
    """Prove the Opus repair: --basetemp and PYTHONTZPATH's zoneinfo live
    under one unique, owned scratch directory that is outside the supplied
    repo root, that the expected timezone file is present while the
    subprocess is (notionally) running, that a pre-existing sentinel at
    repo/.pytest-tmp-refresh is left completely untouched, and that the
    scratch directory is gone once discover_live_nodes returns.
    """
    sentinel = tmp_path / ".pytest-tmp-refresh"
    sentinel.write_text("do-not-touch", encoding="utf-8", newline="\n")
    sentinel_before = sentinel.read_bytes()
    captured: dict[str, Path] = {}

    def _inspect(cmd: list[str], **kwargs: object) -> SimpleNamespace:
        basetemp = Path(cmd[cmd.index("--basetemp") + 1])
        zoneinfo = Path(kwargs["env"]["PYTHONTZPATH"])
        scratch = basetemp.parent
        captured["scratch"] = scratch
        # Real argv/env, inspected while the scratch tree is still live.
        assert kwargs["cwd"] == tmp_path
        assert zoneinfo.parent == scratch
        assert basetemp.parent == scratch
        # Outside the supplied repo, not a fixed repo-relative path.
        assert scratch != tmp_path
        assert tmp_path not in scratch.parents
        assert scratch.is_dir()
        assert (zoneinfo / "America" / "New_York").is_file()
        assert kwargs["env"]["KB_PROSPECTING_NO_NETWORK"] == "1"
        return SimpleNamespace(returncode=0, stdout="")

    monkeypatch.setattr(refresh_module.subprocess, "run", _inspect)
    result = refresh_module.discover_live_nodes(tmp_path, (TEST_FILE,))

    assert result == set()
    assert "scratch" in captured
    # Removed after return: no leftover scratch directory anywhere.
    assert not captured["scratch"].exists()
    # The repo's own pre-existing sentinel path is never written to,
    # renamed, or reused as the scratch/basetemp root.
    assert sentinel.read_bytes() == sentinel_before
    assert captured["scratch"] != sentinel


def test_collector_keeps_only_manifested_nonexcluded_nodes(tmp_path, monkeypatch):
    stdout = "\n".join((
        TEST_FILE + "::test_alpha",
        SECOND_FILE + "::test_gamma",
        "scripts/prospecting/tests/test_gate.py::test_45_manifest",
        "scripts/prospecting/tests/test_store.py::test_23_datasette_reads",
        "not a node id",
    )) + "\n"
    monkeypatch.setattr(
        refresh_module.subprocess, "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=stdout),
    )
    assert refresh_module.discover_live_nodes(tmp_path, (TEST_FILE,)) == {
        TEST_FILE + "::test_alpha"
    }


def test_collection_failure_prints_one_fixed_error_line(tmp_path, monkeypatch, capsys):
    manifest_path = _build(tmp_path, "P6", stale=True)
    before = manifest_path.read_bytes()

    def _fail(_root: Path, _files: tuple[str, ...]) -> set[str]:
        raise refresh_module.InventoryError("collection_failed")

    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P6", "--write"], collector=_fail
    )
    assert code == 1
    assert summary == {
        "phase": "P6", "change": "error", "code": "collection_failed", "counts": {}
    }
    assert manifest_path.read_bytes() == before


def test_validation_failure_rejects_without_writing(tmp_path, monkeypatch, capsys):
    manifest_path = _build(tmp_path, "P6", stale=True)
    before = manifest_path.read_bytes()
    monkeypatch.setattr(
        gate_module, "validate_files", lambda root, manifest: ("synthetic refusal",)
    )
    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P6", "--write"], nodes=NODES
    )
    assert code == 1
    assert (summary["change"], summary["code"]) == ("rejected", "validation_failed")
    assert manifest_path.read_bytes() == before


def test_write_failure_is_a_fixed_error(tmp_path, monkeypatch, capsys):
    manifest_path = _build(tmp_path, "P6", stale=True)
    before = manifest_path.read_bytes()

    def _fail(_path: Path, _manifest: dict[str, object]) -> None:
        raise OSError("synthetic write failure")

    monkeypatch.setattr(refresh_module, "_write_manifest", _fail)
    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P6", "--write"], nodes=NODES
    )
    assert code == 1
    assert (summary["change"], summary["code"]) == ("error", "write_failed")
    assert manifest_path.read_bytes() == before


def test_missing_declared_test_file_is_refused(tmp_path, monkeypatch, capsys):
    manifest_path = _build(
        tmp_path, "P6", tests=(*NODES, SECOND_NODE), extra_file=True
    )
    (tmp_path / SECOND_FILE).unlink()
    before = manifest_path.read_bytes()
    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P6", "--write"], nodes=NODES
    )
    assert code == 1
    assert summary["code"] == "missing_artifacts"
    assert manifest_path.read_bytes() == before


def test_dropping_every_node_of_a_declared_file_is_refused(tmp_path, monkeypatch, capsys):
    manifest_path = _build(
        tmp_path, "P6", tests=(*NODES, SECOND_NODE), extra_file=True
    )
    before = manifest_path.read_bytes()
    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P6", "--write"], nodes=NODES
    )
    assert code == 1
    assert summary["code"] == "file_closure_failed"
    assert manifest_path.read_bytes() == before


def test_nodes_outside_declared_files_are_refused(tmp_path, monkeypatch, capsys):
    manifest_path = _build(tmp_path, "P6")
    before = manifest_path.read_bytes()
    code, summary = _run(
        monkeypatch, capsys, tmp_path, ["--phase", "P6", "--write"],
        nodes=(*NODES, SECOND_NODE),
    )
    assert code == 1
    assert summary["code"] == "inventory_expanded"
    assert manifest_path.read_bytes() == before
