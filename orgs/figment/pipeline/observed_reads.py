"""Finite, cooperative observations of explicitly admitted local Windows files.

Importing this module performs no data I/O. This is not an atomic filesystem
snapshot, an approval validator, or protection against a privileged writer.
"""
from __future__ import annotations

from dataclasses import dataclass, fields
import errno
from functools import wraps
import hashlib
import json
import ntpath
import os
from pathlib import Path
import re
import stat
import sys
from types import MappingProxyType
from typing import Any


class ObservedReadError(ValueError):
    """The finite observation cannot be completed under its original policy."""


@dataclass(frozen=True)
class ReadLimits:
    max_files: int = 256
    max_unique_bytes: int = 1024 ** 3
    max_stream_bytes: int = 2 * 1024 ** 3
    max_file_bytes: int = 256 * 1024 ** 2
    max_json_bytes: int = 256 * 1024
    max_json_depth: int = 32
    max_json_entries: int = 256
    max_json_nodes: int = 8192
    max_operations: int = 1024
    max_case_entries_per_directory: int = 1024
    max_case_directories: int = 128
    max_case_unique_entries: int = 16384
    max_case_unique_name_bytes: int = 1048576
    max_case_name_bytes: int = 4096
    max_case_scans: int = 512
    max_case_probes: int = 65536
    max_case_stream_name_bytes: int = 4194304


@dataclass(frozen=True)
class ReadMember:
    path: Path
    max_bytes: int
    allow_json: bool = False
    optional: bool = False
    allow_bytes: bool = False
    exact_case: bool = False


@dataclass(frozen=True)
class FileObservation:
    path: Path
    size: int


@dataclass(frozen=True)
class _Fingerprint:
    device: int
    inode: int
    size: int
    modified: int
    changed: int
    birthtime: int
    mode: int
    attributes: int


@dataclass(frozen=True)
class _FileRecord:
    path: Path
    fingerprint: _Fingerprint
    opened_fingerprint: _Fingerprint


_REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
_RESERVED = re.compile(r"(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?\Z", re.I)
_CHUNK = 1024 * 1024
_MAX_COLLECTED_BYTES = 32 * 1024 * 1024


def _refuse(message: str) -> None:
    raise ObservedReadError(message)


def _key(path: Path) -> str:
    return ntpath.normcase(str(path))


def _lexical(path: Path) -> Path:
    # Path may already have normalized separators or '.'; no claim is made
    # about recovering spellings discarded before this interface was called.
    if not isinstance(path, Path):
        _refuse("path must be an explicit Path")
    if not re.fullmatch(r"[A-Za-z]:", path.drive) or path.root != "\\":
        _refuse("only local drive-absolute Windows paths are supported")
    if len(path.parts) - 1 > 64:
        _refuse("path depth exceeds policy")
    for part in path.parts[1:]:
        if (part in (".", "..") or part.endswith((".", " ")) or _RESERVED.fullmatch(part)
                or any(ord(char) < 32 or char in ':<>"|?*' for char in part)):
            _refuse("unsupported Windows path component")
    return Path(path)


def _within(path: Path, root: Path) -> bool:
    candidate, boundary = _key(path), _key(root)
    return candidate == boundary or candidate.startswith(boundary.rstrip("\\") + "\\")


def _chain(directory: Path) -> tuple[Path, ...]:
    return (*reversed(directory.parents), directory)


def _local_drive(anchor: str) -> None:
    # A drive letter may map to a remote share. Check only the trusted roots'
    # lexical anchors; loading the Windows system library is constructor-only.
    import ctypes

    get_drive_type = ctypes.WinDLL("kernel32", use_last_error=True).GetDriveTypeW
    get_drive_type.argtypes = [ctypes.c_wchar_p]
    get_drive_type.restype = ctypes.c_uint
    if get_drive_type(anchor) not in (2, 3, 6):  # removable, fixed, RAM disk
        _refuse("root drive is not a supported local drive")


