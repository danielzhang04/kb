#!/usr/bin/env python3
"""One-shot, hash-bound Gemini image-input diagnostic for Figment.

Without ``--execute`` this validates and prints a manifest plan; it never reads an
ambient credential or opens a network connection.  ``--execute`` is deliberately
harder: it needs a fresh, self-hashed admitted manifest and passes the existing
Figment daily/arc ledger checks before it reads ``GEMINI_API_KEY``.  It makes one
non-redirecting request and never retries it.  A timeout or malformed response is
treated as a full-reservation, billing-uncertain outcome, not as permission to retry.
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import importlib.util
import json
import math
import os
import re
import stat
import sys
import tempfile
from io import BytesIO
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from PIL import Image, UnidentifiedImageError

try:  # ``requests`` is already installed in the supported Python 3.13 runtime.
    import requests
except ImportError:  # pragma: no cover - exercised only on an unsupported runtime
    requests = None


HERE = Path(__file__).resolve().parent
PIPELINE = HERE.parent
POD_RUNNER_PATH = PIPELINE / "pod" / "runpod_run.py"

SCHEMA = "figment/gemini-input@1"
MODEL = "gemini-3-pro-image"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent"
CANONICAL_G01_SHA256 = "e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed"
CANONICAL_G01_PATH = "orgs/figment/personas/creator-001/anchors/g01.jpg"
FROZEN_E01_PROMPT_SHA256 = "b1d305daa9c21f3ee4a0b9cbda9241b5ef5258aed5431058ecb743b411fe54df"
MODEL_ATTESTATION_PATH = "_private/figment-gemini-experiment-20260908/model-metadata-20260908-1219.json"
MODEL_ATTESTATION_SHA256 = "a9a056fc68bc4656a78703d007f28072784a9d986857fae59cfcd3e7f92121ea"
# Read-only model metadata confirms a 131,072-token input limit and a 32,768-token
# output limit. Thinking is billed separately, so reserve both an image-output and a
# thinking window even though this request sets maxOutputTokens to 4,096.
MODEL_INPUT_TOKEN_LIMIT = 131_072
MODEL_OUTPUT_TOKEN_LIMIT = 32_768
RESERVATION_USD = 4.60
MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
MAX_PIXELS = 16_777_216
# The API request asks for 2K/16:9.  The provider has not documented one exact returned
# raster for that request, so accept only this conservative wide-2K envelope.  It covers
# the two reviewed plausible sizes while refusing 4K and material aspect/size drift.
WIDE_2K_MIN_WIDTH = 2700
WIDE_2K_MAX_WIDTH = 2850
WIDE_2K_MIN_HEIGHT = 1500
WIDE_2K_MAX_HEIGHT = 1600
WIDE_2K_MIN_ASPECT = 1.75
WIDE_2K_MAX_ASPECT = 1.85
MAX_MANIFEST_BYTES = 64 * 1024
MAX_ATTESTATION_BYTES = 16 * 1024
MAX_JSON_DEPTH = 16
MAX_PROMPT_CHARS = 8_192
MAX_OUTPUT_TOKENS = 4_096
MAX_MANIFEST_AGE = timedelta(minutes=30)
SAFE_COMPONENT = re.compile(r"[A-Za-z0-9_][A-Za-z0-9._-]{0,127}\Z")
SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
HEX = re.compile(r"[0-9a-f]{64}\Z")
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
JPEG_SOI = b"\xff\xd8"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class GeminiInputError(RuntimeError):
    """A local refusal or a sanitized provider outcome."""


def _is_reparse(path: Path) -> bool:
    is_junction = getattr(os.path, "isjunction", lambda _value: False)
    try:
        return (path.is_symlink() or is_junction(path)
                or bool(path.lstat().st_file_attributes & REPARSE_POINT))
    except (AttributeError, OSError):
        return path.is_symlink() or is_junction(path)


def _safe_root(value: Path) -> Path:
    lexical = value.absolute()
    try:
        if not lexical.is_dir() or any(_is_reparse(part) for part in (lexical, *lexical.parents)):
            raise GeminiInputError("root and its ancestors must be real non-reparse directories")
        return lexical.resolve(strict=True)
    except OSError as exc:
        raise GeminiInputError("root directory is unavailable") from exc


def _relative(value: Any, label: str) -> Path:
    if isinstance(value, Path):
        value = value.as_posix()
    if not isinstance(value, str) or not value or len(value) > 512 or "\\" in value:
        raise GeminiInputError(f"{label} must be a normalized root-relative path")
    path = Path(value)
    if path.is_absolute() or path.drive or not path.parts or any(not SAFE_COMPONENT.fullmatch(part) for part in path.parts):
        raise GeminiInputError(f"{label} must be a normalized root-relative path")
    return path


def _within(root: Path, value: Any, label: str, *, exists: bool) -> Path:
    relative = _relative(value, label)
    current = root
    for index, part in enumerate(relative.parts):
        current /= part
        if _is_reparse(current):
            raise GeminiInputError(f"{label} may not traverse a symlink or reparse point")
        if exists and not current.exists():
            raise GeminiInputError(f"{label} is missing")
    if current.exists():
        try:
            current.resolve(strict=True).relative_to(root)
        except (OSError, ValueError) as exc:
            raise GeminiInputError(f"{label} escaped root") from exc
    return current


def _read_limited(path: Path, label: str, maximum: int) -> bytes:
    try:
        if not path.is_file() or _is_reparse(path):
            raise GeminiInputError(f"{label} must be a regular file")
        expected = path.stat().st_size
        if expected < 1 or expected > maximum:
            raise GeminiInputError(f"{label} exceeds its {maximum}-byte limit")
        chunks: list[bytes] = []
        observed = 0
        with path.open("rb") as handle:
            while block := handle.read(min(1024 * 1024, maximum + 1 - observed)):
                observed += len(block)
                if observed > maximum:
                    raise GeminiInputError(f"{label} exceeds its {maximum}-byte limit")
                chunks.append(block)
        if observed != expected or path.stat().st_size != expected:
            raise GeminiInputError(f"{label} changed while it was read")
        return b"".join(chunks)
    except OSError as exc:
        raise GeminiInputError(f"cannot read {label}") from exc


def _check_json(value: Any, label: str, depth: int = 0, *, max_string: int = MAX_PROMPT_CHARS) -> None:
    if depth > MAX_JSON_DEPTH:
        raise GeminiInputError(f"{label} exceeds nesting limit")
    if isinstance(value, dict):
        if len(value) > 32:
            raise GeminiInputError(f"{label} has too many fields")
        for key, child in value.items():
            if not isinstance(key, str) or len(key) > 128:
                raise GeminiInputError(f"{label} has an invalid key")
            _check_json(child, label, depth + 1, max_string=max_string)
    elif isinstance(value, list):
        if len(value) > 32:
            raise GeminiInputError(f"{label} has too many values")
        for child in value:
            _check_json(child, label, depth + 1, max_string=max_string)
    elif isinstance(value, str) and len(value) > max_string:
        raise GeminiInputError(f"{label} contains overlong text")
    elif not isinstance(value, (str, int, float, bool, type(None))):
        raise GeminiInputError(f"{label} contains an unsupported value")


def _canonical_manifest(value: dict[str, Any]) -> bytes:
    copy = dict(value)
    copy.pop("frozen_sha256", None)
    return json.dumps(copy, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def freeze_manifest(value: dict[str, Any]) -> dict[str, Any]:
    """Return a self-hashed manifest without writing it; callers choose its storage."""
    frozen = dict(value)
    frozen["frozen_sha256"] = hashlib.sha256(_canonical_manifest(frozen)).hexdigest()
    return frozen


def _parse_utc(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or len(value) > 64:
        raise GeminiInputError(f"manifest has invalid {label}")
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise GeminiInputError(f"manifest has invalid {label}") from exc
    if parsed.tzinfo is None:
        raise GeminiInputError(f"manifest {label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _jpeg_dimensions(data: bytes, label: str) -> tuple[int, int]:
    if not data.startswith(JPEG_SOI):
        raise GeminiInputError(f"{label} is not JPEG")
    index = 2
    while index + 4 <= len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        while index < len(data) and data[index] == 0xFF:
            index += 1
        if index >= len(data):
            break
        marker = data[index]
        index += 1
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        if index + 2 > len(data):
            break
        length = int.from_bytes(data[index:index + 2], "big")
        if length < 2 or index + length > len(data):
            break
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            if length < 8:
                break
            height = int.from_bytes(data[index + 3:index + 5], "big")
            width = int.from_bytes(data[index + 5:index + 7], "big")
            if width < 1 or height < 1 or width * height > MAX_PIXELS:
                raise GeminiInputError(f"{label} has invalid dimensions")
            return width, height
        index += length
    raise GeminiInputError(f"{label} has no supported JPEG dimensions")


def _png_dimensions(data: bytes, label: str) -> tuple[int, int]:
    if len(data) < 24 or not data.startswith(PNG_SIGNATURE) or data[12:16] != b"IHDR":
        raise GeminiInputError(f"{label} is not PNG")
    width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if width < 1 or height < 1 or width * height > MAX_PIXELS:
        raise GeminiInputError(f"{label} has invalid dimensions")
    return width, height


def _decode_image(data: bytes, mime: str, label: str) -> tuple[int, int]:
    """Decode and verify a bounded image; headers alone are not image evidence."""
    expected_format = {"image/jpeg": "JPEG", "image/png": "PNG"}.get(mime)
    if expected_format is None:
        raise GeminiInputError(f"{label} has unsupported MIME type")
    try:
        with Image.open(BytesIO(data)) as probe:
            if probe.format != expected_format:
                raise GeminiInputError(f"{label} MIME type does not match decoded image")
            dimensions = probe.size
            if (not all(isinstance(item, int) and item > 0 for item in dimensions)
                    or dimensions[0] * dimensions[1] > MAX_PIXELS):
                raise GeminiInputError(f"{label} has invalid dimensions")
            probe.verify()
        with Image.open(BytesIO(data)) as decoded:
            if decoded.format != expected_format or decoded.size != dimensions:
                raise GeminiInputError(f"{label} changed while it was decoded")
            decoded.load()
    except GeminiInputError:
        raise
    except (OSError, SyntaxError, UnidentifiedImageError) as exc:
        raise GeminiInputError(f"{label} failed image decode") from exc
    return dimensions


def _is_wide_2k_16_9(dimensions: tuple[int, int]) -> bool:
    """Accept a narrow reviewed output envelope, not an asserted provider raster spec."""
    width, height = dimensions
    return (WIDE_2K_MIN_WIDTH <= width <= WIDE_2K_MAX_WIDTH
            and WIDE_2K_MIN_HEIGHT <= height <= WIDE_2K_MAX_HEIGHT
            and WIDE_2K_MIN_ASPECT <= width / height <= WIDE_2K_MAX_ASPECT)


def _require_string(value: Any, label: str, pattern: re.Pattern[str] | None = None) -> str:
    if not isinstance(value, str) or not value or len(value) > 8_192 or (pattern and not pattern.fullmatch(value)):
        raise GeminiInputError(f"manifest has invalid {label}")
    return value


def _load_model_attestation(root: Path, value: Any) -> dict[str, str]:
    """Bind the manifest to the operator's whitelisted, read-only model metadata."""
    if not isinstance(value, dict) or set(value) != {"path", "sha256"}:
        raise GeminiInputError("manifest model_metadata_attestation is invalid")
    if value["path"] != MODEL_ATTESTATION_PATH or value["sha256"] != MODEL_ATTESTATION_SHA256:
        raise GeminiInputError("manifest must bind the fixed Gemini model metadata attestation")
    path = _within(root, value["path"], "model metadata attestation", exists=True)
    if not isinstance(value["sha256"], str) or not HEX.fullmatch(value["sha256"]):
        raise GeminiInputError("manifest model metadata attestation has invalid sha256")
    raw = _read_limited(path, "model metadata attestation", MAX_ATTESTATION_BYTES)
    if hashlib.sha256(raw).hexdigest() != value["sha256"]:
        raise GeminiInputError("model metadata attestation sha256 does not match manifest")
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GeminiInputError("model metadata attestation is invalid JSON") from exc
    model = document.get("model") if isinstance(document, dict) else None
    if (not isinstance(document, dict) or document.get("schema") != "figment/provider-metadata-observation@1"
            or document.get("http_status") != 200
            or document.get("endpoint") != f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}"
            or model != {"name": f"models/{MODEL}", "version": "3.0", "inputTokenLimit": MODEL_INPUT_TOKEN_LIMIT,
                         "outputTokenLimit": MODEL_OUTPUT_TOKEN_LIMIT,
                         "supportedGenerationMethods": ["generateContent", "countTokens", "batchGenerateContent"]}):
        raise GeminiInputError("model metadata attestation is not the whitelisted Gemini model record")
    return {"path": _relative(value["path"], "model metadata attestation").as_posix(), "sha256": value["sha256"]}


