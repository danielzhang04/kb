"""The Poyais Phase-2 fixture must validate against the schema + menu (plain-assert)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from menu import load_menu
from motion_plan import validate_plan

FIX = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..",
                   "channels", "the-second-take", "videos", "2026-07-04-poyais", "shots.motion.fixture.json")


def test_fixture_is_valid():
    plan = json.load(open(FIX, encoding="utf-8"))
    errs = validate_plan(plan, load_menu())
    assert errs == [], errs


if __name__ == "__main__":
    test_fixture_is_valid(); print("OK")
