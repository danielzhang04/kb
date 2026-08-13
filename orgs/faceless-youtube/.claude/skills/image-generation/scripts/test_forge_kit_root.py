#!/usr/bin/env python3
"""Regression contract for `Kit`'s repo-root walk (no provider calls, $0).

The walk climbs from the kit directory looking for the repo's env marker. When it found
nothing it used to stop at the filesystem root and say NOTHING, leaving `root` set to `C:\\`
so that every repo-relative seed path resolved under the drive root and the run reported
"seed frame not found" once per seed. That is not a seed problem and it read as one: it cost
the 2026-08-12 taste-forensics wave a full misdiagnosis before anyone looked at `Kit`.

The walk itself is unchanged. What changed is what an EXHAUSTED walk means: `root` is not a
usable answer, so READING it raises and names the marker it searched for and the directory it
searched from. The failure is deferred to the read rather than raised in `__init__` because
`Kit` is constructed in worktrees that legitimately have no marker — the suite's own fixtures
do exactly that and then pin `root` themselves, which is a repair the setter honours.

Run: py -3 -m pytest test_forge_kit_root.py -q
"""
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import forge
from forge import Kit

KIT_DIR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit")


def _stub_kit(tmp_path):
    """The two files `Kit.__init__` reads, and nothing else — so the walk is what is under test."""
    kit = tmp_path / "channels" / "stub-channel" / "visual-kit"
    (kit / "registry").mkdir(parents=True)
    (kit / "style-bible.md").write_text("# stub\n", encoding="utf-8")
    (kit / "registry" / "registry.json").write_text(json.dumps({"characters": {}, "assets": []}),
                                                    encoding="utf-8")
    return kit


def test_an_exhausted_walk_raises_on_read_instead_of_returning_the_filesystem_root(tmp_path):
    """The whole defect: no marker anywhere above the kit, and `root` used to be `C:\\`."""
    kit = Kit(str(_stub_kit(tmp_path)), dry=True)
    with pytest.raises(SystemExit) as excinfo:
        kit.root
    message = str(excinfo.value)
    assert forge.ENV_MARKER in message, message              # WHAT it searched for
    assert os.path.abspath(str(tmp_path)) in message, message  # WHERE it searched from
    assert "repo root" in message, message


def test_the_raise_names_the_kit_it_started_from_and_where_the_walk_stopped(tmp_path):
    kit_dir = _stub_kit(tmp_path)
    kit = Kit(str(kit_dir), dry=True)
    with pytest.raises(SystemExit) as excinfo:
        os.path.join(kit.root, "refs")
    message = str(excinfo.value)
    assert os.path.abspath(str(kit_dir)) in message, message
    # The exhausted stopping point is the filesystem root of the kit's own drive.
    stopped = os.path.abspath(os.path.join(str(kit_dir), *([os.pardir] * 40)))
    assert stopped in message, (stopped, message)


def test_pinning_the_root_is_the_sanctioned_repair_and_clears_the_failure(tmp_path):
    """Exactly what every batch fixture in this suite does — `Kit(...); k.root = ROOT`. The
    setter must accept it, or the fail-loud would break the suites it is meant to protect."""
    kit = Kit(str(_stub_kit(tmp_path)), dry=True)
    kit.root = str(tmp_path)
    assert kit.root == str(tmp_path)


def test_a_found_marker_still_resolves_normally_and_never_raises(tmp_path, monkeypatch):
    """The walk logic is unchanged: the first ancestor carrying the marker is the root. The
    marker NAME is monkeypatched so the fixture never creates a credential file on disk."""
    monkeypatch.setattr(forge, "ENV_MARKER", ".repo-marker-for-test")
    kit_dir = _stub_kit(tmp_path)
    (tmp_path / ".repo-marker-for-test").write_text("", encoding="utf-8")
    kit = Kit(str(kit_dir), dry=True)
    assert kit.root == os.path.abspath(str(tmp_path))


def test_the_marker_nearest_the_kit_wins(tmp_path, monkeypatch):
    monkeypatch.setattr(forge, "ENV_MARKER", ".repo-marker-for-test")
    kit_dir = _stub_kit(tmp_path)
    (tmp_path / ".repo-marker-for-test").write_text("", encoding="utf-8")
    nearer = kit_dir.parent.parent          # <tmp>/channels
    (nearer / ".repo-marker-for-test").write_text("", encoding="utf-8")
    kit = Kit(str(kit_dir), dry=True)
    assert kit.root == os.path.abspath(str(nearer))


def test_the_real_kit_constructs_without_raising_whatever_the_checkout(tmp_path):
    """`Kit.__init__` must stay constructible in a worktree with no marker — the fixtures in
    test_forge_seed_requirement.py, test_forge_place_and_gates.py, test_forge_style_tile.py,
    test_forge_interaction_and_lettering.py and test_forge_seed_roles_and_delta.py all build one
    and then pin `root`. Raising in `__init__` would take every one of them down."""
    kit = Kit(str(KIT_DIR), dry=True)
    assert kit.reg.get("characters"), "the real registry should have loaded"