def load_manifest(path: Path, *, root: Path, now: datetime | None = None) -> dict[str, Any]:
    """Read and validate a fresh, hash-bound, one-candidate manifest offline."""
    root = _safe_root(root)
    manifest_path = _within(root, path, "manifest", exists=True)
    try:
        raw = _read_limited(manifest_path, "manifest", MAX_MANIFEST_BYTES)
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GeminiInputError("manifest is invalid JSON") from exc
    _check_json(value, "manifest")
    if not isinstance(value, dict):
        raise GeminiInputError("manifest must be an object")
    required = {"schema", "request_id", "issued_at_utc", "expires_at_utc", "frozen_sha256", "admission", "model_metadata_attestation", "source", "prompt", "request", "output"}
    if set(value) != required:
        raise GeminiInputError("manifest has unexpected fields")
    if value["schema"] != SCHEMA:
        raise GeminiInputError("manifest schema is unsupported")
    _require_string(value["request_id"], "request_id", SAFE_ID)
    if not isinstance(value["frozen_sha256"], str) or not HEX.fullmatch(value["frozen_sha256"]):
        raise GeminiInputError("manifest has invalid frozen_sha256")
    if value["frozen_sha256"] != hashlib.sha256(_canonical_manifest(value)).hexdigest():
        raise GeminiInputError("manifest frozen_sha256 does not match content")
    issued, expires = _parse_utc(value["issued_at_utc"], "issued_at_utc"), _parse_utc(value["expires_at_utc"], "expires_at_utc")
    instant = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if issued > instant or expires <= instant or expires - issued > MAX_MANIFEST_AGE:
        raise GeminiInputError("manifest is not fresh")
    admission = value["admission"]
    if not isinstance(admission, dict) or set(admission) != {"state", "reference", "ledger_reservation_ref", "reservation_usd"}:
        raise GeminiInputError("manifest admission is invalid")
    if admission["state"] != "admitted":
        raise GeminiInputError("manifest is not admitted")
    _require_string(admission["reference"], "admission.reference", SAFE_ID)
    _require_string(admission["ledger_reservation_ref"], "admission.ledger_reservation_ref", SAFE_ID)
    if admission["reservation_usd"] != RESERVATION_USD:
        raise GeminiInputError("manifest reservation_usd must equal the full reservation")
    model_attestation = _load_model_attestation(root, value["model_metadata_attestation"])
    source = value["source"]
    if not isinstance(source, dict) or set(source) != {"id", "path", "sha256", "mime_type"}:
        raise GeminiInputError("manifest source is invalid")
    source_path = _within(root, source["path"], "source image", exists=True)
    if (source["id"] != "creator-001/g01" or source["mime_type"] != "image/jpeg"
            or source["path"] != CANONICAL_G01_PATH or source["sha256"] != CANONICAL_G01_SHA256):
        raise GeminiInputError("manifest source must be a hash-bound JPEG")
    source_bytes = _read_limited(source_path, "source image", MAX_SOURCE_BYTES)
    if hashlib.sha256(source_bytes).hexdigest() != source["sha256"]:
        raise GeminiInputError("source image sha256 does not match manifest")
    source_dimensions = _decode_image(source_bytes, "image/jpeg", "source image")
    prompt = _require_string(value["prompt"], "prompt")
    if len(prompt) > MAX_PROMPT_CHARS or hashlib.sha256(prompt.encode("utf-8")).hexdigest() != FROZEN_E01_PROMPT_SHA256:
        raise GeminiInputError("manifest prompt is not the frozen E01 comparison prompt")
    request = value["request"]
    if not isinstance(request, dict) or set(request) != {"model", "candidate_count", "max_output_tokens", "response_modalities", "image_size", "aspect_ratio", "grounding", "tools"}:
        raise GeminiInputError("manifest request is invalid")
    if request != {"model": MODEL, "candidate_count": 1, "max_output_tokens": MAX_OUTPUT_TOKENS, "response_modalities": ["IMAGE"], "image_size": "2K", "aspect_ratio": "16:9", "grounding": False, "tools": False}:
        raise GeminiInputError("manifest request is not the fixed Gemini diagnostic")
    output = value["output"]
    if not isinstance(output, dict) or set(output) != {"directory", "candidate_stem", "receipt"}:
        raise GeminiInputError("manifest output is invalid")
    output_dir = _within(root, output["directory"], "output directory", exists=False)
    stem = _require_string(output["candidate_stem"], "output.candidate_stem", SAFE_COMPONENT)
    receipt_path = _within(root, output["receipt"], "receipt", exists=False)
    if receipt_path.parent != output_dir or receipt_path.name != "receipt.json":
        raise GeminiInputError("receipt must be output directory receipt.json")
    if (receipt_path.exists() or (output_dir / "dispatch.json").exists()
            or any((output_dir / f"{stem}{suffix}").exists() for suffix in (".jpg", ".png"))):
        raise GeminiInputError("output paths must be fresh")
    return {"manifest": value, "manifest_path": manifest_path, "manifest_sha256": hashlib.sha256(raw).hexdigest(), "root": root, "source_path": source_path,
            "source_bytes": source_bytes, "source_dimensions": source_dimensions, "output_dir": output_dir,
            "receipt_path": receipt_path, "candidate_stem": stem, "model_attestation": model_attestation}


