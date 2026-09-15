#!/usr/bin/env python3
"""Prepare and revalidate one immutable vertical-video delivery review subject."""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import math
import os
import re
import stat
import sys
import uuid
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from pathlib import Path
from typing import Any


EVALUATION_SCHEMA = "figment/video-delivery-evaluation-inputs@1"
KEY_SCHEMA = "figment/video-delivery-subject-key@1"
DECLARATION_SCHEMA = "figment/video-delivery-transform-declaration@1"
STATUS = "prepared"
REVIEW_PARENT = "video-delivery-review"
EVALUATION_NAME = "evaluation-inputs.json"
VALIDATE_PREFIX = ".validate-"
MAX_JSON_BYTES = 1024 * 1024
MAX_ENTRIES = 20_000
MAX_TEXT_CHARS = 64 * 1024
MAX_TEMPLATE_BYTES = 128 * 1024
MAX_TOOL_BYTES = 128 * 1024 * 1024
TARGET_WIDTH = 1080
TARGET_HEIGHT = 1920
TARGET_FRAMES = 152
TARGET_FPS = Fraction(30, 1)
SOURCE_WIDTH = 1280
SOURCE_HEIGHT = 704
SOURCE_FRAMES = 81
SOURCE_FPS = Fraction(16, 1)
TEMPLATE_SHA256 = "8c86642d5ed4de69b92fd84b7911a685d1cfe03cf226bc2f8ce2cdc9dd634cfe"
SHA256_RE = re.compile(r"[a-f0-9]{64}\Z")
ATTRIBUTION_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9@._-]{0,127}\Z")
TEMP_DIR_RE = re.compile(r"\.validate-[a-f0-9]{32}\Z")
EXTRACTOR_TEMP_RE = re.compile(r"\.(first|middle|last)\.[a-f0-9]{32}\.tmp\.png\Z")
LIMITATIONS = [
    "the transform is declared; this preparation does not prove full rendered transform correspondence",
    "native-video observations and acceptance are not delivery observations or delivery acceptance",
    "audio licensing, loudness, mix, synchronization, and template fit are unresolved",
    "prepared evidence is not delivery approval and is not promotable",
]


class VideoDeliveryReviewError(ValueError):
    """Raised when delivery-review evidence is unsafe, stale, or malformed."""


def _module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).resolve().parent
video_review = _module("figment_video_delivery_native_review", HERE / "video_review.py")
frames = video_review.frames
lineage = video_review.lineage
TEMPLATE_PATH = HERE.parent / "content" / "reel-templates.yaml"
FFMPEG_PATH = Path(r"C:\Users\danie\AppData\Local\Programs\Python\Python313\Scripts\ffmpeg.exe")
FFPROBE_PATH = Path(r"C:\Users\danie\AppData\Local\Programs\Python\Python313\Scripts\ffprobe.exe")
TOOL_PINS = {
    "ffmpeg": {
        "path": FFMPEG_PATH,
        "bytes": 99_264_000,
        "sha256": "5af82a0d4fe2b9eae211b967332ea97edfc51c6b328ca35b827e73eac560dc0d",
        "prefix": "ffmpeg version 8.0.1-essentials_build-www.gyan.dev ",
    },
    "ffprobe": {
        "path": FFPROBE_PATH,
        "bytes": 99_066_368,
        "sha256": "192a1d6899059765ac8c39764fc3148d4e6049955956dc2029f81f4bd6a8972d",
        "prefix": "ffprobe version 8.0.1-essentials_build-www.gyan.dev ",
    },
}


def _fail(message: str) -> VideoDeliveryReviewError:
    return VideoDeliveryReviewError(message)


