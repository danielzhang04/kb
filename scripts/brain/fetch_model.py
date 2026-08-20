"""Explicit one-time downloader for the semantic brain embedding model."""

from __future__ import annotations

import json
import os
from pathlib import Path
from scripts.brain.embedder import (
    FINGERPRINT_FILENAME,
    MODEL_NAME,
    provisioned_model_dir,
    provisioned_model_fingerprint,
)


DESKTOP_SENTINEL = Path.home() / ".cache" / "huggingface" / ".brain-model-ready"


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

    target = provisioned_model_dir()
    model = SentenceTransformer(
        MODEL_NAME,
        local_files_only=False,
        **({"cache_folder": str(target.parent / "download-cache")} if target is not None else {}),
    )
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    if target is None:
        SentenceTransformer(MODEL_NAME, local_files_only=True)
        DESKTOP_SENTINEL.parent.mkdir(parents=True, exist_ok=True)
        DESKTOP_SENTINEL.touch()
        print(f"Model ready: {MODEL_NAME}")
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        model.save(str(target))
        SentenceTransformer(str(target), local_files_only=True)
        (target / ".ready").touch()
        fingerprint = provisioned_model_fingerprint(target)
        (target / FINGERPRINT_FILENAME).write_text(
            json.dumps(fingerprint, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(f"Model ready: {MODEL_NAME} at {target} ({fingerprint['sha256']})")


if __name__ == "__main__":
    main()
