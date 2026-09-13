"""Independent lineage parity, lazy-image, and real isolated-runtime checks."""
from __future__ import annotations

import builtins
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import textwrap
from types import SimpleNamespace

import pytest
from PIL import Image


PIPELINE = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


lineage = load("figment_observed_lineage_tests", PIPELINE / "lineage.py")
observed = load("figment_observed_lineage_policy_tests", PIPELINE / "observed_reads.py")


def subject_inputs(root):
    paths = []
    for name in ("actual-plan.json", "manifest-b.json", "manifest-a.json", "image-b.png", "image-a.png", "anchor-b.png", "anchor-a.png", "thresholds.json", "scores.json"):
        path = root / name
        path.write_bytes(json.dumps({"synthetic": name}).encode("utf-8"))
        paths.append(path)
    training = {"steps": 600, "nested": {"rate": 1}, "dataset_dir": "excluded", "chosen_checkpoint_step": 200, "chosen_checkpoint_sha256": "excluded", "chosen_checkpoint_approval": {"excluded": True}}
    persona = {"id": "creator-001", "_persona_path": "excluded", "training": deepcopy(training), "description": "synthetic only"}
    args = dict(creator="creator-001", stage="gen", plan_path=paths[0],
                manifest_paths=paths[1:3], images=[{"image_id": "b", "path": str(paths[3])}, {"image_id": "a", "path": str(paths[4])}],
                anchors=paths[5:7], persona=persona, training=training,
                threshold_path=paths[7], score_path=paths[8],
                checkpoint_inputs={"path": "not-a-file-operand", "retained": [1, {"x": 2}]})
    return paths, args


def reader_for(root, paths):
    return observed.ObservedReads(roots=(root,), members=tuple(observed.ReadMember(path, 1024, allow_json=True) for path in paths))


def test_real_policy_subject_parity_names_order_projections_and_domain_check(tmp_path):
    paths, args = subject_inputs(tmp_path)
    original = deepcopy(args)
    baseline = lineage.review_subject(**args)
    reader = reader_for(tmp_path, paths)
    actual = lineage.review_subject(**args, reads=reader)
    assert actual == baseline
    assert lineage.canonical_sha256(actual) == lineage.canonical_sha256(baseline)
    assert actual["plan"]["name"] == "plan.json"
    assert [row["name"] for row in actual["manifests"]] == ["manifest-b.json", "manifest-a.json"]
    assert [row["image_id"] for row in actual["images"]] == ["b", "a"]
    assert [row["name"] for row in actual["anchors"]] == ["anchor-b.png", "anchor-a.png"]
    assert actual["training"] == {"steps": 600, "nested": {"rate": 1}}
    assert "_persona_path" not in actual["persona"]
    assert actual["persona"]["training"] == actual["training"]
    assert args == original
    actual["checkpoint_inputs"]["retained"][1]["x"] = 9
    assert args["checkpoint_inputs"]["retained"][1]["x"] == 2
    record = lineage.wrap_subject(lineage.APPROVAL_SCHEMA, baseline)
    lineage.assert_current(record, baseline, label="synthetic")
    with pytest.raises(lineage.LineageError, match="stale"):
        lineage.assert_current(record, {**baseline, "stage": "other"}, label="synthetic")
    with pytest.raises(lineage.LineageError, match="corrupt"):
        lineage.assert_current({**record, "subject_sha256": "0" * 64}, baseline, label="synthetic")
    reader.recheck()
    with pytest.raises(observed.ObservedReadError):
        reader.file(paths[0])


def test_lineage_caller_owns_final_recheck(tmp_path):
    paths, args = subject_inputs(tmp_path)
    reader = reader_for(tmp_path, paths)
    lineage.review_subject(**args, reads=reader)
    assert reader.file(paths[0], required=True).size > 0
    before = paths[3].stat()
    paths[3].write_bytes(b"changed synthetic image")
    os.utime(paths[3], ns=(before.st_atime_ns, before.st_mtime_ns + 2_000_000_000))
    with pytest.raises(observed.ObservedReadError):
        reader.recheck()


