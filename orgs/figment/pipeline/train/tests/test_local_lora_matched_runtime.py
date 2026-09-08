from __future__ import annotations

import importlib.util
import hashlib
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]


def load():
    spec = importlib.util.spec_from_file_location("matched_runtime_test", HERE / "local_lora_matched_runtime.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


runtime = load()


def safetensor(path: Path, *, steps="20", base="a" * 64, name="lora_unet_x"):
    header = {"__metadata__": {"ss_steps": steps, "ss_network_module": "networks.lora", "ss_new_sd_model_hash": base}, name: {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]}}
    raw = json.dumps(header).encode()
    path.write_bytes(len(raw).to_bytes(8, "little") + raw + b"\x00\x00")


def test_header_requires_selected_steps_base_and_unet_keys(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "STUDIO_PRIVATE", tmp_path)
    checkpoint = tmp_path / "slot.safetensors"; safetensor(checkpoint)
    record = runtime._checkpoint_header(checkpoint, "20", "a" * 64)
    assert record["unet_tensor_keys"] == 1
    safetensor(checkpoint, steps="50")
    with pytest.raises(runtime.MatchedRuntimeError, match="metadata"):
        runtime._checkpoint_header(checkpoint, "20", "a" * 64)
    safetensor(checkpoint, name="not_a_lora")
    with pytest.raises(runtime.MatchedRuntimeError, match="no U-Net"):
        runtime._checkpoint_header(checkpoint, "20", "a" * 64)


def test_header_rejects_overlap_and_oversized_header(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "STUDIO_PRIVATE", tmp_path)
    bad = tmp_path / "bad.safetensors"
    header = {"__metadata__": {"ss_steps": "20", "ss_network_module": "networks.lora", "ss_new_sd_model_hash": "a" * 64}, "lora_unet_a": {"dtype": "F16", "shape": [1], "data_offsets": [0, 4]}, "lora_unet_b": {"dtype": "F16", "shape": [1], "data_offsets": [2, 6]}}
    raw = json.dumps(header).encode(); bad.write_bytes(len(raw).to_bytes(8, "little") + raw + b"\0" * 6)
    with pytest.raises(runtime.MatchedRuntimeError, match="byte span"):
        runtime._checkpoint_header(bad, "20", "a" * 64)
    bad.write_bytes((runtime.MAX_HEADER + 1).to_bytes(8, "little") + b"x")
    with pytest.raises(runtime.MatchedRuntimeError, match="header"):
        runtime._checkpoint_header(bad, "20", "a" * 64)


class FakeC1:
    STAGES = ("base", "current-20", "current-50", "current-final100", "concise-50")
    SEEDS = (481516234, 90210)
    SAMPLER = {"width": 1024, "height": 1024}
    def build_manifest(self, _current, *, concise_plan_sha256):
        return {"rows": [{"id": f"base-seed-{seed}", "stage": "base", "seed": seed, "graph": {"seed": seed}} for seed in self.SEEDS]}


class Stream:
    def __init__(self): self.done = False
    def read(self, _count):
        if self.done: return b""
        self.done = True; return b"journal"


class Process:
    pid = 77
    stderr = Stream()
    terminated = False
    def terminate(self): self.terminated = True
    def wait(self, timeout=None): return 0


class Owned:
    pid = 77


class Helper:
    COMFY_COMMIT = "95d755cd8107a72258d452b5d3657273d571f07d"; PORT = 8190; WIDTH = HEIGHT = 1024
    COMFY_PYTHON = Path("python"); COMFY_ROOT = Path.cwd()
    prompts = 0
    def _port_available(self): pass
    def _isolated_environment(self, _root): return {}
    def _process_identity(self, _pid): return Owned()
    def _wait_for_owned_listener(self, _wrapper, _deadline, tracked): return tracked
    def _loopback_opener(self): return object()
    def _require_owned_listener(self, _wrapper, tracked): return tracked
    def _local_json(self, _opener, method, endpoint, payload=None):
        if method == "POST":
            self.prompts += 1
            return {"prompt_id": f"prompt{self.prompts}"}
        return {"historyx": {"outputs": {"11": {"images": [{"filename": "x.png", "type": "output", "subfolder": ""}]}}}}
    def _completed_output(self, _history, _prompt, output):
        name = f"{_prompt}.png"; content = _prompt.encode(); (output / name).write_bytes(content)
        return {"filename": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(), "dimensions": [1024, 1024]}
    def _teardown(self, _wrapper, _tracked, _process): return {"verified_stopped": True}


