import sys
from pathlib import Path
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(REPO / "atlas"))
import pytest, cards

@pytest.fixture
def kb_fixture(tmp_path):
    """Minimal kb repo built with the REAL card schema (no hand-guessed frontmatter)."""
    for q in ("inbox", "working", "done", "approvals"):
        (tmp_path / "queue" / q).mkdir(parents=True)
    (tmp_path / "dashboards").mkdir()
    (tmp_path / "dashboards" / "executive.md").write_text("# Executive\nAll quiet.\n", encoding="utf-8")
    (tmp_path / "orgs" / "demo").mkdir(parents=True)
    (tmp_path / "orgs" / "demo" / "STATE.md").write_text("# demo — STATE\n## Now\ntesting\n", encoding="utf-8")
    c1 = cards.new_card("demo", "do a thing", "wiki/", "T2", body="## Work order\nx\n")
    cards.save(c1, tmp_path / "queue")                      # lands in inbox
    c2 = cards.new_card("demo", "another thing", "output/", "T1", body="## Work order\ny\n")
    p2 = cards.save(c2, tmp_path / "queue")
    c2_parsed = cards.parse(p2)
    cards.claim(c2_parsed, "atlas-test-agent")               # transition to "working" requires an owner
    cards.transition(c2_parsed, "working", tmp_path / "queue")
    return tmp_path
