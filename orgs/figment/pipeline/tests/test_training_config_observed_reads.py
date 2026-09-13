"""B1 real loader, optional-sidecar, and isolated synthetic composition tests."""
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

import pytest

PIPELINE = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


fixtures = load("b1_synthetic_fixture_helpers", Path(__file__).with_name("test_persona_observed_reads.py"))
training = load("b1_training_under_test", PIPELINE / "training_config.py")
MISSING = fixtures.MISSING
INLINE = {"steps": 800, "save_every": 200}
SIDECAR = {"steps": 600, "save_every": 200}


@pytest.mark.parametrize("inline,sidecar,steps,ambiguous", [
    (MISSING, MISSING, 2000, False), (None, MISSING, 2000, False),
    (MISSING, None, 2000, False), (None, None, 2000, False),
    (INLINE, MISSING, 800, False), (INLINE, None, 800, False),
    (MISSING, SIDECAR, 600, False), (None, SIDECAR, 600, False),
    (INLINE, SIDECAR, None, True), ({}, {}, None, True),
    (False, {}, None, True), ({}, False, None, True),
])
def test_inline_sidecar_null_semantics_and_default_parity(tmp_path, inline, sidecar, steps, ambiguous):
    fixture = fixtures.make_fixture(tmp_path, inline=inline, sidecar=sidecar)
    before = fixture.path.read_bytes()
    if ambiguous:
        for reader in (None, fixtures.reader_for(fixture)):
            with pytest.raises(training.TrainingConfigError, match="both persona.yaml and training.yaml"):
                training.load_persona_with_training(fixture.path, reads=reader)
    else:
        baseline = training.load_persona_with_training(fixture.path)
        reader = fixtures.reader_for(fixture)
        actual = training.load_persona_with_training(fixture.path, reads=reader)
        assert actual == baseline and actual["training"]["steps"] == steps
        assert actual["training"]["trigger"] == "creator001krea2"
        reader.recheck()
        actual["identity"]["references"].append("mutated returned list")
        assert training.load_persona_with_training(fixture.path)["identity"]["references"] == baseline["identity"]["references"]
    assert fixture.path.read_bytes() == before


@pytest.mark.parametrize("bad", [False, 0, "training", [], {"unknown": 1}, {"trigger": "wrong"}])
def test_nonnull_invalid_training_retains_domain_failure(tmp_path, bad):
    fixture = fixtures.make_fixture(tmp_path, sidecar=bad)
    with pytest.raises(training.TrainingConfigError) as baseline:
        training.load_persona_with_training(fixture.path)
    with pytest.raises(training.TrainingConfigError) as observed:
        training.load_persona_with_training(fixture.path, reads=fixtures.reader_for(fixture))
    assert str(observed.value) == str(baseline.value)


@pytest.mark.parametrize("raw", [b"{", b"null", b"[]", b'{"training":{},"extra":true}', b'{"other":{}}'])
def test_inline_training_never_bypasses_malformed_sidecar(tmp_path, raw):
    fixture = fixtures.make_fixture(tmp_path, inline=INLINE)
    fixture.sidecar.write_bytes(raw)
    with pytest.raises(ValueError):
        training.load_persona_with_training(fixture.path, reads=fixtures.reader_for(fixture))


def test_default_yaml_and_observed_json_only_are_distinct_contracts(tmp_path, monkeypatch):
    fixture = fixtures.make_fixture(tmp_path)
    source = fixture.home / "document.yaml"
    source.write_bytes(b"value: 7\n")
    module = training._load_persona_module()
    assert module.load_document(source) == {"value": 7}
    def forbidden(): pytest.fail("observed YAML invoked provider-backed fallback")
    monkeypatch.setattr(module, "_load_pod_runpod_run", forbidden)
    reader = fixtures.observed.ObservedReads(roots=(fixture.root,), members=(fixtures.observed.ReadMember(source, 1024, allow_json=True),))
    with pytest.raises(fixtures.observed.ObservedReadError):
        module.load_document(source, reads=reader)


