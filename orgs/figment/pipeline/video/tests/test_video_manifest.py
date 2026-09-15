from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from types import SimpleNamespace
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


def approved_fixture(root: Path, files: dict[str, Path]) -> tuple[Path, SimpleNamespace]:
    source_persona = root / "source-persona"; source_persona.mkdir()
    source_persona_file = source_persona / "persona.yaml"
    source_persona_file.write_bytes(files["persona"].read_bytes())
    plan = root / "plan.json"
    write_json(plan, {"assets": {"persona_dir": "source-persona"}})
    grade = root / "grade" / "gen"; grade.mkdir(parents=True)
    evidence = {}
    for name in ("approval-lineage.json", "approved-list.json", "rulings.json", "grading-manifest.json", "evaluation-inputs.json", "gate.json"):
        path = grade / name; write_json(path, {"fixture": name}); evidence[name] = path
    authority = {
        "image_id": "creator-test-gen-01", "path": str(files["frame"]),
        "bytes": files["frame"].stat().st_size, "sha256": digest(files["frame"]),
        "source_plan": {"path": str(plan), "sha256": digest(plan)},
        "approval_lineage": {"path": str(evidence["approval-lineage.json"]), "sha256": digest(evidence["approval-lineage.json"])},
        "approved_list": {"path": str(evidence["approved-list.json"]), "sha256": digest(evidence["approved-list.json"])},
    }
    return plan, SimpleNamespace(ROOT=root, validate_approved_gen_still=lambda *args: authority)


def test_compiles_hash_bound_native_81_frame_manifest(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    manifest = compile_manifest(tmp_path, files)

    assert manifest["schema"] == video.MANIFEST_SCHEMA
    assert manifest["not_promotable"] is True
    assert manifest["resolution_profile"] == {
        "name": video.LEGACY_RESOLUTION_PROFILE, "width": 512, "height": 288,
    }
    assert manifest["frame_budget"] == {"width": 512, "height": 288, "frames": 81, "fps": 16, "batch_size": 1}
    assert manifest["provenance"]["first_frame"]["frame"]["sha256"] == digest(files["frame"])
    assert manifest["provenance"]["workflow"]["sha256"] == video.WORKFLOW_SHA256
    assert manifest["provenance"]["model_pins"]["sha256"] == video.PINS_SHA256
    assert {model["role"] for model in manifest["models"]} == {"diffusion_model", "vae", "text_encoder"}
    assert all(model["filename"].endswith(".safetensors") for model in manifest["models"])
    output = manifest["jobs"][0]
    assert output["seed"] == 77 and output["expected_images"] == 81
    assert output["output_name"].startswith(f"video-creator-test-f{digest(files['frame'])[:12]}-s77-p")
    assert f"-r{video.LEGACY_RESOLUTION_PROFILE}-e" in output["output_name"]
    graph = manifest["workflow"]
    assert graph["55"]["class_type"] == "Wan22ImageToVideoLatent"
    assert graph["55"]["inputs"]["start_image"] == ["56", 0]
    assert {key: graph["55"]["inputs"][key] for key in ("width", "height")} == {
        "width": 512, "height": 288,
    }
    assert manifest["provenance"]["workflow"]["effective_sha256"] == video._effective_workflow_sha256(graph)
    assert graph["9"] == {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "figment-video"}}


