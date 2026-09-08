from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from PIL import Image, PngImagePlugin


HERE = Path(__file__).resolve().parents[1]


def load():
    spec = importlib.util.spec_from_file_location("local_lora_profile_runtime_test", HERE / "local_lora_profile_runtime.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec); sys.modules[spec.name] = module; spec.loader.exec_module(module)
    return module


runtime = load()
CODE = {"planner_sha256": "1" * 64, "controller_sha256": "2" * 64, "pair_engine_sha256": "3" * 64, "ownership_sha256": "4" * 64, "c1_sha256": "5" * 64, "comfy_commit": "6" * 40, "comfy_base_model_sha256": "7" * 64, "comfy_nodes_sha256": "8" * 64, "comfy_sd_sha256": "9" * 64}
PLAN = "b" * 64


def graph():
    return {"4": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1024}}, "5": {"class_type": "KSampler", "inputs": {"seed": 481516234, "denoise": 1}}}


def png(path: Path, value: dict):
    info = PngImagePlugin.PngInfo(); info.add_text("prompt", json.dumps(value, sort_keys=True, separators=(",", ":")))
    Image.new("RGB", (1024, 1024)).save(path, pnginfo=info)


def frozen(body: dict) -> dict:
    body = dict(body); body["frozen_sha256"] = runtime._sha(runtime._canonical(body)); return body


def write_json(path: Path, value: dict) -> str:
    path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(json.dumps(value, sort_keys=True).encode()); return runtime._sha(path.read_bytes())


def execute_item(code: dict) -> dict:
    return {"stage": "profile-base", "rows": [{"id": "profile-base-seed-481516234", "seed": 481516234, "graph": graph(), "c1_stage": "base"}, {"id": "profile-base-seed-90210", "seed": 90210, "graph": graph(), "c1_stage": "base"}], "checkpoint": None, "admission": {"admission_id": runtime._admission_id("profile-base"), **CODE}, "admission_sha256": "a" * 64, "code": code, "plan_sha256": PLAN, "historical_base_receipt_sha256": "c" * 64, "historical_current20_receipt_sha256": "d" * 64, "profile_base_receipt_sha256": None}


class FakeEngine:
    class Pumper: pass
    def __init__(self, captured: dict, *, before_success=None):
        self.captured, self.before_success = captured, before_success
    def execute_pair(self, evidence, _helper, **kwargs):
        self.captured.update(kwargs)
        if self.before_success is not None: self.before_success()
        kwargs["verify_before_success"]()
        return {"status": "complete", "rows": evidence["rows"]}


def build_profile_base(tmp_path: Path, monkeypatch, *, receipt_edit=None, review_edit=None) -> dict:
    main, studio = tmp_path / "main", tmp_path / "studio"; main.mkdir(); studio.mkdir()
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", main); monkeypatch.setattr(runtime, "STUDIO_PRIVATE", studio)
    prior = frozen({"schema": runtime.ADMISSION_SCHEMA, "admission_id": runtime._admission_id("profile-base"), "stage": "profile-base", "planner_manifest_sha256": PLAN, **CODE, "profile_base_receipt_sha256": None, "profile_base_png_sha256_by_seed": None, "profile_base_review_digests": [], "allow_local_execute": True, "not_promotable": True})
    prior_sha = write_json(runtime._admission_path("profile-base"), prior)
    reviews = {"base": runtime.HISTORICAL["base"]["reviews"], "current-20": runtime.HISTORICAL["current-20"]["reviews"]}
    inputs = runtime._receipt_inputs({"plan_sha256": PLAN, "admission_sha256": prior_sha, "admission": prior, "historical_base_receipt_sha256": runtime.HISTORICAL["base"]["receipt"], "historical_current20_receipt_sha256": runtime.HISTORICAL["current-20"]["receipt"], "historical_review_sha256": reviews, "profile_base_receipt_sha256": None, "audited_current20_checkpoint": dict(runtime.CHECKPOINT), "checkpoint": None, "code": CODE})
    root = runtime._profile_root("profile-base"); output = root / "output"; output.mkdir(parents=True)
    rows = []
    for seed in runtime.SEEDS:
        value = graph(); value["5"]["inputs"]["seed"] = seed; path = output / runtime.PNG_NAMES[seed]; png(path, value)
        rows.append({"row_id": f"profile-base-seed-{seed}", "seed": seed, "prompt_id": f"p{seed}", "output": {"filename": runtime.PNG_NAMES[seed], "bytes": path.stat().st_size, "sha256": runtime._sha(path.read_bytes())}})
    receipt = {"schema": runtime.SCHEMA, "status": "complete", "not_promotable": True, "stage": "profile-base", "inputs": inputs, "rows": rows, "teardown": {"verified_stopped": True}}
    if receipt_edit is not None: receipt_edit(receipt)
    receipt_sha = write_json(root / "receipt.json", receipt)
    digests = []
    for role in ("root", "independent"):
        review = {"schema": runtime.REVIEW_SCHEMA, "stage": "profile-base", "reviewer_role": role, "receipt_sha256": receipt_sha, "disposition": "continue", "not_promotable": True, "human_qa": False, "rows": [{"seed": row["seed"], "output_sha256": row["output"]["sha256"]} for row in rows]}
        if review_edit is not None: review_edit(role, review)
        digests.append(write_json(root / f"review-{role}.json", review))
    return {"profile_base_receipt_sha256": receipt_sha, "profile_base_png_sha256_by_seed": {str(row["seed"]): row["output"]["sha256"] for row in rows}, "profile_base_review_digests": digests}


