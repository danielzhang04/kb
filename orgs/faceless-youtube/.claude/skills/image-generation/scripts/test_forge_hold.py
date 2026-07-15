#!/usr/bin/env python3
"""Unit test for forge.py rig-hold auto-append (plain-assert style; repo has no pytest)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from forge import _is_char_seed, should_hold, blockquote_after


def test_is_char_seed_classifies_paths():
    assert _is_char_seed("channels/x/visual-kit/refs/macgregor/macgregor-base.png") is True
    assert _is_char_seed("channels/x/videos/s/assets/library/bolivar.png") is True
    assert _is_char_seed("channels/x/videos/s/assets/scenes/L05.png") is True   # chain delta carry
    assert _is_char_seed("channels/x/visual-kit/refs/env/london-dock.png") is False  # env plate
    assert _is_char_seed(r"channels\x\visual-kit\refs\macgregor\m.png") is True  # windows sep
    assert _is_char_seed("some/random/plate.png") is False


def test_should_hold_only_on_char_bearing_nonidentity():
    char = ["channels/x/visual-kit/refs/macgregor/m.png"]
    env = ["channels/x/visual-kit/refs/env/dock.png"]
    # identity mode already carries the full rig via §2 -> never re-append
    assert should_hold("identity", char) is False
    # composed scene / new char / chain delta with a character-bearing seed -> append
    assert should_hold("environment", char) is True
    assert should_hold("new_character", char) is True
    assert should_hold("style", char) is True
    # character-free environment (env plate only / no seed) -> no append
    assert should_hold("environment", env) is False
    assert should_hold("environment", []) is False


def test_blockquote_after_extracts_righold():
    md = ("## 2b. STYLE-ONLY descriptor\n\n> style stuff here\n\n"
          "some prose\n\n## 2c. RIG-HOLD descriptor (verbatim)\n\n"
          "> Every cartoon FIGURE keeps the rig: no nose, no ears.\n\nnext prose\n")
    got = blockquote_after(md, "RIG-HOLD descriptor")
    assert got == "Every cartoon FIGURE keeps the rig: no nose, no ears.", repr(got)


if __name__ == "__main__":
    print("running")
    test_is_char_seed_classifies_paths()
    test_should_hold_only_on_char_bearing_nonidentity()
    test_blockquote_after_extracts_righold()
    print("PASS")
