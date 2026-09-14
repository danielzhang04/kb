"""Finite Windows reads across P (preflight), W (writer), and I (inspection).

Only an imported P baseline, revalidated while still in P, may enter W.
I imports W/I baselines and freezes every absent or published member. No reader
writes files. Trusted callers supply exact members and narrow the fixed branch
temporary-name subset. Optional initial P admission seals once before export.
Limits count public calls, stream chunks, and enumerated directory entries.
Baseline fingerprints use canonical decimal strings, preserving Windows values
across JavaScript transport. This is cooperative evidence, not an atomic snapshot.
"""
from __future__ import annotations

from dataclasses import dataclass, fields
from enum import Enum
from functools import wraps
import errno
import hashlib
import json
import ntpath
import os
from pathlib import Path
import re
import sys
from types import MappingProxyType
from typing import Any

try:  # pragma: no cover - exercised implicitly by whichever import path applies
    from . import observed_reads as _base  # type: ignore
except ImportError:
    import importlib.util as _il

    _here = Path(__file__).resolve().parent
    _spec = _il.spec_from_file_location(
        "figment_still_review_reads_observed_reads", _here / "observed_reads.py"
    )
    assert _spec and _spec.loader
    _base = _il.module_from_spec(_spec)
    sys.modules[_spec.name] = _base
    _spec.loader.exec_module(_base)

ObservedReadError = _base.ObservedReadError
ReadMember = _base.ReadMember
FileObservation = _base.FileObservation
_lexical = _base._lexical
_key = _base._key
_chain = _base._chain
_fingerprint = _base._fingerprint
_same_object = _base._same_object
_local_drive = _base._local_drive
_Fingerprint = _base._Fingerprint

_CHUNK = 1024 * 1024
_NEGATIVE_PROBE = "accepted-checkpoint.json"
_KEEP_FINALS = ("rulings.json", "review-manifest.json", "approved-list.json", "approval-lineage.json")
_CULL_FINALS = ("rulings.json", "review-manifest.json", "rejection-lineage.json")
_RESERVED_NAME = re.compile(
    r"(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])(?:\..*)?\Z", re.I
)
_HEX64 = re.compile(r"[0-9a-f]{64}\Z")


class RefusalKind(Enum):
    POLICY = "policy"
    LIMIT = "limit"
    IDENTITY = "identity"
    SCHEMA = "schema"
    MUTATION = "mutation"


class StillReviewError(ObservedReadError):
    """A finite refusal with a fixed classification, never text-matched."""

    def __init__(self, message: str, kind: RefusalKind = RefusalKind.POLICY):
        super().__init__(message)
        self.kind = kind


def _refuse(kind: RefusalKind, message: str) -> None:
    raise StillReviewError(message, kind)


@dataclass(frozen=True)
class StillReviewLimits:
    """Own immutable limit set. Fields may only be lowered, never raised."""

    max_files: int = 64
    max_unique_bytes: int = 64 * 1024 * 1024
    max_stream_bytes: int = 2 * 1024 ** 3
    max_file_bytes: int = 64 * 1024 * 1024
    max_json_bytes: int = 256 * 1024
    max_json_depth: int = 32
    max_json_entries: int = 256
    max_json_nodes: int = 8192
    max_operations: int = 20480
    max_directories: int = 256
    max_directory_entries: int = 64
    max_baseline_bytes: int = 128 * 1024


_ABSOLUTE_LIMITS = StillReviewLimits()


def _validate_limits(limits: "StillReviewLimits") -> "StillReviewLimits":
    if type(limits) is not StillReviewLimits:
        _refuse(RefusalKind.SCHEMA, "limits must be StillReviewLimits")
    values = {}
    for field in fields(StillReviewLimits):
        value = getattr(limits, field.name)
        cap = getattr(_ABSOLUTE_LIMITS, field.name)
        if type(value) is not int or not 0 < value <= cap:
            _refuse(RefusalKind.SCHEMA, f"limit {field.name} invalid or exceeds its hard cap")
        values[field.name] = value
    return StillReviewLimits(**values)