def evidence():
    return {"stage": "base", "plan": {"base_model": {"sha256": "a" * 64}}, "plan_file_sha256": "a" * 64, "plan_sha256": "b" * 64, "admission": {}, "matched_admission_sha256": "b" * 64, "matched_admission_id": "figment-matched-base-v1", "runtime_sha256": "c" * 64, "checkpoint": None, "rows": [{"id": "base-seed-481516234", "seed": 481516234, "graph": {"seed": 481516234}}, {"id": "base-seed-90210", "seed": 90210, "graph": {"seed": 90210}}], "code": {"c1_sha256": "c" * 64, "ownership_sha256": "d" * 64}, "producer_receipt_sha256": "e" * 64, "producer_admission_sha256": "f" * 64, "base_receipt_sha256": None, "base_png_sha256_by_seed": None}


def test_execute_runs_exactly_two_rows_and_requires_unique_output_hashes(tmp_path, monkeypatch):
    item = evidence(); helper = Helper(); c1 = FakeC1()
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    monkeypatch.setattr(runtime, "validate", lambda stage: item)
    monkeypatch.setattr(runtime, "_load_bound_modules", lambda: (c1, helper, item["code"]))
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda *args, **kwargs: Process())
    result = runtime.execute(item)
    assert [row["seed"] for row in result["rows"]] == [481516234, 90210]
    assert result["teardown"]["verified_stopped"] is True
    assert result["inputs"]["runtime_sha256"] == item["runtime_sha256"]
    assert result["inputs"]["matched_admission_sha256"] == item["matched_admission_sha256"]
    assert result["inputs"]["matched_admission_id"] == item["matched_admission_id"]


def test_execute_rejects_duplicate_output_hashes_and_still_tears_down(tmp_path, monkeypatch):
    item = evidence(); helper = Helper(); c1 = FakeC1(); called = []
    def duplicate(_history, _prompt, output):
        name = f"{_prompt}.png"; (output / name).write_bytes(b"x")
        return {"filename": name, "bytes": 1, "sha256": "a" * 64, "dimensions": [1024, 1024]}
    helper._completed_output = duplicate
    helper._teardown = lambda *_args: called.append(True) or {"verified_stopped": True}
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    monkeypatch.setattr(runtime, "validate", lambda stage: item)
    monkeypatch.setattr(runtime, "_load_bound_modules", lambda: (c1, helper, item["code"]))
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda *args, **kwargs: Process())
    with pytest.raises(runtime.MatchedRuntimeError, match="inventory"):
        runtime.execute(item)
    assert called == [True]


def test_preidentity_failure_terminates_retained_process(tmp_path, monkeypatch):
    item = evidence(); helper = Helper(); c1 = FakeC1(); process = Process()
    helper._process_identity = lambda _pid: None
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    monkeypatch.setattr(runtime, "validate", lambda stage: item)
    monkeypatch.setattr(runtime, "_load_bound_modules", lambda: (c1, helper, item["code"]))
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda *args, **kwargs: process)
    with pytest.raises(runtime.MatchedRuntimeError, match="cannot identify"):
        runtime.execute(item)
    assert process.terminated is True


