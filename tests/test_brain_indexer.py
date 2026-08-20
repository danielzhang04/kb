from pathlib import Path
import importlib.util
import json
import shutil
import os
import subprocess
import sys

import numpy as np
import pytest

from scripts.brain import brain_query, indexer, store
from scripts.brain.embedder import (
    FINGERPRINT_FILENAME,
    provisioned_model_dir,
    provisioned_model_fingerprint,
    read_provisioned_model_fingerprint,
)


MODEL_RUNTIME_READY = (
    (Path.home() / ".cache" / "huggingface" / ".brain-model-ready").exists()
    and importlib.util.find_spec("sentence_transformers") is not None
)


def test_provisioned_model_uses_dashboard_state_root(tmp_path: Path) -> None:
    assert provisioned_model_dir({"DASHBOARD_STATE_ROOT": str(tmp_path)}) == tmp_path / "brain" / "model"
    assert provisioned_model_dir({}) is None


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_persisted_model_fingerprint_pins_same_size_weight_contents(tmp_path: Path) -> None:
    model = tmp_path / "model"
    _write(model / "config.json", '{"hidden_size":384}\n')
    weights = model / "model.safetensors"
    weights.write_bytes(b"weights-a")
    first = provisioned_model_fingerprint(model)
    (model / FINGERPRINT_FILENAME).write_text(
        json.dumps(first, sort_keys=True), encoding="utf-8"
    )
    assert first["files"] == ["config.json", "model.safetensors"]
    assert read_provisioned_model_fingerprint(model) == first["sha256"]

    class ModelEmbedder:
        model_name = "fake-model"
        dim = 2

        def __init__(self, fingerprint: str | None) -> None:
            self.model_fingerprint = fingerprint

        def embed(self, texts: list[str]) -> np.ndarray:
            return np.zeros((len(texts), self.dim), dtype=np.float32)

    repo = tmp_path / "repo"
    _write(repo / "docs" / "note.md", "# Note\n\nPinned model.\n")
    out = tmp_path / "index"
    original = ModelEmbedder(read_provisioned_model_fingerprint(model))
    indexer.build_index(repo, out, original)
    assert store.load(out, original).manifest["model_fingerprint"] == first["sha256"]

    weights.write_bytes(b"weights-b")
    assert weights.stat().st_size == len(b"weights-a")
    # Query-time reads stay cheap and do not re-hash the 90MB weight set.
    assert read_provisioned_model_fingerprint(model) == first["sha256"]
    second = provisioned_model_fingerprint(model)
    assert second["sha256"] != first["sha256"]
    (model / FINGERPRINT_FILENAME).write_text(
        json.dumps(second, sort_keys=True), encoding="utf-8"
    )
    with pytest.raises(store.ModelMismatchError, match="fingerprint"):
        store.load(out, ModelEmbedder(read_provisioned_model_fingerprint(model)))

    (model / FINGERPRINT_FILENAME).unlink()
    with pytest.raises(store.ModelMismatchError, match="fingerprint"):
        store.load(out, ModelEmbedder(read_provisioned_model_fingerprint(model)))


def test_discover_files_uses_only_configured_roots(tmp_path: Path) -> None:
    _write(tmp_path / "memory" / "note.md", "memory")
    _write(tmp_path / "handoffs" / "old.md", "handoff")
    _write(tmp_path / "docs" / "nested" / "guide.md", "docs")
    _write(tmp_path / "docs" / ".private" / "skip.md", "skip")
    _write(tmp_path / "orgs" / "alpha" / "STATE.md", "state")
    _write(tmp_path / "orgs" / "alpha" / "other.md", "excluded")
    _write(tmp_path / "other.md", "excluded")

    found = indexer.discover_files(tmp_path)

    assert [path.relative_to(tmp_path).as_posix() for path in found] == [
        "docs/nested/guide.md",
        "handoffs/old.md",
        "memory/note.md",
        "orgs/alpha/STATE.md",
    ]


def test_embed_input_includes_heading_context_without_mutating_chunk() -> None:
    from scripts.brain.chunker import Chunk

    chunk = Chunk("one", "docs/title.md", 3, 3, ["Title", "Section"], "body only")

    assert indexer._embed_input(chunk) == "Title > Section\n\nbody only"
    assert chunk.text == "body only"