def _fingerprint(info: os.stat_result, *, directory: bool) -> _Fingerprint:
    attributes = getattr(info, "st_file_attributes", None)
    birthtime = getattr(info, "st_birthtime_ns", None)
    values = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, birthtime)
    if (attributes is None or any(type(value) is not int or value < 0 for value in values)
            or info.st_ino == 0):
        _refuse("filesystem identity is not comparable")
    if attributes & _REPARSE or stat.S_ISLNK(info.st_mode):
        _refuse("reparse or linked component refused")
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        _refuse("unexpected filesystem object kind")
    return _Fingerprint(*values, info.st_mode, attributes)


def _same_object(named: _Fingerprint, opened: _Fingerprint) -> bool:
    # CPython 3.12 Windows lstat reports creation time as ctime, whereas
    # fstat reports change time. Compare birthtime across APIs and retain
    # each API's complete original fingerprint for subsequent checks.
    return all(getattr(named, field) == getattr(opened, field) for field in (
        "device", "inode", "size", "modified", "birthtime", "mode", "attributes",
    ))


def _public(method):
    @wraps(method)
    def call(self, *args, **kwargs):
        try:
            self._enter()
            return method(self, *args, **kwargs)
        except Exception as exc:
            self._poisoned = True
            if isinstance(exc, ObservedReadError):
                raise
            raise ObservedReadError("observed read failed") from exc
    return call


