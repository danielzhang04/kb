"""Prepare an offline-only, reviewable RunPod manifest for the frozen OmniGen2 probe.

This is intentionally a planner/stager, not a provider client.  It emits a manifest
for ``pod/runpod_run.py`` but never invokes that harness, opens credentials, or makes
network requests.  With no arguments it writes canonical JSON to stdout only.
``--prepare`` copies the one admitted reference into a fresh local review payload.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

# Running this file by path makes Python put ``pod/`` rather than the repository
# root on sys.path.  Add only the resolved repository root so both direct CLI use
# and test imports select the same frozen planner.
_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
if str(_REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPOSITORY_ROOT))
from orgs.figment.pipeline.expand import local_omnigen2_inference as frozen


SCHEMA = "figment/omnigen2-cloud-preparation@1"
COMFY_ROOT = "/workspace/ComfyUI"
PAYLOAD_NAME = "figment-omnigen2-cloud-preparation-20260909-v3"
REFERENCE_RELATIVE_PATH = Path("orgs/figment/personas/creator-001/anchors/g01.jpg")
STAGED_REFERENCE_RELATIVE_PATH = Path("payload/g01.jpg")
# This image and the L40S class occur in the successful tensor-pod record.  The
# rate is only the historical conservative estimate from tensor-pins.yaml; it is
# explicitly not a current RunPod quote or availability assertion.
KNOWN_IMAGE = "runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04"
HISTORICAL_RATE_USD_PER_HOUR = 1.30
READINESS_TIMEOUT_SECONDS = 2700
JOB_TIMEOUT_SECONDS = 300
MAX_MINUTES = 60
PROPOSED_MAX_USD = 1.30
REMAINING_RECORDED_USD = 12.199615


class PreparationError(ValueError):
    """Raised when local review payload preparation cannot prove its inputs."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source_root() -> Path:
    return _REPOSITORY_ROOT


def admitted_reference_path() -> Path:
    return source_root() / REFERENCE_RELATIVE_PATH


def _is_reparse_or_symlink(path: Path) -> bool:
    """Return true without following a Windows junction/symlink target."""
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    attributes = getattr(info, "st_file_attributes", 0)
    return stat.S_ISLNK(info.st_mode) or bool(reparse and attributes & reparse)


def _require_safe_destination_root(root: Path) -> None:
    """Require a real, existing directory with no link/junction ancestor."""
    absolute = Path(os.path.abspath(root))
    for component in (absolute, *absolute.parents):
        if component.exists() and _is_reparse_or_symlink(component):
            raise PreparationError(f"review payload destination contains a reparse/symlink path: {component}")
    if not absolute.is_dir():
        raise PreparationError(f"review payload root must be an existing directory: {absolute}")


def verify_reference(path: Path) -> int:
    if not path.is_file():
        raise PreparationError(f"admitted reference is missing: {path}")
    actual = sha256_file(path)
    if actual != frozen.REFERENCE["sha256"]:
        raise PreparationError(
            "admitted reference sha256 mismatch: "
            f"expected {frozen.REFERENCE['sha256']}, got {actual}"
        )
    return path.stat().st_size


def minimum_runtime_minutes(manifest: dict[str, Any]) -> float:
    """Mirror the existing compatibility-job harness budget formula exactly."""
    return (
        float(manifest["readiness_timeout_seconds"]) / 60.0
        + float(manifest["job_timeout_seconds"]) * len(manifest["jobs"]) / 60.0
        + 5.0
    )


