import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from vet import vet_features

def feats(**kw):
    base = {"duration": 0.5, "peak_db": -3.0, "rms_db": -20.0, "lead_silence_s": 0.02, "trail_silence_s": 0.1}
    base.update(kw); return base

def test_clean_short_transient_passes():
    v = vet_features(feats(), 0.15, 1.2)
    assert v["ok"] is True and v["reasons"] == []

def test_too_long_rejected():
    v = vet_features(feats(duration=9.0), 0.15, 1.2)
    assert v["ok"] is False and any("duration" in r for r in v["reasons"])

def test_clipping_rejected():
    v = vet_features(feats(peak_db=0.0), 0.15, 1.2)
    assert v["ok"] is False and any("clip" in r for r in v["reasons"])

def test_near_silent_rejected():
    v = vet_features(feats(rms_db=-60.0), 0.15, 1.2)
    assert v["ok"] is False and any("silent" in r for r in v["reasons"])

def test_long_lead_silence_rejected():
    v = vet_features(feats(lead_silence_s=0.9), 0.15, 1.2)
    assert v["ok"] is False and any("lead" in r for r in v["reasons"])

print("running")
test_clean_short_transient_passes(); test_too_long_rejected(); test_clipping_rejected()
test_near_silent_rejected(); test_long_lead_silence_rejected(); print("PASS")
