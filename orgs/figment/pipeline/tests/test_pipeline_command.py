"""Contract tests for the `pipeline` command (F1): one resumable driver across
anchor -> dataset -> smoke -> train -> tester -> gen -> detail, halting at every
gradeable stage until an operator ruling is applied, and never re-planning,
re-running, or re-grading a stage that already has current evidence on disk.

Shared helpers (`command`, `_synthetic_persona`, `_promoted_persona`, `_set_training`,
`_fake_stage_outputs`, `_axes`, `load_json`) come from `test_anchor_stage.py`, loaded
via importlib -- there is no package `__init__.py` anywhere in this test tree, the
same convention `test_gen_stage.py` documents and reuses.
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import uuid
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"
RUNS_ROOT = ROOT / "orgs" / "figment" / "runs"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def command():
    return load_module("figment_train_test_module_pipeline", PIPELINE / "figment_train.py")


anchor_stage_test = load_module(
    "figment_pipeline_test_anchor_stage", PIPELINE / "tests" / "test_anchor_stage.py",
)
_synthetic_persona = anchor_stage_test._synthetic_persona
_promoted_persona = anchor_stage_test._promoted_persona
_set_training = anchor_stage_test._set_training
_fake_stage_outputs = anchor_stage_test._fake_stage_outputs
_axes = anchor_stage_test._axes
load_json = anchor_stage_test.load_json

LEDGER_DAY = "2026-09-15"


def _install_fake_harness(command, monkeypatch, ledger_dir: Path):
    """A local, offline stand-in for the pod harness: for every `run["argv"]`
    `run_planned_stage` would otherwise launch, write the exact `run.json` receipt and
    matching cost-ledger row `verify_run_record`/`_verify_ledger` require, then return
    rc=0. No network, no pod, no paid call -- reused from the same pattern
    `test_lineage_freshness.py::test_all_pauses_at_anchor_and_repeat_never_launches_duplicate_work`
    already proves against this exact harness contract."""
    ledger_dir.mkdir(parents=True, exist_ok=True)
    ledger = ledger_dir / f"figment-{LEDGER_DAY}.tsv"
    if not ledger.is_file():
        ledger.write_text("model\tstep\tusd\n", encoding="utf-8")
    calls: list[str] = []
    real_run = command.subprocess.run

    def fake_harness(argv, cwd=None, **kwargs):
        # `monkeypatch.setattr(command.subprocess, "run", ...)` patches the one global
        # `subprocess` module, so every other caller in the tree lands here too --
        # notably frame_extract.py's ffmpeg/ffprobe invocations during the video stage's
        # own local assembly. Only the pod harness is faked; everything else runs for
        # real (all of it local and free).
        if len(argv) < 2 or Path(str(argv[1])).name != command.POD_RUNNER.name:
            return real_run(argv, cwd=cwd, **kwargs) if cwd is not None else real_run(argv, **kwargs)
        manifest_path = Path(argv[argv.index("--manifest") + 1])
        run_out = Path(argv[argv.index("--out") + 1])
        manifest = load_json(manifest_path)
        calls.append(manifest_path.name)
        run_out.mkdir(parents=True, exist_ok=True)
        pod_id = f"pod-{len(calls)}"
        receipt = {
            # `schema` is what the real harness writes and what frame_assemble.py's own
            # `_run_job` insists on before it will assemble a video from a receipt.
            "schema": "figment/runpod-run@1",
            "error": None, "dry_run": False, "pod_id": pod_id, "ledger_day": LEDGER_DAY,
            "termination_verified": True, "estimated_actual_usd": 0.01,
            "placement_attempts": [{
                "pod_id": pod_id, "estimated_actual_usd": 0.01,
                "termination_verified": True,
            }],
        }
        if manifest.get("artifacts"):
            # smoke/train: model artifacts, not per-job images (mirrors
            # test_gen_stage.py's _prepare_accepted_checkpoint fixture).
            artifacts = []
            for index, artifact in enumerate(manifest["artifacts"]):
                artifact_path = run_out / artifact["local"]
                artifact_path.parent.mkdir(parents=True, exist_ok=True)
                artifact_path.write_bytes(f"fixture artifact bytes {index:02d}".encode("utf-8"))
                artifacts.append({
                    "remote": artifact["remote"], "bytes": artifact_path.stat().st_size,
                })
            receipt["artifacts"] = artifacts
        else:
            # A video manifest declares the exact frame geometry frame_assemble.py
            # re-probes per downloaded PNG; every other stage's cells are only ever
            # read as opaque image bytes, so the cheap 8x8 fixture still applies.
            budget = manifest.get("frame_budget") or {}
            size = (budget.get("width", 8), budget.get("height", 8))
            receipt["jobs"] = []
            for number, job in enumerate(manifest["jobs"], start=1):
                expected = job.get("expected_images", 1)
                files = []
                for index in range(1, expected + 1):
                    name = (
                        f"{job['output_name']}.png" if expected == 1
                        else f"{job['output_name']}_{index:02d}.png"
                    )
                    Image.new("RGB", size, (index % 251, 80, 120)).save(run_out / name)
                    files.append({"path": name, "bytes": (run_out / name).stat().st_size})
                receipt["jobs"].append({
                    "job": number, "output_name": job["output_name"],
                    "seed": job.get("seed"), "files": files,
                })
        (run_out / "run.json").write_text(json.dumps(receipt), encoding="utf-8")
        model = command._pod_runner_module().gpu_model_label(manifest["gpu"]["type"])
        with ledger.open("a", encoding="utf-8") as handle:
            handle.write(f"{model}\tpod-create {pod_id}\t0.010000\n")
        return type("Result", (), {"returncode": 0})()

    monkeypatch.setattr(command.subprocess, "run", fake_harness)
    return calls


def _rule_current_grade(command, creator_id: str, stage: str, plan_path: Path, **extra) -> dict:
    """Fill and apply an "everything passes, gate_override for the fixture's fake
    faces" ruling for whatever grade/<stage>/rulings.template.json currently exists."""
    grade_dir = plan_path.parent / "grade" / stage
    template = load_json(grade_dir / "rulings.template.json")
    for row in template["rulings"]:
        row.update(_axes(), decision="keep")
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-15T00:00:00Z"})
    filled = grade_dir / "filled.json"
    filled.write_text(json.dumps(template), encoding="utf-8")
    return command.apply_rulings(creator_id, stage, plan_path, filled, **extra)


