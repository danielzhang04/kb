from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


VIDEO_DIR = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("figment_frame_assemble", VIDEO_DIR / "frame_assemble.py")
assert SPEC and SPEC.loader
assembly = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = assembly
SPEC.loader.exec_module(assembly)


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def fixture(root: Path) -> tuple[Path, Path, str]:
    root.mkdir(parents=True, exist_ok=True)
    output_name = "video-creator-test-f0123456789a-s77-p0123456789ab-w0123456789ab"
    run_dir = root / "run"; run_dir.mkdir()
    subprocess.run([str(assembly.frames.FFMPEG_PATH), "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=512x288:rate=16", "-frames:v", "81", str(run_dir / "raw_%02d.png")], shell=False, check=True, timeout=assembly.frames.COMMAND_TIMEOUT_SECONDS)
    files = []
    for index in range(1, 82):
        source = run_dir / f"raw_{index:02d}.png"; target = run_dir / f"{output_name}_{index:02d}.png"; source.replace(target)
        files.append({"path": target.name, "bytes": target.stat().st_size})
    manifest = root / "manifest.json"
    write_json(manifest, {"schema": assembly.MANIFEST_SCHEMA, "mode": "diagnostic", "not_promotable": True, "frame_budget": {"width": 512, "height": 288, "frames": 81, "fps": 16, "batch_size": 1}, "jobs": [{"seed": 77, "output_name": output_name, "expected_images": 81}]})
    receipt = run_dir / "run.json"
    # Synthetic local media only; this emulates the successful harness receipt fields
    # required by the adapter and does not claim a real provider run occurred.
    write_json(receipt, {"schema": "figment/runpod-run@1", "dry_run": False, "pod_id": "synthetic-test-pod", "termination_verified": True, "placement_attempts": [{"termination_verified": True}], "jobs": [{"job": 1, "output_name": output_name, "seed": 77, "files": files}]})
    return manifest, receipt, output_name


def test_assembles_real_ordered_81_pngs_and_records_honest_binding(tmp_path: Path) -> None:
    manifest, _, _ = fixture(tmp_path)
    receipt = assembly.assemble_frames(root=tmp_path, manifest_path=Path(manifest.name), run_receipt_path=Path("run/run.json"), output_dir=Path("assembled"))
    assert receipt["schema"] == assembly.SCHEMA and receipt["not_promotable"] is True
    assert len(receipt["frames"]) == 81
    assert [row["index"] for row in receipt["frames"]] == list(range(1, 82))
    assert receipt["metadata"]["frame_count"] == 81 and receipt["metadata"]["fps"] == 16
    assert receipt["metadata"]["expected_duration_seconds"] == "5.0625"
    assert receipt["run_receipt"]["binding"].endswith("no executed-workflow hash")
    assert (tmp_path / "assembled" / "diagnostic.mp4").is_file()
    assert (tmp_path / "assembled" / "frame-assembly.json").is_file()
    extracted = assembly.frames.extract_frames(root=tmp_path, video_path=Path("assembled/diagnostic.mp4"), output_dir=Path("samples"))
    assert [(item["label"], item["index"]) for item in extracted["frames"]] == [("first", 0), ("middle", 40), ("last", 80)]


@pytest.mark.parametrize("mutation, message", [("missing", "exactly 81"), ("duplicate", "ordered harness filename"), ("order", "ordered harness filename")])
def test_refuses_missing_duplicate_or_out_of_order_harness_files(tmp_path: Path, mutation: str, message: str) -> None:
    manifest, run, _ = fixture(tmp_path)
    data = json.loads(run.read_text(encoding="utf-8")); files = data["jobs"][0]["files"]
    if mutation == "missing": files.pop()
    elif mutation == "duplicate": files[-1] = dict(files[0])
    else: files[0], files[1] = files[1], files[0]
    write_json(run, data)
    with pytest.raises(assembly.FrameAssembleError, match=message):
        assembly.assemble_frames(root=tmp_path, manifest_path=Path(manifest.name), run_receipt_path=Path("run/run.json"), output_dir=Path("assembled"))


def test_refuses_output_collision_and_changed_download_after_assembly(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manifest, _, output_name = fixture(tmp_path)
    (tmp_path / "occupied").mkdir()
    with pytest.raises(assembly.FrameAssembleError, match="fresh"):
        assembly.assemble_frames(root=tmp_path, manifest_path=Path(manifest.name), run_receipt_path=Path("run/run.json"), output_dir=Path("occupied"))
    original = assembly.frames._run
    def run_then_change(*args: object, **kwargs: object) -> object:
        result = original(*args, **kwargs)
        if args[1] == "ffmpeg frame assembly":
            frame = tmp_path / "run" / f"{output_name}_01.png"; frame.write_bytes(frame.read_bytes() + b"changed")
        return result
    monkeypatch.setattr(assembly.frames, "_run", run_then_change)
    with pytest.raises(assembly.FrameAssembleError, match="downloaded frame"):
        assembly.assemble_frames(root=tmp_path, manifest_path=Path(manifest.name), run_receipt_path=Path("run/run.json"), output_dir=Path("changed"))
    assert not (tmp_path / "changed").exists()


@pytest.mark.parametrize("field, value", [("schema", "other"), ("dry_run", True), ("termination_verified", False), ("error", "failed")])
def test_refuses_non_successful_or_unproven_harness_receipts(tmp_path: Path, field: str, value: object) -> None:
    manifest, run, _ = fixture(tmp_path)
    data = json.loads(run.read_text(encoding="utf-8")); data[field] = value; write_json(run, data)
    with pytest.raises(assembly.FrameAssembleError, match="successful terminated non-dry-run"):
        assembly.assemble_frames(root=tmp_path, manifest_path=Path(manifest.name), run_receipt_path=Path("run/run.json"), output_dir=Path("assembled"))
