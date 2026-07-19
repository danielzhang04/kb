import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from audio_checker import check_audio

MT = {"lufs": -14.5, "true_peak_max_dbfs": -1.0, "lra": 4.0}
LN = {"audio_lufs": -14.3, "audio_true_peak": -1.1}


def _spec(**kw):
    base = {"music_states": [{"track": "audio/beds/casual-bed-1.mp3", "at_s": 0.0, "dur_s": 12.0,
                              "base_db": 7, "fade_in_s": 0.5, "fade_out_s": 0.9},
                             {"track": "audio/beds/casual-bed-1.mp3", "at_s": 16.0, "dur_s": 4.0,
                              "base_db": 7, "fade_in_s": 0.5, "fade_out_s": 0.9}],
            "events": [{"sfx": "audio/sfx/boom-1.mp3", "at_s": 5.0}],
            "dips": [{"at_s": 10.0, "depth_db": -40, "dur_s": 0.9}],
            "sfx_missing": 0, "music_missing": 0}
    base.update(kw); return base


SHOTS = [{"start_s": 0.0, "duration_s": 20.0}]


def test_clean_render_passes():
    r = check_audio(_spec(), SHOTS, LN, MT)
    assert r["ok"] is True and r["warnings"] == [], r
    assert r["measured"]["lufs"] == -14.3


def test_missing_sfx_warns():
    r = check_audio(_spec(sfx_missing=2), SHOTS, LN, MT)
    assert r["ok"] is False and any("sfx_missing" in w for w in r["warnings"])


def test_missing_music_warns():
    r = check_audio(_spec(music_missing=1), SHOTS, LN, MT)
    assert r["ok"] is False and any("music_missing" in w for w in r["warnings"])


def test_loudness_off_target_warns():
    r = check_audio(_spec(), SHOTS, {"audio_lufs": -11.0, "audio_true_peak": -1.1}, MT)
    assert r["ok"] is False and any("LUFS" in w for w in r["warnings"])


def test_true_peak_over_warns():
    r = check_audio(_spec(), SHOTS, {"audio_lufs": -14.3, "audio_true_peak": -0.2}, MT)
    assert r["ok"] is False and any("true-peak" in w or "true_peak" in w for w in r["warnings"])


def test_loudnorm_soft_failed_warns():
    r = check_audio(_spec(), SHOTS, {}, MT)
    assert r["ok"] is False and any("loudnorm" in w.lower() for w in r["warnings"])


def test_base_db_out_of_band_warns():
    bad = _spec(music_states=[{"track": "audio/beds/casual-bed-1.mp3", "at_s": 0.0, "dur_s": 10.0,
                               "base_db": 40, "fade_in_s": 0.5, "fade_out_s": 0.9}])
    r = check_audio(bad, SHOTS, LN, MT)
    assert r["ok"] is False and any("base_db" in w for w in r["warnings"])


print("running")
test_clean_render_passes(); test_missing_sfx_warns(); test_missing_music_warns()
test_loudness_off_target_warns(); test_true_peak_over_warns(); test_loudnorm_soft_failed_warns()
test_base_db_out_of_band_warns()
print("PASS")
