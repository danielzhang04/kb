"""Bind current approved local gen stills to one compiled Figment content brief.

This offline adapter writes non-promotable planning evidence only. It neither
generates media nor grants image, batch, publication, or metric approval.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

try:
    from . import content_brief as briefs
except ImportError:  # Direct script execution.
    brief_path = Path(__file__).with_name("content_brief.py")
    brief_spec = importlib.util.spec_from_file_location(
        "figment_content_asset_brief_authority", brief_path,
    )
    if brief_spec is None or brief_spec.loader is None:
        raise RuntimeError("content brief authority is unavailable")
    briefs = importlib.util.module_from_spec(brief_spec)
    sys.modules[brief_spec.name] = briefs
    brief_spec.loader.exec_module(briefs)


SCHEMA = "figment/content-asset-assignment@1"
RULINGS_SCHEMA = "figment/content-slot-fit-rulings@1"
SOURCE_KIND = "approved-gen-still"
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
MAX_ATTRIBUTION = 256


class ContentAssetBindingError(ValueError):
    """A content brief cannot be bound to the supplied local assets."""


def _train_module() -> Any:
    """Load the existing gen approval authority without reproducing its rules."""
    name = "figment_content_asset_gen_authority"
    if name in sys.modules:
        return sys.modules[name]
    path = Path(__file__).parents[1] / "figment_train.py"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ContentAssetBindingError("approved gen authority is unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        sys.modules.pop(name, None)
        raise ContentAssetBindingError("approved gen authority is unavailable") from exc
    return module


def _text(value: object, label: str, maximum: int = MAX_ATTRIBUTION) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ContentAssetBindingError(f"{label} must be bounded nonempty text")
    return value.strip()


def _timestamp(value: object, label: str) -> str:
    text = _text(value, label, 64)
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContentAssetBindingError(f"{label} must be an ISO timestamp") from exc
    if parsed.tzinfo is None:
        raise ContentAssetBindingError(f"{label} must include a timezone")
    return text


def _only_keys(value: dict[str, Any], allowed: set[str], label: str) -> None:
    unexpected = sorted(set(value) - allowed)
    if unexpected:
        raise ContentAssetBindingError(
            f"{label} has unsupported fields: {', '.join(unexpected)}"
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _safe_input(root: Path, value: object, label: str) -> Path:
    try:
        return briefs._safe_existing(root, value, label)
    except (OSError, briefs.ContentBriefError) as exc:
        raise ContentAssetBindingError(str(exc)) from exc


def _safe_output(root: Path, value: object) -> Path:
    try:
        return briefs._safe_output(root, value)
    except (OSError, briefs.ContentBriefError) as exc:
        raise ContentAssetBindingError(str(exc)) from exc


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        return briefs._read_json(path, label)
    except (OSError, briefs.ContentBriefError) as exc:
        raise ContentAssetBindingError(str(exc)) from exc


def _current_brief(root: Path, request: object, brief: object) -> dict[str, Any]:
    try:
        return briefs.revalidate_content_brief(root, request, brief)
    except (OSError, briefs.ContentBriefError) as exc:
        raise ContentAssetBindingError(str(exc)) from exc


def _relative_record(
    root: Path, record: object, label: str, *, require_bytes: bool = False,
) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise ContentAssetBindingError(f"approved gen {label} record is malformed")
    raw_path, digest = record.get("path"), record.get("sha256")
    if not isinstance(raw_path, str) or not isinstance(digest, str) or not SHA256.fullmatch(digest):
        raise ContentAssetBindingError(f"approved gen {label} record is malformed")
    try:
        lexical = Path(raw_path)
        if not lexical.is_absolute():
            raise ValueError("not absolute")
        relative = lexical.relative_to(root)
    except ValueError as exc:
        raise ContentAssetBindingError(f"approved gen {label} escapes --root") from exc
    current = _safe_input(root, relative.as_posix(), f"approved gen {label}")
    if _sha256(current) != digest:
        raise ContentAssetBindingError(f"approved gen {label} bytes changed")
    result: dict[str, Any] = {"path": relative.as_posix(), "sha256": digest}
    if require_bytes:
        size = record.get("bytes")
        if isinstance(size, bool) or not isinstance(size, int) or size <= 0 or current.stat().st_size != size:
            raise ContentAssetBindingError("approved gen image byte count changed")
        result["bytes"] = size
    return result


def _preflight_gen_evidence(root: Path, plan: Path, train: Any) -> None:
    """Reject linked fixed evidence paths before invoking the legacy authority."""
    plan_relative = plan.relative_to(root)
    for name in (
        "approval-lineage.json", "approved-list.json", "rulings.json",
        "grading-manifest.json", "evaluation-inputs.json", "gate.json",
    ):
        relative = plan_relative.parent / "grade" / "gen" / name
        evidence = _safe_input(root, relative.as_posix(), f"approved gen {name}")
        _read_json(evidence, f"approved gen {name}")
    plan_record = _read_json(plan, "approved gen source plan")
    assets = plan_record.get("assets")
    persona_dir = assets.get("persona_dir") if isinstance(assets, dict) else None
    if not isinstance(persona_dir, str):
        raise ContentAssetBindingError("approved gen plan persona path is malformed")
    try:
        _authority_persona_path(root, Path(train.ROOT), persona_dir)
    except AttributeError as exc:
        raise ContentAssetBindingError("approved gen persona authority is malformed") from exc


def _file_entry(path: Path) -> dict[str, Any]:
    return {"name": path.name, "bytes": path.stat().st_size, "sha256": _sha256(path)}


def _authority_persona_path(root: Path, train_root: Path, persona_dir: str) -> Path:
    relative = Path(persona_dir)
    if relative.is_absolute() or relative.drive:
        raise ContentAssetBindingError("approved gen persona path must be authority-root-relative")
    current = Path(train_root)
    for part in relative.parts:
        if part in ("", "."):
            continue
        if part == "..":
            current = current.parent
            continue
        current = current / part
        if briefs._is_reparse(current):
            raise ContentAssetBindingError("approved gen persona path traverses a link")
    current = current / "persona.yaml"
    if briefs._is_reparse(current):
        raise ContentAssetBindingError("approved gen persona path traverses a link")
    try:
        resolved = current.resolve(strict=True)
        relative_to_root = resolved.relative_to(root)
    except (OSError, ValueError) as exc:
        raise ContentAssetBindingError("approved gen persona escapes --root") from exc
    return _safe_input(root, relative_to_root.as_posix(), "approved gen persona")


def _assert_identity_join(
    root: Path, brief: dict[str, Any], asset: dict[str, Any], train: Any,
) -> None:
    creator_record = brief.get("creator")
    if not isinstance(creator_record, dict):
        raise ContentAssetBindingError("brief identity binding is malformed")
    persona_record = creator_record.get("persona")
    reference_record = creator_record.get("canonical_reference")
    if not isinstance(persona_record, dict) or not isinstance(reference_record, dict):
        raise ContentAssetBindingError("brief identity binding is malformed")
    plan_path = _safe_input(root, asset["source_plan"]["path"], "approved gen source plan")
    plan = _read_json(plan_path, "approved gen source plan")
    if (
        plan.get("schema") != "figment/train-plan@1"
        or plan.get("creator") != creator_record.get("id")
        or plan.get("persona_sha256") != persona_record.get("sha256")
    ):
        raise ContentAssetBindingError("approved gen plan does not bind the brief persona")

    persona_dir = plan.get("assets", {}).get("persona_dir") if isinstance(plan.get("assets"), dict) else None
    if not isinstance(persona_dir, str):
        raise ContentAssetBindingError("approved gen plan persona path is malformed")
    try:
        authority_persona = _authority_persona_path(root, Path(train.ROOT), persona_dir)
    except AttributeError as exc:
        raise ContentAssetBindingError("approved gen persona authority is malformed") from exc
    if _sha256(authority_persona) != persona_record.get("sha256"):
        raise ContentAssetBindingError("approved gen persona differs from the brief persona")

    plan_root = plan_path.parent
    anchors = plan.get("assets", {}).get("anchors") if isinstance(plan.get("assets"), dict) else None
    if not isinstance(anchors, list) or not anchors:
        raise ContentAssetBindingError("approved gen plan anchor inventory is malformed")
    anchor_entries: list[dict[str, Any]] = []
    for value in anchors:
        anchor = _safe_input(plan_root, value, "approved gen anchor")
        anchor_entries.append(_file_entry(anchor))
    reference_name = Path(str(reference_record.get("declared_path", ""))).name
    if not any(
        entry["name"] == reference_name and entry["sha256"] == reference_record.get("sha256")
        for entry in anchor_entries
    ):
        raise ContentAssetBindingError("approved gen anchors do not contain the brief canonical reference")

    approval_path = _safe_input(
        root, asset["approval_lineage"]["path"], "approved gen approval lineage",
    )
    approval = _read_json(approval_path, "approved gen approval lineage")
    subject = approval.get("subject")
    if not isinstance(subject, dict) or subject.get("creator") != creator_record.get("id"):
        raise ContentAssetBindingError("approved gen approval subject has the wrong creator")
    subject_persona = subject.get("persona")
    if not isinstance(subject_persona, dict) or subject_persona.get("id") != creator_record.get("id"):
        raise ContentAssetBindingError("approved gen approval subject has the wrong persona")
    if subject.get("anchors") != anchor_entries:
        raise ContentAssetBindingError("approved gen approval anchors differ from the plan")

    approved_list = _read_json(
        _safe_input(root, asset["approved_list"]["path"], "approved gen approved list"),
        "approved gen approved list",
    )
    rows = approved_list.get("images")
    selected = next(
        (row for row in rows if isinstance(row, dict) and row.get("image_id") == asset["image_id"]),
        None,
    ) if isinstance(rows, list) else None
    if not isinstance(selected, dict) or not isinstance(selected.get("path"), str):
        raise ContentAssetBindingError("approved gen image is absent from its approved list")
    selected_path = Path(selected["path"])
    try:
        selected_relative = selected_path.relative_to(root)
    except ValueError as exc:
        raise ContentAssetBindingError("approved gen image escapes --root") from exc
    lexical_image = _safe_input(root, selected_relative.as_posix(), "approved gen image")
    if (
        lexical_image.relative_to(root).as_posix() != asset["path"]
        or _sha256(lexical_image) != asset["sha256"]
    ):
        raise ContentAssetBindingError("approved gen image path or bytes differ from authority")


def _project_authority(root: Path, authority: object, image_id: str) -> dict[str, Any]:
    if not isinstance(authority, dict) or authority.get("image_id") != image_id:
        raise ContentAssetBindingError("approved gen authority returned the wrong image")
    image = _relative_record(root, authority, "image", require_bytes=True)
    return {
        "kind": SOURCE_KIND,
        "image_id": image_id,
        **image,
        "source_plan": _relative_record(root, authority.get("source_plan"), "plan"),
        "approval_lineage": _relative_record(
            root, authority.get("approval_lineage"), "approval lineage",
        ),
        "approved_list": _relative_record(
            root, authority.get("approved_list"), "approved list",
        ),
    }


def _validate_source(
    root: Path, creator: str, brief: dict[str, Any], source: dict[str, Any], train: Any,
) -> dict[str, Any]:
    _only_keys(source, {"kind", "plan", "image_id"}, "slot source")
    if source.get("kind") != SOURCE_KIND:
        raise ContentAssetBindingError("only approved-gen-still sources are supported")
    plan_value = source.get("plan")
    image_id = _text(source.get("image_id"), "slot source image_id", 256)
    plan = _safe_input(root, plan_value, "slot source plan")
    _preflight_gen_evidence(root, plan, train)
    try:
        authority = train.validate_approved_gen_still(creator, plan, image_id)
    except Exception as exc:
        raise ContentAssetBindingError("approved gen authority rejected a slot source") from exc
    projected = _project_authority(root, authority, image_id)
    _assert_identity_join(root, brief, projected, train)
    return projected


def build_content_asset_binding(
    *, root: Path, brief_path: str | Path, request_path: str | Path,
    rulings_path: str | Path, output_path: str | Path,
) -> dict[str, Any]:
    """Validate exact slot-fit rulings and write one fresh planning record."""
    try:
        root = briefs._safe_root(Path(root))
    except (OSError, briefs.ContentBriefError) as exc:
        raise ContentAssetBindingError(str(exc)) from exc
    output = _safe_output(root, output_path)
    current = _current_brief(root, request_path, brief_path)
    brief = current["record"]
    creator = brief.get("creator", {}).get("id") if isinstance(brief.get("creator"), dict) else None
    content = brief.get("content") if isinstance(brief.get("content"), dict) else None
    slots = content.get("required_asset_slots") if isinstance(content, dict) else None
    if not isinstance(creator, str) or not isinstance(slots, list) or not slots:
        raise ContentAssetBindingError("current brief has no valid creator or required slots")

    rulings_file = _safe_input(root, rulings_path, "slot-fit rulings")
    rulings_digest = _sha256(rulings_file)
    rulings = _read_json(rulings_file, "slot-fit rulings")
    _only_keys(rulings, {"schema", "brief", "creator", "rulings"}, "slot-fit rulings")
    brief_ref = rulings.get("brief")
    if not isinstance(brief_ref, dict):
        raise ContentAssetBindingError("slot-fit rulings brief binding is malformed")
    _only_keys(brief_ref, {"path", "sha256"}, "slot-fit rulings brief binding")
    if (
        rulings.get("schema") != RULINGS_SCHEMA
        or rulings.get("creator") != creator
        or brief_ref != current["brief"]
    ):
        raise ContentAssetBindingError("slot-fit rulings do not bind the current brief and creator")
    rows = rulings.get("rulings")
    if not isinstance(rows, list) or len(rows) != len(slots):
        raise ContentAssetBindingError("slot-fit rulings must cover every required slot exactly")

    by_index: dict[int, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ContentAssetBindingError("each slot-fit ruling must be an object")
        _only_keys(
            row,
            {"slot_index", "role", "taxonomy_type", "kind", "decision", "decided_by", "decided_at", "source"},
            "slot-fit ruling",
        )
        index = row.get("slot_index")
        if isinstance(index, bool) or not isinstance(index, int) or index in by_index:
            raise ContentAssetBindingError("slot-fit rulings contain an invalid or duplicate index")
        by_index[index] = row
    expected_indices = [slot.get("index") if isinstance(slot, dict) else None for slot in slots]
    if set(by_index) != set(expected_indices):
        raise ContentAssetBindingError("slot-fit rulings must cover the exact required slot indices")

    train = _train_module()
    used_images: set[str] = set()
    assignments: list[dict[str, Any]] = []
    source_inputs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for slot in slots:
        assert isinstance(slot, dict)
        row = by_index[slot["index"]]
        expected = {
            "slot_index": slot["index"], "role": slot.get("role"),
            "taxonomy_type": slot.get("taxonomy_type"), "kind": slot.get("kind"),
        }
        if any(row.get(key) != value for key, value in expected.items()):
            raise ContentAssetBindingError("slot-fit ruling does not match its exact brief slot")
        if row.get("kind") != "persona" or row.get("taxonomy_type") == "G":
            raise ContentAssetBindingError("nonpersona and motion/video slots have no supported authority")
        if row.get("decision") != "fit":
            raise ContentAssetBindingError("every slot requires an explicit fit ruling")
        attribution = {
            "decision": "fit",
            "decided_by": _text(row.get("decided_by"), "slot decided_by"),
            "decided_at": _timestamp(row.get("decided_at"), "slot decided_at"),
        }
        source = row.get("source")
        if not isinstance(source, dict):
            raise ContentAssetBindingError("slot source must be an object")
        image_id = source.get("image_id")
        if not isinstance(image_id, str) or image_id in used_images:
            raise ContentAssetBindingError("each slot must use a distinct approved gen image id")
        used_images.add(image_id)
        asset = _validate_source(root, creator, brief, source, train)
        source_inputs.append((source, asset))
        assignments.append({**expected, "slot_fit": attribution, "asset": asset})

    result = {
        "schema": SCHEMA,
        "not_promotable": True,
        "provenance": "offline content-slot planning evidence; no new asset, batch, publication, or metric approval",
        "brief": current["brief"],
        "request": current["request"],
        "rulings": {
            "path": rulings_file.relative_to(root).as_posix(),
            "sha256": rulings_digest,
        },
        "creator": creator,
        "assignments": assignments,
    }
    encoded = (json.dumps(result, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if len(encoded) > briefs.MAX_JSON_BYTES:
        raise ContentAssetBindingError("content asset assignment exceeds output size limit")

    if _current_brief(root, request_path, brief_path) != current:
        raise ContentAssetBindingError("brief producer inputs changed during asset binding")
    if _sha256(rulings_file) != rulings_digest:
        raise ContentAssetBindingError("slot-fit rulings changed during asset binding")
    for source, captured in source_inputs:
        if _validate_source(root, creator, brief, source, train) != captured:
            raise ContentAssetBindingError("approved gen evidence changed during asset binding")

    try:
        with output.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError as exc:
        raise ContentAssetBindingError("output must be fresh") from exc
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Bind current approved gen stills to one offline content brief.",
    )
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--brief", required=True)
    parser.add_argument("--request", required=True)
    parser.add_argument("--rulings", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        result = build_content_asset_binding(
            root=args.root, brief_path=args.brief, request_path=args.request,
            rulings_path=args.rulings, output_path=args.out,
        )
    except ContentAssetBindingError as exc:
        parser.error(str(exc))
    print(f"content asset assignment: {args.out}")
    print(f"assigned slots: {len(result['assignments'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
