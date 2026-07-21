"""Cross-language parity for the inbox-gate classifier.

Both this pytest suite and dashboard/server/approvals/inboxGatesParity.test.ts load
the SAME fixture (tests/fixtures/inbox-gates-parity.json) and assert their classifier
returns the identical canonical category for every case. Any drift between the Python
brief.classify_category and the TypeScript dashboard classify is a RED test on one side
or the other — that is the whole anti-drift guarantee for G4.
"""
import json
from pathlib import Path

import cards
import brief

_FIXTURE = Path(__file__).parent / "fixtures" / "inbox-gates-parity.json"


def _load():
    data = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    return data["now"], data["cases"]


def test_classify_category_matches_every_fixture_case():
    now, cases = _load()
    assert cases, "fixture must carry cases"
    for case in cases:
        card = cards.Card(meta=dict(case["meta"]), body=case.get("body", ""))
        got = brief.classify_category(card, now=now)
        assert got == case["expected"], (
            f"{case['name']}: expected {case['expected']!r}, got {got!r}"
        )


def test_stranded_needs_a_clock_now_none_never_strands():
    """render_brief calls classify_category with now=None; the 25h-old stranded
    fixture card must then classify as None (advisory, surfaced live by the
    dashboard, never in the clock-free brief)."""
    _, cases = _load()
    stranded = next(c for c in cases if c["expected"] == "stranded")
    card = cards.Card(meta=dict(stranded["meta"]), body=stranded.get("body", ""))
    assert brief.classify_category(card, now=None) is None
