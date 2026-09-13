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


@dataclass(frozen=True)
class ReadMember:
    path: Path
    max_bytes: int
    allow_json: bool = False
    optional: bool = False


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
                    or type(member.allow_json) is not bool or type(member.optional) is not bool):
                _refuse("invalid per-member restriction")
            key = _key(path)
            if key in admitted:
                _refuse("duplicate normalized member")
            admitted[key] = ReadMember(path, member.max_bytes, member.allow_json, member.optional)
            for ancestor in path.parents:
                if any(_within(ancestor, root) for root in self._roots):
                    operands.setdefault(_key(ancestor), ancestor)
        if admitted.keys() & operands.keys():
            _refuse("file and directory policies conflict")
        for anchor in dict.fromkeys(root.anchor for root in self._roots):
            _local_drive(anchor)
        self._members = MappingProxyType(admitted)
        self._directories = MappingProxyType(operands)
        # Observe every ancestor up to the local drive. Outside-root ancestors
        # are safety observations only, never admitted operands or read roots.
        for directory in operands.values():
            for ancestor in _chain(directory):
                self._check_directory(ancestor, initial=True)

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
            return key, self._members[key].path
        if key in self._directories:
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

    def _stream(self, key: str, member: ReadMember, *, collect: bool = False) -> tuple[str, bytes | None]:
        record = self._inspect(key, member, required=True)
        if record is None:
            _refuse("required file absent")
        expected = record.fingerprint
        if collect and expected.size > min(member.max_bytes, self._limits.max_json_bytes):
            _refuse("JSON byte budget exceeded")
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
        self._sealed = True
