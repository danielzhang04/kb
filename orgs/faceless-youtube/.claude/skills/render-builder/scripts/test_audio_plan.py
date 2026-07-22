"""Unit tests for the unified audio-plan splitter (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from audio_plan import build_audio_qa, split_plan


def test_splits_by_kind_into_existing_shapes():
    plan = {"cues": [
        {"kind": "sfx", "anchor": "the whole thing", "role": "cash", "gain_db": -6, "sync": "element"},
        {"kind": "pause", "anchor": "never came home", "pause_s": 0.6, "in_pause": True},
        {"kind": "music", "from_anchor": "It all started with", "mood": "sneaky", "level_db": 7},
        {"kind": "dry", "from_anchor": "people started to die", "to_anchor": "made it home"},
    ]}
    a_cues, m_cues, m_dry = split_plan(plan)
    assert a_cues == [
        {"anchor": "the whole thing", "role": "cash", "gain_db": -6, "sync": "element"},
        {"anchor": "never came home", "pause_s": 0.6, "in_pause": True},
    ], a_cues
    assert m_cues == [{"from_anchor": "It all started with", "mood": "sneaky", "level_db": 7}], m_cues
    assert m_dry == [{"from_anchor": "people started to die", "to_anchor": "made it home"}], m_dry


def test_empty_plan_yields_empty_lists():
    assert split_plan({"cues": []}) == ([], [], [])


def test_sfx_fade_out_s_carried_through_split():
    # P16: fade_out_s is an sfx-cue field -> must survive split_plan into the audio_cues shape
    plan = {"cues": [{"kind": "sfx", "anchor": "a b c d", "role": "applause", "fade_out_s": 1.2}]}
    a_cues, _, _ = split_plan(plan)
    assert a_cues == [{"anchor": "a b c d", "role": "applause", "fade_out_s": 1.2}], a_cues


def test_audio_qa_joins_four_kinds_and_excludes_default_bed_from_counts():
    qa = build_audio_qa(
        authored_audio=[{"anchor": "a", "role": "cash"},
                        {"anchor": "b", "pause_s": 0.6}],
        authored_music=[], authored_dry=[{"from_anchor": "c"}],
        resolved_audio=[{"anchor": "a", "role": "cash", "at_s": 1.0},
                        {"anchor": "b", "pause_s": 0.6, "at_s": 2.0}],
        resolved_music=[], resolved_dry=[{"at_s": 4.0, "to_s": 7.0}],
        audio_spec={"events": [{"sfx": "cash-1", "at_s": 1.0}],
                    "music_states": [{"track": "default", "at_s": 0.0, "dur_s": 10.0}],
                    "sfx_missing": 0, "music_missing": 0, "sfx_tail_warnings": []},
        cue_gaps=[{"at_s": 2.0, "dur_s": 0.6, "source": "cue"}],
        piece_end_s=10.0, source="unified")
    assert qa["authored_by_kind"] == {"sfx": 1, "pause": 1, "music": 0, "dry": 1}, qa
    assert qa["resolved_by_kind"] == qa["authored_by_kind"], qa
    assert qa["unresolved_by_kind"] == {"sfx": 0, "pause": 0, "music": 0, "dry": 0}, qa
    assert qa["resolved_pause_s"] == 0.6 and qa["resolved_dry_s"] == 3.0, qa
    assert qa["music_present_s"] == 10.0 and qa["default_bed"] is True, qa


def test_audio_qa_reports_unresolved_missing_and_union_not_double_counted():
    qa = build_audio_qa(
        authored_audio=[{"anchor": "a", "role": "cash"}, {"anchor": "b", "role": "boom"}],
        authored_music=[{"from_anchor": "c", "mood": "sneaky"}],
        authored_dry=[{"from_anchor": "d"}, {"from_anchor": "e"}],
        resolved_audio=[{"anchor": "a", "role": "cash", "at_s": 1.0}],
        resolved_music=[], resolved_dry=[{"at_s": 4.0, "to_s": 8.0},
                                         {"at_s": 6.0, "to_s": 9.0}],
        audio_spec={"music_states": [], "events": [], "sfx_missing": 1, "music_missing": 1,
                    "sfx_tail_warnings": [{"at_s": 1.0}]},
        cue_gaps=[], piece_end_s=10.0, source="unified")
    assert qa["unresolved_by_kind"] == {"sfx": 1, "pause": 0, "music": 1, "dry": 0}, qa
    assert qa["resolved_dry_s"] == 5.0, qa
    assert qa["silent_drops"] == {"sfx_missing": 1, "music_missing": 1}, qa
    assert qa["sfx_tail_overshoots"] == 1 and qa["default_bed"] is False, qa


def main():
    for fn in [test_splits_by_kind_into_existing_shapes, test_empty_plan_yields_empty_lists,
               test_sfx_fade_out_s_carried_through_split,
               test_audio_qa_joins_four_kinds_and_excludes_default_bed_from_counts,
               test_audio_qa_reports_unresolved_missing_and_union_not_double_counted]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
