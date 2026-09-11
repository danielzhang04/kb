"""Validate one externally supplied visual ruling on a retained non-persona image.

Offline and read-only. A ruling is an attributed assertion written elsewhere; this
module never writes, approves, or authenticates one. ``authority`` and ``decided_by``
are recorded claims, not verified identities, and neither authority grants
publication or production approval. A ``research-disposition`` stays a research
judgment even when its decision is ``accept-native``.

The ruling binds one retained image to its original brief and slot. Validation
follows the existing chain retained record -> compilation record -> preparation ->
brief, hashing and strictly parsing the same bounded bytes at each step, so a ruling
on a same-shaped slot of a different brief is rejected. The whole chain is checked
twice and must agree; the result reflects only that current consistent chain and
carries no approved or bindable flag. Callers must inspect authority, decision,
criteria, and brief themselves.
"""

from __future__ import annotations

import copy
import importlib.util
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from . import nonpersona_retained as retained
except ImportError:  # Direct script execution.
    _spec = importlib.util.spec_from_file_location(
        "figment_nonpersona_visual_ruling_retained", Path(__file__).with_name("nonpersona_retained.py"),
    )
    if _spec is None or _spec.loader is None:
        raise RuntimeError("nonpersona_retained.py authority is unavailable")
    retained = importlib.util.module_from_spec(_spec)
    sys.modules[_spec.name] = retained
    _spec.loader.exec_module(retained)

native, briefs, prep = retained.native, retained.briefs, retained.prep

SCHEMA = "figment/nonpersona-visual-ruling@1"
RESULT_SCHEMA = "figment/nonpersona-visual-ruling-validation@1"
KEYS = {"schema", "retained", "image", "brief", "slot", "authority", "criteria",
        "delivery_quality", "decision", "decided_by", "decided_at", "note"}
AUTHORITIES = ("human-visual-ruling", "research-disposition")
DECISIONS = ("accept-native", "reject")
VERDICT = ("pass", "fail", "not-assessed")
CRITERIA = {"no_person": VERDICT, "scene_subject_fit": VERDICT, "realism": VERDICT,
            "obvious_artifacts": ("none", "present", "not-assessed"), "native_quality": VERDICT}
ACCEPTING = {"no_person": "pass", "scene_subject_fit": "pass", "realism": "pass",
             "obvious_artifacts": "none", "native_quality": "pass"}
MAX_DECIDED_BY, MAX_NOTE = 256, 512
SHA_RE = re.compile(r"[0-9a-f]{64}\Z")
TIME_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z\Z")
IMAGE_PATH_RE = re.compile(r"run/[^/\\]+\.png\Z")


class NonpersonaVisualRulingError(ValueError):
    """A visual ruling does not bind to a current retained non-persona image."""


def _fail(message: str) -> NonpersonaVisualRulingError:
    return NonpersonaVisualRulingError(message)


def _domain(exc: Exception) -> NonpersonaVisualRulingError:
    if isinstance(exc, NonpersonaVisualRulingError):
        return exc
    # Helper errors carry authored messages; anything else reports only its type.
    detail = str(exc) if isinstance(exc, (ValueError, OSError)) else "unexpected input"
    return NonpersonaVisualRulingError(f"{type(exc).__name__}: {detail}")


