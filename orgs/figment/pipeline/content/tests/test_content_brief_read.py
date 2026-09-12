from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from orgs.figment.pipeline.content import content_brief as compiler
from orgs.figment.pipeline.content import content_brief_read as reader


PYTHON = str(Path(sys.executable).resolve())
REPO_ROOT = Path(__file__).resolve().parents[5]
REFUSAL = "content brief revalidation refused\n"
STATIC_CONTENT_FILES = ("taxonomy.yaml", "carousel-templates.yaml", "reel-templates.yaml")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _tree_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


def _root(tmp_path: Path) -> Path:
    root = tmp_path / "brief-root"
    persona = root / "personas" / "creator-001"
    anchors = persona / "anchors"
    anchors.mkdir(parents=True)
    # The compiler hashes this synthetic canonical-reference byte payload.
    (anchors / "g01.jpg").write_bytes(b"synthetic-canonical-anchor-bytes")
    (persona / "persona.yaml").write_text(json.dumps({
        "id": "creator-001", "identity": {"references": ["anchors/g01.jpg"]},
    }), encoding="utf-8")
    return root


def _request() -> dict[str, object]:
    return {
        "schema": "figment/content-brief-request@1",
        "brief_date": "2026-09-12",
        "creator": {
            "id": "creator-001",
            "persona_path": "personas/creator-001/persona.yaml",
            "canonical_reference": "anchors/g01.jpg",
        },
        "surface": "carousel",
        "template_id": "CT-2",
        "asset_slots": [
            {"taxonomy_type": "A", "kind": "persona"},
            {"taxonomy_type": "A", "kind": "persona"},
        ],
        "sources": [{"citation": "https://example.test/research", "observed_date": "2026-09-11"}],
        "hypothesis": "A synthetic fixture has a bounded local hypothesis.",
        "intended_metric": "saves per reached account",
        "observed_metrics": None,
    }


def _compiled_pair(tmp_path: Path) -> tuple[Path, str, str]:
    root = _root(tmp_path)
    request = "inputs/request.json"
    brief = "outputs/brief.json"
    (root / request).parent.mkdir(parents=True)
    (root / brief).parent.mkdir(parents=True)
    (root / request).write_text(json.dumps(_request()), encoding="utf-8")
    compiler.build_content_brief(root, request, brief)
    return root, request, brief


def _run_module(root: Path, request: str, brief: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            PYTHON, "-B", "-m", "orgs.figment.pipeline.content.content_brief_read",
            "--root", str(root), "--request", request, "--brief", brief,
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )


def _copied_direct_script(tmp_path: Path) -> Path:
    copied = tmp_path / "copied-reader"
    copied.mkdir()
    authority_dir = Path(compiler.__file__).resolve().parent
    shutil.copyfile(Path(reader.__file__).resolve(), copied / "content_brief_read.py")
    shutil.copyfile(authority_dir / "content_brief.py", copied / "content_brief.py")
    for name in STATIC_CONTENT_FILES:
        source = authority_dir / name
        assert source.is_file(), f"missing authoritative static compiler input: {name}"
        shutil.copyfile(source, copied / name)
    return copied / "content_brief_read.py"


def _run_direct(script: Path, root: Path, request: str, brief: str) -> subprocess.CompletedProcess[str]:
    # Deliberately omit -B: direct-script startup must suppress dependency bytecode itself.
    child_env = dict(os.environ)
    child_env.pop("PYTHONDONTWRITEBYTECODE", None)
    return subprocess.run(
        [PYTHON, str(script), "--root", str(root), "--request", request, "--brief", brief],
        cwd=script.parent,
        capture_output=True,
        text=True,
        check=False,
        env=child_env,
        timeout=30,
    )


def _assert_exact_projection(stdout: str, root: Path, request: str, brief: str) -> None:
    result = json.loads(stdout)
    assert set(result) == {"schema", "request_sha256", "brief_sha256"}
    assert result == {
        "schema": "figment/content-brief-revalidation@1",
        "request_sha256": _sha(root / request),
        "brief_sha256": _sha(root / brief),
    }


def test_projection_calls_the_sole_validator_once_and_never_writes(tmp_path: Path, monkeypatch):
    root, request, brief = _compiled_pair(tmp_path)
    real_validator = compiler.revalidate_content_brief
    calls: list[tuple[Path, str, str]] = []

    def counted_validator(actual_root: Path, actual_request: str, actual_brief: str):
        calls.append((actual_root, actual_request, actual_brief))
        return real_validator(actual_root, actual_request, actual_brief)

    monkeypatch.setattr(reader, "briefs", SimpleNamespace(revalidate_content_brief=counted_validator))
    before = _tree_bytes(root)

    projection = reader.revalidate_content_brief_projection(root, request, brief)

    assert calls == [(root, request, brief)]
    assert projection == {
        "schema": "figment/content-brief-revalidation@1",
        "request_sha256": _sha(root / request),
        "brief_sha256": _sha(root / brief),
    }
    assert _tree_bytes(root) == before


