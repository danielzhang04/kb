#!/usr/bin/env python3
"""Unit tests for build_motion's locked camera (plain-assert; repo has no pytest)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_motion import locked_camera


def test_camera_always_locked():
    # The camera is always locked (no move derived, 2026-07-12).
    assert locked_camera(is_card=False) == {"move": "none", "pan": None, "intensity": 0.0}
    assert locked_camera(is_card=True) == {"move": "none", "pan": None, "intensity": 0.0}


if __name__ == "__main__":
    print("running")
    test_camera_always_locked()
    print("PASS")
