#!/usr/bin/env python3
"""Plain-assert tests for build_audio (V1). Run: py -3 test_build_audio.py"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from build_audio import build_audio_spec, sfx_events, register_audio

TOK2 = {"sfx_pools": {"pop": ["pop-1", "pop-2", "pop-3"], "whoosh": ["whoosh-1", "whoosh-2"],
                      "boom": ["boom-1"], "tick": ["tick-1", "tick-2"], "thud": ["thud-1"]},
        "sfx_gain_db": {"pop": -8, "whoosh": -7, "boom": -6, "tick": -12, "thud": -10},
        "sfx_per_min_story_max": 20}


def _shot(id, start, dur=3.0, entrance="cut", stage_role=None, overlays=None, stage=None):
    return {"id": id, "start_s": start, "duration_s": dur, "entrance": entrance, "stage": stage,
            "stage_role": stage_role, "overlays": overlays or []}


def test_sfx_no_structural_autofire():
    # Structural sounds (whoosh/boom/pop) are NO LONGER auto-fired (2026-07-12) — the audio-director
    # authors them as cues. A scene base, an enumeration delta, and a text-less shot all emit nothing.
    shots = [_shot("L01", 0), _shot("L02", 3, stage_role="base"),
             _shot("L03", 6, entrance="whip"),
             _shot("L04", 9, stage_role="delta", stage="p"),
             _shot("L05", 12), _shot("L06", 15)]
    assert sfx_events(shots, TOK2) == [], sfx_events(shots, TOK2)


def test_multi_gap_dip_uses_shifted_positions():
    # a pause gap at 5.0 (0.9s) then one at 20.0 (0.7s): the 2nd dip must shift by the 1st gap's 0.9s
    # (breathed timeline), not fire at the raw 20.0; both gaps dip.
    gaps = [{"at_s": 5.0, "dur_s": 0.9},
            {"at_s": 20.0, "dur_s": 0.7}]
    spec = build_audio_spec([], TOK2, words=[], has_vo=False, breath_gaps=gaps, audio_dir=None)
    dips = sorted(spec["dips"], key=lambda d: d["at_s"])
    assert len(dips) == 2, dips                 # chapter breath dips too, not only number-reveal
    assert dips[0]["at_s"] == 5.0, dips         # first gap unshifted
    assert dips[1]["at_s"] == 20.9, dips        # second gap shifted by the first gap's 0.9s


def test_sfx_only_tick_from_overlay():
    # No structural auto-fire — a chapter-boundary shot emits NOTHING on its own; only a text overlay ticks.
    shots = [_shot("L01", 0, overlays=[{"type": "text", "at_s": 2.0}])]
    ev = sfx_events(shots, TOK2)
    got = [(e["sfx"].split("/")[-1].rsplit("-", 1)[0], round(e["at_s"], 1)) for e in ev]
    assert got == [("tick", 2.0)], got


def test_sfx_density_cap_thins_tick_chatter():
    # 60 text ticks (chatter) over ~6s; the story cap (20/min) thins them
    shots = [_shot(f"T{i}", i * 0.1, overlays=[{"type": "text", "at_s": i * 0.1}]) for i in range(60)]
    ticks = [e for e in sfx_events(shots, TOK2) if "tick" in e["sfx"]]
    assert len(ticks) <= 3, len(ticks)         # chatter capped


def test_spec_has_lane_not_bed():
    spec = build_audio_spec(_shots(20.0), _MTOK, words=[], has_vo=False)
    assert "bed" not in spec and "bed_db_under_vo" not in spec and "duck_spans" not in spec
    assert isinstance(spec["music_states"], list) and len(spec["music_states"]) == 1   # default lane
    assert spec["music_missing"] == 0


REG_TOK = {"thin_extra_db": 8}


def test_register_audio_returns_empty():
    # Register is now AUTHORED (a `dry` span + simply not placing SFX), not derived from a structural tag.
    shots = [{"id": "L2", "start_s": 3.0, "duration_s": 4.0}]
    assert register_audio(shots, REG_TOK) == ([], [])


def test_number_reveal_gap_gets_a_dip():
    spec = build_audio_spec(
        shots=[{"id": "L1", "start_s": 0, "duration_s": 2}],
        tokens={"dip_db": -40}, words=[], has_vo=True,
        breath_gaps=[{"shot_id": "L1", "at_s": 5.0, "dur_s": 0.9}])
    assert spec["dips"] == [{"at_s": 5.0, "depth_db": -40, "dur_s": 0.9}], spec["dips"]


def test_no_breath_gaps_means_no_dip():
    spec = build_audio_spec(shots=[{"id": "L1", "start_s": 0}],
                            tokens={}, words=[], has_vo=True, breath_gaps=None)
    assert spec["dips"] == [], spec["dips"]   # the dip needs the gap; no gap -> no dip


def test_sfx_withhold_filter_drops_events_in_span():
    # the withhold filter (when a span is passed) still drops events inside it — tested via a tick overlay
    shots = [_shot("L1", 3.5, overlays=[{"type": "text", "at_s": 3.5}])]
    assert sfx_events(shots, TOK2, withhold=[{"at_s": 3.0, "dur_s": 4.0}]) == []       # tick inside span dropped
    assert len(sfx_events(shots, TOK2, withhold=[{"at_s": 10.0, "dur_s": 1.0}])) == 1  # outside -> kept


def test_sfx_event_with_missing_file_is_dropped():
    # render defense: an emitted event whose sfx file is absent under audio_dir is dropped + counted,
    # so the render never references a missing file (the latent bug on card-rich real videos).
    import tempfile, os
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "audio", "sfx"), exist_ok=True)
    open(os.path.join(d, "audio", "sfx", "whoosh-1.mp3"), "wb").close()   # only whoosh-1 exists
    # authored cues: a whoosh (present file) + a boom (absent file)
    cue_events = [{"at_s": 0.0, "role": "whoosh"}, {"at_s": 1.0, "role": "boom"}]
    spec = build_audio_spec([], TOK2, words=[], has_vo=False, cue_events=cue_events, audio_dir=d)
    files = [e["sfx"] for e in spec["events"]]
    assert any("whoosh-1" in f for f in files), files        # present -> kept
    assert not any("boom" in f for f in files), files        # absent -> dropped
    assert spec.get("sfx_missing", 0) >= 1


def test_audio_dir_none_keeps_all_events_backcompat():
    # audio_dir omitted -> no filtering, safe-when-absent
    spec = build_audio_spec([], TOK2, words=[], has_vo=False, cue_events=[{"at_s": 0.0, "role": "whoosh"}])
    assert len(spec["events"]) == 1 and spec.get("sfx_missing", 0) == 0


def test_consistent_sfx_do_not_rotate():
    # whoosh is in consistent_sfx -> every whoosh uses the SAME variant (whoosh-1), no rotation
    from build_audio import cue_sfx_events
    tok = {**TOK2, "consistent_sfx": ["whoosh", "pop"]}
    ev = cue_sfx_events([{"at_s": 0.0, "role": "whoosh"}, {"at_s": 5.0, "role": "whoosh"},
                         {"at_s": 10.0, "role": "pop"}, {"at_s": 11.0, "role": "pop"}], tok)
    whoosh = [e["sfx"] for e in ev if "whoosh" in e["sfx"]]
    pops = [e["sfx"] for e in ev if "pop" in e["sfx"]]
    assert whoosh == ["audio/sfx/whoosh-1.mp3", "audio/sfx/whoosh-1.mp3"], whoosh
    assert pops == ["audio/sfx/pop-1.mp3", "audio/sfx/pop-1.mp3"], pops


def test_cue_events_merge_and_inherit_fullstop():
    # 2b: authored cue role-events merge into the event stream and inherit the full-stop
    cue_events = [{"at_s": 8.0, "role": "boom", "gain_db": -5},      # standalone -> kept
                  {"at_s": 5.3, "role": "cash"}]                     # inside a gap [5.0,5.9] -> withheld
    gaps = [{"at_s": 5.0, "dur_s": 0.9}]
    spec = build_audio_spec([], TOK2, words=[], has_vo=False, breath_gaps=gaps,
                            cue_events=cue_events, audio_dir=None)
    at = {round(e["at_s"], 2): e for e in spec["events"]}
    assert at[8.0]["sfx"] == "audio/sfx/boom-1.mp3" and at[8.0]["gain_db"] == -5, at   # cue role+gain
    assert 5.3 not in at, at                                          # withheld by the full-stop


# --- Phase 3B: build_music_lane ---------------------------------------------
from build_audio import build_music_lane

_MTOK = {"music_pools": {"casual-bed": ["casual-bed-1"], "sneaky": ["sneaky-1", "sneaky-2"]},
         "music_present_db": 9, "music_default_mood": "casual-bed",
         "track_switch_gap_s": 0.8, "music_fade_s": {"in": 0.4, "out": 0.6}}


def _shots(end_s):
    # one narration shot spanning [0, end_s) — the piece length build_music_lane derives from shots[-1]
    return [{"id": "L1", "start_s": 0.0, "duration_s": end_s}]


def test_lane_backcompat_default_full_length():
    ms, miss = build_music_lane([], [], _shots(30.0), _MTOK)
    assert miss == 0 and len(ms) == 1
    seg = ms[0]
    assert seg["track"] == "audio/beds/casual-bed-1.mp3"
    assert seg["at_s"] == 0.0 and seg["dur_s"] == 30.0 and seg["base_db"] == 9


def test_lane_cue_starts_become_segment_boundaries():
    cues = [{"mood": "casual-bed", "at_s": 0.0}, {"mood": "sneaky", "at_s": 12.0}]
    ms, _ = build_music_lane(cues, [], _shots(30.0), _MTOK)
    assert [round(m["at_s"], 1) for m in ms] == [0.0, 12.0]
    assert ms[0]["track"].endswith("casual-bed-1.mp3") and ms[1]["track"].endswith("sneaky-1.mp3")


def test_lane_track_switch_inserts_gap_between_different_moods():
    cues = [{"mood": "casual-bed", "at_s": 0.0}, {"mood": "sneaky", "at_s": 12.0}]
    ms, _ = build_music_lane(cues, [], _shots(30.0), _MTOK)
    # first segment ends track_switch_gap_s (0.8) before the second begins -> a silence gap
    assert abs((ms[1]["at_s"] - (ms[0]["at_s"] + ms[0]["dur_s"])) - 0.8) < 1e-6


def test_lane_same_mood_neighbours_coalesce_no_gap():
    cues = [{"mood": "casual-bed", "at_s": 0.0}, {"mood": "casual-bed", "at_s": 12.0}]
    ms, _ = build_music_lane(cues, [], _shots(30.0), _MTOK)
    assert len(ms) == 1 and ms[0]["dur_s"] == 30.0   # merged, no gap


def test_lane_dry_span_carves_a_hole():
    ms, _ = build_music_lane([{"mood": "casual-bed", "at_s": 0.0}],
                             [{"at_s": 10.0, "to_s": 15.0}], _shots(30.0), _MTOK)
    assert len(ms) == 2
    assert abs(ms[0]["dur_s"] - 10.0) < 1e-6 and abs(ms[1]["at_s"] - 15.0) < 1e-6


def test_dry_abutting_switch_is_continuous_silence():
    # sneaky runs to 15; a dry hole [10,14]; casual-bed switches in at 15. The sneaky remnant [14,15]
    # (a <3s sliver between the hole and a different-mood switch) is absorbed -> silence 10..15, then casual-bed.
    cues = [{"mood": "sneaky", "at_s": 0.0}, {"mood": "casual-bed", "at_s": 15.0}]
    ms, _ = build_music_lane(cues, [{"at_s": 10.0, "to_s": 14.0}], _shots(30.0), _MTOK)
    sneaky = [m for m in ms if "sneaky" in m["track"]]
    assert len(sneaky) == 1, ms                                       # no remnant after the hole
    assert abs(sneaky[0]["at_s"] + sneaky[0]["dur_s"] - 10.0) < 1e-6, ms   # sneaky ends at the hole start
    assert any("casual-bed" in m["track"] for m in ms), ms            # the new track still plays


def test_lane_pool_rotation_is_deterministic():
    cues = [{"mood": "sneaky", "at_s": 0.0}, {"mood": "casual-bed", "at_s": 8.0},
            {"mood": "sneaky", "at_s": 16.0}]
    a, _ = build_music_lane(cues, [], _shots(24.0), _MTOK)
    b, _ = build_music_lane(cues, [], _shots(24.0), _MTOK)
    sneaky = [m["track"] for m in a if "sneaky" in m["track"]]
    assert sneaky == ["audio/beds/sneaky-1.mp3", "audio/beds/sneaky-2.mp3"]   # rotation by occurrence
    assert [m["track"] for m in a] == [m["track"] for m in b]                 # deterministic


def test_lane_empty_pool_drops_segment_and_counts():
    tok = {**_MTOK, "music_pools": {"casual-bed": []}}
    ms, miss = build_music_lane([{"mood": "casual-bed", "at_s": 0.0}], [], _shots(20.0), tok)
    assert ms == [] and miss == 1


def test_lane_level_db_override():
    ms, _ = build_music_lane([{"mood": "casual-bed", "at_s": 0.0, "level_db": 6}], [], _shots(20.0), _MTOK)
    assert ms[0]["base_db"] == 6


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn(); print(f"ok {fn.__name__}")
    print(f"\n{len(fns)} passed")
