#!/usr/bin/env python3
"""Compile one bounded, non-promotable Wan 2.2 TI2V-5B image job manifest.

The compiler never starts a pod, downloads a model, invokes ComfyUI, or assembles
video. It writes one fresh JSON manifest for the existing image-output harness.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import stat
from pathlib import Path
from typing import Any

FRAME_SCHEMA = "figment/video-first-frame-input@1"
MANIFEST_SCHEMA = "figment/video-i2v-manifest@1"
MAX_JSON_BYTES = 256 * 1024
MAX_FRAME_BYTES = 32 * 1024 * 1024
MAX_JSON_DEPTH = 32
MAX_CLOTHING_CHARS = 200
MAX_SEED = 0xffffffffffffffff
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")
CHILD_TERMS = re.compile(r"\b(child|minor|underage|teen(?:age)?|schoolgirl)\b", re.I)
UNSAFE_TERMS = re.compile(r"\b(nude|naked|topless|lingerie|sexual|explicit)\b", re.I)
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
COMFY_COMMIT = "12d5279438bfefc058a269eae805ceab6047777f"
COMFY_SOURCE = "https://github.com/Comfy-Org/ComfyUI"
WORKFLOW_FILE = "wan22_ti2v_5b_native_api.json"
PINS_FILE = "wan22_ti2v_5b.model-pins.json"
WORKFLOW_SHA256 = "d1020d3af19df2b8875c024b792451699b103140211da2b6359306658feac2f2"
PINS_SHA256 = "fa7d6e5c900d963031c04ca4dfeab2ee1c955d960dcea9abd5f5224ab17a6f68"
REQUIRED_NODES = {
    "37": "UNETLoader", "38": "CLIPLoader", "39": "VAELoader",
    "6": "CLIPTextEncode", "7": "CLIPTextEncode", "55": "Wan22ImageToVideoLatent",
    "56": "LoadImage", "48": "ModelSamplingSD3", "3": "KSampler",
    "8": "VAEDecode", "9": "SaveImage",
}


class VideoManifestError(ValueError):
    """Raised when a bounded diagnostic manifest cannot be compiled safely."""


def _reparse_point(path: Path) -> bool:
    """Reject symlinks and Windows junction/reparse points before containment checks."""
    try:
        attributes = getattr(os.lstat(path), "st_file_attributes", 0)
    except OSError:
        return False
    is_junction = getattr(os.path, "isjunction", lambda _: False)
    return path.is_symlink() or is_junction(path) or bool(attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def _root(path: Path) -> Path:
    try:
        lexical = path.absolute()
        if not lexical.is_dir() or any(_reparse_point(part) for part in (lexical, *lexical.parents)):
            raise VideoManifestError("root must be a real directory, never a symlink or reparse point")
        return lexical.resolve(strict=True)
    except OSError as exc:
        raise VideoManifestError("root directory is unavailable") from exc


def _within(root: Path, relative: Path, label: str, *, allow_missing: bool = False) -> Path:
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise VideoManifestError(f"{label} must be a relative path below --root")
    path = root
    for index, part in enumerate(relative.parts):
        path /= part
        if path.exists() or _reparse_point(path):
            if _reparse_point(path):
                raise VideoManifestError(f"{label} may not traverse a symlink or reparse point")
        elif not allow_missing or index != len(relative.parts) - 1:
            raise VideoManifestError(f"{label} is missing: {relative.as_posix()}")
    return path


def _depth_ok(source: str) -> bool:
    depth = 0
    quoted = escaped = False
    for character in source:
        if quoted:
            if escaped: escaped = False
            elif character == "\\": escaped = True
            elif character == '"': quoted = False
        elif character == '"': quoted = True
        elif character in "{[":
            depth += 1
            if depth > MAX_JSON_DEPTH: return False
        elif character in "}]": depth -= 1
    return not quoted and depth == 0


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        if not path.is_file() or path.stat().st_size > MAX_JSON_BYTES:
            raise VideoManifestError(f"{label} must be a regular JSON file no larger than {MAX_JSON_BYTES} bytes")
        source = path.read_text(encoding="utf-8")
        value = json.loads(source)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise VideoManifestError(f"cannot read {label} JSON") from exc
    if not _depth_ok(source) or not isinstance(value, dict):
        raise VideoManifestError(f"{label} JSON must be a shallow object")
    return value


def _hash_file(root: Path, relative: Path, label: str, maximum: int) -> dict[str, Any]:
    path = _within(root, relative, label)
    if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise VideoManifestError(f"{label} must be a supported regular image file")
    expected = path.stat().st_size
    if expected <= 0 or expected > maximum:
        raise VideoManifestError(f"{label} exceeds its {maximum}-byte diagnostic limit")
    digest = hashlib.sha256(); seen = 0
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                seen += len(chunk)
                if seen > maximum: raise VideoManifestError(f"{label} exceeds its {maximum}-byte diagnostic limit")
                digest.update(chunk)
    except OSError as exc:
        raise VideoManifestError(f"cannot read {label}") from exc
    if seen != expected: raise VideoManifestError(f"{label} changed while it was being read")
    return {"path": relative.as_posix(), "bytes": seen, "sha256": digest.hexdigest()}


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip(): raise VideoManifestError(f"{label} must be a non-empty string")
    return value.strip()


def _approval_claim(value: Any) -> bool:
    if isinstance(value, dict):
        return any(any(term in str(key).casefold() for term in ("approv", "accept", "decision")) or _approval_claim(item) for key, item in value.items())
    return isinstance(value, list) and any(_approval_claim(item) for item in value)


def _load_first_frame(root: Path, receipt_relative: Path, creator: str) -> dict[str, Any]:
    receipt_path = _within(root, receipt_relative, "first-frame receipt")
    receipt = _read_json(receipt_path, "first-frame receipt")
    if receipt.get("schema") != FRAME_SCHEMA or receipt.get("creator") != creator or _approval_claim(receipt):
        raise VideoManifestError("first-frame receipt must be a matching, approval-free diagnostic input")
    recorded = receipt.get("first_frame")
    if not isinstance(recorded, dict) or not isinstance(recorded.get("path"), str):
        raise VideoManifestError("first-frame receipt lacks first_frame provenance")
    if not isinstance(recorded.get("bytes"), int) or not SHA256.fullmatch(str(recorded.get("sha256", ""))):
        raise VideoManifestError("first-frame receipt has invalid byte/hash provenance")
    actual = _hash_file(root, Path(recorded["path"]), "first frame", MAX_FRAME_BYTES)
    if actual["bytes"] != recorded["bytes"] or actual["sha256"] != recorded["sha256"]:
        raise VideoManifestError("first-frame bytes no longer match the diagnostic input")
    return {"receipt": {"path": receipt_relative.as_posix(), "sha256": hashlib.sha256(receipt_path.read_bytes()).hexdigest()}, "frame": actual}


def _motion(persona: dict[str, Any], action: str) -> tuple[str, str]:
    look = persona.get("identity", {}).get("look") if isinstance(persona.get("identity"), dict) else None
    if not isinstance(look, dict): raise VideoManifestError("persona has no identity.look")
    age, clothing = _text(look.get("age_stage"), "identity.look.age_stage"), _text(look.get("clothing"), "identity.look.clothing")
    action = _text(action, "action")
    if not re.search(r"\badult\b", age, re.I) or CHILD_TERMS.search(age):
        raise VideoManifestError("persona age_stage must use adult wording and no child/minor vocabulary")
    if len(action) > 140 or "\n" in action or UNSAFE_TERMS.search(action):
        raise VideoManifestError("action must be a short clothed motion instruction")
    if len(clothing) > MAX_CLOTHING_CHARS or "\n" in clothing or UNSAFE_TERMS.search(clothing):
        raise VideoManifestError("identity.look.clothing must be a short single-line non-explicit description")
    return age, f"{age}; {clothing}; {action}"


def _static_file(name: str, label: str) -> dict[str, Any]:
    path = Path(__file__).with_name(name)
    expected = WORKFLOW_SHA256 if name == WORKFLOW_FILE else PINS_SHA256
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise VideoManifestError(f"{label} hash does not match its reviewed pin")
    return _read_json(path, label)


def _validate_pins(value: dict[str, Any]) -> list[dict[str, Any]]:
    models = value.get("models")
    comfy = value.get("native_comfyui")
    if (value.get("schema") != "figment/video-model-pins@1" or value.get("license", {}).get("spdx") != "Apache-2.0" or not isinstance(models, list) or len(models) != 3
            or not isinstance(comfy, dict) or comfy.get("revision") != COMFY_COMMIT or comfy.get("release_tag") != "v0.34.0"
            or comfy.get("license_spdx") != "GPL-3.0-only"):
        raise VideoManifestError("pinned video model inventory is malformed")
    roles = {"diffusion_model", "vae", "text_encoder"}
    if {item.get("role") for item in models if isinstance(item, dict)} != roles:
        raise VideoManifestError("pinned video model inventory has wrong roles")
    for item in models:
        if not isinstance(item, dict) or not item.get("filename", "").endswith(".safetensors") or not SHA256.fullmatch(str(item.get("sha256", ""))) or not re.fullmatch(r"[0-9a-f]{40}", str(item.get("revision", ""))):
            raise VideoManifestError("pinned video model inventory contains an unsafe or unpinned asset")
    return copy.deepcopy(models)


def _validate_workflow(workflow: dict[str, Any]) -> dict[str, Any]:
    if set(workflow) != set(REQUIRED_NODES) or any(not isinstance(workflow[key], dict) or workflow[key].get("class_type") != kind for key, kind in REQUIRED_NODES.items()):
        raise VideoManifestError("pinned workflow node inventory does not match native ComfyUI")
    inputs = {key: workflow[key].get("inputs") for key in workflow}
    expected = {
        "55": {"vae": ["39", 0], "width": 512, "height": 288, "length": 81, "batch_size": 1, "start_image": ["56", 0]},
        "48": {"model": ["37", 0], "shift": 8.0},
        "3": {"model": ["48", 0], "steps": 20, "cfg": 5.0, "sampler_name": "uni_pc", "scheduler": "simple", "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["55", 0], "denoise": 1.0},
        "8": {"samples": ["3", 0], "vae": ["39", 0]}, "9": {"images": ["8", 0]},
    }
    if any(not isinstance(inputs[key], dict) or any(inputs[key].get(field) != item for field, item in values.items()) for key, values in expected.items()):
        raise VideoManifestError("pinned workflow graph edges or bounded shapes are invalid")
    if inputs["38"].get("type") != "wan" or inputs["37"].get("weight_dtype") != "default":
        raise VideoManifestError("pinned workflow loaders are not the audited native configuration")
    return copy.deepcopy(workflow)


def build_manifest(*, root: Path, persona_path: Path, first_frame_receipt: Path, action: str, out: Path, seed: int = 4815162342) -> dict[str, Any]:
    root = _root(root)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= MAX_SEED:
        raise VideoManifestError(f"seed must be an integer between 0 and {MAX_SEED}")
    persona = _read_json(_within(root, persona_path, "persona"), "persona")
    creator = _text(persona.get("id"), "persona.id")
    if not SAFE_NAME.fullmatch(creator): raise VideoManifestError("persona.id must be safe for a harness destination")
    age, prompt = _motion(persona, action)
    first_frame = _load_first_frame(root, first_frame_receipt, creator)
    out_path = _within(root, out, "output", allow_missing=True)
    if out_path.exists(): raise VideoManifestError(f"refusing to overwrite existing manifest: {out.as_posix()}")
    frame_path = Path(first_frame["frame"]["path"])
    if out_path.parent != (root / frame_path).parent:
        raise VideoManifestError("output manifest must be written beside the first frame so the existing harness can upload it safely")
    workflow = _validate_workflow(_static_file(WORKFLOW_FILE, "pinned native workflow"))
    pins = _validate_pins(_static_file(PINS_FILE, "pinned video model inventory"))
    remote_subfolder = f"figment-video-{creator}"
    remote_image = f"{remote_subfolder}/{frame_path.name}"
    prompt_digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]
    output_name = f"video-{creator}-f{first_frame['frame']['sha256'][:12]}-s{seed}-p{prompt_digest}-w{WORKFLOW_SHA256[:12]}"
    workflow["6"]["inputs"]["text"] = prompt
    workflow["56"]["inputs"]["image"] = remote_image
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "mode": "diagnostic", "not_promotable": True,
        "provenance": {"first_frame": first_frame, "workflow": {"path": WORKFLOW_FILE, "sha256": hashlib.sha256(Path(__file__).with_name(WORKFLOW_FILE).read_bytes()).hexdigest(), "source": "https://github.com/Comfy-Org/workflow_templates/blob/8f712b99e950a22cd60a04a73683c4fd370a6996/templates/video_wan2_2_5B_ti2v.json"}, "model_pins": {"path": PINS_FILE, "sha256": hashlib.sha256(Path(__file__).with_name(PINS_FILE).read_bytes()).hexdigest()}},
        "motion": {"age_stage": age, "action": action, "prompt": prompt},
        "frame_budget": {"width": 512, "height": 288, "frames": 81, "fps": 16, "batch_size": 1},
        "gpu": {"type": "NVIDIA L40S", "count": 1, "cloud": "SECURE"}, "price_usd_per_hour": 1.3, "max_minutes": 80, "readiness_timeout_seconds": 2400, "job_timeout_seconds": 1800, "container_disk_gb": 80, "volume_gb": 120, "volume_mount_path": "/workspace", "image": "runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04",
        "comfyui": {"root": "/workspace/ComfyUI", "git_ref": COMFY_COMMIT, "source_url": COMFY_SOURCE, "tarball_url": f"https://codeload.github.com/Comfy-Org/ComfyUI/tar.gz/{COMFY_COMMIT}", "replace_non_git_root": False, "port": 8188, "start_command": "python main.py"},
        "models": pins, "seed_fields": ["seed"], "workflow": workflow,
        "uploads": [{"files": [frame_path.as_posix()], "subfolder": remote_subfolder, "type": "input", "overwrite": False}],
        "jobs": [{"seed": seed, "output_name": output_name, "expected_images": 81}],
    }
    return manifest


def write_manifest(*, root: Path, out: Path, **kwargs: Any) -> dict[str, Any]:
    root = _root(root); value = build_manifest(root=root, out=out, **kwargs)
    path = _within(root, out, "output", allow_missing=True)
    try:
        with path.open("x", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
    except FileExistsError as exc:
        raise VideoManifestError(f"refusing to overwrite existing manifest: {out.as_posix()}") from exc
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path); parser.add_argument("--persona", required=True, type=Path)
    parser.add_argument("--first-frame-input", required=True, type=Path); parser.add_argument("--action", required=True)
    parser.add_argument("--out", required=True, type=Path); parser.add_argument("--seed", type=int, default=4815162342)
    args = parser.parse_args(argv)
    try:
        write_manifest(root=args.root, persona_path=args.persona, first_frame_receipt=args.first_frame_input, action=args.action, out=args.out, seed=args.seed)
    except VideoManifestError as exc: parser.error(str(exc))
    return 0


if __name__ == "__main__": raise SystemExit(main())
