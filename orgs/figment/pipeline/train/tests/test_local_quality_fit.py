"""CPU-only boundaries for the separately admitted quality executor."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


HERE = Path(__file__).resolve().parents[1]


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


fit = load("quality_fit_test", "local_quality_fit.py")
runtime = fit.runtime


def freeze(value):
    body = dict(value); body.pop("frozen_sha256", None)
    value["frozen_sha256"] = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
    return value


def recipe(branch="current"):
    output = f"figmentlocalg01quality-{branch}-100"
    return {
        "max_train_steps": 100, "save_every_n_steps": 10, "save_state": False,
        "samples": 0, "exports": 0, "output_name": output,
        "checkpoint_names": [*[f"{output}-step{step:08d}.safetensors" for step in range(10, 101, 10)], f"{output}.safetensors"],
        "checkpoint_steps": [*range(10, 101, 10), 100],
        "max_checkpoint_bytes": fit.MAX_CHECKPOINT_BYTES,
        "max_checkpoint_total_bytes": fit.MAX_CHECKPOINT_TOTAL_BYTES,
    }


def tensor(path: Path, steps: int):
    header = {"__metadata__": {"ss_steps": str(steps)}, "lora": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}
    raw = json.dumps(header).encode()
    path.write_bytes(len(raw).to_bytes(8, "little") + raw + b"\0\0\0\0")


def execution_evidence(tmp_path: Path):
    private = tmp_path / "private"; private.mkdir(parents=True)
    plan_root = private / "plan"; dataset = plan_root / "dataset" / "1_figmentlocalg01probe"; dataset.mkdir(parents=True)
    files = {}
    for name, raw in (("g01.jpg", b"jpeg"), ("g01.txt", b"caption\n"), ("local-quality.toml", b"toml")):
        target = dataset / name if name != "local-quality.toml" else plan_root / name
        target.write_bytes(raw); files[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    prepared = private / "prepared"; prepared.mkdir(); copies = []
    for identifier, directory in fit.TOKENIZER_DIRS.items():
        (prepared / directory).mkdir()
        for name in fit.TOKENIZER_FILES:
            raw = (identifier + name).encode(); (prepared / directory / name).write_bytes(raw)
            copies.append({"tokenizer": identifier, "path": f"{directory}/{name}", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    plan = {"frozen_sha256": "a" * 64, "branch": "current", "staging": {"dataset": "dataset/1_figmentlocalg01probe", "files": files}, "recipe": recipe()}
    return {
        "plan": plan, "policy": fit._recipe(plan)[0], "admission": {"admission_id": "quality-one", "gpu_device": 0},
        "launcher_sha256": "b" * 64, "planner_sha256": "e" * 64, "ownership_sha256": "c" * 64, "bindings": {"plan_sha256": "a" * 64, "cpu_receipt_sha256": "d" * 64}, "tokenizer_copies": copies,
        "input_paths": {"plan": str(plan_root / fit.PLAN_NAME), "prepared": str(prepared / fit.PREPARED_NAME), "private": str(private), "cpu": str(private / "cpu" / "receipt.json"), "admission": str(private / "admission.json"), "load": str(prepared / fit.LOAD_NAME), "main": str(tmp_path / "main")},
    }


class Empty:
    def read(self, _): return b""
    def close(self): pass


class Identity:
    pid = 77


class Planner:
    VENV_PYTHON = Path("python")
    SD_SCRIPTS_ROOT = Path.cwd()
    MODEL_PATH = Path("model")


def test_quality_recipe_requires_exact_eleven_names_and_metadata(tmp_path):
    plan = {"branch": "current", "recipe": recipe()}
    policy, _ = fit._recipe(plan)
    output = tmp_path / "output"; output.mkdir()
    for artifact in policy.artifacts:
        tensor(output / artifact.name, artifact.ss_steps)
    records = runtime.checkpoints(output, policy)
    assert len(records) == 11 and records[-1]["ss_steps"] == 100
    tensor(output / policy.artifacts[0].name, 9)
    with pytest.raises(fit.QualityFitError, match="ss_steps"):
        runtime.checkpoints(output, policy)


def test_quality_cpu_receipt_binds_raw_and_each_staged_hash(tmp_path):
    main = tmp_path / "main"; receipt_dir = main / "cpu"; receipt_dir.mkdir(parents=True)
    hashes = {key: "a" * 64 for key in ("quality_cpu_parser_sha256", "quality_planner_sha256", "planner_sha256", "cpu_helper_sha256", "ownership_sha256")}
    plan = {"frozen_sha256": "b" * 64, "branch": "current", "caption": "caption", "staging": {"files": {name: {"sha256": letter * 64} for name, letter in (("g01.jpg", "c"), ("g01.txt", "d"), ("local-quality.toml", "e"))}}}
    inputs = {"plan_file_sha256": "f" * 64, "plan_canonical_sha256": plan["frozen_sha256"], "quality_parser_sha256": hashes["quality_cpu_parser_sha256"], "quality_planner_sha256": hashes["quality_planner_sha256"], "planner_sha256": hashes["planner_sha256"], "cpu_helper_sha256": hashes["cpu_helper_sha256"], "ownership_sha256": hashes["ownership_sha256"], "launcher_sha256": "l" * 64, "stage_g01.jpg_sha256": "c" * 64, "stage_g01.txt_sha256": "d" * 64, "stage_local-quality.toml_sha256": "e" * 64}
    result = {"schema": fit.CPU_RESULT_SCHEMA, "plan_sha256": plan["frozen_sha256"], "quality_plan_module_sha256": hashes["quality_planner_sha256"], "observations": 1, "unique_source_images": 1, "repeat_count": 1, "caption": "caption", "target_resolution": [768, 768], "effective_buckets": [[896, 512]], "cuda_visible_devices": "-1", "cuda_available": False, "cuda_device_count": 0, "cuda_initialized": False, "not_promotable": True, "gpu_quality_allowed": False, "offline_environment": ["PYTORCH_NVML_BASED_CUDA_CHECK"]}
    receipt = {"schema": fit.CPU_SCHEMA, "status": "complete", "branch": "current", "plan_sha256": plan["frozen_sha256"], "process": {"exit_code": 0}, "teardown": {"verified_stopped": True}, "inputs": inputs, "result": result}
    path = receipt_dir / "receipt.json"; path.write_text(json.dumps(receipt), encoding="utf-8")
    assert len(fit._cpu(path, plan, "f" * 64, hashes, "l" * 64, main)) == 64
    receipt["inputs"]["stage_g01.txt_sha256"] = "x" * 64; path.write_text(json.dumps(receipt), encoding="utf-8")
    with pytest.raises(fit.QualityFitError, match="stage binding"):
        fit._cpu(path, plan, "f" * 64, hashes, "l" * 64, main)


def test_execute_replay_and_changed_run_owned_tokenizer_refuse_before_second_popen(tmp_path, monkeypatch):
    evidence = execution_evidence(tmp_path); calls = []
    class Process:
        pid = 77; stdout = Empty(); stderr = Empty()
        def poll(self): return 7
        def wait(self, timeout): return 7
    class Owner:
        def _process_identity(self, pid): return Identity()
        def _teardown(self, *args): return {"verified_stopped": True}
    monkeypatch.setattr(fit, "_fresh_evidence", lambda _: evidence)
    monkeypatch.setattr(fit, "_planner", lambda _: Planner)
    monkeypatch.setattr(fit, "_ownership", lambda _: Owner())
    monkeypatch.setattr(fit.subprocess, "Popen", lambda *args, **kwargs: (calls.append(1) or Process()))
    with pytest.raises(fit.QualityFitError, match="nonzero"):
        fit.execute(evidence, out="figment-local-quality-fit-a")
    with pytest.raises(fit.QualityFitError, match="exclusively"):
        fit.execute(evidence, out="figment-local-quality-fit-b")
    assert len(calls) == 1
    evidence = execution_evidence(tmp_path / "changed"); calls.clear(); fresh = [evidence, evidence]
    def refreshed(_):
        value = fresh.pop(0)
        if not fresh:
            path = Path(value["input_paths"]["private"]) / "figment-local-quality-fit-change" / "tokenizers" / fit.TOKENIZER_DIRS[fit.TOKENIZER_IDS[0]] / "vocab.json"
            path.write_bytes(b"changed")
        return value
    monkeypatch.setattr(fit, "_fresh_evidence", refreshed)
    with pytest.raises(fit.QualityFitError, match="tokenizer asset changed"):
        fit.execute(evidence, out="figment-local-quality-fit-change")
    assert not calls


def test_shared_runtime_handles_thread_start_failure_and_quality_command_uses_utf8(tmp_path, monkeypatch):
    logs = tmp_path / "logs"; output = tmp_path / "output"; logs.mkdir(); output.mkdir()
    policy = runtime.RunPolicy("x-", "x-markers", 1, 8, 2, 1024, 2048, (runtime.ArtifactPolicy("x.safetensors", 1),))
    class Process:
        pid = 77; stdout = Empty(); stderr = Empty()
        def poll(self): return 0
        def wait(self, timeout): return 0
    class Owner:
        def _process_identity(self, pid): return Identity()
        def _teardown(self, *args): return {"verified_stopped": True}
    class BadThread:
        def __init__(self, **kwargs): pass
        def start(self): raise RuntimeError("thread start")
    result = runtime.run_owned([sys.executable, "-X", "utf8"], cwd=Path.cwd(), environment_map={}, root=tmp_path, logs=logs, output=output, policy=policy, ownership=Owner(), popen=lambda *args, **kwargs: Process(), thread_factory=BadThread)
    assert result.failure == "spawn-or-ownership-failed" and result.teardown["verified_stopped"]
    evidence = execution_evidence(tmp_path / "command")
    seen = []
    class Nonzero(Process): pass
    monkeypatch.setattr(fit, "_fresh_evidence", lambda _: evidence); monkeypatch.setattr(fit, "_planner", lambda _: Planner); monkeypatch.setattr(fit, "_ownership", lambda _: Owner())
    monkeypatch.setattr(fit.subprocess, "Popen", lambda command, *args, **kwargs: (seen.append(command) or Nonzero()))
    with pytest.raises(fit.QualityFitError): fit.execute(evidence, out="figment-local-quality-fit-command")
    assert seen[0][1:3] == ["-X", "utf8"]


def test_quality_success_receipt_has_digest_provenance_and_closed_policy(tmp_path, monkeypatch):
    with pytest.raises(fit.QualityFitError):
        runtime.RunPolicy("x-", "markers", -1, 8, 2, 1024, 2048, (runtime.ArtifactPolicy("x", 1),))
    with pytest.raises(fit.QualityFitError):
        runtime.RunPolicy("x-", "markers", 0, 8, 2, 1024, 2048, (runtime.ArtifactPolicy("x", 1),))
    with pytest.raises(fit.QualityFitError):
        runtime.RunPolicy("x-", "markers", 1, 8, 2, 1024, 2048, (runtime.ArtifactPolicy("x", 1), runtime.ArtifactPolicy("x", 1)))
    evidence = execution_evidence(tmp_path)
    class Process:
        pid = 77; stdout = Empty(); stderr = Empty()
        def poll(self): return 0
        def wait(self, timeout): return 0
    class Owner:
        def _process_identity(self, pid): return Identity()
        def _teardown(self, *args): return {"verified_stopped": True}
    def launch(command, *args, **kwargs):
        output = Path(command[command.index("--output_dir") + 1])
        for artifact in evidence["policy"].artifacts:
            tensor(output / artifact.name, artifact.ss_steps)
        return Process()
    monkeypatch.setattr(fit, "_fresh_evidence", lambda _: evidence)
    monkeypatch.setattr(fit, "_planner", lambda _: Planner)
    monkeypatch.setattr(fit, "_ownership", lambda _: Owner())
    monkeypatch.setattr(fit.subprocess, "Popen", launch)
    receipt = fit.execute(evidence, out="figment-local-quality-fit-success")
    assert receipt["status"] == "complete" and len(receipt["checkpoints"]) == 11
    assert receipt["inputs"] == evidence["bindings"]