def test_stage_is_closed_before_any_evidence_access():
    with pytest.raises(runtime.ProfileRuntimeError, match="stage"):
        runtime.validate("profile-current-50")


def test_fixed_roots_share_one_profile_prefix_for_producer_and_consumer(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path); monkeypatch.setattr(runtime, "STUDIO_PRIVATE", tmp_path / "studio")
    assert runtime._profile_root("profile-base") == tmp_path / "figment-local-lora-profile-base-20260908-v1"
    assert runtime._profile_root("profile-current-20") == tmp_path / "figment-local-lora-profile-current-20-20260908-v1"
    assert runtime._admission_id("profile-base") == "figment-local-lora-profile-base-20260908-v1"
    assert runtime._admission_path("profile-current-20") == tmp_path / "studio" / "figment-local-lora-profile-current-20-admission-20260908-v1" / "admission.json"
    with pytest.raises(runtime.ProfileRuntimeError, match="stage"):
        runtime._profile_root("base")


def test_execute_passes_fixed_base_root_to_shared_engine(tmp_path, monkeypatch):
    item = execute_item(dict(CODE)); captured = {}
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    monkeypatch.setattr(runtime, "validate", lambda _stage: item)
    monkeypatch.setattr(runtime, "_bound_modules", lambda: (object(), FakeEngine(captured), object(), dict(CODE)))
    result = runtime.execute(item)
    assert result["status"] == "complete"
    assert captured["root"] == runtime._profile_root("profile-base") == tmp_path / "figment-local-lora-profile-base-20260908-v1"
    assert captured["source"] is None and captured["maximum_output_entries"] == 3


def test_execute_refuses_controller_code_change_before_launch(tmp_path, monkeypatch):
    item = execute_item(dict(CODE)); captured = {}; changed = dict(CODE, controller_sha256="0" * 64)
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    monkeypatch.setattr(runtime, "validate", lambda _stage: item)
    monkeypatch.setattr(runtime, "_bound_modules", lambda: (object(), FakeEngine(captured), object(), changed))
    with pytest.raises(runtime.ProfileRuntimeError, match="differs from admitted"):
        runtime.execute(item)
    assert captured == {}


def test_execute_refuses_controller_code_change_before_success(tmp_path, monkeypatch):
    item = execute_item(dict(CODE)); captured = {}; current = {"code": dict(CODE)}
    def drift(): current["code"] = dict(CODE, controller_sha256="0" * 64)
    engine = FakeEngine(captured, before_success=drift)
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    monkeypatch.setattr(runtime, "validate", lambda _stage: item)
    monkeypatch.setattr(runtime, "_bound_modules", lambda: (object(), engine, object(), dict(current["code"])))
    with pytest.raises(runtime.ProfileRuntimeError, match="differs from admitted"):
        runtime.execute(item)
    assert captured["root"] == runtime._profile_root("profile-base")


def test_execute_refuses_admission_missing_controller_hash(tmp_path, monkeypatch):
    item = execute_item({key: value for key, value in CODE.items() if key != "controller_sha256"})
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    monkeypatch.setattr(runtime, "validate", lambda _stage: item)
    monkeypatch.setattr(runtime, "_bound_modules", lambda: (object(), FakeEngine({}), object(), dict(item["code"])))
    with pytest.raises(runtime.ProfileRuntimeError, match="differs from admitted"):
        runtime.execute(item)


