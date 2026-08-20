from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
VPW = (ROOT / ".claude/skills/visual-prompt-writer/SKILL.md").read_text(encoding="utf-8")
IG = (ROOT / ".claude/skills/image-generation/SKILL.md").read_text(encoding="utf-8")
GRAMMAR = (ROOT / "channels/the-second-take/visual-kit/visual-grammar.md").read_text(encoding="utf-8")


def test_generation_procedure_keeps_verified_asset_gate():
    assert "verified" in IG.lower()
    assert "review" in IG.lower()


def test_figure_staging_doctrine_has_one_channel_home():
    assert "story-bearing" in GRAMMAR
    assert "story-bearing" not in IG


def test_vpw_points_to_schema_instead_of_repeating_transport_law():
    assert "shots-schema.md" in VPW