def test_pipeline_drives_dataset_through_detail_and_halts_at_each_gate(
    command, tmp_path, monkeypatch,
):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002")
    ledger_dir = tmp_path / "ledger"
    calls = _install_fake_harness(command, monkeypatch, ledger_dir)

    primary_root = tmp_path / "primary"
    kwargs = dict(
        personas_root=personas, skip_pin_verify=True, skip_judge=True,
        ledger_dir=ledger_dir,
    )

    # ---- dataset: a fresh --stage all plan is built, dataset runs, then GATEs ----
    result = command.command_pipeline("creator-002", out=primary_root, **kwargs)
    assert result["status"] == "GATE dataset"
    assert calls == [
        "creator-002-tensor-dataset-shard-01.yaml",
        "creator-002-tensor-dataset-shard-02.yaml",
        "creator-002-tensor-dataset-shard-03.yaml",
        "creator-002-tensor-dataset-fullbody.yaml",
    ]
    primary_plan_path = primary_root / "plan.json"
    assert (primary_root / "grade" / "dataset" / "gate.json").is_file()
    assert not (primary_root / "grade" / "dataset" / "approval-lineage.json").exists()

    # A re-invocation before the ruling is applied halts at exactly the same gate and
    # never re-runs or re-grades dataset.
    again = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert again["status"] == "GATE dataset"
    assert len(calls) == 4

    _rule_current_grade(command, "creator-002", "dataset", primary_plan_path)

    # ---- resume: dataset ruled -> smoke, train run (not gradeable) -> tester GATEs ----
    result = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert result["status"] == "GATE tester"
    assert "creator-002-tensor-train-smoke.yaml" in calls
    assert "creator-002-tensor-train.yaml" in calls
    assert "creator-002-tensor-tester.yaml" in calls
    tester_calls = len(calls)

    again = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert again["status"] == "GATE tester"
    assert len(calls) == tester_calls

    # Choose a checkpoint explicitly -- pipeline never applies rulings itself
    # (contract.md: a ruling is a human act).
    tester_plan = load_json(primary_plan_path)
    tester_manifest = load_json(primary_root / tester_plan["stages"]["tester"]["runs"][0]["manifest"])
    chosen_step = tester_plan["training"]["save_every"]
    filename = f"creator002krea2_{chosen_step:09d}.safetensors"
    candidate = next(
        job for job in tester_manifest["jobs"]
        if any(item.get("field") == "lora_name" and item.get("value") == filename
               for item in job.get("substitutions", []))
    )
    grade_dir = primary_root / "grade" / "tester"
    template = load_json(grade_dir / "rulings.template.json")
    for row in template["rulings"]:
        keep = row["image_id"] == candidate["output_name"]
        row.update(_axes(), decision="keep" if keep else "cull")
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-15T00:05:00Z"})
    filled = grade_dir / "filled.json"
    filled.write_text(json.dumps(template), encoding="utf-8")
    command.apply_rulings(
        "creator-002", "tester", primary_plan_path, filled, checkpoint_step=chosen_step,
    )
    assert (primary_root / "grade" / "tester" / "accepted-checkpoint.json").is_file()

    # ---- resume: tester accepted -> a fresh gen plan is built and run -> GATE gen ----
    result = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert result["status"] == "GATE gen"
    gen_root = primary_root / "downstream" / "gen"
    assert (gen_root / "plan.json").is_file()
    assert "creator-002-tensor-gen.yaml" in calls

    # Re-invoking does not build a second gen plan or re-run it.
    again = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert again["status"] == "GATE gen"
    assert calls.count("creator-002-tensor-gen.yaml") == 1

    _rule_current_grade(command, "creator-002", "gen", gen_root / "plan.json")

    # ---- resume: gen ruled -> a fresh detail plan is built and run -> GATE detail ----
    result = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert result["status"] == "GATE detail"
    detail_root = primary_root / "downstream" / "detail"
    assert (detail_root / "plan.json").is_file()
    assert "creator-002-tensor-detail.yaml" in calls

    _rule_current_grade(command, "creator-002", "detail", detail_root / "plan.json")

    # ---- resume: detail ruled -> this run root is OUTSIDE the repository, so the video
    # stage refuses by name (F6a) while still writing everything ruled through detail ----
    result = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert result["status"] == "stopped:video-out-of-tree"
    assert "inside the run-root authority root" in result["message"]
    assert "orgs/figment/runs/<creator>/<YYYYMMDD-HHMMSS>/" in result["message"]
    assert not (primary_root / "downstream" / "video").exists()
    assert result["deliverable"] == str(primary_root / "deliverable" / "manifest.json")
    deliverable = load_json(Path(result["deliverable"]))
    assert deliverable["schema"] == "figment/deliverable@1"
    assert deliverable["checkpoint"]["step"] == chosen_step
    gen_kept = load_json(gen_root / "grade" / "gen" / "approved-list.json")["images"]
    detail_kept = load_json(detail_root / "grade" / "detail" / "approved-list.json")["images"]
    assert len(deliverable["stills"]) == len(gen_kept)
    assert len(deliverable["detail"]) == len(detail_kept)
    for row in deliverable["stills"]:
        assert (primary_root / row["path"]).is_file()
        assert row["gate"]["pass"] is True or row["ruling"]["gate_override"]
        assert row["ruling"]["decided_by"] == "operator-fixture"
    for row in deliverable["detail"]:
        assert (primary_root / row["path"]).is_file()

    # A second call does not rebuild the deliverable (same manifest, byte-identical).
    before = manifest_path = Path(result["deliverable"])
    before_bytes = before.read_bytes()
    again = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert again["deliverable"] == result["deliverable"]
    assert manifest_path.read_bytes() == before_bytes

    # Every plan/run/grade step above ran exactly once across the whole resumed chain.
    assert calls.count("creator-002-tensor-dataset-shard-01.yaml") == 1
    assert calls.count("creator-002-tensor-tester.yaml") == 1
    assert calls.count("creator-002-tensor-detail.yaml") == 1


