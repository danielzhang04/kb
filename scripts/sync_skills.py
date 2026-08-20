"""Mirror reviewed skills and kit blocks into each runtime's native directories.

``skills/curated`` is authoritative. ``.claude/skills`` and ``.agents/skills``
are generated, committed projections for Claude and Codex respectively. Runtime
copies are byte-identical and guarded by the same SHA-256 manifest contract.
Top-level ``kit/*.md`` blocks are projected separately to each runtime's
``kb-kit`` directory under the ``kit:`` manifest namespace.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

MANIFEST = "MANIFEST.json"
MIRRORS = (Path(".claude/skills"), Path(".agents/skills"))
KIT_AUDIENCES = ("all", "claude", "codex")
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


def _kit_source(repo_root: Path) -> Path:
    return _managed_path(Path(repo_root), Path("kit"))


def _manifest(source: Path) -> dict[str, str]:
    if not _lexists(source):
        return {}
    _validate_tree(source)
    return {
        skill.name: _hash_dir(skill)
        for skill in sorted(path for path in source.iterdir() if path.is_dir())
    }


def _kit_files(source: Path) -> dict[str, Path]:
    """Return top-level kit markdown files under their manifest keys."""
    if not _lexists(source):
        return {}
    if not _real_directory(source):
        raise ValueError(f"kit source must be a real directory: {source}")

    files: dict[str, Path] = {}
    for path in sorted(source.glob("*.md"), key=lambda item: item.name):
        if _real_directory(path):
            continue
        if not _real_file(path):
            raise ValueError(f"kit source contains a link or unsupported entry: {path}")
        files[f"kit:{path.stem}"] = path
    return files


def _hash_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _kit_manifest(files: dict[str, Path]) -> dict[str, str]:
    return {name: _hash_file(path) for name, path in files.items()}


def _kit_mirror(relative: Path) -> Path:
    return relative.parent / "kb-kit"


def _sync_kit_mirror(
    repo_root: Path,
    relative: Path,
    kit_source: Path,
    kit_files: dict[str, Path],
    kit_manifest: dict[str, str],
) -> None:
    """Project kit blocks, or remove a stale projection when kit is absent."""
    kit_mirror = _managed_path(repo_root, _kit_mirror(relative), removable_leaf=True)
    if not _lexists(kit_source):
        if _lexists(kit_mirror):
            _remove_managed_path(kit_mirror)
        return

    _ensure_directory(kit_mirror)
    expected_kit_files = {path.name for path in kit_files.values()}
    for name, source_file in kit_files.items():
        destination = kit_mirror / source_file.name
        if _real_file(destination) and _hash_file(destination) == kit_manifest[name]:
            continue
        if _lexists(destination):
            _remove_managed_path(destination)
        shutil.copy2(source_file, destination)
    for existing in list(kit_mirror.iterdir()):
        if existing.name not in expected_kit_files:
            _remove_managed_path(existing)


def _ensure_scripts_importable() -> None:
    """Make ``scripts.kit.assemble`` importable under script-form invocation.

    ``python -m scripts.sync_skills`` already has the repo root on
    ``sys.path``, but ``python scripts/sync_skills.py`` (the form used by
    .githooks/pre-commit and the nightly cadence) does not: ``scripts`` is
    not importable, so the package-qualified import below raises
    ModuleNotFoundError. Patch ``sys.path`` only when needed, and only
    right before this lazy import, so repos without kit/ never pay for it.
    """
    try:
        import scripts  # noqa: F401
    except ModuleNotFoundError:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _assemble_kit(repo_root: Path) -> None:
    """Regenerate every model-visible kit artifact after a successful projection."""
    _ensure_scripts_importable()
    from scripts.kit.assemble import assemble

    for audience in KIT_AUDIENCES:
        assemble(repo_root, audience)


def _rendered_kit_bytes(kit_files: dict[str, Path], audience: str) -> bytes:
    """Render a kit copy outside the repository for drift comparison."""
    _ensure_scripts_importable()
    from scripts.kit.assemble import assemble

    with tempfile.TemporaryDirectory() as temporary:
        temporary_root = Path(temporary)
        temporary_kit = temporary_root / "kit"
        temporary_kit.mkdir()
        for source_file in kit_files.values():
            shutil.copy2(source_file, temporary_kit / source_file.name)
        return assemble(temporary_root, audience).read_bytes()


def sync(repo_root: Path) -> dict[str, str]:
    repo_root = Path(repo_root)
    source = _source(repo_root)
    skill_manifest = _manifest(source)
    kit_source = _kit_source(repo_root)
    kit_files = _kit_files(kit_source)
    kit_manifest = _kit_manifest(kit_files)
    manifest = skill_manifest | kit_manifest

    for legacy in LEGACY_OUTPUTS:
        _remove_managed_path(_managed_path(repo_root, legacy, removable_leaf=True))

    for relative in MIRRORS:
        mirror = _managed_path(repo_root, relative, removable_leaf=True)
        _ensure_directory(mirror)
        for name in skill_manifest:
            destination = mirror / name
            if _matches_directory(destination, skill_manifest[name]):
                continue
            if _lexists(destination):
                _remove_managed_path(destination)
            shutil.copytree(source / name, destination)
        for existing in list(mirror.iterdir()):
            if existing.name not in skill_manifest and existing.name != MANIFEST:
                _remove_managed_path(existing)

        _sync_kit_mirror(
            repo_root, relative, kit_source, kit_files, kit_manifest
        )
        manifest_text = json.dumps(manifest, indent=2)
        manifest_path = mirror / MANIFEST
        if _lexists(manifest_path) and not _real_file(manifest_path):
            _remove_managed_path(manifest_path)
        if not _real_file(manifest_path) or manifest_path.read_text(encoding="utf-8") != manifest_text:
            manifest_path.write_text(manifest_text, encoding="utf-8")

    if _lexists(kit_source):
        _ensure_scripts_importable()
        from scripts.kit.assemble import KitBudgetError, KitFrontmatterError

        try:
            _assemble_kit(repo_root)
        except (KitFrontmatterError, KitBudgetError) as error:
            print(f"kit: {error}", file=sys.stderr)
            raise SystemExit(1) from None

    return manifest


def check(repo_root: Path) -> list[str]:
    repo_root = Path(repo_root)
    problems: list[str] = []
    try:
        skill_expected = _manifest(_source(repo_root))
    except (OSError, ValueError) as error:
        return [f"skills/curated: unsafe or unreadable source: {error}"]
    try:
        kit_source = _kit_source(repo_root)
        kit_files = _kit_files(kit_source)
        kit_expected = _kit_manifest(kit_files)
    except (OSError, ValueError) as error:
        return [f"kit: unsafe or unreadable source: {error}"]
    expected = skill_expected | kit_expected

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
        for name, digest in skill_expected.items():
            skill = mirror / name
            if not _lexists(skill):
                problems.append(f"{label}/{name}: mirrored copy missing")
            elif not _real_directory(skill):
                problems.append(f"{label}/{name}: mirrored copy is not a real directory")
            elif not _matches_directory(skill, digest):
                problems.append(f"{label}/{name}: mirrored copy does not match source")
        allowed = set(skill_expected) | {MANIFEST}
        for entry in mirror.iterdir():
            if entry.name not in allowed:
                problems.append(f"{label}/{entry.name}: unmanifested entry in mirror")

        kit_relative = _kit_mirror(relative)
        kit_label = kit_relative.as_posix()
        try:
            kit_mirror = _managed_path(repo_root, kit_relative, removable_leaf=True)
        except ValueError as error:
            problems.append(f"{kit_label}: {error}")
            continue
        if not _lexists(kit_source):
            if _lexists(kit_mirror):
                problems.append(f"{kit_label}: stale mirror remains after kit removal -- run sync")
            continue
        if not _real_directory(kit_mirror):
            problems.append(
                f"{kit_label}: mirror root is missing or not a real directory -- run sync"
            )
            continue
        expected_kit_files = {path.name for path in kit_files.values()}
        for name, source_file in kit_files.items():
            kit_file = kit_mirror / source_file.name
            if not _lexists(kit_file):
                problems.append(f"{kit_label}/{source_file.name}: {name} mirrored copy missing")
            elif not _real_file(kit_file):
                problems.append(
                    f"{kit_label}/{source_file.name}: {name} mirrored copy is not a real file"
                )
            elif _hash_file(kit_file) != kit_expected[name]:
                problems.append(
                    f"{kit_label}/{source_file.name}: {name} mirrored copy does not match source"
                )
        for entry in kit_mirror.iterdir():
            if entry.name not in expected_kit_files:
                problems.append(f"{kit_label}/{entry.name}: unmanifested entry in mirror")

    if _lexists(kit_source):
        _ensure_scripts_importable()
        from scripts.kit.assemble import KitBudgetError, KitFrontmatterError

        for audience in KIT_AUDIENCES:
            artifact = kit_source / ".rendered" / f"{audience}.md"
            if not _real_file(artifact):
                problems.append(
                    f"kit/.rendered/{audience}.md: rendered artifact missing -- run sync"
                )
                continue
            try:
                rendered = _rendered_kit_bytes(kit_files, audience)
            except (KitFrontmatterError, KitBudgetError) as error:
                problems.append(f"kit/.rendered/{audience}.md: {error}")
                continue
            if artifact.read_bytes() != rendered:
                problems.append(
                    f"kit/.rendered/{audience}.md: rendered artifact does not match source -- run sync"
                )

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
    skill_count = sum(not name.startswith("kit:") for name in manifest)
    kit_count = len(manifest) - skill_count
    suffix = f" and {kit_count} kit block(s)" if kit_count else ""
    print(f"synced {skill_count} skill(s){suffix} to {len(MIRRORS)} runtimes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
