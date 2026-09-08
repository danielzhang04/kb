"""Offline compiler for the later g01 full-frame versus face-crop diagnostic.

The CLI validates and prints the frozen plan only.  It does not materialize a
crop, start ComfyUI, open a socket, or submit a graph.  ``materialize_crop`` is
an explicit helper for a separately admitted future step and synthetic tests.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import os
from pathlib import Path
from typing import Any, Mapping

SCHEMA = "figment/local-conditioning-crop@1"
CANONICAL = Path("orgs/figment/personas/creator-001/anchors/g01.jpg")
CANONICAL_SHA256 = "e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed"
SOURCE_SIZE = (1408, 768)
CROP_BOX = (512, 17, 896, 401)
CROP_SIZE = (384, 384)
CROP_NAME = "g01-face384-crop-v1.png"
MAX_SOURCE_BYTES = 8 * 1024 * 1024
PRIVATE_ROOT = Path(r"C:\Users\danie\kb\_private")
CROP_OUTPUT_PREFIX = "figment-local-conditioning-crop-"
COMFY_RUN_PREFIX = "figment-local-comfy-"


class ConditioningCropError(RuntimeError):
    pass


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _bounded_file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            total += len(block)
            if total > MAX_SOURCE_BYTES:
                raise ConditioningCropError("source exceeds byte bound")
            digest.update(block)
    return digest.hexdigest()


def _is_reparse(path: Path) -> bool:
    try:
        return path.is_symlink() or bool(os.lstat(path).st_file_attributes & 0x400)
    except AttributeError:
        return path.is_symlink()


def _safe_existing(path: Path) -> Path:
    supplied = path.absolute()
    cursor = supplied
    while True:
        if cursor.exists() and _is_reparse(cursor):
            raise ConditioningCropError(f"reparse point refused: {cursor}")
        if cursor.parent == cursor:
            break
        cursor = cursor.parent
    return supplied.resolve(strict=True)


def _bounded_source(path: Path, expected_sha256: str, expected_size: tuple[int, int]) -> tuple[bytes, dict[str, Any]]:
    safe = _safe_existing(path)
    if not safe.is_file():
        raise ConditioningCropError("source is not a file")
    if safe.stat().st_size > MAX_SOURCE_BYTES:
        raise ConditioningCropError("source exceeds byte bound")
    before = _bounded_file_hash(safe)
    if before != expected_sha256:
        raise ConditioningCropError("source hash mismatch before read")
    with safe.open("rb") as handle:
        data = handle.read(MAX_SOURCE_BYTES + 1)
    if not data or len(data) > MAX_SOURCE_BYTES:
        raise ConditioningCropError("source exceeds byte bound")
    if _sha256(data) != before:
        raise ConditioningCropError("source changed during bounded read")
    after = _bounded_file_hash(safe)
    if after != before:
        raise ConditioningCropError("source changed after bounded read")
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "JPEG" or image.size != expected_size:
                raise ConditioningCropError("source format or dimensions mismatch")
            image.load()
    except ConditioningCropError:
        raise
    except Exception as exc:
        raise ConditioningCropError("source is not a decodable JPEG") from exc
    return data, {"path": str(safe), "sha256": before, "bytes": len(data), "dimensions": list(expected_size)}


def offline_plan(repo_root: Path) -> dict[str, Any]:
    """Validate the frozen g01 source and return a non-materializing plan."""
    source_bytes, source = _bounded_source(repo_root / CANONICAL, CANONICAL_SHA256, SOURCE_SIZE)
    del source_bytes
    return {
        "schema": SCHEMA,
        "mode": "offline-plan-only",
        "not_promotable": True,
        "materialized": False,
        "source": {"repo_path": CANONICAL.as_posix(), **source},
        "derivation": {
            "method": "pillow-original-pixels-crop@1",
            "box": list(CROP_BOX), "dimensions": list(CROP_SIZE), "resize": False,
            "output_filename": CROP_NAME,
        },
    }


def _validate_crop_box(source_size: tuple[int, int], box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    if not all(isinstance(value, int) for value in box) or left < 0 or top < 0 or right <= left or bottom <= top:
        raise ConditioningCropError("crop box is invalid")
    if right > source_size[0] or bottom > source_size[1] or (right - left, bottom - top) != CROP_SIZE:
        raise ConditioningCropError("crop box is out of bounds or not 384 square")


def _fresh_output(private_root: Path, output_root: Path, output_kind: str) -> Path:
    root = _safe_existing(private_root)
    target = output_root.absolute()
    prefixes = {"standalone": CROP_OUTPUT_PREFIX, "local-comfy-run": COMFY_RUN_PREFIX}
    prefix = prefixes.get(output_kind)
    if prefix is None or target.parent != root or not target.name.startswith(prefix):
        raise ConditioningCropError("output must be a fresh direct child of the private root")
    if target.exists():
        raise ConditioningCropError("output root must be fresh")
    target.mkdir()
    if _is_reparse(target) or target.resolve(strict=True).parent != root:
        raise ConditioningCropError("output root containment failed")
    return target


def materialize_crop(source_path: Path, expected_sha256: str, expected_size: tuple[int, int],
                     private_root: Path, output_root: Path, *, output_kind: str = "standalone") -> dict[str, Any]:
    """Create a retained PNG derivative only when a future caller explicitly invokes it."""
    _validate_crop_box(expected_size, CROP_BOX)
    source_bytes, source = _bounded_source(source_path, expected_sha256, expected_size)
    try:
        from PIL import Image, __version__ as pillow_version
        with Image.open(io.BytesIO(source_bytes)) as image:
            image.load()
            rgb = image.convert("RGB")
            crop = rgb.crop(CROP_BOX)
            if crop.size != CROP_SIZE:
                raise ConditioningCropError("crop dimensions mismatch")
            encoded = io.BytesIO()
            crop.save(encoded, format="PNG", optimize=False, compress_level=9)
    except ConditioningCropError:
        raise
    except Exception as exc:
        raise ConditioningCropError("cannot encode deterministic crop PNG") from exc
    output = _fresh_output(private_root, output_root, output_kind)
    target = output / CROP_NAME
    try:
        with target.open("xb") as handle:
            handle.write(encoded.getvalue())
        if _is_reparse(target):
            raise ConditioningCropError("crop output became a reparse point")
        png = target.read_bytes()
        with Image.open(io.BytesIO(png)) as decoded:
            if decoded.format != "PNG" or decoded.mode != "RGB" or decoded.size != CROP_SIZE:
                raise ConditioningCropError("encoded crop PNG mismatch")
            decoded.load()
    except Exception:
        raise
    return {
        "schema": SCHEMA,
        "mode": "materialized-derivative-only",
        "not_promotable": True,
        "source": source,
        "derivation": {"method": "pillow-original-pixels-crop@1", "box": list(CROP_BOX),
                       "resize": False, "output_filename": CROP_NAME, "dimensions": list(CROP_SIZE),
                       "pillow_version": pillow_version,
                       "png_encoder": {"format": "PNG", "optimize": False, "compress_level": 9}},
        "output": {"path": str(target), "sha256": _sha256(png), "bytes": len(png), "dimensions": list(CROP_SIZE)},
    }


def paired_workflows(baseline_workflow: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Freeze the sole graph delta: node 2's LoadImage filename."""
    if not isinstance(baseline_workflow, Mapping):
        raise ConditioningCropError("baseline workflow must be an object")
    full = copy.deepcopy(dict(baseline_workflow))
    crop = copy.deepcopy(dict(baseline_workflow))
    node = crop.get("2")
    if not isinstance(node, dict) or node.get("class_type") != "LoadImage" or not isinstance(node.get("inputs"), dict):
        raise ConditioningCropError("baseline node 2 must be LoadImage")
    if full["2"]["inputs"].get("image") != "g01.jpg":
        raise ConditioningCropError("baseline node 2 must use g01.jpg")
    crop["2"]["inputs"]["image"] = CROP_NAME
    normalized = copy.deepcopy(crop)
    normalized["2"]["inputs"]["image"] = "g01.jpg"
    if normalized != full:
        raise ConditioningCropError("paired workflow changed more than node 2 input")
    return {"full": full, "crop": crop}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[4])
    args = parser.parse_args(argv)
    print(json.dumps(offline_plan(args.repo_root.resolve()), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