@pytest.fixture
def in_repo_run_root():
    """The `video` stage requires ONE containment root holding the plan, the REAL
    persona.yaml, the approved still and every output -- `video_manifest`'s
    review-candidate mode binds the plan's own in-repo persona digest -- and the boss
    ruling fixes that root as the repository. So this fixture builds its run under the
    same gitignored `orgs/figment/runs/` tree `pipeline --out` now defaults to, rather
    than pytest's `tmp_path`, and removes it afterwards. The name is deliberately short:
    the candidate output name alone is ~102 characters and Windows caps ordinary paths
    at 260."""
    RUNS_ROOT.mkdir(parents=True, exist_ok=True)
    root = RUNS_ROOT / f"t{uuid.uuid4().hex[:6]}"
    root.mkdir()
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _drive_through_detail(command, creator_id: str, primary_root: Path, kwargs: dict) -> int:
    """dataset -> tester (promoting the first intermediate checkpoint) -> gen -> detail,
    applying the same "everything passes, gate_override for the fixture's fake faces"
    ruling at each gate. Returns the promoted checkpoint step."""
    plan_path = primary_root / "plan.json"
    assert command.command_pipeline(creator_id, out=primary_root, **kwargs)["status"] == "GATE dataset"
    _rule_current_grade(command, creator_id, "dataset", plan_path)
    assert command.command_pipeline(creator_id, plan_path=plan_path, **kwargs)["status"] == "GATE tester"

    plan = load_json(plan_path)
    tester_manifest = load_json(primary_root / plan["stages"]["tester"]["runs"][0]["manifest"])
    chosen_step = plan["training"]["save_every"]
    filename = f"{plan['training']['trigger']}_{chosen_step:09d}.safetensors"
    candidate = next(
        job for job in tester_manifest["jobs"]
        if any(item.get("field") == "lora_name" and item.get("value") == filename
               for item in job.get("substitutions", []))
    )
    grade_dir = primary_root / "grade" / "tester"
    template = load_json(grade_dir / "rulings.template.json")
    for row in template["rulings"]:
        row.update(_axes(), decision="keep" if row["image_id"] == candidate["output_name"] else "cull")
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-15T00:05:00Z"})
    filled = grade_dir / "filled.json"
    filled.write_text(json.dumps(template), encoding="utf-8")
    command.apply_rulings(creator_id, "tester", plan_path, filled, checkpoint_step=chosen_step)

    assert command.command_pipeline(creator_id, plan_path=plan_path, **kwargs)["status"] == "GATE gen"
    _rule_current_grade(command, creator_id, "gen", primary_root / "downstream" / "gen" / "plan.json")
    assert command.command_pipeline(creator_id, plan_path=plan_path, **kwargs)["status"] == "GATE detail"
    _rule_current_grade(command, creator_id, "detail", primary_root / "downstream" / "detail" / "plan.json")
    return chosen_step


