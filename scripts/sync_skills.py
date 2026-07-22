"""Mirror reviewed skills into each runtime's native discovery directory.

``skills/curated`` is authoritative. ``.claude/skills`` and ``.agents/skills``
are generated, committed projections for Claude and Codex respectively. Runtime
copies are byte-identical and guarded by the same SHA-256 manifest contract.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

MANIFEST = "MANIFEST.json"
MIRRORS = (Path(".claude/skills"), Path(".agents/skills"))
LEGACY_OUTPUTS = (
    Path(".codex/MANIFEST.json"),
    Path(".codex/skills-catalog.md"),
)
REPARSE_POINT = 0x400


def _lexists(path: Path) -> bool:
    return os.path.lexists(path)


def _is_link_or_reparse(path: Path) -> bool:
    try:
        attrs = getattr(path.lstat(), 'st_file_attributes', 0)
    except FileNotFoundError:
        return False
    return path.is_symlink() or bool(attrs & REPARSE_POINT)


def _real_directory(path: Path) -> bool:
    return path.is_dir() and not _is_link_or_reparse(path)


def _real_file(path: Path) -> bool:
    return path.is_file() and not _is_link_or_reparse(path)


def _managed_path(
    repo_root: Path, relative: Path, *, removable_leaf: bool = False
) -> Path:
    """Resolve a repo-relative path without traversing linked managed ancestors."""
    path = Path(repo_root)
    parts = relative.parts
    for index, part in enumerate(parts):
        path /= part
        if not _lexists(path) or not _is_link_or_reparse(path):
            continue
        if removable_leaf and index == len(parts) - 1:
            continue
        raise ValueError(f"managed path contains a link or reparse point: {path}")
    return path


def _validate_tree(directory: Path) -> None:
    if not _real_directory(directory):
        raise ValueError(f'skill tree must be a real directory: {directory}')
    for path in directory.rglob('*'):
        if _is_link_or_reparse(path):
            raise ValueError(f'skill tree contains a link or reparse point: {path}')
        if not path.is_dir() and not path.is_file():
            raise ValueError(f'skill tree contains an unsupported entry: {path}')


def _matches_directory(path: Path, digest: str) -> bool:
    if not _real_directory(path):
        return False
    try:
        return _hash_dir(path) == digest
    except (OSError, ValueError):
        return False


def _remove_managed_path(path: Path) -> None:
    if not _lexists(path):
        return
    if path.is_symlink():
        path.unlink()
    elif _is_link_or_reparse(path):
        if path.is_dir():
            path.rmdir()
        else:
            path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


def _ensure_directory(path: Path) -> None:
    if _lexists(path) and not _real_directory(path):
        _remove_managed_path(path)
    path.mkdir(parents=True, exist_ok=True)


def _hash_dir(directory: Path) -> str:
    _validate_tree(directory)
    digest = hashlib.sha256()
    for path in sorted(
        directory.rglob("*"), key=lambda item: item.relative_to(directory).as_posix()
    ):
        if path.is_file():
            relative = path.relative_to(directory).as_posix().encode("utf-8")
            content = path.read_bytes()
            # Length-prefix both fields so different file maps cannot collapse
            # into the same concatenated byte stream.
            digest.update(len(relative).to_bytes(8, "big"))
            digest.update(relative)
            digest.update(len(content).to_bytes(8, "big"))
            digest.update(content)
    return digest.hexdigest()


def _source(repo_root: Path) -> Path:
    return _managed_path(Path(repo_root), Path("skills/curated"))


def _manifest(source: Path) -> dict[str, str]:
    if not _lexists(source):
        return {}
    _validate_tree(source)
    return {
        skill.name: _hash_dir(skill)
        for skill in sorted(path for path in source.iterdir() if path.is_dir())
    }


def sync(repo_root: Path) -> dict[str, str]:
    repo_root = Path(repo_root)
    source = _source(repo_root)
    manifest = _manifest(source)

    for legacy in LEGACY_OUTPUTS:
        _remove_managed_path(_managed_path(repo_root, legacy, removable_leaf=True))

    for relative in MIRRORS:
        mirror = _managed_path(repo_root, relative, removable_leaf=True)
        _ensure_directory(mirror)
        for name in manifest:
            destination = mirror / name
            if _matches_directory(destination, manifest[name]):
                continue
            if _lexists(destination):
                _remove_managed_path(destination)
            shutil.copytree(source / name, destination)
        for existing in list(mirror.iterdir()):
            if existing.name not in manifest and existing.name != MANIFEST:
                _remove_managed_path(existing)
        manifest_text = json.dumps(manifest, indent=2)
        manifest_path = mirror / MANIFEST
        if _lexists(manifest_path) and not _real_file(manifest_path):
            _remove_managed_path(manifest_path)
        if not _real_file(manifest_path) or manifest_path.read_text(encoding="utf-8") != manifest_text:
            manifest_path.write_text(manifest_text, encoding="utf-8")

    return manifest


def check(repo_root: Path) -> list[str]:
    repo_root = Path(repo_root)
    problems: list[str] = []
    try:
        expected = _manifest(_source(repo_root))
    except (OSError, ValueError) as error:
        return [f"skills/curated: unsafe or unreadable source: {error}"]

    for legacy in LEGACY_OUTPUTS:
        try:
            legacy_path = _managed_path(repo_root, legacy, removable_leaf=True)
        except ValueError as error:
            problems.append(str(error))
            continue
        if _lexists(legacy_path):
            problems.append(
                f"legacy generated output remains: {legacy.as_posix()} -- run sync"
            )
    for relative in MIRRORS:
        label = relative.as_posix()
        try:
            mirror = _managed_path(repo_root, relative, removable_leaf=True)
        except ValueError as error:
            problems.append(f"{label}: {error}")
            continue
        if not _real_directory(mirror):
            problems.append(
                f"{label}: mirror root is missing or not a real directory -- run sync"
            )
            continue
        manifest_path = mirror / MANIFEST
        if not _real_file(manifest_path):
            problems.append(f"{label}: no manifest — run sync")
            continue
        try:
            recorded = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            problems.append(f"{label}: unreadable manifest — run sync")
            continue
        if recorded != expected:
            problems.append(f"{label}: manifest does not match skills/curated — run sync")
        for name, digest in expected.items():
            skill = mirror / name
            if not _lexists(skill):
                problems.append(f"{label}/{name}: mirrored copy missing")
            elif not _real_directory(skill):
                problems.append(f"{label}/{name}: mirrored copy is not a real directory")
            elif not _matches_directory(skill, digest):
                problems.append(f"{label}/{name}: mirrored copy does not match source")
        allowed = set(expected) | {MANIFEST}
        for entry in mirror.iterdir():
            if entry.name not in allowed:
                problems.append(f"{label}/{entry.name}: unmanifested entry in mirror")

    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        problems = check(Path.cwd())
        for problem in problems:
            print(f"DRIFT: {problem}")
        return 1 if problems else 0
    manifest = sync(Path.cwd())
    print(f"synced {len(manifest)} skill(s) to {len(MIRRORS)} runtimes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
