"""Task D1.2 -- tests for scripts/stamp_session.py, the Plane-A (cards) <->
Plane-B (session transcript) join-key CLI shim.

These invoke the REAL CLI via subprocess (sys.executable), not a direct
function import, because the shim's job is to be a stable command-line
surface scripts/agent_runner.py's ``execute_card()`` shells out to -- exercising it any other
way would not prove the CLI contract holds.
"""
import subprocess
import sys
from pathlib import Path

import cards

SHIM = Path(__file__).resolve().parents[1] / "scripts" / "stamp_session.py"


def _run(card_path, session_id):
    return subprocess.run(
        [sys.executable, str(SHIM), str(card_path), session_id],
        capture_output=True,
        text=True,
    )


def test_stamp_cli_sets_session_id_on_card(tmp_path):
    c = cards.new_card("p", "do thing", "wiki/x.md", "T2", body="## Work order\nDo it.\n")
    path = cards.save(c, tmp_path)

    result = _run(path, "sess-abc")

    assert result.returncode == 0, result.stderr
    reparsed = cards.parse(path)
    assert reparsed.meta["session-id"] == "sess-abc"


def test_stamp_is_idempotent_and_preserves_other_fields(tmp_path):
    c = cards.new_card(
        "p", "do thing", "wiki/x.md", "T2", body="## Work order\nDo it.\nDetails here.\n"
    )
    cards.claim(c, "agent-x")
    path = cards.save(c, tmp_path)
    before = cards.parse(path)

    first = _run(path, "sess-one")
    assert first.returncode == 0, first.stderr
    second = _run(path, "sess-two")
    assert second.returncode == 0, second.stderr

    after = cards.parse(path)
    assert after.meta["session-id"] == "sess-two"

    # Every other meta field and the body are untouched.
    for key in before.meta:
        if key == "session-id":
            continue
        assert after.meta[key] == before.meta[key], f"field {key!r} changed"
    assert after.body == before.body


def test_stamp_rejects_malformed_session_id(tmp_path):
    c = cards.new_card("p", "do thing", "wiki/x.md", "T2")
    path = cards.save(c, tmp_path)
    before = path.read_bytes()

    result = _run(path, "bad id\nwith\tcontrol chars")

    assert result.returncode != 0
    assert result.stderr.strip() != ""
    # Rejected input must never touch the on-disk card.
    assert path.read_bytes() == before


def test_stamp_rejects_empty_session_id(tmp_path):
    c = cards.new_card("p", "do thing", "wiki/x.md", "T2")
    path = cards.save(c, tmp_path)

    result = _run(path, "")

    assert result.returncode != 0


def test_stamp_rejects_missing_card_path(tmp_path):
    missing = tmp_path / "inbox" / "does-not-exist.md"

    result = _run(missing, "sess-abc")

    assert result.returncode != 0
    assert "does not exist" in result.stderr
