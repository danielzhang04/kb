#!/usr/bin/env python3
"""Assemble one verified 81-PNG diagnostic sequence with installed FFmpeg only."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any


def _load_frame_helpers() -> Any:
    path = Path(__file__).with_name("frame_extract.py")
    spec = importlib.util.spec_from_file_location("figment_frame_extract_for_assembly", path)
    if spec is None or spec.loader is None: raise ImportError("frame extractor is required")
    module = importlib.util.module_from_spec(spec); sys.modules[spec.name] = module; spec.loader.exec_module(module)
    return module


frames = _load_frame_helpers()
SCHEMA = "figment/video-frame-assembly@1"
MANIFEST_SCHEMA = "figment/video-i2v-manifest@1"
MAX_RECEIPT_BYTES = 1024 * 1024
MAX_TOTAL_FRAME_BYTES = 512 * 1024 * 1024
FRAME_COUNT = 81
FPS = 16
MAX_JSON_DEPTH = 32
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class FrameAssembleError(ValueError):
    """Raised when local harness outputs cannot be assembled as diagnostic evidence."""


def _fail_from_frames(exc: Exception) -> FrameAssembleError:
    return FrameAssembleError(str(exc))


def _depth_ok(source: str) -> bool:
    depth = 0; quoted = escaped = False
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


def _json(root: Path, relative: Path, label: str) -> tuple[dict[str, Any], Path, str]:
    try:
        path = frames._within(root, relative, label)
        if not path.is_file() or path.stat().st_size > MAX_RECEIPT_BYTES:
            raise FrameAssembleError(f"{label} must be a regular JSON file no larger than {MAX_RECEIPT_BYTES} bytes")
        raw = path.read_bytes(); source = raw.decode("utf-8"); value = json.loads(source)
    except frames.FrameExtractError as exc: raise _fail_from_frames(exc) from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc: raise FrameAssembleError(f"cannot read {label} JSON") from exc
    if not _depth_ok(source) or not isinstance(value, dict): raise FrameAssembleError(f"{label} JSON must be a shallow object")
    return value, path, hashlib.sha256(raw).hexdigest()


def _manifest(value: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    jobs, budget = value.get("jobs"), value.get("frame_budget")
    if value.get("schema") != MANIFEST_SCHEMA or value.get("mode") != "diagnostic" or value.get("not_promotable") is not True:
        raise FrameAssembleError("manifest must be a non-promotable diagnostic I2V manifest")
    if not isinstance(jobs, list) or len(jobs) != 1 or not isinstance(jobs[0], dict):
        raise FrameAssembleError("manifest must contain exactly one video image job")
    job = jobs[0]
    if job.get("expected_images") != FRAME_COUNT or not isinstance(job.get("output_name"), str) or not isinstance(job.get("seed"), int) or isinstance(job.get("seed"), bool):
        raise FrameAssembleError("manifest job is not the bounded 81-image video job")
    if not isinstance(budget, dict) or budget.get("frames") != FRAME_COUNT or budget.get("fps") != FPS or budget.get("batch_size") != 1:
        raise FrameAssembleError("manifest has the wrong video frame budget")
    if any(isinstance(budget.get(key), bool) or not isinstance(budget.get(key), int) or budget[key] <= 0 for key in ("width", "height")):
        raise FrameAssembleError("manifest has invalid frame dimensions")
    return job, budget


def _run_job(value: dict[str, Any], job: dict[str, Any]) -> list[dict[str, Any]]:
    attempts = value.get("placement_attempts")
    if (value.get("schema") != "figment/runpod-run@1" or value.get("dry_run") is not False
            or value.get("termination_verified") is not True or value.get("error") is not None
            or not isinstance(value.get("pod_id"), str) or not value["pod_id"]
            or not isinstance(attempts, list) or not attempts
            or any(not isinstance(attempt, dict) or attempt.get("termination_verified") is not True for attempt in attempts)):
        raise FrameAssembleError("run receipt must be a successful terminated non-dry-run harness receipt")
    jobs = value.get("jobs")
    if not isinstance(jobs, list) or len(jobs) != 1 or not isinstance(jobs[0], dict):
        raise FrameAssembleError("run receipt must contain exactly one job")
    actual = jobs[0]
    if actual.get("job") != 1 or actual.get("output_name") != job["output_name"] or actual.get("seed") != job["seed"]:
        raise FrameAssembleError("run receipt does not bind to the manifest job output name and seed")
    files = actual.get("files")
    if not isinstance(files, list) or len(files) != FRAME_COUNT:
        raise FrameAssembleError("run receipt must list exactly 81 downloaded PNGs")
    expected = [f"{job['output_name']}_{index:02d}.png" for index in range(1, FRAME_COUNT + 1)]
    if any(not isinstance(item, dict) or item.get("path") != name or isinstance(item.get("bytes"), bool) or not isinstance(item.get("bytes"), int) or item["bytes"] <= 0 for item, name in zip(files, expected, strict=True)):
        raise FrameAssembleError("run receipt PNG files must use the ordered harness filename convention")
    return files


def _frame_records(root: Path, run_dir: Path, files: list[dict[str, Any]], budget: dict[str, Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    total = 0
    for index, item in enumerate(files, start=1):
        relative = run_dir / item["path"]
        try:
            record = frames._hash_file(root, relative, "downloaded frame", frames.MAX_FRAME_BYTES)
            frames._probe_frame(root, relative, budget["width"], budget["height"])
        except frames.FrameExtractError as exc: raise _fail_from_frames(exc) from exc
        if record["bytes"] != item["bytes"]:
            raise FrameAssembleError("downloaded frame bytes no longer match the run receipt")
        total += record["bytes"]
        if total > MAX_TOTAL_FRAME_BYTES: raise FrameAssembleError("downloaded frame total exceeds the diagnostic cap")
        record["index"] = index; records.append(record)
    return records


def _probe_movie(root: Path, relative: Path) -> dict[str, Any]:
    try: metadata = frames._probe_video(root, relative)
    except frames.FrameExtractError as exc: raise _fail_from_frames(exc) from exc
    expected_duration = Decimal(FRAME_COUNT) / Decimal(FPS)
    observed = Decimal(metadata["duration_seconds"])
    if metadata["frame_count"] != FRAME_COUNT or abs(observed - expected_duration) > Decimal("0.01"):
        raise FrameAssembleError("assembled MP4 does not have exactly 81 frames at the expected duration")
    try:
        source = frames._within(root, relative, "assembled MP4")
        probe = frames._tool(frames.FFPROBE_PATH, "ffprobe")
        rate = frames._probe_json([probe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate", "-of", "json", str(source)], "ffprobe frame-rate probe")
        value = rate["streams"][0]["avg_frame_rate"]
        numerator, denominator = (int(part) for part in value.split("/", 1))
    except (frames.FrameExtractError, KeyError, IndexError, TypeError, ValueError) as exc: raise FrameAssembleError("ffprobe did not report a valid assembled frame rate") from exc
    if denominator <= 0 or Decimal(numerator) / Decimal(denominator) != FPS:
        raise FrameAssembleError("assembled MP4 frame rate is not 16 fps")
    return metadata | {"fps": FPS, "expected_duration_seconds": str(expected_duration)}


def assemble_frames(*, root: Path, manifest_path: Path, run_receipt_path: Path, output_dir: Path) -> dict[str, Any]:
    try: root = frames._root(root)
    except frames.FrameExtractError as exc: raise _fail_from_frames(exc) from exc
    manifest, _, manifest_hash = _json(root, manifest_path, "manifest")
    run, run_path, run_hash = _json(root, run_receipt_path, "run receipt")
    job, budget = _manifest(manifest); files = _run_job(run, job)
    try:
        run_dir = run_path.parent.relative_to(root)
        destination = frames._within(root, output_dir, "output directory", must_exist=False)
    except (frames.FrameExtractError, ValueError) as exc: raise _fail_from_frames(exc) from exc
    if destination.exists(): raise FrameAssembleError("output directory must be fresh")
    records = _frame_records(root, run_dir, files, budget)
    try:
        destination.mkdir()
        if frames._unsafe_link(destination) or not frames._real_below(root, destination): raise FrameAssembleError("output directory could not be created safely")
        partial_name = f".video-{uuid.uuid4().hex}.partial.mp4"; partial = output_dir / partial_name
        final = output_dir / "diagnostic.mp4"
        pattern = root / run_dir / f"{job['output_name']}_%02d.png"
        frames._run([frames._tool(frames.FFMPEG_PATH, "ffmpeg"), "-v", "error", "-framerate", str(FPS), "-start_number", "1", "-i", str(pattern), "-frames:v", str(FRAME_COUNT), "-c:v", "libx264", "-pix_fmt", "yuv420p", str(root / partial)], "ffmpeg frame assembly")
        after_records = _frame_records(root, run_dir, files, budget)
        if any(before["bytes"] != after["bytes"] or before["sha256"] != after["sha256"] for before, after in zip(records, after_records, strict=True)):
            raise FrameAssembleError("downloaded frames changed during assembly")
        metadata = _probe_movie(root, partial)
        before = frames._hash_file(root, partial, "assembled MP4", frames.MAX_VIDEO_BYTES)
        os.replace(root / partial, root / final)
        after = frames._hash_file(root, final, "assembled MP4", frames.MAX_VIDEO_BYTES)
        if before["bytes"] != after["bytes"] or before["sha256"] != after["sha256"]: raise FrameAssembleError("assembled MP4 changed while being finalized")
        receipt = {"schema": SCHEMA, "not_promotable": True, "provenance": "local diagnostic assembly; no identity, approval, temporal-quality, or production claim", "manifest": {"path": manifest_path.as_posix(), "sha256": manifest_hash}, "run_receipt": {"path": run_receipt_path.as_posix(), "sha256": run_hash, "binding": "output_name and seed only; harness run.json has no executed-workflow hash"}, "frames": records, "movie": after, "metadata": metadata}
        frames._write_receipt(root, output_dir / "frame-assembly.json", receipt)
        return receipt
    except Exception:
        frames._cleanup_owned_directory(root, destination)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("--root", "--manifest", "--run-receipt", "--out"): parser.add_argument(flag, required=True, type=Path)
    args = parser.parse_args(argv)
    try: assemble_frames(root=args.root, manifest_path=args.manifest, run_receipt_path=args.run_receipt, output_dir=args.out)
    except FrameAssembleError as exc: parser.error(str(exc))
    return 0


if __name__ == "__main__": raise SystemExit(main())
