"""Bounded module-07 inputs. Approval authority is injected from the existing driver.

This module neither grants approval nor starts a process. Its records describe exact
input bytes and retain the operator's existing approval evidence for revalidation.
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import re
from datetime import datetime
from pathlib import Path

from PIL import Image

REQUEST_SCHEMA = "figment/tensor-edit-request@1"
PASSPORT_SCHEMA = "figment/registered-passport-authority@1"
MAX_JSON_BYTES = 128 * 1024
MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_PIXELS = 16_777_216
MAX_DIMENSION = 8192
JOB_TYPES = frozenset({"start-frame-head-swap", "still-touch-up"})
_SPEC = importlib.util.spec_from_file_location(
    "_figment_tensor_edit_frame_paths", Path(__file__).parent / "video/frame_extract.py")
_PATHS = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_PATHS)


class EditInputError(ValueError):
    pass


def canonical_sha256(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode("utf-8")).hexdigest()


def _keys(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise EditInputError("edit input has missing or unsupported fields")


def _digest(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise EditInputError("edit input requires a lowercase SHA256")
    return value


def _path(value, base):
    if not isinstance(value, str) or not value or ".." in Path(value).parts:
        raise EditInputError("edit path is empty or contains traversal")
    path = Path(value)
    if not path.is_absolute():
        path = base / path
    try:
        parent = _PATHS._root(path.parent)
        return _PATHS._within(parent, Path(path.name), "edit input")
    except (OSError, ValueError) as exc:
        raise EditInputError(f"unsafe edit input path: {exc}") from exc


def file_binding(value, base, *, limit=MAX_IMAGE_BYTES, image=False):
    """Read one link-free bounded file and bind the same bytes that were decoded."""
    _keys(value, {"path", "sha256"})
    path = _path(value["path"], base)
    digest = _digest(value["sha256"])
    try:
        if not path.is_file() or not 0 < path.stat().st_size <= limit:
            raise EditInputError("edit file is empty, nonregular or oversized")
        raw = bytearray()
        hashed = hashlib.sha256()
        total = 0
        with path.open("rb") as handle:
            while chunk := handle.read(min(1024 * 1024, limit - total + 1)):
                total += len(chunk)
                if total > limit:
                    raise EditInputError("edit file exceeds bounded size")
                hashed.update(chunk)
                if image:
                    raw.extend(chunk)
        if hashed.hexdigest() != digest:
            raise EditInputError("edit input bytes differ from approved hash")
        result = {"path": str(path), "bytes": total, "sha256": digest}
        if image:
            with Image.open(io.BytesIO(raw), formats=("PNG", "JPEG", "WEBP")) as decoded:
                width, height = decoded.size
                if (not 0 < width <= MAX_DIMENSION or not 0 < height <= MAX_DIMENSION
                        or width * height > MAX_PIXELS or getattr(decoded, "n_frames", 1) != 1
                        or decoded.getexif().get(274, 1) != 1):
                    raise EditInputError("edit image dimensions, animation or orientation unsupported")
                decoded.load()
                result.update(width=width, height=height, format=decoded.format)
        return result
    except (OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise EditInputError(f"edit input cannot be safely decoded: {exc}") from exc


def _json_binding(value, base, *, raw=None):
    _keys(value, {"path", "sha256"})
    path = _path(value["path"], base)
    digest = _digest(value["sha256"])
    try:
        raw = _bounded_bytes(path, MAX_JSON_BYTES) if raw is None else raw
        if not 0 < len(raw) <= MAX_JSON_BYTES:
            raise EditInputError("edit JSON is empty or oversized")
        if hashlib.sha256(raw).hexdigest() != digest:
            raise EditInputError("edit JSON changed while reading")
        binding = {"path": str(path), "bytes": len(raw), "sha256": digest}
        def unique(pairs):
            result = {}
            for key, item in pairs:
                if key in result:
                    raise EditInputError("edit JSON has duplicate keys")
                result[key] = item
            return result
        document = json.loads(raw, object_pairs_hook=unique)
        if not isinstance(document, dict):
            raise EditInputError("edit JSON must be an object")
        return document, binding
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise EditInputError("edit JSON is malformed") from exc


def _bounded_bytes(path, limit):
    with path.open("rb") as handle:
        raw = handle.read(limit + 1)
    if not 0 < len(raw) <= limit:
        raise EditInputError("edit JSON is empty or oversized")
    return raw


def registered_passport_authority(creator, persona, source_plan, image_id, *, validated_anchor):
    """Adapt an already-verified original anchor approval to current passport bytes.

    ``validated_anchor`` MUST validate the original reviewed/settled anchor transition,
    gate, operator ruling and selected output using the driver's existing lineage.
    A supplied receipt hash alone is never an alternative to that callback.
    """
    source_plan = _path(str(source_plan), Path.cwd())
    approved = validated_anchor(creator, source_plan, image_id)
    if not isinstance(approved, dict) or approved.get("image_id") != image_id:
        raise EditInputError("original anchor authority did not validate selected image")
    persona_path = _path(persona.get("_persona_path"), Path.cwd())
    references = persona.get("identity", {}).get("references")
    if not isinstance(references, list) or len(references) != 1:
        raise EditInputError("registered passport requires exactly one identity reference")
    selected = file_binding({"path": approved["path"], "sha256": approved["sha256"]},
                            source_plan.parent, image=True)
    registered = file_binding({"path": references[0], "sha256": selected["sha256"]},
                              persona_path.parent, image=True)
    chosen_path = _path(str(source_plan.parent / "grade/anchor/chosen-anchor.json"), source_plan.parent)
    if chosen_path.stat().st_size > MAX_JSON_BYTES:
        raise EditInputError("chosen-anchor record oversized")
    chosen_raw = _bounded_bytes(chosen_path, MAX_JSON_BYTES)
    if len(chosen_raw) > MAX_JSON_BYTES:
        raise EditInputError("chosen-anchor record oversized")
    chosen, chosen_binding = _json_binding({"path": str(chosen_path),
        "sha256": hashlib.sha256(chosen_raw).hexdigest()}, source_plan.parent, raw=chosen_raw)
    if (chosen.get("schema") != "figment/chosen-anchor@1" or chosen.get("creator") != creator
            or chosen.get("image_id") != image_id or chosen.get("sha256") != selected["sha256"]
            or _path(chosen.get("path"), source_plan.parent) != Path(registered["path"])):
        raise EditInputError("chosen anchor does not match current registered passport")
    proof = {
        "schema": PASSPORT_SCHEMA, "creator": creator, "fixture": bool(approved.get("fixture", False)),
        "image": {**registered, "image_id": image_id}, "source_plan": approved["source_plan"],
        "chosen_anchor": chosen_binding, "approval_lineage": approved["approval_lineage"],
        "rulings": approved["rulings"], "registered_reference": references[0],
    }
    proof["authority_sha256"] = canonical_sha256(proof)
    return proof


def read_request(path, creator, *, resolve_identity):
    """Resolve one explicit image pair; return frozen inputs, never staged copies."""
    path = _path(str(path), Path.cwd())
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_JSON_BYTES:
        raise EditInputError("edit request is empty, nonregular or oversized")
    raw = _bounded_bytes(path, MAX_JSON_BYTES)
    request, request_binding = _json_binding({"path": str(path),
        "sha256": hashlib.sha256(raw).hexdigest()}, path.parent, raw=raw)
    _keys(request, {"schema", "creator", "job_type", "base", "identity", "prompt", "fixture"},
          {"frame_source"})
    if (request["schema"] != REQUEST_SCHEMA or request["creator"] != creator
            or not isinstance(request["job_type"], str) or request["job_type"] not in JOB_TYPES
            or type(request["fixture"]) is not bool):
        raise EditInputError("edit request schema, creator, job type or fixture flag invalid")
    base = file_binding(request["base"], path.parent, image=True)
    identity_spec = request["identity"]
    _keys(identity_spec, {"kind", "source_plan", "image_id"})
    if not isinstance(identity_spec["kind"], str) or identity_spec["kind"] not in {"passport", "approved-gen"}:
        raise EditInputError("edit identity must be a registered passport or approved gen still")
    if not isinstance(identity_spec["image_id"], str) or not identity_spec["image_id"]:
        raise EditInputError("edit identity requires an image id")
    identity_plan = _path(identity_spec["source_plan"], path.parent)
    authority = resolve_identity(identity_spec["kind"], identity_plan, identity_spec["image_id"])
    if not isinstance(authority, dict) or type(authority.get("fixture")) is not bool:
        raise EditInputError("identity resolver did not return explicit fixture provenance")
    if authority["fixture"] and not request["fixture"]:
        raise EditInputError("fixture identity cannot be promoted to live edit input")
    identity = file_binding({"path": authority["image"]["path"],
                             "sha256": authority["image"]["sha256"]}, path.parent, image=True)
    if (base["sha256"] == identity["sha256"] or
            Path(base["path"]).name.casefold() == Path(identity["path"]).name.casefold()):
        raise EditInputError("edit image roles require distinct bytes and upload basenames")
    prompt = request["prompt"]
    _keys(prompt, {"text", "sha256", "decided_by", "decided_at"})
    if any(not isinstance(prompt[k], str) or not prompt[k].strip()
           for k in ("text", "decided_by", "decided_at")) or len(prompt["text"]) > 16000:
        raise EditInputError("edit prompt requires bounded text and attributed decision")
    if hashlib.sha256(prompt["text"].encode("utf-8")).hexdigest() != _digest(prompt["sha256"]):
        raise EditInputError("edit prompt text differs from approved hash")
    try:
        decided_at = datetime.fromisoformat(prompt["decided_at"].replace("Z", "+00:00"))
        if decided_at.tzinfo is None or decided_at.utcoffset() is None:
            raise ValueError("timezone required")
    except ValueError as exc:
        raise EditInputError("edit prompt decision requires a timezone-aware timestamp") from exc
    result = {"schema": REQUEST_SCHEMA, "creator": creator, "job_type": request["job_type"],
              "fixture": request["fixture"], "base": base, "identity": identity,
              "identity_authority": authority, "prompt": prompt, "request": request_binding}
    if request["job_type"] == "start-frame-head-swap":
        frame = request.get("frame_source")
        _keys(frame, {"clip", "extraction_receipt", "frame_index"})
        if type(frame["frame_index"]) is not int or frame["frame_index"] != 0:
            raise EditInputError("head-swap start frame must be exact frame0")
        clip = file_binding(frame["clip"], path.parent, limit=_PATHS.MAX_VIDEO_BYTES)
        receipt, evidence = _json_binding(frame["extraction_receipt"], path.parent)
        if (not isinstance(receipt.get("video_before"), dict)
                or not isinstance(receipt.get("video_after"), dict)
                or not isinstance(receipt.get("frames"), list)
                or not 1 <= len(receipt["frames"]) <= 3
                or receipt.get("schema") != _PATHS.SCHEMA or receipt.get("video_before") != receipt.get("video_after")
                or any(receipt.get("video_before", {}).get(k) != clip[k] for k in ("bytes", "sha256"))):
            raise EditInputError("frame extraction receipt does not bind exact driving clip")
        first = [r for r in receipt.get("frames", []) if isinstance(r, dict)
                 and r.get("label") == "first" and type(r.get("index")) is int and r["index"] == 0]
        if len(first) != 1 or any(first[0].get(k) != base[k] for k in ("bytes", "sha256")):
            raise EditInputError("base image is not the recorded exact first frame")
        result["frame_source"] = {"clip": clip, "extraction_receipt": evidence,
                                  "frame_index": 0, "transform": "fixture-declared-frame0-unverified",
                                  "fixture_only": True}
        if not request["fixture"]:
            spec = importlib.util.spec_from_file_location("_tensor_edit_frame_authority",
                Path(__file__).with_name("tensor_video.py"))
            adapter = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(adapter)
            verified = adapter.validate_frame0(clip=frame["clip"], image=request["base"],
                extraction_receipt=frame["extraction_receipt"], base_dir=path.parent)
            result["frame_source"].update(transform="verified-decoded-frame0",
                fixture_only=False, verified=verified)
    elif "frame_source" in request:
        raise EditInputError("still touch-up cannot declare driving clip authority")
    result["input_sha256"] = canonical_sha256(result)
    return result
