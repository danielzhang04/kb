#!/usr/bin/env python3
"""Unit test for forge.py rig-hold auto-append (plain-assert style; repo has no pytest)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from forge import _is_char_seed, should_hold, depicts_figures, blockquote_after


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


def test_env_seeded_frame_that_depicts_figures_still_gets_rig_hold():
    """REGRESSION (fyt-run-001, rounds 4-5). Deriving rig-hold from the SEED LIST alone let four
    frames ship with no rig invariants at all: their prompts were full of people, but every seed
    was an environment anchor, and `_is_char_seed()` excludes `/refs/env/`. Those four frames
    (L01, L10, L17, L31) were precisely that video's four worst rig failures — a drawn ear on the
    cold-open frame, noses on the investor row, realistic adult proportions, and noses + an ear +
    a realistic profile jaw. Rig-hold must derive from what the frame CONTAINS."""
    env = ["channels/x/visual-kit/refs/env/env-exterior-vivid.png"]

    # L31's real shape: an env-only seed set, a prompt full of figures.
    l31 = ("A steep downhill slope: a scorecard at the top-left, a few small executive figures "
           "stepping aside mid-slope, and a lone teller at a counter at the bottom-right.")
    assert should_hold("environment", env, l31) is True

    # L10's real shape: a row of seated investor figures, env anchor only.
    assert should_hold("environment", env, "A row of seated Wall Street investors in dark suits.") is True
    # L01's real shape: one lone customer at a bank counter.
    assert should_hold("environment", env, "A lone customer waiting at an empty bank counter.") is True

    # A genuinely figure-free environment must still NOT hold — the fix must not degrade to
    # "always true", which would make the signal meaningless.
    assert should_hold("environment", env, "An empty boardroom at dawn, chairs pushed in.") is False

    # ...including one whose prompt names the marker LETTERING hand, the obvious false friend.
    assert should_hold(
        "environment", env,
        "A ledger page, the title in relaxed hand-lettered marker capitals in the §6 marker hand.",
    ) is False

    # `identity` mode is still never re-appended, however figure-laden the delta.
    assert should_hold("identity", env, l31) is False

    # And the seed signal survives independently: a terse delta on a seeded character holds.
    char = ["channels/x/visual-kit/refs/macgregor/m.png"]
    assert should_hold("environment", char, "seated at a desk") is True


def test_depicts_figures_vocabulary_and_false_friends():
    assert depicts_figures("a crowd of ordinary people outside a bank") is True
    assert depicts_figures("a lone TELLER behind the counter") is True
    assert depicts_figures("a hand reaching for the money bag") is True
    assert depicts_figures("An empty street at night, shutters down") is False
    assert depicts_figures("hand-lettered marker capitals on a signboard") is False
    assert depicts_figures("the headline of a newspaper front page") is False
    assert depicts_figures("") is False
    assert depicts_figures(None) is False
    # substring safety: 'manifest'/'management' must not read as 'man'
    assert depicts_figures("a management manifest pinned to a corkboard") is False


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
    test_env_seeded_frame_that_depicts_figures_still_gets_rig_hold()
    test_depicts_figures_vocabulary_and_false_friends()
    test_blockquote_after_extracts_righold()
    print("PASS")
