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
import copy
import datetime as dt
import hashlib
import json
import os
import re
import stat
import tempfile
from pathlib import Path, PureWindowsPath
from typing import Any


CONTENT_DIR = Path(__file__).resolve().parent
MAX_JSON_BYTES = 256 * 1024
MAX_REFERENCE_BYTES = 64 * 1024 * 1024
MAX_TEXT = 4_096
MAX_CITATION = 2_048
MAX_ROLE = 80
MAX_SOURCES = 16
MAX_DEPTH = 32
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
FORBIDDEN_KEYS = ("approv", "accept", "decision", "promot", "publish", "post")
CREATOR_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
EDIT_KEYS = {"brief_date", "hypothesis", "intended_metric"}
STRICT_DATE = re.compile(r"\A\d{4}-\d{2}-\d{2}\Z")
REVISION_PUBLICATION_SCHEMA = "figment/content-brief-revision-publication@1"


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
    windows_path = PureWindowsPath(value)
    if (
        any(
            candidate.is_absolute() or candidate.drive or candidate.root or candidate.anchor
            for candidate in (path, windows_path)
        )
        or "\\" in value
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
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
    if isinstance(value, str) and _utf16_length(value) > MAX_TEXT:
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


def _has_control_char(value: str) -> bool:
    """Match the dashboard consumer's plain(): reject code points <32 or ==127."""
    return any(ord(ch) < 32 or ord(ch) == 127 for ch in value)


def _utf16_length(value: str) -> int:
    """Count UTF-16 code units, matching the TS hub's string.length (surrogate pairs count as 2)."""
    return sum(2 if ord(ch) > 0xFFFF else 1 for ch in value)


def _required_string(data: dict[str, Any], key: str, maximum: int = MAX_TEXT) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip() or _utf16_length(value) > maximum:
        raise ContentBriefError(f"{key} must be bounded nonempty text")
    if _has_control_char(value):
        raise ContentBriefError(f"{key} must not contain control characters")
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
        role = expected_slot.get("role")
        if not isinstance(role, str) or not role or _utf16_length(role) > MAX_ROLE or _has_control_char(role):
            raise ContentBriefError(f"asset slot {index} template role is invalid")
        result.append({"index": index, "role": role, "taxonomy_type": type_id, "kind": kind})
    return result


def _compile_content_brief(root: Path, request_file: Path) -> dict[str, Any]:
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
        citation = _required_string(source, "citation", MAX_CITATION)
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
    return record


def compile_content_brief(root: Path, request_path: str | Path) -> dict[str, Any]:
    """Recompute one brief record from its current bounded producer inputs."""
    root = _safe_root(Path(root))
    request_file = _safe_existing(root, str(request_path), "request")
    return _compile_content_brief(root, request_file)


def _producer_dependencies(root: Path, record: dict[str, Any]) -> dict[str, dict[str, str]]:
    creator = record.get("creator")
    content = record.get("content")
    if not isinstance(creator, dict) or not isinstance(content, dict):
        raise ContentBriefError("compiled brief producer fields are malformed")
    persona_record = creator.get("persona")
    reference_record = creator.get("canonical_reference")
    if not isinstance(persona_record, dict) or not isinstance(reference_record, dict):
        raise ContentBriefError("compiled brief identity fields are malformed")
    persona = _safe_existing(root, persona_record.get("path"), "compiled persona")
    reference = _safe_existing(root, reference_record.get("path"), "compiled canonical reference")
    template_name = "carousel-templates.yaml" if content.get("surface") == "carousel" else "reel-templates.yaml"
    static_paths = {
        "taxonomy": CONTENT_DIR / "taxonomy.yaml",
        "template": CONTENT_DIR / template_name,
    }
    for label, path in static_paths.items():
        if _is_reparse(path) or not path.is_file():
            raise ContentBriefError(f"{label} producer input is missing or linked")
    dependencies = {
        "persona": {"path": persona.relative_to(root).as_posix(), "sha256": _sha256(persona)},
        "canonical_reference": {"path": reference.relative_to(root).as_posix(), "sha256": _sha256(reference)},
        "taxonomy": {"path": "taxonomy.yaml", "sha256": _sha256(static_paths["taxonomy"])},
        "template": {"path": template_name, "sha256": _sha256(static_paths["template"])},
    }
    if (
        dependencies["persona"]["sha256"] != persona_record.get("sha256")
        or dependencies["canonical_reference"]["sha256"] != reference_record.get("sha256")
        or dependencies["taxonomy"]["sha256"] != content.get("taxonomy_sha256")
        or dependencies["template"]["sha256"] != content.get("template_sha256")
    ):
        raise ContentBriefError("compiled brief producer inputs changed while revalidating")
    return dependencies


def revalidate_content_brief(
    root: Path, request_path: str | Path, brief_path: str | Path,
) -> dict[str, Any]:
    """Return a stored brief only when it exactly matches current producer inputs."""
    root = _safe_root(Path(root))
    request_file = _safe_existing(root, str(request_path), "request")
    brief_file = _safe_existing(root, str(brief_path), "brief")
    before = {"request": _sha256(request_file), "brief": _sha256(brief_file)}
    expected = _compile_content_brief(root, request_file)
    actual = _read_json(brief_file, "brief")
    repeated = _compile_content_brief(root, request_file)
    dependencies = _producer_dependencies(root, repeated)
    after = {"request": _sha256(request_file), "brief": _sha256(brief_file)}
    if before != after:
        raise ContentBriefError("brief or request changed while revalidating")
    if expected != repeated:
        raise ContentBriefError("brief producer inputs changed while revalidating")
    if actual != repeated:
        raise ContentBriefError("compiled brief is stale against current producer inputs")
    return {
        "record": repeated,
        "brief": {
            "path": brief_file.relative_to(root).as_posix(),
            "sha256": before["brief"],
        },
        "request": {
            "path": request_file.relative_to(root).as_posix(),
            "sha256": before["request"],
        },
        "dependencies": dependencies,
    }


def build_content_brief(root: Path, request_path: str | Path, output_path: str | Path) -> dict[str, Any]:
    """Validate a local request and write one new deterministic planning record."""
    root = _safe_root(Path(root))
    request_file = _safe_existing(root, str(request_path), "request")
    output_file = _safe_output(root, str(output_path))
    record = _compile_content_brief(root, request_file)
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


def _strict_date(value: object, name: str) -> str:
    if not isinstance(value, str) or not STRICT_DATE.fullmatch(value):
        raise ContentBriefError(f"{name} must be a canonical YYYY-MM-DD date")
    try:
        dt.date.fromisoformat(value)
    except ValueError as exc:
        raise ContentBriefError(f"{name} must be a canonical YYYY-MM-DD date") from exc
    return value


def _revision_base(value: object) -> Path:
    relative = _relative(value, "revise-base")
    if (
        len(relative.parts) != 3
        or relative.parts[0] != "content"
        or relative.parts[1] != "briefs"
        or len(relative.parts[2]) > 128
        or not CREATOR_ID.fullmatch(relative.parts[2])
    ):
        raise ContentBriefError("revise-base must be content/briefs/<normalized-id>")
    return relative


def _revision_text(edits: dict[str, Any], key: str) -> str:
    value = edits.get(key)
    if not isinstance(value, str) or not value or value != value.strip():
        raise ContentBriefError(f"{key} must be nonempty already-trimmed text")
    if _utf16_length(value) > MAX_TEXT:
        raise ContentBriefError(f"{key} exceeds the bounded text length")
    if _has_control_char(value) or any(0xD800 <= ord(character) <= 0xDFFF for character in value):
        raise ContentBriefError(f"{key} contains an unsupported character")
    return value


def _read_bounded_bytes(path: Path, label: str) -> bytes:
    try:
        with path.open("rb") as handle:
            value = handle.read(MAX_JSON_BYTES + 1)
    except OSError as exc:
        raise ContentBriefError(f"{label} could not be read") from exc
    if len(value) > MAX_JSON_BYTES:
        raise ContentBriefError(f"{label} exceeds {MAX_JSON_BYTES} bytes")
    return value


def _path_identity(path: Path) -> tuple[int, int]:
    info = path.stat()
    return info.st_dev, info.st_ino


def _fresh_revision_target(root: Path, value: object, base: Path) -> tuple[Path, Path, Path]:
    relative = _relative(value, "out-dir")
    if relative == base or base in relative.parents or relative in base.parents:
        raise ContentBriefError("out-dir must not equal or nest with revise-base")
    parent = root
    for part in relative.parts[:-1]:
        parent = parent / part
        if not parent.is_dir() or _is_reparse(parent):
            raise ContentBriefError("out-dir parent is missing or traverses a link")
    target = root / relative
    if target.exists() or _is_reparse(target):
        raise ContentBriefError("out-dir must be fresh")
    return relative, parent, target


def _cleanup_owned_revision(
    staging: Path,
    staging_identity: tuple[int, int],
    created: list[Path],
    identities: dict[Path, tuple[int, int]],
) -> None:
    """Best-effort nonrecursive cleanup after proving every owned identity first."""
    try:
        if _path_identity(staging) != staging_identity or _is_reparse(staging):
            return
        entries = list(staging.iterdir())
        if set(entries) != set(created):
            return
        for path in entries:
            if _is_reparse(path) or not path.is_file() or _path_identity(path) != identities.get(path):
                return
    except OSError:
        return
    for path in reversed(created):
        try:
            os.unlink(path)
        except OSError:
            return
    try:
        if _path_identity(staging) == staging_identity:
            staging.rmdir()
    except OSError:
        pass


def revise_content_brief(
    root: Path, base_dir: str, edits_path: str, out_dir: str,
) -> dict[str, Any]:
    """Publish a bounded creator-001 revision by one exclusive Windows directory rename.

    The returned publication descriptor carries hashes from staging validation. It is
    deliberately not a final-path revalidation proof; callers needing that proof must
    call ``revalidate_content_brief`` on its published request and brief paths.

    Supported publication model: CPython on Windows, a non-UNC local filesystem,
    sibling staging and target directories on one volume, and no hostile concurrent
    writer. The operation does not promise power-loss durability or couple the
    filesystem commit atomically to Python returning.
    """
    if os.name != "nt":
        raise ContentBriefError("revision publication is supported only on Windows")
    root = Path(root)
    if root.drive.startswith("\\\\"):
        raise ContentBriefError("revision publication requires a local non-UNC root")
    root = _safe_root(root)

    base_relative = _revision_base(base_dir)
    base_request_relative = (base_relative / "request.json").as_posix()
    base_brief_relative = (base_relative / "brief.json").as_posix()
    initial_base_proof = revalidate_content_brief(root, base_request_relative, base_brief_relative)
    if initial_base_proof["record"]["creator"]["id"] != "creator-001":
        raise ContentBriefError("revision is only permitted for the creator-001 base")

    base_request_file = _safe_existing(root, base_request_relative, "revise-base request")
    base_request_bytes = _read_bounded_bytes(base_request_file, "revise-base request")
    if hashlib.sha256(base_request_bytes).hexdigest() != initial_base_proof["request"]["sha256"]:
        raise ContentBriefError("base request changed while loading")
    try:
        base_request = json.loads(base_request_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContentBriefError("revise-base request is not valid JSON") from exc
    _check_shape(base_request, "revise-base request")
    if not isinstance(base_request, dict):
        raise ContentBriefError("revise-base request must be an object")

    edits_file = _safe_existing(root, edits_path, "edits")
    edits = _read_json(edits_file, "edits")
    _forbid_claims(edits)
    _only_keys(edits, EDIT_KEYS, "edits")
    missing = EDIT_KEYS - set(edits)
    if missing:
        raise ContentBriefError(f"edits is missing required fields: {', '.join(sorted(missing))}")

    revised_request = copy.deepcopy(base_request)
    revised_request["brief_date"] = _strict_date(edits.get("brief_date"), "brief_date")
    revised_request["hypothesis"] = _revision_text(edits, "hypothesis")
    revised_request["intended_metric"] = _revision_text(edits, "intended_metric")
    request_bytes = (json.dumps(revised_request, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if len(request_bytes) > MAX_JSON_BYTES:
        raise ContentBriefError("revised request exceeds output size limit")

    final_relative, final_parent, final_path = _fresh_revision_target(root, out_dir, base_relative)
    staging: Path | None = None
    staging_identity: tuple[int, int] | None = None
    created: list[Path] = []
    identities: dict[Path, tuple[int, int]] = {}
    try:
        try:
            staging = Path(tempfile.mkdtemp(prefix=f".{final_path.name}.staging-", dir=final_parent))
            staging_identity = _path_identity(staging)
        except OSError as exc:
            raise ContentBriefError("revision staging directory could not be created") from exc
        if _is_reparse(staging):
            raise ContentBriefError("revision staging directory must not be a link")

        request_path = staging / "request.json"
        try:
            with request_path.open("xb") as handle:
                request_identity = _path_identity(request_path)
                created.append(request_path)
                identities[request_path] = request_identity
                handle.write(request_bytes)
                handle.flush()
                os.fsync(handle.fileno())
        except OSError as exc:
            raise ContentBriefError("revised request could not be written") from exc

        request_relative = request_path.relative_to(root).as_posix()
        brief_path = staging / "brief.json"
        brief_relative = brief_path.relative_to(root).as_posix()
        try:
            build_content_brief(root, request_relative, brief_relative)
            created.append(brief_path)
            identities[brief_path] = _path_identity(brief_path)
        except OSError as exc:
            raise ContentBriefError("revised brief could not be compiled") from exc

        try:
            staged_proof = revalidate_content_brief(root, request_relative, brief_relative)
            final_base_proof = revalidate_content_brief(root, base_request_relative, base_brief_relative)
        except OSError as exc:
            raise ContentBriefError("revision inputs could not be revalidated") from exc
        if final_base_proof != initial_base_proof:
            raise ContentBriefError("base changed while the revision was being built")
        try:
            if _path_identity(staging) != staging_identity:
                raise ContentBriefError("revision staging directory identity changed")
            if _path_identity(request_path) != identities[request_path] or _path_identity(brief_path) != identities[brief_path]:
                raise ContentBriefError("revision staging file identity changed")
            if {entry.name for entry in staging.iterdir()} != {"request.json", "brief.json"}:
                raise ContentBriefError("revision staging directory must contain exactly the request and brief")
        except OSError as exc:
            raise ContentBriefError("revision staging directory could not be verified") from exc

        final_request_relative = (final_relative / "request.json").as_posix()
        final_brief_relative = (final_relative / "brief.json").as_posix()
        publication = {
            "schema": REVISION_PUBLICATION_SCHEMA,
            "base": final_base_proof,
            "record": staged_proof["record"],
            "prepublication_validation": {
                "request_sha256": staged_proof["request"]["sha256"],
                "brief_sha256": staged_proof["brief"]["sha256"],
                "dependencies": staged_proof["dependencies"],
            },
            "publication": {
                "directory": final_relative.as_posix(),
                "request": {
                    "path": final_request_relative,
                    "sha256": staged_proof["request"]["sha256"],
                },
                "brief": {
                    "path": final_brief_relative,
                    "sha256": staged_proof["brief"]["sha256"],
                },
                "final_paths_revalidated": False,
            },
        }
        try:
            os.rename(staging, final_path)
        except FileExistsError as exc:
            raise ContentBriefError("out-dir must remain fresh during publication") from exc
        except OSError as exc:
            raise ContentBriefError("revision directory could not be published") from exc
    except BaseException:
        if staging is not None and staging_identity is not None:
            try:
                _cleanup_owned_revision(staging, staging_identity, created, identities)
            except BaseException:
                pass
        raise
    return publication


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compile or revise one offline Figment content brief JSON record.")
    parser.add_argument("--root", required=True, help="root containing the request and creator files")
    parser.add_argument("--request", help="root-relative request JSON")
    parser.add_argument("--out", help="fresh root-relative brief JSON")
    parser.add_argument("--revise-base", help="root-relative content/briefs/<id> directory to revise")
    parser.add_argument("--edits", help="root-relative edits JSON")
    parser.add_argument("--out-dir", help="fresh root-relative output directory for the revision")
    args = parser.parse_args(argv)
    build_mode = args.request is not None or args.out is not None
    revision_mode = args.revise_base is not None or args.edits is not None or args.out_dir is not None
    if build_mode and revision_mode:
        parser.error("--request/--out and --revise-base/--edits/--out-dir are mutually exclusive")
    if build_mode:
        if args.request is None or args.out is None:
            parser.error("--request and --out are both required")
        try:
            build_content_brief(Path(args.root), args.request, args.out)
        except ContentBriefError as exc:
            parser.error(str(exc))
    elif revision_mode:
        if args.revise_base is None or args.edits is None or args.out_dir is None:
            parser.error("--revise-base, --edits, and --out-dir are all required")
        try:
            revise_content_brief(Path(args.root), args.revise_base, args.edits, args.out_dir)
        except ContentBriefError as exc:
            parser.error(str(exc))
    else:
        parser.error("either --request/--out or --revise-base/--edits/--out-dir is required")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
