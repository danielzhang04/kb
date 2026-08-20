from dataclasses import dataclass
import json
from pathlib import Path

import numpy as np
import pytest

from scripts.brain.chunker import Chunk
from scripts.brain import store


@dataclass
class FakeEmbedder:
    model_name: str = "fake-v1"
    dim: int = 3
    model_fingerprint: str = "sha256:fake-v1"

    def embed(self, texts: list[str]) -> np.ndarray:
        return np.zeros((len(texts), self.dim), dtype=np.float32)


def test_default_index_dir_uses_dashboard_state_root(tmp_path: Path) -> None:
    assert store.default_index_dir({"DASHBOARD_STATE_ROOT": str(tmp_path)}) == tmp_path / "brain" / "index"


def test_default_index_dir_retains_repo_local_desktop_fallback(tmp_path: Path) -> None:
    assert store.default_index_dir({}, repo_root=tmp_path) == tmp_path / store.DEFAULT_INDEX_DIR


def test_store_roundtrip(tmp_path: Path) -> None:
    chunks = [
        Chunk("one", "memory/a.md", 1, 1, ["A"], "first"),
        Chunk("two", "docs/b.md", 3, 3, [], "second"),
    ]
    vectors = np.array([[1, 0, 0], [0, 1, 0]], dtype=np.float32)

    store.save(
        tmp_path, chunks, vectors, model="fake-v1", model_fingerprint="sha256:fake-v1",
        dim=3, roots=["memory/**/*.md"],
    )
    loaded = store.load(tmp_path, FakeEmbedder())

    assert (tmp_path / "embeddings.npz").is_file()
    assert (tmp_path / "chunks.jsonl").is_file()
    assert loaded.manifest["format_version"] == 1
    assert loaded.manifest["model_fingerprint"] == "sha256:fake-v1"
    assert loaded.manifest["chunk_count"] == 2
    assert loaded.manifest["metric"] == "cosine"
    assert loaded.manifest["normalized"] is True
    assert loaded.manifest["chunker_version"] == 2
    assert loaded.ids.tolist() == ["one", "two"]
    assert np.array_equal(loaded.vectors, vectors)
    assert loaded.chunks[1]["source_path"] == "docs/b.md"


def test_store_rejects_cross_model_query(tmp_path: Path) -> None:
    chunk = Chunk("one", "memory/a.md", 1, 1, [], "first")
    store.save(
        tmp_path,
        [chunk],
        np.array([[1, 0, 0]], dtype=np.float32),
        model="fake-v1",
        model_fingerprint="sha256:fake-v1",
        dim=3,
        roots=[],
    )

    with pytest.raises(store.ModelMismatchError):
        store.load(tmp_path, FakeEmbedder(model_name="fake-v2"))


def test_store_rejects_same_dimension_model_with_different_fingerprint(tmp_path: Path) -> None:
    chunk = Chunk("one", "memory/a.md", 1, 1, [], "first")
    store.save(
        tmp_path,
        [chunk],
        np.array([[1, 0, 0]], dtype=np.float32),
        model="fake-v1",
        model_fingerprint="sha256:weights-a",
        dim=3,
        roots=[],
    )

    with pytest.raises(store.ModelMismatchError, match="fingerprint"):
        store.load(
            tmp_path,
            FakeEmbedder(model_name="fake-v1", dim=3, model_fingerprint="sha256:weights-b"),
        )


def test_store_rejects_unsupported_format_version(tmp_path: Path) -> None:
    chunk = Chunk("one", "memory/a.md", 1, 1, [], "first")
    store.save(
        tmp_path,
        [chunk],
        np.array([[1, 0, 0]], dtype=np.float32),
        model="fake-v1",
        model_fingerprint="sha256:fake-v1",
        dim=3,
        roots=[],
    )
    manifest_path = tmp_path / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.pop("format_version")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(store.IndexFormatError):
        store.load(tmp_path)
