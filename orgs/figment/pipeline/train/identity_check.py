"""Fail-closed face-reference and DINOv2 cohesion check for an identity set."""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path
from typing import Any, Callable, Iterable


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
FACENET_LICENSE = "https://github.com/timesler/facenet-pytorch/blob/master/LICENSE.md"
DINOV2_LICENSE = "https://github.com/facebookresearch/dinov2/blob/main/LICENSE"


class IdentityCheckError(ValueError):
    pass


def vector(value: Any) -> list[float]:
    if hasattr(value, "detach"):
        value = value.detach().cpu().flatten().tolist()
    elif hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, list) and value and isinstance(value[0], list):
        value = value[0]
    if not isinstance(value, (list, tuple)) or not value:
        raise IdentityCheckError("embedder returned no vector")
    result = [float(item) for item in value]
    if not all(math.isfinite(item) for item in result):
        raise IdentityCheckError("embedder returned a non-finite vector")
    return result


def cosine(left: Iterable[float], right: Iterable[float]) -> float:
    a, b = list(left), list(right)
    if len(a) != len(b) or not a:
        raise IdentityCheckError("embedding dimensions do not match")
    denom = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    if denom == 0:
        raise IdentityCheckError("zero-norm embedding")
    return sum(x * y for x, y in zip(a, b)) / denom


def robust_floor(values: list[float]) -> float | None:
    if len(values) < 3:
        return None
    median = statistics.median(values)
    mad = statistics.median(abs(item - median) for item in values)
    return max(-1.0, min(1.0, median - 2.0 * mad))


def centroid(vectors: list[list[float]]) -> list[float]:
    if not vectors:
        raise IdentityCheckError("cannot compute an empty centroid")
    width = len(vectors[0])
    if any(len(item) != width for item in vectors):
        raise IdentityCheckError("DINOv2 embedding dimensions do not match")
    return [sum(item[column] for item in vectors) / len(vectors) for column in range(width)]


class FaceNetEmbedder:
    """Lazy facenet-pytorch wrapper; constructing it may fetch upstream weights."""

    def __init__(self) -> None:
        from facenet_pytorch import InceptionResnetV1, MTCNN
        import torch

        self.torch = torch
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.detector = MTCNN(image_size=160, margin=16, device=self.device)
        self.model = InceptionResnetV1(pretrained="vggface2").eval().to(self.device)

    def __call__(self, path: Path) -> list[float]:
        from PIL import Image

        with Image.open(path) as image:
            face = self.detector(image.convert("RGB"))
        if face is None:
            raise IdentityCheckError("no face detected")
        with self.torch.no_grad():
            embedding = self.model(face.unsqueeze(0).to(self.device))
        return vector(embedding)


class DinoV2Embedder:
    """Lazy Apache-2.0 DINOv2 wrapper; constructing it may use torch.hub."""

    def __init__(self) -> None:
        import torch
        from torchvision import transforms

        self.torch = torch
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14").eval().to(self.device)
        self.transform = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)
            ),
        ])

    def __call__(self, path: Path) -> list[float]:
        from PIL import Image

        with Image.open(path) as image:
            batch = self.transform(image.convert("RGB")).unsqueeze(0).to(self.device)
        with self.torch.no_grad():
            embedding = self.model(batch)
        return vector(embedding)


