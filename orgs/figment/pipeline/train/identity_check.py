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
        "cell_id": str | null,               # allocation cell_id, resolved from the
                                                # batch's own cell list when running in
                                                # --persona/--batch mode (None in legacy
                                                # --anchor/--images mode, or when no
                                                # unambiguous cell_id match exists) —
                                                # see _resolve_cell_id. batch_state.py's
                                                # apply CLI joins on cell_id first,
                                                # image_id only as a fallback, so this
                                                # closes the join-key mismatch between
                                                # the harness's on-disk image name
                                                # (persona-short-code-prefixed, e.g.
                                                # "c001-exp02-s001") and batch.json's
                                                # own cell_id ("exp02-s001").
        "face_detected": bool,
        "face_cosine": float | null,        # cosine to the PRIMARY anchor (references[0]
                                              # / the legacy --anchor), unchanged for
                                              # backward compatibility
        "anchor_cosines": {str: float | null},  # cosine to EVERY persona reference,
                                              # keyed by its stem ("g01", "g02", "g07");
                                              # expansion-03 design §6 risk 2 fix — a
                                              # --persona/--batch --raw-only run no
                                              # longer scores only references[0]
        "anchor_cosine_max": float | null,   # max of anchor_cosines' values
        "anchor_cosine_own": float | null,   # anchor_cosines[own_anchor], or null when
                                              # own_anchor is null
        "anchor_cosine": float | null,       # alias of anchor_cosine_max
        "own_anchor": str | null,            # the reference this cell was generated
                                              # from, resolved via _load_batch_cell_anchors
                                              # from the cell's own "anchor"/"source_anchor"
                                              # field (null when the batch carries neither
                                              # field — e.g. every expansion-02 cell)
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

  `--out` normally names an output DIRECTORY (`identity_report.json` is written
  inside it) — legacy behavior, unchanged. When `--raw-only` is given and `--out`
  itself ends in `.json`, that path is treated as the report FILE to write directly
  (parent directories created as needed), not as a directory to create — Task 7 step
  7.5 passes `--out .../scores.json` and expects that literal file, not a directory
  named `scores.json`.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import re
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


def _embed_references(
    references: list[Path], face_embedder: Callable[[Path], Any]
) -> tuple[dict[str, list[float]], dict[str, str]]:
    """Embed every persona reference anchor once, keyed by its stem (`g01`, `g02`,
    `g07`, ...). Never raises — a reference whose embedding fails is simply absent
    from the returned vectors dict, with its error recorded separately (design
    finding: expansion-03 §6 risk 2 fix must score against every reference, not
    only `references[0]`, without a single bad reference file blocking the rest)."""
    vectors: dict[str, list[float]] = {}
    errors: dict[str, str] = {}
    for reference in references:
        stem = Path(reference).stem
        try:
            vectors[stem] = vector(face_embedder(reference))
        except Exception as exc:
            errors[stem] = f"{type(exc).__name__}: {exc}"
    return vectors, errors


def _resolve_cell_id(image_id: str, cell_ids: list[str]) -> str | None:
    """Best-effort, deterministic mapping from a harvested image's on-disk id (the
    pod harness's own `output_name`, e.g. `"c001-exp02-s001"` — see
    `build_expansion_set.py`'s `output_name = f"{{persona_short_code}}-{{cell_id}}"`)
    back to the allocation's own `cell_id` (`"exp02-s001"`). Matches by exact equality
    first, then by suffix (`"<anything>-<cell_id>"`) against `cell_ids` — the batch's
    own known cell list — never by hardcoding a persona-specific prefix, so this works
    for any short code. Returns `None` (never raises) when no `cell_id` matches or
    more than one does, so an ambiguous or absent join is left unresolved rather than
    guessed at."""
    if image_id in cell_ids:
        return image_id
    matches = [cid for cid in cell_ids if image_id.endswith("-" + cid)]
    if len(matches) == 1:
        return matches[0]
    # Mechanism-suffixed output names (expansion-03 arm A: `<short>-<cell_id>-mechA`)
    # are joined by stripping one trailing `-mech<letter>` token and retrying.
    stripped = re.sub(r"-mech[A-Za-z]$", "", image_id)
    if stripped != image_id:
        return _resolve_cell_id(stripped, cell_ids)
    return None


