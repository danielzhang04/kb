"""Regression coverage for engagement-overhaul long-form cadence rules."""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lint_shots import lint_piece


def _lint_piece(shots, words):
    with tempfile.TemporaryDirectory() as td:
        script = Path(td) / "script.md"
        script.write_text("---\n" + " ".join(words) + "\n", encoding="utf-8")
        hard, soft = [], []
        lint_piece("long-form", shots, script, hard, soft)
        return hard


def test_runtime_over_five_cadence_floor_fails():
    words = ["word"] * 50
    shots = [{"id": f"L{i}", "vo_ref": "word", "duration_s": 4} for i in range(1, 4)]
    errs = _lint_piece(shots, words)
    assert any("1 cut / 5s" in e for e in errs), errs


def test_long_hold_requires_reason():
    words = ["word"] * 10
    shots = [{"id": "L01", "vo_ref": "word", "duration_s": 6.1}]
    errs = _lint_piece(shots, words)
    assert any("hold_reason" in e for e in errs), errs


def test_long_hold_with_reason_is_allowed():
    words = ["word"] * 10
    shots = [{"id": "L01", "vo_ref": "word", "duration_s": 6.1,
              "hold_reason": "Viewer needs the map labels long enough to read."}]
    errs = _lint_piece(shots, words)
    assert not any("hold_reason" in e for e in errs), errs
