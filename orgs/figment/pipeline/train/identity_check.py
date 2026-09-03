"""Fail-closed face-reference and DINOv2 cohesion check for an identity set.

Two modes:

* **Legacy** (`--anchor`/`--images`, the default `evaluate(..., raw_only=False)`):
  robust-threshold pass/fail per image, `identity_report.json` + `rulings.json`.
  Unchanged — existing callers (e.g. the training dataset path) keep working exactly
  as before.
* **Raw-only** (`--raw-only`, `evaluate(..., raw_only=True)`, required for
  expansion-02 — design finding 24): writes per-image RAW OBSERVATIONS ONLY, never a
  pass/fail verdict and never `rulings.json`. Automated scores never route a cell's
  lifecycle; the sole automated quarantine is the deterministic no-face case, decided
  downstream by `pipeline/expand/batch_state.py`, never here. Each image's row is::

      {
        "image_id": str, "path": str,
        "face_detected": bool,
        "face_cosine": float | null,        # cosine to the anchor face, if both embedded
        "dinov2_cohesion": float | null,     # cosine to the training-set DINOv2 centroid
        "metrics": {                          # compute_raw_metrics() — always present,
          "laplacian_variance": float | null,        # never inferred, never omitted
          "clipped_highlight_fraction": float | null,
          "local_luminance_variance": float | null,
          "unavailable_reason": str | null    # non-null iff any metric above is null
        },
        "unavailable_reason": str | null      # non-null iff face_detected is false, or
                                                # the anchor/embedder itself was unavailable
      }

  Input may be given either the legacy way (`--anchor`/`--images`) or, mutually
  exclusive with it, as `--persona <persona.yaml> --batch <batch.json>` — which
  resolves the anchor from `persona.identity.references[0]` and the image directory
  from the batch directory's `images/` subdirectory (the canonical harvested-image
  location, design §2.3).
"""

from __future__ import annotations

import argparse
import importlib.util
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


_LAPLACIAN_KERNEL = ((0.0, 1.0, 0.0), (1.0, -4.0, 1.0), (0.0, 1.0, 0.0))
_LOCAL_VARIANCE_TILE = 16
_MIN_CROP_SIDE_PX = 3


def compute_raw_metrics(face_crop_rgb: Any) -> dict[str, Any]:
    """Three raw, un-thresholded observations on a detected face crop (design step
    1.4). Pillow-image-or-numpy-array input; Pillow + numpy only, no new heavy
    dependency. Never returns a pass/fail — raw observations only (design finding 24).

    * `laplacian_variance` — `float(numpy.var(...))` of the crop convolved (edge-
      padded) with the discrete 3x3 Laplacian kernel `[[0,1,0],[1,-4,1],[0,1,0]]`;
      the standard blur-detection statistic — low variance means a blurry crop.
    * `clipped_highlight_fraction` — fraction (0.0-1.0) of grayscale pixels at or
      above 250/255.
    * `local_luminance_variance` — the crop split into 16x16 tiles, each tile's
      `numpy.var`, then the mean of those per-tile variances.

    Returns all three as `None` with a populated `unavailable_reason` only when the
    crop is degenerately small (fewer than 3px on a side) — otherwise
    `unavailable_reason` is `None` and every metric is a real float.
    """
    import numpy as np

    array = np.asarray(face_crop_rgb)
    if array.ndim == 3:
        # Rec. 601 luma weights — the same coefficients PIL's own "L" (grayscale)
        # conversion uses, so this matches what a human would see as brightness.
        gray = (
            0.299 * array[..., 0].astype(np.float64)
            + 0.587 * array[..., 1].astype(np.float64)
            + 0.114 * array[..., 2].astype(np.float64)
        )
    elif array.ndim == 2:
        gray = array.astype(np.float64)
    else:
        raise IdentityCheckError(
            f"compute_raw_metrics expects a 2D or 3D array, got shape {array.shape}"
        )

    height, width = gray.shape
    if height < _MIN_CROP_SIDE_PX or width < _MIN_CROP_SIDE_PX:
        return {
            "laplacian_variance": None,
            "clipped_highlight_fraction": None,
            "local_luminance_variance": None,
            "unavailable_reason": (
                f"face crop too small to compute raw metrics "
                f"({width}x{height}px, minimum {_MIN_CROP_SIDE_PX}px on a side)"
            ),
        }

    padded = np.pad(gray, 1, mode="edge")
    conv = np.zeros_like(gray)
    for i in range(3):
        for j in range(3):
            weight = _LAPLACIAN_KERNEL[i][j]
            if weight:
                conv += weight * padded[i:i + height, j:j + width]
    laplacian_variance = float(np.var(conv))

    clipped_highlight_fraction = float(np.mean(gray >= 250.0))

    tile = _LOCAL_VARIANCE_TILE
    tile_variances = [
        float(np.var(gray[y0:y0 + tile, x0:x0 + tile]))
        for y0 in range(0, height, tile)
        for x0 in range(0, width, tile)
    ]
    local_luminance_variance = float(np.mean(tile_variances)) if tile_variances else 0.0

    return {
        "laplacian_variance": laplacian_variance,
        "clipped_highlight_fraction": clipped_highlight_fraction,
        "local_luminance_variance": local_luminance_variance,
        "unavailable_reason": None,
    }


