"""Authoritative skills sync: skills/curated -> .claude/skills (+ hash manifest).

.claude/skills is GENERATED (committed so cloud sessions get it) — never hand-edit.
Drift between manifest and content = tampering (spec s6).

Adapter renderers (RENDERERS map) project skills/curated/* into other agents'
native formats under the same authoritative-sync + SHA-256 drift-guard model.
Only `codex` ships today; `render_gemini` etc. can be added later without
restructuring — each renderer is a pure `(repo_root) -> (artifact_path, text)`
function, and sync()/check() drive them generically.
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
    for f in sorted(d.rglob("*"), key=lambda p: p.relative_to(d).as_posix()):
        if f.is_file():
            h.update(str(f.relative_to(d)).replace("\\", "/").encode())
            h.update(f.read_bytes())
    return h.hexdigest()


def _dirs(repo_root: Path):
    curated = Path(repo_root) / "skills" / "curated"
    mirror = Path(repo_root) / ".claude" / "skills"
    return curated, mirror


def render_codex(repo_root: Path) -> tuple[Path, str]:
    """Pure renderer: skills/curated/* -> deterministic .codex/skills-catalog.md.

    Returns (artifact_path, rendered_text). No filesystem writes here — sync()
    writes it, check() re-derives it read-only to compare against the manifest.
    """
    curated, _ = _dirs(repo_root)
    catalog = Path(repo_root) / ".codex" / "skills-catalog.md"
    names = sorted(p.name for p in curated.iterdir() if p.is_dir()) if curated.exists() else []
    lines = [
        "# Codex Skills Catalog",
        "",
        "Generated from skills/curated/ by scripts/sync_skills.py — do not hand-edit.",
        "",
    ]
    lines.extend(f"- {name}" for name in names)
    text = "\n".join(lines) + "\n"
    return catalog, text


# Adapter dispatch, kept generic: add render_gemini etc. here later without
# restructuring sync()/check(). Only codex ships today.
RENDERERS = {
    "codex": render_codex,
}


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

    for _adapter, render_fn in RENDERERS.items():
        artifact, text = render_fn(repo_root)
        artifact.parent.mkdir(parents=True, exist_ok=True)
        # newline="" disables universal-newline translation on write (Windows
        # would otherwise turn our "\n" into "\r\n", desyncing the on-disk
        # bytes from the digest computed over `text`).
        artifact.write_text(text, encoding="utf-8", newline="")
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        adapter_manifest = artifact.parent / MANIFEST
        adapter_manifest.write_text(
            json.dumps({artifact.name: digest}, indent=2), encoding="utf-8"
        )

    return manifest


def check(repo_root: Path) -> list[str]:
    _, mirror = _dirs(repo_root)
    mf = mirror / MANIFEST
    problems: list[str] = []
    if not mf.exists():
        problems.append("no manifest — run sync")
    else:
        manifest = json.loads(mf.read_text(encoding="utf-8"))
        for name, digest in manifest.items():
            d = mirror / name
            if not d.exists():
                problems.append(f"{name}: mirrored copy missing")
            elif _hash_dir(d) != digest:
                problems.append(f"{name}: mirrored copy does not match manifest (tampering/drift)")
        for d in mirror.iterdir():
            if d.is_dir() and d.name not in manifest:
                problems.append(f"{d.name}: unmanifested skill in mirror")

    for adapter, render_fn in RENDERERS.items():
        artifact, expected_text = render_fn(repo_root)
        adapter_manifest = artifact.parent / MANIFEST
        if not adapter_manifest.exists():
            problems.append(f"{adapter}: no manifest — run sync")
            continue
        adapter_data = json.loads(adapter_manifest.read_text(encoding="utf-8"))
        expected_digest = adapter_data.get(artifact.name)
        if expected_digest is None:
            problems.append(f"{adapter}: {artifact.name} missing from manifest")
            continue
        if not artifact.exists():
            problems.append(f"{adapter}: {artifact.name} missing")
            continue
        # Normalize CRLF -> LF before hashing: the manifest digest is computed
        # over the LF text render_codex() produced, but core.autocrlf=true
        # materializes the committed file with CRLF on a fresh checkout —
        # hashing raw bytes would flag false "drift" in every new worktree and
        # block all commits there. Real tampering still changes the normalized
        # bytes, so the guard's strength is unchanged.
        actual_digest = hashlib.sha256(
            artifact.read_bytes().replace(b"\r\n", b"\n")
        ).hexdigest()
        if actual_digest != expected_digest:
            problems.append(
                f"{adapter}: {artifact.name} does not match manifest (tampering/drift)"
            )
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