def test_pipeline_drives_an_in_repo_run_root_through_video_to_the_deliverable(
    command, in_repo_run_root, monkeypatch,
):
    """F6a end to end, entirely offline: from a run whose detail stage is already ruled,
    `pipeline` plans the video stage from gen's own kept still through the EXISTING
    video_manifest compiler, runs it on the fake harness, assembles the native movie,
    renders the reel derivative and the sampled frames, halts at `GATE video`, and -- once
    ruled -- puts the reel and its correspondence hashes in the deliverable."""
    personas = in_repo_run_root / "ps"
    _promoted_persona(personas, creator_id="creator-002")
    ledger_dir = in_repo_run_root / "lg"
    calls = _install_fake_harness(command, monkeypatch, ledger_dir)
    primary_root = in_repo_run_root / "p"
    primary_plan_path = primary_root / "plan.json"
    kwargs = dict(
        personas_root=personas, skip_pin_verify=True, skip_judge=True, ledger_dir=ledger_dir,
    )
    _drive_through_detail(command, "creator-002", primary_root, kwargs)

    # ---- resume: video planned from gen's kept still, run, assembled, then GATEs ----
    result = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert result["status"] == "GATE video"
    video_root = primary_root / "downstream" / "video"
    source = load_json(video_root / "plan.json")["video_source"]

    gen_kept = load_json(
        primary_root / "downstream" / "gen" / "grade" / "gen" / "approved-list.json",
    )["images"]
    assert source["image_id"] == sorted(row["image_id"] for row in gen_kept)[0]
    still = next(row for row in gen_kept if row["image_id"] == source["image_id"])
    manifest_path = Path(source["manifest"])
    # APPROVED_GEN_ADAPTER.md: the manifest is written beside the selected frame, which
    # is in the GEN plan's output tree, not the video plan's.
    assert manifest_path.parent == Path(still["path"]).parent
    manifest = load_json(manifest_path)
    assert manifest["mode"] == "review-candidate-v1"
    assert manifest["candidate_id"] == source["candidate_id"]
    assert manifest["jobs"][0]["expected_images"] == 81
    assert manifest["frame_budget"] == {
        "width": 1280, "height": 704, "frames": 81, "fps": 16, "batch_size": 1,
    }
    assert manifest["provenance"]["first_frame"]["approved_gen"]["image_id"] == source["image_id"]

    # ---- the local evidence chain: native movie -> reel derivative -> sampled frames ----
    assembly = load_json(video_root / "video" / "assembled" / "frame-assembly.json")
    reel = load_json(video_root / "video" / "reel" / "reel-derivative.json")
    extraction = load_json(video_root / "video" / "samples" / "frame-extraction.json")
    assert len(assembly["frames"]) == 81 and assembly["candidate"]["id"] == source["candidate_id"]
    assert reel["delivery_profile"] == {
        "width": 1080, "height": 1920, "fps": 30,
        "source": "content/reel-templates.yaml delivery",
    }
    assert reel["correspondence"]["native"]["sha256"] == assembly["movie"]["sha256"]
    assert [row["label"] for row in extraction["frames"]] == ["first", "middle", "last"]

    # ---- identity under motion: one gate row per sampled native frame ----
    output_name = manifest["jobs"][0]["output_name"]
    expected_ids = [f"{output_name}_{index:02d}" for index in range(1, 82, 8)]
    graded = load_json(video_root / "grade" / "video" / "grading-manifest.json")
    assert [row["image_id"] for row in graded["images"]] == expected_ids
    gate = load_json(video_root / "grade" / "video" / "gate.json")
    assert gate["schema"] == "figment/gate@1"
    assert {row["image_id"] for row in gate["rows"]} == set(expected_ids)
    frames_by_id = {Path(row["path"]).stem: row for row in assembly["frames"]}
    assert set(expected_ids) <= set(frames_by_id)

    # A repeat call halts at the same gate and never re-runs or re-assembles.
    native_before = (video_root / "video" / "assembled" / "candidate.mp4").read_bytes()
    again = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert again["status"] == "GATE video"
    assert calls.count(manifest_path.name) == 1
    assert (video_root / "video" / "assembled" / "candidate.mp4").read_bytes() == native_before

    _rule_current_grade(command, "creator-002", "video", video_root / "plan.json")

    # ---- ruled: the deliverable gains the reel plus its correspondence hashes ----
    result = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert result["status"] == "complete:video"
    deliverable = load_json(Path(result["deliverable"]))
    delivered = deliverable["video"]
    reel_path = primary_root / delivered["reel"]["path"]
    assert reel_path.is_file() and reel_path.name == f"{source['candidate_id']}.mp4"
    assert reel_path.parent == primary_root / "deliverable" / "video"
    # The delivered mp4 IS the recorded derivative, that derivative IS this run's own
    # native movie, and that movie IS the 81 hash-pinned native frames.
    assert command._sha256(reel_path) == reel["correspondence"]["derivative"]["sha256"]
    assert delivered["reel"]["sha256"] == reel["correspondence"]["derivative"]["sha256"]
    assert delivered["correspondence"]["native"]["sha256"] == assembly["movie"]["sha256"]
    assert command._sha256(ROOT / assembly["movie"]["path"]) == assembly["movie"]["sha256"]
    assert delivered["native_movie"] == assembly["movie"]
    assert len(delivered["identity_under_motion"]) == len(expected_ids)
    for row in delivered["identity_under_motion"]:
        native = frames_by_id[row["image_id"]]
        assert row["native_frame"]["sha256"] == native["sha256"]
        assert command._sha256(ROOT / native["path"]) == native["sha256"]
        assert row["gate"]["pass"] is True or row["ruling"]["gate_override"]
        assert row["ruling"]["decided_by"] == "operator-fixture"

    # Idempotent once video is ruled, exactly as it was through detail.
    before = Path(result["deliverable"]).read_bytes()
    final = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert final["status"] == "complete:video"
    assert Path(result["deliverable"]).read_bytes() == before


def _drive_through_video_ruled(command, in_repo_run_root, monkeypatch) -> tuple[Path, Path, dict]:
    """dataset -> ... -> detail -> video, ruled -- the exact state
    `test_pipeline_drives_an_in_repo_run_root_through_video_to_the_deliverable` reaches
    just before its final `command_pipeline` call writes `deliverable/manifest.json`.
    Factored out so B1-video's tamper reproductions below can each call
    `command._build_deliverable(...)` directly against a fresh (not-yet-built)
    deliverable, without re-driving the whole chain inline."""
    personas = in_repo_run_root / "ps"
    _promoted_persona(personas, creator_id="creator-002")
    ledger_dir = in_repo_run_root / "lg"
    _install_fake_harness(command, monkeypatch, ledger_dir)
    primary_root = in_repo_run_root / "p"
    primary_plan_path = primary_root / "plan.json"
    kwargs = dict(
        personas_root=personas, skip_pin_verify=True, skip_judge=True, ledger_dir=ledger_dir,
    )
    _drive_through_detail(command, "creator-002", primary_root, kwargs)
    result = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert result["status"] == "GATE video"
    video_root = primary_root / "downstream" / "video"
    _rule_current_grade(command, "creator-002", "video", video_root / "plan.json")
    return primary_root, video_root, kwargs


def _build_video_deliverable(command, primary_root: Path, video_root: Path) -> dict:
    return command._build_deliverable(
        "creator-002", primary_root, primary_root / "downstream" / "gen",
        primary_root / "downstream" / "detail", video_root,
    )


