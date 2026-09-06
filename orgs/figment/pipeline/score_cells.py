#!/usr/bin/env python3
"""Advisory-only scores for a grading board (Track-2 Task B3).

`score()` never keeps, never culls -- see TENSOR-REPLICATION.md's "Grading protocol":
"Automated similarity numbers may annotate a card, never keep or cull one." Every field on
every row may be `None`; a scorer outage on one image (or on the anchor set as a whole)
degrades that row's numbers, never raises past this module's own boundary.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
IDENTITY = HERE / "train" / "identity_check.py"
AGE_MODEL = "dima806/facial_age_image_detection"   # Apache-2.0 safetensors, r22 §6
FIELDS = ("anchor_cosine", "age_delta_years", "laplacian_variance",
          "clipped_highlight_fraction", "local_luminance_variance")

_AGE_CLASSIFIER: Any = None


def _load_module(path: Path):
    name = f"_score_cells_{path.stem}"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _age_classifier():
    global _AGE_CLASSIFIER
    if _AGE_CLASSIFIER is None:
        from transformers import pipeline

        _AGE_CLASSIFIER = pipeline("image-classification", model=AGE_MODEL)
    return _AGE_CLASSIFIER


def _bucket_midpoint(label: str) -> float:
    """`dima806/facial_age_image_detection`'s labels are single ages ("01"), ranges
    ("21-25"), or an open-ended top bucket ("90+")."""
    label = label.strip()
    if label.endswith("+"):
        return float(label[:-1])
    if "-" in label:
        low, high = label.split("-", 1)
        return (float(low) + float(high)) / 2.0
    return float(label)


def _expected_age(path: Path) -> float:
    from PIL import Image

    classifier = _age_classifier()
    with Image.open(path) as image:
        results = classifier(image.convert("RGB"))
    return sum(_bucket_midpoint(item["label"]) * item["score"] for item in results)


def _mean_embedding(identity, embed, anchors: list) -> list[float] | None:
    """Mean FaceNet embedding over every anchor that embeds cleanly. Never raises --
    `identity._embed_references` already catches a per-anchor failure and simply omits it
    (design finding: score against every reference, not only the first, without one bad
    file blocking the rest); an empty or fully-unreadable anchor list returns `None`."""
    if not anchors:
        return None
    vectors, _errors = identity._embed_references(list(anchors), embed)
    if not vectors:
        return None
    return identity.centroid(list(vectors.values()))


def _mean_age(anchors: list) -> float | None:
    ages: list[float] = []
    for anchor in anchors:
        try:
            ages.append(_expected_age(Path(anchor)))
        except Exception:
            continue
    if not ages:
        return None
    return sum(ages) / len(ages)


def score(images: list[dict], anchors: list, out: Path) -> dict[str, Any]:
    """Score every `images` row against the mean of `anchors`, writing
    `<out>/advisory.json` = `{"schema": "figment/advisory@1", "rows": [...]}` and
    returning the same document. `images` entries need `image_id` and `path`; `anchors`
    is a list of image paths (persona reference / chosen-anchor files)."""
    identity = _load_module(IDENTITY)
    embed = identity.FaceNetEmbedder()
    anchor_vec = _mean_embedding(identity, embed, anchors)
    anchor_age = _mean_age(anchors)
    rows = []
    for item in images:
        row: dict[str, Any] = {"image_id": item["image_id"], "unavailable_reason": None}
        row.update(dict.fromkeys(FIELDS))
        try:
            path = Path(item["path"])
            if anchor_vec is not None:
                row["anchor_cosine"] = identity.cosine(
                    anchor_vec, identity.vector(embed(path)),
                )
            row.update({
                key: value for key, value in identity._raw_metrics_for_image(path).items()
                if key in row
            })
            if anchor_age is not None:
                row["age_delta_years"] = abs(_expected_age(path) - anchor_age)
        except Exception as exc:  # advisory: never fatal
            row["unavailable_reason"] = f"{type(exc).__name__}: {exc}"
        rows.append(row)
    document = {"schema": "figment/advisory@1", "rows": rows}
    Path(out).mkdir(parents=True, exist_ok=True)
    (Path(out) / "advisory.json").write_text(
        json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8",
    )
    return document
