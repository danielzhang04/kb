"""Local, swappable embedding implementations."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Mapping, Protocol, Sequence

# Indexing is deliberately offline by default.  These must be hard-set; the
# already-imported module constants are additionally patched (see _patch_offline_constants
# below) because Hugging Face freezes its constant at import time, and sentence-transformers'
# AutoProcessor path does not propagate local_files_only.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import numpy as np

from scripts.kb_paths import resolve_dashboard_state_path


MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
FINGERPRINT_FILENAME = "fingerprint.json"
_WEIGHT_SUFFIXES = {".safetensors", ".bin", ".pt", ".pth", ".onnx"}


def provisioned_model_dir(env: Mapping[str, str] | None = None) -> Path | None:
    """Use daemon-owned state on the VM; desktop callers may keep the normal HF cache."""
    return resolve_dashboard_state_path("brain", "model", env=env)


def provisioned_model_fingerprint(model_dir: Path) -> dict[str, str | list[str]]:
    """Hash the paths and bytes of every saved-model config and weights file."""
    configs: list[Path] = []
    weights: list[Path] = []
    for candidate in sorted(model_dir.rglob("*")):
        if not candidate.is_file():
            continue
        lower = candidate.name.lower()
        if candidate.suffix.lower() == ".json" and ("config" in lower or lower == "modules.json"):
            configs.append(candidate)
        elif candidate.suffix.lower() in _WEIGHT_SUFFIXES:
            weights.append(candidate)
    if not configs or not weights:
        raise ValueError("provisioned model lacks fingerprintable config or weights files")

    files = sorted(
        (path.relative_to(model_dir).as_posix() for path in (*configs, *weights))
    )
    digest = hashlib.sha256()
    for relative in files:
        candidate = model_dir / Path(relative)
        path_bytes = relative.encode("utf-8")
        size = candidate.stat().st_size
        # Length framing makes this an unambiguous encoding of the sorted
        # (relative path, file bytes) tuples.
        digest.update(len(path_bytes).to_bytes(8, "big"))
        digest.update(path_bytes)
        digest.update(size.to_bytes(8, "big"))
        with candidate.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    return {"sha256": "sha256:" + digest.hexdigest(), "files": files}


def read_provisioned_model_fingerprint(model_dir: Path) -> str | None:
    """Read the provisioning-time digest without touching model weight files."""
    try:
        payload = json.loads(
            (model_dir / FINGERPRINT_FILENAME).read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or set(payload) != {"sha256", "files"}:
        return None
    sha256 = payload.get("sha256")
    files = payload.get("files")
    if (
        not isinstance(sha256, str)
        or not sha256.startswith("sha256:")
        or len(sha256) != 71
        or any(char not in "0123456789abcdef" for char in sha256[7:])
        or not isinstance(files, list)
        or not files
        or any(not isinstance(path, str) or not path for path in files)
        or files != sorted(set(files))
    ):
        return None
    return sha256


def registry_model_fingerprint(model_name: str) -> str:
    """Stable desktop fallback when no explicitly provisioned model directory exists."""
    return "registry:" + hashlib.sha256(model_name.encode("utf-8")).hexdigest()


def _patch_offline_constants() -> None:
    """Patch already-imported huggingface_hub/transformers offline constants.

    Deferred out of module scope so importing this module never eagerly drags in
    transformers/torch; only constructing a SentenceTransformerEmbedder does.
    """
    try:
        import huggingface_hub.constants as _huggingface_constants
        import transformers.utils.hub as _transformers_hub
    except ImportError:
        # Keep non-embedding callers dependency-free; __init__ still requires the package.
        return
    _huggingface_constants.HF_HUB_OFFLINE = True
    _transformers_hub._is_offline_mode = True


class Embedder(Protocol):
    model_name: str
    dim: int
    model_fingerprint: str | None

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        """Return one normalized float32 vector per input text."""


class SentenceTransformerEmbedder:
    """Embedding adapter for a locally cached sentence-transformers model."""

    def __init__(self, model_name: str = MODEL_NAME) -> None:
        # Patch offline constants before sentence_transformers (and transitively torch) load.
        _patch_offline_constants()
        # Delayed import keeps the deterministic unit suite independent of this optional package.
        from sentence_transformers import SentenceTransformer

        self.model_name = model_name
        self.dim = 384
        provisioned = provisioned_model_dir()
        source = str(provisioned) if provisioned is not None else model_name
        self._model = SentenceTransformer(source, local_files_only=True)
        self.model_fingerprint = (
            read_provisioned_model_fingerprint(provisioned)
            if provisioned is not None
            else registry_model_fingerprint(model_name)
        )

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        vectors = self._model.encode(
            list(texts), normalize_embeddings=True, show_progress_bar=False
        )
        result = np.asarray(vectors, dtype=np.float32)
        if result.ndim != 2 or result.shape[1] != self.dim:
            raise ValueError(
                f"Expected embeddings with dimension {self.dim}, got {result.shape}"
            )
        return result
