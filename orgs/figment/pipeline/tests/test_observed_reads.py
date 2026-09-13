"""Independent Windows contract tests for the explicit observed-read policy.

All data is synthetic. No checkpoints, providers, or project authority are read.
The Windows-only contract is asserted, never converted into a skipped result.
"""
from __future__ import annotations

import dataclasses
import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


PIPELINE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("figment_test_observed_reads", PIPELINE / "observed_reads.py")
assert SPEC and SPEC.loader
reads_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = reads_module
SPEC.loader.exec_module(reads_module)
ReadLimits = reads_module.ReadLimits
ReadMember = reads_module.ReadMember
ObservedReads = reads_module.ObservedReads
ObservedReadError = reads_module.ObservedReadError


@pytest.fixture(autouse=True)
def supported_platform():
    assert sys.platform == "win32", "This contract requires real Windows local filesystem semantics"


def put(root: Path, name="input.json", raw=b'{"value":1}') -> Path:
    path = root / name
    path.write_bytes(raw)
    return path


def policy(root, *paths, limits=None, optional=(), directories=(), json_allowed=True):
    return ObservedReads(
        roots=(root,),
        members=tuple(ReadMember(p, 1024, allow_json=json_allowed, optional=p in optional) for p in paths),
        directories=tuple(directories),
        limits=limits or ReadLimits(),
    )


def assert_poisoned(reader, path):
    for operation in (lambda: reader.resolve(path), lambda: reader.file(path),
                      lambda: reader.read_json(path), lambda: reader.sha256(path), reader.recheck):
        with pytest.raises(ObservedReadError):
            operation()


def test_exact_member_read_json_digest_metadata_and_seal(tmp_path):
    path = put(tmp_path)
    reader = policy(tmp_path, path)
    assert reader.resolve(path) == path
    observed = reader.file(path, required=True)
    assert observed.path == path and observed.size == 11
    assert reader.sha256(path) == hashlib.sha256(path.read_bytes()).hexdigest()
    first = reader.read_json(path)
    first["value"] = 999
    assert reader.read_json(path) == {"value": 1}
    reader.recheck()
    assert_poisoned(reader, path)
    with pytest.raises(dataclasses.FrozenInstanceError):
        observed.size = 1


@pytest.mark.parametrize("method", ["resolve", "file", "read_json", "sha256"])
def test_existing_unlisted_sibling_is_not_admitted_and_poisons(tmp_path, method, monkeypatch):
    allowed = put(tmp_path)
    sibling = put(tmp_path, "private-sibling.json")
    reader = policy(tmp_path, allowed)
    original = os.lstat
    def guarded(path, *args, **kwargs):
        assert os.path.normcase(os.fspath(path)) != os.path.normcase(str(sibling)), "unlisted path reached lstat"
        return original(path, *args, **kwargs)
    monkeypatch.setattr(os, "lstat", guarded)
    with pytest.raises(ObservedReadError):
        getattr(reader, method)(sibling)
    assert_poisoned(reader, allowed)


@pytest.mark.parametrize("spelling", [
    "relative.json", "C:relative.json", "\\root-relative.json", "\\\\server\\share\\data",
    "\\\\?\\C:\\data", "\\\\.\\NUL", "C:\\data:stream", "C:\\bad\x00name",
    "C:\\folder\\..\\data", "C:\\NUL", "C:\\con.txt", "C:\\COM1.json",
    "C:\\folder\\trailing.", "C:\\folder\\trailing ",
])
def test_unsupported_lexical_paths_refuse_before_filesystem(tmp_path, spelling, monkeypatch):
    path = put(tmp_path)
    reader = policy(tmp_path, path)
    def forbidden(*args, **kwargs):
        pytest.fail("unsupported/unlisted operand reached filesystem resolution")
    with monkeypatch.context() as patch:
        patch.setattr(Path, "resolve", forbidden)
        patch.setattr(os, "lstat", forbidden)
        with pytest.raises(ObservedReadError):
            reader.resolve(Path(spelling))
    assert_poisoned(reader, path)


def test_case_alias_returns_single_admitted_spelling(tmp_path):
    path = put(tmp_path, "MiXeD.json")
    reader = policy(tmp_path, path)
    alias = Path(str(path).swapcase())
    assert reader.resolve(alias) == path
    assert reader.sha256(alias) == hashlib.sha256(path.read_bytes()).hexdigest()
    reader.recheck()