def _load_runner():
    name = "figment_gemini_input_runpod_helpers"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, POD_RUNNER_PATH)
    if spec is None or spec.loader is None:  # pragma: no cover - local layout invariant
        raise GeminiInputError("could not load Figment ledger helpers")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _held_reservation(ledger_dir: Path, *, request_id: str, reservation_ref: str, day: str) -> Path:
    """Find exactly one parent-held immutable reservation already counted as spend.

    The compatibility row lives in the usual Figment TSV ledger so the runner's
    daily/arc totals include it: ``model, step, usd, request_id,
    reservation_ref, state``.  This CLI never creates or changes that row.
    """
    matches: list[Path] = []
    try:
        paths = sorted(ledger_dir.glob(f"figment-*-{day}.tsv"))
    except (OSError, ValueError) as exc:
        raise GeminiInputError("could not enumerate reservation ledger") from exc
    for path in paths:
        try:
            with path.open("r", encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle, delimiter="\t")
                required = {"model", "step", "usd", "request_id", "reservation_ref", "state"}
                if not reader.fieldnames or not required.issubset(reader.fieldnames):
                    continue
                for row in reader:
                    if (row.get("model") == MODEL and row.get("step") == "gemini-input-diagnostic"
                            and row.get("request_id") == request_id and row.get("reservation_ref") == reservation_ref
                            and row.get("state") == "reserved" and row.get("usd") == f"{RESERVATION_USD:.6f}"):
                        matches.append(path)
        except (OSError, csv.Error) as exc:
            raise GeminiInputError("could not read reservation ledger") from exc
    if len(matches) != 1:
        raise GeminiInputError("exactly one held Gemini reservation row is required before dispatch")
    return matches[0]


