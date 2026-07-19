#!/usr/bin/env python3
"""Plain-assert test: an environment/style gen with ZERO seeds must HARD-ERROR (no silent
stock-clipart fallback). identity/new_character still auto-seed. (repo has no pytest)
Run: py -3 .claude/skills/image-generation/scripts/test_forge_seed_requirement.py"""
import sys, tempfile
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
from forge import cmd_gen


def _stub_kit():
    # cmd_gen only touches k.staging before the seed check fires for a seedless environment/style req,
    # so a lightweight stub reaches the guard without a real Kit / bible / network.
    return SimpleNamespace(staging=tempfile.mkdtemp())


def test_environment_or_style_without_seed_hard_errors():
    for mode in ("environment", "style"):
        try:
            cmd_gen(_stub_kit(), [{"name": "plate", "mode": mode, "delta": "a swamp"}], True)
        except SystemExit as e:
            assert "style-anchor seed" in str(e), str(e)
        else:
            assert False, f"{mode} gen with no seed should have hard-errored"


if __name__ == "__main__":
    test_environment_or_style_without_seed_hard_errors()
    print("PASS test_forge_seed_requirement")
