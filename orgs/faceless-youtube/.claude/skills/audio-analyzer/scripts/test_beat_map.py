import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from beat_map import narrative_beats

# Whisper-style segments {start, end, text}.
TX = [
    {"start": 0.0,  "end": 3.8,  "text": "the deal seemed perfectly ordinary at first"},
    {"start": 4.0,  "end": 7.8,  "text": "respectable men doing respectable business here today"},
    {"start": 8.0,  "end": 8.9,  "text": "none of it was real"},                 # short after long -> punchline
    {"start": 12.0, "end": 15.0, "text": "years later the truth finally surfaced somehow"},  # 3.1s silence -> act
]


def test_narrative_beats():
    b = narrative_beats(TX, act_gap_s=2.0, short_words=5)
    kinds = [x["kind"] for x in b]
    assert kinds == ["plain", "plain", "punchline", "act"], kinds
    assert b[3]["at_s"] == 12.0
    assert all(x["confidence"] == "directional" for x in b)   # narrative labels are inferred (G6)


print("running"); test_narrative_beats(); print("PASS")
