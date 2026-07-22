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


def make_directory_symlink_or_skip(link, target):
    try:
        link.symlink_to(target, target_is_directory=True)
    except (NotImplementedError, OSError) as error:
        pytest.skip(f"directory symlinks are unavailable: {error}")


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


@pytest.mark.parametrize("mirror", MIRRORS)
def test_sync_replaces_expected_skill_file_with_directory(tmp_path, mirror):
    make_skill(tmp_path, "alpha")
    sync_skills.sync(tmp_path)
    destination = tmp_path / mirror / "alpha"
    shutil.rmtree(destination)
    destination.write_text("wrong type", encoding="utf-8")

    assert any("not a real directory" in problem for problem in sync_skills.check(tmp_path))
    sync_skills.sync(tmp_path)

    assert destination.is_dir()
    assert (destination / "SKILL.md").read_bytes() == (
        tmp_path / "skills/curated/alpha/SKILL.md"
    ).read_bytes()


@pytest.mark.parametrize("mirror", MIRRORS)
def test_sync_removes_rogue_file_from_mirror_root(tmp_path, mirror):
    make_skill(tmp_path, "alpha")
    sync_skills.sync(tmp_path)
    rogue = tmp_path / mirror / "rogue.txt"
    rogue.write_text("rogue", encoding="utf-8")

    problems = sync_skills.check(tmp_path)
    assert any(
        mirror.as_posix() in problem and "unmanifested entry" in problem
        for problem in problems
    )

    sync_skills.sync(tmp_path)
    assert not rogue.exists()


def test_sync_removes_legacy_codex_outputs_but_preserves_config(tmp_path):
    make_skill(tmp_path, "alpha")
    codex = tmp_path / ".codex"
    codex.mkdir()
    legacy = [codex / "MANIFEST.json", codex / "skills-catalog.md"]
    for path in legacy:
        path.write_text("obsolete", encoding="utf-8")
    config = codex / "config.toml"
    config.write_text("[features]\n", encoding="utf-8")

    problems = sync_skills.check(tmp_path)
    assert sum("legacy generated output remains" in problem for problem in problems) == 2

    sync_skills.sync(tmp_path)
    assert all(not path.exists() for path in legacy)
    assert config.read_text(encoding="utf-8") == "[features]\n"


def test_sync_rejects_linked_source_root(tmp_path):
    external = tmp_path / "external-curated"
    (external / "alpha").mkdir(parents=True)
    (external / "alpha/SKILL.md").write_text("external", encoding="utf-8")
    (tmp_path / "skills").mkdir()
    source = tmp_path / "skills/curated"
    make_directory_symlink_or_skip(source, external)

    problems = sync_skills.check(tmp_path)
    assert any("unsafe or unreadable source" in problem for problem in problems)
    with pytest.raises(ValueError, match="link or reparse point"):
        sync_skills.sync(tmp_path)


@pytest.mark.parametrize("mirror", MIRRORS)
def test_sync_heals_linked_mirror_root_without_touching_target(tmp_path, mirror):
    make_skill(tmp_path, "alpha")
    sync_skills.sync(tmp_path)
    mirror_root = tmp_path / mirror
    shutil.rmtree(mirror_root)
    external = tmp_path / f"external-{mirror.parent.name}"
    external.mkdir()
    sentinel = external / "sentinel.txt"
    sentinel.write_text("keep", encoding="utf-8")
    make_directory_symlink_or_skip(mirror_root, external)

    problems = sync_skills.check(tmp_path)
    assert any("mirror root is missing or not a real directory" in problem for problem in problems)

    sync_skills.sync(tmp_path)
    assert not mirror_root.is_symlink()
    assert (mirror_root / "alpha/SKILL.md").is_file()
    assert sentinel.read_text(encoding="utf-8") == "keep"


def test_sync_rejects_linked_managed_ancestor_before_legacy_cleanup(tmp_path):
    make_skill(tmp_path, "alpha")
    external = tmp_path / "external-codex"
    external.mkdir()
    legacy = external / "MANIFEST.json"
    legacy.write_text("keep", encoding="utf-8")
    make_directory_symlink_or_skip(tmp_path / ".codex", external)

    problems = sync_skills.check(tmp_path)
    assert any("managed path contains a link or reparse point" in problem for problem in problems)
    with pytest.raises(ValueError, match="managed path contains a link or reparse point"):
        sync_skills.sync(tmp_path)
    assert legacy.read_text(encoding="utf-8") == "keep"


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
