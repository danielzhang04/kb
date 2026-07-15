import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from music_cues import resolve_music_cues

# [word, start_s] pairs (shifted timeline is fine — resolve is timeline-agnostic)
WT = [["In", 0.0], ["seventeen", 0.3], ["twenty", 0.6], ["John", 0.9], ["Law", 1.2],
      ["But", 5.0], ["the", 5.2], ["paper", 5.4], ["money", 5.6],
      ["When", 9.0], ["the", 9.2], ["people", 9.4], ["came", 9.6]]


def test_resolve_cue_times_and_level():
    cues = [{"from_anchor": "In seventeen twenty John", "mood": "casual-bed"},
            {"from_anchor": "But the paper money", "mood": "sneaky", "level_db": 6}]
    rc, _ = resolve_music_cues(cues, [], WT)
    assert rc[0] == {"mood": "casual-bed", "at_s": 0.0}
    assert rc[1] == {"mood": "sneaky", "at_s": 5.0, "level_db": 6}


def test_resolve_dry_span():
    _, rd = resolve_music_cues([], [{"from_anchor": "When the people came"}], WT)
    assert rd == [{"at_s": 9.0}]


def test_resolve_dry_span_with_to():
    _, rd = resolve_music_cues([], [{"from_anchor": "But the paper money", "to_anchor": "When the people came"}], WT)
    assert rd == [{"at_s": 5.0, "to_s": 9.0}]


def test_unresolved_cue_dropped():
    rc, _ = resolve_music_cues([{"from_anchor": "nope not here at all", "mood": "sneaky"}], [], WT)
    assert rc == []


print("running")
test_resolve_cue_times_and_level(); test_resolve_dry_span(); test_resolve_dry_span_with_to(); test_unresolved_cue_dropped()
print("PASS")
