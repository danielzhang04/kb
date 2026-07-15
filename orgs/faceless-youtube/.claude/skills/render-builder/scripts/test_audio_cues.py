import sys; from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from audio_cues import resolve_cues, cue_pause_gaps, cue_role_events

WT = [["in", 0.0], ["1822", 0.3], ["eight", 5.0], ["million", 5.3], ["acres", 5.6],
      ["eight", 9.0], ["million", 9.3], ["gone", 12.0]]

def test_resolve_anchor_to_word_time():
    r = resolve_cues([{"anchor": "eight million acres", "role": "cash"}], WT)
    assert len(r) == 1 and abs(r[0]["at_s"] - 5.0) < 1e-6, r     # first occurrence of "eight ..."

def test_repeated_anchor_hits_successive_occurrence():
    r = resolve_cues([{"anchor": "eight million", "role": "cash"},
                      {"anchor": "eight million", "role": "ding"}], WT)
    assert abs(r[0]["at_s"] - 5.0) < 1e-6 and abs(r[1]["at_s"] - 9.0) < 1e-6, r   # cursor advances

def test_unresolved_anchor_dropped():
    assert resolve_cues([{"anchor": "no such words here", "role": "cash"}], WT) == []

def test_cue_pause_gaps():
    r = resolve_cues([{"anchor": "eight million acres", "role": "cash", "pause_s": 0.5}], WT)
    assert cue_pause_gaps(r) == [{"at_s": 5.0, "dur_s": 0.5, "source": "cue"}], cue_pause_gaps(r)

def test_cue_role_event_lands_at_gap_end():
    r = resolve_cues([{"anchor": "eight million acres", "role": "cash", "pause_s": 0.5}], WT)
    gaps = cue_pause_gaps(r)                       # a 0.5s gap at 5.0
    ev = cue_role_events(r, gaps)
    # the cash lands at 5.0 + 0.5 (its own pause) = 5.5 = the gap end (after the silence)
    assert ev == [{"at_s": 5.5, "role": "cash"}], ev

def test_role_event_shifts_for_earlier_gap():
    r = resolve_cues([{"anchor": "gone", "role": "womp"}], WT)   # role only, no pause
    gaps = [{"at_s": 5.0, "dur_s": 0.5, "source": "cue"}]        # an earlier gap
    assert cue_role_events(r, gaps) == [{"at_s": 12.5, "role": "womp"}], cue_role_events(r, gaps)

def test_in_pause_role_lands_at_gap_start():
    # in_pause: an interrupt SFX (record scratch) fires at the START of its OWN gap (in the silence),
    # before the word drops — the opposite of the default gap-end (on-the-word) placement.
    r = resolve_cues([{"anchor": "eight million acres", "role": "record_scratch",
                       "pause_s": 0.6, "in_pause": True}], WT)
    gaps = cue_pause_gaps(r)                       # a 0.6s gap at 5.0; the word moves to 5.6
    assert cue_role_events(r, gaps) == [{"at_s": 5.0, "role": "record_scratch"}], cue_role_events(r, gaps)

def test_in_pause_still_shifts_for_earlier_gaps():
    # in_pause excludes only its OWN gap; an earlier gap still pushes it later
    r = resolve_cues([{"anchor": "gone", "role": "record_scratch", "pause_s": 0.4, "in_pause": True}], WT)
    gaps = [{"at_s": 5.0, "dur_s": 0.5, "source": "cue"}] + cue_pause_gaps(r)   # earlier 0.5 + own 0.4 at 12.0
    assert cue_role_events(r, gaps) == [{"at_s": 12.5, "role": "record_scratch"}], cue_role_events(r, gaps)

print("running"); test_resolve_anchor_to_word_time(); test_repeated_anchor_hits_successive_occurrence()
test_unresolved_anchor_dropped(); test_cue_pause_gaps(); test_cue_role_event_lands_at_gap_end()
test_role_event_shifts_for_earlier_gap(); test_in_pause_role_lands_at_gap_start()
test_in_pause_still_shifts_for_earlier_gaps(); print("PASS")
