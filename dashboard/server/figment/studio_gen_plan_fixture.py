"""Test-only fixture invoked by studioGenPlan.integration.test.ts.

Stands in for the real `figment_train.py plan --creator creator-001 --stage
gen --out <dir> --ledger-dir <dir>` CLI invocation the HTTP route makes, using
the real pipeline planner (`build_plan` / `build_grade` / `apply_rulings`) and
real test-support helpers to build one genuine accepted-checkpoint chain for
creator-001, then calls `build_plan` directly on the caller-supplied `--out`
directory -- no separate build location, no copy step. Never invokes a
provider or the training/tester/gen harness: those stages are staged as
fixture receipts, exactly as pipeline/tests/test_gen_stage.py does for its
synthetic creator-002 double.

`pipeline/tests/test_gen_stage.py::_prepare_accepted_checkpoint` cannot be
reused directly: it is hardcoded to creator-002 throughout (persona
directory, plan creator id, checkpoint filename convention) and that file is
frozen/shared. This reimplements only the orchestration for creator-001,
still calling the same real production functions, and derives the
checkpoint filename from the actual train manifest instead of assuming a
hardcoded name.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"
CREATOR = "creator-001"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _prepare_creator001_accepted_checkpoint(command, anchor, personas: Path, out_root: Path) -> None:
    persona_dir = personas / CREATOR
    anchor._set_training(
        persona_dir, chosen_checkpoint_step=None, chosen_checkpoint_sha256=None,
        chosen_checkpoint_approval=None, save_every=250,
    )
    source = out_root / "source-lineage"
    plan = command.build_plan(CREATOR, "all", source, personas_root=personas, skip_pin_verify=True)

    train_run = plan["stages"]["train"]["runs"][0]
    train_manifest = anchor.load_json(source / train_run["manifest"])
    step = 1500
    suffix = f"_{step:09d}.safetensors"
    artifact = next(item for item in train_manifest["artifacts"] if item["local"].endswith(suffix))
    filename = artifact["local"]
    train_out = source / train_run["out"]
    train_out.mkdir(parents=True, exist_ok=True)
    receipt_artifacts = []
    for index, item in enumerate(train_manifest["artifacts"]):
        artifact_path = train_out / item["local"]
        artifact_path.write_bytes(f"fixture checkpoint bytes {index:02d}".encode("utf-8"))
        receipt_artifacts.append({"remote": item["remote"], "bytes": artifact_path.stat().st_size})
    (train_out / "run.json").write_text(json.dumps({
        "error": None, "dry_run": False, "termination_verified": True,
        "artifacts": receipt_artifacts,
    }), encoding="utf-8")

    tester_run = plan["stages"]["tester"]["runs"][0]
    tester_manifest = anchor.load_json(source / tester_run["manifest"])
    candidate_job = next(
        job for job in tester_manifest["jobs"]
        if any(item.get("field") == "lora_name" and item.get("value") == filename
               for item in job.get("substitutions", []))
    )
    anchor._fake_stage_outputs(source, plan, "tester")
    tester_out = source / tester_run["out"]
    (tester_out / "run.json").write_text(json.dumps({
        "error": None, "dry_run": False, "termination_verified": True,
        "jobs": [{
            "output_name": job["output_name"],
            "files": [{"bytes": 10} for _ in range(job.get("expected_images", 1))],
        } for job in tester_manifest["jobs"]],
    }), encoding="utf-8")

    checkpoint_inputs = command._tester_checkpoint_inputs(plan, source, tester_run)
    (source / "stage.json").write_text(json.dumps({
        "schema": "figment/train-stage@1",
        "creator": CREATOR,
        "plan_sha256": command._sha256(source / "plan.json"),
        "status": "complete:tester",
        "runs": {
            train_run["manifest"]: {"status": "complete"},
            tester_run["manifest"]: {"status": "complete", "checkpoint_inputs": checkpoint_inputs},
        },
        "completed_stages": ["train", "tester"],
    }), encoding="utf-8")

    grade = command.build_grade(CREATOR, "tester", source / "plan.json", skip_judge=True)
    template = anchor.load_json(Path(grade["rulings_template"]))
    for job in template["rulings"]:
        keep = job["image_id"] == candidate_job["output_name"]
        job.update(anchor._axes(), decision="keep" if keep else "cull")
        if keep:
            job["gate_override"] = "fixture: no real face in this synthetic 8x8 image"
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-08T00:00:00Z"})
    rulings = source / "tester-rulings.json"
    rulings.write_text(json.dumps(template), encoding="utf-8")

    command.apply_rulings(CREATOR, "tester", source / "plan.json", rulings, checkpoint_step=step)
    assert (source / "grade" / "tester" / "accepted-checkpoint.json").is_file()


def _cmd_plan(args: argparse.Namespace) -> None:
    out_dir = Path(args.out)
    # The real planner requires its allocated output directory to remain empty.
    # Keep synthetic upstream evidence outside gen-plans, like real source
    # checkpoint evidence, without moving any compiled output afterward.
    work_root = out_dir.parent.parent / f"fixture-source-{out_dir.name}"
    work_root.mkdir(parents=True, exist_ok=True)

    command = load_module("figment_studio_fixture_train", PIPELINE / "figment_train.py")
    anchor = load_module("figment_studio_fixture_anchor_stage", PIPELINE / "tests" / "test_anchor_stage.py")

    personas = Path(args.fixture_personas) if args.fixture_personas else work_root / "personas"
    if not args.fixture_personas:
        anchor._promoted_persona(personas, creator_id=CREATOR, steps=3000)
        _prepare_creator001_accepted_checkpoint(command, anchor, personas, work_root)

    command.build_plan(
        CREATOR, args.stage, out_dir, personas_root=personas,
        skip_pin_verify=True, ledger_dir=Path(args.ledger_dir),
    )


def _cmd_revalidate(args: argparse.Namespace) -> None:
    """Prove `run_planned_stage` re-checks selected-checkpoint authority before
    ever reaching the harness. `command.subprocess.run` is replaced with a
    recording stub that returns a nonzero sentinel, so a launch would be
    unambiguous in the output; a stale-authority plan must never reach it."""
    command = load_module("figment_studio_fixture_train_revalidate", PIPELINE / "figment_train.py")

    launched: list[list[str]] = []

    class _SentinelResult:
        returncode = 1

    def _record(argv, cwd=None):
        launched.append(list(argv))
        return _SentinelResult()

    command.subprocess.run = _record

    error: str | None = None
    try:
        command.run_planned_stage(CREATOR, "gen", Path(args.plan))
    except command.FigmentTrainError as exc:
        error = str(exc)
    print(json.dumps({"launched_count": len(launched), "error": error}))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    plan_parser = sub.add_parser("plan")
    plan_parser.add_argument("--creator", required=True, choices=[CREATOR])
    plan_parser.add_argument("--stage", required=True, choices=["gen"])
    plan_parser.add_argument("--out", required=True)
    plan_parser.add_argument("--ledger-dir", required=True)
    plan_parser.add_argument("--fixture-personas")

    revalidate_parser = sub.add_parser("revalidate")
    revalidate_parser.add_argument("--plan", required=True)

    args = parser.parse_args()
    if args.command == "plan":
        _cmd_plan(args)
    else:
        _cmd_revalidate(args)


if __name__ == "__main__":
    main()
