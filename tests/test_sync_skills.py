import hashlib
import json
import subprocess
import sys
from pathlib import Path

import sync_skills

REPO_ROOT = Path(__file__).parent.parent
SYNC_SCRIPT = REPO_ROOT / "scripts" / "sync_skills.py"


def make_skill(root, name, content="do things"):
    d = root / "skills" / "curated" / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\nname: {name}\n---\n{content}", encoding="utf-8")


def test_sync_mirrors_curated(tmp_path):
    make_skill(tmp_path, "alpha")
    result = sync_skills.sync(tmp_path)
    assert (tmp_path / ".claude" / "skills" / "alpha" / "SKILL.md").exists()
    manifest = json.loads((tmp_path / ".claude" / "skills" / "MANIFEST.json").read_text())
    assert "alpha" in manifest and "alpha" in result


def test_sync_removes_stale(tmp_path):
    make_skill(tmp_path, "alpha")
    sync_skills.sync(tmp_path)
    stale = tmp_path / ".claude" / "skills" / "ghost"
    stale.mkdir(parents=True)
    (stale / "SKILL.md").write_text("rogue", encoding="utf-8")
    sync_skills.sync(tmp_path)
    assert not stale.exists()


def test_hash_dir_sort_is_case_stable(tmp_path):
    # Files whose names reorder under case folding: on Windows a Path sort is
    # case-insensitive ('references.md' < 'SKILL.md'), but a normalized
    # relative-path string sort is case-sensitive ('SKILL.md' < 'references.md',
    # since 'S'==0x53 < 'r'==0x72). The digest must follow the OS-stable string
    # order so a manifest generated on Windows verifies on the Linux cloud VM.
    d = tmp_path / "skills" / "curated" / "casey"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("skill body", encoding="utf-8")
    (d / "references.md").write_text("reference body", encoding="utf-8")

    # Inline reference implementation: iterate files sorted by the normalized
    # posix relative-path string (case-sensitive), hashing relpath + bytes.
    h = hashlib.sha256()
    for f in sorted(
        (p for p in d.rglob("*") if p.is_file()),
        key=lambda p: p.relative_to(d).as_posix(),
    ):
        h.update(f.relative_to(d).as_posix().encode())
        h.update(f.read_bytes())
    expected = h.hexdigest()

    assert sync_skills._hash_dir(d) == expected


def test_check_detects_drift(tmp_path):
    make_skill(tmp_path, "alpha")
    sync_skills.sync(tmp_path)
    assert sync_skills.check(tmp_path) == []
    (tmp_path / ".claude" / "skills" / "alpha" / "SKILL.md").write_text("tampered", encoding="utf-8")
    problems = sync_skills.check(tmp_path)
    assert problems and "alpha" in problems[0]


def test_render_codex_writes_catalog(tmp_path):
    make_skill(tmp_path, "alpha")
    make_skill(tmp_path, "beta")
    sync_skills.sync(tmp_path)
    catalog = tmp_path / ".codex" / "skills-catalog.md"
    assert catalog.exists()
    text = catalog.read_text(encoding="utf-8")
    assert "alpha" in text
    assert "beta" in text


def test_render_codex_is_deterministic(tmp_path):
    make_skill(tmp_path, "alpha")
    make_skill(tmp_path, "beta")
    sync_skills.sync(tmp_path)
    catalog = tmp_path / ".codex" / "skills-catalog.md"
    first = catalog.read_text(encoding="utf-8")
    sync_skills.sync(tmp_path)
    second = catalog.read_text(encoding="utf-8")
    assert first == second


def test_codex_catalog_drift_detected(tmp_path):
    make_skill(tmp_path, "alpha")
    sync_skills.sync(tmp_path)
    assert sync_skills.check(tmp_path) == []
    catalog = tmp_path / ".codex" / "skills-catalog.md"
    catalog.write_text("tampered", encoding="utf-8")
    problems = sync_skills.check(tmp_path)
    assert problems and any("codex" in p.lower() or "skills-catalog" in p for p in problems)


def test_check_covers_codex_catalog_drift(tmp_path):
    # Exercises the exact CLI invocation the pre-commit hook runs:
    # `python scripts/sync_skills.py --check` from the repo root.
    make_skill(tmp_path, "alpha")
    subprocess.run(
        [sys.executable, str(SYNC_SCRIPT)],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )
    clean = subprocess.run(
        [sys.executable, str(SYNC_SCRIPT), "--check"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert clean.returncode == 0, clean.stdout + clean.stderr

    catalog = tmp_path / ".codex" / "skills-catalog.md"
    catalog.write_text("tampered", encoding="utf-8")

    tampered = subprocess.run(
        [sys.executable, str(SYNC_SCRIPT), "--check"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert tampered.returncode != 0, (
        "sync_skills.py --check must fail when .codex/skills-catalog.md drifts "
        "from the manifest, since the pre-commit hook relies on this exact "
        "invocation to block the commit"
    )
