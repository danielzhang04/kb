"""Model-aware persistence for semantic-brain vector indexes."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Iterable, Mapping

import numpy as np

from scripts.brain.chunker import CHUNKER_VERSION, Chunk
from scripts.brain.embedder import Embedder
from scripts.kb_paths import resolve_dashboard_state_path


DEFAULT_INDEX_DIR = ".brain-index"
FORMAT_VERSION = 1


def default_index_dir(
    env: Mapping[str, str] | None = None, *, repo_root: Path | None = None
) -> Path:
    """Return the writable runtime index, retaining the repo-local desktop fallback."""
    root = repo_root if repo_root is not None else Path(__file__).resolve().parents[2]
    resolved = resolve_dashboard_state_path(
        "brain", "index", env=env, fallback=root / DEFAULT_INDEX_DIR
    )
    assert resolved is not None
    return resolved


class IndexFormatError(ValueError):
    """Raised when an index uses an unsupported on-disk format."""


class ModelMismatchError(ValueError):
    """Raised before vectors from different embedding models can be compared."""


@dataclass(frozen=True)
class LoadedIndex:
    vectors: np.ndarray
    ids: np.ndarray
    chunks: list[dict[str, object]]
    manifest: dict[str, object]


def _validate_embedder(manifest: dict[str, object], embedder: Embedder) -> None:
    if manifest["model"] != embedder.model_name or manifest["dim"] != embedder.dim:
        raise ModelMismatchError(
            "Index was built with "
            f"{manifest['model']} ({manifest['dim']} dimensions), but query uses "
            f"{embedder.model_name} ({embedder.dim} dimensions)"
        )
    if (
        not embedder.model_fingerprint
        or manifest.get("model_fingerprint") != embedder.model_fingerprint
    ):
        raise ModelMismatchError(
            "Index model fingerprint is missing or does not match the provisioned query model"
        )


def save(
    out_dir: Path,
    chunks: Iterable[Chunk],
    vectors: np.ndarray,
    *,
    model: str,
    model_fingerprint: str | None,
    dim: int,
    roots: list[str],
) -> None:
    """Write an index with rows aligned across vector, ID, and JSONL files."""
    if not model_fingerprint:
        raise ValueError("cannot build an index without a persisted model fingerprint")
    chunk_list = list(chunks)
    vector_array = np.asarray(vectors, dtype=np.float32)
    if vector_array.ndim != 2 or vector_array.shape != (len(chunk_list), dim):
        raise ValueError(
            f"Expected vectors shaped ({len(chunk_list)}, {dim}), got {vector_array.shape}"
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    ids = np.asarray([chunk.id for chunk in chunk_list], dtype=str)
    np.savez(out_dir / "embeddings.npz", vectors=vector_array, ids=ids)
    with (out_dir / "chunks.jsonl").open("w", encoding="utf-8", newline="\n") as handle:
        for chunk in chunk_list:
            handle.write(json.dumps(chunk.to_dict(), sort_keys=True) + "\n")

    manifest = {
        "format_version": FORMAT_VERSION,
        "model": model,
        "model_fingerprint": model_fingerprint,
        "dim": dim,
        "chunk_count": len(chunk_list),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "roots": roots,
        "metric": "cosine",
        "normalized": True,
        "chunker_version": CHUNKER_VERSION,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def load(out_dir: Path, embedder: Embedder | None = None) -> LoadedIndex:
    """Load an index and reject a model/dimension mismatch when supplied."""
    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("format_version") != FORMAT_VERSION:
        raise IndexFormatError(
            "Unsupported index format version: "
            f"{manifest.get('format_version') if isinstance(manifest, dict) else None!r}"
        )
    with np.load(out_dir / "embeddings.npz", allow_pickle=False) as archive:
        vectors = np.asarray(archive["vectors"], dtype=np.float32)
        ids = archive["ids"]
    with (out_dir / "chunks.jsonl").open(encoding="utf-8") as handle:
        chunks = [json.loads(line) for line in handle if line.strip()]
    if vectors.shape != (manifest["chunk_count"], manifest["dim"]):
        raise ValueError("embeddings.npz shape does not match manifest")
    if len(ids) != len(chunks) or len(chunks) != manifest["chunk_count"]:
        raise ValueError("index row counts do not match")
    if embedder is not None:
        _validate_embedder(manifest, embedder)
    return LoadedIndex(vectors=vectors, ids=ids, chunks=chunks, manifest=manifest)


def search(
    index: LoadedIndex, query_vector: np.ndarray, embedder: Embedder, limit: int = 5
) -> list[dict[str, object]]:
    """Return cosine-ready nearest chunks after enforcing model compatibility."""
    _validate_embedder(index.manifest, embedder)
    query = np.asarray(query_vector, dtype=np.float32).reshape(-1)
    if query.shape[0] != embedder.dim:
        raise ValueError(f"Expected query dimension {embedder.dim}, got {query.shape[0]}")
    scores = index.vectors @ query
    ranked = np.argsort(-scores)[:limit]
    return [{**index.chunks[row], "score": float(scores[row])} for row in ranked]