def test_deliverable_video_refuses_a_fake_subject_image_appended_to_the_approval(
    command, in_repo_run_root, monkeypatch,
):
    """B1-video repro (a): the OLD code trusted `grade/video/approved-list.json` rows
    directly. The new one instead loads the CURRENT approval through
    `_load_current_approval` and builds `identity_rows` from ITS OWN `subject.images` --
    a hand-edited approval-lineage.json naming an extra, never-reviewed frame is caught
    by the freshness check (a tampered `subject` no longer matches its own recorded
    digest, or the freshly recomputed one) before any bytes are touched."""
    primary_root, video_root, kwargs = _drive_through_video_ruled(command, in_repo_run_root, monkeypatch)
    approval_path = video_root / "grade" / "video" / "approval-lineage.json"
    approval = load_json(approval_path)
    fake_row = dict(approval["subject"]["images"][0])
    fake_row["image_id"] = "evil-fake-frame-never-reviewed"
    approval["subject"]["images"].append(fake_row)
    approval_path.write_text(json.dumps(approval), encoding="utf-8")

    with pytest.raises(command.FigmentTrainError, match="stale|corrupt"):
        _build_video_deliverable(command, primary_root, video_root)
    assert not (primary_root / "deliverable" / "video").exists()


def test_deliverable_video_refuses_a_gate_failed_row_without_override(
    command, in_repo_run_root, monkeypatch,
):
    """B1-video repro (b): every fixture cell fails the real gate (no real face), so the
    happy path only ships because `_rule_current_grade` fills a `gate_override` on every
    kept row. Stripping that override for one kept row -- leaving it gate-failed AND
    override-free -- must refuse, not silently attach an empty ruling the way the old
    `gate_by_id.get(image_id)`/`.get(image_id, {})` pair did."""
    primary_root, video_root, kwargs = _drive_through_video_ruled(command, in_repo_run_root, monkeypatch)
    rulings_path = video_root / "grade" / "video" / "rulings.json"
    rulings = load_json(rulings_path)
    kept = next(row for row in rulings["rulings"] if row["decision"] == "keep")
    kept["gate_override"] = None
    rulings_path.write_text(json.dumps(rulings), encoding="utf-8")

    with pytest.raises(command.FigmentTrainError, match="lacks a gate pass or override"):
        _build_video_deliverable(command, primary_root, video_root)
    assert not (primary_root / "deliverable" / "video").exists()


def test_deliverable_video_refuses_a_tampered_native_frame_after_assembly(
    command, in_repo_run_root, monkeypatch,
):
    """B1-video repro (c): `frame-assembly.json` records each native frame's own bytes
    and sha256, but the old `_deliverable_video` copied `native_frame.sha256`/`bytes`
    straight out of that receipt without ever re-reading the actual PNG. Tampering an
    UNGRADED native frame (only every 8th of the 81 is graded -- `VIDEO_FRAME_SAMPLE_EVERY`)
    on disk proves the fix specifically: the operator-approval freshness check alone
    (recomputed only from the GRADED images) would never notice this tamper, so only the
    new full re-hash of every assembled frame catches it."""
    primary_root, video_root, kwargs = _drive_through_video_ruled(command, in_repo_run_root, monkeypatch)
    assembly = load_json(video_root / "video" / "assembled" / "frame-assembly.json")
    graded = load_json(video_root / "grade" / "video" / "grading-manifest.json")
    graded_ids = {row["image_id"] for row in graded["images"]}
    frame_row = next(
        row for row in assembly["frames"] if Path(row["path"]).stem not in graded_ids
    )
    (ROOT / frame_row["path"]).write_bytes(b"tampered native frame bytes, post-assembly")

    with pytest.raises(command.FigmentTrainError, match="native frame .* bytes do not match"):
        _build_video_deliverable(command, primary_root, video_root)
    assert not (primary_root / "deliverable" / "video").exists()


def test_deliverable_video_refuses_an_edited_reel_derivative_mp4_pair(
    command, in_repo_run_root, monkeypatch,
):
    """B1-video repro (d): the old code compared the delivered mp4's digest only to
    `reel-derivative.json`'s own claimed field -- never re-verified against the actual
    source reel.mp4 bytes it was about to copy from. Corrupting the on-disk `reel.mp4`
    the receipt still claims a now-stale sha256 for must refuse once those (now-wrong)
    bytes are copied and re-hashed."""
    primary_root, video_root, kwargs = _drive_through_video_ruled(command, in_repo_run_root, monkeypatch)
    reel = load_json(video_root / "video" / "reel" / "reel-derivative.json")
    reel_movie_path = ROOT / reel["correspondence"]["derivative"]["path"]
    reel_movie_path.write_bytes(b"corrupted reel derivative bytes")

    with pytest.raises(command.FigmentTrainError, match="delivered reel bytes do not match"):
        _build_video_deliverable(command, primary_root, video_root)


def test_deliverable_video_happy_path_unchanged(command, in_repo_run_root, monkeypatch):
    """B1-video repro (e): the ordinary, untampered chain still delivers -- every field
    the pre-B1-video manifest shape carried is still present and still correct."""
    primary_root, video_root, kwargs = _drive_through_video_ruled(command, in_repo_run_root, monkeypatch)
    assembly = load_json(video_root / "video" / "assembled" / "frame-assembly.json")
    reel = load_json(video_root / "video" / "reel" / "reel-derivative.json")

    manifest = _build_video_deliverable(command, primary_root, video_root)
    delivered = manifest["video"]
    reel_path = primary_root / delivered["reel"]["path"]
    assert reel_path.is_file()
    assert command._sha256(reel_path) == reel["correspondence"]["derivative"]["sha256"]
    assert delivered["native_movie"] == assembly["movie"]
    assert delivered["identity_under_motion"]
    for row in delivered["identity_under_motion"]:
        assert row["gate"]["pass"] is True or row["ruling"]["gate_override"]
        assert row["ruling"]["decided_by"] == "operator-fixture"
        assert command._sha256(ROOT / row["native_frame"]["path"]) == row["native_frame"]["sha256"]

    # Idempotent: a second build against the same ruled state returns the same bytes.
    again = _build_video_deliverable(command, primary_root, video_root)
    assert again == manifest