@pytest.mark.parametrize("conflict", [False, True])
def test_duplicate_case_normalized_members_refuse(tmp_path, conflict):
    path = put(tmp_path, "Mixed.json")
    with pytest.raises(ObservedReadError):
        ObservedReads(roots=(tmp_path,), members=(ReadMember(path, 30), ReadMember(Path(str(path).swapcase()), 20 if conflict else 30)))


def test_overlapping_roots_do_not_grant_descendants(tmp_path):
    child = tmp_path / "child"
    child.mkdir()
    path = put(child)
    other = put(child, "other.json")
    reader = ObservedReads(roots=(tmp_path, child), members=(ReadMember(path, 20),), directories=(child,))
    assert reader.file(path).size == 11
    with pytest.raises(ObservedReadError):
        reader.file(other)


def test_exact_member_ancestors_are_captured_without_granting_neighbors(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    nested = root / "nested"
    nested.mkdir()
    path = put(nested)
    outside = put(tmp_path, "outside.json")
    neighbor = root / "neighbor"
    neighbor.mkdir()
    reader = policy(root, path)
    assert reader.resolve(nested) == nested
    assert reader.file(path).size == 11
    reader.recheck()
    with pytest.raises(ObservedReadError):
        policy(root, path).resolve(neighbor)
    with pytest.raises(ObservedReadError):
        policy(root, outside)
    with pytest.raises(ObservedReadError):
        policy(root, path, directories=(tmp_path, nested))


def test_root_count_path_depth_and_directory_member_refuse(tmp_path):
    roots = tuple(tmp_path / str(i) for i in range(4))
    for root in roots:
        root.mkdir()
    with pytest.raises(ObservedReadError):
        ObservedReads(roots=roots, members=())
    with pytest.raises(ObservedReadError):
        policy(tmp_path, roots[0]).file(roots[0])
    deep = tmp_path.joinpath(*("x" for _ in range(65)), "f")
    with pytest.raises(ObservedReadError):
        policy(tmp_path, deep)


def test_zero_bytes_are_metadata_and_hashable(tmp_path):
    path = put(tmp_path, raw=b"")
    reader = policy(tmp_path, path)
    assert reader.file(path, required=True).size == 0
    assert reader.sha256(path) == hashlib.sha256(b"").hexdigest()
    reader.recheck()


def test_optional_absence_is_stable_and_late_appearance_refuses(tmp_path):
    path = tmp_path / "absent.json"
    reader = policy(tmp_path, path, optional=(path,))
    assert reader.file(path) is None
    reader.recheck()
    reader = policy(tmp_path, path, optional=(path,))
    assert reader.file(path) is None
    path.write_bytes(b"new")
    with pytest.raises(ObservedReadError):
        reader.recheck()


@pytest.mark.parametrize("method", ["required", "sha256", "read_json"])
def test_optional_absence_never_satisfies_required_content(tmp_path, method):
    path = tmp_path / "absent.json"
    reader = policy(tmp_path, path, optional=(path,))
    with pytest.raises(ObservedReadError):
        reader.file(path, required=True) if method == "required" else getattr(reader, method)(path)
    assert_poisoned(reader, path)


def test_missing_parent_is_not_optional_leaf_absence(tmp_path):
    parent = tmp_path / "missing"
    path = parent / "optional.json"
    with pytest.raises(ObservedReadError):
        policy(tmp_path, path, directories=(parent,), optional=(path,)).file(path)


def test_absence_parent_metadata_change_refuses_even_when_leaf_stays_absent(tmp_path):
    path = tmp_path / "absent.json"
    reader = policy(tmp_path, path, optional=(path,))
    assert reader.file(path) is None
    before = tmp_path.stat()
    os.utime(tmp_path, ns=(before.st_atime_ns, before.st_mtime_ns + 2_000_000_000))
    with pytest.raises(ObservedReadError):
        reader.recheck()


@pytest.mark.parametrize("change", ["bytes", "same-bytes", "replace", "remove"])
def test_original_file_identity_and_bytes_are_retained(tmp_path, change):
    path = put(tmp_path)
    replacement = put(tmp_path, "replacement.json", b'{"value":2}')
    reader = policy(tmp_path, path)
    reader.sha256(path)
    before = path.stat()
    if change == "remove":
        path.unlink()
    elif change == "replace":
        os.replace(replacement, path)
    else:
        path.write_bytes(b'{"value":2}' if change == "bytes" else b'{"value":1}')
        os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns + 2_000_000_000))
    with pytest.raises(ObservedReadError):
        reader.recheck()
    assert_poisoned(reader, path)


