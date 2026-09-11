from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image, PngImagePlugin


VIDEO_DIR = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("figment_video_review_test", VIDEO_DIR / "video_review.py")
assert SPEC and SPEC.loader
review = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = review
SPEC.loader.exec_module(review)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding="utf-8")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fixture(root: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path | str]:
    persona_path = root / "persona" / "persona.yaml"
    write_json(persona_path, {
        "id": "creator-test",
        "identity": {"look": {
            "age_stage": "a woman in her mid-twenties, clearly an adult",
            "clothing": "a plain opaque coat and jeans",
        }},
    })
    still = root / "media" / "approved.png"
    still.parent.mkdir()
    Image.new("RGB", (1280, 704), (30, 50, 70)).save(still)
    plan = root / "plan.json"
    write_json(plan, {"assets": {"persona_dir": "persona"}})
    grade = root / "grade" / "gen"
    evidence: dict[str, Path] = {}
    for name in (
        "approval-lineage.json", "approved-list.json", "rulings.json",
        "grading-manifest.json", "evaluation-inputs.json", "gate.json",
    ):
        evidence[name] = grade / name
        write_json(evidence[name], {"fixture": name})
    authority = {
        "image_id": "creator-test-gen-01", "path": str(still),
        "bytes": still.stat().st_size, "sha256": digest(still),
        "source_plan": {"path": str(plan), "sha256": digest(plan)},
        "approval_lineage": {"path": str(evidence["approval-lineage.json"]), "sha256": digest(evidence["approval-lineage.json"])},
        "approved_list": {"path": str(evidence["approved-list.json"]), "sha256": digest(evidence["approved-list.json"])},
    }
    train = SimpleNamespace(ROOT=root, validate_approved_gen_still=lambda *args: authority)
    monkeypatch.setattr(review.video, "_train_module", lambda: train)
    candidate = review.video.write_manifest(
        root=root, persona_path=Path("persona/persona.yaml"),
        approved_gen_plan=Path("plan.json"), approved_gen_image_id="creator-test-gen-01",
        action="walk slowly toward the camera", out=Path("media/candidate.json"),
        seed=77, mode=review.video.CANDIDATE_MODE,
    )
    candidate_path = root / "media" / "candidate.json"
    job = candidate["jobs"][0]
    graph = review.runner.apply_job(candidate["workflow"], job, review.runner.manifest_seed_fields(candidate))
    graph["56"]["inputs"]["is_changed"] = [authority["sha256"]]
    prompt = json.dumps(graph, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    run_dir = root / "run"; run_dir.mkdir()
    files = []
    for index in range(1, 82):
        path = run_dir / f"{job['output_name']}_{index:02d}.png"
        info = PngImagePlugin.PngInfo(); info.add_text("prompt", prompt)
        Image.new("RGB", (1280, 704), (index % 255, 40, 80)).save(path, pnginfo=info)
        files.append({"path": path.name, "bytes": path.stat().st_size})
    run_path = run_dir / "run.json"
    write_json(run_path, {
        "schema": "figment/runpod-run@1", "dry_run": False,
        "pod_id": "synthetic-local-test", "termination_verified": True,
        "placement_attempts": [{"termination_verified": True}],
        "jobs": [{"job": 1, "output_name": job["output_name"], "seed": 77, "files": files}],
    })
    review.assembly.assemble_frames(
        root=root, manifest_path=Path("media/candidate.json"),
        run_receipt_path=Path("run/run.json"), output_dir=Path("assembled"),
    )
    review.frames.extract_frames(
        root=root, video_path=Path("assembled/candidate.mp4"), output_dir=Path("samples"),
    )
    return {
        "candidate": candidate_path, "run": run_path,
        "assembly": root / "assembled" / "frame-assembly.json",
        "extraction": root / "samples" / "frame-extraction.json",
        "candidate_id": job["output_name"],
    }


def prepare(root: Path, paths: dict[str, Path | str]) -> dict[str, object]:
    return review.prepare_review(
        root=root, candidate_manifest=Path("media/candidate.json"),
        run_receipt=Path("run/run.json"),
        assembly_receipt=Path("assembled/frame-assembly.json"),
        extraction_receipt=Path("samples/frame-extraction.json"),
    )


def test_prepares_canonical_current_candidate_without_quality_claim(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture(tmp_path, monkeypatch)
    record = prepare(tmp_path, paths)
    expected_dir = review._review_directory(Path(paths["candidate"]), str(paths["candidate_id"]))
    assert record["schema"] == review.SCHEMA and record["status"] == review.STATUS
    assert record["candidate_id"] == paths["candidate_id"]
    assert record["subject_sha256"] == review.lineage.canonical_sha256(record["subject"])
    assert record["subject"]["workflow"]["png_prompt_graphs_verified"] == 81
    assert record["subject"]["assembly"]["metadata"]["width"] == 1280
    assert record["subject"]["assembly"]["metadata"]["height"] == 704
    assert (expected_dir / "evaluation-inputs.json").is_file()
    assert all(term not in record for term in ("decision", "accepted", "approved", "quality"))
    with pytest.raises(review.VideoReviewError, match="must be fresh"):
        prepare(tmp_path, paths)
    assert (expected_dir / "evaluation-inputs.json").is_file()


def test_candidate_store_is_stable_across_real_sibling_and_widened_root_compiles(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture(tmp_path, monkeypatch)
    original = json.loads(Path(paths["candidate"]).read_text(encoding="utf-8"))
    sibling = review.video.write_manifest(
        root=tmp_path, persona_path=Path("persona/persona.yaml"),
        approved_gen_plan=Path("plan.json"), approved_gen_image_id="creator-test-gen-01",
        action="walk slowly toward the camera", out=Path("media/candidate-sibling.json"),
        seed=77, mode=review.video.CANDIDATE_MODE,
    )
    prefix = Path(tmp_path.name)
    widened = review.video.write_manifest(
        root=tmp_path.parent, persona_path=prefix / "persona/persona.yaml",
        approved_gen_plan=prefix / "plan.json", approved_gen_image_id="creator-test-gen-01",
        action="walk slowly toward the camera", out=prefix / "media/candidate-wide.json",
        seed=77, mode=review.video.CANDIDATE_MODE,
    )
    assert original["candidate_id"] == sibling["candidate_id"] == widened["candidate_id"]
    prepared = prepare(tmp_path, paths)
    canonical = review._review_directory(Path(paths["candidate"]), original["candidate_id"])
    assert prepared["review_directory"] == canonical.relative_to(tmp_path).as_posix()
    with pytest.raises(review.VideoReviewError, match="manifest binding|replay"):
        review.prepare_review(
            root=tmp_path, candidate_manifest=Path("media/candidate-sibling.json"),
            run_receipt=Path("run/run.json"),
            assembly_receipt=Path("assembled/frame-assembly.json"),
            extraction_receipt=Path("samples/frame-extraction.json"),
        )
    assert (canonical / "evaluation-inputs.json").is_file()
    candidates = [Path(paths["candidate"]), tmp_path / "media/candidate-sibling.json", tmp_path / "media/candidate-wide.json"]
    stores = {review._review_directory(path.resolve(), original["candidate_id"]) for path in candidates}
    assert len(stores) == 1
    target = next(iter(stores)) / "evaluation-inputs.json"
    assert target.is_file()


def test_refuses_relabelled_diagnostic_before_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture(tmp_path, monkeypatch)
    candidate = Path(paths["candidate"])
    value = json.loads(candidate.read_text(encoding="utf-8"))
    value.update({"schema": review.video.MANIFEST_SCHEMA, "mode": review.video.DIAGNOSTIC_MODE, "not_promotable": True})
    value.pop("lifecycle"); value.pop("eligible_for_temporal_review")
    write_json(candidate, value)
    with pytest.raises(review.VideoReviewError, match="candidate"):
        prepare(tmp_path, paths)
    assert not (candidate.parent / review.REVIEW_DIRECTORY).exists()


def test_refuses_prompt_graph_or_movie_mutation_before_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture(tmp_path, monkeypatch)
    first = next((tmp_path / "run").glob("*.png"))
    info = PngImagePlugin.PngInfo(); info.add_text("prompt", json.dumps({"wrong": True}))
    Image.new("RGB", (1280, 704), (1, 2, 3)).save(first, pnginfo=info)
    with pytest.raises(review.VideoReviewError, match="frame|prompt"):
        prepare(tmp_path, paths)
    assert not (tmp_path / "media" / review.REVIEW_DIRECTORY).exists()


def test_refuses_stale_extraction_movie_binding(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture(tmp_path, monkeypatch)
    assembly_path = Path(paths["assembly"])
    assembly_value = json.loads(assembly_path.read_text(encoding="utf-8"))
    malformed = json.loads(json.dumps(assembly_value)); malformed["frames"][0] = None
    write_json(assembly_path, malformed)
    with pytest.raises(review.VideoReviewError, match="bind all 81 frames"):
        prepare(tmp_path, paths)
    assert not (Path(paths["candidate"]).parent / review.REVIEW_DIRECTORY).exists()
    write_json(assembly_path, assembly_value)
    extraction = Path(paths["extraction"])
    value = json.loads(extraction.read_text(encoding="utf-8"))
    value["video_after"]["sha256"] = "0" * 64
    write_json(extraction, value)
    with pytest.raises(review.VideoReviewError, match="extraction final video"):
        prepare(tmp_path, paths)


def test_refuses_deep_or_nonfinite_json_before_media(
    tmp_path: Path,
) -> None:
    path = tmp_path / "candidate.json"
    path.write_text('{"x":' + "[" * 1000 + "NaN" + "]" * 1000 + "}", encoding="utf-8")
    with pytest.raises(review.VideoReviewError, match="shallow"):
        review._read_json(tmp_path, Path("candidate.json"), "candidate")
    result = subprocess.run(
        [sys.executable, str(VIDEO_DIR / "video_review.py"), "prepare",
         "--root", str(tmp_path), "--candidate-manifest", "candidate.json",
         "--run-receipt", "candidate.json", "--assembly-receipt", "candidate.json",
         "--extraction-receipt", "candidate.json"],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 2 and "must be shallow" in result.stderr
    assert "Traceback" not in result.stderr and not (tmp_path / review.REVIEW_DIRECTORY).exists()
    path.write_text('{"x":NaN}', encoding="utf-8")
    with pytest.raises(review.VideoReviewError, match="cannot read"):
        review._read_json(tmp_path, Path("candidate.json"), "candidate")


def test_refuses_oversized_or_reparse_json_input(tmp_path: Path) -> None:
    oversized = tmp_path / "oversized.json"
    oversized.write_bytes(b" " * (review.MAX_JSON_BYTES + 1))
    with pytest.raises(review.VideoReviewError, match="no larger"):
        review._read_json(tmp_path, Path(oversized.name), "candidate")
    target = tmp_path / "target"; target.mkdir()
    write_json(target / "candidate.json", {})
    linked = tmp_path / "linked"
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(linked), str(target)],
        shell=False, capture_output=True, text=True,
    )
    if result.returncode != 0:
        pytest.skip("this Windows test environment cannot create NTFS junctions")
    try:
        with pytest.raises(review.VideoReviewError, match="reparse point"):
            review._read_json(tmp_path, Path("linked/candidate.json"), "candidate")
    finally:
        os.rmdir(linked)


def test_refuses_missing_or_oversized_native_prompt_metadata(tmp_path: Path) -> None:
    missing = tmp_path / "missing.png"
    Image.new("RGB", (8, 8)).save(missing)
    with pytest.raises(review.VideoReviewError, match="exactly one"):
        review._prompt_text(missing)
    oversized = tmp_path / "oversized.png"
    metadata = PngImagePlugin.PngInfo(); metadata.add_text("prompt", "x" * (review.MAX_PROMPT_BYTES + 1))
    Image.new("RGB", (8, 8)).save(oversized, pnginfo=metadata)
    with pytest.raises(review.VideoReviewError, match="too large"):
        review._prompt_text(oversized)


@pytest.mark.parametrize("mutation", ["dry-run", "teardown", "reordered"])
def test_refuses_unexecuted_or_misordered_run_receipt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, mutation: str,
) -> None:
    paths = fixture(tmp_path, monkeypatch)
    run_path = Path(paths["run"])
    value = json.loads(run_path.read_text(encoding="utf-8"))
    if mutation == "dry-run":
        value["dry_run"] = True
    elif mutation == "teardown":
        value["termination_verified"] = False
    else:
        value["jobs"][0]["files"][0], value["jobs"][0]["files"][1] = value["jobs"][0]["files"][1], value["jobs"][0]["files"][0]
    write_json(run_path, value)
    with pytest.raises(review.VideoReviewError, match="successful terminated|ordered harness"):
        prepare(tmp_path, paths)
    assert not (Path(paths["candidate"]).parent / review.REVIEW_DIRECTORY).exists()


def test_refuses_changed_current_persona_before_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture(tmp_path, monkeypatch)
    persona = tmp_path / "persona" / "persona.yaml"
    value = json.loads(persona.read_text(encoding="utf-8"))
    value["identity"]["look"]["clothing"] = "a different opaque coat"
    write_json(persona, value)
    with pytest.raises(review.VideoReviewError, match="current|replay"):
        prepare(tmp_path, paths)
    assert not (Path(paths["candidate"]).parent / review.REVIEW_DIRECTORY).exists()


def test_mutation_before_final_publish_removes_owned_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture(tmp_path, monkeypatch)
    original = review._subject
    calls = 0
    def changed(*args: object, **kwargs: object) -> tuple[dict[str, object], Path]:
        nonlocal calls
        calls += 1
        value, destination = original(*args, **kwargs)
        if calls == 3:
            value = dict(value); value["changed"] = True
        return value, destination
    monkeypatch.setattr(review, "_subject", changed)
    with pytest.raises(review.VideoReviewError, match="changed before publication"):
        prepare(tmp_path, paths)
    destination = review._review_directory(Path(paths["candidate"]), str(paths["candidate_id"]))
    assert calls == 3 and not destination.exists()


def test_oversized_evaluation_inputs_refuse_before_any_store_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture(tmp_path, monkeypatch)
    original = review._subject
    def padded(*args: object, **kwargs: object) -> tuple[dict[str, object], Path]:
        value, destination = original(*args, **kwargs)
        return {**value, "padding": ["x" * 60_000] * 20}, destination
    monkeypatch.setattr(review, "_subject", padded)
    with pytest.raises(review.VideoReviewError, match="bounded JSON output limit"):
        prepare(tmp_path, paths)
    assert not (Path(paths["candidate"]).parent / review.REVIEW_DIRECTORY).exists()


def test_interrupted_publication_removes_only_its_own_fresh_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture(tmp_path, monkeypatch)
    destination = review._review_directory(Path(paths["candidate"]), str(paths["candidate_id"]))
    def interrupt(*args: object) -> tuple[int, int]:
        assert destination.is_dir()
        raise KeyboardInterrupt
    monkeypatch.setattr(review, "_exclusive_file", interrupt)
    with pytest.raises(KeyboardInterrupt):
        prepare(tmp_path, paths)
    assert not destination.exists()

    original = review._subject
    calls = 0
    def replaced(*args: object, **kwargs: object) -> tuple[dict[str, object], Path]:
        nonlocal calls
        calls += 1
        if calls == 3:
            # Another process moves our directory aside and installs its own at the path.
            destination.rename(destination.with_name("moved-aside"))
            destination.mkdir()
            (destination / "foreign.txt").write_text("not ours", encoding="utf-8")
            raise KeyboardInterrupt
        return original(*args, **kwargs)
    monkeypatch.setattr(review, "_subject", replaced)
    with pytest.raises(KeyboardInterrupt):
        prepare(tmp_path, paths)
    assert calls == 3 and (destination / "foreign.txt").is_file()


def test_prompt_graph_is_parsed_only_from_the_hashed_frame_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture(tmp_path, monkeypatch)
    first = sorted((tmp_path / "run").glob("*.png"))[0]
    prompt = review._prompt_text(first)
    expected = review._canonical(json.loads(prompt), "candidate prompt graph")
    captured = {"path": first.relative_to(tmp_path).as_posix(), "bytes": first.stat().st_size, "sha256": digest(first)}
    current, raw = review._frame_snapshot(tmp_path, captured)
    assert current == captured and hashlib.sha256(raw).hexdigest() == captured["sha256"]
    info = PngImagePlugin.PngInfo(); info.add_text("prompt", prompt)
    Image.new("RGB", (1280, 704), (9, 9, 9)).save(first, pnginfo=info)
    review._prompt_graph(first, expected)  # the replacement carries a valid graph on its own
    with pytest.raises(review.VideoReviewError, match="candidate frame does not match current evidence"):
        review._frame_snapshot(tmp_path, captured)
    parsed: list[str] = []
    original = review._prompt_source
    monkeypatch.setattr(review, "_prompt_source", lambda data: parsed.append(hashlib.sha256(data).hexdigest()) or original(data))
    with pytest.raises(review.VideoReviewError, match="frame"):
        prepare(tmp_path, paths)
    assert parsed == []
    assert not (Path(paths["candidate"]).parent / review.REVIEW_DIRECTORY).exists()
