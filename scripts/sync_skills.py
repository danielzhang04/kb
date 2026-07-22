"""Mirror reviewed skills into each runtime's native discovery directory.

``skills/curated`` is authoritative. ``.claude/skills`` and ``.agents/skills``
are generated, committed projections for Claude and Codex respectively. Runtime
copies are byte-identical and guarded by the same SHA-256 manifest contract.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

MANIFEST = "MANIFEST.json"
MIRRORS = (Path(".claude/skills"), Path(".agents/skills"))


def _hash_dir(directory: Path) -> str:
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
    return Path(repo_root) / "skills" / "curated"


def _manifest(source: Path) -> dict[str, str]:
    if not source.exists():
        return {}
    return {
        skill.name: _hash_dir(skill)
        for skill in sorted(path for path in source.iterdir() if path.is_dir())
    }


def sync(repo_root: Path) -> dict[str, str]:
    repo_root = Path(repo_root)
    source = _source(repo_root)
    manifest = _manifest(source)

    for relative in MIRRORS:
        mirror = repo_root / relative
        mirror.mkdir(parents=True, exist_ok=True)
        for name in manifest:
            destination = mirror / name
            if destination.exists() and _hash_dir(destination) == manifest[name]:
                continue
            if destination.exists():
                shutil.rmtree(destination)
            shutil.copytree(source / name, destination)
        for existing in list(mirror.iterdir()):
            if existing.is_dir() and existing.name not in manifest:
                shutil.rmtree(existing)
        manifest_text = json.dumps(manifest, indent=2)
        manifest_path = mirror / MANIFEST
        if not manifest_path.exists() or manifest_path.read_text(encoding="utf-8") != manifest_text:
            manifest_path.write_text(manifest_text, encoding="utf-8")

    return manifest


def check(repo_root: Path) -> list[str]:
    repo_root = Path(repo_root)
    expected = _manifest(_source(repo_root))
    problems: list[str] = []

    for relative in MIRRORS:
        mirror = repo_root / relative
        label = relative.as_posix()
        manifest_path = mirror / MANIFEST
        if not manifest_path.exists():
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
            if not skill.exists():
                problems.append(f"{label}/{name}: mirrored copy missing")
            elif _hash_dir(skill) != digest:
                problems.append(f"{label}/{name}: mirrored copy does not match source")
        for skill in mirror.iterdir():
            if skill.is_dir() and skill.name not in expected:
                problems.append(f"{label}/{skill.name}: unmanifested skill in mirror")

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
