import datetime
import shutil
from pathlib import Path

import pytest
import new_project

REPO = Path(__file__).parent.parent


def make_repo(tmp_path):
    shutil.copytree(REPO / "templates", tmp_path / "templates")
    (tmp_path / "_index.md").write_text(
        "# kb\n\n## Projects\n<!-- projects:start -->\n<!-- projects:end -->\n",
        encoding="utf-8")
    return tmp_path


def test_create_scaffolds_everything(tmp_path):
    repo = make_repo(tmp_path)
    p = new_project.create(repo, "demo", today=datetime.date(2026, 7, 15))
    for f in ("_index.md", "STATE.md", "contract.md", "HEARTBEAT.md", "CLAUDE.md"):
        assert (p / f).exists()
    for d in ("raw", "wiki", "output", "workflows", "scripts"):
        assert (p / d).is_dir()
    assert "demo" in (p / "STATE.md").read_text(encoding="utf-8")
    assert "2026-07-15" in (p / "STATE.md").read_text(encoding="utf-8")


def test_create_scaffolds_project_router(tmp_path):
    repo = make_repo(tmp_path)
    p = new_project.create(repo, "demo", today=datetime.date(2026, 7, 15))
    claude_md = (p / "CLAUDE.md").read_text(encoding="utf-8")
    assert "{{name}}" not in claude_md
    assert "demo" in claude_md
    assert "workflows/*.md" in claude_md
    assert "projects: [demo]" in claude_md


def test_create_registers_in_master_index(tmp_path):
    repo = make_repo(tmp_path)
    new_project.create(repo, "demo")
    idx = (repo / "_index.md").read_text(encoding="utf-8")
    assert "- [demo](orgs/demo/_index.md)" in idx


def test_create_refuses_existing(tmp_path):
    repo = make_repo(tmp_path)
    new_project.create(repo, "demo")
    with pytest.raises(FileExistsError):
        new_project.create(repo, "demo")