def test_dry_run_uses_existing_image_contract_for_exactly_81_outputs(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    compile_manifest(tmp_path, files)
    result = subprocess.run([sys.executable, str(HARNESS), "run", "--manifest", str(tmp_path / "video-manifest.json"), "--out", str(tmp_path / "dry-run"), "--dry-run"], cwd=VIDEO_DIR.parent, capture_output=True, text=True, timeout=30)

    assert result.returncode == 0, result.stderr
    paths = sorted((tmp_path / "dry-run").glob("video-creator-test-*.png"))
    assert len(paths) == 81


def test_compiles_approved_gen_still_without_changing_diagnostic_route(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    files = fixture(tmp_path); plan = tmp_path / "plan.json"; approval = tmp_path / "approval-lineage.json"; approved = tmp_path / "approved-list.json"
    for path in (plan, approval, approved): path.write_text("{}", encoding="utf-8")
    authority = {"image_id": "creator-test-gen-01", "path": str(files["frame"]), "bytes": files["frame"].stat().st_size, "sha256": digest(files["frame"]), "source_plan": {"path": str(plan), "sha256": digest(plan)}, "approval_lineage": {"path": str(approval), "sha256": digest(approval)}, "approved_list": {"path": str(approved), "sha256": digest(approved)}}
    evidence_before = {path: digest(path) for path in (plan, approval, approved)}
    monkeypatch.setattr(video, "_train_module", lambda: SimpleNamespace(validate_approved_gen_still=lambda *args: authority))
    manifest = video.build_manifest(root=tmp_path, persona_path=Path(files["persona"].name), approved_gen_plan=Path(plan.name), approved_gen_image_id="creator-test-gen-01", action="walk slowly toward the camera", out=Path("approved-video-manifest.json"), seed=77)
    assert manifest["not_promotable"] is True
    assert manifest["provenance"]["first_frame"]["approved_gen"]["image_id"] == "creator-test-gen-01"
    assert manifest["provenance"]["first_frame"]["frame"]["sha256"] == digest(files["frame"])
    assert manifest["resolution_profile"] == {
        "name": video.APPROVED_GEN_RESOLUTION_PROFILE, "width": 1280, "height": 704,
    }
    assert manifest["frame_budget"] == {
        "width": 1280, "height": 704, "frames": 81, "fps": 16, "batch_size": 1,
    }
    assert manifest["workflow"]["55"]["inputs"]["width"] == 1280
    assert manifest["workflow"]["55"]["inputs"]["height"] == 704
    assert all(digest(path) == expected for path, expected in evidence_before.items())


def test_approved_gen_native_profile_dry_runs_81_outputs_and_verified_teardown(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = fixture(tmp_path); plan = tmp_path / "plan.json"; approval = tmp_path / "approval-lineage.json"; approved = tmp_path / "approved-list.json"
    for path in (plan, approval, approved): path.write_text("{}", encoding="utf-8")
    authority = {"image_id": "creator-test-gen-01", "path": str(files["frame"]), "bytes": files["frame"].stat().st_size, "sha256": digest(files["frame"]), "source_plan": {"path": str(plan), "sha256": digest(plan)}, "approval_lineage": {"path": str(approval), "sha256": digest(approval)}, "approved_list": {"path": str(approved), "sha256": digest(approved)}}
    monkeypatch.setattr(video, "_train_module", lambda: SimpleNamespace(validate_approved_gen_still=lambda *args: authority))
    video.write_manifest(root=tmp_path, persona_path=Path(files["persona"].name), approved_gen_plan=Path(plan.name), approved_gen_image_id="creator-test-gen-01", action="walk slowly toward the camera", out=Path("video-manifest.json"), seed=77)

    result = subprocess.run([sys.executable, str(HARNESS), "run", "--manifest", str(tmp_path / "video-manifest.json"), "--out", str(tmp_path / "native-dry-run"), "--dry-run"], cwd=VIDEO_DIR.parent, capture_output=True, text=True, timeout=30)

    assert result.returncode == 0, result.stderr
    receipt = json.loads((tmp_path / "native-dry-run" / "run.json").read_text(encoding="utf-8"))
    assert receipt["dry_run"] is True
    assert receipt["termination_verified"] is True
    assert len(receipt["jobs"]) == 1
    assert len(receipt["jobs"][0]["files"]) == 81
    recovery = json.loads(next((tmp_path / "native-dry-run").glob("recovery-*.json")).read_text(encoding="utf-8"))
    assert recovery["state"] == "terminated" and recovery["absence_verified"] is True


def test_compiles_distinct_unreviewed_review_candidate_from_approved_gen_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = fixture(tmp_path); plan, train = approved_fixture(tmp_path, files)
    monkeypatch.setattr(video, "_train_module", lambda: train)
    manifest = video.write_manifest(
        root=tmp_path, persona_path=Path("source-persona/persona.yaml"),
        approved_gen_plan=Path(plan.name), approved_gen_image_id="creator-test-gen-01",
        action="walk slowly toward the camera", out=Path("candidate.json"), seed=77,
        mode=video.CANDIDATE_MODE,
    )
    job = manifest["jobs"][0]
    assert manifest["schema"] == video.CANDIDATE_MANIFEST_SCHEMA
    assert manifest["mode"] == video.CANDIDATE_MODE
    assert manifest["lifecycle"] == "unreviewed"
    assert manifest["eligible_for_temporal_review"] is True
    assert "not_promotable" not in manifest
    assert manifest["candidate_id"] == job["output_name"]
    assert job["output_name"].startswith(video.CANDIDATE_PREFIX)
    assert manifest["provenance"]["first_frame"]["approved_gen"]["persona"] == {
        "path": "source-persona/persona.yaml", "sha256": digest(tmp_path / "source-persona" / "persona.yaml"),
    }
    assert manifest["resolution_profile"]["name"] == video.APPROVED_GEN_RESOLUTION_PROFILE


def test_review_candidate_refuses_diagnostic_input_and_unsafe_authority_before_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = fixture(tmp_path)
    out = tmp_path / "candidate.json"
    with pytest.raises(video.VideoManifestError, match="require the current approved gen"):
        video.write_manifest(
            root=tmp_path, persona_path=Path(files["persona"].name),
            first_frame_receipt=Path(files["receipt"].name), action="walk slowly",
            out=Path(out.name), mode=video.CANDIDATE_MODE,
        )
    assert not out.exists()

    plan, train = approved_fixture(tmp_path, files)
    called = False
    def authority(*args: object) -> object:
        nonlocal called; called = True; return train.validate_approved_gen_still(*args)
    guarded = SimpleNamespace(ROOT=tmp_path, validate_approved_gen_still=authority)
    monkeypatch.setattr(video, "_train_module", lambda: guarded)
    (tmp_path / "grade" / "gen" / "gate.json").write_bytes(b" " * (video.MAX_JSON_BYTES + 1))
    with pytest.raises(video.VideoManifestError, match="no larger"):
        video.write_manifest(
            root=tmp_path, persona_path=Path(files["persona"].name),
            approved_gen_plan=Path(plan.name), approved_gen_image_id="creator-test-gen-01",
            action="walk slowly", out=Path(out.name), mode=video.CANDIDATE_MODE,
        )
    assert called is False and not out.exists()
    (tmp_path / "grade" / "gen" / "gate.json").write_text(
        '{"nested":' + ('[' * 10_000) + ('0' + ']' * 10_000) + '}', encoding="utf-8",
    )
    with pytest.raises(video.VideoManifestError, match="shallow object"):
        video.write_manifest(
            root=tmp_path, persona_path=Path(files["persona"].name),
            approved_gen_plan=Path(plan.name), approved_gen_image_id="creator-test-gen-01",
            action="walk slowly", out=Path(out.name), mode=video.CANDIDATE_MODE,
        )
    assert called is False and not out.exists()


def test_review_candidate_refuses_reparse_gen_evidence_before_authority(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = fixture(tmp_path); plan, train = approved_fixture(tmp_path, files)
    grade = tmp_path / "grade"
    grade_target = tmp_path / "grade-real"
    grade.rename(grade_target)
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(grade), str(grade_target)],
        shell=False, capture_output=True, text=True,
    )
    if result.returncode != 0:
        grade_target.rename(grade)
        pytest.skip("this Windows test environment cannot create NTFS junctions")
    called = False
    def authority(*args: object) -> object:
        nonlocal called; called = True; return train.validate_approved_gen_still(*args)
    monkeypatch.setattr(
        video, "_train_module",
        lambda: SimpleNamespace(ROOT=tmp_path, validate_approved_gen_still=authority),
    )
    out = tmp_path / "candidate.json"
    try:
        with pytest.raises(video.VideoManifestError, match="reparse point"):
            video.write_manifest(
                root=tmp_path, persona_path=Path("source-persona/persona.yaml"),
                approved_gen_plan=Path(plan.name), approved_gen_image_id="creator-test-gen-01",
                action="walk slowly", out=Path(out.name), mode=video.CANDIDATE_MODE,
            )
        assert called is False and not out.exists()
    finally:
        os.rmdir(grade)
        grade_target.rename(grade)


def test_review_candidate_rejects_same_id_alternate_persona(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = fixture(tmp_path); plan, train = approved_fixture(tmp_path, files)
    alternate = json.loads(files["persona"].read_text(encoding="utf-8"))
    alternate["identity"]["look"]["clothing"] = "a different fully opaque coat and jeans"
    write_json(files["persona"], alternate)
    monkeypatch.setattr(video, "_train_module", lambda: train)
    with pytest.raises(video.VideoManifestError, match="must be the current approved gen plan persona"):
        video.write_manifest(
            root=tmp_path, persona_path=Path(files["persona"].name),
            approved_gen_plan=Path(plan.name), approved_gen_image_id="creator-test-gen-01",
            action="walk slowly", out=Path("candidate.json"), mode=video.CANDIDATE_MODE,
        )


def test_review_candidate_requires_native_profile_and_stable_persona_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = fixture(tmp_path); plan, train = approved_fixture(tmp_path, files)
    monkeypatch.setattr(video, "_train_module", lambda: train)
    out = tmp_path / "candidate.json"
    with pytest.raises(video.VideoManifestError, match="approved gen video requires"):
        video.write_manifest(
            root=tmp_path, persona_path=Path("source-persona/persona.yaml"),
            approved_gen_plan=Path(plan.name), approved_gen_image_id="creator-test-gen-01",
            action="walk slowly", out=Path(out.name), mode=video.CANDIDATE_MODE,
            resolution_profile=video.LEGACY_RESOLUTION_PROFILE,
        )
    assert not out.exists()

    original = video._read_json_snapshot
    changed = False
    def mutate_after_initial_persona(path: Path, label: str) -> tuple[dict[str, object], str]:
        nonlocal changed
        value, digest_value = original(path, label)
        if label == "persona" and not changed:
            changed = True
            updated = json.loads(path.read_text(encoding="utf-8"))
            updated["identity"]["look"]["clothing"] = "a changed fully opaque coat and jeans"
            write_json(path, updated)
        return value, digest_value
    monkeypatch.setattr(video, "_read_json_snapshot", mutate_after_initial_persona)
    with pytest.raises(video.VideoManifestError, match="current approved gen plan persona"):
        video.write_manifest(
            root=tmp_path, persona_path=Path("source-persona/persona.yaml"),
            approved_gen_plan=Path(plan.name), approved_gen_image_id="creator-test-gen-01",
            action="walk slowly", out=Path(out.name), mode=video.CANDIDATE_MODE,
        )
    assert not out.exists()


def test_review_candidate_rechecks_dependencies_at_write_boundary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = fixture(tmp_path); plan, train = approved_fixture(tmp_path, files)
    monkeypatch.setattr(video, "_train_module", lambda: train)
    original = video.build_manifest
    calls = 0
    def mutate_after_first_build(**kwargs: object) -> dict[str, object]:
        nonlocal calls
        calls += 1
        result = original(**kwargs)
        if calls == 1: plan.write_text(plan.read_text(encoding="utf-8") + " ", encoding="utf-8")
        return result
    monkeypatch.setattr(video, "build_manifest", mutate_after_first_build)
    out = tmp_path / "candidate.json"
    with pytest.raises(video.VideoManifestError, match="approved gen plan changed"):
        video.write_manifest(
            root=tmp_path, persona_path=Path("source-persona/persona.yaml"),
            approved_gen_plan=Path(plan.name), approved_gen_image_id="creator-test-gen-01",
            action="walk slowly", out=Path(out.name), mode=video.CANDIDATE_MODE,
        )
    assert calls == 2 and not out.exists()


@pytest.mark.parametrize("profile", ["unknown", "1280x704", "", False, 0, [], 1280])
def test_refuses_unknown_or_invalid_resolution_profile_before_writing(
    tmp_path: Path, profile: object,
) -> None:
    files = fixture(tmp_path)
    out = tmp_path / "video-manifest.json"
    with pytest.raises(video.VideoManifestError, match="resolution profile"):
        video.write_manifest(root=tmp_path, persona_path=Path(files["persona"].name), first_frame_receipt=Path(files["receipt"].name), action="walk slowly", out=Path(out.name), resolution_profile=profile)
    assert not out.exists()


def test_approved_gen_route_refuses_legacy_resolution_even_when_explicit(
    tmp_path: Path,
) -> None:
    files = fixture(tmp_path)
    with pytest.raises(video.VideoManifestError, match="approved gen video requires"):
        video.build_manifest(root=tmp_path, persona_path=Path(files["persona"].name), approved_gen_plan=Path("missing-plan.json"), approved_gen_image_id="candidate", action="walk slowly", out=Path("video-manifest.json"), resolution_profile=video.LEGACY_RESOLUTION_PROFILE)
    assert not (tmp_path / "video-manifest.json").exists()


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


def test_replans_idempotently_but_refuses_overwrite_nonlocal_upload_and_unreviewed_static_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = fixture(tmp_path)
    first = compile_manifest(tmp_path, files)
    # MINOR 6 (REVIEW): an unchanged replan against the SAME already-written manifest is
    # idempotent -- accepted, not refused, and the on-disk bytes are untouched.
    out_path = tmp_path / "video-manifest.json"
    before_bytes = out_path.read_bytes()
    second = compile_manifest(tmp_path, files)
    assert second == first
    assert out_path.read_bytes() == before_bytes

    # A genuine change (different seed -> different manifest bytes) against the same
    # output path still refuses rather than silently overwriting.
    with pytest.raises(video.VideoManifestError, match="overwrite"):
        video.write_manifest(
            root=tmp_path, persona_path=Path(files["persona"].name),
            first_frame_receipt=Path(files["receipt"].name),
            action="walk slowly toward the camera in a fully clothed street-style shot",
            out=Path("video-manifest.json"), seed=78,
        )
    assert out_path.read_bytes() == before_bytes

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
    different_profile = video.build_manifest(root=tmp_path, persona_path=Path(files["persona"].name), first_frame_receipt=Path(files["receipt"].name), action="walk slowly toward the camera", out=Path("video-manifest.json"), seed=1, resolution_profile=video.APPROVED_GEN_RESOLUTION_PROFILE)
    names = {item["jobs"][0]["output_name"] for item in (base, different_seed, different_motion, different_profile)}
    assert len(names) == 4


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