def _evaluate_raw_only(
    anchor: Path,
    image_dir: Path,
    out_dir: Path,
    images: list[Path],
    face_embedder: Callable[[Path], Any],
    dino_embedder: Callable[[Path], Any],
    *,
    cell_ids: list[str] | None = None,
    references: list[Path] | None = None,
    cell_anchors: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    """Raw-only mode (design finding 24): per-image observations, never a verdict.
    Never writes `rulings.json`; the word "pass" never appears anywhere in the
    output — raw scores must never look like, or be mistaken for, a routing verdict.

    expansion-03 design §6 risk 2/6 fix: `references` (defaulting to `[anchor]` when
    omitted, so every pre-existing caller keeps its single-anchor shape) is scored
    per-image against EVERY entry, not only `anchor` — see `anchor_cosines` /
    `anchor_cosine_max` / `anchor_cosine_own` on each row below."""
    reference_paths = list(references) if references else [anchor]
    reference_faces, reference_errors = _embed_references(reference_paths, face_embedder)
    primary_stem = Path(anchor).stem
    anchor_face = reference_faces.get(primary_stem)
    anchor_error: str | None = reference_errors.get(primary_stem)

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

        cell_id = _resolve_cell_id(path.stem, cell_ids) if cell_ids else None

        # expansion-03 design §6 risk 2 fix: score against EVERY reference, not
        # only the primary anchor. `anchor_cosines` always carries a key for every
        # reference (null where the image or that reference's own embedding is
        # unavailable) so a partial-failure reference never silently disappears.
        anchor_cosines: dict[str, float | None] = {
            stem: None for stem in reference_faces.keys() | reference_errors.keys()
        }
        if face_detected:
            for stem, ref_vector in reference_faces.items():
                try:
                    anchor_cosines[stem] = cosine(ref_vector, face_vectors[path])
                except IdentityCheckError:
                    anchor_cosines[stem] = None
        valid_anchor_cosines = [v for v in anchor_cosines.values() if v is not None]
        anchor_cosine_max = max(valid_anchor_cosines) if valid_anchor_cosines else None

        own_anchor = cell_anchors.get(cell_id) if cell_anchors and cell_id else None
        anchor_cosine_own = anchor_cosines.get(own_anchor) if own_anchor is not None else None

        rows.append({
            "image_id": path.stem,
            "path": path.name,
            "cell_id": cell_id,
            "face_detected": face_detected,
            "face_cosine": face_cosine_value,
            "anchor_cosines": anchor_cosines,
            "anchor_cosine_max": anchor_cosine_max,
            "anchor_cosine_own": anchor_cosine_own,
            "anchor_cosine": anchor_cosine_max,
            "own_anchor": own_anchor,
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
    _write_raw_only_report(out_dir, report)
    return report


def _write_raw_only_report(out: Path, report: dict[str, Any]) -> None:
    """Write the raw-only report to `out`. When `out` ends in `.json` it names the
    report FILE directly — its parent directories are created, but `out` itself is
    never treated as a directory to create (design finding 1: Task 7 step 7.5 passes
    `--out .../scores.json` and expects that literal file, not a directory named
    `scores.json`). Any other `out` keeps the legacy directory behavior: the
    directory is created and `identity_report.json` is written inside it."""
    out = Path(out)
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if out.suffix.lower() == ".json":
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
    else:
        out.mkdir(parents=True, exist_ok=True)
        (out / "identity_report.json").write_text(text, encoding="utf-8")


def evaluate(
    anchor: Path,
    image_dir: Path,
    out_dir: Path,
    face_embedder: Callable[[Path], Any],
    dino_embedder: Callable[[Path], Any],
    *,
    raw_only: bool = False,
    cell_ids: list[str] | None = None,
    references: list[Path] | None = None,
    cell_anchors: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    images = sorted(
        path for path in image_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES and path.resolve() != anchor.resolve()
    )
    if not images:
        raise IdentityCheckError("image directory contains no candidate images")
    if raw_only:
        return _evaluate_raw_only(
            anchor, image_dir, out_dir, images, face_embedder, dino_embedder,
            cell_ids=cell_ids, references=references, cell_anchors=cell_anchors,
        )
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


def _load_batch_cell_ids(batch_path: Path) -> list[str]:
    """Read `batch.json`'s own `cell_id` list, for `_resolve_cell_id` to join
    against. Never raises on a malformed/partial document — an empty list simply
    means no cell_id resolution is possible, and rows fall back to `cell_id: null`."""
    try:
        data = json.loads(Path(batch_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    cells = data.get("cells") if isinstance(data, dict) else None
    if not isinstance(cells, list):
        return []
    return [
        cell["cell_id"] for cell in cells
        if isinstance(cell, dict) and cell.get("cell_id")
    ]


def _load_batch_cell_anchors(batch_path: Path) -> dict[str, str | None]:
    """Read `batch.json`'s own `cells` list and resolve each cell's OWN anchor
    identifier — expansion-03 design §6 risk 2/6: `identity_check.py --raw-only`
    must be able to record `anchor_cosine_own` against the anchor a cell was
    actually generated from, not only the max over every reference.

    Checked in order per cell: an `"anchor"` field, then a `"source_anchor"` field
    (both plain strings expected to match a reference's stem, e.g. `"g01"`). Neither
    field exists on expansion-02's own cells (`build_expansion_set.py`'s
    `generate_allocation` never writes one) — every value here is `None` for that
    batch, and `_evaluate_raw_only` falls back to `anchor_cosine_max` accordingly,
    exactly as the design's blocking-defect note requires. Never raises on a
    malformed/partial document — an empty dict simply means no own-anchor
    resolution is possible."""
    try:
        data = json.loads(Path(batch_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    cells = data.get("cells") if isinstance(data, dict) else None
    if not isinstance(cells, list):
        return {}
    result: dict[str, str | None] = {}
    for cell in cells:
        if not isinstance(cell, dict) or not cell.get("cell_id"):
            continue
        value = cell.get("anchor")
        if not isinstance(value, str) or not value.strip():
            value = cell.get("source_anchor")
        if not isinstance(value, str) or not value.strip():
            value = None
        result[cell["cell_id"]] = value
    return result


def _load_persona_references(persona_path: Path) -> list[Path]:
    """Every `persona.identity.references` entry, resolved to an absolute path in
    persona-declared order (`g01`, `g02`, `g07`, ...) — the full reference set
    `--raw-only` scores each image against (expansion-03 design §6 risk 2 fix),
    as opposed to `resolve_scoring_inputs`'s single `references[0]` anchor."""
    persona = _load_persona_for_scoring(persona_path)
    persona_dir = Path(persona_path).resolve().parent
    return [(persona_dir / reference).resolve() for reference in persona["identity"]["references"]]


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


# ---------------------------------------------------------------------------
# calibrate-anchors — expansion-03 design §3 "zero-cost calibration": pairwise
# face cosine among a persona's own reference anchors, at $0, before any pod spend.
# ---------------------------------------------------------------------------


def build_calibrate_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="identity_check.py calibrate-anchors",
        description=(
            "Pairwise face cosine among persona.identity.references (design "
            "§3's zero-cost calibration) — writes identity.calibration onto "
            "persona.yaml and prints each pair plus a suggested floor."
        ),
    )
    parser.add_argument("--persona", type=Path, required=True)
    return parser


def _find_matching_close_brace(text: str, open_index: int) -> int:
    """Index of the `}` that closes the `{` at `open_index`, string/escape-aware
    (so a `}` inside a JSON string value is never mistaken for structure)."""
    depth = 0
    in_string = False
    escape = False
    i = open_index
    while i < len(text):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
        else:
            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    raise IdentityCheckError("unbalanced braces while locating a JSON object in persona.yaml")


def _reindent_json_block(json_text: str, indent: str) -> str:
    """`json_text` is a `json.dumps(..., indent=2)` object literal, starting with
    `{` and ending with `}`. Reindent every line after the first by `indent`, so
    the block can be spliced in right after `"key": ` at that indent level without
    disturbing any other line in the file."""
    lines = json_text.splitlines()
    return "\n".join([lines[0]] + [indent + line for line in lines[1:]])


def _write_calibration_block(persona_path: Path, calibration: dict[str, Any]) -> None:
    """Write `identity.calibration` onto `persona.yaml` as a targeted text splice —
    never a full-document re-serialize — so every other byte of the file (in
    particular `identity.spec.sha256` / `register.spec.sha256`, which persona.py's
    loader verifies against the live spec file digest, and every array's existing
    inline-vs-multiline style) is left untouched. Idempotent: a second run replaces
    the previously-written `identity.calibration` value in place rather than
    appending a duplicate key.

    `persona.yaml` is JSON-compatible YAML (persona.py's own module docstring;
    creator-001's file is literal JSON on disk) — this reads/writes it as text,
    locating the `identity` object (and, if present, its existing `calibration`
    key) by brace-matching on the raw source rather than re-dumping the parsed
    document. Same temp-file-then-`os.replace` atomicity as every other writer in
    this tree (`build_expansion_set.py`'s `_atomic_write_json`), so the document is
    never observed half-written."""
    import os

    persona_path = Path(persona_path)
    text = persona_path.read_text(encoding="utf-8")

    if "\n" not in text:
        # Defensive fallback for a hand-authored compact single-line document —
        # every real persona.yaml in this repo is pretty-printed, so the splice
        # path above is what actually runs in production; this just avoids ever
        # corrupting an unusual input rather than silently mis-slicing it.
        data = json.loads(text)
        data.setdefault("identity", {})["calibration"] = calibration
        new_text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        tmp = persona_path.with_name(persona_path.name + ".tmp")
        try:
            tmp.write_text(new_text, encoding="utf-8")
            os.replace(tmp, persona_path)
        finally:
            if tmp.exists():
                try:
                    tmp.unlink()
                except OSError:
                    pass
        return

    identity_match = re.search(r'"identity"\s*:\s*\{', text)
    if identity_match is None:
        raise IdentityCheckError('persona.yaml has no top-level "identity" object')
    identity_open = identity_match.end() - 1
    identity_close = _find_matching_close_brace(text, identity_open)

    calibration_json = json.dumps(calibration, indent=2, ensure_ascii=False)

    existing_calibration_match = re.search(
        r'"calibration"\s*:\s*\{', text[identity_open:identity_close]
    )
    if existing_calibration_match is not None:
        # Re-run: replace the existing identity.calibration value in place.
        cal_open = identity_open + existing_calibration_match.end() - 1
        cal_close = _find_matching_close_brace(text, cal_open)
        key_line_start = text.rfind("\n", 0, identity_open + existing_calibration_match.start()) + 1
        key_indent = text[key_line_start:identity_open + existing_calibration_match.start()]
        # json.dumps already bakes in the +2-per-level indent for every line after
        # the first, so the splice base is the "calibration" key's OWN indent — not
        # key_indent + 2, which would double that first level (the bug this
        # function's idempotent-rerun test caught).
        block = _reindent_json_block(calibration_json, key_indent)
        new_text = text[:cal_open] + block + text[cal_close + 1:]
    else:
        # First run: append "calibration" as a new sibling key inside "identity".
        close_line_start = text.rfind("\n", 0, identity_close) + 1
        closing_indent = text[close_line_start:identity_close]
        child_indent = closing_indent + "  "
        block = _reindent_json_block(calibration_json, child_indent)
        entry = f'{child_indent}"calibration": {block}'

        inner = text[identity_open + 1:identity_close]
        if inner.strip():
            prefix = text[:close_line_start]
            insert_point = len(prefix.rstrip())
            trailing_ws = prefix[insert_point:]
            new_text = text[:insert_point] + ",\n" + entry + trailing_ws + text[close_line_start:]
        else:
            new_text = (
                text[:identity_open + 1] + "\n" + entry + "\n" + closing_indent
                + text[identity_close:]
            )

    tmp = persona_path.with_name(persona_path.name + ".tmp")
    try:
        tmp.write_text(new_text, encoding="utf-8")
        os.replace(tmp, persona_path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def calibrate_anchors(
    persona_path: Path, face_embedder: Callable[[Path], Any]
) -> dict[str, Any]:
    """Compute the pairwise face cosine between every pair of a persona's own
    reference anchors (design §3: "score each anchor against the other two ...
    at $0, and either confirms 0.75 or moves it before any pod spend"). Writes the
    result onto `persona.yaml` under `identity.calibration` (see
    `_write_calibration_block`) and returns the same document:

        {
          "anchor_pairwise": {"g01:g02": float, "g01:g07": float, "g02:g07": float},
          "anchor_cosine_floor_suggested": float | null,  # min pairwise - 0.05
          "errors": {stem: str} | null,                   # per-reference embedder
                                                            # failures, if any
        }

    `anchor_cosine_floor_suggested` is `null` only when every pairwise comparison
    failed (no reference embedded, or fewer than two did) — never a fabricated
    number. Raises `IdentityCheckError` when the persona has fewer than two
    reference anchors, since a pairwise comparison is undefined below that."""
    persona_path = Path(persona_path)
    persona = _load_persona_for_scoring(persona_path)
    references = persona["identity"]["references"]
    if len(references) < 2:
        raise IdentityCheckError(
            "calibrate-anchors needs at least two reference anchors to compare "
            f"pairwise, persona.identity.references has {len(references)}"
        )

    persona_dir = persona_path.resolve().parent
    resolved = [(persona_dir / reference).resolve() for reference in references]
    vectors, errors = _embed_references(resolved, face_embedder)
    stems = [Path(reference).stem for reference in references]

    pairwise: dict[str, float] = {}
    for i, left in enumerate(stems):
        for right in stems[i + 1:]:
            if left in vectors and right in vectors:
                pairwise[f"{left}:{right}"] = cosine(vectors[left], vectors[right])

    values = list(pairwise.values())
    floor_suggested = (min(values) - 0.05) if values else None

    calibration = {
        "anchor_pairwise": pairwise,
        "anchor_cosine_floor_suggested": floor_suggested,
        "errors": errors or None,
    }
    _write_calibration_block(persona_path, calibration)
    return calibration


def _cli_calibrate_anchors(argv: list[str]) -> int:
    args = build_calibrate_parser().parse_args(argv)
    try:
        calibration = calibrate_anchors(args.persona, FaceNetEmbedder())
    except (IdentityCheckError, OSError, ValueError) as exc:
        print(f"identity-check error: {exc}", file=sys.stderr)
        return 2
    for pair, value in calibration["anchor_pairwise"].items():
        print(f"{pair}: {value:.4f}")
    floor = calibration["anchor_cosine_floor_suggested"]
    if floor is not None:
        print(f"anchor_cosine_floor_suggested: {floor:.4f}")
    if calibration["errors"]:
        print(f"reference embedding errors: {calibration['errors']}", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["calibrate-anchors"]:
        return _cli_calibrate_anchors(argv[1:])

    args = build_parser().parse_args(argv)
    try:
        anchor, image_dir = resolve_scoring_inputs(args)
        cell_ids = _load_batch_cell_ids(args.batch) if args.batch is not None else None
        cell_anchors = _load_batch_cell_anchors(args.batch) if args.batch is not None else None
        references = _load_persona_references(args.persona) if args.persona is not None else None
        report = evaluate(
            anchor, image_dir, args.out, FaceNetEmbedder(), DinoV2Embedder(),
            raw_only=args.raw_only, cell_ids=cell_ids,
            references=references, cell_anchors=cell_anchors,
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
