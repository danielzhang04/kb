"""Validate one external visual ruling on one current non-persona delivery PNG.

This module is offline and read-only.  A ruling is an asserted external judgment;
neither its authority nor ``decided_by`` is authenticated here.  Validation binds
that assertion to the exact current delivery receipt, encoded PNG, decoded-RGB
digest, brief, creator, slot, and crop/resize transform.  Every result remains
non-promotable and grants no assignment, publication, or account authority.
"""

from __future__ import annotations

import copy
import importlib.util
import re
import sys
from pathlib import Path
from typing import Any

try:
    from . import nonpersona_still_delivery as delivery
except ImportError:  # Direct module loading outside a package.
    _spec = importlib.util.spec_from_file_location(
        "figment_nonpersona_still_delivery_ruling_authority",
        Path(__file__).with_name("nonpersona_still_delivery.py"),
    )
    if _spec is None or _spec.loader is None:
        raise RuntimeError("nonpersona_still_delivery.py authority is unavailable")
    delivery = importlib.util.module_from_spec(_spec)
    sys.modules[_spec.name] = delivery
    _spec.loader.exec_module(delivery)


retained = delivery.retained
briefs = delivery.briefs
prep = delivery.prep
visual_ruling = delivery.visual_ruling

SCHEMA = "figment/nonpersona-still-delivery-ruling@1"
RESULT_SCHEMA = "figment/nonpersona-still-delivery-ruling-validation@1"
TOP_LEVEL_KEYS = {
    "schema", "delivery", "output", "brief", "creator", "slot",
    "delivery_transform", "authority", "criteria", "decision", "decided_by",
    "decided_at", "note",
}
OUTPUT_KEYS = {"path", "bytes", "sha256", "width", "height", "mode", "rgb_sha256"}
OPERATION_KEYS = {
    "op", "coordinate_space", "crop_box", "crop_dimensions", "resample", "color",
    "source_metadata_policy", "output_format", "encoder", "output_metadata",
}
CRITERIA = {
    "no_person": ("pass", "fail", "not-assessed"),
    "scene_subject_fit": ("pass", "fail", "not-assessed"),
    "realism": ("pass", "fail", "not-assessed"),
    "crop_framing_integrity": ("pass", "fail", "not-assessed"),
    "resize_color_quality": ("pass", "fail", "not-assessed"),
    "obvious_artifacts": ("none", "present", "not-assessed"),
}
ACCEPTING = {
    "no_person": "pass",
    "scene_subject_fit": "pass",
    "realism": "pass",
    "crop_framing_integrity": "pass",
    "resize_color_quality": "pass",
    "obvious_artifacts": "none",
}
AUTHORITIES = ("human-visual-ruling", "research-disposition")
DECISIONS = ("accept-delivery", "reject")
SHA_RE = re.compile(r"[0-9a-f]{64}\Z")


class NonpersonaStillDeliveryRulingError(ValueError):
    """A delivery ruling is invalid or does not bind the current delivery."""


def _fail(message: str) -> NonpersonaStillDeliveryRulingError:
    return NonpersonaStillDeliveryRulingError(message)


def _domain(exc: Exception) -> NonpersonaStillDeliveryRulingError:
    if isinstance(exc, NonpersonaStillDeliveryRulingError):
        return exc
    detail = str(exc) if isinstance(exc, delivery.ERRORS) else "unexpected input"
    return NonpersonaStillDeliveryRulingError(f"{type(exc).__name__}: {detail}")


