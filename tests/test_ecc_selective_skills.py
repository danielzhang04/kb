from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
IMPORTED = REPO / "skills" / "imported"


def skill_text(name):
    return (IMPORTED / name / "SKILL.md").read_text(encoding="utf-8")


def test_selective_ecc_skills_are_provenanced_and_inert_by_default():
    for name in ("code-review", "security-review"):
        text = skill_text(name)
        assert f"name: {name}" in text
        assert "source: ecc@2.0.0/" in text
        assert "source-author: ECC contributors" in text
        assert "source-hash:" in text
        assert "imported: 2026-07-22" in text
        assert "provenance-tier: imported" in text

    combined = skill_text("code-review") + skill_text("security-review")
    for unsafe_default in (
        "gh pr review",
        "gh api",
        "npm audit",
        "npx ",
        "curl |",
        "--fix",
    ):
        assert unsafe_default not in combined


def test_code_review_separates_quality_from_merge_authority():
    text = skill_text("code-review")
    assert "technical merge readiness" in text
    assert "human approval" in text
    assert "A zero-finding review is valid" in text
    assert "Do not install or download" in text


def test_security_review_defers_to_kb_security_authority():
    text = skill_text("security-review")
    assert "governance/security-rules.md" in text
    assert "Do not open credential stores" in text
    assert "Authentication alone is not authorization" in text
    assert "A clean review with zero findings is valid" in text


def test_delivery_gate_points_to_promoted_growth_log():
    hook = (REPO / "scripts" / "hooks" / "delivery_gate.js").read_text(encoding="utf-8")
    assert "skills/curated/growth-log/SKILL.md" in hook
    assert "skills/imported/growth-log/SKILL.md" not in hook