def test_quality_plan_requires_exact_schedule_and_execution_boundary(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "STUDIO_PRIVATE", tmp_path)
    plan = {"schema": runtime.QUALITY_PLAN_SCHEMA, "branch": "current", "not_promotable": True, "execution": {"checkpoint_acceptance_allowed": False, "cpu_preflight_allowed": True, "gpu_quality_allowed": False, "sample_export_allowed": False}, "source": {"sha256": "e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed"}, "recipe": {"output_name": "x", "max_train_steps": 100, "save_every_n_steps": 10, "save_state": False, "samples": 0, "exports": 0, "checkpoint_names": [*[f"x-step{step:08d}.safetensors" for step in range(10, 101, 10)], "x.safetensors"], "checkpoint_steps": [*range(10, 101, 10), 100]}}
    body = dict(plan); plan["frozen_sha256"] = runtime._sha(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode())
    path = tmp_path / "plan.json"; path.write_text(json.dumps(plan))
    runtime._quality_plan(path, "current")
    plan["recipe"]["checkpoint_names"] = []
    path.write_text(json.dumps(plan))
    with pytest.raises(runtime.MatchedRuntimeError, match="frozen hash"):
        runtime._quality_plan(path, "current")


def _run_root(tmp_path, stage="base"):
    return tmp_path / f"figment-local-lora-matched-{stage}-20260908-v1"


def _wire_execute(tmp_path, monkeypatch, item=None, helper=None):
    item = evidence() if item is None else item
    helper = Helper() if helper is None else helper
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    monkeypatch.setattr(runtime, "validate", lambda stage: item)
    monkeypatch.setattr(runtime, "_load_bound_modules", lambda: (FakeC1(), helper, item["code"]))
    return item, helper


def test_execute_uses_utf8_and_single_global_deadline(tmp_path, monkeypatch):
    item, helper = _wire_execute(tmp_path, monkeypatch)
    captured = []
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda command, **kwargs: captured.append(command) or Process())
    result = runtime.execute(item)
    assert captured[0][1:3] == ["-X", "utf8"]
    assert result["deadline_seconds"] == runtime.PAIR_SECONDS


def test_execute_deadline_before_launch_writes_durable_failure(tmp_path, monkeypatch):
    item, _helper = _wire_execute(tmp_path, monkeypatch)
    monkeypatch.setattr(runtime, "PAIR_SECONDS", 0)
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda *_args, **_kwargs: pytest.fail("deadline must refuse before Popen"))
    with pytest.raises(runtime.MatchedRuntimeError, match="one deadline"):
        runtime.execute(item)
    failure = json.loads((_run_root(tmp_path) / "failure.json").read_text())
    assert failure["status"] == "failed"
    assert failure["stderr_sha256"] == hashlib.sha256(b"").hexdigest()


def test_post_teardown_inventory_is_rechecked_and_failure_is_recorded(tmp_path, monkeypatch):
    item, helper = _wire_execute(tmp_path, monkeypatch)
    def teardown(_wrapper, _tracked, _process):
        (_run_root(tmp_path) / "output" / "late.png").write_bytes(b"late")
        return {"verified_stopped": True}
    helper._teardown = teardown
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda *_args, **_kwargs: Process())
    with pytest.raises(runtime.MatchedRuntimeError, match="entry bound"):
        runtime.execute(item)
    failure = json.loads((_run_root(tmp_path) / "failure.json").read_text())
    assert failure["teardown"]["verified_stopped"] is True
    assert [row["seed"] for row in failure["rows"]] == [481516234, 90210]


def test_popen_failure_keeps_empty_bounded_log_and_failure_receipt(tmp_path, monkeypatch):
    item, _helper = _wire_execute(tmp_path, monkeypatch)
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("no launch")))
    with pytest.raises(OSError, match="no launch"):
        runtime.execute(item)
    root = _run_root(tmp_path)
    failure = json.loads((root / "failure.json").read_text())
    assert failure["failure_class"] == "OSError"
    assert failure["stderr_complete"] is True
    assert failure["inputs"]["plan_file_sha256"] == item["plan_file_sha256"]
    assert failure["inputs"]["matched_admission_id"] == item["matched_admission_id"]
    assert (root / "stderr.log").read_bytes() == b""


