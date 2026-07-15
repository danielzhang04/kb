from forge_state import (
    load_default_stages,
    init_state,
    current_stage,
    lock_stage,
    is_complete,
)
from prune_workspace import prune


def test_full_default_walk_with_prune(tmp_path):
    ch = tmp_path / "new-channel"
    ch.mkdir()
    stages = load_default_stages()
    assert stages[0] == "niche"
    init_state(str(ch), stages)

    for expected in stages:
        assert current_stage(str(ch)) == expected
        # each stage explores in .workspace/, which is pruned on lock
        ws = ch / ".workspace" / expected
        ws.mkdir(parents=True)
        (ws / "scratch.txt").write_text("draft", encoding="utf-8")
        removed = prune(str(ch))
        assert removed  # workspace was swept
        lock_stage(str(ch), expected)

    assert is_complete(str(ch))
    # the resumable state file survives (it is NOT under .workspace/)
    assert (ch / ".forge-state.json").exists()


def test_prune_never_kills_state_file(tmp_path):
    ch = tmp_path / "c"
    ch.mkdir()
    init_state(str(ch), ["niche", "voice"])
    lock_stage(str(ch), "niche")
    prune(str(ch))
    assert (ch / ".forge-state.json").exists()
    assert current_stage(str(ch)) == "voice"
