#!/usr/bin/env python3
"""Offline, rejected-only adoption of one completed local-Comfy diagnostic.

The tool is an evidence copier. It does not start ComfyUI, contact a provider,
change an approval, or make a training decision. The default validates and
prints a planned provenance record; ``--import`` exclusively publishes one
bounded PNG and its provenance only after the same validation succeeds.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import re
import stat
from pathlib import Path
from typing import Any

from PIL import Image


HERE = Path(__file__).resolve().parent
STUDIO_ROOT = HERE.parents[3]
WORKSPACE_PRIVATE_ROOT = Path(r"C:\Users\danie\kb\_private")
REQUEST_ROOT = WORKSPACE_PRIVATE_ROOT / "figment-local-comfy-generated-input-requests-20260908"
GALLERY_ROOT = WORKSPACE_PRIVATE_ROOT / "figment-single-seed-20260908"
CANONICAL = Path("orgs/figment/personas/creator-001/anchors/g01.jpg")
SCHEMA = "figment/generated-input-experiment@1"
REQUEST_SCHEMA = "figment/local-comfy-generated-input-adoption@1"
LOCAL_SCHEMA = "figment/local-comfy-input@1"
IDENTITY_SCHEMA = "figment/identity-observation@2"
LEGACY_V3_FULL_MANIFEST_SHA256 = "4c1a9fdd6324a4e0fc72b199aeef884145b70b341b787a329d5146074586909e"
MAX_JSON = 128 * 1024
MAX_IMAGE = 8 * 1024 * 1024
MAX_PIXELS = 32_000_000
HEX = re.compile(r"[0-9a-f]{64}\Z")
SAFE_REQUEST = re.compile(r"[a-z0-9][a-z0-9-]{0,95}\.json\Z")
SAFE_IMAGE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.png\Z")
REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
FIXED640_PREPROCESSING = "fixed-max-edge-640@1"
ESTABLISHED_CANDIDATE_UNAVAILABLE = {"no face detected", "multiple faces detected"}


class AdoptionError(ValueError):
    """A local diagnostic record cannot be safely adopted."""


def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _reparse(path: Path) -> bool:
    junction = getattr(os.path, "isjunction", lambda _value: False)
    try:
        return path.is_symlink() or junction(path) or bool(path.lstat().st_file_attributes & REPARSE)
    except (AttributeError, OSError):
        return path.is_symlink() or junction(path)


def _root(path: Path, label: str) -> Path:
    lexical = path.absolute()
    try:
        if not lexical.is_dir() or any(_reparse(item) for item in (lexical, *lexical.parents)):
            raise AdoptionError(f"{label} must be a real directory below the configured root")
        return lexical.resolve(strict=True)
    except OSError as exc:
        raise AdoptionError(f"{label} is unavailable") from exc


def _file(root: Path, path: Path, label: str) -> Path:
    try:
        candidate = path.absolute()
        if not candidate.is_relative_to(root) or any(_reparse(item) for item in (candidate, *candidate.parents)):
            raise AdoptionError(f"{label} escapes its configured root")
        if not candidate.is_file():
            raise AdoptionError(f"{label} must be a regular file")
        resolved = candidate.resolve(strict=True)
        if not resolved.is_relative_to(root):
            raise AdoptionError(f"{label} escapes its configured root")
        return resolved
    except OSError as exc:
        raise AdoptionError(f"cannot inspect {label}") from exc


def _bytes(path: Path, maximum: int, label: str) -> bytes:
    try:
        if _reparse(path) or not path.is_file():
            raise AdoptionError(f"{label} must be a regular file")
        size = path.stat().st_size
        if size < 1 or size > maximum:
            raise AdoptionError(f"{label} exceeds its byte bound")
        with path.open("rb") as handle:
            value = handle.read(maximum + 1)
        if len(value) != size or path.stat().st_size != size:
            raise AdoptionError(f"{label} changed while read")
        return value
    except OSError as exc:
        raise AdoptionError(f"cannot read {label}") from exc


def _json(path: Path, maximum: int, label: str) -> tuple[dict[str, Any], bytes]:
    raw = _bytes(path, maximum, label)
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AdoptionError(f"{label} is not valid JSON") from exc
    if not isinstance(value, dict):
        raise AdoptionError(f"{label} must be a JSON object")
    return value, raw


def _sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise AdoptionError(f"{label} must be a lowercase SHA-256")
    return value


def _text(value: Any, label: str, maximum: int = 512) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or value != value.strip():
        raise AdoptionError(f"{label} must be bounded nonblank text")
    return value


def _png(data: bytes, label: str, expected: tuple[int, int] = (1024, 1024)) -> tuple[int, int]:
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG" or image.size != expected or image.width * image.height > MAX_PIXELS:
                raise AdoptionError(f"{label} dimensions or format are not admitted")
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            image.load()
    except AdoptionError:
        raise
    except (OSError, ValueError) as exc:
        raise AdoptionError(f"{label} is not a decodable PNG") from exc
    if width < 1 or height < 1 or (width, height) != expected or width * height > MAX_PIXELS:
        raise AdoptionError(f"{label} dimensions exceed the bound")
    return width, height


def _canonical(repo_root: Path, expected: str) -> tuple[Path, bytes]:
    repo = _root(repo_root, "studio repository")
    path = _file(repo, repo / CANONICAL, "canonical g01")
    raw = _bytes(path, MAX_IMAGE, "canonical g01")
    if _hash(raw) != expected:
        raise AdoptionError("canonical g01 no longer matches the root-owned request")
    return path, raw


def _request(request_name: str, request_root: Path) -> tuple[dict[str, Any], bytes, Path]:
    if not SAFE_REQUEST.fullmatch(request_name):
        raise AdoptionError("request must be one safe root-owned JSON basename")
    root = _root(request_root, "local-Comfy adoption request root")
    path = _file(root, root / request_name, "local-Comfy adoption request")
    value, raw = _json(path, MAX_JSON, "local-Comfy adoption request")
    required = {
        "schema", "request_id", "run_name", "manifest_sha256", "receipt_sha256", "journal_sha256",
        "dispatch_sha256", "identity_observation_sha256", "canonical_sha256", "target_name",
        "generation_date", "review", "source_derivation",
    }
    if set(value) != required or value.get("schema") != REQUEST_SCHEMA:
        raise AdoptionError("local-Comfy adoption request has unsupported fields")
    _text(value.get("request_id"), "request_id", 96)
    _text(value.get("run_name"), "run_name", 128)
    if Path(value["run_name"]).name != value["run_name"] or not value["run_name"].startswith("figment-local-comfy-"):
        raise AdoptionError("run_name must be a fixed private local-Comfy child")
    for key in ("manifest_sha256", "receipt_sha256", "journal_sha256", "dispatch_sha256", "identity_observation_sha256", "canonical_sha256"):
        _sha(value.get(key), key)
    if not SAFE_IMAGE.fullmatch(str(value.get("target_name", ""))):
        raise AdoptionError("target_name must be one safe PNG basename")
    if not isinstance(value.get("generation_date"), str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value["generation_date"]):
        raise AdoptionError("generation_date must be root-observed YYYY-MM-DD metadata")
    return value, raw, path


def _review(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or value.get("status") != "rejected-as-same-person-candidate" or value.get("training_eligible") is not False:
        raise AdoptionError("only a rejected, training-ineligible local diagnostic may be adopted")
    allowed = {"status", "training_eligible", "adult_presentation", "clothing", "identity", "realism", "coverage", "independent_findings"}
    if set(value) - allowed:
        raise AdoptionError("review has unsupported fields")
    result: dict[str, str] = {}
    for key in allowed - {"status", "training_eligible"}:
        if key in value:
            result[key] = _text(value[key], f"review.{key}")
    if "identity" not in result:
        raise AdoptionError("rejected review must record the identity limitation")
    return result


def _derive(value: Any, canonical_sha: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("independent_view") is not False:
        raise AdoptionError("source derivation must explicitly reject independent-view claims")
    kind = value.get("kind")
    if kind == "sole-canonical-g01":
        if set(value) != {"kind", "original_pixel_sha256", "independent_view"} or value.get("original_pixel_sha256") != canonical_sha:
            raise AdoptionError("direct source derivation must bind canonical g01")
        return {"kind": kind, "original_pixel_sha256": canonical_sha, "independent_view": False}
    if kind == "canonical-g01-crop":
        required = {"kind", "original_pixel_sha256", "crop_sha256", "crop", "independent_view"}
        crop = value.get("crop")
        if set(value) != required or value.get("original_pixel_sha256") != canonical_sha or not isinstance(crop, dict):
            raise AdoptionError("crop derivation must bind canonical g01")
        _sha(value.get("crop_sha256"), "crop_sha256")
        if set(crop) != {"x", "y", "width", "height"} or any(isinstance(crop[key], bool) or not isinstance(crop[key], int) or crop[key] < 0 for key in crop):
            raise AdoptionError("crop derivation must use non-negative integer coordinates")
        if crop["width"] < 1 or crop["height"] < 1:
            raise AdoptionError("crop derivation dimensions must be positive")
        return {"kind": kind, "original_pixel_sha256": canonical_sha, "crop_sha256": value["crop_sha256"], "crop": crop, "independent_view": False}
    raise AdoptionError("source derivation kind is unsupported")


def _candidate_source(value: Any, expected_sha256: str, expected_bytes: int) -> None:
    """Require the raw observer to have hashed these exact candidate bytes twice."""
    if not isinstance(value, dict) or set(value) != {"path", "sha256", "bytes"}:
        raise AdoptionError("identity observation candidate source is malformed")
    if (not isinstance(value["path"], str) or not value["path"]
            or value["sha256"] != expected_sha256 or value["bytes"] != expected_bytes):
        raise AdoptionError("identity observation does not bind the local-Comfy output")


def _identity_observation(identity: dict[str, Any], image: bytes) -> None:
    """Accept raw fixed640 evidence or a known unavailable state, never a verdict."""
    if identity.get("schema") != IDENTITY_SCHEMA:
        raise AdoptionError("identity observation schema is not admitted")
    candidate = identity.get("candidate")
    if not isinstance(candidate, dict):
        raise AdoptionError("identity observation candidate is malformed")
    expected_sha256, expected_bytes = _hash(image), len(image)
    _candidate_source(candidate.get("source_before"), expected_sha256, expected_bytes)
    _candidate_source(candidate.get("source_after"), expected_sha256, expected_bytes)
    reason = candidate.get("unavailable_reason")
    if isinstance(reason, str) and reason in ESTABLISHED_CANDIDATE_UNAVAILABLE:
        return
    if reason is not None:
        raise AdoptionError("identity observation has an unsupported unavailable state")
    preprocessing = candidate.get("detector_preprocessing")
    face = candidate.get("face")
    if (not isinstance(preprocessing, dict) or preprocessing.get("id") != FIXED640_PREPROCESSING
            or preprocessing.get("face_count") != 1 or not isinstance(face, dict)):
        raise AdoptionError("identity observation is not a fixed640 one-face observation")
    anchors = identity.get("anchors")
    if not isinstance(anchors, list) or not 1 <= len(anchors) <= 16:
        raise AdoptionError("identity observation lacks bounded raw anchor observations")
    for anchor in anchors:
        cosine = anchor.get("raw_cosine") if isinstance(anchor, dict) else None
        if (isinstance(cosine, bool) or not isinstance(cosine, (int, float))
                or not math.isfinite(float(cosine)) or anchor.get("unavailable_reason") is not None):
            raise AdoptionError("identity observation raw anchor observations are incomplete")


def _validate_run(request: dict[str, Any], workspace_private: Path, repo_root: Path) -> tuple[dict[str, Any], bytes, dict[str, Any]]:
    private = _root(workspace_private, "workspace private root")
    run = _root(private / request["run_name"], "local-Comfy run root")
    manifest, manifest_raw = _json(_file(run, run / "manifest.json", "local-Comfy manifest"), MAX_JSON, "local-Comfy manifest")
    receipt, receipt_raw = _json(_file(run, run / "receipt.json", "local-Comfy receipt"), MAX_JSON, "local-Comfy receipt")
    journal, journal_raw = _json(_file(run, run / "journal.json", "local-Comfy journal"), MAX_JSON, "local-Comfy journal")
    dispatch, dispatch_raw = _json(_file(run, run / "dispatch-attempt.json", "local-Comfy dispatch marker"), MAX_JSON, "local-Comfy dispatch marker")
    identity, identity_raw = _json(_file(run, run / "identity-fixed640.json", "local-Comfy identity observation"), MAX_JSON, "local-Comfy identity observation")
    for key, raw in (("manifest_sha256", manifest_raw), ("receipt_sha256", receipt_raw), ("journal_sha256", journal_raw), ("dispatch_sha256", dispatch_raw), ("identity_observation_sha256", identity_raw)):
        if _hash(raw) != request[key]:
            raise AdoptionError(f"{key} does not bind the current local-Comfy evidence")
    if receipt != journal or manifest.get("schema") != LOCAL_SCHEMA or manifest.get("diagnostic_only") is not True:
        raise AdoptionError("local-Comfy manifest or journal is not the declared diagnostic")
    if (receipt.get("schema") != LOCAL_SCHEMA or receipt.get("status") != "completed"
            or receipt.get("manifest_sha256") != request["manifest_sha256"]
            or dispatch != {"schema": LOCAL_SCHEMA, "manifest_sha256": request["manifest_sha256"], "attempt": 1}):
        raise AdoptionError("local-Comfy receipt does not bind one completed dispatch")
    teardown = receipt.get("teardown")
    if (not isinstance(teardown, dict) or teardown.get("verified_stopped") is not True
            or teardown.get("unresolved_processes") != [] or teardown.get("teardown_errors") != []):
        raise AdoptionError("local-Comfy teardown is not verified")
    reference = manifest.get("reference")
    if (not isinstance(reference, dict) or reference.get("repo_path") != str(CANONICAL).replace("\\", "/")
            or reference.get("sole_pixel_reference") is not True or reference.get("sha256") != request["canonical_sha256"]):
        raise AdoptionError("local-Comfy manifest does not bind the sole canonical g01")
    _canonical(repo_root, request["canonical_sha256"])
    derivation = _derive(request["source_derivation"], request["canonical_sha256"])
    conditioning = manifest.get("conditioning")
    workflow = manifest.get("workflow")
    api_prompt = workflow.get("api_prompt") if isinstance(workflow, dict) else None
    node = api_prompt.get("2") if isinstance(api_prompt, dict) else None
    if derivation["kind"] == "sole-canonical-g01":
        if (not isinstance(node, dict) or node.get("class_type") != "LoadImage"
                or not isinstance(node.get("inputs"), dict) or node["inputs"].get("image") != "g01.jpg"):
            raise AdoptionError("direct adoption requires a workflow LoadImage of canonical g01")
        if conditioning is None:
            if request["manifest_sha256"] != LEGACY_V3_FULL_MANIFEST_SHA256:
                raise AdoptionError("conditioning-free direct adoption is limited to the known V3 manifest")
        elif (not isinstance(conditioning, dict) or conditioning.get("name") != "full"
                or conditioning.get("materialized") is not False
                or conditioning.get("source_filename") != "g01.jpg"
                or conditioning.get("derivative") is not None):
            raise AdoptionError("direct adoption requires the full canonical-g01 conditioning record")
    else:
        if (not isinstance(conditioning, dict) or conditioning.get("name") != "face-crop384"
                or conditioning.get("materialized") is not True):
            raise AdoptionError("crop adoption requires a materialized local-Comfy crop")
        derivative = conditioning.get("derivative")
        crop_provenance = conditioning.get("crop_provenance")
        if (not isinstance(derivative, dict) or derivative.get("sha256") != derivation["crop_sha256"]
                or not isinstance(crop_provenance, dict) or not isinstance(crop_provenance.get("source"), dict)
                or crop_provenance["source"].get("sha256") != request["canonical_sha256"]
                or not isinstance(crop_provenance.get("derivation"), dict)
                or crop_provenance["derivation"].get("box") != [
                    derivation["crop"]["x"], derivation["crop"]["y"],
                    derivation["crop"]["x"] + derivation["crop"]["width"],
                    derivation["crop"]["y"] + derivation["crop"]["height"],
                ]):
            raise AdoptionError("crop derivation does not bind the materialized canonical crop")
        filename = derivative.get("filename")
        crop_output = crop_provenance.get("output")
        dimensions = derivative.get("dimensions")
        if (not isinstance(filename, str) or not SAFE_IMAGE.fullmatch(filename)
                or not isinstance(crop_output, dict) or crop_output.get("sha256") != derivation["crop_sha256"]
                or crop_output.get("bytes") != derivative.get("bytes")
                or crop_output.get("dimensions") != dimensions
                or not isinstance(dimensions, list) or len(dimensions) != 2
                or any(isinstance(value, bool) or not isinstance(value, int) or value < 1 for value in dimensions)):
            raise AdoptionError("crop provenance output does not bind the materialized derivative")
        crop_path = _file(run, run / "input" / filename, "materialized local-Comfy crop")
        crop_bytes = _bytes(crop_path, MAX_IMAGE, "materialized local-Comfy crop")
        if (_hash(crop_bytes) != derivation["crop_sha256"] or len(crop_bytes) != derivative["bytes"]
                or list(_png(crop_bytes, "materialized local-Comfy crop", tuple(dimensions))) != dimensions):
            raise AdoptionError("materialized local-Comfy crop differs from its provenance")
        if (not isinstance(node, dict) or node.get("class_type") != "LoadImage"
                or not isinstance(node.get("inputs"), dict) or node["inputs"].get("image") != filename):
            raise AdoptionError("local-Comfy workflow does not load the bound materialized crop")
    output = receipt.get("output")
    if not isinstance(output, dict) or not SAFE_IMAGE.fullmatch(str(output.get("filename", ""))):
        raise AdoptionError("local-Comfy receipt output is malformed")
    output_path = _file(run, run / "output" / output["filename"], "local-Comfy output")
    image = _bytes(output_path, MAX_IMAGE, "local-Comfy output")
    width, height = _png(image, "local-Comfy output")
    if (output.get("bytes") != len(image) or output.get("sha256") != _hash(image)
            or output.get("dimensions") != [width, height] or [width, height] != [1024, 1024]):
        raise AdoptionError("local-Comfy output differs from its receipt")
    _identity_observation(identity, image)
    return manifest, image, output


def _provenance(request: dict[str, Any], manifest: dict[str, Any], output: dict[str, Any], image: bytes) -> dict[str, Any]:
    review = _review(request["review"])
    derivation = _derive(request["source_derivation"], request["canonical_sha256"])
    if derivation["kind"] == "canonical-g01-crop":
        conditioning = manifest["conditioning"]
        derivation["crop_provenance"] = conditioning["crop_provenance"]
    models = manifest.get("models")
    workflow = manifest.get("workflow")
    prompt = manifest.get("prompt")
    launcher = manifest.get("launcher")
    if (not isinstance(models, dict) or not isinstance(workflow, dict) or not isinstance(prompt, dict) or not isinstance(launcher, dict)):
        raise AdoptionError("local-Comfy manifest provenance is malformed")
    api_prompt = workflow.get("api_prompt")
    positive, negative = prompt.get("positive"), prompt.get("negative")
    if (not isinstance(api_prompt, dict) or _hash(json.dumps(api_prompt, sort_keys=True, separators=(",", ":")).encode("utf-8")) != _sha(workflow.get("sha256"), "workflow.sha256")
            or not isinstance(positive, str) or not isinstance(negative, str)
            or _hash((positive + "\n" + negative).encode("utf-8")) != _sha(prompt.get("sha256"), "prompt.sha256")):
        raise AdoptionError("local-Comfy prompt or workflow content differs from its declared hash")
    model_hashes = {name: _sha(value.get("sha256"), f"models.{name}.sha256") for name, value in models.items() if name in {"checkpoint", "clip_vision", "ipadapter"} and isinstance(value, dict)}
    if set(model_hashes) != {"checkpoint", "clip_vision", "ipadapter"}:
        raise AdoptionError("local-Comfy manifest lacks one pinned model hash")
    return {
        "schema": SCHEMA,
        "creator": "creator-001",
        "source": {
            "reference": "anchors/g01.jpg", "sha256": request["canonical_sha256"],
            "role": "sole original reference; first generated output from that seed, not an independent view",
            "derivation": derivation,
        },
        "output": {"file": request["target_name"], "sha256": _hash(image), "bytes": len(image), "dimensions": output["dimensions"]},
        "generation": {
            "date": request["generation_date"], "date_basis": "root-observed adoption request; local receipt has no generation timestamp",
            "tool": "local_comfy_input.py", "mode": "local-Comfy availability diagnostic",
            "manifest_sha256": request["manifest_sha256"], "receipt_sha256": request["receipt_sha256"], "journal_sha256": request["journal_sha256"], "dispatch_sha256": request["dispatch_sha256"], "identity_observation_sha256": request["identity_observation_sha256"],
            "prompt_sha256": _sha(prompt.get("sha256"), "prompt.sha256"), "workflow_sha256": _sha(workflow.get("sha256"), "workflow.sha256"), "launcher_sha256": _sha(launcher.get("sha256"), "launcher.sha256"), "model_sha256": model_hashes,
        },
        "review": {"status": "rejected-as-same-person-candidate", "training_eligible": False, "operator_approval": None, **review},
    }


def adopt(request_name: str, *, do_import: bool = False, request_root: Path = REQUEST_ROOT, gallery_root: Path = GALLERY_ROOT, workspace_private: Path = WORKSPACE_PRIVATE_ROOT, repo_root: Path = STUDIO_ROOT) -> dict[str, Any]:
    """Validate one root-owned request and optionally atomically publish its gallery pair."""
    request, _raw, _path = _request(request_name, request_root)
    manifest, image, output = _validate_run(request, workspace_private, repo_root)
    provenance = _provenance(request, manifest, output, image)
    if not do_import:
        return {"status": "planned", "not_promotable": True, "target_name": request["target_name"], "provenance": provenance}
    gallery = _root(gallery_root, "generated-input gallery root")
    target_image = gallery / request["target_name"]
    target_record = gallery / f"{target_image.stem}.provenance.json"
    if target_image.exists() or target_record.exists() or _reparse(target_image) or _reparse(target_record):
        raise AdoptionError("target generated-input pair must be fresh")
    raw = (json.dumps(provenance, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode("utf-8")
    published_image = False
    try:
        _exclusive_write(target_image, image, "gallery output")
        published_image = True
        # The provenance is the gallery's visibility marker: without it, an orphan PNG is not a pair.
        _exclusive_write(target_record, raw, "gallery provenance")
    except BaseException:
        if published_image:
            try:
                if target_image.parent == gallery and not _reparse(target_image) and _hash(_bytes(target_image, MAX_IMAGE, "owned gallery output")) == provenance["output"]["sha256"]:
                    target_image.unlink()
            except (OSError, AdoptionError):
                pass
        raise
    return {"status": "imported", "not_promotable": True, "target_name": request["target_name"], "provenance_sha256": _hash(raw)}


def _exclusive_write(path: Path, data: bytes, label: str) -> None:
    descriptor: int | None = None
    created = False
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        created = True
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        if descriptor is not None:
            os.close(descriptor)
        if created:
            try:
                if not _reparse(path):
                    path.unlink(missing_ok=True)
            except OSError:
                pass
        raise AdoptionError(f"cannot exclusively publish {label}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, help="safe basename under the configured root-owned request directory")
    parser.add_argument("--import", dest="do_import", action="store_true", help="atomically publish the validated rejected diagnostic pair")
    args = parser.parse_args(argv)
    try:
        result = adopt(args.request, do_import=args.do_import)
    except AdoptionError as exc:
        print(f"local-Comfy adoption refused: {exc}")
        return 2
    print(json.dumps({key: value for key, value in result.items() if key != "provenance"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
