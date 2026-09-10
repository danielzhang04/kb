#!/usr/bin/env python3
"""Prepare one current Figment video candidate for later offline review."""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import math
import os
import stat
import struct
import sys
from pathlib import Path
from typing import Any


SCHEMA = "figment/video-evaluation-inputs@1"
STATUS = "prepared"
REVIEW_DIRECTORY = "video-review"
MAX_JSON_BYTES = 1024 * 1024
MAX_PROMPT_BYTES = 256 * 1024
MAX_ENTRIES = 20_000
MAX_TEXT_CHARS = 64 * 1024
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
        before = path.stat()
        if not stat.S_ISREG(before.st_mode) or before.st_size <= 0 or before.st_size > MAX_JSON_BYTES:
            raise VideoReviewError(f"{label} must be a regular JSON file no larger than {MAX_JSON_BYTES} bytes")
        with path.open("rb") as handle:
            opened = os.fstat(handle.fileno())
            raw = handle.read(MAX_JSON_BYTES + 1)
            finished = os.fstat(handle.fileno())
        after = path.stat()
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


def _prompt_text(path: Path) -> str:
    found: list[str] = []
    try:
        with path.open("rb") as handle:
            if handle.read(8) != PNG_SIGNATURE:
                raise VideoReviewError("candidate frame is not a PNG")
            while True:
                header = handle.read(8)
                if len(header) != 8:
                    raise VideoReviewError("candidate PNG metadata is truncated")
                length, kind = struct.unpack(">I4s", header)
                if length > frames.MAX_FRAME_BYTES:
                    raise VideoReviewError("candidate PNG chunk is too large")
                if kind in (b"tEXt", b"iTXt", b"zTXt"):
                    if length > MAX_PROMPT_BYTES:
                        raise VideoReviewError("candidate PNG text metadata is too large")
                    payload = handle.read(length)
                    if len(payload) != length or len(handle.read(4)) != 4:
                        raise VideoReviewError("candidate PNG metadata is truncated")
                    keyword, separator, remainder = payload.partition(b"\0")
                    if separator and keyword == b"prompt":
                        if kind == b"tEXt":
                            found.append(remainder.decode("latin-1"))
                        else:
                            raise VideoReviewError("candidate prompt metadata must use the pinned native tEXt form")
                else:
                    handle.seek(length + 4, os.SEEK_CUR)
                if kind == b"IEND":
                    break
    except (OSError, UnicodeError, struct.error) as exc:
        raise VideoReviewError("cannot read candidate PNG prompt metadata") from exc
    if len(found) != 1 or len(found[0].encode("utf-8")) > MAX_PROMPT_BYTES:
        raise VideoReviewError("candidate PNG must contain exactly one bounded prompt graph")
    return found[0]


def _prompt_graph(path: Path, expected_sha256: str) -> None:
    source = _prompt_text(path)
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
    if (root / replay).exists():
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
        current = _record(root, {"path": (run_dir / item["path"]).as_posix(), "bytes": item["bytes"], "sha256": assembly_frames[index - 1].get("sha256")}, "candidate frame", frames.MAX_FRAME_BYTES)
        current["index"] = index
        _same(current, assembly_frames[index - 1], "assembly frame")
        total += current["bytes"]
        if total > assembly.MAX_TOTAL_FRAME_BYTES:
            raise VideoReviewError("candidate frames exceed the aggregate byte limit")
        _prompt_graph(root / Path(current["path"]), executed_sha256)
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
    created = False
    try:
        destination.relative_to(root)
        parent_relative = destination.parent.relative_to(root)
        destination_relative = destination.relative_to(root)
        parent = frames._within(root, parent_relative, "review parent", must_exist=False)
        if not parent.exists():
            parent.mkdir()
        parent = frames._within(root, parent_relative, "review parent")
        if destination.exists() or destination.is_symlink():
            raise VideoReviewError("video candidate review directory must be fresh")
        destination.mkdir()
        created = True
        destination = frames._within(root, destination_relative, "review directory")
        final, final_destination = _subject(*arguments)
        if final_destination != destination or _canonical(before, "video review subject") != _canonical(final, "video review subject"):
            raise VideoReviewError("video review evidence changed before publication")
        record = lineage.wrap_subject(
            SCHEMA, final, status=STATUS,
            candidate_id=final["candidate"]["id"],
            review_directory=destination_relative.as_posix(),
        )
        _bounded(record, "video evaluation inputs")
        target = destination / "evaluation-inputs.json"
        with target.open("x", encoding="utf-8") as handle:
            json.dump(record, handle, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False)
            handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
        return record
    except VideoReviewError:
        if created:
            frames._cleanup_owned_directory(root, destination)
        raise
    except (OSError, frames.FrameExtractError) as exc:
        if created:
            frames._cleanup_owned_directory(root, destination)
        raise VideoReviewError("cannot create fresh video review preparation") from exc
    except Exception:
        if created:
            frames._cleanup_owned_directory(root, destination)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare",))
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--candidate-manifest", required=True, type=Path)
    parser.add_argument("--run-receipt", required=True, type=Path)
    parser.add_argument("--assembly-receipt", required=True, type=Path)
    parser.add_argument("--extraction-receipt", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        record = prepare_review(
            root=args.root, candidate_manifest=args.candidate_manifest,
            run_receipt=args.run_receipt, assembly_receipt=args.assembly_receipt,
            extraction_receipt=args.extraction_receipt,
        )
    except VideoReviewError as exc:
        parser.error(str(exc))
    print(json.dumps({"candidate_id": record["candidate_id"], "review_directory": record["review_directory"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
