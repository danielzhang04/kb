#!/usr/bin/env python3
"""Prepare one current Figment video candidate for later offline review."""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import math
import os
import re
import stat
import struct
import sys
import tempfile
from pathlib import Path
from typing import Any


SCHEMA = "figment/video-evaluation-inputs@1"
STATUS = "prepared"
RULINGS_SCHEMA = "figment/video-rulings@1"
NORMALIZED_RULINGS_SCHEMA = "figment/video-normalized-rulings@1"
SAMPLE_STAMP_SCHEMA = "figment/video-sample-stamp@1"
REVIEW_MANIFEST_SCHEMA = "figment/video-review-manifest@1"
ACCEPTED_VIDEO_SCHEMA = "figment/accepted-video@1"
REJECTION_SCHEMA = "figment/video-rejection-lineage@1"
TERMINAL_CLAIM_SCHEMA = "figment/video-terminal-claim@1"
REVIEW_DIRECTORY = "video-review"
EVALUATION_NAME = "evaluation-inputs.json"
CLAIM_NAME = "terminal-claim.json"
ACCEPTED_NAME = "accepted-video.json"
REJECTED_NAME = "rejection-lineage.json"
TEMP_PREFIX = ".p-"
MAX_JSON_BYTES = 1024 * 1024
MAX_PROMPT_BYTES = 256 * 1024
MAX_ENTRIES = 20_000
MAX_TEXT_CHARS = 64 * 1024
MAX_ATTEMPTS = 64
MAX_STORE_ENTRIES = MAX_ATTEMPTS + 8
ATTEMPT_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,15}\Z")
ATTEMPT_NAME_RE = re.compile(r"attempt-([A-Za-z0-9][A-Za-z0-9._-]{0,15})\.json\Z")
TEMP_NAME_RE = re.compile(r"\.p-[A-Za-z0-9_]{1,16}\.json\Z")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class VideoReviewError(ValueError):
    """Raised when a candidate cannot be prepared as current review evidence."""


def _module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).resolve().parent
video = _module("figment_video_review_manifest", HERE / "video_manifest.py")
assembly = _module("figment_video_review_assembly", HERE / "frame_assemble.py")
frames = assembly.frames
runner = _module("figment_video_review_runner", HERE.parent / "pod" / "runpod_run.py")
lineage = _module("figment_video_review_lineage", HERE.parent / "lineage.py")
qa_stamp = _module("figment_video_review_qa_stamp", HERE.parent / "qa_stamp.py")

SAMPLE_QUALITY_AXES = tuple(qa_stamp.QUALITY_AXES)
SAMPLE_SAFETY_AXES = tuple(qa_stamp.SAFETY_AXES)
SEQUENCE_AXES = (
    "identity_stability", "anatomy_stability", "background_stability",
    "visible_corruption", "adult_read_throughout", "garment_integrity_throughout",
    "real_person_resemblance_throughout", "matches_persona_age_presentation",
)
PLAYBACK_AXES = (
    "motion_intent", "motion_coherence", "subject_continuity",
    "camera_continuity", "flicker_warping", "pacing",
)
DECISIONS = frozenset({"accept", "reject", "parked"})
ATTRIBUTION_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9@._-]{0,127}\Z")


def _bounded(value: Any, label: str) -> None:
    entries = 0
    stack = [(value, 0)]
    while stack:
        current, depth = stack.pop()
        if depth > video.MAX_JSON_DEPTH:
            raise VideoReviewError(f"{label} JSON is too deep")
        entries += 1
        if entries > MAX_ENTRIES:
            raise VideoReviewError(f"{label} JSON has too many entries")
        if current is None or isinstance(current, bool) or isinstance(current, int):
            continue
        if isinstance(current, float):
            if not math.isfinite(current):
                raise VideoReviewError(f"{label} JSON contains a non-finite number")
            continue
        if isinstance(current, str):
            if len(current) > MAX_TEXT_CHARS:
                raise VideoReviewError(f"{label} JSON text is too long")
            continue
        if isinstance(current, list):
            stack.extend((item, depth + 1) for item in current)
            continue
        if isinstance(current, dict):
            if any(not isinstance(key, str) or len(key) > MAX_TEXT_CHARS for key in current):
                raise VideoReviewError(f"{label} JSON has an invalid key")
            stack.extend((item, depth + 1) for item in current.values())
            continue
        raise VideoReviewError(f"{label} JSON contains an unsupported value")


def _canonical(value: Any, label: str) -> str:
    _bounded(value, label)
    return lineage.canonical_sha256(value)


def _read_json(root: Path, relative: Path, label: str) -> tuple[dict[str, Any], Path, dict[str, Any]]:
    try:
        path = frames._within(root, relative, label)
        before = frames._stat(path)
        if not stat.S_ISREG(before.st_mode) or before.st_size <= 0 or before.st_size > MAX_JSON_BYTES:
            raise VideoReviewError(f"{label} must be a regular JSON file no larger than {MAX_JSON_BYTES} bytes")
        with frames._open(path, "rb") as handle:
            opened = os.fstat(handle.fileno())
            raw = handle.read(MAX_JSON_BYTES + 1)
            finished = os.fstat(handle.fileno())
        after = frames._stat(path)
        identity = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns)
        if len(raw) > MAX_JSON_BYTES:
            raise VideoReviewError(f"{label} must be a regular JSON file no larger than {MAX_JSON_BYTES} bytes")
        if len(raw) != before.st_size or identity(before) != identity(opened) or identity(opened) != identity(finished) or identity(finished) != identity(after):
            raise VideoReviewError(f"{label} changed while being read")
        source = raw.decode("utf-8")
        if not video._depth_ok(source):
            raise VideoReviewError(f"{label} JSON must be shallow")
        value = json.loads(source, parse_constant=lambda token: (_ for _ in ()).throw(ValueError(token)))
    except VideoReviewError:
        raise
    except frames.FrameExtractError as exc:
        raise VideoReviewError(str(exc)) from exc
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise VideoReviewError(f"cannot read {label} JSON") from exc
    if not isinstance(value, dict):
        raise VideoReviewError(f"{label} JSON must be an object")
    _bounded(value, label)
    return value, path, {"path": relative.as_posix(), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def _same(left: Any, right: Any, label: str) -> None:
    if _canonical(left, label) != _canonical(right, label):
        raise VideoReviewError(f"{label} does not match current evidence")


def _record(root: Path, value: Any, label: str, maximum: int) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("path"), str):
        raise VideoReviewError(f"{label} has no bounded file record")
    try:
        current = frames._hash_file(root, Path(value["path"]), label, maximum)
    except frames.FrameExtractError as exc:
        raise VideoReviewError(str(exc)) from exc
    _same(current, {key: value.get(key) for key in ("path", "bytes", "sha256")}, label)
    return current