def test_metadata_only_observation_refuses_same_byte_rewrite(tmp_path):
    path = put(tmp_path)
    reader = policy(tmp_path, path)
    reader.file(path)
    before = path.stat()
    path.write_bytes(path.read_bytes())
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns + 2_000_000_000))
    with pytest.raises(ObservedReadError):
        reader.file(path)


@pytest.mark.parametrize("field", [field.name for field in dataclasses.fields(ReadLimits)])
@pytest.mark.parametrize("bad", [True, 0, -1, 1.5, "1", None])
def test_limits_reject_nonpositive_or_noninteger_values(tmp_path, field, bad):
    with pytest.raises((ObservedReadError, ValueError, TypeError)):
        ObservedReads(roots=(tmp_path,), members=(), limits=ReadLimits(**{field: bad}))


@pytest.mark.parametrize("field", [field.name for field in dataclasses.fields(ReadLimits)])
def test_limits_cannot_exceed_hard_ceiling(tmp_path, field):
    with pytest.raises((ObservedReadError, ValueError, TypeError)):
        ObservedReads(roots=(tmp_path,), members=(), limits=ReadLimits(**{field: getattr(ReadLimits(), field) + 1}))


def test_policy_descriptors_are_immutable(tmp_path):
    member = ReadMember(tmp_path / "input", 10)
    with pytest.raises(dataclasses.FrozenInstanceError):
        member.max_bytes = 20
    limits = ReadLimits()
    with pytest.raises(dataclasses.FrozenInstanceError):
        limits.max_operations = 2


@pytest.mark.parametrize("field,bad", [("max_bytes", True), ("max_bytes", 0), ("max_bytes", -1), ("max_bytes", 1.5), ("allow_json", 1), ("optional", "yes")])
def test_member_restrictions_are_strict(tmp_path, field, bad):
    values = dict(path=tmp_path / "input", max_bytes=20, allow_json=False, optional=False)
    values[field] = bad
    with pytest.raises(ObservedReadError):
        ObservedReads(roots=(tmp_path,), members=(ReadMember(**values),))


@pytest.mark.parametrize("field", ["roots", "members", "directories"])
def test_constructor_rejects_mutable_policy_collections(tmp_path, field):
    args = dict(roots=(tmp_path,), members=(), directories=())
    args[field] = list(args[field])
    with pytest.raises(ObservedReadError):
        ObservedReads(**args)


def test_explicit_directory_count_is_finite_before_traversal(tmp_path):
    with pytest.raises(ObservedReadError):
        ObservedReads(roots=(tmp_path,), members=(), directories=(tmp_path,) * 257)
    reader = ObservedReads(roots=(tmp_path,), members=(), directories=(tmp_path,) * 256)
    reader.recheck()


def test_unique_count_and_sizes_charge_metadata_once(tmp_path):
    a = put(tmp_path, "a", b"123")
    b = put(tmp_path, "b", b"4567")
    reader = policy(tmp_path, a, b, limits=ReadLimits(max_files=2, max_unique_bytes=7))
    for _ in range(3):
        assert reader.file(a).size == 3
    assert reader.file(b).size == 4
    reader.recheck()
    with pytest.raises(ObservedReadError):
        reader = policy(tmp_path, a, b, limits=ReadLimits(max_files=1))
        reader.file(a)
        reader.file(b)
    reader = policy(tmp_path, a, b, limits=ReadLimits(max_unique_bytes=6))
    reader.file(a)
    with pytest.raises(ObservedReadError):
        reader.file(b)


@pytest.mark.parametrize("member_cap,global_cap", [(3, 4), (4, 3)])
def test_per_member_and_global_file_limit_are_both_enforced(tmp_path, member_cap, global_cap):
    path = put(tmp_path, raw=b"1234")
    with pytest.raises(ObservedReadError):
        reader = ObservedReads(roots=(tmp_path,), members=(ReadMember(path, member_cap),), limits=ReadLimits(max_file_bytes=global_cap))
        reader.file(path)
    reader = ObservedReads(roots=(tmp_path,), members=(ReadMember(path, 4),), limits=ReadLimits(max_file_bytes=4))
    assert reader.sha256(path) == hashlib.sha256(b"1234").hexdigest()
    reader.recheck()


