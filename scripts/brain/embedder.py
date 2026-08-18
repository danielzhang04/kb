"""Local, swappable embedding implementations."""

from __future__ import annotations

import os
from typing import Protocol, Sequence

# Indexing is deliberately offline by default.  These must be hard-set; the
# already-imported module constants are additionally patched (see _patch_offline_constants
# below) because Hugging Face freezes its constant at import time, and sentence-transformers'
# AutoProcessor path does not propagate local_files_only.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import numpy as np


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

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        """Return one normalized float32 vector per input text."""


class SentenceTransformerEmbedder:
    """Embedding adapter for a locally cached sentence-transformers model."""

    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> None:
        # Patch offline constants before sentence_transformers (and transitively torch) load.
        _patch_offline_constants()
        # Delayed import keeps the deterministic unit suite independent of this optional package.
        from sentence_transformers import SentenceTransformer

        self.model_name = model_name
        self.dim = 384
        self._model = SentenceTransformer(model_name, local_files_only=True)

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