def _raw_metrics_for_image(path: Path) -> dict[str, Any]:
    """Load `path` and compute its raw metrics. P1 wires `compute_raw_metrics` on the
    whole loaded frame — there is no dedicated face-cropper in this tree yet (the
    embedders above return a vector, not a crop); a real crop-extraction pass is
    future work tracked alongside the scorer calibration gate. `compute_raw_metrics`
    itself is fully general over any RGB array, crop or full frame."""
    from PIL import Image

    with Image.open(path) as image:
        array = _np_array_from_image(image.convert("RGB"))
    return compute_raw_metrics(array)


def _np_array_from_image(image: Any) -> Any:
    import numpy as np

    return np.array(image)


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


def _evaluate_raw_only(
    anchor: Path,
    image_dir: Path,
    out_dir: Path,
    images: list[Path],
    face_embedder: Callable[[Path], Any],
    dino_embedder: Callable[[Path], Any],
) -> dict[str, Any]:
    """Raw-only mode (design finding 24): per-image observations, never a verdict.
    Never writes `rulings.json`; the word "pass" never appears anywhere in the
    output — raw scores must never look like, or be mistaken for, a routing verdict."""
    try:
        anchor_face = vector(face_embedder(anchor))
        anchor_error: str | None = None
    except Exception as exc:
        anchor_face = None
        anchor_error = f"{type(exc).__name__}: {exc}"

    face_vectors: dict[Path, list[float]] = {}
    face_errors: dict[Path, str] = {}
    dino_vectors: dict[Path, list[float]] = {}
    for path in images:
        try:
            face_vectors[path] = vector(face_embedder(path))
        except Exception as exc:
            face_errors[path] = f"{type(exc).__name__}: {exc}"
        try:
            dino_vectors[path] = vector(dino_embedder(path))
        except Exception:
            pass  # reported per-image below via a null dinov2_cohesion

    dino_cohesion: dict[Path, float] = {}
    if dino_vectors:
        try:
            center = centroid(list(dino_vectors.values()))
            dino_cohesion = {path: cosine(center, embedding) for path, embedding in dino_vectors.items()}
        except IdentityCheckError:
            dino_cohesion = {}

    rows = []
    for path in images:
        face_detected = path in face_vectors
        face_cosine_value = None
        if face_detected and anchor_face is not None:
            try:
                face_cosine_value = cosine(anchor_face, face_vectors[path])
            except IdentityCheckError:
                face_cosine_value = None

        if face_detected:
            metrics = _raw_metrics_for_image(path)
        else:
            metrics = {
                "laplacian_variance": None,
                "clipped_highlight_fraction": None,
                "local_luminance_variance": None,
                "unavailable_reason": "no face detected",
            }

        if not face_detected:
            reason = face_errors.get(path, "no face detected")
        elif anchor_face is None:
            reason = f"anchor face embedding unavailable: {anchor_error}"
        else:
            reason = None

        rows.append({
            "image_id": path.stem,
            "path": path.name,
            "face_detected": face_detected,
            "face_cosine": face_cosine_value,
            "dinov2_cohesion": dino_cohesion.get(path),
            "metrics": metrics,
            "unavailable_reason": reason,
        })

    report = {
        "mode": "raw-only",
        "anchor": str(anchor),
        "training_set": str(image_dir),
        "anchor_error": anchor_error,
        "fail_closed": False,  # raw-only never fails a cell closed or open — it never routes
        "models": {
            "face": {"implementation": "facenet-pytorch InceptionResnetV1", "license": FACENET_LICENSE},
            "cohesion": {"implementation": "DINOv2 ViT-S/14", "license": DINOV2_LICENSE},
        },
        "summary": {"total": len(rows)},
        "images": rows,
    }
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "identity_report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return report


