"""Prose-contract test for task 4.3: routines/roles/*.md exist and declare a model
tier + a read/write scope line. Mirrors the style of tests/test_new_project.py —
these are prompt templates, not executable code, so we assert on their content."""

from pathlib import Path

REPO = Path(__file__).parent.parent
ROLES_DIR = REPO / "routines" / "roles"

ROLE_FILES = {
    "scout.md": "Haiku",
    "manager.md": "Opus",
    "worker.md": "Sonnet",
    "inspector.md": "Opus",
}


def test_role_templates_present_and_scoped():
    for filename, expected_tier in ROLE_FILES.items():
        path = ROLES_DIR / filename
        assert path.exists(), f"missing role template: {path}"
        text = path.read_text(encoding="utf-8")

        # declares a model tier
        assert "Model tier:" in text, f"{filename} missing a 'Model tier:' line"
        assert expected_tier in text, f"{filename} does not name {expected_tier} as its tier"

        # declares a read/write scope line
        assert "Scope:" in text, f"{filename} missing a 'Scope:' line"


def test_scout_is_read_only_and_evidence_scoped():
    text = (ROLES_DIR / "scout.md").read_text(encoding="utf-8")
    assert "read-only" in text
    assert "## Evidence" in text


def test_manager_sets_work_orders_and_card_fields():
    text = (ROLES_DIR / "manager.md").read_text(encoding="utf-8")
    assert "action" in text and "target" in text and "risk-tier" in text
    assert "## Work order" in text


def test_worker_executes_on_agent_branch():
    text = (ROLES_DIR / "worker.md").read_text(encoding="utf-8")
    assert "agent branch" in text
    assert "Sonnet" in text or "Codex" in text


def test_inspector_references_rubric_and_fresh_context():
    text = (ROLES_DIR / "inspector.md").read_text(encoding="utf-8")
    assert "fresh context" in text.lower()
    assert "skills/curated/inspector" in text
