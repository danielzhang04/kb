"""Explicit one-time downloader for the semantic brain embedding model."""

from __future__ import annotations

import os
from pathlib import Path


MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
SENTINEL = Path.home() / ".cache" / "huggingface" / ".brain-model-ready"


def main() -> None:
    # This is deliberately the one place that may contact Hugging Face.
    os.environ.pop("HF_HUB_OFFLINE", None)
    os.environ.pop("TRANSFORMERS_OFFLINE", None)
    # Undo embedder's in-process hard overrides if this is invoked programmatically.
    import huggingface_hub.constants as huggingface_constants
    import transformers.utils.hub as transformers_hub

    huggingface_constants.HF_HUB_OFFLINE = False
    transformers_hub._is_offline_mode = False
    from sentence_transformers import SentenceTransformer

    SentenceTransformer(MODEL_NAME, local_files_only=False)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    SentenceTransformer(MODEL_NAME, local_files_only=True)
    SENTINEL.parent.mkdir(parents=True, exist_ok=True)
    SENTINEL.touch()
    print(f"Model ready: {MODEL_NAME}")


if __name__ == "__main__":
    main()
