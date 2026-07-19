import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from forge import collect, build_audition_html

ROLE = {"dur_s": [0.15, 1.2], "clap_prompts": ["a whoosh"], "queries": ["whoosh"]}
RESULTS = [
    {"id": 1, "name": "good", "license": "http://creativecommons.org/publicdomain/zero/1.0/", "duration": 0.5, "preview_url": "u1", "tags": [], "username": "a"},
    {"id": 2, "name": "cc-by", "license": "http://creativecommons.org/licenses/by/4.0/", "duration": 0.5, "preview_url": "u2", "tags": [], "username": "b"},
]
_F = {"duration": 0.5, "peak_db": -3.0, "rms_db": -20.0, "lead_silence_s": 0.02, "trail_silence_s": 0.0}
FEATS = {1: _F, 2: dict(_F)}
NC = {"id": 3, "name": "nc", "license": "http://creativecommons.org/licenses/by-nc/4.0/", "duration": 0.5, "preview_url": "u3", "tags": [], "username": "c"}

def test_collect_keeps_cc0_and_ccby_drops_nc():
    cands = collect(ROLE, RESULTS + [NC], {**FEATS, 3: dict(_F)})
    assert [c["id"] for c in cands] == [1, 2]        # CC0 + CC-BY kept; id 3 CC-BY-NC dropped (T7)
    assert cands[0]["quality"] > 0

def test_audition_html_has_no_api_key_and_embeds_audio():
    html = build_audition_html({"whoosh": [{"id": 1, "name": "good", "license": "CC0",
            "duration": 0.5, "clap": 0.8, "quality": 0.7, "data_uri": "data:audio/mp3;base64,AAA",
            "freesound_url": "https://freesound.org/s/1/"}]})
    assert "data:audio/mp3;base64,AAA" in html and "SECRETKEY" not in html
    assert "freesound.org/s/1" in html

print("running"); test_collect_keeps_cc0_and_ccby_drops_nc(); test_audition_html_has_no_api_key_and_embeds_audio(); print("PASS")
