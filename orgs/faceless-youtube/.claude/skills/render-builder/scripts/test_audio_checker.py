import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from audio_checker import check_audio, check_sentence_gaps, motion_spec_name

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


def test_authored_qa_is_reported_and_unresolved_anchor_warns():
    qa = {"source": "unified",
          "authored_by_kind": {"sfx": 2, "pause": 0, "music": 1, "dry": 0},
          "resolved_by_kind": {"sfx": 1, "pause": 0, "music": 1, "dry": 0},
          "unresolved_by_kind": {"sfx": 1, "pause": 0, "music": 0, "dry": 0}}
    r = check_audio(_spec(qa=qa), SHOTS, LN, MT)
    assert r["ok"] is False and any("audio anchor unresolved: sfx=1" in w for w in r["warnings"]), r
    assert r["measured"]["authored_vs_resolved"] == qa, r


def test_legacy_audio_without_authored_qa_stays_compatible():
    r = check_audio(_spec(), SHOTS, LN, MT)
    assert r["ok"] is True and "authored_vs_resolved" not in r["measured"], r


# --- R11: sentence-gap verifier -----------------------------------------------
# Measures the REAL acoustic silence at every sentence boundary in the SPLICED VO and warns on any
# boundary below target - tol. Uses a synthetic wav (speech / silence / speech) written stdlib-only;
# decode needs ffmpeg (skip cleanly without it, matching the splice-continuity tests' style).

def _write_speech_wav(path, spans, total=4.0, sr=16000):
    """16-bit mono wav: 220Hz 'speech' everywhere except near-silence in each (from, to) span."""
    import math, struct, wave
    n = int(total * sr)
    frames = bytearray()
    for i in range(n):
        t = i / sr
        amp = 0.0002 if any(a <= t < b for a, b in spans) else 0.3 * math.sin(2 * math.pi * 220 * t)
        frames += struct.pack("<h", int(amp * 32767))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(bytes(frames))


def _ffmpeg_missing():
    import shutil
    return not shutil.which("ffmpeg")


def test_sentence_gap_verifier_passes_when_gaps_meet_target():
    if _ffmpeg_missing():
        print("  (skipped test_sentence_gap_verifier_passes_when_gaps_meet_target: ffmpeg not on PATH)"); return
    import tempfile, os
    d = tempfile.mkdtemp()
    vo = os.path.join(d, "vo.breath.wav")
    _write_speech_wav(vo, [(1.0, 1.7), (2.8, 3.3)])        # 0.70s and 0.50s real pauses
    bounds = [{"final_word": "one.", "final_s": 0.6, "next_word": "Two", "next_s": 1.65, "target_s": 0.65},
              {"final_word": "two.", "final_s": 2.4, "next_word": "End", "next_s": 3.25, "target_s": 0.45}]
    r = check_sentence_gaps(vo, bounds)
    assert r["ok"] is True and r["warnings"] == [], r
    assert r["measured"]["boundaries"] == 2 and r["measured"]["below"] == 0, r


def test_sentence_gap_verifier_flags_short_boundary_with_timestamp():
    if _ffmpeg_missing():
        print("  (skipped test_sentence_gap_verifier_flags_short_boundary_with_timestamp: ffmpeg not on PATH)"); return
    import tempfile, os
    d = tempfile.mkdtemp()
    vo = os.path.join(d, "vo.breath.wav")
    _write_speech_wav(vo, [(1.0, 1.2)])                    # only 0.20s of silence — RUSHED boundary
    bounds = [{"final_word": "one.", "final_s": 0.6, "next_word": "Two", "next_s": 1.15, "target_s": 0.65}]
    r = check_sentence_gaps(vo, bounds)
    assert r["ok"] is False and len(r["warnings"]) == 1, r
    w = r["warnings"][0]
    assert "SENTENCE-GAP short" in w and "'one.'" in w, w
    assert "@ 0.60s" in w, w                               # boundary timestamp reported
    assert r["measured"]["below"] == 1, r
    assert r["worst"]["shortfall_s"] > 0.3, r


def test_sentence_gap_verifier_skips_cleanly_without_inputs():
    r = check_sentence_gaps(None, [])
    assert r["ok"] is True and r["warnings"] == [], r
    r2 = check_sentence_gaps("does-not-exist.mp3", [{"final_s": 0, "next_s": 1, "target_s": 0.65}])
    assert r2["ok"] is True and r2["measured"].get("vo") == "missing", r2