def test_teardown_or_journal_failure_still_writes_durable_failure(tmp_path, monkeypatch):
    item, helper = _wire_execute(tmp_path, monkeypatch)
    helper._teardown = lambda *_args: (_ for _ in ()).throw(RuntimeError("cleanup failed"))
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda *_args, **_kwargs: Process())
    with pytest.raises(RuntimeError, match="cleanup failed"):
        runtime.execute(item)
    failure = json.loads((_run_root(tmp_path) / "failure.json").read_text())
    assert failure["failure_class"] == "RuntimeError"
    assert failure["teardown"]["verified_stopped"] is False

    class FinishedThread:
        def is_alive(self): return False
    class BrokenPumper:
        def __init__(self, _stream, _path):
            self.started = True; self.error = None; self.truncated = False; self.thread = FinishedThread()
        def start(self): pass
        def finish(self): raise runtime.MatchedRuntimeError("journal failed")

    second = tmp_path / "second"
    second.mkdir()
    item, _helper = _wire_execute(second, monkeypatch)
    monkeypatch.setattr(runtime, "_Pumper", BrokenPumper)
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda *_args, **_kwargs: Process())
    with pytest.raises(runtime.MatchedRuntimeError, match="journal failed"):
        runtime.execute(item)
    failure = json.loads((_run_root(second) / "failure.json").read_text())
    assert failure["failure_class"] == "MatchedRuntimeError"


def test_copy_stream_stops_at_the_adapter_bound(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "STUDIO_PRIVATE", tmp_path)
    monkeypatch.setattr(runtime, "MAX_LORA", 4)
    source = tmp_path / "source.safetensors"
    source.write_bytes(b"12345")
    target = tmp_path / "target.safetensors"
    with pytest.raises(runtime.MatchedRuntimeError, match="boundary is unsafe"):
        runtime._copy_stream(source, target, hashlib.sha256(b"12345").hexdigest())


def _observation(seed: int):
    return {"seed": seed, "realism": "plausible", "resemblance_to_g01": "tracks stated cue", "pose": "matches diagnostic pose", "apparent_adulthood": "adult-presenting", "apparent_age_fit": "fits adult prompt", "clothing": "opaque top intact", "defects": "none observed"}


def _write_prior_pair(root: Path, *, observations=None):
    stage_root = root / "figment-local-lora-matched-base-20260908-v1"
    output = stage_root / "output"
    output.mkdir(parents=True)
    rows = []
    for seed in (481516234, 90210):
        content = f"png-{seed}".encode()
        name = f"base-{seed}.png"
        (output / name).write_bytes(content)
        rows.append({"seed": seed, "output": {"filename": name, "sha256": hashlib.sha256(content).hexdigest()}})
    receipt = {"schema": runtime.SCHEMA, "status": "complete", "stage": "base", "teardown": {"verified_stopped": True}, "rows": rows}
    receipt_raw = json.dumps(receipt).encode()
    (stage_root / "receipt.json").write_bytes(receipt_raw)
    receipt_sha = hashlib.sha256(receipt_raw).hexdigest()
    for role in ("root", "independent"):
        review = {"schema": "figment/local-lora-matched-pair-review@1", "stage": "base", "reviewer_role": role, "reviewer_id": role + "-reviewer", "receipt_sha256": receipt_sha, "disposition": "continue", "not_promotable": True, "human_qa": False, "observations": [_observation(seed) for seed in (481516234, 90210)] if observations is None else observations, "rows": [{"seed": row["seed"], "output_sha256": row["output"]["sha256"]} for row in rows]}
        (stage_root / f"review-{role}.json").write_text(json.dumps(review))
    return stage_root, rows