def test_package_cli_reads_real_compiler_pair_with_explicit_python(tmp_path: Path):
    root, request, brief = _compiled_pair(tmp_path)
    before = _tree_bytes(root)

    completed = _run_module(root, request, brief)

    assert completed.returncode == 0
    assert completed.stderr == ""
    _assert_exact_projection(completed.stdout, root, request, brief)
    assert _tree_bytes(root) == before


@pytest.mark.parametrize("failure", ["missing", "tampered", "stale"])
def test_direct_cli_refuses_missing_tampered_or_stale_pair_without_mutating_fixture(
    tmp_path: Path, failure: str,
):
    root, request, brief = _compiled_pair(tmp_path)
    script = _copied_direct_script(tmp_path)
    if failure == "missing":
        (root / brief).unlink()
    elif failure == "tampered":
        (root / brief).write_bytes((root / brief).read_bytes() + b"\nfixture-tamper")
    else:
        persona = root / "personas" / "creator-001" / "persona.yaml"
        persona.write_text(json.dumps({
            "id": "creator-001", "identity": {"references": ["anchors/g01.jpg"]},
            "fixture_stale_dependency": True,
        }), encoding="utf-8")
    before = _tree_bytes(root)
    copied_before = _tree_bytes(script.parent)

    completed = _run_direct(script, root, request, brief)

    assert completed.returncode == 2
    assert completed.stdout == ""
    assert completed.stderr == REFUSAL
    assert _tree_bytes(root) == before
    assert _tree_bytes(script.parent) == copied_before
    assert not list(script.parent.rglob("__pycache__"))


def test_direct_cli_projects_real_pair_without_dependency_bytecode_or_file_mutation(tmp_path: Path):
    root, request, brief = _compiled_pair(tmp_path)
    script = _copied_direct_script(tmp_path)
    before = _tree_bytes(root)
    copied_before = _tree_bytes(script.parent)

    completed = _run_direct(script, root, request, brief)

    assert completed.returncode == 0
    assert completed.stderr == ""
    _assert_exact_projection(completed.stdout, root, request, brief)
    assert _tree_bytes(root) == before
    assert _tree_bytes(script.parent) == copied_before
    assert not list(script.parent.rglob("__pycache__"))


def test_cli_routes_root_relative_confinement_to_existing_authority(tmp_path: Path):
    root, _request_path, brief = _compiled_pair(tmp_path)
    before = _tree_bytes(root)

    completed = _run_module(root, "../outside-request.json", brief)

    assert completed.returncode == 2
    assert completed.stdout == ""
    assert completed.stderr == REFUSAL
    assert _tree_bytes(root) == before


@pytest.mark.parametrize("arguments", [
    ["--root", "ROOT", "--request", "request.json", "--brief", "brief.json", "--build", "PRIVATE-ARGV-SENTINEL"],
    ["--root", "ROOT", "--request", "request.json"],
])
def test_main_refuses_unsupported_or_incomplete_arguments_without_echoing_them(
    tmp_path: Path, capsys, arguments: list[str],
):
    root, _request_path, _brief = _compiled_pair(tmp_path)
    argv = [str(root) if item == "ROOT" else item for item in arguments]

    assert reader.main(argv) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == REFUSAL
    assert "PRIVATE-ARGV-SENTINEL" not in captured.err
    assert str(root) not in captured.err
    assert "Traceback" not in captured.err


@pytest.mark.parametrize("failure_type", [OSError, RuntimeError])
def test_main_hides_unexpected_ordinary_authority_failures(
    tmp_path: Path, monkeypatch, capsys, failure_type,
):
    root, request, brief = _compiled_pair(tmp_path)
    sentinel = f"private-authority-detail {root}"

    def unexpected(*_args, **_kwargs):
        raise failure_type(sentinel)

    monkeypatch.setattr(reader, "revalidate_content_brief_projection", unexpected)

    assert reader.main(["--root", str(root), "--request", request, "--brief", brief]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == REFUSAL
    assert sentinel not in captured.err
    assert str(root) not in captured.err


def test_malformed_authority_proof_refuses_before_any_stdout(tmp_path: Path, monkeypatch, capsys):
    root, request, brief = _compiled_pair(tmp_path)
    calls = 0

    def malformed(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return {"request": {"sha256": "a" * 64}, "brief": {}}

    monkeypatch.setattr(reader, "briefs", SimpleNamespace(revalidate_content_brief=malformed))

    assert reader.main(["--root", str(root), "--request", request, "--brief", brief]) == 2
    captured = capsys.readouterr()
    assert calls == 1
    assert captured.out == ""
    assert captured.err == REFUSAL