class ObservedReads:
    """An immutable admission policy with a single, finite observation lifetime."""

    def __init__(self, *, roots: tuple[Path, ...], members: tuple[ReadMember, ...],
                 directories: tuple[Path, ...] = (), limits: ReadLimits = ReadLimits()):
        self._poisoned = False
        self._sealed = False
        self._operations = 0
        self._unique_bytes = 0
        self._stream_bytes = 0
        self._case_snapshots: dict = {}
        self._case_scans = self._case_probes = 0
        self._case_unique_entries = self._case_unique_name_bytes = 0
        self._case_stream_name_bytes = 0
        self._files: dict[str, _FileRecord | None] = {}
        self._digests: dict[str, str] = {}
        self._directory_stamps: dict[str, tuple[Path, _Fingerprint]] = {}
        try:
            self._configure(roots, members, directories, limits)
        except Exception as exc:
            self._poisoned = True
            if isinstance(exc, ObservedReadError):
                raise
            raise ObservedReadError("invalid observed-read policy") from exc

    def _configure(self, roots, members, directories, limits) -> None:
        if os.name != "nt" or sys.implementation.name != "cpython":
            _refuse("observed reads support CPython on Windows only")
        if type(limits) is not ReadLimits:
            _refuse("limits must be ReadLimits")
        maximum = ReadLimits()
        for field in fields(ReadLimits):
            value = getattr(limits, field.name)
            if type(value) is not int or not 0 < value <= getattr(maximum, field.name):
                _refuse("invalid or raised read limit")
        self._limits = ReadLimits(**{field.name: getattr(limits, field.name) for field in fields(ReadLimits)})
        if type(roots) is not tuple or not 1 <= len(roots) <= 3:
            _refuse("one to three explicit roots required")
        if type(members) is not tuple or len(members) > limits.max_files:
            _refuse("member policy exceeds file limit")
        if type(directories) is not tuple or len(directories) > 256:
            _refuse("directory policy exceeds finite limit")
        self._roots = tuple(_lexical(root) for root in roots)
        if len({_key(root) for root in self._roots}) != len(self._roots):
            _refuse("duplicate root")
        admitted: dict[str, ReadMember] = {}
        operands: dict[str, Path] = {_key(root): root for root in self._roots}
        for directory in directories:
            directory = _lexical(directory)
            if not any(_within(directory, root) for root in self._roots):
                _refuse("directory outside roots")
            operands.setdefault(_key(directory), directory)
        for member in members:
            if type(member) is not ReadMember:
                _refuse("member must be ReadMember")
            path = _lexical(member.path)
            if not any(_within(path, root) for root in self._roots):
                _refuse("member outside roots")
            if (type(member.max_bytes) is not int or not 0 < member.max_bytes <= limits.max_file_bytes
                    or type(member.allow_json) is not bool or type(member.optional) is not bool
                    or type(member.allow_bytes) is not bool or type(member.exact_case) is not bool):
                _refuse("invalid per-member restriction")
            key = _key(path)
            if key in admitted:
                _refuse("duplicate normalized member")
            admitted[key] = ReadMember(path, member.max_bytes, member.allow_json, member.optional, member.allow_bytes, member.exact_case)
            for ancestor in path.parents:
                if any(_within(ancestor, root) for root in self._roots):
                    operands.setdefault(_key(ancestor), ancestor)
        if admitted.keys() & operands.keys():
            _refuse("file and directory policies conflict")
        for anchor in dict.fromkeys(root.anchor for root in self._roots):
            _local_drive(anchor)
        self._members = MappingProxyType(admitted)
        self._directories = MappingProxyType(operands)
        self._configure_case()
        # Observe every ancestor up to the local drive. Outside-root ancestors
        # are safety observations only, never admitted operands or read roots.
        for directory in operands.values():
            for ancestor in _chain(directory):
                self._check_directory(ancestor, initial=True)

    def _configure_case(self) -> None:
        """Compile closed expectations without enumerating or adding operands."""
        paths, parents = {}, {}
        for member in self._members.values():
            if not member.exact_case:
                continue
            root = max((r for r in self._roots if _within(member.path, r)), key=lambda r: len(r.parts))
            child = root
            parts = member.path.parts[len(root.parts):]
            for index, part in enumerate(parts):
                parent, child = child, child / part
                key = _key(child)
                previous = paths.get(key)
                if previous is not None and str(previous[0]) != str(child):
                    _refuse("conflicting exact-case spelling")
                paths.setdefault(key, (child, root))
                parent_key = _key(parent)
                if parent_key not in parents:
                    parents[parent_key] = (parent, {})
                expected = parents[parent_key][1]
                optional = member.optional and index == len(parts) - 1
                folded = part.casefold()
                prior = expected.get(folded)
                if prior is not None and prior[0] != part:
                    _refuse("conflicting exact-case expectation")
                expected[folded] = (part, optional and (prior is None or prior[1]))
        self._case_paths = MappingProxyType(paths)
        self._case_parents = MappingProxyType({key: (path, MappingProxyType(expected))
                                             for key, (path, expected) in parents.items()})

    def _scan_case(self, key: str, *, final: bool = False) -> None:
        parent, expected = self._case_parents[key]
        self._check_chain(parent)
        original = self._case_snapshots.get(key)
        if original is not None and not final:
            return  # Original directory stamps still match; never refresh the snapshot.
        limits = self._limits
        if original is None and len(self._case_snapshots) >= limits.max_case_directories:
            _refuse("exact-case directory budget exceeded")
        if self._case_scans >= limits.max_case_scans:
            _refuse("exact-case scan budget exceeded")
        self._case_scans += 1
        counts = {folded: 0 for folded in expected}
        spelling = {folded: True for folded in expected}
        entries = 0
        with os.scandir(parent) as scanner:
            while True:
                if self._case_probes >= limits.max_case_probes:
                    _refuse("exact-case probe budget exceeded")
                self._case_probes += 1  # EOF and the failing limit+1 probe are real work.
                try:
                    entry = next(scanner)
                except StopIteration:
                    break
                name = entry.name
                if type(name) is not str:
                    _refuse("invalid directory entry name")
                size = len(name.encode("utf-8"))
                entries += 1
                self._case_stream_name_bytes += size
                if original is None:
                    self._case_unique_entries += 1
                    self._case_unique_name_bytes += size
                if (entries > limits.max_case_entries_per_directory
                        or size > limits.max_case_name_bytes
                        or self._case_stream_name_bytes > limits.max_case_stream_name_bytes
                        or self._case_unique_entries > limits.max_case_unique_entries
                        or self._case_unique_name_bytes > limits.max_case_unique_name_bytes):
                    _refuse("exact-case metadata budget exceeded")
                folded = name.casefold()
                if folded in expected:
                    counts[folded] += 1
                    spelling[folded] = spelling[folded] and name == expected[folded][0]
        self._check_chain(parent)
        for folded, (_, optional) in expected.items():
            if counts[folded] == 0 and optional:
                continue
            if counts[folded] != 1 or not spelling[folded]:
                _refuse("exact-case entry unavailable")
        snapshot = tuple(sorted((folded, counts[folded] != 0) for folded in expected))
        if original is not None and snapshot != original:
            _refuse("exact-case observation changed")
        self._case_snapshots.setdefault(key, snapshot)

    def _case_operand(self, key: str, supplied: Path) -> None:
        item = self._case_paths.get(key)
        if item is None:
            return
        admitted, root = item
        depth = len(root.parts)
        if supplied.parts[depth:] != admitted.parts[depth:]:
            _refuse("operand exact-case spelling differs")
        parent = root
        for component in admitted.parts[depth:]:
            self._scan_case(_key(parent))
            parent = parent / component

    def _enter(self) -> None:
        if self._poisoned or self._sealed:
            _refuse("observation is poisoned or sealed")
        self._operations += 1
        if self._operations > self._limits.max_operations:
            _refuse("public operation budget exceeded")

    def _operand(self, path: Path) -> tuple[str, Path]:
        path = _lexical(path)
        key = _key(path)
        if key in self._members:
            self._case_operand(key, path)
            return key, self._members[key].path
        if key in self._directories:
            self._case_operand(key, path)
            return key, self._directories[key]
        _refuse("operand was not admitted")

    def _member(self, path: Path) -> tuple[str, ReadMember]:
        key, _ = self._operand(path)
        if key not in self._members:
            _refuse("file operand required")
        return key, self._members[key]

    def _check_directory(self, path: Path, *, initial: bool = False) -> None:
        current = _fingerprint(os.lstat(path), directory=True)
        key = _key(path)
        original = self._directory_stamps.get(key)
        if original is None:
            if not initial:
                _refuse("unobserved directory")
            self._directory_stamps[key] = (path, current)
        elif original[1] != current:
            _refuse("directory identity changed")

    def _check_chain(self, directory: Path) -> None:
        for ancestor in _chain(directory):
            self._check_directory(ancestor)

    def _named(self, path: Path) -> _Fingerprint:
        return _fingerprint(os.lstat(path), directory=False)

    def _inspect(self, key: str, member: ReadMember, *, required: bool) -> _FileRecord | None:
        path = member.path
        self._check_chain(path.parent)
        try:
            current = self._named(path)
        except OSError as exc:
            if exc.errno != errno.ENOENT or required or not member.optional:
                raise
            if key in self._files and self._files[key] is not None:
                _refuse("observed file disappeared")
            self._check_chain(path.parent)
            try:
                self._named(path)
            except OSError as confirmation:
                if confirmation.errno != errno.ENOENT:
                    raise
            else:
                _refuse("absent file appeared")
            self._files[key] = None
            return None
        if current.size > min(member.max_bytes, self._limits.max_file_bytes):
            _refuse("file exceeds its admitted byte limit")
        if key in self._files:
            original = self._files[key]
            if original is None or original.fingerprint != current:
                _refuse("file identity changed")
        else:
            if len(self._files) >= self._limits.max_files:
                _refuse("unique file budget exceeded")
            if self._unique_bytes + current.size > self._limits.max_unique_bytes:
                _refuse("unique byte budget exceeded")
        with path.open("rb", buffering=0) as handle:
            opened = _fingerprint(os.fstat(handle.fileno()), directory=False)
            if not _same_object(current, opened):
                _refuse("named and opened identity differ")
            if key in self._files and self._files[key].opened_fingerprint != opened:
                _refuse("opened file identity changed")
            self._check_chain(path.parent)
            if self._named(path) != current or _fingerprint(os.fstat(handle.fileno()), directory=False) != opened:
                _refuse("file changed during metadata observation")
        record = _FileRecord(path, current, opened)
        if key not in self._files:
            self._unique_bytes += current.size
        self._files[key] = record
        return record

    def _stream(self, key: str, member: ReadMember, *, collect: bool = False,
                collection_limit: int | None = None) -> tuple[str, bytes | None]:
        record = self._inspect(key, member, required=True)
        if record is None:
            _refuse("required file absent")
        expected = record.fingerprint
        if collect:
            cap = self._limits.max_json_bytes if collection_limit is None else collection_limit
            if expected.size > min(member.max_bytes, cap):
                _refuse("JSON byte budget exceeded" if collection_limit is None else "raw byte buffer budget exceeded")
        if expected.size > self._limits.max_stream_bytes - self._stream_bytes:
            _refuse("remaining stream budget insufficient")
        digest = hashlib.sha256()
        chunks = [] if collect else None
        seen = 0
        with record.path.open("rb", buffering=0) as handle:
            if _fingerprint(os.fstat(handle.fileno()), directory=False) != record.opened_fingerprint:
                _refuse("opened stream identity changed")
            self._check_chain(record.path.parent)
            if self._named(record.path) != expected:
                _refuse("named stream identity changed")
            while seen < expected.size:
                block = handle.read(min(_CHUNK, expected.size - seen))
                if not block:
                    _refuse("short file stream")
                self._stream_bytes += len(block)
                seen += len(block)
                if seen > expected.size or self._stream_bytes > self._limits.max_stream_bytes:
                    _refuse("stream grew beyond its budget")
                digest.update(block)
                if chunks is not None:
                    chunks.append(block)
            if _fingerprint(os.fstat(handle.fileno()), directory=False) != record.opened_fingerprint:
                _refuse("opened file changed while streamed")
            self._check_chain(record.path.parent)
            if self._named(record.path) != expected:
                _refuse("named file changed while streamed")
        result = digest.hexdigest()
        if key in self._digests and self._digests[key] != result:
            _refuse("observed content changed")
        self._digests.setdefault(key, result)
        return result, b"".join(chunks) if chunks is not None else None

    @_public
    def resolve(self, path: Path) -> Path:
        key, admitted = self._operand(path)
        if key in self._members:
            self._inspect(key, self._members[key], required=False)
        else:
            self._check_chain(admitted)
        return admitted

    @_public
    def file(self, path: Path, *, required: bool = False) -> FileObservation | None:
        if type(required) is not bool:
            _refuse("required must be boolean")
        key, member = self._member(path)
        record = self._inspect(key, member, required=required)
        return None if record is None else FileObservation(record.path, record.fingerprint.size)

    @_public
    def sha256(self, path: Path) -> str:
        key, member = self._member(path)
        return self._stream(key, member)[0]

    @_public
    def read_bytes(self, path: Path) -> bytes:
        """Collect explicitly admitted bytes with the same retained hash/identity checks.

        Raw access is independent of JSON permission and capped at 32 MiB even
        for larger hashable members. Rechecks still stream and charge every byte.
        """
        key, member = self._member(path)
        if not member.allow_bytes:
            _refuse("member is not admitted for raw bytes")
        _, raw = self._stream(key, member, collect=True, collection_limit=_MAX_COLLECTED_BYTES)
        return raw

    @_public
    def read_json(self, path: Path) -> Any:
        key, member = self._member(path)
        if not member.allow_json:
            _refuse("member is not admitted for JSON")
        _, raw = self._stream(key, member, collect=True)
        value = json.loads(raw.decode("utf-8"))
        stack = [(value, 1)]
        nodes = 0
        while stack:
            item, depth = stack.pop()
            nodes += 1
            if depth > self._limits.max_json_depth or nodes > self._limits.max_json_nodes:
                _refuse("JSON structural budget exceeded")
            if isinstance(item, (dict, list)):
                if len(item) > self._limits.max_json_entries:
                    _refuse("JSON collection budget exceeded")
                children = item.values() if isinstance(item, dict) else item
                stack.extend((child, depth + 1) for child in children)
        return value

    @_public
    def recheck(self) -> None:
        for directory, _ in self._directory_stamps.values():
            self._check_directory(directory)
        for key in tuple(self._files):
            member = self._members[key]
            if key in self._digests:
                self._stream(key, member)
            else:
                self._inspect(key, member, required=False)
        for directory, _ in self._directory_stamps.values():
            self._check_directory(directory)
        for key in tuple(self._case_snapshots):
            self._scan_case(key, final=True)
        self._sealed = True
