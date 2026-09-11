from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image, PngImagePlugin

import test_video_review as preparation_tests


review = preparation_tests.review
PIPELINE = review.HERE.parent
VIDEO_REVIEW = review.HERE / "video_review.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def prepared_base(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("video-rulings-base")
    patch = pytest.MonkeyPatch()
    preparation_tests.fixture(root, patch)
    preparation_tests.prepare(root, {})
    patch.undo()
    return root


def _bind_authority(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    still = root / "media" / "approved.png"
    plan = root / "plan.json"
    grade = root / "grade" / "gen"
    authority = {
        "image_id": "creator-test-gen-01", "path": str(still),
        "bytes": still.stat().st_size, "sha256": _digest(still),
        "source_plan": {"path": str(plan), "sha256": _digest(plan)},
        "approval_lineage": {
            "path": str(grade / "approval-lineage.json"),
            "sha256": _digest(grade / "approval-lineage.json"),
        },
        "approved_list": {
            "path": str(grade / "approved-list.json"),
            "sha256": _digest(grade / "approved-list.json"),
        },
    }
    monkeypatch.setattr(
        review.video, "_train_module",
        lambda: SimpleNamespace(ROOT=root, validate_approved_gen_still=lambda *args: authority),
    )


def _case(prepared_base: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "case"
    shutil.copytree(prepared_base, root)
    _bind_authority(root, monkeypatch)
    return root


def _inputs() -> dict[str, Path]:
    return {
        "candidate_manifest": Path("media/candidate.json"),
        "run_receipt": Path("run/run.json"),
        "assembly_receipt": Path("assembled/frame-assembly.json"),
        "extraction_receipt": Path("samples/frame-extraction.json"),
    }


def _evaluation(root: Path) -> tuple[dict[str, object], Path]:
    path = next((root / "media" / review.REVIEW_DIRECTORY).glob("*/evaluation-inputs.json"))
    return json.loads(path.read_text(encoding="utf-8")), path.parent


def _sample_rows(subject: dict[str, object]) -> list[dict[str, object]]:
    rows = []
    for frame in subject["extraction"]["frames"]:  # type: ignore[index]
        rows.append({
            "image_id": frame["label"], "index": frame["index"],
            "frame_sha256": frame["sha256"], "why": "synthetic fixture observation",
            "identity": "pass", "realism": "pass", "hands": "pass", "lighting": "pass",
            "adult_read": "pass", "garment_integrity": "pass",
            "real_person_resemblance": "clear",
        })
    return rows


def _rulings(
    evaluation: dict[str, object], attempt_id: str, decision: str = "accept",
) -> dict[str, object]:
    subject = evaluation["subject"]
    return {
        "schema": review.RULINGS_SCHEMA,
        "candidate_id": evaluation["candidate_id"],
        "subject_sha256": evaluation["subject_sha256"],
        "attempt_id": attempt_id, "decision": decision,
        "decided_by": "operator-fixture", "decided_at": "2026-09-10T06:00:00Z",
        "reason": "" if decision == "accept" else "synthetic fixture review is incomplete",
        "override": False,
        "samples": _sample_rows(subject) if decision == "accept" else [],
        "complete_sequence": {
            "coverage": "all-81-ordered-frames",
            "frames_sha256": subject["sequence"]["frames_sha256"],  # type: ignore[index]
            "axes": {axis: "pass" for axis in review.SEQUENCE_AXES},
        } if decision == "accept" else None,
        "full_playback": {
            "coverage": "entire-clip",
            "movie_sha256": subject["assembly"]["movie"]["sha256"],  # type: ignore[index]
            "axes": {axis: "pass" for axis in review.PLAYBACK_AXES},
        } if decision == "accept" else None,
    }


def _write(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding="utf-8")


def _apply(root: Path, rulings: Path) -> dict[str, object]:
    return review.apply_rulings(root=root, rulings=rulings.relative_to(root), **_inputs())


def test_parked_then_accepts_unchanged_subject_and_validates_bounded_projection(
    prepared_base: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _case(prepared_base, tmp_path, monkeypatch)
    evaluation, store = _evaluation(root)
    parked_path = root / "parked.json"
    _write(parked_path, _rulings(evaluation, "park-1", "parked"))
    parked = _apply(root, parked_path)
    assert parked["status"] == "parked"
    assert (store / "attempt-park-1.json").is_file()
    assert not (store / "terminal-claim.json").exists()

    accepted_path = root / "accepted-rulings.json"
    _write(accepted_path, _rulings(evaluation, "accept-1"))
    accepted = _apply(root, accepted_path)
    assert accepted["schema"] == review.ACCEPTED_VIDEO_SCHEMA
    terminal = store / "accepted-video.json"
    projection = review.validate_accepted_video(root, terminal.relative_to(root))
    assert projection["candidate_id"] == evaluation["candidate_id"]
    assert projection["creator_id"] == "creator-test"
    assert set(projection) == {
        "creator_id", "candidate_id", "movie", "approved_still",
        "candidate_manifest", "accepted_lineage",
    }
    assert not (store / "rejection-lineage.json").exists()
    measured = [store / "terminal-claim.json", terminal, store / "attempt-accept-1.json"]
    assert max(map(lambda path: len(str(path)), measured)) < 260

    attempt_path = store / "attempt-accept-1.json"
    original_attempt = attempt_path.read_bytes()
    forged = json.loads(original_attempt); forged["attribution"]["decided_by"] = "forged"
    _write(attempt_path, forged)
    with pytest.raises(review.VideoReviewError, match="attempt"):
        review.validate_accepted_video(root, terminal.relative_to(root))
    attempt_path.write_bytes(original_attempt)
    movie = root / projection["movie"]["path"]
    movie.write_bytes(movie.read_bytes() + b"changed")
    with pytest.raises(review.VideoReviewError, match="movie|assembly|extraction"):
        review.validate_accepted_video(root, terminal.relative_to(root))


def test_normalization_allows_honest_omission_but_acceptance_requires_complete_axes(
    prepared_base: Path,
) -> None:
    evaluation, _ = _evaluation(prepared_base)
    subject = evaluation["subject"]
    parked = _rulings(evaluation, "park-2", "parked")
    normalized = review._normalize_rulings(parked, subject)
    assert normalized["samples"] == [] and normalized["full_playback"] is None

    incomplete = _rulings(evaluation, "accept-2")
    incomplete["samples"] = incomplete["samples"][:2]
    normalized = review._normalize_rulings(incomplete, subject)
    with pytest.raises(review.VideoReviewError, match="complete sample"):
        review._assert_decision_allowed(normalized, review._stamp_samples(subject, normalized))

    missing_axis = _rulings(evaluation, "accept-3")
    missing_axis["samples"][0].pop("adult_read")
    with pytest.raises(review.VideoReviewError, match="closed schema"):
        review._normalize_rulings(missing_axis, subject)

    wrong_age = _rulings(evaluation, "accept-4")
    wrong_age["complete_sequence"]["axes"]["matches_persona_age_presentation"] = "fail"
    normalized = review._normalize_rulings(wrong_age, subject)
    with pytest.raises(review.VideoReviewError, match="temporal observation"):
        review._assert_decision_allowed(normalized, review._stamp_samples(subject, normalized))


def _context(root: Path, value: dict[str, object], source: str) -> dict[str, object]:
    evaluation, store = _evaluation(root)
    subject = evaluation["subject"]
    normalized = review._normalize_rulings(value, subject)
    return {
        "subject": subject, "destination": store,
        "evaluation_entry": {
            "path": (store / "evaluation-inputs.json").relative_to(root).as_posix(),
            "bytes": (store / "evaluation-inputs.json").stat().st_size,
            "sha256": _digest(store / "evaluation-inputs.json"),
        },
        "rulings_entry": {"path": source, "bytes": 1, "sha256": "0" * 64},
        "normalized": normalized, "stamp": review._stamp_samples(subject, normalized),
    }


def test_terminal_rejection_blocks_later_accept_without_overwrite(
    prepared_base: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _case(prepared_base, tmp_path, monkeypatch)
    evaluation, store = _evaluation(root)
    rejected_path = root / "reject.json"; accepted_path = root / "accept.json"
    rejected = _rulings(evaluation, "reject-1", "reject")
    accepted = _rulings(evaluation, "accept-2")
    contexts = {
        "reject.json": _context(root, rejected, "reject.json"),
        "accept.json": _context(root, accepted, "accept.json"),
    }
    monkeypatch.setattr(review, "_decision_context", lambda *args: contexts[Path(args[-1]).name])
    result = review.apply_rulings(root=root, rulings=Path("reject.json"), **_inputs())
    assert result["schema"] == review.REJECTION_SCHEMA
    rejection_bytes = (store / "rejection-lineage.json").read_bytes()
    with pytest.raises(review.VideoReviewError, match="terminal"):
        review.apply_rulings(root=root, rulings=Path("accept.json"), **_inputs())
    assert (store / "rejection-lineage.json").read_bytes() == rejection_bytes
    assert not (store / "accepted-video.json").exists()


def test_failed_terminal_publication_leaves_claim_and_blocks_retry(
    prepared_base: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _case(prepared_base, tmp_path, monkeypatch)
    evaluation, store = _evaluation(root)
    first = _rulings(evaluation, "accept-3")
    second = _rulings(evaluation, "accept-4")
    contexts = {
        "one.json": _context(root, first, "one.json"),
        "two.json": _context(root, second, "two.json"),
    }
    monkeypatch.setattr(review, "_decision_context", lambda *args: contexts[Path(args[-1]).name])
    original = review._exclusive_file
    labels: list[str] = []
    def fail_terminal(root_arg: Path, path: Path, value: dict[str, object], label: str) -> tuple[int, int]:
        labels.append(label)
        if label == "video terminal decision":
            raise review.VideoReviewError("injected terminal publication failure")
        return original(root_arg, path, value, label)
    monkeypatch.setattr(review, "_exclusive_file", fail_terminal)
    with pytest.raises(review.VideoReviewError, match="injected"):
        review.apply_rulings(root=root, rulings=Path("one.json"), **_inputs())
    assert labels == ["video review attempt", "video terminal decision"]
    claim_bytes = (store / "terminal-claim.json").read_bytes()
    assert json.loads(claim_bytes)["attempt_id"] == "accept-3"
    assert (store / "attempt-accept-3.json").is_file()
    assert not (store / "accepted-video.json").exists()
    monkeypatch.setattr(review, "_exclusive_file", original)
    with pytest.raises(review.VideoReviewError, match="terminal"):
        review.apply_rulings(root=root, rulings=Path("two.json"), **_inputs())
    assert (store / "terminal-claim.json").read_bytes() == claim_bytes
    assert not (store / "attempt-accept-4.json").exists()
    assert not (store / "accepted-video.json").exists()


def test_concurrent_accept_and_reject_create_only_one_terminal(
    prepared_base: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _case(prepared_base, tmp_path, monkeypatch)
    evaluation, store = _evaluation(root)
    accept = _rulings(evaluation, "accept-5")
    reject = _rulings(evaluation, "reject-5", "reject")
    contexts = {
        "accept.json": _context(root, accept, "accept.json"),
        "reject.json": _context(root, reject, "reject.json"),
    }
    monkeypatch.setattr(review, "_decision_context", lambda *args: copy.deepcopy(contexts[Path(args[-1]).name]))
    def invoke(name: str) -> str:
        try:
            return review.apply_rulings(root=root, rulings=Path(name), **_inputs())["status"]
        except review.VideoReviewError:
            return "refused"
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(invoke, ("accept.json", "reject.json")))
    assert outcomes.count("refused") == 1
    terminals = [path for path in (store / "accepted-video.json", store / "rejection-lineage.json") if path.exists()]
    assert len(terminals) == 1 and (store / "terminal-claim.json").is_file()


def _deep(depth: int) -> object:
    value: object = "x"
    for _ in range(depth):
        value = [value]
    return value


@pytest.mark.parametrize(("builder", "bloat", "message"), [
    ("_attempt_record", "size", "video review attempt exceeds the bounded JSON output limit"),
    ("_terminal_record", "size", "video terminal decision exceeds the bounded JSON output limit"),
    ("_terminal_record", "depth", "video terminal decision JSON is too deep"),
])
@pytest.mark.parametrize("decision", ["accept", "reject"])
def test_unpublishable_attempt_or_terminal_refuses_before_any_claim(
    prepared_base: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    builder: str, bloat: str, message: str, decision: str,
) -> None:
    root = _case(prepared_base, tmp_path, monkeypatch)
    evaluation, store = _evaluation(root)
    before = sorted(path.name for path in store.iterdir())
    context = _context(root, _rulings(evaluation, "bloat-1", decision), "bloat.json")
    monkeypatch.setattr(review, "_decision_context", lambda *args: copy.deepcopy(context))
    original = getattr(review, builder)
    padding = ["x" * 60_000] * 20 if bloat == "size" else _deep(review.video.MAX_JSON_DEPTH + 2)
    monkeypatch.setattr(review, builder, lambda *args: {**original(*args), "padding": padding})
    claims: list[bytes] = []
    publications: list[str] = []
    monkeypatch.setattr(review, "_claim_terminal", lambda *args: claims.append(args[-1]))
    monkeypatch.setattr(review, "_exclusive_file", lambda *args: publications.append(args[-1]))
    with pytest.raises(review.VideoReviewError, match=message):
        review.apply_rulings(root=root, rulings=Path("bloat.json"), **_inputs())
    assert claims == [] and publications == []
    assert sorted(path.name for path in store.iterdir()) == before == ["evaluation-inputs.json"]
    assert not (store / "terminal-claim.json").exists()
    assert not (store / "attempt-bloat-1.json").exists()


def test_cli_refuses_malformed_rulings_without_attempt_or_traceback(
    prepared_base: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root = _case(prepared_base, tmp_path, monkeypatch)
    evaluation, store = _evaluation(root)
    malformed = _rulings(evaluation, "bad-1")
    malformed["samples"][0].pop("hands")
    path = root / "malformed.json"; _write(path, malformed)
    with pytest.raises(SystemExit) as stopped:
        review.main([
            "apply-rulings", "--root", str(root),
            "--candidate-manifest", "media/candidate.json", "--run-receipt", "run/run.json",
            "--assembly-receipt", "assembled/frame-assembly.json",
            "--extraction-receipt", "samples/frame-extraction.json", "--rulings", "malformed.json",
        ])
    captured = capsys.readouterr()
    assert stopped.value.code == 2 and "closed schema" in captured.err
    assert "Traceback" not in captured.err
    assert not list(store.glob("attempt-*.json")) and not (store / "terminal-claim.json").exists()


def test_real_approved_gen_candidate_cli_applies_fixture_rulings_and_validates(
    tmp_path: Path,
) -> None:
    gen_tests = _load("figment_video_rulings_gen_helpers", PIPELINE / "tests" / "test_gen_stage.py")
    command = _load("figment_video_rulings_train", PIPELINE / "figment_train.py")
    personas = tmp_path / "personas"
    gen_tests._promoted_persona(personas, creator_id="creator-002", steps=3000)
    gen_tests._prepare_accepted_checkpoint(command, personas, tmp_path)
    out = tmp_path / "approved-gen-video"
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
    candidate_relative = Path(authority["path"]).relative_to(tmp_path).parent / "review-candidate.json"
    candidate = review.video.write_manifest(
        root=tmp_path, persona_path=source_persona.relative_to(tmp_path),
        approved_gen_plan=(out / "plan.json").relative_to(tmp_path), approved_gen_image_id=image_id,
        action="walk slowly toward the camera", out=candidate_relative, seed=77,
        mode=review.video.CANDIDATE_MODE,
    )
    job = candidate["jobs"][0]
    graph = review.runner.apply_job(candidate["workflow"], job, review.runner.manifest_seed_fields(candidate))
    graph["56"]["inputs"]["is_changed"] = [authority["sha256"]]
    prompt = json.dumps(graph, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    run_dir = tmp_path / "candidate-run"; run_dir.mkdir()
    files = []
    for index in range(1, 82):
        frame = run_dir / f"{job['output_name']}_{index:02d}.png"
        metadata = PngImagePlugin.PngInfo(); metadata.add_text("prompt", prompt)
        Image.new("RGB", (1280, 704), (index % 255, 75, 95)).save(frame, pnginfo=metadata)
        files.append({"path": frame.name, "bytes": frame.stat().st_size})
    run_path = run_dir / "run.json"
    _write(run_path, {
        "schema": "figment/runpod-run@1", "dry_run": False,
        "pod_id": "synthetic-review-rulings-fixture", "termination_verified": True,
        "placement_attempts": [{"termination_verified": True}],
        "jobs": [{"job": 1, "output_name": job["output_name"], "seed": job["seed"], "files": files}],
    })
    review.assembly.assemble_frames(
        root=tmp_path, manifest_path=candidate_relative,
        run_receipt_path=run_path.relative_to(tmp_path), output_dir=Path("candidate-assembly"),
    )
    review.frames.extract_frames(
        root=tmp_path, video_path=Path("candidate-assembly/candidate.mp4"),
        output_dir=Path("candidate-samples"),
    )
    common = [
        "--root", str(tmp_path), "--candidate-manifest", str(candidate_relative),
        "--run-receipt", str(run_path.relative_to(tmp_path)),
        "--assembly-receipt", "candidate-assembly/frame-assembly.json",
        "--extraction-receipt", "candidate-samples/frame-extraction.json",
    ]
    prepared = subprocess.run(
        [sys.executable, str(VIDEO_REVIEW), "prepare", *common],
        capture_output=True, text=True, timeout=90,
    )
    assert prepared.returncode == 0, prepared.stderr
    store = review._review_directory(tmp_path / candidate_relative, candidate["candidate_id"])
    evaluation = json.loads((store / "evaluation-inputs.json").read_text(encoding="utf-8"))
    fixture_rulings = tmp_path / "fixture-video-rulings.json"
    _write(fixture_rulings, _rulings(evaluation, "fixture-accept"))
    applied = subprocess.run(
        [sys.executable, str(VIDEO_REVIEW), "apply-rulings", *common,
         "--rulings", str(fixture_rulings.relative_to(tmp_path))],
        capture_output=True, text=True, timeout=120,
    )
    assert applied.returncode == 0, applied.stderr
    assert json.loads(applied.stdout)["status"] == "accepted"
    projection = review.validate_accepted_video(
        tmp_path, (store / "accepted-video.json").relative_to(tmp_path),
    )
    assert projection["creator_id"] == "creator-002"
    assert projection["movie"]["sha256"] == _digest(tmp_path / projection["movie"]["path"])
    path_lengths = {
        "attempt": len(str(store / "attempt-fixture-accept.json")),
        "claim": len(str(store / "terminal-claim.json")),
        "accepted": len(str(store / "accepted-video.json")),
        "temporary_worst_case": len(str(store / ".pending-12345678.json")),
    }
    assert max(path_lengths.values()) < 260, path_lengths


# --- adversarial regressions on one accepted store, restored after every case ---

ACCEPTED_ATTEMPT = "attempt-accept-9.json"


@pytest.fixture(scope="module")
def accepted_base(prepared_base: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("video-rulings-accepted") / "case"
    shutil.copytree(prepared_base, root)
    patch = pytest.MonkeyPatch()
    try:
        _bind_authority(root, patch)
        evaluation, _ = _evaluation(root)
        parked = root / "parked-9.json"; _write(parked, _rulings(evaluation, "park-9", "parked"))
        _apply(root, parked)
        accepted = root / "accepted-9.json"; _write(accepted, _rulings(evaluation, "accept-9"))
        _apply(root, accepted)
    finally:
        patch.undo()
    return root


@pytest.fixture
def accepted_case(accepted_base: Path, monkeypatch: pytest.MonkeyPatch):
    _bind_authority(accepted_base, monkeypatch)
    _, store = _evaluation(accepted_base)
    snapshot = {path.name: path.read_bytes() for path in store.iterdir()}
    yield accepted_base, store
    for path in store.iterdir():
        if path.name not in snapshot:
            shutil.rmtree(path) if path.is_dir() else path.unlink()
    for name, raw in snapshot.items():
        (store / name).write_bytes(raw)


def _validate(root: Path, store: Path) -> dict[str, object]:
    return review.validate_accepted_video(root, (store / "accepted-video.json").relative_to(root))


def _records(store: Path) -> dict[str, dict]:
    return {
        "accepted": json.loads((store / "accepted-video.json").read_text(encoding="utf-8")),
        "attempt": json.loads((store / ACCEPTED_ATTEMPT).read_text(encoding="utf-8")),
        "claim": json.loads((store / "terminal-claim.json").read_text(encoding="utf-8")),
    }


def _publish(store: Path, records: dict[str, dict], *, rehash: bool) -> None:
    """Rewrite records; with rehash, a forger also recomputes every digest chain."""
    accepted, attempt, claim = records["accepted"], records["attempt"], records["claim"]
    if rehash:
        rulings = review._canonical(attempt["rulings"], "forged rulings")
        stamp = review._canonical(attempt["sample_stamp"], "forged stamp")
        attempt["rulings_sha256"] = accepted["rulings_sha256"] = claim["rulings_sha256"] = rulings
        attempt["sample_stamp_sha256"] = claim["sample_stamp_sha256"] = stamp
        attempt["subject_sha256"] = review._canonical(attempt["subject"], "forged subject")
    attempt_path = store / ACCEPTED_ATTEMPT
    _write(attempt_path, attempt)
    record = accepted.get("attempt", {}).get("record") if isinstance(accepted.get("attempt"), dict) else None
    if isinstance(record, dict):
        original = json.loads((store / "accepted-video.json").read_text(encoding="utf-8"))["attempt"]["record"]
        # Rebind unchanged pointer fields after changing the attempt, but preserve
        # an explicit malformed-pointer mutation so the validator actually sees it.
        for field, current in (("bytes", attempt_path.stat().st_size), ("sha256", _digest(attempt_path))):
            if type(record.get(field)) is type(original[field]) and record.get(field) == original[field]:
                record[field] = current
    _write(store / "accepted-video.json", accepted)
    _write(store / "terminal-claim.json", claim)


def _boolean_frame_index(records: dict[str, dict]) -> None:
    row = next(item for item in records["attempt"]["rulings"]["samples"] if item["index"] in (0, 1))
    row["index"] = bool(row["index"])  # equal to the int under ==, but never a frame index


RECORD_MUTATIONS = {
    # name: (mutator, forger rehashes digests, expected refusal)
    "accepted-extra-key": (lambda r: r["accepted"].update(note="x"), False, "closed schema"),
    "accepted-missing-rulings-digest": (lambda r: r["accepted"].pop("rulings_sha256"), False, "closed schema"),
    "accepted-rulings-digest": (lambda r: r["accepted"].update(rulings_sha256="0" * 64), False, "digest is corrupt"),
    "accepted-attribution": (lambda r: r["accepted"]["attribution"].update(decided_by="forged"), False, "disagree|attribution"),
    "accepted-status": (lambda r: r["accepted"].update(status="rejected"), False, "terminal authority"),
    "accepted-attempt-id-unhashable": (lambda r: r["accepted"]["attempt"].update(id=["accept-9"]), False, "attempt id"),
    "accepted-attempt-id-traversal": (lambda r: r["accepted"]["attempt"].update(id="../accept-9"), False, "attempt id"),
    "accepted-attempt-id-other": (lambda r: r["accepted"]["attempt"].update(id="park-9"), False, "attempt"),
    "accepted-attempt-record-path": (lambda r: r["accepted"]["attempt"]["record"].update(path=["x"]), False, "file entry"),
    "accepted-attempt-record-bool-bytes": (lambda r: r["accepted"]["attempt"]["record"].update(bytes=True), False, "file entry"),
    "accepted-movie": (lambda r: r["accepted"]["movie"].update(sha256="0" * 64), False, "accepted movie"),
    "accepted-inputs-extra": (lambda r: r["accepted"]["inputs"].update(rulings="x.json"), False, "closed schema"),
    "claim-decision-reject": (lambda r: r["claim"].update(decision="reject"), False, "terminal claim"),
    "claim-attribution": (lambda r: r["claim"]["attribution"].update(decided_by="forged"), False, "terminal claim"),
    "claim-missing-stamp": (lambda r: r["claim"].pop("sample_stamp_sha256"), False, "closed schema"),
    "claim-review-directory": (lambda r: r["claim"].update(review_directory="elsewhere"), False, "terminal claim"),
    "claim-attempt": (lambda r: r["claim"].update(attempt_id="park-9"), False, "terminal claim"),
    "claim-legacy-schema": (lambda r: [r["claim"].pop(key) for key in ("review_directory", "rulings_sha256", "sample_stamp_sha256", "attribution")], False, "closed schema"),
    "attempt-extra-key": (lambda r: r["attempt"].update(note="x"), True, "closed schema"),
    "attempt-status-parked": (lambda r: r["attempt"].update(status="parked"), True, "accepted review manifest"),
    "attempt-rulings-digest": (lambda r: r["attempt"].update(rulings_sha256="0" * 64), False, "digest is corrupt"),
    "attempt-subject-digest": (lambda r: r["attempt"].update(subject_sha256="0" * 64), False, "subject digest|stale"),
    "attempt-attribution": (lambda r: r["attempt"]["attribution"].update(decided_by="forged"), True, "disagree"),
    "attempt-rulings-source": (lambda r: r["attempt"]["rulings_source"].update(sha256="x"), True, "digest"),
    "rehashed-reject-decision": (lambda r: r["attempt"]["rulings"].update(decision="reject", reason="forged"), True, "disagree"),
    "rehashed-parked-decision": (lambda r: r["attempt"]["rulings"].update(decision="parked", reason="forged"), True, "disagree"),
    "rehashed-raw-rulings-schema": (lambda r: r["attempt"]["rulings"].update(schema=review.RULINGS_SCHEMA), True, "normalized video rulings"),
    "rehashed-override": (lambda r: r["attempt"]["rulings"].update(override=True), True, "override"),
    "rehashed-boolean-frame-index": (_boolean_frame_index, True, "does not bind"),
    "rehashed-unhashable-index": (lambda r: r["attempt"]["rulings"]["samples"][0].update(index=[0]), True, "does not bind"),
    "rehashed-unhashable-image-id": (lambda r: r["attempt"]["rulings"]["samples"][0].update(image_id=["first"]), True, "uniquely name"),
    "rehashed-dropped-sample": (lambda r: r["attempt"]["rulings"]["samples"].pop(), True, "complete sample|sample stamp"),
    "rehashed-sequence-omitted": (lambda r: r["attempt"]["rulings"].update(complete_sequence=None), True, "complete sample"),
    "rehashed-playback-fail": (lambda r: r["attempt"]["rulings"]["full_playback"]["axes"].update({review.PLAYBACK_AXES[0]: "fail"}), True, "temporal observation"),
    "rehashed-forged-stamp": (lambda r: r["attempt"]["sample_stamp"]["images"][0].update(parked_reasons=["forged"]), True, "sample stamp"),
    # The stored stamp still says verified; qa_stamp must re-derive the failed identity row.
    "rehashed-invented-stamp-pass": (lambda r: r["attempt"]["rulings"]["samples"][0].update(identity="hard-fail"), True, "verified|sample stamp"),
}


def test_rehash_harness_round_trips_the_honest_acceptance(accepted_case) -> None:
    root, store = accepted_case
    records = _records(store)
    _publish(store, records, rehash=True)
    assert _validate(root, store)["candidate_id"] == records["accepted"]["candidate_id"]


@pytest.mark.parametrize("name", sorted(RECORD_MUTATIONS))
def test_validator_refuses_mutated_or_rehashed_records(accepted_case, name: str) -> None:
    root, store = accepted_case
    mutate, rehash, expected = RECORD_MUTATIONS[name]
    records = _records(store)
    mutate(records)
    _publish(store, records, rehash=rehash)
    with pytest.raises(review.VideoReviewError, match=expected):
        _validate(root, store)


def _excess_temporaries(store: Path) -> None:
    for index in range(review.MAX_STORE_ENTRIES):
        (store / f".p-x{index}.json").write_bytes(b"{}")


STORE_MUTATIONS = {
    "competing-rejection": (lambda store: (store / "rejection-lineage.json").write_text("{}"), "conflicting or missing"),
    "missing-claim": (lambda store: (store / "terminal-claim.json").unlink(), "conflicting or missing"),
    "missing-attempt": (lambda store: (store / ACCEPTED_ATTEMPT).unlink(), "missing from its canonical store"),
    "unknown-entry": (lambda store: (store / "notes.txt").write_text("x"), "unexpected entry"),
    "non-regular-entry": (lambda store: (store / "attempt-dir.json").mkdir(), "non-regular"),
    "excess-entries": (_excess_temporaries, "bounded entry limit"),
    "evaluation-changed": (lambda store: (store / "evaluation-inputs.json").write_bytes((store / "evaluation-inputs.json").read_bytes() + b" "), "evaluation"),
}


@pytest.mark.parametrize("name", sorted(STORE_MUTATIONS))
def test_validator_refuses_unknown_competing_or_stale_store_state(accepted_case, name: str) -> None:
    root, store = accepted_case
    mutate, expected = STORE_MUTATIONS[name]
    mutate(store)
    with pytest.raises(review.VideoReviewError, match=expected):
        _validate(root, store)


@pytest.mark.parametrize("target", ["accepted-video.json", "terminal-claim.json"])
def test_validator_refuses_record_replaced_between_verification_and_final_read(
    accepted_case, monkeypatch: pytest.MonkeyPatch, target: str,
) -> None:
    root, store = accepted_case
    original = review._accepted_snapshot
    calls: list[int] = []
    def replace_after_first(root_arg: Path, path_arg: Path) -> dict[str, object]:
        result = original(root_arg, path_arg)
        if not calls:
            # Same JSON value, new bytes: each pass alone is self-consistent.
            _write(store / target, json.loads((store / target).read_text(encoding="utf-8")))
        calls.append(1)
        return result
    monkeypatch.setattr(review, "_accepted_snapshot", replace_after_first)
    with pytest.raises(review.VideoReviewError, match="does not match current evidence"):
        _validate(root, store)
    monkeypatch.setattr(review, "_accepted_snapshot", original)
    assert _validate(root, store)["candidate_id"]  # the replaced bytes alone are still valid


def test_validator_refuses_non_canonical_accepted_copies(accepted_case) -> None:
    root, store = accepted_case
    copy_path = root / "accepted-copy.json"
    copy_path.write_bytes((store / "accepted-video.json").read_bytes())
    try:
        for candidate in (Path("accepted-copy.json"), Path("../accepted-video.json")):
            with pytest.raises(review.VideoReviewError):
                review.validate_accepted_video(root, candidate)
    finally:
        copy_path.unlink()


def test_parked_rulings_after_terminal_are_refused_without_append(accepted_case) -> None:
    root, store = accepted_case
    evaluation, _ = _evaluation(root)
    path = root / "late-park.json"
    _write(path, _rulings(evaluation, "park-late", "parked"))
    try:
        with pytest.raises(review.VideoReviewError, match="terminal"):
            _apply(root, path)
    finally:
        path.unlink()
    assert not (store / "attempt-park-late.json").exists()
    assert _validate(root, store)["candidate_id"] == evaluation["candidate_id"]


def test_parked_attempt_racing_a_terminal_claim_is_retracted(
    prepared_base: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _case(prepared_base, tmp_path, monkeypatch)
    evaluation, store = _evaluation(root)
    context = _context(root, _rulings(evaluation, "park-race", "parked"), "park.json")
    monkeypatch.setattr(review, "_decision_context", lambda *args: context)
    original = review._store_inventory
    calls: list[int] = []
    def claim_lands_after_append(root_arg: Path, store_arg: Path) -> dict[str, object]:
        result = original(root_arg, store_arg)
        calls.append(1)
        return {**result, "claimed": True} if len(calls) == 2 else result
    monkeypatch.setattr(review, "_store_inventory", claim_lands_after_append)
    with pytest.raises(review.VideoReviewError, match="parked attempt refused"):
        review.apply_rulings(root=root, rulings=Path("park.json"), **_inputs())
    assert len(calls) == 2
    assert not (store / "attempt-park-race.json").exists()
    assert not list(store.glob(".p-*.json"))


def _failing_axis_cases() -> list[tuple[str, str]]:
    cases = [("sample", axis) for axis in (*review.SAMPLE_QUALITY_AXES, *review.SAMPLE_SAFETY_AXES)]
    cases += [("complete_sequence", axis) for axis in review.SEQUENCE_AXES]
    cases += [("full_playback", axis) for axis in review.PLAYBACK_AXES]
    return cases


@pytest.mark.parametrize(("area", "axis"), _failing_axis_cases())
def test_acceptance_refuses_every_single_failing_axis(prepared_base: Path, area: str, axis: str) -> None:
    evaluation, _ = _evaluation(prepared_base)
    subject = evaluation["subject"]
    value = _rulings(evaluation, "accept-axis")
    if area == "sample":
        value["samples"][-1][axis] = "fail"
    else:
        value[area]["axes"][axis] = "fail"
    with pytest.raises(review.VideoReviewError):
        normalized = review._normalize_rulings(value, subject)
        review._assert_decision_allowed(normalized, review._stamp_samples(subject, normalized))


def _set_sample(key: str, item: object):
    return lambda value: value["samples"][0].__setitem__(key, item)


MALFORMED_RULINGS = {
    "not-an-object": lambda value: value.clear() or value.update(rows=[]),
    "schema-list": lambda value: value.update(schema=[review.RULINGS_SCHEMA]),
    "candidate-list": lambda value: value.update(candidate_id=["x"]),
    "attempt-dict": lambda value: value.update(attempt_id={}),
    "attempt-bool": lambda value: value.update(attempt_id=True),
    "attempt-traversal": lambda value: value.update(attempt_id="../x"),
    "attempt-too-long": lambda value: value.update(attempt_id="a" * 17),
    "decision-list": lambda value: value.update(decision=["accept"]),
    "override-text": lambda value: value.update(override="false"),
    "decided-by-list": lambda value: value.update(decided_by=["x"]),
    "decided-at-naive": lambda value: value.update(decided_at="2026-09-10T06:00:00"),
    "samples-dict": lambda value: value.update(samples={}),
    "samples-duplicate": lambda value: value["samples"].__setitem__(1, copy.deepcopy(value["samples"][0])),
    "image-id-list": _set_sample("image_id", ["first"]),
    "image-id-dict": _set_sample("image_id", {"first": 1}),
    "index-list": _set_sample("index", [0]),
    "index-true": _set_sample("index", True),
    "index-false": _set_sample("index", False),
    "index-text": _set_sample("index", "0"),
    "frame-digest-int": _set_sample("frame_sha256", 123),
    "quality-list": _set_sample("identity", ["pass"]),
    "safety-dict": _set_sample("adult_read", {"pass": True}),
    "sequence-list": lambda value: value.update(complete_sequence=[]),
    "sequence-axis-int": lambda value: value["complete_sequence"]["axes"].update({review.SEQUENCE_AXES[0]: 1}),
    "playback-coverage-list": lambda value: value["full_playback"].update(coverage=["entire-clip"]),
    "playback-stale-movie": lambda value: value["full_playback"].update(movie_sha256="0" * 64),
}


@pytest.mark.parametrize("name", sorted(MALFORMED_RULINGS))
def test_malformed_rulings_raise_only_video_review_error(prepared_base: Path, name: str) -> None:
    evaluation, _ = _evaluation(prepared_base)
    value = _rulings(evaluation, "accept-bad")
    MALFORMED_RULINGS[name](value)
    with pytest.raises(review.VideoReviewError):
        review._normalize_rulings(value, evaluation["subject"])


def test_terminal_claim_recheck_is_bounded_before_reading_replaced_bytes(
    prepared_base: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _case(prepared_base, tmp_path, monkeypatch)
    evaluation, store = _evaluation(root)
    context = _context(root, _rulings(evaluation, "bounded-claim"), "one.json")
    claim = store / review.CLAIM_NAME
    calls = 0

    def current_context(*args):
        nonlocal calls
        calls += 1
        if calls == 4:
            claim.write_bytes(b" " * (review.MAX_JSON_BYTES + 1))
        return context

    original_read = Path.read_bytes
    def reject_unbounded_read(path: Path):
        if path == claim:
            raise AssertionError("terminal claim used an unbounded read_bytes call")
        return original_read(path)

    monkeypatch.setattr(review, "_decision_context", current_context)
    monkeypatch.setattr(Path, "read_bytes", reject_unbounded_read)
    with pytest.raises(review.VideoReviewError, match="no larger than"):
        review.apply_rulings(root=root, rulings=Path("one.json"), **_inputs())
    assert claim.stat().st_size == review.MAX_JSON_BYTES + 1
    assert not (store / review.ACCEPTED_NAME).exists()