def test_prior_reviews_bind_actual_png_bytes_and_nonempty_observations(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    root, rows = _write_prior_pair(tmp_path)
    digests = [hashlib.sha256((root / f"review-{role}.json").read_bytes()).hexdigest() for role in ("root", "independent")]
    runtime._prior_reviews("current-20", {"prior_pair_review_digests": digests})
    (root / "output" / rows[0]["output"]["filename"]).write_bytes(b"changed")
    with pytest.raises(runtime.MatchedRuntimeError, match="bytes differ"):
        runtime._prior_reviews("current-20", {"prior_pair_review_digests": digests})
    content = f"png-{rows[0]['seed']}".encode()
    (root / "output" / rows[0]["output"]["filename"]).write_bytes(content)
    review_path = root / "review-root.json"
    review = json.loads(review_path.read_text())
    review["observations"][0]["clothing"] = " "
    review_path.write_text(json.dumps(review))
    digests[0] = hashlib.sha256(review_path.read_bytes()).hexdigest()
    with pytest.raises(runtime.MatchedRuntimeError, match="review is invalid"):
        runtime._prior_reviews("current-20", {"prior_pair_review_digests": digests})


def test_bound_module_loader_requires_clean_comfy_and_checked_base(tmp_path, monkeypatch):
    c1_path = tmp_path / "c1.py"
    ownership_path = tmp_path / "ownership.py"
    c1_path.write_text("# c1\n")
    ownership_path.write_text("# helper\n")
    comfy = tmp_path / "comfy"
    (comfy / "comfy").mkdir(parents=True)
    (comfy / "nodes.py").write_text("# nodes\n")
    (comfy / "comfy" / "sd.py").write_text("# sd\n")
    interpreter = tmp_path / "python.exe"
    interpreter.write_bytes(b"python")
    base = tmp_path / runtime.BASE_MODEL_NAME
    base.write_bytes(b"base")
    class BoundHelper:
        COMFY_COMMIT = "95d755cd8107a72258d452b5d3657273d571f07d"
        PORT = 8190
        WIDTH = HEIGHT = 1024
        COMFY_ROOT = comfy
        COMFY_PYTHON = interpreter
        MODELS = {"checkpoint": {"filename": runtime.BASE_MODEL_NAME, "path": base, "sha256": "f" * 64}}
        def git_head(self, _root): return self.COMFY_COMMIT
        def git_clean(self, _root): return True
        def checked_file(self, path, expected):
            assert path == base and expected == "f" * 64
            return {"sha256": expected, "bytes": 4}
        def safe_existing(self, path): return path
    fake_c1 = FakeC1()
    monkeypatch.setattr(runtime, "C1_PATH", c1_path)
    monkeypatch.setattr(runtime, "OWNERSHIP_PATH", ownership_path)
    monkeypatch.setattr(runtime, "C1_SHA256", hashlib.sha256(c1_path.read_bytes()).hexdigest())
    monkeypatch.setattr(runtime, "OWNERSHIP_SHA256", hashlib.sha256(ownership_path.read_bytes()).hexdigest())
    helper = BoundHelper()
    monkeypatch.setattr(runtime, "_load", lambda name, _path: fake_c1 if name.endswith("c1") else helper)
    _c1, _helper, code = runtime._load_bound_modules()
    assert code["comfy_base_model_sha256"] == "f" * 64
    helper.git_clean = lambda _root: False
    with pytest.raises(runtime.MatchedRuntimeError, match="pinned clean"):
        runtime._load_bound_modules()


def test_safe_existing_checks_ancestors_root_shape_and_exact_resolution(tmp_path, monkeypatch):
    root = tmp_path / "fixed"
    root.mkdir()
    target = root / "record.json"
    target.write_text("{}")
    assert runtime._safe_existing(target, root, "test evidence") == target.absolute()
    original = runtime._reparse
    monkeypatch.setattr(runtime, "_reparse", lambda path: path == tmp_path or original(path))
    with pytest.raises(runtime.MatchedRuntimeError, match="reparse"):
        runtime._safe_existing(target, root, "test evidence")
    monkeypatch.setattr(runtime, "_reparse", original)
    lexical = root / ".." / root.name / target.name
    with pytest.raises(runtime.MatchedRuntimeError, match="exact fixed-root"):
        runtime._safe_existing(lexical, root, "test evidence")
    with pytest.raises(runtime.MatchedRuntimeError, match="fixed root"):
        runtime._safe_existing(target, target, "test evidence")