def test_stream_budget_counts_repeated_reads_and_final_rehash(tmp_path):
    path = put(tmp_path, raw=b"1234")
    reader = policy(tmp_path, path, limits=ReadLimits(max_stream_bytes=12))
    reader.sha256(path)
    reader.sha256(path)
    reader.recheck()
    reader = policy(tmp_path, path, limits=ReadLimits(max_stream_bytes=11))
    reader.sha256(path)
    reader.sha256(path)
    with pytest.raises(ObservedReadError):
        reader.recheck()
    assert_poisoned(reader, path)


def test_public_operations_not_internal_calls_are_charged(tmp_path):
    path = put(tmp_path)
    reader = policy(tmp_path, path, limits=ReadLimits(max_operations=5))
    reader.resolve(path)
    reader.file(path)
    reader.read_json(path)
    reader.sha256(path)
    reader.recheck()
    reader = policy(tmp_path, path, limits=ReadLimits(max_operations=1))
    assert reader.read_json(path) == {"value": 1}
    with pytest.raises(ObservedReadError):
        reader.file(path)


@pytest.mark.parametrize("raw,field,at,over", [
    (b'{"x":[1]}', "max_json_depth", 3, 2),
    (b'[1,2]', "max_json_entries", 2, 1),
    (b'{"a":1,"b":2}', "max_json_entries", 2, 1),
    (b'{"x":[1,2]}', "max_json_nodes", 4, 3),
    (b'[123]', "max_json_bytes", 5, 4),
])
def test_json_limits_at_boundary_and_one_over(tmp_path, raw, field, at, over):
    path = put(tmp_path, raw=raw)
    reader = policy(tmp_path, path, limits=ReadLimits(**{field: at}))
    assert reader.read_json(path) == json.loads(raw)
    reader.recheck()
    reader = policy(tmp_path, path, limits=ReadLimits(**{field: over}))
    with pytest.raises(ObservedReadError):
        reader.read_json(path)
    assert_poisoned(reader, path)


@pytest.mark.parametrize("raw", [b"\xff", b"{", b"\xef\xbb\xbf{}", b"[" * 1100 + b"0" + b"]" * 1100])
def test_json_decode_parse_and_recursion_errors_poison(tmp_path, raw):
    path = put(tmp_path, raw=raw)
    reader = ObservedReads(roots=(tmp_path,), members=(ReadMember(path, 4096, allow_json=True),))
    with pytest.raises(ObservedReadError):
        reader.read_json(path)
    assert_poisoned(reader, path)


def test_json_requires_explicit_permission_and_preserves_standard_loads(tmp_path):
    path = put(tmp_path, raw=b'{"x":1,"x":2,"n":NaN}')
    reader = policy(tmp_path, path, json_allowed=False)
    with pytest.raises(ObservedReadError):
        reader.read_json(path)
    reader = policy(tmp_path, path)
    value = reader.read_json(path)
    assert value["x"] == 2 and value["n"] != value["n"]
    reader.recheck()


def test_json_scalar_is_one_node_at_depth_one(tmp_path):
    path = put(tmp_path, raw=b"0")
    reader = policy(tmp_path, path, limits=ReadLimits(max_json_depth=1, max_json_nodes=1, max_json_entries=1, max_json_bytes=1))
    assert reader.read_json(path) == 0
    reader.recheck()


def test_real_windows_junction_ancestor_is_rejected(tmp_path):
    target = tmp_path / "target"
    target.mkdir()
    put(target)
    junction = tmp_path / "junction"
    # Exact synthetic junction; do not silently substitute a non-reparse fixture.
    result = subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(junction), str(target)], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, f"required Windows junction setup unavailable: {result.stderr}"
    try:
        assert junction.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
        with pytest.raises(ObservedReadError):
            policy(tmp_path, junction / "input.json", directories=(junction,)).file(junction / "input.json")
    finally:
        # rmdir of this exact junction removes only the link, never recursively its target.
        junction.rmdir()
    assert (target / "input.json").read_bytes() == b'{"value":1}'