@pytest.mark.parametrize("name", [None, "", "custom-display"])
def test_file_entry_default_name_and_hash_parity(tmp_path, name):
    path = tmp_path / "actual.dat"
    path.write_bytes(b"synthetic")
    baseline = lineage.file_entry(path, name=name)
    reader = reader_for(tmp_path, [path])
    assert lineage.file_entry(path, name=name, reads=reader) == baseline
    assert lineage.sha256_file(path, reads=reader) == lineage.sha256_file(path)
    reader.recheck()


@pytest.mark.parametrize("empty", [False, True])
def test_default_missing_and_empty_file_errors_remain(tmp_path, empty):
    path = tmp_path / "input"
    if empty:
        path.write_bytes(b"")
    with pytest.raises(lineage.LineageError, match="missing or empty"):
        lineage.file_entry(path)
    reader = reader_for(tmp_path, [path])
    with pytest.raises(lineage.LineageError if empty else observed.ObservedReadError):
        lineage.file_entry(path, reads=reader)
    if empty:
        assert lineage.sha256_file(path) == hashlib.sha256(b"").hexdigest()


class FalseyReader:
    def __init__(self, paths):
        self.entries = {path: (path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest()) for path in paths}
        self.calls = []
    def __bool__(self):
        return False
    def resolve(self, path):
        assert path in self.entries
        self.calls.append(("resolve", path))
        return path
    def file(self, path, *, required=False):
        assert required is True
        self.calls.append(("file", path))
        return SimpleNamespace(path=path, size=self.entries[path][0])
    def sha256(self, path):
        self.calls.append(("sha256", path))
        return self.entries[path][1]
    def recheck(self):
        pytest.fail("review_subject must leave final recheck to its caller")


