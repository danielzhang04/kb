#!/usr/bin/env python3
"""Plain-assert tests for score_agreement (no pytest).

Run: python test_score_agreement.py
"""
import pathlib
from score_agreement import parse_verdict, score, norm_quote

HERE = pathlib.Path(__file__).parent


def test_norm_quote_matches_paraphrase_prefix():
    a = norm_quote("The mania did the work, not the pitch.")
    b = norm_quote("the mania  did the WORK, not the pitch")
    assert a == b, f"{a!r} != {b!r}"


def test_verdict_match_and_line_overlap():
    truth = {"verdict": "reject",
             "flagged": [{"quote": "the mania did the work not the pitch"},
                         {"quote": "a country that did not exist"}]}
    pred = {"verdict": "reject",
            "flagged": [{"quote": "The mania did the work, not the pitch!"}]}
    r = score(pred, truth)
    assert r["verdict_match"] is True
    assert r["line_recall"] == 0.5, r["line_recall"]
    assert r["line_precision"] == 1.0, r["line_precision"]


def test_parse_verdict_fixture():
    text = (HERE / "testdata" / "verdict_sample.md").read_text(encoding="utf-8")
    v = parse_verdict(text)
    assert v["verdict"] == "reject"
    assert len(v["flagged"]) == 1
    assert "mania" in v["flagged"][0]["quote"]


if __name__ == "__main__":
    test_norm_quote_matches_paraphrase_prefix()
    test_verdict_match_and_line_overlap()
    test_parse_verdict_fixture()
    print("OK: test_score_agreement (3 tests passed)")
