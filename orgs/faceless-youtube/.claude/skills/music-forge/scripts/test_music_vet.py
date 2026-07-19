import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from music_vet import vet_music

def base(**kw):
    b = {"duration": 90.0, "rms_db": -18.0}
    b.update(kw); return b

def test_normal_track_passes():
    v = vet_music(base(), 15, 600)
    assert v["ok"] is True and v["reasons"] == [], v

def test_too_short_rejected():
    v = vet_music(base(duration=8.0), 15, 600)
    assert v["ok"] is False and any("duration" in r for r in v["reasons"]), v

def test_too_long_rejected():
    v = vet_music(base(duration=900.0), 15, 600)
    assert v["ok"] is False and any("duration" in r for r in v["reasons"]), v

def test_near_silent_rejected():
    v = vet_music(base(rms_db=-50.0), 15, 600)
    assert v["ok"] is False and any("silent" in r for r in v["reasons"]), v

def test_real_music_with_ending_and_zero_peak_passes():
    # a real song: peaks at ~0 dBFS, its tail decays to silence — must NOT be rejected (the old loop/clip bug)
    v = vet_music(base(duration=205.0, rms_db=-22.0), 15, 600)
    assert v["ok"] is True, v

def test_quality_tracks_loudness():
    assert vet_music(base(rms_db=-14.0), 15, 600)["quality"] > vet_music(base(rms_db=-30.0), 15, 600)["quality"]

print("running")
test_normal_track_passes(); test_too_short_rejected(); test_too_long_rejected()
test_near_silent_rejected(); test_real_music_with_ending_and_zero_peak_passes(); test_quality_tracks_loudness()
print("PASS")