def test_absent_sidecar_is_rechecked_even_with_inline_training(tmp_path):
    fixture = fixtures.make_fixture(tmp_path, inline=INLINE)
    reader = fixtures.reader_for(fixture)
    assert training.load_persona_with_training(fixture.path, reads=reader)["training"]["steps"] == 800
    fixture.sidecar.write_bytes(b'{"training":null}')
    with pytest.raises(fixtures.observed.ObservedReadError): reader.recheck()


@pytest.mark.parametrize("kind", ["directory", "permission"])
def test_sidecar_unavailability_is_not_safe_absence(tmp_path, monkeypatch, kind):
    fixture = fixtures.make_fixture(tmp_path, inline=INLINE)
    if kind == "directory": fixture.sidecar.mkdir()
    reader = fixtures.reader_for(fixture)
    original = os.lstat
    def denied(path, *args, **kwargs):
        if Path(path) == fixture.sidecar: raise PermissionError(13, "synthetic denial")
        return original(path, *args, **kwargs)
    if kind == "permission": monkeypatch.setattr(os, "lstat", denied)
    with pytest.raises(fixtures.observed.ObservedReadError):
        training.load_persona_with_training(fixture.path, reads=reader)


@pytest.mark.parametrize("member", ["path", "identity", "register", "sidecar"])
@pytest.mark.parametrize("same_bytes", [False, True])
def test_loaded_member_mutation_is_rejected_at_caller_recheck(tmp_path, member, same_bytes):
    fixture = fixtures.make_fixture(tmp_path, sidecar=SIDECAR)
    reader = fixtures.reader_for(fixture)
    training.load_persona_with_training(fixture.path, reads=reader)
    target = getattr(fixture, member)
    previous = target.stat()
    target.write_bytes(target.read_bytes() if same_bytes else b"changed synthetic member")
    os.utime(target, ns=(previous.st_atime_ns, previous.st_mtime_ns + 2_000_000_000))
    with pytest.raises(fixtures.observed.ObservedReadError): reader.recheck()


@pytest.mark.parametrize("field,api", [("st_ctime_ns", "named"), ("st_ctime_ns", "opened"), ("st_birthtime_ns", "opened")])
def test_loaded_sidecar_keeps_each_api_timestamp(tmp_path, monkeypatch, field, api):
    fixture = fixtures.make_fixture(tmp_path, sidecar=SIDECAR)
    reader = fixtures.reader_for(fixture)
    training.load_persona_with_training(fixture.path, reads=reader)
    identity = fixture.sidecar.stat()
    original_named, original_opened = os.lstat, os.fstat
    def alter(info):
        names = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_birthtime_ns", "st_mode", "st_file_attributes")
        values = {name: getattr(info, name) for name in names}
        values[field] += 1
        return fixtures.SimpleNamespace(**values)
    def named(path, *args, **kwargs):
        info = original_named(path, *args, **kwargs)
        return alter(info) if Path(path) == fixture.sidecar else info
    def opened(fd):
        info = original_opened(fd)
        return alter(info) if (info.st_dev, info.st_ino) == (identity.st_dev, identity.st_ino) else info
    monkeypatch.setattr(os, "lstat" if api == "named" else "fstat", named if api == "named" else opened)
    with pytest.raises(fixtures.observed.ObservedReadError): reader.recheck()


def test_changed_admitted_ancestor_invalidates_loaded_configuration(tmp_path):
    fixture = fixtures.make_fixture(tmp_path)
    reader = fixtures.reader_for(fixture)
    training.load_persona_with_training(fixture.path, reads=reader)
    original = fixture.home.stat()
    os.utime(fixture.home, ns=(original.st_atime_ns, original.st_mtime_ns + 2_000_000_000))
    with pytest.raises(fixtures.observed.ObservedReadError): reader.recheck()


