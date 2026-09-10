"""Hardened local-file capture primitives shared by private import services."""

from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path
import re
import stat


_SAFE_NAME = re.compile(r"[a-z][a-z0-9_-]{1,79}\Z")
_SAFE_NAMESPACE = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")


class SourceCaptureError(ValueError):
    """Fixed-code local capture refusal."""


@dataclass(frozen=True, repr=False)
class CapturedBytes:
    body_ref: str
    contents: bytes = field(repr=False)


def _unsafe(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0)
        & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    )


def _reject_reparse_tree(path: Path) -> None:
    try:
        for candidate in (path, *path.parents):
            if _unsafe(candidate.lstat()):
                raise OSError
    except OSError:
        raise SourceCaptureError("source_changed") from None


def _relative(value: object) -> tuple[str, Path]:
    if type(value) is not str or not value or value != value.strip() or "\\" in value:
        raise SourceCaptureError("invalid_ref")
    path = Path(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise SourceCaptureError("invalid_ref")
    try:
        if len(value.encode("utf-8")) > 240:
            raise SourceCaptureError("invalid_ref")
    except UnicodeError:
        raise SourceCaptureError("invalid_ref") from None
    return value, path


def _bounded_read(root: Path, body_ref: object, maximum: int) -> CapturedBytes:
    ref, relative = _relative(body_ref)
    if type(maximum) is not int or maximum < 1:
        raise SourceCaptureError("invalid_limit")
    try:
        _reject_reparse_tree(root)
        resolved_root = root.resolve(strict=True)
        current = resolved_root
        for part in relative.parts:
            current /= part
            if _unsafe(current.lstat()):
                raise OSError
        resolved = (resolved_root / relative).resolve(strict=True)
        before = resolved.lstat()
        if (
            resolved_root not in resolved.parents or _unsafe(before)
            or not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
        ):
            raise OSError
        if before.st_size > maximum:
            raise SourceCaptureError("too_large")
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        with os.fdopen(os.open(resolved, flags), "rb") as handle:
            opened = os.fstat(handle.fileno())
            identity = (before.st_dev, before.st_ino)
            if identity != (opened.st_dev, opened.st_ino):
                raise OSError
            contents = handle.read(maximum + 1)
            after = os.fstat(handle.fileno())
        named = resolved.lstat()
        if (
            len(contents) > maximum or len(contents) != after.st_size
            or identity != (after.st_dev, after.st_ino)
            or identity != (named.st_dev, named.st_ino)
            or opened.st_mtime_ns != after.st_mtime_ns
            or after.st_mtime_ns != named.st_mtime_ns
            or _unsafe(named) or named.st_nlink != 1
        ):
            raise OSError
        return CapturedBytes(ref, contents)
    except SourceCaptureError:
        raise
    except (OSError, RuntimeError, ValueError):
        raise SourceCaptureError("source_changed") from None


def read_capture(root: Path, body_ref: object, *, maximum: int) -> CapturedBytes:
    """Read one caller-selected file below a store snapshot root."""
    return _bounded_read(root, body_ref, maximum)


def read_owned(root: Path, body_ref: object, *, maximum: int) -> CapturedBytes:
    """Re-read one service-owned snapshot with the same containment checks."""
    return _bounded_read(root, body_ref, maximum)


def copy_owned(
    root: Path, *, namespace: str | None, snapshot_id: str, contents: bytes,
    maximum: int, created: list[tuple[Path, tuple[int, int]]],
) -> str:
    """Create one exclusive owned snapshot and record its exact filesystem identity."""
    if (
        type(snapshot_id) is not str or _SAFE_NAME.fullmatch(snapshot_id) is None
        or type(contents) is not bytes or len(contents) > maximum
        or namespace is not None and (
            type(namespace) is not str or _SAFE_NAMESPACE.fullmatch(namespace) is None
        )
    ):
        raise SourceCaptureError("invalid_copy")
    folder = root if namespace is None else root / namespace
    try:
        _reject_reparse_tree(root)
        folder.mkdir(parents=True, exist_ok=True)
        if _unsafe(folder.lstat()):
            raise OSError
        folder_info = folder.lstat()
        folder_identity = (folder_info.st_dev, folder_info.st_ino)
    except (OSError, SourceCaptureError):
        raise SourceCaptureError("source_changed") from None
    body_ref = f"{snapshot_id}.body" if namespace is None else f"{namespace}/{snapshot_id}.body"
    final = root / Path(body_ref)
    staged = folder / f".{snapshot_id}.tmp"
    staged_identity: tuple[int, int] | None = None
    final_identity: tuple[int, int] | None = None
    try:
        descriptor = os.open(
            staged, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0), 0o600,
        )
        try:
            staged_info = os.fstat(descriptor)
        except BaseException:
            os.close(descriptor)
            raise
        staged_identity = (staged_info.st_dev, staged_info.st_ino)
        try:
            opened_file = os.fdopen(descriptor, "wb")
        except BaseException:
            os.close(descriptor)
            raise
        with opened_file as handle:
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
            written = os.fstat(handle.fileno())
            if (
                staged_identity != (written.st_dev, written.st_ino)
                or not stat.S_ISREG(written.st_mode) or written.st_nlink != 1
                or written.st_size != len(contents)
            ):
                raise OSError
        current_folder = folder.lstat()
        if folder_identity != (current_folder.st_dev, current_folder.st_ino) or _unsafe(current_folder):
            raise OSError
        os.link(staged, final)
        final_identity = staged_identity
        linked = final.lstat()
        if (linked.st_dev, linked.st_ino) != staged_identity or linked.st_nlink != 2:
            raise OSError
        staged.unlink()
        found = final.lstat()
        current_folder = folder.lstat()
        if (
            folder_identity != (current_folder.st_dev, current_folder.st_ino)
            or (found.st_dev, found.st_ino) != final_identity or _unsafe(found)
            or found.st_nlink != 1 or found.st_size != len(contents)
        ):
            raise OSError
        created.append((final, final_identity))
        return body_ref
    except OSError:
        for path, identity in ((staged, staged_identity), (final, final_identity)):
            if identity is None:
                continue
            try:
                found = path.lstat()
                if (found.st_dev, found.st_ino) == identity:
                    path.unlink()
            except FileNotFoundError:
                pass
        raise SourceCaptureError("source_changed") from None


def cleanup_owned(created: list[tuple[Path, tuple[int, int]]]) -> None:
    """Remove only files whose current identity matches an owned creation receipt."""
    for path, identity in reversed(created):
        try:
            found = path.lstat()
            if (
                (found.st_dev, found.st_ino) == identity and not _unsafe(found)
                and stat.S_ISREG(found.st_mode) and found.st_nlink == 1
            ):
                path.unlink()
        except FileNotFoundError:
            pass
