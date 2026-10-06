"""Opt-in case metadata checks over real Windows paths and bounded scanner seams."""
import importlib.util
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

HERE = Path(__file__).parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


obs = load("case_observed_reads_test", "observed_reads.py")
gen = load("case_gen_source_router_test", "gen_source_read.py")


def make(root, path, *, optional=False, exact_case=True, roots=None, **limits):
    return obs.ObservedReads(roots=roots or (root,),
        members=(obs.ReadMember(path, 32, True, optional, True, exact_case),), limits=obs.ReadLimits(**limits))


def forbidden(*args, **kwargs):
    raise AssertionError("unexpected I/O")


class Scanner:
    def __init__(self, names, *, hook=None):
        self.names = iter(names)
        self.hook = hook
        self.closed = False
        self.probes = 0
    def __enter__(self): return self
    def __exit__(self, *args): self.closed = True
    def __next__(self):
        self.probes += 1
        if self.hook: self.hook(self.probes)
        name = next(self.names)
        if isinstance(name, Exception): raise name
        return SimpleNamespace(name=name, stat=forbidden)


def scanners(monkeypatch, by_parent, *, hook=None):
    opened = []
    def scan(path):
        item = Scanner(by_parent(path) if callable(by_parent) else by_parent[obs._key(path)], hook=hook)
        opened.append((path, item))
        return item
    monkeypatch.setattr(os, "scandir", scan)
    return opened


def put(root, name="Leaf"):
    path = root / name
    path.write_bytes(b'{}')
    return path


def test_default_off_no_scanner_or_permission_change(tmp_path, monkeypatch):
    path = put(tmp_path)
    member = obs.ReadMember(path, 32, True, False, True)
    assert member.exact_case is False
    monkeypatch.setattr(os, "scandir", forbidden)
    item = obs.ObservedReads(roots=(tmp_path,), members=(member,))
    assert item.read_bytes(path.with_name("leaf")) == b'{}'
    item.recheck()


@pytest.mark.parametrize("bad", [0, 1, None, "true", [], {}, 1.0])
def test_exact_case_requires_bool(tmp_path, bad):
    with pytest.raises(obs.ObservedReadError, match="per-member"):
        make(tmp_path, tmp_path / "Leaf", exact_case=bad)


def test_constructor_never_enumerates(tmp_path, monkeypatch):
    path = put(tmp_path)
    monkeypatch.setattr(os, "scandir", forbidden)
    make(tmp_path, path)


def test_exact_spelling_reuses_snapshot_then_really_rescans(tmp_path, monkeypatch):
    path = put(tmp_path)
    item = make(tmp_path, path)
    original = os.scandir
    calls = []
    def scan(p):
        calls.append(p)
        return original(p)
    monkeypatch.setattr(os, "scandir", scan)
    assert item.read_bytes(path) == b'{}'
    assert item.read_bytes(path) == b'{}'
    assert len(calls) == 1 and item._stream_bytes == 4
    item.recheck()
    assert len(calls) == 2 and item._stream_bytes == 6
    assert item._case_probes == 4 and item._case_unique_entries == 1
    assert item._case_unique_name_bytes == 4 and item._case_stream_name_bytes == 8
    with pytest.raises(obs.ObservedReadError, match="sealed"):
        item.file(path)


@pytest.mark.parametrize("admission_wrong,operand_wrong", [(False, True), (True, True), (True, False)])
def test_wrong_case_claims_and_operands_refuse(tmp_path, admission_wrong, operand_wrong):
    path = put(tmp_path)
    item = make(tmp_path, path.with_name("leaf") if admission_wrong else path)
    with pytest.raises(obs.ObservedReadError, match="exact-case"):
        item.read_bytes(path.with_name("leaf") if operand_wrong else path)


def test_directory_operand_restriction_and_intermediate_case(tmp_path, monkeypatch):
    parent = tmp_path / "Sub"
    parent.mkdir()
    path = put(parent)
    item = make(tmp_path, path)
    with monkeypatch.context() as guard:
        guard.setattr(Path, "open", forbidden)
        assert item.resolve(parent) == parent
    with pytest.raises(obs.ObservedReadError, match="spelling"):
        item.resolve(tmp_path / "sub")
    item = make(tmp_path, tmp_path / "sub" / "Leaf")
    with pytest.raises(obs.ObservedReadError, match="entry unavailable"):
        item.read_bytes(tmp_path / "sub" / "Leaf")


def test_longest_overlapping_root_is_trusted_boundary(tmp_path, monkeypatch):
    parent = tmp_path / "Configured"
    parent.mkdir()
    path = put(parent)
    item = make(tmp_path, path, roots=(tmp_path, parent))
    opened = scanners(monkeypatch, {obs._key(parent): ["Leaf"]})
    assert item.read_bytes(path) == b'{}'
    item.recheck()
    assert [p for p, _ in opened] == [parent, parent]
    # Parent spelling is caller-owned: no attempt scans tmp_path to verify it.