def test_deliverable_video_removes_an_orphaned_previous_mp4(command, in_repo_run_root, monkeypatch):
    """MINOR 7: an earlier ruling's delivered mp4 that the current manifest no longer
    references must not linger in deliverable/video/."""
    primary_root, video_root, kwargs = _drive_through_video_ruled(command, in_repo_run_root, monkeypatch)
    destination_dir = primary_root / "deliverable" / "video"
    destination_dir.mkdir(parents=True, exist_ok=True)
    orphan = destination_dir / "some-old-candidate-id.mp4"
    orphan.write_bytes(b"orphaned mp4 from a previous ruling")

    manifest = _build_video_deliverable(command, primary_root, video_root)
    assert not orphan.exists()
    assert {path.name for path in destination_dir.iterdir()} == {
        Path(manifest["video"]["reel"]["path"]).name,
    }


def test_video_plan_refuses_an_out_of_tree_output_directory(command, tmp_path):
    with pytest.raises(command.FigmentTrainError, match="inside the run-root authority root"):
        command.build_plan("creator-002", "video", tmp_path / "out", skip_pin_verify=True)


def test_video_plan_refuses_an_in_repo_non_run_root_output_directory(command):
    """MINOR 3 (REVIEW): `_video_authority_root` used to accept anything under `ROOT`,
    so an in-repo-but-not-`orgs/figment/runs/` path (e.g. `orgs/figment/personas/x`) was
    wrongly accepted as a video run root. It must refuse the same way an out-of-repo
    path does, naming the run-root rule rather than the whole-repository rule."""
    with pytest.raises(command.FigmentTrainError, match="inside the run-root authority root"):
        command.build_plan(
            "creator-002", "video", command.PERSONAS_ROOT / "x", skip_pin_verify=True,
        )


def test_video_launch_refuses_when_the_approved_gen_still_changed_after_video_planning(
    command, in_repo_run_root, monkeypatch,
):
    """M2: video's first frame is one specific approved gen still, captured once at
    plan time as `plan["video_source"]` (`_plan_video_manifest`). `_install_stage_config`'s
    `video` branch (`_validate_video_source_inputs`) must re-verify it through
    `validate_approved_gen_still` at the launch boundary -- the same "changed after
    planning" refusal class gen's own checkpoint upload and detail's gen-source images
    already get -- and refuse before the harness ever launches."""
    gen_stage_test = load_module(
        "figment_pipeline_test_gen_stage_for_video_source", PIPELINE / "tests" / "test_gen_stage.py",
    )
    personas = in_repo_run_root / "ps"
    ledger_dir = in_repo_run_root / "lg"
    gen_stage_test._promoted_persona(personas, creator_id="creator-002", steps=3000)
    # `_prepare_accepted_checkpoint` always accepts its own budget (see its own
    # docstring/comment) regardless of which ledger `build_plan` falls back to.
    gen_stage_test._prepare_accepted_checkpoint(command, personas, in_repo_run_root / "src")

    gen_out = in_repo_run_root / "g"
    gen_plan = command.build_plan(
        "creator-002", "gen", gen_out, personas_root=personas, skip_pin_verify=True,
        ledger_dir=ledger_dir,
    )
    _fake_stage_outputs(gen_out, gen_plan, "gen")
    gen_stage_test._approve_all_gen_images(command, "creator-002", gen_out)

    video_root = in_repo_run_root / "v"
    command.build_plan(
        "creator-002", "video", video_root, personas_root=personas, skip_pin_verify=True,
        approved_gen_plan=gen_out, ledger_dir=ledger_dir,
    )
    video_plan_path = video_root / "plan.json"
    source = load_json(video_plan_path)["video_source"]
    still_path = Path(command.validate_approved_gen_still(
        "creator-002", gen_out / "plan.json", source["image_id"],
    )["path"])

    # Mutating the real still's bytes on disk also trips a different, pre-existing
    # refusal first (`validate_approved_gen_still`'s own "gen operator approval is
    # stale" check, since the approval's subject hash covers the whole kept-image
    # batch) -- real defense-in-depth, but it does not isolate THIS check.
    # `_validate_video_source_inputs`'s own comparison is the narrower guarantee that
    # the plan's OWN recorded digest for this exact frame still matches what
    # `validate_approved_gen_still` re-verifies as current, even when that re-
    # verification otherwise succeeds -- so mutate the plan's recorded digest instead,
    # leaving the real approved still and its approval chain untouched and current.
    original_plan_bytes = video_plan_path.read_bytes()
    try:
        plan_document = json.loads(original_plan_bytes)
        plan_document["video_source"]["sha256"] = "0" * 64
        video_plan_path.write_text(json.dumps(plan_document), encoding="utf-8")
        launched: list = []
        monkeypatch.setattr(
            command.subprocess, "run",
            lambda argv, cwd=None: launched.append(argv),
        )
        with pytest.raises(
            command.FigmentTrainError,
            match="video source frame .* changed after video planning",
        ):
            command.run_planned_stage("creator-002", "video", video_plan_path)
        assert launched == []
    finally:
        video_plan_path.write_bytes(original_plan_bytes)