def ledger_preflight(manifest: dict[str, Any], *, ledger_dir: Path | None = None, budget_path: Path | None = None,
                     arc_cap_usd: float | None = None) -> dict[str, float | str]:
    """Reuse runner readers, with the already-held reservation counted at zero extra cost."""
    runner = _load_runner()
    resolved = runner.configured_ledger_dir(ledger_dir)
    runner.require_arc_ledger_baseline(resolved, allow_empty=False)
    day = runner.governance_ledger_day()
    reservation_path = _held_reservation(
        resolved, request_id=manifest["request_id"], reservation_ref=manifest["admission"]["ledger_reservation_ref"], day=day,
    )
    daily_limit, daily_spent = runner.daily_budget_state(budget_path=budget_path, ledger_dir=resolved)
    arc_cap, arc_spent = runner.arc_budget_state(arc_cap_usd=arc_cap_usd, ledger_dir=resolved)
    if daily_spent > daily_limit or arc_spent > arc_cap:
        raise GeminiInputError("held reservation does not fit current Figment budget totals")
    return {"daily_limit_usd": daily_limit, "daily_spent_before_usd": daily_spent,
            "arc_cap_usd": arc_cap, "arc_spent_before_usd": arc_spent,
            "held_reservation_ledger": reservation_path.name}


