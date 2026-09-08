"""Compile one bounded, offline Figment content brief.

The compiler reads only a local request plus the checked-in taxonomy and template
data.  It creates a planning record; it neither creates media nor contacts or
publishes to a platform.

From the repository root, run ``python orgs/figment/pipeline/content/content_brief.py
--root <brief-root> --request request.json --out brief.json``. A carousel request
uses only IDs from the checked-in data, for example::

  {"schema":"figment/content-brief-request@1", "brief_date":"2026-09-08",
   "creator":{"id":"creator-001", "persona_path":"personas/creator-001/persona.yaml",
   "canonical_reference":"anchors/g01.jpg"}, "surface":"carousel", "template_id":"CT-2",
   "asset_slots":[{"taxonomy_type":"A", "kind":"persona"},
   {"taxonomy_type":"A", "kind":"persona"}],
   "sources":[{"citation":"https://example.org/research", "observed_date":"2026-09-07"}],
   "hypothesis":"A two-frame payoff supports a concise outfit comparison.",
   "intended_metric":"saves per reached account", "observed_metrics":null}

Carousel IDs are CT-1 through CT-7; reel IDs are RT-1 through RT-6 (with one
``G``/``persona`` motion asset slot). The output is only an offline brief; it
does not publish, generate, or run content.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import stat
from pathlib import Path
from typing import Any


CONTENT_DIR = Path(__file__).resolve().parent
MAX_JSON_BYTES = 256 * 1024
MAX_REFERENCE_BYTES = 64 * 1024 * 1024
MAX_TEXT = 4_096
MAX_SOURCES = 16
MAX_DEPTH = 32
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
FORBIDDEN_KEYS = ("approv", "accept", "decision", "promot", "publish", "post")
CREATOR_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")


class ContentBriefError(ValueError):
    """A request cannot become a content brief."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _is_reparse(path: Path) -> bool:
    try:
        return bool(path.lstat().st_file_attributes & REPARSE_POINT)
    except FileNotFoundError:
        return False
    except AttributeError:
        return path.is_symlink()


def _relative(value: object, name: str) -> Path:
    if not isinstance(value, str) or not value or len(value) > 512:
        raise ContentBriefError(f"{name} must be a bounded nonempty relative path")
    path = Path(value)
    if path.is_absolute() or path.drive or "\\" in value or any(part in {"", ".", ".."} for part in path.parts):
        raise ContentBriefError(f"{name} must be a normalized root-relative path")
    return path


def _safe_root(root: Path) -> Path:
    root = root.absolute()
    current = Path(root.anchor)
    for part in root.parts[1:]:
        current = current / part
        if _is_reparse(current):
            raise ContentBriefError("root or an ancestor must not be a reparse point")
    if not root.is_dir():
        raise ContentBriefError("root must be an existing non-reparse directory")
    return root


def _safe_existing(root: Path, relative: object, name: str) -> Path:
    relative_path = _relative(relative, name)
    current = root
    for part in relative_path.parts:
        current = current / part
        if not current.exists() or _is_reparse(current):
            raise ContentBriefError(f"{name} is missing or traverses a link")
    if not current.is_file():
        raise ContentBriefError(f"{name} must name a regular file")
    return current


def _safe_output(root: Path, relative: object) -> Path:
    path = _relative(relative, "output")
    if path.suffix != ".json":
        raise ContentBriefError("output must end in .json")
    current = root
    for part in path.parts[:-1]:
        current = current / part
        if not current.is_dir() or _is_reparse(current):
            raise ContentBriefError("output parent is missing or traverses a link")
    output = root / path
    if output.exists() or _is_reparse(output):
        raise ContentBriefError("output must be fresh")
    return output


def _read_json(path: Path, label: str) -> dict[str, Any]:
    if path.stat().st_size > MAX_JSON_BYTES:
        raise ContentBriefError(f"{label} exceeds {MAX_JSON_BYTES} bytes")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContentBriefError(f"{label} is not valid JSON") from exc
    _check_shape(data, label)
    if not isinstance(data, dict):
        raise ContentBriefError(f"{label} must be an object")
    return data


def _bounded_file(path: Path, label: str, maximum: int) -> None:
    if path.stat().st_size > maximum:
        raise ContentBriefError(f"{label} exceeds {maximum} bytes")


