"""Bounded tensor video media evidence; never grants image or video approval.

The extraction adapter verifies decoded frame pixels against the pinned source.
Its receipt is media provenance only. Existing edit/video rulings remain required.
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import math
import tempfile
import os
import sys
from fractions import Fraction
from decimal import Decimal
from datetime import datetime
from pathlib import Path

from PIL import Image


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).parent
inputs = _module("_tensor_video_input_bounds", HERE / "tensor_edit.py")
frames = inputs._PATHS
FRAME_AUTHORITY_SCHEMA = "figment/verified-frame0@1"
REQUEST_SCHEMA = "figment/tensor-video-request@1"
NATIVE_SCHEMA = "figment/tensor-native-evidence@1"


class TensorVideoError(ValueError):
    pass


def output_dimensions(width, height):
    if type(width) is not int or type(height) is not int or min(width, height) <= 0:
        raise TensorVideoError("invalid start image dimensions")
    scale = math.sqrt(int(0.5 * 1024 * 1024) / (width * height))
    first = (round(width * scale), round(height * scale))
    target = tuple((value // 32) * 32 for value in first)
    if not all(target):
        raise TensorVideoError("start image aspect is unsupported by tensor video latent bounds")
    return {"width": target[0], "height": target[1], "frames": 81, "fps": 16}


def _attribution(value):
    if any(not isinstance(value.get(key), str) or not value[key].strip()
           for key in ("decided_by", "decided_at")):
        raise TensorVideoError("video decision requires attribution")
    try:
        timestamp = datetime.fromisoformat(value["decided_at"].replace("Z", "+00:00"))
        if timestamp.tzinfo is None or timestamp.utcoffset() is None:
            raise ValueError("timezone missing")
    except ValueError as exc:
        raise TensorVideoError("video decision requires timezone-aware timestamp") from exc


def validate_driving_timing(clip):
    """Supported intake is conservatively CFR16; no inferred VHS resampling."""
    path = Path(clip["path"])
    data = frames._probe_json([frames._tool(frames.FFPROBE_PATH, "ffprobe"),
        "-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries",
        "frame=best_effort_timestamp_time", "-of", "json", frames._media_argument(path)],
        "driving clip frame timing")
    rows = data.get("frames")
    if not isinstance(rows, list) or not 81 <= len(rows) <= frames.MAX_FRAME_COUNT:
        raise TensorVideoError("driving clip requires at least81 decoded CFR16 frames")
    try:
        times = [Decimal(row["best_effort_timestamp_time"]) for row in rows]
        if any(not time.is_finite() for time in times) or any(
                abs((b-a)-Decimal("0.0625")) > Decimal("0.000001")
                for a,b in zip(times,times[1:])):
            raise ValueError("non-CFR16")
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise TensorVideoError("only verified CFR16 driving clips are currently supported") from exc
    return {"supported_policy": "CFR16-min81-no-resampling", "decoded_frames": len(rows),
            "timestamp_sha256": inputs.canonical_sha256([str(value) for value in times])}


def read_request(path, creator, *, approved_edit):
    path = inputs._path(str(path), Path.cwd())
    raw = inputs._bounded_bytes(path, inputs.MAX_JSON_BYTES)
    request, request_binding = inputs._json_binding({"path": str(path),
        "sha256": hashlib.sha256(raw).hexdigest()}, path.parent, raw=raw)
    inputs._keys(request, {"schema", "creator", "clip", "extraction_receipt", "edit",
                          "prompt", "intake", "fixture"})
    if (request["schema"] != REQUEST_SCHEMA or request["creator"] != creator
            or type(request["fixture"]) is not bool):
        raise TensorVideoError("invalid tensor video request identity/schema")
    clip = inputs.file_binding(request["clip"], path.parent, limit=frames.MAX_VIDEO_BYTES)
    selection = request["edit"]
    inputs._keys(selection, {"plan", "image_id"})
    if not isinstance(selection["image_id"], str) or not selection["image_id"]:
        raise TensorVideoError("video requires one accepted edit image id")
    edit_plan = inputs._path(selection["plan"], path.parent)
    accepted = approved_edit(creator, edit_plan, selection["image_id"],
                             driving_clip_sha256=clip["sha256"])
    if type(accepted.get("fixture")) is not bool or accepted["fixture"] and not request["fixture"]:
        raise TensorVideoError("fixture edit cannot become production video authority")
    edit = accepted["edit_inputs"]
    selected = inputs.file_binding({"path": accepted["path"], "sha256": accepted["sha256"]},
                                    path.parent, image=True)
    source_frame = edit.get("frame_source", {})
    if (edit.get("job_type") != "start-frame-head-swap" or source_frame.get("frame_index") != 0
            or source_frame.get("clip", {}).get("sha256") != clip["sha256"]):
        raise TensorVideoError("video requires accepted head swap of this exact clip frame0")
    verified = validate_frame0(clip=request["clip"],
        image={key: edit["base"][key] for key in ("path", "sha256")},
        extraction_receipt=request["extraction_receipt"], base_dir=path.parent)
    if source_frame.get("extraction_receipt") != verified["extraction_receipt"]:
        raise TensorVideoError("video extraction receipt differs from accepted edit authority")
    timing = validate_driving_timing(clip)
    prompt = request["prompt"]
    inputs._keys(prompt, {"text", "sha256", "decided_by", "decided_at"})
    if (not isinstance(prompt["text"], str) or not 0 < len(prompt["text"]) <= 16000
            or hashlib.sha256(prompt["text"].encode("utf-8")).hexdigest() != prompt["sha256"]):
        raise TensorVideoError("video prompt must be exact hash-bound text")
    _attribution(prompt)
    intake = request["intake"]
    inputs._keys(intake, {"one_person", "simple_motion", "adult", "clothed",
                         "fixture", "decided_by", "decided_at"})
    if any(intake[key] is not True for key in ("one_person", "simple_motion", "adult", "clothed")):
        raise TensorVideoError("video requires explicit one-person/simple-motion adult clothed intake")
    if intake["fixture"] is not request["fixture"]:
        raise TensorVideoError("intake ruling must retain fixture status")
    _attribution(intake)
    if Path(clip["path"]).name.casefold() == Path(selected["path"]).name.casefold():
        raise TensorVideoError("video input basenames collide")
    if approved_edit(creator, edit_plan, selection["image_id"],
                     driving_clip_sha256=clip["sha256"]) != accepted:
        raise TensorVideoError("accepted edit changed during video input verification")
    result = {"schema": REQUEST_SCHEMA, "creator": creator, "fixture": request["fixture"],
              "request": request_binding, "clip": clip, "start_image": selected,
              "accepted_edit": accepted, "frame0": verified, "timing": timing,
              "prompt": prompt, "intake": intake}
    result["input_sha256"] = inputs.canonical_sha256(result)
    return result


def _object(text, label):
    if not isinstance(text, str) or not 0 < len(text.encode("utf-8")) <= 256 * 1024:
        raise TensorVideoError(f"{label} must be bounded JSON text")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise TensorVideoError(f"{label} contains duplicate keys")
            result[key] = value
        return result
    def nonfinite(_value):
        raise TensorVideoError(f"{label} contains non-finite numbers")
    try:
        value = json.loads(text, object_pairs_hook=unique, parse_constant=nonfinite)
    except (ValueError, RecursionError) as exc:
        raise TensorVideoError(f"{label} is malformed JSON") from exc
    if not isinstance(value, dict):
        raise TensorVideoError(f"{label} must be an object")
    return value


def inspect_movie(*, movie, base_dir, submitted_workflow, expected_dimensions):
    """Verify native MP4 metadata and actual VHS comment.prompt graph evidence.

    This proves only the declared graph is embedded in these movie bytes. A fixture
    can manufacture such metadata, so the caller must separately bind the harness
    job/prompt receipt and retain fixture restrictions and the existing eye gate.
    """
    try:
        binding = inputs.file_binding(movie, base_dir, limit=512 * 1024 * 1024)
        path = Path(binding["path"])
        if path.suffix.lower() != ".mp4":
            raise TensorVideoError("native tensor movie must be MP4")
        root = frames._root(path.parent)
        basic = frames._probe_video(root, Path(path.name))
        timing = validate_driving_timing(binding)
        if (basic["frame_count"] != 81 or
                (basic["width"], basic["height"]) != tuple(expected_dimensions)):
            raise TensorVideoError("native movie dimensions or frame count differ from graph")
        probe = frames._probe_json([
            frames._tool(frames.FFPROBE_PATH, "ffprobe"), "-v", "error",
            "-show_entries", "stream=codec_type,codec_name,pix_fmt,avg_frame_rate:format_tags=comment",
            "-of", "json", frames._media_argument(path)], "tensor native movie metadata")
        streams = probe.get("streams")
        if not isinstance(streams, list) or len(streams) != 1 or not isinstance(streams[0], dict):
            raise TensorVideoError("native movie requires one video stream and no audio")
        stream = streams[0]
        if (stream.get("codec_type") != "video" or stream.get("codec_name") != "h264"
                or stream.get("pix_fmt") != "yuv420p"
                or Fraction(stream.get("avg_frame_rate", "0")) != 16):
            raise TensorVideoError("native movie codec, pixel format or fps differs from graph")
        format_data = probe.get("format")
        tags = format_data.get("tags") if isinstance(format_data, dict) else None
        comment = _object(tags.get("comment") if isinstance(tags, dict) else None,
                          "VHS MP4 comment")
        embedded = _object(comment.get("prompt"), "VHS prompt")
        if "workflow" in comment and not isinstance(comment["workflow"], dict):
            raise TensorVideoError("VHS optional workflow metadata must be an object")
        canonical = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True,
            separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")).hexdigest()
        if canonical(embedded) != canonical(submitted_workflow):
            raise TensorVideoError("embedded movie prompt graph differs from submitted workflow")
        if binding != inputs.file_binding(movie, base_dir, limit=512 * 1024 * 1024):
            raise TensorVideoError("native movie changed during verification")
        return {"schema": "figment/tensor-native-movie@1", "movie": binding,
                "metadata": basic, "codec": "h264", "pixel_format": "yuv420p", "fps": 16,
                "timing": timing,
                "embedded_prompt_sha256": canonical(embedded),
                "embedded_workflow_sha256": canonical(comment["workflow"]) if "workflow" in comment else None,
                "execution_claim": "embedded-graph-only; harness authority required",
                "not_promotable": True}
    except (OSError, ValueError, ZeroDivisionError) as exc:
        if isinstance(exc, TensorVideoError):
            raise
        raise TensorVideoError(f"native movie verification failed: {exc}") from exc


def _pixels(binding):
    """Hash exact decoded RGB pixels, independent of PNG compression/metadata."""
    path = inputs._path(binding["path"], Path.cwd())
    with path.open("rb") as handle:
        raw = handle.read(inputs.MAX_IMAGE_BYTES + 1)
    if len(raw) != binding["bytes"] or hashlib.sha256(raw).hexdigest() != binding["sha256"]:
        raise TensorVideoError("frame bytes changed during pixel verification")
    with Image.open(io.BytesIO(raw)) as image:
        if image.n_frames != 1 or image.width * image.height > inputs.MAX_PIXELS:
            raise TensorVideoError("frame must be one bounded decoded image")
        image.load()
        rgb = image.convert("RGB")
        return {"width": rgb.width, "height": rgb.height, "mode": "RGB",
                "sha256": hashlib.sha256(rgb.tobytes()).hexdigest()}


def _decoder_identity(path, label):
    executable = Path(frames._tool(path, label))
    identity = frames._hash_file(frames._root(executable.parent), Path(executable.name),
                                label, 512 * 1024 * 1024)
    version = frames._run_bounded_stdout([str(executable), "-version"],
                                         label + " version", 64 * 1024)
    text = version.stdout.decode("utf-8", errors="strict")
    if not text.strip():
        raise TensorVideoError("decoder version is missing")
    return {"path": str(executable), "sha256": identity["sha256"],
            "bytes": identity["bytes"], "version": text.splitlines()[0]}


def validate_frame0(*, clip, image, extraction_receipt, base_dir):
    """Re-decode frame0, preserving byte bindings and recording decoder identity.

    ``clip``, ``image`` and ``extraction_receipt`` are explicit path/SHA pairs.
    The receipt is checked against a fresh probe and fresh decoded RGB pixels;
    neither a transform label nor a receipt hash alone establishes frame authority.
    Temporary extraction is contained beside the source and removed on failure.
    """
    try:
        source = inputs.file_binding(clip, base_dir, limit=frames.MAX_VIDEO_BYTES)
        selected = inputs.file_binding(image, base_dir, image=True)
        receipt, receipt_binding = inputs._json_binding(extraction_receipt, base_dir)
        source_path = Path(source["path"])
        root = frames._root(source_path.parent)
        relative = Path(source_path.name)
        metadata = frames._probe_video(root, relative)
        before, after = receipt.get("video_before"), receipt.get("video_after")
        rows = receipt.get("frames")
        if (receipt.get("schema") != frames.SCHEMA or receipt.get("not_promotable") is not True
                or not isinstance(before, dict) or before != after
                or before.get("sha256") != source["sha256"] or before.get("bytes") != source["bytes"]
                or receipt.get("metadata") != metadata
                or not isinstance(rows, list) or not 1 <= len(rows) <= 3):
            raise TensorVideoError("extraction receipt does not match freshly probed clip")
        first = [row for row in rows if isinstance(row, dict) and type(row.get("index")) is int
                 and row["index"] == 0]
        if (len(first) != 1 or first[0].get("label") != "first"
                or first[0].get("sha256") != selected["sha256"]
                or first[0].get("bytes") != selected["bytes"]):
            raise TensorVideoError("extraction receipt does not bind selected frame0 bytes")
        tools = {"ffmpeg": _decoder_identity(frames.FFMPEG_PATH, "ffmpeg"),
                 "ffprobe": _decoder_identity(frames.FFPROBE_PATH, "ffprobe")}
        temporary = Path(tempfile.mkdtemp(prefix=".tensor-frame0-", dir=root))
        try:
            relative_output = Path(temporary.name) / "frame0.png"
            frames._extract_one(root, relative, relative_output, 0)
            decoded = frames._hash_file(root, relative_output, "decoded frame0", frames.MAX_FRAME_BYTES)
            decoded["path"] = str(root / relative_output)
            pixels = _pixels(selected)
            if pixels != _pixels(decoded):
                raise TensorVideoError("selected frame is not exact decoded frame0")
        finally:
            frames._cleanup_owned_directory(root, temporary)
        if source != inputs.file_binding(clip, base_dir, limit=frames.MAX_VIDEO_BYTES):
            raise TensorVideoError("clip changed during frame0 validation")
        if selected != inputs.file_binding(image, base_dir, image=True):
            raise TensorVideoError("frame0 changed during validation")
        if receipt_binding != inputs._json_binding(extraction_receipt, base_dir)[1]:
            raise TensorVideoError("extraction receipt changed during validation")
        result = {"schema": FRAME_AUTHORITY_SCHEMA, "clip": source, "frame": selected,
                  "extraction_receipt": receipt_binding, "frame_index": 0,
                  "comparison": "exact-decoded-RGB-pixels", "pixels": pixels,
                  "metadata": metadata, "decoders": tools, "not_promotable": True}
        result["authority_sha256"] = inputs.canonical_sha256(result)
        return result
    except (OSError, ValueError, UnicodeError) as exc:
        if isinstance(exc, TensorVideoError):
            raise
        raise TensorVideoError(f"frame0 verification failed: {exc}") from exc


def _record(root, path, limit):
    relative = path.relative_to(root)
    return frames._hash_file(root, relative, "tensor video evidence", limit)


def _json(root, relative):
    path = frames._within(root, relative, "tensor video JSON")
    raw = inputs._bounded_bytes(path, 1024 * 1024)
    value = _object(raw.decode("utf-8"), "tensor video JSON")
    return value, {"path": relative.as_posix(), "bytes": len(raw),
                   "sha256": hashlib.sha256(raw).hexdigest()}


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True, allow_nan=False)
        handle.write("\n")


def execution_movie(root, manifest, run_path):
    """Bind one node49 movie to the actual submitted graph and exact prompt receipt."""
    run, run_binding = _json(root, run_path.relative_to(root))
    jobs = run.get("jobs")
    expected = manifest["jobs"][0]
    if (run.get("error") or run.get("termination_verified") is not True
            or not isinstance(jobs, list) or len(jobs) != 1):
        raise TensorVideoError("native movie requires one successful terminated run")
    fixture = manifest.get("fixture") is True
    if run.get("dry_run") is not False and not (
            fixture and run.get("fixture") is True and run.get("no_model_execution") is True):
        raise TensorVideoError("simulated harness output is not native movie evidence")
    job = jobs[0]
    if job.get("output_name") != expected["output_name"] or job.get("seed") != expected["seed"]:
        raise TensorVideoError("native movie job does not match manifest")
    runner = _module("_tensor_video_receipt_runner", HERE / "pod/runpod_run.py")
    graph = runner.apply_job(manifest["workflow"], expected, runner.manifest_seed_fields(manifest))
    graph_sha = inputs.canonical_sha256(graph)
    if job.get("effective_workflow_sha256") != graph_sha:
        raise TensorVideoError("native movie receipt lacks exact submitted graph digest")
    outputs = job.get("files")
    if not isinstance(outputs, list) or len(outputs) != 1:
        raise TensorVideoError("native movie receipt requires exactly one declared output")
    row = outputs[0]
    if (row.get("node_id") != "49" or row.get("role") != "video"
            or row.get("media_type") != "video/mp4" or not isinstance(job.get("prompt_id"), str)
            or not job["prompt_id"] or row.get("prompt_id") != job["prompt_id"]):
        raise TensorVideoError("native movie receipt has wrong node/role/prompt authority")
    remote = row.get("remote")
    if not isinstance(remote, dict) or remote.get("type") != "output":
        raise TensorVideoError("native movie receipt lacks remote output descriptor")
    runner.contract_view_params(remote, "video/mp4")
    relative = Path(row.get("path", ""))
    path = frames._within(run_path.parent, relative, "native movie")
    actual = _record(root, path, 512 * 1024 * 1024)
    if any(actual[key] != row.get(key) for key in ("bytes", "sha256")):
        raise TensorVideoError("native movie bytes differ from run receipt")
    budget = manifest["native_budget"]
    proof = inspect_movie(movie={"path": str(path), "sha256": actual["sha256"]}, base_dir=root,
        submitted_workflow=graph, expected_dimensions=(budget["width"], budget["height"]))
    return {"movie": actual, "proof": proof, "run": run_binding, "job": job,
            "graph": graph, "graph_sha256": graph_sha, "fixture": fixture}


def build_native_evidence(root, manifest_path, run_path, *, validate_inputs):
    root = frames._root(root)
    manifest, manifest_binding = _json(root, manifest_path.relative_to(root))
    validate_inputs()
    verified = execution_movie(root, manifest, run_path)
    directory = root / "video/evidence/native"
    receipt_path = directory / "native-evidence.json"
    if receipt_path.is_file():
        value, _ = _json(root, receipt_path.relative_to(root))
        validate_native_evidence(root, value, verified, manifest_binding)
        return value
    if directory.exists():
        raise TensorVideoError("partial native evidence directory requires explicit recovery")
    relative_directory = directory.relative_to(root)
    partial = Path()
    for component in relative_directory.parts:
        partial /= component
        operand = root / partial
        if not frames._exists(operand):
            frames._within(root, partial, "native evidence directory", must_exist=False)
            operand.mkdir()
        frames._within(root, partial, "native evidence directory")
    try:
        pattern = directory / "frame-%03d.png"
        frames._within(root,pattern.relative_to(root),"decoded frame pattern",must_exist=False)
        frames._run([frames._tool(frames.FFMPEG_PATH, "ffmpeg"), "-v", "error", "-i",
            frames._media_argument(root / verified["movie"]["path"]), "-vsync", "0", "-frames:v", "81",
            "-start_number", "0", frames._media_argument(pattern)], "tensor native review frame extraction")
        records = []
        for index in range(81):
            path = directory / f"frame-{index:03d}.png"
            record = _record(root, path, frames.MAX_FRAME_BYTES)
            bound = inputs.file_binding({"path": str(path), "sha256": record["sha256"]}, root, image=True)
            if (bound["width"], bound["height"]) != (manifest["native_budget"]["width"], manifest["native_budget"]["height"]):
                raise TensorVideoError("decoded native frame dimensions changed")
            records.append({**record, "index": index, "provenance": "locally-decoded-native-mp4"})
        if len(list(directory.iterdir())) != 81:
            raise TensorVideoError("unexpected decoded native evidence files")
        value = {"schema": NATIVE_SCHEMA, "not_promotable": True, "fixture": verified["fixture"],
            "manifest": manifest_binding, "run_receipt": verified["run"],
            "movie": verified["movie"], "metadata": manifest["native_budget"],
            "embedded_prompt_sha256": verified["graph_sha256"], "frames": records}
        validate_inputs()
        if execution_movie(root, manifest, run_path) != verified:
            raise TensorVideoError("native movie authority changed during extraction")
        _write(receipt_path, value)
        return value
    except Exception:
        frames._cleanup_owned_directory(root, directory)
        raise


def validate_native_evidence(root, value, verified, manifest_binding):
    expected_metadata = {"width":verified["proof"]["metadata"]["width"],
        "height":verified["proof"]["metadata"]["height"], "frames":81, "fps":16}
    if (value.get("schema") != NATIVE_SCHEMA or value.get("not_promotable") is not True
            or value.get("manifest") != manifest_binding or value.get("run_receipt") != verified["run"]
            or value.get("movie") != verified["movie"]
            or value.get("embedded_prompt_sha256") != verified["graph_sha256"]
            or value.get("fixture") is not verified["fixture"] or value.get("metadata") != expected_metadata):
        raise TensorVideoError("native evidence receipt is stale")
    rows = value.get("frames")
    if not isinstance(rows, list) or len(rows) != 81:
        raise TensorVideoError("native evidence requires81 decoded frames")
    total = 0
    for index, row in enumerate(rows):
        actual = frames._hash_file(root, Path(row["path"]), "decoded native frame", frames.MAX_FRAME_BYTES)
        total += actual["bytes"]
        if (any(actual[key] != row.get(key) for key in ("path", "bytes", "sha256"))
                or row.get("index") != index or row.get("provenance") != "locally-decoded-native-mp4"
                or total > 512 * 1024 * 1024):
            raise TensorVideoError("decoded native frame evidence changed")
    # A mutable receipt cannot certify its own replacement PNGs. Re-decode the
    # pinned movie and compare all ordered RGB pixels whenever evidence is reused.
    temporary = Path(tempfile.mkdtemp(prefix=".tensor-sequence-", dir=root))
    try:
        frames._within(root,(temporary/"frame-%03d.png").relative_to(root),"verification frame pattern",must_exist=False)
        frames._run([frames._tool(frames.FFMPEG_PATH,"ffmpeg"),"-v","error","-i",
            frames._media_argument(root/verified["movie"]["path"]),"-vsync","0","-frames:v","81",
            "-start_number","0",frames._media_argument(temporary/"frame-%03d.png")],
            "native sequence provenance verification")
        for index,row in enumerate(rows):
            decoded = _record(root,temporary/f"frame-{index:03d}.png",frames.MAX_FRAME_BYTES)
            decoded["path"] = str(root/decoded["path"])
            original = {**row,"path":str(root/row["path"])}
            if _pixels(original) != _pixels(decoded):
                raise TensorVideoError("review frame is not decoded from the bound native movie")
        if _record(root,root/verified["movie"]["path"],512*1024*1024) != verified["movie"]:
            raise TensorVideoError("native movie changed during sequence verification")
    finally:
        frames._cleanup_owned_directory(root,temporary)
    return value


def review_subject(root, candidate_relative, run_relative, assembly_relative, extraction_relative):
    """Versioned native subject consumed by the existing video eye-gate writer."""
    manifest, manifest_binding = _json(root, candidate_relative)
    if manifest.get("schema") != "figment/tensor-video-manifest@1":
        raise TensorVideoError("not a tensor native movie candidate")
    # Reuse the canonical driver approval adapters; no second approval implementation.
    driver = _module("_tensor_video_review_driver", HERE / "figment_train.py")
    plan_path = Path(manifest["source_plan"])
    plan, plan_root = driver._load_plan(manifest["tensor_inputs"]["creator"], plan_path)
    if plan_root.resolve() != root.resolve():
        raise TensorVideoError("tensor candidate does not belong to this plan root")
    frozen = driver._validate_tensor_video_inputs(plan, plan_root)
    if frozen != manifest["tensor_inputs"]:
        raise TensorVideoError("native candidate source authority changed")
    verified = execution_movie(root, manifest, root / run_relative)
    evidence, evidence_binding = _json(root, assembly_relative)
    validate_native_evidence(root, evidence, verified, manifest_binding)
    if extraction_relative != assembly_relative:
        raise TensorVideoError("native video samples must use its decoded evidence receipt")
    persona, training = driver._current_persona_training(plan)
    persona = {**persona, "training": {key:training.get(key) for key in driver.EDIT_TRAINING_KEYS}}
    samples = [{**{key:evidence["frames"][index][key] for key in ("path","bytes","sha256")},
                "label": label, "index": index} for label,index in (("first",0),("middle",40),("last",80))]
    selected = {key:frozen["start_image"][key] for key in ("path","bytes","sha256")}
    return {"schema": "figment/tensor-native-review-subject@1", "fixture": frozen["fixture"],
            "runtime_admitted": False,
        "candidate": {"id":manifest["candidate_id"], "manifest":manifest_binding},
        "approved_edit": {"frame":selected,"authority":frozen["accepted_edit"],"frame0":frozen["frame0"]},
        "video_inputs":frozen, "persona":{"projection":driver._lineage_module().persona_input_projection(persona)},
        "workflow":{"job_graph":verified["graph"],"job_graph_sha256":verified["graph_sha256"],
                    "mp4_prompt_graph_verified":True},
        "run":{"receipt":verified["run"],"job":verified["job"]},
        "sequence":{"frames":evidence["frames"],"frames_sha256":inputs.canonical_sha256(evidence["frames"]),
                    "provenance":"locally-decoded-native-mp4"},
        "assembly":{"receipt":evidence_binding,"movie":verified["movie"],"metadata":evidence["metadata"]},
        "extraction":{"receipt":evidence_binding,"frames":samples,"metadata":evidence["metadata"]}}
