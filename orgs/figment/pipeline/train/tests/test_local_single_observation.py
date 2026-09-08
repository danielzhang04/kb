"""Offline coverage for the one-g01 local SDXL fit-probe planner."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tomllib
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image


TRAIN = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


planner = load("figment_local_single_observation_test", TRAIN / "local_single_observation.py")
preflight = load("figment_local_single_observation_cpu_preflight_test", TRAIN / "local_single_observation_cpu_preflight.py")
real_sd_scripts_head = planner._sd_scripts_head


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fixture_inputs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    personas = tmp_path / "personas"
    anchor = personas / "creator-001" / "anchors" / "g01.jpg"
    anchor.parent.mkdir(parents=True)
    Image.new("RGB", (1408, 768), (21, 31, 41)).save(anchor, format="JPEG")
    persona = {
        "identity": {"look": {
            "age_stage": "a woman in her early twenties, about twenty-one, an adult woman's face",
            "hair": "jet-black hair parted in the middle and falling past the shoulders",
        }},
    }
    (personas / "creator-001" / "persona.yaml").write_text(json.dumps(persona), encoding="utf-8")
    tools = tmp_path / "tools"
    script = tools / "sd-scripts" / "sdxl_train_network.py"
    script.parent.mkdir(parents=True)
    script.write_text("# offline fixture\n", encoding="utf-8")
    python = tools / "venv" / "python.exe"
    python.parent.mkdir(parents=True)
    python.write_bytes(b"fixture")
    model = tools / "RealVisXL_V5.0_fp16.safetensors"
    model.write_bytes(b"fixture model")
    monkeypatch.setattr(planner, "SDXL_SCRIPT", script)
    monkeypatch.setattr(planner, "SD_SCRIPTS_ROOT", script.parent)
    monkeypatch.setattr(planner, "VENV_PYTHON", python)
    monkeypatch.setattr(planner, "MODEL_PATH", model)
    monkeypatch.setattr(planner, "MODEL_BYTES", len(model.read_bytes()))
    monkeypatch.setattr(planner, "MODEL_SHA256", sha(model.read_bytes()))
    monkeypatch.setattr(planner, "_sd_scripts_head", lambda: planner.SD_SCRIPTS_COMMIT)
    return personas, tmp_path / "private"


def test_plans_exactly_one_original_g01_snapshot_with_fixed_ten_step_recipe(tmp_path, monkeypatch):
    personas, private = fixture_inputs(tmp_path, monkeypatch)
    plan = planner.build_plan(Path("probe"), personas_root=personas, private_root=private)
    root = private / "probe"
    staged = root / "dataset" / f"1_{planner.TRIGGER}"

    original = (personas / "creator-001" / "anchors" / "g01.jpg").read_bytes()
    assert (staged / "g01.jpg").read_bytes() == original
    assert plan["source"]["sha256"] == sha(original)
    assert plan["observation"] == {
        "count": 1, "kind": "canonical-original-pixels", "crop_training_view": None,
        "independent_views": 1,
    }
    assert plan["execution"] == {
        "cpu_preflight_allowed": True, "gpu_fit_probe_allowed": False,
        "checkpoint_acceptance_allowed": False, "sample_export_allowed": False,
    }
    assert plan["fit_probe"] == {
        "max_train_steps": 10, "samples": 0, "exports": 0,
        "reason": "availability and memory-fit probe only; not a quality evaluation",
    }
    assert "adult" in plan["caption"] and "jet-black" in plan["caption"]
    assert (staged / "g01.txt").read_text(encoding="utf-8") == plan["caption"] + "\n"
    assert plan["frozen_sha256"] == sha(planner._canonical_json(plan))
    config = tomllib.loads((root / "fit-probe.toml").read_text(encoding="utf-8"))
    assert config["max_train_steps"] == 10
    assert config["train_batch_size"] == 1
    assert config["gradient_checkpointing"] is True
    assert config["network_train_unet_only"] is True
    assert config["sample_every_n_steps"] == 0
    assert "save_every_n_epochs" not in config


def test_refuses_non_jpeg_existing_output_and_path_escape(tmp_path, monkeypatch):
    personas, private = fixture_inputs(tmp_path, monkeypatch)
    g01 = personas / "creator-001" / "anchors" / "g01.jpg"
    g01.write_bytes(b"not a jpeg")
    with pytest.raises(planner.LocalObservationError, match="cannot be decoded"):
        planner.build_plan(Path("probe"), personas_root=personas, private_root=private)

    Image.new("RGB", (64, 64), (1, 2, 3)).save(g01, format="JPEG")
    (private / "probe").mkdir(parents=True)
    with pytest.raises(planner.LocalObservationError, match="fresh"):
        planner.build_plan(Path("probe"), personas_root=personas, private_root=private)
    with pytest.raises(planner.LocalObservationError, match="private-relative"):
        planner.build_plan(Path("..") / "escape", personas_root=personas, private_root=private)


def test_refuses_reparse_source_before_any_snapshot(tmp_path, monkeypatch):
    personas, private = fixture_inputs(tmp_path, monkeypatch)
    g01 = personas / "creator-001" / "anchors" / "g01.jpg"
    real_reparse = planner._is_reparse
    monkeypatch.setattr(planner, "_is_reparse", lambda path: path == g01 or real_reparse(path))
    with pytest.raises(planner.LocalObservationError, match="reparse"):
        planner.build_plan(Path("probe"), personas_root=personas, private_root=private)
    assert not (private / "probe").exists()


def test_refuses_model_or_sd_scripts_pin_mismatch_before_creating_output(tmp_path, monkeypatch):
    personas, private = fixture_inputs(tmp_path, monkeypatch)
    monkeypatch.setattr(planner, "MODEL_SHA256", "0" * 64)
    with pytest.raises(planner.LocalObservationError, match="checkpoint does not match"):
        planner.build_plan(Path("probe"), personas_root=personas, private_root=private)
    assert not (private / "probe").exists()
    monkeypatch.setattr(planner, "MODEL_SHA256", sha(planner.MODEL_PATH.read_bytes()))
    monkeypatch.setattr(planner, "_sd_scripts_head", lambda: (_ for _ in ()).throw(
        planner.LocalObservationError("local sd-scripts HEAD disagrees with the pinned commit")
    ))
    with pytest.raises(planner.LocalObservationError, match="sd-scripts HEAD"):
        planner.build_plan(Path("probe"), personas_root=personas, private_root=private)
    assert not (private / "probe").exists()


def test_refuses_dirty_sd_scripts_worktree(tmp_path, monkeypatch):
    fixture_inputs(tmp_path, monkeypatch)
    monkeypatch.setattr(planner, "_sd_scripts_head", real_sd_scripts_head)
    calls: list[list[str]] = []

    def fake_run(command, **_kwargs):
        calls.append(command)
        return SimpleNamespace(stdout=planner.SD_SCRIPTS_COMMIT if command[-2:] == ["rev-parse", "HEAD"] else " M library/config_util.py\n")

    monkeypatch.setattr(planner.subprocess, "run", fake_run)
    with pytest.raises(planner.LocalObservationError, match="not clean"):
        planner._sd_scripts_head()
    assert calls[0][-2:] == ["rev-parse", "HEAD"]
    assert calls[1][-3:] == ["status", "--porcelain", "--untracked-files=all"]


def test_failure_cleanup_never_recurses_into_nested_reparse(tmp_path, monkeypatch):
    personas, private = fixture_inputs(tmp_path, monkeypatch)
    actual_is_reparse = planner._is_reparse
    actual_write = planner._write_exclusive

    def fail_after_dataset(path: Path, data: bytes):
        if path.name == "fit-probe.toml":
            destination = private / "probe"
            nested = destination / "dataset"
            monkeypatch.setattr(planner, "_is_reparse", lambda item: item == nested or actual_is_reparse(item))
            raise planner.LocalObservationError("injected post-stage failure")
        actual_write(path, data)

    monkeypatch.setattr(planner, "_write_exclusive", fail_after_dataset)
    with pytest.raises(planner.LocalObservationError, match="injected"):
        planner.build_plan(Path("probe"), personas_root=personas, private_root=private)
    assert (private / "probe" / "dataset").exists()


def test_cli_does_not_accept_caller_selected_roots():
    with pytest.raises(SystemExit):
        planner.build_parser().parse_args(["--out", "probe", "--private-root", "other"])
    with pytest.raises(SystemExit):
        planner.build_parser().parse_args(["--out", "probe", "--personas-root", "other"])


@pytest.mark.parametrize("reader,error", [
    (planner._bounded_bytes, planner.LocalObservationError),
    (preflight._bounded_bytes, preflight.CpuPreflightError),
])
def test_bounded_reader_refuses_file_that_grows_after_initial_stat(tmp_path, monkeypatch, reader, error):
    path = tmp_path / "member.bin"
    path.write_bytes(b"0123456789")
    real_stat = Path.stat
    calls = 0

    def stale_first_stat(self, *args, **kwargs):
        nonlocal calls
        value = real_stat(self, *args, **kwargs)
        if self == path:
            calls += 1
            if calls == 1:
                return SimpleNamespace(st_size=1, st_mtime_ns=value.st_mtime_ns)
        return value

    monkeypatch.setattr(Path, "stat", stale_first_stat)
    with pytest.raises(error, match="changed"):
        reader(path, 5, "member")


def test_cpu_preflight_preserves_a_bounded_redacted_sd_scripts_cause():
    cause = ValueError("invalid bucket at C:\\private\\plan")
    with pytest.raises(preflight.CpuPreflightError) as raised:
        preflight._raise_sd_scripts_rejection(cause)
    message = str(raised.value)
    assert "cause=ValueError:" in message
    assert "invalid bucket" in message
    assert "<path>" in message
    assert raised.value.__cause__ is cause
    with pytest.raises(preflight.CpuPreflightError, match="<redacted-sensitive-message>") as secret:
        preflight._raise_sd_scripts_rejection(ValueError("api_key=not-retained"))
    assert "not-retained" not in str(secret.value)


def test_cpu_preflight_rejects_mutated_plan_and_extra_dataset_member_before_sd_scripts_import(tmp_path, monkeypatch):
    personas, private = fixture_inputs(tmp_path, monkeypatch)
    plan = planner.build_plan(Path("probe"), personas_root=personas, private_root=private)
    root = private / "probe"
    plan_path = root / "local-single-observation-plan.json"

    changed = json.loads(plan_path.read_text(encoding="utf-8"))
    changed["caption"] = "tampered"
    plan_path.write_text(json.dumps(changed), encoding="utf-8")
    with pytest.raises(preflight.CpuPreflightError, match="frozen hash"):
        preflight.parse_cpu_preflight(plan_path, private_root=private)

    plan_path.write_text(json.dumps(plan, sort_keys=True, indent=2), encoding="utf-8")
    extra = root / "dataset" / f"1_{planner.TRIGGER}" / "extra.txt"
    extra.write_text("unexpected", encoding="utf-8")
    with pytest.raises(preflight.CpuPreflightError, match="inventory"):
        preflight.parse_cpu_preflight(plan_path, private_root=private)


def test_cpu_preflight_refuses_staged_source_mutation_before_runtime_import(tmp_path, monkeypatch):
    personas, private = fixture_inputs(tmp_path, monkeypatch)
    planner.build_plan(Path("probe"), personas_root=personas, private_root=private)
    root = private / "probe"
    path = root / "dataset" / f"1_{planner.TRIGGER}" / "g01.jpg"
    data = bytearray(path.read_bytes())
    data[-2] ^= 1
    path.write_bytes(data)
    with pytest.raises(preflight.CpuPreflightError, match="hash changed"):
        preflight.parse_cpu_preflight(root / "local-single-observation-plan.json", private_root=private)


def test_cpu_preflight_rechecks_sd_scripts_before_any_import(tmp_path, monkeypatch):
    personas, private = fixture_inputs(tmp_path, monkeypatch)
    planner.build_plan(Path("probe"), personas_root=personas, private_root=private)
    monkeypatch.setattr(planner, "PERSONAS_ROOT", personas)
    monkeypatch.setattr(preflight, "_load_planner", lambda: planner)
    monkeypatch.setattr(planner, "_sd_scripts_head", lambda: (_ for _ in ()).throw(
        planner.LocalObservationError("local sd-scripts worktree is not clean")
    ))
    with pytest.raises(preflight.CpuPreflightError, match="revalidated"):
        preflight.parse_cpu_preflight(private / "probe" / "local-single-observation-plan.json", private_root=private)
