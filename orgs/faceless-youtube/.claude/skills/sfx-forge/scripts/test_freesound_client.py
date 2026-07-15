import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from freesound_client import parse_search, is_cc0, search

FIX = json.loads((Path(__file__).parent / "fixtures" / "search_whoosh.json").read_text())

def test_parse_maps_fields_and_drops_no_preview():
    rows = parse_search(FIX)
    assert len(rows) == 2
    r = rows[0]
    assert r["id"] == 388037 and r["duration"] == 0.83
    assert r["preview_url"].endswith("388037_x-hq.mp3")

def test_is_cc0_only_true_for_zero():
    rows = parse_search(FIX)
    assert is_cc0(rows[0]) is True
    assert is_cc0(rows[1]) is False   # CC-BY, not CC0

def test_search_uses_transport_and_parses():
    rows = search("whoosh", api_key="KEY", _transport=lambda url: FIX)
    assert len(rows) == 2 and rows[0]["id"] == 388037

def test_search_never_puts_key_in_returned_data():
    rows = search("whoosh", api_key="SECRET", _transport=lambda url: FIX)
    assert "SECRET" not in json.dumps(rows)   # T6

def test_download_returns_none_on_persistent_failure(tmp_path=None):
    import tempfile
    from freesound_client import download_preview
    def boom(_url):
        raise ConnectionResetError("forcibly closed")
    d = tempfile.mkdtemp()
    out = download_preview({"id": 999, "preview_url": "x"}, d, _opener=boom, attempts=2)
    assert out is None   # resilient: never raises, so one bad download can't crash a run

print("running"); test_parse_maps_fields_and_drops_no_preview(); test_is_cc0_only_true_for_zero(); test_search_uses_transport_and_parses(); test_search_never_puts_key_in_returned_data(); test_download_returns_none_on_persistent_failure(); print("PASS")
