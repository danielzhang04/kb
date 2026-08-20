#!/usr/bin/env python3
"""The suites own NO live state — the review store least of all.

`Kit(<real kit>).staging` IS the channel's production `_staging`, so a fixture that builds a real
Kit and forgets to re-point `staging` stamps `reviewer: fixture` all-pass records into the LIVE
P3 review gate: the gate opens itself on every pytest run, and any deliberate curation (a human
FAIL verdict, an unstamped asset held back on purpose) is erased by the next one. That happened —
73 fixture rows were found in the-second-take's live store on 2026-08-12.

These tests pin the repair: the trap still exists in `Kit` (it must — production writes there),
`conftest.isolate_staging` is the one way a fixture escapes it, and the guard refuses the mistake
loudly instead of leaving a silently-open gate behind.

Run: py -3 -m pytest test_live_store_isolation.py -q
"""
import json
import os
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import conftest as ct
from forge import Kit

SCRIPTS = Path(__file__).resolve().parent
KIT_DIR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit")
LIVE_STORE = KIT_DIR / "_staging" / "review.json"


def _live_state():
    """The live store's identity WITHOUT reading it — a test may not open it at all."""
    if not LIVE_STORE.exists():
        return None
    st = os.stat(LIVE_STORE)
    return (st.st_size, st.st_mtime_ns)


def test_a_real_kit_still_points_at_the_live_store_which_is_why_isolation_is_required():
    kit = Kit(str(KIT_DIR), dry=True)
    assert os.path.abspath(kit.staging) == os.path.abspath(str(KIT_DIR / "_staging")), kit.staging
    assert ct._live_kind(os.path.join(kit.staging, "review.json"), "w"), (
        "the guard must recognise an un-isolated Kit's staging as live")


def test_stamping_an_un_isolated_kit_is_refused_and_the_live_store_is_untouched():
    """The exact defect: a fixture builds the real Kit, forgets `isolate_staging`, stamps."""
    before = _live_state()
    kit = Kit(str(KIT_DIR), dry=True)
    with pytest.raises(RuntimeError) as excinfo:
        ct.stamp_kit(kit)
    message = str(excinfo.value)
    assert "LIVE" in message, message
    assert "isolate_staging" in message, message          # names the repair, not just the sin
    assert os.path.abspath(str(KIT_DIR / "_staging")) in message, message
    assert _live_state() == before, "a refused stamp must leave the live store byte-untouched"


def test_isolate_staging_moves_the_same_kit_to_tmp_and_the_stamp_semantics_are_unchanged():
    """8c's digest-true stamp is preserved exactly — only the TARGET moves."""
    before = _live_state()
    kit = ct.isolate_staging(Kit(str(KIT_DIR), dry=True))
    assert not ct._live_kind(kit.staging, "w"), kit.staging
    store = ct.stamp_kit(kit)
    figures = store["figures"]
    assert figures, "the standing library should have been stamped"
    sample = next(iter(figures.values()))
    assert sample["reviewer"] == "fixture" and sample["verdicts"] == {
        "texture-strip": "pass"}
    assert re.fullmatch(r"[0-9a-f]{64}", sample["canonical_sha256"]), sample
    with open(os.path.join(kit.staging, "review.json"), encoding="utf-8") as f:
        assert json.load(f)["figures"].keys() == figures.keys()
    assert _live_state() == before, "the stamp must have landed in tmp, not in the live store"


@pytest.mark.parametrize("mode", ["r", "rb", "w", "a"])
def test_the_guard_refuses_any_open_of_the_live_store_in_any_mode(mode):
    """Reading it would make a test depend on live curation; writing it would erase that curation."""
    before = _live_state()
    with pytest.raises(RuntimeError):
        open(str(LIVE_STORE), mode)
    assert _live_state() == before


def test_a_write_anywhere_in_the_live_channel_tree_is_refused_while_reads_stay_allowed():
    with pytest.raises(RuntimeError):
        open(str(KIT_DIR / "refs" / "__fixture-must-not-write__.png"), "wb")
    with open(str(KIT_DIR / "style-bible.md"), encoding="utf-8") as f:   # fixtures read this
        assert f.read(1)


def test_every_stamping_suite_isolates_the_kit_it_builds():
    """A source-level scan, so a NEW fixture cannot reintroduce the defect unnoticed: any suite
    that both builds a Kit over the real channel and stamps must call `isolate_staging`."""
    offenders = []
    for path in sorted(SCRIPTS.glob("test_*.py")):
        src = path.read_text(encoding="utf-8")
        if "Kit(str(KIT_DIR)" not in src:
            continue
        if ("stamp_kit" in src or "stamp_all_pass" in src) and "isolate_staging" not in src:
            offenders.append(path.name)
    assert offenders == [], offenders
