from friction_log import log_friction, read_friction, FRICTION_FILENAME


def test_log_and_read(tmp_path):
    log_friction(str(tmp_path), "niche", "virality not baked into critics")
    log_friction(str(tmp_path), "visual-style", "over-cut prior analysis")
    entries = read_friction(str(tmp_path))
    assert len(entries) == 2
    assert entries[0] == {"stage": "niche", "note": "virality not baked into critics"}
    assert entries[1]["stage"] == "visual-style"


def test_read_empty_is_empty_list(tmp_path):
    assert read_friction(str(tmp_path)) == []


def test_log_lives_at_channel_root(tmp_path):
    # must NOT be under .workspace/ (which gets pruned) — it survives to run-end
    log_friction(str(tmp_path), "niche", "x")
    assert (tmp_path / FRICTION_FILENAME).exists()
    assert not (tmp_path / ".workspace").exists()
