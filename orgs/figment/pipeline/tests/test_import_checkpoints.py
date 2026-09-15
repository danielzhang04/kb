"""Contract tests for the imported checkpoint ladder path (operator-trained LoRA,
MANDATE.md's tier constraint): `plan --stage tester --import-checkpoints <dir>` screens
loose, operator-trained `*.safetensors` files instead of an in-plan `train` stage's own
artifacts.

Shared helpers (`_synthetic_persona`, `_set_training`, `_axes`, `load_json`) come from
`test_anchor_stage.py`; `_install_fake_harness` comes from `test_pipeline_command.py` --
both loaded via importlib, the same no-`__init__.py` convention the rest of this test
tree uses.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

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
    return load_module("figment_train_test_module_import_checkpoints", PIPELINE / "figment_train.py")


anchor_stage_test = load_module(
    "figment_import_checkpoints_test_anchor_stage", PIPELINE / "tests" / "test_anchor_stage.py",
)
_synthetic_persona = anchor_stage_test._synthetic_persona
_set_training = anchor_stage_test._set_training
_axes = anchor_stage_test._axes
load_json = anchor_stage_test.load_json

pipeline_command_test = load_module(
    "figment_import_checkpoints_test_pipeline_command", PIPELINE / "tests" / "test_pipeline_command.py",
)
_install_fake_harness = pipeline_command_test._install_fake_harness

TRIGGER = "creator003krea2"
STEPS = 1250
SAVE_EVERY = 250
LADDER_STEPS = [250, 500, 750, 1000, 1250]


def _write_checkpoint(path: Path, *, size: int) -> None:
    header = f"synthetic operator-trained checkpoint bytes for {path.name}\n".encode("utf-8")
    body = (header * (size // len(header) + 1))[:size]
    path.write_bytes(body)


def _write_ladder(
    directory: Path, command, *, trigger: str = TRIGGER, steps: list = None,
    final_step: int = STEPS,
) -> None:
    steps = LADDER_STEPS if steps is None else steps
    directory.mkdir(parents=True, exist_ok=True)
    for step in steps:
        name = command._checkpoint_name(trigger, None if step == final_step else step)
        _write_checkpoint(directory / name, size=command.IMPORTED_CHECKPOINT_MIN_BYTES)


def _persona(personas_root: Path, *, creator_id: str = "creator-003") -> Path:
    persona_dir = personas_root / creator_id
    _synthetic_persona(personas_root, creator_id=creator_id, steps=STEPS)
    _set_training(persona_dir, save_every=SAVE_EVERY)
    return persona_dir


# ---------------------------------------------------------------------------
# Discovery / validation unit tests
# ---------------------------------------------------------------------------


def test_discover_imported_checkpoints_happy_path(command, tmp_path):
    ladder_dir = tmp_path / "ladder"
    _write_ladder(ladder_dir, command)
    rows = command._discover_imported_checkpoints(ladder_dir, TRIGGER, STEPS)
    assert [row["step"] for row in rows] == LADDER_STEPS
    assert rows[-1]["filename"] == f"{TRIGGER}.safetensors"
    assert rows[0]["filename"] == f"{TRIGGER}_{250:09d}.safetensors"
    for row in rows:
        source = Path(row["source_path"])
        assert source.is_file()
        assert row["bytes"] == source.stat().st_size
        assert row["sha256"] == command._sha256(source)


def test_discover_imported_checkpoints_refuses_non_safetensors_file(command, tmp_path):
    ladder_dir = tmp_path / "ladder"
    _write_ladder(ladder_dir, command)
    (ladder_dir / "notes.txt").write_text("stray file\n", encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="non-safetensors"):
        command._discover_imported_checkpoints(ladder_dir, TRIGGER, STEPS)


def test_discover_imported_checkpoints_refuses_symlink(command, tmp_path):
    ladder_dir = tmp_path / "ladder"
    _write_ladder(ladder_dir, command)
    real = ladder_dir / f"{TRIGGER}_{250:09d}.safetensors"
    linked = ladder_dir / f"{TRIGGER}_{999999999:09d}.safetensors"
    try:
        linked.symlink_to(real)
    except OSError:
        pytest.skip("symlink creation is not permitted in this environment")
    with pytest.raises(command.FigmentTrainError, match="symlink or reparse point"):
        command._discover_imported_checkpoints(ladder_dir, TRIGGER, STEPS)


def test_discover_imported_checkpoints_refuses_undersized_file(command, tmp_path):
    ladder_dir = tmp_path / "ladder"
    _write_ladder(ladder_dir, command)
    tiny = ladder_dir / f"{TRIGGER}_{2000:09d}.safetensors"
    tiny.write_bytes(b"too small")
    with pytest.raises(command.FigmentTrainError, match="1 MiB minimum"):
        command._discover_imported_checkpoints(ladder_dir, TRIGGER, STEPS)


def test_discover_imported_checkpoints_refuses_stem_mismatch(command, tmp_path):
    ladder_dir = tmp_path / "ladder"
    _write_ladder(ladder_dir, command)
    mismatched = ladder_dir / "someothertrigger_000000250.safetensors"
    _write_checkpoint(mismatched, size=command.IMPORTED_CHECKPOINT_MIN_BYTES)
    with pytest.raises(command.FigmentTrainError, match="does not match the persona checkpoint stem"):
        command._discover_imported_checkpoints(ladder_dir, TRIGGER, STEPS)


def test_discover_imported_checkpoints_refuses_duplicate_step(command, tmp_path):
    ladder_dir = tmp_path / "ladder"
    ladder_dir.mkdir()
    # The final (un-suffixed) file and an explicit 9-digit-step file both resolve to
    # the same step number (1250) -- a duplicate ladder entry, not two candidates.
    _write_checkpoint(ladder_dir / f"{TRIGGER}.safetensors", size=command.IMPORTED_CHECKPOINT_MIN_BYTES)
    _write_checkpoint(
        ladder_dir / f"{TRIGGER}_{STEPS:09d}.safetensors", size=command.IMPORTED_CHECKPOINT_MIN_BYTES,
    )
    with pytest.raises(command.FigmentTrainError, match="duplicate step"):
        command._discover_imported_checkpoints(ladder_dir, TRIGGER, STEPS)


def test_discover_imported_checkpoints_refuses_empty_dir(command, tmp_path):
    ladder_dir = tmp_path / "ladder"
    ladder_dir.mkdir()
    with pytest.raises(command.FigmentTrainError, match="no matching checkpoints"):
        command._discover_imported_checkpoints(ladder_dir, TRIGGER, STEPS)


def test_discover_imported_checkpoints_refuses_missing_directory(command, tmp_path):
    with pytest.raises(command.FigmentTrainError, match="does not exist"):
        command._discover_imported_checkpoints(tmp_path / "nope", TRIGGER, STEPS)


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------


def test_plan_import_checkpoints_only_plans_tester(command, tmp_path):
    personas = tmp_path / "personas"
    _persona(personas)
    ladder_dir = tmp_path / "ladder"
    _write_ladder(ladder_dir, command)
    out = tmp_path / "plan"
    ledger_dir = tmp_path / "ledger"

    plan = command.build_plan(
        "creator-003", "tester", out, personas_root=personas, skip_pin_verify=True,
        import_checkpoints=ladder_dir, ledger_dir=ledger_dir, accept_budget=True,
    )
    assert set(plan["stages"]) == {"tester"}
    imported = plan["stages"]["tester"]["imported_checkpoints"]
    assert [row["step"] for row in imported] == LADDER_STEPS
    for row in imported:
        staged = out / "train" / "runs" / "_uploads" / "creator-003" / row["filename"]
        assert staged.is_file()
        assert command._sha256(staged) == row["sha256"]
    assert plan["imported_training_config"]["sha256"] == command._sha256(
        personas / "creator-003" / "training.yaml"
        if (personas / "creator-003" / "training.yaml").is_file()
        else personas / "creator-003" / "persona.yaml"
    )

    tester_manifest = load_json(out / plan["stages"]["tester"]["runs"][0]["manifest"])
    assert tester_manifest["uploads"][0]["files"] == ["_uploads/creator-003/*.safetensors"]
    substituted = sorted(
        item["value"]
        for job in tester_manifest["jobs"]
        for item in job["substitutions"]
        if item["field"] == "lora_name"
    )
    expected = sorted(command._checkpoint_name(TRIGGER, None if s == STEPS else s) for s in LADDER_STEPS)
    assert substituted == expected


def test_plan_import_checkpoints_requires_stage_tester(command, tmp_path):
    personas = tmp_path / "personas"
    _persona(personas)
    ladder_dir = tmp_path / "ladder"
    _write_ladder(ladder_dir, command)
    with pytest.raises(command.FigmentTrainError, match="only meaningful for --stage tester"):
        command.build_plan(
            "creator-003", "gen", tmp_path / "plan", personas_root=personas,
            skip_pin_verify=True, import_checkpoints=ladder_dir,
        )


def test_plan_import_training_config_requires_import_checkpoints(command, tmp_path):
    personas = tmp_path / "personas"
    persona_dir = _persona(personas)
    with pytest.raises(command.FigmentTrainError, match="only meaningful together with --import-checkpoints"):
        command.build_plan(
            "creator-003", "tester", tmp_path / "plan", personas_root=personas,
            skip_pin_verify=True, import_training_config=persona_dir / "training.yaml",
        )


# ---------------------------------------------------------------------------
# End to end: tester screens the ladder, a ruling promotes one step, gen consumes it
# ---------------------------------------------------------------------------


def _fill_tester_ruling(command, load_json, grade_dir: Path, keep_output_name: str) -> Path:
    template = load_json(grade_dir / "rulings.template.json")
    for row in template["rulings"]:
        keep = row["image_id"] == keep_output_name
        row.update(_axes(), decision="keep" if keep else "cull")
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-15T00:10:00Z"})
    filled = grade_dir / "filled.json"
    filled.write_text(json.dumps(template), encoding="utf-8")
    return filled


def test_import_checkpoints_screens_ladder_to_accepted_gen_checkpoint(command, tmp_path, monkeypatch):
    personas = tmp_path / "personas"
    _persona(personas)
    ladder_dir = tmp_path / "ladder"
    _write_ladder(ladder_dir, command)
    out = tmp_path / "plan"
    ledger_dir = tmp_path / "ledger"
    calls = _install_fake_harness(command, monkeypatch, ledger_dir)

    plan = command.build_plan(
        "creator-003", "tester", out, personas_root=personas, skip_pin_verify=True,
        import_checkpoints=ladder_dir, ledger_dir=ledger_dir, accept_budget=True,
    )
    plan_path = out / "plan.json"

    command.run_planned_stage("creator-003", "tester", plan_path)
    assert calls == ["creator-003-tensor-tester.yaml"]

    command.build_grade("creator-003", "tester", plan_path, skip_judge=True)

    chosen_step = 750
    tester_manifest = load_json(out / plan["stages"]["tester"]["runs"][0]["manifest"])
    chosen_filename = command._checkpoint_name(TRIGGER, chosen_step)
    candidate_job = next(
        job for job in tester_manifest["jobs"]
        if any(item.get("field") == "lora_name" and item.get("value") == chosen_filename
               for item in job.get("substitutions", []))
    )
    grade_dir = out / "grade" / "tester"
    filled = _fill_tester_ruling(command, load_json, grade_dir, candidate_job["output_name"])
    result = command.apply_rulings(
        "creator-003", "tester", plan_path, filled, checkpoint_step=chosen_step,
    )
    accepted = load_json(Path(result["accepted_checkpoint"]))
    assert accepted["origin"] == "imported"
    assert accepted["checkpoint"]["step"] == chosen_step
    assert accepted["checkpoint"]["filename"] == chosen_filename
    assert accepted["checkpoint"]["train_manifest"] is None
    imported_row = next(row for row in plan["stages"]["tester"]["imported_checkpoints"] if row["step"] == chosen_step)
    assert accepted["checkpoint"]["sha256"] == imported_row["sha256"]

    gen_out = tmp_path / "gen"
    gen_plan = command.build_plan(
        "creator-003", "gen", gen_out, personas_root=personas, skip_pin_verify=True,
        ledger_dir=ledger_dir, accept_budget=True,
    )
    gen_manifest = load_json(gen_out / gen_plan["stages"]["gen"]["runs"][0]["manifest"])
    assert gen_manifest["uploads"][0]["files"] == [f"accepted-checkpoint/{chosen_filename}"]
    staged_gen_checkpoint = gen_out / "train" / "runs" / "accepted-checkpoint" / chosen_filename
    assert staged_gen_checkpoint.is_file()
    assert command._sha256(staged_gen_checkpoint) == imported_row["sha256"]


def test_import_checkpoints_refuses_tampered_staged_file_before_launch(command, tmp_path, monkeypatch):
    personas = tmp_path / "personas"
    _persona(personas)
    ladder_dir = tmp_path / "ladder"
    _write_ladder(ladder_dir, command)
    out = tmp_path / "plan"
    ledger_dir = tmp_path / "ledger"
    _install_fake_harness(command, monkeypatch, ledger_dir)

    command.build_plan(
        "creator-003", "tester", out, personas_root=personas, skip_pin_verify=True,
        import_checkpoints=ladder_dir, ledger_dir=ledger_dir, accept_budget=True,
    )
    plan_path = out / "plan.json"
    staged = out / "train" / "runs" / "_uploads" / "creator-003" / command._checkpoint_name(TRIGGER, 250)
    original = staged.read_bytes()
    staged.write_bytes(original[:-1] + (b"\x00" if original[-1:] != b"\x00" else b"\x01"))

    with pytest.raises(command.FigmentTrainError, match="changed after planning"):
        command.run_planned_stage("creator-003", "tester", plan_path)