def test_verified_helper_records_exact_embedded_graph(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    output = tmp_path / "output"; output.mkdir()
    expected = graph(); path = output / "row.png"; png(path, expected)
    class Helper:
        def _completed_output(self, _history, _prompt, _output):
            return {"filename": "row.png", "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "dimensions": [1024, 1024]}
    helper = runtime._VerifiedHelper(Helper(), [{"graph": expected}]); helper._pending["p1"] = expected
    completed = helper._completed_output({}, "p1", output)
    assert completed["verified_graph_sha256"] == runtime._sha(json.dumps(expected, sort_keys=True, separators=(",", ":")).encode())


def test_verified_helper_refuses_tampered_embedded_graph(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    output = tmp_path / "output"; output.mkdir(); expected = graph(); changed = json.loads(json.dumps(expected)); changed["5"]["inputs"]["seed"] = 1
    path = output / "row.png"; png(path, changed)
    class Helper:
        def _completed_output(self, *_args): return {"filename": "row.png"}
    helper = runtime._VerifiedHelper(Helper(), [{"graph": expected}]); helper._pending["p1"] = expected
    with pytest.raises(runtime.ProfileRuntimeError, match="differs"):
        helper._completed_output({}, "p1", output)


@pytest.mark.parametrize("node, key, value", [("4", "width", 1024.0), ("5", "denoise", True)])
def test_verified_helper_refuses_numeric_type_tampering(tmp_path, monkeypatch, node, key, value):
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    output = tmp_path / "output"; output.mkdir(); expected = graph(); changed = json.loads(json.dumps(expected)); changed[node]["inputs"][key] = value
    assert changed == expected
    path = output / "row.png"; png(path, changed)
    class Helper:
        def _completed_output(self, *_args): return {"filename": "row.png"}
    helper = runtime._VerifiedHelper(Helper(), [{"graph": expected}]); helper._pending["p1"] = expected
    with pytest.raises(runtime.ProfileRuntimeError, match="differs"):
        helper._completed_output({}, "p1", output)


def test_verified_helper_refuses_dispatch_graph_with_numeric_type_drift():
    expected = graph(); drifted = json.loads(json.dumps(expected)); drifted["5"]["inputs"]["denoise"] = True
    class Helper:
        def _local_json(self, *_args): return {"prompt_id": "p1"}
    helper = runtime._VerifiedHelper(Helper(), [{"graph": expected}])
    with pytest.raises(runtime.ProfileRuntimeError, match="dispatch graph"):
        helper._local_json(None, "POST", "/prompt", {"prompt": drifted})
    helper._local_json(None, "POST", "/prompt", {"prompt": json.loads(json.dumps(expected))})
    assert helper._pending["p1"] == expected


def test_verified_helper_refuses_png_with_nonadmitted_dimensions(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    output = tmp_path / "output"; output.mkdir(); expected = graph()
    path = output / "row.png"
    info = PngImagePlugin.PngInfo(); info.add_text("prompt", json.dumps(expected, sort_keys=True, separators=(",", ":")))
    Image.new("RGB", (512, 512)).save(path, pnginfo=info)
    class Helper:
        def _completed_output(self, *_args): return {"filename": "row.png"}
    helper = runtime._VerifiedHelper(Helper(), [{"graph": expected}]); helper._pending["p1"] = expected
    with pytest.raises(runtime.ProfileRuntimeError, match="embedded prompt"):
        helper._completed_output({}, "p1", output)


def test_receipt_inputs_bind_audited_checkpoint_and_all_historical_reviews():
    checkpoint = {"filename": "selected.safetensors", "sha256": "a" * 64}
    evidence = {
        "plan_sha256": "b" * 64,
        "admission_sha256": "c" * 64,
        "admission": {"admission_id": runtime._admission_id("profile-base")},
        "historical_base_receipt_sha256": "d" * 64,
        "historical_current20_receipt_sha256": "e" * 64,
        "historical_review_sha256": {"base": {"root": "f" * 64, "independent": "1" * 64}, "current-20": {"root": "2" * 64, "independent": "3" * 64}},
        "profile_base_receipt_sha256": None,
        "audited_current20_checkpoint": checkpoint,
        "checkpoint": None,
        "code": {"controller_sha256": "4" * 64, "pair_engine_sha256": "5" * 64},
    }
    inputs = runtime._receipt_inputs(evidence)
    assert inputs["current20_checkpoint"] == checkpoint
    assert inputs["historical_review_sha256"] == evidence["historical_review_sha256"]
    assert inputs["profile_admission_sha256"] == "c" * 64


def test_profile_base_stage_refuses_prior_profile_evidence():
    with pytest.raises(runtime.ProfileRuntimeError, match="prior profile evidence"):
        runtime._profile_base("profile-base", {"profile_base_receipt_sha256": "a" * 64, "profile_base_review_digests": []}, code=CODE, plan_sha256=PLAN)
    assert runtime._profile_base("profile-base", {"profile_base_receipt_sha256": None, "profile_base_review_digests": []}, code=CODE, plan_sha256=PLAN) == (None, None)


def test_profile_current20_gate_passes_with_produced_receipt_and_continuing_reviews(tmp_path, monkeypatch):
    admission = build_profile_base(tmp_path, monkeypatch)
    receipt_sha, outputs = runtime._profile_base("profile-current-20", admission, code=CODE, plan_sha256=PLAN)
    assert receipt_sha == admission["profile_base_receipt_sha256"]
    assert {str(seed): digest for seed, digest in outputs.items()} == admission["profile_base_png_sha256_by_seed"]
    assert list(outputs) == list(runtime.SEEDS)


def test_profile_current20_gate_refuses_stopped_review(tmp_path, monkeypatch):
    def stop(role, review):
        if role == "independent": review["disposition"] = "stop"
    admission = build_profile_base(tmp_path, monkeypatch, review_edit=stop)
    with pytest.raises(runtime.ProfileRuntimeError, match="continuing diagnostic"):
        runtime._profile_base("profile-current-20", admission, code=CODE, plan_sha256=PLAN)


def test_profile_current20_gate_refuses_misbound_review(tmp_path, monkeypatch):
    def swap(role, review):
        if role == "root": review["rows"][0]["output_sha256"], review["rows"][1]["output_sha256"] = review["rows"][1]["output_sha256"], review["rows"][0]["output_sha256"]
    admission = build_profile_base(tmp_path, monkeypatch, review_edit=swap)
    with pytest.raises(runtime.ProfileRuntimeError, match="PNG bindings"):
        runtime._profile_base("profile-current-20", admission, code=CODE, plan_sha256=PLAN)


def test_profile_current20_gate_refuses_receipt_not_bound_to_fixed_protocol(tmp_path, monkeypatch):
    def fabricate(receipt): receipt["inputs"]["controller_sha256"] = "0" * 64
    admission = build_profile_base(tmp_path, monkeypatch, receipt_edit=fabricate)
    with pytest.raises(runtime.ProfileRuntimeError, match="not bound to the fixed protocol"):
        runtime._profile_base("profile-current-20", admission, code=CODE, plan_sha256=PLAN)


def test_profile_current20_gate_refuses_code_drift_since_profile_base(tmp_path, monkeypatch):
    admission = build_profile_base(tmp_path, monkeypatch)
    with pytest.raises(runtime.ProfileRuntimeError, match="fixed protocol"):
        runtime._profile_base("profile-current-20", admission, code=dict(CODE, controller_sha256="0" * 64), plan_sha256=PLAN)


@pytest.mark.parametrize("edit", [lambda receipt: receipt["rows"].reverse(), lambda receipt: receipt["rows"][0]["output"].__setitem__("filename", "other.png"), lambda receipt: receipt["rows"][0].__setitem__("row_id", "profile-current-20-seed-481516234")])
def test_profile_current20_gate_enforces_fixed_png_names_and_seed_order(tmp_path, monkeypatch, edit):
    admission = build_profile_base(tmp_path, monkeypatch, receipt_edit=edit)
    with pytest.raises(runtime.ProfileRuntimeError, match="output binding is invalid"):
        runtime._profile_base("profile-current-20", admission, code=CODE, plan_sha256=PLAN)


def test_profile_current20_gate_refuses_admission_not_bound_to_reviews(tmp_path, monkeypatch):
    admission = build_profile_base(tmp_path, monkeypatch); admission["profile_base_review_digests"] = list(reversed(admission["profile_base_review_digests"]))
    with pytest.raises(runtime.ProfileRuntimeError, match="does not bind profile-base evidence"):
        runtime._profile_base("profile-current-20", admission, code=CODE, plan_sha256=PLAN)
