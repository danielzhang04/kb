"""Unit tests for the unified audio-plan splitter (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from audio_plan import split_plan


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


def main():
    for fn in [test_splits_by_kind_into_existing_shapes, test_empty_plan_yields_empty_lists,
               test_sfx_fade_out_s_carried_through_split]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