def forbid_direct_io(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("supplied-reader lineage path bypassed the reader")
    for name in ("resolve", "stat", "lstat", "is_file", "open", "read_bytes", "read_text"):
        monkeypatch.setattr(Path, name, forbidden)
    monkeypatch.setattr(builtins, "open", forbidden)
    monkeypatch.setattr(os, "open", forbidden)
    monkeypatch.setattr(os, "stat", forbidden)
    monkeypatch.setattr(os, "lstat", forbidden)


def test_falsey_reader_used_for_every_group_without_direct_io(tmp_path, monkeypatch):
    paths, args = subject_inputs(tmp_path)
    expected = lineage.review_subject(**args)
    fake = FalseyReader(paths)
    with monkeypatch.context() as patch:
        forbid_direct_io(patch)
        actual = lineage.review_subject(**args, reads=fake)
    assert actual == expected
    assert fake.calls == [(method, path) for path in paths for method in ("resolve", "file", "sha256")]


@pytest.mark.parametrize("method", ["resolve", "file", "sha256"])
def test_reader_exception_is_not_replaced_by_direct_io(tmp_path, monkeypatch, method):
    path = tmp_path / "input"
    path.write_bytes(b"data")
    fake = FalseyReader([path])
    failure = observed.ObservedReadError("synthetic policy refusal")
    def fail(*args, **kwargs):
        raise failure
    setattr(fake, method, fail)
    with monkeypatch.context() as patch:
        forbid_direct_io(patch)
        with pytest.raises(observed.ObservedReadError) as raised:
            lineage.file_entry(path, reads=fake)
        assert raised.value is failure


def test_incompatible_reader_never_falls_back(tmp_path, monkeypatch):
    path = tmp_path / "unused"
    with monkeypatch.context() as patch:
        forbid_direct_io(patch)
        with pytest.raises(AttributeError):
            lineage.file_entry(path, reads=object())
        with pytest.raises(AttributeError):
            lineage.sha256_file(path, reads=object())


@pytest.mark.parametrize("field", ["manifest_paths", "images", "anchors"])
def test_observed_collection_limit_before_any_traversal(tmp_path, field):
    paths, args = subject_inputs(tmp_path)
    unit = args[field][0]
    args[field] = [unit] * 65
    reader = FalseyReader(paths)
    with pytest.raises(lineage.LineageError, match="finite bound"):
        lineage.review_subject(**args, reads=reader)
    assert reader.calls == []
    args[field] = [unit] * 64
    assert len(lineage.review_subject(**args, reads=reader)[{"manifest_paths": "manifests", "images": "images", "anchors": "anchors"}[field]]) == 64
    args[field] = [unit] * 65
    assert len(lineage.review_subject(**args)[{"manifest_paths": "manifests", "images": "images", "anchors": "anchors"}[field]]) == 65


@pytest.mark.parametrize("field", ["manifest_paths", "images", "anchors"])
def test_observed_generator_is_not_expanded(tmp_path, field):
    paths, args = subject_inputs(tmp_path)
    def forbidden_generator():
        pytest.fail("unbounded iterator was advanced")
        yield None
    args[field] = forbidden_generator()
    reader = FalseyReader(paths)
    with pytest.raises(lineage.LineageError, match="finite bound"):
        lineage.review_subject(**args, reads=reader)
    assert reader.calls == []


@pytest.mark.parametrize("format", ["PNG", "JPEG", "WEBP"])
def test_ordinary_lazy_image_helpers_decode_supported_formats(tmp_path, format):
    path = tmp_path / "synthetic-image.bin"
    Image.new("RGB", (6, 4), (20, 40, 60)).save(path, format=format)
    entry = lineage._single_seed_image_entry(path, name=path.name, formats=lineage.SINGLE_SEED_V2_FORMATS)
    assert entry == lineage.file_entry(path)
    with lineage._single_seed_decode(path, entry) as decoded, Image.open(path) as reference:
        assert decoded.size == (6, 4)
        assert decoded.mode == reference.mode
        assert decoded.tobytes() == reference.tobytes()
    assert not hasattr(lineage, "Image"), "incidental module-level Image export was deliberately removed"


def test_v1_default_format_and_v2_restriction_are_preserved(tmp_path):
    path = tmp_path / "synthetic.tiff"
    Image.new("RGB", (4, 3)).save(path, format="TIFF")
    entry = lineage._single_seed_image_entry(path, name=path.name)
    assert entry["sha256"] == lineage.sha256_file(path)
    with pytest.raises(lineage.LineageError, match="cannot inspect"):
        lineage._single_seed_image_entry(path, name=path.name, formats=lineage.SINGLE_SEED_V2_FORMATS)
    with pytest.raises(lineage.LineageError, match="cannot decode"):
        lineage._single_seed_decode(path, entry)


@pytest.mark.parametrize("helper", ["entry", "decode"])
@pytest.mark.parametrize("limit", ["dimension", "pixels", "bomb", "invalid", "changed"])
def test_ordinary_image_limits_and_errors_remain(tmp_path, monkeypatch, helper, limit):
    path = tmp_path / "synthetic.png"
    Image.new("RGB", (5, 5)).save(path)
    entry = lineage.file_entry(path)
    if limit == "dimension":
        monkeypatch.setattr(lineage, "SINGLE_SEED_MAX_DIMENSION", 4)
    elif limit == "pixels":
        monkeypatch.setattr(lineage, "SINGLE_SEED_MAX_PIXELS", 24)
    elif limit == "bomb":
        monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 2)
    elif limit == "invalid":
        path.write_bytes(b"not an image")
        entry = lineage.file_entry(path)
    else:
        path.write_bytes(b"changed image")
    with pytest.raises(lineage.LineageError):
        if helper == "entry":
            lineage._single_seed_image_entry(path, name=path.name)
        else:
            lineage._single_seed_decode(path, entry)


