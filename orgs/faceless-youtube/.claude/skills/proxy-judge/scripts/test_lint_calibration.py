#!/usr/bin/env python3
"""Plain-assert tests for lint_calibration (no pytest — matches repo convention).

Run: python test_lint_calibration.py
"""
import pathlib
from lint_calibration import parse_calibration, lint

HERE = pathlib.Path(__file__).parent


def test_parses_valid_entries():
    text = (HERE / "testdata" / "calib_valid.md").read_text(encoding="utf-8")
    entries = parse_calibration(text)
    assert len(entries) == 2, f"expected 2 entries, got {len(entries)}"
    assert entries[0]["id"] == "CJ-001"
    assert entries[0]["verdict"] == "accept"
    assert entries[0]["flagged"] == [], "clean accept must have empty flagged"
    assert entries[1]["flagged"][0]["quote"], "reject must carry a flag quote"


def test_lint_flags_bad_entry():
    text = (HERE / "testdata" / "calib_bad.md").read_text(encoding="utf-8")
    errs = lint(text)
    assert any("verdict" in e for e in errs), f"expected a verdict error in {errs}"
    assert any("flagged" in e for e in errs), f"expected an empty-flagged error in {errs}"


def test_lint_passes_valid():
    text = (HERE / "testdata" / "calib_valid.md").read_text(encoding="utf-8")
    assert lint(text) == [], "valid fixture must lint clean"


if __name__ == "__main__":
    test_parses_valid_entries()
    test_lint_flags_bad_entry()
    test_lint_passes_valid()
    print("OK: test_lint_calibration (3 tests passed)")
