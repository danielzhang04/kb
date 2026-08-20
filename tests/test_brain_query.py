from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

import numpy as np
import pytest

from scripts.brain import brain_query, indexer, store
from scripts.brain.chunker import Chunk


MODEL_RUNTIME_READY = (
    (Path.home() / ".cache" / "huggingface" / ".brain-model-ready").exists()
    and importlib.util.find_spec("sentence_transformers") is not None
)


class FakeEmbedder:
    model_name = "fake-model"
    dim = 2
    model_fingerprint = "sha256:fake-model"

    def embed(self, texts: list[str]) -> np.ndarray:
        assert texts == ["find alpha"]
        return np.asarray([[1.0, 0.0]], dtype=np.float32)


class AnyTextEmbedder:
    """Like FakeEmbedder but accepts any query text — used for dash-prefixed-query tests."""

    model_name = "fake-model"
    dim = 2
    model_fingerprint = "sha256:fake-model"

    def embed(self, texts: list[str]) -> np.ndarray:
        return np.asarray([[1.0, 0.0]], dtype=np.float32)


def make_index(tmp_path: Path) -> Path:
    chunks = [
        Chunk("one", "docs/alpha.md", 3, 4, ["Alpha"], "A" * 240),
        Chunk("two", "docs/beta.md", 8, 8, ["Beta", "Details"], "second result"),
    ]
    out_dir = tmp_path / "index"
    store.save(
        out_dir,
        chunks,
        np.asarray([[1.0, 0.0], [0.2, 0.8]], dtype=np.float32),
        model="fake-model",
        model_fingerprint="sha256:fake-model",
        dim=2,
        roots=["docs/**/*.md"],
    )
    return out_dir


def test_query_index_ranks_truncates_and_projects_result_fields(tmp_path: Path) -> None:
    results = brain_query.query_index(make_index(tmp_path), "find alpha", 1, FakeEmbedder())

    assert len(results) == 1
    assert results[0] == {
        "source_path": "docs/alpha.md",
        "heading_path": ["Alpha"],
        "score": 1.0,
        "start_line": 3,
        "end_line": 4,
        # Chunk text is 240 chars; truncated at 200 with a trailing ellipsis marker.
        "snippet": "A" * 200 + "…",
    }


