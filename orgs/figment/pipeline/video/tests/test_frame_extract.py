from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "frame_extract.py"
SPEC = importlib.util.spec_from_file_location("figment_frame_extract", MODULE_PATH)
assert SPEC and SPEC.loader
frames = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = frames
SPEC.loader.exec_module(frames)


def ppm(path: Path, color: tuple[int, int, int]) -> None:
    width = height = 16
    path.write_bytes(f"P6\n{width} {height}\n255\n".encode("ascii") + bytes(color) * (width * height))


def synthetic_clip(root: Path) -> Path:
    for index, color in enumerate(((255, 0, 0), (0, 255, 0), (0, 0, 255))):
        ppm(root / f"input_{index}.ppm", color)
    video = root / "source.mp4"
    command = [
        str(frames.FFMPEG_PATH), "-y", "-v", "error", "-framerate", "1", "-start_number", "0",
        "-i", str(root / "input_%d.ppm"), "-frames:v", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video),
    ]
    subprocess.run(command, shell=False, check=True, timeout=frames.COMMAND_TIMEOUT_SECONDS)
    return video


def dominant_rgb(path: Path) -> tuple[float, float, float]:
    raw = subprocess.run(
        [str(frames.FFMPEG_PATH), "-v", "error", "-i", str(path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        shell=False,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=frames.COMMAND_TIMEOUT_SECONDS,
    ).stdout
    assert len(raw) == 16 * 16 * 3
    return tuple(sum(raw[channel::3]) / (16 * 16) for channel in range(3))


def test_extracts_exact_known_first_middle_last_frames(tmp_path: Path) -> None:
    video = synthetic_clip(tmp_path)
    receipt = frames.extract_frames(root=tmp_path, video_path=Path(video.name), output_dir=Path("extracted"))

    assert receipt["schema"] == frames.SCHEMA
    assert receipt["not_promotable"] is True
    assert "identity" in receipt["provenance"] and "approval" in receipt["provenance"]
    assert receipt["metadata"]["width"] == 16
    assert receipt["metadata"]["height"] == 16
    assert frames.Decimal(receipt["metadata"]["duration_seconds"]) == frames.Decimal("3")
    assert receipt["metadata"]["frame_count"] == 3
    assert [(item["label"], item["index"]) for item in receipt["frames"]] == [("first", 0), ("middle", 1), ("last", 2)]
    extracted = [tmp_path / item["path"] for item in receipt["frames"]]
    colors = [dominant_rgb(path) for path in extracted]
    assert colors[0][0] > 220 and colors[0][1] < 40 and colors[0][2] < 40
    assert colors[1][1] > 220 and colors[1][0] < 40 and colors[1][2] < 40
    assert colors[2][2] > 220 and colors[2][0] < 40 and colors[2][1] < 40
    assert (tmp_path / "extracted" / "frame-extraction.json").is_file()


def test_rejects_collisions_paths_and_malformed_media(tmp_path: Path) -> None:
    video = synthetic_clip(tmp_path)
    (tmp_path / "occupied").mkdir()
    with pytest.raises(frames.FrameExtractError, match="fresh"):
        frames.extract_frames(root=tmp_path, video_path=Path(video.name), output_dir=Path("occupied"))
    with pytest.raises(frames.FrameExtractError, match="relative"):
        frames.extract_frames(root=tmp_path, video_path=Path("../source.mp4"), output_dir=Path("out"))
    malformed = tmp_path / "malformed.mp4"
    malformed.write_bytes(b"not video media")
    with pytest.raises(frames.FrameExtractError, match="rejected the local media"):
        frames.extract_frames(root=tmp_path, video_path=Path(malformed.name), output_dir=Path("malformed-out"))


def test_rejects_duration_frame_and_frame_byte_limits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    video = synthetic_clip(tmp_path)
    monkeypatch.setattr(frames, "MAX_DURATION_SECONDS", frames.Decimal("2"))
    with pytest.raises(frames.FrameExtractError, match="dimension or duration"):
        frames.extract_frames(root=tmp_path, video_path=Path(video.name), output_dir=Path("too-long"))

    monkeypatch.setattr(frames, "MAX_DURATION_SECONDS", frames.Decimal("30"))
    monkeypatch.setattr(frames, "MAX_FRAME_COUNT", 2)
    with pytest.raises(frames.FrameExtractError, match="frame count"):
        frames.extract_frames(root=tmp_path, video_path=Path(video.name), output_dir=Path("too-many"))

    monkeypatch.setattr(frames, "MAX_FRAME_COUNT", 720)
    monkeypatch.setattr(frames, "MAX_FRAME_BYTES", 1)
    with pytest.raises(frames.FrameExtractError, match="diagnostic limit"):
        frames.extract_frames(root=tmp_path, video_path=Path(video.name), output_dir=Path("too-large-frame"))


def test_rejects_changed_source_without_receipt(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    video = synthetic_clip(tmp_path)
    original = frames._extract_one
    calls = 0

    def extract_then_change(*args: object, **kwargs: object) -> None:
        nonlocal calls
        original(*args, **kwargs)
        calls += 1
        if calls == 3:
            video.write_bytes(video.read_bytes() + b"changed after frame extraction")

    monkeypatch.setattr(frames, "_extract_one", extract_then_change)
    with pytest.raises(frames.FrameExtractError, match="changed during extraction"):
        frames.extract_frames(root=tmp_path, video_path=Path(video.name), output_dir=Path("changed"))
    assert not (tmp_path / "changed" / "frame-extraction.json").exists()


def test_cleans_owned_output_after_failure_following_first_frame(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    video = synthetic_clip(tmp_path)
    original = frames._extract_one
    calls = 0

    def fail_after_first(*args: object, **kwargs: object) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise frames.FrameExtractError("simulated second-frame failure")
        original(*args, **kwargs)

    monkeypatch.setattr(frames, "_extract_one", fail_after_first)
    with pytest.raises(frames.FrameExtractError, match="second-frame"):
        frames.extract_frames(root=tmp_path, video_path=Path(video.name), output_dir=Path("partial"))
    assert not (tmp_path / "partial").exists()


def test_rejects_oversized_probe_stdout_before_buffering_it(tmp_path: Path) -> None:
    with pytest.raises(frames.FrameExtractError, match="too much metadata"):
        frames._run([sys.executable, "-c", "import sys; sys.stdout.write('x' * 4096)"], "test probe", stdout_limit=1024)


def test_rejects_symlinked_video_and_root_ancestor(tmp_path: Path) -> None:
    video = synthetic_clip(tmp_path)
    link = tmp_path / "linked.mp4"
    try:
        link.symlink_to(video)
    except OSError:
        pytest.skip("this Windows test environment cannot create symlinks")
    with pytest.raises(frames.FrameExtractError, match="symlink"):
        frames.extract_frames(root=tmp_path, video_path=Path(link.name), output_dir=Path("linked-out"))

    root_link = tmp_path.parent / "frame-extract-root-link"
    try:
        root_link.symlink_to(tmp_path.parent, target_is_directory=True)
    except OSError:
        pytest.skip("this Windows test environment cannot create symlinks")
    with pytest.raises(frames.FrameExtractError, match="never a symlink"):
        frames._root(root_link / tmp_path.name)


def _junction(link: Path, target: Path) -> None:
    if os.name != "nt":
        pytest.skip("junctions are a Windows-only filesystem feature")
    result = subprocess.run(
        ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
        shell=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=10,
        check=False,
    )
    if result.returncode != 0:
        pytest.skip("this Windows test environment cannot create junctions")


def test_rejects_windows_junctions_in_root_input_and_output_paths(tmp_path: Path) -> None:
    external = tmp_path.parent / f"{tmp_path.name}-junction-target"
    external.mkdir()
    try:
        external_video = synthetic_clip(external)
        source_junction = tmp_path / "source-junction"
        _junction(source_junction, external)
        with pytest.raises(frames.FrameExtractError, match="reparse point"):
            frames.extract_frames(root=tmp_path, video_path=Path("source-junction") / external_video.name, output_dir=Path("out"))

        local_video = synthetic_clip(tmp_path)
        output_junction = tmp_path / "output-junction"
        _junction(output_junction, external)
        with pytest.raises(frames.FrameExtractError, match="reparse point"):
            frames.extract_frames(root=tmp_path, video_path=Path(local_video.name), output_dir=Path("output-junction/out"))

        root_junction = tmp_path.parent / f"{tmp_path.name}-root-junction"
        _junction(root_junction, external)
        with pytest.raises(frames.FrameExtractError, match="reparse point"):
            frames.extract_frames(root=root_junction, video_path=Path(external_video.name), output_dir=Path("out"))
    finally:
        for path in (tmp_path / "source-junction", tmp_path / "output-junction", tmp_path.parent / f"{tmp_path.name}-root-junction", external):
            if frames._is_reparse_point(path):
                try:
                    os.rmdir(path)
                except OSError:
                    pass
            elif path.is_dir() and not path.is_symlink():
                try:
                    shutil.rmtree(path)
                except OSError:
                    pass
