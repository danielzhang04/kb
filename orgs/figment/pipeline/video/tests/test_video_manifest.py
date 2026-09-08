from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


VIDEO_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = VIDEO_DIR / "video_manifest.py"
SPEC = importlib.util.spec_from_file_location("figment_video_manifest", MODULE_PATH)
assert SPEC and SPEC.loader
video = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = video
SPEC.loader.exec_module(video)
HARNESS = VIDEO_DIR.parent / "pod" / "runpod_run.py"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def fixture(root: Path) -> dict[str, Path]:
    root.mkdir(parents=True, exist_ok=True)
    persona = root / "persona.json"
    write_json(persona, {"id": "creator-test", "identity": {"look": {"age_stage": "an adult woman in her mid-twenties", "clothing": "a fully opaque black crew-neck shirt and jeans"}}})
    frame = root / "g01.png"; frame.write_bytes(b"synthetic adult clothed diagnostic frame")
    receipt = root / "first-frame-input.json"
    write_json(receipt, {"schema": video.FRAME_SCHEMA, "creator": "creator-test", "first_frame": {"path": frame.name, "bytes": frame.stat().st_size, "sha256": digest(frame)}})
    return {"persona": persona, "frame": frame, "receipt": receipt}


def compile_manifest(root: Path, files: dict[str, Path], out: str = "video-manifest.json") -> dict[str, object]:
    return video.write_manifest(root=root, persona_path=Path(files["persona"].name), first_frame_receipt=Path(files["receipt"].name), action="walk slowly toward the camera in a fully clothed street-style shot", out=Path(out), seed=77)


def test_compiles_hash_bound_native_81_frame_manifest(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    manifest = compile_manifest(tmp_path, files)

    assert manifest["schema"] == video.MANIFEST_SCHEMA
    assert manifest["not_promotable"] is True
    assert manifest["frame_budget"] == {"width": 512, "height": 288, "frames": 81, "fps": 16, "batch_size": 1}
    assert manifest["provenance"]["first_frame"]["frame"]["sha256"] == digest(files["frame"])
    assert manifest["provenance"]["workflow"]["sha256"] == video.WORKFLOW_SHA256
    assert manifest["provenance"]["model_pins"]["sha256"] == video.PINS_SHA256
    assert {model["role"] for model in manifest["models"]} == {"diffusion_model", "vae", "text_encoder"}
    assert all(model["filename"].endswith(".safetensors") for model in manifest["models"])
    output = manifest["jobs"][0]
    assert output["seed"] == 77 and output["expected_images"] == 81
    assert output["output_name"].startswith(f"video-creator-test-f{digest(files['frame'])[:12]}-s77-p")
    assert output["output_name"].endswith(f"-w{video.WORKFLOW_SHA256[:12]}")
    graph = manifest["workflow"]
    assert graph["55"]["class_type"] == "Wan22ImageToVideoLatent"
    assert graph["55"]["inputs"]["start_image"] == ["56", 0]
    assert graph["9"] == {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "figment-video"}}


