"""Element-SFX snaps to the nearest visual event within the window (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from build_audio import snap_element_sfx


def _shot(id, start, overlays=None):
    return {"id": id, "start_s": start, "duration_s": 3.0, "overlays": overlays or []}


def test_element_sfx_snaps_to_nearest_cut():
    shots = [_shot("A", 0.0), _shot("B", 5.0)]              # cuts at 0.0 and 5.0
    events = [{"at_s": 5.4, "role": "whoosh", "sync": "element"}]   # 0.4s after the cut
    out = snap_element_sfx(events, shots, window_s=0.7)
    assert out[0]["at_s"] == 5.0, out                      # snapped to the cut


def test_non_sync_event_is_untouched():
    shots = [_shot("A", 0.0), _shot("B", 5.0)]
    events = [{"at_s": 5.4, "role": "record_scratch"}]     # no sync -> word-time kept
    assert snap_element_sfx(events, shots, window_s=0.7)[0]["at_s"] == 5.4


def test_element_sfx_no_visual_in_window_stays():
    shots = [_shot("A", 0.0), _shot("B", 5.0)]
    events = [{"at_s": 3.0, "role": "cash", "sync": "element"}]   # nearest cut 2s away > window
    assert snap_element_sfx(events, shots, window_s=0.7)[0]["at_s"] == 3.0


def test_snaps_to_overlay_at_s():
    shots = [_shot("A", 0.0, overlays=[{"type": "text", "at_s": 4.0}])]
    events = [{"at_s": 4.3, "role": "cash", "sync": "element"}]
    assert snap_element_sfx(events, shots, window_s=0.7)[0]["at_s"] == 4.0


def main():
    for fn in [test_element_sfx_snaps_to_nearest_cut, test_non_sync_event_is_untouched,
               test_element_sfx_no_visual_in_window_stays, test_snaps_to_overlay_at_s]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