def _object(value: object, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise _fail(f"{label} must carry exactly {sorted(keys)}")
    return value


def _sha(value: object, label: str) -> str:
    if not isinstance(value, str) or not SHA_RE.fullmatch(value):
        raise _fail(f"{label} must be 64 lowercase hex characters")
    return value


def _positive(value: object, label: str, maximum: int | None = None) -> int:
    if type(value) is not int or value < 1 or (maximum is not None and value > maximum):
        bound = f" no greater than {maximum}" if maximum is not None else ""
        raise _fail(f"{label} must be a positive integer{bound}")
    return value


def _text(value: object, label: str, maximum: int, *, nonempty: bool) -> str:
    if not isinstance(value, str) or value != value.strip() or (nonempty and not value):
        raise _fail(f"{label} must be trimmed text{' and nonempty' if nonempty else ''}")
    if any(
        ord(character) < 0x20
        or 0x7F <= ord(character) <= 0x9F
        or 0xD800 <= ord(character) <= 0xDFFF
        for character in value
    ):
        raise _fail(f"{label} contains control characters or lone surrogates")
    if briefs._utf16_length(value) > maximum:
        raise _fail(f"{label} exceeds {maximum} UTF-16 units")
    return value


def _normalized_relative(value: object, label: str) -> str:
    normalized = delivery._normalized_relative(value, label)
    if normalized is not value and not isinstance(value, Path):
        raise _fail(f"{label} must be a normalized root-relative path")
    return normalized


def _check_output(value: object, label: str) -> dict[str, Any]:
    output = _object(value, OUTPUT_KEYS, label)
    if output["path"] != delivery.DELIVERY_NAME:
        raise _fail(f"{label}.path must be {delivery.DELIVERY_NAME}")
    _positive(output["bytes"], f"{label}.bytes", retained.MAX_IMAGE_BYTES)
    _sha(output["sha256"], f"{label}.sha256")
    if type(output["width"]) is not int or output["width"] != delivery.TARGET["width"] \
            or type(output["height"]) is not int or output["height"] != delivery.TARGET["height"]:
        raise _fail(f"{label} dimensions must be 1080x1440")
    if output["mode"] != "RGB":
        raise _fail(f"{label}.mode must be RGB")
    _sha(output["rgb_sha256"], f"{label}.rgb_sha256")
    return output


def _check_transform(value: object) -> dict[str, Any]:
    transform = _object(value, OPERATION_KEYS, "delivery_transform")
    constants = {
        "op": "crop-resize",
        "coordinate_space": "stored-pixel-grid-half-open",
        "resample": "Pillow.Image.Resampling.LANCZOS",
        "color": "stored-untagged-RGB-no-conversion",
        "source_metadata_policy": (
            "reject-icc-gamma-srgb-chromaticity-transparency-strip-other-ancillary"
        ),
        "output_format": "PNG",
        "output_metadata": "none",
    }
    for field, expected in constants.items():
        if transform[field] != expected:
            raise _fail(f"delivery_transform.{field} is not the supported value")
    crop = transform["crop_box"]
    if not isinstance(crop, list) or len(crop) != 4 or any(type(item) is not int for item in crop):
        raise _fail("delivery_transform.crop_box must contain exactly four integers")
    left, top, right, bottom = crop
    dimensions = _object(
        transform["crop_dimensions"], {"width", "height"},
        "delivery_transform.crop_dimensions",
    )
    width = _positive(dimensions["width"], "delivery_transform.crop_dimensions.width")
    height = _positive(dimensions["height"], "delivery_transform.crop_dimensions.height")
    if width != right - left or height != bottom - top:
        raise _fail("delivery_transform.crop_dimensions differ from crop_box")
    encoder = _object(
        transform["encoder"], {"optimize", "compress_level"},
        "delivery_transform.encoder",
    )
    if encoder["optimize"] is not False or type(encoder["compress_level"]) is not int \
            or encoder["compress_level"] != 9:
        raise _fail("delivery_transform.encoder is not the supported value")
    return transform


def _check_ruling(ruling: dict[str, Any]) -> None:
    _object(ruling, TOP_LEVEL_KEYS, "delivery ruling")
    if ruling["schema"] != SCHEMA:
        raise _fail(f"delivery ruling schema must be {SCHEMA}")

    delivery_binding = _object(
        ruling["delivery"], {"out", "record_sha256"}, "delivery",
    )
    _normalized_relative(delivery_binding["out"], "delivery.out")
    _sha(delivery_binding["record_sha256"], "delivery.record_sha256")
    _check_output(ruling["output"], "output")

    brief = _object(ruling["brief"], {"path", "sha256"}, "brief")
    _normalized_relative(brief["path"], "brief.path")
    _sha(brief["sha256"], "brief.sha256")
    _text(ruling["creator"], "creator", briefs.MAX_TEXT, nonempty=True)

    slot = _object(ruling["slot"], {"index", "role", "taxonomy_type", "kind"}, "slot")
    _positive(slot["index"], "slot.index")
    _text(slot["role"], "slot.role", briefs.MAX_ROLE, nonempty=True)
    if slot["taxonomy_type"] not in prep.ALLOWED_NONPERSONA_TYPES or slot["kind"] != "nonpersona":
        raise _fail("slot must be a C/D/E nonpersona slot")
    _check_transform(ruling["delivery_transform"])

    if ruling["authority"] not in AUTHORITIES:
        raise _fail("authority is not a supported value")
    if ruling["decision"] not in DECISIONS:
        raise _fail("decision is not a supported value")
    criteria = _object(ruling["criteria"], set(CRITERIA), "criteria")
    for name, allowed in CRITERIA.items():
        if criteria[name] not in allowed:
            raise _fail(f"criteria.{name} is not a supported value")
    if ruling["decision"] == "accept-delivery" and not prep._strict_equal(criteria, ACCEPTING):
        raise _fail("accept-delivery requires every delivery criterion to pass with no artifacts")
    _text(ruling["decided_by"], "decided_by", visual_ruling.MAX_DECIDED_BY, nonempty=True)
    _text(ruling["note"], "note", visual_ruling.MAX_NOTE, nonempty=False)
    visual_ruling._timestamp(ruling["decided_at"])


def _fixed_child(root: Path, out_dir: Path, out_rel: str, name: str, label: str) -> Path:
    path, relative = delivery._safe_input(root, f"{out_rel}/{name}", label)
    if path.parent != out_dir or relative != f"{out_rel}/{name}":
        raise _fail(f"{label} is not the fixed delivery child")
    return path


def _current_snapshot(root: Path, out: str, record_sha256: str) -> dict[str, Any]:
    """One receipt-before/revalidator/receipt-after/output snapshot."""
    try:
        out_dir, out_rel = delivery._out_dir(root, out, existing=True)
        receipt_path = _fixed_child(
            root, out_dir, out_rel, delivery.RECEIPT_NAME, "delivery receipt",
        )
        output_path = _fixed_child(
            root, out_dir, out_rel, delivery.DELIVERY_NAME, "delivery output",
        )
        receipt_before = delivery._read_linkable_receipt(
            receipt_path, briefs.MAX_JSON_BYTES, "delivery receipt",
        )
        current = delivery.revalidate_nonpersona_still_delivery(root=root, out=out_rel)
        receipt_after = delivery._read_linkable_receipt(
            receipt_path, briefs.MAX_JSON_BYTES, "delivery receipt",
        )
        output_data = retained._read_unlinked(
            output_path, retained.MAX_IMAGE_BYTES, "delivery output",
        )
    except NonpersonaStillDeliveryRulingError:
        raise
    except delivery.ERRORS as exc:
        raise _fail(f"current delivery rejected: {exc}") from exc

    if not receipt_before or receipt_before != receipt_after:
        raise _fail("delivery ruling or current delivery changed while validating")
    if delivery._digest(receipt_before) != record_sha256:
        raise _fail("delivery receipt differs from the ruling binding")
    _object(current, delivery.TOP_LEVEL_KEYS, "current delivery receipt")
    if current["schema"] != delivery.RECEIPT_SCHEMA \
            or current["stage"] != "materialized-not-reviewed" \
            or current["not_promotable"] is not True \
            or current["delivery_quality"] != "not-assessed" \
            or current["out"] != out_rel:
        raise _fail("current delivery receipt schema or constants are invalid")
    output = _check_output(current["output"], "current delivery output")
    if len(output_data) != output["bytes"] or delivery._digest(output_data) != output["sha256"]:
        raise _fail("current delivery rejected: delivery output differs from its producer binding")
    return {
        "current": current,
        "receipt": receipt_before,
        "output": output_data,
        "out": out_rel,
    }


def _projections(current: dict[str, Any]) -> dict[str, Any]:
    authority = current["source_authority"]
    return {
        "output": current["output"],
        "brief": authority["brief"],
        "creator": authority["creator"],
        "slot": authority["slot"],
        "delivery_transform": current["operation"],
    }


def _require_associations(ruling: dict[str, Any], projections: dict[str, Any]) -> None:
    checks = (
        ("output", "delivery output differs from the ruling output"),
        ("brief", "delivery ruling brief differs from the current delivery brief"),
        ("creator", "delivery ruling creator differs from the current delivery creator"),
        ("slot", "delivery ruling slot differs from the current delivery slot"),
        (
            "delivery_transform",
            "delivery ruling transform differs from the current delivery transform",
        ),
    )
    for field, message in checks:
        if not prep._strict_equal(ruling[field], projections[field]):
            raise _fail(message)


def _candidate(
    *, ruling: dict[str, Any], ruling_path: str, ruling_data: bytes,
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    current = snapshot["current"]
    fields = _projections(current)
    return {
        "schema": RESULT_SCHEMA,
        "not_promotable": True,
        "ruling": {
            "path": ruling_path,
            "bytes": len(ruling_data),
            "sha256": delivery._digest(ruling_data),
        },
        "delivery": {
            "out": snapshot["out"],
            "path": delivery.RECEIPT_NAME,
            "bytes": len(snapshot["receipt"]),
            "sha256": delivery._digest(snapshot["receipt"]),
        },
        "output": copy.deepcopy(fields["output"]),
        "brief": copy.deepcopy(fields["brief"]),
        "creator": fields["creator"],
        "slot": copy.deepcopy(fields["slot"]),
        "delivery_transform": copy.deepcopy(fields["delivery_transform"]),
        "authority": ruling["authority"],
        "criteria": copy.deepcopy(ruling["criteria"]),
        "decision": ruling["decision"],
        "decided_by": ruling["decided_by"],
        "decided_at": ruling["decided_at"],
        "note": ruling["note"],
    }


def validate_nonpersona_still_delivery_ruling(
    *, root: Path, path: str | Path, expected_sha256: str,
) -> dict[str, Any]:
    """Validate one ruling against two complete snapshots of the current delivery."""
    try:
        _sha(expected_sha256, "expected_sha256")
        root = delivery._safe_root(Path(root))
        input_value = path.as_posix() if isinstance(path, Path) else path
        ruling_file, ruling_rel = delivery._safe_input(root, input_value, "delivery ruling")
        ruling_data = retained._read_unlinked(
            ruling_file, briefs.MAX_JSON_BYTES, "delivery ruling",
        )
        if delivery._digest(ruling_data) != expected_sha256:
            raise _fail("delivery ruling bytes differ from expected_sha256")
        ruling = retained._parse_retained(ruling_data, "delivery ruling")
        _check_ruling(ruling)

        binding = ruling["delivery"]
        out = _normalized_relative(binding["out"], "delivery.out")
        first = _current_snapshot(root, out, binding["record_sha256"])
        first_fields = _projections(first["current"])
        _require_associations(ruling, first_fields)
        first_candidate = _candidate(
            ruling=ruling, ruling_path=ruling_rel, ruling_data=ruling_data, snapshot=first,
        )

        second = _current_snapshot(root, out, binding["record_sha256"])
        second_fields = _projections(second["current"])
        _require_associations(ruling, second_fields)
        second_candidate = _candidate(
            ruling=ruling, ruling_path=ruling_rel, ruling_data=ruling_data, snapshot=second,
        )
        try:
            unchanged_ruling = retained._read_unlinked(
                ruling_file, briefs.MAX_JSON_BYTES, "delivery ruling",
            )
        except delivery.ERRORS as exc:
            raise _fail("delivery ruling or current delivery changed while validating") from exc
        if not prep._strict_equal(first["current"], second["current"]) \
                or first["receipt"] != second["receipt"] \
                or first["output"] != second["output"] \
                or not prep._strict_equal(first_fields, second_fields) \
                or not prep._strict_equal(first_candidate, second_candidate) \
                or unchanged_ruling != ruling_data:
            raise _fail("delivery ruling or current delivery changed while validating")
        return copy.deepcopy(first_candidate)
    except NonpersonaStillDeliveryRulingError:
        raise
    except delivery.ERRORS as exc:
        raise _domain(exc) from exc