def test_optional_absent_and_wrongcase_present(tmp_path):
    absent = tmp_path / "Leaf"
    item = make(tmp_path, absent, optional=True)
    assert item.file(absent) is None
    item.recheck()
    put(tmp_path, "leaf")
    item = make(tmp_path, absent, optional=True)
    with pytest.raises(obs.ObservedReadError, match="entry unavailable"):
        item.file(absent)


def test_missing_ancestor_is_not_optional(tmp_path):
    with pytest.raises(obs.ObservedReadError):
        make(tmp_path, tmp_path / "Missing" / "Leaf", optional=True)


@pytest.mark.parametrize("final_names", [["Leaf"], ["leaf"]])
def test_optional_absence_fresh_final_scan_even_unchanged_metadata(tmp_path, monkeypatch, final_names):
    path = tmp_path / "Leaf"
    item = make(tmp_path, path, optional=True)
    opened = scanners(monkeypatch, lambda p: [] if item._case_scans == 1 else final_names)
    assert item.file(path) is None
    with pytest.raises(obs.ObservedReadError, match="exact-case"):
        item.recheck()
    assert len(opened) == 2 and all(s.closed for _, s in opened)


@pytest.mark.parametrize("mode", ["late-collision", "final-collision", "iterator-error"])
def test_full_scan_late_collision_final_scan_and_closed_errors(tmp_path, monkeypatch, mode):
    path = put(tmp_path)
    item = make(tmp_path, path)
    def names(p):
        if mode == "iterator-error": return ["Leaf", OSError("private name must not leak")]
        if mode == "late-collision" or item._case_scans > 1: return ["Leaf", "unrelated", "leaf"]
        return ["Leaf"]
    opened = scanners(monkeypatch, names)
    with pytest.raises(obs.ObservedReadError) as error:
        item.read_bytes(path)
        item.recheck()
    assert "private name" not in str(error.value)
    assert all(s.closed for _, s in opened)
    assert opened[-1][1].probes >= 2


@pytest.mark.parametrize("field,needed", [
    ("max_case_entries_per_directory", 2), ("max_case_directories", 2),
    ("max_case_unique_entries", 4), ("max_case_unique_name_bytes", 11),
    ("max_case_name_bytes", 5), ("max_case_scans", 4),
    ("max_case_probes", 12), ("max_case_stream_name_bytes", 22),
])
@pytest.mark.parametrize("delta", [-1, 0, 1])
def test_metadata_limit_boundaries_close_all_iterators(tmp_path, monkeypatch, field, needed, delta):
    parent = tmp_path / "Child"
    parent.mkdir()
    path = put(parent, "Leaf")
    item = make(tmp_path, path, **{field: needed + delta})
    opened = scanners(monkeypatch, {obs._key(tmp_path): ["Child", "a"], obs._key(parent): ["Leaf", "b"]})
    if delta < 0:
        with pytest.raises(obs.ObservedReadError, match="budget"):
            item.read_bytes(path)
            item.recheck()
    else:
        assert item.read_bytes(path) == b'{}'
        item.recheck()
    assert opened and all(s.closed for _, s in opened)


def test_limit_plus_one_is_charged_and_closed(tmp_path, monkeypatch):
    path = put(tmp_path)
    item = make(tmp_path, path, max_case_entries_per_directory=1)
    opened = scanners(monkeypatch, {obs._key(tmp_path): ["Leaf", "extra"]})
    with pytest.raises(obs.ObservedReadError, match="budget"):
        item.file(path)
    assert item._case_probes == 2 and item._case_unique_entries == 2
    assert item._case_stream_name_bytes == 9 and opened[0][1].closed


@pytest.mark.parametrize("badname", ["\ud800", None, "x" * 4097], ids=["surrogate", "nonstring", "too-long"])
def test_malformed_name_poison_and_close(tmp_path, monkeypatch, badname):
    path = put(tmp_path)
    item = make(tmp_path, path)
    opened = scanners(monkeypatch, {obs._key(tmp_path): ["Leaf", badname]})
    with pytest.raises(obs.ObservedReadError): item.file(path)
    assert opened[0][1].closed
    with pytest.raises(obs.ObservedReadError, match="poisoned"): item.recheck()


@pytest.mark.parametrize("when", ["during", "reuse", "final"])
def test_directory_change_never_refreshes_snapshot(tmp_path, monkeypatch, when):
    path = put(tmp_path)
    item = make(tmp_path, path)
    def mutate():
        current = tmp_path.stat()
        os.utime(tmp_path, ns=(current.st_atime_ns, current.st_mtime_ns + 2000000000))
    def hook(probe):
        if when == "during" and probe == 1: mutate()
    opened = scanners(monkeypatch, {obs._key(tmp_path): ["Leaf"]}, hook=hook)
    with pytest.raises(obs.ObservedReadError, match="directory identity"):
        item.read_bytes(path)
        mutate()
        item.recheck() if when == "final" else item.file(path)
    assert all(s.closed for _, s in opened)


