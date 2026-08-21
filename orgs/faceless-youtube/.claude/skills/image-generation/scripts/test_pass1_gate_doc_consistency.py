import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
VPW = (ROOT / ".claude/skills/visual-prompt-writer/SKILL.md").read_text(encoding="utf-8")
IG = (ROOT / ".claude/skills/image-generation/SKILL.md").read_text(encoding="utf-8")
SCHEMA = (ROOT / ".claude/skills/visual-prompt-writer/references/shots-schema.md").read_text(encoding="utf-8")
GRAMMAR = (ROOT / "channels/the-second-take/visual-kit/visual-grammar.md").read_text(encoding="utf-8")
TRANSPORT_SPEAKERS = (IG, SCHEMA, GRAMMAR)


def test_generation_procedure_keeps_verified_asset_gate():
    assert "verified" in IG.lower()
    assert "review" in IG.lower()
    assert "build_review_artifact.py --video $VIDEO_DIR" in IG
    assert "still_prompt" in IG and "effective stage" in IG and "Palette basis:" in IG
    assert "advisory warm/cool and complementary-pair shares" in IG
    assert "rather than targeting any hue or share" in IG


def test_figure_staging_doctrine_has_one_channel_home():
    assert "Occupancy follows who acts in the sentence" in GRAMMAR
    assert "Occupancy follows who acts in the sentence" not in IG


def test_vpw_points_to_schema_instead_of_repeating_transport_law():
    assert "shots-schema.md" in VPW


def test_legacy_cast_transport_paraphrases_are_absent():
    patterns = (
        r"from " + "`" + r"cast" + "`",
        r"authoritative" + " figure",
        "`" + r"cast" + "` names",
        r"cast refs? (are|as) .*seed",
        r"cast (drives|order|ORDER)",
        r"derive .* " + r"from .*cast",
    )
    for pattern in patterns:
        assert all(re.search(pattern, text, flags=re.I) is None for text in TRANSPORT_SPEAKERS), pattern