def build_request(plan: dict[str, Any]) -> dict[str, Any]:
    manifest, source = plan["manifest"], plan["source_bytes"]
    return {
        "contents": [{"role": "user", "parts": [
            {"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(source).decode("ascii")}},
            {"text": manifest["prompt"]},
        ]}],
        "generationConfig": {"candidateCount": 1, "maxOutputTokens": MAX_OUTPUT_TOKENS,
                              "responseModalities": ["IMAGE"],
                              "imageConfig": {"imageSize": "2K", "aspectRatio": "16:9"}},
    }


def _read_response(response: Any) -> bytes:
    if getattr(response, "status_code", 0) != 200:
        raise GeminiInputError("provider did not confirm image response")
    declared = getattr(response, "headers", {}).get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_RESPONSE_BYTES:
                raise GeminiInputError("provider response exceeds byte limit")
        except ValueError:
            raise GeminiInputError("provider response has invalid content length")
    observed, chunks = 0, []
    try:
        for block in response.iter_content(chunk_size=1024 * 1024):
            if not block:
                continue
            observed += len(block)
            if observed > MAX_RESPONSE_BYTES:
                raise GeminiInputError("provider response exceeds byte limit")
            chunks.append(bytes(block))
    except GeminiInputError:
        raise
    except Exception as exc:
        raise GeminiInputError("provider response could not be read") from exc
    if not chunks:
        raise GeminiInputError("provider response was empty")
    return b"".join(chunks)


def _response_json(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GeminiInputError("provider response was not valid JSON") from exc
    _check_json(value, "provider response", max_string=MAX_RESPONSE_BYTES * 2)
    if not isinstance(value, dict):
        raise GeminiInputError("provider response was not an object")
    return value


def _safe_usage(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    output: dict[str, int] = {}
    for source, target in (("promptTokenCount", "prompt_tokens"), ("candidatesTokenCount", "output_tokens"),
                           ("thoughtsTokenCount", "thought_tokens"), ("totalTokenCount", "total_tokens")):
        item = value.get(source)
        if isinstance(item, int) and not isinstance(item, bool) and 0 <= item <= 1_000_000:
            output[target] = item
    service_tier = value.get("serviceTier")
    if isinstance(service_tier, str) and SAFE_ID.fullmatch(service_tier):
        output["service_tier"] = service_tier
    details = value.get("candidatesTokensDetails")
    if isinstance(details, list) and len(details) <= 8:
        sanitized: list[dict[str, Any]] = []
        for detail in details:
            if not isinstance(detail, dict):
                continue
            modality, token_count = detail.get("modality"), detail.get("tokenCount")
            if (isinstance(modality, str) and SAFE_ID.fullmatch(modality)
                    and isinstance(token_count, int) and not isinstance(token_count, bool) and 0 <= token_count <= 1_000_000):
                sanitized.append({"modality": modality, "token_count": token_count})
        if sanitized:
            output["candidate_token_details"] = sanitized
    return output or None


def _safe_provider_metadata(value: dict[str, Any]) -> dict[str, Any] | None:
    """Keep only model/version and bounded counters from a parseable response."""
    provider: dict[str, Any] = {"model": MODEL}
    model_version = value.get("modelVersion")
    if isinstance(model_version, str) and SAFE_ID.fullmatch(model_version):
        provider["model_version"] = model_version
    usage = _safe_usage(value.get("usageMetadata"))
    if usage is not None:
        provider["usage"] = usage
    return provider if len(provider) > 1 else None


def _extract_image(value: dict[str, Any]) -> tuple[bytes, str, tuple[int, int], dict[str, Any]]:
    candidates = value.get("candidates")
    if not isinstance(candidates, list) or len(candidates) != 1 or not isinstance(candidates[0], dict):
        raise GeminiInputError("provider did not return exactly one candidate")
    content = candidates[0].get("content")
    if not isinstance(content, dict) or not isinstance(content.get("parts"), list):
        raise GeminiInputError("provider candidate has no parts")
    images: list[tuple[bytes, str, tuple[int, int]]] = []
    for part in content["parts"]:
        if not isinstance(part, dict):
            raise GeminiInputError("provider candidate has invalid part")
        if part.get("thought") is True:
            continue
        inline = part.get("inlineData")
        if not isinstance(inline, dict):
            continue  # thought/text parts are deliberately neither stored nor logged.
        mime, encoded = inline.get("mimeType"), inline.get("data")
        if mime not in {"image/jpeg", "image/png"} or not isinstance(encoded, str) or len(encoded) > MAX_RESPONSE_BYTES * 2:
            raise GeminiInputError("provider returned unsupported image data")
        try:
            image = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as exc:
            raise GeminiInputError("provider returned invalid image encoding") from exc
        if not image or len(image) > MAX_OUTPUT_BYTES:
            raise GeminiInputError("provider image exceeds byte limit")
        dimensions = _decode_image(image, mime, "provider image")
        if not _is_wide_2k_16_9(dimensions):
            raise GeminiInputError("provider image is outside the accepted wide 2K 16:9 envelope")
        images.append((image, mime, dimensions))
    if len(images) != 1:
        raise GeminiInputError("provider did not return exactly one image")
    return (*images[0], _safe_provider_metadata(value) or {"model": MODEL})


def _write_path(root: Path, path: Path, label: str) -> Path:
    try:
        relative = path.relative_to(root)
    except ValueError as exc:
        raise GeminiInputError(f"{label} escaped root") from exc
    safe = _within(root, relative, label, exists=False)
    if safe.parent.exists() and not safe.parent.is_dir():
        raise GeminiInputError(f"{label} parent is not a directory")
    return safe


def _atomic_write(path: Path, data: bytes, *, root: Path, label: str) -> None:
    path = _write_path(root, path, label)
    path.parent.mkdir(parents=True, exist_ok=True)
    path = _write_path(root, path, label)
    if path.exists():
        raise GeminiInputError(f"{label} is no longer fresh")
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        path = _write_path(root, path, label)
        if path.exists():
            raise GeminiInputError(f"{label} is no longer fresh")
        os.replace(temporary, path)
    except BaseException:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _receipt(plan: dict[str, Any], *, status: str, ledger: dict[str, float | str], provider: dict[str, Any] | None = None,
             output: dict[str, Any] | None = None) -> dict[str, Any]:
    manifest = plan["manifest"]
    result: dict[str, Any] = {
        "schema": "figment/gemini-input-receipt@1", "status": status,
        "request_id": manifest["request_id"], "manifest_sha256": plan["manifest_sha256"],
        "frozen_sha256": manifest["frozen_sha256"], "reservation_usd": RESERVATION_USD,
        "billing_status": "reported-not-invoice" if status == "succeeded" else "unconfirmed-reserve-full",
        "source": {"id": manifest["source"]["id"], "path": manifest["source"]["path"], "sha256": manifest["source"]["sha256"],
                   "mime_type": "image/jpeg", "dimensions": {"width": plan["source_dimensions"][0], "height": plan["source_dimensions"][1]}},
        "request": {"model": MODEL, "candidate_count": 1, "max_output_tokens": MAX_OUTPUT_TOKENS,
                    "response_modalities": ["IMAGE"], "image_size": "2K", "aspect_ratio": "16:9",
                    "grounding": False, "tools": False},
        "prompt_sha256": FROZEN_E01_PROMPT_SHA256,
        "ledger_preflight": ledger,
        "model_metadata_attestation": plan["model_attestation"],
    }
    if provider is not None:
        result["provider"] = provider
    if output is not None:
        result["output"] = output
    return result


def _write_receipt(plan: dict[str, Any], value: dict[str, Any]) -> None:
    path = plan["receipt_path"]
    if path.exists():
        raise GeminiInputError("receipt path is no longer fresh")
    _atomic_write(path, (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode("utf-8"),
                  root=plan["root"], label="receipt path")


def _write_dispatch_journal(plan: dict[str, Any], ledger: dict[str, float | str]) -> None:
    """Create the exclusive one-attempt marker before outbound dispatch.

    ``O_EXCL`` protects the marker against an ordinary concurrent caller.  Together
    with repeated same-root checks this assumes a non-hostile local filesystem; it is
    not a race-free filesystem-security boundary.  A crash leaves the marker in place
    and therefore fails closed until a human reconciles the held reservation.
    """
    path = plan["output_dir"] / "dispatch.json"
    path = _write_path(plan["root"], path, "dispatch journal")
    path.parent.mkdir(parents=True, exist_ok=True)
    path = _write_path(plan["root"], path, "dispatch journal")
    payload = {"schema": "figment/gemini-input-dispatch@1", "request_id": plan["manifest"]["request_id"],
               "manifest_sha256": plan["manifest_sha256"],
               "reservation_usd": RESERVATION_USD, "ledger_preflight": ledger}
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise GeminiInputError("dispatch journal already exists; refusing a second attempt") from exc
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write((json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        # Preserve even a partial journal: it is safer evidence than a second call.
        raise


def _write_reservation_marker(plan: dict[str, Any]) -> None:
    """Consume one local attempt for this exact existing reservation before any dispatch."""
    manifest = plan["manifest"]
    name = f"{manifest['request_id']}--{manifest['admission']['ledger_reservation_ref']}.json"
    path = _write_path(plan["root"], plan["root"] / "_private" / "figment-gemini-input-dispatch" / name,
                       "reservation dispatch marker")
    path.parent.mkdir(parents=True, exist_ok=True)
    path = _write_path(plan["root"], path, "reservation dispatch marker")
    marker = {"schema": "figment/gemini-input-reservation-marker@1", "request_id": manifest["request_id"],
              "reservation_ref": manifest["admission"]["ledger_reservation_ref"], "manifest_sha256": plan["manifest_sha256"]}
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise GeminiInputError("reservation dispatch marker already exists; refusing a second attempt") from exc
    with os.fdopen(descriptor, "wb") as handle:
        handle.write((json.dumps(marker, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())


def _post_once(payload: dict[str, Any], key: str) -> Any:
    if requests is None:
        raise GeminiInputError("requests is unavailable")
    session = requests.Session()
    session.trust_env = False
    try:
        return session.post(ENDPOINT, headers={"content-type": "application/json", "x-goog-api-key": key},
                            json=payload, timeout=(10, 180), allow_redirects=False, stream=True)
    except Exception as exc:
        raise GeminiInputError("provider request was not confirmed") from exc


def execute_manifest(path: Path, *, root: Path, ledger_dir: Path | None = None, budget_path: Path | None = None,
                     arc_cap_usd: float | None = None, now: datetime | None = None,
                     transport: Callable[[dict[str, Any], str], Any] | None = None) -> dict[str, Any]:
    """Execute at most one provider request after every local admission check passes."""
    plan = load_manifest(path, root=root, now=now)
    ledger = ledger_preflight(plan["manifest"], ledger_dir=ledger_dir, budget_path=budget_path, arc_cap_usd=arc_cap_usd)
    key = os.environ.get("GEMINI_API_KEY")
    if not isinstance(key, str) or not key:
        raise GeminiInputError("ambient Gemini credential is unavailable")
    _write_reservation_marker(plan)
    _write_dispatch_journal(plan, ledger)
    response: Any | None = None
    provider_metadata: dict[str, Any] | None = None
    try:
        try:
            response = (transport or _post_once)(build_request(plan), key)
        except GeminiInputError:
            raise
        except Exception as exc:
            raise GeminiInputError("provider request was not confirmed") from exc
        raw = _read_response(response)
        response_json = _response_json(raw)
        provider_metadata = _safe_provider_metadata(response_json)
        image, mime, dimensions, provider = _extract_image(response_json)
        suffix = ".jpg" if mime == "image/jpeg" else ".png"
        candidate_path = plan["output_dir"] / f"{plan['candidate_stem']}{suffix}"
        if candidate_path.exists():
            raise GeminiInputError("candidate path is no longer fresh")
        _atomic_write(candidate_path, image, root=plan["root"], label="candidate path")
        output = {"path": candidate_path.relative_to(plan["root"]).as_posix(), "sha256": hashlib.sha256(image).hexdigest(),
                  "bytes": len(image), "mime_type": mime, "dimensions": {"width": dimensions[0], "height": dimensions[1]}}
        receipt = _receipt(plan, status="succeeded", ledger=ledger, provider=provider, output=output)
        _write_receipt(plan, receipt)
        return receipt
    except GeminiInputError:
        receipt = _receipt(plan, status="unconfirmed", ledger=ledger, provider=provider_metadata)
        try:
            _write_receipt(plan, receipt)
        except GeminiInputError:
            pass
        raise
    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                pass


def plan_summary(path: Path, *, root: Path, now: datetime | None = None) -> dict[str, Any]:
    plan = load_manifest(path, root=root, now=now)
    manifest = plan["manifest"]
    return {"schema": SCHEMA, "dry_run": True, "request_id": manifest["request_id"], "model": MODEL,
            "candidate_count": 1, "max_output_tokens": MAX_OUTPUT_TOKENS, "reservation_usd": RESERVATION_USD,
            "source": {"id": manifest["source"]["id"], "path": manifest["source"]["path"], "sha256": manifest["source"]["sha256"], "mime_type": "image/jpeg"},
            "output_receipt": manifest["output"]["receipt"], "network": False, "credential_read": False}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="trusted root containing the manifest, g01, and fresh output")
    parser.add_argument("--manifest", type=Path, required=True, help="root-relative self-hashed manifest")
    parser.add_argument("--execute", action="store_true", help="make the single admitted provider attempt (default is offline plan)")
    parser.add_argument("--ledger-dir", type=Path, help="Figment cost-ledger directory for execute preflight")
    parser.add_argument("--budget-path", type=Path, help="budget YAML for execute preflight")
    parser.add_argument("--arc-cap-usd", type=float, help="arc cap for execute preflight")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = execute_manifest(args.manifest, root=args.root, ledger_dir=args.ledger_dir, budget_path=args.budget_path,
                                  arc_cap_usd=args.arc_cap_usd) if args.execute else plan_summary(args.manifest, root=args.root)
    except GeminiInputError as exc:
        print(f"gemini input refused: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