def build_manifest() -> dict[str, Any]:
    """Return a pure-data manifest with the frozen planner's model and graph pins."""
    planner_manifest = frozen.build_manifest()
    workflow = deepcopy(planner_manifest["runs"][0]["graph"])
    # The pinned Comfy schema requires this input even though its UI default is 1.
    # Keep the historical local planner immutable and record this adapter explicitly.
    workflow[frozen.N_SCALE]["inputs"]["resolution_steps"] = 1
    models = []
    destinations = {
        "diffusion": f"{COMFY_ROOT}/models/diffusion_models",
        "clip": f"{COMFY_ROOT}/models/text_encoders",
        "vae": f"{COMFY_ROOT}/models/vae",
    }
    for kind in ("diffusion", "clip", "vae"):
        model = planner_manifest["models"][kind]
        models.append({
            "repo_id": model["repo"], "filename": model["path"],
            "revision": model["revision"], "sha256": model["sha256"],
            "destination_dir": destinations[kind],
        })
    manifest: dict[str, Any] = {
        "schema": SCHEMA,
        "status": {
            "research_only": True, "promotable": False,
            "commercial_use_cleared": False, "export_authorized": False,
            "requires_root_review_before_cloud_launch": True,
        },
        "provenance": {
            "frozen_planner": "orgs/figment/pipeline/expand/local_omnigen2_inference.py",
            "frozen_planner_manifest_sha256": planner_manifest["manifest_sha256"],
            "comfyui_git_ref": frozen.COMFY_COMMIT,
            "reference_source": REFERENCE_RELATIVE_PATH.as_posix(),
            "reference_sha256": frozen.REFERENCE["sha256"],
            "reference_destination": STAGED_REFERENCE_RELATIVE_PATH.as_posix(),
            "reference_upload_destination": "input/omnigen2/g01.jpg",
            "model_payload_bytes": frozen.MODEL_PAYLOAD_BYTES,
            "model_payload_human": "15.78 GB (decimal)",
            "source_graph_sha256": planner_manifest["runs"][0]["graph_sha256"],
            "adapter_graph_sha256": frozen.sha256_of(workflow),
            "graph_adaptations": [{"node_id": frozen.N_SCALE, "input": "resolution_steps", "value": 1,
                                   "reason": "required by the pinned Comfy ImageScaleToTotalPixels schema"}],
        },
        "gpu": {"type": "NVIDIA L40S", "count": 1, "cloud": "SECURE", "requested_vram_gb": 48},
        "image": KNOWN_IMAGE,
        "price_usd_per_hour": HISTORICAL_RATE_USD_PER_HOUR,
        "rate_provenance": {
            "source": "orgs/figment/pipeline/train/tensor-pins.yaml",
            "historical_rate_only": True,
            "current_pricing_and_availability_unverified": True,
        },
        "max_placement_attempts": 1,
        "container_disk_gb": 80,
        "volume_gb": 0,
        "volume_mount_path": "/workspace",
        "readiness_timeout_seconds": READINESS_TIMEOUT_SECONDS,
        "job_timeout_seconds": JOB_TIMEOUT_SECONDS,
        "max_minutes": MAX_MINUTES,
        "proposed_max_usd": PROPOSED_MAX_USD,
        "remaining_recorded_usd": REMAINING_RECORDED_USD,
        "comfyui": {"root": COMFY_ROOT, "git_ref": frozen.COMFY_COMMIT, "port": 8188,
                    "start_command": "python main.py",
                    "tarball_url": f"https://codeload.github.com/Comfy-Org/ComfyUI/tar.gz/{frozen.COMFY_COMMIT}"},
        "models": models,
        "uploads": [{"files": [STAGED_REFERENCE_RELATIVE_PATH.as_posix()], "subfolder": "omnigen2", "type": "input", "overwrite": True}],
        "seed_fields": ["seed", "noise_seed"],
        "workflow": workflow,
        "jobs": [
            {"seed": seed, "output_name": f"omnigen2-g01-seed-{seed}", "expected_images": 1,
             "substitutions": [{"node_id": frozen.N_LOAD, "field": "image", "value": "omnigen2/g01.jpg"}]}
            for seed in frozen.SEEDS
        ],
        "cloud_differences": [
            "Windows local runner becomes Linux RunPod container.",
            "Container package environment and remote GPU hardware are pinned targets, not a byte-identical execution guarantee.",
            "48 GB VRAM is requested to avoid the local system-RAM constraint; RAM and VRAM are distinct and no universal 12 GiB local-RAM minimum is claimed.",
        ],
        "missing_harness_acceptance_checks": [
            "The existing harness hash-verifies public model downloads but has no remote post-upload SHA-256 attestation for g01.",
            "The existing harness has no remote ComfyUI graph-hash attestation after queue submission.",
        ],
    }
    if minimum_runtime_minutes(manifest) != MAX_MINUTES:
        raise AssertionError("cloud manifest budget must equal the existing harness minimum")
    return manifest


def prepare_payload(destination_root: Path, *, reference_path: Path | None = None) -> dict[str, Any]:
    """Create the isolated local review payload; all created paths stay below root."""
    root = Path(os.path.abspath(destination_root))
    _require_safe_destination_root(root)
    source = (reference_path or admitted_reference_path()).resolve()
    size = verify_reference(source)
    payload = root / PAYLOAD_NAME
    # Freshness is a containment property: never reuse, overwrite, or enter an
    # existing directory, including a junction substituted at the expected name.
    if payload.exists() or _is_reparse_or_symlink(payload):
        raise PreparationError(f"review payload must be fresh and absent: {payload}")
    payload.mkdir(mode=0o700, exist_ok=False)
    if _is_reparse_or_symlink(payload):
        raise PreparationError(f"new review payload became a reparse/symlink path: {payload}")
    staged = payload / STAGED_REFERENCE_RELATIVE_PATH
    if not staged.is_relative_to(payload):
        raise PreparationError("staged reference escapes review payload")
    staged.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, staged)
    if sha256_file(staged) != frozen.REFERENCE["sha256"] or staged.stat().st_size != size:
        raise PreparationError("staged reference copy did not preserve exact bytes")
    manifest = build_manifest()
    manifest["prepared_payload"] = {
        "root": payload.name,
        "staged_reference_bytes": size,
        "staged_reference_sha256": frozen.REFERENCE["sha256"],
        "nonpromotable": True,
        "offline_preparation_only": True,
    }
    manifest_path = payload / "manifest.json"
    manifest_path.write_text(canonical_json(manifest) + "\n", encoding="utf-8")
    return {"payload": str(payload), "manifest": str(manifest_path), "reference": str(staged), "sha256": frozen.REFERENCE["sha256"], "bytes": size}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true", help="write the fixed local review payload")
    parser.add_argument("--root", type=Path, help="parent directory for --prepare; defaults to repository _private")
    args = parser.parse_args(argv)
    if not args.prepare:
        if args.root is not None:
            parser.error("--root requires --prepare")
        print(canonical_json(build_manifest()))
        return 0
    root = args.root or source_root() / "_private"
    print(canonical_json(prepare_payload(root)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