def test_actual_pixel_crop_and_disagreement_remain(tmp_path):
    parent = Image.new("RGB", (6, 4))
    parent.putdata([(x * 20, y * 30, x + y) for y in range(4) for x in range(6)])
    parent_path = tmp_path / "parent.png"
    output_path = tmp_path / "output.png"
    parent.save(parent_path)
    parent.crop((1, 1, 5, 4)).save(output_path)
    parent_entry = lineage.file_entry(parent_path)
    output_entry = lineage.file_entry(output_path)
    transform = {"op": "crop", "box": [1, 1, 5, 4], "parent_size": [6, 4], "output_size": [4, 3]}
    lineage._single_seed_verify_train_pixels(tmp_path, parent_entry, output_entry, transform)
    Image.new("RGB", (4, 3), "red").save(output_path)
    with pytest.raises(lineage.LineageError, match="trainer pixels"):
        lineage._single_seed_verify_train_pixels(tmp_path, parent_entry, lineage.file_entry(output_path), transform)
    parent.save(output_path)
    lineage._single_seed_verify_train_pixels(tmp_path, parent_entry, lineage.file_entry(output_path), None)


COLD_SCRIPT = r'''
import sys, os, json, hashlib, importlib.util, typing
from pathlib import Path
root = Path(sys.argv[1])
expected_sources = json.loads(sys.argv[2])
code = root / "code"
data = root / "data"
source_paths = {str(code / name).casefold() for name in ("lineage.py", "observed_reads.py")}
data_paths = {str(data / name).casefold() for name in ("plan.json", "manifest.json", "image.dat", "anchor.dat", "threshold.json", "score.json")}
runtime = Path(sys.base_prefix)
runtime_roots = (str(runtime / "Lib").casefold() + os.sep, str(runtime / "DLLs").casefold() + os.sep)
counts = {"source_reads": 0, "data_reads": 0, "runtime_reads": 0, "native": []}
phase = "import"
def audit(event, args):
    if event == "import":
        name = args[0].split(".")[0]
        assert name not in {"PIL", "requests", "httpx", "runpod", "boto3", "figment_train", "runpod_harness"}, ("forbidden import", name)
    if event == "open":
        path, mode, flags = args
        assert not (flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)), "write open"
        assert mode is None or not any(char in mode for char in "wax+"), "write mode"
        assert isinstance(path, (str, bytes, os.PathLike)), "unexpected descriptor open"
        value = os.fsdecode(path).casefold()
        if value in source_paths:
            counts["source_reads"] += 1
        elif value in data_paths:
            assert phase == "observe", "data opened during import"
            counts["data_reads"] += 1
        elif value == str(root / "cold.py").casefold():
            # CPython may read the exact harness source while formatting a refused-input traceback.
            counts["runtime_reads"] += 1
        else:
            assert "site-packages" not in value and any(value.startswith(base) for base in runtime_roots), ("unadmitted read", value)
            counts["runtime_reads"] += 1
    if event.startswith("socket.") or event.startswith("subprocess.") or event in {"os.system", "os.spawn", "os.exec", "os.fork", "os.startfile", "os.startfile/2"}:
        raise AssertionError("network or nested process")
    if event in {"os.remove", "os.rename", "os.rmdir", "os.mkdir", "os.link", "os.symlink", "os.truncate", "os.chmod", "os.utime", "tempfile.mkstemp", "tempfile.mkdtemp"}:
        raise AssertionError("filesystem mutation")
    if event.startswith("ctypes."):
        assert phase == "observe", "native loading during module import"
        if event == "ctypes.dlopen":
            assert args[0] == "kernel32", ("unexpected DLL", args[0])
            counts["native"].append("kernel32")
        elif event == "ctypes.dlsym":
            assert getattr(args[0], "_name", None) == "kernel32" and args[1] in {"GetLastError", "GetDriveTypeW"}, "unexpected native symbol"
            counts["native"].append(args[1])
        else:
            raise AssertionError(("unexpected ctypes event", event))
sys.addaudithook(audit)
assert sys.flags.isolated == 1 and sys.dont_write_bytecode and sys.implementation.name == "cpython"
assert not any(name == "PIL" or name.startswith("PIL.") for name in sys.modules)
def load(name):
    path = code / (name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    # Exact named copied source; avoid implicit bytecode-cache reads as well as writes.
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == expected_sources[path.name], "source hash mismatch"
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module
reads = load("observed_reads")
lineage = load("lineage")
assert counts["data_reads"] == 0 and not counts["native"]
assert typing.get_type_hints(lineage._single_seed_decode)["return"] is typing.Any
phase = "observe"
paths = [data / name for name in ("plan.json", "manifest.json", "image.dat", "anchor.dat", "threshold.json", "score.json")]
reader = reads.ObservedReads(roots=(data,), members=tuple(reads.ReadMember(path, 100, allow_json=True) for path in paths))
subject = lineage.review_subject(creator="creator-001", stage="gen", plan_path=paths[0], manifest_paths=[paths[1]], images=[{"image_id":"synthetic", "path":str(paths[2])}], anchors=[paths[3]], persona={"id":"creator-001"}, training={"steps":1}, threshold_path=paths[4], score_path=paths[5], checkpoint_inputs={"path":"never-follow-this"}, reads=reader)
assert reader.read_json(paths[0]) == {"synthetic": True}
reader.recheck()
assert not hasattr(lineage, "Image")
assert not any(name == "PIL" or name.startswith("PIL.") for name in sys.modules)
assert counts["source_reads"] == 2 and counts["data_reads"] > 0
assert "GetDriveTypeW" in counts["native"]
print(json.dumps({"ok":True,"version":sys.version,"executable":sys.executable,"subject":subject,"counts":counts,"isolated":sys.flags.isolated,"no_pil":True}, sort_keys=True))
'''


