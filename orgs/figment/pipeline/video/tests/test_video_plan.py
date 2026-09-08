from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "video_plan.py"
SPEC = importlib.util.spec_from_file_location("figment_video_plan", MODULE_PATH)
assert SPEC and SPEC.loader
video = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = video
SPEC.loader.exec_module(video)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def fixture(root: Path) -> dict[str, Path]:
    root.mkdir(parents=True, exist_ok=True)
    persona = root / "persona.json"
    write_json(
        persona,
        {
            "id": "creator-test",
            "identity": {
                "look": {
                    "age_stage": "an adult woman in her mid-twenties",
                    "clothing": "a fully opaque black crew-neck shirt and jeans",
                }
            },
        },
    )
    frame = root / "accepted.png"
    frame.write_bytes(b"synthetic accepted first frame")
    receipt = root / "first-frame-input.json"
    write_json(
        receipt,
        {
            "schema": video.FRAME_SCHEMA,
            "creator": "creator-test",
            "first_frame": {"path": frame.name, "bytes": frame.stat().st_size, "sha256": digest(frame)},
        },
    )
    driver = root / "driver.mp4"
    driver.write_bytes(b"synthetic driving video")
    return {"persona": persona, "frame": frame, "receipt": receipt, "driver": driver}


def plan(root: Path, files: dict[str, Path]) -> dict[str, object]:
    return video.build_diagnostic_plan(
        root=root,
        persona_path=Path(files["persona"].name),
        first_frame_receipt=Path(files["receipt"].name),
        driving_video=Path(files["driver"].name),
        action="walk slowly toward the camera in a fully clothed street-style shot",
    )