def stat_with(info, **changes):
    fields = {name: getattr(info, name) for name in (
        "st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_birthtime_ns", "st_mode", "st_file_attributes",
    )}
    fields.update(changes)
    return SimpleNamespace(**fields)


@pytest.mark.parametrize("changes", [
    {"st_ino": 0}, {"st_ino": None}, {"st_mode": stat.S_IFIFO | 0o600},
    {"st_mode": stat.S_IFCHR | 0o600}, {"st_mode": stat.S_IFLNK | 0o600},
    {"st_file_attributes": stat.FILE_ATTRIBUTE_REPARSE_POINT},
])
def test_unreliable_identity_nonregular_and_leaf_reparse_refuse(tmp_path, monkeypatch, changes):
    path = put(tmp_path)
    reader = policy(tmp_path, path)
    original = os.lstat
    def altered(value, *args, **kwargs):
        result = original(value, *args, **kwargs)
        return stat_with(result, **changes) if Path(value) == path else result
    monkeypatch.setattr(os, "lstat", altered)
    with pytest.raises(ObservedReadError):
        reader.file(path)
    assert_poisoned(reader, path)


def test_permission_error_is_not_optional_absence(tmp_path, monkeypatch):
    path = tmp_path / "missing.json"
    reader = policy(tmp_path, path, optional=(path,))
    original = os.lstat
    def denied(value, *args, **kwargs):
        if Path(value) == path:
            raise PermissionError(13, "synthetic denied", str(path))
        return original(value, *args, **kwargs)
    monkeypatch.setattr(os, "lstat", denied)
    with pytest.raises(ObservedReadError):
        reader.file(path)
    assert_poisoned(reader, path)


def test_ancestor_replacement_refuses(tmp_path):
    parent = tmp_path / "parent"
    parent.mkdir()
    path = put(parent)
    reader = policy(tmp_path, path)
    reader.file(path)
    parent.rename(tmp_path / "old-parent")
    parent.mkdir()
    put(parent)
    with pytest.raises(ObservedReadError):
        reader.recheck()


class TrackedHandle:
    def __init__(self, handle, read_hook=None):
        self.handle = handle
        self.read_hook = read_hook
        self.read_sizes = []
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.handle.close()
    def fileno(self):
        return self.handle.fileno()
    def read(self, size):
        self.read_sizes.append(size)
        assert 0 < size <= 1024 * 1024
        return self.read_hook(self.handle, size) if self.read_hook else self.handle.read(size)


def track_opens(monkeypatch, target, read_hook=None):
    original = Path.open
    handles = []
    def opening(path, *args, **kwargs):
        handle = original(path, *args, **kwargs)
        if path != target:
            return handle
        assert args == ("rb",) and kwargs == {"buffering": 0}
        wrapped = TrackedHandle(handle, read_hook)
        handles.append(wrapped)
        return wrapped
    monkeypatch.setattr(Path, "open", opening)
    return handles


def test_named_open_mismatch_refuses_and_closes_handle(tmp_path, monkeypatch):
    path = put(tmp_path)
    reader = policy(tmp_path, path)
    handles = track_opens(monkeypatch, path)
    original = os.fstat
    monkeypatch.setattr(os, "fstat", lambda fd: stat_with(original(fd), st_ino=original(fd).st_ino + 1))
    with pytest.raises(ObservedReadError):
        reader.file(path)
    assert handles and all(item.handle.closed for item in handles)


@pytest.mark.parametrize("fault", ["short", "oversized", "grow", "same-byte-metadata", "io-error"])
def test_stream_failures_close_handles_and_poison(tmp_path, monkeypatch, fault):
    path = put(tmp_path)
    reader = policy(tmp_path, path)
    original_open = Path.open
    def read(handle, size):
        if fault == "short":
            return b""
        if fault == "oversized":
            return b"x" * (size + 1)
        if fault == "io-error":
            raise OSError("synthetic read failure")
        data = handle.read(size)
        before = path.stat()
        if fault == "grow":
            with original_open(path, "ab") as writer:
                writer.write(b"growth")
        else:
            os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns + 2_000_000_000))
        return data
    handles = track_opens(monkeypatch, path, read)
    with pytest.raises(ObservedReadError):
        reader.sha256(path)
    assert any(item.read_sizes for item in handles)
    assert all(item.handle.closed for item in handles)
    assert_poisoned(reader, path)