def _exact(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise _fail(f"{label} must have the exact closed schema")
    return value


def _bounded(value: Any, label: str) -> None:
    entries = 0
    stack = [(value, 0)]
    while stack:
        current, depth = stack.pop()
        if depth > 32:
            raise _fail(f"{label} JSON is too deep")
        entries += 1
        if entries > MAX_ENTRIES:
            raise _fail(f"{label} JSON has too many entries")
        if current is None or isinstance(current, (bool, int)):
            continue
        if isinstance(current, float):
            if not math.isfinite(current):
                raise _fail(f"{label} JSON contains a non-finite number")
            continue
        if isinstance(current, str):
            if len(current) > MAX_TEXT_CHARS:
                raise _fail(f"{label} JSON text is too long")
            if any(0xD800 <= ord(character) <= 0xDFFF for character in current):
                raise _fail(f"{label} JSON text contains an unpaired surrogate")
            continue
        if isinstance(current, list):
            stack.extend((item, depth + 1) for item in current)
            continue
        if isinstance(current, dict):
            for key in current:
                if not isinstance(key, str) or len(key) > MAX_TEXT_CHARS:
                    raise _fail(f"{label} JSON has an invalid key")
                if any(0xD800 <= ord(character) <= 0xDFFF for character in key):
                    raise _fail(f"{label} JSON has a key with an unpaired surrogate")
            stack.extend((item, depth + 1) for item in current.values())
            continue
        raise _fail(f"{label} JSON contains an unsupported value")


def _canonical(value: Any, label: str) -> str:
    _bounded(value, label)
    return lineage.canonical_sha256(value)


def _same(actual: Any, expected: Any, label: str) -> None:
    if _canonical(actual, label) != _canonical(expected, label):
        raise _fail(f"{label} does not match current evidence")


def _digest(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise _fail(f"{label} must be a lowercase SHA-256 digest")
    return value


def _integer(value: Any, label: str, *, minimum: int = 0, maximum: int | None = None) -> int:
    if type(value) is not int or value < minimum or (maximum is not None and value > maximum):
        raise _fail(f"{label} must be a bounded integer")
    return value


def _probe_integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise _fail(f"probe returned invalid {label}")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise _fail(f"probe returned invalid {label}") from exc
    if str(parsed) != str(value).strip() and not (isinstance(value, int) and value == parsed):
        raise _fail(f"probe returned invalid {label}")
    return parsed


def _fraction(value: Any, label: str) -> Fraction:
    if not isinstance(value, str) or not value or len(value) > 64:
        raise _fail(f"probe returned invalid {label}")
    try:
        parsed = Fraction(value)
    except (ValueError, ZeroDivisionError) as exc:
        raise _fail(f"probe returned invalid {label}") from exc
    if parsed <= 0:
        raise _fail(f"probe returned invalid {label}")
    return parsed


def _decimal(value: Any, label: str) -> Decimal:
    if not isinstance(value, str) or not value or len(value) > 64:
        raise _fail(f"probe returned invalid {label}")
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise _fail(f"probe returned invalid {label}") from exc
    if not parsed.is_finite() or parsed <= 0 or parsed > frames.MAX_DURATION_SECONDS:
        raise _fail(f"probe returned invalid {label}")
    return parsed


def _lexical_relative(value: Path, label: str) -> Path:
    raw = os.fspath(value)
    relative = Path(raw)
    # Windows rooted-no-drive paths (for example ``\name``) are not absolute.
    if (
        not raw or relative.is_absolute() or relative.anchor or relative.drive or relative.root
        or not relative.parts or any(part in ("", ".", "..") or ":" in part for part in relative.parts)
    ):
        raise _fail(f"{label} must be a lexical relative path below --root")
    return relative


def _root(value: Path) -> Path:
    try:
        return frames._root(value)
    except frames.FrameExtractError as exc:
        raise _fail(str(exc)) from exc


def _within(root: Path, value: Path, label: str, *, must_exist: bool = True) -> tuple[Path, Path]:
    relative = _lexical_relative(value, label)
    try:
        return relative, frames._within(root, relative, label, must_exist=must_exist)
    except frames.FrameExtractError as exc:
        raise _fail(str(exc)) from exc


def _file_entry_shape(value: Any, label: str, *, positive: bool = True) -> dict[str, Any]:
    entry = _exact(value, {"path", "bytes", "sha256"}, label)
    if not isinstance(entry["path"], str) or not entry["path"]:
        raise _fail(f"{label} path is malformed")
    _lexical_relative(Path(entry["path"]), f"{label} path")
    _integer(entry["bytes"], f"{label} bytes", minimum=1 if positive else 0)
    _digest(entry["sha256"], f"{label} digest")
    return entry


def _hash_file(root: Path, relative: Path, label: str, maximum: int) -> dict[str, Any]:
    relative = _lexical_relative(relative, label)
    try:
        return frames._hash_file(root, relative, label, maximum)
    except frames.FrameExtractError as exc:
        raise _fail(str(exc)) from exc


def _read_json(root: Path, relative: Path, label: str) -> tuple[dict[str, Any], dict[str, Any]]:
    relative = _lexical_relative(relative, label)
    try:
        value, _, entry = video_review._read_json(root, relative, label)
    except video_review.VideoReviewError as exc:
        raise _fail(str(exc)) from exc
    return value, entry


def _identity(stat_result: os.stat_result) -> tuple[int, int]:
    return stat_result.st_dev, stat_result.st_ino


def _stable_identity(stat_result: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        stat_result.st_dev, stat_result.st_ino, stat_result.st_mode,
        stat_result.st_size, stat_result.st_mtime_ns,
    )


def _cross_api_identity(stat_result: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        stat.S_IFMT(stat_result.st_mode), stat_result.st_dev, stat_result.st_ino,
        stat_result.st_size, stat_result.st_mtime_ns,
    )


def _absolute_snapshot(path: Path, label: str, maximum: int) -> tuple[bytes, dict[str, Any]]:
    try:
        lexical = path.absolute()
        for component in (lexical, *lexical.parents):
            if frames._exists(component) and frames._unsafe_link(component):
                raise _fail(f"{label} may not be a symlink, junction, or reparse point")
        before = frames._stat(lexical)
        if not stat.S_ISREG(before.st_mode) or before.st_size <= 0 or before.st_size > maximum:
            raise _fail(f"{label} must be a bounded regular file")
        digest = hashlib.sha256()
        raw = bytearray()
        with frames._open(lexical, "rb") as handle:
            opened = os.fstat(handle.fileno())
            while chunk := handle.read(1024 * 1024):
                raw.extend(chunk)
                if len(raw) > maximum:
                    raise _fail(f"{label} must be a bounded regular file")
                digest.update(chunk)
            finished = os.fstat(handle.fileno())
        after = frames._stat(lexical)
        if frames._unsafe_link(lexical) or not (
            _cross_api_identity(before) == _cross_api_identity(opened)
            == _cross_api_identity(finished) == _cross_api_identity(after)
            and _stable_identity(before) == _stable_identity(after)
            and _stable_identity(opened) == _stable_identity(finished)
        ) or len(raw) != before.st_size:
            raise _fail(f"{label} changed while being read")
        resolved = frames._resolved(lexical)
    except VideoDeliveryReviewError:
        raise
    except OSError as exc:
        raise _fail(f"cannot read {label}") from exc
    return bytes(raw), {
        "path": resolved.as_posix(), "bytes": len(raw), "sha256": digest.hexdigest(),
    }


def _snapshot_tool(name: str) -> dict[str, Any]:
    pin = TOOL_PINS[name]
    raw, entry = _absolute_snapshot(pin["path"], f"trusted {name} binary", MAX_TOOL_BYTES)
    del raw
    if entry["bytes"] != pin["bytes"] or entry["sha256"] != pin["sha256"]:
        raise _fail(f"trusted {name} binary does not match its reviewed pin")
    try:
        result = frames._run(
            [str(pin["path"]), "-version"], f"{name} version probe", stdout_limit=4096,
        )
        output = result.stdout.decode("utf-8")
    except frames.FrameExtractError as exc:
        raise _fail(str(exc)) from exc
    except UnicodeError as exc:
        raise _fail(f"{name} version output is not UTF-8") from exc
    lines = output.splitlines()
    if not lines or not lines[0].startswith(pin["prefix"]) or len(lines[0]) > 4096:
        raise _fail(f"trusted {name} version does not match its reviewed pin")
    return {**entry, "version": lines[0]}


def _snapshot_tools() -> dict[str, Any]:
    return {"ffmpeg": _snapshot_tool("ffmpeg"), "ffprobe": _snapshot_tool("ffprobe")}


def _template_row(row: Any) -> dict[str, Any]:
    base = {"id", "name", "length_seconds", "hook", "cuts", "audio", "text_overlay", "cta", "max_hashtags"}
    current = _exact(row, base | ({"audio_note"} if isinstance(row, dict) and "audio_note" in row else set()), "reel template row")
    for key in base - {"length_seconds", "max_hashtags"}:
        if not isinstance(current[key], str) or not current[key] or len(current[key]) > 512 or any(ord(char) < 32 for char in current[key]):
            raise _fail(f"reel template {key} is malformed")
    if "audio_note" in current and (not isinstance(current["audio_note"], str) or not current["audio_note"] or len(current["audio_note"]) > 512):
        raise _fail("reel template audio_note is malformed")
    lengths = current["length_seconds"]
    if not isinstance(lengths, list) or len(lengths) != 2:
        raise _fail("reel template length_seconds is malformed")
    low = _integer(lengths[0], "reel template minimum duration", minimum=1, maximum=60)
    high = _integer(lengths[1], "reel template maximum duration", minimum=low, maximum=60)
    _integer(current["max_hashtags"], "reel template max_hashtags", minimum=0, maximum=5)
    return copy.deepcopy(current)


def _snapshot_template(template_id: str) -> dict[str, Any]:
    if not isinstance(template_id, str) or not re.fullmatch(r"RT-[1-9][0-9]{0,2}", template_id):
        raise _fail("template_id must be an explicit bounded RT id")
    raw, entry = _absolute_snapshot(TEMPLATE_PATH, "fixed reel template source", MAX_TEMPLATE_BYTES)
    if entry["sha256"] != TEMPLATE_SHA256:
        raise _fail("fixed reel template source does not match its reviewed pin")
    try:
        value = json.loads(raw.decode("utf-8"), parse_constant=lambda token: (_ for _ in ()).throw(ValueError(token)))
    except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise _fail("fixed reel template source is malformed") from exc
    _bounded(value, "fixed reel template source")
    source = _exact(value, {"source", "delivery", "caption_policy", "rules", "templates"}, "fixed reel template source")
    delivery = _exact(source["delivery"], {"aspect", "width", "height", "fps", "audio_lufs", "burned_captions"}, "reel delivery target")
    if delivery != {"aspect": "9:16", "width": 1080, "height": 1920, "fps": 30, "audio_lufs": -14, "burned_captions": False}:
        raise _fail("fixed reel template source has an unsupported delivery target")
    _exact(source["caption_policy"], {"max_hashtags", "hashtag_style"}, "reel caption policy")
    _exact(source["rules"], {"no_build_up_frames", "loop_cleanly_ids"}, "reel template rules")
    rows = source["templates"]
    if not isinstance(rows, list) or not rows or len(rows) > 64:
        raise _fail("fixed reel template source has malformed rows")
    normalized = [_template_row(row) for row in rows]
    ids = [row["id"] for row in normalized]
    if len(set(ids)) != len(ids) or ids.count(template_id) != 1:
        raise _fail("template_id does not select exactly one current reel template")
    row = normalized[ids.index(template_id)]
    return {
        "id": template_id,
        "file": entry,
        "file_sha256": entry["sha256"],
        "row": row,
        "row_sha256": _canonical(row, "selected reel template row"),
    }


def _attribution(value: Any) -> str:
    if not isinstance(value, str):
        raise _fail("declared_by must be a bounded plain identifier")
    normalized = value.strip()
    if not ATTRIBUTION_RE.fullmatch(normalized):
        raise _fail("declared_by must be a bounded plain identifier")
    return normalized


def _timestamp(value: Any) -> str:
    try:
        return video_review._timestamp(value)
    except video_review.VideoReviewError as exc:
        raise _fail(str(exc).replace("decided_at", "declared_at")) from exc


def _normalize_declaration(value: Any) -> dict[str, Any]:
    declaration = _exact(value, {
        "schema", "accepted_lineage_sha256", "source_movie_sha256", "derivative_sha256",
        "template_id", "spatial", "temporal", "audio", "declared_by", "declared_at",
    }, "transform declaration")
    if declaration["schema"] != DECLARATION_SCHEMA:
        raise _fail("transform declaration schema is unsupported")
    spatial = _exact(declaration["spatial"], {"method", "source_rect", "target"}, "transform spatial declaration")
    rectangle = _exact(spatial["source_rect"], {"x", "y", "width", "height"}, "transform source rectangle")
    target = _exact(spatial["target"], {"width", "height"}, "transform target")
    x = _integer(rectangle["x"], "source_rect.x")
    y = _integer(rectangle["y"], "source_rect.y")
    width = _integer(rectangle["width"], "source_rect.width", minimum=1)
    height = _integer(rectangle["height"], "source_rect.height", minimum=1)
    if x + width > SOURCE_WIDTH or y + height > SOURCE_HEIGHT or width * 16 != height * 9:
        raise _fail("transform source rectangle is outside the native source or is not 9:16")
    target_width = _integer(target["width"], "target.width", minimum=1)
    target_height = _integer(target["height"], "target.height", minimum=1)
    if spatial["method"] != "crop-scale-lanczos-v1" or (target_width, target_height) != (TARGET_WIDTH, TARGET_HEIGHT):
        raise _fail("transform spatial declaration is unsupported")
    temporal = _exact(declaration["temporal"], {"method", "source_frames", "source_fps", "target_frames", "target_fps"}, "transform temporal declaration")
    source_frames = _integer(temporal["source_frames"], "temporal.source_frames", minimum=1)
    target_frames = _integer(temporal["target_frames"], "temporal.target_frames", minimum=1)
    expected_temporal = {
        "method": "hold-last-sample-30fps-v1", "source_frames": SOURCE_FRAMES,
        "source_fps": "16/1", "target_frames": TARGET_FRAMES, "target_fps": "30/1",
    }
    if temporal != expected_temporal or source_frames != SOURCE_FRAMES or target_frames != TARGET_FRAMES:
        raise _fail("transform temporal declaration is unsupported")
    audio = _exact(declaration["audio"], {"state"}, "transform audio declaration")
    if not isinstance(audio["state"], str) or audio["state"] not in {"absent", "present"}:
        raise _fail("transform audio state is unsupported")
    return {
        "schema": DECLARATION_SCHEMA,
        "accepted_lineage_sha256": _digest(declaration["accepted_lineage_sha256"], "declared accepted lineage digest"),
        "source_movie_sha256": _digest(declaration["source_movie_sha256"], "declared source movie digest"),
        "derivative_sha256": _digest(declaration["derivative_sha256"], "declared derivative digest"),
        "template_id": declaration["template_id"],
        "spatial": {
            "method": "crop-scale-lanczos-v1",
            "source_rect": {"x": x, "y": y, "width": width, "height": height},
            "target": {"width": TARGET_WIDTH, "height": TARGET_HEIGHT},
        },
        "temporal": expected_temporal,
        "audio": {"state": audio["state"]},
        "declared_by": _attribution(declaration["declared_by"]),
        "declared_at": _timestamp(declaration["declared_at"]),
    }


def _declaration_snapshot(root: Path, relative: Path) -> dict[str, Any]:
    value, entry = _read_json(root, relative, "transform declaration")
    return {"entry": entry, "value": _normalize_declaration(value)}


def _native_projection(value: Any) -> dict[str, Any]:
    projection = _exact(value, {"creator_id", "candidate_id", "movie", "approved_still", "candidate_manifest", "accepted_lineage"}, "accepted native video projection")
    if not isinstance(projection["creator_id"], str) or not projection["creator_id"] or not isinstance(projection["candidate_id"], str) or not projection["candidate_id"]:
        raise _fail("accepted native video projection has malformed identifiers")
    for key in ("movie", "approved_still", "candidate_manifest", "accepted_lineage"):
        _file_entry_shape(projection[key], f"accepted native video {key}")
    return copy.deepcopy(projection)


def _validate_native(root: Path, accepted_video_path: Path) -> dict[str, Any]:
    accepted_video_path = _lexical_relative(accepted_video_path, "accepted video")
    try:
        return _native_projection(video_review.validate_accepted_video(root, accepted_video_path))
    except video_review.VideoReviewError as exc:
        raise _fail(str(exc)) from exc


def _probe_metadata(root: Path, derivative: Path) -> dict[str, Any]:
    _, source = _within(root, derivative, "derivative")
    try:
        probe = frames._tool(FFPROBE_PATH, "ffprobe")
        return frames._probe_json([
            probe, "-v", "error", "-show_entries",
            "stream=index,codec_type,codec_name,width,height,pix_fmt,sample_aspect_ratio,avg_frame_rate,time_base,duration_ts,sample_rate,channels,channel_layout:stream_tags=rotate:stream_side_data=rotation:format=duration",
            "-of", "json", str(source),
        ], "ffprobe delivery stream probe")
    except frames.FrameExtractError as exc:
        raise _fail(str(exc)) from exc


def _probe_timestamps(root: Path, derivative: Path) -> dict[str, Any]:
    _, source = _within(root, derivative, "derivative")
    try:
        probe = frames._tool(FFPROBE_PATH, "ffprobe")
        return frames._probe_json([
            probe, "-v", "error", "-select_streams", "v:0",
            "-show_frames", "-show_entries", "frame=best_effort_timestamp:frame_side_data=",
            "-of", "json", str(source),
        ], "ffprobe delivery timestamp probe")
    except frames.FrameExtractError as exc:
        raise _fail(str(exc)) from exc


def _rotation(stream: dict[str, Any]) -> int:
    observed: list[Any] = []
    tags = stream.get("tags")
    if tags is not None:
        if not isinstance(tags, dict):
            raise _fail("video rotation tags must be a mapping")
        if tags:
            tags = _exact(tags, {"rotate"}, "video rotation tags")
            observed.append(tags["rotate"])
    side_data = stream.get("side_data_list")
    if side_data is not None:
        if not isinstance(side_data, list) or len(side_data) > 8 or any(not isinstance(item, dict) for item in side_data):
            raise _fail("video display-matrix rotation is malformed")
        observed.extend(item["rotation"] for item in side_data if "rotation" in item)
        if any(set(item) - {"rotation"} for item in side_data):
            raise _fail("video display-matrix rotation is malformed")
    for value in observed:
        try:
            parsed = Decimal(str(value))
        except InvalidOperation as exc:
            raise _fail("video rotation must be numeric zero") from exc
        if not parsed.is_finite() or parsed != 0:
            raise _fail("video rotation must be numeric zero")
    return 0


def _template_duration_bounds(template: dict[str, Any]) -> tuple[Fraction, Fraction]:
    lengths = template["row"]["length_seconds"]
    return Fraction(lengths[0], 1), Fraction(lengths[1], 1)


def _technical_snapshot(root: Path, derivative: Path, template: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    derivative = _lexical_relative(derivative, "derivative")
    if derivative.suffix.lower() != ".mp4":
        raise _fail("derivative must be an .mp4 file")
    initial_file = _hash_file(root, derivative, "derivative", frames.MAX_VIDEO_BYTES)
    metadata = _probe_metadata(root, derivative)
    after_metadata = _hash_file(root, derivative, "derivative", frames.MAX_VIDEO_BYTES)
    _same(after_metadata, initial_file, "derivative after stream probe")
    timestamps_value = _probe_timestamps(root, derivative)
    after_timestamps = _hash_file(root, derivative, "derivative", frames.MAX_VIDEO_BYTES)
    _same(after_timestamps, initial_file, "derivative after timestamp probe")
    _bounded(metadata, "derivative stream metadata")
    _bounded(timestamps_value, "derivative timestamps")
    optional_empty_keys = {"programs", "stream_groups"}
    present_keys = set(metadata)
    if (
        not {"streams", "format"} <= present_keys
        or present_keys - {"streams", "format"} - optional_empty_keys
        or not isinstance(metadata["streams"], list) or not isinstance(metadata["format"], dict)
    ):
        raise _fail("ffprobe returned malformed derivative stream metadata")
    for optional_key in optional_empty_keys:
        if optional_key in metadata and metadata[optional_key] != []:
            raise _fail(f"ffprobe returned an unsupported non-empty {optional_key} list")
    streams = metadata["streams"]
    if not streams or len(streams) > 2 or any(not isinstance(item, dict) for item in streams):
        raise _fail("derivative stream inventory is unsupported")
    indices: set[int] = set()
    videos: list[dict[str, Any]] = []
    audios: list[dict[str, Any]] = []
    for stream in streams:
        index = _integer(stream.get("index"), "stream index", minimum=0)
        if index in indices:
            raise _fail("derivative stream inventory contains duplicate streams")
        indices.add(index)
        kind = stream.get("codec_type")
        if kind == "video":
            videos.append(stream)
        elif kind == "audio":
            audios.append(stream)
        else:
            raise _fail("derivative stream inventory contains an unknown stream type")
    if len(videos) != 1 or len(audios) > 1:
        raise _fail("derivative must contain exactly one video and no more than one audio stream")
    video = videos[0]
    if (
        video.get("codec_name") != "h264" or video.get("pix_fmt") != "yuv420p"
        or _integer(video.get("width"), "video width", minimum=1) != TARGET_WIDTH
        or _integer(video.get("height"), "video height", minimum=1) != TARGET_HEIGHT
        or video.get("sample_aspect_ratio") != "1:1"
    ):
        raise _fail("derivative video stream does not match the fixed delivery format")
    avg_rate_raw = video.get("avg_frame_rate")
    time_base_raw = video.get("time_base")
    avg_rate = _fraction(avg_rate_raw, "average frame rate")
    time_base = _fraction(time_base_raw, "time base")
    duration_ticks = _probe_integer(video.get("duration_ts"), "duration ticks")
    if duration_ticks <= 0:
        raise _fail("probe returned invalid duration ticks")
    rotation = _rotation(video)
    if set(metadata["format"]) != {"duration"}:
        raise _fail("ffprobe returned malformed container metadata")
    container_duration = _decimal(metadata["format"].get("duration"), "container duration")
    if set(timestamps_value) != {"frames"} or not isinstance(timestamps_value["frames"], list):
        raise _fail("ffprobe returned malformed presentation timestamps")
    rows = timestamps_value["frames"]
    if len(rows) != TARGET_FRAMES or len(rows) > frames.MAX_FRAME_COUNT:
        raise _fail("derivative does not contain exactly 152 decoded video timestamps")
    timestamps: list[int] = []
    for row in rows:
        if not isinstance(row, dict) or set(row) not in (
            {"best_effort_timestamp"}, {"best_effort_timestamp", "side_data_list"},
        ):
            raise _fail("ffprobe returned a missing or malformed presentation timestamp")
        if "side_data_list" in row:
            side_data = row["side_data_list"]
            if (
                not isinstance(side_data, list) or len(side_data) > 8
                or any(not isinstance(item, dict) or item for item in side_data)
            ):
                raise _fail("ffprobe returned unexpected presentation-frame side data")
        timestamps.append(_probe_integer(row["best_effort_timestamp"], "presentation timestamp"))
    if timestamps[0] != 0:
        raise _fail("derivative presentation timestamps must begin at zero")
    deltas = [right - left for left, right in zip(timestamps, timestamps[1:])]
    if not deltas or deltas[0] <= 0 or any(delta != deltas[0] for delta in deltas):
        raise _fail("derivative presentation timestamps are not a constant increasing cadence")
    step = deltas[0]
    exact_duration = Fraction(TARGET_FRAMES, 30)
    low, high = _template_duration_bounds(template)
    if (
        avg_rate != TARGET_FPS
        or step * time_base != Fraction(1, 30)
        or duration_ticks * time_base != exact_duration
        or timestamps[-1] - timestamps[0] + step != duration_ticks
        or not low <= exact_duration <= high
    ):
        raise _fail("derivative cadence or selected template duration is unsupported")
    audio_projection: list[dict[str, Any]] = []
    for audio in audios:
        codec = audio.get("codec_name")
        if not isinstance(codec, str) or not codec or len(codec) > 64:
            raise _fail("audio stream codec is malformed")
        projected: dict[str, Any] = {"index": audio["index"], "codec_name": codec}
        if "sample_rate" in audio:
            sample_rate = _probe_integer(audio["sample_rate"], "audio sample rate")
            if sample_rate <= 0 or sample_rate > 384_000:
                raise _fail("audio sample rate is outside its bound")
            projected["sample_rate"] = str(audio["sample_rate"])
        if "channels" in audio:
            projected["channels"] = _integer(audio["channels"], "audio channels", minimum=1, maximum=64)
        if "channel_layout" in audio:
            layout = audio["channel_layout"]
            if not isinstance(layout, str) or not layout or len(layout) > 128 or any(ord(char) < 32 for char in layout):
                raise _fail("audio channel layout is malformed")
            projected["channel_layout"] = layout
        audio_projection.append(projected)
    technical = {
        "file": initial_file,
        "video": {
            "codec": "h264", "pixel_format": "yuv420p", "width": TARGET_WIDTH,
            "height": TARGET_HEIGHT, "sample_aspect_ratio": "1:1", "rotation_degrees": rotation,
        },
        "presentation_cadence": {
            "kind": "constant", "fps": "30/1", "frame_count": TARGET_FRAMES,
            "time_base": time_base_raw, "first_timestamp": timestamps[0],
            "step_ticks": step, "last_timestamp": timestamps[-1],
            "duration_ticks": duration_ticks, "duration_seconds": "76/15",
        },
        "container_duration_seconds": str(metadata["format"]["duration"]),
        "audio_streams": audio_projection,
    }
    return technical, initial_file


def _cross_bind(declaration: dict[str, Any], native: dict[str, Any], derivative: dict[str, Any], template: dict[str, Any]) -> None:
    if (
        declaration["accepted_lineage_sha256"] != native["accepted_lineage"]["sha256"]
        or declaration["source_movie_sha256"] != native["movie"]["sha256"]
        or declaration["derivative_sha256"] != derivative["file"]["sha256"]
        or declaration["template_id"] != template["id"]
    ):
        raise _fail("transform declaration does not bind the current authority and media")
    expected_audio = "present" if declaration["audio"]["state"] == "present" else "absent"
    actual_audio = "present" if derivative.get("audio_streams") else "absent"
    if expected_audio != actual_audio:
        raise _fail("transform audio declaration does not match the observed stream inventory")


def _identity_value(native: dict[str, Any], derivative: dict[str, Any], template: dict[str, Any], declaration: dict[str, Any], tools: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": KEY_SCHEMA,
        "accepted_lineage_sha256": native["accepted_lineage"]["sha256"],
        "source_movie_sha256": native["movie"]["sha256"],
        "derivative_sha256": derivative["sha256"],
        "template_id": template["id"],
        "template_file_sha256": template["file_sha256"],
        "template_row_sha256": template["row_sha256"],
        "transform_declaration_sha256": declaration["entry"]["sha256"],
        "ffmpeg_sha256": tools["ffmpeg"]["sha256"],
        "ffprobe_sha256": tools["ffprobe"]["sha256"],
    }


def _extraction_projection(root: Path, receipt_relative: Path, derivative: dict[str, Any]) -> dict[str, Any]:
    receipt_relative = _lexical_relative(receipt_relative, "frame extraction receipt")
    value, receipt_entry = _read_json(root, receipt_relative, "frame extraction receipt")
    receipt = _exact(value, {"schema", "provenance", "not_promotable", "video_before", "video_after", "metadata", "frames"}, "frame extraction receipt")
    if (
        receipt["schema"] != frames.SCHEMA or receipt["not_promotable"] is not True
        or receipt["provenance"] != "frames extracted locally from the hash-pinned video bytes; no identity, temporal-quality, or approval claim"
    ):
        raise _fail("frame extraction receipt is not the trusted non-promotable extractor record")
    _same(receipt["video_before"], derivative, "extraction video before")
    _same(receipt["video_after"], derivative, "extraction video after")
    try:
        current_metadata = frames._probe_video(root, Path(derivative["path"]))
    except frames.FrameExtractError as exc:
        raise _fail(str(exc)) from exc
    after_probe = _hash_file(root, Path(derivative["path"]), "derivative", frames.MAX_VIDEO_BYTES)
    _same(after_probe, derivative, "derivative after extractor metadata probe")
    _same(receipt["metadata"], current_metadata, "frame extraction metadata")
    expected = (("first", 0), ("middle", 76), ("last", 151))
    rows = receipt["frames"]
    if not isinstance(rows, list) or len(rows) != len(expected):
        raise _fail("frame extraction receipt must contain first, middle, and last samples")
    samples: list[dict[str, Any]] = []
    for row, (label, index) in zip(rows, expected, strict=True):
        row = _exact(row, {"path", "bytes", "sha256", "label", "index"}, f"{label} extracted sample")
        if (
            not isinstance(row["path"], str) or not row["path"]
            or row["label"] != label
            or type(row["index"]) is not int or row["index"] != index
            or Path(row["path"]) != receipt_relative.parent / f"{label}.png"
        ):
            raise _fail(f"{label} extracted sample is malformed")
        _lexical_relative(Path(row["path"]), f"{label} extracted sample path")
        _integer(row["bytes"], f"{label} extracted sample bytes", minimum=1)
        _digest(row["sha256"], f"{label} extracted sample digest")
        current = _hash_file(root, Path(row["path"]), f"{label} extracted sample", frames.MAX_FRAME_BYTES)
        _same(current, {key: row[key] for key in ("path", "bytes", "sha256")}, f"{label} extracted sample")
        try:
            frames._probe_frame(root, Path(row["path"]), TARGET_WIDTH, TARGET_HEIGHT)
        except frames.FrameExtractError as exc:
            raise _fail(str(exc)) from exc
        samples.append({**current, "label": label, "index": index})
    return {
        "receipt": receipt_entry,
        "video_before": copy.deepcopy(receipt["video_before"]),
        "video_after": copy.deepcopy(receipt["video_after"]),
        "metadata": copy.deepcopy(receipt["metadata"]),
        "samples": samples,
    }


def _pathless_extraction(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "video_before": {key: value["video_before"][key] for key in ("bytes", "sha256")},
        "video_after": {key: value["video_after"][key] for key in ("bytes", "sha256")},
        "metadata": copy.deepcopy(value["metadata"]),
        "samples": [
            {key: row[key] for key in ("label", "index", "bytes", "sha256")}
            for row in value["samples"]
        ],
    }


def _subject(identity_value: dict[str, Any], native: dict[str, Any], template: dict[str, Any], declaration: dict[str, Any], tools: dict[str, Any], derivative: dict[str, Any], extraction: dict[str, Any]) -> dict[str, Any]:
    identity_sha256 = _canonical(identity_value, "delivery subject identity")
    return {
        "identity": {"value": copy.deepcopy(identity_value), "sha256": identity_sha256},
        "native_authority": copy.deepcopy(native),
        "template": copy.deepcopy(template),
        "transform_declaration": copy.deepcopy(declaration),
        "tools": copy.deepcopy(tools),
        "derivative": copy.deepcopy(derivative),
        "extraction": copy.deepcopy(extraction),
        "limitations": list(LIMITATIONS),
    }


def _json_bytes(value: dict[str, Any], label: str) -> bytes:
    _bounded(value, label)
    raw = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")
    if len(raw) > MAX_JSON_BYTES:
        raise _fail(f"{label} exceeds the bounded JSON output limit")
    return raw


def _sync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(frames._os_path(path), os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _capture_directory(path: Path, label: str) -> tuple[int, int]:
    try:
        current = frames._lstat(path)
    except OSError as exc:
        raise _fail(f"cannot capture {label} ownership") from exc
    if not stat.S_ISDIR(current.st_mode) or frames._unsafe_link(path):
        raise _fail(f"{label} is not an owned real directory")
    return _identity(current)


def _capture_file(path: Path, label: str) -> tuple[int, int]:
    try:
        current = frames._lstat(path)
    except OSError as exc:
        raise _fail(f"cannot capture {label} ownership") from exc
    if not stat.S_ISREG(current.st_mode) or frames._unsafe_link(path):
        raise _fail(f"{label} is not an owned regular file")
    return _identity(current)


def _capture_samples(path: Path) -> tuple[tuple[int, int], dict[str, tuple[int, int]]]:
    directory_identity = _capture_directory(path, "extracted samples directory")
    allowed = {"first.png", "middle.png", "last.png", "frame-extraction.json"}
    try:
        with os.scandir(frames._os_path(path)) as entries:
            names = {entry.name for entry in entries}
    except OSError as exc:
        raise _fail("cannot inspect extracted samples ownership") from exc
    if names != allowed:
        raise _fail("extracted samples directory has an unexpected owned-name inventory")
    return directory_identity, {name: _capture_file(path / name, f"extracted sample {name}") for name in sorted(allowed)}


def _capture_partial_samples(path: Path) -> tuple[tuple[int, int] | None, dict[str, tuple[int, int]]]:
    """Capture only a trusted extractor's closed partial inventory after cooperative failure."""
    if not frames._exists(path) and not frames._unsafe_link(path):
        return None, {}
    directory_identity = _capture_directory(path, "partial extracted samples directory")
    final_names = {"first.png", "middle.png", "last.png", "frame-extraction.json"}
    try:
        with os.scandir(frames._os_path(path)) as entries:
            names = {entry.name for entry in entries}
    except OSError as exc:
        raise _fail("cannot inspect partial extracted samples ownership") from exc
    if len(names) > 8 or any(name not in final_names and not EXTRACTOR_TEMP_RE.fullmatch(name) for name in names):
        raise _fail("partial extracted samples directory has an unexpected owned-name inventory")
    captured = {name: _capture_file(path / name, f"partial extracted sample {name}") for name in sorted(names)}
    if not _matches(path, directory_identity, directory=True):
        raise _fail("partial extracted samples directory changed during ownership capture")
    try:
        with os.scandir(frames._os_path(path)) as entries:
            final_names_seen = {entry.name for entry in entries}
    except OSError as exc:
        raise _fail("cannot recheck partial extracted samples ownership") from exc
    if final_names_seen != names or any(not _matches(path / name, captured[name], directory=False) for name in names):
        raise _fail("partial extracted samples changed during ownership capture")
    return directory_identity, captured


def _matches(path: Path, identity: tuple[int, int], *, directory: bool) -> bool:
    try:
        current = frames._lstat(path)
    except OSError:
        return False
    expected_type = stat.S_ISDIR if directory else stat.S_ISREG
    return expected_type(current.st_mode) and not frames._unsafe_link(path) and _identity(current) == identity


def _remove_owned_tree(root: Path, directory: Path, directory_identity: tuple[int, int], sample_identity: tuple[int, int] | None, file_identities: dict[str, tuple[int, int]]) -> bool:
    """Remove only captured entries from one invocation; preserve every surprise."""
    try:
        relative = directory.relative_to(root)
        checked = frames._within(root, relative, "owned delivery review directory")
        if checked != directory or not _matches(directory, directory_identity, directory=True):
            return False
        with os.scandir(frames._os_path(directory)) as entries:
            names = {entry.name for entry in entries}
        allowed = {name for name in file_identities if not name.startswith("samples/")}
        if sample_identity is not None:
            allowed.add("samples")
        if not names <= allowed:
            return False
        # Complete the entire identity/type/inventory preflight before the first unlink.
        top_names = names - {"samples"}
        for name in top_names:
            identity = file_identities.get(name)
            if identity is None or not _matches(directory / name, identity, directory=False):
                return False
        sample_names: set[str] = set()
        if "samples" in names:
            samples = directory / "samples"
            if sample_identity is None or not _matches(samples, sample_identity, directory=True):
                return False
            with os.scandir(frames._os_path(samples)) as entries:
                sample_names = {entry.name for entry in entries}
            expected_sample_names = {name.removeprefix("samples/") for name in file_identities if name.startswith("samples/")}
            if not sample_names <= expected_sample_names:
                return False
            for name in sorted(sample_names):
                identity = file_identities.get(f"samples/{name}")
                path = samples / name
                if identity is None or not _matches(path, identity, directory=False):
                    return False
        # Mutation begins only after every current entry passed the preflight above.
        if "samples" in names:
            samples = directory / "samples"
            for name in sorted(sample_names):
                path = samples / name
                identity = file_identities[f"samples/{name}"]
                if not _matches(path, identity, directory=False):
                    return False
                os.unlink(frames._os_path(path))
            if not _matches(samples, sample_identity, directory=True):
                return False
            os.rmdir(frames._os_path(samples))
        for name in sorted(top_names):
            path = directory / name
            identity = file_identities[name]
            if not _matches(path, identity, directory=False):
                return False
            os.unlink(frames._os_path(path))
        if not _matches(directory, directory_identity, directory=True):
            return False
        os.rmdir(frames._os_path(directory))
        return not frames._exists(directory) and not frames._unsafe_link(directory)
    except (OSError, frames.FrameExtractError, ValueError):
        return False


def _remove_owned_parent(root: Path, parent: Path, identity: tuple[int, int] | None) -> bool:
    if identity is None:
        return True
    try:
        checked = frames._within(root, parent.relative_to(root), "owned review parent")
        if checked != parent or not _matches(parent, identity, directory=True):
            return False
        with os.scandir(frames._os_path(parent)) as entries:
            if any(entries):
                return False
        if not _matches(parent, identity, directory=True):
            return False
        os.rmdir(frames._os_path(parent))
        return not frames._exists(parent) and not frames._unsafe_link(parent)
    except (OSError, frames.FrameExtractError, ValueError):
        return False


def _create_parent_and_store(root: Path, derivative_relative: Path, digest: str) -> tuple[Path, tuple[int, int], Path, tuple[int, int] | None]:
    parent_relative = _lexical_relative(derivative_relative.parent / REVIEW_PARENT, "delivery review parent")
    _, parent = _within(root, parent_relative, "delivery review parent", must_exist=False)
    parent_identity: tuple[int, int] | None = None
    if frames._exists(parent) or frames._unsafe_link(parent):
        if frames._unsafe_link(parent) or not frames._is_dir(parent) or not frames._real_below(root, parent):
            raise _fail("delivery review parent must be a real link-free directory")
    else:
        try:
            os.mkdir(frames._os_path(parent))
        except (FileExistsError, OSError) as exc:
            raise _fail("delivery review parent could not be created fresh") from exc
        parent_identity = _capture_directory(parent, "delivery review parent")
    try:
        canonical_relative = _lexical_relative(parent_relative / digest, "canonical delivery review directory")
        destination = root / canonical_relative
        if frames._exists(destination) or frames._unsafe_link(destination):
            raise _fail("canonical delivery review directory already exists")
        os.mkdir(frames._os_path(destination))
        destination_identity = _capture_directory(destination, "canonical delivery review directory")
        return destination, destination_identity, parent, parent_identity
    except BaseException as exc:
        if parent_identity is not None and not _remove_owned_parent(root, parent, parent_identity):
            raise _fail("owned review parent cleanup could not be verified; unexpected evidence was preserved") from exc
        if isinstance(exc, VideoDeliveryReviewError):
            raise
        raise _fail("canonical delivery review directory could not be created fresh") from exc


def _write_exclusive(path: Path, raw: bytes) -> tuple[int, int]:
    identity: tuple[int, int] | None = None
    try:
        with frames._open(path, "xb") as handle:
            identity = _identity(os.fstat(handle.fileno()))
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        if not _matches(path, identity, directory=False):
            raise _fail("evaluation publication was replaced")
        return identity
    except FileExistsError as exc:
        raise _fail("evaluation inputs already exist and cannot be overwritten") from exc
    except BaseException:
        if identity is not None and _matches(path, identity, directory=False):
            try:
                os.unlink(frames._os_path(path))
            except OSError as cleanup_exc:
                raise _fail("partial evaluation cleanup could not be verified") from cleanup_exc
        raise


def _assert_store_inventory(destination: Path) -> None:
    if frames._unsafe_link(destination) or not frames._is_dir(destination):
        raise _fail("canonical delivery review directory is unavailable")
    try:
        names = {entry.name for entry in os.scandir(frames._os_path(destination))}
        if names != {EVALUATION_NAME, "samples"}:
            raise _fail("canonical delivery review directory has an unexpected inventory")
        samples = destination / "samples"
        if frames._unsafe_link(samples) or not frames._is_dir(samples):
            raise _fail("canonical samples directory is unavailable")
        if {entry.name for entry in os.scandir(frames._os_path(samples))} != {"first.png", "middle.png", "last.png", "frame-extraction.json"}:
            raise _fail("canonical samples directory has an unexpected inventory")
    except OSError as exc:
        raise _fail("cannot inspect canonical delivery review directory") from exc


def _record_shape(value: Any) -> dict[str, Any]:
    record = _exact(value, {"schema", "status", "not_promotable", "review_directory", "subject", "subject_sha256"}, "delivery evaluation inputs")
    if record["schema"] != EVALUATION_SCHEMA or record["status"] != STATUS or record["not_promotable"] is not True:
        raise _fail("delivery evaluation inputs are not prepared non-promotable evidence")
    if not isinstance(record["review_directory"], str):
        raise _fail("delivery evaluation review_directory is malformed")
    _lexical_relative(Path(record["review_directory"]), "delivery evaluation review_directory")
    subject = _exact(record["subject"], {"identity", "native_authority", "template", "transform_declaration", "tools", "derivative", "extraction", "limitations"}, "delivery evaluation subject")
    identity = _exact(subject["identity"], {"value", "sha256"}, "delivery subject identity")
    identity_value = _exact(identity["value"], {
        "schema", "accepted_lineage_sha256", "source_movie_sha256", "derivative_sha256", "template_id",
        "template_file_sha256", "template_row_sha256", "transform_declaration_sha256", "ffmpeg_sha256", "ffprobe_sha256",
    }, "delivery subject identity value")
    if identity_value["schema"] != KEY_SCHEMA:
        raise _fail("delivery subject identity schema is unsupported")
    for key in set(identity_value) - {"schema", "template_id"}:
        _digest(identity_value[key], f"delivery identity {key}")
    if identity["sha256"] != _canonical(identity_value, "delivery subject identity"):
        raise _fail("delivery subject identity digest is corrupt")
    if record["subject_sha256"] != _canonical(subject, "delivery evaluation subject"):
        raise _fail("delivery evaluation subject digest is corrupt")
    if subject["limitations"] != LIMITATIONS:
        raise _fail("delivery evaluation limitations are not the fixed preparation limitations")
    _native_projection(subject["native_authority"])
    template = _exact(subject["template"], {"id", "file", "file_sha256", "row", "row_sha256"}, "stored reel template")
    if not isinstance(template["id"], str):
        raise _fail("stored reel template id is malformed")
    fixed_file = _exact(template["file"], {"path", "bytes", "sha256"}, "stored reel template file")
    if not isinstance(fixed_file["path"], str) or not Path(fixed_file["path"]).is_absolute():
        raise _fail("stored reel template file path is malformed")
    _integer(fixed_file["bytes"], "stored reel template bytes", minimum=1)
    _digest(fixed_file["sha256"], "stored reel template file digest")
    _digest(template["file_sha256"], "stored reel template file digest")
    _template_row(template["row"])
    _digest(template["row_sha256"], "stored reel template row digest")
    declaration = _exact(subject["transform_declaration"], {"entry", "value"}, "stored transform declaration")
    _file_entry_shape(declaration["entry"], "stored transform declaration entry")
    _normalize_declaration(declaration["value"])
    tools = _exact(subject["tools"], {"ffmpeg", "ffprobe"}, "stored media tools")
    for name in ("ffmpeg", "ffprobe"):
        tool = _exact(tools[name], {"path", "bytes", "sha256", "version"}, f"stored {name}")
        if not isinstance(tool["path"], str) or not Path(tool["path"]).is_absolute() or not isinstance(tool["version"], str) or not tool["version"]:
            raise _fail(f"stored {name} snapshot is malformed")
        _integer(tool["bytes"], f"stored {name} bytes", minimum=1)
        _digest(tool["sha256"], f"stored {name} digest")
    derivative = _exact(subject["derivative"], {"file", "video", "presentation_cadence", "container_duration_seconds", "audio_streams"}, "stored derivative evidence")
    _file_entry_shape(derivative["file"], "stored derivative file")
    extraction = _exact(subject["extraction"], {"receipt", "video_before", "video_after", "metadata", "samples"}, "stored extraction evidence")
    _file_entry_shape(extraction["receipt"], "stored extraction receipt")
    return record


def _validation_projection(record: dict[str, Any]) -> dict[str, Any]:
    subject = record["subject"]
    native = subject["native_authority"]
    return {
        "review_directory": record["review_directory"],
        "subject_sha256": record["subject_sha256"],
        "accepted_lineage": copy.deepcopy(native["accepted_lineage"]),
        "source_movie": copy.deepcopy(native["movie"]),
        "derivative": copy.deepcopy(subject["derivative"]["file"]),
        "template": {
            "id": subject["template"]["id"], "file_sha256": subject["template"]["file_sha256"],
            "row_sha256": subject["template"]["row_sha256"],
        },
        "transform_declaration": copy.deepcopy(subject["transform_declaration"]["entry"]),
        "extraction_receipt": copy.deepcopy(subject["extraction"]["receipt"]),
        "tools": {
            "ffmpeg_sha256": subject["tools"]["ffmpeg"]["sha256"],
            "ffprobe_sha256": subject["tools"]["ffprobe"]["sha256"],
        },
    }


def prepare_delivery_review(
    *, root: Path, accepted_video_path: Path,
    expected_accepted_lineage_sha256: str, derivative_path: Path,
    template_id: str, transform_declaration_path: Path,
) -> dict[str, Any]:
    """Create one immutable prepared-delivery review subject."""
    root = _root(root)
    accepted_video_path = _lexical_relative(accepted_video_path, "accepted video")
    derivative_path = _lexical_relative(derivative_path, "derivative")
    transform_declaration_path = _lexical_relative(transform_declaration_path, "transform declaration")
    expected_digest = _digest(expected_accepted_lineage_sha256, "expected accepted lineage digest")
    destination: Path | None = None
    destination_identity: tuple[int, int] | None = None
    parent: Path | None = None
    parent_identity: tuple[int, int] | None = None
    sample_identity: tuple[int, int] | None = None
    file_identities: dict[str, tuple[int, int]] = {}
    try:
        declaration_first = _declaration_snapshot(root, transform_declaration_path)
        derivative_file_first = _hash_file(root, derivative_path, "derivative", frames.MAX_VIDEO_BYTES)
        template_first = _snapshot_template(template_id)
        tools_first = _snapshot_tools()
        native_first = _validate_native(root, accepted_video_path)
        if native_first["accepted_lineage"]["sha256"] != expected_digest:
            raise _fail("accepted native video does not match the expected lineage digest")
        derivative_first, observed_file = _technical_snapshot(root, derivative_path, template_first)
        _same(observed_file, derivative_file_first, "derivative initial snapshot")
        _cross_bind(declaration_first["value"], native_first, derivative_first, template_first)
        identity_first = _identity_value(native_first, derivative_first["file"], template_first, declaration_first, tools_first)
        identity_sha256 = _canonical(identity_first, "delivery subject identity")
        destination, destination_identity, parent, parent_identity = _create_parent_and_store(root, derivative_path, identity_sha256)
        canonical_relative = destination.relative_to(root)
        samples_relative = canonical_relative / "samples"
        try:
            frames.extract_frames(root=root, video_path=derivative_path, output_dir=samples_relative)
        except frames.FrameExtractError as exc:
            raise _fail(str(exc)) from exc
        sample_identity, sample_files = _capture_samples(destination / "samples")
        file_identities.update({f"samples/{name}": identity for name, identity in sample_files.items()})
        receipt_relative = samples_relative / "frame-extraction.json"
        extraction_first = _extraction_projection(root, receipt_relative, derivative_first["file"])

        declaration_final = _declaration_snapshot(root, transform_declaration_path)
        template_final = _snapshot_template(template_id)
        tools_final = _snapshot_tools()
        derivative_final, _ = _technical_snapshot(root, derivative_path, template_final)
        extraction_final = _extraction_projection(root, receipt_relative, derivative_final["file"])
        native_final = _validate_native(root, accepted_video_path)
        for actual, expected, label in (
            (declaration_final, declaration_first, "transform declaration"),
            (template_final, template_first, "fixed reel template"),
            (tools_final, tools_first, "trusted media tools"),
            (derivative_final, derivative_first, "derivative technical evidence"),
            (extraction_final, extraction_first, "persistent extraction evidence"),
            (native_final, native_first, "accepted native video authority"),
        ):
            _same(actual, expected, label)
        _cross_bind(declaration_final["value"], native_final, derivative_final, template_final)
        identity_final = _identity_value(native_final, derivative_final["file"], template_final, declaration_final, tools_final)
        _same(identity_final, identity_first, "delivery subject identity")
        subject = _subject(identity_final, native_final, template_final, declaration_final, tools_final, derivative_final, extraction_final)
        record = {
            "schema": EVALUATION_SCHEMA, "status": STATUS, "not_promotable": True,
            "review_directory": canonical_relative.as_posix(), "subject": subject,
            "subject_sha256": _canonical(subject, "delivery evaluation subject"),
        }
        raw = _json_bytes(record, "delivery evaluation inputs")
        evaluation_path = destination / EVALUATION_NAME
        file_identities[EVALUATION_NAME] = _write_exclusive(evaluation_path, raw)
        _sync_directory(destination / "samples")
        _sync_directory(destination)
        current, entry = _read_json(root, canonical_relative / EVALUATION_NAME, "delivery evaluation inputs")
        _same(current, record, "published delivery evaluation inputs")
        if entry["bytes"] != len(raw) or entry["sha256"] != hashlib.sha256(raw).hexdigest():
            raise _fail("published delivery evaluation bytes changed")
        _record_shape(current)
        return current
    except BaseException as exc:
        cleanup_ok = True
        if destination is not None and destination_identity is not None:
            if sample_identity is None:
                try:
                    sample_identity, partial_files = _capture_partial_samples(destination / "samples")
                    file_identities.update({f"samples/{name}": identity for name, identity in partial_files.items()})
                except VideoDeliveryReviewError:
                    cleanup_ok = False
            removed = _remove_owned_tree(root, destination, destination_identity, sample_identity, file_identities)
            cleanup_ok = cleanup_ok and removed
        if parent is not None:
            parent_ok = _remove_owned_parent(root, parent, parent_identity)
            cleanup_ok = cleanup_ok and parent_ok
        if not cleanup_ok:
            raise _fail("owned delivery review cleanup could not be verified; unexpected evidence was preserved") from exc
        if isinstance(exc, VideoDeliveryReviewError):
            raise
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        raise _fail("delivery review preparation failed safely") from exc


def validate_prepared_delivery(root: Path, evaluation_path: Path) -> dict[str, Any]:
    """Reconstruct one canonical prepared-delivery subject from current evidence."""
    root = _root(root)
    evaluation_path = _lexical_relative(evaluation_path, "delivery evaluation inputs")
    try:
        record, record_entry = _read_json(root, evaluation_path, "delivery evaluation inputs")
        record = _record_shape(record)
    except VideoDeliveryReviewError:
        raise
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception as exc:
        raise _fail("delivery evaluation inputs could not be read or shaped") from exc
    subject = record["subject"]
    identity_value = subject["identity"]["value"]
    identity_sha256 = subject["identity"]["sha256"]
    derivative_entry = _file_entry_shape(subject["derivative"].get("file") if isinstance(subject["derivative"], dict) else None, "stored derivative")
    derivative_relative = _lexical_relative(Path(derivative_entry["path"]), "stored derivative path")
    canonical_relative = _lexical_relative(derivative_relative.parent / REVIEW_PARENT / identity_sha256, "canonical delivery review directory")
    expected_evaluation = canonical_relative / EVALUATION_NAME
    if evaluation_path != expected_evaluation or record["review_directory"] != canonical_relative.as_posix():
        raise _fail("delivery evaluation inputs are outside their canonical identity store")
    destination = root / canonical_relative
    _assert_store_inventory(destination)
    accepted_path = _lexical_relative(Path(subject["native_authority"]["accepted_lineage"]["path"]), "stored accepted video")
    declaration_path = _lexical_relative(Path(subject["transform_declaration"]["entry"]["path"]), "stored transform declaration")
    receipt_path = _lexical_relative(Path(subject["extraction"]["receipt"]["path"]), "stored extraction receipt")
    if receipt_path != canonical_relative / "samples" / "frame-extraction.json":
        raise _fail("stored extraction receipt is outside the canonical delivery review directory")
    template_id = identity_value["template_id"]
    temporary: Path | None = None
    temporary_identity: tuple[int, int] | None = None
    sample_identity: tuple[int, int] | None = None
    file_identities: dict[str, tuple[int, int]] = {}
    result: dict[str, Any] | None = None
    pending: BaseException | None = None
    try:
        declaration_first = _declaration_snapshot(root, declaration_path)
        template_first = _snapshot_template(template_id)
        tools_first = _snapshot_tools()
        derivative_file_first = _hash_file(root, derivative_relative, "derivative", frames.MAX_VIDEO_BYTES)
        native_first = _validate_native(root, accepted_path)
        derivative_first, observed_file = _technical_snapshot(root, derivative_relative, template_first)
        _same(observed_file, derivative_file_first, "derivative initial validation snapshot")
        _cross_bind(declaration_first["value"], native_first, derivative_first, template_first)
        extraction_first = _extraction_projection(root, receipt_path, derivative_first["file"])
        identity_first = _identity_value(native_first, derivative_first["file"], template_first, declaration_first, tools_first)
        if _canonical(identity_first, "current delivery subject identity") != identity_sha256:
            raise _fail("current delivery subject identity does not match its canonical store")
        current_first = _subject(identity_first, native_first, template_first, declaration_first, tools_first, derivative_first, extraction_first)
        _same(current_first, subject, "current prepared delivery subject")

        temporary_relative = canonical_relative / f"{VALIDATE_PREFIX}{uuid.uuid4().hex}"
        temporary = root / temporary_relative
        try:
            os.mkdir(frames._os_path(temporary))
        except (FileExistsError, OSError) as exc:
            raise _fail("temporary validation directory could not be created fresh") from exc
        temporary_identity = _capture_directory(temporary, "temporary validation directory")
        fresh_samples_relative = temporary_relative / "samples"
        try:
            frames.extract_frames(root=root, video_path=derivative_relative, output_dir=fresh_samples_relative)
        except frames.FrameExtractError as exc:
            raise _fail(str(exc)) from exc
        sample_identity, sample_files = _capture_samples(temporary / "samples")
        file_identities.update({f"samples/{name}": identity for name, identity in sample_files.items()})
        fresh_extraction = _extraction_projection(root, fresh_samples_relative / "frame-extraction.json", derivative_first["file"])
        _same(_pathless_extraction(fresh_extraction), _pathless_extraction(extraction_first), "fresh decoded sample correspondence")

        declaration_final = _declaration_snapshot(root, declaration_path)
        template_final = _snapshot_template(template_id)
        tools_final = _snapshot_tools()
        derivative_final, _ = _technical_snapshot(root, derivative_relative, template_final)
        extraction_final = _extraction_projection(root, receipt_path, derivative_final["file"])
        native_final = _validate_native(root, accepted_path)
        for actual, expected, label in (
            (declaration_final, declaration_first, "transform declaration"),
            (template_final, template_first, "fixed reel template"),
            (tools_final, tools_first, "trusted media tools"),
            (derivative_final, derivative_first, "derivative technical evidence"),
            (extraction_final, extraction_first, "persistent extraction evidence"),
            (native_final, native_first, "accepted native video authority"),
        ):
            _same(actual, expected, label)
        _cross_bind(declaration_final["value"], native_final, derivative_final, template_final)
        identity_final = _identity_value(native_final, derivative_final["file"], template_final, declaration_final, tools_final)
        current_final = _subject(identity_final, native_final, template_final, declaration_final, tools_final, derivative_final, extraction_final)
        _same(identity_final, identity_value, "final delivery subject identity")
        _same(current_final, subject, "final prepared delivery subject")
        if _canonical(current_final, "final prepared delivery subject") != record["subject_sha256"]:
            raise _fail("prepared delivery subject digest does not match current evidence")
        result = _validation_projection(record)
    except BaseException as exc:
        pending = exc
    finally:
        cleanup_ok = True
        if temporary is not None and temporary_identity is not None:
            if sample_identity is None:
                try:
                    sample_identity, partial_files = _capture_partial_samples(temporary / "samples")
                    file_identities.update({f"samples/{name}": identity for name, identity in partial_files.items()})
                except VideoDeliveryReviewError:
                    cleanup_ok = False
            removed = _remove_owned_tree(root, temporary, temporary_identity, sample_identity, file_identities)
            cleanup_ok = cleanup_ok and removed
        if not cleanup_ok:
            pending = _fail("temporary validation cleanup could not be verified; unexpected evidence was preserved")
    if pending is not None:
        if isinstance(pending, VideoDeliveryReviewError):
            raise pending
        if isinstance(pending, (KeyboardInterrupt, SystemExit)):
            raise pending
        raise _fail("prepared delivery validation failed safely") from pending
    assert result is not None
    _assert_store_inventory(destination)
    try:
        final_record, final_entry = _read_json(root, evaluation_path, "delivery evaluation inputs")
        final_record = _record_shape(final_record)
        _same(final_entry, record_entry, "delivery evaluation input bytes after temporary cleanup")
        _same(final_record, record, "delivery evaluation inputs after temporary cleanup")
    except VideoDeliveryReviewError:
        raise
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception as exc:
        raise _fail("delivery evaluation inputs could not be reverified after temporary cleanup") from exc
    return _validation_projection(final_record)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--root", required=True, type=Path)
    prepare.add_argument("--accepted-video", required=True, type=Path)
    prepare.add_argument("--accepted-video-sha256", required=True)
    prepare.add_argument("--derivative", required=True, type=Path)
    prepare.add_argument("--template-id", required=True)
    prepare.add_argument("--transform-declaration", required=True, type=Path)
    validate = subparsers.add_parser("validate")
    validate.add_argument("--root", required=True, type=Path)
    validate.add_argument("--evaluation", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            record = prepare_delivery_review(
                root=args.root, accepted_video_path=args.accepted_video,
                expected_accepted_lineage_sha256=args.accepted_video_sha256,
                derivative_path=args.derivative, template_id=args.template_id,
                transform_declaration_path=args.transform_declaration,
            )
        else:
            record = validate_prepared_delivery(args.root, args.evaluation)
    except VideoDeliveryReviewError as exc:
        parser.error(str(exc))
    print(json.dumps(record, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
