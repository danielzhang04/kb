"""Place, interaction, and lettering transport regressions retained by the recut."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import lint_shots as L


def test_place_key_is_kebab_case():
    hard = []
    L.place_key_check("lf", [("L01", {"place": "Bad Place"})], hard)
    assert hard


def test_place_anchor_rejects_delta():
    hard = []
    L.place_anchor_check("lf", [("L02", {
        "stage_role": "Delta", "place_anchor": "assets/scenes/L01.png"
    })], hard)
    assert hard and "delta" in hard[0].lower()


def test_interaction_requires_two_named_cast():
    hard = []
    L.interaction_cast_check(
        "lf", [("L01", {"still_prompt": "`alice` uses `handshake`"})],
        {"alice", "bob"}, {"handshake"}, hard)
    assert hard and "with 1 seeded figure" in hard[0]


def test_unresolved_interaction_is_closed_world():
    hard = []
    L.primitive_catalog_check(
        "lf", [("L01", {"still_prompt": "`alice` uses `unknown-clasp`"})],
        {"alice"}, hard)
    assert hard


def test_owner_ambiguity_must_be_boolean():
    hard = []
    L.bool_field_check("lf", [("L01", {"owner_ambiguity": "yes"})], "owner_ambiguity", hard)
    assert hard
