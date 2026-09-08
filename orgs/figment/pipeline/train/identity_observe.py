#!/usr/bin/env python3
"""Write bounded local face observations from pre-admitted YuNet and SFace pins.

This is deliberately separate from ``identity_check.py``.  It emits detector
confidence, five landmarks, and raw candidate-to-anchor cosine observations; it
does not emit embeddings, a verdict, a threshold, or a promotion claim.  The
checked-in pin manifest starts pending independent review, so this CLI refuses
to create a runtime session until a later explicit admission changes it.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import importlib.metadata
import json
import math
import os
import re
import stat
from pathlib import Path
from typing import Any


SCHEMA = "figment/identity-observation@1"
FIXED640_SCHEMA = "figment/identity-observation@2"
FIXED640_PREPROCESSING = "fixed-max-edge-640@1"
PIN_SCHEMA = "figment/identity-observer-pins@1"
PIN_MANIFEST = Path(__file__).with_name("identity_observe_pins.json")
MAX_PIN_BYTES = 64 * 1024
MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_PIXELS = 16_777_216
MAX_ANCHORS = 16
MAX_JSON_DEPTH = 16
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
HEX256 = re.compile(r"[0-9a-f]{64}\Z")
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
DETECTOR_SCORE_THRESHOLD = 0.9
DETECTOR_NMS_THRESHOLD = 0.3
DETECTOR_TOP_K = 5000


class IdentityObserveError(ValueError):
    """A local input, pin, or raw observation cannot be used safely."""


def _is_reparse(path: Path) -> bool:
    try:
        return path.is_symlink() or bool(path.lstat().st_file_attributes & REPARSE_POINT)
    except (AttributeError, OSError):
        return path.is_symlink()


def _safe_root(value: Path) -> Path:
    lexical = value.absolute()
    try:
        if not lexical.is_dir() or any(_is_reparse(part) for part in (lexical, *lexical.parents)):
            raise IdentityObserveError("root and its ancestors must be real non-reparse directories")
        return lexical.resolve(strict=True)
    except OSError as exc:
        raise IdentityObserveError("root directory is unavailable") from exc


def _relative(value: str | Path, label: str) -> Path:
    path = Path(value)
    if path.is_absolute() or path.drive or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise IdentityObserveError(f"{label} must be a normalized root-relative path")
    return path


def _within(root: Path, value: str | Path, label: str, *, exists: bool = True) -> Path:
    relative = _relative(value, label)
    current = root
    for index, part in enumerate(relative.parts):
        current /= part
        if _is_reparse(current):
            raise IdentityObserveError(f"{label} may not traverse a symlink or reparse point")
        required = exists or index < len(relative.parts) - 1
        if required and not current.exists():
            raise IdentityObserveError(f"{label} is missing")
    if current.exists():
        try:
            current.resolve(strict=True).relative_to(root)
        except (OSError, ValueError) as exc:
            raise IdentityObserveError(f"{label} escaped root") from exc
    return current


def _hash_file(root: Path, value: str | Path, label: str, maximum: int) -> dict[str, Any]:
    path = _within(root, value, label)
    try:
        if not path.is_file() or _is_reparse(path):
            raise IdentityObserveError(f"{label} must be a regular file")
        expected = path.stat().st_size
        if expected <= 0 or expected > maximum:
            raise IdentityObserveError(f"{label} exceeds its {maximum}-byte limit")
        digest = hashlib.sha256()
        observed = 0
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                observed += len(block)
                if observed > maximum:
                    raise IdentityObserveError(f"{label} exceeds its {maximum}-byte limit")
                digest.update(block)
        if observed != expected or path.stat().st_size != expected:
            raise IdentityObserveError(f"{label} changed while it was read")
    except OSError as exc:
        raise IdentityObserveError(f"cannot read {label}") from exc
    return {"path": _relative(value, label).as_posix(), "bytes": observed, "sha256": digest.hexdigest()}


def _read_limited(path: Path, label: str, maximum: int) -> bytes:
    """Read a bounded stable file; never use unbounded ``read_bytes`` after a stat check."""
    try:
        expected = path.stat().st_size
        if expected < 0 or expected > maximum:
            raise IdentityObserveError(f"{label} exceeds its {maximum}-byte limit")
        blocks: list[bytes] = []
        observed = 0
        with path.open("rb") as handle:
            while block := handle.read(min(1024 * 1024, maximum + 1 - observed)):
                observed += len(block)
                if observed > maximum:
                    raise IdentityObserveError(f"{label} exceeds its {maximum}-byte limit")
                blocks.append(block)
        if observed != expected or path.stat().st_size != expected:
            raise IdentityObserveError(f"{label} changed while it was read")
        return b"".join(blocks)
    except OSError as exc:
        raise IdentityObserveError(f"cannot read {label}") from exc


def _read_bounded_json(path: Path) -> tuple[dict[str, Any], bytes]:
    try:
        if not path.is_file() or _is_reparse(path):
            raise IdentityObserveError("pin manifest is unavailable or exceeds its limit")
        raw = _read_limited(path, "pin manifest", MAX_PIN_BYTES)
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise IdentityObserveError("pin manifest is invalid JSON") from exc
    _check_shape(value, "pin manifest")
    if not isinstance(value, dict):
        raise IdentityObserveError("pin manifest must be an object")
    return value, raw


def _check_shape(value: Any, label: str, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise IdentityObserveError(f"{label} exceeds nesting limit")
    if isinstance(value, dict):
        if len(value) > 32:
            raise IdentityObserveError(f"{label} has too many fields")
        for key, child in value.items():
            if not isinstance(key, str) or len(key) > 128:
                raise IdentityObserveError(f"{label} has an invalid key")
            _check_shape(child, label, depth + 1)
    elif isinstance(value, list):
        if len(value) > MAX_ANCHORS:
            raise IdentityObserveError(f"{label} has too many values")
        for child in value:
            _check_shape(child, label, depth + 1)
    elif isinstance(value, str) and len(value) > 2048:
        raise IdentityObserveError(f"{label} contains overlong text")


def _required_string(value: dict[str, Any], key: str, *, pattern: re.Pattern[str] | None = None) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item or len(item) > 2048 or (pattern and not pattern.fullmatch(item)):
        raise IdentityObserveError(f"pin manifest has invalid {key}")
    return item


def _load_pins(path: Path = PIN_MANIFEST) -> tuple[dict[str, Any], str]:
    pins, raw = _read_bounded_json(path)
    if pins.get("schema") != PIN_SCHEMA or pins.get("admission") not in {"pending-independent-review", "admitted"}:
        raise IdentityObserveError("pin manifest has an unsupported schema or admission state")
    runtime = pins.get("runtime")
    models = pins.get("models")
    if not isinstance(runtime, dict) or not isinstance(models, list) or len(models) != 2:
        raise IdentityObserveError("pin manifest lacks its runtime or two models")
    for key in ("package", "version", "wheel", "python_abi", "platform", "license", "source"):
        _required_string(runtime, key)
    _required_string(runtime, "sha256", pattern=HEX256)
    expected_roles = {"face_detector", "face_recognizer"}
    seen_roles: set[str] = set()
    for model in models:
        if not isinstance(model, dict):
            raise IdentityObserveError("pin manifest model is invalid")
        for key in ("id", "filename", "format", "source_repository", "source_path", "license", "license_source"):
            _required_string(model, key)
        if model.get("format") != "onnx" or not isinstance(model.get("bytes"), int) or not 0 < model["bytes"] <= 64 * 1024 * 1024:
            raise IdentityObserveError("pin manifest model has invalid format or byte count")
        _required_string(model, "sha256", pattern=HEX256)
        _required_string(model, "source_revision", pattern=HEX40)
        role = model.get("role")
        if role not in expected_roles or role in seen_roles:
            raise IdentityObserveError("pin manifest model roles must be unique detector and recognizer")
        seen_roles.add(role)
    if seen_roles != expected_roles:
        raise IdentityObserveError("pin manifest model roles are incomplete")
    return pins, hashlib.sha256(raw).hexdigest()


def _models_by_role(pins: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {model["role"]: model for model in pins["models"]}


def _verify_models(root: Path, model_dir: str | Path, pins: dict[str, Any]) -> dict[str, dict[str, Any]]:
    directory = _within(root, model_dir, "model directory")
    if not directory.is_dir():
        raise IdentityObserveError("model directory must be a directory")
    verified: dict[str, dict[str, Any]] = {}
    for role, pin in _models_by_role(pins).items():
        record = _hash_file(root, _relative(model_dir, "model directory") / pin["filename"], f"{role} model", pin["bytes"])
        if record["bytes"] != pin["bytes"] or record["sha256"] != pin["sha256"]:
            raise IdentityObserveError(f"{role} model does not match its pinned bytes and SHA-256")
        verified[role] = {**pin, "verified": record}
    return verified


def _image_bytes(root: Path, value: str | Path, label: str) -> tuple[dict[str, Any], bytes]:
    record = _hash_file(root, value, label, MAX_IMAGE_BYTES)
    data = _read_limited(_within(root, value, label), label, MAX_IMAGE_BYTES)
    if len(data) != record["bytes"] or hashlib.sha256(data).hexdigest() != record["sha256"]:
        raise IdentityObserveError(f"{label} changed before decoding")
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
    except (ImportError, OSError, ValueError) as exc:
        raise IdentityObserveError(f"{label} is not a supported image") from exc
    if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0 or width * height > MAX_PIXELS:
        raise IdentityObserveError(f"{label} exceeds its pixel limit")
    return record, data


def _face(face: Any) -> dict[str, Any] | None:
    try:
        row = [float(item) for item in list(face)]
    except (TypeError, ValueError):
        return None
    if len(row) < 15 or not all(math.isfinite(value) for value in row[:15]):
        return None
    x, y, width, height = row[:4]
    if width <= 0 or height <= 0 or row[14] < 0 or row[14] > 1:
        return None
    return {
        "bbox": {"x": x, "y": y, "width": width, "height": height},
        "landmarks": [{"x": row[index], "y": row[index + 1]} for index in range(4, 14, 2)],
        "confidence": row[14],
    }


def _one_face(detector: Any, image: Any) -> tuple[Any | None, dict[str, Any] | None, str | None]:
    try:
        height, width = image.shape[:2]
        detector.setInputSize((width, height))
        detected = detector.detect(image)
        faces = detected[1] if isinstance(detected, tuple) and len(detected) == 2 else None
    except Exception as exc:
        raise IdentityObserveError("local face detector failed") from exc
    if faces is None:
        return None, None, "no face detected"
    try:
        count = len(faces)
    except TypeError:
        return None, None, "detector returned malformed faces"
    if count != 1:
        return None, None, "multiple faces detected" if count > 1 else "no face detected"
    observation = _face(faces[0])
    if observation is None:
        return None, None, "detector returned malformed face data"
    return faces[0], observation, None


def _fixed640_input(cv2: Any, image: Any) -> tuple[Any, dict[str, Any]]:
    """Resize only detector input; callers retain original pixels for SFace."""
    try:
        original_height, original_width = image.shape[:2]
    except (AttributeError, TypeError, ValueError) as exc:
        raise IdentityObserveError("candidate image decoder returned invalid dimensions") from exc
    if original_width <= 0 or original_height <= 0:
        raise IdentityObserveError("candidate image decoder returned invalid dimensions")
    edge = max(original_width, original_height)
    if edge <= 640:
        detector_image = image
        resized = False
    else:
        scale = 640 / edge
        detector_width = round(original_width * scale)
        detector_height = round(original_height * scale)
        if detector_width <= 0 or detector_height <= 0:
            raise IdentityObserveError("fixed detector resize produced invalid dimensions")
        try:
            detector_image = cv2.resize(image, (detector_width, detector_height), interpolation=cv2.INTER_AREA)
        except Exception as exc:
            raise IdentityObserveError("fixed detector resize failed") from exc
        resized = True
    detector_height, detector_width = detector_image.shape[:2]
    return detector_image, {
        "id": FIXED640_PREPROCESSING,
        "original_size": {"width": original_width, "height": original_height},
        "detector_input_size": {"width": detector_width, "height": detector_height},
        "sx": detector_width / original_width,
        "sy": detector_height / original_height,
        "interpolation": "INTER_AREA",
        "resized": resized,
        "recognizer_pixels": "original",
    }


def _map_face_to_original(face: Any, sx: float, sy: float) -> Any:
    """Map YuNet detector coordinates to original pixels; confidence is unchanged."""
    if not all(math.isfinite(value) and value > 0 for value in (sx, sy)):
        raise IdentityObserveError("fixed detector scale is invalid")
    raw = _face(face)
    if raw is None:
        raise IdentityObserveError("detector returned malformed face data")
    try:
        import numpy as np
        values = np.asarray(list(face), dtype=np.float32).reshape(-1).copy()
    except Exception as exc:
        raise IdentityObserveError("detector returned malformed face data") from exc
    if len(values) < 15:
        raise IdentityObserveError("detector returned malformed face data")
    for index in (0, 2, 4, 6, 8, 10, 12):
        values[index] /= sx
    for index in (1, 3, 5, 7, 9, 11, 13):
        values[index] /= sy
    return values


def _one_face_fixed640(detector: Any, cv2: Any, original: Any) -> tuple[Any | None, dict[str, Any] | None, str | None, dict[str, Any]]:
    detector_image, metadata = _fixed640_input(cv2, original)
    try:
        height, width = detector_image.shape[:2]
        detector.setInputSize((width, height))
        detected = detector.detect(detector_image)
        faces = detected[1] if isinstance(detected, tuple) and len(detected) == 2 else None
    except Exception as exc:
        raise IdentityObserveError("local face detector failed") from exc
    try:
        count = 0 if faces is None else len(faces)
    except TypeError:
        metadata["face_count"] = None
        metadata["detector_face"] = None
        metadata["mapped_face"] = None
        return None, None, "detector returned malformed faces", metadata
    metadata["face_count"] = count
    if count != 1:
        metadata["detector_face"] = None
        metadata["mapped_face"] = None
        return None, None, "multiple faces detected" if count > 1 else "no face detected", metadata
    detector_face = _face(faces[0])
    if detector_face is None:
        metadata["detector_face"] = None
        metadata["mapped_face"] = None
        return None, None, "detector returned malformed face data", metadata
    mapped = _map_face_to_original(faces[0], metadata["sx"], metadata["sy"])
    mapped_observation = _face(mapped)
    if mapped_observation is None:
        raise IdentityObserveError("mapped detector face is invalid")
    metadata["detector_face"] = detector_face
    metadata["mapped_face"] = mapped_observation
    return mapped, mapped_observation, None, metadata


def _embedding(recognizer: Any, image: Any, face: Any) -> list[float]:
    try:
        aligned = recognizer.alignCrop(image, face)
        values = recognizer.feature(aligned)
        if hasattr(values, "reshape"):
            values = values.reshape(-1).tolist()
        result = [float(value) for value in values]
    except Exception as exc:
        raise IdentityObserveError("local face recognizer failed") from exc
    if not result or not all(math.isfinite(value) for value in result):
        raise IdentityObserveError("local face recognizer returned an invalid feature")
    return result


def _cosine(left: list[float], right: list[float]) -> float:
    if len(left) != len(right):
        raise IdentityObserveError("recognizer feature dimensions differ")
    denominator = math.sqrt(sum(value * value for value in left)) * math.sqrt(sum(value * value for value in right))
    if denominator == 0:
        raise IdentityObserveError("recognizer returned a zero-norm feature")
    result = sum(a * b for a, b in zip(left, right)) / denominator
    if not math.isfinite(result):
        raise IdentityObserveError("recognizer returned a non-finite cosine")
    return result


def _decode(cv2: Any, data: bytes, label: str) -> Any:
    try:
        import numpy as np
        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    except Exception as exc:
        raise IdentityObserveError(f"{label} could not be decoded locally") from exc
    if image is None:
        raise IdentityObserveError(f"{label} could not be decoded locally")
    return image


def _verify_runtime(cv2: Any, pins: dict[str, Any]) -> dict[str, str]:
    expected = pins["runtime"]["version"]
    try:
        distribution = importlib.metadata.version(pins["runtime"]["package"])
    except importlib.metadata.PackageNotFoundError as exc:
        raise IdentityObserveError("pinned OpenCV distribution is not installed") from exc
    cv2_version = getattr(cv2, "__version__", None)
    if distribution != expected:
        raise IdentityObserveError(f"OpenCV distribution version mismatch: expected {expected}, got {distribution}")
    if not isinstance(cv2_version, str) or cv2_version.split(".")[:3] != expected.split(".")[:3]:
        raise IdentityObserveError("cv2 runtime version does not match the pinned OpenCV release")
    return {"distribution_version": distribution, "cv2_version": cv2_version}


def _runtime(cv2: Any, models: dict[str, dict[str, Any]], width: int, height: int) -> tuple[Any, Any]:
    try:
        backend = getattr(getattr(cv2, "dnn", object()), "DNN_BACKEND_OPENCV", 0)
        target = getattr(getattr(cv2, "dnn", object()), "DNN_TARGET_CPU", 0)
        detector = cv2.FaceDetectorYN.create(
            str(models["face_detector"]["verified_path"]), "", (width, height),
            DETECTOR_SCORE_THRESHOLD, DETECTOR_NMS_THRESHOLD, DETECTOR_TOP_K, backend, target,
        )
        recognizer = cv2.FaceRecognizerSF.create(str(models["face_recognizer"]["verified_path"]), "")
    except (AttributeError, TypeError, ValueError) as exc:
        raise IdentityObserveError("installed OpenCV runtime lacks YuNet or SFace support") from exc
    return detector, recognizer


def _write_fresh(root: Path, value: str | Path, record: dict[str, Any]) -> None:
    output = _within(root, value, "output", exists=False)
    if output.suffix != ".json" or output.exists() or _is_reparse(output):
        raise IdentityObserveError("output must be a fresh root-relative .json file")
    try:
        encoded = (json.dumps(record, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise IdentityObserveError("observation contains unsupported non-finite data") from exc
    if len(encoded) > MAX_PIN_BYTES:
        raise IdentityObserveError("observation exceeds its output limit")
    try:
        with output.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
    except (FileExistsError, OSError) as exc:
        raise IdentityObserveError("could not write a fresh observation") from exc


def _observe_with_backend(*, root: Path, model_dir: str | Path, image_path: str | Path, anchor_paths: list[str | Path], output_path: str | Path, pins: dict[str, Any], pins_sha256: str, cv2: Any, detector_preprocessing: str | None = None) -> dict[str, Any]:
    """Internal seam for tests; callers still receive only raw, non-promotable output."""
    if not isinstance(anchor_paths, list) or not 1 <= len(anchor_paths) <= MAX_ANCHORS:
        raise IdentityObserveError(f"anchors must contain 1 to {MAX_ANCHORS} root-relative images")
    if detector_preprocessing not in {None, FIXED640_PREPROCESSING}:
        raise IdentityObserveError("detector_preprocessing must be omitted or fixed-max-edge-640@1")
    models = _verify_models(root, model_dir, pins)
    for model in models.values():
        model["verified_path"] = _within(root, _relative(model_dir, "model directory") / model["filename"], "verified model")
    candidate_before, candidate_data = _image_bytes(root, image_path, "candidate image")
    anchor_inputs = [
        _image_bytes(root, anchor_path, "anchor image")
        for anchor_path in anchor_paths
    ]
    candidate = _decode(cv2, candidate_data, "candidate image")
    try:
        height, width = candidate.shape[:2]
    except (AttributeError, TypeError, ValueError) as exc:
        raise IdentityObserveError("candidate image decoder returned invalid dimensions") from exc
    if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
        raise IdentityObserveError("candidate image exceeds its pixel limit")
    detector, recognizer = _runtime(cv2, models, width, height)
    candidate_metadata: dict[str, Any] | None = None
    anchor_detected: list[tuple[dict[str, Any], Any, Any | None, dict[str, Any] | None, str | None, dict[str, Any] | None]] = []
    if detector_preprocessing == FIXED640_PREPROCESSING:
        candidate_face, candidate_observation, candidate_reason, candidate_metadata = _one_face_fixed640(detector, cv2, candidate)
        for source_before, data in anchor_inputs:
            decoded = _decode(cv2, data, "anchor image")
            anchor_face, anchor_observation, anchor_reason, anchor_metadata = _one_face_fixed640(detector, cv2, decoded)
            anchor_detected.append((source_before, decoded, anchor_face, anchor_observation, anchor_reason, anchor_metadata))
    else:
        candidate_face, candidate_observation, candidate_reason = _one_face(detector, candidate)
    record: dict[str, Any] = {
        "schema": FIXED640_SCHEMA if detector_preprocessing == FIXED640_PREPROCESSING else SCHEMA,
        "provenance": "local raw detector/recognizer observations from hash-pinned inputs; no identity verdict, threshold, approval, or feature vector is recorded",
        "model_pins": {
            "manifest_sha256": pins_sha256,
            "runtime": {
                "pinned_wheel": {key: pins["runtime"][key] for key in ("package", "version", "wheel", "sha256", "license", "source")},
                "adoption_receipt": None,
                "verified_runtime": _verify_runtime(cv2, pins),
                "backend": "opencv-dnn-cpu",
                "detector_parameters": {
                    "score_threshold": DETECTOR_SCORE_THRESHOLD,
                    "nms_threshold": DETECTOR_NMS_THRESHOLD,
                    "top_k": DETECTOR_TOP_K,
                },
            },
            "models": [{key: model[key] for key in ("id", "role", "filename", "bytes", "sha256", "source_repository", "source_revision", "source_path", "license", "license_source")} for model in models.values()],
        },
        "candidate": {"source_before": candidate_before, "face": candidate_observation, "unavailable_reason": candidate_reason},
        "anchors": [],
    }
    if candidate_metadata is not None:
        record["candidate"]["detector_preprocessing"] = candidate_metadata
    if candidate_face is not None:
        candidate_embedding = _embedding(recognizer, candidate, candidate_face)
        if detector_preprocessing == FIXED640_PREPROCESSING:
            for source_before, decoded, anchor_face, anchor_observation, reason, metadata in anchor_detected:
                cosine: float | None = None
                if anchor_face is not None:
                    cosine = _cosine(candidate_embedding, _embedding(recognizer, decoded, anchor_face))
                record["anchors"].append({"source_before": source_before, "face": anchor_observation, "raw_cosine": cosine, "unavailable_reason": reason, "detector_preprocessing": metadata})
        else:
            for source_before, data in anchor_inputs:
                decoded = _decode(cv2, data, "anchor image")
                anchor_face, anchor_observation, reason = _one_face(detector, decoded)
                cosine: float | None = None
                if anchor_face is not None:
                    cosine = _cosine(candidate_embedding, _embedding(recognizer, decoded, anchor_face))
                record["anchors"].append({"source_before": source_before, "face": anchor_observation, "raw_cosine": cosine, "unavailable_reason": reason})
    else:
        if detector_preprocessing == FIXED640_PREPROCESSING:
            record["anchors"] = [
                {"source_before": source_before, "face": anchor_observation, "raw_cosine": None, "unavailable_reason": "candidate face unavailable", "detector_unavailable_reason": reason, "detector_preprocessing": metadata}
                for source_before, _decoded, _anchor_face, anchor_observation, reason, metadata in anchor_detected
            ]
        else:
            record["anchors"] = [
                {"source_before": source_before, "face": None, "raw_cosine": None, "unavailable_reason": "candidate face unavailable"}
                for source_before, _data in anchor_inputs
            ]
    candidate_after = _hash_file(root, image_path, "candidate image", MAX_IMAGE_BYTES)
    if candidate_after != candidate_before:
        raise IdentityObserveError("candidate image changed during observation")
    for anchor in record["anchors"]:
        after = _hash_file(root, anchor["source_before"]["path"], "anchor image", MAX_IMAGE_BYTES)
        if after != anchor["source_before"]:
            raise IdentityObserveError("anchor image changed during observation")
        anchor["source_after"] = after
    record["candidate"]["source_after"] = candidate_after
    # This rejects model replacement between initial hashing and receipt creation.
    # It cannot secure against a concurrent local writer; that filesystem must remain trusted.
    try:
        models_after = _verify_models(root, model_dir, pins)
    except IdentityObserveError as exc:
        raise IdentityObserveError("a pinned model changed during observation") from exc
    if any(models_after[role]["verified"] != models[role]["verified"] for role in models):
        raise IdentityObserveError("a pinned model changed during observation")
    _write_fresh(root, output_path, record)
    return record


def observe(*, root: Path, model_dir: str | Path, image_path: str | Path, anchor_paths: list[str | Path], output_path: str | Path, detector_preprocessing: str | None = None) -> dict[str, Any]:
    """Run only after the checked-in model pins have been explicitly admitted."""
    root = _safe_root(root)
    pins, pins_sha256 = _load_pins()
    if pins["admission"] != "admitted":
        raise IdentityObserveError("model pins are pending independent review; refusing to create an observer session")
    _verify_models(root, model_dir, pins)  # Hash every model before importing OpenCV.
    try:
        import cv2
    except ImportError as exc:
        raise IdentityObserveError("pinned OpenCV runtime is not installed") from exc
    _verify_runtime(cv2, pins)
    return _observe_with_backend(root=root, model_dir=model_dir, image_path=image_path, anchor_paths=anchor_paths, output_path=output_path, pins=pins, pins_sha256=pins_sha256, cv2=cv2, detector_preprocessing=detector_preprocessing)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write a local raw YuNet/SFace identity observation after pin admission.")
    parser.add_argument("--root", type=Path, required=True, help="local root containing all inputs and fresh output")
    parser.add_argument("--models", required=True, help="root-relative directory containing exactly the pinned ONNX files")
    parser.add_argument("--image", required=True, help="root-relative candidate image")
    parser.add_argument("--anchor", action="append", required=True, help="root-relative anchor image; repeat up to 16 times")
    parser.add_argument("--out", required=True, help="fresh root-relative .json observation")
    parser.add_argument("--detector-preprocessing", choices=[FIXED640_PREPROCESSING], help="optional detector-only preprocessing; omit for native v1 behavior")
    args = parser.parse_args(argv)
    try:
        observe(root=args.root, model_dir=args.models, image_path=args.image, anchor_paths=args.anchor, output_path=args.out, detector_preprocessing=args.detector_preprocessing)
    except IdentityObserveError as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
