"""Authoritative skills sync: skills/curated -> .claude/skills (+ hash manifest).

.claude/skills is GENERATED (committed so cloud sessions get it) — never hand-edit.
Drift between manifest and content = tampering (spec s6).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

MANIFEST = "MANIFEST.json"


def _hash_dir(d: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(d.rglob("*")):
        if f.is_file():
            h.update(str(f.relative_to(d)).replace("\\", "/").encode())
            h.update(f.read_bytes())
    return h.hexdigest()


def _dirs(repo_root: Path):
    curated = Path(repo_root) / "skills" / "curated"
    mirror = Path(repo_root) / ".claude" / "skills"
    return curated, mirror


def sync(repo_root: Path) -> dict:
    curated, mirror = _dirs(repo_root)
    mirror.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, str] = {}
    wanted = set()
    if curated.exists():
        for src in sorted(p for p in curated.iterdir() if p.is_dir()):
            wanted.add(src.name)
            dest = mirror / src.name
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(src, dest)
            manifest[src.name] = _hash_dir(dest)
    for existing in list(mirror.iterdir()):
        if existing.is_dir() and existing.name not in wanted:
            shutil.rmtree(existing)
    (mirror / MANIFEST).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def check(repo_root: Path) -> list[str]:
    _, mirror = _dirs(repo_root)
    mf = mirror / MANIFEST
    if not mf.exists():
        return ["no manifest — run sync"]
    manifest = json.loads(mf.read_text(encoding="utf-8"))
    problems = []
    for name, digest in manifest.items():
        d = mirror / name
        if not d.exists():
            problems.append(f"{name}: mirrored copy missing")
        elif _hash_dir(d) != digest:
            problems.append(f"{name}: mirrored copy does not match manifest (tampering/drift)")
    for d in mirror.iterdir():
        if d.is_dir() and d.name not in manifest:
            problems.append(f"{d.name}: unmanifested skill in mirror")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.check:
        problems = check(Path.cwd())
        for p in problems:
            print(f"DRIFT: {p}")
        return 1 if problems else 0
    manifest = sync(Path.cwd())
    print(f"synced {len(manifest)} skill(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
