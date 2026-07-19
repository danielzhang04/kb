import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from rank import rank

C = [{"id": 1, "quality": 0.4}, {"id": 2, "quality": 0.9}, {"id": 3, "quality": 0.5}]

def test_rank_by_clap_then_quality():
    scores = {1: 0.8, 2: 0.2, 3: 0.8}
    out = rank(C, scorer=lambda c: scores[c["id"]])
    assert [c["id"] for c in out] == [3, 1, 2]     # 3&1 tie on clap .8 -> quality .5>.4; then 2
    assert out[0]["clap"] == 0.8

def test_rank_falls_back_to_quality_when_no_clap():
    out = rank(C, scorer=lambda c: None)
    assert [c["id"] for c in out] == [2, 3, 1]      # quality desc
    assert out[0]["clap"] is None

def test_rank_is_deterministic():
    scores = {1: 0.5, 2: 0.5, 3: 0.5}
    a = rank(C, scorer=lambda c: scores[c["id"]]); b = rank(C, scorer=lambda c: scores[c["id"]])
    assert [c["id"] for c in a] == [c["id"] for c in b]

print("running"); test_rank_by_clap_then_quality(); test_rank_falls_back_to_quality_when_no_clap(); test_rank_is_deterministic(); print("PASS")
