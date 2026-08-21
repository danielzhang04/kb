"""Focused regressions for the reconciled generic lint gates."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import lint_shots as L

FYT = Path(__file__).resolve().parents[4]
GRAMMAR = (FYT / "channels" / "the-second-take" / "visual-kit" /
           "visual-grammar.md").read_text(encoding="utf-8")
BIBLE = (FYT / "channels" / "the-second-take" / "visual-kit" /
         "style-bible.md").read_text(encoding="utf-8")
VPW = (FYT / ".claude" / "skills" / "visual-prompt-writer" /
       "SKILL.md").read_text(encoding="utf-8")
SCHEMA = (FYT / ".claude" / "skills" / "visual-prompt-writer" / "references" /
          "shots-schema.md").read_text(encoding="utf-8")
CRITICS = (FYT / ".claude" / "skills" / "visual-prompt-writer" / "references" /
           "critics.md").read_text(encoding="utf-8")
IG = (FYT / ".claude" / "skills" / "image-generation" /
      "SKILL.md").read_text(encoding="utf-8")

def _kit():
    td = tempfile.TemporaryDirectory()
    root = Path(td.name)
    vdir = root / "channels" / "x" / "videos" / "v"
    kit = root / "channels" / "x" / "visual-kit"
    vdir.mkdir(parents=True)
    kit.mkdir(parents=True)
    (kit / "style-bible.md").write_text(
        "# Bible\n\n**`global_prompt_suffix`** — empty; Forge dispatches neither.\n",
        encoding="utf-8")
    return td, vdir


def test_empty_or_absent_suffix_matches_style_bible_bytes():
    td, vdir = _kit()
    try:
        hard = []
        L.suffix_one_voice_check("", hard, vdir)
        L.suffix_one_voice_check(None, hard, vdir)
        assert hard == []
    finally:
        td.cleanup()


def test_suffix_mismatch_fails():
    td, vdir = _kit()
    try:
        hard = []
        L.suffix_one_voice_check("drift", hard, vdir)
        assert len(hard) == 1 and "does not match" in hard[0]
    finally:
        td.cleanup()


def test_kitless_suffix_is_pass_through():
    with tempfile.TemporaryDirectory() as td:
        hard = []
        L.suffix_one_voice_check("", hard, Path(td))
        assert hard == []


def test_unresolved_closed_world_token_fails():
    hard = []
    L.primitive_catalog_check("lf", [("L01", {"still_prompt": "`pose-missing`"})], set(), hard)
    assert hard and "do not resolve" in hard[0]


def test_vetoed_eyewear_words_are_not_unsupplied_text():
    prompt = "a captain wearing thin round wire spectacles, seated at a chart table"
    assert L.unsupplied_text_requests(prompt) == []


def test_unknown_figure_field_is_refused_by_closed_schema():
    hard, soft = [], []
    L.figures_check("lf", [("L01", {"figures": {"unexpected": True}})], hard, soft)
    assert hard and "unknown key" in hard[0]


def test_place_anchor_must_be_same_place():
    shots = [
        {"id": "L01", "place": "yard"},
        {"id": "L02", "place": "office", "place_anchor": "assets/scenes/L01.png"},
    ]
    hard = []
    L.place_anchor_same_place_check("lf", shots, hard)
    assert hard and "own place" in hard[0].lower()


def test_place_owner_is_an_exact_forced_choice():
    shots = [{"id": "L01", "place": "office", "source": "ai-gen",
              "place_owner": "MINISCRIBE", "owner_ambiguity": True,
              "still_prompt": "a sign 'MINISCRIBE'"}]
    hard = []
    L.place_owner_check("lf", shots, "", hard)
    assert hard and "exactly one" in hard[0].lower()


def test_variant_d_doctrine_owners_are_consistent():
    assert "Occupancy follows who acts in the sentence" in GRAMMAR
    assert "a clerk and customer exchanging a box" in GRAMMAR
    assert "a bounded group held beyond something" in GRAMMAR
    assert "Story bearer." not in GRAMMAR
    assert "an expression change is a legitimate delta" in GRAMMAR
    assert all(f"> {n}." in BIBLE for n in range(1, 7))
    assert "> 7." not in BIBLE
    assert "Who acts in this sentence" in BIBLE
    assert "story-named or story-referenced figure cast from the registry" in BIBLE
    assert "every role read at a glance" in BIBLE
    assert "wrong canonical\n>    outfit" in BIBLE
    assert "genuinely the mass" in BIBLE and "near zone empty" in BIBLE
    assert "> 5. **Staging interest.** Is this the most interesting *legitimate* staging" in BIBLE
    assert "every stage's world palette is committed" in BIBLE
    assert "dominant field derived from its light source and dominant material" in BIBLE
    assert "complements are valid when those facts create them" in BIBLE
    assert "palettes move freely " "per video" not in BIBLE
    assert "subject → acting participants → occupancy → shot class → cast tokens" in VPW
    assert "do not predeclare a closed stage list" in VPW
    assert "Author the shots first" in VPW and "schema's hold-camera criterion" in VPW
    assert "Palette basis:" in VPW and "drawable light/material facts" in VPW
    assert VPW.count("story-needed held state change") == 2
    assert VPW.count("non-empty hold_reason") == 2
    assert "confirm a progressive " "in-shot reveal" not in VPW
    assert "camera/set and primary subject can hold" in SCHEMA
    assert "exactly ONE visually\n  distinct, story-needed state change" in SCHEMA
    assert "Cap a chain at ≤3 deltas" in SCHEMA
    assert "newly unpacked PC" in SCHEMA and "computer–drive diagram" in SCHEMA
    assert "Semantic delta floor (HARD)" in SCHEMA
    assert "ask both directions" in CRITICS
    assert "a missed hold" in CRITICS and "a forced hold or\n> no-op" in CRITICS
    assert "Report findings, not\n> hold totals" in CRITICS
    assert "delta-materiality-calibration.json" in CRITICS
    assert "dominant palette axis repeated across distinct stages" in CRITICS
    assert "palette codes are not policed" in CRITICS
    for text in (SCHEMA, GRAMMAR, IG):
        assert "backticked" in text.lower()
        assert "descriptive" in text.lower() and "metadata" in text.lower()
    assert "Forge appends bible §2d from `figures.crowd`" in IG
    assert "never to re-decide whether VPW may author the stage" in IG
    assert "VPW has already admitted the stage by the hold-camera criterion" in IG
    assert "cast is " "authoritative" not in IG.lower()
