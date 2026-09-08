#!/usr/bin/env python3
"""Extract bounded, hash-pinned diagnostic frames with installed FFmpeg tools only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import threading
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


SCHEMA = "figment/video-frame-extraction@1"
FFMPEG_PATH = Path(r"C:\Users\danie\AppData\Local\Programs\Python\Python313\Scripts\ffmpeg.exe")
FFPROBE_PATH = Path(r"C:\Users\danie\AppData\Local\Programs\Python\Python313\Scripts\ffprobe.exe")
MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024
MAX_FRAME_BYTES = 32 * 1024 * 1024
MAX_DURATION_SECONDS = Decimal("30")
MAX_FRAME_COUNT = 720
MAX_PIXELS = 16_777_216
COMMAND_TIMEOUT_SECONDS = 30
FRAME_NAMES = ("first", "middle", "last")
MAX_PROBE_STDOUT_BYTES = 64 * 1024


class FrameExtractError(ValueError):
    """Raised for unsafe, malformed, or non-diagnostic media inputs."""


def _is_reparse_point(path: Path) -> bool:
    """Windows junctions are not necessarily reported as ``Path.is_symlink()``."""
    try:
        attributes = os.lstat(path).st_file_attributes
    except (AttributeError, OSError):
        return False
    return bool(attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))


def _unsafe_link(path: Path) -> bool:
    return path.is_symlink() or _is_reparse_point(path)


def _real_below(root: Path, path: Path) -> bool:
    """Check resolved containment after every existing component was link-free."""
    try:
        path.resolve(strict=True).relative_to(root)
        return True
    except (OSError, ValueError):
        return False


def _root(path: Path) -> Path:
    try:
        lexical = path.absolute()
        if not lexical.is_dir() or any(_unsafe_link(part) for part in (lexical, *lexical.parents)):
            raise FrameExtractError("root must be a real directory, never a symlink or reparse point")
        resolved = lexical.resolve(strict=True)
        if not _real_below(resolved, resolved):
            raise FrameExtractError("root directory is unavailable")
        return resolved
    except OSError as exc:
        raise FrameExtractError("root directory is unavailable") from exc


def _within(root: Path, relative: Path, label: str, *, must_exist: bool = True) -> Path:
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise FrameExtractError(f"{label} must be a relative path below --root")
    path = root
    for index, part in enumerate(relative.parts):
        path /= part
        if path.exists() or _unsafe_link(path):
            if _unsafe_link(path):
                raise FrameExtractError(f"{label} may not traverse a symlink or reparse point")
        elif must_exist or index != len(relative.parts) - 1:
            raise FrameExtractError(f"{label} is missing: {relative.as_posix()}")
    if path.exists() and not _real_below(root, path):
        raise FrameExtractError(f"{label} escaped the root")
    return path


def _hash_file(root: Path, relative: Path, label: str, maximum: int) -> dict[str, Any]:
    path = _within(root, relative, label)
    if not path.is_file():
        raise FrameExtractError(f"{label} must be a regular file")
    expected_size = path.stat().st_size
    if expected_size <= 0 or expected_size > maximum:
        raise FrameExtractError(f"{label} exceeds its {maximum}-byte diagnostic limit")
    digest = hashlib.sha256()
    actual_size = 0
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                actual_size += len(chunk)
                if actual_size > maximum:
                    raise FrameExtractError(f"{label} exceeds its {maximum}-byte diagnostic limit")
                digest.update(chunk)
    except OSError as exc:
        raise FrameExtractError(f"cannot read {label}") from exc
    if actual_size != expected_size:
        raise FrameExtractError(f"{label} changed while it was being read")
    return {"path": relative.as_posix(), "bytes": actual_size, "sha256": digest.hexdigest()}


def _tool(path: Path, label: str) -> str:
    if not path.is_file():
        raise FrameExtractError(f"trusted {label} binary is unavailable")
    return str(path)


def _run_bounded_stdout(arguments: list[str], label: str, limit: int) -> subprocess.CompletedProcess[bytes]:
    """Drain a probe pipe incrementally, killing it before unbounded buffering is possible."""
    try:
        process = subprocess.Popen(
            arguments,
            shell=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
    except OSError as exc:
        raise FrameExtractError(f"{label} did not complete safely") from exc

    output = bytearray()
    overflow = False

    def drain() -> None:
        nonlocal overflow
        assert process.stdout is not None
        while block := process.stdout.read(8192):
            if len(output) + len(block) > limit:
                overflow = True
                try:
                    process.kill()
                except OSError:
                    pass
                return
            output.extend(block)

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    try:
        process.wait(timeout=COMMAND_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        process.kill()
        process.wait()
        raise FrameExtractError(f"{label} did not complete safely") from exc
    finally:
        if process.stdout is not None:
            process.stdout.close()
        reader.join(timeout=1)
    if reader.is_alive():
        raise FrameExtractError(f"{label} did not complete safely")
    if overflow:
        raise FrameExtractError(f"{label} returned too much metadata")
    if process.returncode != 0:
        raise FrameExtractError(f"{label} rejected the local media")
    return subprocess.CompletedProcess(arguments, process.returncode, bytes(output), b"")


def _run(arguments: list[str], label: str, *, stdout_limit: int | None = None) -> subprocess.CompletedProcess[bytes]:
    if stdout_limit is not None:
        return _run_bounded_stdout(arguments, label, stdout_limit)
    try:
        result = subprocess.run(
            arguments,
            shell=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=COMMAND_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise FrameExtractError(f"{label} did not complete safely") from exc
    if result.returncode != 0:
        raise FrameExtractError(f"{label} rejected the local media")
    return result


def _decimal(value: Any, label: str) -> Decimal:
    if not isinstance(value, str):
        raise FrameExtractError(f"probe returned invalid {label}")
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise FrameExtractError(f"probe returned invalid {label}") from exc
    if not parsed.is_finite() or parsed <= 0:
        raise FrameExtractError(f"probe returned invalid {label}")
    return parsed


def _integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise FrameExtractError(f"probe returned invalid {label}")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise FrameExtractError(f"probe returned invalid {label}") from exc
    if parsed <= 0:
        raise FrameExtractError(f"probe returned invalid {label}")
    return parsed


def _probe_json(arguments: list[str], label: str) -> dict[str, Any]:
    result = _run(arguments, label, stdout_limit=MAX_PROBE_STDOUT_BYTES)
    try:
        parsed = json.loads(result.stdout)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise FrameExtractError(f"{label} returned malformed metadata") from exc
    if not isinstance(parsed, dict):
        raise FrameExtractError(f"{label} returned malformed metadata")
    return parsed


def _probe_video(root: Path, video: Path) -> dict[str, Any]:
    source = _within(root, video, "video")
    probe = _tool(FFPROBE_PATH, "ffprobe")
    metadata = _probe_json(
        [
            probe, "-v", "error", "-select_streams", "v:0", "-show_entries",
            "stream=codec_type,width,height:format=duration", "-of", "json", str(source),
        ],
        "ffprobe metadata probe",
    )
    streams = metadata.get("streams")
    stream = streams[0] if isinstance(streams, list) and len(streams) == 1 and isinstance(streams[0], dict) else None
    format_data = metadata.get("format")
    if not isinstance(stream, dict) or stream.get("codec_type") != "video" or not isinstance(format_data, dict):
        raise FrameExtractError("ffprobe did not find a usable video stream")
    width = _integer(stream.get("width"), "width")
    height = _integer(stream.get("height"), "height")
    duration = _decimal(format_data.get("duration"), "duration")
    if width * height > MAX_PIXELS or duration > MAX_DURATION_SECONDS:
        raise FrameExtractError("video exceeds diagnostic dimension or duration limits")
    counted = _probe_json(
        [
            probe, "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
            "stream=nb_read_frames", "-of", "json", str(source),
        ],
        "ffprobe frame-count probe",
    )
    count_streams = counted.get("streams")
    count_stream = count_streams[0] if isinstance(count_streams, list) and len(count_streams) == 1 and isinstance(count_streams[0], dict) else None
    if not isinstance(count_stream, dict):
        raise FrameExtractError("ffprobe did not return a frame count")
    frame_count = _integer(count_stream.get("nb_read_frames"), "frame count")
    if frame_count < 3 or frame_count > MAX_FRAME_COUNT:
        raise FrameExtractError("video frame count is outside diagnostic limits")
    return {"width": width, "height": height, "duration_seconds": str(duration), "frame_count": frame_count}


def _probe_frame(root: Path, relative: Path, expected_width: int, expected_height: int) -> None:
    path = _within(root, relative, "extracted frame")
    probe = _tool(FFPROBE_PATH, "ffprobe")
    metadata = _probe_json(
        [probe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type,width,height", "-of", "json", str(path)],
        "ffprobe extracted-frame probe",
    )
    streams = metadata.get("streams")
    stream = streams[0] if isinstance(streams, list) and len(streams) == 1 and isinstance(streams[0], dict) else None
    if not isinstance(stream, dict) or stream.get("codec_type") != "video":
        raise FrameExtractError("ffprobe did not validate an extracted frame")
    if _integer(stream.get("width"), "frame width") != expected_width or _integer(stream.get("height"), "frame height") != expected_height:
        raise FrameExtractError("extracted frame dimensions differ from source video")


def _extract_one(root: Path, video: Path, output: Path, index: int) -> None:
    source = _within(root, video, "video")
    target = _within(root, output, "frame output", must_exist=False)
    if target.exists() or target.is_symlink():
        raise FrameExtractError("frame output already exists")
    ffmpeg = _tool(FFMPEG_PATH, "ffmpeg")
    _run(
        [ffmpeg, "-v", "error", "-i", str(source), "-vf", f"select=eq(n\\,{index})", "-frames:v", "1", str(target)],
        f"ffmpeg extraction for frame {index}",
    )
    if not target.is_file():
        raise FrameExtractError("ffmpeg did not produce an extracted frame")


def _cleanup_owned_directory(root: Path, destination: Path) -> None:
    """Remove only the directory this invocation created, after link-free containment checks."""
    try:
        relative = destination.relative_to(root)
    except ValueError:
        return
    try:
        checked = _within(root, relative, "owned output directory")
    except FrameExtractError:
        return
    if checked != destination or not destination.is_dir() or _unsafe_link(destination) or not _real_below(root, destination):
        return
    try:
        shutil.rmtree(destination)
    except OSError:
        pass


def _write_receipt(root: Path, relative: Path, value: dict[str, Any]) -> None:
    target = _within(root, relative, "receipt output", must_exist=False)
    try:
        with target.open("x", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError as exc:
        raise FrameExtractError("refusing to overwrite an existing extraction receipt") from exc
    except OSError as exc:
        raise FrameExtractError("cannot write extraction receipt") from exc


def extract_frames(*, root: Path, video_path: Path, output_dir: Path) -> dict[str, Any]:
    """Probe a local video and extract its exact first, middle, and final decoded frames."""
    root = _root(root)
    _within(root, output_dir, "output directory", must_exist=False)
    destination = root / output_dir
    if destination.exists() or destination.is_symlink():
        raise FrameExtractError("output directory must be fresh")
    source_before = _hash_file(root, video_path, "video", MAX_VIDEO_BYTES)
    metadata = _probe_video(root, video_path)
    try:
        destination.mkdir()
    except (FileExistsError, OSError) as exc:
        raise FrameExtractError("output directory could not be created fresh") from exc
    if _unsafe_link(destination) or not destination.is_dir() or not _real_below(root, destination):
        raise FrameExtractError("output directory could not be created safely")
    try:
        indices = (0, metadata["frame_count"] // 2, metadata["frame_count"] - 1)
        frames: list[dict[str, Any]] = []
        for name, index in zip(FRAME_NAMES, indices, strict=True):
            relative = output_dir / f"{name}.png"
            temporary = output_dir / f".{name}.{uuid.uuid4().hex}.tmp.png"
            _extract_one(root, video_path, temporary, index)
            _probe_frame(root, temporary, metadata["width"], metadata["height"])
            record = _hash_file(root, temporary, "extracted frame", MAX_FRAME_BYTES)
            temporary_path = _within(root, temporary, "extracted frame")
            final_path = _within(root, relative, "frame output", must_exist=False)
            if final_path.exists() or final_path.is_symlink() or _unsafe_link(final_path):
                raise FrameExtractError("frame output already exists")
            os.replace(temporary_path, final_path)
            record["path"] = relative.as_posix()
            record.update({"label": name, "index": index})
            frames.append(record)
        source_after = _hash_file(root, video_path, "video", MAX_VIDEO_BYTES)
        if source_after != source_before:
            raise FrameExtractError("video changed during extraction; no receipt was created")
        receipt = {
            "schema": SCHEMA,
            "provenance": "frames extracted locally from the hash-pinned video bytes; no identity, temporal-quality, or approval claim",
            "not_promotable": True,
            "video_before": source_before,
            "video_after": source_after,
            "metadata": metadata,
            "frames": frames,
        }
        _write_receipt(root, output_dir / "frame-extraction.json", receipt)
        return receipt
    except Exception:
        _cleanup_owned_directory(root, destination)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        extract_frames(root=args.root, video_path=args.video, output_dir=args.out)
    except FrameExtractError as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
