import shutil
import subprocess
import sys
from pathlib import Path

from scripts.sync_skills import check, sync

REPO_ROOT = Path(__file__).parent.parent
SYNC_SCRIPT_RELATIVE = Path("scripts/sync_skills.py")


def _seed(tmp_path):
    (tmp_path / "skills" / "curated" / "demo-skill").mkdir(parents=True)
    (tmp_path / "skills" / "curated" / "demo-skill" / "SKILL.md").write_text(
        "s", encoding="utf-8"
    )
    (tmp_path / "kit").mkdir()
    (tmp_path / "kit" / "spin-up.md").write_text(
        "---\nname: spin-up\ndescription: Start safely\nwhen: always\naudience: all\n"
        "read_only: false\nbudget_bytes: 20\n---\nb",
        encoding="utf-8",
    )


def test_sync_projects_kit_to_both_mirrors_with_namespace(tmp_path):
    _seed(tmp_path)
    manifest = sync(tmp_path)

    assert "kit:spin-up" in manifest
    for mirror in (".claude/kb-kit", ".agents/kb-kit"):
        assert (tmp_path / mirror / "spin-up.md").read_text(encoding="utf-8").endswith("b")
    assert not (tmp_path / ".claude" / "kb-kit" / ".rendered").exists()
    for audience in ("all", "claude", "codex"):
        assert (tmp_path / "kit" / ".rendered" / f"{audience}.md").is_file()


def test_check_flags_kit_drift(tmp_path):
    _seed(tmp_path)
    sync(tmp_path)
    (tmp_path / ".claude" / "kb-kit" / "spin-up.md").write_text(
        "tampered", encoding="utf-8"
    )

    assert any("kit:spin-up" in problem for problem in check(tmp_path))


def test_sync_ignores_kit_directories(tmp_path):
    _seed(tmp_path)
    (tmp_path / "kit" / "reference").mkdir()

    manifest = sync(tmp_path)
    assert "kit:reference" not in manifest
    assert not (tmp_path / ".claude" / "kb-kit" / "reference").exists()


def test_skills_only_repos_unaffected(tmp_path):
    skill = tmp_path / "skills" / "curated" / "demo-skill"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("s", encoding="utf-8")

    assert not any(name.startswith("kit:") for name in sync(tmp_path))
    assert check(tmp_path) == []


def test_check_flags_deleted_kit_block_before_sync_prunes_projection(tmp_path):
    _seed(tmp_path)
    sync(tmp_path)
    (tmp_path / "kit" / "spin-up.md").unlink()

    assert any("spin-up" in problem for problem in check(tmp_path))
    sync(tmp_path)
    for mirror in (".claude/kb-kit", ".agents/kb-kit"):
        assert not (tmp_path / mirror / "spin-up.md").exists()


def test_check_flags_rogue_unmanifested_kit_file(tmp_path):
    _seed(tmp_path)
    sync(tmp_path)
    (tmp_path / ".claude/kb-kit" / "rogue.md").write_text("rogue", encoding="utf-8")

    assert any(
        ".claude/kb-kit/rogue.md: unmanifested" in problem
        for problem in check(tmp_path)
    )


def test_skill_and_kit_with_same_name_have_distinct_manifest_keys(tmp_path):
    _seed(tmp_path)
    skill = tmp_path / "skills/curated/spin-up"
    skill.mkdir()
    (skill / "SKILL.md").write_text("skill", encoding="utf-8")

    manifest = sync(tmp_path)
    assert {"spin-up", "kit:spin-up"} <= manifest.keys()
    assert check(tmp_path) == []


def test_check_flags_stale_render(tmp_path):
    _seed(tmp_path)
    sync(tmp_path)
    (tmp_path / "kit/.rendered/all.md").write_bytes(b"stale")

    assert any(
        "kit/.rendered/all.md: rendered artifact does not match source" in problem
        for problem in check(tmp_path)
    )


def test_sync_prunes_projections_when_kit_is_deleted(tmp_path):
    _seed(tmp_path)
    sync(tmp_path)
    shutil.rmtree(tmp_path / "kit")

    assert any("stale mirror remains" in problem for problem in check(tmp_path))
    sync(tmp_path)
    assert not (tmp_path / ".claude/kb-kit").exists()
    assert not (tmp_path / ".agents/kb-kit").exists()


def _seed_script_form_repo(tmp_path):
    """Seed a tmp repo that can run scripts/sync_skills.py in SCRIPT form.

    Script-form invocation (``python scripts/sync_skills.py``, the form used
    by .githooks/pre-commit and the nightly cadence) resolves the repo root
    from ``scripts/sync_skills.py``'s own location, so the fixture needs a
    real ``scripts/sync_skills.py`` + ``scripts/kit/`` copy under the tmp
    repo -- not just the module importable from the real checkout.
    """
    repo = tmp_path / "repo"
    (repo / "scripts").mkdir(parents=True)
    shutil.copytree(
        REPO_ROOT / "scripts" / "kit",
        repo / "scripts" / "kit",
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    shutil.copy2(REPO_ROOT / SYNC_SCRIPT_RELATIVE, repo / SYNC_SCRIPT_RELATIVE)
    _seed(repo)
    return repo


def test_check_script_form_pins_hook_invocation(tmp_path):
    """Pins the .githooks/pre-commit invocation shape: ``python
    scripts/sync_skills.py --check`` run as a script (not ``-m``), from a
    clean synced repo, must exit 0 with no traceback -- the live defect this
    fix addresses crashed with ModuleNotFoundError in exactly this form."""
    repo = _seed_script_form_repo(tmp_path)
    sync(repo)

    result = subprocess.run(
        [sys.executable, str(SYNC_SCRIPT_RELATIVE), "--check"],
        cwd=repo,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Traceback" not in result.stderr
    assert "ModuleNotFoundError" not in result.stderr


def test_check_kit_frontmatter_error_reports_drift_not_traceback(tmp_path):
    repo = _seed_script_form_repo(tmp_path)
    sync(repo)
    (repo / "kit" / "spin-up.md").write_text("not frontmatter at all", encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(SYNC_SCRIPT_RELATIVE), "--check"],
        cwd=repo,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "Traceback" not in result.stderr
    assert "DRIFT" in result.stdout
    assert "frontmatter must start with ---" in result.stdout
