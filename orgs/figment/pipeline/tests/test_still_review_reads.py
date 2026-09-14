"""Focused, synthetic-only Windows contract tests for StillReviewReads.

No media, model, provider, credential or telemetry data is read. All content
is tiny and generated inside tmp_path.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "figment_test_still_review_reads", PIPELINE / "still_review_reads.py"
)
assert SPEC and SPEC.loader
router_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = router_module
SPEC.loader.exec_module(router_module)

StillReviewReads = router_module.StillReviewReads
StillReviewLimits = router_module.StillReviewLimits
StillReviewError = router_module.StillReviewError
ReadMember = router_module.ReadMember
RefusalKind = router_module.RefusalKind


@pytest.fixture(autouse=True)
def supported_platform():
    assert sys.platform == "win32", "This contract requires real Windows local filesystem semantics"


def make_roots(tmp_path):
    root = tmp_path / "root"
    plan = root / "plan"
    persona = root / "persona"
    pipeline = root / "pipeline"
    store = root / "store"
    for r in (plan, persona, pipeline, store):
        r.mkdir(parents=True)
    d = plan / "grade" / "gen"
    d.mkdir(parents=True)
    return root, plan, persona, pipeline, store, d


def build(plan, persona, pipeline, store, d, *, members=(), directories=(),
          branch="keep", temp=(), limits=None, baseline=None, phase="P"):
    return StillReviewReads(
        plan_root=plan, persona_root=persona, pipeline_root=pipeline, store_root=store,
        mutation_directory=d, branch=branch, members=members, directories=directories,
        temporary_names=temp, limits=limits or StillReviewLimits(), baseline=baseline, phase=phase,
    )


def stat_with(info, **overrides):
    base = {
        "st_mode": info.st_mode, "st_ino": info.st_ino, "st_dev": info.st_dev,
        "st_nlink": info.st_nlink, "st_uid": info.st_uid, "st_gid": info.st_gid,
        "st_size": info.st_size, "st_atime": info.st_atime, "st_mtime": info.st_mtime,
        "st_ctime": info.st_ctime,
    }
    extra = {
        "st_file_attributes": getattr(info, "st_file_attributes", 0),
        "st_birthtime_ns": getattr(info, "st_birthtime_ns", getattr(info, "st_ctime_ns", 0)),
        "st_mtime_ns": getattr(info, "st_mtime_ns", 0),
        "st_ctime_ns": getattr(info, "st_ctime_ns", 0),
    }
    for key, value in overrides.items():
        if key in base:
            base[key] = value
        else:
            extra[key] = value
    seq = (base["st_mode"], base["st_ino"], base["st_dev"], base["st_nlink"], base["st_uid"],
           base["st_gid"], base["st_size"], base["st_atime"], base["st_mtime"], base["st_ctime"])
    return os.stat_result(seq, extra)


def setup(tmp_path, *, branch="keep", limits=None):
    root, plan, persona, pipeline, store, d = make_roots(tmp_path)
    source = pipeline / "source.json"
    source.write_bytes(b'{"v":1}')
    original = d / "grading-manifest.json"
    original.write_bytes(b'{"images":[]}')
    absent = store / "optional.json"
    names = router_module._KEEP_FINALS if branch == "keep" else router_module._CULL_FINALS
    members = (ReadMember(source, 4096, True), ReadMember(original, 4096, True),
               ReadMember(absent, 4096, True, True),
               ReadMember(d / "accepted-checkpoint.json", 4096, True, True),
               *(ReadMember(d / name, 4096, True, True) for name in names))
    kwargs = dict(plan_root=plan, persona_root=persona, pipeline_root=pipeline,
                  store_root=store, mutation_directory=d, branch=branch,
                  members=members, temporary_names=("rulings.json.tmp",),
                  limits=limits or StillReviewLimits())
    return kwargs, source, original, absent, d


def writer(kwargs):
    preflight = StillReviewReads(**kwargs)
    baseline = preflight.export_baseline()
    result = StillReviewReads(**kwargs, baseline=baseline, phase="W")
    assert result.phase == "W"
    assert result.stream_bytes == result.unique_bytes
    assert result.stream_bytes < preflight.stream_bytes
    assert result.operations > 0
    return result, baseline


def poison_assert(reader, path):
    kind = reader.refusal_kind
    for action in (lambda: reader.file(path), lambda: reader.resolve(path),
                   lambda: reader.sha256(path), lambda: reader.read_json(path),
                   reader.recheck, reader.export_baseline):
        with pytest.raises(StillReviewError):
            action()
    assert reader.poisoned and reader.refusal_kind == kind


def test_basic_and_unread_export_preserves_every_original(tmp_path):
    kwargs, source, original, absent, d = setup(tmp_path)
    reader = StillReviewReads(**kwargs)
    data = json.loads(reader.export_baseline())
    source_key = router_module._key(source)
    assert data["files"][source_key]["digest"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert data["files"][router_module._key(absent)] is None
    assert data["directories"] and data["originals"][original.name]
    assert reader.resolve(source) == source
    observed = reader.file(source, required=True)
    assert observed.path == source and observed.size == 7
    import dataclasses
    with pytest.raises(dataclasses.FrozenInstanceError):
        observed.size = 0
    first = reader.read_json(source)
    first["v"] = 9
    assert reader.read_json(source) == {"v": 1}
    reader.recheck()
    assert reader.phase == "P"


@pytest.mark.parametrize("phase", ["W", "I", "bad", True])
def test_no_unimported_write_or_inspection_phase(tmp_path, phase):
    kwargs, *_ = setup(tmp_path)
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs, phase=phase)


def test_p_cannot_publish_and_failed_read_stays_poisoned(tmp_path):
    kwargs, source, _, _, d = setup(tmp_path)
    reader = StillReviewReads(**kwargs)
    (d / "rulings.json").write_bytes(b"{}")
    with pytest.raises(StillReviewError):
        reader.file(source)
    poison_assert(reader, source)


def test_w_import_checks_original_p_before_enabling_write(tmp_path):
    kwargs, _, _, _, d = setup(tmp_path)
    baseline = StillReviewReads(**kwargs).export_baseline()
    (d / "rulings.json").write_bytes(b"{}")
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs, baseline=baseline, phase="W")


@pytest.mark.parametrize("branch", ["keep", "cull"])
def test_live_writer_and_frozen_inspection(tmp_path, branch):
    kwargs, source, _, _, d = setup(tmp_path, branch=branch)
    reader, initial = writer(kwargs)
    final = d / "rulings.json"
    assert reader.file(final) is None
    temporary = d / "rulings.json.tmp"
    temporary.write_bytes(b'{"fixture":1}')
    assert reader.file(final) is None
    os.replace(temporary, final)
    assert reader.read_json(final) == {"fixture": 1}
    combined = reader.export_baseline()
    p, w = json.loads(initial), json.loads(combined)
    for key, value in p["files"].items():
        if value is not None:
            assert w["files"][key] == value
    assert w["directories"] == p["directories"]
    inspect = StillReviewReads(**kwargs, baseline=combined, phase="I")
    assert inspect.read_json(final) == {"fixture": 1}
    assert inspect.stream_bytes >= inspect.unique_bytes
    assert inspect.stream_bytes < reader.stream_bytes
    (d / "review-manifest.json").write_bytes(b"{}")
    with pytest.raises(StillReviewError):
        inspect.file(source)
    poison_assert(inspect, source)


def test_i_cannot_return_to_write(tmp_path):
    kwargs, *_ = setup(tmp_path)
    reader, _ = writer(kwargs)
    combined = reader.export_baseline()
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs, baseline=combined, phase="W")


def test_same_byte_replacement_never_recovers_original_baseline(tmp_path):
    kwargs, source, _, _, _ = setup(tmp_path)
    baseline = StillReviewReads(**kwargs).export_baseline()
    raw = source.read_bytes()
    held = source.with_name("old-held.json")
    source.rename(held)
    source.write_bytes(raw)
    assert source.stat().st_ino != held.stat().st_ino
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs, baseline=baseline, phase="W")


def test_original_absence_and_directory_baselines_survive_import(tmp_path):
    kwargs, _, _, absent, _ = setup(tmp_path)
    baseline = StillReviewReads(**kwargs).export_baseline()
    absent.write_bytes(b"{}")
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs, baseline=baseline)


def test_member_directory_stamp_is_not_rebased_on_import(tmp_path):
    kwargs, *_ = setup(tmp_path)
    baseline = StillReviewReads(**kwargs).export_baseline()
    directory = kwargs["store_root"]
    info = directory.stat()
    os.utime(directory, ns=(info.st_atime_ns, info.st_mtime_ns + 2_000_000_000))
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs, baseline=baseline)


def test_large_fingerprint_strings_roundtrip_and_opened_ctime_retained(tmp_path, monkeypatch):
    kwargs, source, *_ = setup(tmp_path)
    original_lstat, original_fstat = os.lstat, os.fstat
    identity = source.stat().st_ino
    large = 2 ** 63 + 123
    def changed(info, *, opened):
        if info.st_ino != identity:
            return info
        return stat_with(info, st_ino=large, st_birthtime_ns=large + 1,
                         st_mtime_ns=large + 2, st_ctime_ns=large + (4 if opened else 3))
    monkeypatch.setattr(os, "lstat", lambda p, *a, **k: changed(original_lstat(p, *a, **k), opened=False))
    monkeypatch.setattr(os, "fstat", lambda fd: changed(original_fstat(fd), opened=True))
    reader = StillReviewReads(**kwargs)
    baseline = reader.export_baseline()
    record = json.loads(baseline)["files"][router_module._key(source)]
    assert record["named"]["inode"] == str(large)
    assert record["named"]["changed"] == str(large + 3)
    assert record["opened"]["changed"] == str(large + 4)
    assert all(type(value) is str for value in record["named"].values())
    # JSON parse/re-emission preserves strings without large-number conversion.
    reemitted = json.dumps(json.loads(baseline)).encode()
    imported = StillReviewReads(**kwargs, baseline=reemitted, phase="W")
    assert imported.sha256(source) == hashlib.sha256(b'{"v":1}').hexdigest()


@pytest.mark.parametrize("bad", [True, 1.5, 42, "01", "-1", "+1", "1e3", "9" * 40])
def test_noncanonical_fingerprint_integers_refuse(tmp_path, bad):
    kwargs, source, *_ = setup(tmp_path)
    data = json.loads(StillReviewReads(**kwargs).export_baseline())
    data["files"][router_module._key(source)]["named"]["inode"] = bad
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs, baseline=json.dumps(data).encode())


@pytest.mark.parametrize("mutation", ["extra", "missing", "counter", "bool-version", "directory", "digest"])
def test_baseline_schema_and_original_records_fail_closed(tmp_path, mutation):
    kwargs, source, *_ = setup(tmp_path)
    data = json.loads(StillReviewReads(**kwargs).export_baseline())
    if mutation == "extra": data["surprise"] = 1
    elif mutation == "missing": data["files"].pop(router_module._key(source))
    elif mutation == "counter": data["counters"]["stream_bytes"] = 2 ** 31 + 1
    elif mutation == "bool-version": data["version"] = True
    elif mutation == "directory": data["directories"].pop(next(iter(data["directories"])))
    else: data["files"][router_module._key(source)]["digest"] = "0" * 64
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs, baseline=json.dumps(data).encode())


def test_duplicate_and_oversized_baseline_refuse(tmp_path):
    kwargs, *_ = setup(tmp_path)
    raw = StillReviewReads(**kwargs).export_baseline()
    duplicate = raw[:-1] + b',"version":1}'
    for bad in (duplicate, b"x" * (128 * 1024 + 1), b"{}", b"[[[["):
        with pytest.raises(StillReviewError):
            StillReviewReads(**kwargs, baseline=bad)


def test_opened_fingerprint_change_is_not_discarded(tmp_path, monkeypatch):
    kwargs, source, *_ = setup(tmp_path)
    reader = StillReviewReads(**kwargs)
    original = os.fstat
    ino = source.stat().st_ino
    def faked(fd):
        info = original(fd)
        return stat_with(info, st_ctime_ns=info.st_ctime_ns + 1) if info.st_ino == ino else info
    monkeypatch.setattr(os, "fstat", faked)
    with pytest.raises(StillReviewError):
        reader.file(source)
    poison_assert(reader, source)


class Handle:
    def __init__(self, actual, hook): self.actual, self.hook = actual, hook
    def __enter__(self): return self
    def __exit__(self, *args): self.actual.close()
    def fileno(self): return self.actual.fileno()
    def read(self, size): return self.hook(self.actual, size)


def wrap_read(monkeypatch, target, hook):
    original = Path.open
    handles = []
    def opening(path, *args, **kwargs):
        handle = original(path, *args, **kwargs)
        if path != target: return handle
        wrapped = Handle(handle, hook)
        handles.append(wrapped)
        return wrapped
    monkeypatch.setattr(Path, "open", opening)
    return handles


def test_writer_publication_during_stream_is_frozen_before_return(tmp_path, monkeypatch):
    kwargs, source, _, _, d = setup(tmp_path)
    reader, _ = writer(kwargs)
    final = d / "rulings.json"
    raw_open = Path.open
    def hook(handle, size):
        raw = handle.read(size)
        with raw_open(final, "wb") as output: output.write(b'{"x":1}')
        return raw
    handles = wrap_read(monkeypatch, source, hook)
    reader.sha256(source)
    assert all(h.actual.closed for h in handles)
    key = router_module._key(final)
    assert reader._files[key].digest == hashlib.sha256(b'{"x":1}').hexdigest()
    monkeypatch.undo()
    final.write_bytes(b'{"x":2}')
    with pytest.raises(StillReviewError):
        reader.file(final)


def test_fstat_changes_during_stream_close_handle(tmp_path, monkeypatch):
    kwargs, source, *_ = setup(tmp_path)
    reader = StillReviewReads(**kwargs)
    original_fstat = os.fstat
    state = {"changed": False}
    def fake(fd):
        info = original_fstat(fd)
        return stat_with(info, st_ctime_ns=info.st_ctime_ns + 1) if state["changed"] else info
    monkeypatch.setattr(os, "fstat", fake)
    def hook(handle, size):
        result = handle.read(size)
        state["changed"] = True
        return result
    handles = wrap_read(monkeypatch, source, hook)
    with pytest.raises(StillReviewError): reader.sha256(source)
    assert handles and all(h.actual.closed for h in handles)


@pytest.mark.parametrize("kind", ["temporary", "final"])
def test_d_reparse_or_directory_entry_refuses(tmp_path, monkeypatch, kind):
    kwargs, source, _, _, d = setup(tmp_path)
    reader, _ = writer(kwargs)
    path = d / ("rulings.json.tmp" if kind == "temporary" else "rulings.json")
    path.write_bytes(b"{}")
    original = os.lstat
    def faked(p, *a, **k):
        info = original(p, *a, **k)
        return stat_with(info, st_file_attributes=info.st_file_attributes | 0x400) if Path(p) == path else info
    monkeypatch.setattr(os, "lstat", faked)
    with pytest.raises(StillReviewError): reader.file(source)
    poison_assert(reader, source)


@pytest.mark.parametrize("name", ["rulings.json.tmp", "rulings.json"])
def test_d_new_directories_never_accepted(tmp_path, name):
    kwargs, source, _, _, d = setup(tmp_path)
    reader, _ = writer(kwargs)
    (d / name).mkdir()
    with pytest.raises(StillReviewError): reader.file(source)


@pytest.mark.parametrize("name", ["accepted-checkpoint.json", "rejection-lineage.json", "surprise.json"])
def test_forbidden_or_unexpected_d_entry(tmp_path, name):
    kwargs, source, _, _, d = setup(tmp_path)
    reader, _ = writer(kwargs)
    (d / name).write_bytes(b"{}")
    with pytest.raises(StillReviewError): reader.file(source)


def test_deleted_original_d_entry_and_temp_operand(tmp_path):
    kwargs, source, original, _, d = setup(tmp_path)
    reader, baseline = writer(kwargs)
    with pytest.raises(StillReviewError): reader.file(d / "rulings.json.tmp")
    poison_assert(reader, source)
    fresh = StillReviewReads(**kwargs, baseline=baseline, phase="W")
    original.unlink()
    with pytest.raises(StillReviewError): fresh.file(source)


def test_bounded_scandir_stops_at_first_excess_entry(tmp_path, monkeypatch):
    kwargs, *_ = setup(tmp_path)
    kwargs["limits"] = StillReviewLimits(max_directory_entries=2)
    original = os.scandir
    yielded = []
    # Actual three original files: no fabricated identities, just instrument the
    # iterator count to prove it stops without materializing the entire listing.
    d = kwargs["mutation_directory"]
    (d / "a").write_bytes(b"x")
    (d / "b").write_bytes(b"x")
    class Wrapped:
        def __init__(self): self.scan = original(d)
        def __enter__(self): return self
        def __exit__(self, *args): self.scan.close()
        def __iter__(self):
            for entry in self.scan:
                yielded.append(entry.name)
                yield entry
    monkeypatch.setattr(os, "scandir", lambda path: Wrapped())
    with pytest.raises(StillReviewError): StillReviewReads(**kwargs)
    assert len(yielded) == 3


def test_stream_unique_and_operation_limits_are_real(tmp_path):
    kwargs, source, original, *_ = setup(tmp_path)
    total = source.stat().st_size + original.stat().st_size
    kwargs["limits"] = StillReviewLimits(max_stream_bytes=total + source.stat().st_size)
    reader = StillReviewReads(**kwargs)
    assert reader.unique_bytes == total and reader.stream_bytes == total
    reader.sha256(source)
    assert reader.stream_bytes == total + source.stat().st_size
    with pytest.raises(StillReviewError): reader.sha256(source)
    kwargs["limits"] = StillReviewLimits(max_unique_bytes=total - 1)
    with pytest.raises(StillReviewError): StillReviewReads(**kwargs)
    kwargs["limits"] = StillReviewLimits(max_operations=1)
    with pytest.raises(StillReviewError): StillReviewReads(**kwargs)


@pytest.mark.parametrize("field", ["max_files", "max_unique_bytes", "max_stream_bytes", "max_operations", "max_directories", "max_baseline_bytes"])
@pytest.mark.parametrize("kind", ["raised", "bool", "zero"])
def test_limits_cannot_raise_or_coerce(tmp_path, field, kind):
    kwargs, *_ = setup(tmp_path)
    value = getattr(StillReviewLimits(), field) + 1 if kind == "raised" else True if kind == "bool" else 0
    kwargs["limits"] = StillReviewLimits(**{field: value})
    with pytest.raises(StillReviewError): StillReviewReads(**kwargs)


@pytest.mark.parametrize("field,raw,value", [("max_json_entries", b"[1,2,3]", 2), ("max_json_depth", b'[[[1]]]', 3), ("max_json_nodes", b"[1,2,3]", 3), ("max_json_bytes", b'{"v":1}', 6)])
def test_json_limits_and_poison(tmp_path, field, raw, value):
    kwargs, source, *_ = setup(tmp_path)
    source.write_bytes(raw)
    kwargs["limits"] = StillReviewLimits(**{field: value})
    reader = StillReviewReads(**kwargs)
    with pytest.raises(StillReviewError): reader.read_json(source)
    poison_assert(reader, source)


def test_shared_ancestors_are_operands_but_never_file_roots(tmp_path):
    kwargs, source, *_ = setup(tmp_path)
    parent = kwargs["persona_root"].parent
    kwargs["directories"] = (parent, parent.parent)
    reader = StillReviewReads(**kwargs)
    now = parent.stat()
    os.utime(parent, ns=(now.st_atime_ns, now.st_mtime_ns + 2_000_000_000))
    assert reader.resolve(parent) == parent
    assert reader.resolve(kwargs["persona_root"]) == kwargs["persona_root"]
    reader.recheck()
    with pytest.raises(StillReviewError): reader.file(parent / "unadmitted.json")


def test_raw_parent_and_lexical_aliases_refuse(tmp_path):
    kwargs, *_ = setup(tmp_path)
    reader = StillReviewReads(**kwargs)
    with pytest.raises(StillReviewError): reader.resolve(kwargs["persona_root"] / "..")


def test_baseline_output_cap_is_enforced(tmp_path):
    kwargs, *_ = setup(tmp_path)
    kwargs["limits"] = StillReviewLimits(max_baseline_bytes=1)
    reader = StillReviewReads(**kwargs)
    with pytest.raises(StillReviewError): reader.export_baseline()




# Native repairs after the incomplete Sonnet delivery; original 67 cases above
# remain intact. These tests exercise real bounded streams and filesystem state.
def deferred_fixture(tmp_path, *, limits=None):
    kwargs, source, original, absent, d = setup(tmp_path, limits=limits)
    b = source.with_name("second.bin")
    b.write_bytes(b"second")  # Existing before the first strict directory snapshot.
    return kwargs, source, original, absent, d, b


def test_deferred_preserves_originals_and_cumulative_budget(tmp_path):
    kwargs, source, original, absent, d, b = deferred_fixture(tmp_path)
    reader = StillReviewReads(**kwargs, defer_admission=True)
    assert not reader.admission_sealed and reader.phase == "P"
    records = dict(reader._files)
    dirs = dict(reader._dir_stamps)
    assert reader.read_json(source) == {"v": 1}
    used, ops, unique = reader.stream_bytes, reader.operations, reader.unique_bytes
    reader.finalize_admission(members=(ReadMember(b, 64),), directories=(source.parent,))
    assert reader.admission_sealed
    assert reader.stream_bytes > used and reader.operations > ops
    assert reader.unique_bytes == unique + len(b.read_bytes())
    assert all(reader._files[k] is v for k, v in records.items())
    assert all(reader._dir_stamps[k] == v for k, v in dirs.items())
    raw = reader.export_baseline()
    data = json.loads(raw)
    for key, rec in records.items():
        assert data["files"][key] == (None if rec is None else {
            "named": router_module._fp_export(rec.named),
            "opened": router_module._fp_export(rec.opened), "digest": rec.digest})
    stamp = data["files"][router_module._key(source)]["named"]
    assert int(stamp["modified"]) > 2 ** 53 and isinstance(stamp["modified"], str)
    imported = StillReviewReads(**(kwargs | {"members": (*kwargs["members"], ReadMember(b, 64))}),
                                baseline=raw, phase="W")
    assert imported.admission_sealed and imported.phase == "W"


def test_unsealed_export_is_sticky_refusal(tmp_path):
    kwargs, source, *_ = deferred_fixture(tmp_path)
    reader = StillReviewReads(**kwargs, defer_admission=True)
    with pytest.raises(StillReviewError):
        reader.export_baseline()
    with pytest.raises(StillReviewError):
        reader.finalize_admission()
    poison_assert(reader, source)


@pytest.mark.parametrize("flag", [None, 0, 1, "true", []])
def test_defer_flag_exact_bool(tmp_path, flag):
    kwargs, *_ = deferred_fixture(tmp_path)
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs, defer_admission=flag)


@pytest.mark.parametrize("phase", ["P", "W", "I"])
def test_imported_readers_cannot_defer_or_expand(tmp_path, phase):
    kwargs, *_ = deferred_fixture(tmp_path)
    p = StillReviewReads(**kwargs).export_baseline()
    baseline = p if phase in ("P", "W") else StillReviewReads(**kwargs, baseline=p, phase="W").export_baseline()
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs, baseline=baseline, phase=phase, defer_admission=True)
    reader = StillReviewReads(**kwargs, baseline=baseline, phase=phase)
    assert reader.admission_sealed
    with pytest.raises(StillReviewError):
        reader.finalize_admission()
    assert reader.poisoned


@pytest.mark.parametrize("kind", ["normal", "finalized"])
def test_sealed_admission_never_reopens(tmp_path, kind):
    kwargs, *_ = deferred_fixture(tmp_path)
    reader = StillReviewReads(**kwargs, defer_admission=kind == "finalized")
    if kind == "finalized":
        reader.finalize_admission()
    with pytest.raises(StillReviewError):
        reader.finalize_admission()
    assert reader.poisoned and reader.admission_sealed


@pytest.mark.parametrize("kind", ["duplicate-b", "existing-a", "replace-a", "list", "directory-duplicate", "file-directory"])
def test_invalid_admission_fails_before_opening_b(tmp_path, monkeypatch, kind):
    kwargs, source, _, _, _, b = deferred_fixture(tmp_path)
    reader = StillReviewReads(**kwargs, defer_admission=True)
    members, dirs = (ReadMember(b, 64),), ()
    if kind == "duplicate-b": members *= 2
    if kind == "existing-a": members = (kwargs["members"][0],)
    if kind == "replace-a": members = (ReadMember(source, 2048),)
    if kind == "list": members = list(members)
    if kind == "directory-duplicate": dirs = (source.parent, source.parent)
    if kind == "file-directory": dirs = (source,)
    actual_open = Path.open
    opened = []
    def tracked(path, *args, **kwargs):
        opened.append(path)
        return actual_open(path, *args, **kwargs)
    monkeypatch.setattr(Path, "open", tracked)
    with pytest.raises(StillReviewError):
        reader.finalize_admission(members=members, directories=dirs)
    assert b not in opened and reader.poisoned


@pytest.mark.parametrize("kind", ["same-byte", "absent", "directory", "during-b"])
def test_admission_cannot_rebase_a_or_original_directory(tmp_path, monkeypatch, kind):
    kwargs, source, _, absent, _, b = deferred_fixture(tmp_path)
    reader = StillReviewReads(**kwargs, defer_admission=True)
    original_record = reader._files[router_module._key(source)]
    if kind == "same-byte":
        original_bytes = source.read_bytes()
        replacement = source.with_name("replacement.bin")
        replacement.write_bytes(original_bytes)
        os.replace(replacement, source)
    elif kind == "absent":
        absent.write_bytes(b"{}")
    elif kind == "directory":
        source.with_name("unrelated.bin").write_bytes(b"x")
    else:
        actual_open = Path.open
        def changed(path, *args, **kwargs):
            handle = actual_open(path, *args, **kwargs)
            if path == b:
                with actual_open(source, "wb") as writer_handle:
                    writer_handle.write(b'{"v":2}')
            return handle
        monkeypatch.setattr(Path, "open", changed)
    with pytest.raises(StillReviewError):
        reader.finalize_admission(members=(ReadMember(b, 64),))
    assert reader._files[router_module._key(source)] is original_record
    assert reader.poisoned and not reader.admission_sealed


@pytest.mark.parametrize("cap", ["files", "unique", "stream", "directories"])
def test_admission_aggregate_caps_do_not_reset(tmp_path, cap):
    kwargs, source, _, _, _, b = deferred_fixture(tmp_path)
    if cap == "files":
        kwargs["limits"] = StillReviewLimits(max_files=len(kwargs["members"]))
    elif cap == "unique":
        kwargs["limits"] = StillReviewLimits(max_unique_bytes=source.stat().st_size + kwargs["members"][1].path.stat().st_size + b.stat().st_size - 1)
    elif cap == "stream":
        total = source.stat().st_size + kwargs["members"][1].path.stat().st_size
        kwargs["limits"] = StillReviewLimits(max_stream_bytes=total * 2 + b.stat().st_size - 1)
    else:
        # Add an existing deeper role path before A captures its ancestors.
        nested = source.parent / "new-dir" / "child"
        nested.mkdir(parents=True)
        b = nested / "second.bin"
        b.write_bytes(b"b")
        initial = StillReviewReads(**kwargs)
        kwargs["limits"] = StillReviewLimits(max_directories=len(initial._directory_paths))
    reader = StillReviewReads(**kwargs, defer_admission=True)
    used = reader.stream_bytes
    with pytest.raises(StillReviewError):
        reader.finalize_admission(members=(ReadMember(b, 64),))
    assert reader.stream_bytes >= used
    assert reader.stream_bytes <= kwargs["limits"].max_stream_bytes
    assert reader.unique_bytes <= kwargs["limits"].max_unique_bytes
    assert reader.poisoned


def test_read_bytes_collects_real_bytes_with_member_cap(tmp_path):
    kwargs, source, _, _, _, b = deferred_fixture(tmp_path)
    content = b"x" * (256 * 1024 + 1)
    b.write_bytes(content)
    kwargs["members"] += (ReadMember(b, len(content), True),)
    reader = StillReviewReads(**kwargs)
    used = reader.stream_bytes
    value = reader.read_bytes(b)
    assert type(value) is bytes and value == content
    assert reader.stream_bytes == used + len(content)
    assert reader.sha256(b) == hashlib.sha256(value).hexdigest()
    assert reader.stream_bytes == used + 2 * len(content)
    with pytest.raises(StillReviewError):
        reader.read_json(b)
    assert reader.poisoned


@pytest.mark.parametrize("kind", ["cap", "absent", "unadmitted", "tmp", "replacement"])
def test_binary_read_refuses_without_returning_bytes(tmp_path, kind):
    kwargs, source, _, absent, d, b = deferred_fixture(tmp_path)
    if kind == "cap":
        kwargs["members"] += (ReadMember(b, b.stat().st_size - 1),)
        with pytest.raises(StillReviewError):
            StillReviewReads(**kwargs)
        return
    reader = StillReviewReads(**kwargs)
    path = absent if kind == "absent" else b if kind == "unadmitted" else d / "rulings.json.tmp" if kind == "tmp" else source
    if kind == "replacement":
        replacement = source.with_name("replacement.bin")
        replacement.write_bytes(source.read_bytes())
        os.replace(replacement, source)
    with pytest.raises(StillReviewError):
        reader.read_bytes(path)
    assert reader.poisoned


@pytest.mark.parametrize("branch", ["keep", "cull"])
@pytest.mark.parametrize("explicit", [False, True])
@pytest.mark.parametrize("name", ["rulings.json.tmp", "approval-lineage.json.tmp", "rejection-lineage.json.tmp", "accepted-checkpoint.json.tmp"])
def test_global_temp_reservation_at_initial_p(tmp_path, branch, explicit, name):
    kwargs, _, _, _, d = setup(tmp_path, branch=branch)
    kwargs["temporary_names"] = tuple(n + ".tmp" for n in (router_module._KEEP_FINALS if branch == "keep" else router_module._CULL_FINALS)) if explicit else ()
    (d / name).write_bytes(b"old")
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs)
    assert (d / name).read_bytes() == b"old"


@pytest.mark.parametrize("branch", ["keep", "cull"])
@pytest.mark.parametrize("name", ["unrelated.bin", "accepted-checkpoint.json.tmp", "wrong-branch"])
def test_configured_temps_cannot_redefine_reserved_vocabulary(tmp_path, branch, name):
    kwargs, *_ = setup(tmp_path, branch=branch)
    if name == "wrong-branch": name = "rejection-lineage.json.tmp" if branch == "keep" else "approval-lineage.json.tmp"
    kwargs["temporary_names"] = (name,)
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs)


@pytest.mark.parametrize("branch", ["keep", "cull"])
@pytest.mark.parametrize("name", ["accepted-checkpoint.json.tmp", "wrong-branch", "unconfigured"])
def test_wrong_negative_unconfigured_temps_refuse_during_w(tmp_path, branch, name):
    kwargs, source, _, _, d = setup(tmp_path, branch=branch)
    if name == "wrong-branch": name = "rejection-lineage.json.tmp" if branch == "keep" else "approval-lineage.json.tmp"
    if name == "unconfigured": name = "review-manifest.json.tmp"
    reader, _ = writer(kwargs)
    (d / name).write_bytes(b"x")
    with pytest.raises(StillReviewError):
        reader.file(source)
    assert reader.poisoned


@pytest.mark.parametrize("boundary", ["recheck", "export"])
@pytest.mark.parametrize("branch", ["keep", "cull"])
def test_permitted_temp_is_transient_never_stable(tmp_path, branch, boundary):
    kwargs, source, _, _, d = setup(tmp_path, branch=branch)
    reader, _ = writer(kwargs)
    (d / "rulings.json.tmp").write_bytes(b"x")
    assert reader.file(source, required=True)
    with pytest.raises(StillReviewError):
        reader.recheck() if boundary == "recheck" else reader.export_baseline()
    assert reader.poisoned


@pytest.mark.parametrize("name", ["rulings.json.tmp", "accepted-checkpoint.json.tmp", "rejection-lineage.json.tmp"])
def test_global_temp_never_read_member_or_imported_original(tmp_path, name):
    kwargs, _, original, _, d = setup(tmp_path)
    baseline = StillReviewReads(**kwargs).export_baseline()
    bad = kwargs | {"members": (*kwargs["members"], ReadMember(d / name, 64, False, True))}
    with pytest.raises(StillReviewError):
        StillReviewReads(**bad)
    data = json.loads(baseline)
    data["originals"][name] = data["originals"][original.name]
    with pytest.raises(StillReviewError):
        StillReviewReads(**kwargs, baseline=json.dumps(data).encode(), phase="W")


@pytest.mark.parametrize("extra_allowance", [0, 128 * 1024])
def test_nested_publication_rechecks_budget_before_each_actual_chunk(tmp_path, monkeypatch, extra_allowance):
    root, plan, persona, pipeline, store, d = make_roots(tmp_path)
    source = pipeline / "two-mib.bin"
    source.write_bytes(b"s" * (2 * 1024 * 1024))
    final = d / "rulings.json"
    final_bytes = b" " * (128 * 1024 - 2) + b"{}"
    ceiling = 4 * 1024 * 1024 + extra_allowance
    kwargs = dict(plan_root=plan, persona_root=persona, pipeline_root=pipeline, store_root=store,
                  mutation_directory=d, branch="keep", members=(ReadMember(source, 2 * 1024 * 1024),
                  ReadMember(final, len(final_bytes), True, True)), limits=StillReviewLimits(max_stream_bytes=ceiling))
    baseline = StillReviewReads(**kwargs).export_baseline()
    reader = StillReviewReads(**kwargs, baseline=baseline, phase="W")
    initial = reader.stream_bytes
    actual_open = Path.open
    counts, published = {source: 0, final: 0}, []
    class Stream:
        def __init__(self, handle, path): self.handle, self.path = handle, path
        def __enter__(self): self.handle.__enter__(); return self
        def __exit__(self, *args): return self.handle.__exit__(*args)
        def fileno(self): return self.handle.fileno()
        def read(self, size):
            assert size <= ceiling - reader.stream_bytes
            value = self.handle.read(size)
            counts[self.path] += len(value)
            if self.path == source and not published:
                published.append(True)
                with actual_open(final, "wb") as output: output.write(final_bytes)
            return value
    def tracked(path, *args, **kwargs):
        handle = actual_open(path, *args, **kwargs)
        return Stream(handle, path) if path in counts and args and args[0] == "rb" else handle
    monkeypatch.setattr(Path, "open", tracked)
    if extra_allowance:
        assert reader.sha256(source) == hashlib.sha256(b"s" * (2 * 1024 * 1024)).hexdigest()
        assert reader.stream_bytes == ceiling
        assert not reader.poisoned
    else:
        with pytest.raises(StillReviewError): reader.sha256(source)
        assert reader.refusal_kind == RefusalKind.LIMIT
        assert counts[source] == 1024 * 1024
    assert counts[final] == len(final_bytes)
    assert initial + sum(counts.values()) == reader.stream_bytes <= ceiling



def test_admission_keeps_consumed_operation_budget(tmp_path):
    kwargs, source, _, _, _, b = deferred_fixture(tmp_path)
    kwargs["limits"] = StillReviewLimits(max_operations=256)
    reader = StillReviewReads(**kwargs, defer_admission=True)
    while reader.operations < 250:
        reader.resolve(source)
    before = reader.operations
    with pytest.raises(StillReviewError):
        reader.finalize_admission(members=(ReadMember(b, 64),))
    assert reader.operations > before and reader.refusal_kind == RefusalKind.LIMIT
    assert not reader.admission_sealed


@pytest.mark.parametrize("kind", ["short", "opened-change"])
def test_binary_failure_closes_handle_and_never_returns_bytes(tmp_path, monkeypatch, kind):
    kwargs, source, *_ = setup(tmp_path)
    reader = StillReviewReads(**kwargs)
    state = {"changed": False}
    actual_fstat = os.fstat
    if kind == "opened-change":
        def altered(fd):
            info = actual_fstat(fd)
            return stat_with(info, st_ctime_ns=info.st_ctime_ns + 1) if state["changed"] else info
        monkeypatch.setattr(os, "fstat", altered)
    def hook(handle, size):
        value = handle.read(0 if kind == "short" else size)
        state["changed"] = True
        return value
    handles = wrap_read(monkeypatch, source, hook)
    with pytest.raises(StillReviewError):
        reader.read_bytes(source)
    assert reader.poisoned and handles and all(h.actual.closed for h in handles)


@pytest.mark.parametrize("kind", ["member", "new-directory"])
def test_admission_reparse_refuses(tmp_path, monkeypatch, kind):
    kwargs, source, _, _, _, b = deferred_fixture(tmp_path)
    if kind == "new-directory":
        directory = source.parent / "deeper"
        directory.mkdir()
        b = directory / "b.bin"
        b.write_bytes(b"b")
    reader = StillReviewReads(**kwargs, defer_admission=True)
    target = b if kind == "member" else b.parent
    actual = os.lstat
    def reparse(path, *args, **kwargs):
        info = actual(path, *args, **kwargs)
        return stat_with(info, st_file_attributes=getattr(info, "st_file_attributes", 0) | 0x400) if Path(path) == target else info
    monkeypatch.setattr(os, "lstat", reparse)
    with pytest.raises(StillReviewError):
        reader.finalize_admission(members=(ReadMember(b, 64),))
    assert reader.poisoned and not reader.admission_sealed