def test_check_audio_wires_sentence_gap_verifier():
    if _ffmpeg_missing():
        print("  (skipped test_check_audio_wires_sentence_gap_verifier: ffmpeg not on PATH)"); return
    import tempfile, os
    d = tempfile.mkdtemp()
    vo = os.path.join(d, "vo.breath.wav")
    _write_speech_wav(vo, [(1.0, 1.15)])                   # under-target pause
    bounds = [{"final_word": "one.", "final_s": 0.6, "next_word": "Two", "next_s": 1.1, "target_s": 0.65}]
    r = check_audio(_spec(), SHOTS, LN, MT, spliced_vo_path=vo, sentence_bounds=bounds)
    assert r["ok"] is False and any("SENTENCE-GAP" in w for w in r["warnings"]), r
    assert r["measured"]["sentence_gaps"]["below"] == 1, r
    # absent inputs -> unchanged behaviour (no sentence_gaps key)
    r2 = check_audio(_spec(), SHOTS, LN, MT)
    assert r2["ok"] is True and "sentence_gaps" not in r2["measured"], r2


# --------------------------------------------------------------------------- #
# FIX 8 (audit follow-up): --preview must read the preview-parked spec build_motion wrote
# (<piece>.preview.motion.json), mirroring build_motion's own --preview-parked naming, instead of
# always reading the shippable final's spec.
# --------------------------------------------------------------------------- #
def test_motion_spec_name_reads_final_by_default():
    assert motion_spec_name("long-form", False) == "long-form.motion.json"


def test_motion_spec_name_reads_preview_spec_when_preview_flag_set():
    assert motion_spec_name("long-form", True) == "long-form.preview.motion.json"


# --------------------------------------------------------------------------- #
# LOW (audit follow-up): the printed report must state its own provenance — whether --preview was
# set and which spec file backed it — so a pasted report can be trusted as final-vs-preview
# evidence. This does not touch tolerance or exit-code logic (asserted unchanged below too).
# --------------------------------------------------------------------------- #
def _build_video_dir(preview):
    import json
    import os
    import tempfile
    d = tempfile.mkdtemp()
    motion_dir = os.path.join(d, "assets", "motion")
    os.makedirs(motion_dir)
    vo_name = "vo.breath.wav"
    _write_speech_wav(os.path.join(d, "assets", vo_name), [(1.0, 1.7)])
    spec = {"sentenceBoundaries": [{"final_word": "one.", "final_s": 0.6, "next_word": "Two",
                                    "next_s": 1.65, "target_s": 0.65}],
            "audio": vo_name}
    name = "long-form.preview.motion.json" if preview else "long-form.motion.json"
    with open(os.path.join(motion_dir, name), "w", encoding="utf-8") as f:
        json.dump(spec, f)
    return d, os.path.join(motion_dir, name)


def _run_main_capturing(args):
    """Runs `main()` with `check_sentence_gaps` stubbed to a fixed clean-pass result, so this
    exercises the banner/provenance printing on every machine regardless of whether ffmpeg is on
    PATH — the actual acoustic measurement is already covered (and ffmpeg-gated) by the tests
    above; this one only needs main() to reach its print statements."""
    import contextlib
    import io
    import sys
    import audio_checker

    old_argv = sys.argv
    old_fn = audio_checker.check_sentence_gaps
    sys.argv = ["audio_checker.py"] + args
    audio_checker.check_sentence_gaps = lambda audio, bounds, tol_s=0.10: {
        "ok": True, "warnings": [],
        "rows": [{"final_s": 0.6, "final_word": "one.", "next_word": "Two",
                  "measured_gap_s": 1.0, "target_s": 0.65}],
        "measured": {"boundaries": 1, "below": 0, "mean_gap_s": 1.0, "min_gap_s": 1.0},
    }
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            try:
                audio_checker.main()
                code = 0
            except SystemExit as e:
                code = e.code
    finally:
        sys.argv = old_argv
        audio_checker.check_sentence_gaps = old_fn
    return code, buf.getvalue()


def test_main_banner_states_preview_and_spec_path():
    d, spec_path = _build_video_dir(preview=True)
    code, out = _run_main_capturing([d, "--preview"])
    assert "[PREVIEW]" in out, out
    assert spec_path in out, out
    assert code == 0, (code, out)


def test_main_banner_final_run_has_no_preview_tag_but_states_spec():
    d, spec_path = _build_video_dir(preview=False)
    code, out = _run_main_capturing([d])
    assert "[PREVIEW]" not in out, out
    assert spec_path in out, out
    assert code == 0, (code, out)


print("running")
test_clean_render_passes(); test_missing_sfx_warns(); test_missing_music_warns()
test_loudness_off_target_warns(); test_true_peak_over_warns(); test_loudnorm_soft_failed_warns()
test_base_db_out_of_band_warns()
test_authored_qa_is_reported_and_unresolved_anchor_warns()
test_legacy_audio_without_authored_qa_stays_compatible()
test_sentence_gap_verifier_passes_when_gaps_meet_target()
test_sentence_gap_verifier_flags_short_boundary_with_timestamp()
test_sentence_gap_verifier_skips_cleanly_without_inputs()
test_check_audio_wires_sentence_gap_verifier()
test_motion_spec_name_reads_final_by_default()
test_motion_spec_name_reads_preview_spec_when_preview_flag_set()
test_main_banner_states_preview_and_spec_path()
test_main_banner_final_run_has_no_preview_tag_but_states_spec()
print("PASS")