class GuardedReader:
    def __init__(self, reader):
        self.reader, self.depth, self.calls = reader, 0, []
    def __bool__(self): return False
    def __getattr__(self, name):
        def invoke(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            self.depth += 1
            try: return getattr(self.reader, name)(*args, **kwargs)
            finally: self.depth -= 1
        return invoke


def test_falsey_real_reader_covers_consumer_io_without_fallback(tmp_path, monkeypatch):
    fixture = fixtures.make_fixture(tmp_path, sidecar=SIDECAR)
    module = training._load_persona_module()  # Actual loader is exercised cold below.
    expected = training.load_persona_with_training(fixture.path)
    spy = GuardedReader(fixtures.reader_for(fixture))
    io_calls = []
    def guard(original):
        def wrapped(*args, **kwargs):
            assert spy.depth > 0, "consumer performed covered data I/O outside reader"
            io_calls.append(original.__name__)
            return original(*args, **kwargs)
        return wrapped
    def no_fallback(): pytest.fail("observed branch imported gates or harness")
    with monkeypatch.context() as patch:
        for name in ("resolve", "stat", "lstat", "is_file", "open", "read_bytes", "read_text"):
            patch.setattr(Path, name, guard(getattr(Path, name)))
        for name in ("open", "stat", "lstat"):
            patch.setattr(os, name, guard(getattr(os, name)))
        patch.setattr(builtins, "open", guard(builtins.open))
        patch.setattr(module, "_load_gates", no_fallback)
        patch.setattr(module, "_load_pod_runpod_run", no_fallback)
        actual = training.load_persona_with_training(fixture.path, reads=spy)
        spy.recheck()
    assert actual == expected and io_calls and spy.depth == 0
    assert any(name == "file" and args == (fixture.sidecar,) and kwargs.get("required") is False for name, args, kwargs in spy.calls)
    hashed = {args[0] for name, args, _ in spy.calls if name == "sha256"}
    assert hashed == {fixture.identity, fixture.register}, "reference existence is not invented content approval"


def test_incompatible_reader_and_reader_error_never_use_default_io(tmp_path, monkeypatch):
    fixture = fixtures.make_fixture(tmp_path)
    module = training._load_persona_module()
    def forbidden(*args, **kwargs): pytest.fail("refusal fell through to direct I/O")
    class Refusing:
        def read_json(self, path): raise fixtures.observed.ObservedReadError("specific refusal")
    with monkeypatch.context() as patch:
        patch.setattr(Path, "read_text", forbidden)
        patch.setattr(module, "_load_pod_runpod_run", forbidden)
        with pytest.raises(AttributeError): training.load_persona_with_training(fixture.path, reads=object())
        with pytest.raises(fixtures.observed.ObservedReadError, match="specific refusal"):
            training.load_persona_with_training(fixture.path, reads=Refusing())


@pytest.mark.parametrize("limit", ["unique", "stream", "json", "operations"])
def test_loader_cannot_reset_lowered_reader_budgets(tmp_path, limit):
    fixture = fixtures.make_fixture(tmp_path)
    size = fixture.path.stat().st_size
    kwargs = {"unique": {"max_unique_bytes": size - 1}, "stream": {"max_stream_bytes": size - 1},
              "json": {"max_json_bytes": size - 1}, "operations": {"max_operations": 1}}[limit]
    reader = fixtures.reader_for(fixture, limits=fixtures.observed.ReadLimits(**kwargs))
    with pytest.raises(fixtures.observed.ObservedReadError):
        training.load_persona_with_training(fixture.path, reads=reader)


COLD_SCRIPT = r'''
import sys, os, json, hashlib, importlib.util
from pathlib import Path
root = Path(sys.argv[1])
inventory = json.loads(sys.argv[2])
pipeline = root / "repo" / "orgs" / "figment" / "pipeline"
figment = pipeline.parent
home = figment / "personas" / "creator-001"
sources = {str(pipeline / name).casefold(): digest for name, digest in inventory["sources"].items()}
data_paths = {str(Path(row["path"])).casefold() for row in inventory["members"]}
cache = pipeline / "__pycache__" / ("persona." + sys.implementation.cache_tag + ".pyc")
assert not cache.exists(), "planted bytecode cache"
runtime = Path(sys.base_prefix)
runtime_roots = tuple(str(runtime / name).casefold() + os.sep for name in ("Lib", "DLLs"))
counts = {"source": 0, "data": 0, "runtime": 0, "absent_cache": 0, "native": []}
phase = "import"
def audit(event, args):
    if event == "import":
        assert args[0].split(".")[0] not in {"PIL", "pytest", "requests", "httpx", "runpod", "boto3", "figment_train"}, "forbidden import"
    if event == "open":
        path, mode, flags = args
        assert not flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND), "write open"
        assert mode is None or not any(char in mode for char in "wax+"), "write mode"
        value = os.fsdecode(path).casefold()
        if value in sources: counts["source"] += 1
        elif value in data_paths:
            assert phase == "observe", "data opened during import"
            counts["data"] += 1
        elif value == str(cache).casefold():
            assert not os.path.lexists(cache), "planted bytecode cache"
            counts["absent_cache"] += 1
        elif value == str(root / "cold.py").casefold(): counts["runtime"] += 1
        else:
            assert "site-packages" not in value and any(value.startswith(prefix) for prefix in runtime_roots), ("unadmitted read", value)
            counts["runtime"] += 1
    if event.startswith(("socket.", "subprocess.")) or event in {"os.system", "os.spawn", "os.exec", "os.fork", "os.startfile", "os.startfile/2"}:
        raise AssertionError("network or nested process")
    if event in {"os.remove", "os.rename", "os.rmdir", "os.mkdir", "os.link", "os.symlink", "os.truncate", "os.chmod", "os.utime", "tempfile.mkstemp", "tempfile.mkdtemp"}:
        raise AssertionError("filesystem mutation")
    if event.startswith("ctypes."):
        assert phase == "observe", "native initialization during import"
        if event == "ctypes.dlopen":
            assert args[0] == "kernel32", "unexpected DLL"
            counts["native"].append("kernel32")
        elif event == "ctypes.dlsym":
            assert getattr(args[0], "_name", None) == "kernel32" and args[1] in {"GetLastError", "GetDriveTypeW"}, "unexpected native symbol"
            counts["native"].append(args[1])
        else: raise AssertionError("unexpected ctypes event")
sys.addaudithook(audit)
assert sys.flags.isolated == 1 and sys.dont_write_bytecode
assert not any(name == "PIL" or name.startswith("PIL.") for name in sys.modules)
for name, digest in inventory["sources"].items():
    assert hashlib.sha256((pipeline / name).read_bytes()).hexdigest() == digest, "source hash mismatch"
def load(name):
    path = pipeline / (name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    # The three top-level copies execute exact pinned bytes; training's persona loader stays real.
    exec(compile(path.read_bytes(), str(path), "exec"), module.__dict__)
    return module
reads = load("observed_reads")
training = load("training_config")
lineage = load("lineage")
assert "_figment_training_config_persona" not in sys.modules and counts["data"] == 0
phase = "observe"
members = tuple(reads.ReadMember(Path(row["path"]), row["max_bytes"], allow_json=row["json"], optional=row["optional"]) for row in inventory["members"])
reader = reads.ObservedReads(roots=(figment,), members=members, directories=(home,), limits=reads.ReadLimits(max_files=68, max_unique_bytes=128*1024**2, max_stream_bytes=256*1024**2))
value = training.load_persona_with_training(home / "persona.yaml", reads=reader)
actual_persona = sys.modules["_figment_training_config_persona"]
assert Path(actual_persona.__file__) == pipeline / "persona.py"
assert value["training"]["steps"] == 600
assert value["register"]["spec"]["path"] == "../../pipeline/look-spec-v2.md"
subject = lineage.review_subject(creator="creator-001", stage="gen", plan_path=home / "plan.json", manifest_paths=[home / "manifest.json"], images=[{"image_id":"synthetic","path":str(home / "image.dat")}], anchors=[home / "anchors" / "g00.bin"], persona=value, training=value["training"], threshold_path=home / "threshold.json", score_path=home / "score.json", reads=reader)
reader.recheck()
assert not any(name == "PIL" or name.startswith("PIL.") or "runpod" in name or name == "_figment_pipeline_persona_gates" for name in sys.modules)
assert counts["data"] > 0 and "GetDriveTypeW" in counts["native"]
print(json.dumps({"ok":True,"executable":sys.executable,"version":sys.version,"training":value["training"],"subject":subject,"counts":counts,"isolated":sys.flags.isolated,"no_pil_provider":True},sort_keys=True))
'''


def snapshot(root):
    return {str(p.relative_to(root)): ("directory" if p.is_dir() else hashlib.sha256(p.read_bytes()).hexdigest()) for p in root.rglob("*")}


@pytest.mark.parametrize("fault", [None, "missing", "changed", "cache", "yaml"])
def test_actual_isolated_loader_and_lineage_composition(tmp_path, fault):
    assert sys.platform == "win32", "real admitted Windows isolated runtime required"
    launcher = shutil.which("py")
    assert launcher, "actual py launcher is required"
    fixture = fixtures.make_fixture(tmp_path, sidecar=SIDECAR)
    source_hashes = {}
    for name in ("persona.py", "training_config.py", "observed_reads.py", "lineage.py"):
        raw = (PIPELINE / name).read_bytes()
        (fixture.root / "pipeline" / name).write_bytes(raw)
        source_hashes[name] = hashlib.sha256(raw).hexdigest()
    extra = [fixture.home / name for name in ("plan.json", "manifest.json", "image.dat", "threshold.json", "score.json")]
    for path in extra: path.write_bytes(b'{"synthetic":true}')
    if fault == "missing": (fixture.root / "pipeline" / "persona.py").unlink()
    elif fault == "changed":
        with (fixture.root / "pipeline" / "persona.py").open("ab") as handle: handle.write(b"\n# changed copied source\n")
    elif fault == "cache":
        cache = fixture.root / "pipeline" / "__pycache__"
        cache.mkdir()
        # Selected production py-3 runtime is CPython3.12. This is a rejected planted file, not executed bytecode.
        (cache / "persona.cpython-312.pyc").write_bytes(b"untrusted cache")
    elif fault == "yaml": fixture.path.write_bytes(b"id: creator-001\n")
    inventory = {"sources": source_hashes, "members": [
        {"path": str(path), "max_bytes": 256 * 1024, "json": path in (fixture.path, fixture.sidecar), "optional": path == fixture.sidecar}
        for path in [*fixture.members, *extra]]}
    script = tmp_path / "cold.py"
    script.write_bytes(COLD_SCRIPT.encode("utf-8"))
    before = snapshot(tmp_path)
    result = subprocess.run([launcher, "-3", "-I", "-B", str(script), str(tmp_path), json.dumps(inventory)], capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
    assert snapshot(tmp_path) == before
    if fault:
        assert result.returncode != 0 and result.stdout == b""
        expected = {"missing": b"FileNotFoundError", "changed": b"source hash mismatch", "cache": b"planted bytecode cache", "yaml": b"ObservedReadError"}[fault]
        assert expected in result.stderr
        return
    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")
    assert result.stderr == b""
    value = json.loads(result.stdout)
    assert value["ok"] and value["isolated"] == 1 and value["no_pil_provider"]
    assert value["training"] == training.validate_training(SIDECAR, "creator-001")
    assert value["subject"]["plan"] == {"name": "plan.json", "bytes": 18, "sha256": hashlib.sha256(b'{"synthetic":true}').hexdigest()}
    assert value["subject"]["anchors"][0]["sha256"] == hashlib.sha256(fixture.refs[0].read_bytes()).hexdigest()
    assert not list(tmp_path.rglob("__pycache__"))
