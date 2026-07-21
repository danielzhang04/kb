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


def test_old_agent_owned_card_is_never_surfaced_now_or_clockless():
    """The old agent-owned cards (which used to classify `stranded`) are now
    AUTO-ARCHIVED by the daemon and never surfaced — so classify_category returns
    None whether or not a clock is supplied. `stranded` is no longer a category."""
    _, cases = _load()
    old_cards = [c for c in cases if "auto-archived" in c["name"]]
    assert old_cards, "fixture must still carry the old-agent-owned cases"
    for case in old_cards:
        card = cards.Card(meta=dict(case["meta"]), body=case.get("body", ""))
        assert brief.classify_category(card, now=_load()[0]) is None
        assert brief.classify_category(card, now=None) is None
