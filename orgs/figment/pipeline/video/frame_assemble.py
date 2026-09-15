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
DERIVATIVE_SCHEMA = "figment/video-reel-derivative@1"
MANIFEST_SCHEMA = "figment/video-i2v-manifest@1"
CANDIDATE_MANIFEST_SCHEMA = "figment/video-review-candidate@1"
DIAGNOSTIC_MODE = "diagnostic"
CANDIDATE_MODE = "review-candidate-v1"
CANDIDATE_PREFIX = f"{CANDIDATE_MODE}-"
MAX_RECEIPT_BYTES = 1024 * 1024
MAX_TOTAL_FRAME_BYTES = 512 * 1024 * 1024
FRAME_COUNT = 81
FPS = 16
CANDIDATE_WIDTH = 1280
CANDIDATE_HEIGHT = 704
# F6: content/reel-templates.yaml's own "delivery" block -- the one template-fitting
# derivative this module produces from an already-assembled native movie.
REEL_WIDTH = 1080
REEL_HEIGHT = 1920
REEL_FPS = 30
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


def _manifest(value: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], bool]:
    jobs, budget = value.get("jobs"), value.get("frame_budget")
    diagnostic = (
        value.get("schema") == MANIFEST_SCHEMA
        and value.get("mode") == DIAGNOSTIC_MODE
        and value.get("not_promotable") is True
    )
    candidate = (
        value.get("schema") == CANDIDATE_MANIFEST_SCHEMA
        and value.get("mode") == CANDIDATE_MODE
        and value.get("lifecycle") == "unreviewed"
        and value.get("eligible_for_temporal_review") is True
        and "not_promotable" not in value
    )
    if not diagnostic and not candidate:
        raise FrameAssembleError(
            "manifest must be a diagnostic or unreviewed eligible review-candidate manifest"
        )
    if not isinstance(jobs, list) or len(jobs) != 1 or not isinstance(jobs[0], dict):
        raise FrameAssembleError("manifest must contain exactly one video image job")
    job = jobs[0]
    if job.get("expected_images") != FRAME_COUNT or not isinstance(job.get("output_name"), str) or not isinstance(job.get("seed"), int) or isinstance(job.get("seed"), bool):
        raise FrameAssembleError("manifest job is not the bounded 81-image video job")
    if not isinstance(budget, dict) or budget.get("frames") != FRAME_COUNT or budget.get("fps") != FPS or budget.get("batch_size") != 1:
        raise FrameAssembleError("manifest has the wrong video frame budget")
    if any(isinstance(budget.get(key), bool) or not isinstance(budget.get(key), int) or budget[key] <= 0 for key in ("width", "height")):
        raise FrameAssembleError("manifest has invalid frame dimensions")
    if candidate and (
        not isinstance(value.get("candidate_id"), str)
        or value["candidate_id"] != job["output_name"]
        or not job["output_name"].startswith(CANDIDATE_PREFIX)
        or budget.get("width") != CANDIDATE_WIDTH
        or budget.get("height") != CANDIDATE_HEIGHT
    ):
        raise FrameAssembleError("review candidate identity, native dimensions, and output namespace must agree")
    return job, budget, candidate


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


