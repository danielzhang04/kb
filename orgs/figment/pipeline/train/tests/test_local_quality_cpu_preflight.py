from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

HERE = Path(__file__).resolve().parents[1]


def load():
    spec = importlib.util.spec_from_file_location("quality_cpu_test", HERE / "local_quality_cpu_preflight.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


cpu = load()


class Planner:
    TRIGGER = "figmentlocalg01probe"
    CREATOR = "creator-001"
    PRIVATE_ROOT = Path("unused")
    def _safe_existing(self, path, root):
        path = Path(path)
        if not path.exists() or path.is_symlink(): raise ValueError("unsafe")
        return path


def frozen(value):
    body = dict(value); body.pop("frozen_sha256", None)
    value["frozen_sha256"] = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
    return value


def fixture(tmp_path):
    root = tmp_path / "private"; plan_root = root / "quality"; dataset = plan_root / "dataset" / "1_figmentlocalg01probe"; dataset.mkdir(parents=True)
    files = {}
    for name, raw in (("g01.jpg", b"jpeg"), ("g01.txt", b"caption\n"), ("local-quality.toml", b"template")):
        path = dataset / name if name != "local-quality.toml" else plan_root / name
        path.write_bytes(raw); files[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    output = "figmentlocalg01quality-current-100"
    recipe = {"max_train_steps": 100, "save_every_n_steps": 10, "save_state": False, "samples": 0, "exports": 0, "output_name": output, "checkpoint_names": [*[f"{output}-step{step:08d}.safetensors" for step in range(10, 101, 10)], f"{output}.safetensors"], "checkpoint_steps": [*range(10, 101, 10), 100], "max_checkpoint_bytes": 256 * 1024 * 1024, "max_checkpoint_total_bytes": 3 * 1024 * 1024 * 1024}
    plan = frozen({"schema": cpu.PLAN_SCHEMA, "purpose": "one-source-local-quality-diagnostic", "not_promotable": True, "execution": {"cpu_preflight_allowed": True, "gpu_quality_allowed": False, "sample_export_allowed": False, "checkpoint_acceptance_allowed": False}, "branch": "current", "creator": "creator-001", "observation": {"count": 1, "kind": "canonical-original-pixels", "crop_training_view": None, "independent_views": 1}, "staging": {"dataset": "dataset/1_figmentlocalg01probe", "files": files}, "recipe": recipe, "code": {"planner_sha256": "p" * 64, "quality_plan_sha256": "a" * 64, "cpu_helper_sha256": cpu.CPU_HELPER_SHA256}})
    path = plan_root / cpu.PLAN_NAME; path.write_text(json.dumps(plan), encoding="utf-8")
    planner = Planner(); planner._quality_planner_sha256 = "p" * 64
    quality = SimpleNamespace(_load_planner=lambda: planner, _cpu_checked_quality_plan_sha256="a" * 64)
    return root, path, plan, quality


def test_validates_closed_synthetic_stage(tmp_path, monkeypatch):
    root, path, _plan, quality = fixture(tmp_path); monkeypatch.setattr(cpu, "_load_quality_plan", lambda: quality); monkeypatch.setattr(cpu, "_validate_current_pins", lambda *args: None)
    plan, _planner, _root = cpu.validate_plan(path, private_root=root)
    assert plan["recipe"]["checkpoint_steps"] == [*range(10, 101, 10), 100]


@pytest.mark.parametrize("target", ["caption", "template", "extra"])
def test_refuses_changed_or_extra_stage_members(tmp_path, monkeypatch, target):
    root, path, _plan, quality = fixture(tmp_path); monkeypatch.setattr(cpu, "_load_quality_plan", lambda: quality); monkeypatch.setattr(cpu, "_validate_current_pins", lambda *args: None)
    dataset = path.parent / "dataset" / "1_figmentlocalg01probe"
    if target == "caption": (dataset / "g01.txt").write_bytes(b"changed\n")
    elif target == "template": (path.parent / "local-quality.toml").write_bytes(b"changed")
    else: (dataset / "extra.txt").write_bytes(b"x")
    with pytest.raises(cpu.QualityCpuError): cpu.validate_plan(path, private_root=root)


def test_refuses_extra_repeat_directory(tmp_path, monkeypatch):
    root, path, _plan, quality = fixture(tmp_path); monkeypatch.setattr(cpu, "_load_quality_plan", lambda: quality); monkeypatch.setattr(cpu, "_validate_current_pins", lambda *args: None)
    (path.parent / "dataset" / "2_extra").mkdir()
    with pytest.raises(cpu.QualityCpuError, match="repeat root"): cpu.validate_plan(path, private_root=root)


def test_checked_cpu_helper_loads_by_absolute_path_without_sys_path_mutation():
    before = list(sys.path)
    helper = cpu._load_cpu_helper()
    assert callable(helper._assert_cpu_torch_state) and sys.path == before


@pytest.mark.parametrize("field,value", [("not_promotable", False), ("execution", {}), ("observation", {})])
def test_refuses_tampered_plan_boundary_or_code(tmp_path, monkeypatch, field, value):
    root, path, plan, quality = fixture(tmp_path); monkeypatch.setattr(cpu, "_load_quality_plan", lambda: quality); monkeypatch.setattr(cpu, "_validate_current_pins", lambda *args: None)
    plan[field] = value; frozen(plan); path.write_text(json.dumps(plan), encoding="utf-8")
    with pytest.raises(cpu.QualityCpuError): cpu.validate_plan(path, private_root=root)
    root, path, plan, quality = fixture(tmp_path / "code"); monkeypatch.setattr(cpu, "_load_quality_plan", lambda: quality); monkeypatch.setattr(cpu, "_validate_current_pins", lambda *args: None)
    plan["code"]["planner_sha256"] = "x" * 64; frozen(plan); path.write_text(json.dumps(plan), encoding="utf-8")
    with pytest.raises(cpu.QualityCpuError, match="planner module"): cpu.validate_plan(path, private_root=root)


def test_current_pin_validator_refuses_caption_and_template_mismatch(tmp_path):
    raw = b"jpeg"; caption = "current"; template = b"template"
    source = tmp_path / "g01.jpg"; source.write_bytes(raw)
    persona = tmp_path / "creator" / "persona.yaml"; persona.parent.mkdir(); persona.write_bytes(b"persona")
    script = tmp_path / "train.py"; script.write_bytes(b"script")
    model = tmp_path / "model.safetensors"; model.write_bytes(b"model")
    template_path = tmp_path / "quality.toml"; template_path.write_bytes(template)
    class Current(Planner):
        PERSONAS_ROOT = tmp_path; SOURCE_RELATIVE = Path("g01.jpg"); CREATOR = "creator"; VENV_PYTHON = Path(__file__).resolve(); SDXL_SCRIPT = script; MODEL_PATH = model; MODEL_BYTES = len(b"model"); MODEL_SHA256 = "m" * 64; SD_SCRIPTS_COMMIT = "commit"
        def _read_jpeg(self, p): return raw, 1, 1
        def _fixed_regular(self, p, label): return None
        def _file_sha256(self, p, maximum=None): return hashlib.sha256(p.read_bytes()).hexdigest(), len(p.read_bytes())
        def _sd_scripts_head(self): return "commit"
    current = Current()
    recipe = {"output_name": "quality", "template_sha": hashlib.sha256(template).hexdigest()}
    quality = SimpleNamespace(TEMPLATE_PATH=template_path, _caption=lambda branch, planner, persona: (caption, "persona-sha"), _recipe=lambda data, output: {"output_name": output, "template_sha": hashlib.sha256(data).hexdigest()})
    plan = {"branch": "current", "recipe": recipe, "source": {"logical_path": "anchors/g01.jpg", "sha256": hashlib.sha256(raw).hexdigest(), "bytes": 4, "width": 1, "height": 1, "format": "JPEG"}, "caption": caption, "persona_sha256": "persona-sha", "base_model": {"path": str(model), "sha256": "m" * 64, "bytes": 5, "license": "OpenRAIL++", "provenance": "2026-09-08-local-comfy-capability.md"}, "trainer": {"script": "sdxl_train_network.py", "sd_scripts_commit": "commit", "sd_scripts_script_sha256": hashlib.sha256(b"script").hexdigest(), "venv_python": str(Current.VENV_PYTHON), "template": "local-quality.toml"}, "staging": {"files": {"g01.jpg": {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": 4, "width": 1, "height": 1}, "g01.txt": {"sha256": hashlib.sha256(b"current\n").hexdigest(), "bytes": 8}, "local-quality.toml": {"sha256": hashlib.sha256(template).hexdigest(), "bytes": 8}}}}
    cpu._validate_current_pins(plan, quality, current)
    plan["caption"] = "changed"
    with pytest.raises(cpu.QualityCpuError, match="caption"): cpu._validate_current_pins(plan, quality, current)
    plan["caption"] = caption; template_path.write_bytes(b"changed")
    with pytest.raises(cpu.QualityCpuError, match="recipe changed"): cpu._validate_current_pins(plan, quality, current)


def test_parser_verifies_command_line_before_reading_toml():
    source = (HERE / "local_quality_cpu_preflight.py").read_text(encoding="utf-8")
    assert source.index("args_util.verify_command_line_training_args(args)") < source.index("args_util.read_config_from_file(args, parser)")
