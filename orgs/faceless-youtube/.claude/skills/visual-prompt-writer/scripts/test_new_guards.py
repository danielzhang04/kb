"""Focused generic authoring guards retained by the recut."""
import json
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


def test_delta_materiality_calibration_is_pinned_evidence_not_a_lint_oracle():
    fixture = Path(__file__).resolve().parent.parent / "references" / \
        "delta-materiality-calibration.json"
    payload = json.loads(fixture.read_text(encoding="utf-8"))
    expected = "L02,L15,L37,L51,L70,L72,L76,L103,L110,L111,L119,L123,L136,L144,L146,L162,L169,L175,L184,L186,L206,L209,L218,L229,L242,L243".split(",")
    assert payload["source_commit"] == "f1c3b1aa"
    assert payload["source_path"] == "orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json"
    assert payload["decision_owner"] == "fresh-eyes critic (semantic judgment; lint remains lexical)"
    assert [case["id"] for case in payload["cases"]] == expected
    assert len(set(expected)) == len(expected) == 26
    keys = {"id", "stage", "stage_role", "vo_ref", "changed_elements", "still_prompt"}
    assert all(set(case) == keys for case in payload["cases"])
    lint_pattern = repr(L._NON_MATERIAL_DELTA)
    assert all(case["id"] not in lint_pattern and case["still_prompt"] not in lint_pattern
               for case in payload["cases"])


class TestOccupancyDiagnostics:
    def test_zero_human_run_reports_ids_duration_and_vo(self):
        shots = [
            {"id": "L01", "duration_s": 2, "vo_ref": "first anchor", "still_prompt": "empty room"},
            {"id": "L02", "duration_s": 3, "vo_ref": "second anchor", "still_prompt": "brass ledger"},
        ]
        soft = []
        L.occupancy_diagnostics("lf", shots, {"L01": "first words", "L02": "second words"}, set(), soft)
        assert "hard" not in L.occupancy_diagnostics.__code__.co_varnames[:5]
        assert len(soft) == 1
        assert "ids=L01,L02" in soft[0] and "duration=5s" in soft[0]
        assert "first anchor" in soft[0] and "second anchor" in soft[0]
        assert "first words | second words" in soft[0]

    def test_one_and_two_prompt_token_rows_report_assets_and_base(self):
        shots = [
            {"id": "L01", "still_prompt": "`alice` at the desk", "stage_role": "base"},
            {"id": "L02", "still_prompt": "`alice` with `bob`", "stage_role": "delta"},
        ]
        soft = []
        L.occupancy_diagnostics("lf", shots, {}, {"alice", "bob"}, soft)
        assert "id=L01; executable=alice; assets=ready; base_role=True" in soft[0]
        assert "id=L02; executable=alice,bob; assets=ready; base_role=False" in soft[1]

    def test_crowd_row_reports_vo_and_neighbours_from_metadata(self):
        shots = [
            {"id": "L01", "still_prompt": "empty room"},
            {"id": "L02", "still_prompt": "no spatial words", "figures": {"crowd": True}},
            {"id": "L03", "still_prompt": "brass ledger"},
        ]
        soft = []
        L.occupancy_diagnostics("lf", shots, {"L02": "middle narration"}, set(), soft)
        crowd = [row for row in soft if "occupancy crowd" in row]
        assert crowd == ["[lf] occupancy crowd: id=L02; vo='middle narration'; prev=L01; next=L03"]