def _check_shape(value: Any, label: str, depth: int = 0) -> None:
    if depth > MAX_DEPTH:
        raise ContentBriefError(f"{label} exceeds nesting limit")
    if isinstance(value, str) and len(value) > MAX_TEXT:
        raise ContentBriefError(f"{label} contains overlong text")
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or len(key) > 128:
                raise ContentBriefError(f"{label} has an invalid key")
            _check_shape(child, label, depth + 1)
    elif isinstance(value, list):
        if len(value) > 64:
            raise ContentBriefError(f"{label} has too many values")
        for child in value:
            _check_shape(child, label, depth + 1)


def _required_string(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > MAX_TEXT:
        raise ContentBriefError(f"{key} must be bounded nonempty text")
    return value.strip()


def _date(value: object, name: str) -> str:
    if not isinstance(value, str):
        raise ContentBriefError(f"{name} must be an ISO date")
    try:
        return dt.date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ContentBriefError(f"{name} must be an ISO date") from exc


def _forbid_claims(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            lowered = key.lower()
            if any(term in lowered for term in FORBIDDEN_KEYS):
                raise ContentBriefError(f"unsupported approval or publication claim: {key}")
            _forbid_claims(child)
    elif isinstance(value, list):
        for child in value:
            _forbid_claims(child)


def _only_keys(data: dict[str, Any], allowed: set[str], label: str) -> None:
    unexpected = sorted(set(data) - allowed)
    if unexpected:
        raise ContentBriefError(f"{label} has unsupported fields: {', '.join(unexpected)}")


def _load_data(name: str) -> tuple[dict[str, Any], str]:
    path = CONTENT_DIR / name
    return _read_json(path, name), _sha256(path)


def _taxonomy_types(taxonomy: dict[str, Any]) -> dict[str, dict[str, Any]]:
    types = taxonomy.get("types")
    if not isinstance(types, list):
        raise ContentBriefError("taxonomy has no type list")
    result = {item.get("id"): item for item in types if isinstance(item, dict) and isinstance(item.get("id"), str)}
    if not result:
        raise ContentBriefError("taxonomy has no usable types")
    return result


def _assets(request: dict[str, Any], template: dict[str, Any], types: dict[str, dict[str, Any]], surface: str) -> list[dict[str, Any]]:
    slots = request.get("asset_slots")
    if not isinstance(slots, list) or not slots:
        raise ContentBriefError("asset_slots must be a nonempty list")
    expected = template.get("slots") if surface == "carousel" else [{"role": "motion", "allowed_types": ["G"]}]
    if not isinstance(expected, list) or len(slots) != len(expected):
        raise ContentBriefError("asset_slots must exactly match the template slot count")
    result: list[dict[str, Any]] = []
    for index, (supplied, expected_slot) in enumerate(zip(slots, expected), start=1):
        if not isinstance(supplied, dict):
            raise ContentBriefError("each asset slot must be an object")
        _only_keys(supplied, {"taxonomy_type", "kind"}, "asset slot")
        type_id = supplied.get("taxonomy_type")
        kind = supplied.get("kind")
        if not isinstance(type_id, str) or type_id not in types:
            raise ContentBriefError(f"asset slot {index} has an unknown taxonomy type")
        if type_id not in expected_slot.get("allowed_types", []):
            raise ContentBriefError(f"asset slot {index} type is not allowed by the template")
        expected_persona = types[type_id].get("persona_in_frame")
        if kind not in {"persona", "nonpersona"}:
            raise ContentBriefError(f"asset slot {index} kind must be persona or nonpersona")
        if expected_persona is True and kind != "persona":
            raise ContentBriefError(f"asset slot {index} must be persona")
        if expected_persona is False and kind != "nonpersona":
            raise ContentBriefError(f"asset slot {index} must be nonpersona")
        result.append({"index": index, "role": expected_slot.get("role"), "taxonomy_type": type_id, "kind": kind})
    return result


def build_content_brief(root: Path, request_path: str | Path, output_path: str | Path) -> dict[str, Any]:
    """Validate a local request and write one new deterministic planning record."""
    root = _safe_root(Path(root))
    request_file = _safe_existing(root, str(request_path), "request")
    output_file = _safe_output(root, str(output_path))
    request = _read_json(request_file, "request")
    _only_keys(request, {
        "schema", "brief_date", "creator", "surface", "template_id", "asset_slots",
        "sources", "hypothesis", "intended_metric", "observed_metrics",
    }, "request")
    _forbid_claims(request)
    if request.get("schema") != "figment/content-brief-request@1":
        raise ContentBriefError("unexpected request schema")
    if request.get("observed_metrics", object()) is not None:
        raise ContentBriefError("observed_metrics must be explicitly null")

    taxonomy, taxonomy_sha = _load_data("taxonomy.yaml")
    carousel_data, carousel_sha = _load_data("carousel-templates.yaml")
    reel_data, reel_sha = _load_data("reel-templates.yaml")
    surface = request.get("surface")
    template_id = request.get("template_id")
    if surface not in {"carousel", "reel"} or not isinstance(template_id, str):
        raise ContentBriefError("surface must be carousel or reel with a template_id")
    templates = carousel_data.get("templates") if surface == "carousel" else reel_data.get("templates")
    if not isinstance(templates, list):
        raise ContentBriefError("template data is malformed")
    template = next((item for item in templates if isinstance(item, dict) and item.get("id") == template_id), None)
    if template is None:
        raise ContentBriefError("template_id is not in the selected template data")

    creator = request.get("creator")
    if not isinstance(creator, dict):
        raise ContentBriefError("creator must be an object")
    _only_keys(creator, {"id", "persona_path", "canonical_reference"}, "creator")
    creator_id = _required_string(creator, "id")
    if not CREATOR_ID.fullmatch(creator_id):
        raise ContentBriefError("creator.id must be a normalized creator identifier")
    expected_persona_path = f"personas/{creator_id}/persona.yaml"
    if creator.get("persona_path") != expected_persona_path:
        raise ContentBriefError("creator.persona_path must be the canonical creator persona path")
    persona_file = _safe_existing(root, expected_persona_path, "creator.persona_path")
    persona = _read_json(persona_file, "persona")
    if persona.get("id") != creator_id:
        raise ContentBriefError("creator id does not match persona")
    reference_declared = creator.get("canonical_reference")
    reference_path = _relative(reference_declared, "creator.canonical_reference")
    if not reference_path.parts or reference_path.parts[0] != "anchors":
        raise ContentBriefError("canonical_reference must be rooted under anchors/")
    references = persona.get("identity", {}).get("references") if isinstance(persona.get("identity"), dict) else None
    if not isinstance(references, list) or reference_declared not in references:
        raise ContentBriefError("canonical_reference must be a declared persona reference")
    reference_file = _safe_existing(persona_file.parent, reference_declared, "creator.canonical_reference")
    _bounded_file(reference_file, "creator.canonical_reference", MAX_REFERENCE_BYTES)

    sources = request.get("sources")
    if not isinstance(sources, list) or not sources or len(sources) > MAX_SOURCES:
        raise ContentBriefError("sources must contain 1 to 16 citations")
    normal_sources: list[dict[str, str]] = []
    for source in sources:
        if not isinstance(source, dict):
            raise ContentBriefError("each source must be an object")
        _only_keys(source, {"citation", "observed_date"}, "source")
        citation = _required_string(source, "citation")
        if not citation.startswith("https://"):
            raise ContentBriefError("each citation must be an https URL")
        normal_sources.append({"citation": citation, "observed_date": _date(source.get("observed_date"), "source.observed_date")})

    assets = _assets(request, template, _taxonomy_types(taxonomy), surface)
    record = {
        "schema": "figment/content-brief@1",
        "brief_date": _date(request.get("brief_date"), "brief_date"),
        "creator": {
            "id": creator_id,
            "persona": {"path": str(persona_file.relative_to(root)).replace("\\", "/"), "sha256": _sha256(persona_file)},
            "canonical_reference": {
                "declared_path": reference_declared,
                "path": str(reference_file.relative_to(root)).replace("\\", "/"),
                "sha256": _sha256(reference_file),
            },
        },
        "content": {
            "surface": surface,
            "template_id": template_id,
            "template_sha256": carousel_sha if surface == "carousel" else reel_sha,
            "taxonomy_sha256": taxonomy_sha,
            "required_asset_slots": assets,
        },
        "sources": normal_sources,
        "hypothesis": _required_string(request, "hypothesis"),
        "intended_metric": _required_string(request, "intended_metric"),
        "observed_metrics": None,
    }
    encoded = (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if len(encoded) > MAX_JSON_BYTES:
        raise ContentBriefError("compiled brief exceeds output size limit")
    try:
        with output_file.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError as exc:
        raise ContentBriefError("output must be fresh") from exc
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compile one offline Figment content brief JSON record.")
    parser.add_argument("--root", required=True, help="root containing the request and creator files")
    parser.add_argument("--request", required=True, help="root-relative request JSON")
    parser.add_argument("--out", required=True, help="fresh root-relative brief JSON")
    args = parser.parse_args(argv)
    try:
        build_content_brief(Path(args.root), args.request, args.out)
    except ContentBriefError as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