def test_content_digest_rechecked_when_metadata_is_unchanged(tmp_path, monkeypatch):
    path = put(tmp_path)
    reader = policy(tmp_path, path)
    reader.sha256(path)
    # A different stream with the same real file identity must still be refused.
    # This test seam exercises retained digest comparison, not hostile-writer proof.
    def changed_valid_json(handle, size):
        data = handle.read(size)
        assert data == b'{"value":1}'
        return b'{"value":2}'
    handles = track_opens(monkeypatch, path, changed_valid_json)
    with pytest.raises(ObservedReadError):
        reader.read_json(path)
    assert all(item.handle.closed for item in handles)
    assert_poisoned(reader, path)


def test_metadata_only_recheck_reads_no_content_and_chunked_hash_closes(tmp_path, monkeypatch):
    path = put(tmp_path, raw=b"a" * (1024 * 1024 + 7))
    reader = ObservedReads(roots=(tmp_path,), members=(ReadMember(path, 2 * 1024 * 1024),))
    handles = track_opens(monkeypatch, path)
    reader.file(path)
    reader.recheck()
    assert handles and not any(item.read_sizes for item in handles)
    assert all(item.handle.closed for item in handles)
    reader = ObservedReads(roots=(tmp_path,), members=(ReadMember(path, 2 * 1024 * 1024),))
    assert reader.sha256(path) == hashlib.sha256(b"a" * (1024 * 1024 + 7)).hexdigest()
    reader.recheck()
    assert any(item.read_sizes == [1024 * 1024, 7] for item in handles)
    assert all(item.handle.closed for item in handles)


@pytest.mark.parametrize("kind", [0, 1, 4, 5])
def test_remote_unknown_and_unsupported_drive_kinds_refuse(tmp_path, monkeypatch, kind):
    import ctypes
    calls = []
    def drive_type(anchor):
        calls.append(anchor)
        return kind
    def library(name, **kwargs):
        assert name == "kernel32" and kwargs == {"use_last_error": True}
        return SimpleNamespace(GetDriveTypeW=drive_type)
    monkeypatch.setattr(ctypes, "WinDLL", library)
    with pytest.raises(ObservedReadError):
        ObservedReads(roots=(tmp_path,), members=())
    assert calls == [tmp_path.anchor]


@pytest.mark.parametrize("kind", [2, 3, 6])
def test_local_drive_check_occurs_once_for_shared_drive_roots(tmp_path, monkeypatch, kind):
    import ctypes
    child = tmp_path / "child"
    child.mkdir()
    calls = []
    def drive_type(anchor):
        calls.append(anchor)
        return kind
    monkeypatch.setattr(ctypes, "WinDLL", lambda *args, **kwargs: SimpleNamespace(GetDriveTypeW=drive_type))
    reader = ObservedReads(roots=(tmp_path, child), members=())
    reader.recheck()
    assert calls == [tmp_path.anchor]


def timestamp_seam(monkeypatch, path):
    """Keep real common identity while separating the APIs' stable ctime meanings."""
    named = os.lstat
    opened = os.fstat
    original = named(path)
    state = {"named": {}, "opened": {}, "directory": {}}
    def named_info(value, *args, **kwargs):
        info = named(value, *args, **kwargs)
        if Path(value) == path:
            values = {"st_ctime_ns": original.st_birthtime_ns}
            values.update(state["named"])
            return stat_with(info, **values)
        if Path(value) == path.parent and state["directory"]:
            return stat_with(info, **state["directory"])
        return info
    def opened_info(fd):
        info = opened(fd)
        if info.st_ino == original.st_ino and info.st_dev == original.st_dev:
            values = {"st_ctime_ns": original.st_birthtime_ns + 1000}
            values.update(state["opened"])
            return stat_with(info, **values)
        return info
    monkeypatch.setattr(os, "lstat", named_info)
    monkeypatch.setattr(os, "fstat", opened_info)
    return state, original


def test_distinct_stable_named_and_opened_ctimes_allow_all_observations(tmp_path, monkeypatch):
    path = put(tmp_path)
    timestamp_seam(monkeypatch, path)
    reader = policy(tmp_path, path)
    assert reader.resolve(path) == path
    assert reader.file(path).size == 11
    assert reader.sha256(path) == hashlib.sha256(b'{"value":1}').hexdigest()
    assert reader.read_json(path) == {"value": 1}
    reader.recheck()


