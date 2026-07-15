import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from music_forge import collect_files

CFG = {"dur_s": [15, 600]}
def _f(dur=90.0, rms=-18.0):
    return {"duration": dur, "rms_db": rms}

def test_collect_keeps_normal_track():
    feats = {"/x/Good.mp3": _f()}
    out = collect_files(CFG, feats)
    assert [c["name"] for c in out] == ["Good"] and "quality" in out[0], out

def test_collect_drops_near_silent():
    feats = {"/x/Silent.mp3": _f(rms=-60.0)}
    assert collect_files(CFG, feats) == []

def test_collect_drops_out_of_band_duration():
    feats = {"/x/Tiny.mp3": _f(dur=5.0)}
    assert collect_files(CFG, feats) == []

import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parents[2] / "sfx-forge" / "scripts"))
import rank as _rankmod

def test_collect_output_is_rankable():
    feats = {"/x/A.mp3": _f(rms=-14.0), "/x/B.mp3": _f(rms=-20.0)}
    cands = collect_files(CFG, feats)
    ranked = _rankmod.rank(cands, scorer=lambda c: None)   # must NOT KeyError on c["id"]
    assert {c["name"] for c in ranked} == {"A", "B"}, ranked

print("running")
test_collect_keeps_normal_track(); test_collect_drops_near_silent(); test_collect_drops_out_of_band_duration()
test_collect_output_is_rankable()
print("PASS")

from music_forge import assemble_pools

def test_assemble_pools_maps_and_credits():
    picks = {"sneaky": ["Sneaky Snitch.mp3", "Scheming Weasel faster.mp3"]}
    sources = {"sneaky": {
        "Sneaky Snitch.mp3": {"title": "Sneaky Snitch", "artist": "Kevin MacLeod (incompetech.com)",
                              "license": "CC-BY", "url": "https://incompetech.com/"},
        "Scheming Weasel faster.mp3": {"title": "Scheming Weasel", "artist": "Kevin MacLeod (incompetech.com)",
                                       "license": "CC-BY", "url": "https://incompetech.com/"}}}
    pools, entries, attribs = assemble_pools(picks, sources)
    assert pools == {"sneaky": ["sneaky-1", "sneaky-2"]}, pools
    assert entries["sneaky-1"]["source_file"] == "Sneaky Snitch.mp3"
    assert entries["sneaky-2"]["license"] == "CC-BY"
    assert any("sneaky-1" in a and "Kevin MacLeod" in a for a in attribs), attribs

print("running assemble"); test_assemble_pools_maps_and_credits(); print("PASS assemble")

from music_forge import resolve_picks

def test_resolve_picks_by_stem_and_excludes_unresolved():
    idx = {"sneaky": {"Sneaky Snitch": "Sneaky Snitch.mp3", "Covert Affair": "Covert Affair.wav"}}
    resolved, unresolved = resolve_picks({"sneaky": ["Sneaky Snitch", "Covert Affair.wav", "Nope"]}, idx)
    assert resolved == {"sneaky": ["Sneaky Snitch.mp3", "Covert Affair.wav"]}, resolved   # stem + filename both resolve
    assert unresolved == [("sneaky", "Nope")], unresolved                                  # unknown excluded from pools

print("running resolve"); test_resolve_picks_by_stem_and_excludes_unresolved(); print("PASS resolve")