def _identity_only(fp: "_Fingerprint") -> tuple:
    # Ignore volatile size/mtime/ctime; keep dev/inode/birthtime/mode/attrs.
    return (fp.device, fp.inode, fp.birthtime, fp.mode, fp.attributes)


def _within(path: Path, root: Path) -> bool:
    candidate, boundary = _key(path), _key(root)
    return candidate == boundary or candidate.startswith(boundary.rstrip("\\") + "\\")


@dataclass(frozen=True)
class _Record:
    named: _Fingerprint
    opened: _Fingerprint
    digest: str


_FP_NAMES = tuple(f.name for f in fields(_Fingerprint))
_DECIMAL = re.compile(r"(?:0|[1-9][0-9]{0,38})\Z")
_ALL_FINALS = frozenset((*_KEEP_FINALS, *_CULL_FINALS))
_RESERVED_TEMPS = frozenset(name + ".tmp" for name in _ALL_FINALS | {_NEGATIVE_PROBE})


def _fp_export(value):
    return {name: str(getattr(value, name)) for name in _FP_NAMES}


def _fp_import(value):
    if type(value) is not dict or set(value) != set(_FP_NAMES):
        _refuse(RefusalKind.SCHEMA, "fingerprint fields differ")
    result = []
    for name in _FP_NAMES:
        field = value[name]
        if type(field) is not str or not _DECIMAL.fullmatch(field) or int(field) >= 2 ** 128:
            _refuse(RefusalKind.SCHEMA, "fingerprint integer is not canonical")
        result.append(int(field))
    fp = _Fingerprint(*result)
    if not fp.inode or fp.attributes & 0x400:
        _refuse(RefusalKind.SCHEMA, "invalid baseline identity")
    return fp