def _frame_snapshot(root: Path, record: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
    """One bounded, link-free read whose exact bytes must match the captured frame record."""
    label = "candidate frame"
    relative = Path(record["path"])
    try:
        path = frames._within(root, relative, label)
        before = frames._lstat(path)
        if frames._unsafe_link(path) or not stat.S_ISREG(before.st_mode) or before.st_size <= 0 or before.st_size > frames.MAX_FRAME_BYTES:
            raise VideoReviewError(f"{label} must be a regular file no larger than {frames.MAX_FRAME_BYTES} bytes")
        with frames._open(path, "rb") as handle:
            opened = os.fstat(handle.fileno())
            raw = handle.read(frames.MAX_FRAME_BYTES + 1)
            finished = os.fstat(handle.fileno())
        after = frames._lstat(path)
        unsafe_after = frames._unsafe_link(path)
    except VideoReviewError:
        raise
    except frames.FrameExtractError as exc:
        raise VideoReviewError(str(exc)) from exc
    except OSError as exc:
        raise VideoReviewError(f"cannot read {label}") from exc
    identity = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns)
    if len(raw) > frames.MAX_FRAME_BYTES:
        raise VideoReviewError(f"{label} must be a regular file no larger than {frames.MAX_FRAME_BYTES} bytes")
    if unsafe_after or len(raw) != before.st_size or identity(before) != identity(opened) or identity(opened) != identity(finished) or identity(finished) != identity(after):
        raise VideoReviewError(f"{label} changed while being read")
    current = {"path": relative.as_posix(), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    _same(current, {key: record.get(key) for key in ("path", "bytes", "sha256")}, label)
    return current, raw


def _prompt_source(raw: bytes) -> str:
    """Parse the native prompt tEXt chunk from an already-hashed PNG byte buffer."""
    found: list[str] = []
    try:
        if raw[:8] != PNG_SIGNATURE:
            raise VideoReviewError("candidate frame is not a PNG")
        offset = 8
        while True:
            header = raw[offset:offset + 8]
            if len(header) != 8:
                raise VideoReviewError("candidate PNG metadata is truncated")
            length, kind = struct.unpack(">I4s", header)
            if length > frames.MAX_FRAME_BYTES:
                raise VideoReviewError("candidate PNG chunk is too large")
            start = offset + 8
            offset = start + length + 4
            if kind in (b"tEXt", b"iTXt", b"zTXt"):
                if length > MAX_PROMPT_BYTES:
                    raise VideoReviewError("candidate PNG text metadata is too large")
                if offset > len(raw):
                    raise VideoReviewError("candidate PNG metadata is truncated")
                keyword, separator, remainder = raw[start:start + length].partition(b"\0")
                if separator and keyword == b"prompt":
                    if kind == b"tEXt":
                        found.append(remainder.decode("latin-1"))
                    else:
                        raise VideoReviewError("candidate prompt metadata must use the pinned native tEXt form")
            if kind == b"IEND":
                break
    except (UnicodeError, struct.error) as exc:
        raise VideoReviewError("cannot read candidate PNG prompt metadata") from exc
    if len(found) != 1 or len(found[0].encode("utf-8")) > MAX_PROMPT_BYTES:
        raise VideoReviewError("candidate PNG must contain exactly one bounded prompt graph")
    return found[0]


def _prompt_text(path: Path) -> str:
    try:
        with frames._open(path, "rb") as handle:
            raw = handle.read(frames.MAX_FRAME_BYTES + 1)
    except OSError as exc:
        raise VideoReviewError("cannot read candidate PNG prompt metadata") from exc
    if len(raw) > frames.MAX_FRAME_BYTES:
        raise VideoReviewError("candidate frame is too large")
    return _prompt_source(raw)


def _prompt_graph(path: Path, expected_sha256: str) -> None:
    _prompt_graph_source(_prompt_text(path), expected_sha256)


def _prompt_graph_source(source: str, expected_sha256: str) -> None:
    if not video._depth_ok(source):
        raise VideoReviewError("candidate PNG prompt graph must be shallow")
    try:
        value = json.loads(source, parse_constant=lambda token: (_ for _ in ()).throw(ValueError(token)))
    except (json.JSONDecodeError, ValueError) as exc:
        raise VideoReviewError("candidate PNG prompt graph is malformed") from exc
    if not isinstance(value, dict) or _canonical(value, "candidate prompt graph") != expected_sha256:
        raise VideoReviewError("candidate PNG prompt graph does not match the effective job graph")


def _review_directory(candidate_manifest: Path, candidate_id: str) -> Path:
    candidate_key = hashlib.sha256(candidate_id.encode("utf-8")).hexdigest()
    return candidate_manifest.parent / REVIEW_DIRECTORY / candidate_key


def _rebuild_candidate(root: Path, manifest_path: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    try:
        job = manifest["jobs"][0]
        approved = manifest["provenance"]["first_frame"]["approved_gen"]
        persona_path = Path(approved["persona"]["path"])
        plan_path = Path(approved["source_plan"]["path"])
        image_id = approved["image_id"]
        action = manifest["motion"]["action"]
        profile = manifest["resolution_profile"]["name"]
        seed = job["seed"]
        frame_path = Path(manifest["provenance"]["first_frame"]["frame"]["path"])
    except (KeyError, IndexError, TypeError) as exc:
        raise VideoReviewError("candidate manifest lacks current producer inputs") from exc
    replay = frame_path.parent / f".{manifest['candidate_id']}.review-replay.json"
    if frames._exists(root / replay):
        raise VideoReviewError("candidate replay path must remain unused")
    try:
        rebuilt = video.build_manifest(
            root=root, persona_path=persona_path, approved_gen_plan=plan_path,
            approved_gen_image_id=image_id, action=action, out=replay, seed=seed,
            resolution_profile=profile, mode=video.CANDIDATE_MODE,
        )
    except video.VideoManifestError as exc:
        raise VideoReviewError(f"candidate manifest is no longer current: {exc}") from exc
    _same(rebuilt, manifest, "candidate manifest replay")
    return rebuilt


def _subject(
    root: Path, candidate_relative: Path, run_relative: Path,
    assembly_relative: Path, extraction_relative: Path,
) -> tuple[dict[str, Any], Path]:
    manifest, manifest_path, manifest_entry = _read_json(root, candidate_relative, "candidate manifest")
    try:
        job, budget, candidate = assembly._manifest(manifest)
    except assembly.FrameAssembleError as exc:
        raise VideoReviewError(str(exc)) from exc
    if not candidate:
        raise VideoReviewError("diagnostic video evidence cannot become a review candidate")
    candidate_id = manifest.get("candidate_id")
    if not isinstance(candidate_id, str) or not video.SAFE_NAME.fullmatch(candidate_id):
        raise VideoReviewError("candidate id is unsafe")
    rebuilt = _rebuild_candidate(root, manifest_path, manifest)

    run, run_path, run_entry = _read_json(root, run_relative, "run receipt")
    try:
        run_files = assembly._run_job(run, job)
    except assembly.FrameAssembleError as exc:
        raise VideoReviewError(str(exc)) from exc

    graph = runner.apply_job(manifest["workflow"], job, runner.manifest_seed_fields(manifest))
    graph_sha256 = _canonical(graph, "candidate job graph")
    if manifest["provenance"]["workflow"].get("candidate_job_sha256") != graph_sha256:
        raise VideoReviewError("candidate job graph digest does not match its manifest")
    executed_graph = copy.deepcopy(graph)
    try:
        node_inputs = executed_graph["56"]["inputs"]
        if "is_changed" in node_inputs:
            raise VideoReviewError("candidate graph already contains an unexpected LoadImage fingerprint")
        node_inputs["is_changed"] = [manifest["provenance"]["first_frame"]["frame"]["sha256"]]
    except (KeyError, TypeError) as exc:
        raise VideoReviewError("candidate graph has no pinned LoadImage node") from exc
    executed_sha256 = _canonical(executed_graph, "executed candidate graph")

    assembly_value, _, assembly_entry = _read_json(root, assembly_relative, "assembly receipt")
    if assembly_value.get("schema") != assembly.SCHEMA or assembly_value.get("not_promotable") is not True:
        raise VideoReviewError("assembly receipt is not non-promotable candidate evidence")
    _same(assembly_value.get("candidate"), {"id": candidate_id, "mode": video.CANDIDATE_MODE}, "assembly candidate")
    _same(assembly_value.get("manifest"), {"path": candidate_relative.as_posix(), "sha256": manifest_entry["sha256"]}, "assembly manifest binding")
    _same(assembly_value.get("run_receipt"), {"path": run_relative.as_posix(), "sha256": run_entry["sha256"], "binding": "output_name and seed only; PNG prompt metadata requires separate review"}, "assembly run binding")

    assembly_frames = assembly_value.get("frames")
    if (
        not isinstance(assembly_frames, list)
        or len(assembly_frames) != assembly.FRAME_COUNT
        or any(not isinstance(item, dict) for item in assembly_frames)
    ):
        raise VideoReviewError("assembly receipt must bind all 81 frames")
    current_frames: list[dict[str, Any]] = []
    total = 0
    run_dir = run_path.parent.relative_to(root)
    for index, item in enumerate(run_files, start=1):
        # The prompt graph is parsed from the exact bytes that matched the captured hash.
        current, raw = _frame_snapshot(root, {"path": (run_dir / item["path"]).as_posix(), "bytes": item["bytes"], "sha256": assembly_frames[index - 1].get("sha256")})
        current["index"] = index
        _same(current, assembly_frames[index - 1], "assembly frame")
        total += current["bytes"]
        if total > assembly.MAX_TOTAL_FRAME_BYTES:
            raise VideoReviewError("candidate frames exceed the aggregate byte limit")
        _prompt_graph_source(_prompt_source(raw), executed_sha256)
        del raw
        current_frames.append(current)

    movie = _record(root, assembly_value.get("movie"), "candidate movie", frames.MAX_VIDEO_BYTES)
    try:
        movie_metadata = assembly._probe_movie(root, Path(movie["path"]))
    except assembly.FrameAssembleError as exc:
        raise VideoReviewError(str(exc)) from exc
    _same(movie_metadata, assembly_value.get("metadata"), "assembly movie metadata")
    if (
        movie_metadata.get("width") != budget.get("width")
        or movie_metadata.get("height") != budget.get("height")
        or movie_metadata.get("frame_count") != budget.get("frames")
        or movie_metadata.get("fps") != budget.get("fps")
    ):
        raise VideoReviewError("candidate movie metadata does not match the native frame budget")

    extraction, _, extraction_entry = _read_json(root, extraction_relative, "extraction receipt")
    if extraction.get("schema") != frames.SCHEMA or extraction.get("not_promotable") is not True:
        raise VideoReviewError("extraction receipt is not non-promotable evidence")
    _same(extraction.get("video_before"), movie, "extraction source video")
    _same(extraction.get("video_after"), movie, "extraction final video")
    try:
        extracted_metadata = frames._probe_video(root, Path(movie["path"]))
    except frames.FrameExtractError as exc:
        raise VideoReviewError(str(exc)) from exc
    _same(extraction.get("metadata"), extracted_metadata, "extraction metadata")
    sample_values = extraction.get("frames")
    expected_samples = (("first", 0), ("middle", 40), ("last", 80))
    if not isinstance(sample_values, list) or len(sample_values) != len(expected_samples):
        raise VideoReviewError("extraction receipt must contain first, middle, and last frames")
    samples: list[dict[str, Any]] = []
    for value, (label, index) in zip(sample_values, expected_samples, strict=True):
        current = _record(root, value, f"{label} sample", frames.MAX_FRAME_BYTES)
        try:
            frames._probe_frame(root, Path(current["path"]), budget["width"], budget["height"])
        except frames.FrameExtractError as exc:
            raise VideoReviewError(str(exc)) from exc
        current.update({"label": label, "index": index})
        _same(current, value, f"{label} sample")
        samples.append(current)

    persona_path = Path(rebuilt["provenance"]["first_frame"]["approved_gen"]["persona"]["path"])
    persona, _, persona_entry = _read_json(root, persona_path, "current persona")
    persona_projection = lineage.persona_input_projection(persona)
    subject = {
        "candidate": {"id": candidate_id, "manifest": manifest_entry},
        "approved_gen": rebuilt["provenance"]["first_frame"],
        "persona": {"record": persona_entry, "projection": persona_projection},
        "workflow": {
            "source": manifest["provenance"]["workflow"],
            "model_pins": manifest["provenance"]["model_pins"],
            "job_graph": graph,
            "job_graph_sha256": graph_sha256,
            "executed_graph": executed_graph,
            "executed_graph_sha256": executed_sha256,
            "png_prompt_graphs_verified": len(current_frames),
        },
        "run": {"receipt": run_entry, "job": {"seed": job["seed"], "output_name": job["output_name"]}},
        "sequence": {"frames": current_frames, "frames_sha256": _canonical(current_frames, "ordered frame sequence")},
        "assembly": {"receipt": assembly_entry, "movie": movie, "metadata": movie_metadata},
        "extraction": {"receipt": extraction_entry, "frames": samples, "metadata": extracted_metadata},
    }
    _bounded(subject, "video review subject")
    return subject, _review_directory(manifest_path, candidate_id)


def prepare_review(
    *, root: Path, candidate_manifest: Path, run_receipt: Path,
    assembly_receipt: Path, extraction_receipt: Path,
) -> dict[str, Any]:
    try:
        root = frames._root(root)
    except frames.FrameExtractError as exc:
        raise VideoReviewError(str(exc)) from exc
    arguments = (root, candidate_manifest, run_receipt, assembly_receipt, extraction_receipt)
    before, destination = _subject(*arguments)
    repeated, repeated_destination = _subject(*arguments)
    if _canonical(before, "video review subject") != _canonical(repeated, "video review subject") or destination != repeated_destination:
        raise VideoReviewError("video review evidence changed during preparation")
    try:
        destination_relative = destination.relative_to(root)
    except ValueError as exc:
        raise VideoReviewError("video candidate review directory is not below root") from exc
    # Preflight the bounded serialization before any store directory exists.
    _json_bytes(_evaluation_record(before, destination_relative.as_posix()), "video evaluation inputs")
    created: tuple[int, int] | None = None
    try:
        parent_relative = destination.parent.relative_to(root)
        parent = frames._within(root, parent_relative, "review parent", must_exist=False)
        if not frames._exists(parent):
            os.mkdir(frames._os_path(parent))
        parent = frames._within(root, parent_relative, "review parent")
        if frames._exists(destination) or frames._unsafe_link(destination):
            raise VideoReviewError("video candidate review directory must be fresh")
        os.mkdir(frames._os_path(destination))
        created = _identity(frames._lstat(destination))
        destination = frames._within(root, destination_relative, "review directory")
        final, final_destination = _subject(*arguments)
        if final_destination != destination or _canonical(before, "video review subject") != _canonical(final, "video review subject"):
            raise VideoReviewError("video review evidence changed before publication")
        record = _evaluation_record(final, destination_relative.as_posix())
        _exclusive_file(root, destination / EVALUATION_NAME, record, "video evaluation inputs")
        return record
    except VideoReviewError:
        if created is not None:
            _cleanup_created(root, destination, created)
        raise
    except (OSError, frames.FrameExtractError) as exc:
        if created is not None:
            _cleanup_created(root, destination, created)
        raise VideoReviewError("cannot create fresh video review preparation") from exc
    except BaseException:
        # Interrupts also retract our fresh directory; a kill or power loss leaves an
        # orphan that intentionally fails closed as a non-fresh store.
        if created is not None:
            _cleanup_created(root, destination, created)
        raise


def _evaluation_record(subject: dict[str, Any], review_directory: str) -> dict[str, Any]:
    return lineage.wrap_subject(
        SCHEMA, subject, status=STATUS,
        candidate_id=subject["candidate"]["id"], review_directory=review_directory,
    )


def _cleanup_created(root: Path, destination: Path, identity: tuple[int, int]) -> None:
    """Remove only the exact directory this invocation created, never one that replaced it."""
    try:
        current = frames._lstat(destination)
    except OSError:
        return
    if stat.S_ISDIR(current.st_mode) and _identity(current) == identity:
        frames._cleanup_owned_directory(root, destination)


def _exact_keys(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise VideoReviewError(f"{label} must have the exact closed schema")
    return value


def _plain_text(value: Any, label: str, maximum: int, *, required: bool = True) -> str:
    if not isinstance(value, str):
        raise VideoReviewError(f"{label} must be plain text")
    normalized = value.strip()
    if (required and not normalized) or len(normalized) > maximum or any(ord(char) < 32 for char in normalized):
        raise VideoReviewError(f"{label} is missing or outside its text limit")
    return normalized


def _attribution(value: Any) -> str:
    normalized = _plain_text(value, "decided_by", 128)
    if not ATTRIBUTION_RE.fullmatch(normalized):
        raise VideoReviewError("decided_by must be a bounded plain identifier")
    return normalized


def _attempt_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not ATTEMPT_ID_RE.fullmatch(value):
        raise VideoReviewError(f"{label} must be 1-16 safe ASCII characters")
    return value


def _timestamp(value: Any) -> str:
    normalized = _plain_text(value, "decided_at", 64)
    try:
        parsed = dt.datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError as exc:
        raise VideoReviewError("decided_at must be an ISO-8601 timestamp with a timezone") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise VideoReviewError("decided_at must be an ISO-8601 timestamp with a timezone")
    return normalized


def _digest(value: Any, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise VideoReviewError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _normalize_axes(value: Any, axes: tuple[str, ...], label: str) -> dict[str, str]:
    current = _exact_keys(value, set(axes), label)
    normalized: dict[str, str] = {}
    for axis in axes:
        state = current[axis].strip().lower() if isinstance(current[axis], str) else None
        if state not in ("pass", "fail"):
            raise VideoReviewError(f"{label}.{axis} must be pass or fail")
        normalized[axis] = state
    return normalized


def _normalize_observation(
    value: Any, *, label: str, coverage: str, digest_key: str,
    expected_digest: str, axes: tuple[str, ...],
) -> dict[str, Any] | None:
    if value is None:
        return None
    current = _exact_keys(value, {"coverage", digest_key, "axes"}, label)
    if current["coverage"] != coverage or _digest(current[digest_key], f"{label}.{digest_key}") != expected_digest:
        raise VideoReviewError(f"{label} does not bind the current review subject")
    return {
        "coverage": coverage, digest_key: expected_digest,
        "axes": _normalize_axes(current["axes"], axes, f"{label}.axes"),
    }


def _normalize_rulings(value: Any, subject: dict[str, Any]) -> dict[str, Any]:
    keys = {
        "schema", "candidate_id", "subject_sha256", "attempt_id", "decision",
        "decided_by", "decided_at", "reason", "override", "samples",
        "complete_sequence", "full_playback",
    }
    current = _exact_keys(value, keys, "video rulings")
    if not isinstance(current["schema"], str) or current["schema"] not in (RULINGS_SCHEMA, NORMALIZED_RULINGS_SCHEMA):
        raise VideoReviewError("video rulings have the wrong schema")
    candidate_id = subject["candidate"]["id"]
    subject_sha256 = _canonical(subject, "video review subject")
    if current["candidate_id"] != candidate_id or current["subject_sha256"] != subject_sha256:
        raise VideoReviewError("video rulings do not bind the current prepared subject")
    attempt_id = _attempt_id(current["attempt_id"], "video ruling attempt id")
    decision = current["decision"]
    if not isinstance(decision, str) or decision not in DECISIONS:
        raise VideoReviewError("video ruling decision must be accept, reject, or parked")
    if current["override"] is not False:
        raise VideoReviewError("video acceptance does not permit an override")
    reason = _plain_text(current["reason"], "ruling reason", 2048, required=decision != "accept")

    samples = current["samples"]
    if not isinstance(samples, list) or len(samples) > 3:
        raise VideoReviewError("sample rulings must be a list with at most three rows")
    expected = {item["label"]: item for item in subject["extraction"]["frames"]}
    normalized_samples: list[dict[str, Any]] = []
    seen: set[str] = set()
    sample_keys = {"image_id", "index", "frame_sha256", "why", *SAMPLE_QUALITY_AXES, *SAMPLE_SAFETY_AXES}
    for row in samples:
        item = _exact_keys(row, sample_keys, "sample ruling")
        image_id = item["image_id"]
        if not isinstance(image_id, str) or image_id not in expected or image_id in seen:
            raise VideoReviewError("sample rulings must uniquely name current first, middle, or last frames")
        source = expected[image_id]
        # bool is an int subclass; False must never stand in for frame index 0.
        if type(item["index"]) is not int or item["index"] != source["index"] or _digest(item["frame_sha256"], "sample frame digest") != source["sha256"]:
            raise VideoReviewError("sample ruling does not bind its current extracted frame")
        normalized_row: dict[str, Any] = {
            "image_id": image_id, "index": source["index"], "frame_sha256": source["sha256"],
            "why": _plain_text(item["why"], "sample ruling reason", 1024, required=False),
        }
        for axis in SAMPLE_QUALITY_AXES:
            state = item[axis].strip().lower() if isinstance(item[axis], str) else None
            if state not in qa_stamp._VALID_STATES:
                raise VideoReviewError(f"sample ruling {axis} has an invalid value")
            normalized_row[axis] = state
        for axis in SAMPLE_SAFETY_AXES:
            state = item[axis].strip().lower() if isinstance(item[axis], str) else None
            if state not in qa_stamp.SAFETY_VALUES[axis]:
                raise VideoReviewError(f"sample ruling {axis} has an invalid value")
            normalized_row[axis] = state
        normalized_samples.append(normalized_row)
        seen.add(image_id)
    normalized_samples.sort(key=lambda item: item["index"])

    sequence = _normalize_observation(
        current["complete_sequence"], label="complete_sequence",
        coverage="all-81-ordered-frames", digest_key="frames_sha256",
        expected_digest=subject["sequence"]["frames_sha256"], axes=SEQUENCE_AXES,
    )
    playback = _normalize_observation(
        current["full_playback"], label="full_playback",
        coverage="entire-clip", digest_key="movie_sha256",
        expected_digest=subject["assembly"]["movie"]["sha256"], axes=PLAYBACK_AXES,
    )
    return {
        "schema": NORMALIZED_RULINGS_SCHEMA, "candidate_id": candidate_id,
        "subject_sha256": subject_sha256, "attempt_id": attempt_id,
        "decision": decision, "decided_by": _attribution(current["decided_by"]),
        "decided_at": _timestamp(current["decided_at"]), "reason": reason,
        "override": False, "samples": normalized_samples,
        "complete_sequence": sequence, "full_playback": playback,
    }


def _stamp_samples(subject: dict[str, Any], normalized: dict[str, Any]) -> dict[str, Any]:
    images = [
        {
            "image_id": item["label"], "index": item["index"],
            "frame_sha256": item["sha256"], "review_status": "unreviewed",
            "parked_reasons": [], "safety_failed": False, "safety_reasons": [],
        }
        for item in subject["extraction"]["frames"]
    ]
    try:
        qa_stamp.stamp({"images": images}, normalized["samples"])
    except ValueError as exc:
        raise VideoReviewError(f"sample rulings cannot be stamped: {exc}") from exc
    record = {
        "schema": SAMPLE_STAMP_SCHEMA, "candidate_id": subject["candidate"]["id"],
        "subject_sha256": _canonical(subject, "video review subject"), "images": images,
    }
    _bounded(record, "video sample stamp")
    return record


def _assert_decision_allowed(normalized: dict[str, Any], stamp: dict[str, Any]) -> None:
    if normalized["decision"] != "accept":
        return
    if len(normalized["samples"]) != 3 or normalized["complete_sequence"] is None or normalized["full_playback"] is None:
        raise VideoReviewError("acceptance requires complete sample, sequence, and playback coverage")
    if any(item["review_status"] != "verified" or item["safety_failed"] is not False for item in stamp["images"]):
        raise VideoReviewError("acceptance requires every sample to be verified and safety-clear")
    observations = (normalized["complete_sequence"], normalized["full_playback"])
    if any(state != "pass" for item in observations for state in item["axes"].values()):
        raise VideoReviewError("acceptance requires every temporal observation to pass")


def _subject_inputs(subject: dict[str, Any]) -> dict[str, str]:
    try:
        values = {
            "candidate_manifest": subject["candidate"]["manifest"]["path"],
            "run_receipt": subject["run"]["receipt"]["path"],
            "assembly_receipt": subject["assembly"]["receipt"]["path"],
            "extraction_receipt": subject["extraction"]["receipt"]["path"],
        }
    except (KeyError, TypeError) as exc:
        raise VideoReviewError("video review subject lacks its producer inputs") from exc
    if any(not isinstance(value, str) for value in values.values()):
        raise VideoReviewError("video review subject has malformed producer inputs")
    return values


def _assert_current(record: dict[str, Any], subject: dict[str, Any], label: str) -> None:
    try:
        lineage.assert_current(record, subject, label=label)
    except lineage.LineageError as exc:
        raise VideoReviewError(str(exc)) from exc
    except (KeyError, TypeError, ValueError) as exc:
        raise VideoReviewError(f"{label} has a malformed subject binding") from exc


def _evaluation(root: Path, destination: Path, subject: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    relative = destination.relative_to(root) / EVALUATION_NAME
    value, _, entry = _read_json(root, relative, "video evaluation inputs")
    if (
        value.get("schema") != SCHEMA or value.get("status") != STATUS
        or value.get("candidate_id") != subject["candidate"]["id"]
        or value.get("review_directory") != destination.relative_to(root).as_posix()
    ):
        raise VideoReviewError("video evaluation inputs do not identify the canonical preparation")
    _assert_current(value, subject, "video evaluation inputs")
    return value, entry


def _decision_context(
    root: Path, candidate_manifest: Path, run_receipt: Path,
    assembly_receipt: Path, extraction_receipt: Path, rulings: Path,
) -> dict[str, Any]:
    subject, destination = _subject(root, candidate_manifest, run_receipt, assembly_receipt, extraction_receipt)
    _, evaluation_entry = _evaluation(root, destination, subject)
    ruling_value, _, ruling_entry = _read_json(root, rulings, "video rulings")
    normalized = _normalize_rulings(ruling_value, subject)
    stamp = _stamp_samples(subject, normalized)
    _assert_decision_allowed(normalized, stamp)
    return {
        "subject": subject, "destination": destination,
        "evaluation_entry": evaluation_entry, "rulings_entry": ruling_entry,
        "normalized": normalized, "stamp": stamp,
    }


def _context_sha256(context: dict[str, Any]) -> str:
    projected = {key: value for key, value in context.items() if key != "destination"}
    projected["destination"] = context["destination"].as_posix()
    return _canonical(projected, "video ruling context")


def _json_bytes(value: dict[str, Any], label: str) -> bytes:
    _bounded(value, label)
    raw = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")
    if len(raw) > MAX_JSON_BYTES:
        raise VideoReviewError(f"{label} exceeds the bounded JSON output limit")
    return raw


def _contained_store(root: Path, store: Path) -> Path:
    """Re-prove the canonical store is a link-free real directory below root right now."""
    try:
        checked = frames._within(root, store.relative_to(root), "canonical video review directory")
    except (ValueError, frames.FrameExtractError) as exc:
        raise VideoReviewError("canonical video review directory is not contained below root") from exc
    if checked != store or not frames._is_dir(checked) or frames._unsafe_link(checked):
        raise VideoReviewError("canonical video review directory is not a real contained directory")
    return checked


def _identity(value: os.stat_result) -> tuple[int, int]:
    return value.st_dev, value.st_ino


def _sync_directory(directory: Path) -> None:
    if os.name == "nt":
        return  # Windows cannot open directories for fsync; the file itself was fsynced.
    descriptor = os.open(frames._os_path(directory), os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _remove_owned(root: Path, path: Path, identity: tuple[int, int]) -> None:
    """Unlink only the exact file this invocation created, after re-proving containment."""
    try:
        _contained_store(root, path.parent)
        current = frames._lstat(path)
        if stat.S_ISREG(current.st_mode) and not frames._unsafe_link(path) and _identity(current) == identity:
            os.unlink(frames._os_path(path))
    except (OSError, VideoReviewError):
        pass


def _exclusive_file(root: Path, path: Path, value: dict[str, Any], label: str) -> tuple[int, int]:
    """Publish complete JSON via fsynced owned temp + exclusive hard link; never overwrite."""
    raw = _json_bytes(value, label)
    store = _contained_store(root, path.parent)
    temporary: Path | None = None
    owned: tuple[int, int] | None = None
    try:
        descriptor, name = tempfile.mkstemp(prefix=TEMP_PREFIX, suffix=".json", dir=frames._os_path(store))
        temporary = Path(frames._plain_path(name))
        with os.fdopen(descriptor, "wb") as handle:
            owned = _identity(os.fstat(handle.fileno()))
            handle.write(raw); handle.flush(); os.fsync(handle.fileno())
        if temporary.parent != store or not TEMP_NAME_RE.fullmatch(temporary.name):
            raise VideoReviewError(f"cannot publish {label} from an owned temporary file")
        _contained_store(root, store)
        os.link(frames._os_path(temporary), frames._os_path(path))
        if _identity(frames._lstat(path)) != owned:
            raise VideoReviewError(f"{label} publication was replaced during linking")
        _sync_directory(store)
        return owned
    except FileExistsError as exc:
        raise VideoReviewError(f"{label} already exists and cannot be overwritten") from exc
    except (OSError, NotImplementedError, AttributeError) as exc:
        # Filesystems without hard links cannot give exclusive no-overwrite publication.
        raise VideoReviewError(f"cannot publish {label}") from exc
    finally:
        if temporary is not None and owned is not None:
            _remove_owned(root, temporary, owned)


def _store_inventory(root: Path, store: Path) -> dict[str, Any]:
    """Bounded scan of the flat canonical store; unknown, linked, or excess entries fail closed."""
    store = _contained_store(root, store)
    attempts: list[str] = []
    names: set[str] = set()
    try:
        with os.scandir(frames._os_path(store)) as entries:
            for count, entry in enumerate(entries, start=1):
                if count > MAX_STORE_ENTRIES:
                    raise VideoReviewError("video review store exceeds its bounded entry limit")
                name = entry.name
                path = store / name
                try:
                    mode = frames._lstat(path).st_mode
                except FileNotFoundError:
                    if TEMP_NAME_RE.fullmatch(name):
                        continue  # a concurrent publisher already retracted its owned temporary
                    raise
                if frames._unsafe_link(path) or not stat.S_ISREG(mode):
                    raise VideoReviewError("video review store contains a linked or non-regular entry")
                match = ATTEMPT_NAME_RE.fullmatch(name)
                if match:
                    attempts.append(match.group(1))
                elif name in (EVALUATION_NAME, CLAIM_NAME, ACCEPTED_NAME, REJECTED_NAME):
                    names.add(name)
                elif not TEMP_NAME_RE.fullmatch(name):
                    raise VideoReviewError("video review store contains an unexpected entry")
    except OSError as exc:
        raise VideoReviewError("cannot inspect the canonical video review store") from exc
    if len(attempts) > MAX_ATTEMPTS:
        raise VideoReviewError("video review store exceeds its bounded attempt limit")
    return {
        "attempts": frozenset(attempts), "claimed": CLAIM_NAME in names,
        "accepted": ACCEPTED_NAME in names, "rejected": REJECTED_NAME in names,
    }


def _claim_terminal(root: Path, path: Path, raw: bytes) -> None:
    _contained_store(root, path.parent)
    try:
        with frames._open(path, "xb") as handle:
            handle.write(raw); handle.flush(); os.fsync(handle.fileno())
        _sync_directory(path.parent)
    except FileExistsError as exc:
        raise VideoReviewError("video candidate already has a terminal claim") from exc
    except OSError as exc:
        # A partial claim remains intentionally fail-closed and blocks later decisions.
        raise VideoReviewError("cannot persist the exclusive video terminal claim") from exc


def _claim_value(normalized: dict[str, Any], stamp: dict[str, Any], review_directory: str) -> dict[str, Any]:
    return {
        "schema": TERMINAL_CLAIM_SCHEMA, "candidate_id": normalized["candidate_id"],
        "subject_sha256": normalized["subject_sha256"], "attempt_id": normalized["attempt_id"],
        "decision": normalized["decision"], "review_directory": review_directory,
        "rulings_sha256": _canonical(normalized, "normalized video rulings"),
        "sample_stamp_sha256": _canonical(stamp, "video sample stamp"),
        "attribution": {"decided_by": normalized["decided_by"], "decided_at": normalized["decided_at"]},
    }


def _attempt_record(context: dict[str, Any], review_directory: str) -> dict[str, Any]:
    subject = context["subject"]
    normalized = context["normalized"]
    return lineage.wrap_subject(
        REVIEW_MANIFEST_SCHEMA, subject, status=normalized["decision"],
        candidate_id=subject["candidate"]["id"], attempt_id=normalized["attempt_id"],
        review_directory=review_directory,
        attribution={"decided_by": normalized["decided_by"], "decided_at": normalized["decided_at"]},
        evaluation_inputs=context["evaluation_entry"], rulings_source=context["rulings_entry"],
        rulings=normalized, rulings_sha256=_canonical(normalized, "normalized video rulings"),
        sample_stamp=context["stamp"], sample_stamp_sha256=_canonical(context["stamp"], "video sample stamp"),
        inputs=_subject_inputs(subject),
    )


def _terminal_record(context: dict[str, Any], review_directory: str, attempt_entry: dict[str, Any]) -> dict[str, Any]:
    subject = context["subject"]
    normalized = context["normalized"]
    accept = normalized["decision"] == "accept"
    return lineage.wrap_subject(
        ACCEPTED_VIDEO_SCHEMA if accept else REJECTION_SCHEMA, subject,
        status="accepted" if accept else "rejected",
        candidate_id=subject["candidate"]["id"], review_directory=review_directory,
        transition="video-candidate-acceptance" if accept else "video-candidate-rejection",
        inputs=_subject_inputs(subject), evaluation_inputs=context["evaluation_entry"],
        attempt={"id": normalized["attempt_id"], "record": attempt_entry},
        rulings_sha256=_canonical(normalized, "normalized video rulings"),
        attribution={"decided_by": normalized["decided_by"], "decided_at": normalized["decided_at"]},
        movie=subject["assembly"]["movie"], approved_still=subject["approved_gen"]["frame"],
    )


def apply_rulings(
    *, root: Path, candidate_manifest: Path, run_receipt: Path,
    assembly_receipt: Path, extraction_receipt: Path, rulings: Path,
) -> dict[str, Any]:
    try:
        root = frames._root(root)
    except frames.FrameExtractError as exc:
        raise VideoReviewError(str(exc)) from exc
    arguments = (root, candidate_manifest, run_receipt, assembly_receipt, extraction_receipt, rulings)
    first = _decision_context(*arguments)
    repeated = _decision_context(*arguments)
    if first["destination"] != repeated["destination"] or _context_sha256(first) != _context_sha256(repeated):
        raise VideoReviewError("video ruling evidence changed during validation")
    destination = _contained_store(root, first["destination"])
    review_relative = destination.relative_to(root).as_posix()
    normalized = first["normalized"]
    decision = normalized["decision"]
    attempt_path = destination / f"attempt-{normalized['attempt_id']}.json"
    claim_path = destination / CLAIM_NAME
    inventory = _store_inventory(root, destination)
    if inventory["claimed"] or inventory["accepted"] or inventory["rejected"]:
        raise VideoReviewError("video candidate already has a terminal decision or claim")
    if normalized["attempt_id"] in inventory["attempts"] or frames._exists(attempt_path) or frames._unsafe_link(attempt_path):
        raise VideoReviewError("video review attempt already exists")
    if len(inventory["attempts"]) >= MAX_ATTEMPTS:
        raise VideoReviewError("video review store has no remaining attempt capacity")
    claim_raw = _json_bytes(_claim_value(normalized, first["stamp"], review_relative), "video terminal claim")
    # Serialize every record this decision publishes before any claim exists, so an
    # oversized or overdeep attempt/terminal refuses without leaving fail-closed state.
    attempt_raw = _json_bytes(_attempt_record(first, review_relative), "video review attempt")
    attempt_entry = {
        "path": attempt_path.relative_to(root).as_posix(), "bytes": len(attempt_raw),
        "sha256": hashlib.sha256(attempt_raw).hexdigest(),
    }
    if decision in ("accept", "reject"):
        terminal_raw = _json_bytes(_terminal_record(first, review_relative, attempt_entry), "video terminal decision")
        _claim_terminal(root, claim_path, claim_raw)
    final = _decision_context(*arguments)
    if final["destination"] != destination or _context_sha256(first) != _context_sha256(final):
        raise VideoReviewError("video ruling evidence changed before publication")
    attempt = _attempt_record(final, review_relative)
    if _json_bytes(attempt, "video review attempt") != attempt_raw:
        raise VideoReviewError("video review attempt changed before publication")
    owned = _exclusive_file(root, attempt_path, attempt, "video review attempt")
    if decision == "parked":
        # A terminal claim that raced this append wins; retract the exact file we just linked.
        if _store_inventory(root, destination)["claimed"]:
            _remove_owned(root, attempt_path, owned)
            raise VideoReviewError("video candidate gained a terminal claim; parked attempt refused")
        return attempt
    _, _, published = _read_json(root, attempt_path.relative_to(root), "video review attempt")
    _same(published, attempt_entry, "video review attempt publication")
    terminal_target = destination / (ACCEPTED_NAME if decision == "accept" else REJECTED_NAME)
    terminal = _terminal_record(final, review_relative, attempt_entry)
    if _json_bytes(terminal, "video terminal decision") != terminal_raw:
        raise VideoReviewError("video terminal decision changed before publication")
    # Final fresh check: evidence, our claim bytes, and our attempt bytes are unchanged.
    fresh = _decision_context(*arguments)
    if fresh["destination"] != destination or _context_sha256(first) != _context_sha256(fresh):
        raise VideoReviewError("video ruling evidence changed before terminal publication")
    claim_relative = (_contained_store(root, destination) / CLAIM_NAME).relative_to(root)
    _, _, claim_now = _read_json(root, claim_relative, "video terminal claim")
    _same(claim_now, {
        "path": claim_relative.as_posix(), "bytes": len(claim_raw),
        "sha256": hashlib.sha256(claim_raw).hexdigest(),
    }, "video terminal claim before publication")
    _, _, attempt_now = _read_json(root, attempt_path.relative_to(root), "video review attempt")
    _same(attempt_now, attempt_entry, "video review attempt file")
    _exclusive_file(root, terminal_target, terminal, "video terminal decision")
    return terminal


def _read_record_entry(root: Path, value: Any, label: str) -> tuple[dict[str, Any], dict[str, Any]]:
    if not isinstance(value, dict) or set(value) != {"path", "bytes", "sha256"}:
        raise VideoReviewError(f"{label} has a malformed file entry")
    if not isinstance(value["path"], str) or not value["path"]:
        raise VideoReviewError(f"{label} has a malformed file entry")
    record, _, entry = _read_json(root, Path(value["path"]), label)
    _same(entry, value, label)
    return record, entry


def _file_entry_shape(value: Any, label: str) -> None:
    entry = _exact_keys(value, {"path", "bytes", "sha256"}, label)
    if not isinstance(entry["path"], str) or not entry["path"] or type(entry["bytes"]) is not int or entry["bytes"] < 0:
        raise VideoReviewError(f"{label} has a malformed file entry")
    _digest(entry["sha256"], f"{label} digest")


ACCEPTED_KEYS = frozenset({
    "schema", "status", "candidate_id", "review_directory", "transition", "inputs",
    "evaluation_inputs", "attempt", "rulings_sha256", "attribution", "movie",
    "approved_still", "subject", "subject_sha256",
})
ATTEMPT_KEYS = frozenset({
    "schema", "status", "candidate_id", "attempt_id", "review_directory", "attribution",
    "evaluation_inputs", "rulings_source", "rulings", "rulings_sha256", "sample_stamp",
    "sample_stamp_sha256", "inputs", "subject", "subject_sha256",
})


def _accepted_snapshot(root: Path, accepted_video_path: Path) -> dict[str, Any]:
    """One complete verification pass; returns every record and file entry it trusted."""
    accepted, _, accepted_entry = _read_json(root, accepted_video_path, "accepted video")
    _exact_keys(accepted, set(ACCEPTED_KEYS), "accepted video")
    if accepted["schema"] != ACCEPTED_VIDEO_SCHEMA or accepted["status"] != "accepted" or accepted["transition"] != "video-candidate-acceptance":
        raise VideoReviewError("accepted video has no accepted terminal authority")
    inputs = _exact_keys(accepted["inputs"], {"candidate_manifest", "run_receipt", "assembly_receipt", "extraction_receipt"}, "accepted video inputs")
    if any(not isinstance(value, str) for value in inputs.values()):
        raise VideoReviewError("accepted video inputs are malformed")
    subject, destination = _subject(
        root, Path(inputs["candidate_manifest"]), Path(inputs["run_receipt"]),
        Path(inputs["assembly_receipt"]), Path(inputs["extraction_receipt"]),
    )
    expected_path = destination / ACCEPTED_NAME
    try:
        located = frames._within(root, accepted_video_path, "accepted video")
    except (ValueError, frames.FrameExtractError) as exc:
        raise VideoReviewError("accepted video is outside its canonical candidate store") from exc
    if located != expected_path:
        raise VideoReviewError("accepted video is outside its canonical candidate store")
    review_directory = destination.relative_to(root).as_posix()
    if accepted["review_directory"] != review_directory or accepted["candidate_id"] != subject["candidate"]["id"]:
        raise VideoReviewError("accepted video does not identify its canonical candidate store")
    _assert_current(accepted, subject, "accepted video")
    inventory = _store_inventory(root, destination)
    if not inventory["claimed"] or not inventory["accepted"] or inventory["rejected"]:
        raise VideoReviewError("video candidate store has conflicting or missing terminal records")
    _, evaluation_entry = _evaluation(root, destination, subject)
    _same(accepted["evaluation_inputs"], evaluation_entry, "accepted evaluation inputs")

    attempt_value = _exact_keys(accepted["attempt"], {"id", "record"}, "accepted review attempt")
    attempt_id = _attempt_id(attempt_value["id"], "accepted review attempt id")
    if attempt_id not in inventory["attempts"]:
        raise VideoReviewError("accepted review attempt is missing from its canonical store")
    _file_entry_shape(attempt_value["record"], "accepted review attempt")
    expected_attempt = destination / f"attempt-{attempt_id}.json"
    if root / Path(attempt_value["record"]["path"]) != expected_attempt:
        raise VideoReviewError("accepted review attempt is outside its canonical store")
    attempt, attempt_entry = _read_record_entry(root, attempt_value["record"], "accepted review attempt")
    _exact_keys(attempt, set(ATTEMPT_KEYS), "video review attempt")
    if (
        attempt["schema"] != REVIEW_MANIFEST_SCHEMA or attempt["status"] != "accept"
        or attempt["attempt_id"] != attempt_id or attempt["candidate_id"] != accepted["candidate_id"]
        or attempt["review_directory"] != review_directory
    ):
        raise VideoReviewError("accepted review attempt is not an accepted review manifest")
    _assert_current(attempt, subject, "video review attempt")
    _file_entry_shape(attempt["rulings_source"], "video review attempt rulings source")
    normalized = _normalize_rulings(attempt["rulings"], subject)
    _same(normalized, attempt["rulings"], "normalized video rulings")
    normalized_attribution = {
        "decided_by": normalized["decided_by"], "decided_at": normalized["decided_at"],
    }
    if (
        normalized["decision"] != "accept" or normalized["attempt_id"] != attempt_id
        or normalized["candidate_id"] != accepted["candidate_id"]
        or attempt["attribution"] != normalized_attribution
        or accepted["attribution"] != normalized_attribution
    ):
        raise VideoReviewError("accepted review attempt and normalized rulings disagree")
    rulings_sha256 = _canonical(normalized, "normalized video rulings")
    if attempt["rulings_sha256"] != rulings_sha256 or accepted["rulings_sha256"] != rulings_sha256:
        raise VideoReviewError("normalized video rulings digest is corrupt")
    # qa_stamp is the sole writer of sample verdicts: recompute, never trust the stored stamp.
    stamp = _stamp_samples(subject, normalized)
    _assert_decision_allowed(normalized, stamp)
    _same(stamp, attempt["sample_stamp"], "video sample stamp")
    if attempt["sample_stamp_sha256"] != _canonical(stamp, "video sample stamp"):
        raise VideoReviewError("video sample stamp digest is corrupt")
    _same(attempt["evaluation_inputs"], evaluation_entry, "attempt evaluation inputs")
    _same(attempt["inputs"], _subject_inputs(subject), "attempt producer inputs")
    _same(accepted["inputs"], _subject_inputs(subject), "accepted producer inputs")
    _same(accepted["movie"], subject["assembly"]["movie"], "accepted movie")
    _same(accepted["approved_still"], subject["approved_gen"]["frame"], "accepted source still")
    _same(accepted["attribution"], attempt["attribution"], "accepted attribution")

    claim, _, claim_entry = _read_json(root, destination.relative_to(root) / CLAIM_NAME, "video terminal claim")
    expected_claim = _claim_value(normalized, stamp, review_directory)
    _exact_keys(claim, set(expected_claim), "video terminal claim")
    if _canonical(claim, "video terminal claim") != _canonical(expected_claim, "video terminal claim"):
        raise VideoReviewError("video terminal claim does not bind the acceptance")
    return {
        "subject": subject, "destination": destination, "inventory": inventory,
        "accepted": accepted, "accepted_entry": accepted_entry,
        "attempt": attempt, "attempt_entry": attempt_entry,
        "claim": claim, "claim_entry": claim_entry, "evaluation_entry": evaluation_entry,
    }


def validate_accepted_video(root: Path, accepted_video_path: Path) -> dict[str, Any]:
    try:
        root = frames._root(root)
    except frames.FrameExtractError as exc:
        raise VideoReviewError(str(exc)) from exc
    first = _accepted_snapshot(root, accepted_video_path)
    # Re-derive the current subject and re-read every trusted record after verifying them once.
    final = _accepted_snapshot(root, accepted_video_path)
    if final["destination"] != first["destination"]:
        raise VideoReviewError("accepted video canonical store changed during validation")
    _same(final["subject"], first["subject"], "accepted video current subject")
    _same(sorted(final["inventory"]["attempts"]), sorted(first["inventory"]["attempts"]), "video review store inventory")
    for key in ("accepted", "accepted_entry", "attempt", "attempt_entry", "claim", "claim_entry", "evaluation_entry"):
        _same(final[key], first[key], f"video review {key.replace('_', ' ')}")
    subject = final["subject"]
    return {
        "creator_id": subject["persona"]["projection"]["id"],
        "candidate_id": subject["candidate"]["id"],
        "movie": subject["assembly"]["movie"],
        "approved_still": subject["approved_gen"]["frame"],
        "candidate_manifest": subject["candidate"]["manifest"],
        "accepted_lineage": final["accepted_entry"],
    }



def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "apply-rulings"))
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--candidate-manifest", required=True, type=Path)
    parser.add_argument("--run-receipt", required=True, type=Path)
    parser.add_argument("--assembly-receipt", required=True, type=Path)
    parser.add_argument("--extraction-receipt", required=True, type=Path)
    parser.add_argument("--rulings", type=Path)
    args = parser.parse_args(argv)
    try:
        inputs = {
            "root": args.root, "candidate_manifest": args.candidate_manifest,
            "run_receipt": args.run_receipt, "assembly_receipt": args.assembly_receipt,
            "extraction_receipt": args.extraction_receipt,
        }
        if args.command == "prepare":
            if args.rulings is not None:
                parser.error("--rulings is only valid with apply-rulings")
            record = prepare_review(**inputs)
        else:
            if args.rulings is None:
                parser.error("apply-rulings requires --rulings")
            record = apply_rulings(**inputs, rulings=args.rulings)
    except VideoReviewError as exc:
        parser.error(str(exc))
    print(json.dumps({
        "candidate_id": record["candidate_id"],
        "review_directory": record["review_directory"],
        "status": record.get("status"),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