def test_diagnostic_plan_binds_local_input_and_is_not_promotable(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    result = plan(tmp_path, files)

    assert result["schema"] == video.PLAN_SCHEMA
    assert result["execution"] == {
        "offline_only": True,
        "renderer": None,
        "not_promotable": True,
        "provenance_state": "unverified",
    }
    assert result["first_frame"]["frame"]["sha256"] == digest(files["frame"])
    assert result["first_frame"]["provenance_state"] == "unverified-local-input"
    assert result["frame_budget"] == {"frames": 60, "fps": 12, "sample_indices": [0, 29, 59]}
    assert result["model_adoption"]["status"] == "blocked-unadopted"


def test_rejects_production_self_approval_and_traversal(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    with pytest.raises(video.VideoPlanError, match="production video planning is disabled"):
        video.build_diagnostic_plan(
            root=tmp_path,
            persona_path=Path(files["persona"].name),
            first_frame_receipt=Path(files["receipt"].name),
            driving_video=Path(files["driver"].name),
            action="walk slowly",
            mode="production",
        )
    receipt = json.loads(files["receipt"].read_text(encoding="utf-8"))
    receipt["metadata"] = {"operator_approved": "claimed"}
    write_json(files["receipt"], receipt)
    with pytest.raises(video.VideoPlanError, match="may not assert approval"):
        plan(tmp_path, files)
    receipt.pop("metadata")
    write_json(files["receipt"], receipt)
    with pytest.raises(video.VideoPlanError, match="relative path"):
        video.build_diagnostic_plan(
            root=tmp_path,
            persona_path=Path("../persona.json"),
            first_frame_receipt=Path(files["receipt"].name),
            driving_video=Path(files["driver"].name),
            action="walk slowly",
        )


def test_rejects_stale_and_oversized_first_frames(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    files = fixture(tmp_path)
    files["frame"].write_bytes(b"changed frame bytes")
    with pytest.raises(video.VideoPlanError, match="no longer match"):
        plan(tmp_path, files)

    files = fixture(tmp_path / "bounded")
    monkeypatch.setattr(video, "MAX_FRAME_BYTES", 4)
    with pytest.raises(video.VideoPlanError, match="diagnostic limit"):
        plan(tmp_path / "bounded", files)


def test_rejects_oversized_or_too_deep_json(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    files = fixture(tmp_path)
    monkeypatch.setattr(video, "MAX_JSON_BYTES", 2)
    with pytest.raises(video.VideoPlanError, match="no larger"):
        plan(tmp_path, files)

    files = fixture(tmp_path / "deep")
    monkeypatch.setattr(video, "MAX_JSON_BYTES", 256 * 1024)
    monkeypatch.setattr(video, "MAX_JSON_DEPTH", 1)
    with pytest.raises(video.VideoPlanError, match="shallow object"):
        plan(tmp_path / "deep", files)


def test_sample_inventory_is_supplied_file_inventory_not_temporal_proof(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    video._write_once(tmp_path, Path("plan.json"), plan(tmp_path, files))
    candidate = tmp_path / "candidate.mp4"
    candidate.write_bytes(b"candidate video bytes")
    samples = []
    for name in ("first.png", "middle.png", "last.png"):
        sample = tmp_path / name
        sample.write_bytes(name.encode("ascii"))
        samples.append(sample)
    result = video.build_sample_inventory(
        root=tmp_path,
        plan_path=Path("plan.json"),
        candidate_video=Path(candidate.name),
        initial_frame=Path(files["frame"].name),
        sample_paths=[Path(sample.name) for sample in samples],
    )

    assert result["not_promotable"] is True
    assert result["source_relationship"].startswith("unverified-local-inventory")
    assert "temporal_qa" not in result
    files["frame"].write_bytes(b"a different input frame")
    with pytest.raises(video.VideoPlanError, match="differs"):
        video.build_sample_inventory(
            root=tmp_path,
            plan_path=Path("plan.json"),
            candidate_video=Path(candidate.name),
            initial_frame=Path(files["frame"].name),
            sample_paths=[Path(sample.name) for sample in samples],
        )


def test_rejects_symlinked_input_and_malformed_plan_execution(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    outside = tmp_path.parent / "outside-frame.png"
    outside.write_bytes(b"outside")
    linked = tmp_path / "linked.png"
    try:
        linked.symlink_to(outside)
    except OSError:
        pytest.skip("this Windows test environment cannot create symlinks")
    receipt = json.loads(files["receipt"].read_text(encoding="utf-8"))
    receipt["first_frame"] = {"path": linked.name, "bytes": outside.stat().st_size, "sha256": digest(outside)}
    write_json(files["receipt"], receipt)
    with pytest.raises(video.VideoPlanError, match="symlink"):
        plan(tmp_path, files)

    nested = tmp_path.parent / "linked-root-child"
    nested.mkdir(exist_ok=True)
    root_link = tmp_path.parent / "linked-root"
    try:
        root_link.symlink_to(tmp_path.parent, target_is_directory=True)
    except OSError:
        pytest.skip("this Windows test environment cannot create symlinks")
    with pytest.raises(video.VideoPlanError, match="never a symlink"):
        video._root(root_link / "linked-root-child")



def test_rejects_malformed_plan_execution(tmp_path: Path) -> None:
    files = fixture(tmp_path / "malformed")
    malformed = {"schema": video.PLAN_SCHEMA, "execution": [], "frame_budget": {}, "first_frame": {}}
    write_json(tmp_path / "malformed" / "plan.json", malformed)
    with pytest.raises(video.VideoPlanError, match="unpromotable"):
        video.build_sample_inventory(
            root=tmp_path / "malformed",
            plan_path=Path("plan.json"),
            candidate_video=Path(files["driver"].name),
            initial_frame=Path(files["frame"].name),
            sample_paths=[Path(files["frame"].name)] * 3,
        )


def test_cli_writes_diagnostic_plan_once(tmp_path: Path) -> None:
    files = fixture(tmp_path)
    arguments = [
        "plan",
        "--root", str(tmp_path),
        "--persona", files["persona"].name,
        "--first-frame-input", files["receipt"].name,
        "--driving-video", files["driver"].name,
        "--action", "walk slowly toward the camera",
        "--out", "plan.json",
    ]
    assert video.main(arguments) == 0
    written = json.loads((tmp_path / "plan.json").read_text(encoding="utf-8"))
    assert written["mode"] == "diagnostic"
    with pytest.raises(SystemExit) as error:
        video.main(arguments)
    assert error.value.code == 2