def _exact(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        _refuse(RefusalKind.SCHEMA, "baseline fields differ")


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _refuse(RefusalKind.SCHEMA, "duplicate baseline key")
        result[key] = value
    return result


def _encoded(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("ascii")


def _public(method):
    @wraps(method)
    def call(self, *args, **kwargs):
        try:
            self._enter()
            self._sync()
            result = method(self, *args, **kwargs)
            self._sync()
            return result
        except Exception as exc:
            self._fail(exc)
    return call


class StillReviewReads:
    """Exact router; keyword signature is stable for the adapter's next join.

    phase='P' requires no baseline or an original P baseline. phase='W'
    requires an original P baseline. phase='I' requires a W/I baseline.
    The latter two cannot be opened without that explicit import. Every import
    preserves original directory, named/opened-file and digest records and
    unique membership accounting. Each imported child starts fresh operation and
    stream ledgers, then charges all revalidation against the original records.
    """

    def __init__(self, *, plan_root: Path, persona_root: Path, pipeline_root: Path,
                 store_root: Path, mutation_directory: Path, branch: str,
                 members: tuple = (), directories: tuple = (),
                 temporary_names: tuple = (), limits=StillReviewLimits(),
                 baseline: bytes | None = None, phase: str = "P",
                 defer_admission: bool = False):
        self._poisoned = False
        self._sticky_kind = None
        self._operations = self._unique_bytes = self._stream_bytes = 0
        self._files = {}
        self._dir_stamps = {}
        self._d_originals = {}
        self._d_last = None
        self._scanning = False
        self._phase = "P"
        self._admission_sealed = True
        try:
            if type(defer_admission) is not bool:
                _refuse(RefusalKind.SCHEMA, "admission flag must be boolean")
            if defer_admission and (baseline is not None or phase != "P" or not members):
                _refuse(RefusalKind.POLICY, "deferred admission requires fresh nonempty P inputs")
            self._admission_sealed = not defer_admission
            self._configure(plan_root, persona_root, pipeline_root, store_root,
                            mutation_directory, branch, members, directories,
                            temporary_names, limits)
            if type(phase) is not str or phase not in ("P", "W", "I"):
                _refuse(RefusalKind.SCHEMA, "unknown reader phase")
            if baseline is None:
                if phase != "P":
                    _refuse(RefusalKind.POLICY, "writer and inspection require an imported baseline")
                for key, path in self._directory_paths.items():
                    self._dir_stamps[key] = _fingerprint(os.lstat(path), directory=True)
                self._scan(initial=True)
                for key, member in self._members.items():
                    self._observe(key, member)
            else:
                imported_phase = self._load_baseline(baseline)
                if not ((imported_phase == "P" and phase in ("P", "W"))
                        or (imported_phase in ("W", "I") and phase == "I")):
                    _refuse(RefusalKind.POLICY, "baseline phase transition refused")
                # Re-admit P while publication is still forbidden; W is enabled
                # only after all original checks below succeed.
                self._phase = "P" if imported_phase == "P" else "I"
                self._sync(force=True)
                for key, member in self._members.items():
                    self._observe(key, member, rehash=True)
            self._sync(force=True)
            self._no_temporary()
            self._phase = phase
        except Exception as exc:
            self._fail(exc)

    def _fail(self, exc):
        self._poisoned = True
        if self._sticky_kind is None:
            self._sticky_kind = exc.kind if isinstance(exc, StillReviewError) else RefusalKind.POLICY
        if isinstance(exc, StillReviewError):
            raise exc
        raise StillReviewError("still-review read refused", self._sticky_kind) from exc

    def _charge(self, amount=1):
        self._operations += amount
        if self._operations > self._limits.max_operations:
            _refuse(RefusalKind.LIMIT, "operation budget exceeded")

    def _enter(self):
        if self._poisoned:
            _refuse(self._sticky_kind, "router is already refusing")
        self._charge()

    def _leaf(self, name):
        if type(name) is not str or not name or "/" in name or "\\" in name:
            _refuse(RefusalKind.SCHEMA, "a lexical leaf name is required")
        path = _lexical(self._d / name)
        if _key(path.parent) != _key(self._d) or path.name != name:
            _refuse(RefusalKind.SCHEMA, "invalid leaf name")
        return ntpath.normcase(name)

    def _configure(self, plan, persona, pipeline, store, d, branch, members, directories, temps, limits):
        if os.name != "nt" or sys.implementation.name != "cpython":
            _refuse(RefusalKind.POLICY, "CPython on Windows is required")
        self._limits = _validate_limits(limits)
        if type(branch) is not str or branch not in ("keep", "cull"):
            _refuse(RefusalKind.SCHEMA, "unknown branch")
        self._branch = branch
        self._final_names = frozenset(_KEEP_FINALS if branch == "keep" else _CULL_FINALS)
        self._roles = dict(zip(("plan", "persona", "pipeline", "store"), map(_lexical, (plan, persona, pipeline, store))))
        if len({_key(p) for p in self._roles.values()}) != 4:
            _refuse(RefusalKind.SCHEMA, "four distinct role roots required")
        self._d = _lexical(d)
        if _key(self._d) != _key(self._roles["plan"] / "grade" / "gen"):
            _refuse(RefusalKind.SCHEMA, "mutation directory must be plan/grade/gen")
        if type(temps) is not tuple or len(temps) > self._limits.max_directory_entries:
            _refuse(RefusalKind.SCHEMA, "temporary names must be finite")
        self._temps = frozenset(self._leaf(n) for n in temps)
        allowed_temps = {name + ".tmp" for name in self._final_names}
        if len(self._temps) != len(temps) or not self._temps <= allowed_temps:
            _refuse(RefusalKind.SCHEMA, "temporary names must be a branch subset")
        admitted, operands, paths = self._membership(members, directories)
        self._members = MappingProxyType(admitted)
        self._directories = MappingProxyType(operands)
        self._directory_paths = MappingProxyType(paths)
        self._final_keys = {_key(self._d / name) for name in self._final_names}
        for anchor in dict.fromkeys(path.anchor for path in self._roles.values()):
            _local_drive(anchor)

    def _membership(self, members, directories):
        """Build a finite policy without replacing any observation or ledger."""
        if type(members) is not tuple or len(members) > self._limits.max_files:
            _refuse(RefusalKind.SCHEMA, "member count exceeds policy")
        if type(directories) is not tuple or len(directories) > self._limits.max_directories:
            _refuse(RefusalKind.SCHEMA, "directory operands exceed policy")
        admitted = {}
        for member in members:
            if type(member) is not ReadMember:
                _refuse(RefusalKind.SCHEMA, "member must be ReadMember")
            path = _lexical(member.path)
            if not any(_within(path, root) for root in self._roles.values()):
                _refuse(RefusalKind.POLICY, "member outside role roots")
            if (type(member.max_bytes) is not int or not 0 < member.max_bytes <= self._limits.max_file_bytes
                    or type(member.allow_json) is not bool or type(member.optional) is not bool):
                _refuse(RefusalKind.SCHEMA, "invalid member restriction")
            key = _key(path)
            if key in admitted:
                _refuse(RefusalKind.SCHEMA, "duplicate normalized member")
            if _key(path.parent) == _key(self._d):
                name = self._leaf(path.name)
                if name in _RESERVED_TEMPS:
                    _refuse(RefusalKind.POLICY, "temporary files are never read members")
                if name in self._final_names and not (member.optional and member.allow_json):
                    _refuse(RefusalKind.SCHEMA, "final members must be optional JSON")
                if name in (_ALL_FINALS - self._final_names) | {_NEGATIVE_PROBE} and not member.optional:
                    _refuse(RefusalKind.SCHEMA, "negative probes must be optional")
            admitted[key] = ReadMember(path, member.max_bytes, member.allow_json, member.optional)
        operands = {_key(path): path for path in (*self._roles.values(), self._d)}
        for directory in directories:
            path = _lexical(directory)
            if not any(_within(path, root) or _within(root, path) for root in self._roles.values()):
                _refuse(RefusalKind.POLICY, "directory unrelated to role roots")
            operands.setdefault(_key(path), path)
        for member in admitted.values():
            for path in member.path.parents:
                if any(_within(path, root) for root in self._roles.values()):
                    operands.setdefault(_key(path), path)
        if admitted.keys() & operands.keys():
            _refuse(RefusalKind.SCHEMA, "file and directory operand conflict")
        paths = {}
        for path in operands.values():
            for ancestor in _chain(path):
                paths[_key(ancestor)] = ancestor
                if len(paths) > self._limits.max_directories:
                    _refuse(RefusalKind.LIMIT, "captured directory limit exceeded")
        return admitted, operands, paths

    @_public
    def finalize_admission(self, *, members: tuple = (), directories: tuple = ()) -> None:
        if self._admission_sealed or self._phase != "P":
            _refuse(RefusalKind.POLICY, "admission is already sealed")
        if type(members) is not tuple or type(directories) is not tuple:
            _refuse(RefusalKind.SCHEMA, "admission additions must be tuples")
        if len(members) > self._limits.max_files or len(directories) > self._limits.max_directories:
            _refuse(RefusalKind.LIMIT, "admission additions exceed limits")
        extra_directories = {}
        for directory in directories:
            path = _lexical(directory)
            key = _key(path)
            if key in extra_directories:
                _refuse(RefusalKind.SCHEMA, "duplicate additional directory")
            extra_directories[key] = path
        operands = dict(self._directories)
        operands.update(extra_directories)
        admitted, operands, paths = self._membership(
            (*self._members.values(), *members), tuple(operands.values()))
        # Candidate validation precedes every new-member open. No prior record,
        # comparison policy or consumed counter is replaced by construction.
        self._recheck()
        old_keys = set(self._members)
        stamps = dict(self._dir_stamps)
        for key, path in paths.items():
            if key not in stamps:
                self._charge()
                stamps[key] = _fingerprint(os.lstat(path), directory=True)
        self._members = MappingProxyType(admitted)
        self._directories = MappingProxyType(operands)
        self._directory_paths = MappingProxyType(paths)
        self._dir_stamps = stamps
        for key, member in self._members.items():
            if key not in old_keys:
                self._observe(key, member)
        self._recheck()
        self._admission_sealed = True

    def _strict(self, key):
        path = self._directory_paths[key]
        return key != _key(self._d) and any(_within(path, root) for root in self._roles.values())

    def _check_directory(self, key):
        current = _fingerprint(os.lstat(self._directory_paths[key]), directory=True)
        original = self._dir_stamps[key]
        same = current == original if self._strict(key) else _identity_only(current) == _identity_only(original)
        if not same:
            _refuse(RefusalKind.IDENTITY, "original directory identity changed")
        return current

    def _sync(self, force=False):
        for key in self._directory_paths:
            self._check_directory(key)
        if not self._scanning:
            current = self._check_directory(_key(self._d))
            if force or current != self._d_last:
                self._scan(initial=False)

    def _scan(self, initial=False):
        if self._scanning:
            return
        self._scanning = True
        try:
            self._charge()
            before = self._check_directory(_key(self._d))
            seen = set()
            with os.scandir(self._d) as entries:
                for entry in entries:
                    self._charge()
                    if len(seen) >= self._limits.max_directory_entries:
                        _refuse(RefusalKind.LIMIT, "directory entry limit exceeded")
                    name = self._leaf(entry.name)
                    if name in seen:
                        _refuse(RefusalKind.MUTATION, "duplicate directory entry")
                    seen.add(name)
                    fp = _fingerprint(os.lstat(self._d / entry.name), directory=False)
                    if name == _NEGATIVE_PROBE or name in _ALL_FINALS - self._final_names:
                        _refuse(RefusalKind.MUTATION, "forbidden branch output appeared")
                    if name in _RESERVED_TEMPS:
                        if self._phase != "W" or name not in self._temps:
                            _refuse(RefusalKind.MUTATION, "temporary output outside permitted write subset")
                        continue
                    if name in self._final_names:
                        key = _key(self._d / name)
                        if initial or (self._files.get(key) is None and self._phase != "W"):
                            _refuse(RefusalKind.MUTATION, "new publication outside write phase")
                        if key not in self._members:
                            _refuse(RefusalKind.POLICY, "published final was not admitted")
                        # Freeze named/opened identity AND digest on first discovery.
                        self._observe(key, self._members[key])
                        continue
                    if initial:
                        self._d_originals[name] = fp
                    elif name not in self._d_originals or fp != self._d_originals[name]:
                        _refuse(RefusalKind.MUTATION, "original entry changed or unexpected entry appeared")
            if set(self._d_originals) - seen:
                _refuse(RefusalKind.MUTATION, "original entry disappeared")
            for key in self._final_keys:
                if self._files.get(key) is not None and self._members[key].path.name.lower() not in seen:
                    _refuse(RefusalKind.MUTATION, "published final disappeared")
            after = self._check_directory(_key(self._d))
            if before != after:
                _refuse(RefusalKind.MUTATION, "directory changed during bounded enumeration")
            self._d_last = after
        finally:
            self._scanning = False

    def _operand(self, path):
        key = _key(_lexical(path))
        if key in self._members:
            return key, self._members[key].path
        if key in self._directories:
            return key, self._directories[key]
        _refuse(RefusalKind.POLICY, "operand was not admitted")

    def _member(self, path):
        key, _ = self._operand(path)
        if key not in self._members:
            _refuse(RefusalKind.POLICY, "file operand required")
        return key, self._members[key]

    def _observe(self, key, member, required=False, rehash=False, collect_limit=None):
        self._sync()
        try:
            named = _fingerprint(os.lstat(member.path), directory=False)
        except OSError as exc:
            if exc.errno != errno.ENOENT or required or not member.optional:
                raise
            if self._files.get(key) is not None:
                _refuse(RefusalKind.IDENTITY, "observed file disappeared")
            self._sync()
            try:
                os.lstat(member.path)
            except OSError as confirmation:
                if confirmation.errno != errno.ENOENT:
                    raise
            else:
                _refuse(RefusalKind.IDENTITY, "absence changed during observation")
            self._files[key] = None
            return None, None
        original = self._files.get(key)
        if key in self._files and original is None:
            if key not in self._final_keys or self._phase != "W":
                _refuse(RefusalKind.IDENTITY, "original absence changed")
        if named.size > min(member.max_bytes, self._limits.max_file_bytes):
            _refuse(RefusalKind.LIMIT, "file byte limit exceeded")
        if collect_limit is not None:
            if type(collect_limit) is not int or not 0 < collect_limit <= min(member.max_bytes, self._limits.max_file_bytes):
                _refuse(RefusalKind.POLICY, "invalid collection limit")
            if named.size > collect_limit:
                _refuse(RefusalKind.LIMIT, "collection byte limit exceeded")
        if original is not None and original.named != named:
            _refuse(RefusalKind.IDENTITY, "named file fingerprint changed")
        if original is None and self._unique_bytes + named.size > self._limits.max_unique_bytes:
            _refuse(RefusalKind.LIMIT, "unique byte limit exceeded")
        should_stream = original is None or rehash or collect_limit is not None
        if should_stream and named.size > self._limits.max_stream_bytes - self._stream_bytes:
            _refuse(RefusalKind.LIMIT, "remaining stream budget insufficient")
        chunks = [] if collect_limit is not None else None
        digest = hashlib.sha256()
        with member.path.open("rb", buffering=0) as handle:
            opened = _fingerprint(os.fstat(handle.fileno()), directory=False)
            if not _same_object(named, opened) or (original is not None and opened != original.opened):
                _refuse(RefusalKind.IDENTITY, "opened file fingerprint changed")
            # Do not recursively discover the same newly appearing final while
            # its first handle is open. D enumeration owns that discovery.
            for directory in self._directory_paths:
                self._check_directory(directory)
            if _fingerprint(os.lstat(member.path), directory=False) != named:
                _refuse(RefusalKind.IDENTITY, "named/opened file changed")
            seen = 0
            if should_stream:
                while seen < named.size:
                    self._charge()
                    requested = min(_CHUNK, named.size - seen)
                    # Nested publication discovery may have consumed the shared
                    # ledger since the prior chunk. Refuse BEFORE actual I/O.
                    if requested > self._limits.max_stream_bytes - self._stream_bytes:
                        _refuse(RefusalKind.LIMIT, "remaining stream budget insufficient")
                    block = handle.read(requested)
                    if not block:
                        _refuse(RefusalKind.IDENTITY, "short stream")
                    self._stream_bytes += len(block)
                    seen += len(block)
                    if seen > named.size or self._stream_bytes > self._limits.max_stream_bytes:
                        _refuse(RefusalKind.LIMIT, "stream budget exceeded")
                    digest.update(block)
                    if chunks is not None:
                        chunks.append(block)
                    # Calls made while streaming immutable input still see D's
                    # publication before returning to the legacy writer.
                    if original is not None:
                        self._sync()
            if (_fingerprint(os.fstat(handle.fileno()), directory=False) != opened
                    or _fingerprint(os.lstat(member.path), directory=False) != named):
                _refuse(RefusalKind.IDENTITY, "file changed during observation")
        result_digest = digest.hexdigest() if should_stream else original.digest
        if original is not None and original.digest != result_digest:
            _refuse(RefusalKind.IDENTITY, "original content changed")
        if original is None:
            self._unique_bytes += named.size
            self._files[key] = _Record(named, opened, result_digest)
        self._sync()
        return self._files[key], b"".join(chunks) if chunks is not None else None

    @_public
    def resolve(self, path: Path) -> Path:
        key, admitted = self._operand(path)
        if key in self._members:
            self._observe(key, self._members[key])
        return admitted

    @_public
    def file(self, path: Path, *, required=False):
        if type(required) is not bool:
            _refuse(RefusalKind.SCHEMA, "required must be boolean")
        key, member = self._member(path)
        record, _ = self._observe(key, member, required=required)
        return None if record is None else FileObservation(member.path, record.named.size)

    @_public
    def sha256(self, path: Path) -> str:
        key, member = self._member(path)
        return self._observe(key, member, required=True, rehash=True)[0].digest

    def _structure(self, value):
        stack = [(value, 1)]
        nodes = 0
        while stack:
            item, depth = stack.pop()
            nodes += 1
            if depth > self._limits.max_json_depth or nodes > self._limits.max_json_nodes:
                _refuse(RefusalKind.LIMIT, "JSON structural limit exceeded")
            if isinstance(item, (list, dict)):
                if len(item) > self._limits.max_json_entries:
                    _refuse(RefusalKind.LIMIT, "JSON collection limit exceeded")
                stack.extend((child, depth + 1) for child in (item.values() if isinstance(item, dict) else item))

    @_public
    def read_json(self, path: Path):
        key, member = self._member(path)
        if not member.allow_json:
            _refuse(RefusalKind.POLICY, "JSON was not admitted")
        raw = self._observe(key, member, required=True,
                            collect_limit=min(member.max_bytes, self._limits.max_json_bytes))[1]
        value = json.loads(raw.decode("utf-8"))
        self._structure(value)
        return value

    @_public
    def read_bytes(self, path: Path) -> bytes:
        key, member = self._member(path)
        return self._observe(key, member, required=True,
                             collect_limit=min(member.max_bytes, self._limits.max_file_bytes))[1]

    def _no_temporary(self):
        # Reservation is global even when the caller narrows permitted W names.
        for name in _RESERVED_TEMPS:
            self._charge()
            try:
                os.lstat(self._d / name)
            except OSError as exc:
                if exc.errno != errno.ENOENT:
                    raise
            else:
                _refuse(RefusalKind.MUTATION, "temporary output remains at stable boundary")

    def _recheck(self):
        self._sync(force=True)
        self._no_temporary()
        for key, member in self._members.items():
            self._observe(key, member, rehash=True)
        self._sync(force=True)
        self._no_temporary()

    @_public
    def recheck(self):
        self._recheck()

    def _policy(self):
        return {
            "roots": {role: _key(path) for role, path in self._roles.items()},
            "members": {key: {"max_bytes": m.max_bytes, "allow_json": m.allow_json, "optional": m.optional} for key, m in self._members.items()},
            "directories": sorted(self._directories),
            "comparison": {key: "strict" if self._strict(key) else "identity" for key in self._directory_paths},
            "mutation_directory": _key(self._d), "branch": self._branch,
            "temporary_names": sorted(self._temps),
            "limits": {f.name: getattr(self._limits, f.name) for f in fields(StillReviewLimits)},
        }

    def _load_baseline(self, raw):
        if type(raw) is not bytes or len(raw) > self._limits.max_baseline_bytes:
            _refuse(RefusalKind.SCHEMA, "baseline must be bounded bytes")
        data = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs,
                          parse_constant=lambda _: _refuse(RefusalKind.SCHEMA, "nonfinite baseline number"))
        self._structure(data)
        _exact(data, ("version", "phase", "policy", "directories", "files", "originals", "counters"))
        if type(data["version"]) is not int or data["version"] != 1 or type(data["phase"]) is not str or data["phase"] not in ("P", "W", "I"):
            _refuse(RefusalKind.SCHEMA, "baseline version or phase invalid")
        if _encoded(data["policy"]) != _encoded(self._policy()):
            _refuse(RefusalKind.SCHEMA, "baseline policy differs")
        _exact(data["directories"], self._directory_paths)
        directory_stamps = {key: _fp_import(value) for key, value in data["directories"].items()}
        _exact(data["files"], self._members)
        records = {}
        for key, entry in data["files"].items():
            member = self._members[key]
            if entry is None:
                if not member.optional:
                    _refuse(RefusalKind.SCHEMA, "required baseline member absent")
                records[key] = None
                continue
            _exact(entry, ("named", "opened", "digest"))
            named, opened = _fp_import(entry["named"]), _fp_import(entry["opened"])
            if (not _same_object(named, opened) or type(entry["digest"]) is not str
                    or not _HEX64.fullmatch(entry["digest"]) or named.size > member.max_bytes):
                _refuse(RefusalKind.SCHEMA, "baseline file record invalid")
            if data["phase"] == "P" and key in self._final_keys:
                _refuse(RefusalKind.SCHEMA, "preflight baseline contains output")
            records[key] = _Record(named, opened, entry["digest"])
        originals = data["originals"]
        if type(originals) is not dict or len(originals) > self._limits.max_directory_entries:
            _refuse(RefusalKind.SCHEMA, "baseline original entries invalid")
        parsed_originals = {}
        for name, value in originals.items():
            if self._leaf(name) != name or name in _ALL_FINALS | _RESERVED_TEMPS | {_NEGATIVE_PROBE}:
                _refuse(RefusalKind.SCHEMA, "baseline original name invalid")
            parsed_originals[name] = _fp_import(value)
        counters = data["counters"]
        _exact(counters, ("operations", "unique_bytes", "stream_bytes"))
        for name, maximum in (("operations", self._limits.max_operations), ("unique_bytes", self._limits.max_unique_bytes), ("stream_bytes", self._limits.max_stream_bytes)):
            if type(counters[name]) is not int or not 0 <= counters[name] <= maximum:
                _refuse(RefusalKind.SCHEMA, "baseline counter invalid")
        size_sum = sum(record.named.size for record in records.values() if record is not None)
        if counters["unique_bytes"] != size_sum or counters["stream_bytes"] < size_sum:
            _refuse(RefusalKind.SCHEMA, "baseline byte accounting differs")
        self._dir_stamps = directory_stamps
        self._files = records
        self._d_originals = parsed_originals
        self._operations = 0
        self._unique_bytes = counters["unique_bytes"]
        self._stream_bytes = 0
        return data["phase"]

    @_public
    def export_baseline(self):
        if not self._admission_sealed:
            _refuse(RefusalKind.POLICY, "admission is not sealed")
        self._recheck()
        # Exports preserve complete original records, never an unread=absent
        # projection. D temp names cannot survive a stable boundary export.
        for name in _RESERVED_TEMPS:
            try:
                os.lstat(self._d / name)
            except OSError as exc:
                if exc.errno != errno.ENOENT:
                    raise
            else:
                _refuse(RefusalKind.MUTATION, "temporary output remains at baseline boundary")
        self._sync(force=True)
        data = {
            "version": 1, "phase": self._phase, "policy": self._policy(),
            "directories": {key: _fp_export(value) for key, value in self._dir_stamps.items()},
            "files": {key: None if value is None else {"named": _fp_export(value.named), "opened": _fp_export(value.opened), "digest": value.digest} for key, value in self._files.items()},
            "originals": {key: _fp_export(value) for key, value in self._d_originals.items()},
            "counters": {"operations": self._operations, "unique_bytes": self._unique_bytes, "stream_bytes": self._stream_bytes},
        }
        self._structure(data)
        encoded = _encoded(data)
        if len(encoded) > self._limits.max_baseline_bytes:
            _refuse(RefusalKind.LIMIT, "serialized baseline exceeds limit")
        return encoded

    @property
    def phase(self):
        return self._phase

    @property
    def poisoned(self):
        return self._poisoned

    @property
    def refusal_kind(self):
        return self._sticky_kind

    @property
    def operations(self):
        return self._operations

    @property
    def unique_bytes(self):
        return self._unique_bytes

    @property
    def stream_bytes(self):
        return self._stream_bytes



    @property
    def admission_sealed(self):
        return self._admission_sealed