def test_unknown_operands_do_not_scan(tmp_path, monkeypatch):
    path = put(tmp_path)
    item = make(tmp_path, path)
    monkeypatch.setattr(os, "scandir", forbidden)
    with pytest.raises(obs.ObservedReadError, match="not admitted"):
        item.resolve(tmp_path / "other")


@pytest.mark.parametrize("first,second", [(False, True), (True, False), (False, 0), (True, 1)])
def test_router_case_duplicate_validation(tmp_path, first, second):
    path = put(tmp_path)
    router = gen._Router(obs)
    router.admit((tmp_path,), (obs.ReadMember(path, 32, exact_case=first),), (), obs.ReadLimits())
    with pytest.raises(gen._Refusal):
        router.admit((tmp_path,), (obs.ReadMember(path, 32, exact_case=second),), (), obs.ReadLimits())
    with pytest.raises(gen._Refusal, match="poisoned"): router.resolve(path)


@pytest.mark.parametrize("wrong_owner_spelling", [False, True])
def test_router_later_exact_ancestor_retains_restriction_and_canonical_output(tmp_path, wrong_owner_spelling):
    parent = tmp_path / "Sub"
    parent.mkdir()
    old, new = put(parent, "old"), put(parent, "new")
    first_path = tmp_path / "sub" / "old" if wrong_owner_spelling else old
    router = gen._Router(obs)
    router.admit((tmp_path,), (obs.ReadMember(first_path, 32),), (), obs.ReadLimits())
    primary = router._dirs[obs._key(parent)]
    router.admit((tmp_path,), (obs.ReadMember(new, 32, exact_case=True),), (), obs.ReadLimits())
    strict = router._exact_dirs[obs._key(parent)]
    assert primary is not strict and router._dirs[obs._key(parent)] is primary
    assert str(router.resolve(parent)) == str(parent)
    assert primary._operations == 1 and strict._operations == 1
    with pytest.raises(obs.ObservedReadError, match="spelling"):
        router.resolve(tmp_path / "sub")
    with pytest.raises(gen._Refusal, match="poisoned"): router.recheck()


def test_router_conflicting_strict_directory_spellings_refuse(tmp_path):
    parent = tmp_path / "Sub"
    parent.mkdir()
    a, b = put(parent, "a"), put(parent, "b")
    router = gen._Router(obs)
    router.admit((tmp_path,), (obs.ReadMember(a, 32, exact_case=True),), (), obs.ReadLimits())
    with pytest.raises(gen._Refusal, match="conflicting exact-case directory"):
        router.admit((tmp_path,), (obs.ReadMember(tmp_path / "sub" / "b", 32, exact_case=True),), (), obs.ReadLimits())
    with pytest.raises(gen._Refusal, match="poisoned"): router.resolve(parent)


def test_actual_case_sensitive_sibling_collision_when_supported(tmp_path):
    path = put(tmp_path)
    try:
        with path.with_name("leaf").open("xb") as handle: handle.write(b'{}')
    except FileExistsError:
        pytest.skip("This directory is case-insensitive; actual case-sensitive sibling fixture unavailable; scanner seam covered separately")
    item = make(tmp_path, path)
    with pytest.raises(obs.ObservedReadError, match="entry unavailable"):
        item.read_bytes(path)


def test_router_strict_directory_different_trusted_root_refuses(tmp_path):
    nested = tmp_path / "Nested"
    nested.mkdir()
    parent = nested / "Sub"
    parent.mkdir()
    a, b = put(parent, "a"), put(parent, "b")
    router = gen._Router(obs)
    router.admit((nested,), (obs.ReadMember(a, 32, exact_case=True),), (), obs.ReadLimits())
    with pytest.raises(gen._Refusal, match="conflicting exact-case directory"):
        router.admit((tmp_path,), (obs.ReadMember(b, 32, exact_case=True),), (), obs.ReadLimits())
    with pytest.raises(gen._Refusal, match="poisoned"): router.resolve(parent)


def test_real_1025_entry_directory_refuses_at_default_cap(tmp_path):
    path = put(tmp_path)
    for index in range(1024):
        (tmp_path / f"sibling-{index}").touch()
    item = make(tmp_path, path)
    with pytest.raises(obs.ObservedReadError, match="metadata budget"):
        item.file(path)
    assert item._case_probes == 1025 and item._case_unique_entries == 1025


def test_reparse_drift_before_cached_case_reuse_refuses(tmp_path, monkeypatch):
    path = put(tmp_path)
    item = make(tmp_path, path)
    assert item.read_bytes(path) == b'{}'
    original = os.lstat
    def changed(p, *args, **kwargs):
        info = original(p, *args, **kwargs)
        if Path(p) != tmp_path: return info
        values = {name: getattr(info, name) for name in dir(info) if name.startswith('st_')}
        values['st_file_attributes'] |= 0x400
        return SimpleNamespace(**values)
    monkeypatch.setattr(os, "lstat", changed)
    with pytest.raises(obs.ObservedReadError, match="reparse"):
        item.file(path)
    assert item._case_scans == 1