def _object(value: object, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise _fail(f"{label} must carry exactly {sorted(keys)}")
    return value


def _sha(value: object, label: str) -> str:
    if not isinstance(value, str) or not SHA_RE.match(value):
        raise _fail(f"{label} must be 64 lowercase hex characters")
    return value


def _positive(value: object, label: str) -> int:
    if type(value) is not int or value < 1:
        raise _fail(f"{label} must be a positive integer")
    return value


def _text(value: object, label: str, maximum: int, *, nonempty: bool) -> str:
    if not isinstance(value, str) or value != value.strip() or (nonempty and not value):
        raise _fail(f"{label} must be trimmed text{' and nonempty' if nonempty else ''}")
    if any(ord(ch) < 0x20 or 0x7F <= ord(ch) <= 0x9F or 0xD800 <= ord(ch) <= 0xDFFF for ch in value):
        raise _fail(f"{label} contains control characters or lone surrogates")
    if briefs._utf16_length(value) > maximum:
        raise _fail(f"{label} exceeds {maximum} UTF-16 units")
    return value


def _timestamp(value: object) -> str:
    if not isinstance(value, str) or not TIME_RE.match(value):
        raise _fail("decided_at must be a UTC ISO-8601 timestamp ending in Z")
    fmt = "%Y-%m-%dT%H:%M:%S.%f" if "." in value else "%Y-%m-%dT%H:%M:%S"
    try:
        datetime.strptime(value[:-1], fmt)
    except ValueError as exc:
        raise _fail("decided_at is not a real calendar time") from exc
    return value


def _check_ruling(ruling: dict[str, Any]) -> None:
    """Strict shape and internal consistency; nothing here is trusted against disk yet."""
    _object(ruling, KEYS, "visual ruling")
    if ruling["schema"] != SCHEMA:
        raise _fail(f"visual ruling schema must be {SCHEMA}")
    ref = _object(ruling["retained"], {"out", "record_sha256"}, "retained")
    briefs._relative(ref["out"], "retained.out")
    _sha(ref["record_sha256"], "retained.record_sha256")
    image = _object(ruling["image"], {"cell_id", "path", "sha256", "width", "height"}, "image")
    if not isinstance(image["cell_id"], str) or not image["cell_id"] \
            or not isinstance(image["path"], str) or not IMAGE_PATH_RE.match(image["path"]):
        raise _fail("image cell_id or path is malformed")
    _sha(image["sha256"], "image.sha256")
    _positive(image["width"], "image.width")
    _positive(image["height"], "image.height")
    brief = _object(ruling["brief"], {"path", "sha256"}, "brief")
    briefs._relative(brief["path"], "brief.path")
    _sha(brief["sha256"], "brief.sha256")
    slot = _object(ruling["slot"], {"index", "role", "taxonomy_type", "kind"}, "slot")
    _positive(slot["index"], "slot.index")
    if not isinstance(slot["role"], str) or not slot["role"] or slot["kind"] != "nonpersona" \
            or slot["taxonomy_type"] not in prep.ALLOWED_NONPERSONA_TYPES:
        raise _fail("slot role, taxonomy_type, or kind is malformed")
    if ruling["authority"] not in AUTHORITIES or ruling["decision"] not in DECISIONS:
        raise _fail("authority or decision is not a supported value")
    criteria = _object(ruling["criteria"], set(CRITERIA), "criteria")
    for name, allowed in CRITERIA.items():
        if criteria[name] not in allowed:
            raise _fail(f"criteria.{name} is not a supported value")
    if ruling["delivery_quality"] != "not-assessed":
        raise _fail("delivery_quality must be not-assessed; no delivery surface exists")
    if ruling["decision"] == "accept-native" and criteria != ACCEPTING:
        raise _fail("accept-native requires every criterion to pass with no artifacts")
    _text(ruling["decided_by"], "decided_by", MAX_DECIDED_BY, nonempty=True)
    _text(ruling["note"], "note", MAX_NOTE, nonempty=False)
    _timestamp(ruling["decided_at"])


def _bound_json(path: Path, binding: object, label: str) -> tuple[bytes, dict[str, Any]]:
    """Read, bind to an exact stored {path, bytes, sha256}, then strictly parse."""
    data = native._read_bounded(path, label)
    if not isinstance(binding, dict) or set(binding) != {"path", "bytes", "sha256"} \
            or binding["bytes"] != len(data) or type(binding["bytes"]) is not int \
            or binding["sha256"] != retained._digest(data):
        raise _fail(f"{label} bytes differ from their stored binding")
    return data, retained._parse_retained(data, label)


def _chain(root: Path, ruling: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    """Current retained record joined down to its original brief, plus snapshot digests."""
    out = ruling["retained"]["out"]
    record = retained.revalidate_nonpersona_retained(root=root, out=out)
    out_dir, out_rel = native._out_dir(root, out, existing=True)
    record_data = native._read_bounded(out_dir / retained.RECORD_NAME, "retained record")
    if out_rel != out or record.get("out") != out or record_data != retained._encode(record) \
            or retained._digest(record_data) != ruling["retained"]["record_sha256"]:
        raise _fail("retained record is not the supplied, currently revalidated record")
    if record.get("delivery_transform") is not None:
        raise _fail("retained record carries a delivery transform")

    compilation_data, compilation = _bound_json(
        out_dir / native.RECORD_NAME, record["compilation"], "compilation record")
    if record["compilation"]["path"] != native.RECORD_NAME or compilation.get("out") != out:
        raise _fail("retained record does not bind this directory's compilation record")
    binding = compilation.get("preparation")
    if not isinstance(binding, dict):
        raise _fail("compilation record preparation binding is malformed")
    prep_file = prep._safe_input(root, binding.get("path"), "preparation")
    prep_data, preparation = _bound_json(prep_file, binding, "preparation")

    slot, creator = record["slot"], record["creator"]
    if not (prep._strict_equal(compilation.get("slot"), slot)
            and prep._strict_equal(preparation.get("slot"), slot)
            and compilation.get("creator") == creator == preparation.get("creator")):
        raise _fail("retained, compilation, and preparation disagree on creator or slot")
    brief = preparation.get("brief")
    if not isinstance(brief, dict) or set(brief) != {"path", "sha256"}:
        raise _fail("preparation brief binding is malformed")
    brief_data = native._read_bounded(prep._safe_input(root, brief["path"], "brief"), "brief")
    if retained._digest(brief_data) != brief["sha256"]:
        raise _fail("original brief changed after preparation")
    if not prep._strict_equal(ruling["brief"], brief):
        raise _fail("ruling brief is not the retained image's original brief")
    if not prep._strict_equal(ruling["slot"], slot):
        raise _fail("ruling slot is not the retained image's slot")

    keys = ("cell_id", "path", "sha256", "width", "height")
    matches = [entry for entry in record["images"]
               if prep._strict_equal({key: entry.get(key) for key in keys}, ruling["image"])]
    if len(matches) != 1 or matches[0].get("review_eligible") is not True:
        raise _fail("ruling image does not match exactly one review-eligible retained image")

    fields = {
        "retained": {"out": out, "path": retained.RECORD_NAME,
                     "bytes": len(record_data), "sha256": retained._digest(record_data)},
        "image": copy.deepcopy(matches[0]), "brief": copy.deepcopy(brief),
        "creator": creator, "slot": copy.deepcopy(slot),
        "native_dimensions": copy.deepcopy(record["native_dimensions"]),
        "delivery_target": copy.deepcopy(record["delivery_target"]),
    }
    snapshots = {label: retained._digest(data) for label, data in (
        ("retained", record_data), ("compilation", compilation_data),
        ("preparation", prep_data), ("brief", brief_data))}
    return fields, snapshots


def validate_nonpersona_visual_ruling(
    *, root: Path, path: str | Path, expected_sha256: str,
) -> dict[str, Any]:
    """Return a deterministic validation of one ruling against the current retained chain.

    Read-only; raises NonpersonaVisualRulingError on any mismatch or changed input.
    """
    try:
        _sha(expected_sha256, "expected_sha256")
        root = briefs._safe_root(Path(root))
        ruling_file = prep._safe_input(root, path, "visual ruling")
        data = retained._read_unlinked(ruling_file, briefs.MAX_JSON_BYTES, "visual ruling")
        if retained._digest(data) != expected_sha256:
            raise _fail("visual ruling bytes differ from expected_sha256")
        ruling = retained._parse_retained(data, "visual ruling")
        _check_ruling(ruling)
        fields, snapshots = _chain(root, ruling)
        # Second full pass: every bound snapshot and the retained authority must still agree.
        again, again_snapshots = _chain(root, ruling)
        if not prep._strict_equal(again, fields) or again_snapshots != snapshots or \
                retained._read_unlinked(ruling_file, briefs.MAX_JSON_BYTES, "visual ruling") != data:
            raise _fail("ruling or its bound chain changed while validating")
        return {
            "schema": RESULT_SCHEMA,
            "not_promotable": True,
            "ruling": {"path": ruling_file.relative_to(root).as_posix(),
                       "bytes": len(data), "sha256": expected_sha256},
            **fields,
            "authority": ruling["authority"],
            "criteria": copy.deepcopy(ruling["criteria"]),
            "decision": ruling["decision"],
            "decided_by": ruling["decided_by"],
            "decided_at": ruling["decided_at"],
            "note": ruling["note"],
            "delivery_quality": "not-assessed",
            "delivery_transform": None,
        }
    except retained.ERRORS as exc:
        raise _domain(exc) from exc