@pytest.mark.parametrize("api", ["named", "opened", "directory"])
@pytest.mark.parametrize("operation", ["file", "sha256", "recheck"])
def test_each_original_api_ctime_is_retained(tmp_path, monkeypatch, api, operation):
    path = put(tmp_path)
    state, original = timestamp_seam(monkeypatch, path)
    reader = policy(tmp_path, path)
    reader.file(path)
    # Only one API's ctime changes. Size, bytes, birthtime and other fields stay put.
    baseline = path.parent.lstat().st_ctime_ns if api == "directory" else original.st_birthtime_ns
    state[api]["st_ctime_ns"] = baseline + 2000
    with pytest.raises(ObservedReadError):
        reader.recheck() if operation == "recheck" else getattr(reader, operation)(path)
    assert_poisoned(reader, path)


@pytest.mark.parametrize("api", ["named", "opened"])
def test_each_api_ctime_change_during_stream_refuses_and_closes(tmp_path, monkeypatch, api):
    path = put(tmp_path)
    state, original = timestamp_seam(monkeypatch, path)
    reader = policy(tmp_path, path)
    reader.file(path)
    def changed(handle, size):
        raw = handle.read(size)
        state[api]["st_ctime_ns"] = original.st_birthtime_ns + 2000
        return raw
    handles = track_opens(monkeypatch, path, changed)
    with pytest.raises(ObservedReadError):
        reader.sha256(path)
    assert any(item.read_sizes for item in handles), "must reach the stream before mutation"
    assert all(item.handle.closed for item in handles)
    assert_poisoned(reader, path)


@pytest.mark.parametrize("api", ["named", "opened"])
@pytest.mark.parametrize("operation", ["file", "sha256", "recheck"])
def test_birthtime_only_change_never_passes_common_identity(tmp_path, monkeypatch, api, operation):
    path = put(tmp_path)
    state, original = timestamp_seam(monkeypatch, path)
    reader = policy(tmp_path, path)
    reader.file(path)
    state[api]["st_birthtime_ns"] = original.st_birthtime_ns + 1
    with pytest.raises(ObservedReadError):
        reader.recheck() if operation == "recheck" else getattr(reader, operation)(path)
    assert_poisoned(reader, path)


@pytest.mark.parametrize("api", ["named", "opened", "directory"])
@pytest.mark.parametrize("birthtime", [None, True, -1, 1.5, "1", "missing"])
def test_missing_or_malformed_birthtime_refuses_without_substitution(tmp_path, monkeypatch, api, birthtime):
    path = put(tmp_path)
    original_named = os.lstat
    original_opened = os.fstat
    def altered(info):
        value = stat_with(info, st_birthtime_ns=birthtime)
        if birthtime == "missing":
            del value.st_birthtime_ns
        return value
    def named(value, *args, **kwargs):
        info = original_named(value, *args, **kwargs)
        target = path.parent if api == "directory" else path
        return altered(info) if api != "opened" and Path(value) == target else info
    monkeypatch.setattr(os, "lstat", named)
    if api == "opened":
        monkeypatch.setattr(os, "fstat", lambda fd: altered(original_opened(fd)))
    with pytest.raises(ObservedReadError):
        policy(tmp_path, path).file(path)


def test_real_windows_creation_and_change_times_are_compatible(tmp_path):
    import time
    path = put(tmp_path)
    # A small deliberate clock separation gives the real file a later ChangeTime.
    # No mocked stat, adjusted birthtime or unsupported-platform skip is used.
    time.sleep(0.02)
    path.write_bytes(b'{"value":1}')
    named = path.lstat()
    with path.open("rb", buffering=0) as handle:
        opened = os.fstat(handle.fileno())
    assert named.st_birthtime_ns == opened.st_birthtime_ns
    assert opened.st_ctime_ns > opened.st_birthtime_ns
    assert named.st_ctime_ns != opened.st_ctime_ns, "actual admitted Python 3.12 API distinction must be exercised"
    reader = policy(tmp_path, path)
    assert reader.file(path).size == 11
    assert reader.sha256(path) == hashlib.sha256(b'{"value":1}').hexdigest()
    reader.recheck()