def test_dry_run_uses_existing_image_contract_for_exactly_81_outputs(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    compile_manifest(tmp_path, files)
    result = subprocess.run([sys.executable, str(HARNESS), "run", "--manifest", str(tmp_path / "video-manifest.json"), "--out", str(tmp_path / "dry-run"), "--dry-run"], cwd=VIDEO_DIR.parent, capture_output=True, text=True, timeout=30)

    assert result.returncode == 0, result.stderr
    paths = sorted((tmp_path / "dry-run").glob("video-creator-test-*.png"))
    assert len(paths) == 81


def test_refuses_stale_claimed_approval_and_unsafe_paths(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    files["frame"].write_bytes(b"changed")
    with pytest.raises(video.VideoManifestError, match="no longer match"):
        compile_manifest(tmp_path, files)

    files = fixture(tmp_path / "approval")
    receipt = json.loads(files["receipt"].read_text(encoding="utf-8")); receipt["operator_approved"] = "forged"
    write_json(files["receipt"], receipt)
    with pytest.raises(video.VideoManifestError, match="approval-free"):
        compile_manifest(tmp_path / "approval", files)
    with pytest.raises(video.VideoManifestError, match="relative path"):
        video.build_manifest(root=tmp_path / "approval", persona_path=Path("../persona.json"), first_frame_receipt=Path(files["receipt"].name), action="walk slowly", out=Path("video-manifest.json"))


def test_refuses_overwrite_nonlocal_upload_and_unreviewed_static_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    files = fixture(tmp_path)
    compile_manifest(tmp_path, files)
    with pytest.raises(video.VideoManifestError, match="overwrite"):
        compile_manifest(tmp_path, files)
    (tmp_path / "nested").mkdir()
    with pytest.raises(video.VideoManifestError, match="beside the first frame"):
        compile_manifest(tmp_path, files, "nested/video-manifest.json")
    monkeypatch.setattr(video, "WORKFLOW_SHA256", "0" * 64)
    with pytest.raises(video.VideoManifestError, match="hash"):
        compile_manifest(tmp_path / "fresh", fixture(tmp_path / "fresh"))


def test_refuses_minor_or_explicit_actions_and_symlinked_frame(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    with pytest.raises(video.VideoManifestError, match="clothed motion"):
        video.build_manifest(root=tmp_path, persona_path=Path(files["persona"].name), first_frame_receipt=Path(files["receipt"].name), action="pose topless", out=Path("video-manifest.json"))
    outside = tmp_path.parent / "outside-g01.png"; outside.write_bytes(b"outside")
    linked = tmp_path / "linked.png"
    try: linked.symlink_to(outside)
    except OSError: pytest.skip("this Windows test environment cannot create symlinks")
    receipt = json.loads(files["receipt"].read_text(encoding="utf-8")); receipt["first_frame"] = {"path": linked.name, "bytes": outside.stat().st_size, "sha256": digest(outside)}
    write_json(files["receipt"], receipt)
    with pytest.raises(video.VideoManifestError, match="symlink"):
        compile_manifest(tmp_path, files)


@pytest.mark.parametrize("clothing", ["a lingerie dress", "a long-sleeved dress\nwith jeans", "x" * 201])
def test_refuses_unsafe_multiline_or_oversize_clothing_before_prompt_interpolation(tmp_path: Path, clothing: str) -> None:
    files = fixture(tmp_path)
    persona = json.loads(files["persona"].read_text(encoding="utf-8"))
    persona["identity"]["look"]["clothing"] = clothing
    write_json(files["persona"], persona)
    with pytest.raises(video.VideoManifestError, match="identity.look.clothing"):
        compile_manifest(tmp_path, files)


def test_output_name_changes_for_different_seed_or_motion(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    base = video.build_manifest(root=tmp_path, persona_path=Path(files["persona"].name), first_frame_receipt=Path(files["receipt"].name), action="walk slowly toward the camera", out=Path("video-manifest.json"), seed=1)
    different_seed = video.build_manifest(root=tmp_path, persona_path=Path(files["persona"].name), first_frame_receipt=Path(files["receipt"].name), action="walk slowly toward the camera", out=Path("video-manifest.json"), seed=2)
    different_motion = video.build_manifest(root=tmp_path, persona_path=Path(files["persona"].name), first_frame_receipt=Path(files["receipt"].name), action="turn gently toward the camera", out=Path("video-manifest.json"), seed=1)
    names = {item["jobs"][0]["output_name"] for item in (base, different_seed, different_motion)}
    assert len(names) == 3


@pytest.mark.parametrize("seed", [True, -1, video.MAX_SEED + 1])
def test_refuses_non_harness_seed_values(tmp_path: Path, seed: object) -> None:
    files = fixture(tmp_path)
    with pytest.raises(video.VideoManifestError, match="seed must be an integer"):
        video.build_manifest(root=tmp_path, persona_path=Path(files["persona"].name), first_frame_receipt=Path(files["receipt"].name), action="walk slowly", out=Path("video-manifest.json"), seed=seed)


def test_preserves_persona_age_stage_in_prompt_and_rejects_ntfs_junction(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    manifest = compile_manifest(tmp_path, files)
    assert "an adult woman in her mid-twenties" in manifest["motion"]["prompt"]

    junction = tmp_path.parent / "manifest-root-junction"
    result = subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(tmp_path)], shell=False, capture_output=True, text=True)
    if result.returncode != 0:
        pytest.skip("this Windows test environment cannot create NTFS junctions")
    assert os.path.isjunction(junction)
    with pytest.raises(video.VideoManifestError, match="reparse point"):
        video.build_manifest(root=junction, persona_path=Path(files["persona"].name), first_frame_receipt=Path(files["receipt"].name), action="walk slowly", out=Path("video-manifest.json"))
