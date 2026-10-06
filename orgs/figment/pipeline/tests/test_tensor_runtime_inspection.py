"""Synthetic metadata only: no test establishes real runtime admission."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys

import pytest

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("inspection_under_test", HERE / "tensor_runtime_admission.py")
inspect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspect)


def write(path, value):
    path.write_bytes(inspect.canonical(value))


def bind(path):
    data = path.read_bytes()
    return {"path": path.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def save(root, request, documents):
    for role, value in documents.items():
        path = root / (role + ".json")
        write(path, value)
        request["sources"][role] = bind(path)
    write(root / "request.json", request)


@pytest.fixture
def bundle(tmp_path):
    scope = inspect.current_scope()
    graph = json.loads((HERE / "video/tensor_video_m08_api.json").read_text("utf-8"))
    graph["6"]["inputs"]["text"] = "Synthetic clothed adult motion scene."
    graph["58"]["inputs"]["image"] = "creator-003/frame.png"
    graph["113"]["inputs"]["video"] = "creator-003/clip.mp4"
    graph["49"]["inputs"]["filename_prefix"] = "fixture-native"
    common = {"attempt_id": "attempt-1", "pod_id": "pod-1"}
    movie = {"sha256": "a" * 64, "bytes": 128, "node_id": "49", "role": "video", "media_type": "video/mp4"}
    classes = {}
    for node in graph.values():
        row = classes.setdefault(node["class_type"], {"class_type": node["class_type"], "inputs": set(), "output_count": 8})
        row["inputs"].update(node["inputs"])
    for row in classes.values():
        row["inputs"] = sorted(row["inputs"])
    documents = {
        "manifest": {"schema": "figment/tensor-inspection-manifest@1", "attempt_id": "attempt-1",
            "workflow": graph, "pins": scope["pins"], "runtime": scope["runtime"],
            "output_contract": {"schema": "figment/comfy-output-contract@1", "outputs": [{
                "node_id": "49", "role": "video", "media_type": "video/mp4", "count": 1,
                "max_bytes": 512 * inspect.MIB, "workflow_png": False}]}},
        "run": {"schema": "figment/tensor-inspection-run@1", **common, "prompt_id": "prompt-1",
                "dry_run": False, "error": None, "termination_verified": True, "movie": movie},
        "installed": {"schema": "figment/tensor-installed-runtime@1", **common,
            "runtime": scope["runtime"], "models": [{**{k:m[k] for k in ("filename", "revision", "sha256")}, "bytes": 42}
                for m in scope["pins"]["models"]], "custom_nodes": scope["pins"]["custom_nodes"]},
        "object_info": {"schema": "figment/tensor-object-info-capture@1", **common, "classes": list(classes.values())},
        "submitted_graph": graph,
        "history": {"schema": "figment/tensor-inspection-history@1", **common,
                    "prompt_id": "prompt-1", "graph_sha256": inspect.digest(graph), "movie": movie},
        "native_metadata": {"schema": "figment/tensor-inspection-native@1", **common,
                    "prompt_id": "prompt-1", "graph_sha256": inspect.digest(graph), "movie": movie,
                    "codec": "h264", "fps": 16, "frames": 81},
        "recovery": {"schema": "figment/tensor-inspection-recovery@1", "attempt_id": "attempt-1",
                     "placements": [{"pod_id": "pod-1", "absence_verified": True}]},
        "ledger": {"schema": "figment/tensor-inspection-ledger@1", "attempt_id": "attempt-1",
                   "placements": [{"pod_id": "pod-1", "usd_micros": 1000}]},
    }
    request = {"schema": inspect.REQUEST_SCHEMA, "stage": "video", "recipe_profile": "tensor",
               "fixture": True, "evidence_root": tmp_path.as_posix(),
               "current_scope_sha256": inspect.digest(scope), "sources": {}}
    save(tmp_path, request, documents)
    return tmp_path, request, documents


def test_consistent_metadata_never_grants_authority_or_reads_weights(bundle, monkeypatch):
    root, request, docs = bundle
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("subprocess"))
    monkeypatch.setattr(socket, "socket", lambda *a, **k: pytest.fail("network"))
    original = inspect.Reader.read
    reads = []
    def read(self, path, *a, **k):
        reads.append(path)
        return original(self, path, *a, **k)
    monkeypatch.setattr(inspect.Reader, "read", read)
    for fixture in (True, False):
        request["fixture"] = fixture
        write(root / "request.json", request)
        report = inspect.inspect_request(root / "request.json", root)
        assert report["evidence_consistent"] is True
        assert report["runtime_admitted"] is report["production_ready"] is False
        assert report["authority_status"] == "authority-unavailable"
        assert report["read_bytes"] < inspect.MAX_IO
        assert all(path.suffix in (".json", ".yaml", ".py") for path in reads)
        assert "No actual media decode" in " ".join(report["limitations"])


@pytest.mark.parametrize("role,field,value,blocker", [
    ("run", "dry_run", True, "run-not-successful-nondry-terminated"),
    ("run", "error", "failed", "run-not-successful-nondry-terminated"),
    ("run", "termination_verified", False, "run-not-successful-nondry-terminated"),
    ("installed", "pod_id", "other", "installed-pod-mismatch"),
    ("history", "prompt_id", "other", "capture-prompt-graph-mismatch"),
    ("native_metadata", "graph_sha256", "b" * 64, "capture-prompt-graph-mismatch"),
    ("native_metadata", "fps", 24, "native-media-declaration-mismatch"),
    ("recovery", "placements", [], "terminal-pod-missing"),
    ("ledger", "placements", [], "ledger-placement-inventory-mismatch"),
    ("object_info", "classes", [], "required-class-inventory-mismatch"),
])
def test_coherently_rehashed_evidence_mutations_remain_inconsistent(bundle, role, field, value, blocker):
    root, request, docs = bundle
    docs[role][field] = value
    save(root, request, docs)
    result = inspect.inspect_request(root / "request.json", root)
    assert result["evidence_consistent"] is False and blocker in result["blockers"]
    assert result["runtime_admitted"] is False


@pytest.mark.parametrize("mutation", ["scope", "graph", "pin", "contract", "model", "slot"])
def test_current_source_and_structural_projection(bundle, mutation):
    root, request, docs = bundle
    if mutation == "scope": request["current_scope_sha256"] = "0" * 64
    if mutation == "graph": docs["submitted_graph"]["3"]["inputs"]["seed"] = 124
    if mutation == "pin": docs["manifest"]["runtime"]["git_ref"] = "0" * 40
    if mutation == "contract": docs["manifest"]["output_contract"]["outputs"][0]["count"] = True
    if mutation == "model": docs["installed"]["models"][0]["sha256"] = "0" * 64
    if mutation == "slot":
        for row in docs["object_info"]["classes"]: row["output_count"] = 0
    save(root, request, docs)
    assert inspect.inspect_request(root / "request.json", root)["evidence_consistent"] is False


@pytest.mark.parametrize("mutation", ["root", "traversal", "absolute", "backslash", "casecollision", "unknown", "boolbytes", "fixturetype", "modelpath", "schema"])
def test_closed_request_and_metadata_contract(bundle, mutation):
    root, request, docs = bundle
    if mutation == "root": request["evidence_root"] = root.parent.as_posix()
    if mutation == "unknown": request["approved"] = True
    if mutation == "fixturetype": request["fixture"] = 1
    if mutation == "schema": request["schema"] += "unknown"
    if mutation == "modelpath":
        docs["installed"]["models"][0]["path"] = "secret.safetensors"
        save(root, request, docs)
    binding = request["sources"]["manifest"]
    if mutation == "traversal": binding["path"] = "../manifest.json"
    if mutation == "absolute": binding["path"] = "/manifest.json"
    if mutation == "backslash": binding["path"] = "a\\manifest.json"
    if mutation == "casecollision": request["sources"]["run"]["path"] = "MANIFEST.JSON"
    if mutation == "boolbytes": binding["bytes"] = True
    write(root / "request.json", request)
    with pytest.raises((inspect.InspectionError, OSError, ValueError)):
        inspect.inspect_request(root / "request.json", root)


@pytest.mark.parametrize("raw", [b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":1e999}', b'\xff', b'[' * 34 + b'0' + b']' * 34])
def test_strict_json(raw):
    with pytest.raises(inspect.InspectionError): inspect.parse(raw)


@pytest.mark.parametrize("limit", ["io", "aggregate", "file"])
def test_finite_bounds(bundle, monkeypatch, limit):
    root, request, _ = bundle
    if limit == "io": monkeypatch.setattr(inspect, "MAX_IO", 100)
    if limit == "aggregate": monkeypatch.setattr(inspect, "MAX_EVIDENCE", 1)
    if limit == "file":
        request["sources"]["manifest"]["bytes"] = inspect.CAPS["manifest"] + 1
        write(root / "request.json", request)
    with pytest.raises(inspect.InspectionError): inspect.inspect_request(root / "request.json", root)


def test_final_freshness_refuses_coherent_request_replacement(bundle, monkeypatch):
    root, request, _ = bundle
    original = inspect._structural
    def replace(*args):
        original(*args)
        request["fixture"] = False
        write(root / "request.json", request)
    monkeypatch.setattr(inspect, "_structural", replace)
    with pytest.raises(inspect.InspectionError, match="changed"):
        inspect.inspect_request(root / "request.json", root)


def test_reparse_metadata_rejected_without_reading_target(bundle, monkeypatch):
    root, _, _ = bundle
    original = inspect.Path.lstat
    class Info:
        st_mode = 0o100644
        st_file_attributes = 0x400
    monkeypatch.setattr(inspect.Path, "lstat", lambda p: Info() if p == root / "manifest.json" else original(p))
    with pytest.raises(inspect.InspectionError, match="reparse"):
        inspect.inspect_request(root / "request.json", root)


def test_import_has_no_operational_side_effects(monkeypatch):
    monkeypatch.setattr(Path, "open", lambda *a, **k: pytest.fail("evidence read on import"))
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("process on import"))
    monkeypatch.setattr(socket, "socket", lambda *a, **k: pytest.fail("network on import"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


def test_inspect_cli_alternate_cwd_json_only_no_writes(bundle):
    root, _, _ = bundle
    before = {p.name:p.read_bytes() for p in root.iterdir()}
    result = subprocess.run([sys.executable, "-B", str(HERE / "figment_train.py"), "runtime-admission", "inspect",
        "--request", str(root / "request.json"), "--evidence-root", str(root)], cwd=root.parent,
        capture_output=True, text=True)
    assert result.returncode == 2, result.stderr
    report = json.loads(result.stdout)
    assert report["schema"] == "figment/tensor-runtime-inspection@1"
    assert report["evidence_consistent"] is True and report["authority_status"] == "authority-unavailable"
    assert {p.name:p.read_bytes() for p in root.iterdir()} == before
    for command in ("validate", "launch"):
        rejected = subprocess.run([sys.executable, "-B", str(HERE / "figment_train.py"), "runtime-admission", command],
                                  cwd=root.parent, capture_output=True, text=True)
        assert rejected.returncode != 0


def test_exact_aggregate_read_budget_needs_no_eof_probe(bundle, monkeypatch):
    root, _, _ = bundle
    baseline = inspect.inspect_request(root / "request.json", root)
    monkeypatch.setattr(inspect, "MAX_IO", baseline["read_bytes"])
    exact = inspect.inspect_request(root / "request.json", root)
    assert exact["read_bytes"] == baseline["read_bytes"]
    monkeypatch.setattr(inspect, "MAX_IO", baseline["read_bytes"] - 1)
    with pytest.raises(inspect.InspectionError, match="aggregate"):
        inspect.inspect_request(root / "request.json", root)


def test_file_size_boundary_and_short_read(tmp_path, monkeypatch):
    path = tmp_path / "exact.json"
    path.write_bytes(b"{}")
    assert inspect.Reader().read(path, 2) == b"{}"
    with pytest.raises(inspect.InspectionError): inspect.Reader().read(path, 1)
    original = inspect.os.fstat
    def changed(fd):
        info = original(fd)
        class Changed:
            st_dev = info.st_dev
            st_ino = info.st_ino + 1
            st_size = info.st_size
            st_mtime_ns = info.st_mtime_ns
        return Changed()
    monkeypatch.setattr(inspect.os, "fstat", changed)
    with pytest.raises(inspect.InspectionError, match="before read"):
        inspect.Reader().read(path, 2)


def test_invalid_cli_input_reports_unavailable_without_creator(bundle):
    root, request, _ = bundle
    request["evidence_root"] = root.parent.as_posix()
    write(root / "request.json", request)
    for source in (root / "request.json", root / "missing.json"):
        result = subprocess.run([sys.executable, "-B", str(HERE / "figment_train.py"), "runtime-admission", "inspect",
            "--request", str(source), "--evidence-root", str(root)], cwd=root.parent, capture_output=True, text=True)
        assert result.returncode == 2
        report = json.loads(result.stdout)
        assert report["evidence_consistent"] is report["runtime_admitted"] is False
        assert report["authority_status"] == "authority-unavailable"


@pytest.mark.parametrize("mutation", ["custom65", "customduplicate", "customkeys"])
def test_custom_node_inventory_is_closed_and_bounded(bundle, mutation):
    root, request, docs = bundle
    first = docs["installed"]["custom_nodes"][0]
    if mutation == "custom65": docs["installed"]["custom_nodes"] = [{**first, "name":str(i)} for i in range(65)]
    if mutation == "customduplicate": docs["installed"]["custom_nodes"] = [first, copy.deepcopy(first)]
    if mutation == "customkeys": first["approved"] = True
    save(root, request, docs)
    with pytest.raises(inspect.InspectionError): inspect.inspect_request(root / "request.json", root)


@pytest.mark.parametrize("mutation", ["graphbool", "graphfloat", "moviebool"])
def test_canonical_type_strict_cross_document_comparison(bundle, mutation):
    root, request, docs = bundle
    if mutation.startswith("graph"):
        docs["manifest"]["workflow"] = copy.deepcopy(docs["submitted_graph"])
        assert docs["submitted_graph"]["3"]["inputs"]["cfg"] == 1
        docs["manifest"]["workflow"]["3"]["inputs"]["cfg"] = True if mutation == "graphbool" else 1.0
    else:
        docs["run"]["movie"]["bytes"] = 1
        docs["history"]["movie"] = {**docs["run"]["movie"], "bytes":True}
    save(root, request, docs)
    result = inspect.inspect_request(root / "request.json", root)
    assert result["evidence_consistent"] is False
    assert ("submitted-manifest-graph-mismatch" if mutation.startswith("graph") else "movie-declaration-mismatch") in result["blockers"]


@pytest.mark.parametrize("suffix", [".safetensors", ".mp4", ".pt", ".png"])
def test_binary_named_binding_refuses_before_open(bundle, monkeypatch, suffix):
    root, request, docs = bundle
    path = root / ("metadata" + suffix)
    path.write_bytes(inspect.canonical(docs["installed"]))
    request["sources"]["installed"] = bind(path)
    write(root / "request.json", request)
    original = inspect.Reader.read
    def read(self, operand, *args, **kwargs):
        assert operand != path, "binary-named operand must not be opened"
        return original(self, operand, *args, **kwargs)
    monkeypatch.setattr(inspect.Reader, "read", read)
    with pytest.raises(inspect.InspectionError, match=".json metadata"):
        inspect.inspect_request(root / "request.json", root)


@pytest.mark.parametrize("node,field", [("6", "text"), ("113", "video"), ("58", "image"), ("49", "filename_prefix")])
def test_whitespace_request_fields_are_not_consistent(bundle, node, field):
    root, request, docs = bundle
    docs["submitted_graph"][node]["inputs"][field] = "   "
    save(root, request, docs)
    assert "graph-request-field-invalid" in inspect.inspect_request(root / "request.json", root)["blockers"]


def test_malformed_current_scope_is_controlled_error(bundle, monkeypatch):
    root, _, _ = bundle
    original = inspect.Reader.read
    def read(self, path, *args, **kwargs):
        if path == HERE / "train/tensor-pins.yaml": return b"{}"
        return original(self, path, *args, **kwargs)
    monkeypatch.setattr(inspect.Reader, "read", read)
    with pytest.raises(inspect.InspectionError, match="current code-owned scope"):
        inspect.inspect_request(root / "request.json", root)


@pytest.mark.parametrize("invalid", [{}, [], {"models":[], "custom_nodes":[]}])
def test_malformed_current_nested_pin_group_is_controlled(bundle, monkeypatch, invalid):
    root, _, _ = bundle
    original = inspect.Reader.read
    def read(self, path, *args, **kwargs):
        raw = original(self, path, *args, **kwargs)
        if path == HERE / "train/tensor-pins.yaml":
            value = json.loads(raw)
            value["pins"]["video_tensor"] = invalid
            return inspect.canonical(value)
        return raw
    monkeypatch.setattr(inspect.Reader, "read", read)
    with pytest.raises(inspect.InspectionError, match="current code-owned scope"):
        inspect.inspect_request(root / "request.json", root)
