"""Offline, unauthenticated tensor video evidence inspection. Never grants admission.

Only bounded declared JSON/code metadata is read. No model/media loading, subprocesses,
approval verifiers, network clients or execution adapters are loaded.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat

HERE = Path(__file__).resolve().parent
REQUEST_SCHEMA = "figment/tensor-runtime-inspection-request@1"
REPORT_SCHEMA = "figment/tensor-runtime-inspection@1"
MIB = 1024 * 1024
MAX_IO = 64 * MIB
MAX_EVIDENCE = 24 * MIB
CAPS = {name: 4 * MIB for name in (
    "manifest", "run", "installed", "submitted_graph", "native_metadata", "recovery", "ledger")}
CAPS.update(object_info=8 * MIB, history=8 * MIB)
CURRENT_FILES = (
    "video/tensor_video_m08_api.json", "train/tensor-pins.yaml",
    "tensor_video_parity.py", "tensor_parity.py", "tensor_video.py",
    "pod/runpod_run.py", "tensor_runtime_admission.py",
)
HEX = re.compile(r"[0-9a-f]{64}\Z")
ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")


class InspectionError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def keys(value, wanted, label):
    if not isinstance(value, dict) or set(value) != set(wanted):
        raise InspectionError(label + ": exact object keys required")


def integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        raise InspectionError(label + ": integer out of bounds")


def identifier(value, label):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise InspectionError(label + ": invalid identifier")


def sha(value, label):
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise InspectionError(label + ": lowercase SHA256 required")


def array(value, maximum, label):
    if not isinstance(value, list) or len(value) > maximum:
        raise InspectionError(label + ": bounded list required")
    return value


def parse(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise InspectionError("duplicate JSON key")
            result[key] = value
        return result
    def constant(_value):
        raise InspectionError("nonfinite JSON number")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise InspectionError("invalid strict UTF-8 JSON") from exc
    pending, count = [(value, 0)], 0
    while pending:
        item, depth = pending.pop()
        count += 1
        if depth > 32 or count > 100000:
            raise InspectionError("JSON depth/item bound exceeded")
        if isinstance(item, dict):
            if any(len(key) > 1024 for key in item):
                raise InspectionError("JSON key bound exceeded")
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
        elif isinstance(item, str) and len(item) > 65536:
            raise InspectionError("JSON string bound exceeded")
        elif isinstance(item, float):
            import math
            if not math.isfinite(item):
                raise InspectionError("nonfinite JSON number")
    return value


def _chain(path):
    for part in (path, *path.parents):
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise InspectionError("reparse path refused")


def _identity(info):
    # Windows Python 3.13 lstat/fstat expose different ctime semantics.
    # Compare portable handle identity here; same-API ctime is checked below.
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)


class Reader:
    def __init__(self):
        self.used = 0
        self.snapshots = []

    def read(self, path, cap, *, remember=True):
        _chain(path)
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= cap:
            raise InspectionError("regular file size bound exceeded")
        if self.used + before.st_size > MAX_IO:
            raise InspectionError("aggregate I/O bound exceeded")
        data = bytearray()
        with path.open("rb") as handle:
            if _identity(os.fstat(handle.fileno())) != _identity(before):
                raise InspectionError("file changed before read")
            while len(data) < before.st_size:
                allowance = min(65536, before.st_size - len(data), MAX_IO - self.used)
                if allowance <= 0:
                    raise InspectionError("aggregate I/O or file bound exceeded")
                block = handle.read(allowance)
                self.used += len(block)
                if not block:
                    raise InspectionError("short file read")
                data.extend(block)
                if len(data) > cap:
                    raise InspectionError("file grew beyond bound")
            if _identity(os.fstat(handle.fileno())) != _identity(before):
                raise InspectionError("file changed during read")
        _chain(path)
        after = path.lstat()
        if (_identity(after) != _identity(before) or after.st_ctime_ns != before.st_ctime_ns
                or len(data) != before.st_size):
            raise InspectionError("file replaced during read")
        raw = bytes(data)
        if remember:
            self.snapshots.append((path, cap, hashlib.sha256(raw).hexdigest()))
        return raw

    def fresh(self):
        for path, cap, expected in self.snapshots:
            if hashlib.sha256(self.read(path, cap, remember=False)).hexdigest() != expected:
                raise InspectionError("evidence or current scope changed")


def relative(root, value):
    if (not isinstance(value, str) or not value or len(value) > 512
            or "\\" in value or ":" in value or "\x00" in value):
        raise InspectionError("unsafe evidence path")
    parts = value.split("/")
    if any(part in ("", ".", "..") or part.endswith((".", " ")) for part in parts):
        raise InspectionError("unsafe evidence path component")
    if PurePosixPath(value).is_absolute():
        raise InspectionError("absolute evidence reference")
    path = root.joinpath(*parts)
    if path.suffix != ".json":
        raise InspectionError("only explicit .json metadata references are allowed")
    _chain(path)
    path.resolve().relative_to(root)
    return path


def _current(reader):
    records, loaded, total = {}, {}, 0
    for name in CURRENT_FILES:
        raw = reader.read(HERE / name, 2 * MIB)
        total += len(raw)
        if total > 8 * MIB:
            raise InspectionError("current source aggregate bound exceeded")
        records[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        if name.endswith((".json", ".yaml")):
            loaded[name] = parse(raw)
    try:
        pins = loaded["train/tensor-pins.yaml"]
        graph = loaded["video/tensor_video_m08_api.json"]
        scope = {"schema": "figment/tensor-runtime-inspection-scope@1", "stage": "video",
                 "recipe_profile": "tensor", "files": records,
                 "runtime": pins["pod_classes"]["l40s"]["stages"]["video_tensor"]["comfyui"],
                 "pins": pins["pins"]["video_tensor"], "graph_sha256": digest(graph),
                 "classes": sorted({node["class_type"] for node in graph.values()})}
        group, runtime = scope["pins"], scope["runtime"]
        if not isinstance(group, dict) or not {"models", "custom_nodes"}.issubset(group):
            raise InspectionError("current code-owned scope has invalid pin group")
        if not isinstance(runtime, dict) or not {"git_ref", "source_url", "tarball_url"}.issubset(runtime):
            raise InspectionError("current code-owned scope has invalid runtime")
        models = array(group["models"], 128, "current models")
        if not models:
            raise InspectionError("current code-owned scope has no models")
        for model in models:
            if not isinstance(model, dict) or not {"filename", "revision", "sha256"}.issubset(model):
                raise InspectionError("current code-owned scope has malformed model")
            if not isinstance(model["filename"], str) or not isinstance(model["revision"], str):
                raise InspectionError("current code-owned model identifiers malformed")
            sha(model["sha256"], "current model")
        _rows(group["custom_nodes"], ("name", "git_url", "git_ref", "licence"), 64, "current custom nodes", "name")
        for node in graph.values():
            if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict) or not isinstance(node.get("class_type"), str):
                raise InspectionError("current code-owned graph malformed")
        return scope, graph
    except (KeyError, TypeError, AttributeError) as exc:
        raise InspectionError("current code-owned scope is malformed") from exc


def current_scope():
    """Fixed local code-owned scope; callers cannot select source paths or pins."""
    reader = Reader()
    scope, _ = _current(reader)
    reader.fresh()
    return scope


def _rows(value, fields, maximum, label, unique):
    seen = set()
    for row in array(value, maximum, label):
        keys(row, fields, label)
        key = row[unique]
        if not isinstance(key, str) or len(key) > 512 or key.casefold() in seen:
            raise InspectionError(label + ": duplicate/invalid identifier")
        seen.add(key.casefold())
    return value


def _structural(doc, scope, template, block):
    manifest, run, installed = doc["manifest"], doc["run"], doc["installed"]
    # These are closed inspection projections, not replacements for canonical receipts.
    keys(manifest, ("schema", "attempt_id", "workflow", "pins", "runtime", "output_contract"), "manifest")
    keys(run, ("schema", "attempt_id", "pod_id", "prompt_id", "dry_run", "error", "termination_verified", "movie"), "run")
    keys(installed, ("schema", "attempt_id", "pod_id", "runtime", "models", "custom_nodes"), "installed")
    schemas = {"manifest": "figment/tensor-inspection-manifest@1", "run": "figment/tensor-inspection-run@1",
               "installed": "figment/tensor-installed-runtime@1", "object_info": "figment/tensor-object-info-capture@1",
               "history": "figment/tensor-inspection-history@1", "native_metadata": "figment/tensor-inspection-native@1",
               "recovery": "figment/tensor-inspection-recovery@1", "ledger": "figment/tensor-inspection-ledger@1"}
    for name, schema in schemas.items():
        if doc[name].get("schema") != schema:
            raise InspectionError(name + ": unsupported schema")
    for name in ("attempt_id", "pod_id", "prompt_id"):
        identifier(run[name], name)
    for flag in ("dry_run", "termination_verified"):
        if type(run[flag]) is not bool:
            raise InspectionError("run flags must be Boolean")
    if run["error"] is not None and (not isinstance(run["error"], str) or len(run["error"]) > 1024):
        raise InspectionError("invalid run error")
    if run["dry_run"] or run["error"] or not run["termination_verified"]:
        block("run-not-successful-nondry-terminated")
    for value in (manifest, installed):
        if value["attempt_id"] != run["attempt_id"]:
            block("attempt-mismatch")
    if installed["pod_id"] != run["pod_id"]:
        block("installed-pod-mismatch")
    if canonical(manifest["pins"]) != canonical(scope["pins"]) or canonical(manifest["runtime"]) != canonical(scope["runtime"]):
        block("manifest-current-pins-runtime-mismatch")
    if canonical(installed["runtime"]) != canonical(scope["runtime"]):
        block("installed-runtime-declaration-mismatch")
    models = _rows(installed["models"], ("filename", "revision", "sha256", "bytes"), 128, "models", "filename")
    expected = {row["filename"]:row for row in scope["pins"]["models"]}
    if {row["filename"] for row in models} != set(expected):
        block("installed-model-inventory-mismatch")
    for row in models:
        sha(row["sha256"], "model")
        integer(row["bytes"], 1, 2**50, "model bytes metadata")
        wanted = expected.get(row["filename"], {})
        if any(row[key] != wanted.get(key) for key in ("revision", "sha256")):
            block("installed-model-pin-mismatch")
    _rows(installed["custom_nodes"], ("name", "git_url", "git_ref", "licence"), 64, "custom nodes", "name")
    if canonical(installed["custom_nodes"]) != canonical(scope["pins"]["custom_nodes"]):
        block("installed-custom-node-declaration-mismatch")
    contract = manifest["output_contract"]
    keys(contract, ("schema", "outputs"), "output contract")
    expected_contract = {"schema": "figment/comfy-output-contract@1", "outputs": [{
        "node_id": "49", "role": "video", "media_type": "video/mp4", "count": 1,
        "max_bytes": 512 * MIB, "workflow_png": False}]}
    if canonical(contract) != canonical(expected_contract):
        block("output-contract-mismatch")
    graph = doc["submitted_graph"]
    if canonical(graph) != canonical(manifest["workflow"]):
        block("submitted-manifest-graph-mismatch")
    if not isinstance(graph, dict) or set(graph) != set(template):
        raise InspectionError("submitted graph node inventory mismatch")
    for node, expected_node in template.items():
        actual = graph[node]
        keys(actual, expected_node, "graph node")
        if canonical(actual.get("_meta")) != canonical(expected_node.get("_meta")):
            block("graph-editor-metadata-mismatch")
        if actual["class_type"] != expected_node["class_type"]:
            block("graph-class-mismatch")
        keys(actual["inputs"], expected_node["inputs"], "graph inputs")
        for field, wanted in expected_node["inputs"].items():
            got = actual["inputs"][field]
            if (node, field) in (("113", "video"), ("58", "image"), ("6", "text"), ("49", "filename_prefix")):
                if not isinstance(got, str) or not got.strip() or len(got) > 16000:
                    block("graph-request-field-invalid")
            elif canonical(got) != canonical(wanted):
                block("graph-source-widget-or-link-mismatch")
    objects = doc["object_info"]
    keys(objects, ("schema", "attempt_id", "pod_id", "classes"), "object info")
    classes = _rows(objects["classes"], ("class_type", "inputs", "output_count"), 256, "classes", "class_type")
    found = {row["class_type"]:row for row in classes}
    if set(found) != set(scope["classes"]):
        block("required-class-inventory-mismatch")
    for row in classes:
        integer(row["output_count"], 0, 128, "output count")
        if (not isinstance(row["inputs"], list) or len(row["inputs"]) > 256
                or any(not isinstance(field, str) or len(field) > 256 for field in row["inputs"])
                or len(set(row["inputs"])) != len(row["inputs"])):
            raise InspectionError("invalid input-name projection")
    for node in graph.values():
        declared = found.get(node["class_type"])
        if declared is None or not set(node["inputs"]).issubset(declared["inputs"]):
            block("declared-input-name-mismatch")
        for value in node["inputs"].values():
            if isinstance(value, list) and len(value) == 2:
                source, slot = value
                if not isinstance(source, str) or source not in graph or type(slot) is not int:
                    block("graph-link-invalid")
                else:
                    source_class = found.get(graph[source]["class_type"])
                    if source_class is None or not 0 <= slot < source_class["output_count"]:
                        block("declared-output-slot-mismatch")
    history = doc["history"]
    keys(history, ("schema", "attempt_id", "pod_id", "prompt_id", "graph_sha256", "movie"), "history")
    native = doc["native_metadata"]
    keys(native, ("schema", "attempt_id", "pod_id", "prompt_id", "graph_sha256", "movie", "codec", "fps", "frames"), "native")
    for row in (objects, history, native):
        if row["attempt_id"] != run["attempt_id"] or row["pod_id"] != run["pod_id"]:
            block("capture-attempt-pod-mismatch")
    for row in (history, native):
        if row["prompt_id"] != run["prompt_id"] or row["graph_sha256"] != digest(graph):
            block("capture-prompt-graph-mismatch")
        if canonical(row["movie"]) != canonical(run["movie"]):
            block("movie-declaration-mismatch")
    keys(run["movie"], ("sha256", "bytes", "node_id", "role", "media_type"), "movie metadata")
    sha(run["movie"]["sha256"], "movie")
    integer(run["movie"]["bytes"], 1, 512 * MIB, "movie bytes metadata")
    if (run["movie"]["node_id"], run["movie"]["role"], run["movie"]["media_type"]) != ("49", "video", "video/mp4"):
        block("movie-output-role-mismatch")
    if native["codec"] != "h264" or type(native["fps"]) is not int or native["fps"] != 16 or type(native["frames"]) is not int or native["frames"] != 81:
        block("native-media-declaration-mismatch")
    recovery, ledger = doc["recovery"], doc["ledger"]
    keys(recovery, ("schema", "attempt_id", "placements"), "recovery")
    keys(ledger, ("schema", "attempt_id", "placements"), "ledger")
    for row in (recovery, ledger):
        if row["attempt_id"] != run["attempt_id"]:
            block("terminal-attempt-mismatch")
    placements = _rows(recovery["placements"], ("pod_id", "absence_verified"), 16, "recovery placements", "pod_id")
    costs = _rows(ledger["placements"], ("pod_id", "usd_micros"), 16, "ledger placements", "pod_id")
    if not placements or run["pod_id"] not in {row["pod_id"] for row in placements}:
        block("terminal-pod-missing")
    if {row["pod_id"] for row in placements} != {row["pod_id"] for row in costs}:
        block("ledger-placement-inventory-mismatch")
    for row in placements:
        if row["absence_verified"] is not True:
            block("termination-declaration-incomplete")
    for row in costs:
        integer(row["usd_micros"], 0, 75_000_000, "cost metadata")


def inspect_request(request_path, evidence_root):
    """Inspect declarations only. Report never grants approval or runtime authority."""
    reader = Reader()
    root = Path(os.path.abspath(evidence_root))
    _chain(root)
    if not root.is_dir():
        raise InspectionError("caller evidence root must be a directory")
    path = Path(os.path.abspath(request_path))
    path.relative_to(root)
    if path.suffix != ".json":
        raise InspectionError("request must be a .json metadata file")
    request = parse(reader.read(path, MIB))
    keys(request, ("schema", "stage", "recipe_profile", "fixture", "evidence_root", "current_scope_sha256", "sources"), "request")
    if request["schema"] != REQUEST_SCHEMA or request["stage"] != "video" or request["recipe_profile"] != "tensor":
        raise InspectionError("unsupported inspection request")
    if type(request["fixture"]) is not bool:
        raise InspectionError("fixture must be Boolean")
    if not isinstance(request["evidence_root"], str) or request["evidence_root"] != root.as_posix():
        raise InspectionError("request cannot select or widen caller evidence root")
    sha(request["current_scope_sha256"], "current scope")
    keys(request["sources"], CAPS, "sources")
    total, seen, doc = 0, set(), {}
    for name, cap in CAPS.items():
        binding = request["sources"][name]
        keys(binding, ("path", "bytes", "sha256"), name + " binding")
        integer(binding["bytes"], 1, cap, name + " bytes")
        sha(binding["sha256"], name)
        operand = relative(root, binding["path"])
        folded = str(operand).casefold()
        if folded in seen or operand == path:
            raise InspectionError("duplicate/colliding evidence path")
        seen.add(folded)
        total += binding["bytes"]
        if total > MAX_EVIDENCE:
            raise InspectionError("aggregate evidence bound exceeded")
        raw = reader.read(operand, cap)
        if len(raw) != binding["bytes"] or hashlib.sha256(raw).hexdigest() != binding["sha256"]:
            raise InspectionError("evidence binding mismatch")
        doc[name] = parse(raw)
        if not isinstance(doc[name], dict):
            raise InspectionError("evidence must be an object")
    scope, graph = _current(reader)
    blockers = set()
    if request["current_scope_sha256"] != digest(scope):
        blockers.add("current-scope-mismatch")
    _structural(doc, scope, graph, blockers.add)
    reader.fresh()
    return {"schema": REPORT_SCHEMA, "runtime_admitted": False, "production_ready": False,
            "authority_status": "authority-unavailable", "fixture": request["fixture"],
            "evidence_consistent": not blockers, "blockers": sorted(blockers),
            "current_scope_sha256": digest(scope), "current_scope": scope,
            "request_sha256": digest(request), "sources": request["sources"],
            "read_bytes": reader.used,
            "limitations": ["Unauthenticated bounded declared JSON metadata only; no model or media loading.",
                            "No actual media decode or installed schema execution performed.",
                            "No authenticated approval, capture or termination validation performed.",
                            "Path checks detect stable reparse paths and ordinary mutation; not OS-enforced hostile-writer confinement.",
                            "All production launch and acceptance guards remain unchanged."]}