def test_query_index_propagates_missing_index_error(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        brain_query.query_index(tmp_path / "missing", "find alpha", 8, FakeEmbedder())


def test_query_index_propagates_model_mismatch(tmp_path: Path) -> None:
    class WrongEmbedder(FakeEmbedder):
        model_name = "other-model"

    with pytest.raises(store.ModelMismatchError):
        brain_query.query_index(make_index(tmp_path), "find alpha", 8, WrongEmbedder())


def test_cli_reports_missing_index_with_the_documented_exit_code(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(brain_query, "SentenceTransformerEmbedder", FakeEmbedder)
    expected_launcher = "py -3" if os.name == "nt" else "python3"

    assert brain_query.main(["find alpha", "--index", str(tmp_path / "missing")]) == 2
    assert capsys.readouterr().err.strip() == (
        f"index not built — run: {expected_launcher} -m scripts.brain.indexer build"
    )


def test_cli_surfaces_model_mismatch_verbatim(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    class WrongEmbedder(FakeEmbedder):
        model_name = "other-model"

    monkeypatch.setattr(brain_query, "SentenceTransformerEmbedder", WrongEmbedder)
    index_dir = make_index(tmp_path)

    assert brain_query.main(["find alpha", "--index", str(index_dir)]) == 3
    assert capsys.readouterr().err.strip() == (
        "Index was built with fake-model (2 dimensions), but query uses other-model (2 dimensions)"
    )


def test_cli_argparse_errors_exit_with_a_code_distinct_from_index_not_built(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # A mistyped flag must never be confused with exit code 2 ("index not built").
    # argparse's error() raises SystemExit directly (it never returns to main()'s caller).
    with pytest.raises(SystemExit) as excinfo:
        brain_query.main(["find alpha", "--k", "not-a-number"])
    assert excinfo.value.code == 4

    with pytest.raises(SystemExit) as excinfo:
        brain_query.main(["--unknown-flag"])
    assert excinfo.value.code == 4

    err = capsys.readouterr().err
    assert "error" in err.lower()


def test_cli_json_index_not_built_emits_error_object_on_stdout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(brain_query, "SentenceTransformerEmbedder", FakeEmbedder)
    expected_launcher = "py -3" if os.name == "nt" else "python3"

    code = brain_query.main(["find alpha", "--index", str(tmp_path / "missing"), "--json"])

    assert code == 2
    captured = capsys.readouterr()
    assert captured.err.strip() == (
        f"index not built — run: {expected_launcher} -m scripts.brain.indexer build"
    )
    assert json.loads(captured.out) == {"error": "index-not-built"}


def test_cli_json_model_mismatch_emits_error_object_on_stdout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    class WrongEmbedder(FakeEmbedder):
        model_name = "other-model"

    monkeypatch.setattr(brain_query, "SentenceTransformerEmbedder", WrongEmbedder)
    index_dir = make_index(tmp_path)

    code = brain_query.main(["find alpha", "--index", str(index_dir), "--json"])

    assert code == 3
    captured = capsys.readouterr()
    assert captured.err.strip() != ""
    assert json.loads(captured.out) == {"error": "model-mismatch"}


def test_cli_json_success_echoes_manifest_fields(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(brain_query, "SentenceTransformerEmbedder", FakeEmbedder)
    index_dir = make_index(tmp_path)

    code = brain_query.main(["find alpha", "--index", str(index_dir), "--k", "1", "--json"])

    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["model"] == "fake-model"
    assert payload["chunk_count"] == 2
    assert isinstance(payload["created_at"], str) and payload["created_at"]


def test_cli_treats_dash_prefixed_query_as_literal_text_after_separator(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Mirrors the dashboard route's argv shape: flags first, then "--", then the query.
    # Before the fix, "-rf" here would be parsed as an unknown flag (argparse exit 2),
    # indistinguishable from "index not built" (also exit 2).
    monkeypatch.setattr(brain_query, "SentenceTransformerEmbedder", AnyTextEmbedder)
    index_dir = make_index(tmp_path)

    code = brain_query.main(["--k", "1", "--index", str(index_dir), "--json", "--", "-rf"])

    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["query"] == "-rf"


def test_cli_treats_flag_shaped_query_as_literal_text_after_separator(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # A query that merely looks like "--index=C:/evil" must never be reinterpreted as a
    # real --index override once it follows "--".
    monkeypatch.setattr(brain_query, "SentenceTransformerEmbedder", AnyTextEmbedder)
    index_dir = make_index(tmp_path)

    code = brain_query.main(
        ["--k", "1", "--index", str(index_dir), "--json", "--", "--index=C:/evil"]
    )

    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["query"] == "--index=C:/evil"


@pytest.mark.slow
@pytest.mark.skipif(not MODEL_RUNTIME_READY, reason="requires cached sentence-transformers runtime")
def test_golden_query_and_json_cli_return_observability_fixture(tmp_path: Path) -> None:
    fixture_root = Path(__file__).parent / "fixtures" / "brain"
    shutil.copytree(fixture_root, tmp_path, dirs_exist_ok=True)
    from scripts.brain.embedder import SentenceTransformerEmbedder

    index_dir = tmp_path / ".brain-index"
    indexer.build_index(tmp_path, index_dir, SentenceTransformerEmbedder())

    # Semantic rather than verbatim: the fixture says alerts arrive before a deployment.
    query = "how can I make sure alerts reach us before a release"
    result = subprocess.run(
        ["py", "-3", "-m", "scripts.brain.brain_query", query, "--k", "3", "--index", str(index_dir), "--json"],
        cwd=Path(__file__).parents[1],
        env=os.environ.copy(),
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["query"] == query
    assert any(row["source_path"] == "docs/observability.md" for row in payload["results"])
    assert isinstance(payload["chunk_count"], int) and payload["chunk_count"] >= len(payload["results"])
    assert isinstance(payload["model"], str) and payload["model"]
    assert isinstance(payload["created_at"], str) and payload["created_at"]


@pytest.mark.slow
@pytest.mark.skipif(not MODEL_RUNTIME_READY, reason="requires cached sentence-transformers runtime")
def test_golden_dash_leading_query_via_routes_argv_shape_never_hits_usage_error(tmp_path: Path) -> None:
    """Real end-to-end proof of the fix: the dashboard route's exact argv shape

    (flags, then "--", then the possibly dash-leading query) must reach the model and
    return a normal result — never argparse's usage-error path.
    """
    fixture_root = Path(__file__).parent / "fixtures" / "brain"
    shutil.copytree(fixture_root, tmp_path, dirs_exist_ok=True)
    from scripts.brain.embedder import SentenceTransformerEmbedder

    index_dir = tmp_path / ".brain-index"
    indexer.build_index(tmp_path, index_dir, SentenceTransformerEmbedder())

    result = subprocess.run(
        [
            "py", "-3", "-m", "scripts.brain.brain_query",
            "--k", "3", "--index", str(index_dir), "--json", "--", "-rf",
        ],
        cwd=Path(__file__).parents[1],
        env=os.environ.copy(),
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["query"] == "-rf"
