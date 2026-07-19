import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from fetch_incompetech import track_url, fetch_bucket

TMPL = "https://incompetech.com/music/royalty-free/mp3-royaltyfree/{name}.mp3"

def test_track_url_encodes_spaces():
    assert track_url("Sneaky Snitch", TMPL) == \
        "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Sneaky%20Snitch.mp3"

def test_fetch_bucket_saves_and_records(tmpdir=None):
    import tempfile
    out = Path(tempfile.mkdtemp())
    cfg = {"incompetech_seeds": ["Good Track", "Missing Track"]}
    def fake_dl(url, dest):
        if "Missing" in url:
            return False
        dest.write_bytes(b"ID3fake-mp3-bytes"); return True
    res = fetch_bucket("sneaky", cfg, out, download=fake_dl)
    assert res["saved"] == ["Good Track"] and res["failed"] == ["Missing Track"], res
    assert (out / "Good Track.mp3").exists()
    src = json.loads((out / "sources.json").read_text(encoding="utf-8"))
    assert src["Good Track.mp3"]["license"] == "CC-BY"
    assert src["Good Track.mp3"]["artist"] == "Kevin MacLeod (incompetech.com)"

print("running")
test_track_url_encodes_spaces(); test_fetch_bucket_saves_and_records()
print("PASS")
