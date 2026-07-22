import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import sync_skills

REPO_ROOT = Path(__file__).parent.parent
SYNC_SCRIPT = REPO_ROOT / "scripts" / "sync_skills.py"
MIRRORS = (Path(".claude/skills"), Path(".agents/skills"))


def make_skill(root, name, content="do things"):
    directory = root / "skills" / "curated" / name
    directory.mkdir(parents=True)
    (directory / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: Use for {name}.\n---\n{content}",
        encoding="utf-8",
    )


def test_sync_mirrors_curated_to_both_runtimes(tmp_path):
    make_skill(tmp_path, "alpha")
    result = sync_skills.sync(tmp_path)
    for mirror in MIRRORS:
        skill = tmp_path / mirror / "alpha" / "SKILL.md"
        assert skill.read_bytes() == (tmp_path / "skills/curated/alpha/SKILL.md").read_bytes()
        manifest = json.loads((tmp_path / mirror / "MANIFEST.json").read_text())
        assert manifest == result


@pytest.mark.parametrize("mirror", MIRRORS)
def test_sync_removes_stale_runtime_skill(tmp_path, mirror):
    make_skill(tmp_path, "alpha")
    sync_skills.sync(tmp_path)
    stale = tmp_path / mirror / "ghost"
    stale.mkdir(parents=True)
    (stale / "SKILL.md").write_text("rogue", encoding="utf-8")
    sync_skills.sync(tmp_path)
    assert not stale.exists()


def test_sync_propagates_source_update_and_deletion(tmp_path):
    make_skill(tmp_path, "alpha", "version one")
    make_skill(tmp_path, "beta")
    sync_skills.sync(tmp_path)

    source = tmp_path / "skills/curated/alpha/SKILL.md"
    source.write_text(source.read_text(encoding="utf-8") + "\nversion two", encoding="utf-8")
    shutil.rmtree(tmp_path / "skills/curated/beta")
    sync_skills.sync(tmp_path)

    for mirror in MIRRORS:
        assert (tmp_path / mirror / "alpha/SKILL.md").read_bytes() == source.read_bytes()
        assert not (tmp_path / mirror / "beta").exists()


def test_hash_dir_sort_is_case_stable(tmp_path):
    directory = tmp_path / "skills/curated/casey"
    directory.mkdir(parents=True)
    (directory / "SKILL.md").write_text("skill body", encoding="utf-8")
    (directory / "references.md").write_text("reference body", encoding="utf-8")

    digest = hashlib.sha256()
    for path in sorted(
        (item for item in directory.rglob("*") if item.is_file()),
        key=lambda item: item.relative_to(directory).as_posix(),
    ):
        relative = path.relative_to(directory).as_posix().encode("utf-8")
        content = path.read_bytes()
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    assert sync_skills._hash_dir(directory) == digest.hexdigest()


def test_hash_dir_frames_paths_and_contents(tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    (first / "a").write_text("bc", encoding="utf-8")
    (first / "d").write_text("", encoding="utf-8")
    (second / "a").write_text("b", encoding="utf-8")
    (second / "c").write_text("d", encoding="utf-8")

    assert sync_skills._hash_dir(first) != sync_skills._hash_dir(second)


def test_check_detects_unsynced_source_change(tmp_path):
    make_skill(tmp_path, "alpha")
    sync_skills.sync(tmp_path)
    (tmp_path / "skills/curated/alpha/SKILL.md").write_text("changed", encoding="utf-8")
    problems = sync_skills.check(tmp_path)
    assert any("manifest does not match skills/curated" in problem for problem in problems)


@pytest.mark.parametrize("mirror", MIRRORS)
def test_check_detects_runtime_drift(tmp_path, mirror):
    make_skill(tmp_path, "alpha")
    sync_skills.sync(tmp_path)
    (tmp_path / mirror / "alpha/SKILL.md").write_text("tampered", encoding="utf-8")
    problems = sync_skills.check(tmp_path)
    assert any(mirror.as_posix() in problem and "does not match source" in problem for problem in problems)


def test_cli_check_covers_both_runtime_mirrors(tmp_path):
    make_skill(tmp_path, "alpha")
    subprocess.run([sys.executable, str(SYNC_SCRIPT)], cwd=tmp_path, check=True)
    clean = subprocess.run(
        [sys.executable, str(SYNC_SCRIPT), "--check"], cwd=tmp_path, capture_output=True, text=True
    )
    assert clean.returncode == 0, clean.stdout + clean.stderr

    (tmp_path / ".agents/skills/alpha/SKILL.md").write_text("tampered", encoding="utf-8")
    tampered = subprocess.run(
        [sys.executable, str(SYNC_SCRIPT), "--check"], cwd=tmp_path, capture_output=True, text=True
    )
    assert tampered.returncode != 0
    assert ".agents/skills/alpha" in tampered.stdout


def test_precommit_rejects_partially_staged_curated_skill(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "scripts").mkdir()
    (repo / ".githooks").mkdir()
    shutil.copy2(SYNC_SCRIPT, repo / "scripts/sync_skills.py")
    shutil.copy2(REPO_ROOT / ".githooks/pre-commit", repo / ".githooks/pre-commit")
    make_skill(repo, "alpha", "version one")

    def git(*args, check=True):
        return subprocess.run(
            ["git", *args], cwd=repo, capture_output=True, text=True, check=check
        )

    git("init")
    git("config", "user.name", "Skill Sync Test")
    git("config", "user.email", "skill-sync@example.invalid")
    git("config", "commit.gpgsign", "false")
    subprocess.run([sys.executable, "scripts/sync_skills.py"], cwd=repo, check=True)
    git("add", ".")
    git("commit", "-m", "initial")
    git("config", "core.hooksPath", ".githooks")

    source = repo / "skills/curated/alpha/SKILL.md"
    source.write_text(source.read_text(encoding="utf-8") + "\nversion two", encoding="utf-8")
    git("add", "skills/curated/alpha/SKILL.md")
    source.write_text(source.read_text(encoding="utf-8") + "\nversion three", encoding="utf-8")

    committed = git("commit", "-m", "partial", check=False)
    assert committed.returncode != 0
    assert "unstaged content" in committed.stdout + committed.stderr
    assert "version two" not in (repo / ".agents/skills/alpha/SKILL.md").read_text(encoding="utf-8")