def test_pipeline_reaching_video_with_accept_budget_records_acceptance_in_the_video_plan(
    command, in_repo_run_root, monkeypatch,
):
    """M1: `command_pipeline`'s own video `build_plan` call used to drop the caller's
    `accept_budget` on the floor (every OTHER downstream stage -- gen, detail --
    forwarded it). Prove it reaches the video plan by seeding a near-cap synthetic
    ledger that would refuse video's own ceiling without `--accept-budget`, then
    driving `pipeline` through to `GATE video` WITH it, and reading the acceptance
    back off the written video `plan.json`."""
    personas = in_repo_run_root / "ps"
    _promoted_persona(personas, creator_id="creator-002")
    ledger_dir = in_repo_run_root / "lg"
    _install_fake_harness(command, monkeypatch, ledger_dir)
    primary_root = in_repo_run_root / "p"
    kwargs = dict(
        personas_root=personas, skip_pin_verify=True, skip_judge=True, ledger_dir=ledger_dir,
    )
    _drive_through_detail(command, "creator-002", primary_root, kwargs)
    # A second, disposable primary/video root to independently confirm this same
    # near-cap ledger really would refuse a single-stage video plan without
    # --accept-budget: a refused build_plan call stages partial files into `out`
    # before it raises, so this probe must not share a directory with the real
    # accept_budget=True call below. Driven through detail now, BEFORE the ledger
    # is seeded near-cap, so its own dataset/tester/gen/detail planning (none of
    # which pass --accept-budget) is unaffected by it.
    probe_root = in_repo_run_root / "probe"
    _drive_through_detail(command, "creator-002", probe_root, kwargs)

    # Seed the arc ledger so only a sliver remains -- video's own ceiling alone must
    # exceed it, so reaching GATE video at all proves --accept-budget was honoured.
    arc_cap = float(command.ARC_CAP_USD)
    already_spent = sum(
        float(row.split("\t")[2])
        for path in ledger_dir.glob("figment-*.tsv")
        for row in path.read_text(encoding="utf-8").splitlines()[1:] if row
    )
    (ledger_dir / "figment-2026-01-01-seed.tsv").write_text(
        f"model\tstep\tusd\nl40s\tpod-create seed\t{arc_cap - already_spent - 0.01:.6f}\n",
        encoding="utf-8",
    )

    with pytest.raises(command.FigmentTrainError, match="budget preflight refused"):
        command.command_pipeline(
            "creator-002", plan_path=probe_root / "plan.json", **kwargs,
        )

    primary_plan_path = primary_root / "plan.json"
    result = command.command_pipeline(
        "creator-002", plan_path=primary_plan_path, accept_budget=True, **kwargs,
    )
    assert result["status"] == "GATE video"
    video_root = primary_root / "downstream" / "video"
    video_preflight = load_json(video_root / "plan.json")["budget_preflight"]
    assert video_preflight["accepted"] is True
    assert video_preflight["over_arc"] is True


def test_pipeline_halts_and_resumes_at_anchor_then_requires_a_fresh_plan(
    command, tmp_path, monkeypatch,
):
    personas = tmp_path / "personas"
    _synthetic_persona(personas, creator_id="creator-002")
    ledger_dir = tmp_path / "ledger"
    calls = _install_fake_harness(command, monkeypatch, ledger_dir)
    kwargs = dict(
        personas_root=personas, skip_pin_verify=True, skip_judge=True,
        ledger_dir=ledger_dir,
    )

    primary_root = tmp_path / "primary"
    result = command.command_pipeline("creator-002", out=primary_root, **kwargs)
    assert result["status"] == "GATE anchor"
    assert len(calls) == 2  # passport + edit arms

    plan_path = primary_root / "plan.json"
    grade_dir = primary_root / "grade" / "anchor"
    template = load_json(grade_dir / "rulings.template.json")
    for row in template["rulings"]:
        row.update(_axes(), decision="cull")
    template["rulings"][0].update(_axes(), decision="keep")
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-15T00:00:00Z"})
    filled = grade_dir / "filled.json"
    filled.write_text(json.dumps(template), encoding="utf-8")
    command.apply_rulings("creator-002", "anchor", plan_path, filled)

    result = command.command_pipeline("creator-002", plan_path=plan_path, **kwargs)
    assert result["status"] == "stopped:anchor-promoted"
    assert "--out <new-dir>" in result["message"]
    # The stale plan is never replanned or re-run in place.
    assert len(calls) == 2


def _build_approved_gen_and_detail(command, tmp_path):
    """Build a real gen -> detail approval chain (not the full pipeline harness) --
    the minimal fixture B1's deliverable tests need. Reuses `test_gen_stage.py`'s own
    helpers exactly the way `test_figment_train.py` already does."""
    gen_stage_test = load_module(
        "figment_pipeline_test_gen_stage_for_deliverable", PIPELINE / "tests" / "test_gen_stage.py",
    )
    personas = tmp_path / "personas"
    gen_stage_test._promoted_persona(personas, creator_id="creator-002", steps=3000)
    gen_stage_test._prepare_accepted_checkpoint(command, personas, tmp_path)

    gen_out = tmp_path / "g"
    gen_plan = command.build_plan(
        "creator-002", "gen", gen_out, personas_root=personas, skip_pin_verify=True,
    )
    _fake_stage_outputs(gen_out, gen_plan, "gen")
    gen_stage_test._approve_all_gen_images(command, "creator-002", gen_out)

    detail_out = tmp_path / "d"
    command.build_plan(
        "creator-002", "detail", detail_out, personas_root=personas, skip_pin_verify=True,
        approved_gen_plan=gen_out,
    )
    _fake_stage_outputs(detail_out, load_json(detail_out / "plan.json"), "detail")
    detail_grade = command.build_grade(
        "creator-002", "detail", detail_out / "plan.json", skip_judge=True,
    )
    template = load_json(Path(detail_grade["rulings_template"]))
    for row in template["rulings"]:
        row.update(_axes(), decision="keep")
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-15T00:05:00Z"})
    filled = detail_out / "detail-filled.json"
    filled.write_text(json.dumps(template), encoding="utf-8")
    command.apply_rulings("creator-002", "detail", detail_out / "plan.json", filled)
    return gen_out, detail_out