def tree_snapshot(root):
    return {str(path.relative_to(root)): ("directory" if path.is_dir() else hashlib.sha256(path.read_bytes()).hexdigest()) for path in root.rglob("*")}


@pytest.mark.parametrize("source_fault", [None, "missing", "changed"])
def test_actual_cold_py3_isolated_observed_subject_has_no_pil_provider_or_writes(tmp_path, source_fault):
    assert sys.platform == "win32", "exact py -3 Windows contract required"
    launcher = shutil.which("py")
    assert launcher, "actual Windows py launcher must be available"
    code = tmp_path / "code"
    data = tmp_path / "data"
    code.mkdir()
    data.mkdir()
    source_hashes = {}
    for name in ("lineage.py", "observed_reads.py"):
        raw = (PIPELINE / name).read_bytes()
        (code / name).write_bytes(raw)
        source_hashes[name] = hashlib.sha256(raw).hexdigest()
    if source_fault == "missing":
        (code / "observed_reads.py").unlink()
    elif source_fault == "changed":
        with (code / "observed_reads.py").open("ab") as handle:
            handle.write(b"\n# deliberate wrong copied input\n")
    for name in ("plan.json", "manifest.json", "image.dat", "anchor.dat", "threshold.json", "score.json"):
        (data / name).write_bytes(b'{"synthetic":true}')
    script = tmp_path / "cold.py"
    script.write_text(textwrap.dedent(COLD_SCRIPT), encoding="utf-8")
    before = tree_snapshot(tmp_path)
    result = subprocess.run([launcher, "-3", "-I", "-B", str(script), str(tmp_path), json.dumps(source_hashes)], capture_output=True, text=True, timeout=30)
    assert tree_snapshot(tmp_path) == before
    assert not list(tmp_path.rglob("__pycache__"))
    if source_fault:
        assert result.returncode != 0 and result.stdout == ""
        assert ("FileNotFoundError" if source_fault == "missing" else "source hash mismatch") in result.stderr
        return
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    value = json.loads(result.stdout)
    assert value["ok"] and value["isolated"] == 1 and value["no_pil"]
    expected_digest = hashlib.sha256(b'{"synthetic":true}').hexdigest()
    subject = value["subject"]
    for entry in (subject["plan"], *subject["manifests"], *subject["images"], *subject["anchors"], subject["thresholds"], subject["numeric_gate"]):
        assert entry["sha256"] == expected_digest and entry["bytes"] == 18
    assert value["counts"]["source_reads"] == 2
