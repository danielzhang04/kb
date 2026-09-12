from __future__ import annotations

"""Contract tests for the bounded vertical-delivery preparation review.

The deliberately expensive fixture below is the same real local producer chain used by
the accepted-video ruling tests.  It is synthetic mechanics evidence only: it creates
an approved gen still, candidate, 81 prompt-bound PNGs, an FFmpeg-native movie and a
real accepted-video authority before the delivery module is called.
"""

import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import pytest
from PIL import Image, PngImagePlugin

import test_video_rulings as native_tests


VIDEO_DIR = Path(__file__).resolve().parents[1]
DELIVERY_PATH = VIDEO_DIR / "video_delivery_review.py"


def _load_delivery():
    spec = importlib.util.spec_from_file_location("figment_video_delivery_review_test", DELIVERY_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


delivery = _load_delivery()
review = native_tests.review


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding="utf-8")


def _entry(root: Path, path: Path) -> dict[str, object]:
    return {
        "path": path.relative_to(root).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": _sha(path),
    }


def _accepted_native_video(root: Path) -> tuple[Path, dict[str, object]]:
    """Build the existing accepted authority without stubbing it or its extractor."""
    gen_tests = native_tests._load("figment_delivery_gen_helpers", review.HERE.parent / "tests" / "test_gen_stage.py")
    command = native_tests._load("figment_delivery_train", review.HERE.parent / "figment_train.py")
    personas = root / "personas"
    gen_tests._promoted_persona(personas, creator_id="creator-002", steps=3000)
    gen_tests._prepare_accepted_checkpoint(command, personas, root)
    out = root / "approved-gen-video"
    plan = command.build_plan("creator-002", "gen", out, personas_root=personas, skip_pin_verify=True)
    gen_tests.anchor_stage_test._fake_stage_outputs(out, plan, "gen")
    grade = command.build_grade("creator-002", "gen", out / "plan.json", skip_judge=True)
    gen_rulings = gen_tests.load_json(Path(grade["rulings_template"]))
    for row in gen_rulings["rulings"]:
        row.update(gen_tests.anchor_stage_test._axes(), decision="keep")
    gen_rulings.update({"decided_by": "operator-fixture", "decided_at": "2026-09-10T06:00:00Z"})
    gen_rulings_path = out / "gen-rulings.json"
    _write(gen_rulings_path, gen_rulings)
    command.apply_rulings("creator-002", "gen", out / "plan.json", gen_rulings_path)
    image_id = gen_tests.load_json(out / "grade" / "gen" / "approved-list.json")["images"][0]["image_id"]
    authority = command.validate_approved_gen_still("creator-002", out / "plan.json", image_id)
    source_persona = (command.ROOT / plan["assets"]["persona_dir"] / "persona.yaml").resolve()
    candidate_relative = Path(authority["path"]).relative_to(root).parent / "review-candidate.json"
    candidate = review.video.write_manifest(
        root=root, persona_path=source_persona.relative_to(root),
        approved_gen_plan=(out / "plan.json").relative_to(root), approved_gen_image_id=image_id,
        action="walk slowly toward the camera", out=candidate_relative, seed=77,
        mode=review.video.CANDIDATE_MODE,
    )
    job = candidate["jobs"][0]
    graph = review.runner.apply_job(candidate["workflow"], job, review.runner.manifest_seed_fields(candidate))
    graph["56"]["inputs"]["is_changed"] = [authority["sha256"]]
    prompt = json.dumps(graph, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    run_dir = root / "candidate-run"; run_dir.mkdir()
    files = []
    for index in range(1, 82):
        frame = run_dir / f"{job['output_name']}_{index:02d}.png"
        metadata = PngImagePlugin.PngInfo(); metadata.add_text("prompt", prompt)
        Image.new("RGB", (1280, 704), (index % 255, 75, 95)).save(frame, pnginfo=metadata)
        files.append({"path": frame.name, "bytes": frame.stat().st_size})
    run_path = run_dir / "run.json"
    _write(run_path, {
        "schema": "figment/runpod-run@1", "dry_run": False,
        "pod_id": "synthetic-delivery-review-fixture", "termination_verified": True,
        "placement_attempts": [{"termination_verified": True}],
        "jobs": [{"job": 1, "output_name": job["output_name"], "seed": job["seed"], "files": files}],
    })
    review.assembly.assemble_frames(root=root, manifest_path=candidate_relative,
        run_receipt_path=run_path.relative_to(root), output_dir=Path("candidate-assembly"))
    review.frames.extract_frames(root=root, video_path=Path("candidate-assembly/candidate.mp4"),
        output_dir=Path("candidate-samples"))
    prepared = review.prepare_review(root=root, candidate_manifest=candidate_relative,
        run_receipt=run_path.relative_to(root), assembly_receipt=Path("candidate-assembly/frame-assembly.json"),
        extraction_receipt=Path("candidate-samples/frame-extraction.json"))
    rulings_path = root / "accepted-video-rulings.json"
    _write(rulings_path, native_tests._rulings(prepared, "delivery-accept"))
    review.apply_rulings(root=root, candidate_manifest=candidate_relative,
        run_receipt=run_path.relative_to(root), assembly_receipt=Path("candidate-assembly/frame-assembly.json"),
        extraction_receipt=Path("candidate-samples/frame-extraction.json"), rulings=rulings_path.relative_to(root))
    store = review._review_directory(root / candidate_relative, candidate["candidate_id"])
    accepted = store / "accepted-video.json"
    return accepted, review.validate_accepted_video(root, accepted.relative_to(root))


def _derivative(root: Path, accepted_movie: Path) -> Path:
    """Decode the accepted movie, apply the declared 0-origin hold map, then FFmpeg encode."""
    render = root / "delivery-render"; source = render / "native"; target = render / "held"
    source.mkdir(parents=True); target.mkdir()
    ffmpeg = str(review.frames.FFMPEG_PATH)
    subprocess.run([ffmpeg, "-v", "error", "-i", str(accepted_movie), "-frames:v", "81",
                    str(source / "native-%03d.png")], check=True, timeout=120)
    for index in range(152):
        native_index = min(80, (index * 16) // 30) + 1
        os.link(source / f"native-{native_index:03d}.png", target / f"held-{index:03d}.png")
    output = root / "delivery.mp4"
    subprocess.run([
        ffmpeg, "-v", "error", "-framerate", "30", "-start_number", "0", "-i", str(target / "held-%03d.png"),
        "-frames:v", "152", "-vf", "crop=396:704:442:0,scale=1080:1920:flags=lanczos,setsar=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-metadata:s:v:0", "rotate=0", "-an",
        # Explicit MP4 timescales preserve the exact 152-frame/30-second fixture duration.
        "-movie_timescale", "15360", "-video_track_timescale", "15360", str(output),
    ], check=True, timeout=180)
    return output


def _declaration(root: Path, authority: dict[str, object], derivative: Path) -> Path:
    declaration = root / "transform-declaration.json"
    movie = authority["movie"]
    assert isinstance(movie, dict)
    _write(declaration, {
        "schema": "figment/video-delivery-transform-declaration@1",
        "accepted_lineage_sha256": authority["accepted_lineage"]["sha256"],
        "source_movie_sha256": movie["sha256"], "derivative_sha256": _sha(derivative), "template_id": "RT-2",
        "spatial": {"method": "crop-scale-lanczos-v1", "source_rect": {"x": 442, "y": 0, "width": 396, "height": 704},
                    "target": {"width": 1080, "height": 1920}},
        "temporal": {"method": "hold-last-sample-30fps-v1", "source_frames": 81, "source_fps": "16/1",
                     "target_frames": 152, "target_fps": "30/1"},
        "audio": {"state": "absent"}, "declared_by": "bounded-attribution", "declared_at": "2026-09-11T00:00:00Z",
    })
    return declaration


@pytest.fixture(scope="module")
def accepted_base(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path, dict[str, object], Path]:
    root = tmp_path_factory.mktemp("v")
    accepted, authority = _accepted_native_video(root)
    derivative = _derivative(root, root / authority["movie"]["path"])
    return root, accepted, authority, _declaration(root, authority, derivative)


@pytest.fixture
def delivery_case(accepted_base: tuple[Path, Path, dict[str, object], Path]):
    """Reuse the one real authority in place; its lineage records need not relocate."""
    root, accepted, _, declaration = accepted_base
    authority = review.validate_accepted_video(root, accepted.relative_to(root))
    derivative = root / "delivery.mp4"
    original_accepted = accepted.read_bytes()
    original_declaration = declaration.read_bytes()
    original_derivative = derivative.read_bytes()
    try:
        yield root, authority, declaration, derivative
    finally:
        accepted.write_bytes(original_accepted)
        declaration.write_bytes(original_declaration)
        derivative.write_bytes(original_derivative)
        delivery_parent = derivative.parent / "video-delivery-review"
        if delivery_parent.exists():
            shutil.rmtree(delivery_parent)


def _prepare(root: Path, authority: dict[str, object], declaration: Path, derivative: Path) -> dict[str, object]:
    return delivery.prepare_delivery_review(
        root=root, accepted_video_path=Path(authority["accepted_lineage"]["path"]),
        expected_accepted_lineage_sha256=authority["accepted_lineage"]["sha256"], derivative_path=derivative.relative_to(root),
        template_id="RT-2", transform_declaration_path=declaration.relative_to(root),
    )


def test_real_chain_prepares_and_revalidates_closed_nonpromotable_subject(
    delivery_case: tuple[Path, dict[str, object], Path, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, authority, declaration, derivative = delivery_case
    native_calls: list[Path] = []
    actual_native = delivery.video_review.validate_accepted_video

    def counted_native(root_arg: Path, accepted_arg: Path) -> dict[str, object]:
        native_calls.append(accepted_arg)
        return actual_native(root_arg, accepted_arg)

    monkeypatch.setattr(delivery.video_review, "validate_accepted_video", counted_native)
    evaluation = _prepare(root, authority, declaration, derivative)
    assert len(native_calls) == 2
    assert set(evaluation) == {"schema", "status", "not_promotable", "review_directory", "subject", "subject_sha256"}
    assert evaluation["schema"] == "figment/video-delivery-evaluation-inputs@1"
    assert evaluation["status"] == "prepared" and evaluation["not_promotable"] is True
    subject = evaluation["subject"]
    assert set(subject) == {"identity", "native_authority", "template", "transform_declaration", "tools", "derivative", "extraction", "limitations"}
    assert subject["identity"]["value"]["accepted_lineage_sha256"] == authority["accepted_lineage"]["sha256"]
    assert subject["identity"]["sha256"] == review.lineage.canonical_sha256(subject["identity"]["value"])
    assert subject["native_authority"]["movie"] == authority["movie"]
    assert Path(subject["template"]["file"]["path"]).resolve() == delivery.TEMPLATE_PATH.resolve()
    assert subject["tools"]["ffmpeg"]["sha256"] == "5af82a0d4fe2b9eae211b967332ea97edfc51c6b328ca35b827e73eac560dc0d"
    assert subject["tools"]["ffprobe"]["sha256"] == "192a1d6899059765ac8c39764fc3148d4e6049955956dc2029f81f4bd6a8972d"
    assert subject["derivative"]["video"] == {"codec": "h264", "pixel_format": "yuv420p", "width": 1080, "height": 1920, "sample_aspect_ratio": "1:1", "rotation_degrees": 0}
    cadence = subject["derivative"]["presentation_cadence"]
    assert cadence["fps"] == "30/1" and cadence["frame_count"] == 152 and cadence["duration_seconds"] == "76/15"
    review_dir = root / evaluation["review_directory"]
    assert (review_dir / "evaluation-inputs.json").is_file()
    worst_case = review_dir / (".validate-" + "f" * 32) / "samples" / (".first." + "f" * 32 + ".tmp.png")
    assert len(str(worst_case)) < 260, worst_case
    assert [row["index"] for row in subject["extraction"]["samples"]] == [0, 76, 151]
    native_calls.clear()
    result = delivery.validate_prepared_delivery(root, (review_dir / "evaluation-inputs.json").relative_to(root))
    assert len(native_calls) == 2
    assert set(result) == {"review_directory", "subject_sha256", "accepted_lineage", "source_movie", "derivative", "template", "transform_declaration", "extraction_receipt", "tools"}
    assert result["subject_sha256"] == evaluation["subject_sha256"]
    assert not list(review_dir.glob(".validate-*"))
    cli = subprocess.run([
        sys.executable, "-I", "-B", str(DELIVERY_PATH), "validate", "--root", str(root),
        "--evaluation", (review_dir / "evaluation-inputs.json").relative_to(root).as_posix(),
    ], capture_output=True, text=True, timeout=180)
    assert cli.returncode == 0, cli.stderr
    assert json.loads(cli.stdout) == result


def test_declaration_and_expected_lineage_refuse_before_any_delivery_store(
    delivery_case: tuple[Path, dict[str, object], Path, Path],
) -> None:
    root, authority, declaration, derivative = delivery_case
    malformed = json.loads(declaration.read_text(encoding="utf-8")); malformed["spatial"]["source_rect"]["width"] = True
    _write(declaration, malformed)
    with pytest.raises(delivery.VideoDeliveryReviewError, match="declaration|rectangle|integer"):
        _prepare(root, authority, declaration, derivative)
    assert not list(root.rglob("video-delivery-review"))
    _declaration(root, authority, derivative)
    with pytest.raises(delivery.VideoDeliveryReviewError, match="accepted.*lineage|lineage.*digest"):
        delivery.prepare_delivery_review(root=root, accepted_video_path=Path(authority["accepted_lineage"]["path"]),
            expected_accepted_lineage_sha256="0" * 64, derivative_path=Path("delivery.mp4"), template_id="RT-2",
            transform_declaration_path=Path("transform-declaration.json"))
    assert not list(root.rglob("video-delivery-review"))
    incompatible_audio = json.loads(declaration.read_text(encoding="utf-8")); incompatible_audio["audio"] = {"state": "present"}
    _write(declaration, incompatible_audio)
    with pytest.raises(delivery.VideoDeliveryReviewError, match="audio"):
        _prepare(root, authority, declaration, derivative)
    assert not list(root.rglob("video-delivery-review"))


def test_validation_rejects_stale_derivative_or_persistent_extractor_evidence(
    delivery_case: tuple[Path, dict[str, object], Path, Path],
) -> None:
    root, authority, declaration, derivative = delivery_case
    evaluation = _prepare(root, authority, declaration, derivative)
    evaluation_path = root / evaluation["review_directory"] / "evaluation-inputs.json"
    original_derivative = derivative.read_bytes()
    derivative.write_bytes(original_derivative + b"stale")
    with pytest.raises(delivery.VideoDeliveryReviewError):
        delivery.validate_prepared_delivery(root, evaluation_path.relative_to(root))
    derivative.write_bytes(original_derivative)
    paths = [
        root / evaluation["subject"]["extraction"]["receipt"]["path"],
        *(root / row["path"] for row in evaluation["subject"]["extraction"]["samples"]),
    ]
    for path in paths:
        original = path.read_bytes()
        try:
            path.write_bytes(original + b"stale")
            with pytest.raises(delivery.VideoDeliveryReviewError):
                delivery.validate_prepared_delivery(root, evaluation_path.relative_to(root))
        finally:
            path.write_bytes(original)


def test_duplicate_identity_collides_and_prepared_record_is_not_native_authority(
    delivery_case: tuple[Path, dict[str, object], Path, Path],
) -> None:
    root, authority, declaration, derivative = delivery_case
    evaluation = _prepare(root, authority, declaration, derivative)
    evaluation_path = root / evaluation["review_directory"] / "evaluation-inputs.json"
    before = evaluation_path.read_bytes()
    with pytest.raises(delivery.VideoDeliveryReviewError, match="fresh|exist|collision"):
        _prepare(root, authority, declaration, derivative)
    assert evaluation_path.read_bytes() == before
    with pytest.raises(review.VideoReviewError):
        review.validate_accepted_video(root, evaluation_path.relative_to(root))
    binding = native_tests._load("figment_delivery_motion_consumer", VIDEO_DIR.parent / "content" / "content_asset_binding.py")
    with pytest.raises(binding.ContentAssetBindingError, match="accepted video authority"):
        binding._validate_video_source(root, "creator-002", {}, {
            "kind": binding.VIDEO_SOURCE_KIND,
            "accepted_video": evaluation_path.relative_to(root).as_posix(),
            "accepted_video_sha256": _sha(evaluation_path),
        }, None)


@pytest.mark.parametrize("field", ("accepted_video_path", "derivative_path", "transform_declaration_path"))
def test_prepare_refuses_windows_rooted_public_paths_before_native_authority(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, field: str,
) -> None:
    calls: list[tuple[Path, Path]] = []
    monkeypatch.setattr(delivery.video_review, "validate_accepted_video", lambda root, path: calls.append((root, path)))
    inputs: dict[str, object] = {
        "root": tmp_path, "accepted_video_path": Path("accepted.json"),
        "expected_accepted_lineage_sha256": "a" * 64, "derivative_path": Path("delivery.mp4"),
        "template_id": "RT-2", "transform_declaration_path": Path("declaration.json"),
    }
    inputs[field] = Path(r"\rooted-without-drive")
    with pytest.raises(delivery.VideoDeliveryReviewError, match="lexical relative"):
        delivery.prepare_delivery_review(**inputs)  # type: ignore[arg-type]
    assert calls == []


def test_validate_refuses_windows_rooted_evaluation_before_any_native_authority(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[Path, Path]] = []
    monkeypatch.setattr(delivery.video_review, "validate_accepted_video", lambda root, path: calls.append((root, path)))
    with pytest.raises(delivery.VideoDeliveryReviewError, match="lexical relative"):
        delivery.validate_prepared_delivery(tmp_path, Path(r"\rooted-without-drive"))
    assert calls == []


def test_recomputed_subject_digest_does_not_admit_a_malformed_closed_record(
    delivery_case: tuple[Path, dict[str, object], Path, Path],
) -> None:
    root, authority, declaration, derivative = delivery_case
    evaluation = _prepare(root, authority, declaration, derivative)
    path = root / evaluation["review_directory"] / "evaluation-inputs.json"
    forged = json.loads(path.read_text(encoding="utf-8"))
    forged["subject"]["identity"]["value"]["unrecognized"] = "forged"
    forged["subject"]["identity"]["sha256"] = review.lineage.canonical_sha256(forged["subject"]["identity"]["value"])
    forged["subject_sha256"] = review.lineage.canonical_sha256(forged["subject"])
    _write(path, forged)
    with pytest.raises(delivery.VideoDeliveryReviewError, match="closed schema"):
        delivery.validate_prepared_delivery(root, path.relative_to(root))


def test_native_authority_staleness_and_final_call_change_refuse_without_store(
    delivery_case: tuple[Path, dict[str, object], Path, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, authority, declaration, derivative = delivery_case
    accepted = root / authority["accepted_lineage"]["path"]
    original = accepted.read_bytes()
    try:
        accepted.write_bytes(original + b"stale-native-authority")
        with pytest.raises(delivery.VideoDeliveryReviewError):
            _prepare(root, authority, declaration, derivative)
    finally:
        accepted.write_bytes(original)

    calls = 0
    actual_native = delivery.video_review.validate_accepted_video

    def changed_final(root_arg: Path, accepted_arg: Path) -> dict[str, object]:
        nonlocal calls
        calls += 1
        projection = actual_native(root_arg, accepted_arg)
        if calls == 2:
            projection = deepcopy(projection)
            projection["candidate_id"] = "changed-between-public-native-calls"
        return projection

    monkeypatch.setattr(delivery.video_review, "validate_accepted_video", changed_final)
    with pytest.raises(delivery.VideoDeliveryReviewError, match="accepted native video authority"):
        _prepare(root, authority, declaration, derivative)
    assert calls == 2
    assert not list(root.rglob("video-delivery-review"))


def test_native_movie_still_and_candidate_mutations_refuse_and_restore(
    delivery_case: tuple[Path, dict[str, object], Path, Path],
) -> None:
    root, authority, declaration, derivative = delivery_case
    for key in ("movie", "approved_still", "candidate_manifest"):
        path = root / authority[key]["path"]
        original = path.read_bytes()
        try:
            path.write_bytes(original + b"stale-native-upstream-evidence")
            with pytest.raises(delivery.VideoDeliveryReviewError):
                _prepare(root, authority, declaration, derivative)
            assert not list(root.rglob("video-delivery-review"))
        finally:
            path.write_bytes(original)


def test_snapshot_tool_refuses_changed_pin_or_version(monkeypatch: pytest.MonkeyPatch) -> None:
    ffmpeg = delivery.TOOL_PINS["ffmpeg"]
    monkeypatch.setattr(delivery, "_absolute_snapshot", lambda *_: (b"x", {
        "path": ffmpeg["path"].as_posix(), "bytes": ffmpeg["bytes"], "sha256": "0" * 64,
    }))
    with pytest.raises(delivery.VideoDeliveryReviewError, match="reviewed pin"):
        delivery._snapshot_tool("ffmpeg")

    monkeypatch.setattr(delivery, "_absolute_snapshot", lambda *_: (b"x", {
        "path": ffmpeg["path"].as_posix(), "bytes": ffmpeg["bytes"], "sha256": ffmpeg["sha256"],
    }))
    monkeypatch.setattr(delivery.frames, "_run", lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, b"unexpected version\n", b""))
    with pytest.raises(delivery.VideoDeliveryReviewError, match="version does not match"):
        delivery._snapshot_tool("ffmpeg")


def _stat_result_with(base: os.stat_result, **overrides: object) -> os.stat_result:
    """Rebuild a stat_result from a real observation with selected fields swapped.

    Used to simulate genuine platform quirks (e.g. os.stat vs os.fstat reporting
    different low mode bits for the very same unmodified file on Windows) without
    ever touching an installed executable or weakening a real pin.
    """
    fields = [
        overrides.get("st_mode", base.st_mode), overrides.get("st_ino", base.st_ino),
        overrides.get("st_dev", base.st_dev), base.st_nlink, base.st_uid, base.st_gid,
        overrides.get("st_size", base.st_size), int(base.st_atime), int(base.st_mtime), int(base.st_ctime),
    ]
    extra = {
        "st_atime_ns": base.st_atime_ns,
        "st_mtime_ns": overrides.get("st_mtime_ns", base.st_mtime_ns),
        "st_ctime_ns": base.st_ctime_ns,
    }
    return os.stat_result(fields, extra)


def test_absolute_snapshot_admits_real_cross_api_mode_divergence_like_windows_stat_fstat(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Documents the desired boundary: real pinned executables on this Windows host
    are observed with os.stat().st_mode == 0o100777 and os.fstat().st_mode == 0o100666
    for the identical, unmodified file (device, inode, size and mtime all agree). The
    scoped wrappers below reproduce that exact divergence on an owned small real file
    so the fix can be judged without ever touching an installed executable. This test
    fails against the round-one source (which demands full mode equality across stat and
    fstat) and is expected to pass once the source compares stat.S_IFMT(mode) plus
    device/inode/size/mtime across APIs while still requiring full mode equality within
    each API family (stat-vs-stat, fstat-vs-fstat)."""
    target = tmp_path / "owned-pinned-fixture.bin"
    target.write_bytes(b"trusted-fixture-bytes")
    real_stat, real_fstat = os.stat, os.fstat
    target_key = (real_stat(target).st_dev, real_stat(target).st_ino)

    def stat_wrapper(path, *args, **kwargs):
        result = real_stat(path, *args, **kwargs)
        if (result.st_dev, result.st_ino) == target_key:
            return _stat_result_with(result, st_mode=0o100777)
        return result

    def fstat_wrapper(fd, *args, **kwargs):
        result = real_fstat(fd, *args, **kwargs)
        if (result.st_dev, result.st_ino) == target_key:
            return _stat_result_with(result, st_mode=0o100666)
        return result

    monkeypatch.setattr(delivery.os, "stat", stat_wrapper)
    monkeypatch.setattr(delivery.os, "fstat", fstat_wrapper)
    raw, entry = delivery._absolute_snapshot(target, "test pinned tool", 1024)
    assert raw == b"trusted-fixture-bytes"
    assert entry["bytes"] == len(raw) and entry["sha256"] == _sha(target)


def test_absolute_snapshot_still_refuses_mode_drift_within_the_same_stat_api(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cross-API tolerance must not become a general mode-equality waiver: two
    observations taken through the same API (os.stat before vs os.stat after) that
    disagree on mode must still refuse, even though device/inode/size/mtime match."""
    target = tmp_path / "owned-pinned-fixture-same-api.bin"
    target.write_bytes(b"trusted-fixture-bytes")
    real_stat, real_fstat = os.stat, os.fstat
    target_key = (real_stat(target).st_dev, real_stat(target).st_ino)
    state = {"after_open": False}

    def stat_wrapper(path, *args, **kwargs):
        result = real_stat(path, *args, **kwargs)
        if (result.st_dev, result.st_ino) == target_key:
            mode = 0o100644 if state["after_open"] else 0o100777
            return _stat_result_with(result, st_mode=mode)
        return result

    def fstat_wrapper(fd, *args, **kwargs):
        result = real_fstat(fd, *args, **kwargs)
        if (result.st_dev, result.st_ino) == target_key:
            state["after_open"] = True
        return result

    monkeypatch.setattr(delivery.os, "stat", stat_wrapper)
    monkeypatch.setattr(delivery.os, "fstat", fstat_wrapper)
    with pytest.raises(delivery.VideoDeliveryReviewError, match="changed while being read"):
        delivery._absolute_snapshot(target, "test pinned tool", 1024)


def test_absolute_snapshot_still_refuses_mode_drift_within_the_same_fstat_api(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same-API mode drift must be refused on the fstat side too: two observations
    taken through the same API (os.fstat before vs os.fstat after) that disagree on
    mode must still refuse, even though device/inode/size/mtime match. This targets a
    same-API permission change rather than a changed file type/dev/inode/size/mtime."""
    target = tmp_path / "owned-pinned-fixture-same-fstat-api.bin"
    target.write_bytes(b"trusted-fixture-bytes")
    real_fstat = os.fstat
    target_key = (os.stat(target).st_dev, os.stat(target).st_ino)
    state = {"calls": 0}

    def fstat_wrapper(fd, *args, **kwargs):
        result = real_fstat(fd, *args, **kwargs)
        if (result.st_dev, result.st_ino) == target_key:
            state["calls"] += 1
            mode = 0o100666 if state["calls"] == 1 else 0o100644
            return _stat_result_with(result, st_mode=mode)
        return result

    monkeypatch.setattr(delivery.os, "fstat", fstat_wrapper)
    with pytest.raises(delivery.VideoDeliveryReviewError, match="changed while being read"):
        delivery._absolute_snapshot(target, "test pinned tool", 1024)


@pytest.mark.parametrize("overrides", [
    {"st_mode": stat.S_IFDIR | 0o40777},
    {"st_dev": 999999},
    {"st_ino": 999999},
    {"st_size": 999999},
    {"st_mtime_ns": 1},
], ids=("type", "device", "inode", "size", "mtime"))
def test_absolute_snapshot_still_refuses_real_identity_size_or_mtime_divergence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, overrides: dict[str, object],
) -> None:
    """A genuine identity, size, type or mtime change (as opposed to a same-file,
    cross-API mode-bit artifact) must keep refusing regardless of the mode-comparison
    fix; each mutation here is applied only to the final os.stat("after") observation."""
    target = tmp_path / "owned-pinned-fixture-identity.bin"
    target.write_bytes(b"trusted-fixture-bytes")
    real_stat, real_fstat = os.stat, os.fstat
    target_key = (real_stat(target).st_dev, real_stat(target).st_ino)
    state = {"after_open": False}

    def stat_wrapper(path, *args, **kwargs):
        result = real_stat(path, *args, **kwargs)
        if (result.st_dev, result.st_ino) == target_key and state["after_open"]:
            return _stat_result_with(result, **overrides)
        return result

    def fstat_wrapper(fd, *args, **kwargs):
        result = real_fstat(fd, *args, **kwargs)
        if (result.st_dev, result.st_ino) == target_key:
            state["after_open"] = True
        return result

    monkeypatch.setattr(delivery.os, "stat", stat_wrapper)
    monkeypatch.setattr(delivery.os, "fstat", fstat_wrapper)
    with pytest.raises(delivery.VideoDeliveryReviewError):
        delivery._absolute_snapshot(target, "test pinned tool", 1024)


def test_owned_cleanup_removes_only_captured_entries_and_preserves_surprises(tmp_path: Path) -> None:
    directory = tmp_path / "owned"; directory.mkdir()
    tracked = directory / "tracked"; tracked.write_bytes(b"tracked")
    directory_identity = delivery._capture_directory(directory, "test directory")
    tracked_identity = delivery._capture_file(tracked, "test file")
    assert delivery._remove_owned_tree(tmp_path, directory, directory_identity, None, {"tracked": tracked_identity})
    assert not directory.exists()

    directory.mkdir(); tracked.write_bytes(b"tracked")
    directory_identity = delivery._capture_directory(directory, "test directory")
    tracked_identity = delivery._capture_file(tracked, "test file")
    surprise = directory / "surprise"; surprise.write_bytes(b"preserve")
    assert not delivery._remove_owned_tree(tmp_path, directory, directory_identity, None, {"tracked": tracked_identity})
    assert tracked.read_bytes() == b"tracked" and surprise.read_bytes() == b"preserve"

    surprise.unlink()
    replacement = tmp_path / "separate-replacement"; replacement.write_bytes(b"replacement")
    os.replace(replacement, tracked)
    assert not delivery._remove_owned_tree(tmp_path, directory, directory_identity, None, {"tracked": tracked_identity})
    assert tracked.read_bytes() == b"replacement"


def test_validation_refuses_actual_fresh_extractor_sample_mismatch(
    delivery_case: tuple[Path, dict[str, object], Path, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, authority, declaration, derivative = delivery_case
    evaluation = _prepare(root, authority, declaration, derivative)
    evaluation_path = root / evaluation["review_directory"] / "evaluation-inputs.json"
    actual_extract = delivery.frames.extract_frames

    def altered_extract(*, root: Path, video_path: Path, output_dir: Path) -> dict[str, object]:
        receipt = actual_extract(root=root, video_path=video_path, output_dir=output_dir)
        if output_dir.parts[-2].startswith(delivery.VALIDATE_PREFIX):
            sample = root / output_dir / "first.png"
            sample.write_bytes(sample.read_bytes() + b"fresh-sample-mismatch")
        return receipt

    monkeypatch.setattr(delivery.frames, "extract_frames", altered_extract)
    with pytest.raises(delivery.VideoDeliveryReviewError):
        delivery.validate_prepared_delivery(root, evaluation_path.relative_to(root))
    assert not list((root / evaluation["review_directory"]).glob(f"{delivery.VALIDATE_PREFIX}*"))


def _partial_extract(*, root: Path, video_path: Path, output_dir: Path, failure: type[BaseException]) -> dict[str, object]:
    samples = root / output_dir
    samples.mkdir()
    (samples / "first.png").write_bytes(b"cooperative partial sample")
    raise failure("cooperative extractor interruption")


def test_preparation_cleans_cooperative_partial_extractor_output_for_all_failure_classes(
    delivery_case: tuple[Path, dict[str, object], Path, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, authority, declaration, derivative = delivery_case
    for failure in (RuntimeError, KeyboardInterrupt, SystemExit):
        monkeypatch.setattr(delivery.frames, "extract_frames", lambda **kwargs: _partial_extract(**kwargs, failure=failure))
        expected = delivery.VideoDeliveryReviewError if failure is RuntimeError else failure
        with pytest.raises(expected):
            _prepare(root, authority, declaration, derivative)
        assert not list(root.rglob("video-delivery-review"))


def test_validation_cleans_cooperative_partial_extractor_output_for_all_failure_classes(
    delivery_case: tuple[Path, dict[str, object], Path, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, authority, declaration, derivative = delivery_case
    evaluation = _prepare(root, authority, declaration, derivative)
    evaluation_path = root / evaluation["review_directory"] / "evaluation-inputs.json"
    for failure in (RuntimeError, KeyboardInterrupt, SystemExit):
        monkeypatch.setattr(delivery.frames, "extract_frames", lambda **kwargs: _partial_extract(**kwargs, failure=failure))
        expected = delivery.VideoDeliveryReviewError if failure is RuntimeError else failure
        with pytest.raises(expected):
            delivery.validate_prepared_delivery(root, evaluation_path.relative_to(root))
        assert not list(evaluation_path.parent.glob(f"{delivery.VALIDATE_PREFIX}*"))


def test_owned_cleanup_preflight_preserves_all_samples_when_evaluation_is_replaced(tmp_path: Path) -> None:
    directory = tmp_path / "owned"; samples = directory / "samples"; samples.mkdir(parents=True)
    sample_paths = [samples / name for name in ("first.png", "middle.png", "last.png", "frame-extraction.json")]
    for index, path in enumerate(sample_paths): path.write_bytes(f"sample-{index}".encode())
    evaluation = directory / "evaluation-inputs.json"; evaluation.write_bytes(b"original-evaluation")
    directory_identity = delivery._capture_directory(directory, "test directory")
    sample_identity = delivery._capture_directory(samples, "test samples")
    identities = {f"samples/{path.name}": delivery._capture_file(path, "test sample") for path in sample_paths}
    identities["evaluation-inputs.json"] = delivery._capture_file(evaluation, "test evaluation")
    before_samples = {path.name: path.read_bytes() for path in sample_paths}
    replacement = tmp_path / "replacement-evaluation"; replacement.write_bytes(b"replacement-evaluation")
    os.replace(replacement, evaluation)
    assert not delivery._remove_owned_tree(tmp_path, directory, directory_identity, sample_identity, identities)
    assert {path.name: path.read_bytes() for path in sample_paths} == before_samples
    assert evaluation.read_bytes() == b"replacement-evaluation"


def test_validation_refuses_late_evaluation_bytes_mutation_after_actual_fresh_extraction(
    delivery_case: tuple[Path, dict[str, object], Path, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, authority, declaration, derivative = delivery_case
    evaluation = _prepare(root, authority, declaration, derivative)
    evaluation_path = root / evaluation["review_directory"] / "evaluation-inputs.json"
    actual_extract = delivery.frames.extract_frames

    def mutate_evaluation(*, root: Path, video_path: Path, output_dir: Path) -> dict[str, object]:
        receipt = actual_extract(root=root, video_path=video_path, output_dir=output_dir)
        if output_dir.parts[-2].startswith(delivery.VALIDATE_PREFIX):
            evaluation_path.write_bytes(evaluation_path.read_bytes() + b" ")
        return receipt

    monkeypatch.setattr(delivery.frames, "extract_frames", mutate_evaluation)
    with pytest.raises(delivery.VideoDeliveryReviewError):
        delivery.validate_prepared_delivery(root, evaluation_path.relative_to(root))
    assert not list(evaluation_path.parent.glob(f"{delivery.VALIDATE_PREFIX}*"))


@pytest.mark.parametrize("mutation", [
    lambda record: record["subject"]["derivative"]["video"].__setitem__("note", "\ud800"),
    lambda record: record["subject"]["derivative"]["video"].__setitem__("\ud800", "nested surrogate key"),
], ids=("surrogate-value", "surrogate-key"))
def test_validation_and_cli_refuse_escaped_surrogates_without_traceback(
    delivery_case: tuple[Path, dict[str, object], Path, Path], mutation,
) -> None:
    root, authority, declaration, derivative = delivery_case
    evaluation = _prepare(root, authority, declaration, derivative)
    path = root / evaluation["review_directory"] / "evaluation-inputs.json"
    malformed = json.loads(path.read_text(encoding="utf-8")); mutation(malformed)
    path.write_text(json.dumps(malformed, ensure_ascii=True, sort_keys=True), encoding="utf-8")
    with pytest.raises(delivery.VideoDeliveryReviewError):
        delivery.validate_prepared_delivery(root, path.relative_to(root))
    cli = subprocess.run([
        sys.executable, "-I", "-B", str(DELIVERY_PATH), "validate", "--root", str(root),
        "--evaluation", path.relative_to(root).as_posix(),
    ], capture_output=True, text=True, timeout=30)
    assert cli.returncode == 2 and "Traceback" not in cli.stderr


def _admitted_metadata() -> dict[str, object]:
    return {
        "streams": [{
            "index": 0, "codec_type": "video", "codec_name": "h264", "width": 1080, "height": 1920,
            "pix_fmt": "yuv420p", "sample_aspect_ratio": "1:1", "avg_frame_rate": "30/1",
            "time_base": "1/30", "duration_ts": 152,
        }],
        "format": {"duration": "5.066667"},
    }


def _admitted_timestamps() -> dict[str, object]:
    return {"frames": [{"best_effort_timestamp": index} for index in range(152)]}


def _raw_declaration() -> dict[str, object]:
    return {
        "schema": delivery.DECLARATION_SCHEMA, "accepted_lineage_sha256": "a" * 64,
        "source_movie_sha256": "b" * 64, "derivative_sha256": "c" * 64, "template_id": "RT-2",
        "spatial": {"method": "crop-scale-lanczos-v1", "source_rect": {"x": 442, "y": 0, "width": 396, "height": 704},
                    "target": {"width": 1080, "height": 1920}},
        "temporal": {"method": "hold-last-sample-30fps-v1", "source_frames": 81, "source_fps": "16/1",
                     "target_frames": 152, "target_fps": "30/1"},
        "audio": {"state": "absent"}, "declared_by": "bounded-attribution", "declared_at": "2026-09-11T00:00:00Z",
    }


def test_technical_snapshot_allows_only_observed_empty_frame_side_data(
    accepted_base: tuple[Path, Path, dict[str, object], Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, _, _, _ = accepted_base
    metadata, timestamps = _admitted_metadata(), _admitted_timestamps()
    timestamps["frames"][0]["side_data_list"] = [{}]
    monkeypatch.setattr(delivery, "_probe_metadata", lambda *_: deepcopy(metadata))
    monkeypatch.setattr(delivery, "_probe_timestamps", lambda *_: deepcopy(timestamps))
    technical, _ = delivery._technical_snapshot(root, Path("delivery.mp4"), delivery._snapshot_template("RT-2"))
    assert technical["presentation_cadence"]["frame_count"] == 152


@pytest.mark.parametrize("mutation", [
    lambda timestamps: timestamps["frames"][1].__setitem__("unexpected", "x"),
    lambda timestamps: timestamps["frames"][0].__setitem__("side_data_list", [{"type": "SEI"}]),
    lambda timestamps: timestamps["frames"][0].__setitem__("side_data_list", [{}] * 9),
], ids=("other-row-extra-key", "nonempty-side-data", "oversized-side-data"))
def test_technical_snapshot_refuses_any_nonempty_or_unbounded_frame_side_data(
    accepted_base: tuple[Path, Path, dict[str, object], Path], monkeypatch: pytest.MonkeyPatch, mutation,
) -> None:
    root, _, _, _ = accepted_base
    metadata, timestamps = _admitted_metadata(), _admitted_timestamps()
    mutation(timestamps)
    monkeypatch.setattr(delivery, "_probe_metadata", lambda *_: deepcopy(metadata))
    monkeypatch.setattr(delivery, "_probe_timestamps", lambda *_: deepcopy(timestamps))
    with pytest.raises(delivery.VideoDeliveryReviewError):
        delivery._technical_snapshot(root, Path("delivery.mp4"), delivery._snapshot_template("RT-2"))


@pytest.mark.parametrize("mutation", [
    lambda metadata: metadata.update({"programs": []}),
    lambda metadata: metadata.update({"stream_groups": []}),
    lambda metadata: metadata.update({"programs": [], "stream_groups": []}),
    lambda metadata: metadata["streams"][0].update({"tags": {}}),
], ids=("empty-programs", "empty-stream-groups", "both-empty-containers", "empty-stream-tags"))
def test_technical_snapshot_admits_observed_empty_top_level_containers_and_tags(
    accepted_base: tuple[Path, Path, dict[str, object], Path], monkeypatch: pytest.MonkeyPatch, mutation,
) -> None:
    """Real pinned ffprobe emits optional empty top-level "programs"/"stream_groups"
    arrays and an empty per-stream "tags": {} object with this exact selector. This
    fails against the current strict {"streams", "format"}-only schema and the
    tags-must-equal-{"rotate"} check, and is expected to pass once the source admits
    these specific, observed-empty containers without loosening anything else."""
    root, _, _, _ = accepted_base
    metadata, timestamps = _admitted_metadata(), _admitted_timestamps()
    mutation(metadata)
    monkeypatch.setattr(delivery, "_probe_metadata", lambda *_: deepcopy(metadata))
    monkeypatch.setattr(delivery, "_probe_timestamps", lambda *_: deepcopy(timestamps))
    technical, _ = delivery._technical_snapshot(root, Path("delivery.mp4"), delivery._snapshot_template("RT-2"))
    assert technical["presentation_cadence"]["frame_count"] == 152


@pytest.mark.parametrize("mutation", [
    lambda metadata: metadata.update({"programs": [{"id": 1}]}),
    lambda metadata: metadata.update({"stream_groups": [{"id": 1}]}),
    lambda metadata: metadata.update({"programs": {}}),
    lambda metadata: metadata.update({"stream_groups": "x"}),
    lambda metadata: metadata.update({"chapters": []}),
    lambda metadata: metadata["streams"][0].update({"tags": {"rotate": "0", "unexpected": "x"}}),
], ids=("nonempty-programs", "nonempty-stream-groups", "wrong-type-programs", "wrong-type-stream-groups", "unknown-top-level-key", "malformed-tags"))
def test_technical_snapshot_still_refuses_nonempty_wrong_type_or_unknown_metadata_shape(
    accepted_base: tuple[Path, Path, dict[str, object], Path], monkeypatch: pytest.MonkeyPatch, mutation,
) -> None:
    """Admitting observed-empty "programs"/"stream_groups"/"tags" must not loosen
    anything else: nonempty or wrong-typed containers, and unrelated unknown
    top-level keys, must keep refusing. Nonzero rotation is already covered by the
    "rotation" case in test_technical_snapshot_refuses_format_stream_and_cadence_lies."""
    root, _, _, _ = accepted_base
    metadata, timestamps = _admitted_metadata(), _admitted_timestamps()
    mutation(metadata)
    monkeypatch.setattr(delivery, "_probe_metadata", lambda *_: deepcopy(metadata))
    monkeypatch.setattr(delivery, "_probe_timestamps", lambda *_: deepcopy(timestamps))
    with pytest.raises(delivery.VideoDeliveryReviewError):
        delivery._technical_snapshot(root, Path("delivery.mp4"), delivery._snapshot_template("RT-2"))


@pytest.mark.parametrize("mutation", [
    lambda declaration: declaration["spatial"]["target"].__setitem__("width", 1080.0),
    lambda declaration: declaration["spatial"]["target"].__setitem__("height", 1920.0),
    lambda declaration: declaration["temporal"].__setitem__("source_frames", 81.0),
    lambda declaration: declaration["temporal"].__setitem__("target_frames", 152.0),
    lambda declaration: declaration["temporal"].pop("target_fps"),
    lambda declaration: declaration.__setitem__("unexpected", True),
], ids=("target-width-float", "target-height-float", "source-frames-float", "target-frames-float", "missing-key", "extra-key"))
def test_declaration_closed_integer_and_key_schema_refuses_floats_and_shape(mutation) -> None:
    declaration = _raw_declaration(); mutation(declaration)
    with pytest.raises(delivery.VideoDeliveryReviewError):
        delivery._normalize_declaration(declaration)


@pytest.mark.parametrize("mutation", [
    lambda declaration: declaration["audio"].__setitem__("state", []),
    lambda declaration: declaration.__setitem__("declared_by", "\ud800"),
], ids=("audio-state-list", "escaped-lone-surrogate"))
def test_malformed_valid_json_refuses_as_domain_error_without_cli_traceback(
    tmp_path: Path, mutation,
) -> None:
    declaration = _raw_declaration(); mutation(declaration)
    path = tmp_path / "declaration.json"
    path.write_text(json.dumps(declaration, ensure_ascii=True, sort_keys=True), encoding="utf-8")
    inputs = {
        "root": tmp_path, "accepted_video_path": Path("accepted.json"),
        "expected_accepted_lineage_sha256": "a" * 64, "derivative_path": Path("delivery.mp4"),
        "template_id": "RT-2", "transform_declaration_path": Path("declaration.json"),
    }
    with pytest.raises(delivery.VideoDeliveryReviewError):
        delivery.prepare_delivery_review(**inputs)
    cli = subprocess.run([
        sys.executable, "-I", "-B", str(DELIVERY_PATH), "prepare", "--root", str(tmp_path),
        "--accepted-video", "accepted.json", "--accepted-video-sha256", "a" * 64,
        "--derivative", "delivery.mp4", "--template-id", "RT-2", "--transform-declaration", "declaration.json",
    ], capture_output=True, text=True, timeout=30)
    assert cli.returncode == 2 and "Traceback" not in cli.stderr


def test_one_audio_stream_is_technically_admitted_only_when_declaration_matches(
    accepted_base: tuple[Path, Path, dict[str, object], Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, accepted, authority, declaration_path = accepted_base
    metadata, timestamps = _admitted_metadata(), _admitted_timestamps()
    metadata["streams"].append({"index": 1, "codec_type": "audio", "codec_name": "aac", "sample_rate": "48000", "channels": 2})
    monkeypatch.setattr(delivery, "_probe_metadata", lambda *_: deepcopy(metadata))
    monkeypatch.setattr(delivery, "_probe_timestamps", lambda *_: deepcopy(timestamps))
    technical, _ = delivery._technical_snapshot(root, Path("delivery.mp4"), delivery._snapshot_template("RT-2"))
    declaration = delivery._normalize_declaration(json.loads(declaration_path.read_text(encoding="utf-8")))
    declaration["audio"] = {"state": "present"}
    delivery._cross_bind(declaration, review.validate_accepted_video(root, accepted.relative_to(root)), technical, delivery._snapshot_template("RT-2"))
    declaration["audio"] = {"state": "absent"}
    with pytest.raises(delivery.VideoDeliveryReviewError, match="audio"):
        delivery._cross_bind(declaration, authority, technical, delivery._snapshot_template("RT-2"))


@pytest.mark.parametrize("message", ("ffprobe returned too much metadata", "ffprobe did not complete safely"))
def test_probe_helper_overflow_and_timeout_become_delivery_domain_errors(
    accepted_base: tuple[Path, Path, dict[str, object], Path], monkeypatch: pytest.MonkeyPatch, message: str,
) -> None:
    root, _, _, _ = accepted_base
    def refused(*args, **kwargs):
        raise delivery.frames.FrameExtractError(message)
    monkeypatch.setattr(delivery.frames, "_probe_json", refused)
    with pytest.raises(delivery.VideoDeliveryReviewError, match=message):
        delivery._probe_metadata(root, Path("delivery.mp4"))


@pytest.mark.parametrize("mutation", [
    lambda metadata, timestamps: metadata["streams"][0].__setitem__("codec_name", "hevc"),
    lambda metadata, timestamps: metadata["streams"][0].__setitem__("pix_fmt", "yuv444p"),
    lambda metadata, timestamps: metadata["streams"][0].__setitem__("width", 1079),
    lambda metadata, timestamps: metadata["streams"][0].__setitem__("height", 1919),
    lambda metadata, timestamps: metadata["streams"][0].__setitem__("sample_aspect_ratio", "2:1"),
    lambda metadata, timestamps: metadata["streams"][0].update({"tags": {"rotate": "90"}}),
    lambda metadata, timestamps: metadata["streams"].append({"index": 1, "codec_type": "video", "codec_name": "h264", "width": 1080, "height": 1920, "pix_fmt": "yuv420p", "sample_aspect_ratio": "1:1", "avg_frame_rate": "30/1", "time_base": "1/30", "duration_ts": 152}),
    lambda metadata, timestamps: metadata["streams"].append({"index": 1, "codec_type": "subtitle", "codec_name": "mov_text"}),
    lambda metadata, timestamps: metadata["streams"].extend([
        {"index": 1, "codec_type": "audio", "codec_name": "aac"},
        {"index": 2, "codec_type": "audio", "codec_name": "aac"},
    ]),
    lambda metadata, timestamps: timestamps["frames"][0].__setitem__("best_effort_timestamp", 1),
    lambda metadata, timestamps: timestamps["frames"].pop(),
    lambda metadata, timestamps: timestamps["frames"][76].__setitem__("best_effort_timestamp", "N/A"),
    lambda metadata, timestamps: timestamps["frames"][76].clear(),
    lambda metadata, timestamps: timestamps["frames"][76].__setitem__("best_effort_timestamp", 75),
    lambda metadata, timestamps: timestamps["frames"][76].__setitem__("best_effort_timestamp", 77),
    lambda metadata, timestamps: metadata["streams"][0].__setitem__("avg_frame_rate", "30000/1001"),
    lambda metadata, timestamps: metadata["streams"][0].__setitem__("time_base", "1/1000"),
    lambda metadata, timestamps: metadata["streams"][0].__setitem__("duration_ts", 151),
], ids=("codec", "pixel-format", "width", "height", "sar", "rotation", "extra-video", "unknown-stream", "two-audio", "timestamp-offset", "timestamp-count", "timestamp-noninteger", "timestamp-missing", "timestamp-decreasing", "equal-average-irregular-pts", "wrong-average", "wrong-time-base-step", "duration"))
def test_technical_snapshot_refuses_format_stream_and_cadence_lies(
    accepted_base: tuple[Path, Path, dict[str, object], Path], monkeypatch: pytest.MonkeyPatch, mutation,
) -> None:
    """Targeted probe mocks supplement, rather than replace, the real positive derivative."""
    root, _, _, _ = accepted_base
    derivative = root / "delivery.mp4"
    metadata, timestamps = _admitted_metadata(), _admitted_timestamps()
    mutation(metadata, timestamps)
    monkeypatch.setattr(delivery, "_probe_metadata", lambda *_: deepcopy(metadata))
    monkeypatch.setattr(delivery, "_probe_timestamps", lambda *_: deepcopy(timestamps))
    with pytest.raises(delivery.VideoDeliveryReviewError):
        delivery._technical_snapshot(root, derivative.relative_to(root), delivery._snapshot_template("RT-2"))


@pytest.mark.parametrize("row_index, malformed_index", [
    (0, False), (0, 0.0), (1, 76.0), (2, 151.0),
], ids=("first-bool-false", "first-float-zero", "middle-float", "last-float"))
def test_extraction_projection_rejects_malformed_sample_index_type_at_boundary_rows(
    delivery_case: tuple[Path, dict[str, object], Path, Path], row_index: int, malformed_index: object,
) -> None:
    """Calling _extraction_projection directly (as delivery does when re-reading the
    receipt) has no stale outer evaluation digest to fail first, so this isolates the
    sample-index type check at the exact boundary rows (first/middle/last)."""
    root, authority, declaration, derivative = delivery_case
    evaluation = _prepare(root, authority, declaration, derivative)
    receipt_relative = Path(evaluation["subject"]["extraction"]["receipt"]["path"])
    derivative_entry = evaluation["subject"]["derivative"]["file"]
    receipt_path = root / receipt_relative
    original = receipt_path.read_bytes()
    try:
        receipt = json.loads(original.decode("utf-8"))
        receipt["frames"][row_index]["index"] = malformed_index
        receipt_path.write_text(json.dumps(receipt, ensure_ascii=True, sort_keys=True), encoding="utf-8")
        with pytest.raises(delivery.VideoDeliveryReviewError, match="extracted sample is malformed"):
            delivery._extraction_projection(root, receipt_relative, derivative_entry)
    finally:
        receipt_path.write_bytes(original)
