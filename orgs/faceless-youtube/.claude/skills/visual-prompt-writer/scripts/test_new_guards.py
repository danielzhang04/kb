"""Focused generic authoring guards retained by the recut."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import lint_shots as L


def test_word_cap_keeps_l3_only():
    hard = []
    L.word_cap_check("lf", [("L01", "still_prompt", "a sign 'ONE TWO THREE FOUR FIVE'")], "", hard)
    assert hard and "cap 4" in hard[0]


def test_long_few_word_literal_has_no_deleted_character_cap():
    hard = []
    L.word_cap_check("lf", [("L01", "still_prompt", "a sign 'TRANS CONTINENTAL AIRLINES'")], "", hard)
    assert hard == []


def test_semantic_noop_delta_fails():
    hard = []
    L.delta_feasibility_check("lf", [("L02", {
        "stage_role": "delta", "changed_elements": ["+ tiny decorative label"],
    })], hard)
    assert hard and "no-op" in hard[0]


def test_material_delta_passes():
    hard = []
    L.delta_feasibility_check("lf", [("L02", {
        "stage_role": "delta", "changed_elements": ["+ cathedral rises"],
    })], hard)
    assert hard == []


def test_crowd_shape_is_closed():
    hard, soft = [], []
    L.figures_check("lf", [("L01", {"figures": {"crowd": "yes"}})], hard, soft)
    assert hard


def test_unknown_shot_class_is_advisory_on_legacy_schema():
    hard, soft = [], []
    L.shot_class_check("lf", [{"id": "L01", "shot_class": "new-class"}], hard, soft, strict=False)
    assert hard == [] and soft
