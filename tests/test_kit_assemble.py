import pytest
import subprocess
from pathlib import Path
from types import SimpleNamespace
from scripts.kit.assemble import (
    parse_block, select_blocks, render, assemble, check_read_only, KitBudgetError,
    KitFrontmatterError,
)

def _write_block(dir, name, *, when="always", audience="all", read_only=False,
                 budget=1000, body="rule text"):
    p = dir / f"{name}.md"
    p.write_text(
        f"---\nname: {name}\ndescription: d-{name}\nwhen: {when}\n"
        f"audience: {audience}\nread_only: {str(read_only).lower()}\n"
        f"budget_bytes: {budget}\n---\n{body}\n", encoding="utf-8")
    return p

def test_parse_block_roundtrips_fields(tmp_path):
    b = parse_block(_write_block(tmp_path, "spin-up", read_only=True))
    assert (b.name, b.read_only, b.budget_bytes) == ("spin-up", True, 1000)
    assert b.description == "d-spin-up"


def test_parse_block_uses_yaml_for_comments_quotes_and_booleans(tmp_path):
    p = tmp_path / "quoted.md"
    p.write_text(
        "---\nname: quoted\ndescription: \"quoted: description\" # a comment\n"
        "when: always\naudience: all\nread_only: true\nbudget_bytes: 100\n---\nbody\n",
        encoding="utf-8",
    )
    block = parse_block(p)
    assert block.description == "quoted: description"
    assert block.read_only is True

def test_budget_overflow_is_an_error_not_truncation(tmp_path):
    p = _write_block(tmp_path, "big", budget=10, body="x" * 50)
    with pytest.raises(KitBudgetError):
        parse_block(p)

def test_missing_field_is_frontmatter_error(tmp_path):
    p = tmp_path / "bad.md"
    p.write_text("---\nname: bad\n---\nbody\n", encoding="utf-8")
    with pytest.raises(KitFrontmatterError):
        parse_block(p)

def test_select_routes_by_when_and_audience(tmp_path):
    blocks = [parse_block(_write_block(tmp_path, "a", when="always")),
              parse_block(_write_block(tmp_path, "b", when="task:eval, task:release")),
              parse_block(_write_block(tmp_path, "c", audience="codex"))]
    picked = select_blocks(blocks, audience="claude", tags=set())
    assert [b.name for b in picked] == ["a"]
    picked = select_blocks(blocks, audience="claude", tags={"task:eval"})
    assert [b.name for b in picked] == ["a", "b"]
    picked = select_blocks(blocks, audience="claude", tags={"task:release"})
    assert [b.name for b in picked] == ["a", "b"]

def test_render_l1_index_lists_every_description_and_special_headings(tmp_path):
    blocks = [parse_block(_write_block(tmp_path, "north-star")),
              parse_block(_write_block(tmp_path, "invariants")),
              parse_block(_write_block(tmp_path, "spin-up"))]
    out = render(blocks, audience="all")
    assert "## North star" in out and "## Invariants" in out
    assert "## Kit: spin-up" in out
    for b in blocks:
        assert b.description in out   # L1 index complete even if body unselected
        assert f"- {b.name}: {b.description}" in out
    assert "rule text\n\n## Invariants" in out

def test_assemble_writes_rendered_artifact(tmp_path, monkeypatch):
    kit = tmp_path / "kit"; kit.mkdir()
    _write_block(kit, "north-star"); _write_block(kit, "spin-up")
    p = assemble(tmp_path, "all")
    assert p == tmp_path / "kit" / ".rendered" / "all.md"
    assert "## North star" in p.read_text(encoding="utf-8")

def test_assemble_keeps_all_l1_descriptions_but_routes_l2_bodies(tmp_path):
    kit = tmp_path / "kit"; kit.mkdir()
    _write_block(kit, "shared", body="shared body")
    _write_block(kit, "codex-only", audience="codex", body="codex body")
    out = assemble(tmp_path, "claude").read_text(encoding="utf-8")
    assert "d-codex-only" in out
    assert "shared body" in out
    assert "codex body" not in out

def test_check_read_only_labels_differences_and_absent_blocks(tmp_path, monkeypatch):
    kit = tmp_path / "kit"; kit.mkdir()
    block_path = _write_block(kit, "locked", read_only=True)

    monkeypatch.setattr(
        "scripts.kit.assemble.subprocess.run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=block_path.read_bytes()),
    )
    assert check_read_only(tmp_path) == []

    monkeypatch.setattr(
        "scripts.kit.assemble.subprocess.run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=b"older version"),
    )
    assert check_read_only(tmp_path) == ["differs: kit/locked.md"]

    monkeypatch.setattr(
        "scripts.kit.assemble.subprocess.run",
        lambda *args, **kwargs: SimpleNamespace(returncode=128, stdout=b""),
    )
    assert check_read_only(tmp_path) == ["absent-from-main: kit/locked.md"]


def _git(repo, *args):
    return subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


def test_check_read_only_normalizes_crlf_and_pins_absent_from_main(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.name", "kit-test")
    _git(repo, "config", "user.email", "kit-test@example.invalid")
    kit = repo / "kit"
    kit.mkdir()
    locked = kit / "locked.md"
    locked.write_bytes(
        b"---\nname: locked\ndescription: locked block\nwhen: always\naudience: all\n"
        b"read_only: true\nbudget_bytes: 100\n---\nrule text\n"
    )
    _git(repo, "add", "kit/locked.md")
    _git(repo, "commit", "-qm", "seed locked block")
    _git(repo, "checkout", "--", "kit/locked.md")

    locked.write_bytes(locked.read_bytes().replace(b"\n", b"\r\n"))
    assert check_read_only(repo, "HEAD") == []

    _write_block(kit, "new-locked", read_only=True)
    assert check_read_only(repo, "HEAD") == ["absent-from-main: kit/new-locked.md"]

    locked.write_bytes(locked.read_bytes().replace(b"rule text", b"changed rule"))
    assert check_read_only(repo, "HEAD") == [
        "differs: kit/locked.md",
        "absent-from-main: kit/new-locked.md",
    ]
