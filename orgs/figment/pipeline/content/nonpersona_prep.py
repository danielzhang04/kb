"""Prepare one non-persona content-brief slot without generating, reviewing, or

delivering any image.

This offline builder freezes a deterministic prompt, a fixed seed set, and the
current pinned tester base model for one existing C/D/E slot of a compiled
content brief. It writes non-promotable planning evidence only: it does not
generate media, invoke a provider, judge realism, decide slot fit, or bind a
brief to any asset.
"""

from __future__ import annotations

import argparse
import copy
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
        "figment_nonpersona_prep_brief_authority", brief_path,
    )
    if brief_spec is None or brief_spec.loader is None:
        raise RuntimeError("content brief authority is unavailable")
    briefs = importlib.util.module_from_spec(brief_spec)
    sys.modules[brief_spec.name] = briefs
    brief_spec.loader.exec_module(briefs)


REQUEST_SCHEMA = "figment/nonpersona-scene-request@1"
OUTPUT_SCHEMA = "figment/nonpersona-slot-preparation@1"
PROMPT_ID = "nonpersona-scene-v1"
ALLOWED_NONPERSONA_TYPES = ("C", "D", "E")
MAX_SUBJECT = 512
PERSON_TERMS = (
    "woman", "man", "girl", "boy", "person", "people", "hand", "hands",
    "selfie", "model", "face", "portrait", "crowd", "reflection", "mannequin",
)
PERSON_TERM_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(term) for term in PERSON_TERMS) + r")\b",
    re.IGNORECASE,
)


class NonpersonaPrepError(ValueError):
    """A non-persona slot cannot be prepared from the supplied local inputs."""