def test_deliverable_refuses_a_crafted_approved_list_row(command, tmp_path):
    """B1 reproduction: a hand-edited `grade/gen/approved-list.json` naming an
    out-of-root, gate-failed, never-ruled PNG must never reach `deliverable/` --
    every row is re-verified through `validate_approved_gen_still` before its bytes
    are copied."""
    gen_out, detail_out = _build_approved_gen_and_detail(command, tmp_path)

    evil_dir = tmp_path / "outside-plan-root"
    evil_dir.mkdir()
    evil_image = evil_dir / "evil.png"
    Image.new("RGB", (8, 8)).save(evil_image)

    approved_path = gen_out / "grade" / "gen" / "approved-list.json"
    approved = load_json(approved_path)
    approved["images"].append({"image_id": "evil-1", "path": str(evil_image)})
    approved_path.write_text(json.dumps(approved), encoding="utf-8")

    primary_root = tmp_path
    video_root = command._pipeline_downstream_root(primary_root, "video")
    with pytest.raises(command.FigmentTrainError, match="approved gen list is not the current kept review set"):
        command._build_deliverable("creator-002", primary_root, gen_out, detail_out, video_root)

    assert not (primary_root / "deliverable").exists()


def test_deliverable_happy_path_binds_manifest_to_validated_bytes(command, tmp_path):
    gen_out, detail_out = _build_approved_gen_and_detail(command, tmp_path)
    primary_root = tmp_path
    video_root = command._pipeline_downstream_root(primary_root, "video")

    manifest = command._build_deliverable("creator-002", primary_root, gen_out, detail_out, video_root)
    assert manifest["schema"] == "figment/deliverable@1"
    gen_kept = load_json(gen_out / "grade" / "gen" / "approved-list.json")["images"]
    detail_kept = load_json(detail_out / "grade" / "detail" / "approved-list.json")["images"]
    assert len(manifest["stills"]) == len(gen_kept)
    assert len(manifest["detail"]) == len(detail_kept)
    for row in manifest["stills"]:
        destination = primary_root / row["path"]
        assert destination.is_file()
        assert command._sha256(destination) == row["sha256"]

    # m6: a re-ruling (same kept image, tampered destination bytes) is re-copied
    # rather than left stale -- delete the cached manifest to force a rebuild.
    (primary_root / "deliverable" / "manifest.json").unlink()
    stale_still = primary_root / manifest["stills"][0]["path"]
    stale_still.write_bytes(b"stale bytes that do not match the validated source")
    rebuilt = command._build_deliverable("creator-002", primary_root, gen_out, detail_out, video_root)
    assert command._sha256(stale_still) == rebuilt["stills"][0]["sha256"]
    assert stale_still.read_bytes() != b"stale bytes that do not match the validated source"


def test_pipeline_from_stage_video_resumes_without_jumping_to_the_deliverable_f6a(
    command, in_repo_run_root, monkeypatch,
):
    """F6a supersedes m5: now that `video` is a real, implemented stage, `--from-stage
    video` is a normal resume point like every other stage -- m5's exclusion applied
    only while no such stage existed. It still never jumps straight to a video
    deliverable entry: that stays absent until video's own GATE is ruled (B1/F6a), the
    same rule `_build_deliverable` already enforces for `detail`."""
    personas = in_repo_run_root / "ps"
    _promoted_persona(personas, creator_id="creator-002")
    ledger_dir = in_repo_run_root / "lg"
    _install_fake_harness(command, monkeypatch, ledger_dir)
    primary_root = in_repo_run_root / "p"
    primary_plan_path = primary_root / "plan.json"
    kwargs = dict(
        personas_root=personas, skip_pin_verify=True, skip_judge=True, ledger_dir=ledger_dir,
    )
    _drive_through_detail(command, "creator-002", primary_root, kwargs)

    assert "video" in command.PIPELINE_FROM_STAGES
    assert set(command.PIPELINE_FROM_STAGES) == set(command.STAGES)

    result = command.command_pipeline(
        "creator-002", plan_path=primary_plan_path, from_stage="video", **kwargs,
    )
    assert result["status"] == "GATE video"
    deliverable = load_json(Path(result["deliverable"]))
    assert "video" not in deliverable


def test_pipeline_cli_parser_has_no_max_usd_flag_m7(command):
    """m7: the unused `pipeline --max-usd` flag is deleted -- it was never consumed by
    any dispatched stage command; ceilings are derived per-manifest at plan time."""
    parser = command.build_parser()
    pipeline_parser = next(
        action.choices["pipeline"]
        for action in parser._subparsers._group_actions
        if "pipeline" in getattr(action, "choices", {})
    )
    option_strings = {
        option for action in pipeline_parser._actions for option in action.option_strings
    }
    assert "--max-usd" not in option_strings
    with pytest.raises(TypeError, match="max_usd"):
        command.command_pipeline("creator-002", plan_path="plan.json", max_usd="1.00")


def test_pipeline_requires_exactly_one_of_plan_or_out(command, tmp_path):
    with pytest.raises(command.FigmentTrainError, match="exactly one of --plan or --out"):
        command.command_pipeline("creator-002")
    with pytest.raises(command.FigmentTrainError, match="exactly one of --plan or --out"):
        command.command_pipeline(
            "creator-002", plan_path=tmp_path / "plan.json", out=tmp_path / "out",
        )


def test_pipeline_dry_run_never_calls_the_harness_or_writes_grade_state(
    command, tmp_path, monkeypatch,
):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002")

    def _forbidden(argv, cwd=None):
        pytest.fail("dry-run pipeline must never invoke the harness")

    monkeypatch.setattr(command.subprocess, "run", _forbidden)
    primary_root = tmp_path / "primary"
    result = command.command_pipeline(
        "creator-002", out=primary_root, personas_root=personas, skip_pin_verify=True,
        dry_run=True,
    )
    assert result["status"] == "dry-run:plan"
    assert not primary_root.exists()
