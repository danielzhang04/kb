import pytest

from forge_state import (
    init_state,
    load_state,
    current_stage,
    lock_stage,
    is_complete,
    STATE_FILENAME,
)

STAGES = ["a", "b", "c"]


def test_init_writes_state_file(tmp_path):
    state = init_state(str(tmp_path), STAGES)
    assert (tmp_path / STATE_FILENAME).exists()
    assert state["stages"] == STAGES
    assert state["locked"] == []
    assert state["current"] == "a"


def test_load_returns_written_state(tmp_path):
    init_state(str(tmp_path), STAGES)
    assert load_state(str(tmp_path))["current"] == "a"


def test_current_stage(tmp_path):
    init_state(str(tmp_path), STAGES)
    assert current_stage(str(tmp_path)) == "a"


def test_lock_advances_current(tmp_path):
    init_state(str(tmp_path), STAGES)
    state = lock_stage(str(tmp_path), "a")
    assert state["locked"] == ["a"]
    assert state["current"] == "b"


def test_lock_out_of_order_raises(tmp_path):
    init_state(str(tmp_path), STAGES)
    with pytest.raises(ValueError):
        lock_stage(str(tmp_path), "b")


def test_full_walk_completes(tmp_path):
    init_state(str(tmp_path), STAGES)
    for s in STAGES:
        lock_stage(str(tmp_path), s)
    assert current_stage(str(tmp_path)) is None
    assert is_complete(str(tmp_path)) is True


def test_resumable_across_fresh_calls(tmp_path):
    init_state(str(tmp_path), STAGES)
    lock_stage(str(tmp_path), "a")
    # simulate a fresh terminal: only load_state / current_stage, no in-memory carryover
    assert current_stage(str(tmp_path)) == "b"
    assert load_state(str(tmp_path))["locked"] == ["a"]