def _strict_equal(a: Any, b: Any) -> bool:
    """Exact JSON equality: bool and number are distinct types, unlike `==`."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_strict_equal(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_strict_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return type(a) is type(b) and a == b
    return type(a) is type(b) and a == b


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _train_module() -> Any:
    """Load the existing tensor-pins authority the same way content_asset_binding does."""
    name = "figment_nonpersona_prep_gen_authority"
    if name in sys.modules:
        return sys.modules[name]
    path = Path(__file__).parents[1] / "figment_train.py"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise NonpersonaPrepError("tensor-pins authority is unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        sys.modules.pop(name, None)
        raise NonpersonaPrepError("tensor-pins authority is unavailable") from exc
    return module


def _only_keys(value: dict[str, Any], allowed: set[str], label: str) -> None:
    unexpected = sorted(set(value) - allowed)
    if unexpected:
        raise NonpersonaPrepError(f"{label} has unsupported fields: {', '.join(unexpected)}")


def _normalize_relative(value: object) -> object:
    """Reduce a genuine Path to its posix form so the string-only authority
    guards below never see a platform-specific separator; anything else
    (including non-Path objects) is passed through untouched."""
    if isinstance(value, Path):
        return value.as_posix()
    return value


def _safe_input(root: Path, value: object, label: str) -> Path:
    try:
        return briefs._safe_existing(root, _normalize_relative(value), label)
    except (OSError, briefs.ContentBriefError) as exc:
        raise NonpersonaPrepError(str(exc)) from exc


def _safe_output(root: Path, value: object) -> Path:
    try:
        return briefs._safe_output(root, _normalize_relative(value))
    except (OSError, briefs.ContentBriefError) as exc:
        raise NonpersonaPrepError(str(exc)) from exc


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        return briefs._read_json(path, label)
    except (OSError, briefs.ContentBriefError) as exc:
        raise NonpersonaPrepError(str(exc)) from exc


def _current_brief(root: Path, request_path: object, brief_path: object) -> dict[str, Any]:
    try:
        return briefs.revalidate_content_brief(
            root, _normalize_relative(request_path), _normalize_relative(brief_path),
        )
    except (OSError, briefs.ContentBriefError) as exc:
        raise NonpersonaPrepError(str(exc)) from exc


def _find_slot(slots: list[Any], slot_index: object) -> dict[str, Any]:
    if isinstance(slot_index, bool) or not isinstance(slot_index, int):
        raise NonpersonaPrepError("slot_index must be an integer")
    for slot in slots:
        if isinstance(slot, dict) and slot.get("index") == slot_index:
            return slot
    raise NonpersonaPrepError("no such slot in the current brief")


def _validate_subject(subject: object, creator_id: str, trigger: str | None) -> str:
    if not isinstance(subject, str) or not subject:
        raise NonpersonaPrepError("subject must be bounded nonempty text")
    if briefs._utf16_length(subject) > MAX_SUBJECT:
        raise NonpersonaPrepError(f"subject exceeds {MAX_SUBJECT} UTF-16 units")
    if briefs._has_control_char(subject):
        raise NonpersonaPrepError("subject must not contain control characters")
    if subject.strip() != subject:
        raise NonpersonaPrepError("subject must already be trimmed")
    lowered = subject.lower()
    if creator_id and creator_id.lower() in lowered:
        raise NonpersonaPrepError("subject must not name the creator id")
    if trigger and trigger.lower() in lowered:
        raise NonpersonaPrepError("subject must not name the persona training trigger")
    if any(0xD800 <= ord(ch) <= 0xDFFF for ch in subject):
        raise NonpersonaPrepError("subject must not contain lone surrogate code points")
    if PERSON_TERM_RE.search(subject):
        raise NonpersonaPrepError("subject uses a person-denylisted word; this is a cheap guard, not a safety gate")
    return subject


def _validate_scene(
    root: Path, current: dict[str, Any], scene: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    _only_keys(scene, {"schema", "brief", "slot_index", "taxonomy_type", "subject"}, "scene request")
    briefs._forbid_claims(scene)
    if scene.get("schema") != REQUEST_SCHEMA:
        raise NonpersonaPrepError("unexpected nonpersona scene request schema")
    brief_ref = scene.get("brief")
    if not isinstance(brief_ref, dict):
        raise NonpersonaPrepError("scene request brief binding is malformed")
    _only_keys(brief_ref, {"path", "sha256"}, "scene request brief binding")
    if brief_ref != current["brief"]:
        raise NonpersonaPrepError("scene request does not bind the current brief")

    record = current["record"]
    content = record.get("content") if isinstance(record, dict) else None
    slots = content.get("required_asset_slots") if isinstance(content, dict) else None
    if not isinstance(slots, list):
        raise NonpersonaPrepError("current brief has no valid required slots")
    slot = _find_slot(slots, scene.get("slot_index"))
    taxonomy_type = scene.get("taxonomy_type")
    if not isinstance(taxonomy_type, str) or taxonomy_type != slot.get("taxonomy_type"):
        raise NonpersonaPrepError("scene request taxonomy_type does not match the exact brief slot")
    if slot.get("kind") != "nonpersona":
        raise NonpersonaPrepError("slot kind must be nonpersona")
    if taxonomy_type not in ALLOWED_NONPERSONA_TYPES:
        raise NonpersonaPrepError("taxonomy type is not supported by this preparation slice")

    creator = record.get("creator") if isinstance(record, dict) else None
    creator_id = creator.get("id") if isinstance(creator, dict) else None
    if not isinstance(creator_id, str) or not creator_id:
        raise NonpersonaPrepError("current brief has no valid creator id")
    persona_dependency = current.get("dependencies", {}).get("persona")
    persona_path = persona_dependency.get("path") if isinstance(persona_dependency, dict) else None
    persona = _read_json(_safe_input(root, persona_path, "current persona"), "current persona")
    training = persona.get("training")
    trigger = training.get("trigger") if isinstance(training, dict) else None
    if trigger is not None and not isinstance(trigger, str):
        raise NonpersonaPrepError("current persona training trigger is malformed")

    subject = _validate_subject(scene.get("subject"), creator_id, trigger)
    return slot, subject


def _taxonomy_surface(root: Path, current: dict[str, Any]) -> dict[str, Any]:
    taxonomy_path = briefs.CONTENT_DIR / "taxonomy.yaml"
    expected_sha = current.get("dependencies", {}).get("taxonomy", {}).get("sha256")
    if briefs._is_reparse(taxonomy_path) or not taxonomy_path.is_file():
        raise NonpersonaPrepError("taxonomy producer input is missing or linked")
    if _sha256(taxonomy_path) != expected_sha:
        raise NonpersonaPrepError("taxonomy changed while preparing nonpersona slot")
    taxonomy = _read_json(taxonomy_path, "taxonomy")
    surfaces = taxonomy.get("surfaces")
    still = surfaces.get("still") if isinstance(surfaces, dict) else None
    if not isinstance(still, dict) or set(still) != {"aspect", "width", "height"}:
        raise NonpersonaPrepError("taxonomy still surface is malformed")
    return dict(still)


def _generation_basis(root: Path, current: dict[str, Any]) -> tuple[dict[str, Any], list[int]]:
    train = _train_module()
    pins_path = Path(train.PINS_PATH)
    if briefs._is_reparse(pins_path) or not pins_path.is_file():
        raise NonpersonaPrepError("tensor-pins producer input is missing or linked")
    pins_sha = _sha256(pins_path)
    try:
        pins = train._read_json(pins_path)
        models = copy.deepcopy(pins["pins"]["tester"]["models"])
        seeds = list(train.DIAGNOSTIC_PROTOCOL_SEEDS[:3])
    except Exception as exc:  # noqa: BLE001 - the pinned authority defines its own error type
        raise NonpersonaPrepError("tensor-pins producer input is malformed") from exc
    delivery_target = _taxonomy_surface(root, current)
    # Recheck the pins file after the taxonomy read (the longest step here) so a
    # concurrent edit between the two reads cannot bind a stale model set.
    if briefs._is_reparse(pins_path) or not pins_path.is_file():
        raise NonpersonaPrepError("tensor-pins producer input is missing or linked")
    if _sha256(pins_path) != pins_sha:
        raise NonpersonaPrepError("tensor-pins changed while preparing nonpersona slot")
    basis = {
        "arm": "base-model-no-lora",
        "pins_sha256": pins_sha,
        "models": models,
        "harness": "pod/ via figment_train._planned_run",
        # This is the delivery surface from taxonomy.yaml, not a claim about what
        # dimensions the base tester model natively infers at.
        "delivery_target": delivery_target,
        "native_inference_dimensions": None,
    }
    return basis, seeds


def _final_recheck(
    root: Path, current: dict[str, Any], scene_file: Path, scene_sha: str,
) -> None:
    """Recheck every producer input's identity once more after the longest
    validation step, so nothing bound above can have been swapped in the gap
    between its own read and this record's publication."""
    checks: list[tuple[str, Path, str]] = [
        ("scene", scene_file, scene_sha),
        (
            "brief", root / current["brief"]["path"], current["brief"]["sha256"],
        ),
        (
            "request", root / current["request"]["path"], current["request"]["sha256"],
        ),
    ]
    content_relative = {"taxonomy", "template"}
    for label, dependency in current["dependencies"].items():
        base = briefs.CONTENT_DIR if label in content_relative else root
        checks.append((label, base / dependency["path"], dependency["sha256"]))
    for label, path, expected_sha in checks:
        if briefs._is_reparse(path) or not path.is_file():
            raise NonpersonaPrepError(f"{label} producer input is missing or linked")
        if _sha256(path) != expected_sha:
            raise NonpersonaPrepError(f"{label} changed while preparing nonpersona slot")


