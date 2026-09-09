"""Offline-only Qwen-Image-Edit-2511 reference-pair manifest compiler.

This module produces data for the existing RunPod harness.  It never calls that
harness, opens credentials, downloads weights, or starts a provider job.  The
default CLI writes canonical JSON only; ``--prepare`` makes one fresh, contained
local review payload holding the already-admitted g01 byte copy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import sys
from pathlib import Path
from typing import Any

_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
if str(_REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPOSITORY_ROOT))
from orgs.figment.pipeline.expand import local_omnigen2_inference as omni

SCHEMA = "figment/qwen-reference-cloud-preparation@1"
COMFY_COMMIT = "95d755cd8107a72258d452b5d3657273d571f07d"
COMFY_ROOT = "/workspace/ComfyUI"
PAYLOAD_NAME = "figment-qwen-reference-cloud-preparation-20260909-v1"
REFERENCE_RELATIVE_PATH = Path("orgs/figment/personas/creator-001/anchors/g01.jpg")
STAGED_REFERENCE_RELATIVE_PATH = Path("payload/g01.jpg")
REFERENCE_SHA256 = "e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed"
REFERENCE_BYTES = 737366
SEEDS = (481516234, 90210)
# FluxKontextImageScale chooses the nearest supported aspect-derived resolution.
# g01 (1408x768, ratio 1.833...) selects 1392x752 (ratio 1.851...) in the
# pinned implementation; this planner deliberately does not add an unreviewed crop.
EXPECTED_SCALED_WIDTH = 1392
EXPECTED_SCALED_HEIGHT = 752
READINESS_TIMEOUT_SECONDS = 2340
JOB_TIMEOUT_SECONDS = 480
MAX_MINUTES = 60
PROPOSED_MAX_USD = 1.30
RECORDED_ARC_USD = 38.248267

OFFICIAL_WORKFLOW = {
    "url": "https://github.com/Comfy-Org/workflow_templates/blob/a861fcde234d5cda3095087c509858fb001a6093/templates/image_qwen_image_edit_2511.json",
    "commit": "a861fcde234d5cda3095087c509858fb001a6093",
    "bytes": 59130,
    "sha256": "d561a38c15bd7d08758a5e6773d467142244d5b83fc5d3aecdf6d8df9fe881b6",
    "subgraph": "cdb2cf24-c432-439b-b5c8-5f69838580c9",
}
MODELS = [
    {"repo_id": "Comfy-Org/Qwen-Image-Edit_ComfyUI", "filename": "split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors", "revision": "4c7c4ea236326cbae56d403d22a03c6cd86ad9a0", "sha256": "c9fdc158e46d3b61ef75f21ae866ca2fe808bf4a53643120d1c1e87c19280a4e", "destination_dir": f"{COMFY_ROOT}/models/diffusion_models", "bytes": 20533762817},
    {"repo_id": "Comfy-Org/Qwen-Image_ComfyUI", "filename": "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors", "revision": "25608066f9bf5cdc28020836ce9549587053f346", "sha256": "cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4", "destination_dir": f"{COMFY_ROOT}/models/text_encoders", "bytes": 9384670680},
    {"repo_id": "Comfy-Org/Qwen-Image_ComfyUI", "filename": "split_files/vae/qwen_image_vae.safetensors", "revision": "dfe60a0d63f0b946628080f070978594983b8b6e", "sha256": "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f", "destination_dir": f"{COMFY_ROOT}/models/vae", "bytes": 253806246},
]

POSITIVE_PROMPT = omni.POSITIVE_PROMPT
NEGATIVE_PROMPT = omni.NEGATIVE_PROMPT


class PreparationError(ValueError):
    pass


def _node(class_type: str, **inputs: Any) -> dict[str, Any]:
    return {"class_type": class_type, "inputs": inputs}


def source_root() -> Path:
    return _REPOSITORY_ROOT


def admitted_reference_path() -> Path:
    return source_root() / REFERENCE_RELATIVE_PATH


def _is_reparse_or_symlink(path: Path) -> bool:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _safe_existing_root(root: Path) -> Path:
    absolute = Path(os.path.abspath(root))
    for component in (absolute, *absolute.parents):
        if component.exists() and _is_reparse_or_symlink(component):
            raise PreparationError(f"review payload destination contains a reparse/symlink path: {component}")
    if not absolute.is_dir():
        raise PreparationError(f"review payload root must be an existing directory: {absolute}")
    return absolute


def verify_reference(path: Path) -> int:
    if not path.is_file() or _is_reparse_or_symlink(path):
        raise PreparationError(f"admitted reference is missing or unsafe: {path}")
    if sha256_file(path) != REFERENCE_SHA256:
        raise PreparationError("admitted reference sha256 mismatch")
    if path.stat().st_size != REFERENCE_BYTES:
        raise PreparationError("admitted reference byte size mismatch")
    return REFERENCE_BYTES


def graph(seed: int) -> dict[str, dict[str, Any]]:
    if type(seed) is not int or seed not in SEEDS:
        raise PreparationError(f"seed must be one of {SEEDS}")
    # Compact API form of the official native (non-Lightning) branch.  This is a
    # one-reference path: optional official image2/image3 ports are omitted.
    return {
        "41": _node("LoadImage", image="qwen/g01.jpg"),
        "161": _node("UNETLoader", unet_name="qwen_image_edit_2511_fp8mixed.safetensors", weight_dtype="default"),
        "145": _node("ModelSamplingAuraFlow", model=["161", 0], shift=3.1),
        "152": _node("CFGNorm", model=["145", 0], strength=1.0, pre_cfg=False),
        "162": _node("CLIPLoader", clip_name="qwen_2.5_vl_7b_fp8_scaled.safetensors", type="qwen_image", device="default"),
        "146": _node("VAELoader", vae_name="qwen_image_vae.safetensors"),
        "160": _node("FluxKontextImageScale", image=["41", 0]),
        "149": _node("TextEncodeQwenImageEditPlus", clip=["162", 0], vae=["146", 0], image1=["160", 0], prompt=NEGATIVE_PROMPT),
        "151": _node("TextEncodeQwenImageEditPlus", clip=["162", 0], vae=["146", 0], image1=["160", 0], prompt=POSITIVE_PROMPT),
        "147": _node("FluxKontextMultiReferenceLatentMethod", conditioning=["149", 0], reference_latents_method="index_timestep_zero"),
        "148": _node("FluxKontextMultiReferenceLatentMethod", conditioning=["151", 0], reference_latents_method="index_timestep_zero"),
        "156": _node("VAEEncode", pixels=["160", 0], vae=["146", 0]),
        "169": _node("KSampler", model=["152", 0], positive=["148", 0], negative=["147", 0], latent_image=["156", 0], seed=seed, steps=40, cfg=4.0, sampler_name="euler", scheduler="simple", denoise=1.0),
        "158": _node("VAEDecode", samples=["169", 0], vae=["146", 0]),
        "9": _node("SaveImage", images=["158", 0], filename_prefix="figment-qwen-reference"),
    }


# This is deliberately an audit specification, not evidence that the pinned
# native Comfy commit supports the compact API graph.
REQUIRED_API_SCHEMA = [
    ("41", "LoadImage", "image"),
    ("161", "UNETLoader", "unet_name"), ("145", "ModelSamplingAuraFlow", "shift"),
    ("152", "CFGNorm", "strength"), ("162", "CLIPLoader", "type"),
    ("146", "VAELoader", "vae_name"), ("160", "FluxKontextImageScale", "image"),
    ("149", "TextEncodeQwenImageEditPlus", "image1"),
    ("151", "TextEncodeQwenImageEditPlus", "image1"),
    ("147", "FluxKontextMultiReferenceLatentMethod", "reference_latents_method"), ("148", "FluxKontextMultiReferenceLatentMethod", "reference_latents_method"),
    ("156", "VAEEncode", "pixels"), ("169", "KSampler", "latent_image"),
    ("158", "VAEDecode", "samples"), ("9", "SaveImage", "images"),
]


def minimum_runtime_minutes(manifest: dict[str, Any]) -> float:
    return (float(manifest["readiness_timeout_seconds"]) + float(manifest["job_timeout_seconds"]) * len(manifest["jobs"])) / 60 + 5


def build_manifest() -> dict[str, Any]:
    workflow = graph(SEEDS[0])
    manifest: dict[str, Any] = {
        "schema": SCHEMA,
        "status": {"research_only": True, "promotable": False, "commercial_use_cleared": False, "production_approval": False, "session_authorization": {"authorized": True, "scope": "exact g01 transfer to owned RunPod; one placement; two images; maximum $1.30 and 60 minutes inside the $50 arc"}, "requires_root_review_before_cloud_launch": True},
        "provenance": {"official_workflow": OFFICIAL_WORKFLOW, "prompt_source": "orgs/figment/pipeline/expand/local_omnigen2_inference.py", "prompt_source_feasibility_sha256": omni.FEASIBILITY_SHA256, "reference_source": REFERENCE_RELATIVE_PATH.as_posix(), "reference_sha256": REFERENCE_SHA256, "reference_bytes": REFERENCE_BYTES, "reference_destination": STAGED_REFERENCE_RELATIVE_PATH.as_posix(), "reference_upload_destination": "input/qwen/g01.jpg", "scaled_reference_expected_dimensions": [EXPECTED_SCALED_WIDTH, EXPECTED_SCALED_HEIGHT], "graph_adaptation": "Composite official-conditioning hypothesis; no result can isolate any one of dual conditioning, index_timestep_zero, or VAE initial latent."},
        "gpu": {"type": "NVIDIA L40S", "count": 1, "cloud": "SECURE", "requested_vram_gb": 48},
        "image": "runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04",
        "price_usd_per_hour": 1.30,
        "rate_provenance": {"historical_rate_only": True, "current_pricing_and_availability_unverified": True},
        "max_placement_attempts": 1, "container_disk_gb": 80, "volume_gb": 0, "volume_mount_path": "/workspace",
        "readiness_timeout_seconds": READINESS_TIMEOUT_SECONDS, "job_timeout_seconds": JOB_TIMEOUT_SECONDS, "max_minutes": MAX_MINUTES, "proposed_max_usd": PROPOSED_MAX_USD, "recorded_arc_usd": RECORDED_ARC_USD,
        "comfyui": {"root": COMFY_ROOT, "git_ref": COMFY_COMMIT, "port": 8188, "start_command": "python main.py", "tarball_url": f"https://codeload.github.com/Comfy-Org/ComfyUI/tar.gz/{COMFY_COMMIT}"},
        "models": MODELS,
        "model_licence": {"component_metadata": "Apache-2.0", "production_clearance": "not established; research-only"},
        "uploads": [{"files": [STAGED_REFERENCE_RELATIVE_PATH.as_posix()], "subfolder": "qwen", "type": "input", "overwrite": True}],
        "seed_fields": ["seed", "noise_seed"], "workflow": workflow,
        "jobs": [{"seed": seed, "output_name": f"qwen-g01-seed-{seed}", "expected_images": 1, "substitutions": [{"node_id": "169", "field": "seed", "value": seed}]} for seed in SEEDS],
        "static_api_schema_audit": {"required_contract_count": len(REQUIRED_API_SCHEMA), "contracts": [{"node_id": n, "class_type": c, "input": i} for n, c, i in REQUIRED_API_SCHEMA], "result": "independently reviewed against pinned native Comfy source; no remote /object_info request made"},
        "cloud_differences": ["Prior M1 used three references, 26 steps, and an EmptyLatentImage; this candidate uses the official dual-conditioning and aspect-derived scaled-g01 VAE latent assembly at 40 steps.", "The combined adaptation is a research hypothesis, not a strict single-variable causal ablation or quality claim.", "48 GB VRAM is requested to avoid the local system-RAM constraint; RAM and VRAM are distinct."],
        "missing_harness_acceptance_checks": ["The harness has no remote post-upload SHA-256 attestation for g01.", "The harness does not attest the remote graph after submission."],
    }
    if minimum_runtime_minutes(manifest) != MAX_MINUTES:
        raise AssertionError("60-minute bound must include readiness, two jobs, and teardown")
    return manifest


def prepare_payload(destination_root: Path, *, reference_path: Path | None = None) -> dict[str, Any]:
    root = _safe_existing_root(destination_root)
    payload = root / PAYLOAD_NAME
    if payload.exists() or _is_reparse_or_symlink(payload):
        raise PreparationError(f"review payload must be fresh and absent: {payload}")
    source = reference_path or admitted_reference_path()
    size = verify_reference(source)
    payload.mkdir(mode=0o700, exist_ok=False)
    if _is_reparse_or_symlink(payload):
        raise PreparationError(f"new review payload became a reparse/symlink path: {payload}")
    staged = payload / STAGED_REFERENCE_RELATIVE_PATH
    staged.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, staged)
    if sha256_file(staged) != REFERENCE_SHA256 or staged.stat().st_size != size:
        raise PreparationError("staged reference copy did not preserve exact bytes")
    manifest_path = payload / "manifest.json"
    manifest_path.write_text(omni.canonical_json(build_manifest()) + "\n", encoding="utf-8")
    return {"payload": str(payload), "manifest": str(manifest_path), "reference": str(staged), "sha256": REFERENCE_SHA256, "bytes": size}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--root", type=Path)
    args = parser.parse_args(argv)
    if not args.prepare:
        if args.root is not None:
            parser.error("--root requires --prepare")
        print(omni.canonical_json(build_manifest()))
        return 0
    print(omni.canonical_json(prepare_payload(args.root or source_root() / "_private")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