def _probe_fps(root: Path, relative: Path, label: str) -> Decimal:
    """The `avg_frame_rate` ffprobe alone reports, shared by the native-assembly probe
    and the reel-derivative probe below (the same 81-frame-video probe used twice, not
    forked)."""
    try:
        source = frames._within(root, relative, label)
        probe = frames._tool(frames.FFPROBE_PATH, "ffprobe")
        rate = frames._probe_json([probe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate", "-of", "json", str(source)], "ffprobe frame-rate probe")
        value = rate["streams"][0]["avg_frame_rate"]
        numerator, denominator = (int(part) for part in value.split("/", 1))
    except (frames.FrameExtractError, KeyError, IndexError, TypeError, ValueError) as exc:
        raise FrameAssembleError(f"ffprobe did not report a valid {label} frame rate") from exc
    if denominator <= 0:
        raise FrameAssembleError(f"ffprobe reported an invalid {label} frame rate")
    return Decimal(numerator) / Decimal(denominator)


def _probe_movie(root: Path, relative: Path) -> dict[str, Any]:
    try: metadata = frames._probe_video(root, relative)
    except frames.FrameExtractError as exc: raise _fail_from_frames(exc) from exc
    expected_duration = Decimal(FRAME_COUNT) / Decimal(FPS)
    observed = Decimal(metadata["duration_seconds"])
    if metadata["frame_count"] != FRAME_COUNT or abs(observed - expected_duration) > Decimal("0.01"):
        raise FrameAssembleError("assembled MP4 does not have exactly 81 frames at the expected duration")
    if _probe_fps(root, relative, "assembled MP4") != FPS:
        raise FrameAssembleError("assembled MP4 frame rate is not 16 fps")
    return metadata | {"fps": FPS, "expected_duration_seconds": str(expected_duration)}


def _probe_reel_derivative(root: Path, relative: Path, expected_duration: Decimal) -> dict[str, Any]:
    """Validate the ONE reel-fit transformation's own output: exactly
    `content/reel-templates.yaml`'s delivery spec (1080x1920 @30fps), and a duration
    that still matches the native movie's -- the `fps` filter resamples, it does not
    trim or loop, so wall-clock length is preserved even though the frame COUNT
    changes (81 @16fps -> ~152 @30fps for the same ~5.06s)."""
    try:
        metadata = frames._probe_video(root, relative)
    except frames.FrameExtractError as exc:
        raise _fail_from_frames(exc) from exc
    if metadata["width"] != REEL_WIDTH or metadata["height"] != REEL_HEIGHT:
        raise FrameAssembleError("reel derivative is not 1080x1920")
    observed = Decimal(metadata["duration_seconds"])
    if abs(observed - expected_duration) > Decimal("0.05"):
        raise FrameAssembleError("reel derivative duration does not match its native source")
    if _probe_fps(root, relative, "reel derivative MP4") != REEL_FPS:
        raise FrameAssembleError("reel derivative frame rate is not 30 fps")
    return metadata | {"fps": REEL_FPS}


def assemble_frames(*, root: Path, manifest_path: Path, run_receipt_path: Path, output_dir: Path) -> dict[str, Any]:
    try: root = frames._root(root)
    except frames.FrameExtractError as exc: raise _fail_from_frames(exc) from exc
    manifest, _, manifest_hash = _json(root, manifest_path, "manifest")
    run, run_path, run_hash = _json(root, run_receipt_path, "run receipt")
    job, budget, candidate = _manifest(manifest); files = _run_job(run, job)
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
        final = output_dir / ("candidate.mp4" if candidate else "diagnostic.mp4")
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
        receipt = {"schema": SCHEMA, "not_promotable": True, "provenance": "local review-candidate assembly evidence; no approval or temporal-quality claim" if candidate else "local diagnostic assembly; no identity, approval, temporal-quality, or production claim", "manifest": {"path": manifest_path.as_posix(), "sha256": manifest_hash}, "run_receipt": {"path": run_receipt_path.as_posix(), "sha256": run_hash, "binding": "output_name and seed only; PNG prompt metadata requires separate review" if candidate else "output_name and seed only; harness run.json has no executed-workflow hash"}, "frames": records, "movie": after, "metadata": metadata}
        if candidate:
            receipt["candidate"] = {"id": manifest["candidate_id"], "mode": CANDIDATE_MODE}
        frames._write_receipt(root, output_dir / "frame-assembly.json", receipt)
        return receipt
    except Exception:
        frames._cleanup_owned_directory(root, destination)
        raise


def build_reel_derivative(*, root: Path, assembly_receipt_path: Path, output_dir: Path) -> dict[str, Any]:
    """F6: the ONE transformation from an already-assembled native diagnostic/
    candidate movie (`assemble_frames`' own 81-frame receipt) to
    `content/reel-templates.yaml`'s own delivery spec (1080x1920 @30fps) -- a thin
    ffmpeg scale+pad+fps caller reusing `assemble_frames`' own containment, fresh-
    output, and before/after hash-stability discipline verbatim, never a second
    assembly path. The receipt records the native<->derivative correspondence: both
    movies' own sha256, the exact filter graph, and the native and derivative
    durations, so a downstream grader (`grade --stage video`) can prove the derivative
    really is this native movie's own reel-fit rendering."""
    try:
        root = frames._root(root)
    except frames.FrameExtractError as exc:
        raise _fail_from_frames(exc) from exc
    receipt, receipt_path, receipt_hash = _json(root, assembly_receipt_path, "frame-assembly receipt")
    if receipt.get("schema") != SCHEMA:
        raise FrameAssembleError("frame-assembly receipt has an unsupported schema")
    movie_entry = receipt.get("movie")
    native_metadata = receipt.get("metadata")
    if (not isinstance(movie_entry, dict) or not isinstance(movie_entry.get("path"), str)
            or not isinstance(native_metadata, dict)):
        raise FrameAssembleError("frame-assembly receipt has no assembled movie or metadata")
    # `movie_entry["path"]` is already root-relative (assemble_frames' own
    # `_hash_file(root, final, ...)` records it that way -- `final` there is built
    # from the caller's `output_dir`, itself root-relative), never receipt-dir-relative.
    native_relative = Path(movie_entry["path"])
    native = frames._hash_file(root, native_relative, "native assembled MP4", frames.MAX_VIDEO_BYTES)
    if native["bytes"] != movie_entry.get("bytes") or native["sha256"] != movie_entry.get("sha256"):
        raise FrameAssembleError("native assembled MP4 changed since its own frame-assembly receipt")
    try:
        expected_duration = Decimal(native_metadata["duration_seconds"])
    except Exception as exc:
        raise FrameAssembleError("frame-assembly receipt has an invalid native duration") from exc

    try:
        destination = frames._within(root, output_dir, "output directory", must_exist=False)
    except frames.FrameExtractError as exc:
        raise _fail_from_frames(exc) from exc
    if destination.exists():
        raise FrameAssembleError("output directory must be fresh")
    destination.mkdir()
    try:
        if frames._unsafe_link(destination) or not frames._real_below(root, destination):
            raise FrameAssembleError("output directory could not be created safely")
        partial = output_dir / f".reel-{uuid.uuid4().hex}.partial.mp4"
        final = output_dir / "reel.mp4"
        filter_graph = (
            f"scale=w={REEL_WIDTH}:h={REEL_HEIGHT}:force_original_aspect_ratio=decrease,"
            f"pad={REEL_WIDTH}:{REEL_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps={REEL_FPS}"
        )
        source = root / native_relative
        frames._run([
            frames._tool(frames.FFMPEG_PATH, "ffmpeg"), "-v", "error", "-i", str(source),
            "-vf", filter_graph, "-c:v", "libx264", "-pix_fmt", "yuv420p", str(root / partial),
        ], "ffmpeg reel derivative")
        after_native = frames._hash_file(root, native_relative, "native assembled MP4", frames.MAX_VIDEO_BYTES)
        if after_native["bytes"] != native["bytes"] or after_native["sha256"] != native["sha256"]:
            raise FrameAssembleError("native assembled MP4 changed during derivative rendering")
        derivative_metadata = _probe_reel_derivative(root, partial, expected_duration)
        before = frames._hash_file(root, partial, "reel derivative MP4", frames.MAX_VIDEO_BYTES)
        os.replace(root / partial, root / final)
        after = frames._hash_file(root, final, "reel derivative MP4", frames.MAX_VIDEO_BYTES)
        if before["bytes"] != after["bytes"] or before["sha256"] != after["sha256"]:
            raise FrameAssembleError("reel derivative MP4 changed while being finalized")
        receipt_out = {
            "schema": DERIVATIVE_SCHEMA,
            "not_promotable": receipt.get("not_promotable", True),
            "provenance": (
                "local reel-fit derivative of an already-assembled native movie; no "
                "identity, approval, temporal-quality, or production claim"
            ),
            "source_assembly": {"path": assembly_receipt_path.as_posix(), "sha256": receipt_hash},
            "correspondence": {
                "native": native,
                "derivative": after,
                "filter_graph": filter_graph,
                "native_duration_seconds": native_metadata["duration_seconds"],
                "derivative_duration_seconds": derivative_metadata["duration_seconds"],
            },
            "delivery_profile": {
                "width": REEL_WIDTH, "height": REEL_HEIGHT, "fps": REEL_FPS,
                "source": "content/reel-templates.yaml delivery",
            },
            "metadata": derivative_metadata,
        }
        if "candidate" in receipt:
            receipt_out["candidate"] = receipt["candidate"]
        frames._write_receipt(root, output_dir / "reel-derivative.json", receipt_out)
        return receipt_out
    except Exception:
        frames._cleanup_owned_directory(root, destination)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", nargs="?", choices=("assemble", "reel"), default="assemble",
        help="'assemble' (default, unchanged): native 81-frame MP4 from harness "
             "output. 'reel': the 1080x1920@30fps content/reel-templates.yaml "
             "derivative of an already-assembled native MP4 (F6).",
    )
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--manifest", type=Path, help="'assemble' only")
    parser.add_argument("--run-receipt", type=Path, help="'assemble' only")
    parser.add_argument("--assembly-receipt", type=Path, help="'reel' only")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "assemble":
            if args.manifest is None or args.run_receipt is None:
                parser.error("assemble requires --manifest and --run-receipt")
            assemble_frames(
                root=args.root, manifest_path=args.manifest,
                run_receipt_path=args.run_receipt, output_dir=args.out,
            )
        else:
            if args.assembly_receipt is None:
                parser.error("reel requires --assembly-receipt")
            build_reel_derivative(
                root=args.root, assembly_receipt_path=args.assembly_receipt,
                output_dir=args.out,
            )
    except FrameAssembleError as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__": raise SystemExit(main())