def evaluate(
    anchor: Path,
    image_dir: Path,
    out_dir: Path,
    face_embedder: Callable[[Path], Any],
    dino_embedder: Callable[[Path], Any],
    *,
    raw_only: bool = False,
) -> dict[str, Any]:
    images = sorted(
        path for path in image_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES and path.resolve() != anchor.resolve()
    )
    if not images:
        raise IdentityCheckError("image directory contains no candidate images")
    if raw_only:
        return _evaluate_raw_only(anchor, image_dir, out_dir, images, face_embedder, dino_embedder)
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
    parser.add_argument("--anchor", type=Path, help="legacy mode: a single anchor image")
    parser.add_argument("--images", type=Path, help="legacy mode: directory of candidate images")
    parser.add_argument(
        "--persona", type=Path,
        help="persona/batch mode: persona.yaml — anchor resolves to identity.references[0]",
    )
    parser.add_argument(
        "--batch", type=Path,
        help="persona/batch mode: batch.json — images resolve to its sibling images/ directory",
    )
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--raw-only", action="store_true",
        help="write raw per-image observations only (no rulings.json, no pass/fail) — "
             "required for expansion-02, design finding 24",
    )
    return parser


def _load_persona_for_scoring(persona_path: Path) -> dict:
    """Load `persona.py` by path (no package `__init__.py` exists in this tree — every
    module here is loaded ad hoc) and return the validated persona document."""
    name = "_figment_identity_check_persona"
    if name in sys.modules:
        persona_module = sys.modules[name]
    else:
        module_path = Path(__file__).resolve().parents[1] / "persona.py"
        spec = importlib.util.spec_from_file_location(name, module_path)
        if spec is None or spec.loader is None:  # pragma: no cover - defensive
            raise IdentityCheckError(f"could not load persona.py from {module_path}")
        persona_module = importlib.util.module_from_spec(spec)
        sys.modules[name] = persona_module
        spec.loader.exec_module(persona_module)
    return persona_module.load_persona(Path(persona_path))


def resolve_scoring_inputs(args: argparse.Namespace) -> tuple[Path, Path]:
    """Resolve `(anchor, image_dir)` from either input mode. The two modes are
    mutually exclusive; exactly one complete pair must be given."""
    legacy_given = args.anchor is not None or args.images is not None
    persona_given = args.persona is not None or args.batch is not None

    if legacy_given and persona_given:
        raise IdentityCheckError(
            "--anchor/--images and --persona/--batch are mutually exclusive input modes"
        )
    if not legacy_given and not persona_given:
        raise IdentityCheckError(
            "provide either --anchor and --images (legacy), or --persona and --batch"
        )

    if legacy_given:
        if args.anchor is None or args.images is None:
            raise IdentityCheckError("--anchor and --images must be given together")
        return args.anchor, args.images

    if args.persona is None or args.batch is None:
        raise IdentityCheckError("--persona and --batch must be given together")
    persona = _load_persona_for_scoring(args.persona)
    references = persona["identity"]["references"]
    anchor = (Path(args.persona).resolve().parent / references[0]).resolve()
    image_dir = Path(args.batch).resolve().parent / "images"
    return anchor, image_dir


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        anchor, image_dir = resolve_scoring_inputs(args)
        report = evaluate(
            anchor, image_dir, args.out, FaceNetEmbedder(), DinoV2Embedder(), raw_only=args.raw_only
        )
        if args.raw_only:
            print(f"identity check (raw-only): {report['summary']['total']} image(s) scored")
            return 0
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