def _compile_record(
    root: Path, request_path: object, brief_path: object, scene_path: object,
) -> dict[str, Any]:
    scene_file = _safe_input(root, scene_path, "scene")
    scene_sha = _sha256(scene_file)
    scene = _read_json(scene_file, "scene request")

    current = _current_brief(root, request_path, brief_path)
    slot, subject = _validate_scene(root, current, scene)
    basis, seeds = _generation_basis(root, current)

    # Fresh bounded snapshot after the longest validation above: reconfirm every
    # producer path's identity, not only the ones read most recently.
    _final_recheck(root, current, scene_file, scene_sha)

    creator_id = current["record"]["creator"]["id"]
    prompt_text = (
        f"{subject}. Empty scene with no people, no hands, no faces, no reflections "
        "or silhouettes of people. Unretouched phone photograph."
    )
    return {
        "schema": OUTPUT_SCHEMA,
        "not_promotable": True,
        "stage": "prepared-image-free",
        "claims": {
            "generated": False, "reviewed": False, "slot_fit": False, "delivered": False,
        },
        "brief": current["brief"],
        "request": current["request"],
        "dependencies": current["dependencies"],
        "scene": {
            "path": scene_file.relative_to(root).as_posix(),
            "sha256": scene_sha,
        },
        "creator": creator_id,
        "slot": {
            "index": slot["index"], "role": slot.get("role"),
            "taxonomy_type": slot.get("taxonomy_type"), "kind": "nonpersona",
        },
        "prompt": {"id": PROMPT_ID, "text": prompt_text},
        "seeds": seeds,
        "generation_basis": basis,
        "people_policy": "reject-any-person",
    }