def test_cli_default_out_is_relative_to_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("DASHBOARD_STATE_ROOT", raising=False)
    calls: list[tuple[Path, Path]] = []

    class FakeEmbedder:
        model_name = "fake"
        dim = 3

    def fake_build(root: Path, out: Path, embedder: FakeEmbedder) -> indexer.IndexStats:
        calls.append((root, out))
        return indexer.IndexStats(files=0, chunks=0, seconds=0)

    monkeypatch.setattr(indexer, "SentenceTransformerEmbedder", FakeEmbedder)
    monkeypatch.setattr(indexer, "build_index", fake_build)

    assert indexer.main(["build", "--root", str(tmp_path)]) == 0
    assert calls == [(tmp_path, tmp_path / store.DEFAULT_INDEX_DIR)]


def test_cli_default_out_uses_dashboard_state_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    state_root = tmp_path / "state"
    calls: list[tuple[Path, Path]] = []

    class FakeEmbedder:
        model_name = "fake"
        dim = 3

    monkeypatch.setenv("DASHBOARD_STATE_ROOT", str(state_root))
    monkeypatch.setattr(indexer, "SentenceTransformerEmbedder", FakeEmbedder)
    monkeypatch.setattr(
        indexer,
        "build_index",
        lambda root, out, _embedder: calls.append((root, out)) or indexer.IndexStats(0, 0, 0),
    )

    assert indexer.main(["build", "--root", str(tmp_path)]) == 0
    assert calls == [(tmp_path, state_root / "brain" / "index")]
    assert brain_query._default_index_dir() == state_root / "brain" / "index"


def test_build_and_query_retain_the_same_repo_local_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DASHBOARD_STATE_ROOT", raising=False)
    repo_root = Path(__file__).resolve().parents[1]
    calls: list[tuple[Path, Path]] = []

    class FakeEmbedder:
        model_name = "fake"
        dim = 3

    monkeypatch.setattr(indexer, "SentenceTransformerEmbedder", FakeEmbedder)
    monkeypatch.setattr(
        indexer,
        "build_index",
        lambda root, out, _embedder: calls.append((root, out)) or indexer.IndexStats(0, 0, 0),
    )

    assert indexer.main(["build", "--root", str(repo_root)]) == 0
    assert calls == [(repo_root, brain_query._default_index_dir())]


@pytest.mark.slow
@pytest.mark.skipif(not MODEL_RUNTIME_READY, reason="requires cached sentence-transformers runtime")
def test_embedder_forces_offline_after_sentence_transformers_is_imported() -> None:
    code = """
import socket
import sentence_transformers
from scripts.brain.embedder import SentenceTransformerEmbedder

attempts = []
def offline(*args, **kwargs):
    attempts.append((args, kwargs))
    raise OSError('network disabled')

socket.getaddrinfo = offline
socket.create_connection = offline
socket.socket.connect = offline
embedder = SentenceTransformerEmbedder()
vectors = embedder.embed(['offline embedding regression'])
assert vectors.shape == (1, 384)
assert not attempts, attempts
"""
    env = os.environ.copy()
    env["HF_HUB_OFFLINE"] = "0"
    env["TRANSFORMERS_OFFLINE"] = "0"
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).parents[1],
        env=env,
        text=True,
        capture_output=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.slow
@pytest.mark.skipif(not MODEL_RUNTIME_READY, reason="requires cached sentence-transformers runtime")
def test_build_index_roundtrip(tmp_path: Path) -> None:
    fixture_root = Path(__file__).parent / "fixtures" / "brain"
    shutil.copytree(fixture_root, tmp_path, dirs_exist_ok=True)
    from scripts.brain.embedder import SentenceTransformerEmbedder

    embedder = SentenceTransformerEmbedder()
    stats = indexer.build_index(tmp_path, tmp_path / ".brain-index", embedder)
    loaded = store.load(tmp_path / ".brain-index", embedder)

    assert stats.files == 3
    assert stats.chunks == len(loaded.chunks)
    assert loaded.vectors.dtype == np.float32
    assert loaded.vectors.shape == (stats.chunks, 384)
    assert {path.name for path in (tmp_path / ".brain-index").iterdir()} == {
        "chunks.jsonl",
        "embeddings.npz",
        "manifest.json",
    }
    query = embedder.embed(["zephyr beacon observability protocol"])[0]
    result = store.search(loaded, query, embedder, limit=1)
    assert result[0]["source_path"] == "docs/observability.md"
