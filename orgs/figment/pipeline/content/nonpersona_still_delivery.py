"""Materialize one accepted native non-persona still at delivery dimensions.

This local-only module consumes the current non-persona visual-ruling validator,
applies one explicit stored-pixel crop followed by Pillow LANCZOS resize, and
publishes a deterministic RGB PNG plus a non-promotable receipt.  Native visual
acceptance is copied as upstream authority; delivery quality remains unassessed.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import io
import json
import os
import platform
import re
import stat
import sys
import warnings
import zlib
from pathlib import Path
from typing import Any, BinaryIO

from PIL import Image, ImageFile, __version__ as PILLOW_VERSION

try:
    from . import nonpersona_visual_ruling as visual_ruling
except ImportError:  # Direct script execution.
    _spec = importlib.util.spec_from_file_location(
        "figment_nonpersona_still_delivery_visual_ruling",
        Path(__file__).with_name("nonpersona_visual_ruling.py"),
    )
    if _spec is None or _spec.loader is None:
        raise RuntimeError("nonpersona_visual_ruling.py authority is unavailable")
    visual_ruling = importlib.util.module_from_spec(_spec)
    sys.modules[_spec.name] = visual_ruling
    _spec.loader.exec_module(visual_ruling)


retained = visual_ruling.retained
native = visual_ruling.native
briefs = visual_ruling.briefs
prep = visual_ruling.prep

REQUEST_SCHEMA = "figment/nonpersona-still-delivery-request@1"
RECEIPT_SCHEMA = "figment/nonpersona-still-delivery@1"
DELIVERY_NAME = "delivery.png"
PENDING_RECEIPT_NAME = ".nonpersona-still-delivery.pending"
RECEIPT_NAME = "nonpersona-still-delivery.json"
TARGET = {"aspect": "3:4", "width": 1080, "height": 1440}
SOURCE_METADATA_KEYS = {
    "icc_profile", "gamma", "srgb", "chromaticity", "transparency",
}
SHA_RE = re.compile(r"[0-9a-f]{64}\Z")
TOP_LEVEL_KEYS = {
    "schema", "stage", "not_promotable", "delivery_quality", "out",
    "request", "source_authority", "operation", "runtime", "output",
}
NVR_KEYS = {
    "schema", "not_promotable", "ruling", "retained", "image", "brief",
    "creator", "slot", "native_dimensions", "delivery_target", "authority",
    "criteria", "decision", "decided_by", "decided_at", "note",
    "delivery_quality", "delivery_transform",
}
SOURCE_AUTHORITY_KEYS = NVR_KEYS - {"note"}
RUNTIME_MISMATCH = (
    "renderer/runtime differs; rerender into a fresh output directory"
)
ERRORS = (OSError, ValueError, RuntimeError, KeyError, TypeError, AttributeError)


class NonpersonaStillDeliveryError(ValueError):
    """A native still cannot be safely materialized or revalidated."""


def _fail(message: str) -> NonpersonaStillDeliveryError:
    return NonpersonaStillDeliveryError(message)


def _domain(exc: Exception) -> NonpersonaStillDeliveryError:
    if isinstance(exc, NonpersonaStillDeliveryError):
        return exc
    detail = str(exc) if isinstance(exc, ERRORS) else "unexpected input"
    return NonpersonaStillDeliveryError(f"{type(exc).__name__}: {detail}")


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _exact_object(value: object, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise _fail(f"{label} must carry exactly {sorted(keys)}")
    return value


def _positive(value: object, label: str, maximum: int | None = None) -> int:
    if type(value) is not int or value < 1 or (maximum is not None and value > maximum):
        bound = f" no greater than {maximum}" if maximum is not None else ""
        raise _fail(f"{label} must be a positive integer{bound}")
    return value


def _sha(value: object, label: str) -> str:
    if not isinstance(value, str) or not SHA_RE.fullmatch(value):
        raise _fail(f"{label} must be 64 lowercase hex characters")
    return value


def _bounded_text(value: object, label: str, maximum: int = 128) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise _fail(f"{label} must be bounded nonempty text")
    if briefs._utf16_length(value) > maximum:
        raise _fail(f"{label} exceeds {maximum} UTF-16 units")
    if any(ord(ch) < 0x20 or 0x7F <= ord(ch) <= 0x9F or 0xD800 <= ord(ch) <= 0xDFFF for ch in value):
        raise _fail(f"{label} contains control characters or lone surrogates")
    return value


def _normalized_relative(value: object, label: str) -> str:
    normalized = prep._normalize_relative(value)
    try:
        relative = briefs._relative(normalized, label)
    except (OSError, briefs.ContentBriefError) as exc:
        raise _fail(str(exc)) from exc
    if not isinstance(normalized, str) or relative.as_posix() != normalized:
        raise _fail(f"{label} must be a normalized root-relative path")
    return normalized


def _safe_root(root: Path) -> Path:
    try:
        return briefs._safe_root(Path(root))
    except (OSError, briefs.ContentBriefError) as exc:
        raise _fail(str(exc)) from exc


def _out_dir(root: Path, out: object, *, existing: bool) -> tuple[Path, str]:
    normalized = _normalized_relative(out, "out")
    try:
        path, relative = native._out_dir(root, normalized, existing=existing)
    except (OSError, ValueError) as exc:
        raise _fail(str(exc)) from exc
    if relative != normalized:
        raise _fail("out must be a normalized root-relative path")
    return path, relative


def _safe_input(root: Path, value: object, label: str) -> tuple[Path, str]:
    normalized = _normalized_relative(value, label)
    try:
        path = prep._safe_input(root, normalized, label)
    except (OSError, ValueError) as exc:
        raise _fail(str(exc)) from exc
    return path, normalized


def _identity(value: os.stat_result) -> tuple[int, int, int, int]:
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns


def _read_linkable_receipt(path: Path, maximum: int, label: str) -> bytes:
    """Stable bounded read for a receipt that may be intentionally hard-linked."""
    if briefs._is_reparse(path) or not path.is_file():
        raise _fail(f"{label} is missing or linked")
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink not in (1, 2):
        raise _fail(f"{label} must be a regular file with no unrelated hard links")
    with path.open("rb") as handle:
        opened = os.fstat(handle.fileno())
        data = handle.read(maximum + 1)
        finished = os.fstat(handle.fileno())
    if len(data) > maximum:
        raise _fail(f"{label} exceeds {maximum} bytes")
    try:
        after = path.stat()
    except OSError as exc:
        raise _fail(f"{label} changed while it was read") from exc
    if not (_identity(before) == _identity(opened) == _identity(finished) == _identity(after)) \
            or len(data) != before.st_size:
        raise _fail(f"{label} changed while it was read")
    return data


def _load_request(root: Path, request_path: object) -> tuple[dict[str, Any], dict[str, Any], bytes]:
    request_file, request_rel = _safe_input(root, request_path, "delivery request")
    data = retained._read_unlinked(
        request_file, briefs.MAX_JSON_BYTES, "delivery request",
    )
    if not data:
        raise _fail("delivery request must not be empty")
    request = retained._parse_retained(data, "delivery request")
    _exact_object(request, {"schema", "ruling", "crop_box"}, "delivery request")
    if request["schema"] != REQUEST_SCHEMA:
        raise _fail(f"delivery request schema must be {REQUEST_SCHEMA}")
    ruling = _exact_object(request["ruling"], {"path", "sha256"}, "ruling binding")
    ruling["path"] = _normalized_relative(ruling["path"], "ruling.path")
    _sha(ruling["sha256"], "ruling.sha256")
    crop_box = request["crop_box"]
    if not isinstance(crop_box, list) or len(crop_box) != 4 \
            or any(type(value) is not int for value in crop_box):
        raise _fail("crop_box must contain exactly four integers")
    binding = {"path": request_rel, "bytes": len(data), "sha256": _digest(data)}
    _positive(binding["bytes"], "request.bytes", briefs.MAX_JSON_BYTES)
    return request, binding, data


def _check_path_binding(value: object, label: str, *, maximum: int) -> dict[str, Any]:
    binding = _exact_object(value, {"path", "bytes", "sha256"}, label)
    binding["path"] = _normalized_relative(binding["path"], f"{label}.path")
    _positive(binding["bytes"], f"{label}.bytes", maximum)
    _sha(binding["sha256"], f"{label}.sha256")
    return binding


def _source_authority(root: Path, request: dict[str, Any]) -> dict[str, Any]:
    ruling = request["ruling"]
    try:
        result = visual_ruling.validate_nonpersona_visual_ruling(
            root=root, path=ruling["path"], expected_sha256=ruling["sha256"],
        )
    except ERRORS as exc:
        raise _fail(f"visual ruling is not current and accepted: {exc}") from exc
    _exact_object(result, NVR_KEYS, "visual ruling validation")
    if result["schema"] != visual_ruling.RESULT_SCHEMA or result["not_promotable"] is not True:
        raise _fail("visual ruling validation schema or promotability is invalid")

    ruling_binding = _check_path_binding(
        result["ruling"], "source_authority.ruling", maximum=briefs.MAX_JSON_BYTES,
    )
    if ruling_binding["path"] != ruling["path"] or ruling_binding["sha256"] != ruling["sha256"]:
        raise _fail("visual ruling validation does not bind the requested ruling")

    retained_binding = _exact_object(
        result["retained"], {"out", "path", "bytes", "sha256"},
        "source_authority.retained",
    )
    retained_binding["out"] = _normalized_relative(
        retained_binding["out"], "source_authority.retained.out",
    )
    if retained_binding["path"] != retained.RECORD_NAME:
        raise _fail("source_authority.retained.path is not the retained record")
    _positive(retained_binding["bytes"], "source_authority.retained.bytes", briefs.MAX_JSON_BYTES)
    _sha(retained_binding["sha256"], "source_authority.retained.sha256")

    image = _exact_object(
        result["image"],
        {"cell_id", "seed", "output_name", "path", "bytes", "sha256",
         "width", "height", "review_eligible"},
        "source_authority.image",
    )
    for field in ("cell_id", "output_name"):
        _bounded_text(image[field], f"source_authority.image.{field}", briefs.MAX_TEXT)
    if type(image["seed"]) is not int:
        raise _fail("source_authority.image.seed must be an integer")
    image["path"] = _normalized_relative(image["path"], "source_authority.image.path")
    _positive(image["bytes"], "source_authority.image.bytes", retained.MAX_IMAGE_BYTES)
    _sha(image["sha256"], "source_authority.image.sha256")
    _positive(image["width"], "source_authority.image.width")
    _positive(image["height"], "source_authority.image.height")
    if image["review_eligible"] is not True:
        raise _fail("source image must be review eligible")

    brief = _exact_object(result["brief"], {"path", "sha256"}, "source_authority.brief")
    brief["path"] = _normalized_relative(brief["path"], "source_authority.brief.path")
    _sha(brief["sha256"], "source_authority.brief.sha256")
    creator = _bounded_text(result["creator"], "source_authority.creator", briefs.MAX_TEXT)

    slot = _exact_object(
        result["slot"], {"index", "role", "taxonomy_type", "kind"},
        "source_authority.slot",
    )
    _positive(slot["index"], "source_authority.slot.index")
    _bounded_text(slot["role"], "source_authority.slot.role", briefs.MAX_ROLE)
    if slot["taxonomy_type"] not in prep.ALLOWED_NONPERSONA_TYPES or slot["kind"] != "nonpersona":
        raise _fail("source slot must be a C/D/E nonpersona slot")

    native_dimensions = _exact_object(
        result["native_dimensions"], {"width", "height"},
        "source_authority.native_dimensions",
    )
    width = _positive(native_dimensions["width"], "source_authority.native_dimensions.width")
    height = _positive(native_dimensions["height"], "source_authority.native_dimensions.height")
    if image["width"] != width or image["height"] != height:
        raise _fail("source image dimensions differ from native_dimensions")

    delivery_target = _exact_object(
        result["delivery_target"], {"aspect", "width", "height"},
        "source_authority.delivery_target",
    )
    if not prep._strict_equal(delivery_target, TARGET):
        raise _fail("delivery target must be the current 1080x1440 3:4 surface")
    if delivery_target["width"] * 4 != delivery_target["height"] * 3:
        raise _fail("delivery target does not have an exact 3:4 pixel ratio")

    if result["authority"] != "human-visual-ruling" \
            or result["decision"] != "accept-native" \
            or not prep._strict_equal(result["criteria"], visual_ruling.ACCEPTING) \
            or result["delivery_quality"] != "not-assessed" \
            or result["delivery_transform"] is not None:
        raise _fail("visual ruling is not an accepted native-only human ruling")
    _bounded_text(result["decided_by"], "source_authority.decided_by", visual_ruling.MAX_DECIDED_BY)
    visual_ruling._timestamp(result["decided_at"])

    return {
        "schema": result["schema"],
        "not_promotable": True,
        "ruling": copy.deepcopy(ruling_binding),
        "retained": copy.deepcopy(retained_binding),
        "image": copy.deepcopy(image),
        "brief": copy.deepcopy(brief),
        "creator": creator,
        "slot": copy.deepcopy(slot),
        "native_dimensions": copy.deepcopy(native_dimensions),
        "delivery_target": copy.deepcopy(delivery_target),
        "authority": result["authority"],
        "criteria": copy.deepcopy(result["criteria"]),
        "decision": result["decision"],
        "decided_by": result["decided_by"],
        "decided_at": result["decided_at"],
        "delivery_quality": result["delivery_quality"],
        "delivery_transform": None,
    }


def _source_snapshot(root: Path, authority: dict[str, Any]) -> bytes:
    relative = f"{authority['retained']['out']}/{authority['image']['path']}"
    source_path, _ = _safe_input(root, relative, "native source image")
    data = retained._read_unlinked(
        source_path, retained.MAX_IMAGE_BYTES, "native source image",
    )
    image = authority["image"]
    if len(data) != image["bytes"] or _digest(data) != image["sha256"]:
        raise _fail("native source image differs from its accepted authority binding")
    return data


def _check_crop(crop_box: object, native_dimensions: dict[str, int],
                delivery_target: dict[str, int | str]) -> tuple[int, int, int, int]:
    if not isinstance(crop_box, list) or len(crop_box) != 4 \
            or any(type(value) is not int for value in crop_box):
        raise _fail("crop_box must contain exactly four integers")
    left, top, right, bottom = crop_box
    native_width, native_height = native_dimensions["width"], native_dimensions["height"]
    if not (0 <= left < right <= native_width and 0 <= top < bottom <= native_height):
        raise _fail("crop_box must be a positive in-bounds half-open pixel box")
    crop_width, crop_height = right - left, bottom - top
    target_width = delivery_target["width"]
    target_height = delivery_target["height"]
    if crop_width * target_height != crop_height * target_width:
        raise _fail("crop_box must have the exact delivery-target pixel ratio")
    return left, top, right, bottom


def _inspect_png(data: bytes, expected: tuple[int, int], label: str) -> bytes:
    if ImageFile.LOAD_TRUNCATED_IMAGES:
        raise _fail("Pillow is configured to tolerate truncated images")

    def inspect(image: Image.Image) -> None:
        if image.format != "PNG" or image.size != expected:
            raise _fail(f"{label} must be a PNG at the expected dimensions")
        if getattr(image, "n_frames", 1) != 1 or getattr(image, "is_animated", False):
            raise _fail(f"{label} must be a single-frame PNG")
        if image.mode != "RGB":
            raise _fail(f"{label} must have mode RGB")
        present = sorted(SOURCE_METADATA_KEYS.intersection(image.info))
        if present:
            raise _fail(f"{label} carries unsupported metadata: {', '.join(present)}")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                # Pillow requires verify() directly after open.  In particular,
                # getexif() loads PNGs without an exif info key, invalidating verify.
                image.verify()
            with Image.open(io.BytesIO(data)) as image:
                inspect(image)
                image.load()
                inspect(image)
                orientation = image.getexif().get(274)
                if orientation not in (None, 1):
                    raise _fail(f"{label} EXIF orientation must be absent or 1")
                pixels = image.tobytes()
    except NonpersonaStillDeliveryError:
        raise
    except Exception as exc:
        raise _fail(f"{label} is not a valid complete PNG: {type(exc).__name__}") from exc
    if len(pixels) != expected[0] * expected[1] * 3:
        raise _fail(f"{label} decoded RGB buffer has an unexpected length")
    return pixels


def _render_png(
    source_data: bytes,
    crop_box: tuple[int, int, int, int],
    target: tuple[int, int, int, int],
) -> tuple[bytes, bytes]:
    """Return exact rendered RGB bytes and deterministic encoded PNG bytes."""
    native_width, native_height, target_width, target_height = target
    source_rgb = _inspect_png(
        source_data, (native_width, native_height), "native source image",
    )
    source = Image.frombytes("RGB", (native_width, native_height), source_rgb)
    try:
        resized = source.crop(crop_box).resize(
            (target_width, target_height), Image.Resampling.LANCZOS,
        )
        rendered_rgb = resized.tobytes()
    finally:
        source.close()
    fresh = Image.frombytes("RGB", (target_width, target_height), rendered_rgb)
    encoded = io.BytesIO()
    try:
        fresh.save(encoded, format="PNG", optimize=False, compress_level=9)
    finally:
        fresh.close()
    return rendered_rgb, encoded.getvalue()


def _runtime() -> dict[str, Any]:
    values = {
        "python_version": platform.python_version(),
        "pillow_version": PILLOW_VERSION,
        "zlib_runtime_version": zlib.ZLIB_RUNTIME_VERSION,
    }
    for key, value in values.items():
        _bounded_text(value, f"runtime.{key}", 128)
    renderer = retained._read_unlinked(
        Path(__file__).resolve(), briefs.MAX_JSON_BYTES, "renderer code",
    )
    nvr_code = retained._read_unlinked(
        Path(visual_ruling.__file__).resolve(), briefs.MAX_JSON_BYTES,
        "nonpersona visual ruling code",
    )
    values["code_sha256"] = {
        "nonpersona_still_delivery.py": _digest(renderer),
        "nonpersona_visual_ruling.py": _digest(nvr_code),
    }
    return values


def _operation(crop_box: tuple[int, int, int, int]) -> dict[str, Any]:
    left, top, right, bottom = crop_box
    return {
        "op": "crop-resize",
        "coordinate_space": "stored-pixel-grid-half-open",
        "crop_box": [left, top, right, bottom],
        "crop_dimensions": {"width": right - left, "height": bottom - top},
        "resample": "Pillow.Image.Resampling.LANCZOS",
        "color": "stored-untagged-RGB-no-conversion",
        "source_metadata_policy": (
            "reject-icc-gamma-srgb-chromaticity-transparency-strip-other-ancillary"
        ),
        "output_format": "PNG",
        "encoder": {"optimize": False, "compress_level": 9},
        "output_metadata": "none",
    }


def _receipt(
    *, out_rel: str, request_binding: dict[str, Any], authority: dict[str, Any],
    crop_box: tuple[int, int, int, int], runtime: dict[str, Any],
    rendered_rgb: bytes, encoded_png: bytes,
) -> dict[str, Any]:
    target = authority["delivery_target"]
    return {
        "schema": RECEIPT_SCHEMA,
        "stage": "materialized-not-reviewed",
        "not_promotable": True,
        "delivery_quality": "not-assessed",
        "out": out_rel,
        "request": copy.deepcopy(request_binding),
        "source_authority": copy.deepcopy(authority),
        "operation": _operation(crop_box),
        "runtime": copy.deepcopy(runtime),
        "output": {
            "path": DELIVERY_NAME,
            "bytes": len(encoded_png),
            "sha256": _digest(encoded_png),
            "width": target["width"],
            "height": target["height"],
            "mode": "RGB",
            "rgb_sha256": _digest(rendered_rgb),
        },
    }


def _encode_receipt(receipt: dict[str, Any]) -> bytes:
    encoded = (json.dumps(receipt, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if not 0 < len(encoded) <= briefs.MAX_JSON_BYTES:
        raise _fail("delivery receipt exceeds its bounded JSON size")
    return encoded


def _fsync_file(handle: BinaryIO) -> None:
    handle.flush()
    os.fsync(handle.fileno())


def _write_exclusive(path: Path, data: bytes, label: str) -> None:
    if path.exists() or briefs._is_reparse(path):
        raise _fail(f"{label} already exists; refusing to overwrite")
    try:
        with path.open("xb") as handle:
            handle.write(data)
            _fsync_file(handle)
    except FileExistsError as exc:
        raise _fail(f"{label} already exists; refusing to overwrite") from exc


def _verify_output(
    path: Path, encoded_png: bytes, rendered_rgb: bytes, target: dict[str, Any],
) -> bytes:
    actual_png = retained._read_unlinked(path, retained.MAX_IMAGE_BYTES, "delivery output")
    if actual_png != encoded_png:
        raise _fail("delivery output bytes differ from the independent render")
    actual_rgb = _inspect_png(
        actual_png, (target["width"], target["height"]), "delivery output",
    )
    if actual_rgb != rendered_rgb:
        raise _fail("delivery output RGB pixels differ from the independent render")
    return actual_png


def _assert_runtime(stored: object, current: dict[str, Any]) -> None:
    if not prep._strict_equal(stored, current):
        raise _fail(RUNTIME_MISMATCH)


def _precommit_replay(
    *, root: Path, request_path: object, request: dict[str, Any],
    request_binding: dict[str, Any], request_data: bytes,
    authority: dict[str, Any], source_data: bytes,
    crop_box: tuple[int, int, int, int], runtime: dict[str, Any], out: object,
    out_dir: Path, receipt: dict[str, Any], receipt_data: bytes,
) -> None:
    again_request, again_binding, again_data = _load_request(root, request_path)
    if again_data != request_data or not prep._strict_equal(again_request, request) \
            or not prep._strict_equal(again_binding, request_binding):
        raise _fail("delivery request changed before publication")
    again_authority = _source_authority(root, again_request)
    if not prep._strict_equal(again_authority, authority):
        raise _fail("visual ruling authority changed before publication")
    again_source = _source_snapshot(root, again_authority)
    if again_source != source_data:
        raise _fail("native source image changed before publication")
    again_runtime = _runtime()
    _assert_runtime(runtime, again_runtime)
    again_crop = _check_crop(
        again_request["crop_box"], again_authority["native_dimensions"],
        again_authority["delivery_target"],
    )
    if again_crop != crop_box:
        raise _fail("delivery crop changed before publication")
    dims = again_authority["native_dimensions"]
    target = again_authority["delivery_target"]
    replay_rgb, replay_png = _render_png(
        again_source, again_crop,
        (dims["width"], dims["height"], target["width"], target["height"]),
    )
    delivery_path = out_dir / DELIVERY_NAME
    _verify_output(delivery_path, replay_png, replay_rgb, target)
    replay_receipt = _receipt(
        out_rel=receipt["out"], request_binding=again_binding,
        authority=again_authority, crop_box=again_crop, runtime=again_runtime,
        rendered_rgb=replay_rgb, encoded_png=replay_png,
    )
    if not prep._strict_equal(replay_receipt, receipt) \
            or _encode_receipt(replay_receipt) != receipt_data:
        raise _fail("delivery receipt reconstruction changed before publication")

    checked_dir, checked_rel = _out_dir(root, out, existing=True)
    if checked_dir != out_dir or checked_rel != receipt["out"]:
        raise _fail("delivery output directory changed before publication")
    pending_path, final_path = out_dir / PENDING_RECEIPT_NAME, out_dir / RECEIPT_NAME
    if final_path.exists() or briefs._is_reparse(final_path):
        raise _fail("final delivery receipt already exists; refusing to overwrite")
    if _read_linkable_receipt(
        pending_path, briefs.MAX_JSON_BYTES, "pending delivery receipt",
    ) != receipt_data:
        raise _fail("pending delivery receipt changed before publication")


def materialize_nonpersona_still_delivery(
    *, root: Path, request_path: str | Path, out: str | Path,
) -> dict[str, Any]:
    """Create one fresh, unreviewed 1080x1440 PNG and its canonical receipt."""
    out_dir: Path | None = None
    try:
        root = _safe_root(Path(root))
        out_dir, out_rel = _out_dir(root, out, existing=False)
        request, request_binding, request_data = _load_request(root, request_path)
        authority = _source_authority(root, request)
        source_data = _source_snapshot(root, authority)
        crop_box = _check_crop(
            request["crop_box"], authority["native_dimensions"],
            authority["delivery_target"],
        )
        current_runtime = _runtime()
        dims, target = authority["native_dimensions"], authority["delivery_target"]
        rendered_rgb, encoded_png = _render_png(
            source_data, crop_box,
            (dims["width"], dims["height"], target["width"], target["height"]),
        )
        if not 0 < len(encoded_png) <= retained.MAX_IMAGE_BYTES:
            raise _fail("rendered delivery PNG exceeds its bounded image size")
        receipt = _receipt(
            out_rel=out_rel, request_binding=request_binding, authority=authority,
            crop_box=crop_box, runtime=current_runtime, rendered_rgb=rendered_rgb,
            encoded_png=encoded_png,
        )
        receipt_data = _encode_receipt(receipt)

        _out_dir(root, out, existing=False)
        out_dir.mkdir(exist_ok=False)
        checked_dir, checked_rel = _out_dir(root, out, existing=True)
        if checked_dir != out_dir or checked_rel != out_rel:
            raise _fail("delivery output directory changed after creation")
        delivery_path = out_dir / DELIVERY_NAME
        pending_path = out_dir / PENDING_RECEIPT_NAME
        final_path = out_dir / RECEIPT_NAME
        for path in (delivery_path, pending_path, final_path):
            if path.exists() or briefs._is_reparse(path):
                raise _fail(f"{path.name} already exists; refusing to overwrite")
        _write_exclusive(delivery_path, encoded_png, "delivery output")
        _verify_output(delivery_path, encoded_png, rendered_rgb, target)
        _write_exclusive(pending_path, receipt_data, "pending delivery receipt")

        _precommit_replay(
            root=root, request_path=request_path, request=request,
            request_binding=request_binding, request_data=request_data,
            authority=authority, source_data=source_data, crop_box=crop_box,
            runtime=current_runtime, out=out, out_dir=out_dir,
            receipt=receipt, receipt_data=receipt_data,
        )
        os.link(pending_path, final_path)  # Sole commit point; nothing fallible follows.
        return receipt
    except ERRORS as exc:
        where = f"; any partial directory at {out_dir} is retained and untrusted" if out_dir is not None else ""
        raise NonpersonaStillDeliveryError(
            f"this call did not publish {RECEIPT_NAME}{where}: {_domain(exc)}"
        ) from exc


def _stored_header(stored: dict[str, Any], out_rel: str) -> None:
    _exact_object(stored, TOP_LEVEL_KEYS, "delivery receipt")
    if stored["schema"] != RECEIPT_SCHEMA \
            or stored["stage"] != "materialized-not-reviewed" \
            or stored["not_promotable"] is not True \
            or stored["delivery_quality"] != "not-assessed" \
            or stored["out"] != out_rel:
        raise _fail("delivery receipt constants or output binding are invalid")
    request = _check_path_binding(
        stored["request"], "request", maximum=briefs.MAX_JSON_BYTES,
    )
    if request["path"] != stored["request"]["path"]:
        raise _fail("delivery receipt request path is not normalized")
    _exact_object(stored["source_authority"], SOURCE_AUTHORITY_KEYS, "source_authority")


def revalidate_nonpersona_still_delivery(
    *, root: Path, out: str | Path,
) -> dict[str, Any]:
    """Reconstruct and return a current delivery receipt from source pixels."""
    try:
        root = _safe_root(Path(root))
        out_dir, out_rel = _out_dir(root, out, existing=True)
        final_path = out_dir / RECEIPT_NAME
        receipt_data = _read_linkable_receipt(
            final_path, briefs.MAX_JSON_BYTES, "delivery receipt",
        )
        stored = retained._parse_retained(receipt_data, "delivery receipt")
        _stored_header(stored, out_rel)
        current_runtime = _runtime()
        _assert_runtime(stored["runtime"], current_runtime)

        request_path = stored["request"]["path"]
        request, request_binding, request_data = _load_request(root, request_path)
        if not prep._strict_equal(request_binding, stored["request"]):
            raise _fail("delivery request differs from its stored binding")
        authority = _source_authority(root, request)
        source_data = _source_snapshot(root, authority)
        crop_box = _check_crop(
            request["crop_box"], authority["native_dimensions"],
            authority["delivery_target"],
        )
        dims, target = authority["native_dimensions"], authority["delivery_target"]
        rendered_rgb, encoded_png = _render_png(
            source_data, crop_box,
            (dims["width"], dims["height"], target["width"], target["height"]),
        )
        if not 0 < len(encoded_png) <= retained.MAX_IMAGE_BYTES:
            raise _fail("reconstructed delivery PNG exceeds its bounded image size")
        delivery_path = out_dir / DELIVERY_NAME
        _verify_output(delivery_path, encoded_png, rendered_rgb, target)
        expected = _receipt(
            out_rel=out_rel, request_binding=request_binding, authority=authority,
            crop_box=crop_box, runtime=current_runtime, rendered_rgb=rendered_rgb,
            encoded_png=encoded_png,
        )
        expected_data = _encode_receipt(expected)
        if not prep._strict_equal(stored, expected) or receipt_data != expected_data:
            raise _fail("delivery receipt is stale, edited, noncanonical, or has unknown fields")

        again_request, again_binding, again_request_data = _load_request(root, request_path)
        again_authority = _source_authority(root, again_request)
        again_source = _source_snapshot(root, again_authority)
        _assert_runtime(current_runtime, _runtime())
        if again_request_data != request_data \
                or not prep._strict_equal(again_request, request) \
                or not prep._strict_equal(again_binding, request_binding) \
                or not prep._strict_equal(again_authority, authority) \
                or again_source != source_data:
            raise _fail("delivery authority inputs changed while revalidating")
        checked_dir, checked_rel = _out_dir(root, out, existing=True)
        if checked_dir != out_dir or checked_rel != out_rel:
            raise _fail("delivery output directory changed while revalidating")
        _verify_output(delivery_path, encoded_png, rendered_rgb, target)
        if _read_linkable_receipt(
            final_path, briefs.MAX_JSON_BYTES, "delivery receipt",
        ) != receipt_data:
            raise _fail("delivery receipt changed while revalidating")
        pending_path = out_dir / PENDING_RECEIPT_NAME
        if pending_path.exists() or briefs._is_reparse(pending_path):
            if _read_linkable_receipt(
                pending_path, briefs.MAX_JSON_BYTES, "pending delivery receipt",
            ) != receipt_data:
                raise _fail("pending delivery receipt differs from the published receipt")
        return expected
    except ERRORS as exc:
        raise _domain(exc) from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Materialize or revalidate one local unreviewed nonpersona still delivery.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build")
    build.add_argument("--root", type=Path, required=True)
    build.add_argument("--request", required=True)
    build.add_argument("--out", required=True)
    revalidate = subparsers.add_parser("revalidate")
    revalidate.add_argument("--root", type=Path, required=True)
    revalidate.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "build":
            materialize_nonpersona_still_delivery(
                root=args.root, request_path=args.request, out=args.out,
            )
        else:
            revalidate_nonpersona_still_delivery(root=args.root, out=args.out)
    except NonpersonaStillDeliveryError as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