def _encode(record: dict[str, Any]) -> bytes:
    encoded = (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if len(encoded) > briefs.MAX_JSON_BYTES:
        raise NonpersonaPrepError("nonpersona slot preparation exceeds output size limit")
    return encoded


def build_nonpersona_slot_preparation(
    *, root: Path, request_path: str | Path, brief_path: str | Path,
    scene_path: str | Path, output_path: str | Path,
) -> dict[str, Any]:
    """Validate one exact nonpersona slot request and write a fresh preparation record."""
    try:
        root = briefs._safe_root(Path(root))
    except (OSError, briefs.ContentBriefError) as exc:
        raise NonpersonaPrepError(str(exc)) from exc

    record = _compile_record(root, request_path, brief_path, scene_path)
    encoded = _encode(record)

    # Recheck every hash-bound dependency immediately before publication so a
    # concurrent edit during the work above cannot slip an unbound record out.
    replay = _compile_record(root, request_path, brief_path, scene_path)
    if not _strict_equal(replay, record):
        raise NonpersonaPrepError("nonpersona preparation inputs changed while preparing the slot")

    # Revalidate the output's own ancestor chain fresh, right before writing,
    # so an ancestor swapped for a symlink during the validation above cannot
    # redirect this write.
    output_file = _safe_output(root, output_path)

    try:
        with output_file.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError as exc:
        raise NonpersonaPrepError("output must be fresh") from exc
    return record


def revalidate_nonpersona_slot_preparation(
    root: Path, request_path: str | Path, brief_path: str | Path,
    scene_path: str | Path, output_path: str | Path,
) -> dict[str, Any]:
    """Return a stored preparation only when it exactly matches current producer inputs."""
    try:
        root = briefs._safe_root(Path(root))
    except (OSError, briefs.ContentBriefError) as exc:
        raise NonpersonaPrepError(str(exc)) from exc
    output_file = _safe_input(root, output_path, "nonpersona slot preparation")
    stored = _read_json(output_file, "nonpersona slot preparation")
    reconstructed = _compile_record(root, request_path, brief_path, scene_path)
    if not _strict_equal(stored, reconstructed):
        raise NonpersonaPrepError("stored nonpersona slot preparation is stale against current inputs")
    return reconstructed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Prepare one offline non-persona content-brief slot (no image generation).",
    )
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--brief", required=True)
    parser.add_argument("--request", required=True)
    parser.add_argument("--scene", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        record = build_nonpersona_slot_preparation(
            root=args.root, request_path=args.request, brief_path=args.brief,
            scene_path=args.scene, output_path=args.out,
        )
    except NonpersonaPrepError as exc:
        parser.error(str(exc))
    print(f"nonpersona slot preparation: {args.out}")
    print(f"slot: {record['slot']['index']} ({record['slot']['taxonomy_type']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