def evaluate(
    anchor: Path,
    image_dir: Path,
    out_dir: Path,
    face_embedder: Callable[[Path], Any],
    dino_embedder: Callable[[Path], Any],
) -> dict[str, Any]:
    images = sorted(
        path for path in image_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES and path.resolve() != anchor.resolve()
    )
    if not images:
        raise IdentityCheckError("image directory contains no candidate images")
    failures: dict[Path, list[str]] = {path: [] for path in images}
    try:
        anchor_face = vector(face_embedder(anchor))
    except Exception as exc:
        anchor_face = None
        anchor_error = f"{type(exc).__name__}: {exc}"
    else:
        anchor_error = None

    face_vectors: dict[Path, list[float]] = {}
    dino_vectors: dict[Path, list[float]] = {}
    for path in images:
        try:
            face_vectors[path] = vector(face_embedder(path))
        except Exception as exc:
            failures[path].append(f"face embedding unavailable: {type(exc).__name__}: {exc}")
        try:
            dino_vectors[path] = vector(dino_embedder(path))
        except Exception as exc:
            failures[path].append(f"DINOv2 embedding unavailable: {type(exc).__name__}: {exc}")

    face_scores: dict[Path, float] = {}
    if anchor_face is not None:
        for path, embedding in face_vectors.items():
            try:
                face_scores[path] = cosine(anchor_face, embedding)
            except IdentityCheckError as exc:
                failures[path].append(f"face comparison failed: {exc}")
    else:
        for path in images:
            failures[path].append("anchor face embedding unavailable")

    dino_scores: dict[Path, float] = {}
    if len(dino_vectors) >= 3:
        try:
            center = centroid(list(dino_vectors.values()))
            dino_scores = {path: cosine(center, embedding) for path, embedding in dino_vectors.items()}
        except IdentityCheckError as exc:
            for path in images:
                failures[path].append(f"DINOv2 cohesion failed: {exc}")
    else:
        for path in images:
            failures[path].append("fewer than three valid DINOv2 embeddings")

    face_threshold = robust_floor(list(face_scores.values()))
    dino_threshold = robust_floor(list(dino_scores.values()))
    if face_threshold is None:
        for path in images:
            failures[path].append("fewer than three valid face similarities; threshold unavailable")
    if dino_threshold is None:
        for path in images:
            failures[path].append("fewer than three valid DINOv2 scores; threshold unavailable")

    rows = []
    rulings = []
    for path in images:
        face_score = face_scores.get(path)
        dino_score = dino_scores.get(path)
        reasons = list(failures[path])
        if face_threshold is not None and (face_score is None or face_score < face_threshold):
            reasons.append("face cosine below training-set median - 2*MAD")
        if dino_threshold is not None and (dino_score is None or dino_score < dino_threshold):
            reasons.append("DINOv2 cohesion below training-set median - 2*MAD")
        passed = not reasons
        rows.append({
            "image_id": path.stem,
            "path": path.name,
            "face_cosine": face_score,
            "dinov2_cohesion": dino_score,
            "pass": passed,
            "reasons": reasons,
        })
        ruling = {"image_id": path.stem, "identity": "pass" if passed else "hard-fail"}
        if reasons:
            ruling["why"] = "; ".join(reasons)
        rulings.append(ruling)

    report = {
        "anchor": str(anchor),
        "training_set": str(image_dir),
        "threshold_rule": "median - 2*MAD, computed independently per metric from valid training-set scores",
        "thresholds": {"face_cosine": face_threshold, "dinov2_cohesion": dino_threshold},
        "anchor_error": anchor_error,
        "fail_closed": True,
        "models": {
            "face": {"implementation": "facenet-pytorch InceptionResnetV1", "license": FACENET_LICENSE},
            "cohesion": {"implementation": "DINOv2 ViT-S/14", "license": DINOV2_LICENSE},
        },
        "summary": {
            "total": len(rows),
            "passed": sum(1 for row in rows if row["pass"]),
            "failed": sum(1 for row in rows if not row["pass"]),
        },
        "images": rows,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "identity_report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (out_dir / "rulings.json").write_text(
        json.dumps(rulings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--anchor", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        report = evaluate(args.anchor, args.images, args.out, FaceNetEmbedder(), DinoV2Embedder())
        print(
            f"identity check: {report['summary']['passed']} passed, "
            f"{report['summary']['failed']} failed"
        )
        return 0 if report["summary"]["failed"] == 0 else 1
    except (IdentityCheckError, OSError, ValueError) as exc:
        print(f"identity-check error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
