"""Explicit raw-byte capability; synthetic Windows data, no authority integration."""
import dataclasses
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import sys
from types import SimpleNamespace

import pytest

PIPELINE = Path(__file__).parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, PIPELINE / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


obs = load("raw_observed_reads_test", "observed_reads.py")
gen = load("raw_gen_source_router_test", "gen_source_read.py")
MIB = 1024 * 1024


def reader(root, path, *, max_bytes=32 * MIB, allow_bytes=True, allow_json=False, optional=False, **limits):
    return obs.ObservedReads(roots=(root,), members=(obs.ReadMember(path, max_bytes, allow_json, optional, allow_bytes),),
                             limits=obs.ReadLimits(**limits))


def forbidden(*args, **kwargs):
    raise AssertionError("unexpected filesystem/content access")


def poisoned(item, path):
    for call in (lambda: item.read_bytes(path), lambda: item.sha256(path), item.recheck):
        with pytest.raises(obs.ObservedReadError):
            call()


@pytest.mark.parametrize("json_allowed", [False, True])
def test_old_positional_policy_never_grants_raw_bytes(tmp_path, monkeypatch, json_allowed):
    path = tmp_path / "input.json"
    path.write_bytes(b'{}')
    member = obs.ReadMember(path, 2, json_allowed, True)
    assert member.allow_json is json_allowed and member.optional is True and member.allow_bytes is False
    item = obs.ObservedReads(roots=(tmp_path,), members=(member,))
    with monkeypatch.context() as guard:
        guard.setattr(Path, "open", forbidden)
        guard.setattr(item, "_stream", forbidden)
        with pytest.raises(obs.ObservedReadError, match="not admitted for raw bytes"):
            item.read_bytes(path)
    poisoned(item, path)


@pytest.mark.parametrize("bad", [0, 1, -1, None, "true", "", [], {}, 0.0, 1.0])
def test_raw_capability_requires_exact_bool(tmp_path, bad):
    with pytest.raises(obs.ObservedReadError, match="per-member"):
        reader(tmp_path, tmp_path / "input", allow_bytes=bad)


def test_byte_permission_does_not_grant_json(tmp_path):
    path = tmp_path / "raw"
    path.write_bytes(b'{}')
    item = reader(tmp_path, path)
    assert item.read_bytes(path) == b'{}'
    with pytest.raises(obs.ObservedReadError, match="not admitted for JSON"):
        item.read_json(path)
    poisoned(item, path)


@pytest.mark.parametrize("size", [0, 256 * 1024 + 1, MIB + 7])
def test_same_buffer_digest_repeated_bytes_and_final_charging(tmp_path, size):
    path = tmp_path / "raw"
    data = b'x' * size
    path.write_bytes(data)
    item = reader(tmp_path, path)
    assert item.read_bytes(path) == data
    assert item._digests[obs._key(path)] == hashlib.sha256(data).hexdigest()
    assert item._stream_bytes == size
    assert item.read_bytes(path) == data
    assert item._unique_bytes == size and item._stream_bytes == size * 2
    item.recheck()
    assert item._stream_bytes == size * 3
    poisoned(item, path)


@pytest.mark.parametrize("delta", [-1, 0, 1])
def test_returned_buffer_has_fixed_32mib_ceiling(tmp_path, delta):
    path = tmp_path / "raw"
    size = 32 * MIB + delta
    path.write_bytes(b'x' * size)
    item = reader(tmp_path, path, max_bytes=33 * MIB)
    if delta <= 0:
        assert len(item.read_bytes(path)) == size
        item.recheck()
    else:
        with pytest.raises(obs.ObservedReadError, match="raw byte buffer budget"):
            item.read_bytes(path)
        assert item._stream_bytes == 0
        poisoned(item, path)


def test_large_raw_capability_does_not_raise_json_cap(tmp_path):
    path = tmp_path / "json"
    data = b'"' + b'x' * (256 * 1024 - 1) + b'"'
    path.write_bytes(data)
    item = reader(tmp_path, path, allow_json=True)
    assert item.read_bytes(path) == data
    with pytest.raises(obs.ObservedReadError, match="JSON byte budget"):
        item.read_json(path)


@pytest.mark.parametrize("limits", [dict(max_stream_bytes=11), dict(max_unique_bytes=3), dict(max_file_bytes=3), dict(max_operations=2)])
def test_all_original_limits_still_bind_raw_bytes(tmp_path, limits):
    path = tmp_path / "raw"
    path.write_bytes(b'abcd')
    with pytest.raises(obs.ObservedReadError):
        item = reader(tmp_path, path, max_bytes=4, **limits)
        item.read_bytes(path)
        item.read_bytes(path)
        item.recheck()


def test_per_member_cap_at_and_over(tmp_path):
    path = tmp_path / "raw"
    path.write_bytes(b'abcd')
    item = reader(tmp_path, path, max_bytes=4)
    assert item.read_bytes(path) == b'abcd'
    item.recheck()
    item = reader(tmp_path, path, max_bytes=3)
    with pytest.raises(obs.ObservedReadError, match="admitted byte limit"):
        item.read_bytes(path)


