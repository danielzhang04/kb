#!/usr/bin/env python3
"""Bounded, offline-only Figment video diagnostic planning.

This module has no renderer, model download, provider, subprocess, approval, or
production path. It records only local, unverified diagnostic inputs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

PLAN_SCHEMA = "figment/video-diagnostic-plan@1"
FRAME_SCHEMA = "figment/video-first-frame-input@1"
INVENTORY_SCHEMA = "figment/video-sample-inventory@1"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
CHILD_TERMS = re.compile(r"\b(child|minor|underage|teen(?:age)?|schoolgirl)\b", re.I)
UNSAFE_ACTION_TERMS = re.compile(r"\b(nude|naked|topless|lingerie|sexual|explicit)\b", re.I)
MAX_JSON_BYTES = 256 * 1024
MAX_FRAME_BYTES = 32 * 1024 * 1024
MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024
MAX_JSON_DEPTH = 32


class VideoPlanError(ValueError):
    """Raised when local diagnostic evidence is unsafe, stale, or malformed."""


def _root(path: Path) -> Path:
    try:
        lexical = path.absolute()
        if not lexical.is_dir() or any(part.is_symlink() for part in (lexical, *lexical.parents)):
            raise VideoPlanError("root must be a real directory, never a symlink")
        return lexical.resolve(strict=True)
    except OSError as exc:
        raise VideoPlanError("root directory is unavailable") from exc


def _within(root: Path, value: Path, label: str, *, allow_missing: bool = False) -> Path:
    if value.is_absolute() or not value.parts or ".." in value.parts:
        raise VideoPlanError(f"{label} must be a relative path below --root")
    cursor = root
    for index, part in enumerate(value.parts):
        cursor = cursor / part
        if cursor.exists() or cursor.is_symlink():
            if cursor.is_symlink():
                raise VideoPlanError(f"{label} may not traverse a symlink")
        elif not allow_missing or index != len(value.parts) - 1:
            raise VideoPlanError(f"{label} is missing: {value.as_posix()}")
    return cursor


def _depth_ok(source: str) -> bool:
    depth = 0
    quoted = escaped = False
    for character in source:
        if quoted:
            if escaped: escaped = False
            elif character == "\\": escaped = True
            elif character == '"': quoted = False
            continue
        if character == '"': quoted = True
        elif character in "{[":
            depth += 1
            if depth > MAX_JSON_DEPTH: return False
        elif character in "}]": depth -= 1
    return not quoted and depth == 0


def _read_json(root: Path, relative: Path, label: str) -> dict[str, Any]:
    path = _within(root, relative, label)
    if not path.is_file() or path.stat().st_size > MAX_JSON_BYTES:
        raise VideoPlanError(f"{label} must be a regular JSON file no larger than {MAX_JSON_BYTES} bytes")
    try:
        source = path.read_text(encoding="utf-8")
        value = json.loads(source)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise VideoPlanError(f"cannot read {label} JSON") from exc
    if not _depth_ok(source) or not isinstance(value, dict):
        raise VideoPlanError(f"{label} JSON must be a shallow object")
    return value


def _file(root: Path, relative: Path, label: str, maximum: int) -> dict[str, Any]:
    path = _within(root, relative, label)
    if not path.is_file(): raise VideoPlanError(f"{label} must be a regular file")
    size = path.stat().st_size
    if size <= 0 or size > maximum: raise VideoPlanError(f"{label} exceeds its {maximum}-byte diagnostic limit")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""): digest.update(chunk)
    return {"path": relative.as_posix(), "bytes": size, "sha256": digest.hexdigest()}


def _require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip(): raise VideoPlanError(f"{field} must be a non-empty string")
    return value.strip()


def _contains_approval_claim(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            any(term in str(key).casefold() for term in ("approv", "accept", "decision"))
            or _contains_approval_claim(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(_contains_approval_claim(item) for item in value)
    return False


def _first_frame(root: Path, receipt_path: Path, creator: str) -> dict[str, Any]:
    receipt = _read_json(root, receipt_path, "first-frame receipt")
    if receipt.get("schema") != FRAME_SCHEMA or receipt.get("creator") != creator:
        raise VideoPlanError("first-frame input has the wrong schema or creator")
    if _contains_approval_claim(receipt):
        raise VideoPlanError("first-frame input may not assert approval; upstream lineage is not wired")
    frame = receipt.get("first_frame")
    if not isinstance(frame, dict): raise VideoPlanError("first-frame input lacks first_frame provenance")
    recorded_path = _require_text(frame.get("path"), "first_frame.path")
    if not isinstance(frame.get("bytes"), int) or not SHA256.fullmatch(str(frame.get("sha256", ""))):
        raise VideoPlanError("first-frame input has invalid byte/hash provenance")
    actual = _file(root, Path(recorded_path), "first frame", MAX_FRAME_BYTES)
    if actual["bytes"] != frame["bytes"] or actual["sha256"] != frame["sha256"]:
        raise VideoPlanError("first-frame bytes no longer match the diagnostic input")
    return {"receipt": _file(root, receipt_path, "first-frame receipt", MAX_JSON_BYTES), "frame": actual, "provenance_state": "unverified-local-input"}


def _motion(persona: dict[str, Any], action: str) -> tuple[str, str]:
    look = persona.get("identity", {}).get("look") if isinstance(persona.get("identity"), dict) else None
    if not isinstance(look, dict): raise VideoPlanError("persona has no identity.look")
    age = _require_text(look.get("age_stage"), "identity.look.age_stage")
    clothing = _require_text(look.get("clothing"), "identity.look.clothing")
    if not re.search(r"\badult\b", age, re.I) or CHILD_TERMS.search(age):
        raise VideoPlanError("persona age_stage must use adult wording and no child/minor vocabulary")
    action = _require_text(action, "action")
    if len(action) > 140 or "\n" in action or UNSAFE_ACTION_TERMS.search(action):
        raise VideoPlanError("action must be a short clothed Instagram-register motion instruction")
    return age, f"{age}; {clothing}; {action}"


def build_diagnostic_plan(*, root: Path, persona_path: Path, first_frame_receipt: Path, driving_video: Path, action: str, mode: str = "diagnostic") -> dict[str, Any]:
    root = _root(root)
    if mode != "diagnostic": raise VideoPlanError("production video planning is disabled until real upstream lineage and human gates are wired")
    persona = _read_json(root, persona_path, "persona")
    creator = _require_text(persona.get("id"), "persona.id")
    age, prompt = _motion(persona, action)
    return {"schema": PLAN_SCHEMA, "creator": creator, "mode": "diagnostic", "execution": {"offline_only": True, "renderer": None, "not_promotable": True, "provenance_state": "unverified"}, "model_adoption": {"status": "blocked-unadopted", "candidate": "Wan-AI/Wan2.2-I2V-A14B", "revision": "00182421b2da3589352abed7e139a6bd5c1f86ab", "licence": "Apache-2.0", "reason": "No approved Figment video tensor-pins profile or safe asset inventory exists."}, "first_frame": _first_frame(root, first_frame_receipt, creator), "driving_video": _file(root, driving_video, "driving video", MAX_VIDEO_BYTES), "motion": {"prompt": prompt, "age_stage": age, "action": action, "single_subject_required": True, "background_or_expression_prompting": False}, "frame_budget": {"frames": 60, "fps": 12, "sample_indices": [0, 29, 59]}}


def build_sample_inventory(*, root: Path, plan_path: Path, candidate_video: Path, initial_frame: Path, sample_paths: list[Path]) -> dict[str, Any]:
    root = _root(root)
    plan = _read_json(root, plan_path, "diagnostic plan")
    execution = plan.get("execution")
    if (
        not isinstance(execution, dict)
        or plan.get("schema") != PLAN_SCHEMA
        or plan.get("mode") != "diagnostic"
        or execution != {"offline_only": True, "renderer": None, "not_promotable": True, "provenance_state": "unverified"}
    ):
        raise VideoPlanError("sample inventory requires an unpromotable diagnostic plan")
    indices = plan.get("frame_budget", {}).get("sample_indices") if isinstance(plan.get("frame_budget"), dict) else None
    frame = plan.get("first_frame", {}).get("frame") if isinstance(plan.get("first_frame"), dict) else None
    if not isinstance(indices, list) or len(indices) != 3 or not isinstance(frame, dict) or len(sample_paths) != 3:
        raise VideoPlanError("diagnostic plan has invalid sample-frame inputs")
    initial = _file(root, initial_frame, "initial frame", MAX_FRAME_BYTES)
    if initial["sha256"] != frame.get("sha256") or initial["bytes"] != frame.get("bytes"):
        raise VideoPlanError("initial frame differs from the plan's first-frame input")
    return {"schema": INVENTORY_SCHEMA, "creator": plan.get("creator"), "plan": _file(root, plan_path, "diagnostic plan", MAX_JSON_BYTES), "candidate_video": _file(root, candidate_video, "candidate video", MAX_VIDEO_BYTES), "initial_frame": initial, "source_relationship": "unverified-local-inventory; frames were supplied, not extracted or temporally verified", "not_promotable": True, "samples": [{"intended_index": index, "frame": _file(root, item, "sample frame", MAX_FRAME_BYTES)} for index, item in zip(indices, sample_paths, strict=True)]}


def _write_once(root: Path, relative: Path, value: dict[str, Any]) -> None:
    path = _within(root, relative, "output", allow_missing=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    _within(root, relative, "output", allow_missing=True)
    try:
        with path.open("x", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
    except FileExistsError as exc:
        raise VideoPlanError(f"refusing to overwrite existing evidence: {relative.as_posix()}") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__); commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan", help="write an unverified diagnostic plan")
    for name, kwargs in (
        ("--root", {"type": Path, "required": True}),
        ("--persona", {"type": Path, "required": True}),
        ("--first-frame-input", {"type": Path, "required": True}),
        ("--driving-video", {"type": Path, "required": True}),
        ("--action", {"required": True}),
        ("--mode", {"default": "diagnostic"}),
        ("--out", {"type": Path, "required": True}),
    ):
        plan.add_argument(name, **kwargs)
    samples = commands.add_parser("samples", help="write an unverified local frame inventory")
    for name in ("--root", "--plan", "--video", "--initial-frame", "--first", "--middle", "--last", "--out"): samples.add_argument(name, type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        root = _root(args.root)
        if args.command == "plan": _write_once(root, args.out, build_diagnostic_plan(root=root, persona_path=args.persona, first_frame_receipt=args.first_frame_input, driving_video=args.driving_video, action=args.action, mode=args.mode))
        else: _write_once(root, args.out, build_sample_inventory(root=root, plan_path=args.plan, candidate_video=args.video, initial_frame=args.initial_frame, sample_paths=[args.first, args.middle, args.last]))
    except VideoPlanError as exc: parser.error(str(exc))
    return 0


if __name__ == "__main__": raise SystemExit(main())
