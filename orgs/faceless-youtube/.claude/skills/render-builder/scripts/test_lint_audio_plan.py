"""Unit tests for the unified audio-plan lint (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from lint_audio_plan import lint

POOLS_SFX = {"cash": ["cash-1"], "boom": ["boom-1"]}
POOLS_MUSIC = {"sneaky": ["sneaky-1"], "casual-bed": ["casual-bed-1"]}


def test_clean_plan_passes():
    plan = {"cues": [
        {"kind": "sfx", "anchor": "a b c d", "role": "cash"},
        {"kind": "pause", "anchor": "e f g h", "pause_s": 0.6},
        {"kind": "music", "from_anchor": "i j k l", "mood": "sneaky"},
        {"kind": "dry", "from_anchor": "m n o p"},
    ]}
    assert lint(plan, POOLS_SFX, POOLS_MUSIC) == []


def test_bad_role_and_mood_and_kind():
    plan = {"cues": [
        {"kind": "sfx", "anchor": "x", "role": "kaboom"},          # role not in pools
        {"kind": "music", "from_anchor": "y", "mood": "techno"},   # mood not in pools
        {"kind": "pause", "anchor": "z", "in_pause": True},        # in_pause without pause_s
        {"kind": "teleport", "anchor": "q"},                       # unknown kind
    ]}
    errs = lint(plan, POOLS_SFX, POOLS_MUSIC)
    assert any("kaboom" in e for e in errs), errs
    assert any("techno" in e for e in errs), errs
    assert any("in_pause" in e for e in errs), errs
    assert any("teleport" in e for e in errs), errs


def main():
    for fn in [test_clean_plan_passes, test_bad_role_and_mood_and_kind]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