@pytest.mark.parametrize("mode", ["unlisted", "optional-absent", "outside-root"])
def test_unadmitted_or_absent_raw_bytes_refuse(tmp_path, monkeypatch, mode):
    path = tmp_path / "raw"
    path.write_bytes(b'data')
    item = reader(tmp_path, path if mode != "optional-absent" else tmp_path / "absent", optional=True)
    target = path
    if mode == "unlisted":
        target = tmp_path / "other"
    elif mode == "outside-root":
        target = tmp_path.parent / "outside"
    else:
        target = tmp_path / "absent"
    with monkeypatch.context() as guard:
        guard.setattr(Path, "open", forbidden)
        with pytest.raises(obs.ObservedReadError):
            item.read_bytes(target)
    poisoned(item, path)


@pytest.mark.parametrize("change", ["content", "ancestor"])
def test_final_recheck_detects_raw_content_and_ancestor_mutation(tmp_path, change):
    parent = tmp_path / "parent"
    parent.mkdir()
    path = parent / "raw"
    path.write_bytes(b'abcd')
    item = reader(tmp_path, path)
    assert item.read_bytes(path) == b'abcd'
    if change == "content":
        path.write_bytes(b'wxyz')
    else:
        parent.rename(tmp_path / "previous")
        parent.mkdir()
        path.write_bytes(b'abcd')
    with pytest.raises(obs.ObservedReadError):
        item.recheck()
    poisoned(item, path)


def test_same_metadata_changed_stream_cannot_return_unbound_buffer(tmp_path, monkeypatch):
    path = tmp_path / "raw"
    path.write_bytes(b'abcd')
    item = reader(tmp_path, path)
    assert item.read_bytes(path) == b'abcd'
    original = Path.open
    handles = []
    class ChangedStream:
        def __init__(self, handle):
            self.handle = handle
        def __enter__(self): return self
        def __exit__(self, *args): self.handle.close()
        def fileno(self): return self.handle.fileno()
        def read(self, count): return self.handle.read(count).replace(b'abcd', b'wxyz')
    def opening(p, *args, **kwargs):
        wrapped = ChangedStream(original(p, *args, **kwargs))
        handles.append(wrapped)
        return wrapped
    monkeypatch.setattr(Path, "open", opening)
    with pytest.raises(obs.ObservedReadError, match="content changed"):
        item.read_bytes(path)
    assert handles and all(h.handle.closed for h in handles)
    poisoned(item, path)


@pytest.mark.parametrize("kind", ["reparse", "symlink", "directory"])
def test_raw_nonregular_and_linked_leaves_refuse(tmp_path, monkeypatch, kind):
    path = tmp_path / "raw"
    path.write_bytes(b'abcd')
    item = reader(tmp_path, path)
    original = os.lstat
    def linked(p, *args, **kwargs):
        info = original(p, *args, **kwargs)
        if Path(p) != path:
            return info
        values = {name: getattr(info, name) for name in dir(info) if name.startswith('st_')}
        if kind == "reparse": values['st_file_attributes'] |= 0x400
        else: values['st_mode'] = stat.S_IFLNK if kind == "symlink" else stat.S_IFDIR
        return SimpleNamespace(**values)
    monkeypatch.setattr(os, "lstat", linked)
    with pytest.raises(obs.ObservedReadError):
        item.read_bytes(path)
    poisoned(item, path)


@pytest.mark.parametrize("first,second", [(True, False), (False, True)])
def test_router_conflicting_raw_capability_poisons(tmp_path, first, second):
    path = tmp_path / "raw"
    path.write_bytes(b'abc')
    router = gen._Router(obs)
    router.admit((tmp_path,), (obs.ReadMember(path, 3, allow_bytes=first),), (), obs.ReadLimits())
    with pytest.raises(gen._Refusal, match="incompatible"):
        router.admit((tmp_path,), (obs.ReadMember(path, 3, allow_bytes=second),), (), obs.ReadLimits())
    with pytest.raises(gen._Refusal, match="poisoned"):
        router.read_bytes(path)


@pytest.mark.parametrize("initial,bad", [(False, 0), (True, 1), (False, None), (True, 'yes')])
def test_router_repeated_equal_nonbool_is_not_accepted(tmp_path, initial, bad):
    path = tmp_path / "raw"
    path.write_bytes(b'abc')
    router = gen._Router(obs)
    router.admit((tmp_path,), (obs.ReadMember(path, 3, allow_bytes=initial),), (), obs.ReadLimits())
    with pytest.raises(gen._Refusal, match="capability"):
        router.admit((tmp_path,), (obs.ReadMember(path, 3, allow_bytes=bad),), (), obs.ReadLimits())
    with pytest.raises(gen._Refusal, match="poisoned"):
        router.recheck()


def test_router_compatible_member_retains_owner_and_raw_capability(tmp_path):
    path = tmp_path / "raw"
    path.write_bytes(b'abc')
    router = gen._Router(obs)
    member = obs.ReadMember(path, 3, allow_bytes=True)
    router.admit((tmp_path,), (member,), (), obs.ReadLimits())
    original_owner = router._files[obs._key(path)]
    router.admit((tmp_path,), (member,), (), obs.ReadLimits())
    router.admit((tmp_path,), (), (), obs.ReadLimits())
    assert router._files[obs._key(path)] is original_owner
    router.begin_domain()
    assert router.read_bytes(path) == b'abc'
    router.recheck()
    assert original_owner._stream_bytes == 6
    with pytest.raises(gen._Refusal, match="sealed"):
        router.read_bytes(path)
