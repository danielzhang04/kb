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
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"


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

    def fake_harness(argv, cwd=None):
        manifest_path = Path(argv[argv.index("--manifest") + 1])
        run_out = Path(argv[argv.index("--out") + 1])
        manifest = load_json(manifest_path)
        calls.append(manifest_path.name)
        run_out.mkdir(parents=True, exist_ok=True)
        pod_id = f"pod-{len(calls)}"
        receipt = {
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
            for job in manifest["jobs"]:
                expected = job.get("expected_images", 1)
                if expected == 1:
                    Image.new("RGB", (8, 8)).save(run_out / f"{job['output_name']}.png")
                else:
                    for index in range(1, expected + 1):
                        Image.new("RGB", (8, 8)).save(
                            run_out / f"{job['output_name']}_{index:02d}.png",
                        )
            receipt["jobs"] = [{
                "output_name": job["output_name"],
                "files": [{"bytes": 10} for _ in range(job.get("expected_images", 1))],
            } for job in manifest["jobs"]]
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

    # ---- resume: detail ruled -> pipeline honestly stops before the unbuilt video stage,
    # but DOES write the deliverable for everything ruled through detail ----
    result = command.command_pipeline("creator-002", plan_path=primary_plan_path, **kwargs)
    assert result["status"] == "stopped:video-not-automated"
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
    with pytest.raises(command.FigmentTrainError, match="approved gen list is not the current kept review set"):
        command._build_deliverable("creator-002", primary_root, gen_out, detail_out)

    assert not (primary_root / "deliverable").exists()


def test_deliverable_happy_path_binds_manifest_to_validated_bytes(command, tmp_path):
    gen_out, detail_out = _build_approved_gen_and_detail(command, tmp_path)
    primary_root = tmp_path

    manifest = command._build_deliverable("creator-002", primary_root, gen_out, detail_out)
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
    rebuilt = command._build_deliverable("creator-002", primary_root, gen_out, detail_out)
    assert command._sha256(stale_still) == rebuilt["stills"][0]["sha256"]
    assert stale_still.read_bytes() != b"stale bytes that do not match the validated source"


def test_pipeline_from_stage_video_is_refused_m5(command, tmp_path):
    """m5: `--from-stage` may only name a stage `pipeline` actually runs itself
    (anchor..detail) -- "video" is a STAGES entry purely so the driver's own loop
    recognizes it as the honest not-yet-automated stop, never a real resume point."""
    with pytest.raises(command.FigmentTrainError, match=r"--from-stage must be one of"):
        command.command_pipeline(
            "creator-002", plan_path=tmp_path / "plan.json", from_stage="video",
        )
    assert "video" not in command.PIPELINE_FROM_STAGES
    assert set(command.PIPELINE_FROM_STAGES) == set(command.STAGES) - {"video"}


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
